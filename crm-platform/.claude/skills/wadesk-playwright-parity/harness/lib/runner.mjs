// Executes scenarios on a side and writes one result file per (side, scenario) under <runDir>/results/<side>/.
// Result files are the single source of truth: compare.mjs rebuilds every finding from them, so re-running a
// subset (the fix loop) simply overwrites those files and the next compare reflects it.
import { join } from 'node:path';
import { ScenarioContext } from './ctx.mjs';
import { runFor, findSkip } from './spec.mjs';
import { ensureDir, slug, writeJson, oneLine } from './util.mjs';

const withTimeout = (p, ms, label) =>
  Promise.race([
    p,
    new Promise((_, rej) =>
      setTimeout(() => rej(Object.assign(new Error(label), { name: 'ScenarioTimeout' })), ms),
    ),
  ]);

function classifyError(e) {
  const msg = String(e?.message || e);
  const locatorTimeout =
    e?.name === 'TimeoutError' &&
    /locator|getBy|waiting for|element/i.test(msg) &&
    !/^page\.goto|Navigation|net::/i.test(msg);
  return {
    missing: !!(e?.missing || locatorTimeout),
    error: oneLine(msg.split('\n')[0], 280) || e?.name || 'error',
    step: e?.step,
  };
}

export function resultPath(runDir, side, scenarioId) {
  return join(runDir, 'results', side, `${slug(scenarioId)}.json`);
}

async function runOne({ side, sc, cfg, runDir, tagBase, skips, trace }) {
  const t0 = Date.now();
  const skip = findSkip(skips, sc, side.name);
  const base = {
    scenario: sc.id,
    title: sc.title,
    side: side.name,
    tags: sc.tags || [],
    feature: sc.feature,
  };
  if (skip)
    return { ...base, status: 'skipped', skipReason: skip.reason || 'skipped by spec', ms: 0 };
  const fn = runFor(sc, side.name);
  if (!fn)
    return { ...base, status: 'skipped', skipReason: 'spec defines no steps for this side', ms: 0 };
  if (sc.needsUi && side.name === 'ours' && !side.hasUi)
    return {
      ...base,
      status: 'missing-ui',
      error: 'our web app is not available (apps/web not built or PARITY_WEB_URL unset)',
      ms: 0,
    };

  let handle;
  let c;
  let status = 'ok';
  let err;
  try {
    handle = sc.api
      ? await side.openApi({ role: sc.role || 'admin' })
      : await side.open({
          role: sc.role || 'admin',
          dialogPolicy: sc.dialogPolicy || 'accept',
          loggedIn: sc.loggedIn !== false,
        });
    c = new ScenarioContext({ side, handle, scenario: sc, cfg, runDir, tagBase });
    if (trace && handle.context)
      await handle.context.tracing.start({ screenshots: true, snapshots: true }).catch(() => {});
    await withTimeout(
      Promise.resolve(fn(c)),
      cfg.timeouts.scenario,
      `scenario exceeded ${cfg.timeouts.scenario} ms`,
    );
  } catch (e) {
    status = 'error';
    err = e;
    if (e?.code === 'NO_UI') status = 'missing-ui';
    if (c?.page && !c.page.isClosed?.()) {
      ensureDir(c.shotsDir);
      await c.shot('error').catch(() => {});
      c.obs.info('urlAtError', c.page.url());
    }
  }
  if (c) await c.runCleanups().catch(() => {});
  let evidence = {};
  try {
    evidence = c ? c.evidence() : {};
  } catch {
    /* page already gone */
  }
  if (trace && handle?.context) {
    const file = join(runDir, 'traces', `${side.name}-${slug(sc.id)}.zip`);
    ensureDir(join(runDir, 'traces'));
    await handle.context.tracing.stop(status === 'error' ? { path: file } : {}).catch(() => {});
  }
  for (const h of c?.extraHandles || []) await side.release(h).catch(() => {});
  if (handle) await side.release(handle).catch(() => {});

  const out = {
    ...base,
    status,
    ms: Date.now() - t0,
    obs: c?.obs.data || {},
    steps: c?.obs.steps || [],
    actions: c?.obs.actions,
    notes: c?.obs.notes || [],
    evidence,
  };
  if (err)
    Object.assign(
      out,
      status === 'missing-ui' ? { error: 'our web app is not available' } : classifyError(err),
    );
  return out;
}

/** Run the scenarios of one side with a small worker pool (each scenario gets its own browser context and test data). */
export async function runSide({
  side,
  scenarios,
  cfg,
  runDir,
  tagBase,
  skips = [],
  log = () => {},
  trace = false,
  workers = 1,
}) {
  const results = new Array(scenarios.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= scenarios.length) return;
      const sc = scenarios[i];
      const r = await runOne({ side, sc, cfg, runDir, tagBase, skips, trace });
      writeJson(resultPath(runDir, side.name, sc.id), r);
      results[i] = r;
      done += 1;
      log(
        `[${side.name}] ${String(done).padStart(3)}/${scenarios.length} ${r.status.padEnd(10)} ${sc.id}${r.error ? '  ' + oneLine(r.error, 100) : ''} (${r.ms} ms)`,
      );
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(workers, scenarios.length)) }, worker),
  );
  return results;
}

/** Spec teardown (delete the test data this run created). Never fails the run; reports what it could not clean. */
export async function runTeardown({ side, specs, cfg, runDir, tagBase, log = () => {} }) {
  for (const spec of specs) {
    const fn =
      spec.teardown &&
      (typeof spec.teardown === 'function'
        ? spec.teardown
        : (spec.teardown[side.name] ?? spec.teardown.both));
    if (!fn) continue;
    let handle;
    try {
      handle = await side.open({ role: 'admin' });
      const c = new ScenarioContext({
        side,
        handle,
        scenario: { id: 'teardown', tags: [] },
        cfg,
        runDir,
        tagBase,
      });
      await withTimeout(Promise.resolve(fn(c)), 5 * 60 * 1000, 'teardown exceeded 5 minutes');
      log(`[${side.name}] teardown ok (${spec.feature})`);
    } catch (e) {
      log(
        `[${side.name}] teardown FAILED (${spec.feature}): ${oneLine(e.message, 160)}. Test data prefixed "${tagBase}" may remain; delete it by hand.`,
      );
    } finally {
      if (handle) await side.release(handle).catch(() => {});
    }
  }
}
