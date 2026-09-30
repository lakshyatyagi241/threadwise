---
domain: auth-registration-security
code: AUTH
title: Auth, registration, 2FA, account settings and security policy
wadesk_version: '1.7.0'
sources_read: 68
---

# Auth, registration, 2FA, account settings and security policy

## Overview

This domain is everything that proves who a person is and everything an operator can tighten around
that proof. It has four layers.

1. **Guest journey (web).** Sign-in with email and password, optional Google/Facebook sign-in
   (SDK-free OAuth), optional reCAPTCHA v2/v3, sign-up with an optional WhatsApp one-time-code check of
   the mobile number, forgot/reset password, email verification, and a three-step onboarding
   (account, first workspace, plan). The guest pages are white-label editable by the super-admin
   (5 design variants, inline copy and media editing).
2. **Signed-in self-service.** The `/account` hub (profile, photo, change password, delete account,
   message-footer branding; other panes are owned by billing/wallet/support domains), the
   `Settings -> Security` pane (TOTP enrolment, active sessions), and workspace switching.
3. **Enforcement middleware.** Idle session timeout, concurrent-session cap, "force 2FA" policy,
   suspended/unverified account lock, admin IP allowlist, security response headers, no-store on guest pages,
   graceful CSRF-419 handling.
4. **Platform Security Center (`/admin/security`).** A single settings form persisted as `security.*`
   system settings, a KPI strip, a risk queue read from the audit log, and a super-admin-only danger zone
   (revoke every session, force password reset for all, rotate webhook secrets, emergency send halt).
   Several of those settings are consumed by other domains (send guardrails, API rate limit, webhook
   signing, device idle logout, audit retention).

Actors: guest visitor, signed-in user (any role), workspace owner, platform admin, Super Admin
(danger zone only). API clients and the mobile app authenticate through other domains (see Cross-domain
contracts) but reuse the rules defined here (lockout numbers, OTP service, social verification).

Important structural facts a rebuilder must know up front:

- WaDesk users are **global**: one `users` row per email across the whole platform, joined to N workspaces
  through `workspace_user`. Login has no tenant context. The target stack scopes users per org, so login
  needs an org slug (see Port notes).
- The **live** web login/registration is `AuthPagesController`. `AuthController::login/logout/showLogin/registerAccount`
  are unrouted dead code with subtly different (sometimes better) rules; they are documented in WD-AUTH-048.
- **TOTP two-factor is enrol-only on the web**: nothing at web login, social login or the email-verify link
  asks for the second factor. Only the mobile API gates login on `two_factor_enabled` (using a WhatsApp OTP,
  a different mechanism). See QUIRKs.
- Several admin toggles are saved but never enforced (`public_registration`, `remember_me_enabled`,
  `password_max_age_days` on the live login, `force_password_change`, `allowed_2fa_methods`,
  `wa_require_template_review`, `device_trust_required`, `webhook_replay_window_sec`, `mask_customer_numbers`).
  The Data model and WD-AUTH-037 carry an enforcement matrix.

Plan tiers: this domain is not plan-gated, except the message-footer branding (`remove_branding` plan
feature, WD-AUTH-029). Registration decides which plan a new workspace lands on (owned by PLAN, consumed in
WD-AUTH-008).

## Feature index

| Id          | Feature                                                       | Status      | Priority | Effort | Depends on                            |
| ----------- | ------------------------------------------------------------- | ----------- | -------- | ------ | ------------------------------------- |
| WD-AUTH-001 | Email + password sign-in with role-aware landing              | implemented | P0       | M      | WD-AUTH-002, WD-AUTH-003, WD-AUTH-017 |
| WD-AUTH-002 | Login brute-force lockout                                     | implemented | P1       | S      | WD-AUTH-001, WD-AUTH-037              |
| WD-AUTH-003 | reCAPTCHA gate on login and register                          | implemented | P1       | S      | WD-AUTH-023                           |
| WD-AUTH-004 | Google / Facebook sign-in (web)                               | implemented | P1       | M      | WD-AUTH-023                           |
| WD-AUTH-005 | Sign-up: account creation (step 1)                            | implemented | P0       | M      | WD-AUTH-003, WD-AUTH-015, WD-AUTH-019 |
| WD-AUTH-006 | Sign-up WhatsApp OTP verification and resend                  | implemented | P1       | M      | WD-AUTH-005, WD-AUTH-007              |
| WD-AUTH-007 | Registration OTP admin setup and template creation            | implemented | P1       | M      | WD-AUTH-006                           |
| WD-AUTH-008 | Onboarding step 2: first workspace                            | implemented | P0       | M      | WD-AUTH-005, WD-AUTH-019              |
| WD-AUTH-009 | Onboarding step 3: plan picker / skip                         | implemented | P1       | S      | WD-AUTH-008                           |
| WD-AUTH-010 | Workspace switch                                              | implemented | P0       | S      | WD-AUTH-008                           |
| WD-AUTH-011 | Authenticated home router and guest redirect                  | implemented | P0       | S      | WD-AUTH-001                           |
| WD-AUTH-012 | Sign out                                                      | implemented | P0       | S      | WD-AUTH-020                           |
| WD-AUTH-013 | Forgot password (request reset link)                          | implemented | P0       | M      | WD-AUTH-020                           |
| WD-AUTH-014 | Reset password (consume token)                                | implemented | P0       | S      | WD-AUTH-013                           |
| WD-AUTH-015 | Email verification (link, resend, gate screen)                | implemented | P1       | M      | WD-AUTH-016                           |
| WD-AUTH-016 | Account lock gates (suspended, unverified)                    | implemented | P1       | S      | WD-AUTH-015                           |
| WD-AUTH-017 | Login side effects: invite acceptance, audit, admin workspace | implemented | P1       | M      | WD-AUTH-001                           |
| WD-AUTH-018 | New-device / new-country login alert                          | implemented | P2       | M      | WD-AUTH-017, WD-AUTH-037              |
| WD-AUTH-019 | Registration policy settings                                  | partial     | P1       | S      | WD-AUTH-005, WD-AUTH-008              |
| WD-AUTH-020 | Guest-page cache and CSRF resilience                          | implemented | P1       | S      | -                                     |
| WD-AUTH-021 | Auth pages editor (admin): variants, preview, save            | implemented | P2       | L      | -                                     |
| WD-AUTH-022 | Auth pages inline-edit endpoints                              | implemented | P2       | M      | WD-AUTH-021                           |
| WD-AUTH-023 | Social login and reCAPTCHA admin settings                     | implemented | P1       | S      | WD-AUTH-003, WD-AUTH-004              |
| WD-AUTH-024 | Account hub shell (/account)                                  | implemented | P1       | M      | -                                     |
| WD-AUTH-025 | Profile update                                                | implemented | P1       | S      | WD-AUTH-024                           |
| WD-AUTH-026 | Profile photo upload and remove                               | implemented | P2       | S      | WD-AUTH-024                           |
| WD-AUTH-027 | Change password (signed in)                                   | implemented | P0       | S      | WD-AUTH-035                           |
| WD-AUTH-028 | Delete account (danger zone)                                  | implemented | P1       | M      | WD-AUTH-024                           |
| WD-AUTH-029 | Workspace message footer (branding)                           | implemented | P2       | S      | WD-AUTH-024                           |
| WD-AUTH-030 | TOTP two-factor enrolment and disable                         | partial     | P1       | M      | WD-AUTH-032                           |
| WD-AUTH-031 | Active sessions list and revoke                               | implemented | P1       | M      | WD-AUTH-034                           |
| WD-AUTH-032 | Enforced 2FA policy (Force2FA)                                | partial     | P1       | S      | WD-AUTH-030, WD-AUTH-037              |
| WD-AUTH-033 | Session idle timeout                                          | implemented | P1       | S      | WD-AUTH-037                           |
| WD-AUTH-034 | Concurrent session cap                                        | implemented | P2       | S      | WD-AUTH-037                           |
| WD-AUTH-035 | Password strength policy, max age, force-change flag          | partial     | P1       | M      | WD-AUTH-037                           |
| WD-AUTH-036 | Admin Security Center: screen, KPIs, risk queue               | implemented | P1       | M      | WD-AUTH-037                           |
| WD-AUTH-037 | Security policy store, save and enforcement matrix            | implemented | P0       | M      | -                                     |
| WD-AUTH-038 | Admin IP allowlist                                            | implemented | P1       | S      | WD-AUTH-037                           |
| WD-AUTH-039 | Danger zone: revoke all sessions, force reset, rotate secrets | implemented | P1       | S      | WD-AUTH-036                           |
| WD-AUTH-040 | Emergency send halt and resume                                | implemented | P1       | S      | WD-AUTH-039                           |
| WD-AUTH-041 | WhatsApp send guardrails (SendGate)                           | implemented | P2       | M      | WD-AUTH-037                           |
| WD-AUTH-042 | Customer phone-number masking toggle                          | dead-code   | P2       | S      | WD-AUTH-037                           |
| WD-AUTH-043 | Secure upload guard                                           | implemented | P1       | S      | -                                     |
| WD-AUTH-044 | HTML sanitiser for rich text                                  | implemented | P1       | S      | -                                     |
| WD-AUTH-045 | HTTP security headers                                         | implemented | P1       | S      | -                                     |
| WD-AUTH-046 | Security audit log writer                                     | implemented | P2       | S      | WD-AUTH-030, WD-AUTH-031              |
| WD-AUTH-047 | Encryption at rest of auth secrets                            | implemented | P0       | S      | -                                     |
| WD-AUTH-048 | Legacy AuthController login and register                      | dead-code   | P2       | S      | -                                     |
| WD-AUTH-049 | Install-wizard file session                                   | implemented | P2       | S      | -                                     |

## Features

### WD-AUTH-001 — Email + password sign-in with role-aware landing

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-AUTH-002, WD-AUTH-003, WD-AUTH-017
- **Summary:** A guest signs in with email and password on `/login`, optionally ticking "Keep me signed in for 30 days" (checked by default). On success the session id is rotated and the user lands in the right home for their role: admin console for platform staff, workspace-creation step when they own no workspace, Team Inbox for agents/viewers, dashboard for everyone else.
- **Actors & access:** guests only (route group `guest` + `NoStoreResponse`; a signed-in user hitting `/login` is bounced to `/home`, see WD-AUTH-011). No permission keys. No plan gate.
- **UX & screens:** `resources/views/auth/login.blade.php` (variant 1 = split showcase with left marketing panel, variants 2-5 delegate to `components/auth-shell.blade.php`), form partial `auth/_login_form.blade.php`. Fields: email (type email, required, autofocus), password (required, autocomplete current-password), "Forgot password?" link to `/forgot-password`, remember checkbox (name `remember`, value 1, default checked, label says 30 days), hidden `next` (filled by inline script only when the page runs as an installed PWA in standalone display mode and `?next=` starts with a single `/`), reCAPTCHA block (WD-AUTH-003), social buttons above the form when any provider is enabled (WD-AUTH-004), "Create an account" link, Terms/Privacy/Cookies footer links (settings `privacy_terms_url`, `privacy_policy_url`, `privacy_cookies_policy_url`, falling back to `/legal/terms`, `/legal/privacy`). States: validation/credential errors listed in a red box, flash `status` in a green box (e.g. "Password reset. Please sign in."). `?logout=1` in the URL shows a transient "You've been signed out" toast (`resources/js/charts/auth-login.js`). Password field has a show/hide eye toggle. Admin-editable copy comes from `auth.login.*` settings (WD-AUTH-021).
- **Endpoints:**

| Endpoint   | Route name | Handler                       | Middleware             | Request                                                                                                                                       | Response                                         |
| ---------- | ---------- | ----------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| GET login  | login      | AuthPagesController@showLogin | guest, NoStoreResponse | -                                                                                                                                             | login view                                       |
| POST login | -          | AuthPagesController@login     | guest, NoStoreResponse | email (required, email), password (required, string), remember or remember_me (bool), g-recaptcha-response or recaptcha_token, next (ignored) | redirect (see rules) or back with `errors.email` |

- **Data:** reads `users` (email, password, role, current_workspace_id, deleted_at excluded by SoftDeletes), `workspace_user`, Spatie role tables (`model_has_roles`, `roles`). Writes: `sessions` row (database session driver), `users.remember_token` when remember is ticked, `users.current_workspace_id` (fallback to first workspace), `audit_logs` via events (WD-AUTH-017).
- **Rules & edge cases:**
  1. Order of checks: validate -> lockout check (WD-AUTH-002) -> reCAPTCHA (WD-AUTH-003) -> `Auth::attempt(email, password, remember)`.
  2. Wrong credentials always return the same generic message ("Those credentials don't match.") on the `email` field, with `email` and `remember` flashed back, never the password. Unknown email and wrong password are indistinguishable.
  3. Soft-deleted users cannot sign in (default query excludes them). Suspended users (`users.role = 'suspended'`) CAN sign in and are then locked to `/account/suspended` (WD-AUTH-016).
  4. On success: lockout counter cleared, session id regenerated, session flag `auth.remember` = the remember boolean (this flag makes the idle-timeout middleware skip the user, WD-AUTH-033).
  5. Landing: if the user holds any platform role (Spatie `Super Admin`, `Platform Support`, `Auditor` via `PlatformPermissions::userHasPlatformAccess`) -> forget `url.intended` and redirect to `/admin` (deterministic). Else if the user has zero workspaces -> `/register/workspace`. Else if `current_workspace_id` is empty -> switch to the first workspace. Then role-aware landing: workspace role `agent` or `viewer` -> `/team-inbox`, otherwise `route('user.dashboard')`, both passed through `redirect()->intended(...)` so a saved deep link wins.
  6. `remember_me` is accepted as an alias of `remember` (legacy form field).
  7. QUIRK: the admin toggle `security.remember_me_enabled` is NOT consulted on this live path (only the dead AuthController honours it), so "remember me" cannot actually be disabled from the Security Center.
  8. QUIRK: the hidden `next` field and the guest-redirect `?next=` are ignored by the live controller; deep-linking relies solely on Laravel's stored intended URL (which `redirectGuestsTo` populates for GET page requests).
  9. QUIRK: `password_max_age_days` and `force_password_change` are not checked at this login (only the dead AuthController checks max age), and there is no second-factor step (see WD-AUTH-030).
  10. Flash on success is not set (the dead controller set "Welcome back, name").
- **Async & events:** Laravel `Failed` event -> `audit_logs` row `auth.failed` (result failure, payload identifier = email truncated to 191). `Login` event -> `auth.login` audit row plus the side effects in WD-AUTH-017 and WD-AUTH-018. Lockout writes `auth.lockout` (WD-AUTH-002).
- **External systems:** none (reCAPTCHA see WD-AUTH-003).
- **Settings:** `security.lockout_after_failures` (5), `security.lockout_window_minutes` (15), `recaptcha_*`, `auth.variant`, `auth.login.*`, `privacy_*_url`. Session config: driver `database`, lifetime 10080 minutes, same-site lax, http-only, secure cookie in production (`config/session.php`).
- **Acceptance criteria:**
  - Given a verified user with one workspace and role owner, when they post valid credentials, then they are redirected to the dashboard (or their intended URL) and a session row exists with their user id.
  - Given valid email but wrong password, when they submit, then the response returns to `/login` with the generic credentials error, the email is prefilled, and an `auth.failed` audit row is written.
  - Given a user whose workspace role is agent, when they sign in with no intended URL, then they land on `/team-inbox`.
  - Given a platform-role user (e.g. Super Admin), when they sign in, then they land on `/admin` even if a dashboard URL was stored as intended.
  - Given a user with no workspace, when they sign in, then they land on `/register/workspace`.
  - Given a soft-deleted account, when its owner posts the old credentials, then sign-in fails with the generic error.
- **Source refs:** `app/Http/Controllers/AuthPagesController.php`, `resources/views/auth/login.blade.php`, `resources/views/auth/_login_form.blade.php`, `resources/views/auth/_social.blade.php`, `resources/js/charts/auth-login.js`, `routes/web.php`, `bootstrap/app.php` (redirectGuestsTo), `app/Support/PlatformPermissions.php`, `Documentation/pages/security/authentication.html`.
- **Port notes:** `apps/api/src/modules/auth` already has staff login (org slug + email + password, argon2id, access/refresh JWT) and a Clerk session exchange (ADR-0007). WaDesk has no org slug at login; decide how a global-email login maps to org-scoped users (a per-email org picker, or login on a tenant domain). "Keep me signed in" maps to refresh-token lifetime; landing decision (platform staff vs workspace role) becomes a `landing` hint in the login response consumed by `apps/web`. Do not replicate the ignored `next` handling; validate any return path as a relative path only.

### WD-AUTH-002 — Login brute-force lockout

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-AUTH-001, WD-AUTH-037
- **Summary:** Repeated failed sign-ins for the same email from the same IP temporarily block further attempts for a configurable window. A correct login clears the counter immediately; the block expires by itself.
- **Actors & access:** applies to every guest posting `/login`. Configured by admins in the Security Center (WD-AUTH-037).
- **UX & screens:** on lockout the login page shows "Too many failed attempts. Try again in N minute(s)." (N = ceil(seconds remaining / 60), minimum 1) on the email field; nothing else changes.
- **Endpoints:** part of `POST login` (see WD-AUTH-001). The mobile API has its own copy of the idea (6 attempts / 15 minutes, key `mobile-login:ip|sha1(email)`), owned by MOB.
- **Data:** cache-backed rate limiter key `login:` + sha1(lowercase email + `|` + ip). Cache store is whatever `CACHE_STORE` is (the codebase comments assume database cache). No table owned. Audit row `auth.lockout` (layer platform, result warning, payload email).
- **Rules & edge cases:**
  1. `security.lockout_after_failures` (default 5, range 1-50 via form; the code treats 0 as disabled but the form cannot save 0) and `security.lockout_window_minutes` (default 15, min 1 in code, range 1-1440 via form).
  2. Only failed credential checks are counted (`RateLimiter::hit` with decay = window minutes x 60). reCAPTCHA failures do not count and unknown/known emails count identically.
  3. The key includes both email and IP, so an attacker rotating IPs is not throttled per account, and one IP trying many emails is throttled per email only.
  4. Lockout is checked BEFORE reCAPTCHA and before any password check, so a locked-out user with the right password is still refused until the window decays.
  5. Email is lowercased for the key only; the validated email is not normalised elsewhere.
  6. No global per-IP throttle on `/login` beyond this.
- **Async & events:** audit `auth.lockout`; the KPI "Blocked attempts" counts `auth.failed` rows in the last 24h (WD-AUTH-036).
- **External systems:** none.
- **Settings:** `security.lockout_after_failures`, `security.lockout_window_minutes`.
- **Acceptance criteria:**
  - Given threshold 5 and window 15, when the same email+IP fails 5 times, then the 6th attempt (even with the correct password) returns the lockout message and an `auth.lockout` audit row exists.
  - Given a locked-out key, when 15 minutes pass with no attempts, then a correct login succeeds.
  - Given 3 failures followed by a correct login, when the same user fails again later, then the counter starts from 0.
  - Given threshold 0 stored in settings, when a user fails many times, then no lockout applies.
- **Source refs:** `app/Http/Controllers/AuthPagesController.php`, `app/Support/SecurityPolicy.php`, `app/Http/Controllers/Admin/SecurityController.php`.
- **Port notes:** implement as a Redis counter (`login:{org}:{email}:{ip}`) in the auth service; write the audit event through the outbox/audit path (ADR-0005). Consider also an IP-only limiter, which WaDesk lacks.

### WD-AUTH-003 — reCAPTCHA gate on login and register

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-AUTH-023
- **Summary:** When the admin enables Google reCAPTCHA (v2 checkbox or v3 invisible score) the login and sign-up forms must present a valid token; otherwise the submission is rejected before authentication.
- **Actors & access:** guests on `/login` and `/register`. Configured by platform admins (WD-AUTH-023). Not applied to forgot-password, OTP verify, social login or the mobile API.
- **UX & screens:** partial `auth/_recaptcha.blade.php`, included inside the login and register forms. v2 renders the `g-recaptcha` box and loads `https://www.google.com/recaptcha/api.js`. v3 renders a hidden `recaptcha_token` input plus a "Protected by reCAPTCHA" notice; `resources/js/charts/auth-recaptcha.js` lazily loads `api.js?render=<siteKey>`, intercepts submit, calls `grecaptcha.execute(siteKey, {action})` (action `login` or `register`), writes the token and resubmits; it waits up to about 6 seconds for the library and submits anyway if it cannot load (the server then rejects). Nothing renders when disabled.
- **Endpoints:** part of `POST login` and `POST register`; token read from `g-recaptcha-response` (v2) or `recaptcha_token` (v3).
- **Data:** settings `recaptcha_enabled`, `recaptcha_version`, `recaptcha_site_key`, `recaptcha_secret` (encrypted), `recaptcha_v3_threshold`.
- **Rules & edge cases:**
  1. `RecaptchaService::enabled()` requires the toggle AND non-empty site key AND secret; otherwise `verify()` returns true (fail-open by design when off).
  2. When enabled: missing token -> fail; otherwise POST form-encoded `secret`, `response`, `remoteip` to Google `siteverify` (10 s timeout). Non-success or `success:false` -> fail. v3 additionally requires `score >= threshold` (default 0.5; a stored 0 falls back to 0.5). Any exception -> fail closed (logged).
  3. Failure message on login/register: "Please complete the captcha and try again." attached to the `email` field with input flashed (never passwords).
  4. The `action` name in the JS is not verified server-side (Google's returned `action` is not compared).
  5. The captcha is checked after the login lockout check, and for register after field validation.
- **Async & events:** none.
- **External systems:** Google reCAPTCHA `https://www.google.com/recaptcha/api/siteverify`; keys from admin settings (WD-AUTH-023); no rate handling beyond Google's.
- **Settings:** `recaptcha_enabled` (false), `recaptcha_version` (v2), `recaptcha_site_key`, `recaptcha_secret`, `recaptcha_v3_threshold` (0.5).
- **Acceptance criteria:**
  - Given reCAPTCHA enabled with both keys, when a login is posted without a token, then it is rejected with the captcha message and no credential check happens.
  - Given v3 with threshold 0.5, when Google returns score 0.3, then the request is rejected; with 0.7 it proceeds.
  - Given the toggle on but the secret empty, when a login is posted, then the captcha is skipped (treated as disabled).
  - Given Google unreachable, when a login is posted with a token, then it is rejected (fail closed).
- **Source refs:** `app/Services/RecaptchaService.php`, `resources/views/auth/_recaptcha.blade.php`, `resources/js/charts/auth-recaptcha.js`, `app/Http/Controllers/AuthPagesController.php`, `app/Http/Controllers/AdminPagesController.php` (settingSocialLoginUpdate).
- **Port notes:** put behind a `CaptchaPort` (skill: provider-adapter) with a Google adapter and a no-op adapter; keys in encrypted platform settings. Extend (optionally) to forgot-password since WaDesk leaves it unprotected. Check the returned `action` and `hostname` for v3 to close the gap noted above.

### WD-AUTH-004 — Google / Facebook sign-in (web)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-AUTH-023
- **Summary:** When enabled by the admin, login and register show "Google" / "Facebook" buttons. The flow is a plain OAuth 2.0 authorization-code exchange (no SDK). A returning social user, or an existing account with the same email, is signed in; an unknown email creates a new account.
- **Actors & access:** guests (`guest` + `NoStoreResponse`). Provider must be one of `google`, `facebook` (route constraint) AND enabled (`social_{p}_enabled`) AND have client id + secret saved, else redirect to `/login` with "That sign-in method is not available."
- **UX & screens:** `auth/_social.blade.php` renders one button per live provider (2-column grid when both, plus an "or with email" divider); nothing when none is live. After consent the user lands per WD-AUTH-001 landing rules but without `intended`.
- **Endpoints:**

| Endpoint                     | Route name      | Handler                       | Middleware             | Request                     | Response                |
| ---------------------------- | --------------- | ----------------------------- | ---------------------- | --------------------------- | ----------------------- |
| GET auth/{provider}/redirect | social.redirect | SocialAuthController@redirect | guest, NoStoreResponse | provider in google,facebook | 302 to provider consent |
| GET auth/{provider}/callback | social.callback | SocialAuthController@callback | guest, NoStoreResponse | code, state, error          | redirect (see rules)    |

- **Data:** `users.social_provider` (google|facebook), `users.social_provider_id` (index only, not unique), `users.avatar_path` (may hold an absolute provider avatar URL), `users.email_verified_at`. Session keys `social_oauth_state`, `social_oauth_provider`.
- **Rules & edge cases:**
  1. Redirect: 40-char random `state` stored in session; Google scope `openid email profile`, `access_type=online`, `prompt=select_account`; Facebook API v19.0 scope `email,public_profile`. Redirect URI is `url('/auth/{provider}/callback')` (must be registered in the provider console; the admin screen shows it with a Copy button).
  2. Callback: provider `error` param -> "Sign-in was cancelled."; state missing or mismatching the session value (single use, `pull`) -> "Sign-in expired - please try again."; token/profile fetch failure (15 s timeouts, any exception logged) -> "Could not complete <Provider> sign-in. Please try again."
  3. Profile normalisation: Google `sub`, `email`, `name` (fallback given_name, then "Google user"), `picture`; Facebook `id`, `name`, `email` (may be absent), `picture.data.url` (256px).
  4. Account resolution order: (a) `social_provider` + `social_provider_id` match (active rows only) -> log in and backfill avatar if empty; (b) email match INCLUDING soft-deleted rows -> restore if trashed, set provider ids, set `email_verified_at` if empty, backfill avatar, log in; (c) no email from provider -> reject with "Your <Provider> account did not share an email address ... Use email & password instead."; (d) create user: name from profile (fallback email local part), lowercase email, random 48-char password (hashed), `role = user`, `email_verified_at = now`, provider ids, avatar URL.
  5. Race guard: a unique-constraint failure on create re-resolves including trashed rows and links/restores instead of erroring.
  6. `Auth::login($user, remember = true)` always remembers; session id regenerated. QUIRK: social sign-in never asks for the TOTP second factor, does not set the `auth.remember` flag, does not attribute referrals, does not create a workspace (the onboarding gate below does), and has no reCAPTCHA.
  7. Landing after success: platform role -> `/admin`; zero workspaces -> `/register/workspace`; else agent/viewer -> `/team-inbox`, others -> dashboard. Mobile number is empty for social accounts, so the workspace step requires it (WD-AUTH-008).
  8. QUIRK: linking by email trusts the provider's email as verified (Facebook emails are not always verified). Restoring a soft-deleted account through Google re-activates a user who was scrubbed only if the email still matches (after deletion the email is rewritten, so this rarely triggers).
- **Async & events:** `Login` event side effects (WD-AUTH-017/018). No mail.
- **External systems:** Google `accounts.google.com/o/oauth2/v2/auth`, `oauth2.googleapis.com/token`, `openidconnect.googleapis.com/v1/userinfo`; Facebook `facebook.com/v19.0/dialog/oauth`, `graph.facebook.com/v19.0/oauth/access_token`, `graph.facebook.com/v19.0/me`. Credentials in admin settings (WD-AUTH-023), secrets encrypted.
- **Settings:** `social_google_enabled`, `social_google_client_id`, `social_google_client_secret`, `social_facebook_enabled`, `social_facebook_client_id`, `social_facebook_client_secret`. Mobile also reads `social_google_ios_client_id`, `social_google_android_client_id` (MOB).
- **Acceptance criteria:**
  - Given Google enabled with keys, when a guest opens `/auth/google/redirect`, then they are redirected to Google with a fresh state stored in session.
  - Given a callback whose state does not match, when it is processed, then no login occurs and the login page shows the expired message.
  - Given an existing email/password account with the same email, when the user completes Google sign-in, then they are signed into that same account and `social_provider_id` is stored.
  - Given a brand-new Google email, when consent completes, then a verified user exists with a random password and the user is sent to `/register/workspace`.
  - Given Facebook returns no email and no prior provider link, when the callback runs, then sign-in is refused with the no-email message.
  - Given provider disabled, when `/auth/facebook/redirect` is opened, then the user is sent back to `/login` with the not-available message.
- **Source refs:** `app/Http/Controllers/SocialAuthController.php`, `app/Services/SocialAuthService.php`, `resources/views/auth/_social.blade.php`, `app/Models/User.php`, `database/migrations/2026_06_03_090000_add_social_login_to_users.php`.
- **Port notes:** `apps/api/src/modules/auth` has a Clerk exchange that overlaps conceptually; decide whether social login is Clerk-brokered (then only the account-linking rules above matter) or a native OAuth adapter (provider-adapter skill). Keep the state check, the trashed-account handling analogue (users are hard-deleted with audit per ADR-0009, so that branch disappears), and add a unique index on (provider, provider_id) which WaDesk lacks. Also apply the 2FA challenge to social logins.

### WD-AUTH-005 — Sign-up: account creation (step 1)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-AUTH-003, WD-AUTH-015, WD-AUTH-019
- **Summary:** `/register` collects name, email, mobile (with country picker), optional referral code, password + confirmation and Terms acceptance, creates the user, signs them in and sends them to workspace creation. If the admin enabled registration OTP the account is created only after the WhatsApp code is verified (WD-AUTH-006).
- **Actors & access:** guests (`guest` + `NoStoreResponse`). No plan gate. QUIRK: the general-settings toggle `public_registration` is never checked, so registration cannot be closed (WD-AUTH-019).
- **UX & screens:** `auth/register.blade.php` (variant 1 = split showcase using `auth/_register_showcase.blade.php`, variants 2-5 = `components/auth-shell.blade.php`), form partial `auth/_register_form.blade.php` titled "Step 1 of 3 / Create account" with a 3-step progress list. Fields: Full name, Work email, Mobile number (intl-tel-input with flags, dial code written to hidden `country_code`, default country from `<meta name="default-country-iso/code">`, i.e. admin setting `default_country_*`), Referral code (optional, max 16, prefilled from `?ref=` or the `wadesk_ref` cookie, uppercased), Password (min 8 hint, eye toggle), Confirm password, "I agree to Terms and Privacy policy" checkbox, reCAPTCHA, social buttons (compact) above, link to Sign in. JS: `resources/js/charts/auth-register.js`. The unrouted `auth/register/step1.blade.php` is a dead earlier design.
- **Endpoints:**

| Endpoint      | Route name | Handler                          | Middleware             | Request                                                                        | Response                                                |
| ------------- | ---------- | -------------------------------- | ---------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------- |
| GET register  | register   | AuthPagesController@showRegister | guest, NoStoreResponse | optional ref                                                                   | register view                                           |
| POST register | -          | AuthPagesController@register     | guest, NoStoreResponse | name, email, mobile, country_code, password, password_confirmation, agree, ref | redirect to `/register/workspace` or `/register/verify` |

- **Data:** writes `users` (see Data model): `name`, `email`, `mobile`, `country_code`, hashed `password`, `role = 'user'`, `email_verified_at` (now when auto-verify), `mobile_verified_at` (now only when proven by OTP), `referral_code` auto-generated on create (10 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, unique loop). Reads `system_settings.auto_verify_email`. Referral: `referrals` + wallet credit via ReferralService (CPN).
- **Rules & edge cases:**
  1. Validation: `name` required string max 191; `email` required, email, max 191, unique in `users` (includes soft-deleted rows; deleting an account rewrites the email so it is freed); `mobile` nullable string max 32; `country_code` nullable string max 8; `password` required string min 8 confirmed; `agree` accepted ("You must agree to the Terms of Service."); `ref` nullable string max 16.
  2. QUIRK: the admin password-strength policy (WD-AUTH-035) is NOT applied here (only min 8). Mobile is optional server-side (the HTML form marks it required) unless registration OTP is active, in which case mobile and country code are required ("A mobile number is required to verify your account."). Mobile is stored as typed (no whitespace stripping, no uniqueness, no E.164 normalisation). Email is not lowercased.
  3. reCAPTCHA is checked after validation (WD-AUTH-003).
  4. Referral: code taken from the form, else the `wadesk_ref` cookie (set by the `CaptureReferral` middleware from `?ref=`, sanitised to A-Z0-9, max 16 chars, 30 days, httpOnly, lax). `ReferralService::findReferrer` (uppercased match on `users.referral_code`, excluding the new user) then `attribute()` awards the configured signup credits once (unique per referred user); the cookie is cleared on success. Unknown codes are silently ignored.
  5. `email_verified_at` = now when `auto_verify_email` is true (default true; seeded as `1`); otherwise null and the verification mail is sent synchronously right after login (WD-AUTH-015); a send failure is ignored here, the user just sees the gate later.
  6. After create: `Registered` event (no listeners), `Auth::login` (not remembered), session id regenerated, redirect `/register/workspace`. No welcome notification, no `password_changed_at`, no `site_name` (the dead controller did all three).
  7. QUIRK: with OTP active the raw validated password (plus name/email/mobile/ref) is kept in the session under `pending_registration` until verification (session store is not encrypted by default). Do not replicate; hash before staging.
  8. Marketing copy on the left ("Free for 14 days ...") is static text and does not follow `registration_trial_days`.
- **Async & events:** `Registered`, `Login` (audit `auth.login`), possible verification email (WD-AUTH-015).
- **External systems:** reCAPTCHA (optional). Referral credit is internal.
- **Settings:** `auto_verify_email`, `registration_otp_enabled` (+ knobs, WD-AUTH-007), `recaptcha_*`, `default_country_code`, `default_country_iso`, `privacy_terms_url`, `privacy_policy_url`, `referral_signup_credits` (CPN).
- **Acceptance criteria:**
  - Given valid fields and auto-verify on, when the form is posted, then a user with role `user` and `email_verified_at` set exists, the visitor is signed in and redirected to `/register/workspace`.
  - Given an email already used, when posted, then validation fails on `email` and no user is created.
  - Given password and confirmation that differ, then validation fails on `password`.
  - Given `?ref=ABC123` earlier in the visit and a matching referrer, when registration completes, then a referral row exists for the new user and the referrer is credited once, and the cookie is removed.
  - Given auto-verify off, when registration completes, then `email_verified_at` is null, a verification email is attempted, and other pages redirect to `/account/verify-email`.
  - Given the agree box unticked, then validation fails with the Terms message.
- **Source refs:** `app/Http/Controllers/AuthPagesController.php`, `app/Http/Middleware/CaptureReferral.php`, `app/Services/ReferralService.php`, `app/Models/User.php`, `resources/views/auth/register.blade.php`, `resources/views/auth/_register_form.blade.php`, `resources/views/auth/_register_showcase.blade.php`, `resources/js/charts/auth-register.js`, `Documentation/pages/security/authentication.html`.
- **Port notes:** target flow must create the org and its first user together (owner) rather than a global user first; apply the password policy (WaDesk skips it), normalise the phone to E.164, decide uniqueness. Sign-up should be an unauthenticated `POST /v2/auth/register` in `apps/api/src/modules/auth`, contracts in `@crm/contracts`. Referral attribution goes through the outbox to CPN.

### WD-AUTH-006 — Sign-up WhatsApp OTP verification and resend

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-AUTH-005, WD-AUTH-007
- **Summary:** When enabled, the sign-up form does not create the account. It sends a numeric code to the visitor's WhatsApp number and asks for it on `/register/verify`; only a correct code creates the user (verify-before-create, no ghost accounts). The account is stamped `mobile_verified_at`.
- **Actors & access:** guests mid-signup only (`guest`, `NoStoreResponse`; verify is throttled 10/min, resend 5/min per client). Reachable only while `pending_registration` exists in the session, otherwise redirects to `/register` with "Please start registration again."
- **UX & screens:** `auth/register/verify.blade.php` (variant-aware chrome) + `auth/register/_verify_form.blade.php`: masked number "<dial> •••• ••<last 2 digits>", 4-8 digit code input (`maxlength 8`, numeric, one-time-code autocomplete, autofocus), "The code expires in N minutes", "Verify & continue", "Resend code" (separate POST form), "Wrong number? Go back" link to `/register`. Status flash "A new code is on its way to your WhatsApp."
- **Endpoints:**

| Endpoint                    | Route name             | Handler                               | Middleware                            | Request                      | Response                                                                     |
| --------------------------- | ---------------------- | ------------------------------------- | ------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| GET register/verify         | register.verify        | AuthPagesController@showRegisterOtp   | guest, NoStoreResponse                | -                            | verify view (masked, ttlMinutes, cooldown, sinceSent)                        |
| POST register/verify        | -                      | AuthPagesController@verifyRegisterOtp | guest, NoStoreResponse, throttle:10,1 | code (required string max 8) | account created + redirect `/register/workspace`, or back with `errors.code` |
| POST register/verify/resend | register.verify.resend | AuthPagesController@resendRegisterOtp | guest, NoStoreResponse, throttle:5,1  | -                            | back with status or error                                                    |

- **Data:** session key `pending_registration` = { data (validated signup fields), otp_hash (bcrypt of the code), expires_at (ISO), attempts, last_sent_at }. On success writes `users.mobile_verified_at`. No DB table for codes.
- **Rules & edge cases:**
  1. Activation (`RegistrationOtpService::isActive`): setting `registration_otp_enabled` true AND a resolvable sender AND, for WABA senders, the selected template exists with `meta_status = APPROVED`. Otherwise sign-up silently skips OTP.
  2. Send at sign-up: after validation + captcha, mobile and country code are required; a code of `registration_otp_length` digits (clamped 4-8, default 6, cryptographically random, zero-padded) is generated, sent, and only its hash is stored. Send failure returns the error on the `mobile` field (fallback "We could not send the verification code. Please try again.").
  3. Verify checks in order: expired (`expires_at` past) -> "That code has expired. Please request a new one."; attempts >= max (`registration_otp_max_attempts`, default 5) -> "Too many attempts. Please request a new code."; wrong code (input trimmed) -> increments attempts, "Incorrect code. Please try again."; correct -> clear the session key and run the same finalisation as WD-AUTH-005 with `mobile_verified_at = now`.
  4. Resend: refused within `registration_otp_resend_cooldown_sec` (min 15, default 60) of the last send ("Please wait a moment before requesting another code."); a new code resets hash, expiry, attempts=0 and `last_sent_at`.
  5. TTL: `registration_otp_ttl_minutes` if > 0, else the template's `code_expiration_minutes`, capped at 90, default 5.
  6. Send transport by sender kind (`registration_otp_sender` = `device:<id>` | `waba:<id>` | `twilio:<id>`; legacy `registration_otp_device_id` = device): Unofficial/Baileys posts to the Node bridge `/api/send-message/<sender number>` with header `X-Node-Token`, body `{targetPhoneNumber, message}`, server URL from the workspace baileys config else `baileys_server_url` setting else env `SERVER_URL`; WABA sends the approved authentication template through `TemplateSender` with variable `otp`; Twilio posts a WhatsApp message through the Twilio Messages API (From `whatsapp:<from_number>`, To `whatsapp:+<digits>`). Message text = template body with `{{1}}`/`{{code}}`/`{{otp}}` replaced, else "_<code>_ is your <app name> verification code. It expires in N minutes. Do not share it with anyone."
  7. Destination = digits of `country_code` + `mobile`; empty -> "Invalid phone number.".
  8. QUIRK: the session-staged data includes the plaintext password (see WD-AUTH-005 rule 7). The mobile number is not checked for uniqueness or previous use; nothing prevents OTP cost abuse beyond the per-IP throttles and the per-session cooldown (a client that discards its session cookie can request unlimited sends, each costing a WhatsApp message).
- **Async & events:** outbound WhatsApp send is synchronous inside the request (Node bridge 20 s timeout, Twilio 20 s). Errors logged as `[REG-OTP]`.
- **External systems:** Node bridge (X-Node-Token, `node_webhook_token` secret), Meta Cloud API via TemplateSender (WABA), Twilio Messages API (account_sid/auth_token/from_number from `wa_provider_configs` creds).
- **Settings:** `registration_otp_enabled`, `registration_otp_sender`, `registration_otp_template_id`, `registration_otp_ttl_minutes`, `registration_otp_length`, `registration_otp_resend_cooldown_sec`, `registration_otp_max_attempts` (all editable in the channel-settings screen, WD-AUTH-007).
- **Acceptance criteria:**
  - Given OTP active and valid sign-up fields, when the form is posted, then no user row exists yet, a code is sent, and the visitor is redirected to `/register/verify` showing a masked number.
  - Given the correct code before expiry, when submitted, then the user is created with `mobile_verified_at` set, signed in and redirected to `/register/workspace`.
  - Given 5 wrong codes, when a 6th (even correct) is submitted, then it is refused until "Resend code" issues a new one.
  - Given a resend within 60 seconds of the previous send, then it is refused with the wait message.
  - Given OTP enabled but the WABA template not APPROVED, when signing up, then registration proceeds with no OTP step.
  - Given a code older than its TTL, when submitted, then the expired message shows.
- **Source refs:** `app/Services/Auth/RegistrationOtpService.php`, `app/Http/Controllers/AuthPagesController.php`, `resources/views/auth/register/verify.blade.php`, `resources/views/auth/register/_verify_form.blade.php`, `database/migrations/2026_08_14_100000_add_mobile_verified_at_to_users_table.php`.
- **Port notes:** stage the pending signup server-side (Redis with TTL, or an `auth_challenges` table) storing an argon2 hash of the code, attempts and the pre-hashed password; send through the WhatsApp provider port owned by WADEV/WABA (`apps/api/src/modules/inbox` outbound path) rather than the Node bridge. The same service is reused by the mobile 2FA (MOB), so expose it as an injectable `OtpService`. Add per-number and per-IP send limits WaDesk lacks.

### WD-AUTH-007 — Registration OTP admin setup and template creation

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-AUTH-006
- **Summary:** In Admin -> Settings -> Channel settings the super-admin turns registration OTP on, picks which connected number sends the code (Unofficial device, WABA number or Twilio number), tunes the code knobs, and can one-click create the OTP message/template. WABA templates are submitted to Meta for approval; Unofficial/Twilio ones are created already approved.
- **Actors & access:** platform admin (admin route group: `Authenticate`, `EnsureUserIsAdmin`, `IPAllowlist`). The permission seeds contain no key for this screen.
- **UX & screens:** a section of `resources/views/admin/settings/channel-setting.blade.php` (owned by SET/WADEV, shared here): enable toggle, sender dropdown, template dropdown/creator, validity minutes, code length, resend cooldown, max attempts, and a "Create & submit template" button that posts the WHOLE form to the create-template route. Flash messages: "Pick a sender channel first, then create the template.", "OTP message created and approved - no Meta review needed for this channel. It is ready to use now.", "OTP template created and submitted to Meta for approval. It activates automatically once approved (usually a few minutes)." and Meta error variants.
- **Endpoints:**

| Endpoint                                         | Route name                         | Handler                                | Middleware                                   | Request                                                                                                                                                                                                         | Response                        |
| ------------------------------------------------ | ---------------------------------- | -------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| POST admin/settings/channel-setting/otp-template | admin.settings.otp-template.create | AdminPagesController@createOtpTemplate | Authenticate, EnsureUserIsAdmin, IPAllowlist | registration_otp_sender (device:ID / waba:ID / twilio:ID), registration_otp_enabled, registration_otp_ttl_minutes, registration_otp_length, registration_otp_resend_cooldown_sec, registration_otp_max_attempts | redirect back with status/error |

The plain save of these knobs rides on `POST admin/settings/providers` (`settingsProvidersUpdate`, a shared channel-settings save owned by SET) with the same field names.

- **Data:** writes `system_settings` keys above; creates/updates a `wa_templates` row named `wadesk_registration_otp` (WABA) or `wadesk_registration_otp_local` (Unofficial/Twilio) in the sender's workspace.
- **Rules & edge cases:**
  1. Sender string must be `device|waba|twilio:<positive id>` else the error above.
  2. Knob clamping on every save: TTL 1-90 (empty -> 5), length 4-8 (else 6), resend cooldown 15-600 (else 60), max attempts 1-20 (else 5). Empty fields never save as 0. On a plain save an empty `registration_otp_template_id` (0) keeps the existing template id.
  3. Unofficial/Twilio: template created/updated as category utility, body "{{1}} is your verification code. It expires in N minutes.", language en_US, `meta_status = APPROVED`, `status = approved`; workspace taken from the device or twilio config.
  4. WABA: template category authentication, type auth, body "{{1}} is your verification code.", one `otp_copy` button "Copy code", `code_expiration_minutes = ttl`, language en_US; built by `TemplatePayloadBuilder` and submitted with `TemplateClient::submit`; on success stores `meta_template_id`, `meta_status` (default PENDING), `submitted_at`, `status = pending`; an empty returned id -> error; exceptions -> "Could not submit the template to Meta: ...". Approval is picked up by the normal template status sync (TPL/WABA); OTP activates automatically once `APPROVED`.
  5. Selecting a sender does not verify the sender is connected; an unusable sender simply keeps OTP inactive or fails at send time.
- **Async & events:** Meta template submission is a synchronous HTTP call; later status via the template poll/webhook (TPL).
- **External systems:** Meta Graph `message_templates` (WABA), credentials in `wa_provider_configs`.
- **Settings:** the seven `registration_otp_*` keys plus legacy `registration_otp_device_id`.
- **Acceptance criteria:**
  - Given a WABA sender selected, when "Create & submit template" is clicked, then a pending authentication template exists with the otp_copy button and the OTP knobs are saved in the same request.
  - Given an Unofficial device selected, when the button is clicked, then an approved local template exists and OTP is immediately active (if enabled).
  - Given TTL field empty, when saved, then TTL is stored as 5, never 0.
  - Given no sender chosen, when the button is clicked, then the pick-a-sender error shows and nothing is created.
- **Source refs:** `app/Http/Controllers/AdminPagesController.php` (createOtpTemplate, settingsProvidersUpdate), `app/Services/Auth/RegistrationOtpService.php`, `resources/views/admin/settings/channel-setting.blade.php`.
- **Port notes:** the screen belongs to the platform-settings UI (SET); this domain owns only the OTP service contract and defaults. Templates for authentication are a WABA (TPL) concern - reuse the template submission module rather than copying the builder.

### WD-AUTH-008 — Onboarding step 2: first workspace

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-AUTH-005, WD-AUTH-019
- **Summary:** Right after sign-up (or a first login/social login with no workspace) the user names their workspace. The workspace is created on the admin-chosen default plan, the user becomes its owner and current workspace, and they move on to the plan step.
- **Actors & access:** authenticated users (`Authenticate`; the `EnsureUserActive` allowlist keeps this route reachable before email verification). No plan gate at this step. QUIRK: any signed-in user can post this route repeatedly, i.e. create extra workspaces without hitting `workspaces_per_owner_limit` (the limit is only enforced in `WorkspacesController::store`, owned by WSP).
- **UX & screens:** `auth/register/step2.blade.php` + `_step2_form.blade.php` ("Step 2 of 3 / Workspace"): "Already have" list of existing workspaces with a Continue link to `/register/plan`, Workspace name (max 120, suggested "<Email local part title-cased>'s workspace"), Industry select (ecommerce, saas, agency, education, healthcare, finance, travel, hospitality, other), Team size select (1, 2-5, 6-20, 21-100, 100+), Timezone searchable combobox (all IANA ids with UTC offset, cached 1 day; default = setting `default_timezone`), and Mobile number ONLY when the account has none (social accounts). JS `auth-register-step2.js` (Tom Select).
- **Endpoints:**

| Endpoint                | Route name               | Handler                          | Middleware   | Request                                                                                                                                                                                                                   | Response                                            |
| ----------------------- | ------------------------ | -------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| GET register/workspace  | register.workspace       | AuthController@showWorkspaceStep | Authenticate | -                                                                                                                                                                                                                         | step 2 view (existing, suggested_name, need_mobile) |
| POST register/workspace | register.workspace.store | AuthController@storeWorkspace    | Authenticate | name (required, max 120), industry (max 64), size_range (max 32), timezone (max 64), brand_color (max 16), mobile (regex `^[0-9()+\-\s]{6,20}$`, max 20) and country_code (max 8) required only if the user has no mobile | redirect to `/register/plan` with status            |

- **Data:** creates `workspaces` (owner_user_id, name, slug, industry, size_range, timezone, plan, status = true, last_active_at, trial_ends_at, billing_cycle, brand_color only when supplied); inserts `workspace_user` (role `owner`, joined_at now); updates `users.current_workspace_id`, and `users.mobile`/`country_code` when supplied; in-app notification "Workspace created".
- **Rules & edge cases:**
  1. Default plan resolution: `registration_default_plan_id` (package `plan_id` with status 1) -> else a package flagged `is_default` -> else first active free plan (free flag, or amount 0 and not custom-quote) ordered by `sort_order` -> else slug `starter`.
  2. If the resolved package is free (`isFreePlan()`), and `registration_trial_days` > 0 (default 14), then `trial_ends_at = now + days` and `billing_cycle = 'trial'`; 0 days = no expiry, no bar. Paid plans never get a trial.
  3. Slug from `Workspace::generateSlug(name)` (pre-checked unique); on a unique-violation of `workspaces_slug_unique` it retries up to 5 times with `slug-<6 random>`, then falls back to `workspace-<userId>-<random>`; other unique violations rethrow.
  4. `brand_color` is only set when provided (the column is NOT NULL with default `#075E54`; passing null used to 500).
  5. Timezone default: posted value, else setting `default_timezone`, else `Asia/Kolkata`. The value is not validated against the IANA list here.
  6. Mobile is only overwritten when supplied; unauthenticated post redirects to `/login`.
  7. Owner attach + `switchWorkspace` (audit `workspace.entered` when the id changed).
- **Async & events:** in-app notification (NOTIF) `Workspace created` (category system, success, action url /dashboard); audit `workspace.entered`.
- **External systems:** none.
- **Settings:** `registration_default_plan_id`, `registration_trial_days`, `default_timezone`.
- **Acceptance criteria:**
  - Given a freshly registered user, when they post a workspace name, then a workspace exists owned by them, membership role owner, `current_workspace_id` points to it, and they are redirected to `/register/plan`.
  - Given the default plan is free and trial days 14, then `trial_ends_at` is about now+14 days and `billing_cycle` is `trial`.
  - Given two concurrent creations with the same name, then both succeed with distinct slugs.
  - Given a social-login user without mobile, when they omit the mobile fields, then validation fails with "A mobile number is required.".
  - Given an unauthenticated visitor, when posting the route, then they are redirected to `/login`.
- **Source refs:** `app/Http/Controllers/AuthController.php`, `resources/views/auth/register/step2.blade.php`, `resources/views/auth/register/_step2_form.blade.php`, `resources/js/charts/auth-register-step2.js`, `app/Models/Workspace.php`.
- **Port notes:** in the target the org is created at sign-up (WD-AUTH-005); this step becomes "workspace/org profile" on first login, writing industry/size/timezone. Plan assignment and trial belong to PLAN/WSP; call their service instead of copying package lookups. RLS: the first workspace row is inserted before a tenant context exists, so create it inside a privileged provisioning transaction.

### WD-AUTH-009 — Onboarding step 3: plan picker / skip

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-AUTH-008
- **Summary:** The last onboarding screen lists active subscription plans (with price, message allowance, three feature chips) and links each to checkout, or lets the user continue free.
- **Actors & access:** authenticated users (reachable while unverified via the `EnsureUserActive` allowlist).
- **UX & screens:** `auth/register/step3.blade.php` + `_step3_form.blade.php` ("Step 3 of 3 / Plan"): explainer with `credits_per_message` ("extra sends use wallet credits at N credit(s)/message"), plan cards (name, subtitle, price after currency conversion to the workspace currency, offer price with strike-through, period, monthly message limit or Unlimited, up to 3 of: Analytics, Automation, AI assistants, WooCommerce, Shopify, WhatsApp calling, White-label), highlighted card badge, empty state "No plans configured yet ...", "Start free / skip for now" and a "Top up message credits" link (first active credit package checkout, else `/account?tab=wallet`).
- **Endpoints:**

| Endpoint                | Route name         | Handler                     | Middleware   | Request | Response                          |
| ----------------------- | ------------------ | --------------------------- | ------------ | ------- | --------------------------------- |
| GET register/plan       | register.plan      | AuthController@showPlanStep | Authenticate | -       | step 3 view                       |
| POST register/plan/skip | register.plan.skip | AuthController@skipPlanStep | Authenticate | -       | redirect `/dashboard` with status |
| GET register/plan/skip  | -                  | AuthController@skipPlanStep | Authenticate | -       | same                              |

- **Data:** reads `packages` (active, `sort_order` then `plan_amount`), `credit_packages`, workspace currency (falls back to `default_currency` setting). No writes; the free/skip choice does nothing (the plan was already set in WD-AUTH-008).
- **Rules & edge cases:**
  1. Free plan card = `free` flag or amount 0 -> links to skip; custom-quote plan -> `/support`; paid plan -> `route('user.checkout.show', packageId)` (CHK/PLAN).
  2. Skip is a GET or POST with no side effect; message "Welcome - top up credits any time from your wallet."
  3. `/dashboard` follows the trial/plan gates (EnsureTrialActive, PLAN).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `credits_per_message`, `default_currency`.
- **Acceptance criteria:**
  - Given active plans exist, when the page loads, then each renders with a converted price and links to checkout.
  - Given no plans, then the empty state and the free-continue button show.
  - Given the user clicks Start free, then they land on `/dashboard` with the welcome flash.
- **Source refs:** `app/Http/Controllers/AuthController.php`, `resources/views/auth/register/step3.blade.php`, `resources/views/auth/register/_step3_form.blade.php`.
- **Port notes:** presentation-only; source plan data from the PLAN domain's public plans endpoint. Keep it optional in onboarding.

### WD-AUTH-010 — Workspace switch

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-AUTH-008
- **Summary:** A signed-in user with several workspaces switches the active one from the top bar; every workspace-scoped screen then reads that workspace.
- **Actors & access:** authenticated members of the target workspace only. Disabled on a white-label tenant domain.
- **UX & screens:** top-bar workspace dropdown (layout components, WSP) posts here; flash "Switched to <name>." or errors.
- **Endpoints:**

| Endpoint                    | Route name        | Handler                        | Middleware   | Request | Response               |
| --------------------------- | ----------------- | ------------------------------ | ------------ | ------- | ---------------------- |
| POST workspaces/{id}/switch | workspaces.switch | AuthController@switchWorkspace | Authenticate | id      | back with status/error |

- **Data:** updates `users.current_workspace_id`, `workspaces.last_active_at`; audit row `workspace.entered` (from -> to) when the id changes.
- **Rules & edge cases:**
  1. Unauthenticated -> `/login`.
  2. On a tenant domain (`ResolveTenantDomain::isTenant()`) -> back with "Workspace switching is disabled on this domain." (the middleware would re-force the tenant workspace anyway).
  3. Non-member -> "You are not a member of that workspace."; membership is checked via `workspace_user`.
  4. QUIRK: workspace pages under `/{slug}` (WSP closure route) also switch the user but only on top-level navigations (`Sec-Fetch-Dest: document`); this route is a POST so CSRF protects it.
- **Async & events:** audit `workspace.entered`.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a user in workspaces A and B (current A), when they post switch to B, then `current_workspace_id` = B and the flash names B.
  - Given a user who is not a member of C, when they post switch to C, then the error shows and nothing changes.
  - Given a request from a tenant custom domain, then switching is refused.
- **Source refs:** `app/Http/Controllers/AuthController.php`, `app/Models/User.php` (switchWorkspace), `app/Http/Middleware/ResolveTenantDomain.php`.
- **Port notes:** in the target, "current workspace" is usually a claim on the access token or an `X-Workspace-Id` header rather than a mutable user column; provide a token re-issue on switch. Membership check must go through RLS-scoped queries. Overlaps WSP.

### WD-AUTH-011 — Authenticated home router and guest redirect

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-AUTH-001
- **Summary:** `/home` is the in-app router: a signed-in visitor is sent to the admin console, the Team Inbox or the dashboard by role. It is also where Laravel's `guest` middleware bounces an already-signed-in user who opens `/login`, `/register`, `/forgot-password` etc.
- **Actors & access:** authenticated users (`Authenticate`).
- **UX & screens:** no screen, pure redirect.
- **Endpoints:**

| Endpoint | Route name | Handler                   | Middleware   | Request | Response |
| -------- | ---------- | ------------------------- | ------------ | ------- | -------- |
| GET home | home       | closure in routes/web.php | Authenticate | -       | 302      |

- **Data:** reads `users.role`, Spatie roles, workspace role.
- **Rules & edge cases:**
  1. Platform admin = `User::isAdmin()` (Spatie `Super Admin` or `Admin`, or legacy `users.role` in admin/A) OR `users.role` in admin, super-admin, super_admin, platform-admin -> `/admin`.
  2. Workspace role agent/viewer -> `/team-inbox`; else `/dashboard`.
  3. QUIRK: `/admin` landing here is broader than the login landing (which uses only the three platform Spatie roles): an `Admin` who logs in lands on the dashboard/workspace flow, then is sent to `/admin` if they visit `/home` again.
  4. No custom `redirectUsersTo` is configured; Laravel picks the named route `home` for the guest bounce.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a signed-in agent, when they open `/login`, then they end up on `/team-inbox`.
  - Given a signed-in Super Admin, when they open `/register`, then they end up on `/admin`.
  - Given a signed-in owner, `/home` sends them to `/dashboard`.
- **Source refs:** `routes/web.php`, `bootstrap/app.php`.
- **Port notes:** becomes a client-side (`apps/web`) redirect after reading `/me`. Keep one canonical "landing for principal" function shared with WD-AUTH-001.

### WD-AUTH-012 — Sign out

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-AUTH-020
- **Summary:** Ends the session completely and returns to the login page. Both POST (form) and GET (stray links, bookmarks) work.
- **Actors & access:** authenticated users (`Authenticate`).
- **UX & screens:** logout buttons on the user/admin layouts and on the suspended / verify-email lock pages (POST form with CSRF). GET is accepted deliberately ("only lets an attacker sign you out").
- **Endpoints:**

| Endpoint    | Route name | Handler                    | Middleware   | Request | Response          |
| ----------- | ---------- | -------------------------- | ------------ | ------- | ----------------- |
| GET logout  | logout     | AuthPagesController@logout | Authenticate | -       | redirect `/login` |
| POST logout | logout     | AuthPagesController@logout | Authenticate | -       | redirect `/login` |

- **Data:** deletes/invalidates the session row; regenerates the CSRF token; `Logout` event writes audit `auth.logout`.
- **Rules & edge cases:**
  1. `Auth::logout()`, `session()->invalidate()`, `regenerateToken()`, redirect to the named `login` route. The remember cookie is cleared by the guard.
  2. A logout POST that hits a CSRF 419 (stale page) is completed anyway by the global 419 handler and redirects to login with "You have been signed out." (WD-AUTH-020).
  3. Other devices' sessions and API tokens are untouched.
- **Async & events:** audit `auth.logout` (payload guard).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a signed-in user, when they post `/logout`, then the session row is gone and `/dashboard` redirects to login.
  - Given a GET to `/logout` while signed in, then they are signed out.
  - Given a stale CSRF token on the logout form, then the user still ends up on `/login` signed out.
- **Source refs:** `app/Http/Controllers/AuthPagesController.php`, `routes/web.php`, `bootstrap/app.php` (graceful 419), `app/Providers/AppServiceProvider.php`.
- **Port notes:** revoke the refresh token family server-side (WaDesk revokes a session row); provide "log out all my devices" through WD-AUTH-031.

### WD-AUTH-013 — Forgot password (request reset link)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-AUTH-020
- **Summary:** A guest enters their email on `/forgot-password` and always gets the same neutral confirmation, whether or not the address exists. If it does, Laravel's password broker emails a single-use reset link valid for 60 minutes.
- **Actors & access:** guests (`guest`, `NoStoreResponse`). Not captcha-protected.
- **UX & screens:** `auth/forgot-password.blade.php` (variant-aware) + `auth/_forgot_form.blade.php`: eyebrow "Forgot password", heading "Reset your password", one email field, "Email reset link" button, "Back to sign in" link. Flash status shown in a green box. Left-panel copy `auth.forgot.*` (default text promises a link valid 60 minutes).
- **Endpoints:**

| Endpoint             | Route name       | Handler                                | Middleware             | Request                 | Response                                                                     |
| -------------------- | ---------------- | -------------------------------------- | ---------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| GET forgot-password  | password.request | AuthPagesController@showForgotPassword | guest, NoStoreResponse | -                       | view                                                                         |
| POST forgot-password | password.email   | AuthPagesController@sendResetLink      | guest, NoStoreResponse | email (required, email) | back with status "A password-reset link has been sent if that email exists." |

- **Data:** `password_reset_tokens` (email PK, hashed token, created_at) via the framework broker (`config/auth.php`: table `password_reset_tokens`, `expire` 60 minutes, `throttle` 60 seconds).
- **Rules & edge cases:**
  1. The response is identical for sent, unknown user and throttled (the real broker status is only written to the log). No account-enumeration oracle.
  2. Broker throttle: a second request for the same email within 60 seconds does not send another mail (still shows the same message).
  3. The mail is the framework default reset notification (no custom mailable in this codebase), linking to `/reset-password/{token}?email=...`. Delivery uses the admin-configured mailer (`MailConfig`, SET). A fresh install may log mail instead of sending (docs warn about this).
  4. Only active (non-soft-deleted) users are found by the broker.
  5. There are no per-IP limits and no captcha, so the endpoint can be used to flood a victim with reset mails at the broker's per-email 60 s cadence.
  6. The `auth:clear-resets` artisan command (framework) purges expired tokens; it is not scheduled (`schedule.txt` is empty), so expired rows accumulate.
- **Async & events:** mail sent synchronously in the request (notification not queued unless `QUEUE` config changes it).
- **External systems:** SMTP/mailer configured in admin settings.
- **Settings:** `config/auth.php` passwords.users (expire 60, throttle 60), mail settings.
- **Acceptance criteria:**
  - Given a registered email, when submitted, then a token row exists and a reset mail is sent; the page shows the neutral message.
  - Given an unknown email, when submitted, then no mail is sent and the page shows the identical message.
  - Given two submissions within 60 s for the same email, then only one mail is sent.
- **Source refs:** `app/Http/Controllers/AuthPagesController.php`, `config/auth.php`, `resources/views/auth/forgot-password.blade.php`, `resources/views/auth/_forgot_form.blade.php`, `Documentation/pages/security/authentication.html`.
- **Port notes:** implement as `auth_challenges` (type password_reset, token hash, expires_at) in the auth module; send through the transactional email adapter (provider-adapter). Add rate limits per IP and per email; keep the neutral response.

### WD-AUTH-014 — Reset password (consume token)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-AUTH-013
- **Summary:** The emailed link opens a form (email, new password, confirmation). A valid token sets the new password, rotates every other credential of that user and sends them to login.
- **Actors & access:** guests (`guest`, `NoStoreResponse`); token from the email.
- **UX & screens:** `auth/reset-password.blade.php` (single design, not variant-aware): email prefilled from `?email=`, New password (min 8, eye toggle), Confirm password (eye toggle), "Save new password", copy says at least 8 characters.
- **Endpoints:**

| Endpoint                   | Route name      | Handler                               | Middleware             | Request                                                                                                 | Response                                                                                                |
| -------------------------- | --------------- | ------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| GET reset-password/{token} | password.reset  | AuthPagesController@showResetPassword | guest, NoStoreResponse | token, query email                                                                                      | view                                                                                                    |
| POST reset-password        | password.update | AuthPagesController@resetPassword     | guest, NoStoreResponse | token (required), email (required, email), password (required, min 8, confirmed), password_confirmation | redirect `/login` with "Password reset. Please sign in." or back with the broker status text on `email` |

- **Data:** updates `users.password` (hashed), `users.remember_token` (new random 60 chars), `users.password_changed_at = now`; deletes the user's Sanctum `personal_access_tokens`; deletes all the user's rows in `sessions`; broker deletes the token row.
- **Rules & edge cases:**
  1. Token validity (60 min, single use, tied to the email) is the framework broker's; invalid/expired -> error text from the broker translated, shown on the `email` field.
  2. QUIRK: the admin password-strength rule (WD-AUTH-035) is not applied on reset (only min 8 + confirmed).
  3. The user is NOT logged in after reset; they re-authenticate. `force_password_change` is not cleared here (it is unused anyway).
  4. Session/token purge failures are swallowed so a reset never fails because of them.
- **Async & events:** `PasswordReset` event -> audit `auth.password_reset`. No confirmation email or notification is sent to the user (WaDesk only notifies on the signed-in password change).
- **External systems:** none.
- **Settings:** none beyond WD-AUTH-013.
- **Acceptance criteria:**
  - Given a valid token and matching passwords, when submitted, then the password changes, all the user's sessions and API tokens are revoked and the user is redirected to login with the success flash.
  - Given an expired or reused token, when submitted, then the password is unchanged and an error shows.
  - Given a confirmation that does not match, then validation fails.
  - Given the reset succeeded, when an old remember-me cookie is presented, then it no longer authenticates.
- **Source refs:** `app/Http/Controllers/AuthPagesController.php`, `resources/views/auth/reset-password.blade.php`, `app/Providers/AppServiceProvider.php`.
- **Port notes:** on reset, bump the user's `token_version` (or delete refresh tokens) so all JWT families die; apply the password policy; send a "your password was changed" mail (WaDesk does not).

### WD-AUTH-015 — Email verification (link, resend, gate screen)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-AUTH-016
- **Summary:** When auto-verify is off, new users must click a signed link in an email before they can use the app. A verify-your-email screen offers "resend" and "sign out". Clicking the link verifies the account and signs the visitor in.
- **Actors & access:** the link works for anyone holding it (no auth needed); resend needs `Authenticate`. Behaviour depends on `auto_verify_email`.
- **UX & screens:** `auth/verify-email.blade.php` (standalone guest layout): "Please verify your email", shows the address, flash success/errors, "Resend" and "Sign out" buttons, help line with the mail-from address. Email `emails/verify-email.blade.php` (HTML, branded header, "Verify email" button) via `VerifyEmailMail` (subject "Verify your email - <app name>").
- **Endpoints:**

| Endpoint                     | Route name           | Handler                            | Middleware                         | Request            | Response                                                                         |
| ---------------------------- | -------------------- | ---------------------------------- | ---------------------------------- | ------------------ | -------------------------------------------------------------------------------- |
| GET verify-email/{id}/{hash} | verification.verify  | EmailVerificationController@verify | (none; must be a valid signed URL) | id (numeric), hash | redirect `/dashboard` with "Email verified - welcome!" or `/login` with an error |
| POST email/verify/resend     | verification.send    | EmailVerificationController@resend | Authenticate                       | -                  | back with success/error                                                          |
| GET account/verify-email     | account.verify-email | Illuminate\Routing\ViewController  | Authenticate                       | -                  | verify-email view                                                                |

- **Data:** `users.email_verified_at`. No token table: the URL is a temporary signed route (60 minutes) containing the user id and `sha1(email)`.
- **Rules & edge cases:**
  1. Verify: invalid/expired signature -> `/login` with "Verification link expired or invalid. Please request a new one."; unknown user -> "User not found."; hash not equal to `sha1(current email)` (constant-time) -> "Verification link no longer matches this account (email may have changed)."; otherwise stamp `email_verified_at` once.
  2. QUIRK: a valid link also LOGS THE VISITOR IN as that user when nobody is signed in, without password, 2FA, remember, or session regeneration, then redirects to `/dashboard`. The link is effectively a 60-minute passwordless login token.
  3. Resend: already verified -> "Your email is already verified."; otherwise `send()`; QUIRK: no rate limit on resend (each click sends a mail).
  4. `EmailVerificationController::send(User)` returns null on success or a short reason: no mailer configured; sender address empty or equal to `hello@example.com` ("sender address not set"); SMTP host/port missing; caught exceptions mapped to "SMTP authentication failed." / "SMTP connection refused." / "SMTP server timed out." / "mail transport error (see logs)." The mail is sent synchronously. The admin "resend" tool reuses this static method (ASHELL).
  5. After sign-up with auto-verify off the mail is fired automatically (WD-AUTH-005).
  6. Changing the email on the profile page does NOT unset `email_verified_at` and does not send a new verification (WD-AUTH-025), so a verified badge can point at an unverified address.
- **Async & events:** synchronous mail; failures logged as "Verification email failed for user N".
- **External systems:** SMTP per admin mail settings (`MailConfig`, SET).
- **Settings:** `auto_verify_email` (default true; seeded 1), `mail_from_address`, mailer config.
- **Acceptance criteria:**
  - Given auto-verify off and a new user, when the signed link is opened within 60 minutes, then `email_verified_at` is set and the user lands on `/dashboard` signed in.
  - Given a tampered or expired URL, then verification fails with the expired/invalid message.
  - Given the user changed their email after the link was issued, then the link is rejected by the hash check.
  - Given an unverified signed-in user, when they click Resend, then a mail is sent and the success flash names the address; with no mailer configured the failure reason shows.
- **Source refs:** `app/Http/Controllers/EmailVerificationController.php`, `app/Mail/VerifyEmailMail.php`, `resources/views/emails/verify-email.blade.php`, `resources/views/auth/verify-email.blade.php`, `routes/web.php`.
- **Port notes:** verification should be a single-use token (WaDesk's link is replayable within 60 minutes) and must not create a session by itself; instead redirect to login or exchange for a normal login. Emails through the email adapter (`MAIL`/platform mailer). Decide whether staff users (invited by admins) need verification at all.

### WD-AUTH-016 — Account lock gates (suspended, unverified)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-AUTH-015
- **Summary:** Every web request by a signed-in non-admin is checked: suspended accounts are locked to a "suspended" page and unverified accounts to the verify-email page, unless the route is on a short allowlist. Admins are exempt.
- **Actors & access:** middleware `EnsureUserActive`, appended to the whole `web` group.
- **UX & screens:** `auth/suspended.blade.php` ("Your account is currently suspended", greets by name, mailto the mail-from address, logout button) and `auth/verify-email.blade.php` (WD-AUTH-015).
- **Endpoints:**

| Endpoint              | Route name        | Handler                           | Middleware   | Request | Response       |
| --------------------- | ----------------- | --------------------------------- | ------------ | ------- | -------------- |
| GET account/suspended | account.suspended | Illuminate\Routing\ViewController | Authenticate | -       | suspended view |

- **Data:** reads `users.role`, `users.email_verified_at`, `system_settings.auto_verify_email`.
- **Rules & edge cases:**
  1. Skipped when the app is not installed (`storage/installed` missing) or nobody is signed in.
  2. Admin exemption: `users.role` in admin, super-admin, platform-admin (underscore `super_admin` is NOT exempt here, unlike Force2FA).
  3. Allowlisted route names: `account.suspended`, `account.verify-email`, `logout`, `verification.send`, `verification.verify`, `register.workspace`, `register.workspace.store`, `register.plan`, `register.plan.skip`.
  4. `role === 'suspended'` -> redirect to `account.suspended` (suspending an account is done in the admin Users screen, ASHELL/RBAC, by writing this role value).
  5. Unverified: if `auto_verify_email` is on (default true) the row is stamped verified on the fly and the request continues (this also fixes legacy rows); otherwise redirect to `account.verify-email`.
  6. Soft-deleted users never reach here (their session resolves to no user).
  7. Only web session requests; the REST API, mobile API and Node callbacks have their own auth and are not affected.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `auto_verify_email`.
- **Acceptance criteria:**
  - Given `role = suspended`, when the user opens `/dashboard`, then they are redirected to `/account/suspended`.
  - Given auto-verify off and an unverified user, when they open any app page, then they land on `/account/verify-email` but can still complete workspace and plan onboarding.
  - Given auto-verify on and an unverified legacy user, when they load a page, then `email_verified_at` becomes set and the page renders.
  - Given an admin with `role = admin`, then no gate applies.
- **Source refs:** `app/Http/Middleware/EnsureUserActive.php`, `bootstrap/app.php`, `resources/views/auth/suspended.blade.php`, `routes/web.php`.
- **Port notes:** implement as a Nest guard reading a `status` claim (`active|suspended`) and an `email_verified` flag; return a problem+json code the frontend maps to the lock screens. Suspension state should live on the user/org rather than the role column (WaDesk overloads `users.role`).

### WD-AUTH-017 — Login side effects: invite acceptance, audit, admin workspace

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-AUTH-001
- **Summary:** Whatever way a user signs in (password, social, remember-me re-auth), a framework `Login` listener activates any pending team invitations, writes the audit row, triggers the new-device alert and makes sure platform admins own a private workspace.
- **Actors & access:** system (event listener in `AppServiceProvider`).
- **UX & screens:** none; the visible effect is that an invited member stops showing as "pending" for the inviter.
- **Endpoints:** none (event driven). The Logout / Failed / PasswordReset listeners in the same provider write audit rows `auth.logout`, `auth.failed`, `auth.password_reset`.
- **Data:** `workspace_user.joined_at` (set to now where NULL for the user), `audit_logs` (action `auth.login` payload {guard, remember}, layer workspace, workspace = current), plus the alert lookup (WD-AUTH-018).
- **Rules & edge cases:**
  1. Signing in IS the invitation-accept step: every `workspace_user` row of the user with `joined_at IS NULL` is set to now (idempotent). The dead AuthController repeats this with diagnostic logging.
  2. `AdminWorkspaceProvisioner::ensureFor($user)` runs on every login and (per its docblock) creates a private workspace (name "<user name> Admin", industry Internal, owner pivot) for admin-role users who own none, then points them at it, so the rest of the app has a workspace scope; it is idempotent and runs on every login (ASHELL/WSP own the details).
  3. Each sub-step is wrapped in try/catch so a listener failure can never fail a login.
  4. `auth.failed` rows carry only the email-like identifier, never credentials, and are attributed to the found user id when known.
- **Async & events:** synchronous listeners; audit writes go through `AuditLogger::workspace` (NOTIF). Login events also fire on `Auth::login()` in registration and social flows.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a user invited to workspace W (joined_at null), when they sign in, then joined_at is set and the inviter sees them as active.
  - Given any successful sign-in, then an `auth.login` audit row exists with user id, IP and user agent.
  - Given an admin without a private workspace, when they first sign in, then one is provisioned.
- **Source refs:** `app/Providers/AppServiceProvider.php`, `app/Support/AdminWorkspaceProvisioner.php`, `app/Services/Inbox/AuditLogger.php`.
- **Port notes:** invitation acceptance in the target should be an explicit accept-token flow (WSP), not a side effect of login; keep the login audit event via outbox.

### WD-AUTH-018 — New-device / new-country login alert

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-AUTH-017, WD-AUTH-037
- **Summary:** After a sign-in the platform compares the browser/OS fingerprint and IP range with the user's previous login and emails them when either changed, telling them how to react.
- **Actors & access:** system; policy set by admins in the Security Center.
- **UX & screens:** plain-text email "New sign-in to your <app> account" (device change) or "New sign-in from a different location" (country change) listing time (UTC), IP, browser string, reasons, and a link to `/forgot-password` (or Settings -> Security if signed in). Toggles and channel radio in Security Center (Login and MFA tab).
- **Endpoints:** none.
- **Data:** reads the previous `audit_logs` row with action `auth.login` for the user (second most recent); writes an `auth.alert_emitted` audit row (result warning; payload reasons, channel, previous/current ip and truncated user agents).
- **Rules & edge cases:**
  1. No alert on the user's first-ever login (no previous row).
  2. New device = alerts enabled AND both UAs present AND fingerprints differ, where fingerprint = browser family (edge, chrome, firefox, safari, opera, other) + OS family (android, iphone, ipad, win10, win11, mac, linux, other).
  3. New country = alerts enabled AND IPs differ in the first two IPv4 octets (IPv6: first four hextets). There is no geo-IP database, so this is a same-network heuristic.
  4. Channels `email`, `whatsapp`, `both`: only email is implemented; the WhatsApp branch is an explicit stub (no send). Choosing `whatsapp` sends nothing.
  5. Dedup: at most one email per user + IP + UA per 10 minutes (cache add lock), because one sign-in can fire `Login` more than once (remember re-auth, social).
  6. From address = `mail_from_address` / `mail_from_name` system settings, else mail config.
  7. Mail failures are swallowed (error_log).
  8. The listener also runs for platform admins, and for logins whose previous row belongs to another browser of the same person (a typical multi-device user gets an alert on every switch of browser family).
- **Async & events:** synchronous; `Mail::raw`.
- **External systems:** SMTP.
- **Settings:** `security.alert_on_new_device` (true), `security.alert_on_new_country` (true), `security.alert_channel` (`email`).
- **Acceptance criteria:**
  - Given a user whose last login was Chrome/Windows, when they sign in from Safari/iPhone, then one email is sent with reason new-device and an `auth.alert_emitted` row is written.
  - Given the same user signs in again within 10 minutes from the same browser/IP, then no second email is sent.
  - Given `alert_on_new_device` off and the country unchanged, then no email is sent.
  - Given channel `whatsapp`, then an audit row is written but no message is sent.
- **Source refs:** `app/Listeners/NewLoginAlertListener.php`, `app/Providers/AppServiceProvider.php`, `resources/views/admin/security/index.blade.php`.
- **Port notes:** implement as an outbox consumer on `auth.login`; use a real geo-IP lookup if "new country" is a product promise; implement or drop the WhatsApp channel.

### WD-AUTH-019 — Registration policy settings

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-AUTH-005, WD-AUTH-008
- **Summary:** Four platform settings shape sign-up and live on Admin -> Settings -> General: whether public sign-up is open, whether emails auto-verify, which plan new workspaces start on, and how long the free-plan trial lasts. Only three actually work.
- **Actors & access:** platform admin, `PATCH admin/settings/general` (route owned by SET; only these four fields are described here).
- **UX & screens:** `resources/views/admin/settings/general.blade.php` toggles "public registration", "auto-verify email on signup", a default-signup-plan dropdown (active plans, marking free ones) and trial days.
- **Endpoints:** shared `GET/PATCH admin/settings/general` (SET). No route claimed here.
- **Data:** `system_settings` keys `public_registration` (bool, default true), `auto_verify_email` (bool, default true, seeded 1), `registration_default_plan_id` (string plan slug, must exist in `packages.plan_id`, max 64), `registration_trial_days` (int 0-365, default 14).
- **Rules & edge cases:**
  1. `auto_verify_email` is read at registration and again by `EnsureUserActive` (WD-AUTH-016) and by the mobile register.
  2. `registration_default_plan_id` and `registration_trial_days` are read by workspace creation (WD-AUTH-008) and the mobile `WorkspaceProvisioner`.
  3. QUIRK / dead setting: `public_registration` is saved and displayed but no code reads it - `/register` (and social sign-up, mobile sign-up) stay open regardless. To close registration the port must enforce it in register, social create and mobile register.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** the four keys above.
- **Acceptance criteria:**
  - Given `registration_default_plan_id` = a paid plan, when a workspace is created at onboarding, then it lands on that plan with no trial.
  - Given trial days 0 and a free default plan, then `trial_ends_at` stays null.
  - Given `public_registration` off (port behaviour), when a guest opens `/register`, then they see a "registration closed" state (WaDesk itself does not do this).
- **Source refs:** `app/Http/Controllers/AdminPagesController.php` (settingGeneral, settingGeneralUpdate), `resources/views/admin/settings/general.blade.php`, `app/Http/Controllers/AuthController.php`, `app/Services/WorkspaceProvisioner.php`, `database/seeders/DatabaseSeeder.php`.
- **Port notes:** hold these in the platform settings module (SET); expose a typed `PlatformSettings.registration` object to the auth module. Implement the missing `public_registration` gate.

### WD-AUTH-020 — Guest-page cache and CSRF resilience

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** -
- **Summary:** Mobile browsers and CDNs love to cache auth pages, leaving a stale CSRF token that 419s on submit. WaDesk defeats this with no-store headers on guest pages, a live-token endpoint that client JS uses to repair forms, and a server handler that turns every 419 into a friendly redirect.
- **Actors & access:** public; wraps login/register/forgot/reset (`NoStoreResponse`) and public marketing pages/legal pages.
- **UX & screens:** invisible to users; a redirect back with "Your session expired for security. Please try again." replaces the branded 419 page for browsers.
- **Endpoints:**

| Endpoint       | Route name | Handler                   | Middleware  | Request | Response                             |
| -------------- | ---------- | ------------------------- | ----------- | ------- | ------------------------------------ |
| GET csrf-token | csrf.token | closure in routes/web.php | (web group) | -       | JSON `{token}` with no-store headers |

- **Data:** session token.
- **Rules & edge cases:**
  1. `NoStoreResponse` sets `Cache-Control: no-store, no-cache, must-revalidate, private` and `Pragma: no-cache`; `SecurityHeaders` also sets no-store for `login`, `register`, `logout`, `forgot-password`, `reset-password[/...]`, `password/*` (WD-AUTH-045).
  2. `resources/js/csrf-guard.js` (loaded by `app.js`): on DOM ready and on bfcache `pageshow` (persisted) it fetches `/csrf-token` (`credentials: same-origin`, `cache: no-store`) and rewrites every `input[name=_token]` and `meta[name=csrf-token]`. It never intercepts submits (so the reCAPTCHA v3 submit handler still works) and only runs on pages that contain a token input.
  3. Global exception handler: a `TokenMismatchException` (and any HTTP exception with status 419) -> JSON callers get 419 with "Your session expired. Please refresh and try again."; a logout POST completes the logout and redirects to `/login` with "You have been signed out."; every other browser request regenerates the token and redirects back with input flashed (never `_token`, `password`, `password_confirmation`) and the friendly flash.
  4. CSRF is skipped (by path) for Node callbacks, provider webhooks, the team-inbox/chat AJAX APIs, the chatbot-widget public API, storefront checkout endpoints, `hooks/in/*` and similar machine endpoints; those are documented in their own domains. Guest auth pages are NOT exempt.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a login page served from cache with a stale token, when the page loads, then the token input is replaced with a live one and the submit succeeds.
  - Given a POST with a bad token from a browser, then the user is redirected back with the friendly flash and a new token, not a 419 page.
  - Given a JSON/AJAX request with a bad token, then a 419 JSON with the refresh message is returned.
- **Source refs:** `app/Http/Middleware/NoStoreResponse.php`, `resources/js/csrf-guard.js`, `routes/web.php`, `bootstrap/app.php`.
- **Port notes:** the target is a token API, so CSRF mostly disappears; keep `Cache-Control: no-store` on any HTML auth pages and a friendly expired-session state in `apps/web`.

### WD-AUTH-021 — Auth pages editor (admin): variants, preview, save

- **Status:** implemented
- **Priority:** P2
- **Effort:** L
- **Depends on:** -
- **Summary:** The super-admin restyles the login, register and forgot-password screens from Admin -> Settings -> Auth pages: pick one of five design templates (global), edit eyebrow/heading/accent word/sub-text/accent colour per page, and upload a side image, looping video or GIF. The editor shows the real page in an iframe and edits it in place.
- **Actors & access:** platform admin (admin group: `Authenticate`, `EnsureUserIsAdmin`, `IPAllowlist`); no dedicated permission key; setting keys `auth.*`.
- **UX & screens:** `resources/views/admin/settings/auth-pages.blade.php`: tabs Login / Register / Forgot password, accent colour picker, Reload and Full screen buttons, design-template picker (Split showcase, Cinematic, Minimal, Brand spotlight, Aurora, each with a one-line description) which posts to the variant endpoint, and an iframe of `/admin/settings/auth-pages/preview/{page}?fc_edit=1` (78vh, min 560px). The previewed pages are the real `auth.login`, `auth.register`, `auth.forgot-password` views rendered without the guest redirect, in editing mode (`fc_editing()` true only for platform admins passing `?fc_edit=1`), where the guest layout loads an editor script wired to the inline endpoints (WD-AUTH-022). A classic non-inline save exists too (form with all fields + media file). Component `components/auth-shell.blade.php` renders variants 2-5; variant 1 is the bespoke split showcase inside each page; `auth/_register_showcase.blade.php` is the shared showcase for the register steps.
- **Endpoints:**

| Endpoint                                     | Route name                        | Handler                                      | Middleware                                   | Request                                                                                                                                                                                                                                          | Response                                         |
| -------------------------------------------- | --------------------------------- | -------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| GET admin/settings/auth-pages                | admin.settings.auth-pages         | AdminPagesController@settingAuthPages        | Authenticate, EnsureUserIsAdmin, IPAllowlist | page in login,register,forgot (default login)                                                                                                                                                                                                    | editor view                                      |
| POST admin/settings/auth-pages               | admin.settings.auth-pages.update  | AdminPagesController@settingAuthPagesUpdate  | same                                         | page (required, one of three; else 422), variant (int 1-5), eyebrow (max 120), heading (max 120), heading_accent (max 120), subheading (max 400), accent (max 9), media (file jpg,jpeg,png,gif,webp,mp4,webm, max 20480 KB), remove_media (bool) | redirect back to the tab with "Auth page saved." |
| GET admin/settings/auth-pages/preview/{page} | admin.settings.auth-pages.preview | AdminPagesController@settingAuthPagesPreview | same                                         | page in login,register,forgot (404 otherwise)                                                                                                                                                                                                    | the real page view                               |
| POST admin/settings/auth-pages/variant       | admin.settings.auth-pages.variant | AdminPagesController@settingAuthPagesVariant | same                                         | variant (required int 1-5)                                                                                                                                                                                                                       | JSON `{ok, variant}`                             |

- **Data:** `system_settings` keys `auth.variant` ("1"-"5", global), and per page `auth.{page}.eyebrow|heading|heading_accent|subheading|accent|media_url|media_type`, plus showcase keys (see WD-AUTH-022). Media files are moved to `public/uploads/auth/{page}_{timestamp}.{ext}`; `media_type` = `video` (mp4/webm), `gif`, else `image`; stored `media_url` = `uploads/auth/<file>`.
- **Rules & edge cases:**
  1. Defaults (used when a key is empty): login eyebrow "Operator console for WhatsApp", heading "One place for every" + accent "conversation", sub-text "Broadcasts, flows, AI assist, shared inbox - all in one workspace your team will actually use."; register "Get started in minutes" / "Start your" + "free trial" / "Create your workspace and connect your first WhatsApp number in minutes."; forgot "Account recovery" / "Get back in," + "fast" / "Enter your email and we will send you a secure link to reset your password." Accent default `#25D366`.
  2. Saving an empty field stores an empty string, which makes `auth_cfg()` fall back to the shipped default (docs: "clearing a field restores its default").
  3. Removing media clears `media_url` and `media_type`; the old file is NOT deleted from disk (orphans accumulate). Uploading new media does not delete the previous file either.
  4. The variant is global for all three pages. Invalid stored variant -> 1.
  5. The reset-password, suspended and verify-email pages ignore the editor and variants (fixed design); the OTP verify and register steps follow the variant.
  6. Terms/Privacy footer links are NOT edited here (they come from `privacy_*_url` settings / the frontend live editor).
  7. No audit row is written for auth-page edits.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `auth.variant`, `auth.{login|register|forgot}.*`.
- **Acceptance criteria:**
  - Given the editor open on Register, when the admin picks template 3, then `auth.variant` = "3" and all three public pages render the minimal card layout.
  - Given the admin uploads a 5 MB mp4, then the side panel plays it muted and looping on variants that show media, and `media_type` = video.
  - Given an empty heading is saved, then the public page shows the shipped default heading.
  - Given a non-admin opens the preview URL, then access is denied (403).
- **Source refs:** `app/Http/Controllers/AdminPagesController.php` (settingAuthPages*), `resources/views/admin/settings/auth-pages.blade.php`, `resources/views/components/auth-shell.blade.php`, `resources/views/components/layouts/guest.blade.php`, `resources/views/auth/*`, `app/Support/fc_helpers.php` (`auth_cfg`, `fc_editing`), `app/Services/Frontend/FrontendContentStore.php`, `Documentation/pages/admin-panel/auth-pages.html`.
- **Port notes:** rebuild as content JSON on the org/platform settings (validated with Zod) and CMS media upload via the storage adapter (SET). Five variants are five React layout components sharing one content contract; WaDesk copy-deck strings must not be copied - author new defaults. The iframe/inline editor is optional; a side-by-side form with live preview meets parity.

### WD-AUTH-022 — Auth pages inline-edit endpoints

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-AUTH-021
- **Summary:** While the admin clicks text or media inside the previewed auth page, small JSON endpoints persist each change instantly (no publish step).
- **Actors & access:** platform admin (admin group middleware).
- **UX & screens:** driven by an editor script injected by `components/layouts/guest.blade.php` when `fc_editing()`; the script receives the three endpoint URLs and the CSRF token as data attributes; hover on the left panel offers upload/clear of the side media.
- **Endpoints:**

| Endpoint                                          | Route name                                   | Handler                                               | Middleware                                   | Request                                                                                      | Response                                                   |
| ------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| POST admin/settings/auth-pages/inline             | admin.settings.auth-pages.inline             | AdminPagesController@settingAuthPagesInline           | Authenticate, EnsureUserIsAdmin, IPAllowlist | key (required string max 60, format `{page}.{field}`), value (nullable string max 600)       | JSON `{ok:true}` or 422 `{ok:false,error:"Unknown field"}` |
| POST admin/settings/auth-pages/inline-media       | admin.settings.auth-pages.inline-media       | AdminPagesController@settingAuthPagesInlineMedia      | same                                         | page (login,register,forgot), media (required file jpg,jpeg,png,gif,webp,mp4,webm max 20 MB) | JSON `{ok, url, type}`                                     |
| POST admin/settings/auth-pages/inline-media-clear | admin.settings.auth-pages.inline-media-clear | AdminPagesController@settingAuthPagesInlineMediaClear | same                                         | page                                                                                         | JSON `{ok:true}`                                           |

- **Data:** `system_settings` `auth.{page}.{field}` (string).
- **Rules & edge cases:**
  1. Allowed fields: `eyebrow, heading, heading_accent, subheading, accent, hero_title, hero_desc, footer` plus the showcase regex `stat1..3_(num|label)`, `feat1..4_(title|desc)`, `inside_heading`, `chip1..6`; page must be login, register or forgot.
  2. Same media storage and orphan-file behaviour as WD-AUTH-021.
  3. Value is stored as given (text is escaped by Blade when rendered), max 600 chars; there is no length cap on `accent` beyond 600 and no colour validation on this path (the classic save caps at 9).
  4. The showcase fields are only rendered by the variant-1 login page and the register showcase; edits made for other pages/variants are stored but unused.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** same keys as WD-AUTH-021.
- **Acceptance criteria:**
  - Given the key `login.heading` and value "Hi", when posted, then `auth.login.heading` = "Hi" and `/login` renders it.
  - Given an unknown field name, then 422 "Unknown field" and nothing is stored.
  - Given a png upload, then the response returns the public URL and type `image` and the page shows it.
- **Source refs:** `app/Http/Controllers/AdminPagesController.php`, `resources/views/components/layouts/guest.blade.php`, `resources/views/auth/_register_showcase.blade.php`.
- **Port notes:** same content contract as WD-AUTH-021; endpoints become a single `PATCH /v1/admin/auth-pages/{page}` with a partial body.

### WD-AUTH-023 — Social login and reCAPTCHA admin settings

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-AUTH-003, WD-AUTH-004
- **Summary:** One admin screen configures Google sign-in, Facebook sign-in and reCAPTCHA (enable, keys, version, threshold) and shows which are live right now.
- **Actors & access:** platform admin (admin group middleware). No permission key.
- **UX & screens:** `resources/views/admin/settings/social-login.blade.php`: three cards. Google (Enable, Client ID, Client secret masked with "saved - leave blank to keep", read-only Authorized redirect URI with Copy = `<app url>/auth/google/callback`), Facebook (App ID, App secret, redirect URI `/auth/facebook/callback`), reCAPTCHA (Enable, Version v2/v3, v3 score threshold, Site key, Secret key masked). A side "What's live right now" panel and Quick-setup guides. Flash "Social login & captcha settings saved."
- **Endpoints:**

| Endpoint                         | Route name                         | Handler                                       | Middleware                                   | Request                                                                                                                                                                                                                                                                                                     | Response                   |
| -------------------------------- | ---------------------------------- | --------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| GET admin/settings/social-login  | admin.settings.social-login        | AdminPagesController@settingSocialLogin       | Authenticate, EnsureUserIsAdmin, IPAllowlist | -                                                                                                                                                                                                                                                                                                           | view                       |
| POST admin/settings/social-login | admin.settings.social-login.update | AdminPagesController@settingSocialLoginUpdate | same                                         | social_google_enabled/social_facebook_enabled/recaptcha_enabled (0/1), social_google_client_id, social_google_client_secret, social_facebook_client_id, social_facebook_client_secret, recaptcha_site_key, recaptcha_secret (each max 255), recaptcha_version (v2/v3), recaptcha_v3_threshold (numeric 0-1) | redirect back with success |

- **Data:** system settings `social_google_*`, `social_facebook_*`, `recaptcha_*`. Secrets are in `SystemSetting::ENCRYPTED_KEYS` (`social_google_client_secret`, `social_facebook_client_secret`, `recaptcha_secret`) and are encrypted on write, never rendered back.
- **Rules & edge cases:**
  1. A blank secret field keeps the stored secret (so a save cannot wipe it); client ids/keys ARE overwritten with the submitted value (blank clears).
  2. `recaptcha_version` other than `v3` is saved as `v2`; threshold blank saves "0.5".
  3. A provider is only "live" when enabled AND both id and secret exist; the screen mirrors this.
  4. Audit row `settings.social_login_update` records booleans only (never secrets).
  5. There is no validation that keys work, no test button.
- **Async & events:** audit `settings.social_login_update`.
- **External systems:** none at save time.
- **Settings:** see Data.
- **Acceptance criteria:**
  - Given a secret already saved, when the form is saved with the secret blank, then the previous secret still works.
  - Given Google enabled with only an id, then the login page shows no Google button.
  - Given reCAPTCHA v3 with threshold 0.7 saved, then `RecaptchaService::threshold()` returns 0.7.
- **Source refs:** `app/Http/Controllers/AdminPagesController.php` (settingSocialLogin*), `resources/views/admin/settings/social-login.blade.php`, `app/Models/SystemSetting.php`.
- **Port notes:** platform settings module (SET); secrets encrypted with the platform KMS/`APP_KEY` analogue and write-only in the API (return `hasSecret: true`). Include a "test connection" action as an improvement.

### WD-AUTH-024 — Account hub shell (/account)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** -
- **Summary:** `/account` is the signed-in person's own control centre: a left menu (avatar card, plan badge, tab list) and one pane per task, chosen by `?tab=`. This domain owns the shell and the Profile, Change password, Delete account and Branding panes; the Plan & usage, Orders, Wallet, Add-ons, Affiliate, Support history and Translation panes are owned by other domains but render inside this shell.
- **Actors & access:** any authenticated user (`Authenticate`); stays reachable under a suspended trial (`EnsureTrialActive` allowlists `account*`). Purchases-related panes depend on plan state.
- **UX & screens:** `resources/views/user/account/index.blade.php` (layout `x-layouts.user`, nav-key "more") with `resources/js/charts/user-account-index.js`. Left rail: avatar with initials fallback, name, email, plan badge (billing package name or "Free"), group "Account" (Profile, Plan & usage, Order history, Wallet, Add-ons, Affiliate, Support history, Branding, Translation) and group "Security" (Change password, Delete account), plus an upgrade teaser. Tab switching is client-side (`history.pushState`, `?tab=<name>`, popstate) with per-tab title/description; unknown tab -> profile. The Profile pane also shows a "Notifications" card of three checkboxes that are static (no form, no name, nothing is saved) - a stub. Wallet ledger pagination uses the `wallet_page` query param.
- **Endpoints:**

| Endpoint    | Route name   | Handler                 | Middleware   | Request          | Response                         |
| ----------- | ------------ | ----------------------- | ------------ | ---------------- | -------------------------------- |
| GET account | user.account | AccountController@index | Authenticate | tab, wallet_page | account view with the data below |

- **Data:** (loaded by `index()` for all panes) fresh user; `wallet_transactions` credit rows for the user (10/page); referrals (latest 50, with referred user) and total `credits_awarded`; settings `credits_per_message` (min 1), `referral_signup_credits` (default 100), `credits_per_currency_minor` (0.1); referral URL `/register?ref=<referral_code>`; active `credit_packages`; add-on packages (`Package::addons()` active) and the workspace's active `workspace_addons` with owned counts (add-ons only offered when the workspace has an active, unexpired, non-free plan); the user's latest 100 `orders` plus lifetime paid total (raw single-currency sum when all paid orders share a currency, else converted into the workspace currency via `FormatSettings::convert`); all of the user's `support_tickets` with counts open (status != resolved), resolved, all.
- **Rules & edge cases:**
  1. Everything is loaded on every visit regardless of the active tab (no lazy panes), which is heavy for users with many orders/tickets; the target should paginate per pane.
  2. Panes belonging to other domains: Plan & usage (`x-plan-usage`, PLAN), Orders and invoice download `GET account/invoices/{id}` (PLAN/INV), Wallet and `account/wallet/statement[.csv]` (WALLET), Add-ons (ADD/PLAN), Affiliate (CPN), Support history (SUPP), Translation (`POST account/translation`, I18N). Sheets add-on key routes `account/sheets-key/*` and `sheets-addon*` on AccountController belong to EXT.
  3. Order history labels come from order status paid/pending/failed/refunded (PLAN).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** see Data.
- **Acceptance criteria:**
  - Given a signed-in user, when they open `/account?tab=password`, then the Change password pane is shown and the breadcrumb/title update.
  - Given an unknown `?tab=foo`, then the Profile pane shows.
  - Given the user is on a free plan, then the Add-ons pane shows the "need an active plan" message rather than a buy list.
  - Given the user has orders in two currencies, then the lifetime total is expressed in the workspace currency.
- **Source refs:** `app/Http/Controllers/AccountController.php`, `resources/views/user/account/index.blade.php`, `resources/js/charts/user-account-index.js`, `Documentation/pages/account/account-billing.html`.
- **Port notes:** build the shell in `apps/web` as a tabbed settings area where each tab is its own route and query; only Profile/Security/Delete/Branding tabs belong to this domain. Drop the static notifications card (or bind it to NOTIF preferences).

### WD-AUTH-025 — Profile update

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-AUTH-024
- **Summary:** The user edits their name, display name, email, phone (with country picker) and, if they own the current workspace, the workspace timezone.
- **Actors & access:** authenticated user editing themself. Timezone applies only when they are the current workspace's owner; otherwise it is silently ignored.
- **UX & screens:** Profile pane form "Personal info": Full name (required, max 120), Display name (max 120, placeholder = first name), Email (required, max 191), Phone (intl-tel-input, hidden `country_code` synced from the picker, saved dial code restored via the library), Timezone (Tom Select over all IANA ids, tagged "(workspace)", helper "Only the owner can change it"), Reset and Save changes. Flash "Profile saved." on success; errors listed above the form.
- **Endpoints:**

| Endpoint             | Route name                  | Handler                         | Middleware   | Request                                                                                                                                                                                                               | Response         |
| -------------------- | --------------------------- | ------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| POST account/profile | user.account.profile.update | AccountController@updateProfile | Authenticate | name (required string max 120), display_name (nullable max 120), email (required email max 191 unique among users ignoring self), mobile (nullable max 32), country_code (nullable max 8), timezone (nullable max 64) | back with status |

- **Data:** updates `users.name`, `display_name` (blank -> null), `email`, `mobile`, `country_code`; updates `workspaces.timezone` (owner only, blank keeps current); writes an in-app notification "Profile updated".
- **Rules & edge cases:**
  1. QUIRK: changing the email does not clear `email_verified_at`, does not send a verification mail and needs no password re-entry. Because verification links embed `sha1(email)`, old links stop working after a change.
  2. Mobile/country code are written as posted, even null (a blank mobile erases it); `mobile_verified_at` is not reset when the number changes.
  3. Timezone string is not validated against the IANA list here (the UI restricts it); the page uses `safe_timezone()` to map legacy aliases such as `Asia/Calcutta`.
  4. Email uniqueness ignores the user's own id and (unlike sign-up) also counts soft-deleted rows since the scrub rewrites their email.
  5. No audit row and no security alert email are written for an email change.
- **Async & events:** in-app notification (NOTIF) category system, severity success.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given valid fields, when saved, then `users` reflects them and "Profile saved." shows.
  - Given an email owned by another user, then validation fails on `email`.
  - Given a non-owner member posts a new timezone, then the user fields save and the workspace timezone is unchanged.
  - Given an owner posts a timezone, then `workspaces.timezone` updates.
- **Source refs:** `app/Http/Controllers/AccountController.php`, `resources/views/user/account/index.blade.php`, `resources/js/charts/user-account-index.js`, `Documentation/pages/account/account-billing.html`.
- **Port notes:** target should require re-verification when the email changes and treat phone as E.164; workspace timezone is a separate org-settings endpoint (WSP).

### WD-AUTH-026 — Profile photo upload and remove

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-AUTH-024
- **Summary:** The user picks an image on the avatar pencil button; it uploads immediately (with an optimistic preview) and replaces the previous photo. A separate route removes the photo.
- **Actors & access:** authenticated user (own avatar only).
- **UX & screens:** avatar card in the left rail; hidden file input (`accept image/*`), instant preview, toast "Photo updated"; failure toasts distinguish 413 (server body-size limit, tells the admin to raise Nginx/PHP limits), 419 (session expired), 403, and validation errors. There is NO remove-photo control in the UI; the DELETE route is API-only.
- **Endpoints:**

| Endpoint             | Route name                | Handler                       | Middleware   | Request                                                                | Response                                                 |
| -------------------- | ------------------------- | ----------------------------- | ------------ | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| POST account/photo   | user.account.photo.update | AccountController@updatePhoto | Authenticate | photo (required file, image, mimes jpg,jpeg,png,webp,gif, max 2048 KB) | JSON `{ok:true, url}`                                    |
| DELETE account/photo | user.account.photo.remove | AccountController@removePhoto | Authenticate | -                                                                      | redirect to `/account?tab=profile` with "Photo removed." |

- **Data:** `users.avatar_path` = `avatars/{userId}_{uniqid}.{ext}` on the active media disk (`media_disk()`: cloud storage when enabled, else local `public`). The extension comes from the client filename (lowercased, default jpg).
- **Rules & edge cases:**
  1. The previous avatar file is deleted best-effort, but never when `avatar_path` is an absolute http(s) URL (social sign-in stores provider URLs).
  2. Avatar URL accessor: absolute URLs pass through; otherwise `media_url(path)`. Views fall back to initials.
  3. Validation uses Laravel `image` + `mimes` (content sniffed) so SVG is rejected; it does not use `SecureUpload` (WD-AUTH-043) but achieves a similar effect.
  4. Remove deletes the file (unless URL) and nulls the column.
- **Async & events:** none.
- **External systems:** cloud storage adapter when enabled (SET).
- **Settings:** storage settings (SET).
- **Acceptance criteria:**
  - Given a 1 MB png, when uploaded, then the JSON returns a URL, `avatar_path` is set and the old local file is removed.
  - Given a 3 MB jpg, then validation fails (over 2048 KB).
  - Given a social avatar URL, when the user uploads a new photo, then no delete is attempted on the URL.
  - Given the DELETE route is called, then the avatar is cleared and initials show.
- **Source refs:** `app/Http/Controllers/AccountController.php`, `resources/js/charts/user-account-index.js`, `app/Models/User.php`.
- **Port notes:** use presigned S3/MinIO upload and store the object key; add image re-encoding and a size cap; expose remove in the UI.

### WD-AUTH-027 — Change password (signed in)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-AUTH-035
- **Summary:** The user changes their password by supplying the current one, and every other session and API token of theirs is revoked.
- **Actors & access:** authenticated user.
- **UX & screens:** Change password pane (`?tab=password`): Current password, New password (placeholder "At least 8 characters"), Confirm new password (eye toggles), a "Password tips" box, Reset and Update password. Pane text says "at least 12 characters with a mix of letters, numbers, and symbols" while the rule actually enforced is the admin policy (default 8, mixed case, number) - inconsistent copy. Success flash "Password updated." in the pane.
- **Endpoints:**

| Endpoint              | Route name                   | Handler                          | Middleware   | Request                                                                                           | Response                                                |
| --------------------- | ---------------------------- | -------------------------------- | ------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| POST account/password | user.account.password.update | AccountController@updatePassword | Authenticate | current_password (required, must match), password (required, confirmed, `PasswordPolicy::rule()`) | redirect `/account?tab=password` with `password_status` |

- **Data:** `users.password` (hashed), `password_changed_at = now`, `force_password_change = false`, `remember_token` = new random 60 chars; deletes the user's `personal_access_tokens`; deletes all other `sessions` rows for the user (current session kept).
- **Rules & edge cases:**
  1. New password rule = admin policy: min length `security.password_min_length` (default 8, code floor 6), mixed case if `password_require_upper` (default on), numbers if `password_require_number` (default on), symbols if `password_require_symbol` (default off).
  2. No check that the new password differs from the old one and no history.
  3. Sessions are not regenerated for the current session, and no email is sent; an in-app urgent notification "Password changed - if this wasn't you, reset immediately" (category system, severity warning, `is_urgent`) is created.
  4. Sanctum-token/session cleanup failures are swallowed.
- **Async & events:** in-app notification (NOTIF).
- **External systems:** none.
- **Settings:** `security.password_*` (WD-AUTH-035).
- **Acceptance criteria:**
  - Given correct current password and a compliant new one, when submitted, then login with the new password works, other devices' sessions are gone and the current session stays.
  - Given a wrong current password, then validation fails on `current_password`.
  - Given policy requires a symbol, when the new password lacks one, then validation fails.
  - Given the user has Sanctum tokens, then they are all deleted.
- **Source refs:** `app/Http/Controllers/AccountController.php`, `app/Support/PasswordPolicy.php`, `resources/views/user/account/index.blade.php`, `Documentation/pages/account/account-billing.html`.
- **Port notes:** revoke refresh tokens except the presenting session; consider emailing the user; keep the notification through the outbox.

### WD-AUTH-028 — Delete account (danger zone)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-AUTH-024
- **Summary:** The user permanently removes their account by typing a confirmation phrase. The row is scrubbed of personal data and soft-deleted, and they are signed out. Owners of workspaces that still have other members are blocked.
- **Actors & access:** authenticated user (own account).
- **UX & screens:** Delete pane: warning text, "Before you delete, consider" list (spend wallet balance with the amount shown, downgrade to free, contact support), a confirmation input (placeholder lowercase "delete my account"), an optional "Why are you leaving?" textarea (never sent), Cancel and "Permanently delete account". JS `confirmDelete()` compares the trimmed input to the exact phrase `DELETE my account` (case-sensitive) and sends `DELETE /account` as JSON, then redirects to `/login?account_deleted=1`. QUIRK: the on-screen hint and placeholder use lowercase while the check is case-sensitive mixed case, and the pane text claims workspaces/conversations/devices are deleted (they are not).
- **Endpoints:**

| Endpoint       | Route name           | Handler                          | Middleware   | Request                                                        | Response                                                       |
| -------------- | -------------------- | -------------------------------- | ------------ | -------------------------------------------------------------- | -------------------------------------------------------------- |
| DELETE account | user.account.destroy | AccountController@destroyAccount | Authenticate | confirmation (required string, must equal `DELETE my account`) | JSON `{ok:true, redirect}` or 422 `{ok:false, error, message}` |

- **Data:** updates then soft-deletes `users`: `name` = "Deleted user", `email` = `deleted-{id}-{8 hex}@deleted.local`, `mobile` and `country_code` null, `avatar_path` null (file removed unless URL), then `deleted_at` set.
- **Rules & edge cases:**
  1. Wrong phrase -> 422 `confirmation_mismatch` "Type "DELETE my account" exactly to confirm.".
  2. Block: workspaces the user owns that have more than one member (members count includes the owner) -> 422 `owner_of_active_workspaces` listing id+name and "Transfer ownership or remove members first." Workspaces where the owner is alone are NOT blocked and are left in place, orphaned (owner soft-deleted, still billed/active).
  3. Session invalidated, CSRF regenerated, user logged out; the response redirects to login.
  4. QUIRK: other sessions, remember cookies, Sanctum tokens, the password hash, `social_provider*`, `referral_code`, wallet balance, `workspace_user` rows and 2FA secrets are NOT cleared. The unique email slot is freed by the rewrite so the person can re-register.
  5. Users are addressed by the soft-delete scope; a deleted user's remaining sessions stop resolving (no user) on the next request.
  6. The "reason" field is not transmitted.
- **Async & events:** the `User` model has the audit observer (`AuditableObserver`) so the update/delete writes audit rows (NOTIF); no email.
- **External systems:** cloud storage delete for the avatar.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the exact phrase and no blocking workspaces, when confirmed, then the user is soft-deleted with scrubbed PII and redirected to `/login?account_deleted=1`.
  - Given the user owns a workspace with 3 members, then the request returns 422 listing it and nothing changes.
  - Given a wrong-case phrase, then 422 mismatch.
  - Given deletion succeeded, then the old email can register again.
- **Source refs:** `app/Http/Controllers/AccountController.php`, `resources/js/charts/user-account-index.js`, `resources/views/user/account/index.blade.php`, `app/Models/User.php`, `Documentation/pages/account/account-billing.html`.
- **Port notes:** ADR-0009 says hard delete with audit; implement erase + audit, revoke all tokens, transfer/close owned orgs explicitly, and fix the owner-only-workspace orphan behaviour. Wallet balance handling should be explicit (WALLET).

### WD-AUTH-029 — Workspace message footer (branding)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-AUTH-024
- **Summary:** Workspaces on a plan with the "remove branding" feature can set (or blank out) the small footer line appended to outgoing plain-text/interactive messages; other plans see the platform footer read-only with an upgrade prompt.
- **Actors & access:** authenticated user acting on their current workspace; gate `PlanLimitGuard::feature($ws, 'remove_branding')` (plan feature key `remove_branding`; throws `PlanLimitReachedException` on locked plans). No workspace-role check on this route (any member of the workspace can change it - QUIRK).
- **UX & screens:** Branding pane: "Message footer" with a 60-char input (label "Custom footer (60 char max)"), live preview, Save footer / Clear; on locked plans a read-only "Current footer (platform default)" and upgrade link. Flash key `branding_status`.
- **Endpoints:**

| Endpoint              | Route name                   | Handler                          | Middleware   | Request                                  | Response                                               |
| --------------------- | ---------------------------- | -------------------------------- | ------------ | ---------------------------------------- | ------------------------------------------------------ |
| POST account/branding | user.account.branding.update | AccountController@updateBranding | Authenticate | branding_footer (nullable string max 60) | back with "Footer updated - applies on the next send." |

- **Data:** `workspaces.branding_footer` (string; "" = explicit no footer, NULL = platform default `platform_branding_footer` setting, seeded "Sent via WaDesk").
- **Rules & edge cases:**
  1. Blank input is stored as "" (footer removed) not NULL.
  2. After saving: `BrandingFooterService::flushCache()` and `NodeCacheBuster::bustWorkspace(wsId)` so the Node bridge drops its cached settings and the change applies on the very next send (WADEV/NODE).
  3. Approved WhatsApp templates skip the footer (they carry their own); flows, scheduled sends and team-inbox replies apply it (docs).
  4. No workspace, -> error "No workspace."
- **Async & events:** cache flush; Node cache bust HTTP call.
- **External systems:** Node bridge (X-Node-Token).
- **Settings:** `platform_branding_footer`.
- **Acceptance criteria:**
  - Given a plan with `remove_branding`, when a footer of 20 chars is saved, then `workspaces.branding_footer` stores it and the next send uses it.
  - Given blank input, then messages go out with no footer.
  - Given a plan without the feature, when the route is posted, then it is refused with the plan-limit error.
  - Given more than 60 chars, then validation fails.
- **Source refs:** `app/Http/Controllers/AccountController.php`, `app/Services/BrandingFooterService.php`, `app/Services/NodeCacheBuster.php`, `resources/views/user/account/index.blade.php`, `Documentation/pages/account/account-billing.html`.
- **Port notes:** org setting `messageFooter` guarded by the `remove_branding` plan feature (PLAN); the send pipeline (inbox/broadcast) reads it when composing free-form messages. Restrict to owner/admin roles.

### WD-AUTH-030 — TOTP two-factor enrolment and disable

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-AUTH-032
- **Summary:** Under Settings -> Security a user enrols an authenticator app: a secret + QR code are shown, they confirm with a current 6-digit code, and 2FA is recorded as on. Disabling requires their password. BUT nothing at web sign-in asks for the code, so the second factor is not actually enforced; only the "require 2FA" policy nags users to enrol (WD-AUTH-032).
- **Actors & access:** authenticated user, own account. (The Security pane is inside the shared Settings page, `GET settings`, owned by WSP.)
- **UX & screens:** `resources/views/user/settings/index.blade.php` pane `security` (tab `?tab=security`). Not enabled: steps list (open an authenticator app, scan the QR or paste the secret, type the 6-digit code), the base32 secret shown in text, a 6-digit code input (`maxlength 6`, numeric, centred), errors under the field, "Enable 2FA", and a 180x180 QR image built from `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=<otpauth url>`. Enabled: green banner "Two-factor is enabled (since <date>)", "Confirm with password" input, "Disable 2FA" with a browser confirm. The pane subtitle says "Require a 6-digit code ... on every login", which is untrue on the web.
- **Endpoints:**

| Endpoint                  | Route name                | Handler                                 | Middleware   | Request                            | Response                                         |
| ------------------------- | ------------------------- | --------------------------------------- | ------------ | ---------------------------------- | ------------------------------------------------ |
| POST settings/2fa/enable  | user.settings.2fa.enable  | SettingsTabsController@enableTwoFactor  | Authenticate | code (required string max 10)      | back with success or `errors.code` / error flash |
| POST settings/2fa/disable | user.settings.2fa.disable | SettingsTabsController@disableTwoFactor | Authenticate | current_password (required string) | back with success or `errors.current_password`   |

- **Data:** `users.two_factor_enabled` (bool), `two_factor_secret` (encrypted text, base32), `two_factor_confirmed_at`, `two_factor_recovery_codes` (encrypted, never populated), session key `two_factor_settings_secret` (pending secret), `security_audit_log` rows (WD-AUTH-046).
- **Rules & edge cases:**
  1. Secret is generated lazily when the Security pane renders for a user without 2FA: 10 random bytes base32-encoded (16 chars, alphabet A-Z2-7) stored in the session until confirmed. The otpauth URL is `otpauth://totp/<issuer>:<email>?secret=..&issuer=..` with issuer = `config('app.name')` (not the white-label `brand_name()`).
  2. Enable: already enabled -> success "already enabled" no-op; no pending secret -> "Two-factor setup expired. Refresh the page to generate a new code."; code checked with RFC 6238 TOTP (SHA-1, 30 s step, 6 digits, +/-1 step window, constant-time compare, whitespace stripped); mismatch -> `two_factor_failed` audit + "The authentication code is invalid."; success sets enabled, secret, confirmed_at=now, clears the pending secret, audits `two_factor_enabled`, flash "Two-factor authentication enabled."
  3. No attempt limit on enable codes beyond normal request throttling (none), so an attacker with a hijacked session could brute-force enrolment - low value but noted.
  4. Disable: not enabled -> success no-op; wrong password -> "Wrong password."; success clears enabled, secret, confirmed_at and recovery codes, audits `two_factor_disabled`.
  5. Recovery codes: the column, the docs and the disable code mention them but no code generates, shows or accepts them (docs-only).
  6. QUIRK: the QR image is fetched from a third-party site with the full otpauth URL (including the secret) in the query string; the port must render the QR locally.
  7. QUIRK: the same `two_factor_enabled` flag is used by the mobile API, where 2FA means "WhatsApp OTP at login" (MOB). A user who enrols TOTP on the web is treated as 2FA-enabled by the mobile login, which then demands a WhatsApp OTP (only when the registration-OTP sender is active).
  8. Allowed-method policy `security.allowed_2fa_methods` (totp/email/telegram) is stored but only TOTP exists.
- **Async & events:** audit rows only.
- **External systems:** `api.qrserver.com` (QR image; leaks secret).
- **Settings:** `security.allowed_2fa_methods` (unused), `security.require_2fa_*` (WD-AUTH-032).
- **Acceptance criteria:**
  - Given no 2FA, when the Security pane opens, then a secret and QR are shown and the same secret persists across reloads of the pane in that session.
  - Given a correct current code, when submitted, then `two_factor_enabled` = 1, `two_factor_confirmed_at` set, an audit row `two_factor_enabled` (status success) exists.
  - Given a code 90 seconds old, then it is rejected (outside +/-1 step).
  - Given 2FA enabled, when Disable is submitted with the correct password, then secret and confirmed_at are cleared.
  - Given 2FA enabled (port target behaviour), when the user signs in, then a code prompt appears - WaDesk does not do this and the port should.
- **Source refs:** `app/Http/Controllers/SettingsTabsController.php`, `app/Support/TwoFactorService.php`, `app/Http/Controllers/UserPagesController.php` (settings), `resources/views/user/settings/index.blade.php`, `app/Models/User.php`, `Documentation/pages/security/authentication.html`.
- **Port notes:** build a real TOTP login challenge (step-up token after password), encrypted secret storage, hashed recovery codes, local QR rendering, per-user attempt limits. This is the largest functional gap versus the docs; treat WaDesk's behaviour as the minimum. Coordinate with the existing `apps/api/src/modules/auth` login response (`mfa_required`).

### WD-AUTH-031 — Active sessions list and revoke

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-AUTH-034
- **Summary:** The Security pane lists the user's signed-in devices (one row per browser, merged), marks the current one, and lets them sign out one device or all other devices.
- **Actors & access:** authenticated user (own sessions only).
- **UX & screens:** Settings -> Security "Active sessions": subtitle "Devices signed in within the last Nh (config session lifetime in hours; 168h by default). Same browser collapsed into one row."; table columns Device (browser + OS parsed from the user agent with mobile/desktop icon and a "this session" badge), IP address, Last active (relative, tooltip full time), Sessions (count with "merged" tooltip), Revoke button (not on the current row); footer pagination "Showing a-b of n", Prev/Next; empty state "No active sessions. Switch SESSION_DRIVER to database ..."; "Sign out of all others" button with a browser confirm.
- **Endpoints:**

| Endpoint                             | Route name                           | Handler                                       | Middleware   | Request                | Response                             |
| ------------------------------------ | ------------------------------------ | --------------------------------------------- | ------------ | ---------------------- | ------------------------------------ |
| DELETE settings/sessions/{id}        | user.settings.sessions.revoke        | SettingsTabsController@revokeSession          | Authenticate | id (session id string) | back with flash                      |
| POST settings/sessions/revoke-others | user.settings.sessions.revoke-others | SettingsTabsController@revokeAllOtherSessions | Authenticate | -                      | back with "N session(s) signed out." |

The list itself is assembled in `UserPagesController@settings` (`GET settings`, WSP).

- **Data:** reads/deletes `sessions` (id, user_id, ip_address, user_agent, last_activity). Audit rows `session_revoked` (payload session_id) and `all_sessions_revoked` (payload count) in `security_audit_log`.
- **Rules & edge cases:**
  1. Listing: sessions of the user with `last_activity >= now - session.lifetime` (default 10080 minutes), newest first, grouped by (IP, md5 of user agent); each group shows the latest row, a count, and `is_current` if any member is the current session; sorted current-first then by recency; 10 groups per page (`session_page` param).
  2. Revoke by id: current session -> "Use the logout button to end the current session."; a row not belonging to the user -> "Session not found." (checked with `user_id`).
  3. QUIRK: a merged row exposes only the latest session id, so revoking a "device" deletes just that one session id; older ids of the same browser (kept alive by Laravel's regenerate-on-login) stay valid and the row may reappear.
  4. Revoke-others deletes every session row of the user except the current id and reports the count (0 is fine).
  5. This screen only works with the database session driver; with file sessions the list is empty.
- **Async & events:** `security_audit_log` writes.
- **External systems:** none.
- **Settings:** `session.lifetime` (env `SESSION_LIFETIME`, 10080).
- **Acceptance criteria:**
  - Given a user with sessions on two browsers, when the pane opens, then two rows show and the current one is marked.
  - Given the user revokes the other row, then that session id is deleted and that browser is asked to log in on its next request.
  - Given "Sign out of all others", then all other rows are removed and the flash shows the count.
  - Given a crafted DELETE for another user's session id, then it is refused with "Session not found."
- **Source refs:** `app/Http/Controllers/SettingsTabsController.php`, `app/Http/Controllers/UserPagesController.php`, `resources/views/user/settings/index.blade.php`, `config/session.php`, `Documentation/pages/security/authentication.html`.
- **Port notes:** requires server-side session records (a `user_sessions` table keyed by refresh-token family, with ip/UA/last_used); group by family, not by heuristic; revoke deletes the family.

### WD-AUTH-032 — Enforced 2FA policy (Force2FA)

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-AUTH-030, WD-AUTH-037
- **Summary:** Admins can require two-factor enrolment for everyone, for admins, or for workspace owners. Covered users who have not confirmed 2FA are redirected to Settings -> Security with a warning on each request. As implemented the redirect target is itself blocked (loop) and 2FA is never asked at login.
- **Actors & access:** middleware `Force2FA` appended to the `web` group (session requests only). Toggles in Security Center -> Login and MFA.
- **UX & screens:** redirect to `/settings?tab=security` with flash warning "Two-factor authentication is required by your administrator. Please enable it to continue."
- **Endpoints:** none of its own.
- **Data:** reads `users.two_factor_confirmed_at`, `users.role`, owned workspaces; settings `security.require_2fa_for_all|admins|owners`.
- **Rules & edge cases:**
  1. Skipped when not installed, no user, or the user already has `two_factor_confirmed_at`.
  2. Bypassed paths: those starting with `/login`, `/logout`, `/register`, `/password`, `/email`, and any path containing `/2fa` or `/two-factor`.
  3. Enforced if `require_2fa_for_all`, OR (`for_admins` AND `users.role` in admin, super_admin, super-admin, support_admin, support-admin - legacy role column, NOT Spatie roles), OR (`for_owners` AND the user owns a workspace).
  4. QUIRK (likely bug): `/settings` and `/account` are not in the bypass list, so the redirect target `/settings?tab=security` is itself intercepted and redirected again - an infinite redirect for any covered, unenrolled user; only POSTs to `/settings/2fa/*` would pass. Verify on the live reference before porting; the port must exempt the enrolment screens.
  5. Not applied to API/mobile/Node requests, to social login, or to already-issued sessions until their next web request.
  6. The KPI "2FA coverage" counts `users.role = 'admin'` rows with confirmed 2FA (WD-AUTH-036).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `security.require_2fa_for_all` (false), `security.require_2fa_for_admins` (false), `security.require_2fa_for_owners` (false).
- **Acceptance criteria:**
  - Given `require_2fa_for_admins` on and an admin without 2FA (port behaviour), when they load `/admin`, then they reach only the 2FA enrolment screen, from which they can complete enrolment.
  - Given a user with confirmed 2FA, then no redirect occurs.
  - Given the user is on `/logout`, then the request passes.
  - Given the policy is off, then nothing is enforced.
- **Source refs:** `app/Http/Middleware/Force2FA.php`, `app/Http/Controllers/Admin/SecurityController.php`, `bootstrap/app.php`, `Documentation/pages/security/authentication.html`.
- **Port notes:** implement as a guard that returns a problem+json `mfa_enrolment_required`; scope the exemption to `/me/mfa/*`, logout and password recovery; resolve "admin" via RBAC roles, not a role column.

### WD-AUTH-033 — Session idle timeout

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-AUTH-037
- **Summary:** Signed-in web users are logged out after a configurable number of idle minutes, unless they opted into "keep me signed in".
- **Actors & access:** middleware `SessionTimeout` (web group).
- **UX & screens:** redirect to `/login` with flash warning "Your session timed out after N minutes of inactivity. Please sign in again."
- **Endpoints:** none.
- **Data:** session keys `_last_activity_at` (unix time) and `auth.remember`; audit row `auth.session_timeout` (result warning; payload idle_seconds, limit_minutes; subject user).
- **Rules & edge cases:**
  1. Setting `security.session_timeout_minutes` default 60 (form range 5-1440); 0 or less disables.
  2. Bypass: `auth.remember` session flag true (set by password login when "Keep me signed in" was ticked, which is the default) or `Auth::viaRemember()` (then the flag is re-armed so it persists). Consequently the timeout mostly applies only to people who untick the box. Social-login sessions do not set the flag (yet create a remember cookie), so they ARE timed out; the resulting `Auth::logout()` also destroys that remember cookie.
  3. The timestamp is refreshed on every request; when now - last > limit x 60 the user is logged out, session invalidated, CSRF regenerated.
  4. The first request after login has no timestamp, so no immediate timeout.
  5. Independent of the underlying session lifetime (7 days) and of the remember cookie.
- **Async & events:** audit `auth.session_timeout` (shown in Security KPI warnings).
- **External systems:** none.
- **Settings:** `security.session_timeout_minutes` (60).
- **Acceptance criteria:**
  - Given the timeout is 30 minutes and a non-remembered session idle for 31 minutes, when they load any page, then they are redirected to login with the timeout message and an audit row exists.
  - Given a remembered session idle for days, then no timeout occurs.
  - Given the setting is 0, then no timeout occurs.
- **Source refs:** `app/Http/Middleware/SessionTimeout.php`, `bootstrap/app.php`.
- **Port notes:** enforce by refresh-token idle expiry (sliding), with "remember" granting a longer TTL; the remember bypass is a product choice worth revisiting.

### WD-AUTH-034 — Concurrent session cap

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-AUTH-037
- **Summary:** Limits how many live sessions one user can hold. When the cap is exceeded the oldest extra sessions are deleted, keeping the current one and the most recent others.
- **Actors & access:** middleware `LimitConcurrentSessions` (web group), requires the database session driver.
- **UX & screens:** none; evicted browsers are logged out on their next request.
- **Endpoints:** none.
- **Data:** reads/deletes `sessions` rows for the user ordered by `last_activity` desc; session marker `_concurrent_checked_for_cap`; audit `auth.concurrent_sessions_evicted` (result warning; meta cap, evicted count).
- **Rules & edge cases:**
  1. Cap = `security.max_concurrent_sessions` (default 5, form range 1-50; 0 disables).
  2. Evaluated once per session per cap value (marker in the session), not on every request, so a session only triggers eviction the first time it is seen after login or after the cap changes.
  3. Keep list = current session + most recent others until cap is reached; everything else for the user is deleted.
  4. Guest sessions (`user_id` null) and API tokens do not count. The Settings list merges rows by browser, so the count the user sees can be smaller than the number of session rows the cap counts.
- **Async & events:** audit row.
- **External systems:** none.
- **Settings:** `security.max_concurrent_sessions` (5).
- **Acceptance criteria:**
  - Given cap 2 and a user with 3 session rows, when the newest session makes a request for the first time, then the oldest row is deleted and an audit row records evicted 1.
  - Given cap 0, then nothing is evicted.
  - Given the user is within the cap, then no rows are deleted.
- **Source refs:** `app/Http/Middleware/LimitConcurrentSessions.php`.
- **Port notes:** enforce at refresh-token issuance (revoke oldest family when count > cap) rather than per request.

### WD-AUTH-035 — Password strength policy, max age, force-change flag

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-AUTH-037
- **Summary:** Admin-defined password rules (min length, upper+lower, number, symbol) apply when a new password is set through certain paths; a "max age" and a "force password change" flag exist but are not enforced on the live login.
- **Actors & access:** policy set by platform admins (WD-AUTH-037); applied to users in the paths below.
- **UX & screens:** Security Center -> Login and MFA "New-password rules (signup + password change only)": Min length (6-128), Uppercase, Number, Symbol toggles; "Password age limit (days, 0 = never)" (0-3650).
- **Endpoints:** none of its own; used by the routes below.
- **Data:** settings `security.password_min_length` (8), `security.password_require_upper` (true), `security.password_require_number` (true), `security.password_require_symbol` (false), `security.password_max_age_days` (0); columns `users.password_changed_at`, `users.force_password_change`.
- **Rules & edge cases:**
  1. `PasswordPolicy::rule()` builds a Laravel `Password` rule: min length = max(6, setting); mixedCase if upper; numbers; symbols. It is used ONLY by change-password (`POST account/password`) and the dead `AuthController::registerAccount`. The live sign-up and reset-password validate just `min:8|confirmed`; the mobile app and admin/owner reset paths have their own rules (MOB/WSP/ASHELL).
  2. `isStale(password_changed_at)`: policy 0 -> never stale; empty timestamp -> stale once a policy exists; unparsable -> not stale (fail open). It is called only by the dead controller, so the max-age soft notice never fires. New users created by the live register have no `password_changed_at`.
  3. `force_password_change` is written by: Security Center "Force password reset" (sets true for ALL users, WD-AUTH-039), admin user create/edit forms, admin workspace creation; cleared by change-password. QUIRK: no middleware, login or screen reads it, so the flag has no effect on users.
  4. Existing passwords are never invalidated by tightening the policy (it is never applied to login).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** the five keys above.
- **Acceptance criteria:**
  - Given policy min 12 + symbol, when a user changes their password to a weaker one, then validation fails.
  - Given a max age of 90 days (port behaviour), when a user signs in with a 100-day-old password, then they are forced to change it.
  - Given `force_password_change` true (port behaviour), when the user signs in, then they must set a new password before continuing.
- **Source refs:** `app/Support/PasswordPolicy.php`, `app/Http/Controllers/AccountController.php`, `app/Http/Controllers/AuthController.php`, `app/Http/Controllers/Admin/SecurityController.php`, `app/Http/Controllers/Admin/UsersController.php`.
- **Port notes:** centralise a `PasswordPolicyService` in the auth module and apply it in register, reset, change, invite acceptance and admin-set-password. Implement max-age and force-change as a `password_change_required` login response state. Use zxcvbn-style checks as an option, plus breached-password check.

### WD-AUTH-036 — Admin Security Center: screen, KPIs, risk queue

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-AUTH-037
- **Summary:** `/admin/security` is the platform owner's security dashboard: six live KPIs, a "risk items to review" queue taken from the audit log, a coverage panel, quick actions, and seven tabbed policy panels plus the danger zone, all inside one form.
- **Actors & access:** platform admin (`Authenticate`, `EnsureUserIsAdmin`, `IPAllowlist`). QUIRK: the seeded permissions `security.view` / `security.edit` are never checked; any admin (legacy `admin` role or Spatie Admin/Super Admin) can open and save the page. Only the five danger actions require Super Admin (WD-AUTH-039).
- **UX & screens:** `resources/views/admin/security/index.blade.php` + `resources/js/charts/admin-security-index.js`. Header ("Security and compliance", "View audit logs" link to `admin.audit-log.index`, "Save settings"), a search box (decorative). KPI strip: Security score, Open risks (+ high-priority count), Blocked attempts (last 24 hours), Campaign holds (waiting review), 2FA coverage (`enrolled/total admins enrolled`), Webhook failures (%). Tabs (client side, remembered per browser tab in `sessionStorage` key `wa:admin-security:tab` and in the URL hash): Summary, Login and MFA, WhatsApp guardrails, Abuse filters, API and webhooks, Devices, Danger zone. Summary tab: risk table (Severity pill, Signal, Workspace, Owner, Inspect link to the audit log filtered by signal; empty state "All clear - no failures or warnings in the last 7 days."), "Controls enabled" coverage bars, quick-action buttons (Rotate webhook secrets, Force password reset, Emergency stop / Resume). Validation errors show a banner "Nothing was saved - N field(s) were rejected." Success flash "N setting(s) saved.".
- **Endpoints:**

| Endpoint           | Route name           | Handler                        | Middleware                                   | Request | Response                                |
| ------------------ | -------------------- | ------------------------------ | -------------------------------------------- | ------- | --------------------------------------- |
| GET admin/security | admin.security.index | Admin\SecurityController@index | Authenticate, EnsureUserIsAdmin, IPAllowlist | -       | view with policy, kpis, risks, controls |

Save and danger actions are in WD-AUTH-037 and WD-AUTH-039.

- **Data:** reads `system_settings` (`security.*`, `platform.emergency_send_halt`), `audit_logs`, `users`, `workspaces`.
- **Rules & edge cases:**
  1. Open risks = audit rows with result failure or warning in the last 7 days; High priority = failure rows in the last 7 days.
  2. Blocked attempts = `auth.failed` audit rows in the last 24 hours (lockout-blocked attempts are not counted, only the failures).
  3. Campaign holds = ALL warning-result audit rows in the last 24 hours (placeholder metric; includes session timeouts, alerts etc.).
  4. 2FA coverage = share of `users.role = 'admin'` rows with `two_factor_confirmed_at` (legacy column only; Spatie admins are not counted; 0 when there are no such admins).
  5. Webhook failures = audit rows whose action contains "webhook" and result failure divided by all such rows in the last 24 hours, 2-decimals.
  6. Security score = 10 points for each of: `require_2fa_for_admins`, `wa_hold_on_scam_pattern`, `wa_require_template_review`, `abuse_block_finance_terms`, `abuse_block_short_links`, `webhook_signature_required`, `alert_on_new_device`, `alert_on_new_country`, session timeout > 0, lockout > 0. (The code defaults score 50: signature-required, both alerts, timeout and lockout.)
  7. Risk queue = 4 most recent failure/warning rows; severity high = failure < 24 h old, medium = older failure, watch = warning; "Signal" = action; detail = payload `_label` or `subjectType#id`; workspace name (or "<app name> Platform" for platform-layer rows); owner = actor name or "System".
  8. Coverage buckets (percent of toggles on): Admin access (2FA for admins, lockout > 0, timeout > 0, cap > 0), WhatsApp abuse prevention (scam pattern, template review, finance terms, short links), API hardening (signature required, api rate > 0, replay window > 0), Incident readiness (new-device alert, new-country alert, send halt NOT engaged).
  9. The phone-mask toggle was removed from the screen (WD-AUTH-042).
- **Async & events:** none (read model).
- **External systems:** none.
- **Settings:** all `security.*` keys (WD-AUTH-037).
- **Acceptance criteria:**
  - Given code defaults, when the page opens, then the score shows 50 and the KPI strip renders.
  - Given three `auth.failed` audit rows in the last 24 hours, then Blocked attempts = 3.
  - Given a failure audit row created 2 hours ago, then it appears in the risk queue with severity high and an Inspect link to the audit log filtered by its action.
  - Given no failure/warning rows in 7 days, then the queue shows the all-clear empty state.
- **Source refs:** `app/Http/Controllers/Admin/SecurityController.php`, `resources/views/admin/security/index.blade.php`, `resources/js/charts/admin-security-index.js`, `app/Models/AuditLog.php`, `Documentation/pages/admin-panel/security.html`.
- **Port notes:** read model over the audit table in `apps/api/src/modules/admin`; drive KPIs from indexed queries (action, result, created_at). Gate with a real permission (`platform.security.view` / `.edit`) registered in `permission_defs` (skill: rbac-permission) - WaDesk's unused `security.*` keys hint at the intent.

### WD-AUTH-037 — Security policy store, save and enforcement matrix

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** -
- **Summary:** All Security Center controls are persisted as `security.*` system settings through one PATCH form, validated with ranges, audited by changed field, and read everywhere through a cached `SecurityPolicy` reader that fails open. The matrix below is the authoritative list of what each control does (or does not do).
- **Actors & access:** platform admin (as WD-AUTH-036). Readers: middleware/services in many domains.
- **UX & screens:** the same page; every control is inside the one `<form method=POST action=admin.security.update>` (spoofed PATCH) with per-key hidden `0` inputs for checkboxes so that "off" is submitted. Panels listed under WD-AUTH-036.
- **Endpoints:**

| Endpoint             | Route name            | Handler                         | Middleware                                   | Request         | Response                                                      |
| -------------------- | --------------------- | ------------------------------- | -------------------------------------------- | --------------- | ------------------------------------------------------------- |
| PATCH admin/security | admin.security.update | Admin\SecurityController@update | Authenticate, EnsureUserIsAdmin, IPAllowlist | see field table | redirect to `admin.security.index` with "N setting(s) saved." |

- **Data:** `system_settings` rows `security.<key>` with type bool/int/json/string; description "Security policy: <key>". Reads are memoised per request by `SecurityPolicy` (which itself sits on the 30-minute `SystemSetting` cache; saves flush the key).
- **Rules & edge cases:**
  1. Booleans: the 16 toggle fields are coerced to concrete true/false before validation (an unchecked box posts a hidden 0), so turning something off persists. `mask_customer_numbers` is deliberately excluded (its own route, WD-AUTH-042).
  2. Validation (all `sometimes`; numeric ones also `nullable integer`): `allowed_2fa_methods.*` in totp,email,telegram; `session_timeout_minutes` 5-1440; `max_concurrent_sessions` 1-50; `lockout_after_failures` 1-50; `lockout_window_minutes` 1-1440; `password_min_length` 6-128; `password_max_age_days` 0-3650; `wa_guardrails_mode` off|monitor|enforce; `wa_max_sends_per_minute` 0-10000; `wa_max_sends_per_day` 0-1,000,000; `wa_hold_on_links_count` 0-50; `abuse_block_keyword_list` string max 5000; `api_rate_limit_per_minute` 1-100000; `webhook_replay_window_sec` 10-3600; `device_logout_on_inactive_days` 0-3650; `ip_allowlist_cidrs` string max 5000; `alert_channel` email|whatsapp|both; `audit_log_retention_days` 0-3650.
  3. A blank numeric input is skipped (keeps the stored value) instead of rejecting the whole form. The two list fields (keywords, CIDRs) split on newlines and commas, trim, drop empties (an empty textarea clears the list); duplicates are NOT removed (docs claim de-duplication).
  4. `allowed_2fa_methods` is an array of checkboxes: with none ticked the field is absent, so the previous value is kept (a list can never be emptied).
  5. Change tracking: only keys whose new value differs (strict `!==` against the stored/absent value) are recorded; if any changed, ONE audit row `admin.security.policy_updated` (layer platform) with `fields` and `changes {from,to}`. On the first save nearly every posted key differs from null, so the first audit row is huge.
  6. All posted keys are written even when unchanged (each becomes a row on first save).
  7. Defaults (`POLICY_KEYS`): require_2fa_* false; allowed_2fa_methods [totp,email]; session_timeout 60; max_concurrent_sessions 5; remember_me_enabled true; lockout 5 / 15; password min 8, upper on, number on, symbol off, max age 0; wa_guardrails_mode off; wa caps 0/0; scam pattern off; links 0; template review off; abuse finance/short links off, keywords []; api_rate 600; webhook_signature_required true; replay window 300; device_trust false; device_logout_on_inactive_days 30; ip allowlist off, []; alerts on/on, channel email; audit retention 365; mask_customer_numbers true. NOTE the documentation page lists different defaults (sends 60/5000, links 3, scam pattern on, template review on, finance/short links on) that the code does not use.
  8. `SecurityPolicy` readers are FAIL-OPEN: consumers wrap checks and allow the action on any error. The setting rows are cached; `SecurityPolicy::reset()` exists for tests.
  9. Enforcement matrix - key -> consumer -> status:
     - `require_2fa_for_all|admins|owners` -> Force2FA -> partial (WD-AUTH-032).
     - `allowed_2fa_methods` -> nothing -> not enforced (only TOTP exists).
     - `session_timeout_minutes` -> SessionTimeout -> enforced (WD-AUTH-033).
     - `max_concurrent_sessions` -> LimitConcurrentSessions -> enforced (WD-AUTH-034).
     - `remember_me_enabled` -> only the dead AuthController -> NOT enforced on the live login.
     - `lockout_after_failures`, `lockout_window_minutes` -> web login -> enforced (WD-AUTH-002); the mobile API uses hard-coded 6 attempts / 15 min.
     - `password_*` -> change-password only; max age unused (WD-AUTH-035).
     - `wa_guardrails_mode`, `wa_max_sends_per_minute|day`, `wa_hold_on_scam_pattern`, `wa_hold_on_links_count`, `abuse_block_finance_terms|short_links|keyword_list` -> SendGate -> enforced when mode is monitor/enforce (WD-AUTH-041).
     - `wa_require_template_review` -> nothing -> not enforced (counts toward the score only).
     - `api_rate_limit_per_minute` -> `ApiPlanRateLimit` (API domain): per-workspace bucket for `/api/v1`, plan limit overrides (plan value 0 = use this global; -1 = unlimited; global 0 = unlimited) -> enforced.
     - `webhook_signature_required` -> `WebhooksController` create form: an outbound webhook endpoint cannot be saved without a signing secret ("A signing secret is required by the platform security policy.") -> enforced only at endpoint creation.
     - `webhook_replay_window_sec` -> nothing (UI labels it "reserved"; inbound Meta/Twilio hooks already verify signatures).
     - `device_trust_required` -> nothing ("reserved").
     - `device_logout_on_inactive_days` -> `WaConnectController` device heartbeat: at most hourly, marks WhatsApp devices inactive+disconnected when `last_seen_at` is older than N days (0 disables; consumer default 0 although the form default shows 30) -> enforced (NODE/WADEV).
     - `ip_allowlist_enabled|cidrs` -> IPAllowlist -> enforced (WD-AUTH-038).
     - `alert_on_new_device|new_country|alert_channel` -> NewLoginAlertListener -> enforced, email only (WD-AUTH-018).
     - `audit_log_retention_days` -> audit log page inline sweep (once per 24 h, at most 10k rows per request) and `audit:prune` (not scheduled) -> enforced (NOTIF).
     - `mask_customer_numbers` -> nothing -> dead (WD-AUTH-042).
- **Async & events:** audit `admin.security.policy_updated`.
- **External systems:** none.
- **Settings:** the keys above; `platform.emergency_send_halt` is separate (WD-AUTH-040).
- **Acceptance criteria:**
  - Given the form is saved with lockout attempts 3, then `security.lockout_after_failures` = 3 and an audit row lists that field with from/to.
  - Given a toggle is unticked and saved, then the stored value becomes false.
  - Given `session_timeout_minutes` = 2, then validation fails and no setting changes.
  - Given a blank numeric field, then its stored value is unchanged and the form still saves.
  - Given the keyword list textarea "forex, quick money\nloan", then the stored list is [forex, quick money, loan].
- **Source refs:** `app/Http/Controllers/Admin/SecurityController.php`, `app/Support/SecurityPolicy.php`, `app/Models/SystemSetting.php`, `resources/views/admin/security/index.blade.php`, `Documentation/pages/admin-panel/security.html`.
- **Port notes:** model as a typed `SecurityPolicy` document in platform settings (Zod schema in `@crm/contracts`), one PATCH with partial semantics, one audit event with a diff. Keep the fail-open reader for send-path checks, but make auth-path readers fail closed (strict defaults). Do not copy the documented-but-different defaults; choose deliberately.

### WD-AUTH-038 — Admin IP allowlist

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-AUTH-037
- **Summary:** When enabled with at least one entry, only requests from listed IPs/CIDRs may use any `/admin/*` page; everyone else gets a 403 page showing their IP.
- **Actors & access:** middleware alias `ip.allowlist` on the admin route group (bootstrap `then()` wiring: `web`, `auth`, `admin`, `ip.allowlist`).
- **UX & screens:** `resources/views/errors/ip-blocked.blade.php` (403, shows the blocked IP so the admin can troubleshoot). Settings in Security Center -> Devices ("IP allowlist": Enable toggle, CIDR textarea one per line).
- **Endpoints:** applies to every route under `admin/*` (see manifests); no own route.
- **Data:** settings `security.ip_allowlist_enabled` (false), `security.ip_allowlist_cidrs` (array); audit row `admin.access.blocked_by_ip` (layer platform, result failure, meta ip, cidrs_count, path).
- **Rules & edge cases:**
  1. Disabled -> pass. Enabled but list empty -> pass (fail open, so an empty list cannot lock everyone out).
  2. Match rule: a bare IP without `/` is an exact string match; `a.b.c.d/N` or IPv6 `x::/N` compares packed bytes and the boundary byte's bits; v4 vs v6 mismatch never matches; unparsable entries never match. CIDR syntax is not validated at save time.
  3. The client IP is `$request->ip()`. QUIRK: trusted proxies default to `*` unless `TRUSTED_PROXIES` is set, which lets a client spoof `X-Forwarded-For` and bypass the allowlist; production must pin the proxy list.
  4. Only `/admin/*` routes are covered; the user app, API and webhooks are not.
  5. There is no self-lockout guard (nothing warns the admin if their own IP is not in the list).
- **Async & events:** audit on each block.
- **External systems:** none.
- **Settings:** `security.ip_allowlist_enabled`, `security.ip_allowlist_cidrs`; env `TRUSTED_PROXIES`.
- **Acceptance criteria:**
  - Given allowlist on with `203.0.113.0/24`, when a request from 203.0.113.9 opens `/admin`, then it is served.
  - Given the same setting, when a request from 198.51.100.4 opens `/admin`, then a 403 page shows that IP and an audit row is written.
  - Given allowlist on and an empty list, then all admins are allowed.
  - Given an IPv6 client and an IPv4-only list, then the request is blocked.
- **Source refs:** `app/Http/Middleware/IPAllowlist.php`, `bootstrap/app.php`, `resources/views/errors/ip-blocked.blade.php`, `resources/views/admin/security/index.blade.php`.
- **Port notes:** apply as a guard on the platform-admin controllers/route prefix; add a "your IP" hint and a self-lockout warning; take the client IP from a trusted-proxy-aware source only.

### WD-AUTH-039 — Danger zone: revoke all sessions, force reset, rotate secrets

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-AUTH-036
- **Summary:** Three irreversible platform-wide actions available only to a Super Admin: sign every user out, flag every user for a password reset, and rotate every workspace's webhook secret. The emergency send halt is WD-AUTH-040.
- **Actors & access:** Super Admin only: `PlatformPermissions::isSuperAdmin` = Spatie role `Super Admin` OR legacy `users.role` in super_admin, super-admin, platform-admin. A plain admin who posts is refused: flash "This emergency control requires Super Admin. Your account is missing that role." and an audit row `admin.security.danger_action_denied` (failure; meta route, reason). Buttons trigger data-confirm modals in the UI.
- **UX & screens:** Danger zone tab and the Summary quick actions; hidden sibling forms (`revoke-sessions-form`, `force-reset-form`, `rotate-webhooks-form`, halt/resume forms) submitted after the confirm modal. Labels: "Revoke ALL sessions - truncates sessions table", "Force password reset for ALL users - flips force_password_change", "Rotate ALL webhook secrets - existing integrations break".
- **Endpoints:**

| Endpoint                                   | Route name                            | Handler                                       | Middleware                                   | Request | Response                                                        |
| ------------------------------------------ | ------------------------------------- | --------------------------------------------- | -------------------------------------------- | ------- | --------------------------------------------------------------- |
| POST admin/security/danger/revoke-sessions | admin.security.danger.revoke          | Admin\SecurityController@revokeAllSessions    | Authenticate, EnsureUserIsAdmin, IPAllowlist | -       | back with "All sessions revoked. Every user must log in again." |
| POST admin/security/danger/force-reset     | admin.security.danger.reset           | Admin\SecurityController@forcePasswordReset   | same                                         | -       | back with "N users must reset their password on next login."    |
| POST admin/security/danger/rotate-webhooks | admin.security.danger.rotate-webhooks | Admin\SecurityController@rotateWebhookSecrets | same                                         | -       | back with "Rotated webhook secrets for N workspace(s)."         |

- **Data:** `DB::table('sessions')->truncate()` (including the admin's own session); `users` bulk update `force_password_change = true` (every user, also soft-deleted excluded by scope); if `workspaces.webhook_secret` exists, each workspace gets `whsec_` + 40 hex chars in chunks of 50 (QUIRK: that column does not exist in the shipped schema - `workspaces` has no `webhook_secret` - so the action rotates 0 workspaces; per-integration `webhook_secret` columns on Shopify/Woo rows are untouched).
- **Rules & edge cases:**
  1. Revoke-all does not touch Sanctum/API tokens or remember cookies (remember re-auth can silently restore sessions, unless `remember_token`s were rotated).
  2. Force reset only sets a flag that nothing enforces (WD-AUTH-035), so it currently changes nothing for users.
  3. Audit rows: `admin.security.sessions_revoked`, `admin.security.force_password_reset_all` (meta affected_users), `admin.security.webhook_secrets_rotated` (meta rotated), all result warning, layer platform.
  4. Actions are POST with CSRF; no re-authentication (password re-entry) is required, and no second-admin approval.
- **Async & events:** audit rows.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a Super Admin, when they confirm "Revoke ALL sessions", then the sessions table is empty, an audit row exists, and their next request requires login.
  - Given a plain admin, when they post the route, then nothing changes, they see the Super Admin message, and a denied-attempt audit row is written.
  - Given force reset, then every user has `force_password_change = 1` and the flash reports the count.
  - Given rotate webhooks on the shipped schema, then the flash reports 0 rotated (port should implement a real rotation of the workspace/webhook secrets it defines).
- **Source refs:** `app/Http/Controllers/Admin/SecurityController.php`, `app/Support/PlatformPermissions.php`, `resources/views/admin/security/index.blade.php`, `Documentation/pages/admin-panel/security.html`.
- **Port notes:** implement token revocation by bumping a global `auth_epoch`; require step-up (password/MFA) before these actions; make force-reset actually enforced (WD-AUTH-035); rotation must target the webhook secret storage the port defines (API/INTG).

### WD-AUTH-040 — Emergency send halt and resume

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-AUTH-039
- **Summary:** A platform-wide kill switch that makes WaDesk's PHP dispatchers refuse every outbound message until a Super Admin resumes sends.
- **Actors & access:** Super Admin only (same gate and denial audit as WD-AUTH-039).
- **UX & screens:** Danger zone / quick action button "EMERGENCY STOP all sends - platform-wide kill switch" which swaps to "Resume sends - currently HALTED" (green) when engaged; coverage bar "Incident readiness" counts "halt not engaged".
- **Endpoints:**

| Endpoint                          | Route name                   | Handler                                       | Middleware                                   | Request | Response                                                       |
| --------------------------------- | ---------------------------- | --------------------------------------------- | -------------------------------------------- | ------- | -------------------------------------------------------------- |
| POST admin/security/danger/halt   | admin.security.danger.halt   | Admin\SecurityController@emergencyStopSends   | Authenticate, EnsureUserIsAdmin, IPAllowlist | -       | back "Emergency stop engaged. ALL outbound sends are blocked." |
| POST admin/security/danger/resume | admin.security.danger.resume | Admin\SecurityController@emergencyResumeSends | same                                         | -       | back "Sends resumed."                                          |

- **Data:** `system_settings` key `platform.emergency_send_halt` (bool). Audit `admin.security.emergency_halt_engaged` (warning) / `admin.security.emergency_halt_released` (success).
- **Rules & edge cases:**
  1. `SendGate::halted()` memoises the flag per request; `SendGate::guard()` throws `RuntimeException` ("Outbound sends are paused (platform emergency halt is engaged). Resume sends from /admin/security -> Danger zone.").
  2. Enforced in `WhatsAppDispatcher::dispatch` (returns platform `halted`, `ok=false`, logged) and `InboxDispatcher` (team-inbox/1:1 sends). QUIRK / gap: `SendGate::screenBody` (used by campaigns, broadcasts, scheduled) does not call `guard()`, and the Node bridge has no reference to the flag, so bulk sends already handed to Node are NOT stopped. Verify at parity time which paths honour the halt.
  3. The halt is not per-workspace and is not automatic (no auto-trigger).
  4. Setting cache TTL is 30 minutes but saves flush the key immediately.
- **Async & events:** audit rows.
- **External systems:** none.
- **Settings:** `platform.emergency_send_halt`.
- **Acceptance criteria:**
  - Given the halt is engaged, when an agent sends a 1:1 reply, then the send is refused with the halt error and no provider call is made.
  - Given the halt is released, then sends work again.
  - Given a plain admin posts halt, then it is refused and audited.
- **Source refs:** `app/Http/Controllers/Admin/SecurityController.php`, `app/Support/SendGate.php`, `app/Services/WhatsAppDispatcher.php`, `app/Services/InboxDispatcher.php`.
- **Port notes:** put the flag in Redis + Postgres and check it in the shared outbound-send port (all channels) and in the BullMQ send workers, so bulk jobs also stop; include a per-org variant later.

### WD-AUTH-041 — WhatsApp send guardrails (SendGate)

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-AUTH-037
- **Summary:** An optional pre-send screen: per-workspace rate caps and content filters (link count, scam phrases, finance-spam phrases, URL shorteners, custom keywords) evaluated in one of three modes - off, monitor (log only), enforce (block).
- **Actors & access:** system, invoked by send pipelines; configured on Security Center tabs "WhatsApp guardrails" and "Abuse filters".
- **UX & screens:** master mode select ("Off (no checks)", "Monitor (log only)", "Enforce (block)") with an explanatory text; "Hard caps" (max sends per minute, per day, hold if links exceed), "Anti-spam controls" (scam pattern toggle, "require template review" toggle - unused), "Workspace health" card (link to workspaces), Abuse filters (finance terms, short links, keyword list).
- **Endpoints:** none (saved through WD-AUTH-037).
- **Data:** reads `security.wa_*`, `security.abuse_*`; cache counters `wa-rl-min:{ws}:{YmdHi}` (TTL 120 s) and `wa-rl-day:{ws}:{Ymd}` (TTL 90000 s); audit rows `security.send_flagged` (monitor) / `security.send_blocked` (enforce), result warning, meta reason + context.
- **Rules & edge cases:**
  1. `screen(workspaceId, body, ctx)` (1:1 dispatchers): halt guard first (always on), then mode; off -> return. Content checks, then rate checks; a violation in monitor mode logs + audits and allows; in enforce throws "Send blocked by security policy (<reason>)."
  2. `screenBody(body, ctx)` (campaign, broadcast, scheduled): FIRST a wallet pre-check (`MessageBillingService::precheck(ws, count)`; empty wallet blocks the batch regardless of mode, audited `billing.send_blocked_no_wallet`), then content-only checks once per batch; no rate caps (bulk has its own pacing). Broadcasts pass an empty body, so content rules never see broadcast text.
  3. Content order: link count (`https?://` occurrences > limit), scam regex (won/prize/verify-account/suspended-account/click-to-confirm/urgent-action/KYC/double-money/risk-free phrases), finance regex (guaranteed returns, binary options, forex signals, crypto doubling, loan approved, earn-per-day, investment opportunity, get rich quick), short-link domains (bit.ly, tinyurl, t.co, goo.gl, ow.ly, is.gd, buff.ly, rebrand.ly, cutt.ly, rb.gy, shorturl.at, tiny.cc, bit.do, soo.gd, clck.ru, t2m.io, shorte.st, adf.ly, short.io), then each custom keyword (case-insensitive substring). First hit wins.
  4. Rate caps are per workspace, per calendar minute (`YmdHi`) and per calendar day (`Ymd`) counters in the cache. A check at or over the cap returns the violation without incrementing; a check under the cap increments it (the per-minute counter is bumped even when the per-day check then blocks). Windows are fixed calendar buckets, not sliding. Limit 0 = unlimited.
  5. Everything except the halt is fail-open: any exception in a check logs a warning and allows the send.
  6. Empty/whitespace bodies pass content checks.
- **Async & events:** audit rows; Laravel log lines `[SENDGATE]`.
- **External systems:** none.
- **Settings:** `security.wa_guardrails_mode` (off), `wa_max_sends_per_minute` (0), `wa_max_sends_per_day` (0), `wa_hold_on_scam_pattern` (false), `wa_hold_on_links_count` (0), `abuse_block_finance_terms` (false), `abuse_block_short_links` (false), `abuse_block_keyword_list` ([]).
- **Acceptance criteria:**
  - Given mode enforce and links limit 2, when a 1:1 message has 3 URLs, then the send is refused with the link-count reason and `security.send_blocked` is audited.
  - Given mode monitor, then the same message is sent and `security.send_flagged` is audited.
  - Given mode off, then no checks run (only the halt guard).
  - Given per-minute cap 2 in enforce mode, when a workspace attempts a third send in the same minute, then it is refused.
  - Given the wallet is empty, when a campaign is started, then it is blocked before any content check even in mode off.
- **Source refs:** `app/Support/SendGate.php`, `app/Services/WhatsAppDispatcher.php`, `app/Services/InboxDispatcher.php`, `app/Http/Controllers/ScheduledController.php`, `app/Http/Controllers/BroadcastsController.php`, `app/Http/Controllers/WaCampaignsController.php`, `resources/views/admin/security/index.blade.php`.
- **Port notes:** implement as a `SendPolicy` step in the outbound pipeline (BullMQ producer side) so all channels share it; keep the three modes; store rules (regex lists) as data so admins can tune them. Wallet precheck belongs to WALLET; the split keeps the same order.

### WD-AUTH-042 — Customer phone-number masking toggle

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-AUTH-037
- **Summary:** An old privacy feature to display customer phone numbers as `xxxxxxxx8988`. It was disabled product-wide: the display helper now returns numbers unchanged, the admin toggle was removed from the page, and the route that saves the toggle has no form.
- **Actors & access:** platform admin (route), all UI (helper).
- **UX & screens:** none (a removed-comment placeholder remains in the Security Center view).
- **Endpoints:**

| Endpoint                 | Route name          | Handler                           | Middleware                                   | Request                      | Response                                    |
| ------------------------ | ------------------- | --------------------------------- | -------------------------------------------- | ---------------------------- | ------------------------------------------- |
| POST admin/security/mask | admin.security.mask | Admin\SecurityController@saveMask | Authenticate, EnsureUserIsAdmin, IPAllowlist | mask_customer_numbers (bool) | back with "Phone masking turned ON/OFF ..." |

- **Data:** setting `security.mask_customer_numbers` (default true) - stored but not read by `mask_phone()`; audit `admin.security.policy_updated` with meta fields [mask_customer_numbers].
- **Rules & edge cases:**
  1. `mask_phone($number, $visible = 4)` (global helper in `security_helpers.php`, about 58 call sites) trims and returns the input unchanged; the masking code after the early return is unreachable. The clamp for visible digits (2-4) and the separator-preserving algorithm remain in source for a future switch.
  2. The docs page for Security does not mention it.
  3. The setting is still listed in `POLICY_KEYS` so it appears in `loadPolicy()`.
- **Async & events:** audit on save.
- **External systems:** none.
- **Settings:** `security.mask_customer_numbers`.
- **Acceptance criteria:**
  - Given `mask_phone("919145808988")`, then the same number is returned (parity with v1.7.0).
  - Given a POST to the mask route, then the setting is saved and an audit row written but no visible behaviour changes.
- **Source refs:** `app/Support/security_helpers.php`, `app/Http/Controllers/Admin/SecurityController.php`.
- **Port notes:** do NOT port as active. If masking is desired later, implement it as an RBAC field-level permission (agents see masked, admins see full) instead of a global toggle; this decision needs an ADR-level note (privacy tradeoff).

### WD-AUTH-043 — Secure upload guard

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** -
- **Summary:** One shared validator that every user-media upload runs through so executable or active-content files can never be stored, and stored names are random.
- **Actors & access:** used by flow-media, scheduled-message media, auto-reply media and REST `/api/v1` media/template uploads (callers in FLR/SCHED/AR/API domains).
- **UX & screens:** callers surface the returned message ("The uploaded file is invalid.", "This file type is not allowed.", "This file content is not allowed.").
- **Endpoints:** none (library); callers: `ScheduledController`, `AutoReplyController` (2 sites), `FlowsController`, `Api\V1\MediaController`, `Api\V1\TemplateController`.
- **Data:** none.
- **Rules & edge cases:**
  1. Extension check on the client filename (lowercased): empty or in the blocked list (php, phtml, php3-7, phps, pht, phtm, phar, htaccess, htm, html, svg, xml, xhtml, js, mjs, cgi, pl, py, sh, exe, bat, com, jsp, asp, aspx) -> refuse; not in the allowlist -> refuse. Allowlist: jpg, jpeg, png, gif, webp, bmp, tiff; mp4, webm, mov, 3gp, mkv; pdf, doc, docx, xls, xlsx, ppt, pptx; txt, csv, rtf, zip; mp3, ogg, opus, m4a, aac, wav, amr.
  2. Content sniff: finfo MIME of the real bytes (not the client header) must be in the allowed MIME list (images, video, PDF, Office, plain text/CSV/RTF, zip, audio variants, and `application/octet-stream` for libmagic gaps); an empty sniff passes.
  3. Stored name = `<unix time>_<24 random chars>.<allowlisted ext>` (fallback `bin`); never the client name.
  4. Only the guard exists here; per-endpoint size limits are in each caller.
  5. QUIRK: profile photos, branding logos and auth-page media use their own Laravel `image`/`mimes` rules, not this class.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a file named `evil.php`, then it is refused as not allowed.
  - Given `logo.png` whose bytes are actually HTML, then it is refused as content not allowed.
  - Given `report.pdf`, then it passes and the stored name is `<time>_<random>.pdf`.
  - Given `x.svg`, then it is refused.
- **Source refs:** `app/Support/SecureUpload.php`, `app/Http/Controllers/FlowsController.php`, `app/Http/Controllers/ScheduledController.php`, `app/Http/Controllers/AutoReplyController.php`, `app/Http/Controllers/Api/V1/MediaController.php`, `app/Http/Controllers/Api/V1/TemplateController.php`.
- **Port notes:** put in a shared `UploadPolicy` used by the storage adapter's presign step; sniff on the finalised object (S3 event) since bytes arrive at storage, not the API. Add virus scanning hook and per-type size limits.

### WD-AUTH-044 — HTML sanitiser for rich text

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** -
- **Summary:** An allow-list DOM sanitiser (`wadesk_sanitize_html`) that strips script-bearing markup from user-authored rich text before it is rendered raw on public pages.
- **Actors & access:** used by the storefront product template for `product.body_html` (CAT/STORE domains); public visitors are the audience.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. Removes whole elements (with content): script, iframe, object, embed, style, form, link, meta, base, frame, frameset, applet, noscript, template, svg, math, audio, video, source.
  2. On every remaining element removes all `on*` attributes and inline `style`; strips `href, src, xlink:href, action, formaction, background, poster, cite` values whose scheme (after removing whitespace/control chars, case-insensitive) is javascript, vbscript, data or about.
  3. Empty input -> empty string; if the HTML cannot be parsed the input is HTML-escaped (fail closed). Uses `DOMDocument::loadHTML` with `LIBXML_NONET`.
  4. QUIRK: it is a deny-list of tags (unknown tags such as `<img>`, `<a>`, custom elements survive) despite the "allow-list" docblock; tag attributes other than the ones above (e.g. `srcset`, `formaction` on buttons removed only because named) pass.
  5. Product body HTML is stored verbatim by the product controller and importers; sanitising happens only at render time.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `<p onclick="x()">Hi</p><script>alert(1)</script>`, then the output is `<p>Hi</p>`.
  - Given `<a href="javascript:alert(1)">x</a>`, then the href attribute is removed.
  - Given malformed unparsable input, then escaped text is returned.
- **Source refs:** `app/Support/html_sanitize.php`, `resources/views/storefront/_partials/product.blade.php`.
- **Port notes:** use a maintained sanitiser (DOMPurify server-side / `sanitize-html` with an explicit allow-list) at write time and read time; keep the same block list as a minimum.

### WD-AUTH-045 — HTTP security headers

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** -
- **Summary:** Every web response gets clickjacking and transport hardening headers, with deliberate exceptions for the embeddable chatbot widget and the Shopify embedded app.
- **Actors & access:** middleware `SecurityHeaders`, appended to the `web` group (all HTML responses, public and authenticated).
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. Always: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (only if not already set); `Strict-Transport-Security: max-age=31536000; includeSubDomains` only when the request is secure.
  2. Auth pages (`login`, `register`, `logout`, `forgot-password`, `reset-password[/*]`, `password/*`) also get `Cache-Control: no-store, no-cache, must-revalidate, max-age=0` and `Pragma: no-cache`.
  3. Paths `widget` or `widget/*` return early - framable cross-origin (protected by embed token + `widget.cors`).
  4. Shopify embed context (path `shopify[/*]`, or request has both `host` and `shop`, or the embed marker cookie) sets CSP `frame-ancestors 'self' https://*.myshopify.com https://admin.shopify.com` and omits `X-Frame-Options`.
  5. Everything else: `X-Frame-Options: SAMEORIGIN` and CSP `frame-ancestors 'self'` (only if no CSP already set). The same-origin live editor and `/devices?embed=1` iframes keep working.
  6. No full CSP (script-src etc.), no Permissions-Policy.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none (proxy trust via `TRUSTED_PROXIES`).
- **Acceptance criteria:**
  - Given any authenticated page, then the response has `X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'`.
  - Given `/widget/{token}/chat`, then no frame restriction is added.
  - Given an HTTPS request, then HSTS is present; over HTTP it is absent.
  - Given `/login`, then `Cache-Control` includes `no-store`.
- **Source refs:** `app/Http/Middleware/SecurityHeaders.php`, `bootstrap/app.php`.
- **Port notes:** set in Nest/`helmet` config and in the Next.js `headers()`; add a real CSP for the port; keep the widget exemption and per-route `frame-ancestors` rule.

### WD-AUTH-046 — Security audit log writer

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-AUTH-030, WD-AUTH-031
- **Summary:** A small facade writes account-security events to `security_audit_log` (who, workspace, event, status, IP, user agent, JSON payload). Failures never break the caller. Nothing in the app reads this table.
- **Actors & access:** system, called from the Settings security handlers.
- **UX & screens:** none. Docs say the admin Security dashboard presents these entries; in reality that dashboard reads `audit_logs` (WD-AUTH-036) and there is no viewer for `security_audit_log`.
- **Endpoints:** none.
- **Data:** table `security_audit_log` (see Data model). Events written: `two_factor_failed` (status failed), `two_factor_enabled` (success), `two_factor_disabled` (info), `session_revoked` (success, session_id), `all_sessions_revoked` (success, count), `workspace_deleted` (info, workspace id + name), `data_residency_changed` (info). Password-change events are NOT written here (change-password writes an in-app notification instead), contrary to the docs.
- **Rules & edge cases:**
  1. Insert wrapped in try/catch; user agent truncated to 255; payload JSON (unicode unescaped) or null; workspace = user's current workspace id.
  2. The audit-log retention job prunes `audit_logs`, never `security_audit_log`, so this table grows without bound.
  3. Passwords are never included.
- **Async & events:** synchronous insert.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a wrong TOTP code on enrolment, then a row event `two_factor_failed` status `failed` with IP and user agent exists.
  - Given the audit insert throws, then the user action still completes.
- **Source refs:** `app/Support/SecurityAuditLogger.php`, `app/Http/Controllers/SettingsTabsController.php`.
- **Port notes:** collapse into the single audit stream (`audit` table written in the same transaction as the change, ADR-0005/0009); add `mfa.*`, `session.*`, `password.changed` event names; give it a viewer in the admin module.

### WD-AUTH-047 — Encryption at rest of auth secrets

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** -
- **Summary:** Sensitive values used by this domain are stored encrypted, passwords are one-way hashed, and lookups tolerate legacy plain rows.
- **Actors & access:** system (model casts and `SystemSetting`).
- **UX & screens:** admin forms show "saved - leave blank to keep" instead of secrets.
- **Endpoints:** none.
- **Data:** `users.two_factor_secret` and `two_factor_recovery_codes` (Laravel `encrypted` cast, hidden from serialisation), `users.password` (`hashed` cast, bcrypt default), `users.passcode` (mobile PIN, hashed, hidden), `users.remember_token`, `system_settings` values for `social_google_client_secret`, `social_facebook_client_secret`, `recaptcha_secret`, `node_webhook_token` and the other keys in `SystemSetting::ENCRYPTED_KEYS` (encrypt on write, decrypt on read, plain legacy rows still readable, first save flips them).
- **Rules & edge cases:**
  1. Encryption key is `APP_KEY`; losing/changing it makes every encrypted value unrecoverable (docs warn; decryption failures for settings fall back to the raw value, for model casts they throw).
  2. Sanctum tokens are stored as SHA-256 hashes by the framework (`personal_access_tokens`).
  3. Sheets add-on API keys are stored as a SHA-256 hash plus an 8-char suffix (EXT).
  4. `Audit::log` redacts payload values whose key looks secret-like (password, secret, token, api_key, credential, private, access_key, client_secret, webhook, signing, bearer) to `[REDACTED]` (NOTIF).
  5. The reset-password token in `password_reset_tokens` is hashed by the broker.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `.env` `APP_KEY`.
- **Acceptance criteria:**
  - Given a saved reCAPTCHA secret, then the `system_settings.value` is ciphertext and `RecaptchaService::secret()` returns the plaintext.
  - Given 2FA enabled, then `users.two_factor_secret` in the database is ciphertext.
  - Given a user serialised to JSON, then password, passcode, remember token and 2FA fields are absent.
- **Source refs:** `app/Models/User.php`, `app/Models/SystemSetting.php`, `app/Support/Audit.php`, `Documentation/pages/security/data-privacy.html`.
- **Port notes:** use envelope encryption (KMS/`pgcrypto` or app-level AES-GCM with key id) for secrets, argon2id for passwords (ADR-0007), and never return secrets over the API. Key rotation must be possible, unlike WaDesk.

### WD-AUTH-048 — Legacy AuthController login and register

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** -
- **Summary:** `AuthController` still contains a full login, logout, register-step-1 implementation and views that no route reaches (the live routes point to `AuthPagesController`). It differs in ways a rebuilder might mistake for current behaviour.
- **Actors & access:** none (unrouted). The live parts of this controller are register step 2/3 and workspace switch (WD-AUTH-008..010).
- **UX & screens:** `auth/register/step1.blade.php` (dead layout: name, email, password, confirm, agree - no mobile) is only used by the dead `showRegister`.
- **Endpoints:** none routed (`showLogin`, `login`, `logout`, `showRegister`, `registerAccount`).
- **Data:** would write `users` with `role = 'U'`, `site_name`, `password_changed_at`.
- **Rules & edge cases:** (what differs from live behaviour)
  1. Login honours `security.remember_me_enabled`, uses "Incorrect email or password.", writes `auth.failed` explicitly, accepts a validated local `?next=` redirect (must start with a single `/`), flashes "Welcome back, <name>." and checks password max age (sets `force_password_change` and a warning flash) - none of which the live login does.
  2. Register step 1 requires mobile (regex `^[0-9()+\-\s]{6,20}$`, max 20) and country code, applies `PasswordPolicy::rule()`, strips whitespace from the mobile, sets `password_changed_at`, generates `site_name` (slug of name + 4 random chars), sends a welcome notification and sets role `U`.
  3. It also repeats the invite-acceptance update with diagnostic logging.
- **Async & events:** would write notification "Welcome to <app name>".
- **External systems:** none.
- **Settings:** `remember_me_enabled`, `password_*`.
- **Acceptance criteria:**
  - Given the v1.7.0 route table, when any of the dead methods' URLs are requested, then they resolve to `AuthPagesController` behaviour, not these.
  - Given the port, when deciding rules for the remember-me toggle, password policy at sign-up and max-age enforcement, then the dead-code behaviour is the intended spec and should be implemented (recorded as a deliberate improvement over live WaDesk).
- **Source refs:** `app/Http/Controllers/AuthController.php`, `resources/views/auth/register/step1.blade.php`.
- **Port notes:** do not port the code; port only the intent listed above where it improves security.

### WD-AUTH-049 — Install-wizard file session

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** -
- **Summary:** During installation the database does not exist yet, so the install routes force file-based sessions with a fixed cookie name that survives the wizard rewriting `APP_NAME`.
- **Actors & access:** middleware alias `install.session` (`UseFileSession`) on the installer routes (INST owns the wizard).
- **UX & screens:** none.
- **Endpoints:** applies to the install wizard routes only (see INST).
- **Data:** filesystem sessions under `storage/framework/sessions`.
- **Rules & edge cases:**
  1. Overrides config at runtime: `session.driver = file`, `session.encrypt = false`, `session.cookie = wadesk_install_session`.
  2. Other auth middleware (`EnsureUserActive`, `SessionTimeout`, `Force2FA`, `LimitConcurrentSessions`) all short-circuit when `storage/installed` is missing, for the same reason.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an uninstalled instance, when the wizard runs across steps, then step state persists even after the app name changes.
  - Given the app is installed, then normal database sessions are used.
- **Source refs:** `app/Http/Middleware/UseFileSession.php`, `bootstrap/app.php`.
- **Port notes:** not needed on the target (no installer); listed for parity tracking only - mark wontfix in the tracker unless INST decides otherwise.

## Data model

### `users` (model `User`) - identity, credentials, profile, 2FA, referral, wallet counters

Global (not workspace-scoped). Soft-deleted (`deleted_at`); the unique email index stays active after soft delete, which is why deletion rewrites the email. Auto-audited by `AuditableObserver`. Row volume: one per human, thousands to low millions. Written by WD-AUTH-001/004/005/006/014/017/025-028/030/035/039; read by nearly every domain.

| Column                                                      | Type / null / default                              | Behaviour                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                                                          | bigint unsigned PK                                 |                                                                                                                                                                                                                                   |
| name                                                        | varchar(255) not null                              | display name at sign-up; set to "Deleted user" on deletion                                                                                                                                                                        |
| display_name                                                | varchar(120) null                                  | friendly name; blank -> null; falls back to first name on read                                                                                                                                                                    |
| email                                                       | varchar(255) not null, UNIQUE `users_email_unique` | login id; verification hash = sha1(email); rewritten to `deleted-{id}-{rand}@deleted.local` on deletion                                                                                                                           |
| locale                                                      | varchar(12) null                                   | UI language (I18N)                                                                                                                                                                                                                |
| site_name                                                   | varchar(255) null, UNIQUE                          | slug; only the dead register sets it                                                                                                                                                                                              |
| referral_code                                               | varchar(16) null, UNIQUE                           | auto-generated 10 chars on create from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (CPN)                                                                                                                                                    |
| referred_by_user_id                                         | bigint null FK users ON DELETE SET NULL, indexed   | referral attribution (CPN)                                                                                                                                                                                                        |
| wallet_credits, wallet_currency_minor                       | bigint unsigned default 0                          | wallet counters (WALLET)                                                                                                                                                                                                          |
| wallet_currency_code                                        | varchar(3) default INR                             | (WALLET)                                                                                                                                                                                                                          |
| mobile                                                      | varchar(32) null                                   | stored as typed; combined with `country_code` for OTP                                                                                                                                                                             |
| country_code                                                | varchar(8) null                                    | dial code including `+`                                                                                                                                                                                                           |
| address, city, state, country, zip, notes                   | text/varchar null                                  | admin-managed profile fields (ASHELL)                                                                                                                                                                                             |
| force_password_change                                       | tinyint(1) default 0                               | set by admin actions; never enforced (WD-AUTH-035)                                                                                                                                                                                |
| welcome_email_sent_at                                       | timestamp null                                     | admin welcome mail (ASHELL)                                                                                                                                                                                                       |
| avatar_path                                                 | varchar(191) null                                  | relative media-disk path or absolute provider URL                                                                                                                                                                                 |
| role                                                        | varchar(255) not null default `user`               | legacy platform role string: `user`, `admin`, `A`, `U`, `suspended`, `super_admin`/`super-admin`/`platform-admin`; consulted by EnsureUserActive, Force2FA, PlatformPermissions, KPIs; Spatie roles are the canonical RBAC (RBAC) |
| email_verified_at                                           | timestamp null                                     | set by verify link, auto-verify, social sign-in                                                                                                                                                                                   |
| mobile_verified_at                                          | timestamp null                                     | set only when sign-up proved the number by OTP                                                                                                                                                                                    |
| password                                                    | varchar(255) not null                              | bcrypt via `hashed` cast; random for social accounts                                                                                                                                                                              |
| passcode                                                    | varchar(255) null                                  | mobile PIN (MOB), hashed                                                                                                                                                                                                          |
| password_changed_at                                         | timestamp null                                     | set on reset/change (and by dead register)                                                                                                                                                                                        |
| social_provider                                             | varchar(20) null                                   | google or facebook                                                                                                                                                                                                                |
| social_provider_id                                          | varchar(191) null                                  | provider subject; composite index `users_social_idx` (provider, id) NOT unique                                                                                                                                                    |
| two_factor_enabled                                          | tinyint(1) default 0                               | shared by web TOTP and mobile WhatsApp-OTP semantics                                                                                                                                                                              |
| two_factor_secret                                           | text null                                          | encrypted base32 TOTP secret                                                                                                                                                                                                      |
| two_factor_confirmed_at                                     | timestamp null                                     | when enrolment succeeded                                                                                                                                                                                                          |
| two_factor_recovery_codes                                   | text null                                          | encrypted; never populated                                                                                                                                                                                                        |
| theme_preference                                            | varchar(16) default `paper`                        | paper/bright/dark (Settings appearance, WSP/SET)                                                                                                                                                                                  |
| auto_ai_summarize_enabled                                   | tinyint(1) default 0                               | personal pref (AICRM)                                                                                                                                                                                                             |
| remember_token                                              | varchar(100) null                                  | "keep me signed in" token; rotated on password change/reset                                                                                                                                                                       |
| inbox_last_seen_at                                          | timestamp null                                     | (TIB1)                                                                                                                                                                                                                            |
| current_workspace_id                                        | bigint null                                        | active workspace (WSP)                                                                                                                                                                                                            |
| quick_access                                                | json null                                          | user nav shortcuts (ASHELL)                                                                                                                                                                                                       |
| has_seen_intro                                              | tinyint(1) default 0                               | product tour flag                                                                                                                                                                                                                 |
| sheets_api_key_hash / _suffix / _created_at / _last_used_at | varchar(64)/varchar(12)/timestamps null            | Sheets add-on key (EXT); hash indexed                                                                                                                                                                                             |
| created_at, updated_at, deleted_at                          | timestamps                                         |                                                                                                                                                                                                                                   |

### `sessions` (Laravel database session driver)

`id` varchar PK, `user_id` bigint null (indexed), `ip_address` varchar(45), `user_agent` text, `payload` longtext, `last_activity` int (indexed). One row per browser session id (the id is regenerated on login, so a browser can leave several rows). Deleted by: logout/invalidate, password change/reset (all or all-but-current), revoke actions, LimitConcurrentSessions, admin force-logout (ASHELL), Security Center revoke-all (truncate). Session GC lottery 2/100; lifetime 10080 minutes. Read by WD-AUTH-031/033/034.

### `password_reset_tokens`

`email` varchar PK, `token` varchar (hashed), `created_at`. One live token per email; expiry 60 minutes enforced by the broker; expired rows are only removed by the unscheduled `auth:clear-resets`. The mobile forgot-password OTP also stores its code here (MOB).

### `security_audit_log`

`id` bigint PK, `user_id` bigint null (indexed), `workspace_id` bigint null (indexed), `event` varchar(64), `status` varchar(16) (`success` | `failed` | `info`), `ip` varchar(64), `user_agent` varchar(255), `payload` json null, `created_at` timestamp default now (indexed). Append-only, write-only in practice (no reader), never pruned. Written by WD-AUTH-046.

### Tables read or updated but owned elsewhere

`workspace_user` (WSP; `joined_at` set on login), `workspaces` (WSP; created in WD-AUTH-008, `timezone`, `branding_footer`), `audit_logs` (NOTIF; KPI source and login/alert events), `system_settings` (SET; all `security.*`, `auth.*`, `social_*`, `recaptcha_*`, `registration_*`, `auto_verify_email`, `platform.emergency_send_halt`), `personal_access_tokens` (MOB/API; revoked on password events), `user_otps` (MOB; mobile 2FA/OTP codes), `packages`/`credit_packages` (PLAN/CPN; read at onboarding), `referrals` (CPN), `wa_templates`/`devices`/`wa_provider_configs` (registration OTP sender), Spatie tables `roles`, `model_has_roles` (RBAC).

### `system_settings` keys used by this domain (type, default)

- `security.*`: see WD-AUTH-037 for all 33 keys, ranges and consumers; `platform.emergency_send_halt` (bool false).
- `auth.variant` (string "1"-"5"), `auth.{login|register|forgot}.{eyebrow,heading,heading_accent,subheading,accent,media_url,media_type}` and login/register showcase keys `hero_title, hero_desc, footer, stat1_num..stat3_label, feat1_title..feat4_desc, inside_heading, chip1..chip6`.
- `social_google_enabled|client_id|client_secret*`, `social_facebook_enabled|client_id|client_secret*`, mobile-only `social_google_ios_client_id`, `social_google_android_client_id` (* encrypted).
- `recaptcha_enabled|version|site_key|secret*|v3_threshold`.
- `registration_otp_enabled|sender|template_id|ttl_minutes|length|resend_cooldown_sec|max_attempts` (+ legacy `registration_otp_device_id`).
- `auto_verify_email` (true), `public_registration` (true, unused), `registration_default_plan_id`, `registration_trial_days` (14).
- `privacy_terms_url`, `privacy_policy_url`, `privacy_cookies_policy_url` (auth-page footer links, SET), `default_country_code`/`default_country_iso`, `default_timezone`, `app_name`.

## Cross-domain contracts

Consumes:

- **SET** (`platform-settings-branding-storage`): the `system_settings` store and its encrypted-key mechanism, mail transport config (verification, reset and alert emails), media disk / cloud storage for avatars and auth-page media, `brand_name()`/`Brand::logoUrl()`, privacy URLs, default country/timezone.
- **PLAN** (`plans-subscriptions-trials`): default plan resolution (`registration_default_plan_id`, `is_default`, free plan), `isFreePlan()`, trial fields (`trial_ends_at`, `billing_cycle`), plan feature gate `remove_branding` via `PlanLimitGuard::feature`, plan/pricing data for the onboarding plan step and checkout route `user.checkout.show`.
- **CPN** (`coupons-credits-referral-currency`): `ReferralService::findReferrer/attribute`, `CaptureReferral` cookie (`wadesk_ref`, 30 days), signup reward setting.
- **WSP** (`workspaces-teams-tenancy`): `Workspace` model, `generateSlug`, `workspace_user` membership and roles (owner/admin/agent/viewer), `ResolveTenantDomain::isTenant`, `switchWorkspace`, the `GET settings` page that hosts the Security pane, `WorkspaceMembersController::resetPassword` (member password reset by owners; should share the password policy).
- **RBAC** (`roles-permissions`): Spatie roles, `PlatformPermissions` (`userHasPlatformAccess`, `isSuperAdmin`), seeded but unused permission keys `security.view`/`security.edit`.
- **NOTIF** (`notifications-activity-audit`): `Audit::log`, `AuditLogger`, `audit_logs` (login, logout, failed, lockout, alerts, policy updates), `NotificationHelper::toUser` (profile updated, password changed, workspace created), the audit-log viewer and retention sweep (`audit:prune`).
- **WADEV / WABA / NODE**: senders for registration OTP (Node bridge `/api/send-message/{number}` with `X-Node-Token`, `TemplateSender`, Twilio config in `wa_provider_configs`), template submission for the OTP template, `NodeCacheBuster::bustWorkspace` after footer changes.

Exposes:

- **To MOB** (`mobile-app-api`): `RegistrationOtpService` (isActive, send, ttl, cooldown), `SocialAuthService` client ids/secrets, `PasswordPolicy`, referral attribution, `users.two_factor_*`, `users.passcode`, lockout convention. Mobile login gates on `two_factor_enabled` with WhatsApp OTP - a different second factor than web TOTP.
- **To ASHELL / RBAC**: `EmailVerificationController::send(User)` (admin resend), the `force_password_change` flag, `sessions` table (admin force-logout `POST admin/users/{id}/force-logout`, owned by ASHELL), suspend-by-role convention (`users.role = 'suspended'`).
- **To BCAST / CAMP / SCHED / CHAT / TIB1** (send paths): `SendGate::halted()`, `SendGate::screen()`, `SendGate::screenBody()` and the `security.wa_*` / `security.abuse_*` policy (send-time content and rate guardrails; emergency halt).
- **To API** (`developer-rest-api-v1`): `security.api_rate_limit_per_minute` global default for `ApiPlanRateLimit`; `SecureUpload` for `/api/v1` media/template uploads; `security.webhook_signature_required` for the webhooks form.
- **To WADEV**: `security.device_logout_on_inactive_days` (heartbeat sweep in `WaConnectController`).
- **To CAT / STORE**: `wadesk_sanitize_html` for product body rendering; `SecureUpload` to FLR/SCHED/AR.
- **To CMS/all layouts**: `SecurityHeaders`, `NoStoreResponse` middleware, `auth_cfg()`/`components/auth-shell.blade.php`.
- **To INST**: `UseFileSession` (install wizard).
- **To EXT** (`chrome-extension-sheets-addon`): the extension login (`POST api/login`, `ExtensionApiController`) and Sheets key routes on `AccountController` are owned by EXT; they reuse `users` credentials and hashed keys.

## Open questions & quirks

QUIRKS relied on or worth deciding explicitly:

1. **TOTP is enrol-only.** No web/social login, email-verify-link login or extension login checks `two_factor_enabled`; only the mobile API does (WhatsApp OTP). Docs and UI ("on every login") over-promise. Recovery codes are docs-only (column exists, never used).
2. **Force2FA likely loops**: its redirect target (`/settings?tab=security`) is not bypassed by its own path allowlist (WD-AUTH-032). Needs a live check with `wadesk-run-reference`.
3. **Dead or unenforced toggles**: `public_registration`, `remember_me_enabled` (live login), `password_max_age_days` (live login), `force_password_change` (nothing reads it, yet "Force password reset for ALL users" sets it), `allowed_2fa_methods`, `wa_require_template_review`, `device_trust_required`, `webhook_replay_window_sec`, `mask_customer_numbers`. The security score still counts some of them.
4. **Documented defaults differ from code defaults** for the WhatsApp guardrails (docs: sends 60/min and 5000/day, links 3, scam/template review/finance/short-links on; code: 0, 0, 0, all off) and the guardrail master mode is `off`.
5. **Password policy is bypassed** by live sign-up and password reset (min 8 only); only change-password applies it. The reset/sign-up UI copy says "at least 8 characters" while the account pane says 12.
6. **Email verification link is a passwordless login** and replayable for 60 minutes; resend is unthrottled; the profile email change does not re-verify.
7. **Plaintext password in the session** while sign-up OTP is pending (session not encrypted by default).
8. **Registration OTP abuse**: no per-number/per-IP send cap beyond route throttles and a session-bound cooldown; mobile numbers are not unique.
9. **Login lockout is per email+IP**, not per account; the mobile app uses fixed 6/15-minute constants; there is no lockout on forgot-password, register or OTP-send.
10. **Admin identity is inconsistent**: `User::isAdmin()` (Spatie Super Admin/Admin or role admin/A), `EnsureUserActive` exemption (role admin/super-admin/platform-admin), `Force2FA` (admin/super_admin/super-admin/support_admin/support-admin), login landing (three Spatie platform roles only), `/home` (broader). A user can be "admin" for some gates and not others.
11. **`security.view`/`security.edit` permissions are seeded but never enforced**; any admin can change platform security.
12. **Danger zone gaps**: "rotate webhook secrets" rotates 0 workspaces on the shipped schema (no `workspaces.webhook_secret`); revoke-all does not touch Sanctum tokens or remember cookies; no step-up auth; emergency halt is enforced in the two PHP dispatchers only - bulk sends via Node may ignore it.
13. **`security_audit_log` has no reader** and is never pruned; docs claim password changes are logged there (they are not).
14. **Account deletion** does not revoke other sessions/tokens, leaves solo-owned workspaces orphaned, keeps social ids/2FA secrets, and the UI copy promises deletion of workspaces/data. The confirmation phrase hint is lowercase while the check is case-sensitive mixed case.
15. **TOTP QR image is generated by a third-party service** (secret leaves the server).
16. **Remember-me lifetime**: the label says 30 days but no `setRememberDuration` override was found; the framework default cookie lifetime applies (not verified numerically). Idle-timeout bypass for remembered sessions means the 60-minute timeout rarely applies.
17. **Client IP trust**: `TRUSTED_PROXIES` defaults to `*` (documented in bootstrap comments) so `X-Forwarded-For` can spoof IPs, weakening the IP allowlist, lockout key and audit IPs.
18. **Static marketing copy** on register ("Free for 14 days ...") ignores `registration_trial_days`; the profile "Notifications" card is a non-functional stub; `DELETE account/photo` has no UI; the `auth/register/step1.blade.php` view is unrouted; auth-page media uploads leave orphan files.

Docs vs code (advertised but absent or different):

- authentication.html: "recovery codes" and "email verification" (works), "2FA enforced" (partial), "sign out an individual device" (works, with the merged-row caveat), "maximum number of devices signed in at once" (works), "Remember me option" (toggle has no effect).
- data-privacy.html: the cookie-consent banner and privacy settings belong to SET/CMS; the "separate security log" is write-only; encryption list is accurate for the keys named here.
- admin-panel/security.html: the default values listed for guardrails do not match code; "Campaign holds" is a placeholder metric; "webhook replay window" and "device trust" are reserved.
- account-billing.html: Account menu lists Branding as a "message footer" only (matches code); "Security group" lists only Change password and Delete account (2FA and sessions live in Settings, not Account).

Unresolved / needs live verification:

- Exact remember-cookie lifetime and whether Laravel sends the framework default 400-day value.
- Whether the Force2FA loop reproduces (route bypass) on the reference build.
- Whether the Node bridge honours `platform.emergency_send_halt` for bulk sends (no reference found in `node/`).
- The `account/translation`, `account/sheets-key/*`, `sheets-addon*`, `account/wallet/statement*`, `account/plans`, `account/invoices/{id}`, `account/subscription/cancel` routes were left to I18N, EXT, WALLET, PLAN respectively. `admin/users/{id}/force-logout` is left to ASHELL/RBAC. `GET {wsSlug}` (workspace slug landing closure), `GET settings`/`POST settings` and other `settings/*` save routes (branding, notifications, AI keys, appearance, residency, exports, workspace delete) are left to WSP/SET/NOTIF/AIADM. `GET workspaces/create` (WSP), `GET api/v1/me` and `GET api/v1/usage` (API), API `api/login`, `api/logout` (EXT) and `api/app/*` auth, 2FA, password, social routes (MOB) are left to their domains but reuse the rules documented here.
- Platform-level permission keys for security screens do not exist in `permission_defs`; the port must define them.

## Coverage

```json wadesk-coverage
{
  "routes": [
    "GET login",
    "POST login",
    "GET register",
    "POST register",
    "GET register/verify",
    "POST register/verify",
    "POST register/verify/resend",
    "GET auth/{provider}/redirect",
    "GET auth/{provider}/callback",
    "GET forgot-password",
    "POST forgot-password",
    "GET reset-password/{token}",
    "POST reset-password",
    "GET csrf-token",
    "GET verify-email/{id}/{hash}",
    "POST email/verify/resend",
    "GET account/suspended",
    "GET account/verify-email",
    "GET logout",
    "POST logout",
    "GET register/workspace",
    "POST register/workspace",
    "GET register/plan",
    "GET register/plan/skip",
    "POST register/plan/skip",
    "POST workspaces/{id}/switch",
    "GET home",
    "GET account",
    "DELETE account",
    "POST account/branding",
    "POST account/password",
    "POST account/photo",
    "DELETE account/photo",
    "POST account/profile",
    "POST settings/2fa/disable",
    "POST settings/2fa/enable",
    "POST settings/sessions/revoke-others",
    "DELETE settings/sessions/{id}",
    "GET admin/security",
    "PATCH admin/security",
    "POST admin/security/danger/force-reset",
    "POST admin/security/danger/halt",
    "POST admin/security/danger/resume",
    "POST admin/security/danger/revoke-sessions",
    "POST admin/security/danger/rotate-webhooks",
    "POST admin/security/mask",
    "GET admin/settings/auth-pages",
    "POST admin/settings/auth-pages",
    "POST admin/settings/auth-pages/inline",
    "POST admin/settings/auth-pages/inline-media",
    "POST admin/settings/auth-pages/inline-media-clear",
    "GET admin/settings/auth-pages/preview/{page}",
    "POST admin/settings/auth-pages/variant",
    "GET admin/settings/social-login",
    "POST admin/settings/social-login",
    "POST admin/settings/channel-setting/otp-template"
  ],
  "controllers": [
    "app/Http/Controllers/AuthController.php",
    "app/Http/Controllers/AuthPagesController.php",
    "app/Http/Controllers/EmailVerificationController.php",
    "app/Http/Controllers/SocialAuthController.php",
    "app/Http/Controllers/AccountController.php",
    "app/Http/Controllers/Admin/SecurityController.php"
  ],
  "services": [
    "app/Services/Auth/RegistrationOtpService.php",
    "app/Services/SocialAuthService.php",
    "app/Services/RecaptchaService.php",
    "app/Support/TwoFactorService.php",
    "app/Support/PasswordPolicy.php",
    "app/Support/SecureUpload.php",
    "app/Support/SecurityPolicy.php",
    "app/Support/SecurityAuditLogger.php",
    "app/Support/security_helpers.php",
    "app/Support/html_sanitize.php",
    "app/Support/SendGate.php"
  ],
  "models": ["User"],
  "tables": ["users", "security_audit_log"],
  "views": [
    "resources/views/admin/security/index.blade.php",
    "resources/views/admin/settings/auth-pages.blade.php",
    "resources/views/admin/settings/social-login.blade.php",
    "resources/views/auth/_forgot_form.blade.php",
    "resources/views/auth/_login_form.blade.php",
    "resources/views/auth/_recaptcha.blade.php",
    "resources/views/auth/_register_form.blade.php",
    "resources/views/auth/_register_showcase.blade.php",
    "resources/views/auth/_social.blade.php",
    "resources/views/auth/forgot-password.blade.php",
    "resources/views/auth/login.blade.php",
    "resources/views/auth/register.blade.php",
    "resources/views/auth/register/_step2_form.blade.php",
    "resources/views/auth/register/_step3_form.blade.php",
    "resources/views/auth/register/_verify_form.blade.php",
    "resources/views/auth/register/step1.blade.php",
    "resources/views/auth/register/step2.blade.php",
    "resources/views/auth/register/step3.blade.php",
    "resources/views/auth/register/verify.blade.php",
    "resources/views/auth/reset-password.blade.php",
    "resources/views/auth/suspended.blade.php",
    "resources/views/auth/verify-email.blade.php",
    "resources/views/components/auth-shell.blade.php",
    "resources/views/components/layouts/guest.blade.php",
    "resources/views/emails/verify-email.blade.php",
    "resources/views/user/account/index.blade.php",
    "resources/views/user/settings/index.blade.php"
  ],
  "commands": ["audit:prune", "auth:clear-resets"],
  "permissions": ["security.view", "security.edit"],
  "middleware": [
    "app/Http/Middleware/Force2FA.php",
    "app/Http/Middleware/LimitConcurrentSessions.php",
    "app/Http/Middleware/SessionTimeout.php",
    "app/Http/Middleware/UseFileSession.php",
    "app/Http/Middleware/NoStoreResponse.php",
    "app/Http/Middleware/EnsureUserActive.php",
    "app/Http/Middleware/SecurityHeaders.php",
    "app/Http/Middleware/IPAllowlist.php"
  ],
  "node_files": [],
  "js_assets": [
    "resources/js/charts/auth-login.js",
    "resources/js/charts/auth-recaptcha.js",
    "resources/js/charts/auth-register-step2.js",
    "resources/js/charts/auth-register.js",
    "resources/js/charts/admin-security-index.js",
    "resources/js/charts/user-account-index.js",
    "resources/js/csrf-guard.js"
  ],
  "misc_files": ["app/Mail/VerifyEmailMail.php", "app/Listeners/NewLoginAlertListener.php"],
  "config_files": ["config/auth.php", "config/session.php"],
  "doc_pages": [
    "Documentation/pages/security/authentication.html",
    "Documentation/pages/security/data-privacy.html",
    "Documentation/pages/account/account-billing.html",
    "Documentation/pages/admin-panel/auth-pages.html",
    "Documentation/pages/admin-panel/security.html"
  ],
  "feature_map": {
    "WD-AUTH-001": ["GET login", "POST login"],
    "WD-AUTH-004": ["GET auth/{provider}/redirect", "GET auth/{provider}/callback"],
    "WD-AUTH-005": ["GET register", "POST register"],
    "WD-AUTH-006": ["GET register/verify", "POST register/verify", "POST register/verify/resend"],
    "WD-AUTH-007": ["POST admin/settings/channel-setting/otp-template"],
    "WD-AUTH-008": ["GET register/workspace", "POST register/workspace"],
    "WD-AUTH-009": ["GET register/plan", "GET register/plan/skip", "POST register/plan/skip"],
    "WD-AUTH-010": ["POST workspaces/{id}/switch"],
    "WD-AUTH-011": ["GET home"],
    "WD-AUTH-012": ["GET logout", "POST logout"],
    "WD-AUTH-013": ["GET forgot-password", "POST forgot-password"],
    "WD-AUTH-014": ["GET reset-password/{token}", "POST reset-password"],
    "WD-AUTH-015": [
      "GET verify-email/{id}/{hash}",
      "POST email/verify/resend",
      "GET account/verify-email"
    ],
    "WD-AUTH-016": ["GET account/suspended"],
    "WD-AUTH-020": ["GET csrf-token"],
    "WD-AUTH-021": [
      "GET admin/settings/auth-pages",
      "POST admin/settings/auth-pages",
      "GET admin/settings/auth-pages/preview/{page}",
      "POST admin/settings/auth-pages/variant"
    ],
    "WD-AUTH-022": [
      "POST admin/settings/auth-pages/inline",
      "POST admin/settings/auth-pages/inline-media",
      "POST admin/settings/auth-pages/inline-media-clear"
    ],
    "WD-AUTH-023": ["GET admin/settings/social-login", "POST admin/settings/social-login"],
    "WD-AUTH-024": ["GET account"],
    "WD-AUTH-025": ["POST account/profile"],
    "WD-AUTH-026": ["POST account/photo", "DELETE account/photo"],
    "WD-AUTH-027": ["POST account/password"],
    "WD-AUTH-028": ["DELETE account"],
    "WD-AUTH-029": ["POST account/branding"],
    "WD-AUTH-030": ["POST settings/2fa/enable", "POST settings/2fa/disable"],
    "WD-AUTH-031": ["DELETE settings/sessions/{id}", "POST settings/sessions/revoke-others"],
    "WD-AUTH-036": ["GET admin/security"],
    "WD-AUTH-037": ["PATCH admin/security"],
    "WD-AUTH-039": [
      "POST admin/security/danger/revoke-sessions",
      "POST admin/security/danger/force-reset",
      "POST admin/security/danger/rotate-webhooks"
    ],
    "WD-AUTH-040": ["POST admin/security/danger/halt", "POST admin/security/danger/resume"],
    "WD-AUTH-042": ["POST admin/security/mask"]
  }
}
```
