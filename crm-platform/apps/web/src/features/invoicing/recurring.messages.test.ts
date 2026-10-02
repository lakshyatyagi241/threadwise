import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTranslator } from 'next-intl';
import { RECURRING_FREQUENCIES, RECURRING_MODES, RECURRING_STATUSES, RECURRING_RUN_STATUSES } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { RECURRING_ERROR_CODES, RECURRING_TABS, SEND_CHANNELS, type RecurringProblem } from './lib/recurring';
import type { Problem } from './lib/builder';
import { missingKeys } from './test-messages';

/** Every problem the template editor can show (the dates are not part of a template). */
const TEMPLATE_PROBLEMS: Exclude<Problem, 'issueDateInvalid' | 'dueBeforeIssue' | 'dueInvalid'>[] = [
  'descriptionRequired',
  'qtyInvalid',
  'priceInvalid',
  'lineDiscountInvalid',
  'hsnRequired',
  'hsnInvalid',
  'taxRateRemoved',
  'currencyInvalid',
  'noLines',
  'discountInvalid',
  'shippingInvalid',
  'emailInvalid',
  'amountZero',
  'amountInvalid',
  'contactRequired',
  'countryInvalid',
  'regionInvalid',
  'autoNeedsSellerCountry',
];
const SCHEDULE_PROBLEMS: RecurringProblem[] = [
  'nameRequired',
  'nameTooLong',
  'intervalInvalid',
  'startInvalid',
  'startTooOld',
  'endInvalid',
  'endBeforeStart',
  'maxRunsInvalid',
  'invoiceRequired',
  'termsInvalid',
];

describe('recurring messages built at run time (English and Arabic)', () => {
  it('has every frequency, mode, status, tab, channel and outcome', () => {
    expect(
      missingKeys([
        ...RECURRING_FREQUENCIES.flatMap((f) => [`recurring.every.${f}`, `recurring.frequency.${f}`]),
        ...RECURRING_MODES.flatMap((m) => [
          `recurring.modeShort.${m}`,
          `recurring.modeCards.${m}.title`,
          `recurring.modeCards.${m}.hint`,
          `recurring.runNow.message.${m}`,
        ]),
        ...RECURRING_STATUSES.map((s) => `recurring.status.${s}`),
        ...RECURRING_RUN_STATUSES.map((s) => `recurring.runStatus.${s}`),
        ...RECURRING_TABS.flatMap((tab) => [`recurring.tabs.${tab}`, `recurring.empty.${tab}.title`, `recurring.empty.${tab}.message`]),
        ...SEND_CHANNELS.flatMap((c) => [`recurring.channel.${c}`, `recurring.modeSent.${c}`]),
        'recurring.preview.outcome.draft',
        'recurring.preview.outcome.issue',
        'recurring.preview.outcome.issue_email',
        'recurring.preview.outcome.issue_link',
        'recurring.preview.outcome.issue_whatsapp',
      ]),
    ).toEqual([]);
  });

  it('has a sentence for every problem the form can show', () => {
    expect(missingKeys([...TEMPLATE_PROBLEMS, ...SCHEDULE_PROBLEMS, 'generic' as const].map((p) => `recurring.problems.${p}`))).toEqual([]);
  });

  it('has the API error codes the screens can hit', () => {
    expect(
      missingKeys(RECURRING_ERROR_CODES.map((c) => `errors.codes.${c}`)),
    ).toEqual([]);
  });
});

const load = (locale: 'en' | 'ar') =>
  JSON.parse(readFileSync(join(process.cwd(), 'messages', locale, 'invoicing.x-recurring.json'), 'utf8')) as {
    invoicing: { recurring: Record<string, unknown> };
  };
type Say = (key: string, values?: Record<string, string | number>) => string;
const translator = (locale: 'en' | 'ar'): Say =>
  createTranslator({ locale, messages: load(locale).invoicing.recurring as never }) as unknown as Say;

describe('the schedule sentence renders in both languages', () => {
  const en = translator('en');
  const ar = translator('ar');

  it('says "Every month" with its limit and outcome', () => {
    const limit = en('preview.sentenceLimit', { kind: 'runs', count: 12, end: '' });
    expect(limit).toBe(', 12 invoices');
    expect(en('preview.sentence', { every: en('every.month', { interval: 1 }), start: '31 Jan 2026', limit, outcome: en('preview.outcome.issue_email') })).toBe(
      'Every month from 31 Jan 2026, 12 invoices. Each invoice is issued and emailed to the buyer.',
    );
    expect(en('every.week', { interval: 3 })).toBe('Every 3 weeks');
    expect(en('preview.sentenceLimit', { kind: 'none', count: 0, end: '' })).toBe('');
    expect(en('preview.sentenceLimit', { kind: 'both', count: 1, end: '1 Jun 2027' })).toBe(', 1 invoice, until 1 Jun 2027');
    expect(en('preview.sentenceLimit', { kind: 'end', count: 0, end: '1 Jun 2027' })).toBe(', until 1 Jun 2027');
  });

  it('uses Arabic plural forms for the interval', () => {
    expect(ar('every.month', { interval: 1 })).toBe('كل شهر');
    expect(ar('every.month', { interval: 2 })).toBe('كل شهرين');
    expect(ar('every.month', { interval: 3 })).toContain('أشهر');
    expect(ar('every.month', { interval: 11 })).toContain('شهرًا');
    expect(ar('preview.sentenceLimit', { kind: 'runs', count: 12, end: '' })).toContain('فاتورة');
    expect(ar('preview.sentenceLimit', { kind: 'none', count: 0, end: '' })).toBe('');
  });
});
