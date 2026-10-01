/**
 * Menu groups, in the order they appear. They follow Reference's user menu (`UserNav`): Overview, Inbox & Chat,
 * Audience, Campaigns, Automation, Channels, Sales & CRM, Store, Developer, Help; account and workspace settings
 * come last. A domain picks one of these for each of its screens.
 */
export const NAV_GROUPS = [
  'overview',
  'inbox',
  'audience',
  'campaigns',
  'automation',
  'channels',
  'sales',
  'store',
  'developer',
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
