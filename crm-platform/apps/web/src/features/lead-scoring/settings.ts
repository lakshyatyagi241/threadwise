import { settingsTile } from '../_registry/settings-types';

/**
 * AI lead scoring (new to the product, no Reference screen): the workspace's opt-in, what scoring costs, and the log. A tile under
 * Automation for roles that may read the log. Copy lives in `messages/<locale>/settings.json` under `settings.tiles.lead-scoring`.
 */
export const settings = [
  settingsTile({
    id: 'lead-scoring',
    section: 'automation',
    href: '/lead-scoring',
    icon: 'bot',
    order: 8,
    gates: { permission: 'lsc.runs.read' },
  }),
];
