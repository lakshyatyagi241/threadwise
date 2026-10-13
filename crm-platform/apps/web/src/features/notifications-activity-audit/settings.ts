import { settingsTile } from '../_registry/settings-types';

/**
 * The Audit log (Reference: Activity Log, `/activity-log`): who changed what in the workspace, with a CSV export. A tile under Security
 * for roles that hold `audit.log.read` (Owner and Admin by default). Copy lives in `messages/<locale>/audit-log.json` under `audit-log.tile`.
 */
export const settings = [
  settingsTile({
    id: 'activity-log',
    section: 'security',
    href: '/activity-log',
    icon: 'history',
    order: 20,
    labelKey: 'audit-log.tile.label',
    descriptionKey: 'audit-log.tile.description',
    keywordsKey: 'audit-log.tile.keywords',
    gates: { permission: 'audit.log.read' },
  }),
];
