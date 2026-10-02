import { describe, expect, it } from 'vitest';
import type { Segment } from '../api/schemas';
import { copyName, countState, filterSegments, needsAttention, pageWindow } from './hub';
import { DEFAULT_HUB, cleanSegmentParam, hubToSearch, parseHub } from './url';

const seg = (over: Partial<Segment>): Segment => ({
  id: 'id',
  name: 'Segment',
  description: null,
  color: null,
  visibility: 'private',
  ownerId: 'u1',
  ownerName: 'Asha',
  rules: {
    type: 'group',
    combinator: 'and',
    children: [{ type: 'condition', field: 'source', operator: 'is_empty' }],
  },
  rulesVersion: 1,
  memberCount: 3,
  countApproximate: false,
  memberCountAt: null,
  invalidConditions: [],
  canEdit: true,
  rowVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const rows = [
  seg({ id: 'a', name: 'Hot leads', updatedAt: '2026-03-01T00:00:00.000Z' }),
  seg({
    id: 'b',
    name: 'Cold leads',
    visibility: 'shared',
    ownerId: 'u2',
    ownerName: 'Ravi',
    updatedAt: '2026-04-01T00:00:00.000Z',
  }),
  seg({
    id: 'c',
    name: 'Customers',
    description: 'paid at least once',
    updatedAt: '2026-02-01T00:00:00.000Z',
  }),
];

describe('hub list', () => {
  it('shows the newest change first', () => {
    expect(filterSegments(rows, { q: '', show: 'all' }, 'u1').map((s) => s.id)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('searches name, description and owner, ignoring case', () => {
    expect(filterSegments(rows, { q: 'LEADS', show: 'all' }, 'u1').map((s) => s.id)).toEqual([
      'b',
      'a',
    ]);
    expect(filterSegments(rows, { q: 'paid', show: 'all' }, 'u1').map((s) => s.id)).toEqual(['c']);
    expect(filterSegments(rows, { q: 'ravi', show: 'all' }, 'u1').map((s) => s.id)).toEqual(['b']);
  });

  it('Mine keeps the signed-in person own segments, Shared the shared ones', () => {
    expect(filterSegments(rows, { q: '', show: 'mine' }, 'u1').map((s) => s.id)).toEqual([
      'a',
      'c',
    ]);
    expect(filterSegments(rows, { q: '', show: 'shared' }, 'u1').map((s) => s.id)).toEqual(['b']);
    expect(filterSegments(rows, { q: '', show: 'mine' }, null)).toEqual([]);
  });
});

describe('page window', () => {
  const list = Array.from({ length: 53 }, (_, i) => i);
  it('slices a page and reports the range', () => {
    expect(pageWindow(list, 2, 25)).toMatchObject({
      page: 2,
      pages: 3,
      from: 26,
      to: 50,
      total: 53,
    });
    expect(pageWindow(list, 3, 25)).toMatchObject({ from: 51, to: 53 });
  });
  it('a page past the end lands on the last one; an empty list is page 1 of 1', () => {
    expect(pageWindow(list, 99, 25).page).toBe(3);
    expect(pageWindow([], 4, 25)).toMatchObject({ page: 1, pages: 1, from: 0, to: 0, items: [] });
  });
});

describe('counts and warnings', () => {
  it('reads unknown, exact and approximate counts', () => {
    expect(countState({ memberCount: null, countApproximate: false })).toEqual({ kind: 'unknown' });
    expect(countState({ memberCount: 12, countApproximate: false })).toEqual({
      kind: 'exact',
      count: 12,
    });
    expect(countState({ memberCount: 12000, countApproximate: true })).toEqual({
      kind: 'approximate',
      count: 12000,
    });
  });

  it('flags a segment with a condition pointing at something deleted', () => {
    expect(needsAttention(seg({}))).toBe(false);
    expect(
      needsAttention(
        seg({
          invalidConditions: [
            { path: 'children.0', field: 'tags', reason: 'tag_deleted', message: 'x', refs: ['t'] },
          ],
        }),
      ),
    ).toBe(true);
  });
});

describe('duplicate name', () => {
  it('adds (copy), then (copy 2) while the name is taken (any case), within the limit', () => {
    expect(copyName('Hot leads', ['Other'], 191)).toBe('Hot leads (copy)');
    expect(copyName('Hot leads', ['hot leads (COPY)'], 191)).toBe('Hot leads (copy 2)');
    expect(copyName('x'.repeat(191), [], 191)).toHaveLength(191);
    expect(copyName('x'.repeat(191), [], 191).endsWith(' (copy)')).toBe(true);
  });
});

describe('url state', () => {
  const p = (s: string) => parseHub(new URLSearchParams(s));

  it('defaults a clean URL and writes only what differs', () => {
    expect(p('')).toEqual(DEFAULT_HUB);
    expect(hubToSearch(DEFAULT_HUB)).toBe('');
    expect(hubToSearch({ ...DEFAULT_HUB, q: ' vip ', show: 'shared', per: 50, page: 3 })).toBe(
      '?q=vip&show=shared&per=50&page=3',
    );
  });

  it('falls back to the defaults for anything malformed', () => {
    expect(p('show=everyone&per=7&page=-2')).toEqual(DEFAULT_HUB);
    expect(p('page=abc').page).toBe(1);
    expect(p('page=999999999').page).toBe(100000);
    expect(p(`q=${'x'.repeat(300)}`).q).toHaveLength(200);
  });

  it('round-trips', () => {
    const v = { q: 'a b', show: 'mine' as const, per: 100 as const, page: 2 };
    expect(p(hubToSearch(v).slice(1))).toEqual(v);
  });

  it('accepts only a uuid as the contacts segment param', () => {
    expect(cleanSegmentParam('4f0a1d6e-6b52-4a55-9d0a-0d8a3b2f1c11')).toBe(
      '4f0a1d6e-6b52-4a55-9d0a-0d8a3b2f1c11',
    );
    expect(cleanSegmentParam('not-an-id')).toBe('');
    expect(cleanSegmentParam("1' OR '1'='1")).toBe('');
    expect(cleanSegmentParam(null)).toBe('');
  });
});
