/**
 * How the console menu is organised (docs/specs/admin-menu-hubs.md). Home is a grid of one block per hub; opening a hub puts its
 * pages in a menu on the left (grouped under small headings where a hub is long), and the collapsed rail keeps one icon per hub. Domains still contribute their pages through the operator nav data
 * (`OPERATOR_NAV`); this file only decides which hub each page sits in, so a page's place no longer depends on which domain built it.
 *
 * Order follows the operator's day: look (reports), run the business (plans, billing, support, website), configure the product
 * (WhatsApp, apps), then administer the platform (team, settings, system).
 *
 * Rules the tests enforce: every page is in exactly one hub (or is named in `NOT_IN_MENU` with a reason), no more than
 * `MAX_HUBS` hubs, no more than `MAX_PAGES` pages in one hub, and no hub with a single page. A page missing here still shows in the
 * rail under its own heading rather than disappearing, and the placement test fails until someone decides where it goes.
 */
export interface ConsoleHub {
  /** Also the key under `admin-console-shell.nav.sections`. */
  id: string;
  /** Icon name, resolved by `ConsoleIcon`. */
  icon: string;
  /** Operator-nav item ids, in the order they are listed. The first one the operator may open is where the hub's block goes. */
  tabs: readonly string[];
  /** Page id to the key (under `admin-console-shell.nav.captions`) of the small heading drawn above it: it opens a group of pages. */
  heads?: Readonly<Record<string, string>>;
}

/** Active modules append their own pages to this hub, after its own, under its "More" menu (TW-ADD-012). */
export const MODULES_SECTION = 'apps';

export const MAX_HUBS = 12;
/** A hub longer than this has stopped being one area: split it. Module pages added at run time are not counted. */
export const MAX_PAGES = 20;

export const CONSOLE_LAYOUT: readonly ConsoleHub[] = [
  {
    id: 'reports',
    icon: 'analytics',
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
    tabs: ['workspaces', 'plans', 'addon-packs', 'coupons', 'plan-settings', 'pricing-faqs'],
  },
  {
    id: 'billing',
    icon: 'payment',
    tabs: ['billing-history', 'order-history', 'invoices', 'payment-gateways', 'checkout-settings'],
  },
  {
    id: 'messaging',
    icon: 'sms',
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
    tabs: ['cms-frontend', 'cms-blog', 'cms-legal', 'cms-announcements'],
  },
  {
    id: 'whatsapp',
    icon: 'channels',
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
    heads: { roles: 'roles', security: 'security', registration: 'signin' },
  },
  {
    id: 'settings',
    icon: 'settings',
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
      'faq-engine',
      'settings-privacy',
      'settings-analytics',
      'settings-custom',
      'settings-storage',
    ],
    heads: {
      'settings-general': 'branding',
      'settings-mail': 'integrations',
      'settings-privacy': 'privacy',
      'settings-storage': 'infrastructure',
    },
  },
  {
    id: 'system',
    icon: 'gear',
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
