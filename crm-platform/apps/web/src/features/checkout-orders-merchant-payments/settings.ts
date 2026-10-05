import { settingsTile } from '../_registry/settings-types';

/** The one payment gateway of the workspace (store checkout and Sales invoices share it): a tile under Business and billing. */
export const settings = [
  settingsTile({
    id: 'payment-gateways',
    labelKey: 'checkout-orders-merchant-payments.settingsTile.label',
    descriptionKey: 'checkout-orders-merchant-payments.settingsTile.description',
    keywordsKey: 'checkout-orders-merchant-payments.settingsTile.keywords',
    section: 'business',
    href: '/store/gateways',
    icon: 'wallet',
    order: 35,
    gates: { permission: 'store.gateways.read' },
  }),
];
