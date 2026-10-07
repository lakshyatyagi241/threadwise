import type { NavItem } from '../_registry/types';

/**
 * "Notifications" is a pane of the account hub (`/account/<name>` joins the hub menu, order below 100 = the Account group): the
 * signed-in person's own bell, pop-up and sound choices per event. The bell itself is not a menu entry (it lives in the top bar).
 */
export const nav: NavItem[] = [
  {
    id: 'notification-prefs',
    group: 'settings',
    labelKey: 'notifications.nav.preferences',
    href: '/account/notifications',
    order: 25,
  },
];
