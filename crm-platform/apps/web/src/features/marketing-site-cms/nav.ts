import type { NavItem } from '../_registry/types';

/** The help centre, in the user menu's Help group (TW-CMS-047). Open to every signed-in user, so no permission gate. */
export const nav: NavItem[] = [
  {
    id: 'guidebook',
    group: 'help',
    labelKey: 'marketing-site-cms.guidebook.nav',
    href: '/guidebook',
    order: 10,
    icon: 'book',
  },
];
