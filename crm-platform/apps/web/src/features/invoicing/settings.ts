import { settingsTile } from '../_registry/settings-types';

/** Business profile and Tax rates left the menu for Settings (Business and billing). The permission keys follow the screens' own checks. */
export const settings = [
  settingsTile({
    id: 'business-profile',
    shortcutFrom: [
      '/invoices',
      '/credit-notes',
      '/sales-orders',
      '/recurring-invoices',
      '/payments',
      '/estimates',
      '/proposals',
    ],
    section: 'business',
    href: '/business-profile',
    icon: 'building',
    order: 0,
    gates: { permission: 'record.invoices.settings' },
  }),
  settingsTile({
    id: 'tax-rates',
    shortcutFrom: [
      '/invoices',
      '/credit-notes',
      '/sales-orders',
      '/recurring-invoices',
      '/payments',
      '/estimates',
      '/proposals',
    ],
    section: 'business',
    href: '/tax-rates',
    icon: 'percent',
    order: 10,
    gates: { permission: 'record.tax-rates.read' },
  }),
];
