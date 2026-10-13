# Team inbox: conversations (TIB1) and assignment (TIB2, Phase 1)

The agent-facing inbox API over the conversation core: the list, counts, one conversation, its thread, sending, notes, the timeline,
attachments, status changes and assignment. Plan: [plan-inbox-chat.md](../threadwise-port/plan-inbox-chat.md) (sections 3.7 and 4.2, routes 9
to 21). Base path `/v2`, all routes under `/inbox`. Errors are `application/problem+json` with a stable `code`.
Shapes: `packages/contracts/src/chat-conversations/` (the list row, message, note, send and read bodies, written with the core),
`team-inbox-conversations/` (detail, timeline, attachments, the status state machine) and `team-inbox-routing-sla/` (assignment).
Code: `apps/api/src/modules/team-inbox-conversations/` and `.../team-inbox-routing-sla/`. Every id on the wire is a uuid.

The data model is in [chat-conversations.md](chat-conversations.md); sockets in [realtime.md](realtime.md); media in [chat-media.md](chat-media.md).

## Who sees what

`inbox.conversation.read` has a record scope, and one function decides it everywhere: `conversationVisible` (`apps/api/src/realtime/audience`),
used by the socket, the thread and, as the SQL condition `visibleToSql`, by the list and the counts. A test runs every viewer against every
assignment shape through both and fails if they ever differ.

| Read scope | Sees                                                               |
| ---------- | ------------------------------------------------------------------ |
| `all`      | every conversation                                                 |
| `team`     | assigned to them or to one of their teams, and the unassigned ones |
| `own`      | assigned to them only                                              |
| no grant   | the route answers 403                                              |

- **A conversation outside the caller's scope is `404 CONVERSATION_NOT_FOUND`, never 403**, and the answer is identical to a uuid that does not
  exist, so an agent with scope `own` cannot learn that another agent's conversation exists. Another workspace's uuid is the same 404 on every
  route (forced row-level security and an explicit `org_id` in every statement).
- Acting is a second question, asked only after the conversation is known to be visible: the caller's scope for the action's own permission
  (`reply`, `resolve`, `note`, `assign`, `assign_self`) must cover the conversation too, otherwise `403 FORBIDDEN`. A refusal there tells the
  caller nothing they could not already see.
- The contact summary is included only for callers who hold `record.contacts.read`; others get the thread's own name and the contact id.

## Routes

| Method and path                                 | Permission                                    | Purpose                                                                                                                                                                                 |
| ----------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /inbox/conversations`                      | `inbox.conversation.read`                     | The list, keyset cursor. `tab` all, mine, unassigned, unread; `status` (default open and pending, `all` for no filter); `channelId`; `q`; `archived`. `meta.counts` carries the badges. |
| `GET /inbox/counts`                             | `inbox.conversation.read`                     | `{ all, mine, unassigned, unread, archived }`: the badges and the 60 second safety poll.                                                                                                |
| `GET /inbox/conversations/:id`                  | `inbox.conversation.read`                     | Header: the list row plus capabilities, the service window (`open`, `expiresAt`), SLA placeholder, contact summary, up to 20 past conversations.                                        |
| `GET /inbox/conversations/:id/messages`         | `inbox.conversation.read`                     | The thread by `seq`, gap-free (below).                                                                                                                                                  |
| `POST /inbox/conversations/:id/messages`        | `inbox.conversation.reply`                    | Send text or an uploaded attachment. `202`, stored `queued`, sent by the worker (below).                                                                                                |
| `POST /inbox/messages/:id/retry`                | `inbox.conversation.reply`                    | A `failed` outbound message goes back to `queued` (`202`).                                                                                                                              |
| `POST /inbox/conversations/:id/read`            | `inbox.conversation.read`                     | `{ upToSeq }`: clears unread up to a message.                                                                                                                                           |
| `POST /inbox/conversations/:id/status`          | `inbox.conversation.resolve`                  | `{ rowVersion, status }`: resolve, close, reopen, pending. Guarded transitions (below).                                                                                                 |
| `POST /inbox/conversations/:id/assign`          | `inbox.conversation.assign` or `.assign_self` | Assign, claim or unassign (below). Routing domain.                                                                                                                                      |
| `GET /inbox/assignees`                          | `inbox.conversation.read`                     | The people and teams a conversation can be given to. Routing domain.                                                                                                                    |
| `GET /inbox/conversations/:id/notes`            | `inbox.conversation.read`                     | Internal notes, newest first, cursor.                                                                                                                                                   |
| `POST /inbox/conversations/:id/notes`           | `inbox.conversation.note`                     | `{ body, mentions[] }` (user uuids). `201`.                                                                                                                                             |
| `DELETE /inbox/conversations/:id/notes/:noteId` | `inbox.conversation.note`                     | The author, or anyone holding `inbox.conversation.assign`. `204`.                                                                                                                       |
| `GET /inbox/conversations/:id/events`           | `inbox.conversation.read`                     | The activity timeline, newest first, cursor.                                                                                                                                            |
| `POST /inbox/media`                             | `inbox.conversation.reply`                    | Upload an attachment before sending (multipart field `file`). `201`.                                                                                                                    |

Every mutation takes an `Idempotency-Key` header (the stored answer is replayed for 24 hours); `rowVersion` is required on the two that edit
the conversation row (`status`, `assign`).

## The list

- **Order**: pinned first, then newest message, then id. **Cursor**: opaque; encodes the sort tuple with the database's microsecond precision, so
  rows that tie to the millisecond are not skipped or repeated at a page boundary (tested at page sizes 1, 2, 5, 7 and 12 over twelve tied rows
  and a pinned one). A malformed cursor is `422 VALIDATION_FAILED`.
- A conversation with no message yet is not listed (it has nothing to answer); a new thread appears with its first message.
- **Tabs** (Reference rules): `mine` is assigned to the caller; `unassigned` has no human assignee (a thread held by an AI agent counts as
  unassigned); `unread` has unread messages. `archived=true` shows every archived thread and ignores the tab and status. The default status
  filter is open and pending; `status=all` removes it.
- **Counts** are one aggregate over the same visible set, narrowed by `channelId` only, so a badge equals what its tab lists. They cover open and
  pending, non-archived threads; `archived` counts the archive.
- **Search `q`**: case-insensitive substring of the thread title, the peer's name, the number, the last message, and the linked contact's name
  (a contact can be renamed after the thread was created). `%` and `_` search for themselves. A number is matched by its digits, so
  `+91 98765-43210` finds `919876543210`. Four trigram indexes serve it. Searching inside older messages is a later phase.
- `title` in a row is the contact's name, else the peer's name, else the title the thread was created with (the number).

## The thread

`GET .../messages` has no cursor of its own: the newest `limit` (default 50, at most 100) in ascending order, or `before` (a `seq`) for older ones, or
`afterSeq` for newer ones, oldest first (gap filling after a reconnect). `before` with `afterSeq` is a validation error. `page.hasMoreBefore` and
`hasMoreAfter` say whether either end has more. `seq` is contiguous per conversation, so a client can detect a gap by comparing numbers.

A `template` message carries `template: { templateId, name, language, variables, preview? }` and its `body` is the text rendered with the values at
send time. `preview` is read from the stored template when a page is listed (and on the answer to a send or a retry), for the whole page in one
tenant-scoped query: `header` (`{ format: text | image | video | document | location, text }`; a media header is only its format, never a file or
a link), `footer`, and `buttons` (`{ type: quick_reply | url | phone | copy_code | other, text }`, in order; a copy-code button has an empty `text`).
`preview` is absent when the template was deleted or the message has no template link, and on a realtime `inbox.message.new` copy; the client then
draws the name and the body and reads the page again to get it. Other senders (campaigns, broadcasts, flows) record a template through
`ConversationsFacade.recordOutbound({ template })`, which stores the same `template` message.

Media come as `media.url`: an authenticated link minted for the caller, valid for minutes, **only after the visibility check** (a hidden
conversation is a 404 before any link exists). The storage key is never in a response.

## Sending

`POST .../messages` is a `202`: the message is stored `queued` with the next `seq` and a worker sends it; the ticks (`sent`, `delivered`, `read`,
`failed`) arrive by realtime and by reading the thread. Body: `{ kind: 'text', body }` or `{ kind: 'media', mediaId, caption? }`, plus
`clientMessageId` (a uuid the client makes) and optional `replyToMessageId`.

- **Idempotent twice over**: the same `Idempotency-Key` replays the stored response; the same `clientMessageId` returns the first message and stores
  one row, even without the header. The same `clientMessageId` on another conversation is `409 IDEMPOTENCY_KEY_REUSED`.
- **Refused before anything is stored**, with problem codes: `SERVICE_WINDOW_CLOSED` (free-form outside the channel's 24 hour window),
  `CHANNEL_DISCONNECTED`, `CHANNEL_CAPABILITY_UNSUPPORTED`, `PLAN_LIMIT_REACHED` (monthly cap on a metered channel; the simulator is never
  metered), `MESSAGE_MEDIA_NOT_FOUND` (an attachment that is not the caller's, has expired, was used, or does not exist). The emergency halt and
  the content screen are checked at send time by the worker, so a halt also stops what is already queued (the message ends `failed`).
- `kind: 'template'` sends an approved template of the conversation's WhatsApp number with the agent's values (`422 INBOX_TEMPLATE_NOT_SENDABLE`
  for one the inbox cannot send, with the reason; `422 VALIDATION_FAILED` for a missing value).
- **A Meta Cloud API group thread** (`peerKey` `g:<group id>` on a `whatsapp_cloud` channel; BL-094 phase 3, [spec](../specs/waba-groups-management.md)):
  text, files and templates go to the group (`recipient_type: group`, the id verbatim); reactions, places, contact cards and buttons answer
  `422 CHANNEL_CAPABILITY_UNSUPPORTED`. Refused before anything is stored: `422 PLAN_FEATURE_LOCKED` (the plan has no `waba_groups`, the same gate as
  the management routes; a retry is checked again), `422 WABA_GROUP_SUSPENDED` (Meta suspended the group, D10), `422 WALLET_EMPTY` (the workspace's wallet
  cannot cover one message to every member, D8). The message remembers the group size (`meta.group_members`). Reply permission is the ordinary
  `inbox.conversation.reply`; no new key.
  - `GET .../conversations/:id` carries `cloudGroup` for such a thread: `{ groupId, subject, memberCount, suspended, block: 'suspended' | 'plan' | 'ineligible' | null,
canSend, estimate: { minor, currency } | null, walletShort }`. `block` is why the composer is off; `walletShort` only warns (the send decides).
    `ineligible` is read from the Groups screen's cached eligibility probe (Redis, no Meta call), so it is "unknown" until that screen has probed the
    number. `estimate` is an upper bound (one message at the marketing rate for every member). No phone number and no invite link is in it.
  - A message of the thread has `groupDelivery` (outbound) `{ members, deliveredTo, readBy, failed, billable, free }` rolled up from Meta's per-member statuses
    (a member's status only moves forward, so a retried webhook cannot inflate a count), and `group` (inbound) `{ participant, senderName }`.
    Member numbers appear only in the inbound `group.participant`, never in the tally.
  - Money: nothing is held. Each member that reaches delivered or read is reported to the wallet once, keyed `<wamid>:<member id>` (outbox
    `message.delivery_reported`); a member Meta marks `free_group_customer_service` is not reported.
- The message pipeline (the row, the ledger, the dispatch queue, the worker, receipts, the realtime events `inbox.message.new`, `inbox.message.status`,
  `inbox.unread`) belongs to the conversation core and is reached through `ConversationsFacade`; this domain proves first that the caller may see
  the conversation (404) and may reply to it (403).
- **Retry** answers `409 MESSAGE_NOT_RETRYABLE` unless the message is a failed outbound one, and checks the window, channel and plan again like a
  new send.

## Read state

`POST .../read { upToSeq }` sets the unread counter to the number of customer messages after `upToSeq`, so a message that arrived while the agent
was reading stays unread; it never goes up, and an older marker cannot make a thread more unread. The counter is shared by everyone who sees the
conversation (Reference: one agent opening a thread clears the badge for all). The answer is `{ conversationId, unreadCount }`; other open screens
learn by `inbox.unread`.

## Status

`canMoveConversationStatus` (in `@crm/contracts`, shared with the web) is the one table:

| From       | Allowed to                        |
| ---------- | --------------------------------- |
| `open`     | pending, resolved, closed         |
| `pending`  | open, resolved, closed            |
| `snoozed`  | open (wake now), resolved, closed |
| `resolved` | open (reopen), closed             |
| `closed`   | open (reopen), resolved           |
| `spam`     | open                              |

Anything else is `422 CONVERSATION_STATUS_INVALID`. `snoozed` and `spam` are never a target here (they carry a time and a reason: their own routes
later). A move to the status the thread already has is a **no-op** (`200`, no event, no outbox event; Reference re-ran every side effect and counted the
resolution twice). Otherwise the version must match (`409 ROW_VERSION_CONFLICT`).

Resolving or closing from a live status stamps `resolved_at` and `resolved_by`; resolved to closed (and back) keeps them; reopening clears them; waking
a snoozed thread clears `snoozed_until`. One transaction writes the row, the timeline event (`resolved`, `closed`, `reopened`, `status_changed`), the
audit row and the outbox event (`conversation.resolved`, or `conversation.reopened` with `by: 'agent'`; the core emits the same type with
`by: 'customer'` when a customer reply reopens). Open screens get `inbox.conversation.upsert`.

## Notes

A note is staff-only text on a conversation: no channel, no `seq`, never a message, never in the preview. `mentions` are user uuids; every one must
be an **active member of this workspace** (Reference accepted any integer and notified users of other workspaces): duplicates and the author are
dropped, anyone else is `422`. A note writes the timeline event `note_added` and the outbox event `conversation.note_added` (ids, never the text; a
consumer reads the note under its own access check). Notifying the mentioned people is Phase 3. Delete: the author, or someone holding
`inbox.conversation.assign`, otherwise `403 INBOX_NOTE_NOT_DELETABLE` (Reference let any agent delete anyone's note). Notes are hard-deleted.

## Timeline

`conversation_events` (a monthly partitioned stream): `type` is an open string (`created`, `assigned`, `reassigned`, `unassigned`, `ai_handoff`,
`resolved`, `closed`, `reopened`, `status_changed`, `note_added`, `snoozed`, `priority_changed`, `first_response`, `sla_breach`, ...); `actor.kind` is
`user`, `system`, `bot`, `flow` or `ai`; `payload` carries uuids only (a writer resolves its ids first). The state change is written first and the
event in the same transaction, so a timeline never shows a change that rolled back.

## Attachments

`POST /inbox/media` (multipart field `file`) stores the file through the media door (type and content checked, never the client's Content-Type; limits
5 MB images, 16 MB audio and video, 100 MB documents) and keeps a reference row (`conversation_media_uploads`) held 24 hours for the uploader. A send
names it by `mediaId`: the claim is atomic (a second message cannot take it, another agent cannot use it, a refused send gives it back, a retry of the
same send is recognised). A script renamed `.png`, an empty file or no file is refused (`AUTH_UPLOAD_REJECTED` or `VALIDATION_FAILED`). Not built: a
sweep of expired, unclaimed uploads (the index for it exists).

## Assignment (team-inbox-routing-sla)

`AssignmentService` is the only writer of `assignee_user_id`, `assignee_team_id` and `assignee_agent_id`; the manual route, and later bulk, kanban,
routing rules, escalation and flows, all come through it (`assignInTx` writes inside the caller's transaction, `afterCommit` publishes). Phase 1 has the
manual strategy only; `strategy` is accepted and defaults to `manual`.

`POST .../assign { rowVersion, userId?, teamId?, strategy? }`: `userId: <uuid>` assigns; `null` unassigns the person; omitted leaves them alone; the
same for `teamId`. At least one of the two must be present.

- **Who may**: `inbox.conversation.assign` assigns anyone and unassigns. `inbox.conversation.assign_self` allows only a **claim**: `userId` is the
  caller's own id, no team, otherwise `403`. Either way the conversation must be visible (404) and the permission's scope must cover it (403).
- **Targets** must belong to this workspace: a user who is an **active member and may read the inbox** (checked fresh, not from the 30 second member
  cache), a team of this workspace; otherwise `422 CONVERSATION_ASSIGNEE_INVALID` and nothing changes. Reference's "assign nobody clears the person" quirk
  is gone: omit the field to leave it.
- Assigning what is already assigned is a no-op. A stale `rowVersion` is `409`.
- A `closed` conversation becomes `open` when assigned (resolved, snoozed and spam keep their status). Giving a thread to a person or a team takes it
  from an AI agent: `assignee_agent_id` is cleared and an `ai_handoff` event is written.
- One transaction writes the columns, the timeline event (`assigned`, `reassigned` or `unassigned`, with from and to as uuids), the audit row and the
  outbox event `conversation.assigned` (`toUserId: null` is an unassignment: one event type for every change of who holds the thread).
- **After the commit**: `inbox.assignment` to everyone who may see the conversation now and to whoever just lost it, the same event to the
  conversation's room, an `inbox.conversation.upsert` signal, and `RealtimeEmitter.evict` for everyone who can no longer see it, so they stop receiving
  its messages. An agent with scope `own` whose conversation is reassigned gets a 404 on it at once.
- The response is the conversation row as the list shows it.

`GET /inbox/assignees` returns `{ users, teams }`: the **active members who may open the inbox**, each with `availability` (`online`, `away`, `busy`,
`offline`; no status row means offline, as Reference), `openConversations` (a live count of open and pending conversations, not a stored counter that
drifts), `isMe`; and the workspace's teams with `memberCount` and `assignmentStrategy` (every assignment to a team is manual until Phase 3).

## Realtime this domain publishes (after the commit, never inside it)

`inbox.conversation.upsert` (status, notes, assignment; to everyone who may see the thread), `inbox.assignment` (to the same people and the
conversation's room). Message events and `inbox.unread` are the core's. Events are signals; the client refetches the row over REST.

## Not built here (later phases, recorded not dropped)

Template send (TPL), snooze and spam routes, priority, labels, bulk, saved replies, saved views, SLA, routing rules and strategies, mention
notifications, presence and typing, the AI hand-off hooks (AIAG), compose-to-many, the sweep of expired uploads. Reference's inbox deep link
`/inbox?c=<uuid>` is the web's.

## Tests

`apps/api/test/unit/team-inbox-conversations/` (the status table over every pair, the cursor, LIKE escaping, the contract shapes),
`test/integration/team-inbox-conversations/` (row-level security and constraints of the new storage, and the SQL visibility condition against
`conversationVisible` for 48 viewers over 8 assignment shapes), `test/e2e/team-inbox-conversations/` (the routes through the whole app: list, tabs,
counts, search, paging over ties, scopes, cross-workspace 404 on every route, thread paging, send, idempotency, refusals, retry, read, attachments,
assign, claim, status, notes, timeline, assignees).
