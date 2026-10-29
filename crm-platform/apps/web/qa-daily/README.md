# Daily QA: functional journeys, Google Sheet, auto-fix, auto-verify

```
03:00  run-scheduled.sh (cron, install-schedule.sh)
  1 maintain.mjs   product changed since yesterday? Claude adds/updates journeys -> tests-only PR
  2 daily.mjs --target prod
      probe site (down = environment problem, no bug rows)
      verify   rows "Fixed (merged...)" are re-run on prod; pass -> Verified + AFTER screenshot in the sheet; fail -> reopened
      journeys live/journeys/*.spec.ts (real click-through flows, QA-AUTO data, cleaned up) -> report.mjs -> bugs
      crawl    explore.spec.ts (every page: 5xx, console errors, overflow...) -> bugs
      sheet    new bugs pushed with screenshot; same bug seen again reopens it
      fix      --fix: per open bug (max 3/day, most severe first), fix.mjs:
                 worktree of origin/main -> build -> reproduce locally -> Claude fixes -> rebuild -> the SAME check must pass
                 -> pre-pr gate -> PR -> merge only if AUTOMERGE=1 and the guards hold -> status "Fixed (merged, awaiting verification)"
      Runs tab one line for the day
```

Sheet statuses: Open, In progress, Fix PR open, Fixed (merged, awaiting verification), Verified, Needs human.

## Elephant and Goldfish (egm plugin)

Every piece of work Claude does here has an **elephant** (the agent with full context that does it: the fixer, the spec-maintainer) and
**goldfish** reviewers (`review.mjs`: fresh Claude sessions with the egm lens prompts, no conversation, only the task and `git diff`).
A fix needs the failing check to pass on a fresh build AND the goldfish to approve; a blocking finding goes back to the elephant once, then a
person decides. New journeys get the same review (production safety, flakiness, scope) before their PR merges. Needs the plugin:
`claude plugin marketplace add google/elephant-goldfish-model && claude plugin install egm@egm` (the lens files are read from it).

## Guards on automatic merge (fix.mjs)

Off by default (`AUTOMERGE=0`). When on, a fix merges only if: the failing check fails on origin/main and passes on a fresh build of the fix,
the goldfish approved, the repo's `pre-pr` gate passed, the diff is at most 8 files / 300 lines, and no file is in a protected path (auth, tenancy, packages/db,
migrations, deploy, .github, .claude, the automation itself). Otherwise the PR stays open and the row says why. A merge to main deploys to
production, so a merged fix is re-checked on production the next day and reopened if it still fails (2 failed attempts -> Needs human).

## Safety on production

Journeys use a dedicated QA workspace account; everything they create is named `QA-AUTO ...` and removed by the test; anything that sends,
charges, publishes or deletes is tagged `destructive()` and skipped on prod. A failed test is retried once so a network blip is not filed.

## Setup once

1. Sheet: create it, paste `apps-script.gs` (Extensions > Apps Script), set script properties TOKEN and FOLDER_ID, deploy as web app
   (Execute as Me, access Anyone). Existing sheets are upgraded in place (new columns are appended).
2. On the machine that will run it (Claude Code logged in, `gh auth login`, Docker for the local Postgres/Redis, a built checkout):
   `qa-daily/install-schedule.sh` writes `~/.config/wadesk-qa/env` (fill in the sheet URL/token and the QA accounts), run it again to install cron.
3. Try it by hand: `node qa-daily/daily.mjs --target prod --no-crawl` (no fixing), then add `--fix`.
   Local rehearsal: `qa-daily/stack.sh up` (own database `crm_qa`), `source qa-daily/out/stack.env`, `node qa-daily/daily.mjs --target local --no-crawl`.
   GitHub Actions does not run here (billing), so the schedule is cron on a machine; `.github/workflows/qa-daily.yml` stays for the crawl only.

---

## The page crawler (original kit)

```
src/app/**/page.tsx ──> gen-feature.mjs ──> features/wadesk.feature   (what is covered, 323 pages + 92 dynamic listed)
                    └─> explore.spec.ts  ──> out/<date>/bugs.json + screenshots
                                         └─> sheet.mjs push ──> Google Sheet "Bugs" (screenshot, bug, description, suggested fix)
Google Sheet (Status=Open) ──> autofix.mjs ──> claude -p fixes it ──> commit on qa-autofix/<date> ──> Status=Done
```

Checks per page: 5xx, blank page, error screen, uncaught/console errors, failed requests, redirect to login, broken images,
missing title, horizontal overflow at 1280px and 390px. A bug found again after being marked Done is reopened. Dynamic pages
(`[id]`, `[token]`) need seeded data and are listed in the feature file but not visited.

## One-time setup (the sheet)

1. Create a Google Sheet. Extensions > Apps Script. Paste `apps-script.gs`.
2. Project Settings > Script properties: `TOKEN` = long random string, `FOLDER_ID` = a Drive folder for screenshots.
3. Deploy > New deployment > Web app > Execute as **Me**, access **Anyone**. Copy the `/exec` URL.
4. Share the URL and token with the team privately (not in git).

## Every teammate, once

```bash
export QA_SHEET_URL='https://script.google.com/macros/s/.../exec'
export QA_SHEET_TOKEN='...'
```

Put those in `~/.zshrc`. The stack (API :3000, web :3001, seeded) must be running, as for `e2e/`.

## Run

```bash
cd apps/web
QA_LIMIT=10 HEADLESS=1 pnpm exec playwright test -c qa-daily/playwright.config.ts   # smoke, 10 pages
qa-daily/run-daily.sh                    # explore everything + push to the sheet
AUTOFIX=1 qa-daily/run-daily.sh          # also fix up to AUTOFIX_MAX=5 open bugs, on branch qa-autofix/<date>
```

`AUTOFIX_PUSH=1` pushes the fix branch. Nothing is merged for you: open a PR from `qa-autofix/<date>` and review it.
Teammates can run it at the same time: each fix is claimed in the sheet first.

## Every day, for the whole team: GitHub Actions (`.github/workflows/qa-daily.yml`)

Runs at 03:00 IST on a fresh seeded stack (Postgres + Redis service containers), explores every page and fills the sheet. No Claude,
no API key. One person adds two repo secrets (Settings > Secrets and variables > Actions): `QA_SHEET_URL`, `QA_SHEET_TOKEN`.
Run it by hand from the Actions tab (qa-daily > Run workflow; `limit` = 10 for a smoke run). The screenshots and logs are in the run's
`qa-daily` artifact. A manual run only works once the workflow file is on the default branch.

## Fixing the open rows: on a developer's machine, with a Claude Max login (no API key)

Claude Code logged in with the Max plan; `ANTHROPIC_API_KEY` is ignored by the script on purpose. One person is enough: rows are claimed.

```bash
cd apps/web && AUTOFIX_MAX=3 node qa-daily/autofix.mjs
```

Review the `qa-autofix/<date>` branch it makes and open a PR.

## Alternative: cron on your own machine

`crontab -e` (the machine must be awake and the stack up):

```
0 9 * * 1-5  cd /path/to/crm-platform/apps/web && AUTOFIX=1 qa-daily/run-daily.sh >> /tmp/wadesk-qa.log 2>&1
```
