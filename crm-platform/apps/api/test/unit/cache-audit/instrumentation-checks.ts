import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_SRC, REPO_ROOT, walk, rel } from './scan';
import type { Register } from './checks';

/**
 * Rules of the cache hit-rate ratchet (Sheet3 #65), pure like the ones in checks.ts: each returns a list of violations (empty = pass).
 * The spec runs them on the real source and again on deliberately bad input, so a rule that cannot fail is noticed.
 */
export interface SourceFile {
  file: string;
  text: string;
}

export const METRIC_NAME = /^[a-z][a-z0-9_]{0,47}$/;
const MIN_REASON = 60;
const EXEMPTIONS = new Set(['not-meaningful', 'not-observable']);
/** `cacheMetrics('name')` with a plain string literal. Anything else (a variable, a template) is how a tenant id could become a label. */
const LITERAL_CALL = /\bcacheMetrics\(\s*(['"])([^'"\n]*)\1\s*\)/g;
const ANY_CALL = /\bcacheMetrics\(/g;

export const loadApiSources = (): SourceFile[] =>
  walk(API_SRC).map((f) => ({ file: rel(f), text: readFileSync(f, 'utf8') }));

const callsIn = (text: string): string[] => [...text.matchAll(LITERAL_CALL)].map((m) => m[2]!);

export function checkInstrumentation(reg: Register, files: SourceFile[]): string[] {
  const out: string[] = [];
  const byFile = new Map(files.map((f) => [f.file, f.text]));
  const claimed = new Map<string, string>();

  for (const c of reg.caches) {
    const ins = c.instrumentation as
      | {
          instrumented?: boolean;
          metrics?: string[];
          hitRatioAlert?: boolean;
          alsoIn?: string[];
          exemption?: string;
          reason?: string;
        }
      | undefined;
    if (!ins || typeof ins.instrumented !== 'boolean') {
      out.push(`${c.id}: no instrumentation entry (instrument it, or write an exemption with a reason)`);
      continue;
    }
    if (!ins.instrumented) {
      if (!ins.exemption || !EXEMPTIONS.has(ins.exemption))
        out.push(`${c.id}: exemption must be one of ${[...EXEMPTIONS].join(' / ')}`);
      if ((ins.reason ?? '').length < MIN_REASON)
        out.push(`${c.id}: the exemption reason is missing or shorter than ${MIN_REASON} characters`);
      continue;
    }
    if (typeof ins.hitRatioAlert !== 'boolean') out.push(`${c.id}: hitRatioAlert must be true or false`);
    if (!ins.metrics || ins.metrics.length === 0) {
      out.push(`${c.id}: instrumented but names no metric`);
      continue;
    }
    const where = [c.location as string, ...(ins.alsoIn ?? [])];
    for (const m of ins.metrics) {
      if (!METRIC_NAME.test(m)) out.push(`${c.id}: metric name "${m}" does not match ${METRIC_NAME}`);
      const owner = claimed.get(m);
      if (owner && owner !== c.id) out.push(`${c.id}: metric "${m}" is already used by ${owner}`);
      claimed.set(m, c.id);
      const found = where.some((f) => callsIn(byFile.get(f) ?? '').includes(m));
      if (!found) out.push(`${c.id}: no cacheMetrics('${m}') call in ${where.join(' or ')}`);
    }
  }

  for (const f of files) {
    if (f.file.includes('/test/')) continue;
    const literal = callsIn(f.text);
    const all = (f.text.match(ANY_CALL) ?? []).length;
    if (all !== literal.length)
      out.push(`${f.file}: cacheMetrics() must take a string literal (a computed name could carry an id)`);
    for (const m of literal)
      if (!claimed.has(m)) out.push(`${f.file}: cacheMetrics('${m}') is not in register.json`);
  }
  return out;
}

export const RULES_PATH = join(REPO_ROOT, 'deploy/observability/cache-hit-rate.rules.yml');

/** The alert rules name the caches whose hit ratio is a signal. This keeps that list equal to the register. */
export function checkRulesSync(reg: Register, rulesText: string): string[] {
  const want = reg.caches
    .filter((c) => c.instrumentation?.instrumented && c.instrumentation.hitRatioAlert)
    .flatMap((c) => c.instrumentation.metrics as string[])
    .sort();
  const m = /cache=~"([^"]+)"/.exec(rulesText.split('alert: CacheHitRatioLow')[1] ?? '');
  if (!m) return ['cache-hit-rate.rules.yml: CacheHitRatioLow has no cache=~"..." selector'];
  const have = m[1]!.split('|').sort();
  const out: string[] = [];
  for (const n of want) if (!have.includes(n)) out.push(`rules: ${n} has hitRatioAlert in the register but is not in CacheHitRatioLow`);
  for (const n of have) if (!want.includes(n)) out.push(`rules: ${n} is in CacheHitRatioLow but the register does not ask for it`);
  return out;
}
