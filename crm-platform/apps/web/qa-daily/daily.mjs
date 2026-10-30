// The daily functional QA run. One command, one target:
//   node qa-daily/daily.mjs --target prod|local [--no-crawl] [--fix] [--max-fix 3] [--verify-only]
// Order: probe the site -> re-check yesterday's fixes (and take the "after" screenshot) -> run the journeys (+ page crawl) ->
// report new bugs to the Google Sheet -> (--fix) fix the most severe open ones, PR, merge when the guards allow.
// Secrets only come from the environment: QA_SHEET_URL, QA_SHEET_TOKEN, QA_EMAIL/QA_PASSWORD/QA_OP_EMAIL/QA_OP_PASSWORD (prod).
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { WEB, OUT, DATE, log, tryRun, probe, targetConfig, readJson, writeJson } from './lib.mjs';
import { call } from './sheet.mjs';
import { recheck, bugPath } from './recheck.mjs';
import { fixBug } from './fix.mjs';

const arg = (n, d) =>
  process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d;
const flag = (n) => process.argv.includes(`--${n}`);
const target = arg('target', 'local');
const cfg = targetConfig(target);
const maxFix = Number(arg('max-fix', process.env.AUTOFIX_MAX ?? 3));
const summary = { date: DATE, target, steps: [] };
const note = (step, detail) => {
  summary.steps.push({ step, ...detail });
  log(step, JSON.stringify(detail));
};

const missing = cfg.need.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`missing environment: ${missing.join(', ')}`);
  process.exit(2);
}

// 0. is the site up at all?
const p = await probe(cfg.base);
if (!p.up) {
  note('site-down', { why: p.why });
  await call('log', { date: DATE, env: target, status: 'site down', detail: p.why }).catch(
    () => undefined,
  );
  writeJson(join(OUT, `summary-${target}.json`), summary);
  process.exit(3); // an outage is for monitoring to report; it must not file a bug per journey
}

// 1. fixes that were merged earlier: still fixed on this target?
const verified = [];
const { rows = [] } = await call('fixed', { env: target }).catch(() => ({ rows: [] }));
for (const row of rows) {
  writeJson(bugPath(row.ID), row);
  const r = await recheck(row, { target });
  if (r.code === 0) {
    const after = r.proof && existsSync(r.proof) ? readFileSync(r.proof).toString('base64') : '';
    await call('resolve', {
      id: row.ID,
      status: 'Verified',
      note: `re-checked ${DATE} on ${target}: passes`,
      afterImageB64: after,
    });
    verified.push(row.ID);
  } else if (r.code === 1) {
    const tries = Number(row.Attempts || 1) + 1;
    await call('resolve', {
      id: row.ID,
      status: tries > 2 ? 'Needs human' : 'Open',
      note: `still failing on ${target} on ${DATE} after the fix (attempt ${tries - 1}): ${r.message}`,
    });
  } // code 2: not decidable today; leave it for tomorrow
}
note('verify', { checked: rows.length, verified: verified.length });
if (flag('verify-only')) {
  writeJson(join(OUT, `summary-${target}.json`), summary);
  process.exit(0);
}

// 2. the journeys, then the page crawl
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const env = {
  ...process.env,
  HEADLESS: '1',
  CHROMIUM_PATH: process.env.CHROMIUM_PATH ?? (existsSync(CHROME) ? CHROME : undefined), // a machine without the matching Playwright browser build
  QA_TARGET: target,
  QA_BASE_URL: cfg.base,
  E2E_ADMIN_EMAIL: process.env.QA_EMAIL,
  E2E_PASSWORD: process.env.QA_PASSWORD,
  E2E_OPERATOR_EMAIL: process.env.QA_OP_EMAIL,
  E2E_OPERATOR_PASSWORD: process.env.QA_OP_PASSWORD,
  E2E_ORG: process.env.QA_ORG,
  WEB_URL: cfg.base,
};
const live = tryRun(
  'pnpm',
  ['exec', 'playwright', 'test', '-c', 'qa-daily/playwright.live.config.ts'],
  { cwd: WEB, env: { ...env, PW_JSON: join(OUT, 'live-results.json') }, timeout: 90 * 60_000 },
);
note('journeys', { exit: live.status });
const rep = tryRun(
  'node',
  ['qa-daily/report.mjs', join(OUT, 'live-results.json'), '--env', target],
  { cwd: WEB },
);
note('report', { exit: rep.status, tail: rep.out.trim().split('\n').slice(-1)[0] });
if (existsSync(join(OUT, DATE, 'bugs.json')))
  renameSync(join(OUT, DATE, 'bugs.json'), join(OUT, DATE, 'bugs-live.json')); // the crawl writes bugs.json too
if (!flag('no-crawl')) {
  tryRun('node', ['qa-daily/gen-feature.mjs'], { cwd: WEB });
  const crawl = tryRun(
    'pnpm',
    ['exec', 'playwright', 'test', '-c', 'qa-daily/playwright.config.ts'],
    { cwd: WEB, env, timeout: 60 * 60_000 },
  );
  note('crawl', { exit: crawl.status });
}
// journey bugs and crawler bugs are two files; push each that exists
for (const f of [join(OUT, DATE, 'bugs-live.json'), join(OUT, DATE, 'bugs.json')])
  if (existsSync(f))
    tryRun('node', ['qa-daily/sheet.mjs', 'push', f, '--env', target], {
      cwd: WEB,
      stdio: 'inherit',
    });

// 3. fix, PR, merge
const fixed = [];
if (flag('fix')) {
  // a local run tested the stack it found; the fixer builds and starts its own on the same ports
  if (target === 'local') tryRun('bash', ['qa-daily/stack.sh', 'down'], { cwd: WEB });
  const { bugs = [] } = await call('open', { limit: maxFix, env: target });
  for (const b of bugs) fixed.push(await fixBug(b));
  note('fix', { tried: bugs.length, results: fixed.map((f) => `${f.id}:${f.status}`) });
}

// 4. one line per day in the sheet's Runs tab
const s = await call('summary', {}).catch(() => null);
await call('log', {
  date: DATE,
  env: target,
  status: 'ok',
  detail: JSON.stringify({
    journeysExit: live.status,
    verified: verified.length,
    fixed: fixed.map((f) => f.status),
    sheet: s?.byStatus,
  }),
}).catch(() => undefined);
writeJson(join(OUT, `summary-${target}.json`), summary);
log('done');
