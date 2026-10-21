import type { NavItem } from '../_registry/types';

/**
 * Reference's menu entries for Facebook that are work rather than setup: Facebook Posts and Messenger Broadcasts. Pages are connected from
 * Settings > Channels (see `settings.ts`). Messenger Setup (greeting, menu, replies) is automation.
 */
export const nav: NavItem[] = [
  {
    id: 'facebook',
    group: 'inbox',
    labelKey: 'settings.tiles.facebook.label',
    href: '/facebook',
    order: 72,
    icon: 'facebook',
    inMenu: false,
    gates: { permission: 'fb.pages.read', planFeature: 'extra_channels', closeWhenLocked: true },
  },
  {
    id: 'facebook-posts',
    group: 'campaigns',
    labelKey: 'facebook.nav.posts',
    href: '/facebook/posts',
    order: 40,
    icon: 'send',
    gates: { planFeature: 'extra_channels', closeWhenLocked: true, permission: 'fb.posts.read' },
  },
  {
    id: 'facebook-broadcasts',
    group: 'campaigns',
    labelKey: 'facebook.nav.broadcasts',
    href: '/facebook/broadcasts',
    order: 41,
    icon: 'broadcast',
    gates: { planFeature: 'extra_channels', closeWhenLocked: true, permission: 'fb.broadcasts.read' },
  },
  {
    id: 'facebook-setup',
    group: 'automation',
    labelKey: 'facebook.nav.setup',
    href: '/facebook/setup',
    order: 45,
    icon: 'bot',
    gates: { planFeature: 'extra_channels', closeWhenLocked: true, permission: 'fb.setup.manage' },
  },
];
