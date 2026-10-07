/**
 * How the console menu is organised (docs/specs/admin-menu-hubs.md). The rail lists one entry per hub; a hub opens on its first
 * page and shows its other pages as a tab bar above the page. Domains still contribute their pages through the operator nav data
 * (`OPERATOR_NAV`); this file only decides which hub each page sits in, so a page's place no longer depends on which domain built it.
 *
 * Order follows the operator's day: look (reports), run the business (plans, billing, support, website), configure the product
 * (WhatsApp, apps), then administer the platform (team, settings, system).
 *
 * Rules the tests enforce: every page is in exactly one hub (or is named in `NOT_IN_MENU` with a reason), no more than
 * `MAX_HUBS` hubs, no more than `MAX_TABS` tabs in one hub, and no hub with a single page. A page missing here still shows in the
 * rail under its own heading rather than disappearing, and the placement test fails until someone decides where it goes.
 */
export interface ConsoleHub {
  /** Also the key under `admin-console-shell.nav.sections`. */
  id: string;
  /** Icon name, resolved by `ConsoleIcon`. */
  icon: string;
  /**
   * `tabs`: the hub's pages are a tab bar above each page.
   * `index`: the hub's first page is a landing page that lists the others (Settings: one entry, tiles on the hub page);
   * its other pages get a back link to the landing page instead of a tab bar.
   */
  kind: 'tabs' | 'index';
  /** Operator-nav item ids, in the order they are listed. The first one the operator may open is where the rail entry goes. */
  tabs: readonly string[];
}

/** Active modules append their own pages to this hub, after its own, under its "More" menu (TW-ADD-012). */
export const MODULES_SECTION = 'apps';

export const MAX_HUBS = 12;
/** Pages beyond this (and module pages added at run time) go under the tab bar's "More" menu. */
export const MAX_TABS = 9;

export const CONSOLE_LAYOUT: readonly ConsoleHub[] = [
  {
    id: 'reports',
    icon: 'analytics',
    kind: 'tabs',
    // Reference's top-level dashboards, in its order.
    tabs: [
      'financial',
      'premium',
      'plan-analytics',
      'platform-analytics',
      'ai-dashboard',
      'system-health',
    ],
  },
  {
    id: 'plans',
    icon: 'tag',
    kind: 'tabs',
    tabs: ['workspaces', 'plans', 'addon-packs', 'coupons', 'plan-settings', 'pricing-faqs'],
  },
  {
    id: 'billing',
    icon: 'payment',
    kind: 'tabs',
    tabs: ['billing-history', 'order-history', 'invoices', 'payment-gateways', 'checkout-settings'],
  },
  {
    id: 'messaging',
    icon: 'sms',
    kind: 'tabs',
    tabs: [
      'wallet-overview',
      'wallet-pricing',
      'wallet-margins',
      'wallet-packages',
      'wallet-logs',
      'bsp-income',
      'bsp-credit',
    ],
  },
  {
    id: 'support',
    icon: 'help',
    kind: 'tabs',
    tabs: [
      'support-inbox',
      'support-team',
      'support-platform-inbox',
      'support-agents',
      'support-sla',
      'support-playbooks',
      'support-reports',
      'cms-contact',
    ],
  },
  {
    id: 'website',
    icon: 'globe',
    kind: 'tabs',
    tabs: ['cms-frontend', 'cms-blog', 'cms-legal', 'cms-announcements', 'cms-guidebook'],
  },
  {
    id: 'whatsapp',
    icon: 'channels',
    kind: 'tabs',
    tabs: [
      'wap-providers',
      'wap-switch',
      'node-bridge',
      'webhook-forwarding',
      'settings-whatsapp',
      'settings-catalog',
    ],
  },
  {
    id: MODULES_SECTION,
    icon: 'modules',
    kind: 'tabs',
    tabs: [
      'market-catalogue',
      'market-categories',
      'market-requests',
      'market-usage',
      'extensions',
      'flow-templates',
    ],
  },
  {
    id: 'team',
    icon: 'shield',
    kind: 'tabs',
    tabs: [
      'roles',
      'permissions',
      'staff-roles',
      'security',
      'security-events',
      'registration',
      'social-login',
      'auth-pages',
    ],
  },
  {
    id: 'settings',
    icon: 'settings',
    kind: 'index',
    tabs: [
      'settings-hub',
      'settings-general',
      'settings-appearance',
      'settings-site-info',
      'settings-footer',
      'settings-seo',
      'settings-pwa',
      'menu-order',
      'settings-mail',
      'settings-campaigns',
      'settings-google-calendar',
      'settings-flow-builder',
      'ai-keys',
      'settings-privacy',
      'settings-analytics',
      'settings-custom',
      'settings-storage',
    ],
  },
  {
    id: 'system',
    icon: 'gear',
    kind: 'tabs',
    tabs: ['system', 'i18n-languages', 'currencies', 'i18n-providers', 'i18n-usage'],
  },
];

/**
 * Pages that exist but are deliberately not in the menu, each with the reason. A built admin page that is neither in a hub nor here
 * fails the route test, so nothing can be built and then be unreachable (Flow templates once was).
 * Keys are page addresses without the `/admin` prefix; `[x]` stands for any one dynamic segment.
 */
export const NOT_IN_MENU: Readonly<Record<string, string>> = {
  login: 'the sign-in page, outside the console',
  'workspace-plans': 'legacy address, redirects to the Workspaces tab',
  'support/customers': 'legacy address, redirects to the Workspaces tab',
  'wallet/workspaces': 'legacy address, redirects to the Workspaces tab',
  'whatsapp-providers/assignments': 'legacy address, redirects to the Workspaces tab',
  'workspaces/[id]': 'a workspace, opened from the Workspaces tab',
  'account/security': 'opened from "Your account" and the account menu',
  notifications: 'opened from the notification bell',
  'ai-keys': 'legacy address, redirects to /admin/api-keys',
  'bsp/rate-cards': 'legacy Reference bookmark, redirects to Message pricing',
  update: "Reference's address for the Updater, which is the System tab",
  'bsp/dashboard':
    "Reference's address for Message income: the same page as /admin/bsp, which is the Message income tab",
  'billing-history/analytics': 'opened from Billing history',
  'order-history/analytics': 'opened from Order history',
  'marketplace/subscriptions': 'opened from the catalogue header and its subscriptions column',
  'marketplace/new': 'opened from the catalogue',
  'marketplace/[ref]': 'a listing, opened from the catalogue',
  'addons/new': 'opened from Add-on packs',
  'addons/[id]/edit': 'opened from Add-on packs',
  'announcements/new': 'opened from Announcements',
  'announcements/[id]': 'opened from Announcements',
  'blog/new': 'opened from Blog',
  'blog/[id]': 'opened from Blog',
  'guidebook/new': 'opened from Guidebook',
  'guidebook/[id]': 'opened from Guidebook',
  'legal-pages/[slug]': 'opened from Legal pages',
  'coupons/new': 'opened from Coupons',
  'coupons/[id]/edit': 'opened from Coupons',
  'roles/new': 'opened from Roles',
  'roles/[id]': 'opened from Roles',
  'permissions/new': 'opened from Permissions',
  'flow-templates/new': 'opened from Flow templates',
  'flow-templates/[id]/edit': 'opened from Flow templates',
  'wallet/packages/new': 'opened from Credit packages',
  'wallet/packages/[id]': 'opened from Credit packages',
  'wallet/workspaces/[id]': 'opened from Workspace wallets',
  'whatsapp-providers/new': 'opened from Providers',
  'whatsapp-providers/[id]': 'opened from Providers',
  'support/customers/[id]': 'opened from Customers',
  'invoices/[id]': 'opened from Invoices',
  'settings/[group]': 'one page per settings group, listed as separate pages',
};
