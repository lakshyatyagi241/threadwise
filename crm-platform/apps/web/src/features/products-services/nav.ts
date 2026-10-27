import type { NavItem } from '../_registry/types';

/**
 * Products and services is a paid first-party Marketplace app that grants `products_services` (docs/specs/crm-deal-estimate-invoice-products.md,
 * section 5), so the `app` gate removes the entry and closes `/products-services` for a workspace that has not bought it. It sits in Sales
 * next to Invoices.
 */
export const nav: NavItem[] = [
  {
    id: 'products-services',
    group: 'sales',
    labelKey: 'products-services.nav.title',
    href: '/products-services',
    order: 25,
    icon: 'invoice',
    gates: { permission: 'record.sales-items.read', app: 'products_services' },
  },
];
