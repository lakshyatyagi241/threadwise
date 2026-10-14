import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Every message the server pushes is one envelope; the socket.io event name is `type`.
 *
 * `seq` counts the events of ONE room (`room`), by one, from the room's first event. A client that sees a number that is not
 * the previous one plus one has missed something (a reconnect, a dropped packet, a Redis restart that reset the counter), and
 * fetches the room's state again over REST instead of guessing. `id` is the event's own uuid: handlers that cannot be
 * idempotent by record can drop repeats with it.
 */
export const realtimeEnvelopeSchema = z.object({
  v: z.literal(1),
  id: uuidSchema,
  type: z.string().min(1),
  /** The room's client name (`user`, `conv:<uuid>`, ...). */
  room: z.string().min(1),
  seq: z.number().int().nonnegative(),
  at: z.string().datetime(),
  payload: z.unknown(),
});
export type RealtimeEnvelope<P = unknown> = Omit<
  z.infer<typeof realtimeEnvelopeSchema>,
  'payload'
> & { payload: P };

/** Sent once after the handshake is accepted: where each room the server put the socket in stands. */
export const realtimeReadySchema = z.object({
  v: z.literal(1),
  rooms: z.array(z.object({ room: z.string(), seq: z.number().int().nonnegative() })),
  serverTime: z.string().datetime(),
});
export type RealtimeReady = z.infer<typeof realtimeReadySchema>;

/** Socket event names that are not part of a room's stream. */
export const REALTIME_SYSTEM_EVENTS = {
  ready: 'rt.ready',
  /** The server asks the client to fetch a room again (permissions changed, a gap it cannot describe). */
  resync: 'rt.resync',
} as const;

/** The client's requests (socket.io events it emits, each with an acknowledgement). */
export const REALTIME_CLIENT_EVENTS = {
  join: 'room:join',
  leave: 'room:leave',
  /**
   * "Is this tab in front?" (`{ visible: boolean }`), sent on every change and about every 15 s while visible. The server remembers it for
   * 35 s and skips the closed-tab browser push for a person who has a visible tab (the bell and toast cover them). No acknowledgement.
   */
  visibility: 'presence:visible',
} as const;

export const realtimeVisibilitySchema = z.object({ visible: z.boolean() });
export type RealtimeVisibility = z.infer<typeof realtimeVisibilitySchema>;

/** How often a visible tab repeats its report, and how long the server believes the last one. */
export const REALTIME_VISIBILITY_REPORT_MS = 15_000;
export const REALTIME_VISIBILITY_TTL_MS = 35_000;

export const REALTIME_EVENT = {
  conversationUpsert: 'inbox.conversation.upsert',
  messageNew: 'inbox.message.new',
  messageStatus: 'inbox.message.status',
  unread: 'inbox.unread',
  assignment: 'inbox.assignment',
  typing: 'inbox.typing',
  presence: 'inbox.presence',
  /** A channel's status moved without a person asking (the provider stopped accepting its credentials): the UI warns. */
  channelStatus: 'inbox.channel.status',
  /** The workspace wallet's balance moved (a message charge, a refund, a top-up, an adjustment). */
  walletUpdated: 'wallet.updated',
  /**
   * A bell row was written for this person (any type: a message, an assignment, a mention, a task, a lead, a form, the wallet).
   * Room `user`. The event is a hint: it carries the new unread total and ids, never text; the client refetches the feed.
   */
  notificationCreated: 'notification.created',
  /** The person's unread rows were marked read (here or on another tab or device): every open tab converges. Room `user`. */
  notificationRead: 'notification.read',
  /**
   * A WhatsApp group of the business number changed (BL-099): created, edited, deleted, a join request arrived or left, suspended or
   * restored. Room `user`, to the people who may open the Groups screen. A hint: ids and the kind of change, never a member's number,
   * the invite link or the subject; the screen refetches over REST.
   */
  wabaGroupChanged: 'whatsapp.group.changed',
  /**
   * A group of a PERSONAL WhatsApp number changed (created or joined, edited, the number left or was removed, a join request, members
   * changed). Room `user`, to the people who hold `wa.groups.read`. A hint: ids and the kind of change, never a member's number, the
   * invite code or the subject; the screen refetches over REST.
   */
  deviceGroupChanged: 'whatsapp.device_group.changed',
  /**
   * An import of a personal number's existing chats ended (finished, cancelled after storing something, or stopped on a limit): ONE hint per
   * run, never one per message. Room `user`, to the people who can read the inbox or the numbers. The inbox list and the number's
   * "Imported chats" card refetch over REST; the hint carries the number's uuid and the final state, nothing else.
   */
  historyImported: 'inbox.history.imported',
  /** A WhatsApp call rang, was answered, declined or ended: the incoming-call toast refetches (a signal, never the caller's details). */
  callChanged: 'call.changed',
} as const;

const messageStatusSchema = z.enum(['queued', 'sent', 'delivered', 'read', 'failed']);

/**
 * The payload of every event the platform pushes. List-level events are signals (an id, a version, what changed): the client
 * fetches the row over REST, where scope and row-level security apply. Chat Phase 1 tightens `message` to its message shape.
 */
export const realtimeEventSchemas = {
  [REALTIME_EVENT.conversationUpsert]: z.object({
    conversationId: uuidSchema,
    rowVersion: z.number().int(),
    changed: z.array(z.string()),
  }),
  [REALTIME_EVENT.messageNew]: z.object({
    conversationId: uuidSchema,
    message: z.object({ id: uuidSchema, seq: z.number().int() }).passthrough(),
  }),
  [REALTIME_EVENT.messageStatus]: z.object({
    conversationId: uuidSchema,
    messageId: uuidSchema,
    clientMessageId: uuidSchema.nullable(),
    status: messageStatusSchema,
    at: z.string().datetime(),
  }),
  [REALTIME_EVENT.unread]: z.object({
    conversationId: uuidSchema,
    unread: z.number().int().nonnegative(),
  }),
  [REALTIME_EVENT.assignment]: z.object({
    conversationId: uuidSchema,
    assigneeUserId: uuidSchema.nullable(),
    assigneeTeamId: uuidSchema.nullable(),
  }),
  [REALTIME_EVENT.typing]: z.object({
    conversationId: uuidSchema,
    userId: uuidSchema,
    typing: z.boolean(),
  }),
  [REALTIME_EVENT.presence]: z.object({
    userId: uuidSchema,
    state: z.enum(['online', 'away', 'busy', 'offline']),
  }),
  [REALTIME_EVENT.channelStatus]: z.object({
    channelId: uuidSchema,
    status: z.enum(['connected', 'disconnected', 'error', 'needs_reauth']),
    code: z.string().nullable(),
    message: z.string().nullable(),
  }),
  /** A signal with the new figure; the client may also refetch `/wallet/summary` for the rest. Hundredths of the wallet currency. */
  [REALTIME_EVENT.walletUpdated]: z.object({
    balanceMinor: z.number().int(),
    reason: z.enum(['charge', 'refund', 'topup', 'adjustment']),
  }),
  [REALTIME_EVENT.notificationCreated]: z.object({
    notificationId: uuidSchema,
    /** A NotificationType today; a plain string so a newer server's type does not break an older client. */
    type: z.string().min(1),
    /** The person's true unread total after this row: the badge shows it as is. */
    unread: z.number().int().nonnegative(),
    subjectKind: z.string().nullable(),
    subjectId: uuidSchema.nullable(),
    /** The row replaced an earlier unread row of the same chat (its count went up). */
    collapsed: z.boolean(),
    /** Update the bell but do not toast or ping: a burst inside the throttle window, a team-wide assignment. */
    silent: z.boolean(),
    /**
     * The person's own preference (phase 2): show a toast for this row. Absent from an older server, which means "as before"
     * (decide by type). `silent` still wins: a silent event never toasts or pings.
     */
    toast: z.boolean().optional(),
    /** Likewise for the two-tone ping. */
    sound: z.boolean().optional(),
  }),
  [REALTIME_EVENT.notificationRead]: z.object({
    unread: z.number().int().nonnegative(),
    /** The rows that were marked read, or `all`. */
    notificationIds: z.union([z.array(uuidSchema), z.literal('all')]),
  }),
  [REALTIME_EVENT.wabaGroupChanged]: z.object({
    groupId: uuidSchema,
    connectionId: uuidSchema,
    /** The outbox event it stands for, without the `whatsapp.group.` prefix. */
    kind: z.enum(['created', 'updated', 'deleted', 'join_request', 'suspended']),
  }),
  [REALTIME_EVENT.deviceGroupChanged]: z.object({
    /** `wa_device_groups.uuid`. */
    groupId: uuidSchema,
    /** `devices.uuid`. */
    deviceId: uuidSchema,
    /** The outbox event it stands for, without the `whatsapp.device_group.` prefix. */
    kind: z.enum(['created', 'updated', 'left', 'join_request', 'participants_changed']),
  }),
  [REALTIME_EVENT.historyImported]: z.object({
    /** `devices.uuid`. */
    deviceId: uuidSchema,
    state: z.enum(['done', 'failed', 'cancelled', 'limit_reached']),
  }),
  [REALTIME_EVENT.callChanged]: z.object({ callId: uuidSchema }),
} as const;

export type RealtimeEventType = keyof typeof realtimeEventSchemas;
export type RealtimeEventPayload<T extends RealtimeEventType> = z.infer<
  (typeof realtimeEventSchemas)[T]
>;

export const realtimeResyncPayloadSchema = z.object({ reason: z.string().max(64) });
