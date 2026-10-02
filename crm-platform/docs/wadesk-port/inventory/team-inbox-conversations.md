---
domain: team-inbox-conversations
code: TIB1
title: Team Inbox - Conversations, Assignment, Composer, Labels, Notes and PWA
wadesk_version: '1.7.0'
sources_read: 64
---

# Team Inbox - Conversations, Assignment, Composer, Labels, Notes and PWA

## Overview

The Team Inbox (`/team-inbox`) is WaDesk's shared, multi-channel support desk. Every customer thread on every connected sender (Unofficial WhatsApp via the Node/Baileys bridge, WhatsApp Cloud API/WABA, Twilio, plus Instagram, Messenger, TikTok, Telegram, LINE, WeChat, Viber, SMS, email and the web chat widget) lands in one `conversations` table with its messages in `inbox_messages`. Workspace members work the queue: they open a thread, reply with text, templates, media, voice notes or catalog cards, hand it to a person, a team or an AI agent, label it, leave internal notes and @mentions, resolve it, and see teammates viewing or typing in real time. Managers additionally use bulk actions, the kanban board and a duplicate-thread merge tool. An installable PWA variant scoped to `/team-inbox` can push notifications to agents.

Who uses it: workspace owners/admins/managers/agents (viewers read only); platform staff can read any thread through the separate admin console (ASHELL/RBAC/WSP own that surface). End customers never see it.

Main flow end to end: an inbound message (ingested by WADEV/WABA/NODE/channel domains) finds or creates the single thread for that number (WD-TIB1-042), reopens it, bumps unread and last-inbound time, triggers SLA/routing/auto-reply (TIB2, AR) and broadcasts `message.received`. The list (`queue`) shows it; an agent opens it (`show`), the unread counter clears, presence starts. The agent replies (`reply/media/voice/catalog/compose`), the dispatcher sends over the thread's own channel and number and the row goes `pending -> sent|failed`, delivery ticks arrive from provider callbacks. Assignment, priority, labels, notes, snooze and resolve change state and write `conversation_events`; outbound webhooks and audit rows record the important ones. Realtime (Pusher) and 3-5 s polling keep other agents in sync.

Plan tiers: kanban (`access_kanban_view`), AI suggestions and AI attach (`access_ai_agents`), Sales Pipeline deals panel (`access_sales_pipeline`), translation (`access_translation`), and numeric caps `saved_replies_limit`, `tags_limit`, `monthly_messages_limit` (with wallet overflow) change what an org can do; routing rules, SLA, business hours, team performance and outbound webhooks are gated in TIB2/INTG.

Connections: TIB2 (team-inbox-routing-sla: routing rules, SLA policies and sweeps, business hours, snooze, escalation, analytics/stats); WSP (teams, members, workspace timezone, starter tags); RBAC (`WorkspacePermissions`, `ConversationPolicy`); NOTIF (in-app notifications, audit logger, Web Push, PWA endpoints); I18N (translation service); WALLET/BSP (message metering); PLAN (feature/limit guard); SET (media storage, emergency halt, realtime, PWA settings); WADEV/NODE (Baileys bridge); WABA (Graph API, coexistence); TPL (templates); CON (contacts, attributes); AIAG/AIADM (AI agents, keys); FLR (tag-triggered flow enrollment); DEAL (deals); CAT/STORE (catalog products); INTG (Google Meet); the channel domains FB/IG/TG/TT/LINE/WECH/VIB/SMS/MAIL (inbound + outbound adapters); CALL (calling button); API/MOB (their own conversation APIs over the same tables).

### Boundary and handoffs (read before splitting work)

- TIB1 (this file) owns: the inbox shell and bootstrap, queue/list/filters/counts, opening a thread, all composer send paths and the outbound dispatch pipeline, message actions, assignment (manual + `AssignmentService` strategies), AI attach/detach and human takeover, resolve/reopen, priority, labels and the tag master list, internal notes and mentions, bulk actions, archive/pin/mute, duplicate merge, conversation identity resolution, lifecycle contract, outbound mirror, kanban, presence, agent status, outbound event webhooks, deal creation from a thread, the PWA client shell, and the inbox permission gates.
- TIB2 owns (routes left out of this file's coverage): `POST team-inbox/api/conversations/{id}/snooze`, `GET|POST|PATCH|DELETE team-inbox/api/routing*`, `GET|POST team-inbox/api/business-hours`, `GET|POST|PATCH team-inbox/api/sla*`, `GET|POST|PUT|DELETE team-inbox/sla*` (web page), `GET team-inbox/api/stats`, `GET team-inbox/analytics/*`, `GET team-inbox/api/analytics/*`, the commands `inbox:escalate` and `inbox:wake-snoozed`, `SlaTracker`, `RoutingEngine`, `AutoReplyGuard`, the `SlaBreached` event, and the sweeps piggy-backed on the queue poll (WD-TIB1-007 only documents the trigger).
- WSP owns `team-inbox/api/teams*`, `team-inbox/members*`, `team-inbox/api/members*`; AIAG/AIADM own `team-inbox/api/ai-agents*` and `team-inbox/api/ai-keys*`; TCHAT owns `team-inbox/api/team-chat*` and `user/team-inbox/team-chat.blade.php`; NOTIF owns `team-inbox/api/me/notifications*`, `team-inbox-manifest.json`, `team-inbox/api/push/*`, `TeamInboxPwaController`, Web Push services and `NotificationDispatcher`; ASHELL/RBAC/WSP/SUPP own `admin/team-inbox*` and `admin/support/team-inbox` (platform moderation consoles); INTG owns the Google Meet endpoint used by the composer.

## Feature index

| Id          | Feature                                                                          | Status      | Priority | Effort | Depends on                            |
| ----------- | -------------------------------------------------------------------------------- | ----------- | -------- | ------ | ------------------------------------- |
| WD-TIB1-001 | Team Inbox page shell (`GET /team-inbox`)                                        | implemented | P0       | M      | WD-TIB1-002, WD-TIB1-003              |
| WD-TIB1-002 | Inbox bootstrap payload (`GET /team-inbox/api/bootstrap`)                        | implemented | P0       | S      | WD-TIB1-001                           |
| WD-TIB1-003 | Conversation queue API (`GET /team-inbox/api/queue`)                             | implemented | P0       | L      | WD-TIB1-006, WD-TIB1-004              |
| WD-TIB1-004 | Queue tab counts and role-based visibility                                       | implemented | P0       | M      | WD-TIB1-003                           |
| WD-TIB1-005 | Queue list UI, channel rail, alerts and polling                                  | implemented | P0       | L      | WD-TIB1-003, WD-TIB1-015              |
| WD-TIB1-006 | Conversation visibility scoping (engine set, agnostic channels, live devices)    | implemented | P0       | M      | none                                  |
| WD-TIB1-007 | Scheduler-less sweeps piggy-backed on the queue poll                             | implemented | P1       | S      | WD-TIB1-003                           |
| WD-TIB1-008 | Global unread bell and "last seen" watermark                                     | implemented | P1       | S      | WD-TIB1-006                           |
| WD-TIB1-009 | Open a conversation (`GET /team-inbox/api/conversations/{id}`)                   | implemented | P0       | L      | WD-TIB1-003                           |
| WD-TIB1-010 | Thread delta polling and older-message paging                                    | implemented | P1       | M      | WD-TIB1-009                           |
| WD-TIB1-011 | Thread rendering: bubbles, media, templates and status ticks                     | implemented | P0       | XL     | WD-TIB1-009                           |
| WD-TIB1-012 | Contact side panel (profile, orders, past conversations, inline rename)          | implemented | P1       | M      | WD-TIB1-009                           |
| WD-TIB1-013 | Activity timeline (conversation events)                                          | implemented | P1       | S      | WD-TIB1-009                           |
| WD-TIB1-014 | Presence and typing collision detection                                          | implemented | P1       | M      | WD-TIB1-009                           |
| WD-TIB1-015 | Realtime broadcast events and Echo client                                        | partial     | P1       | M      | WD-TIB1-005                           |
| WD-TIB1-016 | 24-hour customer-care window (WABA, Twilio, Instagram, Messenger)                | implemented | P0       | S      | WD-TIB1-009                           |
| WD-TIB1-017 | Text reply to a conversation (`POST .../reply`)                                  | implemented | P0       | L      | WD-TIB1-009, WD-TIB1-026              |
| WD-TIB1-018 | Template reply with send-time variable mapping                                   | implemented | P0       | L      | WD-TIB1-017                           |
| WD-TIB1-019 | Media attachment reply (`POST .../media`)                                        | implemented | P0       | M      | WD-TIB1-017                           |
| WD-TIB1-020 | Voice note reply (`POST .../voice`)                                              | implemented | P1       | M      | WD-TIB1-017                           |
| WD-TIB1-021 | Catalog message from the composer (SPM / MPM / link)                             | partial     | P2       | M      | WD-TIB1-017                           |
| WD-TIB1-022 | Google Meet link insertion in the composer                                       | implemented | P2       | S      | WD-TIB1-017                           |
| WD-TIB1-023 | AI reply suggestion (draft, never auto-sent)                                     | implemented | P2       | S      | WD-TIB1-017                           |
| WD-TIB1-024 | Saved (canned) replies: picker, shortcuts and management                         | implemented | P1       | M      | WD-TIB1-002                           |
| WD-TIB1-025 | New outbound message to many recipients (Compose)                                | implemented | P1       | L      | WD-TIB1-026, WD-TIB1-042              |
| WD-TIB1-026 | Outbound dispatch pipeline (`InboxDispatcher::send`)                             | implemented | P0       | XL     | none                                  |
| WD-TIB1-027 | Message actions: info, pin, star, react                                          | implemented | P2       | M      | WD-TIB1-011                           |
| WD-TIB1-028 | Edit and delete a message                                                        | implemented | P2       | M      | WD-TIB1-027                           |
| WD-TIB1-029 | Forward a message into another conversation                                      | partial     | P2       | S      | WD-TIB1-017                           |
| WD-TIB1-030 | Add a shared contact card to Contacts (`extract-contact`)                        | implemented | P2       | S      | WD-TIB1-011                           |
| WD-TIB1-031 | Retry download of failed WABA media (`retry-media`)                              | implemented | P2       | S      | WD-TIB1-011                           |
| WD-TIB1-032 | Assign and unassign a conversation (people and teams) with assignment strategies | implemented | P0       | L      | WD-TIB1-009                           |
| WD-TIB1-033 | Attach or detach an AI agent / voice assistant; human takeover                   | implemented | P1       | M      | WD-TIB1-032                           |
| WD-TIB1-034 | Resolve and reopen a conversation                                                | partial     | P0       | M      | WD-TIB1-009                           |
| WD-TIB1-035 | Conversation priority                                                            | implemented | P1       | S      | WD-TIB1-009                           |
| WD-TIB1-036 | Labels (tags) on a conversation                                                  | implemented | P0       | M      | WD-TIB1-037                           |
| WD-TIB1-037 | Workspace label master list (`tags`)                                             | implemented | P1       | S      | none                                  |
| WD-TIB1-038 | Internal notes and @mentions                                                     | implemented | P0       | M      | WD-TIB1-009                           |
| WD-TIB1-039 | Bulk actions on selected conversations (`POST /bulk`)                            | implemented | P1       | M      | WD-TIB1-005                           |
| WD-TIB1-040 | Row context menu, archived view, pin and mute                                    | implemented | P2       | S      | WD-TIB1-039                           |
| WD-TIB1-041 | Find and merge duplicate conversations                                           | implemented | P2       | L      | WD-TIB1-042                           |
| WD-TIB1-042 | One thread per number: conversation identity resolution                          | implemented | P0       | M      | none                                  |
| WD-TIB1-043 | Conversation lifecycle: statuses and inbound contract                            | implemented | P0       | M      | WD-TIB1-042                           |
| WD-TIB1-044 | Mirror bulk sends into existing threads (`InboxMirror`)                          | implemented | P1       | S      | WD-TIB1-042                           |
| WD-TIB1-045 | Kanban board (`GET /team-inbox/kanban`)                                          | implemented | P2       | M      | WD-TIB1-003, WD-TIB1-032, WD-TIB1-034 |
| WD-TIB1-046 | Agent availability status and activity tracking                                  | partial     | P1       | S      | none                                  |
| WD-TIB1-047 | Outbound event webhooks for conversations                                        | partial     | P2       | M      | WD-TIB1-017, WD-TIB1-032, WD-TIB1-034 |
| WD-TIB1-048 | Create a deal from a conversation and show the contact's deals                   | implemented | P2       | M      | WD-TIB1-009                           |
| WD-TIB1-049 | Run an Instagram flow on an Instagram thread                                     | implemented | P2       | S      | WD-TIB1-009                           |
| WD-TIB1-050 | Coexistence: import 6-month WhatsApp history (`sync-history`)                    | implemented | P2       | S      | none                                  |
| WD-TIB1-051 | Team Inbox as an installable PWA (client shell)                                  | implemented | P2       | S      | WD-TIB1-001                           |
| WD-TIB1-052 | Inbox authorization model (roles, permission keys, gates)                        | implemented | P0       | M      | none                                  |
| WD-TIB1-053 | Inbox client preferences, deep links and mobile layout                           | implemented | P2       | S      | WD-TIB1-005                           |
| WD-TIB1-054 | Advertised in docs/UI but not reachable                                          | docs-only   | P2       | S      | none                                  |
| WD-TIB1-055 | Dead or unreachable inbox code                                                   | dead-code   | P2       | S      | none                                  |

## Features

### WD-TIB1-001 — Team Inbox page shell (`GET /team-inbox`)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TIB1-002, WD-TIB1-003
- **Summary:** The full-screen "Unified Inbox" page: a dark icon rail, the conversation queue column, the thread pane with composer, and a collapsible contact/collaboration column. The controller pre-computes a handful of server-rendered values (connected sender count, template library, device/channel filter options, headline stats, workspace timezone) and everything else is fetched by JSON.
- **Actors & access:** Any authenticated workspace member (middleware `Authenticate` only; no role gate, no plan gate). Rail icons are hidden per workspace permission (`@canWorkspace` blade directive): Members/Invite = `member.invite`; AI Agents = `integration.manage`; Routing rules = `routing.manage`; Quick replies = `savedreply.manage`; SLA = `sla.manage`; Analytics = `analytics.view`; the duplicate-merge button = `inbox.bulk`. Tiles for Routing/SLA/Kanban/AI/Business hours/Webhooks/Team analytics carry a plan "crown" badge (`access_routing_rules`, `access_sla_policies`, `access_kanban_view`, `access_ai_agents`, `access_business_hours`, `access_outbound_webhooks`, `access_team_performance`) but the page itself is never blocked by them.
- **UX & screens:** `resources/views/user/team-inbox/index.blade.php` (layout `x-layouts.user`, header hidden, `nav-key=team-inbox`). Column 1 = dark rail (channel filter icons All/WhatsApp/Instagram/Messenger/TikTok/Telegram/SMS/Email rendered from a `data-channels` list of CONNECTED channels, feature links, Teams modal launcher, Kanban link, Members link, invite button, back-to-devices link; icons that do not fit move into a "More tools" flyout). Column 2 = queue (title, "new message" button, refresh, account menu with reload/My account/Log out, merge-duplicates button, optional history-sync button, search box, segmented tabs All / Mine / Unassigned / @me / Unread, optional device filter select, label filter select, bulk "Select" toggle, active-team label, Archived row, scrolling list, bulk action bar, presence avatar strip linking to Members). Column 3 = thread (compose-new panel overlay, thread header, quick-label strip, message list, resolution banner, composer with Reply / Internal note / Template / Shortcuts tabs). Column 4 = contact panel (see WD-TIB1-012). States: skeleton shimmer until the first queue response; "getting started" panel (3 setup steps, and a how-to with per-device "Open WhatsApp" test links) when the workspace has zero conversations AND the user holds `team.manage`; otherwise an "empty selection" dashboard (Open threads / Unassigned / Unread cards, connected-number list linking to `?device_id=engine:id`, "Jump to" tiles, "How this inbox works") or, when no sender is connected at all, a single "Connect a device" call to action. Many modals live in this blade but belong to other domains (invite member, create/edit team = WSP; AI agents and API keys = AIAG/AIADM; routing rules and business hours and stats = TIB2; quick replies = WD-TIB1-024); the incoming-WhatsApp-call toast/panel = CALL.
- **Endpoints:**

| Endpoint       | Route name      | Action                    | Middleware   | Request                                                     | Response  |
| -------------- | --------------- | ------------------------- | ------------ | ----------------------------------------------------------- | --------- |
| GET team-inbox | user.team-inbox | TeamInboxController@index | Authenticate | optional `?device_id=engine:id`, `#c=<conversationId>` hash | HTML view |

- **Data:** Writes `users.inbox_last_seen_at = now()` on every page view (resets the global bell, WD-TIB1-008). Reads: `devices` (workspace users' devices; `status`, `active`, `country_code`, `phone_number`, `device_name`), `wa_provider_configs` (connected waba/twilio/sms, plus a coexistence flag inside `meta_json`), `instagram_accounts`, `wa_templates`, `conversations` (stats), `ai_agents`, `workspaces.timezone`.
- **Rules & edge cases:**
  1. Connected-device count sums across every enabled engine: for Baileys it is `max(devices connected+active for any workspace member, mine, any-status active mine)`; for WABA/Twilio it adds the count of CONNECTED provider configs. It only drives the getting-started copy.
  2. Template library for the composer Template tab = every `wa_templates` row the workspace can see, newest first, minus WABA templates that are not Meta-approved (`meta_template_id` present AND `meta_status` = APPROVED) or whose provider config is no longer connected. Baileys/Twilio/Instagram templates keep every status (a status pill shows on the card). Each entry ships id, title, category (default `utility`), header, body, footer, buttons, media type, status (default `approved`), channel (`engineKey`) and `send_meta`.
  3. Device/channel filter options list ALL paired Baileys devices (connected or not, active first), all CONNECTED WABA/Twilio/SMS provider configs, and CONNECTED Instagram accounts. Option value is `engine:id` (`baileys:3`, `waba:5`, `twilio:2`, `sms:9`, `instagram:4`) because `conversations.device_id` is polymorphic (devices.id for Baileys, wa_provider_configs.id for WABA/Twilio). The select renders only when there is more than one option. SMS labels strip a leading "SMS ·" to avoid a double prefix. Instagram lookup is wrapped in try/catch so a missing add-on table degrades to no IG options instead of a 500.
  4. `coexHistoryConfigId` is set only for owners/admins/managers (platform admins bypass) when a connected WABA config has `meta_json.coexistence` truthy; it reveals the history-sync button (WD-TIB1-050).
  5. `inboxStats` counts (workspace, current-engine, live-device, `archived = false`): total = inbox_status in (open, pending); unassigned = same set with `assignee_user_id` null (an AI agent does NOT count as assigned); unread = `unread_count > 0` (any status).
  6. `aiSuggestEnabled` requires plan feature `access_ai_agents` AND at least one active `ai_agents` row; otherwise the AI suggestion bar (WD-TIB1-023) is not rendered at all.
  7. `inboxTz` = workspace timezone (validated via `safe_timezone`, fallback app timezone) and drives ALL message-time display so every agent sees the same account clock.
  8. The user layout swaps the app manifest for the Team-Inbox PWA partial on this page when `ti_pwa_enabled` (WD-TIB1-051).
- **Async & events:** None server side. Client starts queue/thread polling and optional Echo subscription (WD-TIB1-005, WD-TIB1-015).
- **External systems:** none.
- **Settings:** `system_settings`: `ti_pwa_enabled`, `sms_enabled`, `email_enabled`, `instagram_enabled`; workspace `timezone`.
- **Acceptance criteria:**
  - Given a signed-in agent, When they open `/team-inbox`, Then the page renders for any role and `users.inbox_last_seen_at` becomes the current time.
  - Given a workspace with a connected WABA number, a Baileys device and a connected Instagram account, When the page renders, Then the device filter offers three options with values `waba:<id>`, `baileys:<id>`, `instagram:<id>`.
  - Given a workspace with zero conversations and a user holding `team.manage`, When the first queue response arrives, Then the getting-started panel shows instead of the empty-selection dashboard.
  - Given a WABA template that is not APPROVED, When the composer Template tab is built, Then that template is absent while an unapproved Instagram template is present.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (index), resources/views/user/team-inbox/index.blade.php, resources/views/components/layouts/user.blade.php, Documentation/pages/messaging/team-inbox.html
- **Port notes:** Next.js route `apps/web/app/(app)/inbox`. Do not port the server-rendered blob: expose the data through the bootstrap/queue APIs and cache device/sender options per org. The target already has an inbox/conversations module family; map `conversations` here to the target's conversation table and add columns only where a behavior below needs them.

### WD-TIB1-002 — Inbox bootstrap payload (`GET /team-inbox/api/bootstrap`)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-TIB1-001
- **Summary:** One JSON call that hands the SPA everything static-ish it needs: the caller's identity/role/status, the full workspace permission map, teams, tags, members with presence, saved replies, plus settings-panel data (SLA policies, routing rules, flows, approved templates, business hours, AI agents, AI key summary, active devices).
- **Actors & access:** Any authenticated user; scoped to `users.current_workspace_id`. No permission gate (each list is workspace-wide).
- **UX & screens:** Called once on load, in parallel with the first queue request. Drives: permission gates (`can('inbox.assign')` etc.), queue-tab visibility (Mine/Unassigned/@me appear only when the workspace has more than one member), member avatar strip ("N members · M online"), team rail, label filter options, quick-reply picker, AI agent menu, device filters on multi-device workspaces.
- **Endpoints:**

| Endpoint                     | Route name                    | Action                        | Middleware   | Request | Response                                                                                                                                             |
| ---------------------------- | ----------------------------- | ----------------------------- | ------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET team-inbox/api/bootstrap | user.team-inbox.api.bootstrap | TeamInboxController@bootstrap | Authenticate | none    | `{me, permissions, teams, tags, members, sla_policies, saved_replies, routing_rules, flows, templates, business_hours, ai_agents, ai_keys, devices}` |

- **Data:** `me` = id, name, email, workspace role, `avatar: null`, agent status (default `online`), current load, unread `inbox_notifications` count. `permissions` = map of EVERY key in `WorkspacePermissions::PERMISSIONS` (23 keys: inbox.view_all_teams, view_team, view_assigned, reply, note, assign, assign_self, resolve, snooze, bulk, tag, priority; team.manage, tag.manage, routing.manage, sla.manage, savedreply.manage, member.invite, member.role.assign, workspace.settings, workspace.billing, analytics.view, integration.manage) to true/false. `teams` ordered by `sort` with id, name, slug, color, assignment_strategy, is_default, device_ids. `members` = workspace members (id, name, email) enriched with agent status (default `offline` when no row), `last_seen_at`, load. `saved_replies` = workspace-shared plus the caller's personal ones, ordered by `used_count` desc, body decrypted. `flows` = active flows (id, name, category); `templates` = approved templates (id, name, language). `devices` = ACTIVE devices owned by users whose current workspace is this one (id, label, phone). `ai_keys` only id/provider/is_active (never the key material).
- **Rules & edge cases:**
  1. The permission map is authoritative for UI gating: a key missing from it is treated as denied by the client.
  2. `members` uses the `workspaces` pivot (real membership); `devices` uses `users.current_workspace_id` (a different, looser notion) — QUIRK: a member whose current workspace points elsewhere loses their devices from this list.
  3. Payload includes settings-panel data that other domains own (SLA, routing, flows, AI) — TIB1 owns the envelope, the owning domains own the row shapes.
  4. Avatar is always null; there are no profile pictures for agents.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an Agent-role user, When bootstrap is called, Then `permissions['inbox.assign_self']` is true and `permissions['inbox.assign']` is false.
  - Given a member with no `agent_statuses` row, When bootstrap is called, Then their member entry has status `offline` and load 0.
  - Given a personal saved reply of user A, When user B calls bootstrap, Then it is absent from B's `saved_replies`.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (bootstrap), app/Support/WorkspacePermissions.php
- **Port notes:** Split into several cached endpoints in the target (me/permissions, members+presence, tags, saved replies). Permissions come from the target RBAC module, not a hard-coded map.

### WD-TIB1-003 — Conversation queue API (`GET /team-inbox/api/queue`)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-TIB1-006, WD-TIB1-004
- **Summary:** The left-pane list: workspace conversations filtered by tab, status, team, channel/number, label, archive state and free-text search, pinned first then newest activity, returned as a growing window (per_page 30, 60, 90 ...) with an idle-poll fingerprint short-circuit.
- **Actors & access:** Any authenticated workspace member. The `all` tab is narrowed for users without `inbox.view_all_teams` (only Viewers lack it; the Agent role was granted it): they see own assignments plus threads assigned to teams they belong to. No plan gate.
- **UX & screens:** Consumed by WD-TIB1-005 and the kanban (WD-TIB1-045, which asks for `status=all&tab=all&per_page=200`).
- **Endpoints:**

| Endpoint                 | Route name                | Action                    | Middleware   | Request                                                                                                                                                                                                                                                                                               | Response                                                                                         |
| ------------------------ | ------------------------- | ------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| GET team-inbox/api/queue | user.team-inbox.api.queue | TeamInboxController@queue | Authenticate | `tab` (mine\|unassigned\|unread\|mentions\|sla_breach\|all; default `mine`), `status` (all\|open\|snoozed\|resolved\|closed\|spam; default `open`), `team_id`, `device_id` (`engine:id` or legacy bare id), `q`, `archived` (bool), `tag_id`, `page` (unused), `per_page` (1-1000, default 30), `sig` | `{items[], total, has_more, per_page, sig, counts{}, archived_count}` or `{unchanged:true, sig}` |

- **Data:** Reads `conversations` (+ eager `assignee`, `team`, `tags`), `conversation_participants` (mentions), `ai_agents`, `devices`, `wa_provider_configs`. List item shape (serializeListItem): id, title, preview, inbox_status, priority, channel, avatar (Instagram proxy URL `/ig-avatar/{igUser}/{sender}` else null), windowed + window_at (WD-TIB1-016), assignee_user_id/name, assignee_team_id/name/color, assignee_agent_id/name/color, last_message_at, snoozed_until, sla_breached, sla_first_due, sla_resolution_due, first_response_at, unread_count, is_spam, archived, pinned (pinned_at not null), muted, tags[id,name,color], wa_username (routing_meta), device_id, device_label, device_phone, device_status (`cloud` for waba/twilio; connected/disconnected/unknown for Baileys), device_last_seen, wa_calling_enabled.
- **Rules & edge cases:**
  1. Base scope: workspace + `forCurrentEngine` + `deviceAlive` (WD-TIB1-006) + `archived = <archived param>`. `archived=1` forces tab=all and status=all and shows every archived thread the user may see.
  2. Status filter: `open` means inbox_status in (open, pending) and is also the fallback for unknown values; `snoozed|resolved|closed|spam` exact; `all` no filter.
  3. Tab filter: `mine` = assignee_user_id = me; `unassigned` = assignee_user_id null (AI-assigned threads still count as unassigned); `unread` = unread_count > 0; `mentions` = has a participant row for me with unread_mentions > 0; `sla_breach` = sla_breached = 1; `all` = everything (or the restricted set above); unknown tab = `mine`. QUIRK: the web UI never sends `sla_breach` (no such tab button) and the server default is `mine` while the JS default is `all`.
  4. `team_id` narrows by `assignee_team_id`; `tag_id` requires the conversation to carry that tag.
  5. Device filter: split `engine:id`; engine must be baileys/waba/twilio/instagram (else ignored, id-only match). Instagram: `channel = instagram` and `raw_jid LIKE 'ig:<igUserId>:%'`. `sms` engine: `channel = sms` only. Otherwise `device_id = id` plus `provider = engine` (prevents cross-table id collisions). A bare number matches device_id with no provider pin (old bookmarks).
  6. Ordering: `pinned_at IS NULL` (pinned first), `pinned_at DESC`, `last_message_at DESC`, `id DESC`. Window = `per_page + 1` rows fetched to compute `has_more`. `title` and `preview` are encrypted at rest, so with `q` set the server loads up to 500 candidates (all other filters applied in SQL) and filters in PHP on decrypted title/preview (case-insensitive substring), `has_more` false, first `per_page` returned. Search does NOT look inside message bodies (the docs claim it does).
  7. Fingerprint short-circuit: the server computes over all workspace live conversations `COUNT(*)`, max `updated_at`, max `last_message_at`, `SUM(unread_count)`, max id, prefixes an md5 of the request filter params (tab, status, team, device, tag, archived, q, per_page) and returns `{unchanged:true, sig}` when the client echoes an identical `sig`. Any mutation that saves the row bumps `updated_at` and invalidates it.
  8. Response also carries `counts` (WD-TIB1-004) and `archived_count` (all archived live threads in the workspace, engine-scoped).
  9. Agent names, device rows and provider configs are bulk-loaded to avoid N+1.
  10. Phone numbers are passed through `mask_phone`, which in this build returns its input unchanged (masking disabled product-wide) — do not port masking as behavior, port it as an org-level setting if ever wanted.
- **Async & events:** Triggers the poll-piggyback sweeps described in WD-TIB1-007 before answering (deferred to after the response).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 40 open conversations and `per_page=30`, When the queue is requested, Then 30 items return with `has_more=true`; with `per_page=60` all 40 return and `has_more=false`.
  - Given a pinned conversation with an old `last_message_at`, When the list is returned, Then it sorts above newer unpinned conversations.
  - Given nothing changed since the last full payload, When the client repeats the request with the returned `sig`, Then the response is `{unchanged:true}` with no items.
  - Given `device_id=waba:5` and a Baileys device also numbered 5, When filtered, Then only provider `waba` threads with device_id 5 return.
  - Given a Viewer without `inbox.view_all_teams` and `tab=all`, When listed, Then only threads assigned to them or to teams they belong to return.
  - Given `q=acme`, When a conversation's decrypted title contains "Acme", Then it is returned even though SQL cannot match the encrypted column.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (queue, applyDeviceFilter, serializeListItem), app/Models/Conversation.php
- **Port notes:** `conversations.title/preview` encryption is the reason for in-memory search; in Postgres store a normalized searchable title (or trigram index) instead and search preview/last message with FTS. Keep the window-size pagination contract or move to keyset pagination with the same ordering. RLS on org_id replaces `forWorkspace`. The `sig` short-circuit can become ETag/If-None-Match on a cheap aggregate.

### WD-TIB1-004 — Queue tab counts and role-based visibility

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TIB1-003
- **Summary:** The badge numbers on the Mine / Unassigned / @me / Unread / SLA / All tabs, computed in one aggregate so a badge always equals what the list shows.
- **Actors & access:** Same as queue.
- **UX & screens:** Badges hide when zero. `#queue-tabs` buttons Mine, Unassigned, @me are hidden for solo workspaces (single member); the All/Unread pair stretches to full width. The "All teams" nav count uses `counts.all`.
- **Endpoints:** Embedded in `GET team-inbox/api/queue` response (`counts`).
- **Data:** Same filtered base as the list (workspace, engine, alive devices, `archived=0`, open/pending) narrowed by the request's `team_id` and device filter. `counts = {mine, unassigned, unread, mentions, sla_breach, all}`.
- **Rules & edge cases:**
  1. mine = assignee_user_id = me; unassigned = assignee_user_id null; unread = unread_count > 0; sla_breach = sla_breached = 1; all = whole set for users with `inbox.view_all_teams`, else own + team-assigned; all computed by one SUM(CASE) query.
  2. mentions is a separate query on `conversation_participants` (my rows with unread_mentions > 0 in this workspace) and is NOT constrained by the team/device filters or by open status.
  3. Because the badges only count open/pending, badges can differ from a `status=all` list.
  4. Kanban header stats (`Total`, `SLA breach`, `Unassigned`) are computed client-side from the loaded window instead.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given three open conversations (one mine, two unassigned) and one resolved mine, When counts are read, Then mine=1, unassigned=2, all=3.
  - Given a note that @mentions me on an archived resolved thread, When counts are read, Then mentions still includes it.
  - Given a Viewer in team T with one thread assigned to T, When counts are read, Then `all` = 1 and the other workspace threads are not counted.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (queueCounts)
- **Port notes:** Implement as one SQL with FILTER clauses; cache 5s per (org, user, filter) if needed.

### WD-TIB1-005 — Queue list UI, channel rail, alerts and polling

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-TIB1-003, WD-TIB1-015
- **Summary:** The client behavior of the conversation list: rows with avatar/channel badge/unread/pins/tags/assignee/device chips, channel filtering, infinite scroll, adaptive polling, new-message sound and desktop notification, and per-row context actions.
- **Actors & access:** Any member. Row context menu actions (pin, mute, archive, delete, label) call the bulk endpoint and therefore need `inbox.bulk` (Manager and above).
- **UX & screens:** Row shows initials avatar (Instagram profile picture overlay), channel glyph badge, title, relative time, preview, unread pill (99+ cap), pin and mute icons, chips for snooze countdown, 24h-window countdown (WD-TIB1-016), tags, `@wa_username`, assignee name, team, AI agent, device (with green/red/amber dot: connected/cloud green, disconnected red, else amber), priority (non-normal, uppercase), SLA. Empty list copy "No conversations - Your queue is clear in this view". Rail channel buttons are client-side filters over the loaded window (keys wa, ig, ms, tt, tg, ln, wc, vb, sms, em; widget maps to `chatbot_widget`); a count badge shows only when the workspace total is > 0. Select mode shows checkboxes and the bulk bar (WD-TIB1-039). Right-click or 480 ms long-press opens the row menu (WD-TIB1-040). Search box is debounced 250 ms. Switching tab/filter/search resets the window to 30; scrolling within 240 px of the bottom grows it by 30 while `has_more`.
- **Endpoints:** Uses WD-TIB1-003 and WD-TIB1-002 only.
- **Data:** Client state: tab (default `all`), search, team filter, device filter (persisted in the `?device_id=` URL param), label filter, archived view, window, selection set, per-conversation thread cache (LRU 20 entries; resolved/closed entries idle > 5 min are evicted every 60 s; the open thread is never evicted).
- **Rules & edge cases:**
  1. Polling: queue every 5 s and open thread every 3 s; when Pusher/Echo is live (WD-TIB1-015) they slow to 30 s and 20 s as a safety net. A 30 s ticker re-renders the 24h countdown. A visibilitychange/focus event triggers an immediate refresh. Manual refresh button drops the fingerprint so the server cannot short-circuit.
  2. Stale-response guard: every loadQueue/loadActive carries a monotonic sequence token and discards results superseded by a newer call (fixes "switch tabs fast -> wrong list").
  3. Render skip: the list only repaints when the signature (id:last_message_at:inbox_status:unread_count per row) changes; counts repaint separately.
  4. Alerts: on each queue poll, if any non-muted conversation other than the open one gained unread since the previous poll, exactly one alert fires per poll (two-tone 880 Hz to 1175 Hz sine ping, ~0.34 s WebAudio; if the tab is hidden a desktop Notification tagged `wa-inbox`, else a toast "New message - title"). First poll seeds silently. Audio and notification permission unlock on the first click/keydown. A new inbound in the OPEN thread pings without a toast.
  5. Client-side GC: resolved rows not touched for over an hour are dropped from the in-memory list every minute.
  6. The channel-tab horizontal strip (`renderChannelTabs`, `#ti-channel-tabs`) is dead: the element no longer exists in the blade.
  7. Deep link `#c=<id>` (hash, not query string) opens that conversation after the queue loads.
- **Async & events:** Polling timers; optional Echo `workspace.{id}.inbox` subscription.
- **External systems:** Browser Notification API, WebAudio.
- **Settings:** admin realtime toggle (WD-TIB1-015).
- **Acceptance criteria:**
  - Given a message arrives on a non-open, non-muted conversation, When the next poll returns, Then one ping plays and (tab hidden) a desktop notification appears; a muted conversation produces neither.
  - Given the operator switches from All to Unread while an All request is in flight, When the slower All response lands, Then it is discarded and the Unread list stays.
  - Given a list scrolled to the bottom with `has_more=true`, When scrolling near the end, Then the next request asks for `per_page` 30 higher.
- **Source refs:** resources/js/charts/user-team-inbox-index.js (bootstrap, startPolling, loadQueue, renderQueue, convRow, renderRailChannels, alertNewMessage), resources/views/user/team-inbox/index.blade.php
- **Port notes:** React Query with the sequence-token semantics; `visibilitychange` refetch; WebSocket first, polling as fallback. Do not port the per-row DOM diff hacks.

### WD-TIB1-006 — Conversation visibility scoping (engine set, agnostic channels, live devices)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** none
- **Summary:** Rules that decide which of a workspace's conversation rows are visible in the inbox, its badges and its unread widget: only conversations on engines the workspace currently uses, non-WhatsApp channels only while their account is connected, and Baileys threads only while their device row still exists.
- **Actors & access:** System, applied to every inbox query.
- **UX & screens:** Explains why a thread "disappears" (engine disabled, channel disconnected, device deleted) and reappears when reconnected. No screen of its own.
- **Endpoints:** none (query scopes used by queue, unread-summary, stats).
- **Data:** `conversations.provider` (`baileys|waba|twilio|sms`, default `baileys`), `channel` (default `whatsapp`; others `chatbot_widget, instagram, facebook, tiktok, telegram, line, wechat, viber, sms, email`), `device_id`, `raw_jid`.
- **Rules & edge cases:**
  1. `forCurrentEngine`: visible when `provider` IN (workspace enabled engines UNION any connected waba/twilio provider config) OR `channel` IN (agnostic set). The computed set is cached 5 s per workspace.
  2. Agnostic channels are exempt from the engine filter but only listed while connected: `chatbot_widget` always; `instagram` if an IG account is connected; `facebook` if a Page is connected; `tiktok`, `telegram`, `line`, `wechat`, `viber`, `email` likewise; `sms` if a connected `sms` provider config exists.
  3. `deviceAlive`: visible when `device_id` is null, OR provider is waba/twilio (device_id points at wa_provider_configs), OR a `devices` row with that id exists. Deleting a Baileys device hides its threads without deleting data.
  4. Historical caveat: a migration back-filled `provider = baileys` on every pre-existing row, so old WABA threads can carry `baileys`; calling-availability logic treats `provider != waba` as WABA when the workspace has no Baileys device at all (WD-TIB1-011).
  5. QUIRK: `forCurrentEngine` reads the authenticated user's current workspace, not a passed id; background jobs must pass the workspace explicitly in the port.
  6. Coexistence pinning: a thread already on an official provider is never downgraded to `baileys` by a later Baileys inbound (see WD-TIB1-043 stampChannel).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `workspaces.enabled_engines` (JSON subset), admin `allowed_send_methods`.
- **Acceptance criteria:**
  - Given a workspace whose enabled engine set is only `baileys`, When a WABA thread exists but no WABA config is connected, Then it is not listed.
  - Given a Baileys thread whose device was deleted, When the queue loads, Then it is hidden; When a device with that id exists again, Then it reappears.
  - Given an Instagram account is disconnected, When the queue loads within 5 s cache expiry, Then Instagram threads disappear from the list and counts.
- **Source refs:** app/Models/Conversation.php (scopeForCurrentEngine, scopeDeviceAlive, ENGINE_AGNOSTIC_CHANNELS), app/Services/WorkspaceEngine.php
- **Port notes:** Model as a `visible_channels(org_id)` derivation from channel-connection rows instead of a stamped provider filter; keep `channel` and `provider` as separate columns.

### WD-TIB1-007 — Scheduler-less sweeps piggy-backed on the queue poll

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-TIB1-003
- **Summary:** WaDesk works without cron: each queue poll may schedule deferred (post-response) sweeps that escalate stale threads, flag SLA breaches, wake snoozed conversations, pull Instagram, remind deal/task due dates and fire due campaigns. TIB1 owns the trigger mechanism; the sweeps themselves belong to other domains.
- **Actors & access:** System, triggered by any member's queue poll. Each sweep is cache-gated so it runs at most once per interval.
- **UX & screens:** none (background).
- **Endpoints:** Runs inside `GET team-inbox/api/queue`.
- **Data:** Cache keys as gates: `inbox:esc-sweep:{ws}` 30 s; `inbox:ig-pull:{ws}` 12 s; `inbox:sla-sweep` 60 s (global); `inbox:wake-sweep:{ws}` 30 s; `deals:remind-sweep:{ws}` 60 s; `crm:task-remind-sweep:{ws}` 60 s; `inbox:campaign-sweep` 20 s (global).
- **Rules & edge cases:**
  1. The gate is set synchronously and the body runs in `app()->terminating`, so two simultaneous polls cannot double-schedule and the operator's response is never delayed.
  2. Escalation sweep (TIB2): up to 200 open/pending conversations per workspace with `escalation_due_at <= now` and no `first_response_at`; on any per-row failure the escalation fields are cleared.
  3. Snooze wake (TIB2): up to 50 snoozed rows with `snoozed_until <= now` become `open`, `snoozed_until` cleared, `conversation.unsnoozed` broadcast, event `auto_unsnoozed` (actor type `system`), `snooze_wake` notification to the assignee or team members.
  4. SLA sweep (TIB2): `SlaTracker::sweepBreaches` walks all workspaces (first-response and resolution breaches).
  5. Instagram pull, deal reminders, CRM task reminders and campaign sweep are owned by IG, DEAL/CTP and CAMP respectively.
  6. These sweeps only run while at least one operator has the inbox (or kanban) open; the Laravel scheduler commands `inbox:escalate` and `inbox:wake-snoozed` cover the same ground when cron runs (TIB2).
- **Async & events:** After-response callbacks; broadcast + notification on wake.
- **External systems:** Instaflow puller (IG).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a snoozed thread with `snoozed_until` in the past and an operator polling the queue, When the poll completes, Then within the same or next poll the thread is `open`, an `auto_unsnoozed` event exists and the assignee got a `snooze_wake` notification.
  - Given two operators polling simultaneously, When the 30 s gate is set by the first, Then the second poll schedules no duplicate sweep.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (queue), app/Services/Inbox/SlaTracker.php, app/Services/Inbox/RoutingEngine.php (applyEscalation), app/Services/Inbox/NotificationDispatcher.php (notifySnoozeWake)
- **Port notes:** Replace with BullMQ repeatable jobs (escalation 30 s, snooze wake 30 s, SLA 60 s) per the TIB2 design. Do NOT couple sweeps to inbox page views. Hand off ownership of every sweep body to TIB2/IG/DEAL/CAMP; TIB1 keeps nothing here in the port.

### WD-TIB1-008 — Global unread bell and "last seen" watermark

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-TIB1-006
- **Summary:** A floating "New messages" pill on every authenticated page except the inbox: it counts conversations that received a customer message after the user last visited the inbox, lists the five most recent and links to the inbox.
- **Actors & access:** Any authenticated user; scoped to current workspace; route throttle 60/min.
- **UX & screens:** `resources/views/components/user/inbox-bell.blade.php` (fixed bottom-right, draggable pill). Hidden when total is 0. Pill shows count and "tap to view"; popup lists up to five items (masked title, 80-char preview, unread count, time) plus a "View Inbox" link. Hover reveals a dismiss X that hides the pill only for the current unread set (a newer message or higher total brings it back). Polls every 15 s, pauses on hidden tab, exponential back-off on 429/errors, immediate fetch on tab focus, Esc closes the popup.
- **Endpoints:**

| Endpoint                          | Route name                         | Action                            | Middleware                          | Request | Response                                                              |
| --------------------------------- | ---------------------------------- | --------------------------------- | ----------------------------------- | ------- | --------------------------------------------------------------------- |
| GET team-inbox/api/unread-summary | user.team-inbox.api.unread-summary | TeamInboxController@unreadSummary | Authenticate, ThrottleRequests:60,1 | none    | `{total, items[{id,title,preview<=80,unread_count,last_message_at}]}` |

- **Data:** `users.inbox_last_seen_at` (watermark). Query: workspace + engine + alive-device + open/pending + `unread_count > 0` + `last_inbound_at > watermark`; items = 5 newest by `last_inbound_at`; total counts conversations, not messages. Result cached 5 s per (user, workspace, watermark). Errors return an empty summary instead of 500.
- **Rules & edge cases:**
  1. First ever poll (null watermark) silently sets the watermark to now so the existing backlog is not announced.
  2. Visiting `/team-inbox` or `/team-inbox/kanban` resets the watermark (WD-TIB1-001, WD-TIB1-045).
  3. QUIRK: `TeamInboxController::markInboxSeen` (a "reset counter" endpoint) has no route — dead code.
  4. Not shown on the inbox page itself (`nav-key = team-inbox`).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a user who has never polled, When the first poll happens, Then total is 0 and the watermark is set.
  - Given a customer message after the watermark, When the bell polls, Then total=1 and the item preview is the first 80 chars.
  - Given the user opens `/team-inbox`, When the bell next polls elsewhere, Then total is 0 until a newer inbound arrives.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (unreadSummary, markInboxSeen), resources/views/components/user/inbox-bell.blade.php, resources/views/components/layouts/user.blade.php
- **Port notes:** Store the watermark per (user, org). The bell should subscribe to the realtime channel instead of polling when available.

### WD-TIB1-009 — Open a conversation (`GET /team-inbox/api/conversations/{id}`)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-TIB1-003
- **Summary:** Opening a row loads the newest 80 messages, the conversation's notes and timeline, the contact profile, order history and "past conversations" with the same customer in one call, and marks the thread read.
- **Actors & access:** `ConversationPolicy::view`: platform staff with `platform.conversation.view_all` always; otherwise the user must belong to the conversation's workspace AND (hold `inbox.view_all_teams` OR be the assignee OR (the thread is assigned to a team the user is in AND holds `inbox.view_team`) OR hold `inbox.view_assigned` and be the assignee). All roles except Viewer hold `view_all_teams`; a Viewer sees only their own/team threads. The lookup itself is workspace-scoped (`forCurrentWorkspace`, with a legacy fallback that shows NULL-workspace rows to their original creator), so a foreign id returns 404, a same-workspace but not-visible id returns 403.
- **UX & screens:** Thread pane (WD-TIB1-011) + contact panel (WD-TIB1-012). Open is instant from the client LRU cache, then refreshed. Mobile: the thread replaces the queue full-screen until the back button.
- **Endpoints:**

| Endpoint                              | Route name               | Action                   | Middleware   | Request                                                                     | Response                                                                                        |
| ------------------------------------- | ------------------------ | ------------------------ | ------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| GET team-inbox/api/conversations/{id} | user.team-inbox.api.show | TeamInboxController@show | Authenticate | `before` (message id, older page), `poll=1&since=<id>` (delta, WD-TIB1-010) | `{conversation, messages[], notes[], events[], history[], contact_profile, orders[], has_more}` |

- **Data:** `conversation` = list item + tags (id,name,color,slug), resolved_at, resolved_by(+name), resolved_by_agent_id(+name), contact_phone (raw digits; used only by the WABA dialer), contact_phone_display, wa_calling_permission (`granted`, `expired`, `declined` or null from `wa_call_permissions`). `messages` = `inbox_messages` ordered by `COALESCE(sent_at, created_at)` then id, newest 80 returned oldest to newest; `has_more = total > returned`. `notes` = newest 80 (decrypted body, mentions, is_pinned, author_id/name, created_at, edited_at). `events` = newest 80 conversation events (id, type, actor id/name, agent id/name, payload, created_at). `history` = up to 20 OTHER conversations in the workspace with the same `contact_digits` or same raw_jid/alt_jid, newest activity first (id, title, preview, last_message_at, inbox_status, resolved_at). `orders` = up to 20 `wa_orders` for the workspace where `customer_phone = conversation.raw_jid` (id, source, customer_name, items_count, total_minor, currency_code, status, created_at).
- **Rules & edge cases:**
  1. Fresh open only (`before` absent): if `unread_count > 0` it is set to 0 (a conversation-level counter, so ONE agent opening it clears the badge for everybody — QUIRK); the caller's `conversation_participants` row is created (role `watcher`) if missing and stamped `last_read_at = now`, `unread_messages = 0`, `unread_mentions = 0`. `conversations.last_read_at` is written only if that column exists — it does not in the shipped schema.
  2. Older-page request (`before = id`): returns only `{messages (older 80), has_more}`; no read-state writes.
  3. Message ordering deliberately uses send time, not insertion id, because backfilled channels (Instagram) ingest out of order; the id is the tiebreaker. The relation default order is overridden with `reorder()` so LIMIT 80 really returns the newest slice.
  4. QUIRK: contact profile lookup first uses `conversations.contact_id`; else it tries an SQL match of `contacts.mobile` after stripping separators — but `contacts.mobile` is stored encrypted, so this fallback matches nothing on real data; in practice the profile appears only when `contact_id` is set (inbound capture or "save contact"). Skipped for Instagram threads. Profile fields: id, name, email, mobile (mask function, currently identity), country_code, address, language, image (URL or storage path), custom_attributes, is_unsubscribed. The port should resolve by a hashed/E.164 phone column or by contact_id.
  5. Up to 2 inbound WABA media that never downloaded are lazily fetched from Meta during this call (budget 2 per request, only rows younger than 25 days with a `waba_media_id`); failures leave the manual Retry (WD-TIB1-031).
  6. Translated text is exposed only while the workspace translation toggle is ON (WD-TIB1-011).
  7. Opening does not touch `inbox_status`; a resolved thread stays resolved.
- **Async & events:** none synchronous besides the lazy media downloads. Presence heartbeat starts client-side (WD-TIB1-014).
- **External systems:** Meta Graph media download (WABA) for missed media.
- **Settings:** workspace `inbox_translate` toggle (translated bodies).
- **Acceptance criteria:**
  - Given a thread with 142 messages, When it is opened, Then the newest 80 return oldest-first, `has_more=true`, and unread_count becomes 0.
  - Given `before=<id of oldest loaded>`, When requested, Then the previous 80 (or fewer) return without notes/events and without changing unread state.
  - Given a Viewer not assigned and not in the thread's team, When they request the id, Then the response is 403; a conversation of another workspace returns 404.
  - Given the same phone appears in two threads (different business numbers), When one is opened, Then `history` lists the other.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (show, serializeFull, serializeMessage, serializeNote, serializeEvent, findConvInCurrentWorkspace), app/Policies/ConversationPolicy.php, app/Models/ConversationParticipant.php
- **Port notes:** Per-user read state should live in `conversation_participants`-like rows (unread per agent); the shared counter is the WaDesk behavior — keep `unread_count` on the conversation for the badge but decide explicitly whether one agent's open clears it for all (WaDesk: yes). RLS replaces the workspace check; keep 404-vs-403 distinction only if the target's API guidelines allow.

### WD-TIB1-010 — Thread delta polling and older-message paging

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-TIB1-009
- **Summary:** While a thread is open the client asks only for messages newer than the newest id it holds, plus delivery-tick updates for its latest outbound messages, and pages older history on scroll-up.
- **Actors & access:** Same as WD-TIB1-009.
- **UX & screens:** Scrolling within 60 px of the top loads the previous 80 messages and preserves scroll position. New messages append; auto-scroll only if the operator was within 80 px of the bottom or the thread just opened. The thread DOM is rebuilt only when its signature (kind:id:status:delivered_at:read_at:edited_at:media_type:body length per item) changes, so a playing voice note is not interrupted by idle polls.
- **Endpoints:**

| Endpoint                                                   | Route name               | Action                   | Middleware   | Request         | Response                                                                                                    |
| ---------------------------------------------------------- | ------------------------ | ------------------------ | ------------ | --------------- | ----------------------------------------------------------------------------------------------------------- |
| GET team-inbox/api/conversations/{id}?poll=1&since=<maxId> | user.team-inbox.api.show | TeamInboxController@show | Authenticate | `poll`, `since` | `{poll:true, messages[<=80 with id>since], statuses[<=40 {id,status,failure_reason,delivered_at,read_at}]}` |

- **Data:** Reads `inbox_messages`. Delta mode fetches no media, no notes/events/history/orders and writes read-state only when the delta is non-empty (sets `unread_count = 0`, participant read stamps).
- **Rules & edge cases:**
  1. `statuses` = the 40 newest OUTBOUND rows, four columns each, because an id-greater-than delta can never carry a delivered/read receipt for an already-loaded row.
  2. The client uses delta only if the last FULL load was < 60 s ago; otherwise a full re-sync runs (catches out-of-order backfills whose ids are lower than the newest held id).
  3. A stale poll response is discarded when a send reconciled after the poll started (sequence token), preventing the "just-sent bubble vanishes for 3 s" bug.
  4. Optimistic bubbles (`status=sending|failed`, temp id) survive a full reload until reconciled.
  5. Thread items are de-duplicated by numeric id or `meta.wa_message_id`.
- **Async & events:** Poll cadence 3 s (20 s with realtime), or on `message.received` broadcast.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the client holds up to id 500 and a new inbound with id 501 exists, When it polls with `since=500`, Then only 501 returns and unread is cleared.
  - Given an outbound message delivered after it was loaded, When the next poll runs, Then `statuses` carries its new `delivered_at` and the tick updates without a full reload.
  - Given nothing changed, When polling, Then the DOM (and any playing audio) is untouched.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (show poll branch), resources/js/charts/user-team-inbox-index.js (loadActive, applyStatusDeltas, loadOlderMessages, renderActive)
- **Port notes:** Prefer server push (SSE/WebSocket) carrying message and status events; keep `since` delta as reconnect recovery.

### WD-TIB1-011 — Thread rendering: bubbles, media, templates and status ticks

- **Status:** implemented
- **Priority:** P0
- **Effort:** XL
- **Depends on:** WD-TIB1-009
- **Summary:** How every stored message type is drawn in the thread: text, media (image/video/audio/document/sticker), voice notes, contact cards, locations, catalog tiles, template bubbles with buttons, WhatsApp Flow form submissions, call entries, email bubbles, forwarded/edited/pinned/starred markers, reactions, delivery ticks and failure reasons — interleaved chronologically with internal notes.
- **Actors & access:** Same as WD-TIB1-009. Server serializer output is the contract (`serializeMessage`).
- **UX & screens:** Day divider chips ("Today", "Yesterday", "D Mon YYYY", in workspace timezone); outbound bubbles right-aligned, inbound left; bubble width fits content up to 70% (min 80 px); internal notes render as amber note cards inside the same time-ordered stream; hover chevron opens the per-message menu (WD-TIB1-027/028/029); clicking an image opens a lightbox with prev/next over all images in the thread (arrows, Esc, download); failed outbound bubbles show the real `failure_reason` and a Retry that puts the text back in the composer; call header button appears only when `wa_calling_enabled` and a raw phone exist. Header shows status pill (OPEN/PENDING/SNOOZED/RESOLVED/CLOSED/SPAM upper-cased), "SLA - <due in / breached / dash>", device pill (Online / Device offline - seen <time> / Connecting..., hidden for cloud and Instagram), 24h window badge (WD-TIB1-016), "via <Channel>", presence (WD-TIB1-014), assign button, AI agent button, call, snooze, create-deal, IG flow, contact-panel toggle. A resolution banner "Resolved by <person or AI agent name> - <time>" shows under the thread when resolved.
- **Endpoints:** none of its own (data from WD-TIB1-009/010).
- **Data:** Serializer fields per message: id, direction, body (see rule 1), translated_body / detected_language / is_translated, media_path, media_url (storage URL, or Instagram CDN URL from `meta.instagram.media_url`), media_name (recovered from the `<random>__<original>` storage naming), media_type, reaction, pinned, starred, quality_score/note (AI self-rating), header/footer/buttons (from meta, with render-time back-fill from the template by name for historical bubbles), form (WhatsApp Flow submission `meta.type = wa_form_submission` with title, submission_id, fields), contact (vCard from `meta.contact`), ptt, forwarded, frequently_forwarded, catalog `{mode, provider, products[]}` (`meta.kind = catalog`), location `{lat,lng,name,address}` (columns latitude/longitude or meta), email `{subject, from}`, call `{status, direction, duration}` (`media_type = call`), status, failure_reason (only when failed), user_id, agent_id/name/color (AI author), created_at, sent_at, delivered_at, read_at, edited_at, `editable`, time_label (HH:mm today else "Mon DD").
- **Rules & edge cases:**
  1. Placeholder normalization: a text-only body matching "[unsupported message", "message type unknown", "not supported in inbox" or "message can't be displayed" is replaced by one friendly line ("the customer sent something the WhatsApp Business API can't display").
  2. Status ticks are drawn only for WhatsApp, SMS and Viber threads: pending/scheduled = clock, sent = single grey tick, delivered = double grey, read = double blue (#53BDEB); other channels show no tick. Provider callbacks (WABA/Twilio/Node) update the row. Media flagged image/video/audio/document/sticker with no URL renders an "unavailable - could not be downloaded" placeholder with a Retry (WD-TIB1-031); documents whose file extension is an image or video are previewed inline.
  3. Translation display: `translated_body` is shown with a "translated from X" badge and toggle only if the workspace's `inbox_translate` is on AND the plan has `access_translation`; turning the toggle off instantly reverts every bubble to the original (stored translations are kept but hidden). Outbound rows keep the agent's own text in `translated_body` while `body` holds what was delivered.
  4. Historic template bubbles without buttons in meta are back-filled by looking up the template by decrypted name in the workspace library (name and buttons are encrypted casts so this is an in-memory map, built once per request).
  5. Calling availability per row (`wa_calling_enabled`): requires a workspace WABA config with `calling_enabled`, a phone-shaped raw_jid (`digits@...` or 6-15 bare digits) and (`provider = waba` OR the workspace has no Baileys device — because a migration back-filled `baileys` on old WABA threads).
  6. Time display uses the workspace timezone (`window.__inboxTz`) for every agent.
  7. Optimistic send: the bubble appears immediately with a temp id and `sending` state; on 2xx the server-serialized message replaces it in place (no refetch); on error it becomes `failed`. Enter sends, Shift+Enter newline, IME composition guarded; Ctrl/Cmd+Enter also sends; the send button locks with a spinner to prevent duplicates.
- **Async & events:** Delivery/read receipts arrive via provider webhooks (WABA/NODE domains) and surface through polling/realtime.
- **External systems:** none here.
- **Settings:** workspace `inbox_translate`, plan `access_translation`.
- **Acceptance criteria:**
  - Given an inbound "[Unsupported message: Message type unknown]" text-only row, When rendered, Then the friendly one-line placeholder shows instead.
  - Given an outbound row with `status=failed` and reason "outside 24h window", When rendered, Then the reason text and Retry appear.
  - Given messages from two calendar days, When rendered, Then a date chip precedes the first message of each day in the workspace timezone.
  - Given translation turned off, When the thread reloads, Then no bubble shows translated text.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (serializeMessage, serializeListItem, sessionWindow, templateButtonsByName), resources/js/charts/user-team-inbox-index.js (renderActive, renderThreadItemImpl, renderMediaBlock, renderStatusTick, lightbox), app/Models/InboxMessage.php
- **Port notes:** Message rendering is a React component library keyed on `type` plus `payload`; normalize `meta` blobs into typed message content in the target schema (text, media, contact, location, catalog, template, form, call, email). Keep `wa_message_id` (provider id) as a first-class column.

### WD-TIB1-012 — Contact side panel (profile, orders, past conversations, inline rename)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-TIB1-009
- **Summary:** The right column shows who the customer is (avatar, name, channel, business number), quick actions (Deal, Note, Snooze, Tag), profile attributes, order stats, assignment, AI agent, tags, deals, internal notes, past conversations and the activity timeline; the name/email can be edited in place.
- **Actors & access:** Panel: anyone who can open the thread. Rename: `ConversationPolicy::view` only (any role that can see the thread, including Viewer) — QUIRK: no `contacts` permission check.
- **UX & screens:** Default closed on first visit and on mobile; the open/closed choice persists in `localStorage` key `ti.contactOpen`. Attributes card (Email, Phone, Language, Address, then every `custom_attributes` key title-cased) hides when empty. Stats grid (Orders/LTV/Since) is populated client-side from `orders`. "On your number" line shows the thread's business number/label (essential when a customer has separate threads per number). Past conversations list opens the chosen thread. Pencil icon opens an inline editor for name and email.
- **Endpoints:**

| Endpoint                                            | Route name                       | Action                          | Middleware   | Request                                                            | Response                                                            |
| --------------------------------------------------- | -------------------------------- | ------------------------------- | ------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| POST team-inbox/api/conversations/{id}/save-contact | user.team-inbox.api.save-contact | TeamInboxController@saveContact | Authenticate | `name` (nullable string max 191), `email` (nullable email max 191) | `{ok, profile{id,name,email}}` or 422 `{ok:false,error:no_contact}` |

- **Data:** Reads/writes `contacts` (name, email) and `conversations.contact_id`.
- **Rules & edge cases:**
  1. Resolution: use `conversations.contact_id`; else derive digits from `raw_jid`/`contact_digits` (6-15 digits) and `Contact::rememberPhone` (finds by hashed phone in the workspace or CREATES a contact with that name); groups and non-phone threads with no linked contact cannot be named (`no_contact`, 422).
  2. Only non-blank names overwrite; a provided email overwrites; then the contact is saved and, if the thread had no `contact_id`, it is linked (so later opens resolve instantly).
  3. `contact_id` is also set at inbound capture by the Baileys mirror and by social channels.
  4. Same phone-matching caveat as WD-TIB1-009 rule 4.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a thread with no linked contact and a phone `9198...`, When the agent saves a name, Then a contact is created/reused for that number, linked to the thread, and the name shows in the panel.
  - Given a group thread, When saving a name, Then the response is 422 `no_contact`.
  - Given an invalid email, When saving, Then a validation 422 is returned and nothing changes.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (saveContact, show), resources/js/charts/user-team-inbox-index.js (renderContactAttributes, setContactPanel, contact edit IIFE), resources/views/user/team-inbox/index.blade.php
- **Port notes:** Contacts live in CON; call its service (`upsertByPhone`), never write contacts from the inbox module directly. Link `conversation.contact_id` on first identification.

### WD-TIB1-013 — Activity timeline (conversation events)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-TIB1-009
- **Summary:** An append-only per-conversation log of state changes shown as "Activity & Resolution History" in the contact panel.
- **Actors & access:** Readable by anyone who can open the thread; written by the actions below and by routing/SLA/AI code.
- **UX & screens:** A vertical list of dot + label + "by <actor>" (+ "AI agent name (AI)" when an agent id is in the payload) + timestamp; empty copy "No events yet." Event type labels mapped for resolved, reopened, assigned, unassigned, agent_assigned, agent_unassigned, snoozed, priority_changed, tagged, note_added; every other type is shown with underscores turned into spaces.
- **Endpoints:** Embedded in WD-TIB1-009 (`events`, newest 80).
- **Data:** `conversation_events(conversation_id, workspace_id, actor_user_id, actor_type default user, type varchar32, payload JSON, created_at)`; no FK constraints, no `updated_at`. Types written by TIB1 code: `assigned`, `reassigned`, `unassigned`, `ai_handoff` (actor type `human` or `flow`), `resolved` (payload agent_id, agent_name, by, bulk), `reopened`, `snoozed`, `auto_unsnoozed` (system), `priority_changed` {from,to}, `tag_added` {tag_id,tag_name}, `tag_removed` {tag_id}, `note_added` {note_id} or {note, source:deal}, `voice_assistant_attached|detached`, `agent_assigned|agent_unassigned` {old,new}; written by other domains: `first_response`, `sla_breach` (SlaTracker), routing actions.
- **Rules & edge cases:**
  1. Event write order in every mutation: state change, event row, broadcast, in-app notification.
  2. QUIRK: `tag_added`/`tag_removed`/`assigned by system` have no label mapping (the UI maps `tagged`), so they render as "tag added"/"tag removed" via the underscore fallback.
  3. QUIRK: the server returns events newest-first; the client reverses them and labels the list "newest first", so it actually displays oldest-first.
  4. Bulk resolve records `resolved` with `bulk:true`, but bulk assign/priority/tag/spam/archive/pin etc. record no per-conversation event (only one workspace audit row, WD-TIB1-039).
  5. Hard-deleting a conversation leaves its events orphaned (no FK).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a resolve action, When the timeline loads, Then a `resolved` event shows the resolver's name.
  - Given an AI agent resolves via its own path, When displayed, Then the actor line includes the agent name marked (AI).
  - Given 100 events, When the thread opens, Then only the newest 80 are returned.
- **Source refs:** app/Models/ConversationEvent.php, app/Http/Controllers/TeamInboxController.php (serializeEvent), resources/js/charts/user-team-inbox-index.js (renderEvents)
- **Port notes:** Add real FKs + `org_id` RLS; consider a generic `conversation_activity` table with typed payload schemas and an outbox event per row. Fix the ordering label.

### WD-TIB1-014 — Presence and typing collision detection

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-TIB1-009
- **Summary:** Shows teammates who have the same conversation open and who is typing, so two agents do not answer the same customer.
- **Actors & access:** Any user who can `view` the conversation. Ping route throttle 240/min, leave route 60/min.
- **UX & screens:** Under the thread header: typing pill "<Name>, <Name> +N is/are typing" wins over the viewer strip; otherwise up to four teammate avatars with "<Name> is also viewing" or "N teammates are viewing". Self is never listed.
- **Endpoints:**

| Endpoint                                              | Route name                         | Action                            | Middleware                           | Request           | Response                              |
| ----------------------------------------------------- | ---------------------------------- | --------------------------------- | ------------------------------------ | ----------------- | ------------------------------------- |
| POST team-inbox/api/conversations/{id}/presence       | user.team-inbox.api.presence.ping  | TeamInboxController@presencePing  | Authenticate, ThrottleRequests:240,1 | `typing` (bool)   | `{ok, presence{viewers[],typists[]}}` |
| POST team-inbox/api/conversations/{id}/presence/leave | user.team-inbox.api.presence.leave | TeamInboxController@presenceLeave | Authenticate, ThrottleRequests:60,1  | none (sendBeacon) | `{ok:true}`                           |

- **Data:** Cache only (no DB): key `inbox:presence:{conversationId}` holding `viewers[userId] = {name, avatar, until}` and `typists[userId] = {name, until}`; value TTL = 35 s. Viewer TTL 30 s, typist TTL 5 s; expired entries are filtered on read.
- **Rules & edge cases:**
  1. Client heartbeats every 10 s while a thread is open, sends a typing ping on composer input debounced to one per 2 s, and calls leave on conversation switch, `beforeunload` and `pagehide` (via `navigator.sendBeacon`). A 500 ms watcher notices `activeId` changes.
  2. Read-modify-write on a cache array is not atomic; two simultaneous pings can drop each other's entry until the next heartbeat (acceptable).
  3. Requires a shared cache store across app instances (file/array stores break multi-node).
  4. Avatar is `users.avatar_url` when present (mostly null).
  5. The service comment says "no WebSockets" yet realtime exists (WD-TIB1-015); presence is never pushed over Echo.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given agents A and B on the same thread, When B types, Then A sees "B is typing" within one heartbeat and it disappears ~5 s after B stops.
  - Given B closes the tab, When leave fires, Then A no longer sees B immediately; if it fails, within 30 s.
  - Given A's own ping, When the snapshot returns, Then A is excluded.
- **Source refs:** app/Services/Inbox/PresenceService.php, app/Http/Controllers/TeamInboxController.php (presencePing, presenceLeave), resources/js/charts/user-team-inbox-index.js (presence block)
- **Port notes:** Redis keys with TTL (or a presence channel on the realtime gateway); keep TTLs 30 s/5 s; scope by org.

### WD-TIB1-015 — Realtime broadcast events and Echo client

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-TIB1-005
- **Summary:** Server events pushed over Pusher-protocol private channels so the inbox updates without waiting for the poll. Only one event is consumed by the UI; the rest are emitted for future/other clients.
- **Actors & access:** Private-channel auth via `/broadcasting/auth`: `workspace.{id}.inbox` for workspace members (owner, pivot member, or platform admin); `conversation.{id}` for members of the conversation's workspace. Feature is on only when an admin configured Pusher; `echo.js` reads the public key/cluster from `<meta name="pusher-key|pusher-cluster|ws-id">` and otherwise leaves `window.__realtime.enabled = false`.
- **UX & screens:** Instant list refresh and (if open) thread refresh on new message; polling slows to 30 s/20 s as a safety net.
- **Endpoints:** none (Laravel channel auth route). Channel definitions in `routes/channels.php` (not a manifest item).
- **Data:** Events (all `ShouldBroadcastNow`, i.e. inline, no queue worker): `message.received` {message_id, conversation_id, direction, user_id} on workspace + conversation channels (inbound webhooks and every outbound send via `->toOthers()`); `conversation.assigned` {conversation_id, previous_user_id, new_user_id, team_id, by_user_id}; `conversation.<type>` where type in resolved, reopened, snoozed, unsnoozed, priority, tag_added, tag_removed with `{conversation_id,type,changes}`; `note.added` {note_id, conversation_id, author_user_id, mentions} on the conversation channel only; `mention.received` {conversation_id, by_user_id, excerpt} on `user.{id}.notifications`; `sla.breached` (TIB2).
- **Rules & edge cases:**
  1. QUIRK: the Echo client subscribes only to `workspace.{id}.inbox` and listens only for `.message.received`; assigned/updated/note events have no listener anywhere in the shipped JS.
  2. QUIRK: `mention.received` targets `private-user.{id}.notifications`, but `routes/channels.php` defines no authorization for that channel, so no browser can subscribe.
  3. `->toOthers()` means the sender's own tabs rely on the HTTP response, not the socket.
  4. Broadcast failures are swallowed on inbound (`try/catch`); outbound broadcasts in controllers are NOT wrapped — a Pusher outage after the state change would raise an error to the caller in some paths.
  5. Channel auth logs `[RT-TRACE]` lines at info level for every subscribe.
  6. Default `.env` ships `BROADCAST_CONNECTION=log`; realtime is opt-in.
- **Async & events:** as above.
- **External systems:** Pusher (or Reverb-compatible) with app key/secret/cluster in `.env`/admin settings.
- **Settings:** `.env` `BROADCAST_CONNECTION`, `PUSHER_APP_KEY|SECRET|ID|CLUSTER|HOST|PORT|SCHEME`, admin realtime toggle (owned by SET/CORE).
- **Acceptance criteria:**
  - Given realtime enabled, When a customer message is stored, Then a `message.received` event reaches subscribed members within a second and their list refetches.
  - Given a non-member, When they request auth for `workspace.{id}.inbox`, Then auth is rejected.
  - Given realtime disabled, When the inbox runs, Then the 5 s/3 s polling still delivers updates.
- **Source refs:** app/Events/Inbox/MessageReceived.php, app/Events/Inbox/ConversationAssigned.php, app/Events/Inbox/ConversationUpdated.php, app/Events/Inbox/NoteAdded.php, app/Events/Inbox/MentionReceived.php, routes/channels.php, resources/js/echo.js, config/broadcasting.php
- **Port notes:** NestJS WebSocket gateway (or Ably/Soketi) emitting typed events from the outbox after commit (never inline in the request); authorize by org membership; UI should consume ALL conversation events to update caches, fixing the listener gap. Define the `user.{id}.notifications` channel with auth.

### WD-TIB1-016 — 24-hour customer-care window (WABA, Twilio, Instagram, Messenger)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-TIB1-009
- **Summary:** For channels that only allow free-form replies within 24 hours of the customer's last message, the inbox computes the window end, counts it down on the row and header, and warns when a plain reply may bounce.
- **Actors & access:** Display-only; send is never blocked client-side.
- **UX & screens:** Row chip: "3h" (green) / "48m" (amber under 3 h) / "expired" (red). Header badge: "Closes in 3h 12m" or "Window closed" (recomputed every 30 s). Composer banner when closed: "The 24-hour window has closed - a normal message may not be delivered. Send an approved template to re-engage." The Send button stays enabled.
- **Endpoints:** Fields `windowed`, `window_at` on every list/thread item.
- **Data:** `conversations.last_inbound_at`.
- **Rules & edge cases:**
  1. `windowed` = provider in (waba, twilio) OR channel = instagram OR (channel = facebook AND raw_jid does not contain `:post:`). Baileys and the chat widget are never windowed; Facebook post-comment threads are not windowed.
  2. `window_at = last_inbound_at + 24h`; null when the customer never wrote.
  3. The provider enforces the rule (Meta error 131047 on WABA); the failure text is stored on the message.
  4. Compose panel marks Instagram conversations `open` vs `24h+` using the same 24 h math.
- **Async & events:** client ticker.
- **External systems:** Meta/Twilio enforce.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a WABA thread whose last inbound was 23h ago, When listed, Then the chip shows about "1h" in amber.
  - Given a Baileys thread, When listed, Then no window chip or warning appears.
  - Given a closed window, When the operator sends a plain text anyway, Then the request is made and any provider rejection is recorded as the message failure reason.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (sessionWindow), resources/js/charts/user-team-inbox-index.js (sessionWindow, windowRowChip, renderSessionWindow)
- **Port notes:** Compute server-side into a `reply_window_expires_at` field per channel adapter (WhatsApp 24 h, Messenger 24 h, IG 24 h, WeChat 48 h) rather than in the serializer.

### WD-TIB1-017 — Text reply to a conversation (`POST .../reply`)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-TIB1-009, WD-TIB1-026
- **Summary:** The core action: an agent types a message and sends it back to the customer over the channel/number the thread lives on. The row is stored first as `pending`, dispatched, then stamped `sent` or `failed` with the provider's reason.
- **Actors & access:** `ConversationPolicy::reply`: member of the workspace, `inbox.reply` (Owner/Admin/Manager/Agent; NOT Viewer) and able to `view` the thread. No plan gate besides the monthly message cap enforced in the dispatcher.
- **UX & screens:** Composer "Reply" tab: rich text box (B/I/S toolbar, emoji, character counter, limit 4096), Send button, Enter sends / Shift+Enter newline, `/` as the first character opens the saved-reply picker (WD-TIB1-024), attribute picker inserts `{{N}}` placeholders and records a positional map in a hidden field. Bubble appears optimistically (WD-TIB1-011); a failed send shows the reason and a Retry that returns the text to the composer.
- **Endpoints:**

| Endpoint                                     | Route name                | Action                    | Middleware   | Request                                                                                                                                                                                       | Response                                                                                                           |
| -------------------------------------------- | ------------------------- | ------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| POST team-inbox/api/conversations/{id}/reply | user.team-inbox.api.reply | TeamInboxController@reply | Authenticate | `body` (nullable string max 4096), `template_id` (nullable int, exists wa_templates), `variable_map` (nullable array of string max 64), `template_overrides` (nullable JSON string max 20000) | `{ok:true, message}` (HTTP 200 even when the send failed; see message.status) or 422 `{ok:false,error:empty_body}` |

- **Data:** Writes `inbox_messages` (conversation_id, user_id, direction `out`, from_number, to_number, body, status `pending` then `sent|failed`, failure_reason max 191, meta JSON `{target_jid, ...}`, sent_at, wa message id stored as `meta.wa_message_id`), `conversations` (last_message_at, last_outbound_at, preview first 200 chars, escalation_due_at = null, escalation_action = null, first_response_at via SLA tracker), `agent_statuses.today_replies + 1`. Encrypted at rest: body, from/to numbers, failure_reason.
- **Rules & edge cases:**
  1. Human takeover runs BEFORE validation: `pauseAiForHumanTakeover` clears `assignee_agent_id`, unsets `routing_meta.voice_assistant_*`, and stamps `routing_meta.ai_paused_by_human_at/_user_id` (skipped if already paused and no agent). Consequently even an empty/invalid reply pauses the AI (WD-TIB1-033). Only the text reply does this — media, voice and catalog sends do NOT.
  2. Body resolution: template path first (WD-TIB1-018); then `AttributeResolver->resolve(body, variable_map, ws, recipientContact)` replaces `{{N}}`/`{{name}}` with per-contact values (recipient contact = `conversations.contact_id`, else a contact whose digits equal raw_jid/alt_jid — QUIRK: that fallback hydrates every workspace contact in PHP and only matches bare-digit JIDs (WABA), not `@s.whatsapp.net` Baileys JIDs). Empty body => 422 `empty_body`.
  3. Recipient number resolution order: last inbound message's `from_number`; else digits (8-15) parsed out of the conversation title; else last outbound `to_number`; else the legacy `messages` (Quick Send) table's last outbound `to_number`. If none AND the thread has no `raw_jid`, the row is created and immediately marked failed "No recipient phone or JID resolved for this conversation." `meta.target_jid = raw_jid` is always attached so LID-routed Baileys chats send to the real JID instead of a fabricated number.
  4. Sender number (`from_number`): device_id is polymorphic — for provider waba/twilio it is read from `wa_provider_configs.phone_number` (digits), otherwise from the `devices` row (country_code+phone_number).
  5. Dispatch via `InboxDispatcher::send` (WD-TIB1-026). A PlanLimitReachedException or any other throwable is caught and stored as the failure reason (191 chars) — the HTTP response is still 200 `ok:true` with the failed message.
  6. `local_only` provider results count as SUCCESS: the row is marked `sent` even though nothing left the platform (e.g. WABA workspace with no token, missing SERVER_URL) — QUIRK.
  7. On any outcome the conversation preview/last_message_at/last_outbound_at update and escalation is cleared; the first reply on the thread calls `SlaTracker::markFirstResponse` (TIB2). QUIRK: a reply never changes `inbox_status` — replying to a resolved or snoozed thread leaves it resolved/snoozed.
  8. Duplicate-send guard is client-side only (button lock while in flight).
  9. Billing is plan-first overflow (monthly message allowance free, then 1 wallet credit) inside the dispatcher; WaDesk docs still describe wallet-charge-then-refund, which is not what the code does (WALLET/BSP own the meter).
- **Async & events:** Broadcast `message.received` (direction out, `->toOthers()`), audit `conversation.replied`, outbound webhook `conversation.replied` {message_id, body, by_user_id} (WD-TIB1-047), in-app poll for ticks.
- **External systems:** Per channel (see WD-TIB1-026).
- **Settings:** admin `allowed_send_methods`, workspace engine set, plan `monthly_messages_limit`.
- **Acceptance criteria:**
  - Given an Agent replying "Hello" on a Baileys thread with a connected device, When sent, Then an `inbox_messages` out row is `sent` with `wa_message_id`, `agent_statuses.today_replies` +1, conversation preview "Hello", and a `conversation.replied` audit row.
  - Given the workspace hit its monthly limit with zero wallet credit, When the agent replies, Then the response is 200 with the message `failed` and the plan-limit text as `failure_reason`.
  - Given a thread with an assigned AI agent, When a human replies, Then `assignee_agent_id` is null and `routing_meta.ai_paused_by_human_at` is set.
  - Given a Viewer, When they POST a reply, Then 403.
  - Given `body` empty and no template, When posted, Then 422 `empty_body` (and the AI still pauses).
- **Source refs:** app/Http/Controllers/TeamInboxController.php (reply, pauseAiForHumanTakeover, contactRowForConversation), app/Services/InboxDispatcher.php, app/Models/InboxMessage.php, app/Policies/ConversationPolicy.php, Documentation/pages/messaging/team-inbox.html
- **Port notes:** Command `SendMessage` in the conversations module: persist message + outbox event `message.send_requested`, a BullMQ worker performs the provider call (never inline), the row transitions pending->sent/failed via provider adapter results. Return 202 with the pending message; keep status updates via realtime. Fix: reject `ok:true` for local-only; take the human-takeover pause into a domain event after validation.

### WD-TIB1-018 — Template reply with send-time variable mapping

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-TIB1-017
- **Summary:** From the composer's Template tab the agent picks a channel-appropriate template, fills its variables, swaps header media or button links for this send only, and the server renders a compliant template message (WABA `type:template`, Baileys interactive, Twilio ContentSid, Instagram/Telegram buttons).
- **Actors & access:** Same as WD-TIB1-017. Templates must belong to the workspace (`forCurrentWorkspace`); a template id from another workspace is silently ignored and the request then fails as `empty_body`.
- **UX & screens:** Template tab shows a searchable grid (up to 180 px tall, 2-3 columns) of cards (title, status pill approved/public/pending/rejected, category, media type, button count, 80-char body preview) filtered to the open chat's channel bucket: whatsapp (baileys/waba/twilio), instagram, facebook, telegram, line, wechat, viber, sms. Clicking a card hides the grid/textarea and shows a WhatsApp-style preview bubble (header bold, body, footer, buttons; Instagram templates tinted magenta) plus the send-time mapping panel (variables, header media, button links) shared with campaigns/broadcasts. "Clear - pick another" returns to the grid; Send posts `template_id` (+ `template_overrides` JSON only if changed), then flips back to the Reply tab.
- **Endpoints:** `POST team-inbox/api/conversations/{id}/reply` (see WD-TIB1-017).
- **Data:** `meta` of the outbound row: header, footer, buttons (override-resolved), template_id, template_name, template_language (default `en`), template_vars (FLAT positional), template_send_vars (section-keyed) — empty header/footer/buttons removed.
- **Rules & edge cases:**
  1. Template body replaces the typed body. Variables resolve via `BroadcastsController::varsForRecipient(template, contactRow, ws, overrides)` (the same resolver campaigns/broadcasts/scheduled sends use); `contactRowForConversation` supplies the contact (or a phone-only row when the number is not a saved contact).
  2. The text body, header and footer are ALSO substituted locally, because only the WABA payload builder consumes `template_vars`; without this Baileys/Twilio-text would deliver a literal `{{1}}`. A blank name-like slot (`name`, `first_name`, `full_name`) becomes "there"; other blank slots collapse to nothing and punctuation is tidied (double spaces, space before punctuation, doubled commas).
  3. Button overrides replace `buttons[i].value` for indexes present in the override list, rendered through the resolver with the contact.
  4. Any exception while resolving overrides is logged and swallowed: the template is sent as authored rather than failing the reply.
  5. WABA builds the Graph payload with `TemplatePayloadBuilder::buildSend` (pads/caps parameters to the approved template, header/button components, template sample media fallback) — this fixed Meta errors 132000/132012 that a hand-rolled builder caused.
  6. Templates are excluded from translation (`meta.template_*` present) and keep their authored language.
  7. Twilio: if the template has `twilio_content_sid` the send is a ContentSid send with `ContentVariables` from `meta.template_vars`; else plain body.
  8. Instagram thread sends map buttons: web_url + postback (max 3 generic buttons) OR quick replies (max 13), one shape per send.
- **Async & events:** as WD-TIB1-017.
- **External systems:** Meta Graph `messages` (template), Twilio Messages API, Instagram/Telegram adapters.
- **Settings:** template library (TPL domain).
- **Acceptance criteria:**
  - Given an approved WABA template "Hi {{1}}, your order {{2}} shipped" and overrides for both slots, When sent, Then the Graph request is `type:template` with two body parameters and the stored bubble shows the substituted text.
  - Given a Baileys thread and a template with a blank first-name slot, When sent, Then the customer receives "Hi there, ..." with no literal placeholders.
  - Given a template id from another workspace, When posted, Then 422 `empty_body` and nothing is sent.
  - Given an Instagram chat, When the Template tab opens, Then only Instagram templates are listed.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (reply template branch, index chatTemplates), resources/js/charts/user-team-inbox-index.js (selectTemplate, applyTemplateFilter, clearTemplateSelection), app/Services/InboxDispatcher.php (buildCloudPayload, dispatchTwilio)
- **Port notes:** Template rendering belongs to the TPL module service; the inbox calls `renderForContact(templateId, contactId, overrides)` and passes a typed `TemplateContent` to the channel adapter. Add server-side workspace check that returns 404 for foreign template ids.

### WD-TIB1-019 — Media attachment reply (`POST .../media`)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TIB1-017
- **Summary:** Send images, videos, documents and audio files to the customer, one message per file, with an optional caption on the first.
- **Actors & access:** `ConversationPolicy::reply`.
- **UX & screens:** Paperclip opens a multi-file picker (browser filter: image/_, video/_, application/pdf); thumbnails with remove buttons appear in an "Attachments" strip with Clear all / Send all. Files are POSTed sequentially so they arrive in order; the composer text is used as the caption of the FIRST file only and then cleared. Toast "Sent N attachments" or "Sent N, failed M".
- **Endpoints:**

| Endpoint                                     | Route name                | Action                         | Middleware   | Request                                                                  | Response             |
| -------------------------------------------- | ------------------------- | ------------------------------ | ------------ | ------------------------------------------------------------------------ | -------------------- |
| POST team-inbox/api/conversations/{id}/media | user.team-inbox.api.media | TeamInboxController@mediaReply | Authenticate | multipart `file` (required, max 16384 KB), `caption` (nullable max 1024) | `{ok:true, message}` |

- **Data:** File stored on the media disk (local `public` or cloud, per admin storage settings) at `chat-media/<24 random chars>__<sanitized original name>` (non `[A-Za-z0-9._-]` replaced with `_`). `inbox_messages.media_path`, `media_type` by MIME (`image/`, `video/`, `audio/`, else `document`), body = caption. Conversation preview `📷 Image`, `🎥 Video`, `🎵 Audio` or `📎 Document`.
- **Rules & edge cases:**
  1. Server accepts any MIME within 16 MB (the picker's filter is only a UI hint; audio/docx need drag or a different path).
  2. Recipient and dispatch rules identical to WD-TIB1-017, except `from_number` is always read from the Baileys `devices` table (WABA threads get null/incorrect from_number; the WABA dispatcher resolves its own number) — QUIRK.
  3. No human-takeover pause and no audit log entry (unlike text reply and voice).
  4. First-response marking, `today_replies` increment, broadcast and `conversation.replied` webhook (with media_type and caption) do run.
  5. WABA: media is uploaded to Meta `/media` first and sent by id (link only as a fallback), so private storage works; documents keep the file name; audio has no caption.
- **Async & events:** As WD-TIB1-017 minus audit.
- **External systems:** Meta media upload, Node bridge (`/api/send-media-message` with caption or `/api/send-media-only`), Twilio MediaUrl.
- **Settings:** admin storage settings (SET), `daily_media_size_allowance` plan limit is NOT enforced here.
- **Acceptance criteria:**
  - Given three selected images and a caption, When Send all is pressed, Then three messages send in order and only the first has the caption.
  - Given a 20 MB file, When posted, Then validation 422 (max 16384 KB).
  - Given storage is not writable, When posted, Then the row is created without media (see WD-TIB1-020 for the voice guard, which media lacks) — QUIRK: the media path can be false-y and the dispatcher then sends empty text.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (mediaReply), resources/js/charts/user-team-inbox-index.js (media attach block), app/Services/InboxDispatcher.php (buildNodeRequest, uploadMediaToMeta)
- **Port notes:** Presigned upload to object storage, then `POST .../messages` referencing the asset id; virus/MIME check; per-channel size limits (WhatsApp 16 MB media, 100 MB documents) instead of a flat 16 MB.

### WD-TIB1-020 — Voice note reply (`POST .../voice`)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-TIB1-017
- **Summary:** Record audio in the browser and send it as a WhatsApp voice note (round play bubble).
- **Actors & access:** `ConversationPolicy::reply`.
- **UX & screens:** Mic button starts `MediaRecorder` (preferred `audio/webm;codecs=opus`, then ogg/opus, webm, mp4) after the browser mic prompt; a red recording bar shows elapsed time with Cancel / Stop; after stop a preview bar plays the clip with "Redo" and "Send voice". Errors: unsupported browser, mic denied.
- **Endpoints:**

| Endpoint                                     | Route name                | Action                        | Middleware   | Request                                                                         | Response                                                                |
| -------------------------------------------- | ------------------------- | ----------------------------- | ------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| POST team-inbox/api/conversations/{id}/voice | user.team-inbox.api.voice | TeamInboxController@voiceNote | Authenticate | multipart `audio` (required file max 16384 KB), `duration` (nullable int 0-600) | `{ok:true, message}` or 422 `{ok:false,error}` when storage write fails |

- **Data:** File saved as `chat-media/<random24>.<ext>` where ext is the client extension if in {webm, ogg, mp3, m4a, aac, wav, mp4, oga} else `webm`. Row: `media_type audio`, `body null`, `meta {ptt:true, duration, target_jid}`; preview "🎤 Voice note".
- **Rules & edge cases:**
  1. If the storage write returns empty, the request fails 422 with a setup hint (admin: check Cloud Storage credentials or make `storage/app/public` writable and run `storage:link`) and NO message is created (prevents a text-less send that Meta rejects with "text.body is required").
  2. Baileys: sent to `/api/send-media-only` with `ptt/voice` true and mime `audio/ogg; codecs=opus` (the caption endpoint ignores ptt). WABA: containers ogg/oga/mp3/m4a/aac/amr/mp4 pass through; webm is remuxed to Ogg/Opus by a pure-PHP remux (no ffmpeg), falling back to ffmpeg (`ffmpeg_path` setting or PATH), else the message FAILS with a clear reason (never silently sent as a document); uploaded as `audio/ogg`.
  3. Recipient resolution as WD-TIB1-017 (title fallback, outbound, legacy messages). `from_number` Baileys-only lookup (same QUIRK as media).
  4. Audit `conversation.voice_replied`; first-response, `today_replies`, broadcast run; no `conversation.replied` webhook and no AI pause.
- **Async & events:** as above.
- **External systems:** Meta media upload; optional ffmpeg binary.
- **Settings:** `ffmpeg_path` system setting.
- **Acceptance criteria:**
  - Given Chrome recording webm/opus on a WABA thread, When sent, Then the audio is uploaded to Meta as ogg/opus and the row is `sent`.
  - Given webm audio on a server where remux and ffmpeg both fail, When sent, Then the row is `failed` with the "could not convert" reason.
  - Given the storage disk is unwritable, When posted, Then 422 with the storage hint and no `inbox_messages` row.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (voiceNote), app/Services/InboxDispatcher.php (prepareWabaAudio, transcodeToOggOpus), app/Support/Audio/WebmOpusToOgg.php, resources/js/charts/user-team-inbox-index.js (voice recorder block)
- **Port notes:** Do the webm->ogg/opus remux in a worker (ffmpeg static binary or a JS remuxer such as `opus-media-recorder`/`ogg-opus`), not in the request; record with `audio/ogg;codecs=opus` where supported.

### WD-TIB1-021 — Catalog message from the composer (SPM / MPM / link)

- **Status:** partial
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-TIB1-017
- **Summary:** Send a single product, a multi-product list (up to 30) or a catalog link. With a linked Meta catalog it uses WhatsApp's native catalog messages; without one it falls back to a Baileys carousel/image message built from the workspace's own products. The server path works; the composer's Send button is broken.
- **Actors & access:** `ConversationPolicy::reply`. Products come from the store/catalog domain (CAT/STORE).
- **UX & screens:** Composer catalog icon opens a modal: mode pills (Single product / Product list / Catalog link), product search, product grid (image, name, price, "synced"/"not synced" badge) loaded from `/store/products/api/list`, optional message (max 1024), "N selected / 30 max", Send. Product list disallows the 31st pick with a warning. QUIRK (bug): the Send handler reads `state.activeConvId`, a property that is never assigned (the app uses `state.activeId`), so it always says "Pick a conversation first" and never calls the endpoint.
- **Endpoints:**

| Endpoint                                       | Route name                  | Action                             | Middleware   | Request                                                                                                                                                                | Response                                                                                   |
| ---------------------------------------------- | --------------------------- | ---------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| POST team-inbox/api/conversations/{id}/catalog | user.team-inbox.api.catalog | TeamInboxController@catalogContent | Authenticate | `mode` (spm\|mpm\|link, required), `body` (max 1024), `header` (max 60), `footer` (max 60), `product_retailer_ids[]` (max 30, each string max 100), `product_id` (int) | `{ok, mode, message_id[, provider:'baileys']}`; errors 402 `plan_limit`, 422 `no_recipient | no_device | no_shop | no_products`, 502 `provider_error | baileys_error`, 500 `server_error` |

- **Data:** Writes an outbound `inbox_messages` row (status `sent`, `to_number` digits of raw_jid, `meta {kind:'catalog', mode, provider:'waba'|'baileys', wa_message_id, catalog_payload|response, products[{id,name,image_url,price_minor,currency,price_display,retailer_id}]}`). Reads `wa_catalogs`, `wa_products`, `wa_storefronts`.
- **Rules & edge cases:**
  1. Path selection: a `wa_catalogs` row for the workspace => WABA native (`WhatsAppCatalogFactory::forCatalog`): SPM needs `product_id` (workspace-scoped) or a retailer id (`meta_retailer_id`, else `sku`, else `wsn-<id>`); MPM groups retailer ids into sections by product category (default "Featured", header default "Our catalog", body default "Tap a product to learn more"); link sends a catalog link (default text with `https://wa.me/c/<digits>`). No catalog => Baileys via `BaileysCatalogService` (carousel or storefront link using the newest `wa_storefronts.public_url`; `no_shop` if none).
  2. Billing is metered here because this path bypasses the dispatcher: usage = this month's outbound rows in `inbox_messages` (via conversation workspace) + `messages` (workspace members' user ids) then `OverflowBilling::consumeOne`; over-limit returns 402.
  3. Recipient is `raw_jid ?? alt_jid` digits only (no fallbacks); the row is created only AFTER the provider accepts, so failed sends leave no bubble.
  4. Not marked as first response, no `today_replies`, no broadcast, no webhook, no AI pause.
  5. Meta's 24-hour rule applies (error 131047 forwarded in the response).
- **Async & events:** none.
- **External systems:** Meta Commerce/Cloud API catalog messages; Node bridge (Baileys carousel).
- **Settings:** `wa_catalogs` linkage (CAT).
- **Acceptance criteria:**
  - Given a linked Meta catalog and mode `mpm` with 3 retailer ids, When posted, Then a multi-product message is sent and an outbound catalog row with 3 product summaries is stored.
  - Given no linked catalog and mode `spm`, When posted, Then a Baileys image/carousel is sent.
  - Given mode `link` and no storefront, When posted, Then 422 `no_shop`.
  - Given the composer modal, When the user clicks Send, Then (as shipped) the UI errors before calling the API — the port should fix this and the acceptance is that the picked conversation id is sent.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (catalogContent, sendViaBaileys, sendSPMFromRequest, sendMPMFromRequest), resources/js/charts/user-team-inbox-index.js (wireCatalogModal), app/Services/WhatsAppCatalog/*
- **Port notes:** Implement as a `CatalogMessage` content type in the conversations module with adapters per provider; create the message row up-front in `pending` like other sends.

### WD-TIB1-022 — Google Meet link insertion in the composer

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-TIB1-017
- **Summary:** A composer button mints a Google Calendar event with a Meet link through the workspace's connected Google account and drops a message (default "Your meeting link: <url> Starts <time>") into the composer for the agent to review and send. The endpoint and Google integration are owned by INTG; this entry documents the composer half.
- **Actors & access:** Any authenticated member with a workspace (Authenticate only). Requires the workspace to have connected Google Calendar and the platform toggle `google_calendar_enabled` on.
- **UX & screens:** Modal: title (default "Call with <contact name>", max 200), start (in 5/15/30/60 min or tomorrow 10:00), duration (15/30/45/60), message template (max 800; `{{meet_link}}` and `{{meet_start}}` substituted), checkbox "Email a Google Calendar invite to the customer (only if their email is on file)". Create button "Create + insert into composer". Inline error text on failure. Nothing is sent automatically.
- **Endpoints:**

| Endpoint                        | Route name                      | Action                                       | Middleware   | Request                                                                                                                                                  | Response                                         |
| ------------------------------- | ------------------------------- | -------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| POST team-inbox/api/google-meet | user.team-inbox.api.google-meet | FlowNodeActionsController@googleMeetForInbox | Authenticate | `title` (required max 200), `start_at` `end_at` (ISO strings), `description` (max 1500), `attendee_emails[]`, `time_zone`, `send_invites`, `calendar_id` | `{ok, meet_url, start, ...}` or `{ok:false,error | message}`(401 no workspace, 422 bad datetime / end before start, 503 integration disabled,`not_connected`) — route claimed by INTG |

- **Data:** none written by the inbox.
- **Rules & edge cases:**
  1. Client computes start/end in the browser timezone and sends ISO strings plus the IANA zone.
  2. `send_invites` only takes effect if the server has an attendee email (the UI never passes attendee emails, so the checkbox has no effect from this screen) — QUIRK.
  3. Requires a fresh Google token; a disabled platform toggle returns 503 with an admin hint.
- **Async & events:** none.
- **External systems:** Google Calendar API (conferenceData.createRequest).
- **Settings:** admin `google_calendar_enabled`; workspace Google connection.
- **Acceptance criteria:**
  - Given a connected Google account, When the agent picks "In 15 min / 30 min" and creates, Then the composer contains the message with the Meet URL and start time and no message has been sent.
  - Given Google not connected, When creating, Then the modal shows the "Connect Google Calendar in Settings" error.
- **Source refs:** resources/js/charts/user-team-inbox-index.js (wireMeetModal), resources/views/user/team-inbox/index.blade.php (#meet-modal), app/Http/Controllers/FlowNodeActionsController.php (googleMeetForInbox)
- **Port notes:** Compose a `meeting.create` call to the INTG module; inbox only inserts the returned text.

### WD-TIB1-023 — AI reply suggestion (draft, never auto-sent)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-TIB1-017
- **Summary:** An "AI suggestion" bar above the composer asks a workspace AI agent to draft a reply for the open conversation; the agent chooses Use (copies into the composer to edit and send) or dismisses.
- **Actors & access:** `ConversationPolicy::reply`; plan feature `access_ai_agents` (403 `{error:'plan'}` otherwise). The bar exists only when the page was rendered with `aiSuggestEnabled` (plan feature AND >= 1 active agent).
- **UX & screens:** Bar with sparkle icon, text "Draft a reply for this conversation.", buttons Suggest / Use / X. States: idle, "Thinking...", suggestion text, error toast ("AI agents are not in your plan." / "No active AI agent to draft from." / "Could not generate a suggestion."). Dismissing (X) hides the bar for that conversation until another is opened.
- **Endpoints:**

| Endpoint                                          | Route name                     | Action                        | Middleware   | Request | Response                                                                                                      |
| ------------------------------------------------- | ------------------------------ | ----------------------------- | ------------ | ------- | ------------------------------------------------------------------------------------------------------------- |
| POST team-inbox/api/conversations/{id}/ai-suggest | user.team-inbox.api.ai-suggest | TeamInboxController@aiSuggest | Authenticate | none    | `{ok:true, suggestion, agent}` or `{ok:false, error: plan\|no_agent\|generation_failed\|empty}` (403/422/502) |

- **Data:** none written.
- **Rules & edge cases:**
  1. Agent selection: the conversation's assigned active AI agent; else the contact's pinned agent (looked up by an SQL equality of `contacts.mobile` to `raw_jid` — QUIRK: `mobile` is encrypted so this never matches); else the workspace's oldest active agent (lowest id). All scoped to the workspace.
  2. Generation reuses `AiAgentService::generateReply(agent, conversation)` (same generator as auto-reply: tone, KB, saved replies, vision) — AIAG owns it; failures are 502, empty output 502.
  3. Suggestion text is trimmed; nothing is stored or billed here beyond what the AI service meters.
- **Async & events:** none.
- **External systems:** OpenAI/Anthropic/Gemini via the workspace or platform key (AIAG/AIADM).
- **Settings:** plan `access_ai_agents`; AI keys.
- **Acceptance criteria:**
  - Given a workspace with one active agent, When Suggest is clicked, Then the bar shows a draft and Use fills the composer without sending.
  - Given a plan without AI agents, When called directly, Then 403 `{error:'plan'}`.
  - Given no active agent, When called, Then 422 `no_agent`.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (aiSuggest, index), resources/js/charts/user-team-inbox-index.js (initAiSuggest), resources/views/user/team-inbox/index.blade.php (#ti-aibar)
- **Port notes:** Call the AIAG `draftReply` port; add a conversation-scoped rate limit.

### WD-TIB1-024 — Saved (canned) replies: picker, shortcuts and management

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-TIB1-002
- **Summary:** Reusable message snippets with a `/shortcut`, title, body and optional category, shared workspace-wide or personal, inserted into the composer from a picker or by typing `/`, sorted by real usage.
- **Actors & access:** Create: `savedreply.manage` (Owner, Admin, Manager) plus plan cap `saved_replies_limit`. Update/delete: any workspace member for SHARED replies (no permission check) — QUIRK; personal replies of another user require `savedreply.manage`. Use/list: any member (shared + own personal). The rail management button is shown only with `savedreply.manage`; the composer picker is available to every role.
- **UX & screens:** Composer "Shortcuts" tab and `/` as first character open a picker: search field (matches shortcut, title or body), "Create new shortcut" row with total, list rows (`/shortcut`, title, 80-char body). Choosing a reply loads the body into the composer (both the hidden and rich textarea), expands `{{device_phone}}` and `{{device_name}}` from the open conversation's pinned device, bumps usage in the background, toasts "Quick reply loaded." Management modal (`#quick-replies-modal`): list with `/shortcut`, title, category, "personal", "Used N x", edit and delete (browser confirm), "Add reply" opening the form (shortcut, title, body, category, "Personal (only me)").
- **Endpoints:**

| Endpoint                                    | Route name                        | Action                                  | Middleware   | Request                                                                                                                | Response                         |
| ------------------------------------------- | --------------------------------- | --------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| GET team-inbox/api/saved-replies            | user.team-inbox.api.saved.index   | TeamInboxController@savedRepliesIndex   | Authenticate | none                                                                                                                   | array of rows, `used_count` desc |
| POST team-inbox/api/saved-replies           | user.team-inbox.api.saved.store   | TeamInboxController@savedRepliesStore   | Authenticate | `shortcut` (req max 64), `title` (req max 128), `body` (req max 4000), `category` (nullable max 64), `personal` (bool) | `{ok, saved_reply}`              |
| PATCH team-inbox/api/saved-replies/{id}     | user.team-inbox.api.saved.update  | TeamInboxController@savedRepliesUpdate  | Authenticate | any of shortcut/title/body/category                                                                                    | `{ok, saved_reply}`              |
| DELETE team-inbox/api/saved-replies/{id}    | user.team-inbox.api.saved.destroy | TeamInboxController@savedRepliesDestroy | Authenticate | none                                                                                                                   | `{ok:true}`                      |
| POST team-inbox/api/saved-replies/{id}/used | user.team-inbox.api.saved.used    | TeamInboxController@savedRepliesUse     | Authenticate | none                                                                                                                   | `{ok, used_count}`               |

- **Data:** `saved_replies(workspace_id, user_id null=shared, shortcut varchar64, title varchar128, body encrypted text, attachments JSON (unused), category varchar64, used_count bigint default 0)`; indexes on workspace_id, user_id, shortcut (NOT unique).
- **Rules & edge cases:**
  1. Shortcut is normalized with `Str::slug(shortcut, '_')` (lowercase, underscores); duplicates are allowed — the picker just lists both.
  2. `personal=true` sets `user_id` to the creator on CREATE only; PATCH ignores `personal` (validation drops it), so visibility cannot be toggled afterwards.
  3. Plan cap: `PlanLimitGuard::check('saved_replies_limit', count of ALL workspace rows including others' personal ones)`; NULL/0 limit = unlimited.
  4. Picker ordering and bootstrap ordering by `used_count` desc; `used` endpoint increments atomically and returns the new count; the reply must be accessible (shared or mine).
  5. Body supports `{{attribute}}` placeholders resolved on send by the attribute resolver (WD-TIB1-017); `attachments` is never used (docs claim "playbook macros"; none exist).
  6. Bootstrap returns body decrypted; list endpoint returns the model (body decrypted by cast).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** plan `saved_replies_limit`.
- **Acceptance criteria:**
  - Given a Manager creates "Thanks!" with shortcut "Thank You", When saved, Then the stored shortcut is `thank_you` and it appears for every member.
  - Given an Agent, When they POST a new saved reply, Then 403; When they PATCH a shared reply, Then 200 (as shipped).
  - Given a reply used three times, When bootstrap loads, Then it sorts above unused ones and shows "Used 3x".
  - Given the workspace is at its plan limit, When a Manager creates another, Then the plan-limit error is returned.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (savedReplies*), app/Models/SavedReply.php, resources/js/charts/user-team-inbox-index.js (savedRepliesPicker, quick replies modal), resources/views/user/team-inbox/index.blade.php
- **Port notes:** Table `saved_replies` with RLS; unique (org, lower(shortcut), owner) is an improvement worth adding; use TIPTAP/plain text body. Tighten update/delete permissions to owner-or-manage.

### WD-TIB1-025 — New outbound message to many recipients (Compose)

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** WD-TIB1-026, WD-TIB1-042
- **Summary:** The "+" button opens a panel to start brand-new conversations: pick a sending channel, then any mix of saved contacts, contact groups, a "Last 24h chats" batch and pasted numbers (or, for Instagram, existing IG conversations), type one message and send it to everyone.
- **Actors & access:** Any authenticated member — QUIRK: no permission check at all (a Viewer can send). Plan/wallet/guardrail gates apply inside the dispatcher per recipient.
- **UX & screens:** `#compose-panel` overlay: WhatsApp / Instagram tabs (IG tab shown only if IG accounts exist), "Send from" select (`engine:id` senders across enabled engines, or IG accounts), recipient counter, manual numbers textarea (comma/semicolon/newline separated; spaces inside a number are kept), contact-group chips (first chip "Last 24h chats (N)" when any), searchable contact checklist (first 500 shown), message box (4096), Send. Instagram recipients list shows each IG conversation with `open` or `24h+` chips and a reply-only explanation. On success toast "Sent to N recipients, M failed" and the panel closes; on a zero-success result the error text shows.
- **Endpoints:**

| Endpoint                           | Route name                          | Action                             | Middleware   | Request                                                                                                                                                                                  | Response                                                                                   |
| ---------------------------------- | ----------------------------------- | ---------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| GET team-inbox/api/compose/options | user.team-inbox.api.compose.options | TeamInboxController@composeOptions | Authenticate | none                                                                                                                                                                                     | `{channels[], ig_channels[], ig_conversations[], contacts[], groups[], last24h_numbers[]}` |
| POST team-inbox/api/compose        | user.team-inbox.api.compose.send    | TeamInboxController@composeSend    | Authenticate | `channel` (req string max 40), `body` (nullable max 4096), `template_id` (exists), `contact_ids[]`, `group_ids[]` (numeric or `last24h`), `numbers` (max 20000), `ig_conversation_ids[]` | `{ok: sent>0, sent, failed, total, capped, errors[<=5]}`; 422 `no_workspace                | empty_body | no_recipients | bad_channel | not_connected` |

- **Data:** Options: channels from `WorkspaceEngine::senders` (`key` = engine:id, label, phone, engine label); contacts = newest 3000 workspace contacts excluding `is_unsubscribed` and numbers under 8 digits (id, name, canonical phone, group ids); groups (name is encrypted, sorted in PHP, natural case-insensitive); `last24h_numbers` = distinct `contact_digits` (8-15 digits) of any conversation with `last_message_at` within 24 h; `ig_conversations` = 200 newest IG threads with `window_open`. Send writes conversations + inbox_messages.
- **Rules & edge cases:**
  1. Recipient set = selected contacts + members of selected groups (search over the first 5000 contacts, unsubscribed skipped) + `last24h` digits + manual numbers (>= 8 digits); de-duplicated; capped at 500 (`capped:true`). Manual numbers are NOT checked against opt-outs or the unsubscribe list.
  2. Per recipient: `ConversationResolver::find(ws, to)` (one thread per number). New number => create conversation `{origin inbox, platform W, provider engine, device_id, title = number, status pending, raw_jid = <digits>@s.whatsapp.net, last_message_at}`. Existing thread => patch preview/last_message_at, rebind `device_id` only if it is null or points at a deleted device, reopen if `closed|resolved|spam`, upgrade bare-digit raw_jid to the JID form. QUIRK: the chosen "Send from" only decides the channel of BRAND-NEW threads; an existing thread keeps its own provider/device.
  3. The message row (`meta {source:'compose', target_jid, template...}`) is dispatched inline per recipient, sequentially, within the single HTTP request (a 500-recipient send can exceed request time limits). Success stamps `sent` + `wa_message_id`, updates last_outbound_at/preview; failure stores the error (190 chars). Up to 5 distinct error messages are returned.
  4. Template support exists in the API (`template_id` replaces body and adds template meta) but the compose UI has no template picker.
  5. Instagram tab: body required, recipients are existing IG conversations only (max 200 per send), sent through the Instaflow client (`InstaflowClient::reply`) with template buttons mapped as in WD-TIB1-018; rows are mirrored into the thread with the returned message id; requires Instaflow to be configured (`not_connected`).
  6. Audit `conversation.compose` {sent, failed, engine} for the WhatsApp path.
  7. Sending a message opens no 24 h window on WABA: a new outbound-first WABA thread needs an approved template, which this UI cannot select — plain text will be rejected by Meta.
- **Async & events:** No broadcast or webhook per message (only what the dispatcher does).
- **External systems:** Same as WD-TIB1-026; Instaflow bridge for IG.
- **Settings:** admin `allowed_send_methods`; per-engine enablement.
- **Acceptance criteria:**
  - Given two contacts and one manual number, When sent, Then three conversations exist (created or reused), each with an outbound row, and the response has `sent=3`.
  - Given 700 numbers, When sent, Then only 500 are attempted and `capped=true`.
  - Given an unsubscribed contact selected, When sent, Then it is skipped silently.
  - Given a resolved existing thread for a number, When composed to, Then the thread reopens (`inbox_status = open`).
  - Given no recipients resolved, When posted, Then 422 `no_recipients`.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (composeOptions, composeSend, resolveComposeRecipients, deliverComposed), app/Services/Inbox/ConversationResolver.php, app/Services/WorkspaceEngine.php, resources/js/charts/user-team-inbox-index.js (compose IIFE)
- **Port notes:** Add `inbox.reply` permission and opt-out enforcement (CON); make it a background "bulk send" job with progress instead of an inline loop (this overlaps BCAST — consider deleting it in favor of broadcast for > 20 recipients).

### WD-TIB1-026 — Outbound dispatch pipeline (`InboxDispatcher::send`)

- **Status:** implemented
- **Priority:** P0
- **Effort:** XL
- **Depends on:** none
- **Summary:** The single service that turns a stored outbound `inbox_messages` row into a provider call: it applies platform/plan gates, resolves the recipient and the engine, translates and footers the text, then branches by channel and engine. It returns `{ok, platform, provider_id, local_only, error}` and never throws to callers for provider errors.
- **Actors & access:** Called by replies, compose, forward, AI agent, flows, keyword replies, routing auto-replies (system).
- **UX & screens:** none (failure reasons surface on the bubble).
- **Endpoints:** none.
- **Data:** Reads/updates the message row (`provider` stamped, `to_number` backfilled, `meta`), reads `conversations` (channel, provider, device_id, raw_jid), `wa_provider_configs`, `devices`, `system_settings` (`allowed_send_methods` default `[baileys,waba,twilio]`, `default_send_method` default `baileys`, `waba_graph_api_version` default `v23.0`, `baileys_server_url`).
- **Rules & edge cases:**
  1. Order of gates: (a) platform emergency halt (`SendGate::halted`, admin Danger zone) => `{ok:false, platform:'halted'}`; (b) guardrails `SendGate::screen(ws, body)` rate caps/content filters (monitor logs only, enforce throws) => `{ok:false, platform:'blocked'}`; (c) monthly message cap + credit overflow via `guardMonthlyMessagesLimit` (counts this month's outbound rows in `inbox_messages` via conversation workspace + `messages` for workspace members; then `OverflowBilling::consumeOne(ws, used, null, 'service')`; throws PlanLimitReachedException when over cap with zero credits) — the count already includes the just-created pending row; (d) `ensureRecipient` backfills `to_number` (phone JID digits of raw_jid/alt_jid, else last inbound from, else contact mobile) and always keeps `meta.target_jid`.
  2. Engine resolution (`resolveProvider`): explicit `inbox_messages.provider` pin if admin-allowed AND enabled for the workspace; else the conversation's `provider`; else the workspace primary provider config if connected and allowed; else legacy platform hint (`W/WB/T`); else admin default; else first allowed. The engine is applied to the in-memory message for the call only and restored afterwards so a fallback never overwrites the stored pin.
  3. Then translation (`translateOutbound`, I18N) and branding footer. QUIRK: `applyBrandingFooter` reads `$msg->workspace_id`, a column `inbox_messages` does not have, so the plan-gated footer is never appended to inbox sends.
  4. Channel routing by `conversations.channel` / message provider, evaluated BEFORE the engine: `instagram` (addon direct Graph send, else Instaflow bridge), `facebook` (Messenger DM via Send API, or public comment reply for `fb:<page>:post:<post>` threads, media as attachment then caption as a follow-up), `tiktok` (partner/region gated, image or text), `telegram` (`tg:<botId>:<chatId>`; text/media; template buttons as keyboard), `line` (`line:<rowId>:<userId>`; free reply token if < 55 s old else billable push; up to 5 message objects), `wechat` (`wechat` 48 h customer-service window, else error "template message is required"), `viber` (subscribed users only), `sms` (`sms:<customerDigits>`; replies from the number the customer texted; text only), `email` (MailTrixy bridge). `chatbot_widget` and other agnostic channels return `{ok:true, platform:'WIDGET'}` (the widget polls for out rows).
  5. Engines: WABA => Meta Graph API direct from PHP (`POST /{version}/{phone_number_id}/messages`, bearer workspace token, timeout 25 s, 2 retries): text; media (upload to `/media` first, remux webm audio, send by id; link fallback); template via `TemplatePayloadBuilder`; interactive reply buttons (max 3, title 20 chars, body 1024, header 60, footer 60); groups use `recipient_type = group` with the group id from raw_jid; the WABA number used is the conversation's own config (`device_id`) else the primary. Baileys => Node bridge `POST {server_url}/api/send-message|send-media-message|send-media-only/{devicePhone}` with `targetPhoneNumber`, optional `targetJid`, base64 file, `ptt`, buttons/footer/title, timeout 20 s (60 s with media); the device phone is the message `from_number`, else the conversation device, else the primary config phone, else any connected device of the user. Twilio => REST `Messages.json` with `whatsapp:+E164`, `StatusCallback = {APP_URL}/api/twilio/status`, `MediaUrl`, or ContentSid; sandbox forces the sandbox number.
  6. Missing credentials return `local_only` with `ok:true` (WABA no token/phone id, Twilio no creds, Baileys no SERVER_URL) — callers then mark the message `sent` (see QUIRK in WD-TIB1-017). A Baileys thread with no device returns a real failure "No connected device - pair one at /devices first."
  7. Other dispatcher operations: `reaction` (WABA via Graph; Baileys via `/api/send-reaction/{from}`; Twilio local-only), `pin`/`star`/`deleteForEveryone`/`editForEveryone` via `messageAction` (Baileys `/api/pin-message|star-message|delete-message|edit-message/{from}`, 10 s; WABA/Twilio return `{ok:true, local_only:true}` without contacting the provider; requires `meta.wa_message_id`).
  8. Media URLs for providers: files on the media disk use `media_url()`, files under `public/` use `url()`.
- **Async & events:** Synchronous HTTP; logs `[INBOX-DISPATCH]`, `[INBOX-BAILEYS]`, `[INBOX-WABA]`.
- **External systems:** Meta Graph API, Twilio REST, Node bridge (NODE), Telegram/LINE/WeChat/Viber/SMS/Facebook/TikTok/Instagram/MailTrixy adapters (owned by their channel domains).
- **Settings:** listed in Data; `ffmpeg_path`.
- **Acceptance criteria:**
  - Given a conversation stamped `provider=waba` with device_id = a connected config, When a text row is dispatched, Then the Graph call is made with THAT config's token and phone number id.
  - Given emergency halt on, When any send is attempted, Then nothing is sent and the row fails with the halt reason.
  - Given a Baileys thread and no reachable Node server URL, When dispatched, Then the result is `ok:true, local_only:true`.
  - Given a WeChat thread 49 hours after the last inbound, When dispatched, Then it fails with the 48-hour window message.
- **Source refs:** app/Services/InboxDispatcher.php, app/Services/WorkspaceEngine.php, app/Support/SendGate.php, app/Services/OverflowBilling.php
- **Port notes:** Replace the god-class with a `ProviderAdapter` registry per channel (WADEV/WABA/NODE/FB/IG/TG...) behind `ChannelGateway.send(message)` executed by a BullMQ worker with retries, idempotency key = message id, and provider webhooks reconciling status. The gate chain (halt, guardrails, plan/wallet reservation) belongs in the send-command handler before enqueueing. Never return success for local-only.

### WD-TIB1-027 — Message actions: info, pin, star, react

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-TIB1-011
- **Summary:** The hover menu on each bubble: show its status timeline, pin or star it (mirrored to WhatsApp on Baileys), or react with an emoji (mirrored on Baileys and WABA).
- **Actors & access:** `ConversationPolicy::view` on the parent conversation (any role that can open it, including Viewer — QUIRK: no `inbox.reply` check on pin/star/react). Message lookup is scoped to the conversation id in the URL so cross-conversation ids 404.
- **UX & screens:** Bubble chevron opens a floating 230 px menu: reaction row (thumbs-up, heart, laugh, wow, sad, pray, "+" full emoji picker loaded lazily, clear X when a reaction exists), Message info, Pin/Unpin, Star/Unstar, Forward, Edit, Delete. Official Cloud API threads (`device_status = cloud`) hide Pin, Star and Edit because WABA/Twilio have no such APIs. "Message info" shows Direction, Status, Sent, Delivered, Read and Failure in a read-only dialog. Toasts: "Pinned on WhatsApp.", "Pinned locally but WhatsApp says: <error>".
- **Endpoints:**

| Endpoint                                                     | Route name                    | Action                                | Middleware   | Request                                       | Response                                                                       |
| ------------------------------------------------------------ | ----------------------------- | ------------------------------------- | ------------ | --------------------------------------------- | ------------------------------------------------------------------------------ |
| GET team-inbox/api/conversations/{cId}/messages/{mId}/info   | user.team-inbox.api.msg.info  | TeamInboxController@messageInfo       | Authenticate | none                                          | `{data:{id,direction,status,created_at,sent_at,delivered_at,read_at,failure}}` |
| PATCH team-inbox/api/conversations/{cId}/messages/{mId}/pin  | user.team-inbox.api.msg.pin   | TeamInboxController@messageTogglePin  | Authenticate | none                                          | `{data:{id,pinned,wa_ok,wa_error}}`                                            |
| PATCH team-inbox/api/conversations/{cId}/messages/{mId}/star | user.team-inbox.api.msg.star  | TeamInboxController@messageToggleStar | Authenticate | none                                          | `{data:{id,starred,wa_ok,wa_error}}`                                           |
| POST team-inbox/api/conversations/{cId}/messages/{mId}/react | user.team-inbox.api.msg.react | TeamInboxController@messageReact      | Authenticate | `emoji` (nullable string max 8; empty clears) | `{data:{id,reaction,wa_ok,wa_error}}`                                          |

- **Data:** `inbox_messages.pinned`, `starred` (booleans), `reaction` (varchar 16, ONE reaction per message — the agent's own; customer reactions on outbound messages are stored by the inbound path), `meta.wa_message_id` and `meta.target_jid` required to reach WhatsApp.
- **Rules & edge cases:**
  1. Pin/star toggle the DB flag FIRST and then push to WhatsApp; the local change is kept even if the provider call fails (`wa_ok:false` plus first 300 chars of the error).
  2. Pin duration is 7 days (604800 s). Baileys endpoints `/api/pin-message/`, `/api/star-message/`; WABA and Twilio return `{ok:true, local_only:true}` (so `wa_ok` is true although nothing was sent) — the UI simply hides the actions for cloud threads, the API does not.
  3. Messages saved before provider-id tracking have no `wa_message_id`: the provider call fails with "saved before WhatsApp-id tracking was enabled. Receive a new message and try again." but the local flag still flips.
  4. Reactions: WABA via Graph `type:reaction` targeting the wamid (recipient = customer number; inbound rows use `from_number`, outbound `to_number`); Baileys via `/api/send-reaction/{devicePhone}` with `fromMe` for outbound; Twilio local-only. Empty emoji clears.
  5. Starring is per-message, not per-agent (shared across the team).
- **Async & events:** none (no broadcast, audit or webhook for these actions).
- **External systems:** Node bridge, Meta Graph.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a Baileys outbound message with a wa id, When pinned, Then `pinned=true`, the bridge receives a 7-day pin and `wa_ok=true`.
  - Given a WABA thread, When the menu opens, Then Pin/Star/Edit are absent and React remains.
  - Given a bridge failure, When starring, Then the flag is still saved and the toast shows the provider error.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (messageInfo, messageTogglePin, messageToggleStar, messageReact, findConvMessage), app/Services/InboxDispatcher.php (pin, star, reaction, messageAction), resources/js/charts/user-team-inbox-index.js (openMessageMenu, handleMsgAction)
- **Port notes:** A `MessageAction` command per type routed through the channel adapter's capability flags (`canPin`, `canStar`, `canEdit`, `canRevoke`, `canReact`); return 409 when unsupported instead of a fake success.

### WD-TIB1-028 — Edit and delete a message

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-TIB1-027
- **Summary:** Edit your own outbound message within WhatsApp's 15-minute window, or delete a message locally ("for me") or for everyone (revoke on WhatsApp).
- **Actors & access:** Same as WD-TIB1-027 (view access on the conversation; no ownership check — any agent may edit or delete any outbound message, and hide any inbound one). Edit menu item only when `editable` and not a cloud thread.
- **UX & screens:** Edit opens a modal that shows the original bubble and a textarea (Ctrl/Cmd+Enter saves, Esc cancels, note "WhatsApp gives a 15-minute edit window"). Delete opens a choice dialog: "Delete for everyone" (outbound, Baileys only) / "Delete for me only". Cloud (WABA/Twilio) threads offer only the local option with an explanation.
- **Endpoints:**

| Endpoint                                                     | Route name                     | Action                            | Middleware   | Request                                             | Response                                                                                                                                              |
| ------------------------------------------------------------ | ------------------------------ | --------------------------------- | ------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| PATCH team-inbox/api/conversations/{cId}/messages/{mId}/edit | user.team-inbox.api.msg.edit   | TeamInboxController@messageEdit   | Authenticate | `body` (required string 1-4096)                     | `{data:{id,body,edited_at,wa_ok,wa_error}}` or 422 `{ok:false,error: cannot_edit_inbound\|edit_window_expired\|no_wa_message_id\|no_change, message}` |
| DELETE team-inbox/api/conversations/{cId}/messages/{mId}     | user.team-inbox.api.msg.delete | TeamInboxController@messageDelete | Authenticate | `mode` (nullable everyone\|local; default everyone) | `{data:{id,deleted,mode,wa_ok,wa_error}}` or 422 `cannot_revoke_inbound`                                                                              |

- **Data:** `inbox_messages.body`, `edited_at`; `deleted_at` (SoftDeletes) for delete.
- **Rules & edge cases:**
  1. Editable when: direction `out`, status not in (sending, failed, pending), and `sent_at` (else `created_at`) within the last 15 minutes (`EDIT_WINDOW_MINUTES`). The 422 reason is `edit_window_expired` when past the window, else `no_wa_message_id`.
  2. The provider edit is sent FIRST; the local body/`edited_at` change only if the provider call succeeded (unlike pin/star). QUIRK: on a WABA/Twilio thread the dispatcher reports `local_only ok`, so an API caller could "edit" locally while the customer keeps the original; only the UI hides it.
  3. New body must differ from the current one and be non-empty after trim (`no_change`).
  4. `mode=everyone` only for outbound rows; inbound must use `local`. The row is soft-deleted regardless of the WhatsApp result (the toast warns "Deleted locally but WhatsApp says: ..."). Bubble disappears on next load; no undelete.
  5. Conversation preview is NOT recomputed after edit/delete (it can still show the deleted text).
  6. Edited bubbles show an "edited" mark from `edited_at`.
- **Async & events:** none.
- **External systems:** Node `/api/edit-message/`, `/api/delete-message/` (Baileys `sendMessage({edit})`, `{delete: key}`).
- **Settings:** plan feature `access_edit_messages` exists in package definitions but is not enforced here.
- **Acceptance criteria:**
  - Given an outbound Baileys message sent 5 minutes ago, When edited to new text, Then WhatsApp receives the edit, the row shows the new body and `edited_at`.
  - Given a message sent 20 minutes ago, When edited, Then 422 `edit_window_expired`.
  - Given an inbound message, When delete-for-everyone is requested, Then 422 `cannot_revoke_inbound`; When `mode=local`, Then the row is hidden.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (messageEdit, messageDelete), app/Models/InboxMessage.php (isEditable), app/Services/InboxDispatcher.php (editForEveryone, deleteForEveryone)
- **Port notes:** Enforce `canEdit`/`canRevoke` capability server-side; track `deleted_by`; recompute preview on delete.

### WD-TIB1-029 — Forward a message into another conversation

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-TIB1-017
- **Summary:** Copy a message's text and media into another conversation of the workspace and send it there as a forwarded message.
- **Actors & access:** View access on the source conversation; the target only needs to be in the same workspace (no `inbox.reply` or target-visibility check — QUIRK: a Viewer can forward into any conversation).
- **UX & screens:** Menu item "Forward" opens a text prompt "Conversation id from the queue (column 2)" (the operator must type a numeric id — there is no conversation picker); success toast "Forwarded."
- **Endpoints:**

| Endpoint                                                       | Route name                      | Action                             | Middleware   | Request                                     | Response             |
| -------------------------------------------------------------- | ------------------------------- | ---------------------------------- | ------------ | ------------------------------------------- | -------------------- |
| POST team-inbox/api/conversations/{cId}/messages/{mId}/forward | user.team-inbox.api.msg.forward | TeamInboxController@messageForward | Authenticate | `target_conversation_id` (required integer) | `{ok:true, message}` |

- **Data:** New `inbox_messages` row in the target: direction `out`, body/media_path/media_type copied (the media file is shared, not duplicated), `meta {forwarded:true, target_jid}`, status `pending` then `sent|failed`. Target conversation gets last_message_at, last_outbound_at, preview (first 191 chars, or "📎 Forwarded").
- **Rules & edge cases:**
  1. Recipient resolution: target's last inbound `from_number`, else digits parsed from its title, else last outbound `to_number`; device phone via the Baileys `devices` table only. If neither number nor JID: row marked failed "No recipient phone or JID resolved."
  2. Billed through the dispatcher's normal plan-first meter (the old wallet pre-charge/refund was removed; docs still describe it).
  3. No first-response marking, no `today_replies`, no broadcast, no webhook, no audit.
  4. The bubble shows a "Forwarded" label; `frequently_forwarded` is never set by this action.
  5. A foreign or unknown target id returns 404 (workspace-scoped lookup).
- **Async & events:** none.
- **External systems:** as dispatcher.
- **Settings:** none.
- **Acceptance criteria:**
  - Given two conversations, When message M is forwarded to the other, Then the target thread gets an outbound `forwarded` bubble with the same text and media and the customer receives it.
  - Given a target id from another workspace, When forwarded, Then 404.
  - Given the plan message cap is exhausted, When forwarding, Then the copy row is `failed` with the plan-limit reason.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (messageForward), resources/js/charts/user-team-inbox-index.js (handleMsgAction forward)
- **Port notes:** Build a proper conversation picker; run through the same `SendMessage` command with `forwardedFromMessageId`.

### WD-TIB1-030 — Add a shared contact card to Contacts (`extract-contact`)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-TIB1-011
- **Summary:** When a customer sends a vCard, the bubble shows a contact card with "+ Save"; saving promotes the captured card into a real CRM contact (idempotent).
- **Actors & access:** View access on the conversation containing the message. No `contacts.create` permission check.
- **UX & screens:** Contact card bubble (initials avatar, name, phone, "Chat" wa.me link, "+ Save"). Button text becomes "Added" or "Updated"; toasts "Contact added." / "Contact already existed - name refreshed."
- **Endpoints:**

| Endpoint                                          | Route name                                   | Action                                    | Middleware   | Request | Response                                                                          |
| ------------------------------------------------- | -------------------------------------------- | ----------------------------------------- | ------------ | ------- | --------------------------------------------------------------------------------- |
| POST team-inbox/api/messages/{id}/extract-contact | user.team-inbox.api.messages.extract-contact | TeamInboxController@extractMessageContact | Authenticate | none    | `{ok:true, contact_id, created}` or 422 `{ok:false,message}` (no card / no phone) |

- **Data:** Reads `inbox_messages.meta.contact {name, phone}`. Writes `contacts` (first_name, last_name, name, country_code, mobile, user_id = conversation creator else caller, workspace_id). Audit `contact.created_from_message`.
- **Rules & edge cases:**
  1. Phone = digits of `meta.contact.phone`; if longer than 10 digits, the trailing 10 are `mobile` and the leading remainder `country_code` (heuristic — wrong for national numbers not 10 digits long).
  2. Dedup: hydrate all workspace contacts and compare decrypted mobile digits to the 10-digit `mobile`; if found, fill only missing name/first/last and return `created:false`. Because stored mobiles may include the country code, matches can be missed (duplicates) — QUIRK.
  3. Name split: last word = last_name, the rest first_name; single word = first name only; display name falls back to the phone digits.
  4. Message id lookup is unscoped, then the conversation lookup is workspace-scoped (404 for foreign).
- **Async & events:** audit only.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an inbound vCard for +91 98765 43210, When Save is pressed twice, Then the first call returns `created:true` and the second `created:false` with the same contact id.
  - Given a message without a contact card, When called, Then 422 "No contact card on this message."
- **Source refs:** app/Http/Controllers/TeamInboxController.php (extractMessageContact, splitName), resources/js/charts/user-team-inbox-index.js (renderMediaBlock contact case, extract handler)
- **Port notes:** Delegate to CON `contacts.upsertByPhone` with proper E.164 parsing (libphonenumber) instead of the 10-digit heuristic.

### WD-TIB1-031 — Retry download of failed WABA media (`retry-media`)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-TIB1-011
- **Summary:** For inbound Cloud API media that never downloaded, a Retry link re-pulls the file from Meta using the stored media id (valid ~30 days) so the customer need not resend.
- **Actors & access:** Any authenticated user with a current workspace; message must belong to a conversation in that workspace (no policy `view` check).
- **UX & screens:** "Photo/Video/Voice message/File unavailable - Media could not be downloaded" placeholder with Retry; on success the thread reloads with the media.
- **Endpoints:**

| Endpoint                                      | Route name                          | Action                         | Middleware   | Request | Response                                                                                                                |
| --------------------------------------------- | ----------------------------------- | ------------------------------ | ------------ | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| POST team-inbox/api/messages/{id}/retry-media | user.team-inbox.api.msg.retry-media | TeamInboxController@retryMedia | Authenticate | none    | `{ok:true, media_url}` or `{ok:false,error: no_workspace(403)\|not_found(404)\|no_media_id(422)\|download_failed(502)}` |

- **Data:** Reads `inbox_messages.meta.waba_media_id`, `meta.waba_mime_type`; writes `media_path` on success. If `media_path` already exists the current URL is returned.
- **Rules & edge cases:**
  1. Only WABA inbound media carries `waba_media_id`; others return `no_media_id`.
  2. `WabaMediaFetcher::downloadToDisk(ws, mediaId, mime)` fails when the id is older than ~30 days or the token is invalid.
  3. The thread render also auto-fetches up to two missing media per request (WD-TIB1-009), so Retry is the fallback.
- **Async & events:** none.
- **External systems:** Meta Graph media endpoint.
- **Settings:** workspace WABA token.
- **Acceptance criteria:**
  - Given an inbound image with a media id and no file, When Retry is clicked, Then `media_path` is set and the image renders.
  - Given an expired media id, When retried, Then 502 `download_failed` and the placeholder stays.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (retryMedia), app/Services/Waba/WabaMediaFetcher.php
- **Port notes:** Move to the WABA adapter (`fetchInboundMedia`); do it in the inbound worker with retries so the button becomes rare.

### WD-TIB1-032 — Assign and unassign a conversation (people and teams) with assignment strategies

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-TIB1-009
- **Summary:** Make one person or one team responsible for a thread. Assigning to a team runs the team's assignment strategy (manual, round robin, least loaded, sticky) to pick the actual member; assigning to a person is direct. `AssignmentService` is the only writer of `assignee_user_id/assignee_team_id`, used by manual assign, bulk, kanban, flows and routing rules (TIB2).
- **Actors & access:** `ConversationPolicy::assign` (called AFTER validation because the gate depends on the target): `inbox.assign` (Owner/Admin/Manager) may assign anyone, any team, any strategy; `inbox.assign_self` (Agent) may only CLAIM: strategy `manual`, `user_id` = themselves, and team null or equal to the thread's current team. Unassign requires full `inbox.assign`. Viewer cannot assign.
- **UX & screens:** Header person-plus button opens a menu: for full assigners "Teams" (each with "auto-assign" hint), "Members" (name + status), "Unassign"; for agents only "Assign to me" (or "This chat is already assigned to you."). The contact panel shows the assignee (initials, name, team) with "Reassign". Buttons hide entirely when the permission map says the user cannot assign. Error toasts: 403 => "You do not have permission to assign conversations."; 422 carries the server sentence ("That member is not part of this workspace." / "That team is not part of this workspace.").
- **Endpoints:**

| Endpoint                                        | Route name                   | Action                       | Middleware   | Request                                                                                                                                                                                                                                  | Response                                                          |
| ----------------------------------------------- | ---------------------------- | ---------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| POST team-inbox/api/conversations/{id}/assign   | user.team-inbox.api.assign   | TeamInboxController@assign   | Authenticate | `user_id` (nullable int; must exist in `workspace_user` for this workspace), `team_id` (nullable int; must exist in `teams` for this workspace and not be soft-deleted), `strategy` (nullable manual\|round_robin\|least_loaded\|sticky) | `{ok:true, conversation:<list item>}` or 422 `{ok:false,message}` |
| POST team-inbox/api/conversations/{id}/unassign | user.team-inbox.api.unassign | TeamInboxController@unassign | Authenticate | none                                                                                                                                                                                                                                     | `{ok:true, conversation}`                                         |

- **Data:** `conversations.assignee_user_id`, `assignee_team_id`, (`assignee_agent_id` cleared when a human takes over), `inbox_status`; `agent_statuses.current_load`; `conversation_events`; `inbox_notifications`.
- **Rules & edge cases:**
  1. Default strategy: explicit `strategy` if sent; else if a team is given without a user, the team's own `assignment_strategy` (falls back to `least_loaded` if invalid); else `manual`. The web UI's team assign sends no strategy, so the team setting is honoured (before a fix, everything was hard-coded least-loaded and round-robin/sticky were dead). Kanban team drops hard-code `least_loaded`.
  2. Tenancy: validation restricts targets to the workspace; the service re-checks — a changed team must belong to the workspace; a manual user must be a live workspace member (soft-deleted users fail) else `AssignmentTargetException` => 422 with the human message. A manual assign with an unresolvable user FAILS instead of silently clearing the assignee. Re-affirming the current team is not re-validated.
  3. Strategy `manual` => the given user (or none). `round_robin` => among eligible team members the one whose most recent assignment (max `updated_at` of conversations assigned to them) is oldest (never-assigned first). `least_loaded` => fewest open/pending assigned conversations. `sticky` => the user who last replied to this contact if still a workspace member and not `offline`, else least-loaded of the team; QUIRK: "last replied" reads the LEGACY `messages` table's outbound rows, not `inbox_messages`, so for inbox-only threads sticky always degrades to least-loaded.
  4. Eligible members: team members who are not `offline` or `busy` (an `away` agent stays eligible) and whose load is below the pivot `capacity` (default 20; load = `agent_statuses.current_load` if a row exists else counted). Returning null leaves the chat with the team unassigned to a person.
  5. Writes: `assignee_user_id = resolved user id or NULL` (QUIRK: assigning to a team whose strategy yields no user CLEARS a previously assigned person), `assignee_team_id = team id ?? existing`, and a `closed` thread becomes `open`. If a human (user or team) is assigned while an AI agent is attached, `assignee_agent_id` is cleared and an `ai_handoff` event is recorded (actor type human, or `flow` when there is no actor).
  6. Load counters (`agent_statuses.current_load`) are recomputed for the previous and new assignee (open+pending count).
  7. Events/notifications in order: event `assigned` (first assignment) or `reassigned` {from_user_id,to_user_id,from_team_id,to_team_id,strategy}; if a person resolved: in-app notification "Conversation assigned to you" (link `/team-inbox?c=<id>`, deduped 30 s per conversation+user) plus web push when `ti_pwa_enabled` — note it fires even for self-assignment; audit `conversation.assigned`; broadcast `conversation.assigned` (others); outbound webhook `conversation.assigned` {to_user_id, team_id, strategy, by_user_id}.
  8. Unassign clears ONLY `assignee_user_id` (the team stays; there is no way to remove a team assignment), is a no-op returning ok when nobody is assigned, records `unassigned`, audit `conversation.unassigned` and broadcast (no webhook, no notification).
  9. Assignment does not change SLA policy, priority or status other than closed->open.
- **Async & events:** As item 7. Routing rules (TIB2) call the same service with strategies from rule actions.
- **External systems:** none.
- **Settings:** `teams.assignment_strategy`, `team_user.capacity`, agent status.
- **Acceptance criteria:**
  - Given an Agent, When they assign a thread to another user, Then 403; When they assign to themselves with strategy manual, Then 200.
  - Given a team with round_robin and members A (assigned 1h ago) and B (never), When assigned, Then B receives it and B gets a notification.
  - Given a target user id belonging to another workspace, When posted, Then 422 "That member is not part of this workspace." and the thread is unchanged.
  - Given all team members are busy/offline, When assigned to the team, Then the thread gets the team and no person, previous assignee cleared.
  - Given an AI-attached thread, When a human is assigned, Then `assignee_agent_id` is null and an `ai_handoff` event exists.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (assign, unassign, teamStrategy), app/Services/Inbox/AssignmentService.php, app/Policies/ConversationPolicy.php, app/Exceptions/AssignmentTargetException.php, app/Models/Team.php
- **Port notes:** `ConversationAssignmentService` in the conversations module used by API, kanban, bulk and the TIB2 rule engine; store `assignee_user_id`, `assignee_team_id`, `assigned_at`; compute load from a query, not a counter (or keep counter via outbox events). Fix the "team assign clears user" ambiguity explicitly.

### WD-TIB1-033 — Attach or detach an AI agent / voice assistant; human takeover

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-TIB1-032
- **Summary:** Hand a live conversation to an AI agent (or an AI voice assistant) so it answers the customer's next messages, take it back, and rely on the rule that a human reply or human assignment stands the AI down.
- **Actors & access:** `inbox.assign` (Owner/Admin/Manager) — the AI attach is gated like human assignment. The agent must belong to the workspace.
- **UX & screens:** Header "AI Agent" menu lists workspace agents (avatar chip, checkmark on the active one), "Remove AI agent" and "Manage agents..."; the composer "AI takeover" button opens a modal of live voice assistants with provider/model/status pills and a "Detach AI" button; contact panel "AI Agent - Change".
- **Endpoints:**

| Endpoint                                                | Route name                           | Action                              | Middleware   | Request                                                                                                 | Response                                                              |
| ------------------------------------------------------- | ------------------------------------ | ----------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| POST team-inbox/api/conversations/{id}/assign-agent     | user.team-inbox.api.assign-agent     | TeamInboxController@assignAgent     | Authenticate | `agent_id` (nullable int; must be a workspace agent else 404)                                           | `{ok, agent_id, agent_name}`                                          |
| POST team-inbox/api/conversations/{id}/assign-assistant | user.team-inbox.api.assign-assistant | TeamInboxController@assignAssistant | Authenticate | `assistant_id` (nullable int; 0/null = detach; must belong to workspace else 404 `assistant_not_found`) | `{ok, voice_assistant_id, voice_assistant_name, assignee_agent_id}`   |
| GET team-inbox/api/assistants                           | user.team-inbox.api.assistants       | TeamInboxController@listAssistants  | Authenticate | none                                                                                                    | `{ok, assistants[{id,name,provider,model,status}]}` (active, by name) |

- **Data:** `conversations.assignee_agent_id`; `conversations.routing_meta` keys `voice_assistant_id`, `voice_assistant_name`, `voice_assistant_at`, `ai_paused_by_human_at`, `ai_paused_by_user_id`; events `agent_assigned|agent_unassigned` {old,new} and `voice_assistant_attached|detached` {assistant_id, assistant_name}. `listAssistants` requires no permission.
- **Rules & edge cases:**
  1. Two independent AI triggers exist: `assignee_agent_id` (read by `AiAgentService::respondIfAssigned` on BOTH Baileys and WABA inbound) and `routing_meta.voice_assistant_id` (read by the Baileys inbound path). "Detach" of either clears BOTH so Detach means Detach on every engine.
  2. Attaching an agent by hand lifts the human-takeover pause markers (`ai_paused_by_*`) — the deliberate "AI, take it back" action. Attaching either type also tells the Node bridge to end any running flow session for that customer (`POST {server_url}/api/flow-end` with header `X-Node-Token`, body `{workspace_id, customer_phone}`, 5 s timeout, best-effort; server URL from the primary provider config creds `server_url`, else `baileys_server_url`, else env `SERVER_URL`) so the flow and the AI do not both answer.
  3. Human takeover: a text reply (WD-TIB1-017) or a human assignment (WD-TIB1-032) clears `assignee_agent_id`, removes voice-assistant keys and stamps the pause markers. Media/voice/catalog replies do NOT trigger takeover.
  4. Assigning an agent does not verify the agent is active or device-scoped (`ai_agents.device_ids`); the responder checks at reply time.
  5. `assign-agent` records an event but no audit row, broadcast or webhook.
- **Async & events:** Node flow-end HTTP call.
- **External systems:** Node bridge.
- **Settings:** AI agents (AIAG), plan `access_ai_agents` gates the surrounding UI only.
- **Acceptance criteria:**
  - Given an active flow session on a Baileys chat, When an AI agent is attached, Then the bridge is asked to end the flow session and the agent answers the next inbound.
  - Given an AI-attached thread, When the operator clicks Detach on the voice assistant modal, Then both `assignee_agent_id` and the voice assistant keys are cleared.
  - Given an agent id from another workspace, When assigned, Then 404.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (assignAgent, assignAssistant, listAssistants, endActiveFlowSession, pauseAiForHumanTakeover), resources/js/charts/user-team-inbox-index.js (ai-agent menu, wireAiTakeover)
- **Port notes:** Model as `conversation.automation_handler {type: ai_agent|voice_assistant|flow|none, id, paused_by, paused_at}` rather than two loose fields.

### WD-TIB1-034 — Resolve and reopen a conversation

- **Status:** partial
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TIB1-009
- **Summary:** Mark a conversation handled (recording who or which AI agent resolved it), and bring it back. The endpoints are complete; the list view has no single-thread Resolve/Reopen button — resolution is reachable only through the kanban board and bulk "Resolve".
- **Actors & access:** `ConversationPolicy::resolve` = `inbox.resolve` (Owner/Admin/Manager/Agent). Reopen uses the same permission.
- **UX & screens:** Resolution banner "Resolved by <name / AI agent name / a team member> - <time>". Kanban drag to Resolved/Active columns; bulk bar "Resolve" (needs `inbox.bulk`). QUIRK: the JS binds `#resolve-btn` and `resolve()`, but that button no longer exists in the blade, so agents have no per-thread resolve/reopen control in the list UI.
- **Endpoints:**

| Endpoint                                       | Route name                  | Action                      | Middleware   | Request | Response             |
| ---------------------------------------------- | --------------------------- | --------------------------- | ------------ | ------- | -------------------- |
| POST team-inbox/api/conversations/{id}/resolve | user.team-inbox.api.resolve | TeamInboxController@resolve | Authenticate | none    | `{ok, conversation}` |
| POST team-inbox/api/conversations/{id}/reopen  | user.team-inbox.api.reopen  | TeamInboxController@reopen  | Authenticate | none    | `{ok, conversation}` |

- **Data:** `conversations.inbox_status`, `resolved_at`, `resolved_by`, `resolved_by_agent_id` (the AI agent attached at that moment), `sla_breached`.
- **Rules & edge cases:**
  1. Resolve: set status `resolved`, timestamps and resolver ids; `SlaTracker::applyOnResolution` marks `sla_breached` if the resolution deadline had passed (TIB2); record event `resolved` {agent_id, agent_name, by}; notify every OTHER participant row (watchers/mentioned) with an in-app `resolved` notification; audit; `agent_statuses.today_resolutions + 1`; broadcast `conversation.resolved`; webhook `conversation.resolved` {resolved_by_user_id, resolved_by_agent_id, resolved_at}. Idempotency: resolving an already-resolved thread re-runs everything and re-increments the counter — QUIRK.
  2. Reopen: status `open`, `resolved_at` and `resolved_by` null (`resolved_by_agent_id` and `sla_breached` are NOT reset), event `reopened`, audit, broadcast. No `conversation.reopened` webhook is fired even though the model documents that event.
  3. `snoozed_until` is not cleared by reopen or resolve (harmless; wake sweep only looks at status `snoozed`).
  4. A customer message reopens a resolved/closed/spam/snoozed thread automatically (WD-TIB1-043); `resolved` threads drop out of the default list (`status=open`) and are visible only via `status=resolved|all` (kanban) or the API.
  5. The AI agent's own resolve path is in AIAG (sets `resolved_by_agent_id`).
- **Async & events:** Broadcast + webhook + notifications as above.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an Agent, When resolving a thread, Then the status is `resolved`, `resolved_by` = the agent, `today_resolutions` +1, and a webhook subscriber receives `conversation.resolved`.
  - Given a thread with an attached AI agent, When a human resolves it, Then `resolved_by_agent_id` is the agent id and the banner names the AI agent.
  - Given a Viewer, When resolving, Then 403.
  - Given a resolved thread, When reopened, Then it reappears in the Open list and the timeline has `reopened`.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (resolve, reopen), app/Services/Inbox/SlaTracker.php, resources/js/charts/user-team-inbox-index.js (resolve, renderActive banner), resources/views/user/team-inbox/kanban.blade.php
- **Port notes:** Restore explicit Resolve/Reopen buttons in the thread header; make resolve idempotent; fire `conversation.reopened`.

### WD-TIB1-035 — Conversation priority

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-TIB1-009
- **Summary:** Set a conversation's priority (low, normal, high, urgent); it shows as a row chip, groups the kanban columns and (TIB2) can tighten SLA targets.
- **Actors & access:** `ConversationPolicy::priority` = `inbox.priority` — Owner, Admin, Manager only (QUIRK: Agents lack it, yet the quick-label chips fire a priority change; for an Agent that background call fails silently with 403 while the tag still applies).
- **UX & screens:** No dedicated selector in the thread header. Priority changes come from (a) quick-label chips (Urgent=urgent, Follow-up=high, VIP=high, Lead=normal, Support=normal) which set the preset priority when TURNED ON (turning off does not restore) and (b) kanban priority grouping drag, (c) bulk API. Rows show uppercase chips for non-normal priorities.
- **Endpoints:**

| Endpoint                                        | Route name                   | Action                       | Middleware   | Request                                            | Response    |
| ----------------------------------------------- | ---------------------------- | ---------------------------- | ------------ | -------------------------------------------------- | ----------- |
| POST team-inbox/api/conversations/{id}/priority | user.team-inbox.api.priority | TeamInboxController@priority | Authenticate | `priority` (required in low\|normal\|high\|urgent) | `{ok:true}` |

- **Data:** `conversations.priority` varchar12 default `normal`; event `priority_changed` {from,to}; broadcast `conversation.priority`.
- **Rules & edge cases:** 1. No SLA recomputation happens here (SLA due times are set at inbound; TIB2). 2. Lead/Support chips (priority normal) will LOWER an urgent thread to normal when applied. 3. Merge keeps the highest priority (WD-TIB1-041).
- **Async & events:** Broadcast + event only.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a Manager, When they POST `priority=urgent`, Then the row is urgent and a `priority_changed` event {from:'normal', to:'urgent'} exists.
  - Given an Agent, When posting, Then 403.
  - Given an invalid value `critical`, When posted, Then 422.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (priority), app/Models/Conversation.php (PRIORITIES), resources/js/charts/user-team-inbox-index.js (quick label handler)
- **Port notes:** Add a priority control to the thread header; decouple quick labels from priority or make it configurable per label.

### WD-TIB1-036 — Labels (tags) on a conversation

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TIB1-037
- **Summary:** Apply or remove workspace labels on a conversation from the contact panel, a header label picker, quick-label chips or the row menu; adding a label can enroll the contact into a flow that triggers on "tag added".
- **Actors & access:** `ConversationPolicy::tag` = `inbox.tag` (Owner, Admin, Manager, Agent). Creating a NEW label inline goes through `POST /tags` only from the row menu / bulk tag (needs `tag.manage`), but the header picker and quick labels create labels through the tag route itself with no `tag.manage`/limit check.
- **UX & screens:** Contact panel Tags: chips with x, "+ Add" (prompt "Add tag"). Thread strip "Quick label": five toggle chips Urgent (#a1431f), Follow-up (#7B5A14), VIP (#5B3D8A), Lead (#0C7A65), Support (#13478A) that light up when the label is on the thread, plus a "Label" picker menu listing every workspace tag with check marks and a "+ New label" input (max 40). Queue rows show tag chips; the queue filter dropdown lists workspace labels.
- **Endpoints:**

| Endpoint                                             | Route name                | Action                    | Middleware   | Request                                                                                                                                         | Response         |
| ---------------------------------------------------- | ------------------------- | ------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| POST team-inbox/api/conversations/{id}/tag           | user.team-inbox.api.tag   | TeamInboxController@tag   | Authenticate | `tag_id` (nullable int; must be a workspace tag else 404), `name` (nullable max 64), `color` (nullable max 16, regex `^#?[0-9A-Za-z_-]{1,16}$`) | `{ok:true, tag}` |
| DELETE team-inbox/api/conversations/{id}/tag/{tagId} | user.team-inbox.api.untag | TeamInboxController@untag | Authenticate | none                                                                                                                                            | `{ok:true}`      |

- **Data:** `conversation_tag(conversation_id, tag_id, added_by, timestamps)` unique (conversation, tag), no FKs; `tags`. Events `tag_added` {tag_id, tag_name}, `tag_removed` {tag_id}.
- **Rules & edge cases:**
  1. Without `tag_id`, the tag is `firstOrCreate` by (workspace, `Str::slug(name)`) with default color `#075E54` (existing tag with the same slug is reused; names differing only by case/punctuation collapse). QUIRK: neither `tag_id` nor `name` is required by validation — a request with both empty creates a tag with empty name and slug.
  2. Attaching uses `syncWithoutDetaching` (idempotent). QUIRK: unlike `POST /tags`, this path does NOT enforce the plan's `tags_limit`.
  3. After attaching, `FlowEnrollmentService::onConversationTagged(conversation, tagId)` enrolls the contact into any active, published flow whose trigger is `tag_added` with `trigger_value = tag id` (best effort; failures never break tagging). Routing rules' add_tag action shares this service (TIB2).
  4. Untag detaches by tag id without checking the tag's workspace (only this conversation's pivot is touched).
  5. Broadcasts `conversation.tag_added|tag_removed` to others; no audit, no webhook.
  6. Quick labels toggle by case-insensitive name match on the thread's tags; the pill flips optimistically and reverts on failure; the first ON also fires a priority change (WD-TIB1-035).
- **Async & events:** Flow enrollment (FLR).
- **External systems:** none.
- **Settings:** plan `tags_limit` (only on master-list create).
- **Acceptance criteria:**
  - Given an Agent, When they add the label "VIP" to a thread, Then the tag exists once for the workspace, the pivot row has `added_by`, and a `tag_added` event is recorded.
  - Given an active flow triggered by tag "VIP", When the tag is applied, Then the contact is enrolled.
  - Given a tag id from another workspace, When posted, Then 404.
  - Given the Urgent chip is applied then clicked again, Then the tag is removed (priority is not restored).
- **Source refs:** app/Http/Controllers/TeamInboxController.php (tag, untag), app/Services/Flow/FlowEnrollmentService.php, app/Models/Tag.php, resources/js/charts/user-team-inbox-index.js (label picker, quick labels)
- **Port notes:** Make `name` or `tag_id` required; apply the tag limit consistently; use FKs with cascade.

### WD-TIB1-037 — Workspace label master list (`tags`)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** none
- **Summary:** List, create and delete the workspace's labels. There is no rename or recolor endpoint.
- **Actors & access:** List: any member. Create/delete: `tag.manage` (Owner, Admin, Manager). Create also enforces the plan cap `tags_limit`.
- **UX & screens:** Used by the label picker, label filter, "Label..." row-menu item and the bulk "Tag" action (which prompts for a name, creates/reuses the label, then bulk-applies). There is no standalone tag management screen in the inbox.
- **Endpoints:**

| Endpoint                        | Route name                       | Action                          | Middleware   | Request                                                    | Response              |
| ------------------------------- | -------------------------------- | ------------------------------- | ------------ | ---------------------------------------------------------- | --------------------- |
| GET team-inbox/api/tags         | user.team-inbox.api.tags.index   | TeamInboxController@tagsIndex   | Authenticate | none                                                       | array of tags by name |
| POST team-inbox/api/tags        | user.team-inbox.api.tags.store   | TeamInboxController@tagsStore   | Authenticate | `name` (req max 64), `color` (nullable max 16, same regex) | `{ok:true, tag}`      |
| DELETE team-inbox/api/tags/{id} | user.team-inbox.api.tags.destroy | TeamInboxController@tagsDestroy | Authenticate | none                                                       | `{ok:true}`           |

- **Data:** `tags(workspace_id, name varchar64, slug varchar64, color varchar16 default #075E54, description varchar255)` unique (workspace_id, slug). Six starter tags are seeded on workspace creation by WSP (New Lead, Interested, Customer, VIP, Follow Up, Not Interested).
- **Rules & edge cases:**
  1. Create is `firstOrCreate` by slug: an existing slug returns the existing tag with `ok:true` (no error, no update of color); the limit check counts all tags BEFORE the duplicate test so a workspace at its cap cannot even re-request an existing name.
  2. Delete removes the tag row only; `conversation_tag` rows (no FK) and `contact_tag` rows are left orphaned and the label vanishes from lists.
  3. Colors are stored as given; the client allow-lists CSS colour shapes (hex, rgb(a), hsl(a), a named colour) and falls back to a neutral default to avoid attribute injection.
  4. Agents get 403 on create, so "Label..." from the row menu and bulk Tag fail for them (bulk also needs `inbox.bulk`).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** plan `tags_limit`.
- **Acceptance criteria:**
  - Given a Manager, When creating "Refund", Then the tag exists with slug `refund` and default color.
  - Given the same name posted twice, When called, Then the same tag id returns both times.
  - Given a workspace at `tags_limit`, When creating, Then the plan-limit error is returned.
  - Given a deleted tag, When conversations are listed, Then the label is gone (pivot orphans are ignored).
- **Source refs:** app/Http/Controllers/TeamInboxController.php (tagsIndex, tagsStore, tagsDestroy), app/Models/Tag.php
- **Port notes:** Table `labels` with unique(org, lower(name)); cascade pivot; add rename/recolor; contacts tags stay in CON (`contact_tag`).

### WD-TIB1-038 — Internal notes and @mentions

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TIB1-009
- **Summary:** Team-only comments on a conversation. Notes appear inline in the thread (amber cards) and in the contact panel; @mentioning a teammate notifies them and files the thread under their @me tab.
- **Actors & access:** `ConversationPolicy::note` = `inbox.note` (Owner, Admin, Manager, Agent) and view access. Delete: author, or anyone with `inbox.view_all_teams` (QUIRK: that is every role that can note, so any noter can delete any note; docs say admins/managers only).
- **UX & screens:** Two entry points: (1) composer "Internal note" tab (amber hint "only your team can see this"): the text posts as a note with NO mention parsing; (2) contact panel "+ Add note" (multiline prompt: "use @name to ping a teammate"): the client parses `@token` (2+ chars of letters, digits, dot, dash, underscore) and resolves it to a workspace member by exact name, first name, email local part, or name substring (self excluded, de-duplicated). Toast "Note saved - <names> notified." No note delete or edit control exists in the UI.
- **Endpoints:**

| Endpoint                                                | Route name                       | Action                         | Middleware   | Request                                                                                            | Response          |
| ------------------------------------------------------- | -------------------------------- | ------------------------------ | ------------ | -------------------------------------------------------------------------------------------------- | ----------------- |
| POST team-inbox/api/conversations/{id}/notes            | user.team-inbox.api.notes.add    | TeamInboxController@addNote    | Authenticate | `body` (required string max 8000), `mentions[]` (nullable; each `{user_id:int, name:string<=120}`) | `{ok:true, note}` |
| DELETE team-inbox/api/conversations/{id}/notes/{noteId} | user.team-inbox.api.notes.delete | TeamInboxController@deleteNote | Authenticate | none                                                                                               | `{ok:true}`       |

- **Data:** `conversation_notes(conversation_id, workspace_id, user_id, body encrypted text, mentions JSON, is_pinned, edited_at, deleted_at)`; note serializer: id, body, mentions, is_pinned, author_id, author_name, created_at, edited_at. Mention side effects: `inbox_notifications` (type `mentioned`, title "You were mentioned", body first 160 chars stripped of tags, link `/team-inbox?c=<id>`, no dedupe) and `conversation_participants` upsert (role `mentioned`, `unread_mentions + 1`).
- **Rules & edge cases:**
  1. QUIRK (tenancy): `mentions[].user_id` is only validated as an integer, not as a workspace member, so a crafted mention creates a notification and participant row for a user of another workspace.
  2. Self-mentions are skipped server-side. Each valid mention also broadcasts `mention.received` (to a channel with no auth rule — WD-TIB1-015) and web-pushes when enabled.
  3. Event `note_added` {note_id}; broadcast `note.added` (others); audit `note.added`.
  4. Notes are soft-deleted (`deleted_at`); audit `note.deleted`; deletion 404s if the note is not on that conversation. `is_pinned` and `edited_at` columns are never written (no edit/pin endpoints).
  5. Notes older than the newest 80 are not loaded with the thread.
  6. The `@me` queue tab lists conversations where the caller's participant row has `unread_mentions > 0`; opening the thread zeros it.
- **Async & events:** Notification + broadcast + audit.
- **External systems:** Web Push (NOTIF).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a note "@sara please follow up" from the panel where Sara is a member, When saved, Then Sara receives an in-app notification and the thread appears under her @me tab with a count.
  - Given the same text typed in the composer note tab, When saved, Then no mention is created.
  - Given a note of 8001 characters, When posted, Then 422.
  - Given a note by user A, When user B (Agent) deletes it, Then 200 (as shipped); When a Viewer tries, Then 403.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (addNote, deleteNote, serializeNote), app/Services/Inbox/NotificationDispatcher.php (notifyMention), app/Models/ConversationNote.php, app/Events/Inbox/NoteAdded.php, app/Events/Inbox/MentionReceived.php, resources/js/charts/user-team-inbox-index.js (addNote, parseMentions)
- **Port notes:** Validate mention targets against org membership; parse mentions server-side from `@[id]` tokens; delete permission = author or `inbox.manage`; add pin/edit if wanted.

### WD-TIB1-039 — Bulk actions on selected conversations (`POST /bulk`)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-TIB1-005
- **Summary:** Select several rows and apply one action: assign, resolve, reopen, snooze, priority, tag, spam, archive, unarchive, pin, unpin, mute, unmute or delete. The same endpoint powers the row context menu with a single id.
- **Actors & access:** Route `Authenticate`; each conversation is authorised with `ConversationPolicy::bulk` = `inbox.bulk` (Owner/Admin/Manager). Unauthorised rows are skipped silently, so an Agent gets `ok:true, touched:0` and the UI still toasts "Bulk <action> on N conversations." — QUIRK. The UI bar exposes: Assign (to me only, hidden without `inbox.bulk`), Resolve, Tag, Pin, Mute, Archive, Delete.
- **UX & screens:** "Select" toggle shows checkboxes; a sticky bar shows "N selected" with the buttons; Delete asks "Delete N conversations? This permanently deletes the selected chats and their messages. It cannot be undone." Tag prompts for a label name, creates/reuses it via `POST /tags` (needs `tag.manage`) and then applies it.
- **Endpoints:**

| Endpoint                 | Route name               | Action                   | Middleware   | Request                                                                                                                                                                                                                                                                                               | Response                 |
| ------------------------ | ------------------------ | ------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| POST team-inbox/api/bulk | user.team-inbox.api.bulk | TeamInboxController@bulk | Authenticate | `ids[]` (required, min 1, ints), `action` (assign\|resolve\|reopen\|snooze\|priority\|tag\|spam\|archive\|unarchive\|pin\|unpin\|mute\|unmute\|delete), `user_id` (exists in workspace_user for ws), `team_id` (exists in teams for ws), `tag_id` (exists in tags for ws), `priority`, `until` (date) | `{ok:true, touched:<n>}` |

- **Data:** Conversations restricted to the caller's workspace (`whereIn id`); per action: assign => `AssignmentService::assign(..., 'manual')`; resolve => inbox_status resolved + resolved_at/by/by_agent + event `resolved` {bulk:true}; reopen => open, resolved_at null; snooze => snoozed with `until` or now+1h (NO future-date validation: a past date is woken by the next sweep); priority => sets when provided; tag => `syncWithoutDetaching([tag_id])` (no `added_by`, no event, no flow enrollment); spam => `is_spam = 1`, status spam; archive/unarchive => `archived`; pin/unpin => `pinned_at`; mute/unmute => `muted_at`; delete => permanent.
- **Rules & edge cases:**
  1. Bulk assign uses the `bulk` permission, not `assign`: a Manager can assign to anyone; failure to resolve the target skips that row without wiping its current assignee. A team-only bulk assign resolves no user and clears the person (same as WD-TIB1-032 rule 5). No notification, event summary or webhook per row beyond what AssignmentService records.
  2. Bulk resolve increments `today_resolutions` by the count of resolved rows but skips SLA application, notifications, broadcasts and webhooks (QUIRK: inconsistent with single resolve).
  3. Delete: clears the conversation's inbox messages (soft), legacy `messages` and tag pivots, then hard-deletes the conversation row; FK `inbox_messages.conversation_id ... ON DELETE CASCADE` removes message rows; notes, events and participants have NO FK and stay orphaned (the source comment claims they cascade — they do not).
  4. Only one workspace audit row `bulk.<action>` {count, ids} is written; only resolve writes per-conversation events.
  5. No cap on `ids` length; the loop runs synchronously.
  6. Realtime: no per-row broadcast; other clients see the change on their next poll (row `updated_at` bumps invalidate the queue fingerprint).
- **Async & events:** audit only.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a Manager selecting three open threads, When Archive is applied, Then all three have `archived=1`, leave the default list and appear under Archived, and the audit has `bulk.archive` with count 3.
  - Given an Agent, When calling bulk pin, Then the response is `ok:true, touched:0` and nothing changes.
  - Given an id from another workspace mixed in, When posted, Then it is ignored.
  - Given `action=assign, user_id=<other workspace user>`, When posted, Then 422 "That member is not part of this workspace."
  - Given delete on a thread with notes, When executed, Then messages are gone and (as shipped) the notes remain orphaned.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (bulk), app/Policies/ConversationPolicy.php (bulk), resources/js/charts/user-team-inbox-index.js (bulkAction, convAction, bulk handlers)
- **Port notes:** Execute per-row commands through the same domain services (so events/notifications/webhooks are uniform) inside one transaction per row with a job for large sets; cap ids at 200; return per-row results; soft-delete conversations.

### WD-TIB1-040 — Row context menu, archived view, pin and mute

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-TIB1-039
- **Summary:** WhatsApp-style list controls: right-click or long-press a row for Pin/Unpin, Mute/Unmute, Archive/Unarchive, Label..., Delete; archived chats live under a separate "Archived" row.
- **Actors & access:** Menu visible to all roles, but every action calls `POST /bulk` with one id, so it needs `inbox.bulk` (Manager+); Agents see the menu and get silent no-ops (WD-TIB1-039).
- **UX & screens:** Context menu (176 px) with the actions listed; Delete confirms "Delete conversation? This permanently deletes the chat and its messages. It cannot be undone." Label... prompts for a name (creates via `POST /tags` then bulk tag). The "Archived" row (with count) appears only when archived chats exist or the archived view is active; inside it the row becomes "Back to chats". The archived view ignores tab/status filters (`tab=all&status=all`) and disables infinite scroll (`per_page` window still applies).
- **Endpoints:** `POST team-inbox/api/bulk` (WD-TIB1-039), `GET team-inbox/api/queue?archived=1` (WD-TIB1-003).
- **Data:** `conversations.pinned_at`, `muted_at`, `archived`.
- **Rules & edge cases:**
  1. Pinned rows sort first (pinned_at desc). Muting is purely a client-side alert suppression: the server still counts muted threads in unread badges, the global bell, push notifications and desktop alerts of other clients — QUIRK.
  2. Archiving does NOT resolve or unassign. Archived threads are hidden from the default list, tab counts and the empty-state stat cards (all exclude `archived = 1`), but the global bell (`unread-summary`) does not filter archived.
  3. A new inbound message does NOT unarchive a thread (only the Coexistence history-sync import does) — QUIRK: an archived chat can receive customers' messages invisibly except via the Archived view and the bell.
  4. Deleting the open conversation clears the pane and returns to the empty state.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a Manager right-clicks a row and chooses Archive, Then the row leaves the list, the Archived row appears with count 1, and opening it lists the thread.
  - Given a pinned row, When the list reloads, Then it stays above unpinned rows.
  - Given a muted thread with a new message, When the poll returns, Then no sound plays.
- **Source refs:** resources/js/charts/user-team-inbox-index.js (openConvMenu, convAction, renderArchivedRow), app/Http/Controllers/TeamInboxController.php (queue archived branch)
- **Port notes:** Auto-unarchive on inbound (configurable); enforce mute server-side in notification fan-out; give agents pin/mute (personal preference table) instead of workspace-wide flags.

### WD-TIB1-041 — Find and merge duplicate conversations

- **Status:** implemented
- **Priority:** P2
- **Effort:** L
- **Depends on:** WD-TIB1-042
- **Summary:** A scan-then-merge tool that folds forked threads of the same customer (same business number and engine) into the oldest thread without losing any message, note, deal or call.
- **Actors & access:** Routes require `EnsureWorkspaceRole:manager`; the UI button needs `inbox.bulk`.
- **UX & screens:** Merge icon in the queue header opens a modal that immediately scans: "Found N customer(s) with more than one thread - M extra thread(s) will be folded in", a list (title/phone masked, engine label, thread and message counts) or "No duplicate chats found - your inbox is clean."; "Merge all (M)" button; toasts "Merged N chat(s) - M duplicate thread(s) removed", failures "N group(s) could not be merged - check the logs."
- **Endpoints:**

| Endpoint                             | Route name                           | Action                              | Middleware                                | Request                                                 | Response                                                                                                                         |
| ------------------------------------ | ------------------------------------ | ----------------------------------- | ----------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| GET team-inbox/api/duplicates        | user.team-inbox.api.duplicates.scan  | TeamInboxController@duplicatesScan  | Authenticate, EnsureWorkspaceRole:manager | none                                                    | `{ok, total_threads, removable, groups[{key,phone,provider,engine_label,thread_count,message_count,keep_id,merge_ids[],title}]}` |
| POST team-inbox/api/duplicates/merge | user.team-inbox.api.duplicates.merge | TeamInboxController@duplicatesMerge | Authenticate, EnsureWorkspaceRole:manager | `keys[]` (nullable strings max 191; empty = all groups) | `{ok: failed===0, summary{groups,threads_removed,messages_moved,failed}}`                                                        |

- **Data:** Scan looks at workspace conversations with `origin in (inbox, chat, chatbot)`, excluding engine-agnostic channels. Grouping: partition by engine + business number (device phone resolved per provider); inside a partition union-find over every digit form (>= 8 digits) found in `raw_jid`, `alt_jid`, `contact_digits`. Orphans (Baileys thread whose device row is gone) can join the single live cluster that matches their identity; ambiguous matches are left alone; orphans on the same dead device may merge with each other. Survivor = oldest live thread (orphans last); group key = `<provider>|<business>|<primaryId>`.
- **Rules & edge cases:**
  1. Merge re-points `conversation_id` on: inbox_messages, messages, conversation_notes, conversation_events, csat_responses, platform_notes, appointments, chatbot_widget_visitors, wa_calls, ai_call_logs, wa_form_submissions, deals (each guarded by schema checks); for unique pairs (participants by user, conversation_tag by tag) the loser's colliding rows are dropped first.
  2. Reconcile onto the survivor: device_id/provider from the most recently active row; both JIDs (phone JID on raw_jid, other form on alt_jid); best title (one with letters, longest); max last_message/inbound/outbound; SUM(unread); earliest pinned_at/muted_at; archived only if ALL archived; inbox_status open/pending wins over resolved/closed (open beats pending); keep any existing assignee user/team/agent; highest priority; preview = latest surviving message (raw decrypt).
  3. Each group is its own transaction; loser rows are then hard-deleted; a failed group is logged and skipped. Audit `inbox.conversations.merged` {groups, threads_removed, messages_moved, failed}.
  4. The merge re-scans server-side and only merges submitted keys that still exist (new forks since the scan are not swept silently).
- **Async & events:** audit; the UI reloads the queue afterwards.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given threads #12 (`919...`) and #13 (`919...@s.whatsapp.net`) on the same WABA number, When merged, Then #13 disappears, all its messages/notes/deals belong to #12, and message counts sum exactly.
  - Given the same customer on two different business numbers, When scanned, Then they are NOT grouped.
  - Given a merge where one group fails, When executed, Then other groups still merge and the response has `ok:false` with `failed:1`.
- **Source refs:** app/Services/Inbox/DuplicateConversationMerger.php, app/Http/Controllers/TeamInboxController.php (duplicatesScan, duplicatesMerge), resources/js/charts/inbox-merge-duplicates.js, resources/views/user/team-inbox/index.blade.php (#merge-dupes-modal)
- **Port notes:** Needed only for migrated WaDesk data; in the new schema enforce a unique index on (org, channel, business_number_id, contact_identity) so forks cannot occur; ship the merge as an admin script/job.

### WD-TIB1-042 — One thread per number: conversation identity resolution

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** none
- **Summary:** The rule that decides which conversation a phone number belongs to, used by inbound webhooks, compose, Quick Send, catalog, extension and mobile paths: match on normalized digits, never on the raw JID string, and never partition by origin/provider/device — except that workspaces with several business numbers get one thread per number.
- **Actors & access:** System service `ConversationResolver` (static).
- **UX & screens:** Visible only through outcomes: a customer messaging via WABA and via the Unofficial API is ONE thread whose channel follows the latest message; a customer texting two of the workspace's numbers gets two threads (the header/contact panel shows "On your number").
- **Endpoints:** none.
- **Data:** `conversations.contact_digits varchar32` (indexed with workspace_id), `raw_jid`, `alt_jid`, `device_id`, `provider`. `Conversation::saving` hook keeps `contact_digits` in sync (never blanks a resolved value).
- **Rules & edge cases:**
  1. `digitsFor(jid)`: null for empty values and `widget-*` visitors; null for non-phone identities (`ig:`, `fb:`, `email:` prefixes) so they can never collide with a phone thread and are keyed on the full `raw_jid`; group JIDs (`@g.us`) become `g:<digits>`; otherwise strip everything after `@` and all non-digits.
  2. Match predicate: same workspace, channel NOT in the engine-agnostic list, and (`contact_digits = d` OR `raw_jid` IN legacy shapes `d`, `d@s.whatsapp.net`, `d@c.us`, `d@lid` OR `alt_jid` IN those shapes). Oldest (lowest id) wins so history, deal links and bookmarks remain stable.
  3. Multi-number workspaces: when a caller passes the RECEIVING device id AND the workspace has 2+ provisioned numbers (connected OR disconnected Baileys devices plus waba/twilio/sms configs — counted this way so a flapping device does not collapse the partition), lookup prefers the thread bound to that device, else adopts an unbound (`device_id` null) thread, but never matches a thread bound to a different number. WhatsApp groups are exempt (one workspace-wide thread).
  4. `findOrCreate` re-checks under a row lock inside a transaction so concurrent first messages create exactly one thread; defaults: title = saved contact name + " · +digits" or "+digits", origin `inbox`, status `pending`, inbox_status `open`.
  5. `stampChannel(conv, provider, deviceId)` moves the thread to the channel of the latest message: ranks waba 3 > twilio 2 > sms 1 > baileys 0; never downgrades an official channel to Baileys; a bound thread in a multi-number workspace never changes `device_id`.
  6. `rememberJid` stores a newly seen JID form: `raw_jid` if empty, else `alt_jid` if empty (how a LID-only inbound finds the phone thread).
  7. Contact-name lookups for titles use the hashed phone (`mobile_hash`), never the encrypted column.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an existing thread stored as `919521881152@s.whatsapp.net`, When an inbound arrives as `919521881152@lid` with alt JID known, Then it resolves to the same thread and `alt_jid` is remembered.
  - Given a workspace with two connected numbers A and B, When the same customer messages both, Then two threads exist, each bound to its number.
  - Given two simultaneous first messages from a new number, When processed, Then exactly one conversation row is created.
  - Given a thread on Baileys, When a WABA inbound arrives, Then the thread's provider becomes `waba`; When a Baileys inbound arrives later, Then it stays `waba`.
- **Source refs:** app/Services/Inbox/ConversationResolver.php, app/Models/Conversation.php (booted), database/migrations/2026_07_20_090000_add_contact_digits_to_conversations.php
- **Port notes:** Encode as a unique partial index (`org_id, channel_account_id, contact_identity_id`) instead of digit-string heuristics; store E.164 and provider-native ids (wa_id, LID, PSID) in an `identities` table. Keep the "official beats unofficial" rule as an explicit per-thread `preferred_channel_account_id`.

### WD-TIB1-043 — Conversation lifecycle: statuses and inbound contract

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TIB1-042
- **Summary:** The state model every inbox feature rests on: `inbox_status` values, who moves a thread between them, and what an inbound customer message does to a conversation. Inbound ingestion itself belongs to WADEV/WABA/NODE and the channel domains; this entry fixes the contract they must honour.
- **Actors & access:** System and agents (via the actions in this file).
- **UX & screens:** Status pill in the header; kanban columns; queue default shows `open` + `pending`.
- **Endpoints:** none (see individual actions).
- **Data:** `conversations.inbox_status` enum `open | pending | snoozed | resolved | closed | spam` (default `open`), legacy `status` (`pending|sent|failed|scheduled`, for the /chat send queue — do not port), `is_spam`, `archived`, `unread_count`, `last_inbound_at`, `last_outbound_at`, `last_message_at`, `first_response_at`, `escalation_due_at`, `routing_meta` JSON, `origin` (`inbox|chat|chatbot|quick|bulk`), `platform` (`W|WB|T` legacy), `provider`, `channel`.
- **Rules & edge cases:**
  1. Transitions: `open|pending -> snoozed` (snooze; TIB2 wakes to `open`), `-> resolved` (resolve/bulk/AI), `resolved -> open` (reopen or inbound), `-> closed` (a device is deleted from /devices or the app: every open/pending/snoozed thread on `device_id = <that id>` becomes `closed` with `resolved_at = now` — QUIRK: the update has no provider filter, so WABA/Twilio threads whose config id equals the deleted device id are closed too; workspace Meta-agent-only mode: inbound sets `closed`), `-> spam` (bulk spam, routing action, platform-admin flag), `closed -> open` on human assignment.
  2. Inbound customer message on the two WhatsApp paths (Baileys mirror `WaInboundController` and the standard WABA webhook): update preview (191 chars, "📍 name" for locations, "📎 Type" for media), `last_message_at`, `last_inbound_at`, `unread_count + 1`, and set `inbox_status = open` UNCONDITIONALLY (so a customer reply REOPENS resolved, snoozed, closed and spam threads — QUIRK: `is_spam` stays true; the WABA path sets `closed` instead when the workspace runs Meta-agent-only mode). Then: channel stamp (WD-TIB1-042), broadcast `message.received`, optional FCM push, outbound webhooks `conversation.created` / `conversation.received`, SLA `applyOnInbound`, routing rules and auto-replies (TIB2/AR). The Baileys mirror also captures the customer as a contact and stamps `contact_id`, and backfills a NULL `workspace_id` from the device. QUIRK: every other channel ingest (Telegram, LINE, Viber, SMS, WeChat, Facebook, TikTok, email, WABA groups) reopens ONLY `resolved` threads; snoozed/closed/spam stay as they are.
  3. Outbound-sync mirror (agent replied from the phone, `fromMe`): stores the bubble, updates preview and `last_outbound_at`/`last_message_at`, does NOT bump unread, does NOT change status, fires webhook `conversation.outbound_synced` only (no routing/auto-reply).
  4. Live inbound never clears `archived`; history-sync import does.
  5. New conversations default `status=pending` (legacy column) and `inbox_status=open`; the value `pending` for `inbox_status` is written today only by the duplicate-merge reconcile (and may exist in older data); the Open filter and kanban treat it as Active and the docs describe it as "waiting on the customer" but no UI sets it.
  6. Events documented for outbound webhooks: `conversation.created|assigned|resolved|replied|received|outbound_synced` are fired; `conversation.reopened` and `note.added` are documented but never fired.
- **Async & events:** as listed.
- **External systems:** FCM (mobile push).
- **Settings:** workspace `ai_responder_mode` / `meta_agent_enabled` (`meta_agent_only` -> inbound `closed`).
- **Acceptance criteria:**
  - Given a resolved thread, When the customer sends a message, Then `inbox_status = open`, `unread_count` +1 and the thread reappears in Open.
  - Given a Baileys device is deleted, When the request completes, Then its open threads become `closed` with `resolved_at` set and disappear (device gone).
  - Given an outbound-sync message from the phone, When mirrored, Then unread_count is unchanged.
  - Given an archived thread, When a live inbound arrives, Then it stays archived.
- **Source refs:** app/Http/Controllers/WaInboundController.php, app/Http/Controllers/WaWebhookController.php, app/Http/Controllers/DevicesController.php (destroy), app/Http/Controllers/Api/App/DeviceController.php (destroy), app/Models/Workspace.php (inboundInboxStatus), app/Models/Conversation.php
- **Port notes:** Implement as a `ConversationStateMachine` with explicit transitions and domain events (`conversation.reopened_by_inbound`); drop the legacy `status/platform/origin/scheduled_*` columns; scope device-deletion closes by (provider, channel account id).

### WD-TIB1-044 — Mirror bulk sends into existing threads (`InboxMirror`)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-TIB1-042
- **Summary:** When broadcasts, campaigns or scheduled sends message someone who already has an inbox thread, the message is appended to that thread so agents see the full history, without ever creating new threads for cold recipients.
- **Actors & access:** System service called by BCAST/CAMP/SCHED/flows.
- **UX & screens:** Outbound bubbles with `meta.source = bulk` (template text via `readableTemplateBody`: header, body, footer joined by blank lines) in the existing thread; preview/last_message updated; unread untouched.
- **Endpoints:** none.
- **Data:** `inbox_messages` row (direction out, to_number digits, body, status `sent` if a wa id is known else `pending`, provider, meta `{source:'bulk', wa_message_id?, src_key?, ...}`); `conversations.last_message_at/last_outbound_at/preview`.
- **Rules & edge cases:**
  1. No thread => return null (skip) unless the caller sets `meta.allow_create` for a genuine 1:1 send; then a thread is created (title = saved contact name else digits, origin `meta.source ?? 'bulk'`, status open, channel whatsapp, unread 0).
  2. De-duplication: skip if the same `meta.wa_message_id` or `meta.src_key` already exists in the thread (engines report sends through different routes; src_key is deterministic per campaign+contact).
  3. Multi-number workspaces: pass the SENDING number (`receivingDeviceId` or `meta.receiving_device_id`) so the message lands in that number's thread; a non-matching id finds no thread and the send is skipped rather than misrouted.
  4. Never touches `unread_count`; best-effort, all exceptions are logged and swallowed.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a broadcast to a contact with an open thread, When sent, Then one outbound bubble appears in that thread and unread stays unchanged.
  - Given a broadcast to 5,000 contacts with no threads, When sent, Then zero conversations are created.
  - Given the same `src_key` mirrored twice, When processed, Then only one bubble exists.
- **Source refs:** app/Services/Inbox/InboxMirror.php
- **Port notes:** Implement as a consumer of `message.sent` outbox events from the outbound engines; dedupe on provider message id.

### WD-TIB1-045 — Kanban board (`GET /team-inbox/kanban`)

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-TIB1-003, WD-TIB1-032, WD-TIB1-034
- **Summary:** A drag-and-drop board over the same conversations, grouped by Status, Agent, Team, Priority or AI Agent; dropping a card performs the matching action.
- **Actors & access:** `Authenticate` + plan feature `EnforcePlanFeature:access_kanban_view`. Drag actions call the same endpoints with the same permissions (an Agent dragging to Resolved works; dragging to another agent 403s).
- **UX & screens:** `resources/views/user/team-inbox/kanban.blade.php`: header with live pulse "auto-refresh 10s" and highlight count, "List view" link, refresh button with "just now / 5s ago / 3m ago" label, group-by pills, optional device filter (only if 2+ active devices; persisted in `?device_id=`), search box (title, preview, assignee; Ctrl/Cmd+K focuses), stats Total / SLA breach / Unassigned (client-side over the loaded set), board of columns. Columns: Status = Active (open+pending), Snoozed, Resolved; Priority = Urgent/High/Normal/Low; Agent = Unassigned + each member; Team = "No team" + each team; AI = "No AI" + each agent. Card: avatar gradient from the name, name, masked phone line (always empty - QUIRK: list items carry no `contact_phone_display`), unread pill, preview, chips (assignee first name, team, AI agent, device when multi-device, priority, SLA), time. Click opens `/team-inbox#c=<id>`.
- **Endpoints:**

| Endpoint              | Route name             | Action                     | Middleware                                          | Request | Response |
| --------------------- | ---------------------- | -------------------------- | --------------------------------------------------- | ------- | -------- |
| GET team-inbox/kanban | user.team-inbox.kanban | TeamInboxController@kanban | Authenticate, EnforcePlanFeature:access_kanban_view | none    | HTML     |

- **Data:** Loads bootstrap once and `queue?status=all&tab=all&per_page=200` every 10 s. Resets `users.inbox_last_seen_at`.
- **Rules & edge cases:**
  1. Drop mapping: Status: Resolved => `/resolve`, Active => `/reopen`, Snoozed => `/snooze` with `until = now+1h`. Priority => `/priority`. Agent: Unassigned => `/unassign`, member => `/assign {user_id, strategy manual}`. Team: "No team" => `/unassign`, team => `/assign {team_id, strategy least_loaded}`. AI: "No AI" or agent => `/assign-agent {agent_id|null}`. Dropping on the same column is ignored. A toast "Moved." then a full reload.
  2. QUIRK: "No team" calls unassign, which only clears the person, so the card stays in its team column.
  3. Spam and closed threads are fetched (status=all) and counted in the header total but not shown in any status column; archived threads are excluded server-side.
  4. Limited to 200 rows; no pagination.
- **Async & events:** 10 s polling; the same events as each action.
- **External systems:** none.
- **Settings:** plan `access_kanban_view`.
- **Acceptance criteria:**
  - Given a plan without kanban, When opening the URL, Then the plan-gate response applies.
  - Given a card in Active, When dropped on Resolved, Then `/resolve` is called and after reload the card is under Resolved.
  - Given group-by Agent, When a card is dragged onto a member, Then it is assigned manually to them.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (kanban), resources/views/user/team-inbox/kanban.blade.php
- **Port notes:** Use a virtualized board with server-side column queries and optimistic moves; keep column-to-command mapping; fix the "No team" semantics and show the phone.

### WD-TIB1-046 — Agent availability status and activity tracking

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** none
- **Summary:** Each user has a per-workspace availability (`online`, `away`, `busy`, `offline`) with a message, a last-seen stamp, a live open-load counter and daily reply/resolution counters. Assignment strategies read it; team performance reports show it. The API to change status exists but the web UI never calls it.
- **Actors & access:** Any authenticated user for their own status; middleware `RecordAgentActivity` runs on authenticated web requests.
- **UX & screens:** None to set status. Member strip shows counts ("N members - M online") from `members[].status`.
- **Endpoints:**

| Endpoint                      | Route name                 | Action                        | Middleware   | Request                                                                       | Response                  |
| ----------------------------- | -------------------------- | ----------------------------- | ------------ | ----------------------------------------------------------------------------- | ------------------------- |
| POST team-inbox/api/me/status | user.team-inbox.api.status | TeamInboxController@setStatus | Authenticate | `status` (required online\|away\|busy\|offline), `message` (nullable max 128) | `{ok:true, status:<row>}` |

- **Data:** `agent_statuses(user_id, workspace_id, status default online, status_message, last_seen_at, current_load, today_replies, today_resolutions, counters_date, preferences JSON)` unique (user, workspace).
- **Rules & edge cases:**
  1. `RecordAgentActivity` (every authenticated web request, throttled to once per 30 s per user+workspace via cache) creates the row as `online` if missing, rolls the daily counters at day change, and stamps `last_seen_at`. It never sets `offline` or `away` automatically, and `last_seen_at` staleness is not used to derive presence — QUIRK: because no UI sets a status, everyone is effectively `online`, so auto-assignment never skips anyone by status.
  2. `today_replies` increments on text/media/voice replies; `today_resolutions` on single and bulk resolve; `current_load` is recomputed on assignment changes; `rolloverIfStale` resets `today_*` when `counters_date` is not today (called by stats readers).
  3. The route sets `status_message = null` when `message` is omitted.
  4. Removing a member does not delete their status row (WSP).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a user posts `busy` with a message, When the round-robin picker runs for their team, Then they are skipped.
  - Given an authenticated request 31 s after the last one, When processed, Then `last_seen_at` updates.
  - Given an invalid status `dnd`, When posted, Then 422.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (setStatus), app/Models/AgentStatus.php, app/Http/Middleware/RecordAgentActivity.php
- **Port notes:** Presence in Redis with TTL (auto-away), status persisted per user; expose a status dropdown in the inbox header.

### WD-TIB1-047 — Outbound event webhooks for conversations

- **Status:** partial
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-TIB1-017, WD-TIB1-032, WD-TIB1-034
- **Summary:** Workspaces can register HTTPS endpoints that receive HMAC-signed JSON when conversations are created, receive a message, are assigned, replied to, resolved or synced from the phone. The CRUD API and dispatcher work; the inbox UI links to a different `/webhooks` page and never calls these endpoints.
- **Actors & access:** CRUD requires `integration.manage` (Owner, Admin). No plan gate and no `webhooks_limit` check on these endpoints (the separate `/webhooks` controller enforces `access_outbound_webhooks` and `webhooks_limit`).
- **UX & screens:** None in the inbox JS. Documentation describes "inbox settings - Outbound webhooks".
- **Endpoints:**

| Endpoint                            | Route name                           | Action                              | Middleware   | Request                                                                                                                                                                                        | Response                                                                                        |
| ----------------------------------- | ------------------------------------ | ----------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| GET team-inbox/api/webhooks         | user.team-inbox.api.webhooks.index   | TeamInboxController@webhooksIndex   | Authenticate | none                                                                                                                                                                                           | array of hooks (id,name,url,events,is_active,fired_count,failed_count,last_fired_at,last_error) |
| POST team-inbox/api/webhooks        | user.team-inbox.api.webhooks.store   | TeamInboxController@webhooksStore   | Authenticate | `name` (nullable max 128; defaults to the URL host), `url` (required url max 1024), `events[]` (required min 1, strings max 64), `secret` (nullable max 128), `is_active` (bool, default true) | `{ok, webhook}`                                                                                 |
| PATCH team-inbox/api/webhooks/{id}  | user.team-inbox.api.webhooks.update  | TeamInboxController@webhooksUpdate  | Authenticate | any of name,url,events,secret,is_active (NOT validated)                                                                                                                                        | `{ok, webhook}`                                                                                 |
| DELETE team-inbox/api/webhooks/{id} | user.team-inbox.api.webhooks.destroy | TeamInboxController@webhooksDestroy | Authenticate | none                                                                                                                                                                                           | `{ok:true}`                                                                                     |

- **Data:** `outbound_webhooks(workspace_id, name, url, events JSON, secret encrypted text, is_active, fired_count, failed_count, last_fired_at, last_error)`; shared with the INTG `/webhooks` controller which counts these rows for its limit.
- **Rules & edge cases:**
  1. Subscription: an event name matches if listed or the list contains `*`; empty list matches nothing. Active hooks are loaded per firing (one indexed query) and filtered in PHP.
  2. Delivery: `POST` JSON `{event, fired_at, workspace_id, conversation{id,title,preview,inbox_status,priority,assignee_user_id,assignee_team_id,assignee_agent_id,raw_jid,last_message_at}, data:<extra>}` with headers Content-Type, `User-Agent: <Brand>-Webhook/1.0`, brand-prefixed event header and hook-id header, and `sha256=<hmac>` signature header over the body when a secret is set. Timeouts 4 s total / 2 s connect, no retries, synchronous inside the request that caused the event (a slow endpoint adds up to 4 s per hook to the agent's action).
  3. 2xx: `fired_count + 1`, `last_fired_at`, `last_error = null`; anything else or exception: `failed_count + 1`, `last_error` (HTTP status plus first 191 chars of body, or exception message).
  4. Events actually fired: `conversation.created`, `conversation.received` (inbound paths), `conversation.assigned` (assign only, not bulk/routing), `conversation.resolved` (single resolve only), `conversation.replied` (text reply with `body`, media reply with `media_type`/`caption`), `conversation.outbound_synced`. Documented but never fired: `conversation.reopened`, `note.added`.
  5. QUIRK: PATCH stores unvalidated input (`$request->only(...)`), so an update can set any URL string or event shape; the secret is hidden in JSON output.
  6. No SSRF protection on the URL (private IPs allowed).
- **Async & events:** Synchronous outbound HTTP.
- **External systems:** Customer endpoints.
- **Settings:** brand name for header names.
- **Acceptance criteria:**
  - Given a hook subscribed to `conversation.replied` with a secret, When an agent replies, Then the endpoint receives the payload with a valid HMAC signature and `fired_count` increments.
  - Given the endpoint returns 500, When an event fires, Then `failed_count` +1 and `last_error` starts with "HTTP 500".
  - Given events `["*"]`, When any fired event occurs, Then the hook is called.
  - Given an Agent, When calling the CRUD endpoints, Then 403.
- **Source refs:** app/Services/Inbox/OutboundWebhookDispatcher.php, app/Models/OutboundWebhook.php, app/Http/Controllers/TeamInboxController.php (webhooks*), app/Support/Brand.php
- **Port notes:** Merge with INTG's generic webhooks: signed delivery via a BullMQ job with retries/backoff, delivery log table, SSRF guard, replay UI; emit from the outbox.

### WD-TIB1-048 — Create a deal from a conversation and show the contact's deals

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-TIB1-009
- **Summary:** A header button opens a mini-form to create a Sales Pipeline deal linked to the customer and conversation; the contact panel lists deals for this conversation or contact (open first).
- **Actors & access:** Plan feature `access_sales_pipeline` (create returns 422 "Sales Pipeline is not enabled on your plan."; the list returns `enabled:false` and the panel stays hidden). View access is not checked on `create-deal`/`deals` beyond the workspace-scoped conversation lookup (no policy call) — QUIRK.
- **UX & screens:** "Create deal" modal: name (default contact name, else "Deal - <number>"), value, stage (loaded from `/deals/stages`); panel "Deals - N" cards (title, WON/LOST/OPEN pill, stage, value, link to `/deals?deal=<id>`), empty copy "No deals yet. Create one".
- **Endpoints:**

| Endpoint                                           | Route name                      | Action                                | Middleware   | Request                                                                                        | Response                                                                               |
| -------------------------------------------------- | ------------------------------- | ------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| POST team-inbox/api/conversations/{id}/create-deal | user.team-inbox.api.create-deal | TeamInboxController@createDeal        | Authenticate | `title` (nullable max 191), `value` (nullable numeric 0-99,999,999), `stage_id` (nullable int) | `{ok, deal_id, url:'/deals', message}` or 422                                          |
| GET team-inbox/api/conversations/{id}/deals        | user.team-inbox.api.deals       | TeamInboxController@conversationDeals | Authenticate | none                                                                                           | `{ok, enabled, deals[<=12 {id,title,value_display,status,stage_name,owner_name,url}]}` |

- **Data:** Creates `deals` (workspace, default pipeline `Pipeline::ensureDefaultForWorkspace`, requested stage if in that pipeline else first by `sort_order`, contact_id, conversation_id, title, `value_minor = round(value*100)`, currency = pipeline currency, owner = caller, source `inbox`); also a `note_added` conversation event "Deal created: <title> (#id)" (actor type deal). Deals list matches `conversation_id` OR the resolved contact, ordered open first then id desc.
- **Rules & edge cases:** 1. Contact linkage hydrates every workspace contact and compares digits with `raw_jid`/`alt_jid` — only bare-digit JIDs (WABA) match, not `@s.whatsapp.net` (QUIRK); `conversations.contact_id` is ignored here. 2. Pipeline with no stages => 422 "Your pipeline has no stages yet." 3. No deal-limit check in this action (DEAL owns limits).
- **Async & events:** DEAL model hooks (owner notification) fire from creation.
- **External systems:** none.
- **Settings:** plan `access_sales_pipeline`.
- **Acceptance criteria:**
  - Given a plan with pipelines, When creating a deal with value 500.50, Then `value_minor = 50050` in the default pipeline's first stage with `source = inbox`.
  - Given a plan without pipelines, When calling either endpoint, Then create is 422 and list is `enabled:false`.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (createDeal, conversationDeals), resources/js/charts/user-team-inbox-index.js (renderConversationDeals, createDealModal)
- **Port notes:** Call the DEAL service with `conversationId`/`contactId` (use the conversation's contact link, not phone scans).

### WD-TIB1-049 — Run an Instagram flow on an Instagram thread

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-TIB1-009
- **Summary:** For Instagram conversations, a header button lists the workspace's Instagram flows and starts the chosen one on that thread.
- **Actors & access:** List: any member. Run: `ConversationPolicy::reply`, conversation `channel = instagram` else 422 `not_instagram`.
- **UX & screens:** Button visible only on IG threads; popover "Run Instagram flow" with flow names or "No Instagram flows yet." plus an "Author flows in Instaflow" link when the remote mode gives one; toast "Flow started on this chat."
- **Endpoints:**

| Endpoint                                           | Route name                      | Action                        | Middleware   | Request                  | Response                                                      |
| -------------------------------------------------- | ------------------------------- | ----------------------------- | ------------ | ------------------------ | ------------------------------------------------------------- |
| GET team-inbox/api/ig-flows                        | user.team-inbox.api.ig-flows    | TeamInboxController@igFlows   | Authenticate | none                     | `{ok, flows[{id,name}], author_url}`                          |
| POST team-inbox/api/conversations/{id}/run-ig-flow | user.team-inbox.api.run-ig-flow | TeamInboxController@runIgFlow | Authenticate | `flow_id` (required int) | `{ok, error?}`; 404 `flow_not_found`, 422 `no_ig_conversation | not_connected`, 502 `run_failed` |

- **Data:** Two modes selected by `system_settings.instagram_enabled`. NATIVE add-on: flows are `flows` rows with `flow_type = instagram` for the workspace; run parses `raw_jid` `ig:<igUserId>:<igsid>`, finds the `instagram_accounts` row by `ig_user_id` and hands the decoded flow graph to Node via `IgFlowBridge::handoff` (Node `instagramFlowService` executes send nodes through the Graph API). REMOTE mode: flows fetched from the Instaflow bridge for the workspace's linked accounts (deduped by flow id) and `runFlow(igConvId, flowId)` on the bridge.
- **Rules & edge cases:** 1. The native lookup of the account by `ig_user_id` is not workspace-scoped (QUIRK). 2. Failure => 502 with `run_failed`.
- **Async & events:** hand-off to Node/Instaflow.
- **External systems:** Instaflow bridge (remote mode), Node IG flow service.
- **Settings:** `instagram_enabled`, Instaflow settings (IG domain).
- **Acceptance criteria:**
  - Given native mode and an active Instagram flow, When run on an IG thread, Then Node receives the flow graph and the response is 200.
  - Given a WhatsApp thread, When run, Then 422 `not_instagram`.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (igFlows, runIgFlow), resources/js/charts/user-team-inbox-index.js (initIgFlows)
- **Port notes:** Belongs with IG/FLR: a `startFlow(conversationId, flowId)` command; the inbox only shows the picker.

### WD-TIB1-050 — Coexistence: import 6-month WhatsApp history (`sync-history`)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** none
- **Summary:** A button (shown only for workspaces with a Coexistence-onboarded WABA number) asks Meta to re-push the last six months of phone-app chats so they appear in the inbox.
- **Actors & access:** Manager+ (`EnsureWorkspaceRole:manager`); the button renders only when `coexHistoryConfigId` is set (also manager+ and a connected WABA config with `meta_json.coexistence`).
- **UX & screens:** Clock icon form in the queue header; a green banner shows the flash status; amber banner for `waba` errors.
- **Endpoints:**

| Endpoint                     | Route name                   | Action                          | Middleware                                | Request | Response                                    |
| ---------------------------- | ---------------------------- | ------------------------------- | ----------------------------------------- | ------- | ------------------------------------------- |
| POST team-inbox/sync-history | user.team-inbox.sync-history | TeamInboxController@syncHistory | Authenticate, EnsureWorkspaceRole:manager | none    | redirect back with `status` or error `waba` |

- **Data:** none directly; delegates to `DevicesController::wabaSyncHistory(configId)` (re-subscribes the app so Meta pushes `history`). Imported threads are unarchived by the webhook handler.
- **Rules & edge cases:** 1. No connected coexistence WABA => back with "No WhatsApp Business (Cloud API) number with Coexistence is connected, so there is no phone-app history to import." 2. The route is a regular form POST (CSRF, redirect), not JSON.
- **Async & events:** Meta history webhooks (WABA domain).
- **External systems:** Meta Cloud API.
- **Settings:** coexistence flag on the provider config.
- **Acceptance criteria:**
  - Given a connected coexistence number, When a manager presses the button, Then the flow re-subscription runs and a status message shows.
  - Given no such number, When posted, Then the amber error text shows.
- **Source refs:** app/Http/Controllers/TeamInboxController.php (syncHistory, index), app/Http/Controllers/DevicesController.php (wabaSyncHistory)
- **Port notes:** Owned functionally by WABA; keep the trigger in the inbox header.

### WD-TIB1-051 — Team Inbox as an installable PWA (client shell)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-TIB1-001
- **Summary:** The inbox page can be installed as its own app scoped to `/team-inbox`, hides the site header when launched standalone, and asks agents to enable push. The manifest, subscribe endpoints, VAPID service and push senders are documented in NOTIF (WD-NOTIF-018/019/020); this entry covers what the inbox page itself does.
- **Actors & access:** Any agent; feature on only when the admin enabled `ti_pwa_enabled` (Admin > Settings > PWA) and generated VAPID keys.
- **UX & screens:** `partials/teaminbox-pwa.blade.php` replaces the app-wide PWA meta on nav-key `team-inbox` pages (inbox AND kanban): `<link rel=manifest href=/team-inbox-manifest.json>`, theme colour (`ti_pwa_theme_color` else `pwa_theme_color`, default #075E54), Apple web-app meta, apple-touch icon (`ti_pwa_icon_192` else `pwa_icon_192` else favicon), short title (`ti_pwa_short_name`, default "Inbox"), and CSS that hides `body > header` in `display-mode: standalone`. `initTeamInboxPush()` in the page script registers `/team-inbox-sw.js` with scope `/team-inbox` and shows an "Enable notifications" pill (see NOTIF-019). The push-only service worker (no caching) shows notifications and focuses/navigates an open inbox tab or opens a new one.
- **Endpoints:** owned by NOTIF (`GET team-inbox-manifest.json`, `GET/POST team-inbox/api/push/*`).
- **Data:** none here.
- **Rules & edge cases:**
  1. QUIRK: push and in-app notification links use `/team-inbox?c=<id>` but the inbox page only honours a `#c=<id>` hash, so tapping a notification opens the inbox without opening that conversation (the deals board link `/team-inbox?c=` has the same problem). Port must accept both.
  2. Inbound-message pushes go to the assignee only (or all opted-in agents when unassigned) and ignore muted flags.
  3. The bell widget is not shown on team-inbox pages.
- **Async & events:** Web Push.
- **External systems:** Browser push services.
- **Settings:** `ti_pwa_enabled`, `ti_pwa_*`, VAPID keys.
- **Acceptance criteria:**
  - Given `ti_pwa_enabled`, When `/team-inbox` loads, Then the head contains the inbox manifest link and not the app manifest.
  - Given the installed app, When launched standalone, Then the site header is hidden.
  - Given a push with url `/team-inbox?c=5`, When tapped, Then the inbox opens and (port requirement) conversation 5 is selected.
- **Source refs:** resources/views/partials/teaminbox-pwa.blade.php, resources/views/components/layouts/user.blade.php, public/team-inbox-sw.js, resources/js/charts/user-team-inbox-index.js (initTeamInboxPush), app/Http/Controllers/TeamInboxPwaController.php, Documentation/pages/messaging/team-inbox.html
- **Port notes:** `apps/web/public/team-inbox-sw.js`; deep link `?c=` support; per-tenant manifest optional.

### WD-TIB1-052 — Inbox authorization model (roles, permission keys, gates)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** none
- **Summary:** The complete list of gates that decide what each workspace role can do in the inbox. RBAC owns the matrix; this table is what the inbox enforces and where.
- **Actors & access:** Roles owner > admin > manager > agent > viewer (alias `member` = agent).
- **UX & screens:** Buttons/rail icons hide via the `permissions` map (WD-TIB1-002).
- **Endpoints:** none.
- **Data:** Permission map (`app/Support/WorkspacePermissions.php`): Owner all; Admin all except `workspace.billing`; Manager = inbox.view_all_teams/view_team/view_assigned/reply/note/assign/assign_self/resolve/snooze/bulk/tag/priority + tag.manage, savedreply.manage, analytics.view; Agent = view_all_teams, view_team, view_assigned, reply, note, resolve, snooze, assign_self, tag; Viewer = view_team, view_assigned.
- **Rules & edge cases:**
  1. Gate table: view/open thread = ConversationPolicy::view (see WD-TIB1-009); reply/media/voice/catalog/ai-suggest/run-ig-flow = `inbox.reply`; notes = `inbox.note`; assign/unassign/assign-agent/assign-assistant = `inbox.assign` (agents: claim-only via `inbox.assign_self` on assign); resolve/reopen = `inbox.resolve`; snooze = `inbox.snooze`; tag/untag = `inbox.tag`; priority = `inbox.priority`; bulk/row menu = `inbox.bulk`; duplicates = manager role; kanban = plan; saved replies create = `savedreply.manage`; tag master list = `tag.manage`; webhooks = `integration.manage`; teams = `team.manage` (WSP).
  2. No permission check at all on: compose send, message pin/star/react/edit/delete/forward/info, extract-contact, retry-media, save-contact (view only), create-deal, deals list, presence, status, google-meet, saved-reply update/delete of shared replies.
  3. Legacy Spatie keys `inbox.view`, `inbox.reply`, `inbox.assign`, `inbox.export` are seeded on platform roles (RolePermissionSeeder) but never checked by the inbox code (the client reads one `can('inbox.assign')` from the workspace map); `inbox.view` and `inbox.export` are unused anywhere.
  4. Platform staff with `platform.conversation.view_all` can view any conversation via the policy shortcut (cross-workspace read only).
  5. The workspace lookup returns 404 for foreign conversations before any policy runs.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given each role, When calling reply/assign/bulk/priority, Then the result matches the gate table above.
  - Given a Viewer, When calling compose send, Then (as shipped) it is allowed — the port must require `inbox.reply`.
- **Source refs:** app/Support/WorkspacePermissions.php, app/Policies/ConversationPolicy.php, database/seeders/RolePermissionSeeder.php, app/Providers/AppServiceProvider.php (canWorkspace)
- **Port notes:** Map to the target RBAC module permissions `inbox.*`; add the missing checks noted in item 2.

### WD-TIB1-053 — Inbox client preferences, deep links and mobile layout

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-TIB1-005
- **Summary:** Small behaviors that make the inbox usable across devices: remembered panel state, hash deep links, one-pane-at-a-time mobile flow and the cached thread LRU.
- **Actors & access:** Any member.
- **UX & screens:** Contact panel open/closed remembered in `localStorage.ti.contactOpen` (default closed; forced closed on phones < 768 px when switching conversations); composer collapsed state in `ti.composerOpen` (a slim "+ Reply, note or template" bar replaces it); the rail collapse state key stored in localStorage; `#c=<id>` opens a conversation after the queue loads; on mobile the thread is a full-screen overlay with a back button and the detail panel a full-screen overlay; composer focus scrolls the thread to the bottom; last used device filter is kept in `?device_id=`. Composer input mirrors a hidden `#composer` textarea (both updated when saved replies or Meet text are inserted).
- **Endpoints:** none.
- **Data:** browser storage only (wrapped in try/catch for private mode).
- **Rules & edge cases:** 1. Panel initial state is applied only when the open conversation CHANGES, not on polling refresh (fixes the panel snapping shut on mobile). 2. Localised strings come from `window.t` (`partials.js-i18n`). 3. Time formatting uses the workspace timezone.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the operator closes the composer and reloads, When a thread opens, Then the composer stays collapsed.
  - Given `/team-inbox#c=42`, When the page loads, Then conversation 42 opens.
  - Given a phone viewport, When a conversation is tapped, Then the contact panel does not auto-open.
- **Source refs:** resources/js/charts/user-team-inbox-index.js (setContactPanel, setComposer, bootstrap deep link, mobile-back)
- **Port notes:** Store in user preferences (server) for cross-device consistency; support `?c=` and `/inbox/:id` routes.

### WD-TIB1-054 — Advertised in docs/UI but not reachable

- **Status:** docs-only
- **Priority:** P2
- **Effort:** S
- **Depends on:** none
- **Summary:** Behaviors described in the Team Inbox documentation or implied by server/JS code that have no working user path in v1.7.0. Recorded so the port does not treat them as parity requirements and can decide to build them properly.
- **Actors & access:** n/a
- **UX & screens:** n/a
- **Endpoints:** n/a
- **Data:** n/a
- **Rules & edge cases:**
  1. Status filter (Open/Snoozed/Resolved/Closed/Spam/All) — server supports `status=`; no control in the list UI (only kanban uses `status=all`). Resolved/closed/spam threads are unreachable from the list view.
  2. "SLA breach" queue tab and "Mine" as the default tab — server supports `tab=sla_breach`; the UI has tabs All/Mine/Unassigned/@me/Unread with `All` default.
  3. Search "by contact name, number, or message text" — search covers title and preview only.
  4. Per-thread Resolve/Reopen buttons, Snooze presets — Resolve/Reopen have no list-view button (WD-TIB1-034); snooze uses a free-text prompt ("1h", "30m", "2d", or an ISO date) handled by TIB2.
  5. "Delete for me" of notes, note edit/pin, "admins and managers can delete any note" — no UI, and the permission is broader.
  6. "Every outgoing message is charged against the wallet ... refunded on failure" (docs) — code uses plan-first overflow billing with no refund path in the inbox.
  7. Playbook macros / saved-reply attachments (`saved_replies.attachments`) — column exists, never used.
  8. The docs' "Canned Replies & Playbook Macros" heading and "Agent availability status" (setting your own status) — the availability API has no UI (WD-TIB1-046).
  9. Outbound webhooks "under inbox settings" — no inbox UI (WD-TIB1-047).
  10. Real-time note/assignment updates — events emitted but unused (WD-TIB1-015).
- **Async & events:** n/a
- **External systems:** n/a
- **Settings:** n/a
- **Acceptance criteria:**
  - Given the port backlog, When a product decision is made per item, Then each item is either built to spec in a new WD id or explicitly dropped (Given/When/Then applies per item).
  - Given the parity tracker, When reading this feature, Then no test is generated against the advertised-only behaviors.
  - Given QA, When testing docs claims, Then they are marked docs-only rather than failing.
- **Source refs:** Documentation/pages/messaging/team-inbox.html, resources/js/charts/user-team-inbox-index.js, resources/views/user/team-inbox/index.blade.php
- **Port notes:** Prioritise (1) status filter or saved views, (4) resolve button, (5) note management.

### WD-TIB1-055 — Dead or unreachable inbox code

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** none
- **Summary:** Code that exists in the reference but nothing reaches; do not port.
- **Actors & access:** n/a
- **UX & screens:** n/a
- **Endpoints:** n/a
- **Data:** n/a
- **Rules & edge cases:**
  1. `TeamInboxController::markInboxSeen` — no route.
  2. JS `resolve()` bound to non-existent `#resolve-btn`; `renderChannelTabs()` targets non-existent `#ti-channel-tabs`; catalog Send handler reads unset `state.activeConvId` (WD-TIB1-021).
  3. `AutoReplyGuard` (routing/keyword path) is a no-op returning true; `markReplied` only stamps `routing_meta.last_auto_reply_at` (TIB2/AR).
  4. `Conversation` scopes `chatOnly`, `filtered`, `sorted`, `withStatus`, `forUser` belong to the legacy /chat send-queue model (CHAT).
  5. `mask_phone` returns its input; the masking branch below the early return never runs.
  6. Columns never written: `conversation_notes.is_pinned/edited_at`, `saved_replies.attachments`, `conversations.interested_*` (store/catalog interest tracking, other domain), `inbox_messages.ai_processed_at/ai_reply_id/voice_transcript*` (AI voice).
  7. `ConversationParticipant.unread_messages` is reset to 0 on read but never incremented anywhere.
  8. `last_read_at` schema check in `show()` (column missing).
- **Async & events:** n/a
- **External systems:** n/a
- **Settings:** n/a
- **Acceptance criteria:**
  - Given the port build, When reviewing scope, Then none of the listed items appear as features.
  - Given the parity tracker, When importing this list, Then each is recorded as intentionally dropped.
  - Given a code search in the port, When looking for these symbols, Then none exist.
- **Source refs:** app/Http/Controllers/TeamInboxController.php, resources/js/charts/user-team-inbox-index.js, app/Services/Inbox/AutoReplyGuard.php, app/Support/security_helpers.php
- **Port notes:** none.

## Data model

All ids are `bigint unsigned`; all tables live in one MySQL schema keyed by `workspace_id` (no database-level tenancy). Row volume: `inbox_messages` is the largest table (every message ever sent/received, tens of millions for big tenants); `conversations` is one row per customer per business number; `conversation_events` grows with every state change; the rest are small.

### `conversations` (model `Conversation`)

One row per customer thread. Behavior-relevant columns:

- Identity/routing: `workspace_id` (nullable for legacy rows; the seeded demo rows all have NULL), `user_id` (creator, NOT a visibility filter), `device_id` (polymorphic: `devices.id` when `provider = baileys`, `wa_provider_configs.id` when `waba|twilio`), `provider` varchar16 default `baileys` (`baileys|waba|twilio|sms` + channel names), `channel` varchar16 default `whatsapp` (`whatsapp, instagram, facebook, tiktok, telegram, line, wechat, viber, sms, email, chatbot_widget`), `platform` varchar8 default `W` (legacy `W|WB|T`), `origin` varchar16 default `chat` (`inbox|chat|chatbot|quick|bulk|...`), `raw_jid` varchar191 (WhatsApp JID/digits; `ig:<igUser>:<sender>`, `fb:<page>:<psid>` or `fb:<page>:post:<post>`, `tg:<bot>:<chat>`, `line:<row>:<user>`, `sms:<digits>`, `tt:<open_id>:<conv>`, `email:<row>:<thread>`, group id), `alt_jid` (the other identifier, e.g. `@lid`), `contact_digits` varchar32 (normalized identity; `g:<digits>` for groups; NULL for social ids), `contact_id` (linked contact), `contact_group_id` (legacy).
- Display: `title` text (encrypted `SafeEncrypted`), `preview` text (encrypted), `customer_language` varchar12 (pinned by translation), `archived` bool, `pinned_at`, `muted_at`.
- Lifecycle: `inbox_status` varchar16 default `open` (`open|pending|snoozed|resolved|closed|spam`), legacy `status` varchar16 default `pending` (`pending|sent|failed|scheduled|received`), `priority` varchar12 default `normal` (`low|normal|high|urgent`), `is_spam`, `snoozed_until`, `resolved_at`, `resolved_by`, `resolved_by_agent_id`, `first_response_at`, `last_message_at`, `last_inbound_at`, `last_outbound_at`, `unread_count` int default 0 (conversation-wide, not per agent).
- Assignment: `assignee_user_id`, `assignee_team_id`, `assignee_agent_id` (AI agent).
- SLA/escalation (TIB2): `sla_policy_id`, `sla_first_response_due`, `sla_resolution_due`, `sla_breached`, `escalation_due_at`, `escalation_action` JSON.
- `routing_meta` JSON: `wa_username`, `voice_assistant_id|name|at`, `ai_paused_by_human_at`, `ai_paused_by_user_id`, `last_auto_reply_at`, plus routing bookkeeping.
- Legacy/other: `recipients_count`, `scheduled_at`, `scheduled_timezone`, `interested_sku|product_id|seen_at` (store interest, CAT).
- Indexes: `(workspace_id, inbox_status, priority)`, `(workspace_id, assignee_user_id, inbox_status)`, `(workspace_id, assignee_team_id, inbox_status)`, `(workspace_id, archived, inbox_status, last_message_at)`, `(workspace_id, unread_count)`, `(workspace_id, contact_digits)`, `(workspace_id, provider)`, single-column indexes on device_id, snoozed_until, sla_*, escalation_due_at, last_inbound_at, last_outbound_at, pinned_at, channel, is_spam, alt_jid, contact_id, origin. No FKs at all; no unique index on identity (uniqueness is application logic, WD-TIB1-042). No soft delete (bulk delete is permanent).
- Read/written by nearly every feature; writers outside this domain: inbound webhooks, channel ingest services, routing engine, SLA tracker, AI agent, devices delete.

### `inbox_messages` (model `InboxMessage`, SoftDeletes)

- `conversation_id` FK -> conversations ON DELETE CASCADE (the ONLY FK in this domain), `user_id` (sending agent), `agent_id` (AI author), `contact_id`, `template_id`, `provider` (engine that carried it), `direction` varchar8 (`in|out`), `to_number`/`from_number` text (encrypted `SafeEncrypted`), `body` text (encrypted), `translated_body` text (encrypted), `detected_language` varchar12, `is_translated`, `media_path` varchar255, `media_type` varchar16 (`image|video|audio|document|sticker|contact|location|call|...`; Instagram uses `share|ig_reel|story_reply|story_mention`), `latitude/longitude` decimal(10,7), `status` varchar16 default `pending` (`pending|sent|delivered|read|failed`; inbound rows use `received`), `failure_reason` text (encrypted), `pinned`, `starred`, `reaction` varchar16, `edited_at`, `quality_score` tinyint, `quality_note`, `voice_transcript`, `voice_transcript_lang`, `ai_processed_at`, `ai_reply_id`, `meta` JSON, `sent_at`, `delivered_at`, `read_at`, `deleted_at`.
- `meta` keys used by TIB1: `wa_message_id`, `target_jid`, `source` (`compose|bulk`), `src_key`, template block (`header, footer, buttons, template_id, template_name, template_language, template_vars, template_send_vars, type=template`), `ptt`, `duration`, `forwarded`, `frequently_forwarded`, `contact{name,phone}`, `location_*`, `kind=catalog` + `mode, provider, products, catalog_payload|response`, `email{subject,from_name,from_email}`, `instagram.media_url`, `type=wa_form_submission` + `form_title, submission_id, fields`, `call_status, call_direction, duration_sec`, `waba_media_id`, `waba_mime_type`, `history_sync`.
- Index `(conversation_id, id)`, plus user/agent/contact/template/direction/status/pinned/starred/provider/ai_processed_at. Model observers: on create stamp `provider` from the conversation; on inbound create defer translation ingest and Web Push after the response.
- No `workspace_id`; scope through the conversation (a recurring source of bugs, see WD-TIB1-026 footer quirk).

### `conversation_notes` (model `ConversationNote`, SoftDeletes)

`conversation_id`, `workspace_id`, `user_id`, `body` (encrypted), `mentions` JSON `[{user_id,name}]`, `is_pinned` (unused), `edited_at` (unused), `deleted_at`. Index `(conversation_id, created_at)`. No FKs.

### `conversation_events` (model `ConversationEvent`, no `updated_at`)

`conversation_id`, `workspace_id`, `actor_user_id`, `actor_type` varchar24 default `user` (`user|system|human|flow|deal|ai`), `type` varchar32, `payload` JSON, `created_at` (default now). Indexes on conversation_id, workspace_id, type, created_at. No FKs. See WD-TIB1-013 for types.

### `conversation_participants` (model `ConversationParticipant`)

`conversation_id`, `workspace_id`, `user_id`, `role` varchar16 default `watcher` (`assignee|watcher|mentioned|follower`; in practice only `watcher` and `mentioned` are written), `last_read_at`, `unread_messages` (never incremented), `unread_mentions`. Unique `(conversation_id, user_id)`. Drives the @me tab and resolved-notification recipients. Merge logic drops colliding rows.

### `conversation_tag` (pivot)

`conversation_id`, `tag_id`, `added_by` (nullable), timestamps; unique `(conversation_id, tag_id)`. No FKs (orphans on tag/conversation delete).

### `tags` (model `Tag`)

`workspace_id`, `name` varchar64, `slug` varchar64, `color` varchar16 default `#075E54`, `description` varchar255. Unique `(workspace_id, slug)`. Shared with CON (`contact_tag`) and WSP (starter tags).

### `saved_replies` (model `SavedReply`)

`workspace_id`, `user_id` (null = shared), `shortcut` varchar64 (indexed, not unique), `title` varchar128, `body` text (encrypted), `attachments` JSON (unused), `category` varchar64, `used_count` bigint default 0.

### `outbound_webhooks` (model `OutboundWebhook`)

`workspace_id`, `name` varchar128, `url` varchar1024, `events` JSON (event names or `["*"]`), `secret` text (encrypted; hidden in JSON), `is_active` default 1, `fired_count`, `failed_count`, `last_fired_at`, `last_error`. Also written by the INTG `/webhooks` controller's limit query.

### `agent_statuses` (model `AgentStatus`)

`user_id`, `workspace_id` (unique together), `status` varchar12 default `online` (`online|away|busy|offline`), `status_message` varchar128, `last_seen_at`, `current_load`, `today_replies`, `today_resolutions`, `counters_date`, `preferences` JSON (unused).

### Consumed tables (owned elsewhere)

`teams`, `team_user` (WSP: members, `capacity` default 20, `is_lead`), `users.inbox_last_seen_at` (bell watermark, written here), `inbox_notifications`, `push_subscriptions` (NOTIF), `messages` (legacy /chat + campaigns; read for sticky assignment, monthly usage and recipient fallback), `contacts`, `wa_templates`, `wa_provider_configs`, `devices`, `wa_catalogs`, `wa_products`, `wa_storefronts`, `wa_orders`, `wa_call_permissions`, `deals`, `pipelines`, `ai_agents`, `ai_call_assistants`, `flows`, `sla_policies`, `routing_rules`, `system_settings`.

## Cross-domain contracts

Consumes:

- TIB2: `SlaTracker::markFirstResponse|applyOnResolution` and `applyOnInbound`; `RoutingEngine::applyEscalation`; queue-poll sweeps and the `snooze` endpoint used by kanban and the header.
- WSP: `Team` (strategy, members, capacity, device scope), workspace members and roles (`workspaceRole`), workspace timezone/default language; plan resolution `Workspace::effectiveLimit`.
- RBAC: `WorkspacePermissions` matrix, `ConversationPolicy`, `@canWorkspace` blade directive, platform permission `platform.conversation.view_all`.
- NOTIF: `NotificationDispatcher` (assignment, mention, resolved notifications; dedupe 30 s; web push), `AuditLogger::workspace`, `InboxNotification`, Web Push and PWA endpoints.
- I18N: `ConversationTranslationService::translateOutbound|ingestInbound|config`.
- WALLET/BSP: `OverflowBilling::consumeOne`, `PlanLimitReachedException`; PLAN: `PlanLimitGuard::check|feature|hasFeature`.
- SET/ASHELL: `SendGate::halted|screen`, media disk (`media_disk()`, `media_storage()`, `media_url()`), `ffmpeg_path`, realtime/Pusher config, PWA settings, `waba_graph_api_version`, `allowed_send_methods`, `default_send_method`.
- WADEV/NODE: Node endpoints `/api/send-message|send-media-message|send-media-only|send-reaction|pin-message|star-message|delete-message|edit-message|flow-end`, header `X-Node-Token`, `baileys_server_url`/`SERVER_URL`.
- WABA/TPL: Meta Graph send + media upload, `WabaMediaFetcher`, `TemplatePayloadBuilder`, `TemplateOverrideResolver`, `BroadcastsController::varsForRecipient`, `WorkspaceEngine` sender keys, `WaProviderConfig`, coexistence `wabaSyncHistory`.
- CON: `Contact::rememberPhone|canonicalizePhone|nameForPhone|hashPhone`, `AttributeResolver`, unsubscribe flag, `SendAttributes` catalog.
- AIAG/AIADM: `AiAgentService::generateReply|respondIfAssigned|respondAsVoiceAssistant`, `AiAgent`, `AiCallAssistant`.
- FLR: `FlowEnrollmentService::onConversationTagged`; IG flow bridge.
- DEAL: `Pipeline::ensureDefaultForWorkspace`, `Deal`.
- CAT/STORE: `WhatsAppCatalogFactory`, `BaileysCatalogService`, product list endpoint `/store/products/api/list`.
- Channel domains: outbound adapters invoked by `InboxDispatcher` (Instagram addon/Instaflow, Facebook, TikTok, Telegram, LINE, WeChat, Viber, SMS, MailTrixy).
- INTG: `FlowNodeActionsController@googleMeetForInbox`.

Exposes:

- To all inbound/channel ingest code: `ConversationResolver::find|findOrCreate|stampChannel|rememberJid|digitsFor`, `Conversation` scopes, the lifecycle rules in WD-TIB1-043, events `MessageReceived` etc.
- To campaigns/broadcasts/scheduled/flows: `InboxMirror::appendOutboundToOpenConversation`, `InboxDispatcher::send`.
- To routing rules and flows (TIB2/FLR): `AssignmentService::assign|unassign`.
- To webhooks consumers: `OutboundWebhookDispatcher::fire(event, conversation, extra)`.
- To API/MOB: the `conversations`/`inbox_messages` tables and the send pipeline (their controllers reimplement listing; keep behavior consistent).
- To NOTIF/CPN and others: `users.inbox_last_seen_at`, `agent_statuses` counters.

## Open questions & quirks

1. Route ownership: `POST team-inbox/api/conversations/{id}/snooze`, `GET team-inbox/api/stats` and the analytics/SLA/routing/business-hours routes live in `TeamInboxController` but are assigned to TIB2 by the brief; if TIB2 does not claim them they will surface as orphans.
2. `POST team-inbox/api/google-meet` is documented in WD-TIB1-022 but its coverage is left to INTG; `GET|POST team-inbox/api/webhooks*` are claimed here although INTG's `/webhooks` UI shares the `OutboundWebhook` model.
3. `AdminTeamInboxController` (`admin/team-inbox*`), `Admin\Support\TeamInboxController` (`admin/support/team-inbox`), `WorkspaceMembersController` (`team-inbox/api/members*`, `team-inbox/members`), `TeamChatController` (`team-inbox/api/team-chat*`), the `team-inbox/api/teams*` CRUD and `team-inbox/api/ai-agents|ai-keys*` are Team-Inbox-prefixed but owned by other domains as listed in the Overview.
4. The AI agents CRUD, AI keys CRUD and the routing/SLA/business-hours/webhook management modals are still mounted inside `index.blade.php` and `user-team-inbox-index.js`; whichever domain rebuilds them must keep entry points in the inbox rail.
5. `unread_count` is conversation-wide: the first agent to open a thread clears the badge for everyone; per-agent unread only exists for @mentions (`conversation_participants`).
6. Several UI paths silently rely on permissions the role lacks (Agents see bulk/row-menu actions that no-op with `touched:0`, quick labels fire a priority change that 403s, "Label..." needs `tag.manage`).
7. Contact matching is inconsistent across the file: some code uses `contacts.mobile_hash`/`contact_id` (correct), some hydrates all contacts and compares digits to `raw_jid` (works only for bare-digit WABA JIDs), and `show()` runs an SQL match on an encrypted column (never matches). Treat `conversations.contact_id` + hashed E.164 as the port's single source of truth.
8. `ok:true` with `local_only:true` from the dispatcher is treated as success and marks the message `sent` (e.g. no WABA token, no Node URL). Likely unintended; port should fail loudly.
9. The branding footer (`applyBrandingFooter`) reads a non-existent `inbox_messages.workspace_id` and therefore never appends the plan-gated footer to inbox replies.
10. `mask_phone` is a no-op product-wide; the docs and code comments still talk about masking.
11. Docs describe wallet charge/refund per inbox message; code uses plan-first overflow billing with no inbox-level refund.
12. `inbox.view` and `inbox.export` Spatie permissions are seeded but never consulted by the inbox; only the workspace permission matrix is enforced.
13. `presence` uses the cache; the service comment claims there are no websockets, but Pusher realtime exists; presence/typing are never pushed over sockets.
14. `MentionReceived` is broadcast on a private channel with no authorization definition; only `message.received` has a client listener.
15. Bulk delete is a hard delete that orphans notes, events, participants and tag pivots (no FKs, comments claiming cascade are wrong); `Tag::delete` orphans `conversation_tag`.
16. Device deletion closes threads with an unscoped `device_id = id` update that can also close WABA/Twilio threads whose provider-config id equals the deleted device id.
17. Live inbound does not un-archive a conversation; only the Coexistence history import does. Muting is client-only.
18. `pending` inbox_status is effectively unused; some channels reopen only `resolved`, WhatsApp paths reopen every status.
19. Compose sends to many recipients inline in one request (up to 500) and has no permission check, opt-out check for manual numbers, or template picker in the UI.
20. Catalog send from the composer is broken client-side (`state.activeConvId` never set); the server endpoint works.
21. `POST team-inbox/api/conversations/{id}/reply` returns HTTP 200 with a failed message on provider errors (clients must inspect `message.status`).
22. Data assumptions: the seeded demo DB has six NULL-workspace conversations, zero inbox messages, six starter tags (WSP) and one `agent_statuses` row — no real inbox data exists to verify behavior against; live parity checks must generate their own threads.

## Coverage

```json wadesk-coverage
{
  "routes": [
    "GET team-inbox",
    "GET team-inbox/api/bootstrap",
    "GET team-inbox/api/queue",
    "GET team-inbox/api/unread-summary",
    "GET team-inbox/api/conversations/{id}",
    "POST team-inbox/api/conversations/{id}/save-contact",
    "POST team-inbox/api/conversations/{id}/presence",
    "POST team-inbox/api/conversations/{id}/presence/leave",
    "POST team-inbox/api/conversations/{id}/reply",
    "POST team-inbox/api/conversations/{id}/media",
    "POST team-inbox/api/conversations/{id}/voice",
    "POST team-inbox/api/conversations/{id}/catalog",
    "POST team-inbox/api/conversations/{id}/ai-suggest",
    "GET team-inbox/api/saved-replies",
    "POST team-inbox/api/saved-replies",
    "PATCH team-inbox/api/saved-replies/{id}",
    "DELETE team-inbox/api/saved-replies/{id}",
    "POST team-inbox/api/saved-replies/{id}/used",
    "GET team-inbox/api/compose/options",
    "POST team-inbox/api/compose",
    "GET team-inbox/api/conversations/{cId}/messages/{mId}/info",
    "PATCH team-inbox/api/conversations/{cId}/messages/{mId}/pin",
    "PATCH team-inbox/api/conversations/{cId}/messages/{mId}/star",
    "POST team-inbox/api/conversations/{cId}/messages/{mId}/react",
    "PATCH team-inbox/api/conversations/{cId}/messages/{mId}/edit",
    "DELETE team-inbox/api/conversations/{cId}/messages/{mId}",
    "POST team-inbox/api/conversations/{cId}/messages/{mId}/forward",
    "POST team-inbox/api/messages/{id}/extract-contact",
    "POST team-inbox/api/messages/{id}/retry-media",
    "POST team-inbox/api/conversations/{id}/assign",
    "POST team-inbox/api/conversations/{id}/unassign",
    "POST team-inbox/api/conversations/{id}/assign-agent",
    "POST team-inbox/api/conversations/{id}/assign-assistant",
    "GET team-inbox/api/assistants",
    "POST team-inbox/api/conversations/{id}/resolve",
    "POST team-inbox/api/conversations/{id}/reopen",
    "POST team-inbox/api/conversations/{id}/priority",
    "POST team-inbox/api/conversations/{id}/tag",
    "DELETE team-inbox/api/conversations/{id}/tag/{tagId}",
    "GET team-inbox/api/tags",
    "POST team-inbox/api/tags",
    "DELETE team-inbox/api/tags/{id}",
    "POST team-inbox/api/conversations/{id}/notes",
    "DELETE team-inbox/api/conversations/{id}/notes/{noteId}",
    "POST team-inbox/api/bulk",
    "GET team-inbox/api/duplicates",
    "POST team-inbox/api/duplicates/merge",
    "GET team-inbox/kanban",
    "POST team-inbox/api/me/status",
    "GET team-inbox/api/webhooks",
    "POST team-inbox/api/webhooks",
    "PATCH team-inbox/api/webhooks/{id}",
    "DELETE team-inbox/api/webhooks/{id}",
    "POST team-inbox/api/conversations/{id}/create-deal",
    "GET team-inbox/api/conversations/{id}/deals",
    "GET team-inbox/api/ig-flows",
    "POST team-inbox/api/conversations/{id}/run-ig-flow",
    "POST team-inbox/sync-history"
  ],
  "controllers": [
    "app/Http/Controllers/TeamInboxController.php",
    "app/Http/Controllers/TeamInboxPwaController.php"
  ],
  "services": [
    "app/Services/InboxDispatcher.php",
    "app/Services/Inbox/AssignmentService.php",
    "app/Services/Inbox/ConversationResolver.php",
    "app/Services/Inbox/DuplicateConversationMerger.php",
    "app/Services/Inbox/InboxMirror.php",
    "app/Services/Inbox/OutboundWebhookDispatcher.php",
    "app/Services/Inbox/PresenceService.php"
  ],
  "models": [
    "Conversation",
    "ConversationEvent",
    "ConversationNote",
    "ConversationParticipant",
    "InboxMessage",
    "SavedReply",
    "Tag",
    "OutboundWebhook",
    "AgentStatus"
  ],
  "tables": [
    "conversations",
    "inbox_messages",
    "conversation_notes",
    "conversation_events",
    "conversation_participants",
    "conversation_tag",
    "tags",
    "saved_replies",
    "outbound_webhooks",
    "agent_statuses"
  ],
  "views": [
    "resources/views/user/team-inbox/index.blade.php",
    "resources/views/user/team-inbox/kanban.blade.php",
    "resources/views/components/user/inbox-bell.blade.php",
    "resources/views/partials/teaminbox-pwa.blade.php"
  ],
  "commands": [],
  "permissions": ["inbox.assign", "inbox.export", "inbox.reply", "inbox.view"],
  "middleware": ["app/Http/Middleware/RecordAgentActivity.php"],
  "node_files": [],
  "js_assets": [
    "resources/js/charts/user-team-inbox-index.js",
    "resources/js/charts/inbox-merge-duplicates.js"
  ],
  "misc_files": [
    "app/Events/Inbox/ConversationAssigned.php",
    "app/Events/Inbox/ConversationUpdated.php",
    "app/Events/Inbox/MentionReceived.php",
    "app/Events/Inbox/MessageReceived.php",
    "app/Events/Inbox/NoteAdded.php",
    "app/Exceptions/AssignmentTargetException.php",
    "app/Policies/ConversationPolicy.php"
  ],
  "config_files": ["config/broadcasting.php"],
  "doc_pages": ["Documentation/pages/messaging/team-inbox.html"],
  "feature_map": {
    "WD-TIB1-001": ["GET team-inbox"],
    "WD-TIB1-002": ["GET team-inbox/api/bootstrap"],
    "WD-TIB1-003": ["GET team-inbox/api/queue"],
    "WD-TIB1-004": [],
    "WD-TIB1-005": [],
    "WD-TIB1-006": [],
    "WD-TIB1-007": [],
    "WD-TIB1-008": ["GET team-inbox/api/unread-summary"],
    "WD-TIB1-009": ["GET team-inbox/api/conversations/{id}"],
    "WD-TIB1-010": [],
    "WD-TIB1-011": [],
    "WD-TIB1-012": ["POST team-inbox/api/conversations/{id}/save-contact"],
    "WD-TIB1-013": [],
    "WD-TIB1-014": [
      "POST team-inbox/api/conversations/{id}/presence",
      "POST team-inbox/api/conversations/{id}/presence/leave"
    ],
    "WD-TIB1-015": [],
    "WD-TIB1-016": [],
    "WD-TIB1-017": ["POST team-inbox/api/conversations/{id}/reply"],
    "WD-TIB1-018": [],
    "WD-TIB1-019": ["POST team-inbox/api/conversations/{id}/media"],
    "WD-TIB1-020": ["POST team-inbox/api/conversations/{id}/voice"],
    "WD-TIB1-021": ["POST team-inbox/api/conversations/{id}/catalog"],
    "WD-TIB1-022": [],
    "WD-TIB1-023": ["POST team-inbox/api/conversations/{id}/ai-suggest"],
    "WD-TIB1-024": [
      "GET team-inbox/api/saved-replies",
      "POST team-inbox/api/saved-replies",
      "PATCH team-inbox/api/saved-replies/{id}",
      "DELETE team-inbox/api/saved-replies/{id}",
      "POST team-inbox/api/saved-replies/{id}/used"
    ],
    "WD-TIB1-025": ["GET team-inbox/api/compose/options", "POST team-inbox/api/compose"],
    "WD-TIB1-026": [],
    "WD-TIB1-027": [
      "GET team-inbox/api/conversations/{cId}/messages/{mId}/info",
      "PATCH team-inbox/api/conversations/{cId}/messages/{mId}/pin",
      "PATCH team-inbox/api/conversations/{cId}/messages/{mId}/star",
      "POST team-inbox/api/conversations/{cId}/messages/{mId}/react"
    ],
    "WD-TIB1-028": [
      "PATCH team-inbox/api/conversations/{cId}/messages/{mId}/edit",
      "DELETE team-inbox/api/conversations/{cId}/messages/{mId}"
    ],
    "WD-TIB1-029": ["POST team-inbox/api/conversations/{cId}/messages/{mId}/forward"],
    "WD-TIB1-030": ["POST team-inbox/api/messages/{id}/extract-contact"],
    "WD-TIB1-031": ["POST team-inbox/api/messages/{id}/retry-media"],
    "WD-TIB1-032": [
      "POST team-inbox/api/conversations/{id}/assign",
      "POST team-inbox/api/conversations/{id}/unassign"
    ],
    "WD-TIB1-033": [
      "POST team-inbox/api/conversations/{id}/assign-agent",
      "POST team-inbox/api/conversations/{id}/assign-assistant",
      "GET team-inbox/api/assistants"
    ],
    "WD-TIB1-034": [
      "POST team-inbox/api/conversations/{id}/resolve",
      "POST team-inbox/api/conversations/{id}/reopen"
    ],
    "WD-TIB1-035": ["POST team-inbox/api/conversations/{id}/priority"],
    "WD-TIB1-036": [
      "POST team-inbox/api/conversations/{id}/tag",
      "DELETE team-inbox/api/conversations/{id}/tag/{tagId}"
    ],
    "WD-TIB1-037": [
      "GET team-inbox/api/tags",
      "POST team-inbox/api/tags",
      "DELETE team-inbox/api/tags/{id}"
    ],
    "WD-TIB1-038": [
      "POST team-inbox/api/conversations/{id}/notes",
      "DELETE team-inbox/api/conversations/{id}/notes/{noteId}"
    ],
    "WD-TIB1-039": ["POST team-inbox/api/bulk"],
    "WD-TIB1-040": [],
    "WD-TIB1-041": ["GET team-inbox/api/duplicates", "POST team-inbox/api/duplicates/merge"],
    "WD-TIB1-042": [],
    "WD-TIB1-043": [],
    "WD-TIB1-044": [],
    "WD-TIB1-045": ["GET team-inbox/kanban"],
    "WD-TIB1-046": ["POST team-inbox/api/me/status"],
    "WD-TIB1-047": [
      "GET team-inbox/api/webhooks",
      "POST team-inbox/api/webhooks",
      "PATCH team-inbox/api/webhooks/{id}",
      "DELETE team-inbox/api/webhooks/{id}"
    ],
    "WD-TIB1-048": [
      "POST team-inbox/api/conversations/{id}/create-deal",
      "GET team-inbox/api/conversations/{id}/deals"
    ],
    "WD-TIB1-049": [
      "GET team-inbox/api/ig-flows",
      "POST team-inbox/api/conversations/{id}/run-ig-flow"
    ],
    "WD-TIB1-050": ["POST team-inbox/sync-history"],
    "WD-TIB1-051": [],
    "WD-TIB1-052": [],
    "WD-TIB1-053": [],
    "WD-TIB1-054": [],
    "WD-TIB1-055": []
  }
}
```


## Port note: data model reshape (2026-10-02, plan-inbox-chat.md owner decision 2)

The rebuild folds this domain's two message tables (`messages` and TIB1's `inbox_messages`) into one `messages` stream and reshapes
`conversations` before any code depends on them. Where the entries above say otherwise, the schema is: `channel_id` replaces
`device_id` + `provider` + `platform` + `channel`; `peer_key` replaces `raw_jid`, `alt_jid` and `contact_digits`; one lifecycle
`status` replaces `status` (Quick Send roll-up) and `inbox_status`; Quick Send columns (`recipients_count`, `scheduled_*`) are gone and
the roll-up becomes a derived value; `messages` gains `seq`, `sender_kind`, `client_message_id`, `provider_message_id` (idempotency in
`message_ledger`) and loses `to_number`/`from_number`. Details: [docs/api/chat-conversations.md](../../api/chat-conversations.md).
