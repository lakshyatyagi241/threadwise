// Small HTML helpers for the per-task QA reports: a self-contained page (light/dark, print-friendly), cards, tables, lists.
// Everything that comes from a check or a baseline file goes through `esc`; the snippets passed as `html` are written in builders.mjs.

export const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const code = (s) => `<code>${esc(s)}</code>`;

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--tx:#1b1f24;--mut:#5b6573;--bd:#dde1e6;--red:#b42318;--amb:#b7791f;--grn:#2f855a;--blu:#2b6cb0}
@media (prefers-color-scheme:dark){:root{--bg:#0f1318;--card:#171c23;--tx:#e6e9ee;--mut:#94a0b0;--bd:#2a323d}}
@media print{:root{--bg:#fff}body{font-size:12px}.card{break-inside:avoid}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px 56px}
h1{font-size:25px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 10px;border-bottom:1px solid var(--bd);padding-bottom:6px}h3{font-size:15px;margin:0 0 6px}
.sub{color:var(--mut);margin:0 0 16px;font-size:13px}
.banner{border-radius:10px;padding:14px 16px;margin:14px 0;border:1px solid var(--bd);border-left:6px solid var(--amb);background:var(--card)}
.banner.red{border-left-color:var(--red)}.banner.grn{border-left-color:var(--grn)}.banner b{font-size:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:12px 0}
.stat{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:10px 12px}.stat b{display:block;font-size:22px}.stat span{color:var(--mut);font-size:12px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:12px 16px;margin:10px 0;border-left:5px solid var(--bd)}
.card.high{border-left-color:var(--red)}.card.med{border-left-color:var(--amb)}.card.low{border-left-color:var(--blu)}.card.ok{border-left-color:var(--grn)}
.tag{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 8px;border-radius:999px;color:#fff;margin-right:8px;vertical-align:middle}
.t-pass,.t-ok{background:var(--grn)}.t-fail,.t-high{background:var(--red)}.t-warn,.t-med{background:var(--amb)}.t-skip,.t-low{background:var(--blu)}
code{background:rgba(127,127,127,.15);padding:1px 5px;border-radius:4px;font-size:12.5px;word-break:break-word}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--bd);border-radius:10px;overflow:hidden;font-size:13.5px}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--bd);vertical-align:top}th{background:rgba(127,127,127,.1)}
.wrap{overflow-x:auto}p{margin:6px 0}ul{margin:6px 0 6px 20px;padding:0}.k{color:var(--mut)}
details{margin:8px 0}summary{cursor:pointer;font-weight:600}
`;

export const tag = (status, label) =>
  `<span class="tag t-${status}">${esc(label ?? status)}</span>`;
export const card = (cls, label, titleHtml, bodyHtml) =>
  `<div class="card ${cls}"><h3>${tag(cls, label)}${titleHtml}</h3>${bodyHtml}</div>`;
export const section = (title, inner) => `<h2>${esc(title)}</h2>${inner}`;
export const list = (items) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
export const details = (summary, inner) =>
  `<details><summary>${esc(summary)}</summary>${inner}</details>`;
export const table = (head, rows) =>
  `<div class="wrap"><table><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</table></div>`;

/** One full report page for a task. `verdictClass` is '' (amber), 'red' or 'grn'. */
export function page({ task, meta, title, verdictClass, verdictHtml, tiles, sections }) {
  const t = task.task;
  const counts = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const c of task.checks) counts[c.status] = (counts[c.status] ?? 0) + 1;
  const rows = task.checks
    .map(
      (c) =>
        `<tr><td>${tag(c.status)}</td><td>${code(c.id)}</td><td>${esc(c.title)}</td><td>${esc(c.detail ?? '')}</td></tr>`,
    )
    .join('');
  const tilesHtml = tiles
    .map(([k, v]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(k)}</span></div>`)
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA ${esc(t.id)} ${esc(title)}: report</title><style>${CSS}</style></head><body><main>
<h1>QA task ${esc(t.id)}: ${esc(title)}</h1>
<p class="sub">Priority ${esc(t.priority)} · owner ${esc(t.owner)} · crm-platform at commit ${code(meta.commit)} · run ${esc(String(meta.generatedAt).slice(0, 10))} · live checks run: ${meta.live?.db ? 'database' : 'none'}</p>
<p><b>Target:</b> ${esc(t.target)}</p>
<div class="banner ${verdictClass}">${verdictHtml}</div>
<div class="grid">${tilesHtml}
<div class="stat"><b>${counts.pass} / ${counts.warn} / ${counts.fail} / ${counts.skip}</b><span>pass / warn / fail / skipped</span></div></div>
<h2>Checks run</h2><div class="wrap"><table><tr><th>Status</th><th>Check</th><th>What it verifies</th><th>Result</th></tr>${rows}</table></div>
<p class="k">Skipped means the check needs a running stack that was not configured. It is never counted as a pass.</p>
${sections}
</main></body></html>`;
}
