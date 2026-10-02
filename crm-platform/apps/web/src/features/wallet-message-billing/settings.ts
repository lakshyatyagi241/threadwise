import { settingsTile } from '../_registry/settings-types';

/** The workspace's wallet, under Business and billing. The top-up checkout stays the payment gateways' tile. */
export const settings = [
  settingsTile({
    id: 'wallet-message-billing',
    section: 'business',
    href: '/billing/wallet',
    icon: 'wallet',
    order: 24,
    labelKey: 'wallet-message-billing.tile.label',
    descriptionKey: 'wallet-message-billing.tile.description',
    keywordsKey: 'wallet-message-billing.tile.keywords',
    gates: { permission: 'wallet.balance.read' },
  }),
];
