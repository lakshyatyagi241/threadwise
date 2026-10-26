# Daily QA: explore, report to Google Sheets, auto-fix

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
