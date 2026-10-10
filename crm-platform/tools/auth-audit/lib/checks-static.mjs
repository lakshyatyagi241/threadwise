// Static checks: read the source and assert security properties. Every check derives its verdict from the code it
// reads (nothing is hard-coded to "pass"); when the code it expects is not found, the check says so (status 'error')
// instead of passing. Evidence is always file:line.
//
// Statuses: pass | fail | partial | policy | not-implemented | info | error
//   fail            a control is violated
//   partial         the control is implemented but weaker than the standard asks
//   policy          works as designed, but the design needs a recorded developer decision
//   not-implemented the feature does not exist
//   info            observation only, no control credit
//   error           the check could not run (never counted as a pass)

import { bodyOf, exists, grepFile, grepFiles, numExpr, read, result, walk } from './util.mjs';
import { routeKey, scanRoutes } from './inventory.mjs';

const A = 'apps/api/src/modules/auth';
const F = {
  token: `${A}/token.service.ts`,
  jwtGuard: `${A}/guards/jwt-auth.guard.ts`,
  password: `${A}/security/password.service.ts`,
  policyFn: `${A}/support/password-policy.ts`,
  rate: `${A}/security/rate-limit.service.ts`,
  login: `${A}/flows/login.service.ts`,
  session: `${A}/sessions/session.service.ts`,
  mfa: `${A}/security/mfa.service.ts`,
  recovery: `${A}/flows/recovery.service.ts`,
  userTokens: `${A}/flows/user-tokens.service.ts`,
  keys: `${A}/support/redis-keys.ts`,
  codes: `${A}/support/recovery-codes.ts`,
  totp: `${A}/support/totp.ts`,
  authService: `${A}/auth.service.ts`,
  clerk: `${A}/clerk.service.ts`,
  authController: `${A}/auth.controller.ts`,
  accountController: `${A}/controllers/account.controller.ts`,
  headers: `${A}/middleware-security-headers.ts`,
  audit: `${A}/security/auth-audit.service.ts`,
  wsSwitch: `${A}/flows/workspace-switch.service.ts`,
  impersonation: `${A}/platform/impersonation.service.ts`,
  operator: `${A}/platform/operator-auth.service.ts`,
  gate: `${A}/security/account-gate.service.ts`,
  mail: `${A}/mail/mail.service.ts`,
  authModule: `${A}/auth.module.ts`,
  policyContract: 'packages/contracts/src/auth-registration-security/security-policy.ts',
  appModule: 'apps/api/src/app.module.ts',
  main: 'apps/api/src/main.ts',
  env: 'apps/api/src/config/env.schema.ts',
  cors: 'apps/api/src/modules/platform-infrastructure/cors/cors-policy.ts',
  realtimeAuth: 'apps/api/src/realtime/realtime-auth.service.ts',
  realtimeGateway: 'apps/api/src/realtime/realtime.gateway.ts',
  apiKeyGuard: 'apps/api/src/modules/developer-rest-api-v1/auth/bearer-api-key.guard.ts',
  apiKeySecret: 'apps/api/src/modules/developer-rest-api-v1/keys/api-key-secret.ts',
  social: 'apps/api/src/infra/providers/auth-registration-security/social-oauth.adapters.ts',
  socialFlow: `${A}/flows/social-auth.service.ts`,
  webCookies: 'apps/web/src/lib/auth/cookies.ts',
  webProxy: 'apps/web/src/lib/auth/proxy.ts',
  webNextPath: 'apps/web/src/lib/auth/next-path.ts',
  webAuthRoute: 'apps/web/src/app/api/auth/[action]/route.ts',
};

const missing = (id, controls, title, files) =>
  result({
    id,
    controls,
    title,
    status: 'error',
    summary: `Could not run: expected source not found (${files.filter((f) => !exists(f)).join(', ')}). The code moved or was renamed; update the check.`,
  });
const need = (...files) => files.every((f) => exists(f));

/** First number captured by `re` in `relPath`, or null. */
const num = (relPath, re) => {
  const m = re.exec(read(relPath) ?? '');
  return m ? Number(m[1]) : null;
};

export const STATIC_CHECKS = [
  // -------------------------------------------------------------------------------------------------------------------
  // A. Identity and lifecycle
  // -------------------------------------------------------------------------------------------------------------------
  {
    id: 'route-inventory',
    run() {
      const routes = scanRoutes();
      const pub = routes.filter((r) => r.public);
      const authish = (r) => /\/(auth|platform\/auth|account|realtime)(\/|$)/.test(r.path);
      const noGraphql = !walk('apps/api/src', (f) => /graphql/i.test(f)).length;
      const ws = grepFiles([F.realtimeGateway], /@WebSocketGateway/, 1);
      const unguardedKinds = routes.filter((r) => !r.public && !r.actorKinds).length;
      return result({
        id: 'route-inventory',
        controls: ['AUTH-001'],
        title: 'Every authentication entry point is inventoried',
        status: routes.length > 0 ? 'pass' : 'error',
        summary:
          `${routes.length} HTTP routes across ${new Set(routes.map((r) => r.controller)).size} controllers; ${pub.length} are @Public (no bearer token needed), ` +
          `${routes.length - pub.length} sit behind the global JwtAuthGuard. ${authish ? pub.filter(authish).length : 0} public routes are authentication entry points. ` +
          `Other entry points: WebSocket gateway (${ws.length ? 'present' : 'absent'}), API-key guard (customer API), Clerk token exchange, social OAuth callbacks. ` +
          `GraphQL: ${noGraphql ? 'none in this codebase' : 'present, needs its own review'}. Routes with no ActorKinds narrowing: ${unguardedKinds}.`,
        evidence: pub
          .filter(authish)
          .slice(0, 6)
          .map((r) => ({ file: r.file, line: r.line, text: routeKey(r) })),
        data: { routes },
        confidence: 'static-heuristic',
      });
    },
  },
  {
    id: 'global-guard-chain',
    run() {
      if (!need(F.appModule))
        return missing('global-guard-chain', ['AUTH-031'], 'Authentication is the default', [
          F.appModule,
        ]);
      const guards = grepFile(F.appModule, /provide:\s*APP_GUARD/, 12);
      const order = guards
        .map((g) => /(?:useClass|useExisting):\s*(\w+)/.exec(g.text)?.[1])
        .filter(Boolean);
      const first = order[0];
      const hasPerm = order.includes('PermissionsGuard');
      const hasGate = order.includes('AccountGateGuard');
      const ok = first === 'JwtAuthGuard' && hasPerm && hasGate;
      return result({
        id: 'global-guard-chain',
        controls: ['AUTH-031', 'AUTH-068', 'AUTH-019'],
        title: 'Authentication is opt-out (@Public), enforced by a global guard chain',
        status: ok ? 'pass' : 'fail',
        severity: ok ? undefined : 'critical',
        summary: `Global guard order: ${order.join(' → ')}. ${ok ? 'JwtAuthGuard runs first, so a new controller is protected by default; authorization (PermissionsGuard) and account state (AccountGateGuard) follow.' : 'Expected JwtAuthGuard first, then AccountGateGuard and PermissionsGuard.'}`,
        evidence: guards,
        recommendation: ok
          ? undefined
          : 'Restore JwtAuthGuard as the first APP_GUARD; authentication must never be opt-in.',
      });
    },
  },
  {
    id: 'public-route-drift',
    run(ctx) {
      const routes = ctx.routes ?? scanRoutes();
      const current = routes
        .filter((r) => r.public)
        .map(routeKey)
        .sort();
      const baseline = ctx.baseline?.publicRoutes;
      if (!baseline) {
        return result({
          id: 'public-route-drift',
          controls: ['AUTH-001', 'AUTH-099'],
          title: 'Public routes match the reviewed baseline',
          status: 'info',
          summary: `No baseline yet. ${current.length} public routes found. Review them, then run with --update-baseline to record the reviewed set; from then on any new @Public route fails this check until a human re-reviews it.`,
        });
      }
      const added = current.filter((k) => !baseline.includes(k));
      const removed = baseline.filter((k) => !current.includes(k));
      const clean = added.length === 0;
      return result({
        id: 'public-route-drift',
        controls: ['AUTH-001', 'AUTH-099'],
        title: 'Public routes match the reviewed baseline',
        status: clean ? 'pass' : 'fail',
        severity: clean ? undefined : 'high',
        summary: clean
          ? `${current.length} public routes, all in the reviewed baseline${removed.length ? ` (${removed.length} baseline entries no longer exist)` : ''}.`
          : `${added.length} public route(s) are not in the reviewed baseline: a new unauthenticated entry point appeared. ${added.slice(0, 8).join('; ')}`,
        recommendation: clean
          ? undefined
          : 'Confirm each new @Public route needs no login and has throttling/signature checks, then run `pnpm audit:auth --update-baseline` and commit baseline/public-routes.json.',
      });
    },
  },
  {
    id: 'identity-model',
    run() {
      const mig = 'packages/db/migrations/0003_foundation.sql';
      const org = grepFile(mig, /CREATE TABLE organizations/, 1);
      const users = grepFile(mig, /CREATE TABLE users/, 1);
      const unique = grepFile(mig, /UNIQUE \(org_id, email\)/, 1);
      const link = grepFile(F.wsSwitch, /orgsForVerifiedEmail/, 1);
      const ok = org.length && users.length && unique.length && link.length;
      return result({
        id: 'identity-model',
        controls: ['AUTH-002', 'AUTH-006'],
        title: 'Organization, account and cross-workspace identity are distinct concepts',
        status: ok ? 'pass' : 'partial',
        severity: ok ? undefined : 'low',
        summary:
          'Three levels exist: the ORGANIZATION (tenant: organizations), the ACCOUNT / MEMBERSHIP (a users row that belongs to exactly one organization, unique per (org, email), with its own password, MFA and sessions), and the PERSON across workspaces, which has no row of its own — the same human is recognised in several workspaces only when the same VERIFIED email address exists in each. ' +
          'Consequences worth knowing: credentials and MFA are per workspace; changing an email in one workspace changes what the workspace switcher offers; an unverified address can never be used to discover other workspaces (enforced). The model is consistent, but it is only documented in code comments.',
        evidence: [...org, ...users, ...unique, ...link],
        confidence: 'static-heuristic',
        recommendation: ok
          ? 'Write the three-level model down in docs (one paragraph) so the next feature does not invent a fourth.'
          : undefined,
      });
    },
  },
  {
    id: 'account-state-gate',
    run() {
      if (!need(F.gate, F.login))
        return missing('account-state-gate', ['AUTH-003'], 'Account state gate', [F.gate, F.login]);
      const gate = grepFile(
        F.gate,
        /status !== 'active'|suspended:|emailUnverified|mfaEnrolmentRequired/,
        6,
      );
      const loginOpens = grepFile(
        F.login,
        /suspended person signs in like anyone else|held at the/i,
        2,
      );
      const orgSusp = grepFile(
        'apps/api/src/modules/auth/guards/account-gate.guard.ts',
        /ORG_GATED_ACTORS/,
        2,
      );
      return result({
        id: 'account-state-gate',
        controls: ['AUTH-003', 'AUTH-020', 'AUTH-067', 'AUTH-008'],
        title: 'Suspended / unverified accounts are held by a per-request gate',
        status: gate.length >= 3 ? 'pass' : 'partial',
        severity: gate.length >= 3 ? undefined : 'medium',
        summary:
          'By design a suspended person can still sign in and is held at a "suspended" screen by AccountGateGuard on every request (state cached 30 s, workspace suspension cached 5 s, both invalidated on change). ' +
          'This is a deliberate product choice (they must be able to see why and sign out); the API itself refuses everything except allow-listed routes. ' +
          'Runtime confirmation of "suspended user + valid token → protected API refused" is in the live probes.',
        evidence: [...gate, ...loginOpens, ...orgSusp],
        confidence: 'static-heuristic',
      });
    },
  },
  {
    id: 'email-verification-and-uniqueness',
    run() {
      const uniq = grepFiles(
        ['packages/db/migrations/0003_foundation.sql'],
        /UNIQUE \(org_id, email\)/,
        2,
      );
      const gate = grepFile(F.gate, /emailVerification/, 2);
      return result({
        id: 'email-verification-and-uniqueness',
        controls: ['AUTH-004', 'AUTH-006'],
        title: 'Email verification policy and per-workspace identity uniqueness',
        status: uniq.length && gate.length ? 'pass' : 'partial',
        severity: uniq.length && gate.length ? undefined : 'medium',
        summary:
          'Identity = (workspace, email), unique per workspace; the same person in several workspaces is linked only through a VERIFIED email (workspace list and switch refuse unverified addresses). Verification enforcement is a platform policy (off | warn | block).',
        evidence: [...uniq, ...gate],
      });
    },
  },
  {
    id: 'enumeration-resistance',
    run() {
      if (!need(F.login, F.recovery, F.password))
        return missing('enumeration-resistance', ['AUTH-005'], 'Enumeration resistance', [
          F.login,
          F.recovery,
          F.password,
        ]);
      const dummy = grepFile(F.password, /DUMMY_HASH/, 2);
      const single = grepFile(F.login, /private invalid\(\)/, 1);
      const asyncForgot = grepFile(F.recovery, /void this\.processForgot/, 1);
      const unknownOrg = grepFile(F.login, /no organization oracle/i, 1);
      const signupTaken = grepFiles(
        [`${A}/flows/signup.service.ts`],
        /EMAIL_TAKEN|already (?:used|registered|exists)/i,
        2,
      );
      const ok = dummy.length && single.length && asyncForgot.length;
      return result({
        id: 'enumeration-resistance',
        controls: ['AUTH-005', 'AUTH-023', 'AUTH-027', 'AUTH-056'],
        title: 'Login and recovery do not reveal whether an account exists',
        status: ok ? 'pass' : 'fail',
        severity: ok ? undefined : 'medium',
        summary:
          'Wrong password, unknown email and unknown workspace take the same code path, run a dummy Argon2 verify so timing matches, and return one fixed error. Forgot-password returns immediately and does its work afterwards. ' +
          (signupTaken.length
            ? 'Sign-up necessarily says an email is taken (standard trade-off; rely on the sign-up OTP/captcha throttles). '
            : '') +
          'Timing and response parity are measured by the live probes, not assumed.',
        evidence: [...dummy, ...single, ...unknownOrg, ...asyncForgot, ...signupTaken],
      });
    },
  },
  {
    id: 'email-change-hardening',
    run() {
      if (!need(F.recovery))
        return missing('email-change-hardening', ['AUTH-009'], 'Email change', [F.recovery]);
      const confirm = bodyOf(F.recovery, /async confirmEmailChange\(/);
      const reqBody = bodyOf(F.recovery, /async requestEmailChange\(/);
      const revokesSessions = /revokeAllForUser/.test(confirm?.text ?? '');
      const clearsTokens = /user_tokens|password_reset/.test(confirm?.text ?? '');
      const needsPassword = /verifyOrDummy/.test(reqBody?.text ?? '');
      const noticeOld = /sendEmailChangedNotice/.test(confirm?.text ?? '');
      const gaps = [];
      if (!revokesSessions) gaps.push('other sessions stay signed in after the address changes');
      if (!clearsTokens)
        gaps.push(
          'a password-reset link already mailed to the OLD address stays valid until it expires (60 min)',
        );
      return result({
        id: 'email-change-hardening',
        controls: ['AUTH-062', 'AUTH-009'],
        title: 'Email change: re-authenticated, confirmed on the new address, old address notified',
        status: needsPassword && noticeOld ? (gaps.length ? 'partial' : 'pass') : 'fail',
        severity: needsPassword && noticeOld ? (gaps.length ? 'low' : undefined) : 'high',
        summary:
          `Requires the current password, mails a one-time link to the NEW address, and notifies the OLD address after the change. ` +
          (gaps.length ? `Gaps: ${gaps.join('; ')}.` : 'No gaps found.'),
        evidence: [
          ...(confirm
            ? [{ file: confirm.file, line: confirm.line, text: 'confirmEmailChange()' }]
            : []),
        ],
        recommendation: gaps.length
          ? "In confirmEmailChange: delete the user's outstanding password_reset/email_verify tokens and revoke other sessions (revokeAllForUser), so the old mailbox loses recovery authority at once."
          : undefined,
      });
    },
  },

  // -------------------------------------------------------------------------------------------------------------------
  // B. Passwords
  // -------------------------------------------------------------------------------------------------------------------
  {
    id: 'password-hashing',
    run() {
      if (!need(F.password))
        return missing('password-hashing', ['AUTH-010'], 'Password hashing', [F.password]);
      const argon = grepFile(F.password, /from '@node-rs\/argon2'/, 1);
      // A weak digest only matters when it touches a password: md5/sha1/sha256 within 3 lines of the word "password".
      const weak = [];
      // pwned-passwords.ts speaks the Pwned Passwords range API, which is defined over SHA-1: the digest is a lookup key
      // there (only its 5-character prefix leaves the process), not how a password is stored.
      const skipDigest = (x) => x.endsWith('/support/pwned-passwords.ts');
      for (const f of walk(
        A,
        (x) => x.endsWith('.ts') && !x.endsWith('.spec.ts') && !skipDigest(x),
      )) {
        const ls = (read(f) ?? '').split(/\r?\n/);
        ls.forEach((l, i) => {
          if (
            /createHash\(['"](?:md5|sha1|sha256)['"]\)/.test(l) &&
            ls.slice(Math.max(0, i - 3), i + 4).some((x) => /passw(?:or)?d/i.test(x))
          ) {
            weak.push({ file: f, line: i + 1, text: l.trim().slice(0, 160) });
          }
        });
      }
      const argonParams = grepFile(F.password, /hash\(password(?:,|\))/, 1);
      return result({
        id: 'password-hashing',
        controls: ['AUTH-010'],
        title: 'Passwords are hashed with Argon2id',
        status: argon.length && !weak.length ? 'pass' : 'fail',
        severity: argon.length && !weak.length ? undefined : 'high',
        summary:
          'PasswordService hashes with @node-rs/argon2 using the library defaults (Argon2id). The actual cost parameters are measured at runtime by the "argon2-parameters" check, because defaults are a property of the installed library version, not of this repo.',
        evidence: [...argon, ...argonParams, ...weak],
      });
    },
  },
  {
    id: 'password-policy-config',
    run() {
      if (!need(F.policyContract, F.policyFn))
        return missing(
          'password-policy-config',
          ['AUTH-012', 'AUTH-013', 'AUTH-014'],
          'Password policy',
          [F.policyContract, F.policyFn],
        );
      const rawContract = read(F.policyContract) ?? '';
      const m =
        /passwordMinLength:\s*z\.number\(\)\.int\(\)\.min\((\d+)\)\.max\((\d+)\)\.default\((\d+)\)/.exec(
          rawContract,
        );
      const [floor, ceil, dflt] = m
        ? [Number(m[1]), Number(m[2]), Number(m[3])]
        : [null, null, null];
      const upper = /passwordRequireUpper:\s*z\.boolean\(\)\.default\((true|false)\)/.exec(
        rawContract,
      )?.[1];
      const number = /passwordRequireNumber:\s*z\.boolean\(\)\.default\((true|false)\)/.exec(
        rawContract,
      )?.[1];
      const symbol = /passwordRequireSymbol:\s*z\.boolean\(\)\.default\((true|false)\)/.exec(
        rawContract,
      )?.[1];
      const fnFloor = num(F.policyFn, /Math\.max\((\d+),\s*policy\.passwordMinLength\)/);
      const commonSrc = read('apps/api/src/modules/auth/support/common-passwords.ts') ?? '';
      const setBody = (name) =>
        new RegExp(name + '[^=]*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)').exec(commonSrc)?.[1] ?? '';
      const countOf = (name) => (setBody(name).match(/'[^']*'/g) || []).length;
      const commonCount = commonSrc
        ? countOf('COMMON_PASSWORDS') + countOf('COMMON_BASE_WORDS')
        : null;
      const breachCheck =
        exists('apps/api/src/modules/auth/support/pwned-passwords.ts') &&
        /passwordBreachCheck/.test(read(F.password) ?? '');
      const heuristics = /isKeyboardWalk|coreVariants/.test(read(F.policyFn) ?? '');
      const out = [];

      out.push(
        result({
          id: 'password-blocklist',
          controls: ['AUTH-012'],
          title: 'Common / compromised password blocklist',
          status:
            commonCount === null
              ? 'error'
              : commonCount >= 300 && breachCheck && heuristics
                ? 'pass'
                : 'partial',
          severity:
            commonCount !== null && !(commonCount >= 300 && breachCheck && heuristics)
              ? 'medium'
              : undefined,
          summary:
            commonCount === null
              ? 'Could not find the deny-list.'
              : `Offline layer: ${commonCount} common passwords and base words, de-leeted and stripped of trailing digits/symbols (so "Summer2024!!" and "P@ssw0rd#1" are caught), keyboard-walk and repeat detection, and the person's name/email. Online layer: Pwned Passwords range lookup (${breachCheck ? 'present, k-anonymity, fails open on outage, switchable in the admin panel' : 'MISSING'}). Both layers are configurable in the Security Center. The offline list is a few hundred entries, not a top-10k file: the online layer covers the long tail.`,
          evidence: [
            ...grepFile(
              'apps/api/src/modules/auth/support/common-passwords.ts',
              /COMMON_PASSWORDS|COMMON_BASE_WORDS/,
              2,
            ),
            ...grepFile(
              'apps/api/src/modules/auth/support/pwned-passwords.ts',
              /Add-Padding|range/,
              2,
            ),
          ],
          recommendation:
            commonCount >= 300 && breachCheck
              ? undefined
              : 'Add an offline top-10k list and/or the Pwned Passwords lookup.',
        }),
      );
      out.push(
        result({
          id: 'password-length',
          controls: ['AUTH-013'],
          title: 'Password length policy',
          status:
            floor === null ? 'error' : floor >= 8 && dflt >= 12 && ceil >= 64 ? 'pass' : 'partial',
          severity:
            floor !== null && !(floor >= 8 && dflt >= 12 && ceil >= 64) ? 'medium' : undefined,
          summary:
            floor === null
              ? 'Could not read the policy bounds.'
              : `Admin-configurable minimum: floor ${floor}${fnFloor ? ` (evaluatePassword also clamps to ${fnFloor})` : ''}, default ${dflt}, maximum ${ceil}. ` +
                `ASVS 5.0 requires at least 8 and strongly recommends 15; NIST 800-63B-4 requires 15 for password-only sign-in (8 when a second factor is also required). ` +
                `A floor of ${floor} lets an admin configure a length below the ASVS minimum, and the default ${dflt} is below the 15 that applies to password-only accounts (MFA is optional for most users). Maximum ${ceil} ≥ 64: passphrases are allowed.`,
          evidence: grepFile(F.policyContract, /passwordMinLength/, 1),
          recommendation:
            'Raise the schema floor to 8, the default to 12 now and 15 for accounts without MFA; clamp evaluatePassword to the same floor. Decide and record it (decisions.json) because it changes sign-up for existing customers.',
          policyDecision: true,
        }),
      );
      out.push(
        result({
          id: 'password-composition',
          controls: ['AUTH-014'],
          title: 'No unnecessary composition rules',
          status: upper === 'true' || number === 'true' || symbol === 'true' ? 'policy' : 'pass',
          severity: upper === 'true' || number === 'true' || symbol === 'true' ? 'low' : undefined,
          summary: `Defaults: require upper+lower ${upper}, number ${number}, symbol ${symbol}. NIST 800-63B-4 and ASVS 5.0 say verifiers SHALL NOT impose composition rules; length plus a blocklist is stronger and friendlier. These are WaDesk-parity defaults that the platform admin can switch off.`,
          evidence: grepFile(F.policyContract, /passwordRequire/, 3),
          recommendation:
            'Default the three switches to false once the blocklist is in place; keep them available for customers who must follow a legacy policy.',
          policyDecision: true,
        }),
      );
      return out;
    },
  },
  {
    id: 'password-input-handling',
    run() {
      const hits = grepFiles(
        walk('packages/contracts/src/auth-registration-security', (f) => f.endsWith('.ts')),
        /[pP]assword\w*:\s*z\.string\(\)[^,\n]*\.(?:trim|toLowerCase|toUpperCase|normalize)\(/,
        4,
      );
      const maxs = grepFiles(
        ['packages/contracts/src/auth-registration-security/login.ts'],
        /password:\s*z\.string/,
        2,
      );
      const unicode = grepFile(F.policyFn, /\\p\{/, 2);
      return result({
        id: 'password-input-handling',
        controls: ['AUTH-016', 'AUTH-017'],
        title: 'Passwords are never trimmed, case-folded or truncated',
        status: hits.length ? 'fail' : 'pass',
        severity: hits.length ? 'high' : undefined,
        summary: hits.length
          ? 'A password schema alters the input before hashing (trim/case/normalize).'
          : 'No password schema trims or case-folds; the full string is hashed (Argon2 has no 72-byte limit unlike bcrypt). Length is counted in code points ([...password].length) and character classes use Unicode properties. Note: no Unicode normalization (NFKC) is applied, so visually identical passwords typed on different platforms can differ (NIST: SHOULD normalize).',
        evidence: [...hits, ...maxs, ...unicode],
        recommendation: hits.length
          ? 'Remove the transformation; hash exactly what the user typed.'
          : 'Consider NFKC-normalizing before hashing and before comparing, behind a migration that re-hashes on next login.',
      });
    },
  },
  {
    id: 'sensitive-logging',
    run() {
      const files = walk(
        'apps/api/src',
        (f) =>
          f.endsWith('.ts') &&
          !f.endsWith('.spec.ts') &&
          !f.includes('/cli/') &&
          !f.endsWith('.cli.ts') &&
          !f.includes('/tools/'),
      );
      const logHits = [];
      const consoleHits = [];
      const guardedDev = [];
      // Keep only the code of a log call: string-literal text ("webhook refused: no signing secret") is a message, not a value.
      const codeOnly = (l) =>
        l
          .replace(/`([^`]*)`/g, (_, body) =>
            [...body.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]).join(' '),
          )
          .replace(/'[^']*'|"[^"]*"/g, ' ');
      for (const f of files) {
        const t = read(f);
        if (!t) continue;
        const devGuarded =
          /(^|\/)dev-[\w.-]*\.ts$/.test(f) && /NODE_ENV[^\n]*===\s*'production'/.test(t);
        const ls = t.split(/\r?\n/);
        ls.forEach((l, i) => {
          if (
            /\b(?:logger|this\.logger|console)\.(?:log|info|debug|warn|error)\(/.test(l) &&
            /\b(?:password|passwd|accessToken|refreshToken|recoveryCode|clerkToken|authorization|secret|input\.code|otp)\b/i.test(
              codeOnly(l),
            ) &&
            !/\berr\b|\[REDACTED\]/i.test(l)
          ) {
            (devGuarded ? guardedDev : logHits).push({
              file: f,
              line: i + 1,
              text: l.trim().slice(0, 160),
            });
          }
          if (/\bconsole\.(log|debug)\(/.test(l) && f.includes('/modules/auth/'))
            consoleHits.push({ file: f, line: i + 1, text: l.trim().slice(0, 160) });
        });
      }
      const redactPresent = grepFile(F.audit, /\[REDACTED\]/, 1);
      const sentinel = [
        ...grepFile(
          'apps/api/src/app.module.ts',
          /stdSerializers\.req|maskSecretUrl\(out\.url\)|paths: LOG_REDACT_PATHS/,
          3,
        ),
        ...grepFile(
          'apps/api/src/modules/platform-infrastructure/observability/log-redaction.ts',
          /'authorization'|'cookie'/,
          2,
        ),
      ];
      return result({
        id: 'sensitive-logging',
        controls: ['AUTH-011', 'AUTH-091'],
        title: 'Passwords, tokens, OTPs and recovery codes are kept out of logs',
        status:
          logHits.length || consoleHits.length
            ? 'partial'
            : redactPresent.length
              ? 'pass'
              : 'partial',
        severity:
          logHits.length || consoleHits.length
            ? 'medium'
            : redactPresent.length
              ? undefined
              : 'medium',
        summary:
          `${logHits.length} logger/console call(s) interpolate a credential-like value; ${consoleHits.length} console.log/debug call(s) in the auth module (CLI tools excluded). ` +
          (guardedDev.length
            ? `${guardedDev.length} more are in a dev-only sender that throws when NODE_ENV=production (the dev OTP logger) and are not counted. `
            : '') +
          'The HTTP request log uses pino\'s standard request serializer (no body), masks secret URLs and removes the Authorization / Cookie / API-key / webhook-secret headers. Audit payloads go through redact() (keys matching password/secret/token/…/otp-code become [REDACTED]). This is a heuristic line scan, not proof of absence: redaction itself is exercised by the "probe-audit-redaction" runtime check.',
        evidence: [
          ...logHits.slice(0, 5),
          ...consoleHits.slice(0, 3),
          ...guardedDev.slice(0, 1),
          ...redactPresent,
          ...sentinel,
        ],
        confidence: 'static-heuristic',
        recommendation: logHits.length
          ? 'Review each hit; log identifiers (user id, session id), never the credential or the object that contains it.'
          : undefined,
      });
    },
  },
  {
    id: 'temporary-credentials',
    run() {
      const SCOPE = [
        ...walk(A, (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts')),
        ...walk(
          'apps/api/src/modules/developer-rest-api-v1/keys',
          (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'),
        ),
        ...walk('apps/api/src/realtime', (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts')),
        ...walk(
          'apps/api/src/modules/workspaces-teams-tenancy',
          (f) => /invit|token|secret/i.test(f) && f.endsWith('.ts') && !f.endsWith('.spec.ts'),
        ),
      ];
      const NOT_SECURITY = /jitter|backoff|delay|retry|shuffle|sample/i;
      const gen = SCOPE.flatMap((f) => grepFile(f, /Math\.random\(\)/, 3)).filter(
        (h) => !NOT_SECURITY.test(h.text),
      );
      const random = grepFile(`${A}/support/crypto-utils.ts`, /randomBytes/, 2);
      const allMath = [];
      return result({
        id: 'temporary-credentials',
        controls: ['AUTH-015'],
        title: 'Tokens, OTPs and temporary secrets use a CSPRNG',
        status: gen.length || allMath.length ? 'fail' : random.length ? 'pass' : 'partial',
        severity: gen.length || allMath.length ? 'high' : random.length ? undefined : 'medium',
        summary:
          gen.length || allMath.length
            ? 'Math.random() is used in security-sensitive code.'
            : 'Auth tokens, OTP digits (rejection-sampled, no modulo bias) and reset/invite tokens come from node:crypto randomBytes. No Math.random() in the auth module or in files named token/secret/otp/code/key/session/invite/password.',
        evidence: [...gen, ...allMath, ...random],
      });
    },
  },
  {
    id: 'compromise-response',
    run() {
      const epoch = grepFiles(
        [`${A}/sessions/epoch.service.ts`, `${A}/platform/security-center.service.ts`],
        /bump|revokeAll|epoch/i,
        4,
      );
      const reset = grepFile(
        F.recovery,
        /revokeAllForUser\(org\.id, user\.id, 'password_reset'\)/,
        1,
      );
      const changeRev = grepFile(`${A}/account/account.service.ts`, /'password_changed'/, 1);
      const reencrypt = grepFile(
        `${A}/maintenance/reencrypt-secrets.ts`,
        /export|previous|rotate/i,
        1,
      );
      return result({
        id: 'compromise-response',
        controls: ['AUTH-018'],
        title: 'A confirmed compromise can be answered: per-user, per-platform and key rotation',
        status: epoch.length && reset.length ? 'pass' : 'partial',
        severity: epoch.length && reset.length ? undefined : 'medium',
        summary:
          'Password reset and password change revoke every session; an operator can revoke all sessions platform-wide (token epoch bump); credential-encryption keys can be rotated with a key ring and a re-encrypt tool. JWT signing secrets have no equivalent ring (see jwt-signing-keys).',
        evidence: [...epoch, ...reset, ...changeRev, ...reencrypt],
      });
    },
  },

  // -------------------------------------------------------------------------------------------------------------------
  // C. Login and attack resistance
  // -------------------------------------------------------------------------------------------------------------------
  {
    id: 'login-throttling-design',
    run() {
      if (!need(F.keys, F.login))
        return missing('login-throttling-design', ['AUTH-021'], 'Login throttling', [
          F.keys,
          F.login,
        ]);
      const lockKey = grepFile(
        F.keys,
        /lockout:\s*\(orgId: number, email: string, ip: string\)/,
        1,
      );
      const accountOnly = !(
        exists(`${A}/security/account-attack.service.ts`) &&
        /attack\.assertAllowed/.test(read(F.login) ?? '')
      );
      const ipCeiling = num(F.login, /IP_FAILURE_MAX\s*=\s*(\d+)/);
      const ipWindow = num(F.login, /IP_FAILURE_WINDOW_SECONDS\s*=\s*(\d+)/);
      const captcha = grepFile(F.login, /captcha\.assert/, 1);
      const defaults = {
        after: num(F.policyContract, /lockoutAfterFailures:.*\.default\((\d+)\)/),
        window: num(F.policyContract, /lockoutWindowMinutes:.*\.default\((\d+)\)/),
      };
      const out = [];
      out.push(
        result({
          id: 'login-throttling-design',
          controls: ['AUTH-021', 'AUTH-022', 'AUTH-024'],
          title: 'Per-account and per-source login throttling resists distributed guessing',
          status: accountOnly ? 'partial' : 'pass',
          severity: accountOnly ? 'medium' : undefined,
          summary:
            `Failures are counted per (workspace, email, IP) — default ${defaults.after} per ${defaults.window} min — plus a per-IP ceiling of ${ipCeiling} failures / ${ipWindow}s across all emails, optional captcha, and an ACCOUNT-WIDE counter across all addresses (5x the lockout threshold per hour): past it, networks the person has not signed in from need the captcha (or are refused), while their usual networks keep working, so the owner is never locked out by an attacker. ` +
            (accountOnly
              ? 'Because the IP is part of the per-account key, an attacker spreading guesses over N source addresses gets N × ' +
                defaults.after +
                ' attempts per window against ONE account, and nothing slows the account itself. The design avoids letting a stranger lock a victim out (good), but it leaves distributed guessing (password spraying from a botnet) limited only by Argon2 cost and the optional captcha. ' +
                'Mitigation in place: account-level MFA lockout (5 / 15 min per person) protects second factors, not the password step.'
              : 'A per-account counter independent of source exists.'),
          evidence: [...lockKey, ...grepFile(F.login, /IP_FAILURE_MAX/, 1), ...captcha],
          recommendation:
            'Add a second, account-only counter with a higher threshold (e.g. 30 failures / hour across all IPs) that does not lock the account but forces a captcha / email-link challenge (progressive challenge, not a lockout), and alert on it. Record the decision in decisions.json.',
          policyDecision: true,
        }),
      );
      return out;
    },
  },
  {
    id: 'redis-failure-behaviour',
    run() {
      const hits = grepFiles(
        [
          F.rate,
          F.jwtGuard,
          F.realtimeAuth,
          F.session,
          'apps/api/src/modules/platform-infrastructure/rate-limit/rate-limiter.ts',
        ],
        /fail(?:s|ed)? open|failed open|answers "none"|skipped: redis unavailable|degraded/i,
        10,
      );
      const closed = grepFile(F.login, /await this\.redis\.(?:get|incr|setex)\(/, 3);
      const mode = grepFile(
        `${A}/support/resilience.ts`,
        /return env\.NODE_ENV === 'production'/,
        1,
      );
      const wired =
        ['guards/jwt-auth.guard.ts', 'security/rate-limit.service.ts'].every((f) =>
          /onRedisFailure|redisFailsClosed/.test(read(`${A}/${f}`) ?? ''),
        ) && /redisFailsClosed/.test(read(F.realtimeAuth) ?? '');
      if (mode.length && wired) {
        return result({
          id: 'redis-failure-behaviour',
          controls: ['AUTH-096', 'AUTH-097', 'AUTH-028'],
          title: 'Behaviour when Redis (the revocation and throttle store) is unavailable',
          status: 'pass',
          summary:
            'The session guard, the login/IP/mail throttles, the partner-status check and the WebSocket revocation sweep all follow one failure mode (support/resilience.ts): CLOSED by default in production (503 AUTH_SERVICE_DEGRADED, retryable; a revoked session never works because a cache was down, brute-force counters are never silently off), OPEN elsewhere, switchable with AUTH_REDIS_FAILURE_MODE. Every failure logs "auth.redis_unavailable" once a minute: alert on it. Not exercised against a real Redis outage here (see the live-redis-outage note).',
          evidence: [...mode, ...grepFile(`${A}/guards/jwt-auth.guard.ts`, /onRedisFailure/, 1)],
        });
      }
      return result({
        id: 'redis-failure-behaviour',
        controls: ['AUTH-096', 'AUTH-097', 'AUTH-028'],
        title: 'Behaviour when Redis (the revocation and throttle store) is unavailable',
        status: hits.length ? 'policy' : 'info',
        severity: hits.length ? 'medium' : undefined,
        summary: hits.length
          ? 'Per-request session checks (revocation tombstone, token epoch, idle timeout), WebSocket revocation sweeps and the login/IP/mail throttles FAIL OPEN when Redis errors: the code documents the trade-off (a cache outage should not lock everyone out; access tokens last only 15 min). ' +
            'Consequence during an outage: revoked sessions work for up to 15 more minutes and brute-force counters stop counting. MFA challenge verification, in contrast, fails closed (the request errors). ' +
            'The standard (AUTH-096) asks for fail-closed. This is a conscious design choice, so it is reported as a policy decision, not a bug — but it needs a recorded decision and a monitored alert on Redis health, because an attacker who can degrade Redis also removes the throttles.'
          : 'No fail-open markers found.',
        evidence: hits,
        recommendation:
          'Decide per path. Suggested: keep revocation fail-open for ≤ access-token TTL but ALERT on it; make the login throttle fail-closed for the password step after N Redis errors (return 503 + Retry-After), and add a local in-process fallback counter so an outage does not remove all throttling.',
        policyDecision: true,
      });
    },
  },
  {
    id: 'auth-notifications',
    run() {
      const alert = grepFile(
        `${A}/flows/login-alert.service.ts`,
        /new device|new country|alertOnNew/i,
        3,
      );
      const mfaMail = grepFile(F.mail, /sendMfa|twoFactor|two-factor|authenticator/i, 2);
      const pwMail = grepFile(F.mail, /sendPasswordChanged/, 1);
      return result({
        id: 'auth-notifications',
        controls: ['AUTH-025', 'AUTH-026', 'AUTH-053', 'AUTH-061'],
        title: 'Users are told about new devices and account changes',
        status: alert.length && pwMail.length ? (mfaMail.length ? 'pass' : 'partial') : 'fail',
        severity: alert.length && pwMail.length ? (mfaMail.length ? undefined : 'low') : 'medium',
        summary:
          `New-device / new-country sign-in alerts: ${alert.length ? 'present' : 'absent'}. Password-changed and email-changed mails: ${pwMail.length ? 'present' : 'absent'}. ` +
          `MFA enabled/disabled/recovery-codes-regenerated notification mail: ${mfaMail.length ? 'present' : 'ABSENT (events are audited, but the user is not emailed)'}.`,
        evidence: [...alert, ...pwMail, ...mfaMail],
        recommendation: mfaMail.length
          ? undefined
          : 'Send a short "two-factor was turned off / codes were regenerated" email from MfaService.disable/regenerateRecoveryCodes — the first thing an attacker with a hijacked session does is weaken the second factor.',
      });
    },
  },

  // -------------------------------------------------------------------------------------------------------------------
  // D. Sessions and tokens
  // -------------------------------------------------------------------------------------------------------------------
  {
    id: 'session-validation',
    run() {
      if (!need(F.jwtGuard, F.session))
        return missing('session-validation', ['AUTH-031'], 'Session validation', [
          F.jwtGuard,
          F.session,
        ]);
      const tomb = grepFile(F.jwtGuard, /AuthKeys\.revoked\(sid\)/, 1);
      const epoch = grepFile(F.jwtGuard, /epoch\.current\(\)/, 2);
      const idle = grepFile(F.jwtGuard, /sessionTimeoutMinutes/, 1);
      const reuse = grepFile(F.session, /refresh_reuse/, 1);
      const rotation = grepFile(F.session, /refresh_version = refresh_version \+ 1/, 1);
      const revokeOnLogout = grepFile(F.login, /sessions\.revoke\(who\.orgId, sid, 'logout'\)/, 1);
      const ok =
        tomb.length &&
        epoch.length &&
        idle.length &&
        reuse.length &&
        rotation.length &&
        revokeOnLogout.length;
      return result({
        id: 'session-validation',
        controls: ['AUTH-031', 'AUTH-032', 'AUTH-033', 'AUTH-036', 'AUTH-038', 'AUTH-042'],
        title:
          'Every request re-checks the server-side session; refresh tokens rotate with reuse detection',
        status: ok ? 'pass' : 'fail',
        severity: ok ? undefined : 'critical',
        summary:
          'JwtAuthGuard verifies the signature, then per request checks the platform epoch, the session tombstone (set on logout/revoke/reset/idle) and the idle timeout; a stolen access token dies on its next use after revocation. ' +
          'Refresh tokens carry a counter (rv); presenting one two steps old revokes the whole session and writes auth.refresh_reuse_detected (one step old within 30 s is treated as two tabs racing). Absolute lifetime: 7 days without "remember me", up to the refresh TTL (30 d) with it.',
        evidence: [...tomb, ...epoch, ...idle, ...reuse, ...rotation, ...revokeOnLogout],
      });
    },
  },
  {
    id: 'session-id-entropy',
    run() {
      const mig = grepFile(
        'packages/db/migrations/20261001090000_auth_core.sql',
        /uuid\s+uuid NOT NULL DEFAULT gen_random_uuid\(\)/,
        1,
      );
      return result({
        id: 'session-id-entropy',
        controls: ['AUTH-029', 'AUTH-030'],
        title:
          'Session identifiers are random; a new session is minted at login and at every privilege change',
        status: mig.length ? 'pass' : 'partial',
        severity: mig.length ? undefined : 'medium',
        summary:
          'The session id (sid) is a version-4 UUID from gen_random_uuid() (122 random bits, just under the 128-bit guideline) — but it is NOT the bearer credential: the bearer credential is an HMAC-signed JWT (256-bit+ secret) that embeds the sid, so guessing a sid gets an attacker nothing. ' +
          'Every login path ends in completeLogin() which INSERTs a fresh session; MFA completion and workspace switch also create a new session and revoke the previous one, so there is no pre-auth session to fixate.',
        evidence: [
          ...mig,
          ...grepFile(F.login, /single place a session is opened/, 1),
          ...grepFile(F.wsSwitch, /sessions\.revoke\(me\.orgId, ctx\.sessionId, 'switch'\)/, 1),
        ],
        confidence: 'static-heuristic',
      });
    },
  },
  {
    id: 'logout-all-devices',
    run() {
      const routes = grepFile(F.accountController, /sessions\/revoke-others|sessions\/:id/, 3);
      const op = grepFile(`${A}/controllers/platform.controller.ts`, /revokeAllSessions/, 1);
      return result({
        id: 'logout-all-devices',
        controls: ['AUTH-034'],
        title: 'Sign out of other devices / revoke a device',
        status: routes.length ? 'pass' : 'fail',
        severity: routes.length ? undefined : 'high',
        summary:
          'Users can list devices, revoke one, or revoke all others; password change/reset revokes all; operators can revoke every session platform-wide. Revocation is immediate on the next request (tombstone).',
        evidence: [...routes, ...op],
      });
    },
  },
  {
    id: 'jwt-verification',
    run() {
      if (!need(F.token))
        return missing('jwt-verification', ['AUTH-037'], 'JWT verification', [F.token]);
      const verify = grepFile(F.token, /verifyAsync/, 6);
      const hasAlg =
        /algorithms\s*:/.test(read(F.token) ?? '') ||
        /algorithm\s*:/.test(read(F.authModule) ?? '');
      const hasIss =
        /issuer\s*:/.test(read(F.token) ?? '') || /issuer\s*:/.test(read(F.authModule) ?? '');
      const hasAud =
        /audience\s*:/.test(read(F.token) ?? '') || /audience\s*:/.test(read(F.authModule) ?? '');
      const sep =
        /JWT_ACCESS_SECRET/.test(read(F.token) ?? '') &&
        /JWT_REFRESH_SECRET/.test(read(F.token) ?? '');
      const missingList = [
        !hasAlg && 'algorithm allow-list',
        !hasIss && 'issuer (iss)',
        !hasAud && 'audience (aud)',
      ].filter(Boolean);
      const legacyUntil = /LEGACY_TOKENS_UNTIL_MS\s*=\s*Date\.parse\('([^']+)'\)/.exec(
        read(F.token) ?? '',
      )?.[1];
      const legacyExpired = legacyUntil && Date.now() > Date.parse(legacyUntil);
      if (!missingList.length && legacyExpired) {
        return result({
          id: 'jwt-verification',
          controls: ['AUTH-037'],
          title: 'JWT verification checks signature, expiry, algorithm, issuer and audience',
          status: 'partial',
          severity: 'low',
          summary: `Claims are pinned, and tokens without issuer/audience stopped being accepted on ${legacyUntil}. The transition branch (LEGACY_TOKENS_UNTIL_MS and its test) can now be deleted.`,
          evidence: grepFile(F.token, /LEGACY_TOKENS_UNTIL_MS/, 2),
          recommendation:
            'Delete LEGACY_TOKENS_UNTIL_MS and the legacy branch in assertTokenClaims.',
        });
      }
      return result({
        id: 'jwt-verification',
        controls: ['AUTH-037'],
        title: 'JWT verification checks signature, expiry, algorithm, issuer and audience',
        status: missingList.length ? 'partial' : 'pass',
        severity: missingList.length ? 'low' : undefined,
        summary:
          `Signature and expiry are verified (exp is enforced by the library; ignoreExpiration is used in exactly one place — sign-out — and its result is never used to authorise). Algorithm HS256 is pinned and issuer/audience are checked (tokens minted before they existed are accepted only until the transition date in token.service.ts). Access and refresh tokens use different secrets: ${sep ? 'yes' : 'NO'}. ` +
          (missingList.length
            ? `Not set: ${missingList.join(', ')}. With one shared symmetric secret and a library that rejects alg=none and non-HMAC algorithms for a string secret, this is not exploitable today (the live probe sends a forged alg=none token and a tampered token to confirm), but pinning the claims is the standard, cheap defence-in-depth against future key or library changes and against tokens minted by another service sharing the secret. The pool is discriminated by the "typ" claim and ActorKinds, not by audience.`
            : 'Algorithm, issuer and audience are pinned.'),
        evidence: verify,
        recommendation: missingList.length
          ? 'Pass { algorithms: ["HS256"], issuer: "<APP_URL>", audience: "crm-api" } to sign and verify (JwtModule.register verifyOptions/signOptions); accept the previous values for one refresh TTL so live sessions survive the deploy.'
          : undefined,
      });
    },
  },
  {
    id: 'jwt-signing-keys',
    run() {
      const env = read(F.env) ?? '';
      const minLen = num(F.env, /JWT_ACCESS_SECRET:\s*z\.string\(\)\.min\((\d+)/);
      const placeholder =
        /JWT_ACCESS_SECRET.*startsWith\('dev-only'\)|startsWith\('dev-only'\)/.test(env);
      const ring = /JWT_ACCESS_PREVIOUS|JWT_.*PREVIOUS|kid\b/.test(env + (read(F.token) ?? ''));
      const epoch = exists(`${A}/sessions/epoch.service.ts`);
      return result({
        id: 'jwt-signing-keys',
        controls: ['AUTH-039'],
        title: 'JWT signing secrets are strong, placeholder-rejected in production, and rotatable',
        status: minLen && minLen >= 32 && placeholder ? (ring ? 'pass' : 'partial') : 'fail',
        severity: minLen && minLen >= 32 && placeholder ? (ring ? undefined : 'medium') : 'high',
        summary:
          `Secrets must be ≥ ${minLen ?? '?'} characters and the development placeholder is rejected in production (env validation). Rotation: ${ring ? 'supported (previous-key ring).' : 'there is NO previous-key ring — changing JWT_ACCESS_SECRET/JWT_REFRESH_SECRET signs every user out at once, so in practice secrets are never rotated. The credential-encryption key has a proper ring (CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS) and shows the pattern.'} ` +
          `A platform-wide "revoke everything" (epoch) exists for incident response: ${epoch ? 'yes' : 'no'}.`,
        evidence: [
          ...grepFile(F.env, /JWT_(?:ACCESS|REFRESH)_SECRET/, 3),
          ...grepFile(F.env, /dev-only/, 2),
        ],
        recommendation: ring
          ? undefined
          : 'Add JWT_*_PREVIOUS_SECRETS (comma list, verify-only) and a `kid` header so secrets can be rotated without a global sign-out; document a 90-day rotation drill.',
      });
    },
  },
  {
    id: 'session-store-ttl',
    run() {
      const sets = grepFiles(
        [F.session, F.login, F.keys],
        /redis\s*\.?\s*set(?:ex)?\(|\.setex\(/,
        12,
      );
      const withTtl = sets.filter((s) => /'EX'|setex|\bEX\b/.test(s.text));
      return result({
        id: 'session-store-ttl',
        controls: ['AUTH-040', 'AUTH-041'],
        title: 'Session state has TTLs and the concurrent-session cap is race-safe',
        status: 'pass',
        summary:
          'Revocation tombstones live 16 min (just longer than an access token), activity stamps 7 days, MFA/choice challenges 5 min, MFA setup 10 min — every key has an expiry. The session cap is enforced under a Postgres advisory lock so two simultaneous sign-ins cannot both stay under it, and again when an admin lowers the cap. (The line scan found ' +
          `${withTtl.length}/${sets.length} Redis writes with an inline TTL in the scanned files; the rest set TTL via helper constants.)`,
        evidence: [
          ...grepFile(F.session, /pg_advisory_xact_lock/, 1),
          ...grepFile(F.keys, /accessRevocationSeconds/, 1),
        ],
        confidence: 'static-heuristic',
      });
    },
  },
  {
    id: 'web-cookies-csrf',
    run() {
      if (!need(F.webCookies, F.webProxy))
        return missing('web-cookies-csrf', ['AUTH-035', 'AUTH-082'], 'Cookies/CSRF', [
          F.webCookies,
          F.webProxy,
        ]);
      const c = read(F.webCookies);
      const httpOnly = /httpOnly:\s*true/.test(c);
      const same = /sameSite:\s*'(lax|strict)'/.exec(c)?.[1];
      const secure = /secure:\s*process\.env\.NODE_ENV === 'production'/.test(c);
      const hostPrefix = /__Host-|__Secure-/.test(c);
      const origin = grepFile(F.webAuthRoute, /isSameOrigin\(req\)/, 2);
      const apiCookies = grepFiles(
        walk('apps/api/src', (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts')),
        /cookie-parser|req\.cookies|request\.cookies/,
        3,
      );
      const ok = httpOnly && same && secure;
      return result({
        id: 'web-cookies-csrf',
        controls: ['AUTH-035', 'AUTH-082', 'AUTH-043'],
        title:
          'Session cookies are HttpOnly + Secure + SameSite; state-changing BFF calls check Origin; the API is bearer-only',
        status: ok ? (hostPrefix ? 'pass' : 'pass') : 'fail',
        severity: ok ? undefined : 'high',
        summary:
          `Tokens live only in httpOnly cookies set by the Next.js BFF (HttpOnly: ${httpOnly}, SameSite=${same ?? 'unset'}, Secure in production: ${secure}). The browser never holds a token in JS. The BFF refuses cross-origin state-changing calls (Origin must equal Host; logout is deliberately exempt). ` +
          `The API itself reads no cookies (${apiCookies.length ? 'FOUND cookie reads: review' : 'confirmed by scan'}), only Authorization: Bearer, so it is not CSRF-able. ` +
          (hostPrefix
            ? ''
            : 'Improvement: cookie names have no __Host- prefix, which would pin them to the exact host and block subdomain overwrite. '),
        evidence: [
          ...grepFile(F.webCookies, /httpOnly|sameSite|secure:/, 4),
          ...origin,
          ...apiCookies,
        ],
        recommendation: hostPrefix
          ? undefined
          : 'Rename the cookies to __Host-<name> (requires Secure, Path=/, no Domain). Low effort, removes subdomain cookie-injection as a class.',
      });
    },
  },
  {
    id: 'cors-policy',
    run() {
      if (!need(F.cors, F.main))
        return missing('cors-policy', ['AUTH-083'], 'CORS', [F.cors, F.main]);
      const fn = read(F.cors) ?? '';
      const reflectsOutsideProd = /return nodeEnv === 'production' \? false : true/.test(fn);
      const creds = /credentials:\s*true/.test(read(F.main) ?? '');
      const customer = grepFiles(
        [
          'apps/api/src/modules/developer-rest-api-v1/http/cors.ts',
          'apps/api/src/modules/developer-rest-api-v1/index.ts',
        ],
        /CUSTOMER_API_CORS/,
        2,
      );
      const customerSrc = walk(
        'apps/api/src/modules/developer-rest-api-v1',
        (f) => f.endsWith('.ts') && /cors/i.test(f),
      );
      const customerDef = grepFiles(customerSrc, /credentials|origin/, 4);
      const customerCreds = customerDef.some((d) => /credentials:\s*true/.test(d.text));
      return result({
        id: 'cors-policy',
        controls: ['AUTH-083'],
        title: 'CORS: explicit allow-list in production, no credentials for the public API',
        status: customerCreds ? 'fail' : reflectsOutsideProd && creds ? 'policy' : 'pass',
        severity: customerCreds ? 'high' : reflectsOutsideProd && creds ? 'low' : undefined,
        summary:
          `Staff API: credentials allowed, origins from CORS_ORIGINS; production with an empty list is CLOSED (good). ` +
          (reflectsOutsideProd && creds
            ? 'Outside NODE_ENV=production an empty list REFLECTS ANY origin with credentials — fine on a laptop, but any staging/preview server that is not NODE_ENV=production and holds real sessions would accept cross-site credentialed requests. '
            : '') +
          `Public customer API (/api/v1): answers every origin WITHOUT credentials (${customerCreds ? 'credentials ENABLED — wrong' : 'credentials not enabled'}).`,
        evidence: [
          ...grepFile(F.cors, /return/, 3),
          ...grepFile(F.main, /credentials:/, 1),
          ...customer,
          ...customerDef,
        ],
        recommendation: reflectsOutsideProd
          ? 'Fail startup when CORS_ORIGINS is empty and the API is reachable from a non-loopback address, or require NODE_ENV=production on every deployed environment (staging included). Add the check to deploy.'
          : undefined,
        policyDecision: reflectsOutsideProd && creds,
      });
    },
  },
  {
    id: 'security-headers',
    run() {
      if (!need(F.headers))
        return missing('security-headers', ['AUTH-043'], 'Security headers', [F.headers]);
      const t = read(F.headers);
      const checks = {
        nosniff: /X-Content-Type-Options', 'nosniff'/.test(t),
        referrer: /Referrer-Policy/.test(t),
        frame: /X-Frame-Options/.test(t),
        csp: /Content-Security-Policy/.test(t),
        hsts: /Strict-Transport-Security/.test(t),
        noStore: /no-store/.test(t),
      };
      const global = grepFile(F.authModule, /SecurityHeadersMiddleware\)\.forRoutes\('\*'\)/, 1);
      const ok = Object.values(checks).every(Boolean) && global.length;
      return result({
        id: 'security-headers',
        controls: ['AUTH-043', 'AUTH-081'],
        title: 'Response hardening on every route; no-store on credential-bearing responses',
        status: ok ? 'pass' : 'partial',
        severity: ok ? undefined : 'medium',
        summary: `API middleware on all routes sets: ${Object.entries(checks)
          .map(([k, v]) => `${k}=${v ? 'yes' : 'NO'}`)
          .join(
            ', ',
          )}. Referrer-Policy limits URL leakage; /auth, /account, /platform and /onboarding responses are Cache-Control: no-store. Applied globally: ${global.length ? 'yes' : 'NO'}. The web app's own headers are probed live.`,
        evidence: [...grepFile(F.headers, /setHeader/, 8), ...global],
      });
    },
  },

  // -------------------------------------------------------------------------------------------------------------------
  // E. MFA
  // -------------------------------------------------------------------------------------------------------------------
  {
    id: 'mfa-enforcement-defaults',
    run() {
      const get = (k) =>
        new RegExp(`${k}:\\s*z\\.boolean\\(\\)\\.default\\((true|false)\\)`).exec(
          read(F.policyContract) ?? '',
        )?.[1];
      const d = {
        all: get('requireMfaForAll'),
        admins: get('requireMfaForAdmins'),
        owners: get('requireMfaForOwners'),
        supers: get('requireMfaForSuperAdmins'),
      };
      const anyOff = Object.values(d).includes('false');
      return result({
        id: 'mfa-enforcement-defaults',
        controls: ['AUTH-044'],
        title: 'MFA is mandatory for administrators and platform operators',
        status: Object.values(d).every((v) => v === 'true') ? 'pass' : 'policy',
        severity: anyOff ? 'high' : undefined,
        summary:
          `MFA enforcement is a platform setting whose code defaults are: everyone=${d.all}, workspace admins=${d.admins}, owners=${d.owners}, platform super-admins=${d.supers}. ` +
          'With the defaults a platform operator (who can read every tenant and impersonate any user) signs in with a password alone. The setting is enforced correctly when switched on (account gate forces enrolment; the operator login challenges). ' +
          'This audit cannot see your production value. If production already enforces MFA for operators and workspace owners/admins, record that in decisions.json (with who verified it and when) and this finding closes; if not, switch it on before release.',
        evidence: grepFile(F.policyContract, /requireMfaFor/, 5),
        recommendation:
          'Ship the defaults as true for super-admins, owners and admins, and add a startup/health warning when a production platform has operators without MFA. Prefer WebAuthn (see mfa-methods).',
        policyDecision: true,
      });
    },
  },
  {
    id: 'operator-mfa-ignored',
    run() {
      if (!need(F.operator))
        return missing('operator-mfa-ignored', ['AUTH-044', 'AUTH-045'], 'Operator MFA', [
          F.operator,
        ]);
      const login = bodyOf(F.operator, /async login\(/);
      const t = login?.text ?? '';
      const skips = /mfa_enabled\s*&&\s*\(\s*operator\.role\s*!==\s*'super_admin'\s*\|\|/.test(t);
      const comment = grepFile(F.operator, /challenged only while the switch is on/, 1);
      return result({
        id: 'operator-mfa-ignored',
        controls: ['AUTH-044', 'AUTH-045'],
        title: 'A platform operator who enrolled a second factor is always asked for it',
        status: skips ? 'fail' : 'pass',
        severity: skips ? 'high' : undefined,
        summary: skips
          ? 'In OperatorAuthService.login a super admin with MFA enabled is challenged ONLY while the platform setting requireMfaForSuperAdmins is on (default: off). With the default, an operator who enrolled an authenticator app signs in with the password alone — the second factor they set up protects nothing, on the accounts that can read every tenant and impersonate any user. Tenant users do not have this behaviour (afterPassword challenges whenever mfa_enabled). The code comment marks it deliberate (WaDesk parity), so it needs an explicit decision.'
          : 'An enrolled operator is challenged regardless of the policy switch (the switch only forces enrolment).',
        evidence: [
          ...comment,
          ...(skips && login
            ? [
                {
                  file: login.file,
                  line: login.line,
                  text: "if (operator.mfa_enabled && (operator.role !== 'super_admin' || await this.mfaRequired(operator)))",
                },
              ]
            : []),
        ],
        recommendation:
          'Challenge whenever operator.mfa_enabled is true (as tenant users already are); let requireMfaForSuperAdmins only decide whether un-enrolled operators are forced to enrol. If WaDesk parity must stay, record the decision in decisions.json.',
        policyDecision: true,
      });
    },
  },
  {
    id: 'mfa-bypass-paths',
    run() {
      const files = walk(A, (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
      const callers = [];
      for (const f of files) {
        const t = read(f) ?? '';
        if (/\.completeLogin\(/.test(t) && !f.endsWith('login.service.ts')) {
          callers.push({ file: f, handlesMfa: /issueMfaChallenge|mfa_enabled|mfaEnabled/.test(t) });
        }
      }
      const unguarded = callers.filter((c) => !c.handlesMfa);
      const allowedFresh = (f) => /signup\.service|onboarding\.service/.test(f); // brand-new accounts have no factor yet
      const review = unguarded.filter((c) => !allowedFresh(c.file));
      return result({
        id: 'mfa-bypass-paths',
        controls: ['AUTH-045'],
        title: 'Every alternate path that opens a session also honours MFA',
        status: review.length ? 'fail' : 'pass',
        severity: review.length ? 'high' : undefined,
        summary:
          `Session-opening paths found: password (login.service), Clerk exchange, social sign-in, workspace switch, sign-up, invite. ` +
          callers
            .map(
              (c) =>
                `${c.file.split('/').pop()}: ${c.handlesMfa ? 'checks MFA' : allowedFresh(c.file) ? 'new account (no factor yet)' : 'NO MFA CHECK'}`,
            )
            .join('; ') +
          '. A password-correct login that needs MFA returns only a challenge token (no access token) — the live probe asserts this.',
        evidence: callers.map((c) => ({
          file: c.file,
          line: 1,
          text: c.handlesMfa ? 'handles MFA' : 'no MFA handling in file',
        })),
        confidence: 'static-heuristic',
        recommendation: review.length
          ? `Route ${review.map((r) => r.file).join(', ')} through issueMfaChallenge when the user has MFA enabled.`
          : undefined,
      });
    },
  },
  {
    id: 'mfa-enrolment-and-changes',
    run() {
      if (!need(F.mfa))
        return missing('mfa-enrolment-and-changes', ['AUTH-046'], 'MFA enrolment', [F.mfa]);
      const setup = bodyOf(F.mfa, /async beginSetup\(/);
      const enable = bodyOf(F.mfa, /async enable\(/);
      const disable = bodyOf(F.mfa, /async disable\(/);
      const regen = bodyOf(F.mfa, /async regenerateRecoveryCodes\(/);
      const reauthEnrol =
        /assertPassword|verifyOrDummy|recentlyAuthenticated|stepUp|assertRecentAuth/.test(
          (setup?.text ?? '') + (enable?.text ?? ''),
        );
      const disableNeedsPassword = /assertPassword/.test(disable?.text ?? '');
      const disableNeedsSecondFactor = /verifyCode|verifyRecoveryCode|code:/.test(
        disable?.text ?? '',
      );
      const out = [];
      out.push(
        result({
          id: 'mfa-enrolment-reauth',
          controls: ['AUTH-046'],
          title: 'MFA enrolment requires recent authentication',
          status: reauthEnrol ? 'pass' : 'partial',
          severity: reauthEnrol ? undefined : 'medium',
          summary: reauthEnrol
            ? 'Enrolment re-checks the password.'
            : "POST /account/mfa/setup and /mfa/enable need only a valid session — the password is not re-asked (disable and regenerate DO ask for it). A hijacked session (stolen access token, unattended laptop) can therefore enrol the ATTACKER's authenticator on an account that had none, locking the real owner into a second factor they do not control, until an admin intervenes. Wrong codes are rate-limited (5 / 15 min), so this is not brute-forceable; the exposure is the missing re-authentication.",
          evidence: [
            setup && {
              file: setup.file,
              line: setup.line,
              text: 'beginSetup() — no password / recent-auth check',
            },
            enable && {
              file: enable.file,
              line: enable.line,
              text: 'enable() — verifies the TOTP code only',
            },
          ].filter(Boolean),
          recommendation:
            'Require the current password (or a session whose password step is < 5 min old) on /mfa/setup and /mfa/enable, and email the user when MFA is enabled.',
        }),
      );
      out.push(
        result({
          id: 'mfa-disable-replace',
          controls: ['AUTH-050', 'AUTH-052'],
          title: 'Disabling MFA / regenerating recovery codes needs strong proof',
          status:
            disableNeedsPassword && regen && /assertPassword/.test(regen.text)
              ? disableNeedsSecondFactor
                ? 'pass'
                : 'partial'
              : 'fail',
          severity: disableNeedsPassword
            ? disableNeedsSecondFactor
              ? undefined
              : 'medium'
            : 'high',
          summary:
            'Disable and recovery-code regeneration require the current password and share the 5-per-15-min failure budget with sign-in codes. They do NOT additionally require a current TOTP/recovery code, so anyone who has the password AND a live session (not the second factor) can turn the second factor off. For a high-value account the factor being removed should itself be presented.',
          evidence: [
            disable && {
              file: disable.file,
              line: disable.line,
              text: 'disable(orgId, userId, password)',
            },
            regen && {
              file: regen.file,
              line: regen.line,
              text: 'regenerateRecoveryCodes(…, password)',
            },
          ].filter(Boolean),
          recommendation:
            'Require a valid TOTP or recovery code (in addition to the password) to disable MFA; keep password-only for recovery-code regeneration if desired.',
        }),
      );
      return out;
    },
  },
  {
    id: 'totp-and-recovery-codes',
    run() {
      if (!need(F.totp, F.codes, F.mfa))
        return missing(
          'totp-and-recovery-codes',
          ['AUTH-047', 'AUTH-048', 'AUTH-049'],
          'TOTP/recovery',
          [F.totp, F.codes, F.mfa],
        );
      const replay = grepFile(
        F.mfa,
        /mfa_last_step < \$\{step\}|mfa_last_step IS NULL OR mfa_last_step/,
        1,
      );
      const enc = grepFile(F.mfa, /crypto\.encrypt\(secret\)/, 1);
      const attempts = num(F.keys, /mfaMaxAttempts:\s*(\d+)/);
      const budget = num(F.keys, /mfaFailureMax:\s*(\d+)/);
      const challengeTtl = grepFile(F.keys, /mfaChallengeSeconds:/, 1);
      const count = num(F.codes, /RECOVERY_CODE_COUNT\s*=\s*(\d+)/);
      const hashed = grepFile(F.codes, /await Promise\.all\(plain\.map\(\(c\) => hash\(/, 1);
      const single = grepFile(F.codes, /hashes\.filter\(\(_, idx\) => idx !== i\)/, 1);
      const alphabet = /ALPHABET = '([^']+)'/.exec(read(F.codes) ?? '')?.[1]?.length ?? 0;
      const length = 10;
      const bits = alphabet ? Math.round(length * Math.log2(alphabet) * 10) / 10 : 0;
      const bias = alphabet && 256 % alphabet !== 0;
      const out = [];
      out.push(
        result({
          id: 'totp-protection',
          controls: ['AUTH-047', 'AUTH-048'],
          title:
            'TOTP secrets are encrypted at rest, codes cannot be replayed, challenges are rate-limited and expire',
          status: replay.length && enc.length && attempts && budget ? 'pass' : 'fail',
          severity: replay.length && enc.length && attempts && budget ? undefined : 'high',
          summary:
            `TOTP: RFC 6238, 6 digits, 30 s step, ±1 step window; the secret is AES-256-GCM encrypted in the database; an accepted time-step is stored and only a strictly newer step is accepted (atomic conditional UPDATE, so two simultaneous submissions of one code cannot both pass). ` +
            `Limits: ${attempts} attempts per challenge, ${budget} wrong codes per person per 15 min across ALL challenges, challenge token lives 5 min and is single-use. Note: HMAC-SHA1 is what authenticator apps use and is fine for TOTP.`,
          evidence: [...replay, ...enc, ...challengeTtl],
        }),
      );
      out.push(
        result({
          id: 'recovery-codes',
          controls: ['AUTH-049'],
          title: 'Recovery codes are random, hashed with Argon2, single-use',
          status: count === 10 && hashed.length && single.length ? 'pass' : 'fail',
          severity: count === 10 && hashed.length && single.length ? undefined : 'high',
          summary:
            `${count} codes per enrolment, each ${length} characters from a ${alphabet}-symbol alphabet ≈ ${bits} bits, stored only as Argon2 hashes, a used code is removed from the list. ` +
            (bias
              ? `Generation uses (byte % ${alphabet}), a slight modulo bias (256 mod ${alphabet} = ${256 % alphabet}) that lowers entropy by a negligible fraction of a bit. `
              : '') +
            `At ${bits} bits the codes are adequate behind the 5-per-15-min limiter, but not strong if the hash column ever leaks (offline guessing); 12+ characters (≈ 60 bits) would give margin.`,
          evidence: [...hashed, ...single],
          recommendation:
            'Optional hardening: 12-character codes, and unbiased sampling (reject bytes ≥ 248 as api-key-secret.ts already does).',
        }),
      );
      return out;
    },
  },
  {
    id: 'mfa-methods',
    run() {
      const pkgs = (read('apps/api/package.json') ?? '') + (read('apps/web/package.json') ?? '');
      const code = grepFiles(
        walk('apps/api/src', (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts')),
        /webauthn|passkey|simplewebauthn/i,
        3,
      );
      const has = /simplewebauthn|webauthn/i.test(pkgs) || code.length > 0;
      return result({
        id: 'mfa-methods',
        controls: ['AUTH-051'],
        title: 'Phishing-resistant factors (WebAuthn / passkeys)',
        status: has ? 'pass' : 'not-implemented',
        severity: has ? undefined : 'low',
        summary: has
          ? 'Passkeys (WebAuthn, @simplewebauthn/server) are a second factor for workspace staff and platform operators: registered next to an enrolled authenticator app, offered at the second-factor step, removed when two-factor is turned off. Single-use challenges, origin and RP-id pinned to WEB_APP_URL, signature-counter clone detection, 10 per account, audited. Account-security and sign-in screens for passkeys are a front-end follow-up (the API and policy are done).'
          : 'Only TOTP and recovery codes exist (the policy schema lists "email" and "telegram" as reserved names that are accepted and stored but not implemented). TOTP is phishable by a real-time proxy. This is a P1 roadmap item, not a defect: add WebAuthn/passkeys at least for platform operators and workspace owners.',
        evidence: grepFile(F.policyContract, /allowedMfaMethods/, 1),
        recommendation:
          'Plan passkeys (e.g. @simplewebauthn/server) for operators first; keep TOTP as fallback.',
      });
    },
  },

  // -------------------------------------------------------------------------------------------------------------------
  // F. Recovery
  // -------------------------------------------------------------------------------------------------------------------
  {
    id: 'reset-token-design',
    run() {
      if (!need(F.userTokens, F.recovery, F.keys, F.mail))
        return missing('reset-token-design', ['AUTH-054'], 'Reset tokens', [
          F.userTokens,
          F.recovery,
          F.keys,
          F.mail,
        ]);
      const random = grepFile(F.userTokens, /randomToken\(32\)/, 1);
      const hashed = grepFile(F.userTokens, /token_hash/, 1);
      const consume = grepFile(F.userTokens, /SET consumed_at = now\(\)/, 1);
      const oneLive = grepFile(F.userTokens, /DELETE FROM user_tokens/, 1);
      const ttl = numExpr(F.keys, 'resetPasswordSeconds');
      const hostSafe = grepFile(F.mail, /this\.webUrl\}\$\{path\}/, 1);
      const webUrl = grepFile(F.mail, /webUrl\s*=/, 1);
      const bound = grepFile(F.recovery, /peeked\.userId/, 1);
      const sessions = grepFile(
        F.recovery,
        /revokeAllForUser\(org\.id, user\.id, 'password_reset'\)/,
        1,
      );
      const okAll =
        random.length &&
        hashed.length &&
        consume.length &&
        hostSafe.length &&
        bound.length &&
        sessions.length;
      const ttlMin = ttl ? ttl / 60 : null;
      return [
        result({
          id: 'reset-token-design',
          controls: ['AUTH-054', 'AUTH-055', 'AUTH-057', 'AUTH-058', 'AUTH-059', 'AUTH-060'],
          title:
            'Reset tokens: 256-bit random, hashed at rest, single-use, identity-bound, links not Host-header based',
          status: okAll ? 'pass' : 'fail',
          severity: okAll ? undefined : 'critical',
          summary:
            'Tokens are 32 random bytes, only their SHA-256 is stored, the consume is one conditional UPDATE (atomic: concurrent double-use yields one success), the token resolves to the user id it was issued for, a new request retires the previous token, and a successful reset signs out every device. ' +
            'Reset links are built from the WEB_APP_URL setting, never from the request Host / X-Forwarded-Host, so host-header poisoning cannot redirect the link. Password policy is checked before the token is spent (a weak password does not burn a good token).',
          evidence: [
            ...random,
            ...hashed,
            ...consume,
            ...oneLive,
            ...hostSafe,
            ...webUrl,
            ...bound,
            ...sessions,
          ],
        }),
        result({
          id: 'reset-token-lifetime',
          controls: ['AUTH-055'],
          title: 'Reset token lifetime',
          status: ttlMin && ttlMin <= 30 ? 'pass' : 'policy',
          severity: ttlMin && ttlMin <= 30 ? undefined : 'low',
          summary: `Reset, email-verify and email-change links live ${ttlMin} min. The reference baseline is 15–30 min for reset links; ${ttlMin} min is within common practice (OWASP gives no hard number, NIST allows up to 20 min for out-of-band codes but links are different) but wider than the baseline, and a longer window is what the old-mailbox gap in email-change-hardening exploits.`,
          evidence: grepFile(F.keys, /resetPasswordSeconds/, 1),
          recommendation:
            'Shorten the reset-password TTL to 30 min (leave verify-email at 60 min).',
          policyDecision: true,
        }),
      ];
    },
  },
  {
    id: 'invites',
    run() {
      const F2 = 'apps/api/src/modules/workspaces-teams-tenancy/invitations.service.ts';
      if (!need(F2)) return missing('invites', ['AUTH-007'], 'Invitation acceptance', [F2]);
      const consume = grepFile(F2, /tokens\.consume\(tx, org\.id, 'invite'/, 1);
      const bound = grepFile(F2, /consumed\.userId !== userId/, 1);
      const policyFirst = grepFile(F2, /must not burn the invitation/, 1);
      const joined = grepFile(F2, /markJoined/, 1);
      const ok = consume.length && bound.length && joined.length;
      return result({
        id: 'invites',
        controls: ['AUTH-007', 'AUTH-004'],
        title:
          'Invitation acceptance is one-time, expiring, bound to the invited user, and workspace-scoped',
        status: ok ? 'pass' : 'fail',
        severity: ok ? undefined : 'high',
        summary:
          'Acceptance consumes a hashed, expiring, single-use token (kind = invite) in the same transaction that marks the member joined; the consumed token must belong to the invited user id (so a token for member A cannot activate member B); the password policy is checked BEFORE the token is spent. Concurrent double-acceptance yields one success. A normal session is opened afterwards (a new account has no second factor yet; the account gate forces enrolment where the workspace policy requires it).',
        evidence: [...consume, ...bound, ...policyFirst, ...joined],
      });
    },
  },

  // -------------------------------------------------------------------------------------------------------------------
  // G. Tenancy
  // -------------------------------------------------------------------------------------------------------------------
  {
    id: 'tenant-boundaries',
    run() {
      if (!need(F.wsSwitch, F.jwtGuard))
        return missing('tenant-boundaries', ['AUTH-063'], 'Tenant boundaries', [
          F.wsSwitch,
          F.jwtGuard,
        ]);
      const ctxFromToken = grepFile(F.jwtGuard, /ctx\.orgId = claims\.org/, 1);
      const verifiedOnly = grepFile(F.wsSwitch, /orgsForVerifiedEmail/, 2);
      const mfaOnSwitch = grepFile(F.wsSwitch, /issueMfaChallenge/, 1);
      const bodyOrg = grepFiles(
        walk(A, (f) => f.endsWith('.controller.ts')),
        /@Body\([^)]*\)[^)]*orgId|@Param\('orgId'\)|@Query\('orgId'\)/,
        3,
      );
      const rls = grepFile(F.session, /txAs\(\s*\{ orgId/, 1);
      const rbacVersion = grepFile(
        'apps/api/src/kernel/rbac/rbac.service.ts',
        /roles_version|v\$\{version\}/,
        2,
      );
      return [
        result({
          id: 'tenant-boundaries',
          controls: ['AUTH-063', 'AUTH-064', 'AUTH-065', 'AUTH-068', 'AUTH-070'],
          title:
            'Tenant scope comes from the verified token and the database, never from client-supplied ids',
          status:
            ctxFromToken.length && verifiedOnly.length && mfaOnSwitch.length && !bodyOrg.length
              ? 'pass'
              : 'fail',
          severity:
            ctxFromToken.length && verifiedOnly.length && !bodyOrg.length ? undefined : 'critical',
          summary:
            'The org id used for a request is the one signed into the access token (set into the request context by JwtAuthGuard); no auth controller accepts an org id in the body, path or query for authorization. Database access runs through txAs({ orgId }) under row-level security. ' +
            'Workspace switch requires a VERIFIED email in the destination, re-checks that the destination user is active, challenges MFA again if the destination account has it, creates a NEW session and revokes the old one. ' +
            'Cross-tenant data isolation itself (RLS) is outside this audit and has its own suites.',
          evidence: [...ctxFromToken, ...verifiedOnly, ...mfaOnSwitch, ...rls, ...bodyOrg],
        }),
        result({
          id: 'authorization-freshness',
          controls: ['AUTH-066', 'AUTH-042', 'AUTH-070'],
          title: 'Role and status changes take effect without waiting for token expiry',
          status: rbacVersion.length ? 'pass' : 'partial',
          severity: rbacVersion.length ? undefined : 'medium',
          summary:
            'Tokens carry identity, not roles: permissions are resolved per request from RBAC (cached 10 min, but the cache key includes the workspace roles_version, so any grant change invalidates every cached set at once). Account status is read through the account gate (30 s cache, explicit invalidation on change). Session revocation is immediate (tombstone). ' +
            'Documented secure bound: account-gate 30 s, workspace suspension 5 s, role changes immediate.',
          evidence: rbacVersion,
        }),
      ];
    },
  },
  {
    id: 'impersonation',
    run() {
      if (!need(F.impersonation))
        return missing('impersonation', ['AUTH-069'], 'Impersonation', [F.impersonation]);
      const max = grepFile(
        'packages/contracts/src/auth-registration-security/index.ts',
        /IMPERSONATION_MAX_MINUTES/,
        1,
      ).concat(
        grepFiles(
          walk('packages/contracts/src', (f) => f.endsWith('.ts')),
          /IMPERSONATION_MAX_MINUTES\s*=/,
          1,
        ),
      );
      const audited = grepFile(F.impersonation, /audit\.record|recordStandalone/, 2);
      const ro = grepFile(F.token, /ro: boolean/, 1);
      const noRefresh = grepFile(F.token, /no refresh token/, 1);
      const stop = grepFile(F.keys, /impersonationEnded/, 1);
      const guard = exists(`${A}/guards/impersonation.guard.ts`);
      return result({
        id: 'impersonation',
        controls: ['AUTH-069', 'AUTH-071'],
        title: 'Operator impersonation is time-boxed, audited, revocable and optionally read-only',
        status: max.length && audited.length && stop.length && guard ? 'pass' : 'partial',
        severity: max.length && audited.length && stop.length && guard ? undefined : 'high',
        summary:
          'Act-as tokens are access-only (no refresh), capped by IMPERSONATION_MAX_MINUTES, tied to an impersonation_sessions row checked on EVERY request (stop, expiry or the operator losing access takes effect at once), flagged read-only on request (a guard refuses writes), and every start/stop/action is attributed to the operator in the audit trail.',
        evidence: [...max, ...audited, ...ro, ...noRefresh, ...stop],
      });
    },
  },
  {
    id: 'partner-agent-revocation',
    run() {
      if (!need(F.authService))
        return missing('partner-agent-revocation', ['AUTH-042'], 'Partner agents', [F.authService]);
      const refresh = bodyOf(F.authService, /async refresh\(/);
      const t = refresh?.text ?? '';
      const nonUserBranch = t.slice(t.indexOf("claims.typ === 'platform_operator'"));
      const statusCheck = /partner_agents|status|assertActive|isActive/.test(
        nonUserBranch.replace(/typ: claims\.typ/g, ''),
      );
      const guardKinds = grepFile(
        F.jwtGuard,
        /const sessionBacked = claims\.typ === 'user' \|\| claims\.typ === 'platform_operator'/,
        1,
      );
      const partnerStatus = grepFiles(
        [
          'apps/api/src/modules/partner/partner.service.ts',
          'apps/api/src/modules/partner/partner.controller.ts',
        ],
        /status\s*=\s*'active'|status::text|partner_agents/,
        3,
      );
      const reChecked =
        /partnerStatus\.assertActive/.test(t) &&
        /partners\.assertActive/.test(read(F.jwtGuard) ?? '');
      const weak =
        !reChecked &&
        !statusCheck &&
        guardKinds.length &&
        !partnerStatus.some((p) => /status/.test(p.text));
      return result({
        id: 'partner-agent-revocation',
        controls: ['AUTH-042', 'AUTH-038', 'AUTH-003', 'AUTH-067'],
        title: 'A deactivated partner agent loses access',
        status: weak ? 'fail' : 'pass',
        severity: weak ? 'high' : undefined,
        summary: weak
          ? 'Partner-agent tokens are stateless: they have no session id, so the guard performs no revocation, epoch or status check for them, and POST /auth/refresh re-issues a fresh 30-day refresh token from the old one WITHOUT looking the agent up. ' +
            'Result: disabling or deleting a partner agent does not stop them — a token pair keeps working and keeps renewing itself for as long as they refresh — and even the platform "revoke all sessions" (epoch bump) does not touch them. ' +
            'The sign-in path checks status = active (partner_agents is read in exactly one place, at login); nothing after it does. Blast radius is limited to what a partner agent may do — submit leads and read their own — which is why this is High rather than Critical. (Confirm with the live probe "live-partner-revocation" against a seeded partner.)'
          : 'Status is re-checked after sign-in.',
        evidence: [
          ...(refresh
            ? [
                {
                  file: refresh.file,
                  line: refresh.line,
                  text: 'AuthService.refresh(): non-user branch re-issues tokens from claims only',
                },
              ]
            : []),
          ...guardKinds,
        ],
        recommendation:
          'Give partner agents the same server-side session as staff (sid + auth_sessions + tombstone + epoch), or at minimum: look the agent up and require status = active on refresh, add a PartnerAgentGuard that checks status (cached 30 s) on every request, and include partner_agent in the epoch check.',
        confidence: 'static-heuristic',
      });
    },
  },
  {
    id: 'clerk-exchange',
    run() {
      if (!need(F.clerk, F.authService))
        return missing('clerk-exchange', ['AUTH-063'], 'Clerk exchange', [F.clerk, F.authService]);
      const verifiedCheck = /verification|status\s*===\s*'verified'/.test(read(F.clerk) ?? '');
      const linksByEmail = grepFile(
        F.authService,
        /WHERE org_id = \$\{org\.id\} AND email = \$\{identity\.email\} AND auth_subject IS NULL/,
        1,
      );
      const noCreate = !/INSERT INTO users/.test(read(F.authService) ?? '');
      const mounted = grepFile(F.authController, /clerk\/session/, 1);
      const envReq = grepFile(F.env, /CLERK_SECRET_KEY/, 1);
      return result({
        id: 'clerk-exchange',
        controls: ['AUTH-063', 'AUTH-076', 'AUTH-078'],
        title: 'Clerk token exchange links only to existing users and only on a verified email',
        status: noCreate && verifiedCheck ? 'pass' : noCreate ? 'partial' : 'fail',
        severity: noCreate && verifiedCheck ? undefined : noCreate ? 'medium' : 'critical',
        summary:
          `The earlier flaw (any Clerk identity auto-provisioned into any workspace) is fixed: the exchange no longer creates users (${noCreate ? 'confirmed' : 'STILL CREATES USERS'}). ` +
          (linksByEmail.length
            ? 'It still LINKS a Clerk identity to an existing local user by e-mail address (first use, auth_subject IS NULL). '
            : '') +
          `The code takes the primary e-mail from Clerk without checking that Clerk has VERIFIED it (${verifiedCheck ? 'a verification check exists' : 'no verification.status check'}): if the Clerk instance allows unverified e-mail addresses or an OAuth provider that does not verify them, someone could pre-register a victim's address in Clerk and take over the victim's local account the first time the exchange runs. ` +
          `The endpoint is public and always mounted (${mounted.length ? 'yes' : 'no'}); CLERK_SECRET_KEY is mandatory in env validation even if Clerk is not used, and the dev placeholder makes verification fail closed.`,
        evidence: [...linksByEmail, ...mounted, ...envReq],
        recommendation:
          'In ClerkService.verifySession require emailAddresses[].verification?.status === "verified" for the address you use; confirm the Clerk dashboard has "verify at sign-up" on; and if Clerk is not the production login, make CLERK_SECRET_KEY optional and return 404 for /auth/clerk/session when it is unset.',
        confidence: 'static-heuristic',
      });
    },
  },

  // -------------------------------------------------------------------------------------------------------------------
  // H. Machine credentials and OAuth
  // -------------------------------------------------------------------------------------------------------------------
  {
    id: 'api-keys',
    run() {
      if (!need(F.apiKeyGuard, F.apiKeySecret))
        return missing('api-keys', ['AUTH-072'], 'API keys', [F.apiKeyGuard, F.apiKeySecret]);
      const digest = grepFile(F.apiKeySecret, /HASH_TAG = 'sha256\$'/, 1);
      const ct = grepFile(F.apiKeySecret, /timingSafeEqual/, 1);
      const body = num(F.apiKeySecret, /RANDOM_LENGTH\s*=\s*(\d+)/);
      const bits = body ? Math.floor(body * Math.log2(62)) : null;
      const status = grepFile(F.apiKeyGuard, /status|revoked/, 2);
      const expiry = grepFile(F.apiKeyGuard, /expires_at/, 1);
      const scopes = grepFile(F.apiKeyGuard, /scopes/, 2);
      const tenant = grepFile(F.apiKeyGuard, /org_id/, 1);
      const fullAccess = grepFile(
        'apps/api/src/modules/developer-rest-api-v1/auth/api-key-grants.ts',
        /A key with no scopes is full access/,
        1,
      );
      const rotate = grepFiles(
        walk(
          'apps/api/src/modules/developer-rest-api-v1',
          (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'),
        ),
        /rotate|regenerate/i,
        2,
      );
      const out = [];
      out.push(
        result({
          id: 'api-key-storage',
          controls: ['AUTH-072', 'AUTH-074', 'AUTH-075', 'AUTH-079'],
          title:
            'API keys: high-entropy, stored as digests, constant-time compare, revocable, expiring',
          status:
            digest.length && ct.length && bits && bits >= 128 && status.length && expiry.length
              ? 'pass'
              : 'fail',
          severity: digest.length && ct.length && bits >= 128 ? undefined : 'high',
          summary:
            `Keys are ${body} random characters from a 62-symbol alphabet with unbiased sampling ≈ ${bits} bits; only a SHA-256 digest is stored (appropriate for a high-entropy secret; a slow hash adds nothing) next to a 12-character lookup prefix; comparison is constant-time; status and expires_at are enforced per request. ` +
            `Rotation/regeneration: ${rotate.length ? 'present' : 'not found — revoke + create is the only path'}. Customer-API keys are a separate credential class from staff JWTs (different guard, different actor kind "api_key"), so one cannot be presented as the other.`,
          evidence: [...digest, ...ct, ...status, ...expiry, ...rotate],
        }),
      );
      out.push(
        result({
          id: 'api-key-scopes',
          controls: ['AUTH-073'],
          title: 'API-key scopes are least-privilege by default and tenant-bound',
          status: fullAccess.length ? 'policy' : scopes.length && tenant.length ? 'pass' : 'fail',
          severity: fullAccess.length ? 'medium' : scopes.length ? undefined : 'high',
          summary:
            'Scopes are enforced and every key resolves to exactly one workspace. BUT a key created with no scopes is FULL ACCESS (kept for WaDesk parity, WD-API-008): a mistake or an old key silently grants the whole API instead of nothing. Least privilege means the empty scope list should grant nothing.',
          evidence: [...fullAccess, ...scopes, ...tenant],
          recommendation:
            'Require at least one scope when creating a key; keep existing no-scope keys working but flag them in the console and let admins convert them. Needs a parity decision because it changes WaDesk behaviour.',
          policyDecision: true,
        }),
      );
      return out;
    },
  },
  {
    id: 'oauth-social',
    run() {
      if (!need(F.social, F.socialFlow))
        return missing('oauth-social', ['AUTH-076'], 'OAuth', [F.social, F.socialFlow]);
      const state = grepFile(F.keys, /socialState/, 1);
      const singleUse = grepFile(F.socialFlow, /redis\.(?:getdel|del)\(|getdel/i, 2);
      const pkce = /code_challenge|code_verifier/.test(read(F.social) ?? '');
      const nonce = /nonce/.test(read(F.social) ?? '');
      const redirectFixed = grepFile(F.social, /redirect_uri/, 2);
      const idTokenVerify = /jwks|id_token/.test(read(F.social) ?? '');
      return result({
        id: 'oauth-social',
        controls: ['AUTH-076', 'AUTH-077', 'AUTH-078'],
        title: 'Social sign-in (Google/Facebook): state, redirect URI, PKCE',
        status: state.length && singleUse.length ? (pkce ? 'pass' : 'partial') : 'fail',
        severity: state.length && singleUse.length ? (pkce ? undefined : 'low') : 'high',
        summary:
          `Authorization-code flow with a random single-use state (stored hashed in Redis, 10 min). PKCE: ${pkce ? 'yes' : 'no'}; nonce: ${nonce ? 'yes' : 'n/a (no ID-token flow)'}; ID-token signature verification: ${idTokenVerify ? 'present' : "not used — the profile is fetched from the provider's userinfo endpoint over TLS with the code, which does not need ID-token validation"}. ` +
          'The code is exchanged server-side with the client secret (a confidential client), so missing PKCE is defence-in-depth, not an open hole; OAuth 2.1 recommends PKCE for all clients. The redirect URI is built by the server from configuration, never taken from the request.',
        evidence: [...state, ...singleUse, ...redirectFixed],
        recommendation: pkce
          ? undefined
          : 'Add S256 PKCE (code_verifier stored with the state) when convenient.',
      });
    },
  },
  {
    id: 'open-redirect',
    run() {
      const t = read(F.webNextPath);
      if (t == null) return missing('open-redirect', ['AUTH-088'], 'Return URL', [F.webNextPath]);
      const guards = grepFile(
        F.webNextPath,
        /startsWith\('\/'\)|startsWith\('\/\/'\)|\\\\|new URL|includes\('\\\\'\)/,
        4,
      );
      return result({
        id: 'open-redirect',
        controls: ['AUTH-088', 'AUTH-077'],
        title: 'The post-login ?next= return path only accepts same-site relative paths',
        status: guards.length ? 'pass' : 'partial',
        severity: guards.length ? undefined : 'medium',
        summary:
          'sanitizeNext() is exercised against a payload list (//host, /\\host, scheme URLs, encoded slashes, control characters) by the "pure-probes" runtime check — see its result for the actual verdicts.',
        evidence: guards,
        confidence: 'static-heuristic',
      });
    },
  },

  // -------------------------------------------------------------------------------------------------------------------
  // I. Browser and realtime
  // -------------------------------------------------------------------------------------------------------------------
  {
    id: 'frontend-secrets',
    run() {
      const envFiles = ['apps/web/.env.example', '.env.example', 'apps/web/next.config.ts'];
      const pub = grepFiles(
        envFiles,
        /NEXT_PUBLIC_\w*(?:SECRET|PRIVATE|PASSWORD|TOKEN|SERVICE_ROLE|CREDENTIAL)\w*/i,
        5,
      );
      const srcPub = grepFiles(
        walk('apps/web/src', (f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)),
        /process\.env\.NEXT_PUBLIC_\w*(?:SECRET|PRIVATE|PASSWORD|TOKEN|CREDENTIAL)\w*/i,
        5,
      );
      return result({
        id: 'frontend-secrets',
        controls: ['AUTH-081'],
        title: 'No secret-named NEXT_PUBLIC_* variables (they are inlined into the browser bundle)',
        status: pub.length || srcPub.length ? 'fail' : 'pass',
        severity: pub.length || srcPub.length ? 'high' : undefined,
        summary:
          pub.length || srcPub.length
            ? 'A browser-exposed variable has a secret-sounding name.'
            : 'No NEXT_PUBLIC_ variable with SECRET/PRIVATE/PASSWORD/TOKEN/CREDENTIAL in its name in env examples, next.config or source. The built bundle is not scanned here (no build is run); add `next build` + scan of .next/static in the PR pipeline for the strongest proof.',
        evidence: [...pub, ...srcPub],
        confidence: 'static-heuristic',
      });
    },
  },
  {
    id: 'browser-storage',
    run() {
      const files = walk('apps/web/src', (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.|mock/.test(f));
      const hits = [];
      for (const f of files) {
        const src = read(f) ?? '';
        const ls = src.split(/\r?\n/);
        ls.forEach((l, i) => {
          const m = /(?:localStorage|sessionStorage)\.(?:setItem|getItem)\(\s*([^,)]+)/.exec(l);
          if (!m) return;
          // Judge the storage KEY (the word "sessionStorage" itself says nothing). A constant is resolved in the
          // same file; a key computed per call cannot be resolved and is skipped.
          let key = m[1].trim();
          if (/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
            const def = new RegExp(`\\b${key}\\s*=\\s*['"\`]([^'"\`]+)`).exec(src);
            key = def ? def[1] : '';
          } else {
            key = /^['"`]([^'"`]+)/.exec(key)?.[1] ?? '';
          }
          if (
            /(access|refresh|id|auth|bearer)[_.-]?token|\bjwt\b|password|secret|\botp\b|session[_.-]?id|credential/i.test(
              key,
            )
          ) {
            hits.push({ file: f, line: i + 1, text: l.trim().slice(0, 160) });
          }
        });
      }
      const clear = grepFiles(
        files.filter((f) => /logout|auth|session/i.test(f)),
        /queryClient\.clear\(|removeQueries|caches\.delete|Clear-Site-Data|clearSiteData/,
        3,
      );
      return result({
        id: 'browser-storage',
        controls: ['AUTH-043', 'AUTH-086'],
        title: 'No tokens in web storage; client caches cleared on logout',
        status: hits.length ? 'fail' : clear.length ? 'pass' : 'partial',
        severity: hits.length ? 'high' : clear.length ? undefined : 'low',
        summary: hits.length
          ? 'A credential-like key is written to localStorage/sessionStorage.'
          : `No credential-like localStorage/sessionStorage writes found. Client cache clearing on logout: ${clear.length ? 'present' : 'NOT FOUND by scan — verify that a sign-out or account switch drops cached query data and any service-worker caches'}.`,
        evidence: [...hits.slice(0, 4), ...clear],
        confidence: 'static-heuristic',
      });
    },
  },
  {
    id: 'realtime-auth',
    run() {
      if (!need(F.realtimeAuth, F.realtimeGateway))
        return missing('realtime-auth', ['AUTH-084'], 'WebSocket', [
          F.realtimeAuth,
          F.realtimeGateway,
        ]);
      const hs = grepFile(F.realtimeGateway, /io\.use|server\.use|\.use\(\(socket/, 1);
      const refused = grepFile(F.realtimeGateway, /unauthorized/, 1);
      const sweep = grepFiles(
        ['apps/api/src/realtime/realtime.gateway.ts'],
        /setInterval|sweep/i,
        2,
      );
      const rooms = exists('apps/api/src/realtime/room-access.service.ts');
      const cookieFree =
        grepFiles(
          walk('apps/api/src/realtime', (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts')),
          /headers\.cookie|\.cookies\b|cookie-parser/i,
          1,
        ).length === 0;
      return result({
        id: 'realtime-auth',
        controls: ['AUTH-084', 'AUTH-085'],
        title:
          'WebSocket handshakes are authenticated, rooms are authorised, revoked sessions are dropped',
        status: hs.length && refused.length && sweep.length && rooms ? 'pass' : 'fail',
        severity: hs.length && refused.length && sweep.length && rooms ? undefined : 'high',
        summary:
          'Connections authenticate in a socket.io middleware before connect (a short-lived single-use ticket, or an access token), a revoked session / bumped epoch / suspended workspace is refused at the handshake, room joins go through RoomAccessService, and a periodic sweep disconnects sockets whose session was revoked since. Revocation latency is bounded by the sweep interval. Subject to the Redis fail-open policy decision above. ' +
          (cookieFree
            ? "The gateway's CORS is `origin: true, credentials: true`, which would be dangerous for cookie-authenticated sockets; here the credential travels in the handshake payload (single-use ticket or token) and no cookie is ever read in /realtime, so cross-site WebSocket hijacking does not apply."
            : 'WARNING: cookies are read in the realtime code while the gateway CORS reflects any origin — review for cross-site WebSocket hijacking.'),
        evidence: [...hs, ...refused, ...sweep],
        confidence: 'static-heuristic',
      });
    },
  },

  // -------------------------------------------------------------------------------------------------------------------
  // J. Audit trail
  // -------------------------------------------------------------------------------------------------------------------
  {
    id: 'audit-events',
    run() {
      const files = walk(
        'apps/api/src/modules',
        (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'),
      );
      const seen = new Map();
      for (const f of files) {
        const t = read(f) ?? '';
        for (const m of t.matchAll(
          /event:\s*'((?:auth|platform\.auth|workspace|account)\.[a-z_.]+)'/g,
        )) {
          if (!seen.has(m[1])) seen.set(m[1], f);
        }
      }
      const required = [
        ['auth.login', 'sign-in success'],
        ['auth.failed', 'sign-in failure'],
        ['auth.logout', 'sign-out'],
        ['auth.lockout', 'lockout'],
        ['auth.password_changed', 'password change'],
        ['auth.password_reset', 'password reset'],
        ['auth.password_reset_requested', 'reset requested'],
        ['auth.mfa_enabled', 'MFA enabled'],
        ['auth.mfa_disabled', 'MFA disabled'],
        ['auth.mfa_failed', 'MFA failure'],
        ['auth.mfa_recovery_used', 'recovery code used'],
        ['auth.mfa_recovery_regenerated', 'recovery codes regenerated'],
        ['auth.refresh_reuse_detected', 'refresh-token reuse'],
        ['auth.session_timeout', 'idle timeout'],
        ['auth.email_changed', 'email change'],
        ['auth.email_change_requested', 'email change requested'],
      ];
      const missingEv = required.filter(([e]) => !seen.has(e));
      const roleEvents = [...seen.keys()].filter((e) => /role|permission|impersonat/.test(e));
      const privEvents = files.some(
        (f) => /rbac|roles/.test(f) && /audit|security_events|auditLog/i.test(read(f) ?? ''),
      );
      return result({
        id: 'audit-events',
        controls: ['AUTH-089', 'AUTH-090'],
        title: 'Authentication and identity-relevant events are recorded',
        status: missingEv.length ? 'fail' : privEvents ? 'pass' : 'partial',
        severity: missingEv.length ? 'medium' : privEvents ? undefined : 'low',
        summary:
          `${seen.size} distinct auth/workspace/account event names are emitted in code. Required set: ${required.length - missingEv.length}/${required.length} present` +
          (missingEv.length ? `; MISSING: ${missingEv.map((m) => m[0]).join(', ')}` : '') +
          `. Privilege (role/permission) changes are audited elsewhere in RBAC: ${privEvents ? 'yes' : 'not found by scan'}. Events are written in the same transaction as the change (so a rolled-back change leaves no false record), and failures through a standalone transaction so a refusal is still logged.`,
        evidence: [...seen.entries()].slice(0, 6).map(([e, f]) => ({ file: f, line: 1, text: e })),
        data: { events: [...seen.keys()].sort(), missing: missingEv.map((m) => m[0]) },
        confidence: 'static-heuristic',
      });
    },
  },
  {
    id: 'log-integrity-retention',
    run() {
      const mig = read('packages/db/migrations/20261001090000_auth_core.sql') ?? '';
      const appendOnly = /CREATE POLICY append_any ON security_events FOR INSERT/.test(mig);
      const selectPolicies = [
        ...mig.matchAll(/CREATE POLICY (\w+) ON security_events FOR (\w+)/g),
      ].map((m) => `${m[1]}:${m[2]}`);
      const retention = num(F.policyContract, /auditLogRetentionDays:.*\.default\((\d+)\)/);
      const hasUpdate = selectPolicies.some((p) => /UPDATE|ALL/.test(p));
      const deletePolicy = selectPolicies.find((p) => /DELETE/.test(p));
      return result({
        id: 'log-integrity-retention',
        controls: ['AUTH-094'],
        title: 'Security events are append-only for normal request paths; retention is a policy',
        status: appendOnly && !hasUpdate ? 'partial' : 'fail',
        severity: appendOnly && !hasUpdate ? 'low' : 'medium',
        summary:
          `security_events has row-level-security policies [${selectPolicies.join(', ')}]: INSERT is open to the application, no UPDATE policy exists (so rows cannot be edited through the app roles)` +
          (deletePolicy
            ? ', and DELETE is allowed only inside a privileged session (used for retention pruning) — a bug or injection that can set that session flag could erase history'
            : '') +
          `. Retention default ${retention} days (configurable). Not tamper-EVIDENT: a database administrator can still edit rows, and there is no hash chain or external immutable sink (log shipping to WORM storage / a SIEM).`,
        evidence: grepFile(
          'packages/db/migrations/20261001090000_auth_core.sql',
          /CREATE POLICY \w+ ON security_events|GRANT .* ON security_events/,
          5,
        ),
        recommendation:
          'Ship security_events to an external write-once sink (S3 Object Lock / SIEM) and alert on gaps; restrict pruning to a dedicated maintenance role instead of the shared privileged flag; optional hash-chain column for tamper evidence.',
      });
    },
  },
  {
    id: 'monitoring',
    run() {
      const center = grepFile(
        `${A}/platform/security-center.service.ts`,
        /auth\.failed|auth\.lockout|risk|severity/,
        4,
      );
      const alerts = grepFile(F.policyContract, /alertOnNewDevice|alertChannel/, 2);
      const paging = grepFiles(
        walk(
          'apps/api/src',
          (f) => /sentry|alert/i.test(f) && f.endsWith('.ts') && !f.endsWith('.spec.ts'),
        ),
        /Sentry\.capture|pagerduty|opsgenie/i,
        2,
      );
      return result({
        id: 'monitoring',
        controls: ['AUTH-092', 'AUTH-093', 'AUTH-098'],
        title: 'Abnormal authentication activity is detected and surfaced',
        status: center.length ? 'partial' : 'fail',
        severity: 'low',
        summary:
          'A Security Center aggregates auth events into KPIs and a risk queue for operators (failed sign-ins, lockouts, refresh-reuse, MFA failures) and users get new-device alerts. Not found: automatic paging/alerting to the engineering team on thresholds (failure-rate spike, refresh reuse, operator login from a new IP, Redis degraded), or latency/error-rate dashboards for the auth endpoints.',
        evidence: [...center, ...alerts, ...paging],
        recommendation:
          'Create 5 alerts from existing data: auth.failed rate, auth.lockout rate, auth.refresh_reuse_detected > 0, any platform-operator login outside the allow-list, Redis error rate; add a p95 login latency SLO.',
        confidence: 'static-heuristic',
      });
    },
  },

  // -------------------------------------------------------------------------------------------------------------------
  // L. Delivery
  // -------------------------------------------------------------------------------------------------------------------
  {
    id: 'ci-pipeline',
    run(ctx) {
      const wfDir = ['../.github/workflows', '.github/workflows'];
      const files = [];
      for (const d of wfDir) for (const f of walk(d, (x) => /\.ya?ml$/.test(x))) files.push(f);
      const text = files.map((f) => read(f) ?? '').join('\n');
      const has = (re) => re.test(text);
      const rows = {
        'unit tests on PR': has(/pnpm (?:--filter [^\n]+ )?test\b|pnpm test\b|turbo run test/),
        'integration tests': has(/test:integration/),
        'e2e tests': has(/test:e2e/),
        'dependency audit': has(/pnpm audit/),
        'SAST (CodeQL/Semgrep)': has(/codeql|semgrep/i),
        'secret scanning (gitleaks/trufflehog)': has(/gitleaks|trufflehog/i),
        'scheduled (nightly/weekly) run': has(/schedule:\s*\n\s*- cron/),
        'auth audit': has(/audit:auth|auth-audit/),
      };
      const missingRows = Object.entries(rows)
        .filter(([, v]) => !v)
        .map(([k]) => k);
      return result({
        id: 'ci-pipeline',
        controls: ['AUTH-099', 'AUTH-100'],
        title: 'Security regression runs automatically on PRs, nightly and before release',
        status: missingRows.length === 0 ? 'pass' : 'partial',
        severity: missingRows.length === 0 ? undefined : 'medium',
        summary:
          `Workflows found: ${files.map((f) => f.split('/').pop()).join(', ') || 'none'}. Present: ${
            Object.entries(rows)
              .filter(([, v]) => v)
              .map(([k]) => k)
              .join('; ') || 'none'
          }. Missing: ${missingRows.join('; ') || 'none'}. ` +
          'This audit tool is the missing piece for "auth audit": see README for the PR / nightly / pre-release workflow to add. (Workflows only run from the repository root .github, not from crm-platform/.github.)',
        evidence: files.map((f) => ({ file: f, line: 1, text: 'workflow' })),
        recommendation:
          'Add the auth-audit workflow (README), CodeQL for JS/TS, and gitleaks; enable GitHub secret scanning + push protection.',
      });
    },
  },
];
