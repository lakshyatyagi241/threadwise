import type { NavItem } from '../_registry/types';

/**
 * One menu entry, in WaDesk's Automation group after Auto reply (see `planned.ts` for the sequence).
 * Appointments is a paid first-party Marketplace app that grants `appointment_booking` (docs/api/marketplace.md, "Apps that own
 * existing plan features"), so the `app` gate removes the entry and closes `/appointments` for a workspace that has not bought it.
 */
export const nav: NavItem[] = [
  {
    id: 'appointments',
    group: 'automation',
    labelKey: 'appointments.nav.appointments',
    href: '/appointments',
    order: 30,
    icon: 'calendar',
    gates: { permission: 'record.appointments.read', app: 'appointment_booking' },
  },
];
