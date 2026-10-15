import { settingsTile } from '../_registry/settings-types';

/**
 * Data requests (BL-143): the people who ask what you hold on them, and the exports, erasures and proofs that answer them. A tile under
 * Security for roles that may read requests. Copy lives in `messages/<locale>/settings.json` under `settings.tiles.privacy-requests`.
 */
export const settings = [
  settingsTile({
    id: 'privacy-requests',
    section: 'security',
    href: '/privacy-requests',
    icon: 'shield',
    order: 30,
    gates: { permission: 'privacy.requests.read' },
  }),
];
