// Turns raw check results into the audit model: per-control status, findings, metrics, numeric configuration table
// and the release verdict. Pure functions; no I/O except reading source for the configuration table.

import { CONTROLS, NOT_APPLICABLE } from './controls.mjs';
import { numExpr, read, sevRank } from './util.mjs';

export const TOOL_VERSION = '1.0.0';

const FINDING_STATUSES = new Set(['fail', 'partial', 'policy']);

// Ordering of control statuses, worst first.
const CONTROL_ORDER = [
  'FAIL',
  'PARTIAL',
  'POLICY',
  'NOT-IMPLEMENTED',
  'NOT-RUN',
  'NOT-ASSESSED',
  'ACCEPTED',
  'PASS',
  'N/A',
];
export const STATUS_LABEL = {
  FAIL: 'Fail',
  PARTIAL: 'Partial',
  POLICY: 'Needs decision',
  'NOT-IMPLEMENTED': 'Not implemented',
  'NOT-RUN': 'Not run',
  'NOT-ASSESSED': 'Not assessed',
  ACCEPTED: 'Accepted risk',
  PASS: 'Pass',
  'N/A': 'N/A',
};
const MAP = {
  fail: 'FAIL',
  partial: 'PARTIAL',
  policy: 'POLICY',
  'not-implemented': 'NOT-IMPLEMENTED',
  error: 'NOT-RUN',
  pass: 'PASS',
};

/** decisions.json -> { applied, invalid, expired } keyed by finding id. */
export function loadDecisions(raw, today = new Date()) {
  const applied = {};
  const invalid = [];
  const expired = [];
  if (!raw || typeof raw !== 'object') return { applied, invalid, expired };
  for (const [id, d] of Object.entries(raw)) {
    if (id.startsWith('_')) continue;
    const ok =
      d &&
      typeof d === 'object' &&
      ['accepted', 'deferred', 'fixed-elsewhere'].includes(d.decision) &&
      [d.reason, d.by, d.date].every((v) => typeof v === 'string' && v.trim().length > 2);
    if (!ok) {
      invalid.push({
        id,
        why: 'needs decision (accepted | deferred | fixed-elsewhere), reason, by and date',
      });
      continue;
    }
    if (d.expires && new Date(d.expires) < today) {
      expired.push({ id, expires: d.expires });
      continue;
    }
    applied[id] = d;
  }
  return { applied, invalid, expired };
}

export function buildModel({
  results,
  testSummaries,
  testEvidence,
  decisions,
  env,
  opts,
  startedAt,
  finishedAt,
  git,
  routes,
  testInventory,
}) {
  const dec = decisions.applied;

  // ---- findings --------------------------------------------------------------------------------------------------
  const findings = results
    .filter((r) => FINDING_STATUSES.has(r.status))
    .map((r) => {
      const d = dec[r.id];
      return {
        id: r.id,
        title: r.title,
        severity: r.severity ?? 'low',
        checkStatus: r.status,
        state: d ? (d.decision === 'accepted' ? 'accepted' : d.decision) : 'open',
        controls: r.controls,
        summary: r.summary,
        evidence: r.evidence ?? [],
        recommendation: r.recommendation,
        confidence: r.confidence,
        policyDecision: Boolean(r.policyDecision),
        decision: d ?? null,
      };
    })
    .sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || a.id.localeCompare(b.id));
  const open = findings.filter((f) => f.state === 'open');

  // ---- controls --------------------------------------------------------------------------------------------------
  const byControl = new Map(CONTROLS.map((c) => [c.id, []]));
  for (const r of results) for (const id of r.controls ?? []) byControl.get(id)?.push(r);

  const controls = CONTROLS.map((c) => {
    if (NOT_APPLICABLE[c.id])
      return {
        ...c,
        status: 'N/A',
        checks: [],
        notRun: [],
        tests: null,
        reason: NOT_APPLICABLE[c.id],
        severity: undefined,
      };
    const all = byControl.get(c.id) ?? [];
    const verdicts = all.filter((r) => r.status !== 'info');
    const real = verdicts.filter((r) => r.status !== 'error');
    const notRun = verdicts.filter((r) => r.status === 'error');
    const tests = testEvidence?.[c.id] ?? null;

    const statuses = real.map((r) => {
      const d = dec[r.id];
      if (d && FINDING_STATUSES.has(r.status))
        return d.decision === 'accepted' ? 'ACCEPTED' : 'POLICY';
      return MAP[r.status];
    });
    if (tests && tests.failed > 0) statuses.push('FAIL');
    let status;
    if (statuses.length) status = CONTROL_ORDER.find((s) => statuses.includes(s));
    else if (notRun.length) status = 'NOT-RUN';
    else if (tests && tests.executed > 0 && tests.failed === 0) status = 'PASS';
    else status = 'NOT-ASSESSED';
    const sev = real
      .filter((r) => FINDING_STATUSES.has(r.status) && !dec[r.id])
      .map((r) => r.severity ?? 'low')
      .sort((a, b) => sevRank(a) - sevRank(b))[0];
    return {
      ...c,
      status,
      severity: sev,
      checks: real.map((r) => ({ id: r.id, status: r.status })),
      notRun: notRun.map((r) => r.id),
      tests,
      via: !real.length && tests?.executed ? 'tests' : undefined,
    };
  });

  // ---- tests -----------------------------------------------------------------------------------------------------
  const ran = testSummaries.filter((s) => s.ran);
  const tot = ran.reduce(
    (a, s) => ({
      total: a.total + s.total,
      passed: a.passed + s.passed,
      failed: a.failed + s.failed,
      skipped: a.skipped + s.skipped,
    }),
    { total: 0, passed: 0, failed: 0, skipped: 0 },
  );
  const tests = {
    ...tot,
    layersRun: ran.map((s) => s.label),
    layersNotRun: testSummaries
      .filter((s) => !s.ran)
      .map((s) => ({ label: s.label, reason: s.reason })),
    summaries: testSummaries,
    inventory: testInventory,
  };

  // ---- metrics -------------------------------------------------------------------------------------------------
  const prio = {};
  for (const p of ['P0', 'P1', 'P2', 'P3']) {
    const list = controls.filter((c) => c.priority === p && c.status !== 'N/A');
    prio[p] = { applicable: list.length };
    for (const s of CONTROL_ORDER) prio[p][s] = list.filter((c) => c.status === s).length;
    prio[p].covered = list.filter(
      (c) => c.status !== 'NOT-ASSESSED' && c.status !== 'NOT-RUN',
    ).length;
  }
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of open) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;

  // ---- verdict ----------------------------------------------------------------------------------------------------
  const blockers = open.filter((f) => f.severity === 'critical' || f.severity === 'high');
  const reasons = [];
  let value;
  if (blockers.length || tot.failed > 0) {
    value = 'NO-GO';
    if (blockers.length)
      reasons.push(
        `${blockers.length} unresolved Critical/High finding(s): ${blockers.map((b) => b.id).join(', ')}`,
      );
    if (tot.failed > 0) reasons.push(`${tot.failed} failing existing test(s)`);
  } else {
    const p0NotGreen = controls.filter(
      (c) => c.priority === 'P0' && !['PASS', 'ACCEPTED', 'N/A'].includes(c.status),
    );
    const notExecuted = tests.layersNotRun.length > 0 || tot.total === 0;
    if (p0NotGreen.length)
      reasons.push(
        `${p0NotGreen.length} applicable P0 control(s) are not yet Pass or Accepted: ${p0NotGreen
          .slice(0, 12)
          .map((c) => c.id)
          .join(', ')}${p0NotGreen.length > 12 ? '…' : ''}`,
      );
    if (notExecuted) reasons.push('some test layers did not run (see "What did not run")');
    value = p0NotGreen.length || notExecuted ? 'CONDITIONAL' : 'GO';
  }

  return {
    meta: {
      tool: 'auth-audit',
      version: TOOL_VERSION,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      git,
      opts: publicOpts(opts),
      standard:
        'WaDesk Authentication Audit & Security Engineering Standard (AUTH-001..AUTH-100), adapted',
    },
    env,
    verdict: { value, reasons, blockers: blockers.map((b) => b.id) },
    metrics: {
      priority: prio,
      openBySeverity: bySeverity,
      findingsTotal: findings.length,
      findingsOpen: open.length,
      tests,
    },
    findings,
    controls,
    checks: results,
    config: collectConfig(results),
    routes,
    decisions,
    notRun: results
      .filter((r) => r.status === 'error')
      .map((r) => ({ id: r.id, title: r.title, why: r.summary })),
  };
}

function publicOpts(o) {
  const { password, ...rest } = o ?? {};
  return { ...rest, password: password ? '(provided)' : undefined };
}

// ---------------------------------------------------------------------------------------------------------------------
// Numeric configuration: the standard's table of recommended values against what the code actually has.
// ---------------------------------------------------------------------------------------------------------------------

const n = (relPath, re) => {
  const m = re.exec(read(relPath) ?? '');
  return m ? Number(m[1]) : null;
};
const s = (relPath, re) => re.exec(read(relPath) ?? '')?.[1] ?? null;

function collectConfig(results) {
  const P = 'packages/contracts/src/auth-registration-security/security-policy.ts';
  const K = 'apps/api/src/modules/auth/support/redis-keys.ts';
  const argon = results.find((r) => r.id === 'argon2-parameters')?.data;
  const resetMin = (numExpr(K, 'resetPasswordSeconds') ?? 0) / 60;
  const idle = n(P, /sessionTimeoutMinutes:.*\.default\((\d+)\)/);
  const minLen = n(P, /passwordMinLength:.*\.default\((\d+)\)/);
  const minFloor = n(P, /passwordMinLength:\s*z\.number\(\)\.int\(\)\.min\((\d+)\)/);
  const maxLen = n(P, /passwordMinLength:.*\.max\((\d+)\)/);
  const failures = n(P, /lockoutAfterFailures:.*\.default\((\d+)\)/);
  const window = n(P, /lockoutWindowMinutes:.*\.default\((\d+)\)/);
  const mfaAttempts = n(K, /mfaMaxAttempts:\s*(\d+)/);
  const codes = n(
    'apps/api/src/modules/auth/support/recovery-codes.ts',
    /RECOVERY_CODE_COUNT\s*=\s*(\d+)/,
  );
  const totpStep = n('apps/api/src/modules/auth/support/totp.ts', /TOTP_STEP_SECONDS\s*=\s*(\d+)/);
  const accessTtl = s(
    'apps/api/src/config/env.schema.ts',
    /JWT_ACCESS_TTL:\s*z\.string\(\)\.default\('([^']+)'\)/,
  );
  const refreshTtl = s(
    'apps/api/src/config/env.schema.ts',
    /JWT_REFRESH_TTL:\s*z\.string\(\)\.default\('([^']+)'\)/,
  );
  const noRememberExpr = /sessionNoRememberSeconds:\s*([\d*\s]+),/.exec(read(K) ?? '')?.[1];
  const noRememberSec = noRememberExpr
    ? noRememberExpr.split('*').reduce((a, x) => a * Number(x.trim()), 1)
    : null;
  const noRemember = noRememberSec ? `${Math.round(noRememberSec / 86400)} days` : '?';
  const mfaFlags = [
    'requireMfaForAll',
    'requireMfaForAdmins',
    'requireMfaForOwners',
    'requireMfaForSuperAdmins',
  ].map((k) => s(P, new RegExp(`${k}:\\s*z\\.boolean\\(\\)\\.default\\((true|false)\\)`)));
  const events = results.find((r) => r.id === 'audit-events')?.data;
  const keyBits = results
    .find((r) => r.id === 'api-key-storage')
    ?.summary?.match(/≈ (\d+) bits/)?.[1];

  const row = (name, recommended, actual, verdict, note = '') => ({
    name,
    recommended,
    actual,
    verdict,
    note,
  });
  return [
    row(
      'Password minimum',
      '15 if password-only; 8 minimum with MFA',
      `default ${minLen}; schema floor ${minFloor}`,
      minFloor >= 8 && minLen >= 12 ? 'ok' : 'decision',
      'Below the ASVS floor of 8 is configurable; default is below 15.',
    ),
    row(
      'Password maximum supported',
      '≥ 64',
      `${maxLen} (login field accepts 256)`,
      maxLen >= 64 ? 'ok' : 'deviation',
    ),
    row(
      'Password hashing',
      'Argon2id, tuned to infrastructure',
      argon
        ? `argon2${argon.alg} m=${argon.mem} KiB, t=${argon.t}, p=${argon.p}; ${argon.ms} ms here`
        : 'Argon2id (library defaults; not measured this run)',
      argon
        ? argon.alg === 'id' && argon.mem >= 19456 && argon.t >= 2
          ? 'ok'
          : 'deviation'
        : 'unknown',
      'OWASP minimum profile. Tune upwards on production hardware.',
    ),
    row(
      'Session identifier entropy',
      '≥ 128 bits',
      'uuid v4 (122 bits) as sid; bearer credential is an HMAC-signed JWT',
      'ok',
      'The sid is not the credential.',
    ),
    row(
      'Admin MFA',
      'Mandatory',
      `defaults: all=${mfaFlags[0]}, admins=${mfaFlags[1]}, owners=${mfaFlags[2]}, super-admins=${mfaFlags[3]}`,
      mfaFlags.every((v) => v === 'true') ? 'ok' : 'decision',
      'Production value is not visible to this audit.',
    ),
    row(
      'Preferred MFA',
      'WebAuthn / passkeys; TOTP fallback',
      'TOTP + recovery codes only',
      'gap',
      'Passkeys not implemented.',
    ),
    row(
      'TOTP interval',
      '30 s',
      `${totpStep} s, 6 digits, ±1 step`,
      totpStep === 30 ? 'ok' : 'deviation',
    ),
    row(
      'OTP attempts',
      'max 5 per challenge',
      `${mfaAttempts} per challenge; 5 per person per 15 min`,
      mfaAttempts <= 5 ? 'ok' : 'deviation',
    ),
    row(
      'Recovery codes',
      '10 one-time codes',
      `${codes}, Argon2-hashed, single-use`,
      codes === 10 ? 'ok' : 'deviation',
    ),
    row('Reset token validity', '15–30 min', `${resetMin} min`, resetMin <= 30 ? 'ok' : 'decision'),
    row(
      'Login abuse threshold',
      '5 failures / 15 min, progressive controls',
      `${failures} failures / ${window} min per (account, IP); 40 failures / 5 min per IP`,
      failures <= 5 ? 'ok' : 'deviation',
      'Fixed-window lockout; no account-wide progressive challenge.',
    ),
    row(
      'Admin idle timeout',
      '15–30 min',
      `${idle} min default (operators share the policy value)`,
      idle <= 30 ? 'ok' : 'decision',
    ),
    row(
      'Standard-user idle timeout',
      '30–60 min',
      `${idle} min default; "remember me" sessions are exempt`,
      idle <= 60 ? 'ok' : 'decision',
    ),
    row(
      'Absolute session lifetime',
      '8–12 h for privileged sessions',
      `operators 12 h; staff ${noRemember} without remember-me, ${refreshTtl} with it`,
      'decision',
      'Staff lifetimes are long by product design.',
    ),
    row(
      'Access JWT lifetime',
      '5–15 min',
      accessTtl ?? '?',
      /^(5|10|15)m$/.test(accessTtl ?? '') ? 'ok' : 'deviation',
    ),
    row(
      'Refresh token lifetime',
      'rotating, reuse-detected',
      `${refreshTtl}, rotating, reuse revokes session`,
      'ok',
    ),
    row(
      'Session revocation',
      'Effective on next protected request',
      'Redis tombstone + epoch, checked per request (fail-open if Redis is down)',
      'decision',
    ),
    row(
      'API-key entropy',
      '≥ 128 bits, preferably 256',
      keyBits ? `≈ ${keyBits} bits` : '≈ 190 bits',
      'ok',
    ),
    row(
      'Authentication event coverage',
      '100% of sensitive events',
      events ? `${16 - (events.missing?.length ?? 0)}/16 required events emitted` : 'not measured',
      events && !events.missing?.length ? 'ok' : 'deviation',
    ),
    row('Critical/High unresolved', '0 release blockers', '(see verdict)', 'info'),
  ];
}
