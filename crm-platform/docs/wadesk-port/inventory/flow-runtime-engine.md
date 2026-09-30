---
domain: flow-runtime-engine
code: FLR
title: Flow Runtime Engine
wadesk_version: '1.7.0'
sources_read: 74
---

# Flow Runtime Engine

## Overview

This domain is everything that happens AFTER a flow graph has been designed and saved: how a flow is started (triggers), how it is executed node by node (the runtime), how it talks to customers over each channel, what it records about each run, and how operators see and re-run failures. The visual editor, the node palette UI, save/publish/import/export/templates and AI flow generation belong to `flow-builder-editor` (FLB). Auto-reply keyword rules (the `keyword_replies` table and the `/api/keyword-replies` matcher) belong to `auto-reply-keywords` (AR); this domain documents only the parts of them that start a flow.

Who uses it: the end customer (who experiences the flow as a WhatsApp/Instagram/Facebook/TikTok/Telegram/LINE/Viber/WeChat/email conversation), the workspace admin (enrolls contacts, pauses/resumes runs, reads analytics, retries failures; every web route is `EnsureWorkspaceRole:admin`), API clients (enroll a contact by REST, owned by the `developer-rest-api-v1` domain), and internal callers (Laravel event hooks, the Node bridge, other channel domains).

Architecture in one paragraph. WaDesk has TWO cooperating runtimes. Laravel decides WHO enters WHICH flow (trigger hooks -> `FlowEnrollmentService`, the `flows` table, `flow_subscribers` rows) and serves the flow graph to the runtime (`GET api/flows/{id}`, normalised by `FlowNormalizer`). A long-lived Node process (`node/services/flowService.js` for WhatsApp, plus one `<channel>FlowService.js` per other channel) EXECUTES the graph. Node holds every live run ONLY in process memory (`app.locals.activeFlowSessions`, keyed `<senderDigits>_<customerDigits>`); there is no queue, no DB checkpoint and no scheduler. Delays are real `setTimeout` awaits inside an async call chain. Node calls back into Laravel over `X-Node-Token`-guarded HTTP endpoints for anything needing the database or secrets (AI keys, tags, assignment, deals, Google, MySQL proxy, commerce, ordering, inbox mirroring). Tenancy is carried by a `workspace_id` embedded in the flow payload.

The two engines: (1) the WhatsApp engine (Baileys "Unofficial API", WhatsApp Cloud API/WABA, Twilio) walks the NORMALISED graph (`flowNodeType` PascalCase, edges `<nodeId>_<port>`), keeps rich per-node semantics, and is the reference for behaviour; (2) the seven other-channel engines (Facebook, Instagram, TikTok, Telegram, LINE, Viber, WeChat, Email) are near-clones that walk the RAW builder graph (`type` lower-case, `sourceHandle`), support only message/media/buttons/ask/delay/condition/webhook/ai/end plus a few channel-specific nodes, and rely on Laravel bridges (`*FlowBridge`) for hand-off and `flow-node`/`flow-log`/`flow-send` callbacks.

Main flow end to end (WhatsApp): (a) a trigger fires - customer message matching a keyword, a tag/group/contact/opt-in/order/deal event, an away/out-of-hours inbound, a manual enroll, an API call, a routing rule, a campaign, or an operator "start flow"; (b) either `FlowEnrollmentService::enroll` creates/reuses a `flow_subscribers` row and POSTs Node `/api/flow/start/{senderPhone}`, or Node itself decides (keyword path) and starts the run directly with NO subscriber row; (c) Node fetches the graph, seeds variables, and executes `flowNodes[0]`; (d) each node sends messages, calls Laravel, waits (parks) for a reply or sleeps; (e) an inbound reply is decoded and routed to the parked node's branch; (f) the run ends at an End node, a dead-end, an error, a timeout or a process restart.

Plan tiers: there is NO runtime plan gate on executing flows. The `autoflow` package flag only drives the UI paywall overlay on `/flows*` pages (`config/plan_gates.php`); `flow_limit` caps flow creation (FLB); `flow_steps_limit` is defined but not enforced anywhere in the code read. Individual nodes have their own gates: deal node needs `access_sales_pipeline`; Facebook comment reply needs `facebook_comments`; Google nodes need the platform Google master toggle plus a connected workspace Google account; the WhatsApp branding footer is plan-driven.

HEADLINE FINDINGS the port team must know before reading the entries:

1. **Runs are never marked completed.** Nothing in Laravel or Node ever sets `flow_subscribers.status='completed'` or `completed_at`. Rows go `active` on enroll and stay `active` forever unless launch fails (`failed`) or an operator pauses. The analytics "Completed", "Completion rate" and "Avg time to complete" therefore read 0 / 0% / hidden in a stock install. See WD-FLR-051.
2. **Only enrollment-driven runs appear in analytics.** Keyword-triggered runs started by Node (Baileys inbound, WABA provider-inbound, routing-rule flows, campaign flows, the mobile app "start flow") create NO `flow_subscribers` row and are invisible to analytics, pause/resume and retry.
3. **All run state is in memory.** A Node restart, a device disconnect, the 30-minute sweeper (kills sessions older than one hour since start) or a second keyword drops the run silently. Effective maximum run lifetime is roughly 1-1.5 hours regardless of Delay nodes. See WD-FLR-015.
4. **A contact can be enrolled into a given flow only once** (UNIQUE flow_id+contact_id and enroll only relaunches on a fresh or failed row).
5. Several documented behaviours do not exist in code (docs say 1-hour idle window, Sub-flow "then come back", Tag step triggers tag_added flows, four trigger types only). Each is flagged where it occurs.

## Feature index

| Id         | Feature                                                                                                           | Status      | Priority | Effort | Depends on                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------- | ----------- | -------- | ------ | ---------------------------------- |
| WD-FLR-001 | Trigger model, activation gating and trigger columns                                                              | implemented | P0       | M      | —                                  |
| WD-FLR-002 | Keyword trigger on the Baileys (Unofficial API) inbound path                                                      | implemented | P0       | L      | WD-FLR-001, WD-FLR-014, WD-FLR-015 |
| WD-FLR-003 | Keyword trigger and reply routing on the WABA/Twilio provider bridge                                              | implemented | P0       | M      | WD-FLR-002                         |
| WD-FLR-004 | Managed keyword rule mirror and default-route (any message) trigger                                               | implemented | P0       | M      | WD-FLR-001                         |
| WD-FLR-005 | Audience triggers: tag added, group join, contact created, opt-in                                                 | implemented | P1       | M      | WD-FLR-011                         |
| WD-FLR-006 | Event triggers: order placed and deal stage changed                                                               | implemented | P1       | M      | WD-FLR-011                         |
| WD-FLR-007 | Inbound-condition triggers: away and out of hours                                                                 | implemented | P1       | M      | WD-FLR-011                         |
| WD-FLR-008 | Manual enrollment from the workspace UI                                                                           | implemented | P1       | S      | WD-FLR-011                         |
| WD-FLR-009 | Enrollment through the REST API (v1)                                                                              | implemented | P1       | S      | WD-FLR-011                         |
| WD-FLR-010 | Other launch paths: routing rule, campaign, mobile app, incoming webhook lead, dispatcher, cross-channel hand-off | implemented | P1       | M      | WD-FLR-011                         |
| WD-FLR-011 | Enrollment service and Node launch hand-off                                                                       | implemented | P0       | L      | WD-FLR-001                         |
| WD-FLR-012 | Trigger kinds with no working path (appointment_booked, comment_to_dm, forced flowId)                             | dead-code   | P2       | S      | WD-FLR-001                         |
| WD-FLR-013 | Runtime flow definition endpoint and graph normalisation contract                                                 | implemented | P0       | L      | —                                  |
| WD-FLR-014 | Run start and variable seeding                                                                                    | implemented | P0       | M      | WD-FLR-013                         |
| WD-FLR-015 | In-memory session store, expiry, sweepers and restart loss                                                        | implemented | P0       | L      | WD-FLR-014                         |
| WD-FLR-016 | Graph traversal: ports, pacing, dead ends, End node and loop guard                                                | implemented | P0       | L      | WD-FLR-013                         |
| WD-FLR-017 | Variable model and merge-tag interpolation                                                                        | implemented | P0       | M      | WD-FLR-014                         |
| WD-FLR-018 | Inbound reply decoding and routing to the waiting node                                                            | implemented | P0       | L      | WD-FLR-016                         |
| WD-FLR-019 | Engine selection and outbound send layer (Baileys, WABA, Twilio)                                                  | implemented | P0       | L      | WD-FLR-016                         |
| WD-FLR-020 | Baileys anti-ban gates: socket liveness and daily cap                                                             | implemented | P1       | S      | WD-FLR-019                         |
| WD-FLR-021 | Message, Sequence and Media nodes                                                                                 | implemented | P0       | M      | WD-FLR-019                         |
| WD-FLR-022 | Ask (Question) node                                                                                               | implemented | P0       | M      | WD-FLR-018                         |
| WD-FLR-023 | Buttons node                                                                                                      | implemented | P0       | M      | WD-FLR-018                         |
| WD-FLR-024 | List node                                                                                                         | implemented | P0       | M      | WD-FLR-018                         |
| WD-FLR-025 | Poll node                                                                                                         | partial     | P2       | S      | WD-FLR-018                         |
| WD-FLR-026 | Template node                                                                                                     | implemented | P1       | M      | WD-FLR-019                         |
| WD-FLR-027 | CTA and Location nodes                                                                                            | implemented | P1       | S      | WD-FLR-019                         |
| WD-FLR-028 | Condition node and operator semantics                                                                             | implemented | P0       | M      | WD-FLR-017                         |
| WD-FLR-029 | Delay node                                                                                                        | implemented | P0       | S      | WD-FLR-016                         |
| WD-FLR-030 | AI (ChatGPT) node, conversation mode, extraction and the ai-call endpoint                                         | implemented | P1       | L      | WD-FLR-017                         |
| WD-FLR-031 | Chatbot (AI agent hand-off) and Sub-flow nodes                                                                    | partial     | P1       | M      | WD-FLR-016                         |
| WD-FLR-032 | Webhook node and SSRF guard                                                                                       | implemented | P1       | M      | WD-FLR-017                         |
| WD-FLR-033 | Code (JavaScript) node and sandbox                                                                                | implemented | P1       | L      | WD-FLR-017                         |
| WD-FLR-034 | MySQL query node                                                                                                  | implemented | P2       | S      | WD-FLR-017                         |
| WD-FLR-035 | Tag contact node                                                                                                  | partial     | P1       | S      | WD-FLR-016                         |
| WD-FLR-036 | Assign agent node                                                                                                 | implemented | P1       | S      | WD-FLR-016                         |
| WD-FLR-037 | Deal node                                                                                                         | implemented | P1       | S      | WD-FLR-016                         |
| WD-FLR-038 | Copy-to-number (Notify number) node                                                                               | implemented | P2       | S      | WD-FLR-019                         |
| WD-FLR-039 | WhatsApp-to-Instagram link node                                                                                   | implemented | P2       | S      | WD-FLR-019                         |
| WD-FLR-040 | Book appointment node                                                                                             | implemented | P1       | L      | WD-FLR-018                         |
| WD-FLR-041 | Commerce shop node (WhatsApp Shop, WooCommerce, Shopify)                                                          | implemented | P1       | L      | WD-FLR-018                         |
| WD-FLR-042 | Natural-language ordering endpoints used by flows                                                                 | implemented | P2       | M      | WD-FLR-032                         |
| WD-FLR-043 | WhatsApp Form node and form-submission resume                                                                     | implemented | P1       | M      | WD-FLR-018                         |
| WD-FLR-044 | Google Sheets node                                                                                                | implemented | P1       | M      | WD-FLR-017                         |
| WD-FLR-045 | Google Docs node                                                                                                  | implemented | P2       | S      | WD-FLR-017                         |
| WD-FLR-046 | Google Form node and response webhook                                                                             | partial     | P2       | M      | WD-FLR-018                         |
| WD-FLR-047 | Google Meet node                                                                                                  | implemented | P2       | S      | WD-FLR-019                         |
| WD-FLR-048 | AI voice call node                                                                                                | implemented | P2       | S      | WD-FLR-016                         |
| WD-FLR-049 | Inbound media capture and the store-media endpoint                                                                | implemented | P1       | S      | WD-FLR-018                         |
| WD-FLR-050 | Ending a run from outside (agent takeover, device removal)                                                        | implemented | P1       | S      | WD-FLR-015                         |
| WD-FLR-051 | Run record lifecycle and statuses (flow_subscribers)                                                              | partial     | P0       | M      | WD-FLR-011                         |
| WD-FLR-052 | Subscriber list, counts, pause and resume                                                                         | implemented | P1       | S      | WD-FLR-051                         |
| WD-FLR-053 | Flow analytics page: KPIs, trend, status mix, leaderboard                                                         | partial     | P1       | L      | WD-FLR-051                         |
| WD-FLR-054 | Execution history table                                                                                           | implemented | P1       | M      | WD-FLR-053                         |
| WD-FLR-055 | Error logs: grouped failure reasons                                                                               | implemented | P1       | M      | WD-FLR-053                         |
| WD-FLR-056 | Retry records table                                                                                               | implemented | P1       | S      | WD-FLR-057                         |
| WD-FLR-057 | Retry one failed run                                                                                              | implemented | P1       | M      | WD-FLR-011, WD-FLR-051             |
| WD-FLR-058 | Bulk retry of failed runs                                                                                         | implemented | P1       | S      | WD-FLR-057                         |
| WD-FLR-059 | Concurrency, idempotency and race behaviour (cross-cutting)                                                       | implemented | P0       | M      | WD-FLR-015                         |
| WD-FLR-060 | Shared multi-channel flow engine contract and Laravel callbacks                                                   | implemented | P1       | L      | WD-FLR-013                         |
| WD-FLR-061 | Facebook Messenger flow engine                                                                                    | implemented | P1       | M      | WD-FLR-060                         |
| WD-FLR-062 | Instagram flow engine                                                                                             | implemented | P1       | M      | WD-FLR-060                         |
| WD-FLR-063 | TikTok flow engine                                                                                                | implemented | P2       | S      | WD-FLR-060                         |
| WD-FLR-064 | Telegram flow engine and payment node                                                                             | implemented | P1       | M      | WD-FLR-060                         |
| WD-FLR-065 | LINE flow engine                                                                                                  | implemented | P2       | S      | WD-FLR-060                         |
| WD-FLR-066 | Viber flow engine                                                                                                 | implemented | P2       | S      | WD-FLR-060                         |
| WD-FLR-067 | WeChat flow engine                                                                                                | implemented | P2       | S      | WD-FLR-060                         |
| WD-FLR-068 | Email flow engine                                                                                                 | implemented | P2       | M      | WD-FLR-060                         |
| WD-FLR-069 | Call-flow (voice IVR) runtime                                                                                     | implemented | P2       | M      | WD-FLR-013                         |
| WD-FLR-070 | Database flow-session tables for LINE, Telegram, Viber, WeChat                                                    | dead-code   | P2       | S      | —                                  |
| WD-FLR-071 | Runtime regression suite (node/test) as acceptance reference                                                      | implemented | P1       | M      | WD-FLR-028                         |

## Features

### WD-FLR-001 — Trigger model, activation gating and trigger columns

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** none
- **Summary:** Every flow has exactly one trigger described by four columns on `flows`: `trigger_kind`, `trigger_value`, `trigger_device_id` and `trigger_keywords`, plus a `provider` engine stamp. These columns are what Laravel queries to decide which flows a tag, group, order, deal stage, inbound condition or keyword should start, without decrypting `flow_data`. A flow only starts anything while it is BOTH published and active.
- **Actors & access:** written by the flow-save path (FLB, admin role); read by every trigger hook. No permission key at runtime. Seeded permission keys `flows.view/create/edit/delete` exist but no code path checks them (routes only require workspace role admin).
- **UX & screens:** the trigger inspector lives in the builder (FLB). Docs describe four types (keyword, tag added, group join, manual enroll); code accepts thirteen (see Data). Flow state shown everywhere: draft (`is_published=0`), live (`is_published=1` and `is_active=1`), paused (`is_published=1` and `is_active=0`).
- **Endpoints:** none of its own. Columns are produced by `FlowsController::apiSave` -> `extractTriggerColumns` (FLB) and consumed by the services in this domain.
- **Data:** `flows.trigger_kind` varchar(24) NOT NULL default `keyword`; allowed values (`Flow::TRIGGER_KINDS`): `keyword`, `tag_added`, `group_join`, `manual_enroll`, `contact_created`, `opt_in`, `order_placed`, `appointment_booked`, `deal_stage_changed`, `away`, `out_of_hours`, `comment_to_dm`. An unknown kind coming from the trigger node silently becomes `keyword`. `trigger_value` bigint NULL: tag id (tag_added), contact_group id (group_join), pipeline stage id (deal_stage_changed); stored as `0` for value-less event kinds (`contact_created`, `opt_in`, `order_placed`, `away`, `out_of_hours`, and `comment_to_dm`); NULL for keyword/manual_enroll. `trigger_device_id` bigint NULL is POLYMORPHIC: the trigger node stores the sender as `engine:id` (`baileys:5`, `waba:3`, `twilio:7`, `instagram:82`, `facebook`, `tiktok`, `telegram`, `line`, `wechat`, `viber`, `email`); the engine half goes to `flows.provider`, the id half to `trigger_device_id`; a bare integer (pre-picker flows) sets only the id and leaves `provider` untouched. `trigger_keywords` varchar(1000): comma-separated keyword string for keyword flows, the literal `any` for the default route (see WD-FLR-004), or a CSV of `keyword_replies` ids for `comment_to_dm`. `provider` varchar(16) NOT NULL default `baileys`, auto-stamped on create from the workspace engine (`WorkspaceEngine::for`). `flow_type` varchar(16) default `chat` (`chat`, `call`, `instagram`, `facebook`, `tiktok`, `telegram`, `line`, `wechat`, `viber`, `email`). `is_published`, `is_active` booleans (default 0 and 1). Index `flows_trigger_idx (trigger_kind, trigger_value)`.
- **Rules & edge cases:**
  1. Every enrollment trigger queries `is_active=1 AND is_published=1 AND trigger_kind=? AND trigger_value=?` (value compared as integer; NULL never matches, hence the `0` convention). A draft or paused flow never enrolls anyone.
  2. Workspace scoping of enrollment lookups: `flowsForWorkspace` filters `workspace_id` directly (order, deal, away/out-of-hours). `flowsForContact` (tag, group, contact-created, opt-in) resolves the contact's OWNER user, takes all workspaces that user belongs to plus `current_workspace_id`, and matches flows in ANY of them, so a flow in a workspace other than the contact's own can enroll that contact if the contact owner belongs to both. Port should scope by the contact's workspace only.
  3. Saving a flow triggers the managed keyword-rule resync (WD-FLR-004) on every save/publish/toggle/delete.
  4. Trigger sender binding rule: the flow uses the bound sender only when the bound device is still active and belongs to the flow's workspace (WD-FLR-011).
  5. There is no uniqueness rule: several flows may share the same tag/group/keyword; each one enrolls independently, in query order (no explicit ordering; DB default).
  6. Provider is not re-derived when the workspace later switches engine; the flow keeps its stamped provider.
- **Async & events:** `Flow::saved` and `Flow::deleted` model events resync/delete the managed keyword rule (WD-FLR-004). No queue.
- **External systems:** none.
- **Settings:** none. Package flags: `autoflow` (UI paywall only), `flow_limit` (create cap, FLB).
- **Acceptance criteria:**
  - Given a flow saved with trigger kind `tag_added` and tag 7, when tag 7 is attached to a contact, then the contact is enrolled only if the flow is published and active.
  - Given a trigger node with an unrecognised kind, when the flow is saved, then `trigger_kind` is stored as `keyword`.
  - Given a trigger sender key `waba:3`, when saved, then `provider='waba'` and `trigger_device_id=3`.
  - Given an `order_placed` flow, then `trigger_value` is `0` (not NULL) so the lookup matches.
- **Source refs:** app/Models/Flow.php, app/Http/Controllers/FlowsController.php (extractTriggerColumns), app/Services/Flow/FlowEnrollmentService.php (flowsForWorkspace, flowsForContact), config/plan_gates.php, database/migrations/2026_05_24_090000_merge_drip_into_flows.php, database/migrations/2026_06_21_000000_add_flow_type_to_flows.php, Documentation/pages/automation/flows.html
- **Port notes:** target module `apps/api/src/modules/flows` (shared with FLB; FLR owns the trigger evaluation service). Replace the polymorphic `trigger_device_id` with a proper `trigger_sender_kind` + `trigger_sender_id` pair. Add `workspace_id NOT NULL` and RLS on `flows`. Make `trigger_value` a nullable typed column and index `(workspace_id, trigger_kind, trigger_value) WHERE published AND active`.

### WD-FLR-002 — Keyword trigger on the Baileys (Unofficial API) inbound path

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks)
- **Depends on:** WD-FLR-001, WD-FLR-014, WD-FLR-015
- **Summary:** When a customer messages a Baileys-connected number, Node first resumes a parked flow if one is waiting, otherwise asks Laravel whether the text matches a keyword rule that launches a flow, and starts it directly. A typed trigger keyword always restarts the flow, even mid-flow or during a cooldown.
- **Actors & access:** end customer (inbound WhatsApp message on an Unofficial-API device). No plan/permission gate in Node; Laravel's matcher (`api/keyword-replies`, AR domain) applies rule status, flow live check and message-quota billing.
- **UX & screens:** none (server-side). Operator sees the outbound flow messages mirrored into the Team Inbox as `source='flow'`.
- **Endpoints:**

| Method uri                                                    | Route name             | Handler                                | Middleware         | Request                                                                                   | Response                                                                                                 |
| ------------------------------------------------------------- | ---------------------- | -------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| GET api/keyword-replies?keyword=&mobile=&phone=[&media_type=] | keyword-replies.lookup | AutoReplyController@lookup (AR domain) | api + X-Node-Token | keyword lowercased/trimmed; `mobile` = `<digits>@s.whatsapp.net`; `phone` = device number | JSON array; element 0 has `reply_type` (`flow`), `flow_id`, `timeout`, `cooldown`, or `reply='notallow'` |

- **Data:** reads Node `activeFlowSessions`, `userCooldowns`; writes new session (WD-FLR-014). No DB write for the run itself.
- **Rules & edge cases:**
  1. Order of decisions per inbound message (Node `BaileysClientManager`): forward inbound to Laravel (routing rules may return `routing_actions.flow_id`, which starts that flow with timeout 600 and cooldown 0) -> look up session by `<devicePhone>_<customerPhone>` -> if session is `active` AND `waitingForInput`: (a) if the message is NOT an interactive tap and the typed text equals the session's original trigger text (`triggerKeyword`) restart that flow immediately with no HTTP lookup; (b) else ask the keyword endpoint - a `flow` match (same or different flow) restarts; (c) a persistent-menu session with non-keyword typed text is ignored (menu stays open, idle timer refreshed); (d) otherwise `handleFlowResponse`. After handling, the idle timer is re-armed. -> if no waiting session: check cooldown, look up keyword; no match -> stop.
  2. A `flow` keyword match ALWAYS starts (or restarts) the flow, ignoring cooldown. The cooldown gate applies only to NON-flow replies (custom text, share contact, catalog, location request), which are dropped while `userCooldowns[sessionKey]` is in the future. So a flow's `cooldown` value never throttles flows; it only throttles other canned replies for that customer.
  3. Interactive taps (buttons/template/list/native-flow response) are never treated as keywords.
  4. Default timeout 600 s and default cooldown 0 when the rule has none (managed flow-trigger rules leave both NULL).
  5. Media-order fallback: an inbound image or audio with empty text is still sent to the lookup with `media_type`, so a device flow can start on a photo/voice order.
  6. The awaited start (`handleFlowAutoReply`) runs the first nodes inline inside the inbound loop, so a Delay or slow API call at the head of a flow blocks processing of later messages in the same batch.
  7. No subscriber row is created on this path (see WD-FLR-051).
  8. A lookup failure (HTTP error) is swallowed: no match, no flow.
- **Async & events:** none queued. Inline awaits. Session idle timer (WD-FLR-015).
- **External systems:** Laravel `api/keyword-replies`.
- **Settings:** per-rule `timeout` (idle seconds, default 600) and `cooldown` (seconds) columns on `keyword_replies` (AR). Env `NODE_WEBHOOK_TOKEN`, `APP_DOMAIN_NAME`.
- **Acceptance criteria:**
  - Given a published, active keyword flow "hi" bound to a device, when the customer sends "Hi", then a session `<device>_<customer>` is created and the first node executes.
  - Given a session waiting on an Ask node, when the customer re-types "hi", then the flow restarts from the first node (the Ask does not capture "hi").
  - Given a customer tapping a button of the current menu, then the tap is routed to the button branch and never treated as a keyword.
  - Given a customer in a 60 s cooldown who types the flow keyword, then the flow still starts; a custom text rule would be suppressed.
  - Given a paused flow, then the lookup returns `notallow` and nothing starts.
- **Source refs:** node/classes/BaileysClientManager.js (handleIncoming block, checkKeywordReply, handleFlowAutoReply, isInCooldown, setCooldown, setFlowTimeout), node/routes/index.js, app/Http/Controllers/AutoReplyController.php (lookup, flow live check), app/Services/Flow/FlowEnrollmentService.php
- **Port notes:** the port should not have Node hold the decision. Suggested: inbound processor in `apps/api/src/modules/flows/runtime` receives the normalised inbound event from the device adapter (WADEV), resolves waiting run from Postgres, applies keyword resolution (AR service) and enqueues a BullMQ `flow.advance` job. Keep the restart-on-keyword and cooldown-only-for-non-flow semantics unless product decides otherwise.

### WD-FLR-003 — Keyword trigger and reply routing on the WABA/Twilio provider bridge

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** WD-FLR-002
- **Summary:** WABA (Cloud API) and Twilio inbound messages reach Laravel by webhook, not Node. Laravel forwards each real customer action to Node `POST /api/flow/provider-inbound`; Node synchronously answers `consumed` (true if a flow took the message) so Laravel can skip keyword auto-reply and the AI agent, then runs the flow detached with `sock=null`.
- **Actors & access:** end customer; Laravel `WaWebhookController` -> Node. Auth: `X-Node-Token` (Node global `/api` guard also accepts loopback unless `NODE_API_AUTH=token`).
- **UX & screens:** none.
- **Endpoints:**

| Method uri                             | Route name | Handler                                | Middleware   | Request                                                                                                                               | Response                                                            |
| -------------------------------------- | ---------- | -------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| POST /api/flow/provider-inbound (Node) | -          | providerFlowController.providerInbound | X-Node-Token | `deviceNumber`, `customerPhone`, `workspaceId`, `provider`, `text`, `replyId`, `pushName`, `mediaUrl`, `mediaType`, optional `flowId` | 202 `{ok, consumed}`; 400 if device/customer missing; 401 bad token |

- **Data:** Node session (key `<deviceDigits>_<customerDigits>`), `provider` stored on session.
- **Rules & edge cases:**
  1. Laravel only forwards when there is real content: text non-empty, or an interactive tap id, or media that is not just a reaction; `unsupported`/`system` message types and empty payloads are skipped (otherwise a parked AI node would be resumed with empty input and auto-reply).
  2. Location pins are forwarded as text (any place name + a Google Maps link built from lat/lng).
  3. The tap id is taken from interactive button reply, list reply or template button payload.
  4. Node resumes when a session exists, is `active`, is waiting, and the message has content (typed text or tap).
  5. Keyword resolution for typed text only (never a tap): fast path when text equals the session's stored trigger text; else calls `GET api/keyword-replies` with `keyword`, `mobile`, `phone`; the first array element with `reply_type='flow'` and a `flow_id` wins; its `timeout` (default 600) and `cooldown` (default 0) are read.
  6. A matched keyword overrides resume (restart): the old idle timer is cleared and a fresh session is seeded.
  7. `forcedFlowId` (a caller-supplied `flowId` that skips lookup) is implemented in Node but no Laravel caller sends it (dead path).
  8. `consumed = isResume || flowId matched`; response is 202 sent BEFORE execution; the flow then runs fire-and-forget.
  9. Unconsumed messages continue in Laravel: `KeywordReplyDispatcher::maybeDispatch`, then AI agent. That dispatcher enrolls the contact into `reply_type=flow` rules through `FlowEnrollmentService::enroll` (once per contact, WD-FLR-010).
  10. Idle timeout: after start or resume, `clearSessionLater` (clamped 30..3600 s, default 600) deletes the session only if it is NOT waiting for input, so a parked wait is not expired by this timer (unlike Baileys, WD-FLR-015).
  11. `cooldownSeconds` is stored on the session but nothing on this path enforces a cooldown.
  12. A device number equal to the customer number logs a warning (self-send).
- **Async & events:** detached async IIFE after the 202.
- **External systems:** Laravel keyword endpoint, `api/flows/{id}`, `api/workspace-attributes/{id}`, plus per-node callbacks.
- **Settings:** `baileys_server_url` system setting or `SERVER_URL` env (Laravel -> Node URL); `NODE_WEBHOOK_TOKEN`.
- **Acceptance criteria:**
  - Given a WABA workspace and a keyword flow rule, when the customer texts the keyword, then Laravel receives `consumed=true`, does not send a keyword auto-reply or AI reply, and the first node message is sent through the Cloud API.
  - Given a session waiting on Buttons and a webhook with only a reaction event, then no flow call is made.
  - Given a parked Ask node and the customer types the trigger keyword, then the flow restarts.
  - Given the customer types unrelated text with no session and no keyword match, then `consumed=false`.
- **Source refs:** node/controllers/providerFlowController.js, app/Http/Controllers/WaWebhookController.php (flow bridge block ~1790-1875), app/Services/Inbox/KeywordReplyDispatcher.php, node/routes/index.js
- **Port notes:** the `consumed` handshake is the anti-double-reply contract; in the port the inbound pipeline should call the flow engine FIRST and stop the chain when a run consumed the message. Store the trigger text on the run row to preserve the fast restart path.

### WD-FLR-004 — Managed keyword rule mirror and default-route (any message) trigger

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** WD-FLR-001
- **Summary:** A keyword trigger typed into the flow's trigger node has to be visible to the inbound matcher, which only reads `keyword_replies`. On every flow save the model deletes and recreates a "managed" `keyword_replies` row (`reply_type='flow'`, `is_flow_trigger=1`) mirroring the flow. A special mode "any message" becomes a catch-all row that only fires when no keyword matched.
- **Actors & access:** automatic on flow save/publish/pause/unpublish/delete (Eloquent `saved` and `deleted` events).
- **UX & screens:** managed rules appear in the `/auto-reply` list (AR) under the flow's engine; Instagram flows appear in Instagram automations instead.
- **Endpoints:** none (model events). Matching endpoint is `GET api/keyword-replies` (AR).
- **Data:** writes `keyword_replies`: `user_id`, `workspace_id`, `device_id` (= `flows.trigger_device_id`), `provider` (flow provider or workspace engine), `keyword` (the raw comma string, or `''` for catch-all), `matching_method` `contains` (keyword) or `exact` (catch-all), `is_catch_all`, `fuzzy_similarity` 80, `reply_type='flow'`, `flow_id`, `is_flow_trigger=1`, `message_type='text'`, `status` = published AND active. For Instagram flows writes `instagram_automations` (`type='flow'`, `trigger_keyword`, `match_mode` `contains`|`any`, `is_active`).
- **Rules & edge cases:**
  1. Idempotent: any previous managed row for the flow (including soft-deleted) is force-deleted first, then recreated.
  2. Only for `trigger_kind='keyword'`; other kinds end after the delete.
  3. Facebook, TikTok, Telegram and Email flows create NO `keyword_replies` row (their ingest services query `flows` directly and a row would double-fire or collide by id). Instagram gets the `instagram_automations` equivalent and needs a trigger account belonging to the workspace, else it is skipped.
  4. WhatsApp keyword flow needs non-empty keywords and a workspace id; else skipped with a warning (no rule).
  5. `keywords` longer than 255 characters (the column width) throws a RuntimeException with a human message; the save/publish endpoint returns it as a 422 field error so the operator sees the real reason.
  6. Catch-all spellings accepted as input: `*`, `.*`, `.+`, `any` (case-sensitive exact match on the trimmed string). The trigger node's "any" mode is stored as the literal `any`.
  7. `device_id` NULL means the managed rule is workspace-wide only in the sense the matcher scopes by workspace; the code logs that a NULL device may match nothing on device-scoped matchers.
  8. The row is only ACTIVE while the flow is published and active; the lookup additionally re-checks the flow is live.
  9. Deleting a flow force-deletes the managed rule and its Instagram automation.
  10. Matching order (AR): exact/contains, translated, fuzzy, media-order fallback (excludes catch-alls), then the catch-all default route with device-bound rules first then lowest id. So a default-route flow can never outrank a keyword flow.
- **Async & events:** synchronous inside the save transaction; a failure re-throws so save/publish fails visibly.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a WhatsApp flow with keywords "book, appointment", when it is published, then one managed active rule exists with `contains` matching and the flow id.
  - Given the same flow paused, then the rule exists with status false.
  - Given a Facebook flow, then no keyword row is created.
  - Given trigger keywords of 300 characters, then save fails with a message naming the 255 limit.
  - Given "any message" mode and another flow with keyword "book", when the customer sends "book", then the keyword flow starts, not the default route.
- **Source refs:** app/Models/Flow.php (booted, syncKeywordTriggerReply, syncInstagramTriggerAutomation), app/Http/Controllers/FlowsController.php (extractTriggerColumns), app/Http/Controllers/AutoReplyController.php (lookup pass 1/2), database/migrations/2026_06_19_000400_flow_keyword_trigger_sync.php
- **Port notes:** do not port the "shadow keyword row" hack. Model a keyword trigger as first-class data (`flow_triggers` rows: kind, params) and let the AR matcher query flow triggers directly with a tier order (keyword, fuzzy, media, catch-all). Keep the catch-all-is-last tier and the live check.

### WD-FLR-005 — Audience triggers: tag added, group join, contact created, opt-in

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** WD-FLR-011
- **Summary:** Flows enroll contacts automatically when a tag is attached, a contact is added to a group, a contact is created, or a contact re-subscribes.
- **Actors & access:** automatic; the actors are whoever attaches the tag (contacts UI, bulk import, team inbox tagging, routing rule) or creates the contact.
- **UX & screens:** none.
- **Endpoints:** hooks (not routes): `ContactsController::attachTag` and bulk attach -> `onTagAdded`; `TeamInboxController::tag` and `RoutingEngine add_tag` -> `onConversationTagged`; `Contact::created/updated` model events -> `onContactCreated`, `onGroupJoin`, `onOptIn`.
- **Data:** reads `flows`; writes `flow_subscribers` via WD-FLR-011.
- **Rules & edge cases:**
  1. `tag_added`: matches `trigger_value = tag id`. Conversation-level tagging (team inbox or routing rule) first resolves the customer: digits of `conversation.raw_jid` -> scan all workspace contacts (mobile is encrypted, compared in PHP after canonicalising country code + mobile) -> if found, behaves like a contact tag. No matching contact means nothing happens.
  2. `group_join`: contacts store groups as an encrypted JSON array of group ids on the contact. Fired on create for every group id in the array, and on update for ids ADDED (diff between decrypted original and new). Removed groups do nothing.
  3. `contact_created`: fired on every Contact `created` event with value 0. Bulk imports and the mobile-app contact sync deliberately suppress model events (`withoutEvents`) so a bulk import does not blast a flow to everyone.
  4. `opt_in`: fired when `is_unsubscribed` changes true -> false.
  5. All hooks are best-effort: exceptions are logged as warnings and never break the tag/contact operation; each flow enroll is individually try/caught.
  6. Enrollment is idempotent per (flow, contact) (WD-FLR-011), so re-adding the same tag does nothing after the first launch.
  7. Hooks run synchronously inside the originating request; the Node HTTP hand-off has a 15 s timeout, so tagging many contacts in one request can be slow.
  8. The Flow "Tag" node and AI Agent tagging do NOT fire this trigger (WD-FLR-035).
- **Async & events:** none queued.
- **External systems:** Node `/api/flow/start` (via WD-FLR-011).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a live `tag_added` flow for tag "VIP", when an operator attaches VIP to a contact with a valid number, then a subscriber row exists and Node receives a start call.
  - Given a contact whose groups change from [1] to [1,2], then only `group_join` flows for group 2 fire.
  - Given a bulk CSV import of 500 contacts, then no `contact_created` flow fires.
  - Given a contact that unsubscribed and re-subscribes, then `opt_in` flows fire once.
- **Source refs:** app/Services/Flow/FlowEnrollmentService.php, app/Models/Contact.php (booted hooks), app/Http/Controllers/ContactsController.php (attachTag, bulk), app/Http/Controllers/TeamInboxController.php (tag), app/Services/Inbox/RoutingEngine.php (add_tag), app/Http/Controllers/WaWebhookController.php (event suppression)
- **Port notes:** publish domain events (`contact.created`, `contact.tag_added`, `contact.group_joined`, `contact.opted_in`) through the outbox and let a `flows` consumer enrol, with per-import suppression flag on the event. Keep workspace-scoped lookup; avoid the decrypt-and-scan phone resolution by storing a hashed canonical phone.

### WD-FLR-006 — Event triggers: order placed and deal stage changed

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** WD-FLR-011
- **Summary:** A new commerce order starts `order_placed` flows for the customer's contact, exposing order merge tags; a deal entering a pipeline stage starts `deal_stage_changed` flows for the deal's contact.
- **Actors & access:** automatic (order creation via storefront/checkout/WooCommerce/Shopify/WhatsApp order; deal moved by user, flow or automation).
- **UX & screens:** none.
- **Endpoints:** model hooks: `WaOrder::created` (deferred to after the response via `app()->terminating`) -> `onOrderPlaced`; `Deal::updated` when `stage_id` changed -> `onDealStageChanged`.
- **Data:** reads `wa_orders` (customer_phone, customer_name, customer_email, total_minor, currency_code, status, payment_link, meta_json), `deals`, `contacts`, `flows`.
- **Rules & edge cases:**
  1. `order_placed`: contact is resolved by canonical phone inside the order's workspace; NO saved contact means nothing is enrolled (no contact is auto-created). Flows matched: workspace, published, active, kind `order_placed`, value 0.
  2. Variables passed to Node and merged over seeded ones: `name`, `first_name`, `email`, `order_number` (meta order_number else id), `order_name` (`#`+number), `total` ("12.50 USD"), `total_price` (major units, 2 decimals), `currency`, `status`, `invoice_url` (meta invoice_url else payment link), `order_url`, `payment_link`. Empty values are dropped so a missing tag renders blank.
  3. `deal_stage_changed`: needs `deal.contact_id`; matches flows whose `trigger_value` equals the NEW stage id, in the deal's workspace; created deals do not fire (only stage change on update); creating a deal from a flow's Deal node in the target stage does not fire either (create path), moving does.
  4. Because the Deal node itself can move a deal into a stage that triggers another flow, flow-to-flow chains are possible; there is no cycle guard.
  5. Enrollment is once per (flow, contact): a second order from the same customer does NOT re-run the `order_placed` flow.
- **Async & events:** order hook deferred post-response; deal hook synchronous.
- **External systems:** Node start call.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active order_placed flow and an order from a phone matching a saved contact, then the flow starts and `{{order_number}}` renders.
  - Given an order from an unknown phone, then no enrollment.
  - Given a deal moved to stage 12 and a live flow with trigger_value 12, then the contact is enrolled.
  - Given the same customer placing a second order, then the flow does not run again.
- **Source refs:** app/Services/Flow/FlowEnrollmentService.php (onOrderPlaced, orderFlowVariables, onDealStageChanged), app/Models/WaOrder.php, app/Models/Deal.php
- **Port notes:** the "once per contact per flow" rule makes order flows nearly useless for repeat buyers; the port should decide explicitly (allow re-entry per order via a run key of (flow, contact, trigger_ref)). Keep the merge-tag set.

### WD-FLR-007 — Inbound-condition triggers: away and out of hours

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** WD-FLR-011
- **Summary:** While the workspace is in Away mode or outside its business hours, any inbound message launches the matching `away` / `out_of_hours` flows for that customer (once per contact).
- **Actors & access:** automatic on every inbound path; configured in workspace settings (`inbox_away`, `business_hours`).
- **UX & screens:** none.
- **Endpoints:** called from `AutoReplyController::autoResponderReplyForBaileys` (Baileys) and `KeywordReplyDispatcher::maybeDispatch` (WABA, Twilio, Instagram dispatcher) via `FlowEnrollmentService::onInboundMessage(workspaceId, phoneDigits)`.
- **Data:** reads `workspaces.inbox_away`, `workspaces.business_hours` JSON (`days.<mon..sun>.{enabled,from,to}`), `workspaces.timezone`; creates a minimal `contacts` row when none exists.
- **Rules & edge cases:**
  1. Fast path: `inboundFlowKinds` returns `away` if `inbox_away`, and `out_of_hours` if `isOutsideBusinessHours()`; empty -> return before any flow query.
  2. Business hours: no config or no `days` = always open; a day missing or disabled = closed all day; compares "HH:mm" strings: outside when `< from` or `>= to`; timezone = workspace timezone else app timezone. No overnight-range support (from > to makes every time closed or open depending on comparison).
  3. Flows matched: workspace, published, active, kind in eligible kinds, value 0. Both kinds can be eligible at once (flows merged).
  4. Contact resolution: canonical-phone scan of workspace contacts; if none, a contact is created with name = digits, mobile = digits, owner = workspace owner (this fires `contact_created`).
  5. Idempotent through UNIQUE(flow, contact): each contact launches each away flow once ever, not once per away period.
  6. Suppressed when Meta Business Agent coexistence is fronting the workspace (WD-FLR-011).
  7. Errors are swallowed and logged.
- **Async & events:** synchronous in the inbound webhook.
- **External systems:** Node start call.
- **Settings:** workspace `inbox_away` flag; `business_hours`; `timezone`.
- **Acceptance criteria:**
  - Given Away mode on and a live away flow, when a new customer messages, then a contact is created, enrolled and the flow starts once.
  - Given the same customer messages again, then nothing re-fires.
  - Given business hours Mon 09:00-17:00 and a message Monday 18:00, then out_of_hours flows are eligible.
  - Given in-hours and Away off, then no flow query happens.
- **Source refs:** app/Services/Flow/FlowEnrollmentService.php (onInboundMessage, inboundFlowKinds, makeInboundContact), app/Models/Workspace.php (isOutsideBusinessHours), app/Http/Controllers/AutoReplyController.php, app/Services/Inbox/KeywordReplyDispatcher.php
- **Port notes:** Once-per-contact-ever is likely unintended for Away; recommend re-arming after N hours or per day. Handle overnight ranges and holiday overrides. Contact creation side effect must go through CON service.

### WD-FLR-008 — Manual enrollment from the workspace UI

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-FLR-011
- **Summary:** An admin enrolls chosen contacts, or every contact in a named group, into a flow from the flow's detail panel; the docs call these "manual enroll" flows but the endpoint works for any active flow.
- **Actors & access:** workspace role admin (`EnsureWorkspaceRole:admin`). Flow must be active.
- **UX & screens:** action lives in the flows list detail panel (FLB `user/flows/index.blade.php` / `user-flows-index.js`); not a separate screen.
- **Endpoints:**

| Method uri             | Route name        | Controller@action         | Middleware                              | Request                                                                      | Response                                                                 |
| ---------------------- | ----------------- | ------------------------- | --------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| POST flows/{id}/enroll | user.flows.enroll | FlowsController@apiEnroll | Authenticate, EnsureWorkspaceRole:admin | `contact_ids[]` int array (nullable), `group_name` string max 191 (nullable) | `{ok:true, enrolled, failed}`; 404 `flow_not_found`; 422 `flow_inactive` |

- **Data:** reads `flows`, `contacts` (workspace-scoped); writes `flow_subscribers`.
- **Rules & edge cases:**
  1. Flow looked up with `forCurrentWorkspace` (workspace id, or legacy NULL-workspace rows by creator).
  2. `is_active` must be true; being unpublished does NOT block manual enrollment (only `is_active` is checked here), unlike automatic triggers.
  3. `contact_ids` wins over `group_name`. Contacts must belong to the flow's workspace (`whereIn id` and `workspace_id`); foreign ids are silently ignored.
  4. `group_name` compares the NAME against each contact's group array in PHP; but contacts store group IDs, not names, so name matching only works if names were stored (likely never matches - Open question).
  5. Each contact is enrolled in a try/catch; counts `enrolled` (no exception) vs `failed` (exception). A no-op on an already-enrolled contact still counts as enrolled. Launch failures do not throw; they mark the subscriber failed and are NOT counted as failed here.
  6. No cap on the number of contacts; runs synchronously with a 15 s Node timeout each.
  7. If neither field is provided the response is `enrolled:0, failed:0`.
- **Async & events:** none queued; per-contact synchronous Node POST.
- **External systems:** Node start.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active flow and 3 workspace contacts, when POST with their ids, then 3 subscriber rows exist and the response says enrolled 3.
  - Given an inactive flow, then 422 `flow_inactive`.
  - Given a contact id from another workspace, then it is ignored.
  - Given a contact already enrolled, then no second launch occurs.
- **Source refs:** app/Http/Controllers/FlowsController.php (apiEnroll), routes/web.php (~1160-1190), Documentation/pages/automation/flows.html
- **Port notes:** batch large enrolls as a BullMQ job with progress; return a job id. Replace group-name matching with group id. Enforce a per-request cap.

### WD-FLR-009 — Enrollment through the REST API (v1)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-FLR-011
- **Summary:** API-key clients list flows, read one flow, enroll a contact by id or phone, and list a flow's subscribers. Route ownership is the `developer-rest-api-v1` domain (API); the behaviour is recorded here because it reuses the enrollment pipeline.
- **Actors & access:** API key (`AuthenticateApiKey`) plus `ApiPlanRateLimit`. Workspace resolved from the key.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                        | Route name               | Controller@action                 | Middleware                                | Request                                                                                                | Response                                                                                                                                  |
| --------------------------------- | ------------------------ | --------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| GET api/v1/flows                  | api.v1.flows.index       | Api\V1\FlowController@index       | api, AuthenticateApiKey, ApiPlanRateLimit | none                                                                                                   | `{data:[FlowResource], meta.count}` ordered by updated_at desc                                                                            |
| GET api/v1/flows/{id}             | api.v1.flows.show        | Api\V1\FlowController@show        | same                                      | none                                                                                                   | one flow with `subscribers_count`; 404 `not_found`                                                                                        |
| POST api/v1/flows/{id}/enroll     | api.v1.flows.enroll      | Api\V1\FlowController@enroll      | same                                      | `contact_id` (required without phone, integer) or `phone` (required without contact_id, string max 32) | 201 `{flow_id, contact_id, subscriber_id, status, enrolled_at}`; 404 `not_found`/`contact_not_found`; 422 `flow_inactive`/`enroll_failed` |
| GET api/v1/flows/{id}/subscribers | api.v1.flows.subscribers | Api\V1\FlowController@subscribers | same                                      | `limit` 1..200 default 100                                                                             | `{data:[...], meta:{count, counts:{active,paused,completed,failed}}}`                                                                     |

- **Data:** same as WD-FLR-011/052.
- **Rules & edge cases:**
  1. Phone lookup hydrates workspace contacts and compares digits of `country_code + mobile` (PHP compare, encrypted column).
  2. `is_active` required; publish state not checked.
  3. Enroll is idempotent but ALWAYS returns 201 with the existing subscriber's status, even when nothing was launched.
  4. `counts` in the subscriber list are computed over the returned page only (max `limit`), not over all subscribers.
  5. Contact phone in list is digits only, unlike the web endpoint which canonicalises.
  6. Not-found flows in another workspace return 404 (scope by current workspace).
- **Async & events:** none.
- **External systems:** Node start.
- **Settings:** API plan rate limits (API domain).
- **Acceptance criteria:**
  - Given a valid key, when POST enroll with `phone` of an existing contact, then 201 and a `subscriber_id`.
  - Given no contact matches, then 404 `contact_not_found`.
  - Given a paused flow, then 422 `flow_inactive`.
  - Given limit=500, then the effective limit is 200.
- **Source refs:** app/Http/Controllers/Api/V1/FlowController.php, app/Http/Requests/Api/V1/Flow/EnrollFlowRequest.php, app/Http/Resources/Api/V1/FlowResource.php
- **Port notes:** route ownership stays in API; the flows module should expose `EnrollmentService.enroll(workspaceId, flowId, contactRef)`. Fix `counts` to be computed over the full set.

### WD-FLR-010 — Other launch paths: routing rule, campaign, mobile app, incoming webhook lead, dispatcher, cross-channel hand-off

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** WD-FLR-011
- **Summary:** Besides triggers there are six more ways a flow gets started. They differ in whether they create a subscriber row (only some do), which matters for analytics and idempotency.
- **Actors & access:** varies; see rules.
- **UX & screens:** none in this domain (each caller has its own UI: routing rules in TIB2, campaign composer in CAMP, mobile app in MOB, incoming webhooks in INTG).
- **Endpoints:** `POST api/app/chats/{id}/flow` (MOB owns the route), Node `POST /api/flow/start/{senderPhone}` (see WD-FLR-014).
- **Data:** see rules.
- **Rules & edge cases:**
  1. **Routing rule `trigger_flow`** (RoutingEngine): validates the flow is active and in the conversation's workspace, writes `routing_meta.pending_flow_id`, records a `flow_triggered` conversation event. The Baileys inbound handler returns that id to Node as `routing_actions.flow_id` (and unsets the pending keys), which starts the flow with timeout 600, cooldown 0. NO subscriber row. Published state is not checked (only `is_active`). On WABA/Twilio the pending id is consumed only on the Baileys inbound response, so the routing `trigger_flow` action does not visibly start a flow for WABA (Open question).
  2. **Campaign with flow** (`WaCampaignsController` flow campaign, optional A/B second flow): for each audience contact not already sent, checks plan/wallet overflow, then POSTs Node `/api/flow/start/{devicePhone}` with `flowId`, `targetPhoneNumber`, `campaignId`, `contactId`, `variant`. Success marks the campaign contact `sent`. NO subscriber row; the Node start returns 202 before the flow runs, so `sent` means "accepted". Variant B with a missing/inactive flow fails that recipient.
  3. **Mobile app / Team Inbox "start flow"** (`Api\App\ChatController@startFlow`): validates `flow_id` exists, flow active and same workspace as the conversation, needs the conversation's device phone and a recipient from `raw_jid`; POSTs Node start; failures return 502. NO subscriber row.
  4. **Incoming webhook lead capture** (`IncomingWebhookController::captureLead`): after creating/updating a contact from the payload it enrolls the lead into the webhook's configured `lead_config.flow_id` (must exist in the hook's workspace; not checked for active/published) via `enroll`. Subscriber row created.
  5. **`KeywordReplyDispatcher`** (used for WABA/Twilio/other unconsumed inbound and welcome/outside-hours rules): for a `reply_type=flow` rule, enrolls the contact (creating a bare contact if needed) via `enroll`. Subscriber row created; effect is once per contact ever.
  6. **Cross-channel hand-off** (Instagram/Facebook `ig_to_whatsapp` / `fb_to_whatsapp` direct mode): Laravel finds or creates a WhatsApp contact from a captured number and `enroll`s it into the chosen WhatsApp flow with the flow's variables. Subscriber row created. The deep-link mode just sends a `wa.me` link.
  7. **Operator takeover** ends runs (WD-FLR-050).
- **Async & events:** Node HTTP calls; post-response for campaigns.
- **External systems:** Node.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a routing rule with trigger_flow and an active flow, when a matching Baileys inbound arrives, then the flow starts exactly once (pending id consumed).
  - Given a flow campaign resumed after a stop, then contacts already `sent` are skipped.
  - Given an incoming webhook with a lead and a configured flow, then the contact is enrolled and a subscriber row exists.
  - Given the mobile app starts a flow on a conversation of another workspace's flow, then 403.
- **Source refs:** app/Services/Inbox/RoutingEngine.php, app/Http/Controllers/WaInboundController.php (pending_flow_id), app/Http/Controllers/WaCampaignsController.php (flow campaign loop ~3440), app/Http/Controllers/Api/App/ChatController.php (startFlow), app/Http/Controllers/IncomingWebhookController.php (captureLead), app/Services/Inbox/KeywordReplyDispatcher.php, app/Http/Controllers/Facebook/FacebookFlowNodeController.php (handleHandoff)
- **Port notes:** unify all launches behind one `FlowLaunchService.start({flow, contact|conversation, source, variables})` that ALWAYS writes a run row with `source`, so analytics covers every path. Keep source-specific guards.

### WD-FLR-011 — Enrollment service and Node launch hand-off

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks)
- **Depends on:** WD-FLR-001
- **Summary:** `FlowEnrollmentService::enroll(contact, flow, variables)` is the single place where a contact enters a flow through Laravel. It creates or reuses the `flow_subscribers` row, decides whether to launch, resolves the sending number for the workspace's active engine, and POSTs Node to start the run. Launch problems mark the subscriber `failed` with a human reason.
- **Actors & access:** internal service; callers listed in WD-FLR-005..010.
- **UX & screens:** failure reasons surface on the analytics pages and subscriber lists.
- **Endpoints:** Node target `POST {node}/api/flow/start/{senderDigits}` with header `X-Node-Token`, 15 s timeout, JSON body: `flowId`, `targetPhoneNumber` (canonical recipient digits), `flowSubscriberId`, `provider` (engine), `name`, `first_name`, `email`, `variables` (object of event variables).
- **Data:** `flow_subscribers` (see Data model). Reads `devices`, `wa_provider_configs`, `workspaces`, `contacts`, `system_settings.baileys_server_url`.
- **Rules & edge cases:**
  1. Workspace check: `contact.workspace_id` must equal `flow.workspace_id`; for legacy contacts without workspace, the contact's user must belong to the flow's workspace; else RuntimeException "Contact not in flow workspace." (callers catch).
  2. `firstOrCreate(flow, contact)` with defaults `enrolled_at=now`, `status=active`. Launch happens ONLY if the row was just created OR is currently `failed`; then status is reset to `active` and `failed_at`/`failure_reason` cleared. Existing `active`, `paused` or `completed` rows are a no-op. Consequence: one launch per contact per flow, plus retries of failed launches.
  3. Meta Business Agent coexistence: if `workspace.suppressesOurAutoReply()` (meta_agent_enabled and mode `meta_agent_only` or `meta_agent_then_handoff`) the subscriber is recorded but the launch is skipped (log only; status stays active).
  4. Sender resolution by workspace engine (`WorkspaceEngine::for`): Baileys -> flow's bound device if provider is baileys/empty AND device active AND same workspace; else the first device `active` and `status='connected'`; else first `active` device. Digits = `country_code + phone_number`. WABA/Twilio -> the connected `wa_provider_configs` row for that provider, primary first then newest, phone digits. No sender -> subscriber `failed`, reason "No connected <engine> sender for this workspace".
  5. Recipient = `Contact::canonicalizePhone(country_code, mobile)` (prevents doubled country codes when `mobile` already includes it); empty -> failed "Contact has no usable mobile number".
  6. Node URL from system setting `baileys_server_url` else env `SERVER_URL`; empty -> failed "Node bridge URL not configured (baileys_server_url / SERVER_URL)".
  7. HTTP non-2xx -> failed "Node <status>: <first 150 chars of body>"; exception -> failed "Node unreachable: <150 chars>". `failure_reason` column is varchar(191).
  8. Node replies 202 immediately, so any failure after acceptance (flow deleted, socket down, send rejected) is invisible to Laravel; the subscriber stays `active`.
  9. Trigger-bound device polymorphism guard: `trigger_device_id` is only used as a `devices.id` when the flow provider is baileys (ids overlap with `wa_provider_configs`).
  10. Enrollment is not transactional across the row write and the Node call.
- **Async & events:** synchronous HTTP to Node; no queue.
- **External systems:** Node bridge (`X-Node-Token`).
- **Settings:** `baileys_server_url` (system setting), `SERVER_URL` env, `NODE_WEBHOOK_TOKEN`.
- **Acceptance criteria:**
  - Given a workspace with no connected device, when a contact is enrolled, then the subscriber is `failed` with the "No connected baileys sender" reason.
  - Given the same contact enrolled again after success, then no second Node call.
  - Given a failed subscriber, when enrolled again, then status returns to `active` and Node is called again.
  - Given a contact whose mobile already has the country code, then the recipient has no duplicated prefix.
  - Given Meta agent coexistence on, then a row exists and Node is not called.
- **Source refs:** app/Services/Flow/FlowEnrollmentService.php, app/Models/FlowSubscriber.php, app/Services/WorkspaceEngine.php, app/Models/Workspace.php (suppressesOurAutoReply)
- **Port notes:** replace HTTP hand-off with an enqueue of `flow.start` (BullMQ) after committing the run row in the same DB transaction (outbox). Persist failure reasons as codes plus text. Sender resolution belongs to WADEV/WABA adapters exposed as `resolveSender(workspace, preferred)`.

### WD-FLR-012 — Trigger kinds with no working path (appointment_booked, comment_to_dm, forced flowId)

- **Status:** dead-code
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-FLR-001
- **Summary:** Three trigger-shaped items exist in code but do nothing in this runtime.
- **Actors & access:** none reachable.
- **UX & screens:** `appointment_booked` and `comment_to_dm` are selectable kinds in `Flow::TRIGGER_KINDS`.
- **Endpoints:** none.
- **Data:** `flows.trigger_kind` values.
- **Rules & edge cases:**
  1. `appointment_booked`: accepted and stored as a kind, but `FlowEnrollmentService` has no `onAppointmentBooked`, and nothing else queries flows by that kind. A flow with this trigger never starts. (`Workspace` lists an "Appointment booked" notification event unrelated to flows.)
  2. `comment_to_dm`: stored (value 0, `trigger_keywords` = CSV of Instagram comment-keyword rule ids). No consumer in the Laravel code read fires it; Instagram comment automation is Instaflow/IG domain (`Services/Instaflow/*`), which pushes flow JSON to the external Instaflow product. Treat as owned by IG.
  3. Node `providerInbound` accepts a caller-supplied `flowId` (skip keyword lookup) but Laravel never sends it.
- **Async & events:** none.
- **External systems:** Instaflow (IG domain).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a flow saved with trigger `appointment_booked`, when an appointment is booked, then nothing starts (documented as-is; port may implement).
- **Source refs:** app/Models/Flow.php (TRIGGER_KINDS), app/Http/Controllers/FlowsController.php (extractTriggerColumns), node/controllers/providerFlowController.js
- **Port notes:** either implement `appointment_booked` via APPT domain event or drop it from the picker; do not port as an accepted-but-inert kind.

### WD-FLR-013 — Runtime flow definition endpoint and graph normalisation contract

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks)
- **Depends on:** none
- **Summary:** Node fetches a flow with `GET api/flows/{id}`. Laravel decrypts the stored builder graph, runs it through `FlowNormalizer` (builder vocabulary -> runtime vocabulary) and returns the runtime graph plus the flow's workspace id. This normaliser is the contract between the editor and the executor.
- **Actors & access:** Node only. Auth: `X-Node-Token` shared secret via `hash_equals`; empty configured token means always 401. No session, no workspace check.
- **UX & screens:** none.
- **Endpoints:**

| Method uri         | Route name     | Controller@action        | Middleware | Request               | Response                                                                                                                                                                               |
| ------------------ | -------------- | ------------------------ | ---------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET api/flows/{id} | api.flows.show | FlowsController@nodeShow | api        | header `X-Node-Token` | `{success:true, data:{flow:{id,flow_name,user_id,is_published}, flow_data:{flowNodes,flowEdges,vars,workspace_id}}}`; 404 `{success:false,message:'Flow not found'}`; 401 unauthorized |

- **Data:** reads `flows` (`flow_data` encrypted JSON; fallback file mirror `storage/app/flows/flow_<id>.json`, legacy `public/uploads/flows/...`; final fallback empty graph), `wa_templates`, `wa_forms`.
- **Rules & edge cases:**
  1. Lookup is `Flow::find(id)`: soft-deleted rows excluded, but there is NO check of published, active or workspace. Any flow id (including another tenant's or a paused flow) is served to anyone holding the Node token. Sub-flow ids typed into a flow therefore reach across tenants (see WD-FLR-031).
  2. `workspace_id` is added to the graph from `flows.workspace_id`, else the flow creator's `current_workspace_id`. Executors read tenancy ONLY from this value (`session.flowData.workspace_id`); a missing value makes most Laravel-callback nodes skip.
  3. Start node: the node with `isStart=true` is moved to index 0; else the first node of type `trigger`; else original order. The runtime always begins at `flowNodes[0]`.
  4. Node type map (builder `type` -> `flowNodeType`): message and sequence -> Message; media -> Media; notify_number -> NotifyNumber; wa_to_instagram -> WaToInstagram; google_meet -> GoogleMeet; wa_form -> WaForm; template -> Template; buttons -> InteractiveButtons; list -> List; ask -> Question; condition -> Condition; delay -> TimeDelay; webhook -> Webhook; code -> Code; mysql -> MySQL; subflow -> SubFlow; assign -> AssignAgent; tag -> TagContact; whatsapp_shop, woocommerce, shopify -> CommerceShop; ai -> ChatGPT; cta -> CTA; location -> Location; poll -> Poll; chatbot -> Chatbot; book_appointment -> BookAppointment; ai_call -> AiCall; google_sheets, google_docs, google_form -> GoogleSheets, GoogleDocs, GoogleForm; deal -> Deal; call-flow ids cf_say... -> CallSay, CallListen, CallAI, CallMenu, CallSearch, CallTransfer, CallHangup. Unmapped types keep any existing `flowNodeType` else `ucfirst(type)`; `trigger` becomes `Trigger` and `end` becomes `End`. The runtime treats `End`/`end` as terminal and any unknown type as "warn and advance".
  5. Edges: each builder edge `{source, sourceHandle, target}` becomes `sourceNodeId = source + '_' + port` and `targetNodeId = target + '_1'`, keeping `source`, `target`, `sourceHandle`, `id`. Port rules: handle `pN` -> N+1 (buttons/list/poll/ask options); handle `else` -> 0 (no-match branch on choice nodes); named handles per node type: condition yes 1 / no 2; book_appointment booked 1 / no_slots 2; commerce nodes purchased 1 / abandoned 2; google_form submitted 1 / timeout 2; deal created 1 / error 2; anything else (`out`) -> 1.
  6. Per-type field shaping (fields the executor reads): message -> `flowReplies[{flowReplyType:'Text',data}]`; sequence -> one entry per `data.replies[]` typed Text/Image/Video/Audio/Document (media entries carry absolutised URL as `data` plus `filename`, `caption`); media -> `mediaKind`, `mediaUrl` (tolerates url/mediaUrl/fileUrl/media/file, absolutised), `mediaCaption`, `mediaFilename`, `mediaMimetype`; notify_number -> `copyNumber` (digits and merge tags only), `source` mirror|custom (default mirror), `kind`, `text`, media fields; wa_to_instagram -> `igUsername` (leading @ stripped), `introText`; wa_form -> `formId`, `bodyText`, `ctaLabel`, `flowVariable`, plus `metaFlowId`/`formTitle` when the form is published (`isLive`), else `metaFlowId=null`; google_meet -> title (default "WhatsApp consultation"), `durationMinutes` 30, `leadMinutes` 5, `sendCalendarInvite`, `messageTemplate`; google_sheets -> mode (write|read), `sheetId`, `tabName`, `columns`, `matchColumn`, `matchValue`, `saveAs` (default sheet_row), `matchByHeader`; google_docs -> `templateId`, `newTitle`, `placeholders`, `shareable` (default true), `messageTemplate`, `saveAs` (doc_url); google_form -> `formId`, `bodyText`, `saveAs` (google_form), `expiresInSec` (86400); template -> `templateName`, `preview`, plus hydrated `templateId/Body/Header/Footer/Language/Category/Buttons/VariableMap` (see rule 8); list -> `headerText` always empty, `bodyText`=prompt, `buttonText`=button label (default "View options"), `listItems[{id:'p<i>',title<=24,description<=72,section<=24}]`, `variable` (default choice); buttons -> `bodyText`, `buttons[{id:'p<i>',title}]`, `variable` (choice); ask -> `question`, `variable` (default answer), `acceptMedia`, `expectedAnswers` (trimmed non-empty strings); condition -> `conditions[{variable,operator,value}]`, `logicOperators` (each forced to AND|OR), plus flat first-rule fields; a legacy single `var/op/value` becomes a one-rule chain; delay -> `delaySeconds = amount*mult` (units sec/min/hour/day; default amount 5, default unit min; unknown unit = minute); webhook -> `method` (upper), `url`, `body`, `variable` (default response), `contentType` (application/json), `headers[{key,value}]` without empty keys; mysql -> host, port 3306, database, username, password, sql, `variable` (rows); subflow -> `flowId`; assign -> `teamId`, `userId`, `noteForAgent`; tag -> `action` add|remove, `tagId`, `tag`; commerce -> `provider`, `storeId`, header/body/footer text (body default "Tap a product to see details:"), `abandonedWaitMinutes` (default 5), `productItems` (max 30 of {retailer_id,name,image,price_minor,currency,url}; legacy `productIds[]` and `product` migrated); code -> `code`, `variable` (result); ai -> model (gpt-4o-mini), prompt, `variable` (reply), `assistant_id`, `extract`, `silent`, `conversational`, `exit_keyword`, `fields[]`, temperature, maxTokens; cta -> `ctaActions[]` (max 3, types url|phone|call_now|copy) plus flat back-compat fields; location -> latitude, longitude, address, title; poll -> question, options, `allowMultiple`; chatbot -> `agentId` and `botId`; book_appointment -> `slotCount` (5), `prompt`, `confirmation`, `calendarOverride`, `collectEmail`, `bookingTypeId`; ai_call -> `assistantId`; deal -> action create|move, `dealName` (default "{{contact_name}} — deal"), `stageId`, `dealValue`, `ownerId`, `saveAs` (deal_id); call-flow node ids -> flat fields.
  7. `cleanVar()` sanitises every variable-name field: strips one surrounding `{{ }}`, a leading `@`, braces and whitespace; falls back to the default. This prevents an Ask storing under a literal key `{{name}}`.
  8. Template hydration: by `tplId` hint (`WaTemplate::find`, no workspace check) else by scanning ALL `wa_templates` rows (approved first, then newest id) comparing the decrypted name. There is no workspace filter in that scan, so two tenants with the same template name can cross-hydrate. Missing template -> `templateBody=''` and the Template node is skipped at runtime.
  9. Media URLs that are relative are made absolute with the app URL (`url()`); URLs containing `{{` are left untouched to be resolved at send time.
  10. The call-flow endpoint (`POST api/call-flow/active`) returns the RAW decoded graph, not the normalised one (WD-FLR-069). The other-channel engines are handed raw graphs too (WD-FLR-060).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none. Env `NODE_WEBHOOK_TOKEN` (via `node_token()` helper).
- **Acceptance criteria:**
  - Given a stored graph with a condition node whose yes-handle is wired, when fetched, then the edge is `<nodeId>_1 -> <target>_1`.
  - Given a buttons node with three options and an `else` handle, then ports are 1, 2, 3 and 0.
  - Given a delay node of 2 hours, then `delaySeconds=7200`.
  - Given a call without the token, then 401.
  - Given a Text media node with a relative URL, then the served `mediaUrl` is absolute.
  - Given a template node naming a template that no longer exists, then `templateBody` is empty.
- **Source refs:** app/Services/Flows/FlowNormalizer.php, app/Http/Controllers/FlowsController.php (nodeShow), app/Models/Flow.php (decoded_flow_data, saveFlowFile), routes/api.php
- **Port notes:** keep a versioned graph schema owned by FLB and a pure `compileGraph(graph) -> RuntimeGraph` function used by the executor (unit-testable; port the `flow-condition*` tests). Add workspace check and published/active gate on the runtime fetch; resolve templates and forms by id within the workspace only. Consider storing the compiled graph on publish so runs snapshot a version (`flow_version_id` on the run).

### WD-FLR-014 — Run start and variable seeding

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** WD-FLR-013
- **Summary:** Whatever launches a run, Node builds a fresh in-memory session that holds a snapshot of the graph and a seeded variable bag, then executes the first node. Three start entry points exist with slightly different seeds.
- **Actors & access:** Laravel (enroll, campaigns, mobile app) via Node; Node itself for keyword starts.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                                 | Route name               | Handler                   | Middleware                                 | Request                                                                                                                                                                                                                          | Response                                                                                                                |
| ------------------------------------------ | ------------------------ | ------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| POST /api/flow/start/:phoneNumber (Node)   | -                        | flowController.startFlow  | X-Node-Token or loopback (`NODE_API_AUTH`) | body `flowId`, `targetPhoneNumber` required; optional `name`, `first_name`, `last_name`, `email`, `phone`, `custom_attributes`, `contact{}`, `variables{}`, `provider`, `campaignId`, `contactId`, `variant`, `flowSubscriberId` | 400 `{error}` if flowId/target missing; else 202 `{message:'FLOW START ACCEPTED', flowId, target}` BEFORE the flow runs |
| GET api/workspace-attributes/{workspaceId} | api.workspace-attributes | closure in routes/api.php | api + X-Node-Token                         | none                                                                                                                                                                                                                             | `{ok:true, attributes:{key:value}}` from the `attributes` table (`forWorkspace`); 401 unauthorized                      |

- **Data:** none persisted. Session object (WD-FLR-015).
- **Rules & edge cases:**
  1. `startFlow`: sender = URL param; socket = `clients[sender]` or null (null is normal for WABA/Twilio; runs proceed via provider send branches). The flow is then fetched with the Node token (20 s), aborted silently if unsuccessful or if it has zero nodes. Nothing is reported back to the caller after the 202, and `flowSubscriberId` is accepted but never used by Node.
  2. Session key = `<digits(sender)>_<digits(target)>`; `sessionId = <rawTarget>_<timestamp>`. Digit-normalising both halves is required so inbound replies (which build the key from digits) find the run.
  3. Seed for `startFlow` (`seedFlowUserVariables`): `name` (name or first_name), `first_name`, `last_name`, `mobile` and `phone` (phone or mobile or target), `email`, `address`, `title`, `language`, plus each `custom_attributes` key when not already set. Workspace attributes are merged UNDER contact values (a blank contact value never overwrites a non-blank workspace default); `variables{}` from the caller (order/event tags) are applied last and win. `user_message` is NOT seeded on this path.
  4. Keyword start on Baileys (`handleFlowAutoReply`): seed = workspace attrs + `user_message` (trigger text), `name`/`pushName` = customer's WhatsApp profile name, `first_name`, `phone` (digits). `messageHistory` begins with the received text; session also stores `triggerKeyword` (lower-case trimmed), `timeoutSeconds`, `cooldownSeconds`, `phoneNumber`, `timeoutTimer`.
  5. Provider start (WABA/Twilio): same seed as the Baileys keyword start, plus `provider`.
  6. Workspace attribute fetch is cached 60 s per workspace (including failures, cached as `{}`); never throws. Only fetched when `flow_data.workspace_id` is set.
  7. Any existing session for the same key is overwritten by a new start. Its old idle timer is cleared only on the Baileys and provider keyword paths, not on `startFlow`. The overwritten session's async chain may still be running and will execute its next node against the new session (looked up by key each time).
  8. `session.conversationId` is referenced by the webhook envelope, booking and AI-call payloads but is never set anywhere, so those fields are always null.
  9. Contact attributes flow only through what the caller passes (name/email/custom attributes). `Node` never reads the `contacts` table.
  10. Node campaign helper `sendFlowMessage` (Node-driven scheduled campaigns) fetches `api/flows/{id}` WITHOUT the Node token and with `APP_DOMAIN_NAME`; with the token-guarded endpoint this returns 401 and that path fails ("Flow not found"). The Laravel-driven campaign loop uses `/api/flow/start` instead (WD-FLR-010).
- **Async & events:** the start body runs as a detached async IIFE after the 202 (needed because Laravel's campaign loop would otherwise deadlock on the re-entrant `api/flows/{id}` callback in single-worker PHP).
- **External systems:** Laravel `api/flows/{id}`, `api/workspace-attributes/{id}`.
- **Settings:** env `APP_DOMAIN_NAME` (Laravel base URL on Node), `NODE_WEBHOOK_TOKEN`.
- **Acceptance criteria:**
  - Given a POST start with `flowId` and target, then the response is 202 immediately and the first node executes shortly after.
  - Given `variables: {invoice_url: 'x'}`, then a Media node with `{{invoice_url}}` resolves it.
  - Given a contact with a blank `promo_key` and a workspace attribute `promo_key=SAVE10`, then `{{promo_key}}` renders `SAVE10`.
  - Given a flow with no nodes, then no session is created and nothing is sent.
  - Given `flowId` missing, then 400.
- **Source refs:** node/controllers/flowController.js (startFlow), node/services/campaignService.js (seedFlowUserVariables, fetchWorkspaceAttributes, mergeFlowVariables, sendFlowMessage), node/classes/BaileysClientManager.js (handleFlowAutoReply), node/controllers/providerFlowController.js, routes/api.php (workspace-attributes)
- **Port notes:** `FlowRun` row created before any node executes (`status=running`, `graph_version`, `vars jsonb`, `source`, `trigger_ref`, `sender_id`, `contact_id`, `conversation_id`). Seed contact/workspace attributes inside the API (no callbacks). Fill `conversation_id` (the reference implementation never did).

### WD-FLR-015 — In-memory session store, expiry, sweepers and restart loss

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks)
- **Depends on:** WD-FLR-014
- **Summary:** All live runs are entries in one JavaScript object on the Node process. Understanding what evicts them is essential, because there is no persistence: eviction equals the run silently ceasing.
- **Actors & access:** internal.
- **UX & screens:** none (Node `/health`-style counters report `activeFlowSessions` and `activeCooldowns`).
- **Endpoints:** none.
- **Data:** `app.locals.activeFlowSessions[key]` and `app.locals.userCooldowns[key]`. Key = `<senderDigits>_<customerDigits>` (WhatsApp). Session fields: `sessionId`, `flowId`, `flowData` (graph snapshot incl. `workspace_id`), `currentNodeId`, `userVariables`, `messageHistory[{type sent|received,message,timestamp}]`, `status` (`active` | `completed` | `timeout`), `startedAt`, `phoneNumber`, `triggerKeyword`, `timeoutSeconds`, `cooldownSeconds`, `timeoutTimer`, `provider`, `waitingForInput` (null or `{nodeId, variable, answerItems, listItems, nextNodeType, persistent, acceptMedia, exitKeyword, slots, ...}`), `lastMenuWait`, and private caches `__nodeVisits`, `__senderPhone`, `__appDomainName`, `__wabaSettings`, `__lastOut`, `__sockPaused`, `__capPaused`. `waitingForInput.nextNodeType` values: `Question`, `List`, `Poll`, `PollFallback`, `Condition`, `BookAppointment`, `CommerceShop`, `AiChat`, `WaForm`, `GoogleForm`.
- **Rules & edge cases:**
  1. One session per (sender number, customer number). A different flow for the same pair replaces the previous one; two flows never run in parallel for a pair.
  2. Idle timer (Baileys path): `setFlowTimeout` arms `timeoutSeconds` (default 600) after every start and every handled reply. On fire: `status='timeout'`, `waitingForInput=null`, cooldown armed if `cooldownSeconds`, session deleted. It is cleared/re-armed on each reply.
  3. Idle timer (WABA/Twilio path): `clearSessionLater` clamps 30..3600 s and deletes the session only if it is NOT waiting for input at fire time; a parked wait is never expired by this timer.
  4. Sweeper (Node `index.js`, every 30 minutes): delete sessions with age since `startedAt` over 1 hour, or `completed` older than 5 minutes, or `status='timeout'`. Age is measured from START, not last activity, so a run that started 61 minutes ago is deleted even if the customer replied a second ago; effective lifetime is 1 to 1.5 hours. The docs' "1-hour wait window" is really this. Cooldown sweeper runs every 10 minutes.
  5. `endFlowSession`: clears the idle timer, arms `userCooldowns[key]` if the session had `cooldownSeconds`, sets `status='completed'`, `waitingForInput=null`, and deletes the entry after 5 seconds unless a persistent menu revived it.
  6. Device logout/disconnect deletes every session whose key starts with `<phone>_` and its cooldowns; a soft disconnect for shutdown keeps files but not sessions.
  7. Node restart, crash or redeploy loses every run, cooldown and pending Delay. Customers mid-flow simply get no further messages; there is no recovery and no flow_subscribers update.
  8. Multi-instance Node would split sessions; the design requires a single Node process.
  9. A Delay node is an awaited timer inside the call stack that started the run. If the sweeper or another start removes the session before the timer fires, the awaited chain resumes, finds no session (`executeFlowNode` returns silently) and the rest of the flow is dropped. Consequence: any flow with waiting longer than about an hour effectively never completes.
- **Async & events:** `setTimeout`/`setInterval` timers only.
- **External systems:** none.
- **Settings:** per-rule `timeout` (seconds, default 600) and `cooldown`; sweeper constants are hard-coded (30 min, 1 h, 5 min, 10 min).
- **Acceptance criteria:**
  - Given a Baileys session waiting on an Ask and no reply for 600 s, then the session is removed and a later reply does nothing.
  - Given a session older than 61 minutes at the next sweep, then it is removed regardless of activity.
  - Given a device logout, then that device's sessions are gone.
  - Given a Node restart during a Delay, then the flow never continues.
- **Source refs:** node/index.js (session and cooldown sweepers, locals init), node/utils/cleanup.js, node/classes/BaileysClientManager.js (setFlowTimeout, logout cleanup), node/controllers/providerFlowController.js (clearSessionLater), node/services/flowService.js (endFlowSession)
- **Port notes:** persist runs (`flow_runs`, `flow_run_steps`) and model waits as DB rows with `resume_at` plus a BullMQ delayed job (`flow.resume`); replies resolve the parked run by (sender, customer) from Postgres. Define explicit run TTL policy (idle expiry per wait node, absolute max lifetime) instead of the accidental sweeper. This removes restart loss and the delay/sweeper conflict.

### WD-FLR-016 — Graph traversal: ports, pacing, dead ends, End node and loop guard

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks)
- **Depends on:** WD-FLR-013
- **Summary:** `executeFlowNode` runs one node then recursively continues along the edge of the chosen output port. Rules here define execution order, branching, termination and protection against endless loops.
- **Actors & access:** internal.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** session `currentNodeId`, `__nodeVisits`.
- **Rules & edge cases:**
  1. Execution order is depth-first along a single path; there is no fan-out. From a port the runtime takes the FIRST edge in the array whose `sourceNodeId` equals `<node>_<port>`; extra edges on the same port are ignored. Merge nodes (two edges into one node) are allowed.
  2. Target id is derived by stripping ONLY the trailing `_<digits>` from `targetNodeId` (node ids themselves contain underscores, e.g. `n_ab12`).
  3. `moveToNextNode` (port 1, used by non-branching nodes) waits 1.5 s before executing the next node. Branch-selected routes (`advanceToPort`, choice replies, Condition) do not add that delay. A Message node waits 1 s after each reply item.
  4. Dispatch by `flowNodeType`: Message, NotifyNumber, WaToInstagram, Question, InteractiveButtons, List, Condition, TimeDelay, Poll, Template, ChatGPT, CTA, Location, Chatbot, BookAppointment, AiCall, CommerceShop, Webhook, Code (then explicit advance), MySQL, TagContact, AssignAgent, SubFlow (same handler as Chatbot), Media, GoogleMeet, WaForm, GoogleSheets, GoogleDocs, GoogleForm, Deal, End/end. Anything else, including the `Trigger` start node, logs "Unknown node type" and advances via port 1 after the 1.5 s pause.
  5. End node -> `endFlowSession` (status completed, cooldown armed, session deleted after 5 s).
  6. Dead-end handling (`parkOrEndFlow`): a branch that runs out of nodes, whose port has no edge, or whose edge target is missing does NOT end the flow if the customer has previously been shown an interactive menu; the last menu (`lastMenuWait`) is re-armed as a persistent wait so its buttons stay usable; only a run with no menu history ends. Product rule: a flow ends only at an End node or when nothing tappable remains.
  7. Loop guard: each node may execute at most 20 times per session (`MAX_NODE_VISITS`); the 21st visit ends the session silently (no message to the customer). Every re-execution counts, including a conversational AI node re-run per customer turn and Condition nodes re-evaluated after replies. So conversation-mode AI is capped at 20 turns per run.
  8. `executeFlowNode` returns silently when `appLocals`, the sessions map or the session itself is missing (session expired mid-chain).
  9. Missing `sock` for Baileys: message-sending nodes skip the send but still advance, so an offline device "completes" the flow without sending anything and without recording a failure.
  10. A node executor that throws propagates to the caller; the entry points catch, log and stop (no error recorded on the run).
- **Async & events:** all sequential awaits; no per-node persistence.
- **External systems:** none.
- **Settings:** constants: visit cap 20, inter-node pause 1500 ms, reply pause 1000 ms.
- **Acceptance criteria:**
  - Given nodes A->B->C via port 1, then messages are sent in order with about 1.5 s between nodes.
  - Given a Condition with only the yes edge wired and the condition false, then the run parks on the last menu if any, else ends.
  - Given a loop A->B->A with no wait, then the run stops after 20 visits without a customer-facing message.
  - Given an End node reached, then a later customer message does not resume the run.
  - Given two edges on the same port, then only the first in edge order runs.
- **Source refs:** node/services/flowService.js (executeFlowNode, moveToNextNode, advanceToPort, parkOrEndFlow, endFlowSession)
- **Port notes:** implement as a job-per-step state machine: `run.currentNodeId`, `visits` map, `MAX_VISITS`. Make the 1.5 s pacing a configurable humanisation delay only for non-official channels. Preserve dead-end-keeps-menu behaviour explicitly and document it to FLB authors.

### WD-FLR-017 — Variable model and merge-tag interpolation

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** WD-FLR-014
- **Summary:** A run carries a bag of string (sometimes object) variables. Nodes read them through `{{name}}` merge tags in texts, URLs, SQL and conditions, and write to them from answers, AI output, webhook results and integration nodes.
- **Actors & access:** internal.
- **UX & screens:** builder shows tag suggestions (FLB).
- **Endpoints:** none.
- **Data:** `session.userVariables` (canonical), alias bag `session.vars` used only by commerce and older code.
- **Rules & edge cases:**
  1. Tag syntax: two braces, optional whitespace, anything except braces, two closing braces. Missing variable renders as empty string (never the literal tag), except where a node documents otherwise.
  2. Resolver (`_flowResolveVar`, used by Message, Ask, Buttons, Condition, NotifyNumber, WaToInstagram): strips surrounding braces and whitespace; tries exact key, then lower-cased key, then walks dotted segments through nested objects with case-insensitive segment matching, trimming spaces around segments; ONLY own properties are read (so `customer.toString` or `__proto__.x` do not resolve). Flat dotted keys such as `customer.Customer_ID` (stored by Sheets/AI/Code) are found by the first exact lookup before any walk.
  3. Rendering: objects render as compact JSON, arrays as comma-joined strings, null/undefined as empty string. "Is set" means present and non-empty (string trimmed, array length, object key count); the string "0" is set.
  4. Several nodes use a simpler substitution (exact key in `userVariables` then `vars`, no nested/case-insensitive lookup, objects stringify with default conversion): List (header/body/footer), Media, Template, Webhook (url/body/headers), MySQL (sql), Google Meet, and the Sheets `_gSubst` variant (which additionally flattens objects to a human field or JSON and supports system tags). Authors can therefore see `{{customer.name}}` work in a Message but not in a Webhook; the port should unify on the strong resolver.
  5. System tags available only in Google Sheets cells (when the flow has not set a same-named variable): `timestamp`, `execution_timestamp`, `now` (`YYYY-MM-DD HH:mm:ss`), `date`, `time`, `iso_timestamp`. Other places have no system tags.
  6. Variables written by the runtime: the answer of Ask/Buttons/List under the node's `variable` (defaults: Ask `answer`/`user_message`; Buttons/List `choice`) AND under the node id; `user_message` (trigger text; also overwritten with each Ask answer to keep AI nodes current); `poll_response` (array); AI `<saveAs>`, `<saveAs>.<field>`, `<saveAs>.__rows`; webhook `<saveAs>` (JSON string) plus flattened `<saveAs>.<path>` and `.length`; MySQL likewise; Code `<saveAs>` (object) plus `<saveAs>.<key>` raw values; Sheets read `<saveAs>` row object plus `<saveAs>.<header>`; Docs `<saveAs>` and `doc_url`; Google Form `<root>` and `<root>.<question>`; WA Form `<field>` and `form_<field>`; Meet `meet_link`, `meet_start`, `meet_event_id`; Deal `<saveAs>` (deal id); booking `slot`, `appointment_choice`, `appointment_id`; commerce `commerce_choice`, `order_id`, `order_total`, `order_currency`; launcher variables such as `order_number`, `invoice_url`.
  7. The Ask node's `variable` name is sanitised by the normaliser (braces and @ stripped).
  8. Variables live only in memory for the life of the session; nothing is written to the contact record (there is no "save to contact attribute" node in this runtime).
  9. Webhook flatten limits: depth 6, at most 200 keys.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `customer` = {Customer_ID:'C-1'} stored by a Sheets read, then `{{customer.Customer_ID}}` and `{{CUSTOMER.customer_id}}` both render `C-1` in a Message.
  - Given an unset tag, then it renders empty.
  - Given `{{customer}}` holding an object, then it renders JSON, not "[object Object]".
  - Given a condition on `__proto__.polluted`, then it is false and does not throw.
  - Given a Webhook response `{items:[{id:5}]}` saved as `r`, then `{{r.items.0.id}}` = 5 and `{{r.items.length}}` = 1.
- **Source refs:** node/services/flowService.js (_flowResolveVar, _flowIsSet, _flowStr, _flowSubst, _gSubst, _gSystemVar, flattenJsonInto), node/test/flow-condition.mjs, node/test/flow-condition-messy.mjs, node/test/flow-sheets-write.mjs
- **Port notes:** implement one `resolveVariable(bag, path)` and `interpolate(template, bag, {escape?})` shared by all node executors and the API-side executors; store the bag as `jsonb`. Add JSON-escape mode for JSON bodies (Webhook already special-cases it).

### WD-FLR-018 — Inbound reply decoding and routing to the waiting node

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks)
- **Depends on:** WD-FLR-016
- **Summary:** When a customer replies while a node is waiting, the runtime decodes the message (text, taps in six WhatsApp shapes, media, location), routes button/list taps to the menu they belong to even if that menu is no longer the current wait, and hands the reply to the waiting node type.
- **Actors & access:** end customer.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** session `waitingForInput`, `lastMenuWait`.
- **Rules & edge cases:**
  1. Decoder (`extractReplyFromMessage`) returns `{id,text}` for: modern interactive native-flow response (params json id + display text), template button reply, legacy list reply, legacy buttons reply, shared location or live location (converted to `https://www.google.com/maps?q=lat,lng`, prefixed by the place name), and plain text (conversation, extended text, or image/video/document captions). WABA/Twilio events are converted by the bridge into a Baileys-shaped object (`buttonsResponseMessage` for taps, `conversation` for text).
  2. Media-only inbound (image, video, audio, document, sticker, no caption) is IGNORED (the run stays parked) unless the waiting node has `acceptMedia`; with `acceptMedia` the media becomes the answer as a stored public URL (WD-FLR-049).
  3. Menu memory: whenever a wait carries `answerItems`, it is remembered as `lastMenuWait`.
  4. Tap router (before normal routing): a list row id `list_<nodeId>_p<i>` is routed to THAT list node's branch; a button id `b_<nodeId>_p<i>` is routed to THAT buttons node; otherwise, if the tap TEXT equals (or its first 20 characters equal, because Meta truncates titles to 20) the label of exactly ONE InteractiveButtons node in the graph, that node is used; ambiguous labels fall through to normal routing. The tap is then resolved against the source node's own options and its exact edge, and the wait is cleared. This is why old menus stay usable.
  5. Normal routing: the answer is stored under the wait's `variable` and under the node id; then by `nextNodeType`: `List` -> list router; `Poll`/`PollFallback` -> poll router; `Question` -> option matching (WD-FLR-022); `Condition` -> re-executes the condition node; `BookAppointment` -> booking state machine or single-config handler; `CommerceShop` -> product pick; `AiChat` -> conversation mode; `WaForm`/`GoogleForm` are resumed by external calls, not replies.
  6. For `Question` replies the shared `user_message` is set to the new reply BEFORE advancing (fixes AI classifiers reading the stale trigger text).
  7. Persistent menus: after a leaf branch of a wait flagged `persistent` finishes without opening a new wait and without an End, the same wait is re-armed (status back to active, session pinned) without re-sending the message, so the customer can tap another option. A branch that hits End terminates and is not re-armed.
  8. Keyword restart (typed text equal to trigger text or matching another keyword flow) is decided before this router by the entry points (WD-FLR-002/003).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a customer taps "No Documents" on an older menu after the flow moved on, then the flow follows that older button's branch.
  - Given an image with no caption while waiting for typed text, then nothing happens and the wait persists.
  - Given a shared location while an Ask is waiting, then the variable holds a Google Maps link.
  - Given a template button tap where WhatsApp drops the id, then routing falls back to matching the visible label.
  - Given a persistent buttons menu and a leaf branch, then a second button tap still works.
- **Source refs:** node/services/flowService.js (handleFlowResponse, extractReplyFromMessage, captureAskMedia), node/controllers/providerFlowController.js (buildMessage)
- **Port notes:** normalise inbound events into `InboundReply {type: text|tap|location|media, id?, text, mediaUrl?}` in the channel adapter; the flow engine should never see provider shapes. Node-scoped option ids `b_<node>_p<i>` / `list_<node>_p<i>` are worth keeping.

### WD-FLR-019 — Engine selection and outbound send layer (Baileys, WABA, Twilio)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks)
- **Depends on:** WD-FLR-016
- **Summary:** Each customer-facing node sends through whichever engine the sending number uses, choosing Cloud API, Twilio or Baileys per session from workspace settings, degrading interactive content where an engine cannot render it, appending the branding footer and mirroring sent messages into the Team Inbox.
- **Actors & access:** internal.
- **UX & screens:** none; engine capability table is in the docs.
- **Endpoints:** Laravel `GET api/whatsapp-settings?phone=` (WABA/NODE domains, `X-Node-Token`) supplies settings; Laravel `POST api/inbound-message` (TIB1/WADEV) receives the inbox mirror.
- **Data:** settings bundle fields used: `use_facebook_api`, `facebook_phone_id`, `facebook_api_token`, `use_twilio`, `twilio_account_sid`, `twilio_auth_token`, `branding_footer`.
- **Rules & edge cases:**
  1. Engine resolution order: WABA if `use_facebook_api` with phone id and token; else Twilio if `use_twilio` with SID and token (Twilio helper additionally requires `use_facebook_api` off); else Baileys. Resolved once per session and cached on the session; Node also caches the settings response per phone(+workspace) for 5 minutes (cache-bust endpoint exists). Mid-run credential changes are therefore not picked up.
  2. Cloud API limits enforced by truncation: reply buttons max 3, title 20, id 256; button body 1024; list sections max 10 and rows max 10 per section (section title 24, row title 24, description 72, open-list button label 20); header 60; footer 60; CTA display text 20; media caption not sent on audio; document filename honoured. Zero buttons/rows -> degrades to a plain text send.
  3. Twilio: text and media native; location native; buttons and lists degrade to numbered text plus "Reply with the number (1-N)"; CTA URL inlined in text; template via approved content SID with positional variables, else plain text. Digit replies are mapped back to the option index.
  4. Baileys interactive messages use the modern quick-reply/interactive-button shape (the legacy list/buttons message types are silently dropped by WhatsApp for personal numbers). Buttons above the caps fall back to text with a numbered list.
  5. Branding footer: for plain text and captions append two newlines plus the footer in underscores, idempotently (never twice); for interactive messages set the footer field (<=60 chars); templates are excluded. Footer text comes from the settings bundle (plan-driven, BrandingFooterService).
  6. Success handling: WABA/Twilio helpers return `{success, messageId, error}` and never throw. Only successful sends are mirrored into the inbox; failures are logged loudly. For Baileys, `flowSockSend` returns null and skips (no throw, no mirror) if there is no live socket or Baileys returns nothing.
  7. Inbox mirror payload: `device_phone`, `sender_phone` (the customer), `body`, `media_type`, generated `wa_message_id` (`flow_out_<ts>_<random>`), `direction='out'`, `source='flow'`, `timestamp`, optional `buttons[{text,type,value}]`, `header`, `footer`; 8 s timeout; failures ignored.
  8. Failure policy per node: wait nodes (Ask, Buttons, List) on WABA/Twilio END the session cleanly if the interactive send fails (so the run does not park waiting for a message the customer never got); every other node ignores the failure and advances. There is no per-send retry, backoff or dead-letter, and no failure is recorded on the run row.
  9. The 24-hour customer-service window is not modelled; Meta rejection surfaces as a failed send.
  10. Message quota/wallet billing is NOT applied inside the flow runtime (only the keyword lookup path meters the first reply, see AR).
- **Async & events:** awaits; inbox mirror is an extra HTTP call after each send.
- **External systems:** Meta Graph API (via `sendMessageViaFacebookApi`), Twilio Messages API (`sendMessageViaTwilioApi`), Baileys socket. Credentials come from Laravel (`api/whatsapp-settings`), never Node env.
- **Settings:** platform branding footer setting; workspace WABA/Twilio config.
- **Acceptance criteria:**
  - Given a WABA workspace and a Buttons node with 4 options, then a list message with 4 rows is sent instead.
  - Given Twilio and a Buttons node, then a numbered text is sent and replying "2" picks option 2.
  - Given a send failure on a Buttons node on WABA, then the session ends and nothing is mirrored.
  - Given a branding footer and a Message node, then the footer appears once at the end of the text.
  - Given no live Baileys socket, then the run continues without sending.
- **Source refs:** node/services/flowService.js (sendWaba*, sendTwilio*, resolveEngine, resolveWabaSettings, mirrorFlowOutboundToInbox, flowSockSend, _appendFooterToText, endWaitNodeOnSendFailure), node/utils/helpers.js (getWhatsAppSettings, sendMessageViaFacebookApi, sendMessageViaTwilioApi), Documentation/pages/automation/flows.html
- **Port notes:** express as a `ChannelSender` port with capability flags (`supportsButtons`, `supportsList`, `supportsCta`, `maxButtons`...) and let the flow node compile to a neutral `OutboundMessage` that the adapter renders or degrades. Persist a message row and mirror through the normal outbox rather than an HTTP callback.

### WD-FLR-020 — Baileys anti-ban gates: socket liveness and daily cap

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-FLR-019
- **Summary:** Before each node on an Unofficial-API run, the engine checks the Baileys socket is usable and the device is under its daily send cap; if not, the run halts. Each dispatched sending node increments the device's daily tally, shared with campaigns, broadcasts and schedules.
- **Actors & access:** internal.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** `appLocals._dailyTally[phone][UTC day]`, `client_ready[phone]`.
- **Rules & edge cases:**
  1. Applies only when a socket object exists (WABA/Twilio runs have `sock=null` and bypass).
  2. Socket usable = socket exists AND `client_ready[phone]` is not explicitly false AND websocket ready state is open AND `sock.user` is set. Else the node is skipped, `__sockPaused=true`, execution stops: the session is neither advanced nor ended and stays until timeout/sweeper.
  3. Cap = `messageSettings.baileys_daily_cap` else 4000 per sender phone per UTC day. At or above the cap the run halts with `__capPaused=true` and the same "stuck" outcome; nothing notifies the operator except a log line.
  4. After a node executes (and no pause flag is set) the tally increments once for node types Message, Question, InteractiveButtons, List, Poll, Template, ChatGPT, CTA, Location, Chatbot, BookAppointment, CommerceShop (a Message with 5 replies counts once, so it under-counts). WABA runs also increment the same tally because the "uses WABA" flag consulted is never set; harmless but inflates the Baileys tally for shared phone numbers.
  5. Once a session sets a pause flag it never clears, so later increments in that session are skipped.
  6. Tally entries older than 2 days are pruned on bump.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `messageSettings.baileys_daily_cap` (default 4000; no admin UI found that sets it).
- **Acceptance criteria:**
  - Given 4000 sends already counted today, when a flow node would run, then it halts and the customer receives nothing.
  - Given a dropped socket, then the node is skipped and the run stays parked until its timers expire.
  - Given a normal send, then the tally increases by 1 per node.
- **Source refs:** node/utils/sendSafety.js, node/services/flowService.js (executeFlowNode gate and tally), node/index.js (messageSettings)
- **Port notes:** implement as a rate-limit policy in the WADEV send adapter, returning a typed `SendBlocked` that the flow engine records as a run event and retries later (BullMQ delay) rather than silently stalling.
