import type { NavItem } from '../_registry/types';

/** One menu entry, in Reference's Automation group after Auto reply (see `planned.ts` for the sequence). */
export const nav: NavItem[] = [
  {
    id: 'appointments',
    group: 'automation',
    labelKey: 'appointments.nav.appointments',
    href: '/appointments',
    order: 30,
    icon: 'calendar',
    gates: { permission: 'record.appointments.read' },
  },
];
