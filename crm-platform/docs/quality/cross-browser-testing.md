# Cross-browser testing (QA task 19)

Target: the P0 and P1 flows work in Chromium, Firefox and WebKit (Safari's engine), and the P0 flows also on a phone-sized Safari.

## What was added

| Piece                                                        | Where                                                                                        |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Firefox, WebKit and mobile-Safari projects                   | `apps/web/playwright.config.ts`, switched on by `CROSS_BROWSER=1`                            |
| Priority of every e2e folder (P0, P1, P2)                    | `apps/web/e2e/priority.json`                                                                 |
| Ratchet: no folder without a priority                        | `node tools/quality/check-browser-priority.mjs` (tests in `check-browser-priority.test.mjs`) |
| Pick tests by priority                                       | `E2E_PRIORITY=P0,P1` (builds `testMatch` from the map)                                       |
| Engine-sensitive spec (sign-in, locale, RTL, theme, consent) | `apps/web/e2e/cross-browser/sign-in-and-locale.spec.ts`                                      |
| Stand-in API so public pages run without the stack           | `apps/web/e2e/_matrix/stub-api.mjs`                                                          |
| Public-only matrix                                           | `QA_MATRIX_SCOPE=public` on `e2e/_matrix/route-matrix.spec.ts`                               |
| Manual workflow                                              | `.github/workflows/browsers.yml`                                                             |

Priorities are set per folder, not per test tag: one file decides, and the checker fails when a new folder appears without one.

## Run it

```bash
pnpm --filter @crm/web exec playwright install --with-deps firefox webkit
node apps/web/e2e/_matrix/stub-api.mjs &              # :3000, public pages only
pnpm --filter @crm/web build && pnpm --filter @crm/web exec next start -p 3001 &
cd apps/web
CROSS_BROWSER=1 npx playwright test e2e/cross-browser                  # four projects
CROSS_BROWSER=1 QA_MATRIX_SCOPE=public npx playwright test e2e/_matrix --project=firefox
CROSS_BROWSER=1 E2E_PRIORITY=P0,P1 npx playwright test                 # with the real stack up
```

`CHROMIUM_PATH` points Chromium at an already installed binary when Playwright's expected revision is not present.

## Findings and triage

| Finding                                                                                                                 | Class                                                                            | Action                                                                    |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `/` and `/features`: four decorative `<button>` elements in the marketing mock-ups had no accessible name (all engines) | Real defect                                                                      | Replaced by `aria-hidden` `div`s with the same classes. No visual change. |
| Firefox `500 /api/v2/i18n/languages` on public pages                                                                    | Environment: the web proxy had no API behind it                                  | Stand-in API added                                                        |
| Theme choice lost when a page was left straight after the toggle (Firefox, mobile Safari)                               | Test assumption: the cookie is written by a server action after the colour flips | Tests wait for the `crm_theme` cookie                                     |
| Expectation that the OS dark preference sets dark                                                                       | Test assumption: the site is light by default, cookie driven                     | Tests changed to match the product                                        |
| Keyboard Tab order on WebKit                                                                                            | Engine behaviour: Safari skips buttons unless the OS setting is on               | Skipped on WebKit, documented in the spec                                 |

## Results

Cross-browser spec: Chromium 21/21, Firefox 21/21, WebKit 20 passed + 1 skipped, mobile Safari 20 passed + 1 skipped; no unexpected or flaky test.

## Not covered (honest limits)

- The authenticated P0/P1 specs and the 189 authenticated routes need the real API, Postgres and Redis (Docker); they were not run on Firefox or WebKit. The same commands apply once the stack is up.
- After the `aria-hidden` fix the web app could not be rebuilt in the sandbox session that finished the work, so the public matrix was not re-run on the three engines to confirm the two accessible-name failures are gone. Run the matrix command above once.
- The stability repeat (`--repeat-each=3`) was started but its result was not captured.
- `browsers.yml` has not run on GitHub.
