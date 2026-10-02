# Facebook channel API

Base path `/v2`. Inventory: [inventory/channel-facebook.md](../wadesk-port/inventory/channel-facebook.md). Every route below the first
table needs a user session and the permission shown; the three public routes prove themselves (a signature, a sealed state).

## Pages (WD-FB-001 to 005)

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

## Module surface for other domains

`FacebookSenderService.reply(orgId, {rawJid, text, media})` returns `{ok, providerMessageId, error}` and never throws. The team inbox calls
it to answer a `channel = facebook` thread: `fb:<page>:<psid>` is a DM, `fb:<page>:post:<post>:<commenter>` is answered in public.

## Events (outbox)

`facebook.page.connected` (`uuid`, `pageId`, `name`, `reconnected`) and `facebook.page.disconnected` (`uuid`, `pageId`, `name`).

## Queues

`fb-backfill` (one job per connected Page), `fb-broadcast` (one job per broadcast run; F2).
