# Visual regression

One scenario is one page at one viewport, compared pixel by pixel with a committed baseline in `__baselines__/`.

- Pages: every static `page.tsx` in the staff app (pages with `[id]` or `[token]` need data and are left out; the operator, embedded and setup groups are not covered here).
- Priority (`visual.config.json`): P0 (a customer cannot use the product without it, or it guards their data) at desktop, tablet and mobile; P1 (every other signed-in page) at desktop and mobile; P2 (marketing and operator one-offs) at desktop.
- Browser: Chromium, the build Playwright pins for this repo. Baselines belong to Linux Chromium: a different operating system draws text differently. Record and update them on Linux (or the CI runner), not on a laptop.

## Why it is not flaky

`harness.ts` removes every source of change between two runs of the same page: the browser clock (`setFixedTime`), language (en-US), time zone (UTC), `prefers-reduced-motion`, animation and caret, `Math.random`, the cookie banner (consent is pre-set), loading spinners (it waits until none is left), and any text that is a date, a clock time or "5 minutes ago" (rewritten to one fixed string). A threshold is a last resort (`maxDiffPixelRatio` 0.2%), not the way flakiness is hidden. `tools/visual/check.mjs` fails a run when any P0 or P1 scenario does not give the same answer on every repeat.

## Commands

```bash
bash script-testing/visual-regression/run.sh --quick     # coverage of the baselines, seconds, no browser (pull requests)
bash script-testing/visual-regression/run.sh             # the full run on a scratch stack (daily, pre-release)
```

Against a stack you already run (web :3001, API :3000, seeded workspace):

```bash
cd apps/web
HEADLESS=1 pnpm exec playwright test --project=visual                      # compare
HEADLESS=1 pnpm exec playwright test --project=visual --update-snapshots   # record or accept a change
VISUAL_PRIORITY=P0 VISUAL_FILTER=inbox ...                                 # a subset
```

## When a comparison fails

Open the diff in `e2e/.results/<test>/` (expected, actual, diff). If the change is intended, record the new baseline (`--update-snapshots` for that scenario) and commit the PNG with the change that caused it, so a reviewer sees both. If it is not, it is a defect.

## When you add a page

The scenario exists the moment the page does. Record its baselines in the same pull request (`VISUAL_FILTER=/your-page ... --update-snapshots`), or `tools/visual/check.mjs` fails the pull request. Put the page in `p0` or `p2` of `visual.config.json` if it is not a normal P1 page. A page that cannot be rendered yet goes in `known` with the reason; it counts against coverage.
