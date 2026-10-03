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
export const REALTIME_CLIENT_EVENTS = { join: 'room:join', leave: 'room:leave' } as const;

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
} as const;

export type RealtimeEventType = keyof typeof realtimeEventSchemas;
export type RealtimeEventPayload<T extends RealtimeEventType> = z.infer<
  (typeof realtimeEventSchemas)[T]
>;

export const realtimeResyncPayloadSchema = z.object({ reason: z.string().max(64) });
