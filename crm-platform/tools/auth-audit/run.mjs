#!/usr/bin/env node
// Authentication audit: one command, one report.
//
//   pnpm audit:auth                      quick run: static + runtime probes + auth unit tests + deps + secrets
//   pnpm audit:auth -- --full            also integration + e2e suites (needs Docker) and the web auth feature tests
//   pnpm audit:auth -- --live --org acme --email dev@acme.test --password '…'   attack a running LOCAL API
//   pnpm audit:auth -- --install         first install + build the workspace if that has not been done
//
// Output: reports/auth-audit/<timestamp>/report.html (+ report.md, results.json, findings.json, controls.csv,
// tests.json, manifest.json) and a copy in reports/auth-audit/latest/. See tools/auth-audit/README.md.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runLiveProbes } from './lib/checks-live.mjs';
import { STATIC_CHECKS } from './lib/checks-static.mjs';
import {
  childEnv,
  detectEnvironment,
  runDependencyAudit,
  runPureProbes,
  runSecretScan,
  runSemgrep,
  runTestSuites,
  testEvidenceByControl,
} from './lib/checks-runtime.mjs';
import { routeKey, scanRoutes, scanTests } from './lib/inventory.mjs';
import { buildModel, loadDecisions } from './lib/model.mjs';
import { publishLatest, writeReports } from './lib/report.mjs';
import { REPO_ROOT, ROOT, TOOL_DIR, fmtMs, log, result, run } from './lib/util.mjs';

const HELP = `
Authentication audit — one command, one report.

  node tools/auth-audit/run.mjs [options]        (or: pnpm audit:auth -- [options])

  --full                 also run integration + e2e suites (Docker required) and all web auth tests
  --live [url]           attack a running API (default http://localhost:3000). Local hosts only.
  --org <slug> --email <e> --password <p>
                         dev credentials for the authenticated live probes
                         (or AUTH_AUDIT_ORG / AUTH_AUDIT_EMAIL / AUTH_AUDIT_PASSWORD)
  --allow-remote         permit a non-local --live target (never use on production)
  --install              pnpm install + build the workspace packages if they are missing
  --no-tests             skip the existing test suites
  --skip-deps            skip pnpm audit        --skip-secrets  skip the secret scan
  --semgrep              run semgrep if installed
  --update-baseline      record the current public routes as the reviewed baseline
  --out <dir>            report folder (default reports/auth-audit/<timestamp>)
  --strict               exit non-zero on CONDITIONAL as well as NO-GO
  -h, --help

Exit code: 0 GO (or CONDITIONAL), 20 NO-GO, 10 CONDITIONAL with --strict.
`;

function parseArgs(argv) {
  const o = { full: false, live: null, tests: true, deps: true, secrets: true };
  const take = (i) => (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--full') o.full = true;
    else if (a === '--live') {
      o.live = take(i) ?? process.env.AUTH_AUDIT_API ?? 'http://localhost:3000';
      if (take(i)) i++;
    } else if (a === '--org') o.org = argv[++i];
    else if (a === '--email') o.email = argv[++i];
    else if (a === '--password') o.password = argv[++i];
    else if (a === '--allow-remote') o.allowRemote = true;
    else if (a === '--install') o.install = true;
    else if (a === '--no-tests') o.tests = false;
    else if (a === '--skip-deps') o.skipDeps = true;
    else if (a === '--skip-secrets') o.secrets = false;
    else if (a === '--semgrep') o.semgrep = true;
    else if (a === '--update-baseline') o.updateBaseline = true;
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--strict') o.strict = true;
    else {
      console.error(`Unknown option: ${a}\n${HELP}`);
      process.exit(2);
    }
  }
  return o;
}

async function git(args) {
  const r = await run('git', args, { cwd: REPO_ROOT, timeoutMs: 30000 });
  return r.code === 0 ? r.stdout.trim() : null;
}

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  const startedAt = Date.now();
  console.log('\x1b[1mAuthentication audit\x1b[0m  (crm-platform)');

  // ---- environment ----------------------------------------------------------------------------------------------
  log.step('Environment');
  let env = detectEnvironment();
  if (opts.install && (!env.dependenciesInstalled || !env.packagesBuilt)) {
    log.info('installing dependencies and building workspace packages (first run only)…');
    const e = childEnv();
    if (!env.dependenciesInstalled) {
      const r = await run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], {
        env: e,
        timeoutMs: 1200000,
        tee: false,
      });
      if (r.code !== 0)
        log.bad(
          `pnpm install failed (exit ${r.code}): ${r.stderr.split('\n').slice(-3).join(' ')}`,
        );
    }
    for (const pkg of ['@crm/tax', '@crm/contracts', '@crm/db']) {
      const r = await run('pnpm', ['--filter', pkg, 'build'], { env: e, timeoutMs: 600000 });
      if (r.code !== 0) log.bad(`build ${pkg} failed (exit ${r.code})`);
    }
    env = detectEnvironment();
  }
  log.info(
    `node ${env.node} · ${env.platform} · pnpm ${env.pnpm} · deps ${env.dependenciesInstalled ? 'installed' : 'MISSING'} · packages ${env.packagesBuilt ? 'built' : 'NOT built'} · docker ${env.docker} · gitleaks ${env.gitleaks} · semgrep ${env.semgrep} · k6 ${env.k6}`,
  );
  if (!env.dependenciesInstalled)
    log.warn(
      'Dependencies are not installed: runtime probes and test suites will be reported as NOT RUN. Re-run with --install.',
    );

  const gitInfo = {
    commit: await git(['rev-parse', 'HEAD']),
    branch: await git(['rev-parse', '--abbrev-ref', 'HEAD']),
    dirty: Boolean(await git(['status', '--porcelain'])),
  };

  // ---- inventories and decisions ------------------------------------------------------------------------------------
  log.step('Inventory');
  const routes = scanRoutes();
  const publicList = routes.filter((r) => r.public).map(routeKey);
  log.info(`${routes.length} routes, ${publicList.length} public`);
  const baselinePath = join(TOOL_DIR, 'baseline', 'public-routes.json');
  if (opts.updateBaseline) {
    mkdirSync(join(TOOL_DIR, 'baseline'), { recursive: true });
    writeFileSync(
      baselinePath,
      JSON.stringify(
        {
          recordedAt: new Date().toISOString(),
          commit: gitInfo.commit,
          note: 'Snapshot of the @Public routes accepted by a human on recordedAt. Routes under auth/, platform/auth, account and realtime were read individually in the 2026-10-09 analysis; the rest were recorded as found. A NEW public route fails the audit until someone reviews it and re-records this file (pnpm audit:auth -- --update-baseline).',
          publicRoutes: publicList,
        },
        null,
        2,
      ) + '\n',
    );
    log.ok(
      `baseline recorded: ${publicList.length} public routes -> tools/auth-audit/baseline/public-routes.json`,
    );
  }
  const baseline = readJson(baselinePath);
  const decisionsRaw = readJson(join(TOOL_DIR, 'decisions.json'));
  const decisions = loadDecisions(decisionsRaw);
  const testInventory = scanTests();
  log.info(
    `${testInventory.length} auth-related test files, ${testInventory.reduce((a, f) => a + f.declared, 0)} declared tests; ${Object.keys(decisions.applied).length} recorded decision(s)`,
  );

  const ctx = { opts, env, routes, baseline };
  const results = [];
  const add = (r) => (Array.isArray(r) ? r : [r]).filter(Boolean).forEach((x) => results.push(x));

  // ---- static checks ----------------------------------------------------------------------------------------------
  log.step(`Static checks (${STATIC_CHECKS.length})`);
  for (const c of STATIC_CHECKS) {
    try {
      add(await c.run(ctx));
    } catch (e) {
      add(
        result({
          id: c.id,
          title: c.id,
          controls: [],
          status: 'error',
          summary: `Check crashed: ${e?.message ?? e}`,
          confidence: 'not-run',
        }),
      );
    }
  }
  const sv = (s) => results.filter((r) => r.status === s).length;
  log.info(
    `pass ${sv('pass')} · fail ${sv('fail')} · partial ${sv('partial')} · needs decision ${sv('policy')} · not implemented ${sv('not-implemented')} · errors ${sv('error')}`,
  );

  // ---- runtime probes ---------------------------------------------------------------------------------------------
  log.step("Runtime probes of the product's security functions");
  add(await runPureProbes(ctx));
  results
    .filter((r) => r.id.startsWith('probe-'))
    .forEach((r) =>
      r.status === 'pass'
        ? log.ok(r.title)
        : r.status === 'error'
          ? log.warn(`${r.title}: not run`)
          : log.bad(`${r.title}: ${r.summary.slice(0, 160)}`),
    );

  // ---- tests ------------------------------------------------------------------------------------------------------
  let testSummaries = [];
  if (opts.tests) {
    log.step(`Existing test suites${opts.full ? ' (full)' : ' (quick)'}`);
    const t = await runTestSuites(ctx);
    add(t.results);
    testSummaries = t.summaries;
    for (const s of testSummaries)
      (s.ran ? (s.failed ? log.bad : log.ok) : log.warn)(
        s.ran
          ? `${s.label}: ${s.passed}/${s.total} passed, ${s.failed} failed, ${s.skipped} skipped (${fmtMs(s.ms)})`
          : `${s.label}: not run — ${s.reason}`,
      );
    t.results.filter((r) => r.status === 'error').forEach((r) => log.warn(r.summary));
  } else {
    log.step('Existing test suites');
    log.warn('skipped (--no-tests): reported as NOT RUN');
    add(
      result({
        id: 'tests-skipped',
        controls: ['AUTH-099'],
        title: 'Existing authentication test suites',
        status: 'error',
        summary: 'NOT RUN: --no-tests.',
        confidence: 'not-run',
      }),
    );
  }

  // ---- dependencies and secrets --------------------------------------------------------------------------------------
  log.step('Dependencies');
  opts.skipDeps = opts.skipDeps ?? false;
  const dep = await runDependencyAudit(ctx);
  add(dep);
  dep.forEach((r) =>
    r.status === 'error'
      ? log.warn(r.summary)
      : (r.status === 'pass' ? log.ok : log.warn)(r.summary.slice(0, 200)),
  );

  if (opts.secrets) {
    log.step('Secret scan');
    const sec = await runSecretScan(ctx);
    add(sec);
    sec.forEach((r) =>
      (r.status === 'pass'
        ? log.ok
        : r.status === 'info' || r.status === 'error'
          ? log.warn
          : log.bad)(r.summary.slice(0, 220)),
    );
  }
  if (opts.semgrep) add(await runSemgrep(ctx));

  // ---- live ---------------------------------------------------------------------------------------------------------
  if (opts.live) {
    log.step(`Live probes -> ${opts.live}`);
    const live = await runLiveProbes(ctx);
    add(live);
    live.forEach((r) =>
      (r.status === 'pass'
        ? log.ok
        : r.status === 'info'
          ? log.info
          : r.status === 'error'
            ? log.warn
            : log.bad)(`${r.title}: ${r.summary.slice(0, 170)}`),
    );
  } else {
    add(
      result({
        id: 'live-probes',
        controls: [],
        title: 'Live probes against a running API',
        status: 'error',
        summary:
          'NOT RUN: pass --live (with --org/--email/--password for the authenticated probes) while a local API is running. These probes are what confirm logout/refresh-reuse revocation, enumeration/timing parity, lockout and the WebSocket handshake at runtime.',
        confidence: 'not-run',
      }),
    );
  }

  // ---- report ---------------------------------------------------------------------------------------------------------
  log.step('Report');
  const finishedAt = Date.now();
  const model = buildModel({
    results,
    testSummaries,
    testEvidence: testEvidenceByControl(testSummaries),
    decisions,
    env,
    opts,
    startedAt,
    finishedAt,
    git: gitInfo,
    routes: {
      total: routes.length,
      controllers: new Set(routes.map((r) => r.controller)).size,
      publicList,
    },
    testInventory,
  });
  const stamp = new Date(finishedAt)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+/, '')
    .replace('T', '-');
  const reportsRoot = resolve(ROOT, 'reports', 'auth-audit');
  const outDir = resolve(ROOT, opts.out ?? join('reports', 'auth-audit', stamp));
  const written = writeReports(model, outDir);
  const latest = opts.out ? null : publishLatest(reportsRoot, outDir);

  const v = model.verdict;
  const col = v.value === 'GO' ? '\x1b[32m' : v.value === 'CONDITIONAL' ? '\x1b[33m' : '\x1b[31m';
  console.log(`\n${col}\x1b[1m  VERDICT: ${v.value}\x1b[0m`);
  for (const r of v.reasons) console.log(`   - ${r}`);
  const sev = model.metrics.openBySeverity;
  const p0 = model.metrics.priority.P0;
  console.log(
    `   open findings: ${sev.critical} critical · ${sev.high} high · ${sev.medium} medium · ${sev.low} low   |   P0 controls pass/accepted: ${p0.PASS + p0.ACCEPTED}/${p0.applicable}   |   not assessed: ${model.controls.filter((c) => c.status === 'NOT-ASSESSED').length}`,
  );
  console.log(`\n   HTML report : ${join(outDir, 'report.html')}`);
  console.log(`   Markdown    : ${join(outDir, 'report.md')}`);
  if (latest) console.log(`   Latest copy : ${join(latest, 'report.html')}`);
  console.log(`   finished in ${fmtMs(finishedAt - startedAt)}\n`);
  void written;
  return v.value === 'NO-GO' ? 20 : v.value === 'CONDITIONAL' && opts.strict ? 10 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error('\nAudit crashed:', e);
    process.exit(1);
  },
);
