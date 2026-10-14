---
domain: whatsapp-personal-history-import
code: WAHIST
title: Opt-in import of existing chats and contacts of a personal WhatsApp number
threadwise_version: '1.7.0'
sources_read: 6
---

# Opt-in import of existing chats and contacts of a personal WhatsApp number

## Overview

Reference never imports a personal number's history: `app/node/classes/BaileysClientManager.js` builds every socket with `syncFullHistory: false` and `shouldSyncHistoryMessage: () => false` (a
`.backup.js` copy once had `syncFullHistory: true`), and its inbound handler drops messages older than ten minutes. So a newly linked number starts with an empty shared inbox. This domain is a
**port addition** (owner request, walkthrough item 26): when a person links a personal number they may choose, BEFORE scanning the QR, to bring in the existing chats and the people in them. Design,
rules and limits: `docs/specs/personal-whatsapp-connect.md` section 23. Build notes: `docs/threadwise-port/plan/whatsapp-personal-history-import-build.md`.

## Feature index

| Id            | Feature                                                 | Status        | Priority | Effort | Depends on                 |
| ------------- | ------------------------------------------------------- | ------------- | -------- | ------ | -------------------------- |
| TW-WAHIST-001 | The opt-in choice before the QR                         | port-addition | P0       | M      | TW-WADEV-005               |
| TW-WAHIST-002 | Socket settings and reading of WhatsApp's history event | port-addition | P0       | M      | TW-WAHIST-001, TW-NODE-011 |
| TW-WAHIST-003 | The quiet importer: threads, messages, contacts, caps   | port-addition | P0       | L      | TW-WAHIST-002, TW-WABA-046 |
| TW-WAHIST-004 | Status, progress, cancel and the sweep                  | port-addition | P1       | M      | TW-WAHIST-003              |
| TW-WAHIST-005 | Settings, help, translations and documentation          | port-addition | P1       | S      | TW-WAHIST-001              |
| TW-WAHIST-006 | The full history is a plan feature                      | port-addition | P1       | M      | TW-WAHIST-001              |
| TW-WAHIST-007 | The imported marker and the one realtime hint           | port-addition | P1       | M      | TW-WAHIST-003              |
| TW-WAHIST-008 | Coexistence history creates contacts quietly            | port-addition | P1       | S      | TW-WAHIST-003, TW-WABA-046 |

## Features

### TW-WAHIST-001 — The opt-in choice before the QR

- **Status:** implemented
- **Priority:** P0 (the import cannot work without it)
- **Effort:** M
- **Depends on:** TW-WADEV-005
- **Summary:** WhatsApp sends a number's history once, right after the first link, and only to a companion that asked for it while registering. So the choice (`none`, `recent`, `full`, default `none`) is an input of the pairing start, stored on the device before the worker is asked for a QR.
- **Actors & access:** a member with `wa.devices.pair`.
- **UX & screens:** the link step of the connect wizard, "Bring in your existing chats?", with what to expect.
- **Endpoints:** `POST /v2/devices/:id/pairing/qr|code` (`importHistory`).
- **Acceptance criteria:**
  - Given a pairing started with `importHistory: recent`, When the worker is asked for a QR, Then the device row already says `recent`, the socket is built with it and a run exists in state `idle`.
  - Given a pairing started without the field, When it starts, Then nothing is imported, the socket is built as before and any waiting run is cancelled.
  - Given a waiting run, When the same number is linked again without choosing, Then the first run is `cancelled` and the device mode is `none`.
  - Given a member without `wa.devices.pair`, When they start a pairing, Then 403.

### TW-WAHIST-002 — Socket settings and reading of WhatsApp's history event

- **Status:** implemented
- **Priority:** P0 (the import cannot work without it)
- **Effort:** M
- **Depends on:** TW-WAHIST-001, TW-NODE-011
- **Summary:** The Baileys adapter asks WhatsApp for history only for an opted-in number, reads `messaging-history.set` into filtered, windowed, bounded batches and hands them over one at a time.
- **Actors & access:** the worker (system).
- **UX & screens:** none.
- **Endpoints:** none (in-process `InboundRouter.history`).
- **Acceptance criteria:**
  - Given a device that did not opt in, When its socket is built, Then `syncFullHistory` is false, no history notification is downloaded and the browser identity is unchanged.
  - Given `recent`, When the socket is built, Then bootstrap, recent and push-name syncs are allowed and the full history is not asked for; given `full`, Then it is asked for and its chunks are allowed.
  - Given an event with status, newsletter, broadcast, bot, reaction, protocol and own-chat messages, When it is read, Then none of them is delivered and they are counted as skipped.
  - Given a message older than the window, When the event is read, Then it is left out.
  - Given an event of 5 messages and a batch size of 2, When it is read, Then three slices arrive in order and the next is not read before the importer took the last.

### TW-WAHIST-003 — The quiet importer: threads, messages, contacts, caps

- **Status:** implemented
- **Priority:** P0 (the import cannot work without it)
- **Effort:** L
- **Depends on:** TW-WAHIST-002, TW-WABA-046
- **Summary:** Each batch is stored through the inbox ingest with the quiet `history` marker: backdated, read, silent. People get contacts created quietly; groups go to their group thread with no contact. Caps and the plan's contact limit stop the run with a clear state.
- **Actors & access:** the worker (system), under the workspace's tenant.
- **UX & screens:** the imported conversations in the inbox.
- **Endpoints:** none.
- **Acceptance criteria:**
  - Given an imported chat, When it is stored, Then the thread has no unread, the messages are dated as sent, the preview follows the last real message and no alert, listener or `message.received`, `contact.created` or `conversation.created` event is produced.
  - Given the same batch delivered three times, When the importer takes it, Then messages, threads, contacts and counters are those of one delivery.
  - Given a group chat, When it is stored, Then it lands on `g:<id>` with the subject as title, the speaker on the message and no contact.
  - Given a person's chat, When it is stored, Then a contact exists (source `whatsapp_personal_import`, named from the phone book when known) and no consent event or state was written.
  - Given a media message, When it is stored, Then no file is kept and the message shows a placeholder with its caption and `mediaOmitted`.
  - Given the plan's contact limit is reached, When a chat needs a new contact, Then the run ends `limit_reached` with `contact_limit_reached`, what was stored stays and nothing more is taken.
  - Given a per-chat, per-number or chat cap, When a batch exceeds it, Then the newest messages win the room and the run says why it stopped.
  - Given another workspace's device, When history arrives for it, Then nothing is written outside its own workspace.

### TW-WAHIST-004 — Status, progress, cancel and the sweep

- **Status:** implemented
- **Priority:** P1 (the person must see and control it)
- **Effort:** M
- **Depends on:** TW-WAHIST-003
- **Summary:** The device read model and `GET .../history-import` show state, counts, progress and the last error; `POST .../history-import/cancel` stops a run; a sweep ends runs that went quiet and gives up on runs whose history never came.
- **Actors & access:** `wa.devices.read` (status), `wa.devices.pair` (cancel).
- **UX & screens:** the "Imported chats" card on the number's page.
- **Endpoints:** `GET /v2/devices/:id/history-import`, `POST /v2/devices/:id/history-import/cancel`.
- **Acceptance criteria:**
  - Given a running run, When it is cancelled, Then it is `cancelled`, later batches are dropped, what was stored stays, the choice is reset and an audit row is written; a second cancel is 409 `HISTORY_IMPORT_NOT_ACTIVE`.
  - Given a running run silent for the idle window, When the sweep runs, Then it is `done`; given a waiting run older than the await window, Then it is `failed` with `history_not_received`.
  - Given a member with only `wa.devices.read`, When they cancel, Then 403.
  - Given another workspace, When it asks for the status or cancels, Then 404.
  - Given the number is disconnected, When a run is waiting, Then it is cancelled.

### TW-WAHIST-005 — Settings, help, translations and documentation

- **Status:** implemented
- **Priority:** P1 (mandatory for every screen)
- **Effort:** S
- **Depends on:** TW-WAHIST-001
- **Summary:** The documented environment settings and their defaults, the help guide, 21 locales for every text and the docs.
- **Actors & access:** operators and members.
- **UX & screens:** help center guide "Import your existing chats from a personal WhatsApp number".
- **Endpoints:** none.
- **Acceptance criteria:**
  - Given no `WA_HISTORY_IMPORT_*` variable, When a run is requested, Then the defaults of spec section 23.5 apply and are written on the run.
  - Given any new text, When the locales are checked, Then all 21 have a real translation.

### TW-WAHIST-006 — The full history is a plan feature

- **Status:** implemented
- **Priority:** P1 (owner decision 2026-10-14)
- **Effort:** M
- **Depends on:** TW-WAHIST-001
- **Summary:** The `full` choice needs the plan feature `personal_history_full`; `recent` stays open to every workspace with personal numbers.
- **Actors & access:** a member with `wa.devices.pair`; the operator sets the feature in the plan editor.
- **UX & screens:** the choice step shows the full option disabled with a pointer to the plans.
- **Endpoints:** `POST /v2/devices/:id/pairing/qr|code` (422 `PLAN_FEATURE_LOCKED`), `GET /v2/devices` (`meta.historyFullAllowed`).
- **Acceptance criteria:**
  - Given a plan without the feature, When a pairing starts with `importHistory: full`, Then 422 `PLAN_FEATURE_LOCKED` naming `personal_history_full`, no run is recorded and the worker is not asked for a QR; `recent` still starts.
  - Given a plan with the feature, When a pairing starts with `full`, Then the run is recorded with mode `full`.
  - Given a plan without the feature, When the wizard opens, Then the full option is disabled and a pointer to the plans is shown.

### TW-WAHIST-007 — The imported marker and the one realtime hint

- **Status:** implemented
- **Priority:** P1 (owner decision 2026-10-14)
- **Effort:** M
- **Depends on:** TW-WAHIST-003
- **Summary:** Imported conversations and messages are marked in the inbox, and the inbox refreshes once when an import ends.
- **Actors & access:** members who read the inbox or the numbers.
- **UX & screens:** an "Imported" tag on the conversation row and on the bubble, with a hint and in the row's spoken label.
- **Endpoints:** `GET /v2/inbox/conversations` (`imported`), `GET .../messages` (`imported`), realtime `inbox.history.imported`.
- **Acceptance criteria:**
  - Given a thread created by an imported history, When the inbox lists it, Then it has `imported: true` and its messages too; a thread that existed before is never marked.
  - Given a run that ends, When the worker drains the outbox, Then exactly one hint is pushed to people who can read the inbox or the numbers and none to others, and none while messages are still arriving.
  - Given a cancel that stored nothing, When it is drained, Then no hint is pushed.

### TW-WAHIST-008 — Coexistence history creates contacts quietly

- **Status:** implemented
- **Priority:** P1 (owner decision 2026-10-14)
- **Effort:** S
- **Depends on:** TW-WAHIST-003, TW-WABA-046
- **Summary:** The Cloud API coexistence history import (TW-WABA-046) also makes a contact for each customer, quietly, like the personal import. A behaviour change from TW-WABA-046, which created none.
- **Actors & access:** the system.
- **UX & screens:** none.
- **Endpoints:** none (webhook `history`).
- **Acceptance criteria:**
  - Given a pushed history, When it is stored, Then each customer has one contact (source `whatsapp_coexistence_import`), no `contact.created` event and no consent event, however often the history is pushed.
  - Given the plan's contact cap, When it is reached, Then the remaining threads are kept without a contact (`needs_contact`) and all messages are stored.
