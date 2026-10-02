import { describe, expect, it } from 'vitest';
import {
  FORM_FIELD_LIMITS,
  assertFormFieldLimits,
} from '../../../src/modules/crm/contacts/form-field-limits';

/** WD-CON-009 rule 2: the form's text fields have server-side caps (WaDesk: title 50, language 80, address 1000, memo 2000). */
describe('assertFormFieldLimits', () => {
  it('passes values at the cap, other keys of any length, and no custom fields at all', () => {
    expect(() =>
      assertFormFieldLimits({
        memo: 'm'.repeat(2000),
        address: 'a'.repeat(1000),
        language: 'l'.repeat(80),
        title: 't'.repeat(50),
        middle_name: 'n'.repeat(191),
        order_note: 'x'.repeat(5000),
      }),
    ).not.toThrow();
    expect(() => assertFormFieldLimits(undefined)).not.toThrow();
    expect(() => assertFormFieldLimits({})).not.toThrow();
  });

  it('names every over-long key as a 422 with customFields.<key> paths', () => {
    let err: unknown;
    try {
      assertFormFieldLimits({ memo: 'm'.repeat(2001), language: 'l'.repeat(81), address: 'ok' });
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ code: 'VALIDATION_FAILED' });
    const details = (err as { details?: Array<{ path: string }> }).details ?? [];
    expect(details.map((d) => d.path).sort()).toEqual([
      'customFields.language',
      'customFields.memo',
    ]);
  });

  it('ignores non-text values (a number or null under a reserved key is not a length problem)', () => {
    expect(() => assertFormFieldLimits({ memo: null, address: 12345 })).not.toThrow();
  });

  it('keeps the caps the form inputs use', () => {
    expect(FORM_FIELD_LIMITS).toEqual({
      title: 50,
      middle_name: 191,
      language: 80,
      address: 1000,
      memo: 2000,
    });
  });
});
