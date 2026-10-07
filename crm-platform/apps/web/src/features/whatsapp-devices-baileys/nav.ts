import type { NavItem } from '../_registry/types';

/**
 * "Personal WhatsApp": link a personal or business-app number by QR code or pairing code (the unofficial engine, channel kind
 * `whatsapp_qr`). A real sidebar entry in Inbox & Chat so pilot users find it. It exists only while the platform has the engine on
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
    gates: { permission: 'wa.devices.read', app: 'unofficial_whatsapp' },
  },
];
