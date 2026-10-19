import { settingsTile } from '../_registry/settings-types';

/**
 * A workspace's own webhooks (TW-API-140 to 148): endpoints that receive signed events. A tile under Integrations for roles that may
 * read webhooks; a plan without the `outbound_webhooks` feature sees it locked. Copy lives in `messages/<locale>/settings.json`
 * under `settings.tiles.webhooks`.
 */
export const settings = [
  settingsTile({
    id: 'webhooks',
    section: 'integrations',
    href: '/webhooks',
    icon: 'webhook',
    order: 20,
    gates: { permission: 'webhooks.read', planFeature: 'outbound_webhooks' },
  }),
  // The old product kept Webhooks under Settings. The same screen is also a Marketplace add-on card (the tile above); this one puts it where
  // people look for it. It shares the add-on tile's copy (`settings.tiles.webhooks`) and gates.
  settingsTile({
    id: 'webhooks-endpoints',
    labelKey: 'settings.tiles.webhooks.label',
    descriptionKey: 'settings.tiles.webhooks.description',
    keywordsKey: 'settings.tiles.webhooks.keywords',
    section: 'security',
    href: '/webhooks',
    icon: 'webhook',
    order: 61,
    gates: { permission: 'webhooks.read', planFeature: 'outbound_webhooks' },
  }),
];
