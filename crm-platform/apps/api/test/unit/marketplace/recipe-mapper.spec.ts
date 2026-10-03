import { describe, expect, it } from 'vitest';
import { validateMarketRecipe, type MarketRecipe } from '@crm/contracts';
import {
  applyTransforms,
  mapDelivery,
  normaliseKey,
  payloadHashId,
  readPath,
  MAX_LEADS_PER_DELIVERY,
} from '../../../src/infra/providers/marketplace';
import { pushRecipe, relayRecipe } from './fixtures';

const recipe = (input: unknown): MarketRecipe => {
  const v = validateMarketRecipe(input);
  if (!v.ok) throw new Error(JSON.stringify(v.problems));
  return v.recipe;
};

describe('readPath', () => {
  it('reads dotted paths and array indexes, and never walks the prototype chain', () => {
    const o = { a: { b: [{ c: 1 }, { c: 2 }] }, 'x-y': 'z' };
    expect(readPath(o, 'a.b[1].c')).toBe(2);
    expect(readPath(o, 'x-y')).toBe('z');
    expect(readPath(o, 'a.missing.deeper')).toBeUndefined();
    expect(readPath(o, 'a.b[9].c')).toBeUndefined();
    expect(readPath(o, '__proto__.polluted')).toBeUndefined();
    expect(readPath(o, 'a.constructor')).toBeUndefined();
    expect(readPath(o, 'toString')).toBeUndefined();
    expect(readPath('text', 'length')).toBeUndefined();
  });
});

describe('transforms', () => {
  it('phone: Indian numbers get +91, a plus number is kept, junk is dropped', () => {
    const phone = (v: string) => applyTransforms(v, ['phone'], '91');
    expect(phone('98765 43210')).toBe('+919876543210');
    expect(phone('09876543210')).toBe('+919876543210');
    expect(phone('919876543210')).toBe('+919876543210');
    expect(phone('+44 7700 900123')).toBe('+447700900123');
    expect(phone('0091 98765 43210')).toBe('+919876543210');
    expect(phone('(987) 654-3210')).toBe('+919876543210');
    expect(phone('call me')).toBeUndefined();
    expect(phone('12')).toBeUndefined();
  });

  it('trim, lower, upper, digits chain and an empty result is "missing"', () => {
    expect(applyTransforms('  A@B.COM ', ['trim', 'lower'], '91')).toBe('a@b.com');
    expect(applyTransforms('ab-12', ['digits'], '91')).toBe('12');
    expect(applyTransforms('--', ['digits'], '91')).toBeUndefined();
    expect(applyTransforms('x', ['upper'], '91')).toBe('X');
  });
});

describe('auto mapping (the generic webhook)', () => {
  const r = recipe(relayRecipe());

  it('finds the well-known fields by alias and carries every other scalar', () => {
    const out = mapDelivery(r, {
      lead_id: 'L-1',
      full_name: 'Asha Verma',
      mobile: '98765 43210',
      email_id: 'ASHA@Example.com',
      requirement: 'Need 2 BHK',
      budget: 5000000,
      vip: true,
      utm_source: 'google',
      utm_campaign: 'summer',
      created_at: '2026-10-01T10:00:00Z',
    });
    expect(out.rejected).toEqual([]);
    const lead = out.leads[0]!;
    expect(lead.externalId).toBe('L-1');
    expect(lead.fields).toMatchObject({
      name: 'Asha Verma',
      phone: '+919876543210',
      email: 'asha@example.com',
      message: 'Need 2 BHK',
      budget: 5000000,
      vip: true,
    });
    expect(lead.attribution).toEqual({ platform: 'google', campaign: 'summer' });
    expect(lead.receivedAt).toBe('2026-10-01T10:00:00.000Z');
    expect(lead.raw).toBeDefined();
  });

  it('flattens nested objects, joins first and last name, and ignores arrays and nulls', () => {
    const lead = mapDelivery(r, {
      id: 7,
      first_name: 'Ravi',
      last_name: 'K',
      contact: { phone: '9123456780' },
      tags: ['a'],
      note: null,
    }).leads[0]!;
    expect(lead.externalId).toBe('7');
    expect(lead.fields.name).toBe('Ravi K');
    expect(lead.fields.contact_phone).toBe('9123456780');
    expect('tags' in lead.fields).toBe(false);
    expect('note' in lead.fields).toBe(false);
  });

  it('a delivery with no id gets a stable hash id, so a repeat is still a duplicate', () => {
    const a = mapDelivery(r, { name: 'A', phone: '9876543210' }).leads[0]!;
    const b = mapDelivery(r, { phone: '9876543210', name: 'A' }).leads[0]!;
    const c = mapDelivery(r, { name: 'B', phone: '9876543210' }).leads[0]!;
    expect(a.externalId).toMatch(/^h-[0-9a-f]{32}$/);
    expect(a.externalId).toBe(b.externalId);
    expect(a.externalId).not.toBe(c.externalId);
    expect(payloadHashId({ x: 1 })).toBe(payloadHashId({ x: 1 }));
  });

  it('an array is several leads; what is not an object is rejected with a reason, never dropped', () => {
    const out = mapDelivery(r, [{ id: 1, name: 'A' }, 'junk', { id: 3, name: 'C' }, {}]);
    expect(out.leads.map((l) => l.externalId)).toEqual(['1', '3']);
    expect(out.rejected).toEqual([
      { index: 1, reason: 'not_an_object' },
      { index: 3, reason: 'empty' },
    ]);
    expect(mapDelivery(r, 'text').rejected).toEqual([{ index: 0, reason: 'not_an_object' }]);
  });

  it('caps one delivery and reports the rest', () => {
    const many = Array.from({ length: MAX_LEADS_PER_DELIVERY + 5 }, (_, i) => ({
      id: i,
      name: 'x',
    }));
    const out = mapDelivery(r, many);
    expect(out.leads).toHaveLength(MAX_LEADS_PER_DELIVERY);
    expect(out.rejected).toHaveLength(5);
    expect(out.rejected[0]!.reason).toBe('too_many_items');
  });

  it('long values are cut and prototype keys are ignored', () => {
    const lead = mapDelivery(
      r,
      JSON.parse(
        '{"id":"1","name":"' + 'x'.repeat(5000) + '","__proto__":{"admin":true},"constructor":"c"}',
      ),
    ).leads[0]!;
    expect((lead.fields.name as string).length).toBe(2000);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
    expect('constructor' in lead.fields && typeof lead.fields.constructor === 'string').toBe(false);
  });

  it('normaliseKey makes a field name safe', () => {
    expect(normaliseKey(' Mobile Number ')).toBe('mobile_number');
    expect(normaliseKey('E-mail!')).toBe('e_mail');
  });
});

describe('explicit mapping (a portal recipe)', () => {
  const r = recipe(pushRecipe());

  it('reads the items array, maps by the rules, applies transforms, constants and attribution', () => {
    const out = mapDelivery(r, {
      queries: [
        {
          query: {
            id: 'q-1',
            sender_name: 'Ravi',
            sender_mobile: '98765 43210',
            message: 'Quote please',
            campaign: 'diwali',
          },
        },
        { query: { id: 'q-2', sender_name: 'Meera', sender_mobile: '9123456780' } },
      ],
    });
    expect(out.rejected).toEqual([]);
    expect(out.leads).toHaveLength(2);
    expect(out.leads[0]).toMatchObject({
      externalId: 'q-1',
      fields: { name: 'Ravi', phone: '+919876543210', message: 'Quote please', city: 'Unknown' },
      attribution: { platform: 'acme', campaign: 'diwali' },
    });
    expect(out.leads[1]!.attribution).toEqual({ platform: 'acme' });
  });

  it('a missing required field rejects that item only, naming the field', () => {
    const out = mapDelivery(r, {
      queries: [
        { query: { id: 'q-1', sender_name: 'Ravi' } },
        { query: { id: 'q-2', sender_name: 'Meera', sender_mobile: '9123456780' } },
        { query: { id: 'q-3', sender_mobile: '9123456780' } },
      ],
    });
    expect(out.leads.map((l) => l.externalId)).toEqual(['q-2']);
    expect(out.rejected).toEqual([
      { index: 0, reason: 'missing_phone' },
      { index: 2, reason: 'missing_name' },
    ]);
  });

  it('an unusable phone number counts as missing when the field is required', () => {
    const out = mapDelivery(r, {
      queries: [{ query: { id: 'q-1', sender_name: 'Ravi', sender_mobile: 'n/a' } }],
    });
    expect(out.rejected).toEqual([{ index: 0, reason: 'missing_phone' }]);
  });

  it('a default fills a missing optional field', () => {
    const withDefault = recipe(
      pushRecipe({
        mapping: {
          mode: 'explicit',
          fields: [
            { to: 'name', from: 'n', default: 'Unknown caller' },
            { to: 'phone', from: 'p', required: true },
          ],
        },
      }),
    );
    expect(mapDelivery(withDefault, { p: '1234567' }).leads[0]!.fields).toEqual({
      phone: '1234567',
      name: 'Unknown caller',
    });
  });
});
