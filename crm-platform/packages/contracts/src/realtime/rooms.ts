import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/** The socket.io namespace the browser connects to. */
export const REALTIME_NAMESPACE = '/realtime';

/** How long a ticket is valid after it is minted. It is single use as well. */
export const REALTIME_TICKET_TTL_SECONDS = 60;

/** A socket may hold this many explicit rooms at once (conversation and inbox rooms together). */
export const REALTIME_MAX_JOINED_ROOMS = 25;

/**
 * What an inbox room carries: `all` is every conversation the workspace has (only for a caller whose read scope is `all`),
 * `team:<team uuid>` is the conversations of one team (a team member, or a caller whose scope is `all`).
 */
export const realtimeInboxScopeSchema = z.union([
  z.literal('all'),
  z.string().regex(/^team:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
]);
export type RealtimeInboxScope = z.infer<typeof realtimeInboxScopeSchema>;

/**
 * The rooms a client may ask to join (`room:join`). `org` and `user` are not on this list: the server puts every socket in
 * them on connect, and nobody can ask for another person's.
 */
export const realtimeRoomSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('conv'), id: uuidSchema }),
  z.object({ kind: z.literal('inbox'), scope: realtimeInboxScopeSchema }),
]);
export type RealtimeRoomSpec = z.infer<typeof realtimeRoomSpecSchema>;

/**
 * A room as the client names it, on the wire and in events: `org`, `user` (always the caller's own), `conv:<uuid>`,
 * `inbox:<scope>`. The server's own room names carry internal ids and never leave it.
 */
export type RealtimeRoomKey = 'org' | 'user' | `conv:${string}` | `inbox:${string}`;

export function realtimeRoomKey(spec: RealtimeRoomSpec): RealtimeRoomKey {
  return spec.kind === 'conv'
    ? `conv:${spec.id.toLowerCase()}`
    : `inbox:${spec.scope.toLowerCase()}`;
}

export const REALTIME_JOIN_REFUSALS = ['FORBIDDEN', 'INVALID', 'LIMIT', 'UNAVAILABLE'] as const;
export type RealtimeJoinRefusal = (typeof REALTIME_JOIN_REFUSALS)[number];

/**
 * The answer to `room:join` and `room:leave`. A room that does not exist and one the caller may not open are both
 * `FORBIDDEN`, so the answer never says whether a conversation is there.
 */
export const realtimeRoomAckSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    room: z.string(),
    /** The room's sequence number now: events after this one carry `seq + 1`, `seq + 2`, ... */
    seq: z.number().int().nonnegative(),
  }),
  z.object({ ok: z.literal(false), code: z.enum(REALTIME_JOIN_REFUSALS) }),
]);
export type RealtimeRoomAck = z.infer<typeof realtimeRoomAckSchema>;
