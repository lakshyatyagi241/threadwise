import { describe, expect, it } from 'vitest';
import type { AdjustWalletResult, RateRow } from '@crm/contracts';
import {
  EMPTY_ADJUST,
  checkAdjust,
  keyFor,
  outcomeOf,
  previewBalance,
  signatureOf,
  willBeCapped,
} from './lib/adjust';
import { billingVariant, humanizeSource } from './lib/billing-variant';
import { errorKind } from './lib/errors';
import { fileNameFromDisposition } from './lib/download';
import {
  QUICK_ADD_UNITS,
  currencySymbol,
  directionSign,
  directionTone,
  formatMinor,
  formatMovement,
  formatNet,
  parseAmount,
  parseTopupUnits,
  topupHref,
} from './lib/money';
import {
  EMPTY_DRAFT,
  MAX_ROWS_PER_SAVE,
  addRow,
  afterSave,
  editField,
  gridRows,
  marginOf,
  planSave,
  removeAdded,
  rowProblem,
} from './lib/rate-grid';
import {
  checkSettings,
  messagesPer100,
  rewardMessages,
  settingsDirty,
  toDraft,
} from './lib/settings-form';
import {
  EMPTY_FILTERS,
  hasFilters,
  parseFilters,
  rangeInverted,
  toApiQuery,
  toSearch,
} from './lib/statement-filters';
import { ApiError } from '@/lib/api/errors';

describe('money helpers', () => {
  it('prints hundredths exactly, in the wallet currency', () => {
    expect(formatMinor(123456, 'USD', 'en')).toBe('$1,234.56');
    expect(formatMinor(5, 'USD', 'en')).toBe('$0.05');
    expect(formatMinor(0, 'USD', 'en')).toBe('$0.00');
    // a currency the browser does not know falls back to its code
    expect(formatMinor(250, 'ZZZ', 'en')).toContain('2.50');
  });

  it('reads a typed amount as hundredths and refuses what is not a plain amount', () => {
    expect(parseAmount('250')).toBe(25000);
    expect(parseAmount(' 250.5 ')).toBe(25050);
    expect(parseAmount('0.07')).toBe(7);
    expect(parseAmount('250.555')).toBeNull();
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('1e3')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });

  it('accepts only whole top-up amounts of at least 1', () => {
    expect(parseTopupUnits('1000')).toBe(1000);
    expect(parseTopupUnits(' 5 ')).toBe(5);
    expect(parseTopupUnits('0')).toBeNull();
    expect(parseTopupUnits('12.5')).toBeNull();
    expect(parseTopupUnits('')).toBeNull();
    expect(parseTopupUnits('123456789')).toBeNull();
  });

  it('links the quick amounts to the existing wallet checkout', () => {
    expect(topupHref('/billing/checkout/wallet', 500)).toBe('/billing/checkout/wallet?amount=500');
    expect(QUICK_ADD_UNITS).toEqual([500, 1000, 2000, 5000]);
  });

  it('shows the currency symbol or falls back to the code', () => {
    expect(currencySymbol('USD', 'en')).toBe('$');
    expect(currencySymbol('ZZZ', 'en')).toBeTruthy();
  });

  it('signs a movement by its direction, never by the stored sign', () => {
    // Reference stored charges positive and showed them as money in; the sign here follows the direction alone
    expect(directionSign('out')).toBe('-');
    expect(directionSign('in')).toBe('+');
    expect(directionTone('out')).toBe('danger');
    expect(directionTone('in')).toBe('success');
    expect(formatMovement(-1250, 'out', 'USD', 'en')).toBe('-$12.50');
    expect(formatMovement(1250, 'out', 'USD', 'en')).toBe('-$12.50');
    expect(formatMovement(1250, 'in', 'USD', 'en')).toBe('+$12.50');
  });

  it('signs the net figure', () => {
    expect(formatNet(500, 'USD', 'en')).toBe('+$5.00');
    expect(formatNet(-500, 'USD', 'en')).toBe('-$5.00');
    expect(formatNet(0, 'USD', 'en')).toBe('$0.00');
  });

  it('reads the file name from a download header', () => {
    expect(fileNameFromDisposition('attachment; filename="wallet-2026.csv"', 'x.csv')).toBe(
      'wallet-2026.csv',
    );
    expect(fileNameFromDisposition(null, 'x.csv')).toBe('x.csv');
  });

  it('picks the billing text by mode and plan allowance', () => {
    const plan = { monthlyMessagesLimit: 0, usedThisMonth: 0, active: true, endsAt: null };
    expect(billingVariant({ billingMode: 'wallet', plan })).toBe('wallet');
    expect(billingVariant({ billingMode: 'plan', plan })).toBe('planGeneric');
    expect(
      billingVariant({ billingMode: 'plan', plan: { ...plan, monthlyMessagesLimit: 1000 } }),
    ).toBe('planLimited');
    expect(humanizeSource('message.sent')).toBe('Message sent');
    expect(humanizeSource(null)).toBe('');
  });
});

describe('error codes', () => {
  const problem = (code: string, status = 422) => new ApiError(status, code, 'x');
  it('switches on the stable code, never the wording', () => {
    expect(errorKind(problem('WALLET_NOTE_REQUIRED'))).toBe('noteRequired');
    expect(errorKind(problem('WALLET_AMOUNT_INVALID'))).toBe('amountInvalid');
    expect(errorKind(problem('VALIDATION_FAILED'))).toBe('validation');
    expect(errorKind(problem('SOMETHING_ELSE', 403))).toBe('forbidden');
    expect(errorKind(problem('SOMETHING_ELSE', 500))).toBe('generic');
    expect(errorKind(new Error('offline'))).toBe('network');
  });
});

describe('adjust balance dialog rules', () => {
  const draft = (over: Partial<typeof EMPTY_ADJUST> = {}) => ({
    ...EMPTY_ADJUST,
    amount: '250.50',
    note: 'Goodwill credit for the outage',
    ...over,
  });

  it('keeps submit off until the amount and a reason of 5 to 500 characters are valid', () => {
    expect(checkAdjust(EMPTY_ADJUST).input).toBeNull();
    expect(checkAdjust(draft({ note: '' })).input).toBeNull();
    expect(checkAdjust(draft({ note: 'four' })).note).toBe('short');
    expect(checkAdjust(draft({ note: '     x     ' })).note).toBe('short');
    expect(checkAdjust(draft({ note: 'x'.repeat(501) })).note).toBe('long');
    expect(checkAdjust(draft({ note: 'x'.repeat(500) })).input).not.toBeNull();
    expect(checkAdjust(draft({ note: 'fives' })).input).not.toBeNull();
  });

  it('names what is wrong with the amount', () => {
    expect(checkAdjust(draft({ amount: '' })).amount).toBe('required');
    expect(checkAdjust(draft({ amount: 'abc' })).amount).toBe('invalid');
    expect(checkAdjust(draft({ amount: '1.234' })).amount).toBe('invalid');
    expect(checkAdjust(draft({ amount: '0' })).amount).toBe('zero');
    expect(checkAdjust(draft({ amount: '10000000.01' })).amount).toBe('tooLarge');
    expect(checkAdjust(draft({ amount: '10000000' })).input).not.toBeNull();
  });

  it('sends the contract shape with the trimmed reason', () => {
    expect(checkAdjust(draft({ direction: 'debit', note: '  Chargeback  ' })).input).toEqual({
      direction: 'debit',
      amount: '250.50',
      note: 'Chargeback',
    });
  });

  it('previews the new balance and stops a deduction at 0', () => {
    expect(previewBalance(10000, 'credit', 2500)).toBe(12500);
    expect(previewBalance(10000, 'debit', 2500)).toBe(7500);
    expect(previewBalance(1000, 'debit', 5000)).toBe(0);
    expect(willBeCapped(1000, 'debit', 5000)).toBe(true);
    expect(willBeCapped(1000, 'debit', 1000)).toBe(false);
    expect(willBeCapped(1000, 'credit', 5000)).toBe(false);
  });

  it('reuses the Idempotency-Key for a retry and makes a new one for a changed request', () => {
    const input = checkAdjust(draft()).input!;
    let n = 0;
    const gen = () => `key-${++n}`;
    const sig = signatureOf('ws-1', input);
    const first = keyFor(null, sig, gen);
    const retry = keyFor(first, signatureOf('ws-1', input), gen);
    expect(retry.key).toBe(first.key);
    expect(n).toBe(1);
    const changed = keyFor(first, signatureOf('ws-1', { ...input, amount: '300' }), gen);
    expect(changed.key).not.toBe(first.key);
    const otherWorkspace = keyFor(first, signatureOf('ws-2', input), gen);
    expect(otherWorkspace.key).not.toBe(first.key);
  });

  const result = (over: Partial<AdjustWalletResult>): AdjustWalletResult => ({
    transactionId: '11111111-1111-4111-8111-111111111111',
    direction: 'debit',
    requestedMinor: 5000,
    appliedMinor: 5000,
    balanceBeforeMinor: 5000,
    balanceAfterMinor: 0,
    replayed: false,
    ...over,
  });

  it('tells a partial deduction (applied under requested) from a full one', () => {
    expect(outcomeOf(result({}))).toBe('applied');
    expect(outcomeOf(result({ appliedMinor: 1000 }))).toBe('partial');
    expect(outcomeOf(result({ appliedMinor: 0, transactionId: null }))).toBe('partial');
  });
});

describe('rate grid', () => {
  const row = (over: Partial<RateRow> = {}): RateRow => ({
    id: '22222222-2222-4222-8222-222222222222',
    countryCode: 'IN',
    countryName: 'India',
    category: 'marketing',
    priceMinor: 1200,
    metaCost: '0.0118',
    marginMinor: null,
    currency: 'USD',
    isActive: true,
    rowVersion: 1,
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  });

  it('works the margin out in integers, with a percentage of the cost', () => {
    expect(marginOf('12.00', '0.0118')).toMatchObject({ text: '+11.9882', tone: 'success' });
    expect(marginOf('0.05', '0.04')).toMatchObject({ text: '+0.01', percent: '+25.0' });
    expect(marginOf('0.03', '0.04')).toMatchObject({
      text: '-0.01',
      percent: '-25.0',
      tone: 'danger',
    });
    expect(marginOf('0.04', '0.04')).toMatchObject({ text: '0.00', tone: 'neutral' });
    expect(marginOf('1', '0')?.percent).toBeNull();
  });

  it('has no margin until both figures are readable', () => {
    expect(marginOf('', '0.04')).toBeNull();
    expect(marginOf('1.00', '')).toBeNull();
    expect(marginOf('abc', '0.04')).toBeNull();
    expect(marginOf('1.00', '0.0000001')).toBeNull();
  });

  it('marks only the edited rows as changed, and "12" equals "12.00"', () => {
    const server = [row(), row({ id: '33333333-3333-4333-8333-333333333333', countryCode: 'US' })];
    expect(gridRows(server, EMPTY_DRAFT).every((r) => !r.dirty)).toBe(true);
    const same = editField(EMPTY_DRAFT, server[0]!.id, 'price', '12');
    expect(gridRows(server, same)[0]!.dirty).toBe(false);
    const edited = editField(EMPTY_DRAFT, server[0]!.id, 'price', '13.50');
    const rows = gridRows(server, edited);
    expect(rows.map((r) => r.dirty)).toEqual([true, false]);
    const plan = planSave(rows);
    expect(plan.rows).toEqual([
      {
        countryCode: 'IN',
        category: 'marketing',
        price: '13.50',
        metaCost: '0.0118',
        currency: 'USD',
      },
    ]);
    expect(plan.keys).toEqual([server[0]!.id]);
    expect(plan.invalid).toEqual([]);
  });

  it('adds and removes a row explicitly, and ignores an untouched blank row', () => {
    const added = addRow(EMPTY_DRAFT);
    const key = added.added[0]!.key;
    expect(planSave(gridRows([], added)).rows).toEqual([]);
    const filled = editField(editField(added, key, 'countryCode', 'br'), key, 'price', '0.30');
    const plan = planSave(gridRows([], filled));
    expect(plan.rows).toEqual([{ countryCode: 'BR', category: '', price: '0.30', metaCost: '' }]);
    expect(removeAdded(filled, key).added).toEqual([]);
  });

  it('names a problem per row instead of sending it', () => {
    const bad = (price: string, countryCode = 'BR', metaCost = '') => {
      const d = addRow(EMPTY_DRAFT);
      const k = d.added[0]!.key;
      const all = gridRows(
        [],
        editField(
          editField(editField(d, k, 'price', price), k, 'countryCode', countryCode),
          k,
          'metaCost',
          metaCost,
        ),
      );
      return rowProblem(all[0]!, all);
    };
    expect(bad('abc')).toBe('price');
    expect(bad('1', 'BRA')).toBe('country');
    expect(bad('1', 'BR', '1.1234567')).toBe('metaCost');
    expect(bad('', 'BR', '')).toBe('empty');
    expect(bad('1')).toBeNull();
  });

  it('refuses a new row that repeats a stored country and category', () => {
    const server = [row()];
    let d = addRow(EMPTY_DRAFT);
    const k = d.added[0]!.key;
    d = editField(
      editField(editField(d, k, 'countryCode', 'in'), k, 'category', 'marketing'),
      k,
      'price',
      '1',
    );
    const rows = gridRows(server, d);
    expect(rowProblem(rows[1]!, rows)).toBe('duplicate');
    expect(planSave(rows).invalid).toEqual([{ key: k, problem: 'duplicate' }]);
  });

  it('keeps the skipped reason of a row against its line and clears the saved ones', () => {
    const server = [row(), row({ id: '33333333-3333-4333-8333-333333333333', countryCode: 'US' })];
    let d = editField(EMPTY_DRAFT, server[0]!.id, 'price', '2.00');
    d = editField(d, server[1]!.id, 'price', '3.00');
    const plan = planSave(gridRows(server, d));
    const next = afterSave(d, plan.keys, {
      saved: 1,
      skipped: [{ index: 1, reason: 'Price is above the maximum' }],
    });
    expect(next.edits[server[0]!.id]).toBeUndefined();
    expect(next.edits[server[1]!.id]).toEqual({ price: '3.00' });
    expect(next.skipped).toEqual({ [server[1]!.id]: 'Price is above the maximum' });
    // typing in the skipped row clears its reason
    expect(editField(next, server[1]!.id, 'price', '2.00').skipped).toEqual({});
  });

  it('stops at the contract cap of rows in one save', () => {
    let d = EMPTY_DRAFT;
    for (let i = 0; i < MAX_ROWS_PER_SAVE + 1; i++) {
      d = addRow(d);
      const k = d.added[i]!.key;
      d = editField(d, k, 'price', '1');
      d = editField(
        d,
        k,
        'countryCode',
        String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26)),
      );
    }
    expect(planSave(gridRows([], d)).tooMany).toBe(true);
  });
});

describe('economics form', () => {
  const stored = {
    currency: 'USD',
    flatPriceMinor: 50,
    referralSignupMinor: 1000,
    lowBalanceThresholdMinor: 500,
    launchCoveragePercent: 80,
    perCountryEnabled: false,
    payPerMessage: true,
    pricingMode: 'fixed' as const,
    metaRatesLive: false,
    updatedAt: null,
  };
  it('round-trips the stored figures and sends money as text', () => {
    const d = toDraft(stored);
    expect(d).toEqual({
      flatPrice: '0.50',
      referralSignup: '10.00',
      lowBalanceThreshold: '5.00',
      launchCoveragePercent: '80',
    });
    expect(checkSettings(d).input).toEqual({
      flatPrice: '0.50',
      referralSignup: '10.00',
      lowBalanceThreshold: '5.00',
      launchCoveragePercent: 80,
    });
    expect(settingsDirty(d, stored)).toBe(false);
    expect(settingsDirty({ ...d, flatPrice: '0.5' }, stored)).toBe(false);
    expect(settingsDirty({ ...d, flatPrice: '0.6' }, stored)).toBe(true);
  });
  it('flags a zero flat price and a coverage outside 0 to 100', () => {
    const d = toDraft(stored);
    expect(checkSettings({ ...d, flatPrice: '0' }).problems.flatPrice).toBe('flatZero');
    expect(
      checkSettings({ ...d, launchCoveragePercent: '101' }).problems.launchCoveragePercent,
    ).toBe('percent');
    expect(checkSettings({ ...d, lowBalanceThreshold: 'x' }).input).toBeNull();
  });
  it('works out the real-spending and reward sentences in integers', () => {
    expect(messagesPer100(50)).toBe(200);
    expect(messagesPer100(0)).toBe(0);
    expect(rewardMessages(1000, 50)).toBe(20);
  });
});

describe('statement filters', () => {
  const q = (s: string) => new URLSearchParams(s);

  it('reads the address, ignoring what is unreadable', () => {
    expect(parseFilters(q('type=topup&from=2026-10-01&to=2026-10-31&q=%20promo%20'))).toEqual({
      type: 'topup',
      from: '2026-10-01',
      to: '2026-10-31',
      q: 'promo',
    });
    expect(parseFilters(q('type=bogus&from=yesterday&to=2026-13'))).toEqual(EMPTY_FILTERS);
  });

  it('offers Top-ups as a real filter', () => {
    expect(parseFilters(q('type=topup')).type).toBe('topup');
    expect(toApiQuery({ ...EMPTY_FILTERS, type: 'topup' })).toEqual({
      type: 'topup',
      from: undefined,
      to: undefined,
      q: undefined,
    });
  });

  it('turns filters into a query string with only what is set', () => {
    expect(toSearch(EMPTY_FILTERS)).toBe('');
    expect(toSearch({ type: 'spend', from: '2026-10-01', to: '', q: 'launch' })).toBe(
      '?type=spend&from=2026-10-01&q=launch',
    );
    expect(toSearch({ ...EMPTY_FILTERS, q: '   ' })).toBe('');
    expect(hasFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasFilters({ ...EMPTY_FILTERS, type: 'refund' })).toBe(true);
  });

  it('round-trips through the address', () => {
    const f = { type: 'admin_adjust' as const, from: '2026-09-01', to: '2026-09-30', q: 'a&b' };
    expect(parseFilters(q(toSearch(f)))).toEqual(f);
  });

  it('spots a range that ends before it starts', () => {
    expect(rangeInverted({ ...EMPTY_FILTERS, from: '2026-10-05', to: '2026-10-01' })).toBe(true);
    expect(rangeInverted({ ...EMPTY_FILTERS, from: '2026-10-01', to: '2026-10-01' })).toBe(false);
    expect(rangeInverted({ ...EMPTY_FILTERS, from: '2026-10-01' })).toBe(false);
  });
});
