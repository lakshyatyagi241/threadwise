import type { NavItem } from '../_registry/types';

/**
 * The Help center's menu entry. It sits in the `settings` group, which the shell pins under the scrolling menu, and its order puts
 * it directly above Settings (order 0). The label is the shell's own `shell.help` ("Help").
 */
export const nav: NavItem[] = [
  {
    id: 'help-center',
    group: 'settings',
    labelKey: 'shell.help',
    href: '/help',
    order: -10,
    icon: 'help',
  },
];
