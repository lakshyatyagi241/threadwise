// Twin spec loader. A spec is an ES module whose default export is a function(h) returning plain data
// (see references/spec-format.md): which pages, forms, lists and custom scenarios exist, with per-side locators.
// The generators expand that data into the full scenario matrix; custom scenarios are appended as written.
import { pathToFileURL } from 'node:url';
import { pageScenarios, PAGE_PROBES, DEFAULT_PAGE_PROBES } from './probes/page.mjs';
import { formScenarios } from './probes/form.mjs';
import { listScenarios, deleteScenarios } from './probes/list.mjs';
import { casesFor } from './values.mjs';
import { pick } from './util.mjs';

const FEATURE_RE = /^(WD-[A-Z0-9]+-\d{3}|adhoc:[a-z0-9-]+)$/;
const SIDES = ['threadwise', 'ours'];
const hasBoth = (x) =>
  x != null &&
  (typeof x !== 'object' ||
    x instanceof RegExp ||
    !('threadwise' in x || 'ours' in x || 'both' in x) ||
    'both' in x ||
    (x.threadwise != null && x.ours != null));

export function validateSpec(raw) {
  const errs = [];
  if (!raw || typeof raw !== 'object') return ['spec must return an object'];
  if (!FEATURE_RE.test(raw.feature || ''))
    errs.push(
      `feature must be a Reference id (WD-<CODE>-<NNN>) or "adhoc:<slug>" for a feature Reference does not have, got "${raw.feature}"`,
    );
  const ids = new Set();
  const dupe = (id) => {
    if (ids.has(id)) errs.push(`duplicate id "${id}"`);
    ids.add(id);
  };
  for (const p of raw.pages || []) {
    if (!p.id) errs.push('page without id');
    dupe(`page:${p.id}`);
    if (!hasBoth(p.path ?? { threadwise: p.threadwise, ours: p.ours }))
      errs.push(
        `page "${p.id}": give a path for both sides (path: {threadwise, ours} or one shared string)`,
      );
    for (const pr of p.probes || [])
      if (!PAGE_PROBES[pr])
        errs.push(
          `page "${p.id}": unknown probe "${pr}" (known: ${Object.keys(PAGE_PROBES).join(', ')})`,
        );
  }
  for (const f of raw.forms || []) {
    const w = `form "${f.id}"`;
    if (!f.id) errs.push('form without id');
    dupe(`form:${f.id}`);
    if (!f.title) errs.push(`${w}: title missing`);
    if (
      !hasBoth(f.open) ||
      (typeof f.open === 'object' &&
        typeof f.open?.threadwise !== 'function' &&
        typeof f.open?.both !== 'function')
    )
      errs.push(
        `${w}: open needs a function for each side, e.g. open: {threadwise: async (c) => {...}, ours: async (c) => {...}}`,
      );
    if (!hasBoth(f.submit)) errs.push(`${w}: submit locator needed for both sides`);
    if (!Array.isArray(f.fields) || !f.fields.length) errs.push(`${w}: fields[] is empty`);
    else
      for (const fd of f.fields) {
        if (!fd.id) errs.push(`${w}: a field has no id`);
        if (!hasBoth(fd.loc ?? { threadwise: fd.threadwise, ours: fd.ours }))
          errs.push(`${w}: field "${fd.id}" needs a locator for both sides`);
        if (fd.required && typeof f.valid === 'object' && !(fd.id in f.valid))
          errs.push(`${w}: required field "${fd.id}" has no baseline value in valid{}`);
      }
    if (!f.valid || !['object', 'function'].includes(typeof f.valid))
      errs.push(`${w}: valid{} (baseline values that must be accepted) is required`);
  }
  for (const l of raw.lists || []) {
    if (!l.id || !hasBoth(l.page) || !hasBoth(l.rows))
      errs.push(`list "${l.id}": id, page and rows (both sides) are required`);
    dupe(`list:${l.id}`);
  }
  for (const d of raw.deletes || []) {
    if (!d.id || !hasBoth(d.page) || !d.seed || !d.row || !d.start)
      errs.push(`delete "${d.id}": id, page, seed, row and start are required`);
  }
  for (const s of raw.scenarios || []) {
    if (!s.id) errs.push('custom scenario without id');
    if (!s.run) errs.push(`scenario "${s.id}": run missing`);
    dupe(`scenario:${s.id}`);
  }
  for (const i of raw.intended || [])
    if (!i.reason || String(i.reason).trim().length < 8)
      errs.push(`intended entry (${i.scenario ?? '*'} / ${i.key ?? '*'}) needs a real reason`);
  return errs;
}

export const helpers = (cfg) => ({
  cfg,
  pick,
  casesFor,
  pageScenarios,
  formScenarios,
  listScenarios,
  deleteScenarios,
  PAGE_PROBES: Object.keys(PAGE_PROBES),
  ALL_PAGE_PROBES: DEFAULT_PAGE_PROBES,
});

export async function loadSpec(file, cfg, { depth } = {}) {
  const mod = await import(pathToFileURL(file).href + `?v=${Date.now()}`);
  const h = helpers(cfg);
  const raw = typeof mod.default === 'function' ? await mod.default(h) : mod.default;
  const errs = validateSpec(raw);
  if (errs.length)
    throw Object.assign(new Error(`invalid twin spec ${file}:\n- ${errs.join('\n- ')}`), {
      code: 'BAD_SPEC',
    });
  const d = depth || cfg.depth;
  const scenarios = [];
  for (const p of raw.pages || [])
    scenarios.push(...pageScenarios({ feature: raw.feature, ...p }, { depth: d }));
  for (const f of raw.forms || [])
    scenarios.push(...formScenarios({ feature: raw.feature, ...f }, { depth: d }));
  for (const l of raw.lists || [])
    scenarios.push(...listScenarios({ feature: raw.feature, ...l }, { depth: d }));
  for (const x of raw.deletes || [])
    scenarios.push(...deleteScenarios({ feature: raw.feature, ...x }));
  for (const s of raw.scenarios || [])
    scenarios.push({ feature: raw.feature, tags: [], needsUi: s.needsUi ?? !s.api, ...s });
  const seen = new Set();
  for (const s of scenarios) {
    if (seen.has(s.id))
      throw Object.assign(
        new Error(`scenario id "${s.id}" is generated twice; give forms/pages/lists distinct ids`),
        { code: 'BAD_SPEC' },
      );
    seen.add(s.id);
  }
  return {
    file,
    teardown: raw.teardown,
    feature: raw.feature,
    title: raw.title || raw.feature,
    domain: raw.domain,
    scenarios,
    intended: raw.intended || [],
    skip: raw.skip || [],
    severity: raw.severity || {},
    notes: raw.notes,
  };
}

export const runFor = (sc, side) => (typeof sc.run === 'function' ? sc.run : sc.run?.[side]);

export function findSkip(skips, sc, side) {
  for (const s of skips) {
    const idOk =
      !s.scenario ||
      (s.scenario instanceof RegExp
        ? s.scenario.test(sc.id)
        : sc.id === s.scenario || sc.id.startsWith(`${s.scenario}.`));
    const sideOk = !s.side || s.side === 'both' || s.side === side;
    if (idOk && sideOk) return s;
  }
  return null;
}

export { SIDES };
