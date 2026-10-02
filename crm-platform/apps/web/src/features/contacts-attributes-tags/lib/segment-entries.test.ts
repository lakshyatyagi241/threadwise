import { describe, expect, it } from 'vitest';
import { filtersOfPicker, moveActive, pickerEntries, pickerValue } from './segment-entries';

const input = (q = '') => ({
  q,
  counts: { total: 1200, imported: 3, noGroup: 24 },
  groups: [{ id: 'g1', name: 'VIP customers', color: '#7C3AED', memberCount: 5 }],
  segments: [
    { id: 's1', name: 'Hot leads', color: null, memberCount: 40, countApproximate: false },
    { id: 's2', name: 'Big list', color: '#22C55E', memberCount: 12000, countApproximate: true },
    { id: 's3', name: 'Never counted', color: null, memberCount: null, countApproximate: false },
  ],
  labels: {
    all: 'All contacts',
    imported: 'Imported',
    noGroup: 'No group',
    approx: (n: number) => `about ${n}`,
  },
});

describe('Select Segment dropdown rows', () => {
  it('lists the quick lists, then Groups, then Segments, each with its live count', () => {
    const rows = pickerEntries(input());
    expect(rows.map((r) => `${r.section}:${r.label}:${r.hint ?? ''}`)).toEqual([
      'contacts:All contacts:1,200',
      'contacts:Imported:3',
      'contacts:No group:24',
      'groups:VIP customers:5',
      'segments:Hot leads:40',
      'segments:Big list:about 12000',
      'segments:Never counted:',
    ]);
  });

  it('keeps the group id and the prefixed segment id as values', () => {
    const rows = pickerEntries(input());
    expect(rows.find((r) => r.label === 'VIP customers')?.value).toBe('g1');
    expect(rows.find((r) => r.label === 'Hot leads')?.value).toBe('segment:s1');
  });

  it('searches every section by name, ignoring case', () => {
    expect(pickerEntries(input('HOT')).map((r) => r.label)).toEqual(['Hot leads']);
    expect(pickerEntries(input('vip')).map((r) => r.section)).toEqual(['groups']);
    expect(pickerEntries(input('zzz'))).toEqual([]);
  });

  it('moves the active row and stops at both ends', () => {
    expect(moveActive(0, 'ArrowUp', 5)).toBe(0);
    expect(moveActive(4, 'ArrowDown', 5)).toBe(4);
    expect(moveActive(1, 'ArrowDown', 5)).toBe(2);
    expect(moveActive(3, 'ArrowUp', 0)).toBe(0);
  });
});

describe('dropdown value <-> filters', () => {
  it('a segment wins over a group, a group over the quick lists', () => {
    expect(pickerValue({ group: 'g1', imported: false, segment: 's1' })).toBe('segment:s1');
    expect(pickerValue({ group: 'g1', imported: true, segment: '' })).toBe('imported');
    expect(pickerValue({ group: 'g1', imported: false, segment: '' })).toBe('g1');
    expect(pickerValue({ group: '', imported: false, segment: '' })).toBe('');
  });

  it('picking one replaces the previous pick', () => {
    expect(filtersOfPicker('segment:s1')).toEqual({ segment: 's1', group: '', imported: false });
    expect(filtersOfPicker('g1')).toEqual({ segment: '', group: 'g1', imported: false });
    expect(filtersOfPicker('imported')).toEqual({ segment: '', group: '', imported: true });
    expect(filtersOfPicker('no_group')).toEqual({
      segment: '',
      group: 'no_group',
      imported: false,
    });
    expect(filtersOfPicker('')).toEqual({ segment: '', group: '', imported: false });
  });
});
