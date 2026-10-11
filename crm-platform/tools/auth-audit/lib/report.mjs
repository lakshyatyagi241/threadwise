// Writers: HTML (self-contained), Markdown, JSON, CSV and the integrity manifest.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { ADAPTATIONS, ANALYSIS_DATE, MECHANISMS, STRENGTHS } from './analysis.mjs';
import { DOMAINS } from './controls.mjs';
import { STATUS_LABEL, TOOL_VERSION } from './model.mjs';
import { ensureDir, sha256 } from './util.mjs';

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const SEV_ORDER = ['critical', 'high', 'medium', 'low'];
const ms = (d) =>
  d < 1000
    ? `${d} ms`
    : d < 60000
      ? `${(d / 1000).toFixed(1)} s`
      : `${Math.floor(d / 60000)} min ${Math.round((d % 60000) / 1000)} s`;

// ---------------------------------------------------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------------------------------------------------

const CSS = `
:root{--bg:#f6f7f9;--panel:#fff;--ink:#14181f;--muted:#5b6575;--line:#e3e6eb;--accent:#0b6b5d;
--crit:#b3261e;--high:#d4571a;--med:#a8760a;--low:#4a6fa5;--ok:#1b7a43;--warn:#a8760a;--bad:#b3261e;--info:#5b6575;
--crit-bg:#fdecea;--high-bg:#fdeee5;--med-bg:#fbf3dc;--low-bg:#e9f0fa;--ok-bg:#e6f4ec;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0f1319;--panel:#171c24;--ink:#e8ecf2;--muted:#9aa5b5;--line:#272f3b;--accent:#4cc2ae;
--crit:#ff8a80;--high:#ffa270;--med:#f0c24d;--low:#8db3e8;--ok:#5fd18c;--warn:#f0c24d;--bad:#ff8a80;--info:#9aa5b5;
--crit-bg:#3a1b19;--high-bg:#3a2418;--med-bg:#352c12;--low-bg:#1a2536;--ok-bg:#15301f}}
:root[data-theme=dark]{--bg:#0f1319;--panel:#171c24;--ink:#e8ecf2;--muted:#9aa5b5;--line:#272f3b;--accent:#4cc2ae;--crit:#ff8a80;--high:#ffa270;--med:#f0c24d;--low:#8db3e8;--ok:#5fd18c;--warn:#f0c24d;--bad:#ff8a80;--info:#9aa5b5;--crit-bg:#3a1b19;--high-bg:#3a2418;--med-bg:#352c12;--low-bg:#1a2536;--ok-bg:#15301f}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:0 16px 64px}
header.top{padding:28px 0 8px}h1{font-size:26px;margin:0 0 4px}h2{font-size:20px;margin:36px 0 10px;padding-top:6px}h3{font-size:16px;margin:18px 0 6px}
.sub{color:var(--muted);font-size:13px}
.verdict{display:flex;gap:16px;align-items:center;padding:18px 20px;border-radius:12px;margin:18px 0;border:1px solid var(--line);background:var(--panel)}
.verdict .v{font-size:28px;font-weight:700;letter-spacing:.02em;padding:6px 16px;border-radius:8px}
.v.GO{background:var(--ok-bg);color:var(--ok)}.v.CONDITIONAL{background:var(--med-bg);color:var(--warn)}.v.NO-GO{background:var(--crit-bg);color:var(--bad)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card b{display:block;font-size:24px}.card span{color:var(--muted);font-size:12px}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden;font-size:13.5px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{background:color-mix(in srgb,var(--panel) 85%,var(--line));font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
tr:last-child td{border-bottom:0}.scroll{overflow-x:auto}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11.5px;font-weight:600;white-space:nowrap}
.s-critical{background:var(--crit-bg);color:var(--crit)}.s-high{background:var(--high-bg);color:var(--high)}.s-medium{background:var(--med-bg);color:var(--med)}.s-low{background:var(--low-bg);color:var(--low)}
.st-PASS,.st-ok{background:var(--ok-bg);color:var(--ok)}.st-FAIL{background:var(--crit-bg);color:var(--crit)}.st-PARTIAL{background:var(--high-bg);color:var(--high)}
.st-POLICY,.st-decision{background:var(--med-bg);color:var(--med)}.st-NOT-IMPLEMENTED,.st-gap{background:var(--low-bg);color:var(--low)}
.st-NOT-RUN,.st-NOT-ASSESSED,.st-info,.st-unknown,.st-N\\/A{background:color-mix(in srgb,var(--line) 60%,transparent);color:var(--muted)}.st-ACCEPTED{background:var(--ok-bg);color:var(--ok);outline:1px dashed var(--ok)}.st-deviation{background:var(--high-bg);color:var(--high)}
details.f{background:var(--panel);border:1px solid var(--line);border-left-width:4px;border-radius:10px;margin:10px 0;padding:0}
details.f.critical{border-left-color:var(--crit)}details.f.high{border-left-color:var(--high)}details.f.medium{border-left-color:var(--med)}details.f.low{border-left-color:var(--low)}
details.f>summary{cursor:pointer;padding:12px 14px;list-style:none;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}details.f>summary::-webkit-details-marker{display:none}
details.f .body{padding:0 14px 14px}.mono{font-family:var(--mono);font-size:12px}.ev{margin:6px 0;padding:8px 10px;background:color-mix(in srgb,var(--panel) 80%,var(--line));border-radius:6px;overflow-x:auto}
.reco{border-left:3px solid var(--accent);padding:6px 10px;margin:8px 0;background:color-mix(in srgb,var(--accent) 8%,transparent)}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}input[type=search],select{padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);font:inherit}
.muted{color:var(--muted)}ul.tight{margin:6px 0;padding-left:20px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:800px){.grid2{grid-template-columns:1fr}}
nav.toc{display:flex;gap:14px;flex-wrap:wrap;margin:6px 0 0;font-size:13px}nav.toc a{color:var(--accent);text-decoration:none}
.theme{float:right;font-size:12px;cursor:pointer;border:1px solid var(--line);background:var(--panel);color:var(--ink);padding:4px 10px;border-radius:8px}
@media print{.theme,.toolbar{display:none}details.f{break-inside:avoid}}
`;

const pill = (cls, text) => `<span class="pill ${cls}">${esc(text)}</span>`;
const sevPill = (s) => (s ? pill(`s-${s}`, s) : '');
const stPill = (s) => pill(`st-${s}`, STATUS_LABEL[s] ?? s);

function evidenceHtml(ev) {
  if (!ev?.length) return '';
  return `<div class="ev mono">${ev.map((e) => `${esc(e.file)}${e.line ? `:${e.line}` : ''} &nbsp; ${esc(e.text)}`).join('<br>')}</div>`;
}

export function renderHtml(m) {
  const v = m.verdict;
  const t = m.metrics.tests;
  const p0 = m.metrics.priority.P0;
  const p1 = m.metrics.priority.P1;
  const sev = m.metrics.openBySeverity;
  const open = m.findings.filter((f) => f.state === 'open');
  const closed = m.findings.filter((f) => f.state !== 'open');
  const pass = (p) => p.PASS + p.ACCEPTED;

  const findingHtml = (f) => `
<details class="f ${f.severity}" id="f-${esc(f.id)}"${f.severity === 'critical' || f.severity === 'high' ? ' open' : ''}>
  <summary>${sevPill(f.severity)} <b>${esc(f.title)}</b> ${f.policyDecision ? pill('st-POLICY', 'needs decision') : ''} ${f.state !== 'open' ? pill('st-ACCEPTED', f.state) : ''}
  <span class="muted mono">${esc(f.id)} · ${f.controls.map(esc).join(', ')}</span></summary>
  <div class="body">
    <p>${esc(f.summary)}</p>
    ${evidenceHtml(f.evidence)}
    ${f.recommendation ? `<div class="reco"><b>Recommended:</b> ${esc(f.recommendation)}</div>` : ''}
    ${f.decision ? `<p class="sub">Decision recorded: <b>${esc(f.decision.decision)}</b> by ${esc(f.decision.by)} on ${esc(f.decision.date)} — ${esc(f.decision.reason)}</p>` : `<p class="sub">Confidence: ${esc(f.confidence)}. To record a decision add <code>"${esc(f.id)}"</code> to tools/auth-audit/decisions.json.</p>`}
  </div>
</details>`;

  const controlRows = m.controls
    .map(
      (c) => `<tr data-s="${c.status}" data-p="${c.priority}" data-d="${c.domain}">
<td class="mono">${c.id}</td><td>${c.priority}</td><td>${esc(c.requirement)}</td><td>${stPill(c.status)} ${sevPill(c.severity)}</td>
<td class="mono">${c.checks.map((k) => esc(k.id)).join(', ') || '—'}${c.notRun.length ? `<br><span class="muted">not run: ${c.notRun.map(esc).join(', ')}</span>` : ''}</td>
<td class="mono">${c.tests ? `${c.tests.passed}/${c.tests.executed}${c.tests.failed ? ` <b style="color:var(--bad)">${c.tests.failed} failed</b>` : ''}` : '—'}</td><td class="mono">${esc(c.asvs)}</td></tr>`,
    )
    .join('');

  const statusCounts = (list) => {
    const o = {};
    for (const c of list) o[c.status] = (o[c.status] ?? 0) + 1;
    return o;
  };
  const sc = statusCounts(m.controls);

  const cfgRows = m.config
    .map(
      (r) =>
        `<tr><td>${esc(r.name)}</td><td>${esc(r.recommended)}</td><td>${esc(r.actual)}</td><td>${stPill(r.verdict)}</td><td class="muted">${esc(r.note)}</td></tr>`,
    )
    .join('');

  const testRows = (t.summaries ?? [])
    .map((s) =>
      s.ran
        ? `<tr><td>${esc(s.label)}</td><td>${s.total}</td><td>${s.passed}</td><td>${s.failed ? `<b style="color:var(--bad)">${s.failed}</b>` : 0}</td><td>${s.skipped}</td><td>${s.files.length}</td><td>${ms(s.ms)}</td></tr>`
        : `<tr><td>${esc(s.label)}</td><td colspan="6" class="muted">NOT RUN — ${esc(s.reason)}</td></tr>`,
    )
    .join('');

  const inv = t.inventory ?? [];
  const invByLayer = {};
  for (const f of inv) {
    const l = (invByLayer[f.layer] ??= { files: 0, declared: 0, traced: 0, skipped: 0 });
    l.files++;
    l.declared += f.declared;
    l.skipped += f.skipped;
    if (f.controls.length) l.traced += f.declared;
  }
  const invRows = Object.entries(invByLayer)
    .map(
      ([l, x]) =>
        `<tr><td>${esc(l)}</td><td>${x.files}</td><td>${x.declared}</td><td>${x.traced}</td><td>${x.skipped}</td></tr>`,
    )
    .join('');

  const pub = m.routes.publicList ?? [];
  const pubAuth = pub.filter((r) => /\/(auth|platform\/auth|account|realtime)(\/|$)/.test(r));

  const decisionBlock = `
<p>${Object.keys(m.decisions.applied).length} decision(s) applied from decisions.json.
${m.decisions.invalid.length ? `<br><b>Ignored (incomplete):</b> ${m.decisions.invalid.map((d) => esc(d.id)).join(', ')}` : ''}
${m.decisions.expired.length ? `<br><b>Expired (finding re-opened):</b> ${m.decisions.expired.map((d) => esc(d.id)).join(', ')}` : ''}</p>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authentication Audit</title><style>${CSS}</style></head><body><div class="wrap">
<header class="top"><button class="theme" onclick="var r=document.documentElement;r.dataset.theme=r.dataset.theme==='dark'?'light':'dark'">Theme</button>
<h1>Authentication Audit</h1>
<div class="sub">crm-platform · ${esc(m.meta.git.commit?.slice(0, 10) ?? 'no-git')}${m.meta.git.dirty ? ' (uncommitted changes)' : ''} on ${esc(m.meta.git.branch ?? '?')} · ${esc(new Date(m.meta.finishedAt).toISOString())} · ran ${ms(m.meta.durationMs)} · tool ${TOOL_VERSION}${m.meta.opts.full ? ' · full' : ' · quick'}${m.meta.opts.live ? ' · live probes' : ''}</div>
<nav class="toc"><a href="#findings">Findings</a><a href="#decisions">Decisions</a><a href="#controls">100 controls</a><a href="#config">Numeric config</a><a href="#tests">Tests</a><a href="#analysis">How auth works</a><a href="#notrun">Not run</a><a href="#standard">Standard adaptations</a><a href="#method">Method</a></nav></header>

<div class="verdict"><div class="v ${v.value}">${v.value}</div><div>
${v.reasons.length ? `<ul class="tight">${v.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : 'No blocking findings, all applicable P0 controls pass, all test layers ran.'}
<div class="sub">GO = no open Critical/High findings, every applicable P0 control Pass or Accepted, all test layers executed. CONDITIONAL = no blockers, but P0 gaps or un-run checks remain. NO-GO = an open Critical/High finding or a failing test.</div></div></div>

<div class="cards">
<div class="card"><b style="color:var(--crit)">${sev.critical}</b><span>open Critical</span></div>
<div class="card"><b style="color:var(--high)">${sev.high}</b><span>open High</span></div>
<div class="card"><b style="color:var(--med)">${sev.medium}</b><span>open Medium</span></div>
<div class="card"><b style="color:var(--low)">${sev.low}</b><span>open Low</span></div>
<div class="card"><b>${pass(p0)}/${p0.applicable}</b><span>P0 controls Pass or Accepted</span></div>
<div class="card"><b>${pass(p1)}/${p1.applicable}</b><span>P1 controls Pass or Accepted</span></div>
<div class="card"><b>${t.passed}/${t.total}</b><span>existing tests passed (${t.failed} failed, ${t.skipped} skipped)</span></div>
<div class="card"><b>${m.controls.length - (sc['NOT-ASSESSED'] ?? 0) - (sc['NOT-RUN'] ?? 0)}/${m.controls.length}</b><span>controls assessed by this run</span></div>
</div>

<h2 id="findings">Findings (${open.length} open${closed.length ? `, ${closed.length} dispositioned` : ''})</h2>
${open.length ? open.map(findingHtml).join('') : '<p>No open findings.</p>'}
${closed.length ? `<h3>Dispositioned</h3>${closed.map(findingHtml).join('')}` : ''}

<h2 id="decisions">Decisions needed from the team</h2>
<p class="sub">Findings marked <i>needs decision</i> are not bugs in the usual sense: the code does what it was written to do, and the standard asks for something different. Record the answer once in <code>tools/auth-audit/decisions.json</code> (decision, reason, by, date, optional expires) and the finding stops blocking while staying visible.</p>
<div class="scroll"><table><tr><th>Finding</th><th>Severity</th><th>Question</th></tr>
${
  m.findings
    .filter((f) => f.policyDecision && f.state === 'open')
    .map(
      (f) =>
        `<tr><td><a href="#f-${esc(f.id)}">${esc(f.id)}</a></td><td>${sevPill(f.severity)}</td><td>${esc(f.title)}</td></tr>`,
    )
    .join('') || '<tr><td colspan="3">None.</td></tr>'
}
</table></div>
${decisionBlock}

<h2 id="controls">The 100 controls</h2>
<p class="sub">Pass = a check or an executed test supports it. <b>Not assessed</b> = this tool has no check for it yet (it is NOT a pass). Not run = a check exists but did not execute (see below). ASVS column is chapter-level.</p>
<div class="cards">${Object.entries(sc)
    .map(([k, x]) => `<div class="card"><b>${x}</b><span>${esc(STATUS_LABEL[k] ?? k)}</span></div>`)
    .join('')}</div>
<div class="toolbar"><input type="search" id="q" placeholder="Filter controls…" oninput="flt()"><select id="fs" onchange="flt()"><option value="">All statuses</option>${Object.keys(
    sc,
  )
    .map((k) => `<option value="${k}">${esc(STATUS_LABEL[k] ?? k)}</option>`)
    .join('')}</select>
<select id="fp" onchange="flt()"><option value="">All priorities</option><option>P0</option><option>P1</option><option>P2</option><option>P3</option></select></div>
<div class="scroll"><table id="ct"><tr><th>ID</th><th>Pri</th><th>Requirement</th><th>Status</th><th>Checks</th><th>Tests</th><th>ASVS</th></tr>${controlRows}</table></div>
<script>function flt(){var q=document.getElementById('q').value.toLowerCase(),s=document.getElementById('fs').value,p=document.getElementById('fp').value;document.querySelectorAll('#ct tr[data-s]').forEach(function(r){r.style.display=(!s||r.dataset.s===s)&&(!p||r.dataset.p===p)&&(!q||r.textContent.toLowerCase().indexOf(q)>-1)?'':'none'})}</script>

<h2 id="config">Numeric configuration: recommended vs actual</h2>
<div class="scroll"><table><tr><th>Setting</th><th>Recommended</th><th>Actual</th><th></th><th>Note</th></tr>${cfgRows}</table></div>

<h2 id="tests">Tests</h2>
<h3>Executed this run</h3>
<div class="scroll"><table><tr><th>Layer</th><th>Tests</th><th>Passed</th><th>Failed</th><th>Skipped</th><th>Files</th><th>Time</th></tr>${testRows || '<tr><td colspan="7">No test layer ran.</td></tr>'}</table></div>
<h3>Auth-related tests that exist in the repository (declared, from source)</h3>
<div class="scroll"><table><tr><th>Layer</th><th>Files</th><th>Declared tests</th><th>Traced to a control</th><th>Skipped</th></tr>${invRows}</table></div>
<p class="sub">"Declared" counts it()/test() calls found in files whose path looks authentication-related; a parameterised test counts once. It is an inventory, not execution evidence — executed counts are the table above.</p>

<h2 id="analysis">How authentication works today <span class="sub">(analysis of ${ANALYSIS_DATE}, from the code)</span></h2>
<div class="scroll"><table><tr><th>Identity pool</th><th>Credential</th><th>Token</th><th>Server-side control</th><th>Code</th></tr>
${MECHANISMS.map((x) => `<tr><td><b>${esc(x.pool)}</b></td><td>${esc(x.credential)}</td><td>${esc(x.token)}</td><td>${esc(x.server)}</td><td class="mono">${esc(x.where)}</td></tr>`).join('')}</table></div>
<h3>What is already done well</h3><ul class="tight">${STRENGTHS.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
<h3>Entry points (from the route scanner)</h3>
<p>${m.routes.total} routes in ${m.routes.controllers} controllers; <b>${pub.length}</b> are public (no bearer token). Authentication entry points among them:</p>
<div class="ev mono">${pubAuth.map(esc).join('<br>')}</div>

<h2 id="notrun">What did not run</h2>
${m.notRun.length ? `<ul class="tight">${m.notRun.map((x) => `<li><b>${esc(x.id)}</b> — ${esc(x.why)}</li>`).join('')}</ul>` : '<p>Everything that was configured ran.</p>'}
<p class="sub">Environment: node ${esc(m.env.node)} · ${esc(m.env.platform)} · dependencies ${m.env.dependenciesInstalled ? 'installed' : 'NOT installed'} · docker ${esc(m.env.docker)} · gitleaks ${esc(m.env.gitleaks)} · semgrep ${esc(m.env.semgrep)} · k6 ${esc(m.env.k6)}</p>

<h2 id="standard">How the reference standard was adapted</h2>
<div class="scroll"><table><tr><th>Reference item</th><th>Decision</th><th>Why</th></tr>${ADAPTATIONS.map((a) => `<tr><td>${esc(a.topic)}</td><td>${esc(a.decision)}</td><td>${esc(a.why)}</td></tr>`).join('')}</table></div>

<h2 id="method">Method and limits</h2>
<ul class="tight">
<li><b>Static checks</b> read the source and fail loudly if the code they expect has moved; they never default to pass.</li>
<li><b>Runtime probes</b> import the product's own functions (TOTP, recovery codes, password policy, IP allow-list, return-URL sanitiser, audit redaction) and feed them attack inputs; they also measure Argon2 parameters.</li>
<li><b>Existing tests</b> are executed (not just counted) and traced to controls through a curated file→control map.</li>
<li><b>Live probes</b> (only with <code>--live</code>) attack a running local API: forged tokens, malformed bodies, enumeration/timing parity, lockout, logout/refresh-reuse, WebSocket handshake.</li>
<li><b>Dependencies</b>: <code>pnpm audit --prod</code>. <b>Secrets</b>: working-tree scan (+ gitleaks if installed).</li>
<li><b>Not claimed:</b> an automated run cannot prove the absence of vulnerabilities. Cross-tenant data isolation (RLS), payment and messaging flows are outside this audit. The sandbox this report ran in is listed under "What did not run" wherever it limited coverage. For changes to login, sessions, MFA or recovery, keep a human security review in the loop.</li>
</ul>
<p class="sub">Artefacts next to this file: results.json, findings.json, controls.csv, tests.json, manifest.json (SHA-256 of every artefact, commit, dirty flag).</p>
</div></body></html>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------------------------------------------------

const md = (s) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');

export function renderMarkdown(m) {
  const v = m.verdict;
  const t = m.metrics.tests;
  const sev = m.metrics.openBySeverity;
  const L = [];
  L.push('# Authentication Audit', '');
  L.push(`**Verdict: ${v.value}**`, '');
  for (const r of v.reasons) L.push(`- ${r}`);
  L.push(
    '',
    `crm-platform @ \`${m.meta.git.commit?.slice(0, 10) ?? 'no-git'}\`${m.meta.git.dirty ? ' (uncommitted changes)' : ''} on \`${m.meta.git.branch ?? '?'}\` · ${new Date(m.meta.finishedAt).toISOString()} · ran ${ms(m.meta.durationMs)} · tool ${TOOL_VERSION} · ${m.meta.opts.full ? 'full' : 'quick'}${m.meta.opts.live ? ' + live probes' : ''}`,
    '',
  );
  L.push(
    '| Open Critical | High | Medium | Low | P0 Pass/Accepted | P1 Pass/Accepted | Tests passed | Controls assessed |',
    '|---|---|---|---|---|---|---|---|',
  );
  const p0 = m.metrics.priority.P0;
  const p1 = m.metrics.priority.P1;
  const sc = {};
  for (const c of m.controls) sc[c.status] = (sc[c.status] ?? 0) + 1;
  L.push(
    `| ${sev.critical} | ${sev.high} | ${sev.medium} | ${sev.low} | ${p0.PASS + p0.ACCEPTED}/${p0.applicable} | ${p1.PASS + p1.ACCEPTED}/${p1.applicable} | ${t.passed}/${t.total} (${t.failed} failed, ${t.skipped} skipped) | ${m.controls.length - (sc['NOT-ASSESSED'] ?? 0) - (sc['NOT-RUN'] ?? 0)}/${m.controls.length} |`,
    '',
  );

  L.push('## Findings', '');
  const open = m.findings.filter((f) => f.state === 'open');
  if (!open.length) L.push('No open findings.', '');
  for (const f of open) {
    L.push(`### [${f.severity.toUpperCase()}] ${f.title}`, '');
    L.push(
      `\`${f.id}\` · controls ${f.controls.join(', ')} · ${f.policyDecision ? '**needs a decision** · ' : ''}confidence: ${f.confidence}`,
      '',
      f.summary,
      '',
    );
    for (const e of f.evidence.slice(0, 6))
      L.push(`- \`${e.file}${e.line ? `:${e.line}` : ''}\` ${md(e.text)}`);
    if (f.recommendation) L.push('', `**Recommended:** ${f.recommendation}`);
    L.push('');
  }
  const closed = m.findings.filter((f) => f.state !== 'open');
  if (closed.length) {
    L.push('### Dispositioned', '');
    for (const f of closed)
      L.push(
        `- \`${f.id}\` ${f.state}: ${f.decision?.reason ?? ''} (${f.decision?.by}, ${f.decision?.date})`,
      );
    L.push('');
  }

  L.push(
    '## Controls',
    '',
    `Status counts: ${Object.entries(sc)
      .map(([k, x]) => `${STATUS_LABEL[k] ?? k} ${x}`)
      .join(' · ')}`,
    '',
    '"Not assessed" means the tool has no check for the control yet. It is not a pass.',
    '',
  );
  L.push('| ID | Pri | Requirement | Status | Checks | Tests |', '|---|---|---|---|---|---|');
  for (const c of m.controls)
    L.push(
      `| ${c.id} | ${c.priority} | ${md(c.requirement)} | ${STATUS_LABEL[c.status]}${c.severity ? ` (${c.severity})` : ''} | ${c.checks.map((k) => k.id).join(', ') || '—'} | ${c.tests ? `${c.tests.passed}/${c.tests.executed}` : '—'} |`,
    );

  L.push(
    '',
    '## Numeric configuration',
    '',
    '| Setting | Recommended | Actual | Verdict |',
    '|---|---|---|---|',
  );
  for (const r of m.config)
    L.push(`| ${md(r.name)} | ${md(r.recommended)} | ${md(r.actual)} | ${r.verdict} |`);

  L.push(
    '',
    '## Tests executed',
    '',
    '| Layer | Tests | Passed | Failed | Skipped | Time |',
    '|---|---|---|---|---|---|',
  );
  for (const s of t.summaries ?? [])
    L.push(
      s.ran
        ? `| ${s.label} | ${s.total} | ${s.passed} | ${s.failed} | ${s.skipped} | ${ms(s.ms)} |`
        : `| ${s.label} | NOT RUN: ${md(s.reason)} | | | | |`,
    );

  L.push(
    '',
    '## How authentication works today',
    '',
    '| Pool | Credential | Token | Server-side control |',
    '|---|---|---|---|',
  );
  for (const x of MECHANISMS)
    L.push(`| ${md(x.pool)} | ${md(x.credential)} | ${md(x.token)} | ${md(x.server)} |`);
  L.push('', '### Done well', '', ...STRENGTHS.map((x) => `- ${x}`));

  L.push('', '## What did not run', '');
  if (!m.notRun.length) L.push('Everything configured ran.');
  for (const x of m.notRun) L.push(`- **${x.id}** — ${x.why}`);

  L.push(
    '',
    '## Reference standard: adaptations',
    '',
    '| Item | Decision | Why |',
    '|---|---|---|',
  );
  for (const a of ADAPTATIONS) L.push(`| ${md(a.topic)} | ${md(a.decision)} | ${md(a.why)} |`);
  L.push(
    '',
    '---',
    'An automated run cannot prove the absence of vulnerabilities; keep a human security review for login, session, MFA and recovery changes.',
  );
  return L.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------
// CSV, JSON, manifest, files
// ---------------------------------------------------------------------------------------------------------------------

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function renderCsv(m) {
  const head = [
    'id',
    'priority',
    'domain',
    'requirement',
    'asvs_chapter',
    'status',
    'worst_open_severity',
    'checks',
    'tests_executed',
    'tests_passed',
    'tests_failed',
  ];
  const rows = m.controls.map((c) =>
    [
      c.id,
      c.priority,
      DOMAINS[c.domain],
      c.requirement,
      c.asvs,
      STATUS_LABEL[c.status],
      c.severity ?? '',
      c.checks.map((k) => `${k.id}:${k.status}`).join(' '),
      c.tests?.executed ?? '',
      c.tests?.passed ?? '',
      c.tests?.failed ?? '',
    ]
      .map(csvCell)
      .join(','),
  );
  return [head.join(','), ...rows].join('\n') + '\n';
}

export function writeReports(m, outDir) {
  ensureDir(outDir);
  const files = {
    'report.html': renderHtml(m),
    'report.md': renderMarkdown(m),
    'controls.csv': renderCsv(m),
    'findings.json': JSON.stringify({ verdict: m.verdict, findings: m.findings }, null, 2),
    'tests.json': JSON.stringify(
      { executed: m.metrics.tests.summaries, inventory: m.metrics.tests.inventory },
      null,
      2,
    ),
    'results.json': JSON.stringify(
      {
        meta: m.meta,
        env: m.env,
        verdict: m.verdict,
        metrics: {
          ...m.metrics,
          tests: { ...m.metrics.tests, summaries: undefined, inventory: undefined },
        },
        controls: m.controls,
        config: m.config,
        routes: { total: m.routes.total, public: m.routes.publicList },
        checks: m.checks.map((c) => ({ ...c, data: undefined })),
        decisions: m.decisions,
      },
      null,
      2,
    ),
  };
  const manifest = {
    tool: 'auth-audit',
    version: TOOL_VERSION,
    generatedAt: new Date().toISOString(),
    commit: m.meta.git.commit,
    branch: m.meta.git.branch,
    dirty: m.meta.git.dirty,
    verdict: m.verdict.value,
    files: {},
  };
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(outDir, name), body);
    manifest.files[name] = { sha256: sha256(body), bytes: Buffer.byteLength(body) };
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { files: Object.keys(files).concat('manifest.json'), manifest };
}

/** Keeps reports/auth-audit/latest/ as a copy of the newest run and makes sure generated files are never committed. */
export function publishLatest(reportsRoot, runDir) {
  ensureDir(reportsRoot);
  const ignore = join(reportsRoot, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n!.gitignore\n');
  const latest = join(reportsRoot, 'latest');
  mkdirSync(latest, { recursive: true });
  for (const f of readdirSync(runDir)) copyFileSync(join(runDir, f), join(latest, f));
  return latest;
}

export { readFileSync };
