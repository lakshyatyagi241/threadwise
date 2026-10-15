import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Route matrix: every static page of the web app, at three viewport sizes, with the same six checks. The scenarios are generated from
 * `src/app/**\/page.tsx`, so a new page is covered the day it is added (and the count in QA task #10 grows with it).
 *
 *   HEADLESS=1 pnpm --filter @crm/web exec playwright test e2e/_matrix
 *   QA_MATRIX_LIMIT=20 ...                  only the first 20 routes (smoke)
 *   QA_MATRIX_FILTER=contacts ...           only routes containing that text
 *   QA_MATRIX_SCOPE=public ...              only the pages that need no sign-in (they need the web app only, not the API or a seeded
 *                                           workspace); `authed` for the rest; default `all`
 *
 * Needs the running stack (API :3000, web :3001) and the seeded workspace the other specs use (E2E_ORG / E2E_ADMIN_EMAIL / E2E_PASSWORD).
 * Dynamic pages (`[token]`, `[id]`) need real data and are not generated here; the QA report lists how many are left out.
 */
const cfg = JSON.parse(
  readFileSync(join(process.cwd(), 'e2e/_matrix/matrix.config.json'), 'utf8'),
) as {
  viewports: Array<{ name: string; width: number; height: number }>;
  skipGroups: string[];
  authedGroups: string[];
};
const BASE = process.env.WEB_URL ?? 'http://localhost:3001';
const ORG = process.env.E2E_ORG ?? 'Admin';
const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'nachiket.challawar@geta.ai',
  password: process.env.E2E_PASSWORD ?? 'Passw0rd!',
};

type Route = { url: string; authed: boolean };

function discover(): Route[] {
  const root = join(process.cwd(), 'src/app');
  const out: Route[] = [];
  const walk = (dir: string, segs: string[]) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name), [...segs, e.name]);
      else if (e.name === 'page.tsx') {
        if (segs.some((s) => cfg.skipGroups.includes(s) || s.includes('[') || s === 'api'))
          continue;
        const url = '/' + segs.filter((s) => !/^\(.*\)$/.test(s)).join('/');
        out.push({ url, authed: segs.some((s) => cfg.authedGroups.includes(s)) });
      }
    }
  };
  walk(root, []);
  const filter = process.env.QA_MATRIX_FILTER;
  const scope = process.env.QA_MATRIX_SCOPE ?? 'all';
  const limit = Number(process.env.QA_MATRIX_LIMIT ?? 0);
  const all = out
    .sort((a, b) => a.url.localeCompare(b.url))
    .filter((r) => !filter || r.url.includes(filter))
    .filter((r) => scope === 'all' || (scope === 'public') === !r.authed);
  return limit ? all.slice(0, limit) : all;
}

let signedIn: { at: number; state: Awaited<ReturnType<BrowserContext['storageState']>> } | null =
  null;
async function authState(browser: Browser) {
  // one sign-in for the whole run, renewed every 10 minutes (the API caps concurrent sessions per account)
  if (signedIn && Date.now() - signedIn.at < 10 * 60_000) return signedIn.state;
  const ctx = await browser.newContext({ baseURL: BASE });
  const res = await ctx.request.post('/api/auth/login', {
    data: { orgSlug: ORG, email: ADMIN.email, password: ADMIN.password },
  });
  expect(res.ok(), 'sign in as the seeded admin').toBe(true);
  const state = await ctx.storageState();
  await ctx.close();
  signedIn = { at: Date.now(), state };
  return state;
}

const NOISE =
  /favicon|Failed to load resource.*\b(401|403|404)\b|ResizeObserver loop|net::ERR_ABORTED/i;

for (const route of discover()) {
  for (const vp of cfg.viewports) {
    test.describe
      .serial(`${route.authed ? 'signed in' : 'public'} ${route.url} @ ${vp.name}`, () => {
      let ctx: BrowserContext;
      let page: Page;
      const errors: string[] = [];
      const serverErrors: string[] = [];

      test.beforeAll(async ({ browser }) => {
        ctx = await browser.newContext({
          baseURL: BASE,
          viewport: { width: vp.width, height: vp.height },
          storageState: route.authed ? await authState(browser) : undefined,
        });
        page = await ctx.newPage();
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (m) => {
          if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text());
        });
        page.on('response', (r) => {
          if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`);
        });
        await page.goto(route.url, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load').catch(() => undefined);
      });
      test.afterAll(async () => ctx?.close());

      test('renders without a server error or script error', () => {
        expect(serverErrors, 'responses with status >= 500').toEqual([]);
        expect(errors, 'console and page errors').toEqual([]);
      });

      test('has no horizontal overflow', async () => {
        const over = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(over, 'px wider than the viewport').toBeLessThanOrEqual(1);
      });

      test('has a title and a heading or main landmark', async () => {
        await expect(page).toHaveTitle(/.+/);
        const n = await page.locator('h1, h2, main, [role="main"]').count();
        expect(n, 'headings or main landmarks').toBeGreaterThan(0);
      });

      test('every button, link and field has an accessible name', async () => {
        const unnamed = await page.evaluate(() => {
          const bad: string[] = [];
          for (const el of Array.from(
            document.querySelectorAll<HTMLElement>(
              'button, a[href], input:not([type=hidden]), select, textarea, [role=button]',
            ),
          )) {
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            const name =
              el.getAttribute('aria-label') ||
              el.getAttribute('aria-labelledby') ||
              el.getAttribute('title') ||
              (el.textContent ?? '').trim() ||
              (el as HTMLInputElement).placeholder ||
              el.querySelector('img[alt]:not([alt=""])')?.getAttribute('alt') ||
              ((el as HTMLInputElement).id &&
                document
                  .querySelector(`label[for="${(el as HTMLInputElement).id}"]`)
                  ?.textContent?.trim()) ||
              el.closest('label')?.textContent?.trim();
            if (!name) bad.push(el.outerHTML.slice(0, 120));
          }
          return bad.slice(0, 5);
        });
        expect(unnamed, 'controls with no accessible name').toEqual([]);
      });
    });
  }

  test.describe(`per route ${route.url}`, () => {
    test('a signed-out visitor never gets a 5xx or a blank page', async ({ browser }) => {
      const ctx = await browser.newContext({ baseURL: BASE });
      const page = await ctx.newPage();
      const res = await page.goto(route.url, { waitUntil: 'domcontentloaded' });
      expect(res?.status() ?? 0, 'HTTP status').toBeLessThan(500);
      expect(
        (await page.locator('body').innerText()).trim().length,
        'visible text',
      ).toBeGreaterThan(0);
      await ctx.close();
    });

    test('the keyboard can reach a focusable control', async ({ browser }) => {
      const ctx = await browser.newContext({
        baseURL: BASE,
        storageState: route.authed ? await authState(browser) : undefined,
      });
      const page = await ctx.newPage();
      await page.goto(route.url, { waitUntil: 'domcontentloaded' });
      await page.keyboard.press('Tab');
      const tag = await page.evaluate(() => document.activeElement?.tagName ?? 'NONE');
      expect(tag, 'element focused after Tab').not.toBe('BODY');
      await ctx.close();
    });
  });
}
