import { AGING_BUCKETS, PAYMENT_KINDS, PAYMENT_METHODS, TAX_TYPES } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import type { TaxRateProblem } from './lib/tax-rate-form';
import { missingKeys } from './test-messages';

const PROBLEMS: TaxRateProblem[] = [
  'nameRequired',
  'nameTooLong',
  'rateInvalid',
  'countryInvalid',
  'regionInvalid',
  'dateInvalid',
  'dateOrder',
  'hsnInvalid',
  'componentsMissing',
  'componentTypeRequired',
  'componentRateInvalid',
  'componentsSum',
  'descriptionTooLong',
];

describe('ledger messages built at run time (English and Arabic)', () => {
  it('has every payment method, kind, aging bucket and tax type', () => {
    expect(
      missingKeys([
        ...PAYMENT_METHODS.map((m) => `method.${m}`),
        ...PAYMENT_KINDS.map((k) => `payments.kinds.${k}`),
        ...AGING_BUCKETS.map((b) => `aging.buckets.${b}`),
        ...TAX_TYPES.map((x) => `taxRates.types.${x}`),
      ]),
    ).toEqual([]);
  });
  it('has the three views and every table column', () => {
    expect(
      missingKeys([
        ...['ledger', 'aging', 'outstanding'].map((v) => `payments.views.${v}`),
        ...[
          'date',
          'receipt',
          'invoice',
          'contact',
          'method',
          'reference',
          'amount',
          'refunded',
          'recordedBy',
          'actions',
        ].map((c) => `payments.table.columns.${c}`),
        ...['contact', 'currency', 'outstanding', 'overdue', 'invoices', 'oldestDue'].map(
          (c) => `payments.outstanding.columns.${c}`,
        ),
        ...[
          'name',
          'type',
          'rate',
          'applies',
          'where',
          'effective',
          'status',
          'used',
          'hsn',
          'actions',
        ].map((c) => `taxRates.columns.${c}`),
      ]),
    ).toEqual([]);
  });
  it('has every tax-rate form problem and the server error codes of the screens', () => {
    expect(
      missingKeys([
        ...PROBLEMS.map((p) => `taxRates.form.problems.${p}`),
        'taxRates.form.problems.nameTaken',
        'taxRates.form.problems.conflict',
        'errors.codes.TAX_RATE_NAME_TAKEN',
        'errors.codes.TAX_RATE_INVALID',
        'errors.codes.PAY_REFUND_EXCEEDS',
        'errors.codes.PAY_NOT_REFUNDABLE',
      ]),
    ).toEqual([]);
  });
  it('has the preset dialog texts, including the disclaimer heading', () => {
    expect(
      missingKeys(
        [
          'eyebrow',
          'title',
          'country',
          'verify',
          'apply',
          'result',
          'applied',
          'setDefault',
          'standard',
          'exists',
          'notInForce',
          'from',
          'until',
          'asOf',
          'noRates',
        ].map((k) => `taxRates.presets.${k}`),
      ),
    ).toEqual([]);
  });
});
