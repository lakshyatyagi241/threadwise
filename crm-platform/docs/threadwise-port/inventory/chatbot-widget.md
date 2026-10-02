---
domain: chatbot-widget
code: WGT
title: Website Chatbot Widget
threadwise_version: '1.7.0'
sources_read: 46
---

# Website Chatbot Widget

## Overview

The chatbot widget lets a workspace put a floating chat bubble on any external website with a one-line `<script>` snippet. A visitor clicks the bubble, a 380x560 panel opens containing an iframe served by Reference, and the visitor chats anonymously. Depending on the widget's **engine mode** the visitor gets (a) replies from an AI chat assistant that the workspace trained in AI Training (AIAG), (b) a button that opens the workspace's WhatsApp number through a `wa.me` deep link, or (c) both. Every visitor message and every bot or human reply is stored as ordinary team-inbox data (a `conversations` row with channel `chatbot_widget` plus `inbox_messages` rows), so operators handle web chats in the Team Inbox (TIB1) next to WhatsApp threads. There is no separate widget inbox and no realtime socket: the widget iframe polls the server every 4 seconds to pick up replies that a human agent typed in the inbox.

Actors:

- **Workspace owner or admin** (role `admin` or higher, plus the plan feature `access_chatbot_widgets`) builds and manages widgets at `/chatbot-widgets`: list, 4-step builder wizard with live preview, copy snippet, duplicate, rotate embed token, delete. Managers, agents and viewers are redirected away (agents/viewers to `/team-inbox`, managers get 403).
- **Anonymous website visitor** (end-customer) uses the public endpoints under `/widget/{token}/...`. The unguessable 48-character `embed_token` in the URL is the only credential. No session, no CSRF, no login.
- **Agent** (operator in Team Inbox) replies to widget threads through the normal inbox reply endpoint; the reply reaches the visitor via polling (TW-WGT-018).
- **Platform admin** sets plan flags (`access_chatbot_widgets`, `chatbot_widgets_limit`) in the package editor (PLAN) and bypasses all plan and role gates.

Main flow end to end: owner opens `/chatbot-widgets/create`, picks a name, engine mode (Smart agent / WhatsApp deep-link / both), an active AI assistant and/or a WhatsApp number, styles the bubble and window, chooses intake fields and clicks "Launch widget"; the server saves the row (slug, embed token) and the UI reveals `<script defer src=".../widget/{token}/embed">`. The owner pastes it before `</body>`. On each page view the loader script injects the launcher button and a hidden iframe pointing at `/widget/{token}/chat`; the iframe calls `api/config` (which creates or resumes an anonymous visitor row), repaints the transcript, optionally shows a pre-chat form, and posts messages to `api/message`. The server upserts a conversation and a contact, stores the inbound bubble, asks the assistant for a reply (unless a human has taken over) and returns it inline.

Plan tiers: the feature flag `access_chatbot_widgets` gates the admin pages and mutations (seeded on for Growth and Pro tiers, off for Starter). `chatbot_widgets_limit` (row cap per plan) exists as a package column and admin form field but is **never enforced** in code (QUIRK). The public endpoints do not re-check the plan, so a workspace that downgrades keeps serving already-embedded widgets.

Connections: **AIAG** (AI assistants `ai_chat_assistants`, training sources, `AiChatService`, provider key resolution and token metering), **TIB1** (conversation list, thread view, reply path, `InboxDispatcher` local-delivery short circuit, channel badge "Web widget"), **CON** (contact auto-created per visitor), **NOTIF** (inbound push notifier fired by the `InboxMessage` observer), **I18N** (real-time translation: inbound translation observer and AI native-language reply hint), **PLAN** (package flags, `EnforcePlanFeature`, paywall overlay), **RBAC/WSP** (`workspace.role:admin` middleware, workspace deletion cascade, data-wipe command), **ASHELL/CORE** (navigation, `SecurityHeaders` framing exemption, CSRF exclusion list), **MOB** (mobile app lists `chatbot_widget` conversations), **WADEV/WABA** (WhatsApp engine is only used for the optional wa.me deep link and for the `provider` stamp; no message is ever sent through WhatsApp for a widget thread), **TIB2** (routing rules, SLA and auto-assignment are NOT invoked for widget conversations).

## Feature index

| Id         | Feature                                                            | Status      | Priority | Effort | Depends on             |
| ---------- | ------------------------------------------------------------------ | ----------- | -------- | ------ | ---------------------- |
| TW-WGT-001 | Widgets list page with stats, search and actions                   | implemented | P0       | M      | —                      |
| TW-WGT-002 | Widget builder wizard (create, edit, live preview)                 | implemented | P0       | L      | —                      |
| TW-WGT-003 | Engine mode, smart agent and WhatsApp target setup                 | implemented | P0       | M      | TW-WGT-002             |
| TW-WGT-004 | Appearance, opening line and send-button styling                   | implemented | P1       | M      | TW-WGT-002             |
| TW-WGT-005 | Visitor intake (pre-chat name, email, phone)                       | implemented | P1       | S      | TW-WGT-002, TW-WGT-009 |
| TW-WGT-006 | Save widget API (validation, slug, token, ownership)               | implemented | P0       | M      | TW-WGT-002             |
| TW-WGT-007 | Embed snippet reveal and copy                                      | implemented | P0       | S      | TW-WGT-006             |
| TW-WGT-008 | Embed loader script (launcher bubble and panel)                    | implemented | P0       | M      | TW-WGT-006             |
| TW-WGT-009 | Public chat iframe page                                            | implemented | P0       | L      | TW-WGT-008             |
| TW-WGT-010 | Widget config endpoint                                             | implemented | P0       | M      | TW-WGT-009, TW-WGT-011 |
| TW-WGT-011 | Anonymous visitor identity and tracking                            | implemented | P0       | M      | —                      |
| TW-WGT-012 | Transcript repaint on reload                                       | implemented | P1       | S      | TW-WGT-010             |
| TW-WGT-013 | WhatsApp deep-link handoff button                                  | implemented | P1       | S      | TW-WGT-003, TW-WGT-010 |
| TW-WGT-014 | Send visitor message endpoint                                      | implemented | P0       | L      | TW-WGT-011             |
| TW-WGT-015 | Conversation and contact provisioning for a visitor                | implemented | P0       | M      | TW-WGT-014             |
| TW-WGT-016 | AI assistant reply                                                 | implemented | P0       | L      | TW-WGT-014             |
| TW-WGT-017 | Human takeover silences the bot                                    | partial     | P0       | S      | TW-WGT-016             |
| TW-WGT-018 | Agent reply delivery via polling history                           | implemented | P0       | M      | TW-WGT-014             |
| TW-WGT-019 | Widget conversations inside Team Inbox and mobile app              | partial     | P0       | M      | TW-WGT-015             |
| TW-WGT-020 | CORS origin allow-list middleware                                  | implemented | P1       | M      | TW-WGT-006             |
| TW-WGT-021 | Allowed-domains management                                         | partial     | P1       | S      | TW-WGT-020             |
| TW-WGT-022 | Public endpoint hardening (throttles, CSRF, framing, token format) | implemented | P0       | M      | —                      |
| TW-WGT-023 | Rotate embed token                                                 | implemented | P1       | S      | TW-WGT-006             |
| TW-WGT-024 | Duplicate widget                                                   | implemented | P2       | S      | TW-WGT-006             |
| TW-WGT-025 | Delete widget                                                      | implemented | P1       | S      | TW-WGT-006             |
| TW-WGT-026 | Pause and resume widget (status)                                   | docs-only   | P1       | S      | TW-WGT-006             |
| TW-WGT-027 | Plan feature gate, role gate and unenforced widget limit           | partial     | P0       | S      | —                      |
| TW-WGT-028 | Navigation entry points                                            | implemented | P2       | S      | TW-WGT-001             |
| TW-WGT-029 | Workspace data wipe and cascade behavior                           | implemented | P2       | S      | TW-WGT-006             |
| TW-WGT-030 | Legacy widget message backfill migration                           | implemented | P2       | S      | TW-WGT-014             |

## Features

### TW-WGT-001 — Widgets list page with stats, search and actions

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** —
- **Summary:** The landing page `/chatbot-widgets` shows every widget of the current workspace in a table with engine, linked smart agent, visitor count and last-updated, plus summary stat cards and per-row icon actions (preview, copy snippet, edit, rotate token, duplicate, delete).
- **Actors & access:** Workspace owner or admin (`workspace.role:admin`) with plan feature `access_chatbot_widgets`. Platform admins bypass both. On a plan without the feature, GET still renders but a paywall sheet (`planPaywall` shared view var, `<x-plan-paywall>`) slides over the page. Scope is the user's `current_workspace_id`.
- **UX & screens:** `resources/views/user/chatbot-widgets/index.blade.php` (page key `user-chatbot-widgets-index`, JS `resources/js/charts/user-chatbot-widgets-index.js`), nav key "more".
  - Left rail: an explanatory side tip, a "Widget status" card with three buttons All / Active / Paused showing counts (`paused = all - active`), and a "Train first" card linking to `/ai-training`.
  - Header: title "Chatbot widgets", an "N active" pill and a "New widget" button to `/chatbot-widgets/create`.
  - Four stat cards: Total widgets (with "N active"), Visitors (all-time, number formatted), Avg / widget (visitors divided by widgets, one decimal, `0` when no widgets), Health (percent active = `round(active/all*100)`, label `healthy` when every widget is active, `empty` when there are none, otherwise `attention`).
  - Table columns: Widget (accent icon cycling over 4 colours by `id % 4`, name linking to edit, status pill Active/Paused, `/slug`), Engine pill (`AI`, `WhatsApp`, `AI + WA`), Smart agent (assistant name or an em dash), Visitors (formatted count or an em dash when 0), Updated (short relative time plus `M d, H:i`), Actions.
  - Row actions in order: Open standalone preview (new tab to `/widget/{token}/chat`), Copy embed snippet, Edit, Rotate embed token, Duplicate (a POST form), Delete.
  - Search box "Search by name or slug" filters rows client-side on a lowercased `name + slug` haystack, only across the 20 rows of the current page.
  - Footer "Showing X of Y" plus "Workspace · N widgets", then Laravel pagination links.
  - Empty state: "No widgets yet" with a "Create widget" button. A green flash bar shows `session('success')` if present.
  - QUIRK: the three status tab buttons in the top bar and the three buttons in the left rail have no click handler and no server-side status filter; `$currentStatus` is never passed to the view so "All" is always highlighted. The filter is dead UI.
- **Endpoints:**

| Method + URI          | Route name                   | Action                          | Middleware                                                                               | Request                  | Response                                         |
| --------------------- | ---------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------ |
| GET `chatbot-widgets` | `user.chatbot-widgets.index` | `ChatbotWidgetController@index` | `Authenticate`, `EnsureWorkspaceRole:admin`, `EnforcePlanFeature:access_chatbot_widgets` | page query only (`page`) | HTML view with `widgets` (paginator) and `stats` |

- **Data:** reads `chatbot_widgets` (workspace scope, soft-deleted excluded) ordered `id` descending, 20 per page with query string preserved, `withCount('visitors')`. Stats: total widgets, widgets with `status='active'`, and count of ALL `chatbot_widget_visitors` rows of the workspace (including visitors of soft-deleted widgets). Assistant name is loaded lazily per row (one extra query per row).
- **Rules & edge cases:**
  1. Workspace comes from `users.current_workspace_id`; missing workspace behaves as workspace 0 (empty list).
  2. "Paused" count is derived as `all - active`; any status other than `active` shows as Active pill fallback in the row (unknown status falls back to the Active style).
  3. Copy-snippet builds the URL from `location.origin`, not from a configured base URL, so it reflects the host the operator is browsing on.
  4. After a token rotation the row's copy button is updated in place but the preview eye link keeps the old token until reload (QUIRK, TW-WGT-023).
  5. Delete removes the row from the DOM without touching the stat counters or the pagination footer.
- **Async & events:** none.
- **External systems:** none. Clipboard API with a fallback confirm dialog that shows the snippet text to copy manually.
- **Settings:** none (page size 20 is hard-coded).
- **Acceptance criteria:**
  - Given a workspace with 25 widgets, When an admin opens `/chatbot-widgets`, Then 20 rows appear newest first and page 2 shows the remaining 5.
  - Given widgets named "Pricing page" and "Support", When the admin types "pric" in the search box, Then only the Pricing row stays visible and no request is sent.
  - Given a workspace with no widgets, Then the empty state with "Create widget" shows and Health reads `empty`.
  - Given a manager or agent role, When they open the URL, Then a manager gets 403 and an agent is redirected to `/team-inbox` with a warning flash.
  - Given a plan without `access_chatbot_widgets`, When an admin opens the page, Then the page renders with the upgrade paywall overlay.
- **Source refs:** `app/Http/Controllers/ChatbotWidgetController.php` (index), `resources/views/user/chatbot-widgets/index.blade.php`, `resources/js/charts/user-chatbot-widgets-index.js`, `routes/web.php`, `Documentation/pages/automation/chatbot-widget.html`.
- **Port notes:** Suggested home `apps/web/.../chatbot-widgets` (list page) and `apps/api/src/modules/chatbot-widget` (list endpoint returning widgets, visitor counts, stats in one query). Do a single aggregated query for visitor counts and eager-load assistants (the original N+1s). Either implement the status filter or drop the dead tabs. Scope by tenant via RLS, not by a manual `workspace_id` filter.

### TW-WGT-002 — Widget builder wizard (create, edit, live preview)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** —
- **Summary:** A four-step wizard (Setup, Look, Voice, Launch) with a sticky header, per-step validation gates, a live phone-style preview of the chat window and a "Save draft" button. The same page serves create and edit.
- **Actors & access:** Same as TW-WGT-001 (role `admin`, feature `access_chatbot_widgets`). Edit is restricted to widgets of the current workspace (otherwise 404).
- **UX & screens:** `resources/views/user/chatbot-widgets/builder.blade.php` (page key `user-chatbot-widgets-builder`, JS `resources/js/charts/user-chatbot-widgets-builder.js`, intl-tel-input library).
  - Sticky header: back arrow to the list, breadcrumb "Chatbot widgets / Edit|New", title, state pill (`Saved` when editing, `Draft / unsaved` when creating; set to `Saved` after a successful save) and a "Save draft" button.
  - Stepper of 4 nodes. Node states: completed (filled with check icon), active (ring), idle. Nodes are clickable: going back or to any step at or below the furthest step reached is free; going forward from a step runs that step's validator first. When editing an existing widget `furthest` starts at 4, so all steps are reachable immediately.
  - Footer nav: Previous (disabled on step 1), "Step N of 4", Next (steps 1-3) or "Launch widget" (step 4).
  - Live preview aside (sticky): a phone frame of 420px height showing the header (title, header colours), the body (background colour or image tile with a radial-dot pattern for colour mode), the welcome bubble (bubble colours) and the send button (label and colours); four meta cards show Engine label (Smart agent / WhatsApp / AI + WhatsApp), Placement (Left/Right), Auto-open (On/Off) and Intake (`name + email + phone` joined, or `None`). The preview updates on every input.
  - Client validators (per step, first failing rule wins, toast + red ring flash + scroll to the field):
    - Step 1: name required (trimmed); mode `ai` or `both` needs an assistant selected; mode `whatsapp` or `both` needs at least 8 digits in `cc + number`.
    - Step 2: `button_color` must match `#` followed by 3 to 8 hex digits; `header_title` required.
    - Step 3: `welcome_message` required (trimmed); when background kind is image, a background image URL is required.
    - Step 4: no rules.
  - "Save draft" and "Launch widget" both first run ALL four validators in order (jumping to the offending step), so an incomplete draft can never be saved.
  - After the first successful save the page stays on `/chatbot-widgets/create`; `state.id` is remembered so later saves update the same row (the URL is not rewritten).
- **Endpoints:**

| Method + URI                    | Route name                    | Action                           | Middleware                | Request | Response                                                                                                            |
| ------------------------------- | ----------------------------- | -------------------------------- | ------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| GET `chatbot-widgets/create`    | `user.chatbot-widgets.create` | `ChatbotWidgetController@create` | admin role + plan gate    | none    | HTML builder with `widget=null`, `mode='create'`, active assistants (id, name) ordered by name                      |
| GET `chatbot-widgets/{id}/edit` | `user.chatbot-widgets.edit`   | `ChatbotWidgetController@edit`   | same (id must be numeric) | none    | HTML builder with the widget, `mode='edit'`, same assistants; 404 if the id is not in the workspace or soft-deleted |

- **Data:** reads `chatbot_widgets` (one row) and `ai_chat_assistants` (`workspace_id` match, `status='active'`, ordered by `name`, columns id and name). The view serializes defaults as JSON into `data-defaults` and assistants into `data-assistants`.
- **Rules & edge cases:**
  1. Builder defaults for a new widget: mode `ai`, position `bottom_right`, button colour `#075E54`, header title "Chat with us", header background `#075E54`, header text `#FFFFFF`, welcome "Hi! How can we help today?", bubble colour `#FFFFFF`, bubble text `#222222`, background kind `color`, background colour `#ECE5DD`, auto-open off, send-button label "Send message", send-button colours `#075E54` / `#FFFFFF`, collect name on, email off, phone off, prefilled WhatsApp text "Hi, I'd like to know more.". (Database column defaults differ: button label "Start chat", prefilled text null.)
  2. Paired colour controls (native colour swatch plus hex text box) are two inputs bound to the same field and mirror each other.
  3. The assistant dropdown only lists ACTIVE assistants; if the saved assistant has since been deactivated, the select shows the placeholder while the underlying state keeps the old id, so saving keeps the link (the server does not check status).
  4. The state pill only reflects the last save; there is no dirty tracking and no unsaved-changes warning on leaving.
  5. The colour hex rule is enforced client-side for the launcher fill only; the other colour fields accept any string up to 16 characters.
- **Async & events:** none besides the save call (TW-WGT-006).
- **External systems:** `intl-tel-input` (with utils) for the WhatsApp number field; default country comes from the layout meta tag `default-country-iso` (admin setting, fallback `in`).
- **Settings:** platform default country (SET) for the phone picker.
- **Acceptance criteria:**
  - Given a new widget with no name, When the admin clicks Next on step 1, Then a toast "Name your widget." shows, the name field flashes and the step does not advance.
  - Given mode "Smart agent" with no assistant chosen, When the admin clicks Next, Then a toast asks to link a smart agent or switch the engine, and the assistant select flashes.
  - Given step 3 with "Tile image" selected and an empty image URL, When Next/Launch is clicked, Then the wizard jumps to step 3 with the error and nothing is saved.
  - Given an existing widget opened via `/chatbot-widgets/{id}/edit`, Then all fields are prefilled, the pill says "Saved", and every stepper node is immediately clickable.
  - Given the admin changes the header colour, Then the preview header repaints instantly without saving.
  - Given an id that belongs to another workspace, Then the edit URL returns 404.
- **Source refs:** `app/Http/Controllers/ChatbotWidgetController.php` (create, edit), `resources/views/user/chatbot-widgets/builder.blade.php`, `resources/js/charts/user-chatbot-widgets-builder.js`, `resources/js/app.js` (page loader), `Documentation/pages/automation/chatbot-widget.html`.
- **Port notes:** React wizard with a shared form schema (zod) reused on the API DTO so client and server rules cannot drift (the original validates hex only on one field client-side and nothing about WhatsApp number server-side). Preview can render the real widget React component. Add unsaved-changes guard and route rewrite to `/edit` after first save (improvement, mark as deviation).

### TW-WGT-003 — Engine mode, smart agent and WhatsApp target setup

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-WGT-002
- **Summary:** Step 1 decides how the widget answers: `ai` (a linked AI chat assistant answers in the browser), `whatsapp` (the visitor is sent to WhatsApp) or `both`. Depending on mode the operator picks a smart agent and/or enters the WhatsApp number and a pre-typed message.
- **Actors & access:** Same as TW-WGT-002.
- **UX & screens:** builder step 1 "Widget setup".
  - Internal name (required, "For your team. Visitors don't see this label."; max 120).
  - Launcher placement select: Bottom right corner or Bottom left corner (`position`).
  - Conversation engine: three radio tiles, "Smart agent" (`ai`, trained AI answers right in the browser), "WhatsApp deep-link" (`whatsapp`), "Smart + WhatsApp" (`both`). The selected tile gets a check badge.
  - "Smart agent (the brain)" select shown for modes `ai` and `both`: first option "Pick a saved smart agent", then the active assistants; helper link "Build a smart agent" to `/ai-training`.
  - "WhatsApp number" (shown for `whatsapp` and `both`): an intl-tel-input country picker with separate dial code. The country dial code goes into hidden `target_whatsapp_cc` (as `+<dial>`), national digits into `target_whatsapp_number` (non-digits stripped). On blur the picker's E.164 value is re-split so a pasted full number is not double-counted. When editing, the saved cc + number are re-seeded through `setNumber`.
  - "Pre-typed message (lands in WhatsApp)" textarea (`prefilled_message`, default "Hi, I'd like to know more.").
- **Endpoints:** none of its own (saved through TW-WGT-006).
- **Data:** writes `chatbot_widgets.mode` (`ai|whatsapp|both`, default `ai`), `assistant_id` (FK `ai_chat_assistants`, nullable, `ON DELETE SET NULL`), `target_whatsapp_cc` (varchar 8), `target_whatsapp_number` (varchar 24), `prefilled_message` (text, form limit 2000), `position` (`bottom_right|bottom_left`).
- **Rules & edge cases:**
  1. Model helper `usesAi()` is true only when mode is `ai` or `both` AND `assistant_id` is not null. Model helper `usesWhatsApp()` is true only when mode is `whatsapp` or `both` AND `target_whatsapp_number` is non-empty. Runtime behavior (TW-WGT-013, TW-WGT-016) is driven by these, not by mode alone.
  2. Server does NOT require a WhatsApp number for modes `whatsapp`/`both` (only the client does, at least 8 digits). A widget saved with an empty number simply shows no WhatsApp button.
  3. Server requires an assistant for `ai`/`both` and that it exists in the same workspace (not soft-deleted). It does not check `status='active'` and does not check the assistant's plan gate.
  4. Fields of the unused engine (assistant in whatsapp mode, WhatsApp fields in ai mode) are still persisted as sent.
  5. In `whatsapp` mode the chat window still renders a text input and send button; typed messages are stored in the team inbox and no automatic reply occurs (QUIRK; docs describe whatsapp mode as "opens WhatsApp" only).
  6. If the assistant is deleted later (soft delete) the relation resolves to null: the widget keeps saving inbound messages but never answers and shows no error (QUIRK).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given mode `whatsapp`, When the wizard renders step 1, Then the assistant select is hidden and the WhatsApp number and pre-typed message fields are shown.
  - Given mode `both` and a number "+91 98765 43210" entered with the India flag, When the widget is saved, Then `target_whatsapp_cc="+91"` and `target_whatsapp_number="9876543210"`.
  - Given mode `ai` with no assistant, When saved via a raw API call, Then the server answers 422 "AI mode needs an assistant. Pick one or create one in AI Training.".
  - Given an assistant id from another workspace, When saved, Then 422 "Assistant not in this workspace.".
- **Source refs:** `resources/views/user/chatbot-widgets/builder.blade.php`, `resources/js/charts/user-chatbot-widgets-builder.js` (mountPhonePicker), `app/Models/ChatbotWidget.php` (usesAi, usesWhatsApp), `app/Http/Controllers/ChatbotWidgetController.php`.
- **Port notes:** Server-side, also validate WhatsApp E.164 digits for modes that need it and require `assistant.status='active'` (deviation, documented). Keep `usesAi`/`usesWhatsApp` as domain methods. Assistant table belongs to AIAG; store `assistant_id` as FK with `ON DELETE SET NULL`.

### TW-WGT-004 — Appearance, opening line and send-button styling

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-WGT-002
- **Summary:** Steps 2 to 4 collect every visual and copy setting of the launcher bubble and chat window: colours, header title, custom launcher icon, opening message, bubble colours, window background (solid colour or tiled image), auto-open and the send button label and colours.
- **Actors & access:** Same as TW-WGT-002.
- **UX & screens:** builder steps.
  - Step 2 "Launcher & window styling": Launcher fill (`button_color`), Window header tint (`header_bg`), Header ink (`header_text_color`), Window title (`header_title`, "keep under ~30 characters", max 120), Custom launcher icon URL (`button_image_url`, optional, "PNG / SVG, 80x80 recommended").
  - Step 3 "Opening message & chat surface": Opening line (`welcome_message`, textarea, required client-side), Incoming bubble fill (`message_bubble_color`) and ink (`message_text_color`) (these style the business/bot bubbles), Window canvas radio "Solid colour" (`body_bg_color`) or "Tile image" (`body_bg_image_url`), toggle "Pop open automatically" (`auto_open`, "opens the chat about 1.2 s after page load"), Visitor intake checkboxes (TW-WGT-005).
  - Step 4 "Send-button & embed snippet": Send-button label (`button_label`, "Avoid Submit"; max 80), Send-button fill (`action_button_bg`) and ink (`action_button_text_color`), and the snippet block (TW-WGT-007).
- **Endpoints:** none of its own.
- **Data:** `chatbot_widgets`: `button_color` (16, default `#075E54`), `button_image_url` (1024, null), `header_title` (120, default "Chat with us"), `header_bg` (`#075E54`), `header_text_color` (`#FFFFFF`), `welcome_message` (text, form limit 2000), `message_bubble_color` (`#FFFFFF`), `message_text_color` (`#222222`), `body_bg_kind` (`color|image`, default `color`), `body_bg_color` (`#ECE5DD`), `body_bg_image_url` (1024), `auto_open` (bool, default false), `button_label` (80, DB default "Start chat"), `action_button_bg` (`#075E54`), `action_button_text_color` (`#FFFFFF`). Server requires (validation `required`): name, mode, position, button_color, header_title, header_bg, header_text_color, message_bubble_color, message_text_color, body_bg_kind, body_bg_color, button_label, action_button_bg, action_button_text_color. `welcome_message`, image URLs and `auto_open` are optional server-side (welcome message is only required by the client wizard).
- **Rules & edge cases:**
  1. Colours are stored as free strings (max 16) and applied verbatim through `element.style.*` in the iframe and through HTML-escaped interpolation in the loader script; no server-side hex validation exists.
  2. Image URLs are free text up to 1024 characters (no upload, no storage). The iframe accepts only `http:`/`https:` URLs for the background image and strips quotes and parentheses; anything else falls back to the solid background colour.
  3. The launcher image, if set, is rendered 36x36 round inside the 56px button; if empty a built-in inline SVG chat icon (white stroke) is used.
  4. `body_bg_kind='image'` with the preview: background image cover; in `color` mode the preview also shows a faint dot pattern which the real iframe does not have.
  5. The "send button" colours style the message Send button in the iframe; they do not style the WhatsApp CTA (fixed green `#25D366`) contrary to the docs' claim (docs-only detail).
  6. The bubble fill/ink apply to the business side (bot and agent) bubbles only; the visitor's own bubbles are fixed light green `#DCF8C6` with dark text.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given header tint `#112233` and ink `#FFFFFF` saved, When the iframe loads, Then the header shows that colour pair and the title text from `header_title`.
  - Given `body_bg_kind=image` with a valid https URL, Then the message area shows that image covering the area; given `javascript:...` as URL, Then the area falls back to `body_bg_color`.
  - Given `auto_open` enabled, When the host page loads, Then the panel opens automatically after about 1.2 seconds.
  - Given the launcher icon URL is empty, Then the launcher shows the default chat glyph.
- **Source refs:** `resources/views/user/chatbot-widgets/builder.blade.php`, `resources/js/charts/user-chatbot-widgets-builder.js`, `resources/views/public/widget/chat.blade.php` (paintChrome), `database/migrations/2026_05_18_100200_create_chatbot_widgets_table.php`.
- **Port notes:** Prefer validated colour tokens (`#rgb`/`#rrggbb`/`#rrggbbaa`) and URL validation server-side; keep the same defaults. Consider an image upload via the storage service (SET) as an improvement; parity is URL only. Avoid emoji and shipped copy from Reference in the new widget assets.

### TW-WGT-005 — Visitor intake (pre-chat name, email, phone)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-WGT-002, TW-WGT-009
- **Summary:** The operator can require the chat to first show a small "Tell us a bit about you" form with name, email and/or phone. Captured values are stored on the visitor record and used to title the conversation and create the contact.
- **Actors & access:** Operator config in the builder (TW-WGT-002); the form is shown to anonymous visitors.
- **UX & screens:** Builder step 3 "Visitor intake" with three checkboxes: Display name (`collect_name`, default on), Email address (`collect_email`), Phone number (`collect_phone`); helper text says skip everything for anonymous chat. In the iframe (`resources/views/public/widget/chat.blade.php`), above the input row, a box titled "Tell us a bit about you" with the enabled fields (text, email, tel inputs) and a "Continue" button. The Send button stays disabled until Continue is pressed. Continue performs no validation, so blank fields are allowed; it hides the form and enables sending.
- **Endpoints:** none of its own; values travel in `POST widget/{token}/api/message` (TW-WGT-014).
- **Data:** `chatbot_widgets.collect_name|collect_email|collect_phone` (bool); `chatbot_widget_visitors.name|email|phone` (120 / 191 / 32).
- **Rules & edge cases:**
  1. The form shows only if at least one flag is on AND the config response says the visitor has no name, no email and no phone yet. A returning visitor who already supplied any one of them never sees it again, even if another enabled field is still empty.
  2. Field values are NOT sent when Continue is pressed; they ride along with every subsequent message body (name/email/phone keys only when non-empty). The visitor row is updated only when a value is non-empty and different.
  3. QUIRK: because the email value is re-sent with every message and the server validates it as an email (max 191), a malformed email makes every message fail with 422; the iframe shows nothing (no error bubble on a JSON failure), so the visitor's bubble appears but is never stored.
  4. If the visitor reloads before sending a first message, the typed values are lost and the form shows again.
  5. Later edits to the visitor's name never update the conversation title or contact (those are set once at conversation creation, TW-WGT-015).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** per-widget flags above.
- **Acceptance criteria:**
  - Given `collect_name` and `collect_email` on and a brand-new visitor, When the chat opens, Then the intake box shows Name and Email, and Send is disabled until Continue is clicked.
  - Given the visitor fills the form and sends "hi", Then the message request carries `name` and `email` and the visitor row stores them.
  - Given a returning visitor with a stored name, Then the intake box is not shown and Send is enabled immediately.
  - Given all three flags off, Then no form shows and Send is enabled once the config loads.
- **Source refs:** `resources/views/public/widget/chat.blade.php`, `resources/views/user/chatbot-widgets/builder.blade.php`, `app/Http/Controllers/ChatbotWidgetPublicController.php` (message, config).
- **Port notes:** Make intake a real gate: send the values once (or PUT the visitor profile) instead of on every message, surface 422 errors in the widget UI, and keep the "show once" rule. Store phone normalized (E.164) for contact matching (TW-WGT-015).

### TW-WGT-006 — Save widget API (validation, slug, token, ownership)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-WGT-002
- **Summary:** A single JSON endpoint creates or updates a widget. On create it mints the embed token and a workspace-unique slug; on every save it returns the embed and preview URLs.
- **Actors & access:** Workspace admin+ with plan feature `access_chatbot_widgets`. On a plan without the feature a mutating AJAX request gets 403 JSON `{ok:false, error:"plan_feature_disabled", feature, message}`.
- **UX & screens:** Invoked by "Save draft" (toast "Draft saved.") and "Launch widget" (toast "Saved - embed ready to copy.") in the builder. Failures toast the server `error` text or "Save failed - check the highlighted step."; network failures toast "Save failed - <message>".
- **Endpoints:**

| Method + URI                    | Route name                      | Action                            | Middleware                                 | Request fields | Response                                                                                                                                       |
| ------------------------------- | ------------------------------- | --------------------------------- | ------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `chatbot-widgets/api/save` | `user.chatbot-widgets.api.save` | `ChatbotWidgetController@apiSave` | admin role + plan gate + CSRF token header | see rules      | 200 `{ok, id, embed_token, embed_url, preview_url}`; 400 `{ok:false,error:"no_workspace"}`; 422 validation errors or `{ok:false,error:<text>}` |

- **Data:** writes `chatbot_widgets`. Fields and validation: `id` nullable integer; `name` required string max 120; `mode` required in `ai,whatsapp,both`; `assistant_id` nullable integer; `target_whatsapp_cc` nullable max 8; `target_whatsapp_number` nullable max 24; `prefilled_message` nullable max 2000; `position` required in `bottom_right,bottom_left`; `button_color`, `header_bg`, `header_text_color`, `message_bubble_color`, `message_text_color`, `body_bg_color`, `action_button_bg`, `action_button_text_color` required strings max 16; `button_image_url` and `body_bg_image_url` nullable max 1024; `header_title` required max 120; `welcome_message` nullable max 2000; `body_bg_kind` required in `color,image`; `auto_open`, `collect_name`, `collect_email`, `collect_phone` nullable boolean; `button_label` required max 80; `allowed_domains` nullable array max 50 items, each string max 253.
- **Rules & edge cases:**
  1. Workspace comes from the user's current workspace; none gives 400 `no_workspace`.
  2. For modes `ai` and `both`: missing assistant gives 422 "AI mode needs an assistant. Pick one or create one in AI Training."; an assistant that is not in the workspace (or soft-deleted) gives 422 "Assistant not in this workspace.". Assistant `status` is not checked.
  3. `allowed_domains` (when present) is normalized before saving: trim, lowercase, drop blanks, strip `http://` or `https://`, cut at the first `/`, dedupe, keep order. Only the array is normalized; hostnames are not validated.
  4. Create vs update: when `id` is present the row is looked up in the workspace. QUIRK: if the id does not exist in the workspace (or is soft-deleted) the call silently creates a NEW widget instead of erroring.
  5. On create: `workspace_id` and `user_id` are set from the current user and `embed_token` = 48-character random alphanumeric string (`Str::random(48)`), unique globally.
  6. Slug: new widgets use `Str::slug(name)` (or `widget-<6 random>` when the slug is empty, e.g. a non-Latin name); existing widgets keep their slug when renamed. Uniqueness is checked per workspace among non-deleted rows by appending `-2`, `-3`, ... QUIRK: the database unique index `(workspace_id, slug)` also covers soft-deleted rows, so recreating a widget with the slug of a deleted one hits a unique-constraint error (HTTP 500) that the code does not anticipate.
  7. `status` and `embed_token` are never accepted from the request; `status` therefore stays at its default `active` forever via the UI (TW-WGT-026).
  8. `auto_open` and the `collect_*` flags are only overwritten when present in the payload (the builder always sends them).
  9. Response `embed_url` is `<app url>/widget/{token}/embed` (extension-less path chosen because many nginx setups serve `*.js` from disk and 404), `preview_url` is `<app url>/widget/{token}/chat`.
  10. No audit-log entry and no notification is written.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none. (`chatbot_widgets_limit` is not consulted, TW-WGT-027.)
- **Acceptance criteria:**
  - Given a valid payload without `id`, When posted, Then a row is created with a 48-char token, slug derived from the name, `status=active`, `user_id` of the caller, and the JSON contains both URLs.
  - Given two widgets both named "Support", Then the second gets slug `support-2`.
  - Given `mode=both`, `assistant_id` null, Then HTTP 422 with the "needs an assistant" message.
  - Given `allowed_domains: ["HTTPS://Acme.com/path", "acme.com", ""]`, Then it is stored as `["acme.com"]`.
  - Given an `id` of another workspace's widget, Then a new widget is created and the foreign widget is untouched.
  - Given a plan without the feature, When an AJAX save is posted, Then 403 `plan_feature_disabled` and nothing is written.
- **Source refs:** `app/Http/Controllers/ChatbotWidgetController.php` (apiSave), `app/Models/ChatbotWidget.php` (fillable, freshToken), `app/Http/Middleware/EnforcePlanFeature.php`, `routes/web.php`, `database/migrations/2026_05_18_100200_create_chatbot_widgets_table.php`, `database/migrations/2026_05_27_180000_add_allowed_domains_to_chatbot_widgets.php`.
- **Port notes:** NestJS `POST /chatbot-widgets` and `PATCH /chatbot-widgets/:id` with a zod DTO (fix the create-on-missing-id quirk: 404 instead). Make the slug unique index partial on `deleted_at IS NULL` (or drop slug uniqueness across trashed rows) to avoid the 500. Token via crypto random (48 chars base62). Table gets RLS on `workspace_id`; the public token lookup path must run in a privileged, tenant-less context (single indexed lookup on `embed_token`).

### TW-WGT-007 — Embed snippet reveal and copy

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-WGT-006
- **Summary:** After "Launch widget" the builder shows a ready-to-paste `<script>` tag and a standalone preview link; the widgets list has a copy-snippet icon per row.
- **Actors & access:** Same as TW-WGT-002.
- **UX & screens:** Builder step 4 hidden block "Ready. Paste this just before `</body>` on the page you want the widget on": a dark code box with `<script defer src="<embed_url>"></script>`, a "Copy to clipboard" button (toast "Snippet copied."; if the Clipboard API is blocked a toast asks to select manually) and an "Open standalone preview" link to `preview_url` (opens the `/chat` page in a new tab). The block is revealed only after a successful "Launch widget" save in the current page session; it is not shown on a fresh edit page load (the operator must click Launch again, which just re-saves). In the list, the copy icon writes the same tag using `location.origin + /widget/<token>/embed` and toasts "Snippet copied - paste before </body> on your site."; if the clipboard is unavailable a confirm dialog shows the snippet text.
- **Endpoints:** none of its own (uses response of TW-WGT-006).
- **Data:** reads `chatbot_widgets.embed_token`.
- **Rules & edge cases:**
  1. The snippet uses `defer` and the extension-less `/embed` path. The documentation page shows `/embed.js` with `async`; both URLs are served (TW-WGT-008).
  2. One snippet per site is enough; the loader has a per-widget global guard so pasting twice does not duplicate the bubble.
  3. The snippet contains the secret token in page source (by design; see docs "Keep your access code safe").
- **Async & events:** none.
- **External systems:** browser Clipboard API.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a saved widget, When the admin clicks Launch, Then the snippet block appears with the exact tag for that token and the preview link opens the chat page.
  - Given the list page, When the copy icon is clicked, Then the clipboard contains a tag whose `src` starts with the current origin and ends with `/widget/<token>/embed`.
  - Given the clipboard permission is denied, Then a fallback dialog or toast lets the user copy manually.
- **Source refs:** `resources/js/charts/user-chatbot-widgets-builder.js`, `resources/js/charts/user-chatbot-widgets-index.js`, `resources/views/user/chatbot-widgets/builder.blade.php`, `app/Http/Controllers/ChatbotWidgetController.php` (apiSave response).
- **Port notes:** Build the snippet from a configured public base URL (`APP_URL`/widget CDN domain) rather than `location.origin`. Show the snippet on the edit page always (improvement).

### TW-WGT-008 — Embed loader script (launcher bubble and panel)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-WGT-006
- **Summary:** The pasted `<script>` fetches a small generated JavaScript file that injects the floating launcher button and a hidden panel containing an iframe of the chat page; clicking the button toggles the panel.
- **Actors & access:** Public (anyone with the token). No authentication, no CORS (loaded through a script tag).
- **UX & screens:** Rendered on the customer's site (not a Blade view; the JS is generated in the controller). Behavior of the generated script:
  - Fixed wrapper at bottom 24px, left or right 24px per `position` (`bottom_left` gives left, anything else gives right), z-index `2147483600`, system font stack.
  - Launcher: 56x56 round button, background `button_color` (default `#075E54`), shadow, `aria-label` "Open chat". Contents: `<img>` 36x36 round from `button_image_url` when set, else an inline white SVG chat glyph.
  - Panel: initially `display:none`; fixed at bottom 96px on the same side, 380x560, `max-width: calc(100vw - 32px)`, `max-height: calc(100vh - 120px)`, radius 14px, overflow hidden, shadow, white background, containing an `<iframe src="/widget/{token}/chat">` filling it with no border.
  - Clicking the launcher toggles the panel between hidden and visible. There is no close button inside the panel and no unread badge.
  - If `auto_open` is on, a timer toggles the panel once 1200 ms after script execution.
- **Endpoints:**

| Method + URI                  | Route name               | Action                                  | Middleware                              | Request    | Response                                                                                                                                                     |
| ----------------------------- | ------------------------ | --------------------------------------- | --------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET `widget/{token}/embed`    | `widget.public.embed`    | `ChatbotWidgetPublicController@embedJs` | none (token regex `[A-Za-z0-9]{16,80}`) | path token | 200 `application/javascript`, header `Cache-Control: no-cache, must-revalidate`; 404 with body comment "widget not found or paused" (still typed JavaScript) |
| GET `widget/{token}/embed.js` | `widget.public.embed_js` | same action                             | none                                    | path token | identical (kept for already-pasted snippets)                                                                                                                 |

- **Data:** reads `chatbot_widgets` where `embed_token = token` AND `status = 'active'` (soft-deleted excluded): `id`, `position`, `button_color`, `button_image_url`, `auto_open`.
- **Rules & edge cases:**
  1. A wrong, rotated, paused or deleted token gives 404 with a JS comment, so the page shows no bubble and no error.
  2. `button_color` and `button_image_url` are HTML-escaped (`htmlspecialchars`) before being interpolated into the script source and into an innerHTML string, which blocks quote break-out; a trailing backslash in an image URL could still break the script for that one widget (self-inflicted).
  3. Idempotent: a global flag `__threadwiseWidget_<widgetId>` makes a second execution a no-op. Two different widgets can coexist (different ids), but they would overlap at the same corner.
  4. The iframe is created immediately at page load even while hidden, so every page view of the host site loads the chat page, calls `api/config` and starts the 4-second history poll (TW-WGT-018). Consequence: a visitor record is created for every browser that loads the host page, not only those who open the chat (QUIRK; drives the "Visitors" stat).
  5. Auto-open uses a toggle: if the visitor clicked the launcher within the first 1.2 s the timer would close it again.
  6. The launcher only has the id suffix `wsnap-launch-<id>` and frame id `wsnap-frame-<id>`; no way to open the widget programmatically (no JS API, no events).
  7. The host site's own CSP must allow the Reference origin for script and frame; nothing here helps with that.
- **Async & events:** none server-side.
- **External systems:** customer's website DOM.
- **Settings:** widget fields `position`, `button_color`, `button_image_url`, `auto_open`.
- **Acceptance criteria:**
  - Given an active widget and the snippet on a page, Then a 56px round launcher appears bottom-right (or bottom-left when configured) and clicking it shows a 380x560 panel with the chat.
  - Given the widget is paused (status not active) or deleted or the token was rotated, When the script URL is requested, Then it returns 404 and no bubble renders.
  - Given `auto_open`, Then the panel is visible about 1.2 s after load without a click.
  - Given the same script tag included twice, Then only one launcher exists.
  - Given the response, Then `Content-Type` is `application/javascript` and `Cache-Control` is `no-cache, must-revalidate`.
- **Source refs:** `app/Http/Controllers/ChatbotWidgetPublicController.php` (embedJs), `routes/web.php` (`widget/{token}` group and the nginx `.js` explanation), `Documentation/pages/automation/chatbot-widget.html`.
- **Port notes:** Serve a static, cacheable `widget.js` bundle from a CDN path and pass the token as a data attribute or query so config is fetched at runtime; that removes per-request script generation and makes rotation/pause take effect through the config call. Lazy-create the iframe on first open to avoid counting non-engaged page views (deviation; if parity of the visitors stat is required keep eager creation). Keep an extension-less alias if nginx rules require it. Do not reuse Reference's exact element ids/copy.

### TW-WGT-009 — Public chat iframe page

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-WGT-008
- **Summary:** The iframe document is a self-contained HTML page with a header, a scrolling message list, an optional intake form and an input row. Its inline JavaScript loads config, paints the widget, sends messages and polls for agent replies.
- **Actors & access:** Public visitors. The page is also linkable directly (the "standalone preview" in the builder and list).
- **UX & screens:** `resources/views/public/widget/chat.blade.php` (standalone HTML, own CSS, no layout, no platform locale).
  - Header 56px (background and text colour from config, title from `header_title`, else "Chat" fallback). Message area (flex column, 14px padding) with bubbles: business side on the left with `bubble_color`/`bubble_text`, visitor side on the right in `#DCF8C6`. Bubbles use `textContent` (no HTML injection). Footer: hidden intake box, rounded text input (placeholder "Type a message..." translated via `__()`), Send button (label `button_label`, colours from config, disabled until enabled).
  - Enter key sends. Send appends the visitor bubble immediately, adds an italic "Typing..." line, posts the message, removes the line and appends the reply bubble if the response contains `reply.body`. A network exception shows a business-side bubble "Sorry, that didn't go through. Please try again." Non-2xx JSON responses (403, 422, 429) show nothing and leave the visitor bubble unsent (QUIRK).
  - If the config says a WhatsApp URL exists and mode is not `ai`, a green "Open WhatsApp" link button is appended after the messages (TW-WGT-013).
  - Window title (HTML `<title>`) is the widget's INTERNAL name.
  - Empty transcript: welcome message bubble on the business side (not stored client-side; see TW-WGT-015 for the server-side seed).
- **Endpoints:**

| Method + URI              | Route name           | Action                               | Middleware         | Request    | Response                                                                                               |
| ------------------------- | -------------------- | ------------------------------------ | ------------------ | ---------- | ------------------------------------------------------------------------------------------------------ |
| GET `widget/{token}/chat` | `widget.public.chat` | `ChatbotWidgetPublicController@chat` | none (token regex) | path token | HTML view `public.widget.chat`; 404 plain text "Widget not found" when not found or `status != active` |

- **Data:** reads `chatbot_widgets` (active only): name and embed token; everything else arrives through `api/config`.
- **Rules & edge cases:**
  1. Visitor identity is kept in the iframe's own `localStorage` under key `wsnap_vid_<TOKEN>` (not a cookie, because the iframe is third-party where cookies are often blocked). The stored uuid is appended as `?visitor_uuid=` to config and history calls and put in the message body.
  2. Background: `body` uses the solid colour (white when an image is configured); the message area gets the image (cover) or colour. Image URL must parse as http(s); quotes, parentheses and backslashes are percent-encoded.
  3. History poll runs every 4000 ms from page load (first tick after 4 s) regardless of whether the panel is visible.
  4. Failures in config loading are not handled: if `api/config` fails (for example 403 origin denied or 404), the page stays empty with a disabled Send button.
  5. Every string shown to visitors that is hard-coded here ("Tell us a bit about you", "Open WhatsApp", "Typing...", "Sorry, ...") is English only and not driven by the workspace language; only the input placeholder goes through `__()` and is rendered in the app's default locale for guests.
  6. The page is deliberately framable (see TW-WGT-022) and has no X-Frame-Options or CSP.
- **Async & events:** 4-second polling; message sends; no websockets.
- **External systems:** none.
- **Settings:** none beyond widget config.
- **Acceptance criteria:**
  - Given an active widget, When `/widget/{token}/chat` loads in an iframe, Then the header shows `header_title`, the welcome message shows as the first bubble for a new visitor, and Send is enabled when no intake is required.
  - Given the visitor types "hello" and presses Enter, Then the visitor bubble appears on the right, "Typing..." shows until the reply arrives, then the reply appears on the left.
  - Given the server is unreachable, Then a "didn't go through" bubble appears and Typing is removed.
  - Given a rotated token, When the old chat URL is opened, Then "Widget not found" (404) is returned.
  - Given bubble text containing `<script>`, Then it is rendered as literal text.
- **Source refs:** `resources/views/public/widget/chat.blade.php`, `app/Http/Controllers/ChatbotWidgetPublicController.php` (chat), `Documentation/pages/automation/chatbot-widget.html`.
- **Port notes:** Implement as a small Next.js route or a static Preact/vanilla bundle inside `apps/web` or a dedicated `apps/widget` served without auth cookies and without the app shell CSS. Add proper error states (rate-limited, offline, blocked domain), i18n from a widget-language setting, an accessible label for the input, and a close button that posts a message to the parent (`postMessage`) for panel control (improvement). Keep `localStorage` visitor id.

### TW-WGT-010 — Widget config endpoint

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-WGT-009, TW-WGT-011
- **Summary:** The iframe's first call returns the widget's public appearance, intake flags, WhatsApp link, the visitor's stored contact details and the recent transcript, and creates the visitor record when needed.
- **Actors & access:** Public, through `widget.cors` middleware (TW-WGT-020). No throttle on this route (QUIRK).
- **UX & screens:** none (consumed by TW-WGT-009).
- **Endpoints:**

| Method + URI                                           | Route name             | Action                                 | Middleware    | Request                                                                                       | Response                                                                               |
| ------------------------------------------------------ | ---------------------- | -------------------------------------- | ------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| GET `widget/{token}/api/config` (also answers OPTIONS) | `widget.public.config` | `ChatbotWidgetPublicController@config` | `widget.cors` | optional cookie `wsnap_vid_<widgetId>`, header `X-Visitor-UUID`, or query/body `visitor_uuid` | 200 JSON below; 404 `{ok:false,error:"widget_not_found"}` when not found or not active |

Response shape: `ok`; `widget` = { name, mode, header_title, header_bg, header_text, welcome_message, bubble_color, bubble_text, body_bg_kind, body_bg_color, body_bg_image_url, button_label, button_bg, button_text, collect_name, collect_email, collect_phone, whatsapp_url }; `visitor` = { uuid, name, email, phone }; `transcript` = array (TW-WGT-012). Note the response omits position, launcher colour, auto-open, assistant id and allowed domains (not needed by the iframe).

- **Data:** reads `chatbot_widgets` (active); resolves or creates `chatbot_widget_visitors` (TW-WGT-011); reads `inbox_messages` for the transcript.
- **Rules & edge cases:**
  1. When the visitor row was just created the response sets a cookie `wsnap_vid_<widgetId>` = visitor uuid, lifetime 60x24x365 minutes (one year), through the normal Laravel cookie pipeline (encrypted). The cookie is not re-sent for returning visitors.
  2. A GET that creates a database row: a scraper hitting this route with no uuid creates unlimited visitor rows (no throttle, no captcha).
  3. Paused widgets return 404 here but `history` does not check status (TW-WGT-018).
  4. `whatsapp_url` is computed by TW-WGT-013.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active widget and no uuid, When config is requested, Then a visitor row is created, the response includes `visitor.uuid` and a Set-Cookie for the widget-specific cookie.
  - Given the stored uuid, When config is requested again, Then no new visitor row and no new cookie.
  - Given a paused, deleted or rotated token, Then 404 `widget_not_found`.
  - Given `allowed_domains` is non-empty and the request carries a disallowed Origin header, Then 403 `cors_origin_denied` (TW-WGT-020).
- **Source refs:** `app/Http/Controllers/ChatbotWidgetPublicController.php` (config, resolveVisitor, recentTranscript), `routes/web.php`.
- **Port notes:** Nest controller under a public, unauthenticated route group; token lookup outside RLS then set `app.workspace_id` for the transaction. Add a throttle and do not create the visitor until the first real interaction unless parity for the stat matters.

### TW-WGT-011 — Anonymous visitor identity and tracking

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** —
- **Summary:** Each anonymous browser is one `chatbot_widget_visitors` row per widget, identified by a random UUID that the browser remembers, so a returning visitor continues the same conversation. The row also records referrer, user agent, IP and first/last seen.
- **Actors & access:** System, on every public call (`config`, `message`, `history`).
- **UX & screens:** no direct screen; only the "Visitors" counts in TW-WGT-001 and the visitor name in Team Inbox.
- **Endpoints:** internal helper `resolveVisitor`, used by all three `api/*` routes.
- **Data:** `chatbot_widget_visitors`: `workspace_id`, `widget_id` (FK cascade), `conversation_id` (nullable FK to conversations, `ON DELETE SET NULL`), `visitor_uuid` (varchar 64, globally unique), `name` (120), `email` (191), `phone` (32), `referrer_url` (1024), `user_agent` (512), `ip` (64), `first_seen_at`, `last_seen_at`, timestamps.
- **Rules & edge cases:**
  1. UUID lookup order: cookie `wsnap_vid_<widgetId>`, then header `X-Visitor-UUID`, then request input `visitor_uuid` (query or JSON body). The row must match BOTH the uuid and `widget_id`; a uuid from another widget or workspace is ignored and a new visitor is created with a fresh server-generated uuid (prevents replay across tenants).
  2. New row: `workspace_id` from the widget, `visitor_uuid` = server UUIDv4, `first_seen_at` = now, `referrer_url` = the HTTP Referer header of the request truncated to 1024 (for an iframe this is normally the chat page or the host page depending on referrer policy), `user_agent` truncated to 512, `ip` = request IP.
  3. `last_seen_at` is updated (an extra save) on every call, including every 4-second history poll.
  4. Unknown or missing uuid on any of the three routes creates a new row, including `history`, so a client that never stores its uuid creates a row every poll (QUIRK).
  5. A client-supplied uuid that does not exist is never adopted; the server always returns the canonical uuid in `config` and the iframe stores it.
  6. Name/email/phone are overwritten only when a non-empty different value arrives (TW-WGT-014). No profile merge, no consent capture, no retention or purge job, no visitor list UI or API.
  7. `DuplicateConversationMerger` lists `chatbot_widget_visitors` among child tables to re-point if conversations were merged, though widget threads are excluded from the scan (dead path in practice).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a fresh browser, When the chat page loads, Then exactly one visitor row exists with `first_seen_at` and `ip` populated.
  - Given the same browser reloads, Then the same row is reused (same uuid) and `last_seen_at` advances.
  - Given a uuid belonging to widget A replayed against widget B, Then B creates a new visitor and A's conversation is not exposed.
  - Given two different widgets embedded on one site, Then the same browser has two independent visitor rows.
- **Source refs:** `app/Http/Controllers/ChatbotWidgetPublicController.php` (resolveVisitor), `app/Models/ChatbotWidgetVisitor.php`, `database/migrations/2026_05_18_100300_create_chatbot_widget_visitors_table.php`, `app/Services/Inbox/DuplicateConversationMerger.php`.
- **Port notes:** table `chatbot_widget_visitors` with RLS on `workspace_id`, unique `(widget_id, visitor_uuid)` (a tightening; original is globally unique uuid). Consider IP hashing/retention for privacy (GDPR), a cleanup job, and a throttle on visitor creation. Keep last_seen updates cheap (debounce to once a minute).

### TW-WGT-012 — Transcript repaint on reload

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-WGT-010
- **Summary:** When a returning visitor reopens the chat, the config response includes the past conversation so the iframe repaints it instead of starting empty.
- **Actors & access:** Public.
- **UX & screens:** bubbles appear in order; visitor messages on the right, business messages (bot or human) on the left. Only when the transcript is empty is the welcome message shown.
- **Endpoints:** part of `GET widget/{token}/api/config` (TW-WGT-010).
- **Data:** reads `inbox_messages` for `visitor.conversation_id`, ordered by `id` ascending, limited to 200 rows, columns `id, direction, body, agent_id`.
- **Rules & edge cases:**
  1. Direction is flipped to the widget's viewpoint: stored `in` (visitor to business) becomes widget `out`; stored `out` becomes widget `in`. `from` is `visitor` for stored inbound, `agent` when `agent_id` is set, else `assistant`.
  2. The 200 cap takes the OLDEST 200 rows (ascending order then limit), so a long conversation repaints from the beginning and omits the newest messages until polling (which only returns rows newer than the last id seen) catches up: QUIRK, messages above the cap never appear on reload.
  3. The welcome message is never in the transcript (it is stored in the legacy `messages` table, TW-WGT-015), so after the first message a reload shows history without the opening line.
  4. Soft-deleted inbox messages are excluded; internal notes live in another table and never appear.
  5. `lastSeenMsgId` is set to the highest id painted, so the poll only fetches later outbound rows.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a visitor with 3 stored messages, When the chat reloads, Then the 3 bubbles show in order with correct sides and no welcome bubble.
  - Given a brand-new visitor, Then the transcript is empty and the welcome bubble shows.
  - Given more than 200 messages, Then only the first 200 repaint (parity quirk; port should take the newest 200).
- **Source refs:** `app/Http/Controllers/ChatbotWidgetPublicController.php` (recentTranscript), `resources/views/public/widget/chat.blade.php` (loadConfig).
- **Port notes:** Return the NEWEST N messages in ascending order and include the seeded welcome message in the same table so the transcript is complete.

### TW-WGT-013 — WhatsApp deep-link handoff button

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-WGT-003, TW-WGT-010
- **Summary:** In `whatsapp` and `both` modes the chat window shows an "Open WhatsApp" button that opens `wa.me/<number>` with the pre-typed message, moving the visitor to WhatsApp.
- **Actors & access:** Public visitors.
- **UX & screens:** a full-width green (`#25D366`) rounded link labelled "Open WhatsApp" appended at the end of the message list at load time (it does not stay pinned at the bottom as messages arrive). Opens in a new tab with `noopener`.
- **Endpoints:** part of `api/config` (`widget.whatsapp_url`).
- **Data:** reads `target_whatsapp_cc`, `target_whatsapp_number`, `prefilled_message`.
- **Rules & edge cases:**
  1. The URL is built only when `usesWhatsApp()` (mode `whatsapp|both` and a non-empty number): digits of `cc + number` (all non-digits removed, so `+91` and `9876543210` become `919876543210`); text is `urlencode`d and appended as `?text=` only when non-empty. An empty digit string means no URL.
  2. The iframe shows the button when `whatsapp_url` is set AND `mode != 'ai'`.
  3. The button is not styled by the send-button colours (docs claim otherwise) and is not counted or tracked anywhere.
  4. No WhatsApp message is sent by Reference; conversations continue in WhatsApp under normal WhatsApp inbox handling (WADEV/WABA), unrelated to the widget conversation, which stays separate.
- **Async & events:** none.
- **External systems:** `https://wa.me/<digits>` (public deep link).
- **Settings:** none.
- **Acceptance criteria:**
  - Given mode `both`, cc `+91`, number `9876543210`, prefilled "Hi there", Then the button href is `https://wa.me/919876543210?text=Hi+there`.
  - Given mode `ai`, Then no WhatsApp button and `whatsapp_url` is null.
  - Given mode `whatsapp` with an empty number, Then no button.
- **Source refs:** `app/Http/Controllers/ChatbotWidgetPublicController.php` (config), `app/Models/ChatbotWidget.php` (usesWhatsApp), `resources/views/public/widget/chat.blade.php` (addWaCta).
- **Port notes:** Use `encodeURIComponent` (`%20`) rather than `+`; either works on wa.me. Consider making the CTA a header action so it stays visible.

### TW-WGT-014 — Send visitor message endpoint

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-WGT-011
- **Summary:** The visitor's message is validated, the visitor profile is updated, the conversation is ensured, the inbound bubble is stored as a team-inbox message and (when applicable) the bot's reply is generated, stored and returned in the same response.
- **Actors & access:** Public through `widget.cors` and `throttle:60,1`.
- **UX & screens:** used by the iframe Send button (TW-WGT-009).
- **Endpoints:**

| Method + URI                                             | Route name              | Action                                  | Middleware                                                       | Request fields                                                                                                                                                   | Response                                          |
| -------------------------------------------------------- | ----------------------- | --------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| POST `widget/{token}/api/message` (also answers OPTIONS) | `widget.public.message` | `ChatbotWidgetPublicController@message` | `widget.cors`, `throttle:60,1`; CSRF excluded (`widget/*/api/*`) | `body` required string max 8000; `name` nullable max 120; `email` nullable email max 191; `phone` nullable max 32; visitor uuid via cookie/header/`visitor_uuid` | 200 `{ok:true, inbound:{id}, reply:{id, body, at} | null}`; 404 `{ok:false,error:"widget_not_found"}`; 422 validation; 429 throttle; 403 `cors_origin_denied` |

- **Data:** writes `chatbot_widget_visitors` (name/email/phone), `conversations` (create or update), `contacts` (TW-WGT-015), `inbox_messages` (inbound and optional AI outbound). Inbound `inbox_messages` row: `conversation_id`, `user_id` = widget owner (`chatbot_widgets.user_id`, can be null if the owner was deleted), `direction='in'`, `from_number` = visitor uuid, `to_number` = `widget-<widgetId>`, `body`, `status='delivered'`, `meta` = {widget_id, visitor_uuid, channel:'chatbot_widget'}, `sent_at` = now. `body`, `from_number`, `to_number` are stored encrypted (app-key `SafeEncrypted` cast). `provider` is auto-stamped from the conversation.
- **Rules & edge cases:**
  1. Widget must be active and not deleted, else 404.
  2. Non-empty `name`/`email`/`phone` that differ from stored values overwrite them (last write wins).
  3. Conversation update after the inbound insert: `preview` = first 191 characters of the body, `last_message_at` and `last_inbound_at` = now, `unread_count` + 1. `inbox_status` is NOT touched: if an agent resolved or snoozed the thread, a new visitor message does not reopen it (QUIRK; verify against TIB1 queue rules, TW-WGT-019).
  4. Order of operations: validate, visitor update, ensure conversation, insert inbound, update conversation, human-takeover check, AI reply, insert outbound, update conversation preview/last_message_at/last_outbound_at, respond.
  5. The endpoint does not call `RoutingEngine`, SLA stamping, keyword auto-reply, flow triggers, AI-agent auto-responder, business-hours logic, wallet charge, opt-out or spam checks (grep-verified). Widget threads are therefore unassigned, priority `normal`, with no SLA clocks.
  6. The `Message::$skipInboxMirror` static flag is set in the controller constructor so the legacy `messages` observer does not also mirror to `inbox_messages`.
  7. Verbose logging under the tag `[WIDGET-INBOX]` (workspace, provider, channel, inbox_status, device_id) was added for diagnosing "chat saved but not visible" problems; the port should keep structured logs, not this format.
  8. Creating the inbound `InboxMessage` fires the model's `created` observers: real-time translation ingestion (detects language, stores agent-language translation, deferred after the response) and the Team Inbox PWA push notifier (deferred), both best-effort and gated by their own settings.
  9. Throttle key is `domain|IP` for guests (or user id if the caller is a logged-in operator), the same counter as the history route, so many visitors behind one NAT share 60 hits per minute across message and history calls (the docs describe it as "per visitor").
- **Async & events:** deferred (post-response) translation and push notification; provider call for the AI reply happens synchronously inside the request (TW-WGT-016). No websocket broadcast.
- **External systems:** AI provider via TW-WGT-016.
- **Settings:** none specific.
- **Acceptance criteria:**
  - Given an active widget and a valid body, When posted, Then the response has `ok:true` and an inbound id, an `inbox_messages` row with `direction=in` exists and the conversation `unread_count` increased by 1.
  - Given an empty body or 8001 characters, Then 422 and nothing is stored.
  - Given `email:"notanemail"`, Then 422.
  - Given a paused widget, Then 404 `widget_not_found`.
  - Given 61 requests within a minute from one IP, Then the 61st is 429.
  - Given a resolved conversation, When the visitor writes again, Then messages append but `inbox_status` remains unchanged (parity quirk to verify).
- **Source refs:** `app/Http/Controllers/ChatbotWidgetPublicController.php` (message), `app/Models/InboxMessage.php`, `app/Casts/SafeEncrypted.php`, `app/Models/Message.php` (skipInboxMirror), `bootstrap/app.php` (CSRF exclusion `widget/*/api/*`), `routes/web.php`.
- **Port notes:** In NestJS this is `POST /public/widget/:token/messages`; run inside one DB transaction with RLS context, then enqueue the AI reply as a BullMQ job (`widget-ai-reply`) and let the widget receive it via the poll or SSE (improvement over the synchronous provider call, which blocks the request). Emit an `inbound.message.persisted` outbox event so routing, SLA, notifications and flows (TIB2/FLR) apply to widget threads too (deliberate deviation; the original skips them). Reopen resolved conversations on inbound.

### TW-WGT-015 — Conversation and contact provisioning for a visitor

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-WGT-014
- **Summary:** The first message of a visitor creates a `chatbot_widget` conversation (linked to the visitor row) plus a CRM contact, so agents see one continuous thread with the visitor's name, email and phone.
- **Actors & access:** System.
- **UX & screens:** appears in Team Inbox (TIB1) with the "Web widget" channel badge and in Contacts (CON).
- **Endpoints:** internal `ensureConversation` (called by `message`).
- **Data:** `conversations` row created with: `user_id` = widget owner, `workspace_id`, `raw_jid` = `widget-<widgetId>-<visitorUuid>`, `title` = visitor display name (name, else email, else "Visitor " + first 6 characters of the uuid), `preview` = first 191 chars of the welcome message (or empty), `status='open'`, `platform='WIDGET'`, `provider` = the workspace's current WhatsApp engine (`WorkspaceEngine::for`), `origin='web'`, `channel='chatbot_widget'`, `inbox_status='open'`, `last_message_at` = now, `routing_meta` = {widget_id, widget_name, visitor_uuid, visitor_name, assistant_id}, `device_id` null. The visitor's `conversation_id` is set. `contacts` upsert: see rules. If the widget has a welcome message, a legacy `messages` row is created (direction out, `from_number=widget-<id>`, `to_number=<uuid>`, status sent, meta {widget_id, source:'welcome'}).
- **Rules & edge cases:**
  1. Reuse: if `visitor.conversation_id` points to an existing conversation it is reused; if that conversation was deleted a new one is created and the visitor is re-pointed.
  2. Contact matching: digits of the visitor's phone; if any, look up an existing contact in the workspace by `mobile_hash` (hash of the canonicalized phone with no country code, so bare national numbers may not match); otherwise `firstOrNew` on (`workspace_id`, `channel='chatbot_widget'`, `channel_uid=<visitor uuid>`). Fill only empty fields: `user_id` (widget owner), `name`, `first_name` (from the visitor name), `email`, `mobile` and `mobile_hash`. Saves, then sets `conversations.contact_id`. Any exception is swallowed with a warning log, leaving the conversation without a contact.
  3. The contact is created at conversation creation time using whatever the visitor had supplied then (often nothing when intake is off), producing a nameless contact; later name/email updates on the visitor row do not propagate to the contact or the conversation title.
  4. The welcome message is stored only in `messages` (legacy table) because the mirror is suppressed; the team-inbox thread view reads `inbox_messages`, so the welcome bubble is NOT visible to agents, contrary to the docs ("seeded into the conversation so agents see it as the opening bubble") - QUIRK, likely bug.
  5. `provider` is stamped with the workspace's PRIMARY engine even if disconnected; the inbox engine filter deliberately exempts `chatbot_widget` so the thread is still visible (see `Conversation::scopeForCurrentEngine`).
  6. Widget conversations are never merged with WhatsApp threads: phone resolution and duplicate-merging exclude engine-agnostic channels.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a first message from a new visitor named "Asha", Then one conversation exists with `channel=chatbot_widget`, title "Asha", `raw_jid` starting `widget-<id>-`, `origin=web`, and the visitor row points to it.
  - Given a second message, Then the same conversation is used (no new row).
  - Given a visitor with phone matching an existing contact's hash, Then `contact_id` links to that contact and its non-empty fields are untouched.
  - Given no phone, Then a contact with `channel=chatbot_widget` and `channel_uid=<uuid>` is created once per visitor.
  - Given the contact save throws, Then the message still succeeds and no contact is linked.
- **Source refs:** `app/Http/Controllers/ChatbotWidgetPublicController.php` (ensureConversation), `app/Models/Conversation.php`, `app/Models/Contact.php` (hashPhone, channel columns), `app/Services/WorkspaceEngine.php`, `app/Services/Inbox/ConversationResolver.php`, `app/Services/Inbox/DuplicateConversationMerger.php`.
- **Port notes:** Write conversation + contact in the same transaction; store the welcome message in `messages` of the unified table so agents see it (fix); create the contact lazily when the first identifying field arrives and update it as the visitor profile changes (improvement); use `contacts (workspace_id, channel, channel_uid)` unique for idempotence. Use channel `web_widget` in the new channel enum but keep a label mapping "Web widget".

### TW-WGT-016 — AI assistant reply

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-WGT-014
- **Summary:** In `ai` or `both` mode with a linked assistant, each visitor message is answered synchronously by the assistant's LLM, using its persona, the trained knowledge base and up to 20 turns of history; the reply is stored and returned.
- **Actors & access:** System on behalf of the widget's workspace. No plan check in the public path (the `access_ai_chat_assistant` and `ai_chat_messages_monthly` values are not consulted here).
- **UX & screens:** the reply bubble in the iframe (business side).
- **Endpoints:** part of `POST widget/{token}/api/message`.
- **Data:** reads `ai_chat_assistants` (persona `system_prompt`, `tone`, `language`, `ai_provider`, `ai_model`, `reply_max_tokens`, `temperature`, `fallback_message`, `handoff_enabled`, `handoff_keyword`, `handoff_message`), `ai_training_sources`, `inbox_messages` (history). Writes outbound `inbox_messages`: `direction='out'`, `from_number='widget-<widgetId>'`, `to_number=<visitor uuid>`, `body` = reply, `status='sent'`, `meta` = {widget_id, assistant_id, source:'ai_chat_assistant', channel}, `sent_at` = now, `user_id` = widget owner, no `agent_id`; then updates the conversation `preview` (191), `last_message_at`, `last_outbound_at`.
- **Rules & edge cases:**
  1. Reply is attempted only when no human has taken over (TW-WGT-017) and `usesAi()` is true (mode allows AI, `assistant_id` set) and the assistant relation resolves (not soft-deleted). Otherwise the response `reply` is null and no error shows.
  2. Prompt assembly (`AiChatService::reply`): system prompt = assistant persona (default "You are a helpful website chatbot.") + tone (default "helpful") + default language (default `en`) + "keep replies short, no role prefixes"; if handoff is enabled with a keyword, an instruction to answer the handoff message (default "A team member will join shortly.") when the visitor asks for a human or says the keyword (this is prompt-level only - it does not trigger a real handoff). Knowledge base: concatenation of all `ready` training sources that are workspace-wide (`assistant_id` null) or scoped to this assistant, ordered by id, hard cap 12,000 characters total (each chunk cut to the remaining budget, minimum 500), appended between "Knowledge base" markers.
  3. Language: when the workspace has real-time translation enabled (plan `access_translation` and workspace toggle), the visitor message's language is detected; if it differs from the team language, the prompt adds "reply entirely in that language".
  4. History: last 20 inbox messages of the conversation (which already INCLUDES the just-stored visitor message, so it appears both in the transcript and as "Visitor just said"), labelled Visitor/Assistant (any outbound, human or bot, is labelled Assistant), stopped when a 6,000 character budget is exhausted; the user prompt asks for a brief helpful plain-text reply.
  5. Provider call through `AiAgentService::callProvider(provider, model, workspaceId, ...)`: max tokens = assistant `reply_max_tokens` or 400; temperature = assistant value or 0.7. Provider keys resolve via workspace BYOK (when the plan allows) then the platform key; usage is metered into the AI token meter (AIADM). A missing key yields an empty reply.
  6. Empty or blank model reply gives the assistant's `fallback_message`, or "Sorry, I couldn't generate a reply right now. A team member will follow up shortly.". A thrown exception in the controller gives the same fallback with "Sorry, I'm having trouble right now. A team member will follow up shortly." as the default; either way the fallback is stored and returned as a normal assistant message.
  7. There is no typing simulation, streaming, rate limit per conversation, cost cap or abuse filter; the only guard is the per-IP throttle (TW-WGT-022).
  8. Knowledge context is shared code with the Flow AI node (`contextFor`); the AI Training UI itself belongs to AIAG.
- **Async & events:** synchronous HTTPS call to the LLM inside the request (can take seconds); token usage recorded by the AI meter.
- **External systems:** OpenAI, Anthropic, Gemini, Mistral and other OpenAI-compatible vendors via `AiAgentService`; keys from admin AI keys or workspace BYOK (AIADM).
- **Settings:** assistant fields above; workspace translation toggle and team language (I18N); admin AI key `max_tokens` cap (AIADM).
- **Acceptance criteria:**
  - Given a widget in `ai` mode with an active assistant and a ready training source, When the visitor asks a question, Then the response `reply.body` is the model text and an outbound row exists with `meta.source=ai_chat_assistant`.
  - Given the provider returns empty text, Then the reply is the assistant's fallback message.
  - Given the provider call throws, Then the reply is the fallback (or the built-in default line) and the request still returns 200.
  - Given the widget is in `whatsapp` mode, Then `reply` is null and only the inbound row is stored.
  - Given a Spanish visitor message and translation enabled with team language `en`, Then the prompt asks for a Spanish reply.
- **Source refs:** `app/Http/Controllers/ChatbotWidgetPublicController.php` (message), `app/Services/AiChat/AiChatService.php`, `app/Models/AiChatAssistant.php`, `app/Services/AiAgentService.php` (callProvider), `app/Services/Inbox/ConversationTranslationService.php`, `app/Http/Controllers/AiTrainingController.php` (assistant picker, `apiListAssistants`), `Documentation/pages/automation/chatbot-widget.html`.
- **Port notes:** Implement as a provider-adapter call from a BullMQ job (`widget.ai.reply`) via the AIAG module's chat-assistant service; enforce plan/usage limits (`access_ai_chat_assistant`, monthly message cap) and wallet/meter integration that Reference omitted; exclude the current message from the history block (fix); real handoff (set an "awaiting human" flag) when the keyword matches instead of a prompt-only hint. RAG can replace the raw 12k-character concat.

### TW-WGT-017 — Human takeover silences the bot

- **Status:** partial
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-WGT-016
- **Summary:** Once an agent has replied in the team inbox the AI must stop answering so the visitor talks to one party. The code infers this from existing messages, but the inference is defective.
- **Actors & access:** System.
- **UX & screens:** visitor simply stops receiving bot replies after the agent answers.
- **Endpoints:** part of `POST widget/{token}/api/message`.
- **Data:** reads `inbox_messages`: any outbound message in the conversation whose `from_number` is null or different from `widget-<widgetId>`.
- **Rules & edge cases:**
  1. Intended rule: AI replies always carry `from_number='widget-<id>'`, a human reply carries the business number or null, so "an outbound row not from the widget bot means a human took over". When true the AI reply is skipped and the message is logged as "bot silenced".
  2. QUIRK (likely bug, derived by static analysis; confirm at parity time): `from_number` is stored encrypted by the model cast, but the takeover check is a raw SQL `!=` comparison against the plaintext `widget-<id>`, which is true for every non-null encrypted value. Consequently the bot's OWN previous reply also counts as a "human", and from the second visitor message of a conversation onward the AI stays silent. In practice the assistant would answer only the first message of each conversation.
  3. Correct behavior to implement: takeover = exists an outbound message authored by a human user (non-null author user id on the message, or `meta.source != 'ai_chat_assistant'`), and no explicit "resume bot" action exists in Reference (once silent, always silent for that conversation).
  4. The welcome message lives in the legacy `messages` table so it is not part of the check.
  5. Assigning an AI agent (`assignee_agent_id`) to a widget conversation in the inbox would invoke the separate AI-agent responder in AIAG, not this path.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an agent replied in the widget thread, When the visitor sends another message, Then no AI reply is generated and `reply` is null.
  - Given only bot replies exist, When the visitor sends another message, Then the bot answers again (the intended behavior; Reference itself likely fails this - see quirk).
  - Given an agent reply occurred, Then the takeover persists for all later messages of that conversation.
- **Source refs:** `app/Http/Controllers/ChatbotWidgetPublicController.php` (message), `app/Models/InboxMessage.php` (casts), `app/Casts/SafeEncrypted.php`.
- **Port notes:** Add explicit columns/flags instead of inferring: `conversations.bot_paused_at` (set when a human agent sends) and an inbox "resume AI" toggle. Do not compare encrypted columns in SQL. Write a regression test for two consecutive visitor messages with no agent reply.

### TW-WGT-018 — Agent reply delivery via polling history

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-WGT-014
- **Summary:** Replies typed by a human in Team Inbox reach the visitor's open widget without refresh because the iframe polls a history endpoint every 4 seconds and renders any new outbound message.
- **Actors & access:** Public visitor iframe; agents use the standard inbox reply.
- **UX & screens:** new business-side bubbles appear in the window; no sound, no unread badge, no typing indicator from the agent.
- **Endpoints:**

| Method + URI                                    | Route name              | Action                                  | Middleware                      | Request                                                         | Response                                                                                                                   |
| ----------------------------------------------- | ----------------------- | --------------------------------------- | ------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| GET `widget/{token}/api/history` (also OPTIONS) | `widget.public.history` | `ChatbotWidgetPublicController@history` | `widget.cors`, `throttle:120,1` | query `since` (integer message id, default 0) plus visitor uuid | 200 `{ok:true, messages:[{id, body, at, from}]}` (empty list when the visitor has no conversation); 404 `widget_not_found` |

- **Data:** reads `inbox_messages` for the visitor's `conversation_id` where `direction='out'` and `id > since`, ordered by id ascending, no limit; columns id, body, sent_at, agent_id. `from` = `agent` when `agent_id` is set, else `assistant`.
- **Rules & edge cases:**
  1. The widget lookup here does NOT filter on `status='active'`, so a paused widget still serves history (the config/message/chat routes 404). Deleted (soft-deleted) widgets and rotated tokens 404.
  2. The iframe renders every returned message it has not yet drawn (deduplicated by `data-id`) and advances the cursor; it does not distinguish `agent` from `assistant`, because a human reply usually has no `agent_id` (that column references AI agents, not human users).
  3. Returns rows regardless of `status` (pending, failed or sent) and regardless of who wrote them; internal notes are stored in a different table and are never returned.
  4. The reply reaches the visitor because `InboxDispatcher::send` short-circuits for engine-agnostic channels: it returns success without any external send ("local delivery"), so the operator's message is not marked failed for lack of a WhatsApp device. Outbound translation (real-time translation) may run before that short-circuit.
  5. Latency up to 4 s; the poll keeps running while the panel is hidden, on every open page of the host site, up to about 15 requests/minute per open page, sharing the 120/min per-IP throttle counter with `message` (TW-WGT-022).
  6. The poll also creates a visitor row if the uuid is unknown (TW-WGT-011).
- **Async & events:** client-side `setInterval(4000)`. No server push, no websocket event.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an agent sends "Hello, how can I help?" from the inbox, Then within about 4 seconds the visitor's open widget shows that bubble exactly once.
  - Given the visitor has no conversation yet, Then history returns an empty array with `ok:true`.
  - Given `since` equal to the last returned id, Then no messages are returned.
  - Given the widget was rotated, Then the old token returns 404 and the iframe stops receiving (silently).
- **Source refs:** `app/Http/Controllers/ChatbotWidgetPublicController.php` (history), `resources/views/public/widget/chat.blade.php` (poll), `app/Services/InboxDispatcher.php` (engine-agnostic short-circuit), `app/Models/InboxMessage.php`.
- **Port notes:** Replace polling with SSE or a websocket channel keyed by conversation (keep polling as a fallback); poll interval backoff when the panel is hidden. Return delivery status; filter to `status in (sent, delivered)`. Make sure the channel adapter for `web_widget` in the outbound pipeline marks messages delivered locally.

### TW-WGT-019 — Widget conversations inside Team Inbox and mobile app

- **Status:** partial
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-WGT-015
- **Summary:** Widget chats are ordinary conversations with channel `chatbot_widget`; agents see them in the Team Inbox list and thread, get push alerts, and can reply, while several inbox automations deliberately do not apply to them.
- **Actors & access:** Agents with normal inbox access (TIB1); mobile app users (MOB).
- **UX & screens:** In Team Inbox the channel key `chatbot_widget` (or `widget`) maps to a "Web widget" badge with a browser-window glyph (`resources/js/charts/user-team-inbox-index.js`). The session-window (24 h) countdown does not apply: only WABA, Twilio, Instagram and Facebook DMs are windowed. The mobile app conversation list includes widget threads (origin `chat|inbox|chatbot` OR engine-agnostic channel) and returns `channel: "chatbot_widget"` so the app can show the icon.
- **Endpoints:** none owned (inbox and mobile endpoints belong to TIB1 and MOB).
- **Data:** `conversations.channel='chatbot_widget'`, `origin='web'`, `platform='WIDGET'`, `raw_jid='widget-...'`, `device_id` null. Reads by inbox: `inbox_messages`.
- **Rules & edge cases:**
  1. Engine scope exemption: `Conversation::scopeForCurrentEngine` always includes channel `chatbot_widget` (the engine set is cached 5 seconds per workspace) so a widget thread is visible even when its stamped `provider` (the workspace's primary engine) is not among the connected engines. The constant `ENGINE_AGNOSTIC_CHANNELS` also lists the other web/social channels.
  2. Device filter in the mobile inbox never hides widget threads (`device_id` null is allowed).
  3. Excluded from phone-identity features: `ConversationResolver::digitsFor` returns null for `widget-` ids and `matchQuery` excludes engine-agnostic channels; the duplicate-thread merger scan excludes them. So a visitor whose phone equals an existing WhatsApp contact is never merged into that WhatsApp thread.
  4. Outbound replies from the inbox short-circuit to local delivery (TW-WGT-018) and the thread shows them sent; there is no external channel, no delivery receipts, no read receipts to the visitor.
  5. Inbound rows fire the standard `InboxMessage` observers: automatic conversation translation (so agents see the visitor text in their language when the workspace enabled it) and the Team Inbox PWA push notification to the assigned/opted-in agents.
  6. Not applied to widget threads (verified by grep): routing rules, auto-assignment, SLA clocks and first-response tracking (TIB2), keyword auto-reply / away-mode / business-hours reply (AR), flow triggers (FLR), AI agent auto-responder (`assignee_agent_id` only fires when the inbox path calls it), notification-dispatcher assignment alerts, outgoing webhooks, CSAT prompts.
  7. Reopen: the widget message handler never changes `inbox_status`, `resolved_at` or `snoozed_until`. If an agent resolved the thread, later visitor messages append silently and the thread may stay hidden from the "open" queue (open question for TIB1: whether the queue query surfaces unread resolved threads).
- **Async & events:** deferred translation and push notification after the response.
- **External systems:** Web Push (VAPID) via the PWA notifier when configured (NOTIF).
- **Settings:** workspace translation toggle and team language (I18N); push settings (NOTIF).
- **Acceptance criteria:**
  - Given a workspace whose connected engine is Baileys and a widget conversation stamped `provider=waba`, When the agent opens Team Inbox, Then the widget thread is listed.
  - Given an agent replies in the thread, Then the message shows as sent (not failed) and appears in the visitor's widget within about 4 s.
  - Given a widget visitor supplies the phone of an existing WhatsApp contact, Then the widget thread stays separate and `contact_id` links to that contact.
  - Given routing rules exist, Then a widget conversation is not assigned or SLA-stamped (parity).
  - Given the mobile app lists conversations, Then widget threads carry `channel=chatbot_widget`.
- **Source refs:** `app/Models/Conversation.php`, `app/Services/InboxDispatcher.php`, `app/Services/Inbox/ConversationResolver.php`, `app/Services/Inbox/DuplicateConversationMerger.php`, `app/Http/Controllers/TeamInboxController.php` (sessionWindow), `app/Http/Controllers/Api/App/ChatController.php`, `app/Models/InboxMessage.php`, `resources/js/charts/user-team-inbox-index.js`.
- **Port notes:** In the new schema make `channel` an enum value `web_widget` with a channel adapter (outbound = mark delivered, inbound = the public API). Feed widget inbound through the same `inbound.message.persisted` pipeline as other channels so routing/SLA/notifications apply (deviation from Reference, call it out in parity tracking). Store `visitor` metadata on the contact/conversation rather than in `routing_meta` JSON.

### TW-WGT-020 — CORS origin allow-list middleware

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-WGT-006
- **Summary:** All three `api/*` public endpoints pass through a CORS middleware that resolves the widget from the token, compares the request `Origin` with the widget's `allowed_domains` and echoes the origin back or denies the call.
- **Actors & access:** Public browsers.
- **UX & screens:** none; a denied call surfaces in the browser console as a CORS/403 error.
- **Endpoints:** applies to `GET widget/{token}/api/config`, `GET widget/{token}/api/history`, `POST widget/{token}/api/message` (and their OPTIONS preflights). Middleware alias `widget.cors` = `app/Http/Middleware/ChatbotWidgetCors.php`.
- **Data:** reads `chatbot_widgets.allowed_domains` (JSON array of `host[:port]` strings).
- **Rules & edge cases:**
  1. No `Origin` header (curl, same-origin GET, direct load): skip CORS entirely and continue. Therefore the allow-list is not an authentication mechanism.
  2. Origin present: look up the widget by token (any status, only non-deleted). Not found returns 404 `{ok:false,error:"widget_not_found"}` without CORS headers.
  3. `OPTIONS` preflight: respond 204 immediately with CORS headers if allowed, else a 204 without them.
  4. Not allowed: 403 `{ok:false, error:"cors_origin_denied", message:"This widget isn't allowed to load from <origin>. Add the domain to the widget's allow-list."}` with no CORS headers.
  5. Allowed: run the request and add `Access-Control-Allow-Origin: <exact origin>`, `Access-Control-Allow-Credentials: true`, `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers` echoing the requested headers (default `Content-Type, X-Requested-With, X-Widget-Session`), `Access-Control-Max-Age: 3600`, `Vary: Origin`.
  6. Matching (`ChatbotWidget::originAllowed`): missing origin false; EMPTY or null `allowed_domains` allows every origin; otherwise the origin is parsed to lowercase `host[:port]` and must equal an entry (entries are lowercased, scheme and path stripped again at match time). No wildcard subdomains, ports must match exactly, `www.` is a distinct host.
  7. QUIRK (inferred): the chat iframe document is served from the Reference host, so its `fetch` calls are same-origin. Browsers omit `Origin` on same-origin GETs (config, history pass) but include `Origin: <Reference host>` on same-origin POSTs, so the message POST is checked against the allow-list using the Reference host, not the customer's site. A non-empty allow-list that lists only customer domains would therefore block message sending with `cors_origin_denied`. Combined with rule 1 the list also never restricts who can embed the iframe or load `embed`/`chat`. Confirm in a live parity run.
  8. The migration comment says an empty array means "block every origin", but the model treats empty as "allow all"; the model behavior (allow all) is what runs.
- **Async & events:** none.
- **External systems:** browsers.
- **Settings:** per-widget `allowed_domains`.
- **Acceptance criteria:**
  - Given an empty allow-list, When a cross-origin request with any Origin arrives, Then it is processed and the response echoes that Origin with credentials allowed.
  - Given allow-list `["acme.com"]`, When Origin is `https://Acme.com`, Then allowed; when Origin is `https://www.acme.com` then 403 `cors_origin_denied`.
  - Given an OPTIONS preflight from an allowed origin, Then 204 with the CORS headers and `Max-Age 3600`.
  - Given no Origin header, Then the request is handled without CORS headers regardless of the list.
  - Given a deleted widget and an Origin header, Then 404 `widget_not_found`.
- **Source refs:** `app/Http/Middleware/ChatbotWidgetCors.php`, `app/Models/ChatbotWidget.php` (originAllowed), `bootstrap/app.php` (alias `widget.cors`), `database/migrations/2026_05_27_180000_add_allowed_domains_to_chatbot_widgets.php`, `routes/web.php`.
- **Port notes:** Nest guard/interceptor; make the allow-list also gate the loader script and the iframe (via `frame-ancestors` CSP on the chat page built from `allowed_domains`, and a `Referer`/`Origin` check on `embed`) so it really restricts embedding, and make sure the widget's own host is implicitly allowed. Cache widget lookups (they happen on every poll).

### TW-WGT-021 — Allowed-domains management

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-WGT-020
- **Summary:** The documentation promises an "Allowed domains" field in the widget editor (up to 50 hosts) but the builder UI has no such control; the value can only be set through the save API.
- **Actors & access:** Admin (API only).
- **UX & screens:** none in `builder.blade.php`. The builder JS state is built from a fixed defaults object that excludes `allowed_domains`, so a UI save never sends the key and never changes the stored value (duplicate copies it).
- **Endpoints:** `POST chatbot-widgets/api/save` accepts `allowed_domains` (TW-WGT-006); no separate route.
- **Data:** `chatbot_widgets.allowed_domains` JSON, nullable (added by the 2026-05-27 migration).
- **Rules & edge cases:**
  1. Validation: array, max 50 items, each string max 253 characters; normalization (lowercase, strip scheme and path, dedupe, drop blanks) happens in the controller.
  2. Documented UX (docs only): enter plain host names like `acme.com` or `shop.acme.com`, no wildcards, blocked sites see a console message.
  3. The only seeded example sets `["demo.co"]` in the demo seeder together with an invalid `position` value `right`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a raw API save with `allowed_domains:["Shop.Acme.com"]`, Then it is stored as `["shop.acme.com"]`.
  - Given more than 50 entries, Then 422.
  - Given a UI save of an existing widget with a stored list, Then the stored list is unchanged.
- **Source refs:** `app/Http/Controllers/ChatbotWidgetController.php`, `resources/views/user/chatbot-widgets/builder.blade.php`, `resources/js/charts/user-chatbot-widgets-builder.js`, `database/seeders/DemoGapSeeder.php`, `Documentation/pages/automation/chatbot-widget.html`.
- **Port notes:** Build the missing UI (tag input with the same normalization and a warning that the widget's own host must remain allowed), tie it to TW-WGT-020's redesign, and cap at 50 entries.

### TW-WGT-022 — Public endpoint hardening (throttles, CSRF, framing, token format)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** —
- **Summary:** The public surface is protected by an unguessable token, route-level token regex, per-IP rate limits, CSRF exclusion (no session) and a security-header exemption that keeps the chat page framable.
- **Actors & access:** Public.
- **UX & screens:** none.
- **Endpoints:** all six `widget/{token}/...` routes (see the feature entries above).
- **Data:** none.
- **Rules & edge cases:**
  1. Route group `widget/{token}` requires the token to match `[A-Za-z0-9]{16,80}` (tokens are 48 chars); anything else is a 404 from routing.
  2. Throttles: `message` 60 per minute, `history` 120 per minute, `config` none, `embed`/`chat` none. The Laravel key for guests is `domain|IP` and is not scoped per route or per token, so all throttled guest routes on the same IP share one counter, and visitors behind a shared NAT share it. A logged-in operator hitting the routes is keyed by user id. Exceeding returns 429 (JSON for `Accept: application/json`).
  3. CSRF: paths `widget/*/api/*` are excluded from CSRF verification in `bootstrap/app.php`. The iframe still runs in the web middleware group, which starts a session and may issue a session cookie on each response; the widget does not rely on it.
  4. `SecurityHeaders` middleware returns early for `widget` and `widget/*` paths, so `X-Frame-Options`/`Content-Security-Policy` frame restrictions are NOT applied and the chat page can be framed anywhere (cross-origin embedding is the point).
  5. Bubbles are inserted with `textContent`; background URL is sanitized; loader interpolations are HTML-escaped; all writes use validated fields (body max 8000).
  6. The token is the only access control and appears in the customer's page source; rotation (TW-WGT-023) is the revocation mechanism. Status and deletion take effect immediately on config/message/embed/chat.
  7. There is no bot protection (captcha), no per-conversation cap, no maximum number of visitor rows and no abuse blocklist.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none (limits are hard-coded).
- **Acceptance criteria:**
  - Given a token with 10 characters, Then the route does not match (404).
  - Given 61 message posts in 60 seconds from one IP, Then the 61st returns 429.
  - Given a cross-site page embedding the chat iframe, Then the browser renders it (no frame-blocking header).
  - Given a POST to `api/message` without a CSRF token, Then it is accepted.
- **Source refs:** `routes/web.php`, `bootstrap/app.php`, `app/Http/Middleware/SecurityHeaders.php`, `vendor/laravel/framework/.../ThrottleRequests.php` (key format), `Documentation/pages/automation/chatbot-widget.html`.
- **Port notes:** Rate limit by (IP, token) and by visitor uuid using Redis (`@nestjs/throttler` with Redis store), add a bot challenge option for public sites, per-widget daily message cap tied to plans, and a global visitor-creation limit. Keep the framing exemption only for the widget routes and add `Content-Security-Policy: frame-ancestors` derived from `allowed_domains`.

### TW-WGT-023 — Rotate embed token

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-WGT-006
- **Summary:** An admin can replace a widget's secret token; the old snippet stops working immediately while stored conversations are unaffected.
- **Actors & access:** Admin with the plan feature (mutation blocked with 403 `plan_feature_disabled` otherwise).
- **UX & screens:** Amber rotate icon on each list row opens a danger confirm dialog "Rotate this widget's embed token?" with text that the current snippet stops working immediately and a new one must be pasted; confirm label "Rotate". Success toast "Token rotated - copy the new snippet." and the row's copy-button token is updated in place (the preview link is not, QUIRK). Failure toast "Rotate failed - <reason>".
- **Endpoints:**

| Method + URI                             | Route name                          | Action                                | Middleware                    | Request             | Response                                                    |
| ---------------------------------------- | ----------------------------------- | ------------------------------------- | ----------------------------- | ------------------- | ----------------------------------------------------------- |
| POST `chatbot-widgets/{id}/rotate-token` | `user.chatbot-widgets.rotate-token` | `ChatbotWidgetController@rotateToken` | admin role + plan gate + CSRF | path `id` (numeric) | 200 `{ok, embed_token, embed_url}`; 404 if not in workspace |

- **Data:** updates `chatbot_widgets.embed_token` to a new 48-char random string.
- **Rules & edge cases:**
  1. Old token requests then return 404 on embed, chat, config, message, history.
  2. Visitors: `chatbot_widget_visitors` rows and conversations remain; the visitor cookie is keyed by widget id and survives, but the iframe's localStorage key includes the token, so a returning visitor whose cookie is blocked (third-party context) loses their identity and gets a new visitor and conversation (QUIRK).
  3. Already-open pages keep their old iframe; its polling and sends start returning 404 with no UI feedback.
  4. No audit-log entry is written.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a live embedded widget, When the admin rotates the token, Then the old `/embed` and `/chat` URLs return 404 and the new ones work.
  - Given a widget from another workspace, Then 404.
  - Given a rotation, Then existing conversations remain in the inbox.
- **Source refs:** `app/Http/Controllers/ChatbotWidgetController.php` (rotateToken), `resources/js/charts/user-chatbot-widgets-index.js`, `app/Models/ChatbotWidget.php` (freshToken).
- **Port notes:** Store the visitor id under a key not derived from the token (for example the widget id) and add an audit-log entry (`widget.token_rotated`). Consider a short grace period option.

### TW-WGT-024 — Duplicate widget

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-WGT-006
- **Summary:** Clones a widget (all settings) into a new row with a fresh token and a "(copy)" name, then opens it in the builder.
- **Actors & access:** Admin with the plan feature. It is a normal form POST: without the feature the request is blocked and the user is sent back with a warning flash "Your plan doesn't include ... Upgrade to unlock this feature.".
- **UX & screens:** Duplicate icon in the row actions (a form with CSRF); the browser is redirected to the edit page of the copy. No confirmation and no success flash.
- **Endpoints:**

| Method + URI                          | Route name                       | Action                              | Middleware                    | Request   | Response                                                       |
| ------------------------------------- | -------------------------------- | ----------------------------------- | ----------------------------- | --------- | -------------------------------------------------------------- |
| POST `chatbot-widgets/{id}/duplicate` | `user.chatbot-widgets.duplicate` | `ChatbotWidgetController@duplicate` | admin role + plan gate + CSRF | path `id` | 302 to `chatbot-widgets/{newId}/edit`; 404 if not in workspace |

- **Data:** inserts a `chatbot_widgets` row replicated from the source excluding the id and token: `name` = source name + " (copy)", `slug` = source slug + "-copy-" + 4 random characters, new `embed_token`. Copied unchanged: `workspace_id`, `user_id` (the ORIGINAL author, not the current user), `assistant_id`, mode, WhatsApp fields, all styling, `status` (paused stays paused), `allowed_domains`. Visitors and conversations are not copied.
- **Rules & edge cases:**
  1. The copied name may exceed the 120-character column when the source name is at the limit (database error). The slug suffix is random, so uniqueness collisions are extremely unlikely but not checked.
  2. The copy goes live immediately (status active) with a fresh token; it does not appear embedded anywhere until a snippet is pasted.
  3. No plan-limit check (`chatbot_widgets_limit`).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given widget "Pricing" slug `pricing`, When duplicated, Then a new widget "Pricing (copy)" with slug `pricing-copy-xxxx` and a different token exists and the browser lands on its edit page.
  - Given an id from another workspace, Then 404.
  - Given the copy, Then it has zero visitors.
- **Source refs:** `app/Http/Controllers/ChatbotWidgetController.php` (duplicate), `resources/views/user/chatbot-widgets/index.blade.php`.
- **Port notes:** Implement as `POST /chatbot-widgets/:id/duplicate` returning the new resource (SPA navigates). Truncate names safely and use the current user as author.

### TW-WGT-025 — Delete widget

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-WGT-006
- **Summary:** Soft-deletes a widget so its snippet stops working; conversations stay in the team inbox.
- **Actors & access:** Admin with the plan feature.
- **UX & screens:** Coral trash icon opens a danger dialog "Delete '<name>'?" - "The embed snippet on your site will stop working immediately. Past conversations stay in your team inbox." (Delete widget / Keep). Success removes the row from the table with toast "Widget deleted."; failure toast "Delete failed - <reason>".
- **Endpoints:**

| Method + URI                  | Route name                     | Action                            | Middleware                    | Request   | Response                                 |
| ----------------------------- | ------------------------------ | --------------------------------- | ----------------------------- | --------- | ---------------------------------------- |
| DELETE `chatbot-widgets/{id}` | `user.chatbot-widgets.destroy` | `ChatbotWidgetController@destroy` | admin role + plan gate + CSRF | path `id` | 200 `{ok:true}`; 404 if not in workspace |

- **Data:** sets `chatbot_widgets.deleted_at` (soft delete). `chatbot_widget_visitors` rows and conversations are not touched (the FK cascade only fires on a hard delete). The visitors stat still counts the deleted widget's visitors.
- **Rules & edge cases:**
  1. After deletion embed, chat, config, message, history return 404; the slug remains reserved by the database unique index (see TW-WGT-006 rule 6).
  2. No restore UI, no trash view, no purge job.
  3. Existing conversations keep `routing_meta.widget_name` for context; new visitor messages cannot arrive.
  4. Visitors' agent replies can no longer be delivered to the visitor once the widget is gone (history 404), even though the inbox shows them as sent.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a live widget, When deleted, Then `/widget/{token}/embed` returns 404 and the list no longer shows it.
  - Given past conversations, Then they remain visible in Team Inbox.
  - Given another workspace's id, Then 404 and nothing is deleted.
- **Source refs:** `app/Http/Controllers/ChatbotWidgetController.php` (destroy), `app/Models/ChatbotWidget.php` (SoftDeletes), `resources/js/charts/user-chatbot-widgets-index.js`.
- **Port notes:** Soft delete with `deleted_at` and a partial unique index on slug; audit entry; keep visitors and conversations. Consider a 30-day undo.

### TW-WGT-026 — Pause and resume widget (status)

- **Status:** docs-only
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-WGT-006
- **Summary:** The data model and every public endpoint understand a widget status (`active` / `paused`) and the docs say a paused widget stops loading, but no admin screen or endpoint can change it.
- **Actors & access:** none reachable.
- **UX & screens:** The list shows Active/Paused pills and counts paused as `all - active`; the builder has no status control; the save API does not accept `status`.
- **Endpoints:** none.
- **Data:** `chatbot_widgets.status` varchar(16) default `active`, index `(workspace_id, status)`.
- **Rules & edge cases:**
  1. Every public route (`embed`, `chat`, `config`, `message`) filters `status = 'active'`, except `history` (no status filter) and the CORS middleware (no status filter).
  2. The only way to pause is direct database edit; a paused widget is copied as paused by Duplicate.
  3. The docs' Manage Widgets section advertises Pause; treat it as a missing feature.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a widget with status `paused` in the database, Then `/embed`, `/chat`, `config`, `message` return 404 and the list shows a Paused pill.
  - Given the port adds a toggle, Then pausing takes effect on the next request and resuming restores it.
- **Source refs:** `app/Http/Controllers/ChatbotWidgetPublicController.php`, `resources/views/user/chatbot-widgets/index.blade.php`, `Documentation/pages/automation/chatbot-widget.html`, `database/migrations/2026_05_18_100200_create_chatbot_widgets_table.php`.
- **Port notes:** Ship the toggle (PATCH `/chatbot-widgets/:id/status`) and make `history` respect it. Also enables the list status tabs (TW-WGT-001).

### TW-WGT-027 — Plan feature gate, role gate and unenforced widget limit

- **Status:** partial
- **Priority:** P0
- **Effort:** S
- **Depends on:** —
- **Summary:** Access to the widget builder requires the workspace role admin (or owner) and the plan feature `access_chatbot_widgets`. A package quota `chatbot_widgets_limit` is defined but never checked.
- **Actors & access:** Workspace admin/owner; platform admin bypasses everything.
- **UX & screens:** Nav item and "More" tile show a crown when the plan lacks the feature (`<x-plan-crown feature="access_chatbot_widgets">`). Opening a gated page (GET) renders it with a paywall sheet over it (also via the URL map in `config/plan_gates.php`: `chatbot-widgets` and `chatbot-widgets/*`).
- **Endpoints:** middleware `workspace.role:admin` and `plan:access_chatbot_widgets` (alias of `EnforcePlanFeature`) wrap all seven admin routes.
- **Data:** package columns `access_chatbot_widgets` (boolean) and `chatbot_widgets_limit` (unsigned int, nullable). Seeder: Starter off; Growth and Pro on (`PackageSeeder`). The admin package form (`admin/packages/create`) exposes both ("Chatbot website widgets").
- **Rules & edge cases:**
  1. Role check: users below admin are redirected (agent, viewer to `/team-inbox` with a warning) or get 403 (manager). Platform admins pass.
  2. Plan check per request: GET/HEAD page loads always pass but share `planPaywall` to the view; mutating requests are rejected. AJAX/JSON mutations get 403 `{ok:false,error:"plan_feature_disabled",feature,message}`; form POSTs get a redirect back with a `warning` flash.
  3. `chatbot_widgets_limit` and `ai_chat_messages_monthly` exist in `Package` fillables, the admin form and plan labels, but no code compares widget counts or AI chat message counts with them (grep-verified): creation is unlimited and public messages are unmetered.
  4. Public routes ignore the plan entirely: a downgraded workspace's embedded widgets keep working and replying with AI.
  5. There is no separate permission key (`WorkspacePermissions`) for widgets; access is role-hierarchy only.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** package flags above; platform admin package editor (PLAN).
- **Acceptance criteria:**
  - Given a Starter plan workspace, When an admin POSTs a save via AJAX, Then 403 `plan_feature_disabled`.
  - Given a Growth plan admin, Then all admin pages and actions work.
  - Given a plan with `chatbot_widgets_limit=1` and an existing widget, When a second widget is created, Then Reference allows it (parity) while the port should reject with a limit error (documented deviation).
  - Given a manager role, Then `/chatbot-widgets` returns 403.
- **Source refs:** `routes/web.php`, `app/Http/Middleware/EnforcePlanFeature.php`, `app/Http/Middleware/EnsureWorkspaceRole.php`, `config/plan_gates.php`, `app/Models/Package.php`, `database/seeders/PackageSeeder.php`, `database/migrations/2026_05_21_075220_add_calling_and_ai_to_packages.php`, `resources/views/admin/packages/create.blade.php`.
- **Port notes:** Implement as `@RequireFeature('chatbot_widgets')` plus `@RequirePermission('chatbot_widgets.manage')` (new RBAC key for admin/owner) and enforce `chatbot_widgets_limit` in the create path via the PLAN limit service. Decide whether public runtime also checks the plan (recommended: at least AI replies).

### TW-WGT-028 — Navigation entry points

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-WGT-001
- **Summary:** The widget list is reachable from the sidebar/top nav "Chat Widget" item, the "More" page tile, the quick-access customization list, the command palette and the admin-customizable menu list.
- **Actors & access:** Nav item tier `admin` (workspace admin+), feature flag `access_chatbot_widgets` (crown when missing).
- **UX & screens:** `app/Support/UserNav.php` (group containing Auto-reply, AI Training, AI Usage, Chat Widget, Warmer), `resources/views/components/user/header.blade.php` (item marked promo), `resources/views/user/more/index.blade.php` (tile "Chatbot Widget" with "N built / M active" counters and a crown), `app/Support/QuickAccess.php` (key `chatbots`, label "Chat Widgets"), `resources/js/threadwise.js` command palette entry ("Chatbot widgets"), `AdminPagesController` menu visibility list (key `chatbot-widgets`, label "Chat Widget", zone more; platform admin can hide it per plan/menu config).
- **Endpoints:** none.
- **Data:** the More tile counts `chatbot_widgets` of the workspace and those with `status='active'`.
- **Rules & edge cases:** Nav visibility respects the role tier; the crown links to pricing. Counters use the current workspace, not soft-deleted rows.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** admin menu configuration (ASHELL).
- **Acceptance criteria:**
  - Given an admin on a plan with the feature, Then the item appears in the nav and opens `/chatbot-widgets`.
  - Given an agent, Then the item is hidden.
  - Given the More page, Then the tile shows correct built/active counts.
- **Source refs:** `app/Support/UserNav.php`, `app/Support/QuickAccess.php`, `resources/views/components/user/header.blade.php`, `resources/views/user/more/index.blade.php`, `resources/js/threadwise.js`, `app/Http/Controllers/AdminPagesController.php`.
- **Port notes:** Register the module in the Next.js nav config with the feature flag and role; the More/dashboard tile can read counts from the list endpoint.

### TW-WGT-029 — Workspace data wipe and cascade behavior

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-WGT-006
- **Summary:** Widgets are removed when their workspace is removed or its expired-plan data is wiped, and related rows are cleaned by foreign keys.
- **Actors & access:** System (scheduled command `WipeExpiredWorkspaces`, workspace deletion).
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** `chatbot_widgets` is in the wipe command's list of tables deleted by `workspace_id`; FKs: `workspace_id` cascade (widgets and visitors), `widget_id` on visitors cascade, `user_id` set null, `assistant_id` set null, visitor `conversation_id` set null.
- **Rules & edge cases:**
  1. Deleting an assistant leaves the widget and clears `assistant_id`; the widget keeps `mode=ai` but `usesAi()` becomes false (silent, TW-WGT-003 rule 6).
  2. Deleting the owning user sets `user_id` null; new conversations then have `user_id` null.
  3. The wipe command's other tables (conversations, contacts, ai_chat_assistants) are cleaned in the same run; visitors go via the cascade.
- **Async & events:** the command runs on its own schedule (owned by WSP/CORE).
- **External systems:** none.
- **Settings:** plan `data_retention_days` (PLAN).
- **Acceptance criteria:**
  - Given a workspace hard-deleted, Then its widgets and visitors are gone.
  - Given an assistant hard-deleted, Then linked widgets have `assistant_id = null`.
- **Source refs:** `app/Console/Commands/WipeExpiredWorkspaces.php`, migrations `2026_05_18_100200_create_chatbot_widgets_table.php`, `2026_05_18_100300_create_chatbot_widget_visitors_table.php`.
- **Port notes:** Encode the same FK actions in Drizzle schema; the wipe becomes a tenant purge job (WSP).

### TW-WGT-030 — Legacy widget message backfill migration

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-WGT-014
- **Summary:** A one-time 1.4 migration copied widget chat bubbles from the legacy `messages` table into `inbox_messages` so historical widget threads are not blank in the team inbox.
- **Actors & access:** System, run once on upgrade.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** for every conversation whose `raw_jid` starts with `widget-`, copies each `messages` row to `inbox_messages` (direction normalized to `in|out`, status kept if valid else `delivered`/`sent`, `meta.widget_backfill=true`, `meta.channel` defaulted to `chatbot_widget`, timestamps preserved), saved quietly (no observers). Idempotent: conversations already having a backfilled row are skipped; `down()` force-deletes only backfilled rows.
- **Rules & edge cases:** provider taken from the conversation or the workspace engine (fallback `baileys`). This is history only; no runtime code depends on it.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a legacy widget thread with 4 `messages` rows and no inbox rows, When the migration runs, Then 4 `inbox_messages` rows exist with `meta.widget_backfill=true`; running again adds nothing.
- **Source refs:** `database/migrations/2026_07_10_120000_backfill_widget_messages_into_inbox_messages.php`.
- **Port notes:** Not needed for a greenfield port (no legacy data). If importing from a Reference database, include the welcome-message rows from `messages` where `meta.source='welcome'` when migrating widget threads.

## Port decisions: quirks reproduced deliberately

The project owner asked for the port to be the same as Reference in everything, bugs included. Each `QUIRK:` below was checked on the running reference and is
reproduced on purpose (tests carry the id; see `docs/threadwise-port/parity/chatbot-widget.md`).

- QUIRK (TW-WGT-017): the assistant answers only the first visitor message of a conversation: any outbound line counts as "a person took over". Reproduced.
- QUIRK (TW-WGT-020 rule 7): a non-empty allow-list blocks the chat page's own message POSTs (`cors_origin_denied`). Reproduced.
- QUIRK (TW-WGT-006 rule 4): saving with an id that is not in the workspace creates a new widget. Reproduced (`PATCH /v2/widgets/:id` with an unknown id creates).
- QUIRK (TW-WGT-006): a blank `allowed_domains` entry is a 422 "must be a string"; colours are any string up to 16 characters. Reproduced.
- QUIRK (TW-WGT-015 rule 4): the opening line goes to the legacy `messages` table, so agents never see it and a reload never repaints it. Reproduced.
- QUIRK (TW-WGT-012 rule 2): the transcript is the OLDEST 200 messages. Reproduced.
- QUIRK (TW-WGT-016 rule 4): the history sent to the model includes the visitor's new message, which is then also quoted as "Visitor just said". Reproduced.
- QUIRK (TW-WGT-018 rule 1, TW-WGT-011 rule 4): the history route ignores the status, and an unknown or missing visitor uuid creates a visitor row on every poll. Reproduced.
- QUIRK (TW-WGT-022 rule 2): one throttle counter per client address shared by the message and history routes of every widget; config has none. Reproduced.
- QUIRK (TW-WGT-001, 026): the status views are inert, nothing can pause a widget (no endpoint, no row action); the stat cards and footer are not touched by a delete; a rotation updates only the copy button. Reproduced.
- QUIRK (TW-WGT-024): a duplicate keeps the original author and a name at the limit grows past it. Reproduced.
- QUIRK (TW-WGT-009, 005): failed config shows a blank page with Send disabled; a refused message shows nothing; Enter sends even while Send is disabled; a double click on Launch creates two widgets. Reproduced.
- QUIRK (TW-WGT-023 rule 2): the remembered visitor key is built from the token. Reproduced.
- QUIRK (TW-WGT-027): `chatbot_widgets_limit` is never enforced; public routes ignore the plan. Reproduced.

What cannot be reproduced because the architecture forbids it is listed as `intended` in the parity file (uuid ids, hard delete, cursor pagination, tenant isolation,
problem+json on the admin API, the web app and API being two origins).

## Data model

### `chatbot_widgets` (model `ChatbotWidget`, soft deletes)

Purpose: one row per embeddable widget configuration. Expected volume: a handful per workspace. Read by all admin pages and, on every public request, by `embed_token`. Written by save, rotate, duplicate, delete.

| Column                                             | Type / default                                                    | Behavior                                                                                |
| -------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `id`                                               | bigint PK                                                         |                                                                                         |
| `workspace_id`                                     | bigint, FK `workspaces` cascade                                   | tenant scope; RLS column in the port                                                    |
| `user_id`                                          | bigint null, FK `users` set null                                  | author; also the `user_id` stamped on every conversation and message the widget creates |
| `assistant_id`                                     | bigint null, FK `ai_chat_assistants` set null                     | AI persona for modes `ai`/`both`                                                        |
| `name`                                             | varchar(120)                                                      | internal label, shown in list and used as the HTML title of the chat page               |
| `slug`                                             | varchar(140)                                                      | unique per workspace `(workspace_id, slug)` including trashed rows                      |
| `embed_token`                                      | varchar(64) unique                                                | 48 random alphanumeric chars; public bearer; rotatable                                  |
| `mode`                                             | varchar(16) default `ai`                                          | `ai`, `whatsapp`, `both`                                                                |
| `target_whatsapp_cc` / `target_whatsapp_number`    | varchar(8) / varchar(24) null                                     | dial code with `+`, national digits                                                     |
| `prefilled_message`                                | text null                                                         | wa.me text                                                                              |
| `position`                                         | varchar(16) default `bottom_right`                                | `bottom_right`, `bottom_left` (any other value renders as right)                        |
| `button_color`                                     | varchar(16) default `#075E54`                                     | launcher fill                                                                           |
| `button_image_url`                                 | varchar(1024) null                                                | custom launcher icon                                                                    |
| `header_title`                                     | varchar(120) default "Chat with us"                               | window title                                                                            |
| `header_bg` / `header_text_color`                  | varchar(16) `#075E54` / `#FFFFFF`                                 | header colours                                                                          |
| `welcome_message`                                  | text null                                                         | opening line                                                                            |
| `message_bubble_color` / `message_text_color`      | varchar(16) `#FFFFFF` / `#222222`                                 | business-side bubble colours                                                            |
| `body_bg_kind`                                     | varchar(8) default `color`                                        | `color`, `image`                                                                        |
| `body_bg_color`                                    | varchar(16) default `#ECE5DD`                                     |                                                                                         |
| `body_bg_image_url`                                | varchar(1024) null                                                | tile image                                                                              |
| `auto_open`                                        | tinyint default 0                                                 | open panel after 1.2 s                                                                  |
| `button_label`                                     | varchar(80) default "Start chat" (builder default "Send message") | send-button text                                                                        |
| `action_button_bg` / `action_button_text_color`    | varchar(16) `#075E54` / `#FFFFFF`                                 | send-button colours                                                                     |
| `collect_name` / `collect_email` / `collect_phone` | tinyint default 1 / 0 / 0                                         | pre-chat intake flags                                                                   |
| `status`                                           | varchar(16) default `active`                                      | `active`, `paused`; no UI writes it                                                     |
| `allowed_domains`                                  | JSON null                                                         | array of `host[:port]`; empty or null = allow all                                       |
| `created_at`, `updated_at`, `deleted_at`           | timestamps                                                        |                                                                                         |

Indexes: unique `(workspace_id, slug)`, unique `embed_token`, `(workspace_id, status)`, FK indexes on `user_id` and `assistant_id`. Written by TW-WGT-006, -023, -024, -025.

### `chatbot_widget_visitors` (model `ChatbotWidgetVisitor`)

Purpose: one row per anonymous browser per widget, linking it to a conversation. Volume: potentially large (one per browser that loads a page with the widget; no purge). Written on every public call (last_seen) and by message (profile).

| Column                          | Type                                    | Behavior                                                                |
| ------------------------------- | --------------------------------------- | ----------------------------------------------------------------------- |
| `id`                            | bigint PK                               |                                                                         |
| `workspace_id`                  | bigint FK cascade                       |                                                                         |
| `widget_id`                     | bigint FK `chatbot_widgets` cascade     |                                                                         |
| `conversation_id`               | bigint null FK `conversations` set null | set when the first message creates the conversation                     |
| `visitor_uuid`                  | varchar(64) unique                      | server-generated UUIDv4; browser stores it in localStorage and a cookie |
| `name`, `email`, `phone`        | varchar(120), (191), (32) null          | intake values; last non-empty write wins                                |
| `referrer_url`                  | varchar(1024) null                      | Referer header at creation                                              |
| `user_agent`                    | varchar(512) null                       |                                                                         |
| `ip`                            | varchar(64) null                        | request IP                                                              |
| `first_seen_at`, `last_seen_at` | timestamp null                          | last_seen refreshed on every call                                       |
| `created_at`, `updated_at`      | timestamp                               |                                                                         |

Indexes: unique `visitor_uuid`, `(workspace_id, widget_id)`, FK indexes. Written by TW-WGT-010, -011, -014, -015.

### Tables touched but owned elsewhere

- `conversations` (TIB1): widget rows use `channel='chatbot_widget'`, `origin='web'`, `platform='WIDGET'`, `raw_jid='widget-<id>-<uuid>'`, `routing_meta` JSON, `contact_id`.
- `inbox_messages` (TIB1): inbound/outbound bubbles; `body`, `from_number`, `to_number` encrypted.
- `messages` (legacy, CHAT): welcome-message seed only.
- `contacts` (CON): one contact per visitor (`channel='chatbot_widget'`, `channel_uid=<uuid>`) or a phone-matched existing contact.
- `ai_chat_assistants`, `ai_training_sources` (AIAG): persona and knowledge base.
- `packages` (PLAN): `access_chatbot_widgets`, `chatbot_widgets_limit`, `ai_chat_messages_monthly`.

## Cross-domain contracts

- **Consumes AIAG:** `AiChatService::reply(assistant, conversation, message)` and `contextFor(assistant)` (assistant persona, ready training sources, fallback message, handoff hint) and the assistant picker listing (active assistants of the workspace, id and name). AI Training UI, source ingestion and assistant CRUD are AIAG; the widget only stores `assistant_id`.
- **Consumes AIADM / WALLET:** provider key resolution (BYOK vs platform key) and token metering happen inside `AiAgentService::callProvider`; the widget adds no wallet charge, no per-plan message cap.
- **Consumes TIB1:** conversation and `inbox_messages` schema, unified inbox list/thread/reply, `InboxDispatcher` local-delivery branch for engine-agnostic channels, "Web widget" channel badge, engine-scope exemption. **Exposes to TIB1:** conversations with `channel='chatbot_widget'` and outbound polling contract (any outbound `inbox_messages` row in the visitor's conversation is delivered to the widget).
- **Consumes CON:** `Contact::hashPhone`, `contacts.channel`/`channel_uid`. **Exposes:** one contact per widget visitor.
- **Consumes NOTIF:** inbound push notifier and translation observers fire from the `InboxMessage` created hook.
- **Consumes I18N:** `ConversationTranslationService::config/ingestInbound`, `Translator::detect` for the AI language hint.
- **Consumes PLAN:** `EnforcePlanFeature`, `PlanLimitGuard::hasFeature`, package columns; **Exposes:** feature keys `access_chatbot_widgets`, `chatbot_widgets_limit`.
- **Consumes RBAC/WSP:** `workspace.role:admin` middleware and workspace membership; wipe command and FK cascades.
- **Consumes ASHELL/CORE:** `SecurityHeaders` framing exemption for `widget/*`; CSRF exclusion `widget/*/api/*`; navigation registries.
- **Consumes WADEV/WABA:** `WorkspaceEngine::for(workspaceId)` only to stamp `conversations.provider`; the WhatsApp deep link is a plain wa.me URL.
- **Exposes to MOB:** widget conversations returned from the mobile chat list with `channel: chatbot_widget`.
- **Does NOT integrate with:** TIB2 (routing, SLA, assignment), AR (auto-reply), FLR (flows), INTG (outgoing webhooks), CSAT.

## Open questions & quirks

1. QUIRK, likely bug: the human-takeover check compares the encrypted `from_number` column with a plaintext string in SQL, so the AI probably answers only the first visitor message of a conversation (TW-WGT-017). Verify with a live run before deciding the port's target behavior; the intended behavior is documented.
2. QUIRK: `allowed_domains` has no UI (TW-WGT-021), and as implemented a non-empty list may block the widget's own message POSTs because the iframe is same-origin with Reference and the middleware checks the POST `Origin` (TW-WGT-020). The list also never restricts who can embed. The migration comment claims "empty = block all" while the model implements "empty = allow all".
3. QUIRK: pause/resume is advertised in the docs and honored by the public routes but nothing can set `status` (TW-WGT-026). `history` and the CORS middleware ignore `status`.
4. QUIRK: `chatbot_widgets_limit` and `ai_chat_messages_monthly` are configurable but never enforced; public routes ignore the plan (TW-WGT-027).
5. QUIRK: the list page's status tabs and left rail buttons are inert; search only filters the current page (TW-WGT-001).
6. QUIRK: saving with an `id` from another workspace or a deleted widget silently creates a new widget (TW-WGT-006). Re-creating a widget whose slug matches a soft-deleted one causes a unique-constraint 500 (TW-WGT-006).
7. QUIRK: the welcome message is stored in the legacy `messages` table and therefore probably not visible in the team-inbox thread, contradicting the docs (TW-WGT-015). Also absent from the widget's own transcript after the first message.
8. QUIRK: the transcript repaint takes the oldest 200 messages, not the newest (TW-WGT-012).
9. QUIRK: the hidden iframe loads on every page view, so visitors are counted for people who never open the chat; config has no throttle and creates rows, history also creates rows for unknown uuids (TW-WGT-008, -010, -011).
10. QUIRK: the iframe swallows non-2xx JSON responses (403/404/422/429) without any visible error, and an invalid intake email makes every message fail silently (TW-WGT-005, -009).
11. QUIRK: token rotation changes the localStorage key used to remember a visitor, orphaning returning visitors whose cookie is blocked (TW-WGT-023). The docs claim rotation leaves conversations unaffected; that holds for stored data but not for visitor continuity.
12. QUIRK: whatsapp-only widgets still expose a working text input whose messages land in the inbox with no reply (TW-WGT-003).
13. QUIRK: throttle counters are per IP and shared between `message` and `history` and other guest throttles, not "per visitor" as the docs say (TW-WGT-022).
14. QUIRK: the docs snippet uses `/embed.js` with `async`, the UI generates `/embed` with `defer`; docs say the send-button colours style the WhatsApp button (they do not); docs say the welcome message is visible to agents (see 7).
15. Widget threads skip routing, SLA, auto-reply, flows, webhooks and notification-dispatcher alerts, and inbound does not reopen resolved conversations. Confirm with TIB1/TIB2 owners which of these the port should add (recommended yes).
16. Demo seeder `DemoGapSeeder` creates one widget with `position='right'` (invalid, renders as right), `mode='both'`, a 24-char token and `allowed_domains=['demo.co']`; the seeded row would hit the quirks in item 2.
17. Data retention: there is no purge, export or consent for visitor IP / user agent / referrer (privacy review needed for the port).
18. `Message::$skipInboxMirror` is a process-wide static set in the public controller constructor; in long-running workers this would leak (irrelevant under PHP-FPM, avoid in the port).
19. `resources/views/public/widget/chat.blade.php` and `app/Services/AiChat/AiChatService.php` are claimed here; AIAG may also claim `AiChatService` (shared, `contextFor` is used by the Flow AI node). `SecurityHeaders`, `bootstrap/app.php` CSRF list and `config/plan_gates.php` are shared config owned by ASHELL/CORE/PLAN and are described here but not claimed.
20. AI usage and cost of the widget's synchronous LLM call are not attributed to the widget or conversation in any widget-owned table; the AI meter (AIADM) sees only workspace-level usage.

## Coverage

```json threadwise-coverage
{
  "routes": [
    "GET chatbot-widgets",
    "GET chatbot-widgets/create",
    "GET chatbot-widgets/{id}/edit",
    "POST chatbot-widgets/api/save",
    "POST chatbot-widgets/{id}/duplicate",
    "POST chatbot-widgets/{id}/rotate-token",
    "DELETE chatbot-widgets/{id}",
    "GET widget/{token}/embed",
    "GET widget/{token}/embed.js",
    "GET widget/{token}/chat",
    "GET widget/{token}/api/config",
    "POST widget/{token}/api/message",
    "GET widget/{token}/api/history"
  ],
  "controllers": [
    "app/Http/Controllers/ChatbotWidgetController.php",
    "app/Http/Controllers/ChatbotWidgetPublicController.php"
  ],
  "services": ["app/Services/AiChat/AiChatService.php"],
  "models": ["ChatbotWidget", "ChatbotWidgetVisitor"],
  "tables": ["chatbot_widgets", "chatbot_widget_visitors"],
  "views": [
    "resources/views/user/chatbot-widgets/builder.blade.php",
    "resources/views/user/chatbot-widgets/index.blade.php",
    "resources/views/public/widget/chat.blade.php"
  ],
  "commands": [],
  "permissions": [],
  "middleware": ["app/Http/Middleware/ChatbotWidgetCors.php"],
  "node_files": [],
  "js_assets": [
    "resources/js/charts/user-chatbot-widgets-builder.js",
    "resources/js/charts/user-chatbot-widgets-index.js"
  ],
  "misc_files": [],
  "config_files": [],
  "doc_pages": ["Documentation/pages/automation/chatbot-widget.html"],
  "feature_map": {
    "TW-WGT-001": ["GET chatbot-widgets"],
    "TW-WGT-002": ["GET chatbot-widgets/create", "GET chatbot-widgets/{id}/edit"],
    "TW-WGT-006": ["POST chatbot-widgets/api/save"],
    "TW-WGT-008": ["GET widget/{token}/embed", "GET widget/{token}/embed.js"],
    "TW-WGT-009": ["GET widget/{token}/chat"],
    "TW-WGT-010": ["GET widget/{token}/api/config"],
    "TW-WGT-014": ["POST widget/{token}/api/message"],
    "TW-WGT-018": ["GET widget/{token}/api/history"],
    "TW-WGT-023": ["POST chatbot-widgets/{id}/rotate-token"],
    "TW-WGT-024": ["POST chatbot-widgets/{id}/duplicate"],
    "TW-WGT-025": ["DELETE chatbot-widgets/{id}"]
  }
}
```
