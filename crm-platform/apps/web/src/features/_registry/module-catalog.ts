import { moduleId, type ModuleCatalogEntry } from '@crm/contracts';
import { mergePlanned } from './resolve';
import type { SettingsTile } from './settings-types';
import type { HomeCard, NavItem } from './types';

/**
 * The persona module catalog (docs/specs/persona-profiles.md, sections 3 and 13 P0): every id a persona may show or hide, derived from
 * the registries the app already has, so a new screen adds its id with no second list to keep.
 *
 *   nav:<id>                 every menu entry (`features/<domain>/nav.ts`), plus the planned "coming soon" ones
 *   tile:<id>                every Settings tile (`settings.ts`), plus the planned ones
 *   section:contact.<id>     the tabs of the contact page
 *   card:dashboard.<id>      the Home cards (`home-cards.ts`)
 *   action:contact.<id>      the contact action bar's buttons
 *
 * `scripts/gen-registry.mjs` writes `module-catalog.generated.ts`, which feeds this function with the generated registries.
 */
export interface CatalogSources {
  nav: readonly NavItem[];
  plannedNav: readonly NavItem[];
  settings: readonly SettingsTile[];
  plannedSettings: readonly SettingsTile[];
  homeCards: readonly HomeCard[];
  contactSections: readonly string[];
  contactActions: readonly string[];
}

export function buildModuleCatalog(src: CatalogSources): ModuleCatalogEntry[] {
  const out: ModuleCatalogEntry[] = [];
  for (const { item, comingSoon } of mergePlanned(src.nav, src.plannedNav)) {
    out.push({ id: moduleId('nav', item.id), kind: 'nav', group: item.group, planned: comingSoon });
  }
  for (const { item, comingSoon } of mergePlanned(src.settings, src.plannedSettings)) {
    out.push({
      id: moduleId('tile', item.id),
      kind: 'tile',
      group: item.section,
      planned: comingSoon,
    });
  }
  for (const id of src.contactSections) {
    out.push({ id: moduleId('section', id), kind: 'section', group: 'contact', planned: false });
  }
  for (const card of src.homeCards) {
    out.push({ id: moduleId('card', card.id), kind: 'card', group: 'dashboard', planned: false });
  }
  for (const id of src.contactActions) {
    out.push({ id: moduleId('action', id), kind: 'action', group: 'contact', planned: false });
  }
  return out;
}
