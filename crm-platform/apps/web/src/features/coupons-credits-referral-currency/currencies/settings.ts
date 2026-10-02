import { settingsTile } from '../../_registry/settings-types';

/**
 * The workspace's display currency (TW-CPN-027). Reference keeps it in the general settings form, next to the workspace name and
 * timezone; this app has no such form yet, so it is its own Settings screen. Every member may open it (the select is disabled
 * unless the caller holds the owner permission, and the API enforces the same), so the tile has no permission gate.
 */
export const currencySettings = [
  settingsTile({
    id: 'workspace-currency',
    section: 'business',
    href: '/settings/currency',
    icon: 'wallet',
    order: 20,
    labelKey: 'coupons-credits-referral-currency.currencies.tile.label',
    descriptionKey: 'coupons-credits-referral-currency.currencies.tile.description',
    keywordsKey: 'coupons-credits-referral-currency.currencies.tile.keywords',
  }),
];
