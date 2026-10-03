import { z } from 'zod';

/**
 * The customer Settings page (WD-ASHELL-032..044): workspace profile, the notification matrix, data export and
 * delete workspace. Every write is the workspace owner's; any member reads.
 */

// --- General (WD-ASHELL-033) -----------------------------------------------------------------------------------------

export const currencyOptionSchema = z.object({
  code: z.string(),
  name: z.string(),
  symbol: z.string().nullable(),
});
export type CurrencyOption = z.infer<typeof currencyOptionSchema>;

export const workspaceSettingsResponseSchema = z.object({
  name: z.string(),
  /** The workspace URL slug: shown, never editable here. */
  slug: z.string(),
  /** IANA name; UTC when the workspace never chose one. */
  timezone: z.string(),
  /** Upper-case code; the platform default when the workspace never chose one. */
  currency: z.string(),
  isOwner: z.boolean(),
  currencies: z.array(currencyOptionSchema),
});
export type WorkspaceSettingsResponse = z.infer<typeof workspaceSettingsResponseSchema>;

/** A blank field is ignored, never cleared (WaDesk): the service drops empty strings before it writes. */
export const updateWorkspaceSettingsRequestSchema = z.object({
  name: z.string().trim().max(191).optional(),
  timezone: z.string().trim().max(64).optional(),
  currency: z.string().trim().max(10).optional(),
});
export type UpdateWorkspaceSettingsRequest = z.infer<typeof updateWorkspaceSettingsRequestSchema>;

// --- Notifications (WD-ASHELL-038) -----------------------------------------------------------------------------------

/** The 18 named events, in WaDesk's order. */
export const NOTIFICATION_EVENT_KEYS = [
  'device_connected',
  'device_disconnected',
  'campaign_completed',
  'campaign_failed',
  'broadcast_completed',
  'new_customer_reply',
  'mention_in_inbox',
  'conversation_assigned',
  'sla_breached',
  'wallet_low_balance',
  'plan_changed',
  'payment_failed',
  'webhook_delivery_failed',
  'flow_started',
  'flow_failed',
  'integration_disconnected',
  'appointment_booked',
  'weekly_summary',
] as const;
export type NotificationEventKey = (typeof NOTIFICATION_EVENT_KEYS)[number];

/** The record categories the auto-recorded create/update/delete events fall under. */
export const NOTIFICATION_CATEGORY_KEYS = [
  'device',
  'contact',
  'campaign',
  'broadcast',
  'template',
  'chat',
  'webhook',
  'billing',
  'system',
] as const;
export type NotificationCategoryKey = (typeof NOTIFICATION_CATEGORY_KEYS)[number];

export const NOTIFICATION_CHANNELS = ['inapp', 'email', 'slack'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type ChannelFlags = Record<NotificationChannel, boolean>;

const ALL_OFF: ChannelFlags = { inapp: false, email: false, slack: false };

/** Out of the box: quiet email, every critical event lights the bell (Workspace::DEFAULT_NOTIFICATION_CHANNELS). */
const EVENT_DEFAULTS: Partial<Record<NotificationEventKey, ChannelFlags>> = {
  device_disconnected: { inapp: true, email: true, slack: false },
  wallet_low_balance: { inapp: true, email: true, slack: true },
  payment_failed: { inapp: true, email: true, slack: false },
  sla_breached: { inapp: true, email: true, slack: true },
  campaign_failed: { inapp: true, email: true, slack: false },
  webhook_delivery_failed: { inapp: true, email: true, slack: false },
  integration_disconnected: { inapp: true, email: true, slack: false },
  weekly_summary: { inapp: false, email: true, slack: false },
};
const EVENT_FALLBACK: ChannelFlags = { inapp: true, email: false, slack: false };
/** Categories default to the in-app bell only. */
const CATEGORY_DEFAULT: ChannelFlags = { inapp: true, email: false, slack: false };

export const defaultEventFlags = (key: NotificationEventKey): ChannelFlags => ({
  ...(EVENT_DEFAULTS[key] ?? EVENT_FALLBACK),
});
export const defaultCategoryFlags = (): ChannelFlags => ({ ...CATEGORY_DEFAULT });

const flagsSchema = z.object({ inapp: z.boolean(), email: z.boolean(), slack: z.boolean() });

export const notificationPrefsResponseSchema = z.object({
  events: z.array(z.object({ key: z.enum(NOTIFICATION_EVENT_KEYS) }).merge(flagsSchema)),
  categories: z.array(z.object({ key: z.enum(NOTIFICATION_CATEGORY_KEYS) }).merge(flagsSchema)),
  /** The owner's own URL back to them; members get null (they only see whether it is set). */
  slackWebhook: z.string().nullable(),
  slackWebhookSet: z.boolean(),
  isOwner: z.boolean(),
  /** Whether the platform can send email at all (SMTP configured); WaDesk's "Channel status" note. */
  emailLive: z.boolean(),
});
export type NotificationPrefsResponse = z.infer<typeof notificationPrefsResponseSchema>;

const flagMapSchema = <K extends string>(keys: readonly [K, ...K[]]) =>
  z.record(z.enum(keys), flagsSchema.partial());

/** Whatever the form posts: a missing channel counts as off, like WaDesk's hidden `0` inputs. */
export const saveNotificationPrefsRequestSchema = z.object({
  events: flagMapSchema(NOTIFICATION_EVENT_KEYS).optional(),
  categories: flagMapSchema(NOTIFICATION_CATEGORY_KEYS).optional(),
  /** Blank clears it. */
  slackWebhook: z.union([z.literal(''), z.string().url().max(255)]).optional(),
});
export type SaveNotificationPrefsRequest = z.infer<typeof saveNotificationPrefsRequestSchema>;

/** The stored document, shared with the dispatcher that reads it (NOTIF). */
export interface StoredNotificationPrefs {
  events: Partial<Record<NotificationEventKey, ChannelFlags>>;
  categories: Partial<Record<NotificationCategoryKey, ChannelFlags>>;
}

/** The flags in force for one event: the owner's choice, else the default. A specific event always beats its category. */
export function effectiveEventFlags(
  stored: StoredNotificationPrefs | undefined,
  key: NotificationEventKey,
): ChannelFlags {
  return stored?.events?.[key] ?? defaultEventFlags(key);
}

export const normalizeFlags = (input: Partial<ChannelFlags> | undefined): ChannelFlags => ({
  ...ALL_OFF,
  ...Object.fromEntries(NOTIFICATION_CHANNELS.map((c) => [c, input?.[c] === true] as const)),
});

// --- Data export (WD-ASHELL-043) -------------------------------------------------------------------------------------

export const EXPORT_TYPES = ['contacts', 'conversations', 'messages'] as const;
export const exportTypeSchema = z.enum(EXPORT_TYPES);
export type ExportType = z.infer<typeof exportTypeSchema>;

export const exportCountsResponseSchema = z.object({
  contacts: z.number().int().nonnegative(),
  conversations: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
  isOwner: z.boolean(),
});
export type ExportCountsResponse = z.infer<typeof exportCountsResponseSchema>;

/** CSV header of each export, in WaDesk's column order. */
export const EXPORT_COLUMNS: Record<ExportType, readonly string[]> = {
  contacts: ['id', 'name', 'mobile', 'email', 'status', 'created_at'],
  conversations: ['id', 'channel', 'status', 'last_message_at', 'created_at'],
  messages: ['id', 'conversation_id', 'direction', 'body', 'created_at'],
};

/**
 * One CSV cell. Quoted when it holds a comma, quote or line break; a cell that starts with `=`, `+`, `-` or `@` (or a tab or
 * carriage return) is prefixed with an apostrophe so a spreadsheet cannot run it as a formula (WaDesk did not guard this).
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvRow = (cells: ReadonlyArray<string | number | null | undefined>): string =>
  cells.map(csvCell).join(',') + '\n';

// --- Delete workspace (WD-ASHELL-044) --------------------------------------------------------------------------------

export const deleteWorkspaceRequestSchema = z.object({
  confirmName: z.string().min(1).max(191),
  password: z.string().min(1).max(256),
});
export type DeleteWorkspaceRequest = z.infer<typeof deleteWorkspaceRequestSchema>;

// --- Personal preference (WD-ASHELL-035) -----------------------------------------------------------------------------

export const preferencesResponseSchema = z.object({ autoAiSummarize: z.boolean() });
export type PreferencesResponse = z.infer<typeof preferencesResponseSchema>;
export const savePreferencesRequestSchema = z.object({ autoAiSummarize: z.boolean() });
export type SavePreferencesRequest = z.infer<typeof savePreferencesRequestSchema>;
