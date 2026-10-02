import { describe, expect, it } from 'vitest';
import type { OperatorNavItem } from '@/features/auth-registration-security/platform/operator-nav';
import {
  activeLeafId,
  buildConsoleNav,
  formatCount,
  initiallyOpenGroups,
  isGroup,
  leaves,
} from './console-nav';

const item = (id: string, href: string, groupKey: string): OperatorNavItem => ({
  id,
  href,
  labelKey: `l.${id}`,
  groupKey,
});

const items = [
  item('security', '/admin/security', 'g.security'),
  item('security-events', '/admin/security/events', 'g.security'),
  item('plans', '/admin/plans', 'g.plans'),
];

describe('buildConsoleNav', () => {
  const nav = buildConsoleNav(items);

  it('starts with the console overview leaf', () => {
    expect(nav[0]).toMatchObject({ id: 'overview', href: '/admin' });
    expect(isGroup(nav[0]!)).toBe(false);
  });

  it('groups items by heading in first-seen order', () => {
    const groups = nav.filter(isGroup);
    expect(groups.map((g) => g.id)).toEqual(['g.security', 'g.plans']);
    expect(groups[0]!.children.map((c) => c.id)).toEqual(['security', 'security-events']);
  });

  it('marks only the plans leaf as carrying a count', () => {
    expect(
      leaves(nav)
        .filter((l) => l.badgeKey)
        .map((l) => [l.id, l.badgeKey]),
    ).toEqual([['plans', 'plans']]);
  });
});

describe('activeLeafId', () => {
  const nav = buildConsoleNav(items);

  it('picks the longest matching prefix, not the shorter parent', () => {
    expect(activeLeafId('/admin/security/events', nav)).toBe('security-events');
    expect(activeLeafId('/admin/security', nav)).toBe('security');
  });

  it('matches sub-pages of a leaf', () => {
    expect(activeLeafId('/admin/plans/abc', nav)).toBe('plans');
  });

  it('lights Overview only on /admin itself', () => {
    expect(activeLeafId('/admin', nav)).toBe('overview');
    expect(activeLeafId('/admin/unknown', nav)).toBeNull();
  });

  it('does not match a path that merely shares a string prefix', () => {
    expect(activeLeafId('/admin/plans-archive', nav)).toBeNull();
  });
});

describe('initiallyOpenGroups', () => {
  const nav = buildConsoleNav(items);

  it('opens only the group that holds the active leaf', () => {
    expect([...initiallyOpenGroups(nav, 'security-events')]).toEqual(['g.security']);
  });

  it('opens nothing for a top-level leaf or no match', () => {
    expect(initiallyOpenGroups(nav, 'overview').size).toBe(0);
    expect(initiallyOpenGroups(nav, null).size).toBe(0);
  });
});

describe('formatCount', () => {
  it.each([
    [null, null],
    [undefined, null],
    [0, null],
    [-4, null],
    [Number.NaN, null],
    [7, '7'],
    [999, '999'],
    [1000, '1k'],
    [1234, '1.2k'],
    [9999, '10k'],
    [10_000, '10k'],
    [12_500, '13k'],
    [999_499, '999k'],
    [999_500, '1M'],
    [999_999, '1M'],
    [1_200_000, '1.2M'],
    [12_400_000, '12M'],
  ])('%s -> %s', (input, expected) => {
    expect(formatCount(input as number | null | undefined)).toBe(expected);
  });
});
