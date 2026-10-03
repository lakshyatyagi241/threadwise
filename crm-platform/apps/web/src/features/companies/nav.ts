import type { NavItem } from '../_registry/types';

/** One menu entry, in WaDesk's CRM group after Tasks and before Email templates (see `planned.ts` for the sequence). */
export const nav: NavItem[] = [
  {
    id: 'companies',
    group: 'audience',
    labelKey: 'companies.nav.companies',
    href: '/companies',
    order: 70,
    icon: 'companies',
    gates: { permission: 'record.companies.read', planFeature: 'sales_pipeline' },
  },
];
