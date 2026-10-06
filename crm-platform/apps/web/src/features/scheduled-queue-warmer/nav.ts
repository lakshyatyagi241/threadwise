import type { NavItem } from '../_registry/types';

/**
 * Scheduled messages are campaign work and stay in the sidebar. The warmer prepares a WhatsApp number for sending, which is set-up
 * rather than daily work: it has a tile in Settings > Channels (see `settings.ts`), so the sidebar does not list it (`inMenu: false`).
 * The entry stays registered for the gates, Help and the command palette. It only exists while the platform has the unofficial
 * WhatsApp engine switched on (`gates.app: 'unofficial_whatsapp'`): the official WhatsApp API needs no warming.
 */
export const nav: NavItem[] = [
  {
    id: 'scheduled',
    group: 'campaigns',
    labelKey: 'scheduled-queue-warmer.nav.scheduled',
    href: '/scheduled',
    order: 30,
    icon: 'clock',
    gates: { permission: 'sched.schedules.read' },
  },
  {
    id: 'warmer',
    group: 'campaigns',
    labelKey: 'scheduled-queue-warmer.nav.warmer',
    href: '/warmer',
    order: 31,
    icon: 'campaign',
    inMenu: false,
    // Warming only matters for personal numbers (the unofficial engine): off, the entry, its tile and its route are removed.
    gates: { permission: 'sched.warmer.manage', app: 'unofficial_whatsapp' },
  },
];
