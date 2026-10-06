import { describe, expect, it } from 'vitest';
import { definition, field } from '../test-fixtures';
import { buildPayload, hiddenValues } from './submit';
import { answersForSubmit, cleanText, fieldIssue, isBlank, validateAnswers } from './validate';
import { CONSENT_KEY } from './types';

const f = (over: Parameters<typeof field>[0]) => field(over);

describe('fieldIssue', () => {
  it('requires a value only when the field is required', () => {
    expect(
      fieldIssue(f({ id: 'a', kind: 'short_text', label: 'A', required: true }), '  '),
    ).toEqual({ fieldId: 'a', code: 'required' });
    expect(fieldIssue(f({ id: 'a', kind: 'short_text', label: 'A' }), '')).toBeNull();
    expect(fieldIssue(f({ id: 'a', kind: 'checkbox', label: 'A', required: true }), false)).toEqual(
      { fieldId: 'a', code: 'required' },
    );
    expect(
      fieldIssue(
        f({
          id: 'a',
          kind: 'checkbox_group',
          label: 'A',
          required: true,
          options: [{ value: 'x', label: 'X' }],
        }),
        [],
      ),
    ).toEqual({ fieldId: 'a', code: 'required' });
  });

  it('checks an email and a phone number', () => {
    const email = f({ id: 'e', kind: 'email', label: 'E' });
    expect(fieldIssue(email, 'a@b.co')).toBeNull();
    expect(fieldIssue(email, 'not-an-email')).toEqual({ fieldId: 'e', code: 'invalid_email' });
    const phone = f({ id: 'p', kind: 'phone', label: 'P' });
    expect(fieldIssue(phone, '+91 98765 43210')).toBeNull();
    expect(fieldIssue(phone, '(020) 7946-0958')).toBeNull();
    expect(fieldIssue(phone, '12')).toEqual({ fieldId: 'p', code: 'invalid_phone' });
    expect(fieldIssue(phone, 'call me')).toEqual({ fieldId: 'p', code: 'invalid_phone' });
  });

  it('checks numbers against the range', () => {
    const n = f({ id: 'n', kind: 'number', label: 'N', validation: { min: 1, max: 10 } });
    expect(fieldIssue(n, '5')).toBeNull();
    expect(fieldIssue(n, '0')).toEqual({ fieldId: 'n', code: 'too_small' });
    expect(fieldIssue(n, '11')).toEqual({ fieldId: 'n', code: 'too_large' });
    expect(fieldIssue(n, 'abc')).toEqual({ fieldId: 'n', code: 'invalid_number' });
    expect(fieldIssue(f({ id: 'c', kind: 'currency', label: 'C' }), '12.50')).toBeNull();
  });

  it('checks an option is one of the listed ones', () => {
    const d = f({ id: 'd', kind: 'dropdown', label: 'D', options: [{ value: 'x', label: 'X' }] });
    expect(fieldIssue(d, 'x')).toBeNull();
    expect(fieldIssue(d, 'y')).toEqual({ fieldId: 'd', code: 'invalid_option' });
    const g = f({
      id: 'g',
      kind: 'checkbox_group',
      label: 'G',
      options: [{ value: 'x', label: 'X' }],
    });
    expect(fieldIssue(g, ['x'])).toBeNull();
    expect(fieldIssue(g, ['x', 'z'])).toEqual({ fieldId: 'g', code: 'invalid_option' });
  });

  it('checks text length and pattern, and does not choke on a broken pattern', () => {
    const t = f({
      id: 't',
      kind: 'short_text',
      label: 'T',
      validation: { minLen: 3, maxLen: 5, pattern: '^[a-z]+$' },
    });
    expect(fieldIssue(t, 'abcd')).toBeNull();
    expect(fieldIssue(t, 'ab')).toEqual({ fieldId: 't', code: 'too_short' });
    expect(fieldIssue(t, 'abcdef')).toEqual({ fieldId: 't', code: 'too_long' });
    expect(fieldIssue(t, 'ab1d')).toEqual({ fieldId: 't', code: 'pattern' });
    expect(
      fieldIssue(f({ id: 'b', kind: 'short_text', label: 'B', validation: { pattern: '(' } }), 'x'),
    ).toBeNull();
  });

  it('checks a date and a rating', () => {
    expect(fieldIssue(f({ id: 'd', kind: 'date', label: 'D' }), '2026-10-05')).toBeNull();
    expect(fieldIssue(f({ id: 'd', kind: 'date', label: 'D' }), '05/10/2026')).toEqual({
      fieldId: 'd',
      code: 'invalid_date',
    });
    const r = f({ id: 'r', kind: 'rating', label: 'R', validation: { min: 1, max: 5 } });
    expect(fieldIssue(r, '5')).toBeNull();
    expect(fieldIssue(r, '6')).toEqual({ fieldId: 'r', code: 'invalid_number' });
  });

  it('never asks a visitor for a hidden field', () => {
    expect(
      fieldIssue(f({ id: 'h', kind: 'hidden', label: 'H', required: true }), undefined),
    ).toBeNull();
  });

  it('tells blank values apart', () => {
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank(false)).toBe(true);
    expect(isBlank('x')).toBe(false);
    expect(isBlank(true)).toBe(false);
    expect(isBlank(['a'])).toBe(false);
  });
});

describe('validateAnswers', () => {
  const d = definition();

  it('lists every problem in the form order', () => {
    expect(validateAnswers(d, {}).map((i) => i.fieldId)).toEqual(['f_name', 'f_email']);
    expect(validateAnswers(d, { f_name: 'Asha', f_email: 'bad' })).toEqual([
      { fieldId: 'f_email', code: 'invalid_email' },
    ]);
    expect(validateAnswers(d, { f_name: 'Asha', f_email: 'asha@example.com' })).toEqual([]);
  });

  it('wants the consent box ticked only when the form asks for it', () => {
    const asks = definition({ consent: { enabled: true, text: 'OK', required: true } });
    const answers = { f_name: 'Asha', f_email: 'asha@example.com' };
    expect(validateAnswers(asks, answers)).toEqual([
      { fieldId: CONSENT_KEY, code: 'consent_required' },
    ]);
    expect(validateAnswers(asks, { ...answers, [CONSENT_KEY]: true })).toEqual([]);
    const optional = definition({ consent: { enabled: true, text: 'OK', required: false } });
    expect(validateAnswers(optional, answers)).toEqual([]);
  });

  it('can look at one step only', () => {
    expect(validateAnswers(d, {}, 0)).toHaveLength(2);
    expect(validateAnswers(d, {}, 5)).toEqual([]);
  });
});

describe('what is sent', () => {
  const d = definition({
    steps: [
      {
        id: 's',
        blocks: [
          f({ id: 'f_name', kind: 'short_text', label: 'Name' }),
          f({ id: 'f_n', kind: 'number', label: 'N' }),
          f({
            id: 'f_g',
            kind: 'checkbox_group',
            label: 'G',
            options: [{ value: 'x', label: 'X' }],
          }),
          f({ id: 'f_box', kind: 'checkbox', label: 'Box' }),
          f({ id: 'f_h', kind: 'hidden', label: 'H', hiddenSource: 'utm_source' }),
        ],
      },
    ],
  });

  it('drops blanks, trims and cleans text, sends numbers as numbers and never a hidden field', () => {
    const out = answersForSubmit(d, {
      f_name: '  Asha\u0000 ',
      f_n: '12.5',
      f_g: ['x'],
      f_box: true,
      f_h: 'tamper',
      gone: 'x',
    });
    expect(out).toEqual({ f_name: 'Asha', f_n: 12.5, f_g: ['x'], f_box: true });
    expect(answersForSubmit(d, { f_name: '   ', f_box: false })).toEqual({});
    expect(cleanText('a\u0007b\nc\td')).toBe('ab\nc\td');
  });

  it('reads tracking values from the address and referrer, clipped', () => {
    const h = hiddenValues({
      search: '?utm_source=news&utm_campaign=autumn&other=1',
      referrer: 'https://google.com/',
      href: 'https://app.example.com/f/K?utm_source=news#frag',
    });
    expect(h).toEqual({
      utm_source: 'news',
      utm_campaign: 'autumn',
      referrer: 'https://google.com/',
      page_url: 'https://app.example.com/f/K?utm_source=news',
    });
    expect(hiddenValues({ search: '', referrer: '', href: '' })).toEqual({});
    expect(
      hiddenValues({ search: `?utm_term=${'x'.repeat(400)}`, referrer: '', href: '' }).utm_term,
    ).toHaveLength(255);
  });

  it('builds the submit body: consent, honeypot, timing and the idempotency key', () => {
    const asks = definition({ consent: { enabled: true, text: 'OK', required: true, version: 4 } });
    const body = buildPayload(
      asks,
      { f_name: 'A', [CONSENT_KEY]: true },
      {
        idempotencyKey: 'abcdef0123456789',
        hp: '',
        startedAt: Date.now() - 5500,
        page: { search: '', referrer: '', href: 'https://x.test/f/K' },
      },
    );
    expect(body).toMatchObject({
      idempotencyKey: 'abcdef0123456789',
      consent: { given: true, textVersion: 4 },
    });
    expect(body.elapsedMs).toBeGreaterThanOrEqual(5500);
    expect(body.elapsedMs).toBeLessThan(7000);
    expect(body.hp).toBeUndefined();
    expect(body.captchaToken).toBeUndefined();
    const bot = buildPayload(
      asks,
      {},
      {
        idempotencyKey: 'abcdef0123456789',
        hp: 'spam',
        startedAt: 0,
        page: { search: '', referrer: '', href: '' },
        captchaToken: 'tok',
      },
    );
    expect(bot).toMatchObject({ hp: 'spam', captchaToken: 'tok', consent: { given: false } });
    const noConsent = buildPayload(
      d,
      {},
      {
        idempotencyKey: 'abcdef0123456789',
        hp: '',
        startedAt: 0,
        page: { search: '', referrer: '', href: '' },
      },
    );
    expect(noConsent.consent).toBeUndefined();
  });
});
