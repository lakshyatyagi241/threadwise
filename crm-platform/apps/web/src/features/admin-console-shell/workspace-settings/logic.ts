import {
  NOTIFICATION_CATEGORY_KEYS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_KEYS,
  type ChannelFlags,
  type NotificationChannel,
  type NotificationPrefsResponse,
  type SaveNotificationPrefsRequest,
} from '@crm/contracts';

export const SETTINGS_TABS = [
  'general',
  'branding',
  'team',
  'notifications',
  'aikeys',
  'security',
  'api',
  'data',
  'appearance',
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** The rail's two groups, in Reference's order (TW-ASHELL-032). */
export const TAB_GROUPS: ReadonlyArray<{
  id: 'workspace' | 'system';
  tabs: readonly SettingsTab[];
}> = [
  { id: 'workspace', tabs: ['general', 'branding', 'team', 'notifications', 'aikeys'] },
  { id: 'system', tabs: ['security', 'api', 'data', 'appearance'] },
];

/**
 * Tabs whose screen lives in another domain's page: the rail links straight to it and a ?tab= deep link is redirected there
 * (Reference swapped panes client-side; each of these now has its own route, as the inventory's port notes ask).
 */
export const TAB_LINKS: Partial<Record<SettingsTab, string>> = {
  team: '/settings/team',
  aikeys: '/ai-keys',
  security: '/account/security',
};

/** ?tab= value to a tab; anything unknown reads as General (Reference). */
export const parseTab = (raw: string | null | undefined): SettingsTab =>
  (SETTINGS_TABS as readonly string[]).includes(raw ?? '') ? (raw as SettingsTab) : 'general';

/** ICU lists a few zones under their old name (Asia/Calcutta), so the modern id has to be added by hand. */
const MODERN_ZONE: Readonly<Record<string, string>> = { 'Asia/Calcutta': 'Asia/Kolkata' };

/** Zones the browser may leave out of its list; always offered, so a workspace can be set back to them. */
const ALWAYS_OFFERED = ['Asia/Kolkata'];

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
  const rest = [...new Set([...zones.map((z) => MODERN_ZONE[z] ?? z), ...ALWAYS_OFFERED])].sort();
  return [...new Set(['UTC', current, ...rest])];
}

/** The zones whose name contains what was typed: case and `_` ignored, so "new york" finds America/New_York. Empty search keeps all. */
export function filterTimeZones(zones: readonly string[], search: string): string[] {
  const needle = search.trim().toLowerCase().replace(/_/g, ' ');
  if (!needle) return [...zones];
  return zones.filter((z) => z.toLowerCase().replace(/_/g, ' ').includes(needle));
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

/** The whole matrix is posted every time, like Reference's form (every checkbox has a hidden 0). */
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

/** The Branding form's starting colours when the owner set none (Reference's own defaults). */
export const DEFAULT_BRAND = {
  primary: '#075E54',
  accent: '#25D366',
  background: '#FBFAF6',
} as const;

/** A well-formed `#RRGGBB` in lower case, or null. */
export function normaliseColour(raw: string): string | null {
  const v = raw.trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null;
}

/** Only a colour the owner actually edited is sent, so saving a logo alone never repaints the app with the defaults. */
export const colourChanged = (now: string, was: string): boolean =>
  now.trim().toLowerCase() !== was.trim().toLowerCase();
