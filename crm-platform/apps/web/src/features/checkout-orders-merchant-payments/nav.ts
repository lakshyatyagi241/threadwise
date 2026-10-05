import type { NavItem } from '../_registry/types';

/**
 * The Store group's merchant entries: Orders and Coupons (the two screens the plan's `wa_storefront` feature locks). The other
 * store pages (customers, groups, payments, gateways, invoices) open from the store sidebar, and the payment gateway also has a
 * Settings tile. Declaring these two here is what makes the paywall cover `/store/orders` and `/store/coupons`.
 */
export const nav: NavItem[] = [
  {
    id: 'store-orders',
    group: 'store',
    labelKey: 'checkout-orders-merchant-payments.nav.orders',
    href: '/store/orders',
    order: 5,
    icon: 'invoice',
    gates: { permission: 'store.orders.read', planFeature: 'wa_storefront' },
  },
  {
    id: 'store-coupons',
    group: 'store',
    labelKey: 'checkout-orders-merchant-payments.nav.coupons',
    href: '/store/coupons',
    order: 40,
    icon: 'percent',
    gates: { permission: 'store.coupons.read', planFeature: 'wa_storefront' },
  },
];
