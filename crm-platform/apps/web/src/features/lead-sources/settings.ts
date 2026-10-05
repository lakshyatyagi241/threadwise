import { settingsTile } from '../_registry/settings-types';

/**
 * Social leads (spec 5.6): where ad and landing-page leads come in. A tile under Channels, offered as a gear shortcut on Contacts
 * and Deals for roles that may read lead sources. A plan without the `lead_sources` feature sees it locked. Copy lives in
 * `messages/<locale>/settings.json` under `settings.tiles.lead-sources`.
 */
export const settings = [
  settingsTile({
    id: 'lead-sources',
    section: 'channels',
    href: '/lead-sources',
    icon: 'segment',
    order: 55,
    shortcutFrom: ['/contacts', '/deals'],
    gates: { permission: 'leads.sources.read', planFeature: 'lead_sources' },
  }),
];
