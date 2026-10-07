# API: in-app notifications (the header bell)

Domain `notif` (WD-NOTIF-006, 012, 015, 017; live conversation notifications: BL-096, [spec](../specs/realtime-notifications.md)). Base path `/v2`. Errors are `application/problem+json` with a stable `code`. Shapes live in
`packages/contracts/src/notifications-activity-audit/`. Every id on the wire is a uuid.

Each person has their own feed (`inbox_notifications`, tenant-scoped with forced row level security). Every route needs a staff bearer token and
is pinned to the caller's own user id: nobody can read or mark another person's notification, and another workspace's is invisible. There is no
permission key (WaDesk had no role gate on the bell either); a non-staff actor is 403.

| Route                                        | Notes                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /notifications?limit&cursor&unreadOnly` | newest first, `limit` 1..50 (default 20), keyset `cursor` from `page.nextCursor`; `meta.unread` is the real unread total |
| `GET /notifications/unread-count`            | `{ "unread": 3 }` (the badge; the web app polls it once a minute)                                                        |
| `POST /notifications/read-subject`           | `{ kind: 'conversation', id }` marks the caller's unread rows about that conversation read; `{ updated, unread }`; a bad `kind` is 422 |
| `POST /notifications/:id/read`               | marks one read and returns it; idempotent (the first `readAt` is kept); someone else's or unknown id is 404              |
| `POST /notifications/read-all`               | `{ "updated": n }`, only the caller's unread rows                                                                        |

Every mark-read (one, all, by subject, or opening the conversation) also tells the person's other tabs and devices over the `user` socket room
(`notification.read`, below), so badges converge.

A notification: `{ id, type, title, body, link, data, readAt, createdAt, count?, subject? }`. `count` (only on a collapsing row) is how many events the
row stands for; `subject` (`{ kind: 'conversation', id }`, absent on rows written before subjects existed) says what the row is about. `type` is one of
`NOTIFICATION_TYPES`: `task_assigned`, `task_due`, `task_completed`, `new_lead`, and the conversation types `new_chat`, `new_message`,
`conversation_assigned`, `mention`. Other values are still written by other domains without being in the enum (`wallet_low_balance`, `wallet_credited`,
`form_submission`, `form_needs_review`, the sales-doc type); a client words an unknown type from the server's English `title` / `body`. `data` carries what a
client needs to word it in the viewer's language (`taskTitle`, `actorName`, ... and for the conversation types `conversationId`, `contactName`,
`channelKind`, `preview` (at most 80 characters, render it as text), `count`, `assignedByName`, `teamAssigned`, `authorName`, `noteId`); `title` / `body` are
the server's English fallback, and `link` is an app path (`/tasks?task=<uuid>`, `/inbox?c=<conversation uuid>`), never an absolute URL.

## How rows get written

Outbox consumers, in the worker process. A consumer implements `OutboxSubscriber` (kernel, `kernel/outbox/outbox-subscribers.ts`), registers itself with the
`OutboxSubscriberRegistry`, and `OutboxDrainService` hands it each event of the types it asked for. Delivery is at-least-once, so a consumer must be
idempotent: the notification insert is `ON CONFLICT DO NOTHING` on `(org_id, user_id, dedupe_key)` where the key is the event type plus the outbox event id.
The task consumer and its rules are in [tasks.md](tasks.md#notifications).

## Live conversation notifications (BL-096, phase 1: the server)

The inbox now writes bell rows, so the bell works on every page, and every new row (these and the task, lead, form, sales-doc and wallet ones) is announced
live to the person it is for.

**Events.** `message.received` is a new outbox event, written by the inbound ingest in the same transaction as the stored message (`firstInbound` is true for a
new thread or one the message reopened; never for imported history or outbound messages; payload in `@crm/contracts` `messageReceivedPayloadSchema`: ids,
channel kind, an 80-character preview, the sender's name or the last four digits, never the body). `ConversationNotificationConsumer` (worker process, with the
task consumer in `NotificationsWorkerModule`) reads it, and the existing `conversation.assigned` and `conversation.note_added`.

| Type                    | Source event              | Who is told                                                                                                                                                                | Row                                                                                       |
| ----------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `new_chat`              | `message.received`, first | the assignee; a team's members who may read it; an unassigned thread: everyone who may read AND reply (decision D1), at most `NOTIFY_MAX_RECIPIENTS` (50) people          | one per person and event (`new_chat:<conversation>:<event>`)                              |
| `new_message`           | `message.received`        | the assignee; a team-assigned thread without a person: the team's members who may read it; an unassigned thread tells nobody (they heard at `new_chat`)                    | collapsed: ONE unread row per person and chat (`collapse_key msg:<conversation>`), `count` |
| `conversation_assigned` | `conversation.assigned`   | the new assignee (never the person who did it, never on an unassignment); a team assignment: the team's members who may read it, except the actor, delivered `silent`      | one per event                                                                             |
| `mention`               | `conversation.note_added` | each mentioned person who may read the conversation, never the author                                                                                                      | one per note and person (`mention:<note>:<user>`)                                         |

Rules, recomputed at delivery from the conversation as it is then: "may read" is `conversationVisible` over `inbox.conversation.read` (the one rule behind the
REST read and every socket delivery); a muted conversation (`conversations.muted_at`) writes no `new_chat` or `new_message` (an assignment or a mention still
does); an assignment the conversation no longer shows is dropped; a person who marked the thread read at or after the message arrived (the open thread does
this when a message lands, `POST /inbox/conversations/:id/read`) is not alerted. The workspace owner's toggles (Settings, Notifications) gate exactly these four
types (decision D3): `new_chat` and `new_message` by `new_customer_reply`, `conversation_assigned`, `mention` by `mention_in_inbox`; `inapp` off stops the row and
the push. Tasks, leads, forms, sales docs and the wallet are not gated. `NOTIFY_CONVERSATIONS_ENABLED` is the off switch (default on outside production, off in
production until set; off: the ingest stops writing `message.received` and the consumer drops what is queued).

**Collapsing.** `new_message` is a delete-and-insert in one transaction (so the row moves to the top and the keyset cursor stays valid), serialised per
(person, chat) by an advisory lock, with a partial unique index on `(org, user, collapse_key) WHERE read_at IS NULL` behind it. Reading the row starts a fresh
count on the next message; the read row stays as history. Idempotent: the new row's dedupe key ends in the outbox event id, and an event at or below the newest
row's id is a redelivery that adds nothing (a re-claimed batch counts each message once; under two concurrent workers a count can come out short by one message,
never doubled and never lost as a row).

**Socket events** (room `user`, only the person concerned, never another person or workspace; see [realtime.md](realtime.md)):

- `notification.created` `{ notificationId, type, unread, subjectKind, subjectId, collapsed, silent }`: no title, body, name or number. `unread` is the person's true
  total after the row. `silent` is set for a team-wide assignment and for a push inside the throttle window (`NOTIFY_THROTTLE_SECONDS`, 5, per person and chat),
  so a burst moves the row and the badge but pings once. Sent AFTER the writing transaction committed; never throws.
- `notification.read` `{ unread, notificationIds: uuid[] | 'all' }`: after `:id/read`, `read-all`, `read-subject`, and when a conversation is read.

**Reading a conversation** (`POST /inbox/conversations/:id/read`) now also marks that conversation's bell rows read (the person's own, any device), records the
read moment, and emits `notification.read`. It never fails because the bell could not be updated.

**Outbox headroom (spec risk R2).** Every inbound message adds one `message.received` row. `OutboxDrainService` still claims 200 rows per batch every 2 s, but a tick now
keeps claiming while the batch was full (up to 10 batches), and dispatches up to `OUTBOX_DRAIN_CONCURRENCY` (default 6) aggregates side by side while the events of
one aggregate stay in order. Measured in the e2e harness (Docker Postgres on a laptop): about 12 events/s for the first version of the consumer (three transactions per event, one
event at a time), then 41/s for one busy chat and 108/s for twenty chats at once with one transaction per event and the concurrent dispatch (see `conversation-notifications.e2e.spec.ts`, "drain headroom"). The consumer takes one transaction per event.

## Not built here

The web half of BL-096 (global listener, toast, sound, tab title), the full `/notifications` page, per-person preferences (WD-NOTIF-005), email, Slack and Web Push
delivery, the workspace feed (`notifications` table, WD-NOTIF-001..004), retention (decision D5, phase 2: the feed is never pruned yet), disconnect / broadcast /
team chat mention rows (phase 2), resolved / deal / SLA rows (phase 3).
