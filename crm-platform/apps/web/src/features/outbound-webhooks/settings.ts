import { settingsTile } from '../_registry/settings-types';

/**
 * A workspace's own webhooks (WD-API-140 to 148): endpoints that receive signed events. A tile under Integrations for roles that may
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
];
