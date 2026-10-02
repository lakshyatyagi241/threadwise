import { settingsTile } from '../_registry/settings-types';

/** The pipeline and stage editor was only reachable from the board's toolbar; it is now also a Settings tile. */
export const settings = [
  settingsTile({
    id: 'deal-pipelines',
    section: 'data',
    href: '/deals/settings',
    icon: 'deal',
    order: 30,
    gates: { permission: 'record.pipelines.read' },
  }),
];
