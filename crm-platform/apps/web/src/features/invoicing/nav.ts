import type { NavItem } from '../_registry/types';

/**
 * Sales group: Invoices and Payments take over Reference's planned "Soon" entries (same ids, so `planned.ts` drops them), with the
 * other sales documents around them. Tax rates and the Business profile are Settings tiles (see `settings.ts`). Each entry needs the
 * read key of its own screen, so a role (or a migrated workspace whose old product had no invoicing, see
 * tools/migration/access/module-ceiling.ts) without it does not see the entry; the screens themselves follow `lib/permissions.ts`.
 */
export const nav: NavItem[] = [
  {
    id: 'invoices',
    group: 'sales',
    labelKey: 'invoicing.nav.invoices',
    href: '/invoices',
    order: 30,
    icon: 'invoice',
    gates: { permission: 'record.invoices.read' },
  },
  {
    id: 'payments',
    group: 'sales',
    labelKey: 'invoicing.nav.payments',
    href: '/payments',
    order: 40,
    icon: 'payment',
    gates: { permission: 'record.payments.read' },
  },
  {
    id: 'sales-orders',
    group: 'sales',
    labelKey: 'invoicing.nav.salesOrders',
    href: '/sales-orders',
    order: 20,
    icon: 'invoice',
    gates: { permission: 'record.sales-orders.read' },
  },
  {
    id: 'credit-notes',
    group: 'sales',
    labelKey: 'invoicing.nav.creditNotes',
    href: '/credit-notes',
    order: 35,
    icon: 'invoice',
    gates: { permission: 'record.credit-notes.read' },
  },
  {
    id: 'recurring-invoices',
    group: 'sales',
    labelKey: 'invoicing.nav.recurring',
    href: '/recurring-invoices',
    order: 32,
    icon: 'payment',
    gates: { permission: 'record.recurring-invoices.read' },
  },
];
