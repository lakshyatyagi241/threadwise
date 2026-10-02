import { describe, expect, it } from 'vitest';
import { missingKeys } from './test-messages';

/** Keys the builder, the paper, the tax panel and the buyer's page build at run time (a literal `t('...')` is checked by messages.test.ts). */
const PROBLEMS = [
  'contactRequired',
  'currencyInvalid',
  'issueDateInvalid',
  'dueBeforeIssue',
  'dueInvalid',
  'noLines',
  'discountInvalid',
  'shippingInvalid',
  'emailInvalid',
  'amountZero',
  'amountInvalid',
  'countryInvalid',
  'regionInvalid',
  'autoNeedsSellerCountry',
  'descriptionRequired',
  'qtyInvalid',
  'priceInvalid',
  'lineDiscountInvalid',
  'hsnRequired',
  'hsnInvalid',
  'taxRateRemoved',
];

const ERROR_CODES = [
  'INV_AMOUNT_INVALID',
  'INV_TAX_RATE_INVALID',
  'INV_NOT_DRAFT',
  'INV_ORDER_LINKED',
  'SALESDOC_INVALID_TRANSITION',
  'SALESDOC_ALREADY_CONVERTED',
  'SALESDOC_INVOICING_UNAVAILABLE',
  'INV_LINK_UNAVAILABLE',
];

describe('builder messages built at run time', () => {
  it('has every validation problem the form can show', () => {
    expect(missingKeys(PROBLEMS.map((p) => `builder.problems.${p}`))).toEqual([]);
  });
  it('has the tax mode, supply type and document type labels', () => {
    expect(
      missingKeys([
        'builder.taxModes.rates',
        'builder.taxModes.auto',
        'builder.taxModeHint.rates',
        'builder.taxModeHint.auto',
        'builder.supplyTypes.goods',
        'builder.supplyTypes.services',
        'builder.supplyTypes.digital',
        'builder.docTypes.tax_invoice',
        'builder.docTypes.proforma',
        'builder.views.edit',
        'builder.views.preview',
      ]),
    ).toEqual([]);
  });
  it('has a title for every document type on the paper', () => {
    expect(
      missingKeys(['tax_invoice', 'proforma', 'receipt'].map((k) => `paper.docTitle.${k}`)),
    ).toEqual([]);
  });
  it('has the amount errors of the buyer page', () => {
    expect(missingKeys(['invalid', 'tooMuch'].map((k) => `public.amountErrors.${k}`))).toEqual([]);
  });
  it('has a sentence for every error code the builder, the conversion and the buyer page can hit', () => {
    expect(missingKeys(ERROR_CODES.map((c) => `errors.codes.${c}`))).toEqual([]);
  });
  it('has the "Why this tax?" panel texts', () => {
    expect(
      missingKeys(
        [
          'title',
          'preview',
          'previewNote',
          'taxFree',
          'warnings',
          'placeOfSupply',
          'reverseCharge',
          'reverseChargeNote',
          'documentNotes',
          'disclaimer',
        ].map((k) => `taxWhy.${k}`),
      ),
    ).toEqual([]);
  });
  it('has the method name of every payment method the paper can list', () => {
    expect(
      missingKeys(
        ['bank', 'manual', 'cash', 'card', 'upi', 'cheque', 'gateway', 'other'].map(
          (k) => `method.${k}`,
        ),
      ),
    ).toEqual([]);
  });
});
