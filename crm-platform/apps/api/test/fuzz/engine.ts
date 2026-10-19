import { openSync, writeSync, closeSync } from 'node:fs';
import { Rng } from './gen';

/** Thrown by a target's `run` when an invariant does not hold (as opposed to the code under test throwing). */
export class Violation extends Error {}

export interface Target {
  /** Unique, stable: it seeds the target's inputs, so renaming a target changes what it is fed. */
  name: string;
  group: string;
  /** Share of the input budget. */
  weight: number;
  /** The input with this index. Must be a pure function of the Rng. */
  gen(r: Rng): unknown;
  /** Runs the code under test and checks the invariants; throws `Violation` when one fails. */
  run(input: unknown): void | Promise<void>;
  /** The errors the code is ALLOWED to throw (its validation error type). Anything else is a defect. */
  allow?(e: unknown): boolean;
  /** Time one input may take, in ms (default 1000). A slower one is reported as slow, a probable ReDoS or quadratic path. */
  budgetMs?: number;
  /** Write the progress file before every input (for code that could hang), not every 128th. */
  eachInput?: boolean;
}

export type FailureKind = 'throw' | 'violation' | 'slow' | 'prototype';

export interface Failure {
  target: string;
  group: string;
  kind: FailureKind;
  message: string;
  seed: number;
  iter: number;
  /** How many inputs hit the same failure. */
  count: number;
  input: string;
  /** The smallest input found that still fails the same way (not for `slow`). */
  minimal?: string;
  replay: string;
}

export interface Report {
  seed: number;
  profile: string;
  executed: number;
  durationMs: number;
  perGroup: Record<string, { targets: number; inputs: number }>;
  perTarget: Record<string, number>;
  failures: Failure[];
  slowest: Array<{ target: string; iter: number; ms: number }>;
}

export interface RunOptions {
  seed: number;
  profile: string;
  targets: Target[];
  /** Total inputs to execute across all targets, split by weight. */
  total: number;
  /** Only this target, and only this iteration if `iter` is given (replay). */
  only?: string;
  iter?: number;
  /** Run targets whose index modulo `of` is `index` (parallel runs: inputs depend only on seed, target and iteration). */
  shard?: { index: number; of: number };
  /** Multiplies every time budget (a shared CI machine under load makes a fast input look slow). */
  budgetScale?: number;
  /** A file overwritten with the current position, so a watchdog that sees it stop moving knows where the process hung. */
  progressFile?: string;
  /** Stop starting new targets after this many ms (the inputs executed are reported as they are). */
  deadlineMs?: number;
  log?: (line: string) => void;
}

// --- printing an input -----------------------------------------------------------------------------------------------------------

/** A readable, bounded rendering of an arbitrary input (lone surrogates and control characters escaped; cycles, bigint and depth handled). */
export function show(v: unknown, limit = 400): string {
  const seen = new Set<unknown>();
  const clip = (s: string, n = 160): string => {
    const esc = JSON.stringify(s)
      .slice(1, -1)
      .replace(
        new RegExp(
          '[\\ud800-\\udfff\\u007f-\\u00a0\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]',
          'g',
        ),
        (c) => `\\u${c.charCodeAt(0).toString(16)}`,
      );
    return esc.length > n ? `"${esc.slice(0, n)}"...(+${s.length} chars)` : `"${esc}"`;
  };
  const go = (x: unknown, depth: number): string => {
    if (typeof x === 'string') return clip(x);
    if (typeof x === 'bigint') return `${x}n`;
    if (typeof x === 'number' || typeof x === 'boolean' || x === null || x === undefined)
      return Object.is(x, -0) ? '-0' : String(x);
    if (typeof x === 'function' || typeof x === 'symbol') return `<${typeof x}>`;
    if (seen.has(x)) return '<cycle>';
    if (depth > 6) return '<deeper>';
    seen.add(x);
    try {
      if (Array.isArray(x)) {
        const inner = x
          .slice(0, 6)
          .map((e) => go(e, depth + 1))
          .join(', ');
        return `[${inner}${x.length > 6 ? `, ...(${x.length} items)` : ''}]`;
      }
      if (x instanceof Date) return `Date(${x.getTime()})`;
      const entries = Object.entries(x as object);
      const inner = entries
        .slice(0, 8)
        .map(([k, e]) => `${clip(k, 40)}: ${go(e, depth + 1)}`)
        .join(', ');
      return `{${inner}${entries.length > 8 ? `, ...(${entries.length} keys)` : ''}}`;
    } finally {
      seen.delete(x);
    }
  };
  const out = go(v, 0);
  return out.length > limit ? `${out.slice(0, limit)}...` : out;
}

// --- shrinking -------------------------------------------------------------------------------------------------------------------

function* candidates(v: unknown, depth = 0): Generator<unknown> {
  if (typeof v === 'string') {
    if (v.length === 0) return;
    yield '';
    for (let n = Math.ceil(v.length / 2); n >= 1; n = n === 1 ? 0 : Math.floor(n / 2)) {
      for (let i = 0; i < v.length; i += n) yield v.slice(0, i) + v.slice(i + n);
    }
  } else if (typeof v === 'number') {
    if (v !== 0) yield 0;
    if (v !== 1) yield 1;
  } else if (Array.isArray(v) && depth < 6) {
    if (v.length > 0) yield [];
    for (let i = 0; i < v.length; i += 1) yield [...v.slice(0, i), ...v.slice(i + 1)];
    for (let i = 0; i < v.length; i += 1)
      for (const c of candidates(v[i], depth + 1)) yield [...v.slice(0, i), c, ...v.slice(i + 1)];
  } else if (v !== null && typeof v === 'object' && !(v instanceof Date) && depth < 6) {
    const keys = Object.keys(v);
    if (keys.length > 0) yield {};
    const rebuild = (skip: string | null, key?: string, val?: unknown) => {
      const o: Record<string, unknown> = {};
      for (const k of keys) {
        const value = k === key ? val : (v as Record<string, unknown>)[k];
        if (k !== skip)
          Object.defineProperty(o, k, {
            value,
            enumerable: true,
            writable: true,
            configurable: true,
          });
      }
      return o;
    };
    for (const k of keys) yield rebuild(k);
    for (const k of keys)
      for (const c of candidates((v as Record<string, unknown>)[k], depth + 1))
        yield rebuild(null, k, c);
  }
}

function hasCycleOrIsHuge(v: unknown, budget = { n: 20000 }, path = new Set<unknown>()): boolean {
  if (typeof v === 'string') return v.length > 2_000_000;
  if (v === null || typeof v !== 'object') return false;
  if (path.has(v) || path.size > 100 || budget.n-- <= 0) return true;
  path.add(v);
  const bad = (Array.isArray(v) ? v : Object.values(v)).some((e) =>
    hasCycleOrIsHuge(e, budget, path),
  );
  path.delete(v);
  return bad;
}

/** Greedy delta-debugging: keeps any smaller input that still fails the same way, until none does or the time is up. */
export async function shrink(
  input: unknown,
  stillFails: (v: unknown) => Promise<boolean>,
  maxMs = 4000,
): Promise<unknown> {
  if (hasCycleOrIsHuge(input)) return input;
  const stop = Date.now() + maxMs;
  let cur = input;
  for (let changed = true; changed && Date.now() < stop;) {
    changed = false;
    for (const c of candidates(cur)) {
      if (Date.now() >= stop) break;
      if (await stillFails(c)) {
        cur = c;
        changed = true;
        break;
      }
    }
  }
  return cur;
}

// --- running ---------------------------------------------------------------------------------------------------------------------

type Outcome = { kind: FailureKind; message: string } | null;

const PROTOS: object[] = [
  Object.prototype,
  Array.prototype,
  Function.prototype,
  String.prototype,
  Number.prototype,
];
const protoNames = () => PROTOS.map((p) => Object.getOwnPropertyNames(p).length);
const baseline = protoNames();
const baselineSets = PROTOS.map((p) => new Set(Object.getOwnPropertyNames(p)));

/** Removes any property added to a shared prototype and returns their names (empty when nothing changed). */
function protoDamage(): string[] {
  const now = protoNames();
  if (now.every((n, i) => n === baseline[i])) return [];
  const added: string[] = [];
  PROTOS.forEach((p, i) => {
    for (const name of Object.getOwnPropertyNames(p)) {
      if (!baselineSets[i]!.has(name)) {
        added.push(name);
        delete (p as Record<string, unknown>)[name];
      }
    }
  });
  return added;
}

async function attempt(t: Target, input: unknown, budget: number): Promise<Outcome> {
  const t0 = performance.now();
  let out: Outcome = null;
  try {
    const r = t.run(input);
    if (r) await r;
  } catch (e) {
    if (e instanceof Violation) out = { kind: 'violation', message: e.message };
    else if (!t.allow?.(e)) {
      const name = e instanceof Error ? e.constructor.name : typeof e;
      const msg = e instanceof Error ? e.message : String(e);
      out = { kind: 'throw', message: `${name}: ${msg.replace(/\s+/g, ' ').slice(0, 160)}` };
    }
  }
  const added = protoDamage();
  if (added.length > 0)
    return { kind: 'prototype', message: `a shared prototype gained: ${added.join(', ')}` };
  if (out) return out;
  const dt = performance.now() - t0;
  if (dt > budget) {
    // One slow reading can be a garbage-collection pause; only the second one counts.
    const t1 = performance.now();
    try {
      await t.run(input);
    } catch {
      // the same failure would have been caught above
    }
    protoDamage();
    const again = performance.now() - t1;
    if (again > budget)
      return {
        kind: 'slow',
        message: `took ${Math.round(Math.min(dt, again))} ms (budget ${budget} ms)`,
      };
  }
  return null;
}

/** The first line of a failure message with digits folded, so "took 312 ms" and "took 340 ms" are one failure. */
const signature = (o: NonNullable<Outcome>) =>
  `${o.kind}|${o.message.replace(/\d+/g, '#').slice(0, 100)}`;

export function planCounts(targets: Target[], total: number): Map<string, number> {
  const sum = targets.reduce((a, t) => a + t.weight, 0);
  return new Map(targets.map((t) => [t.name, Math.max(1, Math.ceil((total * t.weight) / sum))]));
}

export async function runFuzz(opts: RunOptions): Promise<Report> {
  const t0 = Date.now();
  const log = opts.log ?? (() => undefined);
  const counts = planCounts(opts.targets, opts.total);
  const failures = new Map<string, Failure>();
  const perGroup: Report['perGroup'] = {};
  const perTarget: Record<string, number> = {};
  const slowest: Report['slowest'] = [];
  const fd = opts.progressFile ? openSync(opts.progressFile, 'w') : null;
  const mark = (idx: number, name: string, iter: number) => {
    if (fd !== null) writeSync(fd, `${idx}|${name}|${iter}`.padEnd(200), 0);
  };
  let executed = 0;

  for (const [idx, t] of opts.targets.entries()) {
    if (opts.only && t.name !== opts.only) continue;
    if (opts.shard && idx % opts.shard.of !== opts.shard.index) continue;
    if (opts.deadlineMs && Date.now() - t0 > opts.deadlineMs) continue;
    const n = opts.iter !== undefined ? 1 : counts.get(t.name)!;
    const budget = (t.budgetMs ?? 1000) * (opts.budgetScale ?? 1);
    const grp = (perGroup[t.group] ??= { targets: 0, inputs: 0 });
    grp.targets += 1;
    const record = async (iter: number, input: unknown, o: NonNullable<Outcome>) => {
      const key = `${t.name}|${signature(o)}`;
      const seen = failures.get(key);
      if (seen) {
        seen.count += 1;
        return;
      }
      const f: Failure = {
        target: t.name,
        group: t.group,
        kind: o.kind,
        message: o.message,
        seed: opts.seed,
        iter,
        count: 1,
        input: show(input),
        replay: `node tools/quality/fuzz.mjs --seed ${opts.seed} --target '${t.name}' --iter ${iter}`,
      };
      if (o.kind !== 'slow' && failures.size < 60) {
        const sig = signature(o);
        const min = await shrink(input, async (c) => {
          const r = await attempt(t, c, budget);
          return r !== null && signature(r) === sig;
        });
        f.minimal = show(min, 600);
      }
      failures.set(key, f);
    };

    for (let i = 0; i < n; i += 1) {
      const iter = opts.iter ?? i;
      if (t.eachInput || (i & 127) === 0) mark(idx, t.name, iter);
      const input = t.gen(Rng.for(opts.seed, t.name, iter));
      const t1 = performance.now();
      const o = await attempt(t, input, budget);
      const dt = performance.now() - t1;
      if (dt > 20 && slowest.length < 2000)
        slowest.push({ target: t.name, iter, ms: Math.round(dt) });
      executed += 1;
      grp.inputs += 1;
      perTarget[t.name] = (perTarget[t.name] ?? 0) + 1;
      if (o) await record(iter, input, o);
    }
  }
  if (fd !== null) closeSync(fd);
  slowest.sort((a, b) => b.ms - a.ms);
  log(`executed ${executed} inputs`);
  return {
    seed: opts.seed,
    profile: opts.profile,
    executed,
    durationMs: Date.now() - t0,
    perGroup,
    perTarget,
    failures: [...failures.values()],
    slowest: slowest.slice(0, 10),
  };
}
