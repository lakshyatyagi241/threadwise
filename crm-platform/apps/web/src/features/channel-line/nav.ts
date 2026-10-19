import type { NavItem } from '../_registry/types';

/**
 * Line is a connection, so the sidebar does not list it (`inMenu: false`): its tile is in Settings > Channels (see `settings.ts`).
 * The entry stays registered so a plan without the `extra_channels` feature gets the upgrade sheet on `/line` and the screens
 * are not mounted, which keeps their plan-locked requests from firing.
 */
export const nav: NavItem[] = [
  {
    id: 'line',
    group: 'inbox',
    labelKey: 'settings.tiles.line.label',
    href: '/line',
    order: 71,
    icon: 'chat',
    inMenu: false,
    gates: { permission: 'line.channels.read', planFeature: 'extra_channels', closeWhenLocked: true },
  },
];
