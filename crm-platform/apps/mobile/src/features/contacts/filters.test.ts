import { activeFilterCount, cleanFilters } from './filters';

describe('contact filters', () => {
  it('counts the groups that are on, not the search text', () => {
    expect(activeFilterCount({})).toBe(0);
    expect(activeFilterCount({ q: 'aar', lifecycleStage: 'new', unsubscribed: false })).toBe(2);
    expect(activeFilterCount({ source: '' })).toBe(0);
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
