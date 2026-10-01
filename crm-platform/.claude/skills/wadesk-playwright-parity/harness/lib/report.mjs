// Turns findings into things people (and fix agents) act on:
//   report.md       whole run, defects first
//   parity rows     the compact table that goes into docs/wadesk-port/parity/<domain>.md (no screenshots, no WaDesk text)
//   clusters.json   defects grouped by cause/layer so one sub-agent can own one cluster
//   gallery.html    side-by-side screenshots (artifacts stay in the run dir, never in the repo)
import { join, relative } from 'node:path';
import { writeFileSync, existsSync } from 'node:fs';
import { oneLine, ensureDir, slug } from './util.mjs';

const fmt = (v) => {
  if (v === undefined) return 'not observed';
  if (v === null) return 'n/a';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  return oneLine(JSON.stringify(v), 140);
};

export function describe(f) {
  if (f.key === '(scenario)')
    return { w: fmt(f.wadesk ?? 'works'), o: fmt(f.ours ?? f.note), what: f.note || '' };
  const d = f.detail;
  let extra = '';
  if (d?.missingInOurs?.length || d?.extraInOurs?.length)
    extra = ` (missing in ours: ${fmt(d.missingInOurs)}; extra in ours: ${fmt(d.extraInOurs)})`;
  if (d?.fields)
    extra = ` (${d.fields.map((x) => `${x.field}: ${fmt(x.wadesk)} vs ${fmt(x.ours)}`).join('; ')})`;
  if (d?.ratio) extra = ` (x${d.ratio} slower)`;
  if (d?.note) extra += ` [${d.note}]`;
  return { w: fmt(f.wadesk), o: fmt(f.ours), what: `${f.key}${extra}` };
}

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SEV_ORDER = { blocker: 0, major: 1, minor: 2, info: 3 };
const bySeverity = (a, b) =>
  (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3) ||
  a.scenario.localeCompare(b.scenario);
const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function verdict(summary, { envBlocked = false } = {}) {
  if (envBlocked) return 'INCOMPLETE';
  if (summary.defect > 0) return 'FAIL';
  if (summary.review > 0 || summary['spec-issue'] > 0) return 'REVIEW';
  return 'PASS';
}

export function renderMarkdown({ meta, specs, findings, summary, runDir, pairs = [] }) {
  const L = [];
  const feats = [...new Set(specs.map((s) => s.feature))].join(', ');
  L.push(`# Parity run: ${feats}`, '');
  L.push(
    `- run: \`${runDir}\``,
    `- when: ${meta.startedAt}  |  depth: ${meta.depth}  |  sides: ${meta.sides.join(' + ')}`,
  );
  L.push(
    `- verdict: **${verdict(summary)}**  (same ${summary.same}, intended ${summary.intended}, defect ${summary.defect} in ${summary.defectScenarios} scenario(s), review ${summary.review}, skipped ${summary.skipped}, spec-issue ${summary['spec-issue']})`,
  );
  L.push(
    `- defective scenarios by worst severity: blocker ${summary.defectScenariosBySeverity.blocker}, major ${summary.defectScenariosBySeverity.major}, minor ${summary.defectScenariosBySeverity.minor}`,
    '',
  );

  const defects = findings.filter((f) => f.result === 'defect').sort(bySeverity);
  L.push('## Defects (fix these)', '');
  if (!defects.length) L.push('None.', '');
  else {
    // one row per scenario: a single root cause usually shows up as several keys (accepted, outcome, status, stored)
    const byScenario = new Map();
    for (const f of defects)
      (byScenario.get(f.scenario) || byScenario.set(f.scenario, []).get(f.scenario)).push(f);
    L.push(
      '| # | Sev | Kind | Scenario | What differs (WaDesk -> ours) |',
      '|---|---|---|---|---|',
    );
    let i = 0;
    for (const [id, fs] of byScenario) {
      const sev = fs
        .map((f) => f.severity)
        .sort((a, b) => (SEV_ORDER[a] ?? 3) - (SEV_ORDER[b] ?? 3))[0];
      const parts = fs.map((f) => {
        const d = describe(f);
        return f.key === '(scenario)'
          ? `${d.o}`
          : `${f.key}: ${d.w} -> ${d.o}${f.detail?.missingInOurs?.length || f.detail?.extraInOurs?.length ? ` (missing in ours ${fmt(f.detail.missingInOurs)}, extra ${fmt(f.detail.extraInOurs)})` : ''}`;
      });
      L.push(`| ${++i} | ${sev} | ${fs[0].kind || ''} | \`${id}\` | ${esc(parts.join('; '))} |`);
    }
    L.push('');
  }

  const review = findings.filter((f) => f.result === 'review').sort(bySeverity);
  L.push(
    '## Review (structure differs; look at the screenshots, then decide defect / intended / ignore)',
    '',
  );
  if (!review.length) L.push('None.', '');
  else {
    const byScenario = new Map();
    for (const f of review)
      (byScenario.get(f.scenario) || byScenario.set(f.scenario, []).get(f.scenario)).push(f);
    L.push('| Scenario | What differs (WaDesk -> ours) |', '|---|---|');
    for (const [id, fs] of byScenario)
      L.push(
        `| \`${id}\` | ${esc(fs.map((f) => `${f.key.replace(/^ui\./, '')}: ${fmt(f.wadesk)} -> ${fmt(f.ours)}`).join('; '))} |`,
      );
    L.push('');
  }

  if (pairs.length) {
    L.push(
      '## Side-by-side screenshots (WaDesk left, ours right): read these for the review items',
      '',
    );
    for (const p of pairs) L.push(`- ${p}`);
    L.push('');
  }

  const intended = findings.filter((f) => f.result === 'intended');
  L.push('## Intended deviations', '');
  if (!intended.length) L.push('None.', '');
  else {
    L.push('| Scenario | Key | WaDesk | Ours | Rule | Reason |', '|---|---|---|---|---|---|');
    for (const f of intended)
      L.push(
        `| \`${f.scenario}\` | ${f.key} | ${esc(fmt(f.wadesk))} | ${esc(fmt(f.ours))} | ${f.rule} | ${esc(f.reason)} (${esc(f.ref || '')}) |`,
      );
    L.push('');
  }

  const spec = findings.filter((f) => f.result === 'spec-issue');
  if (spec.length) {
    L.push('## Spec problems (the test itself is wrong or the reference side failed)', '');
    for (const f of spec) L.push(`- \`${f.scenario}\`: ${f.note}`);
    L.push('');
  }
  const skipped = findings.filter((f) => f.result === 'skipped');
  if (skipped.length) {
    L.push('## Skipped (not compared)', '');
    for (const f of skipped) L.push(`- \`${f.scenario}\`: ${f.note}`);
    L.push('');
  }

  // coverage by family
  const fam = new Map();
  for (const f of findings) {
    const k = f.scenario.split('.').slice(0, 2).join('.');
    const e = fam.get(k) || { same: 0, defect: 0, intended: 0, review: 0, scenarios: new Set() };
    e.scenarios.add(f.scenario);
    if (f.result in e) e[f.result] += 1;
    fam.set(k, e);
  }
  L.push(
    '## Coverage by family',
    '',
    '| Family | Scenarios | same | intended | defect | review |',
    '|---|---|---|---|---|---|',
  );
  for (const [k, e] of [...fam.entries()].sort())
    L.push(
      `| ${k} | ${e.scenarios.size} | ${e.same} | ${e.intended} | ${e.defect} | ${e.review} |`,
    );
  L.push('');
  return L.join('\n');
}

/** Rows for docs/wadesk-port/parity/<domain>.md. Behaviour only: no WaDesk text, no screenshots. */
export function renderParityRows({ findings }) {
  const byScenario = new Map();
  for (const f of findings)
    (byScenario.get(f.scenario) || byScenario.set(f.scenario, []).get(f.scenario)).push(f);
  const groups = new Map();
  for (const [id, fs] of byScenario) {
    const worst = fs.some((f) => f.result === 'defect')
      ? 'defect'
      : fs.some((f) => f.result === 'review')
        ? 'review'
        : fs.some((f) => f.result === 'intended')
          ? 'intended'
          : fs.every((f) => f.result === 'skipped')
            ? 'skipped'
            : fs.some((f) => f.result === 'spec-issue')
              ? 'spec-issue'
              : 'same';
    const fam = id.split('.').slice(0, 2).join('.');
    const g = groups.get(fam) || { fam, total: 0, same: 0, odd: [] };
    g.total += 1;
    if (worst === 'same') g.same += 1;
    else g.odd.push({ id, worst, fs });
    groups.set(fam, g);
  }
  const rows = [];
  let n = 0;
  for (const g of groups.values()) {
    if (g.same)
      rows.push(
        `| ${++n} | ${g.fam}: ${g.same}/${g.total} cases | equivalent | equivalent | same | |`,
      );
    for (const o of g.odd) {
      const main = o.fs.find((f) => f.result === o.worst) || o.fs[0];
      const d = describe(main);
      rows.push(
        `| ${++n} | ${o.id} | ${esc(d.w)} | ${esc(d.o)} | ${o.worst} | ${esc(main.reason ? `${main.rule}: ${main.reason}` : d.what)} |`,
      );
    }
  }
  return [
    '| # | Criterion / UX item | WaDesk observed | Ours observed | Result | Note / reason |',
    '|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

const LAYER = {
  functional: 'api',
  validation: 'both',
  security: 'api',
  data: 'api',
  missing: 'web',
  ui: 'web',
  ux: 'web',
  a11y: 'web',
  perf: 'both',
  robustness: 'both',
};

export function defectClusters({ findings, specs, runDir }) {
  const defects = findings.filter((f) => f.result === 'defect');
  const map = new Map();
  for (const f of defects) {
    const parts = f.scenario.split('.');
    const family = parts.length > 2 ? parts.slice(0, 2).join('.') : parts[0];
    const key = `${f.feature || ''}|${family}|${f.kind || 'functional'}`;
    const c = map.get(key) || {
      id: `C${map.size + 1}`,
      feature: f.feature,
      family,
      kind: f.kind || 'functional',
      layer: LAYER[f.kind] || 'both',
      severity: 'minor',
      scenarios: new Set(),
      keys: new Set(),
      examples: [],
    };
    c.scenarios.add(f.scenario);
    c.keys.add(f.key);
    if ((SEV_ORDER[f.severity] ?? 3) < (SEV_ORDER[c.severity] ?? 3)) c.severity = f.severity;
    if (c.examples.length < 4)
      c.examples.push({
        scenario: f.scenario,
        key: f.key,
        wadesk: f.wadesk,
        ours: f.ours,
        note: f.note || f.detail,
      });
    map.set(key, c);
  }
  const spec = specs[0];
  return [...map.values()]
    .sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3))
    .map((c, i) => ({
      ...c,
      id: `C${i + 1}`,
      scenarios: [...c.scenarios],
      keys: [...c.keys],
      title: `${c.family}: ${[...c.keys].slice(0, 3).join(', ')}${c.keys.size > 3 ? ', ...' : ''}`,
      rerun: `bash .claude/skills/wadesk-playwright-parity/scripts/parity.sh rerun ${runDir || '<runDir>'} ${spec ? relative(process.cwd(), spec.file) : '<spec>'} '^(${[...c.scenarios].map(escapeRx).join('|')})$'`,
    }));
}

export function renderGallery({ runDir, findings }) {
  const bad = new Set(
    findings.filter((f) => ['defect', 'review'].includes(f.result)).map((f) => f.scenario),
  );
  const rows = [];
  const byScenario = new Map();
  for (const f of findings)
    (byScenario.get(f.scenario) || byScenario.set(f.scenario, []).get(f.scenario)).push(f);
  for (const [id, fs] of byScenario) {
    const dir = join(runDir, 'shots', slug(id));
    const shots = [];
    for (const label of [
      'load',
      'form-open',
      'after-submit',
      'list',
      'search-miss',
      'degraded',
      'responsive-mobile',
      'responsive-desktop',
      'all-empty',
      'confirm',
      'after-delete',
      'error',
    ]) {
      const w = join(dir, `wadesk-${label}.png`);
      const o = join(dir, `ours-${label}.png`);
      if (existsSync(w) || existsSync(o))
        shots.push({
          label,
          w: existsSync(w) ? relative(runDir, w) : '',
          o: existsSync(o) ? relative(runDir, o) : '',
        });
    }
    if (!shots.length) continue;
    const verdictOf = fs.some((f) => f.result === 'defect')
      ? 'defect'
      : fs.some((f) => f.result === 'review')
        ? 'review'
        : 'ok';
    rows.push(
      `<section class="${verdictOf}"><h2>${id} <small>${verdictOf}</small></h2>${shots.map((s) => `<h3>${s.label}</h3><div class="pair"><figure><figcaption>WaDesk</figcaption>${s.w ? `<img loading="lazy" src="${s.w}">` : '<em>no screenshot</em>'}</figure><figure><figcaption>Ours</figcaption>${s.o ? `<img loading="lazy" src="${s.o}">` : '<em>no screenshot</em>'}</figure></div>`).join('')}</section>`,
    );
  }
  void bad;
  return `<!doctype html><meta charset="utf-8"><title>Parity gallery</title><style>body{font:14px system-ui;margin:16px;background:#fafafa;color:#111}section{margin:0 0 28px;padding:12px;border-radius:8px;background:#fff;border:1px solid #ddd}section.defect{border-color:#d33}section.review{border-color:#e9a400}small{font-weight:400;color:#666}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}img{max-width:100%;border:1px solid #ccc}figcaption{font-weight:600;margin-bottom:4px}</style><h1>Parity gallery</h1><p>Artifacts live outside the repo. WaDesk screenshots are reference material: never commit them.</p>${rows.join('')}`;
}

export function writeReports({ runDir, meta, specs, findings, summary, pairs = [] }) {
  ensureDir(runDir);
  const md = renderMarkdown({ meta, specs, findings, summary, runDir, pairs });
  writeFileSync(join(runDir, 'report.md'), md);
  writeFileSync(join(runDir, 'parity-rows.md'), renderParityRows({ findings }) + '\n');
  writeFileSync(join(runDir, 'gallery.html'), renderGallery({ runDir, findings }));
  const clusters = defectClusters({ findings, specs, runDir });
  writeFileSync(join(runDir, 'clusters.json'), JSON.stringify(clusters, null, 2) + '\n');
  return { md, clusters };
}
