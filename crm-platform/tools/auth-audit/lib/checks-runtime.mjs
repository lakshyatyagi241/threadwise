// Runtime checks: things that execute code or external tools and report what actually happened.
//   pure probes   the product's own security functions, fed attack inputs (no DB, no network)
//   test suites   the existing unit / integration / e2e tests, with per-control traceability
//   dependencies  pnpm audit
//   secrets       tracked-file scan (+ gitleaks when installed)
//   semgrep       when installed
//
// Anything that does not run is reported as `not-run` with the reason. It is never counted as a pass.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { controlsForTestFile } from './inventory.mjs';
import {
  REPO_ROOT,
  ROOT,
  abs,
  exists,
  fmtMs,
  log,
  read,
  result,
  rel,
  run,
  which,
} from './util.mjs';

// ---------------------------------------------------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Child-process environment. On Windows @swc/core (used by vitest and the Nest build) validates its native-addon
 * cache folder and refuses to load when a parent folder grants rights to an unexpected account (OneDrive and
 * sandboxed shells do this) or when the default path is too long. A short folder under the user profile avoids both.
 */
export function childEnv() {
  const env = { HUSKY: '0', CI: process.env.CI ?? '1' };
  if (process.platform === 'win32' && !process.env.SWC_NATIVE_BINDING_CACHE) {
    const dir = join(homedir(), '.swc-native');
    try {
      mkdirSync(dir, { recursive: true });
      env.SWC_NATIVE_BINDING_CACHE = dir;
    } catch {
      /* fall through: the default may still work */
    }
  }
  return env;
}

export function detectEnvironment() {
  const info = {
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    pnpm: which('pnpm') ? 'found' : 'missing',
    dependenciesInstalled: exists('node_modules') && exists('apps/api/node_modules'),
    packagesBuilt: exists('packages/contracts/dist/index.js'),
    docker: which('docker') ? 'found' : 'missing',
    gitleaks: which('gitleaks') ? 'found' : 'missing',
    semgrep: which('semgrep') ? 'found' : 'missing',
    k6: which('k6') ? 'found' : 'missing',
  };
  return info;
}

async function dockerReady() {
  if (!which('docker')) return false;
  const r = await run('docker', ['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 20000 });
  return r.code === 0 && r.stdout.trim().length > 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Pure probes
// ---------------------------------------------------------------------------------------------------------------------

const PROBE_GROUPS = {
  totp: {
    controls: ['AUTH-047', 'AUTH-048'],
    title: 'TOTP: RFC 6238 vectors, drift window, replay, malformed input',
    sev: 'high',
  },
  'recovery-codes': {
    controls: ['AUTH-049'],
    title: 'Recovery codes: uniqueness, hashing, single use, loose matching',
    sev: 'high',
  },
  'password-policy': {
    controls: ['AUTH-012', 'AUTH-013', 'AUTH-017'],
    title: 'Password policy against attack and Unicode inputs',
    sev: 'medium',
  },
  'ip-allowlist': {
    controls: ['AUTH-021', 'AUTH-044'],
    title: 'Operator IP allow-list: malformed entries never widen access',
    sev: 'high',
  },
  'crypto-utils': {
    controls: ['AUTH-015', 'AUTH-023'],
    title: 'Random tokens, constant-time compare, unbiased numeric codes',
    sev: 'high',
  },
  'return-url': {
    controls: ['AUTH-077', 'AUTH-088'],
    title: 'Open-redirect payloads against the post-login return path',
    sev: 'high',
  },
  jwt: {
    controls: ['AUTH-037'],
    title:
      "JWT attacks against the product's verification settings (alg=none, tamper, expiry, nbf, wrong secret)",
    sev: 'critical',
  },
  argon2: {
    controls: ['AUTH-010', 'AUTH-016'],
    title: 'Argon2id parameters and long-password handling (measured)',
    sev: 'high',
  },
  'audit-redaction': {
    controls: ['AUTH-091'],
    title: 'Audit-log redaction of secret-named fields',
    sev: 'low',
  },
};

export async function runPureProbes(ctx) {
  const probe = abs('tools/auth-audit/probes/pure.probe.mts');
  if (!ctx.env.dependenciesInstalled) {
    return [
      result({
        id: 'pure-probes',
        controls: Object.values(PROBE_GROUPS).flatMap((g) => g.controls),
        title: "Runtime probes of the product's security functions",
        status: 'error',
        summary: 'NOT RUN: dependencies are not installed (run `pnpm install` or pass --install).',
        confidence: 'not-run',
      }),
    ];
  }
  const r = await run('pnpm', ['--filter', '@crm/api', 'exec', 'tsx', probe], {
    env: childEnv(),
    timeoutMs: 240000,
  });
  const marker = r.stdout.lastIndexOf('@@AUDIT@@');
  if (marker === -1) {
    return [
      result({
        id: 'pure-probes',
        controls: Object.values(PROBE_GROUPS).flatMap((g) => g.controls),
        title: "Runtime probes of the product's security functions",
        status: 'error',
        summary: `NOT RUN: the probe process produced no result (exit ${r.code}). ${(r.stderr || r.stdout).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 400)}`,
        confidence: 'not-run',
      }),
    ];
  }
  const assertions = JSON.parse(r.stdout.slice(marker + 9));
  const out = [];
  let argonMeta = null;
  for (const [group, meta] of Object.entries(PROBE_GROUPS)) {
    const rows = assertions.filter((a) => a.group === group && a.name !== '__meta');
    if (group === 'argon2') {
      const m = assertions.find((a) => a.group === 'argon2' && a.name === '__meta');
      if (m) argonMeta = JSON.parse(m.detail);
    }
    if (!rows.length) {
      out.push(
        result({
          id: `probe-${group}`,
          controls: meta.controls,
          title: meta.title,
          status: 'error',
          summary: 'NOT RUN: no assertions were reported for this group.',
          confidence: 'not-run',
        }),
      );
      continue;
    }
    const asserts = rows.filter((a) => a.kind !== 'note');
    const notes = rows.filter((a) => a.kind === 'note');
    const failed = asserts.filter((a) => !a.ok);
    // The `note` rows document known weaknesses the probe observed; they feed the findings of the static checks.
    out.push(
      result({
        id: `probe-${group}`,
        controls: meta.controls,
        title: meta.title,
        status: failed.length ? 'fail' : 'pass',
        severity: failed.length ? (group === 'audit-redaction' ? 'low' : meta.sev) : undefined,
        summary:
          `${asserts.length - failed.length}/${asserts.length} assertions held` +
          (failed.length
            ? `; FAILED: ${failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ''}`).join('; ')}`
            : '') +
          (notes.length
            ? `. Observations: ${notes.map((n) => `${n.name}: ${n.detail}`).join(' · ')}`
            : ''),
        evidence: failed.slice(0, 6).map((f) => ({
          file: 'tools/auth-audit/probes/pure.probe.mts',
          line: 0,
          text: `${f.name} — ${f.detail ?? 'failed'}`,
        })),
        data: { assertions: rows },
        confidence: 'runtime',
        recommendation:
          failed.length && group === 'audit-redaction'
            ? 'Add a bare `otp` (and `pin`) alternative to SECRET_KEY in auth-audit.service.ts so a payload key named exactly "otp" is redacted like "otpCode" already is.'
            : undefined,
      }),
    );
  }
  if (argonMeta)
    out.push(
      result({
        id: 'argon2-parameters',
        controls: ['AUTH-010'],
        title: 'Measured Argon2 parameters',
        status: 'info',
        summary: `argon2id m=${argonMeta.mem} KiB, t=${argonMeta.t}, p=${argonMeta.p}; ${argonMeta.ms} ms per hash on this machine.`,
        data: argonMeta,
        confidence: 'runtime',
      }),
    );
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Existing test suites
// ---------------------------------------------------------------------------------------------------------------------

const API_UNIT_FILTERS = [
  'auth-registration-security',
  'impersonation',
  'api-key',
  'rate-limit',
  'realtime',
  'rbac',
  'cors',
  'throttle',
  'sheets-auth',
  'webhook-secret',
];
const API_E2E_FILTERS = [
  'auth-registration-security',
  'impersonation',
  'developer-rest-api-v1/auth',
  'sheets-auth',
];
const API_INTEGRATION_FILTERS = ['auth-registration-security', 'impersonation'];
const WEB_FILTERS_FAST = ['src/lib/auth', 'src/proxy.test.ts'];
const WEB_FILTERS_FULL = [
  'src/lib/auth',
  'src/proxy.test.ts',
  'src/features/auth-registration-security',
];

async function vitest(label, pkg, dir, filters, ctx, timeoutMs) {
  const outFile = join(tmpdir(), `auth-audit-${label}-${process.pid}.json`);
  const args = ['--filter', pkg, 'exec', 'vitest', 'run'];
  if (dir) args.push('--dir', dir);
  args.push(...filters, '--reporter=json', `--outputFile=${outFile}`, '--passWithNoTests');
  if (label !== 'api-unit' && label !== 'web-unit') args.push('--testTimeout=120000');
  log.info(`vitest ${label}: ${filters.join(' ')}`);
  const r = await run('pnpm', args, { env: childEnv(), timeoutMs });
  let json = null;
  try {
    json = JSON.parse(readFileSync(outFile, 'utf8'));
  } catch {
    /* handled below */
  }
  return { label, r, json };
}

function summariseVitest({ label, r, json }) {
  if (!json) {
    return {
      label,
      ran: false,
      reason: r.timedOut
        ? 'timed out'
        : `vitest produced no report (exit ${r.code}): ${(r.stderr || r.stdout).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)}`,
    };
  }
  const files = json.testResults.map((tr) => {
    const a = tr.assertionResults;
    return {
      file: rel(tr.name),
      passed: a.filter((x) => x.status === 'passed').length,
      failed: a.filter((x) => x.status === 'failed').length,
      skipped: a.filter(
        (x) => x.status === 'skipped' || x.status === 'pending' || x.status === 'todo',
      ).length,
      suiteError:
        a.length === 0 && tr.status === 'failed'
          ? (tr.message || 'suite failed to load').split('\n')[0].slice(0, 200)
          : null,
      failures: a
        .filter((x) => x.status === 'failed')
        .map((x) => ({
          name: x.fullName,
          message: (x.failureMessages?.[0] ?? '').split('\n')[0].slice(0, 200),
        })),
    };
  });
  return {
    label,
    ran: true,
    ms: r.ms,
    total: json.numTotalTests,
    passed: json.numPassedTests,
    failed: json.numFailedTests,
    skipped: json.numPendingTests + (json.numTodoTests ?? 0),
    suitesFailed: json.numFailedTestSuites,
    files,
  };
}

export async function runTestSuites(ctx) {
  const results = [];
  const summaries = [];
  const env = ctx.env;
  if (!env.dependenciesInstalled || !env.packagesBuilt) {
    const why = !env.dependenciesInstalled
      ? 'dependencies are not installed'
      : 'workspace packages are not built';
    results.push(
      result({
        id: 'tests-not-run',
        controls: ['AUTH-099'],
        title: 'Existing authentication test suites',
        status: 'error',
        summary: `NOT RUN: ${why}. Run \`pnpm audit:auth --install\` (installs and builds) or prepare the workspace yourself.`,
        confidence: 'not-run',
      }),
    );
    return { results, summaries };
  }

  const plans = [
    {
      label: 'api-unit',
      pkg: '@crm/api',
      dir: 'test/unit',
      filters: API_UNIT_FILTERS,
      timeout: 600000,
    },
  ];
  plans.push({
    label: 'web-unit',
    pkg: '@crm/web',
    dir: null,
    filters: ctx.opts.full ? WEB_FILTERS_FULL : WEB_FILTERS_FAST,
    timeout: 600000,
  });
  if (ctx.opts.full) {
    if (await dockerReady()) {
      plans.push({
        label: 'api-integration',
        pkg: '@crm/api',
        dir: 'test/integration',
        filters: API_INTEGRATION_FILTERS,
        timeout: 1500000,
      });
      plans.push({
        label: 'api-e2e',
        pkg: '@crm/api',
        dir: 'test/e2e',
        filters: API_E2E_FILTERS,
        timeout: 2400000,
      });
    } else {
      results.push(
        result({
          id: 'tests-integration-not-run',
          controls: ['AUTH-099'],
          title: 'Integration and end-to-end suites',
          status: 'error',
          summary:
            'NOT RUN: --full was requested but the Docker daemon is not reachable (the suites start their own Postgres/Redis containers). Start Docker Desktop and re-run.',
          confidence: 'not-run',
        }),
      );
    }
  }

  for (const p of plans) {
    const s = summariseVitest(await vitest(p.label, p.pkg, p.dir, p.filters, ctx, p.timeout));
    summaries.push(s);
    if (!s.ran) {
      results.push(
        result({
          id: `tests-${p.label}`,
          controls: ['AUTH-099'],
          title: `Test suite: ${p.label}`,
          status: 'error',
          summary: `NOT RUN: ${s.reason}`,
          confidence: 'not-run',
        }),
      );
      continue;
    }
    const bad = s.files.filter((f) => f.failed > 0 || f.suiteError);
    results.push(
      result({
        id: `tests-${p.label}`,
        controls: ['AUTH-099'],
        title: `Test suite: ${p.label}`,
        status: s.failed > 0 || s.suitesFailed > 0 ? 'fail' : s.total === 0 ? 'error' : 'pass',
        severity: s.failed > 0 || s.suitesFailed > 0 ? 'high' : undefined,
        summary:
          `${s.passed} passed, ${s.failed} failed, ${s.skipped} skipped of ${s.total} tests in ${s.files.length} files (${fmtMs(s.ms)}).` +
          (bad.length
            ? ` Failing: ${bad.map((b) => `${b.file}${b.suiteError ? ` (suite error: ${b.suiteError})` : ''}`).join(', ')}`
            : ''),
        evidence: bad
          .flatMap((b) =>
            b.failures
              .slice(0, 3)
              .map((f) => ({ file: b.file, line: 0, text: `${f.name} — ${f.message}` })),
          )
          .slice(0, 8),
        data: { summary: s },
        confidence: 'runtime',
      }),
    );
    // failed tests also fail the controls they trace to
    for (const b of bad) {
      const controls = controlsForTestFile(b.file);
      if (controls.length) {
        results.push(
          result({
            id: `test-failure:${b.file}`,
            controls,
            title: `Failing test file ${b.file}`,
            status: 'fail',
            severity: 'high',
            summary: `${b.failed} failing test(s) in ${b.file}.`,
            evidence: b.failures
              .slice(0, 3)
              .map((f) => ({ file: b.file, line: 0, text: `${f.name} — ${f.message}` })),
            confidence: 'runtime',
          }),
        );
      }
    }
  }
  return { results, summaries };
}

/** controlId -> { executed, passed, failed } from the executed suites. */
export function testEvidenceByControl(summaries) {
  const map = {};
  for (const s of summaries) {
    if (!s.ran) continue;
    for (const f of s.files) {
      for (const c of controlsForTestFile(f.file)) {
        const e = (map[c] ??= { executed: 0, passed: 0, failed: 0, files: new Set() });
        e.executed += f.passed + f.failed;
        e.passed += f.passed;
        e.failed += f.failed;
        e.files.add(f.file);
      }
    }
  }
  for (const e of Object.values(map)) e.files = [...e.files];
  return map;
}

// ---------------------------------------------------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------------------------------------------------

/** Packages whose flaws can directly weaken authentication. A high advisory here is a release blocker. */
const AUTH_RELEVANT =
  /^(jsonwebtoken|jws|jwa|jose|@nestjs\/jwt|@node-rs\/argon2|argon2|bcrypt\w*|@clerk\/.+|ioredis|express|body-parser|cookie|cookie-parser|socket\.io.*|engine\.io.*|ws|next|iron-session|passport.*|oauth.*|openid-client|otplib|speakeasy|@simplewebauthn\/.+|undici|path-to-regexp|qs|send|serve-static)$/;

export async function runDependencyAudit(ctx) {
  if (ctx.opts.skipDeps) {
    return [
      result({
        id: 'dependency-audit',
        controls: ['AUTH-099'],
        title: 'Dependency vulnerabilities',
        status: 'error',
        summary: 'NOT RUN: --skip-deps.',
        confidence: 'not-run',
      }),
    ];
  }
  if (!which('pnpm'))
    return [
      result({
        id: 'dependency-audit',
        controls: ['AUTH-099'],
        title: 'Dependency vulnerabilities',
        status: 'error',
        summary: 'NOT RUN: pnpm not found.',
        confidence: 'not-run',
      }),
    ];
  const r = await run('pnpm', ['audit', '--prod', '--json'], {
    env: childEnv(),
    timeoutMs: 180000,
  });
  let j;
  try {
    j = JSON.parse(r.stdout);
  } catch {
    return [
      result({
        id: 'dependency-audit',
        controls: ['AUTH-099'],
        title: 'Dependency vulnerabilities',
        status: 'error',
        summary: `NOT RUN: could not read the audit response (exit ${r.code}); the registry may be unreachable. ${(r.stderr || r.stdout).slice(0, 200)}`,
        confidence: 'not-run',
      }),
    ];
  }
  const list = Object.values(j.advisories ?? {}).map((a) => ({
    pkg: a.module_name,
    severity: a.severity === 'moderate' ? 'medium' : a.severity,
    title: a.title,
    range: a.vulnerable_versions,
    fix: a.patched_versions,
    cves: a.cves ?? [],
    paths: (a.findings ?? []).flatMap((f) => f.paths ?? []).length,
    sample: (a.findings ?? []).flatMap((f) => f.paths ?? [])[0] ?? '',
    authRelevant: AUTH_RELEVANT.test(a.module_name),
  }));
  const meta = j.metadata?.vulnerabilities ?? {};
  const blockers = list.filter(
    (a) => (a.severity === 'critical' || a.severity === 'high') && a.authRelevant,
  );
  const otherHigh = list.filter(
    (a) => (a.severity === 'critical' || a.severity === 'high') && !a.authRelevant,
  );
  const out = [];
  out.push(
    result({
      id: 'dependency-audit',
      controls: ['AUTH-099'],
      title:
        'Production dependencies have no known high/critical vulnerabilities in authentication-relevant packages',
      status: blockers.length ? 'fail' : otherHigh.length || list.length ? 'partial' : 'pass',
      severity: blockers.length
        ? 'high'
        : otherHigh.length
          ? 'medium'
          : list.length
            ? 'low'
            : undefined,
      summary:
        `pnpm audit --prod: ${meta.critical ?? 0} critical, ${meta.high ?? 0} high, ${meta.moderate ?? 0} moderate, ${meta.low ?? 0} low across ${j.metadata?.totalDependencies ?? '?'} packages. ` +
        `${blockers.length} high/critical advisory(ies) are in authentication-relevant packages; ${otherHigh.length} high/critical are elsewhere (${otherHigh.map((a) => a.pkg).join(', ') || 'none'}). ` +
        `Note: the repository CI runs \`pnpm audit --prod --audit-level=high\`, which fails while a high advisory is open.`,
      evidence: list.slice(0, 8).map((a) => ({
        file: 'pnpm-lock.yaml',
        line: 0,
        text: `[${a.severity}] ${a.pkg} ${a.range} — ${a.title}${a.cves.length ? ` (${a.cves.join(', ')})` : ''}; fix ${a.fix}`,
      })),
      data: { advisories: list, counts: meta },
      confidence: 'runtime',
      recommendation: list.length
        ? 'Bump the listed packages (usually transitive via @sentry/node, vite/postcss tooling); pnpm.overrides is the fast fix. Re-run to confirm.'
        : undefined,
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Secret scan
// ---------------------------------------------------------------------------------------------------------------------

const SECRET_PATTERNS = [
  {
    name: 'private key block',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----/,
    sev: 'high',
  },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/, sev: 'high' },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, sev: 'high' },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, sev: 'high' },
  { name: 'live secret key (sk_live_)', re: /\bsk_live_[0-9a-zA-Z]{16,}\b/, sev: 'high' },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/, sev: 'medium' },
  {
    name: 'hard-coded JWT',
    re: /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b/,
    sev: 'medium',
  },
  {
    name: 'credential assignment',
    re: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\b\s*[:=]\s*['"]([^'"\s${}<>]{16,})['"]/i,
    sev: 'medium',
    value: 1,
  },
];
const PLACEHOLDER =
  /(replace|example|changeme|change-me|your[_-]|placeholder|dummy|sample|test|fake|xxxx|\*\*\*|dev-only|redacted|localhost|process\.env|import\.meta|not-a-secret)/i;
const ENV_VAR_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

function listTracked() {
  return run('git', ['ls-files', '-z'], { cwd: REPO_ROOT, timeoutMs: 60000 }).then((r) => {
    if (r.code !== 0) return null;
    const prefix = REPO_ROOT === ROOT ? '' : 'crm-platform/';
    return r.stdout
      .split('\0')
      .filter((f) => f && f.startsWith(prefix))
      .map((f) => ({ repoPath: f, abs: join(REPO_ROOT, f), path: f.slice(prefix.length) }));
  });
}

const SKIP_FILE =
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$|\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|eot|pdf|zip|gz|mp4|mov|map|lock|snap|xlsx|docx|min\.js)$|(^|\/)(node_modules|dist|\.next)\//i;
// tools/sast-report/baseline.json quotes the fake keys of the reviewed spec fixtures it suppresses (each entry says so), so it is
// counted with the test fixtures, not as source.
const TESTISH =
  /(^|\/)(test|tests|e2e|__tests__|fixtures?|mocks?|docs?|examples?)\/|\.(spec|test)\.[tj]sx?$|\.example$|\.md$|(^|\/)[\w.-]*(fixtures?|mocks?|stubs?|demo|seed)[\w.-]*\.[tj]sx?$|^tools\/sast-report\/baseline\.json$/i;

export async function runSecretScan(ctx) {
  const out = [];
  const files = await listTracked();
  if (!files)
    return [
      result({
        id: 'secret-scan',
        controls: ['AUTH-081', 'AUTH-091'],
        title: 'Secrets in tracked files',
        status: 'error',
        summary: 'NOT RUN: `git ls-files` failed (not a git checkout?).',
        confidence: 'not-run',
      }),
    ];
  const hits = [];
  const envTracked = files.filter(
    (f) => /(^|\/)\.env(\.[\w.-]+)?$/.test(f.path) && !/\.example$|\.sample$/.test(f.path),
  );
  let scanned = 0;
  for (const f of files) {
    if (SKIP_FILE.test(f.path)) continue;
    let st;
    try {
      st = statSync(f.abs);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size > 1_000_000) continue;
    let text;
    try {
      text = readFileSync(f.abs, 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\0')) continue;
    scanned++;
    const ls = text.split(/\r?\n/);
    for (let i = 0; i < ls.length; i++) {
      const line = ls[i];
      if (line.length > 2000) continue;
      for (const p of SECRET_PATTERNS) {
        const m = p.re.exec(line);
        if (!m) continue;
        const value = p.value ? m[p.value] : m[0];
        if (PLACEHOLDER.test(line) || PLACEHOLDER.test(value ?? '')) continue;
        if (/^[A-Za-z]+$/.test(value ?? '') && (value ?? '').length < 24) continue;
        // An environment variable name (ZOOM_CLIENT_SECRET) is the name an operator types, not the secret it names.
        if (ENV_VAR_NAME.test(value ?? '')) continue;
        hits.push({
          file: f.path,
          line: i + 1,
          pattern: p.name,
          sev: p.sev,
          testish: TESTISH.test(f.path),
          masked: `${(value ?? '').slice(0, 4)}…(${(value ?? '').length} chars)`,
        });
      }
    }
  }
  const real = hits.filter((h) => !h.testish);
  const inTests = hits.filter((h) => h.testish);
  out.push(
    result({
      id: 'secret-scan',
      controls: ['AUTH-081', 'AUTH-091', 'AUTH-039'],
      title: 'No credentials committed to the repository',
      status:
        envTracked.length || real.some((h) => h.sev === 'high')
          ? 'fail'
          : real.length
            ? 'partial'
            : 'pass',
      severity:
        envTracked.length || real.some((h) => h.sev === 'high')
          ? 'critical'
          : real.length
            ? 'medium'
            : undefined,
      summary:
        `Scanned ${scanned} tracked text files in crm-platform with ${SECRET_PATTERNS.length} patterns (private keys, cloud/GitHub/Slack/Stripe-style keys, JWTs, quoted credential assignments; obvious placeholders ignored). ` +
        `${real.length} candidate(s) in source/config, ${inTests.length} in tests/docs/examples (not counted). Tracked .env files: ${envTracked.length}. ` +
        'This is a heuristic scanner for the working tree only: it does not search git HISTORY. Run gitleaks (or enable GitHub secret scanning with push protection) for history.',
      evidence: [
        ...envTracked.map((f) => ({ file: f.path, line: 1, text: 'tracked .env file' })),
        ...real
          .slice(0, 8)
          .map((h) => ({ file: h.file, line: h.line, text: `${h.pattern}: ${h.masked}` })),
      ],
      data: { scanned, real, inTests: inTests.length },
      confidence: 'runtime-heuristic',
      recommendation:
        real.length || envTracked.length
          ? 'Rotate anything that was ever real, move it to the secret store, and add a gitleaks pre-commit + CI step.'
          : undefined,
    }),
  );
  if (which('gitleaks')) {
    const r = await run(
      'gitleaks',
      [
        'detect',
        '--no-banner',
        '--redact',
        '--report-format',
        'json',
        '--report-path',
        join(tmpdir(), `gitleaks-${process.pid}.json`),
        '--source',
        REPO_ROOT,
      ],
      { timeoutMs: 600000 },
    );
    let findings = [];
    try {
      findings = JSON.parse(readFileSync(join(tmpdir(), `gitleaks-${process.pid}.json`), 'utf8'));
    } catch {
      /* none */
    }
    out.push(
      result({
        id: 'gitleaks',
        controls: ['AUTH-081', 'AUTH-091'],
        title: 'gitleaks (working tree + git history)',
        status: r.code === 0 ? 'pass' : r.code === 1 ? 'fail' : 'error',
        severity: r.code === 1 ? 'high' : undefined,
        summary:
          r.code === 0
            ? 'gitleaks found no leaks in the history.'
            : r.code === 1
              ? `gitleaks reported ${findings.length} leak(s) (values redacted).`
              : `gitleaks failed to run (exit ${r.code}).`,
        evidence: findings
          .slice(0, 6)
          .map((f) => ({ file: f.File, line: f.StartLine, text: `${f.RuleID}` })),
        confidence: 'runtime',
      }),
    );
  } else {
    out.push(
      result({
        id: 'gitleaks',
        controls: [],
        title: 'gitleaks (history scan)',
        status: 'info',
        summary:
          'gitleaks is not installed, so git history was NOT scanned. Install it (winget install gitleaks / brew install gitleaks) or add the gitleaks GitHub Action; the audit picks it up automatically.',
        confidence: 'not-run',
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Semgrep (optional)
// ---------------------------------------------------------------------------------------------------------------------

export async function runSemgrep(ctx) {
  if (!ctx.opts.semgrep) return [];
  if (!which('semgrep')) {
    return [
      result({
        id: 'semgrep',
        controls: ['AUTH-099'],
        title: 'Semgrep SAST',
        status: 'info',
        summary: 'semgrep is not installed (pip install semgrep); skipped.',
        confidence: 'not-run',
      }),
    ];
  }
  const target = ['apps/api/src/modules/auth', 'apps/web/src/lib/auth', 'apps/api/src/realtime']
    .filter(exists)
    .map(abs);
  const r = await run(
    'semgrep',
    [
      'scan',
      '--config',
      'p/typescript',
      '--config',
      'p/jwt',
      '--config',
      'p/security-audit',
      '--json',
      '--quiet',
      ...target,
    ],
    { timeoutMs: 600000 },
  );
  let j;
  try {
    j = JSON.parse(r.stdout);
  } catch {
    return [
      result({
        id: 'semgrep',
        controls: ['AUTH-099'],
        title: 'Semgrep SAST',
        status: 'error',
        summary: `NOT RUN: semgrep produced no JSON (exit ${r.code}); it needs network access for rule packs.`,
        confidence: 'not-run',
      }),
    ];
  }
  const f = (j.results ?? []).map((x) => ({
    file: rel(x.path),
    line: x.start?.line ?? 0,
    text: `${x.check_id.split('.').pop()} — ${(x.extra?.message ?? '').slice(0, 120)}`,
    sev: x.extra?.severity,
  }));
  const high = f.filter((x) => x.sev === 'ERROR');
  return [
    result({
      id: 'semgrep',
      controls: ['AUTH-099'],
      title: 'Semgrep SAST (auth modules)',
      status: high.length ? 'fail' : f.length ? 'partial' : 'pass',
      severity: high.length ? 'high' : f.length ? 'low' : undefined,
      summary: `${f.length} finding(s), ${high.length} at ERROR severity.`,
      evidence: f.slice(0, 8),
      confidence: 'runtime',
    }),
  ];
}

// Re-exported for the orchestrator.
export { existsSync, readdirSync, read };
