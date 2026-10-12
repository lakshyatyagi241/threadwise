import { settingsTile } from '../_registry/settings-types';

/** The workspace's own purchases: order history left the menu for Settings; the wallet top-up is its checkout. */
export const settings = [
  settingsTile({
    id: 'billing-orders',
    section: 'business',
    href: '/billing/orders',
    icon: 'history',
    order: 30,
    gates: { permission: 'paygw.orders.read' },
  }),
  settingsTile({
    id: 'billing-subscriptions',
    section: 'business',
    href: '/billing/subscriptions',
    icon: 'history',
    order: 31,
    gates: { permission: 'plan.subscription.manage' },
  }),
  settingsTile({
    id: 'wallet',
    section: 'business',
    href: '/billing/checkout/wallet',
    icon: 'wallet',
    order: 25,
    gates: { permission: 'paygw.orders.read' },
  }),
];
