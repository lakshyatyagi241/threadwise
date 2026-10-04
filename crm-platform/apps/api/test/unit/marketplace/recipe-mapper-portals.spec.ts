import { describe, expect, it } from 'vitest';
import { validateMarketRecipe, type MarketRecipe } from '@crm/contracts';
import {
  applyTransforms,
  mapDelivery,
  parseTime,
  unescapeText,
} from '../../../src/infra/providers/marketplace';
import { pushRecipe } from './fixtures';

const recipe = (mapping: unknown, extra: Record<string, unknown> = {}): MarketRecipe => {
  const v = validateMarketRecipe({ ...pushRecipe(), mapping, ...extra });
  if (!v.ok) throw new Error(JSON.stringify(v.problems));
  return v.recipe;
};

describe('what a portal writes, in our words', () => {
  it('unescape turns the two characters backslash-n back into a line break, and leaves other backslashes alone', () => {
    expect(unescapeText('one\\ntwo\\tthree\\\\four \\q')).toBe('one\ntwo\tthree\\four \\q');
    expect(applyTransforms('a\\nb', ['unescape'], '91')).toBe('a\nb');
  });

  it('a value the portal sends for "nothing" is absent (compared ignoring case), so the next path or a default is used', () => {
    const r = recipe({
      mode: 'explicit',
      externalId: { from: 'id' },
      fields: [
        { to: 'name', from: 'who', ignore: ['IndiaMART Buyer'] },
        { to: 'nick', from: 'who', ignore: ['indiamart buyer'], default: 'unknown' },
      ],
    });
    const out = mapDelivery(r, [
      { id: '1', who: 'IndiaMART Buyer' },
      { id: '2', who: 'Asha' },
    ]);
    expect(out.leads[0]!.fields).toEqual({ nick: 'unknown' });
    expect(out.leads[1]!.fields).toEqual({ name: 'Asha', nick: 'Asha' });
  });

  it('a path that has nothing falls back to the next, and one that is not a number falls back too', () => {
    const r = recipe({
      mode: 'explicit',
      externalId: { from: 'id' },
      fields: [
        {
          to: 'phone',
          from: 'mobile',
          fallbackFrom: ['mobile_alt', 'landline'],
          transform: ['phone'],
        },
      ],
    });
    const out = mapDelivery(r, [
      { id: '1', mobile: '+91-98765-43210' },
      { id: '2', mobile: '', mobile_alt: '98765 43211' },
      { id: '3', mobile: 'not a number', landline: '020 2567 8901' },
      { id: '4' },
    ]);
    expect(out.leads.map((l) => l.fields.phone)).toEqual([
      '+919876543210',
      '+919876543211',
      '+912025678901',
      undefined,
    ]);
  });

  it('maps the portal wording in a field and in attribution; an unlisted value is kept as it came', () => {
    const r = recipe({
      mode: 'explicit',
      externalId: { from: 'id' },
      fields: [{ to: 'lead_type', from: 'type', map: { W: 'Direct enquiry', B: 'Buy lead' } }],
      attribution: {
        platform: { const: 'indiamart' },
        campaign: { from: 'type', map: { W: 'Direct enquiry' } },
      },
    });
    const out = mapDelivery(r, [
      { id: '1', type: 'W' },
      { id: '2', type: 'ZZ' },
    ]);
    expect(out.leads[0]).toMatchObject({
      fields: { lead_type: 'Direct enquiry' },
      attribution: { platform: 'indiamart', campaign: 'Direct enquiry' },
    });
    expect(out.leads[1]).toMatchObject({
      fields: { lead_type: 'ZZ' },
      attribution: { platform: 'indiamart', campaign: 'ZZ' },
    });
  });
});

describe('when the portal wrote the time', () => {
  it("a time with no zone is the portal's own: IST is 330 minutes east of UTC", () => {
    expect(parseTime('2024-04-10 11:17:14', 'iso', 330)).toBe('2024-04-10T05:47:14.000Z');
    expect(parseTime('2024-04-10T11:17:14', 'iso', 330)).toBe('2024-04-10T05:47:14.000Z');
    expect(parseTime('2024-04-10 11:17', 'iso', 0)).toBe('2024-04-10T11:17:00.000Z');
  });

  it('a time that names its zone, a date, and epochs mean what they say', () => {
    expect(parseTime('2024-04-10T11:17:14Z', 'iso', 330)).toBe('2024-04-10T11:17:14.000Z');
    expect(parseTime('2024-04-10T11:17:14+05:30', 'iso', 0)).toBe('2024-04-10T05:47:14.000Z');
    expect(parseTime('2024-04-10', 'iso', 330)).toBe('2024-04-10T00:00:00.000Z');
    expect(parseTime('1435345453', 'epoch_seconds', 330)).toBe('2015-06-26T19:04:13.000Z');
    expect(parseTime(1435345453, 'epoch_seconds', 0)).toBe('2015-06-26T19:04:13.000Z');
    expect(parseTime('1435345453000', 'epoch_millis', 0)).toBe('2015-06-26T19:04:13.000Z');
  });

  it('what is not a time is nothing, never a wrong time', () => {
    expect(parseTime('yesterday', 'iso', 0)).toBeUndefined();
    expect(parseTime('abc', 'epoch_seconds', 0)).toBeUndefined();
    expect(parseTime(undefined, 'iso', 0)).toBeUndefined();
    expect(parseTime({}, 'iso', 0)).toBeUndefined();
  });

  it('an explicit recipe stamps the lead with the portal time, or flags the receive time as approximate', () => {
    const dated = recipe({
      mode: 'explicit',
      externalId: { from: 'id' },
      receivedAt: { from: 'at', format: 'iso', utcOffsetMinutes: 330 },
      fields: [{ to: 'name', from: 'name' }],
    });
    expect(
      mapDelivery(dated, { id: '1', at: '2024-04-10 11:17:14', name: 'A' }).leads[0]!.receivedAt,
    ).toBe('2024-04-10T05:47:14.000Z');
    const undated = recipe({
      mode: 'explicit',
      externalId: { from: 'id' },
      receivedAtApproximate: true,
      fields: [{ to: 'name', from: 'name' }],
    });
    const lead = mapDelivery(undated, { id: '1', name: 'A' }).leads[0]!;
    expect(lead.receivedAt).toBeUndefined();
    expect(lead.fields).toMatchObject({ received_at_approximate: true });
  });
});

describe('a lead id derived for a portal that gives none', () => {
  const housing = recipe({
    mode: 'explicit',
    defaultCountryCode: '91',
    externalIdDerive: {
      parts: [
        { from: 'lead_phone', transform: ['phone'] },
        { from: 'project_id' },
        { from: 'lead_date' },
      ],
      prefix: 'hs',
    },
    fields: [{ to: 'phone', from: 'lead_phone', transform: ['phone'] }],
  });
  const lead = {
    lead_name: 'Anita',
    lead_phone: '9876543210',
    project_id: 1233,
    lead_date: '1759576634',
  };

  it('is a hash of the phone, the project and the date: stable, prefixed, and the same however the phone is written', () => {
    const a = mapDelivery(housing, [lead]).leads[0]!.externalId;
    expect(a).toMatch(/^hs-[0-9a-f]{32}$/);
    expect(mapDelivery(housing, [{ ...lead }]).leads[0]!.externalId).toBe(a);
    expect(
      mapDelivery(housing, [{ ...lead, lead_phone: '+91 98765-43210' }]).leads[0]!.externalId,
    ).toBe(a);
    expect(
      mapDelivery(housing, [{ ...lead, lead_name: 'Someone else' }]).leads[0]!.externalId,
    ).toBe(a);
  });

  it('differs for another project, another time or another buyer: two enquiries are two leads', () => {
    const base = mapDelivery(housing, [lead]).leads[0]!.externalId;
    for (const other of [
      { ...lead, project_id: 1234 },
      { ...lead, lead_date: '1759576635' },
      { ...lead, lead_phone: '9876543211' },
    ]) {
      expect(mapDelivery(housing, [other]).leads[0]!.externalId).not.toBe(base);
    }
  });

  it('falls back to a hash of the whole item when a part is missing (an identical repeat is still recognised)', () => {
    const noDate = { lead_name: 'Anita', lead_phone: '9876543210', project_id: 1233 };
    const a = mapDelivery(housing, [noDate]).leads[0]!.externalId;
    expect(a).toMatch(/^h-[0-9a-f]{32}$/);
    expect(mapDelivery(housing, [{ ...noDate }]).leads[0]!.externalId).toBe(a);
  });
});

describe('the generic mapping for a payload nobody has seen yet', () => {
  const auto = (over: Record<string, unknown> = {}) =>
    recipe({
      mode: 'auto',
      platform: 'justdial',
      receivedAtApproximate: true,
      utcOffsetMinutes: 330,
      ...over,
    });

  it('labels the lead with the portal, finds the usual names and keeps the rest', () => {
    const lead = mapDelivery(auto(), {
      leadid: 'JD-1',
      name: 'Meera',
      mobile: '98765 43210',
      email: 'Meera@Example.com',
      category: 'Interior Designers',
      city: 'Kochi',
      pincode: '682024',
    }).leads[0]!;
    expect(lead.externalId).toBe('JD-1');
    expect(lead.fields).toMatchObject({
      name: 'Meera',
      phone: '+919876543210',
      email: 'meera@example.com',
      city: 'Kochi',
      category: 'Interior Designers',
      pincode: '682024',
      received_at_approximate: true,
    });
    expect(lead.attribution).toEqual({ platform: 'justdial' });
    expect(lead.receivedAt).toBeUndefined();
  });

  it("the payload's own platform wins over the label; a time it does send is read in the portal's zone", () => {
    const lead = mapDelivery(auto(), {
      name: 'A',
      mobile: '9876543210',
      source: 'magicbricks',
      created_at: '2026-10-04 11:00:00',
    }).leads[0]!;
    expect(lead.attribution).toEqual({ platform: 'magicbricks' });
    expect(lead.receivedAt).toBe('2026-10-04T05:30:00.000Z');
    expect(lead.fields.received_at_approximate).toBeUndefined();
  });

  it('reads the proposed names of the real-estate portals: remark, msg, QryInfo, QueryId, lead_phone', () => {
    const mb = mapDelivery(auto(), {
      name: 'S',
      mobile: '9876543210',
      remark: 'Call back',
      pid: 'MB-1',
    }).leads[0]!;
    expect(mb.fields).toMatchObject({ message: 'Call back', pid: 'MB-1' });
    const pull = mapDelivery(auto(), {
      QueryId: 'Q-9',
      Name: 'N',
      Phone: '9876543210',
      QryInfo: 'Need info',
    }).leads[0]!;
    expect(pull.externalId).toBe('Q-9');
    expect(pull.fields).toMatchObject({ name: 'N', message: 'Need info', phone: '+919876543210' });
    const h = mapDelivery(auto(), {
      lead_name: 'H',
      lead_phone: '9876543210',
      lead_email: 'H@x.com',
    }).leads[0]!;
    expect(h.fields).toMatchObject({ name: 'H', phone: '+919876543210', email: 'h@x.com' });
  });

  it('joins a country code sent apart from the number, unless the number already has one', () => {
    const a = mapDelivery(auto(), { name: 'A', phone: '501234567', country_code: '971' }).leads[0]!;
    expect(a.fields.phone).toBe('+971501234567');
    expect(a.fields.country_code).toBeUndefined();
    expect(
      mapDelivery(auto(), { name: 'A', phone: '9876543210', country_code: '91' }).leads[0]!.fields
        .phone,
    ).toBe('+919876543210');
    expect(
      mapDelivery(auto(), { name: 'A', phone: '919876543210', country_code: '91' }).leads[0]!.fields
        .phone,
    ).toBe('+919876543210');
    expect(
      mapDelivery(auto(), { name: 'A', phone: '+14155550100', country_code: '91' }).leads[0]!.fields
        .phone,
    ).toBe('+14155550100');
  });

  it('a phone sent as a JSON number is read as a number, and a derived id is found by the flattened name', () => {
    const r = auto({
      externalIdDerive: {
        parts: [{ from: 'Mobile', transform: ['phone'] }, { from: 'project_id' }],
        prefix: 'x',
      },
    });
    const lead = mapDelivery(r, { name: 'A', mobile: 9876543210, project_id: 'P1' }).leads[0]!;
    expect(lead.fields.phone).toBe('+919876543210');
    expect(lead.externalId).toMatch(/^x-[0-9a-f]{32}$/);
  });

  it('the earlier behaviour is unchanged: the generic webhook mapping with no options still finds name, phone, email and its id', () => {
    const lead = mapDelivery(recipe({ mode: 'auto' }), {
      id: 'z-1',
      full_name: 'Zed',
      phone_number: '98765 43210',
      email_address: 'ZED@x.com',
    }).leads[0]!;
    expect(lead).toMatchObject({
      externalId: 'z-1',
      fields: { name: 'Zed', phone: '+919876543210', email: 'zed@x.com' },
    });
  });
});
