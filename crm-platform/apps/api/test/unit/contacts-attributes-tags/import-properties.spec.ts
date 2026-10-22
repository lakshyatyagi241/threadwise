import { describe, expect, it } from 'vitest';
import { contactImportOptionsSchema } from '@crm/contracts';
import type { PropertyDef } from '../../../src/modules/crm/contacts/contact-property-values';
import {
  cellToPropertyValue,
  resolvePropertyColumns,
} from '../../../src/modules/crm/contact-import/import-properties';
import { extractRow, resolveMapping } from '../../../src/modules/crm/contact-import/import-rows';
import { analyzeCsv } from '../../../src/modules/crm/contact-import/contact-import.service';

const opts = (over: Record<string, unknown> = {}) => contactImportOptionsSchema.parse(over);

const tier: PropertyDef = {
  key: 'tier',
  label: 'Customer tier',
  fieldType: 'select',
  options: ['Gold', 'Silver'],
};
const points: PropertyDef = {
  key: 'loyalty_points',
  label: 'Loyalty points',
  fieldType: 'integer',
  options: [],
};
const plan: PropertyDef = {
  key: 'plan',
  label: 'Plan',
  fieldType: 'multiselect',
  options: ['pro', 'basic'],
};
const defs = [tier, points, plan];

describe('matching a column to a custom property', () => {
  it('a property keyed like an object method is still matched by its header', () => {
    const ctor: PropertyDef = {
      key: 'constructor',
      label: 'Region',
      fieldType: 'text',
      options: [],
    };
    const cols = resolvePropertyColumns(['Region'], [ctor], new Set(), { tier: 3 });
    expect(cols[0]).toMatchObject({ key: 'constructor', column: 0 });
  });

  it('reads a column whose header is the property label, its key, or the export attr:key', () => {
    const headers = ['Customer tier', 'attr:loyalty_points', 'plan'];
    const cols = resolvePropertyColumns(headers, defs, new Set());
    expect(cols.map((c) => [c.key, c.column])).toEqual([
      ['tier', 0],
      ['loyalty_points', 1],
      ['plan', 2],
    ]);
  });

  it('never takes a column a built-in field reads', () => {
    const phoneAlt: PropertyDef = {
      key: 'phone_alt',
      label: 'Phone',
      fieldType: 'text',
      options: [],
    };
    const cols = resolvePropertyColumns(['Phone'], [phoneAlt], new Set([0]));
    expect(cols[0]).toMatchObject({ key: 'phone_alt', column: null });
  });

  it('gives one column to one property', () => {
    const twin: PropertyDef = {
      key: 'tier_copy',
      label: 'Customer tier',
      fieldType: 'text',
      options: [],
    };
    const cols = resolvePropertyColumns(['Customer tier'], [tier, twin], new Set());
    expect(cols.map((c) => [c.key, c.column])).toEqual([
      ['tier', 0],
      ['tier_copy', null],
    ]);
  });

  it('an explicit request wins: a column number reads that column, null ignores the property', () => {
    const headers = ['Phone', 'Name', 'Something else', 'Customer tier'];
    const moved = resolvePropertyColumns(headers, [tier], new Set(), { tier: 2 });
    expect(moved[0]).toMatchObject({ key: 'tier', column: 2 });
    const ignored = resolvePropertyColumns(headers, [tier], new Set(), { tier: null });
    expect(ignored[0]).toMatchObject({ key: 'tier', column: null });
  });

  it('an explicit column past the end of the file, or one a built-in field reads, reads nothing', () => {
    const headers = ['Phone', 'Name'];
    expect(resolvePropertyColumns(headers, [tier], new Set(), { tier: 9 })[0]).toMatchObject({
      column: null,
    });
    expect(resolvePropertyColumns(headers, [tier], new Set([1]), { tier: 1 })[0]).toMatchObject({
      column: null,
    });
  });
});

describe('reading a cell as the property value', () => {
  it('a blank cell says nothing', () => {
    expect(cellToPropertyValue(points, '   ')).toBeUndefined();
  });

  it('numbers may carry thousands separators', () => {
    const currency: PropertyDef = {
      key: 'spend',
      label: 'Spend',
      fieldType: 'currency',
      options: [],
    };
    expect(cellToPropertyValue(currency, '1,250.5')).toBe(1250.5);
  });

  it('a decimal comma is not a thousands separator: "12,5" stays text and is refused, not stored as 125', () => {
    const rate: PropertyDef = { key: 'rate', label: 'Rate', fieldType: 'decimal', options: [] };
    expect(cellToPropertyValue(rate, '12,5')).toBe('12,5');
    expect(cellToPropertyValue(rate, '1,2')).toBe('1,2');
    expect(cellToPropertyValue(rate, '12.5')).toBe(12.5);
  });

  it('yes / no read a checkbox or boolean, and anything else is passed on as text to be refused', () => {
    const flag: PropertyDef = { key: 'vip', label: 'VIP', fieldType: 'checkbox', options: [] };
    expect(cellToPropertyValue(flag, 'Yes')).toBe(true);
    expect(cellToPropertyValue(flag, 'no')).toBe(false);
    expect(cellToPropertyValue(flag, 'maybe')).toBe('maybe');
  });

  it('an option is matched without regard to case', () => {
    expect(cellToPropertyValue(tier, 'gold')).toBe('Gold');
    expect(cellToPropertyValue(tier, 'Platinum')).toBe('Platinum');
  });

  it('a list cell is split on commas, semicolons or pipes; an option that holds a comma is read whole', () => {
    expect(cellToPropertyValue(plan, 'pro, basic')).toEqual(['pro', 'basic']);
    const notes: PropertyDef = {
      key: 'notes',
      label: 'Notes',
      fieldType: 'multiselect',
      options: ['Call, then email'],
    };
    expect(cellToPropertyValue(notes, 'call, then email')).toEqual(['Call, then email']);
  });
});

describe('a file with custom property columns (analysis)', () => {
  const csv = [
    'Phone,Name,Customer tier,attr:loyalty_points,Plan',
    '+919812300500,Asha,gold,"1,200",pro',
    '+919898765432,Ravi,,,',
  ].join('\n');

  it("carries each row's property values, and a blank cell carries none", () => {
    const a = analyzeCsv(csv, opts(), defs);
    expect(a.valid).toHaveLength(2);
    expect(a.valid[0]!.properties).toEqual({ tier: 'Gold', loyalty_points: 1200, plan: ['pro'] });
    expect(a.valid[1]!.properties).toBeUndefined();
  });

  it('reports every property with the column it reads, for the preview', () => {
    const a = analyzeCsv(csv, opts(), defs);
    expect(a.properties.map((p) => [p.key, p.column])).toEqual([
      ['tier', 2],
      ['loyalty_points', 3],
      ['plan', 4],
    ]);
  });

  it('a file with no column for a property leaves it out of the values', () => {
    const a = analyzeCsv('Phone,Name\n+919812300500,Asha\n', opts(), defs);
    expect(a.valid[0]!.properties).toBeUndefined();
    expect(a.properties.every((p) => p.column === null)).toBe(true);
  });

  it('a value that does not fit its property rejects the row with that reason', () => {
    const bad = 'Phone,Name,Customer tier\n+919812300500,Asha,Platinum\n';
    const a = analyzeCsv(bad, opts(), defs);
    expect(a.valid).toHaveLength(0);
    expect(a.invalid).toEqual([
      expect.objectContaining({ row: 2, reason: 'invalid_property_value' }),
    ]);
  });

  it('a request that ignores a property column leaves its values out', () => {
    const a = analyzeCsv(csv, opts({ propertyMapping: { tier: null } }), defs);
    expect(a.properties.find((p) => p.key === 'tier')!.column).toBeNull();
    expect(a.valid[0]!.properties).toEqual({ loyalty_points: 1200, plan: ['pro'] });
  });

  it('extractRow reads property columns only when given them', () => {
    const header = ['Phone', 'Name', 'Customer tier'];
    const mapping = resolveMapping(header);
    const r = extractRow(
      { line: 2, cells: ['+919812300500', 'Asha', 'Gold'] },
      mapping,
      header,
      {},
    );
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.row.properties).toBeUndefined();
  });
});
