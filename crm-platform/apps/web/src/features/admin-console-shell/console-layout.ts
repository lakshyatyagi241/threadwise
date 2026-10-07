/**
 * How the console rail is organised. Domains still contribute their pages through the operator nav data
 * (`OPERATOR_NAV`); this file only decides where each page sits, so a page's heading no longer depends on which domain built it.
 *
 * Order follows the operator's day: run the business (insights, plans, billing, support), then configure
 * the product (channels, marketplace), then administer the platform (access, settings, system).
 *
 * Rules the tests enforce: every page is placed exactly once, no section holds a single page, and a page
 * missing here still shows in the rail under its own heading rather than disappearing.
 */
export interface ConsoleBlock {
  /** Key under `admin-console-shell.nav.captions`. No caption draws no heading above the block. */
  caption?: string;
  /** Operator-nav item ids, in the order they are listed. */
  items: readonly string[];
}

export interface ConsoleSection {
  /** Also the key under `admin-console-shell.nav.sections`. */
  id: string;
  /** Icon name, resolved by `ConsoleIcon`. */
  icon: string;
  blocks: readonly ConsoleBlock[];
}

/** Active modules append their own pages to this section, after its own (TW-ADD-012). */
export const MODULES_SECTION = 'apps';

export const CONSOLE_LAYOUT: readonly ConsoleSection[] = [
  {
    id: 'insights',
    icon: 'analytics',
    // Reference's top-level dashboards, in its order.
    blocks: [
      {
        items: [
          'financial',
          'premium',
          'plan-analytics',
          'platform-analytics',
          'ai-dashboard',
          'system-health',
        ],
      },
    ],
  },
  {
    id: 'plans',
    icon: 'tag',
    blocks: [
      {
        items: [
          'plans',
          'workspace-plans',
          'addon-packs',
          'coupons',
          'plan-settings',
          'pricing-faqs',
        ],
      },
    ],
  },
  {
    id: 'billing',
    icon: 'payment',
    blocks: [
      { caption: 'orders', items: ['billing-history', 'order-history', 'invoices'] },
      { caption: 'payments', items: ['payment-gateways', 'checkout-settings'] },
      {
        caption: 'messaging',
        items: [
          'wallet-pricing',
          'wallet-margins',
          'wallet-packages',
          'wallet-workspaces',
          'wallet-logs',
          'bsp-income',
          'bsp-credit',
        ],
      },
    ],
  },
  {
    id: 'support',
    icon: 'help',
    blocks: [
      {
        caption: 'support',
        items: [
          'support-inbox',
          'support-platform-inbox',
          'support-team',
          'support-agents',
          'support-customers',
          'support-sla',
          'support-playbooks',
          'support-reports',
          'cms-contact',
        ],
      },
      {
        caption: 'website',
        items: ['cms-frontend', 'cms-blog', 'cms-legal', 'cms-announcements', 'cms-guidebook'],
      },
    ],
  },
  {
    id: 'channels',
    icon: 'channels',
    blocks: [
      {
        caption: 'whatsapp',
        items: [
          'wap-providers',
          'wap-assignments',
          'wap-switch',
          'node-bridge',
          'webhook-forwarding',
        ],
      },
    ],
  },
  {
    id: MODULES_SECTION,
    icon: 'modules',
    blocks: [
      {
        caption: 'marketplace',
        items: ['market-catalogue', 'market-categories', 'market-requests', 'market-usage'],
      },
      { caption: 'modules', items: ['extensions'] },
    ],
  },
  {
    id: 'access',
    icon: 'shield',
    blocks: [
      { caption: 'roles', items: ['roles', 'permissions', 'staff-roles'] },
      { caption: 'security', items: ['security', 'security-events'] },
      { caption: 'signin', items: ['registration', 'social-login', 'auth-pages'] },
    ],
  },
  {
    id: 'settings',
    icon: 'settings',
    blocks: [
      { items: ['settings-hub'] },
      {
        caption: 'branding',
        items: [
          'settings-general',
          'settings-appearance',
          'settings-site-info',
          'settings-footer',
          'settings-seo',
          'settings-pwa',
          'menu-order',
        ],
      },
      {
        caption: 'integrations',
        items: [
          'settings-mail',
          'settings-whatsapp',
          'settings-campaigns',
          'settings-google-calendar',
          'settings-flow-builder',
          'settings-catalog',
          'ai-keys',
        ],
      },
      {
        caption: 'privacy',
        items: ['settings-privacy', 'settings-analytics', 'settings-custom'],
      },
      { caption: 'infrastructure', items: ['settings-storage', 'settings-realtime'] },
    ],
  },
  {
    id: 'system',
    icon: 'globe',
    blocks: [
      { items: ['system'] },
      {
        caption: 'localization',
        items: ['i18n-languages', 'currencies', 'i18n-providers', 'i18n-usage'],
      },
    ],
  },
];
