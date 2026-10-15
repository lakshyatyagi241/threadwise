import { describe, expect, it } from 'vitest';
import { CAPABILITIES_UNKNOWN } from './resolve';
import { PLANNED_SETTINGS } from './settings-planned';
import {
  compareSettings,
  defaultSection,
  resolveSettings,
  tileForPath,
  tilesForScreen,
  toSettingsSections,
} from './settings-resolve';
import { SETTINGS_SECTIONS, settingsTile, type SettingsTile } from './settings-types';
import type { Capabilities } from './types';

const tile = (id: string, over: Partial<SettingsTile> = {}): SettingsTile =>
  settingsTile({ id, section: 'data', href: `/${id}`, icon: 'x', ...over });
const caps = (p: string[] | null, f: string[] | null, c: string[] | null): Capabilities => ({
  permissions: p && new Set(p),
  planFeatures: f && new Set(f),
  channels: c && new Set(c),
});

describe('settingsTile', () => {
  it('points the copy at settings.tiles.<id> unless told otherwise', () => {
    const t = tile('tax-rates');
    expect(t.labelKey).toBe('settings.tiles.tax-rates.label');
    expect(t.descriptionKey).toBe('settings.tiles.tax-rates.description');
    expect(t.keywordsKey).toBe('settings.tiles.tax-rates.keywords');
    expect(tile('x', { labelKey: 'other.key' }).labelKey).toBe('other.key');
  });
});

describe('resolveSettings gates', () => {
  const tiles = [
    tile('read', { gates: { permission: 'record.x.read' } }),
    tile('plan', { gates: { planFeature: 'analytics' } }),
    tile('wa', { gates: { channel: 'whatsapp' } }),
    tile('open'),
  ];

  it('shows everything, unlocked, while capabilities are unknown', () => {
    const r = resolveSettings(tiles, CAPABILITIES_UNKNOWN);
    expect(r).toHaveLength(4);
    expect(r.every((t) => !t.locked && !t.comingSoon)).toBe(true);
  });

  it('hides a tile the person lacks the permission or the channel for', () => {
    const ids = resolveSettings(tiles, caps([], ['analytics'], [])).map((t) => t.id);
    expect(ids).toEqual(['open', 'plan']);
  });

  it('keeps a tile the person may open', () => {
    const ids = resolveSettings(tiles, caps(['record.x.read'], ['analytics'], ['whatsapp'])).map(
      (t) => t.id,
    );
    expect(ids).toEqual(['open', 'plan', 'read', 'wa']);
  });

  it('keeps a plan-gated tile visible but locked', () => {
    const plan = resolveSettings(tiles, caps(['record.x.read'], [], ['whatsapp'])).find(
      (t) => t.id === 'plan',
    );
    expect(plan?.locked).toBe(true);
  });
});

describe('resolveSettings with planned tiles', () => {
  const real = [tile('tax', { section: 'business', href: '/tax-rates' })];
  const planned = [
    tile('tax', { section: 'business', href: '/tax-rates' }),
    tile('by-href', { section: 'business', href: '/tax-rates' }),
    tile('roles', { section: 'people', href: '/roles' }),
  ];

  it('marks planned tiles as coming soon and lets a real tile take over by id or by address', () => {
    const r = resolveSettings(real, CAPABILITIES_UNKNOWN, { planned });
    expect(r.map((t) => [t.id, t.comingSoon])).toEqual([
      ['tax', false],
      ['roles', true],
    ]);
  });

  it('never locks a planned tile, and still applies gates to it', () => {
    const gated = [tile('p', { gates: { planFeature: 'f', permission: 'k' } })];
    expect(resolveSettings([], caps(['k'], [], []), { planned: gated })[0]).toMatchObject({
      comingSoon: true,
      locked: false,
    });
    expect(resolveSettings([], caps([], [], []), { planned: gated })).toEqual([]);
  });

  it('orders by section, then order, then id', () => {
    const list = [
      tile('b', { section: 'security', order: 1 }),
      tile('a', { section: 'security', order: 1 }),
      tile('z', { section: 'channels', order: 50 }),
      tile('m', { section: 'business' }),
    ];
    expect(resolveSettings(list, CAPABILITIES_UNKNOWN).map((t) => t.id)).toEqual([
      'z',
      'm',
      'a',
      'b',
    ]);
    expect(compareSettings(list[0]!, list[2]!)).toBeGreaterThan(0);
  });
});

describe('toSettingsSections', () => {
  it('lists only the sections that have a tile, in section order', () => {
    const r = resolveSettings(
      [
        tile('a', { section: 'security' }),
        tile('b', { section: 'channels' }),
        tile('c', { section: 'security' }),
      ],
      CAPABILITIES_UNKNOWN,
    );
    expect(toSettingsSections(r).map((s) => [s.section, s.tiles.map((t) => t.id)])).toEqual([
      ['channels', ['b']],
      ['security', ['a', 'c']],
    ]);
  });

  it('is empty for no tiles', () => expect(toSettingsSections([])).toEqual([]));

  it('hides a section whose tiles are all gated away', () => {
    const r = resolveSettings(
      [tile('a', { section: 'people', gates: { permission: 'no' } })],
      caps([], [], []),
    );
    expect(toSettingsSections(r)).toEqual([]);
  });
});

describe('tilesForScreen', () => {
  const r = resolveSettings(
    [
      tile('props', { href: '/contact-properties', shortcutFrom: ['/contacts'] }),
      tile('stages', { href: '/contact-stages', shortcutFrom: ['/contacts', '/segments'] }),
      tile('other', { href: '/other', shortcutFrom: ['/deals'] }),
      tile('none', { href: '/none' }),
    ],
    CAPABILITIES_UNKNOWN,
    { planned: [tile('soon', { href: '/soon', shortcutFrom: ['/contacts'] })] },
  );

  it('offers the tiles that name the screen, or a parent of it, and never a planned one', () => {
    expect(tilesForScreen(r, '/contacts').map((t) => t.id)).toEqual(['props', 'stages']);
    expect(tilesForScreen(r, '/contacts/42').map((t) => t.id)).toEqual(['props', 'stages']);
    expect(tilesForScreen(r, '/segments').map((t) => t.id)).toEqual(['stages']);
  });

  it('respects path boundaries and offers nothing elsewhere', () => {
    expect(tilesForScreen(r, '/contacts-archive')).toEqual([]);
    expect(tilesForScreen(r, '/tasks')).toEqual([]);
  });

  it('stays out of the Settings pages and of the screen the tile opens', () => {
    expect(tilesForScreen(r, '/settings/data')).toEqual([]);
    expect(tilesForScreen(r, '/contact-properties')).toEqual([]);
  });

  it('is empty for a role that may not open the tile, because the gates already hid it', () => {
    const gated = resolveSettings(
      [
        tile('g', {
          href: '/g',
          shortcutFrom: ['/contacts'],
          gates: { permission: 'record.x.read' },
        }),
      ],
      caps([], [], []),
    );
    expect(tilesForScreen(gated, '/contacts')).toEqual([]);
  });
});

describe('defaultSection', () => {
  const sections = (list: SettingsTile[], planned: SettingsTile[] = []) =>
    toSettingsSections(resolveSettings(list, CAPABILITIES_UNKNOWN, { planned }));

  it('opens on the first section that has a built screen', () => {
    const s = sections([tile('a', { section: 'business' })], [tile('b', { section: 'channels' })]);
    expect(defaultSection(s)).toBe('business');
  });
  it('falls back to the first section when every tile is planned, and to nothing when there are none', () => {
    expect(defaultSection(sections([], [tile('b', { section: 'channels' })]))).toBe('channels');
    expect(defaultSection([])).toBeUndefined();
  });
});

describe('tileForPath', () => {
  const r = resolveSettings(
    [
      tile('appt', { href: '/appointments/types' }),
      tile('acct', { href: '/account' }),
      tile('sec', { href: '/account/security' }),
    ],
    CAPABILITIES_UNKNOWN,
    { planned: [tile('soon', { href: '/soon' })] },
  );

  it('finds the tile whose screen the address belongs to, children included', () => {
    expect(tileForPath(r, '/appointments/types/12/edit')?.id).toBe('appt');
    expect(tileForPath(r, '/account/profile')?.id).toBe('acct');
  });

  it('takes the longest matching address and respects path boundaries', () => {
    expect(tileForPath(r, '/account/security')?.id).toBe('sec');
    expect(tileForPath(r, '/account-archive')).toBeUndefined();
    expect(tileForPath(r, '/appointments')).toBeUndefined();
  });

  it('ignores planned tiles', () => expect(tileForPath(r, '/soon')).toBeUndefined());
});

describe('the planned tiles', () => {
  it('use known sections and unique ids and addresses', () => {
    const ids = PLANNED_SETTINGS.map((t) => t.id);
    const hrefs = PLANNED_SETTINGS.map((t) => t.href);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const t of PLANNED_SETTINGS)
      expect(SETTINGS_SECTIONS as readonly string[]).toContain(t.section);
  });

  // Telegram, LINE, Viber, WeChat, WhatsApp, SMS and Email are built: their tiles are declared in features/<domain>/settings.ts and left this list.
  it('cover the channels that left the menu, as Soon tiles', () => {
    const channels = PLANNED_SETTINGS.filter((t) => t.section === 'channels').map((t) => t.id);
    for (const id of ['channels', 'wa-links']) {
      expect(channels, id).toContain(id);
    }
  });
});
