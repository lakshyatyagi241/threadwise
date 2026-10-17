# Facebook channel API

Base path `/v2`. Inventory: [inventory/channel-facebook.md](../threadwise-port/inventory/channel-facebook.md). Every route below the first
table needs a user session and the permission shown; the three public routes prove themselves (a signature, a sealed state).

## Pages (TW-FB-001 to 005)

| Method and path                        | Permission        | What                                                                                                                            |
| -------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GET /facebook/config`                 | `fb.pages.read`   | `{configured, appId, configId, graphVersion, webhookUrl}`: what the hub needs. The app id is public; no secret is returned.     |
| `GET /facebook/pages`                  | `fb.pages.read`   | `{data: FacebookPage[]}`, never a token.                                                                                        |
| `POST /facebook/connect/start`         | `fb.pages.manage` | `{url}`: the Facebook login dialog. 422 `FB_NOT_CONFIGURED` when no Meta app is set.                                            |
| `POST /facebook/connect/embedded`      | `fb.pages.manage` | Body `{code}`: the popup's code. 201 `{pages, message}`. 422 `FB_CODE_REJECTED`, `FB_NO_PAGES`, `FB_NOT_CONFIGURED`.            |
| `POST /facebook/connect/manual`        | `fb.pages.manage` | Body `{pageAccessToken}` (20 to 1000 characters). 201 `{pages, message}`. 422 `FB_TOKEN_NOT_A_PAGE`.                            |
| `POST /facebook/pages/:id/refresh`     | `fb.pages.manage` | Re-reads name, picture, followers. 422 `FB_REFRESH_FAILED` when Meta does not answer; a revoked token flags the Page `expired`. |
| `POST /facebook/pages/:id/resubscribe` | `fb.pages.manage` | "Fix inbound". 200 with the Page and `error` (null on success, "Re-subscribe failed: ..." otherwise).                           |
| `DELETE /facebook/pages/:id`           | `fb.pages.manage` | 204. Unsubscribes (errors ignored) and removes the Page; inbox threads stay.                                                    |

`FacebookPage`: `id` (uuid), `pageId`, `name`, `category`, `username`, `pictureUrl`, `fanCount`, `status` (`connected`, `disconnected`,
`expired`, `error`), `connectMethod` (`oauth`, `embedded`, `manual`), `lastError`, `dataAccessExpiresAt`, `tasks`, `createdAt`, `rowVersion`.

## Public routes

| Method and path          | Proof                           | What                                                                                                                                     |
| ------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /facebook/webhook`  | the verify token                | Meta's handshake: echoes `hub.challenge` as text for `hub.mode=subscribe` with the right token, else 403.                                |
| `POST /facebook/webhook` | `X-Hub-Signature-256`           | Messages, taps and feed comments. 403 on a bad signature when a secret is configured; otherwise always 200 (Meta retries anything else). |
| `GET /facebook/callback` | the sealed `state` from `start` | Where the login dialog returns. 303 to `{WEB_APP_URL}/facebook?fb=connected\|error&message=...`.                                         |

## Broadcasts (TW-FB-012 to 014)

| Method and path                       | Permission             | What                                                                                                                                                     |
| ------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /facebook/broadcasts/compose`    | `fb.broadcasts.read`   | `{pages: [{id, pageId, name, audience: [{psid, title, lastInboundAt}]}], templates}`: each connected Page with who it can message right now.             |
| `GET /facebook/broadcasts`            | `fb.broadcasts.read`   | `{data: FbBroadcast[], stats}`: the 50 newest, with totals over all of them.                                                                             |
| `POST /facebook/broadcasts`           | `fb.broadcasts.manage` | Body `{name, pageId, templateId?, body?, psids[]}`. 201 a draft with a frozen list. 422 `FB_PAGE_UNAVAILABLE`, `FB_BROADCAST_EMPTY`, `FB_NO_RECIPIENTS`. |
| `POST /facebook/broadcasts/:id/start` | `fb.broadcasts.manage` | Draft to sending; a worker job sends it. 422 `FB_PAGE_UNAVAILABLE`, `FB_NOTHING_TO_SEND`. Already sending is returned as it is.                          |
| `POST /facebook/broadcasts/:id/pause` | `fb.broadcasts.manage` | Back to draft; unsent people stay pending and the running job stops at its next batch.                                                                   |
| `POST /facebook/broadcasts/:id/retry` | `fb.broadcasts.manage` | `{retried}`: failed people back to pending (blocked stay). 422 `FB_NOTHING_TO_RETRY`; 409 while sending.                                                 |
| `DELETE /facebook/broadcasts/:id`     | `fb.broadcasts.manage` | 204. Any status; recipients go with it.                                                                                                                  |

`FbBroadcast`: `id`, `name`, `pageId`, `pageName`, `templateId`, `status` (`draft`, `sending`, `done`, `failed`), `total`, `sent`, `failed`,
`blocked`, `progress` (whole percent, blocked counts as done), `lastError`, `startedAt`, `finishedAt`, `createdAt`. A person is `blocked`
when Meta says they cannot be reached (outside the 24 hour window, unavailable, invalid id, policy) and the window is checked again at the
moment of each send.

Events: `facebook.broadcast.created`, `.started`, `.paused`, `.retry_requested`, `.deleted`.

## Messenger setup (TW-FB-015)

Needs `fb.setup.manage` for every route. Each save goes straight to Meta; nothing is stored here. A write answers `200 {message}`
("Greeting saved.", "Persistent menu removed." ...). 422 `FB_PAGE_UNAVAILABLE` for a Page that is not connected; 422 `FB_SETUP_REJECTED` with
"Facebook rejected the change: <Meta's reason>"; 422 `FB_SETUP_UNSUPPORTED` when the Graph version no longer has the welcome greeting.

| Method and path                               | What                                                                                                                                                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /facebook/setup?page=<uuid>`             | `{pages, page, getStarted, greeting, menu: {items, composerInputDisabled}, iceBreakers}`: the connected Pages and the picked one's live profile.                                                         |
| `PUT /facebook/setup/:pageId/get-started`     | Body `{payload}`; a blank payload removes the button.                                                                                                                                                    |
| `DELETE /facebook/setup/:pageId/get-started`  | Remove it.                                                                                                                                                                                               |
| `PUT /facebook/setup/:pageId/greeting`        | Body `{greeting}`; cut to 160 characters; blank removes it. Retried once on `FB_GREETING_GRAPH_VERSION` when Meta has dropped the field.                                                                 |
| `DELETE /facebook/setup/:pageId/greeting`     | Remove it. A version that no longer stores a greeting counts as removed.                                                                                                                                 |
| `PUT /facebook/setup/:pageId/menu`            | Body `{items: [{title, type: web_url\|postback, url, payload}], composerInputDisabled}`; at most three items; a Get Started button is created first when there is none; no usable item removes the menu. |
| `DELETE /facebook/setup/:pageId/menu`         | Remove it.                                                                                                                                                                                               |
| `PUT /facebook/setup/:pageId/ice-breakers`    | Body `{items: [{question, payload}]}`; at most four; none removes them all.                                                                                                                              |
| `DELETE /facebook/setup/:pageId/ice-breakers` | Remove all.                                                                                                                                                                                              |

## Posts (TW-FB-016 to 018)

| Method and path                      | Permission        | What                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /facebook/posts`                | `fb.posts.read`   | Query `status`, `type`, `range` (7d, 30d, 90d), `q`, `account` (a Page id), `page`. `{data, counts, typeCounts, meta, pages}`: 15 a page; scheduled first, then failed or draft, then the rest. `counts` and `typeCounts` ignore every filter but the Page; `failed` includes drafts.                                                                                        |
| `POST /facebook/posts`               | `fb.posts.manage` | Body `{pageId, message?, link?, photoUrls?, videoUrl?, asReel?, scheduledAt?}`. 201 the post. 422 `FB_PAGE_UNAVAILABLE`, `FB_POST_INVALID` (nothing in it, photos with a link, a video address that is not HTTPS), `FB_SCHEDULE_INVALID` (10 minutes to 75 days ahead). Saved before Meta is called; a refusal by Meta is a 201 whose post has `status: failed` and `error`. |
| `POST /facebook/posts/:id/publish`   | `fb.posts.manage` | Retry a draft or failed post now. 409 `FB_POST_INVALID` when it is already published or scheduled.                                                                                                                                                                                                                                                                           |
| `DELETE /facebook/posts/:id`         | `fb.posts.manage` | 204. A post with a Meta id is deleted there first (a failure there is ignored), then here.                                                                                                                                                                                                                                                                                   |
| `GET /facebook/my-posts?page=<uuid>` | `fb.posts.read`   | `{pages, page, items}`: the Page's 50 newest published posts, live. Nothing stored; Meta not answering is an empty list.                                                                                                                                                                                                                                                     |

`FbPost`: `id`, `pageId`, `pageName`, `type` (`text`, `link`, `photo`, `multi_photo`, `video`, `reel`), `status` (`draft`, `scheduled`, `published`,
`failed`), `message`, `link`, `photos`, `video`, `fbPostId`, `scheduledPublishTime`, `publishedAt`, `error`, `createdAt`. Events: `facebook.post.published`,
`.scheduled`, `.failed`, `.deleted`.

## Insights (TW-FB-019)

`GET /facebook/insights?page=<uuid>&tz=<IANA zone>`, permission `fb.insights.read`. `{pages, page, identity, followers, kpis, local, trend, contentMix,
convoMix, posts}`: the live identity and 28 day metrics from Meta (a metric Meta no longer has is absent from `kpis`), what this system knows
(`local`: threads, open threads, messages in and out over 28 days, posts), a 14 day message trend (`days` are `YYYY-MM-DD` in `tz`, UTC when absent or
unknown), the posts made here by type, threads by status, and up to six recent posts (live with their numbers, else this system's own).

## Module surface for other domains

`FacebookSenderService.reply(orgId, {rawJid, text, media})` returns `{ok, providerMessageId, error}` and never throws. The team inbox calls
it to answer a `channel = facebook` thread: `fb:<page>:<psid>` is a DM, `fb:<page>:post:<post>:<commenter>` is answered in public.

## Events (outbox)

`facebook.page.connected` (`uuid`, `pageId`, `name`, `reconnected`) and `facebook.page.disconnected` (`uuid`, `pageId`, `name`).

## Queues

`fb-backfill` (one job per connected Page), `fb-broadcast` (one job per broadcast run).

## Quiet hours (BL-191)

Messenger broadcasts are marketing, so a recipient whose contact's local time is inside the workspace's quiet hours (Compliance center) is held, not denied: the recipient stays `pending`, the rest of the audience is sent, the broadcast stays `sending`, and a delayed job takes the held recipients up at the first opening, asking the ConsentGate again. `GET` of the broadcast list returns `held` (how many wait) and `heldUntil` (the first instant one of them may be messaged) on each broadcast. See [compliance.md](compliance.md).

## Consent (BL-141 follow-up)

Every Messenger recipient goes through the ConsentGate before a message is sent, on the first send and on a release from the quiet hours alike (purpose marketing, consent channel `facebook`). A withdrawal (the **Unsubscribed** flag, or STOP on any channel) always refuses; with the workspace switch "Require recorded consent for marketing sends" off (the default) nobody else is refused; with it on a recorded grant on `facebook` is needed (a recipient with no contact has none); a contact flagged as a minor is refused when the workspace's children setting says so. A reply typed in the inbox and a utility notice are service messages and are never held back by a marketing STOP. A refused person is `blocked` with `error` = `Not messaged: consent (<reason>)`; the check comes before the 24 hour window check, which still applies to everyone who passes. A broadcast is marketing even inside the 24 hour window.
