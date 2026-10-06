import type { NavItem } from '../_registry/types';

/**
 * The Store group's merchant entries: Orders and Coupons (the two screens the plan's `wa_storefront` feature locks). The other
 * store pages (customers, groups, payments, gateways, invoices) open from the store sidebar, and the payment gateway also has a
 * Settings tile. Declaring these two here is what makes the paywall cover `/store/orders` and `/store/coupons`.
 *
 * `inMenu: false` on both: the Store sidebar (`storefront-builder/admin/lib/sidebar.ts`) already lists them, so the main menu keeps
 * one Store entry instead of repeating its sections. The entries stay registered for the paywall, Help and the command palette.
 */
export const nav: NavItem[] = [
  {
    id: 'store-orders',
    group: 'store',
    labelKey: 'checkout-orders-merchant-payments.nav.orders',
    href: '/store/orders',
    order: 5,
    icon: 'invoice',
    inMenu: false,
    gates: { permission: 'store.orders.read', planFeature: 'wa_storefront' },
  },
  {
    id: 'store-coupons',
    group: 'store',
    labelKey: 'checkout-orders-merchant-payments.nav.coupons',
    href: '/store/coupons',
    order: 40,
    icon: 'percent',
    inMenu: false,
    gates: { permission: 'store.coupons.read', planFeature: 'wa_storefront' },
  },
];
