import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTE_KEY_PATTERN,
  POSITIONAL_PLACEHOLDER_MESSAGE,
  RESERVED_ATTRIBUTE_KEYS,
  SYSTEM_ATTRIBUTES,
  createAttributeSchema,
  normalizeMergeKey,
  updateAttributeSchema,
  validatePositionalPlaceholders,
} from '@crm/contracts';
import {
  renderMergeTags,
  resolveToken,
  type MergeContact,
  type MergeContext,
} from '../../../src/modules/crm/attributes/merge-tags';

const contact = (over: Partial<MergeContact> = {}): MergeContact => ({
  name: 'Aarav Sharma',
  firstName: 'Aarav',
  middleName: null,
  lastName: 'Sharma',
  title: null,
  phone: '+919812345678',
  countryCode: '+91',
  email: 'aarav@example.com',
  address: null,
  language: 'en',
  groups: ['VIP', 'New leads'],
  data: {},
  ...over,
});

const ctx = (over: Partial<MergeContext> = {}): MergeContext => ({
  contact: contact(),
  attributeDefaults: new Map(),
  system: { today: '2026-10-01', businessName: 'Geta', companyName: 'Geta Inc' },
  ...over,
});

describe('merge-tag resolution (TW-CON-048)', () => {
  it('TW-CON-048 #1: "{{Customer Name}}" resolves to the contact name through the alias', () => {
    expect(renderMergeTags('Hi {{Customer Name}}', ctx()).rendered).toBe('Hi Aarav Sharma');
    expect(renderMergeTags('{{ full_name }}', ctx()).rendered).toBe('Aarav Sharma');
    expect(renderMergeTags('{{first}} {{surname}}', ctx()).rendered).toBe('Aarav Sharma');
  });

  it('TW-CON-048 #2: a contact value beats the attribute default; a contact without one gets the default', () => {
    const base = ctx({ attributeDefaults: new Map([['city', 'N/A']]) });
    expect(
      renderMergeTags('{{city}}', { ...base, contact: contact({ data: { city: 'Pune' } }) })
        .rendered,
    ).toBe('Pune');
    expect(renderMergeTags('{{city}}', base).rendered).toBe('N/A');
    // an empty stored value is skipped, like a missing one
    expect(
      renderMergeTags('{{city}}', { ...base, contact: contact({ data: { city: '  ' } }) }).rendered,
    ).toBe('N/A');
  });

  it('TW-CON-048 #3: an unknown token renders as an empty string, never the braces', () => {
    const r = renderMergeTags('a{{foo}}b', ctx());
    expect(r.rendered).toBe('ab');
    expect(r.tokens[0]).toMatchObject({ resolved: false, source: 'unresolved' });
  });

  it('TW-CON-048 #4: business_name and company_name come from the system values', () => {
    expect(renderMergeTags('{{business_name}}|{{brand}}|{{company_name}}', ctx()).rendered).toBe(
      'Geta|Geta|Geta Inc',
    );
    expect(renderMergeTags('{{today}}', ctx()).rendered).toBe('2026-10-01');
  });

  it('a contact column wins over a custom attribute of the same key', () => {
    const c = ctx({ contact: contact({ data: { email: 'other@example.com' } }) });
    expect(renderMergeTags('{{email}}', c).rendered).toBe('aarav@example.com');
  });

  it('phone is the digits with country code; mobile is the local part', () => {
    expect(renderMergeTags('{{phone_number}}', ctx()).rendered).toBe('919812345678');
    expect(renderMergeTags('{{mobile}}', ctx()).rendered).toBe('9812345678');
    expect(renderMergeTags('{{country_code}}', ctx()).rendered).toBe('+91');
  });

  it('groups render as names, not ids (Reference printed the ids)', () => {
    expect(renderMergeTags('{{groups}}', ctx()).rendered).toBe('VIP, New leads');
  });

  it('matches custom attribute keys after normalisation and flattens arrays', () => {
    const c = ctx({ contact: contact({ data: { 'Order ID': 'A12', tags: ['a', 'b'] } }) });
    expect(renderMergeTags('{{order_id}} {{tags}}', c).rendered).toBe('A12 a, b');
  });

  it('with no contact (a preview with defaults only) only defaults and system tokens resolve', () => {
    const c = ctx({ contact: undefined, attributeDefaults: new Map([['promo', 'SAVE']]) });
    expect(renderMergeTags('{{promo}}/{{name}}/{{business_name}}', c).rendered).toBe('SAVE//Geta');
  });

  it('reports where every token came from', () => {
    const c = ctx({
      contact: contact({ data: { city: 'Pune' } }),
      attributeDefaults: new Map([['promo', 'SAVE']]),
    });
    const r = renderMergeTags('{{name}}{{city}}{{promo}}{{today}}{{nope}}', c);
    expect(r.tokens.map((t) => t.source)).toEqual([
      'contact',
      'contact_attribute',
      'attribute_default',
      'system',
      'unresolved',
    ]);
  });

  it('resolveToken exposes the canonical key', () => {
    expect(resolveToken('Phone Number', ctx()).key).toBe('phone');
    expect(normalizeMergeKey(' E-Mail ')).toBe('e_mail');
  });
});

describe('positional placeholder validator (TW-CON-049)', () => {
  it('TW-CON-049 #1: "Hi {{1}}, code {{3}}" is invalid', () => {
    expect(validatePositionalPlaceholders('Hi {{1}}, code {{3}}')).toBe(false);
  });
  it('TW-CON-049 #2: "{{2}} {{1}}" is valid', () => {
    expect(validatePositionalPlaceholders('{{2}} {{1}}')).toBe(true);
  });
  it('TW-CON-049 #3: named tokens are ignored', () => {
    expect(validatePositionalPlaceholders('Hi {{name}}')).toBe(true);
  });
  it('empty or missing bodies are valid; must start at 1; repeats are fine; inner spaces allowed', () => {
    expect(validatePositionalPlaceholders(null)).toBe(true);
    expect(validatePositionalPlaceholders('')).toBe(true);
    expect(validatePositionalPlaceholders('{{2}}')).toBe(false);
    expect(validatePositionalPlaceholders('{{1}} {{1}}')).toBe(true);
    expect(validatePositionalPlaceholders('{{ 1 }} {{ 2 }}')).toBe(true);
    expect(POSITIONAL_PLACEHOLDER_MESSAGE).toContain('1-based and contiguous');
  });
});

describe('attribute definitions (TW-CON-043, 044, 046)', () => {
  it('TW-CON-043 #4: the key "order id" (a space) is rejected', () => {
    expect(createAttributeSchema.safeParse({ name: 'Order ID', key: 'order id' }).success).toBe(
      false,
    );
  });

  it('TW-CON-043: a key is lowercase letters, digits, underscores, starting with a letter, 64 at most', () => {
    expect(ATTRIBUTE_KEY_PATTERN.test('order_id')).toBe(true);
    for (const bad of ['Order_ID', '1order', '_x', 'a-b', 'ünï', 'x'.repeat(65), '']) {
      expect(ATTRIBUTE_KEY_PATTERN.test(bad), bad).toBe(false);
    }
    expect(ATTRIBUTE_KEY_PATTERN.test('x'.repeat(64))).toBe(true);
  });

  it('TW-CON-043 #3: Active is an explicit boolean that can be false (Reference read an unticked box as true)', () => {
    const r = createAttributeSchema.parse({ name: 'Order ID', key: 'order_id', isActive: false });
    expect(r.isActive).toBe(false);
    expect(createAttributeSchema.parse({ name: 'Order ID', key: 'order_id' }).isActive).toBe(true);
    expect(updateAttributeSchema.parse({ isActive: false, rowVersion: 1 }).isActive).toBe(false);
  });

  it('TW-CON-043: limits on name (120), default (255), description (500)', () => {
    const base = { name: 'x', key: 'x' };
    expect(createAttributeSchema.safeParse({ ...base, name: 'n'.repeat(121) }).success).toBe(false);
    expect(
      createAttributeSchema.safeParse({ ...base, defaultValue: 'd'.repeat(256) }).success,
    ).toBe(false);
    expect(createAttributeSchema.safeParse({ ...base, description: 'd'.repeat(501) }).success).toBe(
      false,
    );
  });

  it('TW-CON-046 #1: the built-in list has 10 entries, and every one of them is a reserved key', () => {
    expect(SYSTEM_ATTRIBUTES).toHaveLength(10);
    for (const a of SYSTEM_ATTRIBUTES) expect(RESERVED_ATTRIBUTE_KEYS.has(a.key)).toBe(true);
    for (const k of [
      'status',
      'source',
      'phone',
      'mobile',
      'groups',
      'memo',
      'lifecycle_stage',
      'opt_out',
    ]) {
      expect(RESERVED_ATTRIBUTE_KEYS.has(k), k).toBe(true);
    }
  });

  it('an update never carries the key or the type: the schema drops them', () => {
    const r = updateAttributeSchema.parse({ name: 'X', key: 'other', type: 'date', rowVersion: 1 });
    expect(r).not.toHaveProperty('key');
    expect(r).not.toHaveProperty('type');
  });

  it('an update needs the row version (optimistic lock)', () => {
    expect(updateAttributeSchema.safeParse({ name: 'X' }).success).toBe(false);
  });
});

describe('company merge tags (BL-196)', () => {
  const company = {
    name: 'Acme Ltd',
    website: 'acme.example',
    email: 'hello@acme.example',
    phone: '+911234567890',
    industry: 'Logistics',
    sizeRange: '51-200',
    address: 'Pune',
    notes: 'internal: pays late',
    data: { tier: 'gold', annual_revenue: 120000, channels: ['email', 'sms'], vip: true },
  };
  const withCompany = (over: Partial<MergeContact> = {}) =>
    ctx({ contact: contact({ company, ...over }) });

  it('resolves a built-in column of the contact company, with the dot or the underscore', () => {
    expect(
      renderMergeTags('{{company.industry}} / {{company_website}}', withCompany()).rendered,
    ).toBe('Logistics / acme.example');
    expect(renderMergeTags('{{ Company.Size }}', withCompany()).rendered).toBe('51-200');
  });

  it('resolves a company property by key, whatever its type', () => {
    const r = renderMergeTags(
      '{{company.tier}} {{company.annual_revenue}} {{company.channels}} {{company.vip}}',
      withCompany(),
    );
    expect(r.rendered).toBe('gold 120000 email, sms true');
    expect(r.tokens.every((t) => t.source === 'company' && t.resolved)).toBe(true);
  });

  it('{{company}} and {{contact.company}} are the name of the contact company', () => {
    expect(renderMergeTags('{{company}} {{contact.company}}', withCompany()).rendered).toBe(
      'Acme Ltd Acme Ltd',
    );
  });

  it('company_name stays the sender business name, as it always was (TW-CON-048)', () => {
    expect(renderMergeTags('{{company_name}} {{company.name}}', withCompany()).rendered).toBe(
      'Geta Inc Geta Inc',
    );
  });

  it('never prints the internal notes of a company', () => {
    expect(renderMergeTags('[{{company.notes}}]', withCompany()).rendered).toBe('[]');
  });

  it('a contact with no company, or a company with no value, gets the empty string, never the braces', () => {
    expect(renderMergeTags('[{{company.industry}}][{{company}}]', ctx()).rendered).toBe('[][]');
    const bare = { ...company, industry: null, data: {} };
    expect(
      renderMergeTags('[{{company.industry}}][{{company.tier}}]', withCompany({ company: bare }))
        .rendered,
    ).toBe('[][]');
  });

  it('the contact own attribute of the same name wins over the company one', () => {
    expect(
      renderMergeTags('{{company}}', withCompany({ data: { company: 'Self employed' } })).rendered,
    ).toBe('Self employed');
  });
});
