---
domain: channel-instagram
code: IG
title: Instagram channel (Instaflow bridge: link accounts, inbox ingest, reply, reply-only broadcast)
threadwise_version: '1.7.0'
sources_read: 16
---

# Instagram channel

## Overview

Reference never talks to Meta for Instagram. A separate product (Instaflow, branded `IgDesk` by default, called InstaMagic in the docs)
owns the Instagram login, the webhooks and the Graph calls. Reference and Instaflow share one secret (header `X-Instaflow-Secret`).
Reference calls Instaflow under `{url}/api/threadwise/*` and Instaflow pushes new messages to `POST /api/instaflow/inbound`. A workspace
**links** an Instaflow account: a mirror row (`workspace_ig_accounts`) holds the account id and a cached profile. Messages become
`channel = instagram` conversations in the team inbox (`raw_jid = ig:<instaflowConversationId>`), the sender becomes a contact keyed
by the IG sender id, and the inbox replies through the bridge. Reference also **pulls** conversations on inbox polling, because a private
Reference cannot be reached by a push. Instagram is reply-only: only people who have already messaged the account can be messaged.

The docs also describe a native Instagram add-on (`addon/instagram/`, setting `instagram_enabled`, routes `/instagram/*`, an
`InstagramAccount` model, `IgFlowBridge`, the embedded Meta login). **That add-on is not in the reference** (only its documentation, a
template seeder and two node flow files), so it cannot be read or ported; it is recorded as TW-IG-020 (blocked).

Admin connect and disconnect of the bridge (URL, secret, brand, handshake, one-engine rule) are TW-ADD-017, 018 and 021 in
`addons-extension-registry`; this domain reads the settings they save.

Connects to: addons-extension-registry (bridge settings), chat-conversations (threads, replies, 24h window, composer), contacts
(contact per sender), broadcasts (TW-BCAST-019), message-templates (Instagram templates), flow-builder-editor and
flow-runtime-engine (flows of type `instagram`), auto-reply-keywords (Instagram triggers), plans-subscriptions-trials (`access_instagram`).

## Feature index

| Id        | Feature                                                                      | Status    | Priority | Effort | Depends on                  |
| --------- | ---------------------------------------------------------------------------- | --------- | -------- | ------ | --------------------------- |
| TW-IG-001 | Instagram hub: linked accounts, status, refresh, unlink, manage link         | pending   | P0       | M      | TW-IG-004                   |
| TW-IG-002 | Add-account dialog: smart connect, picker, connect new popup                 | pending   | P0       | M      | TW-IG-003, TW-IG-005        |
| TW-IG-003 | Available accounts to link (owner scoped)                                    | pending   | P0       | S      | TW-IG-016                   |
| TW-IG-004 | Link and refresh a mirror row                                                | pending   | P0       | S      | TW-IG-016                   |
| TW-IG-005 | Connect-new ticket and the return fallback                                   | pending   | P1       | S      | TW-IG-016                   |
| TW-IG-006 | Unlink: remove the mirror, purge the inbox with the last account             | pending   | P0       | S      | TW-IG-004                   |
| TW-IG-007 | Inbound push endpoint (secret, validation, connection flag)                  | pending   | P0       | S      | TW-IG-008                   |
| TW-IG-008 | Ingest one message: thread, dedup, preview, window, unread, contact, buttons | pending   | P0       | L      | TW-IG-004                   |
| TW-IG-009 | Pull new conversations and messages (both directions)                        | pending   | P0       | M      | TW-IG-008                   |
| TW-IG-010 | Reply through the bridge: text, media, quick replies, buttons                | pending   | P0       | M      | TW-IG-008                   |
| TW-IG-011 | Reaction and sender actions (typing, seen)                                   | no-caller | P2       | S      | TW-IG-010                   |
| TW-IG-012 | Run a flow on a thread: list flows, run                                      | pending   | P1       | S      | TW-IG-016                   |
| TW-IG-013 | Composer "Send from" Instagram account and reply-only recipients             | pending   | P1       | S      | TW-IG-004                   |
| TW-IG-014 | Reply-only broadcast (TW-BCAST-019)                                          | pending   | P1       | M      | TW-IG-010                   |
| TW-IG-015 | Plan gate, visibility rule (`hasConnected`), brand name, permission keys     | partial   | P0       | S      | plans-subscriptions-trials  |
| TW-IG-016 | Bridge client: settings, secret header, timeouts, never throw                | pending   | P0       | M      | TW-ADD-017                  |
| TW-IG-017 | Keyword auto-reply from an Instagram DM and its trigger kinds                | blocked   | P1       | S      | auto-reply-keywords         |
| TW-IG-018 | Import an Instaflow flow, push a flow, flow hand-off on a keyword            | blocked   | P1       | L      | flow-runtime-engine         |
| TW-IG-019 | Instagram templates: pull from the bridge, push to it                        | blocked   | P2       | M      | message-templates           |
| TW-IG-020 | Native Instagram add-on (direct Graph, embedded Meta login, `/instagram/*`)  | blocked   | P2       | XL     | add-on not in the reference |

## Features

### TW-IG-001 — Instagram hub: linked accounts, status, refresh, unlink, manage link

- **Status:** pending. **Priority:** P0. **Effort:** M.
- **Summary:** Reference shows Instagram accounts as rows on `/devices` (Channels) beside the other channels: avatar, name, `@handle`, "Instagram", a live pill and the sync time ("live" when never synced), then Manage (opens `{instaflowUrl}/instagram` in a new tab), Refresh (re-links the same account) and Unlink. The port gives the channel its own hub with the same rows, controls and wording, and exports the row list and the add dialog as components for the Channels page.
- **Actors & access:** workspace members on a plan with `access_instagram`; the add card shows only when the bridge is connected.
- **UX & screens:** `views/user/devices/_channel_rows.blade.php` (Instagram block), the chooser card in `devices/index.blade.php`. Avatar images use `referrerpolicy="no-referrer"` (profile picture addresses are signed and expire); without one, the first letter of the handle. Pill "Connected" unless status is not `connected`.
- **Data:** `workspace_ig_accounts` of the workspace: `instaflow_account_id`, `username`, `name`, `avatar`, `status`, `followers`, `synced_at`. Already in `20261001102500_wsp_threadwise_schema.sql` (RLS, unique on org and account).
- **Rules & edge cases:** (1) rows are listed for the active workspace only, ordered by username; (2) `status` other than `disconnected` counts as connected; (3) the hub count feeds the Channels counters.
- **Source refs:** `DevicesController::index` (Instagram part), `_channel_rows.blade.php`, `WorkspaceIgAccount`.
- **Port notes:** home `apps/api/src/modules/channel-instagram/`, `apps/web/src/features/channel-instagram/`. The Channels page itself belongs to whoever owns it; the components are ready for it and the hub route carries the same content until then.

### TW-IG-002 — Add-account dialog: smart connect, picker, connect new popup

- **Status:** pending. **Priority:** P0. **Effort:** M.
- **Summary:** Dialog "Add an Instagram account" with a note that the account connects once through the engine and Reference links to it. One **Connect Instagram** button asks `available` first (client time limit 4 s): exactly one account links at once; several open a picker ("Pick an account to link", a Link button per row, and "+ Connect a different account"); none, or an unreachable bridge, opens the sign-in popup (560 by 720). The popup posts `threadwise:instagram-connected` with `account_id`; the page then links that account and reloads with the toast "Instagram account linked.". When the platform has a Meta login config (`instagram_login_type` = facebook, an app id from `instagram_app_id` or `waba_app_id`, and `instagram_config_id`) a second button "Connect via Meta" shows (embedded business login to `/instagram/connect/embedded`; part of the native add-on, TW-IG-020).
- **UX & screens:** `devices/index.blade.php` modal `#instagram-connect-modal`, `resources/js/app.js` `initInstagramConnect`. Errors by toast: "Could not link that account.", "Could not start Instagram connect.", "Could not reach Instaflow." (empty list).
- **Rules & edge cases:** (1) a failed lookup falls through to the popup, never hangs; (2) the picker hides accounts already linked; (3) the message handler ignores any other message type.
- **Source refs:** `resources/js/app.js` (684 to 880), `devices/index.blade.php` (793 to 886).
- **Port notes:** the message listener checks `event.origin` against the bridge URL (Reference accepted any origin).

### TW-IG-003 — Available accounts to link (owner scoped)

- **Status:** pending. **Priority:** P0. **Effort:** S.
- **Summary:** `GET /devices/instagram/available` returns the accounts on the bridge that belong to the person (matched by the signed-in user's email, sent as `owner_email`) minus those already linked here. No email means an empty list, so another tenant's accounts are never offered. Each item: `id`, `username`, `name`, `avatar`, `connected`.
- **Endpoints:** `GET /devices/instagram/available` (JSON `{ok, accounts}`; 422 with no workspace).
- **Source refs:** `DevicesController::instagramAvailable`, `InstaflowClient::accounts`.

### TW-IG-004 — Link and refresh a mirror row

- **Status:** pending. **Priority:** P0. **Effort:** S.
- **Summary:** `POST /devices/instagram/link` upserts the mirror on (workspace, account). Profile fields come from the request first, else from the bridge list (the workspace-scoped list first, then the unscoped list). An id the bridge does not know, with no username supplied, creates nothing (404 "That Instagram account was not found on <brand>."). `status` is `connected` or `disconnected` from the bridge's `connected` flag; `synced_at` is now; `followers` only when supplied. The per-row Refresh posts the same route.
- **Rules & edge cases:** (1) validation: `instaflow_account_id` required, max 64; username and name max 190; avatar max 1024; (2) a form post redirects back with "Instagram account @handle updated."; JSON returns the row.
- **Source refs:** `DevicesController::instagramLink`, `upsertIgMirror`.

### TW-IG-005 — Connect-new ticket and the return fallback

- **Status:** pending. **Priority:** P1. **Effort:** S.
- **Summary:** `POST /devices/instagram/connect-start` asks the bridge for a signed one-time ticket (`/api/threadwise/connect/start` with `workspace_id` and `return_url`) and returns its OAuth `url` for the popup; 422 "<brand> is not connected." when the bridge is not connected; 502 with the bridge's error otherwise. `GET /devices/instagram/return?ig_account=<id>` is the no-opener fallback: links that account and redirects to the Channels page with "Instagram account connected.".
- **Source refs:** `DevicesController::instagramConnectStart`, `instagramReturn`, `InstaflowClient::connectStart`.

### TW-IG-006 — Unlink: remove the mirror, purge the inbox with the last account

- **Status:** pending. **Priority:** P0. **Effort:** S.
- **Summary:** `DELETE /devices/instagram/{id}/unlink` removes this workspace's mirror row (the account stays connected on the bridge). When no Instagram account remains, every `instagram` conversation of the workspace and its messages are deleted, in the same transaction, so the channel disappears from the inbox, dashboard, analytics, flows, templates and auto-reply. Configuration (templates, auto-reply, flows) is only hidden while no account is linked; linking again brings it back. Flash: "Instagram account disconnected — its data has been removed.". The confirm text warns that conversations and inbox data will be removed.
- **Rules & edge cases:** unlinking one of several accounts keeps all threads (Reference cannot tell which thread belongs to which account once the mirror is gone, so none are purged until the last).
- **Source refs:** `DevicesController::instagramUnlink`.

### TW-IG-007 — Inbound push endpoint (secret, validation, connection flag)

- **Status:** pending. **Priority:** P0. **Effort:** S.
- **Summary:** `POST /api/instaflow/inbound` (no session, outside the auth group). The header `X-Instaflow-Secret` is compared in constant time with the stored secret (empty stored secret or mismatch is 401 `unauthorized`). Body: `event` (`message`, `status`, `conversation`), `workspace_id`, optional `account`, `conversation`, `message`. A valid push sets `instaflow_connected = 1` and `instaflow_last_inbound = now` (the link is proven live). An unknown workspace is 422 `unknown workspace`. Only `message` events store anything; the other two are acknowledged (`received`). A store failure is 500 `store_failed`. Success returns `message_id` and `conversation_id`.
- **Rules & edge cases:** the shared secret is the only authentication; the workspace id comes from the sender (a bridge that holds the secret can write to any workspace, as in Reference).
- **Source refs:** `Api/InstaflowInboundController`, `routes/api.php`.
- **Port notes:** public route `POST /v2/instaflow/inbound`; the secret is the encrypted platform secret saved by TW-ADD-017, compared as digests in constant time.

### TW-IG-008 — Ingest one message: thread, dedup, preview, window, unread, contact, buttons

- **Status:** pending. **Priority:** P0. **Effort:** L.
- **Summary:** Shared by push and pull. One conversation per (workspace, `instagram`, `ig:<conversation id>`), created `status pending`, `inbox_status open`, `origin instagram`, with title = name, else `@handle`, else "Instagram". A later message that resolves a real name or non-numeric handle replaces a placeholder title ("Instagram" or numeric) but never a title an operator set. Direction from `from_me`. The message stores body, media type (non-text), meta `instagram` {conversation id, message id, account username and id, handle, avatar, media url, test flag, trace id} and interactive buttons normalised from `{title, url}` to `{text, url}`. Dedup within the thread on the Instagram message id (`meta.instagram.message_id` or `meta.wa_message_id`, the latter being our own sends); a duplicate that now carries buttons grafts them onto an existing row with none. The send time is the message's `at` when it parses, else now. The thread preview is the text cut to 140, or `[Photo]`-style when there is no text. Inbound sets `last_inbound_at` (the 24 hour window) and increments `unread_count`; outbound sets `last_outbound_at`. A genuine inbound (not test, not backfill) creates or updates a contact keyed by the sender id (source "Source: Instagram DM", a placeholder title is not used as the name) and links the thread to it; contact capture never breaks ingest. A real-time `MessageReceived` event is emitted. Test and backfill messages are stored but never run automations.
- **Rules & edge cases:** (1) a missing conversation id gets a stable synthetic key from the payload hash; (2) a bad `at` falls back to now; (3) `is_test` and `is_backfill` suppress contact capture and automations.
- **Acceptance criteria:** Given the same message by push then pull, Then one row. Given a first message with only a numeric handle and a later one with a name, Then the title updates. Given an outbound message, Then no unread increment.
- **Source refs:** `InstaflowIngestService::ingest`, `normalizeButtons`, `Contact::forSocialSender`.
- **Port notes:** the inbox write goes through the inbox-ingest shim (`InboxIngestPort`) used by Facebook and Telegram; contact capture through the same contact port.

### TW-IG-009 — Pull new conversations and messages (both directions)

- **Status:** pending. **Priority:** P0. **Effort:** M.
- **Summary:** For the workspace's linked accounts, list the bridge's conversations (`/api/threadwise/conversations?account=<id>`), skip a known thread whose bridge `last_at` is not newer than ours (unless forced), fetch `/conversations/{id}/messages` for the rest and ingest every message in both directions through TW-IG-008 (the account's own sends included, deduped). The result is the count of genuinely new rows. Reference triggers it from inbox polling, at most every 12 seconds per workspace, deferred after the response; no linked account or no bridge means nothing happens; a failure is logged, never thrown.
- **Source refs:** `InstaflowInboundPuller::pull`, `TeamInboxController` (poll trigger).
- **Port notes:** a BullMQ job and a repeatable sweep per workspace with a linked account, plus the same on-demand trigger from the inbox poll (debounced by a Redis key), instead of a synchronous call in a request.

### TW-IG-010 — Reply through the bridge: text, media, quick replies, buttons

- **Status:** pending. **Priority:** P0. **Effort:** M.
- **Summary:** An operator's reply on an `instagram` thread goes to `POST /api/threadwise/conversations/{id}/reply` with `type` (`text`, `image`, `video`, `audio`, `file`, `quick_replies`, `buttons`), `text`, `media_url` and, when present, `quick_replies` or `buttons`. The bridge does the Graph send and returns `message_id`, stored on the row so a later pull does not duplicate it. Shaping: a media message sends its media type (default image) with a public URL; otherwise template buttons choose one shape: any link button gives a generic button card (web link and postback buttons, at most 3), else quick replies (at most 13). A reply on a thread whose raw jid is not `ig:*` fails "This Instagram thread has no Instaflow conversation id."; an unconfigured bridge fails "Instagram is not connected …". A bridge error is surfaced as "Instaflow HTTP <status>: <detail>". This branch runs before the engine-agnostic local shortcut, because Instagram has a real outbound path.
- **Rules & edge cases:** (1) Meta's 24 hour window is enforced by the bridge, the error is shown on the message; (2) the native add-on send (TW-IG-020) is tried first in Reference and returns nothing when the add-on is absent.
- **Source refs:** `InboxDispatcher` (`dispatchInstaflow`, `igSendShape`), `InstaflowClient::reply`.
- **Port notes:** provider port `InstagramBridge` (`infra/providers/channel-instagram/`) with a fake for e2e; the dispatcher hook is a registered outbound sender for the `instagram` provider (like Facebook).

### TW-IG-011 — Reaction and sender actions (typing, seen)

- **Status:** no-caller. **Priority:** P2. **Effort:** S.
- **Summary:** Bridge calls `POST /conversations/{id}/react` (`message_id`, `reaction`, default heart) and `POST /conversations/{id}/action` (`typing_on`, `typing_off`, `mark_seen`). No screen calls them in the reference; they are client methods.
- **Source refs:** `InstaflowClient::react`, `action`, `typingOn`, `typingOff`, `markSeen`.
- **Port notes:** no screen, job or service in Reference calls them, so there is nothing to wire; they are recorded here, not dropped, and are added to the bridge port (two methods and a client call each) the day something needs them.

### TW-IG-012 — Run a flow on a thread: list flows, run

- **Status:** pending. **Priority:** P1. **Effort:** S.
- **Summary:** `igFlows` lists the flows the bridge can run for the workspace's linked accounts, de-duplicated by flow id, with an "author" link `{bridge}/instagram/flows`; empty when nothing is linked or the bridge is off. `runIgFlow` on an `instagram` thread posts `run-flow` with the flow id (the bridge owns the runtime); 422 `not_instagram`, `no_ig_conversation`, `not_connected`; 502 `run_failed`.
- **Source refs:** `TeamInboxController::igFlows`, `runIgFlow`, `InstaflowClient::flows`, `runFlow`.

### TW-IG-013 — Composer "Send from" Instagram account and reply-only recipients

- **Status:** pending. **Priority:** P1. **Effort:** S.
- **Summary:** The inbox composer's Instagram tab offers the linked accounts (`instagram:<mirror id>`, label `@username`) and, for them, up to 200 recent Instagram threads, each marked open or closed by the 24 hour window from `last_inbound_at`. Shown only when the bridge is connected and an account is linked.
- **Source refs:** `TeamInboxController` (send-from block), `WorkspaceIgAccount::hasConnected`.

### TW-IG-014 — Reply-only broadcast (TW-BCAST-019)

- **Status:** pending. **Priority:** P1. **Effort:** M.
- **Summary:** In the broadcast composer the Instagram channel sends to selected existing threads only. Required: name (255), message (1000), at least one recipient conversation. Plan feature `broadcast` is checked; the plan count limit is not. Each thread: `{name}` is replaced by the thread title (else "there"); a template contributes its body and its buttons through the TW-IG-010 shaping; the send goes through the bridge and, on success, an outbound row is mirrored (with the returned id) and the thread preview updated. Up to 200 recipients per send. Result "Instagram broadcast sent — N delivered, M failed.", or "Could not send to any recipient. Check the Instagram connection." when none went. The inbox composer has the same send with `ig_conversation_ids`.
- **Rules & edge cases:** a thread not in the workspace or not `instagram` counts as failed; the bridge's window error counts as failed (no pre-check).
- **Source refs:** `BroadcastsController::storeInstagram`, `TeamInboxController` (instagram send branch).

### TW-IG-015 — Plan gate, visibility rule, brand name, permission keys

- **Status:** partial. **Priority:** P0. **Effort:** S.
- **Summary:** Instagram shows only while BOTH hold: the bridge is connected (a cached flag, no network call) and the workspace has a connected mirror row (`hasConnected`). Cutting the bridge or unlinking the last account makes it disappear everywhere. Labels use the saved display name (`instaflow_brand`, default `IgDesk`), never the literal "Instaflow". The plan flag `access_instagram` gates the channel.
- **Port notes:** permission keys `ig.accounts.read`, `ig.accounts.manage`, `ig.broadcasts.manage` and `ig.flows.run` replace the workspace-role guard (replying in the inbox stays under the inbox keys). The plan flag is a shim (`InstagramPlanGate`) until the plan catalogue carries it, same as `FacebookPlanGate`.
- **Source refs:** `WorkspaceIgAccount::hasConnected`, `ig_brand_name()` (`fc_helpers.php`), `UserNav.php`.

### TW-IG-016 — Bridge client: settings, secret header, timeouts, never throw

- **Status:** pending. **Priority:** P0. **Effort:** M.
- **Summary:** Built from the settings `instaflow_url` (trailing slash trimmed) and `instaflow_secret`. Every call sends `X-Instaflow-Secret`, JSON accept, a 15 second timeout. List calls degrade to an empty list on any failure; POST helpers return `{ok:false, error}`; the reply call logs the bridge's actual reason. Contract used (all under `{url}/api/threadwise`): `GET handshake`, `GET conversations`, `GET conversations/{id}/messages`, `POST conversations/{id}/reply|react|action|run-flow`, `GET accounts` (`workspace`, `owner_email`), `POST connect/start`, `GET flows`, `GET flows/{id}` (`adopt`), `POST flows`, `GET|POST templates`.
- **Source refs:** `InstaflowClient`.
- **Port notes:** a port with a fake; the URL is checked against private and loopback ranges before calls unless the operator allows it (the bridge is an operator-supplied address).

### TW-IG-017 — Keyword auto-reply from an Instagram DM and its trigger kinds

- **Status:** blocked (auto-reply-keywords). **Priority:** P1. **Effort:** S.
- **Summary:** A genuine inbound with text, or any message whose trigger kind needs no keyword (story reply, story mention, @mention, comment), calls the keyword dispatcher with the thread, the text, the conversation id and `ig_trigger` (default `dm_keyword`). Skipped when a flow consumed the message (TW-IG-018). Recorded behind an `InboundHooks` shim; the ingest calls it and treats "not handled" as the default.
- **Source refs:** `InstaflowIngestService`, `KeywordReplyDispatcher`, `KeywordReply::IG_TRIGGERS_NO_KEYWORD`.

### TW-IG-018 — Import an Instaflow flow, push a flow, flow hand-off on a keyword

- **Status:** blocked (flow-runtime-engine, flow-builder-editor). **Priority:** P1. **Effort:** L.
- **Summary:** `GET /flows/import-ig/{igId}` fetches the bridge flow with its graph and stores or updates a Reference flow keyed by `instaflow_flow_id`; saving a Reference Instagram flow pushes it (`POST /flows`, keyed by the Reference flow id, with trigger kind and keywords and the published flag); Column `flows.instaflow_flow_id` exists in the port schema. Reference's hand-off of an inbound DM to a keyword flow runs only in the native add-on (`instagram_enabled`); with the engine, the engine runs flows itself, so that hand-off belongs to TW-IG-020.
- **Source refs:** `FlowsController::importIgFlow` and the push on save, `InstaflowClient::flow`, `pushFlow`, `InstaflowIngestService::resolveIgKeywordFlow`.

### TW-IG-019 — Instagram templates: pull from the bridge, push to it

- **Status:** blocked (message-templates). **Priority:** P2. **Effort:** M.
- **Summary:** "Sync from Instaflow" on the templates page pulls the account's reusable DM snippets (`{id, name, type, body, items[]}`) into the library; saving an Instagram template pushes it (`POST /templates`, keyed by account and name, type `text`, `quick_replies` or `buttons`). Shown only in bridge mode.
- **Source refs:** `TemplatesController::syncFromInstaflow` and the push, `InstaflowClient::templates`, `pushTemplate`.

### TW-IG-020 — Native Instagram add-on (direct Graph, embedded Meta login, `/instagram/*`)

- **Status:** blocked (the add-on ZIP is not in the reference). **Priority:** P2. **Effort:** XL.
- **Summary:** The documentation (`channels/instagram.html`, `admin-panel/instagram-engine.html`) describes it: Meta app settings (`instagram_app_id`, `instagram_app_secret`, `instagram_config_id`, `instagram_webhook_verify_token`, `instagram_graph_version`, `instagram_login_type`), Facebook Login for Business, the webhook fields `messages`, `messaging_postbacks`, `message_reactions`, `comments`, the 24 hour window, auto-replies, visual flows, an AI agent, comment automation. The host app references its classes (`InstagramAccount`, `InstagramService`, `IgFlowBridge`) and routes (`/instagram/connect`, `/instagram/{id}/health|refresh`) but their source is absent. Nothing here can be ported from code; it is recorded for the product owner.
- **Source refs:** `Documentation/pages/channels/instagram.html`, `admin-panel/instagram-engine.html`, host references in `DevicesController`, `InboxDispatcher`, `InstaflowIngestService`.
