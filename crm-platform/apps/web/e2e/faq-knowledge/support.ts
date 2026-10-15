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
 * Shared helpers for the FAQ specs. FAQs belong to a flow: every workspace made here also gets a default published, active flow
 * (`ws.flowUuid`), and every FAQ helper takes the flow (a uuid) as an optional last argument, defaulting to that one. They drive the running local stack (web :3201, API :3200, worker, the offline AI
 * fixture) and arrange state through the API and the SCRATCH database `faq_scratch` only. Every workspace is tagged with a per-run
 * tag, and nothing outside such a workspace is ever touched.
 */
export const API = 'http://localhost:3200';
export const WEB = process.env.WEB_URL ?? 'http://localhost:3201';
export const PASSWORD = 'Str0ngPassw0rd#1';
export const RUN = `pw${Date.now()}`;
const DB = process.env.FAQ_DB ?? 'faq_scratch';

// --- database -------------------------------------------------------------------------------------------------------------

/** One statement against the scratch database; rows come back as arrays of text columns. */
export function sql(statement: string): string[][] {
  const out = execFileSync(
    'docker',
    [
      'exec',
      process.env.FAQ_PG ?? 'crm-postgres',
      'psql',
      '-U',
      'crm',
      '-d',
      DB,
      '-At',
      '-F',
      '\u001f',
      '-c',
      statement,
    ],
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
  /** The workspace's default flow (published, active, on the simulator engine): the one the FAQ helpers use unless told another. */
  flowUuid: string;
  flowId: number;
}

let counter = 0;
/** A distinct client address per call: the API throttles sign-ups and sign-ins per address. */
const ip = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const uniq = () => `${RUN}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/**
 * A fresh workspace with onboarding done. Its admin holds every FAQ permission. It edits flows in the Simple builder (where the FAQs
 * tab is) unless `builder: 'advanced'` asks for the canvas: the builder is a choice of the whole workspace.
 */
export async function newWorkspace(
  label: string,
  opts: { builder?: 'simple' | 'advanced' } = {},
): Promise<Workspace> {
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
  const ws: Workspace = {
    slug: body.orgSlug,
    orgId,
    email,
    name: `Pw ${tag}`,
    password: PASSWORD,
    token: body.tokens.accessToken,
    tokenAt: Date.now(),
    flowUuid: '',
    flowId: 0,
  };
  // Every FAQ belongs to a flow, so a workspace starts with one: published, active, a welcome message after the trigger, tied to no
  // channel and no keyword (it answers only through its FAQs). It opens in the Simple builder.
  ws.flowUuid = seedBuilderFlow(
    ws,
    'Main flow',
    [
      { id: 't', type: 'trigger' },
      { id: 'a', type: 'message', data: { text: 'Welcome' } },
    ],
    [['t', 'out', 'a']],
  );
  ws.flowId = flowIdOf(ws, ws.flowUuid);
  // FAQs are edited in the Simple builder: the workspace opens flows there (a new workspace opens them in the Advanced one) and its
  // plan has the automation feature the flow screens need.
  enableAutomation(ws);
  const mode = await call(ws, 'PUT', '/v2/flows/builder-mode', { mode: opts.builder ?? 'simple' });
  expect(mode.status, JSON.stringify(mode.body)).toBe(200);
  return ws;
}

/** The numeric id of a flow (what the match log and the SQL checks use) from its uuid. */
export const flowIdOf = (ws: Workspace, uuid: string): number =>
  Number(sqlOne(`SELECT id FROM flows WHERE org_id=${ws.orgId} AND uuid='${uuid}'`));

/** The API path prefix of a flow's FAQs. `flow` is a flow uuid; the workspace's default flow when left out. */
export const faqBase = (ws: Workspace, flow: string = ws.flowUuid) => `/v2/faq/flows/${flow}`;

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
  // One key per call, kept across the retry: a connection the server closed while idle is sent again without doing the work twice.
  const key = randomUUID();
  const headers = {
    authorization: `Bearer ${as ?? (await tokenOf(ws))}`,
    'content-type': 'application/json',
    'idempotency-key': key,
    'x-forwarded-for': ip(),
  };
  let res!: Awaited<ReturnType<typeof fetch>>;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await fetch(`${API}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // A request that never answers must fail the test with a clear error instead of hanging it until the test timeout.
        signal: AbortSignal.timeout(60_000),
      });
      break;
    } catch (e) {
      if (attempt === 3 || !/fetch failed/.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}

export interface FaqSeed {
  question: string;
  /** The flow that owns the FAQ (uuid); the workspace's default flow when left out. */
  owner?: string;
  answerText?: string;
  /** The flow the FAQ sends the customer to (the answer target), when the answer is "go to a step". */
  flowId?: string;
  /** Go to this step of the target flow (the editor's node id). */
  flowNodeId?: string;
  category?: string;
  status?: 'active' | 'paused';
  variations?: string[];
  thresholdOverride?: number;
}

/** Creates a FAQ through the API; returns its entry. */
export async function seedFaq(ws: Workspace, f: FaqSeed): Promise<any> {
  const r = await call(ws, 'POST', `${faqBase(ws, f.owner)}/entries`, {
    question: f.question,
    answerType: f.flowId ? 'flow' : 'text',
    answerText: f.flowId ? undefined : (f.answerText ?? `Answer to ${f.question}`),
    flowId: f.flowId,
    flowNodeId: f.flowNodeId,
    category: f.category,
    status: f.status ?? 'active',
    variations: f.variations ?? [],
    thresholdOverride: f.thresholdOverride,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}

/** Waits until the worker has embedded every variation of the workspace (every flow; or `failed`). */
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

export async function getSettings(ws: Workspace, flow?: string) {
  return (await call(ws, 'GET', `${faqBase(ws, flow)}/settings`)).body;
}

export async function putSettings(
  ws: Workspace,
  patch: Partial<{
    enabled: boolean;
    threshold: number;
    minMargin: number;
    logQueries: boolean;
    verifyMode: 'off' | 'borderline';
    verifyBand: number;
  }>,
  flow?: string,
) {
  const cur = await getSettings(ws, flow);
  const r = await call(ws, 'PUT', `${faqBase(ws, flow)}/settings`, {
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

/**
 * Makes `query` a close call for the second check: reads its meaning score with the check off, then saves a bar just under that
 * score with the check on and a band of `bandPoints`, so the score is inside [bar, bar + band). Returns the score and the bar.
 */
export async function closeCall(ws: Workspace, query: string, bandPoints = 0.1, flow?: string) {
  await putSettings(ws, { verifyMode: 'off' }, flow);
  const probe = (await call(ws, 'POST', `${faqBase(ws, flow)}/test`, { query })).body;
  expect(probe.tier, `"${query}" must be a meaning match`).toBe('semantic');
  const score = probe.score as number;
  const threshold = Math.round((Math.floor(score * 100 + 1e-6) / 100 - 0.01) * 100) / 100;
  await putSettings(ws, { threshold, verifyMode: 'borderline', verifyBand: bandPoints }, flow);
  return { score, threshold };
}

export async function entries(ws: Workspace, query = '', flow?: string): Promise<any> {
  return (await call(ws, 'GET', `${faqBase(ws, flow)}/entries?limit=100${query}`)).body;
}

/** A published, active flow that sends one message (the shape the API tests use): an answer target, or a second flow. */
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

/**
 * A published, active flow of three steps after the trigger: `a` says "Intro step", `b` (named "Second") says "Second step", then
 * an End. It is what an FAQ links to when the test is about starting at a step.
 */
export function seedStepsFlow(ws: Workspace, name: string): string {
  const graph = {
    flowNodes: [
      { id: 't', type: 'trigger', data: {}, isStart: true },
      { id: 'a', type: 'message', data: { text: 'Intro step' } },
      { id: 'b', type: 'message', data: { label: 'Second', text: 'Second step' } },
      { id: 'z', type: 'end', data: {} },
    ],
    flowEdges: [
      { source: 't', sourceHandle: 'out', target: 'a' },
      { source: 'a', sourceHandle: 'out', target: 'b' },
      { source: 'b', sourceHandle: 'out', target: 'z' },
    ],
    vars: {},
  };
  return sqlOne(
    `INSERT INTO flows (org_id, flow_name, flow_data, trigger_kind, trigger_keywords, is_published, is_active, provider, flow_type)
     VALUES (${ws.orgId}, '${name.replace(/'/g, "''")}', '${JSON.stringify(graph)}'::jsonb, 'keyword', NULL, true, true, 'simulator', 'chat')
     RETURNING uuid`,
  )!;
}

/** Replaces a flow's steps (to simulate the author deleting one after an FAQ was pointed at it). */
export function setFlowNodes(
  ws: Workspace,
  uuid: string,
  nodes: Array<{ id: string; type: string; data?: object }>,
) {
  const graph = {
    flowNodes: nodes.map((n, i) => ({
      ...n,
      data: n.data ?? {},
      ...(i === 0 ? { isStart: true } : {}),
    })),
    flowEdges: [],
    vars: {},
  };
  sql(
    `UPDATE flows SET flow_data = '${JSON.stringify(graph)}'::jsonb WHERE org_id=${ws.orgId} AND uuid='${uuid}'`,
  );
}

export interface BuilderNode {
  id: string;
  type: string;
  data?: Record<string, unknown>;
  x?: number;
  y?: number;
}

/**
 * A published, active flow in the shape the flow builder opens (every node has a position, every edge an id). `edges` are
 * `[source, sourceHandle, target]`; `keywords` makes it start when a customer's message contains them.
 */
export function seedBuilderFlow(
  ws: Workspace,
  name: string,
  nodes: BuilderNode[],
  edges: Array<[string, string, string]>,
  opts: { keywords?: string; published?: boolean } = {},
): string {
  const graph = {
    flowNodes: nodes.map((n, i) => ({
      id: n.id,
      type: n.type,
      x: n.x ?? 80 + i * 300,
      y: n.y ?? 120,
      data: n.data ?? {},
      ...(i === 0 ? { isStart: true } : {}),
    })),
    flowEdges: edges.map(([source, sourceHandle, target], i) => ({
      id: `e${i + 1}`,
      source,
      sourceHandle,
      target,
    })),
    vars: [],
  };
  const published = opts.published ?? true;
  return sqlOne(
    `INSERT INTO flows (org_id, flow_name, flow_data, trigger_kind, trigger_keywords, is_published, is_active, provider, flow_type)
     VALUES (${ws.orgId}, '${name.replace(/'/g, "''")}', '${JSON.stringify(graph).replace(/'/g, "''")}'::jsonb, 'keyword',
       ${opts.keywords ? `'${opts.keywords.replace(/'/g, "''")}'` : 'NULL'}, ${published}, true, 'simulator', 'chat')
     RETURNING uuid`,
  )!;
}

/** The graph the API holds for a flow (what the builder saved). */
export function flowGraph(ws: Workspace, uuid: string): any {
  return JSON.parse(
    sqlOne(`SELECT flow_data::text FROM flows WHERE org_id=${ws.orgId} AND uuid='${uuid}'`)!,
  );
}

/**
 * The plan flag the flow builder needs to create and edit flows (a new workspace starts on a plan without it), and room for more than
 * the one flow a trial plan allows (a workspace here has several flows, each with its own FAQs).
 */
export function enableAutomation(ws: Workspace) {
  sql(
    `UPDATE org_plan_state SET overrides = overrides || '{"features":{"automation":true},"limits":{"flows":-1}}'::jsonb WHERE org_id=${ws.orgId}`,
  );
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

export async function simulator(ws: Workspace, name = 'Simulator'): Promise<Sim> {
  const r = await call(ws, 'POST', '/v2/channels/simulator', {
    name,
    settings: { simulator: { latencyMs: { sent: 0, delivered: 150, read: 400 } } },
  });
  expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
  return { channelId: r.body.id, from: `9197${String(Date.now()).slice(-8)}` };
}

/** Ties a flow to one channel (what the flow's trigger "on this number" does): the flow answers only there. */
export function bindFlow(ws: Workspace, flowUuid: string, sim: Sim) {
  sql(
    `UPDATE flows SET trigger_channel_id = (SELECT id FROM channels WHERE org_id=${ws.orgId} AND uuid='${sim.channelId}')
     WHERE org_id=${ws.orgId} AND uuid='${flowUuid}'`,
  );
}

/** The match-log rows of one flow, newest first: `[query, outcome, origin]` (the log is per flow). */
export function logRowsOf(ws: Workspace, flowUuid: string): string[][] {
  return sql(
    `SELECT query, outcome, origin FROM faq_match_logs
     WHERE org_id=${ws.orgId} AND flow_id=(SELECT id FROM flows WHERE org_id=${ws.orgId} AND uuid='${flowUuid}') ORDER BY id DESC`,
  );
}

export async function customerSays(ws: Workspace, sim: Sim, text: string, from = sim.from) {
  const r = await call(ws, 'POST', `/v2/dev/simulator/channels/${sim.channelId}/inbound`, {
    from,
    name: 'Asha',
    text,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(202);
}

/** How many match-log rows (from the customer's own message or from a flow) the customer with this number has. */
export const loggedFor = (ws: Workspace, from: string) =>
  Number(
    sqlOne(
      `SELECT count(*) FROM faq_match_logs l JOIN conversations c ON c.org_id=l.org_id AND c.id=l.conversation_id
       WHERE l.org_id=${ws.orgId} AND c.peer_key='${from}'`,
    ),
  );

let askCounter = 0;
/**
 * A new customer writes `text`; resolves with their number once the FAQ engine has looked at the message (a match-log row exists) and,
 * when given, `done(from)` holds (the visible result of work a job does after the match, such as a flow's replies).
 *
 * The local stack shares its Redis queues with whatever other workers run on the machine, and a job taken by a worker of another
 * database is lost: a message that is never looked at is sent again as a NEW customer (up to 4 times), and a job that comes back
 * only through the engine's own recovery sweep (about two minutes) is waited for up to `settleMs`. The caller's assertions then
 * run on an attempt that was really handled.
 */
export async function customerAsks(
  ws: Workspace,
  sim: Sim,
  text: string,
  done: (from: string) => boolean = () => true,
  settleMs = 240_000,
): Promise<string> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (let attempt = 1; attempt <= 6; attempt++) {
    const from = `9198${String(Date.now()).slice(-7)}${String(++askCounter).padStart(2, '0')}`;
    await customerSays(ws, sim, text, from);
    const looked = Date.now() + 25_000;
    while (Date.now() < looked && loggedFor(ws, from) === 0) await sleep(500);
    if (loggedFor(ws, from) === 0) continue;
    const settled = Date.now() + settleMs;
    while (Date.now() < settled) {
      if (done(from)) return from;
      await sleep(1000);
    }
    throw new Error(`"${text}" was matched but its result never showed within ${settleMs} ms`);
  }
  throw new Error(
    `"${text}" was never looked at by the FAQ engine in 6 attempts (is a worker running for this database?)`,
  );
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

/**
 * Signs in through the login screen and waits for the app. A click on the server-rendered form before React has attached submits it
 * natively and reloads the login page, so a sign-in that has not left the page after 25 seconds is tried again (up to 3 times).
 */
export async function signIn(page: Page, email: string, password = PASSWORD) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto('/login', { timeout: 60_000 });
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    try {
      await page.waitForURL(/\/(dashboard|inbox|onboarding|faq|home)/, {
        timeout: attempt === 3 ? 120_000 : 25_000,
        waitUntil: 'commit',
      });
      return;
    } catch (e) {
      if (attempt === 3) throw e;
    }
  }
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
    // The machine's network interface changing under the browser (a VPN or Wi-Fi switch) aborts requests and script loads: that is the
    // environment's doing, not the page's, so it and the script-load error it causes are not counted.
    let networkChanged = false;
    const add = (text: string) => {
      // A QUIC handshake failure on a page load is the browser's network stack, not the page.
      if (/ERR_QUIC_PROTOCOL_ERROR/.test(text)) return;
      if (/ERR_NETWORK_CHANGED/.test(text)) {
        networkChanged = true;
        return;
      }
      if (networkChanged && /^pageerror Event @/.test(text)) return;
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

export const test = base.extend<{ watch: Watch; roomy: void }>({
  // The builder holds a whole flow editor around the FAQ screens, and the dev server compiles it on first use: every test gets a
  // longer budget than Playwright's 30 seconds (a test can still set its own).
  roomy: [
    async ({}, use, info: TestInfo) => {
      info.setTimeout(Math.max(info.timeout, 120_000));
      await use();
    },
    { auto: true },
  ],
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
  // The dev server compiles a screen on its first visit and can be slow on a busy machine: one reload before giving up.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(path, { timeout: 120_000 });
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 45_000 });
      break;
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
  await hydrated(page);
}

/** Switch one flow's FAQ answering on or off through the API, as the workspace admin (the default flow unless told another). */
export async function answering(ws: Workspace, on: boolean, flow?: string) {
  return putSettings(ws, { enabled: on }, flow);
}

/** `/flows/simple/<flow>?tab=faqs&view=...`: one screen of a flow's FAQs. `target` is a Workspace (its default flow) or a flow uuid. */
export function faqUrl(target: Workspace | string, view?: string): string {
  const uuid = typeof target === 'string' ? target : target.flowUuid;
  return `/flows/simple/${uuid}?tab=faqs${view ? `&view=${view}` : ''}`;
}

/** The FAQs tab of the Simple builder: a locator for the panel the FAQ screens live in (the builder around it is another screen). */
export const faqPanel = (page: Page) => page.locator('#web-bot-panel-faqs');

/** Reloads the page and waits for the FAQs tab to be back (the whole builder loads again, which is slower than a screen did). */
export async function reloadFaqs(page: Page) {
  await page.reload({ timeout: 120_000 });
  await expect(faqPanel(page).getByRole('navigation').first()).toBeVisible({ timeout: 60_000 });
  await hydrated(page);
}

/** The `view` of the address: the id of the FAQ the editor shows (or `new`, `test`, ...). Null on the list. */
export const viewOf = (page: Page): string | null => new URL(page.url()).searchParams.get('view');

/**
 * Opens a screen of a flow's FAQs and waits until the panel is on screen and React has attached. The dev server compiles the
 * builder on its first visit, so one reload is tried before giving up.
 */
export async function openFaqs(page: Page, target: Workspace | string, view?: string) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(faqUrl(target, view), { timeout: 120_000 });
      // (Found by its place in the tab, not by name: the name is translated.)
      await expect(faqPanel(page).getByRole('navigation').first()).toBeVisible({
        timeout: 60_000,
      });
      break;
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
  await hydrated(page);
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
      for (let attempt = 1; attempt <= 6; attempt++) {
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
