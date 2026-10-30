// Turns the functional-journey Playwright JSON report into out/<date>/bugs.json (same shape explore.spec.ts writes, plus env/area/test/file).
//   node qa-daily/report.mjs [out/live-results.json] --env prod|local
// Exit 0 = done (bugs or none), 2 = bad usage, 3 = the site/stack was down for some journeys (see env-problems.json): not a bug.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const P0 = new Set(['auth', 'contacts', 'inbox', 'campaigns', 'forms', 'billing']);
const ENV_PROBLEM =
  /browserType\.launch|Executable doesn't exist|net::ERR_|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|sign-in .*answered 5\d\d|Is the stack up/i;
const HTTP_5XX = /->\s*5\d\d|HTTP 5\d\d|app misbehaved underneath|status (of )?5\d\d/i;
const TIMEOUT = /Timeout \d+ms exceeded|timed out/i;
const FIX = {
  'http-5xx':
    'Reproduce the journey, read the API/server log and the Sentry event for the failing request, fix the unhandled exception and return a 4xx for bad input instead of a 500.',
  'journey-timeout':
    'The flow stalled waiting for something that never appeared. Open the trace, find the step that hung (slow or failed request, missing button, spinner that never ends) and fix that step.',
  'journey-failed':
    'A step of the journey did not behave as expected. Open the screenshot and trace, work out whether the UI or the assertion is wrong, and fix the app (or the journey if the product intentionally changed).',
  flaky:
    'Failed once, passed on retry. Look for a race: a click before the page is ready, a request not awaited, or a slow endpoint.',
};

// eslint-disable-next-line no-control-regex
const clean = (s = '') => s.replace(/\u001b\[[0-9;]*m/g, '').trim();
/** Ids, uuids and numbers differ per run; strip them so the same failure keeps one id day to day (same rule as explore.spec.ts). */
const stable = (s) =>
  s.replace(/[0-9a-f]{8}-[0-9a-f-]{27}|\b[0-9a-f]{12,}\b|\d+/gi, '#').slice(0, 160);

function* specs(suite) {
  for (const s of suite.specs ?? []) yield s;
  for (const c of suite.suites ?? []) yield* specs(c);
}

/** Pure: report JSON in, { bugs, envProblems, shots } out. `shots` = [{ from, to }] to copy; the caller does the file I/O. */
export function toBugs(report, { env, date = new Date().toISOString().slice(0, 10) }) {
  const bugs = new Map();
  const envProblems = [];
  const shots = [];
  for (const top of report.suites ?? []) {
    for (const spec of specs(top)) {
      for (const t of spec.tests ?? []) {
        const results = t.results ?? [];
        const failed = results.filter((r) => r.status === 'failed' || r.status === 'timedOut');
        if (!failed.length) continue;
        const last = results[results.length - 1];
        const flaky = last.status === 'passed';
        const r = failed[failed.length - 1];
        const message = clean(
          r.error?.message ?? r.errors?.[0]?.message ?? 'failed without a message',
        );
        const test = spec.title;
        const file = spec.file ?? top.file ?? '';
        if (ENV_PROBLEM.test(message)) {
          envProblems.push({ env, test, file, message: message.slice(0, 500) });
          continue;
        }
        const area = /^\[([^\]]+)\]/.exec(test)?.[1] ?? 'other';
        const first = message.split('\n')[0];
        const id = createHash('sha1')
          .update(`${env}|${test}|${stable(first)}`)
          .digest('hex')
          .slice(0, 10);
        if (bugs.has(id)) continue;
        const kind = flaky
          ? 'flaky'
          : HTTP_5XX.test(message)
            ? 'http-5xx'
            : TIMEOUT.test(message)
              ? 'journey-timeout'
              : 'journey-failed';
        const severity = flaky ? 'Low' : P0.has(area) || kind === 'http-5xx' ? 'High' : 'Medium';
        // the proof card of an API-only journey is inlined (body) instead of saved (path): prefer it, it shows what was checked
        const imgs = (r.attachments ?? []).filter(
          (a) => /^image\//.test(a.contentType ?? '') && (a.path || a.body),
        );
        const shot = imgs.find((a) => a.body) ?? imgs.at(-1);
        let screenshot = '';
        if (shot) {
          screenshot = join(date, `${id}${shot.body ? '.png' : extname(shot.path) || '.png'}`);
          shots.push(
            shot.body ? { body: shot.body, to: screenshot } : { from: shot.path, to: screenshot },
          );
        }
        bugs.set(id, {
          id,
          date,
          route: `journey:${area}`,
          kind,
          severity,
          title: `${flaky ? 'Flaky journey' : 'Journey failed'} (${env}): ${test}`,
          description: message.slice(0, 800),
          suggestedFix: FIX[kind],
          viewport: 'desktop 1280x800',
          screenshot,
          env,
          area,
          test,
          file,
        });
      }
    }
  }
  return { bugs: [...bugs.values()], envProblems, shots };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--env');
  const env = i >= 0 ? args.splice(i, 2)[1] : undefined;
  if (env !== 'prod' && env !== 'local') {
    console.error('usage: report.mjs [live-results.json] --env prod|local');
    process.exit(2);
  }
  const date = new Date().toISOString().slice(0, 10);
  const outRoot = 'qa-daily/out';
  const out = join(outRoot, date);
  const { bugs, envProblems, shots } = toBugs(
    JSON.parse(readFileSync(args[0] ?? join(outRoot, 'live-results.json'), 'utf8')),
    { env, date },
  );
  mkdirSync(out, { recursive: true });
  for (const s of shots) {
    if (s.body) writeFileSync(join(outRoot, s.to), Buffer.from(s.body, 'base64'));
    else if (existsSync(s.from)) copyFileSync(s.from, join(outRoot, s.to));
  }
  writeFileSync(join(out, 'bugs.json'), JSON.stringify(bugs, null, 2));
  if (envProblems.length)
    writeFileSync(join(out, 'env-problems.json'), JSON.stringify(envProblems, null, 2));
  console.log(`report: ${bugs.length} bugs, ${envProblems.length} environment problems in ${out}`);
  if (envProblems.length) process.exit(3);
}
