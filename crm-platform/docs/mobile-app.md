# Mobile app (Android + iOS)

React Native (Expo SDK 57, expo-router) app in `apps/mobile`. It uses the same NestJS API as the web app (`/v2/*`, bearer tokens, socket.io `/realtime`). It is **not** part of the pnpm workspace (`!apps/mobile` in `pnpm-workspace.yaml`); it uses npm with `legacy-peer-deps=true` (`.npmrc`) so Expo's tooling and EAS Build resolve it on their own.

## What the app does

| Area | Screen / file | API used |
| --- | --- | --- |
| Sign in | `app/login.tsx` (email + password, MFA code, workspace chooser) | `POST /auth/login`, `/auth/login/mfa`, `/auth/login/workspace`, `/auth/refresh`, `/auth/logout` |
| Inbox | `app/(tabs)/index.tsx` (All / Mine / Unassigned / Unread, search, badges) | `GET /inbox/conversations` |
| Chat | `app/chat/[id].tsx` (text, photo/video/camera, template sheet when the 24h window is closed, read receipts, ticks) | `GET/POST /inbox/conversations/:id/{messages,read,templates}`, `POST /inbox/media` |
| Contacts | `app/(tabs)/contacts.tsx`, `app/contact/[id].tsx`, `app/contact/new.tsx` (search, detail, create, Call / Email / Message) | `GET/POST /contacts`, `GET /channels`, `POST /inbox/conversations/open` |
| Dashboard | `app/(tabs)/dashboard.tsx` (KPIs, 20 h chart, funnel; 24h/7d/30d) | `GET /dashboard/summary` |
| More | `app/(tabs)/profile.tsx` (profile, menu, sign out) | `GET /auth/session` |
| Campaigns / Templates / Deals / Tasks | `app/campaigns.tsx`, `templates.tsx`, `deals.tsx`, `tasks.tsx` | `/campaigns`, `/templates`, `/deals/board`, `/tasks/my` + `/tasks/:id/{complete,reopen}` |
| Notifications + settings | `app/notifications.tsx`, `app/settings.tsx` (per-type push toggles) | `/notifications`, `/notifications/preferences` |

Shared code in `src/`: `api.ts` (fetch client, token refresh, RFC 7807 errors, Idempotency-Key), `auth.tsx`, `realtime.tsx` (socket.io: joins `inbox:all` and `conv:<id>`, events refresh queries; polling is only a 30 s safety net), `push.ts` (Expo push token registration, tap opens the chat), `theme.ts` (light/dark), `ui.tsx`, `types.ts`.

## Backend changes made for mobile

- `POST /v2/notifications/push/mobile` registers the app's Expo push token. It is stored in `push_subscriptions` as a synthetic endpoint (`https://exp.host/expo-push/<token>`) with placeholder keys, so no migration was needed. Device list and delete work as for browsers.
- `WebPushSender` sends native devices through the Expo push service (one batch call, same report buckets: sent / gone / refused / retry). It works without VAPID keys; browser devices still need them. `WebPushDeliveryService` skips with `disabled` only when VAPID is off **and** the person has no native device. `list()` no longer hides devices when VAPID is off.
- `POST /v2/inbox/conversations/open` `{ contactId, channelId }` returns `{ id }`, creating the conversation for the contact on a phone channel if there is none (wraps the existing `ConversationsFacade.openConversationFor`). Needs `inbox.conversation.reply`.
- Contracts: `pushMobileInputSchema`, `EXPO_PUSH_ENDPOINT_PREFIX` (`notifications-activity-audit/web-push.ts`), `openConversationSchema` (`team-inbox-conversations/inbox.ts`).
- Tests: `apps/api/test/unit/notifications/expo-push.spec.ts` (Expo result mapping, retry on 5xx/network, browser devices ignored when VAPID is off). The notifications unit suite passes (205 tests).

## Findings from testing against the live API

- `direction` is `in` / `out` (not inbound/outbound); errors are RFC 7807 (`detail`, `code`); `/auth/login` answers 201; the user name is `fullName` / `displayName`. The app was fixed for all of these.
- The API has no "start a chat" call apart from the new `open` route. The first message outside the 24 h window must be a template.

## Run it

```
cd apps/mobile
cp .env.example .env        # EXPO_PUBLIC_API_URL = LAN IP of the API, never localhost on a phone
npm install
npm start                   # Expo Go
```

Local dev login: `nachiket.challawar@geta.ai` / `Passw0rd!` (from `seed:auth`).

## Build and release

- EAS project: `@akshay-narkhede-01/threadwise` (id in `app.json` `extra.eas.projectId`). Android keystore is held by EAS.
- `eas.json`: `development` / `preview` profiles set `EXPO_PUBLIC_API_URL` to the dev machine's LAN address; `usesCleartextTraffic` is enabled by `expo-build-properties` so plain http works (switch it off for production). `production` needs a public HTTPS URL.
- First test APK (preview): built on EAS (https://expo.dev/artifacts/eas/Q7B0lXNhKIkoDzPszoQ3YJPeEsXlrOh-8MX6QtoWY5E.apk). Not run on a physical phone yet.
- EAS archives the whole git root, which here is the huge `threadwise-port` repo and failed with ENOSPC. Build from a clean copy of `apps/mobile` (without `node_modules`) that is its own git repo: `git init`, commit, `npm ci`, then `eas build -p android --profile preview`.
- Icons / splash: `assets/` (generated).

## Still to do

- iOS build (needs an Apple Developer account; `eas build -p ios`).
- Play Store / App Store submit (`eas submit`) and store listings.
- Phone push: upload an FCM key (`eas credentials`) and test on a device; the presence check (open web tab suppresses push) also applies to native devices.
- Real-device UI pass (layout, gestures, keyboard).
- A public HTTPS API URL for production builds.
- Not built: team chat, flow builder, forms, billing/wallet, settings beyond push preferences, deals/tasks create and edit (read, move-to-done only).
