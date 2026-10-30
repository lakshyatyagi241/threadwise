# Notifications

Two screens: the person's notification list (`/notifications`, opened from the bell and the Menu) and their notification preferences
(`/notification-preferences`, Menu → Preferences → Notification preferences).

## Notification preferences

The web's Account → Notifications screen (`notifications-activity-audit`, `prefs/model.ts`). For each kind of notification the person
chooses, for themselves only, whether it reaches the **bell** (the row exists and the badge counts it), **pops up**, plays a **sound**, and
(where the deployment sends browser notifications) reaches their devices as a **push**.

- **Data**: `GET /v2/notifications/preferences` (every kind, with what is in force, the default and what the person chose) and a partial,
  idempotent `PUT` of the same route (`null` = follow the default again). The Push column is drawn only when
  `GET /v2/notifications/push/public-key` says the deployment has push (a failure leaves it out, as on the web).
- **Rules** (ported in `preferences-model.ts`): the pop-up, sound and push ride on the bell row, so they are off while the bell is off; a kind
  with no pop-up or no sound at all shows "Not available"; a switch put back to its default is stored as `null`, so a later change of the
  default still reaches the person; when the workspace has an event off, the person's switches stay usable and the row says so.
- **Saving** (`preference-saver.ts`, ported from the web's `PreferenceSaver`): a change shows at once, is sent one after another, is undone
  with a message when saving fails, and the screen reads again after the last save settles.
- **Reset**: one kind ("Reset to default") or everything the person changed.
- Rows are grouped (Chats, Tasks, Leads and forms, Sales documents, Wallet, WhatsApp numbers, Broadcasts and campaigns, Team chat, WhatsApp
  groups, Billing, System) in the web's order; a kind this build has no words for shows its name made readable.

### In the web, not built here (recorded, not dropped)

| What                                                  | Why it waits                                                                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| The "Browser notifications" card (enable a device)    | it is Web Push for a browser; the app has no counterpart until the backend can send push to the phone (needs an owner step) |
| The "This browser" switches (desktop alert and sound) | they are per-browser settings kept in the browser; a phone has none                                                         |
| Sounds inside the app                                 | the app does not play a ping yet, so the Sound switch only governs the web for now                                          |

## Live alert (a chat message arrives while the app is open)

`LiveAlertHost` (mounted in `src/app/(app)/_layout.tsx`, inside the realtime provider) drops a card down over any screen when the server
sends `notification.created` for a chat message (`new_chat`, `new_message`, `conversation_assigned`, `chat_waiting`,
`snooze_wake`). Ported from the web's live toast (`notifications-activity-audit/live`).

- It never shows for a `silent` event, one the person's Pop-up preference turned off (`toast: false`), or the chat that is open.
- It reads the newest unread rows to get the words (the event carries ids only), shows one card for 5 s, and a newer one replaces it.
- Tapping it marks the row read and opens the chat; the cross sends it away. The bell's count is read again on every event.
- Not built: the web's per-chat pacing and "N new notifications" summary, the ping, and the OS alert for a hidden app (needs push to the phone).

## Hidden kinds

The app shows only chats (new chat, new message, chat waiting, assigned, snoozed chat comes back, SLA breached) and tasks. The rest are left
out by `lib/notifications/hidden.ts`: 16 single kinds (mention, email not delivered, leave, calendar, leads and forms, sales document,
wallet, test) and the whole Billing and subscriptions, WhatsApp numbers, Broadcasts and campaigns, Team chat and WhatsApp groups sections.
The list, the bell's dot and count, and the live alert all use that one rule. The server still creates and pushes them (and the web shows
them): hiding a kind from phone push needs an API option to exclude types, which is outside `apps/mobile`.
