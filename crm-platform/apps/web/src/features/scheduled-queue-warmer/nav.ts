import type { NavItem } from '../_registry/types';

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
    gates: { permission: 'sched.warmer.manage' },
  },
];
