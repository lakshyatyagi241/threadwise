import type { NavItem } from '../_registry/types';

/**
 * Telegram is a connection, so the sidebar does not list it (`inMenu: false`): its tile is in Settings > Channels (see `settings.ts`).
 * The entry stays registered so a plan without the `extra_channels` feature gets the upgrade sheet on `/telegram` and the screens
 * are not mounted, which keeps their plan-locked requests from firing.
 */
export const nav: NavItem[] = [
  {
    id: 'telegram',
    group: 'inbox',
    labelKey: 'settings.tiles.telegram.label',
    href: '/telegram',
    order: 71,
    icon: 'send',
    inMenu: false,
    gates: { permission: 'tg.bots.read', planFeature: 'extra_channels', closeWhenLocked: true },
  },
];
