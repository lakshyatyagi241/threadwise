import { describe, expect, it } from 'vitest';
import { EXT_SHEETS_MAX_ROWS, extSheetsWebhookRequestSchema } from '@crm/contracts';
import { sampleOf } from '../../../src/modules/chrome-extension-sheets-addon/sheets-webhook.service';

/** The webhook trigger's request shape and the capture of the first row. */
describe('webhook request', () => {
  it('takes a known event with 1 to 500 rows', () => {
    const ok = extSheetsWebhookRequestSchema.safeParse({ event: 'edit', rows: [{}] });
    expect(ok.success).toBe(true);
    for (const bad of [
      { event: 'delete', rows: [{}] },
      { event: 'edit', rows: [] },
      { event: 'edit', rows: Array.from({ length: EXT_SHEETS_MAX_ROWS + 1 }, () => ({})) },
      { rows: [{}] },
    ]) {
      expect(extSheetsWebhookRequestSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('turns a blank default country code into no default', () => {
    const r = extSheetsWebhookRequestSchema.parse({
      event: 'schedule',
      default_country_code: '',
      rows: [{}],
    });
    expect(r.default_country_code).toBeUndefined();
  });
});

describe('sampleOf', () => {
  it('keeps the first row values by heading as short text and drops objects', () => {
    const sample = sampleOf({
      values: { Name: 'Ann', Age: 31, Opt: true, Nested: { a: 1 }, Long: 'x'.repeat(500) },
    });
    expect(Object.keys(sample)).toEqual(['Name', 'Age', 'Opt', 'Long']);
    expect(sample.Age).toBe('31');
    expect(sample.Long).toHaveLength(120);
  });

  it('is empty for a row without values', () => {
    expect(sampleOf({})).toEqual({});
    expect(sampleOf(null)).toEqual({});
    expect(sampleOf({ values: [1] })).toEqual({});
  });
});
