import { describe, expect, it } from 'vitest';
import type { ResolvedNavItem } from '@/features/_registry/types';
import { activeItemId, matchesHref, railSections, toSections } from './nav-model';

const item = (
  id: string,
  group: ResolvedNavItem['group'],
  href: string,
  over: Partial<ResolvedNavItem> = {},
): ResolvedNavItem => ({ id, group, href, labelKey: id, locked: false, comingSoon: false, ...over });

const items = [
  item('dashboard', 'overview', '/dashboard'),
  item('analytics', 'overview', '/analytics', { comingSoon: true }),
  item('contacts', 'audience', '/contacts'),
  item('groups', 'audience', '/contact-groups'),
  item('flows', 'automation', '/flows', { comingSoon: true }),
  item('account', 'settings', '/account'),
];

describe('toSections', () => {
  it('groups consecutive items and keeps their order', () => {
    expect(toSections(items).map((s) => [s.group, s.items.map((i) => i.id)])).toEqual([
      ['overview', ['dashboard', 'analytics']],
      ['audience', ['contacts', 'groups']],
      ['automation', ['flows']],
      ['settings', ['account']],
    ]);
  });
  it('is empty for no items', () => expect(toSections([])).toEqual([]));
});

describe('railSections', () => {
  it('keeps only real screens and drops groups left empty', () => {
    expect(railSections(toSections(items)).map((s) => [s.group, s.items.map((i) => i.id)])).toEqual([
      ['overview', ['dashboard']],
      ['audience', ['contacts', 'groups']],
      ['settings', ['account']],
    ]);
  });
});

describe('matchesHref', () => {
  it('matches the page and its children only at a path boundary', () => {
    expect(matchesHref('/contacts', '/contacts')).toBe(true);
    expect(matchesHref('/contacts/42', '/contacts')).toBe(true);
    expect(matchesHref('/contacts-archive', '/contacts')).toBe(false);
    expect(matchesHref('/contact-groups', '/contacts')).toBe(false);
  });
});

describe('activeItemId', () => {
  it('picks the longest matching real screen', () => {
    const nested = [...items, item('account-security', 'settings', '/account/security')];
    expect(activeItemId(nested, '/account/security')).toBe('account-security');
    expect(activeItemId(nested, '/account/profile')).toBe('account');
  });
  it('never marks a coming-soon entry active', () => {
    expect(activeItemId(items, '/flows')).toBeUndefined();
  });
  it('is undefined off the menu', () => expect(activeItemId(items, '/elsewhere')).toBeUndefined());
});
