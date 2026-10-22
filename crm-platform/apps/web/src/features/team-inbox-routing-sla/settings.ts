import { settingsTile } from '../_registry/settings-types';

/**
 * Auto-assignment (TW-TIB2-004 to 011): the routing rules that give a new conversation to an agent. A tile under Automation for roles that may
 * read the inbox configuration. It is NOT plan-locked as a whole: the page holds base controls every plan has (the claim-sets-owner and
 * queue-alert switches, the waiting queue note) next to the Smart routing ones (`inbox_routing`, `inbox_assignment_sticky`), and each of those
 * shows its own lock naming the add-on. Copy lives in `messages/<locale>/settings.json`
 * under `settings.tiles.auto-assignment`.
 *
 * Handoff and assignment (BL-396 to BL-404) used to have a tile of its own; its settings are now the four switches and the Advanced part at the top
 * of the Auto-assignment page (spec H14). The old /assignment-settings address redirects there.
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
