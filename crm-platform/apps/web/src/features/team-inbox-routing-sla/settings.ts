import { settingsTile } from '../_registry/settings-types';

/**
 * Auto-assignment (TW-TIB2-004 to 011): the routing rules that give a new conversation to an agent. A tile under Automation for roles that may
 * read the inbox configuration; a plan without the `inbox_routing` feature sees it locked. Copy lives in `messages/<locale>/settings.json`
 * under `settings.tiles.auto-assignment`.
 *
 * Team performance (TW-TIB2-034): how fast the team replied, resolved and answered first, per agent. A tile under Data and security for
 * roles that hold `inbox.analytics.view`; a plan without Team performance sees it locked. Copy lives in `messages/<locale>/settings.json`
 * under `settings.tiles.team-performance`.
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
    id: 'contact-assignment',
    section: 'automation',
    href: '/contact-assignment',
    icon: 'transfer',
    order: 26,
    gates: { permission: 'crm.assignment.read', planFeature: 'inbox_routing' },
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
  settingsTile({
    id: 'team-performance',
    section: 'data',
    href: '/inbox/analytics/team',
    icon: 'sliders',
    order: 55,
    shortcutFrom: ['/inbox'],
    gates: { permission: 'inbox.analytics.view', planFeature: 'team_performance' },
  }),
];
