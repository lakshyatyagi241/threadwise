/** "Oct 7, 2026, 10:15 AM" in the UI language, or null when there is no time (the screen then says "Never"). */
export function formatWhen(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(at);
  } catch {
    return at.toISOString();
  }
}

/** The permissions the screens ask of the session (spec 10.1). Read is the menu's key; every action has its own. */
export const PERMISSIONS = {
  read: 'wa.devices.read',
  create: 'wa.devices.create',
  pair: 'wa.devices.pair',
  disconnect: 'wa.devices.disconnect',
  delete: 'wa.devices.delete',
} as const;

export interface DevicePerms {
  create: boolean;
  pair: boolean;
  disconnect: boolean;
  delete: boolean;
}
