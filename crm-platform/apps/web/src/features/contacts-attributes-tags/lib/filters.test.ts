import { describe, expect, it } from 'vitest';
import { contactFilterBody, DEFAULT_FILTERS, listQuery } from '../api/contacts';
import { filtersToSearch, hasActiveFilter, parseFilters } from './filters';

const GROUP = '294dca7c-5806-4548-9035-dcca9befc7b1';

describe('parseFilters', () => {
  it('falls back to the defaults for an empty or hand-edited URL', () => {
    expect(parseFilters(new URLSearchParams(''))).toEqual(DEFAULT_FILTERS);
    const bad = parseFilters(
      new URLSearchParams(
        'group=abc&tag=1&per=7&stage=DROP TABLE&order=sideways&consent=maybe&imported=yes&page=-3',
      ),
    );
    expect(bad).toEqual(DEFAULT_FILTERS);
  });

  it('reads valid values', () => {
    const f = parseFilters(
      new URLSearchParams(
        `q=acme&group=${GROUP}&stage=qualified&per=100&order=asc&consent=unsubscribed&imported=1`,
      ),
    );
    expect(f).toMatchObject({
      q: 'acme',
      group: GROUP,
      lifecycleStage: 'qualified',
      limit: 100,
      order: 'asc',
      consent: 'unsubscribed',
      imported: true,
    });
  });

  it('reads the page number and falls back to 1 for anything else', () => {
    expect(parseFilters(new URLSearchParams('page=7')).page).toBe(7);
    for (const bad of ['0', '-1', '2.5', 'x', '']) {
      expect(parseFilters(new URLSearchParams(`page=${bad}`)).page, bad).toBe(1);
    }
    expect(parseFilters(new URLSearchParams('page=99999999')).page).toBe(100_000);
  });

  it('defaults to ten rows per screen', () => {
    expect(DEFAULT_FILTERS.limit).toBe(10);
    expect(parseFilters(new URLSearchParams('per=10')).limit).toBe(10);
  });

  it('accepts the no_group view only for the group filter', () => {
    expect(parseFilters(new URLSearchParams('group=no_group')).group).toBe('no_group');
    expect(parseFilters(new URLSearchParams('tag=no_group')).tag).toBe('');
  });
});

describe('filtersToSearch', () => {
  it('writes only what differs from the defaults, so the clean URL is bare', () => {
    expect(filtersToSearch(DEFAULT_FILTERS)).toBe('');
    expect(filtersToSearch({ ...DEFAULT_FILTERS, q: ' acme ', limit: 50 })).toBe('?q=acme&per=50');
    expect(filtersToSearch({ ...DEFAULT_FILTERS, page: 1 })).toBe('');
    expect(filtersToSearch({ ...DEFAULT_FILTERS, page: 3 })).toBe('?page=3');
  });

  it('round-trips', () => {
    const f = {
      ...DEFAULT_FILTERS,
      q: 'x y',
      group: GROUP,
      tag: GROUP,
      lifecycleStage: 'new',
      consent: 'subscribed' as const,
      imported: true,
      order: 'asc' as const,
      limit: 100 as const,
      page: 4,
    };
    expect(parseFilters(new URLSearchParams(filtersToSearch(f)))).toEqual(f);
  });
});

describe('hasActiveFilter', () => {
  it('ignores page size and sort order', () => {
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, limit: 100, order: 'asc', page: 4 })).toBe(false);
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, q: 'a' })).toBe(true);
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, group: 'no_group' })).toBe(true);
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, consent: 'unsubscribed' })).toBe(true);
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, imported: true })).toBe(true);
  });
});

describe('contactFilterBody / listQuery', () => {
  it('maps the screen filters to the API filter shape', () => {
    expect(
      contactFilterBody({
        q: ' acme ',
        lifecycleStage: 'new',
        group: GROUP,
        tag: GROUP,
        consent: 'unsubscribed',
        imported: true,
        segment: '',
      }),
    ).toEqual({
      q: 'acme',
      lifecycleStage: 'new',
      groupId: GROUP,
      noGroup: undefined,
      tagIds: [GROUP],
      unsubscribed: true,
      imported: true,
    });
  });

  it('sends "no group" as its own flag, not as a group id', () => {
    const b = contactFilterBody({ ...DEFAULT_FILTERS, group: 'no_group' });
    expect(b.noGroup).toBe(true);
    expect(b.groupId).toBeUndefined();
  });

  it('leaves unset filters out, so "subscribed" is false and "all" is absent', () => {
    expect(contactFilterBody(DEFAULT_FILTERS).unsubscribed).toBeUndefined();
    expect(contactFilterBody({ ...DEFAULT_FILTERS, consent: 'subscribed' }).unsubscribed).toBe(
      false,
    );
    expect(contactFilterBody({ ...DEFAULT_FILTERS, q: '  ' }).q).toBeUndefined();
  });

  it('keeps the page number out of the request filter (the cursor carries the position)', () => {
    expect(listQuery({ ...DEFAULT_FILTERS, page: 5 })).not.toHaveProperty('page');
    expect(listQuery({ ...DEFAULT_FILTERS, page: 5 })).toEqual(listQuery(DEFAULT_FILTERS));
  });

  it('asks the list for group and tag chips and the matching total', () => {
    expect(listQuery(DEFAULT_FILTERS)).toMatchObject({
      expand: 'groups,tags',
      includeTotal: true,
      order: 'desc',
    });
  });
});

describe('segment filter', () => {
  const SEG = '4f0a1d6e-6b52-4a55-9d0a-0d8a3b2f1c11';

  it('reads a segment id from the URL and ignores anything that is not a uuid', () => {
    expect(parseFilters(new URLSearchParams(`segment=${SEG}`)).segment).toBe(SEG);
    expect(parseFilters(new URLSearchParams('segment=abc')).segment).toBe('');
    expect(parseFilters(new URLSearchParams("segment=1' OR '1'='1")).segment).toBe('');
    expect(parseFilters(new URLSearchParams('')).segment).toBe('');
  });

  it('writes it back, together with the other filters (they combine)', () => {
    expect(filtersToSearch({ ...DEFAULT_FILTERS, segment: SEG })).toBe(`?segment=${SEG}`);
    expect(filtersToSearch({ ...DEFAULT_FILTERS, segment: SEG, tag: SEG, q: 'a' })).toBe(
      `?q=a&tag=${SEG}&segment=${SEG}`,
    );
    const f = parseFilters(new URLSearchParams(`stage=won&segment=${SEG}&page=2`));
    expect(parseFilters(new URLSearchParams(filtersToSearch(f).slice(1)))).toEqual(f);
  });

  it('counts as an active filter, so the empty state offers "Reset filters"', () => {
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, segment: SEG })).toBe(true);
  });

  it('is sent as segmentId in the list request and in the saved filter of a bulk action or export', () => {
    expect(listQuery({ ...DEFAULT_FILTERS, segment: SEG })).toMatchObject({ segmentId: SEG });
    expect(contactFilterBody({ ...DEFAULT_FILTERS, segment: SEG }).segmentId).toBe(SEG);
    expect(contactFilterBody(DEFAULT_FILTERS).segmentId).toBeUndefined();
    expect(listQuery(DEFAULT_FILTERS).segmentId).toBeUndefined();
  });
});

describe('ad-hoc conditions (rules)', () => {
  const RULES = JSON.stringify({
    type: 'group',
    combinator: 'and',
    children: [{ type: 'condition', field: 'source', operator: 'equals', value: 'web' }],
  });
  it('round-trips through the URL and reaches the list and bulk bodies', () => {
    const f = parseFilters(new URLSearchParams({ rules: RULES }));
    expect(f.rules).toBe(RULES);
    expect(parseFilters(new URLSearchParams(filtersToSearch(f).slice(1))).rules).toBe(RULES);
    expect(contactFilterBody(f).rules).toBe(RULES);
    expect(hasActiveFilter(f)).toBe(true);
  });
  it('text that is not JSON, or too long, reads as none', () => {
    expect(parseFilters(new URLSearchParams({ rules: 'nope' })).rules).toBe('');
    expect(parseFilters(new URLSearchParams({ rules: `[${'1,'.repeat(11_000)}1]` })).rules).toBe(
      '',
    );
    expect(contactFilterBody(DEFAULT_FILTERS).rules).toBeUndefined();
  });
});
