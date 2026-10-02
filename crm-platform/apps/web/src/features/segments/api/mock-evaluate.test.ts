import type { ContactResponse, SegmentGroup } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { evaluate, matches } from './mock-evaluate';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const contact = (over: Partial<ContactResponse>): ContactResponse =>
  ({
    id: 'c',
    displayId: null,
    name: 'Aarav Sharma',
    firstName: 'Aarav',
    lastName: 'Sharma',
    email: 'aarav@example.com',
    phone: '+919876543210',
    companyId: null,
    ownerId: 'u1',
    lifecycleState: 'active',
    lifecycleStage: 'qualified',
    status: 'open',
    leadScore: 40,
    source: 'web',
    isUnsubscribed: false,
    isArchived: false,
    customFields: { plan: 'pro', interests: ['golf', 'tennis'], visits: 4 },
    lastActivityAt: day(10),
    createdAt: day(100),
    updatedAt: day(5),
    tags: [{ id: 't1', name: 'VIP', color: null }],
    groups: [{ id: 'g1', name: 'Customers', color: null }],
    ...over,
  }) as ContactResponse;

const group = (...children: SegmentGroup['children']): SegmentGroup => ({ type: 'group', combinator: 'and', children });
const c = (field: string, operator: string, value?: unknown) =>
  ({ type: 'condition', field, operator, ...(value === undefined ? {} : { value }) }) as SegmentGroup['children'][number];
const test = (cond: SegmentGroup['children'][number], over: Partial<ContactResponse> = {}) =>
  matches(contact(over), group(cond), NOW);

describe('how conditions are evaluated (the semantics the screens rely on)', () => {
  it('text ignores case; equals needs the whole value, contains a part, starts_with the start', () => {
    expect(test(c('source', 'equals', 'WEB'))).toBe(true);
    expect(test(c('source', 'equals', 'we'))).toBe(false);
    expect(test(c('email', 'contains', 'EXAMPLE'))).toBe(true);
    expect(test(c('name', 'starts_with', 'aar'))).toBe(true);
    expect(test(c('name', 'not_contains', 'zzz'))).toBe(true);
    expect(test(c('source', 'not_equals', 'web'))).toBe(false);
  });

  it('empty means null, blank or an empty list', () => {
    expect(test(c('source', 'is_empty'), { source: null })).toBe(true);
    expect(test(c('source', 'is_empty'), { source: '' })).toBe(true);
    expect(test(c('source', 'is_not_empty'))).toBe(true);
    expect(test(c('tags', 'is_empty'), { tags: [] })).toBe(true);
    expect(test(c('lastActivityAt', 'is_empty'), { lastActivityAt: null })).toBe(true);
  });

  it('numbers compare by value, between is inclusive', () => {
    expect(test(c('leadScore', 'gt', 39))).toBe(true);
    expect(test(c('leadScore', 'gt', 40))).toBe(false);
    expect(test(c('leadScore', 'gte', 40))).toBe(true);
    expect(test(c('leadScore', 'lt', 41))).toBe(true);
    expect(test(c('leadScore', 'between', { from: 40, to: 50 }))).toBe(true);
    expect(test(c('leadScore', 'between', { from: 41, to: 50 }))).toBe(false);
    expect(test(c('custom.visits', 'equals', 4))).toBe(true);
    expect(test(c('leadScore', 'gt', 0), { leadScore: null })).toBe(false);
  });

  it('options and lists: in, not_in; tags and groups: has_any, has_all, has_none', () => {
    expect(test(c('lifecycleStage', 'in', ['new', 'qualified']))).toBe(true);
    expect(test(c('lifecycleStage', 'not_in', ['new', 'won']))).toBe(true);
    expect(test(c('tags', 'has_any', ['t1', 't9']))).toBe(true);
    expect(test(c('tags', 'has_all', ['t1', 't9']))).toBe(false);
    expect(test(c('tags', 'has_none', ['t9']))).toBe(true);
    expect(test(c('groups', 'has_all', ['g1']))).toBe(true);
    expect(test(c('custom.interests', 'has_any', ['golf']))).toBe(true);
    expect(test(c('custom.plan', 'equals', 'pro'))).toBe(true);
  });

  it('booleans: unsubscribed and imported', () => {
    expect(test(c('unsubscribed', 'is_false'))).toBe(true);
    expect(test(c('unsubscribed', 'is_true'), { isUnsubscribed: true })).toBe(true);
    expect(test(c('imported', 'is_true'), { source: 'import' })).toBe(true);
    expect(test(c('imported', 'is_false'))).toBe(true);
  });

  it('dates compare by calendar day; relative dates by days from now', () => {
    expect(test(c('createdAt', 'on_or_after', '2026-01-01'))).toBe(true);
    expect(test(c('createdAt', 'before', '2026-09-01'))).toBe(true);
    expect(test(c('createdAt', 'between', { from: '2026-05-01', to: '2026-08-01' }))).toBe(true);
    expect(test(c('lastActivityAt', 'in_last_days', 30))).toBe(true);
    expect(test(c('lastActivityAt', 'in_last_days', 5))).toBe(false);
    expect(test(c('lastActivityAt', 'more_than_days_ago', 5))).toBe(true);
    expect(test(c('lastActivityAt', 'more_than_days_ago', 30))).toBe(false);
    expect(test(c('lastActivityAt', 'more_than_days_ago', 30), { lastActivityAt: null })).toBe(false);
  });

  it('search matches every word against name, email and the digits of the phone', () => {
    expect(test(c('search', 'matches', 'sharma aarav'))).toBe(true);
    expect(test(c('search', 'matches', '98765'))).toBe(true);
    expect(test(c('search', 'matches', 'aarav nobody'))).toBe(false);
  });
});

describe('groups', () => {
  it('and needs every child, or needs one, and groups nest', () => {
    const yes = c('source', 'equals', 'web');
    const no = c('source', 'equals', 'ads');
    expect(matches(contact({}), group(yes, no), NOW)).toBe(false);
    expect(matches(contact({}), { type: 'group', combinator: 'or', children: [yes, no] }, NOW)).toBe(true);
    const nested = group(yes, { type: 'group', combinator: 'or', children: [no, c('tags', 'has_any', ['t1'])] });
    expect(matches(contact({}), nested, NOW)).toBe(true);
  });

  it('evaluate keeps only the matching contacts', () => {
    const rows = [contact({ id: 'a' }), contact({ id: 'b', source: 'ads' })];
    expect(evaluate(rows, group(c('source', 'equals', 'web')), NOW).map((r) => r.id)).toEqual(['a']);
  });
});
