# Signup Verification Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-page signup form with a three-step flow (collect → verify email with a 6-digit code → set password), block signup when the email or phone already has an account anywhere in the system, and defer workspace naming to the existing onboarding wizard.

**Architecture:** Extend the existing `SignupService`'s staged-signup pattern (already used for phone/WhatsApp OTP — `StagedSignup` in Redis under `AuthKeys.signup(challengeId)`) with a lighter pre-account stage that holds only `fullName`/`email`/`phoneE164` plus an email-code hash, no org and no password. A new `TenantDirectory.identityExists()` cross-org query (modeled byte-for-byte on the existing `activeOrgsForEmail`) runs before staging. Only once the code is verified AND a password is submitted does account creation run, reusing the existing `provisionOrganization` path with an auto-generated org name instead of user input.

**Tech Stack:** NestJS 11, Zod (`@crm/contracts`), Drizzle, ioredis, Next.js 16 (App Router), React, `@node-rs/argon2` for hashing.

**Spec:** [docs/specs/signup-verification-redesign.md](../../specs/signup-verification-redesign.md)

## Global Constraints

- Email-code lifecycle mirrors the existing phone-OTP defaults exactly, unless noted: 6-digit code, ~5 minute TTL, max 5 attempts, 60-second resend cooldown (same shape as `registrationSettingsSchema.parse({}).otp` defaults already used by `RegistrationOtpService`).
- All new Redis keys live in `apps/api/src/modules/auth/support/redis-keys.ts`'s `AuthKeys` object, follow the existing `auth:<scope>:<id>` naming, and hash any PII (email) with `sha256Hex(...).slice(0, 24)` before it goes into a key — never raw.
- The existing admin-configurable WhatsApp/phone OTP (`RegistrationOtpService`, `registration_otp_enabled`) is untouched. If active, it still fires after the new password step, exactly where it fires today.
- No new database migration. All pre-account state is Redis-only, TTL-bounded, and self-expires.
- `@crm/contracts` is the only place request/response shapes are defined — never redeclare a type in `apps/api` or `apps/web` (per this repo's `contracts-change` skill).
- Every new Zod schema name and exported type follows the exact casing/naming convention already in `packages/contracts/src/auth-registration-security/signup.ts` (`signupXxxSchema` / `SignupXxx`).

## Review Focus

- **Email already verified under the old link-based flow, now mid-migration**: an account created before this change with `email_verified_at` set must still log in normally — this change only touches the _signup_ path, never an existing row. Task 3's duplicate-check test must confirm an existing verified account blocks a _new_ signup with the same email, not that it breaks their own login.
- **Phone omitted at step 1**: `phone` is optional in `signupRequestSchema` today (required only when OTP is active) and must stay optional in the new `signupStartRequestSchema` — a workspace with WhatsApp OTP off must not force a phone number just because this flow exists. Task 1's schema test must cover phone-omitted.
- **Resend spam**: the 60-second cooldown must be enforced server-side (not just disabled on the client), since the email-send is the costly operation. Task 4's test must call resend twice inside the cooldown window and expect the same `otpCooldown`-style error `signup-otp` already uses.
- **Abandoned step 1 or step 2, never reaching step 3**: no `users`/`organizations` row may exist. Task 5's e2e test must stage a signup, let the Redis key expire (or delete it directly in the test), and confirm no DB row was created — not just that a later verify fails.
- **Duplicate check race**: two concurrent signup attempts with the same brand-new email, both passing the duplicate check before either commits. Task 6's test exercises this against the real `provisionOrganization` unique-slug retry loop that already exists, confirming the second request gets a clean, user-facing duplicate error rather than a raw constraint violation (there is no unique DB constraint on `email` to catch this at the database layer, so the application-level check _is_ the only guard — note this as a known, accepted race window in the task, not something to silently "fix" with a migration, since Global Constraints forbids a new migration here).

---

## File Structure

| File                                                                                  | Responsibility                                                                                                                                                               |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/auth-registration-security/signup.ts`                         | New request/response schemas for the three-step flow (modify, additive)                                                                                                      |
| `apps/api/src/modules/auth/support/redis-keys.ts`                                     | New `AuthKeys.signupEmailStage` key builder (modify, additive)                                                                                                               |
| `apps/api/src/modules/auth/platform/tenant-directory.ts`                              | New `identityExists()` cross-org check (modify, additive)                                                                                                                    |
| `apps/api/src/modules/auth/flows/signup.service.ts`                                   | New `start()`, `verifyEmailCode()`, `resendEmailCode()`, `setPassword()` methods; `create()` keeps its current signature and is called by `setPassword()` (modify, additive) |
| `apps/api/src/modules/auth/mail/mail.service.ts`                                      | New `sendSignupCode()` method (modify, additive)                                                                                                                             |
| `apps/api/src/modules/auth/controllers/registration.controller.ts`                    | Four new routes under `signup/` (modify, additive)                                                                                                                           |
| `apps/web/src/features/auth-registration-security/guest/signup-start-form.tsx`        | New: step 1 (name/email/phone)                                                                                                                                               |
| `apps/web/src/features/auth-registration-security/guest/signup-verify-email-form.tsx` | New: step 2 (code entry), modeled on `otp-form.tsx`                                                                                                                          |
| `apps/web/src/features/auth-registration-security/guest/signup-password-form.tsx`     | New: step 3 (password + terms)                                                                                                                                               |
| `apps/web/src/features/auth-registration-security/guest/signup-form.tsx`              | Rewritten: thin router between the three step components (modify)                                                                                                            |
| `apps/web/src/features/auth-registration-security/guest/signup-challenge.ts`          | New: sessionStorage helpers for the pre-account token, modeled on `otp-challenge.ts`                                                                                         |
| `apps/web/messages/en/auth-registration-security.json`, `ar/...json`                  | New copy for the three steps                                                                                                                                                 |

---

### Task 1: Contracts — the three-step signup request/response shapes

**Files:**

- Modify: `packages/contracts/src/auth-registration-security/signup.ts`
- Test: `packages/contracts/src/auth-registration-security/signup.test.ts` (create if it doesn't exist)

**Interfaces:**

- Produces: `signupStartRequestSchema`/`SignupStartRequest`, `signupStartResponseSchema`/`SignupStartResponse`, `signupVerifyEmailCodeRequestSchema`/`SignupVerifyEmailCodeRequest`, `signupResendEmailCodeRequestSchema`/`SignupResendEmailCodeRequest`, `signupResendEmailCodeResponseSchema`/`SignupResendEmailCodeResponse`, `signupSetPasswordRequestSchema`/`SignupSetPasswordRequest` — all consumed by Task 4 (API) and Tasks 7-9 (web).

- [ ] **Step 1: Write the failing test**

```ts
// packages/contracts/src/auth-registration-security/signup.test.ts
import { describe, expect, it } from 'vitest';
import {
  signupStartRequestSchema,
  signupVerifyEmailCodeRequestSchema,
  signupSetPasswordRequestSchema,
} from './signup';

describe('signupStartRequestSchema', () => {
  it('accepts name + email with no phone', () => {
    const r = signupStartRequestSchema.safeParse({
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
    });
    expect(r.success).toBe(true);
  });
  it('rejects a missing email', () => {
    const r = signupStartRequestSchema.safeParse({ fullName: 'Ada Lovelace' });
    expect(r.success).toBe(false);
  });
});

describe('signupVerifyEmailCodeRequestSchema', () => {
  it('requires a token and a 4-8 char code', () => {
    const r = signupVerifyEmailCodeRequestSchema.safeParse({ token: 'abc', code: '123456' });
    expect(r.success).toBe(true);
  });
});

describe('signupSetPasswordRequestSchema', () => {
  it('requires acceptTerms to be literal true', () => {
    const r = signupSetPasswordRequestSchema.safeParse({
      token: 'abc',
      password: 'Sup3rSecret!',
      acceptTerms: false,
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/contracts && npx vitest run src/auth-registration-security/signup.test.ts`
Expected: FAIL — `signupStartRequestSchema` etc. are not exported yet.

- [ ] **Step 3: Write minimal implementation**

Add to `packages/contracts/src/auth-registration-security/signup.ts`, near the existing `signupRequestSchema` (reuse `emailSchema`/`phoneSchema`/`passwordSchema` already imported in this file):

```ts
// --- the three-step signup flow (email-code verification, password last) ---

export const signupStartRequestSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: emailSchema,
  /** Optional; required only when the admin also has phone/WhatsApp OTP active (checked server-side). */
  phone: phoneSchema.optional(),
  captchaToken: z.string().max(4096).optional(),
});
export type SignupStartRequest = z.infer<typeof signupStartRequestSchema>;

export const signupStartResponseSchema = z.object({
  token: z.string(),
  /** "a••••a@example.com" — never the full address. */
  maskedEmail: z.string(),
  expiresInSeconds: z.number().int().positive(),
  resendCooldownSeconds: z.number().int().nonnegative(),
  codeLength: z.number().int().min(4).max(8),
});
export type SignupStartResponse = z.infer<typeof signupStartResponseSchema>;

export const signupVerifyEmailCodeRequestSchema = z.object({
  token: z.string().min(1),
  code: z.string().trim().min(4).max(8),
});
export type SignupVerifyEmailCodeRequest = z.infer<typeof signupVerifyEmailCodeRequestSchema>;

/** Same token, now marked verified server-side; nothing else changes client-side. */
export const signupVerifyEmailCodeResponseSchema = z.object({ token: z.string() });
export type SignupVerifyEmailCodeResponse = z.infer<typeof signupVerifyEmailCodeResponseSchema>;

export const signupResendEmailCodeRequestSchema = z.object({ token: z.string().min(1) });
export type SignupResendEmailCodeRequest = z.infer<typeof signupResendEmailCodeRequestSchema>;

export const signupResendEmailCodeResponseSchema = z.object({
  expiresInSeconds: z.number().int().positive(),
  resendCooldownSeconds: z.number().int().nonnegative(),
});
export type SignupResendEmailCodeResponse = z.infer<typeof signupResendEmailCodeResponseSchema>;

export const signupSetPasswordRequestSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms.' }) }),
  referralCode: z
    .string()
    .trim()
    .max(16)
    .regex(/^[A-Za-z0-9]*$/)
    .optional(),
});
export type SignupSetPasswordRequest = z.infer<typeof signupSetPasswordRequestSchema>;
```

`signupSetPassword`'s response reuses the existing `signupResponseSchema` (it can still return `otp_required` for the phone/WhatsApp step, or `authenticated` directly) — no new response schema needed there.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/contracts && npx vitest run src/auth-registration-security/signup.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Build and typecheck the package**

Run: `pnpm --filter @crm/contracts build && pnpm --filter @crm/contracts typecheck`
Expected: both succeed — downstream API/web tasks import from `dist/`, so this must be rebuilt before Task 4.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/auth-registration-security/signup.ts packages/contracts/src/auth-registration-security/signup.test.ts
git commit -m "feat(contracts): add three-step signup request/response shapes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Redis key for the pre-account signup stage

**Files:**

- Modify: `apps/api/src/modules/auth/support/redis-keys.ts`
- Test: `apps/api/src/modules/auth/support/redis-keys.test.ts` (extend if it exists, else create)

**Interfaces:**

- Produces: `AuthKeys.signupEmailStage(token: string): string` — consumed by Task 3.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/auth/support/redis-keys.test.ts (add this describe block)
import { AuthKeys } from './redis-keys';

describe('AuthKeys.signupEmailStage', () => {
  it('namespaces by the opaque token, not the email', () => {
    const key = AuthKeys.signupEmailStage('tok_abc123');
    expect(key).toBe('auth:signup-email-stage:tok_abc123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/modules/auth/support/redis-keys.test.ts -t signupEmailStage`
Expected: FAIL — `signupEmailStage` is not a property of `AuthKeys`.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/src/modules/auth/support/redis-keys.ts`, add next to the existing `signup: (challengeId: string) => ...` entry:

```ts
  /** The pre-account stage (name/email/phone + email-code hash) before password is set. Keyed by an opaque token, not the email — the email itself never appears in the key. */
  signupEmailStage: (token: string) => `auth:signup-email-stage:${token}`,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/modules/auth/support/redis-keys.test.ts -t signupEmailStage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/support/redis-keys.ts apps/api/src/modules/auth/support/redis-keys.test.ts
git commit -m "feat(auth): add signupEmailStage redis key

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Cross-org identity-exists check

**Files:**

- Modify: `apps/api/src/modules/auth/platform/tenant-directory.ts`
- Test: `apps/api/test/unit/auth-registration-security/tenant-directory.spec.ts` (create if no matching unit test file exists for this class — check first)

**Interfaces:**

- Consumes: `this.db.privileged(...)` (already used by `activeOrgsForEmail` in the same file — identical pattern).
- Produces: `TenantDirectory.identityExists(email: string, phoneE164: string | null): Promise<boolean>` — consumed by Task 4.

- [ ] **Step 1: Write the failing test**

Follow this repo's existing test-harness pattern for `TenantDirectory` (check the top of `tenant-directory.spec.ts` or any sibling test that already exercises `activeOrgsForEmail` for the exact DB-seeding helpers used — mirror that setup verbatim). Shape of the new test:

```ts
describe('TenantDirectory.identityExists', () => {
  it('is false for a brand-new email and phone', async () => {
    const exists = await tenantDirectory.identityExists('nobody@example.test', '+15555550100');
    expect(exists).toBe(false);
  });

  it('is true when the email already has a users row in a different org', async () => {
    // seed an org + user with email 'taken@example.test' the same way the existing
    // activeOrgsForEmail test seeds its fixture — reuse that helper
    const exists = await tenantDirectory.identityExists('taken@example.test', null);
    expect(exists).toBe(true);
  });

  it('is true when the phone already has a users row, even with a different email', async () => {
    const exists = await tenantDirectory.identityExists('new-email@example.test', '+15555550199');
    expect(exists).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run test/unit/auth-registration-security/tenant-directory.spec.ts -t identityExists`
Expected: FAIL — `identityExists` does not exist on `TenantDirectory`.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/src/modules/auth/platform/tenant-directory.ts`, add next to `activeOrgsForEmail`:

```ts
  /**
   * True when a `users` row already exists anywhere (any org, any status) for this email OR this
   * phone. Used only at signup time to block creating a second account for an identity that
   * already has one — never used for login, which goes through `activeOrgsForEmail` instead.
   */
  async identityExists(email: string, phoneE164: string | null): Promise<boolean> {
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(
        phoneE164
          ? sql`SELECT 1 FROM users WHERE email = ${email} OR phone_e164 = ${phoneE164} LIMIT 1`
          : sql`SELECT 1 FROM users WHERE email = ${email} LIMIT 1`,
      );
      return res.rows.length > 0;
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run test/unit/auth-registration-security/tenant-directory.spec.ts -t identityExists`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/platform/tenant-directory.ts apps/api/test/unit/auth-registration-security/tenant-directory.spec.ts
git commit -m "feat(auth): add cross-org identityExists check for signup

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `MailService.sendSignupCode`

**Files:**

- Modify: `apps/api/src/modules/auth/mail/mail.service.ts`
- Test: `apps/api/src/modules/auth/mail/mail.service.spec.ts` (extend existing, following its current mocking pattern for `MAIL_PORT`)

**Interfaces:**

- Consumes: `MAIL_PORT`'s `send({ to, subject, text, html })` (already injected in this class).
- Produces: `MailService.sendSignupCode(to: string, name: string, code: string, ttlMinutes: number): Promise<boolean>` — consumed by Task 5.

- [ ] **Step 1: Write the failing test**

Mirror the existing `sendVerifyEmail` test in this spec file exactly (same mock-port assertion shape), just swap the method and assert the code appears in the body:

```ts
it('sends the signup code', async () => {
  const ok = await mail.sendSignupCode('ada@example.com', 'Ada', '482913', 5);
  expect(ok).toBe(true);
  expect(port.send).toHaveBeenCalledWith(
    expect.objectContaining({
      to: 'ada@example.com',
      subject: expect.stringContaining('code'),
      text: expect.stringContaining('482913'),
    }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/modules/auth/mail/mail.service.spec.ts -t sendSignupCode`
Expected: FAIL — `sendSignupCode` is not a function.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/src/modules/auth/mail/mail.service.ts`, add a method using the same `deliver()` helper the other `send*` methods use (a code has no CTA button, so skip `layout()`'s button slot — follow whatever `sendLoginAlert` does for its `<pre>`-style value block, since that's the closest existing precedent for "render a literal value, not a link"):

```ts
  async sendSignupCode(to: string, name: string, code: string, ttlMinutes: number): Promise<boolean> {
    const subject = 'Your verification code';
    const text = `Hi ${name},\n\nYour verification code is ${code}. It expires in ${ttlMinutes} minutes.\n\nIf you did not request this, you can ignore this email.`;
    const html = this.layout(
      subject,
      `<p>Hi ${escapeHtml(name)},</p><p>Your verification code is:</p><pre style="font-size:28px;letter-spacing:4px;font-weight:700">${escapeHtml(code)}</pre><p>It expires in ${ttlMinutes} minutes.</p><p>If you did not request this, you can ignore this email.</p>`,
    );
    return this.deliver(to, subject, text, html);
  }
```

(Use whatever the file's actual `escapeHtml`/`layout`/`deliver` helper names and signatures are — read the top of the file and copy them exactly; this plan's job is to show the shape, the implementer confirms the exact helper names against the file before pasting.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/modules/auth/mail/mail.service.spec.ts -t sendSignupCode`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/mail/mail.service.ts apps/api/src/modules/auth/mail/mail.service.spec.ts
git commit -m "feat(auth): add sendSignupCode email template

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `SignupService.start()` — collect + duplicate check + send code

**Files:**

- Modify: `apps/api/src/modules/auth/flows/signup.service.ts`
- Test: `apps/api/test/e2e/auth-registration-security/auth-signup-social.e2e.spec.ts` or a new sibling `auth-signup-email-verify.e2e.spec.ts` (create the new file — this flow is large enough to own its own spec; follow the existing e2e spec's harness import pattern exactly, from `./harness`)

**Interfaces:**

- Consumes: `SignupStartRequest` (Task 1), `AuthKeys.signupEmailStage` (Task 2), `TenantDirectory.identityExists` (Task 3), `MailService.sendSignupCode` (Task 4), `randomNumericCode` from `../support/crypto-utils` (existing, used by the phone-OTP path), `hash` from `@node-rs/argon2` (existing import in this file).
- Produces: `SignupService.start(req: SignupStartRequest, meta: ClientMeta): Promise<SignupStartResponse>` — consumed by Task 8 (controller route) and Task 7 (web step 1).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/e2e/auth-registration-security/auth-signup-email-verify.e2e.spec.ts
import { describe, expect, it } from 'vitest';
import { harness } from './harness';

describe('POST /v2/auth/signup/start', () => {
  it('stages the signup and returns a masked email', async () => {
    const res = await harness.post('/v2/auth/signup/start', {
      fullName: 'Ada Lovelace',
      email: `ada-${Date.now()}@example.test`,
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.maskedEmail).toMatch(/.+@.+/);
    expect(res.body.codeLength).toBe(6);
  });

  it('rejects when the email already has an account', async () => {
    const email = `dup-${Date.now()}@example.test`;
    await harness.seedExistingUser({ email }); // use whatever fixture helper the repo's other e2e specs already use to seed a user
    const res = await harness.post('/v2/auth/signup/start', { fullName: 'Dup User', email });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('AUTH_IDENTITY_EXISTS'); // add this to ERROR_CODES if it doesn't exist
  });

  it('leaves no org or user row behind when the stage is abandoned before verification', async () => {
    const email = `abandoned-${Date.now()}@example.test`;
    await harness.post('/v2/auth/signup/start', { fullName: 'Abandoned User', email });
    // don't verify, don't set a password — query the same way harness.seedExistingUser's
    // counterpart lookup does, for this email, across all orgs (privileged query, same shape
    // as TenantDirectory.identityExists in Task 3)
    const row = await harness.findAnyUserByEmail(email);
    expect(row).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run test/e2e/auth-registration-security/auth-signup-email-verify.e2e.spec.ts`
Expected: FAIL — route doesn't exist yet (this test also exercises Task 8's route; expected to fail on 404 until both tasks land — acceptable, this is the spec that proves the whole vertical slice once Task 8 is also done. Run it again at the end of Task 8, not just here.)

- [ ] **Step 3: Write minimal implementation**

First, check `common/errors/app-error.ts`'s `ERROR_CODES` const for an existing "already exists" code; if none fits, add `AUTH_IDENTITY_EXISTS: 'AUTH_IDENTITY_EXISTS'` there (per this repo's `contracts-change` rule: new error codes go in the stable `ERROR_CODES` const, never a string literal at the throw site).

In `apps/api/src/modules/auth/flows/signup.service.ts`, add (constants near the top of the class, alongside `STAGE_TTL_SECONDS`):

```ts
const EMAIL_STAGE_TTL_SECONDS = 30 * 60; // 30 minutes to complete all three steps
const EMAIL_CODE_TTL_SECONDS = 5 * 60;
const EMAIL_CODE_LENGTH = 6;
const EMAIL_CODE_MAX_ATTEMPTS = 5;
const EMAIL_CODE_RESEND_COOLDOWN_SECONDS = 60;

interface EmailStage {
  fullName: string;
  email: string;
  phoneE164: string | null;
  codeHash: string;
  codeExpiresAt: number;
  verified: boolean;
  attempts: number;
  lastSentAt: number;
}
```

```ts
  async start(req: SignupStartRequest, meta: ClientMeta): Promise<SignupStartResponse> {
    const exists = await this.tenants.identityExists(req.email, req.phone ?? null);
    if (exists) {
      throw new AppError(
        ERROR_CODES.AUTH_IDENTITY_EXISTS,
        'An account with this email already exists.',
        HttpStatus.CONFLICT,
        [{ path: 'email', message: 'An account with this email already exists. Sign in, or ask a workspace admin to invite you.' }],
      );
    }

    const token = randomToken();
    const code = randomNumericCode(EMAIL_CODE_LENGTH);
    const stage: EmailStage = {
      fullName: req.fullName,
      email: req.email,
      phoneE164: req.phone ?? null,
      codeHash: await hash(code),
      codeExpiresAt: Date.now() + EMAIL_CODE_TTL_SECONDS * 1000,
      verified: false,
      attempts: 0,
      lastSentAt: Date.now(),
    };
    await this.redis.set(AuthKeys.signupEmailStage(token), JSON.stringify(stage), 'EX', EMAIL_STAGE_TTL_SECONDS);
    await this.mail.sendSignupCode(req.email, req.fullName, code, EMAIL_CODE_TTL_SECONDS / 60);

    return {
      token,
      maskedEmail: maskEmail(req.email), // add this small helper next to the existing maskPhone-equivalent if one doesn't already exist in this file or a sibling support file — check first
      expiresInSeconds: EMAIL_CODE_TTL_SECONDS,
      resendCooldownSeconds: EMAIL_CODE_RESEND_COOLDOWN_SECONDS,
      codeLength: EMAIL_CODE_LENGTH,
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run test/e2e/auth-registration-security/auth-signup-email-verify.e2e.spec.ts -t "stages the signup"`
Expected: still FAILS until Task 8 wires the route — note that in the commit message, this is expected and will be closed out in Task 8's own test run.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/flows/signup.service.ts apps/api/test/e2e/auth-registration-security/auth-signup-email-verify.e2e.spec.ts apps/api/src/common/errors/app-error.ts
git commit -m "feat(auth): add SignupService.start (duplicate check + email code)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `SignupService.verifyEmailCode()` and `resendEmailCode()`

**Files:**

- Modify: `apps/api/src/modules/auth/flows/signup.service.ts`
- Test: same e2e file as Task 5

**Interfaces:**

- Consumes: `EmailStage` (Task 5), `AuthKeys.signupEmailStage` (Task 2).
- Produces: `SignupService.verifyEmailCode(req: SignupVerifyEmailCodeRequest): Promise<SignupVerifyEmailCodeResponse>`, `SignupService.resendEmailCode(req: SignupResendEmailCodeRequest): Promise<SignupResendEmailCodeResponse>` — consumed by Task 8, Task 8.

- [ ] **Step 1: Write the failing test**

```ts
describe('POST /v2/auth/signup/verify-email-code', () => {
  it('marks the stage verified on a correct code', async () => {
    // start a stage, pull the code from the test mail sink the way other e2e specs already do
    // (check how auth-signup-social.e2e.spec.ts or otp-delivery.e2e.spec.ts reads the sent code in tests)
    const { token, code } = await harness.startSignupAndReadCode({
      fullName: 'Ada',
      email: `v-${Date.now()}@example.test`,
    });
    const res = await harness.post('/v2/auth/signup/verify-email-code', { token, code });
    expect(res.status).toBe(200);
    expect(res.body.token).toBe(token);
  });

  it('rejects a wrong code without consuming the attempt budget silently', async () => {
    const { token } = await harness.startSignupAndReadCode({
      fullName: 'Ada',
      email: `w-${Date.now()}@example.test`,
    });
    const res = await harness.post('/v2/auth/signup/verify-email-code', { token, code: '000000' });
    expect(res.status).toBe(400);
  });
});

describe('POST /v2/auth/signup/resend-email-code', () => {
  it('rejects a second resend inside the cooldown', async () => {
    const { token } = await harness.startSignupAndReadCode({
      fullName: 'Ada',
      email: `r-${Date.now()}@example.test`,
    });
    await harness.post('/v2/auth/signup/resend-email-code', { token });
    const second = await harness.post('/v2/auth/signup/resend-email-code', { token });
    expect(second.status).toBe(429);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run test/e2e/auth-registration-security/auth-signup-email-verify.e2e.spec.ts -t "verify-email-code\|resend-email-code"`
Expected: FAIL (methods and routes don't exist yet)

- [ ] **Step 3: Write minimal implementation**

```ts
  async verifyEmailCode(req: SignupVerifyEmailCodeRequest): Promise<SignupVerifyEmailCodeResponse> {
    const key = AuthKeys.signupEmailStage(req.token);
    const raw = await this.redis.get(key);
    if (!raw) throw new AppError(ERROR_CODES.AUTH_SIGNUP_EXPIRED, 'That signup has expired. Please start again.', HttpStatus.GONE);
    const stage = JSON.parse(raw) as EmailStage;

    if (stage.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
      throw new AppError(ERROR_CODES.AUTH_OTP_LOCKED, 'Too many attempts. Please request a new code.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (Date.now() > stage.codeExpiresAt) {
      throw new AppError(ERROR_CODES.AUTH_OTP_EXPIRED, 'That code has expired. Please request a new one.', HttpStatus.BAD_REQUEST);
    }
    const ok = await verify(stage.codeHash, req.code); // `verify` from @node-rs/argon2, already imported in this file
    if (!ok) {
      stage.attempts += 1;
      await this.redis.set(key, JSON.stringify(stage), 'KEEPTTL');
      throw new AppError(ERROR_CODES.AUTH_OTP_WRONG, 'Incorrect code. Please try again.', HttpStatus.BAD_REQUEST);
    }
    stage.verified = true;
    await this.redis.set(key, JSON.stringify(stage), 'KEEPTTL');
    return { token: req.token };
  }

  async resendEmailCode(req: SignupResendEmailCodeRequest): Promise<SignupResendEmailCodeResponse> {
    const key = AuthKeys.signupEmailStage(req.token);
    const raw = await this.redis.get(key);
    if (!raw) throw new AppError(ERROR_CODES.AUTH_SIGNUP_EXPIRED, 'That signup has expired. Please start again.', HttpStatus.GONE);
    const stage = JSON.parse(raw) as EmailStage;

    const sinceLast = (Date.now() - stage.lastSentAt) / 1000;
    if (sinceLast < EMAIL_CODE_RESEND_COOLDOWN_SECONDS) {
      throw new AppError(
        ERROR_CODES.AUTH_OTP_COOLDOWN,
        'Please wait a moment before requesting another code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const code = randomNumericCode(EMAIL_CODE_LENGTH);
    stage.codeHash = await hash(code);
    stage.codeExpiresAt = Date.now() + EMAIL_CODE_TTL_SECONDS * 1000;
    stage.attempts = 0;
    stage.lastSentAt = Date.now();
    await this.redis.set(key, JSON.stringify(stage), 'KEEPTTL');
    await this.mail.sendSignupCode(stage.email, stage.fullName, code, EMAIL_CODE_TTL_SECONDS / 60);

    return { expiresInSeconds: EMAIL_CODE_TTL_SECONDS, resendCooldownSeconds: EMAIL_CODE_RESEND_COOLDOWN_SECONDS };
  }
```

Check `ERROR_CODES` for `AUTH_SIGNUP_EXPIRED` / `AUTH_OTP_LOCKED` / `AUTH_OTP_EXPIRED` / `AUTH_OTP_WRONG` / `AUTH_OTP_COOLDOWN` — these almost certainly already exist (the phone-OTP path throws equivalents); reuse the exact existing names rather than inventing new ones. Only add `AUTH_IDENTITY_EXISTS` (Task 5) as genuinely new.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run test/e2e/auth-registration-security/auth-signup-email-verify.e2e.spec.ts`
Expected: still blocked on routes until Task 8 — same note as Task 5.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/flows/signup.service.ts apps/api/test/e2e/auth-registration-security/auth-signup-email-verify.e2e.spec.ts
git commit -m "feat(auth): add SignupService.verifyEmailCode and resendEmailCode

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: `SignupService.setPassword()` — create the account

**Files:**

- Modify: `apps/api/src/modules/auth/flows/signup.service.ts`
- Test: same e2e file

**Interfaces:**

- Consumes: `EmailStage` (verified, Task 6), existing `create(data: SignupData, opts: CreateOptions, meta: ClientMeta): Promise<Authenticated>` (unchanged signature, called internally).
- Produces: `SignupService.setPassword(req: SignupSetPasswordRequest, meta: ClientMeta): Promise<SignupResponse>` — consumed by Task 8, Task 9 (web).

- [ ] **Step 1: Write the failing test**

```ts
describe('POST /v2/auth/signup/set-password', () => {
  it('creates the account once verified, with an auto-generated workspace name', async () => {
    const { token } = await harness.startSignupAndVerify({
      fullName: 'Ada Lovelace',
      email: `p-${Date.now()}@example.test`,
    });
    const res = await harness.post('/v2/auth/signup/set-password', {
      token,
      password: 'Sup3rSecret!',
      acceptTerms: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('authenticated');
  });

  it('rejects when the email was never verified', async () => {
    const { token } = await harness
      .post('/v2/auth/signup/start', { fullName: 'Ada', email: `nv-${Date.now()}@example.test` })
      .then((r) => r.body);
    const res = await harness.post('/v2/auth/signup/set-password', {
      token,
      password: 'Sup3rSecret!',
      acceptTerms: true,
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run test/e2e/auth-registration-security/auth-signup-email-verify.e2e.spec.ts -t "set-password"`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```ts
  async setPassword(req: SignupSetPasswordRequest, meta: ClientMeta): Promise<SignupResponse> {
    const key = AuthKeys.signupEmailStage(req.token);
    const raw = await this.redis.get(key);
    if (!raw) throw new AppError(ERROR_CODES.AUTH_SIGNUP_EXPIRED, 'That signup has expired. Please start again.', HttpStatus.GONE);
    const stage = JSON.parse(raw) as EmailStage;
    if (!stage.verified) {
      throw new AppError(ERROR_CODES.AUTH_EMAIL_NOT_VERIFIED, 'Please verify your email first.', HttpStatus.FORBIDDEN);
    }

    await this.redis.del(key);
    const passwordHash = await this.passwords.hash(req.password); // confirm PasswordService's actual hash method name against its file before pasting

    const orgName = `${stage.fullName.split(' ')[0]}'s Workspace`;
    const slug = slugify(orgName); // `slugify` already imported in this file (used by the existing create() retry loop)

    const authenticated = await this.create(
      {
        orgName,
        slug,
        slugExplicit: false,
        fullName: stage.fullName,
        email: stage.email,
        phoneE164: stage.phoneE164,
        passwordHash,
        referralCode: req.referralCode ?? null,
      },
      { phoneVerified: false, emailVerified: true, remember: true, loginMethod: 'signup', slugFallback: true },
      meta,
    );

    if (stage.phoneE164 && (await this.otp.isActive())) {
      // existing phone-OTP path: reuse whatever this.signup()/stageForOtp already does to turn an
      // Authenticated result into an `otp_required` SignupResponse — read that branch in the
      // current `signup()` method and call the same helper here instead of duplicating it.
    }

    return { status: 'authenticated', ...authenticated };
  }
```

Add `AUTH_EMAIL_NOT_VERIFIED` to `ERROR_CODES` if no equivalent exists.

**Important implementation note for the engineer:** the phone-OTP branch above is deliberately left as a pointer, not duplicated code — open the current `signup()` method in this same file, find exactly how it decides to return `otp_required` vs `authenticated`, and call that same logic (extract it to a private helper first if it's inline, so both `signup()` and `setPassword()` call the one helper — don't copy-paste the branch).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run test/e2e/auth-registration-security/auth-signup-email-verify.e2e.spec.ts -t "set-password"`
Expected: still blocked on the route (Task 8).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/flows/signup.service.ts apps/api/test/e2e/auth-registration-security/auth-signup-email-verify.e2e.spec.ts
git commit -m "feat(auth): add SignupService.setPassword (account creation)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Wire the four new routes

**Files:**

- Modify: `apps/api/src/modules/auth/controllers/registration.controller.ts`

**Interfaces:**

- Consumes: Tasks 1, 5, 6, 7's schemas and service methods.
- Produces: `POST /v2/auth/signup/start`, `POST /v2/auth/signup/verify-email-code`, `POST /v2/auth/signup/resend-email-code`, `POST /v2/auth/signup/set-password` — consumed by Task 9-11 (web).

- [ ] **Step 1: Write the failing test**

(Re-run every e2e test written in Tasks 5-7 — they were written against these exact routes and are the test for this task.)

Run: `cd apps/api && npx vitest run test/e2e/auth-registration-security/auth-signup-email-verify.e2e.spec.ts`
Expected: FAIL — 404s on all four routes.

- [ ] **Step 2: Write minimal implementation**

In `apps/api/src/modules/auth/controllers/registration.controller.ts`, add next to the existing `signup`/`signup/verify-otp`/`signup/resend-otp` routes, same decorator shape:

```ts
  @Public()
  @Post('signup/start')
  async signupStart(@Body(zodPipe(signupStartRequestSchema)) body: SignupStartRequest) {
    return this.signup.start(body, clientMeta());
  }

  @Public()
  @Post('signup/verify-email-code')
  async signupVerifyEmailCode(@Body(zodPipe(signupVerifyEmailCodeRequestSchema)) body: SignupVerifyEmailCodeRequest) {
    return this.signup.verifyEmailCode(body);
  }

  @Public()
  @Post('signup/resend-email-code')
  async signupResendEmailCode(@Body(zodPipe(signupResendEmailCodeRequestSchema)) body: SignupResendEmailCodeRequest) {
    return this.signup.resendEmailCode(body);
  }

  @Public()
  @Post('signup/set-password')
  async signupSetPassword(@Body(zodPipe(signupSetPasswordRequestSchema)) body: SignupSetPasswordRequest) {
    return this.signup.setPassword(body, clientMeta());
  }
```

Add the four schema/type imports from `@crm/contracts` at the top of the file, next to the existing `signupRequestSchema` import.

- [ ] **Step 3: Run test to verify it passes**

Run: `cd apps/api && npx vitest run test/e2e/auth-registration-security/auth-signup-email-verify.e2e.spec.ts`
Expected: PASS (all tests from Tasks 5-7)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/auth/controllers/registration.controller.ts
git commit -m "feat(auth): wire the three-step signup routes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Web — step 1 (collect) and the shared pending-token helper

**Files:**

- Create: `apps/web/src/features/auth-registration-security/guest/signup-challenge.ts` (modeled on `otp-challenge.ts`: sessionStorage read/write/clear for the pending token + masked email + expiry, same shape as `StoredChallenge`)
- Create: `apps/web/src/features/auth-registration-security/guest/signup-start-form.tsx`
- Test: `apps/web/src/features/auth-registration-security/guest/signup-start-form.render.test.ts`

**Interfaces:**

- Consumes: `signupStartRequestSchema`, `signupStartResponseSchema` (Task 1), `callApi` (existing, `bff.ts`).
- Produces: a stored pending-token record readable by Task 10's verify step (same sessionStorage key convention `otp-challenge.ts` already uses, renamed for this flow — check that file's exact key string and mirror the naming, e.g. `signup-email-pending`).

- [ ] **Step 1: Write the failing test**

```ts
// signup-start-form.render.test.ts — follow the exact render-test harness `otp-form`'s or
// `signup-form`'s existing `.render.test.ts` sibling uses (renderGuest or equivalent)
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { SignupStartForm } from './signup-start-form';
import { renderGuest } from './render-test-utils';

describe('SignupStartForm', () => {
  it('has no workspace-name field', () => {
    const html = renderGuest(createElement(SignupStartForm, { config: FAKE_CONFIG }));
    expect(html).not.toContain('Workspace name');
    expect(html).toContain('Full name');
    expect(html).toContain('Work email');
  });
});
```

(`FAKE_CONFIG` — use whatever fixture the existing `signup-form.render.test.ts`, if one exists, already builds for `RegistrationConfigResponse`; if no such test file exists yet for the current `signup-form.tsx`, build the minimal `RegistrationConfigResponse` object by hand, matching the schema from Task 1's citation of `registrationConfigResponseSchema`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/features/auth-registration-security/guest/signup-start-form.render.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write minimal implementation**

Base this closely on the CURRENT `signup-form.tsx`'s field rendering for `fullName`, `email`, `phone` (reuse `Input`, `PhoneInput`, `PhoneValue`/`evaluatePhone`/`pickDefaultCountry` exactly as that file already does), but:

- remove `orgName`/`orgSlug`/`password`/`confirmPassword`/`acceptTerms` entirely (those move to Tasks 10-11)
- on submit, call `callApi('/auth/signup/start', { method: 'POST', body: parsed.data, schema: signupStartResponseSchema })` (not `postBff` — this call doesn't issue a session)
- on success, store the token/maskedEmail/expiry via the new `signup-challenge.ts` helper and `router.push('/signup/verify-email')` (a new route — see Task 12)

```tsx
// signup-challenge.ts
import type { SignupStartResponse } from '@crm/contracts';

const KEY = 'signup-email-pending';

export interface StoredSignupStage {
  token: string;
  maskedEmail: string;
  codeLength: number;
  expiresAt: number;
  resendAt: number;
}

export function saveSignupStage(res: SignupStartResponse, now: number): void {
  const stage: StoredSignupStage = {
    token: res.token,
    maskedEmail: res.maskedEmail,
    codeLength: res.codeLength,
    expiresAt: now + res.expiresInSeconds * 1000,
    resendAt: now + res.resendCooldownSeconds * 1000,
  };
  sessionStorage.setItem(KEY, JSON.stringify(stage));
}

export function readSignupStage(): StoredSignupStage | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSignupStage;
  } catch {
    return null;
  }
}

export function clearSignupStage(): void {
  sessionStorage.removeItem(KEY);
}
```

(Match `otp-challenge.ts`'s actual exported function names/shapes if they differ from this sketch — read that file first and keep this file's public API parallel to it, since Task 10's verify step and the existing `use-resend-verification.ts` conventions will be easiest to adapt that way.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/features/auth-registration-security/guest/signup-start-form.render.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/auth-registration-security/guest/signup-challenge.ts apps/web/src/features/auth-registration-security/guest/signup-start-form.tsx apps/web/src/features/auth-registration-security/guest/signup-start-form.render.test.ts
git commit -m "feat(auth): add signup step 1 (collect name/email/phone)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Web — step 2 (verify code), modeled on `otp-form.tsx`

**Files:**

- Create: `apps/web/src/features/auth-registration-security/guest/signup-verify-email-form.tsx`
- Test: `apps/web/src/features/auth-registration-security/guest/signup-verify-email-form.render.test.ts`

**Interfaces:**

- Consumes: `readSignupStage`/`saveSignupStage` (Task 9), `signupVerifyEmailCodeRequestSchema`/`Response`, `signupResendEmailCodeRequestSchema`/`Response` (Task 1), `callApi`.
- Produces: on success, advances to step 3 (`router.push('/signup/password')`), token unchanged in storage but now implicitly verified server-side.

- [ ] **Step 1: Write the failing test**

```ts
describe('SignupVerifyEmailForm', () => {
  it('redirects to /signup if there is no pending stage', () => {
    // same pattern OtpForm uses for its no-challenge redirect — mirror it
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/features/auth-registration-security/guest/signup-verify-email-form.render.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write minimal implementation**

Copy `otp-form.tsx`'s structure (the single-text-input-styled-as-boxes code field, countdown hooks, resend button, error mapping) near-verbatim, swapping:

- the stored-state type from `StoredChallenge` to `StoredSignupStage` (Task 9)
- the verify call from `postBff('signup-otp', ...)` to `callApi('/auth/signup/verify-email-code', { method: 'POST', body: { token, code }, schema: signupVerifyEmailCodeResponseSchema })` — this one does _not_ issue a session (no account exists yet), so it must be `callApi`, not `postBff`
- the resend call to `callApi('/auth/signup/resend-email-code', { method: 'POST', body: { token }, schema: signupResendEmailCodeResponseSchema })`
- on verify success: `router.push('/signup/password')` instead of `completeSignIn`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/features/auth-registration-security/guest/signup-verify-email-form.render.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/auth-registration-security/guest/signup-verify-email-form.tsx apps/web/src/features/auth-registration-security/guest/signup-verify-email-form.render.test.ts
git commit -m "feat(auth): add signup step 2 (verify email code)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Web — step 3 (password) and the signup router rewrite

**Files:**

- Create: `apps/web/src/features/auth-registration-security/guest/signup-password-form.tsx`
- Modify: `apps/web/src/features/auth-registration-security/guest/signup-form.tsx` (becomes a thin step router)
- Modify: `apps/web/src/features/auth-registration-security/guest/shell.render.test.ts` (the design-6 tests from the earlier Geta-design work render `page: 'register'` through `signup-form.tsx` — confirm they still pass against the new router)
- Test: `apps/web/src/features/auth-registration-security/guest/signup-password-form.render.test.ts`

**Interfaces:**

- Consumes: `readSignupStage`/`clearSignupStage` (Task 9), `signupSetPasswordRequestSchema` (Task 1), `bffSignupResponseSchema` (existing), `postBff` (existing — this call _does_ issue a session), `completeSignIn` (existing, used by the current `signup-form.tsx`).

- [ ] **Step 1: Write the failing test**

```ts
describe('SignupPasswordForm', () => {
  it('requires acceptTerms before submit is enabled', () => {
    // mirror the current signup-form.tsx's existing acceptTerms assertion, if any test covers it,
    // else write the straightforward render + click-submit-without-checkbox assertion
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/features/auth-registration-security/guest/signup-password-form.render.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Reuse the current `signup-form.tsx`'s `password`/`confirmPassword`/`acceptTerms` field rendering and validation (policy hint, match check) verbatim, dropping everything else. On submit:

```tsx
const stage = readSignupStage();
if (!stage) {
  router.push('/signup');
  return;
}
const res = await postBff(
  'signup-set-password',
  {
    token: stage.token,
    password,
    acceptTerms: agree ? (true as const) : (false as unknown as true),
    ...(referral ? { referralCode: referral } : {}),
  },
  bffSignupResponseSchema, // existing — same discriminated union signup already used, still covers otp_required for the phone-OTP case
);
clearSignupStage();
if (res.status === 'otp_required') {
  saveChallenge(toStoredChallenge(res, Date.now())); // existing helper from otp-challenge.ts
  router.push('/verify-otp');
  return;
}
completeSignIn(res);
```

This needs a new Next.js route handler `/api/auth/signup-set-password` mirroring the existing `/api/auth/signup` handler exactly (same session-cookie-setting shape) — find that handler (likely under `apps/web/src/app/api/auth/[action]/route.ts`, given the dynamic `[action]` segment pattern already used for `postBff('signup', ...)` and `postBff('signup-otp', ...)`) and confirm the new action name `signup-set-password` is picked up automatically by its existing dynamic dispatch, or add it to whatever allowlist/switch that route handler uses.

Now rewrite `signup-form.tsx` into a thin router (this becomes the file the `/signup` page renders):

```tsx
'use client';
import { useState } from 'react';
import { SignupStartForm } from './signup-start-form';
// the verify and password steps live on their own routes (/signup/verify-email, /signup/password),
// not inside this component — signup-form.tsx only ever renders step 1. Confirm this matches how
// /login vs /verify-otp are already split into separate page.tsx files under app/(auth)/, and
// mirror that: this task also adds apps/web/src/app/(auth)/signup/verify-email/page.tsx and
// apps/web/src/app/(auth)/signup/password/page.tsx, each a thin page wrapper around the
// corresponding step component, exactly like app/(auth)/verify-otp/page.tsx wraps OtpForm today.

export function SignupForm(props: SignupFormProps) {
  return <SignupStartForm {...props} />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/features/auth-registration-security/guest/signup-password-form.render.test.ts src/features/auth-registration-security/guest/shell.render.test.ts`
Expected: PASS — including the existing design-6 (Geta) tests from `shell.render.test.ts`, which exercise `page: 'register'` and must still find the form title inside the (now step-1-only) form column.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/auth-registration-security/guest/signup-password-form.tsx apps/web/src/features/auth-registration-security/guest/signup-password-form.render.test.ts apps/web/src/features/auth-registration-security/guest/signup-form.tsx apps/web/src/app/\(auth\)/signup/verify-email/page.tsx apps/web/src/app/\(auth\)/signup/password/page.tsx
git commit -m "feat(auth): add signup step 3 (password) and split signup into three routes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: i18n copy (en + ar) and `StepList` update

**Files:**

- Modify: `apps/web/messages/en/auth-registration-security.json`
- Modify: `apps/web/messages/ar/auth-registration-security.json`
- Modify: `apps/web/src/features/auth-registration-security/guest/step-list.tsx` (its `STEPS` array / translation keys — confirm against the file read earlier in this session whether "account" already covers this step or needs renaming, since workspace name no longer lives in step 1)
- Test: `apps/web/src/features/auth-registration-security/guest/message-keys.test.ts` (the existing repo-wide check that every `t('key')` call resolves — this is the test for this task, not a new one)

**Interfaces:**

- Consumes: nothing new.
- Produces: translation keys for all copy introduced in Tasks 9-11 (field labels, step titles, error copy, resend countdown text) — matching the exact key paths the new components call.

- [ ] **Step 1: Run the existing message-keys test to find what's missing**

Run: `cd apps/web && npx vitest run src/features/auth-registration-security/guest/message-keys.test.ts`
Expected: FAIL, listing every `t('...')` call from Tasks 9-11 that has no English message yet (the test itself enumerates them — read its failure output rather than guessing key names).

- [ ] **Step 2: Add the missing English keys**

For each path the failing test lists, add the key under `auth-registration-security.guest.signup.*` in `apps/web/messages/en/auth-registration-security.json`, following the existing tone/phrasing already used for the current `signup-form.tsx` labels and for `otp-form.tsx`'s verification copy (reuse that file's exact phrasing for "didn't get a code", "resend in N seconds", etc., swapping "WhatsApp" for "email" where the existing copy names the channel).

- [ ] **Step 3: Run test to verify it passes (English)**

Run: `cd apps/web && npx vitest run src/features/auth-registration-security/guest/message-keys.test.ts`
Expected: PASS

- [ ] **Step 4: Add the Arabic translations**

Mirror every key added in Step 2 into `apps/web/messages/ar/auth-registration-security.json`, translated (not copied in English) — follow this repo's existing Arabic phrasing style for the equivalent current signup/OTP strings as the register.

- [ ] **Step 5: Commit**

```bash
git add apps/web/messages/en/auth-registration-security.json apps/web/messages/ar/auth-registration-security.json apps/web/src/features/auth-registration-security/guest/step-list.tsx
git commit -m "feat(auth): add i18n copy for the three-step signup flow

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 13: Social login — same duplicate check

**Files:**

- Modify: `apps/api/src/modules/auth/flows/social-auth.service.ts` (find the exact file via `grep -rn "class SocialAuthService"` — this session's earlier research confirmed a `social.callback` method exists on `SocialAuthService`, injected into `registration.controller.ts`)
- Test: whatever existing social e2e spec covers `social/:provider/callback` (confirmed to exist at `apps/api/test/e2e/auth-registration-security/auth-signup-social.e2e.spec.ts` from this session's earlier exploration)

**Interfaces:**

- Consumes: `TenantDirectory.identityExists` (Task 3).

- [ ] **Step 1: Write the failing test**

```ts
it('rejects a Google sign-in whose email already has an account in another org', async () => {
  const email = `social-dup-${Date.now()}@example.test`;
  await harness.seedExistingUser({ email });
  const res = await harness.socialCallback('google', {
    email /* ...whatever shape the existing social callback tests already build */,
  });
  expect(res.status).toBe(409);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run test/e2e/auth-registration-security/auth-signup-social.e2e.spec.ts -t "already has an account"`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Find the exact point in `social-auth.service.ts`'s `callback()` where it decides "no existing user with this email, provision a new account" (it must already branch on this, since social login for a _returning_ user must behave differently from a _new_ one) and add the `identityExists` check immediately before that branch, throwing the same `AUTH_IDENTITY_EXISTS` error Task 5 added — but only on the "new account" branch, never when the OAuth email matches an account that already belongs to the signed-in flow's own org (a returning user logging in via Google must keep working).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run test/e2e/auth-registration-security/auth-signup-social.e2e.spec.ts`
Expected: PASS (new test, plus every pre-existing test in this file still green — confirms the check didn't break returning-user login)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/flows/social-auth.service.ts apps/api/test/e2e/auth-registration-security/auth-signup-social.e2e.spec.ts
git commit -m "feat(auth): apply the identity-exists check to social signup

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 14: Full gate, parity, and help docs

**Files:** none (verification task)

- [ ] **Step 1: Run the full pre-PR gate**

Run: `bash .claude/skills/pre-pr/scripts/gate.sh` (on Windows, prefix with `SWC_NATIVE_BINDING_CACHE="$HOME/.swc-ext-cache"` per this session's established workaround for the local SWC/Turbo env issue — or run `pnpm --filter web typecheck`/`pnpm --filter @crm/api test` directly per-package if the root gate hits that same known quirk)
Expected: all checks pass; any failure is fixed before moving on, not deferred.

- [ ] **Step 2: Run `wadesk-playwright-parity`**

Invoke the skill for the `auth-registration-security` domain's signup feature. On this machine it is expected to stamp `blocked-env` (PHP not installed for the WaDesk reference side) — record that stamp, same as the earlier Geta-design work in this session; do not treat it as a failure to fix.

- [ ] **Step 3: Run `help-docs-sync`**

The signup screen's existing guide (if any) needs its description of the flow updated to match the new three-step order and the "one account per email" rule — check `docs/help-pending.md` / the coverage gate test for what's required.

- [ ] **Step 4: Final commit if gate/docs produced changes**

```bash
git add -A -- apps/api apps/web docs
git commit -m "chore(auth): gate, parity stamp, and help docs for signup redesign

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
