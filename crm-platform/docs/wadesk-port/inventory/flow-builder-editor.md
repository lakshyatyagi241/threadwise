---
domain: flow-builder-editor
code: FLB
title: Flow Builder, Editor and Node Catalogue
wadesk_version: '1.7.0'
sources_read: 46
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
