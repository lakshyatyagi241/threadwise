/**
 * The console menu. Kept as plain data so the admin-console domain can merge
 * its own entries into the same list without touching the shell component.
 */
export interface OperatorNavItem {
  id: string;
  href: string;
  /** Full next-intl key, resolved by the shell. */
  labelKey: string;
  /** Full next-intl key of the group heading. Items of one group sit together. */
  groupKey: string;
}

import { CPN_OPERATOR_NAV } from '../../coupons-credits-referral-currency/operator-nav';
import { SET_OPERATOR_NAV } from '../../platform-settings-branding-storage/operator-nav';
import { PLAN_OPERATOR_NAV } from '../../plans-subscriptions-trials/operator-nav';
import { NODE_OPERATOR_NAV } from '../../node-bridge-runtime/operator-nav';
import { ROLES_OPERATOR_NAV } from '../../roles-permissions/operator-nav';
import { WAP_OPERATOR_NAV } from '../../whatsapp-providers/operator-nav';
import { CAT_OPERATOR_NAV } from '../../catalog-products/operator-nav';
import { MARKET_OPERATOR_NAV } from '../../marketplace/operator-nav';
import { SUPP_OPERATOR_NAV } from '../../platform-support-desk/operator-nav';

const NS = 'auth-registration-security.platform.nav';
const BSP = 'bsp-billing-engine.nav';
const WALLET = 'wallet-message-billing.admin.nav';

export const OPERATOR_NAV: readonly OperatorNavItem[] = [
  {
    id: 'security',
    href: '/admin/security',
    labelKey: `${NS}.securityCenter`,
    groupKey: `${NS}.groups.security`,
  },
  {
    id: 'security-events',
    href: '/admin/security/events',
    labelKey: `${NS}.securityEvents`,
    groupKey: `${NS}.groups.security`,
  },
  {
    id: 'registration',
    href: '/admin/settings/registration',
    labelKey: `${NS}.registration`,
    groupKey: `${NS}.groups.guestPages`,
  },
  {
    id: 'social-login',
    href: '/admin/settings/social-login',
    labelKey: `${NS}.socialLogin`,
    groupKey: `${NS}.groups.guestPages`,
  },
  {
    id: 'auth-pages',
    href: '/admin/settings/auth-pages',
    labelKey: `${NS}.authPages`,
    groupKey: `${NS}.groups.guestPages`,
  },
  {
    id: 'plans',
    href: '/admin/plans',
    labelKey: `${NS}.plans`,
    groupKey: `${NS}.groups.plans`,
  },
  // per-workspace plans and limits (PLAN domain)
  ...PLAN_OPERATOR_NAV,
  // coupons, credit packages and currencies (CPN domain)
  ...CPN_OPERATOR_NAV,
  // platform settings, branding and storage (SET domain)
  ...SET_OPERATOR_NAV,
  // roles and permissions domain (RBAC): Roles, Permissions, Staff roles
  ...ROLES_OPERATOR_NAV,
  // Node bridge domain (NODE): address, token and sender pacing
  ...NODE_OPERATOR_NAV,
  // WhatsApp provider registry (WAP): providers, workspace assignments and the number switch
  ...WAP_OPERATOR_NAV,
  // catalog domain (CAT): the platform's WhatsApp Catalog settings
  ...CAT_OPERATOR_NAV,
  // Marketplace catalogue (MKT): listings, versions and review, categories, requests, usage
  ...MARKET_OPERATOR_NAV,
  {
    id: 'i18n-languages',
    href: '/admin/i18n/languages',
    labelKey: 'localization-translation.nav.languages',
    groupKey: 'localization-translation.nav.group',
  },
  {
    id: 'i18n-providers',
    href: '/admin/i18n/providers',
    labelKey: 'localization-translation.nav.providers',
    groupKey: 'localization-translation.nav.group',
  },
  {
    id: 'i18n-usage',
    href: '/admin/i18n/usage',
    labelKey: 'localization-translation.nav.usage',
    groupKey: 'localization-translation.nav.group',
  },
  {
    id: 'system',
    href: '/admin/system',
    labelKey: 'install-update-licensing.system.nav.item',
    groupKey: 'install-update-licensing.system.nav.group',
  },
  // add-ons domain: billing add-ons and installable modules (messages/en/addons-extension-registry.json)
  {
    id: 'addon-packs',
    href: '/admin/addons',
    labelKey: 'addons-extension-registry.nav.packs',
    groupKey: 'addons-extension-registry.nav.group',
  },
  {
    id: 'extensions',
    href: '/admin/extensions',
    labelKey: 'addons-extension-registry.nav.extensions',
    groupKey: 'addons-extension-registry.nav.group',
  },
  // Platform support desk (SUPP): its own message file, so the keys live outside this domain's namespace.
  ...SUPP_OPERATOR_NAV,
  {
    id: 'ai-keys',
    href: '/admin/api-keys',
    labelKey: 'ai-keys-usage-admin.admin.nav.keys',
    groupKey: 'ai-keys-usage-admin.admin.nav.group',
  },
  {
    id: 'ai-dashboard',
    href: '/admin/ai-dashboard',
    labelKey: 'ai-keys-usage-admin.admin.nav.dashboard',
    groupKey: 'ai-keys-usage-admin.admin.nav.group',
  },
  {
    id: 'cms-frontend',
    href: '/admin/frontend',
    labelKey: 'marketing-site-cms.nav.frontend',
    groupKey: 'marketing-site-cms.nav.group',
  },
  {
    id: 'cms-blog',
    href: '/admin/blog',
    labelKey: 'marketing-site-cms.nav.blog',
    groupKey: 'marketing-site-cms.nav.group',
  },
  {
    id: 'cms-legal',
    href: '/admin/legal-pages',
    labelKey: 'marketing-site-cms.nav.legal',
    groupKey: 'marketing-site-cms.nav.group',
  },
  {
    id: 'cms-announcements',
    href: '/admin/announcements',
    labelKey: 'marketing-site-cms.nav.announcements',
    groupKey: 'marketing-site-cms.nav.group',
  },
  {
    id: 'cms-guidebook',
    href: '/admin/guidebook',
    labelKey: 'marketing-site-cms.nav.guidebook',
    groupKey: 'marketing-site-cms.nav.group',
  },
  {
    id: 'cms-contact',
    href: '/admin/contact-messages',
    labelKey: 'marketing-site-cms.nav.contact',
    groupKey: 'marketing-site-cms.nav.group',
  },
  {
    id: 'platform-analytics',
    href: '/admin/analytics',
    labelKey: 'dashboards-analytics-charts.admin.nav.analytics',
    groupKey: 'dashboards-analytics-charts.health.group',
  },
  {
    id: 'system-health',
    href: '/admin/health',
    labelKey: 'dashboards-analytics-charts.health.nav',
    groupKey: 'dashboards-analytics-charts.health.group',
  },
  {
    id: 'payment-gateways',
    href: '/admin/payment-gateways',
    labelKey: 'platform-payment-gateways.nav.gateways',
    groupKey: `${BSP}.groups.billing`,
  },
  // PAYGW domain (seam edit): WaDesk's Billing group order, Billing history, Order history, Invoices, Billing settings.
  {
    id: 'billing-history',
    href: '/admin/billing-history',
    labelKey: 'platform-payment-gateways.nav.billingHistory',
    groupKey: `${BSP}.groups.billing`,
  },
  {
    id: 'order-history',
    href: '/admin/order-history',
    labelKey: 'platform-payment-gateways.nav.orders',
    groupKey: `${BSP}.groups.billing`,
  },
  {
    id: 'invoices',
    href: '/admin/invoices',
    labelKey: 'platform-payment-gateways.nav.invoices',
    groupKey: `${BSP}.groups.billing`,
  },
  {
    id: 'checkout-settings',
    href: '/admin/checkout-settings',
    labelKey: 'platform-payment-gateways.nav.billingSettings',
    groupKey: `${BSP}.groups.billing`,
  },
  // BSP domain (seam edit): the two reseller pages, in WaDesk's Billing group.
  {
    id: 'bsp-income',
    href: '/admin/bsp',
    labelKey: `${BSP}.income`,
    groupKey: `${BSP}.groups.billing`,
  },
  {
    id: 'bsp-credit',
    href: '/admin/bsp/credit',
    labelKey: `${BSP}.reseller`,
    groupKey: `${BSP}.groups.billing`,
  },
  // Wallet domain (seam edit): same Billing group as the reseller pages.
  {
    id: 'wallet-pricing',
    href: '/admin/wallet/pricing',
    labelKey: `${WALLET}.pricing`,
    groupKey: `${BSP}.groups.billing`,
  },
  {
    id: 'wallet-margins',
    href: '/admin/wallet/margins',
    labelKey: `${WALLET}.margins`,
    groupKey: `${BSP}.groups.billing`,
  },
  {
    id: 'wallet-packages',
    href: '/admin/wallet/packages',
    labelKey: `${WALLET}.packages`,
    groupKey: `${BSP}.groups.billing`,
  },
  {
    id: 'wallet-workspaces',
    href: '/admin/wallet/workspaces',
    labelKey: `${WALLET}.workspaces`,
    groupKey: `${BSP}.groups.billing`,
  },
  {
    id: 'wallet-logs',
    href: '/admin/wallet/logs',
    labelKey: `${WALLET}.logs`,
    groupKey: `${BSP}.groups.billing`,
  },
];

/** The page a signed-in operator lands on and the brand link points to. */
export const OPERATOR_HOME = '/admin/security';

/** Where the account (MFA) page lives; the only page a super admin without MFA may open. */
export const OPERATOR_ACCOUNT_PATH = '/admin/account/security';

/** The item whose href is the longest prefix of the path, so `/admin/security/events` does not light up `/admin/security`. */
export function activeNavId(pathname: string, items: readonly OperatorNavItem[]): string | null {
  let best: OperatorNavItem | null = null;
  for (const item of items) {
    const hit = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (hit && (!best || item.href.length > best.href.length)) best = item;
  }
  return best?.id ?? null;
}

/** Items grouped in first-seen order. */
export function groupNav(
  items: readonly OperatorNavItem[],
): Array<{ groupKey: string; items: OperatorNavItem[] }> {
  const groups: Array<{ groupKey: string; items: OperatorNavItem[] }> = [];
  for (const item of items) {
    const g = groups.find((x) => x.groupKey === item.groupKey);
    if (g) g.items.push(item);
    else groups.push({ groupKey: item.groupKey, items: [item] });
  }
  return groups;
}
