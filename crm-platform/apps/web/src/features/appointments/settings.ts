import { settingsTile } from '../_registry/settings-types';

/** Appointments stays in the menu; its set-up screens (booking types, hours and booking rules) are Settings tiles. */
export const settings = [
  settingsTile({
    id: 'booking-types',
    section: 'automation',
    href: '/appointments/types',
    icon: 'calendar',
    order: 10,
    gates: { permission: 'record.booking-types.read' },
  }),
  settingsTile({
    id: 'appointment-settings',
    section: 'automation',
    href: '/appointments/settings',
    icon: 'sliders',
    order: 11,
    gates: { permission: 'record.booking-types.read' },
  }),
];
