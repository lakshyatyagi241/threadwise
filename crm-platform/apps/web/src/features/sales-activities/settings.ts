import { settingsTile } from '../_registry/settings-types';

/**
 * Sales Activities (BL-370..BL-379): the activities the team logs (Task, Meeting, Phone, Email, Reminder, SMS, Chat and the business's own),
 * with the switches, task types and outcomes of each. ONE tile under Data for roles that may read it. Not plan-gated (task types and
 * outcomes are part of the basic CRM). Copy lives in `messages/<locale>/settings.json` under `settings.tiles.sales-activities`.
 */
export const settings = [
  settingsTile({
    id: 'sales-activities',
    section: 'data',
    href: '/sales-activities',
    icon: 'calendar',
    order: 22,
    shortcutFrom: ['/tasks'],
    gates: { permission: 'crm.activity_types.read' },
  }),
];
