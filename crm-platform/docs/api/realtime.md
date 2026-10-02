# API: realtime (sockets)

Socket.IO on the namespace `/realtime`, shared by every domain that pushes to a screen. Built for the Team Inbox and Chat plan
(`docs/wadesk-port/plan-inbox-chat.md` section 3.6, Phase 0 stream A2). Shapes live in `packages/contracts/src/realtime/`; the server in
`apps/api/src/realtime/`; the browser side in `apps/web/src/lib/realtime/`.

The rule that shapes everything: **an event is a hint, the database is the truth.** Events are published after the transaction commits,
best effort, and carry a per-room sequence number. A client that cannot be sure it saw everything fetches over REST, where scope and
row-level security apply. Nothing is lost by a dropped packet, a restart or a Redis flush; the screen just refetches.

## The connection, step by step

```
browser (httpOnly cookie)         web app (Next, same origin)             API                        Redis
        |                                  |                               |                           |
        |-- POST /api/v2/realtime/ticket ->|                               |                           |
        |                                  |-- POST /v2/realtime/ticket -->|  (Bearer = cookie token)  |
        |                                  |                               |-- SET rt:ticket:<sha256> -->  EX 60
        |<--------- { ticket, expiresIn } -|<------ { ticket, expiresIn } -|                           |
        |                                                                                              |
        |== io(url, { auth: { ticket } }) ======== websocket handshake ===>|                           |
        |                                                                  |-- GETDEL rt:ticket:... -->|   (one use)
        |<============ connect, then `rt.ready` { rooms: [{org,seq},{user,seq}] } ====================|
        |-- room:join { kind:'conv', id } ->|  (ack: { ok, room, seq } or { ok:false, code })
        |<== inbox.message.new { v, id, type, room, seq, at, payload } ===                            |
```

- **Why a ticket.** The session lives in httpOnly cookies, so page JavaScript cannot read a token, and a socket connects straight to the
  API (a Next route handler cannot proxy a WebSocket). The same-origin proxy can read the cookie, so it asks the API for a ticket on the page's
  behalf. The generic proxy (`/api/v2/*`) already attaches the bearer token, refreshes it once on a 401 and refuses cross-origin writes, so the
  ticket route needs no special handler of its own.
- **The ticket** is 256 random bits (`rtk_` + base64url), stored in Redis under the SHA-256 of its value (a copy of Redis reveals nothing usable),
  valid 60 seconds, consumed by `GETDEL` so two handshakes racing for one ticket cannot both win. It stands for the claims of the access token it was
  minted from (workspace, user, session id, token epoch). Being unguessable and known only to the server is what authenticates it; there is no signature.
- **Minting** is `POST /v2/realtime/ticket`: staff users only, never `@Idempotent` (a replayed response would be a used ticket), `Cache-Control: no-store`,
  30 per minute per person (`429 RATE_LIMITED`).
- **Reconnects** mint a new ticket: socket.io's `auth` option is a function the client runs on every attempt.
- **A refused handshake** is `connect_error` with the message `unauthorized` and nothing else, whatever the reason (unknown, used, expired, forged
  ticket; revoked session; platform operator; wrong workspace). socket.io does not retry such a socket by itself, so the client schedules its own retry
  (1 s doubling to 30 s with jitter), unless the ticket request itself was refused with 401 or 403 (signed out), in which case it stops.
- **A server-side client** that can hold an access token may use `auth: { token }` (or an `Authorization: Bearer` header). The same session checks apply.
- **While connected** a sweep every 30 seconds disconnects sockets whose session was ended (sign out, revoke, password reset) or whose token epoch was
  bumped ("revoke all"), the same checks the HTTP guard makes.

## Rooms

Server names carry internal ids and stay on the server. What a client sees (in `room` fields and in `room:join`) is the client key.

| Server room             | Client key      | Joined how                             | What it carries                                                            |
| ----------------------- | --------------- | -------------------------------------- | -------------------------------------------------------------------------- |
| `org:{orgId}`           | `org`           | automatically on connect               | workspace-wide notices (rare)                                              |
| `user:{orgId}:{userId}` | `user`          | automatically on connect (staff users) | one person on every device: assignments, unread counts, list-level signals |
| `conv:{orgId}:{uuid}`   | `conv:<uuid>`   | `room:join { kind: 'conv', id }`       | the people with that conversation open: new messages, status ticks, typing |
| `inbox:{orgId}:{scope}` | `inbox:<scope>` | `room:join { kind: 'inbox', scope }`   | people watching a list. `scope` is `all` or `team:<team uuid>`             |

`room:join` is the only way into `conv:` and `inbox:`, and the server decides:

- **`conv:`** the caller needs `inbox.conversation.read`, and the visibility rule below must say yes for that conversation.
- **`inbox:all`** needs read scope `all`. **`inbox:team:<uuid>`** needs scope `all`, or scope `team` and membership of that team. Scope `own` never.
- Only staff users have these rooms. Every refusal (no permission, not visible, does not exist, another workspace's uuid) is the same answer,
  `{ ok: false, code: 'FORBIDDEN' }`, so the answer never says whether a conversation exists. Other codes: `INVALID` (not a room spec; a client can never
  name a `user` or `org` room), `LIMIT` (25 explicit rooms per socket), `UNAVAILABLE` (the check could not run; ask again).
- The answer to a join is `{ ok: true, room, seq }`: where the room's counter stands now. The server joins first and reads the counter after, so every
  event from then on reaches the socket and any number at or below `seq` is already accounted for.
- Access is checked at the join. When a person **loses** a conversation while it is open (reassigned, role changed) the code that changed it must evict
  them: `RealtimeEmitter.evict(orgId, userId, { kind: 'conv', id })`. The audience resolver is recomputed on every emit, so list-level signals follow a role
  change at once; only an already joined `conv:` room needs the eviction.

### Who may see a conversation (the one rule)

`conversationVisible(viewer, record)` in `apps/api/src/realtime/audience/conversation-visibility.ts`, used by the socket and meant to be used by the REST
read, so the list, the thread and the socket cannot disagree (plan 3.7):

| Read scope for `inbox.conversation.read` | Sees                                                               |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `all`                                    | every conversation                                                 |
| `team`                                   | assigned to them or to one of their teams, and the unassigned ones |
| `own`                                    | assigned to them only                                              |
| no grant, or a deny                      | nothing                                                            |

The record is just `{ assigneeUserId, assigneeTeamId }`. WaDesk authorised every member of the workspace for every conversation's channel
(`workspace.{id}.inbox`); here a conversation reaches a person only if this function says so.

## Events

Every push is one envelope, and the socket.io event name is `type`:

```json
{
  "v": 1,
  "id": "<uuid>",
  "type": "inbox.message.new",
  "room": "conv:<uuid>",
  "seq": 42,
  "at": "<iso>",
  "payload": {}
}
```

`seq` counts the events of that one room, by one, from 1. `id` is the event's own uuid, for handlers that cannot be idempotent by record.

| Type                        | Room                   | Payload (`@crm/contracts` `realtimeEventSchemas`)                            | Emitted by (when built)           |
| --------------------------- | ---------------------- | ---------------------------------------------------------------------------- | --------------------------------- |
| `inbox.conversation.upsert` | `user` of the audience | `{ conversationId, rowVersion, changed[] }`: a signal, refetch the row       | ingest, assignment, status (Ph 1) |
| `inbox.message.new`         | `conv:<uuid>`          | `{ conversationId, message }`: the full `MessageResponse`, with `media.url === ''` (a link is minted per reader: fetch the page after `seq - 1`) | ingest worker, send (Ph 1)        |
| `inbox.message.status`      | `conv:<uuid>`          | `{ conversationId, messageId, clientMessageId, status, at }`                 | dispatch worker, receipts (Ph 1)  |
| `inbox.unread`              | `user`                 | `{ conversationId, unread }`                                                 | ingest, mark read (Ph 1)          |
| `inbox.assignment`          | `user` / `conv`        | `{ conversationId, assigneeUserId, assigneeTeamId }`                         | assignment (Ph 1, 3)              |
| `inbox.typing`              | `conv:<uuid>`          | `{ conversationId, userId, typing }`                                         | gateway (Ph 3)                    |
| `inbox.presence`            | `org` / `inbox:`       | `{ userId, state }`                                                          | gateway (Ph 3)                    |
| `rt.resync`                 | any                    | `{ reason }`: the server asks the client to refetch that room                | permission changes                |

System events outside a room's stream: `rt.ready` (once per connection: `{ v, rooms: [{ room, seq }], serverTime }`, the baseline for `org` and `user`).
Client requests: `room:join` and `room:leave`, both acknowledged.

List-level events are **signals** (an id, a version, what changed, no body): the client refetches the row through REST. `inbox.message.new` carries the
message because the thread is open and was already authorised.

## Sequence numbers, gaps and resync

Each emit increments the room's counter in Redis (`INCR rt:seq:{room}`, kept 30 days after its last event) before publishing, so the HTTP app and every
worker share one count. The client tracks the last number per room and treats these as "fetch again":

| Reason       | When                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| `connect`    | first connection (`user`, `org`): what the page loaded before the socket was up may be older than the socket |
| `join`       | a room was just joined: events before the join are not coming                                                |
| `reconnect`  | the connection came back (every held room, `user`, `org`)                                                    |
| `gap`        | a number skipped (`seq > last + 1`), or restarted at 1 after a higher one (the counter was lost)             |
| `foreground` | the tab was hidden for 30 s or more, or the network returned                                                 |
| `server`     | `rt.resync` from the server                                                                                  |

A number at or below the last is a late or repeated packet, not a gap. Two emitters racing can publish 6 before 5: the client sees a harmless resync.
Fetch a room's data **after** it reports `joined`; fetching first leaves a window in which an event can be missed.

## Publishing (API and worker)

```ts
// anywhere, after the transaction committed
const audience = await this.audience.forConversation(
  orgId,
  { assigneeUserId, assigneeTeamId },
  { alsoUserIds: [previousAssignee] },
);
await this.emitter.emitToUsers(orgId, audience, REALTIME_EVENT.conversationUpsert, {
  conversationId,
  rowVersion,
  changed: ['assignee'],
});
await this.emitter.emit(
  orgId,
  [{ kind: 'conv', id: conversationUuid }],
  REALTIME_EVENT.messageNew,
  { conversationId, message },
);
```

- `RealtimeEmitter` needs only Redis. `RealtimeEmitterModule` (global) is imported by the HTTP app through `RealtimeModule` and by `worker.ts`, so a job that
  hosts no socket can still announce an event. The API pods that hold sockets deliver it through the Redis adapter.
- It never throws: a failed publish is logged and the caller carries on. Never call it inside a transaction (a rolled back change must not be announced);
  message-level events do not go through the outbox (plan 3.5), lifecycle events do.
- `AudienceResolver.forConversation` returns staff user ids: everyone whose scope sees the record, plus `alsoUserIds`, minus `excludeUserIds`. Member lists
  are cached per workspace for 30 seconds (`MemberDirectory.invalidate(orgId)` to drop it).
- The default `CONVERSATION_RECORD_LOADER` reads `assignee_user_id` and `assignee_team_id` from `conversations` under the caller's tenant. A domain that needs a
  richer rule binds its own loader to that token. The realtime e2e spec inserts real `conversations` rows, so a schema change that breaks the loader fails there.
- The team chat (`/team-chat`) still polls. To move it onto sockets later, add a `RoomRef` kind for channels, an authoriser in `RoomAccessService` that reuses the
  `TeamChatAccess` rules, and replace the poll with `useRoom` and `useResync`.

## Web

`RealtimeProvider` is mounted once in `apps/web/src/app/(app)/layout.tsx`, keyed by workspace and user. It creates the client in an effect, so server
rendering touches no `window` and no socket. The address is `REALTIME_URL` or `NEXT_PUBLIC_REALTIME_URL`; without one the provider is inert.

```tsx
const { state } = useRoom({ kind: 'conv', id });          // joined / joining / denied / idle; re-joined after every reconnect
useRealtimeEvent(REALTIME_EVENT.messageNew, (e) => ...);  // typed payload; delivered once even if received twice
useResync(({ reason, room }) => refetch(), [`conv:${id}`]); // fetch again, never patch
const status = useRealtimeStatus();                       // idle | connecting | connected | reconnecting | unauthorized | stopped
```

## Operations

- Redis is required (adapter, emitter, tickets, counters). With Redis down, handshakes fail closed and emits are dropped with a warning.
- Dependencies: `@socket.io/redis-emitter` (API), `socket.io-client` (web, and API dev for the e2e spec).
- Tests: `apps/api/test/unit/realtime/` (visibility rules, audience, ticket mint / consume / expiry / replay, sequence numbering),
  `apps/api/test/e2e/realtime/` (ticket endpoint, handshake, room authorisation matrix, delivery from a separate process spawned against the same Redis,
  cross-process counts, eviction, workspace isolation), `apps/web/src/lib/realtime/*.test.ts(x)` (client with a fake socket, server rendering).

## Not built here

The dev screen, presence and typing emitters (Phase 3), the inbox events' real emitters (Phase 1), team chat on sockets (Phase 8), per-device limits.
