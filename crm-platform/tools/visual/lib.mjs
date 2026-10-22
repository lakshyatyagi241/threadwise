// Visual regression library (QA task 21). Pure functions: scenario lists and Playwright JSON reports in, verdicts out.
//
//   coverage: how many P0/P1 scenarios (one page at one viewport) have a committed baseline, and, after a run, how many were
//             really compared and matched. The target is 95% for P0 and for P1 taken separately; the page list comes from the same
//             generator the spec uses, so a new page without a baseline lowers the number the day it is added.
//   flake:    a scenario that did not give the same answer every time it ran. For a P0 that is a failure of the run.

/** Playwright's file name for a baseline: the scenario id (it is already a safe name). */
export const baselineName = (id) => `${id}.png`;

/**
 * @param {{ scenarios: Array<{id:string,priority:string,url:string,viewport:string}>, baselines: string[], passed?: Set<string>, known?: Record<string,string>, target?: number }} input
 */
export function coverage({ scenarios, baselines, passed, known = {}, target = 0.95 }) {
  const have = new Set(baselines);
  const ids = new Set(scenarios.map((s) => baselineName(s.id)));
  const out = {
    target,
    byPriority: {},
    missing: [],
    orphans: baselines.filter((b) => !ids.has(b)).sort(),
  };
  for (const p of ['P0', 'P1', 'P2']) {
    const list = scenarios.filter((s) => s.priority === p);
    const withBaseline = list.filter((s) => have.has(baselineName(s.id)) && !known[s.url]);
    const verified = passed ? list.filter((s) => passed.has(s.id)) : null;
    out.byPriority[p] = {
      scenarios: list.length,
      withBaseline: withBaseline.length,
      known: list.filter((s) => known[s.url]).length,
      ...(verified ? { verified: verified.length } : {}),
      coverage: list.length ? withBaseline.length / list.length : 1,
      ...(verified ? { verifiedCoverage: list.length ? verified.length / list.length : 1 } : {}),
    };
    if (p !== 'P2')
      for (const s of list)
        if (!have.has(baselineName(s.id)) || known[s.url])
          out.missing.push({
            id: s.id,
            priority: p,
            why: known[s.url] ? `known: ${known[s.url]}` : 'no baseline',
          });
  }
  const gated = ['P0', 'P1'].map((p) => out.byPriority[p]);
  const n = gated.reduce((a, g) => a + g.scenarios, 0);
  out.combined = n ? gated.reduce((a, g) => a + g.withBaseline, 0) / n : 1;
  return out;
}

/** Findings of the coverage gate: each is {severity, subject, detail}; Critical and High block. */
export function coverageGate(cov) {
  const f = [];
  for (const p of ['P0', 'P1']) {
    const g = cov.byPriority[p];
    if (g.coverage < cov.target)
      f.push({
        severity: p === 'P0' ? 'Critical' : 'High',
        subject: `${p} coverage`,
        detail: `${(g.coverage * 100).toFixed(1)}% of ${g.scenarios} scenarios have a baseline; the target is ${cov.target * 100}%`,
      });
    if (g.verifiedCoverage !== undefined && g.verifiedCoverage < cov.target)
      f.push({
        severity: p === 'P0' ? 'Critical' : 'High',
        subject: `${p} verified`,
        detail: `${(g.verifiedCoverage * 100).toFixed(1)}% of ${g.scenarios} scenarios were compared and matched in this run`,
      });
  }
  for (const o of cov.orphans)
    f.push({
      severity: 'Medium',
      subject: o,
      detail: 'a baseline with no scenario (the page was removed or renamed): delete it',
    });
  return f;
}

/**
 * Flakiness from one or more Playwright JSON reports (a run with --repeat-each, or several runs). A scenario is flaky when its
 * results are not all the same, or Playwright itself called it flaky (it passed only on a retry).
 * @returns {{ total: number, runs: number, flaky: Array<{title:string,priority:string,statuses:string[]}> , failed: Array<{title:string,priority:string}> , passedIds: Set<string> }}
 */
export function flakiness(reports) {
  const byTest = new Map();
  const walk = (suite, trail) => {
    for (const s of suite.specs ?? []) {
      for (const t of s.tests ?? []) {
        const key = `${t.projectName}|${s.file ?? trail}|${s.title}`;
        const e = byTest.get(key) ?? { title: s.title, statuses: [], playwrightFlaky: false };
        for (const r of t.results ?? []) if (r.status !== 'skipped') e.statuses.push(r.status);
        if (t.status === 'flaky') e.playwrightFlaky = true;
        if (t.status === 'skipped') e.skipped = true;
        byTest.set(key, e);
      }
    }
    for (const c of suite.suites ?? []) walk(c, c.file ?? trail);
  };
  for (const r of reports) for (const s of r.suites ?? []) walk(s, s.file);
  const flaky = [];
  const failed = [];
  const passedIds = new Set();
  let runs = 0;
  for (const e of byTest.values()) {
    if (e.skipped && !e.statuses.length) continue;
    const priority = /^(P[012]) /.exec(e.title)?.[1] ?? 'P1';
    runs = Math.max(runs, e.statuses.length);
    const set = new Set(e.statuses.map((s) => (s === 'passed' ? 'passed' : 'bad')));
    if (set.size > 1 || e.playwrightFlaky)
      flaky.push({ title: e.title, priority, statuses: e.statuses });
    else if (set.has('bad')) failed.push({ title: e.title, priority });
    else if (e.statuses.length) passedIds.add(e.title);
  }
  return { total: byTest.size, runs, flaky, failed, passedIds };
}

/** Scenario id from a test title `P0 /dashboard @ desktop` (the inverse of how the spec names tests). */
export const idOfTitle = (title, scenarioId) => {
  const m = /^P[012] (\S+) @ (\S+)$/.exec(title);
  return m ? scenarioId(m[1], m[2]) : null;
};

export function flakeGate(fl) {
  const f = [];
  for (const x of fl.flaky)
    f.push({
      severity: x.priority === 'P0' ? 'Critical' : x.priority === 'P1' ? 'High' : 'Medium',
      subject: x.title,
      detail: `gave different answers across ${x.statuses.length} runs: ${x.statuses.join(', ')}`,
    });
  return f;
}
