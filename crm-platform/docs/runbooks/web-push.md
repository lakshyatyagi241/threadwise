# Runbook: browser notifications (Web Push)

What it is: an OS-level notification for the events a person already gets bell rows for, on the devices where they allowed it, even with the CRM tab closed (BL-097).
Design: [realtime-notifications.md](../specs/realtime-notifications.md) section 18. API and rules: [notifications.md](../api/notifications.md) (Phase 3).

## Turn it on

1. Generate a key pair once per deployment, on your own terminal: `npx web-push generate-vapid-keys`. Do not paste it into chat, tickets or any tracked file.
2. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:ops@your-domain.com`) in the environment of **both** the API and the worker, then restart them.
3. Open Account, Notifications as a signed-in person: the **Browser notifications** card and the **Push** column appear. Press **Enable on this device**, allow the browser's prompt, then **Send a test notification**.

Leave the three values empty to keep the feature off: the card and column do not exist, `GET /v2/notifications/push/public-key` answers `enabled: false`, nothing is queued.
The browser needs a secure page (https, or `localhost` in development) to register the service worker (`/sw.js`).

## Rotating the key

A browser ties a subscription to the public key it was made with. After a rotation every saved device fails (the push service answers 401 or 403) and is revoked on its first push; people open
Account, Notifications and press Enable again. Plan it like a password reset for everyone's browser notifications. The private key is a secret: rotate it if it was ever exposed
(see [key-rotation.md](key-rotation.md) for the general practice).

## Watching it

- Queue `web-push` (BullMQ). A growing backlog means a push service is slow or unreachable. Jobs retry for about a minute (4 attempts, exponential from 5 s) and then drop, so it drains by itself; no part of the app waits on a push.
- Worker log lines (never an endpoint or key): `push devices revoked` (counts), `web push gave up after the last attempt`, `revoked push devices pruned`.
- `push_subscriptions`: `revoked_at` set = the push service said the device is gone (404 / 410) or our keys no longer match (401 / 403); `failure_count` counts failures in a row (ten revoke the device); `last_used_at` is the last accepted push.

## If something looks wrong

| Symptom                                      | Check                                                                                                                                                                                    |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No card and no Push column                   | The three VAPID values are not all set and well formed (public key 87 base64url characters, private key 43, subject `mailto:` or https). Set them on API **and** worker, restart.        |
| Test says "no device"                        | The person has not enabled this browser, or the device was revoked. Press Enable again.                                                                                                  |
| Test works, real events do not               | The event's **Push** (and **Bell**) switch for that person; whether a tab of theirs reports visible (no push while the CRM is in front); the worker is running and consuming `web-push`. |
| Every push fails with 401 / 403              | The key pair changed after people subscribed (rotate flow above), or the public and private halves do not match.                                                                         |
| Pushes arrive late                           | The browser or phone is asleep (the push service holds a message for `WEB_PUSH_TTL_SECONDS`, default 4 hours), or the queue is backed up.                                                |
| iPhone or iPad shows "needs the Home Screen" | Expected: Apple delivers web push only to an app added to the Home Screen (iOS or iPadOS 16.4 or later).                                                                                 |
| A person wants a device gone                 | Account, Notifications, **Remove** on the device (or **Turn off on this device**). An operator can delete the `push_subscriptions` row; the browser's own permission is separate.        |
