# ADR-0023: Mobile authentication — bearer tokens in the OS keychain, one shared token rotation

- **Status:** proposed (implemented in the foundation; the open items below need an owner decision and API work)
- **Date:** 2026-10-10

## Context

The web app signs in through a Next.js server that keeps the tokens in httpOnly cookies and proxies `/api/v2/*` to the API. A phone has no
such server and no cookie jar worth trusting. The API already speaks the right protocol for a native client: `POST /v2/auth/login` answers
`authenticated` (a token pair), `mfa_required` (a challenge) or `workspace_required` (a pick list); `POST /v2/auth/login/mfa` and
`POST /v2/auth/login/workspace` finish those; `POST /v2/auth/refresh` takes `{ refreshToken }` and rotates it; `POST /v2/auth/logout` is public and
ends the session behind a refresh token; every other route takes `Authorization: Bearer <access token>` (15-minute lifetime). Rotation is strict: the token from one step back is still accepted for 30 seconds (a response lost in transit), but a token from before that
revokes the whole session (`refresh_reuse`, `SessionService`). Sessions that sit idle are ended unless they were created with `remember: true`.

A phone is lost, shared for an evening, backed up to a cloud, restored onto another phone and read by other apps through logs and screenshots.
Those are the threats the storage and handling rules below answer.

## Decision

1. **Where tokens live.** Both tokens are one JSON item in the OS keychain through `expo-secure-store` (`lib/auth/token-store.ts`), with
   `WHEN_UNLOCKED_THIS_DEVICE_ONLY`: unreadable while the phone is locked, not included in backups, not transferred to another device.
   One item means a write is atomic. Nothing else stores credentials: AsyncStorage and MMKV are banned imports (ESLint).
   Android's `allowBackup` is off.
2. **One owner of the session.** `lib/auth/session-manager.ts` holds the in-memory copy, exposes it to React through
   `useSyncExternalStore`, and is the only module that writes tokens. Screens never see a token.
3. **One refresh at a time.** Concurrent 401s share a single in-flight rotation (`refreshTokens()`), because the API revokes the
   session when a stale refresh token is replayed. A request refreshes ahead of expiry (30 s margin) and, failing that, once on a 401 with the same `Idempotency-Key`.
4. **What ends a session.** Only the server saying no (a 4xx on refresh) ends the session on the phone. An offline phone, a timeout, a 5xx or a 429 never
   does: a lift or a tunnel must not sign anyone out. A refresh that returns after sign-out was pressed is discarded.
5. **Sign-out** tells the server first (best effort, 8 s), then always clears the keychain, the memory copy, the query cache and the error-report identity.
6. **Sign-in** is the same state machine as the web (password, then authenticator code or workspace pick), through the same endpoints and the same
   contract schemas. `remember: true` is always sent: a phone is a personal device, and the server still ends the session on revocation, password
   change and workspace suspension.
7. **Client identity.** Every request carries `X-App-Platform`, `X-App-Version`, `X-App-Build` (also the basis of the minimum-version check in ADR-0026) and a fresh `X-Request-Id`.
8. **Routing follows state.** Expo Router's `Stack.Protected` shows the sign-in group only when signed out and the app group only when signed in.
9. **No secrets in the bundle.** `EXPO_PUBLIC_*` values are readable by anyone who installs the app. `pnpm env:check` fails on secret-looking names.
   The app holds no API keys of its own.

### Open items (each needs an owner and, where noted, API work)

- **A refresh answer lost in transit.** If the server rotates but the phone never receives the answer (signal drops mid-request), the phone still holds the previous token. It is
  accepted for 30 s; after that the next refresh looks like a replay and the server revokes the session, so the person is signed out. Phones lose signal far more than browsers do.
  Options: a longer grace window for sessions created by the app, or an idempotent refresh keyed by `Idempotency-Key`. _Needs API work; until then this is a known, bounded failure (a forced sign-in)._
- **CAPTCHA.** The login contract carries an optional `captchaToken` (reCAPTCHA v2/v3 on the web). If the platform policy turns CAPTCHA on, a native
  client cannot produce that token. Options: exempt requests that carry a verified app identity (App Attest / Play Integrity) from the web CAPTCHA, or add a
  native-capable challenge. Until decided, a workspace with CAPTCHA enforced cannot sign in from the app. _Needs API work._
- **Social sign-in (Google, Apple, …).** The API's social flows are browser redirects. Mobile needs an authorisation-code flow with PKCE in the system browser
  (`expo-auth-session`) or native SDKs, plus a mobile redirect URI per provider. If any social login is offered on iOS, Apple requires "Sign in with Apple" too. _Needs API work._
- **Passkeys.** `mfa_required` can carry `passkey: true`; native passkeys need associated-domain and Digital Asset Links configuration. Not in the foundation.
- **Account gates after sign-in.** The API gates a session (forced password change, MFA enrolment, unverified email, onboarding, suspended workspace). The foundation does not
  yet have those screens; a gated account would sign in and see errors. They are the first backlog items (`docs/mobile/backlog.md`).
- **Push tokens.** Registering a device token needs a new endpoint and a table (tenant-scoped, RLS). _Needs API work_ (`mobile-native-capability` skill).
- **App lock.** An optional biometric lock on app open (it protects the screen, it does not replace sign-in) is deferred until the product asks for it.
- **Device naming in the session list.** The web shows "this device"; sessions created by the app currently look like an unknown client. The API should read `X-App-Platform` to label them.

## Consequences

- The security-relevant logic is small and heavily tested (`session-manager`, `token-store`, the API client): rotation sharing, offline behaviour, discard-after-sign-out.
- A locked phone cannot refresh in the background. Any future background task that must call the API while locked needs a different accessibility class, which is a security decision to make explicitly.
- Anything that restores a phone from a backup comes back signed out. That is intended.
- The app depends on the API keeping its auth endpoints stable; the contracts package makes a change visible at build time.

## Alternatives considered

- **AsyncStorage / MMKV for tokens.** Plain files on disk; readable on a rooted device and in some backups. Rejected.
- **Keep the access token in memory only.** Safer, but every cold start would need a refresh round-trip before the first screen. Memory copy plus keychain item gives the same safety at rest with a faster start.
- **Two keychain items.** A crash between the writes could leave a new access token with an already-rotated refresh token. One item avoids it.
- **A mobile backend-for-frontend that holds the tokens.** Another service to run for no gain: the API already authenticates native clients.
- **`AFTER_FIRST_UNLOCK` accessibility.** Allows background refresh on a locked phone, at the price of the item being readable by anything running with the phone unlocked once since boot. Rejected until a feature needs it.

## Revisit when

- a feature needs background API calls on a locked phone (silent push handling, background sync);
- the platform adds device-bound or DPoP-style tokens;
- the owner decides the CAPTCHA and social-login questions above.
