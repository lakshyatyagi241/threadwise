import { describe, expect, it } from 'vitest';
import {
  extSheetsContactsSyncRequestSchema,
  extSheetsProductRowSchema,
  extSheetsSyncRequestSchema,
  EXT_SHEETS_MAX_ROWS,
} from '@crm/contracts';
import {
  failedRow,
  parseContactRows,
  planContactRow,
  refOf,
  summarize,
} from '../../../src/modules/chrome-extension-sheets-addon/sheets-row.rules';

const plan = (row: Record<string, unknown>, cc?: string) => {
  const [item] = parseContactRows([row]);
  if (!item || 'failed' in item) throw new Error('row did not parse');
  return planContactRow(item.row, cc);
};

/** WD-EXT-012: what a sheet row means as a contact. */
describe('contact rows', () => {
  it('lower-cases the email and makes the phone E.164', () => {
    const p = plan({ email: ' Ann@Example.COM ', phone: '+91 98765 43210', name: 'Ann' });
    expect(p).toMatchObject({
      ok: true,
      contact: {
        email: 'ann@example.com',
        phone: '+919876543210',
        name: 'Ann',
        source: 'google_sheets',
      },
    });
  });

  it('reads a phone typed as a number (Sheets gives numbers) and applies the request default country code', () => {
    expect(plan({ phone: 9876543210 }, '+91')).toMatchObject({
      ok: true,
      contact: { phone: '+919876543210' },
    });
    expect(plan({ phone: 919876543210 })).toMatchObject({
      ok: true,
      contact: { phone: '+919876543210' },
    });
  });

  it("lets a row's own country code beat the default", () => {
    expect(plan({ phone: '4155550101', country_code: '1' }, '+91')).toMatchObject({
      ok: true,
      contact: { phone: '+14155550101' },
    });
  });

  it('refuses a number it cannot place, and a row with neither email nor phone', () => {
    expect(plan({ phone: '12' })).toMatchObject({ ok: false, field: 'phone' });
    expect(plan({ email: 'not-an-email' })).toMatchObject({ ok: false, field: 'email' });
    expect(plan({ name: 'Only a name' })).toMatchObject({ ok: false, field: 'email' });
    expect(plan({ email: '   ', phone: '' })).toMatchObject({ ok: false });
  });

  it('treats blank cells as not given', () => {
    const p = plan({
      email: 'a@b.co',
      name: '',
      first_name: '  ',
      is_unsubscribed: '',
      attributes: { city: '', plan: ' gold ', n: 3, off: null },
    });
    expect(p).toMatchObject({ ok: true });
    if (!p.ok) return;
    expect(p.contact.name).toBeUndefined();
    expect(p.contact.firstName).toBeUndefined();
    expect(p.contact.isUnsubscribed).toBeUndefined();
    expect(p.contact.customFields).toEqual({ plan: 'gold', n: 3 });
  });

  it('reads yes/no and 1/0 for the opt-out column, and keeps a source the row names', () => {
    expect(plan({ email: 'a@b.co', is_unsubscribed: 'Yes', source: 'webinar' })).toMatchObject({
      contact: { isUnsubscribed: true, source: 'webinar' },
    });
    expect(plan({ email: 'a@b.co', is_unsubscribed: '0' })).toMatchObject({
      contact: { isUnsubscribed: false },
    });
  });

  it('reports a row that does not parse as that row only, with the field and the client ref', () => {
    const out = parseContactRows([
      { email: 'a@b.co' },
      { ref: 7, email: 'x'.repeat(300) },
      'junk',
      null,
    ]);
    expect('row' in out[0]!).toBe(true);
    expect(out[1]).toMatchObject({
      failed: {
        index: 1,
        ref: 7,
        status: 'failed',
        error: { code: 'VALIDATION_FAILED', field: 'email' },
      },
    });
    expect(out[2]).toMatchObject({ failed: { index: 2, status: 'failed' } });
    expect(out[3]).toMatchObject({ failed: { index: 3, status: 'failed' } });
  });

  it('only echoes a ref that is a string or an integer', () => {
    expect(refOf({ ref: 'r1' })).toBe('r1');
    expect(refOf({ ref: 12 })).toBe(12);
    expect(refOf({ ref: 1.5 })).toBeUndefined();
    expect(refOf({ ref: { a: 1 } })).toBeUndefined();
    expect(refOf(null)).toBeUndefined();
  });

  it('counts results, with total = created + updated as WaDesk reported', () => {
    expect(
      summarize([
        { index: 0, status: 'created' },
        { index: 1, status: 'created' },
        { index: 2, status: 'updated' },
        { index: 3, status: 'unchanged' },
        failedRow(4, undefined, 'FORBIDDEN', 'no'),
      ]),
    ).toEqual({ created: 2, updated: 1, unchanged: 1, failed: 1, total: 3 });
  });
});

/** WD-EXT-009, 010: a product row, and the request around it. */
describe('product rows and the sync request', () => {
  const ok = (row: Record<string, unknown>) => extSheetsProductRowSchema.safeParse(row);

  it('reads a price typed as text or number and refuses a bad one', () => {
    expect(ok({ name: 'Tee', price: '19.99' })).toMatchObject({
      success: true,
      data: { price: 19.99 },
    });
    expect(ok({ name: 'Tee', price: 0 }).success).toBe(true);
    expect(ok({ name: 'Tee', price: '1,299' }).success).toBe(false);
    expect(ok({ name: 'Tee', price: -1 }).success).toBe(false);
    expect(ok({ name: 'Tee', price: 1_000_001 }).success).toBe(false);
    expect(ok({ name: 'Tee' }).success).toBe(false);
    expect(ok({ name: '  ', price: 1 }).success).toBe(false);
  });

  it('tells "keep the stock" (absent) from "unlimited" (blank or null) from a count', () => {
    const absent = ok({ name: 'T', price: 1 });
    expect(absent.success && absent.data.stock).toBeUndefined();
    expect(ok({ name: 'T', price: 1, stock: '' })).toMatchObject({ data: { stock: null } });
    expect(ok({ name: 'T', price: 1, stock: null })).toMatchObject({ data: { stock: null } });
    expect(ok({ name: 'T', price: 1, stock: '12' })).toMatchObject({ data: { stock: 12 } });
    expect(ok({ name: 'T', price: 1, stock: 2.5 }).success).toBe(false);
    expect(ok({ name: 'T', price: 1, stock: -1 }).success).toBe(false);
  });

  it('reads the active column as a flag and a blank image as none', () => {
    expect(ok({ name: 'T', price: 1, active: 'no' })).toMatchObject({ data: { active: false } });
    expect(ok({ name: 'T', price: 1, active: true })).toMatchObject({ data: { active: true } });
    expect(ok({ name: 'T', price: 1, image_url: '' })).toMatchObject({ success: true });
    expect(ok({ name: 'T', price: 1, image_url: 'not a url' }).success).toBe(false);
  });

  it('validates the shop part as a whole and leaves each product to be read on its own', () => {
    const good = { shop_name: 'My shop', products: [{ anything: 1 }] };
    expect(extSheetsSyncRequestSchema.safeParse(good).success).toBe(true);
    expect(extSheetsSyncRequestSchema.safeParse({ ...good, shop_name: ' ' }).success).toBe(false);
    expect(extSheetsSyncRequestSchema.safeParse({ ...good, products: [] }).success).toBe(false);
    expect(
      extSheetsSyncRequestSchema.safeParse({
        ...good,
        products: new Array(EXT_SHEETS_MAX_ROWS + 1).fill({}),
      }).success,
    ).toBe(false);
    expect(extSheetsSyncRequestSchema.safeParse({ ...good, currency: 'inr' })).toMatchObject({
      success: true,
      data: { currency: 'INR' },
    });
    expect(extSheetsSyncRequestSchema.safeParse({ ...good, currency: 'XYZ' }).success).toBe(false);
    expect(extSheetsSyncRequestSchema.safeParse({ ...good, currency: 'US' }).success).toBe(false);
    expect(extSheetsSyncRequestSchema.safeParse({ ...good, theme_key: 'nope' }).success).toBe(
      false,
    );
    expect(extSheetsSyncRequestSchema.safeParse({ ...good, shop_id: 'not-a-uuid' }).success).toBe(
      false,
    );
  });

  it('caps a contact sync at the same number of rows and needs at least one', () => {
    expect(extSheetsContactsSyncRequestSchema.safeParse({ rows: [] }).success).toBe(false);
    expect(extSheetsContactsSyncRequestSchema.safeParse({ rows: [{}] }).success).toBe(true);
    expect(
      extSheetsContactsSyncRequestSchema.safeParse({
        rows: new Array(EXT_SHEETS_MAX_ROWS + 1).fill({}),
      }).success,
    ).toBe(false);
    expect(extSheetsContactsSyncRequestSchema.safeParse({}).success).toBe(false);
  });
});
