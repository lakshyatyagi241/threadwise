# Signup & verification redesign: one account per identity, email-code verification

## Problem

Today's signup (`apps/web/.../guest/signup-form.tsx`, `apps/api/.../auth/flows/signup.service.ts`)
has three issues:

1. **No identity uniqueness.** Nothing stops the same email or phone from signing up
   repeatedly, each time creating a brand-new org + `users` row. The `users` table only
   enforces `UNIQUE (org_id, email)` — scoped per org, not globally.
2. **Workspace name collected too early.** `orgName` is required at signup and the org is
   provisioned synchronously, before the account is ever verified. This is a deviation from
   WaDesk's own original flow, which collects name/email/phone/password first and defers the
   workspace name to a separate step (`/register/workspace`, WD-AUTH-008).
3. **Verification doesn't match the product's current direction.** Email verification today is
   a clickable link (WD-AUTH-015); the reference flow (Geta's own production signup) uses a
   6-digit code entered inline, with password collected _last_, after verification.

## Goals

- One identity (email or phone) can hold exactly one account created via signup. Additional
  workspace membership for an existing identity happens only through the existing **invite**
  flow, which is untouched by this change.
- Match the reference flow's step order: collect name/email/phone → verify email with a
  6-digit code → set password → land in the existing onboarding wizard (which already collects
  workspace name, industry, size, country, currency and timezone).
- No account or org is created until verification and password are both complete. An abandoned
  signup leaves no orphaned data.

## Non-goals

- No change to the invite flow, the workspace switcher, or how multi-workspace membership works
  once an identity already has an account — all already support it and are out of scope.
- No change to the existing admin-configurable WhatsApp/phone OTP toggle (`RegistrationOtpService`).
  It keeps firing independently, after password, exactly as it does today, for admins who enabled it.
- No change to social login (Google/Facebook) beyond applying the same duplicate-identity check —
  OAuth already proves email ownership, so no code step is added there.
- No backfill, audit, or cleanup of any duplicate accounts that may already exist. This is a
  going-forward rule only.
- No new onboarding fields. Currency and timezone already exist in `workspace-step.tsx` and need
  no change beyond confirming they still work once workspace creation moves later in the flow.

## Design

### Flow

```
Step 1 — Collect (new, replaces current single-page form)
  Input: fullName, email, phone
  Server:
    - validate format
    - cross-org duplicate check: does ANY users row (any org) already have this email OR phone?
      - yes -> reject: "An account with this email already exists. Sign in, or ask a
        workspace admin to invite you." Nothing created, no code sent.
      - no  -> generate 6-digit code, store pending-signup state (name, email, phone, code
        hash, expiry, attempts) in Redis under a short-lived token, email the code.
  Output: pending signup token (opaque, short TTL)

Step 2 — Verify
  Input: pending token, 6-digit code
  Server: check expiry / attempt count / code match (same limits/cooldown shape as the
    existing WhatsApp OTP: default 6 digits, ~5 min TTL, max 5 attempts, 60s resend cooldown)
  Output on success: the same pending token, now marked verified
  Output on failure: standard incrementing-attempt error, same copy style as existing OTP errors

Step 3 — Password
  Input: verified pending token, password, confirm password
  Server:
    - require the token to be marked verified (step 2 complete) or reject
    - auto-generate a provisional org name ("{First name}'s Workspace") and slug
    - create org + users row together (email_verified_at = now, password hashed)
    - sign in
    - if the admin has WhatsApp/phone OTP enabled, that step fires next (unchanged mechanism)
  Output: redirect into the existing onboarding wizard, starting at the Workspace step
```

Social login: on first OAuth sign-in, run the same cross-org duplicate check before creating an
account. If the OAuth email already has an account elsewhere, block with the same message
instead of silently creating a second account.

### Components

| Area                      | Change                                                                                                                                                                                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@crm/contracts`          | New request/response shapes: `signupStart`, `signupVerifyCode`, `signupResendCode`, `signupSetPassword`. Each carries the opaque pending token, never the raw pending state.                                                                                                                   |
| API — new                 | A focused service (e.g. `signup-verification.service.ts`) owning the Redis-backed pending-signup state and the three-step lifecycle. Mirrors the existing `RegistrationOtpService` shape (code generation, hashing, expiry, attempts, cooldown) but keyed by the pending token, not a session. |
| API — `signup.service.ts` | `create()` moves to run only after step 3; drops `orgName`/`orgSlug` input; adds provisional-name generation; adds the cross-org duplicate-check query (new repository method, modeled on the directory-level email lookup `login.service.ts` already does for the workspace switcher).        |
| API — mail                | New code-based email template, distinct from the existing WD-AUTH-015 link template (which stays in place for any flows that still use it, e.g. re-verification of an existing unverified account).                                                                                            |
| Web — `signup-form.tsx`   | Split into three step components: collect (name/email/phone, no workspace name, no password), verify-code (can closely mirror the existing `otp-form.tsx` shape), set-password. `StepList` copy updates to match the new step names.                                                           |
| Web — onboarding          | No change. `workspace-step.tsx` already collects name (prefilled via `suggestedName`), industry, size, country, currency, timezone.                                                                                                                                                            |

### Error handling

- Duplicate email/phone at step 1: field-level rejection, no code sent, no state created.
- Expired / wrong / max-attempts code: existing OTP-style incrementing error, resend respects cooldown.
- Mail send failure at step 1: existing-style fallback error, no pending state left dangling past its TTL.
- Any state abandoned past its Redis TTL simply expires; nothing to clean up.
- Password step reached without a verified token: reject (can't skip ahead).

### Testing

- Unit: duplicate-check query (email dup, phone dup, neither), code lifecycle (generate/hash/
  expire/attempt-limit), provisional org-name generation.
- API e2e: full three-step happy path; duplicate-email rejection; duplicate-phone rejection;
  wrong code; expired code; resend cooldown; social-login duplicate rejection; WhatsApp OTP
  still fires after password when admin-enabled.
- Web: render tests for the three new step components; i18n key coverage for new copy.
- `wadesk-playwright-parity` pass once implemented (this machine stamps `blocked-env` — PHP not
  installed locally for the WaDesk reference side; noted, not a blocker for merging per prior
  precedent in this repo).

## Open questions carried into implementation

None outstanding — all three design-stage questions (duplicate-signup handling, flow order,
relationship to WhatsApp OTP) were resolved with the user before writing this spec.
