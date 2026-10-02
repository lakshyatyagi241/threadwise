import type { NavGates } from './types';

/**
 * The sections of the Settings area, in the order they are listed. A tile picks one. The title and the one-line
 * description of each live in `messages/<locale>/settings.json` under `settings.sections.<id>`. A section's page is
 * `/settings/<id>`, so an id must never equal the first segment of a real screen under `/settings/` (the Team members screen
 * owns `/settings/team`, which is why the section is `people`); `settings-hub/registry.test.ts` checks it.
 */
export const SETTINGS_SECTIONS = [
  'channels',
  'data',
  'business',
  'people',
  'automation',
  'integrations',
  'security',
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/**
 * One tile of the Settings area, declared in `features/<domain>/settings.ts` next to the domain's `nav.ts`; the Settings
 * pages never list domains by hand. It points at a screen that already exists (the screen itself is not part of Settings).
 */
export interface SettingsTile {
  id: string;
  section: SettingsSection;
  /** Message key of the tile's label. A tile that used to be a menu entry keeps that entry's key. */
  labelKey: string;
  /** Message key of the one-line help under the label (and a search target). */
  descriptionKey?: string;
  /** Message key of a comma-separated list of extra search words ("vat, gst, sales tax"). */
  keywordsKey?: string;
  href: string;
  /** Name of a drawn icon (see `features/settings-hub/settings-icons.tsx`); an unknown name gets a dot. */
  icon: string;
  order?: number;
  /** The same gates as a menu entry: a missing permission or channel hides the tile, a missing plan feature locks it. */
  gates?: NavGates;
}

export interface ResolvedSettingsTile extends SettingsTile {
  /** The plan does not include it: shown with an upgrade mark. */
  locked: boolean;
  /** No page exists yet (it comes from `settings-planned.ts`): shown disabled, never a link. */
  comingSoon: boolean;
}

/**
 * Builds a tile whose copy lives in `messages/<locale>/settings.json` under `settings.tiles.<id>` (`label`, `description`,
 * `keywords`), the usual case: one place for the Settings area's wording in every language.
 */
export function settingsTile(
  def: Pick<SettingsTile, 'id' | 'section' | 'href' | 'icon'> & Partial<SettingsTile>,
): SettingsTile {
  return {
    labelKey: `settings.tiles.${def.id}.label`,
    descriptionKey: `settings.tiles.${def.id}.description`,
    keywordsKey: `settings.tiles.${def.id}.keywords`,
    ...def,
  };
}
