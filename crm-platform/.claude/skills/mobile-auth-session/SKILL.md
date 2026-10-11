---
name: mobile-auth-session
description: >-
  Anything touching authentication or the session in the mobile app (apps/mobile): sign-in, MFA step, workspace pick, social login,
  passkeys, token storage and refresh, sign-out, the account gates (forced password change, MFA enrolment, unverified email,
  onboarding, suspended workspace), idle timeout, deep links, biometric app lock, or "why was the user signed out". Use before editing
  src/lib/auth, src/features/auth or anything that reads, stores, logs or sends a token. Tokens live only in the OS keychain through
  lib/auth/token-store; never AsyncStorage, never a log, never a URL.
---

# Mobile auth and session

Read `docs/adr/0023-mobile-authentication.md` (the decisions and the open items) and `docs/mobile/security.md` first. The code is small and tested; keep it that way.

## Map

| File                              | Owns                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/lib/auth/token-store.ts`     | the one keychain item (both tokens); nothing else writes credentials                                            |
| `src/lib/auth/session-manager.ts` | in-memory state (`useSyncExternalStore`), single-flight refresh, `startSession`, `endSession`, `getAccessToken` |
| `src/lib/auth/sign-out.ts`        | revoke on the server (best effort), then clear phone, query cache, error-report identity                        |
| `src/lib/api/client.ts`           | attaches the bearer token; one rotation + retry on 401 with the same `Idempotency-Key`                          |
| `src/features/auth/`              | the sign-in state machine and screen (password → MFA code or workspace pick)                                    |
| `src/app/_layout.tsx`             | boot (restore session + language) and `Stack.Protected` routing                                                 |

## Invariants (a change that breaks one needs an ADR change)

1. Tokens exist only in memory and in the keychain item. No other storage, no log, no breadcrumb, no URL, no deep link, no error report field.
2. Refresh is single-flight. Two screens hitting 401 together cause one rotation (the API revokes the session when a stale refresh token is replayed after the 30 s grace).
3. Only a server 4xx on refresh ends the session. Offline, timeout, 5xx and 429 keep it.
4. Sign-out always clears the phone even if the server cannot be reached, and clears the query cache.
5. A refresh that finishes after sign-out is discarded.
6. Public doors (`/v2/auth/login*`, `/refresh`, `/logout`) are called with `auth: false`.

## Common tasks

- **Account gate screens** (first backlog item). After sign-in `GET /v2/auth/session` returns `flags` (`suspended`, `emailUnverified`, `emailBlocked`, `mfaEnrolmentRequired`, `passwordChangeRequired`) and `landing` (`dashboard | inbox | onboarding`). The API refuses most routes while a gate is
  active (error codes `AUTH_PASSWORD_CHANGE_REQUIRED`, `AUTH_MFA_ENROLMENT_REQUIRED`, `AUTH_EMAIL_UNVERIFIED`; suspended allows only sign-out). Add a gate decision in one place (a hook used by the `(app)` layout) that redirects to the right screen; port the screens from the web with `mobile-feature-port`.
- **Idle timeout.** A 401 with `reason=idle` (`ApiError.isIdleTimeout`): the session is over; show the idle message on the sign-in screen (TW-AUTH-033) using `idleMinutes`.
- **Another sign-in method** (social, passkey, sign-up, reset): follow the web flow and endpoints in `apps/web/src/features/auth-registration-security` and `apps/api/.../auth.controller.ts`; the browser-redirect flows need PKCE through `expo-auth-session` (add with `npx expo install`; then `mobile-native-capability`). Check the ADR-0023 open items first: some need API work and an owner decision.
- **Workspace switch.** `POST /v2/auth/workspaces/switch` returns a token pair; call `startSession(pair)` and clear the query cache (data belongs to the old workspace).
- **Deep links.** A link opens a screen and never performs an action or carries a token. Validate the route and params; unknown links land on `/` (`+not-found.tsx`).
- **Biometric app lock** (if the product asks): `expo-local-authentication`, gating the app UI on foreground, not replacing sign-in; add the iOS Face ID usage string (`mobile-native-capability`).
- **"Signed out unexpectedly."** Check in this order: refresh token rejected with 4xx (revoked, expired, replayed after a lost response: ADR-0023 open item), idle timeout, password change on another device, workspace suspension, a clock far from the server's.

## Verify

Unit tests for any logic change in `session-manager` (concurrency, offline, in-flight sign-out) and `client` (rotation); a screen test for any new state of the sign-in flow. Then run it on a device: sign in, kill the app, reopen (still signed in), airplane mode, sign out.
Invoke `mobile-i18n-sync` for new messages and `mobile-quality-review` before the PR (it checks security).
