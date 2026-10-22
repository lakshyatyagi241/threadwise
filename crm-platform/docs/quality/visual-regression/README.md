# Visual regression testing

Target: an automated suite with at least 95% of the P0 and P1 scenarios covered and zero flaky P0 tests.

A scenario is one page at one viewport, compared with a committed baseline screenshot. The suite lives in `apps/web/e2e/visual/` (spec, harness, config, baselines and its own README), the gate in `tools/visual/`, the runner in `script-testing/visual-regression/`, CI in `.github/workflows/visual-regression.yml`.

## What is covered

- Every static page of the staff app (`src/app/**/page.tsx`): 477 scenarios. P0 pages (sign-in and sign-up, dashboard, inbox, contacts, account security, team and roles, billing, channels, broadcasts and campaigns) at desktop, tablet and mobile; P1 pages (every other signed-in page) at desktop and mobile; P2 pages (marketing and operator one-offs) at desktop. Priorities are set by prefix in `visual.config.json`.
- Not covered: pages with `[id]` or `[token]` (they need data), the admin, embedded, setup and site-preview groups, other browsers (task 19), interactions and open dialogs.
- Coverage is computed from the page list itself, so a new page without a baseline lowers it the day it is added. The pull request check (`run.sh --quick`, seconds, no browser) fails below 95% for P0 or P1.

## Why it is not flaky

Everything that differs between two runs of the same page is removed instead of tolerated: browser clock, language, time zone, motion, caret, `Math.random`, the cookie banner, one shared sign-in for the whole run (account pages list sessions), and any text that is a date, a clock time or a relative time. The page is measured until it stops changing: no data request in flight, every image decoded, no spinner, the same text and height on four polls in a row. A pixel tolerance of 0.2% is the last resort. Every P0 scenario runs three times in the full run and any scenario whose answer changes fails the run. A canary (a red band on the login page) must fail the comparison, so the suite cannot go blind.

## Defects the suite found in the product

`/templates/new`, `/credit-notes/new`, `/estimates/new` and `/proposals/new` throw React hydration error #418 on load (a value rendered differently on the server and in the browser; for the three document pages a default date computed during render). They are listed under `known` in `visual.config.json` with the reason and an owner, are skipped, and count against coverage until fixed.

## Updating a baseline

Baselines belong to Linux Chromium. After an intended UI change, record the scenario on Linux or the CI runner (`--update-snapshots`, see `apps/web/e2e/visual/README.md`) and commit the PNG with the change. A reviewer sees the picture change in the pull request.
