import { describe, expect, it } from 'vitest';
import { CHAT_SIDE_MODULES, CRM_SIDE_MODULES, EDITION_PERSONAS } from '@crm/contracts';
import { HELP_DOCS } from '@/features/_registry/help.generated';
import { HOME_CARDS } from '@/features/_registry/home-cards.generated';
import { MODULE_CATALOG } from '@/features/_registry/module-catalog.generated';
import { NAV } from '@/features/_registry/nav.generated';
import { MENU_PLANNED_NAV, PLANNED_NAV } from '@/features/_registry/planned';
import { CAPABILITIES_UNKNOWN, resolveNav, resolveNavAll } from '@/features/_registry/resolve';
import { PLANNED_SETTINGS } from '@/features/_registry/settings-planned';
import { resolveSettings } from '@/features/_registry/settings-resolve';
import { SETTINGS } from '@/features/_registry/settings.generated';
import type { Capabilities, NavGates } from '@/features/_registry/types';
import {
  CORE_SECTIONS,
  RELATED_SECTIONS,
  pageTabs,
  quickTabs,
  visibleSections,
  type SectionId,
} from '@/features/contacts-attributes-tags/lib/sections';
import { helpFor } from '@/features/help-center/view';
import { allowList, denyList, genericView, viewFrom } from './testing';
import { personaHiddenIds } from './server';
import { personaVisibility } from './visibility';

/**
 * GOLDEN PARITY (docs/specs/persona-profiles.md, sections 10 and 12; Hard Rule 1: nothing is lost or changed): for the registries the
 * app really has, the `generic` persona must produce exactly what a workspace without any persona sees today. Until this is green
 * nothing about personas ships.
 *
 * It also holds the other rules of phase 1: a hidden entry draws nothing (no lock, no upsell), Show more modules reveals it with
 * today's lock intact, and a persona never grants what the gates remove.
 */

// --- Capability fixtures built from the real registries ------------------------------------------------------------------------

const gatesOf = (): NavGates[] => [
  ...NAV.map((n) => n.gates ?? {}),
  ...SETTINGS.map((t) => t.gates ?? {}),
  // "Soon" entries (Channels, TikTok, Privacy) are drawn for a person who holds their permission, so the fixtures grant it too.
  ...PLANNED_SETTINGS.map((t) => t.gates ?? {}),
  ...HELP_DOCS.map((d) => d.gates),
];
const collect = (pick: (g: NavGates) => (string | undefined)[]): string[] => [
  ...new Set(
    gatesOf()
      .flatMap(pick)
      .filter((v): v is string => Boolean(v)),
  ),
];
const PERMISSIONS = collect((g) => [g.permission]);
const FEATURES = collect((g) => [g.planFeature, g.app]);
const CHANNELS = collect((g) => [g.channel]);

type Hidden = ReadonlySet<string> | null | undefined;

const caps = (
  permissions: string[] | null,
  planFeatures: string[] | null,
  channels: string[] | null,
  hidden?: Hidden,
): Capabilities => ({
  permissions: permissions && new Set(permissions),
  planFeatures: planFeatures && new Set(planFeatures),
  channels: channels && new Set(channels),
  ...(hidden === undefined ? {} : { hidden }),
});

const FIXTURES: Array<[string, (hidden?: Hidden) => Capabilities]> = [
  [
    'unknown capabilities',
    (h) => ({ ...CAPABILITIES_UNKNOWN, ...(h === undefined ? {} : { hidden: h }) }),
  ],
  ['everything granted', (h) => caps(PERMISSIONS, FEATURES, CHANNELS, h)],
  ['nothing granted', (h) => caps([], [], [], h)],
  [
    'half granted',
    (h) =>
      caps(
        PERMISSIONS.filter((_, i) => i % 2 === 0),
        FEATURES.filter((_, i) => i % 2 === 0),
        CHANNELS.filter((_, i) => i % 2 === 0),
        h,
      ),
  ],
  ['permissions only', (h) => caps(PERMISSIONS, null, null, h)],
];

const ids = (items: ReadonlyArray<{ id: string }>) => items.map((i) => i.id);

describe('golden: the generic persona changes nothing', () => {
  const genericHidden = personaHiddenIds(genericView());

  it('the generic persona hides no module of the real catalog', () => {
    expect(genericHidden).not.toBeNull();
    expect([...genericHidden!]).toEqual([]);
    expect(MODULE_CATALOG.length).toBeGreaterThan(100);
  });

  for (const [name, make] of FIXTURES) {
    describe(name, () => {
      const today = make(); // a workspace with no persona: the shape callers had before phase 1
      const withGeneric = make(genericHidden);
      const withUnknown = make(null);

      it('menu: resolveNav and resolveNavAll are byte-for-byte the same', () => {
        const opts = { planned: MENU_PLANNED_NAV };
        expect(resolveNav(NAV, withGeneric, opts)).toEqual(resolveNav(NAV, today, opts));
        expect(resolveNav(NAV, withUnknown, opts)).toEqual(resolveNav(NAV, today, opts));
        expect(resolveNavAll(NAV, withGeneric, { planned: PLANNED_NAV })).toEqual(
          resolveNavAll(NAV, today, { planned: PLANNED_NAV }),
        );
      });

      it('Settings tiles: the same list, locks and "soon" marks', () => {
        const opts = { planned: PLANNED_SETTINGS };
        expect(resolveSettings(SETTINGS, withGeneric, opts)).toEqual(
          resolveSettings(SETTINGS, today, opts),
        );
        expect(resolveSettings(SETTINGS, withUnknown, opts)).toEqual(
          resolveSettings(SETTINGS, today, opts),
        );
      });

      it('Help center: the same guides and the same index', () => {
        const a = helpFor(withGeneric, 'en');
        const b = helpFor(today, 'en');
        expect(ids(a.docs)).toEqual(ids(b.docs));
        expect(a.entries).toEqual(b.entries);
      });
    });
  }

  it('contact page: every tab, quick-view tab and section is kept, for any permission set', () => {
    const p = personaVisibility(genericView());
    const hidden = (s: SectionId) => p.isSectionHidden(s);
    for (const grant of [() => true, () => false, (k: string) => k.startsWith('record.')]) {
      expect(pageTabs(grant, hidden)).toEqual(pageTabs(grant));
      expect(quickTabs(grant, hidden)).toEqual(quickTabs(grant));
      expect(visibleSections(grant, hidden)).toEqual(visibleSections(grant));
    }
    for (const s of [...CORE_SECTIONS, ...RELATED_SECTIONS]) expect(hidden(s), s).toBe(false);
  });

  it('Home and the contact action bar: no card and no action is hidden', () => {
    const p = personaVisibility(genericView());
    for (const c of HOME_CARDS) expect(p.isCardHidden(c.id), c.id).toBe(false);
    for (const a of ['note', 'task', 'meeting', 'company', 'call', 'score'])
      expect(p.isActionHidden(a), a).toBe(false);
  });
});

describe('a test persona hides modules', () => {
  const FULL = () => caps(PERMISSIONS, FEATURES, CHANNELS);
  const hide = ['nav:deals', 'tile:booking-types'];
  const hiddenSet = personaHiddenIds(viewFrom({ definition: denyList(hide) }));

  it('removes the hidden menu entry and Settings tile, and nothing else', () => {
    const opts = { planned: MENU_PLANNED_NAV };
    const before = ids(resolveNav(NAV, FULL(), opts));
    const after = ids(resolveNav(NAV, { ...FULL(), hidden: hiddenSet }, opts));
    expect(before).toContain('deals');
    expect(after).not.toContain('deals');
    expect(after).toEqual(before.filter((id) => id !== 'deals'));

    const tBefore = ids(resolveSettings(SETTINGS, FULL(), { planned: PLANNED_SETTINGS }));
    const tAfter = ids(
      resolveSettings(SETTINGS, { ...FULL(), hidden: hiddenSet }, { planned: PLANNED_SETTINGS }),
    );
    expect(tBefore).toContain('booking-types');
    expect(tAfter).toEqual(tBefore.filter((id) => id !== 'booking-types'));
  });

  it('hides a guide whose only documented screens are hidden, and keeps the others', () => {
    const base = helpFor(FULL(), 'en').docs;
    const target = base.find((d) => d.documents.length > 0)!;
    expect(target, 'a guide that documents a screen exists').toBeDefined();
    const after = helpFor({ ...FULL(), hidden: new Set(target.documents) }, 'en').docs;
    expect(ids(after)).not.toContain(target.id);
    const untouched = base.find((d) => d.documents.length === 0);
    if (untouched) expect(ids(after)).toContain(untouched.id);
    expect(after.length).toBeLessThan(base.length);
  });

  it('a hidden entry that the plan would lock draws nothing: no lock, no upsell', () => {
    // `noPlan` below holds every permission and channel, so any plan-gated entry that is not an app's screen stays visible but locked.
    const lockedItem = NAV.find((n) => n.gates?.planFeature && !n.gates.app)!;
    expect(lockedItem, 'a plan-gated entry exists in the menu').toBeDefined();
    const noPlan = caps(PERMISSIONS, [], CHANNELS);
    const shownLocked = resolveNav(NAV, noPlan).find((n) => n.id === lockedItem.id);
    expect(shownLocked?.locked).toBe(true); // today's behaviour: visible, locked

    const hidden = personaHiddenIds(viewFrom({ definition: denyList([`nav:${lockedItem.id}`]) }));
    expect(
      resolveNav(NAV, { ...noPlan, hidden }).find((n) => n.id === lockedItem.id),
    ).toBeUndefined();

    // Show more modules: revealed, and today's lock is intact (the persona unlocks nothing).
    const revealed = personaHiddenIds(
      viewFrom({ definition: denyList([`nav:${lockedItem.id}`]), showAll: true }),
    );
    const again = resolveNav(NAV, { ...noPlan, hidden: revealed }).find(
      (n) => n.id === lockedItem.id,
    );
    expect(again?.locked).toBe(true);
  });

  it('showing a module never adds what permission or app remove (entitlement wins)', () => {
    const gated = NAV.find((n) => n.gates?.permission)!;
    const shownByPersona = personaHiddenIds(
      viewFrom({ definition: allowList([`nav:${gated.id}`]) }),
    );
    const withoutPermission = caps(
      PERMISSIONS.filter((p) => p !== gated.gates!.permission),
      FEATURES,
      CHANNELS,
      shownByPersona,
    );
    expect(ids(resolveNav(NAV, withoutPermission))).not.toContain(gated.id);

    const app = NAV.find((n) => n.gates?.app)!;
    const noApp = caps(
      PERMISSIONS,
      FEATURES.filter((f) => f !== app.gates!.app),
      CHANNELS,
      personaHiddenIds(viewFrom({ definition: allowList([`nav:${app.id}`]) })),
    );
    expect(ids(resolveNav(NAV, noApp))).not.toContain(app.id);
  });

  it('an allow-list persona leaves only what it names (of what the person may open)', () => {
    const hidden = personaHiddenIds(
      viewFrom({ definition: allowList(['nav:inbox', 'nav:contacts', 'nav:dashboard']) }),
    );
    const menu = ids(resolveNav(NAV, { ...caps(PERMISSIONS, FEATURES, CHANNELS), hidden }));
    expect(menu.length).toBeGreaterThan(0);
    for (const id of menu) expect(['inbox', 'contacts', 'dashboard']).toContain(id);
  });

  it('never changes the registries, so the gates of a hidden module (route and paywall) are untouched', () => {
    const before = JSON.stringify(NAV);
    resolveNav(NAV, { ...FULL(), hidden: hiddenSet });
    expect(JSON.stringify(NAV)).toBe(before);
    expect(NAV.some((n) => n.id === 'deals')).toBe(true);
  });
});

// --- Edition presets (BL-383): Chat team, Sales team, Both --------------------------------------------------------------------

describe('edition presets are data and change nothing for generic or persona-less workspaces', () => {
  const view = (key: keyof typeof EDITION_PERSONAS) =>
    viewFrom({ definition: EDITION_PERSONAS[key]!, key });
  const hiddenOf = (key: keyof typeof EDITION_PERSONAS) => personaHiddenIds(view(key));
  const FULL = () => caps(PERMISSIONS, FEATURES, CHANNELS);
  const menu = (hidden: Hidden, c: Capabilities = FULL()) =>
    ids(resolveNav(NAV, { ...c, hidden }, { planned: MENU_PLANNED_NAV }));
  const tiles = (hidden: Hidden) =>
    ids(resolveSettings(SETTINGS, { ...FULL(), hidden }, { planned: PLANNED_SETTINGS }));

  // Ids the presets keep on purpose. Their tile was removed from Settings (commit 2974d99df), but the seed migration that holds the
  // id is already applied and must not change, so the presets keep naming it. Each must really be gone from the catalog.
  const RETIRED_TILE_IDS = new Set(['tile:team-performance']);

  it('every id the presets name is in the generated module catalog, unless it is a retired one', () => {
    const catalog = new Set(MODULE_CATALOG.map((e) => e.id));
    for (const def of Object.values(EDITION_PERSONAS))
      for (const id of Object.keys(def.modules.ids))
        if (!RETIRED_TILE_IDS.has(id)) expect(catalog.has(id), id).toBe(true);
  });

  it('a retired id is really gone from the catalog', () => {
    const catalog = new Set(MODULE_CATALOG.map((e) => e.id));
    for (const id of RETIRED_TILE_IDS) expect(catalog.has(id), id).toBe(false);
  });

  it('"Both" shows exactly what generic and a workspace without a persona show', () => {
    const both = hiddenOf('both');
    expect([...both!]).toEqual([]);
    for (const [, make] of FIXTURES) {
      const today = make();
      const opts = { planned: MENU_PLANNED_NAV };
      expect(resolveNav(NAV, make(both), opts)).toEqual(resolveNav(NAV, today, opts));
      expect(resolveSettings(SETTINGS, make(both), { planned: PLANNED_SETTINGS })).toEqual(
        resolveSettings(SETTINGS, today, { planned: PLANNED_SETTINGS }),
      );
    }
    // and generic still hides nothing, next to the new presets
    expect([...personaHiddenIds(genericView())!]).toEqual([]);
  });

  it('Chat team: the sales side leaves the menu, Settings and the contact page; contacts and the inbox stay', () => {
    const hidden = hiddenOf('chat_team');
    const m = menu(hidden);
    for (const gone of ['deals', 'companies', 'tasks', 'invoices', 'proposals', 'crm-dashboard'])
      expect(m, gone).not.toContain(gone);
    for (const kept of ['inbox', 'contacts', 'team-chat', 'dashboard'])
      expect(m, kept).toContain(kept);
    const t = tiles(hidden);
    for (const gone of ['deal-pipelines', 'record-assignment', 'lead-sources'])
      expect(t, gone).not.toContain(gone);
    for (const kept of ['roles', 'teams', 'workspace-team', 'channels'])
      expect(t, kept).toContain(kept);

    const p = personaVisibility(view('chat_team'));
    const sections = Object.values(
      visibleSections(
        () => true,
        (s) => p.isSectionHidden(s),
      ),
    ).flat();
    for (const gone of ['deals', 'tasks', 'sales', 'lead-source', 'company', 'appointments'])
      expect(sections, gone).not.toContain(gone);
    for (const kept of [
      'overview',
      'conversations',
      'notes',
      'details',
      'files',
      'consent',
      'history',
    ])
      expect(sections, kept).toContain(kept);
    expect(p.isActionHidden('task')).toBe(true);
    expect(p.isActionHidden('note')).toBe(false);
  });

  it('Sales team: the inbox and chat channels leave; contacts, deals and tasks stay', () => {
    const hidden = hiddenOf('sales_team');
    const m = menu(hidden);
    for (const gone of [
      'inbox',
      'inbox-saved-replies',
      'team-chat',
      'campaigns',
      'telegram',
      'facebook',
    ])
      expect(m, gone).not.toContain(gone);
    for (const kept of ['contacts', 'deals', 'companies', 'tasks', 'dashboard'])
      expect(m, kept).toContain(kept);
    const t = tiles(hidden);
    for (const gone of ['saved-replies', 'sla-policies', 'auto-assignment', 'team-performance'])
      expect(t, gone).not.toContain(gone);
    for (const kept of ['roles', 'teams', 'record-assignment', 'deal-pipelines'])
      expect(t, kept).toContain(kept);

    const p = personaVisibility(view('sales_team'));
    const sections = Object.values(
      visibleSections(
        () => true,
        (s) => p.isSectionHidden(s),
      ),
    ).flat();
    expect(sections).not.toContain('conversations');
    for (const kept of ['overview', 'deals', 'tasks', 'notes', 'company'])
      expect(sections, kept).toContain(kept);
    expect(p.isCardHidden('inbox')).toBe(true);
  });

  it('entitlement still wins over visibility, in both directions', () => {
    // visible but not in the plan: the entry shows with today's lock
    const planGated = NAV.find(
      (n) =>
        n.gates?.planFeature && !n.gates.app && !CRM_SIDE_MODULES.includes(`nav:${n.id}` as never),
    )!;
    const noPlan = caps(PERMISSIONS, [], CHANNELS);
    const shown = resolveNav(NAV, { ...noPlan, hidden: hiddenOf('chat_team') }).find(
      (n) => n.id === planGated.id,
    );
    expect(shown?.locked).toBe(true);

    // hidden by the preset and also locked by the plan: still gone, no lock drawn
    const hiddenAndLocked = NAV.find(
      (n) => n.gates?.planFeature && CHAT_SIDE_MODULES.includes(`nav:${n.id}` as never),
    )!;
    expect(hiddenAndLocked, 'a plan-gated chat entry exists').toBeDefined();
    expect(
      resolveNav(NAV, { ...noPlan, hidden: hiddenOf('sales_team') }).find(
        (n) => n.id === hiddenAndLocked.id,
      ),
    ).toBeUndefined();

    // Show more modules brings it back with the lock intact: a preset unlocks nothing
    const revealed = personaHiddenIds(
      viewFrom({ definition: EDITION_PERSONAS.sales_team!, key: 'sales_team', showAll: true }),
    );
    expect(
      resolveNav(NAV, { ...noPlan, hidden: revealed }).find((n) => n.id === hiddenAndLocked.id)
        ?.locked,
    ).toBe(true);
  });

  it('the presets never change the registries (routes, gates and the typed address of a hidden module)', () => {
    const before = JSON.stringify(NAV) + JSON.stringify(SETTINGS);
    menu(hiddenOf('sales_team'));
    tiles(hiddenOf('chat_team'));
    expect(JSON.stringify(NAV) + JSON.stringify(SETTINGS)).toBe(before);
  });
});
