import { DEFAULT_FILTERS, hasActiveFilter } from './filters';

describe('hasActiveFilter', () => {
  it('is off for the default list', () => {
    expect(hasActiveFilter(DEFAULT_FILTERS)).toBe(false);
  });
  it('is on for each thing that narrows or reorders the list', () => {
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, status: 'resolved' })).toBe(true);
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, q: 'meera' })).toBe(true);
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, channelId: 'c1' })).toBe(true);
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, labels: ['l1'] })).toBe(true);
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, archived: true })).toBe(true);
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, agentIds: ['a1'] })).toBe(true);
  });
  it('is on for the oldest-first order alone, so its chip and the filter dot show', () => {
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, sort: 'old' })).toBe(true);
  });
  it('does not count the tab: it is a view, not a filter', () => {
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, tab: 'mine' })).toBe(false);
  });
});
