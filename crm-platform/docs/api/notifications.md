# API: in-app notifications (the header bell)

Domain `notif` (TW-NOTIF-006, 012, 015, 017; live conversation notifications: BL-096, [spec](../specs/realtime-notifications.md)). Base path `/v2`. Errors are `application/problem+json` with a stable `code`. Shapes live in
`packages/contracts/src/notifications-activity-audit/`. Every id on the wire is a uuid.

Each person has their own feed (`inbox_notifications`, tenant-scoped with forced row level security). Every route needs a staff bearer token and
is pinned to the caller's own user id: nobody can read or mark another person's notification, and another workspace's is invisible. There is no
permission key (Reference had no role gate on the bell either); a non-staff actor is 403.

| Route                                        | Notes                                                                                                                                                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /notifications?limit&cursor&unreadOnly` | newest first, `limit` 1..50 (default 20), keyset `cursor` from `page.nextCursor`; `meta.unread` is the real unread total                                                                                                    |
| `GET /notifications/unread-count`            | `{ "unread": 3 }` (the badge; the web app polls it once a minute)                                                                                                                                                           |
| `POST /notifications/read-subject`           | `{ kind, id }` marks the caller's unread rows about that subject read (`kind` is `conversation`, `device`, `broadcast`, `campaign`, `scheduled_message` or `team_chat_channel`); `{ updated, unread }`; a bad `kind` is 422 |
| `GET /notifications/preferences`             | my bell / toast / sound per type: the values in force, the defaults, what I set myself and the owner's toggle I inherit (below)                                                                                             |
| `PUT /notifications/preferences`             | a partial, idempotent update of those; returns the same list as the GET                                                                                                                                                     |
| `POST /notifications/:id/read`               | marks one read and returns it; idempotent (the first `readAt` is kept); someone else's or unknown id is 404                                                                                                                 |
| `POST /notifications/read-all`               | `{ "updated": n }`, only the caller's unread rows                                                                                                                                                                           |

Every mark-read (one, all, by subject, or opening the conversation) also tells the person's other tabs and devices over the `user` socket room
(`notification.read`, below), so badges converge.

A notification: `{ id, type, title, body, link, data, readAt, createdAt, count?, subject? }`. `count` (only on a collapsing row) is how many events the
row stands for; `subject` (`{ kind: 'conversation', id }`, absent on rows written before subjects existed) says what the row is about. `type` is one of
`NOTIFICATION_TYPES`: `task_assigned`, `task_due`, `task_completed`, `new_lead`, the conversation types `new_chat`, `new_message`,
`conversation_assigned`, `mention`, and (phase 2) `device_connected`, `device_disconnected`, `device_logged_out`, `broadcast_completed`, `broadcast_failed`,
`campaign_completed`, `campaign_failed`, `scheduled_completed`, `scheduled_failed`, `teamchat_mention`, `teamchat_message`. Other values are still written by
other domains without being in the enum (`NOTIFICATION_LEGACY_TYPES`: `wallet_low_balance`, `wallet_credited`, `form_submission`, `form_needs_review`,
`sales_doc_decided`; they can still be tuned in the preferences); a client words an unknown type from the server's English `title` / `body`. `data` carries what a
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

| Type                    | Source event              | Who is told                                                                                                                                                           | Row                                                                                        |
| ----------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `new_chat`              | `message.received`, first | the assignee; a team's members who may read it; an unassigned thread: everyone who may read AND reply (decision D1), at most `NOTIFY_MAX_RECIPIENTS` (50) people      | one per person and event (`new_chat:<conversation>:<event>`)                               |
| `new_message`           | `message.received`        | the assignee; a team-assigned thread without a person: the team's members who may read it; an unassigned thread tells nobody (they heard at `new_chat`)               | collapsed: ONE unread row per person and chat (`collapse_key msg:<conversation>`), `count` |
| `conversation_assigned` | `conversation.assigned`   | the new assignee (never the person who did it, never on an unassignment); a team assignment: the team's members who may read it, except the actor, delivered `silent` | one per event                                                                              |
| `mention`               | `conversation.note_added` | each mentioned person who may read the conversation, never the author                                                                                                 | one per note and person (`mention:<note>:<user>`)                                          |

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

## Phase 2 (BL-096, the server)

### More producers

All are outbox consumers in `NotificationsWorkerModule` (idempotent through the outbox event id in the row's key; the live push goes out after the commit; run under
the event's own tenant). The shared tail is `NotificationFanout`: one query for every recipient's stored preference, the owner's toggle read once, one grouped
count for the unread totals the pushes carry.

| Type(s)                                    | Source event                                                                                                                                                                              | Who is told                                                                                                                                                                                  | Row                                                                                                                                                                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `device_disconnected`, `device_logged_out` | `device.disconnected`, `device.logged_out` (transition events of the runtime); `device.status_changed` only with `reason: worker_silent` (the 90 s sweep has no transition event)         | everyone holding `wa.devices.read` (admins included), at most `NOTIFY_MAX_RECIPIENTS`; not when the person asked for it (`reason: user`)                                                     | once per person, kind and device per hour (a flapping number does not flood); `subject` = `{ kind: 'device', id }`; link `/devices/<uuid>`; data `deviceId, deviceName, maskedNumber (last four digits), state, reason`; never a QR, a code or a full number |
| `device_connected` ("back online")         | `device.connected`                                                                                                                                                                        | the same people, but only those who were told about a drop in the last 24 hours (a first pairing says nothing); their unread drop rows are marked read and `notification.read` is sent       | one per event                                                                                                                                                                                                                                                |
| `broadcast_completed` / `broadcast_failed` | `broadcast.status_changed` (`completed`, `completed_with_errors` / `failed`)                                                                                                              | the person who started it (`broadcasts.user_id`); a failure also the workspace admins (system role `admin`)                                                                                  | key `<kind>:<uuid>:<status>:<event id>`; `subject` `{ kind: 'broadcast', id }`; link `/broadcasts/<uuid>`; data `kind, id, name, status, total, sent, failed, reason`                                                                                        |
| `campaign_completed` / `campaign_failed`   | `campaign.status_updated` (`completed` / `failed`)                                                                                                                                        | the creator (`wpcampaigns.created_by`); a failure also the admins                                                                                                                            | as above; link `/campaigns/<uuid>`                                                                                                                                                                                                                           |
| `scheduled_completed` / `scheduled_failed` | **new** `scheduled.status_changed` (written by `ScheduledRunService.finish`/`markFailed` and `ScheduledDueService` in the status transaction; the scheduled-message runner had no events) | the person who scheduled it (`scheduled_messages.user_id`); a failure also the admins                                                                                                        | as above; link `/scheduled/<uuid>`; payload `{ uuid, name, status, reason, sent, failed }`                                                                                                                                                                   |
| `teamchat_mention`                         | `teamchat.mention.created`                                                                                                                                                                | the mentioned member, if active, still in a private or direct channel, and not yet caught up (their read pointer is below the message: a channel kept open reads it first); never the author | ONE unread row per person and channel (`collapse_key tcmention:<channel>`, `count`, "3 new mentions in #sales"); `subject` `{ kind: 'team_chat_channel', id }`; link `/team-chat?c=<channel uuid>`; the mention token shows as `@Name` in the preview        |
| `teamchat_message`                         | `teamchat.message.posted` in a `dm` channel                                                                                                                                               | the other person of the direct message, under the same rules; a message that also mentions them is the mention row only                                                                      | ONE unread row per person and conversation (`collapse_key tcdm:<channel>`); data has `direct: true`                                                                                                                                                          |

Workspace toggles (decision D3, now also for these): `device_connected`, `device_disconnected` (also for `device_logged_out`), `broadcast_completed`,
`campaign_completed`, `campaign_failed` (also for `broadcast_failed`), `mention_in_inbox` (also for `teamchat_mention`) and `wallet_low_balance` (the wallet alert, no
longer ungated); `scheduled_*`, `teamchat_message` and the other legacy types have no toggle. Team chat has no per-channel mute: a person silences it with their own
preference for the two team chat types.

### Per-person preferences

Table `notification_user_prefs (org_id, id, uuid, user_id, type, bell, toast, sound, ...)`, forced RLS, unique `(org_id, user_id, type)`, cascade with the user. It is
sparse: a row exists only for a type the person changed, and a `NULL` channel means "inherit". Resolution for one person and type, highest first: **their own
setting**, then **the workspace owner's in-app toggle** (only for the types in `NOTIFICATION_TYPE_PREF_KEY`; the person's own bell choice wins over it, either way),
then the **catalogue default** (`NOTIFICATION_CATALOG` in `@crm/contracts`: bell on for all; toast on except `task_completed`; sound on for the chat types
`new_chat`, `new_message`, `conversation_assigned`, `mention`, `teamchat_mention`, `teamchat_message`). One rule, `resolveNotificationChannels`, is used by every
producer and by the screen.

- **Bell off** = no row at all and no push (an existing collapsed row is left as it is). This applies to EVERY producer (task, lead, form, sales doc, wallet,
  conversation, phase 2) because the repository (`insertReturning`, `collapseOrInsert`) makes the decision when it writes.
- **Toast / sound off** = the row is written and `notification.created` carries `toast: false` / `sound: false`.
- Desktop alerts stay a per-browser choice (the browser's own permission). Quiet hours / "do not disturb" and email delivery are phase 3.

`GET /v2/notifications/preferences` returns `{ items: [...] }`, one item per tunable type in catalogue order (`NOTIFICATION_PREF_TYPES`):

```json
{
  "type": "new_message",
  "group": "conversations",
  "bell": true,
  "toast": false,
  "sound": true,
  "defaults": { "bell": true, "toast": true, "sound": true },
  "overrides": { "bell": null, "toast": false, "sound": null },
  "workspaceInapp": true
}
```

`bell` / `toast` / `sound` are the values in force. `overrides` is what the person chose (`null` = inherits). `workspaceInapp` is the owner's toggle for the type (always
`true` when none governs it): when it is `false` and `overrides.bell` is `null`, the bell is off by the owner's choice and the screen can say so. `group` is one of
`NOTIFICATION_GROUPS` (`conversations`, `tasks`, `leads`, `documents`, `wallet`, `devices`, `broadcasts`, `team_chat`).

`PUT /v2/notifications/preferences` takes `{ "items": [{ "type": "new_message", "toast": false }, { "type": "mention", "bell": null, "sound": true }] }` (1 to 60 items,
each type once). A boolean sets that channel, `null` goes back to inheriting, an absent key stays. Applying the same body twice changes nothing (no version bump, no
audit row). It returns the full list like the GET, so the screen needs no second call. A change is audited (module `notifications`, record = the user, delta
`<type>.<channel>: {old, new}`). Staff only and pinned to the caller, no permission key; an unknown type, an empty list, a duplicate or a non-boolean is 422.

### The inbox navigation badge

No new endpoint. The number is `GET /v2/inbox/counts` -> `{ all, mine, unassigned, unread, archived }` (`unread` = the conversations the caller may see that have unread
messages, already scoped by the caller's visibility). It stays current without polling through the events the user's room already receives:
`inbox.unread`, `inbox.conversation.upsert` and `inbox.assignment` (invalidate `['inbox','counts']`, debounced), and `notification.created` / `notification.read` (the
bell total). Refetch on `useResync`. This is the same call the Inbox tabs use, so the badge and the tab cannot disagree.

### Retention (decision D5)

`NotificationRetentionService` (worker process, `@Cron('0 30 3 * * *')`, server time): read rows older than 90 days and unread rows older than 180 days are deleted by
`created_at`; nothing from the last 90 days is ever touched. Batches of `NOTIFY_RETENTION_BATCH_SIZE` (5000) rows, each its own short transaction (partial indexes
`idx_inbox_notifications_prune_read` / `_unread`, oldest first, `FOR UPDATE SKIP LOCKED`), at most `NOTIFY_RETENTION_MAX_BATCHES` (200) per kind per run, so a first
run over a huge backlog continues the next day. Several worker pods are safe: each batch first takes `pg_try_advisory_xact_lock`; a pod that does not get it stops.
One log line per run: `readDeleted, unreadDeleted, batches, moreToDo, readCutoff, unreadCutoff, durationMs`.

| Setting                        | Default | Meaning                                                                       |
| ------------------------------ | ------- | ----------------------------------------------------------------------------- |
| `NOTIFY_RETENTION_ENABLED`     | `true`  | `false` keeps everything                                                      |
| `NOTIFY_RETENTION_READ_DAYS`   | `90`    | read rows older than this are deleted (minimum 30)                            |
| `NOTIFY_RETENTION_UNREAD_DAYS` | `180`   | unread rows older than this are deleted (raised to the read age if set lower) |
| `NOTIFY_RETENTION_BATCH_SIZE`  | `5000`  | rows per delete statement                                                     |
| `NOTIFY_RETENTION_MAX_BATCHES` | `200`   | statements per kind of row per run                                            |

## Not built here

The web half of BL-096 (global listener, toast, sound, tab title, preferences screen, inbox nav badge), the full `/notifications` page, email, Slack and Web Push
delivery, quiet hours / do-not-disturb, the workspace feed (`notifications` table, TW-NOTIF-001..004), resolved / deal / SLA rows (phase 3), a per-channel mute for team
chat.
