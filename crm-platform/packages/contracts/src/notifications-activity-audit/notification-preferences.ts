import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { NOTIFICATION_PREF_TYPES, type NotificationPrefType } from './inbox-notifications';

/**
 * Per-person notification preferences (BL-096 phase 2, docs/specs/realtime-notifications.md sections 5 and 6): for each notification type a
 * person can switch the bell row, the toast and the ping on or off for themselves.
 *
 * Resolution, highest first: the person's own setting for the type, then the workspace owner's toggle (Settings, Notifications; only for
 * the types a toggle governs, see `NOTIFICATION_TYPE_PREF_KEY`), then the catalogue default below. An unset channel inherits, so the
 * stored document is sparse and a later change of a default reaches everyone who never chose.
 *
 * Only `bell` decides whether a row exists at all; `toast` and `sound` travel on the `notification.created` event (`toast`, `sound`) so a
 * client shows the row and stays quiet. Desktop alerts are a per-browser choice (the browser's own permission), kept in local storage.
 *
 * `push` (Web Push, BL-097) is the fourth channel: an OS-level notification on the person's own devices, even with the CRM closed. It rides
 * on the bell row like the toast does (no row, no push), is on by default only for chat events, assignments and mentions, and needs the
 * person to have allowed browser notifications on a device (Account, Notifications).
 */

export const NOTIFICATION_GROUPS = [
  'conversations',
  'tasks',
  'leads',
  'documents',
  'wallet',
  'billing',
  'devices',
  'broadcasts',
  'team_chat',
  'whatsapp_groups',
] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

export interface NotificationCatalogEntry {
  group: NotificationGroup;
  /** A visible tab shows a toast for the row (unless the person turned it off). */
  toast: boolean;
  /** ...and plays the two-tone ping. */
  sound: boolean;
  /**
   * ...and a browser (Web Push) notification reaches the person's enabled devices. Default on only where a person is waiting on something:
   * chats, assignments, mentions, direct team chat messages. Everything else is a quiet default the person can turn on.
   */
  push: boolean;
}

/** The out-of-the-box behaviour of every type (the spec's catalogue columns Toast and Sound). Bell is on for all and not listed. */
export const NOTIFICATION_CATALOG: Record<NotificationPrefType, NotificationCatalogEntry> = {
  new_chat: { group: 'conversations', toast: true, sound: true, push: true },
  new_message: { group: 'conversations', toast: true, sound: true, push: true },
  conversation_assigned: { group: 'conversations', toast: true, sound: true, push: true },
  mention: { group: 'conversations', toast: true, sound: true, push: true },
  // BL-098: a calm follow-up, so no ping by default; the push stays on because the person may be away from the CRM (owner decision).
  chat_waiting: { group: 'conversations', toast: true, sound: false, push: true },
  task_assigned: { group: 'tasks', toast: true, sound: false, push: true },
  task_due: { group: 'tasks', toast: true, sound: false, push: false },
  task_completed: { group: 'tasks', toast: false, sound: false, push: false },
  new_lead: { group: 'leads', toast: true, sound: false, push: false },
  form_submission: { group: 'leads', toast: true, sound: false, push: false },
  form_needs_review: { group: 'leads', toast: true, sound: false, push: false },
  form_payment: { group: 'leads', toast: true, sound: false, push: false },
  form_payment_duplicate: { group: 'leads', toast: true, sound: false, push: false },
  sales_doc_decided: { group: 'documents', toast: true, sound: false, push: false },
  wallet_low_balance: { group: 'wallet', toast: true, sound: false, push: false },
  wallet_credited: { group: 'wallet', toast: true, sound: false, push: false },
  // A failed subscription payment is something a person must act on, so it also reaches their devices.
  billing_payment_failed: { group: 'billing', toast: true, sound: false, push: true },
  billing_subscription_canceled: { group: 'billing', toast: true, sound: false, push: false },
  device_connected: { group: 'devices', toast: true, sound: false, push: false },
  device_disconnected: { group: 'devices', toast: true, sound: false, push: false },
  device_logged_out: { group: 'devices', toast: true, sound: false, push: false },
  broadcast_completed: { group: 'broadcasts', toast: true, sound: false, push: false },
  broadcast_failed: { group: 'broadcasts', toast: true, sound: false, push: false },
  campaign_completed: { group: 'broadcasts', toast: true, sound: false, push: false },
  campaign_failed: { group: 'broadcasts', toast: true, sound: false, push: false },
  scheduled_completed: { group: 'broadcasts', toast: true, sound: false, push: false },
  scheduled_failed: { group: 'broadcasts', toast: true, sound: false, push: false },
  teamchat_mention: { group: 'team_chat', toast: true, sound: true, push: true },
  teamchat_message: { group: 'team_chat', toast: true, sound: true, push: true },
  // BL-099: quiet defaults, like the devices and the sends. Someone waiting to join is a task for the admins, not an emergency, and a
  // suspension is news to read; a person who wants the OS notification turns the push on.
  waba_group_join_request: { group: 'whatsapp_groups', toast: true, sound: false, push: false },
  waba_group_suspended: { group: 'whatsapp_groups', toast: true, sound: false, push: false },
  waba_group_suspension_cleared: {
    group: 'whatsapp_groups',
    toast: true,
    sound: false,
    push: false,
  },
};

export const notificationPrefTypeSchema = z.enum(NOTIFICATION_PREF_TYPES);

/** What a person stored for one type; null = inherit. */
export interface StoredUserPref {
  bell: boolean | null;
  toast: boolean | null;
  sound: boolean | null;
  push: boolean | null;
}

export interface NotificationChannelsEffective {
  bell: boolean;
  toast: boolean;
  sound: boolean;
  push: boolean;
}

/**
 * The one resolution rule, used by the producers (does a row exist, and what do its toast and ping say) and by the preferences screen
 * (what is in force). `workspaceInapp` is the owner's in-app toggle for the type (true when no toggle governs it).
 */
export function resolveNotificationChannels(
  type: NotificationPrefType,
  stored: StoredUserPref | null | undefined,
  workspaceInapp = true,
): NotificationChannelsEffective {
  const base = NOTIFICATION_CATALOG[type];
  return {
    bell: stored?.bell ?? workspaceInapp,
    toast: stored?.toast ?? base.toast,
    sound: stored?.sound ?? base.sound,
    push: stored?.push ?? base.push,
  };
}

const effectiveSchema = z.object({
  bell: z.boolean(),
  toast: z.boolean(),
  sound: z.boolean(),
  push: z.boolean(),
});

export const notificationPreferenceItemSchema = z.object({
  type: notificationPrefTypeSchema,
  group: z.enum(NOTIFICATION_GROUPS),
  /** In force right now: your setting, else the owner's toggle, else the default. */
  bell: z.boolean(),
  toast: z.boolean(),
  sound: z.boolean(),
  /** A browser (Web Push) notification on your enabled devices. Needs the bell row, like the pop-up. */
  push: z.boolean(),
  /** The catalogue default of the toast and ping, and of the bell when no owner toggle governs the type. */
  defaults: effectiveSchema,
  /** What you chose yourself; null = you never did (inherit). */
  overrides: z.object({
    bell: z.boolean().nullable(),
    toast: z.boolean().nullable(),
    sound: z.boolean().nullable(),
    push: z.boolean().nullable(),
  }),
  /** The workspace owner's in-app toggle for this type (true when none governs it): the bell value you inherit. */
  workspaceInapp: z.boolean(),
});
export type NotificationPreferenceItem = z.infer<typeof notificationPreferenceItemSchema>;

/** `GET /v2/notifications/preferences`: every type, in catalogue order, with the effective values. */
export const notificationPreferencesResponseSchema = z.object({
  items: z.array(notificationPreferenceItemSchema),
});
export type NotificationPreferencesResponse = z.infer<typeof notificationPreferencesResponseSchema>;

const channelChoice = z.boolean().nullable().optional();

/**
 * `PUT /v2/notifications/preferences`: a partial update. Each item names a type and any of `bell`, `toast`, `sound`, `push`: a boolean sets it,
 * `null` goes back to inheriting, a missing key stays as it is. Sending the same body twice changes nothing. Returns the full list.
 */
export const updateNotificationPreferencesRequestSchema = z.object({
  items: z
    .array(
      z.object({
        type: notificationPrefTypeSchema,
        bell: channelChoice,
        toast: channelChoice,
        sound: channelChoice,
        push: channelChoice,
      }),
    )
    .min(1)
    .max(60)
    .refine((items) => new Set(items.map((i) => i.type)).size === items.length, {
      message: 'Each type may appear once',
    }),
});
export type UpdateNotificationPreferencesRequest = z.infer<
  typeof updateNotificationPreferencesRequestSchema
>;

// --- `data` of the phase 2 types ---------------------------------------------------------------------------------------------------

/** `device_connected`, `device_disconnected`, `device_logged_out`. Never a QR, a pairing code or a full number. */
export const deviceNotificationDataSchema = z.object({
  deviceId: uuidSchema,
  deviceName: z.string().nullable().optional(),
  /** `…1234`: the last four digits only. */
  maskedNumber: z.string().nullable().optional(),
  state: z.string().optional(),
  reason: z.string().nullable().optional(),
});
export type DeviceNotificationData = z.infer<typeof deviceNotificationDataSchema>;

/** `broadcast_*`, `campaign_*`, `scheduled_*`. */
export const sendOutcomeNotificationDataSchema = z.object({
  kind: z.enum(['broadcast', 'campaign', 'scheduled_message']),
  id: uuidSchema,
  name: z.string().nullable().optional(),
  status: z.string(),
  total: z.number().int().nonnegative().optional(),
  sent: z.number().int().nonnegative().optional(),
  failed: z.number().int().nonnegative().optional(),
  /** The failure reason, cut to 200 characters; text, never HTML. */
  reason: z.string().max(200).nullable().optional(),
});
export type SendOutcomeNotificationData = z.infer<typeof sendOutcomeNotificationDataSchema>;

/** `teamchat_mention`, `teamchat_message`. */
export const teamChatNotificationDataSchema = z.object({
  channelId: uuidSchema,
  channelName: z.string().nullable().optional(),
  messageId: uuidSchema.optional(),
  authorName: z.string().nullable().optional(),
  preview: z.string().max(80).nullable().optional(),
  count: z.number().int().min(1).optional(),
  direct: z.boolean().optional(),
});
export type TeamChatNotificationData = z.infer<typeof teamChatNotificationDataSchema>;

/**
 * `waba_group_join_request`, `waba_group_suspended`, `waba_group_suspension_cleared`. Never a member's number, never the invite link:
 * a join request is a count, a group is named by its subject.
 */
export const wabaGroupNotificationDataSchema = z.object({
  groupId: uuidSchema,
  /** The connected number the group belongs to (the Groups screen's `?account=`). */
  connectionId: uuidSchema.optional(),
  groupName: z.string().nullable().optional(),
  /** Join requests only: how many people the row stands for. */
  count: z.number().int().min(1).optional(),
});
export type WabaGroupNotificationData = z.infer<typeof wabaGroupNotificationDataSchema>;
