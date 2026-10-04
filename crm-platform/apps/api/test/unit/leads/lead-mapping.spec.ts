import { describe, expect, it } from 'vitest';
import {
  autoDetect,
  boundLead,
  canonicalJson,
  coerceCustomValue,
  deriveExternalId,
  flattenPayload,
  lookupPath,
  normaliseLeadEmail,
  renderDealTitle,
  resolveLeadFields,
  stripNul,
} from '../../../src/modules/leads/lead-mapping';
import { defaultsOf, platformLabel } from '../../../src/modules/leads/lead-rules';

const subject = (body: unknown) => ({ fields: flattenPayload(body), raw: body });

describe('flattenPayload (L-05)', () => {
  it('flattens objects and arrays into paths', () => {
    expect(flattenPayload({ a: { b: 1 }, list: [{ x: 'y' }, 'z'], ok: true, none: null })).toEqual({
      'a.b': 1,
      'list[0].x': 'y',
      'list[1]': 'z',
      ok: true,
      none: null,
    });
  });

  it('is bounded: deep nesting, long values and huge key counts are cut, never thrown', () => {
    let deep: Record<string, unknown> = { leaf: 'x' };
    for (let i = 0; i < 20; i++) deep = { n: deep };
    expect(Object.keys(flattenPayload(deep))).toHaveLength(0);

    expect((flattenPayload({ v: 'x'.repeat(5000) }).v as string).length).toBe(2000);

    const many = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(flattenPayload(many)).length).toBeLessThanOrEqual(300);
  });

  it('drops non-finite numbers and undefined', () => {
    expect(flattenPayload({ a: Number.NaN, b: undefined, c: 1 })).toEqual({ c: 1 });
  });
});

describe('lookupPath', () => {
  it('finds an exact key, then the same key written another way, then walks raw', () => {
    const s = subject({ 'Phone Number': '123', nested: { Email: 'a@b.co' } });
    expect(lookupPath(s, 'Phone Number')).toBe('123');
    expect(lookupPath(s, 'phone_number')).toBe('123');
    expect(lookupPath(s, 'nested.Email')).toBe('a@b.co');
    expect(lookupPath(s, 'missing')).toBeNull();
    expect(lookupPath(s, undefined)).toBeNull();
  });

  it('treats an empty or whitespace value as absent', () => {
    expect(lookupPath(subject({ a: '   ', b: '' }), 'a')).toBeNull();
  });

  it('walks raw when only raw is held', () => {
    expect(lookupPath({ fields: {}, raw: { a: { b: [{ c: 'deep' }] } } }, 'a.b[0].c')).toBe('deep');
  });
});

describe('autoDetect: the common names (Reference lists plus lead forms)', () => {
  it('prefers a top-level key to a nested one, and earlier aliases to later ones', () => {
    expect(autoDetect(subject({ mobile: '2', phone: '1', contact: { phone: '3' } }), 'phone')).toBe(
      '1',
    );
    expect(autoDetect(subject({ contact: { phone: '3' } }), 'phone')).toBe('3');
  });

  it('is independent of key order and picks the shortest nested path', () => {
    const a = autoDetect(subject({ b: { c: { phone: 'long' } }, a: { phone: 'short' } }), 'phone');
    const b = autoDetect(subject({ a: { phone: 'short' }, b: { c: { phone: 'long' } } }), 'phone');
    expect(a).toBe('short');
    expect(b).toBe('short');
  });

  it('matches names ignoring case and punctuation', () => {
    expect(autoDetect(subject({ 'E-Mail Address': 'x@y.co' }), 'email')).toBe('x@y.co');
    expect(autoDetect(subject({ MSISDN: '99' }), 'phone')).toBe('99');
    expect(autoDetect(subject({ Tel: '98' }), 'phone')).toBe('98');
  });
});

describe('resolveLeadFields', () => {
  it('maps by the configured paths first', () => {
    const r = resolveLeadFields(
      subject({ who: 'Ada', mail: 'ADA@Example.com', tel: '+44 7700 900123', name: 'Other' }),
      {
        name: 'who',
        email: 'mail',
        phone: 'tel',
      },
    );
    expect(r).toMatchObject({ name: 'Ada', email: 'ada@example.com', phoneRaw: '+44 7700 900123' });
  });

  it('falls back to the common names, and joins a first name with a separate last name', () => {
    const r = resolveLeadFields(
      subject({ first_name: 'Grace', last_name: 'Hopper', phone_number: '5' }),
      {},
    );
    expect(r.name).toBe('Grace Hopper');
    expect(r.firstName).toBe('Grace');
    expect(r.lastName).toBe('Hopper');
  });

  it('keeps a full name as written and stitches only a bare first name', () => {
    expect(
      resolveLeadFields(subject({ full_name: 'Ada Lovelace', last_name: 'Lovelace' }), {}).name,
    ).toBe('Ada Lovelace');
    expect(
      resolveLeadFields(subject({ name: 'Ada', first_name: 'Ada', last_name: 'Lovelace' }), {})
        .name,
    ).toBe('Ada Lovelace');
  });

  it('rejects an address that is not one and says so', () => {
    const r = resolveLeadFields(subject({ email: 'not-an-email' }), {});
    expect(r.email).toBeNull();
    expect(r.notes).toContain('email_invalid');
  });

  it('reads custom properties and attribution (own fields, then mapped paths, then utm names)', () => {
    const r = resolveLeadFields(
      {
        ...subject({ budget: '5000', utm_campaign: 'spring', adset_x: 'AS1' }),
        attribution: { ad: 'Ad 7', form: 'F1' },
      },
      { customFields: { budget: 'budget' }, attribution: { adset: 'adset_x' } },
    );
    expect(r.custom).toEqual({ budget: '5000' });
    expect(r.attribution).toMatchObject({
      campaign: 'spring',
      adset: 'AS1',
      ad: 'Ad 7',
      form: 'F1',
      platform: null,
    });
  });

  it('a connector may carry only `fields` with our own names', () => {
    const r = resolveLeadFields(
      { fields: { full_name: 'Raj', email: 'raj@x.in', phone_number: '9876543210' } },
      {},
    );
    expect(r).toMatchObject({ name: 'Raj', email: 'raj@x.in', phoneRaw: '9876543210' });
  });
});

describe('normaliseLeadEmail', () => {
  it('lowercases and validates', () => {
    expect(normaliseLeadEmail(' A@B.Co ')).toBe('a@b.co');
    expect(normaliseLeadEmail('a@b')).toBeNull();
    expect(normaliseLeadEmail('a b@c.co')).toBeNull();
    expect(normaliseLeadEmail(null)).toBeNull();
  });
});

describe('deriveExternalId (L-01 idempotency key)', () => {
  it('uses the configured id when the payload has one', () => {
    const body = { lead: { id: 'L-77' }, phone: '1' };
    expect(deriveExternalId(subject(body), body, 'lead.id')).toEqual({
      externalId: 'L-77',
      derived: false,
    });
  });

  it('hashes the body when there is no id path or the payload lacks it', () => {
    const body = { phone: '1' };
    const a = deriveExternalId(subject(body), body, null);
    const b = deriveExternalId(subject(body), body, 'lead.id');
    expect(a.derived).toBe(true);
    expect(a.externalId).toMatch(/^h:[0-9a-f]{40}$/);
    expect(b.externalId).toBe(a.externalId);
  });

  it('the same body in another key order is the same id; a different body is not', () => {
    const one = { a: 1, b: { c: 2, d: 3 } };
    const two = { b: { d: 3, c: 2 }, a: 1 };
    expect(deriveExternalId(subject(one), one, null).externalId).toBe(
      deriveExternalId(subject(two), two, null).externalId,
    );
    const three = { a: 2, b: { c: 2, d: 3 } };
    expect(deriveExternalId(subject(three), three, null).externalId).not.toBe(
      deriveExternalId(subject(one), one, null).externalId,
    );
  });

  it('an id longer than the key limit is hashed, not truncated into a collision', () => {
    const body = { id: 'x'.repeat(400) };
    const r = deriveExternalId(subject(body), body, 'id');
    expect(r.externalId).toMatch(/^h:/);
    expect(r.externalId.length).toBeLessThanOrEqual(255);
  });
});

describe('canonicalJson', () => {
  it('sorts keys at every depth and keeps arrays ordered', () => {
    expect(canonicalJson({ b: [2, 1], a: { z: 1, y: null } })).toBe(
      '{"a":{"y":null,"z":1},"b":[2,1]}',
    );
  });
});

describe('coerceCustomValue', () => {
  it('types a value by its property type, and skips what it cannot be', () => {
    expect(coerceCustomValue('integer', '1,200')).toBe(1200);
    expect(coerceCustomValue('integer', '1.5')).toBeUndefined();
    expect(coerceCustomValue('decimal', '12.5')).toBe(12.5);
    expect(coerceCustomValue('checkbox', 'Yes')).toBe(true);
    expect(coerceCustomValue('boolean', 'nope')).toBeUndefined();
    expect(coerceCustomValue('multiselect', 'a, b;c')).toEqual(['a', 'b', 'c']);
    expect(coerceCustomValue('text', '  hi ')).toBe('hi');
    expect(coerceCustomValue('text', '   ')).toBeUndefined();
  });
});

describe('renderDealTitle', () => {
  it('fills the placeholders and tidies empty ones', () => {
    expect(
      renderDealTitle(
        '{{name}} ({{source}})',
        { name: 'Ada', source: 'Facebook', campaign: null },
        'x',
      ),
    ).toBe('Ada (Facebook)');
    expect(
      renderDealTitle('{{name}} ({{source}})', { name: 'Ada', source: null, campaign: null }, 'x'),
    ).toBe('Ada');
    expect(
      renderDealTitle('{{campaign}}', { name: 'Ada', source: null, campaign: null }, 'Fallback'),
    ).toBe('Fallback');
  });
});

describe('source rules', () => {
  it('fills a stored defaults object that predates a key', () => {
    const d = defaultsOf({ defaults: { platform: 'Meta' } });
    expect(d.owner).toEqual({ mode: 'unassigned', userIds: [] });
    expect(d.deal.enabled).toBe(false);
    expect(d.notify.owner).toBe(true);
  });

  it('a corrupt defaults object falls back to the plain defaults rather than failing a lead', () => {
    expect(defaultsOf({ defaults: { owner: { mode: 'bogus' } } as never }).owner.mode).toBe(
      'unassigned',
    );
  });

  it('the platform label is the lead\'s, else the source\'s, else "Webhook"', () => {
    const d = defaultsOf({ defaults: {} });
    expect(platformLabel({ providerKey: null, name: 'n' }, d, 'Instagram')).toBe('Instagram');
    expect(platformLabel({ providerKey: 'meta', name: 'n' }, d, null)).toBe('meta');
    expect(platformLabel({ providerKey: null, name: 'n' }, d, null)).toBe('Webhook');
    expect(
      platformLabel(
        { providerKey: 'meta', name: 'n' },
        defaultsOf({ defaults: { platform: 'Facebook' } }),
        null,
      ),
    ).toBe('Facebook');
  });
});

describe('what the public can send is always storable (stripNul, boundLead)', () => {
  const NUL = String.fromCharCode(0);

  it('removes the NUL character, which Postgres refuses in text and jsonb, from every string and key', () => {
    const dirty = {
      ['na' + NUL + 'me']: 'Ad' + NUL + 'a',
      list: ['x' + NUL, { deep: NUL + 'y' }],
      n: 1,
      ok: true,
      none: null,
    };
    const clean = stripNul(dirty);
    expect(clean).toEqual({ name: 'Ada', list: ['x', { deep: 'y' }], n: 1, ok: true, none: null });
    expect(JSON.stringify(clean)).not.toContain('\u0000');
  });

  it('leaves a clean value as it was', () => {
    const v = { a: 'b', c: [1, 2] };
    expect(stripNul(v)).toEqual(v);
  });

  it('keeps a lead of ordinary size whole and drops a raw payload over 512 KB (fields stay)', () => {
    const lead = { externalId: 'e', fields: { phone: '1' }, raw: { a: 'b' } };
    expect(boundLead(lead).raw).toEqual({ a: 'b' });
    const huge = { ...lead, raw: { blob: 'x'.repeat(600 * 1024) } };
    const bounded = boundLead(huge);
    expect(bounded.raw).toBeUndefined();
    expect(bounded.fields).toEqual({ phone: '1' });
  });
});
