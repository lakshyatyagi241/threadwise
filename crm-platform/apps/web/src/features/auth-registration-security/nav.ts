import type { NavItem } from '../_registry/types';

export const nav: NavItem[] = [
  {
    id: 'account',
    group: 'settings',
    labelKey: 'auth-registration-security.account.nav.title',
    href: '/account',
    order: 90,
    icon: 'settings',
  },
];
