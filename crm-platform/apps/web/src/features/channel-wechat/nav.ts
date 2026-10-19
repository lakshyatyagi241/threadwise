import type { NavItem } from '../_registry/types';

/**
 * Wechat is a connection, so the sidebar does not list it (`inMenu: false`): its tile is in Settings > Channels (see `settings.ts`).
 * The entry stays registered so a plan without the `extra_channels` feature gets the upgrade sheet on `/wechat` and the screens
 * are not mounted, which keeps their plan-locked requests from firing.
 */
export const nav: NavItem[] = [
  {
    id: 'wechat',
    group: 'inbox',
    labelKey: 'settings.tiles.wechat.label',
    href: '/wechat',
    order: 71,
    icon: 'chat',
    inMenu: false,
    gates: { permission: 'wechat.channels.read', planFeature: 'extra_channels', closeWhenLocked: true },
  },
];
