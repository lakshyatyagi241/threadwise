// Keeps the journeys current: looks at what changed in the product since the last run, has Claude add or update journeys for it,
// proves them on a fresh local stack, opens a tests-only PR and merges it (tests cannot change production behaviour).
//   node qa-daily/maintain.mjs [--max-files 60]
import { mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { goldfishReview } from './review.mjs';
import {
  REPO,
  WORKTREES,
  ensureEnv,
  DATE,
  PREFIX,
  appRelative,
  git,
  sh,
  tryRun,
  log,
  readJson,
} from './lib.mjs';

const STATE = join(process.env.QA_STATE_DIR ?? `${process.env.HOME}/.local/state/wadesk-qa`);
const LAST = join(STATE, 'last-maintained-sha');
mkdirSync(STATE, { recursive: true });

git(REPO, 'fetch', '-q', 'origin', 'main');
const head = git(REPO, 'rev-parse', 'origin/main');
const last = existsSync(LAST)
  ? readFileSync(LAST, 'utf8').trim()
  : git(REPO, 'rev-parse', 'origin/main~30');
if (last === head) {
  log('maintain: nothing new on main');
  process.exit(0);
}

const paths = ['apps/web/src', 'apps/api/src', 'packages/contracts/src'];
const changed = git(REPO, 'diff', '--name-only', `${last}..${head}`, '--', ...paths)
  .split('\n')
  .filter(Boolean);
const subjects = git(
  REPO,
  'log',
  '--no-merges',
  '--format=- %s',
  `${last}..${head}`,
  '--',
  ...paths,
);
if (!changed.length) {
  writeFileSync(LAST, head);
  log('maintain: no product change since last run');
  process.exit(0);
}

const branch = `qa-specs/${DATE}`;
const wt = join(WORKTREES, `qa-specs-${DATE}`);
try {
  tryRun('git', ['worktree', 'remove', '--force', wt], { cwd: REPO });
  git(REPO, 'worktree', 'add', '-q', '-B', branch, wt, head);
  const app = join(wt, PREFIX);
  const web = join(app, 'apps/web');
  ensureEnv(app);
  sh('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], { cwd: app, stdio: 'ignore' });

  const prompt = `You are the SPEC-MAINTAINER agent of the daily QA pipeline for the Threadwise web app. Read CLAUDE.md, apps/web/qa-daily/live/qa.ts and the journeys in apps/web/qa-daily/live/journeys first.
The product changed since the last run. Commits:
${subjects.slice(0, 3000)}

Changed files (${changed.length}):
${changed.slice(0, 80).join('\n')}

Your job, editing ONLY files under apps/web/qa-daily/live/ :
1. For every user-visible feature those commits added or changed, add or update a journey (click, type, submit, see it persisted after reload) in the matching spec file, following the style of the existing ones: titles "[area] flow", data named with qaName(), cleanup registered, destructive() for anything that must not run on production.
2. Where a changed feature broke an existing journey on purpose (renamed button, moved page), update that journey to the new behaviour. Never weaken an assertion just to make it pass.
3. Build and start a local stack (bash qa-daily/stack.sh up after building packages, api and web as in qa-daily/fix.mjs) and run the journeys you touched with: node qa-daily/recheck.mjs is not for you; use  source qa-daily/out/stack.env && HEADLESS=1 pnpm exec playwright test -c qa-daily/playwright.live.config.ts <file>. Keep only journeys that pass.
4. If a new journey reveals what looks like a REAL product bug, do not commit that journey; describe it (steps, expected, actual) in qa-daily/out/maintain-findings.md instead.
Do not commit or push. Finish with a 5-line summary.`;
  const agent = tryRun(
    'claude',
    [
      '-p',
      prompt,
      '--permission-mode',
      'acceptEdits',
      '--max-turns',
      '80',
      '--allowedTools',
      'Read Edit Write Grep Glob Bash(pnpm:*) Bash(bash qa-daily/stack.sh:*) Bash(source:*) Bash(git diff:*) Bash(git status:*) Bash(git log:*)',
    ],
    {
      cwd: app,
      timeout: 60 * 60_000,
      env: { ...process.env, ANTHROPIC_API_KEY: undefined },
    },
  );
  tryRun('bash', ['qa-daily/stack.sh', 'down'], { cwd: web });
  const files = git(wt, 'status', '--porcelain')
    .split('\n')
    .filter(Boolean)
    .map((l) => appRelative(l.slice(3)));
  if (!files.length) {
    writeFileSync(LAST, head);
    log('maintain: no journey change needed');
    process.exit(0);
  }
  const outside = files.filter((f) => !f.startsWith('apps/web/qa-daily/live/'));
  if (outside.length)
    throw new Error(
      `spec-maintainer touched files outside qa-daily/live: ${outside.slice(0, 3).join(', ')}`,
    );

  // independent proof: the whole journey suite passes on a fresh build of this exact tree
  const run = tryRun(
    'bash',
    [
      '-c',
      "export NODE_OPTIONS=--max-old-space-size=6144; (cd ../.. && pnpm --filter './packages/*' build) && pnpm --filter @crm/api build && pnpm --filter @crm/web build && bash qa-daily/stack.sh up && . qa-daily/out/stack.env && HEADLESS=1 pnpm exec playwright test -c qa-daily/playwright.live.config.ts",
    ],
    { cwd: web, timeout: 90 * 60_000 },
  );
  tryRun('bash', ['qa-daily/stack.sh', 'down'], { cwd: web });
  if (!run.ok)
    throw new Error(`journey suite does not pass with the new specs:\n${run.out.slice(-600)}`);
  const gate = tryRun('bash', ['.claude/skills/pre-pr/scripts/gate.sh'], {
    cwd: app,
    timeout: 60 * 60_000,
  });
  if (!gate.ok) throw new Error(`pre-pr gate failed:\n${gate.out.slice(-400)}`);

  // Goldfish: fresh reviewers judge the new journeys cold (prod safety, flakiness, scope) before anything merges
  const review = await goldfishReview({
    cwd: wt,
    kind: 'tests',
    task: `New and updated daily QA journeys for these product commits:\n${subjects.slice(0, 1500)}`,
  });
  if (!review.approved)
    throw new Error(
      `Goldfish review blocked the new journeys:\n${review.blockers
        .map((x) => `- ${x.file}: ${x.issue}`)
        .join('\n')
        .slice(0, 500)}`,
    );
  git(wt, 'add', '-A');
  git(
    wt,
    'commit',
    '-q',
    '-m',
    `test(qa): update daily journeys for ${changed.length} changed files\n\nCo-Authored-By: Claude <noreply@anthropic.com>`,
  );
  git(wt, 'push', '-q', '-u', 'origin', branch);
  const pr = sh(
    'gh',
    [
      'pr',
      'create',
      '--base',
      'main',
      '--head',
      branch,
      '--title',
      `test(qa): update daily journeys (${DATE})`,
      '--body',
      `Tests only (everything under apps/web/qa-daily/live/). The full journey suite passes on a fresh local build, independent Goldfish reviewers (egm) approved it, and the pre-pr gate passed.\n\nProduct commits covered:\n${subjects.slice(0, 1500)}\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)`,
    ],
    { cwd: wt },
  );
  if (process.env.MAINTAIN_MERGE === '1')
    sh('gh', ['pr', 'merge', pr, '--merge', '--delete-branch'], { cwd: wt });
  writeFileSync(LAST, head);
  log(`maintain: ${pr} ${process.env.MAINTAIN_MERGE === '1' ? 'merged' : 'open'}`);
} catch (e) {
  log('maintain failed:', e.message); // yesterday's journeys keep running; try again tomorrow
  process.exitCode = 1;
} finally {
  tryRun('git', ['worktree', 'remove', '--force', wt], { cwd: REPO });
}
