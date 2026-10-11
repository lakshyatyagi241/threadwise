import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  expect,
  test as base,
  type Browser,
  type Locator,
  type BrowserContext,
  type Page,
  type Response,
  type TestInfo,
} from '@playwright/test';

/**
 * Shared helpers for the FAQ workspace specs. They drive the running local stack (web :3201, API :3200, worker, the offline AI
 * fixture) and arrange state through the API and the SCRATCH database `faq_scratch` only. Every workspace is tagged with a per-run
 * tag, and nothing outside such a workspace is ever touched.
 */
export const API = 'http://localhost:3200';
export const WEB = process.env.WEB_URL ?? 'http://localhost:3201';
export const PASSWORD = 'Str0ngPassw0rd#1';
export const RUN = `pw${Date.now()}`;
const DB = 'faq_scratch';

// --- database -------------------------------------------------------------------------------------------------------------

/** One statement against the scratch database; rows come back as arrays of text columns. */
export function sql(statement: string): string[][] {
  const out = execFileSync(
    'docker',
    ['exec', 'crm-postgres', 'psql', '-U', 'crm', '-d', DB, '-At', '-F', '\u001f', '-c', statement],
    { encoding: 'utf8' },
  ).trim();
  if (out === '') return [];
  return out
    .split('\n')
    .filter((line) => !/^(INSERT|UPDATE|DELETE) \d/.test(line))
    .map((line) => line.split('\u001f'));
}
export const sqlOne = (statement: string): string | undefined => sql(statement)[0]?.[0];

// --- workspaces ------------------------------------------------------------------------------------------------------------

export interface Workspace {
  slug: string;
  orgId: number;
  email: string;
  name: string;
  password: string;
  token: string;
  tokenAt: number;
}

let counter = 0;
/** A distinct client address per call: the API throttles sign-ups and sign-ins per address. */
const ip = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const uniq = () => `${RUN}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** A fresh workspace with onboarding done. Its admin holds every FAQ permission. */
export async function newWorkspace(label: string): Promise<Workspace> {
  const tag = `${label}${uniq()}`.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const email = `${tag}@example.test`;
  const res = await fetch(`${API}/v2/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() },
    body: JSON.stringify({
      orgName: `${tag} org`,
      fullName: `Pw ${tag}`,
      email,
      password: PASSWORD,
      acceptTerms: true,
    }),
  });
  const body = (await res.json()) as { orgSlug: string; tokens: { accessToken: string } };
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  sql(
    `UPDATE organizations SET settings = settings || '{"onboardingStep":"done"}'::jsonb WHERE slug='${body.orgSlug}'`,
  );
  const orgId = Number(sqlOne(`SELECT id FROM organizations WHERE slug='${body.orgSlug}'`));
  return {
    slug: body.orgSlug,
    orgId,
    email,
    name: `Pw ${tag}`,
    password: PASSWORD,
    token: body.tokens.accessToken,
    tokenAt: Date.now(),
  };
}

/** The workspace admin's access token, renewed when it is close to its 15 minute life. */
export async function tokenOf(ws: Workspace): Promise<string> {
  if (Date.now() - ws.tokenAt < 8 * 60_000) return ws.token;
  const res = await fetch(`${API}/v2/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() },
    body: JSON.stringify({ orgSlug: ws.slug, email: ws.email, password: ws.password }),
  });
  const body = (await res.json()) as { tokens: { accessToken: string } };
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  ws.token = body.tokens.accessToken;
  ws.tokenAt = Date.now();
  return ws.token;
}

export interface ApiResult<T = any> {
  status: number;
  body: T;
}

/** A call to the API as the workspace admin (or as `as`, a member). */
export async function call<T = any>(
  ws: Workspace,
  method: string,
  path: string,
  body?: unknown,
  as?: string,
): Promise<ApiResult<T>> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${as ?? (await tokenOf(ws))}`,
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
      'x-forwarded-for': ip(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}

export interface FaqSeed {
  question: string;
  answerText?: string;
  flowId?: string;
  category?: string;
  status?: 'active' | 'paused';
  variations?: string[];
  thresholdOverride?: number;
}

/** Creates a FAQ through the API; returns its entry. */
export async function seedFaq(ws: Workspace, f: FaqSeed): Promise<any> {
  const r = await call(ws, 'POST', '/v2/faq/entries', {
    question: f.question,
    answerType: f.flowId ? 'flow' : 'text',
    answerText: f.flowId ? undefined : (f.answerText ?? `Answer to ${f.question}`),
    flowId: f.flowId,
    category: f.category,
    status: f.status ?? 'active',
    variations: f.variations ?? [],
    thresholdOverride: f.thresholdOverride,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}

/** Waits until the worker has embedded every variation of the workspace (or `failed`). */
export async function waitIndexed(ws: Workspace, timeout = 45_000) {
  await expect
    .poll(
      () =>
        sqlOne(
          `SELECT count(*) FROM faq_variations WHERE org_id=${ws.orgId} AND embed_state='pending'`,
        ),
      {
        timeout,
        message: 'the worker should embed every variation',
      },
    )
    .toBe('0');
}

export async function getSettings(ws: Workspace) {
  return (await call(ws, 'GET', '/v2/faq/settings')).body;
}

export async function putSettings(
  ws: Workspace,
  patch: Partial<{ enabled: boolean; threshold: number; minMargin: number; logQueries: boolean }>,
) {
  const cur = await getSettings(ws);
  const r = await call(ws, 'PUT', '/v2/faq/settings', {
    enabled: cur.enabled,
    threshold: cur.threshold,
    minMargin: cur.minMargin,
    logQueries: cur.logQueries,
    rowVersion: cur.rowVersion ?? undefined,
    ...patch,
  });
  expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
  return r.body;
}

export async function entries(ws: Workspace, query = ''): Promise<any> {
  return (await call(ws, 'GET', `/v2/faq/entries?limit=100${query}`)).body;
}

/** A published, active flow that sends one message (the shape the API tests use). */
export function seedFlow(ws: Workspace, name: string, text = 'Hello from the flow'): string {
  const graph = {
    flowNodes: [
      { id: 't', type: 'trigger', data: {}, isStart: true },
      { id: 'a', type: 'message', data: { text } },
      { id: 'z', type: 'end', data: {} },
    ],
    flowEdges: [
      { source: 't', sourceHandle: 'out', target: 'a' },
      { source: 'a', sourceHandle: 'out', target: 'z' },
    ],
    vars: {},
  };
  const id = sqlOne(
    `INSERT INTO flows (org_id, flow_name, flow_data, trigger_kind, trigger_keywords, is_published, is_active, provider, flow_type)
     VALUES (${ws.orgId}, '${name.replace(/'/g, "''")}', '${JSON.stringify(graph)}'::jsonb, 'keyword', NULL, true, true, 'simulator', 'chat')
     RETURNING uuid`,
  );
  return id!;
}

export function deleteFlow(ws: Workspace, uuid: string) {
  sql(`DELETE FROM flows WHERE org_id=${ws.orgId} AND uuid='${uuid}'`);
}

// --- restricted members ----------------------------------------------------------------------------------------------------

let hashed: string | undefined;
function passwordHash(): string {
  hashed ??= execFileSync(
    'node',
    ['-e', `require('@node-rs/argon2').hash(${JSON.stringify(PASSWORD)}).then(console.log)`],
    { cwd: `${process.cwd()}/../api`, encoding: 'utf8' },
  ).trim();
  return hashed;
}

export interface Member {
  email: string;
  token: string;
}

/** A second member of the workspace with exactly these permission keys. */
export async function member(ws: Workspace, name: string, keys: string[]): Promise<Member> {
  const email = `${name}${uniq()}@example.test`.toLowerCase();
  const role = sqlOne(
    `INSERT INTO roles (org_id, name) VALUES (${ws.orgId}, '${name}-${uniq()}') RETURNING id`,
  );
  for (const key of keys) {
    sql(
      `INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope) VALUES (${ws.orgId}, ${role}, '${key}', 'allow', 'all')`,
    );
  }
  const user = sqlOne(
    `INSERT INTO users (org_id, email, full_name, password_hash) VALUES (${ws.orgId}, '${email}', '${name}', '${passwordHash()}') RETURNING id`,
  );
  sql(`INSERT INTO user_roles (org_id, user_id, role_id) VALUES (${ws.orgId}, ${user}, ${role})`);
  sql(
    `INSERT INTO user_security (org_id, user_id, email_verified_at, password_changed_at) VALUES (${ws.orgId}, ${user}, now(), now())`,
  );
  const res = await fetch(`${API}/v2/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() },
    body: JSON.stringify({ orgSlug: ws.slug, email, password: PASSWORD }),
  });
  const body = (await res.json()) as any;
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return { email, token: body.tokens.accessToken };
}

// --- customers ---------------------------------------------------------------------------------------------------------------

export interface Sim {
  channelId: string;
  from: string;
}

export async function simulator(ws: Workspace): Promise<Sim> {
  const r = await call(ws, 'POST', '/v2/channels/simulator', {
    name: 'Simulator',
    settings: { simulator: { latencyMs: { sent: 0, delivered: 150, read: 400 } } },
  });
  expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
  return { channelId: r.body.id, from: `9197${String(Date.now()).slice(-8)}` };
}

export async function customerSays(ws: Workspace, sim: Sim, text: string, from = sim.from) {
  const r = await call(ws, 'POST', `/v2/dev/simulator/channels/${sim.channelId}/inbound`, {
    from,
    name: 'Asha',
    text,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(202);
}

/** What the customer received, oldest first. */
export function repliesTo(ws: Workspace, from: string): string[] {
  return sql(
    `SELECT m.body FROM messages m JOIN conversations c ON c.org_id=m.org_id AND c.id=m.conversation_id
     WHERE c.org_id=${ws.orgId} AND c.peer_key='${from}' AND m.direction='out' ORDER BY m.seq`,
  ).map((r) => r[0]!);
}

export const logCount = (ws: Workspace, extra = '') =>
  Number(
    sqlOne(
      `SELECT count(*) FROM faq_match_logs WHERE org_id=${ws.orgId} AND origin='inbound' ${extra}`,
    ),
  );

// --- browser -----------------------------------------------------------------------------------------------------------------

/** Signs in through the login screen and waits for the app. */
export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login', { timeout: 60_000 });
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(dashboard|inbox|onboarding|faq|home)/, {
    timeout: 120_000,
    waitUntil: 'commit',
  });
}

/** Console problems and failed requests of the pages a test opens; the test fails at its end if any show up. */
export class Watch {
  readonly problems: string[] = [];
  private allowed: RegExp[] = [];
  /** Ignore a problem whose text matches (a request or message the test provokes on purpose). */
  allow(...patterns: RegExp[]) {
    this.allowed.push(...patterns);
  }
  attach(page: Page) {
    const add = (text: string) => {
      if (!this.allowed.some((re) => re.test(text))) this.problems.push(text);
    };
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning')
        add(`console.${m.type()} ${m.text()} @ ${page.url()}`);
    });
    page.on('pageerror', (e) => add(`pageerror ${e.message} @ ${page.url()}`));
    page.on('response', (r: Response) => {
      if (r.status() >= 400) add(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
    });
  }
  assertClean() {
    expect(this.problems, 'console problems and failed requests').toEqual([]);
  }
}

export const test = base.extend<{ watch: Watch }>({
  watch: async ({}, use, info: TestInfo) => {
    const w = new Watch();
    await use(w);
    if (info.status === info.expectedStatus) w.assertClean();
  },
});
export { expect };

export type State = Awaited<ReturnType<BrowserContext['storageState']>>;

/** Signs the workspace admin (or a member) in through the UI once and returns the browser session to reuse. */
export async function login(browser: Browser, email: string): Promise<State> {
  const ctx = await browser.newContext({ baseURL: WEB });
  const page = await ctx.newPage();
  await signIn(page, email);
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

export interface OpenOptions {
  viewport?: { width: number; height: number };
  colorScheme?: 'dark' | 'light';
  locale?: string;
  reducedMotion?: 'reduce';
  /** The app's own theme choice (a cookie), not the browser's. */
  theme?: 'dark' | 'light';
}

/** A new browser context signed in with `state`; its pages are watched. */
export async function open(
  browser: Browser,
  state: State,
  watch: Watch,
  opts: OpenOptions = {},
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    baseURL: WEB,
    storageState: state,
    viewport: opts.viewport,
    colorScheme: opts.colorScheme,
    reducedMotion: opts.reducedMotion,
  });
  ctx.setDefaultTimeout(15_000);
  ctx.setDefaultNavigationTimeout(30_000);
  // The cookie banner would sit over the bottom of every screen; the visitor has declined everything optional.
  await ctx.addCookies([
    {
      name: 'crm_cookie_consent',
      value: encodeURIComponent(
        JSON.stringify({ necessary: true, analytics: false, marketing: false, ts: 1790000000 }),
      ),
      url: WEB,
    },
    ...(opts.locale ? [{ name: 'NEXT_LOCALE', value: opts.locale, url: WEB }] : []),
    ...(opts.theme ? [{ name: 'crm_theme', value: opts.theme, url: WEB }] : []),
  ]);
  const page = await ctx.newPage();
  watch.attach(page);
  return { ctx, page };
}

/** True once React has attached to the page: before that a click on server-rendered HTML does nothing. */
export async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('main, #__next, body > div');
    return (
      (!!el && Object.keys(el).some((k) => k.startsWith('__react'))) ||
      Array.from(document.querySelectorAll('button')).some((b) =>
        Object.keys(b).some((k) => k.startsWith('__react')),
      )
    );
  });
}

export async function go(page: Page, path: string) {
  await page.goto(path, { timeout: 60_000 });
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });
  await hydrated(page);
}

/** Switch FAQ answering on or off through the API, as the workspace admin. */
export async function answering(ws: Workspace, on: boolean) {
  return putSettings(ws, { enabled: on });
}

export const toast = (page: Page, text: string | RegExp) =>
  page.getByRole('status').filter({ hasText: text }).first();

/** Poll a DB-backed or API-backed condition. */
export const eventually = <T>(fn: () => T | Promise<T>, timeout = 30_000) =>
  expect.poll(async () => fn(), { timeout, intervals: [500, 1000, 2000] });

/** The editor's question box (the section around it carries the same name). */
export const questionBox = (page: Page) =>
  page.getByRole('textbox', { name: 'Question', exact: true });

/** The "New phrasing" input of the variations panel (its wrapper group carries the same name). */
export const phrasingBox = (page: Page) => page.getByRole('textbox', { name: 'New phrasing' });

/** Keyboard only: press Tab until `target` has focus (fails after `max` presses). Returns how many presses it took. */
export async function tabTo(page: Page, target: Locator, max = 60): Promise<number> {
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press('Tab');
    const focused = await target.evaluate((el) => el === document.activeElement).catch(() => false);
    if (focused) return i;
  }
  throw new Error(`Tab never reached the target within ${max} presses`);
}

/**
 * Platform operator calls (the super admin), through the web app's own operator proxy. The caller must restore what it changes.
 */
export async function operator(): Promise<{
  get: () => Promise<any>;
  patch: (body: object) => Promise<any>;
  reindexAll: () => Promise<void>;
  dispose: () => Promise<void>;
}> {
  const { request } = await import('@playwright/test');
  const ctx = await request.newContext({ baseURL: WEB });
  const login = await ctx.post('/api/platform-auth/login', {
    data: { email: 'operator@example.test', password: 'Passw0rd!' },
  });
  expect(login.ok(), 'operator login').toBe(true);
  return {
    get: async () => (await ctx.get('/api/platform/faq')).json(),
    patch: async (body) => {
      // The dev server can drop a connection while it compiles; a restore must not be lost to that, so retry.
      let r!: Awaited<ReturnType<typeof ctx.patch>>;
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          r = await ctx.patch('/api/platform/faq', {
            data: body,
            headers: { 'idempotency-key': randomUUID() },
          });
          break;
        } catch (e) {
          if (attempt === 4) throw e;
          await new Promise((res) => setTimeout(res, 2000 * attempt));
        }
      }
      expect(r.status(), JSON.stringify(await r.json().catch(() => ({})))).toBeLessThan(300);
      return r.json();
    },
    reindexAll: async () => {
      const r = await ctx.post('/api/platform/faq/reindex', {
        data: { scope: 'all' },
        headers: { 'idempotency-key': randomUUID() },
      });
      expect(r.status()).toBeLessThan(300);
    },
    dispose: () => ctx.dispose(),
  };
}

/**
 * Waits until the platform has no vector waiting to be made again. A vector the worker made with the previous model while the model
 * was being switched back stays "ready" on the wrong model (an API defect, see the report), and nothing re-queues it: when only
 * such rows are left, queue everything once more.
 */
export async function waitReindexed(
  op: { get: () => Promise<any>; reindexAll: () => Promise<void> },
  timeout = 420_000,
) {
  let healed = false;
  await expect
    .poll(
      async () => {
        const s = (await op.get()).stats;
        if (s.pending === 0 && s.staleModel > 0 && !healed) {
          healed = true;
          await op.reindexAll();
        }
        return s.pending + s.staleModel;
      },
      { timeout, intervals: [1000, 2000, 3000] },
    )
    .toBe(0);
}
