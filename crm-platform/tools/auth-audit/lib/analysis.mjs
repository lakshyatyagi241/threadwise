// Curated narrative that goes into every report: how authentication works today, and how this audit adapted the
// reference standard to this product. It was written by reading the code (file references are real); the checks
// verify the claims that matter, and a claim that stops being true shows up as a failing check, not as silent drift.

export const ANALYSIS_DATE = '2026-10-09';

export const MECHANISMS = [
  {
    pool: 'Workspace staff (users)',
    credential:
      'Email + password (Argon2id), optional TOTP / recovery code, Google/Facebook sign-in, Clerk token exchange',
    token:
      'JWT access (15 min, HS256) + JWT refresh (30 d, separate secret) in httpOnly cookies set by the Next.js BFF; API takes Authorization: Bearer',
    server:
      'auth_sessions row per login; per request: platform epoch, Redis revocation tombstone, idle timeout (60 min default); refresh rotates a counter and revokes the session on reuse',
    where: 'apps/api/src/modules/auth/{flows,sessions,guards}',
  },
  {
    pool: 'Platform operators (super admins)',
    credential:
      'Email + password; TOTP is asked for only while the platform policy switch is on (an enrolled super admin is NOT challenged when it is off); IP allow-list optional',
    token:
      'Same JWT scheme, typ=platform_operator, 12 h, no "remember me", own refresh route (/platform/auth/refresh)',
    server: 'Own session table, own lockout, same guard',
    where: 'apps/api/src/modules/auth/platform/operator-auth.service.ts',
  },
  {
    pool: 'Partner agents (channel partners)',
    credential: 'Email + password, lockout; no MFA',
    token: 'JWT pair with NO session id; /auth/refresh re-issues from the old token',
    server:
      'None after sign-in (no revocation, no epoch, no status re-check) — see finding "partner-agent-revocation"',
    where: 'apps/api/src/modules/auth/auth.service.ts',
  },
  {
    pool: 'Customer API keys',
    credential: 'Bearer key `<prefix><40 random chars>` (~190 bits), scopes, expiry',
    token: 'Not a JWT; digest (sha256) stored, constant-time compare, looked up by 12-char prefix',
    server: 'Per-request status/expiry check; empty scope list = full access',
    where: 'apps/api/src/modules/developer-rest-api-v1/{auth,keys}',
  },
  {
    pool: 'Operator "act as" (impersonation)',
    credential: 'An operator session',
    token: 'Access-only JWT, capped lifetime, optional read-only flag',
    server:
      'impersonation_sessions row checked on every request; stop/expiry effective immediately; audited',
    where: 'apps/api/src/modules/auth/platform/impersonation.service.ts',
  },
  {
    pool: 'Real-time (Socket.IO /realtime)',
    credential: 'Single-use ticket from POST /v2/realtime/ticket, or an access token',
    token: 'Handshake middleware; revoked/suspended refused; periodic sweep drops revoked sockets',
    server: 'Rooms authorised per join',
    where: 'apps/api/src/realtime',
  },
  {
    pool: 'Browser (Next.js BFF)',
    credential: '—',
    token:
      'Tokens only in httpOnly, SameSite=Lax, Secure(prod) cookies; browser JS never sees them; BFF checks Origin on state-changing calls',
    server: 'API itself reads no cookies (bearer-only), so it cannot be CSRF-ed',
    where: 'apps/web/src/lib/auth, apps/web/src/app/api/auth',
  },
];

export const STRENGTHS = [
  'Authentication is the default: a global JwtAuthGuard runs first and a route must opt OUT with @Public(); a forgotten guard fails safe.',
  'Real server-side session control on top of JWTs: per-request revocation tombstone + platform epoch + idle timeout, so logout, password reset and "revoke everything" take effect on the next request even though access tokens are stateless.',
  'Refresh-token rotation with reuse detection that revokes the whole session (and audits it); a 30 s grace for racing browser tabs.',
  'Credential-stuffing awareness: dummy Argon2 verification for unknown accounts, one fixed error, per-(account,IP) lockout, per-IP failure ceiling, MFA failure budget that survives new challenges, optional captcha.',
  'Reset / verify / invite links: 256-bit random, stored only as SHA-256, atomically single-use, built from configuration (not the Host header), and a reset signs out every device.',
  'MFA hygiene: TOTP secret encrypted at rest, replay-proof time-step bookkeeping, recovery codes Argon2-hashed and single-use, MFA is honoured on every alternate sign-in path (social, Clerk, workspace switch).',
  'Tenant scope comes from the signed token and the database (row-level security), never from request parameters; workspace switch requires a verified email and re-challenges MFA.',
  'API keys stored as digests with constant-time comparison, ~190-bit random bodies, unbiased sampling.',
  'Impersonation is time-boxed, audited, individually revocable and can be read-only.',
  'Audit trail is written in the same transaction as the change; failures are recorded through a separate transaction; secrets are redacted by key name.',
];

/** How this audit adapted the reference standard. Written down so the choices can be argued with. */
export const ADAPTATIONS = [
  {
    topic: '"Opaque server sessions, JWT only where beneficial"',
    decision: 'Adapted',
    why: 'The product already uses short-lived JWTs backed by a server-side session row, a Redis tombstone and a platform epoch, which gives next-request revocation. Replacing it with opaque cookies would be a rewrite with no security gain. The audit therefore verifies the revocation properties directly (live probes) rather than demanding a different design.',
  },
  {
    topic: '500–800 generated tests as a target',
    decision: 'Rejected',
    why: 'A test count is not a security measure, and the product already has hundreds of auth tests (see the inventory). The audit measures what matters instead: every control is traced to checks and tests, gaps are listed per control, and the new tests added are attack-input probes aimed at the gaps. Parameterised payloads are counted as assertions, not as tests.',
  },
  {
    topic: 'Password minimum 15 (password-only) / 8 (with MFA)',
    decision: 'Adopted as a recommendation, reported as a policy decision',
    why: 'Right for new accounts, but changing the default alters sign-up for existing customers and WaDesk parity. The audit reports the current floor/default and asks for a recorded decision instead of failing the build.',
  },
  {
    topic: 'Fail closed if authoritative auth checks are unavailable',
    decision: 'Reported as a policy decision, not a defect',
    why: 'The code deliberately fails open on Redis errors and says why. Failing closed for every request would turn a cache outage into a full outage. The audit surfaces the trade-off, its consequence, and a middle path (alert + selective fail-closed).',
  },
  {
    topic: 'Remove composition rules (upper/digit/symbol)',
    decision: 'Adopted as a recommendation (low)',
    why: 'NIST/ASVS agree; the rules are WaDesk-parity defaults that admins can switch off, so it is a default change, not a vulnerability.',
  },
  {
    topic: 'WebAuthn / passkeys',
    decision: 'Adopted as a roadmap item (P1 gap)',
    why: 'Not implemented; TOTP only. Reported as NOT-IMPLEMENTED, never as passed, never as a release blocker on its own.',
  },
  {
    topic: 'Signed audit evidence (AUTH-100)',
    decision: 'Adapted',
    why: 'Every run writes a manifest with SHA-256 of each artefact, the git commit and whether the tree was dirty. Cryptographic signing needs a key owner and a CI secret; the manifest is the integrity layer to sign (e.g. with Sigstore/cosign in CI).',
  },
  {
    topic: 'OWASP ASVS requirement IDs',
    decision: 'Chapter-level mapping only',
    why: 'Exact requirement numbers must be copied from the ASVS 5.0 text, and the audit does not ship a copy of it. Controls are mapped to chapters (V6, V7, V8, V9, V10, V16…).',
  },
  {
    topic: 'Fuzzing and load testing (Schemathesis, ZAP, k6)',
    decision: 'Partially adopted',
    why: 'A small bounded set of attack payloads and a 10-request concurrency probe run in the live phase. Full fuzzing/load needs a dedicated environment and is listed as a follow-up; the tool detects k6/semgrep/gitleaks and uses them when present.',
  },
  {
    topic: '"Never test against production"',
    decision: 'Enforced in code',
    why: 'Live probes refuse any non-local host unless --allow-remote is given, and use only credentials passed on the command line or environment.',
  },
];
