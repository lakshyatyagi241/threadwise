#!/usr/bin/env node
// Twin run: the same scenarios on Reference and on our platform, then the comparison.
//
//   node run.mjs <spec.twin.mjs> [more specs...] [options]
//
//   --depth quick|standard|full   how many edge cases per field (default full, env PARITY_DEPTH)
//   --only <regex|tag:name>       run only matching scenario ids / tags
//   --skip <regex>                leave out matching scenario ids
//   --sides threadwise,ours           default both; "threadwise" alone is an A/A sanity run of the reference
//   --into <runDir>               write into an existing run (re-run subset after a fix, then compare again)
//   --list                        print the scenario matrix and exit
//   --workers N                   scenarios in parallel per side (default 2; env PARITY_WORKERS)
//   --teardown-only               skip scenarios, only delete the test data a spec created (after an aborted run)
//   --no-teardown                 leave the test data in place
//   --trace                       keep Playwright traces for scenarios that error
//   --headed                      show the browsers
//
// Exit codes: 0 no defects, 1 defects/review items, 2 bad usage or bad spec, 3 environment not ready.
import { chromium } from 'playwright';
import { join, resolve } from 'node:path';
import { loadConfig } from './lib/config.mjs';
import { loadSpec } from './lib/spec.mjs';
import { createSides } from './lib/sides.mjs';
import { runSide, runTeardown } from './lib/runner.mjs';
import { mutationsFromEnv } from './lib/mutants.mjs';
import { compareRun } from './lib/compare.mjs';
import { ensureDir, writeJson, readJson, parseArgs, shortId, slug } from './lib/util.mjs';

const args = parseArgs(process.argv.slice(2), {
  depth: 'str',
  only: 'str',
  skip: 'str',
  sides: 'str',
  into: 'str',
  list: 'bool',
  trace: 'bool',
  headed: 'bool',
  limit: 'str',
  'no-teardown': 'bool',
  'teardown-only': 'bool',
  workers: 'str',
});
if (!args._.length) {
  console.error(
    'usage: node run.mjs <spec.twin.mjs>... [--depth quick|standard|full] [--only REGEX|tag:X] [--skip REGEX] [--sides threadwise,ours] [--into RUNDIR] [--list] [--trace] [--headed]',
  );
  process.exit(2);
}
if (args.headed) process.env.PARITY_HEADED = '1';
const cfg = loadConfig();
if (args.depth) cfg.depth = args.depth;

const log = (m) => process.stdout.write(m + '\n');
// A stray rejection inside one scenario must not kill a long run: log it, the scenario's own result carries the error.
process.on('unhandledRejection', (e) =>
  log(
    `  (unhandled rejection ignored: ${String(e?.message || e)
      .split('\n')[0]
      .slice(0, 160)})`,
  ),
);
const ping = async (url) => {
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    return r.status;
  } catch {
    return 0;
  }
};

// ---- load specs ---------------------------------------------------------------------------------------------
const files = args._.map((f) => resolve(f));
const specs = [];
try {
  for (const f of files) specs.push(await loadSpec(f, cfg, { depth: cfg.depth }));
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
let scenarios = specs.flatMap((s) => s.scenarios.map((sc) => ({ ...sc, __spec: s })));
if (args.only) {
  const tag = String(args.only).startsWith('tag:') ? String(args.only).slice(4) : null;
  const rx = tag ? null : new RegExp(args.only);
  scenarios = scenarios.filter((s) => (tag ? (s.tags || []).includes(tag) : rx.test(s.id)));
}
if (args.skip) scenarios = scenarios.filter((s) => !new RegExp(args.skip).test(s.id));
if (args.limit) scenarios = scenarios.slice(0, Number(args.limit));

if (args.list) {
  const fam = {};
  for (const s of scenarios)
    fam[s.id.split('.').slice(0, 2).join('.')] =
      (fam[s.id.split('.').slice(0, 2).join('.')] || 0) + 1;
  for (const s of scenarios) log(s.id);
  log(
    `\n${scenarios.length} scenarios (${specs.map((s) => s.feature).join(', ')}) at depth ${cfg.depth}`,
  );
  log(
    Object.entries(fam)
      .map(([k, v]) => `${k}:${v}`)
      .join('  '),
  );
  process.exit(0);
}
if (!scenarios.length) {
  console.error('no scenarios match');
  process.exit(2);
}

// ---- environment preflight -----------------------------------------------------------------------------------
const wanted = (args.sides || 'threadwise,ours').split(',').map((s) => s.trim());
const problems = [];
if (wanted.includes('threadwise')) {
  const st = await ping(cfg.threadwise.baseUrl + '/');
  if (![200, 301, 302].includes(st))
    problems.push(
      `Reference reference is not answering at ${cfg.threadwise.baseUrl} (got ${st || 'no response'}). Start it: bash .claude/skills/threadwise-run-reference/scripts/start.sh`,
    );
}
if (wanted.includes('ours') && !process.env.PARITY_AA) {
  const needsApi = scenarios.some((s) => s.api);
  if (cfg.ours.webUrl) {
    const st = await ping(cfg.ours.webUrl + '/');
    if (!st || st >= 500)
      problems.push(
        `our web app is configured at ${cfg.ours.webUrl} but is not answering (${st || 'no response'}). Start it: bash .claude/skills/threadwise-playwright-parity/scripts/env.sh up`,
      );
  }
  if (needsApi || cfg.ours.webUrl) {
    const st = await ping(cfg.ours.apiUrl + '/health');
    if (st !== 200)
      problems.push(
        `our API is not healthy at ${cfg.ours.apiUrl}/health (got ${st || 'no response'}). Start it: bash .claude/skills/threadwise-playwright-parity/scripts/env.sh up`,
      );
  }
}
if (problems.length) {
  console.error('ENVIRONMENT NOT READY:\n- ' + problems.join('\n- '));
  process.exit(3);
}

// ---- run -----------------------------------------------------------------------------------------------------
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const runDir = resolve(args.into || join(cfg.outRoot, `${slug(specs[0].feature)}-${stamp}`));
ensureDir(runDir);
const prior = readJson(join(runDir, 'run-meta.json'));
const meta = {
  startedAt: new Date().toISOString(),
  depth: cfg.depth,
  sides: wanted,
  specs: [...new Set([...(prior?.specs || []), ...files])],
  urls: {
    threadwise: cfg.threadwise.baseUrl,
    ours: cfg.ours.webUrl || '(no web app)',
    api: cfg.ours.apiUrl,
  },
  tagBase: prior?.tagBase || `pwp-${shortId()}`,
  reruns: (prior?.reruns || 0) + (prior ? 1 : 0),
};
writeJson(join(runDir, 'run-meta.json'), meta);
log(`run dir: ${runDir}`);
log(
  `${scenarios.length} scenarios, depth ${cfg.depth}, sides ${wanted.join('+')}, test-data prefix ${meta.tagBase}`,
);

const browser = await chromium.launch({ headless: cfg.headless, slowMo: cfg.slowMo });
const sides = createSides({ cfg, browser, runDir, sides: wanted, mutations: mutationsFromEnv() });
const skips = specs.flatMap((s) => s.skip);
const t0 = Date.now();
try {
  await Promise.all(
    Object.values(sides).map(async (side) => {
      if (!args['teardown-only'])
        await runSide({
          side,
          scenarios,
          cfg,
          runDir,
          tagBase: meta.tagBase,
          skips,
          log,
          trace: !!args.trace,
          workers: Number(args.workers || process.env.PARITY_WORKERS || 2),
        });
      if (!args['no-teardown'])
        await runTeardown({ side, specs, cfg, runDir, tagBase: meta.tagBase, log });
    }),
  );
} finally {
  for (const s of Object.values(sides)) await s.close().catch(() => {});
  await browser.close().catch(() => {});
}
log(`executed in ${Math.round((Date.now() - t0) / 1000)} s`);

if (args['teardown-only']) process.exit(0);

// ---- compare ---------------------------------------------------------------------------------------------------
const res = await compareRun(runDir, cfg);
const s = res.summary;
log('');
log(
  `VERDICT ${res.verdict}: same ${s.same}, intended ${s.intended}, DEFECT ${s.defect} in ${s.defectScenarios} scenario(s) (blocker ${s.defectScenariosBySeverity.blocker}, major ${s.defectScenariosBySeverity.major}, minor ${s.defectScenariosBySeverity.minor}), review ${s.review}, skipped ${s.skipped}, spec-issue ${s['spec-issue']}`,
);
log(`report:   ${join(runDir, 'report.md')}`);
log(`clusters: ${join(runDir, 'clusters.json')}  (${res.clusters.length})`);
log(`gallery:  ${join(runDir, 'gallery.html')}`);
process.exit(s.defect || s.review ? 1 : 0);
