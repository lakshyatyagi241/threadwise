import { settingsTile } from '../_registry/settings-types';

/**
 * The growth pilot (new to the product, no Reference screen): what lead scoring knows, turned into things a team can act on. A tile
 * under Automation for roles that may read the lead scoring log; the page itself says so when the workspace is not in the pilot.
 * Copy lives in `messages/<locale>/settings.json` under `settings.tiles.growth`.
 */
export const settings = [
  settingsTile({
    id: 'growth',
    section: 'automation',
    href: '/growth',
    icon: 'bot',
    order: 9,
    gates: { permission: 'lsc.runs.read' },
  }),
];
