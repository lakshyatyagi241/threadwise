import type { NavItem } from '../_registry/types';

export const nav: NavItem[] = [
  {
    id: 'templates',
    group: 'campaigns',
    labelKey: 'message-templates.nav.title',
    href: '/templates',
    order: 30,
    icon: 'template',
    gates: { permission: 'tpl.templates.read' },
  },
];
