#!/usr/bin/env node
// QA sheet tasks 2 and 3: the machine-readable error-state and empty-state catalogues of the web app.
//   node tools/quality/state-catalogue.mjs error|empty|all            check the catalogue on disk (exit 1 on a problem)
//   node tools/quality/state-catalogue.mjs error|empty|all --write    regenerate the JSON files and REPORT.md (baseline.json is kept)
//   node tools/quality/state-catalogue.mjs error|empty|all --write-baseline   accept today's gaps as the new ceiling
// One feature = one folder in apps/web/src/features. Nothing is typed by hand: which cases apply and whether the feature's code
// has a branch for them come from the source; whether a test traces them comes from test titles (a word in a comment or an import
// does not count). The "handled" column is a heuristic read of the source, so review a "no" before reporting it as a defect.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FEATURES = join(ROOT, 'apps/web/src/features');
const E2E = join(ROOT, 'apps/web/e2e');
const API_EDGE = join(ROOT, 'docs/quality/edge-cases');

/** What the feature's source says about itself. Pure: takes the joined source text, no disk access. */
export function factsOf(src) {
  const mutation = /useMutation\(|method:\s*['"](POST|PUT|PATCH|DELETE)['"]/.test(src);
  const read = /use(Infinite|Suspense)?Query\(|queryFn/.test(src);
  const list = /<EmptyState|<table|<Table\b|<tbody|role="list"|<ul\b/.test(src);
  return {
    calls: /apiFetch\(|use(Infinite|Suspense)?Query\(|useMutation\(/.test(src),
    read,
    byId: /apiFetch\(\s*[`'"][^`'"]*\$\{\s*\w*[iI]d\s*\}/.test(src),
    mutation,
    update: /method:\s*['"](PATCH|PUT)['"]/.test(src),
    form: mutation && /<form\b|onSubmit|<Field\b|<Input\b|<Textarea\b/.test(src),
    list: read && list,
    filters: /<\w*(Filter|Search)\w*|type="search"/.test(src),
    scoped: /useCan\(/.test(src),
    stats: /StatTile|<\w*Chart\w*|Sparkline|<Stat\w*/.test(src),
  };
}

/** One case: where it applies, what the code must contain, what a test title must say. */
const c = (key, scenario, expected, core, applies, handled, trace) => ({
  key,
  scenario,
  expected,
  core,
  applies,
  handled,
  trace,
});

export const KINDS = {
  error: {
    task: 2,
    dir: 'docs/quality/error-states',
    prefix: 'ES',
    title: 'Error-state catalogue (QA task 2)',
    cases: [
      c(
        'LOAD',
        'A read fails (5xx or network)',
        'An in-place error with a retry; no blank screen, crash or raw error text',
        true,
        (f) => f.read,
        /<(LoadError|QueryError|ErrorState|ErrorBlock|ErrorPanel|ErrorNote|ErrorNotice|ErrorCard|ErrorLine)\b|\bisError\b|<Alert\b[^>]*tone="(danger|error)"|loadError/,
        /load(ing)? (fail|error)|fails? to load|error states?|failed load|query fails|when the (call|request|api) fails/i,
      ),
      c(
        'FORBIDDEN',
        'A read or an action returns 403',
        'A permission message and no data shown',
        false,
        (f) => f.calls,
        /403|forbidden|FORBIDDEN|useCan\(|PermissionDenied|notAllowed/,
        /\b403\b|forbidden|permission denied|not allowed|no access|lacks? (the )?permission/i,
      ),
      c(
        'NOTFOUND',
        'A detail screen opens an id that is gone or belongs to another workspace',
        'A not-found state, not a blank page',
        false,
        (f) => f.byId,
        /404|NOT_FOUND|notFound|not.?found/i,
        /\b404\b|not.?found|no longer exists|does not exist|unknown id/i,
      ),
      c(
        'MUTATE',
        'A save, create or delete fails',
        'The error is shown, typed values are kept, the button works again',
        true,
        (f) => f.mutation,
        /<(ErrorLine|ErrorBlock|ErrorNote|ErrorNotice)\b|useErrorText|onError|setError\(|<Alert\b[^>]*tone="(danger|error)"|toast\.\w*error|\.error\(|ApiError/i,
        /(save|create|delete|update|submit|send)(s|ing)? (fail|error)|fails? to (save|create|delete|update|send)|keeps? (what|the values|typed|input)/i,
      ),
      c(
        'VALIDATION',
        'The API returns field errors (422)',
        'Each error appears on its own field',
        false,
        (f) => f.form,
        /fieldErrors|fieldErrorMap|fieldErrorsFromApi|useFieldError|422|VALIDATION/,
        /field errors?|\b422\b|maps? (the )?(api )?errors? to (the )?fields?|shows? (the )?(validation|field) (error|message)/i,
      ),
      c(
        'CONFLICT',
        'The row changed under the user (409, ROW_VERSION_CONFLICT)',
        'A reload prompt, never a silent overwrite',
        false,
        (f) => f.update,
        /ROW_VERSION_CONFLICT|409|conflict/i,
        /\b409\b|conflict/i,
      ),
      c(
        'OFFLINE',
        'The browser is offline or the request times out',
        'A retryable message',
        false,
        (f) => f.calls,
        /navigator\.onLine|offline|network-failure|NETWORK|timeout/i,
        /(goes|is|when|while) offline|browser (is )?offline|times? out|timed out|unreachable|network (error|failure|drop)|connection lost/i,
      ),
    ],
  },
  empty: {
    task: 3,
    dir: 'docs/quality/empty-states',
    prefix: 'EM',
    title: 'Empty-state catalogue (QA task 3)',
    cases: [
      c(
        'FIRST',
        'No rows exist yet',
        'A title, one line of why and the primary action',
        true,
        (f) => f.list,
        /<EmptyState|isEmpty|\.length === 0|\.length === 0|!\w+\.length|\.length < 1/,
        /empty state|empty (list|table|inbox|view|screen|page|board|result|panel)|no \w+ yet|nothing (here|yet)|first.?use|zero rows/i,
      ),
      c(
        'FILTERED',
        'Filters or search match nothing',
        '"No results" with a way to clear the filters, never the first-use message',
        true,
        (f) => f.list && f.filters,
        /noResults|noMatch|clearFilters|clear.?filter|no.?(results|matches)/i,
        /no (results|matches) (for|when|after)|no results|search (matches|finds) nothing|filters? (match|yield)|nothing matches|clear (the )?filters?/i,
      ),
      c(
        'LOADING',
        'The list is still loading',
        'A skeleton or spinner, never the empty state',
        false,
        (f) => f.list,
        /isPending|isLoading|Skeleton|Spinner|isFetching/,
        /skeleton|spinner|while (it is |the \w+ is )?loading|still loading|loading state/i,
      ),
      c(
        'SCOPE',
        "The user's role shows nothing",
        'Says so; does not look like a broken page',
        false,
        (f) => f.list && f.scoped,
        /noAccess|forbidden|notAllowed|permission|scope/i,
        /(role|scope|permission).*(nothing|empty|hidden|no )|no access/i,
      ),
      c(
        'ZERO',
        'A counter or chart has no data',
        'Shows 0 or a flat chart, never NaN or a blank box',
        false,
        (f) => f.stats,
        /\?\?\s*0\b|\|\|\s*0\b|toLocaleString|Number\.isFinite/,
        /zero|\bnan\b|no data|nothing to chart|empty chart|flat/i,
      ),
    ],
  },
};

const lower = (p) => (p === 'P0' ? 'P1' : 'P2');
const pad = (n) => String(n).padStart(3, '0');
const unique = (a) => [...new Set(a)];

/** The `it(` / `test(` / `describe(` titles of one test file; only titles count as evidence. */
export function titlesOf(src) {
  return [
    ...src.matchAll(
      /\b(?:it|test|describe)(?:\.\w+)*(?:\.each\([^)]*\))?\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g,
    ),
  ].map((m) => m[2]);
}

/**
 * The catalogue file of one feature.
 * `sources`: [{file, text}] non-test source, `tests`: [{file, titles}], `tier`: P0..P2.
 */
export function buildFeature(kind, { feature, sources, tests, tier, partial = {} }) {
  const def = KINDS[kind];
  const text = sources.map((s) => s.text).join('\n');
  const facts = factsOf(text);
  const cases = [];
  def.cases.forEach((d, i) => {
    if (!d.applies(facts)) return;
    const hits = [];
    for (const t of tests)
      for (const title of t.titles)
        if (d.trace.test(title)) hits.push({ file: t.file, match: title });
    const picked = [];
    for (const h of hits)
      if (picked.length < 3 && !picked.some((p) => p.file === h.file)) picked.push(h);
    const where = sources.filter((s) => d.handled.test(s.text)).map((s) => s.file);
    cases.push({
      id: `${def.prefix}-${feature}-${pad(i + 1)}`,
      key: d.key,
      scenario: d.scenario,
      expected: d.expected,
      priority: d.core ? tier : lower(tier),
      handled: where.length ? 'yes' : 'no',
      ...(where.length ? { handledIn: where.slice(0, 3) } : {}),
      status: picked.length ? 'covered' : 'gap',
      ...(picked.length ? { tests: picked } : {}),
      ...(picked.length && partial[`${def.prefix}-${feature}-${pad(i + 1)}`]
        ? { partial: partial[`${def.prefix}-${feature}-${pad(i + 1)}`] }
        : {}),
    });
  });
  return cases.length
    ? { feature, tier, applicable: true, cases }
    : {
        feature,
        tier,
        applicable: false,
        reason:
          kind === 'error'
            ? 'The feature makes no API call (no apiFetch, query or mutation in its code)'
            : 'The feature shows no list, table or chart fed by a query',
        cases: [],
      };
}

/** Totals for one feature file, used by the report and the baseline. */
export const statsOf = (doc) => ({
  cases: doc.cases.length,
  covered: doc.cases.filter((x) => x.status === 'covered').length,
  partial: doc.cases.filter((x) => x.partial).length,
  gaps: doc.cases.filter((x) => x.status === 'gap').length,
  p0Gaps: doc.cases.filter((x) => x.status === 'gap' && x.priority === 'P0').length,
  notHandled: doc.cases.filter((x) => x.handled === 'no').length,
});

export function renderReport(kind, docs) {
  const def = KINDS[kind];
  const app = docs.filter((d) => d.applicable);
  const na = docs.filter((d) => !d.applicable);
  const rows = [...app].sort(
    (a, b) => a.tier.localeCompare(b.tier) || a.feature.localeCompare(b.feature),
  );
  const sum = (k) => app.reduce((n, d) => n + statsOf(d)[k], 0);
  const out = [
    `# ${def.title}`,
    '',
    '_Generated by `tools/quality/state-catalogue.mjs`. Do not edit by hand; run it with `--write`._',
    '',
    `${docs.length} web features: ${app.length} applicable, ${na.length} not applicable (listed below with the reason).`,
    `${sum('cases')} cases: ${sum('covered')} traced to a test (${sum('partial')} only partly, see "partial" in the file), ${sum('gaps')} gaps (${sum('p0Gaps')} P0), ${sum('notHandled')} with no handling found in the code.`,
    '',
    '"Handled" is a heuristic read of the source: check a "no" by hand before treating it as a defect.',
    '',
    '| Feature | Tier | Cases | Covered | Gaps | P0 gaps | No handling in code |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const d of rows) {
    const s = statsOf(d);
    const nh =
      d.cases
        .filter((x) => x.handled === 'no')
        .map((x) => x.key)
        .join(', ') || '-';
    out.push(
      `| ${d.feature} | ${d.tier} | ${s.cases} | ${s.covered} | ${s.gaps} | ${s.p0Gaps} | ${nh} |`,
    );
  }
  out.push('', '## Not applicable', '', '| Feature | Reason |', '| --- | --- |');
  for (const d of na) out.push(`| ${d.feature} | ${d.reason} |`);
  return out.join('\n') + '\n';
}

const walk = (d) =>
  existsSync(d)
    ? readdirSync(d).flatMap((n) => {
        const p = join(d, n);
        return statSync(p).isDirectory() ? walk(p) : [p];
      })
    : [];
const isTest = (f) => /\.(test|spec)\.(ts|tsx)$|\.dom\.test\./.test(f);

function tierOf(feature) {
  const f = join(API_EDGE, `${feature}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')).tier ?? 'P1') : 'P1';
}

/** Reads the repo and builds every feature file of one kind. */
export function buildAll(kind) {
  const pf = join(ROOT, KINDS[kind].dir, 'partial.json');
  const partial = existsSync(pf) ? JSON.parse(readFileSync(pf, 'utf8')) : {};
  const features = readdirSync(FEATURES)
    .filter((n) => !n.startsWith('_') && statSync(join(FEATURES, n)).isDirectory())
    .sort();
  return features.map((feature) => {
    const files = walk(join(FEATURES, feature));
    const sources = files
      .filter((f) => /\.(ts|tsx)$/.test(f) && !isTest(f) && !f.endsWith('.generated.ts'))
      .map((f) => ({ file: relative(ROOT, f), text: readFileSync(f, 'utf8') }));
    const tests = [...files, ...walk(join(E2E, feature))]
      .filter(isTest)
      .map((f) => ({ file: relative(ROOT, f), titles: titlesOf(readFileSync(f, 'utf8')) }));
    return buildFeature(kind, { feature, sources, tests, tier: tierOf(feature), partial });
  });
}

export const baselineOf = (docs) => ({
  gaps: Object.fromEntries(
    docs.filter((d) => d.applicable).map((d) => [d.feature, statsOf(d).gaps]),
  ),
  notHandled: Object.fromEntries(
    docs.filter((d) => d.applicable).map((d) => [d.feature, statsOf(d).notHandled]),
  ),
});

/** Problems with the catalogue on disk against a fresh build. Pure: `disk` maps file name to text. */
export function problems(kind, docs, disk, baseline, exists, readText) {
  const out = [];
  const want = new Map(docs.map((d) => [`${d.feature}.json`, JSON.stringify(d, null, 2) + '\n']));
  for (const [name, text] of want) {
    if (!(name in disk)) out.push(`${name} is missing`);
    else if (disk[name] !== text) out.push(`${name} is out of date`);
  }
  for (const name of Object.keys(disk))
    if (
      name.endsWith('.json') &&
      name !== 'baseline.json' &&
      name !== 'partial.json' &&
      !want.has(name)
    )
      out.push(`${name} is for a feature that no longer exists`);
  const ids = new Set();
  for (const d of docs)
    for (const x of d.cases) {
      if (ids.has(x.id)) out.push(`duplicate id ${x.id}`);
      ids.add(x.id);
      for (const t of x.tests ?? []) {
        if (!exists(t.file)) out.push(`${x.id}: test file ${t.file} does not exist`);
        else if (!readText(t.file).includes(t.match))
          out.push(`${x.id}: ${t.file} has no title "${t.match}"`);
      }
    }
  if (baseline) {
    const now = baselineOf(docs);
    for (const k of ['gaps', 'notHandled'])
      for (const [f, n] of Object.entries(now[k]))
        if (n > (baseline[k][f] ?? 0))
          out.push(
            `${f}: ${k === 'gaps' ? 'untraced cases' : 'cases with no handling'} grew from ${baseline[k][f] ?? 0} to ${n}`,
          );
  }
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = process.argv[2] ?? 'all';
  const kinds = arg === 'all' ? ['error', 'empty'] : [arg];
  if (!kinds.every((k) => k in KINDS)) {
    console.error('usage: state-catalogue.mjs error|empty|all [--write|--write-baseline]');
    process.exit(2);
  }
  let failed = false;
  for (const kind of kinds) {
    const dir = join(ROOT, KINDS[kind].dir);
    const docs = buildAll(kind);
    const baseFile = join(dir, 'baseline.json');
    if (process.argv.includes('--write') || process.argv.includes('--write-baseline')) {
      mkdirSync(dir, { recursive: true });
      if (process.argv.includes('--write'))
        for (const d of docs)
          writeFileSync(join(dir, `${d.feature}.json`), JSON.stringify(d, null, 2) + '\n');
      // The ceiling moves only when asked (or when there is none yet): a plain --write must not accept new gaps.
      if (!existsSync(baseFile) || process.argv.includes('--write-baseline'))
        writeFileSync(baseFile, JSON.stringify(baselineOf(docs), null, 2) + '\n');
      writeFileSync(join(dir, 'REPORT.md'), renderReport(kind, docs));
      console.log(`${kind}: wrote ${docs.length} feature files`);
      continue;
    }
    const disk = existsSync(dir)
      ? Object.fromEntries(
          readdirSync(dir)
            .filter((n) => n.endsWith('.json'))
            .map((n) => [n, readFileSync(join(dir, n), 'utf8')]),
        )
      : {};
    const baseline = existsSync(baseFile) ? JSON.parse(readFileSync(baseFile, 'utf8')) : null;
    const errs = problems(
      kind,
      docs,
      disk,
      baseline,
      (f) => existsSync(join(ROOT, f)),
      (f) => readFileSync(join(ROOT, f), 'utf8'),
    );
    const app = docs.filter((d) => d.applicable);
    const cases = app.reduce((n, d) => n + d.cases.length, 0);
    console.log(`${kind}: ${app.length}/${docs.length} features applicable, ${cases} cases`);
    if (errs.length) {
      failed = true;
      console.error(
        `${kind}: ${errs.length} problem(s):\n- ${errs.join('\n- ')}\nRun: node tools/quality/state-catalogue.mjs ${kind} --write`,
      );
    }
  }
  process.exit(failed ? 1 : 0);
}
