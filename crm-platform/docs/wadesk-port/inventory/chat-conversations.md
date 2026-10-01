---
domain: chat-conversations
code: CHAT
title: Chat (Quick Send), Message Log and Unified Message Stream
wadesk_version: '1.7.0'
sources_read: 42
---

# Chat (Quick Send), Message Log and Unified Message Stream

## Overview

This domain covers the two operator screens that the WaDesk docs call **Chat (1-on-1)** and **Message History**, plus the message plumbing they share.

**Chat / "Quick Send" (`/chat`).** Despite the docs' WhatsApp-Web comparison, the screen is a _send-queue_ console (its page title is "Quick Send"). The left rail filters "queues" by status, the middle column lists them, and the right pane is a thread with a composer. A "queue" is a conversation row whose outbound sends originated from this screen. Composing a queue to N numbers does not create one shared thread: the server finds or creates **one conversation per phone number** (the same row the Team Inbox and inbound webhooks use, `origin='inbox'`) and dispatches one message per number immediately, or schedules it. The operator can then open any thread, reply with text, a file, a location pin or an approved template, react / pin / star / delete / forward individual messages, archive or delete the whole queue, open a details drawer, and (in intent) use AI assist. Ticks (pending, sent, delivered, read, failed) advance as the Node bridge posts receipts. Updates arrive by 5-second polling; there is no websocket.

**Message History (`/message-history`).** A read-only, workspace-wide log that merges six sources (team inbox, auto-reply fires, campaign sends, broadcast sends, scheduled jobs, "direct send" chat messages) through `UnifiedMessageStream` into one normalized feed with KPI cards, charts, filters, a paginated table, a detail panel and a CSV export.

**Who uses it.** Workspace owner, admin and manager (role gate `workspace.role:manager`; platform admins bypass). Agents and viewers are redirected to the Team Inbox (WD-TIB1) which is their working surface. There is no permission key and no plan-feature gate on either screen; only sending is metered (monthly plan quota / wallet, see WD-WALLET and WD-PLAN) and multi-sender compose needs plan feature `multipledevice`.

**Main flow end to end.** Manager opens `/chat` → bootstrap counts, connected senders across all enabled engines and contact groups → composes a queue (numbers or group, sender(s), first message, optional schedule) → server auto-saves typed numbers as contacts, finds/creates one conversation per number, writes an outbound `messages` row per number, mirrors each into `inbox_messages`, dispatches through `WhatsAppDispatcher` (Node bridge for Unofficial API and WABA, direct for Twilio) and stores the outcome → queue status is rolled up from the latest message per recipient → Node posts delivered/read receipts to `/api/chat/message-status`, which advance the status monotonically and trigger delivery-time billing → the UI polls and toasts transitions. Message History independently reads every message table for reporting and export.

**Engines and plan tiers.** All three WhatsApp engines are supported by routing through the dispatcher (Unofficial API/Baileys, WhatsApp Cloud API/WABA, Twilio). Only conversations on the workspace's currently enabled engines (plus engine-agnostic channels) are visible. Free-form sends on WABA/Twilio are limited by WhatsApp's 24-hour window, which WaDesk does not enforce itself (the provider rejects and the message shows failed); approved templates are the way to open a window. Billing model is chosen elsewhere: default `wallet_billing_on_delivery=1` means no send-time block and charge at delivery; the legacy send-time overflow path (plan quota first, then wallet, then hard stop with HTTP 402) only runs when that admin setting is 0.

**Connections to other domains.** `team-inbox-conversations` (WD-TIB1) shares the `conversations` table, the one-thread-per-number resolver and receives every chat message via the mirror observer; `team-inbox-routing-sla` (WD-TIB2) owns the inbox lifecycle columns on `conversations`; `whatsapp-devices-baileys` (WD-WADEV) supplies senders (`WorkspaceEngine`), owns `WhatsAppDispatcher` and the device detail page that consumes the device-scoped stream; `whatsapp-cloud-api-waba` (WD-WABA) and `node-bridge-runtime` (WD-NODE) provide the transports and receipts; `wallet-message-billing` (WD-WALLET) and `plans-subscriptions-trials` (WD-PLAN) own quota and charging; `message-templates` (WD-TPL) owns template approval, `sendMeta`, the mapping panel and the override resolver; `contacts-attributes-tags` (WD-CON) owns contacts and groups; `broadcasts` (WD-BCAST), `campaigns` (WD-CAMP), `scheduled-queue-warmer` (WD-SCHED) and `auto-reply-keywords` (WD-AR) feed Message History; `ai-keys-usage-admin` (WD-AIADM) supplies the AI call; `mobile-app-api` (WD-MOB) and `chrome-extension-sheets-addon` (WD-EXT) write the same `messages` table through their own controllers; `dashboards-analytics-charts` (WD-DASH) reads `messages` for KPIs; `admin-console-shell` (WD-ASHELL) owns the layout, toaster and role middleware.

**Rebuild guidance in one paragraph.** The new stack should fold `messages` and `inbox_messages` into one table, make one perpetual conversation per contact per channel, send through a queue with provider adapters and forward-only status events, and build Message History as an aggregate read model with real counts (the reference silently computes its KPIs from only the newest 100 rows). Several reference behaviors are bugs or placeholders and are marked QUIRK, `partial` or `dead-code` below so they are not ported blindly.

## Feature index

| Id          | Feature                                                                                  | Status      | Priority | Effort | Depends on                                               |
| ----------- | ---------------------------------------------------------------------------------------- | ----------- | -------- | ------ | -------------------------------------------------------- |
| WD-CHAT-001 | Quick Send page shell, access gate and bootstrap payload                                 | implemented | P0       | M      | WD-WSP (workspace role hierarchy), WD-RBAC               |
| WD-CHAT-002 | Queue list with status filters, search, sort, device filter and counts                   | implemented | P0       | M      | WD-CHAT-001, WD-CHAT-034                                 |
| WD-CHAT-003 | Open a queue thread and render its messages                                              | implemented | P0       | M      | WD-CHAT-002, WD-CHAT-013                                 |
| WD-CHAT-004 | Compose a new queue: send one message to many numbers or a contact group                 | implemented | P0       | L      | WD-CHAT-005, WD-CHAT-012, WD-CHAT-037, WD-WADEV          |
| WD-CHAT-005 | Sender picker across engines and multi-device split                                      | implemented | P1       | M      | WD-CHAT-004, WD-WADEV, WD-WABA, WD-PLAN                  |
| WD-CHAT-006 | Scheduled sends (compose-time and per-message)                                           | partial     | P1       | M      | WD-CHAT-004, WD-CHAT-007, WD-SCHED                       |
| WD-CHAT-007 | Reply composer: send a text message into the open queue                                  | implemented | P0       | M      | WD-CHAT-003, WD-CHAT-012                                 |
| WD-CHAT-008 | Send a file (image, video, audio, document) from the composer                            | implemented | P0       | M      | WD-CHAT-007, WD-SET (storage)                            |
| WD-CHAT-009 | Send a location pin                                                                      | implemented | P2       | S      | WD-CHAT-007                                              |
| WD-CHAT-010 | Template picker (approved templates by category)                                         | implemented | P1       | M      | WD-CHAT-003, WD-TPL                                      |
| WD-CHAT-011 | Send an approved template into a thread (variables, OTP, buttons)                        | implemented | P1       | L      | WD-CHAT-010, WD-CHAT-012, WD-TPL, WD-CON                 |
| WD-CHAT-012 | Dispatch outcome handling, plan/quota gating and "out of credits"                        | implemented | P0       | M      | WD-WALLET, WD-PLAN, WD-WADEV, WD-CORE                    |
| WD-CHAT-013 | Conversation status roll-up (sent / partial / failed / scheduled / pending)              | implemented | P0       | S      | WD-CHAT-003                                              |
| WD-CHAT-014 | Delivery and read receipts for chat sends (Node callback, forward-only status)           | partial     | P0       | M      | WD-CHAT-012, WD-NODE, WD-WALLET                          |
| WD-CHAT-015 | Near-real-time refresh by polling with transition toasts                                 | implemented | P1       | S      | WD-CHAT-002, WD-CHAT-003                                 |
| WD-CHAT-016 | Archive and unarchive a queue                                                            | implemented | P1       | S      | WD-CHAT-002                                              |
| WD-CHAT-017 | Delete a queue (hard delete with cascade)                                                | implemented | P1       | S      | WD-CHAT-002                                              |
| WD-CHAT-018 | Retry failed messages (status flip only)                                                 | partial     | P2       | S      | WD-CHAT-012                                              |
| WD-CHAT-019 | Send again (duplicate the latest outbound message)                                       | partial     | P2       | S      | WD-CHAT-012                                              |
| WD-CHAT-020 | Send now for a scheduled queue (status flip only)                                        | partial     | P2       | S      | WD-CHAT-006                                              |
| WD-CHAT-021 | Queue details drawer (overview, recipients, messages, files, stats)                      | implemented | P1       | M      | WD-CHAT-003                                              |
| WD-CHAT-022 | Message info panel                                                                       | implemented | P2       | S      | WD-CHAT-003                                              |
| WD-CHAT-023 | React to a message with an emoji                                                         | partial     | P2       | S      | WD-CHAT-003                                              |
| WD-CHAT-024 | Pin / unpin a message                                                                    | partial     | P2       | S      | WD-CHAT-003                                              |
| WD-CHAT-025 | Star / unstar a message                                                                  | partial     | P2       | S      | WD-CHAT-003                                              |
| WD-CHAT-026 | Delete a message (local soft delete)                                                     | implemented | P2       | S      | WD-CHAT-003                                              |
| WD-CHAT-027 | Forward a message to another queue                                                       | implemented | P1       | M      | WD-CHAT-012, WD-CHAT-003                                 |
| WD-CHAT-028 | "Reply" to a specific message (client-side indicator only)                               | partial     | P2       | S      | WD-CHAT-007                                              |
| WD-CHAT-029 | AI assist drawer (summarize, suggest reply, rewrite, translate, extract, tone)           | partial     | P2       | M      | WD-CHAT-003, WD-AIADM, WD-AIAG                           |
| WD-CHAT-030 | Recipient number autocomplete endpoint                                                   | dead-code   | P2       | S      | WD-CHAT-004                                              |
| WD-CHAT-031 | Composer conveniences: emoji picker, bold, Enter-to-send, attach menu, quick-reply chips | implemented | P1       | S      | WD-CHAT-007                                              |
| WD-CHAT-032 | WhatsApp-style rich-text editor component (`x-wa-editor`)                                | implemented | P2       | S      | –                                                        |
| WD-CHAT-033 | "Send to all" and "Send to selected" footer buttons (stubs)                              | partial     | P2       | S      | WD-CHAT-002                                              |
| WD-CHAT-034 | Engine-aware conversation visibility (multi-engine and channel exemptions)               | implemented | P0       | M      | WD-WADEV, WD-WABA, WD-TIB1                               |
| WD-CHAT-035 | Outbound chat message → team-inbox mirror (Message observer)                             | implemented | P0       | M      | WD-TIB1, WD-CHAT-036                                     |
| WD-CHAT-036 | Message record lifecycle: encryption at rest, provider stamp, scopes and display time    | implemented | P0       | S      | –                                                        |
| WD-CHAT-037 | Auto-save typed recipients as Contacts                                                   | implemented | P1       | S      | WD-CHAT-004, WD-CON                                      |
| WD-CHAT-038 | Unified message stream (six sources merged into one normalized feed)                     | implemented | P0       | L      | WD-CHAT-036, WD-TIB1, WD-CAMP, WD-BCAST, WD-SCHED, WD-AR |
| WD-CHAT-039 | Message History page (filters, table, detail panel)                                      | partial     | P0       | L      | WD-CHAT-038, WD-CHAT-040                                 |
| WD-CHAT-040 | Message History KPIs, volume/direction/type charts and top conversations                 | partial     | P1       | M      | WD-CHAT-039                                              |
| WD-CHAT-041 | Message History CSV export                                                               | partial     | P1       | S      | WD-CHAT-038                                              |
| WD-CHAT-042 | Message History archive endpoint and dead client hooks                                   | dead-code   | P2       | S      | WD-CHAT-039                                              |
| WD-CHAT-043 | Device-scoped message stream for the device detail page                                  | implemented | P1       | M      | WD-CHAT-038, WD-WADEV                                    |
| WD-CHAT-044 | Toast notifications and flash messages (`wa-toaster`)                                    | implemented | P2       | S      | –                                                        |

## Features

### WD-CHAT-001 — Quick Send page shell, access gate and bootstrap payload

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-WSP (workspace role hierarchy), WD-RBAC
- **Summary:** `/chat` renders the three-column "Quick Send" screen (the docs call it "Chat (1-on-1)"): a left rail of status filters and template-category shortcuts, a middle column listing "message queues" (one row per conversation), and a right thread pane with the composer. The server hands the page a small JSON bootstrap so the first paint does not need a round trip.
- **Actors & access:** Workspace role `manager` or higher (hierarchy owner > admin > manager > agent > viewer) enforced by the `workspace.role:manager` middleware (`EnsureWorkspaceRole`). Platform admins (Spatie Super Admin/Admin, or legacy `users.role` in admin/super-admin/super_admin/platform-admin) bypass the gate. Agents and viewers are redirected (not 403) to `/team-inbox` with a warning flash "Your role (x) doesn't have access to that page."; a user with no role on the current workspace is redirected to `/team-inbox`, or to `register.workspace` when they belong to zero workspaces; a manager+ never reaches a 403 here. No plan/feature flag gate and no permission key: any plan, including trial/expired, reaches the page (the send itself is gated, see WD-CHAT-012).
- **UX & screens:** `resources/views/user/chat/index.blade.php`, layout `x-layouts.user`, page title "Quick Send", nav-key `more`, JS page module `user-chat-index`. Layout: CSS grid `250px / 400px / 1fr` from the `xl` breakpoint; below that the queue list and the thread are one-at-a-time panes (opening a queue adds a `mobile-thread-open` class, the back chevron in the thread header removes it). Left rail: heading "send queue / Quick Send"; six filter buttons All chats, Scheduled, Archived, Sent, Pending, Failed (each with a count pill hidden when zero, `aria-pressed` marks the active one); a dashed divider; three template-category buttons Marketing / Utility / Authentication with the count of approved templates in each (clicking opens the template picker for that category, WD-CHAT-010); a "Live inbox" card that reads "{N} devices connected. Replies update on the selected queue." (N = number of connected senders). Middle column: "bulk send / Message queues" header with a round compose (pencil) button, search box "Search queues...", a device select ("All devices" + connected senders) and a sort select (Newest, Oldest, A to Z, Z to A), a one-line hint "Select a queue to open the thread and send a test reply.", the scrolling queue list, and two footer buttons "Send to all" / "Send to selected" (stubs, WD-CHAT-033). Right column: thread header (avatar initials, title, status dot + meta line, AI button, Archive button, More "⋮" button), the message list, a schedule indicator, a media preview banner, the composer (attach "+", emoji, bold "B", textarea, send) and a three-chip quick bar. Modals/drawers present in the markup: template picker, compose (create queue), queue-details drawer, AI assist drawer, schedule modal, location modal, confirm modal, toast.
- **Endpoints:**

  | Method + URI | Route name  | Controller@action      | Middleware                                           | Request | Response                                |
  | ------------ | ----------- | ---------------------- | ---------------------------------------------------- | ------- | --------------------------------------- |
  | `GET /chat`  | `user.chat` | `ChatController@index` | `web`, `Authenticate`, `EnsureWorkspaceRole:manager` | none    | Blade view with `chatState` JSON island |

- **Data:** Bootstrap `chatState` = `{counts, devices, senders, groups, csrfToken, apiBase: "/chat/api", canMultiDevice}` rendered into `<script id="chat-state" type="application/json">`. `counts` = the same object the list endpoint returns as `meta` (WD-CHAT-002). `devices` = every connected sender across all enabled engines as `{id, label, online:true, engine}` (label is "device label / +phone" unless the label already contains the phone). `senders` adds the composite key and engine label (WD-CHAT-005). `groups` = every contact group `{id, label (group name or "Group #id"), count, color}` ordered by id (see the tenant-scoping QUIRK in WD-CHAT-004). `canMultiDevice` = plan feature `multipledevice` for the current workspace.
- **Rules & edge cases:**
  1. The page is a shell: the queue list is fetched by JS after load (four skeleton cards are shown until the first response); only counts, senders and groups are server-rendered.
  2. Empty sender state: with no connected sender the compose modal shows "No connected device." with a "Connect one →" button.
  3. Copy language: every visible string goes through `__()` on the server or a global `t()` helper on the client (see localization).
  4. QUIRK: the JS keeps the bootstrap object as `state` but later reads `state.activeId` and `state.csrf`, which never exist (see WD-CHAT-029); the CSRF token actually used is `state.csrfToken`.
  5. QUIRK: `groups()` lists `ContactGroup` rows without any workspace/user scope (WD-CHAT-004).
- **Async & events:** None on the server. Client starts a 5 s poll (WD-CHAT-015).
- **External systems:** None at render time.
- **Settings:** None. Plan feature `multipledevice` only changes the compose device picker.
- **Acceptance criteria:**
  - Given a workspace manager, When they open `/chat`, Then the page renders with title "Quick Send", six filter buttons and a `chat-state` JSON island containing counts, senders, groups and `canMultiDevice`.
  - Given a user whose workspace role is agent or viewer, When they open `/chat`, Then they are redirected to `/team-inbox` with the warning flash and no chat data is returned from `/chat/api/*`.
  - Given a platform admin who is not a member of the workspace, When they open `/chat`, Then the role gate passes.
  - Given a workspace with zero connected senders, When the compose modal opens, Then it shows the "No connected device" helper with a connect link.
- **Source refs:** app/Http/Controllers/ChatController.php (index, initialState, counts, devices, composeSenders, groups); app/Http/Middleware/EnsureWorkspaceRole.php; routes/web.php (chat routes); resources/views/user/chat/index.blade.php; resources/js/charts/user-chat-index.js; Documentation/pages/messaging/chat.html.
- **Port notes:** New home `apps/web/app/(app)/quick-send` (or `/inbox/quick-send`) plus `apps/api/src/modules/inbox/conversations`. Role gate maps to the RBAC role hierarchy (WD-RBAC), not a permission key; keep the "redirect agents to the team inbox" behavior in the web app, return 403 from the API. Do not ship a server-rendered JSON island; fetch bootstrap data via an authenticated endpoint. The product name should be "Quick Send" (that is what the UI calls it), not "Chat".

### WD-CHAT-002 — Queue list with status filters, search, sort, device filter and counts

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-CHAT-001, WD-CHAT-034
- **Summary:** The middle column lists the workspace's send queues (conversations) that have at least one outbound message sent from this screen, filtered by status pill, searched by title/preview text, sorted, and optionally restricted to one sender. Filter badges in the left rail show live counts.
- **Actors & access:** Same manager+ gate as WD-CHAT-001. Visibility is workspace-shared: every member with access sees every conversation in the current workspace regardless of who created it (`user_id` is only "who started it"); legacy rows with `workspace_id` NULL are visible only to their `user_id`.
- **UX & screens:** Queue card = initials avatar (first letters of the first two words of the title), title, last-activity label (`M d`), a gear button that opens the queue action menu (WD-CHAT-016 to WD-CHAT-021), the preview line (last message text or `[media_type]`), a status pill (the row's _category_: `archived` if archived else `status`), a secondary status pill when the row is archived and its underlying status is not `sent`, and "{n} contacts" (`recipients_count`). Active card is highlighted; clicking opens the thread (WD-CHAT-003) and, on mobile, slides the thread pane in. Empty state: "No queues — Try another filter or search." and the thread pane resets to "Select a queue / No active thread". Toast "Failed to load queues: {message}" on error. If the active queue id is no longer in the list, the first queue is auto-selected and loaded. Search is debounced 200 ms; changing filter, sort or device re-fetches.
- **Endpoints:**

  | Method + URI                  | Route name                    | Controller@action              | Middleware                                    | Request                                                                                                                                                                                     | Response                                                       |
  | ----------------------------- | ----------------------------- | ------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
  | `GET /chat/api/conversations` | `user.chat.api.conversations` | `ChatController@conversations` | `Authenticate`, `EnsureWorkspaceRole:manager` | `filter` (all\|scheduled\|archived\|sent\|pending\|failed, default all), `sort` (date-desc\|date-asc\|name-asc\|name-desc, default date-desc), `q` (string, max 255), `device_id` (integer) | `200 {data:[conversation…], meta:counts}`; 422 on invalid enum |

- **Data:** Reads `conversations` (+ `messages` via an existence subquery). Conversation presentation shape: `id, title, preview, status, archived, platform, recipients_count, last_message_at (ISO 8601), last_message_ts (epoch s), last_message_lbl ("M d"), category`. `meta` = `{all, scheduled, archived, sent, pending, failed, templates:{marketing, utility, authentication}}`.
- **Rules & edge cases:**
  1. Row set = `forCurrentWorkspace` AND origin in (`chat`, `inbox`, `chatbot`) (campaign-origin conversations are hidden; they live under campaigns) AND `forCurrentEngine` (WD-CHAT-034) AND has at least one non-soft-deleted outbound (`direction='out'`) `messages` row. Inbound-only conversations never appear here; they belong to the team inbox.
  2. Filter semantics: `archived` = `archived=true` whatever the status; `scheduled|sent|pending|failed` = not archived AND `status` equals the value; `all` (or anything else) = not archived. There is no `partial` filter: a `partial` conversation appears only under All. QUIRK: `partial` is produced by the roll-up (WD-CHAT-013) but is absent from `Conversation::STATUSES`, from the counts and from the filter rail.
  3. `device_id` filter is a plain equality on `conversations.device_id`. That column holds a `devices.id` for the Unofficial API but a `wa_provider_configs.id` for WABA/Twilio, so the two id spaces can collide (QUIRK; the composite `engine:id` key exists on the compose side only).
  4. Ordering: `last_message_at` desc then `id` desc (or both ascending for `date-asc`). At most 500 rows are hydrated from SQL; text search and name sorting run in PHP on the decrypted `title`/`preview` because both are encrypted at rest; case-insensitive substring match on either field; result capped at 200 rows. Name sort is case-insensitive on the decrypted title.
  5. `counts` are computed on the same base scope without the 500/200 caps: `all` and per-status counts use non-archived rows; `archived` counts archived rows; `templates` buckets are the counts of approved templates of the current workspace by effective category (meta category if set, else local category when marketing/utility/authentication).
  6. Decryption tolerance: a corrupt/plaintext legacy `title`/`preview` must not 500 the list (safe-read fallback to the raw column).
- **Async & events:** Refetched every 5 s by the poller (WD-CHAT-015).
- **External systems:** None.
- **Settings:** None. Engine set comes from workspace/admin settings (WD-CHAT-034).
- **Acceptance criteria:**
  - Given a workspace with three sent queues and one archived queue, When the All filter is active, Then three rows show and the Archived pill count is 1.
  - Given a queue titled "Diwali VIPs", When the user types "diwali" in search, Then only that queue remains, matching case-insensitively on title or preview.
  - Given sort "A to Z", When the list loads, Then rows are ordered by lowercase decrypted title ascending.
  - Given a conversation with only inbound messages, When the list loads, Then it is not listed and is not counted.
  - Given user B in the same workspace as user A, When B opens the list, Then A's queues are visible.
- **Source refs:** app/Http/Controllers/ChatController.php (conversations, counts, presentConversation, categoryFor); app/Models/Conversation.php (scopes forCurrentWorkspace, chatOnly, filtered, sorted, filterBySearch, sortByKey); resources/views/user/chat/index.blade.php; resources/js/charts/user-chat-index.js (renderQueues, loadQueues, applyCounts).
- **Port notes:** Backed by `conversations` + `messages` in the new inbox module; tenant scoping via RLS (`workspace_id`), not the legacy NULL-workspace fallback. Encrypted title/preview forced in-memory search; in Postgres store a normalized searchable `title`/`preview` (or a trigram index) instead of decrypting up to 500 rows. Add an explicit `partial` status/filter if the roll-up is kept. Use one composite sender reference instead of the colliding `device_id` id spaces.

### WD-CHAT-003 — Open a queue thread and render its messages

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-CHAT-002, WD-CHAT-013
- **Summary:** Selecting a queue loads its full message history and shows it as WhatsApp-style bubbles with media, location pins, template cards, delivery ticks, pin/star/reaction markers and a header summarizing recipients.
- **Actors & access:** Manager+ (WD-CHAT-001). The conversation must belong to the current workspace (or be a legacy own row) else 404.
- **UX & screens:** Header: initials avatar, title, status dot coloured by category, meta text "{recipients_count} contacts — {category}" plus, when more than one distinct outbound recipient is loaded, " · +91…, +44…" (first 8 numbers, then "+K more"). Archive and More buttons are disabled until a queue is selected; the archive button title flips to "Unarchive" for archived rows. Skeleton bubbles show while loading; failure toast "Failed to open thread: …". Empty thread text "No messages yet — type one below." Bubbles: outbound right-aligned mint, inbound left-aligned white; max width 72 %. Text supports WhatsApp-style markup `*bold*`, `_italic_`, `~strike~`, backtick-wrapped code and newlines (HTML is escaped first). Media: image (click opens full size in a new tab), video and audio with native controls, other files as a document card (colour-coded PDF, DOCX, spreadsheet, PPTX, archive, generic; name, type label and human size). Location: a self-drawn pin card (no external map tiles) linking to a Google Maps URL with the coordinates; a legacy body containing a `maps.google.com/?q=` link is hidden when coordinates are present. Template messages show the stored header, footer and button rows (icons for URL, call, copy-code, quick reply). Footer of each bubble: pin icon, star icon, time label, and for outbound rows a tick: clock for pending/scheduled, single grey check for sent, double grey for delivered, double blue for read, red warning + "failed" for failed. A reaction emoji chip hangs off the bubble corner. A hover chevron on every bubble opens the message menu (WD-CHAT-022 to WD-CHAT-027). The list scrolls to the bottom after render.
- **Endpoints:**

  | Method + URI                       | Route name           | Controller@action     | Middleware | Request             | Response                                       |
  | ---------------------------------- | -------------------- | --------------------- | ---------- | ------------------- | ---------------------------------------------- |
  | `GET /chat/api/conversations/{id}` | `user.chat.api.show` | `ChatController@show` | manager+   | path `id` (numeric) | `200 {data:{conversation, messages:[…]}}`, 404 |

- **Data:** Reads `conversations`, `messages` (soft-deleted rows excluded, ordered by `created_at` asc, all loaded, no pagination). Message presentation shape: `id, template_name, header, footer, buttons (array|null), direction, to_number (outbound only), body, media_url, media_type, media_name, media_size, media_mime, latitude, longitude, status, pinned, starred, reaction, time, created_at`. `time` is `HH:MM` if today, "Yesterday", `M d` in the same year, else `M d, Y`, computed from `sent_at` else `created_at` in the app timezone (not the user's). `media_name` is the stored filename after the first `__`; size/mime are read from the media disk when the file exists (errors swallowed).
- **Rules & edge cases:**
  1. Opening a thread re-derives the conversation status with the roll-up (WD-CHAT-013) and persists it if it changed, so a GET writes to the database (self-healing stale `partial` badges).
  2. Template header/footer/buttons come from `messages.meta`; non-array buttons are dropped.
  3. `to_number` is only exposed on outbound rows.
  4. All messages of a conversation are returned in one payload and re-fetched every 5 s while the tab is visible; no pagination or lazy loading.
  5. Media size/mime cost one storage call per message on every fetch (N+1).
- **Async & events:** Re-fetched by the poller (WD-CHAT-015); no server push.
- **External systems:** Media disk (local `public` or the admin-configured cloud disk).
- **Settings:** Media storage driver (admin storage settings).
- **Acceptance criteria:**
  - Given a queue with an image, a document and a location message, When the thread opens, Then the image renders inline, the document renders as a labelled card with size, and the location renders as a pin card linking to the coordinates.
  - Given an outbound message with status `read`, When it renders, Then two blue check marks are shown; with `failed`, a red "failed" marker is shown.
  - Given a template message stored with header, footer and two buttons, When the thread opens, Then the header, footer and both button rows appear under/around the body.
  - Given a queue whose stored status is stale, When the thread is opened, Then the status is recomputed from the messages and saved.
  - Given another workspace's conversation id, When requested, Then the API returns 404.
- **Source refs:** app/Http/Controllers/ChatController.php (show, presentMessage); app/Models/Message.php (getDisplayTimeAttribute); resources/js/charts/user-chat-index.js (renderThread, renderMedia, renderLocation, renderStatusTick, docMeta).
- **Port notes:** Paginate the thread (cursor by id, newest last) instead of loading everything every 5 s; expose media metadata (size, mime, name) as columns captured at upload time rather than reading storage per request; render times in the viewer's timezone. Keep the markup grammar (asterisk, underscore, tilde, backtick) because messages are stored as WhatsApp text.

### WD-CHAT-004 — Compose a new queue: send one message to many numbers or a contact group

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-CHAT-005, WD-CHAT-012, WD-CHAT-037, WD-WADEV
- **Summary:** The compose (pencil) modal creates an outbound send to one or more recipients typed as numbers or taken from a contact group, with a first message and an optional schedule. Despite the "queue" wording the server creates (or reuses) one conversation per recipient number, shared with the team inbox, and immediately dispatches one message per number.
- **Actors & access:** Manager+ (WD-CHAT-001). Multi-sender choice needs plan feature `multipledevice`. Wallet/plan quota checked per message at dispatch (WD-CHAT-012).
- **UX & screens:** Modal "Create a new queue" with: Queue name (required, max 191, placeholder "e.g. Diwali launch — VIPs"); Device (single select, or Tom Select multi-select with live split bar on a multi-device plan; grouped by engine label when several engines are enabled; see WD-CHAT-005); Recipients fieldset with two radio modes "Paste numbers" (textarea, placeholder "+91 98xxxxxxxx, +44 78xxxxxxxx or one per line") and "Pick a group" (select "Select a group…", options "{label} ({count} contacts)"), plus a live "{n} recipient(s)" counter; Initial message (`x-wa-editor`, 4 rows, max 4096, toolbar bold/italic/strike/code/emoji, placeholder that shows a `{{name}}` example) with a right-hand live preview and a tip "Use {{name}} to personalise per contact when sending to a group."; "Send later" checkbox revealing a datetime-local and a timezone select (WD-CHAT-006); inline error box; buttons "Create & send" and "Cancel". Submit disables the button, then on success closes, toasts "Queue created: {title}", selects the new conversation, reloads the list and thread; on failure the server message is shown inline.
- **Endpoints:**

  | Method + URI                   | Route name             | Controller@action                   | Middleware | Request                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Response                                                                                |
  | ------------------------------ | ---------------------- | ----------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
  | `POST /chat/api/conversations` | `user.chat.api.create` | `ChatController@createConversation` | manager+   | JSON: `title` (required, string ≤191), `sender` (string ≤64) or `sender_keys[]` (array ≤20, each string ≤64, distinct), legacy `device_id` (int), legacy `device_ids[]` (array ≤20, int, distinct), `recipient_type` (required: manual\|group), `recipients` (required if manual, string), `contact_group_id` (required if group, integer, must exist in `contact_groups`), `body` (required, ≤4096), `scheduled_at` (string, local datetime), `timezone` (IANA id) | `201 {data:{conversation}, meta:counts}`; `422 {message}` for schedule/recipient errors |

- **Data:** Writes `conversations` (find-or-create per number) and `messages` (one row per number); reads `contacts`, `contact_groups`, `devices` or `wa_provider_configs`, `workspaces`. New conversation fields: `user_id` = creator, `workspace_id`, `device_id` = first picked sender, `contact_group_id` (group mode only), `title` = the number's digits (see QUIRK), `preview` = body, `status` = `pending` (`scheduled` if scheduled), `platform` = legacy code of the chosen engine (`W` Baileys, `WB` WABA, `T` Twilio), `provider` = engine, `origin` = `inbox`, `raw_jid` = digits only, `recipients_count` = 1, `last_message_at` = now, `scheduled_at`/`scheduled_timezone` when scheduled. New message fields: `direction='out'`, `from_number` = sender digits, `to_number` = the recipient exactly as typed, `body`, `status` `pending`/`scheduled`, `scheduled_at`.
- **Rules & edge cases:**
  1. Recipients (manual) are split on commas and newlines, trimmed, blank-dropped and de-duplicated by exact string; nothing is validated or normalized as a phone number (no country-code handling, no minimum length). The conversation key is the digits-only form, so `+91 98…` and `9198…` produce two messages to the same conversation.
  2. Group mode loads every `Contact` with a non-null mobile and keeps those whose decrypted `contact_group` array contains the group id as a string; mobiles are de-duplicated. Unsubscribed contacts are NOT excluded. QUIRK (tenant leak): neither this query, nor `groups()` (the modal's group list), nor the `exists:contact_groups,id` validation is scoped to the workspace, so a request can address another workspace's group id and pull that workspace's contacts. Do not port; scope by tenant.
  3. Empty resolution returns 422 "No recipients resolved. Add at least one number or pick a non-empty group."
  4. Manual numbers are auto-saved as Contacts (WD-CHAT-037) before sending; group sends are not.
  5. One conversation per number: for each number the server calls `ConversationResolver::find(workspace, digits)` (matches digits across `raw_jid`/`alt_jid`/`contact_digits` and JID shapes `@s.whatsapp.net`, `@c.us`, `@lid`); if found, it is reused (preview, `last_message_at` updated; a `scheduled` status resets to `pending`, an immediate send keeps other statuses); else a new row is created. Sending to N numbers yields N conversations, so the same thread appears in Team Inbox and, on reply, the customer's answer lands in it.
  6. QUIRK: the required "Queue name" (`title`) is validated but never stored; the conversation title is the recipient's digits until an inbound reply back-fills the real name. The toast still prints the queue name.
  7. Sender resolution and multi-device split: WD-CHAT-005. Recipient i is sent from sender `i mod k`. If no sender resolves, `from_number` stays empty and the dispatcher falls back to the workspace's newest connected device; if none exists the message fails "No connected device — pair one at /devices first." and the API still returns 201.
  8. Immediate sends are dispatched synchronously in the request, one after another (each up to 40 s, 90 s with media). Each result is applied with `applyDispatchResult` (WD-CHAT-012) and then each touched conversation's status is re-rolled from its messages (WD-CHAT-013). Large groups can therefore time out the request (QUIRK; the port must queue).
  9. Scheduled sends call the dispatcher's `schedule()` instead (WD-CHAT-006); no message is charged until it fires.
  10. The response conversation is the first conversation created/reused, not all of them.
- **Async & events:** Node bridge calls (`/api/send-message/<phone>` etc.) per message; mirror rows in `inbox_messages` via the Message observer (WD-CHAT-035); no broadcast event, no notification, no audit-log row. Contact creation may fire the flow trigger `contact_created` (WD-CHAT-037).
- **External systems:** WhatsApp engines through the dispatcher: Node/Baileys bridge (`SERVER_URL` or admin `baileys_server_url`), Meta Cloud via Node, Twilio direct (WD-WADEV, WD-WABA, WD-NODE).
- **Settings:** Plan feature `multipledevice`; admin `allowed_send_methods`, `default_send_method`; workspace `enabled_engines`; monthly message limit and wallet overflow (WD-PLAN, WD-WALLET).
- **Acceptance criteria:**
  - Given a manager with one connected number, When they submit three comma-separated numbers and a body, Then three conversations (or reused ones) exist, three outbound `messages` rows are created and dispatched, and the response is 201 with the first conversation.
  - Given a previous thread with `919812345678@s.whatsapp.net`, When the manager sends to `+91 98123 45678`, Then the existing conversation is reused and no duplicate thread is created.
  - Given `recipient_type=group` with an empty group, When submitted, Then the API returns 422 with the "No recipients resolved" message.
  - Given a `scheduled_at` less than one minute ahead, When submitted, Then the API returns 422 "Scheduled time must be at least 1 minute in the future (in {tz})." and nothing is created.
  - Given a manual recipient not yet in Contacts, When the send is accepted, Then a Contact with that number exists afterwards.
  - Given another workspace's `contact_group_id`, When submitted, Then (target behavior) the API rejects it; the reference behavior of resolving foreign contacts must not be reproduced.
- **Source refs:** app/Http/Controllers/ChatController.php (createConversation, resolveRecipients, groups, applyDispatchResult, refreshConversationAfterSend); app/Services/Inbox/ConversationResolver.php; app/Models/Contact.php (rememberPhone); resources/views/user/chat/index.blade.php (compose-modal); resources/js/charts/user-chat-index.js (wireCompose); resources/views/components/wa-editor.blade.php; Documentation/pages/messaging/chat.html.
- **Port notes:** Map to `POST /inbox/quick-send` in `apps/api/src/modules/inbox/conversations` creating one `conversations` row per `(org, channel, contact)` — this matches the repo's "one perpetual thread per contact per channel" decision. Resolve numbers to `contacts`/`contact_identities` with E.164 normalization rather than free text. Fan out with a BullMQ send job per recipient (rate limited), persist `messages.status='queued'` first, write outbox events only for conversation lifecycle (messages are audit/outbox-exempt per docs/architecture/messaging.md). Do not port the unscoped group query. Decide whether the "queue name" becomes a real campaign/label; if not, drop the field.

### WD-CHAT-005 — Sender picker across engines and multi-device split

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CHAT-004, WD-WADEV, WD-WABA, WD-PLAN
- **Summary:** The compose modal lists every connected sending number of the workspace across all enabled WhatsApp engines and posts composite `engine:id` keys. On plans with multi-device sending the operator can choose several numbers and the recipients are split round-robin between them.
- **Actors & access:** Manager+. Multi-select requires plan feature `multipledevice` (`PlanLimitGuard::hasFeature`); without it any multi-value request is silently truncated to the first sender (a tampered request cannot bypass the plan).
- **UX & screens:** Single-select `sender` (first option "No sender selected") on non-multi plans, or a Tom Select pill multi-select `sender_keys[]` ("Choose one or more senders…", remove buttons, click-to-add) on multi plans with the caption "Multi-device · plan unlocks split sending" and the helper "Click a device to add — recipients split evenly across the chosen devices…". Options show "label / +phone" and an online dot (always online because only connected senders are listed). When more than one engine is enabled the options are grouped by an engine label ("Unofficial API" for Baileys; never "Baileys"). A "Split preview" bar renders one coloured segment per chosen sender (palette of 5, recycled) with the share count and a summary "{n} recipients → {k} devices" or "Add recipients to see the split"; a minimum visible width of 6 % keeps small shares visible.
- **Endpoints:** Part of `POST /chat/api/conversations` (WD-CHAT-004); no separate endpoint. The picker data comes from the `chat-state` bootstrap (`senders`).
- **Data:** Reads `wa_provider_configs`, `devices`. Sender option shape: `{key: "engine:id", id, engine, engineLabel, label, phone, online, is_default}`; default-engine senders sort first.
- **Rules & edge cases:**
  1. Input precedence: `sender_keys[]`, else `sender`; each key is resolved with `WorkspaceEngine::senderForKey` and unknown/forged/stale keys are skipped silently (no error). The first accepted key fixes the engine; keys of other engines are ignored (mixed-engine picks unsupported). If the unified picker yields nothing, the legacy `device_ids[]`/`device_id` (bare integers) are used.
  2. The chosen ids are intersected with the workspace pool: Baileys → `devices` of the current workspace; WABA/Twilio → `wa_provider_configs` of that provider in the workspace (a config becomes a pseudo-device with `country_code=''`, `phone_number`, label `display_label` or "{ENGINE} #id"). Pick order is preserved.
  3. Sender phone digits = digits of `country_code . phone_number`; `conversations.device_id` = first sender's id; `from_number` on each message = sender `index mod count`.
  4. The conversation `provider` and legacy `platform` code come from the chosen engine (fallback: workspace default engine via `WorkspaceEngine::for`), otherwise every new conversation would be stamped Baileys and immediately hidden by the engine filter on WABA workspaces.
  5. Client-side split preview mirrors the server's round-robin exactly.
- **Async & events:** None.
- **External systems:** None beyond the engines' connection state.
- **Settings:** Plan feature `multipledevice`; workspace `enabled_engines`; admin `allowed_send_methods`.
- **Acceptance criteria:**
  - Given a multi-device plan and senders A and B, When 5 recipients are submitted with both selected, Then recipients 1,3,5 go out from A and 2,4 from B and the preview bar shows 3 and 2.
  - Given a plan without `multipledevice`, When a request carries three sender keys, Then only the first is used.
  - Given a sender key from another workspace, When submitted, Then it is ignored and the send falls back to the default device resolution without an error.
  - Given a WABA workspace, When a queue is created, Then the conversation is stamped `provider='waba'`, `platform='WB'` and remains visible in the list.
- **Source refs:** app/Http/Controllers/ChatController.php (createConversation sender block, composeSenders, devices); app/Services/WorkspaceEngine.php (senders, senderForKey, enginesFor); resources/js/charts/user-chat-index.js (wireCompose recomputeSplit); resources/views/user/chat/index.blade.php.
- **Port notes:** In the new stack a sender is a `channels` row (`channel_id`); validate ownership by RLS instead of key parsing. Keep round-robin (deterministic by recipient index) and the plan gate as a limit check (`multi_sender`). Return an explicit 422 for an unusable sender instead of the silent skip.

### WD-CHAT-006 — Scheduled sends (compose-time and per-message)

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CHAT-004, WD-CHAT-007, WD-SCHED
- **Summary:** A send can be deferred either when creating a queue ("Send later" with a date-time and timezone) or for a single reply via the composer's "Scheduled time" attach option. The message is stored with status `scheduled` and handed to the Node scheduler. Advancing the message after it fires is not wired back to this screen (see rules).
- **Actors & access:** Manager+. Wallet/quota is charged only when the message fires (scheduled sends meter at fire time, not at scheduling).
- **UX & screens:** Compose: checkbox "Send later — Pick a time at least 1 minute in the future. Otherwise the queue sends immediately." reveals a `datetime-local` input and a timezone `<select>` (all PHP IANA identifiers) defaulting to workspace timezone → user timezone → app timezone. Thread: attach menu "Scheduled time" opens a modal "Scheduled send / Pick a date & time" with Date, Time and Timezone and buttons Clear / Cancel / Save. Save requires both date and time (toast "Pick both date and time") and a moment at least 1 minute ahead evaluated in the picked timezone (toast "Schedule a time at least 1 minute in the future"). A pinned indicator above the composer reads "Scheduled for {locale date, short time}" with an X to cancel. The next text/media send in that thread carries the schedule, then the indicator is cleared; the toast reads "Scheduled".
- **Endpoints:** Part of `POST /chat/api/conversations` (fields `scheduled_at`, `timezone`) and `POST /chat/api/conversations/{id}/messages` (same fields).
- **Data:** `messages.scheduled_at` (UTC), `messages.status='scheduled'`; `conversations.status='scheduled'`, `conversations.scheduled_at`, `conversations.scheduled_timezone`.
- **Rules & edge cases:**
  1. Timezone precedence when creating: request `timezone`, else workspace timezone, else user timezone, else `app.timezone`. When replying: request `timezone`, else the conversation's stored `scheduled_timezone`, else workspace, user, app. Replying with a schedule writes the resolved timezone onto the conversation.
  2. The local `scheduled_at` string is parsed in that timezone and converted to a UTC string; reject with 422 "Scheduled time must be at least 1 minute in the future (in {tz})." when earlier than now+1 minute, or 422 "Could not parse scheduled date." on parse errors. The timezone must be a valid IANA identifier.
  3. Scheduled rows are handed to the dispatcher's `schedule()`, which posts to Node `/api/schedule-message/<phone>` with the wall-clock time in the stored timezone (`scheduleDateTime`, `timezone`, `messageType` text/media/media_with_caption/location, media URL, coordinates, optional `targetJid`). On success the row stays `scheduled`; on failure it becomes `failed`.
  4. The stored value is written as `Carbon::parse(<utc string>)`, i.e. re-read in the app timezone; if `app.timezone` is not UTC the instant shifts (QUIRK, unverified at runtime).
  5. QUIRK: no code path found in this domain or in `ScheduledController` advances a `messages` row from `scheduled` to `sent` after Node fires; the Node callback `/api/update-schedule-status` matches `scheduled_messages` only. The only transition is the manual "Send now" (WD-CHAT-020, DB flip only). The conversation stays `scheduled`.
  6. Template sends (WD-CHAT-011) and forwards cannot be scheduled.
- **Async & events:** Node scheduler job (cron by wall-clock time and timezone); no Laravel job. Status callbacks are not handled for these rows.
- **External systems:** Node bridge `/api/schedule-message/<phone>`.
- **Settings:** Timezones: workspace `timezone`, user `timezone`, `app.timezone`.
- **Acceptance criteria:**
  - Given a schedule of "tomorrow 09:00 Asia/Kolkata", When the reply is sent, Then the message is stored `scheduled` with `scheduled_at` = 03:30 UTC, the conversation status is `scheduled` and the timezone is stored on the conversation.
  - Given a time 30 seconds ahead, When submitted (UI or API), Then the request is rejected and no row is created.
  - Given a scheduled queue, When the user filters by Scheduled, Then the queue appears with the Scheduled pill.
  - Given the wallet is empty, When a scheduled message is created, Then it is accepted and no charge happens until fire time.
- **Source refs:** app/Http/Controllers/ChatController.php (createConversation, sendMessage); app/Services/WhatsAppDispatcher.php (schedule, buildNodeRequest scheduled branch); resources/js/charts/user-chat-index.js (wireScheduleModal, isAtLeastOneMinuteFromNow, showScheduleIndicator); Documentation/pages/messaging/chat.html.
- **Port notes:** Use BullMQ delayed jobs keyed by `message_id` in UTC instead of the Node scheduler; store `scheduled_at timestamptz` and the display timezone separately; on fire, write the status transition and receipts through the same path as immediate sends so the row never sticks at `scheduled`. Charge at fire time (matches the reference).

### WD-CHAT-007 — Reply composer: send a text message into the open queue

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-CHAT-003, WD-CHAT-012
- **Summary:** With a thread open the composer sends free-form text (optionally with an attachment, a location, or scheduled) to that thread's recipient over the queue's own sender number.
- **Actors & access:** Manager+. Wallet/monthly quota at dispatch. On Cloud API/Twilio engines free-form text only works inside WhatsApp's 24 h window (the platform does not enforce it; the provider rejects it and the message shows failed).
- **UX & screens:** Textarea "Type a message" (auto-grow up to ~92 px), Enter sends, Shift+Enter inserts a newline, send button is disabled when the box is empty and no attachment is pending. No thread selected → toast "Select a queue first". After success the bubble is appended immediately, the queue row re-sorts, the composer/attachment/schedule are cleared and a toast "Message sent" (or "Scheduled") shows; on API failure the toast is "Send failed: {message}". Quick-bar chips fill the composer (WD-CHAT-031).
- **Endpoints:**

  | Method + URI                                 | Route name           | Controller@action            | Middleware | Request                                                                                                                                                                                                                                  | Response                                                                                                                                  |
  | -------------------------------------------- | -------------------- | ---------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
  | `POST /chat/api/conversations/{id}/messages` | `user.chat.api.send` | `ChatController@sendMessage` | manager+   | multipart: `body` (required unless `media` or `latitude` present, ≤4096), `media` (file ≤10240 KB, mimes jpg,jpeg,png,gif,webp,mp4,webm,mp3,wav,pdf,doc,docx), `latitude` (−90..90), `longitude` (−180..180), `scheduled_at`, `timezone` | `201 {data:{message, conversation, dispatch}, meta:counts}`; `402 {ok:false, error:"out_of_credits", message}`; `422` validation/schedule |

- **Data:** Writes `messages` (`direction='out'`, `user_id`, `workspace_id` from the conversation, `from_number`, `to_number`, `body`, media fields, coordinates, `status='pending'`, `scheduled_at`); updates `conversations.preview/last_message_at/status`.
- **Rules & edge cases:**
  1. The recipient is resolved in order: the latest outbound row's `to_number`; else the latest inbound row's `from_number`; else the digits before `@` in `conversations.raw_jid`. If none exists the message is created and immediately failed with "No recipient on this conversation. Recreate the queue." (HTTP still 201).
  2. The sender number comes from the conversation's pinned channel: for `provider` waba/twilio the `wa_provider_configs` row with id = `device_id`; otherwise the `devices` row of the workspace. This prevents follow-ups leaving from the Baileys primary number when the queue was created on WABA.
  3. The platform hint is `conversations.platform`, else the workspace engine's legacy code.
  4. The row is written as `pending` first and then dispatched (durable even if the provider call throws); `applyDispatchResult` (WD-CHAT-012) sets `sent`/`scheduled`/`failed` and `sent_at`.
  5. Preview after send = body, or `[media_type]`, else unchanged; `last_message_at` = `sent_at` or `created_at`.
  6. QUIRK: the client toasts "Message sent" even when the response carries `dispatch.ok=false` (the bubble then shows the failed tick); it never inspects `dispatch`.
  7. QUIRK: a reply to a _multi-recipient legacy_ thread goes only to the most recent outbound recipient.
  8. Body is stored as typed (no trimming beyond the client `trim()`); no server-side sanitization.
- **Async & events:** Synchronous dispatch to Node `/api/send-message`, `/api/send-media-message`, `/api/send-media-only` or `/api/send-location` (WD-CHAT-008/009); Message observer mirrors to `inbox_messages` (WD-CHAT-035).
- **External systems:** Node bridge / Meta Cloud via Node / Twilio through `WhatsAppDispatcher`.
- **Settings:** Same as WD-CHAT-004.
- **Acceptance criteria:**
  - Given an open thread with a prior outbound message, When the user types "hi" and presses Enter, Then a `pending` message is created with the earlier recipient and sender, dispatched, and the bubble appears with a sent tick.
  - Given a WABA-pinned queue, When a reply is sent, Then `from_number` is the WABA config's number, not the Baileys device.
  - Given an empty composer and no attachment, When Enter is pressed, Then nothing is sent.
  - Given a thread with no message and no `raw_jid`, When a reply is attempted, Then the message is saved as failed with the recreate-queue reason.
  - Given the workspace has exhausted quota and wallet, When a reply is sent, Then the API returns 402 with error `out_of_credits` and the message is failed.
- **Source refs:** app/Http/Controllers/ChatController.php (sendMessage, conversationSenderPhone, applyDispatchResult, refreshConversationAfterSend); resources/js/charts/user-chat-index.js (sendMessage, syncSendState).
- **Port notes:** `POST /conversations/:id/messages` in the inbox messages module; recipient = the conversation's contact identity (never re-derived from the last row); enforce the 24 h service window from `conversations.service_window_expires_at` and reject free-form outside it with a template-required error; queue the send and return 202 + message id so the UI can show `queued`.

### WD-CHAT-008 — Send a file (image, video, audio, document) from the composer

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-CHAT-007, WD-SET (storage)
- **Summary:** The "+" attach menu lets the operator attach a document, a photo/video, or an audio file (one file per message), preview it, optionally add a caption, and send it through the queue's number.
- **Actors & access:** Manager+.
- **UX & screens:** Attach menu items: Template, Document (accept `application/pdf,.doc,.docx`), Photos & videos (`image/*,video/*`), Audio (`audio/*`), Scheduled time, Send your location. Choosing a file shows a banner above the composer with a thumbnail (image), first-frame video with a play glyph, an audio glyph, or a document glyph with the extension, the file name and "{mime} · {size in KB/MB}", and an X to remove it. Send is enabled with a file even with no text; text becomes the caption. Object URLs are revoked on clear.
- **Endpoints:** Same as WD-CHAT-007 (`media` field).
- **Data:** Stores the upload on the media disk (`media_disk()`: local `public` disk or the admin-configured cloud disk) at `chat-media/<10 random chars>__<sanitized original name>` (name sanitized to `[A-Za-z0-9._-]`, others → `_`); `messages.media_path` = that key, `messages.media_type` derived from the client extension.
- **Rules & edge cases:**
  1. Server validation: file, max 10240 KB (10 MB), extension/mime in jpg, jpeg, png, gif, webp, mp4, webm, mp3, wav, pdf, doc, docx. There is no client-side size or type check beyond the picker `accept`; a violation returns Laravel's 422 message which the toast prints as "Send failed: …".
  2. `media_type`: image (jpg/jpeg/png/gif/webp), video (mp4/webm/mov), audio (mp3/wav/m4a/ogg), otherwise document. QUIRK: mov/m4a/ogg are mapped but unreachable because validation rejects them, while the audio picker accepts `audio/*`.
  3. At dispatch time the file is read from the disk and sent inline as base64 with the real mime type and the original file name (recovered from the part after `__`), because Node cannot reliably fetch the app's own URL (single-threaded dev server, private-IP guard). Timeout is 90 s for media, 40 s for text. With a caption the Node endpoint is `/api/send-media-message/<phone>`, without `/api/send-media-only/<phone>`. External non-local URLs pass through as links.
  4. A voice-note flag (`meta.ptt`) is supported by the dispatcher but nothing here sets it; audio goes as a plain audio file.
  5. Preview text of the conversation becomes `[image]`, `[video]`, `[audio]` or `[document]` when there is no caption.
  6. The queue-details "Files" tab lists every message with a `media_path` (WD-CHAT-021).
- **Async & events:** As WD-CHAT-007.
- **External systems:** Object storage/media disk; Node bridge.
- **Settings:** Admin storage settings (local vs cloud disk); no per-plan file-size limit.
- **Acceptance criteria:**
  - Given a 3 MB PDF, When it is attached and sent with caption "Invoice", Then a message with `media_type='document'` and body "Invoice" is created, stored under `chat-media/`, and dispatched via send-media-message with the original file name.
  - Given a 12 MB video, When sent, Then the API returns 422 and no message row is created.
  - Given a `.exe` renamed `.pdf`, When sent, Then server-side mime validation rejects it.
  - Given an image sent without text, When it lands, Then the queue preview reads `[image]`.
- **Source refs:** app/Http/Controllers/ChatController.php (sendMessage media block, resolveMediaType, presentMessage); app/Services/WhatsAppDispatcher.php (buildNodeRequest media branch, mergeButtonsFooter); resources/js/charts/user-chat-index.js (showMediaPreview, attach menu wiring); helpers media_disk/media_storage/media_url in app/Support/fc_helpers.php.
- **Port notes:** Upload to object storage with presigned URLs and a tenant-prefixed key; store `mime`, `size`, `filename` columns; validate by sniffed content type; raise the limit per WhatsApp limits (image 5 MB, video/audio/doc up to 16/100 MB by type) rather than a flat 10 MB; send by signed URL (provider adapters fetch) instead of inline base64 in a PHP request.

### WD-CHAT-009 — Send a location pin

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CHAT-007
- **Summary:** "Send your location" opens a small modal where the operator types latitude/longitude or fills them from the browser, then sends a native WhatsApp location message.
- **Actors & access:** Manager+.
- **UX & screens:** Modal "Send a location pin": button "Use my current location" (browser geolocation, high accuracy, 10 s timeout; error "Geolocation is not available in this browser." or "Could not get current location: …"), Latitude and Longitude number inputs (step 0.0000001, placeholders 28.6139 / 77.2090), an error line "Latitude must be ±90 and longitude ±180.", buttons Cancel / "Send pin". A success toast reads "Location sent".
- **Endpoints:** `POST /chat/api/conversations/{id}/messages` with `latitude` and `longitude` only (no body).
- **Data:** `messages.latitude/longitude` (decimal 10,7), `media_type='location'`, `body` null; preview `[location]`.
- **Rules & edge cases:**
  1. `body` is not required when `latitude` is present. `latitude` numeric −90..90, `longitude` numeric −180..180; the two are not required together.
  2. The controller marks the row as a location only when both are non-empty via `!empty()`, so a coordinate of exactly 0 (equator or prime meridian) is treated as absent (QUIRK). A latitude without a longitude creates a message with no body and no location type that the dispatcher sends as an empty text (QUIRK).
  3. If a file is attached the media wins over coordinates.
  4. The dispatcher sends a pure location pin via Node `/api/send-location/<phone>` only when the message has no template buttons; otherwise the location rides after the buttons message.
  5. Location bubbles render as a self-drawn pin card with a Google Maps link (WD-CHAT-003).
- **Async & events:** As WD-CHAT-007.
- **External systems:** Node `/api/send-location`.
- **Settings:** None.
- **Acceptance criteria:**
  - Given lat 28.6139 and lng 77.2090, When "Send pin" is pressed, Then a location message is created and dispatched and a pin card appears in the thread.
  - Given lat 95, When submitted from the modal, Then the modal shows the range error and nothing is sent; via API the response is 422.
  - Given lat 0 and lng 36.8, When sent through the API, Then the target behavior is a valid location message (the reference drops it).
- **Source refs:** app/Http/Controllers/ChatController.php (sendMessage); app/Services/WhatsAppDispatcher.php (buildNodeRequest location branch); resources/js/charts/user-chat-index.js (wireLocationModal, sendLocation).
- **Port notes:** Validate `latitude`/`longitude` as a required pair with `!== null` checks; model as `messages.type='location'` with a JSON payload `{lat, lng, name?, address?}` (the reference also carries name/address in `header_location` for templates).

### WD-CHAT-010 — Template picker (approved templates by category)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CHAT-003, WD-TPL
- **Summary:** From the left rail category buttons or the attach menu "Template", the operator opens a modal listing the workspace's approved templates, previews the full template (header media, body, footer, buttons, carousel cards) and fills the shared send-time mapping panel before sending it into the open thread.
- **Actors & access:** Manager+. Only _approved_ templates of the current workspace are listed (WABA workspaces: template has a Meta template id, Meta status APPROVED and is not paused; other engines: local status `approved` or `public`; in every case a template bound to a WABA number is hidden when that number is disconnected or removed).
- **UX & screens:** Modal "Choose a template" with an eyebrow that names the active category ("Marketing templates", "Utility templates", "Authentication templates", "All templates"), a two-column card grid (category-coloured icon, name, category tone pill, 2-line body clamp) and a right rail: "Preview", the mapping panel (`#chat-tlm-panel`, hidden until a template is selected), "Target queue" (title of the open queue or "No queue selected") and the "Send template" button (disabled until a template and a queue are chosen). Opening shows six skeleton cards immediately; the first template is auto-selected on load; picking another template clears the mapping overrides. Errors: "Failed to load templates: …" and "Could not load templates.". Preview rules: header media rendered as image or video (other types as a chip), body with WhatsApp markup, footer, up to three top-level buttons with type icons (URL, call, copy; quick replies without icon), carousel cards in a horizontally scrolling strip (card image, title, body, its buttons). Esc or a backdrop click closes it. A token counter ignores stale responses when the picker is reopened with another category mid-fetch.
- **Endpoints:**

  | Method + URI              | Route name                | Controller@action          | Middleware | Request                                                           | Response                                                                                                                      |
  | ------------------------- | ------------------------- | -------------------------- | ---------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
  | `GET /chat/api/templates` | `user.chat.api.templates` | `ChatController@templates` | manager+   | `category` (all\|marketing\|utility\|authentication, default all) | `200 {data:[{id,title,category,tone,body,template_type,header,footer,buttons,carousel_data,media_url,media_type,send_meta}]}` |

- **Data:** Reads `wa_templates` (workspace scoped, approved) ordered by id desc then re-sorted in PHP by lowercase name (name/body are encrypted at rest). `category` = effective category (Meta category when set, else the local category if it is marketing/utility/authentication, else empty string). `template_type` defaults to `standard`. `media_url` from the template attachment via the media disk. `send_meta` = the shared slot/media/button descriptor used by every send screen (locked for authentication templates; header media and button links locked for Twilio).
- **Rules & edge cases:**
  1. Category filter uses the effective category, not the raw local category.
  2. Category counters in the rail come from the same effective-category bucketing (WD-CHAT-002).
  3. Templates whose effective category is empty appear only under "All".
  4. The mapping panel is the shared module used by campaigns, broadcasts, scheduled and the team inbox; it edits variable values, header media and button links for this send only.
- **Async & events:** None.
- **External systems:** Header media may be uploaded through the shared `/api/upload-media` route (owned by flows) from the mapping panel.
- **Settings:** Engine (WABA vs others) decides the approval predicate.
- **Acceptance criteria:**
  - Given a WABA workspace with one approved and one pending template, When the picker opens on "All", Then only the approved template is listed.
  - Given category Utility, When the picker loads, Then only templates with effective category utility appear, sorted by name case-insensitively.
  - Given a carousel template, When it is selected, Then its cards appear in the preview strip.
  - Given no queue is open, When the picker opens, Then "Send template" stays disabled and the target reads "No queue selected".
- **Source refs:** app/Http/Controllers/ChatController.php (templates, counts); app/Models/WaTemplate.php (scopeApproved, scopeProviderLive, effectiveCategory, sendMeta); resources/js/charts/user-chat-index.js (openTemplatePicker, renderTemplatePicker); resources/js/charts/template-live-mapping.js (shared).
- **Port notes:** Read from the templates module (WD-TPL); expose `GET /templates?usable_for=conversation:{id}` so the same approval and window rules are applied in one place. The shared mapping panel becomes a shared React component.

### WD-CHAT-011 — Send an approved template into a thread (variables, OTP, buttons)

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** WD-CHAT-010, WD-CHAT-012, WD-TPL, WD-CON
- **Summary:** Sends the selected template to the thread's recipient with placeholders resolved from the matched contact, the template's variable map, operator overrides and (for authentication templates) a freshly minted 6-digit OTP. This is the supported way to open a conversation outside the 24-hour window on Cloud API/Twilio.
- **Actors & access:** Manager+. The template must be an approved template of the caller's own workspace (a foreign template id yields 404 — the validation `exists:wa_templates,id` alone is global, the query re-scopes it).
- **UX & screens:** The picker's "Send template" button (WD-CHAT-010). On success: bubble appended with header/footer/buttons, picker closes, toast "Template sent"; on failure toast "Failed: {message}".
- **Endpoints:**

  | Method + URI                                 | Route name                    | Controller@action             | Middleware | Request                                                                                             | Response                                                                                                |
  | -------------------------------------------- | ----------------------------- | ----------------------------- | ---------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
  | `POST /chat/api/conversations/{id}/template` | `user.chat.api.send-template` | `ChatController@sendTemplate` | manager+   | JSON `template_id` (required int, exists), `template_overrides` (nullable JSON string ≤20000 chars) | `201 {data:{message, conversation}, meta}`; `402 out_of_credits`; `422 {ok:false,message}` no recipient |

- **Data:** Writes `messages` (`template_id`, `direction='out'`, `to_number`, `from_number`, `body` = resolved body, `media_path`/`media_type` = template attachment, `status='pending'`, `meta`). `meta` (empty values dropped) keys: `template_id`, `template_name`, `category`, `template_type`, `carousel_data` (only for carousel templates), `buttons` (resolved), `header`, `header_location`, `footer`, `otp_code`, `template_vars` (positional map for Twilio), `header_media_url` (override).
- **Rules & edge cases:**
  1. Contact match: digits of `raw_jid` (fallback: last outbound `to_number`, then last inbound `from_number`), then workspace contacts are hydrated and matched in PHP on decrypted `mobile` by exact digits, suffix match, or last-10-digit match.
  2. Token grammar `{{ token }}` accepts spaces inside (`{{First Name}}`); token is trimmed. Resolution order per token: (a) authentication template and token in `1`, `otp`, `code` → minted OTP; (b) non-blank operator override; (c) numeric token → template `variable_map.body` (nested `{num,key}` or legacy flat `slot=>key`) → contact attribute; (d) named token → contact attribute. Contact attribute aliases: `name`, `first_name` → name; `phone`, `mobile` → phone number; `email`; `company`; else `custom_attributes` by raw key, normalized key (spaces/dashes → underscore, lowercase) or Title Case. With no matching contact, `phone`/`mobile`/`number` resolve to the thread digits and everything else to empty string.
  3. Header and body are substituted; the footer is copied verbatim (no substitution, QUIRK).
  4. Buttons: overrides by button index are applied first (value may itself contain tokens), then `text` and `value` are substituted; authentication copy-code/otp buttons get the minted code as value; structurally invalid buttons are dropped (any action button with neither `value` nor `url`; only quick replies may be value-less), because WhatsApp drops the entire button set otherwise.
  5. Authentication templates generate a new OTP per send (`random_int(100000, 999999)`), placed in body, header tokens and button, and stored in message `meta.otp_code` in clear JSON (QUIRK).
  6. Operator overrides go through the shared `TemplateOverrideResolver` (sanitize + `BroadcastsController::varsForRecipient` + positional flatten); any failure in that step is logged and ignored (the send continues with template defaults).
  7. Recipient resolution: latest outbound `to_number`, latest inbound `from_number`, `raw_jid`, then `alt_jid`, then `contact_digits`, then the matched contact's mobile, then a digits-only conversation title of at least 8 digits. If nothing resolves the endpoint refuses with 422 "Could not determine the recipient number for this chat. Open the conversation and confirm the number, then try the template again." (Never POST an empty recipient to Meta.)
  8. The send is immediate (no schedule option), goes through the dispatcher with the queue's platform hint, and updates the conversation preview/status via the roll-up.
  9. Carousel templates travel in `meta.carousel_data`; media templates travel as `media_path`; a template with buttons is sent as an interactive/buttons message on Baileys.
- **Async & events:** Node bridge send; mirror to `inbox_messages` (WD-CHAT-035). No template usage counter is incremented here.
- **External systems:** Node bridge `/api/send-message` (buttons/footer/title/carousel), Meta Cloud via Node (template component payload), Twilio ContentSid path via `template_vars`.
- **Settings:** Templates' approval state (WD-TPL); same plan/wallet settings as WD-CHAT-012.
- **Acceptance criteria:**
  - Given a template "Hi {{name}}, order {{1}}" with `variable_map` slot 1 → `order_id` and a matched contact, When sent, Then the stored body has the contact's name and order attribute substituted.
  - Given an authentication template, When sent twice to the same contact, Then two different 6-digit codes are used and each appears in the body and the copy-code button.
  - Given an override for slot 1 of "ORD-9", When sent, Then "ORD-9" is used instead of the mapped attribute.
  - Given a thread with no resolvable recipient, When a template is sent, Then the API returns 422 with the recipient message and no message row is created.
  - Given a template id from another workspace, When posted, Then the API returns 404.
  - Given a button of type URL with an empty value, When sent, Then that button is removed from the outgoing payload.
- **Source refs:** app/Http/Controllers/ChatController.php (sendTemplate); app/Services/TemplateOverrideResolver.php (shared); app/Http/Controllers/BroadcastsController.php (varsForRecipient, shared); app/Models/WaTemplate.php; app/Services/WhatsAppDispatcher.php (mergeButtonsFooter, buildTwilioContentVariables); resources/js/charts/user-chat-index.js (sendSelectedTemplate); Documentation/pages/messaging/chat.html.
- **Port notes:** Implement variable resolution once in the templates module (shared by chat, campaigns, broadcasts, team inbox); store the resolved payload on the message (`payload` jsonb) and keep OTPs out of plain logs/JSON. Use the conversation's contact identity instead of scanning all contacts by decrypted mobile (use a hashed/normalized phone column).

### WD-CHAT-012 — Dispatch outcome handling, plan/quota gating and "out of credits"

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-WALLET, WD-PLAN, WD-WADEV, WD-CORE
- **Summary:** Every send in this domain saves the message first, hands it to `WhatsAppDispatcher`, and then stores the outcome on the row: `sent`, `scheduled` or `failed` (with a reason). Quota/wallet failures surface as a structured 402 that the UI shows as a toast.
- **Actors & access:** Manager+. Applies to create, reply, template and forward.
- **UX & screens:** A failed message shows the red failed tick; its reason is visible in Message info (WD-CHAT-022) and the queue-details recipients tab (WD-CHAT-021). A 402 shows a toast "Send failed: Out of message credits. Top up your wallet or earn credits via the affiliate program." (or the exception's own message).
- **Endpoints:** Behavior of the send endpoints in WD-CHAT-004, 007, 011, 027.
- **Data:** `messages.status`, `sent_at`, `failure_reason` (encrypted), `from_number` (see rule 4).
- **Rules & edge cases:**
  1. `applyDispatchResult`: `ok=true` → `sent` + `sent_at=now` (or `scheduled` with no `sent_at` for scheduled sends); `ok=false` → `failed` + `failure_reason` = the provider/dispatcher error text or "unknown error". A `local_only` success (no Node server URL configured) is recorded as `sent` even though nothing left the platform (QUIRK).
  2. Dispatcher pre-checks that fail without an exception: platform emergency halt (admin `platform.emergency_send_halt`) → `ok=false`, platform `halted`, error "Platform emergency halt is engaged…"; WhatsApp guardrail screening (`SendGate::screen`, rate caps and content filters when the admin mode is monitor/enforce) → `ok=false`, platform `blocked`, error = the guardrail message.
  3. Provider resolution order: per-record `provider` pin if admin-allowed; else the workspace's primary connected provider config if allowed; else the legacy platform hint (`W`/`WB`/`T`, ignoring the default `W`); else admin `default_send_method`, else the first allowed method. Baileys/WABA go through Node; Twilio has a PHP-direct path.
  4. QUIRK: the provider's message id (`provider_id`) is only copied into `from_number` when that field was empty; it is not stored as `meta.wa_message_id`, so later receipts/reactions cannot find these rows (WD-CHAT-014, WD-CHAT-023 to 025).
  5. Send-time quota gate: `WhatsAppDispatcher::send` calls `guardMonthlyMessagesLimit` → `OverflowBilling::consumeOne`. With the default admin setting `wallet_billing_on_delivery=1` this returns immediately (billing happens at delivery, WD-CHAT-014), so no message is blocked at send time. Only when `wallet_billing_on_delivery=0` does the legacy path apply: usage = outbound `messages` rows this calendar month for the workspace's members plus outbound `inbox_messages` of the workspace's conversations (which double counts every chat send because of the mirror, WD-CHAT-035); an expired plan blocks sending ("Your plan has ended — renew your plan…") unless pay-per-message/reseller mode is on; under `monthly_messages_limit` is free; over the limit one wallet credit (or the per-country credit rate for the recipient country and message category — template category, else `service`) is debited from the workspace owner's wallet with a `plan_overflow` ledger row; wallet empty → `PlanLimitReachedException`. Admins and admin-owned workspaces bypass.
  6. `PlanLimitReachedException` handling differs: reply and template return HTTP 402 `{ok:false, error:"out_of_credits", message}` after marking the row failed (reason truncated to 191 chars) and refreshing the conversation; forward returns 402 `{message}`; queue creation marks each affected row failed and still returns 201.
  7. There is no refund logic in this controller (the docs claim "credit refunded on failure"); delivery-time billing simply never charges a failed message.
- **Async & events:** Synchronous provider call; wallet ledger rows and `message_charges` are written by WD-WALLET at delivery.
- **External systems:** Node bridge, Meta, Twilio (see WD-CHAT-004).
- **Settings:** Admin: `wallet_billing_on_delivery` (default 1), `bsp_pay_per_message`, `allowed_send_methods`, `default_send_method`, `baileys_server_url`, `platform.emergency_send_halt`, guardrail settings; plan limit `monthly_messages_limit`.
- **Acceptance criteria:**
  - Given a successful Node response, When a reply is sent, Then the row is `sent` with `sent_at` set.
  - Given the emergency halt is engaged, When any send is attempted, Then the row is saved `failed` with the halt message and nothing is posted to Node.
  - Given `wallet_billing_on_delivery=0`, an active plan over its monthly cap and an empty wallet, When a reply is sent, Then the API returns 402 `out_of_credits` and the message is `failed`.
  - Given `wallet_billing_on_delivery=1`, When the same workspace sends over its cap, Then the send is not blocked.
- **Source refs:** app/Http/Controllers/ChatController.php (applyDispatchResult, sendMessage, sendTemplate, messageForward, createConversation); app/Services/WhatsAppDispatcher.php (dispatch, resolveProvider, guardMonthlyMessagesLimit); app/Services/OverflowBilling.php; app/Exceptions/PlanLimitReachedException.php.
- **Port notes:** Model as `outbound` pipeline: (1) persist `queued`, (2) policy checks (halt flag, guardrails, plan/wallet reservation per WD-BSP/WD-WALLET — hard block, not overflow), (3) provider adapter send, (4) status transitions. Store the provider message id in a `provider_message_id` column with a unique index per channel; never lose it.

### WD-CHAT-013 — Conversation status roll-up (sent / partial / failed / scheduled / pending)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-CHAT-003
- **Summary:** The status pill of a queue is derived from the _latest message per recipient_, so it reflects how the last send to each contact went and heals when a failed send is retried successfully.
- **Actors & access:** Automatic; visible to manager+.
- **UX & screens:** Pill text = the category (`archived` or the status). Docs pill table: scheduled = every message queued and none sent/failed; sent = at least one sent/delivered/read; partial = a mix of failed and delivered; failed = every outbound failed; pending = saved not dispatched.
- **Endpoints:** Computed inside every send endpoint and `GET /chat/api/conversations/{id}`.
- **Data:** Reads outbound `messages` (id, to_number, status; soft-deleted excluded) of the conversation, writes `conversations.status`.
- **Rules & edge cases:**
  1. Take outbound rows newest first; keep only the first row per recipient key (digits of `to_number`; rows without a number share one `__unknown__` bucket).
  2. "Delivered" = any kept status in `sent`, `delivered`, `read`.
  3. Result, first match wins: (a) has `scheduled` and no delivered and no failed → `scheduled`; (b) all kept statuses are `failed` → `failed`; (c) has `failed` and delivered → `partial`; (d) delivered → `sent`; (e) otherwise the current stored status, else `pending`.
  4. Also updated on the same write: `preview` (body, or `[media_type]`), `last_message_at` (message `sent_at`, else `created_at`, else now).
  5. Applied after create, reply, template, forward and on thread open; NOT applied by retry, resend or send-now, which write the status directly (WD-CHAT-018 to 020), and not after receipts (a `delivered`/`read` receipt cannot change the result).
  6. Deleting the newest message of a recipient changes the outcome on the next roll-up.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given recipients A (latest `sent`) and B (latest `failed`), When rolled up, Then the queue is `partial`.
  - Given a failed message to A followed later by a successful resend to A, When rolled up, Then only the newer row counts and the queue is `sent`.
  - Given every recipient's newest row is `failed`, When rolled up, Then the queue is `failed`.
  - Given one `scheduled` row only, When rolled up, Then the queue is `scheduled`; add a `sent` row for another recipient and it becomes `sent`.
- **Source refs:** app/Http/Controllers/ChatController.php (rollupConversationStatus, refreshConversationAfterSend); Documentation/pages/messaging/chat.html.
- **Port notes:** Compute the summary in SQL (`DISTINCT ON (contact)`) or maintain incrementally on message status events; add `partial` to the status enum and the filter set.

### WD-CHAT-014 — Delivery and read receipts for chat sends (Node callback, forward-only status)

- **Status:** partial
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-CHAT-012, WD-NODE, WD-WALLET
- **Summary:** The Node/Baileys bridge posts a receipt when WhatsApp reports a message delivered or read. Laravel advances the message's status (never backwards), mirrors it onto the team-inbox copy and triggers delivery-time billing exactly once per WhatsApp message id.
- **Actors & access:** Machine-to-machine: header `X-Node-Token` must equal the configured node token (`node_token()`); an empty configured token rejects everything. No user session, no CSRF (route is in `routes/api.php`, prefix `/api`).
- **UX & screens:** Effect is visible as ticks changing in the thread (sent → delivered → read) and in the queue-details stats (Sent ≥ Delivered ≥ Read funnel counts).
- **Endpoints:**

  | Method + URI                    | Route name                 | Controller@action                      | Middleware                        | Request                                                                                                                 | Response                                                              |
  | ------------------------------- | -------------------------- | -------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
  | `POST /api/chat/message-status` | `chat.node.message-status` | `ChatController@nodeChatMessageStatus` | `api` (token header check inside) | `whatsapp_message_id` (required ≤191), `status` (required: delivered\|read), `delivered_at`, `read_at` (nullable dates) | `200 {ok:true, updated:n}`; `403 {ok:false,message:"forbidden"}`; 422 |

- **Data:** Updates `messages` (rows with `direction='out'` and `meta->wa_message_id` equal to the id) and mirrors to `inbox_messages` with the same rule: `status`, `delivered_at`, `read_at`. Rank: pending/scheduled 0 < sent 1 < delivered 2 < read 3; an update is skipped unless the new rank is strictly higher. A `read` with no `delivered_at` back-fills `delivered_at` with the read time (or now). Date strings that fail to parse fall back to now.
- **Rules & edge cases:**
  1. Billing: when at least one `messages` row was updated, the first matching outbound row's workspace is billed through `MessageBillingService::settleDelivered(workspace, wamid, recipient, null, 'baileys', 'chat')`, idempotent per wamid (WD-WALLET); failures are logged and never fail the receipt. Flow/auto-reply sends carry synthetic ids and bill elsewhere.
  2. Node side: Baileys status 3 → `delivered`, 4 → `read`, 5 (PLAYED) → `read`; statuses 1/2 are ignored. A receipt whose message id belongs to a running broadcast goes to `/api/update-message-status` instead (broadcasts); every other id goes here.
  3. WABA and Twilio receipts do not use this endpoint (their own webhooks match `meta->wa_message_id` / SID; WD-WABA).
  4. QUIRK: `ChatController` never writes `meta.wa_message_id` on the rows it creates (WD-CHAT-012), so for rows created by `/chat` the lookup finds nothing (`updated=0`) unless some other writer stamps the id. Rows written by the mobile quick-message API do stamp it. As built, chat sends likely stay at `sent` on the web screen; the documented "Delivered/Read" progress needs the id to be persisted (open question).
  5. The receipt endpoint has no rate limit and no signature; the shared secret is the only protection.
- **Async & events:** Inbound HTTP from Node; wallet ledger via WD-WALLET.
- **External systems:** Node bridge (`BaileysClientManager` status handler) → Laravel `APP_URL/api/chat/message-status` with `X-Node-Token`.
- **Settings:** Node token (admin/.env `NODE_WEBHOOK_TOKEN`); `wallet_billing_on_delivery`.
- **Acceptance criteria:**
  - Given an outbound row with `meta.wa_message_id=X` and status `sent`, When `{whatsapp_message_id:X, status:'read'}` is posted with a valid token, Then status becomes `read`, `read_at` is set and `delivered_at` is back-filled.
  - Given a row already `read`, When a late `delivered` receipt arrives, Then nothing changes and `updated=0`.
  - Given a wrong or missing token, When posted, Then the response is 403.
  - Given a matched row, When the receipt is processed twice, Then the wallet is charged once.
- **Source refs:** app/Http/Controllers/ChatController.php (nodeChatMessageStatus); routes/api.php; node/classes/BaileysClientManager.js (message status handler); app/Services/MessageBillingService.php (WALLET).
- **Port notes:** Provider webhooks → verified inbound webhook handler → BullMQ job → `message_events` insert + monotonic `messages.status` update (see docs/architecture/messaging.md). Match by `(channel_id, provider_message_id)` unique index. Charge via the wallet ledger keyed by provider message id (idempotency key).

### WD-CHAT-015 — Near-real-time refresh by polling with transition toasts

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CHAT-002, WD-CHAT-003
- **Summary:** The Quick Send screen has no websocket: it re-fetches the queue list and the open thread every 5 seconds and tells the operator when a queue or message changes state.
- **Actors & access:** Manager+ in an open browser tab.
- **UX & screens:** Poll tick every 5 s (`POLL_MS`) while the tab is visible; skipped when hidden; on `visibilitychange` to visible an immediate tick runs and the timer restarts; a window `focus` event also triggers an immediate tick. Each tick: (1) fetch the list with current filter/sort/search/device, re-render and toast queue-level transitions — `✓ "{title}" — sent`, `⚠ "{title}" — failed`, `⚠ "{title}" — partial`; (2) if a thread is open fetch it, toast message-level transitions — pending→sent "✓ Message sent", to delivered "✓✓ Delivered", to read "✓✓ Read", to failed "⚠ Send failed" — and "💬 n new message(s)" when inbound rows appear, and re-render the thread only when something changed or the count differs. Poll errors are swallowed silently (no toast when Laravel is briefly down).
- **Endpoints:** The two GET endpoints of WD-CHAT-002 and WD-CHAT-003.
- **Data:** Same as those endpoints.
- **Rules & edge cases:**
  1. Every tick also runs the counts queries, the roll-up write (WD-CHAT-013) and per-message storage stat calls (WD-CHAT-003); load scales with open tabs × messages.
  2. The queue list is capped at 200 rows and the thread is unpaginated.
  3. There is no laravel-echo/broadcast event for this screen (Team Inbox has its own events, WD-TIB1).
- **Async & events:** None server-side.
- **External systems:** None.
- **Settings:** None (constant 5000 ms).
- **Acceptance criteria:**
  - Given an open thread whose message flips `sent` → `delivered` server-side, When the next tick runs, Then the tick icon updates and "✓✓ Delivered" is toasted.
  - Given the tab is hidden, When 30 seconds pass, Then no request is made; on returning to the tab a fetch fires immediately.
  - Given a backgrounded queue that becomes `failed`, When the tick runs, Then a "failed" toast names the queue.
- **Source refs:** resources/js/charts/user-chat-index.js (pollTick, startPolling, visibilitychange handler).
- **Port notes:** Replace with the platform's realtime channel (websocket/SSE fan-out from message status events) and keep 5 s polling only as a fallback; toasts should key off event types.

### WD-CHAT-016 — Archive and unarchive a queue

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CHAT-002
- **Summary:** Moves a queue out of the day-to-day list into the Archived filter and back, without deleting anything.
- **Actors & access:** Manager+.
- **UX & screens:** Thread header archive button (title "Archive"/"Unarchive"), queue gear menu items "Archive"/"Unarchive"; toasts "Archived"/"Unarchived"; counts refresh from the response `meta`.
- **Endpoints:**

  | Method + URI                                  | Route name                | Controller@action          | Middleware | Request | Response                        |
  | --------------------------------------------- | ------------------------- | -------------------------- | ---------- | ------- | ------------------------------- |
  | `POST /chat/api/conversations/{id}/archive`   | `user.chat.api.archive`   | `ChatController@archive`   | manager+   | –       | `200 {data:conversation, meta}` |
  | `POST /chat/api/conversations/{id}/unarchive` | `user.chat.api.unarchive` | `ChatController@unarchive` | manager+   | –       | `200 {data:conversation, meta}` |

- **Data:** `conversations.archived` (bool).
- **Rules & edge cases:**
  1. Idempotent flag set; no messages, no Node call, no audit row.
  2. QUIRK/cross-domain: `conversations.archived` is the same flag the Team Inbox uses for its own Archived section, so archiving here hides the thread in the team inbox too.
  3. Archived rows keep their underlying status pill in the list (WD-CHAT-002).
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given an active queue, When archived, Then it leaves All and appears under Archived with its status pill and `counts.archived` increments.
  - Given an archived queue, When unarchived, Then it returns to All.
  - Given another workspace's id, When archived, Then 404.
- **Source refs:** app/Http/Controllers/ChatController.php (archive, unarchive); resources/js/charts/user-chat-index.js (toggleArchive, buildMenuItems).
- **Port notes:** Use `conversations.archived_at` and keep one meaning across Quick Send and Inbox, or make archive per-view.

### WD-CHAT-017 — Delete a queue (hard delete with cascade)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CHAT-002
- **Summary:** Permanently deletes a conversation and, through database cascades, all of its messages.
- **Actors & access:** Manager+ (no extra confirmation server-side).
- **UX & screens:** Gear menu "Delete" (danger) opens the confirm dialog "Delete queue" / `Delete "{title}"?` / "All {n} recipients and the message history for this queue will be removed. This can't be undone." with "Delete queue"; on success the list reloads and the toast reads "Queue deleted".
- **Endpoints:**

  | Method + URI                          | Route name              | Controller@action        | Middleware | Request | Response                |
  | ------------------------------------- | ----------------------- | ------------------------ | ---------- | ------- | ----------------------- |
  | `DELETE /chat/api/conversations/{id}` | `user.chat.api.destroy` | `ChatController@destroy` | manager+   | –       | `200 {data:{id}, meta}` |

- **Data:** Deletes the `conversations` row (no soft delete). FK cascades delete `messages` and `inbox_messages`; `wa_form_submissions`, `chatbot_widget_visitors`, `ai_call_logs` get `conversation_id` set NULL; `conversation_notes`, `conversation_events`, `conversation_participants` and `conversation_tag` rows have no FK and are left orphaned.
- **Rules & edge cases:**
  1. QUIRK: because Quick Send shares one conversation per number with the Team Inbox, deleting a queue here erases that number's whole inbox history (customer messages, replies, AI replies), not just the Quick Send sends.
  2. Nothing is sent to WhatsApp; no audit entry, no notification.
  3. Already-scheduled Node jobs for its messages are not cancelled (WD-CHAT-006).
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a queue with 10 messages, When deleted, Then the conversation and its messages no longer exist and counts drop.
  - Given another workspace's id, When deleted, Then 404 and nothing is removed.
  - Given a thread that also has team-inbox history, When deleted, Then that history is gone too (reference behavior; see port notes).
- **Source refs:** app/Http/Controllers/ChatController.php (destroy); database schema FKs on `conversations`; resources/js/charts/user-chat-index.js (confirmDelete).
- **Port notes:** Prefer soft-delete (`deleted_at`) with a retention purge job; deleting from Quick Send should hide Quick Send sends or require the `inbox.delete` permission, and must write an audit log row. Never cascade away an inbox thread from a send screen.

### WD-CHAT-018 — Retry failed messages (status flip only)

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CHAT-012
- **Summary:** The queue gear menu shows "Retry send" on `failed` queues. The docs promise it re-attempts every failed message; the code only marks them sent.
- **Actors & access:** Manager+.
- **UX & screens:** Menu item visible only when the queue status is `failed`; toast "Retry queued".
- **Endpoints:**

  | Method + URI                              | Route name            | Controller@action      | Middleware | Request | Response                          |
  | ----------------------------------------- | --------------------- | ---------------------- | ---------- | ------- | --------------------------------- |
  | `POST /chat/api/conversations/{id}/retry` | `user.chat.api.retry` | `ChatController@retry` | manager+   | –       | `200 {data:{conversation}, meta}` |

- **Data:** Updates every `messages` row of the conversation with `status='failed'` to `sent`, `sent_at=now`, `failure_reason=null`; sets `conversations.status` to `failed` if any failed row remains (none can) else `sent`, and `last_message_at=now`.
- **Rules & edge cases:**
  1. QUIRK: no dispatcher call is made — the code comment says it "simulates" success. Messages that never left the platform become `sent`.
  2. Failure reasons are erased, so the evidence of what failed is lost.
  3. It touches every failed outbound row of the conversation, however old, in one query (soft-deleted rows are excluded by the model scope).
- **Async & events:** None.
- **External systems:** None (should be the provider).
- **Settings:** None.
- **Acceptance criteria:**
  - Given a failed queue, When Retry is chosen, Then (target behavior) each failed message is re-dispatched and only rows that the provider accepts become `sent`; the reference simply flips them.
  - Given a queue with no failed rows, When retry is called, Then nothing changes.
- **Source refs:** app/Http/Controllers/ChatController.php (retry); resources/js/charts/user-chat-index.js (buildMenuItems, runQueueAction); Documentation/pages/messaging/chat.html.
- **Port notes:** Implement as a real re-enqueue of failed messages (new attempt row in `message_events`, idempotent provider send, keep failure history). Do not port the simulated success.

### WD-CHAT-019 — Send again (duplicate the latest outbound message)

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CHAT-012
- **Summary:** "Send again" on a `sent` queue duplicates the latest outbound message; the docs say it is sent again, but the code only inserts a new row marked sent.
- **Actors & access:** Manager+.
- **UX & screens:** Menu item visible only when the queue status is `sent`; toast "Sent again".
- **Endpoints:**

  | Method + URI                               | Route name             | Controller@action       | Middleware | Request | Response                                                                        |
  | ------------------------------------------ | ---------------------- | ----------------------- | ---------- | ------- | ------------------------------------------------------------------------------- |
  | `POST /chat/api/conversations/{id}/resend` | `user.chat.api.resend` | `ChatController@resend` | manager+   | –       | `200 {data:{conversation, message}, meta}`; `422 {message:"Nothing to resend"}` |

- **Data:** Replicates the newest outbound `messages` row (excluding `sent_at`, `delivered_at`, `read_at`, `scheduled_at`, `failure_reason`), sets `status='sent'`, `sent_at=now`; updates `conversations.status='sent'`, `preview` (latest body, else old preview), `last_message_at`.
- **Rules & edge cases:**
  1. QUIRK: never dispatched; the replicated row copies `meta` (including any stored `wa_message_id`), which can make the Message→inbox mirror skip it as a duplicate.
  2. The observer may still mirror the copy into `inbox_messages` (WD-CHAT-035).
  3. No quota/billing runs because the dispatcher is never called.
- **Async & events:** Message observer only.
- **External systems:** None (should be the provider).
- **Settings:** None.
- **Acceptance criteria:**
  - Given a sent queue, When "Send again" is chosen, Then (target) a new message with the same content is dispatched and appears as a new bubble; reference behavior only inserts the bubble.
  - Given a queue with no outbound message, When called, Then 422 "Nothing to resend".
- **Source refs:** app/Http/Controllers/ChatController.php (resend); resources/js/charts/user-chat-index.js.
- **Port notes:** Implement as "create a new outbound message from an existing one" through the standard send pipeline; do not replicate provider ids.

### WD-CHAT-020 — Send now for a scheduled queue (status flip only)

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CHAT-006
- **Summary:** On a `scheduled` queue the gear menu offers "Send now", intended to fire scheduled messages immediately. The code only rewrites their status.
- **Actors & access:** Manager+.
- **UX & screens:** Menu item visible when queue status is `scheduled`; toast "Sending now".
- **Endpoints:**

  | Method + URI                                 | Route name               | Controller@action        | Middleware | Request | Response                          |
  | -------------------------------------------- | ------------------------ | ------------------------ | ---------- | ------- | --------------------------------- |
  | `POST /chat/api/conversations/{id}/send-now` | `user.chat.api.send-now` | `ChatController@sendNow` | manager+   | –       | `200 {data:{conversation}, meta}` |

- **Data:** All `messages` of the conversation with `status='scheduled'` → `sent`, `sent_at=now`, `scheduled_at=null`; conversation → `status='sent'`, `scheduled_at=null`, `last_message_at=now`.
- **Rules & edge cases:**
  1. QUIRK: no dispatch happens and the Node schedule created at scheduling time is not cancelled, so the message may be sent later anyway (duplicate) or never (if the Node job was lost) while the UI already says sent.
  2. This is the only code path that moves a scheduled chat message out of `scheduled` (WD-CHAT-006 rule 5).
- **Async & events:** None.
- **External systems:** None (should cancel the Node schedule and dispatch).
- **Settings:** None.
- **Acceptance criteria:**
  - Given a scheduled queue, When "Send now" is chosen, Then (target) the delayed job is cancelled, the message is dispatched immediately and the status follows the real outcome.
  - Given no scheduled rows, When called, Then the queue is unchanged apart from `last_message_at`.
- **Source refs:** app/Http/Controllers/ChatController.php (sendNow); resources/js/charts/user-chat-index.js.
- **Port notes:** Promote the BullMQ delayed job (remove + enqueue immediate) inside one transaction.

### WD-CHAT-021 — Queue details drawer (overview, recipients, messages, files, stats)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CHAT-003
- **Summary:** "Show details" (queue gear or More menu) slides a right-hand drawer that summarizes a queue: KPI cards, an overview, the per-recipient roll-up, the full message log and the attachments.
- **Actors & access:** Manager+.
- **UX & screens:** Drawer "Queue details" with title, subtitle "{n} recipients · {status}", a six-card stats strip (Total, Recipients, Sent, Delivered, Failed, Scheduled), and tabs Overview / Recipients (count) / Messages (count) / Files (count). Overview rows: Status (pill, "· archived"), Platform (`W`/`WB`/`T`), Recipients, Total messages, Last activity (locale date-time), Preview. Recipients table: Number, Last status (+ failure reason in red), Last sent, Msgs. Messages table: When, Dir (↑/↓), Body (2-line clamp, `[media_type]` when empty), Status. Files: grid of thumbnails/cards linking to the file with name, type and size. Empty texts: "No outgoing messages have been sent yet for this queue.", "No messages logged.", "No attachments in this queue yet.". Load error: "Failed to load details: …". Esc, backdrop and the X close it.
- **Endpoints:**

  | Method + URI                               | Route name              | Controller@action        | Middleware | Request | Response                                                              |
  | ------------------------------------------ | ----------------------- | ------------------------ | ---------- | ------- | --------------------------------------------------------------------- |
  | `GET /chat/api/conversations/{id}/details` | `user.chat.api.details` | `ChatController@details` | manager+   | –       | `200 {data:{conversation, messages, recipients, attachments, stats}}` |

- **Data:** `recipients` = outbound rows with a `to_number` grouped in PHP by decrypted number: `{to_number, last_status, last_at (ISO), last_at_lbl ("M d, H:i"), message_count, failure_reason}` of the newest row. `attachments` = rows with `media_path`: `{id, body, media_url, media_type, media_name, media_size, media_mime, time}`. `stats` = funnel-cumulative counts over outbound rows: `pending`, `scheduled`, `failed`, `sent` = sent+delivered+read, `delivered` = delivered+read, `read`, plus `total_messages` (all rows incl. inbound) and `recipients_count` (distinct numbers), so Sent ≥ Delivered ≥ Read.
- **Rules & edge cases:**
  1. Grouping happens in PHP because `to_number` is encrypted (no SQL `GROUP BY`).
  2. Soft-deleted messages are excluded.
  3. `Platform` shows the legacy platform code, not the provider name.
- **Async & events:** None.
- **External systems:** Media disk (size/mime).
- **Settings:** None.
- **Acceptance criteria:**
  - Given a queue with 3 sent, 1 delivered, 1 read and 1 failed outbound messages, When details load, Then Sent=5, Delivered=2, Read=1, Failed=1.
  - Given two messages to the same number, When the recipients tab renders, Then one row shows Msgs=2 with the newest status.
  - Given a failed recipient, When shown, Then its failure reason appears under the status.
- **Source refs:** app/Http/Controllers/ChatController.php (details); resources/js/charts/user-chat-index.js (openDetailsModal, renderDetails*); resources/views/user/chat/index.blade.php (details-drawer).
- **Port notes:** Serve aggregates with SQL over `messages` (`GROUP BY contact_id`) and paginate the message and file tabs; show the provider/channel name instead of the legacy code.

### WD-CHAT-022 — Message info panel

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CHAT-003
- **Summary:** "Message info" in the bubble menu opens a modal with the message's identifiers, status, numbers, lifecycle timestamps and any failure reason.
- **Actors & access:** Manager+; the message must belong to a conversation of the current workspace (else 404).
- **UX & screens:** Modal "Message info" with rows ID (`#id`), Direction, Status, From, To, Created, Scheduled for (only when set), Sent at, Delivered at, Read at, Reaction (only when set), Attachment ("name (type)"), Failure (tinted red). Timestamps use the browser locale; missing ones show "—". Esc, the X and a backdrop click close it. Load error toast "Info load failed: …" (warn).
- **Endpoints:**

  | Method + URI                                        | Route name               | Controller@action            | Middleware | Request          | Response                                                                                                                                                                   |
  | --------------------------------------------------- | ------------------------ | ---------------------------- | ---------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `GET /chat/api/conversations/{c}/messages/{m}/info` | `user.chat.api.msg.info` | `ChatController@messageInfo` | manager+   | numeric `c`, `m` | `200 {data:{id,direction,status,from_number,to_number,created_at,scheduled_at,sent_at,delivered_at,read_at,failure_reason,pinned,starred,reaction,media_type,media_name}}` |

- **Data:** Reads one `messages` row (decrypting numbers and failure reason).
- **Rules & edge cases:**
  1. Ownership is enforced through the conversation (`forCurrentWorkspace`) then `conversation_id` match, so a message id from another conversation 404s.
  2. The docs describe a "status timeline"; the UI shows a flat list of timestamps.
  3. From/To are shown unmasked to every manager+.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a delivered message, When Message info opens, Then Sent at and Delivered at are filled and Read at shows "—".
  - Given a failed message, When opened, Then the failure reason row is shown.
  - Given a message id from a different conversation, When requested, Then 404.
- **Source refs:** app/Http/Controllers/ChatController.php (messageInfo, findOwnedMessage); resources/js/charts/user-chat-index.js (openMessageInfo).
- **Port notes:** Read from `messages` + `message_events` so the modal can show the true timeline including late/out-of-order receipts.

### WD-CHAT-023 — React to a message with an emoji

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CHAT-003
- **Summary:** The bubble menu offers six quick reactions and a clear button. The reaction is stored on the message and pushed to the recipient's WhatsApp on the Unofficial API.
- **Actors & access:** Manager+.
- **UX & screens:** Popover top row: 👍 ❤️ 😂 😮 😢 🙏 and an X ("Clear reaction"). The chosen emoji appears as a chip on the bubble. Toasts "Reacted with {emoji}" / "Reaction cleared" (success), "React failed: …" (warn).
- **Endpoints:**

  | Method + URI                                          | Route name                | Controller@action             | Middleware | Request                                                   | Response                    |
  | ----------------------------------------------------- | ------------------------- | ----------------------------- | ---------- | --------------------------------------------------------- | --------------------------- |
  | `POST /chat/api/conversations/{c}/messages/{m}/react` | `user.chat.api.msg.react` | `ChatController@messageReact` | manager+   | JSON `emoji` (nullable string, max 8 chars; empty clears) | `200 {data:{id, reaction}}` |

- **Data:** `messages.reaction` (varchar 16, nullable). One reaction per message (the operator's own); inbound reactions are handled elsewhere.
- **Rules & edge cases:**
  1. The DB write happens first; then `WhatsAppDispatcher::reaction` is called best-effort inside try/catch and its result is ignored (the local record stays correct if Node is down).
  2. The push happens only when the resolved provider is Baileys; WABA and Twilio return a local-only no-op. It needs a sender phone (workspace primary config, else the message's own outbound number, else the conversation's device, else any connected device) and the Node server URL, else `ok=false`.
  3. Node call: `POST {server}/api/send-reaction/<sender phone>` (10 s timeout) with target phone, optional `targetJid`, `targetMessageId` (= `meta.wa_message_id`), `fromMe`, `emoji`.
  4. QUIRK: rows created by `/chat` carry no `wa_message_id` (WD-CHAT-012), so `targetMessageId` is null; the bridge then defaults to "the most recent fromMe message", which can put the reaction on the wrong WhatsApp message.
- **Async & events:** Fire-and-forget HTTP to Node.
- **External systems:** Node bridge `/api/send-reaction`.
- **Settings:** Node server URL (`baileys_server_url` / `SERVER_URL`).
- **Acceptance criteria:**
  - Given a message, When 👍 is chosen, Then `reaction='👍'` is stored and the chip renders.
  - Given a message with a reaction, When the clear button is used, Then the reaction is null.
  - Given Node is unreachable, When reacting, Then the API still returns 200 with the stored reaction.
- **Source refs:** app/Http/Controllers/ChatController.php (messageReact); app/Services/WhatsAppDispatcher.php (reaction); resources/js/charts/user-chat-index.js (handleReact, wireMessageMenu).
- **Port notes:** Add a `message_reactions` table (message, actor, emoji) and a provider adapter capability flag `supportsReactions`; refuse to send a reaction without a provider message id.

### WD-CHAT-024 — Pin / unpin a message

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CHAT-003
- **Summary:** Toggles a pin marker on a message; on the Unofficial API it also asks WhatsApp to pin the message for the recipient for seven days.
- **Actors & access:** Manager+.
- **UX & screens:** Menu item "Pin"/"Unpin"; toast "📌 Pinned"/"Unpinned"; a small pin icon in the bubble footer. There is no pinned-messages list or banner.
- **Endpoints:**

  | Method + URI                                         | Route name              | Controller@action                 | Middleware | Request | Response                  |
  | ---------------------------------------------------- | ----------------------- | --------------------------------- | ---------- | ------- | ------------------------- |
  | `PATCH /chat/api/conversations/{c}/messages/{m}/pin` | `user.chat.api.msg.pin` | `ChatController@messageTogglePin` | manager+   | –       | `200 {data:{id, pinned}}` |

- **Data:** `messages.pinned` (bool).
- **Rules & edge cases:**
  1. The flag is inverted server-side (no explicit state in the request) and saved before the provider call; the provider result is ignored.
  2. Baileys only: `POST /api/pin-message/<sender phone>` with `pin` (bool) and `duration` 604800 s (7 days); requires `meta.wa_message_id` — without it the dispatcher returns an error ("saved before WhatsApp-id tracking was enabled"), which is discarded (WD-CHAT-012 QUIRK), so pins on chat-created messages stay local.
  3. WABA and Twilio: local flag only.
- **Async & events:** Fire-and-forget HTTP to Node.
- **External systems:** Node bridge `/api/pin-message`.
- **Settings:** None.
- **Acceptance criteria:**
  - Given an unpinned message, When Pin is chosen twice, Then `pinned` is true then false and the icon toggles.
  - Given Node is down, When pinning, Then the API still returns 200.
  - Given a message in another workspace, When called, Then 404.
- **Source refs:** app/Http/Controllers/ChatController.php (messageTogglePin); app/Services/WhatsAppDispatcher.php (pin, messageAction); resources/js/charts/user-chat-index.js (togglePin).
- **Port notes:** Model as `messages.pinned_at` plus an adapter capability; expose a pinned-messages drawer if the feature is kept.

### WD-CHAT-025 — Star / unstar a message

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CHAT-003
- **Summary:** Marks a message as starred for the operator; on the Unofficial API it syncs to the operator's WhatsApp starred list without notifying the recipient.
- **Actors & access:** Manager+.
- **UX & screens:** Menu item "Star"/"Unstar"; toast "⭐ Starred"/"Unstarred"; star icon in the bubble footer. No starred-messages view.
- **Endpoints:**

  | Method + URI                                          | Route name               | Controller@action                  | Middleware | Request | Response                   |
  | ----------------------------------------------------- | ------------------------ | ---------------------------------- | ---------- | ------- | -------------------------- |
  | `PATCH /chat/api/conversations/{c}/messages/{m}/star` | `user.chat.api.msg.star` | `ChatController@messageToggleStar` | manager+   | –       | `200 {data:{id, starred}}` |

- **Data:** `messages.starred` (bool).
- **Rules & edge cases:**
  1. Toggle semantics and best-effort push as WD-CHAT-024, via Node `POST /api/star-message/<sender phone>` with `star` (bool) (a WhatsApp chatModify); same missing-`wa_message_id` limitation.
  2. The same route name/shape is reused by the mobile chat API (`PATCH api/app/chats/{c}/messages/{m}/star`, WD-MOB).
- **Async & events:** Fire-and-forget HTTP to Node.
- **External systems:** Node bridge `/api/star-message`.
- **Settings:** None.
- **Acceptance criteria:**
  - Given an unstarred message, When Star is chosen, Then `starred` is true and the star icon shows.
  - Given a starred message, When Unstar is chosen, Then the flag clears.
  - Given Node is down, When starring, Then the API returns 200.
- **Source refs:** app/Http/Controllers/ChatController.php (messageToggleStar); app/Services/WhatsAppDispatcher.php (star); resources/js/charts/user-chat-index.js (toggleStar).
- **Port notes:** Prefer a per-user `message_stars` table (stars are personal); keep the WhatsApp sync as an optional adapter capability.

### WD-CHAT-026 — Delete a message (local soft delete)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CHAT-003
- **Summary:** Removes a message from the queue's history. It is a soft delete in the database only; nothing is deleted on WhatsApp.
- **Actors & access:** Manager+.
- **UX & screens:** Bubble menu "Delete" opens a confirm ("Delete message?" / "This removes it from your queue history. The recipient may already have it."); on success the bubble disappears and the toast reads "Deleted"; failure toast "Delete failed: …".
- **Endpoints:**

  | Method + URI                                      | Route name                 | Controller@action              | Middleware | Request | Response                        |
  | ------------------------------------------------- | -------------------------- | ------------------------------ | ---------- | ------- | ------------------------------- |
  | `DELETE /chat/api/conversations/{c}/messages/{m}` | `user.chat.api.msg.delete` | `ChatController@messageDelete` | manager+   | –       | `200 {data:{id, deleted:true}}` |

- **Data:** Sets `messages.deleted_at` (SoftDeletes). Soft-deleted rows are excluded from thread reads, details, roll-ups, search-numbers and the message-history stream (Eloquent scope) but remain in the table for audit.
- **Rules & edge cases:**
  1. No provider call ("delete for everyone" is not implemented).
  2. The queue preview and `last_message_at` are not recomputed; the status roll-up changes only on the next roll-up.
  3. The team-inbox mirror copy in `inbox_messages` is a separate row and is not deleted.
  4. The whole-conversation delete (WD-CHAT-017) hard-deletes including trashed rows via FK cascade.
- **Async & events:** None; no audit-log row.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a message, When deleted, Then it no longer appears in the thread or details and `deleted_at` is set.
  - Given the deleted message was a recipient's newest failure, When the thread is next opened, Then the queue status is recomputed without it.
  - Given a foreign message id, When deleted, Then 404.
- **Source refs:** app/Http/Controllers/ChatController.php (messageDelete); app/Models/Message.php (SoftDeletes); resources/js/charts/user-chat-index.js (deleteMessage).
- **Port notes:** Keep `deleted_at` and write an audit row (the reference writes none); decide explicitly whether deleting hides the inbox copy.

### WD-CHAT-027 — Forward a message to another queue

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CHAT-012, WD-CHAT-003
- **Summary:** Copies a message's text, media and coordinates into another queue of the workspace and sends it to that queue's recipient immediately.
- **Actors & access:** Manager+.
- **UX & screens:** Bubble menu "Forward" opens a modal "Forward to…" listing up to 50 of the currently loaded queues (excluding the open one and any with zero recipients) with initials, title and "{n} recipient(s)"; picking one closes the modal and shows "Forwarded ✓"; failure toast "Forward failed: …"; when no candidates exist the toast is "No other queue to forward to".
- **Endpoints:**

  | Method + URI                                            | Route name                  | Controller@action               | Middleware | Request                                          | Response                                                                                                                 |
  | ------------------------------------------------------- | --------------------------- | ------------------------------- | ---------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
  | `POST /chat/api/conversations/{c}/messages/{m}/forward` | `user.chat.api.msg.forward` | `ChatController@messageForward` | manager+   | JSON `target_conversation_id` (required integer) | `200 {data:{forwarded_to, message, dispatch}}`; `402 {message}`; `422 {message:"Target conversation has no recipient."}` |

- **Data:** Creates a `messages` row in the target: `direction='out'`, `body`, `media_path`, `media_type`, `latitude`, `longitude` copied from the source; `status='pending'` then dispatched; sender from the target's pinned channel (WD-CHAT-007 rule 2).
- **Rules & edge cases:**
  1. Source and target must both be conversations of the workspace (`forCurrentWorkspace`), else 404; the server does not require the target to be in the client's loaded list.
  2. The recipient is the target's latest outbound `to_number` only (no inbound/`raw_jid` fallback, unlike replies); none → 422.
  3. Template metadata (header, footer, buttons, template id) is not copied, so forwarding a template forwards only its resolved body/media.
  4. Platform hint = target's `platform` (default `W`). Plan/wallet failures → 402 "Out of credits." (or the exception message) after marking the copy failed; target roll-up refreshed either way.
  5. QUIRK: the UI toasts "Forwarded ✓" without checking `dispatch.ok`; a provider failure leaves a failed bubble in the target and a success toast.
  6. No "forwarded" flag is set on the copy and it is not scheduled.
- **Async & events:** Synchronous send; observer mirror to `inbox_messages`.
- **External systems:** Node bridge / providers as WD-CHAT-007.
- **Settings:** As WD-CHAT-012.
- **Acceptance criteria:**
  - Given a text message in queue A, When forwarded to queue B, Then a new outbound row with the same body exists in B, is dispatched to B's recipient and B's preview updates.
  - Given a target with no outbound history, When forwarding, Then 422 "Target conversation has no recipient.".
  - Given a media message, When forwarded, Then the same stored file is reused (no re-upload) and sent as media.
  - Given a target in another workspace, When forwarding, Then 404.
- **Source refs:** app/Http/Controllers/ChatController.php (messageForward); resources/js/charts/user-chat-index.js (openForwardPicker).
- **Port notes:** Add `forwarded_from_message_id` on the copy; resolve the recipient from the target conversation's contact, not from the last row; reuse the same send pipeline (idempotency key per forward action).

### WD-CHAT-028 — "Reply" to a specific message (client-side indicator only)

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CHAT-007
- **Summary:** The bubble menu has a Reply action that shows a "Replying to …" bar above the composer, but the reply target is never sent, so it has no effect on the message.
- **Actors & access:** Manager+.
- **UX & screens:** Bar text "Replying to your message" (outbound) or "Replying to them" (inbound) with a 200-char snippet (or `[media_type]`) and a cancel X; focus moves to the composer.
- **Endpoints:** None.
- **Data:** None (kept in a JS variable `pendingReplyTo`).
- **Rules & edge cases:**
  1. QUIRK: `sendMessage()` never reads `pendingReplyTo`; the composer posts only body/media/schedule, the server has no quoted-message field, and the indicator is not cleared after sending.
  2. Not persisted across queue switches or reloads.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a message, When Reply is chosen, Then the indicator appears and the composer is focused.
  - Given the indicator is shown, When the X is pressed, Then it disappears.
  - Given a reply is sent, Then (target behavior) the outgoing WhatsApp message quotes the chosen message; the reference does not.
- **Source refs:** resources/js/charts/user-chat-index.js (startReplyTo, showReplyIndicator, clearReplyTo).
- **Port notes:** Implement as `messages.reply_to_message_id` plus provider quoted-message support (`context.message_id` on Cloud API); otherwise drop the menu item.

### WD-CHAT-029 — AI assist drawer (summarize, suggest reply, rewrite, translate, extract, tone)

- **Status:** partial
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-CHAT-003, WD-AIADM, WD-AIAG
- **Summary:** An AI button in the thread header opens a side drawer whose tools work on the last 30 messages of the thread. The backend works; the front-end guard makes the drawer unreachable in the shipped build.
- **Actors & access:** Manager+. The model call goes through `AiAgentService::callProvider`, which resolves the workspace's own key (BYOK, only if the plan allows it), then the active admin key for that provider (no `.env` fallback), and applies the admin's per-request output-token ceiling (see WD-AIADM).
- **UX & screens:** Drawer "AI assist / Conversation tools" with thread name, a tool list (Summarize, Suggest reply, Rewrite tone, Translate, Extract info, Tone analysis), a model select grouped by provider (options from `AdminAiKeyController::MODELS`), an optional text input for Rewrite ("Target tone (e.g. friendly, formal, brief)", placeholder friendly) and Translate ("Target language (e.g. Hindi, French)", placeholder English), buttons Run, Copy, "Use as reply" (pastes the output into the composer, closes the drawer, toast "Reply pasted into composer / edit and send when ready"), status "Thinking..." / "{n} messages used" / "Error", footer notes "AI is suggestion-only. Review before sending." and "Last 30 messages used as context". Esc, backdrop and X close it.
- **Endpoints:**

  | Method + URI                           | Route name         | Controller@action         | Middleware | Request                                                                                         | Response                                            |
  | -------------------------------------- | ------------------ | ------------------------- | ---------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------- |
  | `POST /chat/api/conversations/{id}/ai` | `user.chat.api.ai` | `ChatController@aiAssist` | manager+   | JSON `tool` (default summary), `input` (string), `model` (default `gpt-4o-mini`); no validation | `200 {ok:true, tool, model, output, message_count}` |

- **Data:** Reads the last 30 messages of the conversation (newest 30, re-ordered oldest first); transcript lines `CUSTOMER: …` (inbound) / `AGENT: …` (outbound). Nothing is stored.
- **Rules & edge cases:**
  1. Tool prompts: `summary` = 4-6 bullets (intent, key facts, blockers, next step); `suggest` = one short friendly 2-3 sentence reply in the customer's language; `rewrite` = the last message rewritten in the tone `input`; `translate` = the last inbound message into `input` (default English); `extract` = JSON `{name, phone, email, intent, products_mentioned, dates, order_id}`; `tone` = JSON `{sentiment, urgency, frustration_score 0-10, summary}`; any other tool falls back to a summary prompt.
  2. Provider is chosen from the model prefix (`gpt-` → OpenAI, `claude-` → Anthropic, `gemini-` → Gemini); unknown prefix → a canned "[demo response — unknown model prefix]" answer. QUIRK: the drawer's model list comes from the admin model catalogue, which also contains Mistral, ElevenLabs, Deepgram, OpenRouter and Perplexity models; picking any of those always yields the unknown-prefix demo answer. Call settings: system prompt "You are a helpful assistant.", max tokens 1024, temperature 0.4.
  3. Any provider error, missing key or empty output is swallowed and replaced with a canned "[demo response — no AI key configured]" text, so the endpoint always returns `ok:true`; the plan gate and real errors are therefore invisible to the operator.
  4. QUIRK: the drawer opens only when `state.activeId` is truthy but `state` is the bootstrap object and never gets that property, so the button always toasts "Pick a thread first to use AI assist."; `runAi` also reads a non-existent `state.csrf`. The feature is dead in the UI as shipped, though docs advertise it.
  5. Body text of the last 30 messages, including customer PII, is sent to the third-party provider without redaction.
- **Async & events:** Synchronous provider call; no usage logging in this controller (usage accounting belongs to `AiAgentService`).
- **External systems:** OpenAI, Anthropic, Google Gemini (keys: workspace BYOK or admin `AdminAiKey`).
- **Settings:** Workspace/admin AI keys; AI plan features; model list constant.
- **Acceptance criteria:**
  - Given a thread and a configured key, When "Summarize" is run, Then the response contains a 4-6 bullet summary and `message_count` ≤ 30.
  - Given no key, When any tool runs, Then a demo response is returned with `ok:true`.
  - Given "Translate" with input "Hindi", When run, Then the last inbound message is translated to Hindi.
  - Given "Use as reply", When pressed, Then the composer contains the output and nothing is sent.
- **Source refs:** app/Http/Controllers/ChatController.php (aiAssist, callAiProvider, fakeResponseFor); resources/js/charts/user-chat-index.js (openAiDrawer, runAi, wireAiDrawer); resources/views/user/chat/index.blade.php (ai-drawer); Documentation/pages/messaging/chat.html.
- **Port notes:** Route through the AI gateway module (per-workspace keys, plan gate, usage metering, PII redaction option); return real errors (402/403/502) instead of canned text; fix the client state bug when rebuilding.

### WD-CHAT-030 — Recipient number autocomplete endpoint

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CHAT-004
- **Summary:** An endpoint returns up to eight previously used numbers matching a typed fragment. The docs say the compose box suggests numbers as you type, but no front-end code calls it.
- **Actors & access:** Manager+.
- **UX & screens:** None found (no caller in `user-chat-index.js`, blades or elsewhere).
- **Endpoints:**

  | Method + URI                   | Route name                     | Controller@action              | Middleware | Request                    | Response               |
  | ------------------------------ | ------------------------------ | ------------------------------ | ---------- | -------------------------- | ---------------------- |
  | `GET /chat/api/search-numbers` | `user.chat.api.search-numbers` | `ChatController@searchNumbers` | manager+   | `q` (required, 2-32 chars) | `200 {data:[number…]}` |

- **Data:** Reads the newest 500 `messages` of the workspace with a `to_number`, decrypts, filters by case-insensitive substring, de-duplicates and returns the first 8 (order = newest first).
- **Rules & edge cases:**
  1. Encrypted `to_number` prevents SQL matching, hence the 500-row window; older numbers never match.
  2. Visibility uses the legacy NULL-workspace fallback (`Message::forCurrentWorkspace`).
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given recent sends to 919812345678, When `q=9812` is requested, Then that number is returned.
  - Given `q=9` (1 char), When requested, Then 422.
  - Given more than 8 matches, Then only 8 are returned.
- **Source refs:** app/Http/Controllers/ChatController.php (searchNumbers); Documentation/pages/messaging/chat.html.
- **Port notes:** Replace with a contact search (`GET /contacts?q=`) over normalized phone/name with an index; wire it into the recipients box.

### WD-CHAT-031 — Composer conveniences: emoji picker, bold, Enter-to-send, attach menu, quick-reply chips

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CHAT-007
- **Summary:** Small helpers around the thread composer that make it feel like WhatsApp Web.
- **Actors & access:** Manager+.
- **UX & screens:** Emoji button lazily loads the `emoji-picker-element` web component (about 600 KB, dynamic import on first open), mounts it in a panel pinned above the composer in the light theme and inserts the chosen emoji at the caret. "B" wraps the selection in `*…*` (or inserts `*text*` with the placeholder selected). Enter sends, Shift+Enter inserts a newline, Esc closes attach/emoji panels and the template picker, an outside click closes the panels. The attach "+" menu shows Template, Document, Photos & videos, Audio, Scheduled time, Send your location; any unknown item would toast "{kind} — coming soon". A quick bar under the composer has three fixed chips that replace the composer text: "Support reply" (a greeting with a `{{name}}` placeholder), "Order update" (asks the customer to confirm a delivery slot) and "Offer code" (a hard-coded `NEW26` promo line with a "Jan 10" date).
- **Endpoints:** None.
- **Data:** None.
- **Rules & edge cases:**
  1. Chip texts are hard-coded, not editable and not per-workspace; there is no quick-reply library, snippet store or `/shortcut` feature.
  2. QUIRK: the "Support reply" chip contains a literal `{{name}}` that is not substituted on a free-form send, so the customer receives the braces.
  3. The composer send button state follows the trimmed text or a pending file.
  4. Composer markup is the WhatsApp grammar asterisks for bold, underscores for italic, tildes for strike and backticks for code; there are no Cmd+B/I shortcuts in this textarea (they exist only in the `x-wa-editor`, WD-CHAT-032).
- **Async & events:** None.
- **External systems:** None (emoji data bundled with the package).
- **Settings:** None.
- **Acceptance criteria:**
  - Given text selected in the composer, When "B" is pressed, Then the selection is wrapped in asterisks and stays selected.
  - Given the composer, When Shift+Enter is pressed, Then a newline is inserted and nothing is sent.
  - Given the "Offer code" chip, When clicked, Then the composer content is replaced with the fixed offer text.
- **Source refs:** resources/js/charts/user-chat-index.js (mountEmojiPicker, wire, insertComposerText); resources/views/user/chat/index.blade.php (quick-bar, attach-menu).
- **Port notes:** Replace fixed chips with a workspace "saved replies" table (title, body, shortcut, variables) — this is the natural home of "quick messages" in the new stack; keep the WhatsApp text grammar.

### WD-CHAT-032 — WhatsApp-style rich-text editor component (`x-wa-editor`)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** –
- **Summary:** A reusable textarea with a formatting toolbar that wraps the selection in WhatsApp's markup and lazy-loads an emoji picker. In this domain it powers the "Initial message" field of the compose modal.
- **Actors & access:** Any page that renders the component (only the Quick Send compose modal does).
- **UX & screens:** `resources/views/components/wa-editor.blade.php`. Props: `name` (default `body`), `value`, `rows` (4), `required`, `maxlength` (4096), `placeholder`, `id` (random `wa-editor-xxxxxxxx`), `hint` (asterisks for bold, underscores for italic, tildes for strike and backticks for code). Toolbar buttons B, I (italic), S (strike), `{}` (monospace), emoji; the hint is shown on md+ screens. Cmd/Ctrl+B wraps in `*`, Cmd/Ctrl+I in `_`, Cmd/Ctrl+U in `~` (U maps to strike-through). The emoji panel is absolutely positioned below the editor, closes on outside click and does not push the form. Every mutation dispatches an `input` event so live previews and counters update. Initialization is idempotent (`data-wa-editor` scan on DOM ready and via `initWaEditors(scope)`).
- **Endpoints:** Optional AI review calls `POST /ai/review-text` (owned by the AI helper controller) — see rules.
- **Data:** None.
- **Rules & edge cases:**
  1. `wrapSelection` with no selection inserts the prefix and suffix and leaves the caret between them.
  2. The JS also implements an AI-review panel (manual sparkle button, or a 1.4 s debounced auto-run for texts of 12+ characters when the user setting `auto_ai_summarize_enabled` is on): it posts `{text}` and renders a score (/100), strengths, problems and a "best version" with an Append button. This needs `data-ai-enabled`/`data-ai-auto` attributes and a `[data-ai-panel]` element, which `x-wa-editor` does not render; the hooks are live only in the other composer component (`compose-textarea`, another domain), so they are inert in Quick Send.
- **Async & events:** None (unless AI review is wired).
- **External systems:** `emoji-picker-element` package; `/ai/review-text` when enabled.
- **Settings:** User setting `auto_ai_summarize_enabled` (only for AI-enabled composers).
- **Acceptance criteria:**
  - Given selected text, When Cmd+B is pressed, Then it becomes `*text*` and an `input` event fires.
  - Given the emoji button, When clicked twice, Then the picker mounts once and the panel toggles.
  - Given a click outside the editor, When the emoji panel is open, Then it closes.
- **Source refs:** resources/js/wa-editor.js; resources/views/components/wa-editor.blade.php; resources/js/app.js (imports); app/Models/User.php (`auto_ai_summarize_enabled`).
- **Port notes:** Build as a shared `<WhatsAppTextArea>` React component in the UI kit with the same grammar and shortcuts; make the AI review an optional plug-in prop.

### WD-CHAT-033 — "Send to all" and "Send to selected" footer buttons (stubs)

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CHAT-002
- **Summary:** Two buttons under the queue list look like bulk-send actions but only show toasts.
- **Actors & access:** Manager+.
- **UX & screens:** "Send to all" toasts "Queued {n} messages in {title}" (n = the open queue's `recipients_count`) or "Select a queue first". "Send to selected" toasts "Pick recipients in {title} — coming soon" (a TODO in code).
- **Endpoints:** None.
- **Data:** None.
- **Rules & edge cases:**
  1. QUIRK: "Send to all" claims messages were queued but performs no request and no send.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a queue is open, When "Send to all" is pressed, Then only a toast appears and no message is created.
  - Given no queue is open, When either button is pressed, Then "Select a queue first" shows.
- **Source refs:** resources/js/charts/user-chat-index.js (wire); resources/views/user/chat/index.blade.php.
- **Port notes:** Do not port the fake toast. If a re-send-to-all-recipients action is wanted, implement it as an explicit "re-send this message to all recipients" batch (WD-BCAST semantics).

### WD-CHAT-034 — Engine-aware conversation visibility (multi-engine and channel exemptions)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-WADEV, WD-WABA, WD-TIB1
- **Summary:** Conversation lists (Quick Send, Team Inbox, counts) only show threads on engines the workspace can currently use, plus web/social channels that are engine-independent. This is why a conversation "vanishes" when its engine is switched off or disconnected.
- **Actors & access:** Applied automatically to every conversation query that uses `forCurrentEngine()`; requires an authenticated user with a current workspace (with none, or with no auth context such as queue jobs, the scope is a no-op).
- **UX & screens:** No UI of its own; the docs troubleshooting row "A just-sent conversation vanished from the list" describes the consequence.
- **Endpoints:** Affects `GET /chat/api/conversations` and the counts returned by every chat endpoint.
- **Data:** Reads `conversations.provider` (`baileys`|`waba`|`twilio`, default `baileys`), `conversations.channel` (default `whatsapp`), `wa_provider_configs`, workspace `enabled_engines`.
- **Rules & edge cases:**
  1. Visible engine set = `WorkspaceEngine::enginesFor(workspace)`: engines allowed by admin (`allowed_send_methods`) ∩ the workspace's optional `enabled_engines` subset ∩ engines that are connected (a connected provider config, or an owned Baileys device); if that yields nothing the workspace's default engine is used, listed first. It is ADDED to by "coexistence": any connected WABA/Twilio config always shows.
  2. Engine-agnostic channels (`chatbot_widget`, `instagram`, `facebook`, `tiktok`, `telegram`, `line`, `wechat`, `viber`, `sms`, `email`) are exempt from the engine filter, but each is included only while its account/bot is connected (`chatbot_widget` always); disconnecting the last account removes it from the set.
  3. Final predicate: `provider IN (engine set) OR channel IN (exempt channels)`.
  4. The computed sets are cached for 5 seconds per workspace (`inbox:engine-scope:{workspace_id}`) because the scope is applied several times per poll; a connect/disconnect therefore takes up to one poll to show.
  5. `Conversation::scopeDeviceAlive` (hide threads whose Baileys device row was deleted; they reappear when the device id exists again) exists for the Team Inbox and is NOT applied by Quick Send.
  6. `messages.provider` is filtered the same way in message-history sources (WD-CHAT-038) and dashboards, using the plain `HasEngineScope` trait (no channel exemption).
- **Async & events:** None.
- **External systems:** None.
- **Settings:** Admin `allowed_send_methods`, `default_send_method`; workspace `enabled_engines`.
- **Acceptance criteria:**
  - Given a workspace whose only connected engine is Baileys, When a conversation stamped `waba` exists with no connected WABA config, Then it is not listed.
  - Given a connected WABA config, When the list loads, Then WABA-stamped conversations show even if `enabled_engines` omits waba (coexistence).
  - Given a chat-widget conversation stamped with a disconnected engine, When the list loads, Then it is still visible.
  - Given the workspace disconnects Telegram, When 5 seconds pass, Then Telegram threads drop out of the engine-agnostic set.
- **Source refs:** app/Models/Conversation.php (ENGINE_AGNOSTIC_CHANNELS, scopeForCurrentEngine, scopeDeviceAlive); app/Models/Concerns/HasEngineScope.php; app/Services/WorkspaceEngine.php.
- **Port notes:** Model as `channels` (connected endpoints) plus `conversations.channel_id`; visibility becomes "conversation's channel is enabled/connected", which removes the provider-vs-channel special cases and the 5 s cache (use a short-lived cache keyed by org).

### WD-CHAT-035 — Outbound chat message → team-inbox mirror (Message observer)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TIB1, WD-CHAT-036
- **Summary:** Every time a `messages` row is created from anywhere in the app, a copy is written to `inbox_messages` so the Team Inbox shows the same history as Quick Send.
- **Actors & access:** Automatic (model event `created`).
- **UX & screens:** Visible as the Quick Send thread showing up in `/team-inbox` for the same number.
- **Endpoints:** Fired by every writer of `messages`: chat (this domain), the mobile quick-message API, the extension API, the chatbot widget, the order/commerce controllers, forwards/resends.
- **Data:** New `inbox_messages` row: `conversation_id`, `user_id`, `direction` (default `out`), `to_number`, `from_number`, `body` (empty string if null), `status` (default `sent`), `provider`, `media_path`, `media_type`, `template_id`, `meta` = original meta plus `mirrored_from_message_id`, `sent_at` = message `sent_at` else `created_at`.
- **Rules & edge cases:**
  1. Skipped when the static flag `Message::$skipInboxMirror` is on (callers that write both tables themselves wrap the create in `Message::withoutInboxMirror(fn)`: mobile quick-message, extension, chatbot widget), or when the message has no `conversation_id`.
  2. De-duplication: if the message carries a WhatsApp id (`meta.wa_message_id` or a `whatsapp_message_id` attribute) and the conversation already has an `inbox_messages` row with the same id, no copy is made (whichever path lands first wins).
  3. Only the create is mirrored. Later status changes (delivered/read from the chat receipt endpoint are mirrored separately, WD-CHAT-014), reactions, pins, stars, soft deletes and edits are not.
  4. Failure to mirror is logged (`[MSG-MIRROR]`) and never fails the send.
  5. QUIRK: because chat rows lack a WhatsApp id (WD-CHAT-012) the de-duplication never fires for them, so the phone-side "fromMe" echo that Node later forwards (`/api/inbound-message` with `direction=out`) does not match either table and can create a second inbox bubble for the same send (needs runtime confirmation).
  6. QUIRK: mirrored rows count towards the legacy monthly-usage query that sums outbound `messages` and outbound `inbox_messages`, doubling usage (WD-CHAT-012).
  7. QUIRK: message-history includes both the `legacy` (Direct send) and `inbox` (Team inbox) sources, so each Quick Send message appears twice in the unified history (WD-CHAT-038).
- **Async & events:** In-process, synchronous, inside the request.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a Quick Send message, When it is created, Then `inbox_messages` contains a row with `meta.mirrored_from_message_id` equal to the message id.
  - Given a caller using `withoutInboxMirror`, When it creates a message, Then no mirror row is written.
  - Given an existing inbox row with the same WhatsApp id in the conversation, When a message with that id is created, Then no second row appears.
  - Given the mirror insert throws, When a message is created, Then the message creation still succeeds and a warning is logged.
- **Source refs:** app/Models/Message.php (booted created hook, skipInboxMirror, withoutInboxMirror); app/Models/InboxMessage.php; app/Http/Controllers/WaInboundController.php (dedupe); app/Http/Controllers/Api/App/QuickMessageController.php (skip flag users).
- **Port notes:** In the new schema there is ONE `messages` table per conversation; the mirror disappears. Preserve the rule "a send from any surface is visible in the inbox thread" by construction, and dedupe provider echoes with the `(channel, provider_message_id)` unique index.

### WD-CHAT-036 — Message record lifecycle: encryption at rest, provider stamp, scopes and display time

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** –
- **Summary:** Defines what a `messages` row is: status vocabulary, direction, encrypted PII columns, automatic engine stamping and tenant visibility.
- **Actors & access:** Model-level behavior used by all writers/readers.
- **UX & screens:** None directly; drives ticks (WD-CHAT-003) and time labels.
- **Endpoints:** None.
- **Data:** See Data model (`messages`). Status vocabulary `pending`, `scheduled`, `sent`, `delivered`, `read`, `failed`; direction `out`|`in`.
- **Rules & edge cases:**
  1. `to_number`, `from_number`, `body` and `failure_reason` are Laravel `encrypted` casts (non-deterministic ciphertext), so they cannot be indexed, searched or sorted in SQL; every search in this domain hydrates rows and filters in PHP (search-numbers, queue search, recipient grouping). Raw `DB::table` readers (unified stream) must decrypt tolerantly: a value beginning with the ciphertext prefix `eyJ` is decrypted, anything else is returned as is.
  2. `latitude`/`longitude` are `decimal(10,7)`; `meta` is a JSON array; `pinned`/`starred` booleans; timestamps `scheduled_at`, `sent_at`, `delivered_at`, `read_at` cast to datetime.
  3. On create, if `provider` is empty it is stamped from the parent conversation's `provider`; if that is missing, from the workspace's current engine (`WorkspaceEngine::for`). Resolver errors never block a create. The dispatcher may also stamp/align it (restoring the stored pin after dispatch, so a fallback engine never overwrites the operator's pinned engine).
  4. `forCurrentWorkspace` scope: `workspace_id = current` OR (`workspace_id IS NULL` AND `user_id = me`) — the legacy fallback for pre-multi-workspace rows.
  5. `display_time`: `HH:MM` today, "Yesterday", `M d` (same year), `M d, Y` — from `sent_at` else `created_at`, in the app timezone.
  6. Soft deletes (`deleted_at`); `conversation_id` is nullable (campaign/API sends can be conversation-less) and FK-cascades on conversation delete; `workspace_id` FK is `SET NULL` on workspace delete.
  7. Fillable extras: `agent_id`, `contact_id`, `template_id`, `quality_score` (0-255), `quality_note` (≤191). Nothing in this domain writes quality fields (AI agent domain does).
  8. Attributes passed but not columns (e.g. `device_id` on template sends) are silently dropped by mass assignment.
- **Async & events:** `creating` (provider stamp) and `created` (mirror, WD-CHAT-035) hooks.
- **External systems:** None.
- **Settings:** `APP_KEY` protects the ciphertext (rotating it makes old rows undecryptable; the `wasnap:backfill-encrypted` command re-encrypts plaintext leftovers).
- **Acceptance criteria:**
  - Given a message created with a body, When the database column is read directly, Then it is ciphertext and the model returns plaintext.
  - Given a message created without provider inside a conversation stamped `waba`, When saved, Then `provider='waba'`.
  - Given a legacy row with NULL workspace owned by user 7, When user 8 lists messages, Then it is invisible to user 8.
- **Source refs:** app/Models/Message.php; database migrations 2026_05_05_000002_create_messages_table, 2026_05_08_160000_add_message_actions_to_messages, 2026_05_09_120000_add_meta_to_messages, 2026_05_13_001000_add_quality_to_messages, 2026_05_26_140000_add_provider_to_conversations, 2026_05_26_160000_restamp_message_provider_from_conversation, 2026_06_05_181500_make_messages_conversation_id_nullable; app/Console/Commands/BackfillEncryptedPlaintext.php.
- **Port notes:** Use application-level field encryption only where required (numbers → normalized/hashed columns for lookup; body may remain plaintext under RLS + disk encryption, per the repo's crypto design). Add `provider_message_id`, `error_code` and `attempts` columns; keep the status vocabulary and make transitions forward-only.

### WD-CHAT-037 — Auto-save typed recipients as Contacts

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CHAT-004, WD-CON
- **Summary:** Numbers typed into the compose modal are remembered as CRM contacts so a one-off Quick Send recipient is never lost.
- **Actors & access:** Manager+ (side effect of WD-CHAT-004; only for `recipient_type=manual`).
- **UX & screens:** None; the contact later appears in Contacts.
- **Endpoints:** Side effect of `POST /chat/api/conversations`.
- **Data:** `contacts` row: `workspace_id`, `user_id` (creator), `mobile` = the number exactly as typed, `country_code` null, `name` null. Existing contact found by `mobile_hash` (hash of country code + number) within the workspace is reused untouched.
- **Rules & edge cases:**
  1. Numbers with fewer than 6 digits are ignored; the helper never throws (errors logged as `[CONTACT-CAPTURE]`).
  2. The hash is computed on save (the model keeps `mobile_hash` in step with the encrypted `mobile`).
  3. Creating a contact fires the flow trigger `contact_created` (and group-join triggers for any groups), so a Quick Send to a new number can enrol the contact in an automation (WD-FLR).
  4. Group sends never create contacts (they come from contacts already).
  5. Contacts are created before the send is validated against any sender; a later failed send still leaves the contact.
- **Async & events:** `FlowEnrollmentService::onContactCreated`.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a new number, When a queue is created to it, Then a Contact with that mobile exists in the workspace.
  - Given the same number typed with different formatting but the same hash, When sent again, Then no duplicate contact is created.
  - Given "12345" (5 digits), When sent, Then no contact is created.
- **Source refs:** app/Http/Controllers/ChatController.php (createConversation); app/Models/Contact.php (rememberPhone, booted).
- **Port notes:** Use the contacts module's identity upsert (E.164 normalization, unique `(org_id, kind, value)` identity) and emit the contact-created outbox event.

### WD-CHAT-038 — Unified message stream (six sources merged into one normalized feed)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-CHAT-036, WD-TIB1, WD-CAMP, WD-BCAST, WD-SCHED, WD-AR
- **Summary:** `UnifiedMessageStream` reads message records from six tables owned by different features, normalizes them into one row shape, merges and paginates them. Message History, and the device detail page, are built on it.
- **Actors & access:** Internal service; callers enforce access (manager+ on Message History).
- **UX & screens:** None directly.
- **Endpoints:** None (consumed by WD-CHAT-039 and the device detail page).
- **Data:** Output row: `id` (source-prefixed), `source`, `source_label`, `direction` (in|out), `body`, `contact_name`, `phone`, `status`, `when` (datetime), `meta` (array). Sources (key → label → id prefix → table):
  - `inbox` → "Team inbox" → `inbox-` → `inbox_messages` of the workspace's conversations whose provider is in the enabled engine set; phone = `to_number` for out, `from_number` for in; meta `conversation_id`, `media_type`; `when`=`created_at`.
  - `auto_reply` → "Auto-reply" → `auto-` → `keyword_reply_logs` of the workspace's keyword replies (engine-filtered); direction always `out`; body = the fired variant text, else `Triggered by "<matched text>"`; phone = `contact_phone`; status `fired`; `when`=`fired_at`; meta keyword, matched, language, reply_type.
  - `campaign` → "Campaign" → `camp-` → `wp_campaign_contacts` of campaigns whose device belongs to a workspace member and provider in the engine set; direction `out`; body "Campaign send · {name}"; contact_name = recipient name; phone; status as stored; `when`= `sent_at` else `created_at`; meta campaign_name, campaign_id, error, response.
  - `broadcast` → "Broadcast" → `brd-` → `broadcast_contacts` of workspace members' broadcasts (engine filtered); direction `out`; body "Broadcast · {name}"; no phone or contact name; meta broadcast_name, error.
  - `scheduled` → "Scheduled" → `sch-` → `scheduled_messages` of the workspace (engine filtered, soft deletes excluded); body "Scheduled · {name}" plus the message content on a new line; phone = the job's `from_number` (the sender, not a recipient); status as stored; `when` = `last_run_at` else `next_run_at` else `created_at`; meta sent/delivered/failed counters, next/last run, error.
  - `legacy` → "Direct send" → `leg-` → `messages` rows of workspace members (engine filtered by `messages.provider`); phone/contact as inbox; meta media_type, template_id.
- **Rules & edge cases:**
  1. Each source is limited to the newest 200 rows (`PER_SOURCE_LIMIT`) inside the requested date window; the union is sorted by `when` desc in PHP; then paginated. Date window: `>= from` and `<= to` on the source's own timestamp (scheduled: either `last_run_at` or, for never-run jobs, `created_at`).
  2. Free-text filter `q` and direction filter run in PHP over body + phone + contact name (case-insensitive substring).
  3. Page size is clamped to 5..100 (default 25). QUIRK: callers that ask for 10 000 rows ("full hydrate") silently get at most 100 (WD-CHAT-039).
  4. Workspace scoping goes through the workspace's member user ids (`workspace_user`) for legacy/campaign/broadcast rows and through `workspace_id` for inbox/auto-reply/scheduled; an engine filter uses the enabled engine set (WD-CHAT-034).
  5. `counts(workspace, from, to)` returns per-source SQL `COUNT`s (no hydration) plus `total`, respecting the same scoping and dates.
  6. Raw `DB::table` reads bypass model casts, so encrypted strings are decrypted through the tolerant `dec()` helper (`eyJ` prefix check); campaigns/broadcasts/auto-reply names are read through Eloquent to get decrypted names.
  7. QUIRK: Quick Send writes `messages` and mirrors to `inbox_messages` (WD-CHAT-035), so one send appears as a `legacy` row and an `inbox` row.
  8. QUIRK: `phone` for scheduled rows is the sender number, and broadcast rows have no phone, so search by recipient number cannot find them.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** Engine set (WD-CHAT-034); constant per-source limit 200.
- **Acceptance criteria:**
  - Given rows in all six sources within range, When paginate() is called with sources=all, Then the result is sorted newest-first across sources and each row carries a source-prefixed id.
  - Given 500 inbox messages in range, When the feed is built, Then at most 200 inbox rows contribute.
  - Given `direction='out'`, When called, Then inbound rows are excluded.
  - Given `counts()`, When called with the same window, Then the per-source totals equal SQL counts (not capped at 200).
  - Given a per_page of 10000, When called, Then the page size is 100.
- **Source refs:** app/Services/UnifiedMessageStream.php; app/Models/InboxMessage.php, KeywordReplyLog.php, WpCampaign.php, Broadcast.php, ScheduledMessage.php (readers).
- **Port notes:** Implement as a SQL `UNION ALL` view/materialized read model or a dedicated `message_feed` query with keyset pagination and true counts; a unified `messages` table (with a `kind` column: direct, auto_reply, campaign, broadcast, scheduled) removes most of this service. Keep the six source labels and id prefixes only if the UI needs them.

### WD-CHAT-039 — Message History page (filters, table, detail panel)

- **Status:** partial
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-CHAT-038, WD-CHAT-040
- **Summary:** `/message-history` is a workspace-wide, read-only archive of everything sent or received, with date-range, direction, type, search and pagination controls, a side detail panel and links to each row's source page.
- **Actors & access:** Workspace role `manager`+ (`workspace.role:manager`; agents/viewers are redirected to `/team-inbox`); no plan gate; aborts 404 "No workspace." when the user has no current workspace.
- **UX & screens:** `resources/views/user/message-history/index.blade.php` (+ `_rows.blade.php`), layout `x-layouts.user`, JS `user-message-history-index`. Header: back link to `/more`, breadcrumb "More / Message History", range select (Last 24 hours / 7 days / 30 days / 90 days; submitting the form reloads the page), "Export CSV" link and an "Archive" button (inert, WD-CHAT-042). Sections: KPI strip (WD-CHAT-040), Volume chart with Daily/Hourly/Weekly tabs, Direction donut, filter bar, message table with detail aside, and the bottom row (Top conversations, By-type mix chart). Filter bar: search input (placeholder "Search by content, contact, phone, or message id..."), direction tabs All / Sent / Received / Failed each with a count, device select ("All devices"), type select (All types, Plain text, Template, Auto-reply, Campaign, Broadcast, Scheduled, Image, Video, Document, Location) and Apply. Table columns: checkbox (select-all), When (HH:MM over "today" / "yesterday" / `M d`), Dir (incoming / outgoing / failed icon), Contact (gradient initials avatar chosen from a CRC32 of the row id, name, phone or "—"), Message (100-character snippet with ellipsis, media icon + file name for image/video/document), Type (coloured pill), Status (dot + label), Open (eye link). Footer "Showing a–b of N" with Prev, first, a ±2 page window, last, Next. Empty state: "No messages match the current filters. Try clearing search or picking a wider date range." with a reset link to `/message-history`. Detail aside (first row of the page by default; "Click a row to see its details." when there are no rows): avatar, name, phone, Direction, Status, Type, When, Content (full body), Failure (only when the row has a source error), Metadata list, Copy ID and "Open chat" / "Open thread →" links to `/chat`.
- **Endpoints:**

  | Method + URI           | Route name                   | Controller@action                | Middleware                                    | Request                                                                                                                                                                                              | Response                                                                                                                                                                                         |
  | ---------------------- | ---------------------------- | -------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `GET /message-history` | `user.message-history.index` | `MessageHistoryController@index` | `Authenticate`, `EnsureWorkspaceRole:manager` | `range` (24h\|7d\|30d\|90d, default 30d; any other value → 7d), `dir` (all\|out\|in\|fail), `type` (all or a type key), `device_id`, `q`, `bucket` (daily\|hourly\|weekly), `page` (≥1), `partial=1` | HTML page, or with `partial=1` `{ok:true, data:{stats, volume, direction, typeMix, topConvos, dirCounts, rows, page, pageCount, total, shownFrom, shownTo, devices, filters, rowsHtml, detail}}` |

- **Data:** Reads the unified stream (WD-CHAT-038) for all six sources; `devices` from `devices` of the workspace (latest first) as `{id, phone, label}`.
- **Rules & edge cases:**
  1. Row set = stream rows in the range, then filters in order: direction (`fail` = outbound with status `failed` or `error`), type (below), free-text `q` over body + phone + contact name + row id.
  2. Type classification (`classifyType`): rows from `auto_reply`, `campaign`, `broadcast`, `scheduled` sources are typed by source; else a media type maps to `image`, `video`, `audio` or `document` (anything else with a media type, including `location`, is `document`); else a template id → `template`; else `text`. QUIRK: `location` is never produced, so the Location filter and the "location" type-mix bucket are always empty and location messages show as Document. `audio` has a label but no dropdown option.
  3. Pagination: 25 rows per page over the filtered set; page clamped to `[1, pageCount]`.
  4. Timestamps shown in the workspace display timezone: workspace `timezone` → user `timezone` → admin `default_timezone` → `app.timezone` → UTC; invalid zones are skipped. Dates render "today", "yesterday" or `M d`.
  5. Status labels: inbound rows "Inbound" (grey dot); outbound: read/delivered/sent/fired/paid = green; failed/error = coral; scheduled/pending and others = neutral grey; label = capitalized status.
  6. Row name = contact name, else phone, else "{source label} · {id}".
  7. The "Open" eye link goes to `/scheduled/{n}`, `/broadcasts/{n}` or `/wa-campaigns/{campaign_id or n}` for those sources (numeric part of the prefixed id) and to `/chat` for everything else.
  8. Detail (server-rendered for the first row of the current page): body, source label, conversation id (if any), failure reason (`meta.error`), full-time stamp, a one-step timeline ("Recorded at"), metadata rows Message ID, Source, Phone, Status, Language (auto-reply detected language), Created, and — for failed rows — Failure reason (`#code text`); `canResend` is always false.
  9. QUIRK: the device filter is read and echoed back but never applied to the data, in the table, the charts or the KPIs.
  10. QUIRK: rows come from the capped 100-row hydrate described in WD-CHAT-040, so the table can never exceed 4 pages regardless of volume.
  11. QUIRK (client wiring): the page mixes server-rendered GET forms (range, type, device, search) with an AJAX layer (`?partial=1`) bound to element ids that do not exist in the markup (`mh-range`, `mh-type`, `mh-device`, `mh-search`, `mh-pick-all`, `mh-archive`, `mh-export`, `mh-pagination`, `data-mh` KPI hooks). The only live AJAX controls are the direction tabs, the bucket tabs and row click. Because the AJAX filter state is initialized from the missing elements, a direction/bucket click reloads with range = default (30 d), no search, no type and no device, ignoring the values in the form. Row click only updates the detail aside from the row's `data-*` attributes (truncated body); the follow-up `GET /message-history/{id}` has no route and its 404 is swallowed.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** Admin `default_timezone`; engine set.
- **Acceptance criteria:**
  - Given no `range`, When the page loads, Then the window is the last 30 days and the range select shows "Last 30 days".
  - Given `dir=fail`, When loaded, Then only outbound rows with status failed/error are listed.
  - Given `type=broadcast`, When loaded, Then only broadcast rows show and the Open link goes to `/broadcasts/{n}`.
  - Given a search for a phone fragment, When applied, Then rows whose phone contains it (case-insensitive) match.
  - Given a workspace with no messages, When loaded, Then the empty state with a reset link is shown.
  - Given a viewer-role user, When they request the page, Then they are redirected to `/team-inbox`.
- **Source refs:** app/Http/Controllers/MessageHistoryController.php (index, presentRow, presentDetail, classifyType, statusBadge, resolveDisplayTz); resources/views/user/message-history/index.blade.php, _rows.blade.php; resources/js/charts/user-message-history-index.js; Documentation/pages/messaging/message-history.html.
- **Port notes:** `apps/web/app/(app)/message-history` + `GET /message-history` on the messages read model. Do server-side filtering, real counts, cursor pagination and a working device filter; keep one filter state (URL query) instead of the dual form/AJAX design; add a Location type. The detail should load by id from the API.

### WD-CHAT-040 — Message History KPIs, volume/direction/type charts and top conversations

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CHAT-039
- **Summary:** The dashboard blocks on Message History: five KPI cards, a stacked volume chart, a direction donut, a type-mix bar chart and a top-conversations list.
- **Actors & access:** As WD-CHAT-039.
- **UX & screens:** KPI cards: Total messages (with "±n% vs last period"), Sent (share %), Received (share %), Failed (failure %, caption "retry queue"), Avg response ("healthy"/"n/a", caption "to first reply"). Volume chart: stacked bars Sent/Received/Failed with Daily/Hourly/Weekly tabs (ApexCharts). Direction donut with total in the centre and a legend. "By message type / Mix this period" horizontal bar chart. "Top conversations — Most active threads ({range})" list of up to four threads (initials avatar, title, "{n} msgs · last HH:MM") each linking to `/chat`, with an "Open inbox" link; empty text "No active threads in this range yet."
- **Endpoints:** Part of `GET /message-history` (WD-CHAT-039).
- **Data:** Derived in PHP from the hydrated rows; the previous-period total from `UnifiedMessageStream::counts`.
- **Rules & edge cases:**
  1. KPIs use the range-only universe (unfiltered by dir/type/search) so headline numbers do not move with filters; charts, direction mix, type mix and the table use the filtered universe; top conversations and direction-tab counts use the range universe.
  2. Definitions: `sent` = outbound rows whose status is not failed/error; `received` = inbound; `failed` = outbound failed/error; `total` = all rows; `sentPct` and `receivedPct` = share of total (rounded); `failPct` = failed ÷ sent × 100 (one decimal; it is relative to sent, can exceed 100, and is 0 when nothing was sent).
  3. `deltaPct` = round((total − previousTotal) ÷ previousTotal × 100) where the previous window is the equal-length period immediately before the range and its total is a real SQL count across sources; if the previous total is 0 the delta is 100 when total > 0, else 0.
  4. Average first response: only `inbox` rows, grouped by phone; per phone take the earliest inbound and the earliest outbound in the window; if the outbound is later, the difference in seconds counts; average over qualifying phones, shown as `Ns`, `Nm Ns` or `Nh Nm`, "—" when none.
  5. Volume buckets: hourly = last 24 hours (label `HH:00`), weekly = ceil(days ÷ 7) weeks starting Monday (label `M d`), daily = one bucket per day of the range (label weekday name for ranges ≤ 7 days, else `M d`); buckets end at "now", rows outside the buckets are ignored; three series sent/received/failed.
  6. Type mix buckets: Plain text (text + audio-less default), Auto-reply, Campaign, Broadcast, Scheduled, Media (image, video, document, location); `template` and `audio` rows fall into "Plain text" because the mapper's default branch catches them.
  7. Top conversations: `inbox` rows with a phone, grouped by phone, ordered by count, top four, title = first known contact name else phone, gradient from a fixed 4-colour palette, `lastAt` = latest `HH:MM` (UTC epoch rendered without display-timezone conversion) — QUIRK.
  8. QUIRK (major): the "full hydrate" requests 10 000 rows but the stream clamps the page size to 100, so every number above is computed from only the 100 newest rows of the range across all sources, while `deltaPct` compares that capped total with a true count of the previous period. On any real workspace the KPIs, charts and top conversations are wrong, contrary to the docs. The port must compute these with aggregate queries.
- **Async & events:** None.
- **External systems:** ApexCharts on the client.
- **Settings:** Range/bucket query params; design tokens for chart colours.
- **Acceptance criteria:**
  - Given 8 sent, 2 failed and 5 received rows in range, When loaded, Then Total=15, Sent=8, Received=5, Failed=2, failPct=25.0.
  - Given the previous 30 days had 10 messages and this range has 15, When loaded, Then delta shows +50%.
  - Given `bucket=hourly`, When loaded, Then the volume chart has 24 points ending at the current hour.
  - Given inbound at 10:00 and the first outbound at 10:03 for the same phone, When loaded, Then Avg response shows 3m 0s.
- **Source refs:** app/Http/Controllers/MessageHistoryController.php (kpiStrip, dirCounts, volumeSeries, directionMix, typeMix, topConversations, humanDuration); resources/views/user/message-history/index.blade.php; resources/js/charts/user-message-history-index.js.
- **Port notes:** Compute with SQL aggregates (`date_trunc`, `FILTER`) on the messages table; compute first-response time per conversation using message timestamps in the conversation, ideally already tracked as `first_response_at` (WD-TIB2).

### WD-CHAT-041 — Message History CSV export

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CHAT-038
- **Summary:** "Export CSV" downloads the messages in the selected date range as a CSV with formula-injection protection.
- **Actors & access:** Manager+ (same gate as the page); 404 when no workspace.
- **UX & screens:** Link "Export CSV" in the page header, built from the current `range` key. Downloads `message-history-YYYYMMDD-HHMMSS.csv`.
- **Endpoints:**

  | Method + URI                  | Route name                    | Controller@action                 | Middleware | Request                                  | Response                                                                  |
  | ----------------------------- | ----------------------------- | --------------------------------- | ---------- | ---------------------------------------- | ------------------------------------------------------------------------- |
  | `GET /message-history/export` | `user.message-history.export` | `MessageHistoryController@export` | manager+   | `range` (24h\|7d\|30d\|90d, default 30d) | streamed `text/csv; charset=UTF-8` with `Content-Disposition: attachment` |

- **Data:** Columns in order: `id`, `source` (label), `when` (ISO 8601), `direction`, `phone`, `contact`, `status`, `type`, `body`. No BOM. Direction, type, device and search filters are not applied — only the range.
- **Rules & edge cases:**
  1. CSV/Excel formula injection guard: any cell (except `when`, `direction`, `type`) whose first character is `=`, `+`, `-`, `@`, tab or carriage return is prefixed with a single quote.
  2. `when` uses the stored timestamp's own offset (app timezone), not the display timezone used on the page.
  3. QUIRK: same 100-row clamp as WD-CHAT-040 — the file contains at most the 100 newest rows, although the docs say the export covers the full range.
  4. The response is streamed with `fputcsv` (standard RFC 4180 quoting).
- **Async & events:** None (synchronous stream).
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a message body `=cmd|'/c calc'!A1`, When exported, Then the cell starts with a single quote.
  - Given range=7d, When exported, Then the file name has the current timestamp and only rows of the last 7 days appear.
  - Given no rows, When exported, Then the file contains only the header row.
- **Source refs:** app/Http/Controllers/MessageHistoryController.php (export); Documentation/pages/messaging/message-history.html.
- **Port notes:** Stream from a server-side cursor (no cap; use a background export job + download link for very large ranges), apply the active filters, add a UTF-8 BOM optionally, and keep the injection guard.

### WD-CHAT-042 — Message History archive endpoint and dead client hooks

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CHAT-039
- **Summary:** The page ships an Archive button, row checkboxes, a Resend button and a per-row detail fetch, but the server deliberately refuses archiving and the client hooks point at missing routes or ids.
- **Actors & access:** Manager+.
- **UX & screens:** Header "Archive" button (`#mh-archive-btn`) has no click handler; the JS binds to `#mh-archive` which does not exist. Row checkboxes and select-all render but drive nothing. The JS also references `#d-resend`, `#d-copy-id`, `#mh-clear-filters`, all absent from the markup.
- **Endpoints:**

  | Method + URI                    | Route name                     | Controller@action                  | Middleware | Request                | Response                                                                                                                                                                   |
  | ------------------------------- | ------------------------------ | ---------------------------------- | ---------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `POST /message-history/archive` | `user.message-history.archive` | `MessageHistoryController@archive` | manager+   | JSON `ids[]` (ignored) | always `422 {ok:false, message:"Archive is not supported on the unified history view — open the specific source page (Team inbox, Campaigns) to manage individual rows."}` |

- **Data:** None.
- **Rules & edge cases:**
  1. The route comments state per-row `show` and `resend` routes were removed because their controller methods did not exist; the JS still requests `GET /message-history/{id}` and `POST /message-history/{id}/resend`, which 404.
  2. `presentDetail` hard-codes `canResend=false`.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given any request body, When `POST /message-history/archive` is called, Then it returns 422 with the not-supported message.
  - Given a row click, When the detail fetch 404s, Then the UI keeps the optimistic detail without an error toast.
- **Source refs:** app/Http/Controllers/MessageHistoryController.php (archive); routes/web.php (message-history group); resources/js/charts/user-message-history-index.js; resources/views/user/message-history/index.blade.php.
- **Port notes:** Do not port the button, the checkboxes or the stub route. If bulk actions are wanted, implement them on the source-specific screens.

### WD-CHAT-043 — Device-scoped message stream for the device detail page

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CHAT-038, WD-WADEV
- **Summary:** `UnifiedMessageStream::paginateForDevice` and `countsForDevice` give `/devices/{id}` a message log and per-source counts limited to one connected number.
- **Actors & access:** Consumed by `DevicesController::show` (device pages are documented in WD-WADEV); callers enforce access.
- **UX & screens:** Device detail: message list with source filter pills and counts, direction filter including `fail`, free-text search (WD-WADEV describes the screen).
- **Endpoints:** None in this domain.
- **Data:** Sources limited to `inbox`, `auto_reply`, `campaign`, `scheduled`, `legacy`; `broadcast` is excluded on purpose because broadcasts fan out over every number and have no `device_id`.
- **Rules & edge cases:**
  1. Conversation-based sources use `conversations.device_id = device`; auto-reply via `keyword_replies.device_id`; campaigns via `wpcampaigns.device_id`; scheduled via `scheduled_messages.device_id`. Each also filters on the engine of the device's workspace (`WorkspaceEngine::for`) so a Baileys phone never shows WABA history.
  2. Same 200-per-source cap, PHP sorting, page-size clamp 5..100 and `q`/direction filters as the workspace stream; here `direction='fail'` is supported (outbound failed/error).
  3. `countsForDevice` returns per-source counts plus `total`, not engine-filtered and not capped.
  4. Device ids collide with `wa_provider_configs` ids in `conversations.device_id` (WD-CHAT-002 rule 3), so a Baileys device can pick up a WABA conversation with the same numeric id (QUIRK).
- **Async & events:** None.
- **External systems:** None.
- **Settings:** Engine set of the device's workspace.
- **Acceptance criteria:**
  - Given a device with inbox, campaign and scheduled rows, When paginateForDevice is called, Then the union is sorted newest-first and excludes broadcasts.
  - Given `direction=fail`, When called, Then only failed/error outbound rows return.
  - Given counts for the device, When countsForDevice is called, Then `total` equals the sum of the five sources.
- **Source refs:** app/Services/UnifiedMessageStream.php (paginateForDevice, countsForDevice, pull*ForDevice); app/Http/Controllers/DevicesController.php (show).
- **Port notes:** With a real `channel_id` on conversations and messages this is a `WHERE channel_id = ?` on the same read model.

### WD-CHAT-044 — Toast notifications and flash messages (`wa-toaster`)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** –
- **Summary:** A global toaster used across the app. Quick Send uses its own local `#toast` for most messages and the global one for the AI drawer and message-menu variants.
- **Actors & access:** Any page including `resources/js/app.js`.
- **UX & screens:** Bottom-right stack; variants success, error, warn, info with icons and palettes; optional title; dismiss "×" button; slide/fade in and out; default lifetime 3000 ms, `duration: 0` = sticky. API: `showToast(message, {variant, duration, title})` and `window.WaToaster.{show,success,error,warn,info}`. Server flashes: a `<meta name="wa-flash" content='{"variant":"…","message":"…"}'>` tag in the layout is turned into a toast on load. Messages are HTML-escaped.
- **Endpoints:** None.
- **Data:** None.
- **Rules & edge cases:**
  1. The chat page's own `showToast(text, tone)` (local helper) is a separate implementation; both exist.
  2. Ownership: the shared shell domain (WD-ASHELL) owns this asset; it is listed here because Quick Send calls `window.WaToaster`.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given `WaToaster.success('Saved.')`, When called, Then a green toast shows for 3 s and can be dismissed.
  - Given a `wa-flash` meta with a message, When the page loads, Then it appears as a toast.
  - Given `duration: 0`, When shown, Then it stays until dismissed.
- **Source refs:** resources/js/wa-toaster.js; resources/views/components/layouts/user.blade.php (wa-flash meta); resources/js/charts/user-chat-index.js (showToast).
- **Port notes:** Use the UI kit's toast (sonner or equivalent); route server flash messages through the API error envelope rather than meta tags.

## Data model

Row volumes in the reference: `messages` grows with every chat/API/mobile/extension send (one row per recipient message); `conversations` has one row per customer number (shared with Team Inbox). Both are unpartitioned single tables in MySQL. The seeded reference database holds only demo rows (6 conversations and 10 messages with NULL `workspace_id`, all `origin='chat'`).

### `messages`

Purpose: outbound (and some legacy inbound) message log for Quick Send, mobile quick-message, extension and widget writers. Read by Quick Send, Message History (`legacy` source), dashboards, device pages, dispatcher usage counting. Written by ChatController, `Api\App\QuickMessageController`, `ExtensionApiController`, `ChatbotWidgetPublicController`, `WaOrderController`, `WaInboundController` (reads for dedupe), receipts endpoint. Features: WD-CHAT-003/004/007/008/009/011/012/014/018-027/030/036.

| Column                                                    | Type / default                                             | Behavior                                                                                                                                                                                                                                                |
| --------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                      | bigint PK                                                  | –                                                                                                                                                                                                                                                       |
| `conversation_id`                                         | bigint null, FK → `conversations` ON DELETE CASCADE        | null for conversation-less API sends                                                                                                                                                                                                                    |
| `workspace_id`                                            | bigint null, FK → `workspaces` ON DELETE SET NULL, indexed | tenant key; NULL only on legacy rows (visible to `user_id` owner)                                                                                                                                                                                       |
| `user_id`                                                 | bigint null, indexed                                       | sender (workspace member); usage counting sums by member ids                                                                                                                                                                                            |
| `agent_id`, `contact_id`, `template_id`                   | bigint null, indexed                                       | AI agent attribution, contact link, template used (`template_id` set by template send)                                                                                                                                                                  |
| `direction`                                               | varchar(8) `out`                                           | `out` \| `in`                                                                                                                                                                                                                                           |
| `to_number`, `from_number`                                | text null, **encrypted**                                   | recipient as typed; sender device digits (or provider id if sender empty)                                                                                                                                                                               |
| `body`                                                    | text null, **encrypted**                                   | plain text / caption / resolved template body                                                                                                                                                                                                           |
| `media_path`                                              | varchar(255) null                                          | key on the media disk, format `chat-media/<rand10>__<sanitized name>`; may hold an absolute URL for template header overrides                                                                                                                           |
| `media_type`                                              | varchar(16) null                                           | `image`, `video`, `audio`, `document`, `location`                                                                                                                                                                                                       |
| `latitude`, `longitude`                                   | decimal(10,7) null                                         | location pin                                                                                                                                                                                                                                            |
| `status`                                                  | varchar(16) `pending`                                      | `pending`, `scheduled`, `sent`, `delivered`, `read`, `failed` (indexed)                                                                                                                                                                                 |
| `failure_reason`                                          | text null, **encrypted**                                   | provider/dispatcher error                                                                                                                                                                                                                               |
| `pinned`, `starred`                                       | tinyint(1) 0                                               | operator flags (indexes absent on this table)                                                                                                                                                                                                           |
| `reaction`                                                | varchar(16) null                                           | single emoji                                                                                                                                                                                                                                            |
| `quality_score` (tinyint u), `quality_note` (varchar 191) | null                                                       | AI quality rating (other domain)                                                                                                                                                                                                                        |
| `meta`                                                    | text null → JSON array                                     | template payload (`template_id`, `template_name`, `category`, `template_type`, `carousel_data`, `buttons`, `header`, `footer`, `header_location`, `otp_code`, `template_vars`, `header_media_url`), `wa_message_id`, `target_jid`, `ptt`, `mirrored...` |
| `scheduled_at`, `sent_at`, `delivered_at`, `read_at`      | timestamp null                                             | `scheduled_at` indexed                                                                                                                                                                                                                                  |
| `provider`                                                | varchar(16) null, indexed                                  | engine stamp: `baileys`\|`waba`\|`twilio`                                                                                                                                                                                                               |
| `created_at`, `updated_at`, `deleted_at`                  | timestamp null                                             | soft delete                                                                                                                                                                                                                                             |

Indexes: `conversation_id`, `user_id`, `contact_id`, `template_id`, `status`, `scheduled_at`, `agent_id`, `workspace_id`, `provider`. Note there is NO index on `meta`; receipt matching on `meta->wa_message_id` is a JSON scan (a port should use a `provider_message_id` column with a unique index).

### `conversations`

Purpose: the thread. Quick Send treats it as a "queue"; Team Inbox treats it as a ticket. Chat-relevant columns first; inbox lifecycle columns are owned by WD-TIB1/WD-TIB2 and are listed for completeness. Features: WD-CHAT-002/003/004/006/013/016/017/021/034.

| Column                                                                                                                                                                                                                                                                                                                                                                                                                                              | Type / default               | Behavior                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                                                                                                                                                                                                                                                                                                                                                                                                                | bigint PK                    | –                                                                                                                                                  |
| `user_id`                                                                                                                                                                                                                                                                                                                                                                                                                                           | bigint null                  | creator ("who started it"), not a visibility filter                                                                                                |
| `workspace_id`                                                                                                                                                                                                                                                                                                                                                                                                                                      | bigint null, indexed         | tenant key; NULL legacy rows visible only to `user_id`                                                                                             |
| `device_id`                                                                                                                                                                                                                                                                                                                                                                                                                                         | bigint null, indexed         | `devices.id` (Baileys) or `wa_provider_configs.id` (WABA/Twilio): ids collide                                                                      |
| `contact_group_id`                                                                                                                                                                                                                                                                                                                                                                                                                                  | bigint null                  | group used at creation (group mode only)                                                                                                           |
| `raw_jid`, `alt_jid`                                                                                                                                                                                                                                                                                                                                                                                                                                | varchar(191) null            | JID/phone in any shape (`digits`, `@s.whatsapp.net`, `@lid`, `@g.us`, `ig:`, `fb:`, `email:` keys); `alt_jid` indexed                              |
| `contact_digits`                                                                                                                                                                                                                                                                                                                                                                                                                                    | varchar(32) null             | normalized identity (digits; `g:` prefix for groups); model hook keeps it in step with `raw_jid`/`alt_jid`; indexed with `workspace_id`            |
| `contact_id`                                                                                                                                                                                                                                                                                                                                                                                                                                        | bigint null                  | direct contact link for non-phone threads                                                                                                          |
| `title`                                                                                                                                                                                                                                                                                                                                                                                                                                             | text, **encrypted**          | display name; Quick Send sets it to the recipient digits                                                                                           |
| `preview`                                                                                                                                                                                                                                                                                                                                                                                                                                           | text null, **encrypted**     | last message snippet                                                                                                                               |
| `status`                                                                                                                                                                                                                                                                                                                                                                                                                                            | varchar(16) `pending`        | send-queue status: `pending`, `sent`, `failed`, `scheduled` (+ derived `partial`, missing from the model constant)                                 |
| `platform`                                                                                                                                                                                                                                                                                                                                                                                                                                          | varchar(8) `W`               | legacy code `W` Baileys, `WB` WABA, `T` Twilio (historically mis-stamped, do not trust)                                                            |
| `provider`                                                                                                                                                                                                                                                                                                                                                                                                                                          | varchar(16) `baileys`        | canonical engine; indexed with workspace                                                                                                           |
| `channel`                                                                                                                                                                                                                                                                                                                                                                                                                                           | varchar(16) `whatsapp`       | `whatsapp` or engine-agnostic channel (`chatbot_widget`, `instagram`, `facebook`, `tiktok`, `telegram`, `line`, `wechat`, `viber`, `sms`, `email`) |
| `origin`                                                                                                                                                                                                                                                                                                                                                                                                                                            | varchar(16) `chat`           | where the thread started: `chat`, `inbox`, `chatbot`, `quick`, `bulk` (campaign); Quick Send lists `chat`, `inbox`, `chatbot`                      |
| `archived`                                                                                                                                                                                                                                                                                                                                                                                                                                          | tinyint(1) 0                 | shared with Team Inbox                                                                                                                             |
| `pinned_at`, `muted_at`                                                                                                                                                                                                                                                                                                                                                                                                                             | timestamp null               | conversation-level pin/mute (Team Inbox)                                                                                                           |
| `recipients_count`                                                                                                                                                                                                                                                                                                                                                                                                                                  | int u 0                      | Quick Send sets 1 per number (legacy bulk queues could be > 1)                                                                                     |
| `last_message_at`                                                                                                                                                                                                                                                                                                                                                                                                                                   | timestamp null, indexed      | list ordering                                                                                                                                      |
| `scheduled_at`, `scheduled_timezone`                                                                                                                                                                                                                                                                                                                                                                                                                | timestamp / varchar(64) null | schedule of the queue / IANA zone chosen                                                                                                           |
| `customer_language`                                                                                                                                                                                                                                                                                                                                                                                                                                 | varchar(12) null             | detected language (translation feature)                                                                                                            |
| `inbox_status` (`open`), `priority` (`normal`)                                                                                                                                                                                                                                                                                                                                                                                                      | varchar                      | inbox lifecycle (WD-TIB1); enums `open,pending,snoozed,resolved,closed,spam` / `low,normal,high,urgent`                                            |
| `assignee_user_id`, `assignee_team_id`, `assignee_agent_id`, `first_response_at`, `snoozed_until`, `resolved_at`, `resolved_by`, `resolved_by_agent_id`, `sla_policy_id`, `sla_first_response_due`, `sla_resolution_due`, `sla_breached`, `is_spam`, `routing_meta` (json), `escalation_due_at`, `escalation_action` (json), `last_inbound_at`, `last_outbound_at`, `unread_count`, `interested_sku`, `interested_product_id`, `interested_seen_at` | various                      | owned by WD-TIB1 / WD-TIB2 / WD-CAT; not written by Quick Send                                                                                     |
| `created_at`, `updated_at`                                                                                                                                                                                                                                                                                                                                                                                                                          | timestamp null               | no soft delete                                                                                                                                     |

Notable indexes: `(workspace_id, contact_digits)`, `(workspace_id, provider)`, `(workspace_id, archived, inbox_status, last_message_at)`, `(user_id, archived, status)`, `(workspace_id, unread_count)`, plus single-column indexes on device, group, origin, channel, alt_jid. FKs pointing at `conversations`: `messages` (cascade), `inbox_messages` (cascade), `wa_form_submissions`, `chatbot_widget_visitors`, `ai_call_logs` (set null). Related pivot `conversation_tag` (unique `(conversation_id, tag_id)`) is not claimed here.

### `conversation_events`

Append-only audit of inbox lifecycle changes (`id`, `conversation_id`, `workspace_id`, `actor_user_id` null, `actor_type` `user`|`system`|`platform_admin` default `user`, `type` varchar(32), `payload` JSON, `created_at` default now). Types seen: `reopened`, `snoozed`, `auto_unsnoozed`, `priority_changed`, `tag_added`, `tag_removed`, `note_added`, `spam_flagged` and assignment/status types from `ConversationEvent::record`. No FK, so rows survive conversation delete. Written by Team Inbox / inbox commands only; Quick Send never writes it (WD-CHAT-017 leaves orphans). Behavior owned by WD-TIB1.

### `conversation_notes`

Internal notes (`conversation_id`, `workspace_id`, `user_id`, `body` **encrypted**, `mentions` JSON, `is_pinned`, `edited_at`, soft delete). Written by Team Inbox. No FK; orphaned on conversation delete. Behavior owned by WD-TIB1.

### `conversation_participants`

Per-user follow/unread state (`conversation_id`, `workspace_id`, `user_id`, `role` `assignee`|`watcher`|`mentioned`|`follower` default `watcher`, `last_read_at`, `unread_messages`, `unread_mentions`; unique `(conversation_id, user_id)`). Written by Team Inbox notification dispatch. Behavior owned by WD-TIB1.

## Cross-domain contracts

Consumes:

- **WD-WADEV**: `WorkspaceEngine::enginesFor / senders / senderForKey / for` (which engines and numbers a workspace may send from; composite `engine:id` keys), `Device` and `wa_provider_configs` rows, `WhatsAppDispatcher::send / schedule / reaction / pin / star` (returns `{ok, provider_id, error, platform, local_only}`; provider resolution; Node endpoints `/api/send-message`, `/api/send-media-message`, `/api/send-media-only`, `/api/send-location`, `/api/schedule-message`, `/api/send-reaction`, `/api/pin-message`, `/api/star-message`). Recommended owner of `app/Services/WhatsAppDispatcher.php`, which is not claimed by this file.
- **WD-NODE / WD-WABA**: Node bridge status handler posting to `/api/chat/message-status`; WABA and Twilio status webhooks for the other engines.
- **WD-WALLET / WD-PLAN**: `OverflowBilling::consumeOne` (send-time gate, legacy mode), `MessageBillingService::settleDelivered` (delivery-time charge, key = provider message id), `PlanLimitGuard::hasFeature('multipledevice')`, `PlanLimitReachedException`, `SendGate::halted / screen` (emergency halt and guardrails).
- **WD-TIB1**: `ConversationResolver::find` (one thread per number), shared `conversations` row and `archived` flag, `inbox_messages` mirror target, inbox lifecycle columns.
- **WD-TPL**: `WaTemplate::approved / effectiveCategory / sendMeta`, `TemplateOverrideResolver`, `BroadcastsController::varsForRecipient` (variable resolution), shared `template-live-mapping.js` panel.
- **WD-CON**: `Contact::rememberPhone`, contact groups (`contact_group` JSON array on contacts), `FlowEnrollmentService::onContactCreated`.
- **WD-AIADM**: `AiAgentService::callProvider`, `AiKeyResolver`, `AdminAiKeyController::MODELS`.
- **WD-SET**: `media_disk() / media_storage() / media_url()`, admin `default_timezone`, `baileys_server_url`, `allowed_send_methods`, `default_send_method`, `wallet_billing_on_delivery`, node token.
- **WD-ASHELL / WD-RBAC / WD-WSP**: `x-layouts.user`, `EnsureWorkspaceRole` and the role hierarchy, `wa-toaster.js`.
- **WD-BCAST / WD-CAMP / WD-SCHED / WD-AR**: tables read by `UnifiedMessageStream` (`broadcast_contacts`, `wp_campaign_contacts`, `scheduled_messages`, `keyword_reply_logs`).

Exposes:

- `messages` / `conversations` tables and models to WD-TIB1, WD-TIB2, WD-DASH (`UserPagesController` KPI queries on `messages`), WD-WADEV (device stats), WD-MOB (`Api\App\ChatController`, `Api\App\QuickMessageController` implement the mobile counterpart of Quick Send and Message History on the same tables), WD-EXT (`Api\ExtensionApiController@messageHistory / sendQuickMessage`), WD-WGT and WD-CAT / WD-CHK (writers of `messages`).
- `UnifiedMessageStream::paginate / counts / paginateForDevice / countsForDevice` to `MessageHistoryController` and `DevicesController@show`.
- `POST /api/chat/message-status` (Node → Laravel receipt) to WD-NODE.
- `Message::withoutInboxMirror(callable)` and the inbox mirror observer to every message writer.
- `x-wa-editor` component and `wa-editor.js` to any composer that wants the WhatsApp markup toolbar.

## Open questions & quirks

Ownership / boundaries

- Routes deliberately left to other domains: `api/app/chats*`, `api/app/quick-message/*`, `api/app/send-quick-message`, `api/app/bulk-delete`, `api/app/groups/{jid}/open-chat` (WD-MOB, same tables, served by `Api\App\ChatController`, `QuickMessageController` and `GroupController`); `api/message-history`, `api/send-quick-message` (WD-EXT); `team-inbox/api/messages/{id}/extract-contact` and `.../retry-media` (WD-TIB1); `team-inbox/api/team-chat*` and `team-chat` (WD-TCHAT); `chatbot-widgets*`, `widget/{token}/chat`, `widget/{token}/api/message` (WD-WGT); `wechat*` and `api/wechat/*` (WD-WECH); `quick-access` and `app/Support/QuickAccess.php` (dashboard shortcut tiles, WD-DASH, not "quick messages"); `Api\V1\MessageController` / `ConversationController` (WD-API).
- `WhatsAppDispatcher` (1 412 lines) is central to every send but appears in no coverage block yet; propose WD-WADEV. Only its send/schedule/reaction/pin/star contract and Node payload shapes are described here.
- `conversation_events`, `conversation_notes`, `conversation_participants` and their models are claimed here only because the domain assignment lists them under the conversation models; their behavior is Team Inbox behavior (WD-TIB1/TIB2). `conversation_tag` is intentionally not claimed. `InboxMessage` is not claimed (WD-TIB1).
- `MessageCharge` / `MessageRate` models and tables belong to WD-WALLET.

Docs vs code

- Docs say retry, resend and send-now re-attempt delivery; the code only rewrites statuses (WD-CHAT-018/019/020).
- Docs say a failed forward/send refunds the credit; there is no refund logic in the controller (billing is at delivery, or plan-first in legacy mode).
- Docs say the compose box autocompletes numbers; the endpoint exists but no UI calls it (WD-CHAT-030).
- Docs say AI assist is available from the thread header; the front-end guard makes it unreachable (WD-CHAT-029).
- Docs describe the History device filter, full-range KPIs and full-range CSV; the device filter is ignored and KPIs/export are computed from at most 100 rows (WD-CHAT-039/040/041).
- Docs say "Chat shows only the active engine's conversations"; actual rule is the enabled-engine set plus connected official numbers plus engine-agnostic channels (WD-CHAT-034).
- Docs list "Sent/Pending/Failed" filters; a derived `partial` status exists with no filter (WD-CHAT-002/013).

Behaviors that look like bugs (unverified at runtime, static analysis only)

- Chat-created messages never store the WhatsApp message id, which breaks receipts, pin/star/react targeting and echo de-duplication (WD-CHAT-012/014/023/035).
- A message scheduled from Quick Send is never moved out of `scheduled` by any callback (WD-CHAT-006).
- Scheduled time is re-parsed in the app timezone after conversion to a UTC string; if `APP_TIMEZONE` is not UTC the stored instant may shift.
- Group compose and the group list are not tenant scoped (WD-CHAT-004); unsubscribed contacts are not excluded from group sends.
- The required queue name is discarded (WD-CHAT-004); `device_id` mixes two id spaces (WD-CHAT-002).
- Deleting a queue cascades into the Team Inbox history and leaves orphan notes/events/participants (WD-CHAT-017); archiving also hides the thread in the Team Inbox (WD-CHAT-016).
- Reply-to is UI-only (WD-CHAT-028); "Send to all/selected" are stubs (WD-CHAT-033); the fixed quick-reply chip contains an unsubstituted `{{name}}` (WD-CHAT-031).
- Message History AJAX layer is bound to missing element ids; direction/bucket tab clicks reset range/search/type/device (WD-CHAT-039); Location type is unreachable; each Quick Send message appears twice (Direct send + Team inbox) in the unified stream (WD-CHAT-035/038).
- Legacy send-time usage counting doubles chat sends because of the mirror (WD-CHAT-012).
- Synchronous per-recipient dispatch inside the HTTP request (up to 40/90 s each) can time out on large groups (WD-CHAT-004).
- `local_only` dispatch results are stored as `sent` although nothing left the platform (WD-CHAT-012).
- Authentication OTP is stored in message meta in clear (WD-CHAT-011).
- `dispatchMetaCloud` in the dispatcher is documented as unwired dead code (WABA is routed through Node).

Unknowns to confirm during parity checks

- Whether Node's `fromMe` echo for a Quick Send duplicates the bubble in the Team Inbox.
- Whether the Node schedule callback ever reaches `messages` rows.
- Exact behavior of `SendGate::screen` guardrails (rate caps, content filters) on chat sends (WD-CORE / WD-ASHELL).
- Whether `wallet_billing_on_delivery` is ever set to 0 in production installs (which switches on the 402 path).

## Coverage

```json wadesk-coverage
{
  "routes": [
    "GET chat",
    "GET chat/api/conversations",
    "POST chat/api/conversations",
    "GET chat/api/conversations/{id}",
    "DELETE chat/api/conversations/{id}",
    "GET chat/api/conversations/{id}/details",
    "POST chat/api/conversations/{id}/messages",
    "POST chat/api/conversations/{id}/template",
    "POST chat/api/conversations/{id}/archive",
    "POST chat/api/conversations/{id}/unarchive",
    "POST chat/api/conversations/{id}/send-now",
    "POST chat/api/conversations/{id}/retry",
    "POST chat/api/conversations/{id}/resend",
    "POST chat/api/conversations/{id}/ai",
    "GET chat/api/conversations/{c}/messages/{m}/info",
    "POST chat/api/conversations/{c}/messages/{m}/react",
    "PATCH chat/api/conversations/{c}/messages/{m}/pin",
    "PATCH chat/api/conversations/{c}/messages/{m}/star",
    "DELETE chat/api/conversations/{c}/messages/{m}",
    "POST chat/api/conversations/{c}/messages/{m}/forward",
    "GET chat/api/templates",
    "GET chat/api/search-numbers",
    "POST api/chat/message-status",
    "GET message-history",
    "POST message-history/archive",
    "GET message-history/export"
  ],
  "controllers": [
    "app/Http/Controllers/ChatController.php",
    "app/Http/Controllers/MessageHistoryController.php"
  ],
  "services": ["app/Services/UnifiedMessageStream.php"],
  "models": [
    "Message",
    "Conversation",
    "ConversationEvent",
    "ConversationNote",
    "ConversationParticipant"
  ],
  "tables": [
    "messages",
    "conversations",
    "conversation_events",
    "conversation_notes",
    "conversation_participants"
  ],
  "views": [
    "resources/views/user/chat/index.blade.php",
    "resources/views/user/message-history/index.blade.php",
    "resources/views/user/message-history/_rows.blade.php",
    "resources/views/components/wa-editor.blade.php"
  ],
  "commands": [],
  "permissions": [],
  "middleware": [],
  "node_files": [],
  "js_assets": [
    "resources/js/charts/user-chat-index.js",
    "resources/js/charts/user-message-history-index.js",
    "resources/js/wa-editor.js",
    "resources/js/wa-toaster.js"
  ],
  "misc_files": [],
  "config_files": [],
  "doc_pages": [
    "Documentation/pages/messaging/chat.html",
    "Documentation/pages/messaging/message-history.html"
  ],
  "feature_map": {
    "WD-CHAT-001": ["GET chat"],
    "WD-CHAT-002": ["GET chat/api/conversations"],
    "WD-CHAT-003": ["GET chat/api/conversations/{id}"],
    "WD-CHAT-004": ["POST chat/api/conversations"],
    "WD-CHAT-005": [],
    "WD-CHAT-006": [],
    "WD-CHAT-007": ["POST chat/api/conversations/{id}/messages"],
    "WD-CHAT-008": [],
    "WD-CHAT-009": [],
    "WD-CHAT-010": ["GET chat/api/templates"],
    "WD-CHAT-011": ["POST chat/api/conversations/{id}/template"],
    "WD-CHAT-012": [],
    "WD-CHAT-013": [],
    "WD-CHAT-014": ["POST api/chat/message-status"],
    "WD-CHAT-015": [],
    "WD-CHAT-016": [
      "POST chat/api/conversations/{id}/archive",
      "POST chat/api/conversations/{id}/unarchive"
    ],
    "WD-CHAT-017": ["DELETE chat/api/conversations/{id}"],
    "WD-CHAT-018": ["POST chat/api/conversations/{id}/retry"],
    "WD-CHAT-019": ["POST chat/api/conversations/{id}/resend"],
    "WD-CHAT-020": ["POST chat/api/conversations/{id}/send-now"],
    "WD-CHAT-021": ["GET chat/api/conversations/{id}/details"],
    "WD-CHAT-022": ["GET chat/api/conversations/{c}/messages/{m}/info"],
    "WD-CHAT-023": ["POST chat/api/conversations/{c}/messages/{m}/react"],
    "WD-CHAT-024": ["PATCH chat/api/conversations/{c}/messages/{m}/pin"],
    "WD-CHAT-025": ["PATCH chat/api/conversations/{c}/messages/{m}/star"],
    "WD-CHAT-026": ["DELETE chat/api/conversations/{c}/messages/{m}"],
    "WD-CHAT-027": ["POST chat/api/conversations/{c}/messages/{m}/forward"],
    "WD-CHAT-028": [],
    "WD-CHAT-029": ["POST chat/api/conversations/{id}/ai"],
    "WD-CHAT-030": ["GET chat/api/search-numbers"],
    "WD-CHAT-031": [],
    "WD-CHAT-032": [],
    "WD-CHAT-033": [],
    "WD-CHAT-034": [],
    "WD-CHAT-035": [],
    "WD-CHAT-036": [],
    "WD-CHAT-037": [],
    "WD-CHAT-038": [],
    "WD-CHAT-039": ["GET message-history"],
    "WD-CHAT-040": [],
    "WD-CHAT-041": ["GET message-history/export"],
    "WD-CHAT-042": ["POST message-history/archive"],
    "WD-CHAT-043": [],
    "WD-CHAT-044": []
  }
}
```
