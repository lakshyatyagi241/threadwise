import type { TaxPresetRow } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { codesToApply, defaultPicked, inForce, pickedHasDefault } from './tax-presets';

const row = (over: Partial<TaxPresetRow>): TaxPresetRow => ({
  code: 'A',
  name: 'A',
  type: 'vat',
  rate: '20',
  inclusive: false,
  isDefault: false,
  region: null,
  description: null,
  effectiveFrom: '2020-01-01',
  effectiveTo: null,
  components: null,
  exists: false,
  ...over,
});

describe('tax presets', () => {
  const rows = [
    row({ code: 'STD', isDefault: true }),
    row({ code: 'OLD', effectiveTo: '2024-12-31' }),
    row({ code: 'NEXT', effectiveFrom: '2027-01-01' }),
    row({ code: 'HAVE', exists: true }),
  ];
  it('in force is inclusive at both ends', () => {
    expect(inForce(rows[1]!, '2024-12-31')).toBe(true);
    expect(inForce(rows[1]!, '2025-01-01')).toBe(false);
    expect(inForce(rows[2]!, '2026-12-31')).toBe(false);
  });
  it('ticks what is new and in force', () => {
    expect([...defaultPicked(rows, '2026-10-02')]).toEqual(['STD']);
  });
  it('never sends rows that exist', () => {
    expect(codesToApply(rows, new Set(['STD', 'HAVE', 'OLD']))).toEqual(['STD', 'OLD']);
  });
  it('knows when the default is among the picked', () => {
    expect(pickedHasDefault(rows, new Set(['STD']))).toBe(true);
    expect(pickedHasDefault(rows, new Set(['OLD']))).toBe(false);
  });
});
