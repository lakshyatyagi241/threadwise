import type { NavItem } from '../_registry/types';

/**
 * "Personal WhatsApp": link a personal or business-app number by QR code or pairing code (the unofficial engine, channel kind
 * `whatsapp_qr`). It lives in Settings > Channels as "Unofficial WhatsApp API" (see `settings.ts`), not in the sidebar (`inMenu: false`). It exists only while the platform has the engine on
 * AND the operator has allowed this workspace (`gates.app: 'unofficial_whatsapp'`, the same synthetic entitlement the Warmer uses):
 * without it the entry is removed and `/devices` shows the "isn't available" page. The permission is read-only; every action is
 * checked again by the API. There is no Settings tile (the registry forbids a screen being both).
 * Spec: docs/specs/personal-whatsapp-connect.md section 13.1.
 */
export const nav: NavItem[] = [
  {
    id: 'devices',
    group: 'inbox',
    labelKey: 'whatsapp-devices-baileys.nav.devices',
    href: '/devices',
    order: 40,
    icon: 'phone',
    inMenu: false,
    gates: { permission: 'wa.devices.read', app: 'unofficial_whatsapp' },
  },
  // The Groups tab next to Numbers and Warmer: the groups of a personal number (docs/threadwise-port/plan/whatsapp-personal-groups-build.md).
  // Same engine gate as the numbers, and its own read key (`wa.groups.read`, no plan feature). It is a tab, not a menu entry or a tile.
  {
    id: 'devices-groups',
    group: 'inbox',
    labelKey: 'whatsapp-devices-baileys.nav.groups',
    href: '/devices/groups',
    order: 41,
    icon: 'groups',
    inMenu: false,
    gates: { permission: 'wa.groups.read', app: 'unofficial_whatsapp' },
  },
];
