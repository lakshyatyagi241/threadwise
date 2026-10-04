import { describe, expect, it } from 'vitest';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import type { ResolvedNavItem } from '@/features/_registry/types';
import { buildPalette, jumpSearch, searchPalette } from './command-palette-model';
import { activeBarKey, demotedBarItems, resolveTopBar } from './topbar-model';

const item = (id: string, href: string, over: Partial<ResolvedNavItem> = {}): ResolvedNavItem => ({
  id,
  group: 'overview',
  labelKey: `shell.nav.${id}`,
  href,
  locked: false,
  comingSoon: false,
  ...over,
});
const tile = (
  id: string,
  href: string,
  over: Partial<ResolvedSettingsTile> = {},
): ResolvedSettingsTile => ({
  id,
  section: 'channels',
  labelKey: `settings.tiles.${id}.label`,
  href,
  icon: 'gear',
  locked: false,
  comingSoon: false,
  ...over,
});

const NAV = [
  item('dashboard', '/dashboard'),
  item('inbox', '/inbox'),
  item('campaigns', '/campaigns'),
  item('templates', '/templates'),
  item('contacts', '/contacts'),
  item('flows', '/flows', { comingSoon: true }),
];
const TILES = [tile('whatsapp', '/channels/whatsapp')];

describe('top bar (WD-ASHELL-013)', () => {
  it('lists the saved keys in the saved order, More last, skipping what is not built', () => {
    const bar = resolveTopBar(
      ['dashboard', 'team-inbox', 'wa-campaigns', 'flows', 'templates', 'devices', 'more'],
      NAV,
      TILES,
    );
    expect(bar.map((b) => b.key)).toEqual([
      'dashboard',
      'team-inbox',
      'wa-campaigns',
      'templates',
      'devices',
      'more',
    ]);
    expect(bar.at(-1)).toMatchObject({ key: 'more', href: '/more' });
  });

  it('puts contacts first for an owner with bar ["contacts","dashboard"], then Dashboard, then More', () => {
    const bar = resolveTopBar(['contacts', 'dashboard', 'more'], NAV, TILES);
    expect(bar.map((b) => b.key)).toEqual(['contacts', 'dashboard', 'more']);
  });

  it('keeps a locked item visible and linking, flagged for a crown', () => {
    const bar = resolveTopBar(['flows', 'more'], [item('flows', '/flows', { locked: true })], []);
    expect(bar[0]).toMatchObject({ key: 'flows', href: '/flows', locked: true });
  });

  it('shows only what the person can open: an item the registry dropped is not drawn', () => {
    const bar = resolveTopBar(
      ['dashboard', 'contacts', 'more'],
      [item('dashboard', '/dashboard')],
      [],
    );
    expect(bar.map((b) => b.key)).toEqual(['dashboard', 'more']);
  });

  it('marks the longest matching entry active, and More for the More page', () => {
    const bar = resolveTopBar(['dashboard', 'team-inbox', 'more'], NAV, TILES);
    expect(activeBarKey(bar, '/inbox/42')).toBe('team-inbox');
    expect(activeBarKey(bar, '/more')).toBe('more');
    expect(activeBarKey(bar, '/somewhere-else')).toBeUndefined();
  });

  it('offers Dashboard, Campaigns, Flows and Templates as cards when the bar dropped them', () => {
    const demoted = demotedBarItems(['contacts', 'more'], NAV, TILES);
    expect(demoted.map((d) => d.key)).toEqual(['dashboard', 'wa-campaigns', 'templates']);
    expect(
      demotedBarItems(['dashboard', 'templates', 'more'], NAV, TILES).map((d) => d.key),
    ).toEqual(['wa-campaigns']);
  });
});

describe('command palette (WD-ASHELL-019)', () => {
  const label = (k: string) => (k.startsWith('shell.nav.') ? k.slice(10) : k);
  const entries = buildPalette(
    [
      item('analytics', '/analytics'),
      item('contacts', '/contacts'),
      item('flows', '/flows', { comingSoon: true }),
    ],
    [tile('plans', '/account/plans')],
    label,
    [
      {
        id: 'a',
        title: 'Profile',
        description: '',
        href: '/account/profile',
        tag: 'account',
        keywords: '',
      },
    ],
  );

  it('lists only built screens, the Settings tiles and the account entries', () => {
    expect(entries.map((e) => e.href)).toEqual([
      '/analytics',
      '/contacts',
      '/account/plans',
      '/account/profile',
    ]);
    expect(entries.find((e) => e.href === '/account/plans')?.tag).toBe('plan');
  });

  it('shows the first eight with an empty query', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      title: `Page ${i}`,
      description: '',
      href: `/p${i}`,
      tag: 'page' as const,
      keywords: '',
    }));
    expect(searchPalette(many, '')).toHaveLength(8);
    expect(searchPalette(many, 'page')).toHaveLength(12);
  });

  it('finds a screen by a hidden keyword ("roas" finds Analytics)', () => {
    expect(searchPalette(entries, 'roas').map((e) => e.href)).toEqual(['/analytics']);
    expect(searchPalette(entries, 'zzz')).toEqual([]);
  });
});

describe('jump box (WD-ASHELL-016)', () => {
  const index = [
    { label: 'Broadcasts', group: 'Campaigns', href: '/broadcasts' },
    { label: 'Contacts', group: 'Audience', href: '/contacts' },
    ...Array.from({ length: 12 }, (_, i) => ({ label: `Bro ${i}`, group: 'X', href: `/b${i}` })),
  ];
  it('matches label and group, case-insensitively, eight at most', () => {
    expect(jumpSearch(index, 'bro')[0]).toMatchObject({ label: 'Broadcasts', group: 'Campaigns' });
    expect(jumpSearch(index, 'bro')).toHaveLength(8);
    expect(jumpSearch(index, 'AUDIENCE').map((r) => r.label)).toEqual(['Contacts']);
    expect(jumpSearch(index, '')).toEqual([]);
  });
});
