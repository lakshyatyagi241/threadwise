import { describe, expect, it } from 'vitest';
import type { OperatorNavItem } from '@/features/auth-registration-security/platform/operator-nav';
import type { ConsoleSection } from './console-layout';
import {
  activeLeafId,
  activeStatusBadge,
  activeStatusBadgeInfo,
  buildConsoleNav,
  CONSOLE_NAV_ITEMS,
  emptySection,
  formatCount,
  groupByHeading,
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

/** A layout of its own, so these tests do not move when the real menu is reorganised. */
const layout: ConsoleSection[] = [
  {
    id: 'access',
    icon: 'shield',
    blocks: [{ caption: 'security', items: ['security', 'security-events'] }],
  },
  { id: 'plans', icon: 'tag', blocks: [{ items: ['plans', 'not-built-yet'] }] },
  { id: 'empty', icon: 'tag', blocks: [{ items: ['also-not-built'] }] },
];

describe('buildConsoleNav', () => {
  const nav = buildConsoleNav(items, layout);

  it('starts with the console overview leaf', () => {
    expect(nav[0]).toMatchObject({ id: 'overview', href: '/admin' });
    expect(isGroup(nav[0]!)).toBe(false);
  });

  it('builds the sections of the layout, in its order, with their icon and heading key', () => {
    const groups = nav.filter(isGroup);
    expect(groups.map((g) => g.id)).toEqual(['access', 'plans']);
    expect(groups[0]).toMatchObject({
      labelKey: 'admin-console-shell.nav.sections.access',
      icon: 'shield',
    });
    expect(groups[0]!.children.map((c) => c.id)).toEqual(['security', 'security-events']);
  });

  it('puts the block heading on the first page of the block only', () => {
    const [access, plans] = nav.filter(isGroup);
    expect(access!.children.map((c) => c.captionKey)).toEqual([
      'admin-console-shell.nav.captions.security',
      undefined,
    ]);
    expect(plans!.children[0]!.captionKey).toBeUndefined();
  });

  it('skips pages that are not in the menu data, and drops a section left with none', () => {
    expect(leaves(nav).map((l) => l.id)).toEqual([
      'overview',
      'security',
      'security-events',
      'plans',
    ]);
    expect(nav.some((e) => e.id === 'empty')).toBe(false);
  });

  it('puts the caption on the first page that exists when the block starts with a missing one', () => {
    const late: ConsoleSection[] = [
      {
        id: 'access',
        icon: 'shield',
        blocks: [{ caption: 'security', items: ['missing', 'security-events'] }],
      },
    ];
    const group = buildConsoleNav(items, late).filter(isGroup)[0]!;
    expect(group.children[0]).toMatchObject({
      id: 'security-events',
      captionKey: 'admin-console-shell.nav.captions.security',
    });
  });

  it('keeps a page the layout does not place, under its own heading after the sections', () => {
    const extra = [...items, item('new-page', '/admin/new', 'g.new')];
    const groups = buildConsoleNav(extra, layout).filter(isGroup);
    expect(groups.map((g) => g.id)).toEqual(['access', 'plans', 'g.new']);
    expect(groups[2]).toMatchObject({ labelKey: 'g.new', children: [{ id: 'new-page' }] });
    expect(groups[2]!.icon).toBeUndefined();
  });

  it('places a page once even if the layout lists it twice', () => {
    const twice: ConsoleSection[] = [
      { id: 'a', icon: 'tag', blocks: [{ items: ['plans'] }] },
      { id: 'b', icon: 'tag', blocks: [{ items: ['plans', 'security'] }] },
    ];
    const placed = leaves(buildConsoleNav(items, twice)).map((l) => l.id);
    expect(placed.filter((id) => id === 'plans')).toHaveLength(1);
  });

  it('marks only the plans leaf as carrying a count', () => {
    expect(
      leaves(nav)
        .filter((l) => l.badgeKey)
        .map((l) => [l.id, l.badgeKey]),
    ).toEqual([['plans', 'plans']]);
  });
});

describe('groupByHeading', () => {
  it('groups items by the heading they name, in first-seen order', () => {
    const groups = groupByHeading(items);
    expect(groups.map((g) => g.id)).toEqual(['g.security', 'g.plans']);
    expect(groups[0]!.children.map((c) => c.id)).toEqual(['security', 'security-events']);
  });
});

describe('emptySection', () => {
  it('takes the heading key and icon from the layout', () => {
    expect(emptySection('access', layout)).toEqual({
      id: 'access',
      labelKey: 'admin-console-shell.nav.sections.access',
      icon: 'shield',
      children: [],
    });
  });

  it('still builds a section the layout does not know', () => {
    expect(emptySection('unknown', layout).icon).toBeUndefined();
  });
});

describe('activeLeafId', () => {
  const nav = buildConsoleNav(items, layout);

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
  const nav = buildConsoleNav(items, layout);

  it('opens only the group that holds the active leaf', () => {
    expect([...initiallyOpenGroups(nav, 'security-events')]).toEqual(['access']);
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

describe('status badges', () => {
  const leaf = buildConsoleNav(CONSOLE_NAV_ITEMS)
    .flatMap((e) => ('children' in e ? e.children : [e]))
    .find((l) => l.id === 'node-bridge');

  it('puts a "Not supported" badge on the Node bridge page, driven by a flag and not a count', () => {
    expect(leaf?.statusBadge).toEqual({
      key: 'unofficialOff',
      labelKey: 'admin-console-shell.nav.badges.notSupported',
    });
    expect(leaf?.badgeKey).toBeUndefined();
  });

  it('shows it only while the platform switch is off', () => {
    expect(activeStatusBadge(leaf!, { unofficialOff: 1 })).toBe(
      'admin-console-shell.nav.badges.notSupported',
    );
    // switch on, or the settings could not be read: no badge
    expect(activeStatusBadge(leaf!, {})).toBeNull();
    expect(activeStatusBadge(leaf!, { unofficialOff: 0 })).toBeNull();
  });

  it('says "No workspaces" (neutral) when the switch is on and the allow-list is empty; "Not supported" wins while off', () => {
    expect(activeStatusBadgeInfo(leaf!, { unofficialNoWorkspaces: 1 })).toEqual({
      labelKey: 'admin-console-shell.nav.badges.noWorkspaces',
      tone: 'neutral',
    });
    expect(activeStatusBadgeInfo(leaf!, { unofficialOff: 1, unofficialNoWorkspaces: 1 })).toEqual({
      labelKey: 'admin-console-shell.nav.badges.notSupported',
      tone: 'warning',
    });
    expect(activeStatusBadgeInfo(leaf!, {})).toBeNull();
    expect(activeStatusBadgeInfo(leaf!, { unofficialNoWorkspaces: 0 })).toBeNull();
  });

  it('leaves every other page without one', () => {
    const others = buildConsoleNav(CONSOLE_NAV_ITEMS)
      .flatMap((e) => ('children' in e ? e.children : [e]))
      .filter((l) => l.id !== 'node-bridge');
    expect(others.some((l) => l.statusBadge)).toBe(false);
  });
});
