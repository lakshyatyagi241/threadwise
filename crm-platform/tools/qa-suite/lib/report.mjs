import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './core.mjs';

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const ORDER = { fail: 0, warn: 1, skip: 2, pass: 3 };

export function summarise(results) {
  const t = { pass: 0, fail: 0, warn: 0, skip: 0 };
  for (const r of results) for (const c of r.checks) t[c.status]++;
  return t;
}

function html(meta, results) {
  const tot = summarise(results);
  const rows = results
    .map((r) => {
      const s = summarise([r]);
      const verdict = s.fail
        ? 'fail'
        : r.target?.met === false
          ? 'fail'
          : s.skip && !s.pass
            ? 'skip'
            : s.skip
              ? 'warn'
              : 'pass';
      return `<details class="task" ${verdict === 'fail' ? 'open' : ''}>
<summary><span class="b ${verdict}">${verdict === 'skip' ? 'not run' : verdict}</span> <b>#${r.task.id} ${esc(r.task.name)}</b> <span class="muted">${r.task.priority} · ${esc(r.task.owner ?? '')}</span>
<span class="n">${s.pass} pass · ${s.fail} fail · ${s.warn} warn · ${s.skip} skipped</span></summary>
<p class="muted">Target: ${esc(r.task.target)}</p>
${r.target ? `<p><b>Target ${r.target.met === true ? 'met' : r.target.met === false ? 'NOT met' : 'not measurable here'}:</b> ${esc(r.target.text)}</p>` : ''}
${
  Object.keys(r.metrics ?? {}).length
    ? `<p class="metrics">${Object.entries(r.metrics)
        .map(([k, v]) => `<span><b>${esc(v)}</b> ${esc(k)}</span>`)
        .join('')}</p>`
    : ''
}
<table><tr><th>Status</th><th>Check</th><th>Detail</th></tr>
${[...r.checks]
  .sort((a, b) => ORDER[a.status] - ORDER[b.status])
  .map(
    (c) =>
      `<tr><td><span class="b ${c.status}">${c.status}</span></td><td>${esc(c.title)}<br><code>${esc(c.id)}</code></td><td>${esc(c.detail)}${c.evidence?.length ? `<details><summary>${c.evidence.length} item(s)</summary><pre>${esc(c.evidence.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n'))}</pre></details>` : ''}</td></tr>`,
  )
  .join('')}
</table></details>`;
    })
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA suite report</title><style>
:root{--bg:#fff;--fg:#1a1a1a;--mut:#666;--line:#ddd;--card:#f7f7f8;--pass:#1e8449;--fail:#c0392b;--warn:#d68910;--skip:#7f8c8d}
@media(prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#e8e8e8;--mut:#9aa0a6;--line:#2c2f36;--card:#1d2026}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;max-width:1150px;margin:0 auto;padding:24px 16px}.muted{color:var(--mut)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin:16px 0}.stat{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 14px}.stat b{font-size:26px;display:block}
.task{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 14px;margin:8px 0}summary{cursor:pointer}.n{float:right;color:var(--mut);font-size:13px}
.b{color:#fff;border-radius:4px;padding:1px 7px;font-size:12px;text-transform:uppercase}.pass{background:var(--pass)}.fail{background:var(--fail)}.warn{background:var(--warn)}.skip{background:var(--skip)}
.metrics span{display:inline-block;margin-right:16px}table{border-collapse:collapse;width:100%;font-size:13px;display:block;overflow-x:auto}th,td{border-bottom:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top}
pre{font:12px ui-monospace,monospace;white-space:pre-wrap;word-break:break-all;margin:4px 0}code{font:12px ui-monospace,monospace}</style></head><body>
<h1>QA suite report</h1><p class="muted">${esc(meta.generatedAt)} · ${esc(meta.branch)} @ ${esc(meta.commit)} · live API: ${esc(meta.live.api || 'off')} · live DB: ${esc(meta.live.db ? 'on' : 'off')}</p>
<div class="grid">${['pass', 'fail', 'warn', 'skip'].map((k) => `<div class="stat"><b>${tot[k]}</b><span class="b ${k}">${k === 'skip' ? 'skipped' : k}</span></div>`).join('')}</div>
<p><b>Skipped</b> means the check needs a running stack (database, API or web) that was not configured. It is not a pass. See the README for the environment variables.</p>
${rows}</body></html>`;
}

function md(meta, results) {
  const out = [
    `# QA suite report`,
    ``,
    `${meta.generatedAt} · ${meta.branch} @ ${meta.commit}`,
    ``,
  ];
  for (const r of results) {
    const s = summarise([r]);
    out.push(
      `## #${r.task.id} ${r.task.name} (${r.task.priority})`,
      `Target: ${r.task.target}`,
      r.target
        ? `Result: ${r.target.met === true ? 'MET' : r.target.met === false ? 'NOT MET' : 'not measurable here'} — ${r.target.text}`
        : '',
      `${s.pass} pass, ${s.fail} fail, ${s.warn} warn, ${s.skip} skipped`,
      ``,
    );
    for (const c of r.checks)
      out.push(`- [${c.status}] ${c.title}${c.detail ? ` — ${c.detail}` : ''}`);
    out.push('');
  }
  return out.join('\n');
}

export function writeReport(meta, results) {
  const stamp = meta.generatedAt.replace(/[:.]/g, '-').slice(0, 19);
  const dir = join(ROOT, 'reports/qa-suite', stamp);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.html'), html(meta, results));
  writeFileSync(join(dir, 'report.md'), md(meta, results));
  writeFileSync(join(dir, 'results.json'), JSON.stringify({ meta, results }, null, 2));
  const latest = join(ROOT, 'reports/qa-suite/latest');
  rmSync(latest, { recursive: true, force: true });
  cpSync(dir, latest, { recursive: true });
  return join(latest, 'report.html');
}
