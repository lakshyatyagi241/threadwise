---
domain: notifications-activity-audit
code: NOTIF
title: Notifications, Activity Log, Audit Log, Push and Mail Templates
threadwise_version: '1.7.0'
sources_read: 78
---

# Notifications, Activity Log, Audit Log, Push and Mail Templates

## Overview

This domain is everything Reference uses to tell a person "something happened" or to prove "who did what":

1. **Workspace in-app notifications** (`notifications` table). A per-workspace bell and a full `/notifications` page. Rows are written by a static helper (`NotificationHelper`) that consults the workspace owner's channel preferences, stamps the workspace, encrypts title and message, and optionally fans out to email and Slack. Most rows are auto-recorded from create/update/delete hooks on thirteen models.
2. **Team-inbox notifications** (`inbox_notifications` table). A second, separate feed written by `NotificationDispatcher` (assignment, @mention, resolved, snooze wake, deals, tasks, sales docs, new leads). It is de-duplicated for 30 seconds and mirrors each row to browser Web Push.
3. **Push delivery**. Browser Web Push (VAPID) for the Team-Inbox PWA and Firebase Cloud Messaging (FCM v1) for the mobile app, plus their admin configuration screens and subscription/token registries.
4. **Audit trail** (`audit_logs`, `security_audit_log`). One writer facade (`Audit`, over `AuditLogger`) feeds two readers: the workspace-admin **Activity Log** (`/activity-log`) and the platform-admin **Audit Log** (`/admin/audit-log`), with CSV export and a retention prune.
5. **Admin platform notifications**. A live-derived feed (no table) of signups, orders, support tickets, contact messages and new workspaces for super-admins.
6. **Transactional mail templates**. Four Mailable classes (verify email, admin welcome, team invite, support reply) and two raw-text mails (new-login alert, notification email channel), plus the readiness checks that decide whether a mail is attempted.

Actors: workspace member (own bell), workspace owner (notification preferences), workspace admin or owner (Activity Log), platform admin (Audit Log, admin notifications, push settings), mobile app and browser PWA (push registration), and end customers or invitees (recipients of mail).

Plan tiers: nothing in this domain is gated by a plan feature key or limit. Access is by workspace role (`EnsureWorkspaceRole:admin` on the Activity Log), platform-admin middleware (`EnsureUserIsAdmin` + `IPAllowlist`) or workspace ownership (preferences). Platform admins bypass workspace-role gates.

Connections to other domains: AUTH (auth events are audited here; verify-email and login-alert mails; security policy toggles live there), RBAC (permission keys `audit.view`, `audit.export`, `platform.audit.view`), WSP (`workspaces.notification_prefs`, members, invites), TIB1 and TIB2 (conversation events call the dispatcher; the sweep triggers), DEAL and CTP (deal and task reminders), SALES (proposal decisions), AIAG (AI handoff), MOB (device-token registration routes and app notification list routes that read this domain's tables), SET (mail transport settings, PWA settings page, SMTP test), WADEV (device connect/disconnect notifications), WALLET (low-balance alert), SUPP (support reply mail), DASH (dashboard activity widgets read `audit_logs`), INST (updater backup skips the `notifications` rows), CORE (broadcast events, cache, terminating hooks).

Main flows end to end:

- An operator saves a template; the model `created` hook calls `NotificationHelper::record`; the helper resolves the workspace, checks the owner's `template` category in-app preference, inserts an encrypted `notifications` row (unread), and, if the owner enabled email or Slack for that category, sends deferred fail-open messages. The header bell polls `/notifications/recent` every 60 seconds and shows the unread badge.
- A teammate is @mentioned in an internal note; the dispatcher writes an `inbox_notifications` row (deduped), bumps the participant's mention counter, and sends Web Push to the mentioned agent if the Team-Inbox PWA feature is on.
- A customer message arrives; the webhook controller defers an FCM push to mobile tokens pinned to the receiving number, and the model hook defers a Web Push to the assigned agent (or all opted-in agents).
- Any sensitive action calls `Audit::log(...)`; secrets are scrubbed from the payload; IP and user agent are captured from the request; both audit UIs read the same rows.

## Feature index

| Id           | Feature                                                                                         | Status      | Priority | Effort | Depends on                 |
| ------------ | ----------------------------------------------------------------------------------------------- | ----------- | -------- | ------ | -------------------------- |
| TW-NOTIF-001 | Notification emission core (helper, preference gating, workspace stamping)                      | implemented | P0       | M      | —                          |
| TW-NOTIF-002 | Email and Slack delivery of notifications                                                       | implemented | P1       | S      | TW-NOTIF-001               |
| TW-NOTIF-003 | Auto-recorded model-event notifications                                                         | implemented | P1       | M      | TW-NOTIF-001               |
| TW-NOTIF-004 | Explicit system notifications (welcome, profile, password, workspace, device state, wallet low) | implemented | P1       | S      | TW-NOTIF-001               |
| TW-NOTIF-005 | Workspace notification preferences (settings tab)                                               | implemented | P1       | M      | TW-NOTIF-001               |
| TW-NOTIF-006 | Header notification bell                                                                        | implemented | P0       | M      | TW-NOTIF-001               |
| TW-NOTIF-007 | Notifications page (feed, KPIs, filters, search)                                                | implemented | P0       | M      | TW-NOTIF-001               |
| TW-NOTIF-008 | Mark read, dismiss and clear notifications                                                      | implemented | P0       | S      | TW-NOTIF-001               |
| TW-NOTIF-009 | Legacy notifications-page route                                                                 | dead-code   | P2       | S      | TW-NOTIF-007               |
| TW-NOTIF-010 | Do-not-disturb and quiet hours                                                                  | docs-only   | P2       | S      | TW-NOTIF-007               |
| TW-NOTIF-011 | Catalogued events that nothing emits                                                            | docs-only   | P2       | S      | TW-NOTIF-005               |
| TW-NOTIF-012 | Team-inbox notification dispatcher core                                                         | implemented | P0       | M      | —                          |
| TW-NOTIF-013 | Conversation notifications (assign, mention, resolved, snooze wake)                             | implemented | P0       | M      | TW-NOTIF-012               |
| TW-NOTIF-014 | SLA-breach notification                                                                         | dead-code   | P2       | S      | TW-NOTIF-012               |
| TW-NOTIF-015 | CRM notifications (deals, tasks, proposals, new lead)                                           | implemented | P1       | M      | TW-NOTIF-012               |
| TW-NOTIF-016 | AI hand-off notification                                                                        | partial     | P1       | S      | TW-NOTIF-012               |
| TW-NOTIF-017 | Team-inbox notification feed API                                                                | partial     | P1       | S      | TW-NOTIF-012               |
| TW-NOTIF-018 | Web Push sender and VAPID key generation                                                        | implemented | P1       | M      | —                          |
| TW-NOTIF-019 | Team-Inbox PWA push enrolment (manifest, key, subscribe, unsubscribe, service worker)           | implemented | P1       | M      | TW-NOTIF-018               |
| TW-NOTIF-020 | Inbound-message Web Push to agents                                                              | implemented | P1       | S      | TW-NOTIF-018               |
| TW-NOTIF-021 | In-tab desktop alert and ping sound                                                             | implemented | P2       | S      | —                          |
| TW-NOTIF-022 | Mobile push (FCM) admin settings                                                                | implemented | P1       | S      | —                          |
| TW-NOTIF-023 | FCM v1 sender                                                                                   | implemented | P1       | M      | TW-NOTIF-022               |
| TW-NOTIF-024 | Mobile device-token registry                                                                    | implemented | P1       | S      | TW-NOTIF-023               |
| TW-NOTIF-025 | Inbound-message FCM push to mobile operators                                                    | implemented | P1       | M      | TW-NOTIF-023, TW-NOTIF-024 |
| TW-NOTIF-026 | Audit write pipeline (facade, layers, redaction)                                                | implemented | P0       | M      | —                          |
| TW-NOTIF-027 | Authentication event auditing                                                                   | implemented | P0       | S      | TW-NOTIF-026               |
| TW-NOTIF-028 | Model-observer auditing of platform models                                                      | implemented | P1       | S      | TW-NOTIF-026               |
| TW-NOTIF-029 | Workspace Activity Log page                                                                     | implemented | P1       | L      | TW-NOTIF-026               |
| TW-NOTIF-030 | Activity Log event detail                                                                       | implemented | P1       | S      | TW-NOTIF-029               |
| TW-NOTIF-031 | Activity Log CSV export                                                                         | implemented | P1       | S      | TW-NOTIF-029               |
| TW-NOTIF-032 | Admin Audit Log page                                                                            | implemented | P1       | M      | TW-NOTIF-026               |
| TW-NOTIF-033 | Admin Audit Log event detail                                                                    | implemented | P1       | S      | TW-NOTIF-032               |
| TW-NOTIF-034 | Admin Audit Log CSV export                                                                      | implemented | P1       | S      | TW-NOTIF-032               |
| TW-NOTIF-035 | Audit retention pruning                                                                         | implemented | P1       | S      | TW-NOTIF-026               |
| TW-NOTIF-036 | Admin team-inbox audit JSON                                                                     | implemented | P2       | S      | TW-NOTIF-026               |
| TW-NOTIF-037 | Security audit log (write-only)                                                                 | partial     | P2       | S      | —                          |
| TW-NOTIF-038 | Admin platform notification feed page                                                           | implemented | P1       | M      | —                          |
| TW-NOTIF-039 | Admin notification bell, mark read and clear                                                    | implemented | P1       | S      | TW-NOTIF-038               |
| TW-NOTIF-040 | Outbound mail readiness rules                                                                   | implemented | P1       | S      | —                          |
| TW-NOTIF-041 | Verify-email mail                                                                               | implemented | P0       | S      | TW-NOTIF-040               |
| TW-NOTIF-042 | Admin welcome mail                                                                              | implemented | P1       | S      | TW-NOTIF-040               |
| TW-NOTIF-043 | Team-invite mail                                                                                | implemented | P1       | S      | TW-NOTIF-040               |
| TW-NOTIF-044 | Support ticket reply mail                                                                       | implemented | P1       | S      | TW-NOTIF-040               |
| TW-NOTIF-045 | New-login security alert mail                                                                   | implemented | P1       | M      | TW-NOTIF-026, TW-NOTIF-027 |

## Features

### TW-NOTIF-001 — Notification emission core (helper, preference gating, workspace stamping)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** none
- **Summary:** A single static entry point that every backend code path uses to raise a workspace-visible notification for one user. It decides, from the owning workspace's preferences, whether an in-app row is written, stamps the row with the right workspace so it cannot leak across tenants, encrypts the text, and hands off to the email and Slack channels.
- **Actors & access:** Called by server code only (controllers, model hooks, services); no HTTP surface of its own. No permission key, no plan gate. Scope is workspace (row carries `workspace_id`) with an optional personal user pin.
- **UX & screens:** None directly. Result surfaces in TW-NOTIF-006 (bell) and TW-NOTIF-007 (page).
- **Endpoints:** none.
- **Data:** Writes `notifications` (`user_id`, `workspace_id`, `category`, `severity`, `icon`, `notification_title` encrypted, `notification_msg` encrypted, `source_type`, `source_id`, `verb`, `action_url`, `is_urgent`, `status`=1 meaning unread). Reads `users.current_workspace_id`, `workspaces.notification_prefs`, `users.email`.
- **Rules & edge cases:**
  1. Signature: recipient user id (nullable), title, message, options. Options: `event` (preference key; falls back to `category`, then `system`), `category` (default `system`), `severity` (default `info`), `icon`, `source_type`, `source_id`, `verb`, `action_url`, `is_urgent` (default false), `workspace_id`, `force` (bypass all preference muting; documented as for security-critical alerts), `extra` (raw extra columns merged into the insert).
  2. Preference workspace resolution: explicit `workspace_id` option wins; otherwise the recipient's current workspace. Rationale in code: an event raised for workspace A must not be gated by whatever workspace the recipient is currently viewing.
  3. In-app row is created only if `force`, or there is no workspace, or the workspace's preference for (event, `inapp`) is true (see TW-NOTIF-005 for resolution order).
  4. Row workspace stamp: explicit option, else the recipient's `current_workspace_id`, else the acting user's current workspace. Any row can therefore end up with NULL workspace only when all three are empty.
  5. Every new row is unread (`status` true), regardless of severity.
  6. Title and message are encrypted at rest through the model cast; SQL cannot search them (this is why the page filters in memory, TW-NOTIF-007).
  7. Convenience wrappers: success (severity `success`), warning (severity `warning`, urgent true), error (severity `danger`, urgent true). Wrapper return types promise a row but the core returns null when muted, so a muted in-app preference would raise a type error if these wrappers were used. No caller uses them today.
  8. `toAdmins` (all users whose legacy `role` is `A` or `admin`; falls back to a null-user row if none) exists but has no caller.
  9. Email and Slack fan-out only runs if a workspace could be resolved (TW-NOTIF-002).
  10. QUIRK: the personal notifications ("Password changed") are stamped with the recipient's current workspace, so under the visibility scope in TW-NOTIF-007 every member of that workspace sees them, contrary to the docs which say personal items show only for the recipient.
  11. QUIRK: no retention or prune exists for `notifications`; the updater's backup code notes 194k rows seen live and skips dumping rows of this table.
- **Async & events:** None queued. Email and Slack legs are deferred to the application terminating phase (after response) and fail open. No websocket broadcast; the UI polls.
- **External systems:** None directly (see TW-NOTIF-002).
- **Settings:** `workspaces.notification_prefs` JSON (TW-NOTIF-005). No .env keys.
- **Acceptance criteria:**
  - Given a workspace whose owner turned off in-app for category `template`, when a template is created, then no `notifications` row is created and no error surfaces.
  - Given `force` is true and the in-app preference is off, when the helper is called, then the row is still created.
  - Given a notification raised with `workspace_id` A for a user currently viewing workspace B, when B's owner has muted the event, then the row is still created because A's preference is consulted.
  - Given a created row, when read from the database directly, then title and message are ciphertext and `status` is 1.
  - Given no explicit workspace and a recipient with no current workspace and no acting user, when the helper runs, then the row is created with NULL workspace (only visible as a personal row to that user).
- **Source refs:** app/Helpers/NotificationHelper.php, app/Models/Notification.php, app/Models/Workspace.php (wantsNotification), database/migrations/2026_05_05_000010_create_notifications_table.php, database/migrations/2026_05_19_120000_add_workspace_id_to_legacy_tables.php
- **Port notes:** New home `apps/api/src/modules/notifications/` with a `NotificationsService.emit()` and a Drizzle `notifications` table with `org_id` and RLS. Do not copy the encrypt-then-scan-in-memory design: store title and message in plaintext columns (or encrypt with a searchable strategy) and search in SQL. Make the recipient explicit: keep `user_id` nullable for workspace-shared rows, and decide deliberately whether personal alerts (password changed) are user-only rows (recommended, fixes the leak in quirk 10). Emit through the outbox so email/Slack legs run in a BullMQ worker instead of a terminating callback.

### TW-NOTIF-002 — Email and Slack delivery of notifications

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-NOTIF-001
- **Summary:** In addition to the bell, a notification can be emailed to the recipient and posted to a Slack incoming webhook, per event and per category, as chosen by the workspace owner. Both are off by default except for a short list of critical events.
- **Actors & access:** System. Configured by the workspace owner (TW-NOTIF-005). No plan gate.
- **UX & screens:** Channel toggles and webhook URL in Settings, notifications tab. The notifications page KPI "Delivery" lists active channels (In-app always, Email when a real mailer is configured, Slack when a webhook is stored).
- **Endpoints:** none.
- **Data:** Reads `workspaces.notification_prefs` (including `_slack_webhook`), `users.email`. Writes nothing.
- **Rules & edge cases:**
  1. Email leg runs only if the workspace preference for (event, `email`) is true or `force`, and the recipient has a syntactically valid email. Subject is the notification title; body is the plain message text (raw text mail, no template, no brand wrapper).
  2. Email is a silent no-op when the default mailer is unset, `array` or `log`.
  3. Slack leg runs only if (event, `slack`) is true or `force`, and a non-empty webhook URL is stored. The URL must start with https (case-insensitive) or it is skipped. Payload is a single text field: bold title, newline, message. HTTP timeout 8 seconds. No retry.
  4. Both legs are deferred until after the response (or run inline in CLI contexts) and swallow every exception with a warning log line.
  5. The recipient email is the user who is the row's recipient, not the workspace owner. A workspace-shared event addressed to a null user never emails anyone.
  6. Defaults (see TW-NOTIF-005): email on for `device_disconnected`, `wallet_low_balance`, `payment_failed`, `sla_breached`, `campaign_failed`, `webhook_delivery_failed`, `integration_disconnected`, `weekly_summary`; Slack on for `wallet_low_balance` and `sla_breached`.
  7. QUIRK: because the Slack URL is only checked to be https at delivery time (and the settings form only validates `url` format, max 255), any https endpoint receives notification text, not only Slack.
- **Async & events:** After-response callbacks; recommended port: BullMQ jobs `notification-email`, `notification-slack` with retry and dead-letter.
- **External systems:** SMTP through the platform mailer (see TW-NOTIF-040); Slack incoming webhook URL stored per workspace inside `notification_prefs._slack_webhook`.
- **Settings:** Workspace: per-event and per-category channel toggles, Slack webhook URL. Platform: mail transport (SET domain).
- **Acceptance criteria:**
  - Given `wallet_low_balance` email default and a valid mailer, when the low-balance alert is raised for an owner with an email, then one raw-text mail with the alert title as subject is sent after the response.
  - Given a Slack webhook `http://...`, when Slack is enabled for the event, then nothing is posted.
  - Given the mailer is `log`, when email is enabled, then no mail is sent and no error is raised.
  - Given the Slack endpoint returns 500, when the alert fires, then the bell row is still created and a warning is logged.
- **Source refs:** app/Helpers/NotificationHelper.php, app/Models/Workspace.php, resources/views/user/settings/index.blade.php, Documentation/pages/account/notifications.html
- **Port notes:** Implement as two outbox consumers. Store the Slack webhook encrypted (Reference stores it in plain JSON). Use the shared transactional mail service rather than a raw mail call, and honour the same readiness rules as TW-NOTIF-040.

### TW-NOTIF-003 — Auto-recorded model-event notifications

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-NOTIF-001
- **Summary:** Thirteen domain models write a notification automatically whenever a row is created, updated or deleted, with a human title, category, icon and deep link derived from the model type, so the notifications page acts as an activity feed with no per-controller code.
- **Actors & access:** System. Recipient is the record's `user_id` column if present, else the acting user. No permission or plan gate.
- **UX & screens:** Rows appear in the bell and page (TW-NOTIF-006, 007). The page tip card reads "Auto-recorded" and explains this.
- **Endpoints:** none.
- **Data:** Same as TW-NOTIF-001. Category map (model to category, icon, link): Device (device, `/devices/{id}`), WaTemplate (template, `/templates/{id}/edit`), ChatTemplate (template, `/chat`), MetaCampaign (campaign, `/meta-ads/{id}`), Broadcast (broadcast, `/broadcasts/{id}`), Webhook (webhook, `/webhooks/{id}`), Package (billing, `/pricing`), Contact (contact, `/contacts`), ContactGroup (contact, `/contacts/groups`), WpCampaign (campaign, `/wa-campaigns/{id}`). Any other model (Flow, Workspace, Attribute) falls to category `system`, icon `system`, no link. Map also lists Conversation, Message, WebhookDelivery, PackageFeature, BroadcastContact but none of those carries the trait.
- **Rules & edge cases:**
  1. Trait attached to: Flow, Workspace, WaTemplate, WpCampaign, Package, Broadcast, ContactGroup, Device, MetaCampaign, Webhook, Contact, ChatTemplate, Attribute. A model may restrict events by declaring a list; no model does, so all three events fire everywhere.
  2. Title is "{Noun} {verb}" plus ": {name}" when a display name exists. Name is the first non-empty of template_name, pname, name, title, campaign_name, phone_number, webhook_url, subject, plan_id, device_name. Message is "{Noun} {verb} "{name up to 64 chars}" by {actor name or email or 'system'}."
  3. Severity: `warning` for deleted, `info` otherwise. Not urgent. Action URL is omitted for deleted rows.
  4. Workspace stamp is the model's own `workspace_id` (never the actor's current workspace), fixing a reported cross-workspace leak. Models without the column (Package) fall through to the recipient's current workspace.
  5. The preference key equals the category (event falls back to category), so the "By category" toggles in settings govern these rows.
  6. `source_type` stores the model class name, `source_id` the key, `verb` created/updated/deleted.
  7. QUIRK: updates fire on every save, including invisible bookkeeping updates (status counters, last-active stamps), so noisy models can flood the feed. `updated` on Workspace also fires for internal writes.
  8. QUIRK: Package edits (admin action) notify the admin user in whatever workspace the admin currently views.
  9. The hook runs synchronously inside the model event; a failure inside record could break the save because there is no try/catch around it (only the channel legs are guarded).
- **Async & events:** Model events created/updated/deleted. No queue.
- **External systems:** none.
- **Settings:** Category toggles (TW-NOTIF-005).
- **Acceptance criteria:**
  - Given a workspace member creates a Contact named "Ada", then a `notifications` row exists with category `contact`, title "Contact created: Ada", link `/contacts`, severity `info`, unread.
  - Given a Broadcast is deleted, then the row has severity `warning` and no action URL.
  - Given the owner muted category `contact` in-app, when a contact is created, then no row is written.
  - Given a Contact in workspace A is edited by a user currently viewing workspace B, then the row is stamped with workspace A.
- **Source refs:** app/Models/Concerns/LogsNotifications.php, app/Helpers/NotificationHelper.php, app/Models/Flow.php, app/Models/Workspace.php, app/Models/WaTemplate.php, app/Models/WpCampaign.php, app/Models/Package.php, app/Models/Broadcast.php, app/Models/ContactGroup.php, app/Models/Device.php, app/Models/MetaCampaign.php, app/Models/Webhook.php, app/Models/Contact.php, app/Models/ChatTemplate.php, app/Models/Attribute.php
- **Port notes:** Prefer emitting from domain services (or the outbox event stream) rather than ORM hooks. Decide a per-entity allow-list of verbs to avoid the update noise; keep created and deleted at least. Keep the category set stable (contact, template, campaign, broadcast, device, webhook, billing, system, chat) because settings and filters key on it.

### TW-NOTIF-004 — Explicit system notifications

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-NOTIF-001
- **Summary:** A handful of controllers and services raise hand-written notifications for account and operational events, separate from the automatic model feed.
- **Actors & access:** System on behalf of the user or workspace owner.
- **UX & screens:** Appear in bell and page.
- **Endpoints:** none.
- **Data:** `notifications` rows. Catalogue of emitters (title, severity, urgency, category, link, event key):
  - Registration success: "Welcome to {app name}", success, system, no link (AuthController, after account creation).
  - Workspace created (registration step 2 and Create Workspace): "Workspace created", success, system, link `/dashboard`.
  - Profile saved: "Profile updated", success, system.
  - Password changed: "Password changed", warning, urgent, system.
  - Device connected / disconnected (event keys `device_connected`, `device_disconnected`): category device; recipient is the workspace owner; severity info when connected, warning when disconnected; link to the devices index; source is the device row.
  - Wallet low balance (event `wallet_low_balance`): title "Low WhatsApp balance", warning, urgent, category billing, icon billing, link `/account?tab=wallet`, body shows remaining balance as money (or credit count when no rate).
- **Rules & edge cases:**
  1. Device state notification is guarded by a 5-minute cache add per device and state so status polling and multiple tabs do not repeat it; skips when the device has no workspace or the workspace has no owner.
  2. Wallet alert is called by the message billing service immediately after a spend drops the balance at or below the admin threshold; it honours in-app, email (default on) and Slack (default on).
  3. Device and wallet alerts pass an explicit workspace id, so the owner's preferences of that workspace apply.
  4. Registration, profile, password and workspace notifications pass no event key, so they are gated by the `system` category preference and are stamped with the user's current workspace (see quirk in TW-NOTIF-001).
  5. All emit calls are inside the request; device state is wrapped in try/catch so a notification failure never breaks status sweeps.
- **Async & events:** Triggered by controller actions, the device status sweep, and message billing spend.
- **External systems:** none.
- **Settings:** Event toggles `device_connected`, `device_disconnected`, `wallet_low_balance`; category toggles `system`, `device`, `billing`.
- **Acceptance criteria:**
  - Given a device flips offline twice within 5 minutes, then exactly one "Device disconnected" notification exists for the owner.
  - Given a spend leaves the wallet at or under the threshold, then the owner receives an urgent billing notification and, with a working mailer, an email.
  - Given a user changes their password, then an urgent "Password changed" notification exists with severity warning.
- **Source refs:** app/Http/Controllers/AuthController.php, app/Http/Controllers/AccountController.php, app/Http/Controllers/WorkspacesController.php, app/Http/Controllers/DevicesController.php, app/Support/WalletAlerts.php
- **Port notes:** Each emitter belongs to its own module (auth, workspaces, devices, wallet) and should call the shared `NotificationsService.emit`. Keep the 5-minute device de-duplication as a cache or DB idempotency key (Reference relies on the cache).

### TW-NOTIF-005 — Workspace notification preferences (settings tab)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-NOTIF-001
- **Summary:** The workspace owner chooses, for each named event and each category, whether it produces an in-app bell entry, an email, or a Slack message, and sets the Slack webhook URL. Members see the same table read-only.
- **Actors & access:** Workspace owner (must be `workspaces.owner_user_id`) can save; any member can view. No plan gate. Save returns 403 "Owner only." for non-owners and 404 when there is no current workspace.
- **UX & screens:** `resources/views/user/settings/index.blade.php`, pane `notifications` (tab link `?tab=notifications`). Three cards:
  1. Sticky header: title "Workspace notifications", description, "Save preferences" button (disabled for non-owners, plus an italic read-only note).
  2. "Specific events" table: 18 rows from the workspace event catalogue, three toggles each (In-app, Email, Slack). A hidden input with value 0 precedes each checkbox so unchecked boxes still post.
  3. "By category" table: 9 rows (device, contact, campaign, broadcast, template, chat, webhook, billing, system) with the same three toggles.
  4. Slack incoming webhook URL field (type url, placeholder hooks.slack.com) and a "Channel status" list explaining in-app is live, email needs SMTP, Slack needs the URL.
     Success flash: "Notification preferences saved."
- **Endpoints:**

| Endpoint                    | Route name                  | Action                                     | Middleware   | Request             | Response |
| --------------------------- | --------------------------- | ------------------------------------------ | ------------ | ------------------- | -------- |
| POST settings/notifications | user.settings.notifications | SettingsTabsController@updateNotifications | Authenticate | `prefs[event][inapp | email    | slack]`, `cat_prefs[category][...]`(each in 0,1,on, nullable),`slack_webhook` (nullable url, max 255) | redirect back with success flash |

- **Data:** `workspaces.notification_prefs` JSON: `{ "<event>": {inapp,email,slack}, ..., "_categories": {"<category>": {inapp,email,slack}}, "_slack_webhook": "<url>" }`. Save replaces the whole JSON.
- **Rules & edge cases:**
  1. Event catalogue (key: label): device_connected, device_disconnected, campaign_completed, campaign_failed, broadcast_completed, new_customer_reply, mention_in_inbox (You were @mentioned), conversation_assigned, sla_breached, wallet_low_balance, plan_changed (Plan upgraded / downgraded), payment_failed, webhook_delivery_failed, flow_started, flow_failed, integration_disconnected, appointment_booked, weekly_summary.
  2. Built-in default channels: all events in-app on, email off, Slack off, except email on for device_disconnected, wallet_low_balance, payment_failed, sla_breached, campaign_failed, webhook_delivery_failed, integration_disconnected, weekly_summary; Slack on for wallet_low_balance and sla_breached; weekly_summary in-app off.
  3. Resolution order for (event, channel): explicit per-event value, else per-category value where the event name equals a category, else event default, else global default (in-app on, email off, Slack off), else true. A null or non-array stored value means "everything on".
  4. The category defaults shown in the form when nothing is stored: in-app on, email and Slack off. The event rows show the built-in defaults.
  5. Values normalise to strict booleans; the form always posts every key, so the first save freezes all 18 event rows and 9 category rows as explicit values (later changes to the built-in defaults no longer affect that workspace).
  6. QUIRK: preferences are stored per workspace but read for the recipient's resolved workspace; two workspaces under one owner have independent settings.
  7. QUIRK: the events tab lists 18 events but most have no emitter (TW-NOTIF-011), so toggling them has no effect.
- **Async & events:** none. Not audited (no Audit call).
- **External systems:** none.
- **Settings:** This feature is the setting.
- **Acceptance criteria:**
  - Given the owner unchecks in-app for `device_disconnected` and saves, when a device disconnects, then no bell row is created for that workspace.
  - Given a non-owner member posts the form, then the response is 403 and nothing changes.
  - Given no prefs were ever saved, when `wallet_low_balance` fires, then in-app, email and Slack are all enabled by default.
  - Given the owner enters `not a url`, when saving, then validation fails and the previous prefs remain.
  - Given category `template` email is enabled and no event-level row exists, then a template notification is emailed.
- **Source refs:** app/Http/Controllers/SettingsTabsController.php, app/Models/Workspace.php, resources/views/user/settings/index.blade.php, Documentation/pages/account/notifications.html
- **Port notes:** Keep prefs as a normalized `notification_preferences` table (`org_id`, `event_key`, `channel`, `enabled`) or a validated JSON column on the workspace settings; expose one `GET/PUT /notification-preferences` API. Preserve the resolution order and defaults so behaviour matches. Do not reproduce "form posts everything so defaults freeze": store only overrides.

### TW-NOTIF-006 — Header notification bell

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-NOTIF-001
- **Summary:** A bell in every authenticated page header shows an unread badge and a dropdown of the eight most recent notifications, refreshed every 60 seconds and on open.
- **Actors & access:** Any authenticated user (no role gate); results are scoped to the user's current workspace plus their personal rows.
- **UX & screens:** `resources/views/components/user/header.blade.php` and `topstrip.blade.php` (shell components, described here for behaviour). Bell button with red badge (hidden at 0, "99+" over 99). Panel: title "Notifications" with "Mark all read", scrolling list (max about 420px), footer with "Clear all" and "View all". States: loading placeholder; empty "No notifications yet."; rows show unread dot, title (bold, tone by severity: error or critical red, warning amber, else default; note the server emits `danger`, which the JS does not treat as red), two-line message clamp, relative time, link to `action_url` else to `/notifications`. Clicking a row posts mark-read with keepalive so it survives navigation and decrements the badge optimistically. Click outside closes. Mobile: panel pinned to viewport.
- **Endpoints:**

| Endpoint                 | Route name                | Action                         | Middleware   | Request | Response                                                                                                         |
| ------------------------ | ------------------------- | ------------------------------ | ------------ | ------- | ---------------------------------------------------------------------------------------------------------------- |
| GET notifications/recent | user.notifications.recent | NotificationsController@recent | Authenticate | none    | `{unread, items[8]}`; each item `{id,title,message,category,severity,icon,unread,is_urgent,time_ago,action_url}` |

- **Data:** Reads `notifications` under the visibility scope (workspace = current, or user = me with NULL workspace), newest first, limit 8; `unread` counts all unread visible rows.
- **Rules & edge cases:**
  1. No pagination or filtering; the full page handles that.
  2. `time_ago` is server-rendered relative text (human diff); nulls become empty string.
  3. Title and message are decrypted on read.
  4. Poll every 60 seconds plus on open; failures are silent.
  5. QUIRK: severity `danger` (used by the error wrapper and seed data) has no colour mapping in the JS, so it looks neutral.
  6. Unread state is per row, not per user; if one member reads a workspace-shared row it is read for everyone.
- **Async & events:** Client polling only; no websocket.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 20 rows with 12 unread, when the dropdown opens, then 8 newest rows show and the badge says 12.
  - Given the user clicks a row with a link, then the browser navigates and the row is marked read.
  - Given no rows, then "No notifications yet." shows and the badge is hidden.
  - Given the user switches workspace, then the next poll shows the other workspace's rows.
- **Source refs:** app/Http/Controllers/NotificationsController.php, resources/views/components/user/header.blade.php, resources/views/components/user/topstrip.blade.php, app/Models/Notification.php
- **Port notes:** `apps/web` header component with SWR-style polling (or realtime gateway push using the existing `/realtime` namespace) and a `GET /notifications/recent` endpoint. Consider per-user read receipts so shared rows do not turn read for everyone.

### TW-NOTIF-007 — Notifications page (feed, KPIs, filters, search)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-NOTIF-001
- **Summary:** A full page at More, Notifications with four KPI cards, category tabs with live counts, a search box, a feed grouped by day, and pagination, all refreshed by partial JSON requests without a full reload.
- **Actors & access:** Any authenticated user (nav item is tiered "manager" so agents and viewers do not see the link but are not blocked from the URL).
- **UX & screens:** `resources/views/user/notifications/index.blade.php`, `_feed.blade.php`, `_pagination.blade.php`, script `resources/js/charts/user-notifications-index.js`.
  - Sub-header: back link to More, title, "Do not disturb" button (purely visual, TW-NOTIF-010), "Mark all read", "Preferences" link to Settings.
  - KPI strip: Unread (with urgent-unread sub count), Today (events today with signed percentage versus 30-day daily average), Active categories (distinct categories in the last 7 days, labelled "routing alerts"), Delivery (channels: In-app always, Email only if a real mailer is configured, Slack if a webhook is stored, plus "manage" link).
  - Tabs: All, Unread, Mentions, Campaigns, System, Billing, Webhooks, Broadcasts, Templates, Devices, Contacts; each shows a count. (No tab for `chat`, though it is counted.)
  - Search input (debounced about 220 ms) matching title or message, case-insensitive.
  - Feed: sections Today, Yesterday, Earlier this week, Older (empty sections hidden). Row: coloured category icon, title (bold when unread), category badge, URGENT badge, verb badge, message, HH:MM and relative time, unread bar on the left, "View" link if action URL, "Read" button when unread, dismiss X. Section "Collapse" text is inert.
  - Empty state: "No notifications match the current filters..." with reset and Preferences actions.
  - Footer: "Showing N of M" and "Clear all" (confirm dialog: "This can't be undone."). Right column: "Auto-recorded" tip and "Top sources (this week)" list from category counts (the label says this week but counts are all-time).
  - URL state: category, q, page pushed with history.pushState; popstate re-fetches.
- **Endpoints:**

| Endpoint          | Route name               | Action                        | Middleware   | Request                                                                 | Response                                                                                              |
| ----------------- | ------------------------ | ----------------------------- | ------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| GET notifications | user.notifications.index | NotificationsController@index | Authenticate | `category` (default all; `unread` special), `q`, `page`, `partial` bool | HTML page, or JSON `{ok, feed, pagination, stats, categoryCounts, shown, total, page}` when `partial` |

- **Data:** Reads `notifications` (visibility scope). Stats: unread, urgent (urgent and unread), today (rows created today), week (since start of week), todayDelta = round((today - avg)/avg*100) where avg = max(1, round(rows in last 30 days / 30)), activeRules = distinct categories in last 7 days. Category counts: all, unread, and per category for mention, campaign, system, billing, chat, webhook, broadcast, template, device, contact.
- **Rules & edge cases:**
  1. Page size is 12. Page is clamped into range.
  2. `category=unread` filters status unread and ignores other categories; any other value filters exact category; `all` no filter.
  3. Order is newest first. Search runs in application memory over decrypted title and message after loading all visible rows (because they are encrypted); cost grows with row count (docs and code comments cite 77k and 194k row installations).
  4. Day grouping uses server-local "now": today, yesterday, since start of week, older.
  5. Icon and badge colour maps exist for campaign, broadcast, webhook, chat, mention, system, billing, device, template, contact; unknown categories (for example the seed data's inbox, order, support, ads, flow, contacts) use the system style.
  6. Category `mention` is counted and has a tab, but no code path writes a `notifications` row with category `mention` (mentions go to the team-inbox feed, TW-NOTIF-013), so the tab is always empty.
  7. QUIRK: docs describe the fourth KPI as quiet hours; the page shows delivery channels instead.
  8. QUIRK: visibility scope makes rows workspace-shared; count and read-state are shared as well.
- **Async & events:** Client fetches partial JSON on every filter, page, search, read, dismiss.
- **External systems:** none.
- **Settings:** none on the page; links to TW-NOTIF-005.
- **Acceptance criteria:**
  - Given 30 visible rows, when the page opens, then 12 rows show, pagination says page 1 of 3, and the tab counts are correct.
  - Given a search for "device", when typing stops, then only rows whose title or message contain it remain, page resets to 1, and the URL includes `q`.
  - Given category `unread`, then only unread rows show regardless of a category param.
  - Given the URL `?page=99`, then the last page is shown.
  - Given a partial request, then the response is JSON with server-rendered feed and pagination HTML.
- **Source refs:** app/Http/Controllers/NotificationsController.php, resources/views/user/notifications/index.blade.php, resources/views/user/notifications/_feed.blade.php, resources/views/user/notifications/_pagination.blade.php, resources/js/charts/user-notifications-index.js, Documentation/pages/account/notifications.html
- **Port notes:** `apps/web/app/(app)/notifications` with a JSON API (`GET /notifications?category&q&cursor`) instead of HTML fragments; return counts in a separate cheap endpoint. Do SQL-side search and keyset pagination. Keep the 12-per-page default or switch to infinite scroll but keep the KPI semantics. Drop the dead `mention` tab or wire it to the new inbox-mention notifications.

### TW-NOTIF-008 — Mark read, dismiss and clear notifications

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-NOTIF-001
- **Summary:** Endpoints to mark one or all notifications read, delete one, or delete everything visible.
- **Actors & access:** Any authenticated user. No role gate, no CSRF exemption.
- **UX & screens:** Bell (Mark all read, Clear all, row click) and page (per-row Read and dismiss, header Mark all read, footer Clear all with confirmation).
- **Endpoints:**

| Endpoint                     | Route name                     | Action                              | Middleware   | Request | Response                        |
| ---------------------------- | ------------------------------ | ----------------------------------- | ------------ | ------- | ------------------------------- |
| POST notifications/{id}/read | user.notifications.read        | NotificationsController@markRead    | Authenticate | path id | `{ok:true}`; 404 if not visible |
| POST notifications/read-all  | user.notifications.read-all    | NotificationsController@markAllRead | Authenticate | none    | `{ok:true}`                     |
| DELETE notifications/{id}    | user.notifications.destroy     | NotificationsController@destroy     | Authenticate | path id | `{ok:true}`; 404 if not visible |
| DELETE notifications         | user.notifications.destroy-all | NotificationsController@destroyAll  | Authenticate | none    | `{ok:true}`                     |

- **Data:** Updates `notifications.status` to false and `read_at` to now; hard-deletes rows (no soft delete).
- **Rules & edge cases:**
  1. All four act on rows visible to the caller under the workspace scope, not only rows addressed to the caller. Read-all and clear-all therefore affect every member's view of shared rows.
  2. Mark-read is idempotent and re-stamps `read_at` each call.
  3. Delete is permanent; there is no undo.
  4. An id outside the caller's scope returns 404 (not 403).
  5. No audit entries are written.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an unread visible row, when mark-read is called, then status becomes 0 and `read_at` is set.
  - Given another workspace's row id, when delete is called, then 404 is returned and the row remains.
  - Given clear-all, then all visible rows are deleted and the bell shows the empty state.
  - Given member A clears all, when member B opens the page, then B sees none of the shared rows.
- **Source refs:** app/Http/Controllers/NotificationsController.php, resources/js/charts/user-notifications-index.js, resources/views/components/user/header.blade.php
- **Port notes:** Model per-user read state (`notification_reads`) or make rows per-recipient so clearing is personal. Consider soft delete and a cap for "clear all". RLS scopes tenant; add a user filter.

### TW-NOTIF-009 — Legacy notifications-page route

- **Status:** dead-code
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-NOTIF-007
- **Summary:** An old URL that renders the notifications view without passing any data, so the view falls back to empty defaults (zero KPIs, empty feed).
- **Actors & access:** Authenticated user.
- **UX & screens:** Same view as TW-NOTIF-007 with an empty paginator.
- **Endpoints:**

| Endpoint               | Route name                | Action                            | Middleware   | Request | Response         |
| ---------------------- | ------------------------- | --------------------------------- | ------------ | ------- | ---------------- |
| GET notifications-page | user.notifications.legacy | UserPagesController@notifications | Authenticate | none    | HTML, empty feed |

- **Data:** none.
- **Rules & edge cases:** 1. No link in the app points here. 2. The page shows the empty state even when notifications exist.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the URL is opened, then the page renders with zero stats and an empty feed (documented legacy behaviour, do not port).
  - Given a port, when the URL is requested, then it should redirect to `/notifications` or 404.
  - Given the route exists, then no navigation element links to it.
- **Source refs:** app/Http/Controllers/UserPagesController.php, routes/web.php
- **Port notes:** Do not port; add a redirect only if old bookmarks matter.

### TW-NOTIF-010 — Do-not-disturb and quiet hours

- **Status:** docs-only
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-NOTIF-007
- **Summary:** The docs describe a workspace quiet-hours window (for example 22:00 to 07:00) that holds back non-urgent alerts, and a KPI card showing it. In code the "Do not disturb" button on the page only flips a local label and colour and stores nothing; no quiet-hours field exists and the emitter never checks time.
- **Actors & access:** Not applicable (no working path).
- **UX & screens:** Button `dnd-btn` on the notifications page toggles text "Do not disturb" or "DND on" client-side only; state is lost on reload.
- **Endpoints:** none.
- **Data:** none. `workspaces.business_hours` exists but is unrelated.
- **Rules & edge cases:** 1. Docs claim quiet hours hold back non-urgent alerts; no code implements this. 2. The KPI card documented as "quiet hours" is actually "Delivery".
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a port that implements DND, when a per-user DND window is active, then non-urgent notifications are stored but do not email, Slack or push.
  - Given an urgent notification during DND, then it is delivered.
  - Given DND ends, then the badge and feed are unchanged (rows always stored).
- **Source refs:** resources/js/charts/user-notifications-index.js, resources/views/user/notifications/index.blade.php, Documentation/pages/account/notifications.html
- **Port notes:** Optional. If built, make it a per-user preference (not workspace) and gate only out-of-app channels and push.

### TW-NOTIF-011 — Catalogued events that nothing emits

- **Status:** docs-only
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-NOTIF-005
- **Summary:** Fifteen of the eighteen events in the preferences catalogue (and the docs "Event Catalog") have no emitter in code, so their toggles do nothing. Only `device_connected`, `device_disconnected` and `wallet_low_balance` are raised with their event key; the rest are dead settings.
- **Actors & access:** Workspace owner sees the toggles.
- **UX & screens:** Rows in the "Specific events" table (TW-NOTIF-005).
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. No emitter found for these twelve: campaign_completed, campaign_failed, broadcast_completed, new_customer_reply, mention_in_inbox, conversation_assigned, webhook_delivery_failed, flow_started, flow_failed, integration_disconnected, appointment_booked, weekly_summary (no weekly digest job or command exists).
  2. Three more (sla_breached, plan_changed, payment_failed) have keys that appear in other code (SLA tracker, admin workspace plan change, payment gateway drivers) but never call the notification helper with those event keys; conversation assignment, SLA and mention notices go through the separate team-inbox feed instead.
  3. The seed data shows richer categories (inbox, order, support, ads, flow, contacts) that no code writes.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** the toggles.
- **Acceptance criteria:**
  - Given a port, when a campaign finishes or fails, then a notification with event `campaign_completed` or `campaign_failed` is emitted (target behaviour advertised by the catalogue).
  - Given `weekly_summary` email is enabled, then a weekly digest email is sent (advertised; needs a scheduler).
  - Given a preference for an event is off, then no channel fires for it.
- **Source refs:** app/Models/Workspace.php, resources/views/user/settings/index.blade.php, Documentation/pages/account/notifications.html, database/seeders/DemoContentSeeder.php
- **Port notes:** Decide per event whether to implement in the owning domain (BCAST, CAMP, FLR, INTG, APPT, WALLET) or drop it from the catalogue. Treat the catalogue as the contract for the emit API's event keys.

### TW-NOTIF-012 — Team-inbox notification dispatcher core

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** none
- **Summary:** The single fan-out point for "tell an agent something happened" events inside the team inbox and CRM. It writes a row to a separate `inbox_notifications` feed, de-duplicates bursts, and mirrors the event to browser Web Push when the Team-Inbox PWA feature is on.
- **Actors & access:** System. Recipient is always one explicit user in one workspace. No permission or plan gate; not subject to the workspace notification preferences of TW-NOTIF-005 (that table only governs the other feed).
- **UX & screens:** No screen in the Reference web UI consumes this table beyond the unread count in the team-inbox bootstrap payload and the feed endpoint in TW-NOTIF-017.
- **Endpoints:** none.
- **Data:** Writes `inbox_notifications` (`user_id`, `workspace_id`, `type` varchar 32, `title` varchar 200, `body` text (max 200 chars, tags stripped), `data` JSON, `link` varchar 500, `read_at`). Types written by the dispatcher: assigned, mentioned, sla_breach, snooze_wake, resolved, deal_assigned, deal_won, deal_lost, deal_task_due, task_due, task_assigned, sales_doc_decided, new_lead.
- **Rules & edge cases:**
  1. De-duplication: when a caller supplies a dedupe key, a cache key `inbox_notif_dedupe:{key}` is checked; if present the notification is dropped, otherwise it is set for 30 seconds. Dedupe is cache-based, not transactional; with a non-shared cache it fails open per node.
  2. Body is stripped of HTML tags and cut to 200 characters; Web Push body to 180 and title to 100.
  3. The in-app row is always written first; Web Push is best-effort and never blocks it (exceptions logged as a warning).
  4. Web Push is attempted only when the platform setting `ti_pwa_enabled` is true; the recipient's subscriptions come from `push_subscriptions` on channel `team-inbox` (TW-NOTIF-018). Push payload: title, body, URL (the link or `/team-inbox`), tag `inbox-{dedupe key or type}`.
  5. Phone-bearing conversation titles are masked with the global phone masking helper before storing (see AUTH security setting `security.mask_customer_numbers`, default on, last four digits shown).
  6. No preference check, no email, no Slack for this feed.
  7. No read/unread mutation API other than "mark all read" (TW-NOTIF-017); there is no delete.
- **Async & events:** Called synchronously from controllers, model hooks and sweeps. Web Push is a synchronous HTTP call to the browser push service inside the request (not deferred), which can add latency.
- **External systems:** Browser push services via Web Push (TW-NOTIF-018).
- **Settings:** `ti_pwa_enabled` (system setting, default false).
- **Acceptance criteria:**
  - Given the same assignment is triggered twice within 30 seconds, then one `inbox_notifications` row exists.
  - Given `ti_pwa_enabled` is off, when an event fires, then the row is written and no push is attempted.
  - Given the push service errors, then the row still exists and a warning is logged.
  - Given an HTML body of 500 chars, then the stored body is plain text of at most 200 chars.
- **Source refs:** app/Services/Inbox/NotificationDispatcher.php, app/Models/InboxNotification.php, database/migrations/2026_05_06_120004_create_user_inbox_tables.php
- **Port notes:** Home `apps/api/src/modules/inbox/notifications/`. Emit from domain events via the outbox; implement de-dupe with a unique partial index on (user_id, dedupe_key, window bucket) or Redis SET NX with TTL. Merge into one `notifications` table with a `feed` discriminator if the target prefers a single feed, but keep the semantic differences (this feed is per-user, per-workspace, has a `data` JSON and a per-row `read_at`).

### TW-NOTIF-013 — Conversation notifications (assign, mention, resolved, snooze wake)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-NOTIF-012
- **Summary:** Agents are notified when a conversation is assigned to them, when they are @mentioned in an internal note, when a conversation they participate in is resolved, and when a snoozed conversation wakes up.
- **Actors & access:** Recipients are workspace members. Triggers are team-inbox actions (assign endpoint, add-note endpoint, resolve endpoint, snooze sweep).
- **UX & screens:** Rendered by the team-inbox UI (TIB1). Deep link is `/team-inbox?c={conversation id}`.
- **Endpoints:** none owned (triggered by TeamInboxController actions).
- **Data:** `inbox_notifications`; mention also upserts `conversation_participants` (role `mentioned`) and increments `unread_mentions`.
- **Rules & edge cases:**
  1. Assignment: recipient is the new assignee; title "Conversation assigned to you"; body the masked conversation title (fallback "New assignment"); data has conversation id and the assigning user; dedupe key `assigned:{conv}:{assignee}`.
  2. Mention: one row per mentioned user (skipping the author); title "You were mentioned"; body is the first 160 characters of the note with tags stripped; also upserts the participant row and increments `unread_mentions`; no dedupe key, so repeated mentions each notify. The controller also broadcasts a realtime `MentionReceived` event to the mentioned user.
  3. Resolved: recipients are all participants of the conversation except the resolver; title "Conversation resolved"; no dedupe.
  4. Snooze wake: recipient is the assignee, else every member of the assigned team; title "Snoozed chat reopened — follow up"; dedupe `snooze_wake:{conv}`. Called from the wake sweep in the team-inbox queue poll and from the `inbox:wake-snoozed` command.
  5. The dispatcher does not skip self-notifications for assignment or mention (the mention loop in the controller skips the author; the assign handler decides for assignment).
- **Async & events:** Triggers inline in requests; snooze wake is opportunistic (piggybacks on queue polling, see TW-NOTIF-015 rule on sweeps). Realtime: `MentionReceived`.
- **External systems:** none beyond TW-NOTIF-012 push.
- **Settings:** `ti_pwa_enabled`.
- **Acceptance criteria:**
  - Given an admin assigns a conversation to agent A, then A gets a "Conversation assigned to you" row linking to the conversation.
  - Given a note mentions users B and C, then B and C each get a row and their participant `unread_mentions` increases by 1.
  - Given a conversation with three participants is resolved by one, then the other two get "Conversation resolved".
  - Given a snoozed conversation with no assignee but an assigned team of four, when it wakes, then all four members are notified once.
- **Source refs:** app/Services/Inbox/NotificationDispatcher.php, app/Http/Controllers/TeamInboxController.php, app/Console/Commands/InboxWakeSnoozedCommand.php
- **Port notes:** Emit `conversation.assigned`, `note.mentioned`, `conversation.resolved`, `conversation.snooze_woke` outbox events in TIB; the notifications module subscribes. Keep the 30-second dedupe on assignment and snooze wake.

### TW-NOTIF-014 — SLA-breach notification

- **Status:** dead-code
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-NOTIF-012
- **Summary:** The dispatcher has an SLA-breach method that would notify the assignee (or every member of the assigned team) with "SLA breached", but nothing in the application calls it.
- **Actors & access:** none (unreachable).
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** would write `inbox_notifications` type `sla_breach`, dedupe `sla:{conv}`.
- **Rules & edge cases:** 1. The SLA tracker computes breaches (TIB2) but does not call this method. 2. The preference key `sla_breached` and defaults (email and Slack on) refer to it but the bell feed does not send email or Slack.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a port that wires SLA breach, when a conversation's first-response or resolution deadline passes, then the assignee or team members are notified once (deduped).
  - Given the workspace disabled `sla_breached` in-app, then the bell row is suppressed (decision for the port; Reference never applies preferences to this feed).
  - Given a conversation with neither assignee nor team, then nobody is notified and nothing errors.
- **Source refs:** app/Services/Inbox/NotificationDispatcher.php, app/Services/Inbox/SlaTracker.php
- **Port notes:** Implement in TIB2's SLA sweep worker by publishing `conversation.sla_breached` and having this module consume it; honour `sla_breached` preferences.

### TW-NOTIF-015 — CRM notifications (deals, tasks, proposals, new lead)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-NOTIF-012
- **Summary:** Sales and task events notify the responsible user so the pipeline does not become a silo: deal assigned, deal won or lost, deal task due, task due, task assigned, proposal or estimate accepted or declined, and a new lead captured.
- **Actors & access:** System recipients: deal owner, task assignee (fallback creator), document owner and creator, workspace owner plus every agent subscribed to team-inbox push.
- **UX & screens:** Rows in the team-inbox feed; deep links `/deals?deal={id}`, `/tasks`, `/estimates` or `/proposals`, `/contacts`.
- **Endpoints:** none owned.
- **Data:** `inbox_notifications`; reads `push_subscriptions` for lead recipients.
- **Rules & edge cases:**
  1. Deal assigned: fires on deal creation when the owner is not the actor, and on owner change when the new owner is not the actor. Title "Deal assigned to you"; body "{deal title} · {value display}"; dedupe `deal_assigned:{deal}:{owner}`.
  2. Deal outcome: fires when status becomes won or lost (also when a deal is created straight into won or lost); skipped if the actor is the owner; title "Deal won" or "Deal lost"; body includes the lost reason for lost; dedupe `deal_outcome:{deal}:{status}`.
  3. Deal task due: called by the deal reminder sweep for tasks with due time passed, not done and not yet reminded, in due order, limit 200 per sweep; recipient is the deal owner, else the task's creator; the sweep stamps `reminded_at` even when the deal is gone; dedupe `deal_task_due:{activity id}`.
  4. Task due: same pattern for first-class tasks (assignee, else creator); title "Task due"; link `/tasks`; sweep stamps `reminded_at` regardless of notify success; dedupe `task_due:{task}`.
  5. Task assigned: skipped if assigned to the actor; dedupe `task_assigned:{task}`; called by the AI CRM toolkit.
  6. Sales document decided: on public accept or decline; recipients are the doc owner and creator (unique); title "{Proposal|Estimate} accepted|declined"; dedupe `salesdoc_decided:{doc}:{status}`.
  7. New lead: from the incoming-webhook lead capture. Recipients: the hook's owner plus all users with a `team-inbox` push subscription in the workspace; title "New lead" plus " · {source}" when present; body name and phone; dedupe `new_lead:{digits}` (so the same number cannot notify twice in 30 s, across all recipients).
  8. The sweeps are not scheduled (Reference documents a "no scheduler" policy): they are triggered from the team-inbox queue poll (per workspace, limit 100), from the WhatsApp connect status call (all workspaces, limit 500) and by the commands `deals:remind-tasks` and `crm:remind-tasks`.
  9. Every caller wraps the dispatcher in try/catch; a failure never blocks the save.
- **Async & events:** Model hooks on Deal created and updated; sweeps as above; public document decision endpoint.
- **External systems:** Web Push per TW-NOTIF-012.
- **Settings:** none.
- **Acceptance criteria:**
  - Given user X moves a deal owned by Y to Won, then Y gets "Deal won" with a link to the deal; if X owns it, no notification.
  - Given a deal task due yesterday not yet reminded, when a sweep runs, then the owner gets one "Deal task due" and the task is stamped reminded.
  - Given a customer accepts a proposal, then the doc's owner and creator each get "Proposal accepted".
  - Given two webhook leads with the same phone within 30 seconds, then only the first notifies.
- **Source refs:** app/Services/Inbox/NotificationDispatcher.php, app/Models/Deal.php, app/Services/Deals/DealReminderService.php, app/Services/Crm/TaskReminderService.php, app/Http/Controllers/SalesDocsController.php, app/Http/Controllers/IncomingWebhookController.php, app/Services/AiCrm/CrmToolkit.php, app/Console/Commands/DealsRemindTasksCommand.php, app/Console/Commands/CrmRemindTasksCommand.php
- **Port notes:** Replace opportunistic sweeps with a BullMQ repeatable job every minute per tenant batch (`reminders` queue) using a `reminded_at` column claim (UPDATE ... WHERE reminded_at IS NULL RETURNING) for idempotency. Deal/task/sales-doc modules publish outbox events; this module maps them to notifications.

### TW-NOTIF-016 — AI hand-off notification

- **Status:** partial
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-NOTIF-012
- **Summary:** When an AI agent hands a conversation to humans (reply limit reached, low quality, out of credits, or the customer asks for a human), every owner, admin, manager and agent of the workspace gets an "AI handed off" notification.
- **Actors & access:** System recipients: all workspace members with role owner, admin, manager or agent.
- **UX & screens:** Row in the team-inbox feed.
- **Endpoints:** none.
- **Data:** Attempts to write `inbox_notifications` with extra keys (`conversation_id`, `severity`, `message`, `action_url`) that are not columns and not fillable.
- **Rules & edge cases:**
  1. Title "AI handed off — please take over"; reason labels: reply limit, replies getting worse, workspace out of credits, customer asked for a human (with the keyword), or generic request.
  2. QUIRK: only fillable columns persist, so the stored row has user, workspace, type `ai_handoff` and title but a NULL body and NULL link; the reason text and conversation reference are lost. The intended body was "{reason}. Conversation #{id} needs a human."
  3. No dedupe: a hand-off notifies all members each time.
  4. Failures are caught and logged; the hand-off itself proceeds.
- **Async & events:** Runs inside the AI agent handoff routine.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an AI hand-off, then each qualifying member receives one notification (target behaviour: body carries the reason and the link opens the conversation).
  - Given the workspace has 10 members, then 10 rows are written.
  - Given a failure writing, then the hand-off still completes.
- **Source refs:** app/Services/AiAgentService.php, app/Models/InboxNotification.php
- **Port notes:** Fix the column mismatch (use body and link, put conversation id in `data`). Add dedupe per conversation and reason. AIAG owns the trigger; this module owns the notification type `ai_handoff`.

### TW-NOTIF-017 — Team-inbox notification feed API

- **Status:** partial
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-NOTIF-012
- **Summary:** JSON endpoints to list the signed-in agent's latest team-inbox notifications and mark them all read. No shipped web UI calls them; the bootstrap payload only uses the unread count.
- **Actors & access:** Authenticated user; scoped to their user id and current workspace. No role gate.
- **UX & screens:** None found in Reference resources (no `me/notifications` usage in JS or blades); presumably for a client or the mobile app.
- **Endpoints:**

| Endpoint                                      | Route name                      | Action                                    | Middleware   | Request | Response                                                  |
| --------------------------------------------- | ------------------------------- | ----------------------------------------- | ------------ | ------- | --------------------------------------------------------- |
| GET team-inbox/api/me/notifications           | user.team-inbox.api.notifs      | TeamInboxController@notifications         | Authenticate | none    | `{items[<=40 newest by id], unread}`; item is the raw row |
| POST team-inbox/api/me/notifications/read-all | user.team-inbox.api.notifs.read | TeamInboxController@markNotificationsRead | Authenticate | none    | `{ok:true}`                                               |

- **Data:** Reads and updates `inbox_notifications` (`read_at`); the team-inbox bootstrap also reads the unread count as `me.unread_notifications`.
- **Rules & edge cases:** 1. Limit is fixed at 40, ordered by id descending, no pagination. 2. `unread` is computed over the returned 40 only, not the true total. 3. Mark-read only affects the caller's unread rows in the current workspace. 4. No single-row read, no delete.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 50 notifications, then the list returns the 40 newest and unread counts only those.
  - Given mark-all-read, then all the caller's unread rows in the workspace have `read_at` set and other users' rows are untouched.
  - Given a different workspace, then rows there are not included.
- **Source refs:** app/Http/Controllers/TeamInboxController.php, app/Models/InboxNotification.php
- **Port notes:** Unify with the workspace feed in one `GET /notifications?feed=inbox` if merging tables; fix the unread count to be a real count.

### TW-NOTIF-018 — Web Push sender and VAPID key generation

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** none
- **Summary:** A service that sends browser Web Push messages to an agent's subscribed devices using VAPID, plus a one-click admin action that generates and stores the VAPID keypair. It degrades to a no-op when the push library or keys are missing.
- **Actors & access:** Platform admin (`EnsureUserIsAdmin` + IP allowlist) can generate keys; sending is system-side.
- **UX & screens:** The generate-keys button sits on the admin PWA settings page (`admin/settings/pwa`, owned by SET): "Generate keys", JSON result with ok, ready and a message.
- **Endpoints:**

| Endpoint                              | Route name                       | Action                                      | Middleware                                   | Request | Response                                                           |
| ------------------------------------- | -------------------------------- | ------------------------------------------- | -------------------------------------------- | ------- | ------------------------------------------------------------------ |
| POST admin/settings/pwa/generate-keys | admin.settings.pwa.generate-keys | AdminPagesController@settingPwaGenerateKeys | Authenticate, EnsureUserIsAdmin, IPAllowlist | none    | `{ok, ready, message}`; 422 when the push library is not installed |

- **Data:** Writes `system_settings` keys `ti_vapid_public` (plain) and `ti_vapid_private` (encrypted at rest); optional `ti_vapid_subject`. Reads and deletes `push_subscriptions`.
- **Rules & edge cases:**
  1. "Configured" means library present, public and private key both non-empty.
  2. Key generation is idempotent: existing keys are kept and the public key returned. Generation uses the library, falling back to building a P-256 keypair manually with an explicit OpenSSL config when the default fails (Windows/XAMPP). Output format: public key is base64url of 0x04 plus X and Y (65 bytes), private key base64url of the 32-byte scalar.
  3. VAPID subject: setting `ti_vapid_subject`, else `APP_URL`, else the request root URL.
  4. Send: fetch all `team-inbox` channel subscriptions of the user; queue one notification per endpoint with JSON payload; flush; on success stamp `last_notified_at`; on 404 or 410 (expired) delete the subscription; other failures logged with the first 80 characters of the endpoint and reason.
  5. Any exception is logged and swallowed.
  6. No-op when user id is not positive or the service is not configured.
  7. Unknown library missing message: "run composer require minishlink/web-push" (a PHP dependency; a port uses the `web-push` npm package).
- **Async & events:** Synchronous HTTP to browser push services.
- **External systems:** Browser push endpoints (FCM for Chrome, Mozilla autopush, Apple) authenticated with VAPID JWT; keys in system settings.
- **Settings:** `ti_vapid_public`, `ti_vapid_private`, `ti_vapid_subject`, `ti_pwa_enabled`.
- **Acceptance criteria:**
  - Given no keys, when the admin clicks generate, then a keypair is stored and `ready` is true; clicking again returns the same public key.
  - Given a subscription whose endpoint returns 410, when a push is sent, then the row is deleted.
  - Given the library is missing, then the endpoint returns 422 with the install instruction.
  - Given keys are stored, then the private key is not readable in plain text from the settings table.
- **Source refs:** app/Services/Push/WebPushService.php, app/Http/Controllers/AdminPagesController.php, app/Models/SystemSetting.php, app/Models/PushSubscription.php
- **Port notes:** `apps/api/src/modules/notifications/push/web-push.service.ts` with the `web-push` package behind a `WebPushPort` (provider-adapter). Store VAPID keys in the platform secrets store or encrypted platform settings. Run sends in a worker, not inline. Per-tenant keys are not needed; one platform keypair.

### TW-NOTIF-019 — Team-Inbox PWA push enrolment

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-NOTIF-018
- **Summary:** Agents can install the Team Inbox as its own PWA and enable push notifications. The server exposes the scoped manifest, the VAPID public key, and subscribe/unsubscribe endpoints; a push-only service worker shows notifications and focuses or opens the inbox on tap.
- **Actors & access:** Any authenticated user for key, subscribe and unsubscribe. The manifest is public. Feature is on only if the admin enabled `ti_pwa_enabled` and generated keys.
- **UX & screens:** In the team inbox page script: registers service worker `team-inbox-sw.js` with scope `/team-inbox`; asks the key endpoint whether push is enabled; if permission is already granted it re-subscribes on every load to keep the subscription fresh; if permission is "default" it shows a fixed bottom-right pill "Enable notifications" that requests permission and subscribes; denied permission shows nothing. Service worker: install skips waiting, activate claims clients, push shows a notification (title default "New message", body, icon, badge, tag default `team-inbox`, renotify true), click focuses an open `/team-inbox` tab and navigates it to the payload URL, else opens a new window. It does no caching by design.
- **Endpoints:**

| Endpoint                             | Route name                           | Action                             | Middleware    | Request                                                                                                     | Response                                    |
| ------------------------------------ | ------------------------------------ | ---------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| GET team-inbox-manifest.json         | team-inbox.manifest                  | TeamInboxPwaController@manifest    | none (public) | none                                                                                                        | manifest JSON (`application/manifest+json`) |
| GET team-inbox/api/push/key          | user.team-inbox.api.push.key         | TeamInboxPwaController@pushKey     | Authenticate  | none                                                                                                        | `{enabled, publicKey}`                      |
| POST team-inbox/api/push/subscribe   | user.team-inbox.api.push.subscribe   | TeamInboxPwaController@subscribe   | Authenticate  | `endpoint` (required, string, max 1024), `keys.p256dh` (required, max 255), `keys.auth` (required, max 255) | `{ok:true}`                                 |
| POST team-inbox/api/push/unsubscribe | user.team-inbox.api.push.unsubscribe | TeamInboxPwaController@unsubscribe | Authenticate  | `endpoint`                                                                                                  | `{ok:true}` (always)                        |

- **Data:** `push_subscriptions` (`user_id`, `workspace_id`, `endpoint` text, `endpoint_hash` char 64 unique = sha256(endpoint), `p256dh`, `auth`, `ua` (first 255 chars of user agent), `channel` default `team-inbox`, `last_notified_at`). Manifest reads `system_settings`: `ti_pwa_name` (default "{brand} Inbox"), `ti_pwa_short_name` (default "Inbox", cut to 12 chars), `ti_pwa_theme_color`/`pwa_theme_color` (default #075E54), background colours (default #FBFAF6), `ti_pwa_icon_192/512` falling back to `pwa_icon_192/512`, then the brand favicon with size "any"; description (default "Your shared team inbox — chat with customers on the go."); `start_url` and `scope` both `/team-inbox`; display standalone; orientation portrait.
- **Rules & edge cases:**
  1. Subscribe is an upsert keyed by endpoint hash: an existing endpoint is re-assigned to the current user and workspace (a device shared by two users follows whoever subscribed last).
  2. Unsubscribe only deletes if the endpoint belongs to the caller.
  3. `enabled` in the key response is true only when the push library is present and both keys are stored; it does not check `ti_pwa_enabled`. The admin toggle instead gates sending (TW-NOTIF-012 and TW-NOTIF-020).
  4. The manifest is served without auth so "Add to Home Screen" works; it holds no secrets.
  5. No workspace-level opt-out; subscribing is per device.
  6. The admin settings page for the toggles and icons (`admin/settings/pwa`) belongs to SET; the fields it edits for this feature are `ti_pwa_enabled`, `ti_pwa_name`, `ti_pwa_short_name` (max 12), and icon uploads png or webp (192 max 1 MB, 512 max 2 MB).
- **Async & events:** Browser push subscription lifecycle.
- **External systems:** Browser Push API and service worker.
- **Settings:** `ti_pwa_enabled`, `ti_pwa_*` branding keys, VAPID keys.
- **Acceptance criteria:**
  - Given VAPID keys exist, when an agent opens the inbox and taps "Enable notifications" and grants permission, then a subscription row is created for that agent and workspace.
  - Given the same browser endpoint subscribes twice, then one row exists.
  - Given user B calls unsubscribe with user A's endpoint, then the row remains.
  - Given the manifest is requested unauthenticated, then it returns name, scope and icons.
- **Source refs:** app/Http/Controllers/TeamInboxPwaController.php, app/Models/PushSubscription.php, public/team-inbox-sw.js, resources/js/charts/user-team-inbox-index.js, database/migrations/2026_07_30_120000_create_push_subscriptions_table.php
- **Port notes:** `apps/web/public/team-inbox-sw.js` (keep push-only) and `apps/api/.../push-subscriptions`. Add RLS on `push_subscriptions.org_id`; add a user-scoped unique on endpoint hash. Consider making manifest per-tenant branded.

### TW-NOTIF-020 — Inbound-message Web Push to agents

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-NOTIF-018
- **Summary:** When a customer message arrives in the team inbox, the assigned agent (or, if unassigned, every agent who opted in) gets a browser push even with the app closed.
- **Actors & access:** System. Requires `ti_pwa_enabled` true and configured VAPID.
- **UX & screens:** OS notification: title is the conversation title (contact name or number, else its digits, else "New message"), body is the first 140 chars of the customer's text or "Sent a message"; tapping opens `/team-inbox?c={id}`; tag `ti-conv-{id}` (replaces earlier ones); icon is the Team-Inbox PWA icon.
- **Endpoints:** none.
- **Data:** Reads `conversations` and `push_subscriptions`.
- **Rules & edge cases:**
  1. Only for inbound messages (`direction` in).
  2. Recipient: assignee user if the conversation is assigned, otherwise all distinct users having a `team-inbox` subscription in the conversation's workspace.
  3. Message titles are not masked here (the agent's own inbox).
  4. Triggered from the InboxMessage `created` hook, deferred to the terminating phase, fetches the fresh row, and never throws.
  5. QUIRK: an assigned conversation whose assignee has no subscription gets no push at all; there is no fallback to team or workspace.
- **Async & events:** After-response callback in the message model.
- **External systems:** Browser push services.
- **Settings:** `ti_pwa_enabled`, icon settings.
- **Acceptance criteria:**
  - Given an assigned conversation and an assignee with a subscription, when a customer writes, then only that agent's devices are pushed.
  - Given an unassigned conversation and three opted-in agents, then all three are pushed.
  - Given `ti_pwa_enabled` false, then nothing is sent.
  - Given an empty text (media only), then the body is "Sent a message".
- **Source refs:** app/Services/Push/TeamInboxPushNotifier.php, app/Models/InboxMessage.php
- **Port notes:** Consume the `message.received` outbox event in a worker. Add team fallback recipients if desired (documented improvement, not Reference parity).

### TW-NOTIF-021 — In-tab desktop alert and ping sound

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** none
- **Summary:** While the team inbox is open, a new inbound message plays a short two-tone ping and either shows a toast (tab visible) or a system desktop notification (tab hidden).
- **Actors & access:** Any agent with the inbox open; browser permission required for desktop notifications.
- **UX & screens:** First click or keypress unlocks audio and asks for notification permission once. Ping: sine wave 880 Hz then 1175 Hz, about 0.34 s, generated in WebAudio (no asset). Visible tab: toast "New message · {title}". Hidden tab: `Notification` with body cut to 140 chars, tag `wa-inbox`, renotify, favicon icon; click focuses the window. Muted conversations never ping (checked before alerting in the poll code).
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:** 1. Everything is best-effort and try/catch wrapped. 2. Independent from push subscriptions and the server-side feeds.
- **Async & events:** Client-side, driven by the inbox poll or realtime message event.
- **External systems:** Browser Notification and WebAudio APIs.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the inbox tab is hidden and permission granted, when a message arrives, then a desktop notification shows.
  - Given the tab is visible, then a toast shows and the ping plays.
  - Given the conversation is muted, then neither plays.
- **Source refs:** resources/js/charts/user-team-inbox-index.js
- **Port notes:** Client feature of the inbox screen in `apps/web`; implement in the inbox realtime handler (TIB1 owns the surrounding code).

### TW-NOTIF-022 — Mobile push (FCM) admin settings

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** none
- **Summary:** Platform admins paste a Firebase service-account JSON (and optionally a project id) to turn on FCM push for the mobile app, see status, and clear it to switch push off.
- **Actors & access:** Platform admin (`EnsureUserIsAdmin` + `IPAllowlist`).
- **UX & screens:** `resources/views/admin/settings/mobile-push.blade.php`. Four status tiles: Push status (Enabled or Off), Service account (Configured or Not set), Project (service-account project id, else override, else dash), Registered devices (count of all `user_device_tokens`). Form: FCM project id (optional), textarea for the JSON (blank keeps existing; the stored value is never echoed), when set: shows the service-account client email and a checkbox "Remove the saved service account (turns push OFF)". A six-step how-to guide sits beside the form. Flash messages: "Mobile push (FCM) settings saved." or "Firebase service account cleared — mobile push is now off."
- **Endpoints:**

| Endpoint                        | Route name                        | Action                                       | Middleware                                   | Request                                                                                                                       | Response                                |
| ------------------------------- | --------------------------------- | -------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| GET admin/settings/mobile-push  | admin.settings.mobile-push        | AdminPagesController@settingMobilePush       | Authenticate, EnsureUserIsAdmin, IPAllowlist | none                                                                                                                          | HTML                                    |
| POST admin/settings/mobile-push | admin.settings.mobile-push.update | AdminPagesController@settingMobilePushUpdate | Authenticate, EnsureUserIsAdmin, IPAllowlist | `fcm_project_id` nullable string max 191, `fcm_service_account_json` nullable string, `clear_service_account` nullable 0 or 1 | redirect back with flash or field error |

- **Data:** `system_settings`: `fcm_project_id`, `fcm_service_account_json` (encrypted at rest). Reads count of `user_device_tokens`.
- **Rules & edge cases:**
  1. Clear: sets the JSON to empty and returns immediately (project id untouched); audited as `settings.fcm_update` with `cleared` true.
  2. Otherwise saves the trimmed project id, then, only if JSON text was posted, validates that it decodes to an object having non-empty `client_email`, `private_key` and `project_id`; failure returns the error "Not a valid Firebase service-account JSON — it must contain client_email, private_key and project_id." and does not save the JSON.
  3. NOTE: the project id is saved before JSON validation, so a failed JSON still updates the override.
  4. Audit `settings.fcm_update` records the project id and whether JSON was updated (never the JSON).
  5. "Enabled" means a project id (from JSON, else the override) is present and the JSON parses to an object with `client_email` and `private_key`.
  6. The mobile-app config endpoint reports `push.fcm_enabled` to the app (MOB).
- **Async & events:** Audit log entry.
- **External systems:** Firebase console (manual steps documented on screen).
- **Settings:** `fcm_project_id`, `fcm_service_account_json`.
- **Acceptance criteria:**
  - Given a valid service-account JSON, when saved, then push status shows Enabled and the client email is displayed.
  - Given JSON without `private_key`, then a field error shows and the previous JSON is retained.
  - Given "Remove" is ticked, then status becomes Off.
  - Given the page is reloaded, then the JSON is never rendered back.
- **Source refs:** app/Http/Controllers/AdminPagesController.php, resources/views/admin/settings/mobile-push.blade.php, app/Services/Push/FcmService.php, app/Models/SystemSetting.php
- **Port notes:** Store the service account in the platform secrets vault with envelope encryption; expose `GET/PUT /admin/push/fcm` with a redacted read model. Emit an audit entry on every change.

### TW-NOTIF-023 — FCM v1 sender

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-NOTIF-022
- **Summary:** A dependency-free Firebase Cloud Messaging HTTP v1 client. It mints an OAuth access token from the service account with a signed JWT, caches it, sends one notification to many tokens concurrently, and reports which tokens are dead.
- **Actors & access:** System.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** Reads `system_settings`; caches token in the cache store.
- **Rules & edge cases:**
  1. Enabled only when a project id and a valid service account exist.
  2. Access token: RS256 JWT (issuer client email, scope firebase.messaging, audience Google token endpoint, 1 hour lifetime) exchanged at `https://oauth2.googleapis.com/token` (10 s timeout); cached under a key derived from the client email for `expires_in - 300` seconds (minimum 60).
  3. Send: unique non-empty tokens, chunks of 100 sent concurrently via an HTTP pool (15 s timeout each) to `https://fcm.googleapis.com/v1/projects/{project}/messages:send`, one token per call, bearer auth. Message has token, notification, stringified data map (scalars cast to strings, arrays JSON-encoded, nulls dropped), Android config (defaults to priority high), optional APNs config.
  4. Result `{sent, failed, invalid[]}`. A token is `invalid` when FCM reports NOT_FOUND, UNREGISTERED or INVALID_ARGUMENT; the caller deletes it.
  5. Token exchange failure marks every token failed. All requests are logged with counts and truncated response bodies (300 chars) and the first 12 chars of a token.
  6. QUIRK: INVALID_ARGUMENT also deletes tokens, so a malformed payload (not a bad token) can prune valid tokens.
- **Async & events:** Called deferred after the response by TW-NOTIF-025.
- **External systems:** Google OAuth2 and FCM HTTP v1; credentials in system settings.
- **Settings:** `fcm_project_id`, `fcm_service_account_json`.
- **Acceptance criteria:**
  - Given 250 tokens, then three chunks are sent and the result totals sum to 250.
  - Given FCM answers UNREGISTERED for a token, then it appears in `invalid`.
  - Given the token endpoint returns 401, then all tokens count as failed and nothing throws.
  - Given a second send within 55 minutes, then the cached access token is reused.
- **Source refs:** app/Services/Push/FcmService.php
- **Port notes:** Implement behind an `FcmPort` adapter in a worker using `google-auth-library`. Do not delete tokens on INVALID_ARGUMENT unless the error detail names the token.

### TW-NOTIF-024 — Mobile device-token registry

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-NOTIF-023
- **Summary:** The mobile app registers its FCM token after login or token refresh and unregisters on logout, so inbound messages can wake it. Registration is scoped to a workspace and optionally a specific WhatsApp number.
- **Actors & access:** Mobile app user with a Sanctum token (routes belong to MOB; behaviour and table belong here).
- **UX & screens:** none (API only).
- **Endpoints:**

| Endpoint                                             | Route name | Action                                   | Middleware                                     | Request                                                                                                                               | Response         |
| ---------------------------------------------------- | ---------- | ---------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| POST api/app/device-tokens/register (owned by MOB)   | app.       | Api\App\DeviceTokenController@register   | api, Authenticate:sanctum, ResolveAppWorkspace | `fcm_token` required string max 4096, `platform` nullable android or ios, `device_info` nullable array; header `X-Device-Id` optional | `{success:true}` |
| POST api/app/device-tokens/unregister (owned by MOB) | app.       | Api\App\DeviceTokenController@unregister | same                                           | `fcm_token` required                                                                                                                  | `{success:true}` |

- **Data:** `user_device_tokens` (`user_id`, `workspace_id`, `device_id` nullable (pinned WhatsApp number), `fcm_token` text, `token_hash` char 64 unique = sha256(trimmed token), `platform`, `device_info` JSON, `last_used_at`); index on (workspace_id, device_id).
- **Rules & edge cases:**
  1. Upsert by token hash: the same token re-registered by another user moves to that user (last login wins).
  2. `device_id` comes from the validated pinned-device header or attribute; absent means subscribe to all of the workspace's numbers.
  3. Unregister deletes by hash regardless of owner.
  4. No cap on tokens per user; dead tokens are pruned only when FCM rejects them (TW-NOTIF-025).
  5. Admin page shows the total token count.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a token registered twice, then one row exists with an updated `last_used_at`.
  - Given a token registered without device header, then `device_id` is NULL.
  - Given logout unregister, then the row is deleted.
- **Source refs:** app/Http/Controllers/Api/App/DeviceTokenController.php, app/Models/UserDeviceToken.php, database/migrations/2026_08_13_000000_create_user_device_tokens_table.php
- **Port notes:** Table with `org_id`, RLS, unique (org_id, token_hash). Endpoints live in the mobile module (MOB); this domain provides the repository and pruning logic.

### TW-NOTIF-025 — Inbound-message FCM push to mobile operators

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-NOTIF-023, TW-NOTIF-024
- **Summary:** For every inbound WhatsApp message (Baileys or Cloud API), operators who registered a mobile token for that workspace and number get a push with a WhatsApp-style grouped notification and an unread badge.
- **Actors & access:** System; recipients are mobile app installs registered for the workspace.
- **UX & screens:** Title "{sender name} · +{digits}" (or "New message"), body the preview text (or a paperclip plus media type) trimmed to 160 chars, plus " · +N message(s)" when the chat has more than one unread; max title 100, body 200. Android: high priority, channel `chat_messages`, sound default, tag `chat_{conversation}` (one tile per chat), notification count = chat unread. iOS: apns-priority 10, thread id `chat_{conversation}`, content-available 1, badge = total unread across the workspace. Data payload: type `chat_message`, conversation id, workspace id, device id, message id, sender digits, sender name, is_group, channel.
- **Endpoints:** none.
- **Data:** Reads `user_device_tokens`, `conversations.unread_count`; deletes rejected tokens by hash.
- **Rules & edge cases:**
  1. Runs deferred after the webhook response and never throws.
  2. Skipped when workspace id is not positive, FCM is not enabled, or no tokens.
  3. Burst guard: at most one push per conversation per 3 seconds (cache key per conversation).
  4. Recipients: all tokens of the workspace whose pinned device equals the receiving number or whose device is NULL.
  5. Group chat detection by `@g.us` on the raw JID.
  6. Every workspace token gets the push regardless of role or assignment (no per-agent routing).
  7. Rejected tokens are deleted after each send; a summary line is logged.
- **Async & events:** Called from both inbound webhook controllers after the message is stored.
- **External systems:** FCM (TW-NOTIF-023).
- **Settings:** FCM settings.
- **Acceptance criteria:**
  - Given three tokens (one pinned to another number), when a message arrives on number X, then two tokens receive the push.
  - Given two messages in the same chat within 3 seconds, then only the first sends.
  - Given the chat has 3 unread, then the body ends with " · +2 messages".
  - Given FCM returns UNREGISTERED, then the token is removed.
- **Source refs:** app/Services/Push/InboxPushNotifier.php, app/Http/Controllers/WaInboundController.php, app/Http/Controllers/WaWebhookController.php
- **Port notes:** Consume `message.received` in a `push` worker; compute per-user recipients (assigned agent or team) as an improvement while keeping the workspace-wide default for parity.

### TW-NOTIF-026 — Audit write pipeline (facade, layers, redaction)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** none
- **Summary:** Every sensitive action in the product records an immutable row in `audit_logs` through one facade. It captures who, what, on which record, in which workspace, from which IP and browser, with a result, and scrubs secret-looking values from the payload before storing.
- **Actors & access:** System (called by ~150 call sites across admin, settings, devices, support, billing and inbox controllers). Nothing in the app updates or deletes rows except the prune (TW-NOTIF-035).
- **UX & screens:** Read via TW-NOTIF-029 and TW-NOTIF-032; also feeds dashboard activity widgets, the More page recent activity and the admin device detail event list (other domains read the same table).
- **Endpoints:** none.
- **Data:** `audit_logs` (`layer` varchar 12, `workspace_id`, `actor_user_id`, `action` varchar 64, `subject_type` varchar 64, `subject_id`, `payload` JSON, `result` enum success|failure|warning default success, `ip` varchar 64, `user_agent` varchar 500, `created_at`; no updated_at). Indexes on layer, workspace, actor, action, result, created_at and (subject_type, subject_id).
- **Rules & edge cases:**
  1. Facade `Audit::log(action, options)` options: `resource` (a model: derives `subject_type` as lowercase class name, `subject_id` as key, `_label` as the first string among name, title, email, label, text cut to 200), `subject_type`, `subject_id`, `resource_label`, `actor` (default signed-in user), `workspace_id` (default the actor's current workspace), `layer`, `result` (success, failure or warning; anything else coerced to success), `meta` (payload array).
  2. Layer default: `platform` when the action starts with `admin.`, otherwise `workspace`. So actions such as `workspace.created`, `settings.mail_update` and observer events are stored as layer workspace even when a platform admin did them (see quirk in TW-NOTIF-028).
  3. The label is placed in the payload key `_label` unless one is already set.
  4. Redaction: recursively replaces the value with the literal `[REDACTED]` when the key name matches (case-insensitive) password, secret, token, api key (with or without separator), credential, private, access key, client secret, webhook, signing or bearer. Keys named `credential_keys_set`, `missing_keys` and `changed_keys` are exempt (they hold key names). Empty, null and false values are left as is. Keys stay visible so the trail shows that something changed.
  5. `AuditLogger::workspace` and `::platform` write the row with IP and the first 500 chars of the user agent from the current request (null in CLI/queue contexts) and `created_at` now.
  6. All writes are wrapped: a failure is written to the PHP error log and never propagates; audit loss must not block the action.
  7. Action naming: `noun.verb` in dot notation. Recurring families: auth._, conversation._, note._, team._, member._, workspace._, impersonation._, platform_note._, settings._, integration._, devices._, support._, billing._, guidebook._, legal_page._, meta_ads._, inbox._, admin._ (user, workspace, order, role, security, updater, extension, module, language, translation_provider, payment_gateway, frontend, mailtrixy, instaflow, device, site_settings).
  8. Because `action` is limited to 64 characters, longer action names would be truncated or rejected by strict databases.
  9. Result values: `failure` for denied or failed attempts (login failed, throttle and denied operations), `warning` for security alerts (`auth.alert_emitted`).
- **Async & events:** Synchronous insert in the request. No queue, no broadcast.
- **External systems:** none.
- **Settings:** none (retention in TW-NOTIF-035).
- **Acceptance criteria:**
  - Given `Audit::log('settings.mail_update', meta {fields:[...], smtp_password:'x'})`, then the stored payload has `smtp_password` equal to `[REDACTED]` and the other keys intact.
  - Given a request from IP 1.2.3.4 with a 600-char user agent, then the row stores that IP and a 500-char user agent.
  - Given a call with `result` of "bogus", then the row stores `success`.
  - Given the database insert fails, then the calling action still completes and the failure appears in the error log.
  - Given an action starting `admin.`, then `layer` is `platform`; otherwise `workspace`.
- **Source refs:** app/Support/Audit.php, app/Services/Inbox/AuditLogger.php, app/Models/AuditLog.php, database/migrations/2026_05_06_120005_create_platform_tables.php, database/migrations/2026_05_23_104529_add_result_to_audit_logs.php
- **Port notes:** There is an `AuditService.record(tx, {module, recordId, action, delta})` in `apps/api/src/kernel/audit` writing a different shape (`audit_log` with module, record_id, delta, actor_type, request_id, partitioned by month). It has no `layer`, `result`, `ip`, `user_agent` or `subject` free text. Extend it (new migration via the add-migration skill) with `layer`, `result`, `ip`, `user_agent`, `subject_type`, `payload` (or map `subject_type` to `module`), and put the redaction function in the service so every caller gets it. Write the audit row inside the same transaction as the business write (repo rule), unlike Reference's best-effort swallow. Keep the action taxonomy above as constants.

### TW-NOTIF-027 — Authentication event auditing

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-NOTIF-026
- **Summary:** Framework auth events (login, logout, failed attempt, password reset) are written to the audit log so each sign-in is attributable to a user, IP and device, and later drives the Activity Log and the login-alert mail.
- **Actors & access:** System listeners bound at application boot.
- **UX & screens:** Appear in the Activity Log category "Sign-in & sign-out" and in the admin Audit Log.
- **Endpoints:** none.
- **Data:** Writes `audit_logs` layer workspace: `auth.login` (payload guard, remember flag; subject user id), `auth.logout` (guard), `auth.failed` (result failure; payload guard and the attempted identifier, email or username cut to 191; never the password; the actor is set only if the user record was found), `auth.password_reset`. Other auth actions written elsewhere: `auth.lockout`, `auth.session_timeout`, `auth.concurrent_sessions_evicted`, `auth.alert_emitted`, `workspace.entered`, `user.login_failed`.
- **Rules & edge cases:**
  1. The login listener runs for every login path (password, social, remember-me), so it is also where pending team invitations are accepted: all `workspace_user` rows for the user with NULL `joined_at` get `joined_at` set (owned by AUTH/WSP, documented here because it lives in this listener). It then calls the login-alert listener (TW-NOTIF-045) after the audit row exists, and provisions the private admin workspace for platform admins on first login.
  2. Login may fire more than once for one sign-in (remember-me re-auth), creating duplicate `auth.login` rows.
  3. Workspace is the user's current workspace at event time (may be NULL before onboarding).
  4. Failure to write never blocks the login.
- **Async & events:** Laravel Login, Logout, Failed and PasswordReset events.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a successful login, then an `auth.login` row exists with the user, IP and user agent.
  - Given a failed login for email x@y.com, then an `auth.failed` row with result failure and identifier x@y.com exists and no password appears anywhere.
  - Given a password reset completes, then `auth.password_reset` exists.
  - Given a user with pending invitations logs in, then their invitations become accepted.
- **Source refs:** app/Providers/AppServiceProvider.php, app/Services/Inbox/AuditLogger.php
- **Port notes:** Emit from the auth module (AUTH) on each auth outcome; keep failed-login identifier capture. Do not replicate the invitation-accept side effect here; place it in the invitation service.

### TW-NOTIF-028 — Model-observer auditing of platform models

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-NOTIF-026
- **Summary:** Eight core models automatically write an audit row on create, update, delete and restore, including a compact diff of changed fields.
- **Actors & access:** System. Models: Workspace, User, Package, Coupon, CreditPackage, Announcement, Order, Device.
- **UX & screens:** Shows in both audit UIs. Action names come from the lowercase class name: `workspace.created`, `user.updated`, `package.deleted`, `order.restored`, `creditpackage.created`, `device.updated` and so on.
- **Endpoints:** none.
- **Data:** `audit_logs` rows with `subject_type` = lowercase class, `subject_id`, payload `{ _label, changes:{field: newValue} }` for updates.
- **Rules & edge cases:**
  1. Updates with no changes other than `updated_at` are skipped. Only new values are stored, not old ones.
  2. String values longer than 500 chars are replaced with a placeholder "<N chars>".
  3. Redaction (TW-NOTIF-026) applies, so `password` and `remember_token` changes show `[REDACTED]`.
  4. QUIRK: `user.updated` fires on every login because the remember token changes, and again when the current workspace changes; the demo audit table shows these rows. Expect heavy noise.
  5. QUIRK: these events are layer `workspace` (no `admin.` prefix), even though they are platform-level; the admin Audit Log "Platform-level" KPI and tab therefore exclude them.
  6. `workspace_id` on these rows is the acting user's current workspace, not the record's, so a workspace-level `workspace.created` row can be NULL or point at the creator's other workspace.
- **Async & events:** Model events.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an admin edits a package price, then a `package.updated` row exists with `changes` containing the new price.
  - Given a user's password changes, then `changes.password` is `[REDACTED]`.
  - Given a save with no real changes, then no row is written.
- **Source refs:** app/Observers/AuditableObserver.php, app/Providers/AppServiceProvider.php
- **Port notes:** Prefer explicit `audit.record` calls in the owning services inside the transaction and store old and new values (the kernel `delta` shape already does). Set the layer properly (platform for admin-panel actions). Limit to meaningful fields to avoid the login noise.

### TW-NOTIF-029 — Workspace Activity Log page

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** L (<=2 weeks)
- **Depends on:** TW-NOTIF-026
- **Summary:** A workspace audit trail for admins and owners: KPI cards, an events-over-time chart, an auth/writes/reads donut, a filterable paginated table with a side detail panel, top actors, and a by-category chart, all reloadable without a page refresh.
- **Actors & access:** Workspace admin or owner (`EnsureWorkspaceRole:admin`); agents, managers and viewers are redirected to the team inbox (agents, viewers) or get 403 (managers). Platform admins bypass the role check. Nav item tier "admin" under More. No plan gate.
- **UX & screens:** `resources/views/user/activity-log/index.blade.php`, `_rows.blade.php`, script `resources/js/charts/user-activity-log-index.js` (ApexCharts).
  - Header: range select (Last 24 hours, 7 days default, 30, 90), Export CSV link, Refresh.
  - KPI cards: Total events (with percentage versus the previous equal-length window), Sign-ins, Writes, Reads/other, Unique IPs; each with percent of total.
  - Volume chart: stacked bars auth, writes, other; bucket tabs Daily, Hourly, Weekly.
  - Donut: Auth vs Writes vs Reads/other with total in the centre.
  - Table: search box (action, subject or IP), scope tabs "My activity" and "Workspace", category select with counts, Reset filters, list/grid toggle, select-all checkbox (cosmetic), columns When (time and date), Action (icon, label, raw key), Category badge, Actor (initials), Subject, IP, Open (eye icon). Row click loads the detail panel. Pagination: prev, up to five numbered pages, next; footer "Showing a–b of N".
  - Detail panel: id, action label and key, category, layer, actor, exact time, subject, IP, full user agent, pretty payload JSON, buttons "Copy ID" (copies `audit-{id}`) and "Copy payload".
  - Bottom: "Top actors" cards (four most active, initials, count, last time, link to members) and "By category" horizontal bar (zero categories dropped; sorted descending; "No events yet" placeholder).
  - Empty states: table "No activity matches the current filters..."; detail "No events found..."; top actors empty message.
  - Filters sync to the URL with `history.replaceState`; requests abort when superseded; search debounced 220 ms.
- **Endpoints:**

| Endpoint         | Route name              | Action                      | Middleware                              | Request                                                                                                                                          | Response                                                                                                                                                                          |
| ---------------- | ----------------------- | --------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET activity-log | user.activity-log.index | ActivityLogController@index | Authenticate, EnsureWorkspaceRole:admin | `range` (24h, 7d, 30d, 90d; default 7d), `scope` (me default or workspace), `category`, `bucket` (daily, hourly, weekly), `q`, `page`, `partial` | HTML page, or JSON `{ok, data:{rows, stats, categoryCnts, volume, categoryDonut, topActors, categoryMix, page, pageCount, total, shownFrom, shownTo, filters, detail, rowsHtml}}` |

- **Data:** Reads `audit_logs` joined to `users` for actor names.
- **Rules & edge cases:**
  1. Window: from now minus range to now plus one second. Unknown range values fall back to 7 days.
  2. Scope me: `actor_user_id` equals the caller. Scope workspace: rows whose `workspace_id` equals the caller's current workspace. QUIRK: if the caller has no current workspace (possible for platform admins who bypass the role gate) the workspace filter is silently dropped and the page (and export) shows every workspace's rows.
  3. The workspace scope includes platform-layer rows stamped with that workspace (impersonation, suspension, platform notes).
  4. Category filter is a prefix match on the action (`{category}.%`). Category keys: auth (Sign-in & sign-out), conversation (Inbox actions), note (Internal notes), team (Team changes), broadcast, webhook, workspace, impersonation, other. The dropdown offers all but other. Actions with other prefixes (member, settings, contact, billing, integration, devices, support, admin, user) are counted in "other" in the counts and chart but cannot be filtered.
  5. Free text matches action, subject type or IP with LIKE; the search text is not wildcard-escaped (a `%` or `_` acts as a wildcard, unlike the admin page).
  6. Page size 20; page clamped.
  7. Writes are actions ending in created, updated, deleted, assigned, replied or resolved. Sign-ins are exactly `auth.login`. Reads = total minus writes minus sign-ins (so logout, failed login and note.added count as reads). The volume chart's "auth" series counts every `auth.*` action, so its total differs from the donut and KPI.
  8. Delta versus previous window = round((total − prev)/prev × 100); if prev is 0 the value is 100 when total > 0 else 0.
  9. Volume series: daily uses the range's day count (24h gives 1 point; label weekday abbreviation for ranges up to 7 days else "M d"); hourly always 24 points ending now regardless of range; weekly uses ceil(days/7) week-start buckets. The series is built in memory from all rows in the window (no LIMIT), so wide windows on large workspaces load every row.
  10. Top actors: four highest by count in the window and scope, with last-seen time as H:i and palette gradients.
  11. Row presentation: action label map (auth.login "Signed in", auth.logout, auth.failed "Sign-in failed", auth.password_reset, workspace.entered "Switched workspace", conversation.assigned/unassigned/resolved/reopened/snoozed/replied, note.added/deleted, team.created/updated/deleted, webhook.fired/test); otherwise "Noun verb" with underscores spaced. Date label today, yesterday, "M d", or "M d, Y". User agent truncated to 80 chars in the row, full in the detail. Actor shows name, else "User #id", else "system".
  12. Initial detail panel shows the first row of the first page.
  13. The refresh interval is manual (button); no polling.
  14. QUIRK: docs claim search does not cover payload; true. Docs also say the dashboard widget hides auth/session/user events, which is a DASH behaviour.
- **Async & events:** Client fetches partial JSON per filter change.
- **External systems:** none.
- **Settings:** none. Data volume depends on retention (TW-NOTIF-035).
- **Acceptance criteria:**
  - Given an admin with 45 events in scope, when the page opens, then 20 rows show and the footer says "Showing 1–20 of 45".
  - Given scope "Workspace", then rows from other users of the workspace appear; with scope "My activity" only the caller's.
  - Given category "Inbox actions", then only `conversation.*` rows show and KPI totals still reflect the scope and range (not the category).
  - Given an agent role opens `/activity-log`, then they are redirected to the team inbox with a warning flash.
  - Given range 24h and bucket daily, then the chart has one bar.
  - Given a search for "auth.log", then rows for `auth.login` and `auth.logout` match.
- **Source refs:** app/Http/Controllers/ActivityLogController.php, resources/views/user/activity-log/index.blade.php, resources/views/user/activity-log/_rows.blade.php, resources/js/charts/user-activity-log-index.js, app/Http/Middleware/EnsureWorkspaceRole.php, routes/web.php, Documentation/pages/account/activity-log.html
- **Port notes:** `apps/web/app/(app)/activity-log` and `GET /activity-log` in the audit module with keyset pagination and SQL aggregations (`date_trunc`) instead of in-memory series. Enforce a workspace filter always (RLS handles tenant; the no-workspace fallthrough must not be ported). Escape LIKE wildcards. Permission: reuse the admin-role check, mapped to RBAC (`audit.view`).

### TW-NOTIF-030 — Activity Log event detail

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-NOTIF-029
- **Summary:** Fetch one audit event for the side panel.
- **Actors & access:** Workspace admin or owner (`EnsureWorkspaceRole:admin`).
- **UX & screens:** The detail panel described in TW-NOTIF-029.
- **Endpoints:**

| Endpoint              | Route name             | Action                     | Middleware                              | Request | Response                                                                                                                                                       |
| --------------------- | ---------------------- | -------------------------- | --------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET activity-log/{id} | user.activity-log.show | ActivityLogController@show | Authenticate, EnsureWorkspaceRole:admin | path id | `{ok, detail}` (row fields plus subjectType, subjectId, workspaceId, fullUserAgent, payloadJson pretty-printed, createdAt "M d, Y H:i:s"); 404 if out of scope |

- **Data:** Reads `audit_logs` and the actor.
- **Rules & edge cases:** 1. Visible if the caller is the actor, or the row's workspace equals the caller's current workspace; with no current workspace only the actor branch applies (correctly closed, unlike the list). 2. Not filtered by layer, so platform-layer rows of that workspace, and other-workspace rows the caller once acted on, are viewable including payloads. 3. Payload is shown after write-time redaction only.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an event in the caller's workspace, then the detail JSON returns with payload text.
  - Given an event in another workspace by another user, then 404.
  - Given the caller is the actor of a row in another workspace, then it is returned (documented behaviour).
- **Source refs:** app/Http/Controllers/ActivityLogController.php
- **Port notes:** `GET /activity-log/:id`; decide whether cross-workspace actor rows should remain visible (recommend no).

### TW-NOTIF-031 — Activity Log CSV export

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-NOTIF-029
- **Summary:** Download the current range and scope of the Activity Log as CSV.
- **Actors & access:** Workspace admin or owner.
- **UX & screens:** "Export CSV" link in the header; URL is updated when range or scope change (category, search and bucket are not carried).
- **Endpoints:**

| Endpoint                | Route name               | Action                       | Middleware                              | Request          | Response                                                         |
| ----------------------- | ------------------------ | ---------------------------- | --------------------------------------- | ---------------- | ---------------------------------------------------------------- |
| GET activity-log/export | user.activity-log.export | ActivityLogController@export | Authenticate, EnsureWorkspaceRole:admin | `range`, `scope` | streamed `text/csv`, filename `activity-log-YYYYMMDD-HHMMSS.csv` |

- **Data:** Reads `audit_logs` newest first in chunks of 500. Columns: id, created_at (ISO 8601), layer, actor_user_id, workspace_id, action, subject_type, subject_id, ip, user_agent.
- **Rules & edge cases:**
  1. No payload and no result columns, no BOM, no formula-injection guard (contrast with the admin export). Docs claim the export includes level and full details; the code does not.
  2. The same scope quirk as the list applies: no current workspace exports everything.
  3. The route `activity-log/export` is registered before `activity-log/{id}` so it is not captured by the id route.
  4. Chunked reading with a non-unique sort can skip or repeat rows under concurrent writes.
- **Async & events:** streamed synchronously; no size cap.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 1200 rows in scope, then the file has a header plus 1200 lines.
  - Given scope "me", then only the caller's rows are exported.
  - Given range 30d, then rows older than 30 days are excluded.
- **Source refs:** app/Http/Controllers/ActivityLogController.php
- **Port notes:** Stream through a cursor with keyset paging; add `result` and payload columns and the CSV-injection guard from TW-NOTIF-034; consider a background export for large sets.

### TW-NOTIF-032 — Admin Audit Log page

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-NOTIF-026
- **Summary:** A platform-wide audit browser for super-admins: KPIs, layer tabs, event and result filters, date range, search, a paginated event stream with side detail, top actors, event mix, review queue of failures and warnings, and CSV export.
- **Actors & access:** Platform admin: `Authenticate`, `EnsureUserIsAdmin` (Spatie role Super Admin or Admin, or legacy `role` admin or A) and `IPAllowlist`. QUIRK: the seeded permissions `audit.view`, `audit.export` and the platform permission `platform.audit.view` are not checked by this controller; only the admin gate applies.
- **UX & screens:** `resources/views/admin/audit-log/index.blade.php`, scripts `resources/js/charts/admin-audit-log-index.js` and `audit-log-index.js`.
  - Header search (action, IP or payload text), date pickers From and To, Apply, Export CSV.
  - KPI cards: Events captured (all time), Today (since midnight), Failures (all time), Platform-level (all time count of layer platform, labelled "admin actions").
  - Layer tabs: All, Platform, Workspace with counts (workspace count is total minus platform); event select (distinct actions, alphabetical, up to 200); result select (success, failure, warning). Filters submit as a GET form.
  - Event stream table (12 per page, `withQueryString`): Time, Actor (name and email, or "User #id", or "System"), Event (action chip), Resource (label from payload `_label` else subject), Workspace name, IP (or "internal"), Result pill; failure rows tinted red, warning rows amber. Live pill and count.
  - Sidebar: "Selected event" panel (auto-loads the first row; pills for result and layer; fields action, when, actor, workspace, subject, IP, user agent; payload JSON), "Review queue" of the three latest failures or warnings (click opens detail).
  - Cards: Top actors (last 7 days, four bars), Event mix ("By module (7d)": top four action prefixes with percent), Retention card. QUIRK: the retention card text says events are kept indefinitely while the actual policy prunes after the configured days (default 365), see TW-NOTIF-035. Its "Download CSV" repeats export.
  - Empty state: "No audit events match the current filters."
- **Endpoints:**

| Endpoint            | Route name            | Action                         | Middleware                                   | Request                                                                                                                                                    | Response |
| ------------------- | --------------------- | ------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| GET admin/audit-log | admin.audit-log.index | Admin\AuditLogController@index | Authenticate, EnsureUserIsAdmin, IPAllowlist | `q` max 191, `event` max 120, `result` in success,failure,warning, `layer` in platform,workspace, `workspace_id` integer, `from` and `to` as Y-m-d, `page` | HTML     |

- **Data:** Reads `audit_logs`, `users`, `workspaces`.
- **Rules & edge cases:**
  1. Validation failure returns the standard 422 redirect with errors (dates must be exact Y-m-d; `q` capped to avoid heavy LIKE patterns).
  2. Filters: event exact match, result, layer, workspace id, from at 00:00:00, to at 23:59:59 (server timezone), search across action, ip and the payload JSON text with LIKE, wildcards escaped.
  3. Ordering: newest first; page size 12.
  4. Every page load may run the inline retention sweep (TW-NOTIF-035).
  5. KPI counts are full-table counts (four COUNT queries per page load); expect slowness on large tables.
  6. Event mix uses the first segment of each action for the last 7 days; percent is of that window's total.
  7. The workspace id filter has no UI control but is accepted as a query parameter.
  8. Event options are limited to 200 distinct actions.
  9. The layer tab links keep other filters but drop `page`.
- **Async & events:** Row click fetches TW-NOTIF-033.
- **External systems:** none.
- **Settings:** `security.audit_log_retention_days` (managed on the admin Security page, AUTH).
- **Acceptance criteria:**
  - Given 30 events, then the first page shows 12 and the pager shows 3 pages.
  - Given `result=failure`, then only failure rows appear and the review queue is unaffected by filters.
  - Given `from=2026-01-10&to=2026-01-12`, then events from 00:00:00 of the 10th to 23:59:59 of the 12th appear.
  - Given `from=10-01-2026`, then validation fails.
  - Given a non-admin user, then 403 "Admins only.".
  - Given search `100%`, then it matches the literal text "100%".
- **Source refs:** app/Http/Controllers/Admin/AuditLogController.php, resources/views/admin/audit-log/index.blade.php, resources/js/charts/admin-audit-log-index.js, resources/js/charts/audit-log-index.js, app/Models/AuditLog.php, routes/admin.php, app/Http/Middleware/EnsureUserIsAdmin.php
- **Port notes:** Admin module `apps/api/src/modules/admin/audit`. Use `platform.audit.view` (already in RBAC matrix for Super Admin, Platform Support and Auditor) as the real gate. Materialise KPIs cheaply (approximate counts or cached). Payload search needs a GIN index on jsonb or a text search column. Cross-tenant reads need a platform-scoped role that bypasses RLS explicitly.

### TW-NOTIF-033 — Admin Audit Log event detail

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-NOTIF-032
- **Summary:** Fetch one audit event with actor, workspace, subject, IP, user agent and full payload.
- **Actors & access:** Platform admin.
- **UX & screens:** "Selected event" panel in TW-NOTIF-032.
- **Endpoints:**

| Endpoint                 | Route name           | Action                        | Middleware                                   | Request         | Response                                                                                                                                                                    |
| ------------------------ | -------------------- | ----------------------------- | -------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET admin/audit-log/{id} | admin.audit-log.show | Admin\AuditLogController@show | Authenticate, EnsureUserIsAdmin, IPAllowlist | numeric path id | `{id, layer, action, result, subject ("type#id" or null), actor{id,name,email}, workspace{id,name}, ip, user_agent, payload, created_at ISO, human_time}`; 404 when missing |

- **Data:** Reads `audit_logs`, `users`, `workspaces`.
- **Rules & edge cases:** 1. Route parameter is numeric-only. 2. Actor and workspace are null when unset or deleted. 3. Full user agent (up to 500 chars) is returned.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a valid id, then the JSON has payload and human time.
  - Given an id that does not exist, then 404.
  - Given a non-numeric id, then the route does not match.
- **Source refs:** app/Http/Controllers/Admin/AuditLogController.php, resources/js/charts/admin-audit-log-index.js
- **Port notes:** `GET /admin/audit/:id` with the same shape.

### TW-NOTIF-034 — Admin Audit Log CSV export

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-NOTIF-032
- **Summary:** Download all audit rows matching event, result and date filters as a spreadsheet-safe CSV.
- **Actors & access:** Platform admin.
- **UX & screens:** "Export CSV" buttons on the page; the link carries the active filters.
- **Endpoints:**

| Endpoint                   | Route name             | Action                          | Middleware                                   | Request                                                    | Response                                                        |
| -------------------------- | ---------------------- | ------------------------------- | -------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| GET admin/audit-log/export | admin.audit-log.export | Admin\AuditLogController@export | Authenticate, EnsureUserIsAdmin, IPAllowlist | `event`, `result`, `from`, `to` (validated as on the page) | streamed `text/csv`, filename `audit-log-YYYY-MM-DD-HHMMSS.csv` |

- **Data:** Columns: Time (ISO 8601), Layer, Actor ID, Action, Subject (type#id), Workspace (id), IP, Result, Payload (JSON with unescaped slashes). Newest first, chunks of 500. UTF-8 BOM first so Excel reads it.
- **Rules & edge cases:**
  1. Formula-injection guard: any cell whose first character is `=`, `+`, `-`, `@`, tab, CR or LF is prefixed with a single quote.
  2. QUIRK: the page passes `q` and `layer` to the export link, but the export validates and applies only event, result, from and to, so exports ignore search text and layer tab.
  3. No row limit; large tables stream for a long time in one request.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an action value beginning with `=`, then the CSV cell begins with `'=`.
  - Given `result=failure`, then only failure rows export.
  - Given the file is opened in Excel, then non-ASCII text is displayed correctly (BOM present).
- **Source refs:** app/Http/Controllers/Admin/AuditLogController.php
- **Port notes:** Streaming response with a cursor; apply all filters including layer and search (fixing the quirk). Record an `admin.audit.exported` audit row.

### TW-NOTIF-035 — Audit retention pruning

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-NOTIF-026
- **Summary:** Old audit rows are deleted according to a configurable retention window, by a CLI command and by an opportunistic sweep when an admin opens the Audit Log page.
- **Actors & access:** System and operators; the retention value is edited by platform admins on the Security page (AUTH).
- **UX & screens:** The admin Security page holds the number field (0 to 3650). The Audit Log retention card (incorrectly) says "indefinitely".
- **Endpoints:** none.
- **Data:** Deletes from `audit_logs` where `created_at` is older than now minus the days. Setting `security.audit_log_retention_days`, default 365; 0 or less disables pruning.
- **Rules & edge cases:**
  1. Command `audit:prune` with `--days=N` (override) and `--dry-run` (report only). It deletes in batches of 2000 and prints progress; prints a message when disabled or nothing to prune.
  2. Inline sweep (in the Audit Log page): runs only if retention > 0 and an atomic cache add of key `audit:prune:last` succeeds (24-hour lock, so once per day per cache); deletes at most 5 batches of 2000 (10k rows) per request; exceptions are logged and swallowed.
  3. The command is documented to be scheduled daily at 03:30, but the reference app defines no schedule (the manifest shows none), so in practice only the page sweep runs, and only if an admin opens the page.
  4. `security_audit_log` and `notifications` are not pruned by anything.
- **Async & events:** BullMQ repeatable job in the port.
- **External systems:** none.
- **Settings:** `security.audit_log_retention_days`.
- **Acceptance criteria:**
  - Given retention 30 and rows 40 days old, when the command runs, then those rows are deleted in batches and a count is printed.
  - Given `--dry-run`, then nothing is deleted and the would-delete count is printed.
  - Given retention 0, then nothing is pruned.
  - Given two page loads within 24 hours, then the sweep runs once.
- **Source refs:** app/Console/Commands/AuditLogPruneCommand.php, app/Http/Controllers/Admin/AuditLogController.php, app/Http/Controllers/Admin/SecurityController.php
- **Port notes:** The kernel `audit_log` is monthly partitioned; retention becomes dropping old partitions (`partition-maintenance.service.ts` already exists) instead of row deletes. Expose the setting in platform settings; add per-tenant override only if required.

### TW-NOTIF-036 — Admin team-inbox audit JSON

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-NOTIF-026
- **Summary:** A JSON feed of the latest 200 audit rows for the admin team-inbox console, optionally filtered by layer or workspace.
- **Actors & access:** Platform admin with Spatie permission `platform.audit.view` (granted to Super Admin, Platform Support and Auditor); otherwise 403.
- **UX & screens:** Used by the admin team-inbox app (SUPP or ASHELL surface); no screen here.
- **Endpoints:**

| Endpoint                       | Route name                 | Action                                  | Middleware                                   | Request                 | Response                                                    |
| ------------------------------ | -------------------------- | --------------------------------------- | -------------------------------------------- | ----------------------- | ----------------------------------------------------------- |
| GET admin/team-inbox/api/audit | admin.team-inbox.api.audit | Admin\AdminTeamInboxController@auditLog | Authenticate, EnsureUserIsAdmin, IPAllowlist | `layer`, `workspace_id` | JSON array of up to 200 raw `audit_logs` rows, newest first |

- **Data:** Reads `audit_logs`.
- **Rules & edge cases:** 1. Returns raw rows including payload and IP with no redaction beyond write-time scrubbing. 2. No pagination.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `layer=platform`, then only platform rows return.
  - Given a user without `platform.audit.view`, then 403.
  - Given more than 200 rows, then only the 200 newest return.
- **Source refs:** app/Http/Controllers/Admin/AdminTeamInboxController.php, app/Support/PlatformPermissions.php, database/seeders/RolePermissionSeeder.php
- **Port notes:** Single audit query service reused by the admin audit module; this endpoint is a thin projection. Note the enforced permission is the only real audit-permission check in Reference.

### TW-NOTIF-037 — Security audit log (write-only)

- **Status:** partial
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** none
- **Summary:** A second, older audit table records account-security events from the workspace Settings, Security tab. Nothing in the app reads it back.
- **Actors & access:** System on behalf of the user.
- **UX & screens:** none (no reader).
- **Endpoints:** none.
- **Data:** `security_audit_log` (`user_id`, `workspace_id`, `event` varchar 64, `status` varchar 16, `ip`, `user_agent` up to 255, `payload` JSON, `created_at`). Events: two_factor_enabled, two_factor_disabled, two_factor_failed, session_revoked (session id), all_sessions_revoked (count), workspace_deleted (id, name), data_residency_changed. Status values used: success, failed, info.
- **Rules & edge cases:** 1. Failures to write are swallowed silently. 2. Not visible in the Activity Log or Audit Log; not pruned. 3. Not passed through the redaction routine.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a user enables 2FA, then a `two_factor_enabled` row with status success exists.
  - Given a wrong 2FA code, then a `two_factor_failed` row with status failed exists.
  - Given the write fails, then the user action still succeeds.
- **Source refs:** app/Support/SecurityAuditLogger.php, app/Http/Controllers/SettingsTabsController.php
- **Port notes:** Fold into the unified audit log (layer workspace, actions `security.two_factor_enabled` etc.) and drop the separate table.

### TW-NOTIF-038 — Admin platform notification feed page

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** none
- **Summary:** A page for super-admins showing what is happening across the whole platform: new signups, orders and payments, support tickets, contact-form messages and new workspaces. It is derived live from existing tables; there is no notification store.
- **Actors & access:** Platform admin (`EnsureUserIsAdmin` + `IPAllowlist`). Separate from the user-side feed.
- **UX & screens:** `resources/views/admin/notifications/index.blade.php`. Title "Admin notifications"; "Mark all read" button (posts then reloads). KPI strip of six cards (All events, Signups, Payments, Support, Messages, Workspaces) with counts over the last 30 days; clicking a card filters by type. Filter row: pills All plus five types, a search box (title and message). Table (Type chip with icon, Event, Detail, When relative, Open arrow link) with footer "Showing N recent events" and "Live feed — newest first". Empty: "No platform activity in this view."
- **Endpoints:**

| Endpoint                | Route name                | Action                                  | Middleware                                   | Request                                                                             | Response |
| ----------------------- | ------------------------- | --------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- | -------- |
| GET admin/notifications | admin.notifications.index | Admin\AdminNotificationController@index | Authenticate, EnsureUserIsAdmin, IPAllowlist | `type` (all, signup, payment, ticket, contact, workspace; invalid becomes all), `q` | HTML     |

- **Data:** Reads `users`, `orders`, `support_tickets`, `contact_messages`, `workspaces` (excluding soft-deleted). Each query is guarded by a table-exists check so partial installs never error.
- **Rules & edge cases:**
  1. Per type, the 40 newest rows are taken, mapped to events, merged and sorted newest first, then cut to 120 (page) or 15 (bell).
  2. Event shapes: signup "New signup" (name and email, info, link `/admin/users`); orders "Payment received #id" when status is paid (success, uses paid time) else "New order #id" (info), detail is the currency symbol plus the amount to two decimals (total amount, else amount), link `/admin/order-history`; ticket "New support ticket" (subject or id, warning, link `/admin/support`); contact "New contact message" (name and topic, info, link `/admin/contact-messages`); workspace "New workspace" (name, info, link `/admin/workspaces`).
  3. Event ids are strings such as `user-5`, `order-7`, `ticket-3`, `contact-2`, `ws-1`.
  4. Search is a case-insensitive contains over title plus message, applied after the merge and cut, so it only searches the newest 120.
  5. KPI counts are per type over 30 days (rows created since), plus a total; workspaces exclude deleted.
  6. Opening the page advances the caller's last-seen marker (see TW-NOTIF-039).
  7. Nothing here writes rows or sends mail; there is no per-event read state.
  8. All admins see the same events; only unread markers are personal.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 5 new signups and 2 paid orders, then 7 events show newest first with "Payment received" rows marked success.
  - Given `type=ticket`, then only ticket events show.
  - Given `type=bogus`, then it behaves as all.
  - Given the `support_tickets` table is absent, then the page renders without errors and tickets count 0.
  - Given a search "acme", then only events whose title or message contains it show.
- **Source refs:** app/Http/Controllers/Admin/AdminNotificationController.php, resources/views/admin/notifications/index.blade.php, Documentation/pages/account/notifications.html (user-side only; the admin feed is undocumented)
- **Port notes:** Build as a read model over domain events (outbox) instead of table scans if possible; otherwise a query service in `apps/api/src/modules/admin/notifications`. Add pagination (Reference shows at most 120). Cross-tenant reads need the platform role.

### TW-NOTIF-039 — Admin notification bell, mark read and clear

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-NOTIF-038
- **Summary:** The admin header bell shows an unread badge for platform events newer than the admin's personal last-seen time, with mark-all-read and clear actions that both simply move that marker.
- **Actors & access:** Platform admin.
- **UX & screens:** Bell in the admin layout (`components/layouts/admin.blade.php`, `components/admin/header-right.blade.php`) with the same panel as the user bell (title "Notifications", list, "Mark all read", "Clear all", "View all" to `/admin/notifications`). Refreshes on open and every 60 seconds while the tab is visible. Row click just navigates; no per-row read call.
- **Endpoints:**

| Endpoint                          | Route name                   | Action                                        | Middleware                                   | Request | Response                                                                               |
| --------------------------------- | ---------------------------- | --------------------------------------------- | -------------------------------------------- | ------- | -------------------------------------------------------------------------------------- |
| GET admin/notifications/recent    | admin.notifications.recent   | Admin\AdminNotificationController@recent      | Authenticate, EnsureUserIsAdmin, IPAllowlist | none    | `{items[<=15], unread}`; item `{id,title,message,severity,unread,action_url,time_ago}` |
| POST admin/notifications/read-all | admin.notifications.read-all | Admin\AdminNotificationController@markAllRead | same                                         | none    | `{ok:true, unread:0}`                                                                  |
| DELETE admin/notifications        | admin.notifications.clear    | Admin\AdminNotificationController@clearAll    | same                                         | none    | `{ok:true, unread:0}`                                                                  |

- **Data:** `system_settings` key `admin.notif_seen.{admin user id}` (string, ISO 8601 time, description "Last time this admin opened the notifications feed.").
- **Rules & edge cases:**
  1. An event is unread when its time is greater than the last-seen time; the default last-seen (no setting or unparsable) is 14 days ago, so a new admin sees up to two weeks of events as unread.
  2. The badge counts unread among only the 15 newest events.
  3. "Clear all" does not delete anything (the feed is live); it is identical to mark all read.
  4. Unread is per admin.
  5. Setting writes bust the settings cache automatically.
- **Async & events:** 60-second client poll.
- **External systems:** none.
- **Settings:** the per-admin marker.
- **Acceptance criteria:**
  - Given an admin who never opened the feed, then events from the last 14 days count as unread.
  - Given "Mark all read", then the next recent call returns unread 0 until a newer event appears.
  - Given two admins, then one marking read does not change the other's badge.
- **Source refs:** app/Http/Controllers/Admin/AdminNotificationController.php, resources/views/components/layouts/admin.blade.php, resources/views/components/admin/header-right.blade.php, app/Models/SystemSetting.php
- **Port notes:** Use a `platform_admin_notification_seen` table (user id, seen_at) instead of a settings key per admin. Keep the 14-day default.

### TW-NOTIF-040 — Outbound mail readiness rules

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** none
- **Summary:** Before sending, several flows check whether the platform can actually deliver mail and either skip, report a short reason, or fall back to showing credentials on screen. The rules differ per flow; this entry is the single reference.
- **Actors & access:** System. The transport itself is configured by the platform admin at Admin, Settings, Mail (SET).
- **UX & screens:** Flash messages and JSON flags in the flows that call it.
- **Endpoints:** none.
- **Data:** `system_settings`: mail_mailer, mail_host, mail_port, mail_username, mail_password (encrypted blob), mail_encryption, mail_from_name, mail_from_address; also `from_email` and `app_name`. The transport config is re-applied from these settings on every request before any mail is sent (falls back to the environment when a setting is blank, and never overwrites a working environment value with a blank).
- **Rules & edge cases:**
  1. Verify email and admin welcome/workspace invite: mailer must be set; from address must be non-empty and not the literal placeholder `hello@example.com`; if the mailer is SMTP, host and port must be set. `log` and `array` drivers are allowed through (useful for staging). Failure returns a short reason ("no mailer configured.", "sender address not set.", "SMTP host/port not set.") that the caller flashes. Transport exceptions are mapped by message text to "SMTP authentication failed", "SMTP connection refused", "SMTP server timed out" (and for welcome "SMTP server unreachable"), else "mail transport error (see logs).".
  2. Member invite and member password reset (workspace members): delivery is attempted only if the mailer is not one of log, array, null, empty, and not SMTP with an empty host. Otherwise the response says the email was not sent and returns the temporary password so the inviter can hand it over. The JSON carries `email_sent`.
  3. Notification email channel: skipped if the default mailer is null, empty, array or log (TW-NOTIF-002).
  4. Support reply and new-login alert: no readiness check; wrapped in try/catch, failures logged.
  5. Two different sender settings coexist: `mail_from_address` and `mail_from_name` (transport config, login alert), and `from_email` plus `app_name` (support reply, with `no-reply@threadwise.local` as the last fallback). QUIRK: the support reply ignores the admin's configured mail-from.
  6. Admin SMTP test (SET) audits `settings.mail_test` with the target and result.
- **Async & events:** All mail is sent synchronously (Mailables implement the queue traits but are sent directly, not queued).
- **External systems:** SMTP or any Laravel mail transport; credentials in system settings (password encrypted) or environment.
- **Settings:** see Data.
- **Acceptance criteria:**
  - Given mailer `smtp` with no host, when an admin creates a user, then the user is created and the flash says "SMTP host/port not set.".
  - Given mailer `log`, when a workspace member is invited, then the response has `email_sent` false and includes the temp password.
  - Given from address `hello@example.com`, when a verification email is requested, then the reason "sender address not set." is returned.
  - Given SMTP auth failure, then the reason "SMTP authentication failed" is shown, and the row/user is not rolled back.
- **Source refs:** app/Support/MailConfig.php, app/Http/Controllers/EmailVerificationController.php, app/Http/Controllers/Admin/UsersController.php, app/Http/Controllers/Admin/WorkspacesController.php, app/Http/Controllers/WorkspaceMembersController.php, app/Helpers/NotificationHelper.php, app/Mail/Support/AdminReplyToCustomer.php, config/mail.php
- **Port notes:** Central `MailService` (behind a `MailPort`, e.g. SMTP/SES/Resend adapters) with one `isDeliverable()` and one from-address source; run sends through a BullMQ `mail` queue with retries, and keep the "return credentials when undeliverable" UX in the invite flow.

### TW-NOTIF-041 — Verify-email mail

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-NOTIF-040
- **Summary:** The account email verification message with a one-hour signed link.
- **Actors & access:** System; triggered by registration, the "Resend verification email" action and admin resend (both call the same static sender). Verification and resend endpoints belong to AUTH.
- **UX & screens:** Template `resources/views/emails/verify-email.blade.php` (self-contained HTML, no markdown layout, brand header, footer with current year). Subject "Verify your email — {app name}". Body: greeting with user name, sentence about confirming the address to finish signing in, a "Verify email" button, the raw link repeated below for copy and paste, and "This link expires in 60 minutes. If you didn't request this, you can safely ignore this email."
- **Endpoints:** none owned (AUTH: `verification.verify`, resend).
- **Data:** none written here; the link is a temporary signed URL to the verify route with the user id and the SHA-1 of the current email, valid 60 minutes.
- **Rules & edge cases:** 1. Verification checks the signature, that the user exists, and that the hash equals the SHA-1 of the current email (changing email invalidates old links). 2. Brand name comes from the admin-configured brand setting; app name in the subject from config app name. 3. Send returns null or a short failure reason (TW-NOTIF-040). 4. Copy: transactional, plain English; brand and year variables only.
- **Async & events:** synchronous send.
- **External systems:** SMTP.
- **Settings:** brand name, mail settings.
- **Acceptance criteria:**
  - Given a signed-in unverified user requests resend, then one email arrives with a working link that expires after 60 minutes.
  - Given the user changes email, then an old link is rejected.
  - Given mail is misconfigured, then the UI shows "Could not send verification email — {reason}".
- **Source refs:** app/Mail/VerifyEmailMail.php, resources/views/emails/verify-email.blade.php, app/Http/Controllers/EmailVerificationController.php
- **Port notes:** MJML or React Email templates in `packages/` or `apps/api/src/modules/mail/templates`; write new copy (do not copy the Reference text verbatim). Token: signed JWT or hash of (user id, email, expiry).

### TW-NOTIF-042 — Admin welcome mail

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-NOTIF-040
- **Summary:** When a platform admin creates or imports a user, resets their credentials, or creates a workspace with an invited owner, the person receives a welcome email containing their sign-in details and a link to choose their own password.
- **Actors & access:** System on behalf of a platform admin (Admin, Users and Admin, Workspaces screens).
- **UX & screens:** Template `resources/views/emails/admin-welcome.blade.php`. Subject "Welcome to {app name}". Content: greeting, "An administrator created an account for you", a credentials box with email and (if present) the temporary password plus the note that a new password is required at first login, a "Sign in" button to the login URL, an optional "Prefer to set your own password? Choose a password here." link (reset URL), an ignore-if-unexpected line, and a copyright footer.
- **Endpoints:** none owned (triggered from Admin UsersController create, bulk import and password change, and Admin WorkspacesController create).
- **Data:** After a successful send sets `users.welcome_email_sent_at` to now. A password reset token is created through the password broker and turned into a relative reset URL; token creation failure just omits the link.
- **Rules & edge cases:** 1. Preflight and error mapping per TW-NOTIF-040; the admin sees the reason and the user is never rolled back. 2. Bulk import sends best-effort per row. 3. The plaintext temporary password is emailed, which is a security trade-off worth reviewing in the port (prefer reset-link only). 4. Mail is not queued. 5. Workspace invite variant logs "Workspace invite email failed" on errors.
- **Async & events:** synchronous send; audit rows come from the surrounding admin actions.
- **External systems:** SMTP.
- **Settings:** brand name, mail settings.
- **Acceptance criteria:**
  - Given an admin creates a user with a generated password, then the email contains the email and temporary password and a reset link, and `welcome_email_sent_at` is set.
  - Given SMTP is down, then the user exists and the admin sees the reason.
  - Given no password is included (existing user), then the credentials box omits the password line.
- **Source refs:** app/Mail/AdminWelcomeMail.php, resources/views/emails/admin-welcome.blade.php, app/Http/Controllers/Admin/UsersController.php, app/Http/Controllers/Admin/WorkspacesController.php
- **Port notes:** Prefer a one-time set-password link over emailing a password. Keep `welcome_email_sent_at` on the user record (AUTH owns the column).

### TW-NOTIF-043 — Team-invite mail

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-NOTIF-040
- **Summary:** Members added to a workspace receive an email naming the workspace, the inviter and the role; brand-new users also receive a one-time password.
- **Actors & access:** System on behalf of a workspace owner or admin via the members screen (WSP). Used for both invite and "reset member password".
- **UX & screens:** Template `resources/views/mail/team-invite.blade.php`. Subject "You've been invited to {workspace} on {app name}" (app name from the platform setting, else config). Content: greeting, "{inviter} has invited you to join {workspace} on {brand} as a {Role}", then either a credentials box (email, temporary password, advice to change it in account settings) for new users or a note that the existing account was added and the workspace will appear in the switcher, a sign-in button to the login URL, and a not-charged reassurance line.
- **Endpoints:** none owned.
- **Data:** none written; the temporary password is a 12-character random string generated by the member flow.
- **Rules & edge cases:** 1. Delivery gated by the deliverability rule 2 in TW-NOTIF-040; on failure the response carries `email_sent` false and the temp password. 2. Failure is logged with invitee and workspace ids, never rolls back the membership. 3. Audit `member.invited` records `email_sent`. 4. Recipient address is the invitee's email set in the envelope.
- **Async & events:** synchronous.
- **External systems:** SMTP.
- **Settings:** brand name, app name, mail settings.
- **Acceptance criteria:**
  - Given a new email is invited as agent with a working SMTP, then one mail with credentials is delivered and the API returns `email_sent` true.
  - Given an existing user is invited, then the mail says the account was added and includes no password.
  - Given mailer `log`, then no mail is sent and the temp password is returned to the inviter.
- **Source refs:** app/Mail/TeamInviteMail.php, resources/views/mail/team-invite.blade.php, app/Http/Controllers/WorkspaceMembersController.php
- **Port notes:** Invitation tokens (accept link) are better than temp passwords; keep the fallback to show a copyable link when mail is undeliverable.

### TW-NOTIF-044 — Support ticket reply mail

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-NOTIF-040
- **Summary:** When platform support replies to a customer's ticket, the customer is emailed the reply text with a link to the ticket.
- **Actors & access:** System when an admin posts a non-internal reply on a ticket that has an email address (Admin, Support inbox; SUPP domain owns the reply endpoint).
- **UX & screens:** Template `resources/views/emails/support/admin-reply.blade.php`. Subject "Re: {ticket subject}" (fallback "Your support ticket"). From address is the `from_email` setting (fallback mail from address, then no-reply@threadwise.local) with sender name "{app name} Support". Layout: branded header, "Re: ticket #{number} · {status}" (status shown with underscores as spaces, colour by status: open, in_progress, pending, resolved, closed), greeting "Hi {name or 'there'}", the quoted reply body with preserved line breaks, a "View ticket & reply" button to `{app url}/support/{ticket id}`, a line about replying to the email or using the web (docs say replies by email add to the ticket), an auto-close note, and a footer with ticket number and opened date.
- **Endpoints:** none owned.
- **Data:** none written by the mail; the reply and ticket rows belong to SUPP.
- **Rules & edge cases:** 1. Skipped for internal notes and when the ticket has no email. 2. Failure is caught and logged with ticket id and recipient; the reply is already saved. 3. Audit `support.reply` records `emailed`. 4. QUIRK: the mail promises "Reply to this email to add to your ticket" but no inbound-email handler for support tickets exists in this domain (an inbound controller exists for a separate email product). Treat as docs-only unless SUPP confirms. 5. Ticket URL base is the `app_url` setting else the site root.
- **Async & events:** synchronous.
- **External systems:** SMTP.
- **Settings:** `from_email`, `app_name`, `app_url`.
- **Acceptance criteria:**
  - Given an admin replies (not internal), then the customer email arrives with the reply body and a link to `/support/{id}`.
  - Given an internal note, then no mail is sent.
  - Given mail failure, then the reply is still saved and visible.
- **Source refs:** app/Mail/Support/AdminReplyToCustomer.php, resources/views/emails/support/admin-reply.blade.php, app/Http/Controllers/Admin/Support/InboxController.php
- **Port notes:** Mail in the SUPP module using this template; use Reply-To or plus-addressing if inbound email replies are wanted.

### TW-NOTIF-045 — New-login security alert mail

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-NOTIF-026, TW-NOTIF-027
- **Summary:** After a successful login, the system compares this sign-in to the user's previous one and emails them if the device (browser and OS family) or network region changed, with a link to reset the password if it was not them.
- **Actors & access:** System. Behaviour toggled by platform admins on the Security page (AUTH): `security.alert_on_new_device` (default on), `security.alert_on_new_country` (default on), `security.alert_channel` (email, whatsapp or both; default email).
- **UX & screens:** Plain-text email, subject "New sign-in to your {app name} account" (device only) or "New sign-in from a different location". Body: greeting, "Your account was just used to sign in", when (UTC), IP, browser, reasons, and instructions to reset via the forgot-password page (or Settings, Security when signed in), signed "— {app name} security". Sender is the admin-configured mail-from address and name.
- **Endpoints:** none.
- **Data:** Reads the user's previous `auth.login` audit row (second most recent by time). Writes an audit row `auth.alert_emitted` (result warning) with reasons, channel, previous and current IP, and user agent (each cut to 120).
- **Rules & edge cases:**
  1. No alert on a user's first-ever login.
  2. Device fingerprint = browser family (edge, chrome, firefox, safari, opera, other) plus OS family (android, iphone, ipad, win10, win11, mac, linux, other); a change of either is "new-device".
  3. "New country" is a heuristic: IPv4 first two octets differ, or IPv6 first four hextets differ (no GeoIP database). Reason `new-country` when the previous and current network prefixes differ.
  4. Alert emitted only if at least one enabled reason applies.
  5. De-dup: one alert per user plus device fingerprint (IP and user agent hash) per 10 minutes, guarded by an atomic cache add, to stop double emails from repeated login events.
  6. Channel "whatsapp" is a stub: nothing is sent (documented in code as policy-stubbed); "both" sends only the email.
  7. Errors are caught and logged; login is never blocked.
  8. The audit row is written before the mail, and the mail send is wrapped separately.
  9. Because it runs inside the login event, it depends on the `auth.login` audit row for the current login already existing.
- **Async & events:** runs synchronously inside the login event listener.
- **External systems:** SMTP.
- **Settings:** the three security settings above plus mail settings.
- **Acceptance criteria:**
  - Given the user previously logged in from Chrome on Windows and now logs in from Safari on iPhone, then one alert email is sent and an `auth.alert_emitted` row with reason `new-device` exists.
  - Given the same device and a similar network prefix, then no email.
  - Given two login events within 10 minutes from the same fingerprint, then one email.
  - Given `alert_on_new_device` is off and only the device changed, then no alert.
  - Given it is the user's first login, then nothing is sent.
- **Source refs:** app/Listeners/NewLoginAlertListener.php, app/Providers/AppServiceProvider.php, app/Http/Controllers/Admin/SecurityController.php
- **Port notes:** In the auth module; use a real GeoIP lookup (MaxMind) for country and keep the device-family heuristic; use the shared mail service with an HTML template; implement WhatsApp channel through the WhatsApp adapter only if required.

## Data model

### `notifications` (workspace in-app feed)

Purpose: per-workspace and personal notifications shown in the bell and page. Read and written by TW-NOTIF-001, 003, 004, 006, 007, 008; read by MOB app list endpoints and the dashboard unread card.

- `id` bigint PK. `user_id` bigint null (recipient; no FK). `workspace_id` bigint null FK workspaces ON DELETE SET NULL. `category` varchar 32 default `system` (values written: system, device, template, campaign, broadcast, chat, webhook, billing, contact; `mention` and others are never written). `severity` varchar 16 default `info` (values: info, success, warning, danger). `icon` varchar 64 null. `notification_title` text (encrypted by cast, ciphertext stored). `notification_msg` text (encrypted). `source_type` varchar 96 null (model class), `source_id` bigint null, `verb` varchar 32 null (created, updated, deleted, or demo marker). `action_url` varchar 255 null. `is_urgent` tinyint default 0. `status` tinyint default 1 (1 = unread, 0 = read; note the inverted naming). `read_at` timestamp null. `created_at`, `updated_at`.
- Indexes: (user_id, status), (category, created_at), user_id, category, workspace_id.
- Visibility scope: `workspace_id` equals current workspace, or (`user_id` equals me AND `workspace_id` IS NULL).
- Volume: unbounded; no prune (installs with 77k to 194k rows reported). Excluded from updater backups.

### `inbox_notifications` (team-inbox feed)

Purpose: per-user, per-workspace agent alerts. Written by TW-NOTIF-012 to 016; read by TW-NOTIF-017 and the team-inbox bootstrap.

- `id` PK, `user_id` bigint NOT NULL, `workspace_id` bigint NOT NULL (no FKs), `type` varchar 32 (assigned, mentioned, sla_breach, snooze_wake, resolved, deal_assigned, deal_won, deal_lost, deal_task_due, task_due, task_assigned, sales_doc_decided, new_lead, ai_handoff), `title` varchar 200, `body` text null (max 200 written), `data` JSON null, `link` varchar 500 null, `read_at` timestamp null, timestamps.
- Indexes: (user_id, read_at), user_id, workspace_id, type, read_at.
- No prune; no delete path.

### `audit_logs`

Purpose: single audit trail for workspace and platform actions (TW-NOTIF-026 to 036).

- `id` PK, `layer` varchar 12 (workspace or platform; seeded demo uses `app`), `workspace_id` null, `actor_user_id` null, `action` varchar 64, `subject_type` varchar 64 null, `subject_id` bigint null, `payload` JSON null (contains `_label`, `changes`, meta keys), `result` enum success|failure|warning default success, `ip` varchar 64 null, `user_agent` varchar 500 null, `created_at` timestamp default now. No `updated_at`, no FKs.
- Indexes: layer, workspace_id, actor_user_id, action, result, created_at, (subject_type, subject_id).
- Volume: high (every login, model change, admin action); pruned by retention.

### `security_audit_log`

Purpose: account-security events from the Settings, Security tab (TW-NOTIF-037). Columns `user_id`, `workspace_id`, `event` varchar 64, `status` varchar 16, `ip`, `user_agent` varchar 255, `payload` JSON, `created_at`. Indexes on user, workspace, created_at. Write-only.

### `push_subscriptions`

Purpose: browser Web Push subscriptions (TW-NOTIF-018 to 020). Columns `user_id`, `workspace_id` null, `endpoint` text, `endpoint_hash` char 64 UNIQUE (sha256), `p256dh` varchar 255, `auth` varchar 255, `ua` varchar 255 null, `channel` varchar 40 default `team-inbox`, `last_notified_at`, timestamps. Rows are deleted when the push service reports the subscription expired.

### `user_device_tokens`

Purpose: mobile FCM tokens (TW-NOTIF-024, 025). Columns `user_id`, `workspace_id` null, `device_id` null (pinned WhatsApp number), `fcm_token` text, `token_hash` char 64 UNIQUE, `platform` varchar 16 (android or ios), `device_info` JSON, `last_used_at`, timestamps. Index (workspace_id, device_id).

### Settings rows and JSON owned or read here

- `workspaces.notification_prefs` (JSON, owned by WSP): shape in TW-NOTIF-005.
- `system_settings` keys: `ti_pwa_enabled`, `ti_pwa_name`, `ti_pwa_short_name`, `ti_pwa_icon_192`, `ti_pwa_icon_512`, `ti_vapid_public`, `ti_vapid_private` (encrypted), `ti_vapid_subject`, `fcm_project_id`, `fcm_service_account_json` (encrypted), `security.audit_log_retention_days` (default 365), `security.alert_on_new_device`, `security.alert_on_new_country`, `security.alert_channel`, `admin.notif_seen.{userId}`; mail keys listed in TW-NOTIF-040.

## Cross-domain contracts

Consumes:

- AUTH: auth events (login, logout, failed, reset, lockout, session timeout); security settings for login alerts and retention; verification and resend endpoints that call the verify-email mail.
- WSP: `workspaces.notification_prefs`, workspace owner, members and roles, invitation acceptance; member invite and reset flows that call the invite mail.
- RBAC: permission keys `audit.view`, `audit.export`, `platform.audit.view` (seeded; only the last is enforced), workspace role hierarchy for the Activity Log gate.
- TIB1 and TIB2: assignment, note mention, resolve and snooze-wake triggers; the queue-poll sweeps that fire reminders; `conversations.unread_count`.
- WADEV, WABA: device connected/disconnected status changes; inbound message webhooks that trigger FCM and Web Push.
- DEAL, CTP, SALES, AIAG: deal, task, proposal and AI hand-off triggers into the dispatcher.
- WALLET: low-balance alert call after a spend.
- SET: mail transport settings and test, PWA settings page and manifest, brand name.
- SUPP: support reply endpoint that sends the reply mail.
- INTG or lead capture: incoming-webhook lead notification.

Exposes:

- To every domain: `NotificationHelper`-equivalent emit API (event key, category, severity, urgency, link, source), `NotificationDispatcher` methods for team-inbox feed, `Audit.log` facade with redaction and layer rules, `WebPushService.sendToUser`, `FcmService.sendToTokens`, mail readiness rules.
- To MOB: the `notifications` list, mark-read and mark-all-read routes (`api/app/notifications*`) read this table with the same visibility scope; device-token register and unregister routes write `user_device_tokens`; config reports `fcm_enabled`.
- To DASH and ASHELL: `audit_logs` read for the dashboard "Activity log" widget (excludes `auth.*`, `session.*`, `user.*`), the More page recent five, admin device detail event list; unread `notifications` count card.
- To INST: `notifications` table rows are excluded from backups (updater).
- Tables also touched by others: `system_settings` (SET), `workspaces` (WSP), `conversation_participants` (TIB1, updated on mention).

## Open questions & quirks

1. Two notification stores. `notifications` (encrypted, preference-gated, workspace-shared) and `inbox_notifications` (plain, per-user, dedupe, push mirror) serve overlapping purposes with different schemas. The bell only shows the first; the second has no shipped UI. Decide whether the port merges them.
2. Read state and "clear all" on `notifications` are shared across all members of a workspace because rows are workspace-scoped and read/delete act on the whole visible set.
3. Personal alerts (password changed, profile updated, welcome) are stamped with the current workspace, so all members of that workspace see them, contradicting the docs.
4. Mentions tab in the notifications page is always empty (no writer of category `mention`); the mention feed is the team-inbox one.
5. 15 of 18 catalogued notification events have no emitter (TW-NOTIF-011). `weekly_summary` needs a scheduler that does not exist. The docs list the same catalogue.
6. Docs describe quiet hours and a quiet-hours KPI; code has a client-only DND toggle and a delivery-channels KPI.
7. `NotificationHelper::success/warning/error` declare a non-null return type but the core can return null when the in-app pref is off. `toAdmins` is unused.
8. Search on the notifications page loads every visible row and decrypts in PHP. Port must not do this.
9. No retention for `notifications`, `inbox_notifications`, `security_audit_log`. Only `audit_logs` prunes, and only via the command (no schedule defined; the page sweep needs an admin visit).
10. Audit Log retention card says "indefinitely" while the prune uses 365 days by default.
11. Audit permission keys `audit.view` and `audit.export` are seeded and referenced in the permission-create UI hint but never enforced; the Audit Log page only requires the admin gate. Only `platform.audit.view` is enforced (admin team-inbox audit JSON).
12. Platform-model observer events are stored with layer workspace and the actor's workspace id, so the Platform tab and KPI under-count admin work; `user.updated` fires on every login due to the remember token.
13. Activity Log workspace scope drops the workspace filter when the caller has no current workspace (all tenants' rows visible to a platform admin). Activity Log LIKE search is not wildcard-escaped. Activity export lacks the result and payload columns and CSV formula protection, contrary to the docs.
14. Admin Audit export ignores the `q` and `layer` filters the UI passes.
15. AI hand-off notification writes non-existent columns so body and link are lost (TW-NOTIF-016).
16. `notifySlaBreach` and the legacy `/notifications-page` route are dead code.
17. Team-inbox feed endpoints (`me/notifications`) have no UI consumer; the unread count in the bootstrap payload is also unused by the shipped script.
18. Support reply mail promises "reply to this email" but no support inbound-email handler was found in this domain; mark for SUPP to confirm. Two different from-address settings exist (`mail_from_address` and `from_email`).
19. Admin welcome and team-invite mails carry plaintext temporary passwords by design.
20. FCM sender deletes tokens on INVALID_ARGUMENT, which can prune valid tokens on a payload error.
21. The service worker file `public/team-inbox-sw.js`, the admin PWA settings page (`admin/settings/pwa` GET and PATCH) and `manifest.json` are not in the manifests of PHP classes; the settings page and app manifest are left to SET, this domain claims only the team-inbox manifest, keys and generate-keys route.
22. Routes deliberately left to other domains: `api/app/notifications` and `api/app/notifications/mark-all-read`, `api/app/notifications/mark-as-read/{id}`, `api/app/device-tokens/*` (MOB), `admin/settings/pwa` and `manifest.json` (SET), `admin/security` (AUTH), `catalog/activity` (STORE), `deals/{deal}/activity` (DEAL), `team-inbox/api/team-chat/activity` (TCHAT).
23. Audit and notification demo seeder writes categories and layers the code never writes (`app` layer, `inbox`, `order`, `support`, `ads`, `flow`, `contacts`), so seeded demo data does not represent real rows.
24. Raw (untemplated) mails owned elsewhere: contact-form notification to the support address (ContactController), mobile password-reset OTP (Api/App PasswordController), SMTP test mail (AdminPagesController). They share the readiness caveats of TW-NOTIF-040.
25. Time zone: all stats use the application timezone (`now()`); activity-log and audit day boundaries follow server time, not the workspace time zone.

## Coverage

```json threadwise-coverage
{
  "routes": [
    "POST settings/notifications",
    "GET notifications/recent",
    "GET notifications",
    "POST notifications/{id}/read",
    "POST notifications/read-all",
    "DELETE notifications/{id}",
    "DELETE notifications",
    "GET notifications-page",
    "GET team-inbox/api/me/notifications",
    "POST team-inbox/api/me/notifications/read-all",
    "POST admin/settings/pwa/generate-keys",
    "GET team-inbox-manifest.json",
    "GET team-inbox/api/push/key",
    "POST team-inbox/api/push/subscribe",
    "POST team-inbox/api/push/unsubscribe",
    "GET admin/settings/mobile-push",
    "POST admin/settings/mobile-push",
    "GET activity-log",
    "GET activity-log/{id}",
    "GET activity-log/export",
    "GET admin/audit-log",
    "GET admin/audit-log/{id}",
    "GET admin/audit-log/export",
    "GET admin/team-inbox/api/audit",
    "GET admin/notifications",
    "GET admin/notifications/recent",
    "POST admin/notifications/read-all",
    "DELETE admin/notifications"
  ],
  "controllers": [
    "app/Http/Controllers/NotificationsController.php",
    "app/Http/Controllers/Admin/AdminNotificationController.php",
    "app/Http/Controllers/ActivityLogController.php",
    "app/Http/Controllers/Admin/AuditLogController.php",
    "app/Http/Controllers/TeamInboxPwaController.php"
  ],
  "services": [
    "app/Services/Push/FcmService.php",
    "app/Services/Push/InboxPushNotifier.php",
    "app/Services/Push/TeamInboxPushNotifier.php",
    "app/Services/Push/WebPushService.php",
    "app/Services/Inbox/AuditLogger.php",
    "app/Services/Inbox/NotificationDispatcher.php",
    "app/Support/Audit.php",
    "app/Support/SecurityAuditLogger.php",
    "app/Support/WalletAlerts.php"
  ],
  "models": [
    "AuditLog",
    "InboxNotification",
    "Notification",
    "PushSubscription",
    "UserDeviceToken"
  ],
  "tables": [
    "audit_logs",
    "inbox_notifications",
    "notifications",
    "push_subscriptions",
    "security_audit_log",
    "user_device_tokens"
  ],
  "views": [
    "resources/views/user/notifications/index.blade.php",
    "resources/views/user/notifications/_feed.blade.php",
    "resources/views/user/notifications/_pagination.blade.php",
    "resources/views/user/activity-log/index.blade.php",
    "resources/views/user/activity-log/_rows.blade.php",
    "resources/views/admin/audit-log/index.blade.php",
    "resources/views/admin/notifications/index.blade.php",
    "resources/views/admin/settings/mobile-push.blade.php",
    "resources/views/emails/admin-welcome.blade.php",
    "resources/views/emails/verify-email.blade.php",
    "resources/views/emails/support/admin-reply.blade.php",
    "resources/views/mail/team-invite.blade.php"
  ],
  "commands": ["audit:prune"],
  "permissions": ["audit.view", "audit.export", "platform.audit.view"],
  "middleware": [],
  "node_files": [],
  "js_assets": [
    "resources/js/charts/admin-audit-log-index.js",
    "resources/js/charts/audit-log-index.js",
    "resources/js/charts/user-activity-log-index.js",
    "resources/js/charts/user-notifications-index.js"
  ],
  "misc_files": [
    "app/Helpers/NotificationHelper.php",
    "app/Mail/AdminWelcomeMail.php",
    "app/Mail/Support/AdminReplyToCustomer.php",
    "app/Mail/TeamInviteMail.php",
    "app/Mail/VerifyEmailMail.php",
    "app/Observers/AuditableObserver.php",
    "app/Listeners/NewLoginAlertListener.php"
  ],
  "config_files": ["mail.php"],
  "doc_pages": [
    "Documentation/pages/account/notifications.html",
    "Documentation/pages/account/activity-log.html"
  ],
  "feature_map": {
    "TW-NOTIF-005": ["POST settings/notifications"],
    "TW-NOTIF-006": ["GET notifications/recent"],
    "TW-NOTIF-007": ["GET notifications"],
    "TW-NOTIF-008": [
      "POST notifications/{id}/read",
      "POST notifications/read-all",
      "DELETE notifications/{id}",
      "DELETE notifications"
    ],
    "TW-NOTIF-009": ["GET notifications-page"],
    "TW-NOTIF-017": [
      "GET team-inbox/api/me/notifications",
      "POST team-inbox/api/me/notifications/read-all"
    ],
    "TW-NOTIF-018": ["POST admin/settings/pwa/generate-keys"],
    "TW-NOTIF-019": [
      "GET team-inbox-manifest.json",
      "GET team-inbox/api/push/key",
      "POST team-inbox/api/push/subscribe",
      "POST team-inbox/api/push/unsubscribe"
    ],
    "TW-NOTIF-022": ["GET admin/settings/mobile-push", "POST admin/settings/mobile-push"],
    "TW-NOTIF-029": ["GET activity-log"],
    "TW-NOTIF-030": ["GET activity-log/{id}"],
    "TW-NOTIF-031": ["GET activity-log/export"],
    "TW-NOTIF-032": ["GET admin/audit-log"],
    "TW-NOTIF-033": ["GET admin/audit-log/{id}"],
    "TW-NOTIF-034": ["GET admin/audit-log/export"],
    "TW-NOTIF-036": ["GET admin/team-inbox/api/audit"],
    "TW-NOTIF-038": ["GET admin/notifications"],
    "TW-NOTIF-039": [
      "GET admin/notifications/recent",
      "POST admin/notifications/read-all",
      "DELETE admin/notifications"
    ]
  }
}
```
