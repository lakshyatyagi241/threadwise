import type { NavItem } from '../_registry/types';

/** One menu entry, in Reference's CRM group between Pipelines and Companies (see `planned.ts` for the sequence). */
export const nav: NavItem[] = [
  {
    id: 'tasks',
    group: 'audience',
    labelKey: 'tasks.nav.tasks',
    href: '/tasks',
    order: 60,
    icon: 'tasks',
    gates: { permission: 'record.tasks.read' },
  },
];
