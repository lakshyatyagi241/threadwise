import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PLANS_DIR = resolve(__dirname, '../../../src/modules/plans-subscriptions-trials');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** The text of the first argument of every `sql.raw(` call in `src`, parentheses and quotes balanced. */
function rawArguments(src: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = src.indexOf('sql.raw(', from);
    if (at === -1) return out;
    let i = at + 'sql.raw('.length;
    const start = i;
    let depth = 1;
    let quote: string | null = null;
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i]!;
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    out.push(src.slice(start, i - 1));
    from = i;
  }
}

/**
 * The plan catalogue is the operator's, not a tenant's: `plans` and
 * `org_plan_state` accept writes only under the privileged flag. Every
 * privileged transaction in this module goes through PlanStore, so the
 * cross-tenant surface of the plans domain is one file that can be read in
 * a minute (the same rule the auth module follows).
 */
describe('privileged database access in the plans module', () => {
  it('finds the module sources (the scan is not vacuous)', () => {
    const names = files(PLANS_DIR).map((f) => relative(PLANS_DIR, f));
    expect(names).toEqual(
      expect.arrayContaining([
        'plan-store.ts',
        'plan-admin.service.ts',
        'plan-catalog.service.ts',
        'plan-entitlement.service.ts',
        'plans.controller.ts',
        'platform-plans.controller.ts',
      ]),
    );
  });

  it('the sql.raw scanner sees interpolation and balances parentheses and quotes', () => {
    expect(rawArguments('sql.raw(`a ${b} (c)`)')).toEqual(['`a ${b} (c)`']);
    expect(rawArguments("x = sql.raw('p)'); y = sql.raw(name)")).toEqual(["'p)'", 'name']);
    expect(rawArguments('no raw sql here')).toEqual([]);
  });

  it('confines `.privileged(` to plan-store.ts', () => {
    const callers = files(PLANS_DIR)
      .filter((f) => /\.privileged\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(PLANS_DIR, f));
    expect(callers).toEqual(['plan-store.ts']);
  });

  it('keeps the controllers away from the database and the store', () => {
    for (const f of ['plans.controller.ts', 'platform-plans.controller.ts']) {
      const src = readFileSync(join(PLANS_DIR, f), 'utf8');
      expect(src, f).not.toMatch(/DatabaseService|PlanStore|\.privileged\(|\.primary\b/);
    }
  });

  it('routes every operator write through the store', () => {
    const admin = readFileSync(join(PLANS_DIR, 'plan-admin.service.ts'), 'utf8');
    expect(admin).toMatch(/this\.store\.tx\(/);
    expect(admin).not.toMatch(/DatabaseService/);
    expect(admin).not.toMatch(/\.privileged\(/);
  });

  it('never passes caller input into SQL text', () => {
    // sql.raw() bypasses parameterisation. The only use is the constant column list.
    const users = files(PLANS_DIR).filter((f) => /sql\.raw\(/.test(readFileSync(f, 'utf8')));
    expect(users.map((f) => relative(PLANS_DIR, f))).toEqual(['plan-row.ts']);

    for (const f of users) {
      for (const arg of rawArguments(readFileSync(f, 'utf8'))) {
        // A static string only: no interpolation, no concatenation with a variable, no identifier argument.
        expect(arg, `${relative(PLANS_DIR, f)}: sql.raw(${arg.slice(0, 40)}...)`).not.toMatch(
          /\$\{/,
        );
        expect(arg.trim().replace(/,$/, '')).toMatch(/^`[^`]*`$|^'[^']*'$|^"[^"]*"$/);
      }
    }
  });

  it('builds statements with bound parameters only (no string-built SQL around sql``)', () => {
    for (const f of files(PLANS_DIR)) {
      const src = readFileSync(f, 'utf8');
      // `+` or a template inside a call that executes SQL text would bypass binding.
      expect(src, f).not.toMatch(/\.execute\(\s*[`'"]/);
      expect(src, f).not.toMatch(/\.query\(/);
    }
  });
});
