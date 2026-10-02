# Instagram channel API

Base path `/v2`. Inventory: [inventory/channel-instagram.md](../wadesk-port/inventory/channel-instagram.md). Every route needs a user
session and the permission shown. The channel runs through the Instagram engine (the Instaflow bridge) connected by an administrator
under Add-ons; while it is not connected the hub answers `bridge.connected = false` and the write routes answer 422 `IG_NOT_CONNECTED`.

## Accounts (WD-IG-001 to 006)

| Method and path                     | Permission           | What                                                                                                                                                                                                                                                    |
| ----------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /instagram/accounts`           | `ig.accounts.read`   | `{data: IgAccount[], bridge: {connected, brand, manageUrl}}`. Accounts by username; `manageUrl` is the engine's Instagram page, null when it is off.                                                                                                    |
| `GET /instagram/accounts/available` | `ig.accounts.manage` | `{data: [{id, username, name, avatar, connected}]}`: the person's accounts on the engine (matched by email) that are not linked here. Empty when the engine is off.                                                                                     |
| `POST /instagram/accounts`          | `ig.accounts.manage` | Body `{instaflowAccountId, username?, name?, avatar?, followers?}`. 200 the account: links, or refreshes one already linked (same id). 422 `IG_NOT_CONNECTED`; 404 `IG_ACCOUNT_NOT_FOUND` when the engine does not list it to this workspace or person. |
| `POST /instagram/connect/start`     | `ig.accounts.manage` | `{url}`: the engine's sign-in popup address (a one-time ticket). 422 `IG_NOT_CONNECTED`; 502 `IG_CONNECT_FAILED` with the engine's words.                                                                                                               |
| `DELETE /instagram/accounts/:id`    | `ig.accounts.manage` | 200 `{purgedThreads}`. Removes the link; with the last one, every Instagram thread of the workspace and its messages are deleted. 404 for an unknown or foreign id.                                                                                     |

`IgAccount`: `id` (uuid), `instaflowAccountId`, `username`, `name`, `avatar`, `status` (`connected`, `disconnected`), `followers`,
`syncedAt` (null shows as "live"), `createdAt`, `rowVersion`.

After the sign-in popup the engine tells the opener `wadesk:instagram-connected` with `account_id` (or sends a window with no opener
to `{WEB_APP_URL}/instagram?ig_account=<id>`); the client then calls `POST /instagram/accounts` with that id.

## Public route (WD-IG-007)

| Method and path           | Proof                       | What                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /instaflow/inbound` | header `X-Instaflow-Secret` | The engine's push. Body `{event: message\|status\|conversation, workspace_id, account?, conversation?, message?}`. 200 `{ok, message_id, conversation_id}` for a message, `{ok, received}` for the others; 401 `{ok:false, error:"unauthorized"}`; 422 `invalid payload` or `unknown workspace`; 500 `store_failed`. |

Give the engine `{APP_URL}/v2/instaflow/inbound` as its push address. `message`: `{id, from_me, type, text, media_url, buttons[{title,url?}], at, ig_trigger, is_test, is_backfill, trace_id}`; `conversation`: `{id, name, handle, avatar}`; `account`: `{id, username, name, avatar}`.
A message is stored once by its id (a push and a pull of the same message give one row). A test or history message is stored but makes no contact and runs no automation.

## Pull (WD-IG-009)

No route. A worker asks the engine every 20 seconds for each organization with a linked account (queue `ig-pull`, job id `ig-pull-<org>`): the threads of every linked account, then the messages of each thread with news, both directions. A pulled message older than 10 minutes is history (stored, never answered).
