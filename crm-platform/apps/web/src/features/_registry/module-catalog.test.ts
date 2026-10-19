import {
  GENERIC_PERSONA_DEFINITION,
  hiddenModuleIds,
  moduleIdSchema,
  parseOperatorOverrides,
  parseWorkspaceOverrides,
  referencedModuleIds,
  resolvePersona,
} from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  ADD_TARGETS,
  CORE_SECTIONS,
  RELATED_SECTIONS,
} from '../contacts-attributes-tags/lib/sections';
import { HOME_CARDS } from './home-cards.generated';
import { MODULE_CATALOG } from './module-catalog.generated';
import { buildModuleCatalog } from './module-catalog';
import { NAV } from './nav.generated';
import { PLANNED_NAV } from './planned';
import { SETTINGS } from './settings.generated';
import { PLANNED_SETTINGS } from './settings-planned';
import { settingsTile } from './settings-types';

const ids = new Set(MODULE_CATALOG.map((e) => e.id));

describe('persona module catalog (generated from the registries)', () => {
  it('has only well-formed ids, each exactly once', () => {
    for (const entry of MODULE_CATALOG) {
      expect(moduleIdSchema.safeParse(entry.id).success, entry.id).toBe(true);
      expect(entry.id.startsWith(`${entry.kind}:`), entry.id).toBe(true);
    }
    expect(ids.size).toBe(MODULE_CATALOG.length);
  });

  it('lists every menu entry, Settings tile, contact tab, contact action and Home card', () => {
    for (const item of [...NAV, ...PLANNED_NAV])
      expect(ids.has(`nav:${item.id}`), item.id).toBe(true);
    for (const tile of [...SETTINGS, ...PLANNED_SETTINGS]) {
      expect(ids.has(`tile:${tile.id}`), tile.id).toBe(true);
    }
    for (const s of [...CORE_SECTIONS, ...RELATED_SECTIONS]) {
      expect(ids.has(`section:contact.${s}`), s).toBe(true);
    }
    for (const a of ADD_TARGETS) expect(ids.has(`action:contact.${a}`), a).toBe(true);
    for (const c of HOME_CARDS) expect(ids.has(`card:dashboard.${c.id}`), c.id).toBe(true);
  });

  it('knows the ids the spec names for the clinic persona', () => {
    for (const id of [
      'nav:dashboard',
      'nav:inbox',
      'nav:contacts',
      'nav:appointments',
      'nav:deals',
      'tile:booking-types',
      'tile:appointment-settings',
      'section:contact.meetings',
      'section:contact.appointments',
      'action:contact.meeting',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('marks an entry that only exists as "coming soon" as planned, and a built one as not', () => {
    const planned = buildModuleCatalog({
      nav: [],
      plannedNav: [{ id: 'later', group: 'sales', labelKey: 'x', href: '/later' }],
      settings: [],
      plannedSettings: [settingsTile({ id: 'soon', section: 'data', href: '/soon', icon: 'x' })],
      homeCards: [],
      contactSections: [],
      contactActions: [],
    });
    expect(planned.map((e) => [e.id, e.planned])).toEqual([
      ['nav:later', true],
      ['tile:soon', true],
    ]);
    const built = buildModuleCatalog({
      nav: [{ id: 'later', group: 'sales', labelKey: 'x', href: '/later' }],
      plannedNav: [{ id: 'later', group: 'sales', labelKey: 'x', href: '/later' }],
      settings: [],
      plannedSettings: [],
      homeCards: [],
      contactSections: [],
      contactActions: [],
    });
    expect(built).toHaveLength(1);
    expect(built[0]?.planned).toBe(false);
  });

  it('every id the seeded personas name exists in the catalog (risk 3: ids drift)', () => {
    for (const definition of [GENERIC_PERSONA_DEFINITION]) {
      const missing = referencedModuleIds(definition).filter((id) => !ids.has(id));
      expect(missing).toEqual([]);
    }
    // and the check itself bites
    const bad = {
      ...GENERIC_PERSONA_DEFINITION,
      modules: { default: 'show' as const, ids: { 'nav:no-such-screen': 'hide' as const } },
    };
    expect(referencedModuleIds(bad).filter((id) => !ids.has(id))).toEqual(['nav:no-such-screen']);
  });
});

describe('golden: the generic persona hides nothing (Hard Rule 1)', () => {
  it('resolves to "show" for every id of the real catalog, with empty overrides, with the switch on, and with no view at all', () => {
    for (const showAll of [false, true]) {
      const view = resolvePersona(
        {
          definition: GENERIC_PERSONA_DEFINITION,
          operator: parseOperatorOverrides({}),
          workspace: parseWorkspaceOverrides({}),
          showAll,
        },
        ids,
      );
      expect(view.unknownIds).toEqual([]);
      expect(hiddenModuleIds(view, ids).size).toBe(0);
    }
    expect(hiddenModuleIds(null, ids).size).toBe(0);
  });
});
