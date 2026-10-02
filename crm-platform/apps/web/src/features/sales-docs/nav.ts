import type { NavItem } from '../_registry/types';

/**
 * Proposals and estimates, in the Sales group right after the CRM dashboard (see `planned.ts` for the sequence: CRM
 * dashboard 0, Proposals 10, Estimates 20, Invoices 30, Payments 40). One permission reads both kinds. The API also gates the
 * module behind the sales-pipeline plan flag (like Deals); a plan without it answers PLAN_FEATURE_LOCKED and the screens say so.
 */
export const nav: NavItem[] = [
  {
    id: 'proposals',
    group: 'sales',
    labelKey: 'sales-docs.nav.proposals',
    href: '/proposals',
    order: 10,
    icon: 'proposal',
    gates: { permission: 'record.sales-docs.read' },
  },
  {
    id: 'estimates',
    group: 'sales',
    labelKey: 'sales-docs.nav.estimates',
    href: '/estimates',
    order: 20,
    icon: 'estimate',
    gates: { permission: 'record.sales-docs.read' },
  },
];
