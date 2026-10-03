/**
 * Menu groups, in the order they appear. They follow WaDesk's user menu (`UserNav`), regrouped for a CRM:
 * Platform (`overview`), Inbox & Chat, CRM (`audience`), Sales, Campaigns, Automation, Store, then Help and Settings.
 * The ids `overview` and `audience` are kept so domains that already declare them keep working; only their headings read
 * "Platform" and "CRM". A domain picks one for each screen.
 *
 * Configuration is not a menu group: a screen that sets something up (channels, tax rates, API keys, team...) is a tile in
 * the Settings area, declared in `features/<domain>/settings.ts` (see `settings-types.ts`). `settings` holds only the shell's
 * own Settings entry, pinned to the bottom of the menu; `help` (Support, Guidebook) is drawn in the user menu.
 */
export const NAV_GROUPS = [
  'overview',
  'inbox',
  'audience',
  'sales',
  'campaigns',
  'automation',
  'store',
  'help',
  'settings',
] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

export interface NavGates {
  permission?: string;
  planFeature?: string;
  channel?: string;
}

/** One entry per screen, declared in `features/<domain>/nav.ts`; the shell never lists domains by hand. */
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
   * A screen that needs the whole width (a multi-pane inbox, a chat): while it is open the menu shows as the slim icon rail,
   * whatever the person pinned, and a click on the expand button opens it for that visit only.
   */
  fullWidth?: boolean;
}

/** `null` = not known yet (the app-init payload does not exist): show the item and do not lock it. */
export interface Capabilities {
  permissions: ReadonlySet<string> | null;
  planFeatures: ReadonlySet<string> | null;
  channels: ReadonlySet<string> | null;
}

export interface ResolvedNavItem extends NavItem {
  /** The plan does not include it: shown with an upgrade mark. */
  locked: boolean;
  /** No page exists yet (it comes from `planned.ts`): shown disabled, never a link. */
  comingSoon: boolean;
}
