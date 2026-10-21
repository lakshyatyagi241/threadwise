import { settingsTile } from '../_registry/settings-types';

/**
 * Auto-assignment (TW-TIB2-004 to 011): the routing rules that give a new conversation to an agent. A tile under Automation for roles that may
 * read the inbox configuration; a plan without the `inbox_routing` feature sees it locked. Copy lives in `messages/<locale>/settings.json`
 * under `settings.tiles.auto-assignment`.
 *
 * Handoff and assignment (BL-396 to BL-404): how a conversation reaches a person after a bot asks for one, and how the contact owner and the
 * chat owner relate. Open to every plan (no plan gate): what a plan does not include shows a lock on the screen. Copy lives under
 * `settings.tiles.assignment-settings`.
 *
 * Record assignment rules (contacts, companies and deals) are a tile of the record-assignment domain.
 */
export const settings = [
  settingsTile({
    id: 'auto-assignment',
    section: 'automation',
    href: '/auto-assignment',
    icon: 'transfer',
    order: 25,
    shortcutFrom: ['/inbox'],
    gates: { permission: 'inbox.settings.read', planFeature: 'inbox_routing' },
  }),
  settingsTile({
    id: 'assignment-settings',
    section: 'automation',
    href: '/assignment-settings',
    icon: 'transfer',
    order: 26,
    shortcutFrom: ['/inbox'],
    gates: { permission: 'inbox.settings.read' },
  }),
  settingsTile({
    id: 'sla-policies',
    section: 'automation',
    href: '/sla-policies',
    icon: 'history',
    order: 27,
    shortcutFrom: ['/inbox'],
    gates: { permission: 'inbox.sla.manage', planFeature: 'inbox_sla' },
  }),
];
