---
domain: flow-builder-editor
code: FLB
title: Flow Builder, Editor and Node Catalogue
wadesk_version: '1.7.0'
sources_read: 120
---

# Flow Builder, Editor and Node Catalogue

## Overview

Flows are WaDesk's visual chatbot / automation graphs. A workspace admin designs a graph of nodes joined by connectors on a drag-and-drop canvas (a React app mounted from `resources/js/charts/user-flows-builder.js`, about 5,100 lines, written with htm + React and served from the Blade shell `user/flows/builder.blade.php`). One node is the Trigger (how a contact enters the flow); every other node either sends something, waits for the customer, branches, calls an outside system or changes CRM data. Saving stores the whole graph as one encrypted JSON blob on the `flows` row and mirrors a few trigger fields into plain columns so the platform can find "which flows want this tag / group / event" without decrypting anything. Publishing makes a flow live; pausing keeps the design but stops enrolment.

This domain (FLB) owns: the flows list, the builder UI and its save/publish/import/export/duplicate/delete/rename actions, the admin-curated template gallery, the AI flow generator, the trigger configuration and its denormalised columns, the CATALOGUE of every node type (config schema, defaults, output ports, per-channel availability, builder-side validation), the builder's picker/reference-data endpoints, the node-side callback endpoints the Node runtime calls when specific node types fire (tag, assign, deal, MySQL, AI call, Meet, Sheets/Docs/Forms, WhatsApp Form, commerce, ordering, call-flow), audience/event enrolment (`FlowEnrollmentService`), and the run-monitoring screens (subscribers, analytics, error logs, retry). It does NOT own execution semantics (session handling, port routing at runtime, waits, 1-hour reply window, per-engine rendering on Baileys / WABA / Twilio, LINE / Telegram / etc. runners). Those are FLR (flow-runtime-engine). Where a node's behaviour is decided at runtime this file says so and only records what the builder stores and what Laravel callbacks do.

Actors: workspace owner/admin (every `/flows/*` route is behind `workspace.role:admin`; platform admins bypass), the platform super-admin (template gallery at `/admin/flow-templates`), the Node bridge (shared-secret `X-Node-Token` callbacks), Google Apps Script (form submissions) and API clients (see API domain for `/api/v1/flows*`). Agents, viewers and managers cannot open `/flows`; they are redirected to the team inbox. The four seeded permission keys `flows.view/.create/.edit/.delete` exist in the RBAC seeder but NO flows route or controller checks them (role rank only).

Main flow end to end:

1. Admin opens `/flows`, sees KPI cards, the library/status rail, an optional "most-used" featured card, an admin template gallery and a paginated grid (12 per page) of flow cards. Create flow opens a channel sheet (Messaging or Call) and lands on `/flows/builder[?type=call]`; "Use AI prompt" lands on `/flows/builder?ai=1`; Import uploads a `.json`; a template card clones into a new draft.
2. In the builder the admin drags nodes from the palette (filtered by channel), wires ports, configures each node in the right-hand inspector, optionally uses Generate with AI, and tests in the simulator. Save posts `POST flows/api/save` (creates on first save, plan `flow_limit` enforced on create only); the server re-derives `trigger_kind / trigger_value / trigger_device_id / trigger_keywords / provider` from the trigger node, writes the encrypted graph plus a non-public file mirror, and (via a model hook) upserts a managed keyword auto-reply row that actually fires the flow. Publish flips `is_published` and stamps `published_at`.
3. When the runtime needs the graph the Node bridge calls `GET api/flows/{id}` with `X-Node-Token`; `FlowNormalizer` converts the builder's React-style vocabulary into the PascalCase shape the runtime executes. Node callbacks (tag, assign, deal, AI, Sheets, ...) come back to Laravel under `api/flow-node/*`.
4. Contacts enter through keyword matches (via the managed `keyword_replies` row), tag/group/event hooks (`FlowEnrollmentService`), the manual Enroll action, the REST API or webhooks. Each (flow, contact) pair is one `flow_subscribers` row (unique). Analytics reads only that table plus `flow_retry_logs`.

Plan tiers: the only hard gate is the numeric plan limit `flow_limit` on CREATE paths (save-new, import, clone-template, import-IG); duplicate does not check it. The path `flows/*` is covered by the soft in-app paywall keyed to package flag `autoflow` (page renders, an upgrade sheet slides over; JSON endpoints stay callable). Package flags `flow_steps_limit` and `access_flows_commerce` are defined and shown in admin but enforced nowhere. Feature flags on the builder are per channel: Instagram / Facebook / TikTok / Telegram / LINE / WeChat / Viber / Email appear only when the extension/toggle is enabled AND the workspace has a connected account for it.

Connections: FLR (execution, `node/services/flowService.js`, channel runners, `/api/flow/start`), AR (keyword_replies matcher and the managed trigger row, `reply_type=flow`), CON (contacts, tags, groups, attributes picker), TIB1/TIB2 (teams, assignment, ai-agents endpoints the builder reads, conversation tags), AIAG/AIADM/AICRM (AI keys, assistants, chat assistants, training knowledge base, provider calls), CALL (voice assistants, call bridge, `wa_calls`), DEAL (pipelines/stages, deals), APPT (booking types, Google Calendar), CAT/CHK/ECOM (stores, catalog products, checkout-link builders, ordering service, `wa_orders` events), WFL (WhatsApp Forms), TPL (templates listed in the Send template node), IG/FB/TG/TT/LINE/WECH/VIB/MAIL (channel accounts and their runners), INTG (Google OAuth, webhooks), API (`/api/v1/flows*`), MOB (`/api/app/getflows`, `chats/{id}/flow`), PLAN (`flow_limit`, paywall), RBAC (role gate, unused permission keys), NODE (`X-Node-Token`, Node URL), SET (media disk, admin AI keys).

## Feature index

| Id         | Feature                                                             | Status      | Priority | Effort | Depends on |
| ---------- | ------------------------------------------------------------------- | ----------- | -------- | ------ | ---------- |
| WD-FLB-001 | Flows list page with filters, search and pagination                 | implemented | P0       | M      | —          |
| WD-FLB-002 | KPI cards, library rail and featured "most-used" card               | implemented | P2       | S      | WD-FLB-001 |
| WD-FLB-003 | Create-flow channel sheet and builder entry points                  | implemented | P0       | S      | WD-FLB-001 |
| WD-FLB-004 | Pause / resume a flow and the lifecycle state model                 | implemented | P0       | S      | WD-FLB-001 |
| WD-FLB-005 | Rename a flow in place                                              | implemented | P2       | S      | WD-FLB-001 |
| WD-FLB-006 | Duplicate a flow                                                    | implemented | P1       | S      | WD-FLB-001 |
| WD-FLB-007 | Delete a flow                                                       | implemented | P0       | S      | WD-FLB-001 |
| WD-FLB-008 | Export a flow to a portable .json                                   | implemented | P1       | S      | WD-FLB-001 |
| WD-FLB-009 | Import a flow from .json                                            | implemented | P1       | M      | WD-FLB-008 |
| WD-FLB-010 | Start-from-template gallery and clone                               | implemented | P1       | S      | WD-FLB-011 |
| WD-FLB-011 | Admin flow templates: list, visibility toggle, delete               | implemented | P1       | S      | —          |
| WD-FLB-012 | Admin flow template create / edit                                   | implemented | P1       | M      | WD-FLB-011 |
| WD-FLB-013 | Flow categories and the library filter                              | partial     | P2       | S      | WD-FLB-001 |
| WD-FLB-014 | Builder page shell and boot payload                                 | implemented | P0       | M      | —          |
| WD-FLB-015 | Canvas interactions, undo/redo and shortcuts                        | implemented | P0       | L      | WD-FLB-014 |
| WD-FLB-016 | Node palette, search and per-channel availability                   | implemented | P0       | M      | WD-FLB-014 |
| WD-FLB-017 | Node card rendering, ports and handle naming                        | implemented | P0       | M      | WD-FLB-015 |
| WD-FLB-018 | Pre-save graph validation                                           | implemented | P0       | M      | WD-FLB-017 |
| WD-FLB-019 | Save flow (create / update)                                         | implemented | P0       | L      | WD-FLB-018 |
| WD-FLB-020 | Trigger column extraction and sender binding                        | implemented | P0       | M      | WD-FLB-019 |
| WD-FLB-021 | Managed keyword-trigger rule sync                                   | implemented | P0       | M      | WD-FLB-020 |
| WD-FLB-022 | Publish and unpublish                                               | partial     | P0       | S      | WD-FLB-019 |
| WD-FLB-023 | Flow variables modal                                                | dead-code   | P2       | S      | WD-FLB-014 |
| WD-FLB-024 | Test runner (simulate a chat) and webhook test endpoint             | implemented | P1       | M      | WD-FLB-017 |
| WD-FLB-025 | Generate a flow with AI                                             | implemented | P1       | M      | WD-FLB-026 |
| WD-FLB-026 | Builder reference-data endpoints (pickers)                          | implemented | P0       | M      | WD-FLB-014 |
| WD-FLB-027 | Flow media upload and inbound media store                           | implemented | P1       | S      | —          |
| WD-FLB-028 | Plan, role and feature gates for flows                              | implemented | P0       | S      | —          |
| WD-FLB-029 | Flow persistence model (encrypted graph, file mirror, engine stamp) | implemented | P0       | M      | —          |
| WD-FLB-030 | Trigger node                                                        | implemented | P0       | L      | WD-FLB-020 |
| WD-FLB-031 | Send message node                                                   | implemented | P0       | S      | WD-FLB-017 |
| WD-FLB-032 | Send sequence node                                                  | implemented | P1       | M      | WD-FLB-027 |
| WD-FLB-033 | Send media node                                                     | implemented | P0       | S      | WD-FLB-027 |
| WD-FLB-034 | Send template node                                                  | implemented | P0       | M      | WD-FLB-026 |
| WD-FLB-035 | Quick replies (buttons) node                                        | implemented | P0       | M      | WD-FLB-017 |
| WD-FLB-036 | List message node                                                   | implemented | P0       | M      | WD-FLB-017 |
| WD-FLB-037 | Ask question node                                                   | partial     | P0       | M      | WD-FLB-017 |
| WD-FLB-038 | Condition node                                                      | implemented | P0       | M      | WD-FLB-017 |
| WD-FLB-039 | Wait (delay) node                                                   | implemented | P0       | S      | WD-FLB-017 |
| WD-FLB-040 | Webhook node                                                        | implemented | P0       | M      | WD-FLB-024 |
| WD-FLB-041 | Run code (JS) node                                                  | implemented | P2       | S      | WD-FLB-017 |
| WD-FLB-042 | MySQL query node                                                    | implemented | P2       | M      | WD-FLB-017 |
| WD-FLB-043 | AI assistant node                                                   | implemented | P0       | L      | WD-FLB-026 |
| WD-FLB-044 | Tag contact node                                                    | implemented | P0       | S      | WD-FLB-026 |
| WD-FLB-045 | Assign agent node                                                   | implemented | P0       | M      | WD-FLB-026 |
| WD-FLB-046 | Run sub-flow node                                                   | implemented | P1       | S      | WD-FLB-026 |
| WD-FLB-047 | End node                                                            | implemented | P0       | S      | WD-FLB-017 |
| WD-FLB-048 | Call to action (CTA) node                                           | implemented | P1       | M      | WD-FLB-017 |
| WD-FLB-049 | Location node                                                       | implemented | P2       | S      | WD-FLB-017 |
| WD-FLB-050 | Poll node                                                           | implemented | P2       | S      | WD-FLB-017 |
| WD-FLB-051 | Chatbot (AI agent hand-off) node                                    | implemented | P1       | M      | WD-FLB-026 |
| WD-FLB-052 | Commerce nodes: WhatsApp Shop, WooCommerce, Shopify                 | implemented | P1       | XL     | WD-FLB-026 |
| WD-FLB-053 | Book appointment node                                               | implemented | P1       | S      | WD-FLB-026 |
| WD-FLB-054 | AI voice call node                                                  | implemented | P2       | M      | WD-FLB-026 |
| WD-FLB-055 | Google Meet node and Meet endpoints                                 | implemented | P2       | M      | WD-FLB-017 |
| WD-FLB-056 | WhatsApp Form node and send endpoint                                | implemented | P1       | M      | WD-FLB-026 |
| WD-FLB-057 | Google Sheets node                                                  | implemented | P1       | M      | WD-FLB-026 |
| WD-FLB-058 | Google Docs node                                                    | implemented | P2       | M      | WD-FLB-026 |
| WD-FLB-059 | Google Form node, Apps Script and submission webhook                | implemented | P2       | L      | WD-FLB-026 |
| WD-FLB-060 | Create / move deal node                                             | implemented | P1       | M      | WD-FLB-026 |
| WD-FLB-061 | Copy to number node                                                 | implemented | P2       | S      | WD-FLB-017 |
| WD-FLB-062 | Hand off to Instagram node                                          | implemented | P2       | S      | WD-FLB-017 |
| WD-FLB-063 | Call-flow voice nodes and call-flow endpoints                       | implemented | P1       | L      | WD-FLB-016 |
| WD-FLB-064 | Instagram-channel nodes                                             | implemented | P1       | L      | WD-FLB-016 |
| WD-FLB-065 | Facebook Messenger nodes                                            | implemented | P1       | M      | WD-FLB-016 |
| WD-FLB-066 | Telegram payment node                                               | implemented | P2       | S      | WD-FLB-016 |
| WD-FLB-067 | TikTok, LINE, WeChat, Viber and Email flow palettes                 | implemented | P2       | S      | WD-FLB-016 |
| WD-FLB-068 | Natural-language ordering endpoints for flows                       | implemented | P2       | L      | WD-FLB-040 |
| WD-FLB-069 | Node-bridge support endpoints (WABA creds, voice keys, call bridge) | implemented | P1       | M      | —          |
| WD-FLB-070 | Runtime flow fetch and FlowNormalizer contract                      | implemented | P0       | L      | WD-FLB-019 |
| WD-FLB-071 | Audience and event enrolment (FlowEnrollmentService)                | implemented | P0       | L      | WD-FLB-020 |
| WD-FLB-072 | Manual enrolment (UI and API)                                       | implemented | P1       | S      | WD-FLB-071 |
| WD-FLB-073 | Subscribers list and pause / resume                                 | partial     | P2       | S      | WD-FLB-071 |
| WD-FLB-074 | Flow analytics overview                                             | partial     | P1       | L      | WD-FLB-071 |
| WD-FLB-075 | Execution history table                                             | partial     | P1       | M      | WD-FLB-074 |
| WD-FLB-076 | Error logs                                                          | partial     | P1       | M      | WD-FLB-074 |
| WD-FLB-077 | Retry failed runs and retry records                                 | implemented | P1       | L      | WD-FLB-075 |
| WD-FLB-078 | Flow-connected devices                                              | dead-code   | P2       | S      | WD-FLB-029 |
| WD-FLB-079 | Instagram flow import and Instaflow sync                            | implemented | P2       | M      | WD-FLB-064 |
| WD-FLB-080 | Flow showcase seeder (dev fixture)                                  | implemented | P2       | S      | WD-FLB-016 |

## Features

### WD-FLB-001 — Flows list page with filters, search and pagination

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** none
- **Summary:** `/flows` lists every flow in the current workspace as cards, newest-updated first, with status and category filters, name search and 12-per-page pagination, refreshed through AJAX without a full reload.
- **Actors & access:** workspace admin/owner (`workspace.role:admin`; platform admins bypass). Agents, viewers and managers are redirected to `/team-inbox` (agents/viewers) or get 403 (managers). Nav item `flows` (tier admin, plan feature `autoflow`). The whole `/flows*` path sits behind the soft paywall for plan flag `autoflow`.
- **UX & screens:** `resources/views/user/flows/index.blade.php` (`x-layouts.user`, nav key `flows`, JS page id `user-flows-index`). Left rail (Library categories, Status list, help tip), header ("Automated flows", Analytics link, Use AI prompt, Create flow, Import), four KPI cards, top tabs (All flows, Active, Paused, Drafts with counts) plus a search box (placeholder "Search flows..."), optional featured card, optional template gallery, optional remote-Instagram panel with channel tabs, the card grid `#fl-grid`, pagination, three static "Help" tiles and a footer "Showing N of M filtered flows". Cards come from partial `user/flows/_cards.blade.php`; empty state is the shared empty-state partial with copy "No flows match the current filters..." plus Reset and Create flow actions. State (status, category, q, page) lives in `data-fl-*` attributes on `[data-fl-state]` and in the URL via `history.pushState`; browser back re-fetches. Search is debounced 220 ms; a fetch dims the grid to 60% opacity; errors toast "Could not refresh: ...". JS: `resources/js/charts/user-flows-index.js`.
- **Endpoints:**

| Method uri | Route name       | Controller@action     | Middleware                         | Request                                                                                                           | Response                                                                                                                                                      |
| ---------- | ---------------- | --------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET flows  | user.flows.index | FlowsController@index | Authenticate, workspace.role:admin | `status` (all/live/paused/draft, default all), `category` (default all), `q`, `page`, `partial=1`, `refresh_ig=1` | Blade page; with `partial=1` JSON `{ok, cards, featured, statusCounts, categoryCounts, pagination, shown, total, page}` (HTML fragments rendered server-side) |

- **Data:** reads `flows` scoped by `Flow::forCurrentWorkspace()` (rows with `workspace_id` = current workspace, plus legacy rows with NULL workspace owned by the user), with `withCount` of active `flow_connected_devices` and `flow_subscribers` by status active/completed/failed. Ordered by `updated_at` desc. Reads `flow_templates` (`active()->ordered()`), `system_settings.instagram_enabled`.
- **Rules & edge cases:**
  1. Filtering is done in PHP after loading ALL workspace flows: state = `live` (published and active), `paused` (published, not active), `draft` (not published); category compared to `flows.category` as an exact string; name search is a case-insensitive substring on the DECRYPTED `flow_name` (it is an encrypted column so it cannot be filtered in SQL). Page size 12, page number clamped to the last page.
  2. QUIRK: the list deliberately ignores the workspace engine (`forCurrentEngine` is NOT applied) so flows with NULL/other `provider` still show; an earlier engine filter produced "5 flows / No data found".
  3. The status pill is derived, not stored: unpublished always shows Draft even when `is_active` is false.
  4. Card body: category icon or Instagram-gradient icon; badges only for `instagram` and `call` flow types (QUIRK: facebook/telegram/tiktok/line/wechat/viber/email flows get no channel badge); title (`Untitled flow` if blank); one static "purpose" sentence chosen by category (welcome, cart/cart-recovery, post-purchase, re-engagement, lead/lead-nurture, event/special-events, else generic); bullets "N nodes · M edges", trigger label, and either "X active · Y done [· Z failed]" or "Edited <relative time>".
  5. Trigger label mapping only knows tag_added ("Auto · on tag"), group_join ("Auto · on group join"), manual_enroll ("Manual enroll"); every other kind (contact_created, opt_in, order_placed, deal_stage_changed, away, out_of_hours, comment_to_dm) shows "Keyword" (QUIRK).
  6. Per-card actions: Open builder (replaced by an "Enroll contacts" button for `manual_enroll` flows, QUIRK: those flows then have no Open-builder button on the card), Analytics icon (hidden for Instagram flows), Pause/Resume, Rename, Duplicate (POST form), Export (.json link), Delete (confirm dialog "Delete "<name>"? This can't be undone.").
  7. Remote Instaflow mode (see WD-FLB-079): when the workspace has connected Instaflow Instagram accounts and native Instagram is off, an extra Instagram panel and All/WhatsApp/Instagram channel tabs appear; the IG list is cached 120 s per workspace (`flows:ig-list:{ws}`) and `?refresh_ig=1` busts it.
- **Async & events:** none server-side; the JS refetches after toggle / delete / rename / enroll.
- **External systems:** none for the list itself.
- **Settings:** `system_settings.instagram_enabled` (native IG addon), package flag `autoflow` (paywall only).
- **Acceptance criteria:**
  - Given a workspace with 30 flows, when an admin opens `/flows`, then 12 cards render newest-updated first, the footer reads "Showing 12 of 30", and pagination shows 3 pages.
  - Given the Paused tab is clicked, when the list refreshes, then the URL becomes `/flows?status=paused`, only published-but-inactive flows show, and the tab counts do not change.
  - Given the search box contains "wel", when the debounce fires, then only flows whose name contains "wel" (any case) show and the page resets to 1.
  - Given a viewer or agent opens `/flows`, then they are redirected to `/team-inbox` with a warning.
  - Given a flow in another workspace exists, then it never appears in any list, count or featured card.
- **Source refs:** `app/Http/Controllers/FlowsController.php` (index, statusCounts, categoryCounts), `resources/views/user/flows/index.blade.php`, `resources/views/user/flows/_cards.blade.php`, `resources/js/charts/user-flows-index.js`, `app/Models/Flow.php` (scopeForCurrentWorkspace), `app/Http/Controllers/Controller.php` (paginateCollection), `app/Http/Middleware/EnsureWorkspaceRole.php`, `Documentation/pages/automation/flows.html`.
- **Port notes:** new `apps/api/src/modules/flows` + `apps/web/app/(app)/flows`. Do the filter/search in SQL: store a plaintext `name` (or a normalized search column) instead of encrypting it, or use a deterministic blind index, otherwise pagination stays O(all flows). Tenant scoping via RLS on `workspace_id`; drop the "NULL workspace falls back to creator" legacy branch. Return JSON to the client instead of server-rendered HTML fragments. Keep the URL-synced filters.

### WD-FLB-002 — KPI cards, library rail and featured "most-used" card

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-001
- **Summary:** Four KPI tiles (Active flows, Total flows, Drafts, Paused), a Library rail with per-category counts, a Status rail with per-state counts and a large featured card for the workspace's "most-used" flow.
- **Actors & access:** same as WD-FLB-001.
- **UX & screens:** KPI cards read `statusCounts` (live/all/draft/paused). Library rail entries (fixed list): All flows, Cart abandonment (`cart`), Welcome (`welcome`), Post-purchase (`post-purchase`), Re-engagement (`re-engagement`), Special events (`event`), Lead nurture (`lead`), each with a count. Status rail: Live, Paused, Draft. Featured card (`_featured.blade.php`): category pill, "Most used" pill, Live/Draft pill, name, stats row (steps, messages, total wait, connections), "Updated <relative>" sentence, Open flow and Duplicate buttons, and a right-hand mini preview of up to 4 nodes (styled by type: start, send, wait, condition, tag, end). Empty graph shows "This flow has no nodes yet. Open the builder to add steps."
- **Endpoints:** rendered by `GET flows` (see WD-FLB-001); counts and the featured HTML are also returned in the `partial=1` JSON.
- **Data:** `statusCounts` = counts over all workspace flows (live = published+active, paused = published+inactive, draft = unpublished); `categoryCounts` = group-by `COALESCE(category,'uncategorized')` plus an `all` total. Both ignore the current filters.
- **Rules & edge cases:**
  1. "Most used" is a misnomer: `mostUsedFlow()` picks the flow ordered by `is_published` desc, `is_active` desc, `updated_at` desc, falling back to any flow. No usage metric is involved.
  2. The featured card is shown regardless of active filters/search and is re-rendered on every partial refresh.
  3. Message count = nodes of type message/template/media/buttons/list/cta. Wait total sums delay nodes converted to minutes (sec -> max(1, floor(amount/60)), hour x60, day x1440, default minutes) and prints "~N min" or "~N.N h total", else "no waits".
  4. The Condition node label in the mini preview reads legacy `var/op/value` fields, so new-shape conditions show "If value == " (QUIRK).
  5. The rail lists exactly seven fixed keys; a flow whose category is e.g. `cart-recovery` still gets card styling but is not counted under the rail's `cart` entry.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 3 live, 2 paused and 4 draft flows, when `/flows` loads, then the tiles show Active 3, Total 9, Drafts 4, Paused 2.
  - Given a flow with two delay nodes (30 min and 2 hours), when it is featured, then the wait label reads "~2.5 h total".
  - Given no flows exist, then the featured card is absent and the grid shows the empty state.
- **Source refs:** `app/Http/Controllers/FlowsController.php` (mostUsedFlow, statusCounts, categoryCounts), `resources/views/user/flows/_featured.blade.php`, `resources/views/user/flows/index.blade.php`.
- **Port notes:** cheap to rebuild; compute counts with `GROUP BY`. Consider replacing the fake "most used" with a real usage signal (subscriber count) and say so, since parity with the misnomer is not valuable.

### WD-FLB-003 — Create-flow channel sheet and builder entry points

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-001
- **Summary:** A single "Create flow" button opens a sheet with two choices (Messaging flow, Call). The builder itself is one canvas; the channel decides the palette and the persisted `flow_type`. Other entry points: `?ai=1`, `?ai_prompt=`, `?test=1` and `?id=`.
- **Actors & access:** workspace admin.
- **UX & screens:** modal `[data-flow-channel-modal]` in `index.blade.php`: "What kind of flow?" with link 1 `Messaging flow` -> `/flows/builder` ("WhatsApp, Instagram, or Facebook — switch channel on the Trigger node") and link 2 `Call` -> `/flows/builder?type=call` ("AI voice IVR — say, listen, transfer"). Closes on Cancel, backdrop click or Escape. Header link "Use AI prompt" opens `/flows/builder?ai=1`. Dashboard Copilot cards deep-link with `?ai_prompt=...` to prefill the generator. `?test=1` opens the Test panel on load.
- **Endpoints:**

| Method uri             | Route name              | Controller@action       | Middleware                         | Request                                                                                                                                 | Response                                |
| ---------------------- | ----------------------- | ----------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| GET flows/builder      | user.flows.builder      | FlowsController@builder | Authenticate, workspace.role:admin | `type` (call/instagram/facebook/tiktok/telegram/line/wechat/viber/email, else chat), `id` (fallback flow id), `ai`, `ai_prompt`, `test` | Blade builder view                      |
| GET flows/builder/{id} | user.flows.builder.edit | FlowsController@builder | same                               | route `id` (numeric)                                                                                                                    | Blade builder view for an existing flow |

- **Data:** reads one `flows` row via `forCurrentWorkspace()->find($id)`; `flow_type` from the row (default chat) or the `?type=` value if in the allowed list.
- **Rules & edge cases:**
  1. The `builder` route has no `{id}` segment, so redirects built as `route('user.flows.builder', ['id'=>N])` arrive as `?id=N`; the controller reads the query param as a fallback. This fixed the "cloned/imported template opens on a blank canvas" bug and must be preserved.
  2. An unknown or out-of-workspace id yields a blank new-flow canvas (no 404). A diagnostic log `[FLOW-BUILDER] load` records id, found, workspace and node count.
  3. The sheet only offers Messaging and Call; Instagram/Facebook/etc. are chosen later on the Trigger node (`?type=instagram` etc. still works and is honoured only if that channel is actually available, see WD-FLB-014).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the admin clicks Create flow then Call, when the builder loads, then the palette contains only voice (`cf_*`), Condition, Wait, Webhook, Run code and End nodes and the Trigger has no channel selector.
  - Given `/flows/builder?id=42` for an existing flow in this workspace, when it loads, then flow 42's nodes and name are shown.
  - Given `/flows/builder?ai=1`, when the builder mounts, then the AI generator modal is open.
- **Source refs:** `app/Http/Controllers/FlowsController.php` (builder), `resources/views/user/flows/index.blade.php`, `resources/js/charts/user-flows-index.js` (wireChannelPicker), `resources/js/charts/user-flows-builder.js` (aiOpen / testOpen initial state).
- **Port notes:** Next.js route `/flows/builder/[id]` plus `/flows/new?channel=`; keep the `?ai_prompt=` deep-link for the AI Copilot domain.

### WD-FLB-004 — Pause / resume a flow and the lifecycle state model

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-001
- **Summary:** Each card has a pause/resume button that flips `is_active`. A flow is Live when published AND active, Paused when published and not active, Draft when unpublished.
- **Actors & access:** workspace admin.
- **UX & screens:** icon button on each card (`data-flow-toggle`), title "Pause" or "Resume"; success toast "Flow paused" / "Flow resumed"; the list refetches silently.
- **Endpoints:**

| Method uri             | Route name        | Controller@action      | Middleware                         | Request | Response                                        |
| ---------------------- | ----------------- | ---------------------- | ---------------------------------- | ------- | ----------------------------------------------- |
| POST flows/{id}/toggle | user.flows.toggle | FlowsController@toggle | Authenticate, workspace.role:admin | none    | `{ok:true, is_active}`; 404 if not in workspace |

- **Data:** writes `flows.is_active` (default true on create).
- **Rules & edge cases:**
  1. Toggle fires the model `saved` hook, which re-syncs the managed keyword rule so its status becomes `is_published AND is_active` (see WD-FLB-021).
  2. Only published + active flows enrol anyone by tag/group/event (`FlowEnrollmentService` filters both flags). Manual enrol and REST enrol require only `is_active`.
  3. QUIRK: toggling an unpublished flow changes `is_active` but the pill still says Draft, so the click looks like a no-op.
  4. A paused flow does not stop sessions already running in the Node runtime.
  5. State pill labels and colours: Live (green), Paused (purple), Draft (grey).
- **Async & events:** model `saved` -> `syncKeywordTriggerReply` (or `syncInstagramTriggerAutomation`); notification row via the `LogsNotifications` trait on the Flow model.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a live flow, when Pause is clicked, then `is_active=false`, the pill shows Paused and the managed keyword rule becomes inactive.
  - Given a paused flow, when Resume is clicked, then the flow is Live again and keyword messages start it.
  - Given a flow from another workspace, when its id is toggled, then the response is 404.
- **Source refs:** `app/Http/Controllers/FlowsController.php` (toggle), `app/Models/Flow.php` (booted saved hook), `resources/views/user/flows/_cards.blade.php`, `resources/js/charts/user-flows-index.js`.
- **Port notes:** model the state as two booleans as WaDesk does (or an enum `draft|live|paused` plus derive), but keep enrolment gated on both. Emit an audit/outbox event on toggle.

### WD-FLB-005 — Rename a flow in place

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-001
- **Summary:** Pencil icon on the card opens a prompt to rename without opening the builder.
- **Actors & access:** workspace admin.
- **UX & screens:** `promptDialog` titled "Rename flow", label "Flow name", prefilled; if no dialog helper is loaded it falls back to `window.prompt`. Empty or unchanged names are ignored client-side. Success toast "Flow renamed".
- **Endpoints:**

| Method uri             | Route name        | Controller@action      | Middleware                         | Request                        | Response                               |
| ---------------------- | ----------------- | ---------------------- | ---------------------------------- | ------------------------------ | -------------------------------------- |
| POST flows/{id}/rename | user.flows.rename | FlowsController@rename | Authenticate, workspace.role:admin | `name` required string max 191 | `{ok:true, name}`; 422 validation; 404 |

- **Data:** writes `flows.flow_name` (encrypted cast) trimmed.
- **Rules & edge cases:** name max 191 (the builder's Save path allows 255, so a longer builder name cannot be renamed back down without shortening); triggers the `saved` hook (managed rule name is not affected for WhatsApp, but the Instagram automation row copies the name only on re-create).
- **Async & events:** `saved` hook; notification via trait.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a flow named "Old", when renamed to "New " (trailing space), then the stored name is "New".
  - Given an empty name, then the server returns 422 and the UI does nothing.
  - Given a name over 191 characters, then 422.
- **Source refs:** `app/Http/Controllers/FlowsController.php` (rename), `resources/js/charts/user-flows-index.js`.
- **Port notes:** trivial PATCH endpoint; validate length against the same column limit the builder uses.

### WD-FLB-006 — Duplicate a flow

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-001
- **Summary:** Copies a flow as a new unpublished draft titled "<name> (Copy)" and opens it in the builder.
- **Actors & access:** workspace admin.
- **UX & screens:** Duplicate icon on the card and a Duplicate button on the featured card (plain POST forms); redirect to `/flows/builder?id=<new>` with flash "Flow duplicated.".
- **Endpoints:**

| Method uri                | Route name           | Controller@action         | Middleware                         | Request | Response            |
| ------------------------- | -------------------- | ------------------------- | ---------------------------------- | ------- | ------------------- |
| POST flows/{id}/duplicate | user.flows.duplicate | FlowsController@duplicate | Authenticate, workspace.role:admin | none    | 302 to builder; 404 |

- **Data:** `replicate(['published_at'])` copies every attribute (user_id, workspace_id, provider, flow_type, instaflow_flow_id, flow_data, flow_file_path, category, trigger_*, is_active) except `published_at`; sets `flow_name` to name + " (Copy)" and `is_published=false`; if the source had a file mirror a fresh mirror file is written for the copy.
- **Rules & edge cases:**
  1. QUIRK: duplicate does NOT run the `flow_limit` plan check, so it bypasses the cap that save/import/clone enforce.
  2. QUIRK: `instaflow_flow_id` is copied, so a duplicated imported Instagram flow stays linked to the same remote flow.
  3. The copy keeps the same trigger keywords/sender; because it is a draft its managed rule is inactive, but publishing both creates two flows on the same keyword.
  4. `user_id` is the original creator, not the duplicating admin.
  5. The copy's name can exceed 191 characters.
- **Async & events:** `saved` hook (rule sync); no subscribers or run history are copied.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given flow "Welcome", when Duplicate is clicked, then a new draft "Welcome (Copy)" exists with the same nodes and edges and `is_published=false`.
  - Given the workspace is at its `flow_limit`, when duplicating, then the copy is still created (parity behaviour; decide explicitly whether the port should enforce the cap).
  - Given the original has subscribers, then the copy has none.
- **Source refs:** `app/Http/Controllers/FlowsController.php` (duplicate), `app/Models/Flow.php` (saveFlowFile).
- **Port notes:** the port should enforce the plan limit on duplicate (log as a deliberate deviation) and clear `instaflow_flow_id`.

### WD-FLB-007 — Delete a flow

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-001
- **Summary:** Permanently deletes a flow and its managed trigger rule.
- **Actors & access:** workspace admin.
- **UX & screens:** trash icon -> confirm dialog "Delete flow?" with message "Delete "<name>"? This can't be undone." (tone danger); success toast "Flow deleted"; list refetches.
- **Endpoints:**

| Method uri            | Route name             | Controller@action          | Middleware                         | Request | Response                                                                                                           |
| --------------------- | ---------------------- | -------------------------- | ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| DELETE flows/{id}     | user.flows.destroy     | FlowsController@destroy    | Authenticate, workspace.role:admin | none    | `{ok:true}`; 404                                                                                                   |
| DELETE flows/api/{id} | user.flows.api.destroy | FlowsController@apiDestroy | same                               | none    | `{success:true,message:'Flow deleted'}` or 404 `{success:false,message:'Flow not found'}` (API twin, no UI caller) |

- **Data:** `forceDelete()` although the model uses SoftDeletes and the table has `deleted_at` (QUIRK: soft-delete column is effectively unused). Model events remove the JSON file mirror, force-delete managed `keyword_replies` rows (`is_flow_trigger=true`, even trashed ones) and delete `instagram_automations` rows of type flow.
- **Rules & edge cases:**
  1. `flow_subscribers`, `flow_retry_logs`, `flow_connected_devices` rows are NOT deleted (no FK cascade) and become orphans; analytics hides them because it scopes by the workspace's live flow ids.
  2. Hand-made auto-replies (`keyword_replies` with `reply_type=flow`, not managed) that point at the deleted flow are left dangling; the dispatcher checks that the flow is still live.
  3. Running Node sessions are not stopped.
  4. Not reversible; no undo.
- **Async & events:** `deleting`/`deleted` model hooks; notification row via trait.
- **External systems:** none (an Instagram flow's remote copy on Instaflow is NOT deleted).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a keyword flow with a managed rule, when deleted, then both the flow and the rule are gone.
  - Given a flow id from another workspace, then 404 and nothing is deleted.
  - Given the delete is confirmed, then the list refetches and counts drop by one.
- **Source refs:** `app/Http/Controllers/FlowsController.php` (destroy, apiDestroy), `app/Models/Flow.php` (boot, booted), `resources/js/charts/user-flows-index.js`.
- **Port notes:** prefer soft-delete plus cascading cleanup of subscribers/retry logs (FK ON DELETE CASCADE) and cancel active runtime sessions via an outbox event; decide retention of analytics for deleted flows.

### WD-FLB-008 — Export a flow to a portable .json

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-001
- **Summary:** Downloads the flow graph as `<slug>.wadesk-flow.json`, stripped of workspace/user ids so it can be imported anywhere or uploaded as an admin template.
- **Actors & access:** workspace admin.
- **UX & screens:** export icon on each card (plain link); browser downloads the file.
- **Endpoints:**

| Method uri            | Route name        | Controller@action      | Middleware                         | Request | Response                                                         |
| --------------------- | ----------------- | ---------------------- | ---------------------------------- | ------- | ---------------------------------------------------------------- |
| GET flows/{id}/export | user.flows.export | FlowsController@export | Authenticate, workspace.role:admin | none    | JSON attachment (pretty-printed, unescaped slashes/unicode); 404 |

- **Data:** payload `{_wadesk_flow_export:1, exported_at (ISO-8601), name, flow_type (default chat), category, flow_data (decoded graph or empty {flowNodes:[],flowEdges:[]})}`. File name is `Str::slug(name)` or `flow-<id>` if the slug is empty.
- **Rules & edge cases:** the graph is exported verbatim, so sender ids (`deviceId` like `waba:3`), tag ids, group ids, stage ids, team/user ids, store ids, template ids, assistant ids and media URLs are workspace-specific and dangle in another workspace; Google tokens are not included; the MySQL node's `password` and Webhook headers (which may hold bearer tokens) ARE included in clear text (QUIRK, security relevant). The wrapper marker is the literal `_wadesk_flow_export`; a port should keep accepting it on import for interoperability with existing exports.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a flow "Lead Nurture!", when exported, then the download is named `lead-nurture.wadesk-flow.json` and contains `flow_data.flowNodes`.
  - Given a flow with no nodes, then the export contains empty `flowNodes`/`flowEdges` arrays.
  - Given a flow in another workspace, then 404.
- **Source refs:** `app/Http/Controllers/FlowsController.php` (export).
- **Port notes:** consider redacting secrets (MySQL password, auth headers) on export and re-prompting on import.

### WD-FLB-009 — Import a flow from .json

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-008
- **Summary:** Uploading an export file creates a new unpublished flow "<name> (imported)" and opens it in the builder.
- **Actors & access:** workspace admin; plan limit `flow_limit`.
- **UX & screens:** Import button (a label wrapping a hidden file input; the form auto-submits on file choose). On failure the red banner above the KPI cards shows the first `file` error.
- **Endpoints:**

| Method uri        | Route name        | Controller@action      | Middleware                         | Request                                                                                         | Response                                                                                                                     |
| ----------------- | ----------------- | ---------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| POST flows/import | user.flows.import | FlowsController@import | Authenticate, workspace.role:admin | multipart `file` required, file, max 4096 KB, mimetypes application/json, text/plain, text/json | 302 to `/flows/builder?id=<new>` with flash "Flow imported — review it, then Publish when ready."; or back with `file` error |

- **Data:** accepts the canonical wrapper `{_wadesk_flow_export, name, flow_type, category, flow_data}` OR a bare `{flowNodes, flowEdges, vars}` graph. Requires `flowNodes` to be an array; `flowEdges` defaults to `[]`, `vars` to `[]`. Name default "Imported flow" then suffixed " (imported)"; `flow_type` kept if in chat/call/instagram/facebook/tiktok/telegram/line/wechat/viber/email else chat; category from the file; `is_published=false`, `is_active=true`; trigger columns re-extracted from the graph; file mirror written. `ensureNodePositions` stamps x/y on nodes lacking numeric coordinates using a 3-column grid (`x = 120 + (i mod 3) * 260`, `y = 120 + floor(i/3) * 180`).
- **Rules & edge cases:**
  1. Errors: unparseable / not a flow -> "This is not a valid <brand> flow export."; plan cap -> the PlanLimitReachedException message ("You've reached your plan's limit of N flows. Upgrade your plan to add more, or delete an existing one to free up space.").
  2. Node data is NOT schema-validated; unknown node types are stored as-is. The extract of trigger columns can throw for over-long keywords at the model hook (see WD-FLB-021) and surfaces as a 500 here (only `apiSave` wraps that).
  3. Imported flows keep foreign ids (senders, tags, stores) from the source workspace; the builder's validation will not catch dangling ids except a missing sender.
  4. Imported `flow_type` is honoured even if that channel is not enabled here; the builder then falls back to the chat palette and its validation flags channel-specific nodes.
- **Async & events:** `saved` hook; notification via trait.
- **External systems:** none.
- **Settings:** plan `flow_limit`.
- **Acceptance criteria:**
  - Given an export of "Welcome", when imported, then a draft "Welcome (imported)" opens in the builder with all nodes on the canvas.
  - Given a bare `{flowNodes:[...]}` JSON without coordinates, when imported, then nodes are laid out on the 3-column grid.
  - Given a non-JSON file, then the error banner appears and no flow is created.
  - Given the workspace is at its flow limit, then the import is rejected with the plan message.
- **Source refs:** `app/Http/Controllers/FlowsController.php` (import, parseImportPayload, ensureNodePositions), `resources/views/user/flows/index.blade.php`.
- **Port notes:** validate the graph against a JSON Schema per node type on import (WaDesk does not); remap or null out foreign ids; cap node count.

### WD-FLB-010 — Start-from-template gallery and clone

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-011
- **Summary:** Active admin-curated templates appear as cards under "Start from a template"; "Use template" clones one into the workspace as a fresh unpublished flow.
- **Actors & access:** workspace admin; plan `flow_limit`.
- **UX & screens:** section "Starter templates / Start from a template" on `/flows` (only when at least one active template exists): cards with name, type badge (Chat / Call / Instagram, else a dash), description (fallback "A ready-made flow you can customise."), "<N> steps [· category]" and a POST form button "Use template".
- **Endpoints:**

| Method uri                      | Route name                 | Controller@action             | Middleware                         | Request | Response                                                                                                                                                                |
| ------------------------------- | -------------------------- | ----------------------------- | ---------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST flows/templates/{id}/clone | user.flows.templates.clone | FlowsController@cloneTemplate | Authenticate, workspace.role:admin | none    | 302 to `/flows/builder?id=<new>` with flash "Template "<name>" cloned — customise it, then Publish."; back with `template` error on plan limit; 404 if inactive/missing |

- **Data:** creates a `flows` row named exactly the template name, `flow_type` from the template (kept only if in the ten allowed values), `category` from the template, unpublished, active, trigger columns extracted from the template graph, positions stamped where missing; increments `flow_templates.clone_count`. Templates are ordered by `sort_order` asc then `id` desc.
- **Rules & edge cases:** deleted or hidden templates return 404; tenants keep clones after a template is deleted; a diagnostic `[FLOW-CLONE]` log records template node count vs persisted node count; template graphs are plain JSON, tenant graphs are encrypted.
- **Async & events:** `saved` hook; notification row.
- **External systems:** none.
- **Settings:** `flow_limit`.
- **Acceptance criteria:**
  - Given an active template with 5 nodes, when a tenant clicks Use template, then a draft flow with 5 nodes opens and the template's `clone_count` increases by 1.
  - Given the template is toggled hidden, then it disappears from the gallery and a direct POST returns 404.
  - Given the workspace is at its plan limit, then the user is returned to the list with the plan message.
- **Source refs:** `app/Http/Controllers/FlowsController.php` (cloneTemplate), `app/Models/FlowTemplate.php`, `resources/views/user/flows/index.blade.php`.
- **Port notes:** table `flow_templates` is platform-scoped (no RLS tenant column); expose a read-only view to tenants.

### WD-FLB-011 — Admin flow templates: list, visibility toggle, delete

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** none
- **Summary:** Super-admins manage the shared starter-template catalogue at `/admin/flow-templates`.
- **Actors & access:** platform admin (`Authenticate`, `EnsureUserIsAdmin`, `IPAllowlist` middleware). Workspace roles do not apply.
- **UX & screens:** `resources/views/admin/flow-templates/index.blade.php` (`x-layouts.admin`, admin-key `flow-templates`, JS page `admin-flow-templates-index`): title "Bot Flow templates", stat cards (Templates total, Visible to tenants, Times cloned), a table (Template with a "hidden" chip when inactive and description, Type, Category, Steps, Clones, Actions: visibility toggle, edit, delete with data-confirm "Delete this template? Tenants who already cloned it keep their copy."), pagination when more than one page (20 per page), empty state "No templates yet" with "Add your first template".
- **Endpoints:**

| Method uri                            | Route name                   | Controller@action                    | Middleware                                   | Request | Response                                                                                |
| ------------------------------------- | ---------------------------- | ------------------------------------ | -------------------------------------------- | ------- | --------------------------------------------------------------------------------------- |
| GET admin/flow-templates              | admin.flow-templates.index   | Admin\FlowTemplateController@index   | Authenticate, EnsureUserIsAdmin, IPAllowlist | `page`  | Blade page                                                                              |
| POST admin/flow-templates/{id}/toggle | admin.flow-templates.toggle  | Admin\FlowTemplateController@toggle  | same                                         | none    | back with flash "Template is now visible to tenants." / "Template hidden from tenants." |
| DELETE admin/flow-templates/{id}      | admin.flow-templates.destroy | Admin\FlowTemplateController@destroy | same                                         | none    | redirect to index, flash "Template deleted."                                            |

- **Data:** `flow_templates`; stats = count, count active, `SUM(clone_count)`; ordering `sort_order`, then `id` desc; delete is a hard delete.
- **Rules & edge cases:** no soft delete; deleting does not affect tenant clones; step count comes from `flow_data.flowNodes` length (no decrypt needed because the column is plain JSON).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** admin IP allowlist (ASHELL).
- **Acceptance criteria:**
  - Given 25 templates, then the list shows 20 with pagination.
  - Given a visible template, when toggled, then it disappears from every tenant gallery and the flash says it is hidden.
  - Given a delete, then the row is gone and previously cloned flows remain.
- **Source refs:** `app/Http/Controllers/Admin/FlowTemplateController.php`, `resources/views/admin/flow-templates/index.blade.php`, `app/Models/FlowTemplate.php`.
- **Port notes:** module `apps/api/src/modules/admin` (or `flows` admin controller) guarded by the super-admin guard; table `flow_templates`.

### WD-FLB-012 — Admin flow template create / edit

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-011
- **Summary:** Super-admins register a starter template by uploading an exported flow, pasting flow JSON, or cloning an existing flow by id, and set its name, description, type, category, sort order and visibility.
- **Actors & access:** platform admin (`Authenticate`, `EnsureUserIsAdmin`, `IPAllowlist`).
- **UX & screens:** `resources/views/admin/flow-templates/form.blade.php` (`x-layouts.admin`, page `admin-flow-templates-form`). Header with breadcrumb Admin > Flow templates > New/Edit, Cancel and a submit button (Create template / Save changes). Left card "Template details": Name (required, max 160, placeholder "e.g. Restaurant — Welcome & Menu"), Description (textarea, max 1000, "One line shown to tenants in the gallery."), Category (max 64, placeholder "welcome / lead / support"). Left card "The flow itself": on edit a note "Currently N steps. Leave all three fields empty to keep the current flow — fill one to replace it."; three alternatives: 1 upload exported .json (accept application/json), 2 paste flow JSON (dark monospace textarea, placeholder `{"flowNodes":[...],"flowEdges":[...]}`), 3 clone an existing flow by numeric id ("the id in /flows/builder/<id>"). Right card "Visibility": Flow type select (Chat, Call (voice), Instagram), Sort order (0-9999, "Lower shows first in the gallery."), a "Visible to tenants" checkbox (hidden input 0 + checkbox 1; default checked). A validation summary box lists errors.
- **Endpoints:**

| Method uri                         | Route name                  | Controller@action                   | Middleware                                   | Request           | Response                                |
| ---------------------------------- | --------------------------- | ----------------------------------- | -------------------------------------------- | ----------------- | --------------------------------------- |
| GET admin/flow-templates/create    | admin.flow-templates.create | Admin\FlowTemplateController@create | Authenticate, EnsureUserIsAdmin, IPAllowlist | none              | Blade form                              |
| POST admin/flow-templates          | admin.flow-templates.store  | Admin\FlowTemplateController@store  | same                                         | form fields below | redirect index, flash "Template saved." |
| GET admin/flow-templates/{id}/edit | admin.flow-templates.edit   | Admin\FlowTemplateController@edit   | same                                         | none              | Blade form; 404                         |
| PUT admin/flow-templates/{id}      | admin.flow-templates.update | Admin\FlowTemplateController@update | same                                         | same fields       | redirect index, flash "Template saved." |

- **Data:** validated fields: `name` required string max 160; `description` nullable max 1000; `flow_type` required in chat,call,instagram; `category` nullable max 64; `sort_order` nullable integer 0..9999 (default 0); `is_active` nullable boolean (unchecked -> false); `flow_file` nullable file max 4096 KB mimetypes json/plain; `flow_json` nullable string; `source_flow_id` nullable integer. Graph source precedence: uploaded file, then pasted JSON, then clone-by-id (`Flow::find`, NOT workspace scoped, decrypted graph). Accepts the export wrapper (`flow_data` key) or a bare graph. Stored as `flow_data` = `{flowNodes: values, flowEdges: values (default []), vars: array or []}` (plain JSON, not encrypted); `created_by` = admin id on create.
- **Rules & edge cases:**
  1. On create a graph is mandatory: if nothing usable is supplied the `flow_json` field errors "Provide the flow — upload an exported .json, paste the JSON, or enter an existing flow id to clone."
  2. If a graph is supplied but `flowNodes` is missing/not an array: "That doesn't look like a valid flow (missing flowNodes)."
  3. On edit the graph is optional; leaving all three empty keeps the current graph. QUIRK: an uploaded file that is not valid JSON is silently treated as "no graph supplied" (on edit the old graph is kept with no warning).
  4. Template `flow_type` is limited to three values even though tenants can run flows on ten channels; the template gallery therefore cannot carry a Facebook/Telegram/etc. template through the form.
  5. The graph is not validated against node schemas; sender ids and other workspace-bound ids inside it are copied into tenants' clones verbatim.
  6. No IP/size guard beyond file max 4 MB.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a valid export upload with name "Restaurant welcome", when Create template is submitted, then a template appears in the list with the right step count and is visible to tenants.
  - Given an edit with all three graph fields empty, when saved, then metadata changes and the graph is unchanged.
  - Given pasted text that is not JSON on create, then the form re-renders with the `flow_json` error and the old input.
  - Given `sort_order` 10000, then validation fails.
- **Source refs:** `app/Http/Controllers/Admin/FlowTemplateController.php`, `resources/views/admin/flow-templates/form.blade.php`, `app/Models/FlowTemplate.php`, `database/migrations/2026_07_08_000001_create_flow_templates_table.php`.
- **Port notes:** add JSON-Schema validation per node type; allow all ten flow types; strip sender/tag ids on save or map them at clone time.

### WD-FLB-013 — Flow categories and the library filter

- **Status:** partial
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-001
- **Summary:** `flows.category` (max 64) drives the Library rail filter, card icon and static purpose text. There is no UI to set it on a flow; it comes only from a template, an import file, the builder boot payload or a seeder.
- **Actors & access:** workspace admin.
- **UX & screens:** rail entries listed in WD-FLB-002; card icon by category (`welcome`, `cart`, `cart-recovery`, `post-purchase`, `re-engagement`, `lead`, `lead-nurture`, `event`, `special-events`; unknown -> neutral icon). The docs say "Give the flow a name and optional category" but the builder shows no category field (docs-only).
- **Endpoints:** `category` query on `GET flows`; `category` accepted by `POST flows/api/save` (nullable string max 64).
- **Data:** `flows.category` varchar(64) nullable, indexed. On create: the request value or null. On update: request value if non-empty else the existing value (a category cannot be cleared through save). The builder posts the category it booted with (`data-flow-category`), so it round-trips untouched.
- **Rules & edge cases:** the filter compares exact strings; rail counts only reflect the seven fixed keys; the seeders use category `Showcase` (capitalised) which no rail entry matches; flows with NULL category count under `uncategorized` in `categoryCounts` but there is no rail entry for it.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a flow imported with category `welcome`, when the Welcome rail entry is clicked, then only welcome flows show.
  - Given a saved flow with category `lead`, when the builder re-saves without a category value, then the category stays `lead`.
- **Source refs:** `app/Http/Controllers/FlowsController.php` (index, apiSave, categoryCounts), `resources/views/user/flows/_cards.blade.php`, `resources/views/user/flows/index.blade.php`, `Documentation/pages/automation/flows.html`.
- **Port notes:** decide whether to add a real category select in the builder toolbar; otherwise keep it template-driven.

### WD-FLB-014 — Builder page shell and boot payload

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** none
- **Summary:** `GET flows/builder[/{id}]` renders a full-screen shell whose `#root` carries the flow, its type and the set of channels this workspace can actually run, then the React app takes over.
- **Actors & access:** workspace admin. Soft paywall `autoflow`.
- **UX & screens:** `resources/views/user/flows/builder.blade.php` (`x-layouts.user`, nav key `flows`, hide-header, page id `user-flows-builder`). Before JS loads the page shows "Loading flow builder...". `#root` data attributes: `data-flow-id`, `data-flow-name` (default "New flow"), `data-flow-category`, `data-flow-published` (0/1), `data-flow-type`, `data-ext-instagram`, `data-ig-accounts`, `data-fb`, `data-fb-pages`, `data-tt`, `data-tt-accounts`, `data-tg`, `data-tg-bots`, `data-line`, `data-line-channels`, `data-wechat`, `data-wechat-channels`, `data-viber`, `data-viber-channels`, `data-email`, `data-email-accounts`, `data-flow-json` (the decoded graph, JSON-escaped with HEX flags, or an empty graph).
- **Endpoints:** see WD-FLB-003 (`GET flows/builder`, `GET flows/builder/{id}`).
- **Data:** per-channel availability computed in the Blade:
  - Instagram: available when a native `InstagramAccount` (status connected) exists in this workspace OR any `WorkspaceIgAccount` (Instaflow bridge) row exists; accounts embedded as `{key:'instagram:<id>', id, label:'@username', username}` (bridge accounts only; native accounts arrive later via the picker).
  - Facebook: needs system setting `facebook_enabled` true, table `facebook_pages`, and at least one `status=connected` page; embedded `{key:'facebook:<row id>', id, label:name or 'Page <page_id>'}`.
  - TikTok: setting `tiktok_enabled` and a connected account (`tiktok:<row id>`).
  - Telegram: a `TelegramBot` row with `active=true` (no admin toggle is checked; the comment says "plan allows" but no plan check exists); key `telegram:<row id>`.
  - LINE / WeChat / Viber: active `line_channels` / `wechat_channels` / `viber_channels` rows for the workspace; keys `line:<id>`, `wechat:<id>`, `viber:<id>`.
  - Email: setting `email_enabled` true AND `WorkspaceEmailAccount::hasConnected(ws)`; connected mailboxes as `email:<mirror row id>`.
    Existing flows open with their stored `flow_type`; the JS downgrades an unavailable channel to chat (a flow of an unavailable type therefore shows the chat palette and fails validation on channel-specific nodes, see WD-FLB-018).
- **Rules & edge cases:**
  1. The rule "never offer a dead channel" is intentional: a flow for a channel with no account would save, publish and never fire.
  2. Data attributes embed the account lists as the guaranteed source, because a browser-cached copy of `/flows/api/picker` once left the account dropdown empty.
  3. On mobile (<768 px) the palette starts collapsed and an "Add node" floating button opens it; on touch devices tapping a palette card adds the node at the canvas centre and closes the drawer.
  4. On mount the app fetches in parallel: `/templates/api/list?type=standard`, `/flows/api/list`, `/flows/api/ai-models`, `/team-inbox/api/teams`, `/team-inbox/api/tags`, `/team-inbox/api/ai-agents`, `/deals/stages`, `/flows/api/ai-assistants`, `/flows/api/call-assistants`. Failures are swallowed (caches stay empty and dropdowns show "Loading ..."). Lazy fetches: `/flows/api/picker` (Trigger inspector), `/flows/api/commerce/stores`, `/appointments/booking-types/list`, `/wa-forms/api/list`, `/api/google/picker/{sheets|docs|forms}`, `/instagram/commerce/products.json`.
  5. All builder fetches send `X-Requested-With` and the CSRF token from the page meta tag.
- **Async & events:** none.
- **External systems:** none directly (caches are read from other domains' endpoints, listed in Cross-domain contracts).
- **Settings:** `facebook_enabled`, `tiktok_enabled`, `email_enabled`, `instagram_enabled` system settings.
- **Acceptance criteria:**
  - Given a workspace with a connected Telegram bot and no Facebook page, when the builder loads, then the Trigger channel select lists WhatsApp and Telegram only.
  - Given a workspace with no connected channel accounts at all, then the channel select is hidden (a one-option select is noise) and WhatsApp is the only mode.
  - Given a call flow (`?type=call`), then the channel select is never shown.
- **Source refs:** `resources/views/user/flows/builder.blade.php`, `app/Http/Controllers/FlowsController.php` (builder), `resources/js/charts/user-flows-builder.js` (top of `init()`, FlowApp mount effect).
- **Port notes:** replace data-attributes with a typed `GET /flows/builder-context` response (channels available, embedded accounts, caches) so the SPA can load in one call.

### WD-FLB-015 — Canvas interactions, undo/redo and shortcuts

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-014
- **Summary:** The canvas is a pannable, zoomable dot-grid with absolutely positioned 280 px wide node cards, bezier connectors, a minimap, undo/redo history and keyboard shortcuts.
- **Actors & access:** workspace admin.
- **UX & screens:** toolbar (back arrow to `/flows`, "Flow Builder" eyebrow + editable name input, Generate with AI, Test, status pill Published / Unsaved / Draft, Save / "Save changes", Publish); palette left; canvas centre; inspector right (360 px, hidden until the pencil is used); bottom-right cluster: undo, redo, zoom out/in with percentage, reset (zoom 100%, pan 40,40); minimap (170x110) with a draggable viewport rectangle; toast (1.8 s) top centre.
- **Endpoints:** none (client only).
- **Data (client state):** nodes `{id: 'n_' + 6 random base36, type, x, y, data, isStart?}`, edges `{id: 'e_' + 6 random, source, sourceHandle, target, kind ('no' for handle `no`, else null)}`, `vars`. Boot normalisation backfills id/type/x/y/data defaults (`defaultData(type)` merged under saved data), drops edges whose endpoints do not exist, defaults missing `sourceHandle` to `out`, and guarantees exactly one `isStart` (the trigger, else the first node); missing coordinates use the 3-column grid.
- **Rules & edge cases:**
  1. Zoom range 0.4 to 1.8 (default 0.95). Plain wheel/trackpad scroll pans; Ctrl/Cmd + wheel zooms around the pointer; two-finger pinch zooms on touch; one finger pans/drags/connects.
  2. Add a node: drag from the palette onto the canvas (dropped centred on the pointer) or double-click a palette card (added at the viewport centre). The first node on an empty canvas automatically becomes the START node. A singleton type (trigger) cannot be added twice: toast "Trigger can only exist once.".
  3. Connect: press an output port and release on any input port or anywhere on a node card. Self-connections are ignored. An identical (source, handle, target) edge replaces itself, but the same handle may connect to several targets (fan-out is allowed; the runtime picks one). No cycle detection.
  4. Click an edge to open a "Delete" popup; deleting a node also removes all its incident edges.
  5. Node action bar (above the selected node): pin as START (star, toggles; only one start; clicking the current start unpins it), Edit (opens the inspector), Duplicate (Ctrl/Cmd+D), Delete (Backspace/Delete). Duplicating deep-clones data, offsets by (+40, +40), copies no edges and never copies `isStart`; the trigger cannot be duplicated (toast "Trigger can only exist once — can’t duplicate.").
  6. Shortcuts (ignored while typing in inputs/textareas/contenteditable): Ctrl/Cmd+Z undo, Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z redo, Backspace/Delete delete selection, Escape cancels a pending connection and clears selection.
  7. History keeps at most 60 snapshots of `{nodes, edges}`; moving a node pushes one entry on release only if it actually moved; text edits inside the inspector push an entry per keystroke (QUIRK: history fills quickly).
  8. Any structural change sets the status to "Draft · unsaved". There is NO autosave, NO `beforeunload` guard and NO local draft: leaving loses unsaved work.
  9. Removing an option (buttons/list/ask/poll) deletes the edge on that option's port and renumbers higher `p<n>` handles down by one so remaining edges stay attached to the right option.
  10. Edge `kind` is not persisted through reload (edges are rebuilt without it), only affects the red styling of `no` edges within a session.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an empty canvas, when the first node is dropped, then it is marked START.
  - Given a selected node, when Ctrl+D is pressed, then a disconnected copy appears 40 px down-right and is selected.
  - Given three moves then two Ctrl+Z presses, then the canvas returns to the state after the first move; Ctrl+Y re-applies.
  - Given a Buttons node with 3 options wired, when option 2 is removed, then option 2's edge is deleted and option 3's edge now hangs off `p1`.
  - Given a second Trigger drag, then a toast refuses it.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (FlowApp, NodeActionBar, Minimap, onAddOption / onRemoveOption, keyboard effect), `resources/css` builder classes (`node-card`, `port`, `edge-path`, `minimap`).
- **Port notes:** use an existing graph library (React Flow / xyflow) rather than porting the hand-rolled SVG math; keep the port-index renumbering rule and the singleton-trigger rule. Add autosave/draft and an unsaved-changes guard (a clear improvement).

### WD-FLB-016 — Node palette, search and per-channel availability

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-014
- **Summary:** The left palette groups node types (Start, Send, Listen, Logic, AI, Contact, Engage, Commerce, Integrations, CRM plus channel groups) and shows only those valid for the flow's current mode; a search box filters by label, description and group.
- **Actors & access:** workspace admin.
- **UX & screens:** panel titled "Add a node" with a coloured channel badge (Instagram gradient, Facebook blue, Call grey, Email blue, otherwise WhatsApp green), a count, a search field ("Search nodes…"), draggable cards (icon chip, label, description) and a footer tip "drag onto canvas, or double-click to add at center.". Empty search shows "No nodes match.". Nodes flagged `hidden` (legacy) are never listed but still render on existing flows.
- **Endpoints:** none.
- **Data — mode and availability matrix.** Mode is derived from the flow: call flows are always `call`; otherwise the Trigger node's `data.channel` if it is an enabled channel, else the type the flow was opened as. `modes` on a node type default to `['chat']` when not declared. Full catalogue (id, palette label, group, modes):

| Node id                                                            | Label                                                                               | Group        | Available in modes                                                      |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------- |
| trigger                                                            | Trigger                                                                             | Start        | all ten (singleton)                                                     |
| message                                                            | Send message                                                                        | Send         | chat, instagram, facebook, tiktok, telegram, line, wechat, viber, email |
| template                                                           | Send template                                                                       | Send         | chat                                                                    |
| media                                                              | Send media                                                                          | Send         | chat + the eight social/email modes (all except call)                   |
| notify_number                                                      | Copy to number                                                                      | Send         | chat                                                                    |
| sequence                                                           | Send sequence                                                                       | Send         | chat                                                                    |
| buttons                                                            | Quick replies                                                                       | Send         | chat + the eight social/email modes                                     |
| list                                                               | List message                                                                        | Send         | chat                                                                    |
| ask                                                                | Ask question                                                                        | Listen       | chat + the eight social/email modes                                     |
| condition                                                          | Condition                                                                           | Logic        | all ten                                                                 |
| delay                                                              | Wait                                                                                | Logic        | all ten                                                                 |
| webhook                                                            | Webhook                                                                             | Logic        | all ten                                                                 |
| code                                                               | Run code (JS)                                                                       | Logic        | chat, call                                                              |
| mysql                                                              | MySQL Query                                                                         | Logic        | chat                                                                    |
| subflow                                                            | Run sub-flow                                                                        | Logic        | chat                                                                    |
| ai                                                                 | AI assistant                                                                        | AI           | chat + the eight social/email modes                                     |
| tag                                                                | Tag contact                                                                         | Contact      | chat                                                                    |
| assign                                                             | Assign agent                                                                        | Contact      | chat                                                                    |
| end                                                                | End                                                                                 | Start        | all ten                                                                 |
| cta                                                                | Call to action                                                                      | Engage       | chat                                                                    |
| location                                                           | Location                                                                            | Engage       | chat                                                                    |
| poll                                                               | Poll                                                                                | Engage       | chat                                                                    |
| chatbot                                                            | Chatbot                                                                             | Engage       | chat                                                                    |
| wa_to_instagram                                                    | Hand off to Instagram                                                               | Engage       | chat                                                                    |
| book_appointment                                                   | Book appointment                                                                    | Engage       | chat                                                                    |
| ai_call                                                            | AI voice call                                                                       | Engage       | chat                                                                    |
| google_meet                                                        | Google Meet                                                                         | Engage       | chat                                                                    |
| wa_form                                                            | WhatsApp form                                                                       | Engage       | chat                                                                    |
| whatsapp_shop / woocommerce / shopify                              | WhatsApp Shop / WooCommerce / Shopify                                               | Commerce     | chat                                                                    |
| google_sheets / google_docs / google_form                          | Google Sheets / Docs / Form                                                         | Integrations | chat                                                                    |
| deal                                                               | Create / move deal                                                                  | CRM          | chat                                                                    |
| cf_say, cf_listen, cf_ai, cf_assistant                             | Say, Listen, AI Respond, AI Assistant                                               | Voice        | call                                                                    |
| cf_menu, cf_search                                                 | Menu / Branch, Search web                                                           | Call routing | call                                                                    |
| cf_transfer, cf_hangup                                             | Transfer, Hang up                                                                   | Call control | call                                                                    |
| ig_buttons, ig_reply_comment, ig_products, ig_lead, ig_to_whatsapp | Button message, Reply to comment, Send products, Capture lead, Hand off to WhatsApp | Instagram    | instagram                                                               |
| ig_send_dm, ig_quick, ig_ai, ig_ask                                | (legacy: Send DM, Quick replies, AI Reply, Ask a question)                          | Instagram    | instagram, hidden (superseded by message / buttons / ai / ask)          |
| fb_gallery, fb_products, fb_lead, fb_reply_comment, fb_to_whatsapp | Card gallery, Send products, Capture lead, Reply to comment, Hand off to WhatsApp   | Facebook     | facebook                                                                |
| tg_payment                                                         | Payment / Invoice                                                                   | Telegram     | telegram                                                                |

"The eight social/email modes" means instagram, facebook, tiktok, telegram, line, wechat, viber, email. "Chat" is WhatsApp (any engine).

- **Rules & edge cases:**
  1. Switching the Trigger's channel re-filters the palette instantly but does NOT remove nodes already on the canvas; validation (WD-FLB-018) catches unsupported nodes on save.
  2. Palette search matches label, description and group, case-insensitive.
  3. `code` is deliberately excluded from Instagram because the Instagram runner is not the Node VM (per the source comment; see Open questions).
  4. Runtime coverage is NOT the same as builder availability: the Node runner for a social channel implements only message, media, buttons, ask, delay, condition, webhook, ai, end plus its channel-specific nodes (e.g. Instagram also has `ig_gallery`, which has no palette entry; Telegram implements `payment`/`tg_payment`/`invoice`). Any other type placed on those canvases would be skipped by the runner.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** channel availability flags (WD-FLB-014).
- **Acceptance criteria:**
  - Given a WhatsApp flow, then Template, List, Sequence, MySQL and Google nodes are listed; given the Trigger channel is switched to Facebook, then only message, media, buttons, ask, condition, delay, webhook, ai, end and the five `fb_*` nodes are listed.
  - Given a call flow, then the palette shows the eight `cf_*` nodes plus Trigger, Condition, Wait, Webhook, Run code and End only.
  - Given the query "sheet", then only Google Sheets is listed.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`NTYPES`, `nodeInMode`, `flowTypeOf`, `Palette`), `app/Services/Flows/FlowNormalizer.php` (TYPE_MAP), `node/services/*FlowService.js` (runner coverage).
- **Port notes:** encode this matrix as data (`node-types.ts` in `packages/contracts`) consumed by both the builder and server-side validation; add a server-side check on save so a graph cannot carry nodes its channel cannot run.

### WD-FLB-017 — Node card rendering, ports and handle naming

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-015
- **Summary:** Each node type renders a card (header chip, id, group tag, type-specific preview) and exposes output ports whose handle ids are the routing contract between the builder, `FlowNormalizer` and the runtime.
- **Actors & access:** workspace admin.
- **UX & screens:** card shows an input dot on the left (not on the Trigger), a START ribbon on the start node, a red outline when flagged invalid, and either one output dot (single-port nodes) or a stacked list of labelled ports (multi-port nodes). Colour coding: "yes"-type ports green, "no"-type red, others neutral.
- **Endpoints:** none.
- **Data — output handle ids (sourceHandle) per node type:**

| Node type                                                                                                                                                                                                      | Handles (label)                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| trigger                                                                                                                                                                                                        | `out` (label from kind: "on keyword", "on comment → DM", "on tag added", "on group join", "on new contact", "on opt-in", "on order", "on deal stage", "while away", "after hours", "on enroll") |
| message, media, sequence, delay, webhook, code, mysql, ai, tag, assign, subflow, cta, location, chatbot, cf_say, cf_listen, cf_ai, cf_assistant, cf_search, ig_* single-output nodes, fb_* single-output nodes | `out` (single labelled output; labels: next, sent, response, done, rows, reply ready, after wait, after run, replied, saved, handed off, answered, heard, spoken, results)                      |
| notify_number / wa_to_instagram / ai_call / google_meet / wa_form / google_docs                                                                                                                                | `out` (labels: sent, link sent, call placed, link sent, submitted, doc sent)                                                                                                                    |
| google_sheets                                                                                                                                                                                                  | `out` (label "row written" or "row loaded" by mode)                                                                                                                                             |
| tg_payment                                                                                                                                                                                                     | `out` ("invoice sent", or "after paid" when `wait` is on)                                                                                                                                       |
| buttons, list, poll                                                                                                                                                                                            | `p0..pN` one per option (label = option text; list uses the item title)                                                                                                                         |
| template                                                                                                                                                                                                       | `p0..pN` one per QUICK-REPLY button of the picked template (URL/call/copy buttons do not create ports); a template with no quick replies has a single `out`                                     |
| ask                                                                                                                                                                                                            | `out` when there are no expected answers; otherwise `p0..pN` per expected answer plus `else` ("else / no match")                                                                                |
| ig_quick (legacy)                                                                                                                                                                                              | `p0..pN` per option                                                                                                                                                                             |
| cf_menu                                                                                                                                                                                                        | `p0..pN` per branch plus `nomatch` ("no match")                                                                                                                                                 |
| condition                                                                                                                                                                                                      | `yes` ("IF · true"), `no` ("ELSE · false")                                                                                                                                                      |
| book_appointment                                                                                                                                                                                               | `booked`, `no_slots`                                                                                                                                                                            |
| whatsapp_shop, woocommerce, shopify                                                                                                                                                                            | `purchased`, `abandoned`                                                                                                                                                                        |
| google_form                                                                                                                                                                                                    | `submitted`, `timeout`                                                                                                                                                                          |
| deal                                                                                                                                                                                                           | `created` (label "moved" when action is move), `error`                                                                                                                                          |
| end, cf_hangup                                                                                                                                                                                                 | none (terminal)                                                                                                                                                                                 |

- **Rules & edge cases:**
  1. Multi-port set (cards that draw one dot per row) = buttons, list, condition, poll, google_form, template-with-quick-replies, ask-with-expected-answers. QUIRK / DEFECT as shipped: `nodeRows()` defines several rows for book_appointment (booked / no_slots), the three commerce nodes (purchased / abandoned), deal (created / error), cf_menu (p0.. / nomatch) and legacy ig_quick, but `isMultiPort()` does not list them, so their cards render a SINGLE output dot with handle `out`. Through the UI an operator can therefore only wire the first branch of those nodes (`out` normalises to port 1 = booked / purchased / created); the `no_slots`, `abandoned`, `error` and `nomatch` branches (and cf_menu's per-option branches) can only come from imported, AI-generated, template or seeded graphs. The runtime and normalizer honour the explicit handle names. Do not port the defect: render every declared port.
  2. `FlowNormalizer` turns handle names into 1-based port numbers: `p<i>` -> i+1; `else` -> 0; condition yes=1, no=2; book_appointment booked=1, no_slots=2; commerce purchased=1, abandoned=2; google_form submitted=1, timeout=2; deal created=1, error=2; anything else (including `out`) -> 1. The runtime looks for `<nodeId>_<port>` edges. The `cf_*` and `ig_*/fb_*/tg_*` runners read the raw handle names instead.
  3. Card previews truncate text (message 140 chars, etc.) and never execute anything.
  4. Node ids are `n_` + six lowercase base36 characters; generated client-side; unique per flow only.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a Buttons node with options A, B, C, then it exposes ports `p0`, `p1`, `p2`.
  - Given an Ask node with two expected answers, then ports `p0`, `p1` and `else` exist; with zero answers only `out`.
  - Given a Condition node, then edges use the handles `yes` and `no` and normalise to ports 1 and 2.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`nodeRows`, `isMultiPort`, `NodeCard`, `renderPreview`), `app/Services/Flows/FlowNormalizer.php` (PORT_MAP, handleToPort).
- **Port notes:** define port derivation once (a pure function `portsFor(node)`) in the shared contracts package and reuse it in the builder, save-time validation and the runtime.

### WD-FLB-018 — Pre-save graph validation

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-017
- **Summary:** Save and Publish run a client-side guard that blocks obviously broken graphs and lists the reasons in a red popup, outlining the offending nodes.
- **Actors & access:** workspace admin. Client-only; the server does not repeat these checks.
- **UX & screens:** red-bordered toast at the top: "Can't save — N node(s) need fixing", up to six bullet reasons plus "…and N more.", footer "The affected nodes are outlined in red. Connect them, then save again."; the first offending node is selected. The popup and red outlines reset whenever the edge list changes.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. An empty canvas is valid.
  2. A non-start, non-trigger node with no incoming edge is invalid: `"<Label>" has no incoming connection — nothing leads into it.` when it has outgoing edges, else `"<Label>" is not connected to anything.` A leaf node with no outgoing edge is allowed (a flow may end on any node).
  3. Channel check: every node whose type is not available in the current mode (and is not hidden/legacy or unknown) is flagged: `"<Label>" does not work on <Instagram|Facebook|Call|WhatsApp> — delete it or switch the channel back on the Trigger node.` (any other channel shows the label "WhatsApp" in this sentence, QUIRK).
  4. Sender check: if the Trigger exists, has an empty `deviceId`, and the workspace actually has a sender to pick for that channel, the trigger is flagged: `The Trigger node has no <number|Instagram account|Facebook Page> selected — pick one on the Trigger step.` The check only consults cached senders for chat / Instagram / Facebook; for TikTok, Telegram, LINE, WeChat, Viber and Email no sender check is applied at save time (the inspector still shows a red hint). If the workspace has no sender the flow may still be saved (draft) so an unconnected workspace can build flows.
  5. NOT checked: presence of a Trigger, required fields (empty message text, unset template, missing URL), dangling edges to deleted nodes, cycles, unreachable subgraphs from START, port completeness (an option with no edge is fine), node count.
  6. The check runs on Save and on Publish (the Publish click runs it first).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a Message node with no incoming edge, when Save is clicked, then the popup lists `"Send message" is not connected to anything.` and the node is outlined red.
  - Given a WhatsApp-only Google Sheets node on a flow whose Trigger channel was switched to Instagram, then Save is blocked with the "does not work on Instagram" reason.
  - Given a workspace with connected numbers and a Trigger without a number, then Save is blocked; with no connected numbers it saves.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`runValidation`, `saveFlow`).
- **Port notes:** re-implement server-side as well (single validator in contracts) and add the missing checks (required fields, reachability from START, dangling references) as warnings on save and errors on publish.

### WD-FLB-019 — Save flow (create / update)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-018
- **Summary:** The Save button persists the graph. A new flow first asks for a name in a confirm modal; an existing flow saves silently. The server validates, derives trigger columns, encrypts and stores the graph, mirrors it to disk, and syncs the managed keyword rule.
- **Actors & access:** workspace admin; plan limit `flow_limit` on CREATE only.
- **UX & screens:** toolbar Save ("Save changes" when the flow already has an id). For a new flow `SaveConfirmModal` ("Save flow / Confirm name, then save", input "Flow name" placeholder "e.g. Welcome flow", Enter submits, buttons Cancel / Save flow with a spinner "Saving…"). On success: toast `Flow saved · "<name>"`, status reverts to Draft (or stays Published), and for a new flow the URL is replaced with `/flows/builder/<id>` (via `history.replaceState`). On failure: status "Draft · unsaved" and toast `Save failed: <message>`.
- **Endpoints:**

| Method uri          | Route name          | Controller@action       | Middleware                         | Request                                                                                                                                                                           | Response                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ------------------- | ----------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST flows/api/save | user.flows.api.save | FlowsController@apiSave | Authenticate, workspace.role:admin | JSON `flow_id` (nullable int), `flow_name` (required string max 255), `flow_data` (required array), `category` (nullable string max 64), `flow_type` (nullable in the ten values) | 200 `{success:true, message:'Flow saved successfully', data:{flow_id, flow_name, flow_file_path, created_at, updated_at}}`; 401 `{success:false,message:'User not authenticated'}`; 404 `{message:'Flow not found'}` for a foreign/unknown `flow_id`; 422 `{success:false, message, errors}` for validation OR any thrown error (the exception message is surfaced as `errors.flow_data[0]`) |

- **Data:** builder posts `flow_data = {flowNodes: nodes, flowEdges: edges, vars}` and `flow_type = flowTypeOf(nodes)`. Server steps: (1) `normalizeMediaUrls` (a no-op for the React shape, it only touches legacy `flowReplies` media entries and makes relative URLs absolute); (2) `extractTriggerColumns` (WD-FLB-020); (3) UPDATE: `fill` name, `flow_data` (json string encrypted by cast), category (request value or existing), `flow_type` (request or existing or chat) plus the trigger columns, `save()`, `refresh()`; CREATE: PlanLimitGuard `flow_limit` against `count(flows in workspace)`, then create with `user_id`, `workspace_id`, `is_published=false`, `is_active=true`, `category` or null, `flow_type` or chat plus trigger columns; (4) `saveFlowFile` mirror to `storage/app/flows/flow_<id>.json` and store `flow_file_path`; (5) best-effort `syncInstagramFlow` push when `flow_type=instagram`.
- **Rules & edge cases:**
  1. Each save overwrites the whole graph; no versioning, no optimistic locking, no revision history (two admins editing the same flow race; last save wins).
  2. Editing never re-checks the plan limit ("edits don't count toward the cap").
  3. The model `saved` hook runs inside the save; it throws for over-long keywords (> 255 chars). `apiSave` catches every Throwable and returns 422 with that message, so the operator sees "Trigger keyword is too long (N characters; the limit is 255). Open the flow's Trigger node and shorten the keywords — remove duplicates or extra phrases." instead of a 500.
  4. A blank flow name is impossible via the modal (the Save button disables on blank), but the server accepts any non-empty string up to 255.
  5. `vars` is stored but see WD-FLB-023.
  6. The server does not validate node shapes, ports, sender ownership (the trigger's account id is trusted; only the Instagram automation sync re-verifies workspace ownership) or count nodes (`flow_steps_limit` unenforced).
  7. A flow with the file mirror missing still loads from the encrypted column; the mirror is a fallback only.
  8. Response `updated_at` etc. are the row timestamps in the app timezone (stored UTC).
- **Async & events:** model events (`saved` -> keyword rule sync -> possible Instagram automation sync), `LogsNotifications` writes a Notification row on create/update/delete, Instaflow push for Instagram flows, log lines `[FLOW-SAVE] created|updated`.
- **External systems:** Instaflow bridge (Instagram flows only, see WD-FLB-079).
- **Settings:** plan `flow_limit`.
- **Acceptance criteria:**
  - Given a new flow with a valid graph, when Save is confirmed with the name "Welcome", then a draft row exists (`is_published=false`, `is_active=true`), the URL becomes `/flows/builder/<id>` and a second Save updates the same row.
  - Given the workspace is at its plan limit, when creating, then the response is 422 with the plan message and no row is created; when editing an existing flow, the save succeeds.
  - Given a keyword trigger with 300 characters, then the save returns 422 with the "Trigger keyword is too long" message; note the row itself has already been updated by then (the hook runs after the write and there is no transaction), so the new graph is persisted although the operator saw an error.
  - Given a `flow_id` from another workspace, then 404.
- **Source refs:** `app/Http/Controllers/FlowsController.php` (apiSave, extractTriggerColumns, normalizeMediaUrls), `app/Models/Flow.php`, `resources/js/charts/user-flows-builder.js` (saveFlow, SaveConfirmModal).
- **Port notes:** wrap create/update + trigger denormalisation + rule sync in one DB transaction (WaDesk's hook throws after the row is already updated). Add graph versioning (`flow_versions`) so publish snapshots an immutable version and edits go to a draft; the runtime should load the published version.

### WD-FLB-020 — Trigger column extraction and sender binding

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-019
- **Summary:** On every save/import/clone/import-IG the server reads the Trigger node and denormalises it into `trigger_kind`, `trigger_value`, `trigger_device_id`, `trigger_keywords` (and `provider`) so enrolment queries never decrypt `flow_data`.
- **Actors & access:** internal to save paths.
- **UX & screens:** none (see the Trigger inspector in WD-FLB-030).
- **Endpoints:** none of its own.
- **Data:** algorithm (`extractTriggerColumns`):
  1. Find the FIRST node of type `trigger`; `d = its data`. `kind = d.kind` (default `keyword`), coerced to `keyword` if not one of the 12 allowed kinds: keyword, tag_added, group_join, manual_enroll, contact_created, opt_in, order_placed, appointment_booked, deal_stage_changed, away, out_of_hours, comment_to_dm (note: `appointment_booked` is allowed but the builder never offers it and nothing fires it; also a Call-flow trigger `kind:'start'` from the AI prompt is coerced to `keyword`).
  2. `trigger_value`: tag_added -> `int(d.tagId)` or null; group_join -> `int(d.groupId)`; deal_stage_changed -> `int(d.stageId)`; contact_created, opt_in, order_placed, away, out_of_hours -> `0`; comment_to_dm -> `0`; all other kinds -> null.
  3. Sender: `d.deviceId` is a composite string `"<engine>:<id>"`; the engine part must be one of baileys, waba, twilio, instagram, facebook, tiktok, telegram, line, wechat, viber, email (lower-cased). Then `provider = engine` and `trigger_device_id = int(id)`. A bare integer (legacy flows) sets only `trigger_device_id` and leaves `provider` untouched. An unknown engine prefix sets neither. A blank value gives `trigger_device_id = null` ("workspace default / first active number").
  4. `trigger_keywords`: only for kind `keyword`: if `d.keywordMode` (or legacy `triggerMode`) is `any` -> the literal `any`; else the trimmed `d.keywords` string or null. For `comment_to_dm` -> a comma-joined list of the integer ids in `d.keywordRuleIds` (empty list -> null, meaning "any comment-to-DM rule").
- **Rules & edge cases:**
  1. The engine key must be `baileys`, not `unofficial`: "Unofficial API" is only a UI label; writing `unofficial` would hide the flow from the engine scopes.
  2. Because `devices.id` and `wa_provider_configs.id` are separate auto-increment namespaces that overlap, the engine prefix is mandatory for correctness; `trigger_device_id` is polymorphic and must always be read together with `provider`.
  3. A flow with no Trigger node is saved with `trigger_kind='keyword'`, `trigger_keywords=null` and never fires by keyword.
  4. `safeTriggerColumns` (used by IG import) swallows extraction exceptions.
  5. Index `flows_trigger_idx (trigger_kind, trigger_value)` supports enrolment lookups.
- **Async & events:** none directly.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given trigger `{kind:'tag_added', tagId:'7', deviceId:'waba:3'}`, then the row gets `trigger_kind=tag_added`, `trigger_value=7`, `trigger_device_id=3`, `provider=waba`.
  - Given `{kind:'keyword', keywordMode:'any'}`, then `trigger_keywords='any'`.
  - Given `{kind:'order_placed'}`, then `trigger_value=0`.
  - Given `{kind:'nonsense'}`, then `trigger_kind='keyword'`.
- **Source refs:** `app/Http/Controllers/FlowsController.php` (extractTriggerColumns), `app/Models/Flow.php` (TRIGGER_KINDS), `database/migrations/2026_05_24_090000_merge_drip_into_flows.php`, `database/migrations/2026_06_19_000400_flow_keyword_trigger_sync.php`.
- **Port notes:** store the sender as two columns (`sender_engine`, `sender_ref` or a proper FK per channel) instead of the polymorphic int; make trigger a first-class table (`flow_triggers`) keyed by flow, with a unique constraint per kind/value/sender to support the matchers.

### WD-FLB-021 — Managed keyword-trigger rule sync

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-020
- **Summary:** The inbound WhatsApp matcher only reads `keyword_replies`, never the encrypted graph, so every flow save/publish/pause/delete re-creates a "managed" auto-reply row (`reply_type='flow'`, `is_flow_trigger=true`) that starts the flow when a customer's message matches.
- **Actors & access:** automatic (model hook).
- **UX & screens:** the managed rule is visible in the auto-reply list (AR domain); it should not be edited by hand.
- **Endpoints:** none.
- **Data:** on `saved`: force-delete existing managed rows for this flow (`flow_id` + `is_flow_trigger`, including trashed); then, if `trigger_kind='keyword'`, create one `keyword_replies` row: `user_id`, `workspace_id`, `device_id = trigger_device_id`, `provider = flow.provider or WorkspaceEngine::for(workspace)`, `keyword` = the keyword string (or `''` for catch-all), `matching_method` = `contains` (or `exact` for catch-all), `is_catch_all` = true when the keywords are exactly one of `*`, `.*`, `.+`, `any`, `fuzzy_similarity` 80, `reply_type='flow'`, `flow_id`, `is_flow_trigger=true`, `message_type='text'`, `status = is_published AND is_active`.
- **Rules & edge cases:**
  1. "Any message" (`any`) is a separate lowest-priority tier (catch-all) that runs only when no keyword flow matched; keyword flows always win. Legacy `*`/`.*`/`.+` spellings still work.
  2. Keyword text longer than 255 characters (`keyword_replies.keyword` is VARCHAR(255)) throws a RuntimeException with the human message quoted in WD-FLB-019; it is surfaced by `apiSave` as a 422, but on Publish / Toggle / Duplicate / Import / Clone the same exception is NOT wrapped and results in a 500 (QUIRK).
  3. No rule is created when keywords are empty or the flow has no `workspace_id` (logged as a warning); the rule's `device_id` may be NULL, and the matcher is device-scoped, so a flow without a sender pinned will not match any inbound (logged as "device_id is NULL").
  4. Instagram flows are excluded (they get a managed `instagram_automations` row of type `flow` instead, bound to the chosen `InstagramAccount` only if it belongs to the workspace; catch-all spellings there are `*`, `.*`, `.+`; `match_mode` any/contains; active only when published+active). Facebook, TikTok, Telegram and Email flows create NO rule: their ingest services query `flows` directly by `flow_type` and `trigger_device_id`.
  5. QUIRK / possible defect: the early-return list omits `call`, `line`, `wechat` and `viber`. A published+active flow of those types with the default keyword trigger therefore DOES create a `keyword_replies` row whose `device_id` holds a non-device id (channel row id) and could collide with a real `devices.id`. LINE / WeChat / Viber webhooks already resolve their own flows. Treat as a bug, do not port (see Open questions).
  6. The rule is destroyed when the flow is deleted (deleting/deleted hooks).
- **Async & events:** model events `saved`, `deleting`, `deleted`; log lines `[FLOW-KW-SYNC]`.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a published+active WhatsApp flow with keywords "price, cost" and a number pinned, then exactly one active managed rule exists; pausing the flow makes it inactive; deleting removes it.
  - Given `keywordMode='any'`, then the rule is a catch-all with empty keyword and `matching_method='exact'`.
  - Given a Facebook flow, then no `keyword_replies` row is created.
  - Given a 300-char keyword string, then the sync throws and the operator sees the length message.
- **Source refs:** `app/Models/Flow.php` (booted, syncKeywordTriggerReply, syncInstagramTriggerAutomation), `database/migrations/2026_06_19_000400_flow_keyword_trigger_sync.php`, `app/Services/Inbox/KeywordReplyDispatcher.php`.
- **Port notes:** in the port, model the flow's keyword trigger as its own matcher table read directly by the inbound pipeline (no synthetic auto-reply rows), with an explicit priority tier for catch-all, and dedupe keyword collisions across flows.

### WD-FLB-022 — Publish and unpublish

- **Status:** partial
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-019
- **Summary:** Publish makes a saved flow eligible to run (`is_published=true`, `published_at=now`). Unpublish returns it to draft. Only Publish has a UI; the unpublish endpoint exists without any caller.
- **Actors & access:** workspace admin.
- **UX & screens:** toolbar Publish button (check icon). It first runs the client validation (WD-FLB-018), saves a never-saved flow, then publishes; success sets the status pill to "Published" and toast "Published"; failure toast `Publish failed: <message>`. The status pill shows Published / Unsaved / Draft (dot green / coral / grey). Published flows that are edited go "Draft · unsaved" only in the label, the flow stays published on the server and the next Save silently republishes the new graph (edits are live on Save).
- **Endpoints:**

| Method uri               | Route name               | Controller@action            | Middleware                         | Request                         | Response                                                                                           |
| ------------------------ | ------------------------ | ---------------------------- | ---------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------- |
| POST flows/api/publish   | user.flows.api.publish   | FlowsController@apiPublish   | Authenticate, workspace.role:admin | JSON `flow_id` required integer | `{success:true, message:'Flow published', data:<flow>}`; 422 validation; 404 (findOrFail)          |
| POST flows/api/unpublish | user.flows.api.unpublish | FlowsController@apiUnpublish | same                               | `flow_id`                       | `{success:true, message:'Flow unpublished', data}`; sets `is_published=false`, `published_at=null` |

- **Data:** writes `flows.is_published`, `flows.published_at`; the response embeds the whole flow row.
- **Rules & edge cases:**
  1. QUIRK / DEFECT: publishing a flow that has never been saved calls `/flows/api/save` TWICE. The second call reuses the stale closure value `flowId = null`, so it creates a SECOND flow row, and the second row is the one that gets published. The first (draft) row stays in the list and the builder's state points at it. It also consumes an extra slot of `flow_limit`. Do not port; publish the row just saved.
  2. Publish performs no server-side graph validation, no sender check and no plan feature check.
  3. Publish triggers the `saved` hook (keyword rule becomes active if the flow is also active) and re-pushes Instagram flows to Instaflow so their keyword matcher goes live.
  4. Unpublish has no UI (the docs describe "Unpublish"); pausing is the only UI way to stop a live flow. There is no "unpublish" toast text in the UI code.
  5. Because saves on a published flow go live immediately there is no draft/live separation and no rollback.
- **Async & events:** `saved` hook, Instaflow push.
- **External systems:** Instaflow (Instagram flows).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a saved draft, when Publish is clicked, then `is_published=true`, `published_at` is set, the pill reads Published and its keyword rule becomes active.
  - Given a flow with an unconnected node, when Publish is clicked, then nothing is saved and the red validation popup appears.
  - Given a brand-new unsaved graph, when Publish is clicked, then exactly ONE flow row exists afterwards and it is published (target behaviour; WaDesk creates two).
  - Given an API call to unpublish, then `is_published=false` and the rule goes inactive.
- **Source refs:** `app/Http/Controllers/FlowsController.php` (apiPublish, apiUnpublish), `resources/js/charts/user-flows-builder.js` (Toolbar, onPublish handler).
- **Port notes:** implement publish as "snapshot current draft to an immutable version + set live version", add unpublish to the UI, and make publish transactional with the trigger/rule sync.

### WD-FLB-023 — Flow variables modal

- **Status:** dead-code
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-014
- **Summary:** A "Variables" modal (name / description / default rows) whose contents are saved inside the flow as `vars`, but nothing in the shipped UI opens it and nothing in the runtime reads the definitions.
- **Actors & access:** workspace admin.
- **UX & screens:** `VarsModal` component (title "Variables", "Reference these as {{var_name}} in any message or condition.", per-row name (mono) / description / default and a remove icon, "Add variable" adding `new_var`, Done). The Toolbar accepts an `onVars` prop but renders no button for it, so the modal is unreachable. Default rows: `name` ("Contact name") and `phone` ("Phone number").
- **Endpoints:** none.
- **Data:** `flow_data.vars` is an array of `{name, desc, default}`. State is initialised to the two default rows on every builder load and is NOT hydrated from the saved `vars` (QUIRK: each save overwrites any `vars` the flow carried with the two defaults). Import/template graphs keep their `vars` in storage but the builder never reads them back.
- **Rules & edge cases:** the runtime substitutes `{{name}}` from per-session variables (contact seed values, Ask/AI/Webhook saves) and never applies `vars[].default`; `FlowNormalizer` forwards `vars` untouched. Treat the concept as docs-only for parity, and decide deliberately whether the port ships flow-level variable declarations with defaults.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given any builder session, then no control opens the Variables modal (parity), and saving stores `vars` as the two defaults.
  - Given a port that ships the feature, then declared defaults must resolve when a session variable is unset.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (VarsModal, Toolbar props, FlowApp vars state), `app/Services/Flows/FlowNormalizer.php` (normalize returns vars).
- **Port notes:** either drop it or implement properly (declared variables with type/default surfaced in the "/" attribute picker).

### WD-FLB-024 — Test runner (simulate a chat) and webhook test endpoint

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-017
- **Summary:** The Test button opens a floating chat simulator that walks the canvas graph in the browser (no messages are sent). Webhook nodes are the one exception: they fire the real HTTP request through an SSRF-guarded server endpoint so the operator can confirm their endpoint and use `{{response.field}}` downstream.
- **Actors & access:** workspace admin.
- **UX & screens:** `TestPanel` (bottom-right, 380 px, title "Test runner / Simulate a chat", Restart, close). Opening it (or `?test=1`) starts a run: the bot waits for the operator's first message (hint `Type "<first keyword>" (or any keyword: a, b) to start the flow.` when the START trigger has keywords, else "Type any message to start the flow."); an off-keyword first message still runs with the system note "(message didn't match any keyword — running anyway for testing)". Input is disabled ("Waiting for bot…") until the simulation awaits a reply. Log entries: system (italic grey), user (green right), bot (white left, with image/video/audio/document media rendering).
- **Endpoints:**

| Method uri                  | Route name                  | Controller@action              | Middleware                         | Request                                                                                                                                                                                 | Response                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | --------------------------- | ------------------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST flows/api/test-webhook | user.flows.api.test-webhook | FlowsController@apiTestWebhook | Authenticate, workspace.role:admin | JSON `url` required string max 2048; `method` nullable max 10; `body` nullable string; `contentType` nullable max 120; `headers` nullable array of `{key,value}`; `vars` nullable array | 200 `{ok:true, status, success, response (first 4000 chars), json (decoded array when the response Content-Type contains json)}`; failures are also 200 `{ok:false, error:'No URL configured on the webhook node.' \| 'Blocked: <reason>' \| 'Request failed: <200 chars>'}`; 401 `{ok:false,error:'Not authenticated'}` |

- **Data:** none stored. Simulation variables start as `name='Anya'`, `phone='+919876543210'`; the first user message becomes `user_message`.
- **Rules & edge cases:**
  1. Start node = the pinned START node, else the first trigger, else node 0. Empty canvas: "Canvas is empty. Add a trigger and at least one node, then click Restart.". Steps advance after a 220 ms pause.
  2. Merge tags: `{{var}}` with word characters only in the client `interp`; unknown variables stay literal.
  3. Per node: message -> bot bubble; sequence -> one bubble per reply (media rendered, caption bubble); media -> media bubble; template -> `[template: name]` + preview, awaits a tap when it has quick-reply buttons; buttons / list / poll -> numbered options, awaits a reply (title match case-insensitive, or a 1-based number, or falls back to option 1); ask -> prompt, awaits, saves the reply under `data.var` (default `answer`), routes `p<i>` on a case-insensitive expected-answer match else `else`; condition -> evaluates the AND/OR chain with the same operators as the runtime evaluator and logs `if <summary> -> YES|NO`; delay -> "wait N unit (skipped in test)"; code, mysql, ai, chatbot, tag, assign, subflow, Sheets/Docs/Meet/Form/deal/wa_form/booking -> mocked log lines and immediate advance (google_form advances via `submitted`, book_appointment via `booked`, deal via `created`); commerce -> lists products, awaits: a number = purchase (sets `commerce_choice`, `order_id` TEST-xxxx, `order_total`, `order_currency`, routes `purchased`), anything else = `abandoned`; commerce with no products goes straight to `abandoned`; cta / location -> text rendering; notify_number / wa_to_instagram -> system/bot line with the target; end -> "Flow ended.".
  4. Not simulated (logged "unknown node type ... — skipping" and advanced via `out`): google_meet, ai_call, all `cf_*`, `ig_*`, `fb_*`, `tg_payment`.
  5. Ask `validate` (email/phone/number) is not simulated.
  6. Webhook node in test: substitutes `{{ var }}` (spaces allowed, dotted keys looked up literally), method default POST (values outside GET, POST, PUT, PATCH, DELETE, HEAD fall back to POST), custom headers with non-empty keys, sends the body for non GET/HEAD only when non-empty, timeout 15 s, redirects disabled ("fail closed on 3xx"), then stores the response text under the node's `save` variable (`response` default) and flattens JSON object fields to `<save>.<field>`.
  7. SSRF guard (`guardSsrf`): only http/https; hostname must resolve (A via `gethostbynamel`, else AAAA) to public addresses (private/reserved ranges rejected, message `host resolves to a private/reserved IP (x)`); hosts containing `metadata.` or ending `.internal` are refused ("metadata host not allowed"); unresolvable -> "hostname did not resolve to a public IP". Resolution and connection are separate lookups (DNS-rebinding window); the port should resolve once and pin the IP.
  8. The runtime Webhook node has its own SSRF check in Node (`assertPublicHttpUrl`); keep both.
- **Async & events:** none.
- **External systems:** whatever URL the operator configured (only for Webhook nodes).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a flow Trigger -> Ask (var `name`) -> Message "Hi {{name}}", when the operator types "hello", answers "Sam", then the log shows the prompt, the reply and "Hi Sam".
  - Given a Webhook node pointed at `http://169.254.169.254/x`, when reached in test, then the log shows "webhook failed: Blocked: host resolves to a private/reserved IP (169.254.169.254)" and the flow continues via `out`.
  - Given a Condition with `plan equals pro` and the variable unset, then the log shows the NO branch.
  - Given a Buttons node whose port is unwired, when option 2 is chosen, then the log says `Port "p1" (option 2) not connected — stop.`
- **Source refs:** `resources/js/charts/user-flows-builder.js` (TestPanel, stepTest, sendTest, checkCond), `app/Http/Controllers/FlowsController.php` (apiTestWebhook, guardSsrf).
- **Port notes:** run the simulator against the same shared graph-walker as production (compile once in contracts) instead of a parallel client implementation, or the two will drift; make the webhook test a server job with IP pinning.

### WD-FLB-025 — Generate a flow with AI

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-026
- **Summary:** "Generate with AI" turns a plain-language description into nodes and edges on the canvas using an admin-enabled (or workspace BYOK) LLM.
- **Actors & access:** workspace admin. No plan feature check and no usage/credit debit is performed by this controller (confirm in AIADM whether `callProvider` meters).
- **UX & screens:** gradient toolbar button opens `AIGenModal`: "AI Flow Generator / Generate a flow with AI / Pick a model, describe what you want, and AI will build the nodes." Model tiles (one per provider+model with a coloured dot and provider label), a textarea (placeholder "Example: Create a customer support bot that asks for user name, email, and issue type, then sends a confirmation message…"), four "Quick examples" (Customer support bot with name, email collection; Order tracking with order number verification; Lead qualification bot with budget questions; Appointment booking with date and time selection), footer text "AI will replace the current flow." and buttons Cancel / Generate (disabled without prompt and model; spinner while loading). Errors show inline (`j.message` or `Generation failed (<status>)`). With no enabled providers the tile area reads "No AI providers enabled. Admin needs to add a key in AI Keys before this can run.".
- **Endpoints:**

| Method uri                 | Route name                 | Controller@action             | Middleware                         | Request                                                                                                                                                            | Response                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | -------------------------- | ----------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST flows/api/ai-generate | user.flows.api.ai-generate | FlowsController@apiAiGenerate | Authenticate, workspace.role:admin | JSON `prompt` required max 2000; `model` required max 120; `provider` required in openai, anthropic, gemini; `flow_type` nullable in the ten values (default chat) | 200 `{ok:true, flow:{flowNodes,flowEdges}, model}`; 422 `{ok:false,error:'no_workspace',message:'Could not resolve your active workspace. Try refreshing the page.'}`; 422 `no_key` ("Admin has not enabled this provider in /admin/api-keys. Pick another provider or contact your admin."); 502 `provider_failed` ("AI provider returned no content — check API key + model id."); 422 `bad_json` ("Model output was not valid flow JSON. Try a clearer prompt.") with a 600-char `raw` preview |

- **Data:** none stored; the client applies the returned graph.
- **Rules & edge cases:**
  1. Key resolution: `AiKeyResolver::resolve(workspace, provider)` (workspace BYOK first, then admin key); no key -> `no_key`.
  2. Generation call: max tokens 8000, temperature 0.4, JSON mode forced. Response cleanup: strip ``` fences anywhere, slice to the outermost `{...}`, `json_decode`; require `flowNodes` array. Then cap: at most 20 nodes and 40 edges.
  3. The system prompt for chat-like flows names only these node types and shapes: trigger, message, sequence, ask, buttons, list, condition, delay, template, ai, cta, location, poll, tag, assign, webhook, book_appointment, whatsapp_shop, woocommerce, shopify, end, with the handle conventions (`out`, `p0..`, `else`, `yes/no`, `booked/no_slots`, `purchased/abandoned`) and rules: exactly one trigger first, end every branch, left-to-right layout (+360 x per step, y 200, branches +-260), unique ids `n_`/`e_`, `{{var}}` merge tags, no emojis, at most 12 nodes. It does not know media, code, mysql, subflow, chatbot, Google, deal, notify, or any channel-specific node, and the chat prompt is used for Instagram/Facebook/etc. too (so output can include nodes the channel cannot run; save-time validation then blocks them).
  4. For `flow_type=call` a voice-only prompt is used: trigger `{kind:'start'}`, cf_say, cf_listen, cf_ai, cf_menu, cf_search, cf_transfer, cf_hangup (no cf_assistant), every branch ends with cf_hangup/cf_transfer, max 12 nodes. QUIRK: `kind:'start'` is not an allowed trigger kind and is coerced to `keyword` on save (WD-FLB-020).
  5. QUIRK: the model picker also lists Mistral (from admin keys and BYOK) but the endpoint rejects `provider=mistral` with a 422 validation error, so Mistral models can be picked but not used for generation.
  6. Client apply: replaces the entire canvas (no merge/undo warning beyond the footer text), backfills ids/types/coordinates (defaults x 100, y 200)/data defaults, forces exactly one `isStart` (first trigger else first node), drops edges with unknown endpoints, defaults `sourceHandle` to `out`, pushes an undo snapshot, sets status "Draft · unsaved (AI-generated)" and toast `Flow generated with <model label>`.
- **Async & events:** none (synchronous request; long generations can hit web-server timeouts).
- **External systems:** OpenAI / Anthropic / Gemini via `AiAgentService::callProvider`; credentials from admin AI keys or the workspace's own keys.
- **Settings:** admin AI keys (`admin_ai_keys`), workspace BYOK keys.
- **Acceptance criteria:**
  - Given an enabled OpenAI key and the prompt "Greet the customer, ask their name, then offer a list of services", when Generate is clicked, then at most 20 nodes and 40 edges are placed with one START trigger.
  - Given no key for the selected provider, then the modal shows the `no_key` message.
  - Given the model replies with prose plus a fenced JSON block, then the fences and prose are stripped and the flow still loads.
  - Given a prompt over 2000 characters, then 422.
- **Source refs:** `app/Http/Controllers/FlowsController.php` (apiAiGenerate, apiAiModels), `resources/js/charts/user-flows-builder.js` (AIGenModal, onGenerate), `Documentation/pages/automation/flows.html`.
- **Port notes:** run generation as a queued job with progress (BullMQ) to avoid request timeouts; validate the model output against the shared node schema and drop or repair invalid nodes before returning; meter the call in the AI usage domain.

### WD-FLB-026 — Builder reference-data endpoints (pickers)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-014
- **Summary:** JSON endpoints the builder uses to populate dropdowns: the Trigger picker (tags, groups, senders per channel, comment-to-DM rules), AI models, trained assistants, voice assistants, the workspace's other flows and the default flow.
- **Actors & access:** workspace admin.
- **UX & screens:** consumed by the Trigger, AI, Chatbot, Sub-flow, cf_ai, cf_assistant and ai_call inspectors.
- **Endpoints:**

| Method uri                    | Route name                     | Controller@action                 | Middleware                         | Request    | Response                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------ | --------------------------------- | ---------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET flows/api/picker          | user.flows.api.picker          | FlowsController@apiPicker         | Authenticate, workspace.role:admin | none       | `{ok, tags:[{id,name,color}], groups:[{id,name}], devices:[{key,id,device_name,phone_number,provider,engine_label}], instagram:[{key:'instagram:<id>',id,label:'@user',username}], facebook:[{key,id,label}], tiktok, telegram, line, wechat, viber, email, keywordRules:[{id,keyword,active}]}`; sends `Cache-Control: no-store, no-cache, must-revalidate, max-age=0` and `Pragma: no-cache`; 401 `{ok:false,error:'no_workspace'}` |
| GET flows/api/ai-models       | user.flows.api.ai-models       | FlowsController@apiAiModels       | same                               | none       | `{ok, models:[{value,label,provider}]}`                                                                                                                                                                                                                                                                                                                                                                                               |
| GET flows/api/ai-assistants   | user.flows.api.ai-assistants   | FlowsController@apiAiAssistants   | same                               | none       | `{ok, assistants:[{id,name,status,sources}]}`                                                                                                                                                                                                                                                                                                                                                                                         |
| GET flows/api/call-assistants | user.flows.api.call-assistants | FlowsController@apiCallAssistants | same                               | none       | `{ok, assistants:[{id,name}]}`                                                                                                                                                                                                                                                                                                                                                                                                        |
| GET flows/api/list            | user.flows.api.list            | FlowsController@apiIndex          | same                               | none       | `{success:true, data:[all workspace flows, updated_at desc]}`                                                                                                                                                                                                                                                                                                                                                                         |
| GET flows/api/default         | user.flows.api.default         | FlowsController@apiDefault        | same                               | none       | newest published+active flow by `published_at` as `{success, data:{flow, flow_data}}`, else 404 `{success:false,message:'No default flow found'}` (no UI caller)                                                                                                                                                                                                                                                                      |
| GET flows/api/{id}            | user.flows.api.show            | FlowsController@apiShow           | same                               | numeric id | `{success, data:{flow (with connectedDevices), flow_data}}`, 404 `{success:false,message:'Flow not found'}` (no UI caller)                                                                                                                                                                                                                                                                                                            |

- **Data:**
  - Picker tags: `tags` of the workspace ordered by name. Groups: `contact_groups` decrypted `user_group` mapped to `{id,name}` then sorted case-insensitively in PHP (ordering the encrypted column would sort ciphertext). Devices: `WorkspaceEngine::senders(ws)` (connected numbers of every enabled engine: Baileys, WABA, Twilio); `key` is `"<engine>:<id>"` and MUST be carried through unflattened; label falls back to `"<ENGINE> #<id>"`. Instagram: native `InstagramAccount` (connected, ordered by username) plus Instaflow-bridge `WorkspaceIgAccount` rows de-duplicated by lower-cased username. Facebook: connected `FacebookPage` (`facebook:<row id>`). TikTok: connected accounts (label display name, else @username, else "Account <id>"). Telegram: active bots (label bot_name, @bot_username or "Bot <id>"). LINE: active channels (display_name, basic_id, "LINE <id>"). WeChat: active (account_name, wx_id, "WeChat <id>"). Viber: active (bot_name, bot_uri, "Viber <id>"). Email: only if setting `email_enabled` and a connected mailbox exists (name or address). All channel lookups are guarded with `class_exists`/try-catch so a missing extension yields an empty list, never a 500. `keywordRules`: only when column `keyword_replies.ig_trigger` exists: workspace rules with provider `instagram` and `ig_trigger='comment_to_dm'`, ordered by keyword, `active` = status is `active`.
  - AI models: active `admin_ai_keys` (excluding provider `elevenlabs`) by `sort_order`; each contributes its `default_model` first then `extra_config.models`; rows without a default model are skipped; label `"<Provider> · <model>"` (OpenAI, Anthropic, Google, Mistral, else ucfirst). For every ACTIVE workspace `AiProviderKey` the admin models of that provider are dropped and replaced with fixed BYOK defaults labelled `"<Provider> (your key) · <model>"`: openai gpt-4o-mini, gpt-4o; anthropic claude-sonnet-4-6, claude-haiku-4-5-20251001; gemini gemini-2.0-flash, gemini-1.5-pro; mistral mistral-large-latest, mistral-small-latest. BYOK always appears regardless of plan flag.
  - AI assistants: `AiChatAssistant` of the workspace by name; `sources` = count of READY `AiTrainingSource` rows that are workspace-wide or assigned to that assistant. Call assistants: `AiCallAssistant` by name.
- **Rules & edge cases:** all lookups are workspace scoped via `current_workspace_id`; missing workspace returns empty lists (except the picker's 401); `apiIndex` returns full graphs for every flow (heavy, used only to fill the Sub-flow / handoff dropdowns); the models endpoint logs the admin key roster (diagnostic).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `admin_ai_keys`, `system_settings.email_enabled`.
- **Acceptance criteria:**
  - Given a workspace with a WABA number id 3, when the picker is called, then `devices[0].key === 'waba:3'` and `engine_label` is the engine's display label.
  - Given the workspace saved its own OpenAI key, then `models` contains only `OpenAI (your key) · ...` entries for OpenAI and still contains admin models for other providers.
  - Given no `keyword_replies.ig_trigger` column, then `keywordRules` is `[]`.
- **Source refs:** `app/Http/Controllers/FlowsController.php` (apiPicker, apiAiModels, apiAiAssistants, apiCallAssistants, apiIndex, apiDefault, apiShow), `app/Services/WorkspaceEngine.php`.
- **Port notes:** collapse into `GET /flows/builder-context` returning slim objects; do not ship full graphs in the flow list; add ETag caching except for the picker's no-store requirement (or key it by connection state).

### WD-FLB-027 — Flow media upload and inbound media store

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** none
- **Summary:** Media/Sequence nodes upload files to the platform media disk and store the returned public URL in the node; a separate Node-only endpoint stores inbound customer media (Ask node "accept a file") and returns an absolute URL.
- **Actors & access:** builder upload: workspace admin (`flows/api/upload-media`) or workspace manager and above via the shared route `api/upload-media` (used by template send-override panels). Store-media: Node token.
- **UX & screens:** in the Media node: Type select, dashed "Choose <kind> (or drag here)" upload area with `accept` by kind (image/_, video/_, audio/*, `.pdf,.doc,.docx,.xls,.xlsx`), preview, "Or paste a URL", filename, caption; caption "Up to 50 MB. We host the file and give the flow a public URL." Errors toast `Upload failed: <message>`.
- **Endpoints:**

| Method uri                  | Route name            | Controller@action              | Middleware                           | Request                                                                                       | Response                                                                                                                                               |
| --------------------------- | --------------------- | ------------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST flows/api/upload-media | user.flows.api.upload | FlowsController@apiUploadMedia | Authenticate, workspace.role:admin   | multipart `file` required file max 51200 KB, `type` required in image, video, audio, document | `{success:true, data:{url, filename, type, mimeType}}`; 422 `{success:false, errors:{file:[msg]}}`; 500 `{success:false,message:'Upload failed: ...'}` |
| POST api/upload-media       | user.api.upload-media | FlowsController@apiUploadMedia | Authenticate, workspace.role:manager | same                                                                                          | same (shared with campaigns / broadcasts / scheduled / inbox template panels)                                                                          |
| POST api/flow/store-media   | flow.store-media      | Closure (routes/api.php)       | api (X-Node-Token)                   | JSON `data` (data URI or bare base64), `mime` (default application/octet-stream)              | `{ok:true, path, url}`; 401 unauthorized; 422 `no_data` / `bad_base64`; 413 `too_large` (over 25 MB)                                                   |

- **Data:** upload stores at `flows/<type>s/<time>_<random24>.<ext>` on the active media disk (`media_disk()`: Cloudflare R2 when cloud storage is enabled, else the local public disk) and returns `media_url(path)` (absolute). Store-media writes `chat-media/<random24>.<ext>` (extension from the MIME via `WabaMediaFetcher::extFor`), the same convention as inbound webhooks so the AI agent's image resolver finds it.
- **Rules & edge cases:**
  1. Security: `SecureUpload::problem()` enforces an extension allowlist (jpg, jpeg, png, gif, webp, bmp, tiff, mp4, webm, mov, 3gp, mkv, pdf, doc, docx, xls, xlsx, ppt, pptx, txt, csv, rtf, zip, mp3, ogg, opus, m4a, aac, wav, amr), an explicit blocklist (php family, html, svg, xml, js, cgi, scripts, exe etc.) and content-sniffed MIME allowlist; the stored name is server-generated so a client extension can never reach disk. Messages: "The uploaded file is invalid.", "This file type is not allowed.", "This file content is not allowed.".
  2. QUIRK: `type` only picks the folder; it is not checked against the real file kind (an mp4 can be uploaded as `image`).
  3. QUIRK: the response `filename` is the randomised server name, `mimeType` is the client-declared type, so the label shown in the node can be the random name (the builder prefers `data.filename`).
  4. Relative media URLs pasted by hand are made absolute at read time by `FlowNormalizer::absoluteUrl` (not at save); URLs containing `{{` are left for runtime substitution.
- **Async & events:** none.
- **External systems:** object storage (R2/S3) when enabled.
- **Settings:** cloud storage toggle and disk config (SET), `media_disk()`.
- **Acceptance criteria:**
  - Given a 3 MB PNG uploaded as type `image`, then the response has an absolute `url` and the node shows a thumbnail.
  - Given `shell.php` renamed to `.png`, then the upload is rejected with the content/type message.
  - Given a 60 MB video, then validation fails (max 51200 KB).
  - Given a Node call to store-media with a 30 MB base64 body, then 413.
- **Source refs:** `app/Http/Controllers/FlowsController.php` (apiUploadMedia), `app/Support/SecureUpload.php`, `routes/api.php` (flow.store-media), `routes/web.php` (both upload routes).
- **Port notes:** presigned uploads to object storage, virus scan hook, per-workspace storage quota (SET), and a single asset table referencing files instead of raw URLs inside the graph.

### WD-FLB-028 — Plan, role and feature gates for flows

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** none
- **Summary:** Consolidated record of every gate that decides who can use flows and how many, including gates that exist in config but are not enforced.
- **Actors & access:** see rules.
- **UX & screens:** limit errors surface as a red banner (import), an inline `template` error (clone), or a 422 with the message (save).
- **Endpoints:** all `flows/*` routes.
- **Data:** plan columns on `packages`: `flow_limit` (integer; NULL / 0 / negative = unlimited), `flow_steps_limit`, `autoflow` (feature flag for the paywall and nav), `access_flows_commerce`.
- **Rules & edge cases:**
  1. Role: every `/flows*` and `/flows/api/*` route needs workspace role admin (owner included); platform admins and legacy `users.role` admin bypass. Exceptions: `POST api/upload-media` needs manager; node/callback routes use the shared `X-Node-Token`, not sessions; `GET api/google/picker/{kind}` needs admin.
  2. `flow_limit`: `PlanLimitGuard::check(workspace, 'flow_limit', count(flows where workspace_id))` on save-create, import, clone-template and import-IG; NOT on duplicate; edits never count. The count is a live row count, so delete frees a slot (message ends "...or delete an existing one to free up space."). Platform admins and unlocked plans bypass. Message shape: "You've reached your plan's limit of N flows. Upgrade your plan to add more, or delete an existing one to free up space."
  3. Soft paywall: `config/plan_gates.php` maps `flows` and `flows/*` to package flag `autoflow`; when off, the page still renders and `<x-plan-paywall>` overlays an upgrade sheet. Nav items `flows` and `flow-analytics` carry `feature: autoflow`. JSON endpoints ignore the flag.
  4. NOT enforced anywhere: `flow_steps_limit` (max nodes per flow), `access_flows_commerce` ("Commerce-aware flows" package flag; the commerce nodes and endpoints check nothing), and the permission keys `flows.view/create/edit/delete`.
  5. Sales-pipeline node callbacks enforce package flag `access_sales_pipeline`; Google node callbacks enforce the platform master switch (`GoogleCalendarService::isEnabled()`, admin setting `google_calendar_enabled`) and return 503 `integration_disabled` when off.
  6. AI generation and AI nodes have no plan gate here (the comment in `plan_gates.php` mentions in-context gating of "generate with AI" but no code exists in this controller).
  7. All Node-callback controllers refuse to authenticate when `node_token()` is empty (avoiding `hash_equals('', '')` passing).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** package columns above; `google_calendar_enabled`.
- **Acceptance criteria:**
  - Given `flow_limit=3` and 3 flows, when a fourth is saved, then 422 with the plan message; when a fourth is duplicated, then it succeeds (parity).
  - Given a manager, when opening `/flows`, then 403.
  - Given `autoflow` off, when opening `/flows`, then the page renders under the upgrade overlay.
- **Source refs:** `app/Services/PlanLimitGuard.php`, `app/Exceptions/PlanLimitReachedException.php`, `config/plan_gates.php`, `app/Support/UserNav.php`, `app/Models/Package.php`, `app/Http/Middleware/EnsureWorkspaceRole.php`, `routes/web.php`.
- **Port notes:** PLAN owns the flag registry; implement flow limits as a DB-level count with RLS; enforce `max_nodes_per_flow` server-side (the flag exists but WaDesk never enforces it) and put permission checks on the RBAC keys.

### WD-FLB-029 — Flow persistence model (encrypted graph, file mirror, engine stamp)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** none
- **Summary:** How a flow is stored: one `flows` row with an encrypted name and encrypted JSON graph, denormalised trigger columns, a state pair (`is_published`, `is_active`), a per-flow `flow_type`, an engine `provider`, and a non-public JSON file mirror.
- **Actors & access:** internal.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** see the Data model section for column details. Highlights: `flow_name` and `flow_data` use Laravel's `encrypted` cast; `flow_data` is a JSON string `{flowNodes:[{id,type,x,y,data,isStart}], flowEdges:[{id,source,sourceHandle,target,kind?}], vars:[]}`; accessor `decoded_flow_data` returns an array, falling back to the file mirror and finally to an empty graph. The mirror is `storage/app/flows/flow_<id>.json` (pretty JSON) with `flow_file_path='flows/flow_<id>.json'`; a legacy public copy under `public/uploads/flows/` is deleted on each save and a one-time migration moved older public copies into the private directory (they were once enumerable cross-tenant).
- **Rules & edge cases:**
  1. `provider` (default column value `baileys`) is stamped on create from `WorkspaceEngine::for(workspace)`; the trigger sender can overwrite it later with the engine prefix.
  2. The model uses SoftDeletes but every delete path is `forceDelete()`.
  3. `flows.workspace_id` FK is `ON DELETE SET NULL`: deleting a workspace orphans its flows to NULL workspace (then visible only to their creator through the legacy fallback of `scopeForCurrentWorkspace`). `WipeExpiredWorkspaces` deletes flows and flow_subscribers explicitly for expired workspaces.
  4. Model create/update/delete write Notification rows (`LogsNotifications`).
  5. Node reads the graph through `GET api/flows/{id}` (WD-FLB-070), not from the file mirror.
  6. Flow names and graphs are encrypted, so SQL cannot search or sort by name; the encrypted graph size is unbounded (longText).
  7. `HasEngineScope` adds `forCurrentEngine()` scope (not used by the list).
- **Async & events:** model observers listed above.
- **External systems:** none.
- **Settings:** `APP_KEY` (encryption).
- **Acceptance criteria:**
  - Given a saved flow, then `flows.flow_data` in the database is ciphertext and `decoded_flow_data` returns the nodes.
  - Given the row's `flow_data` is NULL but the mirror file exists, then the graph loads from the file.
  - Given a delete, then the mirror file is removed.
- **Source refs:** `app/Models/Flow.php`, `database/migrations/2026_05_05_000011_create_flows_table.php`, `database/migrations/2026_06_21_000000_add_flow_type_to_flows.php`, `database/migrations/2026_07_07_000103_j_purge_public_flow_json_mirrors.php`, `database/migrations/2026_07_29_120000_add_instaflow_flow_id_to_flows.php`.
- **Port notes:** store `graph` as `jsonb` (with field-level encryption only if required by policy) and `name` as plain text; RLS by `workspace_id`; drop the file mirror; keep `flow_type` and add a real `channel` column; add `version` and `published_version_id`.


### WD-FLB-030 — Trigger node

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-020
- **Summary:** The Trigger is the singleton "Start" node that says how a contact enters the flow (keyword, tag added, group join, new contact, opt-in, order, deal stage, away mode, out of hours, manual enrol, Instagram comment-to-DM), on which channel, and from which connected sender. Its fields are what `extractTriggerColumns` (WD-FLB-020) denormalises and what the managed keyword rule (WD-FLB-021) and enrolment service (WD-FLB-071) act on. It is the richest inspector form in the builder.
- **Actors & access:** workspace admin in the builder (`workspace.role:admin`). No node-level permission key. Palette group "Start", description "Where the flow starts", available in ALL ten modes (chat, call, instagram, facebook, tiktok, telegram, line, wechat, viber, email). Singleton: a second Trigger cannot be added or duplicated (toast "Trigger can only exist once." / "...can't duplicate."). The Trigger CAN be deleted (Backspace/Delete or the node action bar) and re-added; nothing forces a flow to keep one.
- **UX & screens:** inspector header "Start / Trigger", then (top to bottom):
  1. **Channel** select. Hidden for call flows and when only one channel exists (e.g. no extension/toggle/connected account for any other channel). Options: WhatsApp plus every enabled channel from the boot payload (Instagram, Facebook, TikTok, Telegram, LINE, WeChat, Viber, Email). Value is the resolved channel (stored `data.channel` if valid, else the mode the flow was opened as). Changing it writes `channel` AND blanks `deviceId`; it does NOT reset `kind`, keywords or tag/group/stage. Help text says the palette is re-filtered and the sender cleared.
  2. **How does this flow start?** (`kind`) select, default `keyword`. Options in order: [Instagram only] "Instagram: someone comments on a post -> DM" (`comment_to_dm`); Keyword match (`keyword`); Audience: when a tag is added (`tag_added`); when contact joins a group (`group_join`); when a new contact is added (`contact_created`); when a contact re-subscribes (`opt_in`); Commerce: when an order is placed (`order_placed`); Sales: when a deal enters a stage (`deal_stage_changed`); Availability: while Away mode is on (`away`); outside business hours (`out_of_hours`); Manual: operator enrolls contacts (`manual_enroll`). `appointment_booked` is accepted server-side but never offered.
  3. keyword only: **When to run** (`keywordMode`: "On specific keywords" = `keywords` default, "On any message (default route)" = `any`; help text switches between "Runs ONLY when no keyword flow matches. Keyword flows always win." and "Pick any message for a catch-all fallback flow."). **Keywords** (`keywords`) single-line text, placeholder and default value `price, pricing, cost`, help "Comma-separated. Match is fuzzy." (shown only when mode is not `any`). No client-side length check; the 255-character limit is enforced by the server hook (WD-FLB-019/021).
  4. `tag_added`: **Tag that triggers enrollment** select (`tagId`, string id; first option "- pick tag -" or "Loading tags..." while the picker list is empty). `group_join`: **Group that triggers enrollment** (`groupId`). `deal_stage_changed`: **Stage that triggers the flow** (`stageId`, stages from the sales pipeline cache, "- pick stage -" / "Loading stages..."). `comment_to_dm`: **Bind to comment keyword rules** checkbox list (`keywordRuleIds`, array of string ids, scrollable, about six rows visible, an "off" badge on inactive rules; empty list shows an amber note pointing at /auto-reply). Leaving all unticked means "any Comment -> DM rule".
  5. Static info boxes (no fields): `order_placed` ("fires for every new order; the customer is matched to a saved contact"), `contact_created` and `opt_in` ("fires automatically"), `away` (needs Away mode on, link to Auto Reply, each contact enrolled once), `out_of_hours` (outside workspace Business Hours, each contact once), `manual_enroll` (use the Enroll button on the /flows list).
  6. **Sender** select (`deviceId`). Label depends on channel and kind: "Listen on number / Send from number" (keyword vs other kinds), and the Instagram account / Facebook Page / LINE channel / WeChat account / Viber account / mailbox variants (TikTok and Telegram reuse the generic number wording, QUIRK). Value is the composite key `"<engine>:<id>"` from the picker (WD-FLB-026). Placeholder option: "- pick number -" / "No connected number" (and channel equivalents). Below it a red box "Pick a number/an Instagram account/a Facebook Page/a mailbox before saving" when something is available but none chosen, or an amber box "No connected ... You can still build and save this flow" when nothing is connected. The red/amber hints show for IG/FB/email wording only; other channels fall back to number wording.
  - **Card:** header chip, id, group tag START; body "When <raw kind>" in monospace; for keyword kind a second line with the keywords (truncated on one line), "- any message -" when mode is `any`, or a warning "no keywords set" when empty. START ribbon when `isStart` (the first node dropped on an empty canvas is auto-pinned start, normally the Trigger). No input port; exactly one output port `out` labelled by kind: on keyword, on comment -> DM, on tag added, on group join, on new contact, on opt-in, on order, on deal stage, while away, after hours, on enroll (unknown kinds such as `appointment_booked` show the raw kind string).
- **Endpoints:**

| Method uri             | Route name            | Controller@action          | Middleware                         | Request                                                  | Response                                                                                                                                                                  |
| ---------------------- | --------------------- | -------------------------- | ---------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET flows/api/picker   | user.flows.api.picker | FlowsController@apiPicker  | Authenticate, workspace.role:admin | none (fetched once per page load with `cache: no-store`) | JSON `{ok, tags:[{id,name,color}], groups:[{id,name}], devices:[{key,id,device_name,phone_number,engine_label,...}], instagram[], facebook[], tiktok[], telegram[], line[], wechat[], viber[], email[], keywordRules[]}` |

  Full picker contract is WD-FLB-026. The boot payload (WD-FLB-014) also embeds the per-channel account arrays so the sender list is never empty while the fetch is in flight; the fetch result replaces a list only if it is non-empty (an empty fetch result never wipes the embedded accounts).
- **Data:** stored in `node.data`: `kind`, `keywordMode`, `keywords`, `tagId`, `groupId`, `deviceId`, `keywordRuleIds` (all seeded by defaults) plus `channel` and `stageId`, which exist ONLY after the operator touches them (QUIRK: a brand-new Trigger has no `channel` key; the mode then falls back to the creation mode, and `stageId` is absent until a stage is picked). Node ids `n_` + 6 base36 chars. Stale values are kept when the kind changes (e.g. keywords stay after switching to `tag_added`), harmless because the server reads only the fields relevant to the current kind. Server denormalisation into `flows.trigger_kind / trigger_value / trigger_device_id / trigger_keywords / provider` is WD-FLB-020; there is no table for the Trigger node itself.
- **Rules & edge cases:**
  1. Builder-side validation (WD-FLB-018): the Trigger is exempt from the "no incoming connection" rule; the sender must be chosen when the workspace has at least one connectable sender for chat, Instagram or Facebook (no check for TikTok, Telegram, LINE, WeChat, Viber, Email, even though the inspector shows the red hint). A flow without a Trigger saves fine and simply never fires.
  2. QUIRK: switching Channel away from Instagram while `kind` is `comment_to_dm` leaves `kind` unchanged although the option disappeared; the select then displays the first option (Keyword) while the stored value is still `comment_to_dm`, and the server still stores `trigger_kind=comment_to_dm`. Do not port: reset kind to `keyword` (or hide the channel option) when the channel changes.
  3. QUIRK: a new keyword Trigger is pre-filled with the keywords `price, pricing, cost`, so a flow published without editing them answers those words. Keyword mode `any` makes a fallback route that runs only when no other keyword flow matches (matcher behaviour is AR/FLR).
  4. Because `deviceId` is a composite `"engine:id"` string, the Channel change blanks it (a WhatsApp number is meaningless on Instagram). Legacy flows may hold a bare integer.
  5. All audience kinds (tag, group, new contact, opt-in, order, deal stage, away, out of hours, manual) are offered on every channel in the builder, but enrolment support per channel is decided by WD-FLB-071, not by this form.
  6. `keywordRuleIds` are stored as strings; the server turns them into a comma list of integers (WD-FLB-020).
- **Async & events:** none in the builder. Saving fires the model hook that syncs the managed keyword rule (WD-FLB-021) and the denormalised columns (WD-FLB-020). FlowNormalizer: the Trigger has NO TYPE_MAP entry; it passes through with `flowNodeType` set to the ucfirst of the type ("Trigger") and its `data` untouched; the pinned start node (Trigger by default) is moved to index 0 of `flowNodes`. The runtime does not execute a Trigger handler (static read of the runner found none; it falls to the unknown-type default which advances along port 1) - runtime behaviour is FLR.
- **External systems:** none.
- **Settings:** channel availability flags and connected-account lists from the boot payload (WD-FLB-014); platform toggles for Instagram/Facebook/TikTok/Telegram/LINE/WeChat/Viber/Email; Away mode and Business Hours settings (AR / workspace settings) affect when `away` and `out_of_hours` fire.
- **Acceptance criteria:**
  - Given a new canvas, when the admin drags the Trigger in, then it is pinned as START with kind Keyword, mode "On specific keywords", keywords `price, pricing, cost`, and a single output port labelled "on keyword"; a second drag shows the toast that the Trigger can only exist once.
  - Given kind `tag_added`, when the admin picks a tag and saves, then `data.tagId` is the tag id as a string, the keyword fields are hidden, and the saved flow row gets `trigger_kind=tag_added` and `trigger_value=<id>` (WD-FLB-020).
  - Given the Channel is switched from WhatsApp to Instagram, then `deviceId` is cleared, the sender list shows Instagram accounts only, the kind list gains the Comment -> DM option, and the palette re-filters to Instagram nodes.
  - Given a workspace with a connected number and a Trigger with no sender, when Save is clicked, then save is blocked with the "Trigger node has no number selected" reason; given no connected numbers, the same flow saves with an amber hint shown.
  - Given kind `comment_to_dm` with two rules ticked, then `keywordRuleIds` holds both ids; with none ticked the card still shows "on comment -> DM" and the flow is a catch-all for Comment -> DM rules.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`NTYPES.trigger`, `defaultData('trigger')`, `nodeRows`, `renderPreview`, Inspector `case 'trigger'`, `addNode`, `duplicateNodeById`, `runValidation`), `app/Http/Controllers/FlowsController.php` (`apiPicker`, `extractTriggerColumns`), `app/Services/Flows/FlowNormalizer.php` (`normalize` start-node reorder), `app/Models/Flow.php` (TRIGGER_KINDS).
- **Port notes:** model the Trigger as typed config in `packages/contracts` (a discriminated union on `kind`) and store it ALSO as a first-class `flow_triggers` row (see WD-FLB-020). Validate server-side that sender, tag, group, stage and keyword-rule ids belong to the org (WaDesk trusts the client). Reset or reject incompatible kind/channel combinations. Do not seed default keywords. Picker data comes from the TIB (tags), CON (groups), DEAL (stages), AR (comment-to-DM rules) and channel domains.

### WD-FLB-031 — Send message node

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-017
- **Summary:** Sends one plain text message to the contact. The simplest node: a single multi-line text field with `{{variable}}` merge tags and WhatsApp-style formatting preview.
- **Actors & access:** workspace admin. Palette group "Send", label "Send message", description "Plain text message". Modes: chat (WhatsApp), instagram, facebook, tiktok, telegram, line, wechat, viber, email; NOT call (calls use the Say node). No plan gate.
- **UX & screens:** inspector: a dark WhatsApp preview ("Preview - WhatsApp") rendering the text with the same mini-markup WhatsApp uses (`*bold*`, `_italic_`, `~strike~`, triple-backtick monospace, newlines; everything else HTML-escaped), an empty text shows "Your message will appear here". One field **Message text** (`text`, textarea 6 rows, placeholder "Hi {{name}}! ...", no maxlength, no required check) with hint "Use {{var}} or press / to insert a variable": typing `/` opens the slash attribute picker (GET `/attributes/api/list`, system + custom attributes; inserts `{{key}}`). Card: bubble with the first 140 characters, ellipsis when longer; single output port `out` labelled "next"; input port on the left.
- **Endpoints:** none of its own (attribute picker is `GET attributes/api/list`, CON domain).
- **Data:** `data.text` (string). Default `"Type your message..."` (QUIRK: a node dropped and left unedited sends that placeholder literally).
- **Rules & edge cases:**
  1. Builder-side validation: only the generic graph rules (WD-FLB-018): needs an incoming edge, must be available in the flow's channel mode. No required-text check, so an empty message node saves and publishes (the runtime then sends an empty text or skips; FLR).
  2. No length limit in the builder; per-channel limits (WhatsApp 4096 characters, Instagram/Facebook/Telegram/LINE etc.) are applied or rejected by the runtime, not the builder.
  3. Variables resolve from the session variable bag at send time (contact seed values such as name/phone plus anything saved by Ask, Webhook, AI, Code, MySQL, Sheets nodes). Unknown variables render as empty string (runtime).
  4. One input and one output only; fan-out (several edges from `out`) is allowed by the canvas but the runtime follows the first edge it finds for port 1.
- **Async & events:** FlowNormalizer maps `message` -> `flowNodeType: Message` and builds `flowReplies: [{flowReplyType:'Text', data:<text>}]` (the same shape the sequence node produces). Delivery, typing delay, session variable substitution, inbox mirroring (flow-log) and per-engine sending are FLR.
- **External systems:** none from the builder; delivery goes through the connected channel provider at runtime.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a new Send message node, then the text is the placeholder default, the card shows it in a bubble and the node exposes one output labelled "next".
  - Given the text `*Hello* {{name}}`, then the inspector preview shows "Hello" in bold followed by the variable token, and the card bubble truncates the text at 140 characters with an ellipsis.
  - Given the admin types `/` in the field, then the attribute popover opens and choosing "name" inserts `{{name}}` at the caret.
  - Given a flow whose Trigger channel is switched to a call flow, then Send message is not in the palette; if already on the canvas and the channel changes, Save is blocked with the "does not work on" message (WD-FLB-018).
  - Given the normalizer runs on `{type:'message', data:{text:'Hi'}}`, then the output node has `flowNodeType` Message and one Text reply with data `Hi`.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`NTYPES.message`, `defaultData`, `renderPreview`, Inspector `case 'message'`, `renderWaText`), `resources/js/attribute-picker.js`, `app/Services/Flows/FlowNormalizer.php` (`case 'message'`), `node/services/flowService.js` (`executeMessageNode`).
- **Port notes:** keep a single `text` field in the contract plus a channel-aware max-length warning. Replace the placeholder default with an empty string and make empty text a publish-time error. The variable picker maps to the CON attribute catalogue.

### WD-FLB-032 — Send sequence node

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-027
- **Summary:** One node that sends an ordered stack of replies (text, image, video, audio, document) so a product card, demo video and PDF can go out from a single step. Replies can be added, reordered, removed and uploaded inline.
- **Actors & access:** workspace admin. Palette group "Send", label "Send sequence", description "Stack text + media in one node". Mode: chat (WhatsApp) only (declared modes default to chat). Uploads use `POST flows/api/upload-media` (WD-FLB-027).
- **UX & screens:** inspector: info box ("Each reply is sent in order..."), a dark preview with each reply as its own bubble top to bottom (media shows an image thumbnail, a "video" tile, an audio pill or a document pill with filename; a caption becomes a second bubble), then a card per reply with its own header: ordinal, **type select** (Text, Image, Video, Audio, Document), up/down arrows (disabled at the ends), remove. A text reply has a 3-row textarea "Message text..." (slash picker enabled). A media reply has a dashed upload target ("Upload image" / "Replace image"; accept filter per type: image/*, video/*, audio/*, `.pdf .doc .docx .xls .xlsx .txt` for documents), a thumbnail or three-letter type chip with filename and link, a monospace "Or paste a URL" input and a one-line "Caption (optional)" input. Add buttons below: one pill per type ("+ Text", "+ Image", ...). Empty state "No replies yet - click a button above to add one." Upload failure toast "Upload failed: <message>". Card: up to five chips "<n>. <label> <TYPE>" coloured by type (text label is the first 38 characters; media shows filename or URL tail), then "+ N more..."; empty state "No replies yet - open inspector to add". Single output port `out` "next".
- **Endpoints:** `POST flows/api/upload-media` (route `user.flows.api.upload`, FlowsController@apiUploadMedia, multipart `file` + `type`; response `{success, data:{url, filename, ...}}`; limits in WD-FLB-027).
- **Data:** `data.replies` = array of `{type:'text', text}` or `{type:<image|video|audio|document>, url, filename, caption}`. Default is one text reply `Hi {{name}}!`. New text reply `text:''`; new media reply `url:'', filename:'', caption:''`. Changing a reply's type keeps the other fields (a leftover `text` or `url` stays in the object). No cap on number of replies in the builder.
- **Rules & edge cases:**
  1. No required fields: an empty text reply or a media reply with no URL still saves; the media reply then normalises to an empty URL and the runtime skips or fails that item (FLR).
  2. The upload sets both `url` (absolute public URL from the media disk) and `filename`; pasting a URL does not set a filename, and clearing a URL leaves a stale filename.
  3. Reordering changes only array order; the node has a single output so no edges are affected.
  4. Normaliser tolerance: media URL may come from `url`, `mediaUrl` or `fileUrl`; unknown reply types become Text.
  5. Relative media URLs are made absolute at normalise time (needed for WhatsApp/Baileys to fetch them); URLs containing `{{variable}}` are left untouched and resolved at send time.
  6. Only available on WhatsApp; if the Trigger channel changes to another channel the node is flagged on save (WD-FLB-018).
- **Async & events:** none in the builder. FlowNormalizer: `sequence` -> `flowNodeType: Message` with `flowReplies` built one per reply (types Text/Image/Video/Audio/Document; media entries carry `data` = absolute URL, `filename`, `caption`). The runtime's message executor walks the array in order (spacing, per-engine media upload, 24h window handling are FLR).
- **External systems:** media files are stored on the app media disk (WD-FLB-027); delivery via the WhatsApp engine at runtime.
- **Settings:** media disk and upload limit (50 MB per the inspector hint, SET domain).
- **Acceptance criteria:**
  - Given the default node, then the card shows one chip "1. Hi {{name}}! TEXT", and adding Image then Video yields chips 2 and 3 in that order; moving reply 3 up swaps them.
  - Given a media reply and a successful upload, then `url` and `filename` are set and the inspector shows the thumbnail (image) or type chip with a link; given a failed upload, the toast "Upload failed: HTTP 413" (or the HTTP status) is shown and the reply is unchanged.
  - Given six replies, then the card lists five chips and "+ 1 more...".
  - Given the normaliser input with replies `[text, image]`, then the output has two `flowReplies` (Text with data, Image with absolute URL, filename and caption).
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`NTYPES.sequence`, Inspector `case 'sequence'`, `renderPreview`), `app/Services/Flows/FlowNormalizer.php` (`case 'sequence'`, `absoluteUrl`), `app/Http/Controllers/FlowsController.php` (`apiUploadMedia`).
- **Port notes:** store replies as a discriminated array in contracts with a hard cap (suggest 10) and require non-empty text/URL on publish. Reuse the media upload service from WD-FLB-027 (object storage + signed or public URLs). Do not reuse the normaliser trick of mapping to the Message type; the target runtime can model "reply list" natively.

### WD-FLB-033 — Send media node

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-027
- **Summary:** Sends a single image, video, document or audio file with an optional caption. The file is uploaded to the app (public URL) or referenced by pasted URL.
- **Actors & access:** workspace admin. Palette group "Send", label "Send media", description "Image, video, doc, audio". Modes: chat plus the eight social/email modes (not call).
- **UX & screens:** inspector preview shows the file in a dark WhatsApp frame (image thumbnail, video player with controls, document pill with filename or "document.pdf", audio pill "Voice / audio", or "(<kind> preview will appear here)") and a caption bubble (WhatsApp mini-markup). Fields: **Type** select (Image, Video, Document, Audio; `kind`), **Upload** (dashed target "Choose <kind> (or drag here)" / "Replace file"; accept filter per kind: video/*, audio/*, `.pdf .doc .docx .xls .xlsx`, else image/*; hint "Up to 50 MB. We host the file and give the flow a public URL."), a thumbnail (image) or three-letter chip with filename and link, **Or paste a URL** (`url`), **Filename (label)** (`filename`, placeholder `catalogue.pdf`), **Caption** (`caption`, textarea 3 rows, optional). Upload failure toast "Upload failed: <message>". Card: for an image with URL a thumbnail (max 120 px high) and caption (80 chars); otherwise an icon tile with filename (or URL tail, or "no file selected" in italics) and "<kind> . caption(30)". Single output port `out` "next".
- **Endpoints:** `POST flows/api/upload-media` (`user.flows.api.upload`, FlowsController@apiUploadMedia; multipart `file`, `type` = current kind; success `{success, data:{url, filename}}`), see WD-FLB-027 for size and MIME limits.
- **Data:** `data` = `{kind:'image', filename:'', caption:'', url?}`. `url` is absent until upload/paste (QUIRK: not in defaults). Changing `kind` keeps `url` and `filename` (an image URL can end up on a "video" node; the upload `type` field follows the new kind only for the next upload).
- **Rules & edge cases:**
  1. No validation in the builder: a media node with no file saves and publishes; the card just says "no file selected".
  2. Upload sets `url` and `filename` (server filename or the original). Typed filename is only a label; for documents it is the display name on WhatsApp.
  3. Accept filters are advisory; MIME enforcement is server-side (WD-FLB-027). The pasted URL is not validated or probed.
  4. Normaliser tolerance: file URL read from `url`, `mediaUrl`, `fileUrl`, `media` or `file`; made absolute unless it contains `{{`; `mimetype` is read if present but the builder never sets it, so MIME is inferred at send time.
  5. Not offered on call flows; on Instagram the shared node is used (there is no separate Instagram media node).
- **Async & events:** FlowNormalizer: `media` -> `flowNodeType: Media` plus flat fields `mediaKind` (lower-cased, default image), `mediaUrl`, `mediaCaption`, `mediaFilename`, `mediaMimetype`. Download/upload to the engine, size caps per engine and failure handling are FLR.
- **External systems:** app media disk (SET); WhatsApp/channel provider at runtime.
- **Settings:** upload limit and disk (WD-FLB-027).
- **Acceptance criteria:**
  - Given Type Image and a successful upload, then `url` and `filename` are set, the inspector shows a thumbnail and the card shows a thumbnail tile.
  - Given Type Document with filename `catalogue.pdf` and a pasted HTTPS URL, then the card shows `catalogue.pdf` with "document" and the normaliser output has `mediaKind=document` and the URL unchanged.
  - Given a relative stored URL `/storage/flows/a.png`, then the normalised `mediaUrl` is an absolute `https://<app-domain>/storage/flows/a.png`; given `{{invoice_url}}`, it is left as is.
  - Given an upload that returns HTTP 500, then the toast "Upload failed: HTTP 500" appears and the previous file is kept.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`NTYPES.media`, Inspector `case 'media'`, `renderPreview`), `app/Services/Flows/FlowNormalizer.php` (`case 'media'`, `absoluteUrl`), `app/Http/Controllers/FlowsController.php` (`apiUploadMedia`).
- **Port notes:** contract `{kind, mediaId|url, filename, caption}` preferring a media-library id (tenant-scoped object storage) over raw URLs; clear the file when the kind changes; add publish-time "file required". Uploads need RLS-scoped metadata and virus/MIME checks.

### WD-FLB-034 — Send template node

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-026
- **Summary:** Sends an approved WhatsApp message template (header, body, footer, buttons or carousel) and turns each quick-reply button of the template into its own output port so tap-backs can branch the flow.
- **Actors & access:** workspace admin. Palette group "Send", label "Send template", description "Approved template". Mode: chat (WhatsApp) only. Templates come from the workspace's approved templates (TPL domain).
- **UX & screens:** inspector: a dark WhatsApp preview rebuilt from the picked template (template name tag, attachment placeholder or image, bold header, body with variable tokens, footer, white button tiles with arrow/phone glyphs, up to five carousel mini-cards); empty state "Pick an approved template to preview"; unknown name shows "Template <name> not found in workspace". Field **Approved template** (`tpl`, select; first option "- pick template -" or "Loading templates..." while the list is empty; each option `<template_name> . <category>`; an extra option "<name> (not in workspace)" appears if the saved name is not in the list), hint "Only approved templates from the workspace appear here. Create a new one" (link to /templates/create). Picking a template also writes `tplId`; a small mono line "template_id = N" appears. No variable-mapping UI exists: placeholders are resolved from the template's own stored variable map and named merge tags at send time. Card: mono template name, bold header, first body line, "N button(s)", or "pick template..."; output ports: one `p0..pN` port per QUICK-REPLY button (button type containing url, cta, visit, call, phone or copy is excluded), labelled with the button text/title/label (fallback "Button N"); a template with no quick replies has a single `out` "next".
- **Endpoints:**

| Method uri                          | Route name         | Controller@action          | Middleware                | Request                                                                                  | Response                                                                                                                          |
| ----------------------------------- | ------------------ | -------------------------- | ------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| GET templates/api/list?type=standard | user.templates.api.list | TemplatesController@apiList | Authenticate, workspace.role:manager | `type=standard` (the builder always sends it, which excludes carousel-type templates)     | `{ok, templates:[{id, template_name, template_type, category, meta_category, header, template_body, footer, buttons, carousel_data, attachment_type, attachment_file, language}]}`; approved only, current workspace, newest first |

- **Data:** `data` = `{tpl:'<template_name>', tplId:<int|null>}`. Default `{tpl:''}`. The list is fetched once on builder mount and cached module-wide (stale until reload). Selecting a template not in the cache sets `tplId` null.
- **Rules & edge cases:**
  1. Builder-side validation: none specific; an unset template saves, then the normaliser emits an empty template name and the runtime skips the node.
  2. QUIRK: `type=standard` means carousel templates never appear in the picker even though the preview code can render carousel cards.
  3. Ports depend on the template cache: before it loads (or if the template is deleted/renamed) the node shows a single `out`; existing edges using `p1..` are kept but their anchors vanish. Changing the template does not prune or remap edges: edges from `p2` stay even when the new template has only one quick reply.
  4. Template names are unique per workspace only in practice; the normaliser prefers the stored `tplId`, else finds a row by decrypted name (approved first, then newest).
  5. No per-template variable mapping in the builder; positional `{{1}}` values come from the template's `variable_map`, named tags from session variables.
  6. Sending a template is allowed outside the 24-hour window on the WhatsApp Cloud API; other engines degrade to text plus buttons (FLR).
- **Async & events:** FlowNormalizer: `template` -> `flowNodeType: Template`, hydrates at runtime-fetch time (not at save): `templateName`, `templateId`, `templateBody`, `templateHeader`, `templateFooter`, `templateLanguage`, `templateCategory`, `templateButtons`, `templateVariableMap` (JSON-decoded) from the `wa_templates` row; if no row is found `templateId=null`, `templateBody=''`. Edges: `p<i>` -> port i+1. A runtime template menu stays tappable after the first tap unless `keepMenuOpen` is false (FLR). Meta submission and template approval are TPL.
- **External systems:** Meta WhatsApp Cloud API (template send) at runtime; Twilio/Baileys fallbacks per engine (FLR).
- **Settings:** none in the builder; WABA settings per workspace (WABA domain).
- **Acceptance criteria:**
  - Given a workspace with approved template "welcome" with two quick-reply buttons and one URL button, when it is picked, then `tpl='welcome'`, `tplId` is its id, and the card shows ports "Yes" and "No" (the two quick replies) but none for the URL button.
  - Given a template with no quick-reply buttons, then the node has the single output "next".
  - Given a template name that is not in the workspace list, then the select shows "<name> (not in workspace)" and the preview says the template was not found.
  - Given the normaliser runs on a node with `tplId` pointing to a row, then the output carries `templateBody`, `templateButtons` and `templateVariableMap` from that row, and edge handle `p1` becomes source `<id>_2`.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`templateQrButtons`, `findTemplate`, `nodeRows` template case, Inspector `case 'template'`, `renderPreview`), `app/Http/Controllers/TemplatesController.php` (`apiList`), `app/Services/Flows/FlowNormalizer.php` (`case 'template'`, `handleToPort`), `node/services/flowService.js` (`executeTemplateNode`).
- **Port notes:** derive ports in a shared `portsFor(node, templateSnapshot)`; snapshot the template (id, version, quick-reply labels) into the flow version at publish so later template edits cannot orphan edges; offer a variable-mapping step per template placeholder; include carousel templates. TPL owns the template tables.

### WD-FLB-035 — Quick replies (buttons) node

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-017
- **Summary:** Sends a prompt with up to three tap-to-reply buttons; each button is its own output port so the flow branches on which one the customer taps.
- **Actors & access:** workspace admin. Palette group "Send", label "Quick replies", description "Tap-to-pick reply buttons". Modes: chat plus the eight social/email modes (on Instagram the legacy `ig_quick` node is hidden and replaced by this one).
- **UX & screens:** inspector: WhatsApp preview (prompt bubble, up to three white reply-arrow tiles, header "Preview - WhatsApp - N button(s)"), field **Prompt** (`prompt`, textarea 3 rows), field **Options**: numbered text inputs (one per button, red remove X) and an "Add button" link; hint "Max 3 buttons. Each gets its own output port." Adding beyond three shows the toast "Max 3 quick reply buttons" (and nothing is added). New buttons are named "Button N". Card: prompt bubble (no truncation shown beyond CSS), then one labelled row per button, each with an output dot; if the options array is empty a single placeholder port labelled "Option" is shown.
- **Endpoints:** none.
- **Data:** `data` = `{prompt:'Pick one', options:['Option A','Option B'], var:'choice'}`. `options` are bare strings. `var` (the variable that receives the tapped option) has NO control in the inspector (QUIRK: always `choice` unless an imported/AI-generated flow sets it). Output handles `p0..pN` (index in `options`).
- **Rules & edge cases:**
  1. Max 3 options is enforced only by the Add button; an imported or AI-generated flow can carry more and the card still draws every port (WhatsApp accepts only 3, FLR must truncate or fall back to a list).
  2. Removing option i deletes the edges leaving `p<i>` and renames later handles (`p<i+1>` becomes `p<i>`), so remaining branches keep their targets. Reordering is not offered. Editing a label never changes edges.
  3. Empty or duplicated labels are allowed; an empty label renders as "Option N" at normalise time, duplicates make two indistinguishable buttons.
  4. No length limit in the builder; WhatsApp button titles are limited to 20 characters (enforced or truncated at runtime).
  5. An unwired port is a legal dead-end: at runtime the flow parks on the last menu instead of ending (FLR).
  6. Prompt is mandatory in practice but not validated; default body text at runtime is "Please choose:".
- **Async & events:** FlowNormalizer: `buttons` -> `flowNodeType: InteractiveButtons` with `headerText=''` (prevents the double-header bug), `bodyText=prompt` (default "Please choose:"), `buttons:[{id:'p<i>', title}]` (title default "Option N"), `variable` (cleaned, default `choice`). Edge `p<i>` -> port i+1. The runtime uses node-scoped ids `b_<nodeId>_p<i>` so taps on stale menus route correctly, keeps the menu tappable after a leaf branch, and falls back to a numbered text menu on engines without interactive buttons (all FLR).
- **External systems:** WhatsApp Cloud API interactive buttons / Baileys interactive message / Twilio at runtime.
- **Settings:** none in the builder; `keepMenuOpen` (runtime flag, default on, no UI).
- **Acceptance criteria:**
  - Given a new node, then it exposes ports `p0` "Option A" and `p1` "Option B" and the hint reads "Max 3 buttons...".
  - Given three buttons, when the admin clicks Add button, then the toast "Max 3 quick reply buttons" shows and the list stays at three.
  - Given edges from `p0`->X, `p1`->Y, `p2`->Z, when the admin removes option 2 (index 1), then the edge to Y is deleted, the edge to Z now leaves `p1`, and the node exposes two ports.
  - Given the normaliser runs, then an edge with handle `p1` becomes `sourceNodeId <id>_2` and `buttons` holds `[{id:'p0',...},{id:'p1',...}]`.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`nodeRows`, `onAddOption`, `onRemoveOption`, Inspector `case 'buttons'`, `isMultiPort`), `app/Services/Flows/FlowNormalizer.php` (`case 'buttons'`), `node/services/flowService.js` (`executeButtonsNode`).
- **Port notes:** enforce the max-3 limit in the shared contract/validator and expose the variable name in the UI. Handle ids should be stable option ids rather than array indices so deletes do not need to renumber edges.

### WD-FLB-036 — List message node

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-017
- **Summary:** Sends a WhatsApp list message: a prompt, one "open" button and up to ten items (title, optional description, optional section heading). Each item is its own output port, in the order of the flat items array.
- **Actors & access:** workspace admin. Palette group "Send", label "List message", description "Interactive list picker". Mode: chat (WhatsApp) only.
- **UX & screens:** inspector preview shows the prompt bubble, the opener button and a second framed "After tap - bottom sheet" block listing items grouped by section heading (matching what Meta renders); header counts items. Fields: **Prompt** (`prompt`, textarea 3 rows); **Button label** (`button`, placeholder/default "View options", hint "Max 20 chars on WhatsApp", NO maxlength attribute); **Items**: per item a box with ordinal, **Item title** (maxlength 24, live counter turns coral past 24), remove X, **Description (optional)** (maxlength 72, counter), **Section (optional)** (maxlength 24, counter, autocompletes from section names already used via a datalist). "Add item" link; when more than one distinct section exists a line "Renders as N sections: A x 2 . B x 1" appears. Hint: "Up to 10 items total. Give two items the SAME section name to group them under one heading. Sections and descriptions render on WhatsApp Business API (Cloud); on the Unofficial API the list falls back to plain buttons showing the title only." Adding past ten shows the toast "Max 10 items". Added items are named "Item N" and inherit the previous item's section. Card: prompt bubble, opener chip with the button label, "N item(s) - shown after tap", then one labelled port row per item (title); empty options show a single placeholder port "Item".
- **Endpoints:** none.
- **Data:** `data` = `{prompt:'Pick from list', button:'View options', var:'choice', options:[{title, description, section}, ...]}` with three default items "Item 1..3". Older flows stored items as bare strings; every read coerces to the object shape (string -> title only; missing title -> "Item N"). `var` has no UI control (QUIRK, same as Quick replies). Items stay a FLAT array so the index is the port (`p0..pN`); sections are only a grouping label and never reorder ports.
- **Rules & edge cases:**
  1. Limits: title 24, description 72, section 24 (Meta caps) enforced by input maxlength in the builder and again (truncation) by FlowNormalizer; opener label 20 is advisory only (not enforced anywhere in the builder or normaliser - runtime/Meta may reject longer labels).
  2. Max 10 items enforced only by the Add button; removal renumbers handles exactly like Quick replies (edges of the removed port deleted, later handles shift down).
  3. Duplicate titles allowed (rows share a title but have distinct ids).
  4. Items in the same section need not be adjacent; the runtime groups by section heading at send time, so visual order in the sheet can differ from array order (ports stay by array index).
  5. On engines without list support (Baileys) the list degrades to buttons/text with titles only (FLR).
  6. No required-field validation: empty prompt, empty titles are allowed (normaliser fills "Option N", default body "Please choose:").
- **Async & events:** FlowNormalizer: `list` -> `flowNodeType: List`, `headerText=''`, `bodyText=prompt`, `buttonText=button` (default "View options"), `listItems:[{id:'p<i>', title(<=24), description(<=72), section(<=24)}]`, `variable` (cleaned, default `choice`). Edge `p<i>` -> port i+1. Runtime sending, tap routing and persistence of the menu are FLR.
- **External systems:** WhatsApp Cloud API interactive list at runtime.
- **Settings:** none.
- **Acceptance criteria:**
  - Given three items where items 1 and 2 share the section "Drinks" and item 3 has none, then the preview shows two headings and the helper text "Renders as 2 sections: Drinks x 2 . (no heading) x 1", while ports remain `p0,p1,p2`.
  - Given ten items, when Add item is clicked, then the toast "Max 10 items" appears and nothing is added.
  - Given a title typed beyond 24 characters, then the input refuses further characters (maxlength) and the counter shows 24/24; given an imported flow with a 40-character title, then the normalised `listItems[i].title` has 24 characters.
  - Given a saved flow whose options are bare strings, then the inspector shows each as a title with empty description and section.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`listOpt`, `LIST_*_MAX`, `onAddOption`, Inspector `case 'list'`, `renderPreview`), `app/Services/Flows/FlowNormalizer.php` (`case 'list'`), `node/services/flowService.js` (`executeListNode`).
- **Port notes:** keep the flat-array-with-section-label model; stable item ids rather than positional ports; enforce the 20-character opener limit and the 10-row cap in the shared validator.

### WD-FLB-037 — Ask question node

- **Status:** partial
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-017
- **Summary:** Asks the contact a question, waits for the reply and stores it in a named variable. Optionally accepts a file upload as the answer and optionally branches on up to three expected answers plus an "else" port. Status is partial because the "Validate as" setting is stored but never enforced anywhere.
- **Actors & access:** workspace admin. Palette group "Listen", label "Ask question", description "Save user reply to a var". Modes: chat plus the eight social/email modes (the legacy `ig_ask` is hidden and superseded by this node).
- **UX & screens:** inspector preview-less (no WhatsApp frame). Fields: **Question** (`prompt`, textarea 3 rows); **Validate as** (`validate` select: Free text `text` default, Email, Phone, Number); **Save answer to variable** (`var`, text, default `answer`; the field supports the slash picker; help warns each Ask needs a UNIQUE variable name or a later question overwrites the earlier answer); checkbox **Accept a file/photo upload** (`acceptMedia`, "Save an uploaded image / PDF / audio as this variable (a link)", works on WhatsApp official/unofficial and Twilio); **Expected answers** (`options`, string inputs with remove X, "Add answer" link, max 3 then "Max 3 reached."; help "Each becomes its own output port; anything else goes through the else port. Leave empty for free-text answers."). Card: question bubble; with no expected answers a hint "customer's reply -> next node" and a single output `out` labelled "reply received"; with expected answers one port per answer (`p0..`, label = the answer or "Answer N") plus an `else` port labelled "else / no match" (red "no" colour).
- **Endpoints:** none.
- **Data:** `data` = `{prompt:"What's your name?", var:'answer', validate:'text', options:[], acceptMedia?}`. Toast "Max 3 expected answers" when adding a fourth.
- **Rules & edge cases:**
  1. QUIRK / DEFECT: `validate` (text/email/phone/number) is stored on the node but neither FlowNormalizer nor the Node runtime reads it (no matching code in `flowService.js`); no re-prompt on invalid input ever happens. Port notes below say to implement it.
  2. QUIRK: the normaliser drops blank expected answers (`trim` then filter) while the builder still draws a port for each array slot. With options `['A','','C']` the builder has ports p0,p1,p2 but the runtime sees `['A','C']`, so p2 points at a non-existent answer. Do not port: forbid blank answers.
  3. Ports flip: zero expected answers -> `out`; one or more -> `p0..pN` + `else`. Adding the first expected answer does not move an existing edge from `out` (the edge keeps handle `out` and renders on nothing; the operator must rewire). Removing the last answer likewise orphans `p0` and `else` edges.
  4. Variable name hygiene happens server-side: wrapping `{{ }}`, a leading `@` and spaces are stripped (`{{name}}` and `@name` both save as `name`); empty falls back to `answer`.
  5. `else` maps to runtime port 0 (never to 1); real answers map p0->1, p1->2, ... The runtime matches the reply against the expected list and routes unmatched text down `else`; with no list, any reply goes down port 1.
  6. `acceptMedia` makes a media-only reply store a stored-file URL in the variable instead of being treated as empty text.
  7. Slash picker also attaches to the variable-name field (inserting braces that the normaliser later strips).
- **Async & events:** FlowNormalizer: `ask` -> `flowNodeType: Question` with `question`, `variable` (cleaned), `acceptMedia` (bool) and `expectedAnswers` (trimmed, non-empty strings; taken from `options` or legacy `expected`). Waiting for the reply (session `waitingForInput`), 1-hour reply window, timeout and matching rules are FLR.
- **External systems:** inbound media storage for `acceptMedia` (WD-FLB-027 inbound media store).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a new Ask node, then it shows one output "reply received", variable `answer`, Validate as "Free text", and no expected answers.
  - Given two expected answers "Yes" and "No", then the node exposes `p0` "Yes", `p1` "No" and `else` "else / no match"; a fourth Add click is blocked with "Max 3 expected answers" after three.
  - Given the variable field holds `{{email}}`, then the normalised `variable` is `email`.
  - Given `acceptMedia` on, then the normalised node has `acceptMedia=true`.
  - Given an edge with handle `else`, then the normalised `sourceNodeId` is `<id>_0`.
  - Given Validate as Email and a reply "not an email", then (reference behaviour) the reply is accepted without validation; the port must instead re-prompt or take the else path.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`nodeRows` ask case, `onAddOption`, Inspector `case 'ask'`), `app/Services/Flows/FlowNormalizer.php` (`case 'ask'`, `handleToPort`, `cleanVar`), `node/services/flowService.js` (`executeQuestionNode`).
- **Port notes:** implement validation for the four types with a re-prompt count and an invalid-input port; use stable ids for expected answers; auto-migrate edges when the node switches between single-port and multi-port modes. Variable names should be validated in the contract (slug).

### WD-FLB-038 — Condition node

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-017
- **Summary:** An if/else branch. One or more rules (variable, operator, value) are chained left to right with AND/OR toggles into one expression; true goes out the `yes` port, false out the `no` port.
- **Actors & access:** workspace admin. Palette group "Logic", label "Condition", description "If / else branch". Modes: all ten (including call flows).
- **UX & screens:** inspector (no preview): explanatory box describing that all rules combine into ONE expression, TRUE fires "IF . true", FALSE fires "ELSE . false". One card per rule ("Rule N", remove X shown only when more than one rule exists, so at least one rule always remains): **Variable name** text (placeholder "Variable name (e.g. plan)"), **operator** select (Equal to `equals`, Not equal to `not_equals`, Contains `contains`, Does not contain `not_contains`, Greater than `gt`, Less than `lt`, Is set `exists`), **value** text "Compare against..." (hidden for `exists`). Between rules a pill toggle AND / OR (default AND; OR is amber). "Add rule" link adds a blank equals rule and, when at least one rule exists, appends an `AND`. Removing rule i also removes the joiner before it (or the first joiner when i is 0). Card: "IF {{var}} = value" with the joiners coloured (AND green, OR amber) using symbol labels (equals =, not_equals !=, contains, not_contains, gt >, lt <, exists "is set"); "No conditions set" when empty. Two output rows: `yes` (green, "IF . true") and `no` (red, "ELSE . false"); edges drawn from `no` get the red edge style.
- **Endpoints:** none.
- **Data:** `data` = `{conditions:[{variable:'', operator:'equals', value:''}], operators:[]}`; `operators` has n-1 entries of `'AND'|'OR'`. Handles `yes` and `no`.
- **Rules & edge cases:**
  1. Builder-side validation: none (blank variable or value saves). A flow whose Condition has an unwired port is legal; the runtime dead-ends that branch (parks or ends, FLR).
  2. Evaluation order (runtime): rules are folded strictly left to right with no AND-over-OR precedence, e.g. `A OR B AND C` is `(A OR B) AND C`. Say so in the port UI.
  3. Comparisons are case-insensitive and trimmed; `gt`/`lt` use numeric parsing (non-numbers evaluate false); `exists` checks the named variable itself is non-empty (a Sheets row counts as set when it has cells).
  4. QUIRK: for every operator except exists, a blank or unset variable falls back to the customer's LAST MESSAGE text, so `not_equals`/`not_contains` on an unset variable compares the last message instead of failing. Also a blank variable name compares the last message.
  5. The compare value is a literal string; the runtime does not substitute `{{vars}}` into it (static read), so comparing two variables is not supported.
  6. Variable names are cleaned server-side (`{{plan}}`, `@plan`, spaces -> `plan`). Legacy single `var/op/value` data is promoted to one rule. Unknown operator values from imported flows evaluate to false with a warning.
  7. The runtime also knows `starts_with`, `ends_with`, `is_empty`, `is_not_empty`, `not_exists` which the builder never offers (reachable only via import).
- **Async & events:** FlowNormalizer: `condition` -> `flowNodeType: Condition`; `conditions` (variable cleaned, operator, value as strings), `logicOperators` (uppercased, anything not OR becomes AND) and flat first-rule fields `variable`, `operator`, `compareValue` for legacy executors. Handles `yes` -> port 1, `no` -> port 2. Execution is FLR.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a new Condition, then it shows "IF {{?}} = ?" style preview, ports `yes` and `no`, and one rule with operator Equal to.
  - Given the operator Is set, then the value input disappears and the card shows "is set".
  - Given two rules joined by OR, when the first rule is removed, then one rule remains and `operators` is empty; the last remaining rule has no remove button.
  - Given rules `plan = pro` AND `age gt 18`, then the normaliser outputs `logicOperators:['AND']`, flat `variable='plan'`, `compareValue='pro'`, and an edge handle `no` becomes `sourceNodeId <id>_2`.
  - Given a customer value "Pro " for variable plan and the rule `plan equals pro`, then (runtime) the condition is true.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`nodeRows`, `renderPreview` condition, Inspector `case 'condition'`), `app/Services/Flows/FlowNormalizer.php` (`case 'condition'`, `PORT_MAP`), `node/services/flowService.js` (`evaluateFlowConditions`, `executeConditionNode`).
- **Port notes:** a shared pure evaluator in `packages/` used by the runtime and the simulator; make precedence explicit (or support grouping); drop the last-message fallback; allow variable references on the right-hand side.

### WD-FLB-039 — Wait (delay) node

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-017
- **Summary:** Pauses the flow for a fixed duration (seconds, minutes, hours or days) and then continues on its single output.
- **Actors & access:** workspace admin. Palette group "Logic", label "Wait", description "Pause for X minutes". Modes: all ten.
- **UX & screens:** inspector, two fields: **Amount** (number input, placeholder 5) and **Unit** select (seconds `sec`, minutes `min`, hours `hour`, days `day`). No preview. Card: "Wait <amount> <unit>" (for example "Wait 5 min"; the unit code is shown raw: sec/min/hour/day). Single output `out` "after wait". Input port on the left.
- **Endpoints:** none.
- **Data:** `data` = `{amount:5, unit:'min'}`.
- **Rules & edge cases:**
  1. No min/max/step on the input. The control parses with a float parser, so clearing the box stores NaN (serialised as null) and the normaliser then falls back to 5; decimals are truncated by the normaliser (0.5 becomes 0), negatives are accepted. QUIRK: 0, negative or truncated-to-zero values mean NO wait at runtime (the runtime only honours a positive normalised `delaySeconds`).
  2. Unit mapping at normalise time: sec/second/seconds x1, min/minute/minutes x60, hour/hours x3600, day/days x86400; any other unit counts as minutes. Result is stored as one scalar `delaySeconds = amount x multiplier`.
  3. QUIRK (runtime, FLR): the wait is an in-process timer held by the Node runner, not a persisted scheduled job, so long waits (hours or days) are lost if the runner restarts, and a platform timer cap of about 24.8 days applies. The builder does not warn. Port as a durable delayed job (BullMQ delayed job keyed by run id).
  4. The card text shows the amount exactly as typed.
  5. Wait does not consult business hours or the WhatsApp 24-hour window; messages sent after a long wait may fall outside the window (FLR / channel rules).
- **Async & events:** FlowNormalizer: `delay` -> `flowNodeType: TimeDelay` with `delaySeconds`. Runtime sleeps then follows port 1 (FLR).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given amount 2 and unit hours, then the card reads "Wait 2 hour" and the normalised `delaySeconds` is 7200.
  - Given an empty amount, then the normaliser output is 5 minutes (300 seconds).
  - Given unit days and amount 1, then `delaySeconds` is 86400; given an unknown unit value from an imported flow, then it is treated as minutes.
  - Given amount 0.5 minutes, then `delaySeconds` is 0 and the node does not delay.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`defaultData`, Inspector `case 'delay'`, `renderPreview`), `app/Services/Flows/FlowNormalizer.php` (`case 'delay'`), `node/services/flowService.js` (`executeTimeDelayNode`).
- **Port notes:** validate `amount` as an integer >= 1 with an upper bound per unit, store ms or an ISO duration in the contract, and schedule with a durable delayed job so waits survive restarts and deploys.

### WD-FLB-040 — Webhook node

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-024
- **Summary:** Calls an external HTTP endpoint mid-flow with variable substitution in the URL, headers and body, and stores the response (whole body plus every JSON field) in a variable for later nodes.
- **Actors & access:** workspace admin. Palette group "Logic", label "Webhook", description "Call external HTTPS endpoint". Modes: all ten. The Test runner can fire a real request for this node (WD-FLB-024).
- **UX & screens:** inspector fields in order: **Method** select (POST default, GET, PUT, PATCH, DELETE); **URL** text (placeholder `https://api.example.com/stock?field={{field}}`); **Headers** list of key/value rows (key input about 40% width, value input with slash picker, delete "x"; "Add header" link; hint e.g. "Authorization -> Bearer {{api_token}}. Values can use {{variables}}."); **Content type** select (JSON `application/json` default, Form URL-encoded `application/x-www-form-urlencoded`, Plain text `text/plain`); **Body** textarea 4 rows (placeholder `{ "field": "{{field}}" }`, hint "Sent for POST/PUT/PATCH. {{variables}} are substituted."); **Save response to** text (`save`, default `response`, hint about `{{response}}`). Card: method chip plus the URL truncated to 32 characters (placeholder "https://..."). Single output `out` "response".
- **Endpoints:** none for the node itself; Test-runner endpoint `POST flows/api/test-webhook` is WD-FLB-024.
- **Data:** `data` = `{method:'POST', url:'', body:'', contentType:'application/json', headers:[], save:'response'}`; header rows `{key, value}`.
- **Rules & edge cases:**
  1. Builder-side validation: none (empty URL, non-HTTPS URL, invalid JSON body all save). With an empty URL the runtime logs and skips straight to the next node.
  2. Normaliser: method upper-cased, `variable` cleaned (default `response`), headers filtered to rows with a non-empty key, content type default JSON.
  3. Runtime request (FLR; recorded here because it decides what the builder can promise): `{{vars}}` substituted in URL, body and header values; JSON body parsed (on parse failure retried with JSON-escaped substitution, then sent raw); GET/HEAD send no body; a hidden `_wadesk` context object (customer phone, wa id, name, device phone, WABA ids, conversation id, flow id) is merged into every JSON-object body without overwriting an operator-supplied `_wadesk` key (QUIRK: undocumented in the UI); SSRF guard rejects non-http(s) schemes and private, loopback, link-local or reserved IPs; redirects are NOT followed (3xx fails); timeout 15 s; response capped at 5 MB.
  4. Response handling: the whole response is saved as a string under the variable and, for JSON objects, flattened into dotted keys (`response.field`, arrays by index). A response key `set_user_message` overrides the running `{{user_message}}` (used by the ordering endpoints). On any error (HTTP error, timeout, SSRF reject) the variable is set to an empty string and the flow CONTINUES on `out`: there is no error branch.
  5. Custom headers can override Content-Type; secrets typed into header values or the URL are stored in the graph JSON in clear (encrypted at rest as part of the whole `flow_data` blob only) and are included in flow export/duplicate/template clone.
  6. Method DELETE sends the body (only GET and HEAD omit it), despite the hint.
- **Async & events:** FlowNormalizer: `webhook` -> `flowNodeType: Webhook` with `method`, `url`, `body`, `variable`, `contentType`, `headers`. Execution and logging are FLR (inbound/outbound webhook auditing is not part of this node).
- **External systems:** any customer-provided HTTP endpoint.
- **Settings:** none in the builder; SSRF/timeout/size limits are runtime constants.
- **Acceptance criteria:**
  - Given a new node, then it shows POST, empty URL, JSON content type, response variable `response` and one output "response".
  - Given a header row with an empty key, then the normaliser drops it; given `save` = `{{res}}`, then `variable` is `res`.
  - Given a webhook returning `{"stock":4}` saved as `response`, then (runtime) `{{response.stock}}` resolves to `4` in later nodes.
  - Given a URL resolving to a private IP, then (runtime) the call is refused, the variable becomes empty and the flow continues on `out`.
  - Given a JSON-object body with no `_wadesk` key, then the receiver gets the context envelope under `_wadesk`.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`defaultData`, Inspector `case 'webhook'`, `renderPreview`), `app/Services/Flows/FlowNormalizer.php` (`case 'webhook'`), `node/services/flowService.js` (`executeWebhookNode`, `assertPublicHttpUrl`), `app/Http/Controllers/FlowsController.php` (`apiTestWebhook`).
- **Port notes:** implement as a worker job behind an HTTP egress adapter with an allow-list/SSRF resolver, per-org rate limit and size/timeout caps; store header secrets in a secrets table referenced by id rather than inline; expose an error port and the status code in a variable; validate URL scheme on publish.

### WD-FLB-041 — Run code (JS) node

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-017
- **Summary:** Runs a snippet of sandboxed JavaScript that can read the saved flow variables and return an object; the return value is stored in a variable for later nodes.
- **Actors & access:** workspace admin. Palette group "Logic", label "Run code (JS)", description "Sandboxed JavaScript transform". Modes: chat (WhatsApp) and call only; excluded from Instagram and every other channel because those runners are not the Node VM runner.
- **UX & screens:** inspector: dark info box listing the inputs `previousResponse`, `allResponses`, `functionArgs` and "return an object to save it"; **JavaScript** monospace dark textarea 12 rows with spellcheck off and hint "No file / network / require access. CPU + memory are capped."; **Save return value to** text (`save`, default `result`; hint shows `{{result}}` or `{{result.FIELD}}`). Default code is a commented sample that returns `{ok:true, message:"Hello from the code node"}`. Card: "JS" chip and "save -> {{result}}". Single output `out` "done".
- **Endpoints:** none.
- **Data:** `data` = `{code:'<sample>', save:'result'}`.
- **Rules & edge cases:**
  1. No builder validation: no syntax check, no size limit, no dry-run.
  2. QUIRK: despite the hint, `previousResponse` is NOT the previous node's output; the runtime passes the current value of the node's OWN save variable (null on first run). `allResponses` is the whole variable bag and `functionArgs` is any `args` set on the node (the builder has no field for it, so empty object).
  3. Runtime sandbox: time cap 2 s, memory cap 16 MB; engine is `isolated-vm` when installed, otherwise Node's built-in `vm` module (not a real security boundary; the normaliser comment calls it env-gated). Execution errors do not stop the flow: the variable becomes `{ok:false, error}` and the flow continues on `out`.
  4. Output saved as an object under `save` plus one dotted key per top-level field (`result.ok`); non-object returns are saved as-is.
  5. The code is stored verbatim in the graph (and in exports and templates).
- **Async & events:** FlowNormalizer: `code` -> `flowNodeType: Code` with `code` and `variable` (cleaned, default `result`). PHP never evaluates the code; execution is in `node/services/codeSandbox.js` (FLR).
- **External systems:** none.
- **Settings:** optional `isolated-vm` dependency on the runner (deployment concern).
- **Acceptance criteria:**
  - Given a new node, then the default sample code is shown, `save` is `result` and the card shows "JS" and "save -> {{result}}".
  - Given code that returns `{total: 3}` and save `calc`, then (runtime) `{{calc.total}}` is `3` afterwards.
  - Given code with an infinite loop, then (runtime) it is aborted at about 2 seconds, `{{result}}` holds an error object and the flow continues.
  - Given a Facebook flow, then the node is not in the palette and an existing one is flagged on save.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`defaultData`, Inspector `case 'code'`), `app/Services/Flows/FlowNormalizer.php` (`case 'code'`), `node/services/flowService.js` (`executeCodeNode`), `node/services/codeSandbox.js`.
- **Port notes:** run user code in a separate, resource-limited sandbox worker (isolated-vm or a micro-VM), never in the API process; tenant-scope CPU/memory quotas and audit logs; fix the `previousResponse` semantics to match the label; gate behind a plan/feature flag.

### WD-FLB-042 — MySQL query node

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-017
- **Summary:** Runs a read-only SELECT against the customer's own external MySQL/MariaDB database and stores the returned rows (JSON) in a variable so an AI or message node can answer from live data.
- **Actors & access:** workspace admin. Palette group "Logic", label "MySQL Query", description "Run a read-only SQL query". Mode: chat (WhatsApp) only. The callback endpoint is Node-only (`X-Node-Token`).
- **UX & screens:** inspector: notice "Read-only - only SELECT queries run. Credentials are stored encrypted and only used to fetch data for the reply." Fields: **Host** (default `localhost`, placeholder db.yoursite.com), **Port** (text, default `3306`), **Database**, **Username**, **Password** (password-type input, placeholder dots; the one text control without the slash picker), **SQL query** (textarea 4 rows, default `SELECT * FROM products WHERE field = {{field}}`, hint "SELECT only. Use {{variables}} from earlier nodes"), **Save rows to** (`save`, default `rows`, hint "Returned rows (JSON) are stored here"). Card: no dedicated preview (header only). Single output `out` "rows".
- **Endpoints:**

| Method uri                | Route name                | Controller@action                       | Middleware                            | Request                                                                                                                                                                          | Response                                                                                                                                                                                  |
| ------------------------- | ------------------------- | --------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST api/flow-node/mysql-query | api.flow-node.mysql-query | FlowNodeActionsController@mysqlQuery | `X-Node-Token` checked in the action | `host` required max 255; `port` int 1-65535 (default 3306); `database` required max 128; `username` max 128; `password` max 255; `sql` required max 8000 | 200 `{ok:true, rows:[...], count}`; 401 `{ok:false,error:'unauthorized'}`; 422 `{ok:false,error}` for the SQL guard; 502 `{ok:false,error:'Query failed: <driver message>'}` |

- **Data:** `data` = `{host:'localhost', port:'3306', database:'', username:'', password:'', sql:'...', save:'rows'}`. QUIRK: the password is saved in plain text inside the node data (the claim "stored encrypted" holds only because the whole `flow_data` blob is encrypted at rest); it is returned to the builder when the flow is reopened, included in flow export `.json`, duplicates, and template clones, and sent to the runtime in the normalised graph.
- **Rules & edge cases:**
  1. Builder-side validation: none; host, database and SQL may be empty (the runtime then skips the node, sets the variable to an empty string and continues).
  2. Server guard in `mysqlQuery`: the statement (after trimming trailing semicolons) must start with SELECT or WITH, must contain no semicolon at all (even inside a string literal), and must not contain INTO OUTFILE, INTO DUMPFILE or LOAD_FILE; otherwise 422 with the messages "Only a single statement is allowed.", "Only SELECT queries are allowed." or "File operations are not allowed.". Connection timeout 8 s; at most 100 rows returned; charset utf8mb4; exceptions give 502.
  3. QUIRK / security: `{{variables}}` are substituted into the SQL by plain string replacement with no escaping or parameter binding, so customer-typed text can alter the query (UNION SELECT, boolean injection) against whatever the DB user can read. The SELECT-only guard limits writes, not reads. Port must parameterise (bind variables) or restrict to a template with typed placeholders.
  4. QUIRK / security: the host is arbitrary and the connection is opened from the application server (no SSRF/private-network guard on this endpoint, unlike the Webhook node).
  5. Results: rows saved as a JSON string under `save` and flattened into dotted keys (`rows.0.name`, `rows.length`). On any failure the variable is set to an empty string and the flow continues (no error port).
  6. Port is an integer after normalisation; a non-numeric value becomes 0 -> the controller falls back to 3306 only if null (a 0 fails validation min 1).
- **Async & events:** FlowNormalizer: `mysql` -> `flowNodeType: MySQL` with `host`, `port` (int, default 3306), `database`, `username`, `password`, `sql`, `variable` (cleaned, default `rows`). The runtime posts to the callback above (15 s HTTP timeout) with the workspace id; PHP PDO executes the query.
- **External systems:** customer MySQL/MariaDB over TCP, credentials in the node.
- **Settings:** none (node token shared secret in `.env`).
- **Acceptance criteria:**
  - Given `SELECT qty FROM stock WHERE sku = '{{sku}}'` and a reachable DB, then (runtime) the variable `rows` holds a JSON array and `{{rows.0.qty}}` resolves.
  - Given the SQL `DELETE FROM x`, then the endpoint returns 422 "Only SELECT queries are allowed." and the flow continues with an empty `rows`.
  - Given `SELECT 1; SELECT 2`, then 422 "Only a single statement is allowed."; given a query returning 500 rows, then only the first 100 are returned.
  - Given a wrong host, then 502 "Query failed: ..." after at most 8 s and the flow continues.
  - Given a request without the node token, then 401.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`defaultData`, Inspector `case 'mysql'`), `app/Http/Controllers/FlowNodeActionsController.php` (`mysqlQuery`), `app/Services/Flows/FlowNormalizer.php` (`case 'mysql'`), `node/services/flowService.js` (`executeMysqlNode`).
- **Port notes:** put credentials in a secrets store, never in the graph or export; execute through a query worker with parameter binding, an egress allow-list and a read-only transaction; consider limiting to a curated "data source" object created once per org (reuse across nodes) instead of per-node credentials.

### WD-FLB-043 — AI assistant node

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-026
- **Summary:** Replies to the contact with a language model (OpenAI, Anthropic, Gemini or Mistral model enabled by the platform or the workspace's own key), optionally grounded in a trained knowledge base, optionally in structured-extraction mode that produces JSON fields for later nodes, optionally silent, optionally "conversation mode" where the AI keeps replying until an exit keyword.
- **Actors & access:** workspace admin. Palette group "AI", label "AI assistant", description "Reply with ChatGPT or Gemini". Modes: chat plus the eight social/email modes (the legacy `ig_ai` is hidden and superseded). Model availability gated by the platform's active AI keys and workspace BYOK keys (AIAG/AIADM domains).
- **UX & screens:** inspector fields: **Model** (`model`, select; first option "- pick model -"; with no providers: "No AI models enabled - ask admin to switch one on"; a saved model missing from the list is appended as "<model> (not enabled)"; hint explains admin-enabled models plus the workspace's own keys on BYOK plans, linking to Settings -> AI keys when empty); **System prompt** (`prompt`, textarea 5 rows, no default placeholder); **Save response to** (`save`, default `reply`; hint `{{reply}}` or `{{reply.FIELD}}` when extracting); **Knowledge base (optional)** (`assistant`, select "- none (use the prompt above only) -" plus trained assistants "<name> . N source(s)"; a saved id not in the list shows "(assistant #N)"; hints: none trained yet -> link to AI Training; chosen assistant with 0 sources -> warning that only the prompt is used); checkbox **Extract structured data (JSON)** (`extract`), then **Fields to extract** (`fields`, comma-separated keys, placeholder is a sample farm-record list; hint: the AI returns ONE JSON object, each key becomes `{{reply.KEY}}`, and `{{reply.__rows}}` when several records are detected, e.g. for a Sheets node); checkbox **Silent** (`silent`, "don't send a reply to the customer (extraction only)"); checkbox **Conversation mode** (`conversational`, "the AI keeps replying to every message instead of answering once"), then **Exit keyword (optional)** (`exit_keyword`, placeholder `menu`, hint: when the customer types exactly this the AI hands back and the flow continues). Card: robot glyph plus the model name, then the prompt clamped to two lines (default text "You are a friendly support assistant..."). Single output `out` "reply ready". No WhatsApp preview in the inspector.
- **Endpoints:**

| Method uri                 | Route name              | Controller@action                    | Middleware                                | Request                                                                                                                                                                                                              | Response                                                                                                         |
| -------------------------- | ----------------------- | ------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| GET flows/api/ai-models    | user.flows.api.ai-models | FlowsController@apiAiModels          | Authenticate, workspace.role:admin        | none                                                                                                                                                                                                                 | `{ok, models:[{value,label,provider}]}`: active admin keys (each provider's default model first plus `extra_config.models`, ElevenLabs excluded) with a provider replaced by the workspace's own active keys when present, labelled "(your key)" using fixed per-provider defaults |
| GET flows/api/ai-assistants | user.flows.api.ai-assistants | FlowsController@apiAiAssistants   | same                                      | none                                                                                                                                                                                                                 | `{ok, assistants:[{id,name,status,sources}]}` where `sources` counts READY training sources (workspace-wide or that assistant's)                          |
| POST api/flow-node/ai-call | api.flow-node.ai-call   | FlowNodeActionsController@aiCall     | `X-Node-Token` checked in the action      | `workspace_id` int; `model` required max 120; `assistant_id` int; `call_assistant_id` int; `system_prompt` max 6000; `user_prompt` max 6000; `max_tokens` 1-4000 (default 350); `temperature` 0-2 (default 0.7); `json` bool; `fields[]` strings max 120 | 200 `{ok:true, reply, provider}`; 401; 502 `{ok:false,error:'provider_failed',message}` when the provider returns nothing |

- **Data:** `data` = `{model:'gpt-4o-mini', prompt:'You are a friendly support assistant. Reply briefly.', save:'reply', assistant:'', extract:false, silent:false, fields:''}`; `conversational` and `exit_keyword` are absent until toggled (QUIRK). `temperature` and `maxTokens` are honoured by the normaliser if present but there is NO inspector control for them.
- **Rules & edge cases:**
  1. Builder validation: none. The default model `gpt-4o-mini` may not be enabled for the workspace; the select then shows it with "(not enabled)" and the call fails at run time with `provider_failed`.
  2. The controller infers the provider from the model name prefix: `claude*` -> Anthropic, `gemini*` -> Google, `mistral*`/`ministral*`/`open-mistral*`/`open-mixtral*` -> Mistral, anything else -> OpenAI. Workspace BYOK key wins when the plan allows it, else the platform key, else env fallback.
  3. Extraction mode: the system prompt is extended so the model returns ONLY JSON (a single object with exactly the listed keys, or `{"rows":[...]}` when several records are present, empty strings for unknown values, no invention). `fields` may be a comma string (builder) or array; the normaliser splits and trims it into a string array. The runner promotes `rows` to `<save>.__rows` and each key to `<save>.KEY` (FLR).
  4. Knowledge base: the assistant's READY training sources are appended to the system prompt between knowledge-base markers; the lookup is workspace-scoped (an assistant id from another workspace is ignored). A voice-assistant id (`call_assistant_id`, used by the Call-flow node) swaps in that assistant's persona and model.
  5. Silent mode suppresses the customer message but the node still saves the reply to the variable (use with extraction). Conversation mode makes the node park on itself and answer every message until the exit keyword (exact match), then continue on `out`.
  6. Prompt, user prompt and the knowledge base are not length-checked in the builder; the endpoint rejects system prompts above 6000 characters. Reply text is capped by `max_tokens` (default 350).
  7. Failures: no key or provider error -> 502; the runner then saves an empty variable and continues (FLR).
- **Async & events:** FlowNormalizer: `ai` -> `flowNodeType: ChatGPT` with `model`, `prompt`, `variable` (cleaned, default `reply`), `assistant_id` (int or null), `extract`, `silent`, `conversational`, `exit_keyword`, `fields[]`, optional `temperature` and `maxTokens`. Runtime calls the ai-call endpoint; token usage billing and the BYOK/admin wallet rules belong to AIAG/AIADM.
- **External systems:** OpenAI, Anthropic, Google Gemini, Mistral APIs via the platform's AI service; keys in admin settings or workspace provider keys.
- **Settings:** platform AI keys (`admin_ai_keys`, active + default model + extra models); workspace provider keys (BYOK); plan flag for BYOK.
- **Acceptance criteria:**
  - Given the platform enabled OpenAI (default gpt-4o-mini) and Anthropic, then the Model list shows "OpenAI . gpt-4o-mini" and "Anthropic . <default>" and picking one writes the raw model id.
  - Given the workspace added its own OpenAI key, then the OpenAI entries become "OpenAI (your key) . gpt-4o-mini / gpt-4o" and the platform OpenAI models disappear.
  - Given Extract on with fields `NAME, DATE`, then the normalised node has `extract=true` and `fields=['NAME','DATE']` and the inspector hint mentions `{{reply.KEY}}`.
  - Given Conversation mode off, then the Exit keyword field is hidden; switched on, it appears and is stored as `exit_keyword`.
  - Given the ai-call endpoint without a configured key for the provider, then 502 `provider_failed` with a message naming the provider.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`defaultData`, Inspector `case 'ai'`, `AI_MODELS_CACHE`, `AI_ASSISTANTS_CACHE`), `app/Http/Controllers/FlowsController.php` (`apiAiModels`, `apiAiAssistants`), `app/Http/Controllers/FlowNodeActionsController.php` (`aiCall`), `app/Services/Flows/FlowNormalizer.php` (`case 'ai'`), `node/services/flowService.js` (`executeChatGPTNode`).
- **Port notes:** expose a provider-neutral model catalogue from the AI domain (model id, provider, capability), not a hard-coded prefix switch; add temperature and max-token controls; store assistant id as an FK; run completions in a worker with usage metering; handle the JSON mode through each provider's native structured-output feature.

### WD-FLB-044 — Tag contact node

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-026
- **Summary:** Adds or removes a tag on the contact's conversation when the flow reaches the node. The tag is picked from the workspace's tags or typed as a new name that is created on first use.
- **Actors & access:** workspace admin. Palette group "Contact", label "Tag contact", description "Add or remove a tag". Mode: chat (WhatsApp) only.
- **UX & screens:** inspector: **Action** select (`action`: "Add tag to contact" `add` default, "Remove tag from contact" `remove`); **Tag** (a select of existing workspace tags "- pick existing tag -" / "No tags yet - type a new name below"; a saved tag id that no longer exists shows "(deleted tag #N)"), plus a text input "...or type a new tag". Choosing from the select writes `tagId` AND copies the name into `tag`; typing in the text input writes `tag` and CLEARS `tagId`. Hint "Pick from existing tags or type a new name. The contact gets tagged (or untagged) when this node fires." Card: the action word (add/remove) and a coloured pill with the tag's CURRENT name and colour looked up from the tag list (so renames show on the canvas), falling back to the stored name with an italic "new" marker when it is not an existing tag; "-" when empty. Single output `out` "next".
- **Endpoints:**

| Method uri             | Route name           | Controller@action              | Middleware                            | Request                                                                                                                                       | Response                                                                                                                                                   |
| ---------------------- | -------------------- | ------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST api/flow-node/tag | api.flow-node.tag    | FlowNodeActionsController@tag  | `X-Node-Token` checked in the action  | `workspace_id` required int; `customer_phone` required max 32; `action` in add/remove; `tag_id` nullable int; `tag_name` nullable max 64 | 200 `{ok:true, tag_id, action}`; 401; 404 `conversation_not_found`; 422 `tag_unresolved`; 500 `tag_failed`. Picker list comes from `GET team-inbox/api/tags` (TIB domain). |

- **Data:** `data` = `{action:'add', tag:'', tagId:''}`. Both `tagId` and the name snapshot `tag` are stored.
- **Rules & edge cases:**
  1. Builder-side validation: none; with neither id nor name the runtime skips the node (also skips when the flow has no workspace id).
  2. Resolution at the endpoint: by `tag_id` scoped to the workspace first; otherwise by name via first-or-create keyed on workspace + slug of the name (name trimmed, colour default `#075E54`). QUIRK: slug matching means "VIP", "vip" and "V.I.P" resolve to the same tag; QUIRK: a REMOVE action with a name that does not exist still creates that tag, then detaches it (junk tag).
  3. QUIRK: tag names longer than 64 characters fail validation (422 from the framework) and the runtime just logs and continues; the builder has no limit.
  4. The tag is attached to the CONVERSATION for that customer number (the team-inbox tags relation), using sync-without-detaching for add and detach for remove; a conversation event `tag_added` or `tag_removed` with source `flow` is written. If the customer has no conversation row the endpoint returns 404 and the flow continues without tagging.
  5. Because the tag lands on the conversation, "tag added" audience triggers (WD-FLB-071) fire only if that service hooks conversation tags.
  6. Runtime failures (timeout 8 s) never stop the flow: it moves to `out` regardless.
- **Async & events:** FlowNormalizer: `tag` -> `flowNodeType: TagContact` with `action` (add unless explicitly remove), `tagId` (string), `tag` (string). The conversation event and any tag-added enrolment are written by the callback / enrolment service (FLB-071, TIB).
- **External systems:** none.
- **Settings:** node token shared secret (`.env`).
- **Acceptance criteria:**
  - Given an existing tag "Hot lead" picked, then the node stores `tagId` and `tag='Hot lead'`, the card pill shows its colour, and renaming the tag elsewhere updates the card text after reload.
  - Given the admin types "New tag" in the text field, then `tagId` is cleared and the card pill shows "New tag" with the "new" marker.
  - Given the callback with `action=add` and `tag_name='Promo'` that does not exist, then a tag "Promo" with colour `#075E54` is created, attached to the conversation, and a `tag_added` event with source `flow` exists.
  - Given the callback for a number with no conversation, then 404 `conversation_not_found`.
  - Given `tag_id` of another workspace and no name, then 422 `tag_unresolved`.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`TAGS_CACHE`, Inspector `case 'tag'`, `renderPreview`), `app/Http/Controllers/FlowNodeActionsController.php` (`tag`), `app/Services/Flows/FlowNormalizer.php` (`case 'tag'`), `node/services/flowService.js` (`executeTagContactNode`).
- **Port notes:** decide tag scope (contact vs conversation) with the CON/TIB owners and apply the tag to the contact record; validate names (max 64, no create on remove); dedupe by normalised name per org; write the audit event and outbox event in one transaction.

### WD-FLB-045 — Assign agent node

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-026
- **Summary:** Hands the conversation to a team's queue (using the team's own assignment strategy) or to a named agent, with an optional internal note for the receiving agent. The flow continues afterwards.
- **Actors & access:** workspace admin. Palette group "Contact", label "Assign agent", description "Hand off to a human". Mode: chat (WhatsApp) only.
- **UX & screens:** inspector: **Team** (`team`, select "- pick team -" with options "<team name> . N agent(s)", or "No teams yet - create one in /team-inbox"; an unknown saved id is listed as "<id> (not in workspace)"; hint links to /team-inbox); once a team is picked, **Assign to specific agent (optional)** (`userId`, options "Any (use team strategy)" plus that team's members); **Note for agent** (`message`, textarea 3 rows, hint "Internal note shown on the conversation when it lands in the team's inbox"). Card: "Team <name or Team #id or - pick team -> ...>", an "Agent <name>" row when set, and the note in quotes (40 characters). Single output `out` "next".
- **Endpoints:**

| Method uri                | Route name            | Controller@action                | Middleware                           | Request                                                                                                                                                                                                                                  | Response                                                                                                                                                                   |
| ------------------------- | --------------------- | -------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST api/flow-node/assign | api.flow-node.assign  | FlowNodeActionsController@assign | `X-Node-Token` checked in the action | `workspace_id` required int; `customer_phone` required max 32; `team_id` nullable int, must exist in this workspace and not be soft-deleted; `user_id` nullable int, must be a member of this workspace; `note` nullable max 1024 | 200 `{ok:true, conversation_id, assignee_user_id}`; 401; 404 `conversation_not_found`; 422 `assignment_target_invalid` or validation (messages "That member is not part of this workspace." / "That team is not part of this workspace."); 500 `assign_failed`. Teams list: `GET team-inbox/api/teams` (TIB). |

- **Data:** `data` = `{team:'', userId:'', message:''}` (ids as strings).
- **Rules & edge cases:**
  1. Builder-side validation: none; at runtime a node with neither team nor user is skipped.
  2. The agent picker only renders after a team is chosen, so an agent cannot be set without a team in the UI. QUIRK: changing the team does NOT clear `userId`; the agent select then shows "Any" while the old user id is still stored and sent. The endpoint checks the user is in the workspace but NOT that the user belongs to the chosen team.
  3. Strategy: explicit user -> `manual`; team only -> the team's configured assignment strategy, `round_robin` when none/unknown. Actor id is null (no human acted).
  4. The note is written as a `note_added` conversation event with source `flow` (internal; never sent to the customer). Notes above 1024 characters fail validation; the builder has no limit.
  5. Ids in imported flow JSON are not trusted: the endpoint re-checks team and member against the workspace (deleted/foreign ids produce 422 and the flow carries on).
  6. The flow is NOT ended by this node; it moves to `out`. Typical use is Assign agent followed by End.
  7. Conversation lookup is by the customer's number; no conversation -> 404 (flow continues).
- **Async & events:** FlowNormalizer: `assign` -> `flowNodeType: AssignAgent` with `teamId`, `userId`, `noteForAgent` (strings). Assignment side effects (assignee change, round-robin pointer, notifications, SLA) are owned by AssignmentService (TIB1/TIB2).
- **External systems:** none.
- **Settings:** team `assignment_strategy` (TIB); node token shared secret.
- **Acceptance criteria:**
  - Given team "Support" (3 agents) is picked and no agent, when the node fires, then the conversation is assigned per the team's strategy and the response has an `assignee_user_id`.
  - Given a specific agent is picked, then assignment strategy is `manual` and that user is the assignee.
  - Given a team id from another workspace in the payload, then 422 with "That team is not part of this workspace." and no assignment change.
  - Given the note "VIP, call back", then a `note_added` event with that text and source `flow` exists on the conversation.
  - Given the admin changes the team after picking an agent, then (reference) the stored `userId` stays; the port must clear or validate it.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`TEAMS_CACHE`, Inspector `case 'assign'`, `renderPreview`), `app/Http/Controllers/FlowNodeActionsController.php` (`assign`, `teamStrategy`), `app/Services/Flows/FlowNormalizer.php` (`case 'assign'`), `node/services/flowService.js` (`executeAssignAgentNode`).
- **Port notes:** call the inbox assignment service in-process from the runtime worker (not over HTTP with a shared secret); validate member-in-team; emit assignment audit + outbox events; keep the "internal note" as a conversation note entity.

### WD-FLB-046 — Run sub-flow node

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-026
- **Summary:** Points at another saved flow in the workspace. The inspector promises "that flow runs end-to-end before control returns to the next node here"; the runtime actually switches the running session to the other flow without returning.
- **Actors & access:** workspace admin. Palette group "Logic", label "Run sub-flow", description "Call another flow". Mode: chat (WhatsApp) only.
- **UX & screens:** inspector: one field **Flow to run** (`flow`, select; first option "- pick flow -" or "Loading flows..." while the list is empty; each option "<flow name or Flow #id> . live|draft"; the flow currently being edited is omitted when it already has an id; a saved id missing from the list shows "Flow #id (not in workspace)"). Hint: "Pick another saved flow. When this node fires, that flow runs end-to-end before control returns to the next node here." Card: "run <flow name>" resolved from the cached list (falls back to "Flow #id" while loading or if the flow left the workspace, "pick flow..." when empty). Single output `out` labelled "after run".
- **Endpoints:**

| Method uri          | Route name          | Controller@action          | Middleware                         | Request | Response                                                                                       |
| ------------------- | ------------------- | -------------------------- | ---------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| GET flows/api/list  | user.flows.api.list | FlowsController@apiIndex   | Authenticate, workspace.role:admin | none    | `{success:true, data:[Flow...]}` every flow of the workspace (all channels, statuses), newest-updated first; fetched once on builder mount |

- **Data:** `data` = `{flow:''}` holding the picked flow's id as a string. No name snapshot is stored (the card resolves the name live).
- **Rules & edge cases:**
  1. Builder-side validation: none; an empty pick saves, the normaliser emits an empty `flowId` and the runtime falls through to the next node.
  2. The list is NOT filtered by channel, type (call/Instagram/Facebook flows included), publication state or pause state, and drafts are selectable (labelled "draft"). Only the flow being edited is excluded, and only once it has been saved; indirect cycles (A runs B runs A) are not detected by the builder.
  3. QUIRK (runtime, FLR, from a static read of `executeChatbotNode`): "SubFlow" is an alias of the Chatbot executor. It fetches the target graph and REPLACES the session's flow data, then starts at the target's first node. Nothing resumes the parent graph afterwards, so the `out` ("after run") port is only followed if the target flow cannot be loaded or errors. Treat this node as "go to flow" unless FLR chooses to implement a real call stack; if it does, preserve the contract that `out` runs after the child ends.
  4. QUIRK / security: the runtime-facing flow fetch (`GET api/flows/{id}`, token-gated) looks the flow up by id WITHOUT a workspace scope, so an imported graph could run another workspace's flow. The port must scope by org.
  5. The target flow's own Trigger is ignored when called as a sub-flow (execution starts at its start node).
  6. Variables: the session variable bag carries over into the target flow (runtime).
- **Async & events:** FlowNormalizer: `subflow` -> `flowNodeType: SubFlow`, `flowId` (string of `data.flow`). Port: `out` -> 1.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a workspace with flows "Welcome" (live) and "FAQ" (draft), then the dropdown offers "Welcome . live" and "FAQ . draft", excluding the flow being edited.
  - Given a picked flow that is later deleted, then the card reads "run Flow #<id>" and the inspector shows "Flow #<id> (not in workspace)".
  - Given the normaliser output for `{flow:'42'}`, then the node has `flowNodeType` SubFlow and `flowId='42'`.
  - Given a sub-flow id that belongs to another workspace, then the port must reject it at save/publish (the reference runtime does not).
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`FLOWS_CACHE`, Inspector `case 'subflow'`, `renderPreview`), `app/Services/Flows/FlowNormalizer.php` (`case 'subflow'`), `app/Http/Controllers/FlowsController.php` (`apiIndex`, `nodeShow`), `node/services/flowService.js` (`executeChatbotNode`, SubFlow dispatch).
- **Port notes:** store a flow FK (org-scoped) and pin to a published version; detect cycles on publish; decide with FLR between "goto" and "call/return" semantics and name the node accordingly; restrict the picker to same-channel published flows.

### WD-FLB-047 — End node

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-017
- **Summary:** An explicit terminal node: the flow stops here and anything after it does not run. It has no settings and no output port.
- **Actors & access:** workspace admin. Palette group "Start" (label "End", description "Stop the flow here"). Modes: all ten.
- **UX & screens:** inspector shows only the text "This node terminates the flow. Anything connected after it won't run." and the node id. Card: header chip, id, group tag, the body text "flow ends here" in italics, an input port on the left and NO output port.
- **Endpoints:** none.
- **Data:** `data` = `{}`. Handles: none.
- **Rules & edge cases:**
  1. Because End has no output port an edge cannot start from it in the UI; imported graphs with edges leaving End are ignored by the runtime.
  2. A leaf node that is not an End is legal in the builder (validation allows missing outgoing edges, WD-FLB-018). QUIRK / product rule (runtime): a branch that dead-ends WITHOUT an End node does not end the session; the runner keeps the last interactive menu tappable (or ends only if the flow had no menu). Operators who want the conversation to stop and cooldown to start must add an End node.
  3. Multiple End nodes are allowed; no singleton.
  4. Reaching End terminates the session immediately and starts the re-trigger cooldown (FLR owns the cooldown value).
- **Async & events:** FlowNormalizer has no TYPE_MAP entry: `flowNodeType` becomes "End" (ucfirst of the type) and no per-type fields are added. The runtime's End case ends the session.
- **External systems:** none.
- **Settings:** none in the builder.
- **Acceptance criteria:**
  - Given an End node on the canvas, then its card shows "flow ends here" and exposes no output port; dragging from it is impossible.
  - Given a branch ending in Send message with no End, then Save succeeds (no validation error) and (runtime) the session is not ended.
  - Given the normaliser runs on `{type:'end'}`, then the output node has `flowNodeType: 'End'`.
  - Given an End node with no incoming edge, then Save is blocked with the "not connected to anything" reason (it is not exempt).
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`NTYPES.end`, `nodeRows` end case, `NodeCard`, Inspector `case 'end'`), `app/Services/Flows/FlowNormalizer.php` (TYPE_MAP comment), `node/services/flowService.js` (End case, `parkOrEndFlow`, `endFlowSession`).
- **Port notes:** keep an explicit End node and add a publish-time warning for branches with no End; record a run outcome (completed) on reach. Cooldown semantics belong to FLR.

### WD-FLB-048 — Call to action (CTA) node

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-017
- **Summary:** Sends a message with up to three action buttons mixing a website link, a phone number to dial and a copyable code. How they render depends on the engine: on the WhatsApp Cloud API only a URL becomes a native button.
- **Actors & access:** workspace admin. Palette group "Engage", label "Call to action", description "Send a CTA button". Mode: chat (WhatsApp) only.
- **UX & screens:** inspector: info box ("Add up to 3 CTA buttons in one message ..."), a dark WhatsApp preview (intro bubble "Tap a button below to continue." or, when any action is Copy, "Tap a button below - or long-press a code to copy." with each copy code shown in a large monospace box; white button tiles with a glyph per type; header "Preview - WhatsApp - N button(s)"). Per action a card: ordinal, **type** select (Visit website `url`, Call `phone`, Call now `call_now`, Copy code `copy`), up/down, remove, **Button label** input, **value** input (monospace, placeholder `https://example.com` / `+1 555 123 4567` / `SAVE20` by type) and a per-type help sentence (Call: include country code and note that on Cloud API a flow Call shows as a tappable number, not a native button, because Call buttons are template-only; Copy: long-press to copy, same Cloud API caveat; URL: native tap button on Cloud API, a tappable link on the unofficial API). "Add button" link, replaced by "Max 3 buttons reached." at three (so the "Max 3 buttons per CTA" toast is effectively unreachable from the UI). Changing a type clears the value and, if the label was empty or still the old type's suggested label (Visit website / Call us / Call now / Copy code), replaces it with the new type's suggestion. Card: up to three chips (icon, label with fallback Copy/Call/Visit, upper-case type). Single output `out` "next".
- **Endpoints:** none.
- **Data:** `data.actions` = array of `{type, label, value}`; default one action `{type:'url', label:'Visit website', value:'https://example.com'}` (QUIRK: placeholder URL is a real default value). Legacy flows used flat `kind/label/url/phone/code`; the builder (inspector and card) and the normaliser both synthesise `actions[]` from them on read. The inspector has no fields for header, body or footer text although the normaliser and runtime support `headerText`, `bodyText`, `footerText` (QUIRK: a CTA from the builder has no body line).
- **Rules & edge cases:**
  1. Limits: max three actions (UI Add control; the normaliser also slices to three); there is no minimum, so removing every action is possible and leaves a node that sends nothing.
  2. Builder validation: none (empty label or value allowed). Runtime skips actions with an empty value; with no body and no valid actions nothing is sent on non-Cloud engines.
  3. Unknown types coerce to `url` in the normaliser. `phone` and `call_now` are distinct in the UI but render identically at runtime (a dial line / tel link).
  4. Runtime rendering (FLR): on Cloud API / Twilio, the first `url` action with an http(s) value is sent as a native call-to-action URL button (body = bodyText plus up to two other actions as text, falling back to the label); if there is none, everything is sent as plain text. On the unofficial engine all actions become text lines (`label: value`, phone prefixed with a phone glyph, copy codes in monospace backticks).
  5. Values are not validated (no URL scheme, phone format or code length check) and `{{variables}}` are not substituted by the normaliser (runtime may).
- **Async & events:** FlowNormalizer: `cta` -> `flowNodeType: CTA` with `ctaActions[]` (<=3, types coerced), `headerText`, `bodyText`, `footerText` and back-compat flat fields from the first action: `ctaType`, `ctaLabel` (default "Visit"), `ctaUrl` (`tel:<digits>` for phone types), `ctaPhone`, `ctaCode`.
- **External systems:** WhatsApp Cloud API `interactive cta_url` / text at runtime.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a new node, then it has one Visit website action with value `https://example.com`, and the card shows a chip "Visit website URL".
  - Given three actions, then "Add button" is replaced by "Max 3 buttons reached." and a fourth cannot be added.
  - Given the type is changed from Visit website to Copy code while the label is still "Visit website", then the label becomes "Copy code" and the value is cleared.
  - Given a legacy node `{kind:'phone', phone:'+1555', label:'Call'}`, then the normaliser emits `ctaActions=[{type:'phone',label:'Call',value:'+1555'}]` and `ctaUrl='tel:+1555'`.
  - Given a Cloud API contact and actions [url, copy], then (runtime) one native URL button is sent with the copy code in the message body.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`defaultData`, Inspector `case 'cta'`, `renderPreview`), `app/Services/Flows/FlowNormalizer.php` (`case 'cta'`), `node/services/flowService.js` (`executeCTANode`).
- **Port notes:** model actions with typed values (URL, E.164 phone, code) and validate them on publish; add header/body/footer fields (the runtime already supports them); keep the engine capability note in the UI; do not default to example.com.

### WD-FLB-049 — Location node

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-017
- **Summary:** Sends a map pin (name, address, latitude, longitude) as a native location message. Coordinates are typed in by hand.
- **Actors & access:** workspace admin. Palette group "Engage", label "Location", description "Send a map pin". Mode: chat (WhatsApp) only.
- **UX & screens:** inspector: stylised WhatsApp location bubble (title, address, a flat green map placeholder with a pin, and a small "lat, lng" caption when both are set); fields **Title** (`title`, text, placeholder "Our office"), **Address** (`address`, textarea 2 rows, placeholder "Street, city, country"), **Latitude** and **Longitude** (`lat`, `lng`, text, side by side, placeholders 12.9716 and 77.5946). Card: pin icon, title (fallback "Location"), address truncated ("-" when empty). Single output `out` "next".
- **Endpoints:** none.
- **Data:** `data` = `{lat:'', lng:'', address:'Office address', title:'Our office'}`; coordinates are strings.
- **Rules & edge cases:**
  1. Builder validation: none. No numeric format, range (-90..90, -180..180) or required check, and no map picker or geocoding.
  2. QUIRK: empty or non-numeric coordinates normalise to 0 (parse-float with default 0), so a Location left blank sends a pin at latitude 0, longitude 0 instead of failing. `{{variables}}` in lat/lng are not resolved (they become 0); title and address are also used verbatim (static read of the executor shows no merge-tag substitution).
  3. Default title "Our office" and address "Office address" are real defaults and are sent as is.
  4. Runtime fallback (FLR): if the native location send fails, a text message with title, address and a Google Maps link `maps.google.com/?q=<lat>,<lng>` is sent instead; then the flow advances.
- **Async & events:** FlowNormalizer: `location` -> `flowNodeType: Location` with `latitude` (float), `longitude` (float), `address`, `title`. Sending via Cloud API location message or Baileys location message is FLR.
- **External systems:** WhatsApp channel provider only.
- **Settings:** none.
- **Acceptance criteria:**
  - Given title "HQ", address "1 Main St", lat `12.9716`, lng `77.5946`, then the preview shows the pin, "HQ", the address and the caption `12.9716, 77.5946`, and the normaliser outputs floats 12.9716 and 77.5946.
  - Given empty lat/lng, then the normaliser emits 0 and 0 (reference behaviour that the port should instead reject on publish).
  - Given a new node, then the card shows "Our office" and "Office address" with one output "next".
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`defaultData`, Inspector `case 'location'`, `renderPreview`), `app/Services/Flows/FlowNormalizer.php` (`case 'location'`), `node/services/flowService.js` (`executeLocationNode`).
- **Port notes:** validate coordinates (numeric, range) and require them on publish; consider a map picker/geocoder behind an adapter; support variables in the coordinates if wanted, with explicit failure when unresolved.

### WD-FLB-050 — Poll node

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-017
- **Summary:** Sends a poll question with options and optional multi-select; each option is its own output port so the flow can branch on the chosen answer.
- **Actors & access:** workspace admin. Palette group "Engage", label "Poll", description "Send a poll". Mode: chat (WhatsApp) only.
- **UX & screens:** inspector: WhatsApp preview with the bold question and options as rows with round (single) or square (multi) markers; fields **Question** (`question`, textarea 2 rows), **Options** (numbered text inputs with remove X, "Add option" link, hint "Max 3 options. Each becomes its own output port."; at three the link is replaced by "Max 3 reached." (the shared handler also has a "Max 3 poll options" toast that the UI cannot reach); new options are named "Option N"), **Multiple choice** checkbox ("Allow multiple answers", `multi`). Card: bar-chart glyph plus the question; one labelled port row per option (placeholder port "Option" when the list is empty).
- **Endpoints:** none.
- **Data:** `data` = `{question:'Pick one', options:['Option A','Option B'], multi:false}`; handles `p0..pN`. Removing option i deletes its edges and shifts later handles down (same logic as Quick replies).
- **Rules & edge cases:**
  1. QUIRK: the builder allows 0 to 3 options (you can remove them all), but the runtime requires 2 to 12; with fewer than 2 it sends an error text "Poll must have 2-12 options" and stops (and the executor appears to read its settings variable before declaring it, so the error path may throw on the unofficial engine, FLR to confirm). The builder cap of 3 is lower than the runtime's 12.
  2. No validation of empty or duplicate option text; an empty option renders as a blank port label ("Option N" only when created by Add).
  3. Engine behaviour (FLR): Baileys sends a native poll (selectable count 1, or all options when multi); WhatsApp Cloud API and Twilio have no native poll, so single-choice degrades to an interactive list titled with button "Vote" (rows truncated to 24 characters, first 10 options) and multi-choice degrades to a numbered text prompt asking for comma-separated numbers. The answer variable is fixed to `poll_response` (no field in the builder).
  4. How a multi-select answer maps onto the per-option ports is a runtime decision (FLR); the builder always draws one port per option.
- **Async & events:** FlowNormalizer: `poll` -> `flowNodeType: Poll` with `question` (default "Pick one"), `options` (array, passed through), `allowMultiple` (bool). Edges `p<i>` -> port i+1.
- **External systems:** WhatsApp channel provider.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a new node, then it exposes ports `p0` "Option A" and `p1` "Option B", multi-select is off, and the preview shows round markers; with Multiple choice on the markers are square.
  - Given three options, then the Add control is replaced by "Max 3 reached.".
  - Given edges from `p0` and `p1`, when option 1 (index 0) is removed, then the `p0` edge is deleted and the `p1` edge now leaves `p0`.
  - Given a poll with one option reaches the runtime, then the customer receives the error text and the flow does not branch.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`defaultData`, `nodeRows`, `onAddOption`, `onRemoveOption`, Inspector `case 'poll'`, `renderPreview`), `app/Services/Flows/FlowNormalizer.php` (`case 'poll'`), `node/services/flowService.js` (`executePollNode`).
- **Port notes:** enforce 2 to 12 (or the lowest common channel limit) in the shared validator and publish-time check; define explicitly how multi-answers route (all ports, first selected, or an aggregate output); name the answer variable in the UI.

### WD-FLB-051 — Chatbot (AI agent hand-off) node

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-026
- **Summary:** Hands the conversation to one of the workspace's team-inbox AI agents. The agent is assigned to the conversation, writes the first reply immediately and answers every later inbound message through the normal inbound path. The inspector can also create a new agent without leaving the builder.
- **Actors & access:** workspace admin. Palette group "Engage", label "Chatbot", description "Trigger another chatbot". Mode: chat (WhatsApp) only. Agent features depend on the AI agent plan gates inside the agent service (AIAG/TIB).
- **UX & screens:** inspector: **AI agent to trigger** (`bot`, select "- pick AI agent -" or "No agents yet - click + to create one"; options "<name> . <provider>/<model>"; a saved id missing from the list shows "Agent #id (not in workspace)"), a dashed **Create new AI agent** button, and a hint that changes with whether agents exist. The button opens a modal: **Name** (required, error "Name is required."), **Model** (select of platform/BYOK models; error "Pick a model. If the list is empty, ask admin to enable one in /admin/api-keys." when none), **Tone** (Friendly, Professional default, Concise, Empathetic), **System prompt** (default "You are a helpful support assistant. Reply briefly."). Create posts the agent with auto-respond on and active, adds it to the cache and auto-selects it; failures show the server message (name error, or "HTTP <status>"). Card: chat glyph, agent name (or "Agent #id" / "pick agent..."), and its model on a second line. Single output `out` "next".
- **Endpoints:**

| Method uri                      | Route name                  | Controller@action                    | Middleware                           | Request                                                                                                  | Response                                                                                                            |
| ------------------------------- | --------------------------- | ------------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| POST api/flow-node/ai-agent-reply | api.flow-node.ai-agent-reply | FlowNodeActionsController@aiAgentReply | `X-Node-Token` checked in the action | `workspace_id` required int; `agent_id` required int; `customer_phone` required max 32                    | 200 `{ok:true, agent:<name>, assigned:true, replied:<bool>}`; 401; 404 `agent_not_found` (not in this workspace or inactive) or `conversation_not_found` |
| GET team-inbox/api/ai-agents    | (TIB)                       | (TIB domain)                         | (TIB)                                | none                                                                                                     | list of agents used to fill the select                                                                              |
| POST team-inbox/api/ai-agents   | (TIB)                       | (TIB domain)                         | (TIB)                                | `name`, `provider`, `model`, `tone`, `system_prompt`, `auto_respond:true`, `is_active:true`              | created agent (`agent` or `data`)                                                                                   |

- **Data:** `data` = `{bot:''}`; `bot` stores the AI agent id as a string. Legacy flows stored hard-coded slugs here.
- **Rules & edge cases:**
  1. Builder validation: none; an empty pick saves and, at runtime, the node is skipped (no agent and no sub-flow id -> move on).
  2. The agent list comes from the workspace; the select does not filter inactive agents, but the callback only accepts ACTIVE agents of the same workspace (an inactive or foreign id gives 404 and the runtime logs and still ends the session).
  3. QUIRK (runtime): after a successful or failed hand-off the Chatbot executor ENDS the flow session. The node's `out` ("next") port is never followed when an agent is set; anything wired after it is dead. Port it as a terminal node or explicitly resume the flow after hand-off.
  4. The callback sets `conversations.assignee_agent_id` to the agent and calls the agent service's reply method; plan gates, device scoping, human-handoff rules and Meta-agent coexistence live inside that service. Later inbound messages are answered by the agent without any flow round trip.
  5. If the node has no agent id but legacy `selectedFlowId`/`flowId` data (imports only), the executor acts as a sub-flow switch.
  6. Created-agent model choice is limited to the admin/BYOK model list (same endpoint as the AI node).
- **Async & events:** FlowNormalizer: `chatbot` -> `flowNodeType: Chatbot` with `agentId` and legacy `botId` both set to `data.bot` (string). Conversation assignment change and the agent's reply are written by the AI agent service (AIAG/TIB).
- **External systems:** LLM providers via the AI agent service.
- **Settings:** AI agent settings per agent (TIB/AIAG); node token shared secret.
- **Acceptance criteria:**
  - Given a workspace with agent "Support bot" (OpenAI/gpt-4o-mini), then the option reads "Support bot . openai/gpt-4o-mini" and picking it stores its id; the card shows the name and model.
  - Given no agents, then the select reads "No agents yet - click + to create one"; creating one with name "Bot" and a model auto-selects it and the card updates.
  - Given the create modal with an empty name, then it shows "Name is required." and sends nothing.
  - Given the callback with an inactive agent id, then 404 `agent_not_found` and no assignment change; with an active agent and an existing conversation, then the conversation's agent assignment is set and `replied` reflects whether the agent produced a reply.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`AGENTS_CACHE`, Inspector `case 'chatbot'`, `NewAgentModal`, `renderPreview`), `app/Http/Controllers/FlowNodeActionsController.php` (`aiAgentReply`), `app/Services/Flows/FlowNormalizer.php` (`case 'chatbot'`), `node/services/flowService.js` (`executeChatbotNode`).
- **Port notes:** model the node as "assign AI agent to conversation" calling the agent service in-process; decide terminal vs continuing semantics and reflect it in the ports; validate agent ownership and active state at save.

### WD-FLB-052 — Commerce nodes: WhatsApp Shop, WooCommerce, Shopify

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** XL (>2 weeks) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-026
- **Summary:** Three nodes with one shared form: pick a connected store (WhatsApp catalog, WooCommerce store, Shopify store), pick up to 30 products, set header/body/footer text and an abandoned-cart wait. The node shows the products to the customer and then branches on whether they buy (`purchased`) or the wait elapses (`abandoned`).
- **Actors & access:** workspace admin. Palette group "Commerce": "WhatsApp Shop" (desc "Open WhatsApp catalog"), "WooCommerce" ("Send WooCommerce product"), "Shopify" ("Send Shopify product"). Mode: chat (WhatsApp) only. Package flag `access_flows_commerce` exists in plans but is enforced nowhere (WD-FLB-028). Stores come from the CAT/ECOM/WooCommerce/Shopify integrations of the workspace.
- **UX & screens:** inspector (no WhatsApp preview): info box ("On a WABA conversation we send a native catalog message; on Baileys we send each product as a card + a checkout link", and a note that `purchased` fires when the order webhook lands and `abandoned` after the wait window with no purchase). Fields: **Store** (`storeId`, select loaded lazily per provider the first time any node of that provider is inspected and cached for the page: "Loading stores..." then "- pick store -"; empty states "No catalog linked - go to /catalog" for WhatsApp Shop, "No store connected - go to /woocommerce" or "/shopify"; options "<name> . <currency>"; unknown id "Store #id (not in workspace)"; help links to /catalog, /integrations, /shopify); **Products** (a list of picked products with thumbnail or "IMG" tile, name, "<currency> <price> . <retailer_id>" and remove X; empty "No products yet. Click below to add some."; button "Pick products" / "Pick more products", disabled until a store is chosen; hint "Max 30 products per node. Tap x to remove."); **Header (optional)** (`headerText`); **Body** (`bodyText`, textarea 3 rows, default "Tap a product to see details:"); **Footer (optional)** (`footerText`); **Abandoned-cart wait** (`abandonedWaitMinutes`, select 5 minutes default, 15 minutes, 1 hour, 4 hours, 1 day; hint says the `abandoned` port fires so the flow can route to a follow-up). **Product picker modal** (title "Shopify products" / "WooCommerce products" / "WhatsApp catalog products"): live fetch of up to 50 products; search box ("Search by name or SKU...") filters those 50 client-side; 2-3 column grid with image, name, price, badges "out of stock" / "on node" / "picked"; out-of-stock and already-added items are disabled; footer "N selected" with "Add N to node" (disabled at 0); loading, error ("Couldn't load products: ...") and empty ("No products found. Connect or sync the store first." / "Try a different search.") states. Card: up to three thumbnails (or IMG tiles), "+N" for more, "N product(s)"; empty "No products picked - open inspector". Ports: `purchased` ("purchased", green) and `abandoned` ("abandoned", red).
- **Endpoints:**

| Method uri                                       | Route name                         | Controller@action                       | Middleware                                 | Request                                                                                                                                    | Response                                                                                                                                                                                                                         |
| ------------------------------------------------ | ---------------------------------- | --------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET flows/api/commerce/stores                    | user.flows.api.commerce.stores     | FlowsCommerceController@stores          | Authenticate, workspace.role:admin         | `provider` = shopify / woocommerce / whatsapp_shop                                                                                          | `{ok, provider, stores:[{id,name,url?,currency,country?,status:'active'}]}` (Shopify/Woo: active integrations newest first; WhatsApp: all catalogs with `catalog_id`, `is_cart_enabled`, currency null); 400 `no_workspace` |
| GET flows/api/commerce/stores/{storeId}/products | user.flows.api.commerce.products   | FlowsCommerceController@products        | same                                       | `provider`, `q` (name filter), `limit` 1-50 (default 20), cached 60 s per provider+store+workspace+q+limit                                   | `{ok, provider, products:[{id, retailer_id, name, sku, image, price_minor, currency, url, in_stock}]}`; 502 `fetch_failed`                                                                                                       |
| POST api/commerce/checkout-link                  | api.commerce.checkout-link         | FlowsCommerceController@checkoutLink    | `X-Node-Token` checked in the action       | `provider` required in the three values; `store_id`, `workspace_id` ints; `items` 1-30 `{retailer_id, qty 1-99}`; `session_id` max 120; `customer_phone` max 32 | `{ok:true, url, ...}`; 401; 403 `store_workspace_mismatch`; 502 `mint_failed` (the store must belong to the workspace)                                                                                                            |
| POST api/commerce/waba-send-products             | api.commerce.waba-send             | FlowsCommerceController@wabaSendProducts | same                                       | `session_id`, `target_phone`, `workspace_id`; `items` 1-30 `{retailer_id}`; `header` max 60; `body` max 1024; `footer` max 60                | `{ok:true, meta}`; 401; 422 `no_waba_config` / `no_catalog` / `waba_creds_missing`; 502 `meta_send_failed` / `send_exception`; sends one product message for a single item, a product list for several, with the session id as opaque callback data |
| POST api/commerce/check-inventory                | api.commerce.inventory             | FlowsCommerceController@checkInventory  | same                                       | `provider`, `store_id`, `workspace_id`, `retailer_ids` 1-50                                                                                 | `{ok:true, in_stock:[retailer ids]}`; fails open (returns all ids with `fallback:true`) on provider errors                                                                                                                         |

- **Data:** `data` = `{storeId:'', productItems:[], headerText:'', bodyText:'Tap a product to see details:', footerText:'', abandonedWaitMinutes:5}`. `productItems[]` holds the picked product snapshot from the picker (retailer_id, name, image, price_minor, currency, url, plus id/sku/in_stock); price and image are a design-time snapshot and go stale. Handles `purchased` and `abandoned`.
- **Rules & edge cases:**
  1. Limits: 30 products per node (the picker concatenation is sliced to 30 and the normaliser slices again), 50 products fetched per picker open, wait choices fixed to the five values. Header and footer limits (60 characters each) and body (1024) are enforced only by the WhatsApp send endpoint, not in the builder.
  2. Builder validation: none (no store, zero products or blank body all save).
  3. QUIRK / DEFECT: the card renders a SINGLE output dot (`out`) for these nodes because the multi-port list omits them (WD-FLB-017); the normaliser maps `out` to port 1 = `purchased`, so through the UI only the purchased branch can be wired; the `abandoned` branch exists only for imported, AI-generated, template or seeded graphs. Do not port: render both ports.
  4. QUIRK: changing the Store does NOT clear `productItems`, so products from the previous store stay on the node (the checkout then fails the store/workspace match or sends foreign products).
  5. QUIRK: the WhatsApp Shop product list ignores the chosen catalog id and returns ALL non-deleted products of the workspace; the native send uses the workspace's FIRST catalog regardless of which store was picked. Shopify products expose only the first variant (price, SKU, stock). Retailer id is SKU, else the platform id (WhatsApp: Meta retailer id, else SKU, else row id). Out-of-stock products cannot be picked.
  6. Legacy graphs: `productIds[]` (WhatsApp Shop) and a single `product` (WooCommerce/Shopify) are migrated by the normaliser into `productItems[]` so they do not fall straight to `abandoned`.
  7. Runtime (FLR): checks live inventory just before sending and drops out-of-stock items (all out of stock -> `abandoned` immediately); WABA with a linked catalog sends a native single-product or product-list message, other engines send product cards plus a minted checkout link; `purchased` fires when the store's order webhook reports an order for the session; `abandoned` fires from an in-process timer after the chosen wait; unrelated text replies during the wait are ignored.
  8. The node does not take payment itself; checkout links are minted by the Shopify/WooCommerce/WhatsApp-shop link builders (ECOM/CHK domains).
- **Async & events:** FlowNormalizer: `whatsapp_shop`, `woocommerce` and `shopify` all map to `flowNodeType: CommerceShop` with `provider` (the original type), `storeId`, `headerText`, `bodyText` (default "Tap a product to see details:"), `footerText`, `abandonedWaitMinutes` (int, default 5) and `productItems[]` (6 fields each, blank retailer ids dropped, max 30). Ports: `purchased` -> 1, `abandoned` -> 2. Order webhooks that resume the session are ECOM/CHK (WD-FLB-052 only records the contract).
- **External systems:** Shopify Admin API, WooCommerce REST API, Meta Cloud API catalog messages (`graph.facebook.com`, version from `META_GRAPH_VERSION`, default v21.0, 15 s timeout, access token from the encrypted provider credentials).
- **Settings:** store connections (`shopify_integrations`, `woocommerce_integrations`, `wa_catalogs`); node token shared secret; `META_GRAPH_VERSION`.
- **Acceptance criteria:**
  - Given a workspace with one active Shopify store, when a Shopify node is inspected, then the store list shows "<store name> . <currency>", the Pick products button is disabled until it is selected, and the picker lists products with out-of-stock ones disabled.
  - Given the admin picks 3 products and confirms, then `productItems` has 3 snapshots, the card shows three thumbnails and "3 product(s)", and picking 40 more keeps the list at 30.
  - Given a product already on the node, then it is disabled in the picker with the "on node" badge.
  - Given the normaliser runs on a node with legacy `productIds:['A1','B2']`, then `productItems` has two entries with those retailer ids; an edge with handle `abandoned` becomes source `<id>_2`.
  - Given the checkout-link callback with a store id from another workspace, then 403 `store_workspace_mismatch`.
  - Given a store with no connection, then the dropdown reads "No store connected - go to /shopify".
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`defaultData`, `COMMERCE_STORES`, Inspector `case 'whatsapp_shop'/'woocommerce'/'shopify'`, `ProductPickerModal`, `renderPreview`, `nodeRows`, `isMultiPort`), `app/Http/Controllers/FlowsCommerceController.php`, `app/Services/Flows/FlowNormalizer.php` (`case 'whatsapp_shop'`, `PORT_MAP`), `node/services/flowService.js` (`executeCommerceShopNode`).
- **Port notes:** build a provider-agnostic `CommerceCatalogPort` (list stores, search products, price/stock, mint checkout link) with Shopify, WooCommerce and WhatsApp-catalog adapters; store product references (provider product id + variant id) and re-fetch price/image at send time; clear products on store change; render both ports; abandoned-cart wait as a durable delayed job cancelled by the order event; enforce the `access_flows_commerce` entitlement properly.

### WD-FLB-053 — Book appointment node

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-026
- **Summary:** A chat node that offers the customer bookable times inside WhatsApp and books the slot they pick, optionally pinned to one service. The builder side is a four-field inspector, a service picker and two output ports; the booking engine itself belongs to the appointments domain.
- **Actors & access:** workspace admin (builder). Palette: chat (WhatsApp) mode only (the node declares no `modes`, so it defaults to chat). Runtime needs a workspace with Booking Types (multi-service path) or the legacy single appointment config.
- **UX & screens:** inspector in `resources/views/user/flows/builder.blade.php` + `user-flows-builder.js` (`book_appointment` case). Grey info box ("Books an appointment inside the chat..."). Fields: (1) **Service** select `bookingTypeId`: first option "— all my services (customer picks) —" (shows "Loading services…" until the list arrives); then one option per service labelled `<name>` + " (inactive)" when inactive + " · <n> min"; a saved id that is not in the list is appended as "Service #<id> (not loaded)". The list comes from `GET /appointments/booking-types/list` (`{types:[{id,name,duration,active}]}`, ordered by sort_order then name) and is cached on the page for the session. (2) **Slots to offer** number `slotCount`, default 5, no min/max in the form. (3) **Prompt (sent before the list)** text `prompt`, default "Pick a time that works for you:". (4) **Confirmation message** text `confirmation`, default "Booked! See you on {{slot}}.". Card preview: "offer N slot(s)" plus the first 40 characters of the prompt.
- **Endpoints:** builder-side only `GET appointments/booking-types/list` (owned by the appointments domain). Runtime callbacks (token `X-Node-Token`): `GET api/booking/types`, `GET api/booking/slots`, `POST api/booking/reserve`, `POST api/booking/book` (multi-service path) and `GET api/appointments/slots`, `POST api/appointments/book` (legacy path). All are owned by the appointments domain / node bridge; FLB does not define them.
- **Data:** node `data`: `{bookingTypeId:'', slotCount:5, prompt, confirmation, collectEmail:false, calendarOverride:''}`. Output handles `booked` (green, label "booked") and `no_slots` (red, label "no slots"). Variables written at runtime: `{{slot}}` (the chosen slot label, available to later nodes).
- **Rules & edge cases:**
  1. Builder-side validation: none (no required field, no range check). An unset service means "customer picks".
  2. QUIRK / DEFECT carried from WD-FLB-017: the card draws a single output dot for this node, so through the UI only `booked` can be wired; `no_slots` exists only on imported / AI-generated / seeded graphs. Render both ports when porting.
  3. QUIRK: `collectEmail` and `calendarOverride` are defaulted and passed through the normalizer but no inspector control sets them and no runtime code reads them. Treat as dead fields (do not port as features; keep tolerated on import).
  4. Runtime, multi-service path (taken when the workspace has any Booking Type, or booking is flagged unavailable): pinned `bookingTypeId` narrows the list to that one active service; an unknown or inactive pinned id falls back to all services. One service goes straight to the day list; several services first ask "What would you like to book?" (the node `prompt`). Then day list, time list (paged with "More ▸" / "◂ Back" rows so a channel list stays within its cap), optional questionnaire questions (free text; optional ones skippable with "skip"), then either a pay link (when a deposit is due and a gateway exists; the flow then waits for the web payment callback) or an immediate confirm. When the booking feature is unavailable the customer is told online booking is unavailable and the flow takes `no_slots`.
  5. Runtime, legacy path (no Booking Types): fetch up to `slotCount` slots (clamped 1..10), no slots or a failed fetch takes `no_slots`. Slots are sent as a native list on WABA / Twilio (row title 24 chars, description 72) or as quick-reply buttons on the unofficial engine (label 20 chars, max 10). The reply is matched by row id `appt_<nodeId>_<i>`, then by label prefix, then by a typed 1-based number; anything else takes `no_slots`. A successful `book` call sends the confirmation text (with `{{slot}}` replaced) over the flow's engine and takes `booked`; a failed `book` call takes `no_slots`.
  6. QUIRK: the paid-booking branch posts to `/api/booking/pay-link`, which has no route in this tree, so a booking that needs a deposit always ends with "Sorry, we couldn't set up payment right now" and the `no_slots` port. Verify live before treating deposits as supported from chat.
  7. Booking failures are indistinguishable from "no slots" for the flow author (both go to `no_slots`).
- **Async & events:** the node parks the run waiting for the customer's pick (WD-FLR session wait). Booking side effects (appointment row, Google Calendar event, notifications) are in the appointments domain.
- **External systems:** Google Calendar through the appointments domain; the engine's list/button send.
- **Settings:** workspace appointment settings and Booking Types; Google Calendar integration master toggle (admin).
- **Acceptance criteria:**
  - Given a node pinned to the "Consultation" service, when the flow reaches it, then the customer receives the day list for that service without a "which service?" menu.
  - Given a workspace with no available slots, when the node runs, then the run continues through the `no_slots` handle and the customer is not left waiting.
  - Given a customer replies "2" to a slot list, then the second offered slot is booked and the confirmation text shows its label in place of `{{slot}}`.
  - Given a saved `bookingTypeId` that no longer exists, then the inspector shows "Service #<id> (not loaded)" and the runtime offers all services.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`defaultData`, `nodeRows`, inspector `book_appointment`), `app/Services/Flows/FlowNormalizer.php` (`book_appointment`, PORT_MAP), `node/services/flowService.js` (`executeBookAppointmentNode`, `startBookingFlow`, `handleBookAppointmentResponse`, `handleBookingStage`), `app/Http/Controllers/BookingTypeController.php` (`apiList`).
- **Port notes:** Owned at run time by FLR (node executor) with the booking engine from the appointments domain; FLB keeps the node schema, the picker (`GET /v2/booking-types` slim list), the two ports and the normalizer mapping (`BookAppointment`, `slotCount`, `prompt`, `confirmation`, `bookingTypeId` 0 = all, booked = port 1, no_slots = port 2). Drop `collectEmail` / `calendarOverride`. Validate on save that `slotCount` is 1..10 and that the pinned service belongs to the workspace.

### WD-FLB-054 — AI voice call node

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-026
- **Summary:** Places a WhatsApp voice call to the flow's contact, answered by one of the workspace's AI voice assistants. Typical use: a keyword like "call me" triggers a flow whose only action is this node.
- **Actors & access:** workspace admin (builder). Chat mode only. Needs a connected WhatsApp Cloud API (WABA) sender with calling enabled; the customer must have granted call permission (enforced by Meta, not checked here).
- **UX & screens:** inspector case `ai_call`: info box ("Places a WhatsApp voice call ... Requires WABA calling enabled + the customer's call permission", link to AI voice assistants). One field: **Voice assistant** select `assistantId`, first option "— workspace default assistant —" (value empty); then one option per assistant from `GET flows/api/call-assistants` (`{id,name}`); an unknown saved id is appended as "Assistant #<id>". Card shows a single output "call placed".
- **Endpoints:** (token `X-Node-Token`, middleware `api`)

| Method uri | Route name | Controller@action | Request | Response |
| --- | --- | --- | --- | --- |
| POST api/flow-node/place-ai-call | api.flow-node.place-ai-call | FlowNodeActionsController@placeAiCall | `workspace_id` int req; `to` string req max 32 (digits kept, at least 8); `assistant_id` int null; `conversation_id` int null; `device_phone` max 32 null | `{ok:true, call_id}`; 401 unauthorized; 422 `bad_number`, `no_waba_sender`, `no_voice_assistant` |
| POST api/waba-call/bridge-offer | api.waba-call.bridge-offer | FlowNodeActionsController@wabaCallBridgeOffer | `wa_call_id` int req; `sdp_offer` string req; `to` null; `assistant_id` null | `{ok:true, meta_call_id}`; 404 `call_not_found`; 422 `no_waba_sender`; 502 `dial_failed` / `no_meta_call_id` |

- **Data:** node `data.assistantId` ('' = default); normalizer emits `assistantId` int (0 = default). Writes a `wa_calls` row: provider `waba`, direction BUSINESS_INITIATED, status `ringing`, from = the WABA number, to = digits, `meta_payload` `{assistant_id, source:'flow_ai_call'}`. On a failed dial the row becomes `failed` with end reason FAILED.
- **Rules & edge cases:**
  1. Node-side guards: no workspace id or fewer than 8 digits in the target number logs a warning and skips the call; the flow still advances.
  2. Assistant resolution: the node's choice, else the workspace's first assistant (lowest id) that is `is_active` and `status='live'`; none gives 422 `no_voice_assistant`.
  3. Sender resolution: the workspace's primary WABA config must be connected, otherwise 422 `no_waba_sender`. Calls never use the unofficial engine, even when the flow itself runs on it.
  4. Hand-off: Laravel creates the `wa_calls` row, then POSTs the Node bridge `/api/waba-call/place-outbound` (15 s, fire-and-forget, node token in header and body) with the access token, phone number id and Graph version (setting `waba_graph_api_version`, default v23.0). The bridge builds the WebRTC offer and calls `bridge-offer`, which dials through Meta and then tells the bridge the Meta call id (`/api/waba-call/link-meta`).
  5. QUIRK: the node always advances through its single `out` port ("call placed") whether or not the call was placed; failures only reach the server log. Do not rely on the port to mean success.
  6. QUIRK: `place-ai-call` has no idempotency key; the same contact re-entering the node places a second call.
- **Async & events:** a `wa_calls` row plus `wa_call_events` rows written by the bridge (bridge-accepted, transcript turns) in the calling domain.
- **External systems:** Meta WhatsApp Calling API through the Node bridge (WebRTC offer/answer), voice keys (Deepgram / OpenAI / ElevenLabs) resolved per workspace (see WD-FLB-069).
- **Settings:** `waba_graph_api_version` (system), WABA calling enablement, assistant `is_active` / `status`.
- **Acceptance criteria:**
  - Given a flow with this node and no assistant chosen, when it runs for a contact on a connected WABA workspace that has one live assistant, then a `wa_calls` row is created with that assistant and the run continues on `out`.
  - Given the workspace has no connected WABA sender, when the node runs, then the server answers 422 `no_waba_sender`, no call row is created and the flow still advances.
  - Given a contact number of seven digits, then the node skips the call and advances.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`ai_call`), `app/Services/Flows/FlowNormalizer.php`, `app/Http/Controllers/FlowNodeActionsController.php` (`placeAiCall`, `wabaCallBridgeOffer`), `node/services/flowService.js` (`executeAiCallNode`), `node/services/wabaCallBridge.js`.
- **Port notes:** Executor runs in FLR behind its AI-call port (`AiCallPort`, already built; the calling domain binds the real adapter). FLB keeps the picker (`call-assistants`), the schema and the normalizer mapping (`AiCall`). Add an idempotency key per (run, node) and surface the failure as a run-log note rather than silently advancing.

### WD-FLB-055 — Google Meet node and Meet endpoints

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-017
- **Summary:** Creates a Google Calendar event with a Meet link when the node fires and sends the link to the customer. The same calendar-and-Meet helper also backs the team inbox composer's "Meet" button.
- **Actors & access:** workspace admin (builder); the team-inbox button is any agent who may reply. Chat mode only. Requires the workspace's Google account connected under Appointments settings and the platform Google master toggle on.
- **UX & screens:** inspector case `google_meet`: info box with a link to `/appointments/settings`. Fields: **Meeting title** text `title` (default "WhatsApp consultation with {{name}}"); **Duration (minutes)** number `durationMinutes` (default 30, runtime floor 5); **Lead time (minutes)** number `leadMinutes` (default 5, runtime floor 0; "schedule the meeting N minutes from now"); **Message template** textarea 4 rows `messageTemplate` (default "Your meeting link:\n{{meet_link}}\n\nStarts {{meet_start}}"); **Send Google invite to attendees** checkbox `sendCalendarInvite` (default off; label flips between "On — Google emails the attendees" and "Off — link only via WhatsApp"). Card preview: "<d> min · lead <l> min" and the title. Output: one port "link sent".
- **Endpoints:**

| Method uri | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| POST api/flow-node/google-meet | api.flow-node.google-meet | FlowNodeActionsController@googleMeet | api (X-Node-Token) | `workspace_id` int req; `title` string req max 200; `start_at`, `end_at` string req (ISO 8601); `description` max 1500; `attendee_emails[]` email; `time_zone` max 60; `send_invites` bool; `calendar_id` max 200 | `{ok:true, meet_url, event_id, start, end, time_zone}` |
| POST team-inbox/api/google-meet | user.team-inbox.api.google-meet | FlowNodeActionsController@googleMeetForInbox | web, Authenticate | same minus `workspace_id` (taken from the session) | same |

  Errors (both): 404 `workspace_not_found`; 422 `bad_datetime`, `end_before_start`, `not_connected` (connect Google Calendar first); 503 `integration_disabled` (platform toggle off); 502 `meet_create_failed` (Google returned no Meet link); 401 `no_workspace` (inbox route without a workspace).
- **Data:** node `data` `{title, durationMinutes, leadMinutes, sendCalendarInvite, messageTemplate}`; normalizer: title default "WhatsApp consultation", ints default 30 / 5, bool, template default "Your meeting link: {{meet_link}}\nStarts at {{meet_start}}". Variables written: `meet_link`, `meet_start` (formatted `YYYY-MM-DD HH:mm UTC`), `meet_event_id`. Calendar id comes from the workspace's `appointment_settings.google_oauth.calendar_id` (else `primary`); time zone from the request, else the calendar timezone, else the workspace timezone, else UTC.
- **Rules & edge cases:**
  1. The meeting starts `now + leadMinutes` and lasts `durationMinutes`; it is an instant meeting link, not a scheduled appointment.
  2. QUIRK: the node sends `send_invites` but never sends any attendee e-mail or calendar id, so "Send Google invite to attendees" has no effect and the toggle's hint ("only useful when the contact has an email") describes behaviour that is not built. The node always sends `time_zone` UTC.
  3. On any failure (not connected, integration off, Google error) the customer receives the apology "Sorry, couldn't generate a meeting link right now. Please try again later." and the flow still continues through `out`.
  4. Title supports `{{vars}}` (substituted before the Google call). The message is sent over the flow's engine (WABA / Twilio via the shared senders, unofficial via the socket) and mirrored into the history.
  5. Master toggle `google_calendar_enabled` turns every Google surface off immediately (503), without waiting for token expiry.
- **Async & events:** none beyond the HTTP calls; a Calendar event is created in the workspace's Google account.
- **External systems:** Google Calendar API (`events.insert` with `conferenceData.createRequest`), OAuth tokens in `workspaces.appointment_settings` (encrypted), refreshed by `GoogleCalendarService::ensureFreshToken`.
- **Settings:** admin `google_calendar_enabled` (platform-wide), workspace Google connection and calendar choice under `/appointments/settings`.
- **Acceptance criteria:**
  - Given Google is connected, when the node fires with lead 5 and duration 30, then an event is created that starts five minutes from now, ends 30 minutes later, and the customer receives the template with the real link in place of `{{meet_link}}`.
  - Given Google is not connected, when the node fires, then the customer gets the apology message and the run continues on `out`.
  - Given the admin has turned the Google master toggle off, when either Meet endpoint is called, then it answers 503 `integration_disabled`.
  - Given `end_at` earlier than `start_at`, then the endpoint answers 422 `end_before_start`.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`google_meet`), `app/Services/Flows/FlowNormalizer.php`, `app/Http/Controllers/FlowNodeActionsController.php` (`googleMeet`, `googleMeetForInbox`, `mintMeet`), `app/Services/GoogleCalendar/GoogleCalendarService.php` (`createMeetEvent`), `node/services/flowService.js` (`executeGoogleMeetNode`).
- **Port notes:** a `GoogleWorkspacePort` and HTTP adapter already exist in FLR but no Google account store does (Google nodes currently report no account and move on). Home the Meet minting in the integrations domain behind that port; FLB keeps the schema and normalizer mapping (`GoogleMeet`). Fix the attendee gap or remove the toggle; do not ship a switch that does nothing.

### WD-FLB-056 — WhatsApp Form node and send endpoint

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-026
- **Summary:** Sends a published Meta WhatsApp Flow ("WhatsApp Form") to the customer as an interactive message with a button, pauses the run, and continues once the customer submits. Each submitted field becomes a flow variable named after its field id.
- **Actors & access:** workspace admin (builder). Chat mode; requires a WABA (Cloud API) config with an access token and phone number id. The form must be built and published under WhatsApp Forms.
- **UX & screens:** inspector case `wa_form`: info box (links to `/wa-forms`). Fields: **Form** select `formId` (options "— pick form —", then every workspace form newest first labelled by title plus " (draft)" when unpublished; unknown id shown as "Form #<id> (not loaded)"), source `GET /wa-forms/api/list` (`{forms:[{id,title,status,is_published}]}`, cached per page); **Body bubble text** text `bodyText` (default "Please tap below to fill out our quick form."); **CTA label** text `ctaLabel` (default "Open form"); **Save submission under variable** text `flowVariable` (default `form_submission`; a marker for the audit log only, since fields land as `{{field_id}}` regardless). Output port "submitted". Card preview "form #<id>" plus the body text. The simulator logs the body text and takes `out` ("published Meta form sent").
- **Endpoints:**

| Method uri | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| POST api/flow-node/wa-form-send | api.flow-node.wa-form-send | FlowNodeActionsController@waFormSend | api (X-Node-Token) | `workspace_id` int req; `form_id` int req; `session_key` string req max 120; `target_phone` string req max 32; `body_text` max 1024; `cta_label` max 30 | `{ok:true, flow_token, meta}`; 404 `form_not_found`; 422 `form_not_published`, `no_waba_config`, `waba_creds_missing`; 502 `meta_send_failed`, `send_exception` |

- **Data:** node `data` `{formId, bodyText, ctaLabel, flowVariable}`. Normalizer emits `formId` (string), `bodyText` (default "Please tap below to fill out our form."), `ctaLabel`, `flowVariable` (cleaned: surrounding `{{ }}`, `@` and spaces stripped, default `form_submission`) and looks the form up: when it is live (`status='published'` with a `meta_flow_id`) it adds `metaFlowId` and `formTitle`, otherwise `metaFlowId` null. The flow token has the shape `form-<form_id>-<session_key>`, parsed back on submission to find the form and the parked run.
- **Rules & edge cases:**
  1. QUIRK: the dropdown help text says "Only published forms appear here" but the list returns every form of the workspace; drafts are shown with a "(draft)" suffix. A draft chosen here normalises to `metaFlowId` null and the node is silently skipped at run time.
  2. Runtime: a missing form id, unpublished form, missing workspace, missing WABA credentials or a Meta send failure all log a warning and advance through `out` (the same port as a real submission). The flow author cannot tell a failed send from a completed form.
  3. QUIRK: the Node runner does NOT use `api/flow-node/wa-form-send`. It fetches `GET api/waba-creds` and posts the interactive message to Meta itself (mode published, action navigate, Graph message version 3); the Laravel endpoint (which also adds `flow_action_payload.screen = SCREEN_0` and picks the config with `->first()`) has no caller in this tree. Two implementations diverge: only the Laravel one sets the first screen.
  4. After a successful send the run parks (`waitingForInput` kind WaForm, with flow token and start time) and the sent form button is mirrored into the inbox as an outbound message with the CTA label.
  5. Resume path: the WhatsApp Forms domain's submission handler receives Meta's form response, looks up the token and resumes the run through `out` with the field values as variables.
  6. There is no timeout port; a form never submitted leaves the run parked until session expiry.
- **Async & events:** Meta messages API call; parked session; submission webhook (WFL domain).
- **External systems:** Meta Graph API `POST /{phone_number_id}/messages` with interactive `flow` payload; Graph version from env `META_GRAPH_VERSION` (default v21.0) on the Laravel path.
- **Settings:** `META_GRAPH_VERSION`; WABA credentials in the workspace's provider config.
- **Acceptance criteria:**
  - Given a published form and a connected WABA number, when the node runs, then the customer receives a message with the body text and a button labelled with the CTA, and the run waits.
  - Given the customer submits the form, then the run continues through `out` and each field value is available as `{{field_id}}`.
  - Given the chosen form is a draft, then the node is skipped at run time and the run continues on `out`.
  - Given a send to Meta fails, then the run still advances through `out` and a warning is logged.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`wa_form`), `app/Services/Flows/FlowNormalizer.php` (`wa_form`), `app/Http/Controllers/FlowNodeActionsController.php` (`waFormSend`, `wabaCreds`), `app/Http/Controllers/WaFormController.php` (`apiList`), `app/Models/WaForm.php` (`isLive`), `node/services/flowService.js` (`executeWaFormNode`).
- **Port notes:** the picker (`GET /v2/wa-forms?summary`) is a WFL contract; FLB stores `formId` and resolves liveness at save/launch time. Executor in FLR; one sender implementation only (use the `flow_action_payload.screen` variant). Route a send failure to a visible log entry and (better) to a distinct error port.

### WD-FLB-057 — Google Sheets node

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-026
- **Summary:** Appends one row to a Google Sheet (write mode) or looks a row up by a key column and loads its cells into flow variables (read mode). Uses the workspace's connected Google account.
- **Actors & access:** workspace admin (builder; the picker route needs role admin). Chat mode only. Requires the workspace's Google account with the Sheets scope, and the platform Google master toggle on.
- **UX & screens:** inspector case `google_sheets`: info box (link to `/google-account`; a red "Sheets scope missing — reconnect Google to enable." line when the picker reports `integration.connected === false` or `missing` contains `sheets`). Fields: **Mode** select (`write` "Write — append a row" default / `read` "Read — look up a row"); **Spreadsheet** select `sheetId` (first option "— pick a sheet —", "Loading sheets…" while loading, or "No spreadsheets found — paste a URL/ID below" once loaded empty; a saved id not in the list shows as "Sheet <first 12 chars>… (not loaded)"); **…or paste a Spreadsheet URL / ID** (on change, a `/d/<id>/` segment of at least 20 id characters is extracted, otherwise the raw text is kept); **Tab name** `tabName` (blank = first tab; placeholder Sheet1). Write mode: **Columns** list of header + value pairs (add/remove, no limit; default `Name={{name}}`, `Phone={{phone}}`; label becomes "Columns (matched by header name)" when the checkbox is on) and the checkbox **Match columns by header name** `matchByHeader` (default off). Read mode: **Lookup column (header)** `matchColumn`, **Lookup value** `matchValue` (placeholder `{{phone}}`), **Save row under variable** `saveAs` (default `sheet_row`; cells become `{{saveAs.<Header>}}`). One output "row written" (write) or "row loaded" (read). Card preview shows `WRITE|READ`, the first 10 characters of the id and "append N col(s)" or "lookup col = value".
- **Endpoints:**

| Method uri | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| GET api/google/picker/{kind} | user.api.google.picker | GoogleFlowNodeController@picker | web, Authenticate, EnsureWorkspaceRole:admin | `kind` in sheets, docs, forms | `{ok, integration:{connected, missing[]}, files:[{id,name,modified_time,web_view_link}]}`; 401 `no_workspace`; 422 `unknown_kind`; 503 `integration_disabled` |
| POST api/flow-node/google/sheet-write | api.flow-node.gsheet-write | GoogleFlowNodeController@sheetWrite | api (X-Node-Token) | `workspace_id` int req; `sheet_id` req max 128; `tab_name` max 64; `values[]` req (each nullable); `column_headers[]` max 128; `match_by_header` bool | `{ok, updated_range}` or 422 `{ok:false, error}`; 503; 404 `workspace_not_found` |
| POST api/flow-node/google/sheet-read | api.flow-node.gsheet-read | GoogleFlowNodeController@sheetRead | api (X-Node-Token) | `workspace_id`; `sheet_id`; `tab_name` max 64; `match_column` max 64; `match_value` max 255; `limit` 1..200 (node sends 1) | `{ok, rows:[{<header>:<cell>}]}` or 422 |

- **Data:** node `data` `{mode, sheetId, tabName, columns:[{header,value}], matchByHeader, matchColumn, matchValue, saveAs}`. Normalizer copies them (`saveAs` cleaned of `{{ }}`, `@` and spaces, default `sheet_row`; `matchByHeader` cast to bool). Picker lists up to 100 Drive files of the right MIME type, `trashed=false`, ordered by modified time descending.
- **Rules & edge cases:**
  1. No workspace id or no `sheetId` logs a warning and the node advances; write mode with an empty column list does the same.
  2. Write, default (positional): one `values.append` call with the values in column order, `USER_ENTERED` (so a value that starts with `=` is interpreted as a formula by Sheets) and `INSERT_ROWS`; the target range is `<tab>!A:Z`, or `A:Z` when no tab is named. The header label is informational only in this mode.
  3. Write, header-matched: read row 1, place each value under the sheet column whose header matches the label (case-insensitive, trimmed); labels the sheet does not have are appended after the last sheet column; an empty sheet (no header row) falls back to positional.
  4. Multi-row: if a column value references `{{prefix.field}}` and the run holds a list `prefix.__rows` (an AI node in extract mode produces it from one message holding several records) the node appends one row per record.
  5. Values: `{{vars}}` resolve from the run; objects are flattened to a human field (title, name, label, value, text, email, id) else JSON; arrays are joined with commas; unknown variables become empty. System tags `{{timestamp}}`, `{{execution_timestamp}}`, `{{now}}` (YYYY-MM-DD HH:mm:ss), `{{date}}`, `{{time}}`, `{{iso_timestamp}}` resolve only when the run has no variable of that name (server local time).
  6. Read: whole range `A:Z` is fetched and the first row whose cell under the lookup column equals the value exactly (case-sensitive string compare) is returned; only the first 26 columns are visible. On a match the row is stored as an object under `saveAs` AND as `saveAs.<Header>` strings; on no match nothing is stored.
  7. QUIRK: both modes always advance through the single `out` port. A failed write, a missing sheet, an expired Google token or a read with no match are logged and invisible to the flow (no error or not-found branch). Test it with a Condition node on the saved variable.
  8. The simulator skips the Google call ("skipped in test").
- **Async & events:** none (synchronous HTTP, 15 s node-side timeout).
- **External systems:** Google Sheets API v4 (`values.append`, `values.get`), Drive API for the picker; per-workspace OAuth tokens in `workspaces.appointment_settings.google_oauth` (encrypted), refreshed on use.
- **Settings:** admin `google_calendar_enabled` master toggle (guards Sheets, Docs, Forms and Meet); workspace Google connection under `/google-account`.
- **Acceptance criteria:**
  - Given write mode with columns `Name={{name}}` and `Phone={{phone}}`, when the node runs, then one row is appended whose cells are the contact's name and number, and the run continues.
  - Given header-matched write and a sheet whose columns are `Phone, Name`, then each value lands under the column with the same header regardless of node order.
  - Given read mode with lookup `Phone = {{phone}}` and a matching row, then `{{sheet_row.Name}}` holds that row's Name cell; given no matching row, then the variable is unset and the run still continues.
  - Given the master toggle is off, then the node endpoints answer 503 and the run continues without writing.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`google_sheets`), `app/Services/Flows/FlowNormalizer.php`, `app/Http/Controllers/GoogleFlowNodeController.php` (`sheetWrite`, `sheetRead`, `picker`, `headerMatchedRow`), `app/Services/Google/GoogleApiService.php` (`appendSheetRow`, `readSheetRows`, `readSheetHeaders`, `listSheets`), `node/services/flowService.js` (`executeGoogleSheetsNode`, `buildSheetRowValues`), `node/test/flow-sheets-write.mjs`.
- **Port notes:** executed by FLR through `GoogleWorkspacePort` (HTTP adapter built; the account store is not, so the node currently reports no account). Home the OAuth account store in the integrations domain with encrypted tokens and per-workspace RLS. Decide deliberately between `USER_ENTERED` (fidelity, formula-injection risk when a customer-supplied value starts with `=`, `+`, `-` or `@`) and `RAW`; recommended: prefix-escape or RAW and record it as an intended difference. Surface write/read failures as a run-log note, and consider a not-found port.

### WD-FLB-058 — Google Docs node

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-026
- **Summary:** Copies a template Google Doc, fills its placeholders from the flow's variables, makes the copy viewable by anyone with the link, and sends the link to the customer (quotes, contracts, certificates).
- **Actors & access:** workspace admin. Chat mode only. Needs Google connected with Docs and Drive scopes.
- **UX & screens:** inspector case `google_docs`: info box (red warning when `integration.connected === false` or `missing` contains `docs` or `drive`). Fields: **Template document** select `templateId` (from `GET api/google/picker/docs`; first option "— pick a template doc —"; unknown id "Doc <12 chars>… (not loaded)"); **New copy title** text `newTitle` (default "Document for {{name}}"); **Placeholders to fill** list of key + value pairs (default `customer_name={{name}}`; add/remove, no limit; hint: every flow variable is also auto-injected so `{{name}}` works without listing); **Make link viewable by anyone** checkbox `shareable` (default on; text flips between "On — anyone with link can view" and "Off — must be granted manually"); **Message template** textarea 4 rows `messageTemplate` (default "Here's your document:\n{{doc_url}}"); **Save URL under variable** `saveAs` (default `doc_url`). One output "doc sent". Preview: first 10 characters of the template id and the title.
- **Endpoints:**

| Method uri | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| POST api/flow-node/google/doc-generate | api.flow-node.gdoc-generate | GoogleFlowNodeController@docGenerate | api (X-Node-Token) | `workspace_id` int req; `template_id` req max 128; `new_title` req max 240; `vars` object; `shareable` bool (default true) | `{ok, id, url}`; 422 `{ok:false, error}`; 503 `integration_disabled`; 404 `workspace_not_found` |

  The picker route is the one in WD-FLB-057.
- **Data:** node `data` `{templateId, newTitle, placeholders:[{key,value}], shareable, messageTemplate, saveAs}`; normalizer copies, `shareable` defaults true, `saveAs` default `doc_url`. Writes variables `<saveAs>` and `doc_url`.
- **Rules & edge cases:**
  1. Skip rule: no workspace or no `templateId` advances without sending.
  2. Placeholder set = every string/number variable of the run (auto-injected) overlaid with the explicit key/value rows (values may use `{{vars}}`). Replacement is a Docs `replaceAllText`, case-insensitive, for both the `{{key}}` and the single-brace `{key}` form. QUIRK: the single-brace form also rewrites ordinary text in a template that happens to contain `{key}`.
  3. Order of Google calls: Drive copy (named by `newTitle`), Docs batch update, then (if shareable) a Drive permission `reader` / `anyone`. A failed batch update or a failed permission call is logged and ignored: the link is still sent (unfilled or private).
  4. A failed copy sends the apology "Sorry, couldn't generate your document right now. Please try again later." and advances through `out`.
  5. The generated copy stays in the connected Google account forever (no cleanup); "anyone with the link" documents contain customer data.
  6. Node timeout is 25 s; the whole step is one HTTP call.
- **Async & events:** none.
- **External systems:** Google Drive `files.copy`, `permissions.create`; Google Docs `documents.batchUpdate`.
- **Settings:** same Google master toggle and workspace connection as WD-FLB-057.
- **Acceptance criteria:**
  - Given a template containing `{{customer_name}}` and a placeholder row `customer_name={{name}}`, when the node runs for contact "Anya", then the copy shows "Anya" and the customer receives the link in the message template.
  - Given sharing is off, then no permission is created and the message still contains the URL.
  - Given the copy call fails, then the customer gets the apology message and the run continues on `out`.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`google_docs`), `app/Services/Flows/FlowNormalizer.php`, `app/Http/Controllers/GoogleFlowNodeController.php` (`docGenerate`), `app/Services/Google/GoogleApiService.php` (`copyDocAndFill`), `node/services/flowService.js` (`executeGoogleDocsNode`).
- **Port notes:** as WD-FLB-057 (FLR executor behind `GoogleWorkspacePort`). Decide whether sharing defaults to link-viewable (privacy) and add a retention rule for generated copies. Replace only the `{{key}}` form unless fidelity with existing templates is required.

### WD-FLB-059 — Google Form node, Apps Script and submission webhook

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** L (<=2 weeks) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-026
- **Summary:** Sends the customer a Google Form link, pauses the run, and resumes when the customer submits. Answers become flow variables. A downloadable Apps Script, pasted once into the form, is what tells WaDesk about each submission.
- **Actors & access:** workspace admin (builder, Apps Script download). Chat mode only. The webhook is called by Google's Apps Script runtime (no session).
- **UX & screens:** inspector case `google_form`: info box (warning when Forms scope missing). Fields: **Google Form** select `formId` (picker `forms`; "— pick a form —"; unknown "Form <12 chars>… (not loaded)"); **Body bubble** textarea 3 rows `bodyText` (default "Please fill out this short form:"); **Save responses under variable** `saveAs` (default `google_form`; individual answers also as `{{saveAs.Question title}}`); **Expire after (seconds)** number `expiresInSec` (default 86400). When a form is selected a setup box appears: open the form's Script editor, download the `.gs` file, paste it, add a trigger for `onWaDeskFormSubmit` "From form / On form submit"; warning that without the script answers are recorded in Google but the flow never resumes. Two output ports: **submitted** (green) and **timed out** (red); the card is multi-port (google_form is in the multi-port set).
- **Endpoints:**

| Method uri | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| POST api/flow-node/google/form-send | api.flow-node.gform-send | GoogleFlowNodeController@formSend | api (X-Node-Token) | `workspace_id` int req; `google_form_id` req max 128; `flow_session_id` req max 64; `contact_phone` max 32; `save_variable` max 64; `resume_port` max 32; `expires_in_sec` int 60..604800 | `{ok, form_url, webhook_token, webhook_url, apps_script_url, session_row_id}`; 422 `form_unreachable` / `no_responder_uri`; 503; 404 |
| POST api/google/form-response | api.google.form-response | GoogleFlowNodeController@formResponse | api; header `X-Workspace-Token` | `form_id` req max 128; `response_id`, `respondent`, `submitted_at` optional; `answers` object req | `{ok:true, matched:true, session}` or `{ok:true, matched:false[, reason:'expired']}` |
| GET google-account/forms/{formId}/apps-script.gs | user.google.apps-script | GoogleFlowNodeController@appsScript | web, Authenticate, EnsureWorkspaceRole:admin | route `formId` | attachment `<brand-slug>-form-<id>.gs` (text/plain); 401 "Not logged in." without a workspace |

- **Data:** table `google_form_sessions` (model `GoogleFormSession`): `workspace_id`, `flow_session_id`, `google_form_id`, `contact_phone` (digits), `save_variable`, `resume_port`, `webhook_token` (40 random chars), `answers_json`, `submitted_at`, `expires_at`. Normalizer: `formId`, `bodyText`, `saveAs` (cleaned, default `google_form`), `expiresInSec` int (default 86400); ports submitted = 1, timeout = 2. Runtime stores the answers object under the root variable and each answer as `<root>.<question title>` (arrays joined with commas).
- **Rules & edge cases:**
  1. `form-send` reads the form from the Forms API for its responder URL, deletes any older unsubmitted row for the same (flow session, form), then creates a fresh row. The message is `<bodyText>` + blank line + the URL on its own line (so the chat shows a link preview). The run then parks as "GoogleForm".
  2. Resume matching: newest unsubmitted row whose `webhook_token` equals the header AND whose form id matches; fallback, when the header equals the platform node token, newest unsubmitted row for that form id (any workspace). No row: HTTP 200 `matched:false` so Apps Script does not retry. Expired row: marked consumed, `matched:false reason:expired`. Otherwise the answers are saved, `submitted_at` set, and the Node bridge is told to resume (`POST /api/flow-resume` with session id, port, variable and answers).
  3. The resumed run leaves the node through port 1 (`submitted`). Webhook returns `matched:true` even when the Node call failed (logged; the row is already marked submitted).
  4. QUIRK: the `timeout` port never fires. `expiresInSec` only matters when a submission arrives late; there is no timer and the parked run simply ends with the session.
  5. QUIRK: `expiresInSec` outside 60..604800 makes `form-send` answer 422 (no form URL); the node then sends the apology "Sorry, the form is unavailable right now. Please try again later." and advances through port 1, which is `submitted`. A bad expiry therefore behaves like a completed form. The inspector accepts any number.
  6. QUIRK / SECURITY: the downloaded Apps Script has the PLATFORM node token (`node_token()`) baked in, not the per-row `webhook_token` that `form-send` generates (that token is returned to the Node runner and used by nobody). Any workspace admin who downloads a script gets the shared secret that authenticates every `X-Node-Token` endpoint. Do not port this: mint a per-session (or per-form-per-workspace) signed token, and bind the form id to the workspace on the resume lookup.
  7. Any failure of `form-send` (not connected, form unreachable, integration off) is logged, the apology is sent and the node leaves through port 1 (`submitted`).
- **Async & events:** parked run; webhook from Apps Script; HTTP resume call to the Node bridge (FLR owns resuming in this repo).
- **External systems:** Google Forms API (`forms.get`), Apps Script `onFormSubmit` trigger running in the customer's own Google account, calling the public webhook URL.
- **Settings:** Google master toggle; the Apps Script embeds the webhook URL and the token.
- **Acceptance criteria:**
  - Given a selected form, when the node runs, then the customer receives the body text and the form URL, a `google_form_sessions` row exists with `expires_at` 24 hours ahead, and the run waits.
  - Given the customer submits the form and the script is installed, when the webhook receives the answers, then the run continues through `submitted` and `{{google_form.<Question title>}}` holds each answer.
  - Given a submission arrives after `expires_at`, then the response is `matched:false reason:expired` and the run is not resumed.
  - Given a webhook call for a form with no waiting session, then the response is HTTP 200 `matched:false`.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`google_form`), `app/Services/Flows/FlowNormalizer.php`, `app/Http/Controllers/GoogleFlowNodeController.php` (`formSend`, `formResponse`, `appsScript`), `app/Models/GoogleFormSession.php`, `app/Services/Google/GoogleApiService.php` (`getForm`, `buildAppsScript`), `node/services/flowService.js` (`executeGoogleFormNode`, `resumeGoogleForm`), `node/controllers/flowController.js` (`/api/flow-resume`).
- **Port notes:** the table moves to Postgres with `org_id` and RLS; the public webhook is a webhook-handler pattern (signed token, idempotent, answers stored then a queued resume job). FLR owns resuming a parked run; give the run a real `expires_at` and fire the `timeout` port from the sweeper. Replace the platform-secret script with a per-session token, and test cross-workspace isolation on the resume lookup.

### WD-FLB-060 — Create / move deal node

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-026
- **Summary:** Creates a CRM deal for the flow's contact in a chosen pipeline stage, or moves the contact's open deal into that stage, so a chatbot can qualify a lead and push it along the board. The deal id is saved in a variable.
- **Actors & access:** workspace admin (builder). Chat mode only. Plan flag `access_sales_pipeline` is enforced by the callback.
- **UX & screens:** inspector case `deal`: info box ("Creates a CRM deal ... Moving into a stage fires the deal stage trigger on other flows"). Fields: **Action** select `action` (`create` default "Create a new deal" / `move` "Move the contact's deal to a stage"; hint changes with the choice); **Pipeline stage** select `stageId` ("— pick stage —" or "Loading stages…"; options from `GET /deals/stages`, shared with the Trigger's deal-stage picker; unknown id "Stage <id> (not loaded)"; hint says "Required" but nothing enforces it in the builder); **Deal name** text `dealName` (default "{{contact_name}} — deal"); **Deal value (optional)** text `value` (number or `{{var}}`, placeholder 5000); **Save deal id under variable** `saveAs` (default `deal_id`). `ownerId` exists in the node data (default empty) but has no inspector control. Ports: **created** (label "moved" when action is move, green) and **error** (red). Preview: "CREATE|MOVE · stage <id>" and the deal name. The simulator logs a skipped CRM call and takes `created`.
- **Endpoints:**

| Method uri | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| POST api/flow-node/deal-action | api.flow-node.deal-action | FlowNodeActionsController@dealAction | api (X-Node-Token) | `workspace_id` int req; `action` in create, move req; `stage_id` int req; `deal_name` max 191; `value` numeric 0..99,999,999; `owner_user_id` int; `contact_phone` max 32; `deal_id` int (never sent by the node) | `{ok:true, deal_id, status, created}`; 404 `workspace_not_found`; 422 `plan_not_allowed`, `stage_not_found`; 500 `deal_failed` |

- **Data:** node `data` `{action, dealName, stageId, value, ownerId, saveAs}`. Normalizer emits flat `action` (move or create), `dealName`, `stageId` (string), `dealValue`, `ownerId`, `saveAs` (cleaned, default `deal_id`); ports created = 1, error = 2. Writes `deals`: `workspace_id`, `pipeline_id`, `stage_id`, `contact_id`, `title` (cut to 191, default "New deal"), `value_minor = round(value * 100)`, `currency` (pipeline's), `owner_user_id`, `source = 'flow'`, `sort_order 0`.
- **Rules & edge cases:**
  1. Node-side: no workspace or no stage goes straight to `error`. The deal name resolves `{{vars}}`; the value resolves `{{vars}}` and keeps only digits and the dot (so "USD 1,200.50" becomes 1200.50); empty gives null. Success saves the id (as text) under `saveAs` and takes `created`; any non-ok or HTTP failure takes `error`.
  2. The destination stage must belong to the workspace; its pipeline decides where a new deal is created (falls back to the workspace default pipeline).
  3. Move: explicit `deal_id` wins (never sent by this node), otherwise the contact's most recent OPEN deal (comment says "in this pipeline" but the query is not pipeline-scoped); found: update `stage_id` (the Deal observer syncs won/lost status and fires the deal-stage-changed trigger); none found: a new deal is created and the response says `created:true`.
  4. The contact is found by digit-comparing the flow's contact number with every contact of the workspace (decrypted in PHP). No match still creates the deal, with no contact.
  5. QUIRK: moving a deal fires `deal_stage_changed` flows, which may move another deal: loops are possible; there is no depth guard.
  6. QUIRK (WD-FLB-017 rule 1): the card draws one output dot, so `error` is only wireable on imported / seeded graphs.
- **Async & events:** the Deal model observer fires `FlowEnrollmentService::onDealStageChanged` (WD-FLB-071); activity entries are the deals domain's.
- **External systems:** none.
- **Settings:** plan feature `access_sales_pipeline`.
- **Acceptance criteria:**
  - Given action create and a valid stage, when the node runs, then a deal exists in that stage's pipeline linked to the contact, `{{deal_id}}` holds its id and the run continues on `created`.
  - Given action move and the contact has an open deal, then that deal's stage changes (no new deal) and flows triggered by that stage start.
  - Given the workspace plan lacks the sales pipeline, then the callback answers 422 `plan_not_allowed` and the run continues on `error`.
  - Given a stage id from another workspace, then the callback answers 422 `stage_not_found`.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`deal`, `STAGES_CACHE`), `app/Services/Flows/FlowNormalizer.php` (`deal`, PORT_MAP), `app/Http/Controllers/FlowNodeActionsController.php` (`dealAction`, `resolveContactIdByPhone`), `node/services/flowService.js` (`executeDealNode`).
- **Port notes:** the deals domain should expose a `DealsFacade.createOrMove(orgId, contactId, stageId, ...)` used by the FLR executor (no HTTP round-trip). Resolve the contact from the run's contact id, not a phone scan. Enforce the plan gate there, add a flow-trigger depth guard, and make the stage required on save.

### WD-FLB-061 — Copy to number node

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-017
- **Summary:** Sends a copy of a message or report to one fixed phone number (a doctor, clinic or the owner's own line) while the flow's own contact keeps receiving the normal messages. It can mirror the last message the customer got, or send a custom text or media.
- **Actors & access:** workspace admin. Chat mode only. Uses the same engine and sender the flow runs on.
- **UX & screens:** inspector case `notify_number`: blue info box. Fields: **Copy to number** text `copyNumber` (placeholder 15551234567; "full international format, digits only"; `{{agent_number}}`-style variables allowed); **What to send** select `source` (`mirror` "Same message the customer just received (automatic)" default / `custom`). Mirror: a note to place the node right after the message or report to copy. Custom: **Type** select `kind` (text, image, document "Document (PDF report, etc.)", video, audio); text kind shows **Message** textarea `text` (default "A new update:\n{{name}}"); media kinds show **Media URL** `url` (public HTTPS, may be a `{{variable}}`), **Filename (label)** `filename`, **Caption** textarea 3 rows `caption`. One output "sent". The simulator logs "Copy sent to <number>: <what>".
- **Endpoints:** none (executed by the runtime).
- **Data:** node `data` `{copyNumber:'', source:'mirror', kind:'text', text, url, filename, caption}`. Normalizer: `copyNumber` with every character except digits, braces and word characters removed (so spaces, `+` and dashes disappear but `{{vars}}` survive), `source` (custom or mirror), `kind` (lower-cased), `text`, `mediaKind` ('' for text), `mediaUrl` (made absolute; relative paths get the app URL, `{{var}}` URLs are left alone), `mediaCaption`, `mediaFilename`.
- **Rules & edge cases:**
  1. Runtime resolves `{{vars}}` in the number, then strips everything but digits; an empty result logs and the node advances without sending.
  2. Mirror mode copies the exact last outbound item of the run (text, or media with its caption and filename); if the run has sent nothing yet, nothing is copied and the node advances.
  3. Custom media with no URL advances without sending. On the unofficial engine documents are always sent as PDF and audio as MP3.
  4. Sent through the flow's engine (WABA, Twilio or the unofficial socket) as a separate message with its own message id; it is billed and counted against caps like any other send. Errors are logged and swallowed; the node always advances through `out`.
  5. QUIRK / compliance: the recipient is an arbitrary number that never opted in and was never a contact; nothing checks consent, the WhatsApp 24-hour window for that number, or whether the number is the contact itself.
  6. The recipient copy does not create a conversation or contact for the fixed number in the inbox.
- **Async & events:** none beyond the send.
- **External systems:** the flow's WhatsApp engine (Cloud API messages, Twilio, Baileys).
- **Settings:** the footer text appended on the unofficial engine (workspace setting).
- **Acceptance criteria:**
  - Given mirror mode and a Send media node (a PDF) just before, when this node runs, then the fixed number receives the same PDF and the customer is unaffected.
  - Given `copyNumber` "+1 (555) 123-4567", then the stored value normalises to digits only (`15551234567`).
  - Given the run has sent nothing yet, then mirror mode sends nothing and the run continues.
  - Given `copyNumber` is `{{agent_number}}` and that variable is empty, then no send happens and the run continues.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`notify_number`), `app/Services/Flows/FlowNormalizer.php` (`notify_number`), `node/services/flowService.js` (`executeNotifyNumberNode`, `session.__lastOut`).
- **Port notes:** FLR executor (`FlowSender`); the builder keeps the schema. Add a consent/allow-list decision for the fixed recipient (recommend: warn in the inspector and require the number to be a workspace member or an opted-in contact), and count the copy in the daily cap tally.

### WD-FLB-062 — Hand off to Instagram node

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-017
- **Summary:** Sends the WhatsApp customer a message containing an `ig.me` deep link that opens a chat with the business's Instagram account. Deep link only: Instagram does not allow starting a DM to someone who has not messaged first.
- **Actors & access:** workspace admin. Chat mode only. The reverse direction (Instagram to WhatsApp) is WD-FLB-064.
- **UX & screens:** inspector case `wa_to_instagram`: pink info box. Fields: **Your Instagram username** text `igUsername` (without the @; link becomes `ig.me/m/<name>`); **WhatsApp message** textarea 2 rows `introText` (default "Continue with us on Instagram" followed by a pointing-down emoji; supports `{{variables}}`). One output "link sent". The simulator shows the intro plus the link.
- **Endpoints:** none.
- **Data:** node `data` `{igUsername:'', introText}`. Normalizer: `igUsername` trimmed with a leading `@` removed; `introText` default "Continue with us on Instagram" (no emoji; differs from the builder default).
- **Rules & edge cases:**
  1. No username: logs and advances without sending.
  2. The message is the intro (with `{{vars}}` resolved), a newline and the link; an empty intro sends the link alone.
  3. Sent over the flow's engine (WABA, Twilio, unofficial). Errors are logged and swallowed; the node always advances through `out`.
  4. No validation of the username (spaces or other characters give a dead link). The link is built from the stored username; it is not verified against a connected Instagram account.
- **Async & events:** none.
- **External systems:** the flow's WhatsApp engine.
- **Settings:** none.
- **Acceptance criteria:**
  - Given username "@yourbrand" and the default intro, when the node runs, then the customer receives the intro and `https://ig.me/m/yourbrand`.
  - Given an empty username, then nothing is sent and the run continues.
  - Given an empty intro, then the message contains only the link.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`wa_to_instagram`), `app/Services/Flows/FlowNormalizer.php`, `node/services/flowService.js` (`executeWaToInstagramNode`).
- **Port notes:** FLR executor; pre-fill the username from the connected Instagram channel when one exists, validate it against `[A-Za-z0-9._]{1,30}` on save, and keep the single `out` port.

### WD-FLB-063 — Call-flow voice nodes and call-flow endpoints

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** L (<=2 weeks) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-016
- **Summary:** A separate flow type (`flow_type='call'`) for inbound WhatsApp voice calls: a turn-by-turn voice IVR built from eight `cf_*` nodes (speak, listen, AI answer, voice-assistant answer, menu, web search, transfer, hang up). When a call arrives the call bridge asks Laravel for the workspace's live call flow and walks it.
- **Actors & access:** workspace admin (builder). Created from "Call" in the create sheet (`/flows/builder?type=call`, WD-FLB-003); the Trigger channel switch is never offered for call flows. At run time the node call bridge (token) fetches the flow.
- **UX & screens:** palette in call mode lists the eight `cf_*` nodes plus Trigger, Condition, Wait, Webhook, Run code and End (WD-FLB-016). Inspector fields per node:
  - **Say** (`cf_say`): *Say to caller* textarea 3 rows `text` (default "Hello! Thanks for calling."; `{{vars}}` allowed; spoken by text-to-speech). Output "spoken".
  - **Listen** (`cf_listen`): *Save what they say to* `save` (default `caller_said`); *Stop after silence (seconds)* number `silenceTimeout` min 1, max 30, default 6 (an empty or invalid entry falls back to 6). Output "heard".
  - **AI Respond** (`cf_ai`): *Model* select `model` (admin-enabled models, default gpt-4o-mini; "No AI models enabled — ask admin" when none; an unlisted saved model shown with "(not enabled)"); *Instructions (system prompt)* textarea 4 rows `prompt` (default "You are a helpful phone assistant. Keep answers short and natural."); *Knowledge base (optional)* select `assistant` ("— none (prompt only) —", then "<name> · N src" from `flows/api/ai-assistants`); *Save spoken reply to* `save` (default `ai_reply`); checkbox *End the call when the caller says goodbye* `endOnGoodbye` (default on). Output "answered".
  - **AI Assistant** (`cf_assistant`): *Voice assistant* select `assistant` ("— pick a voice assistant —", from `flows/api/call-assistants`; unknown id "Assistant #<id>"); *Extra instructions (optional)* textarea 3 rows `prompt` (appended to the assistant's persona for this node only); *Save spoken reply to* `save` (default `assistant_reply`); *End the call when the caller says goodbye* (default on). Output "answered".
  - **Menu / Branch** (`cf_menu`): *Route by* select `mode` (`intent` "What the caller says (AI intent)" default, `keyword`, `digit` "Key press (1,2,3…)"); *Branches* list of `match` + `label` (add/remove; defaults sales/Sales and support/Support). Ports: `p0..pN` one per branch plus `nomatch` ("no match").
  - **Search web** (`cf_search`): *Search query* `query` (default `{{caller_said}}`); *Save results to* `save` (default `search`); *Say while searching* `filler` (default "One moment, let me check that…"). Output "results".
  - **Transfer** (`cf_transfer`): *Transfer to number* `number` (placeholder +1555…); *Say before transferring* `message` (default "Connecting you to an agent now."). Output labelled "if no answer".
  - **Hang up** (`cf_hangup`): *Goodbye message* `goodbye` (default "Thanks for calling. Goodbye!"; blank hangs up silently). No output; terminal.
- **Endpoints:** (all `api` group, token `X-Node-Token`)

| Method uri | Route name | Controller@action | Request | Response |
| --- | --- | --- | --- | --- |
| POST api/call-flow/active | api.call-flow.active | FlowNodeActionsController@activeCallFlow | `workspace_id` int | `{ok:true, flow:<decoded flow data, NOT normalised>, flow_id}` for the workspace's newest published AND active call flow (by id), else `{ok:true, flow:null}`; 401 unauthorized |
| POST api/flow-node/ai-call | api.flow-node.ai-call | FlowNodeActionsController@aiCall | `model` req max 120; `workspace_id`; `assistant_id` (training assistant); `call_assistant_id` (voice assistant); `system_prompt` max 6000; `user_prompt` max 6000; `max_tokens` 1..4000 (default 350); `temperature` 0..2 (default 0.7); `json` bool; `fields[]` | `{ok:true, reply, provider}`; 502 `provider_failed` |
| POST api/flow-node/web-search | api.flow-node.web-search | FlowNodeActionsController@webSearch | `query` req max 500; `max_results` 1..10 (default 5) | `{ok:true, text, provider}` or `{ok:true, text:'', note}` |

- **Data:** call-flow graph stored like any flow. Normalizer mapping (used for the Node chat runtime, not for the call bridge): `cf_say` -> `CallSay` (`text`), `cf_listen` -> `CallListen` (`variable`, `silenceTimeout` int default 6), `cf_ai` -> `CallAI` (`model` default gpt-4o-mini, `prompt`, `variable`, `assistant_id` null when 0, `endOnGoodbye` default true), `cf_menu` -> `CallMenu` (`routeBy`, `options`), `cf_search` -> `CallSearch`, `cf_transfer` -> `CallTransfer`, `cf_hangup` -> `CallHangup`; `cf_assistant` has no TYPE_MAP entry (it falls through as `Cf_assistant` with `data` intact).
- **Rules & edge cases:**
  1. The call bridge reads the RAW builder graph (`flowNodes`, `flowEdges` with `source`, `target`, `sourceHandle`; handles `out`, `p0..pN`, `nomatch`), not the PascalCase shape. Entry = the node reached from the Trigger's `out` handle.
  2. `ai-call` with `call_assistant_id`: adopts that voice assistant's persona (its system prompt leads; the node's extra prompt is appended) and its model, scoped to the workspace; provider inferred from the model prefix (claude -> anthropic, gemini -> gemini, mistral / ministral / open-mistral / open-mixtral -> mistral, else openai). With `assistant_id`, the training assistant's ready knowledge sources are appended to the system prompt. Keys: workspace BYOK first, then admin key, then env.
  3. `web-search`: provider and key come from system settings `web_search_provider` (tavily default, serpapi, brave) and `web_search_key`; 8 s timeout; the text is cut to 3000 characters; no key or any failure returns empty text, never an error, so a call never breaks.
  4. Walk rules (runtime): at most 40 steps per caller turn; Listen parks the call until the next transcribed utterance; AI and assistant nodes speak the reply and, when `endOnGoodbye` is on (default) and the caller said goodbye, end the call; Search speaks the filler first; Transfer speaks its message then bridges to the number, a successful transfer ends the flow, a failed one follows `out` ("if no answer"); Hang up speaks the goodbye and ends; running off the end of the graph ends the call gracefully.
  5. QUIRK: Menu `mode` is stored but ignored. The branch is chosen by case-insensitive substring containment of each branch `match` in the caller's last utterance (first match wins), whatever the mode; no match takes `nomatch` (and if a branch handle has no edge it falls back to the `nomatch` edge). There is no AI intent classification and no key-press handling.
  6. QUIRK: `silenceTimeout` is not read by the call runtime.
  7. QUIRK: Condition, Wait, Webhook and Run code are offered on the call canvas, but the call runtime has no executor for them: an unknown node simply advances through `out`. A Condition (handles `yes` / `no`) therefore has no `out` edge and the call ends; Wait and Webhook do nothing.
  8. One live call flow per workspace in practice: the newest published + active one by id wins; the others are ignored. With no call flow the bridge falls back to the workspace's single default voice assistant.
- **Async & events:** a live WebRTC call handled by the Node bridge (STT in, TTS out); transcript turns posted to `wa_call_events` (WD-FLB-069).
- **External systems:** Deepgram / OpenAI (STT), ElevenLabs / provider TTS, LLM providers, web-search providers (Tavily, SerpAPI, Brave).
- **Settings:** `web_search_provider`, `web_search_key` (admin), AI keys, call recording flags on the assistant.
- **Acceptance criteria:**
  - Given a published, active call flow Trigger -> Say -> Listen -> AI Respond -> Hang up, when a call arrives, then the caller hears the greeting, the answer to what they say, and the goodbye, and the call ends.
  - Given a Menu with branches `sales` and `support` and the caller says "I need support", then the `p1` port is followed; given the caller says nothing matching, then `nomatch` is followed.
  - Given a workspace with no published call flow, then `api/call-flow/active` returns `flow:null` and the bridge uses the default assistant.
  - Given a Search node with no `web_search_key` configured, then the call continues with an empty result and no error.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`cf_*` entries, defaults, inspectors, `nodeRows`), `app/Services/Flows/FlowNormalizer.php` (`cf_*`), `app/Http/Controllers/FlowNodeActionsController.php` (`activeCallFlow`, `aiCall`, `webSearch`), `node/services/callFlowRuntime.js`, `node/services/wabaCallBridge.js`.
- **Port notes:** the call runtime and bridge belong to the calling domain (FLR index: "Call flow (voice IVR)" is the calling domain's); FLB keeps the catalogue, inspectors and a `GET /v2/flows/active-call-flow` read. Build the Menu classifier and `silenceTimeout` properly or drop the fields; hide Condition/Wait/Webhook/Run code from call mode (or implement them). Version the graph so a published call flow cannot change under a live call.

### WD-FLB-064 — Instagram-channel nodes

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** L (<=2 weeks) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-016
- **Summary:** The Instagram DM node set: five visible Instagram-specific nodes (button message, reply to comment, send products, capture lead, hand off to WhatsApp), four hidden legacy ones, plus the shared message, media, buttons, ask, condition, delay, webhook, AI and end nodes that also run on Instagram. Appears only when the Instagram extension (or remote Instaflow link) is available and the Trigger channel is Instagram.
- **Actors & access:** workspace admin. Palette group "Instagram", mode `instagram` (WD-FLB-016). The runner is either the native Node Instagram engine (system setting `instagram_enabled`) or the remote Instaflow service that executes the flow it is pushed (WD-FLB-079).
- **UX & screens:** inspector fields:
  - **Button message** (`ig_buttons`): *Message* textarea 2 rows `text` (default "Tap a button below:"); *Buttons (max 3)*, each: type select `web_url` "Open URL" / `postback` "Postback", label `title`, then `url` (web_url) or `payload` (postback); "Add button" disappears at 3. Defaults: "Visit site" web_url `https://`, and "Talk to us" postback `CONTACT`. Output "sent".
  - **Reply to comment** (`ig_reply_comment`): *Public reply* textarea 2 rows `message` (default "Thanks! Just sent you a DM."). Output "replied".
  - **Send products** (`ig_products`): *Which products* segmented `selection` `pick` ("Pick specific", default) / `all` ("First N synced"); `all` shows *How many* `limit` (default 5; hint max 10), `pick` shows a product picker storing `productIds[]` (order kept); *Intro message (optional)* textarea 2 rows `intro` (default "Here are some products you might like:"; empty sends only the cards); *Order button* checkbox `orderButton` (default on) with label `orderLabel` (default "Order"; tapping sends `ORDER_<product>`); *Details button* checkbox `detailsButton` (default on) with label `detailsLabel` (default "View"; only on products with a catalog link). Output "sent".
  - **Capture lead** (`ig_lead`): *Name / Email / Phone from variable* `nameVar` / `emailVar` / `phoneVar` (defaults `lead_name`, `lead_email`, `lead_phone`); *Notes from variable (optional)* `notesVar` (default empty); *Sales Pipeline* checkbox `createDeal` (default on); *Thank-you message (optional)* textarea 2 rows `ack` (default "Thanks! Our team will reach out shortly."). Output "saved".
  - **Hand off to WhatsApp** (`ig_to_whatsapp`): *Handoff method* select `mode` (`deeplink` "Deep link — send a wa.me link (recommended, safe)" default, or `direct` "Direct — start a WhatsApp flow to a captured number"). Deep link: *Your WhatsApp number* `waNumber` (digits, country code first), *Pre-filled message* `prefillText` (default "Hi! I came from Instagram"), *DM shown on Instagram* textarea `introText` (default "Let's continue on WhatsApp" followed by a pointing-down emoji). Direct: amber warning about Meta opt-in / 24-hour rule, *WhatsApp number from variable* `numberVar` (default `wa_number`), *WhatsApp flow to start* select `waFlowId` (all flows except Instagram and call flows, labelled "<name> · live|draft"). Output "handed off".
  - Hidden legacy (never listed, still render and run on old flows): `ig_send_dm` (`text`), `ig_quick` (`text`, `options[{title,payload}]`, ports `p0..`), `ig_ai` (`model`, `prompt`, `assistant`, `save`), `ig_ask` (`question`, `save`). A runner-only `ig_gallery` has no palette entry.
- **Endpoints:** none in FLB. The Node Instagram runner calls back `POST api/instagram/flow-node` and `POST api/instagram/flow-log` (token). QUIRK: neither route exists in this v1.7.0 tree (no Instagram flow-node controller ships; only the device-connect routes `devices/instagram/*` and the Instaflow routes exist), so on a deployment without the Instagram extension the native runner's smart nodes (AI, products, lead, comment reply, handoff direct) and message logging have nowhere to land.
- **Data:** node `data` as above; normalizer passes `ig_*` nodes through unchanged (`flowNodeType` = `ucfirst(type)`, e.g. `Ig_buttons`), keeping raw `data` and handle names. `flows.flow_type='instagram'`, `provider='instagram'`.
- **Rules & edge cases:**
  1. Runtime (native engine): a 100-node guard per walk; sessions live in memory and are dropped after 24 hours. `buttons` with at most 3 options are sent as persistent generic-template buttons, more than 3 as quick-reply chips (max 13, title 20 chars). `ig_buttons` sends button templates (max 3, title 20) and parks until the customer taps. `media` sends image, video or audio attachments; any other kind (documents) is sent as a link. `ig_to_whatsapp` deep link builds `https://wa.me/<digits>[?text=<url-encoded prefill>]`; direct mode sends the intro, then asks Laravel to start the chosen WhatsApp flow for the captured number.
  2. Resume: a tap arrives as its payload or label and is matched to `p<i>`; a non-matching reply is NOT consumed (returns false so normal handling continues).
  3. QUIRK (static reading, verify against the runner): `ig_buttons` has the single builder handle `out`, but the runner resumes on `p<idx>` after a postback tap. With only an `out` edge wired the run ends after the tap; URL buttons never reply. The rebuilt node needs explicit per-postback ports.
  4. QUIRK: the shared Condition node on Instagram uses the single-rule evaluator that reads flat `variable` / `operator` / `value` from node data, but the builder stores `conditions[]` and `operators[]`; compound rules and the stored rule are ignored and the default (contains, empty value) is always true (see WD-FLB-067).
  5. Per-node plan gates live in the callbacks (not in the builder), e.g. the lead node's deal creation needs `access_sales_pipeline`.
- **Async & events:** none beyond the runner; inbound IG messages, comment events and the flow keyword rows belong to the Instagram channel domain.
- **External systems:** Instagram Graph API (send, comments) in the native engine; the Instaflow bridge in remote mode.
- **Settings:** `instagram_enabled`, `instaflow_url`, `instaflow_secret` (admin, system settings).
- **Acceptance criteria:**
  - Given the Trigger channel is Instagram, then the palette shows the five Instagram nodes and not the four legacy ones.
  - Given a Button message with three buttons, then "Add button" is hidden; given a fourth is attempted through import, then the runner sends only the first three.
  - Given Send products with Order enabled, then each card carries a postback whose payload starts with `ORDER_`.
  - Given Hand off to WhatsApp in deep-link mode with number 15551234567 and prefill "hi", then the DM contains `https://wa.me/15551234567?text=hi`.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`ig_*` entries, defaults, inspectors, `IgProductPicker`), `app/Services/Flows/FlowNormalizer.php`, `node/services/instagramFlowService.js`, `node/controllers/instagramFlowController.js`.
- **Port notes:** the channel-instagram domain owns the runner and callbacks; FLB owns the catalogue and inspectors. Port the five visible nodes and accept the legacy four on import only. Render a port per postback button, enforce the 3-button and 20-character limits on save, and build the Condition evaluator once for every channel.

### WD-FLB-065 — Facebook Messenger nodes

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-016
- **Summary:** The Messenger-specific nodes, a mirror of the Instagram set: card gallery, send products, capture lead, reply to comment, hand off to WhatsApp. The shared message, media, buttons, ask, condition, delay, webhook, AI and end nodes also run on Facebook Pages. Offered only when the admin's Facebook Pages toggle is on, at least one Page is connected, and the Trigger channel is Facebook.
- **Actors & access:** workspace admin. Palette group "Facebook" (blue chips), mode `facebook`.
- **UX & screens:** inspector fields:
  - **Card gallery** (`fb_gallery`): *Intro message (optional)* textarea 2 rows `intro`; *Cards (max 10)*, each with Title, Subtitle (optional), Image URL (`https://`), Button label, Button URL; "Add card" hidden at 10. Default one card ("Card title", button "Learn more", `https://`). Output "sent".
  - **Send products** (`fb_products`): *Intro message* `intro` (default "Here are some products you might like:"); *Products (max 10)* each with name, price/description, image URL, product page URL; *Order button* checkbox (default on) + label (default "Order"); *Details button* checkbox (default on) + label (default "View"; only when the product has a URL). Output "sent".
  - **Capture lead** (`fb_lead`): same fields and defaults as Instagram (variables `lead_name` / `lead_email` / `lead_phone`, optional notes variable, `createDeal` default on, thank-you default "Thanks! Our team will reach out shortly."). Output "saved".
  - **Reply to comment** (`fb_reply_comment`): *Public reply* textarea 2 rows `text` (default "Thanks! Just sent you a DM."). Output "replied".
  - **Hand off to WhatsApp** (`fb_to_whatsapp`): same modes as Instagram; the WhatsApp-flow dropdown excludes Instagram, Facebook, TikTok, Telegram, Email and call flows (it does not exclude LINE, WeChat or Viber flows). Default prefill "Hi! I came from Facebook". Output "handed off".
  - Runner-only legacy types with no palette entry at all: `fb_send_dm`, `fb_quick`, `fb_ask`, `fb_buttons`.
- **Endpoints:**

| Method uri | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| POST api/facebook/flow-log | none | Facebook\FacebookFlowNodeController@log | none at route level; X-Node-Token in the controller | mirrors an in/out flow message into the inbox | `{ok:true}` |
| POST api/facebook/flow-node | none | Facebook\FacebookFlowNodeController@node | none at route level; X-Node-Token in the controller | `action` (node type; `type` fallback), `node`, `vars`, `workspaceId`, `pageId`, `psid`, `commentId` | per action; unknown or unresolved actions return `{ok:true, type, text:'', items:[]}` so a flow never dead-ends |

- **Data:** conversations keyed `channel='facebook'`, `raw_jid='fb:<pageId>:<psid>'`; lead contacts keyed by the hash of the digits (phone typed, else the PSID); normalizer passes `fb_*` through unchanged.
- **Rules & edge cases:**
  1. `fb_reply_comment`: posts a public reply under `commentId` (else `comment_id` / `post_id` variable) via the Page client; skipped silently unless the workspace plan has the `facebook_comments` feature (the flow still continues) or when the text or target is empty.
  2. `fb_lead`: finds or creates a contact in the workspace (keyed by digits of the phone, else the PSID), sets name, e-mail and note when present, creates a deal when `createDeal` is not false AND the plan has `access_sales_pipeline` (first stage of the default pipeline by `sort_order`, title "<name or Facebook lead> — Messenger", source `facebook`, value 0, owner = the Page's user); skipped quietly when no stage exists. Sends the thank-you DM, mirrors it, and returns the contact id as `{{lead_id}}`.
  3. `fb_products` / `fb_gallery`: a Messenger generic-template carousel of at most 10 elements; title and subtitle cut to 80 characters; the image is used only when it starts with `https://`; a URL starting with `http` becomes the card's default action. Products: Order button is a postback with payload `ORDER_<title, spaces to underscores, 40 chars>`, View is a URL button (label cut to 20); gallery: a URL button only when label and URL are both present; max 3 buttons per card. The Graph call is made directly with messaging type RESPONSE, then mirrored as "[N cards]" / "[N products]"; an empty element list sends nothing.
  4. `fb_to_whatsapp` direct mode (callback): needs workspace, target flow id and a number in the named variable; the target flow must belong to the same workspace; a contact is found or created (name "WhatsApp <digits>", blank country code), then enrolled through the enrolment service with the run's variables. Every failure returns `{ok:true}` and is only logged.
  5. Facebook uses the single-rule Condition evaluator (flat `variable` / `operator` / `value`), the same quirk as Instagram (WD-FLB-067).
  6. QUIRK: lead and deal creation read plan flags and write through model code, not through the deals domain; port through the facades.
- **Async & events:** none beyond the Node runner (FB flow service) and inbox mirroring.
- **External systems:** Facebook Graph API (Messenger Send API, comments) with the Page access token; version from `FacebookPageClient::version()`.
- **Settings:** admin "Enable Facebook Pages" toggle; plan features `facebook_comments`, `access_sales_pipeline`.
- **Acceptance criteria:**
  - Given a gallery of three cards with button label and URL, when the node runs, then the customer receives one carousel of three cards and the inbox shows "[3 cards]".
  - Given Capture lead with `createDeal` on and the sales-pipeline plan, then a contact and a deal titled "<name> — Messenger" exist and `{{lead_id}}` is set.
  - Given a workspace without the `facebook_comments` feature, then Reply to comment posts nothing and the run continues.
  - Given a gallery image URL starting with `http://`, then the card is sent without an image.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`fb_*`), `app/Http/Controllers/Facebook/FacebookFlowNodeController.php`, `node/services/facebookFlowService.js`, `app/Services/Facebook/FbFlowBridge.php`.
- **Port notes:** channel-facebook owns the runner and callbacks; FLB owns the catalogue and inspectors. Gate the palette on a connected Page. Keep carousel limits as shared constants; route lead/deal through the contacts and deals facades.

### WD-FLB-066 — Telegram payment node

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-016
- **Summary:** Charges the customer inside Telegram: either a native invoice (a Pay button in the chat) or a shareable pay-link message, optionally waiting until the payment succeeds before continuing.
- **Actors & access:** workspace admin. Palette group "Telegram", mode `telegram` only; needs a connected bot with a payment provider token (set under Telegram -> the bot's Payments, from BotFather).
- **UX & screens:** inspector case `tg_payment`: info box about the provider token. Fields: **Type** select `mode` (`invoice` "Invoice — a native Pay button in the chat" default / `paylink` "Pay link — a shareable URL sent as a message"); **Title** `title` (default "Order payment"; hint: max 32 chars); **Description** textarea 2 rows (default "Complete your purchase"; `{{vars}}`; sent cut to 255); **Currency** `currency` (default USD, ISO code); **Amount** `amount` (default "9.99", major units, accepts `{{vars}}`); **Line-item label** `label` (default "Total"); paylink only: **Message before the link** `linkText` (default "Tap to pay:"); **Reconciliation id (optional)** `payload` (blank = auto `flow_<flowId>_<chatId>_<timestamp>`, cut to 128); **After sending** checkbox `wait` (default off; "Wait until paid, then continue"; paid amount arrives as `{{paid_amount}}` `{{paid_currency}}`). Output "invoice sent", or "after paid" when `wait` is on. Preview: "Invoice|Pay link" and "<currency> <amount> · <title>".
- **Endpoints:** none of its own. The Telegram webhook (channel-telegram domain) sends the successful-payment signal back to resume a waiting run; the flow callbacks are `api/telegram/flow-log` and `api/telegram/flow-node` (WD-FLB-067).
- **Data:** node `data` `{mode, title, description, label, currency, amount, payload, linkText, wait}`; normalizer passes it through (`Tg_payment`). The runner also accepts `payment` and `invoice` as type aliases.
- **Rules & edge cases:**
  1. The amount is converted to Telegram's smallest unit: multiplied by 100 and rounded, except for currencies in a zero-decimal list (JPY, KRW, VND, CLP, PYG, UGX, RWF, XOF, XAF, IDR) which are sent whole. Open question: IDR is in that list although the hint says so deliberately; confirm against Telegram's currency table before porting (possible 100x error).
  2. No provider token on the bot: the customer is sent "This bot has no payment provider token set — add it under Telegram → the bot's Payments." and the node is skipped. An amount of zero or less is skipped silently.
  3. Invoice mode uses `sendInvoice` (title cut 32, description 255, one price row, label cut 32); pay-link mode uses `createInvoiceLink` and sends `<linkText>\n<link>`.
  4. `wait` on: the run stores `invoice_payload` and parks; ONLY a successful-payment signal (a synthetic reply starting `__tg_paid__`) resumes it through `out`; any other message leaves it parked and is not consumed. `wait` off: the run continues immediately and the payment lands on Laravel's webhook independently.
  5. Reconciliation: Telegram returns the `payload` on the payment; the platform stores it so an order can be matched.
- **Async & events:** parked run; Telegram `pre_checkout_query` and `successful_payment` updates in the Telegram channel domain; resume call into the runner.
- **External systems:** Telegram Bot API (`sendInvoice`, `createInvoiceLink`), a payment provider chosen in BotFather.
- **Settings:** bot payment provider token (per bot, encrypted).
- **Acceptance criteria:**
  - Given invoice mode, USD, amount 9.99, then Telegram receives an invoice for 999 minor units titled "Order payment" and the run continues on `out`.
  - Given `wait` on, then the run does not continue until the paid signal arrives; an ordinary text reply leaves it parked.
  - Given a bot without a provider token, then the customer sees the missing-token message and the run continues.
- **Source refs:** `resources/js/charts/user-flows-builder.js` (`tg_payment`), `node/services/telegramFlowService.js` (payment case, `smallestUnit`, `resumeFlow`), `app/Http/Controllers/Telegram/TelegramFlowNodeController.php`.
- **Port notes:** FLR index marks this "needs the Telegram payment provider". Build behind the channel-telegram domain's payment webhook; implement `wait` as a real wait with a timeout (WaDesk never times out) and fix the currency exponent table from the Bot API's own list.

### WD-FLB-067 — TikTok, LINE, WeChat, Viber and Email flow palettes

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-016
- **Summary:** Five more messaging channels reuse one small shared node set. There are no channel-specific nodes: each channel offers Trigger, Send message, Send media, Quick replies, Ask question, Condition, Wait, Webhook, AI assistant and End, executed by a per-channel Node runner that calls back to Laravel for AI, webhook and inbox mirroring. (Facebook, Instagram and Telegram use the same base set plus their own nodes, WD-FLB-064 to 066.)
- **Actors & access:** workspace admin. Each channel appears in the Trigger's channel picker only when its extension/toggle is on AND the workspace has a connected account (embedded in the page as `data-tt-accounts`, `data-line-channels`, `data-wechat-channels`, `data-viber-channels`, `data-email-accounts`; each item `{key:'<channel>:<rowId>', id, label}`). An existing flow of a channel that is no longer available opens as a WhatsApp flow.
- **UX & screens:** same palette and inspectors as WhatsApp for the shared nodes; the Trigger has a channel select and a sender select per channel (labels: TikTok display name, else @username, else "Account <id>"; LINE display name / basic id / "LINE <id>"; WeChat account name / wx id / "WeChat <id>"; Viber bot name / bot URI / "Viber <id>"; Email mailbox name or address). TikTok, Telegram, LINE, WeChat, Viber and Email show a red "no account selected" hint but no save-time sender check (WD-FLB-018 rule 4).
- **Endpoints:** all `POST`, no route name, token `X-Node-Token` checked in the controller; the route group is `api` for LINE, WeChat, Viber and Email and has NO middleware group for TikTok, Telegram and Facebook (so no throttle or JSON stack, token check only):

| Method uri | Controller@action | Purpose |
| --- | --- | --- |
| POST api/tiktok/flow-log, api/tiktok/flow-node | Tiktok\TiktokFlowNodeController@log, @node | mirror a flow message into the inbox; resolve AI / webhook |
| POST api/line/flow-log, api/line/flow-node | Line\LineFlowNodeController@log, @node | same |
| POST api/wechat/flow-send, api/wechat/flow-node | WeChat\WeChatFlowNodeController@send, @node | Laravel SENDS the message (managed access token) and mirrors it; resolve AI / webhook (no flow-log route) |
| POST api/viber/flow-log, api/viber/flow-node | Viber\ViberFlowNodeController@log, @node | same as LINE |
| POST api/email/flow-send, api/email/flow-log, api/email/flow-node | Mailtrixy\EmailFlowNodeController@send, @log, @node | send through the MailTrixy bridge and mirror; log; resolve AI / webhook |
| POST api/telegram/flow-log, api/telegram/flow-node | Telegram\TelegramFlowNodeController@log, @node | same shape for Telegram |

- **Data:** conversations are keyed `raw_jid`: `tt:<openId>:<convId>`, `line:<channelId>:<userId>`, `wechat:<channelId>:<openid>`, `viber:<channelId>:<userId>`, `email:<accountId>:<mailtrixyConversationId>`, `tg:<botId>:<chatId>`; `channel` equals the channel name. Messages are written as `inbox_messages` with provider = the channel, direction in/out and `meta.<channel>` (message id, source `flow` or `ai`, buttons). Flow `flow_type` and `provider` equal the channel; `trigger_device_id` is the account row id.
- **Rules & edge cases:**
  1. Per-channel rendering by the runner: TikTok sends an image as an image and any other media as a link, renders Quick replies as a numbered text list ("1) ...") and matches a typed number or label; Telegram sends a reply keyboard (max 12 buttons, label 64 chars) and handles media by kind; LINE sends quick-reply items (max 13, label limit) and native media; Viber sends a keyboard (max 12) and picture / video / file messages; WeChat (via Laravel) sends a message menu (items cut to 200 characters) and uploads media; Email (via the MailTrixy bridge) sends the menu as a numbered list in the body, media as a link line, and text as plain plus an HTML copy (the bridge carries only text and HTML), failing when the mailbox is not `connected` or the bridge is not configured.
  2. Ask parks and the next reply is the answer; Quick replies park and the pick is matched by label or 1-based number (not matching = not consumed). Wait is a real in-memory timer (`sleep`) on these runners; units sec / min / hour / day, unknown unit means minutes.
  3. AI node (callback `ai`): provider inferred from the model prefix; system prompt from `system` / `systemPrompt` / `prompt` (default "helpful assistant ... Be concise and friendly"); optional training assistant knowledge base appended; user prompt from `userPrompt` else the last customer message; `maxTokens` default 350, `temperature` 0.7; the reply is sent and saved to the node's `save` variable.
  4. Webhook node (callback `webhook`): URL, method (GET, POST, PUT, PATCH, DELETE, HEAD; default POST), content type (default JSON), headers (key/value) and body all resolve `{{vars}}`; SSRF guard: http(s) only, host must resolve and every resolved IP must be public (private and reserved ranges refused), no redirects, 15 s timeout; the JSON response is saved as text under the `variable` (default `response`) and flattened to dotted keys `response.a.b`. A refused URL returns `ok:false` with no vars.
  5. QUIRK (static reading): Condition evaluators differ by channel. LINE, WeChat, Viber and Email honour the builder's `conditions[]` with AND / OR joins (`operators[]`); TikTok, Telegram, Instagram and Facebook use an older single-rule evaluator reading flat `variable` / `operator` / `value` from node data, which the builder never writes (it saves `conditions[]`). Their default is "contains" with an empty comparison, which is always true: those Condition nodes always take `yes`. Verify live, then fix in the rebuild by using one evaluator for all channels.
  6. Runner coverage is exactly: message, media, buttons, ask, delay, condition, webhook, ai (and the channel alias `tt_ai`, `line_ai`, `wechat_ai`, `viber_ai`, `email_ai`, `tg_ai`), end. Any other node type is skipped with a loud warning; the walk limit is 100 nodes.
  7. The per-channel `*_flow_sessions` tables exist (`line_`, `telegram_`, `viber_`, `wechat_flow_sessions`) but sessions are held in Node memory; the tables are dead (WD-FLR-070).
- **Async & events:** Node runner per channel; inbound webhooks and flow starts are in each channel's domain.
- **External systems:** TikTok Business Messaging API, LINE Messaging API, WeChat custom-message API, Viber Bot API, MailTrixy e-mail bridge.
- **Settings:** admin channel toggles; per-channel credentials (bot token, channel secret, access token, bridge secret).
- **Acceptance criteria:**
  - Given a TikTok flow with Quick replies "Yes", "No", then the customer receives the prompt followed by "1) Yes" and "2) No", and replying "2" takes port `p1`.
  - Given an Email flow and a mailbox that is not connected, then `flow-send` answers `{ok:false, error:'account not connected'}` and nothing is sent.
  - Given a Webhook node pointing at a private IP, then no request is made and the run continues without the variable.
  - Given a LINE flow with a two-rule Condition joined by OR, then the `yes` port is taken when either rule holds.
- **Source refs:** `app/Http/Controllers/{Tiktok,Line,WeChat,Viber,Mailtrixy,Telegram}/*FlowNodeController.php`, `node/services/{tiktok,line,wechat,viber,email,telegram}FlowService.js`, `resources/js/charts/user-flows-builder.js` (`MSG_CHANNELS`, `flowTypeOf`).
- **Port notes:** channel adapters belong to the respective channel domains (provider-port architecture); FLR renders by channel kind. FLB keeps the availability rule (connected account required), the Trigger sender picker and the palette matrix. Use one Condition evaluator and one webhook/AI executor for every channel instead of seven copies.

### WD-FLB-068 — Natural-language ordering endpoints for flows

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** L (<=2 weeks) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-040
- **Summary:** Five node-callback endpoints that turn a customer's free-text, voice or photo order into a held cart, collect a delivery address, and confirm or cancel the order, in the customer's own language. There is no dedicated "ordering node": the feature is a recipe of Webhook nodes calling these URLs inside an ordinary flow.
- **Actors & access:** called by Webhook nodes through the Node runtime with `X-Node-Token`; the flow author must put that header in the Webhook node's headers (the demo seeder bakes the platform token into the flow). Needs products with stock, the AI keys, and (for group posts) synced WhatsApp groups. Unofficial engine only in practice.
- **UX & screens:** none of its own; the recipe the demo seeder builds is: Trigger (keyword `order`) -> Webhook `order-parse` (save `parse`) -> Message `{{parse.summary}}` -> Ask (confirm / cancel) -> Condition (answer contains "confirm") -> Webhook `order-confirm` -> Message `{{confirmed.summary}}` / Webhook `order-cancel` -> Message -> End.
- **Endpoints:** (`api` group, `X-Node-Token`)

| Method uri | Route name | Controller@action | Request | Response |
| --- | --- | --- | --- | --- |
| POST api/flow-node/order-parse | api.flow-node.order-parse | FlowNodeActionsController@orderParse | `workspace_id` int req; `customer_phone` req max 32; `text` null max 4000 (null for voice / photo); `group_code` max 48; `model` max 120 (default gpt-4o-mini) | `{ok:true, ref, has_items, order_ok:'yes'|'no', items[], unavailable[], total_minor, currency, saved_shipping, summary, ask_shipping, set_user_message}` |
| POST api/flow-node/order-shipping | api.flow-node.order-shipping | FlowNodeActionsController@orderShipping | `workspace_id`; `customer_phone`; `text` max 2000; `use_saved` bool; `model` | `{ok:true, shipping}`; 422 `no_saved_address` / `empty_address` |
| POST api/flow-node/order-confirm | api.flow-node.order-confirm | FlowNodeActionsController@orderConfirm | `workspace_id`; `customer_phone`; `ship_text` max 2000; `notify_group` bool (default true); `model` | `{ok:true, order_id, total_minor, currency, summary}`; on failure HTTP 200 `{ok:false, error, summary:<localised apology>}` |
| POST api/flow-node/order-cancel | api.flow-node.order-cancel | FlowNodeActionsController@orderCancel | `workspace_id`; `customer_phone`; `text` (for language) | `{ok:true, summary, released}` |
| POST api/flow-node/order-reply | api.flow-node.order-reply | FlowNodeActionsController@orderReply | `workspace_id`; `customer_phone`; `text`; `notify_group` | `{ok:true, intent:'confirm'|'cancel'|'unclear', order_id?, summary}` |

- **Data:** reads `wa_products`, writes `wa_pending_orders` (one pending cart per workspace + phone: `ref`, `items_json`, `unavailable_json`, `total_minor`, `currency_code`, `group_code`, `status` pending / confirmed / cancelled, `customer_lang`, ship name / company / address, original voice or photo path and transcript, `expires_at`), `wa_stock_reservations`, and on confirm `wa_orders` (source `whatsapp_ai`, status `pending`) with `wa_order_items`.
- **Rules & edge cases:**
  1. `order-parse`: first releases the customer's previous held cart; for a voice note or photo the saved inbound media is resolved (voice transcribed and used as the text, photo sent to a vision model); the model returns `{items:[{name,qty}]}`; each item is matched to a product (not found -> `unavailable` reason `not_found`); stock is HELD per matched item (not enough -> `out_of_stock` with availability); the cart is saved with expiry 30 minutes (hold TTL 1800 s). The summary and the address prompt are localised into the customer's language; with nothing matched, a localised "what is available" list is appended. `set_user_message` returns the transcript so later AI nodes see the real text.
  2. `order-shipping` / `order-confirm`: the customer's reply is interpreted by AI (no word lists): the saved address (YES / "same"), or a new Name / Company / Address; `use_saved` short-circuits. `order-confirm` saves the address then finalises: creates the order and items, commits the stock holds, marks the cart confirmed. No pending cart gives `{ok:false, error:'no_pending_order'}` (HTTP 200 with an apology summary).
  3. Group post: with `notify_group` not false the confirmed order is posted into the customer's WhatsApp group with an @mention after the response is sent. `order-confirm` posts when the group is resolved by code, single, or ambiguous (freshest shared group); `order-reply` posts only for code or single. QUIRK: the two endpoints disagree on ambiguous groups.
  4. `order-reply`: one endpoint that decides confirm / cancel / unclear from the translated reply; unclear re-asks without cancelling; cancel releases stock; confirm places the order; the message is localised.
  5. `order-cancel` always answers ok with a localised confirmation (an earlier version returned an empty summary and the customer saw a blank bubble).
  6. QUIRK: the inbound pipeline finds "the workspace's order flow" for stray voice / photo messages by scanning every published, active flow's decrypted graph for the string `/api/flow-node/order-parse`; feature activation is implicit in having built that webhook.
  7. QUIRK / SECURITY: the platform-wide node token is typed into the Webhook node's header inside the flow graph, visible to any workspace admin who opens the flow and exportable in the flow `.json`.
- **Async & events:** stock holds released by a sweep on expiry; group post deferred to after the response; order events feed deals / notifications in their domains.
- **External systems:** LLM provider (JSON extraction, intent, translation), a translation fallback, the WhatsApp group notifier.
- **Settings:** AI keys, product catalogue and stock, group directory sync; hold TTL constant 30 minutes.
- **Acceptance criteria:**
  - Given products "Wings" (stock 10) and a text "5 wings", when `order-parse` runs, then the cart holds 5 units, `order_ok` is `yes` and the summary lists them with the total.
  - Given the customer replies CONFIRM to `order-reply`, then an order of source `whatsapp_ai` exists, the holds are committed and the summary says the order is placed.
  - Given a reply that is neither confirm nor cancel, then the cart is untouched and a re-ask is returned.
  - Given a request without the token header, then every endpoint answers 401.
- **Source refs:** `app/Http/Controllers/FlowNodeActionsController.php` (`orderParse`, `orderShipping`, `orderConfirm`, `orderCancel`, `orderReply`), `app/Services/Ordering/*.php` (`OrderingService`, `InventoryService`, `ProductMatcher`, `OrderMediaResolver`, `GroupDirectory`, `GroupNotifier`), `database/seeders/JessicaDemoSeeder.php`, `app/Http/Controllers/WaInboundController.php` (`orderFlowIdForWorkspace`), `node/services/flowService.js` (webhook executor `set_user_message`).
- **Port notes:** FLR index: voice and photo orders and the group post sit behind `ORDER_MEDIA_PORT` and `ORDER_GROUP_NOTIFY_PORT`; the ordering domain (catalog / e-commerce) owns the service. Replace the Webhook recipe with a first-class "Order" node or an internal action, remove the baked token (internal call, no HTTP), key the pending cart by run id, and make the order-flow lookup an explicit setting.

### WD-FLB-069 — Node-bridge support endpoints (WABA creds, voice keys, call bridge)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** none
- **Summary:** The shared-secret endpoints the Node runtime and the WhatsApp call bridge use to borrow what only Laravel can decrypt or write: WABA access credentials, voice (STT/TTS/LLM) keys, a voice assistant's configuration, and call-state updates from the bridge (accepted, error, transcript turns, outbound offer). They are not browser features; they define the Laravel side of the bridge contract.
- **Actors & access:** the Node bridge only. Every call carries `X-Node-Token` compared with `hash_equals` against `node_token()` (system setting `node_webhook_token`, else `baileys_callback_token`, else env `NODE_WEBHOOK_TOKEN`); an empty configured token rejects everything with 401 `unauthorized`. No workspace session, no per-workspace credential.
- **UX & screens:** none.
- **Endpoints:** (all `api` group)

| Method uri | Route name | Controller@action | Request | Response |
| --- | --- | --- | --- | --- |
| GET api/waba-creds | api.waba-creds | FlowNodeActionsController@wabaCreds | `workspace_id` int req | `{ok, access_token, phone_number_id, waba_id, graph_version}`; 404 `no_waba_config` |
| GET api/waba-call/voice-keys | api.waba-call.voice-keys | FlowNodeActionsController@wabaCallVoiceKeys | `workspace_id` int req | `{ok, deepgram, openai, elevenlabs}` (raw keys, blank when absent) |
| GET api/waba-call/assistant/{id} | api.waba-call.assistant | FlowNodeActionsController@wabaCallAssistant | `workspace_id` (query or body) req | `{ok, assistant:{id,name,ai_provider,ai_model,ai_system_prompt,voice_provider,voice_id,stt_provider,natural_conciseness,exit_keywords,last_greeting,greeting_text,record_agent,record_user,meta,tools[]}}`; 400 `workspace_required`; 404 `not_found` |
| POST api/waba-call/bridge-accepted | api.waba-call.bridge-accepted | FlowNodeActionsController@wabaCallBridgeAccepted | `wa_call_id` int req; `meta_call_id` max 128; `assistant_id` int | `{ok:true, claimed}` |
| POST api/waba-call/bridge-error | api.waba-call.bridge-error | FlowNodeActionsController@wabaCallBridgeError | `wa_call_id` req; `meta_call_id`; `reason` max 500 | `{ok:true}`; 404 `call_not_found` |
| POST api/waba-call/transcript-turn | api.waba-call.transcript-turn | FlowNodeActionsController@wabaCallTranscriptTurn | `wa_call_id` req; `role` in agent, user; `text` req max 6000; `t_ms` int | `{ok:true}`; 404 `call_not_found` |
| POST api/waba-call/bridge-offer | api.waba-call.bridge-offer | FlowNodeActionsController@wabaCallBridgeOffer | see WD-FLB-054 | see WD-FLB-054 |

- **Data:** reads `wa_provider_configs` (encrypted credentials JSON plus `meta_json`), `ai_call_assistants` + `tools`, the AI key store (`AiKeyResolver`); writes `wa_calls` (status, `answered_at`, `handler_type`, `handler_agent_id`, `end_reason`, `error_payload`, `ended_at`) and `wa_call_events` (event types `bridge_accepted`, `bridge_error`, `transcript_turn` with payload and `received_at`).
- **Rules & edge cases:**
  1. `waba-creds`: configs of the workspace's `waba` provider are ordered connected first, then primary, then most recently connected; the first one that has BOTH an access token and a phone number id wins. The phone number id and WABA id come from the credentials, else from `meta_json`. QUIRK: when none is complete it still returns HTTP 200 `ok:true` with the first config and blank strings; callers must check for non-empty fields. `graph_version` is env `META_GRAPH_VERSION` (default v21.0). The log line records only lengths and the source, not the token.
  2. `voice-keys`: each provider (deepgram, openai, elevenlabs) resolves workspace key first, then admin key, then none; the raw secrets travel in the response (the node needs them). The log records a masked fingerprint (first 3 and last 3 characters plus length); QUIRK: that is 6 characters of every key in the application log.
  3. `assistant/{id}`: the lookup is workspace scoped (a valid token plus a guessed id cannot read another tenant's assistant). Recording flags: `record_agent` / `record_user` are the assistant's own toggles (default true); the plan gate was removed so recording is always available. Each tool exposes function name, trigger keywords, HTTP method, URL, headers and parameter schema.
  4. `bridge-accepted`: a transaction locks the `wa_calls` row; only a row in `ringing` flips to `active` (answered now, handler type `ai_agent`, handler agent = the assistant); a second call, or a call after an operator accepted, returns `claimed:false`. Idempotent.
  5. `bridge-error`: only `ringing` or `connecting` rows become `failed` (end reason `BRIDGE_ERROR`, reason stored in `error_payload`); other states are left alone; an event is always written.
  6. `transcript-turn`: appended as events so the call log can show the transcript live; `wa_calls` is not modified.
  7. None of these routes check the workspace of the call for `bridge-*` / `transcript-turn` (they trust the call id): a leaked token can write events on any call.
- **Async & events:** call state changes drive the call-logs UI; the AI-fallback timer in the calling domain re-locks the call row before acting.
- **External systems:** none directly (Meta and the STT/TTS vendors are called by the bridge).
- **Settings:** `node_webhook_token` / `baileys_callback_token`, `META_GRAPH_VERSION`, workspace and admin AI keys.
- **Acceptance criteria:**
  - Given two WABA configs where only the second has a token and phone number id, when `waba-creds` is called, then the second config's values are returned.
  - Given a call in `ringing`, when `bridge-accepted` is called twice, then the first returns `claimed:true` and the call is `active`, the second returns `claimed:false`.
  - Given a request without or with a wrong token, then every endpoint answers 401 `unauthorized`.
  - Given an assistant id from another workspace, then `assistant/{id}` answers 404 `not_found`.
- **Source refs:** `app/Http/Controllers/FlowNodeActionsController.php` (`wabaCreds`, `wabaCallVoiceKeys`, `wabaCallAssistant`, `wabaCallBridgeAccepted`, `wabaCallBridgeError`, `wabaCallTranscriptTurn`, `wabaCallBridgeOffer`, `authed`), `app/Support/fc_helpers.php` (`node_token`), `app/Services/AiKeyResolver.php`, `node/services/wabaCallBridge.js`, `node/services/flowService.js` (`executeWaFormNode` calls `waba-creds`).
- **Port notes:** the node-bridge-runtime and calling domains own these routes (shared with this file; see Cross-domain contracts). In this repo the runtime runs in the worker and calls facades directly, so most of the secret-carrying hops disappear; if a separate media bridge process remains, authenticate it with a per-service token, scope every call by org, never return raw provider keys when the bridge can be given a short-lived scoped credential, and drop the key fingerprint logging.

### WD-FLB-070 — Runtime flow fetch and FlowNormalizer contract

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-019
- **Summary:** How a saved flow reaches the runtime. The Node bridge fetches `GET /api/flows/{id}` with the shared secret; Laravel decodes the builder graph and `FlowNormalizer` rewrites it into the runtime's vocabulary: PascalCase node types, flat node fields, and 1-based numbered output ports. The mapping tables here are the contract between the editor and the executor.
- **Actors & access:** the Node bridge (token). No session, no workspace scope.
- **UX & screens:** none.
- **Endpoints:**

| Method uri | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| GET api/flows/{id} | api.flows.show | FlowsController@nodeShow | api (X-Node-Token) | route `id` (numeric) | `{success:true, data:{flow:{id, flow_name, user_id, is_published}, flow_data:{flowNodes, flowEdges, vars, workspace_id}}}`; 401 `{success:false, message:'unauthorized'}`; 404 `{success:false, message:'Flow not found'}` |

- **Data:** input is `flows.flow_data` decoded (`flowNodes[{id,type,x,y,data,isStart}]`, `flowEdges[{id,source,sourceHandle,target}]`, `vars`). `workspace_id` is added to the payload (the flow's own, else the owner's current workspace) so runtime callbacks can scope themselves.
- **Rules & edge cases:**
  1. Authentication: token header compared with `hash_equals`; an unconfigured token rejects. QUIRK: the lookup is `Flow::find` with NO workspace, published or active check, so the runtime will serve (and run) a draft or paused flow if asked; the runtime-side callers are expected to have done those checks.
  2. Start node: the node with `isStart` moves to index 0, else the first Trigger, else the stored order (the runtime walks from index 0).
  3. Node shaping: the original React node is kept whole and `flowNodeType` plus flat fields are layered on. Unmapped types keep an existing `flowNodeType` or become `ucfirst(type)` (so `ig_*`, `fb_*`, `tg_payment`, `cf_assistant`, `end` and `trigger` pass through; `trigger` and `end` are intentionally unmapped: the runtime starts at index 0 and ends on an unknown type). The type map is: message and sequence -> `Message`; media -> `Media`; notify_number -> `NotifyNumber`; wa_to_instagram -> `WaToInstagram`; google_meet -> `GoogleMeet`; wa_form -> `WaForm`; template -> `Template`; buttons -> `InteractiveButtons`; list -> `List`; ask -> `Question`; condition -> `Condition`; delay -> `TimeDelay`; webhook -> `Webhook`; code -> `Code`; cf_say, cf_listen, cf_ai, cf_menu, cf_search, cf_transfer, cf_hangup -> `CallSay`, `CallListen`, `CallAI`, `CallMenu`, `CallSearch`, `CallTransfer`, `CallHangup`; mysql -> `MySQL`; subflow -> `SubFlow`; assign -> `AssignAgent`; tag -> `TagContact`; whatsapp_shop, woocommerce, shopify -> `CommerceShop` (with `provider` = the original type); ai -> `ChatGPT`; cta -> `CTA`; location -> `Location`; poll -> `Poll`; chatbot -> `Chatbot`; book_appointment -> `BookAppointment`; ai_call -> `AiCall`; google_sheets -> `GoogleSheets`; google_docs -> `GoogleDocs`; google_form -> `GoogleForm`; deal -> `Deal`.
  4. Field shaping per node type (only fields the executor reads are lifted; everything else stays in `data`): `message` gets `flowReplies[{flowReplyType:'Text', data}]`; `sequence` gets one reply per entry (types text, image, video, audio, document; unknown becomes Text; media entries carry an absolute URL plus filename and caption); `media` gets `mediaKind`, `mediaUrl` (tolerant of `url`, `mediaUrl`, `fileUrl`, `media`, `file`; made absolute), `mediaCaption`, `mediaFilename`, `mediaMimetype`; `template` is hydrated (name, id, body, header, footer, language, category, buttons, variable map; looked up by the stored row id, else by decrypted name preferring approved, newest first; unknown template gives `templateId` null and an empty body); `list` and `buttons` get `bodyText` (the prompt; header left empty to avoid a duplicate line), list `buttonText` (default "View options"), `listItems` with ids `p<i>` (title 24, description 72, section 24) or `buttons[{id:'p<i>', title}]`, and `variable` (default `choice`); `ask` gets `question`, `variable` (default `answer`), `acceptMedia`, `expectedAnswers[]` (trimmed non-empty); `condition` gets `conditions[]` (variable, operator default `equals`, value), `logicOperators[]` (`OR` or `AND`) and flat `variable` / `operator` / `compareValue` of the first rule (legacy single-rule `var` / `op` / `value` is promoted to one rule); `delay` gets `delaySeconds` (sec = 1, min = 60, hour = 3600, day = 86400; any other unit counts as minutes; amount cast to int, default 5); `webhook` gets `method` (upper-cased), `url`, `body`, `variable` (default `response`), `contentType`, `headers[{key,value}]` with empty keys dropped; `code` gets `code` and `variable` (default `result`); `mysql` gets host, port (int, default 3306), database, username, password, sql, `variable` (default `rows`); `subflow` gets `flowId`; `assign` gets `teamId`, `userId`, `noteForAgent`; `tag` gets `action` (add or remove), `tagId`, `tag`; commerce nodes get `provider`, `storeId`, header / body / footer text, `abandonedWaitMinutes` (int, default 5) and `productItems` (hydrated snapshots, legacy `productIds[]` / `product` migrated, empty ids dropped, at most 30); `ai` gets `model` (default gpt-4o-mini), `prompt`, `variable` (default `reply`), `assistant_id` (null when 0), `extract`, `silent`, `conversational`, `exit_keyword`, `fields[]` (comma string or list normalised), optional numeric `temperature` and `maxTokens`; `cta` gets `ctaActions[]` (at most 3, types url, phone, call_now, copy; unknown becomes url; legacy single shape migrated), header / body / footer text and flat first-action fields (`ctaType`, `ctaLabel` default "Visit", `ctaUrl` with `tel:` for phone, `ctaPhone`, `ctaCode`); `location` gets float `latitude` / `longitude`, `address`, `title`; `poll` gets `question`, `options`, `allowMultiple`; `chatbot` gets `agentId` and `botId`; and the nodes of WD-FLB-053 to 062 as documented in their entries. Variable names are cleaned: one surrounding `{{ }}`, a leading `@` and whitespace are stripped (so `{{name}}`, `@name` and ` name ` all save under `name`); an empty result falls back to the default.
  5. Edges: every edge becomes `{id, sourceNodeId:'<source>_<port>', targetNodeId:'<target>_1', sourceHandle, source, target}`. Port numbering: `p<i>` -> i + 1; `else` -> 0 (its own port so an unmatched reply can never share port 1 with the first option); condition yes = 1, no = 2; book_appointment booked = 1, no_slots = 2; the three commerce nodes purchased = 1, abandoned = 2; google_form submitted = 1, timeout = 2; deal created = 1, error = 2; anything else including `out` = 1. The original handle names stay on the edge, which is what the social and call runners read.
  6. Media paths are made absolute with the app URL; values containing `{{` are left untouched so a variable URL is not encoded.
  7. QUIRK: `template_name` is an encrypted column, so template resolution by name decrypts and compares every template row in PHP on every fetch.
  8. The normalizer never validates: a malformed node is passed on and the runtime skips an unknown type with a warning.
- **Async & events:** none (read-only), called when a run starts or resumes.
- **External systems:** none.
- **Settings:** the node token (WD-FLB-069), app base URL for absolute media.
- **Acceptance criteria:**
  - Given a Condition node with edges from `yes` and `no`, then the normalized edges have source node ids `<id>_1` and `<id>_2`.
  - Given a Buttons node with options A and B, then the normalized node has buttons with ids `p0` and `p1` and edges from `p1` map to port 2.
  - Given an Ask node with an edge from `else`, then that edge maps to port 0.
  - Given a request without the token, then the endpoint answers 401.
  - Given a Delay node of 2 hours, then `delaySeconds` is 7200.
- **Source refs:** `app/Services/Flows/FlowNormalizer.php` (`TYPE_MAP`, `PORT_MAP`, `normalize`, `normalizeNode`, `normalizeEdge`, `handleToPort`, `cleanVar`, `absoluteUrl`), `app/Http/Controllers/FlowsController.php` (`nodeShow`), `node/controllers/flowController.js`.
- **Port notes:** Owned by FLR, built there (see wiring map): WD-FLR-013 `compileGraph` (pure, unit-tested) replaces both the HTTP fetch and `FlowNormalizer`; the worker reads the graph from the flow row and snapshots it into the run. What the editor side keeps: saving `flowNodes` / `flowEdges` / `vars` with `type`, `data`, `sourceHandle` exactly as above (the editor must save the vocabulary `compileGraph` reads), the shared `portsFor(node)` and the type matrix in `@crm/contracts`, and a save-time check that every edge handle is a port the node actually has. Keep the `else` = port 0 rule, and keep the hydrated template / product snapshot idea but take it at publish time, not on every fetch.

### WD-FLB-071 — Audience and event enrolment (FlowEnrollmentService)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-020
- **Summary:** The single door through which a contact enters a flow for every non-keyword trigger: tag added, group joined, contact created, opt-in, order placed, deal moved to a stage, away, out of hours, manual enrol and the REST API. It records the (flow, contact) pair as a subscriber and asks the Node runtime to start the run.
- **Actors & access:** internal service. Triggered by model hooks and controllers (below) and by the public API; no permission keys.
- **UX & screens:** none (the visible result is a subscriber row, WD-FLB-073).
- **Endpoints:** none of its own. Callers: contact tag attach (single and bulk) in the contacts controller; conversation tagging in the team inbox and in the routing engine; the Contact model events (created, group membership, un-subscribe flag flip); the WaOrder model (new order); the Deal model observer (stage change); keyword reply dispatch and the auto-reply controller (inbound condition triggers); the keyword flow path and the lead webhook controller; the Facebook hand-off callback; `POST flows/{id}/enroll` and `POST api/v1/flows/{id}/enroll` (WD-FLB-072); the retry service (WD-FLB-077).
- **Data:** reads `flows` (`is_active`, `is_published`, `trigger_kind`, `trigger_value`, `workspace_id`, `trigger_device_id`, `provider`), `contacts`, `devices`, `wa_provider_configs`, `workspaces`; writes `flow_subscribers` (`status`, `enrolled_at`, `failed_at`, `failure_reason`).
- **Rules & edge cases:**
  1. `enroll(contact, flow, variables)`: the contact must belong to the flow's workspace (else an exception "Contact not in flow workspace."). A subscriber row is created if absent (unique on flow + contact). Only a NEW row or a `failed` one is (re)launched: status reset to `active`, failure fields cleared, then launch. An existing `active`, `paused` or `completed` subscriber is a no-op, so a contact enters a given flow once, ever (QUIRK: a completed contact can never be re-triggered by tag or group, and `completed` is never written anyway, WD-FLB-074).
  2. Meta Business Agent coexistence: when the workspace's AI responder mode says Meta's agent is fronting the account (`suppressesOurAutoReply`), the subscriber is recorded as `active` but nothing is launched (QUIRK: that row stays `active` forever, appears in analytics as running).
  3. Launch resolves the sender for the workspace engine. Unofficial (Baileys): `trigger_device_id` is used only when the flow's provider is `baileys` (or empty) and that device is active and in the workspace (QUIRK: the column is polymorphic, an unguarded lookup would match an unrelated device with the same id); else the lowest-id device that is active AND connected; else the lowest-id active device. Other engines (WABA, Twilio): the workspace's primary connected provider config number. No sender: subscriber `failed` with "No connected <engine> sender for this workspace".
  4. Recipient = canonical phone of country code + mobile (the helper only prefixes the country code when the stored number does not already start with it; a raw concatenation doubled the prefix). Empty: `failed` "Contact has no usable mobile number".
  5. Node URL = system setting `baileys_server_url`, else env `SERVER_URL`; missing: `failed` "Node bridge URL not configured". The request is `POST <node>/api/flow/start/<sender digits>` with `X-Node-Token`, 15 s timeout, body `flowId`, `targetPhoneNumber`, `flowSubscriberId`, `provider`, `name`, `first_name`, `email`, `variables`. A non-2xx answer marks `failed` with "Node <status>: <first 150 chars of the body>"; a transport error with "Node unreachable: <150 chars>". The Node bridge does NOT read `flowSubscriberId`, so nothing after launch ever updates the subscriber.
  6. Trigger lookup: active AND published flows with the kind and value in the contact's workspaces (the contact owner's workspaces plus their current one) for contact-keyed events, or the event's own workspace for order, deal and inbound events. Values: tag id (tag), group id (group), destination stage id (deal), 0 for contact_created, opt_in, order_placed, away and out_of_hours.
  7. Events: `onTagAdded`; `onConversationTagged` (the conversation's JID digits are matched to a contact of the conversation's workspace by scanning decrypted numbers; no contact, nothing); `onGroupJoin` (per group id on create and on update); `onContactCreated`; `onOptIn` (unsubscribed true -> false); `onOrderPlaced` (the order's customer phone resolved to a saved contact, none = skipped; passes variables `name`, `first_name`, `email`, `order_number`, `order_name`, `total`, `total_price`, `currency`, `status`, `invoice_url`, `order_url`, `payment_link`, empty ones dropped); `onDealStageChanged` (deal must have a contact); `onInboundMessage` (see 8).
  8. Inbound-condition triggers: on any inbound message, the workspace's two booleans are read first (fast path: not away and in hours returns immediately). `away` is eligible when the workspace Away flag is on; `out_of_hours` when outside business hours (missing config = open). The contact is resolved by phone or a minimal contact is created (name = the digits). Because enrolment is once-only, each contact launches an away / out-of-hours flow once.
  9. Failures in hooks are swallowed and logged so tagging, contact creation or order creation never fails because of a flow.
- **Async & events:** synchronous HTTP to the Node bridge inside the triggering request (15 s worst case on a hook path); a log line per failure.
- **External systems:** Node bridge `/api/flow/start/{phone}`.
- **Settings:** `baileys_server_url`, `SERVER_URL`, node token, workspace Away flag, business hours, AI responder mode.
- **Acceptance criteria:**
  - Given a live tag-trigger flow for tag T, when T is attached to a contact, then exactly one subscriber exists and the run is requested; attaching T again changes nothing.
  - Given the workspace has no connected sender, when a contact is enrolled, then the subscriber is `failed` with the missing-sender reason.
  - Given a draft (unpublished) flow, then no event enrols a contact into it.
  - Given an order placed by a phone with no saved contact, then no subscriber is created.
  - Given the workspace is in Away mode and an unknown number writes in, then a contact is created and the away flow starts once.
- **Source refs:** `app/Services/Flow/FlowEnrollmentService.php`, `app/Models/Contact.php`, `app/Models/Deal.php`, `app/Models/WaOrder.php`, `app/Http/Controllers/ContactsController.php`, `app/Http/Controllers/TeamInboxController.php`, `app/Services/Inbox/RoutingEngine.php`, `app/Services/Inbox/KeywordReplyDispatcher.php`, `app/Http/Controllers/AutoReplyController.php`, `app/Http/Controllers/IncomingWebhookController.php`, `app/Models/FlowSubscriber.php`.
- **Port notes:** Owned by FLR, built there (see wiring map): WD-FLR-001, 005, 006, 007 and 011 (`FlowTriggerService`, `FlowTriggerEventsConsumer` on outbox events `contact.created`, `contact.tag_added`, `contact.group_added`, `contact.opt_in`, `deal.stage_changed`, `order.placed`, `FlowLaunchService.start` writing a `flow_runs` row for every path). What the editor side keeps: writing `trigger_kind`, `trigger_value` (tag / group / stage id) and the sender column at save (WD-FLB-020) so the trigger lookup stays an indexed query, and producing the events its own domains own. Known gaps from the wiring map: no producer yet for `contact.opt_in` re-subscribe or `order.placed`; do not bring back the HTTP launch, the polymorphic device column or the once-ever re-entry rule without a decision.

### WD-FLB-072 — Manual enrolment (UI and API)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-071
- **Summary:** Operators start a flow for a whole contact group from the flows list, or integrations enrol a single contact by id or phone through the REST API. Both go through the enrolment service.
- **Actors & access:** web: workspace admin. API: an API key of the workspace (`AuthenticateApiKey`, plan rate limit).
- **UX & screens:** on the flows list card of a `manual_enroll` flow the "Open builder" button is replaced by **Enroll contacts**. It opens the browser's native prompt "Enter the group name as it appears in /contact-groups" (free text; cancel or empty does nothing), POSTs `{group_name}`, then toasts "Enrolled N contact(s)" with ", M failed" when any failed, and refreshes the grid. Errors toast the server's `error` or "Enrollment failed".
- **Endpoints:**

| Method uri | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| POST flows/{id}/enroll | user.flows.enroll | FlowsController@apiEnroll | web, Authenticate, EnsureWorkspaceRole:admin | `contact_ids[]` int; `group_name` string max 191 (both optional) | `{ok:true, enrolled, failed}`; 404 `{ok:false, error:'flow_not_found'}`; 422 `{ok:false, error:'flow_inactive'}` |
| POST api/v1/flows/{id}/enroll | api.v1.flows.enroll | Api\V1\FlowController@enroll | api, AuthenticateApiKey, ApiPlanRateLimit | `contact_id` int (required without phone); `phone` string max 32 (required without contact_id) | 201 `{data:{flow_id, contact_id, subscriber_id, status, enrolled_at}}`; 404 `not_found` / `contact_not_found`; 422 `flow_inactive` / `enroll_failed` |

  Related read routes of the same API controller: `GET api/v1/flows` (the workspace's flows, most recently updated first, each `{id, name, trigger, status (draft, paused, live), category, subscribers_count, created_at, updated_at}`, with `meta.count`) and `GET api/v1/flows/{id}` (one flow, 404 `not_found`).

- **Data:** writes `flow_subscribers` through the enrolment service; reads `contacts` (group membership is an encrypted JSON array of group names on the contact).
- **Rules & edge cases:**
  1. Web: the flow must exist in the workspace and be `is_active`. QUIRK: `is_published` is not checked, so a draft flow can be enrolled into; and the route does not check that the trigger kind is `manual_enroll` (any flow can be enrolled by calling it).
  2. Web contact selection: `contact_ids` (only contacts in the flow's workspace) take precedence; otherwise `group_name` is compared exactly and case-sensitively with each workspace contact's group names, filtered in PHP. Neither given means zero contacts and `{ok:true, enrolled:0, failed:0}`. No UI sends `contact_ids`.
  3. Each contact is enrolled one by one inside a try/catch; an exception counts as `failed`, a duplicate (already a subscriber) counts as `enrolled` (the enrolment service returns the existing row), so "enrolled" is not "launched".
  4. API: `contact_id` is looked up in the flow's workspace; otherwise `phone` (digits) is compared with each contact's country code + mobile concatenation, decrypted in PHP; no match is 404. The response reports the subscriber as it is (`active`, `failed`, or an existing status) and always 201.
  5. No limit on how many contacts a group enrol covers; the call is synchronous and each launch is a 15-second HTTP call to the Node bridge in the worst case.
- **Async & events:** as WD-FLB-071.
- **External systems:** Node bridge via the enrolment service.
- **Settings:** API plan rate limit.
- **Acceptance criteria:**
  - Given a `manual_enroll` flow and a group "VIP" of 3 contacts, when an admin enters "VIP", then the response is `{ok:true, enrolled:3, failed:0}` and the grid refreshes.
  - Given the flow is paused (`is_active` false), then the endpoint answers 422 `flow_inactive`.
  - Given an API call with a phone that matches no contact, then the response is 404 `contact_not_found`.
  - Given an API call with neither `contact_id` nor `phone`, then validation rejects it.
- **Source refs:** `app/Http/Controllers/FlowsController.php` (`apiEnroll`), `app/Http/Controllers/Api/V1/FlowController.php` (`enroll`, `resolveContact`), `app/Http/Requests/Api/V1/Flow/EnrollFlowRequest.php`, `resources/js/charts/user-flows-index.js` (enroll handler), `resources/views/user/flows/_cards.blade.php`.
- **Port notes:** Owned by FLR, built there (see wiring map): WD-FLR-008 `POST /v2/flow-runtime/flows/:flowId/enroll` (`contactIds[]` or `groupId`, up to 500, 422 `FLR_FLOW_INACTIVE`, a contact already in the flow counted not launched, permission `flr.runs.manage`) and WD-FLR-009 `POST /public/v1/flows/:id/enroll` (`{contactId}` or `{phone}`, 201 with the subscriber as it is, 404 `FLR_CONTACT_NOT_FOUND`, 422 `FLR_FLOW_INACTIVE`). What the editor side keeps: the flows-list "Enroll contacts" action, rebuilt as a proper dialog with a group picker (ids, not typed names) and contact search that calls the FLR endpoint; show only on `manual_enroll` flows and require the flow to be live (published and active).

### WD-FLB-073 — Subscribers list and pause / resume

- **Status:** partial
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-071
- **Summary:** JSON endpoints that list who is inside a flow with counts by status and let an operator hold or release one contact's place. Partial because no screen calls them: the flow detail panel they were written for does not exist, and the counters they feed are only as true as the data (see WD-FLB-074).
- **Actors & access:** workspace admin (`/flows/*` routes); the REST API exposes the list to API keys.
- **UX & screens:** none in the reference app (no caller found in the views or scripts).
- **Endpoints:**

| Method uri | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| GET flows/{id}/subscribers | user.flows.subscribers | FlowsController@apiSubscribers | web, Authenticate, EnsureWorkspaceRole:admin | none | `{ok, counts:{active,paused,completed,failed}, trigger_kind, subscribers:[{id, contact_id, contact_name, contact_phone, status, enrolled_at, failed_at, failure_reason}]}`; 404 `flow_not_found` |
| POST flows/{id}/subscribers/{cid}/pause | user.flows.subscribers.pause | FlowsController@apiSubscriberPause | same | none | `{ok:true}`; 404 `{ok:false}` when the flow is not visible |
| POST flows/{id}/subscribers/{cid}/resume | user.flows.subscribers.resume | FlowsController@apiSubscriberResume | same | none | `{ok:true}`; 404 when the flow or subscriber is missing |
| GET api/v1/flows/{id}/subscribers | api.v1.flows.subscribers | Api\V1\FlowController@subscribers | api, AuthenticateApiKey, ApiPlanRateLimit | `limit` 1..200 (default 100) | `{data:[...same item shape...], meta:{count, counts}}`; 404 `not_found` |

- **Data:** reads `flow_subscribers` joined to contacts (name = first + last, else `#<contact id>`; phone canonical digits). Ordered by id descending, hard cap 200 rows (web) or `limit` (API). The `counts` cover only the rows returned, not every subscriber (QUIRK: with more than 200 subscribers the counts are wrong).
- **Rules & edge cases:**
  1. `pause` sets the subscriber `status='paused'` by (flow, contact) with no state check (it can pause a completed or failed row). It is purely a Laravel-side gate: the Node session is not stopped, so a paused contact's current run continues; the effect is that the enrolment service will not re-enrol or relaunch them (a paused row is neither new nor failed).
  2. `resume` sets `active` and clears `failed_at` and `failure_reason`. It does not relaunch anything (calling enrol would double-fire a run that is still alive).
  3. QUIRK: pause or resume of a contact that is not in the flow: pause silently updates zero rows and still returns `ok:true`; resume returns 404.
  4. The API list's phone is a plain digits concatenation of country code and mobile (no duplicate-prefix guard), unlike the web list which uses the canonical helper.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a flow with 3 active and 1 failed subscriber, when the list is requested, then `counts` shows active 3 and failed 1 and the failed row carries its reason.
  - Given a subscriber is paused, then a later tag event does not launch the flow for that contact.
  - Given resume on a failed subscriber, then it becomes `active` with the failure cleared and no run is started.
  - Given a flow of another workspace, then both web and API answer 404.
- **Source refs:** `app/Http/Controllers/FlowsController.php` (`apiSubscribers`, `apiSubscriberPause`, `apiSubscriberResume`), `app/Http/Controllers/Api/V1/FlowController.php` (`subscribers`), `app/Models/FlowSubscriber.php`.
- **Port notes:** Owned by FLR, built there (see wiring map): WD-FLR-052 `GET /v2/flow-runtime/flows/:flowId/subscribers` (status filter, cursor, `counts` over every subscriber) and `POST /v2/flow-runtime/subscribers/:id/pause` / `resume` (409 when the status does not allow it), permission `flr.runs.manage`. What the editor side keeps: a "Subscribers" panel on the flow (the UI WaDesk never built) that consumes those endpoints; no further editor logic.

### WD-FLB-074 — Flow analytics overview

- **Status:** partial
- **Priority:** P1 (expected by customers)
- **Effort:** L (<=2 weeks) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-071
- **Summary:** `/flows/analytics` (all flows) and `/flows/analytics/{id}` (one flow): KPI tiles, a run trend, an outcome mix, a per-flow leaderboard and the top failure reasons, over 7 / 30 / 90 days or all time. Partial because "completed" is never recorded, so the success side of every figure is empty in practice (see rule 1).
- **Actors & access:** workspace admin (`workspace.role:admin`). Linked from the flows list header ("Analytics") and each non-Instagram card.
- **UX & screens:** `resources/views/user/flows/analytics.blade.php` (nav key `flow-analytics`, page id `user-flows-analytics`, script `user-flows-analytics.js`, charts by ApexCharts). Header: back link, "Flows / Analytics / <flow name or All flows>", "Generated" time, a link "All flows" and "Open in builder" when scoped, **Refresh**. Controls: flow select (first option "All flows"; changing it reloads the page with `?flow_id=`) and period chips 7 days / 30 days / 90 days / All time (default 30). KPI tiles: Total runs ("Enrolments in this period"), Completed, Failed, Active ("Still running now"), Completion rate (hidden when null), Avg time to complete (hidden when null); secondary counters: Contacts reached, Paused runs, Runs retried, Retry attempts, Live flows. Tabs: Overview, Execution history, Error logs, Retry records (WD-FLB-075 to 077). Overview: **Run trend** (lines Enrolled / Completed / Failed), **Run status** (active, paused, completed, failed donut), **Flow leaderboard** (flow, runs, completed, failed, completion rate; clicking a row scopes the page to that flow), **Top failure reasons** (bar chart of the top 8, plus "Open error logs"). Empty states: no flows at all ("No flows to analyse yet", "Go to flows"); "No runs in this period"; "Nothing to split yet"; "No flow has run in this period"; "No failures recorded". The URL is kept shareable with `replaceState` (only `flow_id` and a non-default `range`). First paint is server-rendered with the same payload as the JSON endpoint.
- **Endpoints:**

| Method uri | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| GET flows/analytics | user.flows.analytics | FlowsController@analytics | web, Authenticate, EnsureWorkspaceRole:admin | `flow_id`, `range` | Blade page |
| GET flows/analytics/{id} | user.flows.analytics.show | FlowsController@analytics | same | route `id`; `range` | Blade page; 404 when the flow is not visible |
| GET flows/analytics/data | user.flows.analytics.data | FlowsController@apiAnalytics | same | `flow_id`, `range` (`date_from` / `date_to` also honoured) | `{ok, range, from, to, flow_id, totals{...}, status{labels,series}, series{granularity,categories,enrolled,completed,failed}, flows[...], failures{labels,series}, failure_reasons[...], retry_cooldown_seconds, retry_max_batch, generated_at}` |

- **Data:** reads `flow_subscribers` (the "run"), `flow_retry_logs`, `flows` (name, state), `contacts`. `totals`: `runs`, `active`, `paused`, `completed`, `failed`, `completion_rate` and `failure_rate` (percent, one decimal, null at zero runs), `flows_total`, `flows_live`, `flows_with_runs`, `contacts_reached` (distinct contacts), `avg_complete_seconds` (average of completed minus enrolled, null when none), `retried_runs` (retry count above zero), `retry_attempts` (retry log rows in the window). Leaderboard rows: `flow_id`, `name`, `state`, `runs`, status counts, `completion_rate`, `failure_rate`, `avg_complete_seconds`, sorted by runs descending. Failure reasons: grouped by reason text (blank collapses to one null "no reason recorded" bucket) with count, first seen and last seen, sorted by count.
- **Rules & edge cases:**
  1. QUIRK / PARTIAL: nothing in the application ever sets a subscriber to `completed` (no `completed_at` writer exists and the Node bridge ignores the subscriber id), and `failed` is only written by a launch failure or a manual action. Real data therefore shows Active for every run that launched, Failed for launch failures, and Completed, completion rate and average time at zero or null. The screen is correct about what it counts; the data feeding it is not.
  2. Window: `range` outside 7 / 30 / 90 / all falls back to 30; "last N days" is N calendar days in the WORKSPACE timezone (start of the first day to end of today), converted to UTC; explicit `date_from` / `date_to` (Y-m-d, workspace calendar) override the period and the upper bound is always applied. A run belongs to the window by its `enrolled_at`.
  3. Trend buckets: per day, switching to months when the span exceeds 92 days, capped at 400 buckets; each series is keyed on its own timestamp (a run enrolled before the window but completed inside it counts on the completion day). Day boundaries are shifted by the workspace's CURRENT UTC offset (QUIRK: wrong across a daylight-saving change for old data).
  4. Tenancy gate: every query is bounded by the set of flow ids visible to the workspace (subscribers have no workspace column). A `flow_id` outside the set is ignored (all flows) on the JSON endpoint and 404 on the page route.
  5. Flow names and contact names are encrypted columns, decrypted in PHP per request (memoised per request).
  6. Failed JSON loads show a toast "Could not refresh the figures." and sections offer "Try again".
- **Async & events:** none (computed on read). No caching.
- **External systems:** none.
- **Settings:** workspace timezone (`wa_tz()`).
- **Acceptance criteria:**
  - Given 10 subscribers enrolled in the last 30 days (7 active, 3 failed) across two flows, when the page loads, then Total runs is 10, Failed 3, Active 7 and the leaderboard lists both flows ordered by runs.
  - Given the period is switched to 7 days, then only runs enrolled in the last seven calendar days of the workspace timezone are counted.
  - Given a `flow_id` of another workspace passed to the data endpoint, then the figures cover all of this workspace's flows and nothing from the other workspace.
  - Given a workspace with no flows, then the page shows "No flows to analyse yet" and no zeroed tiles.
- **Source refs:** `app/Http/Controllers/FlowsController.php` (`analytics`, `apiAnalytics`, `buildAnalytics`, `analyticsSeries`, `analyticsFlowMap`, `analyticsWindow`, `analyticsExplicitDates`), `resources/views/user/flows/analytics.blade.php`, `resources/js/charts/user-flows-analytics.js`.
- **Port notes:** Owned by FLR, built there (see wiring map): WD-FLR-053 `GET /v2/flow-runtime/analytics` (`days` default 30, `flowId`; totals, completion rate, trend, failure reasons, by source, leaderboard) on the screen `/flow-runtime/analytics` (permission `flr.runs.read`); the Overview numbers read `flow_runs` plus launch failures, and in FLR `completed` really is set (WD-FLR-051). What the editor side keeps: the entry links (flows list header and card, builder "Analytics" action) deep-linking to that screen with `flowId`. Keep the honest-empty-state rule; make the window an explicit `days` or `from` / `to` pair and compute buckets in the org timezone with proper DST handling.

### WD-FLB-075 — Execution history table

- **Status:** partial
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-074
- **Summary:** The "Execution history" tab: every flow run (a contact's place in a flow), newest first, with status chips, date range, free-text search, pagination and bulk selection of failed rows for retry. Partial for the same reason as the overview: "run" is one row per contact and flow, and "completed" is never recorded.
- **Actors & access:** workspace admin.
- **UX & screens:** tab `history` of `analytics.blade.php`. Title "Flow execution history" / "Every run, newest first". Status chips All / Active / Paused / Completed / Failed with counts; **From** and **To** date inputs (note: "Custom dates apply to this table only and override the period above"); search box "Contact, flow or reason..." (350 ms debounce, resets to page 1); bulk bar "N failed runs selected" with "Up to 50 per batch, and one retry per run every 30 s", **Clear**, **Retry selected** (only failed rows are selectable; the header checkbox "Select every failed run on this page" selects up to the batch limit and toasts "Up to N runs can be retried at once."); table columns: select, Contact, Flow, Status, Enrolled, Finished, Duration, Retries, action (a Retry button when `can_retry`, otherwise a hint "Publish and activate the flow to retry this run."); pager with "Showing x to y of N", previous / next. States: loading skeleton, error ("Could not load the execution history." with Try again), empty ("No runs match these filters" with Reset filters).
- **Endpoints:**

| Method uri | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| GET flows/analytics/runs | user.flows.analytics.runs | FlowsController@apiRuns | web, Authenticate, EnsureWorkspaceRole:admin | `flow_id`; `status` (active, paused, completed, failed); `date_from`, `date_to` (Y-m-d); `range`; `q`; `page`; `per_page` (default 25, 1 to 100) | `{ok, runs:[row], pagination:{page, per_page, total, last_page, from, to, has_more}, counts:{all, active, paused, completed, failed}, retry_cooldown_seconds:30, retry_max_batch:50}` |

  Row: `id`, `flow_id`, `flow_name`, `flow_state` (live, paused, draft), `contact_id`, `contact_name`, `contact_phone`, `status`, `enrolled_at`, `completed_at`, `failed_at`, `failure_reason`, `retry_count`, `last_retried_at`, `duration_seconds` (completed minus enrolled, null otherwise), `can_retry` (status failed AND the flow is active).
- **Data:** `flow_subscribers` ordered by id descending; flow and contact names decrypted in PHP.
- **Rules & edge cases:**
  1. Status chip counts use the same filters minus `status`, computed before the status filter, so the chips always add up to the unfiltered result.
  2. Search matches, in one OR: the failure reason (SQL `LIKE %term%`), contacts whose decrypted name or digits match, flows whose decrypted name contains the term (case-insensitive), and, when the term is all digits, the run id. QUIRK: contact search hydrates and decrypts every contact of the workspace per request (cost grows with the contact count).
  3. An unknown `status` value is ignored (treated as no filter); `per_page` below 1 becomes 25 and above 100 becomes 100; page is at least 1.
  4. Same window rules as WD-FLB-074 (explicit dates override `range`; upper bound always applied; `enrolled_at` is the window key).
  5. A "run" is the subscriber row: a contact has at most one row per flow, so history shows one line per contact and flow, not one per execution. A retried run changes in place (retry count, last retried time) rather than adding a line.
  6. The `Finished` column is `completed_at`, else `failed_at`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none (page size fixed by request).
- **Acceptance criteria:**
  - Given 30 runs and the default page size, when the tab opens, then 25 are shown newest first with a "Showing 1 to 25 of 30" line.
  - Given the chip "Failed" is chosen, then only failed runs are listed and the chip counts for other statuses do not change.
  - Given the search "anya", then runs of contacts whose name contains "anya" (any case) are listed.
  - Given a failed run whose flow is paused, then the row has no Retry button and shows the activate hint.
  - Given the header checkbox with 60 failed rows on a page of 100, then at most 50 are selected and a toast explains the limit.
- **Source refs:** `app/Http/Controllers/FlowsController.php` (`apiRuns`, `analyticsRunQuery`, `analyticsRunRow`, `analyticsSearchContactIds`, `analyticsPagination`), `resources/js/charts/user-flows-analytics.js`, `resources/views/user/flows/analytics.blade.php`.
- **Port notes:** Owned by FLR, built there (see wiring map): WD-FLR-054 `GET /v2/flow-runtime/history` reading subscribers plus the flow and contact names (a launch that failed before any run existed is listed), cursor pagination, permission `flr.runs.read`. What the editor side keeps: nothing beyond the entry links. Port the status counts-before-filter behaviour and use an indexed search (name search on a plain `contacts.name`, no per-request decryption).

### WD-FLB-076 — Error logs

- **Status:** partial
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-074
- **Summary:** The "Error logs" tab: failed runs rolled up by failure reason (count, first and last seen, flows affected) with a one-click "retry these", plus the raw list of failures. Partial because only launch failures are ever recorded; errors inside a running flow are not.
- **Actors & access:** workspace admin.
- **UX & screens:** tab `errors` of `analytics.blade.php`: a group list (reason or "no reason recorded", count, first/last seen, flow chips, a retry button per group) and a raw failure table with the same search, date and paging controls as the history (status pinned to failed). Totals strip: failed, distinct reasons, affected flows, affected contacts, runs retried.
- **Endpoints:**

| Method uri | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| GET flows/analytics/errors | user.flows.analytics.errors | FlowsController@apiErrors | web, Authenticate, EnsureWorkspaceRole:admin | `flow_id`, `date_from`, `date_to`, `range`, `q`, `page`, `per_page` | `{ok, groups:[{reason, count, first_seen, last_seen, flows:[{flow_id, flow_name, count}], subscriber_ids[]}], totals:{failed, distinct_reasons, affected_flows, affected_contacts, retried}, rows:[run row], pagination, retry_cooldown_seconds, retry_max_batch}` |

- **Data:** `flow_subscribers` where `status='failed'` (same filters as WD-FLB-075 minus status). `failure_reason` is `varchar(191)`.
- **Rules & edge cases:**
  1. Groups are built by one aggregate query over reason and flow, merged in PHP so NULL and empty reasons form a single bucket (`reason: null`); sorted by count descending; each group's `flows` sorted by count descending.
  2. `subscriber_ids` per group come from the newest 2000 failed rows only, capped at 50 per group (the retry batch limit), so a "retry these" never exceeds one batch and may not include every failure of a very large group.
  3. Raw rows ordered by `failed_at` descending then id descending, paged like the history.
  4. The reasons that can occur are exactly the strings written at launch: "No connected <engine> sender for this workspace", "Contact has no usable mobile number", "Node bridge URL not configured (baileys_server_url / SERVER_URL)", "Node <status>: <first 150 characters of the response>", "Node unreachable: <150 characters>". QUIRK: runtime failures (a node erroring mid-flow, a send rejected by Meta, an AI or webhook failure) never reach this table, so the page under-reports problems. Log those separately in the rebuild.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 4 runs failed with reason A and 2 with reason B, then two groups are returned, A first with count 4, each listing the affected flows.
  - Given a group of 80 failures, then `subscriber_ids` holds at most 50 ids.
  - Given failures without a stored reason, then one group with a null reason is returned and shown as "no reason recorded".
  - Given a run is retried and fails again, then it stays in the list and `totals.retried` counts it.
- **Source refs:** `app/Http/Controllers/FlowsController.php` (`apiErrors`), `resources/js/charts/user-flows-analytics.js`, `resources/views/user/flows/analytics.blade.php`, `app/Services/Flow/FlowEnrollmentService.php` (failure strings).
- **Port notes:** Owned by FLR, built there (see wiring map): WD-FLR-055 `GET /v2/flow-runtime/errors` (`FlowRuntimeService.errorGroups`), reading failed subscribers so a launch failure with no run is listed; permission `flr.runs.read`. What the editor side keeps: nothing beyond the entry links. Port the "retry these" group action as `POST /v2/flow-runtime/retry` with the group's ids (max 50), and extend the reasons to cover in-run failures.

### WD-FLB-077 — Retry failed runs and retry records

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** L (<=2 weeks) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-075
- **Summary:** Operators can re-launch one failed run or a named batch of up to 50, with guard rails (workspace, activity, cooldown, status) and a permanent audit record per attempt in `flow_retry_logs`, shown in the "Retry records" tab.
- **Actors & access:** workspace admin; the retry service also checks that the acting user belongs to the flow's workspace.
- **UX & screens:** Retry buttons in the history, error groups and raw failures; the bulk bar in WD-FLB-075. A single retry toasts the server message (success: "The run completed on retry." or "The run was re-started."; failure: "The retry failed again: <reason>"); bulk retry toasts "<queued> re-started, <succeeded> completed, <failed> failed, <skipped> skipped." and refreshes all tabs. Tab `retries`: outcome chips All / Queued / Succeeded / Failed with counts; table columns for time, flow, contact, retried by (a user name or "System"), source (manual / system), previous status and reason, outcome and outcome reason; paging; states loading, error, empty ("No retries recorded").
- **Endpoints:**

| Method uri | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| POST flows/analytics/runs/{subscriber}/retry | user.flows.analytics.retry | FlowsController@retryRun | web, Authenticate, EnsureWorkspaceRole:admin | route `subscriber` id | `{ok, message, reason, outcome, run:<run row>}` HTTP 200 on ok, 422 otherwise; 404 `{ok:false, reason:'not_found', message, outcome:null, run:null}` when the run is missing or in another workspace |
| POST flows/analytics/runs/retry | user.flows.analytics.retry-bulk | FlowsController@retryFailed | same | `ids[]` int required, at least 1 | `{ok:true, message, requested, attempted, queued, succeeded, failed, skipped, results:[{id, ok, outcome, reason, message}]}`; 422 `{ok:false, reason:'batch_too_large', message}` when more than 50 distinct ids |
| GET flows/analytics/retries | user.flows.analytics.retries | FlowsController@apiRetries | same | `flow_id`, `outcome` (queued, succeeded, failed), `date_from`, `date_to`, `range`, `page`, `per_page` | `{ok, retries:[{id, flow_id, flow_name, flow_subscriber_id, contact_id, contact_name, contact_phone, retried_by_user_id, retried_by, source:'manual'|'system', previous_status, previous_failure_reason, outcome, outcome_reason, created_at}], pagination, totals:{all, queued, succeeded, failed}}` |

- **Data:** `flow_retry_logs`: `workspace_id`, `flow_id`, `flow_subscriber_id`, `contact_id`, `retried_by_user_id` (null = system), `previous_status`, `previous_failure_reason` (text), `outcome` (`queued` default, `succeeded`, `failed`), `outcome_reason` (text), timestamps; indexes on (workspace, created), workspace, flow, subscriber, outcome. `flow_subscribers.retry_count` and `last_retried_at` updated on each armed attempt.
- **Rules & edge cases:** the service never throws; every path returns `{ok, reason, message, outcome}`. Checks, in this order, for one run:
  1. `flow_not_found` (the flow row is gone), `wrong_workspace` (the flow belongs to another workspace; rows with no workspace fall back to their creator), `not_permitted` (the actor is not a member of the workspace), `flow_inactive` ("Turn this automation back on before re-running its failed contacts.": `is_active` false; a draft that is still active passes).
  2. `too_soon`: a retry within 30 seconds of the last one on the same run is refused ("This run was just retried..."). Checked BEFORE the status test so a double click is reported as just-retried rather than "in progress".
  3. `not_failed`: only a `failed` run can be retried; the message differs for completed ("nothing to retry"), paused ("Resume it instead of retrying") and other ("still in progress").
  4. `contact_not_found` when the contact row is gone.
  5. Snapshot the previous status and reason BEFORE enrolment clears them. In ONE transaction run a conditional update (status still `failed` AND last retry null or older than 30 s) that increments `retry_count` and stamps `last_retried_at`, and insert the log row with outcome `queued`. If the update changed no row (a concurrent request won) answer `too_soon`; so two simultaneous requests can never launch the contact twice.
  6. Then call the enrolment service (WD-FLB-071), which resets the failure and launches again. Outcome: an exception means `failed` (message cut to 190 characters); otherwise the subscriber's status decides: `failed` -> `failed` (new reason copied), `completed` -> `succeeded`, anything else (normally `active`) -> `queued`. The log row is updated; ok is false for `failed` ("The retry failed again: <reason>").
  7. Bulk: ids are de-duplicated; more than 50 distinct is refused up front (`batch_too_large`); ids not visible to the workspace are never passed to the service and are reported as skipped with "This run no longer exists." (indistinguishable from a missing id); the service itself also caps at 50 and reports `capped`. Each run is processed in turn; one failure never stops the batch.
  8. QUIRK: `succeeded` is effectively unreachable because nothing ever marks a run completed; a successful retry is always `queued`.
  9. Retry records visibility: workspace-scoped on `workspace_id` of the log row (stamped from the flow at write time) AND restricted to the visible flow ids; `source` is "manual" when a user id is stored, else "system" (no automatic retry exists yet).
  10. There is no "retry every failed run of a flow" endpoint: the caller names the ids (that is deliberate).
- **Async & events:** none queued by WaDesk; the launch is the synchronous enrolment call.
- **External systems:** the Node bridge, via the enrolment service.
- **Settings:** constants `COOLDOWN_SECONDS = 30`, `MAX_BATCH = 50`.
- **Acceptance criteria:**
  - Given a failed run on an active flow, when Retry is pressed, then `retry_count` becomes 1, a log row with the previous reason and outcome `queued` exists, and the response message is "The run was re-started.".
  - Given the same run is retried again within 30 seconds, then the response is 422 with reason `too_soon` and no second log row is written.
  - Given the flow is paused, then the retry is refused with `flow_inactive` and nothing changes.
  - Given a bulk request of 51 ids, then the response is 422 `batch_too_large` and nothing runs.
  - Given a bulk request mixing a failed run, a completed run and an id from another workspace, then one is attempted and the other two are counted as skipped.
- **Source refs:** `app/Services/Flow/FlowRetryService.php`, `app/Http/Controllers/FlowsController.php` (`retryRun`, `retryFailed`, `apiRetries`), `app/Models/FlowRetryLog.php`, `app/Models/FlowSubscriber.php`, `resources/js/charts/user-flows-analytics.js`.
- **Port notes:** Owned by FLR, built there (see wiring map): WD-FLR-056, 057, 058 `POST /v2/flow-runtime/subscribers/:id/retry` (409 `FLR_NOT_RETRYABLE`), `POST /v2/flow-runtime/retry` (named runs, max 50), `GET /v2/flow-runtime/retries`, `POST /v2/flow-runtime/flows/:flowId/retry-failed` (up to 500), writing `flow_retry_logs`; permission `flr.runs.manage`. What the editor side keeps: nothing beyond the entry links. Keep the audit row, the cooldown and the conditional-update race guard; the compare-and-set on the run replaces the update trick.

### WD-FLB-078 — Flow-connected devices

- **Status:** dead-code
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-029
- **Summary:** Two endpoints and a table that let a flow be linked to a phone number ("connected device"). Nothing in the product calls them: the real sender binding is the Trigger node's sender, stored in `flows.trigger_device_id` (WD-FLB-020).
- **Actors & access:** workspace admin (the routes sit under `/flows/api`).
- **UX & screens:** none (no view, script or other code calls the routes).
- **Endpoints:**

| Method uri | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| POST flows/api/connect | user.flows.api.connect | FlowsController@connectDevice | web, Authenticate, EnsureWorkspaceRole:admin | `flow_id` int req; `device_number` string req; `device_name` string null | `{success:true, data:<row>}`; 422 `{success:false, errors}`; 404 when the flow is not visible |
| POST flows/api/disconnect/{id} | user.flows.api.disconnect | FlowsController@disconnectDevice | same | route `id` | `{success:true}`; 404 `{success:false, message:'Connection not found'}` |

- **Data:** table `flow_connected_devices`: `flow_id`, `device_number` (encrypted text), `device_name` (encrypted, null), `status` (default `active`; `disconnected` after a disconnect), `connected_at`, `last_active_at`, timestamps; indexes on `flow_id` and (`flow_id`, `status`). No uniqueness: history rows accumulate. Model `FlowConnectedDevice`; relations `Flow::connectedDevices` and the active-only variant.
- **Rules & edge cases:**
  1. `connect` first marks ALL existing rows of the flow `disconnected` (one active device per flow at a time), then inserts a new `active` row; the number is free text with no format check and is not tied to a real `devices` row.
  2. `disconnect` is allowed for any teammate whose workspace owns the flow.
  3. The only readers are the flows list (`withCount` of active devices, never displayed on the cards) and `GET flows/api/{id}` (`with('connectedDevices')`). The runtime never reads the table.
  4. QUIRK: the migration `2026_05_05_000011_create_flows_table` creates this table; `WipeExpiredWorkspaces` does not delete its rows explicitly.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a flow with an active connected device, when a second device is connected, then the first becomes `disconnected` and exactly one row is `active`.
  - Given a disconnect for a row of another workspace's flow, then the response is 404 `Connection not found`.
  - Given a flow, then removing a connected device row has no effect on which number the flow sends from.
- **Source refs:** `app/Http/Controllers/FlowsController.php` (`connectDevice`, `disconnectDevice`, `apiShow`), `app/Models/FlowConnectedDevice.php`, `app/Models/Flow.php`, `database/migrations/2026_05_05_000011_create_flows_table.php`.
- **Port notes:** do not port. The Trigger sender binding (`trigger_channel_id` in FLR, WD-FLR-001) supersedes it. If the table is created for parity, leave it unused; otherwise omit the two routes and the table and record the decision in the parity file as an intended difference.

### WD-FLB-079 — Instagram flow import and Instaflow sync

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** M (<=1 week) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-064
- **Summary:** When Instagram runs on the separate Instaflow service (remote mode), flows authored there can be imported into the WaDesk builder for editing, and Instagram flows saved in WaDesk are pushed back so Instaflow's runtime and keyword matcher run them. The same bridge lists Instagram flows for the team inbox's "run a flow" action.
- **Actors & access:** workspace admin (import and save). Team-inbox listing and run: agents who may reply. Only relevant when Instagram is in remote Instaflow mode (the `instagram_enabled` native extension off) and the workspace has a linked Instagram account.
- **UX & screens:** on the flows list (WD-FLB-001 rule 7) a remote Instagram panel lists Instaflow flows (cached 120 seconds per workspace; `?refresh_ig=1` busts it); each entry's edit action opens `GET /flows/import-ig/{igId}` and lands in the builder. No dedicated page.
- **Endpoints:**

| Method uri | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| GET flows/import-ig/{igId} | user.flows.import-ig | FlowsController@importIgFlow | web, Authenticate, EnsureWorkspaceRole:admin | route `igId` (Instaflow flow id) | redirect to `/flows/builder/{id}`; to `/flows` with error "Connect an Instagram account first." when no account is linked; to the builder with error "Could not fetch the Instagram flow — you can still edit the local copy." when the bridge fails |

  Related routes owned by other domains and consumed here: `GET team-inbox/api/ig-flows` (list; native mode returns the workspace's local `flow_type='instagram'` flows, remote mode returns Instaflow flows de-duplicated by id across the workspace's linked accounts, plus an `author_url`), `POST team-inbox/api/conversations/{id}/run-ig-flow` (`flow_id` required; native mode hands the flow graph to the Node Instagram engine, remote mode calls Instaflow `run-flow`; 422 `not_instagram` for other channels), `POST api/instaflow/inbound` (Instaflow pushes messages in), `POST admin/extensions/instaflow/connect|disconnect`, `POST templates/sync-instaflow`.
- **Data:** `flows.instaflow_flow_id` (indexed), `flows.flow_type='instagram'`. The bridge contract (secret header `X-Instaflow-Secret`, 15 s timeout, never throws): `GET /api/wadesk/flows`, `GET /api/wadesk/flows/{id}?adopt=<local id>` (returns `{flow:{id,name,flow_data,trigger_kind,trigger_keywords,is_published}}` and links the remote flow to the local one), `POST /api/wadesk/flows` (push: `account`, `wadesk_flow_id`, `name`, `flow_data`, `trigger_kind`, `trigger_keywords`, `is_published`), `POST /api/wadesk/conversations/{id}/run-flow`.
- **Rules & edge cases:**
  1. Import is idempotent: a local flow already carrying that `instaflow_flow_id` is reused. A first import checks the plan `flow_limit` (the same create-path count as WD-FLB-028), then creates a shell named "Instagram flow" (type instagram, unpublished, active) so there is a local id to adopt with.
  2. The remote flow data replaces the local graph; name, published flag and the trigger columns are re-derived (`extractTriggerColumns` wrapped so a malformed graph cannot cause a 500); the file mirror is rewritten. QUIRK: `published_at` is not set even when the remote flow is published, and the flow's `provider` is not stamped `instagram` by this path (the model's create hook stamps the workspace engine; the showcase seeder stamps it explicitly).
  3. Push on save: after a save of an `instagram` flow, the full graph is sent verbatim (the two builders share the `flowNodes` / `flowEdges` / `vars` format) to every linked Instagram account of the workspace (`instaflow_account_id` on `WorkspaceIgAccount`). Best effort: a bridge failure is logged and never surfaced to the save; unlinked or unconfigured workspaces skip silently.
  4. The bridge is configured with system settings `instaflow_url` and `instaflow_secret` (the same secret authenticates the reverse `POST api/instaflow/inbound`); `instaflow_connected` records the last handshake.
  5. Two Instagram runtimes exist in the code (native Node engine behind `instagram_enabled`, and remote Instaflow); the list, run and sync paths branch on that setting.
- **Async & events:** save-time push; inbound messages arrive on `api/instaflow/inbound` (Instagram channel domain).
- **External systems:** the Instaflow deployment (its own Meta OAuth and webhooks).
- **Settings:** `instaflow_url`, `instaflow_secret` (encrypted), `instaflow_connected`, `instagram_enabled`; plan `flow_limit`.
- **Acceptance criteria:**
  - Given a linked Instagram account and an Instaflow flow 12 not yet imported, when the admin opens its import link, then a local flow with `instaflow_flow_id` 12 is created with the remote graph and the browser lands in the builder.
  - Given the same link is opened again, then the same local flow is reused and no second flow is created.
  - Given no Instagram account is linked, then the redirect to `/flows` carries "Connect an Instagram account first.".
  - Given an Instagram flow is saved, then each linked account receives a push with the flow's keywords and published state, and a bridge error does not fail the save.
  - Given the workspace is at its `flow_limit`, then a first import is refused by the plan guard.
- **Source refs:** `app/Http/Controllers/FlowsController.php` (`importIgFlow`, `syncInstagramFlow`, `safeTriggerColumns`), `app/Services/Instaflow/InstaflowClient.php`, `app/Http/Controllers/TeamInboxController.php` (`igFlows`, `runIgFlow`), `app/Http/Controllers/Api/InstaflowInboundController.php`, `app/Models/Flow.php`.
- **Port notes:** depends on the channel-instagram and addons domains deciding between a native runner and a remote service. If remote, implement an `InstaflowPort` provider adapter (import, push, list, run) with the secret in the encrypted integration settings and the push as an outbox-driven job with retry (WaDesk's best-effort push loses changes silently). Stamp the channel and `published_at` on import.

### WD-FLB-080 — Flow showcase seeder (dev fixture)

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days) — to rebuild on the target stack, backend + frontend + tests
- **Depends on:** WD-FLB-016
- **Summary:** A developer seeder that builds ready-made test flows exercising the node catalogue: one chat flow with one of every chat node and five Instagram flows, so the builder and runtime can be tried end to end without drawing every node. Not a customer feature.
- **Actors & access:** operators with command-line access (`php artisan db:seed --class=Database\\Seeders\\FlowShowcaseSeeder`).
- **UX & screens:** none; console output lists each created flow with its id, type and node count and ends "Done. Open /flows to test.".
- **Endpoints:** none.
- **Data:** writes `flows` rows through the model (so the encrypted name and graph apply and the file mirror is written). Created flows (each name starts with a test-tube emoji, shown here as [test]): "[test] All Nodes — Chat" (type chat, 32 nodes: trigger, message, sequence, media, template, buttons, list, poll, ask, condition, ai, chatbot, cta, location, delay, webhook, code, mysql, tag, assign, subflow, google_sheets, google_docs, google_form, google_meet, wa_form, book_appointment, deal, whatsapp_shop, woocommerce, shopify, end), and five Instagram flows ("[test] IG — Condition Routing", "[test] IG — All Conditions" with every operator plus AND / OR rules, "[test] IG — Welcome + Buttons", "[test] IG — Products + Lead", "[test] IG — All IG Nodes" with message, media, buttons, ask, condition, ai, delay, webhook, ig_buttons, ig_products, ig_lead, ig_reply_comment, end).
- **Rules & edge cases:**
  1. Target: env `FLOW_SEED_EMAIL` (that user's current or owned workspace and that user as owner) wins, then env `FLOW_SEED_WS_ID`, then the first workspace by id. The owner is the workspace owner, else a user whose current workspace it is, else the first user. With no workspace or user it warns and seeds nothing.
  2. Idempotent: before creating each flow it force-deletes any flow of the same type and name in that workspace (names are encrypted, so it scans in PHP), and it also removes the retired call showcase flows (type call, category "Showcase").
  3. Safe by design: flows are created UNPUBLISHED and active, category "Showcase", trigger `keyword` with keywords "demo, start, hi" (the Instagram ones use their own), and NO device on the Trigger, so the managed keyword rule is created inactive and cannot hijack a real inbound message. The operator must pick a sender and publish to test.
  4. Layout: nodes are placed on a grid (five per row, 300 by 180 pixels, origin 80, 60) with flat `x` / `y`; the Trigger carries `isStart`. Node data mirror exactly what the builder saves, so the flows open cleanly and normalize for the runtime.
  5. QUIRK: the comment says "one of every chat node" but Copy to number, Hand off to Instagram and AI voice call are not included, and there is no call showcase and no Facebook or other-channel showcase; the Instagram "All IG Nodes" flow omits Hand off to WhatsApp.
  6. Not part of the default seeders; it must be run by name. The Mysql and Docs nodes in the fixture carry placeholder values (localhost, empty template) and will not run until configured.
- **Async & events:** the Flow model's saved hook syncs the managed keyword rule (inactive here).
- **External systems:** none.
- **Settings:** env `FLOW_SEED_EMAIL`, `FLOW_SEED_WS_ID`.
- **Acceptance criteria:**
  - Given a workspace, when the seeder runs, then six flows named as above exist in it, all unpublished, and the chat one has 32 nodes.
  - Given the seeder is run twice, then there are still exactly six showcase flows (the second run replaces the first).
  - Given no workspace exists, then the seeder prints a warning and creates nothing.
  - Given a showcase flow is opened in the builder, then it renders without validation errors on the Trigger-to-End chain except for the unset sender.
- **Source refs:** `database/seeders/FlowShowcaseSeeder.php`, `app/Models/Flow.php` (saved hook).
- **Port notes:** keep it as a dev-only fixture under `packages/db/seeds` (never loaded in production), generated from the shared node-type catalogue so it stays in step with `@crm/contracts`, and use it as the fixture for the builder round-trip test (save then reload then compile). Add the missing nodes and one flow per channel.

## Data model

Verified with `SHOW CREATE TABLE` on the seeded reference database (all five tables are empty there). Ownership in the port: FLB owns `flows` (the definition and trigger mirror columns) and `flow_templates`; FLR owns everything written while a flow runs or is monitored (`flow_subscribers`, `flow_retry_logs`, and the new `flow_runs` it built). `flow_connected_devices` is dead (WD-FLB-078). `google_form_sessions` is written by the Google Form node (WD-FLB-059) and is also listed by the node-bridge domain.

### flows

Purpose: one row per flow (chatbot or automation graph) in a workspace. Reads: WD-FLB-001, 004, 006, 008, 019, 022, 026, 070, 071, 074. Writes: WD-FLB-004 to 010, 019 to 022, 079, 080. Volume: tens to low thousands per tenant; list endpoints load all of a workspace's rows and filter in PHP because name and graph are encrypted.

| Column | Type | Null / default | Behaviour |
| --- | --- | --- | --- |
| `id` | bigint unsigned | PK, auto | node bridge and keyword rows reference it |
| `user_id` | bigint unsigned | null | creator; legacy tenancy fallback when `workspace_id` is null |
| `flow_name` | text | not null | `encrypted` cast; cannot be searched or sorted in SQL |
| `flow_data` | longtext | null | `encrypted` cast; JSON `{flowNodes[{id,type,x,y,data,isStart}], flowEdges[{id,source,sourceHandle,target,kind?}], vars[]}`; unbounded |
| `flow_file_path` | varchar(255) | null | private file mirror `flows/flow_<id>.json`; dropped in the port |
| `category` | varchar(64) | null, indexed | free string; the list filters on exact match |
| `trigger_kind` | varchar(24) | not null, default `keyword` | `keyword`, `tag_added`, `group_join`, `manual_enroll`, `contact_created`, `opt_in`, `order_placed`, `appointment_booked` (no producer), `deal_stage_changed`, `away`, `out_of_hours`, `comment_to_dm` |
| `trigger_value` | bigint unsigned | null | tag id, group id or stage id; 0 for kinds without a value; QUIRK: `comment_to_dm` is documented as a CSV of rule ids but the column is numeric |
| `trigger_keywords` | varchar(1000) | null | comma list for keyword flows (mirrored into the managed keyword row) |
| `trigger_device_id` | bigint unsigned | null | POLYMORPHIC sender id: a `devices` row only when `provider` is `baileys`; else a WABA / Twilio config row or an Instagram account row |
| `is_published` / `is_active` | tinyint(1) | 0 / 1 | state pair: draft = not published; live = published and active; paused = published and not active |
| `published_at` | timestamp | null | stamped on publish; "default flow" and "most used" order by it |
| `deleted_at` | timestamp | null | SoftDeletes trait present, every delete path is `forceDelete()` |
| `workspace_id` | bigint unsigned | null, FK `workspaces` ON DELETE SET NULL | tenancy; a null value orphans the flow to its creator |
| `provider` | varchar(16) | not null, default `baileys` | engine stamp (`baileys`, `waba`, `twilio`, `instagram`, ...), set from the workspace engine on create |
| `flow_type` | varchar(16) | not null, default `chat` | `chat`, `call`, `instagram`, `facebook`, `tiktok`, `telegram`, `line`, `wechat`, `viber`, `email` |
| `instaflow_flow_id` | bigint unsigned | null, indexed | link to the remote Instaflow flow (WD-FLB-079) |
| `created_at` / `updated_at` | timestamp | null | list order is `updated_at` descending |

Indexes: `(user_id, is_active)`, `user_id`, `category`, `workspace_id`, `(trigger_kind, trigger_value)`, `(workspace_id, provider)`, `flow_type`, `instaflow_flow_id`. Port: `jsonb` graph with a version column and a published snapshot, plain `name`, a real `channel` column (the FLR table already replaces the polymorphic sender with `trigger_channel_id`), RLS on `org_id`, hard delete.

### flow_templates

Purpose: admin-curated starter graphs cloned into workspaces (WD-FLB-010 to 012). Platform-wide (no workspace column). Volume: tens.

| Column | Type | Null / default | Behaviour |
| --- | --- | --- | --- |
| `id` | bigint unsigned | PK | |
| `name` | varchar(255) | not null | plain text (the form allows 160) |
| `description` | text | null | up to 1000 per the form |
| `flow_type` | varchar(16) | not null, default `chat` | indexed; form allows chat, call, instagram |
| `category` | varchar(64) | null | indexed |
| `flow_data` | longtext | not null | PLAIN JSON (not encrypted) so it can be shared; cast to array |
| `is_active` | tinyint(1) | not null, default 1 | indexed; gallery shows active rows only |
| `sort_order` | int unsigned | not null, default 0 | gallery order |
| `created_by` | bigint unsigned | null | admin user |
| `clone_count` | int unsigned | not null, default 0 | incremented per clone |
| `created_at` / `updated_at` | timestamp | null | |

### flow_connected_devices

Purpose: unused link between a flow and a typed phone number (WD-FLB-078, dead code). Columns: `flow_id` (indexed, with `status`), `device_number` text (encrypted), `device_name` text null (encrypted), `status` varchar(16) default `active`, `connected_at`, `last_active_at`, timestamps. No FK, no unique key, rows accumulate. Not deleted by the expired-workspace wipe. Do not port.

### flow_subscribers

Purpose: one row per (flow, contact): the "run" read by every monitoring screen (WD-FLB-071 to 077). Volume: one per contact per flow, the largest FLB table. Owned by FLR in the port.

| Column | Type | Null / default | Behaviour |
| --- | --- | --- | --- |
| `flow_id`, `contact_id` | bigint unsigned | not null | UNIQUE together (re-enrolment is a no-op); no FK |
| `enrolled_at` | timestamp | null | window key for analytics and the history |
| `completed_at` | timestamp | null | never written by any code (WD-FLB-074) |
| `failed_at` | timestamp | null | set on launch failure |
| `failure_reason` | varchar(191) | null | launch failure text, cut to fit |
| `status` | varchar(16) | not null, default `active` | `active`, `paused`, `completed` (never set), `failed` |
| `retry_count` | int unsigned | not null, default 0 | incremented on each armed retry |
| `last_retried_at` | timestamp | null | cooldown guard (30 s) |
| `created_at` / `updated_at` | timestamp | null | |

Indexes: unique `(flow_id, contact_id)`, `contact_id`, `(flow_id, status)`. No workspace column: tenancy is the set of visible flow ids.

### flow_retry_logs

Purpose: audit row per retry attempt (WD-FLB-077). Volume: small. Owned by FLR in the port.

Columns: `workspace_id` (not null, stamped from the flow), `flow_id`, `flow_subscriber_id`, `contact_id` null, `retried_by_user_id` null (null = system), `previous_status` varchar(16), `previous_failure_reason` text, `outcome` varchar(16) default `queued` (`queued`, `succeeded`, `failed`), `outcome_reason` text, timestamps. Indexes: `(workspace_id, created_at)`, `workspace_id`, `flow_id`, `flow_subscriber_id`, `outcome`. Not deleted by the expired-workspace wipe (retention gap).

### google_form_sessions (touched by WD-FLB-059)

One row per Google Form send: `workspace_id`, `flow_session_id` (the Node session key), `google_form_id`, `contact_phone` (digits), `save_variable`, `resume_port`, `webhook_token` (40 random characters, never used by the downloaded script), `answers_json`, `submitted_at`, `expires_at`. Stale unsubmitted rows for the same (session, form) are deleted on a new send. Also listed by the node-bridge domain.

## Cross-domain contracts

Consumes:

- **FLR (flow-runtime-engine):** executes every node documented here and owns enrolment, subscribers, analytics, history, errors, retry, graph normalisation and the run lifecycle (wiring map: WD-FLR-001 to 020, 052 to 058). The editor must save `flowNodes` / `flowEdges` / `vars` with the node type ids, `data` keys and handle names in these entries; FLR's `compileGraph` reads them. FLR index rows 021 to 071 name the executors for 053 to 068 (ports `AiCallPort`, `GoogleWorkspacePort`, `FlowShopPort`, `MysqlQueryPort`, `ORDER_MEDIA_PORT`, `ORDER_GROUP_NOTIFY_PORT`, `AI_AGENT_HANDOFF_PORT`).
- **APPT (appointments-booking):** booking types list (`GET appointments/booking-types/list`), slots and book APIs (`api/appointments/*`, `api/booking/*`), Google Calendar connection and `GoogleCalendarService` (Meet minting, token refresh), appointment settings (WD-FLB-053, 055).
- **WFL / WhatsApp Forms:** `GET wa-forms/api/list`, form liveness (`status` and `meta_flow_id`), the form-submission handler that resumes a parked run (WD-FLB-056).
- **INTG / Google account:** the workspace OAuth connection and scopes (`/google-account`), the master toggle `google_calendar_enabled` (WD-FLB-055, 057 to 059).
- **DEAL (deals-pipelines):** stages list (`GET deals/stages`), deals and pipelines, the observer that fires `deal_stage_changed`, plan flag `access_sales_pipeline` (WD-FLB-060, 065).
- **CALL (calling-voice) and NODE (node-bridge-runtime):** voice assistants, `wa_calls` and `wa_call_events`, the Node WABA call bridge, STT/TTS keys; shared route ownership for `api/waba-*`, `api/call-flow/active`, `api/flow-node/*` and the per-channel `api/*/flow-*` callbacks (these routes are listed by FLB and by NODE; FLB documents the behaviour, NODE owns the bridge).
- **AIAG / AIADM / AICRM:** AI keys and `AiKeyResolver` (workspace key, then admin key), provider calls (`AiAgentService::callProvider`), training assistants and knowledge-base context (WD-FLB-054, 063, 067).
- **CON (contacts, tags, groups):** contact lookup by phone (decrypted scan), tag and group events, `Contact::canonicalizePhone`, opt-in flag; **WS / tenancy:** workspace Away flag, business hours, AI responder mode, timezone (`wa_tz()`).
- **Channel domains (IG, FB, TG, TT, LINE, WECH, VIB, MAIL):** connected accounts for the Trigger sender and palette availability, inbox mirroring (`conversations`, `inbox_messages`), the runners and bridges. The Instagram native routes `api/instagram/flow-node` and `flow-log` are called by the runner but not defined in this tree.
- **ECOM / CAT / CHK (ordering, catalog, stores):** `OrderingService`, products, stock holds, orders, group directory and notifier behind WD-FLB-068; checkout-link builders for commerce nodes (WD-FLB-052).
- **TPL / AR:** templates for the Send template node, the managed keyword row that actually fires keyword flows; **ADDON:** Instaflow connection and extension flags (WD-FLB-079); **PLAN:** `flow_limit`, `facebook_comments`, `access_sales_pipeline`, paywall; **SET / NODE:** node token, Node URL (`baileys_server_url`, `SERVER_URL`).

Exposes:

- **To FLR:** the saved graph and trigger columns (`flows.flow_data`, `trigger_kind`, `trigger_value`, `trigger_keywords`, sender), the node type matrix and `portsFor(node)`, the normalizer mapping tables of WD-FLB-070 as the reference for `compileGraph`.
- **To the Node bridge (WaDesk) / worker (port):** `GET api/flows/{id}` and the node-callback endpoints of WD-FLB-054 to 069 (token authenticated).
- **To API clients:** `GET api/v1/flows`, `GET api/v1/flows/{id}`, `POST api/v1/flows/{id}/enroll`, `GET api/v1/flows/{id}/subscribers` (shared with FLR WD-FLR-009 in the port).
- **To other domains:** `FlowEnrollmentService` entry points (`enroll`, `onTagAdded`, `onConversationTagged`, `onGroupJoin`, `onContactCreated`, `onOptIn`, `onOrderPlaced`, `onDealStageChanged`, `onInboundMessage`) called by contacts, team inbox, routing, orders, deals and keyword dispatch; the `flows` table for the keyword-reply, mobile app (`api/app/getflows`, `chats/{id}/flow`) and dashboard counters (`FlowSubscriber` counts in the user dashboard).
- **Shared with others, claimed in more than one coverage block:** `GoogleFormSession` / `google_form_sessions` and the `api/*` node-callback routes (NODE domain), `api/v1/flows*` (FLR), the Telegram and Facebook callbacks (channel domains).

## Open questions & quirks

Everything marked QUIRK or "static reading" below comes from reading the source of the v1.7.0 tree; none was confirmed live except the database schema. Verify with `wadesk-verify-parity` before treating any of them as intended behaviour.

1. **Completed is never recorded.** No code sets `flow_subscribers.status = 'completed'` or `completed_at` (the Node bridge ignores the `flowSubscriberId` it is sent). Completed counts, completion rate, average time and retry outcome `succeeded` are always empty in real data (WD-FLB-074 to 077). FLR fixes this.
2. **Platform secret exposure.** The downloaded Google Apps Script embeds the platform node token (WD-FLB-059) and the ordering recipe asks the author to paste the same token into Webhook-node headers inside the flow graph (WD-FLB-068). Do not carry either forward.
3. **Condition evaluator split.** LINE, WeChat, Viber and Email honour `conditions[]` with AND / OR; TikTok, Telegram, Instagram and Facebook read flat fields the builder never writes and so always take `yes` (WD-FLB-067, 064). By static reading only.
4. **Defects carried from the builder card:** multi-port nodes (book appointment, commerce, deal, call menu) render one output dot, so their second branch is only reachable from imported or seeded graphs (WD-FLB-017 rule 1; WD-FLB-053, 060, 063).
5. **Dead or unwired pieces:** `api/flow-node/wa-form-send` has no caller (the Node runner sends the form itself); the booking pay-link route `api/booking/pay-link` does not exist; `collectEmail` and `calendarOverride` are stored but never read; the Meet "send invite" toggle sends no attendees; Menu `mode` and Listen `silenceTimeout` are ignored by the call runtime; the `timeout` port of the Google Form node never fires; `flow_connected_devices` is unused; the four `flows.*` permission keys are checked nowhere; per-channel `*_flow_sessions` tables are dead.
6. **Palette versus runner mismatches:** Condition, Wait, Webhook and Run code are offered on call flows but the call runtime skips them; the runners implement `ig_gallery` and legacy `fb_*` nodes that have no palette entry; `ig_buttons` resumes on `p<i>` while the builder wires `out`.
7. **Missing server pieces:** the Instagram native callbacks (`api/instagram/flow-node`, `api/instagram/flow-log`) are not defined here; the Instagram extension is an add-on that this reference tree does not contain.
8. **Open question, Telegram currencies:** IDR is sent as a zero-decimal currency; confirm against the Bot API currency table (WD-FLB-066).
9. **Counts capped:** the subscriber list counts only the returned rows (200 web, `limit` API), so totals above that are wrong (WD-FLB-073).
10. **Retention gaps:** `flow_retry_logs`, `flow_connected_devices` and `google_form_sessions` are not removed by the expired-workspace wipe, which lists only `flows` and `flow_subscribers`.
11. **Enrolment oddities:** a contact enters a flow once ever; the Meta-agent suppression leaves an `active` subscriber that never ran; the manual enrol UI asks for a typed group name (case-sensitive) in a browser prompt; the enrol route ignores `is_published` and the trigger kind.
12. **Documentation not cross-checked:** the `Documentation/` pages for these nodes were not compared with the code for entries 053 to 080, so `docs-only` claims (a documented node with no code path) are not ruled out.
13. **Ordering feature activation is implicit:** the inbound pipeline finds the order flow by scanning every live flow's decrypted graph for a URL string (WD-FLB-068).

## Coverage

```json wadesk-coverage
{
  "routes": [
    "DELETE admin/flow-templates/{id}",
    "DELETE flows/api/{id}",
    "DELETE flows/{id}",
    "GET admin/flow-templates",
    "GET admin/flow-templates/create",
    "GET admin/flow-templates/{id}/edit",
    "GET api/flows/{id}",
    "GET api/google/picker/{kind}",
    "GET api/v1/flows",
    "GET api/v1/flows/{id}",
    "GET api/v1/flows/{id}/subscribers",
    "GET api/waba-call/assistant/{id}",
    "GET api/waba-call/voice-keys",
    "GET api/waba-creds",
    "GET flows",
    "GET flows/analytics",
    "GET flows/analytics/data",
    "GET flows/analytics/errors",
    "GET flows/analytics/retries",
    "GET flows/analytics/runs",
    "GET flows/analytics/{id}",
    "GET flows/api/ai-assistants",
    "GET flows/api/ai-models",
    "GET flows/api/call-assistants",
    "GET flows/api/commerce/stores",
    "GET flows/api/commerce/stores/{storeId}/products",
    "GET flows/api/default",
    "GET flows/api/list",
    "GET flows/api/picker",
    "GET flows/api/{id}",
    "GET flows/builder",
    "GET flows/builder/{id}",
    "GET flows/import-ig/{igId}",
    "GET flows/{id}/export",
    "GET flows/{id}/subscribers",
    "GET google-account/forms/{formId}/apps-script.gs",
    "POST admin/flow-templates",
    "POST admin/flow-templates/{id}/toggle",
    "POST api/call-flow/active",
    "POST api/commerce/check-inventory",
    "POST api/commerce/checkout-link",
    "POST api/commerce/waba-send-products",
    "POST api/email/flow-log",
    "POST api/email/flow-node",
    "POST api/email/flow-send",
    "POST api/facebook/flow-log",
    "POST api/facebook/flow-node",
    "POST api/flow-node/ai-agent-reply",
    "POST api/flow-node/ai-call",
    "POST api/flow-node/assign",
    "POST api/flow-node/deal-action",
    "POST api/flow-node/google-meet",
    "POST api/flow-node/google/doc-generate",
    "POST api/flow-node/google/form-send",
    "POST api/flow-node/google/sheet-read",
    "POST api/flow-node/google/sheet-write",
    "POST api/flow-node/mysql-query",
    "POST api/flow-node/order-cancel",
    "POST api/flow-node/order-confirm",
    "POST api/flow-node/order-parse",
    "POST api/flow-node/order-reply",
    "POST api/flow-node/order-shipping",
    "POST api/flow-node/place-ai-call",
    "POST api/flow-node/tag",
    "POST api/flow-node/wa-form-send",
    "POST api/flow-node/web-search",
    "POST api/flow/store-media",
    "POST api/google/form-response",
    "POST api/line/flow-log",
    "POST api/line/flow-node",
    "POST api/telegram/flow-log",
    "POST api/telegram/flow-node",
    "POST api/tiktok/flow-log",
    "POST api/tiktok/flow-node",
    "POST api/upload-media",
    "POST api/v1/flows/{id}/enroll",
    "POST api/viber/flow-log",
    "POST api/viber/flow-node",
    "POST api/waba-call/bridge-accepted",
    "POST api/waba-call/bridge-error",
    "POST api/waba-call/bridge-offer",
    "POST api/waba-call/transcript-turn",
    "POST api/wechat/flow-node",
    "POST api/wechat/flow-send",
    "POST flows/analytics/runs/retry",
    "POST flows/analytics/runs/{subscriber}/retry",
    "POST flows/api/ai-generate",
    "POST flows/api/connect",
    "POST flows/api/disconnect/{id}",
    "POST flows/api/publish",
    "POST flows/api/save",
    "POST flows/api/test-webhook",
    "POST flows/api/unpublish",
    "POST flows/api/upload-media",
    "POST flows/import",
    "POST flows/templates/{id}/clone",
    "POST flows/{id}/duplicate",
    "POST flows/{id}/enroll",
    "POST flows/{id}/rename",
    "POST flows/{id}/subscribers/{cid}/pause",
    "POST flows/{id}/subscribers/{cid}/resume",
    "POST flows/{id}/toggle",
    "PUT admin/flow-templates/{id}"
  ],
  "controllers": [
    "app/Http/Controllers/FlowsController.php",
    "app/Http/Controllers/FlowNodeActionsController.php",
    "app/Http/Controllers/FlowsCommerceController.php",
    "app/Http/Controllers/Admin/FlowTemplateController.php",
    "app/Http/Controllers/GoogleFlowNodeController.php",
    "app/Http/Controllers/Api/V1/FlowController.php",
    "app/Http/Controllers/Facebook/FacebookFlowNodeController.php",
    "app/Http/Controllers/Line/LineFlowNodeController.php",
    "app/Http/Controllers/Mailtrixy/EmailFlowNodeController.php",
    "app/Http/Controllers/Telegram/TelegramFlowNodeController.php",
    "app/Http/Controllers/Tiktok/TiktokFlowNodeController.php",
    "app/Http/Controllers/Viber/ViberFlowNodeController.php",
    "app/Http/Controllers/WeChat/WeChatFlowNodeController.php"
  ],
  "services": [
    "app/Services/Flows/FlowNormalizer.php",
    "app/Services/Flow/FlowEnrollmentService.php",
    "app/Services/Flow/FlowRetryService.php",
    "app/Services/Google/GoogleApiService.php",
    "app/Services/Instaflow/InstaflowClient.php",
    "app/Services/Ordering/GroupDirectory.php",
    "app/Services/Ordering/GroupNotifier.php",
    "app/Services/Ordering/InventoryService.php",
    "app/Services/Ordering/OrderMediaResolver.php",
    "app/Services/Ordering/OrderingService.php",
    "app/Services/Ordering/ProductMatcher.php"
  ],
  "models": [
    "Flow",
    "FlowTemplate",
    "FlowConnectedDevice",
    "FlowSubscriber",
    "FlowRetryLog",
    "GoogleFormSession"
  ],
  "tables": [
    "flows",
    "flow_templates",
    "flow_connected_devices",
    "flow_subscribers",
    "flow_retry_logs",
    "google_form_sessions"
  ],
  "views": [
    "resources/views/user/flows/index.blade.php",
    "resources/views/user/flows/_cards.blade.php",
    "resources/views/user/flows/_featured.blade.php",
    "resources/views/user/flows/builder.blade.php",
    "resources/views/user/flows/analytics.blade.php",
    "resources/views/admin/flow-templates/index.blade.php",
    "resources/views/admin/flow-templates/form.blade.php"
  ],
  "permissions": [
    "flows.view",
    "flows.create",
    "flows.edit",
    "flows.delete"
  ],
  "js_assets": [
    "resources/js/charts/user-flows-builder.js",
    "resources/js/charts/user-flows-index.js",
    "resources/js/charts/user-flows-analytics.js"
  ],
  "misc_files": [
    "app/Http/Requests/Api/V1/Flow/EnrollFlowRequest.php",
    "app/Http/Resources/Api/V1/FlowResource.php"
  ],
  "feature_map": {
    "WD-FLB-001": [
      "GET flows"
    ],
    "WD-FLB-003": [
      "GET flows/builder",
      "GET flows/builder/{id}"
    ],
    "WD-FLB-004": [
      "POST flows/{id}/toggle"
    ],
    "WD-FLB-005": [
      "POST flows/{id}/rename"
    ],
    "WD-FLB-006": [
      "POST flows/{id}/duplicate"
    ],
    "WD-FLB-007": [
      "DELETE flows/{id}",
      "DELETE flows/api/{id}"
    ],
    "WD-FLB-008": [
      "GET flows/{id}/export"
    ],
    "WD-FLB-009": [
      "POST flows/import"
    ],
    "WD-FLB-010": [
      "POST flows/templates/{id}/clone"
    ],
    "WD-FLB-011": [
      "GET admin/flow-templates",
      "POST admin/flow-templates/{id}/toggle",
      "DELETE admin/flow-templates/{id}"
    ],
    "WD-FLB-012": [
      "GET admin/flow-templates/create",
      "POST admin/flow-templates",
      "GET admin/flow-templates/{id}/edit",
      "PUT admin/flow-templates/{id}"
    ],
    "WD-FLB-019": [
      "POST flows/api/save"
    ],
    "WD-FLB-022": [
      "POST flows/api/publish",
      "POST flows/api/unpublish"
    ],
    "WD-FLB-024": [
      "POST flows/api/test-webhook"
    ],
    "WD-FLB-025": [
      "POST flows/api/ai-generate"
    ],
    "WD-FLB-026": [
      "GET flows/api/picker",
      "GET flows/api/ai-models",
      "GET flows/api/ai-assistants",
      "GET flows/api/call-assistants",
      "GET flows/api/list",
      "GET flows/api/default",
      "GET flows/api/{id}"
    ],
    "WD-FLB-027": [
      "POST flows/api/upload-media",
      "POST api/upload-media",
      "POST api/flow/store-media"
    ],
    "WD-FLB-042": [
      "POST api/flow-node/mysql-query"
    ],
    "WD-FLB-043": [
      "POST api/flow-node/ai-call"
    ],
    "WD-FLB-044": [
      "POST api/flow-node/tag"
    ],
    "WD-FLB-045": [
      "POST api/flow-node/assign"
    ],
    "WD-FLB-051": [
      "POST api/flow-node/ai-agent-reply"
    ],
    "WD-FLB-052": [
      "GET flows/api/commerce/stores",
      "GET flows/api/commerce/stores/{storeId}/products",
      "POST api/commerce/check-inventory",
      "POST api/commerce/checkout-link",
      "POST api/commerce/waba-send-products"
    ],
    "WD-FLB-054": [
      "POST api/flow-node/place-ai-call"
    ],
    "WD-FLB-055": [
      "POST api/flow-node/google-meet"
    ],
    "WD-FLB-056": [
      "POST api/flow-node/wa-form-send"
    ],
    "WD-FLB-057": [
      "GET api/google/picker/{kind}",
      "POST api/flow-node/google/sheet-write",
      "POST api/flow-node/google/sheet-read"
    ],
    "WD-FLB-058": [
      "POST api/flow-node/google/doc-generate"
    ],
    "WD-FLB-059": [
      "POST api/flow-node/google/form-send",
      "POST api/google/form-response",
      "GET google-account/forms/{formId}/apps-script.gs"
    ],
    "WD-FLB-060": [
      "POST api/flow-node/deal-action"
    ],
    "WD-FLB-063": [
      "POST api/call-flow/active",
      "POST api/flow-node/web-search"
    ],
    "WD-FLB-065": [
      "POST api/facebook/flow-log",
      "POST api/facebook/flow-node"
    ],
    "WD-FLB-067": [
      "POST api/tiktok/flow-log",
      "POST api/tiktok/flow-node",
      "POST api/line/flow-log",
      "POST api/line/flow-node",
      "POST api/wechat/flow-send",
      "POST api/wechat/flow-node",
      "POST api/viber/flow-log",
      "POST api/viber/flow-node",
      "POST api/email/flow-send",
      "POST api/email/flow-log",
      "POST api/email/flow-node",
      "POST api/telegram/flow-log",
      "POST api/telegram/flow-node"
    ],
    "WD-FLB-068": [
      "POST api/flow-node/order-parse",
      "POST api/flow-node/order-shipping",
      "POST api/flow-node/order-confirm",
      "POST api/flow-node/order-cancel",
      "POST api/flow-node/order-reply"
    ],
    "WD-FLB-069": [
      "GET api/waba-creds",
      "GET api/waba-call/voice-keys",
      "GET api/waba-call/assistant/{id}",
      "POST api/waba-call/bridge-accepted",
      "POST api/waba-call/bridge-error",
      "POST api/waba-call/transcript-turn",
      "POST api/waba-call/bridge-offer"
    ],
    "WD-FLB-070": [
      "GET api/flows/{id}"
    ],
    "WD-FLB-072": [
      "POST flows/{id}/enroll",
      "POST api/v1/flows/{id}/enroll",
      "GET api/v1/flows",
      "GET api/v1/flows/{id}"
    ],
    "WD-FLB-073": [
      "GET flows/{id}/subscribers",
      "POST flows/{id}/subscribers/{cid}/pause",
      "POST flows/{id}/subscribers/{cid}/resume",
      "GET api/v1/flows/{id}/subscribers"
    ],
    "WD-FLB-074": [
      "GET flows/analytics",
      "GET flows/analytics/{id}",
      "GET flows/analytics/data"
    ],
    "WD-FLB-075": [
      "GET flows/analytics/runs"
    ],
    "WD-FLB-076": [
      "GET flows/analytics/errors"
    ],
    "WD-FLB-077": [
      "POST flows/analytics/runs/{subscriber}/retry",
      "POST flows/analytics/runs/retry",
      "GET flows/analytics/retries"
    ],
    "WD-FLB-078": [
      "POST flows/api/connect",
      "POST flows/api/disconnect/{id}"
    ],
    "WD-FLB-079": [
      "GET flows/import-ig/{igId}"
    ]
  }
}
```
