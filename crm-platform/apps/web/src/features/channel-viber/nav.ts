import type { NavItem } from '../_registry/types';

/**
 * Viber is a connection, so the sidebar does not list it (`inMenu: false`): its tile is in Settings > Channels (see `settings.ts`).
 * The entry stays registered so a plan without the `extra_channels` feature gets the upgrade sheet on `/viber` and the screens
 * are not mounted, which keeps their plan-locked requests from firing.
 */
export const nav: NavItem[] = [
  {
    id: 'viber',
    group: 'inbox',
    labelKey: 'settings.tiles.viber.label',
    href: '/viber',
    order: 71,
    icon: 'chat',
    inMenu: false,
    gates: { permission: 'viber.channels.read', planFeature: 'extra_channels', closeWhenLocked: true },
  },
];
