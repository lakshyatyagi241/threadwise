import {
  INVOICE_EVENT_TYPES,
  INVOICE_SEND_CHANNELS,
  INVOICE_SOURCES,
  INVOICE_STATUSES,
  INVOICE_DOC_TYPES,
  PAYMENT_METHODS,
} from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { INVOICE_COLUMNS } from './lib/sticky';
import { ORDERS } from './lib/filters';
import { TABS } from './lib/status';
import { missingKeys } from './test-messages';

/** Keys the invoice list and detail screens build at run time (a template string in `t(...)`), checked in English and Arabic. */
describe('invoice list and detail messages', () => {
  it('has a label for every status, tab, empty state and column', () => {
    expect(
      missingKeys([
        ...INVOICE_STATUSES.map((s) => `status.${s}`),
        ...TABS.map((tab) => `tabs.${tab}`),
        ...TABS.flatMap((tab) => [`list.empty.${tab}.title`, `list.empty.${tab}.message`]),
        ...INVOICE_COLUMNS.map((c) => `table.columns.${c}`),
      ]),
    ).toEqual([]);
  });

  it('has the toolbar choices: document types and the two orders', () => {
    expect(
      missingKeys([
        ...INVOICE_DOC_TYPES.map((d) => `toolbar.docTypes.${d}`),
        ...ORDERS.map((o) => (o === 'desc' ? 'toolbar.sorts.newest' : 'toolbar.sorts.oldest')),
      ]),
    ).toEqual([]);
  });

  it('names every payment method and invoice source', () => {
    expect(
      missingKeys([
        ...PAYMENT_METHODS.map((m) => `method.${m}`),
        ...INVOICE_SOURCES.map((s) => `detail.sources.${s}`),
      ]),
    ).toEqual([]);
  });

  it('words every timeline event the API can send, and who did it', () => {
    expect(
      missingKeys([
        // `partially_paid` is written by the API but missing from INVOICE_EVENT_TYPES
        ...[...INVOICE_EVENT_TYPES, 'partially_paid'].map((e) => `activity.events.${e}`),
        'activity.actors.buyer',
        'activity.actors.gateway',
        'activity.actors.system',
      ]),
    ).toEqual([]);
  });

  it('has the send channels, their buttons and their toasts', () => {
    expect(
      missingKeys(
        INVOICE_SEND_CHANNELS.flatMap((c) => [
          `sendDialog.channels.${c}`,
          `sendDialog.action.${c}`,
          `actions.sentVia.${c}`,
        ]),
      ),
    ).toEqual([]);
  });

  it('has the bulk results and the link and credit note states', () => {
    expect(
      missingKeys([
        ...(['issue', 'send', 'void', 'delete'] as const).map((a) => `bulk.done.${a}`),
        'linkCard.state.active',
        'linkCard.state.revoked',
        'linkCard.state.expired',
        'linkCard.off.revoked',
        'linkCard.off.expired',
        'detail.creditNotes.status.draft',
        'detail.creditNotes.status.issued',
        'detail.creditNotes.status.void',
      ]),
    ).toEqual([]);
  });

  it('has the form problems of the payment and refund dialogs', () => {
    const pay = [
      'amountInvalid',
      'amountZero',
      'dateInvalid',
      'dateFuture',
      'referenceTooLong',
      'noteTooLong',
    ];
    const refund = ['amountInvalid', 'amountZero', 'tooMuch', 'dateFuture'];
    expect(
      missingKeys([
        ...pay.map((p) => `payDialog.problems.${p}`),
        ...refund.map((p) => `refundDialog.problems.${p}`),
      ]),
    ).toEqual([]);
  });

  it('has a sentence for every error code the screens map', () => {
    const codes = [
      'INV_NOT_DRAFT',
      'INV_NOT_ISSUED',
      'INV_ALREADY_VOID',
      'INV_HAS_PAYMENTS',
      'INV_HAS_CREDITS',
      'INV_NOT_DELETABLE',
      'INV_NO_RECIPIENT',
      'INV_LINK_UNAVAILABLE',
      'INV_OWNER_INVALID',
      'PAY_OVERPAYMENT',
      'PAY_FUTURE_DATE',
      'PAY_CURRENCY_MISMATCH',
      'PAY_REFUND_EXCEEDS',
      'PAY_NOT_REFUNDABLE',
      'PAY_NOTHING_TO_PAY',
      'ROW_VERSION_CONFLICT',
    ];
    expect(missingKeys(codes.map((c) => `errors.codes.${c}`))).toEqual([]);
  });
});
