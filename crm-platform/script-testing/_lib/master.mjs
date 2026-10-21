#!/usr/bin/env node
// Master runner. Usage: run-all.sh [--list] [--only a,b] [--skip heavy,x] [--quick|--full] [--jobs N] [--out DIR] [--fail-fast] [--no-precheck] [--self-test]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ST_DIR ? path.resolve(process.env.ST_DIR) : path.resolve(HERE, '..');
const REPO = path.resolve(HERE, '../..');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function discover(root = ROOT) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && fs.existsSync(path.join(root, d.name, 'meta.json')))
    .map((d) => ({ name: d.name, dir: path.join(root, d.name), ...JSON.parse(fs.readFileSync(path.join(root, d.name, 'meta.json'), 'utf8')) }))
    .sort((a, b) => (a.sheetItem ?? 999) - (b.sheetItem ?? 999) || a.name.localeCompare(b.name));
}

export function parseArgs(argv) {
  const o = { mode: 'full', jobs: 2, only: [], skip: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') o.list = true;
    else if (a === '--quick') o.mode = 'quick';
    else if (a === '--full') o.mode = 'full';
    else if (a === '--fail-fast') o.failFast = true;
    else if (a === '--no-precheck') o.noPrecheck = true;
    else if (a === '--self-test') o.selfTest = true;
    else if (a === '--only') o.only = argv[++i].split(',').filter(Boolean);
    else if (a === '--skip') o.skip = argv[++i].split(',').filter(Boolean);
    else if (a === '--jobs') o.jobs = Math.max(1, Number(argv[++i]) || 2);
    else if (a === '--out') o.out = path.resolve(argv[++i]);
    else if (a === '-h' || a === '--help') o.help = true;
    else { console.error(`unknown option ${a}`); process.exit(2); }
  }
  return o;
}

export function select(all, o) {
  const hit = (t, k) => t.name === k || String(t.sheetItem) === k || t.id === k;
  let sel = all.filter((t) => t.status !== 'pending');
  if (o.only.length) {
    const bad = o.only.filter((k) => !all.some((t) => hit(t, k)));
    if (bad.length) { console.error(`unknown test(s): ${bad.join(', ')}`); process.exit(2); }
    sel = sel.filter((t) => o.only.some((k) => hit(t, k)));
  }
  return sel.filter((t) => !o.skip.some((k) => (k === 'heavy' ? t.heavy : hit(t, k))));
}

function table(rows, head) {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => String(c).padEnd(w[i])).join('  ');
  return [line(head), line(w.map((n) => '-'.repeat(n))), ...rows.map(line)].join('\n');
}

function list(all) {
  const rows = all.map((t) => t.status === 'pending'
    ? [t.name, t.title ?? '', 'PENDING', '-', '-', t.note ?? '']
    : [t.name, t.title ?? '', t.heavy ? 'yes' : 'no', t.estMinutes?.quick ?? '?', t.estMinutes?.full ?? '?', (t.needs ?? []).join(',')]);
  console.log(table(rows, ['test', 'title', 'heavy', 'quick min', 'full min', 'needs']));
}

const freePort = (p) => new Promise((res) => { const s = net.createServer(); s.once('error', () => res(false)); s.listen(p, '127.0.0.1', () => s.close(() => res(true))); });

async function precheck(sel) {
  const needs = new Set(sel.flatMap((t) => t.needs ?? []));
  const miss = [];
  const ok = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
  if (needs.has('docker') && !ok('docker', ['info'])) miss.push('docker is not running (start Docker)');
  if (needs.has('node22')) { const v = process.versions.node.split('.')[0]; if (v !== '22') miss.push(`node 22 required, found ${process.versions.node}`); }
  if (needs.has('pnpm') && !ok('pnpm', ['--version'])) miss.push('pnpm not found (corepack enable)');
  for (const t of sel) for (const p of t.ports ?? []) if (!(await freePort(p))) miss.push(`port ${p} (needed by ${t.name}) is in use`);
  return miss;
}

function runOne(t, o, outDir) {
  const dir = path.join(outDir, t.name);
  fs.mkdirSync(dir, { recursive: true });
  const script = path.join(t.dir, t.script ?? 'run.sh');
  const cmd = `bash ${path.relative(REPO, script)} --${o.mode} --out ${path.relative(REPO, dir)}`;
  const started = Date.now();
  return new Promise((resolve) => {
    const log = fs.createWriteStream(path.join(dir, 'runner.log'));
    const c = spawn('bash', [script, `--${o.mode}`, '--out', dir], { cwd: REPO });
    c.stdout.pipe(log, { end: false }); c.stderr.pipe(log);
    c.on('error', (e) => { log.end(`spawn error: ${e.message}\n`); resolve(done(2)); });
    c.on('close', (code) => resolve(done(code ?? 2)));
    function done(code) {
      let r = {};
      try { r = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8')); } catch { /* no result.json */ }
      const status = code === 0 ? 'PASS' : code === 1 ? 'FAIL' : 'ERROR';
      return {
        name: t.name, title: t.title ?? t.name, status, exitCode: code,
        seconds: Math.round((Date.now() - started) / 100) / 10, counts: r.counts ?? null,
        note: code === 0 && !r.status ? 'no result.json written' : (r.status && r.status !== status ? `result.json says ${r.status}` : ''),
        rerun: cmd, report: t.report, dir,
      };
    }
  });
}

function writeSummary(outDir, results, skipped, o) {
  const tot = { PASS: 0, FAIL: 0, ERROR: 0 };
  results.forEach((r) => { tot[r.status]++; });
  const exit = tot.ERROR ? 2 : tot.FAIL ? 1 : 0;
  const base = results.reduce((s, r) => s + (r.counts?.knownBaseline ?? 0), 0);
  const cnt = (r) => (r.counts ? `${r.counts.passed ?? 0}/${r.counts.tests ?? 0} passed, ${r.counts.failed ?? 0} failed` : '-');
  const summary = { generatedAt: new Date().toISOString(), mode: o.mode, exitCode: exit, totals: tot, knownBaselineFailures: base, results, skipped };
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  const md = [`# Script-testing summary (${o.mode})`, '', `PASS ${tot.PASS} / FAIL ${tot.FAIL} / ERROR ${tot.ERROR}; known-baseline failures ignored: ${base}`, '',
    '| test | title | status | seconds | counts | known baseline | re-run |', '|---|---|---|---|---|---|---|',
    ...results.map((r) => `| ${r.name} | ${r.title} | ${r.status} | ${r.seconds} | ${cnt(r)} | ${r.counts?.knownBaseline ?? 0} | \`${r.rerun}\` |`),
    ...(skipped.length ? ['', 'Skipped: ' + skipped.map((s) => `${s.name} (${s.why})`).join('; ')] : [])].join('\n');
  fs.writeFileSync(path.join(outDir, 'summary.md'), md + '\n');
  const max = Math.max(1, ...results.map((r) => r.seconds));
  const bars = results.map((r, i) => { const w = Math.round((r.seconds / max) * 520); const y = 10 + i * 28;
    return `<text x="190" y="${y + 15}" text-anchor="end">${esc(r.name)}</text><rect x="196" y="${y}" width="${Math.max(2, w)}" height="20" fill="var(--${r.status === 'PASS' ? 'ok' : 'bad'})"/><text x="${202 + w}" y="${y + 15}">${r.seconds}s</text>`; }).join('');
  const chip = (s) => `<span class="chip ${s === 'PASS' ? 'ok' : 'bad'}">${s}</span>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Script-testing summary</title><style>
:root{--bg:#fff;--fg:#1b1f24;--mut:#59636e;--card:#f4f6f8;--line:#d0d7de;--a:#1f5fbf;--ok:#1a7f37;--warn:#9a6700;--bad:#cf222e}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mut:#9aa4af;--card:#161b22;--line:#30363d;--a:#6ea8fe;--ok:#3fb950;--warn:#d29922;--bad:#ff7b72}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:980px;margin:0 auto;padding:16px}
h1{font-size:1.7rem;margin:.2em 0}h2{font-size:1.3rem;margin:1.8em 0 .5em;border-bottom:1px solid var(--line)}
.badge{display:inline-block;padding:.1em .6em;border-radius:1em;font-weight:600;font-size:.85rem;border:1px solid currentColor}.ok{color:var(--ok)}.bad{color:var(--bad)}.meta{color:var(--mut);font-size:.92rem}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:12px 0}.tile{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px}.tile b{display:block;font-size:1.7rem}.tile span{color:var(--mut);font-size:.88rem}
table{border-collapse:collapse;width:100%;font-size:.9rem;display:block;overflow-x:auto}th,td{border:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}th{background:var(--card)}
.chip{font-size:.78rem;font-weight:700;padding:0 .45em;border:1px solid currentColor;border-radius:4px}code{background:var(--card);padding:0 .25em;border-radius:3px;font-size:.88em;word-break:break-all}
svg{max-width:100%;height:auto}svg text{fill:var(--fg);font:12px system-ui,sans-serif}</style></head><body><main>
<header><h1>Script-testing summary</h1><p><span class="badge ${exit ? 'bad' : 'ok'}">${exit === 0 ? 'ALL PASS' : exit === 1 ? 'FAIL' : 'ERROR'}</span> mode ${o.mode}</p><p class="meta">Generated ${summary.generatedAt} &middot; exit code ${exit}</p></header>
<div class="tiles"><div class="tile"><b class="ok">${tot.PASS}</b><span>PASS</span></div><div class="tile"><b class="bad">${tot.FAIL}</b><span>FAIL</span></div><div class="tile"><b class="bad">${tot.ERROR}</b><span>ERROR</span></div><div class="tile"><b>${base}</b><span>known-baseline failures ignored</span></div></div>
<h2>Results</h2><table><thead><tr><th>Test</th><th>Title</th><th>Status</th><th>Seconds</th><th>Counts</th><th>Baseline</th><th>Re-run</th></tr></thead><tbody>
${results.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.title)}</td><td>${chip(r.status)}</td><td>${r.seconds}</td><td>${esc(cnt(r))}</td><td>${r.counts?.knownBaseline ?? 0}</td><td><code>${esc(r.rerun)}</code></td></tr>`).join('')}</tbody></table>
<h2>Duration per test</h2><svg role="img" aria-label="Seconds per test" viewBox="0 0 800 ${results.length * 28 + 20}" width="800"><title>Duration per test</title>${bars}</svg>
${skipped.length ? `<h2>Skipped</h2><ul>${skipped.map((s) => `<li>${esc(s.name)}: ${esc(s.why)}</li>`).join('')}</ul>` : ''}
</main></body></html>`;
  fs.writeFileSync(path.join(outDir, 'summary.html'), html);
  return { exit, tot, base, cnt };
}

export async function main(argv) {
  const o = parseArgs(argv);
  if (o.help) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n')[1]); return 0; }
  if (o.selfTest) return selfTest();
  const all = discover();
  if (o.list) { list(all); return 0; }
  const skipped = all.filter((t) => t.status === 'pending').map((t) => ({ name: t.name, why: `PENDING: ${t.note ?? 'runner not added yet'}` }));
  skipped.forEach((s) => console.log(`SKIP ${s.name}: ${s.why}`));
  const sel = select(all, o);
  all.filter((t) => t.status !== 'pending' && !sel.includes(t)).forEach((t) => skipped.push({ name: t.name, why: 'not selected' }));
  if (!sel.length) { console.error('nothing selected'); return 2; }
  if (!o.noPrecheck) {
    const miss = await precheck(sel);
    if (miss.length) { console.error('PRE-CHECK FAILED:\n  - ' + miss.join('\n  - ')); return 2; }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = o.out ?? path.join(REPO, 'qa-results', stamp);
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  let stop = false;
  const queue = (arr, n) => Promise.all(Array.from({ length: n }, async () => {
    while (arr.length && !stop) {
      const t = arr.shift();
      console.log(`RUN  ${t.name} (${o.mode})`);
      const r = await runOne(t, o, outDir);
      results.push(r);
      console.log(`${r.status.padEnd(5)} ${t.name} ${r.seconds}s`);
      if (o.failFast && r.status !== 'PASS') stop = true;
    }
  }));
  await queue(sel.filter((t) => !t.heavy), o.jobs);   // heavy tests run alone, after the light ones
  await queue(sel.filter((t) => t.heavy), 1);
  results.sort((a, b) => sel.findIndex((t) => t.name === a.name) - sel.findIndex((t) => t.name === b.name));
  sel.filter((t) => !results.some((r) => r.name === t.name)).forEach((t) => skipped.push({ name: t.name, why: 'not run (--fail-fast)' }));
  const { exit, tot, base, cnt } = writeSummary(outDir, results, skipped, o);
  console.log('\n' + table(results.map((r) => [r.name, r.title, r.status, r.seconds + 's', cnt(r), r.counts?.knownBaseline ?? 0]), ['test', 'title', 'status', 'time', 'counts', 'baseline']));
  console.log(`\nPASS ${tot.PASS}  FAIL ${tot.FAIL}  ERROR ${tot.ERROR}  known-baseline ignored ${base}\nsummary: ${path.join(outDir, 'summary.html')}\nexit ${exit}`);
  return exit;
}

function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'st-self-'));
  const fake = (name, code, counts) => {
    const d = path.join(tmp, 'tests', name); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ title: name, heavy: false, estMinutes: { quick: 0, full: 0 }, needs: [] }));
    fs.writeFileSync(path.join(d, 'run.sh'), `#!/usr/bin/env bash\nout=$3\nmkdir -p "$out"\necho '{"status":"${code ? 'FAIL' : 'PASS'}","counts":${counts}}' > "$out/result.json"\nexit ${code}\n`);
  };
  fake('fake-pass', 0, '{"tests":3,"passed":3,"failed":0,"knownBaseline":1}');
  fake('fake-fail', 1, '{"tests":2,"passed":1,"failed":1,"knownBaseline":0}');
  const run = (tag, args) => spawnSync('node', [fileURLToPath(import.meta.url), ...args, '--no-precheck', '--out', path.join(tmp, 'out', tag)], { env: { ...process.env, ST_DIR: path.join(tmp, 'tests') }, encoding: 'utf8' });
  const fails = [];
  const check = (c, m) => { if (!c) fails.push(m); };
  const both = run('both', ['--quick']);
  check(both.status === 1, `both: expected exit 1, got ${both.status}`);
  const sum = JSON.parse(fs.readFileSync(path.join(tmp, 'out', 'both', 'summary.json'), 'utf8'));
  check(sum.totals.PASS === 1 && sum.totals.FAIL === 1, 'totals wrong');
  check(sum.knownBaselineFailures === 1, 'baseline count wrong');
  check(['summary.md', 'summary.html'].every((f) => fs.existsSync(path.join(tmp, 'out', 'both', f))), 'summary files missing');
  check(run('pass', ['--only', 'fake-pass']).status === 0, '--only fake-pass should exit 0');
  fs.writeFileSync(path.join(tmp, 'tests', 'fake-pass', 'run.sh'), 'exit 2\n');
  check(run('err', ['--only', 'fake-pass,fake-fail', '--jobs', '1']).status === 2, 'ERROR should exit 2');
  fs.rmSync(tmp, { recursive: true, force: true });
  if (fails.length) { console.error('SELF-TEST FAILED:\n  ' + fails.join('\n  ')); return 1; }
  console.log('SELF-TEST OK: aggregation, summary files and exit codes 0/1/2 behave');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then((c) => process.exit(c));
