# Mobile backlog

Owned by the project owner. Order is a proposal until ADR-0027's scope question is answered. Statuses: `ready`, `in-progress`, `done`, `blocked` (say what blocks it), `not-planned`.
Every entry that ports a product feature names its web feature area, its wiring map in [`docs/threadwise-port/wiring/`](../threadwise-port/wiring/) (read it first, per the porting rules) and the
API routes it uses. Feature ids (`WD-…`) come from the inventory (`threadwise-feature-lookup` skill); fill them in when an entry starts, do not guess them.

A feature that is on neither this list nor `not-planned` is a gap: add it.

## P0 — before any other feature (the account is gated until these exist)

| Item                                         | Web reference                                                         | API                                               | Status                             |
| -------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------- |
| Forced password change                       | `apps/web` auth, TW-AUTH-035 (policy), `GET /v2/auth/password-policy` | `AUTH_PASSWORD_CHANGE_REQUIRED`                   | ready                              |
| MFA enrolment required                       | `apps/web` auth security settings                                     | `AUTH_MFA_ENROLMENT_REQUIRED`                     | ready                              |
| Email verification (banner / block)          | `apps/web` auth                                                       | `AUTH_EMAIL_UNVERIFIED`                           | ready                              |
| Workspace onboarding (`landing: onboarding`) | TW-AUTH-008 / 009                                                     | `/v2/auth/onboarding/*`                           | ready                              |
| Suspended workspace screen (only sign-out)   | ADR-0019, TW-AUTH-011                                                 | `flags.suspended`                                 | ready                              |
| Idle-timeout sign-out message                | TW-AUTH-033                                                           | 401 with `reason=idle` (`ApiError.isIdleTimeout`) | ready                              |
| Update-required screen                       | ADR-0026                                                              | `APP_UPDATE_REQUIRED` (not built)                 | blocked: API work                  |
| Sign-in: CAPTCHA, social, passkey            | ADR-0023                                                              |                                                   | blocked: owner decision + API work |

## P1 — the daily-use core (proposed)

| Feature                                                 | Contract folders                                 | Wiring map                                           | Notes                                                                 | Status            |
| ------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------------------------- | ----------------- |
| Inbox: conversation list and thread, reply, assign      | `team-inbox-conversations`, `chat-conversations` | `team-inbox-routing-sla.md`, `../plan-inbox-chat.md` | needs realtime (Socket.IO ticket, as web) and a long list (FlashList) | ready             |
| Contacts: list, detail, create/edit, tags               | `contacts-attributes-tags`, `crm`                |                                                      | cursor pagination; `rowVersion` on update                             | ready             |
| Tasks                                                   | `tasks`                                          |                                                      |                                                                       | ready             |
| Notifications: in-app list, push                        | `notifications-activity-audit`                   | `notifications-activity-audit.md`                    | push needs device-token API + FCM/APNs                                | blocked: API work |
| Settings: profile, language, sign out of other sessions | `auth-registration-security`                     |                                                      |                                                                       | ready             |

## P2 — as the owner decides

Leads and deals, companies, broadcasts and campaigns (read-only status first), appointments, team chat, analytics dashboards, billing and wallet (read-only), the rest of the web surface.
Each is `not-planned` until someone moves it up. Do not start one without an entry here.

## Platform work the app depends on

| Item                                                                      | Needs                                              | Status                 |
| ------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------- |
| Device-token registration endpoint + table (RLS) + worker job for sending | `new-module`, `add-migration`, `worker-job` skills | ready                  |
| Minimum-version middleware + `APP_UPDATE_REQUIRED` in `@crm/contracts`    | `contracts-change` skill                           | ready                  |
| Refresh grace for lost responses (app sessions)                           | API change in `SessionService`                     | ready                  |
| Label app sessions ("This device: iPhone") from `X-App-*`                 | API change                                         | ready                  |
| Real brand assets and palette                                             | design                                             | blocked: design        |
| Maestro flows against a seeded API in CI                                  | emulator pipeline                                  | not-planned (ADR-0025) |
