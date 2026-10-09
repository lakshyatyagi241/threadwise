import { describe, expect, it } from 'vitest';
import type { WizardVariables } from '@crm/contracts';
import type { MergeContact, MergeContext } from '../../../src/modules/crm';
import {
  applyWizardVariables,
  chargeableMessages,
  estimateCost,
  fillText,
  isFrequencyCap,
  nextRetrySlot,
  resolveMapping,
  resolveSource,
  scheduleColumns,
  senderGuided,
  templateSlots,
  tokensOf,
  unmappedSlots,
} from '../../../src/modules/campaigns/wizard/wizard-rules';

const contact = (o: Partial<MergeContact> = {}): MergeContact => ({
  name: 'Aarav Sharma',
  firstName: 'Aarav',
  middleName: null,
  lastName: 'Sharma',
  title: null,
  phone: '+919812345678',
  countryCode: '+91',
  email: 'aarav@example.com',
  address: null,
  language: null,
  groups: [],
  data: { city: 'Pune', tier: '' },
  ...o,
});
const ctx = (c: MergeContact | undefined = contact()): MergeContext => ({
  contact: c,
  attributeDefaults: new Map([['tier', 'Standard']]),
  system: { today: '2026-10-06', businessName: 'Acme', companyName: 'Acme' },
});

const tpl = (o: Partial<Parameters<typeof templateSlots>[0]> = {}) => ({
  templateBody: 'Hi {{1}}, your {{2}} order ships to {{3}}.',
  header: null,
  variableMap: {
    body: [
      { num: 1, key: 'first_name', example: 'Asha' },
      { num: 2, key: 'order_id', example: 'A-100' },
    ],
  },
  buttons: [],
  ...o,
});

describe('template slots', () => {
  it('lists the placeholders in the map and the ones only the text has, in number order, with the key the template names', () => {
    const slots = templateSlots(tpl());
    expect(slots.map((s) => s.slot)).toEqual(['body.1', 'body.2', 'body.3']);
    expect(slots[0]).toMatchObject({
      section: 'body',
      position: 1,
      key: 'first_name',
      example: 'Asha',
    });
    expect(slots[2]).toMatchObject({ key: '', example: null });
  });

  it('a header placeholder is slot header.1', () => {
    const slots = templateSlots(
      tpl({ header: 'Offer for {{1}}', templateBody: 'Plain body', variableMap: {} }),
    );
    expect(slots.map((s) => s.slot)).toEqual(['header.1']);
  });

  it('named placeholders take their order of first appearance, and keep their name as the key', () => {
    const slots = templateSlots(
      tpl({ templateBody: 'Hi {{first_name}} from {{city}}, {{first_name}}', variableMap: {} }),
    );
    expect(slots.map((s) => [s.slot, s.key])).toEqual([
      ['body.1', 'first_name'],
      ['body.2', 'city'],
    ]);
  });

  it('a link button whose address carries a placeholder is slot button.<position>; a static one is not', () => {
    const slots = templateSlots(
      tpl({
        templateBody: 'No variables',
        variableMap: {},
        buttons: [
          { type: 'phone_number', text: 'Call', phone_number: '+1' },
          {
            type: 'url',
            text: 'Track',
            url: 'https://shop.test/track/{{1}}',
            example: ['https://shop.test/track/AB12'],
          },
          { type: 'url', text: 'Home', url: 'https://shop.test' },
        ],
      }),
    );
    expect(slots).toEqual([
      {
        slot: 'button.1',
        section: 'button',
        position: 1,
        key: '',
        example: 'https://shop.test/track/AB12',
      },
    ]);
  });

  it('a template with no placeholder has no slots', () => {
    expect(templateSlots(tpl({ templateBody: 'Hello!', variableMap: {} }))).toEqual([]);
    expect(tokensOf('{{a}} and {{ a }} and {{b}}')).toEqual(['a', 'b']);
  });
});

describe('resolving a variable for a contact', () => {
  it("a field is the contact's value; a custom property reads contact.data", () => {
    expect(resolveSource({ kind: 'field', field: 'first_name' }, ctx())).toEqual({
      value: 'Aarav',
      empty: false,
    });
    expect(resolveSource({ kind: 'field', field: 'city' }, ctx())).toEqual({
      value: 'Pune',
      empty: false,
    });
  });

  it('with no value the fallback is used; with neither it is empty (and flagged), never the braces', () => {
    const noName = ctx(contact({ firstName: null, name: null }));
    expect(
      resolveSource({ kind: 'field', field: 'first_name', fallback: 'there' }, noName),
    ).toEqual({
      value: 'there',
      empty: false,
    });
    expect(resolveSource({ kind: 'field', field: 'first_name' }, noName)).toEqual({
      value: '',
      empty: true,
    });
    expect(resolveSource({ kind: 'field', field: 'nothing_here' }, ctx())).toEqual({
      value: '',
      empty: true,
    });
  });

  it('a workspace default fills a property the contact has not set (the merge rule), so a fallback is not needed', () => {
    expect(resolveSource({ kind: 'field', field: 'tier' }, ctx())).toEqual({
      value: 'Standard',
      empty: false,
    });
  });

  it('fixed text is sent as written', () => {
    expect(resolveSource({ kind: 'fixed', text: 'SALE50' }, ctx())).toEqual({
      value: 'SALE50',
      empty: false,
    });
  });

  it('maps every slot, listing the unmapped and the empty ones', () => {
    const slots = templateSlots(tpl());
    const vars: WizardVariables = {
      'body.1': { kind: 'field', field: 'first_name' },
      'body.2': { kind: 'field', field: 'order_id' },
    };
    const r = resolveMapping(slots, vars, ctx());
    expect(r.values).toEqual({ 'body.1': 'Aarav', 'body.2': '' });
    expect(r.empty).toEqual(['body.2']);
    expect(r.unmapped).toEqual(['body.3']);
    expect(unmappedSlots(slots, vars)).toEqual(['body.3']);
  });
});

describe('filling the template text', () => {
  const slots = templateSlots(tpl());
  const values = { 'body.1': 'Aarav', 'body.2': 'A-100', 'body.3': 'Pune' };

  it('replaces positional placeholders by slot', () => {
    expect(fillText('Hi {{1}}, your {{2}} order ships to {{3}}.', 'body', slots, values)).toBe(
      'Hi Aarav, your A-100 order ships to Pune.',
    );
  });

  it('a placeholder with no value is left out, never printed with braces; null stays null', () => {
    expect(fillText('Hi {{1}} {{9}}!', 'body', slots, { 'body.1': 'Aarav' })).toBe('Hi Aarav !');
    expect(fillText(null, 'header', slots, values)).toBeNull();
  });

  it('a named placeholder takes the slot whose key it is', () => {
    const named = templateSlots(
      tpl({ templateBody: 'Hi {{first_name}} from {{city}}', variableMap: {} }),
    );
    expect(
      fillText('Hi {{first_name}} from {{city}}', 'body', named, {
        'body.1': 'Aarav',
        'body.2': 'Pune',
      }),
    ).toBe('Hi Aarav from Pune');
  });
});

describe("laying the mapping over the template's own variables", () => {
  const slots = templateSlots(
    tpl({
      header: 'Hello {{1}}',
      buttons: [{ type: 'url', text: 'Track', url: 'https://shop.test/{{1}}' }],
    }),
  );
  const values = {
    'header.1': 'Aarav',
    'body.1': 'Aarav',
    'body.2': 'A-100',
    'body.3': 'Pune',
    'button.0': 'AB12',
  };

  it("sets the header, the body in slot order and the link button's parameter", () => {
    const out = applyWizardVariables({ body: ['old'] }, slots, values);
    expect(out.header).toBe('Aarav');
    expect(out.body).toEqual(['Aarav', 'A-100', 'Pune']);
    expect(out.buttons).toEqual([{ index: 0, subType: 'url', value: 'AB12' }]);
  });

  it("touches only what the mapping covers: a partial body mapping leaves the template's own values", () => {
    const out = applyWizardVariables({ body: ['x', 'y', 'z'] }, slots, { 'body.1': 'only' });
    expect(out.body).toEqual(['x', 'y', 'z']);
  });
});

describe('frequency cap detection', () => {
  it('by code, or by the words the provider and the older paths carry', () => {
    expect(isFrequencyCap({ code: '131049' })).toBe(true);
    expect(isFrequencyCap({ message: 'error_code:131049' })).toBe(true);
    expect(
      isFrequencyCap({ message: 'Message not delivered to maintain healthy ecosystem engagement' }),
    ).toBe(true);
  });

  it('nothing else: an undeliverable number, a network error, an empty failure', () => {
    expect(isFrequencyCap({ code: '131026' })).toBe(false);
    expect(isFrequencyCap({ message: 'Could not reach Meta: timeout' })).toBe(false);
    expect(isFrequencyCap({})).toBe(false);
  });
});

describe('retry slots: a 24-hour grid anchored on the first send', () => {
  const first = new Date('2026-10-06T10:17:42Z');
  const DAY = 86_400_000;

  it('the first retry is exactly 24 hours after the first send', () => {
    const s = nextRetrySlot({
      firstSentAt: first,
      retriesDone: 0,
      now: new Date(first.getTime() + 5 * 60_000),
      windowCloses: null,
    });
    expect(s.at?.toISOString()).toBe('2026-10-07T10:17:42.000Z');
    expect(s.attemptNo).toBe(1);
  });

  it('each next retry is another 24 hours on, whatever the time the previous one ran at', () => {
    const s = nextRetrySlot({
      firstSentAt: first,
      retriesDone: 1,
      // The first retry ran late (a minute past its slot).
      now: new Date(first.getTime() + DAY + 60_000),
      windowCloses: null,
    });
    expect(s.at?.getTime()).toBe(first.getTime() + 2 * DAY);
    expect(s.attemptNo).toBe(2);
  });

  it('slots a long outage missed are skipped: the next is still on the grid and in the future, never bunched with the late one', () => {
    const s = nextRetrySlot({
      firstSentAt: first,
      retriesDone: 1,
      now: new Date(first.getTime() + 3 * DAY + 3_600_000),
      windowCloses: null,
    });
    expect(s.attemptNo).toBe(4);
    expect(s.at?.getTime()).toBe(first.getTime() + 4 * DAY);
  });

  it('no slot at or after the end of the window', () => {
    const closes = new Date(first.getTime() + 2 * DAY);
    expect(
      nextRetrySlot({ firstSentAt: first, retriesDone: 0, now: first, windowCloses: closes }).at,
    ).not.toBeNull();
    expect(
      nextRetrySlot({ firstSentAt: first, retriesDone: 1, now: first, windowCloses: closes }).at,
    ).toBeNull();
  });
});

describe('cost', () => {
  const lines = [
    { country: 'IN', messages: 100, unitPriceMinor: 80 },
    { country: 'US', messages: 10, unitPriceMinor: 350 },
  ];

  it('every destination at its price, in hundredths', () => {
    expect(estimateCost(lines, 110)).toEqual({ subtotals: [8000, 3500], totalMinor: 11_500 });
  });

  it('the full cost is every message at its price, whatever the plan covers', () => {
    const all = lines.reduce((n, l) => n + l.messages, 0);
    expect(estimateCost(lines, all)).toEqual({ subtotals: [8000, 3500], totalMinor: 11_500 });
    expect(estimateCost(lines, all).totalMinor).toBeGreaterThan(estimateCost(lines, 0).totalMinor);
  });

  it('only the chargeable share when the plan covers part of the send, rounded up', () => {
    const r = estimateCost(lines, 55);
    expect(r.totalMinor).toBe(Math.ceil(100 * 80 * 0.5) + Math.ceil(10 * 350 * 0.5));
    expect(estimateCost(lines, 0).totalMinor).toBe(0);
    expect(estimateCost([], 0).totalMinor).toBe(0);
  });

  it('wallet mode charges every message; plan mode only what is beyond the monthly allowance (0 is unlimited)', () => {
    const base = { recipients: 100, usedThisMonth: 950, planActive: true };
    expect(chargeableMessages({ ...base, mode: 'wallet', monthlyLimit: 1000 })).toBe(100);
    expect(chargeableMessages({ ...base, mode: 'plan', monthlyLimit: 1000 })).toBe(50);
    expect(chargeableMessages({ ...base, mode: 'plan', monthlyLimit: 5000 })).toBe(0);
    expect(chargeableMessages({ ...base, mode: 'plan', monthlyLimit: 0 })).toBe(0);
    expect(
      chargeableMessages({ ...base, mode: 'plan', monthlyLimit: 1000, planActive: false }),
    ).toBe(100);
    expect(
      chargeableMessages({ ...base, usedThisMonth: 5000, mode: 'plan', monthlyLimit: 1000 }),
    ).toBe(100);
  });
});

describe('schedule columns', () => {
  it('a scheduled broadcast fires on the date, time and zone the sweeper reads', () => {
    const at = new Date('2026-10-07T03:30:00Z');
    expect(
      scheduleColumns(
        { mode: 'scheduled', date: '2026-10-07', time: '09:00', timezone: 'Asia/Kolkata' },
        at,
      ),
    ).toEqual({
      scheduleType: 'scheduled',
      sendDate: '2026-10-07',
      sendTime: '09:00',
      timezone: 'Asia/Kolkata',
      runAt: at,
    });
    expect(scheduleColumns({ mode: 'now' }, null).scheduleType).toBe('now');
  });
});

describe('senderGuided', () => {
  const ok = { engine: 'waba', status: 'connected', meta: null };
  it('is only for a connected Meta number', () => {
    expect(senderGuided(ok)).toBe(true);
    expect(senderGuided({ ...ok, engine: 'twilio' })).toBe(false);
    expect(senderGuided({ ...ok, status: 'pending' })).toBe(false);
    expect(senderGuided({ ...ok, status: 'disconnected' })).toBe(false);
  });
  it('reads what Meta reported', () => {
    const meta = (m: Record<string, unknown>) => senderGuided({ ...ok, meta: m });
    expect(
      meta({
        code_verification_status: 'VERIFIED',
        name_status: 'APPROVED',
        phone_status: 'CONNECTED',
      }),
    ).toBe(true);
    // Not code-verified blocks only while the phone is not CONNECTED (Meta's own test number stays NOT_VERIFIED yet sends fine).
    expect(meta({ code_verification_status: 'NOT_VERIFIED' })).toBe(false);
    expect(meta({ code_verification_status: 'NOT_VERIFIED', phone_status: 'CONNECTED' })).toBe(
      true,
    );
    expect(meta({ code_verification_status: 'EXPIRED', phone_status: 'CONNECTED' })).toBe(false);
    expect(meta({ name_status: 'DECLINED' })).toBe(false);
    for (const s of ['BANNED', 'restricted', 'DELETED', 'MIGRATED', 'PENDING'])
      expect(meta({ phone_status: s })).toBe(false);
  });
});
