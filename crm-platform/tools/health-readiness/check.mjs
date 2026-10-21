#!/usr/bin/env node
// Sheet3 #73 ratchet: every production compose service has a healthcheck or a documented exemption, the healthcheck is sane and points at a
// real endpoint, and the coverage matrix's alerts/runbooks exist. Usage: node tools/health-readiness/check.mjs [root] [--json out]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const slug = (h) => h.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/ /g, '-');

function loadYaml(root, file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  try {
    // pnpm hoists transitive packages here; `yaml` is not a direct dependency (shortcut: switch to a devDependency if pnpm layout changes)
    return createRequire(path.join(root, 'node_modules/.pnpm/node_modules/'))('yaml').parse(text, { merge: true });
  } catch {
    const py = spawnSync('python3', ['-c', 'import sys,json,yaml;print(json.dumps(yaml.safe_load(sys.stdin)))'], { input: text, encoding: 'utf8' });
    if (py.status !== 0) throw new Error(`cannot parse ${file}: no yaml package and no python3 PyYAML`);
    return JSON.parse(py.stdout);
  }
}
const secs = (v) => (v == null ? null : /^(\d+)(s|m)$/.test(String(v)) ? Number(RegExp.$1) * (RegExp.$2 === 'm' ? 60 : 1) : NaN);

export function check(root) {
  const problems = [];
  const m = JSON.parse(fs.readFileSync(path.join(root, 'docs/performance/health/coverage-matrix.json'), 'utf8'));
  const rules = fs.readdirSync(path.join(root, 'deploy/observability')).filter((f) => f.endsWith('.rules.yml'))
    .map((f) => fs.readFileSync(path.join(root, 'deploy/observability', f), 'utf8')).join('\n');
  const rows = [];
  const composes = ['deploy/hostinger/docker-compose.yml', 'deploy/hostinger/observability.compose.yml'];
  for (const file of composes) {
    for (const [name, svc] of Object.entries(loadYaml(root, file).services ?? {})) {
      const row = m.services[name];
      if (!row) { problems.push(`${name} (${file}) is not in coverage-matrix.json`); continue; }
      const eff = row.same_as ? m.services[row.same_as] : row;
      const hc = svc.healthcheck;
      if (!hc && !eff.exempt) problems.push(`${name}: no healthcheck and no documented exemption`);
      if (hc) {
        const iv = secs(hc.interval), to = secs(hc.timeout), grace = secs(hc.start_period) ?? 0;
        if (!(iv >= 5 && iv <= 600)) problems.push(`${name}: healthcheck interval ${hc.interval} outside 5s..10m`);
        if (!(to >= 1 && to < iv)) problems.push(`${name}: healthcheck timeout ${hc.timeout} must be >=1s and below the interval`);
        if (!(hc.retries >= 1)) problems.push(`${name}: healthcheck retries missing`);
        if (['api-blue', 'api-green', 'web-blue', 'web-green', 'worker'].includes(name) && grace < 20) problems.push(`${name}: start_period under 20s for a node service`);
        const cmd = JSON.stringify(hc.test);
        const url = cmd.match(/127\.0\.0\.1:(\d+)(\/[a-z/]*)/);
        if (url && !['/ready', '/health', '/login', '/api/ready', '/api/health'].includes(url[2])) problems.push(`${name}: healthcheck path ${url[2]} is not a known endpoint`);
        if (name.startsWith('api') && url?.[2] === '/health') problems.push(`${name}: compose healthcheck should use /ready`);
      }
      if (!eff.runbook) problems.push(`${name}: no runbook`);
      if (!eff.owner) problems.push(`${name}: no owner`);
      for (const f of [eff.runbook].filter(Boolean)) {
        const [file2, anchor] = f.split('#');
        const p = path.join(root, file2);
        if (!fs.existsSync(p)) problems.push(`${name}: runbook ${file2} does not exist`);
        else if (anchor && !fs.readFileSync(p, 'utf8').split('\n').some((l) => /^#{1,4} /.test(l) && slug(l.replace(/^#+ /, '')) === anchor)) problems.push(`${name}: anchor #${anchor} missing in ${file2}`);
      }
      const alert = (eff.alert ?? '').split(/[ (]/)[0];
      if (alert && alert !== 'none' && !new RegExp(`alert: ${alert}\\b`).test(rules)) problems.push(`${name}: alert ${alert} not in deploy/observability/*.rules.yml`);
      rows.push({ service: name, healthcheck: hc ? 'yes' : 'exempt', alert: eff.alert, runbook: eff.runbook, owner: eff.owner, gap: eff.gap ?? null });
    }
  }
  const compose = new Set(composes.flatMap((f) => Object.keys(loadYaml(root, f).services)));
  for (const n of Object.keys(m.services)) if (!compose.has(n)) problems.push(`matrix lists ${n} which is in no compose file (stale)`);
  const probe = fs.readFileSync(path.join(root, 'deploy/hostinger/observability.compose.yml'), 'utf8');
  for (const t of ['health=http://api:3000/health', 'ready=http://api:3000/ready', 'webready=http://web:3001/api/ready']) if (!probe.includes(t)) problems.push(`probe target missing: ${t}`);
  return { problems, rows };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.dirname(fileURLToPath(import.meta.url)) + '/../..');
  const r = check(root);
  const j = process.argv.indexOf('--json');
  if (j > 0) fs.writeFileSync(process.argv[j + 1], JSON.stringify(r, null, 2));
  console.log(r.rows.map((x) => `${x.service.padEnd(13)} hc=${x.healthcheck.padEnd(6)} alert=${x.alert} gap=${x.gap ?? '-'}`).join('\n'));
  console.log(r.problems.length ? `FAIL\n${r.problems.join('\n')}` : `OK (${r.rows.length} services)`);
  process.exit(r.problems.length ? 1 : 0);
}
