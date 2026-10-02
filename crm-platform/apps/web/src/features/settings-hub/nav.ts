import type { NavItem } from '../_registry/types';

/**
 * The one "Settings" entry. The shell pins it to the bottom of the menu; it also reads as active on every Settings page and on
 * every screen a Settings tile points at (see `components/shell/nav-model.ts`). Every configuration screen is reached from here.
 */
export const nav: NavItem[] = [
  {
    id: 'settings',
    group: 'settings',
    labelKey: 'shell.settings',
    href: '/settings',
    order: 0,
    icon: 'gear',
  },
];
