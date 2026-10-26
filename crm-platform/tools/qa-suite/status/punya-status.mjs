#!/usr/bin/env node
// Which of an owner's QA items are really done? Computed from the repo, never from the tracking sheet:
//   node tools/qa-suite/status/punya-status.mjs [--reuse] [--out reports/qa-suite/punya-status] [--owner Punya]
// For every item it (1) checks that a script exists, (2) runs that item's QA task (tools/qa-suite) or reads the item's measured artifacts,
// (3) judges the item's own target. The sheet's claimed status is shown next to the computed one only to expose differences.
// Live checks (running API, seeded database) run when their env vars are set (see tools/qa-suite/README.md); without them an item that
// needs a live run is "needs a run", never "done". `--reuse` reads the last results.json instead of running the suite again.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const has = (p) => existsSync(join(ROOT, p));
const json = (p) => (has(p) ? JSON.parse(readFileSync(join(ROOT, p), 'utf8')) : null);

export const VERDICT = {
  done: 'Done',
  needsRun: 'Needs a run',
  open: 'Open findings',
  notBuilt: 'Not built',
};

/** One item's verdict from what is on disk. `target.met` is true / false / null (null: cannot be measured without a live run). */
export function verdictOf({ built, checks = [], target = { met: null } }) {
  if (!built) return 'notBuilt';
  if (checks.some((c) => c.status === 'fail') || target.met === false) return 'open';
  if (target.met === true) return 'done';
  return 'needsRun';
}

const isDone = (verdict) => verdict === 'done';

/** Evidence of items that have no QA task: the scripts, their tests and the artifacts they wrote. */
export function evidenceItems() {
  const soak = json('docs/performance/memory/soak.json');
  const bw = json('perf/results/bandwidth-api-after.json');
  const budgets = json('perf/bandwidth-budgets.json');
  const minutes = soak?.options?.minutes ?? soak?.options?.durationMinutes ?? null;
  const rows = bw?.result ?? [];
  const limit = budgets?.api?.default?.maxBytes ?? 60000;
  const over = rows.filter((r) => r.identityBytes > limit);
  const large = rows.filter((r) => r.identityBytes > (budgets?.api?.compressAboveBytes ?? 1024));
  const uncompressed = large.filter((r) => !r.gzip?.compressed);
  const file = (p) => ({
    title: `${p} ${has(p) ? 'exists' : 'is missing'}`,
    status: has(p) ? 'pass' : 'fail',
  });
  return {
    'Soak testing': {
      built: has('tools/perf/soak.mjs'),
      checks: [
        file('tools/perf/soak.mjs'),
        file('tools/perf/soak.test.mjs'),
        file('.github/workflows/soak.yml'),
        {
          title: soak
            ? `last run: ${soak.samples} samples${minutes ? `, ${minutes} min` : ''}, verdict ${soak.verdict}`
            : 'no soak result committed',
          status: !soak ? 'skip' : soak.verdict === 'GROWTH' ? 'fail' : 'pass',
          evidence: soak?.note ? [soak.note] : [],
        },
      ],
      target: {
        met: !soak
          ? null
          : soak.verdict === 'GROWTH'
            ? false
            : minutes && minutes >= 720
              ? true
              : null,
        text: !soak
          ? 'Harness is built; no result yet. Run: node tools/perf/soak.mjs --minutes 720 (12 h), 1440 before a release.'
          : `Last profile is ${minutes ?? 'a few'} minutes, the target is 12 h regular and 24 h pre-release. Verdict ${soak.verdict}: ${soak.verdict === 'GROWTH' ? 'sustained heap growth was found, open it first' : 'no growth in the profile'}.`,
      },
    },
    'Payload optimization': {
      built: has('tools/perf/bandwidth.mjs'),
      checks: [
        file('tools/perf/bandwidth.mjs'),
        file('perf/bandwidth-budgets.json'),
        {
          title: bw
            ? `${rows.length} endpoints measured; ${over.length} over the ${limit}-byte budget`
            : 'no API payload measurement committed',
          status: !bw ? 'skip' : over.length ? 'fail' : 'pass',
          evidence: over.map((r) => `${r.route}: ${r.identityBytes} bytes`),
        },
        {
          title: has('perf/results/bandwidth-web.json')
            ? 'web bundle sizes measured'
            : 'web bundle sizes not measured',
          status: has('perf/results/bandwidth-web.json') ? 'pass' : 'skip',
        },
      ],
      target: {
        met: !bw
          ? null
          : over.length
            ? false
            : has('perf/results/bandwidth-web.json')
              ? true
              : null,
        text: !bw
          ? 'Harness is built; no measurement yet.'
          : over.length
            ? `${over.length} endpoint(s) over budget.`
            : has('perf/results/bandwidth-web.json')
              ? 'API payloads are inside budget and the web bundle sizes are measured. Whether CI stores the numbers as an artifact is not checked here.'
              : 'API payloads are inside budget; the web bundle half needs `node tools/perf/bandwidth.mjs web --next apps/web/.next`.',
      },
    },
    'Compression validation': {
      built:
        has('tools/perf/bandwidth.mjs') && has('apps/api/src/common/http/response-compression.ts'),
      checks: [
        file('apps/api/src/common/http/response-compression.ts'),
        {
          title: bw
            ? `${large.length - uncompressed.length}/${large.length} responses over ${budgets?.api?.compressAboveBytes ?? 1024} bytes are compressed`
            : 'no API payload measurement committed',
          status: !bw ? 'skip' : uncompressed.length ? 'fail' : 'pass',
          evidence: uncompressed.map((r) => `${r.route}: not compressed`),
        },
      ],
      target: {
        met: !bw ? null : uncompressed.length ? false : null,
        text: !bw
          ? 'Compression middleware exists; no measurement yet.'
          : uncompressed.length
            ? `${uncompressed.length} large response(s) are sent uncompressed.`
            : 'Every measured large response is compressed (brotli/gzip). The p50/p95/p99 baseline + regression budget as a CI artifact is not stored, so the target is not fully met.',
      },
    },
  };
}

/** Artifacts produced outside the QA task that bear on an item (they do not change the verdict; the task's own target decides it). */
export function notesFor(item) {
  const notes = [];
  if (item === 'Slow-query analysis') {
    const q = json('docs/quality/api-inventory/results/query-timings.json');
    if (q) {
      const slow = q.filter((r) => r.meanMs > 50).length;
      notes.push(
        `pg_stat_statements capture committed (docs/quality/api-inventory): ${q.length} statements, ${slow} with a mean over 50 ms.`,
      );
    }
  }
  if (item === 'Stress testing') {
    notes.push(
      has('tools/perf/stress-ramp.mjs')
        ? 'tools/perf/stress-ramp.mjs (closed-loop ramp) exists; no result is committed, and "2x the expected production peak" needs that peak (QA_PEAK_RPS) to be set.'
        : 'no ramp script',
    );
  }
  return notes;
}

const RERUN_EXTRA = {
  'Soak testing': 'node tools/perf/soak.mjs --minutes 720',
  'Payload optimization':
    'node tools/perf/bandwidth.mjs api --token T --check; node tools/perf/bandwidth.mjs web --next apps/web/.next --check',
  'Compression validation': 'node tools/perf/bandwidth.mjs api --token T --check',
};

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

export function render(rows, meta) {
  const count = (v) => rows.filter((r) => r.verdict === v).length;
  const pending = rows.filter((r) => !isDone(r.verdict));
  const differs = pending.filter((r) => r.claimed === 'Completed');
  const css = `<style>:root{--bg:#fff;--fg:#1a1a1a;--mut:#666;--bd:#ddd;--hd:#f3f4f6;--bad:#b3261e;--ok:#1b7f3b;--warn:#9a6700}
@media(prefers-color-scheme:dark){:root{--bg:#15171a;--fg:#e8e8e8;--mut:#9aa;--bd:#333;--hd:#20242a;--bad:#ff8a80;--ok:#7ddc9a;--warn:#e3b341}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0 auto;max-width:1100px;padding:16px}h1{font-size:24px}h2{font-size:18px;margin-top:26px}
table{border-collapse:collapse;width:100%;font-size:13px;display:block;overflow-x:auto}th,td{border:1px solid var(--bd);padding:5px 8px;text-align:left;vertical-align:top}th{background:var(--hd)}
.done{color:var(--ok);font-weight:600}.open{color:var(--bad);font-weight:600}.needsRun{color:var(--warn);font-weight:600}.notBuilt{color:var(--bad);font-weight:600}.mut{color:var(--mut)}
.card{border:1px solid var(--bd);border-radius:8px;padding:10px 14px;margin:10px 0}code{font:12px ui-monospace,monospace}ul{margin:2px 0;padding-left:18px}</style>`;
  const reasons = (r) =>
    `<div>${esc(r.targetText)}</div>` +
    (r.failing.length
      ? `<ul>${r.failing
          .map(
            (f) =>
              `<li><b>${esc(f.title)}</b>${(f.evidence ?? [])
                .slice(0, 3)
                .map((e) => `<br><code>${esc(e)}</code>`)
                .join('')}</li>`,
          )
          .join('')}</ul>`
      : '') +
    (r.skipped
      ? `<div class="mut">${r.skipped} check(s) skipped: they need a live stack (see how to rerun).</div>`
      : '');
  const table = (list) =>
    list.length
      ? `<table><tr><th>Item</th><th>Computed</th><th>Sheet says</th><th>Target</th><th>Why / evidence</th><th>How to rerun</th></tr>${list
          .map(
            (r) =>
              `<tr><td>${esc(r.item)}</td><td class="${r.verdict}">${esc(VERDICT[r.verdict])}</td><td>${esc(r.claimed)}${r.claimed === 'Completed' && !isDone(r.verdict) ? ' <span class="open">(differs)</span>' : ''}</td><td>${esc(r.target)}${r.runAt ? `<br><span class="mut">result of run ${esc(r.runAt)}</span>` : ''}</td><td>${reasons(r)}</td><td><code>${esc(r.rerun)}</code></td></tr>`,
          )
          .join('')}</table>`
      : '<p class="mut">None.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(meta.owner)} QA status</title>${css}</head><body>
<h1>${esc(meta.owner)}: what is really done (computed from the repo)</h1>
<p class="mut">Commit ${esc(meta.commit)}, ${esc(meta.generatedAt)}. Statuses come from running the scripts, not from the tracking sheet. ${meta.live ? 'Live env detected: live checks ran.' : 'No live env: static checks only; live checks show as "needs a run".'}</p>
<div class="card"><b>${rows.length} items.</b> <span class="done">${count('done')} done</span> · <span class="needsRun">${count('needsRun')} need a run</span> · <span class="open">${count('open')} have open findings</span> · <span class="notBuilt">${count('notBuilt')} not built</span>.
<br><b>Pending (not done): ${pending.length}.</b> The sheet marks <b>${differs.length}</b> of them "Completed".</div>
<h2>Pending items</h2>${table(pending)}
<h2>Done items</h2>${table(rows.filter((r) => isDone(r.verdict)))}</body></html>`;
}

/** Each task's newest stored result (reports/qa-suite/<timestamp>/results.json), so a live run of a few tasks does not hide the rest. */
export function latestPerTask(dir = join(ROOT, 'reports/qa-suite')) {
  const byTask = new Map();
  const runs = existsSync(dir)
    ? readdirSync(dir)
        .filter((d) => /^\d{4}-\d\d-\d\dT/.test(d))
        .sort()
        .reverse()
    : [];
  for (const run of runs) {
    const file = join(dir, run, 'results.json');
    if (!existsSync(file)) continue;
    const res = JSON.parse(readFileSync(file, 'utf8'));
    for (const r of res.results) {
      if (!byTask.has(r.task.id))
        byTask.set(r.task.id, {
          ...r,
          runAt: run,
          live: !!res.meta?.live?.db || !!res.meta?.live?.api,
        });
    }
  }
  return byTask;
}

const OWN_FLAGS = new Set(['--reuse', '--out', '--owner']);

function main() {
  const owner = arg('--owner', 'Punya');
  const items = json('tools/qa-suite/status/sheet-claims.json').items;
  if (!process.argv.includes('--reuse')) {
    // every other flag (--run-unit, --stress, ...) goes to the suite; its env (API_URL, DATABASE_URL, ...) decides whether live checks run
    const raw = process.argv.slice(2);
    const pass = raw.filter((a, i) => !OWN_FLAGS.has(a) && !OWN_FLAGS.has(raw[i - 1]));
    const ids = [...new Set(items.map((i) => i.task).filter((t) => t != null))];
    spawnSync('node', [join(ROOT, 'tools/qa-suite/run.mjs'), ...ids.map(String), ...pass], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });
  }
  const byTask = latestPerTask();
  if (!byTask.size) throw new Error('no stored QA results: run without --reuse first');
  const res = json('reports/qa-suite/latest/results.json');
  const extra = evidenceItems();
  const rows = items.map((i) => {
    const r = i.task != null ? byTask.get(i.task) : undefined;
    const e = extra[i.item];
    const checks = r?.checks ?? e?.checks ?? [];
    const target = r?.target ?? e?.target ?? { met: null, text: 'no script found for this item' };
    const built = i.task != null ? !!r : !!e?.built;
    return {
      item: i.item,
      claimed: i.claimed,
      target: i.target,
      verdict: verdictOf({ built, checks, target }),
      targetText: target.text ?? '',
      notes: notesFor(i.item),
      runAt: r?.runAt ?? null,
      failing: checks.filter((c) => c.status === 'fail'),
      skipped: checks.filter((c) => c.status === 'skip').length,
      rerun: i.task != null ? `pnpm qa ${i.task}` : (RERUN_EXTRA[i.item] ?? ''),
    };
  });
  const meta = {
    owner,
    commit: res?.meta?.commit ?? '?',
    generatedAt: new Date().toISOString(),
    live: !!process.env.API_URL || !!process.env.DATABASE_URL,
  };
  const out = resolve(ROOT, arg('--out', 'reports/qa-suite/punya-status'));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'index.html'), render(rows, meta));
  writeFileSync(join(out, 'status.json'), JSON.stringify({ meta, rows }, null, 2));
  console.log(`\n${'Item'.padEnd(30)}${'Computed'.padEnd(16)}Sheet`);
  for (const r of rows)
    console.log(
      `${r.item.padEnd(30)}${VERDICT[r.verdict].padEnd(16)}${r.claimed}${r.claimed === 'Completed' && !isDone(r.verdict) ? '   <- differs' : ''}`,
    );
  const pending = rows.filter((r) => !isDone(r.verdict)).length;
  console.log(
    `\n${rows.length - pending} done, ${pending} pending. Report: ${join(out, 'index.html')}`,
  );
  process.exitCode = pending ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
