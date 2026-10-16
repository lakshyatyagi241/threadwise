# Viber channel API

Everything is under `/v2`, signed in as a user, with an `Idempotency-Key` header on every write. A channel is addressed by its uuid.
No response ever carries the auth token. Every route needs the plan feature `extra_channels`; the public webhook does not.

## Channels (TW-VIB-001, 002, 007)

| Method and path                          | Permission              | What it does                                                       |
| ---------------------------------------- | ----------------------- | ------------------------------------------------------------------ |
| `GET /viber/channels`                    | `viber.channels.read`   | The workspace's channels, oldest first.                            |
| `POST /viber/channels`                   | `viber.channels.manage` | Connect a Viber Public Account from its auth token. 201.           |
| `POST /viber/channels/:id/retry-webhook` | `viber.channels.manage` | Register the webhook again ("Re-hook").                            |
| `POST /viber/channels/:id/toggle`        | `viber.channels.manage` | Pause or resume the channel.                                       |
| `DELETE /viber/channels/:id`             | `viber.channels.manage` | Remove Viber's webhook, then the channel. Inbox threads stay. 204. |
| `GET /viber/insights?channel=&tz=`       | `viber.channels.read`   | Seven days of volume, active users and receipt counts.             |

A channel is `{ id, viberId, name, uri, avatar, active, connectedAt, lastInboundAt, lastError, webhookUrl, rowVersion }`. `webhookUrl` is
the address Viber pushes to, always https: `<APP_URL>/v2/viber/inbound/<routing token>`. `uri` is the account's address on viber.com.

### Connect

Body `{ authToken }`, at least 20 characters (else 422 `VALIDATION_FAILED`). Viber's `get_account_info` must accept it, else 422
`VIB_TOKEN_REJECTED` and nothing is saved. The channel is saved with the token encrypted. The same Viber account pasted again updates the
same row: its routing token is kept, the token replaced, `active` set true and the error cleared. Then `set_webhook` is called with our
address; when Viber refuses it the answer is still 201, the channel carries the reason in `lastError` and the answer's `webhookError` says
what to do (public HTTPS with a valid certificate). The answer is the channel plus `webhookError` (null when all went well). The inbox
gets a `viber` channel for it (one per Viber account, `external_id` = the channel's row id).

`retry-webhook` answers the same shape. `toggle` also switches the inbox channel on or off. Events:
`viber.channel.connected|disconnected` (outbox, with an audit row).

### Insights

`channels` (id, name) for a picker, `channelId` (the one asked for, else the oldest, null with none), `rows` (seven days, oldest first,
`{ date, in, out }`, a day with nothing is zeros), `totals` (`in`, `out`, `users`, `delivered`, `seen`, `failed`). Days are in the
viewer's zone (`tz`, UTC when absent or unknown). It is computed from the channel's messages; a system line is not a message.

## Inbound webhook (TW-VIB-003 to 006)

`POST /v2/viber/inbound/:token` is where Viber pushes (public, no sign-in, not in the API docs). `:token` is the channel's routing token (the
last part of its `webhookUrl`). Viber signs each delivery: header `X-Viber-Content-Signature`, the hex HMAC-SHA256 of the RAW body with the
channel's auth token, compared in constant time.

- Unknown token: 200 `{ "status": 0 }`, nothing happens.
- Wrong or missing signature: 403 `{ "status": 1, "status_message": "bad signature" }`, nothing is written.
- Viber's validation ping (`event: webhook`) and a paused channel: 200 `{ "status": 0 }`.
- Anything else answers 200 `{ "status": 0 }`, also when handling failed (logged, not retried). Only more than 240 requests a minute for one
  token answers 429.

The tenant is found with `vib_channel_lookup(token)`, a SECURITY DEFINER function that returns two ids and nothing else; everything after
runs under that organization.

What an event does:

1. **`message`**: stored in the inbox. The thread is the Viber user (`peer_key` = the Viber user id, case kept) on the channel's `viber` inbox
   channel; its title is the user's name. The sender is one contact per organization keyed by the Viber user id (source "Source: Viber", with
   the name and picture). The message token is the message's provider id: a redelivered event is stored once. Shown as Reference does: text,
   picture (caption), video, file (its name), location (coordinates), contact (name and number), sticker (`[sticker]`), anything else `[type]`.
   A file is downloaded (guarded to Viber's hosts) into storage; when it cannot be, the message is kept without it. Unread goes up, a resolved
   thread reopens.
2. **`subscribed`, `conversation_started`**: the thread and contact are created if they do not exist (so the user is in the broadcast audience),
   with one small system line "Subscribed to the Viber account" (the inbox holds no empty thread). Nothing is added for a thread that exists.
3. **`unsubscribed`**: acknowledged and logged; the inbox is not changed (as Reference).
4. **`delivered`, `seen`, `failed`**: a receipt on a message token and a user. If a broadcast recipient has that token and user, the recipient
   row is stamped (`delivered_at`, `seen_at`, or turned failed with Viber's reason) and the broadcast's counters follow; the mirrored copy in
   the thread gets the receipt too (ledger id `<token>:<user>`). Otherwise it is a reply sent from the inbox, whose ledger id is the token.

Flows, routing, the assigned AI agent and keyword replies run from the inbox's own hooks on every stored message; this module does not call
them.

## Replying in a thread (TW-VIB-008, 009)

Not an HTTP route: the inbox send pipeline calls the `viber` `ChannelAdapter` (registered in the adapter registry in the API and the worker),
which uses `ViberSenderService.reply`. It sends through the channel that carried the thread and returns the message token as the provider id.
No 24 hour window, no templates. A failure is a `ChannelError`: `CHANNEL_DISCONNECTED` (the channel is gone), `MEDIA_NOT_REACHABLE`
(a local-disk store has no address Viber can fetch), `CHANNEL_CAPABILITY_UNSUPPORTED` (a reaction, a location...), `VIBER_SEND_REJECTED`
with Viber's reason (status 6 reads "The Viber user must open a chat with you before you can message them.").

- Text goes as a text message (one space when empty). An image is a picture with the text as its caption; a video or a file is its own
  message with its real size, and the text, when there is some, goes first as a message of its own.
- A template's buttons are an inline keyboard (see Broadcasts).

## Broadcasts (TW-VIB-010 to 014)

Permissions: `viber.broadcasts.read` for the GETs, `viber.broadcasts.manage` for the rest. The audience is the threads a channel carries.

| Method and path                    | What it does                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /viber/channels/:id/users`    | The channel's users, newest 1000: `{ userId, title, lastMessageAt }`.                                    |
| `GET /viber/broadcasts/compose`    | `{ channels, templates }` for the compose page (Viber templates only).                                   |
| `GET /viber/broadcasts`            | The 50 newest broadcasts and `stats` (total, sent, failed, delivered, seen, audience, sending) over all. |
| `POST /viber/broadcasts`           | Draft: `{ name, channelId, templateId?, body?, userIds[], mediaUrl?, mediaSize? }`. 201. Frozen here.    |
| `POST /viber/broadcasts/:id/start` | Draft to sending and queues the `viber-broadcast` job. Already sending is returned as it is.             |
| `POST /viber/broadcasts/:id/pause` | Back to draft; unsent users stay pending; the job stops at its next batch.                               |
| `POST /viber/broadcasts/:id/retry` | Failed users back to pending; broadcast back to draft. `{ retried }`.                                    |
| `DELETE /viber/broadcasts/:id`     | Removes the broadcast and its recipients in any status. 204.                                             |

A broadcast is `{ id, name, channelId, channelName, templateId, status (draft, sending, done, failed), total, sent, failed, delivered, seen,
progress, hasMedia, lastError, startedAt, finishedAt, createdAt }`; `progress` is (sent + failed) of total.

Rules: forged user ids are dropped (422 `VIB_NO_RECIPIENTS` when none remain); a broadcast needs a message, a file or both (422
`VIB_BROADCAST_EMPTY`); the text is at most 7000 characters; `mediaUrl` must be an address of a jpg, jpeg, png, gif or mp4 file (422
otherwise), `mediaSize` at most 26 MB; an empty body takes the template's body and buttons. Start refuses a missing or paused channel (422
`VIB_CHANNEL_UNAVAILABLE`) and nobody pending (422 `VIB_NOTHING_TO_SEND`); retry refuses none failed (422 `VIB_NOTHING_TO_RETRY`) and a
running broadcast (409). Another workspace's broadcast or channel is 404. The body and buttons are stored encrypted and never returned.

Sending: one message object for the whole broadcast (a video with its size; a picture with the text as its caption; the text with the
template's buttons as an inline keyboard; plain text), sent in a single `broadcast_message` call per 300 users (`FOR UPDATE SKIP LOCKED`, about
half a second between calls). Viber's `failed_list` names the users it refused: they fail with its reason, everyone else is sent and gets the
call's message token on their row. A call Viber rejects as a whole fails every user of that batch and the broadcast (`lastError`). Each
sent copy is mirrored into the user's thread as an outbound message (`source: broadcast`). Counters are recomputed from the rows. Events:
`viber.broadcast.created|started|paused|retry_requested|deleted`.

## Quiet hours (BL-191)

Viber broadcasts are marketing, so a recipient whose contact's local time is inside the workspace's quiet hours (Compliance center) is held, not denied: the recipient stays `pending`, the rest of the audience is sent, the broadcast stays `sending`, and a delayed job takes the held recipients up at the first opening, asking the ConsentGate again. `GET` of the broadcast list returns `held` (how many wait) and `heldUntil` (the first instant one of them may be messaged) on each broadcast. See [compliance.md](compliance.md).

## Consent (BL-141 follow-up)

Every Viber recipient goes through the ConsentGate before a message is sent, on the first send and on a release from the quiet hours alike (purpose marketing, consent channel `viber`). A withdrawal (the **Unsubscribed** flag, or STOP on any channel) always refuses; with the workspace switch "Require recorded consent for marketing sends" off (the default) nobody else is refused; with it on a recorded grant on `viber` is needed (a recipient with no contact has none); a contact flagged as a minor is refused when the workspace's children setting says so. A reply typed in the inbox and a utility notice are service messages and are never held back by a marketing STOP. A refused user is left out of the batch's one `broadcast_message` call and recorded `failed` with `error` = `Not messaged: consent (<reason>)` (Viber's recipient statuses have no `blocked`); a retry asks the gate again.
