import { settingsTile } from '../_registry/settings-types';

/**
 * Settings > Channels > "Unofficial WhatsApp API": the personal numbers (QR or pairing code) and, as a second tab, the warmer.
 * Same gates as the screens: the platform engine is on AND the operator allowed this workspace (`app: 'unofficial_whatsapp'`),
 * so a workspace that was not approved never sees the tile, the numbers or the warmer.
 */
export const settings = [
  settingsTile({
    id: 'unofficial-whatsapp',
    section: 'channels',
    href: '/devices',
    icon: 'whatsapp',
    order: 12,
    gates: { permission: 'wa.devices.read', app: 'unofficial_whatsapp' },
  }),
];
