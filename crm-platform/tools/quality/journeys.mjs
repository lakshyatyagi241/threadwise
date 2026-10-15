#!/usr/bin/env node
// Journey catalogue (QA task 9): validates docs/quality/journeys/journeys.json and expands it into runs.
//   node tools/quality/journeys.mjs            validate, print the number of runs per journey
//   node tools/quality/journeys.mjs --list     print every run id
//   node tools/quality/journeys.mjs --min 1200 fail unless the catalogue expands to at least that many runs
// The e2e runner (apps/api/test/e2e/journeys) imports `expand` so the count printed here is the count that runs.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRIORITIES = ['P0', 'P1', 'P2'];

/** Resolves "unicode:valid" to the fixture ids; any other value list is returned as is. Pure. */
export function variantValues(variant, fixtures) {
  if (Array.isArray(variant.values)) return variant.values;
  const m = /^unicode:(valid|hostile)$/.exec(String(variant.values));
  if (!m) throw new Error(`unknown variant source "${variant.values}"`);
  return fixtures[m[1]].map((s) => s.id);
}

/** Problems with the catalogue; empty when it is sound. Pure. */
export function validate(cat, fixtures) {
  const errs = [];
  const steps = new Set(Object.keys(cat.steps ?? {}));
  const variants = Object.fromEntries(
    Object.entries(cat.variants ?? {}).map(([k, v]) => [k, variantValues(v, fixtures)]),
  );
  const seen = new Set();
  if (!Array.isArray(cat.journeys) || cat.journeys.length === 0)
    return ['journeys must be a non-empty array'];
  for (const j of cat.journeys) {
    const at = (m) => errs.push(`${j.id ?? '(no id)'}: ${m}`);
    if (!/^J-\d{3}$/.test(j.id ?? '')) at('id must look like J-001');
    if (seen.has(j.id)) at('duplicate id');
    seen.add(j.id);
    if (!j.title) at('title is required');
    if (!PRIORITIES.includes(j.priority)) at('priority must be P0, P1 or P2');
    if (!Array.isArray(j.domains) || j.domains.length === 0)
      at('domains must name at least one module');
    if (!Array.isArray(j.steps) || j.steps.length === 0) at('steps must not be empty');
    for (const s of j.steps ?? []) if (!steps.has(s)) at(`step "${s}" is not in the step list`);
    for (const [dim, want] of Object.entries(j.vary ?? {})) {
      if (!(dim in variants)) {
        at(`variant "${dim}" does not exist`);
        continue;
      }
      if (want === 'all') continue;
      if (!Array.isArray(want) || want.length === 0)
        at(`variant "${dim}" must be "all" or a non-empty list`);
      else
        for (const v of want)
          if (!variants[dim].includes(v)) at(`variant "${dim}" has no value "${v}"`);
    }
    for (const ex of j.exclude ?? [])
      for (const [dim, v] of Object.entries(ex))
        if (!(dim in variants) || (v !== '*' && !variants[dim].includes(v)))
          at(`exclude names unknown ${dim}=${v}`);
  }
  return errs;
}

/** Every run: one per combination of the journey's variants, minus the excluded combinations. Pure. */
export function expand(cat, fixtures) {
  const variants = Object.fromEntries(
    Object.entries(cat.variants ?? {}).map(([k, v]) => [k, variantValues(v, fixtures)]),
  );
  const runs = [];
  for (const j of cat.journeys) {
    const dims = Object.entries(j.vary ?? {}).map(([dim, want]) => [
      dim,
      want === 'all' ? variants[dim] : want,
    ]);
    let combos = [{}];
    for (const [dim, values] of dims)
      combos = combos.flatMap((c) => values.map((v) => ({ ...c, [dim]: v })));
    for (const c of combos) {
      if (
        (j.exclude ?? []).some((ex) =>
          Object.entries(ex).every(([d, v]) => v === '*' || c[d] === v),
        )
      )
        continue;
      const tag = Object.entries(c)
        .map(([d, v]) => `${d}=${v}`)
        .join('/');
      runs.push({
        id: tag ? `${j.id}/${tag}` : j.id,
        journey: j.id,
        priority: j.priority,
        variant: c,
      });
    }
  }
  return runs;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const cat = JSON.parse(readFileSync(join(root, 'docs/quality/journeys/journeys.json'), 'utf8'));
  const fixtures = JSON.parse(
    readFileSync(join(root, 'tools/quality/unicode-fixtures.json'), 'utf8'),
  );
  const errs = validate(cat, fixtures);
  if (errs.length) {
    console.error(`${errs.length} problem(s):\n- ${errs.join('\n- ')}`);
    process.exit(1);
  }
  const runs = expand(cat, fixtures);
  if (process.argv.includes('--list')) console.log(runs.map((r) => r.id).join('\n'));
  else {
    for (const j of cat.journeys)
      console.log(
        `${j.id}  ${String(runs.filter((r) => r.journey === j.id).length).padStart(4)} runs  ${j.priority}  ${j.title}`,
      );
    console.log(`\n${cat.journeys.length} journeys, ${runs.length} runs (target 1200)`);
  }
  const m = process.argv.indexOf('--min');
  if (m > -1 && runs.length < Number(process.argv[m + 1])) {
    console.error(`${runs.length} runs is below the required ${process.argv[m + 1]}`);
    process.exit(1);
  }
}
