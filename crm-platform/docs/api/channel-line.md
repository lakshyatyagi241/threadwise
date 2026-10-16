# LINE channel API

Everything is under `/v2`, signed in as a user, with an `Idempotency-Key` header on every POST (the `PUT` and `DELETE` need none). A channel
is addressed by its uuid. No response ever carries a channel access token, a channel secret, a rotation key or a rotated token. Every
route needs the plan feature `extra_channels` and the permission named below; another workspace's channel or broadcast is 404.

## Channels

| Method and path                         | Permission             | What it does                                                          |
| --------------------------------------- | ---------------------- | --------------------------------------------------------------------- |
| `GET /line/channels`                    | `line.channels.read`   | The workspace's channels, oldest first.                               |
| `POST /line/channels`                   | `line.channels.manage` | Connect a channel from a pasted channel access token and secret. 201. |
| `POST /line/channels/:id/retry-webhook` | `line.channels.manage` | Register the webhook again ("Re-hook").                               |
| `POST /line/channels/:id/toggle`        | `line.channels.manage` | Pause or enable the channel.                                          |
| `PUT /line/channels/:id/rotation`       | `line.channels.manage` | Turn token rotation on, or off with blank fields.                     |
| `DELETE /line/channels/:id`             | `line.channels.manage` | Remove the channel and its broadcasts. Inbox threads stay. 204.       |

A channel is `{ id, lineChannelId, basicId, displayName, pictureUrl, active, connectedAt, lastInboundAt, lastError, assertionKid,
rotationEnabled, rotationExpiresAt, webhookUrl, rowVersion }`. `webhookUrl` is the address LINE pushes to, always https:
`<APP_URL>/v2/line/inbound/<routing token>`.

### Connect

Body `{ channelAccessToken, channelSecret }`; the token must be 20 to 1000 characters and the secret 16 to 255, else 422
`VALIDATION_FAILED`. LINE's bot info must accept the token, else 422 `LINE_TOKEN_REJECTED` and nothing is saved. The channel is saved
with the token and the secret encrypted. The same Official Account (matched on its LINE basic id) pasted again updates the same row: its
routing token stays, it becomes active and its error clears. The webhook is registered after the row exists. If LINE refuses it the
channel stays saved with `lastError`, and the response carries `webhookError` (public HTTPS needed, use a tunnel locally). The channel
is mirrored into the inbox as a `line` channel. Events: `line.channel.connected { uuid, basicId, reconnected }`.

### Manage

- Re-hook returns the channel plus `webhookError` (null on success, which clears the error). It uses the rotated token when rotation is on.
- Toggle: a paused channel still receives pushes but ignores them (200) and cannot start a broadcast; its inbox channel is switched off.
- Disconnect: LINE has no call to delete a webhook endpoint, so none is made. Event `line.channel.disconnected { uuid, basicId }`.

### Token rotation

`PUT /line/channels/:id/rotation` with `{ assertionKid?, assertionPrivateKey?, channelId? }`.

- A blank key id or key turns rotation off: the saved key, token and expiry are cleared and sends use the pasted token.
- Otherwise the key is saved encrypted and the first v2.1 token is minted at once. `channelId` is the numeric Channel ID of the LINE console;
  it is needed once, when the channel only has the bot user id LINE reported on connect (Reference signed with that id, which LINE refuses).
  Without one, or when the key does not sign, or LINE refuses the assertion: 422 `LINE_ROTATION_FAILED` with the reason. A key that
  could not mint stays saved, with the reason on the channel, and sends keep using the pasted token.
- Every send and every LINE call of the channel asks for the active token: the cached rotated token while it has more than a day left,
  else a new one is minted on the spot, with the same fallback.

## Inbound webhook

`POST /v2/line/inbound/:token` is where LINE pushes (public, no sign-in, not in the API docs). `:token` is the channel's routing token
(the last part of its `webhookUrl`). `X-Line-Signature` must be the base64 HMAC-SHA256 of the **raw body** keyed by the channel secret,
compared in constant time.

- Unknown token: 200 `{ ok: true, note: 'unknown channel' }`. Missing or wrong signature: 401 `{ ok: false, error: 'bad signature' }`
  (Reference's answer; LINE's console "Verify" sends a signed delivery with no events and gets 200). Paused channel: 200 `channel disabled`.
  Only more than 240 requests a minute for one token answers 429.
- The tenant is found with `line_channel_lookup(token)`, a SECURITY DEFINER function that returns two ids and nothing else.
- Every event is handled on its own; one failing never stops the others and the answer stays 200 `ok`. A verified delivery marks the
  channel alive (`lastInboundAt`, error cleared).

What an event does:

1. **Message** (text, image, video, audio, file, location, sticker, anything else `[message]`) and **postback** (its data is replayed as
   a typed message, so keywords and flows fire as for typed text) are written into the inbox. Everything else (follow, unfollow, join,
   leave, ...) is acknowledged and ignored, as in Reference.
2. A channel is a chat channel of kind `line` (one `channels` row per connected account, `external_id` = the channel's row id) and each
   LINE user is the peer (`peer_key` = the user id, case kept) of one thread on it. A group or room is a thread of its own, keyed by its id.
   The message goes through the shared inbound pipeline: a redelivered event is stored once (ledger key = LINE's message id, or
   `pb:<webhook event id>` for a postback), with unread, reopen and realtime.
3. A 1:1 sender becomes one contact per organization keyed by the LINE user id, named from the LINE profile (asked once, until the
   person is a contact), source "Source: LINE", with their profile picture address. A group or room has no contact.
4. A file is downloaded from LINE with the channel's token by the inbox's channel adapter and copied into the inbox store; when it
   cannot be fetched the message is stored without it.
5. The event's reply token and when it was taken are kept on the message (`meta.line`) for the free reply path.
6. Then automation: a flow first (1:1 chats only), and when no flow consumed it routing, the assigned AI agent or a keyword reply. These are stand-ins until their owners export them (see the parity file).

## Replying in a thread

Not an HTTP route: the team inbox's `ChannelAdapterRegistry` calls the `line` adapter, which sends through `LineSenderService.reply(orgId, { channelRowId, to, text, media? })`
(exported from `modules/channel-line`). It sends from the channel that carried the thread and returns `{ ok, providerMessageId, error, status }`;
it never throws. A removed channel is `LINE channel not connected`.

- The free reply path is used when the latest message of that person carries a reply token less than 55 seconds old; the token is
  single use and cleared when taken. Otherwise, or when LINE refuses the token, the reply is a push (billable).
- Text is cut to 5000 characters, at most five message objects per send. A file is a URL-based image, video or audio message (an https address
  LINE fetches itself, a signed link of the cloud bucket that lives a week), the caption first as text; other kinds go as a link in text.
  Local-disk storage has no public address, so a file reply fails with `MEDIA_NOT_REACHABLE`.
- No 24-hour window and no templates. A LINE refusal is `LINE_SEND_REJECTED` (retryable only for a 429).

## Broadcasts

Permissions: `line.broadcasts.read` for the GETs, `line.broadcasts.manage` for the rest. An Official Account can only message friends,
so the audience is the direct threads (LINE user ids that start with `U`) the channel already carries.

| Method and path                   | What it does                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /line/channels/:id/audience` | The channel's direct users, newest 500: `{ userId, title, lastMessageAt, unread }`.                      |
| `GET /line/broadcasts/compose`    | `{ channels, templates }` for the compose page (LINE templates only).                                    |
| `GET /line/broadcasts`            | The 50 newest broadcasts and `stats` (total, sent, failed, blocked, audience, sending) over all of them. |
| `POST /line/broadcasts`           | Draft: `{ name, channelId, templateId?, body?, userIds[], mediaUrl? }`. 201. Recipients are frozen here. |
| `POST /line/broadcasts/:id/start` | Draft to sending and queues the `line-broadcast` job. Already sending is returned as it is.              |
| `POST /line/broadcasts/:id/pause` | Back to draft; unsent people stay pending; the job stops at its next batch.                              |
| `POST /line/broadcasts/:id/retry` | Failed people back to pending (blocked stay blocked); broadcast back to draft. `{ retried }`.            |
| `DELETE /line/broadcasts/:id`     | Removes the broadcast and its recipients in any status. 204.                                             |

Rules: forged user ids are dropped (422 `LINE_NO_RECIPIENTS` when none remain); a broadcast needs a message, a file or both (422
`LINE_BROADCAST_EMPTY`); an empty body takes the template's body and buttons; `{{name}}` and `{name}` become the person's LINE name.
Start refuses a missing or paused channel (422 `LINE_CHANNEL_UNAVAILABLE`) and nobody pending (422 `LINE_NOTHING_TO_SEND`); retry
refuses none failed (422 `LINE_NOTHING_TO_RETRY`) and a running broadcast (409). The attachment is a public address or a file uploaded through `POST /v2/media/marketing`; its kind comes from the
extension (mp4, mov video; m4a, mp3 audio; anything else image).

Sending: the worker claims 40 pending people at a time (`FOR UPDATE SKIP LOCKED`) and pushes one by one 50 ms apart, one push per
person with up to five message objects (the media bubble first, then the text, or the template as a buttons card or quick replies),
writes each outcome at once and recomputes the counters from the rows. Each batch first asks the ConsentGate (marketing, channel
`line`); a contact who withdrew is `blocked` with a reason and is not messaged. Refusals that mean the person cannot be reached
(blocked, not a friend, invalid user, forbidden, not found, no longer, cannot send messages) mark the person `blocked`, any other `failed`.
A sent message is copied into the person's thread as an outbound message (`source: broadcast`). Events:
`line.broadcast.created|started|paused|retry_requested|deleted`.

## Quiet hours (BL-191)

LINE broadcasts are marketing, so a recipient whose contact's local time is inside the workspace's quiet hours (Compliance center) is held, not denied: the recipient stays `pending`, the rest of the audience is sent, the broadcast stays `sending`, and a delayed job takes the held recipients up at the first opening, asking the ConsentGate again. `GET` of the broadcast list returns `held` (how many wait) and `heldUntil` (the first instant one of them may be messaged) on each broadcast. See [compliance.md](compliance.md).

## Consent (BL-141 follow-up)

Every LINE recipient goes through the ConsentGate before a message is sent, on the first send and on a release from the quiet hours alike (purpose marketing, consent channel `line`). A withdrawal (the **Unsubscribed** flag, or STOP on any channel) always refuses; with the workspace switch "Require recorded consent for marketing sends" off (the default) nobody else is refused; with it on a recorded grant on `line` is needed (a recipient with no contact has none); a contact flagged as a minor is refused when the workspace's children setting says so. A reply typed in the inbox and a utility notice are service messages and are never held back by a marketing STOP. A refused person is `blocked` with `error` = `Not messaged: consent (<reason>)`; a person with no contact is asked as an anonymous subject (allowed with the switch off).
