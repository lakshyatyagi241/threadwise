import { describe, expect, it } from 'vitest';
import type { ConsentGateResult, ConsentSubject, MinorRule, PurposeInput } from '@crm/contracts';
import {
  NO_FACTS,
  decideConsent,
  type ConsentFacts,
} from '../../../src/modules/contact-consent/consent-gate.rules';
import type {
  ConsentGate,
  GateManyResult,
} from '../../../src/modules/contact-consent/consent-gate.service';
import {
  COMMERCE_CONSENT_CHANNEL,
  addSkips,
  commercePurpose,
  foldProbes,
  isMarketing,
  refusalOfRow,
} from '../../../src/modules/shopify-woocommerce/commerce-consent.rules';
import { CommerceConsentService } from '../../../src/modules/shopify-woocommerce/commerce-consent.service';
import type { DatabaseService } from '../../../src/infra/db/database.service';
import type { EventsRepository } from '../../../src/modules/shopify-woocommerce/events.repository';
import type { SegmentsRepository } from '../../../src/modules/shopify-woocommerce/segments.repository';

/**
 * BL-141 follow-up (BL-278): the consent step of the commerce sends. The truth table is the gate's own rule (`decideConsent`) read for
 * the one channel every commerce engine sends on; the service is exercised with a gate that answers from a table of contacts, so no
 * database is needed. The real-Postgres run per sender is test/e2e/shopify-woocommerce/ecom-consent.e2e.spec.ts.
 */

const facts = (f: Partial<ConsentFacts> = {}): ConsentFacts => ({ ...NO_FACTS, ...f });

interface Opts {
  requireConsent?: boolean;
  minorRule?: MinorRule;
  f?: Partial<ConsentFacts>;
}
const decide = (purpose: PurposeInput, o: Opts = {}): ConsentGateResult =>
  decideConsent({
    purpose,
    channel: COMMERCE_CONSENT_CHANNEL,
    requireConsent: o.requireConsent ?? false,
    ...(o.minorRule ? { minorRule: o.minorRule } : {}),
    facts: facts(o.f),
  });

describe('what a store message is, for consent', () => {
  it('a MARKETING template is marketing, whatever its case or spacing', () => {
    for (const c of ['marketing', 'MARKETING', ' Marketing ']) {
      expect(commercePurpose(c)).toBe('marketing_messaging');
      expect(isMarketing(commercePurpose(c))).toBe(true);
    }
  });

  it('a UTILITY or AUTHENTICATION template, and one with no category, is a service message', () => {
    for (const c of ['utility', 'authentication', 'UTILITY', '', null, undefined]) {
      expect(commercePurpose(c)).toBe('service_messaging');
      expect(isMarketing(commercePurpose(c))).toBe(false);
    }
  });

  it('every commerce engine messages on the whatsapp consent channel', () => {
    expect(COMMERCE_CONSENT_CHANNEL).toBe('whatsapp');
  });
});

describe('ConsentGate truth table, marketing on the commerce channel', () => {
  const marketing = 'marketing_messaging' as const;

  it('switch off (the default): only a withdrawal blocks', () => {
    expect(decide(marketing)).toEqual({ decision: 'allow', reason: 'policy_off' });
    expect(decide(marketing, { f: { ledgerState: 'granted' } }).decision).toBe('allow');
    expect(decide(marketing, { f: { unsubscribedFlag: true } })).toEqual({
      decision: 'deny',
      reason: 'withdrawn',
    });
    expect(decide(marketing, { f: { ledgerState: 'withdrawn' } })).toEqual({
      decision: 'deny',
      reason: 'withdrawn',
    });
  });

  it('switch on: a recorded grant is needed, a withdrawal still wins', () => {
    const on = { requireConsent: true };
    expect(decide(marketing, on)).toEqual({ decision: 'deny', reason: 'no_consent_recorded' });
    expect(decide(marketing, { ...on, f: { ledgerState: 'granted' } })).toEqual({
      decision: 'allow',
      reason: 'granted',
    });
    expect(
      decide(marketing, { ...on, f: { ledgerState: 'granted', unsubscribedFlag: true } }),
    ).toEqual({ decision: 'deny', reason: 'withdrawn' });
  });

  it('a flagged minor is held back by the workspace rule', () => {
    expect(decide(marketing, { minorRule: 'block', f: { minor: true } })).toEqual({
      decision: 'deny',
      reason: 'subject_minor',
    });
    expect(decide(marketing, { minorRule: 'off', f: { minor: true } }).decision).toBe('allow');
  });

  it('the Do-Not-Call list never stops a WhatsApp message', () => {
    expect(decide(marketing, { f: { onDncList: true } }).decision).toBe('allow');
  });

  it('service and utility messages are never blocked: STOP, the switch and a minor flag do not touch them', () => {
    const stopped = { unsubscribedFlag: true, minor: true };
    for (const purpose of ['service_messaging', 'utility'] as const) {
      expect(decide(purpose, { requireConsent: true, minorRule: 'block', f: stopped })).toEqual({
        decision: 'allow',
        reason: 'utility_exempt',
      });
    }
  });
});

describe('one audience row that stands for several contacts', () => {
  it('is refused when any of them is; `withdrawn` wins, else the first reason', () => {
    expect(refusalOfRow([])).toBeNull();
    expect(refusalOfRow(['subject_minor'])).toBe('subject_minor');
    expect(refusalOfRow(['no_consent_recorded', 'withdrawn'])).toBe('withdrawn');
    expect(refusalOfRow(['subject_minor', 'no_consent_recorded'])).toBe('subject_minor');
  });

  it('folds the probes back to one verdict per row, in the audience order', () => {
    const rows = ['a', 'b', 'c'];
    const probe = (rowIndex: number, contactId: number | null) => ({ rowIndex, contactId });
    const out = foldProbes(rows, {
      go: [probe(0, 1), probe(1, 2), probe(2, null)],
      skipped: [
        { row: probe(1, 3), reason: 'no_consent_recorded' },
        { row: probe(1, 4), reason: 'withdrawn' },
      ],
    });
    expect(out.go).toEqual(['a', 'c']);
    expect(out.skipped).toEqual([{ row: 'b', reason: 'withdrawn' }]);
  });
});

describe('the running tally of a broadcast that waits for the quiet hours', () => {
  it('adds a run to the runs before it, per reason', () => {
    const first = addSkips(undefined, [{ reason: 'withdrawn' }, { reason: 'subject_minor' }]);
    expect(first).toEqual({
      skipped: 2,
      skippedReasons: [
        { reason: 'withdrawn', count: 1 },
        { reason: 'subject_minor', count: 1 },
      ],
    });
    expect(addSkips(first, [{ reason: 'withdrawn' }])).toEqual({
      skipped: 3,
      skippedReasons: [
        { reason: 'withdrawn', count: 2 },
        { reason: 'subject_minor', count: 1 },
      ],
    });
    expect(addSkips(undefined, [])).toEqual({ skipped: 0, skippedReasons: [] });
    // A resume carried by a job queued before this existed has no tally at all.
    expect(addSkips({}, [{ reason: 'withdrawn' }]).skipped).toBe(1);
  });
});

/** A gate that answers from a table of contacts through the real rule, and counts what it was asked. */
function fakeGate(opts: {
  requireConsent?: boolean;
  minorRule?: MinorRule;
  contacts: Record<number, Partial<ConsentFacts>>;
  broken?: boolean;
}) {
  const asked: Array<{ ids: number[]; channel: string; purpose: PurposeInput }> = [];
  const anonymous: Array<{ channel: string; purpose: PurposeInput }> = [];
  const run = (channel: string, purpose: PurposeInput, f: Partial<ConsentFacts>) =>
    decideConsent({
      purpose,
      channel,
      requireConsent: opts.requireConsent ?? false,
      ...(opts.minorRule ? { minorRule: opts.minorRule } : {}),
      facts: facts(f),
    });
  const gate = {
    checkMany(
      _org: number,
      ids: readonly number[],
      channel: string,
      purpose: PurposeInput,
    ): Promise<GateManyResult> {
      asked.push({ ids: [...ids], channel, purpose });
      const decisions = new Map<number, ConsentGateResult>();
      // A gate that cannot decide leaves no answer, which `gateRecipients` reads as closed.
      if (!opts.broken)
        for (const id of new Set(ids))
          decisions.set(id, run(channel, purpose, opts.contacts[id] ?? {}));
      return Promise.resolve({ decisions, allowed: new Set(), counts: {} });
    },
    check(
      _org: number,
      subject: ConsentSubject,
      channel: string,
      purpose: PurposeInput,
    ): Promise<ConsentGateResult> {
      expect(subject).toEqual({ type: 'anonymous' });
      anonymous.push({ channel, purpose });
      return Promise.resolve(run(channel, purpose, {}));
    },
  };
  return { gate: gate as unknown as ConsentGate, asked, anonymous };
}

function build(o: Parameters<typeof fakeGate>[0], owners: Record<string, number[]> = {}) {
  const g = fakeGate(o);
  let lookups = 0;
  const db = {
    txAs: (_: unknown, fn: (tx: unknown) => unknown) => Promise.resolve(fn({})),
  } as unknown as DatabaseService;
  const segments = {
    contactIdsByDigits: (_tx: unknown, _org: number, numbers: readonly string[]) => {
      lookups += 1;
      return Promise.resolve(
        new Map(numbers.filter((n) => owners[n]).map((n) => [n, owners[n] as number[]])),
      );
    },
  } as unknown as SegmentsRepository;
  const logged: Array<Record<string, unknown>> = [];
  const events = {
    log: (_tx: unknown, _o: number, _k: string, _s: number, row: Record<string, unknown>) => {
      logged.push(row);
      return Promise.resolve({ id: 1, createdAt: new Date() });
    },
  } as unknown as EventsRepository;
  const service = new CommerceConsentService(db, g.gate, segments, events);
  return { service, ...g, logged, lookups: () => lookups };
}

describe('CommerceConsentService.clearAudience', () => {
  it('a utility template clears everyone and asks nobody: no gate call, no lookup', async () => {
    const f = build({ requireConsent: true, contacts: { 1: { unsubscribedFlag: true } } });
    const out = await f.service.clearAudience(
      7,
      [{ phone: '15550100001', contactId: 1 }, { phone: '15550100002' }],
      'utility',
    );
    expect(out.go.map((g) => g.clearance.basis)).toEqual(['service', 'service']);
    expect(out.skipped).toEqual([]);
    expect(f.asked).toEqual([]);
    expect(f.anonymous).toEqual([]);
    expect(f.lookups()).toBe(0);
  });

  it('a marketing template asks once for the whole audience, as marketing on whatsapp, and splits who goes', async () => {
    const f = build(
      { contacts: { 10: { unsubscribedFlag: true }, 11: {}, 12: { ledgerState: 'withdrawn' } } },
      { '15550100003': [12] },
    );
    const out = await f.service.clearAudience(
      7,
      [
        { phone: '+1 555 010 0001', contactId: 10 },
        { phone: '15550100002', contactId: 11 },
        // No contact id on the row: the owner of the number is found by the number.
        { phone: '15550100003' },
      ],
      'marketing',
    );
    expect(out.go.map((g) => g.row.phone)).toEqual(['15550100002']);
    expect(out.go[0]?.clearance.basis).toBe('asked');
    expect(out.skipped.map((s) => [s.row.phone, s.reason])).toEqual([
      ['+1 555 010 0001', 'withdrawn'],
      ['15550100003', 'withdrawn'],
    ]);
    // One question for the audience (and one lookup of the numbers), never one per customer.
    expect(f.asked).toHaveLength(1);
    expect(f.asked[0]).toMatchObject({ channel: 'whatsapp', purpose: 'marketing_messaging' });
    expect(f.lookups()).toBe(1);
  });

  it('a number two contacts share is refused when either of them left', async () => {
    const f = build(
      { contacts: { 1: {}, 2: { unsubscribedFlag: true } } },
      { '15550100001': [1, 2] },
    );
    const out = await f.service.clearAudience(
      7,
      [{ phone: '15550100001', contactId: 1 }],
      'marketing',
    );
    expect(out.go).toEqual([]);
    expect(out.skipped).toEqual([
      { row: { phone: '15550100001', contactId: 1 }, reason: 'withdrawn' },
    ]);
  });

  it('switch on: a customer with no grant is skipped, a granted one goes, a number that is no contact is skipped too', async () => {
    const f = build(
      { requireConsent: true, contacts: { 1: { ledgerState: 'granted' }, 2: {} } },
      { '15550100001': [1], '15550100002': [2] },
    );
    const out = await f.service.clearAudience(
      7,
      [{ phone: '15550100001' }, { phone: '15550100002' }, { phone: '15550100009' }],
      'marketing',
    );
    expect(out.go.map((g) => g.row.phone)).toEqual(['15550100001']);
    expect(out.skipped.map((s) => s.reason)).toEqual([
      'no_consent_recorded',
      'no_consent_recorded',
    ]);
    // The number nobody owns is asked as an anonymous subject, once.
    expect(f.anonymous).toHaveLength(1);
  });

  it('switch off (the default): a number that is no contact is messaged, only withdrawals block', async () => {
    const f = build({ contacts: {} });
    const out = await f.service.clearAudience(7, [{ phone: '15550100009' }], 'marketing');
    expect(out.go).toHaveLength(1);
  });

  it('a flagged minor is skipped when the workspace says no minors', async () => {
    const f = build(
      { minorRule: 'block', contacts: { 5: { minor: true } } },
      { '15550100005': [5] },
    );
    const out = await f.service.clearAudience(7, [{ phone: '15550100005' }], 'marketing');
    expect(out.skipped.map((s) => s.reason)).toEqual(['subject_minor']);
  });

  it('a gate that cannot decide refuses marketing: nobody is messaged unchecked', async () => {
    const f = build({ broken: true, contacts: {} }, { '15550100005': [5] });
    const out = await f.service.clearAudience(7, [{ phone: '15550100005' }], 'marketing');
    expect(out.go).toEqual([]);
    expect(out.skipped.map((s) => s.reason)).toEqual(['gate_unavailable_closed']);
  });

  it('an empty audience asks nothing', async () => {
    const f = build({ contacts: {} });
    expect(await f.service.clearAudience(7, [], 'marketing')).toEqual({ go: [], skipped: [] });
    expect(f.asked).toEqual([]);
    expect(f.lookups()).toBe(0);
  });
});

describe('CommerceConsentService.clearCustomer', () => {
  it('clears a customer of a utility template, and refuses one of a marketing template with the stable code', async () => {
    const f = build({ contacts: { 3: { unsubscribedFlag: true } } }, { '15550100003': [3] });
    const notice = await f.service.clearCustomer(7, 'utility', '15550100003');
    expect(notice).toMatchObject({ ok: true });
    const promo = await f.service.clearCustomer(7, 'marketing', '15550100003');
    expect(promo).toEqual({
      ok: false,
      reason: 'withdrawn',
      note: 'Not messaged: consent (withdrawn)',
    });
    const other = await f.service.clearCustomer(7, 'marketing', '15550100004');
    expect(other).toMatchObject({ ok: true });
  });

  it('the merchant staff number is cleared without a question', () => {
    const f = build({ contacts: {} });
    expect(f.service.staff().basis).toBe('staff');
    expect(f.asked).toEqual([]);
  });
});

describe('CommerceConsentService.recordSkips', () => {
  it('writes one skipped row per reason with the stable code, and nothing when nobody was refused', async () => {
    const f = build({ contacts: {} });
    await f.service.recordSkips(7, 'shopify', 3, 'offer/broadcast', []);
    expect(f.logged).toEqual([]);
    await f.service.recordSkips(7, 'shopify', 3, 'offer/broadcast', [
      { reason: 'withdrawn' },
      { reason: 'subject_minor' },
      { reason: 'withdrawn' },
    ]);
    expect(f.logged).toEqual([
      {
        eventType: 'offer/broadcast',
        status: 'skipped',
        recipient: '2 contacts',
        payload: { reason: 'withdrawn', count: 2 },
        error: 'Not messaged: consent (withdrawn)',
      },
      {
        eventType: 'offer/broadcast',
        status: 'skipped',
        recipient: '1 contact',
        payload: { reason: 'subject_minor', count: 1 },
        error: 'Not messaged: consent (subject_minor)',
      },
    ]);
  });
});
