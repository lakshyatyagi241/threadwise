import {
  NOTIFICATION_CATEGORY_KEYS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_KEYS,
  type ChannelFlags,
  type NotificationChannel,
  type NotificationPrefsResponse,
  type SaveNotificationPrefsRequest,
} from '@crm/contracts';

export const SETTINGS_TABS = ['general', 'notifications', 'data'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** `?tab=` value to a tab; anything unknown reads as General (WaDesk). */
export const parseTab = (raw: string | null | undefined): SettingsTab =>
  (SETTINGS_TABS as readonly string[]).includes(raw ?? '') ? (raw as SettingsTab) : 'general';

/** Every IANA zone the browser knows, UTC first; a short fallback list on a runtime that cannot list them. */
export function timeZoneList(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf(
      'timeZone',
    );
  } catch {
    zones = ['Asia/Kolkata', 'Asia/Dubai', 'Europe/London', 'America/New_York'];
  }
  return [...new Set(['UTC', current, ...zones])];
}

export type Matrix = {
  events: Record<string, ChannelFlags>;
  categories: Record<string, ChannelFlags>;
};

export const toMatrix = (p: NotificationPrefsResponse): Matrix => ({
  events: Object.fromEntries(p.events.map((e) => [e.key, flagsOf(e)])),
  categories: Object.fromEntries(p.categories.map((c) => [c.key, flagsOf(c)])),
});

const flagsOf = (f: ChannelFlags): ChannelFlags => ({
  inapp: f.inapp,
  email: f.email,
  slack: f.slack,
});

export function toggleFlag(
  matrix: Matrix,
  zone: 'events' | 'categories',
  key: string,
  channel: NotificationChannel,
  on: boolean,
): Matrix {
  const row = matrix[zone][key];
  if (!row) return matrix;
  return { ...matrix, [zone]: { ...matrix[zone], [key]: { ...row, [channel]: on } } };
}

/** The whole matrix is posted every time, like WaDesk's form (every checkbox has a hidden 0). */
export function toRequest(matrix: Matrix, slackWebhook: string): SaveNotificationPrefsRequest {
  const pick = <K extends string>(keys: readonly K[], from: Record<string, ChannelFlags>) =>
    Object.fromEntries(
      keys.map((k) => [
        k,
        Object.fromEntries(NOTIFICATION_CHANNELS.map((c) => [c, from[k]?.[c] === true])),
      ]),
    ) as Record<K, ChannelFlags>;
  return {
    events: pick(NOTIFICATION_EVENT_KEYS, matrix.events),
    categories: pick(NOTIFICATION_CATEGORY_KEYS, matrix.categories),
    slackWebhook: slackWebhook.trim(),
  };
}

/** The delete button stays off until a name is typed and a password entered. The server decides whether they are right. */
export const canSubmitDelete = (name: string, password: string): boolean =>
  name.trim().length > 0 && password.length > 0;
