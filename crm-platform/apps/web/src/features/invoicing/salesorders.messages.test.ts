import { ERROR_CODES } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { SALES_ORDER_ERROR_CODES, SALES_ORDER_LABELS, SO_QUICK, SO_TABS } from './lib/sales-orders';
import { missingKeys } from './test-messages';

describe('sales orders messages', () => {
  it('has a sentence for every SO_ error code, in English and Arabic', () => {
    expect(missingKeys(SALES_ORDER_ERROR_CODES.map((c) => `errors.codes.${c}`))).toEqual([]);
  });

  it('covers every SO_ code the API defines', () => {
    const api = Object.keys(ERROR_CODES).filter((c) => c.startsWith('SO_'));
    expect([...SALES_ORDER_ERROR_CODES].sort()).toEqual(api.sort());
  });

  it('has every key built at run time', () => {
    const NS = 'salesOrders';
    const keys = [
      ...SO_TABS.flatMap((t) => [
        `${NS}.tabs.${t}`,
        `${NS}.list.empty.${t}.title`,
        `${NS}.list.empty.${t}.message`,
      ]),
      ...SO_QUICK.filter(Boolean).map((q) => `${NS}.quick.${q}`),
      ...['draft', 'confirmed', 'cancelled', 'closed'].map((s) => `${NS}.status.${s}`),
      ...SALES_ORDER_LABELS.invoicing.map((s) => `${NS}.invoicingStatus.${s}`),
      ...SALES_ORDER_LABELS.fulfilment.map((s) => `${NS}.fulfilmentStatus.${s}`),
      ...[
        'number',
        'buyer',
        'quote',
        'deal',
        'expected',
        'status',
        'invoicing',
        'fulfilment',
        'total',
        'invoices',
      ].map((c) => `${NS}.table.columns.${c}`),
      ...['all', 'lines'].map((m) => `${NS}.dialog.mode.${m}`),
      ...['nothing', 'issueDateInvalid', 'dueDateInvalid', 'dueBeforeIssue'].map(
        (p) => `${NS}.invoiceDialog.problems.${p}`,
      ),
      ...['nothing', 'noteTooLong'].map((p) => `${NS}.fulfilDialog.problems.${p}`),
      ...[
        'buyerRequired',
        'emailInvalid',
        'currencyInvalid',
        'expectedDateInvalid',
        'shippingInvalid',
        'noLines',
        'referenceTooLong',
      ].map((p) => `${NS}.builder.problems.${p}`),
      ...[
        'descriptionRequired',
        'qtyInvalid',
        'priceInvalid',
        'lineDiscountInvalid',
        'hsnRequired',
        'hsnInvalid',
        'taxRateRemoved',
      ].map((p) => `${NS}.builder.lineProblems.${p}`),
      ...['scratch', 'quote'].map((s) => `${NS}.builder.source.${s}`),
      ...SALES_ORDER_LABELS.quoteKinds.map((k) => `${NS}.quotePicker.kind.${k}`),
    ];
    expect(missingKeys(keys)).toEqual([]);
  });
});
