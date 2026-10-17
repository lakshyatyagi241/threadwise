import type { NavItem } from '../_registry/types';

/**
 * AI lead scoring is a first-party Marketplace app that grants the plan feature `lead_scoring` (migration 20261228090000). Its screen is a
 * Settings tile (`settings.ts`), not a menu entry (`inMenu: false`), and this entry is what closes `/lead-scoring` (any depth) for a workspace
 * that has not bought and installed the app: the `app` gate removes the tile and the shell shows "isn't part of your workspace" with a link to the
 * app's page. A workspace that already used scoring was given the feature by the migration and sees nothing different. The label is the
 * tile's, so the lock screen names the app the way Settings does.
 */
export const nav: NavItem[] = [
  {
    id: 'lead-scoring',
    group: 'automation',
    labelKey: 'settings.tiles.lead-scoring.label',
    href: '/lead-scoring',
    order: 80,
    icon: 'bot',
    inMenu: false,
    gates: { permission: 'lsc.runs.read', app: 'lead_scoring' },
  },
];
