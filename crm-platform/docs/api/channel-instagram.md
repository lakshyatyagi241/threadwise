# Instagram channel API

Base path `/v2`. Inventory: [inventory/channel-instagram.md](../threadwise-port/inventory/channel-instagram.md). Every route needs a user
session and the permission shown. The channel runs through the Instagram engine (the Instaflow bridge) connected by an administrator
under Add-ons; while it is not connected the hub answers `bridge.connected = false` and the write routes answer 422 `IG_NOT_CONNECTED`.

## Accounts (TW-IG-001 to 006)

| Method and path                     | Permission           | What                                                                                                                                                                                                                                                    |
| ----------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /instagram/accounts`           | `ig.accounts.read`   | `{data: IgAccount[], bridge: {connected, brand, manageUrl}}`. Accounts by username; `manageUrl` is the engine's Instagram page, null when it is off.                                                                                                    |
| `GET /instagram/accounts/available` | `ig.accounts.manage` | `{data: [{id, username, name, avatar, connected}]}`: the person's accounts on the engine (matched by email) that are not linked here. Empty when the engine is off.                                                                                     |
| `POST /instagram/accounts`          | `ig.accounts.manage` | Body `{instaflowAccountId, username?, name?, avatar?, followers?}`. 200 the account: links, or refreshes one already linked (same id). 422 `IG_NOT_CONNECTED`; 404 `IG_ACCOUNT_NOT_FOUND` when the engine does not list it to this workspace or person. |
| `POST /instagram/connect/start`     | `ig.accounts.manage` | `{url}`: the engine's sign-in popup address (a one-time ticket). 422 `IG_NOT_CONNECTED`; 502 `IG_CONNECT_FAILED` with the engine's words.                                                                                                               |
| `DELETE /instagram/accounts/:id`    | `ig.accounts.manage` | 200 `{purgedThreads}`. Removes the link; with the last one, every Instagram thread of the workspace and its messages are deleted. 404 for an unknown or foreign id.                                                                                     |

`IgAccount`: `id` (uuid), `instaflowAccountId`, `username`, `name`, `avatar`, `status` (`connected`, `disconnected`), `followers`,
`syncedAt` (null shows as "live"), `createdAt`, `rowVersion`.

After the sign-in popup the engine tells the opener `threadwise:instagram-connected` with `account_id` (or sends a window with no opener
to `{WEB_APP_URL}/instagram?ig_account=<id>`); the client then calls `POST /instagram/accounts` with that id.

## Public route (TW-IG-007)

| Method and path           | Proof                       | What                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /instaflow/inbound` | header `X-Instaflow-Secret` | The engine's push. Body `{event: message\|status\|conversation, workspace_id, account?, conversation?, message?}`. 200 `{ok, message_id, conversation_id}` for a message, `{ok, received}` for the others; 401 `{ok:false, error:"unauthorized"}`; 422 `invalid payload` or `unknown workspace`; 500 `store_failed`. |

Give the engine `{APP_URL}/v2/instaflow/inbound` as its push address. `message`: `{id, from_me, type, text, media_url, buttons[{title,url?}], at, ig_trigger, is_test, is_backfill, trace_id}`; `conversation`: `{id, name, handle, avatar}`; `account`: `{id, username, name, avatar}`.
A message is stored once by its id (a push and a pull of the same message give one row). A test or history message is stored but makes no contact and runs no automation.

## Pull (TW-IG-009)

No route. A worker asks the engine every 20 seconds for each organization with a linked account (queue `ig-pull`, job id `ig-pull-<org>`): the threads of every linked account, then the messages of each thread with news, both directions. A pulled message older than 10 minutes is history (stored, never answered).

## Flows (TW-IG-012)

| Method and path                              | Permission     | What                                                                                                                                                                                                        |
| -------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /instagram/flows`                       | `ig.flows.run` | `{flows: [{id, name}], authorUrl}`: the engine's flows for the linked accounts, each once; empty with no linked account or no engine.                                                                       |
| `POST /instagram/conversations/:id/run-flow` | `ig.flows.run` | Body `{flowId}` (a positive whole number). 200 `{ok: true}`. 404 unknown or foreign conversation; 422 `IG_NOT_AN_INSTAGRAM_THREAD`, `IG_THREAD_NO_ENGINE_ID`, `IG_NOT_CONNECTED`; 502 `IG_FLOW_RUN_FAILED`. |

## Replying (TW-IG-010)

Not a route: the team inbox calls `InstagramSenderService.reply({rawJid, text, media?, buttons?})` for a message whose provider is `instagram` and stores the returned `providerMessageId` on the row (so a later pull never shows our own send twice). It never throws; `{ok: false, error}` carries the reason in words ("IgDesk HTTP 400: ...").

## Reply-only sends (TW-IG-013, 014)

Instagram only lets an account message someone who already wrote to it, so recipients are existing threads. All three need `ig.broadcasts.manage`.

| Method and path                 | What                                                                                                                                                                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /instagram/compose`        | `{accounts: [{id, instaflowAccountId, handle}], threads: {<engine account id>: [{id, title, windowOpen}]}, templates: [{id, name, body, buttons}]}`. Connected accounts only (empty while the engine is off); up to 2000 threads per account, newest customer message first. |
| `POST /instagram/broadcasts`    | Body `{name, message (1 to 1000), threadIds (1 to 200)}`. `{name}` in the message becomes the person's name ("there" when unknown). 200 `{sent, failed, errors}`. 422 `IG_NOT_CONNECTED` when the engine is off.                                                             |
| `POST /instagram/composer/send` | Body `{body (1 to 4096), threadIds (1 to 200), templateId?}`. A template's body and buttons replace the typed text; an unknown template is ignored. 200 `{sent, failed, errors}`. 422 `IG_NOT_CONNECTED`.                                                                    |

`errors` holds up to five reasons, each cut to 120 characters ("IgDesk HTTP 400: Outside the 24 hour window"). A thread that is not the organization's or not an Instagram thread counts as failed. Every message that went is shown in its thread at once, with the engine's id so the pull does not show it again. Nothing is kept as a broadcast record.

## Quiet hours (BL-191)

`POST /v2/instagram/broadcasts` is marketing: a thread whose contact's local time is inside the workspace's quiet hours is held, not denied. The answer is `{ sent, failed, errors, held, heldUntil }` and a delayed job sends the held threads at the opening (the ConsentGate and the 24 hour window are asked again then). `POST /v2/instagram/composer/send` (a person answering in the inbox) is never held. See [compliance.md](compliance.md).
