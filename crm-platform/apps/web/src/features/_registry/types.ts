/**
 * Menu groups, in the order they appear. They follow Reference's user menu (`UserNav`), regrouped for a CRM:
 * Platform (`overview`), Inbox & Chat, CRM (`audience`), Sales, Campaigns, Automation, Store, then Help and Settings.
 * The ids `overview` and `audience` are kept so domains that already declare them keep working; only their headings read
 * "Platform" and "CRM". A domain picks one for each screen.
 *
 * Configuration is not a menu group: a screen that sets something up (channels, tax rates, API keys, team...) is a tile in
 * the Settings area, declared in `features/<domain>/settings.ts` (see `settings-types.ts`). `settings` holds the entries pinned
 * to the bottom of the menu: the shell's own Settings entry, with Help (the Help center) directly above it. `help` (Support) is
 * drawn in the user menu.
 */
export const NAV_GROUPS = [
  'overview',
  'inbox',
  'audience',
  'sales',
  'campaigns',
  'automation',
  'store',
  'apps',
  'help',
  'settings',
] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

export interface NavGates {
  permission?: string;
  /** A plan feature the screen needs. Missing: the entry stays visible but locked, so it can upsell (Reference's rule). */
  planFeature?: string;
  channel?: string;
  /**
   * With `planFeature`: the route is not mounted while the plan lacks the feature. The paywall sheet explains and the screen's own
   * requests never fire (the API would refuse them with `PLAN_FEATURE_LOCKED`). Without it the sheet is drawn over a mounted page.
   */
  closeWhenLocked?: boolean;
  /**
   * The plan feature key a Marketplace app owns (a first-party listing's `grantsPlanFeatures`, for example Appointments grants
   * `appointment_booking`). Unlike `planFeature`, a missing app REMOVES the entry and closes its route: an app the workspace has not
   * bought or been given is found in the Marketplace, not in the menu. The entitlement set already merges what a plan, an
   * override or a purchased add-on grants, so this follows the one resolver the API gates use. Unknown (null) removes nothing.
   */
  app?: string;
}

/** One entry per screen, declared in `features/<domain>/nav.ts`; the shell never lists domains by hand. */
/** The live numbers a menu entry can show. Add a key here when a domain starts providing a new one. */
export const NAV_COUNTER_KEYS = ['inbox-unread'] as const;
export type NavCounterKey = (typeof NAV_COUNTER_KEYS)[number];

export interface NavItem {
  id: string;
  group: NavGroup;
  labelKey: string;
  href: string;
  order?: number;
  gates?: NavGates;
  /** Name of a shell icon (see `components/shell/nav-icons.tsx`); an unknown or missing name gets a dot. */
  icon?: string;
  /** Small pill next to the label ("New") for screens worth pointing out. */
  badge?: 'new';
  /**
   * A live number on the entry (a count pill, capped at "99+", hidden at 0). The domain that owns the number provides it through
   * `NavCountsContext` (see `components/shell/nav-badges.ts`) under this key; an entry whose number is unknown shows nothing.
   */
  counter?: NavCounterKey;
  /**
   * `false`: the screen stays registered (its gates, the plan paywall, Help and the command palette still see it) but the sidebar does
   * not list it, because its own area already links to it (the Store sidebar lists Orders, Coupons...) or a Settings tile does. The
   * entry that covers its path lights up instead.
   */
  inMenu?: boolean;
}

/** One card of the Home dashboard, declared in `features/<domain>/home-cards.ts`. Only the id matters to the persona module catalog. */
export interface HomeCard {
  id: string;
}

/** `null` = not known yet (the app-init payload does not exist): show the item and do not lock it. */
export interface Capabilities {
  permissions: ReadonlySet<string> | null;
  planFeatures: ReadonlySet<string> | null;
  channels: ReadonlySet<string> | null;
  /**
   * The module ids the workspace's persona hides (`nav:<id>`, `tile:<id>`; docs/specs/persona-profiles.md, section 7.2), built from
   * the session's `org.persona`. A fourth input beside the three above, and unlike them it is only about what is DRAWN: a hidden
   * entry is skipped before the gates run, so it shows no lock and no upsell, but nothing is closed (a typed address still opens
   * when permission and plan allow). `null`, `undefined` (a caller that predates personas) and an empty set hide nothing, which is
   * what the `generic` persona resolves to; unknown never hides on a guess.
   */
  hidden?: ReadonlySet<string> | null;
}

export interface ResolvedNavItem extends NavItem {
  /** The plan does not include it: shown with an upgrade mark. */
  locked: boolean;
  /** No page exists yet (it comes from `planned.ts`): shown disabled, never a link. */
  comingSoon: boolean;
}
