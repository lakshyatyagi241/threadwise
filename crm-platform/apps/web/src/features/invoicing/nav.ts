import type { NavItem } from '../_registry/types';

/**
 * Sales group: Invoices and Payments take over WaDesk's planned "Soon" entries (same ids, so `planned.ts` drops them), with the
 * other sales documents around them. Tax rates and the Business profile are Settings tiles (see `settings.ts`). They are not gated
 * by a permission here: the invoicing permission keys come with the API, and the screens themselves follow `lib/permissions.ts`.
 */
export const nav: NavItem[] = [
  {
    id: 'invoices',
    group: 'sales',
    labelKey: 'invoicing.nav.invoices',
    href: '/invoices',
    order: 30,
    icon: 'invoice',
  },
  {
    id: 'payments',
    group: 'sales',
    labelKey: 'invoicing.nav.payments',
    href: '/payments',
    order: 40,
    icon: 'payment',
  },
  {
    id: 'sales-orders',
    group: 'sales',
    labelKey: 'invoicing.nav.salesOrders',
    href: '/sales-orders',
    order: 20,
    icon: 'invoice',
  },
  {
    id: 'credit-notes',
    group: 'sales',
    labelKey: 'invoicing.nav.creditNotes',
    href: '/credit-notes',
    order: 35,
    icon: 'invoice',
  },
  {
    id: 'recurring-invoices',
    group: 'sales',
    labelKey: 'invoicing.nav.recurring',
    href: '/recurring-invoices',
    order: 32,
    icon: 'payment',
  },
];
