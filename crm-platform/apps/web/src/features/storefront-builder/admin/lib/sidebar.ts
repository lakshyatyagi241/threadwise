import type { StoreSidebarCounts } from '@crm/contracts';
import { shopHref } from './format';

/** The store area's left navigation (TW-STORE-002/023), in Reference's order. */
export type SidebarKey =
  | 'overview'
  | 'orders'
  | 'products'
  | 'groups'
  | 'storefront'
  | 'coupons'
  | 'reviews'
  | 'payments'
  | 'gateways'
  | 'customers'
  | 'invoices'
  | 'connection';

export interface SidebarEntry {
  key: SidebarKey;
  /** `link`: a page that exists; `soon`: owned by a domain not built yet (shown disabled). */
  state: 'link' | 'soon';
  href: string;
  /** Store sub-pages that exist only for people holding this permission are hidden without it. */
  permission?: string;
  /** SVG path data (16x16 viewBox) of the icon. */
  icon: string;
  /** The link carries the selected shop. */
  carriesShop?: boolean;
}

export const MAIN_ENTRIES: readonly SidebarEntry[] = [
  {
    key: 'overview',
    state: 'link',
    href: '/store',
    icon: 'M2 11l3-5 3 3 3-6 3 4',
    carriesShop: true,
  },
  {
    key: 'orders',
    state: 'soon',
    href: '/store/orders',
    icon: 'M2 4h2l1.5 8h7l1-5H6 M6 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M11 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  },
  {
    key: 'products',
    state: 'link',
    href: '/store/products',
    icon: 'M2 5l6-3 6 3v6l-6 3-6-3z M2 5l6 3 6-3 M8 8v6',
  },
  {
    key: 'groups',
    state: 'soon',
    href: '/store/groups',
    icon: 'M5 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M11 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M1.5 13c0-2 1.3-3 3.5-3s3.5 1 3.5 3 M7.5 13c0-2 1.3-3 3.5-3s3.5 1 3.5 3',
  },
  {
    key: 'storefront',
    state: 'link',
    href: '/store/storefront',
    permission: 'store.storefront.read',
    icon: 'M2 5h12v8H2z M2 8h12 M5 5v3',
    carriesShop: true,
  },
  {
    key: 'coupons',
    state: 'soon',
    href: '/store/coupons',
    icon: 'M2 6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2 1.5 1.5 0 0 0 0 4 2 2 0 0 1-2 2H4a2 2 0 0 1-2-2 1.5 1.5 0 0 0 0-4z M9 5l-2 6',
  },
  {
    key: 'reviews',
    state: 'link',
    href: '/store/reviews',
    icon: 'M8 2l1.8 3.6L14 6.2l-3 2.9.7 4.1L8 11.3 4.3 13.2 5 9.1 2 6.2l4.2-.6z',
  },
  {
    key: 'payments',
    state: 'soon',
    href: '/store/payments',
    icon: 'M1.5 4.5h13v7h-13z M1.5 7h13 M4 9.5h3',
  },
  {
    key: 'gateways',
    state: 'soon',
    href: '/store/gateways',
    icon: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z M1.5 8h13 M8 1.5c-2 2-2 11 0 13 M8 1.5c2 2 2 11 0 13',
  },
  {
    key: 'customers',
    state: 'soon',
    href: '/store/customers',
    icon: 'M8 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M2.5 14c0-2.5 2.2-4 5.5-4s5.5 1.5 5.5 4',
  },
  {
    key: 'invoices',
    state: 'soon',
    href: '/store/invoices',
    icon: 'M4 2h6l2 2v10H4V2Z M6 6h4M6 8.5h4M6 11h2.5',
  },
];

export const SETTINGS_ENTRIES: readonly SidebarEntry[] = [
  {
    key: 'connection',
    state: 'link',
    href: '/connect?platform=wa-store',
    icon: 'M5.5 4.5 3 7l2.5 2.5M10.5 4.5 13 7l-2.5 2.5M7 12l2-8',
  },
];

/** The entries a person sees: the ones needing a permission they lack are left out. */
export function visibleEntries(
  entries: readonly SidebarEntry[],
  can: (permission: string) => boolean,
): SidebarEntry[] {
  return entries.filter((e) => !e.permission || can(e.permission));
}

export function entryHref(entry: SidebarEntry, shopId: string | null | undefined): string {
  if (!entry.carriesShop) return entry.href;
  return shopHref(entry.href, shopId);
}

/** The highlighted entry: the second URL segment under /store (the overview by default); the wizard is "connection". */
export function activeKey(pathname: string): SidebarKey {
  if (pathname === '/connect' || pathname.startsWith('/connect/')) return 'connection';
  const second = pathname.split('/').filter(Boolean)[1];
  const keys = MAIN_ENTRIES.map((e) => e.key);
  return (keys.find((k) => k === second) ?? 'overview') as SidebarKey;
}

/** The number beside an entry (Reference shows it when above zero); the overview and settings entries carry none. */
export function countFor(key: SidebarKey, counts: StoreSidebarCounts): number | undefined {
  switch (key) {
    case 'orders':
      return counts.orders;
    case 'products':
      return counts.products;
    case 'groups':
      return counts.groups;
    case 'coupons':
      return counts.coupons;
    case 'reviews':
      return counts.reviewsPending;
    case 'payments':
      return counts.payments;
    case 'gateways':
      return counts.gateways;
    case 'customers':
      return counts.customers;
    default:
      return undefined;
  }
}
