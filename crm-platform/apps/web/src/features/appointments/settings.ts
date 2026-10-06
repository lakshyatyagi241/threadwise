import { settingsTile } from '../_registry/settings-types';

/**
 * Appointments stays in the menu; its set-up screens (booking types, hours and booking rules) are Settings tiles. Every tile carries
 * the same `app` gate as the menu entry (see `nav.ts`): a workspace that has not bought the app sees none of its set-up either.
 */
const APP = 'appointment_booking';

export const settings = [
  settingsTile({
    id: 'booking-types',
    shortcutFrom: ['/appointments'],
    section: 'automation',
    href: '/appointments/types',
    icon: 'calendar',
    order: 10,
    gates: { permission: 'record.booking-types.read', app: APP },
  }),
  settingsTile({
    id: 'appointment-settings',
    shortcutFrom: ['/appointments'],
    section: 'automation',
    href: '/appointments/settings',
    icon: 'sliders',
    order: 11,
    gates: { permission: 'record.booking-types.read', app: APP },
  }),
  // The Google Calendar card of the same screen, listed under Integrations so it can be found by its name. Connecting is editing
  // booking configuration, so the tile needs the update key.
  settingsTile({
    id: 'google-calendar',
    shortcutFrom: ['/appointments'],
    section: 'integrations',
    href: '/appointments/settings',
    icon: 'calendar',
    order: 12,
    gates: { permission: 'record.booking-types.update', app: APP },
  }),
];
