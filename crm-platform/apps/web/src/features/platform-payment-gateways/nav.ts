import type { NavItem } from '../_registry/types';

/** The workspace's own purchases. Checkout is reached from the plan picker and the wallet, not from the menu. */
export const nav: NavItem[] = [
  {
    id: 'billing-orders',
    group: 'settings',
    labelKey: 'platform-payment-gateways.nav.orders',
    href: '/billing/orders',
    order: 40,
    icon: 'history',
    gates: { permission: 'paygw.orders.read' },
  },
];
