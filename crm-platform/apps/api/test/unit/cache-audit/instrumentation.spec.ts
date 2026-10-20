import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadRegister, type Register } from './checks';
import {
  RULES_PATH,
  checkInstrumentation,
  checkRulesSync,
  loadApiSources,
  type SourceFile,
} from './instrumentation-checks';

/**
 * Cache hit-rate ratchet (Sheet3 #65). Part 1 runs the rules on the real code and register. Part 2 runs each rule on deliberately bad
 * input and expects it to fail: a ratchet that has never been seen to fail proves nothing.
 */
const reg = loadRegister();
const none = (v: string[]) => expect(v, v.join('\n')).toEqual([]);
const clone = (): Register => structuredClone(reg);

describe('part 1: the real code passes every rule', () => {
  it('every registered cache is instrumented (counter call at its hit/miss point) or has a written exemption', () => {
    none(checkInstrumentation(reg, loadApiSources()));
  });

  it('the CacheHitRatioLow selector lists exactly the caches the register marks hitRatioAlert', () => {
    none(checkRulesSync(reg, readFileSync(RULES_PATH, 'utf8')));
  });

  it('totals the report quotes', () => {
    const ins = reg.caches.filter((c) => c.instrumentation.instrumented);
    const exempt = reg.caches.filter((c) => !c.instrumentation.instrumented);
    expect(reg.caches.length).toBe(69);
    expect(ins.length).toBe(52);
    expect(exempt.length).toBe(17);
    expect(exempt.filter((c) => c.instrumentation.exemption === 'not-meaningful').length).toBe(11);
    expect(exempt.filter((c) => c.instrumentation.exemption === 'not-observable').length).toBe(6);
    expect(ins.flatMap((c) => c.instrumentation.metrics).length).toBe(55);
    expect(ins.filter((c) => c.priority === 'P0' && c.instrumentation.hitRatioAlert).length).toBe(
      18,
    );
  });
});

describe('part 2: each rule fails on bad input', () => {
  const real = loadApiSources();

  it('a new cache added to the register with no instrumentation entry fails', () => {
    const r = clone();
    r.caches.push({ ...r.caches[0]!, id: 'X99', instrumentation: undefined });
    const v = checkInstrumentation(r, real);
    expect(v.join('\n')).toContain('X99: no instrumentation entry');
  });

  it('an exemption with a thin reason, or an unknown kind, fails', () => {
    const r = clone();
    const c = r.caches.find((x) => x.id === 'M25')!;
    c.instrumentation.reason = 'not needed';
    c.instrumentation.exemption = 'lazy';
    const v = checkInstrumentation(r, real).join('\n');
    expect(v).toContain('M25: exemption must be one of');
    expect(v).toContain('M25: the exemption reason is missing or shorter');
  });

  it('an instrumented cache whose counter call was removed from the source fails', () => {
    const stripped: SourceFile[] = real.map((f) =>
      f.file.endsWith('booking-page-themes.cache.ts')
        ? { ...f, text: f.text.replaceAll("cacheMetrics('booking_page_theme')", 'null') }
        : f,
    );
    expect(checkInstrumentation(reg, stripped).join('\n')).toContain(
      "R17: no cacheMetrics('booking_page_theme') call",
    );
  });

  it('a computed metric name (the way a workspace id could become a label) fails', () => {
    const bad: SourceFile[] = [
      ...real,
      {
        file: 'apps/api/src/modules/x/bad.ts',
        text: 'const m = cacheMetrics(`ws_${orgId}`); const n = cacheMetrics(name);',
      },
    ];
    expect(checkInstrumentation(reg, bad).join('\n')).toContain('must take a string literal');
  });

  it('a counter that is not in the register fails; so does a name that is not lowercase snake_case', () => {
    const bad: SourceFile[] = [
      ...real,
      { file: 'apps/api/src/modules/x/bad.ts', text: "const m = cacheMetrics('mystery');" },
    ];
    expect(checkInstrumentation(reg, bad).join('\n')).toContain(
      "cacheMetrics('mystery') is not in register.json",
    );
    const r = clone();
    r.caches.find((x) => x.id === 'R01')!.instrumentation.metrics = ['Workspace-42'];
    expect(checkInstrumentation(r, real).join('\n')).toContain('does not match');
  });

  it('two caches sharing one metric name fails', () => {
    const r = clone();
    r.caches.find((x) => x.id === 'R02')!.instrumentation.metrics = ['rbac_grants'];
    expect(checkInstrumentation(r, real).join('\n')).toContain('already used by R01');
  });

  it('a hit-ratio selector that drifted from the register fails in both directions', () => {
    const rules = readFileSync(RULES_PATH, 'utf8');
    const dropped = rules.replace('|rbac_grants|', '|');
    expect(checkRulesSync(reg, dropped).join('\n')).toContain('rbac_grants has hitRatioAlert');
    const added = rules.replace('|rbac_grants|', '|rbac_grants|translation|');
    expect(checkRulesSync(reg, added).join('\n')).toContain(
      'translation is in CacheHitRatioLow but the register does not ask',
    );
  });
});
