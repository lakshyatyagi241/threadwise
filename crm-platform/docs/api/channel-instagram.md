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
