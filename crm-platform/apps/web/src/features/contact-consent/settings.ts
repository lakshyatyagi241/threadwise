import { settingsTile } from '../_registry/settings-types';

/**
 * Contact consent (a product extension, no Reference screen): the STOP / START keywords, the confirmation replies, the opt-out line
 * and the "require recorded consent" switch. A tile under Security for roles that may manage it. Copy lives in
 * `messages/<locale>/settings.json` under `settings.tiles.consent`.
 */
export const settings = [
  settingsTile({
    id: 'consent',
    section: 'security',
    href: '/contact-consent',
    icon: 'shield',
    order: 20,
    gates: { permission: 'settings.consent.manage' },
  }),
];
