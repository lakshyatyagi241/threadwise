// What a scenario function receives (`c`): one side, one fresh logged-in browser context, helpers that keep
// the observation honest (they count user actions, wait for the app to settle, and never throw on probes).
import { join } from 'node:path';
import { request as pwRequest } from 'playwright';
import { snapshotInPage } from './snapshot.mjs';
import { resolveLocator } from './locate.mjs';
import { settle } from './sides.mjs';
import { ensureDir, slug, writeJson, oneLine, pathTemplate, pick, sha } from './util.mjs';

/** Observation: flat map of namespaced keys. The prefix decides how the comparator treats the key, see diff.mjs. */
export class Obs {
  constructor() {
    this.data = {};
    this.steps = [];
    this.actions = { clicks: 0, fills: 0, keys: 0, navigations: 0 };
    this.notes = [];
  }
  set(key, value) {
    this.data[key] = value;
    return this;
  }
  flag(name, v) {
    return this.set(`flag.${name}`, !!v);
  }
  enum(name, v) {
    return this.set(`enum.${name}`, v == null ? null : String(v));
  }
  num(name, v) {
    return this.set(`num.${name}`, v == null ? null : Number(v));
  }
  list(name, arr) {
    return this.set(`set.${name}`, [...new Set((arr || []).map(String))].sort());
  }
  seq(name, arr) {
    return this.set(`seq.${name}`, (arr || []).map(String));
  }
  status(name, httpStatus) {
    return this.set(`status.${name}`, httpStatus);
  }
  info(name, v) {
    return this.set(`info.${name}`, v);
  }
  note(text) {
    this.notes.push(oneLine(text, 300));
  }
}

export class ScenarioContext {
  constructor({ side, handle, scenario, cfg, runDir, tagBase }) {
    this.side = side.name; // 'threadwise' | 'ours'
    this.sideObj = side;
    this.cfg = cfg;
    this.handle = handle;
    this.page = handle.page;
    this.context = handle.context;
    this.request = handle.request;
    this.rec = handle.rec;
    this.scenario = scenario;
    this.obs = new Obs();
    this.runDir = runDir;
    this.shotsDir = ensureDir(join(runDir, 'shots', slug(scenario.id)));
    this.shots = [];
    this.snapshots = {};
    this.created = []; // tagged data this scenario made; scenarios clean up what they can
    this.lastActionAt = 0;
    this.cleanups = [];
    this.tagBase = tagBase;
    this.sid = sha(scenario.id).slice(0, 4); // keeps data of concurrent scenarios apart
    this.counter = 0;
    this.extraHandles = [];
  }

  /** Unique, greppable test-data value: pwp-<run><w|o>-<scenario hash>-<label>-<n> (w = Reference, o = ours). Lets a human delete leftovers by prefix. */
  tag(label = 'x') {
    this.counter += 1;
    const aa = process.env.PARITY_AA ? (this.side === 'threadwise' ? 'w' : 'o') : ''; // A/A shares one database: keep the sides apart
    return `${this.tagBase}${aa}-${this.sid}-${slug(label).slice(0, 14)}-${this.counter}`;
  }

  /**
   * True only when the record carries THIS run's test-data tag in one of its values. Cleanup must be gated on it: an
   * API that de-duplicates (returns an existing row for a repeated phone/email) would otherwise get a seed row deleted.
   */
  isMine(record) {
    const needle = this.tagBase;
    const seen = (v, depth = 0) =>
      typeof v === 'string'
        ? v.includes(needle)
        : depth < 3 && v && typeof v === 'object'
          ? Object.values(v).some((x) => seen(x, depth + 1))
          : false;
    return seen(record);
  }

  /** DELETE path, but only when `record` is provably something this run created. Returns true when it deleted. */
  async deleteOwned(path, record) {
    if (!this.isMine(record)) {
      this.obs.note(`NOT deleted (not created by this run): ${oneLine(path, 80)}`);
      return false;
    }
    const r = await this.http('DELETE', path);
    return r.ok;
  }

  /** Register something to undo when the scenario ends (even when it fails): delete the row you created. Runs in reverse order. */
  onCleanup(fn) {
    this.cleanups.push(fn);
  }

  async runCleanups() {
    for (const fn of this.cleanups.reverse()) {
      try {
        await fn();
      } catch (e) {
        this.obs.note(`cleanup failed: ${oneLine(e.message, 120)}`);
      }
    }
    this.cleanups = [];
  }

  /**
   * n digits for values that must be unique per scenario (phone numbers). Deterministic for (run, scenario, call number),
   * so Reference and our app receive the SAME value and stored data can be compared; different runs get different numbers.
   */
  digits(n = 8) {
    this.digitCalls = (this.digitCalls || 0) + 1;
    let a =
      parseInt(sha(`${this.tagBase}|${this.scenario.id}|${this.digitCalls}`).slice(0, 8), 16) >>> 0;
    const rnd = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return Array.from({ length: n }, () => Math.floor(rnd() * 10)).join('');
  }

  url(path) {
    return this.sideObj.url(pick(path, this.side));
  }

  /** Navigate; target is a path or {threadwise, ours}. Waits until the page is really done. Returns the response. */
  async goto(target, { ready } = {}) {
    const path = pick(target, this.side);
    if (path == null) throw new Error(`goto: no path for side "${this.side}"`);
    this.obs.actions.navigations += 1;
    const resp = await this.page.goto(this.url(path), { waitUntil: 'load' });
    await settle(this.page, { quiet: this.cfg.timeouts.quiet });
    const r = pick(ready, this.side);
    if (r)
      await this.loc(r)
        .first()
        .waitFor({ state: 'visible', timeout: this.cfg.timeouts.action })
        .catch(() => {});
    return resp;
  }

  /** Locator from a spec (see locate.mjs). A {threadwise, ours} pair picks this side's spec first. */
  loc(spec, root) {
    spec = pick(spec, this.side);
    if (spec == null) throw new Error(`no locator given for side "${this.side}"`);
    return resolveLocator(root || this.page, spec);
  }

  async visible(spec, root, timeout = 0) {
    const l = this.loc(spec, root).first();
    try {
      if (timeout) await l.waitFor({ state: 'visible', timeout });
      return await l.isVisible();
    } catch {
      return false;
    }
  }

  // --- counted user actions (UX friction metric) -------------------------------------------------------------
  async click(spec, opts = {}) {
    this.obs.actions.clicks += 1;
    this.lastActionAt = Date.now();
    const l = typeof spec?.click === 'function' ? spec : this.loc(spec, opts.root);
    await l.first().click({ timeout: opts.timeout, force: opts.force, position: opts.position });
  }
  async fill(spec, value, opts = {}) {
    this.obs.actions.fills += 1;
    this.lastActionAt = Date.now();
    const l = typeof spec?.fill === 'function' ? spec : this.loc(spec, opts.root);
    await l.first().fill(String(value), { timeout: opts.timeout });
  }
  async press(key) {
    this.obs.actions.keys += 1;
    this.lastActionAt = Date.now();
    await this.page.keyboard.press(key);
  }

  /** API call on this side, recorded like browser traffic. Reference gets CSRF + XHR headers automatically on writes. */
  async http(method, path, { data, form, multipart, headers = {}, query, anonymous = false } = {}) {
    const t0 = Date.now();
    const base = this.sideObj.apiBase || this.sideObj.baseUrl;
    const laravel = typeof this.sideObj.xhrHeaders === 'function'; // Reference: CSRF token + XHR headers on writes
    const url = /^https?:/.test(path)
      ? path
      : base.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path);
    const h = { ...headers };
    if (laravel && method.toUpperCase() !== 'GET')
      Object.assign(h, await this.sideObj.xhrHeaders(this.request), headers);
    else if (laravel)
      Object.assign(
        h,
        { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        headers,
      );
    let anon;
    if (anonymous)
      anon = await pwRequest.newContext({
        extraHTTPHeaders: laravel
          ? { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
          : { Accept: 'application/json' },
      });
    const client = anon || this.request;
    if (anonymous)
      for (const k of Object.keys(h)) if (/^(authorization|x-csrf-token)$/i.test(k)) delete h[k];
    const r = await client.fetch(url, {
      method: method.toUpperCase(),
      headers: h,
      data,
      form,
      multipart,
      params: query,
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    const status = r.status();
    const text = await r.text().catch(() => '');
    if (anon) await anon.dispose();
    let body = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    this.rec.events.http.push({
      at: Date.now() - this.rec.t0,
      method: method.toUpperCase(),
      path: pathTemplate(url, this.sideObj.origin()),
      status,
      type: 'fetch',
      redirected: false,
    });
    return {
      status,
      ok: status >= 200 && status < 400,
      headers: r.headers(),
      body,
      text,
      ms: Date.now() - t0,
      location: r.headers().location,
    };
  }

  async quiet(ms) {
    await settle(this.page, { quiet: ms ?? this.cfg.timeouts.quiet });
  }

  /** Wait for the app to finish reacting to the last click/keypress (request, navigation, re-render). */
  async afterAction({ quiet, timeout } = {}) {
    await settle(this.page, {
      quiet: quiet ?? this.cfg.timeouts.quiet,
      timeout: timeout ?? 8000,
      since: this.lastActionAt,
    });
  }

  /** Run a named step; on failure it records which step broke and rethrows (the runner turns that into a finding). */
  async step(name, fn) {
    const t0 = Date.now();
    try {
      const v = await fn();
      this.obs.steps.push({ name, ok: true, ms: Date.now() - t0 });
      return v;
    } catch (e) {
      this.obs.steps.push({ name, ok: false, ms: Date.now() - t0, error: oneLine(e.message, 200) });
      e.step = name;
      throw e;
    }
  }

  async snap(label = 'page') {
    const s = await this.page
      .evaluate(snapshotInPage)
      .catch((e) => ({ error: oneLine(e.message) }));
    this.snapshots[label] = s;
    return s;
  }

  async shot(label = 'page', { fullPage = false } = {}) {
    const file = join(this.shotsDir, `${this.side}-${slug(label)}.png`);
    await this.page.screenshot({ path: file, fullPage }).catch(() => {});
    this.shots.push({ label, side: this.side, file });
    return file;
  }

  /** Extra isolated context (other viewport, other role, logged out). Closed by the runner. */
  async openAlso(opts) {
    const h = await this.sideObj.open(opts);
    this.extraHandles.push(h);
    return h;
  }

  /** Fail the next matching request(s) on this page/context. mode: 500 | 'abort' | {delay:ms} | {status:n}. Returns a disposer. */
  async failRequests(match, mode = 500, { times = Infinity } = {}) {
    let n = 0;
    const handler = async (route) => {
      const req = route.request();
      if (n >= times || !match(req)) return route.fallback();
      n += 1;
      if (mode === 'abort') return route.abort('failed');
      if (mode && typeof mode === 'object' && mode.delay) {
        await new Promise((r) => setTimeout(r, mode.delay));
        return route.fallback();
      }
      const status = typeof mode === 'number' ? mode : mode?.status || 500;
      const json =
        /json/.test(req.headers().accept || '') || ['xhr', 'fetch'].includes(req.resourceType());
      return route.fulfill({
        status,
        contentType: json ? 'application/json' : 'text/html',
        body: json
          ? JSON.stringify({ error: 'injected failure', status })
          : '<h1>injected failure</h1>',
      });
    };
    await this.context.route('**/*', handler);
    return async () => this.context.unroute('**/*', handler).catch(() => {});
  }

  /** The state worth keeping as evidence: snapshots + recorder summary, small and JSON-safe. */
  evidence() {
    return {
      snapshots: this.snapshots,
      recorder: this.rec.summary(),
      http: this.rec.events.http.slice(-40),
      console: this.rec.events.console.slice(-20),
      pageErrors: this.rec.events.pageErrors.slice(-10),
      dialogs: this.rec.events.dialogs.slice(-10),
      shots: this.shots,
    };
  }

  save(name, data) {
    writeJson(join(this.shotsDir, `${this.side}-${slug(name)}.json`), data);
  }
}

export { pathTemplate };
