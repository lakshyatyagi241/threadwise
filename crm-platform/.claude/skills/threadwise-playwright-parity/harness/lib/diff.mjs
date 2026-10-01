// Comparator. Two observations in, findings out. The key PREFIX decides how a key is compared:
//   flag./enum./set./seq./status./map.  must be equal (after normalisation)         -> defect when they differ
//   num.                                  equal                                      -> defect
//   low.                                  lower is better: ours may be <= Reference     -> defect only when ours is worse
//   abs.                                  higher is better: ours must be >= Reference (or the best value when Reference has none)
//   sec.                                  true = a security violation: ours must be false, Reference is irrelevant
//   lowset.                               set of problems (e.g. a11y rule ids): only problems ours has and Reference lacks count
//   perf.                                 ours may be up to cfg.perfRatioLimit slower (and > 800 ms slower) than Reference
//   ui.                                   structure: differences are "review" items, a human/LLM triages them
//   info.                                 never compared, kept for the report
// Copy (text) is never compared: porting Reference's wording would itself break the repo's no-copy rule.
import { deepEqual } from './util.mjs';
import { matchIntended } from './intended.mjs';

const OUTCOME_CLASS = {
  saved: 'accepted',
  silent: 'accepted',
  rejected: 'rejected',
  'client-blocked': 'rejected',
  crash: 'crash',
  'session-expired': 'session-expired',
  'no-request': 'no-request',
};
// best value when Reference gives no baseline (ratios tolerate 10%: the focus/reachability probes are heuristics)
const ABS_BEST = {
  'abs.focusQuality': 3,
  'abs.sessionExpiryQuality': 2,
  'abs.keyboard.reachable': 0.9,
  'abs.keyboard.focusVisible': 0.9,
};

const SEVERITY = [
  [/^flag\.accepted$/, 'blocker'],
  [/^enum\.outcome$/, 'blocker'],
  [/^status\.load$/, 'blocker'],
  [/^status\.submit$/, 'major'],
  [/^sec\./, 'blocker'],
  [/^low\.(pageErrors|http5xx)/, 'blocker'],
  [/^set\.flaggedFields$/, 'major'],
  [/^flag\.field\..*\.present$/, 'major'],
  [/^flag\.(valueKept|formLevelError)$/, 'major'],
  [/^map\.stored$/, 'major'],
  [/^low\.(failedRequests|brokenImages|keyboard\.trap|degraded\.)/, 'major'],
  [/^low\.a11y\.(critical|serious)$/, 'major'],
  [
    /^abs\.(errorFeedbackOnServerFailure|valueKeptOnServerFailure|submitUsableAfterFailure|degraded\.errorShown|keyboard\.reachable|submitGuardedWhileSending|field\..*\.labelled)/,
    'major',
  ],
  [/^abs\./, 'minor'],
  [
    /^(low\.(consoleErrors|http4xx|a11y|overflowX|unnamedInteractive|clippedText|smallTargets)|seq\.|perf\.|enum\.|flag\.|num\.|set\.)/,
    'minor',
  ],
  [/^ui\./, 'minor'],
];

const KIND = [
  [
    /^(flag\.accepted|enum\.outcome|map\.stored|num\.(submitRequests|rowsCreated)|status\.)/,
    'functional',
  ],
  [/^(set\.flaggedFields|flag\.field\.|flag\.(valueKept|formLevelError))/, 'validation'],
  [/^sec\./, 'security'],
  [
    /^(low\.a11y|abs\.keyboard|low\.keyboard|abs\.field\..*labelled|low\.unnamed|low\.smallTargets)/,
    'a11y',
  ],
  [/^perf\./, 'perf'],
  [
    /^(low\.|abs\.(degraded|errorFeedback|valueKept|submitUsable|staysOnForm|sessionExpiry))/,
    'robustness',
  ],
  [/^(ui\.)/, 'ui'],
  [
    /^(abs\.|seq\.|flag\.(enterSubmits|confirmOnDirtyCancel|cancelClosesForm|reopenIsClean|keyboard)|enum\.sessionExpiry)/,
    'ux',
  ],
];

const firstMatch = (table, key, fallback) =>
  (table.find(([rx]) => rx.test(key)) || [null, fallback])[1];
export const severityOf = (key, overrides = {}) =>
  overrides[key] || firstMatch(SEVERITY, key, 'minor');
export const kindOf = (key) => firstMatch(KIND, key, 'functional');

const norm = (key, v) => {
  if (v === undefined) return undefined;
  if (key === 'enum.outcome') return OUTCOME_CLASS[v] || v;
  if (key.startsWith('status.')) return v === 'client-blocked' ? 'rejected' : v;
  return v;
};

function cmpEqual(key, a, b) {
  const na = norm(key, a);
  const nb = norm(key, b);
  if (key.startsWith('set.')) {
    const A = new Set(na || []);
    const B = new Set(nb || []);
    const missing = [...A].filter((x) => !B.has(x));
    const extra = [...B].filter((x) => !A.has(x));
    return {
      same: !missing.length && !extra.length,
      detail:
        missing.length || extra.length ? { missingInOurs: missing, extraInOurs: extra } : undefined,
    };
  }
  if (key === 'map.stored') {
    const keys = [...new Set([...Object.keys(na || {}), ...Object.keys(nb || {})])];
    const d = keys
      .filter((k) => (na || {})[k] !== (nb || {})[k])
      .map((k) => ({ field: k, threadwise: (na || {})[k], ours: (nb || {})[k] }));
    return { same: d.length === 0, detail: d.length ? { fields: d } : undefined };
  }
  return { same: deepEqual(na, nb) };
}

/** Compare two observation maps. Returns [{key, threadwise, ours, result, severity, kind, detail}] for every key worth reporting. */
export function compareObs(
  wObs = {},
  oObs = {},
  { cfg, severityOverrides = {}, threadwiseMissing = false } = {},
) {
  const out = [];
  const keys = [...new Set([...Object.keys(wObs), ...Object.keys(oObs)])].sort();
  for (const key of keys) {
    const w = wObs[key];
    const o = oObs[key];
    const prefix = key.split('.')[0];
    const base = {
      key,
      threadwise: w,
      ours: o,
      severity: severityOf(key, severityOverrides),
      kind: kindOf(key),
    };
    if (prefix === 'info') {
      out.push({ ...base, result: 'info' });
      continue;
    }

    if (prefix === 'sec') {
      out.push({
        ...base,
        result: o ? 'diff' : 'same',
        detail: o
          ? { note: w ? 'Reference has the same weakness; do not replicate it' : undefined }
          : undefined,
      });
      continue;
    }
    if (prefix === 'low') {
      if (o === undefined && w === undefined) continue;
      const bad = Number(o ?? 0) > Number(w ?? 0);
      out.push({ ...base, result: bad ? 'diff' : 'same' });
      continue;
    }
    if (prefix === 'lowset') {
      const extra = (o || []).filter((x) => !(w || []).includes(x));
      out.push({
        ...base,
        result: extra.length ? 'diff' : 'same',
        detail: extra.length ? { extraInOurs: extra, missingInOurs: [] } : undefined,
      });
      continue;
    }
    if (prefix === 'abs') {
      const best = ABS_BEST[key] ?? true;
      const base_ = w === undefined || w === null ? best : w;
      // ours did not observe it: the situation did not arise (e.g. nothing to degrade on a server-rendered page), not a failure
      if (o === undefined) {
        if (w !== undefined)
          out.push({ ...base, result: 'info', detail: { note: 'not applicable in ours' } });
        continue;
      }
      const worse =
        typeof base_ === 'boolean' || typeof o === 'boolean'
          ? Number(!!o) < Number(!!base_)
          : Number(o) < Number(base_);
      out.push({
        ...base,
        result: worse ? 'diff' : 'same',
        detail:
          w === undefined || w === null
            ? { note: 'no Reference baseline: judged against the best possible value' }
            : undefined,
      });
      continue;
    }
    if (prefix === 'perf') {
      if (typeof w !== 'number' || typeof o !== 'number') {
        out.push({ ...base, result: 'info' });
        continue;
      }
      const slow = o > w * (cfg?.perfRatioLimit ?? 2.5) && o - w > 800;
      out.push({
        ...base,
        result: slow ? 'diff' : 'same',
        detail: { ratio: w ? Math.round((o / w) * 100) / 100 : null },
      });
      continue;
    }
    // equality family
    if (w === undefined && o !== undefined) {
      out.push({ ...base, result: 'info', detail: { note: 'only observed in ours' } });
      continue;
    }
    if (o === undefined) {
      out.push({
        ...base,
        result: threadwiseMissing || prefix === 'ui' ? 'info' : 'diff',
        detail: { note: 'not observed in ours' },
      });
      continue;
    }
    const r = cmpEqual(key, w, o);
    out.push({
      ...base,
      result: r.same ? 'same' : prefix === 'ui' ? 'review' : 'diff',
      detail: r.detail,
    });
  }
  return out;
}

const missingSeverity = (sc) =>
  sc.tags?.includes('happy') || sc.tags?.includes('page') ? 'blocker' : 'major';

/** One scenario, both results -> findings (same/intended/defect/review/info/skipped/spec-issue). */
export function compareScenario({
  scenario,
  threadwise,
  ours,
  cfg,
  specIntended = [],
  severityOverrides = {},
}) {
  const base = {
    scenario: scenario.id,
    title: scenario.title,
    tags: scenario.tags || [],
    feature: scenario.feature,
  };
  const mk = (extra) => ({ ...base, ...extra });

  // No Reference run at all (`--sides ours`, or a feature Reference does not have): nothing to equal, so ours is judged against
  // absolute expectations only: no security violation, no console/page errors, no a11y or keyboard regressions, no 5xx.
  if (!threadwise && ours?.status === 'ok') {
    const out = [];
    for (const k of compareObs({}, ours.obs, { cfg, severityOverrides, threadwiseMissing: true })) {
      if (k.result === 'diff')
        out.push(
          mk({
            ...k,
            result: 'defect',
            note: 'no Reference baseline: judged against absolute expectations',
          }),
        );
      else if (k.result === 'same' || k.result === 'info') out.push(mk({ ...k }));
    }
    return out;
  }
  const W = threadwise || { status: 'skipped' };
  const O = ours || { status: 'skipped' };

  if (W.status === 'skipped' || O.status === 'skipped') {
    return [
      mk({
        key: '(scenario)',
        result: 'skipped',
        note: [W.skipReason && `threadwise: ${W.skipReason}`, O.skipReason && `ours: ${O.skipReason}`]
          .filter(Boolean)
          .join('; '),
      }),
    ];
  }
  if (W.status !== 'ok' && O.status !== 'ok') {
    return [
      mk({
        key: '(scenario)',
        result: 'spec-issue',
        severity: 'info',
        note: `failed on both sides (threadwise: ${W.error}; ours: ${O.error}); fix the scenario or locators`,
      }),
    ];
  }
  if (W.status !== 'ok') {
    return [
      mk({
        key: '(scenario)',
        result: 'spec-issue',
        severity: 'info',
        note: `reference side failed, so there is no baseline: ${W.error}. Fix the Reference locators/steps in the spec.`,
      }),
    ];
  }
  if (O.status === 'missing-ui' || (O.status === 'error' && O.missing)) {
    return [
      mk({
        key: '(scenario)',
        kind: 'missing',
        result: 'defect',
        severity: missingSeverity(scenario),
        threadwise: 'works',
        ours:
          O.status === 'missing-ui' ? 'no web app' : `${O.step || 'step'} not possible: ${O.error}`,
        note:
          O.status === 'missing-ui'
            ? 'the screen/flow does not exist in our web app yet'
            : 'an element or screen Reference offers is missing (or the locator in the twin spec is wrong: check with explore.mjs before fixing)',
      }),
    ];
  }
  if (O.status === 'error') {
    return [
      mk({
        key: '(scenario)',
        kind: 'robustness',
        result: 'defect',
        severity: 'major',
        threadwise: 'works',
        ours: `error at "${O.step || '?'}": ${O.error}`,
        note: 'the same steps worked on Reference and broke on ours (app bug, or a spec locator that only fits Reference)',
      }),
    ];
  }

  const keyed = compareObs(W.obs, O.obs, { cfg, severityOverrides });
  const findings = [];
  for (const k of keyed) {
    if (k.result === 'same') {
      findings.push(mk({ ...k, result: 'same' }));
      continue;
    }
    if (k.result === 'info') {
      findings.push(mk({ ...k }));
      continue;
    }
    const f = mk({ ...k });
    const m = matchIntended(
      { scenario: scenario.id, key: k.key, threadwise: k.threadwise, ours: k.ours },
      specIntended,
    );
    if (m?.invalid) {
      findings.push({ ...f, result: 'defect', note: m.invalid });
      continue;
    }
    if (m) {
      findings.push({
        ...f,
        result: 'intended',
        rule: m.rule,
        ref: m.ref,
        reason: m.reason,
        source: m.source,
      });
      continue;
    }
    findings.push({ ...f, result: k.result === 'review' ? 'review' : 'defect' });
  }
  return findings;
}

export function summarise(findings) {
  const s = { same: 0, intended: 0, defect: 0, review: 0, info: 0, skipped: 0, 'spec-issue': 0 };
  const bySeverity = { blocker: 0, major: 0, minor: 0 };
  const defectScenarios = new Map();
  for (const f of findings) {
    s[f.result] = (s[f.result] || 0) + 1;
    if (f.result === 'defect') {
      bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
      const rank = { blocker: 0, major: 1, minor: 2 };
      const cur = defectScenarios.get(f.scenario);
      if (cur === undefined || (rank[f.severity] ?? 3) < rank[cur])
        defectScenarios.set(f.scenario, f.severity);
    }
  }
  const scenarioSeverity = { blocker: 0, major: 0, minor: 0 };
  for (const sev of defectScenarios.values())
    scenarioSeverity[sev] = (scenarioSeverity[sev] || 0) + 1;
  return {
    ...s,
    defectsBySeverity: bySeverity,
    defectScenarios: defectScenarios.size,
    defectScenariosBySeverity: scenarioSeverity,
  };
}
