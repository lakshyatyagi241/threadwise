import { expect, test } from '@playwright/test';
import { loadConfig, buildScenarios } from './scenarios.mjs';
import { newContext, open, shotHeight } from './harness';

/**
 * Visual regression (QA task 21): every P0, P1 and P2 page at the viewports its priority asks for, compared with a committed baseline.
 * The scenarios come from the pages the app has, so a new page without a baseline fails `tools/visual/coverage.mjs`.
 *
 *   HEADLESS=1 pnpm --filter @crm/web exec playwright test --project=visual                  compare with the baselines
 *   HEADLESS=1 pnpm --filter @crm/web exec playwright test --project=visual --update-snapshots   record them (see the README)
 *   VISUAL_PRIORITY=P0 ...   only that priority; VISUAL_FILTER=inbox ... only urls containing that text
 *
 * Needs the stack the other specs use (web :3001 and the API with the seeded workspace). The baselines are tied to the Chromium build
 * Playwright pins for this repo (see e2e/visual/README.md); a different browser build is a different baseline.
 */
const cfg = loadConfig();
const only = (process.env.VISUAL_PRIORITY ?? '')
  .split(',')
  .filter(Boolean)
  .map((p) => p.toUpperCase());
const filter = process.env.VISUAL_FILTER;
// The canary: the runner sets VISUAL_CANARY=1 to change a page on purpose (a red band across the top); the comparison MUST fail, or the suite is blind.
const canary = process.env.VISUAL_CANARY === '1';

for (const s of buildScenarios()) {
  if (only.length && !only.includes(s.priority)) continue;
  if (filter && !s.url.includes(filter)) continue;
  const known = cfg.known[s.url];
  test(`${s.priority} ${s.url} @ ${s.viewport}`, async ({ browser }, info) => {
    info.annotations.push({ type: 'priority', description: s.priority });
    test.skip(!!known, known);
    const ctx = await newContext(browser, s);
    try {
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await open(page, s.url);
      if (canary)
        await page.evaluate(() => {
          const d = document.createElement('div');
          d.style.cssText = 'height:120px;background:#c00';
          document.body.prepend(d);
        });
      // a baseline of an error screen would bless the defect
      expect(errors, 'script errors while rendering').toEqual([]);
      // a baseline of the sign-in page or of a blank page would bless a lost session or a failed render
      if (s.authed) {
        const here = new URL(page.url()).pathname;
        expect(here, 'a signed-in page must not end on the sign-in page').not.toMatch(
          /^\/(login|admin\/login)/,
        );
      }
      const text = await page.evaluate(() => document.body.innerText.trim().length);
      expect(text, 'characters of visible text on the page').toBeGreaterThan(15);
      const height = await shotHeight(page, s.height);
      await expect(page).toHaveScreenshot(`${s.id}.png`, {
        fullPage: true,
        clip: { x: 0, y: 0, width: s.width, height },
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixelRatio: cfg.diff.maxDiffPixelRatio,
        threshold: cfg.diff.threshold,
      });
    } finally {
      await ctx.close();
    }
  });
}
