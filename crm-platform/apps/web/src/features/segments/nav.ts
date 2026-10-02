import type { NavItem } from '../_registry/types';

/** One menu entry, in the CRM group right after Contacts, Attributes and Contact groups (see `planned.ts` for the sequence). */
export const nav: NavItem[] = [
  {
    id: 'segments',
    group: 'audience',
    labelKey: 'segments.nav.segments',
    href: '/segments',
    order: 3,
    icon: 'segment',
    gates: { permission: 'record.segments.read' },
  },
];
