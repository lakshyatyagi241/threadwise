import { describe, expect, it } from 'vitest';
import { moveActive, pickerOptions } from './picker';

const hit = (id: string, name: string, industry: string | null = null) => ({ id, name, industry });
const on = { canCreate: true, settled: true };

describe('pickerOptions', () => {
  it('lists the hits as they came, with the industry', () => {
    const rows = pickerOptions([hit('1', 'Acme', 'Retail'), hit('2', 'Acme Labs')], '', on);
    expect(rows).toEqual([
      { kind: 'company', id: '1', name: 'Acme', industry: 'Retail' },
      { kind: 'company', id: '2', name: 'Acme Labs', industry: null },
    ]);
  });

  it('offers "create" last for a name that no hit has exactly', () => {
    const rows = pickerOptions([hit('1', 'Acme Labs')], '  Acme  ', on);
    expect(rows.at(-1)).toEqual({ kind: 'create', name: 'Acme' });
    expect(rows).toHaveLength(2);
  });

  it('does not offer a second copy of a name that is already in the list, whatever its case', () => {
    expect(pickerOptions([hit('1', 'ACME')], 'acme', on).some((r) => r.kind === 'create')).toBe(
      false,
    );
  });

  it('offers nothing to create for blank text, an over-long name, someone who may not create, or an unsettled search', () => {
    const none = (text: string, o = on) =>
      pickerOptions([], text, o).some((r) => r.kind === 'create');
    expect(none('')).toBe(false);
    expect(none('   ')).toBe(false);
    expect(none('x'.repeat(192))).toBe(false);
    expect(none('x'.repeat(191))).toBe(true);
    expect(none('Acme', { canCreate: false, settled: true })).toBe(false);
    expect(none('Acme', { canCreate: true, settled: false })).toBe(false);
  });
});

describe('moveActive', () => {
  it('starts at the first row going down and the last going up, then wraps', () => {
    expect(moveActive(-1, 1, 3)).toBe(0);
    expect(moveActive(-1, -1, 3)).toBe(2);
    expect(moveActive(2, 1, 3)).toBe(0);
    expect(moveActive(0, -1, 3)).toBe(2);
    expect(moveActive(1, 1, 3)).toBe(2);
  });

  it('has nothing to highlight in an empty list', () => {
    expect(moveActive(0, 1, 0)).toBe(-1);
  });
});
