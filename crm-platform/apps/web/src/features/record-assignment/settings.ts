import { settingsTile } from '../_registry/settings-types';

/**
 * Record assignment rules (BL-013, BL-340..345): the priority rules that give new contacts, companies and deals to sales owners. ONE tile
 * under Automation for roles that may read it; a plan without the `record_assignment` feature sees it locked. Copy lives in
 * `messages/<locale>/settings.json` under `settings.tiles.record-assignment`. (The conversation Auto-assignment tile is the inbox's.)
 */
export const settings = [
  settingsTile({
    id: 'record-assignment',
    section: 'automation',
    href: '/record-assignment',
    icon: 'transfer',
    order: 26,
    gates: { permission: 'crm.assignment.read', planFeature: 'record_assignment' },
  }),
];
