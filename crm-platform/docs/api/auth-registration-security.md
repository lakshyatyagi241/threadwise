# API: auth, registration, account security and the platform operator layer

Domain `auth` (TW-AUTH-001 .. 049). Base path `/v2`. Errors are `application/problem+json` with a stable `code`
(`AUTH_*` in `@crm/contracts` `common/errors.ts`) and a `requestId`. Request and response shapes live in
`packages/contracts/src/auth-registration-security/`. Live docs: `/docs`.

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

Drives the guest pages: `registrationOpen`, `emailVerification` (`off | banner | block`), `trialDays`, `rememberMeEnabled`, `otp.enabled` (the real activation rule, see "Sign-up code delivery" below: switch on AND a sender that can deliver AND, for a WhatsApp Business sender, an APPROVED template),
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

`GET` → `{ step: "workspace|plan|done", workspace, suggestedName, needsPhone, plans, defaultTimezone }`; `plans` are the plan cards of `GET /plans` (see "Plans" below).
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

| Endpoint                                                                                                                              | Role                 | Notes                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /platform/auth/login`, `…/login/mfa`, `…/refresh` (Public)                                                                      |                      | `login` → `{ status:"authenticated", tokens, operator, mfaEnrolmentRequired }` or `mfa_required`.                                                                                                                                                                         |
| `POST /platform/auth/logout`, `GET …/session`, `POST …/mfa/setup`, `POST …/mfa/enable`                                                | any                  | enrolment routes are gate-exempt.                                                                                                                                                                                                                                         |
| `GET /platform/security`                                                                                                              | any                  | policy, `emergencyHalt`, KPIs (score, open and high risks, blocked attempts 24 h, warnings 24 h, operator MFA, webhook failure %), risk queue, coverage, **enforcement matrix**, `yourIp`.                                                                                |
| `PATCH /platform/security/policy`                                                                                                     | super_admin, support | partial update; one audit event with the diff; rejects a list that would lock the caller out of the IP allowlist.                                                                                                                                                         |
| `GET /platform/security/events`                                                                                                       | any                  | cursor-paginated `security_events`, filter by `event`, `status`.                                                                                                                                                                                                          |
| `POST /platform/security/danger/{revoke-sessions,force-password-reset,rotate-webhook-secrets,halt-sends,resume-sends}`                | super_admin          | refusal for other roles is itself audited (`platform.security.danger_action_denied`).                                                                                                                                                                                     |
| `GET/PATCH /platform/settings/registration`                                                                                           |                      | public registration, email verification mode, default plan, trial days, timezone/country, legal links, OTP knobs. Both return the settings plus `otpStatus` (`{active, reason}`); `otp.sender` must be a registered sender; `otp.template` is server-managed (see below). |
| `GET/POST/PATCH/DELETE /platform/settings/senders[/{id}]`, `POST …/registration/otp-template`, `…/otp-template/refresh`, `…/otp-test` | writes: super_admin  | the sign-up code senders, template and test send: see "Sign-up code delivery" below.                                                                                                                                                                                      |
| `GET/PATCH /platform/settings/social-captcha`                                                                                         |                      | secrets are write-only (`hasSecret`); a blank secret keeps the stored one.                                                                                                                                                                                                |
| `GET/PATCH /platform/settings/auth-pages`                                                                                             |                      | variant 1–5, per-page copy, media URL, showcase fields; empty string restores the shipped default.                                                                                                                                                                        |

## Sign-up code delivery (TW-AUTH-006 sender side, TW-AUTH-007)

The code is delivered by `OTP_SENDER_PORT`, bound to `ConfiguredOtpSender`, which reads the registration settings at send time (no restart
needed) and calls the adapter of the chosen sender kind. Until the channel domains (WABA, WADEV, Twilio) own their connections, the auth zone keeps
a small **sender registry** (platform setting `otp.senders`); `registration.otp.sender` stores `<kind>:<id>` and resolves against it. Those domains
can replace the registry behind the same reference.

| Kind     | Fields (besides `label`)                                                               | Secret (write-only)           | Delivery                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `waba`   | `phoneNumberId`, `wabaId`, `graphBaseUrl` (default `https://graph.facebook.com/v21.0`) | Meta access token             | `POST {graph}/{phoneNumberId}/messages`, the approved authentication template with the code as body variable and copy-code button, Bearer auth |
| `twilio` | `accountSid`, `fromNumber`, `apiBaseUrl` (default `https://api.twilio.com`)            | Twilio auth token             | `POST {api}/2010-04-01/Accounts/{sid}/Messages.json`, form `From=whatsapp:+<from>`, `To=whatsapp:+<digits>`, Basic auth                        |
| `device` | `bridgeUrl`, `senderNumber`                                                            | bridge token (`X-Node-Token`) | `POST {bridge}/api/send-message/{senderNumber}` with `{targetPhoneNumber, message}`                                                            |
| `dev`    | none                                                                                   | none                          | logs the code; refused when `NODE_ENV=production`                                                                                              |

Every call times out after 20 s and redirects are not followed. Failures are typed (`not_configured`, `template_not_approved`, `invalid_number`,
`auth_failed`, `rejected`, `provider_error`, `connection_refused`, `timeout`, `transport_error`) with a safe message: the stored secret and the code are
scrubbed from anything echoed back. Non-template senders send the template body with `{{1}}`/`{{code}}`/`{{otp}}` replaced, else a plain sentence with
the code, the expiry and a do-not-share line.

**Activation** (`otpStatus.reason`): `active` only when the switch is on, the sender exists and has all its fields and its secret, and, for `waba`, the
template for that sender is `approved`. Otherwise sign-up silently skips the code: `disabled`, `no_sender`, `sender_missing`, `sender_incomplete`,
`dev_in_production`, `template_missing`, `template_pending`, `template_rejected`. When the code step runs but the send fails, sign-up answers
`AUTH_OTP_SEND_FAILED` (502) and creates nothing; a failed resend keeps the staged sign-up and its first code.

**Senders** (`/platform/settings/senders`, reads: any operator, writes: super_admin, audited without secrets):

- `GET` → `{ senders: [{ id, kind, label, …fields, hasSecret }], devAllowed }`. `id` is a short stable string (8 hex chars).
- `POST` `{ kind, label, …fields, secret }` → the sender. `PATCH /{id}` partial: a blank or omitted `secret` keeps the stored one, `clearSecret: true` deletes it;
  fields of another kind are refused. `DELETE /{id}` → `{ ok, selectionCleared }` (removing the sender sign-up uses clears `otp.sender` and `otp.template`).
- Addresses must be http(s) without credentials and not a cloud-metadata host; Meta and Twilio addresses must be https in production.

**Template** (`otp.template` in the registration settings: `{ name, kind: waba|local, sender, language, body, metaTemplateId, status: pending|approved|rejected|local, codeExpirationMinutes, submittedAt, checkedAt, rejectedReason }`):

- `POST /platform/settings/registration/otp-template` `{ otp: { sender?, enabled?, ttlMinutes?, length?, resendCooldownSec?, maxAttempts? } }` is the "Create & submit template"
  button: the sender is required (422 on `otp.sender`), the knobs are saved in the same request (same clamping as `PATCH`), then for `waba` an
  AUTHENTICATION template (`BODY` with the security line, `FOOTER` `code_expiration_minutes` = TTL, one `OTP`/`COPY_CODE` button, `en_US`) is submitted to
  `POST {graph}/{wabaId}/message_templates` and stored `pending` with Meta's id; for the other kinds a local template is stored (`local`, usable at once).
  Answer `{ outcome, registration }`, outcome: `submitted`, `resubmitted` (a rejected or other-expiry template is edited with `POST {graph}/{id}`), `local_ready`,
  `already_pending`, `already_approved`. Meta refusing, an empty id back or Meta being unreachable is `AUTH_OTP_TEMPLATE_FAILED` (502, `errors[0] = {path:"reason"}`).
- `POST …/otp-template/refresh` reads `GET {graph}/{id}?fields=id,name,status,rejected_reason` and stores the status (`409` when nothing was submitted to Meta).
  The worker does the same every 5 minutes while a template is `pending` (`OtpTemplateRefreshService`, a Redis lock keeps several workers from all asking).

**Test send** `POST /platform/settings/registration/otp-test` `{ to: E.164, sender? }` (super_admin): a real code through the saved (or named) sender with the
saved knobs and template; 5 per hour per operator, failed attempts included (`RATE_LIMITED` with `retryAfterSeconds`). The answer is
`{ ok, sender, sentTo: "+91 •••• ••21", remainingThisHour }`: the code is never returned. A failed send is `AUTH_OTP_SEND_FAILED` with the reason in `errors[0]`.

Audit events (never carrying secrets or codes): `platform.settings.otp_sender_created | otp_sender_updated | otp_sender_deleted | otp_template_saved |
otp_template_submitted | otp_template_status_changed | otp_template_failed | otp_test_sent`.

## Plans (the thin PLAN slice AUTH depends on)

Code in `apps/api/src/modules/plans-subscriptions-trials/`, contracts in `packages/contracts/src/plans-subscriptions-trials/`, migration
`20261002090000_plan_core.sql`. Not built (PLAN owns them): checkout, subscriptions, add-ons, analytics, FAQ, public pricing, trial hard gate, quota ledger.

- **Data.** `plans` is a platform catalogue (no `org_id`): every transaction may read it, only the privileged flag may write it, one flagged default
  at most (partial unique index), `limits` and `features` are jsonb keyed by the registry in contracts (limits: whole numbers, 0 = unlimited; features: booleans).
  `organizations.plan` stays the one authoritative reference (a slug, never an id: Reference's slug-or-id split broke its counts and delete guard).
  `org_plan_state` (tenant table, readable by the org, written only by privileged code) holds `trial_ends_at`, `plan_ends_at`, `billing_cycle`
  (`trial|monthly|yearly`), `overrides` (`{ limits: { key: -1|n }, features: { key: bool } }`) and `platform_owned` (never limited).
- **Sign-up.** `TenantDirectory.provisionOrganization` resolves the plan in the same transaction: the registration setting's plan if active, else the
  first active flagged default, else the first active free plan by sort order, else the literal `starter` (even when no such plan exists). Only a free
  plan with `trialDays > 0` gets `trial_ends_at = now + days` and cycle `trial`. The `auth.user.registered` payload carries `planSlug` and `trialEndsAt`.
- **`GET /plans`** (User, gate-exempt) → `{ data: PlanCard[], currentSlug, trialEndsAt }`: active plans by `sort_order, amount`; a card has `kind`
  (`free|paid|custom_quote`), `price { amount, offerAmount, currency, period { unit, count } | null }` (decimal strings), `monthlyMessages` (0 = unlimited),
  `chips` (first three enabled of analytics, automation, ai_assistants, woocommerce, shopify, calling, remove_branding), `highlighted`, `current`,
  `action` (`current|continue_free|contact_sales|upgrade|choose|downgrade_unavailable`, ranked by list price) and `ctaLabel`.
- **`/platform/plans`** (operator): `GET` list with in-use counts and a KPI summary and `GET /{id}` (any role); `POST`, `PATCH /{id}`, `PATCH /{id}/active`,
  `DELETE /{id}` (super_admin). The slug is derived once (`Pro Plus` → `pro_plus`, `pro_plus_2`) and never changes. Rules (422 with `errors[]`): offer below
  price, free = price 0 and no offer, custom quote = no price and not free, a priced plan must not be 0, the default must be active. A new default clears the
  previous one. `PLAN_DEFAULT_PROTECTED` (409): the signup default (registration setting or flagged) cannot be deactivated or deleted; `PLAN_IN_USE` (409, `errors[]`
  `{ path: "inUse", message: n }`): an organization is on it. Every write is a `security_events` row `platform.plan.created|updated|activated|deactivated|deleted`.
  `PATCH /platform/settings/registration` refuses a `defaultPlanId` that is not an active plan.
- **Gate.** `PlanEntitlementService.featureEnabled / limit / assertFeature / assertWithinLimit` (order: platform-owned, org override, plan, and when the plan slug
  has no catalogue row nothing is locked, logged once). A locked feature is `422 PLAN_FEATURE_LOCKED` with `errors[]` `feature`, `reason`, `upgradeUrl`
  (`/account/plans`); `PATCH /account/branding` needs `remove_branding`, and `GET /account/branding` reports `canEdit`.
- Dev seed (`pnpm --filter @crm/api seed:auth`): free Starter (sign-up default, 14-day trial), paid Growth (highlighted), paid Scale (offer price, every feature).

## Services other domains call (no HTTP)

Exported from `modules/auth/index.ts`: `SendPolicyService.screen / screenBulk` (halt, guardrails, rate caps), `EmergencyHaltService.assertNotHalted`,
`UploadPolicyService.validate`, `HtmlSanitizerService.sanitize`, `PasswordService`, `AuthAuditService`, `AllowWhileGated`.
Outbound pipelines (inbox reply, broadcast, scheduled, flows, auto-reply) must call `screen`/`screenBulk` before a provider send, and the
send workers must re-check the halt at send time.

## Platform enforcement hooks

- **Send guard.** `WHATSAPP_PROVIDER.sendText` / `sendTemplate` call `OUTBOUND_SEND_GUARD.beforeSend` first: the emergency halt (`AUTH_SEND_HALTED`, 503),
  then, per the security policy's `waGuardrailsMode`, content filters and per-minute and per-day caps (`AUTH_SEND_BLOCKED`, 422, audited as
  `security.send_blocked` / `security.send_flagged`). Callers may pass `screen: { bulk, source }`; a bulk batch skips the per-message rate caps.
  The HTTP app and the worker both import `SendGuardModule`, so a process without the guard fails to boot instead of sending unguarded.
- **API rate ceiling.** The public API key guard holds each key to its own `rate_limit_per_minute`, never above the policy's `apiRateLimitPerMinute`
  (0 = no ceiling).
- **Retention.** The worker's daily sweep deletes `security_events` and `audit_log` rows older than `auditLogRetentionDays` (0 = keep forever), the
  audit log in batches of 10 000.
- **Webhook secret rotation.** `WebhookSecretRegistry.register({ name, rotateAll })`; the danger-zone action sums every registered rotator, audits the
  per-rotator counts and reports `affected`.
