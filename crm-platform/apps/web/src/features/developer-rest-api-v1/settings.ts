import { settingsTile } from '../_registry/settings-types';

/**
 * REST API keys (TW-API-010, 151): the Developers console, a tile under Integrations for roles that may read API keys. A plan
 * without the `public_api` feature sees it locked. Copy lives in `messages/<locale>/settings.json` under `settings.tiles.rest-api`.
 */
export const settings = [
  settingsTile({
    id: 'rest-api',
    section: 'integrations',
    href: '/developers',
    icon: 'code',
    order: 10,
    gates: { permission: 'api.keys.read', planFeature: 'public_api' },
  }),
];
