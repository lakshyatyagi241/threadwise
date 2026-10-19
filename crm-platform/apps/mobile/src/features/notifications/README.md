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
| Pop-ups and sounds inside the app                     | the app does not show live pop-ups or play a ping yet, so the Pop-up and Sound switches only govern the web for now         |
