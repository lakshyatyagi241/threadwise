// Re-runs the one check behind a bug and says whether it still fails; the "after" screenshot comes from a passing run.
//   node qa-daily/recheck.mjs <bug-id> [--target local|prod] [--rebuild]
//   --target local (default)  uses the stack from qa-daily/stack.sh (--rebuild: build this checkout, restart the stack first)
//   --target prod             runs against QA_BASE_URL / https://desk.wabo.ai with the QA_* credentials from the environment
// Exit 0 = the bug no longer reproduces, 1 = it still does, 2 = could not run (site down, unknown bug).
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT, WEB, DATE, readJson, tryRun, log, probe, targetConfig } from './lib.mjs';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function walk(suite, hit) {
  for (const s of suite.suites ?? []) walk(s, hit);
  for (const spec of suite.specs ?? []) for (const t of spec.tests ?? []) hit(spec, t);
}

/** Cached bug rows: the orchestrator writes out/bugs-cache/<id>.json before handing a bug to anyone. */
export const bugPath = (id) => join(OUT, 'bugs-cache', `${id}.json`);

export async function recheck(bug, { target = 'local' } = {}) {
  const cfg = targetConfig(target);
  const p = await probe(cfg.base);
  if (!p.up) return { code: 2, message: `site not reachable: ${p.why}` };
  const env = {
    ...process.env,
    HEADLESS: '1',
    QA_PROOF: '1',
    QA_TARGET: target,
    QA_BASE_URL: cfg.base,
    CHROMIUM_PATH:
      process.env.CHROMIUM_PATH ??
      (existsSync(`${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`)
        ? `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`
        : ''),
  };
  if (target === 'local') {
    const f = join(OUT, 'stack.env');
    if (existsSync(f)) {
      const r = tryRun('bash', ['-c', `set -a; . "${f}"; env`]);
      for (const l of r.out.split('\n'))
        if (/^(QA_|E2E_)/.test(l)) env[l.slice(0, l.indexOf('='))] = l.slice(l.indexOf('=') + 1);
    }
  }
  mkdirSync(join(OUT, 'recheck'), { recursive: true });
  const json = join(OUT, 'recheck', `${bug.ID}.json`);

  if (bug.Test) {
    const r = tryRun(
      'pnpm',
      [
        'exec',
        'playwright',
        'test',
        '-c',
        'qa-daily/playwright.live.config.ts',
        '-g',
        esc(bug.Test),
      ],
      {
        cwd: WEB,
        env: { ...env, PW_JSON: json },
        timeout: 15 * 60_000,
      },
    );
    const res = readJson(json, null);
    let status = null;
    let proof = null;
    let message = '';
    if (res)
      walk(res, (spec, t) => {
        const last = t.results?.at(-1);
        if (!last) return;
        status = last.status;
        message = last.error?.message?.split('\n')[0] ?? '';
        const a = last.attachments?.find((x) => x.name === 'proof');
        if (a?.path) proof = a.path;
        else if (a?.body) {
          // an API-only journey inlines its proof card in the JSON report
          proof = join(OUT, 'recheck', `${bug.ID}-proof.png`);
          writeFileSync(proof, Buffer.from(a.body, 'base64'));
        }
      });
    if (status === null)
      return {
        code: 2,
        message: `the check did not run (test "${bug.Test}" not found?)\n${r.out.slice(-600)}`,
      };
    if (status === 'skipped') return { code: 2, message: 'the check is skipped on this target' };
    return status === 'passed' ? { code: 0, message: 'passes', proof } : { code: 1, message };
  }

  // page-level bug from the crawler: re-crawl that one page and see if the same fingerprint comes back
  const r = tryRun('pnpm', ['exec', 'playwright', 'test', '-c', 'qa-daily/playwright.config.ts'], {
    cwd: WEB,
    env: { ...env, QA_FILTER: bug.Page, QA_LIMIT: '1' },
    timeout: 10 * 60_000,
  });
  const bugs = readJson(join(OUT, DATE, 'bugs.json'), null);
  if (!bugs) return { code: 2, message: `the crawl did not run\n${r.out.slice(-600)}` };
  if (bugs.some((b) => b.id === bug.ID))
    return { code: 1, message: 'the crawler still finds this bug' };
  const slug = bug.Page.replace(/\W+/g, '_') || 'home';
  const proof = join(OUT, DATE, `${slug}.proof.jpg`);
  return { code: 0, message: 'no longer found', proof: existsSync(proof) ? proof : null };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const id = process.argv[2];
  const target = process.argv.includes('--target')
    ? process.argv[process.argv.indexOf('--target') + 1]
    : 'local';
  const bug = readJson(bugPath(id), null);
  if (!bug) {
    console.error(`unknown bug ${id}: no ${bugPath(id)}`);
    process.exit(2);
  }
  if (process.argv.includes('--rebuild')) {
    const b = tryRun(
      'bash',
      [
        '-c',
        "export NODE_OPTIONS=--max-old-space-size=6144; bash qa-daily/stack.sh down; (cd ../.. && pnpm --filter './packages/*' build) && pnpm --filter @crm/api build && pnpm --filter @crm/web build && bash qa-daily/stack.sh up",
      ],
      { cwd: WEB, stdio: 'inherit' },
    );
    if (!b.ok) {
      console.error('rebuild failed');
      process.exit(2);
    }
  }
  const r = await recheck(bug, { target });
  log(r.code === 0 ? 'PASS' : r.code === 1 ? 'FAIL' : 'COULD NOT RUN', r.message);
  process.exit(r.code);
}
