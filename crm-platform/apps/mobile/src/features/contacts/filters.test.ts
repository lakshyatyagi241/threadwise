import { activeFilterCount, cleanFilters } from './filters';

describe('contact filters', () => {
  it('counts the groups that are on, not the search text', () => {
    expect(activeFilterCount({})).toBe(0);
    expect(activeFilterCount({ q: 'aar', lifecycleStage: 'new', unsubscribed: false })).toBe(2);
    expect(activeFilterCount({ source: '' })).toBe(0);
  });

  it('counts the owner and the created date once each', () => {
    expect(activeFilterCount({ ownerIds: 'a,b', unassigned: true })).toBe(1);
    expect(activeFilterCount({ unassigned: true })).toBe(1);
    expect(activeFilterCount({ createdFrom: '2026-10-01', createdTo: '2026-10-05' })).toBe(1);
    expect(activeFilterCount({ createdTo: '2026-10-05' })).toBe(1);
    expect(activeFilterCount({ ownerIds: '', createdFrom: '' })).toBe(0);
  });

  it('keeps the owners, the no-owner flag and the created window, and drops them when empty', () => {
    expect(
      cleanFilters({
        ownerIds: 'a,b',
        unassigned: true,
        createdFrom: '2026-10-01',
        createdTo: '2026-10-05',
      }),
    ).toEqual({
      ownerIds: 'a,b',
      unassigned: true,
      createdFrom: '2026-10-01',
      createdTo: '2026-10-05',
    });
    expect(cleanFilters({ ownerIds: '', unassigned: undefined, createdTo: '' })).toEqual({});
  });

  it('drops what is empty so it is not sent', () => {
    expect(cleanFilters({ q: '  ', source: ' ', lifecycleStage: undefined })).toEqual({});
    expect(cleanFilters({ q: ' aar ', source: ' api ', unsubscribed: false })).toEqual({
      q: 'aar',
      source: 'api',
      unsubscribed: false,
    });
  });
});
