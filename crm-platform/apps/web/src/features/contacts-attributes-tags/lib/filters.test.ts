import { describe, expect, it } from 'vitest';
import { contactFilterBody, DEFAULT_FILTERS, listQuery } from '../api/contacts';
import { filtersToSearch, hasActiveFilter, parseFilters } from './filters';

const GROUP = '294dca7c-5806-4548-9035-dcca9befc7b1';

describe('parseFilters', () => {
  it('falls back to the defaults for an empty or hand-edited URL', () => {
    expect(parseFilters(new URLSearchParams(''))).toEqual(DEFAULT_FILTERS);
    const bad = parseFilters(
      new URLSearchParams(
        'group=abc&tag=1&per=7&stage=DROP TABLE&order=sideways&consent=maybe&imported=yes',
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

  it('accepts the no_group view only for the group filter', () => {
    expect(parseFilters(new URLSearchParams('group=no_group')).group).toBe('no_group');
    expect(parseFilters(new URLSearchParams('tag=no_group')).tag).toBe('');
  });
});

describe('filtersToSearch', () => {
  it('writes only what differs from the defaults, so the clean URL is bare', () => {
    expect(filtersToSearch(DEFAULT_FILTERS)).toBe('');
    expect(filtersToSearch({ ...DEFAULT_FILTERS, q: ' acme ', limit: 50 })).toBe('?q=acme&per=50');
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
    };
    expect(parseFilters(new URLSearchParams(filtersToSearch(f)))).toEqual(f);
  });
});

describe('hasActiveFilter', () => {
  it('ignores page size and sort order', () => {
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, limit: 100, order: 'asc' })).toBe(false);
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

  it('asks the list for group and tag chips and the matching total', () => {
    expect(listQuery(DEFAULT_FILTERS)).toMatchObject({
      expand: 'groups,tags',
      includeTotal: true,
      order: 'desc',
    });
  });
});
