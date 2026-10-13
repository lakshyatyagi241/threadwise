import type { NavItem } from '../_registry/types';

/**
 * "Notifications" (`/notifications`) is the full page behind the bell's "View all" (Platform group, after Analytics); its label is the
 * shell's own. "Notification preferences" is a pane of the account hub (`/account/<name>` joins the hub menu, order below 100 = the Account group): the
 * signed-in person's own bell, pop-up and sound choices per event. The bell itself is not a menu entry (it lives in the top bar).
 */
export const nav: NavItem[] = [
  {
    id: 'notifications',
    group: 'overview',
    labelKey: 'shell.nav.notifications',
    href: '/notifications',
    order: 20,
    icon: 'bell',
  },
  {
    id: 'notification-prefs',
    group: 'settings',
    labelKey: 'notifications.nav.preferences',
    href: '/account/notifications',
    order: 25,
  },
];
