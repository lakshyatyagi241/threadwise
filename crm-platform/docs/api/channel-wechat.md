# WeChat channel API

Everything is under `/v2`, signed in as a user, with an `Idempotency-Key` header on every write, and behind the plan feature
`extra_channels`. A channel is addressed by its uuid. No response ever carries the AppSecret, the EncodingAESKey, the access token
or the Token (the Token is returned only by `server-config`, to people who manage the channel).

## Channels (TW-WECH-001, 002, 004)

| Method and path                          | Permission               | What it does                                                          |
| ---------------------------------------- | ------------------------ | --------------------------------------------------------------------- |
| `GET /wechat/channels`                   | `wechat.channels.read`   | The workspace's channels, oldest first.                               |
| `POST /wechat/channels`                  | `wechat.channels.manage` | Connect an Official Account from pasted credentials. 201.             |
| `GET /wechat/channels/:id/server-config` | `wechat.channels.manage` | `{ webhookUrl, verifyToken }`: what to paste into the WeChat console. |
| `POST /wechat/channels/:id/recheck`      | `wechat.channels.manage` | Ask WeChat for a new access token with the saved credentials.         |
| `POST /wechat/channels/:id/toggle`       | `wechat.channels.manage` | Pause or resume.                                                      |
| `DELETE /wechat/channels/:id`            | `wechat.channels.manage` | Remove the channel and its broadcasts; inbox threads stay. 204.       |

A channel is `{ id, appId, wxId, accountName, encMode, hasEncodingAesKey, active, connectedAt, lastInboundAt, lastError, webhookUrl, rowVersion }`.
`webhookUrl` is always https: `<APP_URL>/v2/wechat/inbound/<routing token>`.

### Connect

Body `{ appId, appSecret, verifyToken, encodingAesKey?, encMode?, accountName? }`. `appId` up to 64, `appSecret` and `verifyToken` up to 128,
`encodingAesKey` exactly 43 characters (a blank one is no key), `encMode` is `plain`, `compat` (default) or `safe` (safe needs the key),
`accountName` up to 191 (default `WeChat`). Anything else is 422 `VALIDATION_FAILED`.

WeChat must give an access token for the AppID and AppSecret, else 422 `WECH_CREDENTIALS_REJECTED` with WeChat's reason, and nothing
is saved. The AppSecret, the Token, the EncodingAESKey and the fetched access token (with its expiry) are saved encrypted. The same
AppID pasted again updates the same row: its routing token (and so the address pasted into WeChat) stays, it becomes active and its
error clears. The channel is mirrored into the inbox as a `wechat` channel (one per channel row). Events:
`wechat.channel.connected { uuid, appId, reconnected }`.

### Manage

- Re-check returns `{ channel, checkError }`; `checkError` is WeChat's reason (kept as the channel's `lastError`) or null.
- Toggle: a paused channel still answers the URL check but ignores messages, cannot send and cannot start a broadcast.
- Remove: audited; event `wechat.channel.disconnected { uuid, appId }`. Another workspace's channel answers 404 for every action.

## Webhook (TW-WECH-005, 006, 007, 008)

`GET` and `POST /v2/wechat/inbound/:token`, public, throttled to 240 requests a minute per address (429). The tenant is found by the
SECURITY DEFINER function `wech_channel_lookup(token)`. Every request is signed with `signature` = sha1 of the sorted Token, `timestamp` and `nonce`.

- `GET`: valid signature, answers `echostr` as plain text. Safe mode with `msg_signature`: the encrypted `echostr` is checked and answered decrypted. A bad signature is a bare 403. An unknown address answers `success`.
- `POST`: body is XML (read as text, 256 KiB cap). Bad signature: 403. Unknown address or paused channel: `success`, nothing stored. In safe mode `<Encrypt>` needs a valid `msg_signature` and is decrypted with the EncodingAESKey and the AppID checked.
- The answer to an accepted POST is always `success` (plain text): no passive reply.
- Stored: text, image, voice (its speech text), video, short video, location, link, other types as `[type]` (an unsupported message), the follow event (no text) and a custom-menu tap (its key as text). The unfollow and every other event are acknowledged only. A redelivery (same `MsgId`, or same event, user and time) is stored once. The follower becomes a contact keyed by OpenID; the nickname and photo are learnt afterwards when WeChat shares them.

## Sending from the inbox (TW-WECH-009, 010)

The `wechat` channel adapter sends a customer-service message within 48 hours of the follower's last message; the dispatcher refuses a
free-form message outside it (`SERVICE_WINDOW_CLOSED`). A template envelope goes through WeChat's template API (name = WeChat template id,
variables = keywords, `url` = link). Text is cut to 2048 characters; image, audio (voice) and video files up to 10 MB are uploaded as
temporary media, the caption first as its own text message. WeChat's refusals become `WECHAT_WINDOW_CLOSED` (45015, 45047),
`WECHAT_NOT_FOLLOWING` (43004, 40003) or `WECHAT_SEND_REJECTED` (retryable only for -1, "system busy").

## Broadcasts (TW-WECH-011 to 015)

| Method and path                     | Permission                 | What it does                                        |
| ----------------------------------- | -------------------------- | --------------------------------------------------- |
| `GET /wechat/channels/:id/chats`    | `wechat.broadcasts.read`   | The followers the channel carries (newest 1000).    |
| `GET /wechat/broadcasts/compose`    | `wechat.broadcasts.read`   | Channels and WeChat templates for the compose page. |
| `GET /wechat/broadcasts`            | `wechat.broadcasts.read`   | The 50 newest broadcasts.                           |
| `POST /wechat/broadcasts`           | `wechat.broadcasts.manage` | Save a draft. 201.                                  |
| `POST /wechat/broadcasts/:id/start` | `wechat.broadcasts.manage` | Send: queue the mass-send job.                      |
| `POST /wechat/broadcasts/:id/retry` | `wechat.broadcasts.manage` | Send again after a failure.                         |
| `DELETE /wechat/broadcasts/:id`     | `wechat.broadcasts.manage` | Delete, in any status. 204.                         |

Create body: `{ name, channelId, templateId?, body, audience, tagId?, openids? }`. `name` up to 191, `body` 1 to 2000 characters of plain text,
`audience` is `all`, `tag` (needs `tagId`, 1 to 10 digits, `0` allowed) or `list` (`openids`, at most 1000). For `list` only OpenIDs
the channel really carries are kept, repeated ones once; fewer than two is 422 `WECH_TOO_FEW_RECIPIENTS`. `all` and `tag` keep no
recipients and total 0. The text is encrypted at rest and never returned. A broadcast is
`{ id, name, channelId, channelName, audience, tagId, massMsgId, status, total, sent, failed, lastError, canRetry, startedAt, finishedAt, createdAt }`
with `status` `draft`, `sending`, `done` or `failed`.

**One call.** Start (and retry) move the broadcast to `sending` and queue a job on `wechat-broadcast` (one attempt). The job calls WeChat
once: `mass/sendall` for all followers (`is_to_all`) or a tag, `mass/send` for the picked OpenIDs, with the broadcast's uuid as
`clientmsgid` so the same broadcast cannot be sent twice. Accepted: `done`, `massMsgId`, `sent = total`, and for a list the recipients are
`sent` and the text is copied into each thread. Refused: `failed` with WeChat's reason (255 characters), recipients stay pending, Send or
Retry tries again. Errors: 409 `WECH_ALREADY_SENT` for a `done` broadcast, 422 `WECH_CHANNEL_UNAVAILABLE` for a missing or paused channel
(the broadcast stays as it was), 409 `WECH_NOT_RETRYABLE` when Retry is asked for a draft or a broadcast that is still sending (a send
stuck for 15 minutes counts as failed and can be retried). Events: `wechat.broadcast.created|started|retry_requested|deleted`.

There is no pause: a mass send cannot be taken back once WeChat has it. WeChat allows a Service Account about four mass sends a month;
the app does not count or block them.

Not enforced: the plan flags `access_wechat`, `wechat_broadcasts` and `wechat_channels_limit` and the platform switch `wechat_enabled`
(one plan feature, `extra_channels`, gates all of it).
