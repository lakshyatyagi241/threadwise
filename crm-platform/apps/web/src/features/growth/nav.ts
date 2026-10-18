import type { NavItem } from '../_registry/types';

/**
 * The growth pilot is built on AI lead scoring, so it follows that app: `/growth` is closed (any depth) for a workspace that does not have
 * the plan feature `lead_scoring`, and its Settings tile (`settings.ts`) is removed. It stays out of the menu (`inMenu: false`); the tile is
 * how a person reaches it, and the screen still says when the workspace is not in the pilot.
 */
export const nav: NavItem[] = [
  {
    id: 'growth',
    group: 'automation',
    labelKey: 'settings.tiles.growth.label',
    href: '/growth',
    order: 81,
    icon: 'bot',
    inMenu: false,
    gates: { permission: 'lsc.runs.read', app: 'lead_scoring' },
  },
];
