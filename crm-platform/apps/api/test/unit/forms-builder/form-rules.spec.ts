import { describe, expect, it } from 'vitest';
import { formDefinitionSchema, type FormDefinitionInput } from '@crm/contracts';
import {
  asText,
  cleanText,
  companyHostFromEmail,
  contactDisplayName,
  isFreeMailDomain,
  mapAnswers,
  validateSubmission,
} from '../../../src/modules/forms-builder/form-rules';

const f = (id: string, kind: string, over: Record<string, unknown> = {}) => ({
  id,
  type: 'field',
  kind,
  label: id,
  ...over,
});
const make = (blocks: unknown[], settings: Record<string, unknown> = {}) =>
  formDefinitionSchema.parse({
    title: 'T',
    steps: [{ id: 'step', blocks }],
    settings,
  } as FormDefinitionInput);
const codes = (r: ReturnType<typeof validateSubmission>) =>
  r.issues.map((i) => `${i.fieldId}:${i.code}`);

describe('validateSubmission (spec 9.1 step 4)', () => {
  it('drops answers to fields the form does not have and never reads a hidden field from the answers', () => {
    const d = make([f('a', 'short_text'), f('src', 'hidden', { hiddenSource: 'utm_source' })]);
    const r = validateSubmission(
      d,
      { a: 'x', ghost: 'y', src: 'FORGED' },
      { utm_source: 'google' },
    );
    expect(r.values).toEqual({ a: 'x', src: 'google' });
  });

  it('a constant hidden field takes the form value, a blank source is absent', () => {
    const d = make([
      f('k', 'hidden', { hiddenSource: 'constant', constant: 'spring-2026' }),
      f('r', 'hidden', { hiddenSource: 'referrer' }),
    ]);
    expect(validateSubmission(d, {}, {}).values).toEqual({ k: 'spring-2026' });
  });

  it('required: blank, whitespace, empty list and an unticked box are all missing', () => {
    const d = make([
      f('t', 'short_text', { required: true }),
      f('g', 'checkbox_group', { required: true, options: [{ value: 'a', label: 'A' }] }),
      f('c', 'checkbox', { required: true }),
    ]);
    expect(codes(validateSubmission(d, { t: '   ', g: [], c: false }, {}))).toEqual([
      't:required',
      'g:required',
      'c:required',
    ]);
    expect(validateSubmission(d, { t: 'x', g: ['a'], c: true }, {}).issues).toEqual([]);
  });

  it('text: trims, strips control characters, holds min and max length and the pattern', () => {
    const d = make([
      f('t', 'short_text', { validation: { minLen: 3, maxLen: 5, pattern: '^[a-z]+$' } }),
    ]);
    expect(validateSubmission(d, { t: '  abcd ' }, {}).values.t).toBe('abcd');
    expect(codes(validateSubmission(d, { t: 'ab' }, {}))).toEqual(['t:too_short']);
    expect(codes(validateSubmission(d, { t: 'abcdef' }, {}))).toEqual(['t:too_long']);
    expect(codes(validateSubmission(d, { t: 'ab1' }, {}))).toEqual(['t:pattern']);
    expect(cleanText('a\u0000b\u0007c', false)).toBe('abc');
    expect(cleanText('line1\nline2', true)).toBe('line1\nline2');
    expect(cleanText('line1\nline2', false)).toBe('line1line2');
  });

  it('a value too long for a short text is refused before any pattern runs', () => {
    const d = make([f('t', 'short_text', { validation: { pattern: '^[a-z]+$' } })]);
    expect(codes(validateSubmission(d, { t: 'a'.repeat(501) }, {}))).toEqual(['t:too_long']);
  });

  it('email: lower-cased, shape checked', () => {
    const d = make([f('e', 'email')]);
    expect(validateSubmission(d, { e: ' Ada@Example.COM ' }, {}).values.e).toBe('ada@example.com');
    for (const bad of ['ada', 'ada@', '@x.com', 'a b@x.com', 'ada@x']) {
      expect(codes(validateSubmission(d, { e: bad }, {})), bad).toEqual(['e:invalid_email']);
    }
  });

  it('phone: read to E.164 with the form country code; an ambiguous number is refused', () => {
    const d = make([f('p', 'phone')], { phoneCountryCode: '91' });
    expect(validateSubmission(d, { p: '98765 43210' }, {}).values.p).toBe('+919876543210');
    expect(validateSubmission(d, { p: '+44 7700 900123' }, {}).values.p).toBe('+447700900123');
    expect(codes(validateSubmission(d, { p: 'call me' }, {}))).toEqual(['p:invalid_phone']);
    const noCc = make([f('p', 'phone')]);
    expect(codes(validateSubmission(noCc, { p: '9876543210' }, {}))).toEqual(['p:invalid_phone']);
  });

  it('number, currency and rating: coerced, bounded', () => {
    const d = make([
      f('n', 'number', { validation: { min: 1, max: 10 } }),
      f('c', 'currency'),
      f('r', 'rating'),
    ]);
    expect(validateSubmission(d, { n: '7', c: '19.999', r: 4 }, {}).values).toEqual({
      n: 7,
      c: 20,
      r: 4,
    });
    expect(codes(validateSubmission(d, { n: 0 }, {}))).toEqual(['n:too_small']);
    expect(codes(validateSubmission(d, { n: 11 }, {}))).toEqual(['n:too_large']);
    expect(codes(validateSubmission(d, { n: 'abc' }, {}))).toEqual(['n:invalid_number']);
    expect(codes(validateSubmission(d, { r: 6 }, {}))).toEqual(['r:invalid_number']);
    expect(codes(validateSubmission(d, { r: 2.5 }, {}))).toEqual(['r:invalid_number']);
    expect(codes(validateSubmission(d, { c: 1e15 }, {}))).toEqual(['c:invalid_number']);
  });

  it('date: a real calendar day only', () => {
    const d = make([f('d', 'date')]);
    expect(validateSubmission(d, { d: '2026-10-05' }, {}).values.d).toBe('2026-10-05');
    for (const bad of ['2026-02-31', '05/10/2026', '2026-10-05T10:00:00Z', 'tomorrow']) {
      expect(codes(validateSubmission(d, { d: bad }, {})), bad).toEqual(['d:invalid_date']);
    }
  });

  it('dropdown, radio and checkbox group: only the listed options', () => {
    const opts = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ];
    const d = make([
      f('s', 'dropdown', { options: opts }),
      f('g', 'checkbox_group', { options: opts }),
    ]);
    expect(validateSubmission(d, { s: 'a', g: ['a', 'b', 'a'] }, {}).values).toEqual({
      s: 'a',
      g: ['a', 'b'],
    });
    expect(codes(validateSubmission(d, { s: 'zzz' }, {}))).toEqual(['s:invalid_option']);
    expect(codes(validateSubmission(d, { g: ['a', 'zzz'] }, {}))).toEqual(['g:invalid_option']);
    expect(codes(validateSubmission(d, { g: 'a' }, {}))).toEqual(['g:invalid_option']);
    expect(codes(validateSubmission(d, { g: [1] }, {}))).toEqual(['g:invalid_option']);
  });

  it('an optional blank answer is simply absent', () => {
    const d = make([f('t', 'short_text'), f('e', 'email')]);
    expect(validateSubmission(d, { t: '', e: null }, {})).toEqual({ values: {}, issues: [] });
  });

  it('every problem is reported at once', () => {
    const d = make([f('a', 'short_text', { required: true }), f('b', 'email', { required: true })]);
    expect(codes(validateSubmission(d, {}, {}))).toEqual(['a:required', 'b:required']);
  });
});

describe('mapAnswers (spec 9.3)', () => {
  const d = make([
    f('first', 'short_text', { bind: { object: 'contact', property: 'first_name' } }),
    f('last', 'short_text', { bind: { object: 'contact', property: 'last_name' } }),
    f('mail', 'email', { bind: { object: 'contact', property: 'email' } }),
    f('budget', 'number', { bind: { object: 'contact', property: 'budget' } }),
    f('interests', 'checkbox_group', {
      options: [{ value: 'x', label: 'X' }],
      bind: { object: 'contact', property: 'interests' },
    }),
    f('co', 'short_text', { bind: { object: 'company', property: 'name' } }),
    f('site', 'short_text', { bind: { object: 'company', property: 'domain' } }),
    f('free', 'short_text'),
  ]);
  const values = {
    first: 'Ada',
    last: 'Lovelace',
    mail: 'ada@acme.com',
    budget: 5000,
    interests: ['x'],
    co: 'Acme',
    site: 'acme.com',
    free: 'note',
  };

  it('splits values by object and by built-in versus custom property; an unbound field stays in the submission only', () => {
    const m = mapAnswers(d, values);
    expect(m.contact.builtin).toEqual({
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'ada@acme.com',
    });
    expect(m.contact.custom).toEqual({ budget: '5000', interests: 'x' });
    expect(m.company.builtin).toEqual({ name: 'Acme', domain: 'acme.com' });
    expect(JSON.stringify(m)).not.toContain('note');
  });

  it('joins first and last name when no full name is bound, and prefers a bound full name', () => {
    expect(contactDisplayName(mapAnswers(d, values).contact)).toEqual({
      name: 'Ada Lovelace',
      first: 'Ada',
      last: 'Lovelace',
    });
    const full = make([f('n', 'short_text', { bind: { object: 'contact', property: 'name' } })]);
    expect(contactDisplayName(mapAnswers(full, { n: 'Dr. Ada' }).contact).name).toBe('Dr. Ada');
    expect(contactDisplayName({ builtin: {}, custom: {} }).name).toBeNull();
  });

  it('asText: lists comma-joined, a ticked box true', () => {
    expect(asText(['a', 'b'])).toBe('a,b');
    expect(asText(true)).toBe('true');
    expect(asText(12.5)).toBe('12.5');
  });
});

describe('company from the email domain (spec 9.3)', () => {
  it('a business address implies its domain; free mail and malformed values do not', () => {
    expect(companyHostFromEmail('ada@Acme.com')).toBe('acme.com');
    expect(companyHostFromEmail('ada@gmail.com')).toBeNull();
    expect(companyHostFromEmail('ada@yahoo.co.in')).toBeNull();
    expect(companyHostFromEmail('ada')).toBeNull();
    expect(companyHostFromEmail(null)).toBeNull();
    expect(isFreeMailDomain('Outlook.com')).toBe(true);
    expect(isFreeMailDomain('acme.com')).toBe(false);
  });
});
