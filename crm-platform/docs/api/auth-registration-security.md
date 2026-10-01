# API: auth, registration, account security and the platform operator layer

Domain `auth` (TW-AUTH-001 .. 049). Base path `/v2`. Errors are `application/problem+json` with a stable `code`
(`AUTH_*` in `@crm/contracts` `common/errors.ts`) and a `requestId`. Request and response shapes live in
`packages/contracts/src/auth-registration-security/`. Decisions: ADR-0007, ADR-0019. Live docs: `/docs`.

Conventions used below: **Public** = no token. **User** = staff bearer token. **Operator** = platform operator bearer token.
"Gated" routes are refused with `AUTH_PASSWORD_CHANGE_REQUIRED`, `AUTH_MFA_ENROLMENT_REQUIRED` or `AUTH_EMAIL_UNVERIFIED`
(policy `block`) until the account resolves the gate; routes marked **gate-exempt** stay reachable.

## Sessions and tokens

Access token: 15 minutes. Refresh token: rotated on every use, 24 hours absolute for a normal session, 30 days sliding with
"keep me signed in". `expiresIn` is seconds. A refresh token presented a second time after its successor was issued
(outside a 30 s grace for two tabs) revokes the whole session. Sign-out, "revoke other devices", password change and reset
invalidate access tokens immediately (server-side tombstone), not at expiry.

### `POST /auth/login` (Public; alias `POST /auth/staff/login`)

```json
// request
{ "orgSlug": "acme", "email": "ana@acme.test", "password": "••••••••", "remember": true, "captchaToken": "…" }
// 201 authenticated
{ "status": "authenticated", "orgSlug": "acme", "tokens": { "accessToken": "…", "refreshToken": "…", "expiresIn": 900 },
  "landing": "dashboard", "flags": { "suspended": false, "emailUnverified": false, "emailBlocked": false,
  "mfaEnrolmentRequired": false, "passwordChangeRequired": false } }
// 201 when the account has two-factor on: no tokens yet
{ "status": "mfa_required", "challengeToken": "…", "expiresInSeconds": 300 }
```

Errors: `AUTH_INVALID_CREDENTIALS` (401; identical for unknown organization, unknown email and wrong password),
`AUTH_ACCOUNT_LOCKED` (429; `errors:[{path:"retryAfterSeconds"}]`), `AUTH_CAPTCHA_FAILED` (400), `AUTH_ACCOUNT_SUSPENDED` (403),
`RATE_LIMITED` (429). Order of checks: lockout, captcha, per-IP throttle, credentials.

### `POST /auth/login/mfa` (Public)

`{ "challengeToken": "…", "code": "123456" }` or `{ "challengeToken": "…", "recoveryCode": "K7QH2-9WXMD" }` → authenticated body.
Five wrong attempts destroy the challenge. A TOTP time step can be used once. Errors: `AUTH_MFA_INVALID_CODE` (401),
`AUTH_MFA_CHALLENGE_EXPIRED` (401).

### `POST /auth/refresh` (Public) → `{ accessToken, refreshToken, expiresIn }`

### `POST /auth/logout` (User, gate-exempt) → `{ ok: true }`, ends the current session.

### `GET /auth/session` (User, gate-exempt)

Everything the shell needs: `user` (id, email, fullName, displayName, phone, locale, theme, avatarUrl, emailVerified, mfaEnabled),
`org` (id, slug, name, plan, timezone, currency, messageFooter, onboardingStep), `roles`, `permissions` (`{ "record.contacts.read": "own" }`;
denied keys absent), `landing` (`dashboard | inbox | onboarding`), `flags`, `sessionId`.

### `GET /auth/workspaces`, `POST /auth/workspaces/switch` (User, gate-exempt)

The same person in several organizations means the same email, verified in both. List shows the organizations of the caller's
verified email; switch opens a session in another one (no password; an MFA-enabled target answers with `mfa_required`).
Error: `AUTH_WORKSPACE_NOT_AVAILABLE` (403).

### `GET /auth/registration-config` (Public)

Drives the guest pages: `registrationOpen`, `emailVerification` (`off | banner | block`), `trialDays`, `rememberMeEnabled`, `otp.enabled`,
`captcha` (`null` or `{version, siteKey}`), `social.{google,facebook}`, `defaultCountryIso`, `authPages` (variant 1–5, `login | register | forgot`
copy with shipped English defaults applied, `defaulted` = per page the text fields the administrator left empty so a localised client can use its own copy, `extra` showcase fields), `links` (terms, privacy, cookies).

## Sign-up and onboarding

### `POST /auth/signup` (Public)

Creates the organization, its locked Admin role (every capability), an editable Agent role and the first user in one transaction.

```json
{
  "orgName": "Acme Co",
  "orgSlug": "acme",
  "fullName": "Ana Rao",
  "email": "ana@acme.test",
  "phone": "+919876543221",
  "password": "…",
  "acceptTerms": true,
  "referralCode": "ABC123",
  "captchaToken": "…"
}
```

→ authenticated body (`landing: "onboarding"`), or, when registration OTP is on, **nothing is created** and the answer is
`{ "status": "otp_required", "challengeId": "…", "maskedPhone": "+91 •••• ••21", "expiresInSeconds": 300, "resendCooldownSeconds": 60, "codeLength": 6 }`.
Errors: `AUTH_SIGNUP_CLOSED` (403), `AUTH_SLUG_TAKEN` (409), `AUTH_PASSWORD_POLICY` (422, one `errors[]` entry per broken rule),
`AUTH_CAPTCHA_FAILED`, `RATE_LIMITED` (10 sign-ups per IP per hour; OTP sends are limited per number and per IP).
Side effects: audit `auth.signup`, outbox `auth.user.registered` (consumed by plans, referral and notification domains), verification mail.

### `POST /auth/signup/verify-otp`, `POST /auth/signup/resend-otp` (Public)

`{ challengeId, code }` → authenticated body (phone stamped verified). Errors: `AUTH_OTP_INVALID`, `AUTH_OTP_EXPIRED` (the code expired: resend),
`AUTH_SIGNUP_EXPIRED` (the staged sign-up is gone: start again), `AUTH_OTP_TOO_MANY_ATTEMPTS`, `AUTH_OTP_RESEND_COOLDOWN`
(`errors[0].path = "retryAfterSeconds"`), `AUTH_OTP_SEND_FAILED`. The staged request keeps an argon2 hash of the
password and of the code, never either in clear.

### `GET /onboarding`, `POST /onboarding/workspace`, `POST /onboarding/complete` (User, gate-exempt)

`GET` → `{ step: "workspace|plan|done", workspace, suggestedName, needsPhone, plans: [], defaultTimezone }` (plans arrive with the plan domain).
`POST /onboarding/workspace` (`admin.settings.manage`): `{ name, industry?, sizeRange?, timezone, currency?, phone? }`.

## Recovery and verification (all Public, neutral answers)

| Endpoint                                    | Body                                                        | Notes                                                                                                                                                                                                                   |
| ------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/forgot-password`                | `{ orgSlug, email, captchaToken? }`                         | Always `{ok:true}`. One mail per address per minute; the mail is sent after the response so timing does not leak.                                                                                                       |
| `POST /auth/reset-password`                 | `{ orgSlug, token, password }`                              | Token: single use, 60 minutes, stored hashed. Policy checked before the token is consumed. Signs every device out, clears a forced change, marks the email verified, sends a "password changed" mail.                   |
| `POST /auth/verify-email`                   | `{ orgSlug, token }`                                        | Single use. Never returns a token or opens a session. `AUTH_TOKEN_INVALID` (400) on any bad or used link.                                                                                                               |
| `POST /auth/verify-email/resend`            | (User, gate-exempt)                                         | 60 s throttle (`RATE_LIMITED` with `retryAfterSeconds`); `{sent, alreadyVerified}`.                                                                                                                                     |
| `POST /auth/find-workspaces`                | `{ email }`                                                 | Mails the workspace links to a verified address only; always `{ok:true}`.                                                                                                                                               |
| `GET /auth/social/{google\|facebook}/start` | query `orgSlug?, mode=login\|signup, redirectUri, orgName?` | `{ url }`. `redirectUri` must be on the web origin.                                                                                                                                                                     |
| `POST /auth/social/{provider}/callback`     | `{ code, state }`                                           | State is single use. Links an existing **verified** email or, in sign-up mode, creates a new organization; never creates a user in an existing one. Facebook emails never link. Result is the login body (MFA applies). |

## Account (User; every route acts on the caller)

| Endpoint                                                                                                                                                 | Purpose                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET/PATCH /account/profile`                                                                                                                             | name, display name, phone (E.164), locale, theme, workspace timezone (owners/admins).                                                                                                              |
| `POST /account/email-change` · `POST /account/email-change/confirm` (Public)                                                                             | Needs the current password; the new address must confirm. The old address gets a notice.                                                                                                           |
| `POST /account/avatar` (multipart `file`) · `GET` · `DELETE`                                                                                             | JPG/PNG/WebP/GIF ≤ 1 MB, checked by extension and file signature (`AUTH_UPLOAD_REJECTED`).                                                                                                         |
| `POST /account/password` (gate-exempt)                                                                                                                   | `{ currentPassword, newPassword }` → `{ revokedOtherSessions }`. Must differ from the current one.                                                                                                 |
| `DELETE /account`                                                                                                                                        | `{ confirmation: "DELETE my account", password }`. Hard delete + audit. Blocked for the only member / only administrator (`AUTH_DELETE_BLOCKED`, `errors[0].message = sole_member \| sole_admin`). |
| `GET/PATCH /account/branding` (`auth.branding.update`)                                                                                                   | Outgoing message footer ≤ 60 chars; `null` = platform default, `""` = none.                                                                                                                        |
| `GET /account/mfa`, `POST /account/mfa/setup`, `POST /account/mfa/enable`, `POST /account/mfa/disable`, `POST /account/mfa/recovery-codes` (gate-exempt) | TOTP enrolment (secret kept 10 minutes in Redis), 10 single-use recovery codes shown once, disable and regenerate need the password.                                                               |
| `GET /account/sessions`, `DELETE /account/sessions/{id}`, `POST /account/sessions/revoke-others` (gate-exempt)                                           | Device list; another user's session id is `404`; the current one cannot be revoked here (`AUTH_CANNOT_REVOKE_CURRENT`).                                                                            |

## Platform operator layer (`/platform/*`)

A separate identity pool (`typ: platform_operator`, roles `super_admin | support | auditor`, 12-hour sessions, MFA mandatory for
`super_admin`). Every route also applies the operator IP allowlist. Create the first operator with
`OPERATOR_PASSWORD=… pnpm --filter @crm/api operator:create -- --email … --name …`.

| Endpoint                                                                                                               | Role                 | Notes                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /platform/auth/login`, `…/login/mfa`, `…/refresh` (Public)                                                       |                      | `login` → `{ status:"authenticated", tokens, operator, mfaEnrolmentRequired }` or `mfa_required`.                                                                                          |
| `POST /platform/auth/logout`, `GET …/session`, `POST …/mfa/setup`, `POST …/mfa/enable`                                 | any                  | enrolment routes are gate-exempt.                                                                                                                                                          |
| `GET /platform/security`                                                                                               | any                  | policy, `emergencyHalt`, KPIs (score, open and high risks, blocked attempts 24 h, warnings 24 h, operator MFA, webhook failure %), risk queue, coverage, **enforcement matrix**, `yourIp`. |
| `PATCH /platform/security/policy`                                                                                      | super_admin, support | partial update; one audit event with the diff; rejects a list that would lock the caller out of the IP allowlist.                                                                          |
| `GET /platform/security/events`                                                                                        | any                  | cursor-paginated `security_events`, filter by `event`, `status`.                                                                                                                           |
| `POST /platform/security/danger/{revoke-sessions,force-password-reset,rotate-webhook-secrets,halt-sends,resume-sends}` | super_admin          | refusal for other roles is itself audited (`platform.security.danger_action_denied`).                                                                                                      |
| `GET/PATCH /platform/settings/registration`                                                                            |                      | public registration, email verification mode, default plan, trial days, timezone/country, legal links, OTP knobs.                                                                          |
| `GET/PATCH /platform/settings/social-captcha`                                                                          |                      | secrets are write-only (`hasSecret`); a blank secret keeps the stored one.                                                                                                                 |
| `GET/PATCH /platform/settings/auth-pages`                                                                              |                      | variant 1–5, per-page copy, media URL, showcase fields; empty string restores the shipped default.                                                                                         |

## Services other domains call (no HTTP)

Exported from `modules/auth/index.ts`: `SendPolicyService.screen / screenBulk` (halt, guardrails, rate caps), `EmergencyHaltService.assertNotHalted`,
`UploadPolicyService.validate`, `HtmlSanitizerService.sanitize`, `PasswordService`, `AuthAuditService`, `AllowWhileGated`.
Outbound pipelines (inbox reply, broadcast, scheduled, flows, auto-reply) must call `screen`/`screenBulk` before a provider send, and the
send workers must re-check the halt at send time.
