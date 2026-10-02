import type { NavItem } from '../_registry/types';

/** Reference's menu entries for Facebook (Facebook Posts, Messenger Setup, Messenger Broadcasts), plus the hub where Pages are connected. */
export const nav: NavItem[] = [
  {
    id: 'facebook',
    group: 'channels',
    labelKey: 'facebook.nav.hub',
    href: '/facebook',
    order: 20,
    icon: 'channels',
    gates: { permission: 'fb.pages.read' },
  },
  {
    id: 'facebook-posts',
    group: 'channels',
    labelKey: 'facebook.nav.posts',
    href: '/facebook/posts',
    order: 21,
    icon: 'send',
    gates: { permission: 'fb.posts.read' },
  },
  {
    id: 'facebook-setup',
    group: 'channels',
    labelKey: 'facebook.nav.setup',
    href: '/facebook/setup',
    order: 22,
    icon: 'bot',
    gates: { permission: 'fb.setup.manage' },
  },
  {
    id: 'facebook-broadcasts',
    group: 'channels',
    labelKey: 'facebook.nav.broadcasts',
    href: '/facebook/broadcasts',
    order: 23,
    icon: 'broadcast',
    gates: { permission: 'fb.broadcasts.read' },
  },
];
