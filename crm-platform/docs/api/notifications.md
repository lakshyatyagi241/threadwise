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
`campaign_completed`, `campaign_failed`, `scheduled_completed`, `scheduled_failed`, `teamchat_mention`, `teamchat_message`, and (BL-099) `waba_group_join_request`, `waba_group_suspended`, `waba_group_suspension_cleared`, and (groups of a personal number) `device_group_join_request`, `device_group_removed`, and `test` (the test button above; group `system`). Other values are still written by
other domains without being in the enum (`NOTIFICATION_LEGACY_TYPES`: `wallet_low_balance`, `wallet_credited`, `form_submission`, `form_needs_review`, `form_payment`, `form_payment_duplicate`,
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
types (decision D3; `chat_waiting`, below, joins them): `new_chat`, `new_message` and `chat_waiting` by `new_customer_reply`, `conversation_assigned`, `mention` by `mention_in_inbox`; `inapp` off stops the row and
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

### WhatsApp Groups (BL-099)

Rows written by `WabaGroupNotificationConsumer` (group `whatsapp_groups` in the catalogue, subject kind `waba_group`). The audience is everyone holding `waba.groups.manage` (admins included), at most `NOTIFY_MAX_RECIPIENTS`. **Plan gate:** the consumer asks `PlanEntitlementService.featureEnabled(org, 'waba_groups')` first and writes nothing, silently, for a plan without it; `GET /v2/notifications/preferences` leaves the three types out of `items` for such a workspace (`NOTIFICATION_TYPE_PLAN_FEATURE` in `@crm/contracts`), so the screen shows no rows and no heading for them.

| Type                            | Source event                                                                       | Who is told                                                                                             | Row                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `waba_group_join_request`       | `whatsapp.group.join_request` with `handled` empty (a request entered the queue)   | the audience above                                                                                      | ONE unread row per person and group (`collapse_key wgjr:<group uuid>`, `count`): "Someone wants to join Sales club", then "10 people want to join Sales club"; `subject` `{ kind: 'waba_group', id }`; link `/waba-groups?account=<number uuid>`; data `groupId, connectionId, groupName, count`. A request event whose queue is already empty at delivery writes nothing |
| (closes the row)                | `whatsapp.group.join_request` with `handled` = `approved`, `rejected` or `revoked` | n/a                                                                                                     | no new row; once the group's queue is empty the unread join-request rows of that group are marked read and `notification.read` is sent                                                                                                                                                                                                                                    |
| `waba_group_suspended`          | `whatsapp.group.suspended` with `suspended: true`                                  | the audience above                                                                                      | one row per event; "Sales club was suspended"; dropped when the group is no longer suspended at delivery                                                                                                                                                                                                                                                                  |
| `waba_group_suspension_cleared` | `whatsapp.group.suspended` with `suspended: false`                                 | only people told about the suspension in the last 30 days; their unread suspension rows are marked read | one row per event; "Sales club is active again"                                                                                                                                                                                                                                                                                                                           |

Rows hold the group's subject (cut to 80 characters) and a count: **never** a member's or requester's number, the Meta group id or the invite link. Idempotent through the outbox event id (the collapsing writer reads it back, so a re-delivered event, oldest or newest, changes neither the row nor its count). Defaults (`NOTIFICATION_CATALOG`): bell on, toast on, sound off, **push off** for all three (a quiet default like devices and sends: an admin task, not an emergency). When a person turns the push on, the OS notification is titled with the group name only (`Sales club`) and the body is the kind of event (`5 join requests`, `Group suspended`, `Group active again`); no sentence of the row, no link text (`push-payload.ts`, `groupPushText`). No owner toggle governs these types. Tests: unit `group-notification-rules.spec.ts`, `push-payload.spec.ts`, `notification-preferences.spec.ts`; real Postgres `test/integration/notifications/waba-group-notifications.spec.ts`.

### Groups of a personal number

Rows written by `DeviceGroupNotificationConsumer` (group `whatsapp_groups`, subject kind `device_group`; the sibling of the official one above). The audience is everyone holding `wa.groups.manage`, at most `NOTIFY_MAX_RECIPIENTS`, and only while the workspace is on the unofficial allow-list (there is no plan feature, decision D1). **Push is off by default** for both types (a removal is news to read, not an emergency); when a person turns it on the push carries the group's name and the kind of event only.

| Type                        | Source event                                                                          | Row                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `device_group_join_request` | `whatsapp.device_group.join_request` with `handled` empty (the queue grew by `added`) | ONE unread row per person and group (`collapse_key dgjr:<group uuid>`, `count`): "Someone wants to join Sales club", then "10 people want to join Sales club"; link `/devices/groups?device=<device uuid>`; data `groupId, deviceId, groupName, count`. An event whose queue is already empty (or whose number has left) at delivery writes nothing |
| (closes the row)            | `whatsapp.device_group.join_request` with `handled: 'settled'`                        | no new row; once the group's queue is empty the unread join-request rows of that group are marked read                                                                                                                                                                                                                                              |
| `device_group_removed`      | `whatsapp.device_group.left` with `removed: true` (someone else removed the number)   | one row per person: "Removed from Sales club", the body names the number by its label ("Shop line"), never its digits; also closes the group's unread join-request rows. A leave made on the phone or on the screen (`removed: false`) is silent                                                                                                    |

Rows hold the group's subject (cut to 80 characters), the number's label and a count: **never** a member's or requester's number or the invite code. Idempotent through the outbox event id; the live push goes out after the commit.

Workspace toggles (decision D3, now also for these): `device_connected`, `device_disconnected` (also for `device_logged_out`), `broadcast_completed`,
`campaign_completed`, `campaign_failed` (also for `broadcast_failed`), `mention_in_inbox` (also for `teamchat_mention`) and `wallet_low_balance` (the wallet alert, no
longer ungated); `scheduled_*`, `teamchat_message` and the other legacy types have no toggle. Team chat has no per-channel mute: a person silences it with their own
preference for the two team chat types.

### Per-person preferences

Table `notification_user_prefs (org_id, id, uuid, user_id, type, bell, toast, sound, push, ...)`, forced RLS, unique `(org_id, user_id, type)`, cascade with the user. It is
sparse: a row exists only for a type the person changed, and a `NULL` channel means "inherit". Resolution for one person and type, highest first: **their own
setting**, then **the workspace owner's in-app toggle** (only for the types in `NOTIFICATION_TYPE_PREF_KEY`; the person's own bell choice wins over it, either way),
then the **catalogue default** (`NOTIFICATION_CATALOG` in `@crm/contracts`: bell on for all; toast on except `task_completed`; sound on for the chat types
`new_chat`, `new_message`, `conversation_assigned`, `mention`, `teamchat_mention`, `teamchat_message`; push on for those plus `task_assigned`, phase 3). One rule, `resolveNotificationChannels`, is used by every
producer and by the screen.

- **Bell off** = no row at all and no push (an existing collapsed row is left as it is). This applies to EVERY producer (task, lead, form, sales doc, wallet,
  conversation, phase 2) because the repository (`insertReturning`, `collapseOrInsert`) makes the decision when it writes.
- **Toast / sound off** = the row is written and `notification.created` carries `toast: false` / `sound: false`.
- **Push off** = the row is still written; no browser notification is sent for it (phase 3, below).
- Desktop alerts stay a per-browser choice (the browser's own permission). Quiet hours / "do not disturb" and email delivery are later.

`GET /v2/notifications/preferences` returns `{ items: [...] }`, one item per tunable type in catalogue order (`NOTIFICATION_PREF_TYPES`):

```json
{
  "type": "new_message",
  "group": "conversations",
  "bell": true,
  "toast": false,
  "sound": true,
  "push": true,
  "defaults": { "bell": true, "toast": true, "sound": true, "push": true },
  "overrides": { "bell": null, "toast": false, "sound": null, "push": null },
  "workspaceInapp": true
}
```

`bell` / `toast` / `sound` / `push` are the values in force. `overrides` is what the person chose (`null` = inherits). `workspaceInapp` is the owner's toggle for the type (always
`true` when none governs it): when it is `false` and `overrides.bell` is `null`, the bell is off by the owner's choice and the screen can say so. `group` is one of
`NOTIFICATION_GROUPS` (`conversations`, `tasks`, `leads`, `documents`, `wallet`, `devices`, `broadcasts`, `team_chat`).

`PUT /v2/notifications/preferences` takes `{ "items": [{ "type": "new_message", "toast": false }, { "type": "mention", "bell": null, "sound": true }] }` (1 to 60 items,
each type once; `push` works like the other three). A boolean sets that channel, `null` goes back to inheriting, an absent key stays. Applying the same body twice changes nothing (no version bump, no
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

## Phase 3 (BL-097): browser notifications (Web Push)

A person who allowed browser notifications on a device gets an OS-level notification for the events that already put a row in their bell, even with the CRM tab
closed. Standard Web Push (service worker + VAPID, the `web-push` library on the API and worker). Spec: [realtime-notifications.md](../specs/realtime-notifications.md)
section 18. It is **fully off and invisible** unless the deployment sets the VAPID keys.

### Settings

| Env                    | Default | Meaning                                                                                                                                     |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `VAPID_PUBLIC_KEY`     | empty   | base64url, 87 characters. The "application server key" a browser subscribes with. Generate a pair once: `npx web-push generate-vapid-keys`. |
| `VAPID_PRIVATE_KEY`    | empty   | base64url, 43 characters. A secret: never logged, never returned.                                                                           |
| `VAPID_SUBJECT`        | empty   | `mailto:you@example.com` or an https URL: how the push services reach the operator.                                                         |
| `WEB_PUSH_TTL_SECONDS` | `14400` | How long a push service keeps a notification for an offline device (60 to 86400).                                                           |

The feature is on only when all three VAPID values are present and well formed (`config/domains/web-push.env.ts`); a half-set or malformed triple leaves it off, it never
stops the app from booting. Changing the pair later makes every saved device unusable (a browser ties a subscription to the key it was made with): people enable it again.
The older platform setting that generates a key pair (`platform-settings-branding-storage/vapid.service.ts`, TW-SET-038) is not read by the sender; the environment wins.

### Routes (`/v2/notifications/push`, staff only, pinned to the caller, no permission key)

| Route                       | What                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /public-key`           | `{ enabled, publicKey }`. `enabled: false` and `publicKey: null` when unconfigured (a 200, so browsers do not log 404s on every page load).                                                                                                                                                                                                                                                                          |
| `GET /subscriptions`        | `{ items: [{ id, label, createdAt, lastUsedAt }] }`: the caller's live devices only. Never the endpoint, the keys or the raw user agent. Empty when unconfigured.                                                                                                                                                                                                                                                    |
| `POST /subscriptions`       | Body is `PushSubscription.toJSON()` (`endpoint` https, `keys.p256dh`, `keys.auth`). Idempotent per (person, endpoint): the same browser again refreshes its keys, clears failures and returns the same device. 404 when unconfigured. Keeps at most **10** devices per person: the least recently used beyond that are deleted. The same endpoint is removed from other people of the workspace (a shared computer). |
| `DELETE /subscriptions/:id` | Removes one of the caller's own devices (204). Someone else's, or an unknown id, is 404, the same answer for both.                                                                                                                                                                                                                                                                                                   |
| `POST /test`                | The "Send a test notification" button. Writes ONE `test` bell row for the caller only (harmless type, group System, pop-up and ping on by default and tunable like any type, no push of its own) and announces it through the normal publisher (`notification.created` to the caller's `user` room only, no chat burst throttle), and sends a Web Push to every live device of the caller now, ignoring preferences and whether a tab is open. Returns `{ inApp, sent, failed }`: `inApp` is true when the row was written (false when the person or the owner turned the bell off for the test type), `sent` / `failed` count devices. One test per person every 10 seconds (429 `RATE_LIMITED`), which also bounds the bell rows. 404 when unconfigured (the card does not exist then). |

Contracts: `packages/contracts/src/notifications-activity-audit/web-push.ts`. Adding or removing a device is the person's own convenience setting (like marking a row read):
no audit row. The endpoint and keys are **secrets** (whoever holds them can push to that browser): stored in `push_subscriptions` for the sender, looked up by the sha256 of the
endpoint, never returned by any route, never logged, never put in the queue.

### The `push` preference

`notification_user_prefs` gains `push boolean` and `NOTIFICATION_CATALOG` a `push` default per type: **on** for `new_chat`, `new_message`, `chat_waiting`, `conversation_assigned`, `mention`,
`task_assigned`, `teamchat_mention`, `teamchat_message`; **off** for everything else (noisy ones: task due or completed, leads, forms, documents, wallet, devices,
broadcasts, campaigns, scheduled sends, WhatsApp groups). The same resolution as the other channels: the person's own setting, else the default. `GET`/`PUT /v2/notifications/preferences`
carry `push` in the item (`push`, `defaults.push`, `overrides.push`) and in the request. Push rides on the bell row like the toast: **no row, no push**, so a person whose
bell is off for a type (their own choice, or the owner's toggle when they never chose) gets no push for it, and the owner's toggle never overrides the person.

### Delivery (one hook, the same rules as the bell)

Every producer already ends in `NotificationPublisher.created(...)` after the row committed (directly, or through `NotificationFanout.publish`), so the push is one more leg there
and no consumer changed:

1. The publisher computes `silent` as before. A silent row (the second message of a burst inside the 5 s throttle window, a team-wide assignment) sends **no** push.
2. When the deployment is configured and the row's `push` is on (their own choice resolved when the row was written, else the catalogue default), it adds a job to the
   BullMQ queue `web-push` (own queue: a slow push service must not hold anything else). The job carries ids only (`{ orgId, userId, notificationUuid }`), `jobId = push-<org>-<row uuid>`
   (a redelivered event is the same job), 4 attempts with exponential backoff from 5 s. A queue failure is logged and swallowed: the outbox consumer is never blocked or failed by a push.
3. The worker (`web-push.processor.ts`, 8 at a time) runs `WebPushDeliveryService`: stop if unconfigured; **skip when the person has a visible tab** (below); skip if the row
   is gone or already read (read on another device meanwhile); skip with no live device; else build the payload and send to each device.
4. **Payload** (`push-payload.ts`, decision D4 of the spec): `title` = the contact name for `new_chat` / `new_message` (the row title otherwise), `body` = the kind of event
   ("New message", "3 new messages", "New chat") and **never the text of a message, note or team chat message** (an OS notification can show on a locked screen), at most 80
   characters per field, `tag` = `<subjectKind>:<subjectUuid>` so every message of one conversation replaces the previous notification (and the `Topic` header, a hash of the tag, does
   the same at the push service for a device that is offline), `url` = the row's link when it is a path on this site (else `/`), `silent: false`. English wording, like the bell's server fallback:
   a service worker cannot load the person's language files.
5. **Outcomes per device**: accepted -> `last_used_at = now`, failures reset. `404` / `410` -> **revoked** (`revoked_at`, never sent to again, not listed, pruned after 30 days). `401` / `403` (our keys no
   longer match the subscription) -> revoked. `429`, `5xx` or a network error -> the job fails and BullMQ retries it **narrowed to the devices that failed** (a phone that already got it does not get it
   twice; `Retry-After` is not read, the exponential backoff applies); after the last attempt the job is dropped quietly. Another `4xx` (for example `413`) counts a failure without revoking. Ten failures in a row revoke.
   Only subscription ids and HTTP statuses are ever logged.
6. The in-page desktop alert of a **background tab** is skipped on a device where browser push is enabled and on for the type (`pushCovers` in the live controller), so one event is not shown twice.

### Tab visibility (presence), kept simple

Each tab reports `{ visible }` over its socket with the client event `presence:visible`: on every visibility change, when the connection opens, and every 15 s while visible. The server
keeps a sorted set per person in Redis (`rt:vis:<org>:<user>`, member = socket id, score = when it lapses) with a 35 s lifetime; a hidden report, a disconnect or 35 s of silence removes
the tab (`VisibilityPresence`). `isVisible` is true when any tab is still in the set. It is a hint: Redis failures are swallowed, a failed write at worst sends a push that was not needed, a failed read
answers "not visible" so a push is never lost. The service worker also shows nothing while a tab of the CRM is visible (the one case a browser lets a push show nothing), except for the test notification.

### Table

`push_subscriptions` (migration `20261108090000_web_push_subscriptions`, forced RLS, composite `(org_id, id)` key, composite FK to `users (org_id, id)` with `ON DELETE CASCADE`): `uuid`, `user_id`
(required), `endpoint`, `endpoint_hash` (sha256 hex), `p256dh`, `auth`, `ua` (raw user agent cut to 300), `label` ("Chrome on Windows"), `last_used_at`, `last_error_at`, `failure_count`, `revoked_at`,
`channel` (kept from the Reference port, `team-inbox`). Unique `(org_id, user_id, endpoint_hash)`. The table was created empty by the Reference schema port; the migration reshapes it (owner required, per-person
endpoint, `last_notified_at` renamed `last_used_at`). A worker cron (`push-subscriptions-prune.service.ts`, daily 03:40) deletes devices revoked more than 30 days ago.

### Operations

Queue `web-push` (`QUEUES.WEB_PUSH`). A growing backlog means the push service is slow or down: jobs retry for about a minute and then drop, so a backlog drains by itself. Nothing in the app depends on a push being
delivered. See [runbooks/web-push.md](../runbooks/web-push.md).

## Waiting for a reply (BL-098): the nudge for unassigned chats

The rule "a later customer message on an unassigned chat tells nobody" stands (everyone who can answer was told at `new_chat`). The cost is that nobody owns the chat, so it can sit
unanswered. A worker sweep closes that gap: **one nudge per waiting episode** to the people who may read AND reply, through the same fan-out as every other event, so it is a bell row, a live
`notification.created` (toast) and, where the person's `push` is on, a browser push. Spec: [realtime-notifications.md](../specs/realtime-notifications.md) section 19.

| Type           | Source                                            | Who is told                                                                                                              | Row                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat_waiting` | `WaitingNudgeService` (worker cron, every minute) | everyone who may read AND reply to the unassigned chat (as for `new_chat`, decision D1), at most `NOTIFY_MAX_RECIPIENTS` | one per person and waiting episode, dedupe key `chat_waiting:<conversation>:<latest customer message>`; title "No one has answered <contact> yet", body the 80-character preview, link `/inbox?c=<conversation>`, subject `conversation` |

**A chat is nudged when all of these hold:** `status = 'open'`, not archived, not muted, no assignee (person, team or AI agent), not a group thread (`peer_key` starts `g:`), no human has
answered (`waiting_since` is set; only a human reply clears it, so an auto-reply or a bot does not count as an answer), nobody has read it since the customer wrote (`unread_count > 0`; the counter is
shared by all agents), the latest live customer message is at least `NOTIFY_WAITING_MINUTES` old (default **5**) and not older than `NOTIFY_WAITING_LOOKBACK_HOURS` (default 24, so switching the feature on never wakes an
old backlog), and no `chat_waiting` row exists for the chat since the wait began. A snoozed or closed chat is excluded by the status rule. Anyone who marked the chat read in the last minute (the open thread does
this, `ConversationReadState`) is skipped for this nudge.

**Once per episode.** An episode runs from `waiting_since` (the oldest unanswered customer message) until a human answers. More customer messages inside the same unanswered stretch do **not** nudge again; a new
customer message after an agent answered is a new episode with a new message id, so it nudges again. Repeated sweeps and two worker pods write one row: the unique `(org, user, dedupe_key)` index, with only the writer announcing.

**How the sweep runs** (`waiting-nudge.service.ts`, imported by `NotificationsWorkerModule` only; `@Cron` like the retention job, an overlapping run is skipped). Step 1 is one cross-tenant (privileged) indexed query
for the ids of qualifying chats, newest customer message first, at most `NOTIFY_WAITING_BATCH` (default 100) per sweep; chats already nudged in their wait are left out so they never use the cap. Step 2 is per
workspace under the tenant (RLS applies): one read of the candidates' current facts with the latest customer message in a LATERAL join (no query per chat), `waitingSkipReason` decides again (a chat assigned, answered or
read since step 1 is dropped), and `NotificationFanout.write` / `publish` write the rows and announce them. Cost per sweep with nothing to do: one index probe.

**Push.** The title is the contact's name and the body "Waiting for a reply", never the message text (`push-payload.ts`); the bell and toast may show the 80-character preview like `new_chat`. Defaults:
bell on (gated by the owner's `new_customer_reply` toggle like the other chat types), pop-up on, **sound off**, **push on**. A person can change each of them on Account, Notifications ("Chat still waiting for a reply", under Chats).

| Env                             | Default | Meaning                                                                                                                                                                                             |
| ------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NOTIFY_WAITING_MINUTES`        | `5`     | Minutes the latest customer message must have gone unanswered (1 to 1440). One value for all workspaces; a per-workspace setting was left out (a settings join in the sweep for no asked-for need). |
| `NOTIFY_WAITING_ENABLED`        | `true`  | Off switch of the nudge alone. It also needs `NOTIFY_CONVERSATIONS_ENABLED` (so it is off in production until that is set).                                                                         |
| `NOTIFY_WAITING_LOOKBACK_HOURS` | `24`    | Chats whose latest customer message is older are never nudged.                                                                                                                                      |
| `NOTIFY_WAITING_BATCH`          | `100`   | The most chats one sweep handles.                                                                                                                                                                   |

Migrations: `20261110090000_conversations_waiting_nudge_idx` (partial index `idx_conversations_waiting_nudge` on `conversations (last_inbound_at DESC)` for exactly the qualifying chats) and
`20261110090100_inbox_notifications_chat_waiting_idx` (partial index `idx_inbox_notifications_chat_waiting` on `(org_id, subject_uuid, created_at DESC) WHERE type = 'chat_waiting'`, the "already nudged in this wait" probe).
No new table. Opening the conversation marks its `chat_waiting` rows read like any conversation row (`read-subject`).

Known limits: a chat nobody can be told about (no one may reply, everyone has the bell off) is looked at again every minute until the lookback ends (cheap, and newest-first keeps it from starving fresh chats);
business hours are not considered; a chat assigned to someone who has not answered is not covered (an SLA, BL-004).

## Not built here

The full `/notifications` page, email and Slack delivery, mobile push (FCM), quiet hours / do-not-disturb, the workspace feed (`notifications` table, TW-NOTIF-001..004), resolved / deal / SLA rows (phase 3), a per-channel mute for team
chat.

## Notifications page (`/notifications`)

`GET /v2/notifications` also takes `type` (one type) and `q` (substring of title or text, `%` and `_` literal). `GET /v2/notifications/summary` returns `{unread, last24Hours, last7Days, total, byType}`. `DELETE /v2/notifications/:id` dismisses one of the caller's own rows (404 otherwise) and tells the person's other tabs; "Clear all" is the shell's `DELETE /v2/shell/notifications`. See [audit-log-tenant.md](../specs/audit-log-tenant.md) section 7.

## Why a test (or a real notification) can show only the tab title

The tab title follows the unread count, which is updated by the live socket AND, when the socket is not connected, by a one-minute poll and a refetch when the window regains focus. A pop-up needs the whole live chain: the socket
connected (a realtime address configured and reachable), the event not `silent` / `toast:false`, the person not looking at that conversation, the newest rows fetched (one retry, then the generic "You have a new notification"), the tab
visible (a hidden tab shows the pop-up when it comes back, folded into one if several), and the pacing (one per conversation per 3 s, three per 10 s, the rest one summary). The web app shows a quiet "Live updates are paused" note
in the bell panel and in the notification preferences when the socket has been down for more than a few seconds, and the test button's feedback says "Live updates are not connected on this page" instead of promising a pop-up.
