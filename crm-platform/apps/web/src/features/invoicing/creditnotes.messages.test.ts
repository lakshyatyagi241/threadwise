import { describe, expect, it } from 'vitest';
import { CREDIT_NOTE_REASONS, CREDIT_NOTE_SETTLEMENTS, CREDIT_NOTE_STATUSES } from '@crm/contracts';
import { CREDIT_NOTE_ERROR_CODES, CREDIT_TABS } from './lib/credit-notes';
import { missingKeys } from './test-messages';

/** Keys the credit note screens build at run time (a reason, a tab, a status, an error code, a problem ...). */
const PROBLEMS = [
  'noInvoice',
  'nothing',
  'qtyInvalid',
  'qtyExceeds',
  'descriptionRequired',
  'amountInvalid',
  'noteTooLong',
];

describe('credit note messages', () => {
  it('have a label for every status, reason, settlement and tab, in English and Arabic', () => {
    expect(
      missingKeys([
        ...CREDIT_NOTE_STATUSES.map((s) => `creditNotes.status.${s}`),
        ...CREDIT_NOTE_REASONS.map((r) => `creditNotes.reasons.${r}`),
        ...CREDIT_NOTE_SETTLEMENTS.map((s) => `creditNotes.settlements.${s}`),
        ...CREDIT_NOTE_SETTLEMENTS.flatMap((s) => [
          `creditNotes.builder.settlement.${s}.title`,
          `creditNotes.builder.settlement.${s}.body`,
        ]),
        ...CREDIT_TABS.flatMap((t) => [
          `creditNotes.tabs.${t}`,
          `creditNotes.list.empty.${t}.title`,
          `creditNotes.list.empty.${t}.message`,
        ]),
      ]),
    ).toEqual([]);
  });

  it('explain every error code the screens can meet', () => {
    expect(missingKeys(CREDIT_NOTE_ERROR_CODES.map((c) => `errors.codes.${c}`))).toEqual([]);
  });

  it('have the form problems, the dialogs and the table columns', () => {
    expect(
      missingKeys([
        ...PROBLEMS.map((p) => `creditNotes.problems.${p}`),
        ...['issue', 'void', 'delete'].flatMap((k) => [
          `creditNotes.dialogs.${k}.title`,
          `creditNotes.dialogs.done.${k}`,
        ]),
        ...[
          'number',
          'invoice',
          'buyer',
          'reason',
          'settlement',
          'total',
          'applied',
          'refunded',
          'issued',
          'status',
        ].map((c) => `creditNotes.table.columns.${c}`),
        'nav.creditNotes',
      ]),
    ).toEqual([]);
  });
});
