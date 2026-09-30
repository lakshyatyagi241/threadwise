export const NAV_GROUPS = [
  'overview',
  'messaging',
  'crm',
  'automation',
  'growth',
  'commerce',
  'ai',
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
}

/** `null` = not known yet (the app-init payload does not exist): show the item and do not lock it. */
export interface Capabilities {
  permissions: ReadonlySet<string> | null;
  planFeatures: ReadonlySet<string> | null;
  channels: ReadonlySet<string> | null;
}

export interface ResolvedNavItem extends NavItem {
  locked: boolean;
}
