import type { SettingsTile } from '../_registry/settings-types';

/**
 * The warmer has no Settings tile of its own: it is the "Warmer" tab of the Unofficial WhatsApp API area
 * (`features/whatsapp-devices-baileys/settings.ts`), so both appear and disappear together (see `nav.ts`).
 */
export const settings: SettingsTile[] = [];
