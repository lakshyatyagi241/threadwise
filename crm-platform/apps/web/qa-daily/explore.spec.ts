import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { discoverRoutes } from './routes.mjs';

/**
 * Visits every non-dynamic page (same list as features/wadesk.feature), looks for bugs and records each one with a screenshot in
 * out/<date>/bugs.json. It never fails on a bug: the run must reach every page. sheet.mjs sends the file to Google Sheets.
 *
 *   QA_FILTER=contacts   only URLs containing that text      QA_LIMIT=20   only the first 20 pages
 */
const BASE = process.env.WEB_URL ?? 'http://localhost:3001';
const ADMIN = {
  orgSlug: process.env.E2E_ORG ?? 'Admin',
  email: process.env.E2E_ADMIN_EMAIL ?? 'nachiket.challawar@geta.ai',
  password: process.env.E2E_PASSWORD ?? 'Passw0rd!',
};
const OPERATOR = {
  email: process.env.E2E_OPERATOR_EMAIL ?? 'operator@example.test',
  password: process.env.E2E_OPERATOR_PASSWORD ?? 'Passw0rd!',
};
const DATE = new Date().toISOString().slice(0, 10);
const OUT = join(process.cwd(), 'qa-daily/out', DATE);

type Severity = 'Critical' | 'High' | 'Medium' | 'Low';
type Bug = {
  id: string;
  date: string;
  route: string;
  kind: string;
  severity: Severity;
  title: string;
  description: string;
  suggestedFix: string;
  viewport: string;
  screenshot: string;
};

/** What to do about each kind of bug: the "solution" column of the sheet and the brief for the autofix step. */
const FIX: Record<string, string> = {
  'http-5xx':
    'Reproduce the URL, read the API/server log and the Sentry event for it, fix the unhandled exception in the handler or page, and return a 4xx for bad input instead of a 500.',
  'page-error':
    'Find the throwing component from the message/stack, guard against undefined or null data, and wrap the section in an error boundary so one widget cannot take the page down.',
  'console-error':
    'Open the console on this page, find the component that logs the error (failed fetch, React key/hydration warning, bad prop) and fix its cause rather than silencing the log.',
  'request-failed':
    'The request never completed. Check the URL is correct, the API route exists, CORS/auth is right, and the UI shows a retry state when it fails.',
  'error-screen':
    'The page shows an error or not-found screen. Check the route loads its data, the permission/plan gate is right for this role, and the loader handles empty results.',
  blank:
    'The page renders no visible text. Check the server component returns content, and that loading and empty states render something.',
  'login-redirect':
    'A signed-in user was sent to /login. Check the middleware/session check for this route and that the page is not calling an API that returns 401 for valid sessions.',
  overflow:
    'Content is wider than the viewport. Find the widest element (named in the description) and give it min-w-0 / max-w-full / overflow-x-auto, or let the table scroll inside its own container.',
  'broken-image': 'An image fails to load. Fix its src (wrong path or missing asset) or give it a fallback.',
  'no-title': 'The page has no <title>. Add metadata (generateMetadata or a translated title) for this route.',
};

const NOISE = /favicon|ResizeObserver loop|net::ERR_ABORTED|Download the React DevTools/i;
const ERROR_SCREEN =
  /something went wrong|application error|unhandled runtime error|internal server error|this page could not be found/i;

/** Ids, uuids and numbers differ per run; strip them so the same bug keeps the same fingerprint day to day. */
const stable = (s: string) =>
  s.replace(/[0-9a-f]{8}-[0-9a-f-]{27}|\b[0-9a-f]{12,}\b|\d+/gi, '#').slice(0, 160);
const fingerprint = (route: string, kind: string, key: string) =>
  createHash('sha1').update(`${route}|${kind}|${stable(key)}`).digest('hex').slice(0, 10);

const bugs: Bug[] = [];
const states: Partial<Record<'app' | 'admin', Awaited<ReturnType<BrowserContext['storageState']>>>> = {};

async function signIn(browser: Browser, kind: 'app' | 'admin') {
  const ctx = await browser.newContext({ baseURL: BASE });
  const [path, data] = kind === 'app' ? ['/api/auth/login', ADMIN] : ['/api/platform-auth/login', OPERATOR];
  const res = await ctx.request.post(path, { data });
  expect(res.ok(), `sign in as ${kind} (${res.status()}). Is the stack up and seeded?`).toBe(true);
  states[kind] = await ctx.storageState();
  await ctx.close();
}

const routes = discoverRoutes()
  .filter((r) => !r.dynamic)
  .filter((r) => !process.env.QA_KIND || r.kind === process.env.QA_KIND) // public | app | admin
  .filter((r) => !process.env.QA_FILTER || r.url.includes(process.env.QA_FILTER))
  .slice(0, Number(process.env.QA_LIMIT) || undefined);

test.beforeAll(async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  if (routes.some((r) => r.kind === 'app')) await signIn(browser, 'app');
  if (routes.some((r) => r.kind === 'admin')) await signIn(browser, 'admin');
});

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true }); // beforeAll may have died before creating it
  writeFileSync(join(OUT, 'bugs.json'), JSON.stringify(bugs, null, 2));
  const by = (s: Severity) => bugs.filter((b) => b.severity === s).length;
  console.log(
    `\n${bugs.length} bugs (${by('Critical')} critical, ${by('High')} high, ${by('Medium')} medium, ${by('Low')} low) in ${OUT}/bugs.json`,
  );
});

for (const r of routes) {
  test(`${r.kind} ${r.url}`, async ({ browser }) => {
    const ctx = await browser.newContext({
      baseURL: BASE,
      viewport: { width: 1280, height: 800 },
      storageState: r.kind === 'public' ? undefined : states[r.kind],
    });
    const page = await ctx.newPage();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const serverErrors: string[] = [];
    const failed: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !NOISE.test(m.text())) consoleErrors.push(m.text());
    });
    page.on('response', (x) => {
      if (x.status() >= 500) serverErrors.push(`${x.request().method()} ${x.url()} -> ${x.status()}`);
    });
    page.on('requestfailed', (q) => {
      const why = q.failure()?.errorText ?? '';
      if (!NOISE.test(why)) failed.push(`${q.method()} ${q.url()} (${why})`);
    });

    const slug = r.url.replace(/\W+/g, '_') || 'home';
    const report = async (
      kind: string,
      severity: Severity,
      title: string,
      description: string,
      key: string,
      viewport = 'desktop 1280x800',
    ) => {
      const id = fingerprint(r.url, kind, key);
      const shot = `${slug}.${id}.jpg`;
      await page.screenshot({ path: join(OUT, shot), type: 'jpeg', quality: 60 }).catch(() => undefined);
      bugs.push({
        id, date: DATE, route: r.url, kind, severity, title, description,
        suggestedFix: FIX[kind], viewport, screenshot: join(DATE, shot),
      });
    };

    const res = await page.goto(r.url, { waitUntil: 'domcontentloaded' }).catch((e: Error) => e);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

    if (res instanceof Error)
      await report('request-failed', 'Critical', `Page does not load: ${r.url}`, res.message.split('\n')[0], res.message);
    else if ((res?.status() ?? 0) >= 500)
      await report('http-5xx', 'Critical', `${r.url} returns HTTP ${res!.status()}`, `GET ${r.url} answered ${res!.status()}.`, `page ${res!.status()}`);
    for (const e of [...new Set(serverErrors)].slice(0, 3))
      await report('http-5xx', 'High', `Server error on ${r.url}`, e, e);
    for (const e of [...new Set(pageErrors)].slice(0, 3))
      await report('page-error', 'High', `Uncaught script error on ${r.url}`, e, e);
    for (const e of [...new Set(consoleErrors)].slice(0, 3))
      await report('console-error', 'Medium', `Console error on ${r.url}`, e.slice(0, 500), e);
    for (const e of [...new Set(failed)].slice(0, 3))
      await report('request-failed', 'Medium', `Network request failed on ${r.url}`, e, e);

    const text = (await page.locator('body').innerText().catch(() => '')).trim();
    if (!text) await report('blank', 'High', `Blank page: ${r.url}`, 'The page has no visible text.', 'blank');
    else if (ERROR_SCREEN.test(text.slice(0, 2000)))
      await report('error-screen', 'High', `Error screen on ${r.url}`, text.slice(0, 300), text.slice(0, 60));
    if (r.kind !== 'public' && /^\/login\b/.test(new URL(page.url()).pathname))
      await report('login-redirect', 'High', `Signed-in user sent to login from ${r.url}`, `Ended on ${page.url()}.`, 'login');
    if (!(await page.title()))
      await report('no-title', 'Low', `No page title on ${r.url}`, 'document.title is empty.', 'title');

    const broken = await page.evaluate(() =>
      Array.from(document.images)
        .filter((i) => i.complete && i.naturalWidth === 0 && i.offsetParent !== null)
        .map((i) => i.src)
        .slice(0, 3),
    );
    for (const src of broken) await report('broken-image', 'Low', `Broken image on ${r.url}`, src, src);

    // Overflow at desktop, then phone width on the same loaded page.
    for (const [w, h, name] of [[1280, 800, 'desktop'], [390, 844, 'mobile']] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(250);
      const wide = await page.evaluate((width) => {
        if (document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1) return null;
        const el = Array.from(document.body.querySelectorAll<HTMLElement>('*')).find(
          (e) => e.getBoundingClientRect().right > width + 1 && getComputedStyle(e).position !== 'fixed',
        );
        return el ? `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}` : 'unknown element';
      }, w);
      if (wide)
        await report('overflow', name === 'mobile' ? 'Medium' : 'Low', `Horizontal overflow on ${r.url} at ${w}px`, `Page is wider than ${w}px. Widest element: ${wide}.`, `${w} ${wide}`, `${name} ${w}x${h}`);
    }
    await ctx.close();
  });
}
