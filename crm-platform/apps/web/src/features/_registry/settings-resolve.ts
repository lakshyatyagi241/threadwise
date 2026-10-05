import { evaluateGates, mergePlanned } from './resolve';
import {
  SETTINGS_SECTIONS,
  type ResolvedSettingsTile,
  type SettingsSection,
  type SettingsTile,
} from './settings-types';
import type { Capabilities } from './types';

export interface ResolveSettingsOptions {
  /**
   * Tiles for screens that are not built yet (`settings-planned.ts`). They appear as disabled "Soon" tiles, except where
   * a domain already declares the same id or the same address: the real tile wins, so a domain switches its tile on just
   * by declaring it.
   */
  planned?: readonly SettingsTile[];
}

/** Section, then `order`, then id: the one sort the Settings area uses. */
export function compareSettings(a: SettingsTile, b: SettingsTile): number {
  return (
    SETTINGS_SECTIONS.indexOf(a.section) - SETTINGS_SECTIONS.indexOf(b.section) ||
    (a.order ?? 100) - (b.order ?? 100) ||
    a.id.localeCompare(b.id)
  );
}

/** The menu's gate rules applied to the tiles: a tile the person cannot use is gone, a plan-gated one is locked. */
export function resolveSettings(
  tiles: readonly SettingsTile[],
  caps: Capabilities,
  options: ResolveSettingsOptions = {},
): ResolvedSettingsTile[] {
  const out: ResolvedSettingsTile[] = [];
  for (const { item, comingSoon } of mergePlanned(tiles, options.planned ?? [])) {
    const gate = evaluateGates(item.gates, caps, comingSoon);
    if (gate) out.push({ ...item, locked: gate.locked, comingSoon });
  }
  return out.sort(compareSettings);
}

export interface SettingsSectionTiles {
  section: SettingsSection;
  tiles: ResolvedSettingsTile[];
}

/** The sections that have at least one visible tile, in section order, each with its tiles. */
export function toSettingsSections(tiles: readonly ResolvedSettingsTile[]): SettingsSectionTiles[] {
  return SETTINGS_SECTIONS.map((section) => ({
    section,
    tiles: tiles.filter((t) => t.section === section),
  })).filter((s) => s.tiles.length > 0);
}

/**
 * The section `/settings` opens on: the first one with a built screen (a section of only "Soon" tiles is a poor landing page),
 * else the first one there is.
 */
export function defaultSection(
  sections: readonly SettingsSectionTiles[],
): SettingsSection | undefined {
  return (sections.find((s) => s.tiles.some((t) => !t.comingSoon)) ?? sections[0])?.section;
}

/** `/tax-rates` matches `/tax-rates` and `/tax-rates/new`, never `/tax-rates-archive`. */
function covers(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The live tile whose screen the address belongs to (the longest matching address, so `/appointments/types` is the
 * Booking types tile and not the Appointments menu entry). The Settings pages themselves belong to no tile.
 */
export function tileForPath(
  tiles: readonly ResolvedSettingsTile[],
  pathname: string,
): ResolvedSettingsTile | undefined {
  let best: ResolvedSettingsTile | undefined;
  for (const tile of tiles) {
    if (tile.comingSoon || !covers(pathname, tile.href)) continue;
    if (!best || tile.href.length > best.href.length) best = tile;
  }
  return best;
}

/**
 * The tiles to offer as a gear on the screen at `pathname`: live tiles that name it (or a parent of it) in `shortcutFrom`.
 * Nothing is offered on the Settings pages, nor on a tile's own screen (the "Back to Settings" breadcrumb covers that). The
 * tiles arrive already filtered by the person's permissions, so a role that cannot open a tile never gets its shortcut.
 */
export function tilesForScreen(
  tiles: readonly ResolvedSettingsTile[],
  pathname: string,
): ResolvedSettingsTile[] {
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return [];
  if (tileForPath(tiles, pathname)) return [];
  return tiles.filter(
    (tile) => !tile.comingSoon && tile.shortcutFrom?.some((from) => covers(pathname, from)),
  );
}
