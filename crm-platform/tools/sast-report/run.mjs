#!/usr/bin/env node
// Quick SAST report: one command, one report.
//
//   pnpm audit:sast                    pattern sweep + pnpm audit (+ semgrep / gitleaks / trivy when installed)
//   pnpm audit:sast -- --no-deps       skip pnpm audit (offline)
//   pnpm audit:sast -- --path apps/api scan one subtree only (repeatable)
//   pnpm audit:sast -- --fail-on high  exit 1 when a finding at that severity or above exists (CI gate)
//
// Output: reports/sast/<timestamp>/report.html (+ report.md, findings.json) and a copy in reports/sast/latest/.
// Read-only: nothing in the repo is changed except the reports/ folder. Pattern hits are leads to review, not verdicts:
// each rule says what to check. A static scan cannot see authorization or tenant-isolation bugs; use audit:tenancy / audit:authz.

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-cli',
  'build',
  '.next',
  'coverage',
  '.turbo',
  'out',
  '.git',
]);
const EXT = /\.(ts|tsx|js|mjs|cjs|sql)$/;
const TEST_FILE = /(\.test\.|\.spec\.|\/__tests__\/|\/test\/|\/e2e\/|\.e2e-spec\.)/;

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const optAll = (n) => args.flatMap((a, i) => (a === n ? [args[i + 1]] : []));
if (flag('--help') || flag('-h')) {
  console.log(
    readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('\n')
      .slice(1, 11)
      .map((l) => l.replace(/^\/\/ ?/, ''))
      .join('\n'),
  );
  process.exit(0);
}
const scanRoots = (optAll('--path').length ? optAll('--path') : ['apps', 'packages']).map((p) =>
  join(ROOT, p),
);
const failOn = opt('--fail-on');
if (failOn && !SEVERITIES.includes(failOn)) {
  console.error(`--fail-on must be one of ${SEVERITIES.join(', ')}`);
  process.exit(2);
}

// ---------------------------------------------------------------- rules
// id, severity, title, regex (per line), why it matters, what to check. `prod: true` skips test files.
const RULES = [
  {
    id: 'SQL-RAW',
    sev: 'medium',
    title: 'Raw SQL built in code (sql.raw / unsafe)',
    re: /\bsql\.raw\(|\.unsafe\(/,
    prod: true,
    why: 'Anything interpolated into raw SQL bypasses parameter binding.',
    check:
      'Every interpolated value must be a fixed identifier from an allow-list, never request data.',
  },
  {
    id: 'SQL-CONCAT',
    sev: 'high',
    title: 'SQL string concatenated or templated with a variable',
    re: /\b(query|execute)\(\s*(`[^`]*\$\{|['"][^'"]*['"]\s*\+)/,
    prod: true,
    why: 'Classic SQL injection shape.',
    check: 'Use bound parameters.',
  },
  {
    id: 'EVAL',
    sev: 'high',
    title: 'eval / new Function / vm',
    re: /(?<![.\w])eval\(|new Function\(|\bvm\.(runIn|Script)|new vm\.Script/,
    prod: true,
    why: 'Executes strings as code.',
    check: 'Confirm the input is never user-influenced.',
  },
  {
    id: 'CMD-EXEC',
    sev: 'medium',
    title: 'Child process spawn/exec',
    re: /\bchild_process\b|(?<![.\w])(execSync|spawnSync|execFileSync|execFile)\(|(?<![.\w])(spawn|exec)\(\s*['"`]/,
    prod: true,
    why: 'Command injection if any argument is user-derived.',
    check: 'Arguments must be fixed or validated; never use a shell with request data.',
  },
  {
    id: 'XSS-HTML',
    sev: 'medium',
    title: 'dangerouslySetInnerHTML / innerHTML',
    re: /dangerouslySetInnerHTML|\.innerHTML\s*=/,
    prod: true,
    why: 'Renders markup unescaped.',
    check: 'Content must be sanitized server-side, or be JSON-LD with "<" escaped.',
  },
  {
    id: 'SSRF-FETCH',
    sev: 'low',
    title: 'Outbound fetch to a non-literal URL',
    re: /\b(fetch|axios\.(get|post|put|request)|got|request)\(\s*(?!['"`]https?:\/\/[^$]*['"`])[A-Za-z_`$]/,
    prod: true,
    why: 'SSRF if the URL comes from settings or request data and private ranges are not blocked.',
    check:
      'Resolve and block private/link-local/metadata addresses, restrict schemes and redirects.',
  },
  {
    id: 'CORS-ANY',
    sev: 'medium',
    title: 'CORS reflects any origin',
    re: /\borigin:\s*(true|['"]\*['"])/,
    prod: true,
    why: 'With credentials, any site can make authenticated calls.',
    check: 'Use an explicit origin allow-list.',
  },
  {
    id: 'JWT-LAX',
    sev: 'medium',
    title: 'JWT verify with ignored expiry / none algorithm',
    re: /ignoreExpiration:\s*true|IgnoringExpiry|algorithms?:\s*\[[^\]]*none/i,
    prod: true,
    why: 'Expired or unsigned tokens may be accepted.',
    check: 'Only used for refresh/logout flows, never as authentication.',
  },
  {
    id: 'WEAK-HASH',
    sev: 'medium',
    title: 'Weak hash (md5 / sha1)',
    re: /createHash\(\s*['"](md5|sha1)['"]/,
    prod: true,
    why: 'Collision-prone; unsafe for integrity or secrets.',
    check:
      'Fine for non-security checksums or when a provider mandates it (e.g. webhook signatures).',
  },
  {
    id: 'RANDOM',
    sev: 'low',
    title: 'Math.random in runtime code',
    re: /Math\.random\(/,
    prod: true,
    why: 'Not cryptographically secure.',
    check: 'Must never produce tokens, codes, ids or secrets; use crypto.randomBytes / randomUUID.',
  },
  {
    id: 'TLS-OFF',
    sev: 'high',
    title: 'TLS verification disabled',
    re: /rejectUnauthorized:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/,
    prod: true,
    why: 'Allows man-in-the-middle.',
    check: 'Remove, or confine to local development.',
  },
  {
    id: 'COOKIE',
    sev: 'low',
    title: 'Cookie set without visible secure flags',
    re: /\.cookie\(|Set-Cookie/i,
    prod: true,
    why: 'Missing httpOnly / secure / sameSite exposes sessions.',
    check: 'Confirm httpOnly, secure (non-dev) and sameSite on every session cookie.',
  },
  {
    id: 'PUBLIC-ROUTE',
    sev: 'info',
    title: '@Public() route (no auth guard)',
    re: /@Public\(\)/,
    prod: true,
    why: 'Reachable without a session.',
    check: 'Webhooks must verify a provider signature; the rest must leak nothing tenant-specific.',
  },
  {
    id: 'WEBHOOK-TOKEN',
    sev: 'medium',
    title: 'Webhook guarded by URL token / optional secret',
    re: /(secret_token|x-telegram-bot-api-secret-token|hub\.verify_token)/i,
    prod: true,
    why: 'URL tokens leak in logs; optional header secrets can be silently off.',
    check: 'Require a signature or secret; compare in constant time.',
  },
  {
    id: 'REDIRECT',
    sev: 'low',
    title: 'Redirect to a request-derived target',
    re: /\bredirect\(\s*(req|request|query|params|body)\b|res\.redirect\([^)'"`]*(req\.|query|params)/,
    prod: true,
    why: 'Open redirect.',
    check: 'Allow-list the target host or only accept relative paths.',
  },
  {
    id: 'PATH-JOIN',
    sev: 'low',
    title: 'File path built from a variable',
    re: /\b(readFile|readFileSync|createReadStream|writeFile|writeFileSync|unlink)\(\s*(`[^`]*\$\{|[a-z]+\.join\([^)]*(req|params|query|name|filename))/i,
    prod: true,
    why: 'Path traversal if the segment is user-supplied.',
    check: 'Normalize, reject "..", and pin to a base directory.',
  },
  {
    id: 'REGEX-DYN',
    sev: 'low',
    title: 'RegExp built from a variable',
    re: /new RegExp\(\s*[^'"`/\s)]/,
    prod: true,
    why: 'ReDoS / regex injection.',
    check: 'Escape user input or use a fixed pattern.',
  },
  {
    id: 'SECRET-LITERAL',
    sev: 'high',
    title: 'Hard-coded secret-looking literal',
    re: /(AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|sk_live_[0-9a-zA-Z]{16,}|xox[baprs]-[0-9A-Za-z-]{10,}|ghp_[0-9A-Za-z]{30,}|AIza[0-9A-Za-z_-]{35})/,
    prod: false,
    why: 'Committed credentials stay in git history.',
    check: 'Rotate it, then remove it.',
  },
  {
    id: 'SECRET-ASSIGN',
    sev: 'medium',
    title: 'Password / token assigned a string literal',
    re: /\b(password|passwd|secret|api[_-]?key|token)\b\s*[:=]\s*['"][A-Za-z0-9+/_\-=]{12,}['"]/i,
    prod: true,
    why: 'Possible committed credential.',
    check: 'Dummy values in fixtures are fine; real ones are not.',
  },
  {
    id: 'TS-IGNORE',
    sev: 'info',
    title: '@ts-ignore / eslint-disable on a security rule',
    re: /eslint-disable[^\n]*(security|no-eval|no-implied-eval)/,
    prod: true,
    why: 'A linter guard was silenced.',
    check: 'Confirm the reason is written next to it.',
  },
];

// ---------------------------------------------------------------- scan
function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (EXT.test(e.name) && statSync(p).size < 1_500_000) yield p;
  }
}

const hits = new Map(RULES.map((r) => [r.id, []]));
let filesScanned = 0;
for (const base of scanRoots) {
  if (!existsSync(base)) {
    console.error(`skip (missing): ${relative(ROOT, base)}`);
    continue;
  }
  for (const file of walk(base)) {
    const rel = relative(ROOT, file);
    const isTest = TEST_FILE.test('/' + rel);
    filesScanned++;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.length > 600) return;
      for (const r of RULES) {
        if (r.prod && isTest) continue;
        if (r.re.test(line))
          hits.get(r.id).push({ file: rel, line: i + 1, text: line.trim().slice(0, 160) });
      }
    });
  }
}

// ---------------------------------------------------------------- external tools
const tools = [];
function have(cmd) {
  return spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).status === 0;
}
function sh(cmd, argv, opts = {}) {
  return spawnSync(cmd, argv, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...opts,
  });
}

let advisories = [];
if (!flag('--no-deps')) {
  const r = sh('pnpm', ['audit', '--json']);
  try {
    const j = JSON.parse(r.stdout);
    advisories = Object.values(j.advisories ?? {}).map((a) => ({
      sev: a.severity === 'moderate' ? 'medium' : a.severity,
      pkg: a.module_name,
      title: a.title,
      url: a.url,
      range: a.vulnerable_versions,
      fix: a.patched_versions,
      paths: (a.findings ?? []).flatMap((f) => f.paths ?? []).slice(0, 3),
    }));
    tools.push({ name: 'pnpm audit', status: 'ran', note: `${advisories.length} advisories` });
  } catch {
    tools.push({
      name: 'pnpm audit',
      status: 'failed',
      note: (r.stderr || r.stdout || 'no output (offline?)').trim().slice(0, 200),
    });
  }
} else tools.push({ name: 'pnpm audit', status: 'skipped', note: '--no-deps' });

const externalFindings = [];
if (have('semgrep')) {
  const r = sh('semgrep', [
    '--config',
    'p/security-audit',
    '--config',
    'p/secrets',
    '--json',
    '--quiet',
    '--metrics=off',
    ...scanRoots.filter(existsSync).map((p) => relative(ROOT, p)),
    '--exclude',
    'node_modules',
    '--exclude',
    'dist',
    '--exclude',
    '.next',
  ]);
  try {
    const j = JSON.parse(r.stdout);
    for (const f of j.results ?? []) {
      externalFindings.push({
        tool: 'semgrep',
        sev: { ERROR: 'high', WARNING: 'medium', INFO: 'low' }[f.extra?.severity] ?? 'low',
        rule: f.check_id,
        file: f.path,
        line: f.start?.line,
        text: (f.extra?.message ?? '').slice(0, 200),
      });
    }
    tools.push({
      name: 'semgrep',
      status: 'ran',
      note: `${(j.results ?? []).length} results, ${(j.errors ?? []).length} parse errors`,
    });
  } catch {
    tools.push({ name: 'semgrep', status: 'failed', note: (r.stderr || '').slice(0, 200) });
  }
} else
  tools.push({
    name: 'semgrep',
    status: 'not installed',
    note: 'pip install semgrep for deeper rules',
  });

if (have('gitleaks')) {
  const out = join(ROOT, 'reports/.gitleaks.tmp.json');
  mkdirSync(dirname(out), { recursive: true });
  const cfg = existsSync(join(ROOT, '../.gitleaks.toml'))
    ? ['--config', join(ROOT, '../.gitleaks.toml')]
    : [];
  sh('gitleaks', [
    'detect',
    '--source',
    resolve(ROOT, '..'),
    '--no-banner',
    '--redact',
    '--report-format',
    'json',
    '--report-path',
    out,
    ...cfg,
  ]);
  try {
    const j = JSON.parse(readFileSync(out, 'utf8'));
    for (const f of j)
      externalFindings.push({
        tool: 'gitleaks',
        sev: 'high',
        rule: f.RuleID,
        file: f.File,
        line: f.StartLine,
        text: f.Description,
      });
    tools.push({ name: 'gitleaks', status: 'ran', note: `${j.length} leaks (full git history)` });
  } catch {
    tools.push({ name: 'gitleaks', status: 'failed', note: 'no report produced' });
  }
  rmSync(out, { force: true });
} else
  tools.push({
    name: 'gitleaks',
    status: 'not installed',
    note: 'secret scan of git history not run; the regex rules above only see the working tree',
  });

if (have('trivy')) {
  const r = sh('trivy', [
    'fs',
    '--scanners',
    'vuln',
    '--severity',
    'HIGH,CRITICAL',
    '--ignore-unfixed',
    '--format',
    'json',
    '--quiet',
    'pnpm-lock.yaml',
  ]);
  try {
    const j = JSON.parse(r.stdout);
    const v = (j.Results ?? []).flatMap((x) => x.Vulnerabilities ?? []);
    for (const f of v)
      externalFindings.push({
        tool: 'trivy',
        sev: f.Severity.toLowerCase(),
        rule: f.VulnerabilityID,
        file: 'pnpm-lock.yaml',
        text: `${f.PkgName}@${f.InstalledVersion}: ${f.Title ?? ''}`,
      });
    tools.push({ name: 'trivy', status: 'ran', note: `${v.length} fixable HIGH/CRITICAL` });
  } catch {
    tools.push({ name: 'trivy', status: 'failed', note: (r.stderr || '').slice(0, 200) });
  }
} else tools.push({ name: 'trivy', status: 'not installed', note: 'lockfile scan not run' });

// ---------------------------------------------------------------- baseline
// tools/sast-report/baseline.json: [{ "rule": "EVAL", "file": "apps/...", "contains": "text on the line", "reason": "why this is not a vulnerability" }]
// A reviewed exception is listed in the report but does not count, and does not trip --fail-on. A reason is mandatory.
let baseline = [];
try {
  baseline = JSON.parse(readFileSync(join(ROOT, 'tools/sast-report/baseline.json'), 'utf8')).filter(
    (b) => b.reason,
  );
} catch {
  /* no baseline yet */
}
const reviewed = [];
for (const [id, list] of hits) {
  hits.set(
    id,
    list.filter((h) => {
      const b = baseline.find(
        (x) => x.rule === id && x.file === h.file && h.text.includes(x.contains ?? ''),
      );
      if (b) reviewed.push({ rule: id, file: h.file, line: h.line, reason: b.reason });
      return !b;
    }),
  );
}

// ---------------------------------------------------------------- model
const rules = RULES.map((r) => ({ ...r, re: undefined, hits: hits.get(r.id) })).filter(
  (r) => r.hits.length,
);
rules.sort(
  (a, b) => SEVERITIES.indexOf(a.sev) - SEVERITIES.indexOf(b.sev) || b.hits.length - a.hits.length,
);
const sevCount = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
for (const r of rules) sevCount[r.sev]++;
for (const a of advisories) sevCount[a.sev] = (sevCount[a.sev] ?? 0) + 1;
for (const f of externalFindings) sevCount[f.sev] = (sevCount[f.sev] ?? 0) + 1;

const git = (a) => sh('git', a).stdout?.trim() ?? '';
const meta = {
  generatedAt: new Date().toISOString(),
  commit: git(['rev-parse', '--short', 'HEAD']),
  branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
  filesScanned,
  roots: scanRoots.map((p) => relative(ROOT, p)),
};
const model = { meta, tools, sevCount, rules, advisories, externalFindings, reviewed };

// ---------------------------------------------------------------- render
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const MAX_SHOWN = 25;

function html() {
  const sevBadge = (s) => `<span class="b ${s}">${s}</span>`;
  const ruleBlocks = rules
    .map(
      (r) => `
<details class="card" ${['high', 'critical'].includes(r.sev) ? 'open' : ''}>
  <summary>${sevBadge(r.sev)} <b>${esc(r.title)}</b> <code>${r.id}</code> <span class="n">${r.hits.length} location${r.hits.length === 1 ? '' : 's'}</span></summary>
  <p><b>Why it matters:</b> ${esc(r.why)}<br><b>What to check:</b> ${esc(r.check)}</p>
  <table><tr><th>Location</th><th>Code</th></tr>
  ${r.hits
    .slice(0, MAX_SHOWN)
    .map(
      (h) =>
        `<tr><td><code>${esc(h.file)}:${h.line}</code></td><td><code>${esc(h.text)}</code></td></tr>`,
    )
    .join('')}
  </table>${r.hits.length > MAX_SHOWN ? `<p class="muted">+ ${r.hits.length - MAX_SHOWN} more, see findings.json</p>` : ''}
</details>`,
    )
    .join('');
  const adv = advisories.length
    ? `<table><tr><th>Severity</th><th>Package</th><th>Advisory</th><th>Vulnerable</th><th>Fixed in</th><th>Via</th></tr>
  ${advisories
    .sort((a, b) => SEVERITIES.indexOf(a.sev) - SEVERITIES.indexOf(b.sev))
    .map(
      (a) =>
        `<tr><td>${sevBadge(a.sev)}</td><td>${esc(a.pkg)}</td><td><a href="${esc(a.url)}">${esc(a.title)}</a></td><td>${esc(a.range)}</td><td>${esc(a.fix)}</td><td><code>${esc(a.paths.join(' | '))}</code></td></tr>`,
    )
    .join('')}</table>`
    : '<p class="muted">None reported (or the audit did not run, see tool status).</p>';
  const ext = externalFindings.length
    ? `<table><tr><th>Tool</th><th>Severity</th><th>Rule</th><th>Location</th><th>Message</th></tr>
  ${externalFindings
    .slice(0, 200)
    .map(
      (f) =>
        `<tr><td>${f.tool}</td><td>${sevBadge(f.sev)}</td><td><code>${esc(f.rule)}</code></td><td><code>${esc(f.file)}${f.line ? ':' + f.line : ''}</code></td><td>${esc(f.text)}</td></tr>`,
    )
    .join('')}</table>`
    : '<p class="muted">No findings from external scanners (or none installed).</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SAST report</title><style>
:root{--bg:#fff;--fg:#1a1a1a;--mut:#666;--line:#ddd;--card:#f7f7f8;--critical:#7a0019;--high:#c0392b;--medium:#d68910;--low:#2e86c1;--info:#7f8c8d}
@media(prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#e8e8e8;--mut:#9aa0a6;--line:#2c2f36;--card:#1d2026}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;max-width:1100px;margin:0 auto;padding:24px 16px}
h1{margin:0 0 4px}h2{margin-top:32px;border-bottom:1px solid var(--line);padding-bottom:4px}.muted{color:var(--mut)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:16px 0}
.stat{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 14px}.stat b{font-size:26px;display:block}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 14px;margin:8px 0}summary{cursor:pointer}
.b{color:#fff;border-radius:4px;padding:1px 7px;font-size:12px;text-transform:uppercase}.critical{background:var(--critical)}.high{background:var(--high)}.medium{background:var(--medium)}.low{background:var(--low)}.info{background:var(--info)}
.n{color:var(--mut);float:right}table{border-collapse:collapse;width:100%;font-size:13px;display:block;overflow-x:auto}th,td{border-bottom:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top}
code{font:12px ui-monospace,monospace;word-break:break-all}a{color:inherit}</style></head><body>
<h1>SAST report</h1>
<p class="muted">Generated ${esc(meta.generatedAt)} · branch ${esc(meta.branch)} @ ${esc(meta.commit)} · ${meta.filesScanned} files in ${esc(meta.roots.join(', '))}</p>
<div class="grid">${SEVERITIES.map((s) => `<div class="stat"><b>${sevCount[s]}</b>${sevBadge(s)}</div>`).join('')}</div>
<p>Pattern hits are <b>leads to review</b>, not confirmed vulnerabilities: each one lists what to check. A static scan cannot see authorization or tenant-isolation bugs; run <code>pnpm audit:tenancy</code> and <code>pnpm audit:authz</code> for those.</p>
<h2>Scanner status</h2>
<table><tr><th>Tool</th><th>Status</th><th>Note</th></tr>${tools.map((t) => `<tr><td>${t.name}</td><td>${t.status}</td><td>${esc(t.note)}</td></tr>`).join('')}</table>
<h2>Weak points (pattern rules)</h2>${ruleBlocks || '<p class="muted">No rule matched.</p>'}
<h2>Dependency advisories</h2>${adv}
<h2>Reviewed exceptions (${reviewed.length})</h2>${reviewed.length ? `<table><tr><th>Rule</th><th>Location</th><th>Why it is not a vulnerability</th></tr>${reviewed.map((r) => `<tr><td>${r.rule}</td><td><code>${esc(r.file)}:${r.line}</code></td><td>${esc(r.reason)}</td></tr>`).join('')}</table>` : '<p class="muted">None.</p>'}
<h2>External scanner findings</h2>${ext}
</body></html>`;
}

function md() {
  const out = [
    `# SAST report`,
    ``,
    `Generated ${meta.generatedAt} · ${meta.branch} @ ${meta.commit} · ${meta.filesScanned} files`,
    ``,
    `| ${SEVERITIES.join(' | ')} |`,
    `|${SEVERITIES.map(() => '---').join('|')}|`,
    `| ${SEVERITIES.map((s) => sevCount[s]).join(' | ')} |`,
    ``,
    `## Scanners`,
    ``,
    ...tools.map((t) => `- ${t.name}: ${t.status}${t.note ? ` (${t.note})` : ''}`),
    ``,
    `## Weak points`,
    ``,
  ];
  for (const r of rules) {
    out.push(
      `### [${r.sev}] ${r.title} (${r.id}, ${r.hits.length})`,
      ``,
      `${r.why} Check: ${r.check}`,
      ``,
      ...r.hits.slice(0, 10).map((h) => `- \`${h.file}:${h.line}\``),
      r.hits.length > 10 ? `- … ${r.hits.length - 10} more` : '',
      ``,
    );
  }
  out.push(
    `## Dependency advisories`,
    ``,
    ...advisories.map((a) => `- [${a.sev}] ${a.pkg}: ${a.title} (fixed in ${a.fix})`),
    ``,
  );
  return out.join('\n');
}

// ---------------------------------------------------------------- write
const stamp = meta.generatedAt.replace(/[:.]/g, '-').slice(0, 19);
const dir = join(ROOT, 'reports/sast', stamp);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'report.html'), html());
writeFileSync(join(dir, 'report.md'), md());
writeFileSync(join(dir, 'findings.json'), JSON.stringify(model, null, 2));
const latest = join(ROOT, 'reports/sast/latest');
rmSync(latest, { recursive: true, force: true });
cpSync(dir, latest, { recursive: true });

console.log(`SAST: ${SEVERITIES.map((s) => `${sevCount[s]} ${s}`).join(', ')}`);
for (const t of tools) console.log(`  ${t.name}: ${t.status}${t.note ? ` (${t.note})` : ''}`);
console.log(`Report: ${relative(process.cwd(), join(latest, 'report.html'))}`);

if (failOn) {
  const limit = SEVERITIES.indexOf(failOn);
  if (SEVERITIES.some((s, i) => i <= limit && sevCount[s] > 0)) process.exit(1);
}
