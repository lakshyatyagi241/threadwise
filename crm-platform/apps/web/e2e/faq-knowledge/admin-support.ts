import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, expect, request, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Shared helpers of the platform-admin FAQ specs (admin-*.spec.ts). They drive the running local stack (web :3201, API :3200, the
 * scratch database `faq_scratch`) and change GLOBAL platform config, so every spec restores it in `finally` / afterEach.
 */
export const WEB = process.env.WEB_URL ?? 'http://localhost:3201';
export const API = 'http://localhost:3200/v2';
export const SUPER = { email: 'operator@example.test', password: 'Passw0rd!' };
export const SUPPORT = { email: 'faq-admin-support@example.test', password: 'Faq-Support-Pass1' };
export const WS_PASSWORD = 'Str0ngPassw0rd#1';
export const LARGE = 'openai/text-embedding-3-large';
export const GEMINI = 'google/gemini-embedding-2';
export const DEFAULTS = {
  engineEnabled: true,
  embeddingModel: LARGE,
  generationModel: 'openai/gpt-4o-mini',
  defaultThreshold: null,
  maxFaqs: 500,
  maxVariationsPerFaq: 60,
  semanticPerHour: 600,
} as const;

/** The browser build the installed Playwright expects may be missing offline; fall back to the one on disk. */
const FALLBACK_CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`;
export const LAUNCH = existsSync(chromium.executablePath())
  ? {}
  : existsSync(FALLBACK_CHROME)
    ? { executablePath: FALLBACK_CHROME }
    : {};

/** The only database these specs may touch. */
export function sql(query: string): string {
  return execFileSync(
    'docker',
    ['exec', 'crm-postgres', 'psql', '-U', 'crm', '-d', 'faq_scratch', '-Atc', query],
    { encoding: 'utf8' },
  ).trim();
}
export const sqlNum = (query: string): number => Number(sql(query));

export const runTag = (prefix = 'pwadm') => `${prefix}${Date.now()}`;

/** The platform API as the super admin, through the web proxy (the same path the screen uses). */
export interface OperatorApi {
  ctx: APIRequestContext;
  get: (path: string) => Promise<{ status: number; body: any }>;
  patch: (path: string, data: unknown) => Promise<{ status: number; body: any }>;
  post: (path: string, data: unknown) => Promise<{ status: number; body: any }>;
  overview: () => Promise<any>;
  setConfig: (data: Record<string, unknown>) => Promise<any>;
  dispose: () => Promise<void>;
}

export async function operatorApi(who = SUPER): Promise<OperatorApi> {
  const ctx = await request.newContext({ baseURL: WEB });
  const login = await ctx.post('/api/platform-auth/login', { data: who });
  expect(login.ok(), `operator login ${who.email}`).toBe(true);
  const call = async (method: string, path: string, data?: unknown) => {
    const res = await ctx.fetch(`/api/platform${path}`, {
      method,
      data,
      headers: { 'idempotency-key': `pw-${Date.now()}-${Math.random()}` },
    });
    return { status: res.status(), body: await res.json().catch(() => null) };
  };
  const api: OperatorApi = {
    ctx,
    get: (p) => call('GET', p),
    patch: (p, d) => call('PATCH', p, d),
    post: (p, d) => call('POST', p, d),
    overview: async () => {
      const r = await call('GET', '/faq');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body;
    },
    setConfig: async (data) => {
      const r = await call('PATCH', '/faq', data);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body;
    },
    dispose: () => ctx.dispose(),
  };
  return api;
}

/** Wait until the worker has embedded everything that was waiting (nothing pending). */
export async function waitNoPending(timeout = 120_000): Promise<void> {
  await expect
    .poll(() => sqlNum(`SELECT count(*) FROM faq_variations WHERE embed_state = 'pending'`), {
      timeout,
      intervals: [1000, 2000, 3000],
      message: 'the worker should embed every waiting variation',
    })
    .toBe(0);
}

/** Put the global platform config back to exactly the defaults (only sends what differs) and wait for the index to settle. */
export async function restoreConfig(): Promise<void> {
  const op = await operatorApi();
  try {
    const { config } = await op.overview();
    const patch: Record<string, unknown> = {};
    for (const key of [
      'engineEnabled',
      'embeddingModel',
      'generationModel',
      'maxFaqs',
      'maxVariationsPerFaq',
      'semanticPerHour',
    ] as const) {
      if (config[key] !== DEFAULTS[key]) patch[key] = DEFAULTS[key];
    }
    if (config.defaultThresholdCustom) patch.defaultThreshold = null;
    if (Object.keys(patch).length > 0) await op.setConfig(patch);
  } finally {
    await op.dispose();
  }
  await waitNoPending();
  // A vector the worker finished with the old model after the switch stays "ready" but matches nothing; re-make those.
  const again = await operatorApi();
  try {
    if ((await again.overview()).stats.staleModel > 0) {
      await again.post('/faq/reindex', { scope: 'all' });
      await waitNoPending();
    }
  } finally {
    await again.dispose();
  }
}

export async function signInOperator(page: Page, who = SUPER): Promise<void> {
  const res = await page.request.post('/api/platform-auth/login', { data: who });
  expect(res.ok(), `operator login ${who.email}`).toBe(true);
}

/** Opens the page and waits until React has attached (the form is interactive) and the overview has rendered. */
export async function openFaq(page: Page): Promise<void> {
  await page.goto('/admin/faq', { timeout: 120_000 });
  await expect(page.getByRole('heading', { name: 'FAQ engine', level: 1 })).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByRole('switch', { name: 'FAQ engine' })).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(
    () =>
      Object.keys(document.querySelector('main') ?? {}).some((k) => k.startsWith('__react')) ||
      Object.keys(document.querySelector('form') ?? {}).some((k) => k.startsWith('__react')),
  );
}

export const sw = (page: Page) => page.getByRole('switch', { name: 'FAQ engine' });
export const save = (page: Page) => page.getByRole('button', { name: 'Save changes', exact: true });
export const field = {
  model: (p: Page) => p.getByRole('combobox', { name: 'Embedding model' }),
  generation: (p: Page) => p.getByRole('textbox', { name: 'Generation model' }),
  slider: (p: Page) => p.getByRole('slider', { name: 'Default match threshold' }),
  follow: (p: Page) => p.getByRole('checkbox', { name: /^Follow the model/ }),
  maxFaqs: (p: Page) => p.getByRole('textbox', { name: 'Maximum FAQs per workspace' }),
  maxVars: (p: Page) => p.getByRole('textbox', { name: 'Maximum variations per FAQ' }),
  perHour: (p: Page) => p.getByRole('textbox', { name: 'Semantic matches per workspace per hour' }),
};
/** The dd next to a dt label inside a status card. */
export const stat = (page: Page, card: string, label: string) =>
  page
    .getByRole('group', { name: card, exact: true })
    .getByRole('term')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('xpath=../dd');
/** The whole number shown in a status card (thousands separators removed). */
export const statNum = async (page: Page, card: string, label: string) =>
  Number(((await stat(page, card, label).textContent()) ?? '').replace(/[^0-9]/g, ''));

/** Collects console errors/warnings, page errors and unexpected 4xx/5xx; `allow` lists request fragments that may fail. */
export function watch(page: Page, allow: Array<string | RegExp> = []) {
  const consoleIssues: string[] = [];
  const failures: string[] = [];
  const ok = (url: string) =>
    allow.some((a) => (typeof a === 'string' ? url.includes(a) : a.test(url)));
  page.on('console', (m) => {
    if (!['error', 'warning'].includes(m.type())) return;
    const url = m.location().url;
    // The dev server has no favicon; that 404 is the environment's, not the page's.
    if (url.endsWith('/favicon.ico')) return;
    if (/Failed to load resource/.test(m.text()) && ok(url)) return;
    consoleIssues.push(`${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => consoleIssues.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().endsWith('/favicon.ico') && !ok(r.url()))
      failures.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return { consoleIssues, failures };
}

/** Every request the page makes to the platform FAQ API (method + path), in order. */
export function faqCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/platform/faq'))
      calls.push(`${r.method()} ${u.pathname}${u.search}`);
  });
  return calls;
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Workspaces                                                                                                         */
/* ------------------------------------------------------------------------------------------------------------------ */

export interface Workspace {
  tag: string;
  name: string;
  slug: string;
  email: string;
  orgId: number;
  token: () => Promise<string>;
  call: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;
  faq: (question: string, variations?: string[], answer?: string) => Promise<any>;
  enable: (threshold?: number) => Promise<any>;
}

/** Sign-ups are limited to 10 an hour per address, shared with the other specs: two pool workspaces are made once and reused. */
const POOL_FILE = '/tmp/faq-admin-e2e-workspaces.json';

export async function poolWorkspace(key: 'A' | 'B'): Promise<Workspace> {
  const tag = `pwadmpool${key.toLowerCase()}`;
  const email = `${tag}@example.test`;
  const cache: Record<string, string> = existsSync(POOL_FILE)
    ? JSON.parse(readFileSync(POOL_FILE, 'utf8'))
    : {};
  const login = async (slug: string) =>
    fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgSlug: slug, email, password: WS_PASSWORD }),
    });
  let slug = cache[key];
  if (!slug || !(await login(slug)).ok) {
    const res = await fetch(`${API}/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgName: `${tag} org`,
        fullName: `${tag} owner`,
        email,
        password: WS_PASSWORD,
        acceptTerms: true,
      }),
    });
    const body: any = await res.json();
    expect(
      res.status,
      `workspace sign-up (10 per hour per address): ${JSON.stringify(body)}`,
    ).toBeLessThan(300);
    slug = String(body.orgSlug);
    cache[key] = slug;
    writeFileSync(POOL_FILE, JSON.stringify(cache));
  }
  sql(
    `UPDATE organizations SET settings = settings || '{"onboardingStep":"done"}'::jsonb WHERE slug='${slug}'`,
  );
  const orgId = sqlNum(`SELECT id FROM organizations WHERE slug='${slug}'`);
  const token = async () => {
    const r = await login(slug);
    return String(((await r.json()) as any).tokens.accessToken);
  };
  const call = async (method: string, path: string, data?: unknown) => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await token()}`,
        'content-type': 'application/json',
        'idempotency-key': `pw-${Date.now()}-${Math.random()}`,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return {
    tag,
    name: `${tag} org`,
    slug,
    email,
    orgId,
    token,
    call,
    faq: async (question, variations = [], answer = 'Answer text') => {
      const r = await call('POST', '/faq/entries', {
        question,
        answerType: 'text',
        answerText: answer,
        variations,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body;
    },
    enable: async (threshold = 0.5) => {
      const cur = await call('GET', '/faq/settings');
      const r = await call('PUT', '/faq/settings', {
        enabled: true,
        threshold,
        minMargin: 0,
        logQueries: true,
        ...(cur.body?.rowVersion ? { rowVersion: cur.body.rowVersion } : {}),
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body;
    },
  };
}

/** Sign the workspace owner in on a page (the workspace app's own cookie session). */
export async function signInWorkspace(page: Page, ws: Workspace): Promise<void> {
  const res = await page.request.post('/api/auth/login', {
    data: { orgSlug: ws.slug, email: ws.email, password: WS_PASSWORD },
  });
  expect(res.ok(), `workspace login ${ws.email}`).toBe(true);
}

/** Wait until all of a workspace's variations are ready. */
export async function waitReady(ws: Workspace, timeout = 60_000): Promise<void> {
  await expect
    .poll(
      () =>
        sqlNum(
          `SELECT count(*) FROM faq_variations WHERE org_id=${ws.orgId} AND embed_state <> 'ready'`,
        ),
      { timeout, intervals: [1000, 2000] },
    )
    .toBe(0);
}

/** Delete the FAQs (and their vectors and match logs) a spec created, matched by the run tag in their text. Best effort. */
export function cleanupTag(tag: string): void {
  try {
    sql(`DELETE FROM faq_match_logs WHERE query LIKE '%${tag}%'`);
    sql(
      `DELETE FROM faq_variations WHERE faq_id IN (SELECT id FROM faqs WHERE question LIKE '%${tag}%')`,
    );
    sql(`DELETE FROM faqs WHERE question LIKE '%${tag}%'`);
  } catch {
    /* leave the tagged rows; they are harmless */
  }
}

/** Run `fn` with the platform OpenRouter key removed; the key (and its active flag) is always put back. */
export async function withoutPlatformKey(op: OperatorApi, fn: () => Promise<void>): Promise<void> {
  const find = async () => {
    const list = await op.get('/ai-keys');
    return (list.body.data as any[]).find((k) => k.provider === 'openrouter');
  };
  const before = await find();
  try {
    const r = await op.patch(`/ai-keys/${before.id}`, {
      rowVersion: before.rowVersion,
      removeKey: true,
    });
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    await fn();
  } finally {
    const now = await find();
    const put = await op.patch(`/ai-keys/${now.id}`, {
      rowVersion: now.rowVersion,
      apiKey: 'sk-or-demo-fixture-0000',
    });
    if (put.status >= 300)
      throw new Error(`could not restore the platform key: ${JSON.stringify(put.body)}`);
    const after = await find();
    if (before.isActive && !after.isActive)
      await op.patch(`/ai-keys/${after.id}/active`, { isActive: true });
  }
}

/* The PATCH of the settings form */
export const isPatch = (r: { method: () => string; url: () => string }) =>
  r.method() === 'PATCH' && new URL(r.url()).pathname === '/api/platform/faq';

/** Click Save and return the JSON body of the PATCH it sends. */
export async function saveAndCapture(page: Page): Promise<Record<string, unknown>> {
  const [req] = await Promise.all([page.waitForRequest(isPatch), save(page).click()]);
  return req.postDataJSON();
}
export const patches = (page: Page) => {
  const seen: unknown[] = [];
  page.on('request', (r) => {
    if (isPatch(r)) seen.push(r.postDataJSON());
  });
  return seen;
};
