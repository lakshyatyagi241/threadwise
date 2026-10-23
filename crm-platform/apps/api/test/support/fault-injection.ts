/**
 * Test-only fault injector for the transactions that opt in to a retry (`db.retry` / `db.retryIdem`).
 *
 * Switched on by `DB_FAULT=deadlock` (see `setupFiles` in vitest.config.ts); with it unset this file is never loaded, and nothing in
 * `src/` knows about it. For each retried transaction the FIRST attempt runs its whole callback (every write is sent), then fails with
 * a Postgres deadlock (40P01), the worst moment: Postgres rolls everything back and the retry has to redo the work from the start.
 * If a path left a partial row, a duplicate, or an effect outside the transaction, the spec that exercises it fails.
 *
 * Every injection is appended to `DB_FAULT_LOG` (default reports/fault-injection/hits.jsonl) as {site, outcome}, where site is the first
 * stack frame under src/modules, so a run can show which of the retried call sites were really exercised and recovered.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseService } from '../../src/infra/db/database.service';

type Fn = (tx: unknown) => Promise<unknown>;

const LOG = resolve(process.env.DB_FAULT_LOG ?? 'reports/fault-injection/hits.jsonl');

function record(site: string, outcome: 'injected' | 'recovered' | 'failed'): void {
  mkdirSync(dirname(LOG), { recursive: true });
  appendFileSync(LOG, JSON.stringify({ site, outcome }) + '\n');
}

/** First frame inside src/modules (the service that asked for the retry), as `path:line`. */
function callSite(): string {
  const frame = (new Error().stack ?? '')
    .split('\n')
    .find((l) => l.includes('/src/modules/') && !l.includes('database.service'));
  const m = frame?.match(/src\/modules\/([^:)]+:\d+)/);
  return m ? m[1]! : 'unknown';
}

if (process.env.DB_FAULT === 'deadlock') {
  const proto = DatabaseService.prototype as unknown as Record<
    string,
    (...a: unknown[]) => Promise<unknown>
  >;
  for (const [name, fnIndex] of [
    ['tx', 0],
    ['txAs', 1],
    ['privileged', 0],
  ] as const) {
    const original = proto[name]!;
    proto[name] = function (this: unknown, ...args: unknown[]): Promise<unknown> {
      const opts = args[fnIndex + 1] as { retry?: unknown } | undefined;
      if (!opts?.retry) return original.apply(this, args); // only the transactions that opted in to a retry
      const site = callSite();
      const fn = args[fnIndex] as Fn;
      let injected = false;
      args[fnIndex] = async (tx: unknown) => {
        const out = await fn(tx);
        if (!injected) {
          injected = true;
          record(site, 'injected');
          throw Object.assign(new Error('injected deadlock'), { code: '40P01' });
        }
        return out;
      };
      return original.apply(this, args).then(
        (r) => {
          if (injected) record(site, 'recovered');
          return r;
        },
        (e: unknown) => {
          if (injected) record(site, 'failed');
          throw e;
        },
      );
    };
  }
}
