import { describe, expect, it } from 'vitest';
import type { FieldType } from '@crm/contracts';
import {
  cellToPropertyValue,
  exportColumns,
  mapHeaders,
  normaliseHeader,
  propertyToCell,
} from '../../../src/modules/crm/companies/company-csv-rules';
import type { CompanyPropertyDef } from '../../../src/modules/crm/companies/company-properties';

const def = (
  key: string,
  fieldType: FieldType,
  over: Partial<CompanyPropertyDef> = {},
): CompanyPropertyDef => ({
  key,
  label: key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
  fieldType,
  isRequired: false,
  isHidden: false,
  isReadOnly: false,
  isActive: true,
  isSystem: false,
  options: [],
  conditions: [],
  ...over,
});

const defs = [
  def('tier', 'select', { options: ['gold', 'silver'] }),
  def('annual_revenue', 'currency'),
  def('channels', 'multiselect', { options: ['email', 'sms'] }),
  def('vip', 'checkbox'),
  def('renewal', 'date'),
  def('secret', 'text', { isHidden: true }),
  def('old', 'text', { isActive: false }),
  def('calc', 'formula'),
];

describe('mapHeaders (BL-196)', () => {
  it('reads the built-in columns by their usual names, whatever the case and spacing', () => {
    const m = mapHeaders(
      ['Company Name', 'Web site', 'E-mail', 'Telephone', 'Sector', 'Size'],
      defs,
    );
    // "Web site" normalises to "website", "E-mail" to "email"
    expect(m.columns.map((c) => (c?.kind === 'builtin' ? c.field : null))).toEqual([
      'name',
      'website',
      'email',
      'phone',
      'industry',
      'sizeRange',
    ]);
    expect(m.ignored).toEqual([]);
  });

  it('matches a company property by its label or its key, and only an editable one', () => {
    const m = mapHeaders(['Annual revenue', 'tier', 'Secret', 'Old', 'Calc', 'Nothing'], defs);
    expect(m.columns[0]).toMatchObject({ kind: 'property', def: { key: 'annual_revenue' } });
    expect(m.columns[1]).toMatchObject({ kind: 'property', def: { key: 'tier' } });
    // hidden, inactive and computed properties cannot be written, so their columns are ignored and said so
    expect(m.columns.slice(2)).toEqual([null, null, null, null]);
    expect(m.ignored).toEqual(['Secret', 'Old', 'Calc', 'Nothing']);
  });

  it('reads a column named twice once', () => {
    const m = mapHeaders(['name', 'Company', 'tier', 'Tier'], defs);
    expect(m.columns.filter(Boolean)).toHaveLength(2);
    expect(m.ignored).toEqual(['Company', 'Tier']);
  });

  it('a blank header is skipped without complaint', () => {
    expect(mapHeaders(['name', ''], defs).ignored).toEqual([]);
    expect(normaliseHeader(' Size_Range ')).toBe('sizerange');
  });
});

describe('cellToPropertyValue (BL-196)', () => {
  it('a blank cell says nothing', () => {
    expect(cellToPropertyValue(defs[0]!, '  ')).toBeUndefined();
  });

  it('reads numbers (with thousands commas) and passes anything else on as text for the write rules to refuse', () => {
    const revenue = defs[1]!;
    expect(cellToPropertyValue(revenue, '120,000')).toBe(120000);
    expect(cellToPropertyValue(revenue, 'lots')).toBe('lots');
  });

  it('reads a checkbox from the usual words', () => {
    const vip = defs[3]!;
    for (const yes of ['true', 'YES', '1', 'x']) expect(cellToPropertyValue(vip, yes)).toBe(true);
    for (const no of ['false', 'No', '0']) expect(cellToPropertyValue(vip, no)).toBe(false);
    expect(cellToPropertyValue(vip, 'maybe')).toBe('maybe');
  });

  it('matches an option without regard to case and splits a list on ; or |', () => {
    expect(cellToPropertyValue(defs[0]!, 'GOLD')).toBe('gold');
    expect(cellToPropertyValue(defs[0]!, 'platinum')).toBe('platinum');
    expect(cellToPropertyValue(defs[2]!, 'Email; SMS | fax')).toEqual(['email', 'sms', 'fax']);
  });

  it('keeps a date as the text the file has', () => {
    expect(cellToPropertyValue(defs[4]!, '2026-12-31')).toBe('2026-12-31');
  });
});

describe('propertyToCell', () => {
  it('writes lists joined, a checkbox as true and nothing as an empty cell', () => {
    expect(propertyToCell(['email', 'sms'])).toBe('email; sms');
    expect(propertyToCell(true)).toBe('true');
    expect(propertyToCell(12.5)).toBe('12.5');
    expect(propertyToCell(null)).toBe('');
    expect(propertyToCell(undefined)).toBe('');
    expect(propertyToCell({ a: 1 })).toBe('');
  });
});

describe('exportColumns', () => {
  it('by default: every built-in column, then every active stored property (not a computed one)', () => {
    const { columns, unknown } = exportColumns(undefined, defs);
    expect(unknown).toEqual([]);
    expect(columns.map((c) => c.id)).toEqual([
      'name',
      'website',
      'email',
      'phone',
      'industry',
      'sizeRange',
      'address',
      'notes',
      'owner',
      'createdAt',
      'property:tier',
      'property:annual_revenue',
      'property:channels',
      'property:vip',
      'property:renewal',
      'property:secret',
    ]);
    expect(columns.find((c) => c.id === 'property:tier')?.header).toBe('Tier');
  });

  it('a request names the columns and their order; an unknown one is reported, a repeat is dropped', () => {
    const { columns, unknown } = exportColumns(
      ['property:tier', 'name', 'name', 'property:calc', 'bogus'],
      defs,
    );
    expect(columns.map((c) => c.id)).toEqual(['property:tier', 'name']);
    expect(unknown).toEqual(['property:calc', 'bogus']);
  });

  it('a phone and a date are not run through the spreadsheet formula guard (a leading + is not a formula)', () => {
    const { columns } = exportColumns(['phone', 'createdAt', 'name'], defs);
    expect(columns.map((c) => c.text)).toEqual([false, false, true]);
  });
});
