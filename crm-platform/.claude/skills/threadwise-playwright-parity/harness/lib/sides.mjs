// A "side" is one of the two apps under test. Both expose the same surface to scenarios:
//   side.open({role}) -> { context, page, request, rec }   a fresh isolated browser context, logged in
//   side.url(path), side.close()
// Reference = the Laravel reference (session cookie + CSRF). Ours = the new platform (staff JWT for the API,
// UI login through the web app once apps/web exists).
import { join } from 'node:path';
import { request as pwRequest } from 'playwright';
import { Recorder } from './recorder.mjs';
import { resolveLocator } from './locate.mjs';
import { ensureDir, sleep } from './util.mjs';

const NET = new WeakMap();
function netTracker(page) {
  let st = NET.get(page);
  if (st) return st;
  st = { pending: new Map(), last: Date.now() };
  const done = (r) => {
    st.pending.delete(r);
    st.last = Date.now();
  };
  page.on('request', (r) => {
    if (['websocket', 'eventsource', 'media'].includes(r.resourceType())) return;
    st.pending.set(r, Date.now());
    st.last = Date.now();
  });
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  NET.set(page, st);
  return st;
}

/**
 * Wait until the page is really done: load fired, no navigation in flight, and the network has been quiet.
 * "Quiet" ignores requests older than 2.5 s (long-polls) and tolerates apps that poll in the background, which is
 * why this is not Playwright's networkidle: Reference (and most dashboards) never reach it.
 */
export async function settle(
  page,
  { quiet = 400, timeout = 8000, since = 0, grace = 800, depth = 0 } = {},
) {
  const t0 = Date.now();
  const st = netTracker(page);
  try {
    await page.waitForLoadState('load', { timeout });
  } catch {
    /* slow page: carry on with what we have */
  }
  let navigated = false;
  const onNav = (f) => {
    if (f === page.mainFrame()) navigated = true;
  };
  page.on('framenavigated', onNav);
  try {
    // After a user action the handler may defer its request (debounce, animation, token fetch): give it a grace
    // window to start something before concluding that nothing happens.
    if (since) while (Date.now() - since < grace && st.last < since && !navigated) await sleep(40);
    while (Date.now() - t0 < timeout) {
      const now = Date.now();
      const inflight = [...st.pending.values()].filter((at) => now - at < 2500).length;
      if (!inflight && now - st.last >= quiet) break;
      await sleep(50);
    }
    await sleep(60);
  } finally {
    page.off('framenavigated', onNav);
  }
  if (navigated && depth < 3 && Date.now() - t0 < timeout)
    return settle(page, {
      quiet,
      timeout: Math.max(2000, timeout - (Date.now() - t0)),
      depth: depth + 1,
    });
}

/** fill + read back, retry: guards setup steps (login) against pages that re-render right after load. */
export async function fillVerified(locator, value, tries = 3) {
  for (let i = 0; i < tries; i++) {
    await locator.fill(value);
    await sleep(120);
    if ((await locator.inputValue().catch(() => value)) === value) return;
  }
  throw new Error('field did not keep its value after fill (page keeps re-rendering?)');
}

class Side {
  constructor({ name, cfg, browser, runDir }) {
    this.name = name;
    this.cfg = cfg;
    this.browser = browser;
    this.runDir = runDir;
    this.stateDir = ensureDir(join(runDir, 'state'));
    this.opened = new Set();
    this.hasUi = true;
  }

  statePath(role) {
    return join(this.stateDir, `${this.name}-${role}.json`);
  }

  async newContext(extra = {}, { storage } = {}) {
    const { viewport, ...rest } = extra;
    const vp = viewport || this.cfg.desktop;
    const context = await this.browser.newContext({
      locale: 'en-US',
      timezoneId: 'UTC',
      ignoreHTTPSErrors: true,
      acceptDownloads: true,
      ...(storage ? { storageState: storage } : {}),
      ...rest,
      viewport: { width: vp.width, height: vp.height },
    });
    context.setDefaultTimeout(this.cfg.timeouts.action);
    context.setDefaultNavigationTimeout(this.cfg.timeouts.navigation);
    await this.prepareContext(context);
    return context;
  }

  async prepareContext() {}

  /** A fresh, isolated, logged-in browser context + page with the recorder attached. */
  async open({ role = 'admin', viewport, dialogPolicy = 'accept', loggedIn = true } = {}) {
    if (!this.hasUi && this.name === 'ours')
      throw Object.assign(
        new Error('our web app is not running (apps/web missing or PARITY_WEB_URL unset)'),
        { code: 'NO_UI' },
      );
    const storage = loggedIn ? await this.ensureLogin(role) : undefined;
    const context = await this.newContext({ viewport }, { storage });
    const rec = new Recorder({
      side: this.name,
      origin: this.origin(),
      ignore: this.cfg.ignore,
      dialogPolicy,
    });
    context.on('page', (p) => rec.attach(p));
    const page = await context.newPage();
    rec.attach(page);
    const handle = {
      context,
      page,
      rec,
      side: this,
      role,
      request: await this.apiFor(context, role),
    };
    this.opened.add(handle);
    return handle;
  }

  /** API-only handle: no browser page. Used by scenarios flagged `api: true` (and for ours before apps/web exists). */
  async openApi({ role = 'admin' } = {}) {
    const rec = new Recorder({
      side: this.name,
      origin: this.origin(),
      ignore: this.cfg.ignore,
      dialogPolicy: 'accept',
    });
    if (this.name === 'threadwise') {
      const h = await this.open({ role });
      return h;
    }
    const request = await this.api(role);
    const handle = { context: null, page: null, rec, side: this, role, request, apiOnly: true };
    this.opened.add(handle);
    return handle;
  }

  async release(handle) {
    this.opened.delete(handle);
    await handle.context?.close().catch(() => {});
    // Ours hands every handle the SAME cached Bearer client (OursSide.api); it is disposed once, in disposeApis().
    // Disposing it here broke every later scenario of the run ("Target page, context or browser has been closed").
    if (handle.context && this.name !== 'ours') await handle.request?.dispose?.().catch(() => {});
  }

  async close() {
    for (const h of [...this.opened]) await this.release(h);
    await this.disposeApis?.();
  }

  origin() {
    return new URL(this.baseUrl).origin;
  }

  url(path = '/') {
    if (/^https?:\/\//.test(path)) return path;
    return this.baseUrl.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path);
  }
}

// ---------------------------------------------------------------------------------------------------------------
export class ThreadwiseSide extends Side {
  constructor(o) {
    super({ ...o, name: 'threadwise' });
    this.baseUrl = o.cfg.threadwise.baseUrl;
    this.logins = new Map();
  }

  async prepareContext(context) {
    const c = this.cfg.threadwise.consentCookie;
    if (!c) return;
    await context.addCookies([
      {
        name: c.name,
        value: encodeURIComponent(
          JSON.stringify({ ...c.value, ts: Math.floor(Date.now() / 1000) }),
        ),
        url: this.origin(),
      },
    ]);
  }

  ensureLogin(role) {
    if (!this.logins.has(role))
      this.logins.set(
        role,
        this.doLogin(role).catch((e) => {
          this.logins.delete(role);
          throw e;
        }),
      );
    return this.logins.get(role);
  }

  async doLogin(role) {
    const user = this.cfg.threadwise.users[role];
    if (!user) throw new Error(`no Reference user configured for role "${role}" (cfg.threadwise.users)`);
    const context = await this.newContext();
    const page = await context.newPage();
    await page.goto(this.url(this.cfg.threadwise.loginPath), { waitUntil: 'load' });
    await settle(page);
    const pw = page.locator('input[type=password]').first();
    const form = page.locator('form').filter({ has: pw }).first();
    await fillVerified(
      form.locator('input[type=email], input[name=email], input[name=username]').first(),
      user.email,
    );
    await fillVerified(pw, user.password);
    const submit = form.locator('button[type=submit], input[type=submit]').first();
    await Promise.all([
      page.waitForURL((u) => this.cfg.threadwise.loginOk(u.href), {
        timeout: this.cfg.timeouts.navigation,
      }),
      submit.click(),
    ]).catch(async (e) => {
      throw new Error(
        `Reference login as ${role} failed (still on ${page.url()}): ${e.message.split('\n')[0]}`,
      );
    });
    await settle(page);
    const state = this.statePath(role);
    await context.storageState({ path: state });
    await context.close();
    return state;
  }

  async apiFor(context) {
    return context.request; // shares the browser session cookies
  }

  /** Laravel needs the CSRF token on every non-GET; this fetches a fresh one from the app itself. */
  async csrf(request) {
    const r = await request.get(this.url('/csrf-token'));
    return (await r.json()).token;
  }

  async xhrHeaders(request) {
    return {
      'X-CSRF-TOKEN': await this.csrf(request),
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json',
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------
export class OursSide extends Side {
  constructor(o) {
    super({ ...o, name: 'ours' });
    this.baseUrl = o.cfg.ours.webUrl || o.cfg.ours.apiUrl;
    this.apiBase = o.cfg.ours.apiUrl;
    this.hasUi = !!o.cfg.ours.webUrl;
    this.logins = new Map();
    this.tokens = new Map();
    this.apiCtx = new Map();
  }

  /** Staff JWT from the API. Needed for API-level scenarios and to seed/clean data without clicking. */
  async token(role = 'admin') {
    const cached = this.tokens.get(role);
    if (cached && Date.now() - cached.at < 9 * 60 * 1000) return cached.accessToken;
    if (!this.tokenInflight) this.tokenInflight = new Map();
    if (!this.tokenInflight.has(role))
      this.tokenInflight.set(
        role,
        this.fetchToken(role).finally(() => this.tokenInflight.delete(role)),
      );
    return this.tokenInflight.get(role);
  }

  async fetchToken(role) {
    const user = this.cfg.ours.users[role];
    if (!user) throw new Error(`no platform user configured for role "${role}" (cfg.ours.users)`);
    const anon = await pwRequest.newContext({ baseURL: this.apiBase });
    const r = await anon.post(this.cfg.ours.apiLoginPath, {
      data: { orgSlug: this.cfg.ours.org, email: user.email, password: user.password },
    });
    if (!r.ok()) {
      const body = await r.text();
      await anon.dispose();
      throw new Error(`platform API login as ${role} failed: ${r.status()} ${body.slice(0, 160)}`);
    }
    const j = await r.json();
    await anon.dispose();
    // docs/api-testing.md shows a flat body; the running API nests it under `tokens`. Accept both.
    const t = j.tokens || j;
    if (!t.accessToken)
      throw new Error(
        `platform API login as ${role} returned no access token (status=${j.status || 'n/a'}); is MFA or a first-login step enabled for this account?`,
      );
    this.tokens.set(role, {
      at: Date.now(),
      accessToken: t.accessToken,
      refreshToken: t.refreshToken,
    });
    return t.accessToken;
  }

  /** Standalone API client with a Bearer token (no browser cookies involved). */
  async api(role = 'admin') {
    const token = await this.token(role);
    const key = `${role}:${token.slice(-12)}`;
    if (!this.apiCtx.has(key)) {
      this.apiCtx.set(
        key,
        await pwRequest.newContext({
          baseURL: this.apiBase,
          extraHTTPHeaders: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        }),
      );
    }
    return this.apiCtx.get(key);
  }

  async apiFor(_context, role) {
    return this.api(role).catch(() => undefined);
  }

  async disposeApis() {
    for (const c of this.apiCtx.values()) await c.dispose().catch(() => {});
    this.apiCtx.clear();
  }

  ensureLogin(role) {
    if (!this.hasUi) return undefined;
    if (!this.logins.has(role))
      this.logins.set(
        role,
        this.doLogin(role).catch((e) => {
          this.logins.delete(role);
          throw e;
        }),
      );
    return this.logins.get(role);
  }

  async doLogin(role) {
    const user = this.cfg.ours.users[role];
    const L = this.cfg.ours.login;
    const context = await this.newContext();
    const page = await context.newPage();
    await page.goto(this.url(L.path), { waitUntil: 'load' });
    await settle(page);
    const pw = page.locator('input[type=password]').first();
    const form = page.locator('form').filter({ has: pw }).first();
    const org = resolveLocator(form, L.org).first();
    if (await org.isVisible().catch(() => false)) await fillVerified(org, this.cfg.ours.org);
    await fillVerified(resolveLocator(form, L.email).first(), user.email);
    await fillVerified(pw, user.password);
    const submit = resolveLocator(form, L.submit).first();
    await Promise.all([
      page.waitForURL((u) => this.cfg.ours.loginOk(u.href), {
        timeout: this.cfg.timeouts.navigation,
      }),
      submit.click(),
    ]).catch((e) => {
      throw new Error(
        `platform web login as ${role} failed (still on ${page.url()}): ${e.message.split('\n')[0]}`,
      );
    });
    await settle(page);
    const state = this.statePath(role);
    await context.storageState({ path: state });
    await context.close();
    return state;
  }
}

/** Self-test only (PARITY_AA=1): "ours" is a second copy of Reference, optionally with planted defects (see mutants.mjs). */
class AliasSide extends ThreadwiseSide {
  constructor(o, mutations) {
    super(o);
    this.name = 'ours';
    this.mutations = mutations;
  }
  async prepareContext(context) {
    await super.prepareContext(context);
    for (const m of this.mutations) await m.install(context);
  }
}

export function createSides({
  cfg,
  browser,
  runDir,
  sides = ['threadwise', 'ours'],
  aa = process.env.PARITY_AA,
  mutations = [],
}) {
  const out = {};
  if (sides.includes('threadwise')) out.threadwise = new ThreadwiseSide({ cfg, browser, runDir });
  if (sides.includes('ours'))
    out.ours = aa
      ? new AliasSide({ cfg, browser, runDir }, mutations)
      : new OursSide({ cfg, browser, runDir });
  return out;
}
