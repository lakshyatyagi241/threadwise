---
domain: channel-email
code: MAIL
title: Email channel (linked mailboxes in the team inbox, mail flows, mail campaigns, plus the native Gmail port additions)
threadwise_version: '1.7.0'
sources_read: 46
---

# Email channel

## Overview

**What Reference actually does.** Reference (v1.7.0, September 2026) has no mail engine of its own. It never speaks IMAP, SMTP,
Gmail or OAuth to a mail provider and it never stores a mailbox password. Email is a **bridge to a separate product, MailTrixy**,
deployed next to it. The platform admin pastes the MailTrixy URL and a shared secret on the Add-ons page (`TW-ADD-019`), turns the
Email channel on in Channel Settings, and ticks the Email feature on plans. A workspace admin then **links** a mailbox that already
exists on MailTrixy (the picker only lists mailboxes whose MailTrixy owner has the same login email as the Threadwise user). Linking
creates a local "mirror" row in `workspace_email_accounts` (MailTrixy account id plus a cached name, address and provider) and
imports the mailbox history. From then on MailTrixy **pushes** each new inbound message to `POST /api/mailtrixy/inbound`, which
becomes a `channel = email` conversation in the team inbox (one conversation per MailTrixy conversation, plain text plus a 64 KB
HTML copy in message meta). A reply typed in the inbox is handed back to MailTrixy, which performs the real send and keeps the
threading headers. The same mirror row backs email flows (Node runtime), email campaigns (a PHP runner), mailbox-scoped auto-reply
rules and the sender pickers. A per-row Sync pulls history or repairs a missed push; nothing schedules it.

What Reference does **not** have, and our draft spec adds (marked `port-addition` below): connecting Google by OAuth, any native
mailbox protocol, a mailbox limit or a mailbox switcher inside the inbox, attachments in either direction, cc/bcc, signatures,
rich-text composing, per-mailbox default assignee, health and re-authentication states, bounce or auto-responder detection, and
per-agent personal mailboxes. Reference does allow **several mailboxes per workspace** (each its own row and sender, no cap other
than the plan flag), but the inbox only has one "Email" channel filter, not one per mailbox.

**Owner requirement for the port.** Connect Google (Gmail) so mail flows into the inbox; allow 2 to 3 mailboxes per workspace (for
example support@ and sales@); the inbox shows multiple inboxes. This is covered by `TW-MAIL-019` to `TW-MAIL-025`, `TW-MAIL-028` to
`TW-MAIL-030`. The Reference features `TW-MAIL-001` to `TW-MAIL-017` describe behavior users already have; they must survive the
engine swap (a native Gmail connection replaces the MailTrixy bridge, which `TW-MAIL-018` documents and which is **not** ported
unless the owner decides otherwise, see Open questions 1).

**Status values used.** The five values of the inventory spec (`implemented`, `partial`, `docs-only`, `dead-code`, `beta`) describe
Reference. The extra value **`port-addition`** marks a feature that does not exist in Reference and comes from
`docs/specs/email-channel-and-social-leads.md` (the draft spec) or from the owner's brief. Port additions are deviations; record each
in `docs/threadwise-port/parity/product-extensions.md`.

**Plan gates.** Platform switch `email_enabled` (Channel Settings), plan feature `access_email`, plan cap `email_monthly_limit`
(0 = unlimited, counts outbound email rows in the calendar month, enforced only at the start of a campaign run). The gates are
applied unevenly (see `TW-MAIL-016`).

**Roles.** Every link, sync and unlink route sits behind `workspace.role:admin` (the Devices group). Agents cannot connect mailboxes
but can read and reply to email conversations like any other channel.

Connects to: team-inbox-conversations (threads, replies, channel filter), contacts-attributes-tags (a social contact per sender),
flow-builder-editor and flow-runtime-engine (flows of type `email`), node-bridge-runtime (email flow engine), campaigns (email
campaign runner and sender picker), auto-reply-keywords (mailbox-scoped rules), addons-extension-registry (`TW-ADD-019`, `TW-ADD-020`
connect and disconnect the bridge), whatsapp-devices-baileys (the Devices hub table that hosts the rows), plans-subscriptions-trials
(`access_email`, `email_monthly_limit`), platform-settings-branding-storage (settings, storage for attachments),
notifications-activity-audit, roles-permissions, ai-agents-training (assigned agents answer email).

Out of scope here: the platform's own **system mail** (admin SMTP settings `mail_*`, `app/Support/MailConfig.php`, mailables such as
the team invite, verification and welcome mails). That is outbound platform mail, belongs to platform-settings-branding-storage and
auth domains, and is unrelated to the email channel.

## Feature index

| Id          | Feature                                                                            | Status        | Priority | Effort | Depends on                                    |
| ----------- | ---------------------------------------------------------------------------------- | ------------- | -------- | ------ | --------------------------------------------- |
| TW-MAIL-001 | Email rows in the Channels table (mailbox list, status, last synced)               | implemented   | P0       | M      | TW-MAIL-003                                   |
| TW-MAIL-002 | "Add an email account" modal and the available-mailbox picker                      | implemented   | P0       | M      | TW-MAIL-018                                   |
| TW-MAIL-003 | Link a mailbox (mirror row, ownership check, one workspace per mailbox, backfill)  | implemented   | P0       | L      | TW-MAIL-002, TW-MAIL-004                      |
| TW-MAIL-004 | Sync a mailbox on demand (pull, resume cursor, full re-pull)                       | implemented   | P0       | M      | TW-MAIL-007                                   |
| TW-MAIL-005 | Unlink a mailbox                                                                   | implemented   | P0       | S      | TW-MAIL-003                                   |
| TW-MAIL-006 | Inbound push endpoint (shared secret, acknowledge unlinked accounts)               | implemented   | P0       | M      | TW-MAIL-007                                   |
| TW-MAIL-007 | Inbound ingest: thread, message, contact, preview, unread, realtime event          | implemented   | P0       | L      | TW-MAIL-003                                   |
| TW-MAIL-008 | Email in the inbox UI: channel badge, rail and tab filter, mail-style bubble       | implemented   | P0       | M      | TW-MAIL-007                                   |
| TW-MAIL-009 | Reply from the inbox through the mailbox                                           | implemented   | P0       | M      | TW-MAIL-007, TW-MAIL-018                      |
| TW-MAIL-010 | Reply on a campaign-mirrored thread (one-off send)                                 | implemented   | P1       | S      | TW-MAIL-009, TW-MAIL-014                      |
| TW-MAIL-011 | Automation chain on inbound mail: flow, routing, AI agent, keyword reply           | implemented   | P0       | M      | TW-MAIL-007                                   |
| TW-MAIL-012 | Email flows: binding to a mailbox, Node runtime, numbered choices, quote stripping | implemented   | P1       | L      | TW-MAIL-011, flow-runtime-engine              |
| TW-MAIL-013 | Email flow callbacks: flow-send, flow-node (AI, webhook), flow-log                 | implemented   | P1       | M      | TW-MAIL-012                                   |
| TW-MAIL-014 | Email campaigns: sender, subject, personalisation, pacing, plan cap, inbox mirror  | implemented   | P1       | L      | TW-MAIL-003, campaigns                        |
| TW-MAIL-015 | Mailbox-scoped auto-reply rules and sender pickers                                 | implemented   | P1       | S      | TW-MAIL-003, auto-reply-keywords              |
| TW-MAIL-016 | Gates: platform switch, plan flag, monthly cap, visibility rule                    | partial       | P0       | M      | plans-subscriptions-trials                    |
| TW-MAIL-017 | Admin enablement: Email channel toggle and bridge connection status                | implemented   | P0       | S      | TW-ADD-019                                    |
| TW-MAIL-018 | Bridge client contract (the MailTrixy API surface Reference calls and exposes)     | implemented   | P0       | M      | none                                          |
| TW-MAIL-019 | Mailbox model and native Settings > Integrations > Email hub                       | port-addition | P0       | L      | TW-MAIL-030                                   |
| TW-MAIL-020 | Connect Google (Gmail) by OAuth                                                    | port-addition | P0       | L      | TW-MAIL-019, TW-MAIL-029                      |
| TW-MAIL-021 | Gmail inbound sync: backfill, incremental, repair                                  | port-addition | P0       | XL     | TW-MAIL-020, TW-MAIL-025, TW-MAIL-026         |
| TW-MAIL-022 | Gmail outbound: reply and new message with correct threading                       | port-addition | P0       | L      | TW-MAIL-020, TW-MAIL-025                      |
| TW-MAIL-023 | Several mailboxes per workspace (limit of 2 to 3, per-mailbox defaults)            | port-addition | P0       | M      | TW-MAIL-019, TW-MAIL-030                      |
| TW-MAIL-024 | Multi-inbox view in the inbox: mailbox switcher, filter, counts, From selector     | port-addition | P0       | L      | TW-MAIL-023, team-inbox-conversations         |
| TW-MAIL-025 | One conversation per email thread, contact linked by email identity                | port-addition | P0       | L      | TW-MAIL-007                                   |
| TW-MAIL-026 | Rich inbound message: sanitised HTML, cc, headers, attachments                     | port-addition | P0       | L      | TW-MAIL-025                                   |
| TW-MAIL-027 | Composer: rich text, cc/bcc, attachments, signature, saved replies                 | port-addition | P1       | L      | TW-MAIL-022, TW-MAIL-026                      |
| TW-MAIL-028 | Mailbox health: sync status, last error, needs-reauth, reconnect, retry            | port-addition | P0       | M      | TW-MAIL-021, TW-MAIL-022                      |
| TW-MAIL-029 | Operator console: Email providers (Google credentials, enable, test)               | port-addition | P0       | M      | platform-settings-branding-storage            |
| TW-MAIL-030 | Permissions, plan feature and the mailbox limit key                                | port-addition | P0       | S      | roles-permissions, plans-subscriptions-trials |
| TW-MAIL-031 | Generic IMAP/SMTP mailbox ("Other mail")                                           | port-addition | P1       | XL     | TW-MAIL-019, TW-MAIL-026                      |
| TW-MAIL-032 | Loop, bounce and auto-responder protection                                         | port-addition | P1       | M      | TW-MAIL-021, TW-MAIL-011                      |
| TW-MAIL-033 | Gmail push notifications (Pub/Sub watch) instead of polling                        | port-addition | P2       | L      | TW-MAIL-021                                   |
| TW-MAIL-034 | Microsoft 365 / Outlook by OAuth                                                   | port-addition | P2       | XL     | TW-MAIL-019, TW-MAIL-029                      |
| TW-MAIL-035 | Personal mailboxes and the channel-owner visibility rule                           | port-addition | P2       | L      | TW-MAIL-023, team-inbox-conversations         |

## Features

### TW-MAIL-001 — Email rows in the Channels table (mailbox list, status, last synced)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-MAIL-003
- **Summary:** Each linked mailbox is a row in the same "Connected channels" table on `/devices` that lists WhatsApp numbers, Facebook, Instagram, TikTok, SMS and the other channels. A workspace admin sees address, provider, freshness and status at a glance and can sync or unlink from the row.
- **Actors & access:** workspace admin or owner (`workspace.role:admin` on the Devices group). The email rows and the Email add-card only appear when the platform setting `email_enabled` is on **and** the bridge is configured (URL and secret both present).
- **UX & screens:** `resources/views/user/devices/_channel_rows.blade.php` (email block) and `resources/views/user/devices/index.blade.php`. Row columns: name (mailbox display name, else the address) with a small mail icon and the label "Email" plus the capitalised provider ("Email · Gmail"); address in monospace; two dash placeholders for columns that do not apply to email; "Last synced" shown as a relative time of `synced_at` or "live" when empty; a status pill "Connected" (green) or "Inactive" (grey, any status other than `connected`, case-insensitive); two icon buttons: Sync ("fetch mail for this account") and Unlink (confirm: unlink the account, its messages stop arriving, the mailbox itself is not deleted). Rows are ordered by address ascending. The table auto-refreshes every 15 seconds from the same server payload, so the email list must be computed in the controller, not only in the view.
- **Endpoints:**

| Method uri  | Route name         | Controller@action       | Middleware                                    | Request fields | Response                                      |
| ----------- | ------------------ | ----------------------- | --------------------------------------------- | -------------- | --------------------------------------------- |
| GET devices | user.devices.index | DevicesController@index | web, auth, workspace.role:admin (shared page) | none           | the hub view with `hasEmail`, `emailAccounts` |

- **Data:** reads `workspace_email_accounts` of the active workspace ordered by `email`; reads `system_settings` `email_enabled`, `mailtrixy_url`, `mailtrixy_secret` (only to test presence).
- **Rules & edge cases:**
  1. No active workspace: the list is empty.
  2. `status` other than `connected` renders as Inactive; nothing in Reference ever writes another value except the absence of the row, so Inactive only appears for hand-edited data (QUIRK).
  3. The row never shows an error message or a last-error time; there is no health concept.
  4. The row shows the platform's connection state only indirectly: if the platform admin disconnects the bridge, the rows disappear from this table (the add-card too) but stay in the database.
- **Async & events:** none (the 15 s refresh is a client poll of the same page payload).
- **External systems:** none on render.
- **Settings:** `email_enabled`, `mailtrixy_url`, `mailtrixy_secret`.
- **Acceptance criteria:**
  - Given two linked mailboxes and `email_enabled` on, When the admin opens Devices, Then two email rows are listed by address with provider, relative sync time and a Connected pill.
  - Given `email_enabled` off, When the page opens, Then no email row and no Email add-card is shown.
  - Given the 15 s refresh fires, When the table is re-rendered, Then the email rows are still present.
- **Source refs:** `resources/views/user/devices/_channel_rows.blade.php`, `resources/views/user/devices/index.blade.php`, `app/Http/Controllers/DevicesController.php` (index, around the `hasEmail` block), `app/Models/WorkspaceEmailAccount.php`.
- **Port notes:** the Devices hub is owned by whatsapp-devices-baileys; this domain exports a "channel rows" provider for kind `email` (address, provider label, last sync, status, actions). Port addition `TW-MAIL-019` adds the dedicated Settings > Integrations > Email screen; keep a Reference-style row in the hub as well so the Reference flow still exists. Add the health columns of `TW-MAIL-028` here (a status the Reference row lacks).

### TW-MAIL-002 — "Add an email account" modal and the available-mailbox picker

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-MAIL-018
- **Summary:** The admin opens an Email card in the add-channel chooser and sees a modal that lists the mailboxes already connected on MailTrixy that belong to them and are not yet linked anywhere, plus the ones already linked here. One click links a mailbox.
- **Actors & access:** workspace admin (Devices group). Needs `email_enabled` on and a configured bridge for the card to exist.
- **UX & screens:** card "Email" in the add-channel chooser (button with `data-email-connect`); modal `#email-connect-modal` titled "Add an email account". Top section "Linked" (only when the workspace has rows): each row shows name, address, a re-link ("refresh") form and an Unlink form with a confirm that names the engine brand. Below, the "available" list is fetched on open: states Loading ("Checking for mailboxes"), Empty ("No unlinked mailboxes found. Connect the mailbox on the engine first, then it appears here."), Error ("Could not load email accounts."), or a list of rows (name, address, provider, a Link button). Success toast "Email account linked." Script: `resources/js/app.js` (`initEmailConnect`).
- **Endpoints:**

| Method uri                  | Route name                   | Controller@action                | Middleware                      | Request fields | Response                                                                                                                                                            |
| --------------------------- | ---------------------------- | -------------------------------- | ------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET devices/email/available | user.devices.email.available | DevicesController@emailAvailable | web, auth, workspace.role:admin | none           | JSON `{ok, accounts:[{id, mtx_workspace_id, email, name, provider, status}]}`; 422 with `{ok:false, accounts:[], error}` when no workspace or bridge not configured |

- **Data:** reads all `workspace_email_accounts.mailtrixy_account_id` (every workspace, to hide taken mailboxes); calls the bridge `accounts` list.
- **Rules & edge cases:**
  1. The list sent to the bridge is **owner-scoped**: the logged-in user's login email is passed as `owner_email`, and MailTrixy returns only mailboxes owned by that email (see `TW-MAIL-018`). A user whose login email matches no MailTrixy owner sees an empty list. This is how tenants are kept apart on a shared MailTrixy; it is documented as the "matching-email rule".
  2. A mailbox linked by **any** workspace is hidden from the list (one workspace per mailbox).
  3. A bridge failure degrades to an empty list, not an error, except the not-configured case which returns 422 with a setup hint (admin sees which Add-ons page to open; non-admin sees "please contact support").
  4. The brand name in every message is the admin-configurable display name (`mailtrixy_brand`, default MailTrixy), never a literal.
- **Async & events:** none.
- **External systems:** MailTrixy `GET /api/threadwise/accounts` with `X-Mailtrixy-Secret`, `owner_email` query, 15 s timeout.
- **Settings:** `mailtrixy_url`, `mailtrixy_secret`, `mailtrixy_brand`.
- **Acceptance criteria:**
  - Given a user whose login email owns two unlinked mailboxes on the engine, When the modal opens, Then both are listed with a Link button.
  - Given a mailbox already linked by another workspace, When the modal opens, Then it is not listed.
  - Given the bridge is not configured, When the modal opens, Then a setup message is shown and no list.
- **Source refs:** `app/Http/Controllers/DevicesController.php` (`emailAvailable`), `resources/js/app.js` (`initEmailConnect`), `resources/views/user/devices/index.blade.php`, `app/Services/Mailtrixy/MailtrixyClient.php` (`accounts`).
- **Port notes:** with the native Gmail path (`TW-MAIL-020`) this picker is replaced by a "Connect Google" button; there is nothing to list because the provider account is chosen in Google's consent screen. If the MailTrixy bridge is kept (Open question 1) keep the picker and the owner-email rule unchanged. The tenant-safety intent (a user never sees another tenant's mailboxes) must carry over: native connect satisfies it because the OAuth account is the user's own.

### TW-MAIL-003 — Link a mailbox (mirror row, ownership check, one workspace per mailbox, backfill)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-MAIL-002, TW-MAIL-004
- **Summary:** Linking creates (or refreshes) the workspace's mirror row for a MailTrixy mailbox and immediately imports its existing mail, so the inbox starts populated.
- **Actors & access:** workspace admin. No plan check on this action (QUIRK: `access_email` is not verified here).
- **UX & screens:** the Link button in the modal (`TW-MAIL-002`) posts JSON; the per-row refresh posts a normal form and redirects back. Flash "Email account <address> linked." or "... linked: N message(s) imported." (status), or an error flash on the `email` field.
- **Endpoints:**

| Method uri              | Route name              | Controller@action           | Middleware                      | Request fields                                                                                                                                    | Response                                                   |
| ----------------------- | ----------------------- | --------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| POST devices/email/link | user.devices.email.link | DevicesController@emailLink | web, auth, workspace.role:admin | `account_id` required integer; `mtx_workspace_id` nullable integer; `email` nullable max 190; `name` nullable max 190; `provider` nullable max 64 | JSON `{ok, account, imported}` or redirect back with flash |

- **Data:** upserts `workspace_email_accounts` on (`workspace_id`, `mailtrixy_account_id`): sets `mtx_workspace_id`, `email`, `name`, `provider`, `status = connected`, `synced_at = now`; then runs a full sync (`TW-MAIL-004`) which writes conversations, messages and `mtx_last_message_id`.
- **Rules & edge cases:**
  1. No active workspace: 422 / error "No active workspace."
  2. A **new** link (no row yet for this workspace and account) must match an entry in the owner-scoped bridge list; otherwise 404 "That email account was not found on <brand>." The caller-supplied email, name and provider cannot mint a row for a mailbox the user does not own.
  3. A new link to an account that another workspace already holds is refused: 422 "That email account is already linked to another workspace." (the check is global; the database unique index is only per workspace, so a race could still create two rows, QUIRK).
  4. Re-linking an existing row (the Refresh action) skips the ownership check on purpose: it keeps working when the engine is unreachable; missing details then come from the posted fields, and with neither details nor a posted email the call fails with the not-found message.
  5. `status` is always set to `connected` on link or refresh.
  6. The backfill is a **full** pull from the beginning, never fatal: if it throws, the link still succeeds with "linked" and no count.
  7. Unlinking and re-linking creates a new row id (see `TW-MAIL-005`).
- **Async & events:** the backfill runs inline in the request (up to 40 pages of 50 messages); no queue, no audit entry, no notification, no outbox event.
- **External systems:** bridge `accounts` (ownership) and `messages` (backfill).
- **Settings:** none beyond the bridge settings.
- **Acceptance criteria:**
  - Given an owned unlinked mailbox, When linked, Then a row exists with status connected and the existing mail appears as inbox threads.
  - Given an account id the user does not own, When linked, Then 404 and no row is created.
  - Given the mailbox is linked in another workspace, When linked, Then 422 with the already-linked message.
  - Given the engine is down on a refresh of an existing row, When refreshed, Then the row stays and the call succeeds without a count.
- **Source refs:** `app/Http/Controllers/DevicesController.php` (`emailLink`), `app/Services/Mailtrixy/MailtrixySyncService.php`, `app/Models/WorkspaceEmailAccount.php`, `database/migrations/2026_08_30_100000_create_workspace_email_accounts_table.php`.
- **Port notes:** table `workspace_email_accounts` already exists in `packages/db/migrations/20261001102500_wsp_threadwise_schema.sql` (owned by the workspaces domain, zero rows). Do not extend it for the native path; `TW-MAIL-019` adds a `mailboxes` table. Add an audit row and an outbox event (`mail.mailbox.linked`) which Reference lacks. Do the backfill in a queue job so the request returns fast (a documented deviation from the inline pull).

### TW-MAIL-004 — Sync a mailbox on demand (pull, resume cursor, full re-pull)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-MAIL-007
- **Summary:** A per-row Sync pulls the mailbox's mail from the engine and feeds each message through the same ingest a live push uses, so it both imports history and repairs anything a push missed. It is safe to press repeatedly.
- **Actors & access:** workspace admin; the row must belong to the active workspace.
- **UX & screens:** the circular-arrow icon on the row (`TW-MAIL-001`). Flash on success "N new message(s) imported from <address>." or "No new mail for <address>."; error "Could not sync <address> right now."; "Email account not found." for an unknown or foreign row.
- **Endpoints:**

| Method uri                   | Route name              | Controller@action           | Middleware                      | Request fields                        | Response                                                                                             |
| ---------------------------- | ----------------------- | --------------------------- | ------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| POST devices/email/{id}/sync | user.devices.email.sync | DevicesController@emailSync | web, auth, workspace.role:admin | `id` numeric; `full` boolean optional | JSON `{ok, imported, message}` (or 422 `{ok:false, error, detail}`, 404) or redirect back with flash |

- **Data:** reads and writes `workspace_email_accounts.mtx_last_message_id` (highest engine message id already imported) and `synced_at`; writes conversations and messages through the ingest.
- **Rules & edge cases:**
  1. Resume mode starts after the stored cursor; `full=1` ignores the cursor and starts from the beginning (the link backfill is always full).
  2. Pages of 50, oldest first, stop on an empty page or when the engine returns no next cursor, hard stop at 40 pages (2,000 messages) per run, so a larger mailbox needs repeated syncs.
  3. The cursor advances to the highest message id seen **even on a partial or failed run**, so a failure mid-way does not re-walk imported mail.
  4. One bad message is logged and skipped; the sweep continues.
  5. Dedupe is the ingest's: a message already stored (same engine message id on the same thread) is not counted as imported.
  6. The sync is scoped to the **current user's login email** for the owner filter, so a different admin pressing Sync can pull a different set (QUIRK).
  7. QUIRK: the code comments and the docs speak of a "periodic repair sweep" but nothing schedules `syncWorkspace`; only the link action and the manual button run a sync.
- **Async & events:** inline in the request; no schedule, no queue. Logs `[MAILTRIXY-SYNC]`.
- **External systems:** bridge `GET /api/threadwise/messages?account_id&owner_email&after_id&limit` returning push-shaped payloads plus `next_after_id`.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 120 unsynced messages, When Sync runs, Then 120 messages are imported across 3 pages and the cursor is the highest id.
  - Given Sync runs twice, When nothing is new, Then the second reports "No new mail" and creates no duplicates.
  - Given the engine fails on page 2, When Sync runs, Then page 1 is kept, the cursor is saved and the error flash shows.
- **Source refs:** `app/Http/Controllers/DevicesController.php` (`emailSync`), `app/Services/Mailtrixy/MailtrixySyncService.php`, `app/Services/Mailtrixy/MailtrixyClient.php` (`messages`).
- **Port notes:** the native replacement is `TW-MAIL-021` (scheduled incremental sync plus a manual "Sync now" and a "resync last 7 days" action). Keep the "Sync" button and its three messages. Make the run a BullMQ job and the cap per run a setting instead of 40 pages.

### TW-MAIL-005 — Unlink a mailbox

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-MAIL-003
- **Summary:** Removes the workspace's mirror row. The mailbox itself stays connected on the engine and can be linked again.
- **Actors & access:** workspace admin.
- **UX & screens:** trash icon on the row and Unlink in the modal, both with a confirm. Flash "Email account unlinked."
- **Endpoints:**

| Method uri                       | Route name                | Controller@action             | Middleware                      | Request fields | Response                            |
| -------------------------------- | ------------------------- | ----------------------------- | ------------------------------- | -------------- | ----------------------------------- |
| DELETE devices/email/{id}/unlink | user.devices.email.unlink | DevicesController@emailUnlink | web, auth, workspace.role:admin | `id` numeric   | redirect back with the status flash |

- **Data:** hard-deletes the `workspace_email_accounts` row scoped to the active workspace. Conversations and messages are kept.
- **Rules & edge cases:**
  1. An id of another workspace deletes nothing and still flashes success.
  2. Incoming pushes for the account are acknowledged and ignored from then on (`TW-MAIL-006`).
  3. Existing email conversations are **not deleted**, but they **stop appearing in the inbox when the workspace has no connected mailbox left** (the visibility rule of `TW-MAIL-016`). If another mailbox remains, the old threads stay visible but a reply on them fails with "The email account for this thread is no longer linked" (`TW-MAIL-009`). QUIRK.
  4. Re-linking creates a new row id, so thread keys (`email:<rowId>:...`) of the old row are never reused; old threads stay orphaned. QUIRK.
  5. Flows and auto-reply rules bound to the deleted row id are left dangling.
  6. No audit entry.
- **Async & events:** none.
- **External systems:** none (the engine is not told).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a linked mailbox, When unlinked, Then the row is gone and new pushes are acknowledged but ignored.
  - Given it was the last mailbox, When unlinked, Then the Email channel filter and its threads disappear from the inbox.
  - Given another workspace's row id, When called, Then nothing is deleted.
- **Source refs:** `app/Http/Controllers/DevicesController.php` (`emailUnlink`), `app/Models/WorkspaceEmailAccount.php` (`hasConnected`).
- **Port notes:** the port should improve the orphan quirk without losing behavior: keep threads attached to the mailbox row through a soft status (`disconnected`) instead of hard delete, and show their history read-only. Record the change in `product-extensions.md`. Emit `mail.mailbox.unlinked` and an audit row. For a native Gmail mailbox "Disconnect" also revokes the token at Google (`TW-MAIL-020`).

### TW-MAIL-006 — Inbound push endpoint (shared secret, acknowledge unlinked accounts)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-MAIL-007
- **Summary:** MailTrixy POSTs each new message to one fixed Threadwise URL. The shared secret authenticates the call; the account id finds the workspace through the mirror row.
- **Actors & access:** the MailTrixy deployment only. No session, no CSRF (the `api` group).
- **UX & screens:** none.
- **Endpoints:**

| Method uri                 | Route name        | Controller@action                     | Middleware | Request fields                                                                                                                                                              | Response                                                                                                                                                                                                   |
| -------------------------- | ----------------- | ------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST api/mailtrixy/inbound | mailtrixy.inbound | Api\MailtrixyInboundController@ingest | api        | `event` required `message`; `mtx_workspace_id` nullable int; `account` required array; `conversation` nullable array; `message` required array. Header `X-Mailtrixy-Secret` | `{ok:true, message_id, conversation_id}`, `{ok:true, ignored:'unlinked_account'}`, `{ok:true, received}` for a non-message, 401 `{ok:false, error:'unauthorized'}`, 500 `{ok:false, error:'store_failed'}` |

- **Data:** writes `system_settings` `mailtrixy_connected = 1` and `mailtrixy_last_inbound = now` on every authenticated push; reads `workspace_email_accounts` where `status = connected`.
- **Rules & edge cases:**
  1. The secret is compared in constant time against the stored secret; an empty stored secret always refuses.
  2. A valid push flips the platform "connected" flag on, even if the admin had set it off (the push is treated as proof the link is live). QUIRK.
  3. The mirror is found by `account.id` (engine account id). When several workspaces mirror the same account, the engine's workspace id (from `account.workspace_id`, else `mtx_workspace_id`) selects the row; otherwise the first row wins.
  4. An account no workspace has linked is acknowledged with `ignored`, never an error, so the engine does not retry mail nobody subscribed to.
  5. A storage failure answers 500 (the engine may retry), unlike chat channels that always answer 200.
  6. There is no throttle on this route and no plan check.
- **Async & events:** the engine's push has an 8 second timeout and no retry on its side (documented in the sync service); lost pushes are repaired only by manual Sync.
- **External systems:** called by MailTrixy; payload shape in `TW-MAIL-018`.
- **Settings:** `mailtrixy_secret` (encrypted).
- **Acceptance criteria:**
  - Given a wrong or missing secret, When a push arrives, Then 401 and nothing is stored.
  - Given a push for an unlinked account, When it arrives, Then 200 `ignored` and nothing is stored.
  - Given a valid push for a linked mailbox, When it arrives, Then the message is stored once and the response carries the conversation id.
  - Given the same push is delivered twice, When processed, Then one message exists.
- **Source refs:** `app/Http/Controllers/Api/MailtrixyInboundController.php`, `routes/api.php`.
- **Port notes:** not ported when the native Gmail path replaces the bridge: inbound arrives from the Gmail sync worker (`TW-MAIL-021`) calling the same ingest service. If the bridge is retained, make it a public controller that resolves the tenant from the account through a SECURITY DEFINER lookup (same shape as the Telegram routing token), keep the always-acknowledge-unlinked behavior and add a throttle.

### TW-MAIL-007 — Inbound ingest: thread, message, contact, preview, unread, realtime event

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-MAIL-003
- **Summary:** One engine message becomes an inbox conversation row (created on first sight) and a message row, with a lead contact for the sender, a refreshed preview and unread counter, and a realtime event.
- **Actors & access:** system (push or sync).
- **UX & screens:** the inbox thread (owned by team-inbox-conversations); see `TW-MAIL-008`.
- **Endpoints:** none of its own (`TW-MAIL-006`, `TW-MAIL-004`).
- **Data:** `conversations`: `channel email`, `provider email`, `origin email`, `raw_jid email:<mirrorRowId>:<engineConversationId>` (when the engine sends no conversation id the key is `email:<rowId>:unknown-<md5 of the payload>`, so such a message makes its own thread), `status pending`, `inbox_status open`, `title`, `preview` (140 characters), `last_message_at`, `last_inbound_at`, `unread_count`. `inbox_messages`: `direction in|out`, `body` (plain text), `status received|sent`, `sent_at`, `delivered_at`, `meta.email` with `subject`, `from_email`, `from_name`, `to_email`, `mtx_conversation_id`, `mtx_message_id`, `mtx_account_id`, `html` (cut to 65,535 bytes without splitting a UTF-8 character). `contacts`: a social contact with `channel email`, `channel_uid` the sender address, name, `msg "Source: Email"`.
- **Rules & edge cases:**
  1. Only `event = message` is processed; anything else returns null.
  2. Thread title = the message subject, else the thread subject, else the sender name, else the sender address, else "Email". The title is **overwritten on every message**, so it follows the latest subject (QUIRK).
  3. Body = plain text part, else the HTML with tags stripped. Quoted history is **not** removed from stored bodies (only the flow runtime strips it).
  4. Dedupe: a message with the same engine message id already on this thread returns the stored row and does nothing else (no second unread, no second automation).
  5. Send time = the engine's ISO timestamp when parseable, else now, so history keeps its order.
  6. Direction `out` (a message sent on the engine side) is stored with status `sent`, increments nothing and creates no contact.
  7. Inbound only: the sender becomes a contact keyed by address. The contact capture never throws. QUIRK: the address is stored as `channel_uid`, **not** copied into the contact's email field, so these contacts are invisible to email campaigns and email search until someone edits the contact (the inbox contact panel has an inline name/email editor).
  8. A resolved thread reopens (`inbox_status` back to `open`) on any new message, inbound or outbound.
  9. `unread_count` +1 only for inbound; `last_inbound_at` or `last_outbound_at` is set by direction.
  10. A realtime `MessageReceived` event fires with direction.
  11. No contact-quota check, no plan check, no spam or auto-responder filter.
  12. Automation then runs for inbound only (`TW-MAIL-011`), after the message is stored, and its failures never block the store.
- **Async & events:** realtime event `MessageReceived(inboxMessageId, conversationId, workspaceId, direction)`; log `[MAILTRIXY] inbox message stored`. No outbox, no notification, no audit.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a first inbound message on a new engine conversation, When ingested, Then one conversation, one message, one contact exist and unread is 1.
  - Given the same engine message id twice, When ingested, Then one message and unread 1.
  - Given a resolved thread, When a new message arrives, Then the thread is open again.
  - Given a message with a 200 KB HTML part, When stored, Then `meta.email.html` is at most 65,535 bytes and the plain body is intact.
- **Source refs:** `app/Services/Mailtrixy/MailtrixyIngestService.php`, `app/Models/Conversation.php` (`ENGINE_AGNOSTIC_CHANNELS`), `app/Models/Contact.php` (`forSocialSender`), `app/Events/Inbox/MessageReceived.php`.
- **Port notes:** the inbox owner exports an "ingest inbound message" service; email goes through it with the message ledger keyed on the RFC `Message-ID` (Reference keys on the engine's id). Replace the perpetual-per-engine-conversation model with the thread model of `TW-MAIL-025` and link the contact by email identity (fixes the invisible-contact quirk). Add the contact-quota behavior from the draft spec (store the message, flag it, link no contact).

### TW-MAIL-008 — Email in the inbox UI: channel badge, rail and tab filter, mail-style bubble

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-MAIL-007
- **Summary:** Email conversations sit in the unified queue with an envelope badge, can be filtered with an "Email" channel tab, and render as mail-like bubbles with the subject above the plain-text body.
- **Actors & access:** any inbox user who can see the conversation (same assignment and visibility rules as every channel). The channel filter entry shows only when the platform switch is on and the workspace has a connected mailbox.
- **UX & screens:** `resources/views/user/team-inbox/index.blade.php`, `resources/js/charts/user-team-inbox-index.js`. Channel key `em` with a mail glyph. Rail: "All" plus one icon per channel that is connected or present in the queue, each with a count when above zero. Channel tabs above the list appear only when more than one channel is in the queue. The bubble: an optional subject line with a mail icon (semibold, truncated), then the body with preserved line breaks; incoming left, outgoing right, time below. The serialiser exposes `email.subject` and `email.from` (from name, else from address). HTML mail is **not** rendered; attachments are not shown.
- **Endpoints:** part of the team-inbox list and thread payloads (`TeamInboxController@serializeListItem`, message serialiser); no email-specific route.
- **Data:** reads `conversations.channel`, `inbox_messages.meta.email`.
- **Rules & edge cases:**
  1. Filtering is client-side over the loaded queue; there is **no per-mailbox filter**, only per channel (all mailboxes together).
  2. The thread header shows the thread title (latest subject); the sender and receiving mailbox are not shown.
  3. When the last mailbox is unlinked the Email tab and all email threads disappear (`TW-MAIL-005`).
  4. Contact card shows the contact name; the contact's email field is usually empty (`TW-MAIL-007` rule 7).
- **Async & events:** the realtime `MessageReceived` event refreshes the list.
- **External systems:** none.
- **Settings:** `email_enabled`.
- **Acceptance criteria:**
  - Given an email and a WhatsApp conversation, When the inbox loads, Then the rail shows an Email icon and selecting it shows only the email thread.
  - Given an email message with a subject, When opened, Then the subject appears above the text in the bubble.
  - Given no connected mailbox, When the inbox loads, Then no Email tab is offered.
- **Source refs:** `resources/js/charts/user-team-inbox-index.js` (`CHANNEL_META`, `channelKey`, `renderChannelTabs`, `renderRailChannels`, email bubble), `resources/views/user/team-inbox/index.blade.php`, `app/Http/Controllers/TeamInboxController.php` (message serialiser, `email` block), `app/Models/Conversation.php`.
- **Port notes:** adapter and badge go in the web inbox feature; extend the existing channel enum with `email`. `TW-MAIL-024` replaces the single Email tab with one entry per mailbox; keep an "All email" aggregate so the Reference tab remains.

### TW-MAIL-009 — Reply from the inbox through the mailbox

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-MAIL-007, TW-MAIL-018
- **Summary:** An agent types a reply in the normal composer; the dispatcher hands the text to the email engine, which sends it on the same thread so the customer sees one continuous conversation.
- **Actors & access:** any agent who can reply in the inbox. No plan check at send time.
- **UX & screens:** the standard inbox composer; the sent row shows sent or failed with an error string like any channel. There is no subject field, no cc, no bcc, no attachment control that works.
- **Endpoints:** the shared inbox send route (team-inbox); this feature is the email branch of `InboxDispatcher`. Selected when the conversation channel or the message provider is `email`, **before** the engine-agnostic short-circuit.
- **Data:** reads `conversations.raw_jid`, `workspace_email_accounts`; the sent `inbox_messages` row gets status from the result; the engine creates its own outbound message.
- **Rules & edge cases:**
  1. The engine conversation id is the **third segment** of `raw_jid` (`email:<rowId>:<engineConversationId>`); a missing or non-numeric id (and not a campaign address, `TW-MAIL-010`) fails with "This email thread has no linked conversation to reply on."
  2. The mirror row (row id = second segment) must exist, belong to the workspace and be `connected`; otherwise the reply fails with "The email account for this thread is no longer linked. Re-link it on the Numbers page." (the page is now called Devices, QUIRK).
  3. The bridge must be configured; otherwise the failure is a setup hint naming the Add-ons page for admins and "contact support" for others.
  4. Only the plain text body is sent (`html` omitted). The subject and the recipient are decided by the engine from its own thread (Threadwise sends neither).
  5. Media attached in the composer is **ignored** by the email branch: nothing is sent and no error is raised (QUIRK).
  6. Result is mapped to the standard shape `{ok, platform EMAIL, provider_id (engine message id), local_only false, error}`; a failed send marks the row failed with the engine's error or "Email send failed."
  7. A reply is never charged to a wallet and is not counted against `email_monthly_limit` at send time.
- **Async & events:** synchronous call (15 s timeout); logs `[EMAIL-SEND]`. No retry button beyond the standard failed-row behavior.
- **External systems:** bridge `POST /api/threadwise/reply` `{conversation_id, text, html?}` returning `{ok, message_id, delivery_status}`.
- **Settings:** `mailtrixy_url`, `mailtrixy_secret`.
- **Acceptance criteria:**
  - Given a linked mailbox thread, When an agent sends "Thanks", Then the engine receives the reply on that conversation and the row is marked sent with the engine message id.
  - Given the mailbox was unlinked, When an agent replies, Then the row is marked failed with the no-longer-linked message.
  - Given an image is attached, When sent, Then only the text leaves and no error is shown.
- **Source refs:** `app/Services/InboxDispatcher.php` (`dispatchMailtrixy`), `app/Services/Mailtrixy/MailtrixyClient.php` (`reply`), `app/Models/WorkspaceEmailAccount.php` (`forConversation`).
- **Port notes:** native send is `TW-MAIL-022` (Gmail API with `In-Reply-To` and `References`, subject `Re: ...`, From = the thread's mailbox, display name of the agent). A generated `Message-ID` plus the client reference makes a retry idempotent. Surface a clear error rather than silently dropping attachments (`TW-MAIL-027`).

### TW-MAIL-010 — Reply on a campaign-mirrored thread (one-off send)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-MAIL-009, TW-MAIL-014
- **Summary:** A campaign email has no engine conversation, so its inbox thread is keyed by the recipient address. Replying there sends a fresh one-off message from the same mailbox with a "Re:" subject.
- **Actors & access:** any agent replying in the inbox.
- **UX & screens:** the thread looks like any email thread (title is the address).
- **Endpoints:** the email branch of the dispatcher (`TW-MAIL-009`); bridge `POST /api/threadwise/send`.
- **Data:** thread `raw_jid = email:<rowId>:<recipient address>`; subject from the latest earlier message's `meta.email.subject` within the last five rows; the body is plain text.
- **Rules & edge cases:**
  1. The address segment must be a valid email, otherwise the thread has no usable id and the reply fails (`TW-MAIL-009` rule 1).
  2. Subject = the last known subject, with "Re: " prefixed unless it already starts with "Re:" (case-insensitive), CR/LF flattened to spaces (header-injection guard), capped at 255; if none is found the subject is "Message".
  3. The body is escaped and line breaks converted before it becomes HTML mail; the plain text is sent too.
  4. Every campaign to the same address collapses onto one thread per mailbox.
  5. The reply is **not** threaded into the recipient's mail client thread (no headers are sent), unlike a conversation reply.
- **Async & events:** synchronous; `[EMAIL-SEND]` log.
- **External systems:** bridge `POST /api/threadwise/send {account_id, to, subject, html, text}`.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a campaign thread with last subject "Spring sale", When an agent replies, Then a one-off goes to the address with subject "Re: Spring sale".
  - Given a subject already "Re: Spring sale", When replying, Then it is not double-prefixed.
  - Given no earlier subject, When replying, Then the subject is "Message".
- **Source refs:** `app/Services/InboxDispatcher.php` (`dispatchMailtrixy`, `emailThreadSubject`), `app/Services/Mailtrixy/EmailCampaignRunner.php` (`mirrorToInbox`), `app/Services/Mailtrixy/MailtrixyClient.php` (`send`).
- **Port notes:** in the native model a campaign send creates a real thread with a real `Message-ID`, so this special case disappears; keep the observable result (reply goes out from the same mailbox, "Re:" subject) and add proper threading headers.

### TW-MAIL-011 — Automation chain on inbound mail: flow, routing, AI agent, keyword reply

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-MAIL-007
- **Summary:** After an inbound message is stored, a published email flow bound to the receiving mailbox gets the first chance; if no flow consumes it, routing rules run, then an assigned AI agent answers, otherwise keyword auto-replies fire.
- **Actors & access:** system.
- **UX & screens:** none.
- **Endpoints:** Node `POST /api/email-flow/inbound` (header `X-Node-Token`).
- **Data:** reads `flows` (`flow_type email`, published and active, `trigger_device_id` = the mirror row id, `trigger_keywords`), `keyword_replies`, conversation assignment.
- **Rules & edge cases:**
  1. Flow start: among published, active email flows bound to **this** mailbox, newest first, the first whose keyword list matches the body (comma-separated, case-insensitive, substring match; `any`, `*`, `.*`, `.+` match everything). No keywords means the flow never starts by trigger.
  2. The hand-off always goes to Node (to start a matched flow or to **resume** a parked one); Node answers synchronously whether the message was consumed. If Node is unreachable or the URL is unset, the answer is "not consumed".
  3. Consumed means: none of the PHP chain runs (no double replies).
  4. Not consumed: the routing engine is applied (`isFollowUp` true when the conversation already existed), then, if an AI agent is assigned, it responds; otherwise the keyword dispatcher runs with the body and the sender address.
  5. The whole block is wrapped so a failure never blocks the stored message.
  6. The match uses the full body including quoted history (the strip only happens inside the Node runtime, `TW-MAIL-012`). QUIRK.
- **Async & events:** Node call (15 s timeout); outgoing replies go through `TW-MAIL-009` or `TW-MAIL-013`.
- **External systems:** Node bridge (`baileys_server_url` or env `SERVER_URL`), token `node_token()`.
- **Settings:** `baileys_server_url` / `SERVER_URL`, node token.
- **Acceptance criteria:**
  - Given a flow bound to mailbox A with keyword "refund", When mail to A says "I need a refund", Then the flow starts and no keyword reply is sent.
  - Given the same mail to mailbox B (no flow), When ingested, Then routing and keyword rules apply instead.
  - Given Node is down, When mail arrives, Then it is stored and the PHP chain runs.
- **Source refs:** `app/Services/Mailtrixy/MailtrixyIngestService.php` (`resolveEmailKeywordFlow`), `app/Services/Mailtrixy/EmailFlowBridge.php`, `node/controllers/emailFlowController.js`, `app/Models/Flow.php`.
- **Port notes:** the chain order is shared with Telegram and the other bridge channels; build it once in the inbox ingest hook and give email its adapter. Add loop protection before the chain (`TW-MAIL-032`), which Reference does not have (an auto-responder replying to an auto-reply can loop).

### TW-MAIL-012 — Email flows: binding to a mailbox, Node runtime, numbered choices, quote stripping

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** TW-MAIL-011, flow-runtime-engine
- **Summary:** The flow builder offers an Email flow type bound to one linked mailbox. The Node runtime walks the graph, waits on delays, parks on questions and resumes on the next reply, answering by sending mail through PHP.
- **Actors & access:** workspace members who can build flows; the flow's channel is set on the Trigger node (flow type `email`).
- **UX & screens:** flow builder trigger node: channel Email and a mailbox picker listing the workspace's connected mailboxes (key `email:<rowId>`, label = name or address or "Email <id>"), only when the platform switch is on and a mailbox is connected. Node types that make no sense for email are hidden. Supported steps: message, media, buttons, ask, delay, condition, webhook, AI, end.
- **Endpoints:** Node `POST /api/email-flow/inbound` request `{accountId, conversationId (engine conversation id), workspaceId, text, flow?, flowId?, vars?, appDomain, auth{base,token}}` and response `{ok, consumed, mode}`; PHP `FlowsController` accepts `flow_type` `email` in create, import and template paths.
- **Data:** `flows.flow_type = email`, `flows.trigger_device_id` = mirror row id, `trigger_keywords`; Node keeps live sessions in memory keyed by `<accountId>_<engineConversationId>` (lost on restart; a Node restart drops parked flows, QUIRK).
- **Rules & edge cases:**
  1. Buttons are rendered as a **numbered list** appended to the message; a reply matches an option by its label or its 1-based number, with or without a trailing dot, or the pasted line "2. Support".
  2. Before matching or saving an answer, the runtime **cuts the reply at the first quote or signature marker**: a line starting with ">", an "On <date> ... wrote:" line, a "-----Original Message-----" line, a long underscore rule, a line starting "From:" (forwarded header block), a lone "--", or "Sent from my ...". If nothing is left, the whole text is used so an `ask` is still answered by a quote-only reply.
  3. Media steps are sent as a **link line** under the caption (the engine's reply contract carries text and HTML only).
  4. Delay units: seconds, minutes (default), hours, days.
  5. Smart nodes (AI, webhook) are resolved by PHP (`TW-MAIL-013`).
  6. Conversation id must be the engine's **numeric** id; a campaign thread (address key) cannot carry a flow session.
  7. Unlinked or non-connected mailboxes cannot send flow messages.
- **Async & events:** Node `await` timers for delays; sessions pruned by the runtime.
- **External systems:** Node bridge; callbacks to PHP `TW-MAIL-013`.
- **Settings:** node token and URL.
- **Acceptance criteria:**
  - Given a flow with a buttons step "1. Sales / 2. Support", When the customer replies "2.", Then the Support branch runs.
  - Given a reply "Support\n\nOn Mon, X wrote:\n> older text", When matched, Then the quoted part is ignored.
  - Given a media step, When sent, Then the mail contains the caption and the file URL on its own line.
- **Source refs:** `node/services/emailFlowService.js`, `node/controllers/emailFlowController.js`, `app/Services/Mailtrixy/EmailFlowBridge.php`, `app/Http/Controllers/FlowsController.php`, `app/Models/Flow.php`, `resources/js/charts/user-flows-builder.js`.
- **Port notes:** the flow engine itself belongs to flow-runtime-engine and node-bridge-runtime; this domain supplies the channel adapter (send text, send choices as a numbered list, send media as link) and the `stripQuoted` rule as a shared helper. Persist parked sessions in the database rather than process memory.

### TW-MAIL-013 — Email flow callbacks: flow-send, flow-node (AI, webhook), flow-log

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-MAIL-012
- **Summary:** Three callbacks Node uses to send mail (so no mail secret lives in Node), resolve AI and webhook nodes, and mirror an already-sent flow message into the inbox.
- **Actors & access:** Node only, header `X-Node-Token` compared in constant time.
- **UX & screens:** none.
- **Endpoints:**

| Method uri               | Route name | Controller@action                      | Middleware | Request fields                                                                                   | Response                   |
| ------------------------ | ---------- | -------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------ | -------------------------- |
| POST api/email/flow-send | none       | Mailtrixy\EmailFlowNodeController@send | api        | `accountId`, `conversationId` (numeric), `kind` text/menu/media, `text`, `options[]`, `mediaUrl` | `{ok, message_id, error}`  |
| POST api/email/flow-node | none       | Mailtrixy\EmailFlowNodeController@node | api        | `action` or `type` ai/email_ai/webhook, `node`, `vars`, `workspaceId`                            | `{ok, type, reply?/vars?}` |
| POST api/email/flow-log  | none       | Mailtrixy\EmailFlowNodeController@log  | api        | `accountId`, `conversationId`, `body` or `text`, `source`                                        | `{ok:true}`                |

- **Data:** writes outbound `inbox_messages` (meta `email.source = flow`, engine ids) and conversation preview and `last_outbound_at` through a mirror helper.
- **Rules & edge cases:**
  1. 401 `{ok:false}` on a bad token. `send` fails (200 with `ok:false`) on a missing account, non-numeric conversation id, unlinked account, unconfigured bridge or empty body.
  2. `menu` becomes the text plus a blank line and a numbered list (each title cut at 200 characters). `media` becomes text plus the URL. The mail is sent as text and as HTML with line breaks escaped.
  3. A successful send is mirrored into the inbox as an outbound row; a failed one is only logged.
  4. AI node: model prefix picks the provider (claude, gemini, mistral families, default OpenAI gpt-4o-mini), system prompt default "helpful assistant replying inside an email conversation", optional knowledge-base assistant appended, `save` variable returned; max tokens 350, temperature 0.7 by default.
  5. Webhook node: only public http(s) hosts (DNS-resolved, private and reserved ranges refused), methods GET, HEAD, POST, PUT, PATCH, DELETE, no redirects, 15 s timeout, response saved as a variable and flattened into dotted keys.
  6. `log` only mirrors; it requires a connected account and a numeric conversation id and an non-empty body.
- **Async & events:** none.
- **External systems:** bridge `reply`; AI providers through the AI agent service; arbitrary webhook URLs.
- **Settings:** node token.
- **Acceptance criteria:**
  - Given a menu send with two options, When called, Then the engine receives the text followed by "1. ..." and "2. ..." and the inbox shows an outbound row.
  - Given a webhook node pointing at a private IP, When called, Then `ok:false` and no request is made.
  - Given a wrong token, When any callback is called, Then 401.
- **Source refs:** `app/Http/Controllers/Mailtrixy/EmailFlowNodeController.php`, `routes/mailtrixy-email.php`, `node/services/emailFlowService.js`.
- **Port notes:** the SSRF guard (public hosts only) must be reused from the shared webhook-node implementation. Native send replaces the bridge reply call.

### TW-MAIL-014 — Email campaigns: sender, subject, personalisation, pacing, plan cap, inbox mirror

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** TW-MAIL-003, campaigns
- **Summary:** In the campaign builder, choosing Email lets the user pick a linked mailbox as the sender, write a subject and body, pick an audience and schedule; a PHP runner sends one mail per contact through the engine and records per-recipient status and an inbox mirror.
- **Actors & access:** workspace members who can create campaigns; plan `access_email`; plan cap `email_monthly_limit`.
- **UX & screens:** campaign chooser card "Email" (`?channel=email` shows only email senders), builder fields: sender (the mailbox picker with key `email:<rowId>`), Header field doubles as the **Subject** (blank falls back to the campaign name), body from a template's plain text or the free message. Campaign list includes email campaigns when the platform switch is on. Detail page, KPIs, scheduling, recurrence, pause and resume are the campaigns domain's.
- **Endpoints:** shared campaign routes; the runner is invoked by the campaign runtime for senders whose provider is `email`.
- **Data:** `wp_campaigns.device_id` = the mirror row id; per-recipient `wp_campaign_contacts` (status queued, sent, failed, skipped, unsubscribed; error text); inbox mirror thread `email:<rowId>:<address>`.
- **Rules & edge cases:**
  1. One runner per campaign (a 180 s cache lock) so a sweep cannot start a second run.
  2. Gate order: plan feature `access_email` (else campaign fails "Your plan does not include Email."); sender row must belong to the workspace and be connected, bridge configured (else failed with a setup hint); monthly cap check against the count of outbound email rows this calendar month (checked **once at start**, not per recipient, so one run can overshoot, QUIRK).
  3. Recipients: contacts with a non-empty email, not opted out. Because `contacts.email` is encrypted, filtering is done in memory. Duplicate addresses in one run are mailed once, the rest marked skipped "Duplicate email address". Opted-out contacts are marked unsubscribed; contacts without an address are skipped "No email address on this contact". No recipients at all: campaign failed "No recipients with an email address".
  4. Personalisation tokens `{{...}}` resolve through the shared template resolver, in both body and subject; the subject has CR/LF flattened and is cut at 255; empty subject becomes "Message".
  5. An invalid address or empty body marks that recipient failed.
  6. The body is plain text, escaped and line-broken to HTML, with the raw text as the plain part.
  7. Wall-clock budget of 20 seconds per run, then the campaign is re-armed as scheduled for the rest; a recipient already sent, skipped or unsubscribed on a prior chunk is never mailed again; cancel or pause mid-run stops at once and keeps the operator's status; passing the campaign's auto-end date marks the unsent as failed.
  8. Final status: completed, completed_with_errors or failed; KPIs recomputed.
  9. Each sent mail is mirrored into the inbox as an outbound row on the address thread; mirror failures are logged only.
  10. Email never touches the WhatsApp wallet.
- **Async & events:** runs from the campaign sweeper and after-response; heartbeat every 10 s.
- **External systems:** bridge `POST /api/threadwise/send`.
- **Settings:** plan `access_email`, `email_monthly_limit`.
- **Acceptance criteria:**
  - Given 3 contacts (one opted out, one without address), When the campaign runs, Then one mail is sent and the others are marked unsubscribed and skipped.
  - Given two contacts with the same address, When it runs, Then one mail goes out and one is skipped as duplicate.
  - Given the monthly cap is already reached, When the campaign starts, Then it fails with the cap message and sends nothing.
  - Given the plan lacks Email, When it starts, Then it fails with "Your plan does not include Email."
- **Source refs:** `app/Services/Mailtrixy/EmailCampaignRunner.php`, `app/Http/Controllers/WaCampaignsController.php`, `app/Services/PlanLimitGuard.php`, `app/Services/WorkspaceEngine.php`.
- **Port notes:** the campaigns domain owns builder, audience, scheduling and analytics; this domain provides the email transport (`send(mailboxId, to, subject, html, text)`) as a provider adapter. Real unsubscribe links and bounce handling are absent in Reference (the docs claim central suppression; that lives in MailTrixy, `TW-MAIL-032`). Gmail's daily sending limits (consumer and Workspace) make bulk campaigns from a connected Gmail a risk; see Open questions 9.

### TW-MAIL-015 — Mailbox-scoped auto-reply rules and sender pickers

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-MAIL-003, auto-reply-keywords
- **Summary:** Welcome, Away, Out-of-hours and Keyword auto-reply rules can be bound to a specific mailbox, and every sender picker in the product (auto-reply, flows, campaigns, AI agent assignment) lists linked mailboxes as senders.
- **Actors & access:** workspace members managing those features.
- **UX & screens:** the unified sender picker shows an entry per mailbox (key `email:<rowId>`, label = name, else address, else "Email · #id"). The auto-reply manager and its dashboard counters include `provider = email` rules only while the platform switch is on and a mailbox is connected.
- **Endpoints:** none of its own.
- **Data:** `keyword_replies.provider = email`, `keyword_replies.device_id` = mirror row id; conversation `raw_jid` carries the same row id.
- **Rules & edge cases:**
  1. Email conversations carry **no** `device_id`, so a mailbox-bound rule is matched by parsing the row id out of `raw_jid` and comparing with `provider = email` (provider-exact so a mirror row id never collides with a real device id).
  2. A rule with no sender fires on every mailbox.
  3. `{{email}}` is a merge field available in replies from the contact.
  4. The sender list is gated by the platform switch, the plan flag `access_email` **and** a live connected mailbox; stale rows do not appear after the bridge is disconnected.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `email_enabled`.
- **Acceptance criteria:**
  - Given a Welcome rule bound to support@, When mail arrives at sales@, Then it does not fire; at support@ it does.
  - Given the bridge is disconnected, When opening the picker, Then no mailbox is offered.
- **Source refs:** `app/Services/WorkspaceEngine.php` (email engine branch of `senders`), `app/Services/Inbox/KeywordReplyDispatcher.php` (`bridgeSenderRowId`), `app/Models/KeywordReply.php`, `app/Http/Controllers/AutoReplyController.php`, `app/Http/Controllers/FlowsController.php`.
- **Port notes:** the new `mailboxes` id becomes the sender key; migrate nothing (Reference table has zero rows in our DB). Carry the provider-exact rule so an email mailbox id never matches a WhatsApp device id.

### TW-MAIL-016 — Gates: platform switch, plan flag, monthly cap, visibility rule

- **Status:** partial
- **Priority:** P0
- **Effort:** M
- **Depends on:** plans-subscriptions-trials
- **Summary:** Four independent gates decide whether email exists for a workspace. They are applied in different places and not uniformly.
- **Actors & access:** platform admin sets the switch and plan columns; workspaces experience the result.
- **UX & screens:** Admin > Packages: checkbox "Email (linked mailbox)" and number "Emails / month (0 = unlimited)". Nav item "Email" (admin tier, links to `/devices`) is hidden unless the platform switch is on and the plan has `access_email`.
- **Endpoints:** none of its own.
- **Data:** `packages.access_email` (boolean, default false), `packages.email_monthly_limit` (integer, default 0), `system_settings.email_enabled`.
- **Rules & edge cases:**
  1. Where it is enforced: the nav item (switch plus plan), the sender lists (switch, plan, connected mailbox), the campaign runner (plan, cap), the inbox channel entry and the auto-reply scope (switch plus connected mailbox).
  2. Where it is **not**: the Devices link, sync and unlink actions and the inbound push ignore `access_email`, so a workspace on a plan without Email can still link a mailbox, receive mail and reply from the inbox (QUIRK). The documentation says the plan flag is "the most common reason the channel appears to be missing", which is true only for the nav item and the pickers.
  3. Visibility: the engine-agnostic channel rule lets email conversations into the inbox queries only while the workspace has at least one connected mailbox **and** the bridge is connected (`mailtrixy_connected` and URL and secret set), memoised per request. Disconnecting the bridge hides all email threads for every workspace without deleting them.
  4. The cap is per calendar month, counts all outbound email rows of the workspace (replies, flow messages and campaign mails alike) but is only checked when a campaign starts; 0 or null means unlimited; platform admins bypass plan checks.
  5. There is no per-mailbox count limit anywhere in Reference.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `email_enabled`; plan `access_email`, `email_monthly_limit`.
- **Acceptance criteria:**
  - Given the plan lacks `access_email`, When a user opens the nav, Then no Email item shows.
  - Given the platform switch off, When the inbox loads, Then email conversations are not in the queue.
  - Given a cap of 100 and 100 outbound email rows this month, When a campaign starts, Then it fails with the cap message.
- **Source refs:** `app/Support/UserNav.php`, `app/Services/WorkspaceEngine.php`, `app/Models/Conversation.php` (`scopeVisibleToWorkspaceEngine` area), `app/Models/WorkspaceEmailAccount.php` (`hasConnected`), `app/Models/Package.php`, `app/Services/PlanLimitGuard.php`, `database/migrations/2026_08_30_000700_add_email_plan_columns_to_packages.php`.
- **Port notes:** enforce the plan flag everywhere (link, send, receive) in the port and document it as a deliberate tightening in parity; do not silently drop it. Keep the cap semantics for campaigns. `TW-MAIL-030` adds the mailbox-count limit. Decide whether history stays visible after the last mailbox is disconnected (Reference hides it).

### TW-MAIL-017 — Admin enablement: Email channel toggle and bridge connection status

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-ADD-019
- **Summary:** Platform admins turn the Email channel on or off in Channel Settings and connect or disconnect the engine on the Add-ons page.
- **Actors & access:** platform admin.
- **UX & screens:** Channel Settings tile "Email" (blue-violet) with Enabled or Disabled and a section with a switch and the explanation that mailboxes link on the Numbers page after connecting the engine; saved with the other provider switches (setting `email_enabled`). Add-ons "Email" card is `TW-ADD-019` and `TW-ADD-020` (documented in addons-extension-registry; this feature only consumes them).
- **Endpoints:** the Channel Settings provider save (admin) with field `email_enabled` (`sometimes|boolean`); the connect and disconnect routes `POST admin/extensions/mailtrixy/connect` and `POST admin/extensions/mailtrixy/disconnect` (owned by `TW-ADD-019/020`).
- **Data:** `system_settings`: `email_enabled`, `mailtrixy_url`, `mailtrixy_secret` (encrypted), `mailtrixy_brand`, `mailtrixy_connected`, `mailtrixy_last_check`, `mailtrixy_last_inbound`.
- **Rules & edge cases:**
  1. The switch alone does nothing visible until the bridge is configured; the bridge alone does nothing until the switch is on and a plan has the flag.
  2. A successful inbound push sets `mailtrixy_connected` (`TW-MAIL-006`).
  3. Disconnect clears URL, secret and the flag but keeps the brand.
- **Async & events:** audit rows `admin.mailtrixy.connect` and `.disconnect` (owned by the addons domain).
- **External systems:** `TW-MAIL-018`.
- **Settings:** as above.
- **Acceptance criteria:**
  - Given the switch off, When any workspace opens Devices, Then no email surface shows.
  - Given the switch on and the bridge connected, When a plan has Email, Then the nav and pickers show email.
- **Source refs:** `resources/views/admin/settings/channel-setting.blade.php`, `app/Http/Controllers/AdminPagesController.php` (`email_enabled`), `app/Http/Controllers/Admin/ExtensionController.php`, `routes/admin.php`.
- **Port notes:** for the native path the switch stays (hides the whole channel platform-wide); the bridge connect card becomes the operator console's Email providers page (`TW-MAIL-029`).

### TW-MAIL-018 — Bridge client contract (the MailTrixy API surface Reference calls and exposes)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** none
- **Summary:** The complete contract between Threadwise and MailTrixy. Every call carries one shared secret in `X-Mailtrixy-Secret`. This is recorded so the Reference behavior can be understood and tested; it is an **external system**, not code to port.
- **Actors & access:** server to server.
- **UX & screens:** none.
- **Endpoints (Threadwise calls MailTrixy, base URL from settings, 15 s timeout, JSON):**

| Call                          | Purpose                                                                 | Request                                                 | Response                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| GET /api/threadwise/handshake | prove reachability and secret match                                     | none                                                    | `{ok:true, service:'mailtrixy', brand}`; success is 2xx and `ok === true` or `service === 'mailtrixy'`      |
| GET /api/threadwise/accounts  | list mailboxes (owner-scoped by email)                                  | `owner_email?`                                          | `{ok, accounts:[{id, workspace_id, email, name, provider, status}]}`; any failure degrades to an empty list |
| GET /api/threadwise/messages  | pull a page of inbound mail, oldest first, in push shape                | `account_id`, `owner_email?`, `after_id?`, `limit` (50) | `{ok, messages[], next_after_id}`                                                                           |
| POST /api/threadwise/reply    | reply on an engine conversation (engine performs SMTP, keeps threading) | `conversation_id`, `text?`, `html?`                     | `{ok, message_id, delivery_status}` or `{ok:false, error}`                                                  |
| POST /api/threadwise/send     | one-off send from an account                                            | `account_id`, `to`, `subject`, `html`, `text?`          | `{ok, message_id?}`                                                                                         |

Inbound push payload (MailTrixy calls Threadwise): `{event:'message', mtx_workspace_id, account{id, workspace_id, email, name}, conversation{id, subject}, message{id, direction in|out, from_email, from_name, to_email, subject, text, html, at}}` to `POST /api/mailtrixy/inbound` (`TW-MAIL-006`).

- **Data:** none.
- **Rules & edge cases:**
  1. The client never throws: failures become `{ok:false, error}` (HTTP status text or the exception message, cut at 150 characters for pulls).
  2. "Configured" = URL and secret both non-empty; "connected" = configured and the saved flag set.
  3. The engine is multi-tenant; tenant separation is the owner-email filter (`TW-MAIL-002`) and the engine's own workspace ids.
  4. Reply and send carry no cc, bcc, attachments or custom headers: the contract itself is why Reference has none of those.
- **Async & events:** none.
- **External systems:** MailTrixy (separate deployment, not part of this repo or the Reference source).
- **Settings:** `mailtrixy_url`, `mailtrixy_secret`, `mailtrixy_brand`.
- **Acceptance criteria:**
  - Given a correct URL and secret, When the handshake is called, Then it succeeds; with a wrong secret it fails and nothing else is called.
  - Given the engine is unreachable, When accounts are listed, Then an empty list is returned, not an error.
- **Source refs:** `app/Services/Mailtrixy/MailtrixyClient.php`, `app/Support/fc_helpers.php` (`mailtrixy_brand_name`), `Documentation/pages/channels/email.html`.
- **Port notes:** do not build a MailTrixy client unless the owner decides to keep the bridge (Open questions 1). The behaviors it provides (mailbox auth, sync, send, threading) are what `TW-MAIL-020` to `TW-MAIL-022` build natively.

### TW-MAIL-019 — Mailbox model and native Settings > Integrations > Email hub

- **Status:** port-addition
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-MAIL-030
- **Summary:** A first-class mailbox record owned by the workspace and a Settings > Integrations > Email screen where an admin connects, lists, renames, pauses and disconnects mailboxes. This replaces the mirror row and the Devices-only surface while the Reference rows (`TW-MAIL-001`) stay available.
- **Actors & access:** workspace admin with `mail.mailboxes.manage`; read-only list for `mail.mailboxes.read`. Gated by `channel_email` (plan) and the platform switch.
- **UX & screens:** Settings > Integrations > Email replaces the "Soon" tile. Tab **Connect**: provider cards (Google live, "Other mail" and Microsoft shown as coming until built, each with a status pill); tab **Organization emails**: list of mailboxes (address, display name, provider, status, last sync, unread count, default assignee/team, color dot, actions Sync now, Pause or Resume, Reconnect, Disconnect); a per-mailbox drawer to edit display name, color, default assignee and team (`TW-MAIL-023`) and signature (`TW-MAIL-027`). Later tabs: Signatures and templates, Health (`TW-MAIL-028`). When a provider is not enabled by the operator the card says "Ask your platform administrator" instead of a broken button.
- **Endpoints (proposed, final names at build):** `GET /v2/email/mailboxes`, `GET /v2/email/mailboxes/:id`, `PATCH /v2/email/mailboxes/:id` (name, color, default assignee, default team, signature, paused; optimistic version), `DELETE /v2/email/mailboxes/:id` (disconnect), `POST /v2/email/mailboxes/:id/sync`, `GET /v2/email/providers` (what is connectable).
- **Data:** table `mailboxes` (see Data model): provider, address, display name, scope, status, sealed credentials, sync cursor, defaults.
- **Rules & edge cases:**
  1. Tenant isolation by forced RLS and composite keys, like every tenant table; credentials never returned by the API (only "connected as <address>").
  2. Address is unique per workspace (case-insensitive). A mailbox cannot be connected by two workspaces (Reference rule: one workspace per mailbox); enforce globally with a neutral error that does not reveal the other tenant.
  3. Disconnect keeps the mailbox row as `disconnected` and its conversations visible read-only (improves Reference quirk of `TW-MAIL-005`).
  4. Pause stops sync and sending but keeps the row.
  5. Contracts live in `packages/contracts/src/channel-email/`.
- **Async & events:** outbox events `mail.mailbox.connected`, `.disconnected`, `.paused`, `.reauth_required`; audit rows for each.
- **External systems:** none directly; see `TW-MAIL-020`.
- **Settings:** platform switch `email_enabled`, plan feature `channel_email`.
- **Acceptance criteria:**
  - Given an admin with manage permission, When the Connect tab opens, Then Google shows a Connect button when the operator enabled it and "Ask your platform administrator" when not.
  - Given two mailboxes, When the list opens, Then both show status, last sync and unread count.
  - Given a read-only member, When the page opens, Then no connect or disconnect control is shown.
  - Given a mailbox is disconnected, When its threads are opened, Then history is readable and the composer is disabled with an explanation.
- **Source refs:** draft spec `docs/specs/email-channel-and-social-leads.md` (5.6, E-01, E-09, E-11); Reference rows `TW-MAIL-001`.
- **Port notes:** new module `apps/api/src/modules/channel-email/`, tables via the `add-migration` skill, screens in `apps/web/src/features/channel-email/`. Decide fate of the existing `workspace_email_accounts` table (Open questions 2). Add the Help guide and 21 locales as the repo rules require.

### TW-MAIL-020 — Connect Google (Gmail) by OAuth

- **Status:** port-addition
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-MAIL-019, TW-MAIL-029
- **Summary:** The admin presses "Connect Google", signs in to the Gmail or Google Workspace account (support@, sales@, any), grants access, and the mailbox is saved ready to sync, without a password ever being typed into Threadwise.
- **Actors & access:** workspace admin with `mail.mailboxes.manage`; the operator must have enabled Google with credentials (`TW-MAIL-029`).
- **UX & screens:** Connect tab card "Google (Gmail / Google Workspace)" opens a popup (full redirect as fallback) to Google's consent screen; on return the mailbox appears with status Connected and a "first sync running" note; errors shown inline (consent denied, wrong account, scope not granted, limit reached). A pre-consent hint explains the exact permissions requested and why.
- **Endpoints (proposed):** `POST /v2/email/connect/google/start` returns the authorization URL; `GET /v2/email/connect/google/callback` (public, state-verified) exchanges the code and redirects to the settings screen.
- **Data:** a `mailboxes` row with provider `google`, address from the userinfo or the Gmail profile, display name, sealed refresh token (and access token expiry), granted scopes, `status connected`, `history_id` null until the first sync.
- **Rules & edge cases:**
  1. Authorization Code flow with `access_type=offline` and `prompt=consent` so a refresh token is always returned; PKCE; OAuth `state` is signed and bound to the organization and user and expires in minutes.
  2. Scopes: Gmail read, send and modify as needed (the exact minimal set is decided with Open questions 3). These are Google **restricted scopes**: public launch needs Google app verification and a security assessment (long lead). During review the app works for listed test users only.
  3. Connecting an address already connected in this workspace re-uses the row (reconnect); connected by another workspace is refused with a neutral message.
  4. Mailbox limit (`TW-MAIL-023`) is checked before the redirect and again at the callback.
  5. Refresh and access tokens are sealed with the vault; never logged or returned.
  6. If Google returns no refresh token (previously granted without offline) the flow fails with a clear "reconnect and allow offline access" message.
  7. Disconnect revokes the token at Google (best effort) and clears secrets.
  8. `invalid_grant` or revoked access at any later time marks the mailbox `needs_reauth` (`TW-MAIL-028`), as the Google Calendar adapter does.
- **Async & events:** on success queues the initial backfill (`TW-MAIL-021`); outbox `mail.mailbox.connected`; audit row.
- **External systems:** Google OAuth 2.0 and Gmail API; credentials from the operator console with environment fallback (`TW-MAIL-029`); precedent: the Google Calendar adapter and `docs/runbooks/google-calendar-setup.md`.
- **Settings:** operator: client id, sealed secret, redirect URI, enabled.
- **Acceptance criteria:**
  - Given Google is enabled, When an admin completes consent for support@acme.com, Then a Connected mailbox exists and an initial sync is queued.
  - Given the user denies consent, When Google redirects back, Then no mailbox is created and the screen explains.
  - Given a tampered or expired `state`, When the callback is hit, Then it is rejected with no token exchange.
  - Given the workspace is at its mailbox limit, When Connect is pressed, Then the upgrade lock shows and no redirect happens.
- **Source refs:** draft spec 5.4 and E-07; pattern: Reference `GoogleCalendarOAuthController.php` (signed state, token storage).
- **Port notes:** provider adapter under `apps/api/src/infra/providers/channel-email/google/` behind an interface with a fake for tests. Write `docs/runbooks/gmail-setup.md` (Cloud project, consent screen, restricted-scope verification steps, redirect URIs, test users). Start the Google verification in week one.

### TW-MAIL-021 — Gmail inbound sync: backfill, incremental, repair

- **Status:** port-addition
- **Priority:** P0
- **Effort:** XL
- **Depends on:** TW-MAIL-020, TW-MAIL-025, TW-MAIL-026
- **Summary:** A worker keeps each Gmail mailbox's mail flowing into the inbox: a quiet backfill of recent history when connected, then frequent incremental polls, plus a manual Sync now. This replaces the engine push and the manual pull of Reference.
- **Actors & access:** system; admins trigger Sync now.
- **UX & screens:** "Sync now" and "Resync last 7 days" on the mailbox; last synced time and lag on the list and Health tab; the notification bell stays silent for backfilled history.
- **Endpoints (proposed):** `POST /v2/email/mailboxes/:id/sync` (body `{mode: 'incremental'|'resync'}`).
- **Data:** `mailboxes.history_id`, `last_synced_at`, `last_error`; messages and attachments via the ingest; the message ledger keyed on RFC `Message-ID` for idempotency.
- **Rules & edge cases:**
  1. Initial backfill: messages from the last 7 days (setting), oldest first, ingested as **quiet history** (no unread bump beyond the thread's inbound count rules, no notifications, no automation, no flow starts).
  2. Incremental: Gmail history API from the stored history id every 60 seconds (setting; 15 s on a mailbox with a conversation open is an option). If the history id has expired (Gmail returns not found) fall back to a bounded re-list and re-anchor.
  3. Which mail: INBOX and SENT; never SPAM, TRASH or DRAFT. Whether promotions/social categories are skipped is a decision (Open questions 5). Mail sent from our own composer is matched by the stored `Message-ID` and is not ingested twice. Mail sent directly in Gmail appears as an outbound message on its thread.
  4. Per-message idempotency on `Message-ID` (plus the Gmail message id); re-reads never duplicate; one bad message is recorded and skipped, the sweep continues; each run is bounded (messages and wall clock) and resumes.
  5. Backoff with jitter on rate limits and 5xx; a persistent auth failure flips the mailbox to `needs_reauth` (`TW-MAIL-028`) and stops polling that mailbox only.
  6. Messages over the size cap (setting) or attachments over the per-file cap are stored with a "too large" note rather than failing the run.
  7. Automation (`TW-MAIL-011`) runs for live inbound only, after loop protection (`TW-MAIL-032`).
  8. Workspace plan or switch turned off: polling stops without error.
- **Async & events:** BullMQ repeatable job per active mailbox plus an on-demand job; events `mail.message.received`; realtime inbox events like other channels.
- **External systems:** Gmail API (`users.history.list`, `users.messages.list/get`, `users.threads.get`); quota handling per user and per project.
- **Settings:** poll interval, backfill days, size caps (env `channel-email.env.ts`).
- **Acceptance criteria:**
  - Given a freshly connected mailbox with 40 mails in 7 days, When the backfill completes, Then 40 messages are in threads, no notification fired and no auto-reply sent.
  - Given a new mail arrives, When the next poll runs, Then it appears in the inbox within the interval and automation runs once.
  - Given the same message is read twice, When ingested, Then one message exists.
  - Given Gmail revokes access, When the next poll fails, Then the mailbox is `needs_reauth` and other mailboxes keep syncing.
- **Source refs:** draft spec E-03; Reference sync service for the idempotent-pull and resume-cursor ideas (`app/Services/Mailtrixy/MailtrixySyncService.php`).
- **Port notes:** worker job per the `worker-job` skill, processor in the worker process only; use the shared ingest service of the inbox. Idempotency via the message ledger; cursors advance only after the batch is committed.

### TW-MAIL-022 — Gmail outbound: reply and new message with correct threading

- **Status:** port-addition
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-MAIL-020, TW-MAIL-025
- **Summary:** Replies typed in the inbox leave through the Gmail API from the thread's mailbox, in the same Gmail thread, with proper headers, so the customer sees one continuous conversation. Starting a new email to a contact is supported too.
- **Actors & access:** agents with `inbox.conversation.reply`; the mailbox must be connected and not paused.
- **UX & screens:** the composer (`TW-MAIL-027`) with the From mailbox, To, Subject (prefilled `Re: <subject>`), body; sent state and failure with reason and retry.
- **Endpoints:** the shared inbox send endpoint with an email envelope variant (subject, cc, bcc, html, attachments, thread headers); idempotent on the client reference.
- **Data:** outbound message with the generated RFC `Message-ID`, `In-Reply-To`, `References`, Gmail message and thread ids, delivery status.
- **Rules & edge cases:**
  1. From = the mailbox address with the agent's display name (shared mailbox); the Gmail alias or send-as feature is out of scope.
  2. Subject is `Re: ...` unless it already starts with it; CR/LF stripped from every header value.
  3. `In-Reply-To` is the message being answered and `References` the chain; `threadId` passed to Gmail so it threads on Google's side as well.
  4. A retry with the same client reference never sends twice (the generated `Message-ID` is stored before the API call).
  5. A send on a `needs_reauth` mailbox fails fast with a reconnect hint; Gmail quota errors surface a readable message (daily sending limits differ for consumer and Workspace accounts).
  6. The sent message is stored immediately as outbound; the sync later recognises it by `Message-ID` and does not duplicate it.
  7. Replies are not metered against `email_monthly_limit` (Open questions 7).
- **Async & events:** synchronous API call from a send job so the request returns fast; outbox `mail.message.sent`; realtime event.
- **External systems:** Gmail API `users.messages.send`.
- **Settings:** per-message size cap.
- **Acceptance criteria:**
  - Given a thread from a customer, When an agent replies, Then the customer's client shows the reply in the same thread, from the mailbox address.
  - Given the send fails with a network error, When retried with the same reference, Then exactly one mail is delivered.
  - Given the mailbox is `needs_reauth`, When sending, Then the row fails with the reconnect message.
- **Source refs:** draft spec E-06; Reference dispatcher for the behavior being replaced (`app/Services/InboxDispatcher.php`, `dispatchMailtrixy`).
- **Port notes:** implement as a `ChannelAdapter` for kind `email` in the inbox; an email variant of the outbound envelope; header-building as a pure, unit-tested function.

### TW-MAIL-023 — Several mailboxes per workspace (limit of 2 to 3, per-mailbox defaults)

- **Status:** port-addition
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-MAIL-019, TW-MAIL-030
- **Summary:** A workspace can connect more than one mailbox (for example support@ and sales@) up to a plan limit, and each mailbox has its own defaults (default assignee or team, color, signature). Reference already allowed several linked mailboxes with no cap and no per-mailbox defaults.
- **Actors & access:** workspace admin with manage permission; the limit comes from the plan.
- **UX & screens:** Organization emails list with "2 of 3 mailboxes used" and an upgrade lock on Connect at the limit; per-mailbox drawer fields default assignee (user), default team, color (used in the inbox switcher), display name, signature.
- **Endpoints:** as `TW-MAIL-019`; limit enforced in `POST .../connect/google/start` and the callback.
- **Data:** `mailboxes.default_assignee_user_id`, `default_team_id`, `color`, `position`; plan limit `email_mailboxes`.
- **Rules & edge cases:**
  1. Default limit **3 per workspace** (owner asked for 2 to 3); configurable per plan; 0 or null follows the platform's existing "unlimited" convention for limits (decision in Open questions 4).
  2. Disconnected mailboxes do not count; paused ones do.
  3. New inbound conversations on a mailbox start unassigned unless a default assignee or team is set; the default applies only to new threads and never overrides an existing assignment. (Reference has no mailbox default; routing engines apply on top where they exist.)
  4. Deleting a user who is a default assignee clears the default rather than blocking.
  5. Each mailbox has its own sync cursor, error state and quiet backfill.
  6. Rules and flows bound to a mailbox (`TW-MAIL-015`) survive renames.
- **Async & events:** outbox event on limit reached for upsell analytics (optional).
- **External systems:** none.
- **Settings:** plan limit `email_mailboxes`.
- **Acceptance criteria:**
  - Given a plan limit of 3 and 3 mailboxes, When Connect is pressed, Then the upgrade lock shows.
  - Given a default assignee on sales@, When a new thread arrives there, Then it is assigned to that user; an existing thread's assignee is untouched.
  - Given one mailbox is disconnected, When counting, Then the usage is 2 of 3.
- **Source refs:** owner brief; draft spec 5.1, E-09, E-15; Reference had no cap (`TW-MAIL-016` rule 5).
- **Port notes:** limit check lives in the mailbox service so every connect path (Google, IMAP, Microsoft) shares it. Add the plan column through the plans domain, not here.

### TW-MAIL-024 — Multi-inbox view in the inbox: mailbox switcher, filter, counts, From selector

- **Status:** port-addition
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-MAIL-023, team-inbox-conversations
- **Summary:** The team inbox shows multiple email inboxes: an "All inboxes" entry and one entry per mailbox (colored, with unread count), so an agent can work support@ and sales@ separately or together. Reference only has a single aggregated "Email" channel tab.
- **Actors & access:** any inbox user, subject to the existing visibility scopes (all, team, own).
- **UX & screens:** in the inbox rail or filter bar, under the Email channel icon, a mailbox switcher: "All email" plus each connected mailbox (display name or address, color dot, unread badge); selecting one filters the conversation list server-side; the selection is remembered per user; conversation rows show a small mailbox chip when several mailboxes exist; the thread header shows "via support@acme.com"; the composer has a From selector for **new** emails and shows the fixed mailbox for replies; the empty state explains how to connect more.
- **Endpoints:** the conversation list query gains `mailbox_id` (and `channel=email`); counts endpoint returns unread per mailbox; mailbox list from `GET /v2/email/mailboxes`.
- **Data:** `conversations.mailbox_id` (nullable, set for email threads); counts by mailbox.
- **Rules & edge cases:**
  1. A reply always leaves from the mailbox of the thread (cannot be changed on a reply); only a new email picks From.
  2. Counts respect the same assignment visibility as the list.
  3. Filtering is server-side (not client-only as Reference) so large queues stay correct.
  4. A paused or needs-reauth mailbox keeps its entry with a warning marker; a disconnected mailbox's entry shows read-only history.
  5. Keep Reference's channel-level "Email" entry as the aggregate; the realtime event carries the mailbox id so counts update live.
  6. Auto-reply and flow pickers already treat each mailbox as its own sender (`TW-MAIL-015`).
- **Async & events:** realtime inbox events with `mailbox_id`.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given support@ and sales@ connected, When the inbox opens, Then the Email group shows both with their own unread counts.
  - Given the agent selects sales@, When the list reloads, Then only threads of that mailbox show.
  - Given a thread of support@, When replying, Then the From is support@ and cannot be changed.
  - Given a team-scoped agent, When counts load, Then they include only visible threads.
- **Source refs:** owner brief; draft spec E-01; Reference tab logic `resources/js/charts/user-team-inbox-index.js` (`renderRailChannels`).
- **Port notes:** extend the inbox filter contract with `mailbox_id` in `@crm/contracts` (contracts-change skill) and the SQL visibility; the web feature extends the existing rail with a nested switcher. Needs the inbox owner's agreement because it touches team-inbox-conversations.

### TW-MAIL-025 — One conversation per email thread, contact linked by email identity

- **Status:** port-addition
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-MAIL-007
- **Summary:** Each email thread (resolved from `Message-ID`, `In-Reply-To`, `References`, with a conservative subject fallback) is its own conversation, and the sender is linked to a contact by email address. Reference groups by the engine's conversation id and keys the contact by address without storing the email on it.
- **Actors & access:** system.
- **UX & screens:** a new subject from a known sender opens a new conversation under the same contact; a reply to an old resolved thread reopens that thread; the conversation title is the thread's original subject and does not change with later replies (Reference changes it each message).
- **Endpoints:** none of its own.
- **Data:** `conversations` with peer key `email:<mailboxId>:<thread key>`; `email_threads` mapping (conversation, mailbox, provider thread id, root `Message-ID`, normalised subject); `contact_identities` of type email.
- **Rules & edge cases:**
  1. Match order: `In-Reply-To` or any id in `References` already stored, then the provider thread id (Gmail thread id), then normalised subject plus the same participant set within a window (setting, default 14 days); otherwise a new thread.
  2. Normalised subject strips `Re:`, `Fwd:`, locale variants and brackets, case-folded.
  3. The same message arriving in two mailboxes (cc'd to both support@ and sales@) creates a thread per mailbox, not a merged one.
  4. A new message on a resolved thread reopens it; a different subject never reopens an old ticket.
  5. Sender matched by email identity (verified or not), created otherwise with source "Email"; contact quota reached: message stored, no contact linked, flagged.
  6. Mailing-list and no-reply senders still create threads (decision in `TW-MAIL-032`).
- **Async & events:** `contact.created` outbox event for new contacts (as other channels).
- **External systems:** none.
- **Settings:** subject-fallback window.
- **Acceptance criteria:**
  - Given a reply with matching `In-Reply-To`, When ingested, Then it joins the existing conversation and reopens it if resolved.
  - Given a new subject from the same sender, When ingested, Then a new conversation links to the same contact.
  - Given the contact quota is reached, When a new sender writes, Then the message is stored, unlinked and flagged.
- **Source refs:** draft spec 5.2, E-04, E-05; Reference key shape `app/Services/Mailtrixy/MailtrixyIngestService.php`.
- **Port notes:** requires `peer-key.ts` to stop assuming a phone number and the contact service's email identity path (`contact_identities`). Open questions 6 asks the owner to confirm per-thread over Reference's perpetual-per-engine-conversation.

### TW-MAIL-026 — Rich inbound message: sanitised HTML, cc, headers, attachments

- **Status:** port-addition
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-MAIL-025
- **Summary:** An email is stored with its plain text, a sanitised HTML copy, sender, recipients, cc, subject and headers, and its attachments as downloadable files. Reference keeps only plain text, subject, from and to, and a 64 KB HTML copy that is never rendered, with no attachments.
- **Actors & access:** system writes; inbox users read.
- **UX & screens:** the message bubble shows the HTML body in a sandboxed view with remote images blocked by default and a "Load images" action, "View full message" beyond the cap, a collapsed quoted history, a header line (from, to, cc, date), and attachment chips with name, size and download; inline images render.
- **Endpoints:** attachment download through the signed-URL file service; message payload gains the `email` block.
- **Data:** `inbox_messages.meta.email` allow-listed keys (subject, from, to, cc, bcc, message-id, in-reply-to, references, mailbox id); `message_attachments` (message, filename, content type, size, storage key, inline content id); HTML sanitised with the existing `sanitize-html` dependency.
- **Rules & edge cases:**
  1. Stored HTML capped at 64 KB (Reference's cap) with a link to the full message; plain text derived from the HTML when absent.
  2. Sanitisation removes scripts, forms, event handlers, remote CSS and tracking pixels as far as detectable; links open in a new tab with `noopener`.
  3. Per-attachment and per-message size caps (settings); over the cap the message shows "attachment too large" and is still stored.
  4. Executable and risky types are stored but never previewed inline; downloads use a content-disposition attachment header and are virus-scan ready (hook, scanner out of scope).
  5. Message body length limit of the generic message contract (4096 characters) is raised or bypassed for email (draft spec 5.3); the plain body keeps a preview-length column.
  6. Attachments count towards workspace storage.
- **Async & events:** attachments are downloaded from Gmail in a queue job, so the message appears first and the files follow.
- **External systems:** Gmail attachment endpoint; storage service.
- **Settings:** size caps, HTML cap.
- **Acceptance criteria:**
  - Given a mail with a 2 MB PDF and an inline logo, When ingested, Then the PDF is downloadable and the logo renders inline.
  - Given an HTML mail with a script and a tracking image, When displayed, Then the script is gone and the image is not loaded until the agent allows it.
  - Given an attachment over the cap, When ingested, Then the message shows "attachment too large" and ingest does not fail.
- **Source refs:** draft spec 5.3, E-03, E-10; Reference HTML cap `app/Services/Mailtrixy/MailtrixyIngestService.php`.
- **Port notes:** contract change for the message envelope and the allow-listed meta keys (contracts-change skill); one stored file per attachment in a small table (draft Open question).

### TW-MAIL-027 — Composer: rich text, cc/bcc, attachments, signature, saved replies

- **Status:** port-addition
- **Priority:** P1
- **Effort:** L
- **Depends on:** TW-MAIL-022, TW-MAIL-026
- **Summary:** The email composer supports rich text, cc and bcc, attachments, an automatic signature per mailbox and per agent, and the existing saved replies and templates with contact variables. Reference's email reply is plain text only and silently ignores attached files.
- **Actors & access:** agents with `inbox.conversation.reply`; signature management with `mail.mailboxes.manage` (mailbox signature) or the agent's own profile.
- **UX & screens:** email composer mode: To, Cc, Bcc (collapsed), Subject, rich editor, attach button with size and count limits, signature appended below the cursor (editable), template and saved-reply picker. Draft kept per conversation.
- **Endpoints:** the shared send endpoint with the email envelope (`TW-MAIL-022`); signature fields on the mailbox PATCH and user profile.
- **Data:** `mailboxes.signature_html`; user signature; outbound attachments linked to the message.
- **Rules & edge cases:**
  1. Variables in signatures: name, title, phone, mailbox name.
  2. cc recipients are added to the thread's participants; a reply-all action is offered when the original had cc.
  3. Attachment limit follows Gmail's 25 MB total per message; larger is blocked client-side with a message.
  4. HTML is generated from the editor and sanitised; plain text part always included.
  5. Failed send keeps the draft and attachments for retry.
- **Async & events:** as `TW-MAIL-022`.
- **External systems:** Gmail send.
- **Settings:** limits.
- **Acceptance criteria:**
  - Given a mailbox signature, When an agent opens the composer, Then it is appended and still editable.
  - Given two attachments and a cc, When sent, Then the customer receives both files and the cc address is on the mail.
  - Given a send failure, When the agent retries, Then the draft and files are still there.
- **Source refs:** draft spec E-06, E-13, E-14; Reference gap: no equivalent (`TW-MAIL-009` rule 5).
- **Port notes:** depends on the message-templates domain for email-type templates; the draft's planned "email templates" nav item is a separate domain feature.

### TW-MAIL-028 — Mailbox health: sync status, last error, needs-reauth, reconnect, retry

- **Status:** port-addition
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-MAIL-021, TW-MAIL-022
- **Summary:** An admin can see when a mailbox stops working (token revoked, password changed, quota, persistent errors) and reconnect it in one click, so mail is not silently lost. Reference shows only Connected or Inactive and never an error.
- **Actors & access:** workspace admins (and the mailbox's default assignee gets the notification).
- **UX & screens:** mailbox row status pill Connected / Syncing / Paused / Needs reconnect / Error with the last error text and time, last successful sync and lag; a Reconnect button that restarts OAuth for that address; a banner in the inbox for agents when a mailbox needs attention; Health tab with recent sync runs.
- **Endpoints (proposed):** `GET /v2/email/mailboxes/:id/health`; reconnect uses `connect/google/start` with the mailbox id.
- **Data:** `mailboxes.status`, `last_error`, `last_error_at`, `last_synced_at`, `consecutive_failures`.
- **Rules & edge cases:**
  1. `invalid_grant`, revoked or insufficient scope sets `needs_reauth` immediately and stops sync and send for that mailbox only.
  2. Transient errors retry with backoff and flip to `error` after N consecutive failures (setting).
  3. Reconnect must authenticate the **same** address, otherwise it is refused (no silent address swap).
  4. Reconnecting resumes from the stored cursor, or re-anchors and does a bounded catch-up so nothing is lost during the outage.
  5. An in-app notification (and optional email through the platform mailer) is sent once per incident, not per poll.
- **Async & events:** outbox `mail.mailbox.reauth_required`, notification event; audit rows.
- **External systems:** Google token endpoint errors.
- **Settings:** failure threshold.
- **Acceptance criteria:**
  - Given Google revokes the grant, When the next sync runs, Then the mailbox shows Needs reconnect and one notification is created.
  - Given the admin reconnects the same address, When done, Then syncing resumes and mail from the outage is imported.
  - Given the admin signs in with a different address, When reconnecting, Then the flow is refused.
- **Source refs:** draft spec E-07, E-11; precedent Google Calendar adapter reconnect handling.
- **Port notes:** notification type and routing through the notifications domain; keep the status vocabulary in `@crm/contracts`.

### TW-MAIL-029 — Operator console: Email providers (Google credentials, enable, test)

- **Status:** port-addition
- **Priority:** P0
- **Effort:** M
- **Depends on:** platform-settings-branding-storage
- **Summary:** The platform operator enables each provider and enters its OAuth client id and sealed client secret once for the whole platform, the same way the WhatsApp provider registry and Google Calendar work. Workspace admins never see platform secrets. Replaces the Reference Add-ons "connect MailTrixy" card.
- **Actors & access:** platform admin only.
- **UX & screens:** admin page "Email providers": a card each for Google (live), Microsoft and IMAP (shown, off until built), fields client id, client secret (write-only, shows "set, ends in ####"), redirect URI (read-only, to copy into Google Cloud), enabled switch, Test button (validates the credentials by starting a dry authorization or calling the discovery document), status and last test result.
- **Endpoints (proposed):** `GET/PUT /v2/admin/email/providers/:provider`, `POST /v2/admin/email/providers/:provider/test`.
- **Data:** a console settings group `channel-email` with environment fallback (as `googleCalendar` and `whatsapp` do).
- **Rules & edge cases:**
  1. Secrets sealed with the vault, never returned.
  2. A provider that is off or unconfigured shows "Ask your platform administrator" on the workspace screen.
  3. Changing the client id invalidates existing refresh tokens at Google's side only if the project changes; document in the runbook; connected mailboxes are not dropped by saving.
  4. Audit row for every change.
- **Async & events:** audit; outbox `mail.provider.updated`.
- **External systems:** Google OAuth discovery.
- **Settings:** the group above.
- **Acceptance criteria:**
  - Given no Google credentials, When a workspace admin opens Connect, Then Google shows the "ask your platform administrator" state.
  - Given valid credentials saved, When Test runs, Then it reports success and the secret is shown masked.
  - Given a non-platform user, When the page is requested, Then it is refused.
- **Source refs:** draft spec E-08, 5.4.
- **Port notes:** admin screens under `apps/web/src/app/(admin)/(channel-email)/`.

### TW-MAIL-030 — Permissions, plan feature and the mailbox limit key

- **Status:** port-addition
- **Priority:** P0
- **Effort:** S
- **Depends on:** roles-permissions, plans-subscriptions-trials
- **Summary:** Reference gates everything with a workspace role (admin) and the plan flag `access_email`. The port adds proper permission keys and a mailbox-count limit.
- **Actors & access:** owners and admins by default.
- **UX & screens:** upgrade lock on Connect at the limit; Email is a Marketplace integration: the Settings > Integrations tile is hidden without the read permission and shown locked (upgrade mark) without the plan feature or Marketplace subscription, and `/email` shows the plan paywall; the Help guide is gated the same way (nav and tile entries).
- **Endpoints:** all `/v2/email/*` routes carry the keys.
- **Data:** permission keys `mail.mailboxes.read`, `mail.mailboxes.manage` (admin role granted by migration, per the `rbac-permission` skill); replies reuse `inbox.conversation.reply`; plan feature `channel_email` (maps Reference `access_email`) and numeric limit `email_mailboxes`; keep `email_monthly_limit` for campaign sends.
- **Rules & edge cases:**
  1. Reference's `access_email` data is not migrated (none exists in our DB); the port enforces the feature on link, send, receive and the nav (`TW-MAIL-016`).
  2. Agents without `mail.mailboxes.read` can still work email conversations they can see.
  3. Platform admins bypass plan checks like elsewhere.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** plan columns/keys.
- **Acceptance criteria:**
  - Given a member without `mail.mailboxes.manage`, When calling connect, Then 403.
  - Given a plan without `channel_email`, When opening Settings, Then the Email tile shows the upgrade state.
  - Given the limit reached, When connecting, Then the limit error code is returned.
- **Source refs:** draft spec E-09; Reference `routes/web.php` (Devices group role), `app/Models/Package.php`.
- **Port notes:** use the `rbac-permission` skill, a migration for the grants, and the stable problem+json error codes in `@crm/contracts`.

### TW-MAIL-031 — Generic IMAP/SMTP mailbox ("Other mail")

- **Status:** port-addition
- **Priority:** P1
- **Effort:** XL
- **Depends on:** TW-MAIL-019, TW-MAIL-026
- **Summary:** Connect any mailbox (hosting provider, Zoho Mail is excluded by the owner as a named option but works as plain IMAP) with host, port, security, username and password or app password. Reference gets this only inside MailTrixy.
- **Actors & access:** admin with manage permission.
- **UX & screens:** Connect tab card "Other mail": host, port, security (SSL/TLS, STARTTLS), username, password; IMAP and SMTP verified before saving; the error says which of the two failed and why; a note recommends app passwords and explains Gmail users can use this path in the interim.
- **Endpoints (proposed):** `POST /v2/email/mailboxes/imap` (verify then create).
- **Data:** `mailboxes` provider `imap` with sealed credentials JSON; UID-based cursor per folder (UIDVALIDITY).
- **Rules & edge cases:**
  1. Nothing is saved on a failed verification; credentials sealed, shown as "set, ends in ####".
  2. Polling (IDLE where available); MIME parsing with a maintained library (none in the repo today); same ingest, threading and caps as Gmail.
  3. SSRF guard on host (no private ranges) because users supply it.
  4. Backfill last 7 days as quiet history.
- **Async & events:** as `TW-MAIL-021`.
- **External systems:** IMAP/SMTP servers.
- **Settings:** same caps.
- **Acceptance criteria:**
  - Given a wrong SMTP password, When saving, Then nothing is saved and the error names SMTP.
  - Given correct settings, When saved, Then a backfill starts and mail arrives as threads.
- **Source refs:** draft spec E-02, 5.4.
- **Port notes:** ships after Gmail unless the Google review delays launch (then it is the interim path, Open questions 3).

### TW-MAIL-032 — Loop, bounce and auto-responder protection

- **Status:** port-addition
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-MAIL-021, TW-MAIL-011
- **Summary:** Detects mail that must not open tickets or trigger auto-replies (out-of-office, bounces, mailing lists, our own mail) and marks undeliverable sends. Reference has none of this, so an auto-reply to an auto-responder can loop.
- **Actors & access:** system.
- **UX & screens:** a "bounced" or "auto-reply" tag on the message; bounce shown on the original outbound message; threads can be created but quiet.
- **Endpoints:** none.
- **Data:** message flags `auto_submitted`, `bounce`, `list`; per-sender rate counters.
- **Rules & edge cases:**
  1. Headers considered: `Auto-Submitted`, `Precedence`, `X-Autoreply`, `List-Id`, `Return-Path: <>`, DSN content type.
  2. No automation (flows, keyword replies, AI) answers a flagged message; no unread bump for bounces.
  3. Per-sender and per-thread reply rate limits for automation.
  4. Our own address, aliases and other connected mailboxes of the workspace are never treated as customers (prevents support@ to sales@ loops).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** rate limits.
- **Acceptance criteria:**
  - Given an out-of-office reply, When ingested, Then no auto-reply or flow starts.
  - Given a delivery-failure notice, When ingested, Then the original outbound message shows bounced.
  - Given mail from the workspace's other mailbox, When ingested, Then automation does not respond.
- **Source refs:** draft spec E-18 and risks table.
- **Port notes:** place the check before the automation chain of `TW-MAIL-011`.

### TW-MAIL-033 — Gmail push notifications (Pub/Sub watch) instead of polling

- **Status:** port-addition
- **Priority:** P2
- **Effort:** L
- **Depends on:** TW-MAIL-021
- **Summary:** Replace the 60-second poll with Gmail watch notifications delivered through Google Pub/Sub, cutting latency from a minute to seconds.
- **Actors & access:** system; operator configures the topic.
- **UX & screens:** console field for the Pub/Sub topic and the push endpoint status.
- **Endpoints:** public Pub/Sub push endpoint with token verification.
- **Data:** `mailboxes.watch_expiration`.
- **Rules & edge cases:** watches expire after about 7 days and are renewed by a job; polling stays as the safety net; notifications only say "something changed", the history sync does the work.
- **Async & events:** renewal job; notification handler enqueues a sync.
- **External systems:** Gmail watch, Google Pub/Sub.
- **Settings:** topic, audience.
- **Acceptance criteria:**
  - Given a watch is active, When mail arrives, Then it shows in the inbox within seconds.
  - Given a watch expires, When the renewal job runs, Then it is renewed.
- **Source refs:** draft spec E-17.
- **Port notes:** keep the polling job even when push is on.

### TW-MAIL-034 — Microsoft 365 / Outlook by OAuth

- **Status:** port-addition
- **Priority:** P2
- **Effort:** XL
- **Depends on:** TW-MAIL-019, TW-MAIL-029
- **Summary:** Same as Google but through the Microsoft identity platform and Graph (delta polling, change notifications later). Not required by the owner's brief; kept as a placeholder card until scheduled.
- **Actors & access:** admin with manage permission; operator enables it.
- **UX & screens:** Connect tab card "Microsoft 365 / Outlook".
- **Endpoints:** parallel to `TW-MAIL-020`.
- **Data:** `mailboxes` provider `microsoft`.
- **Rules & edge cases:** app registration and publisher verification needed; no Microsoft code exists in the repo.
- **Async & events:** as `TW-MAIL-021`.
- **External systems:** Microsoft Graph.
- **Settings:** operator credentials.
- **Acceptance criteria:** mirrors `TW-MAIL-020` and `TW-MAIL-021` for a Microsoft account.
- **Source refs:** draft spec 5.4.
- **Port notes:** build behind the same provider interface as Google so the sync and send services are reused.

### TW-MAIL-035 — Personal mailboxes and the channel-owner visibility rule

- **Status:** port-addition
- **Priority:** P2
- **Effort:** L
- **Depends on:** TW-MAIL-023, team-inbox-conversations
- **Summary:** An agent can connect a personal mailbox whose conversations are visible only to that agent (and to admins only if the workspace policy allows it). Reference has no personal mailbox concept; every linked mailbox is workspace-wide.
- **Actors & access:** any member with permission; workspace policy controls admin visibility.
- **UX & screens:** "Email sharing" tab: who may connect personal mailboxes, whether admins can read them, send-as rules.
- **Endpoints:** policy endpoints; connect path takes `scope=personal`.
- **Data:** `mailboxes.scope = shared | personal`, `owner_user_id`; policy setting.
- **Rules & edge cases:** visibility today is decided only by assignment (`visibility-sql.ts`), so a channel-owner predicate must be added in **both** the SQL visibility and the realtime `conversationVisible` check and tested for cross-user access; replies leave from the agent's own address; the mailbox counts toward the limit.
- **Async & events:** none new.
- **External systems:** as `TW-MAIL-020`.
- **Settings:** admin-visibility policy (default never).
- **Acceptance criteria:**
  - Given a personal mailbox of agent A, When agent B opens the inbox, Then A's threads are not visible or countable.
  - Given the policy allows admins, When an admin opens the inbox, Then they can see them.
- **Source refs:** draft spec 5.1, E-12, Open questions 1 of the draft.
- **Port notes:** ship only after the visibility predicate exists; the data model carries `scope` and `owner_user_id` from day one so no migration of meaning is needed later.

## Data model

**Reference (v1.7.0):**

- **`workspace_email_accounts`** (the only email table): `id`, `workspace_id` (indexed), `mailtrixy_account_id` (indexed; the engine's account id, the key inbound pushes resolve on), `mtx_workspace_id` (nullable, informational), `mtx_last_message_id` (nullable; highest engine message id imported, the pull cursor), `email`, `name`, `provider` (64, e.g. gmail, outlook, imap), `status` (32, default `connected`; only `connected` is ever written), `synced_at`, timestamps; unique (`workspace_id`, `mailtrixy_account_id`). It holds no credentials. Read by every feature, written by 003, 004, 005. Row volume: a handful per workspace. A port-time copy already exists in `packages/db/migrations/20261001102500_wsp_threadwise_schema.sql` (composite key `(org_id, id)`, forced RLS, unique `(org_id, mailtrixy_account_id)`).
- **Shared tables written with email shapes:** `conversations` (`channel email`, `provider email`, `origin email`, `raw_jid email:<rowId>:<engineConversationId|address|unknown-md5>`); `inbox_messages` (`meta.email` with `subject`, `from_email`, `from_name`, `to_email`, `to`, `mtx_conversation_id`, `mtx_message_id`, `mtx_account_id`, `html`, `source` flow or campaign); `contacts` (`channel email`, `channel_uid` address, `msg "Source: Email"`); `flows` (`flow_type email`, `trigger_device_id`, `trigger_keywords`); `keyword_replies` (`provider email`, `device_id` = row id); `wp_campaigns` (`device_id` = row id), `wp_campaign_contacts`; `packages` (`access_email`, `email_monthly_limit`); `system_settings` keys `email_enabled`, `mailtrixy_url`, `mailtrixy_secret` (encrypted), `mailtrixy_brand`, `mailtrixy_connected`, `mailtrixy_last_check`, `mailtrixy_last_inbound`.
- Node keeps in-memory flow sessions (`<accountId>_<engineConversationId>`).

**Port additions (proposed, final shapes at build via the `add-migration` skill; every table composite `(org_id, id)` primary key, forced RLS with `tenant_isolation`, `touch_row` trigger):**

- **`mailboxes`**: `provider` (google | imap | microsoft), `address`, `display_name`, `scope` (shared | personal), `owner_user_id`, `status` (connected | paused | needs_reauth | error | disconnected), sealed `credentials` (refresh token, expiry, scopes, or IMAP settings), `history_id` / folder UID cursors, `last_synced_at`, `last_error`, `last_error_at`, `consecutive_failures`, `default_assignee_user_id`, `default_team_id`, `color`, `position`, `signature_html`, `watch_expiration`, `created_by`; unique (`org_id`, lower(`address`)); a global uniqueness guard on address (see Open questions 2).
- **`email_threads`**: conversation, mailbox, provider thread id, root `Message-ID`, normalised subject, participants hash.
- **`message_attachments`**: message, filename, content type, size, storage key, inline content id, status (stored | too_large | failed).
- Message ledger entries keyed on RFC `Message-ID` (existing inbox ledger); `conversations.mailbox_id`.

## Cross-domain contracts

- **Consumes:** team-inbox-conversations (write inbound through the shared ingest service, dispatch replies through the channel adapter, conversation filters, visibility SQL and realtime check); contacts-attributes-tags (resolve or create a contact by email identity, quota behavior); flow-builder-editor and flow-runtime-engine plus node-bridge-runtime (email flow type, numbered-choices rendering, session persistence); campaigns (campaign builder, audience, runner contract); auto-reply-keywords (rules scoped by mailbox id); message-templates (email templates and saved replies, variables); ai-agents-training (assigned agent replies by email); plans-subscriptions-trials (`channel_email`, `email_mailboxes`, `email_monthly_limit`); roles-permissions (`mail.mailboxes.read/manage`); platform-settings-branding-storage (console settings group with env fallback, attachment storage, vault); notifications-activity-audit (needs-reauth notification, audit rows); whatsapp-devices-baileys (the Devices hub table hosts the email rows); addons-extension-registry (`TW-ADD-019`, `TW-ADD-020`, only if the bridge is kept).
- **Exposes:** an `EmailSender` port (send reply, send new message, send one-off) to team-inbox, flows, campaigns and AI agents; a channel-rows provider for the Devices hub (`TW-MAIL-001`); mailbox list and ids to sender pickers (`TW-MAIL-015`); outbox events `mail.mailbox.connected`, `mail.mailbox.disconnected`, `mail.mailbox.reauth_required`, `mail.message.received`, `mail.message.sent`, `mail.provider.updated`; the Google OAuth callback route; the inbox contract additions (`mailbox_id` filter, email envelope).

## Open questions & quirks

Decisions needed from the owner (biggest first):

1. **Bridge or native?** Reference only bridges to MailTrixy. The owner's requirement (connect Google, 2 to 3 mailboxes, multiple inboxes) is a native build (`TW-MAIL-019` to `TW-MAIL-025`). Recommendation: native Gmail replaces the bridge; do not build a MailTrixy client; record the removal of the "link from MailTrixy" picker and the Add-ons "Connect MailTrixy" card as a deliberate deviation in `product-extensions.md`. If the owner wants parity with existing Reference installs that run MailTrixy, keep `TW-MAIL-002`, `-003`, `-006`, `-018` as an optional adapter behind the same `EmailSender` and ingest ports.
2. **Fate of `workspace_email_accounts`.** Leave it unused and add `mailboxes` (recommended, the draft spec agrees), repurpose it, or drop it. Also decide how to enforce "one workspace per mailbox" across tenants without leaking existence (global unique index, neutral error).
3. **Google verification.** Gmail scopes for reading and sending are restricted; public launch needs Google's verification and a security assessment (long lead). Decide whether to start now (recommended) and whether to ship IMAP "Other mail" (`TW-MAIL-031`) first as the interim for Gmail users with app passwords. Exact scope set (read plus send, or modify) must be fixed before the consent screen is registered.
4. **Mailbox limit.** Owner said 2 to 3 per workspace: confirm default 3, whether it differs per plan, and whether 0 means unlimited as it does for `email_monthly_limit`.
5. **Which Gmail mail is ingested.** INBOX and SENT only? Skip Promotions, Social and Updates categories? Include mail already read or archived in the 7-day backfill? Recommendation: INBOX and SENT, all categories, with a per-mailbox "ignore promotions" setting later.
6. **Thread model.** Confirm one conversation per email thread (draft spec 5.2) over Reference's one conversation per engine conversation, plus a title that does not change with later subjects (Reference overwrites it).
7. **Metering.** Do replies and inbound mail count toward plan caps or the wallet? Reference counts outbound email rows against `email_monthly_limit` but checks it only at campaign start; recommendation: keep the cap for campaigns only, never meter support replies.
8. **Who owns it.** `ownership.json` assigns `channel-email` (code `mail`) to Punya, wave 3; the branch `lakshya/mail/gmail-email-channel` implies Lakshya is building it. Confirm owner and zone before building. `TW-MAIL-024` also touches the inbox owner's files.
9. **Bulk email from a connected Gmail.** Email campaigns (`TW-MAIL-014`) from a user's Gmail run into Google's daily sending limits and can get the account flagged; the draft spec's non-goals exclude bulk marketing. Decide whether email campaigns are in the port scope at all, or limited with a low per-day cap and a warning.
10. **Attachments table vs one message per attachment**, remote-image blocking default and proxying, retention of bodies (draft spec questions 6, 9, 10).
11. **History after disconnect.** Reference hides all email threads when the last mailbox is unlinked and orphans them on re-link; the port proposes keeping them read-only (`TW-MAIL-005`, `TW-MAIL-019`). Confirm that is acceptable as a deviation.

Quirks and gaps found in Reference (kept in the inventory so nothing is "fixed" by accident):

- Reference has **no native email engine**; the documentation page is titled "Email Channel (MailTrixy)" and the changelog states Threadwise never speaks IMAP or SMTP.
- The "periodic repair sweep" mentioned in code comments does not exist; `syncWorkspace` is never called (`TW-MAIL-004`).
- The inbound push has an 8 second timeout and no retry on the engine side; missed mail is recovered only by pressing Sync, which caps at 2,000 messages per press.
- Plan flag `access_email` is not checked on link, sync, unlink, push or reply, only on nav, pickers and the campaign runner (`TW-MAIL-016`).
- A valid inbound push re-enables the platform's "connected" flag on its own (`TW-MAIL-006`).
- Inbound contacts are keyed by `channel_uid` and never get the email address in their email field, so they are not reachable by email campaigns or email search (`TW-MAIL-007`).
- The thread title is overwritten by every new message's subject (`TW-MAIL-007`).
- Attachments are dropped silently on email replies; quoted history is kept in stored bodies; HTML mail is stored but never rendered (`TW-MAIL-008`, `TW-MAIL-009`).
- Error text refers to the "Numbers page"; the surface is `/devices` (`TW-MAIL-009`).
- The picker's tenant safety depends on the user's login email matching the engine's mailbox owner; signing in as the mailbox address shows an empty list.
- Unlink then re-link creates a new row id, orphaning old thread keys and any flow or auto-reply rule bound to the old id (`TW-MAIL-005`).
- The monthly cap counts every outbound email row (replies and flow messages included) but is checked once per campaign start, so one run can pass the cap (`TW-MAIL-014`).
- When the engine pushes an outbound (`direction out`) copy of a reply that an agent sent from the inbox, the local row may be stored a second time; the ingest dedupes only on the engine message id and the local row may carry none. Unverified: confirm in the parity run (`TW-MAIL-007`).
- Node email flow sessions live in process memory and vanish on restart (`TW-MAIL-012`).
- The Reference documentation advertises email flows, campaigns and quoted-text stripping; all three are real in code (no `docs-only` items found), but its claim of "central suppression and unsubscribes" is a property of the external engine, not of Threadwise code (`TW-MAIL-014`).
- Platform system mail (`MailConfig`, mailables) is a different feature and is not part of this domain.

## Coverage

```json threadwise-coverage
{
  "routes": [
    "POST api/mailtrixy/inbound",
    "POST api/email/flow-send",
    "POST api/email/flow-node",
    "POST api/email/flow-log",
    "GET devices/email/available",
    "POST devices/email/link",
    "POST devices/email/{id}/sync",
    "DELETE devices/email/{id}/unlink",
    "POST admin/extensions/mailtrixy/connect",
    "POST admin/extensions/mailtrixy/disconnect"
  ],
  "controllers": [
    "app/Http/Controllers/Api/MailtrixyInboundController.php",
    "app/Http/Controllers/Mailtrixy/EmailFlowNodeController.php"
  ],
  "services": [
    "app/Services/Mailtrixy/EmailCampaignRunner.php",
    "app/Services/Mailtrixy/EmailFlowBridge.php",
    "app/Services/Mailtrixy/MailtrixyClient.php",
    "app/Services/Mailtrixy/MailtrixyIngestService.php",
    "app/Services/Mailtrixy/MailtrixySyncService.php"
  ],
  "models": ["WorkspaceEmailAccount"],
  "tables": ["workspace_email_accounts"],
  "node_files": ["node/controllers/emailFlowController.js", "node/services/emailFlowService.js"],
  "misc_files": [
    "routes/mailtrixy-email.php",
    "database/migrations/2026_08_30_000700_add_email_plan_columns_to_packages.php",
    "database/migrations/2026_08_30_100000_create_workspace_email_accounts_table.php",
    "database/migrations/2026_09_01_120000_add_mtx_last_message_id_to_workspace_email_accounts.php"
  ],
  "doc_pages": ["Documentation/pages/channels/email.html"],
  "feature_map": {
    "TW-MAIL-002": ["GET devices/email/available"],
    "TW-MAIL-003": ["POST devices/email/link"],
    "TW-MAIL-004": ["POST devices/email/{id}/sync"],
    "TW-MAIL-005": ["DELETE devices/email/{id}/unlink"],
    "TW-MAIL-006": ["POST api/mailtrixy/inbound"],
    "TW-MAIL-013": [
      "POST api/email/flow-send",
      "POST api/email/flow-node",
      "POST api/email/flow-log"
    ],
    "TW-MAIL-017": [
      "POST admin/extensions/mailtrixy/connect",
      "POST admin/extensions/mailtrixy/disconnect"
    ]
  }
}
```
