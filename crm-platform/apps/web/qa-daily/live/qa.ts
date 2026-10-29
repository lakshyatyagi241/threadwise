import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Harness for the daily functional journeys. Every journey imports `test` and `expect` from here, never from @playwright/test.
 *
 *   QA_TARGET=local|prod    local = the seeded dev stack (default); prod = https://desk.wabo.ai (staging is the same host today)
 *   QA_BASE_URL             override the host
 *   QA_ORG / QA_EMAIL / QA_PASSWORD           workspace admin (the dedicated QA account on prod, never a customer's)
 *   QA_OP_EMAIL / QA_OP_PASSWORD              platform operator (the /admin console)
 *
 * Live safety: on prod a journey may only create records whose name starts with QA_PREFIX and must register their removal with
 * `cleanup(...)`; anything that sends to a real customer, spends money or deletes data it did not create is tagged `@destructive`
 * and is skipped on prod.
 */
export const TARGET = (process.env.QA_TARGET ?? 'local') as 'local' | 'prod';
export const BASE_URL =
  process.env.QA_BASE_URL ??
  (TARGET === 'prod' ? 'https://desk.wabo.ai' : (process.env.WEB_URL ?? 'http://localhost:3001'));
export const QA_PREFIX = 'QA-AUTO';
/** A name unique to this run and journey: `QA-AUTO 0412 contacts`. Safe to search for and to delete. */
export const qaName = (what: string) => `${QA_PREFIX} ${Date.now().toString(36)} ${what}`;

const ADMIN = {
  orgSlug: process.env.QA_ORG ?? process.env.E2E_ORG ?? 'Admin',
  email: process.env.QA_EMAIL ?? process.env.E2E_ADMIN_EMAIL ?? 'nachiket.challawar@geta.ai',
  password:
    process.env.QA_PASSWORD ?? process.env.E2E_PASSWORD ?? process.env.DEV_SEED_PASSWORD ?? '',
};
const OPERATOR = {
  email: process.env.QA_OP_EMAIL ?? process.env.E2E_OPERATOR_EMAIL ?? 'operator@example.test',
  password:
    process.env.QA_OP_PASSWORD ??
    process.env.E2E_OPERATOR_PASSWORD ??
    process.env.DEV_SEED_PASSWORD ??
    '',
};

/** 5xx answers and uncaught script errors seen during a journey; the journey fails when any is left at the end. */
const NOISE = /favicon|ResizeObserver loop|net::ERR_ABORTED|Download the React DevTools/i;

type Cleanup = () => Promise<void>;
type Fixtures = {
  /** Page signed in as the workspace admin. */
  app: Page;
  /** Page signed in as the platform operator (/admin). */
  operator: Page;
  /** API client with the admin's session cookie, for set-up and tear-down that is not the thing under test. */
  api: APIRequestContext;
  /** Register how to remove something the journey created; runs after the test, newest first, even on failure. */
  cleanup: (fn: Cleanup) => void;
  /** Throws `reason` unless the journey may run on this target. */
  destructive: () => void;
  /** Collects 5xx / uncaught errors on `app` and `operator`; asserted in afterEach. */
  watch: void;
};

async function signedIn(browser: import('@playwright/test').Browser, path: string, data: object) {
  const ctx = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
  });
  const res = await ctx.request.post(path, { data });
  if (!res.ok()) {
    await ctx.close();
    throw new Error(
      `sign-in ${path} answered ${res.status()} on ${BASE_URL}. Is the stack up, seeded, and are the QA_* credentials set?`,
    );
  }
  return ctx;
}

/** Requests made through the built-in `request` fixture, per test: the picture of an API-only journey. */
const apiCalls = new Map<string, string[]>();
const esc = (t: string) => t.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`);
/** A journey that never opens a page would otherwise give a blank screenshot: draw what it checked instead. */
const proofCard = (title: string, status: string, lines: string[]) =>
  `<body style="font:16px system-ui;margin:48px;max-width:1100px"><div style="font-size:14px;color:#555">Threadwise daily QA, ${esc(
    new Date().toISOString(),
  )}</div><h1 style="font-size:26px">${esc(title)}</h1><div style="display:inline-block;padding:6px 14px;border-radius:6px;color:#fff;background:${
    status === 'passed' ? '#15803d' : '#b91c1c'
  };font-weight:600">${status === 'passed' ? 'PASSED' : 'FAILED'}</div><pre style="margin-top:24px;font:15px ui-monospace,monospace;line-height:1.7">${esc(
    lines.join('\n'),
  )}</pre></body>`;

export const test = base.extend<Fixtures>({
  request: async ({ playwright, baseURL }, use, info) => {
    const ctx = await playwright.request.newContext({ baseURL });
    const calls: string[] = [];
    apiCalls.set(info.testId, calls);
    for (const m of ['get', 'post', 'put', 'patch', 'delete', 'head', 'fetch'] as const) {
      const orig = ctx[m].bind(ctx) as (u: string, o?: object) => ReturnType<typeof ctx.get>;
      (ctx as unknown as Record<string, unknown>)[m] = async (u: string, o?: object) => {
        const r = await orig(u, o);
        calls.push(`${m.toUpperCase()} ${u}  ->  HTTP ${r.status()}`);
        return r;
      };
    }
    await use(ctx);
    await ctx.dispose();
  },
  watch: [
    async ({ app, operator }, use, info) => {
      const seen: string[] = [];
      for (const p of [app, operator]) {
        p.on('pageerror', (e) => seen.push(`script error: ${e.message}`));
        p.on('response', (r) => {
          if (r.status() >= 500)
            seen.push(`${r.request().method()} ${new URL(r.url()).pathname} -> ${r.status()}`);
        });
      }
      await use();
      const calls = apiCalls.get(info.testId) ?? [];
      if (calls.length && app.url() === 'about:blank') {
        await app.setContent(proofCard(info.title, info.status ?? 'failed', calls));
        if (info.status !== 'passed')
          await info.attach('screenshot', {
            body: await app.screenshot(),
            contentType: 'image/png',
          });
      }
      // QA_PROOF=1 (the re-check of a fixed bug): keep a picture of the final state as the "after" screenshot for the sheet
      if (process.env.QA_PROOF === '1' && info.status === 'passed')
        await info.attach('proof', {
          body: await app.screenshot().catch(() => Buffer.alloc(0)),
          contentType: 'image/png',
        });
      const real = seen.filter((s) => !NOISE.test(s));
      if (real.length && info.status === 'passed')
        throw new Error(
          `The flow passed but the app misbehaved underneath:\n${[...new Set(real)].slice(0, 5).join('\n')}`,
        );
    },
    { auto: true },
  ],
  app: async ({ browser }, use) => {
    const ctx = await signedIn(browser, '/api/auth/login', ADMIN);
    const page = await ctx.newPage();
    await use(page);
    await ctx.close();
  },
  operator: async ({ browser }, use) => {
    const ctx = await signedIn(browser, '/api/platform-auth/login', OPERATOR);
    const page = await ctx.newPage();
    await use(page);
    await ctx.close();
  },
  api: async ({ app }, use) => use(app.context().request),
  cleanup: async ({}, use) => {
    const fns: Cleanup[] = [];
    await use((fn) => fns.push(fn));
    for (const fn of fns.reverse())
      await fn().catch((e) => console.warn(`cleanup failed: ${e?.message ?? e}`));
  },
  destructive: async ({}, use) => {
    await use(() =>
      base.skip(TARGET === 'prod', 'destructive journey: runs on the local stack only'),
    );
  },
});

export { expect };
