import { describe, expect, it, beforeEach } from 'vitest';
import type { QuickAccessTile } from '@crm/contracts';
import { chromeStore } from '@/components/shell/shell-chrome';
import { dismissKey } from './announcements/announcement-bars';
import {
  filterCards,
  loadShortcuts,
  normaliseHref,
  addShortcut,
  moveShortcut,
  storageKey,
  toolCards,
} from './more/more-model';
import {
  addCustom,
  clampHandleTop,
  customRowProblem,
  draftFromTiles,
  pinnedCount,
  toItems,
  toggleKey,
} from './quick-access/logic';
import { TOUR_STEPS, planTour, shouldRunTour } from './tour/tour-model';

const tile = (
  key: string | null,
  custom = false,
  label = key ?? 'x',
  url = `/${key}`,
): QuickAccessTile => ({
  key,
  label,
  desc: '',
  url,
  icon: 'link',
  custom,
});

describe('quick access editor (WD-ASHELL-022)', () => {
  it('starts from what is pinned: pages by key, own links apart', () => {
    const d = draftFromTiles([tile('inbox'), tile(null, true, 'KB', 'https://example.com/kb')]);
    expect(d.keys).toEqual(['inbox']);
    expect(d.custom).toEqual([{ label: 'KB', url: 'https://example.com/kb' }]);
  });

  it('refuses an eleventh pin and says so, but always allows unpinning', () => {
    let d = draftFromTiles([]);
    for (const k of [
      'inbox',
      'contacts',
      'campaigns',
      'broadcasts',
      'templates',
      'flows',
      'scheduled',
      'catalog',
      'deals',
      'analytics',
    ]) {
      d = toggleKey(d, k).draft;
    }
    expect(pinnedCount(d)).toBe(10);
    const refused = toggleKey(d, 'store');
    expect(refused.refused).toBe(true);
    expect(refused.draft).toBe(d);
    expect(addCustom(d).refused).toBe(true);
    expect(toggleKey(d, 'inbox').draft.keys).not.toContain('inbox');
  });

  it('posts pinned pages then only the links that are complete and safe', () => {
    const items = toItems({
      keys: ['webhooks'],
      custom: [
        { label: 'KB', url: 'https://example.com/kb' },
        { label: '', url: '/x' },
        { label: 'bad', url: 'javascript:alert(1)' },
        { label: 'evil', url: '//evil.example' },
      ],
    });
    expect(items).toEqual([{ key: 'webhooks' }, { label: 'KB', url: 'https://example.com/kb' }]);
    expect(customRowProblem({ label: 'bad', url: '//evil.example' })).toBe('unsafe');
    expect(customRowProblem({ label: '', url: '/x' })).toBe('incomplete');
    expect(customRowProblem({ label: '', url: '' })).toBeNull();
  });

  it('keeps the drawer grip 8 pixels from the top and 60 from the bottom', () => {
    expect(clampHandleTop(300, 900)).toBe(300);
    expect(clampHandleTop(-50, 900)).toBe(8);
    expect(clampHandleTop(5000, 900)).toBe(840);
    expect(clampHandleTop(Number.NaN, 900)).toBe(120);
  });
});

describe('guided tour (WD-ASHELL-023)', () => {
  it('runs on /dashboard for someone who has not seen it, and never elsewhere', () => {
    expect(shouldRunTour({ run: true, pathname: '/dashboard', forced: false })).toBe(true);
    expect(shouldRunTour({ run: false, pathname: '/dashboard', forced: false })).toBe(false);
    expect(shouldRunTour({ run: true, pathname: '/contacts', forced: false })).toBe(false);
  });

  it('?tour=1 replays it for someone who has seen it', () => {
    expect(shouldRunTour({ run: false, pathname: '/dashboard', forced: true })).toBe(true);
  });

  it('skips steps whose anchor is missing: in sidebar mode only the welcome and dashboard steps remain', () => {
    const sidebar = planTour(
      (s) => s.includes('kpi') || s.includes('pipeline') || s.includes('new-campaign'),
    );
    expect(sidebar.map((s) => s.id)).toEqual(['welcome', 'kpi', 'newCampaign', 'pipeline']);
    expect(planTour(() => true)).toHaveLength(TOUR_STEPS.length);
    expect(planTour(() => false).map((s) => s.id)).toEqual(['welcome']);
  });
});

describe('announcement dismissal (WD-ASHELL-026)', () => {
  it('keys the browser flag by the group, so a new member brings the bar back', () => {
    expect(dismissKey('a-b')).toBe('dismissed:ann-a-b');
    expect(dismissKey('a-b-c')).not.toBe(dismissKey('a-b'));
  });
});

describe('shell chrome (WD-ASHELL-012)', () => {
  beforeEach(() => chromeStore.reset());
  it('hides while any page asks, and shows again only when the last one leaves', () => {
    expect(chromeStore.hidden()).toBe(false);
    chromeStore.hide();
    chromeStore.hide();
    chromeStore.show();
    expect(chromeStore.hidden()).toBe(true);
    chromeStore.show();
    expect(chromeStore.hidden()).toBe(false);
    chromeStore.show();
    expect(chromeStore.hidden()).toBe(false);
  });
});

describe('More hub (WD-ASHELL-020, 021)', () => {
  const nav = [
    {
      id: 'contacts',
      group: 'audience',
      labelKey: 'k.contacts',
      href: '/contacts',
      locked: false,
      comingSoon: false,
    },
    {
      id: 'flows',
      group: 'automation',
      labelKey: 'k.flows',
      href: '/flows',
      locked: true,
      comingSoon: false,
    },
    {
      id: 'support',
      group: 'help',
      labelKey: 'k.support',
      href: '/support',
      locked: false,
      comingSoon: false,
    },
    {
      id: 'settings',
      group: 'settings',
      labelKey: 'k.settings',
      href: '/settings',
      locked: false,
      comingSoon: false,
    },
    {
      id: 'soon',
      group: 'inbox',
      labelKey: 'k.soon',
      href: '/soon',
      locked: false,
      comingSoon: true,
    },
  ] as const;
  const cards = toolCards(nav as never, [], new Set(['/more']));

  it('lists reachable screens only, never Settings or screens that are not built', () => {
    expect(cards.map((c) => c.id)).toEqual(['nav:contacts', 'nav:flows', 'nav:support']);
  });

  it('tabs show only their category; unmapped screens appear under All only', () => {
    expect(filterCards(cards, 'data').map((c) => c.id)).toEqual(['nav:contacts']);
    expect(filterCards(cards, 'automation').map((c) => c.id)).toEqual(['nav:flows']);
    expect(filterCards(cards, 'help').map((c) => c.id)).toEqual(['nav:support']);
    expect(filterCards(cards, 'all')).toHaveLength(3);
  });

  it('keeps a crown card non-clickable data: it is flagged locked', () => {
    expect(cards.find((c) => c.id === 'nav:flows')?.locked).toBe(true);
  });

  it('normalises shortcut addresses like WaDesk', () => {
    expect(normaliseHref('')).toBe('#');
    expect(normaliseHref('reports')).toBe('/reports');
    expect(normaliseHref('//x')).toBe('/x');
    expect(normaliseHref('https://a.b')).toBe('https://a.b');
    expect(normaliseHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(normaliseHref('#top')).toBe('#top');
  });

  const defaults = [{ id: 'd1', title: 'D1', subtitle: '', href: '/d1', icon: 'link' }];
  it('shows the defaults for a fresh browser, bad JSON or a non-list', () => {
    expect(loadShortcuts(null, defaults)).toEqual(defaults);
    expect(loadShortcuts('{oops', defaults)).toEqual(defaults);
    expect(loadShortcuts('{"a":1}', defaults)).toEqual(defaults);
  });

  it('stores a custom link "Reports" to "reports" as /reports, and drops custom entries with no address', () => {
    const list = addShortcut(defaults, {
      id: 'c1',
      title: 'Reports',
      subtitle: '',
      href: 'reports',
      icon: 'link',
      custom: true,
    });
    expect(list?.at(-1)?.href).toBe('/reports');
    expect(
      addShortcut(defaults, {
        id: 'c2',
        title: 'x',
        subtitle: '',
        href: '',
        icon: 'link',
        custom: true,
      }),
    ).toBeNull();
    expect(
      addShortcut(defaults, {
        id: 'c3',
        title: '',
        subtitle: '',
        href: '/a',
        icon: 'link',
        custom: true,
      }),
    ).toBeNull();
    const raw = JSON.stringify([
      { id: 'c9', title: 'Gone', href: '', custom: true },
      { id: 'ok', title: 'Ok', href: '/ok' },
    ]);
    expect(loadShortcuts(raw, defaults).map((s) => s.id)).toEqual(['ok']);
  });

  it('cannot add the same preset twice, and moves entries up and down', () => {
    expect(addShortcut(defaults, defaults[0]!)).toBeNull();
    const two = [...defaults, { id: 'd2', title: 'D2', subtitle: '', href: '/d2', icon: 'link' }];
    expect(moveShortcut(two, 'd2', -1).map((s) => s.id)).toEqual(['d2', 'd1']);
    expect(moveShortcut(two, 'd1', -1).map((s) => s.id)).toEqual(['d1', 'd2']);
  });

  it('reads a separate list for each workspace', () => {
    expect(storageKey(1)).not.toBe(storageKey(2));
    expect(storageKey(7)).toBe('wadesk:more-page-shortcuts:v1:ws7');
  });
});
