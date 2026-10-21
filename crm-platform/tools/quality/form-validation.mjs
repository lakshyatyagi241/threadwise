#!/usr/bin/env node
// QA sheet task 12: form validation scenarios, derived from the schemas the API binds to every body (and so from every form).
//   node tools/quality/form-validation.mjs            check docs/quality/form-validation on disk, run every scenario (exit 1 on a problem)
//   node tools/quality/form-validation.mjs --write    regenerate the JSON files and REPORT.md
//   node tools/quality/form-validation.mjs --write-baseline   accept today's uncovered rules as the new ceiling
// Universe: every `@Body(zodPipe(<schema>))` in apps/api/src/modules/**/*.controller.ts, resolved in the built @crm/contracts. Per field, per
// rule (required, type, min, max, format, enum, array size, null, empty string) one scenario that MUST be accepted or MUST be refused, with the
// refusal attributed to the right field. A rule the generator cannot express (cross-field refinement, a pattern it cannot satisfy) is counted
// as uncovered, not hidden. Run the scenarios through the schema itself, so the suite needs no database and cannot flake.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULES = join(ROOT, 'apps/api/src/modules');
const OUT = join(ROOT, 'docs/quality/form-validation');
const EDGE = join(ROOT, 'docs/quality/edge-cases');

const typeOf = (s) => s?._def?.typeName;
const UUID = '11111111-1111-4111-8111-111111111111';
const CANDIDATES = [
  'a',
  'abc',
  'Abc123',
  'abc_def',
  'abc-def',
  'a1',
  '1',
  '123456',
  '+919876543210',
  '919876543210',
  'a.b',
  'a b',
  'A',
  'ABC',
  '#fff',
  '#ffffff',
  '2026-01-01',
  '12:30',
  'en',
  'en-US',
  'USD',
  'IN',
  'https://example.test',
  'a@example.test',
];

/** Peels optional, nullable, default and similar wrappers; says what it peeled. */
export function unwrap(schema) {
  let s = schema;
  const flags = { optional: false, nullable: false, hasDefault: false, refine: 0, pre: false };
  for (let i = 0; i < 16; i++) {
    const d = s._def;
    switch (d.typeName) {
      case 'ZodOptional':
        flags.optional = true;
        s = d.innerType;
        continue;
      case 'ZodNullable':
        flags.nullable = true;
        s = d.innerType;
        continue;
      case 'ZodDefault':
        flags.hasDefault = true;
        flags.optional = true;
        s = d.innerType;
        continue;
      case 'ZodCatch':
      case 'ZodReadonly':
        s = d.innerType;
        continue;
      case 'ZodEffects':
        if (d.effect?.type === 'refinement') flags.refine++;
        else flags.pre = true;
        s = d.schema;
        continue;
      case 'ZodBranded':
        s = d.type;
        continue;
      case 'ZodPipeline':
        s = d.in;
        continue;
      case 'ZodLazy':
        s = d.getter();
        continue;
      default:
        return { s, flags };
    }
  }
  return { s, flags };
}

const checksOf = (s) => s._def.checks ?? [];
const hasCheck = (s, kind) => checksOf(s).find((c) => c.kind === kind);

/** A value the schema accepts, or undefined when none could be built. */
export function sampleOf(schema, depth = 0) {
  if (depth > 6) return undefined;
  const { s } = unwrap(schema);
  const ok = (v) => (schema.safeParse(v).success ? v : undefined);
  switch (typeOf(s)) {
    case 'ZodString': {
      const min = hasCheck(s, 'min')?.value ?? hasCheck(s, 'length')?.value ?? 0;
      const max = hasCheck(s, 'max')?.value ?? hasCheck(s, 'length')?.value ?? 1e9;
      const fixed = hasCheck(s, 'uuid')
        ? UUID
        : hasCheck(s, 'email')
          ? 'a@example.test'
          : hasCheck(s, 'url')
            ? 'https://example.test'
            : hasCheck(s, 'datetime')
              ? '2026-01-01T00:00:00Z'
              : null;
      const tries = fixed
        ? [fixed]
        : [
            'a'.repeat(Math.min(Math.max(min, 1), max)),
            ...CANDIDATES,
            ...CANDIDATES.map((c) => c.repeat(Math.max(1, Math.ceil(min / c.length)))),
          ];
      for (const t of tries) if (schema.safeParse(t).success) return t;
      return undefined;
    }
    case 'ZodNumber': {
      const lo = hasCheck(s, 'min');
      const hi = hasCheck(s, 'max');
      for (const t of [
        lo ? lo.value + (lo.inclusive ? 0 : 1) : undefined,
        1,
        0,
        hi ? hi.value - (hi.inclusive ? 0 : 1) : undefined,
        10,
        100,
      ])
        if (t !== undefined && schema.safeParse(t).success) return t;
      return undefined;
    }
    case 'ZodBigInt':
      return ok(BigInt(1));
    case 'ZodBoolean':
      return ok(false) ?? ok(true);
    case 'ZodDate':
      return ok(new Date('2026-01-01T00:00:00Z'));
    case 'ZodEnum':
      return s._def.values[0];
    case 'ZodNativeEnum':
      return Object.values(s._def.values)[0];
    case 'ZodLiteral':
      return s._def.value;
    case 'ZodNull':
      return null;
    case 'ZodUndefined':
      return undefined;
    case 'ZodArray': {
      const min = s._def.minLength?.value ?? s._def.exactLength?.value ?? 0;
      const item = sampleOf(s._def.type, depth + 1);
      if (min > 0 && item === undefined) return undefined;
      return ok(Array.from({ length: min }, () => item));
    }
    case 'ZodSet':
    case 'ZodMap':
      return undefined;
    case 'ZodRecord':
      return ok({});
    case 'ZodTuple': {
      const v = s._def.items.map((i) => sampleOf(i, depth + 1));
      return v.some((x) => x === undefined) ? undefined : ok(v);
    }
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const opts = Array.isArray(s._def.options) ? s._def.options : [...s._def.options.values()];
      for (const o of opts) {
        const v = sampleOf(o, depth + 1);
        if (v !== undefined && schema.safeParse(v).success) return v;
      }
      return undefined;
    }
    case 'ZodObject': {
      const out = {};
      for (const [k, f] of Object.entries(s.shape)) {
        const { flags } = unwrap(f);
        const v = sampleOf(f, depth + 1);
        if (v === undefined) {
          if (!flags.optional && !flags.nullable) return undefined;
          continue;
        }
        out[k] = v;
      }
      return ok(out);
    }
    case 'ZodAny':
    case 'ZodUnknown':
      return ok('x');
    default:
      return undefined;
  }
}

const SENSITIVE =
  /pass(word)?|secret|token|e-?mail|phone|mobile|amount|price|total|currency|quantity|balance|otp|code|key|url|webhook/i;
const CORE = new Set(['required', 'type', 'min', 'max', 'format', 'enum', 'size', 'null', 'empty']);

/** P0/P1/P2 of one scenario from the module tier, the rule and the field name. */
export function priorityOf(tier, rule, field) {
  const core = CORE.has(rule);
  if (tier === 'P0') return core ? 'P0' : 'P1';
  if (core && SENSITIVE.test(field)) return 'P0';
  if (tier === 'P1') return core ? 'P1' : 'P2';
  return 'P2';
}

/** Describes a long value without storing it. */
export function describeValue(v) {
  if (typeof v === 'string') {
    const m = /^(.)\1*$/su.exec(v);
    if (v.length > 40 && m) return `"${m[1]}" x ${v.length}`;
    if (v.length > 40) return `${v.length} characters`;
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return v.length > 6 ? `array of ${v.length}` : JSON.stringify(v);
  if (v === undefined) return '(omitted)';
  return JSON.stringify(v);
}

/** Scenarios for a body schema. Returns { scenarios, uncovered, unbuildable }. A scenario is { field, rule, kind, label, body }. */
export function scenariosOf(schema) {
  const out = [];
  const uncovered = [];
  let coercedFields = 0;
  const base = sampleOf(schema);
  const root = unwrap(schema);
  if (typeOf(root.s) !== 'ZodObject')
    return {
      scenarios: out,
      uncovered: [{ field: '(body)', reason: `body is a ${typeOf(root.s)}, not an object` }],
      unbuildable: false,
    };
  if (base === undefined)
    return {
      scenarios: out,
      uncovered: [
        {
          field: '(body)',
          reason: 'no valid body could be built from the schema (cross-field or pattern rule)',
        },
      ],
      unbuildable: true,
    };
  if (root.flags.refine)
    uncovered.push({
      field: '(body)',
      reason: `${root.flags.refine} cross-field rule(s) (refine) are not generated`,
    });

  const withField = (path, value) => {
    const body = structuredClone(base);
    let cur = body;
    for (let i = 0; i < path.length - 1; i++) {
      const seg = path[i];
      if (seg === '[]') cur = cur[0];
      else {
        cur[seg] ??= {};
        cur = cur[seg];
      }
    }
    const last = path[path.length - 1];
    if (value === undefined) delete cur[last];
    else cur[last] = value;
    return body;
  };
  const add = (path, rule, kind, label, value) =>
    out.push({
      field: path.filter((p) => p !== '[]').join('.') || '(body)',
      rule,
      kind,
      label,
      valueText: describeValue(value),
      body: withField(path, value),
    });

  const visit = (path, fieldSchema) => {
    const { s, flags } = unwrap(fieldSchema);
    const t = typeOf(s);
    if (flags.refine)
      uncovered.push({
        field: path.join('.'),
        reason: `${flags.refine} refine rule(s) on this field are not generated`,
      });
    const cur = path.reduce((o, k) => (k === '[]' ? o?.[0] : o?.[k]), base);
    const present = cur !== undefined;
    const free = t === 'ZodAny' || t === 'ZodUnknown' || fieldSchema.safeParse(undefined).success;
    const coerced = flags.pre || s._def?.coerce;
    if (coerced) coercedFields++;
    if (!flags.optional && !flags.nullable && present && !free)
      add(path, 'required', 'refuse', 'field omitted', undefined);
    if (
      flags.optional &&
      !flags.nullable &&
      present &&
      !coerced &&
      !root.flags.pre &&
      t !== 'ZodAny' &&
      t !== 'ZodUnknown'
    )
      add(path, 'null', 'refuse', 'null instead of a value', null);
    if (flags.nullable && present && !coerced) add(path, 'null', 'accept', 'null', null);
    if (t === 'ZodString') {
      if (!coerced) add(path, 'type', 'refuse', 'number instead of text', 12345);
      const min = hasCheck(s, 'min')?.value;
      const max = hasCheck(s, 'max')?.value;
      const len = hasCheck(s, 'length')?.value;
      if (min >= 1 && !coerced) {
        add(path, 'empty', 'refuse', 'empty text', '');
        if (min > 1)
          add(path, 'min', 'refuse', `one under the minimum (${min})`, 'a'.repeat(min - 1));
        const ok = sampleOf(fieldSchema);
        if (hasCheck(s, 'trim')) add(path, 'empty', 'refuse', 'only spaces', '   ');
        if (ok !== undefined && typeof ok === 'string' && ok.length === min)
          add(path, 'min', 'accept', `exactly the minimum (${min})`, ok);
      }
      const formatted = [
        'email',
        'url',
        'uuid',
        'datetime',
        'regex',
        'startsWith',
        'endsWith',
        'includes',
        'cuid',
        'ulid',
        'ip',
      ].some((k) => hasCheck(s, k));
      if (max !== undefined && formatted)
        uncovered.push({
          field: path.join('.'),
          reason:
            'maximum on a formatted text: the boundary value must also match the format, not generated',
        });
      if (max !== undefined && max < 100000 && !formatted) {
        const fits = sampleOf(fieldSchema);
        const atMax =
          typeof fits === 'string' && /^(.)\1*$/su.test(fits)
            ? fits[0].repeat(max)
            : 'a'.repeat(max);
        add(path, 'max', 'accept', `exactly the maximum (${max})`, atMax);
        add(path, 'max', 'refuse', `one over the maximum (${max})`, 'a'.repeat(max + 1));
        if (max >= 4)
          add(
            path,
            'unicode',
            'accept',
            `emoji up to the maximum (${max})`,
            '😀'.repeat(Math.floor(max / 2)),
          );
      }
      if (len !== undefined) {
        add(path, 'size', 'refuse', `one under the exact length (${len})`, 'a'.repeat(len - 1));
        add(path, 'size', 'refuse', `one over the exact length (${len})`, 'a'.repeat(len + 1));
      }
      for (const [kind, bad, label] of [
        ['email', 'not-an-email', 'not an email'],
        ['url', 'not a url', 'not a url'],
        ['uuid', 'not-a-uuid', 'not a uuid'],
        ['datetime', 'yesterday', 'not a date-time'],
      ])
        if (hasCheck(s, kind)) add(path, 'format', 'refuse', label, bad);
      if (hasCheck(s, 'regex')) {
        const bad = ['', ' ', '!!!', '#', '\u0000bad', 'x'.repeat(3)].find(
          (b) => !fieldSchema.safeParse(b).success && typeof b === 'string',
        );
        if (bad !== undefined) add(path, 'format', 'refuse', 'does not match the pattern', bad);
        else
          uncovered.push({ field: path.join('.'), reason: 'pattern rule: no refused value found' });
      }
    } else if (t === 'ZodNumber') {
      if (!coerced) add(path, 'type', 'refuse', 'text instead of a number', 'abc');
      const lo = hasCheck(s, 'min');
      const hi = hasCheck(s, 'max');
      if (lo) {
        add(
          path,
          'min',
          'accept',
          lo.inclusive
            ? `exactly the minimum (${lo.value})`
            : `just above the minimum (${lo.value})`,
          lo.inclusive ? lo.value : hasCheck(s, 'int') ? lo.value + 1 : lo.value + 0.5,
        );
        add(
          path,
          'min',
          'refuse',
          `below the minimum (${lo.value})`,
          lo.inclusive ? lo.value - 1 : lo.value,
        );
      }
      if (hi) {
        add(
          path,
          'max',
          'accept',
          hi.inclusive
            ? `exactly the maximum (${hi.value})`
            : `just below the maximum (${hi.value})`,
          hi.inclusive ? hi.value : hasCheck(s, 'int') ? hi.value - 1 : hi.value - 0.5,
        );
        add(
          path,
          'max',
          'refuse',
          `above the maximum (${hi.value})`,
          hi.inclusive ? hi.value + 1 : hi.value,
        );
      }
      if (hasCheck(s, 'int'))
        add(path, 'format', 'refuse', 'a fraction where a whole number is needed', 1.5);
      if (!coerced && hasCheck(s, 'finite'))
        add(path, 'format', 'refuse', 'not a finite number', Infinity);
    } else if (t === 'ZodBoolean')
      add(path, 'type', 'refuse', 'text instead of true/false', 'maybe');
    else if (t === 'ZodEnum' || t === 'ZodNativeEnum') {
      const vals = t === 'ZodEnum' ? s._def.values : Object.values(s._def.values);
      add(path, 'enum', 'refuse', 'a value outside the list', '__not_in_list__');
      add(
        path,
        'enum',
        'accept',
        `the last listed value (${String(vals[vals.length - 1])})`,
        vals[vals.length - 1],
      );
    } else if (t === 'ZodLiteral')
      add(path, 'enum', 'refuse', 'not the allowed literal', '__not_the_literal__');
    else if (t === 'ZodArray') {
      add(path, 'type', 'refuse', 'text instead of a list', 'x');
      const min = s._def.minLength?.value ?? s._def.exactLength?.value;
      const max = s._def.maxLength?.value ?? s._def.exactLength?.value;
      const item = sampleOf(s._def.type);
      if (min >= 1 && item !== undefined)
        add(
          path,
          'size',
          'refuse',
          `one under the minimum (${min}) items`,
          Array.from({ length: min - 1 }, () => item),
        );
      if (max !== undefined && max < 10000 && item !== undefined) {
        add(
          path,
          'size',
          'accept',
          `exactly ${max} items`,
          Array.from({ length: max }, () => item),
        );
        add(
          path,
          'size',
          'refuse',
          `one over the maximum (${max}) items`,
          Array.from({ length: max + 1 }, () => item),
        );
      }
    } else if (t === 'ZodObject') {
      if (!present) {
        uncovered.push({
          field: path.join('.'),
          reason: 'optional object that the base body leaves out: its fields are not exercised',
        });
        return;
      }
      add(path, 'type', 'refuse', 'text instead of an object', 'x');
      for (const [k, f] of Object.entries(s.shape)) visit([...path, k], f);
    } else if (t === 'ZodUnion' || t === 'ZodDiscriminatedUnion')
      uncovered.push({ field: path.join('.'), reason: 'union: only the base option is exercised' });
    else if (t === 'ZodRecord' || t === 'ZodAny' || t === 'ZodUnknown') {
      /* free-form: no rule to test */
    } else if (!['ZodDate', 'ZodNull', 'ZodUndefined', 'ZodBigInt'].includes(t))
      uncovered.push({ field: path.join('.'), reason: `type ${t} has no generated scenarios` });
  };
  for (const [k, f] of Object.entries(root.s.shape)) visit([k], f);

  // An accept scenario that another rule refuses (a custom check, a cross-field rule) is a rule we could not satisfy, not a defect.
  const kept = [];
  for (const sc of out) {
    const why = runScenario(schema, sc);
    if (why && sc.kind === 'accept')
      uncovered.push({
        field: sc.field,
        reason: `${sc.rule} boundary was refused by another rule (${why.replace(/^refused: /, '').slice(0, 70)})`,
      });
    else kept.push(sc);
  }
  return { scenarios: kept, uncovered, unbuildable: false, coercedFields };
}

/** Runs one scenario. Refusals must point at the field. Returns null when it behaves, else why not. */
export function runScenario(schema, sc) {
  const r = schema.safeParse(sc.body);
  if (sc.kind === 'accept')
    return r.success
      ? null
      : `refused: ${r.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .slice(0, 2)
          .join('; ')}`;
  if (r.success) return 'accepted';
  const target = sc.field.split('.');
  const hit = r.error.issues.some(
    (i) =>
      target.every((seg, n) => String(i.path[n]) === seg) ||
      (sc.rule === 'required' && String(i.path[0]) === target[0]),
  );
  return hit
    ? null
    : `refused, but not on "${sc.field}" (${r.error.issues
        .map((i) => i.path.join('.') || '(body)')
        .slice(0, 3)
        .join(', ')})`;
}

const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/** Every body schema bound in a controller: { module, name, file }. */
export function boundSchemas() {
  const out = new Map();
  for (const mod of readdirSync(MODULES)
    .filter((n) => statSync(join(MODULES, n)).isDirectory())
    .sort()) {
    for (const f of walk(join(MODULES, mod)).filter((x) => x.endsWith('.controller.ts'))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/@Body\(\s*(?:[^)]*?\()?\s*(\w+Schema)\s*\)?/g)) {
        // `const removeBodySchema = removeWaGroupParticipantsInputSchema;` is an alias: test the schema it points at
        const alias = new RegExp(`const\\s+${m[1]}\\s*=\\s*(\\w+Schema)\\s*;`).exec(src);
        out.set(`${mod}:${m[1]}`, {
          module: mod,
          name: alias ? alias[1] : m[1],
          file: relative(ROOT, f),
          local: m[1],
        });
      }
    }
  }
  return [...out.values()];
}

const tierOf = (mod) =>
  existsSync(join(EDGE, `${mod}.json`))
    ? (JSON.parse(readFileSync(join(EDGE, `${mod}.json`), 'utf8')).tier ?? 'P1')
    : 'P1';

/** Builds the catalogue (one object per module) from the repo. Pure given the contracts. */
export function build(contracts, bound = boundSchemas()) {
  const byModule = new Map();
  for (const b of bound) {
    const schema = contracts[b.name];
    const tier = tierOf(b.module);
    const entry = { schema: b.name, file: b.file };
    if (!schema || typeof schema.safeParse !== 'function') {
      entry.unresolved = true;
      entry.scenarios = [];
      entry.uncovered = [
        {
          field: '(body)',
          reason: 'schema is not exported from @crm/contracts',
          priority: priorityOf(tier, 'required', '(body)'),
        },
      ];
    } else {
      const { scenarios, uncovered, coercedFields } = scenariosOf(schema);
      entry.coercedFields = coercedFields;
      entry.scenarios = scenarios.map((s) => ({
        field: s.field,
        rule: s.rule,
        kind: s.kind,
        label: s.label,
        value: s.valueText,
        priority: priorityOf(tier, s.rule, s.field),
      }));
      entry.uncovered = uncovered.map((u) => ({
        ...u,
        priority: priorityOf(tier, 'required', u.field),
      }));
      entry.drop = scenarios.filter((s) => runScenario(schema, s) !== null).length;
    }
    if (!byModule.has(b.module)) byModule.set(b.module, { module: b.module, tier, schemas: [] });
    byModule.get(b.module).schemas.push(entry);
  }
  return [...byModule.values()].sort((a, b) => a.module.localeCompare(b.module));
}

export function statsOf(mod) {
  const rows = { P0: { n: 0, miss: 0 }, P1: { n: 0, miss: 0 }, P2: { n: 0, miss: 0 } };
  let schemas = 0;
  let failing = 0;
  let coerced = 0;
  for (const s of mod.schemas) {
    coerced += s.coercedFields ?? 0;
    schemas++;
    failing += s.drop ?? 0;
    for (const x of s.scenarios) rows[x.priority].n++;
    for (const u of s.uncovered) rows[u.priority].miss++;
  }
  return { schemas, scenarios: rows.P0.n + rows.P1.n + rows.P2.n, rows, failing, coerced };
}

export function renderReport(cat) {
  const sum = (f) => cat.reduce((n, m) => n + f(statsOf(m)), 0);
  const p = (k) => ({ n: sum((s) => s.rows[k].n), miss: sum((s) => s.rows[k].miss) });
  const pct = (k) => {
    const x = p(k);
    return x.n + x.miss ? ((100 * x.n) / (x.n + x.miss)).toFixed(1) : '100.0';
  };
  const out = [
    '# Form validation scenarios (QA task 12)',
    '',
    '_Generated by `tools/quality/form-validation.mjs`. Do not edit by hand; run it with `--write`._',
    '',
    `${cat.length} modules, ${sum((s) => s.schemas)} body schemas, ${sum((s) => s.scenarios)} scenarios. Every scenario is run through its schema; ${sum((s) => s.failing)} do not behave as promised. ${sum((s) => s.coerced)} fields are preprocessed or coerced: they accept many inputs by design, so no wrong-type scenario applies, and they are not counted as missing rules.`,
    '',
    '| Priority | Scenarios | Rules not generated | Coverage |',
    '| --- | ---: | ---: | ---: |',
  ];
  for (const k of ['P0', 'P1', 'P2']) out.push(`| ${k} | ${p(k).n} | ${p(k).miss} | ${pct(k)}% |`);
  out.push(
    '',
    '| Module | Tier | Schemas | Scenarios | P0 | P1 | Not generated (P0/P1) |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const m of [...cat].sort(
    (a, b) => a.tier.localeCompare(b.tier) || a.module.localeCompare(b.module),
  )) {
    const s = statsOf(m);
    out.push(
      `| ${m.module} | ${m.tier} | ${s.schemas} | ${s.scenarios} | ${s.rows.P0.n} | ${s.rows.P1.n} | ${s.rows.P0.miss + s.rows.P1.miss} |`,
    );
  }
  const un = unresolvedOf(cat);
  if (un.length)
    out.push(
      '',
      `## Body schemas defined outside @crm/contracts (${un.length})`,
      '',
      'Request shapes belong in `@crm/contracts`. These are defined in the controller, so they cannot be tested here. The list only shrinks.',
      '',
      ...un.map((u) => `- \`${u}\``),
    );
  return out.join('\n') + '\n';
}

/** Body schemas bound in a controller but not exported from @crm/contracts (defined in the controller itself). */
export const unresolvedOf = (cat) =>
  cat
    .flatMap((m) => m.schemas.filter((s) => s.unresolved).map((s) => `${m.module}/${s.schema}`))
    .sort();

export const baselineOf = (cat) => ({
  ...Object.fromEntries(
    cat.map((m) => {
      const s = statsOf(m);
      return [m.module, { notGenerated: s.rows.P0.miss + s.rows.P1.miss, failing: s.failing }];
    }),
  ),
  _unresolved: unresolvedOf(cat),
});

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const contracts = createRequire(join(ROOT, 'packages/contracts/package.json'))('./dist/index.js');
  const cat = build(contracts);
  const baseFile = join(OUT, 'baseline.json');
  const texts = new Map(cat.map((m) => [`${m.module}.json`, JSON.stringify(m, null, 2) + '\n']));
  if (process.argv.includes('--write') || process.argv.includes('--write-baseline')) {
    mkdirSync(OUT, { recursive: true });
    if (process.argv.includes('--write'))
      for (const [n, t] of texts) writeFileSync(join(OUT, n), t);
    if (!existsSync(baseFile) || process.argv.includes('--write-baseline'))
      writeFileSync(baseFile, JSON.stringify(baselineOf(cat), null, 2) + '\n');
    writeFileSync(join(OUT, 'REPORT.md'), renderReport(cat));
    console.log(`wrote ${cat.length} module files`);
  } else {
    const errs = [];
    for (const [n, t] of texts) {
      const f = join(OUT, n);
      if (!existsSync(f)) errs.push(`${n} is missing`);
      else if (readFileSync(f, 'utf8') !== t) errs.push(`${n} is out of date`);
    }
    for (const m of cat)
      for (const s of m.schemas)
        if (s.drop)
          errs.push(`${m.module}/${s.schema}: ${s.drop} scenario(s) do not behave as promised`);
    const base = existsSync(baseFile) ? JSON.parse(readFileSync(baseFile, 'utf8')) : null;
    if (base)
      for (const [mod, b] of Object.entries(baselineOf(cat)).filter(([k]) => k !== '_unresolved'))
        if (b.notGenerated > (base[mod]?.notGenerated ?? 0))
          errs.push(
            `${mod}: rules without scenarios grew from ${base[mod]?.notGenerated ?? 0} to ${b.notGenerated}`,
          );
    if (base)
      for (const u of unresolvedOf(cat))
        if (!(base._unresolved ?? []).includes(u))
          errs.push(`${u} is defined outside @crm/contracts and is not on the known list`);
    console.log(
      `form validation: ${cat.length} modules, ${cat.reduce((n, m) => n + statsOf(m).scenarios, 0)} scenarios`,
    );
    if (errs.length) {
      console.error(
        `${errs.length} problem(s):\n- ${errs.slice(0, 40).join('\n- ')}\nRun: node tools/quality/form-validation.mjs --write`,
      );
      process.exit(1);
    }
  }
}
