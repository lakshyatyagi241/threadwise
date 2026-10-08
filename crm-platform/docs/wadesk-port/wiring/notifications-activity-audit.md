# Wiring map: notifications (NOTIF), the bell and the live push

Inventory: [notifications-activity-audit.md](../inventory/notifications-activity-audit.md) (WD-NOTIF-001 to 025). Spec: [realtime-notifications.md](../../specs/realtime-notifications.md)
(BL-096). API: [docs/api/notifications.md](../../api/notifications.md), [docs/api/realtime.md](../../api/realtime.md). Built: the bell feed, the task / sales-doc / lead /
form / wallet producers, and (BL-096 phase 1, server) the conversation producers and the live push, and (phase 2, server) the device / send outcome / team chat
producers, per-person preferences and retention, and (BL-097, phase 3) browser notifications (Web Push). The web half of BL-096 is not built here (the Account, Notifications screen carries the Push column and the Browser notifications card).

## Route, permission, plan

| Id             | What                         | Where                                                                                                                                                                                                                                                                                                         |
| -------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-NOTIF-001 | Bell API                     | `/v2/notifications` (list, `unread-count`, `read-all`, `read-subject`, `:id/read`) in `notifications.controller.ts`; staff only, pinned to the caller, no permission key                                                                                                                                      |
| WIRE-NOTIF-002 | Live events                  | `notification.created`, `notification.read` (room `user`) in `packages/contracts/src/realtime/events.ts`, published by `NotificationPublisher`                                                                                                                                                                |
| WIRE-NOTIF-003 | Conversation permission/plan | `inbox.conversation.read` (and `.reply` for an unassigned new chat) through `MemberDirectory` / `conversationVisible`; the inbox routes have no plan feature, so none is checked                                                                                                                              |
| WIRE-NOTIF-004 | Workspace toggles            | `organizations.settings.notificationPrefs` (Settings, Notifications) read by `NotificationPrefsResolver`; gates `new_chat`, `new_message` (`new_customer_reply`), `conversation_assigned`, `mention` (`mention_in_inbox`) only                                                                                |
| WIRE-NOTIF-005 | Switch and limits            | `NOTIFY_CONVERSATIONS_ENABLED`, `NOTIFY_MAX_RECIPIENTS`, `NOTIFY_THROTTLE_SECONDS` (`config/domains/notifications.env.ts`); `OUTBOX_DRAIN_CONCURRENCY` (`workers/outbox-drain.service.ts`)                                                                                                                    |
| WIRE-NOTIF-007 | Preferences API              | `GET` / `PUT /v2/notifications/preferences` in `notifications.controller.ts`, `notification-preferences.service.ts`; table `notification_user_prefs` (migration `20261107090000_notif_user_prefs_retention`); contracts `notification-preferences.ts` (`NOTIFICATION_CATALOG`, `resolveNotificationChannels`) |
| WIRE-NOTIF-008 | Inbox nav badge signal       | no new route: `GET /v2/inbox/counts` (`unread`) refetched on `inbox.unread`, `inbox.conversation.upsert`, `inbox.assignment`, `notification.created`, `notification.read`, resync                                                                                                                             |
| WIRE-NOTIF-009 | Retention                    | `notification-retention.service.ts` (worker, daily 03:30), `NOTIFY_RETENTION_*` in `config/domains/notifications.env.ts`; indexes `idx_inbox_notifications_prune_read` / `_unread`                                                                                                                            |
| WIRE-NOTIF-022 | Web Push routes | `/v2/notifications/push` (`public-key`, `subscriptions`, `subscriptions/:id`, `test`) in `push.controller.ts`, `push-subscriptions.service.ts`; staff only, pinned to the caller, no permission key; contracts `web-push.ts` |
| WIRE-NOTIF-023 | Web Push settings | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `WEB_PUSH_TTL_SECONDS` (`config/domains/web-push.env.ts`); all three VAPID values empty = feature off and invisible |
| WIRE-NOTIF-024 | Web Push delivery | `NotificationPublisher.created` -> queue `web-push` (`QUEUES.WEB_PUSH`) -> `web-push.processor.ts` -> `WebPushDeliveryService` -> `WebPushSender` -> port `infra/providers/web-push` (adapter over `web-push`); presence `realtime/visibility-presence.service.ts` fed by the socket event `presence:visible` |
| WIRE-NOTIF-025 | Web Push on the web | service worker `apps/web/public/sw.js` (+ `notification-icon.png`, `notification-badge.png`, header in `next.config.ts`); `features/notifications-activity-audit/push/*` (support, client, `use-browser-push`, worker messages); card `components/browser-notifications-card.tsx`; Push column in `preferences-screen.tsx`; tab visibility reporter `lib/realtime/visibility-report.ts` |
| WIRE-NOTIF-006 | Web                          | bell: `features/notifications-activity-audit` (poll every minute today); the global listener, toast, sound, tab title are the web agent's (spec section 8)                                                                                                                                                    |

## Tables

`push_subscriptions` (reshaped by `20261108090000_web_push_subscriptions`; `notification_user_prefs.push` added by the same migration), `inbox_notifications` (migrations `20261106090000_notif_live_columns`, `20261106090100_notif_collapse_latest_index` add `collapse_key`, `event_count`, `subject_kind`,
`subject_uuid` and three indexes; `20261107090000_notif_user_prefs_retention` adds the two retention indexes), `notification_user_prefs` (new, forced RLS). Phase 2 also
reads `devices`, `broadcasts`, `wpcampaigns`, `scheduled_messages`, `team_chat_messages`, `team_chat_channels`, `team_chat_channel_members`, `user_roles` / `roles` (admins). Read: `conversations` (assignee, team, `muted_at`, title, peer), `channels` (kind), `conversation_notes` (the mention excerpt),
`users`, `teams`, `team_members`, `organizations.settings`. Redis: `rt:vis:<org>:<user>` (tab visibility, sorted set, 35 s), `push:test:<org>:<user>` (10 s test limit), BullMQ queue `web-push`, `rt:nc:<org>:<user>:<conversation>` (5 s ping throttle), `rt:nc:seen:<org>:<user>:<conversation>` (60 s, "just read").

## Producers (who writes a bell row) and what announces it

| Id             | Producer                                                  | Event                                                                  | Announces `notification.created`                                      |
| -------------- | --------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| WIRE-NOTIF-010 | `notifications/task-notification.consumer.ts`             | `task.assigned`, `task.due`, `task.completed`                          | yes (after commit)                                                    |
| WIRE-NOTIF-011 | `notifications/salesdoc-notification.consumer.ts`         | `salesdoc.accepted`, `salesdoc.declined`                               | yes                                                                   |
| WIRE-NOTIF-012 | `leads/lead-notification.consumer.ts`                     | `lead.created`, `lead.updated`                                         | yes                                                                   |
| WIRE-NOTIF-013 | `forms-builder/form-notification.consumer.ts`             | `form.submitted`, `form.needs_review`                                  | yes                                                                   |
| WIRE-NOTIF-014 | `wallet-message-billing/wallet-notifications.consumer.ts` | `wallet.low_balance`, `wallet.topped_up` (manual credit)               | yes                                                                   |
| WIRE-NOTIF-015 | `notifications/conversation-notification.consumer.ts`     | `message.received`, `conversation.assigned`, `conversation.note_added` | yes (`new_message` throttled to one ping per 5 s per person and chat) |

| WIRE-NOTIF-016 | `notifications/device-notification.consumer.ts` | `device.connected`, `device.disconnected`, `device.logged_out`, `device.status_changed` (`worker_silent` only) | yes |
| WIRE-NOTIF-017 | `notifications/send-outcome-notification.consumer.ts` | `broadcast.status_changed`, `campaign.status_updated`, `scheduled.status_changed` (new, `scheduled-queue-warmer/scheduled-events.ts`) | yes |
| WIRE-NOTIF-018 | `notifications/team-chat-notification.consumer.ts` | `teamchat.mention.created`, `teamchat.message.posted` (direct messages only) | yes (throttled per person and channel) |

`message.received` is written by `chat-conversations/inbound-ingest.service.ts` (through `ConversationLifecycleService.messageReceived`) in the ingest transaction.
`conversation.assigned` by `team-inbox-routing-sla/assignment.service.ts`; `conversation.note_added` by `team-inbox-conversations/inbox-notes.service.ts` (unchanged).

## Consumers of the read state

| Id             | Reader                                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-NOTIF-020 | `POST /v2/inbox/conversations/:id/read` (`InboxConversationsService.markRead`) marks the conversation's bell rows read, records "just read", emits `notification.read` |
| WIRE-NOTIF-021 | `read-all`, `:id/read`, `read-subject` emit `notification.read` to the person's other tabs                                                                             |

## Blocked / later (never silently dropped)

| Id            | What                                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| NOTIF-BLK-001 | Web: global listener, toast, sound, desktop alert, tab title, `read-subject` on open (BL-096 web half)                                                             |
| NOTIF-BLK-002 | Web half of phase 2: preferences screen, inbox nav badge, favicon badge, `/notifications` page (server built; web agent). Quiet hours and email digest: phase 3    |
| NOTIF-BLK-003 | Resolved / deal / order / SLA / AI hand-off rows: phase 3 (SLA and AI hand-off need their engines)                                                                 |
| NOTIF-BLK-004 | `NotificationPrefsResolver` duplicates none of the settings service: it uses the contracts' `effectiveEventFlags`; `workspace-settings.service.ts` was not changed |
| NOTIF-BLK-004 | Web Push (BL-097) is built; not built: waiting-for-reply nudge for unassigned chats (BL-098, owner decision), per-language wording inside the notification (the worker sends English like the bell's server fallback), mobile push (FCM), quiet hours, pruning of `push_subscriptions` of a removed device before its browser says 410 |
