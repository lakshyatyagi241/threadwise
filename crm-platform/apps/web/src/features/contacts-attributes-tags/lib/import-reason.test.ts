import { describe, expect, it } from 'vitest';
import { importRejectText, type Translate } from './import-reason';

/** Echoes the key and its values, so each test can see which message the helper asked for. */
const t: Translate = (key, values) => (values ? `${key} ${JSON.stringify(values)}` : key);

describe('importRejectText', () => {
  it('names the column that failed when a custom property does not fit', () => {
    expect(importRejectText({ reason: 'invalid_property_value', column: 'Customer tier' }, t)).toBe(
      'reasons.invalid_property_value_column {"column":"Customer tier"}',
    );
  });

  it('falls back to the generic message when no column came with the rejection', () => {
    expect(importRejectText({ reason: 'invalid_property_value' }, t)).toBe(
      'reasons.invalid_property_value',
    );
  });

  it('uses the message for a reason that names no column, whatever column the server sent', () => {
    expect(importRejectText({ reason: 'invalid_phone', column: 'Mobile' }, t)).toBe(
      'reasons.invalid_phone',
    );
  });

  it('shows a reason this app does not know as the server sent it', () => {
    expect(importRejectText({ reason: 'some_new_reason' }, t)).toBe('some_new_reason');
  });
});
