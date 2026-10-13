import type { NavItem } from './types';

/**
 * Screens Reference has that this app has not built yet. They show in the menu as disabled "coming soon" entries so the
 * product's shape is visible from day one. This file is the one place they are listed.
 *
 * To switch one on: build the screen, declare a `NavItem` with the same `id` in your domain's `nav.ts` (labels and
 * gates are then yours), and delete the entry here. Until you delete it, the real item already wins (see
 * `mergePlanned`), so the two never both show.
 *
 * Configuration screens are not menu entries: they are Settings tiles, and their "Soon" versions live in `settings-planned.ts`
 * (Channels, Team members, Roles, Auto-reply, Integrations, REST API, Webhooks, Activity log...).
 *
 * Labels live in `messages/<locale>/shell.json` under `shell.nav`, in the shell's own namespace, because no domain
 * owns these screens yet. `icon` names are defined in `components/shell/nav-icons.tsx`.
 */
const L = (id: string) => `shell.nav.${id}`;

export const PLANNED_NAV: readonly NavItem[] = [
  // Platform (Dashboard is a real screen)
  {
    id: 'analytics',
    group: 'overview',
    labelKey: L('analytics'),
    href: '/analytics',
    order: 10,
    icon: 'analytics',
  },

  // Inbox & Chat
  {
    id: 'quick-chat',
    group: 'inbox',
    labelKey: L('quickChat'),
    href: '/chat',
    order: 10,
    icon: 'chat',
  },
  {
    id: 'team-chat',
    group: 'inbox',
    labelKey: L('teamChat'),
    href: '/team-chat',
    order: 30,
    icon: 'team-chat',
  },

  // CRM (Contacts, Contact groups, Segments, Deals, Tasks and Companies are real screens; Attributes and Pipelines moved to Settings). Orders keep the menu sequence:
  // Contacts 0, Contact groups 2, Segments 3, Lead finder 30, Deals 40, Tasks 60, Companies 70, Email templates 80.
  {
    id: 'lead-finder',
    group: 'audience',
    labelKey: L('leadFinder'),
    href: '/lead-finder',
    order: 30,
    icon: 'pin',
    badge: 'new',
  },
  {
    id: 'email-templates',
    group: 'audience',
    labelKey: L('emailTemplates'),
    href: '/email-templates',
    order: 80,
    icon: 'mail',
  },

  // Sales (Reference's SalesDocs engine: proposals and estimates are real screens in features/sales-docs; invoices, payments and tax rates are real screens in features/invoicing)
  {
    id: 'crm-dashboard',
    group: 'sales',
    labelKey: L('crmDashboard'),
    href: '/crm',
    order: 0,
    icon: 'crm',
  },

  // Campaigns
  {
    id: 'scheduled',
    group: 'campaigns',
    labelKey: L('scheduled'),
    href: '/scheduled',
    order: 20,
    icon: 'clock',
  },

  // Automation (Appointments is a real screen in features/appointments)
  {
    id: 'flows',
    group: 'automation',
    labelKey: L('flows'),
    href: '/flows',
    order: 0,
    icon: 'flow',
  },
  {
    id: 'ai-assistants',
    group: 'automation',
    labelKey: L('aiAssistants'),
    href: '/ai-assistants',
    order: 10,
    icon: 'bot',
    badge: 'new',
  },

  // Store
  { id: 'store', group: 'store', labelKey: L('store'), href: '/store', order: 0, icon: 'store' },
  {
    id: 'catalog',
    group: 'store',
    labelKey: L('catalog'),
    href: '/catalog',
    order: 10,
    icon: 'catalog',
  },

  // Help (drawn in the user menu, not in the rail or panel)
  {
    id: 'support',
    group: 'help',
    labelKey: L('support'),
    href: '/support',
    order: 0,
    icon: 'help',
  },
];

/**
 * Whether the sidebar draws the screens above as disabled "Soon" entries. Off (owner decision, 2026-10-05): the menu lists only what
 * works, so a workspace is not offered a dozen dead entries. The list itself stays: it is the record of what is still to be built, the
 * Help coverage check reads it, and switching this on brings the old menu back with no other change. The Settings tiles' own "Soon"
 * entries (`settings-planned.ts`) are not affected.
 */
export const SHOW_PLANNED_IN_MENU = false;

/** What the sidebar is given as planned entries. */
export const MENU_PLANNED_NAV: readonly NavItem[] = SHOW_PLANNED_IN_MENU ? PLANNED_NAV : [];
