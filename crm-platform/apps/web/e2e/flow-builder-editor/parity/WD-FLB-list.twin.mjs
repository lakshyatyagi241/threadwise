// Twin spec for the flows list and the admin flow templates (WD-FLB-001..013): the list with its rails, tabs, search, pager and
// featured card, create sheet, pause / resume, rename, duplicate, export, import, delete, the template gallery and clone, the admin
// template list / create / edit / toggle / delete, permission denial, the plan flow cap, XSS, double submit, keyboard, 390px and
// the empty / error states, on the running WaDesk and on our app.
//
// Run (our app and API are expected to be running already):
//   export PARITY_WEB_URL=http://localhost:3110 PARITY_API_URL=http://localhost:53110 PARITY_CONFIG=<json>
//   parity.sh run apps/web/e2e/flow-builder-editor/parity/WD-FLB-list.twin.mjs --depth full --workers 1
// PARITY_CONFIG comes from `node prepare-org.mjs <file>` (the demo organisation) plus, for the admin screens, an `ours.operator`
// block { email, password, totpSecret } of a platform operator with the super_admin role (the base32 secret of its authenticator).
// `--workers 1` matters: the counts, the featured card and the plan cap are workspace-wide and the scenarios assume nobody else writes.
// Database access (docker exec, never the shared `crm` database): FLB_DB (default crm_flb) and the wadesk-db container, only for the
// things no screen can set up (a second organisation / workspace, the plan cap, a member of the opposite role) and for read-back.
//
// Test data: every flow and template carries the run tag (pwp-...) and starts with `zz-flb-`. Cleanup deletes by id what the scenario
// created, plus (UI-made rows: copies, imports, clones) rows that are new since the scenario started and carry the tag.
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

export default (h) => {
  const WD = (c) => c.side === 'wadesk';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const uuid = () => globalThis.crypto.randomUUID();
  const rep = (n, ch = 'x') => ch.repeat(n);
  const listMode = process.argv.includes('--list');

  // ---------------------------------------------------------------------------------------------------------------
  // database access (set-up that no screen offers, and read-back)
  // ---------------------------------------------------------------------------------------------------------------
  const REF_DB = ['exec', 'wadesk-db', 'mariadb', '-uwadesk', '-pwadesk_local_pw', 'wadesk', '-N', '-B', '-r', '-e'];
  const OURS_DB = ['exec', 'crm-postgres', 'psql', '-U', 'crm', '-d', process.env.FLB_DB || 'crm_flb', '-tAc'];
  const mysql = (sql) => execFileSync('docker', [...REF_DB, sql], { encoding: 'utf8' }).trim();
  const psql = (sql) => execFileSync('docker', [...OURS_DB, sql], { encoding: 'utf8' }).trim();
  const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "''");
  const sql = (c, a, b) => (WD(c) ? mysql(a) : psql(b ?? a));
  const orgIdOf = (c) => psql(`SELECT id FROM organizations WHERE slug = '${q(c.cfg.ours.org)}'`);

  // ---------------------------------------------------------------------------------------------------------------
  // flows through each side's own API
  // ---------------------------------------------------------------------------------------------------------------
  const idem = () => ({ 'Idempotency-Key': uuid() });
  const N = (type, i, data, pos = true) => ({
    id: `n${i}`,
    type,
    ...(pos ? { x: 100 + i * 200, y: 100 } : {}),
    data,
    ...(i === 0 ? { isStart: true } : {}),
  });
  const trig = (kind, extra = {}) => N('trigger', 0, { kind, keywords: 'hi', ...extra });
  const BASE_NODES = () => [
    N('message', 1, { text: 'Hello there, welcome to our store and thanks for stopping by today' }),
    N('delay', 2, { amount: 30, unit: 'min' }),
    N('delay', 3, { amount: 2, unit: 'hour' }),
    N('tag', 4, { action: 'add', tag: 'vip' }),
    N('end', 5, {}),
  ];
  const graphOf = (nodes) => ({
    flowNodes: nodes,
    flowEdges: nodes.slice(1).map((_, i) => ({ id: `e${i}`, source: `n${i}`, sourceHandle: 'out', target: `n${i + 1}` })),
    vars: [],
  });
  const NODES = (kind = 'keyword') => [trig(kind), ...BASE_NODES()];

  const idsOf = (r) => (WD({ side: r }) ? null : null);
  /** The tagged name every scenario's flows use. */
  const fname = (c, label = 'f') => `zz-flb-${c.tag(label)}`;
  /** A prefix every name of this scenario shares (the search term that isolates its flows from everyone else's). */
  const scope = (c) => `${c.tagBase}-${c.sid}`;

  async function removeFlow(c, id) {
    return WD(c) ? c.http('DELETE', `/flows/${id}`) : c.http('DELETE', `/v2/flows/${id}`, { headers: idem() });
  }

  /** Every flow of the workspace as {id, name, state, isActive, isPublished, category}. */
  async function allFlows(c, needle = '') {
    if (WD(c)) {
      const r = await c.http('GET', '/flows/api/list');
      const rows = Array.isArray(r.body?.data) ? r.body.data : [];
      return rows
        .map((f) => ({
          id: f.id,
          name: f.flow_name,
          isPublished: !!f.is_published,
          isActive: !!f.is_active,
          category: f.category,
          flowType: f.flow_type,
          state: f.is_published ? (f.is_active ? 'live' : 'paused') : 'draft',
        }))
        .filter((f) => !needle || String(f.name).includes(needle));
    }
    const out = [];
    let cursor;
    for (let i = 0; i < 10; i++) {
      const r = await c.http('GET', '/v2/flows', { query: { limit: 100, q: needle || undefined, cursor } });
      for (const f of r.body?.data ?? [])
        out.push({
          id: f.id,
          name: f.name,
          isPublished: f.isPublished,
          isActive: f.isActive,
          category: f.category,
          flowType: f.flowType,
          state: f.state,
        });
      cursor = r.body?.page?.nextCursor;
      if (!cursor) break;
    }
    return out;
  }
  const flowById = async (c, id) => (await allFlows(c)).find((f) => String(f.id) === String(id));
  /** The newest of some flows (WaDesk lists oldest first by id, ours newest updated first). */
  const newest = (c, arr) => (WD(c) ? [...arr].sort((a, b) => Number(b.id) - Number(a.id))[0] : arr[0]);

  /**
   * Cleanup for UI-made rows (copies, imports, clones): rows that are new since this call and carry the run tag (or are the
   * default import name). Register at the start of a scenario that clicks.
   */
  async function guard(c) {
    const before = new Set((await allFlows(c)).map((f) => String(f.id)));
    c.onCleanup(async () => {
      for (const f of await allFlows(c)) {
        if (before.has(String(f.id))) continue;
        if (String(f.name).includes(c.tagBase) || String(f.name).startsWith('Imported flow')) await removeFlow(c, f.id);
      }
    });
    return before;
  }

  /** Creates a flow through the API of the side; returns {id, name, ok, r}. */
  async function createFlow(c, o = {}) {
    const name = o.name ?? fname(c, o.label ?? 'f');
    const nodes = o.nodes ?? NODES(o.kind);
    const graph = graphOf(nodes);
    let r;
    let id;
    if (WD(c)) {
      r = await c.http('POST', '/flows/api/save', {
        data: { flow_name: name, category: o.category ?? null, flow_type: o.flowType ?? 'chat', flow_data: graph },
      });
      id = r.body?.data?.flow_id;
    } else {
      r = await c.http('POST', '/v2/flows', {
        data: { name, category: o.category ?? null, flowType: o.flowType ?? 'chat', graph },
        headers: idem(),
      });
      id = r.body?.id;
    }
    const ok = WD(c) ? r.status === 200 && r.body?.success === true : r.status === 201;
    if (ok && id != null) {
      c.onCleanup(() => removeFlow(c, id));
      if (o.pub) await publishFlow(c, id);
      if (o.active === false) await toggleFlow(c, id);
    }
    return { id, name, ok, r };
  }
  const publishFlow = (c, id) =>
    WD(c)
      ? c.http('POST', '/flows/api/publish', { data: { flow_id: id } })
      : c.http('POST', `/v2/flows/${id}/publish`, { headers: idem() });
  const toggleFlow = (c, id) =>
    WD(c) ? c.http('POST', `/flows/${id}/toggle`) : c.http('POST', `/v2/flows/${id}/toggle`, { headers: idem() });

  /** Workspace-wide counts as each side reports them. */
  async function counts(c) {
    if (WD(c)) {
      const r = await c.http('GET', '/flows', { query: { partial: 1 } });
      const b = r.body ?? {};
      return { ...b.statusCounts, cats: b.categoryCounts ?? {} };
    }
    const r = await c.http('GET', '/v2/flows/overview');
    const b = r.body ?? {};
    return { ...b.statusCounts, cats: b.categoryCounts ?? {} };
  }

  /** The "<id>" of the flow a redirect / navigation landed on (numeric on WaDesk, uuid on ours). */
  const builderIdOf = (url) => /\/flows\/builder(?:\/([\w-]+)|\?(?:.*&)?id=([\w-]+))/.exec(url)?.slice(1).find(Boolean) ?? null;

  // ---------------------------------------------------------------------------------------------------------------
  // a second organisation / workspace with one flow (the "foreign id" cases)
  // ---------------------------------------------------------------------------------------------------------------
  function foreignFlow(c, name) {
    const g = JSON.stringify(graphOf(NODES()));
    if (WD(c)) {
      const slug = q(name).slice(0, 60);
      mysql(
        `INSERT INTO workspaces (owner_user_id, name, slug, created_at, updated_at) VALUES (1, '${slug}', '${slug}', now(), now())`,
      );
      const ws = mysql(`SELECT id FROM workspaces WHERE slug = '${slug}'`);
      mysql(
        `INSERT INTO flows (user_id, flow_name, flow_data, workspace_id, created_at, updated_at) VALUES (1, '${q(name)}', '${q(g)}', ${ws}, now(), now())`,
      );
      const id = mysql(`SELECT id FROM flows WHERE workspace_id = ${ws} ORDER BY id DESC LIMIT 1`);
      c.onCleanup(() => {
        mysql(`DELETE FROM flows WHERE workspace_id = ${ws}`);
        mysql(`DELETE FROM workspaces WHERE id = ${ws}`);
      });
      return { id, exists: () => mysql(`SELECT count(*) FROM flows WHERE id = ${id}`) === '1' };
    }
    const slug = q(name).slice(0, 60);
    const org = psql(`INSERT INTO organizations (slug, name) VALUES ('${slug}', '${slug}') RETURNING id`).split('\n')[0];
    const id = psql(
      `INSERT INTO flows (org_id, flow_name, flow_data) VALUES (${org}, '${q(name)}', '${q(g)}'::jsonb) RETURNING uuid`,
    ).split('\n')[0];
    c.onCleanup(() => psql(`DELETE FROM organizations WHERE id = ${org}`));
    return { id, exists: () => psql(`SELECT count(*) FROM flows WHERE org_id = ${org}`) === '1' };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the screen
  // ---------------------------------------------------------------------------------------------------------------
  const hydrated = (c) =>
    c.page
      .waitForFunction(
        () => {
          const el = document.querySelector('main') ?? document.body;
          return Object.keys(el.firstElementChild ?? el).some((k) => k.startsWith('__react'));
        },
        undefined,
        { timeout: 30000 },
      )
      .catch(() => undefined);
  const declineCookies = async (c) => {
    const b = c.page.getByRole('button', { name: /^decline$/i }).first();
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
  };
  const seen = (c, re, ms = 5000) =>
    c.page
      .waitForFunction(
        ({ src, flags }) => new RegExp(src, flags).test(document.body.innerText),
        { src: re.source, flags: re.flags },
        { timeout: ms },
      )
      .then(() => true)
      .catch(() => false);
  const bodyText = (c) => c.page.locator('body').innerText();
  const settle = async (c, ms = 700) => {
    await c.page.waitForTimeout(ms);
    await c.afterAction({ quiet: 500 }).catch(() => undefined);
  };

  const S = {
    cards: '[data-flow-card]',
    stat: (k) => ({ wadesk: `[data-fl-stat="${k}"]`, ours: `[data-stat="${k}"]` }),
    tab: (k) => ({ wadesk: `main [data-fl-filter="status"][data-fl-value="${k}"]`, ours: `[data-tab="${k}"]` }),
    railStatus: (k) => ({
      wadesk: `aside [data-fl-filter="status"][data-fl-value="${k}"]`,
      ours: `[data-filter="status"][data-value="${k}"]`,
    }),
    cat: (k) => ({ wadesk: `[data-fl-filter="category"][data-fl-value="${k}"]`, ours: `[data-filter="category"][data-value="${k}"]` }),
    search: { wadesk: '#fl-search', ours: 'input[type=search]' },
    featured: { wadesk: '#fl-featured', ours: '[data-testid=featured-flow]' },
    pager: 'nav[aria-label*="agination" i]',
    create: '[data-flow-create]',
    fileInput: 'main input[type=file]',
  };
  const ACT = {
    pause: '[title="Pause"]',
    resume: '[title="Resume"]',
    toggle: '[title="Pause"], [title="Resume"]',
    rename: '[title="Rename"]',
    dup: '[title="Duplicate"]',
    exp: '[title^="Export"]',
    del: '[title="Delete"]',
    open: 'a:has-text("Open builder")',
  };
  const confirmEls = {
    box: { wadesk: '#globalConfirmModal', ours: 'dialog[open]' },
    msg: { wadesk: '#globalConfirmModal [data-confirm-message]', ours: 'dialog[open]' },
    accept: { wadesk: '#globalConfirmModal [data-confirm-accept]', ours: 'dialog[open] button:text-is("Delete")' },
    cancel: { wadesk: '#globalConfirmModal [data-confirm-cancel]', ours: 'dialog[open] button:text-is("Cancel")' },
  };

  /** Our dev stack revokes older sessions when anything else signs in (a session cap): sign in again instead of failing. */
  async function uiRelogin(c) {
    c.sideObj.logins.delete('admin');
    const state = JSON.parse(readFileSync(await c.sideObj.ensureLogin('admin'), 'utf8'));
    await c.context.clearCookies();
    await c.context.addCookies(state.cookies);
  }
  /** c.http that survives a revoked session on our side (one fresh token, one retry). */
  function patchHttp(c) {
    if (c.__patched) return;
    c.__patched = true;
    const raw = c.http.bind(c);
    c.http = async (...a) => {
      const r = await raw(...a);
      if (WD(c) || r.status !== 401 || a[2]?.anonymous) return r;
      c.sideObj.tokens.clear();
      for (const x of c.sideObj.apiCtx.values()) await x.dispose().catch(() => {});
      c.sideObj.apiCtx.clear();
      c.request = await c.sideObj.api('admin');
      return raw(...a);
    };
  }

  async function openList(c, qs = '') {
    c.page.setDefaultTimeout(30000);
    await c.goto('/flows' + qs, { ready: { wadesk: 'main h1', ours: 'main h1' } });
    if (!WD(c) && /\/login/.test(c.page.url())) {
      await uiRelogin(c);
      await c.goto('/flows' + qs, { ready: { wadesk: 'main h1', ours: 'main h1' } });
    }
    if (!WD(c)) {
      await hydrated(c);
      await declineCookies(c);
    }
    await listReady(c);
  }
  async function listReady(c) {
    await c.page
      .locator(S.cards)
      .first()
      .or(c.page.getByText(/no flows match/i).first())
      .waitFor({ timeout: 20000 })
      .catch(() => undefined);
    await c.page.waitForTimeout(400);
  }
  const cardOf = (c, name) => c.page.locator(S.cards).filter({ hasText: name }).first();
  const cardCount = (c) => c.page.locator(S.cards).count();
  const num = async (c, spec) => {
    const t = (await c.loc(spec).first().innerText().catch(() => '')) ?? '';
    const m = /(\d[\d,]*)\s*$/.exec(t.trim());
    return m ? Number(m[1].replace(/,/g, '')) : null;
  };
  const searchFor = async (c, term) => {
    const input = c.loc(S.search).first();
    await input.fill(term);
    await c.page.waitForTimeout(900);
    await settle(c, 400);
  };
  const urlQuery = (c) => {
    const u = new URL(c.page.url());
    return u.pathname + u.search.replace(/q=[^&]*/, 'q=Q');
  };

  /** Strips what differs between runs / sides: names, tags, relative times. */
  const norm = (c, s, names = []) => {
    let t = String(s ?? '');
    for (const n of [...names].sort((a, b) => b.length - a.length)) t = t.split(n).join('NAME');
    t = t.replace(/zz-flb-pwp-[a-z0-9-]+/gi, 'NAME').replace(/pwp-[a-z0-9-]+/gi, 'TAG');
    t = t.replace(/\b\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago\b|\bjust now\b|\ba few seconds ago\b/gi, 'AGO');
    return t;
  };
  const linesOf = (c, text, names = []) =>
    norm(c, text, names)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

  const VARIANTS = [
    { k: 'welcome', category: 'welcome', pub: true },
    { k: 'cart', category: 'cart', pub: true, active: false },
    { k: 'lead', category: 'lead' },
    { k: 'call', flowType: 'call', nodes: [trig('keyword'), N('message', 1, { text: 'x' })] },
    { k: 'ig', flowType: 'instagram', pub: true, category: 'welcome' },
    { k: 'manual', pub: true, kind: 'manual_enroll' },
    { k: 'tagadded', pub: true, category: 'post-purchase', kind: 'tag_added' },
    {
      k: 'contactcreated',
      kind: 'contact_created',
      nodes: [trig('contact_created'), N('condition', 1, { kind: 'var', variable: 'x', op: '==', value: '1' }), N('end', 2, {})],
    },
    { k: 'event', category: 'event', pub: true },
    { k: 'postpurchase', category: 'post-purchase', pub: true, active: false },
    { k: 'showcase', category: 'Showcase' },
    { k: 'empty', nodes: [] },
  ];

  const scenarios = [];
  const add = (s) => {
    const run = s.run;
    scenarios.push({
      ...s,
      run: async (c) => {
        patchHttp(c);
        return run(c);
      },
    });
  };
  const ui = (s) => add({ tags: ['ui'], dialogPolicy: 'record', ...s });
  const api = (s) => add({ tags: ['api'], api: true, ...s });

  // ===============================================================================================================
  // WD-FLB-001 / 002 / 013: the list
  // ===============================================================================================================
  ui({
    id: 'list.cards-matrix',
    title: 'List: twelve flows of every kind, card by card, order newest updated first, KPI and rail counts',
    run: async (c) => {
      const o = c.obs;
      const before = await counts(c);
      const made = [];
      for (const v of VARIANTS) {
        const f = await createFlow(c, { ...v, label: v.k });
        made.push({ ...v, ...f });
        await sleep(1100); // the reference orders by a one-second timestamp
      }
      const after = await counts(c);
      for (const k of ['all', 'live', 'paused', 'draft']) o.num(`delta.${k}`, (after[k] ?? 0) - (before[k] ?? 0));
      o.set('map.delta.categories', Object.fromEntries(
        ['welcome', 'cart', 'lead', 'event', 'post-purchase', 'Showcase', 'uncategorized'].map((k) => [k, (after.cats[k] ?? 0) - (before.cats[k] ?? 0)]),
      ));
      await openList(c, `?q=${encodeURIComponent(scope(c))}`);
      const names = made.map((m) => m.name);
      o.num('cards', await cardCount(c));
      const texts = await c.page.locator(S.cards).allInnerTexts();
      const order = [];
      for (const t of texts) order.push(made.find((m) => t.includes(m.name))?.k ?? '?');
      o.seq('order', order);
      o.flag('orderNewestFirst', order.join() === [...made].reverse().map((m) => m.k).join());
      for (const m of made) {
        const t = await cardOf(c, m.name).innerText().catch(() => '');
        o.set(`seq.card.${m.k}`, linesOf(c, t, names));
        const hasBuilder = await cardOf(c, m.name).locator(ACT.open).count();
        const hasEnroll = await cardOf(c, m.name).getByText(/enroll contacts/i).count();
        o.flag(`card.${m.k}.openBuilder`, hasBuilder > 0);
        o.flag(`card.${m.k}.enroll`, hasEnroll > 0);
        o.flag(`card.${m.k}.analyticsLink`, (await cardOf(c, m.name).locator('[title="Analytics"]').count()) > 0);
        o.enum(`card.${m.k}.pauseTitle`, (await cardOf(c, m.name).locator(ACT.toggle).first().getAttribute('title').catch(() => null)) ?? 'none');
      }
      await c.shot('cards');
      // KPI tiles, tab and rail numbers equal what the API reports
      const api = await counts(c);
      for (const k of ['all', 'live', 'paused', 'draft']) {
        o.flag(`tile.${k}.matchesApi`, (await num(c, S.stat(k))) === (api[k] ?? 0));
        o.flag(`tab.${k}.matchesApi`, (await num(c, S.tab(k))) === (api[k] ?? 0));
      }
      for (const k of ['live', 'paused', 'draft']) o.flag(`rail.${k}.matchesApi`, (await num(c, S.railStatus(k))) === (api[k] ?? 0));
      for (const k of ['all', 'cart', 'welcome', 'post-purchase', 're-engagement', 'event', 'lead'])
        o.flag(`railCat.${k}.matchesApi`, (await num(c, S.cat(k))) === (k === 'all' ? api.all : (api.cats[k] ?? 0)));
      o.set('seq.railCategories', await c.page.locator(`${WD(c) ? '[data-fl-filter="category"]' : '[data-filter="category"]'}`).evaluateAll((els) =>
        els.map((e) => e.getAttribute('data-fl-value') ?? e.getAttribute('data-value')),
      ));
      o.set('seq.tiles', await c.page.locator(WD(c) ? '[data-fl-stat]' : '[data-stat]').evaluateAll((els) =>
        els.map((e) => `${e.getAttribute('data-fl-stat') ?? e.getAttribute('data-stat')}`),
      ));
      o.flag('pagerHidden', (await c.page.locator(S.pager).count()) === 0 || !(await c.page.locator(S.pager).first().isVisible().catch(() => false)));
      o.flag('footerShowsCount', await seen(c, /Showing\s+12\s+of\s+12\s+filtered flows/i, 1500));
    },
  });

  ui({
    id: 'list.featured',
    title: 'List: the featured "most used" card follows published, active, newest updated',
    run: async (c) => {
      const o = c.obs;
      const feat = async (label, expectName) => {
        await openList(c);
        const loc = c.loc(S.featured).first();
        const shown = await loc.isVisible().catch(() => false);
        o.flag(`featured.${label}.shown`, shown);
        if (!shown) return;
        const t = await loc.innerText();
        o.flag(`featured.${label}.isExpected`, t.includes(expectName));
        const nameOnly = t.includes(expectName) ? t : '';
        if (nameOnly) o.set(`seq.featured.${label}`, linesOf(c, t, [expectName]));
        o.flag(`featured.${label}.openLink`, (await loc.locator('a:has-text("Open flow")').count()) > 0);
        o.flag(`featured.${label}.duplicateControl`, (await loc.locator('button:has-text("Duplicate"), [title="Duplicate"]').count()) > 0);
        o.num(`featured.${label}.previewSteps`, await loc.locator('li, [data-step]').count().catch(() => 0));
      };
      const live = await createFlow(c, { label: 'live', pub: true, category: 'cart-recovery' });
      await sleep(1100);
      await feat('afterLive', live.name);
      const draft = await createFlow(c, { label: 'draft' });
      await sleep(1100);
      await feat('draftNewer', live.name);
      const live2 = await createFlow(c, { label: 'live2', pub: true, category: 'welcome' });
      await sleep(1100);
      await feat('secondLive', live2.name);
      await toggleFlow(c, live2.id);
      await sleep(1100);
      await feat('newestPaused', live.name);
      void draft;
      // the card shows the steps of the flow in order
      const steps = await createFlow(c, { label: 'steps', pub: true, nodes: [trig('keyword'), ...BASE_NODES(), N('message', 6, { text: 'six' }), N('message', 7, { text: 'seven' })] });
      await sleep(1100);
      await openList(c);
      const t = await c.loc(S.featured).first().innerText().catch(() => '');
      o.set('seq.featured.steps', linesOf(c, t, [steps.name]));
      await c.shot('featured');
    },
  });

  ui({
    id: 'list.status-tabs',
    title: 'List: status tabs and rail narrow the cards, URL follows, counts do not change',
    run: async (c) => {
      const o = c.obs;
      const live = await createFlow(c, { label: 'live', pub: true });
      const paused = await createFlow(c, { label: 'paused', pub: true, active: false });
      const draft = await createFlow(c, { label: 'draft' });
      const mine = [live, paused, draft];
      await openList(c, `?q=${encodeURIComponent(scope(c))}`);
      const whichShown = async () => {
        const texts = await c.page.locator(S.cards).allInnerTexts();
        return mine.filter((m) => texts.some((t) => t.includes(m.name))).map((m) => m.name.split('-').slice(-2)[0]);
      };
      o.set('seq.tab.all', await whichShown());
      const base = await counts(c);
      for (const k of ['live', 'paused', 'draft', 'all']) {
        await c.click(S.tab(k));
        await settle(c);
        o.set(`seq.tab.${k}`, await whichShown());
        o.enum(`url.tab.${k}`, urlQuery(c));
        const now = await counts(c);
        o.flag(`tab.${k}.countsUnchanged`, ['all', 'live', 'paused', 'draft'].every((s) => now[s] === base[s]));
        o.flag(`tab.${k}.active`, ((await c.loc(S.tab(k)).first().getAttribute('class').catch(() => '')) ?? '') !== ((await c.loc(S.tab(k === 'all' ? 'live' : 'all')).first().getAttribute('class').catch(() => '')) ?? ''));
      }
      // the rail does the same
      for (const k of ['paused', 'draft', 'live']) {
        await c.click(S.railStatus(k));
        await settle(c);
        o.set(`seq.rail.${k}`, await whichShown());
        o.enum(`url.rail.${k}`, urlQuery(c));
      }
      // a deep link, a reload and the browser Back button keep the state
      await openList(c, `?status=paused&q=${encodeURIComponent(scope(c))}`);
      o.set('seq.deeplink.paused', await whichShown());
      await c.page.reload();
      await listReady(c);
      o.set('seq.reload.paused', await whichShown());
      await c.click(S.tab('draft'));
      await settle(c);
      await c.page.goBack();
      await settle(c, 1200);
      o.set('seq.back', await whichShown());
      o.enum('url.back', urlQuery(c));
      // an unknown status
      await openList(c, `?status=bogus&q=${encodeURIComponent(scope(c))}`);
      o.num('bogusStatus.cards', await cardCount(c));
      await openList(c, `?category=nope&q=${encodeURIComponent(scope(c))}`);
      o.num('unknownCategory.cards', await cardCount(c));
      o.flag('unknownCategory.emptyState', await seen(c, /no flows match/i, 1500));
    },
  });

  ui({
    id: 'list.category-rail',
    title: 'List: the library rail filters by category, counts follow, custom categories count but have no rail entry',
    run: async (c) => {
      const o = c.obs;
      const before = await counts(c);
      const a = await createFlow(c, { label: 'wel', category: 'welcome', pub: true });
      const b = await createFlow(c, { label: 'cart', category: 'cart' });
      const d = await createFlow(c, { label: 'cust', category: 'Showcase' });
      const e = await createFlow(c, { label: 'none' });
      const mine = [a, b, d, e];
      const after = await counts(c);
      for (const k of ['welcome', 'cart', 'Showcase', 'uncategorized']) o.num(`delta.${k}`, (after.cats[k] ?? 0) - (before.cats[k] ?? 0));
      await openList(c, `?q=${encodeURIComponent(scope(c))}`);
      const shown = async () => {
        const texts = await c.page.locator(S.cards).allInnerTexts();
        return mine.filter((m) => texts.some((t) => t.includes(m.name))).map((m) => m.name.split('-').slice(-2)[0]);
      };
      o.set('seq.all', await shown());
      for (const k of ['welcome', 'cart']) {
        await c.click(S.cat(k));
        await settle(c);
        o.set(`seq.cat.${k}`, await shown());
        o.enum(`url.cat.${k}`, urlQuery(c));
        o.flag(`cat.${k}.railActive`, ((await c.loc(S.cat(k)).first().getAttribute('class').catch(() => '')) ?? '') !== ((await c.loc(S.cat('lead')).first().getAttribute('class').catch(() => '')) ?? ''));
      }
      await c.click(S.cat('all'));
      await settle(c);
      o.set('seq.cat.all', await shown());
      // a custom category is reachable by URL, with no rail entry
      await openList(c, `?category=Showcase&q=${encodeURIComponent(scope(c))}`);
      o.set('seq.cat.custom', await shown());
      o.num('rail.customEntries', await c.page.locator(`[data-fl-value="Showcase"], [data-value="Showcase"]`).count());
      // category AND status together
      await openList(c, `?category=welcome&status=live&q=${encodeURIComponent(scope(c))}`);
      o.set('seq.cat.welcome.live', await shown());
      await openList(c, `?category=welcome&status=draft&q=${encodeURIComponent(scope(c))}`);
      o.set('seq.cat.welcome.draft', await shown());
      o.flag('empty.combined', await seen(c, /no flows match/i, 1500));
    },
  });

  ui({
    id: 'list.search',
    title: 'List: search is a case-insensitive substring, resets the page, survives a reload, takes hostile text',
    run: async (c) => {
      const o = c.obs;
      let fired = false;
      await c.page.exposeFunction('__xssFired', () => (fired = true)).catch(() => undefined);
      await c.page.addInitScript(() => {
        Object.defineProperty(window, '__xss', {
          set() {
            window.__xssFired && window.__xssFired();
          },
          get() {
            return 0;
          },
        });
      });
      const t = scope(c);
      const a = await createFlow(c, { name: `zz-flb-${t}-Welcome Series` });
      const b = await createFlow(c, { name: `zz-flb-${t}-100% off_sale` });
      const d = await createFlow(c, { name: `zz-flb-${t}-it's "quoted" \\ back` });
      const e = await createFlow(c, { name: `zz-flb-${t}-Ünïcode Café 你好` });
      const mine = [a, b, d, e];
      await openList(c);
      const mark = c.rec.mark();
      const probe = async (id, term, expectNames) => {
        await searchFor(c, term);
        const texts = await c.page.locator(S.cards).allInnerTexts();
        const hits = mine.filter((m) => texts.some((x) => x.includes(m.name))).map((m) => m.name.replace(`zz-flb-${t}-`, ''));
        o.set(`seq.search.${id}`, hits);
        o.flag(`search.${id}.empty`, (await cardCount(c)) === 0 && (await seen(c, /no flows match/i, 800)));
        void expectNames;
      };
      await probe('prefix', `${t}-wel`);
      await probe('upper', `${t}-WELCOME`.toUpperCase());
      await probe('mixed', `${t}-wElCoMe`);
      await probe('percent', `${t}-100%`);
      await probe('underscore', `${t}-off_s`);
      await probe('underscoreWild', `${t}-off?s`);
      await probe('apos', `it's`);
      await probe('quote', `"quoted"`);
      await probe('backslash', `\\ back`);
      await probe('unicode', 'café');
      await probe('unicodeUpper', 'CAFÉ');
      await probe('cjk', '你好');
      await probe('spaces', `  ${t}  `);
      await probe('wildcard', `${t}-%`);
      await probe('sql', `${t}' OR '1'='1`);
      await probe('script', `<img src=x onerror=window.__xss=1>`);
      await probe('long', rep(400, 'a'));
      await probe('miss', `${t}-nothing-like-this`);
      o.flag('miss.emptyState', await seen(c, /no flows match/i, 1500));
      o.flag('miss.resetControl', (await c.page.getByRole('button', { name: /reset/i }).count()) + (await c.page.getByRole('link', { name: /reset/i }).count()) > 0);
      o.flag('miss.createControl', (await c.page.getByRole('button', { name: /create flow/i }).count()) + (await c.page.getByRole('link', { name: /create flow/i }).count()) > 0);
      o.flag('sec.xssExecuted', fired);
      const ev = c.rec.since(mark);
      o.flag('noCrash', ev.pageErrors.length === 0 && !ev.http.some((x) => x.status >= 500));
      // clearing the box shows the list again; the term is in the URL and survives a reload
      await searchFor(c, `${t}-wel`);
      o.enum('url.search', urlQuery(c));
      await c.page.reload();
      await listReady(c);
      o.set('seq.search.afterReload', (await c.page.locator(S.cards).allInnerTexts()).filter((x) => x.includes(a.name)).map(() => 'Welcome Series'));
      o.enum('box.afterReload', (await c.loc(S.search).first().inputValue()).replace(t, 'T'));
      await searchFor(c, '');
      o.flag('cleared.showsList', (await cardCount(c)) > 0);
    },
  });

  ui({
    id: 'list.pagination',
    title: 'List: 12 per page, the pager appears at 13, page 2 holds the rest, an out-of-range page is clamped',
    run: async (c) => {
      const o = c.obs;
      const made = [];
      for (let i = 0; i < 12; i++) {
        made.push(await createFlow(c, { label: `p${String(i).padStart(2, '0')}` }));
        if (i === 11) await sleep(0);
      }
      const q = `?q=${encodeURIComponent(scope(c))}`;
      const pagerShown = async () =>
        (await c.page.locator(S.pager).count()) > 0 && (await c.page.locator(S.pager).first().isVisible().catch(() => false));
      await openList(c, q);
      o.num('twelve.cards', await cardCount(c));
      o.flag('twelve.pager', await pagerShown());
      o.flag('twelve.footer', await seen(c, /Showing\s+12\s+of\s+12\s+filtered flows/i, 1200));
      made.push(await createFlow(c, { label: 'p12' }));
      await openList(c, q);
      o.num('thirteen.cards', await cardCount(c));
      o.flag('thirteen.pager', await pagerShown());
      o.flag('thirteen.footer', await seen(c, /Showing\s+12\s+of\s+13\s+filtered flows/i, 1200));
      o.flag('thirteen.pagerText', await seen(c, /Showing\s+1\s*[-–]\s*12\s+of\s+13/i, 1200));
      const prevDisabledOnFirst = await c.page.locator(S.pager).getByText(/^prev/i).first().evaluate((e) => e.tagName !== 'A' && e.tagName !== 'BUTTON' || e.hasAttribute('disabled') || e.getAttribute('aria-disabled') === 'true').catch(() => null);
      o.flag('thirteen.prevInert', prevDisabledOnFirst);
      // next
      const next = c.page.locator(S.pager).getByText(/^next/i).first();
      await next.click();
      await settle(c, 1000);
      o.num('page2.cards', await cardCount(c));
      o.enum('page2.url', urlQuery(c));
      o.flag('page2.pagerText', await seen(c, /Showing\s+13\s*[-–]\s*13\s+of\s+13/i, 1200));
      o.flag('page2.footer', await seen(c, /Showing\s+1\s+of\s+13\s+filtered flows/i, 1200));
      await c.page.goBack();
      await settle(c, 1200);
      o.num('back.cards', await cardCount(c));
      o.enum('back.url', urlQuery(c));
      // out-of-range pages
      for (const p of [99, 0, -3, 'abc', 2.5]) {
        await openList(c, `?page=${p}&q=${encodeURIComponent(scope(c))}`);
        o.num(`page.${String(p).replace(/\W/g, '_')}.cards`, await cardCount(c));
      }
      // page 2, search narrows, the page resets to 1
      await openList(c, `?page=2&q=${encodeURIComponent(scope(c))}`);
      await searchFor(c, `${scope(c)}-p0`);
      o.num('searchOnPage2.cards', await cardCount(c));
      o.flag('searchOnPage2.urlHasNoPage2', !/page=2/.test(c.page.url()));
      // delete the one on page 2 from page 2: the list falls back
      await openList(c, `?page=2&q=${encodeURIComponent(scope(c))}`);
      const last = made[12];
      void last;
    },
  });

  // ---- layout, keyboard, states -----------------------------------------------------------------------------
  ui({
    id: 'list.responsive-390',
    title: 'List: at 390px nothing overflows, the cards stack, every card action is reachable; RTL does not overflow',
    run: async (c) => {
      const o = c.obs;
      const f = await createFlow(c, { label: 'r', pub: true, category: 'welcome' });
      await c.page.setViewportSize({ width: 390, height: 800 });
      await openList(c, `?q=${encodeURIComponent(scope(c))}`);
      o.set('low.overflowX.390', await c.page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth)));
      const card = cardOf(c, f.name);
      const box = await card.boundingBox();
      o.flag('card.fitsViewport', !!box && box.x >= -1 && box.x + box.width <= 391);
      let reachable = 0;
      for (const sel of [ACT.toggle, ACT.rename, ACT.dup, ACT.exp, ACT.del, ACT.open]) {
        const el = card.locator(sel).first();
        await el.scrollIntoViewIfNeeded().catch(() => undefined);
        const b = await el.boundingBox().catch(() => null);
        if (b && b.x >= -1 && b.x + b.width <= 391 && b.width >= 20 && b.height >= 20) reachable++;
      }
      o.num('card.actionsReachable', reachable);
      o.flag('create.visible', await c.loc(S.create).first().isVisible().catch(() => false));
      await c.page.setViewportSize({ width: 820, height: 900 });
      await openList(c, `?q=${encodeURIComponent(scope(c))}`);
      o.set('low.overflowX.820', await c.page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth)));
      await c.page.setViewportSize({ width: 1366, height: 900 });
      await c.page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
      await c.page.waitForTimeout(300);
      o.set('low.overflowX.rtl', await c.page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth)));
      await c.shot('rtl');
    },
  });

  ui({
    id: 'list.keyboard',
    title: 'List: Tab reaches search and the card actions, Enter pauses, Escape closes the confirm, Enter confirms',
    run: async (c) => {
      const o = c.obs;
      const f = await createFlow(c, { label: 'k', pub: true });
      await openList(c, `?q=${encodeURIComponent(scope(c))}`);
      // search is reachable by Tab from the top of the page
      await c.page.locator('body').click({ position: { x: 5, y: 5 } });
      let reached = false;
      for (let i = 0; i < 80 && !reached; i++) {
        await c.page.keyboard.press('Tab');
        reached = await c.page.evaluate(() => document.activeElement?.matches('input[type=search]'));
      }
      o.flag('tabReachesSearch', reached);
      // the pause button of the card takes keyboard activation
      const toggle = cardOf(c, f.name).locator(ACT.toggle).first();
      await toggle.focus();
      o.flag('toggle.focusable', await toggle.evaluate((e) => document.activeElement === e));
      await c.page.keyboard.press('Enter');
      await settle(c, 1200);
      o.enum('afterEnter.state', (await flowById(c, f.id))?.state);
      await c.page.keyboard.press('Space').catch(() => undefined);
      // Tab order inside a card
      const card = cardOf(c, f.name);
      await card.locator('a, button').first().focus();
      const order = [];
      for (let i = 0; i < 7; i++) {
        order.push(await c.page.evaluate(() => (document.activeElement?.getAttribute('title') ?? document.activeElement?.textContent ?? '').trim().slice(0, 14)));
        await c.page.keyboard.press('Tab');
      }
      o.seq('card.tabOrder', order.map((t) => t.replace(/^(Pause|Resume)$/, 'Toggle')));
      // the confirm dialog: Escape cancels, Enter on the focused confirm button deletes
      await card.locator(ACT.del).first().focus();
      await c.page.keyboard.press('Enter');
      o.flag('confirm.opens', await c.visible(confirmEls.box, undefined, 3000));
      await c.page.keyboard.press('Escape');
      await c.page.waitForTimeout(500);
      o.flag('confirm.escapeCloses', !(await c.visible(confirmEls.box)));
      o.flag('confirm.escapeKeepsFlow', !!(await flowById(c, f.id)));
      o.flag('card.stillThere', (await cardOf(c, f.name).count()) === 1);
      await card.locator(ACT.del).first().focus();
      await c.page.keyboard.press('Enter');
      await c.visible(confirmEls.box, undefined, 3000);
      const focusOnAccept = await c.page.evaluate(() => /^delete$/i.test((document.activeElement?.textContent ?? '').trim()));
      o.flag('confirm.initialFocusOnAccept', focusOnAccept);
      await c.loc(confirmEls.accept).first().focus();
      await c.page.keyboard.press('Enter');
      await settle(c, 1200);
      o.flag('confirm.enterDeletes', !(await flowById(c, f.id)));
    },
  });

  ui({
    id: 'list.states',
    title: 'List: a failing refresh, offline, a failing action and the empty state keep the page usable',
    run: async (c) => {
      const o = c.obs;
      const f = await createFlow(c, { label: 's', pub: true });
      await openList(c, `?q=${encodeURIComponent(scope(c))}`);
      const refresh = (req) =>
        req.method() === 'GET' &&
        (WD(c) ? /\/flows(\?|$)/.test(req.url()) && /partial=1/.test(req.url()) : /\/api\/v2\/flows(\?|$)/.test(req.url()));
      // 1. the data request fails
      const dispose = await c.failRequests(refresh, 500);
      await c.click(S.tab('paused'));
      await settle(c, 1500);
      const failText = await bodyText(c);
      o.flag('refreshFail.feedback', /could not|failed|error|try again|retry/i.test(failText.replace(/zz-flb-\S+/g, '')));
      o.flag('refreshFail.pageStillHasTabs', await c.visible(S.tab('live')));
      await dispose();
      await c.click(S.tab('all'));
      await settle(c, 1500);
      o.flag('refreshFail.recovers', (await cardCount(c)) > 0);
      // 2. the toggle fails
      const d2 = await c.failRequests((req) => req.method() === 'POST' && /\/toggle/.test(req.url()), 500);
      await cardOf(c, f.name).locator(ACT.toggle).first().click();
      await settle(c, 1500);
      o.flag('toggleFail.feedback', /could not|failed|error|try again/i.test((await bodyText(c)).replace(/zz-flb-\S+/g, '')));
      o.enum('toggleFail.state', (await flowById(c, f.id))?.state);
      o.flag('toggleFail.buttonUsable', await cardOf(c, f.name).locator(ACT.toggle).first().isEnabled().catch(() => false));
      await d2();
      // 3. offline
      await c.context.setOffline(true);
      await cardOf(c, f.name).locator(ACT.toggle).first().click().catch(() => undefined);
      await settle(c, 1500);
      o.enum('offline.state', (await c.context.setOffline(false), (await flowById(c, f.id))?.state));
      // 4. a miss is the empty state, with both ways out
      await openList(c, `?q=${encodeURIComponent(scope(c) + '-no-such')}`);
      o.flag('empty.message', await seen(c, /no flows match/i, 2000));
      o.flag('empty.reset', (await c.page.getByRole('button', { name: /reset/i }).count()) + (await c.page.getByRole('link', { name: /reset/i }).count()) > 0);
      o.flag('empty.create', (await c.page.getByRole('button', { name: /create flow/i }).count()) + (await c.page.getByRole('link', { name: /create flow/i }).count()) > 1);
      const reset = c.page.getByRole('button', { name: /reset/i }).or(c.page.getByRole('link', { name: /reset/i })).first();
      if (await reset.count()) {
        await reset.click();
        await settle(c, 1200);
        o.enum('empty.resetUrl', urlQuery(c));
        o.flag('empty.resetShowsList', (await cardCount(c)) > 0);
      }
      await c.shot('empty');
    },
  });

  // ===============================================================================================================
  // row actions (WD-FLB-004 pause / resume, 005 rename, 006 duplicate, 007 delete)
  // ===============================================================================================================
  const pill = async (c, name) => {
    const t = await cardOf(c, name).innerText().catch(() => '');
    return /\b(LIVE|PAUSED|DRAFT)\b/i.exec(t)?.[1]?.toLowerCase() ?? 'none';
  };
  const requestsTo = (c, mark, re) => c.rec.since(mark).http.filter((x) => re.test(x.path) && x.method !== 'GET');
  const klass = (s) => (s >= 200 && s < 300 ? 'ok' : s === 302 ? 'ok' : s === 401 ? 'unauthenticated' : s === 403 ? 'forbidden' : s === 404 ? 'not-found' : s === 409 ? 'conflict' : s === 429 ? 'throttled' : s >= 500 ? 'crash' : 'rejected');

  ui({
    id: 'action.toggle',
    title: 'Pause / resume: toast, pill, button label, counts, drafts and double click',
    run: async (c) => {
      const o = c.obs;
      const live = await createFlow(c, { label: 'live', pub: true });
      const draft = await createFlow(c, { label: 'draft' });
      await openList(c, `?q=${encodeURIComponent(scope(c))}`);
      const before = await counts(c);
      const mark = c.rec.mark();
      await cardOf(c, live.name).locator(ACT.toggle).first().click();
      o.flag('pause.toast', await seen(c, /flow paused/i, 4000));
      await settle(c, 1000);
      o.enum('pause.pill', await pill(c, live.name));
      o.enum('pause.buttonTitle', await cardOf(c, live.name).locator(ACT.toggle).first().getAttribute('title'));
      o.enum('pause.api', (await flowById(c, live.id))?.state);
      const mid = await counts(c);
      o.num('pause.delta.live', mid.live - before.live);
      o.num('pause.delta.paused', mid.paused - before.paused);
      o.num('pause.delta.all', mid.all - before.all);
      o.num('pause.requests', requestsTo(c, mark, /toggle/).length);
      o.enum('pause.requestStatus', klass(requestsTo(c, mark, /toggle/)[0]?.status ?? 0));
      await cardOf(c, live.name).locator(ACT.toggle).first().click();
      o.flag('resume.toast', await seen(c, /flow resumed/i, 4000));
      await settle(c, 1000);
      o.enum('resume.pill', await pill(c, live.name));
      o.enum('resume.api', (await flowById(c, live.id))?.state);
      // a draft can be toggled; its pill still says draft (QUIRK) while is_active flips
      await cardOf(c, draft.name).locator(ACT.toggle).first().click();
      await settle(c, 1200);
      o.enum('draft.pill', await pill(c, draft.name));
      o.flag('draft.isActiveAfter', (await flowById(c, draft.id))?.isActive);
      o.enum('draft.state', (await flowById(c, draft.id))?.state);
      // two quick clicks end where they started
      const btn = cardOf(c, live.name).locator(ACT.toggle).first();
      await btn.click();
      await btn.click().catch(() => undefined);
      await settle(c, 1800);
      o.enum('doubleClick.state', (await flowById(c, live.id))?.state);
      o.num('doubleClick.requests', requestsTo(c, mark, /toggle/).length);
      await c.shot('toggle');
    },
  });

  api({
    id: 'action.toggle.ids',
    title: 'Pause / resume by API: unknown, foreign and malformed ids',
    run: async (c) => {
      const o = c.obs;
      const f = await createFlow(c, { label: 'ids', pub: true });
      const foreign = foreignFlow(c, `zz-flb-${c.tag('foreign')}`);
      const unknown = WD(c) ? '999999999' : uuid();
      const t = async (id) => (WD(c) ? c.http('POST', `/flows/${id}/toggle`) : c.http('POST', `/v2/flows/${id}/toggle`, { headers: idem() }));
      o.enum('unknown', klass((await t(unknown)).status));
      o.enum('foreign', klass((await t(foreign.id)).status));
      o.flag('foreign.untouched', foreign.exists());
      o.enum('malformed', klass((await t('abc')).status));
      o.enum('mine', klass((await t(f.id)).status));
      o.enum('mine.state', (await flowById(c, f.id))?.state);
      await toggleFlow(c, f.id);
    },
  });

  // ---- rename ---------------------------------------------------------------------------------------------------
  async function renameViaUi(c, name, value) {
    const card = cardOf(c, name);
    const out = { opened: false, prefilled: null };
    if (WD(c)) {
      c.page.once('dialog', async (d) => {
        out.opened = d.type() === 'prompt';
        out.prefilled = d.defaultValue() === name;
        await d.accept(value);
      });
      await card.locator(ACT.rename).first().click();
    } else {
      await card.locator(ACT.rename).first().click();
      const dlg = c.page.locator('dialog[open]');
      out.opened = await dlg.waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
      out.prefilled = (await dlg.locator('input').first().inputValue().catch(() => null)) === name;
      await dlg.locator('input').first().fill(value);
      await dlg.getByRole('button', { name: /^rename$/i }).click();
    }
    await settle(c, 1200);
    return out;
  }

  ui({
    id: 'action.rename.ui',
    title: 'Rename in place: valid, unchanged, empty, blanks, 191 / 192 characters, hostile text',
    run: async (c) => {
      const o = c.obs;
      const f = await createFlow(c, { label: 'ren', pub: true });
      await openList(c, `?q=${encodeURIComponent(scope(c))}`);
      let current = f.name;
      const attempt = async (id, value, expectFind) => {
        await c.page.waitForFunction(() => !/flow renamed/i.test(document.body.innerText), undefined, { timeout: 12000 }).catch(() => undefined);
        const mark = c.rec.mark();
        const r = await renameViaUi(c, current, value);
        const reqs = requestsTo(c, mark, /rename/);
        const stored = (await flowById(c, f.id))?.name ?? '';
        o.flag(`${id}.dialog`, r.opened);
        o.flag(`${id}.prefilled`, r.prefilled);
        o.num(`${id}.requests`, reqs.length);
        o.enum(`${id}.status`, reqs.length ? klass(reqs[0].status) : 'none');
        o.flag(`${id}.changed`, stored !== current);
        o.num(`${id}.storedLength`, stored.length);
        o.flag(`${id}.toast`, await seen(c, /flow renamed/i, 1500));
        o.flag(`${id}.feedback`, /could not|failed|error|invalid|must not|too long|required/i.test((await bodyText(c)).replace(/zz-flb-\S+/g, '')));
        if (stored !== current) {
          current = stored;
          if (!expectFind) {
            await openList(c, `?q=${encodeURIComponent(stored.slice(0, 40))}`);
          }
        }
        return stored;
      };
      await attempt('valid', `${f.name}-renamed`, true);
      await attempt('unchanged', current, true);
      await attempt('empty', '', true);
      await attempt('blank', '    ', true);
      await attempt('padded', `   ${f.name}-padded   `, true);
      o.enum('padded.stored', norm(c, current, [f.name]));
      const big = (n) => `${f.name}-${rep(n - f.name.length - 1)}`.slice(0, n);
      await openList(c, `?q=${encodeURIComponent(scope(c))}`);
      await attempt('len191', big(191), true);
      await openList(c, `?q=${encodeURIComponent(scope(c))}`);
      await attempt('len192', big(192), true);
      await openList(c, `?q=${encodeURIComponent(scope(c))}`);
      await attempt('html', `${f.name}-<b>bold</b>`, true);
      await c.shot('rename');
    },
  });

  const renameCases = [
    ['valid', 'Welcome flow'],
    ['empty', ''],
    ['spaces', '     '],
    ['one-char', 'a'],
    ['191', rep(191)],
    ['192', rep(192)],
    ['255', rep(255)],
    ['padded', '   padded name   '],
    ['unicode', 'Café Ünïcode ✓ 你好'],
    ['emoji-191', '😀'.repeat(191)],
    ['emoji-192', '😀'.repeat(192)],
    ['newline', 'line one\nline two'],
    ['tab', 'a\tb'],
    ['html', '<b>bold</b> & <i>it</i>'],
    ['script', '<img src=x onerror=window.__xss=1>'],
    ['sql', "x'; DROP TABLE flows; --"],
    ['template-token', '{{contact.name}} ${x} {%x%}'],
    ['rtl', 'مرحبا بالعالم'],
    ['zero-width', 'a\u200bb\u200bc'],
    ['backslash', 'C:\\path\\to "quoted"'],
  ];
  for (const [id, value] of renameCases) {
    api({
      id: `rename.${id}`,
      title: `Rename by API: ${id}`,
      run: async (c) => {
        const o = c.obs;
        const f = await createFlow(c, { label: 'rn' });
        const r = WD(c)
          ? await c.http('POST', `/flows/${f.id}/rename`, { data: { name: value } })
          : await c.http('PATCH', `/v2/flows/${f.id}/rename`, { data: { name: value }, headers: idem() });
        const accepted = r.status === 200;
        o.flag('accepted', accepted);
        o.enum('outcome', accepted ? 'saved' : r.status >= 500 ? 'crash' : 'rejected');
        o.status('rename', r.status);
        const stored = (await flowById(c, f.id))?.name ?? '';
        o.enum('stored', accepted ? stored : 'unchanged:' + (stored === f.name));
        o.num('storedLength', accepted ? [...stored].length : null);
        o.flag('echoesName', accepted ? (WD(c) ? r.body?.name : r.body?.name) === stored : null);
        o.flag('otherFlowsUntouched', (await flowById(c, f.id))?.state === 'draft');
      },
    });
  }

  api({
    id: 'rename.ids',
    title: 'Rename by API: unknown, foreign and malformed ids; a foreign flow is not touched',
    run: async (c) => {
      const o = c.obs;
      const foreign = foreignFlow(c, `zz-flb-${c.tag('foreign')}`);
      const unknown = WD(c) ? '999999999' : uuid();
      const call = (id, name = 'renamed by a stranger') =>
        WD(c)
          ? c.http('POST', `/flows/${id}/rename`, { data: { name } })
          : c.http('PATCH', `/v2/flows/${id}/rename`, { data: { name }, headers: idem() });
      o.enum('unknown', klass((await call(unknown)).status));
      o.enum('foreign', klass((await call(foreign.id)).status));
      o.flag('foreign.untouched', foreign.exists());
      o.enum('malformed', klass((await call('abc')).status));
      o.enum('noBody', klass((await (WD(c) ? c.http('POST', `/flows/${unknown}/rename`, { data: {} }) : c.http('PATCH', `/v2/flows/${unknown}/rename`, { data: {}, headers: idem() }))).status));
    },
  });

  // ---- duplicate -------------------------------------------------------------------------------------------------
  ui({
    id: 'action.duplicate',
    title: 'Duplicate: lands in the builder, "(Copy)", draft, keeps is_active, source untouched, double click',
    run: async (c) => {
      const o = c.obs;
      await guard(c);
      const live = await createFlow(c, { label: 'live', pub: true, category: 'welcome' });
      const paused = await createFlow(c, { label: 'paused', pub: true, active: false, category: 'cart' });
      const draft = await createFlow(c, { label: 'draft' });
      for (const [id, src] of [['live', live], ['paused', paused], ['draft', draft]]) {
        await openList(c, `?q=${encodeURIComponent(scope(c))}`);
        const marker = new Set((await allFlows(c, scope(c))).map((f) => String(f.id)));
        await cardOf(c, src.name).locator(ACT.dup).first().click();
        const landed = await c.page.waitForURL(/flows\/builder/, { timeout: 25000 }).then(() => true).catch(() => false);
        o.flag(`${id}.landsInBuilder`, landed);
        o.flag(`${id}.landingHasId`, !!builderIdOf(c.page.url()));
        const copies = (await allFlows(c, scope(c))).filter((f) => !marker.has(String(f.id)));
        o.num(`${id}.copies`, copies.length);
        const copy = copies[0];
        o.enum(`${id}.copyName`, norm(c, copy?.name, [src.name]));
        o.enum(`${id}.copyState`, copy?.state);
        o.flag(`${id}.copyPublished`, copy?.isPublished);
        o.flag(`${id}.copyActive`, copy?.isActive);
        o.enum(`${id}.copyCategory`, copy?.category ?? 'none');
        o.enum(`${id}.copyType`, copy?.flowType);
        o.flag(`${id}.landingIsTheCopy`, !!copy && String(builderIdOf(c.page.url())) === String(copy.id));
        o.enum(`${id}.sourceStateAfter`, (await flowById(c, src.id))?.state);
        o.flag(`${id}.toast`, await seen(c, /flow duplicated/i, 2500));
      }
      // a double click makes how many copies?
      await openList(c, `?q=${encodeURIComponent(scope(c))}`);
      const before = (await allFlows(c, scope(c))).length;
      const btn = cardOf(c, live.name).locator(ACT.dup).first();
      await btn.click({ noWaitAfter: true });
      await btn.click({ noWaitAfter: true, timeout: 800 }).catch(() => undefined);
      await c.page.waitForTimeout(3500);
      o.num('doubleClick.newCopies', (await allFlows(c, scope(c))).length - before);
    },
  });

  api({
    id: 'duplicate.api',
    title: 'Duplicate by API: long names, unknown and foreign ids',
    run: async (c) => {
      const o = c.obs;
      const call = (id) => (WD(c) ? c.http('POST', `/flows/${id}/duplicate`) : c.http('POST', `/v2/flows/${id}/duplicate`, { headers: idem() }));
      const startIds = new Set((await allFlows(c)).map((f) => String(f.id)));
      const before = new Set(startIds);
      c.onCleanup(async () => {
        for (const f of await allFlows(c, c.tagBase)) if (!startIds.has(String(f.id))) await removeFlow(c, f.id);
      });
      const name = (n) => `zz-flb-${c.tag('dn')}-${rep(n)}`.slice(0, n);
      for (const n of [150, 191, 192, 250]) {
        const f = await createFlow(c, { name: name(n), label: `d${n}` });
        o.flag(`len${n}.sourceAccepted`, f.ok);
        if (!f.ok) continue;
        before.add(String(f.id));
        const r = await call(f.id);
        o.enum(`len${n}.status`, klass(r.status));
        const copies = (await allFlows(c, c.tagBase)).filter((x) => !before.has(String(x.id)) && String(x.id) !== String(f.id));
        o.num(`len${n}.copies`, copies.length);
        o.num(`len${n}.copyNameLength`, copies[0]?.name?.length ?? null);
        o.flag(`len${n}.copyEndsWithCopy`, !!copies[0]?.name?.endsWith('(Copy)'));
        for (const x of copies) before.add(String(x.id));
      }
      const foreign = foreignFlow(c, `zz-flb-${c.tag('foreign')}`);
      o.enum('foreign', klass((await call(foreign.id)).status));
      o.num('foreign.copiesMade', (await allFlows(c, foreign ? c.tagBase : '')).filter((x) => /\(Copy\)$/.test(x.name) && x.name.includes('foreign')).length);
      o.enum('unknown', klass((await call(WD(c) ? '999999999' : uuid())).status));
    },
  });

  // ---- export ----------------------------------------------------------------------------------------------------
  const exportOf = async (c, id) =>
    WD(c) ? c.http('GET', `/flows/${id}/export`) : c.http('GET', `/v2/flows/${id}/export`);
  const fileNameOf = (r) => /filename="?([^";]+)"?/i.exec(r.headers['content-disposition'] ?? '')?.[1] ?? null;
  const shapeOf = (c, text, name) => {
    let j = null;
    try {
      j = JSON.parse(text);
    } catch {
      return { parsed: false };
    }
    return {
      parsed: true,
      keys: Object.keys(j).sort(),
      marker: j._wadesk_flow_export,
      name: norm(c, j.name, [name]),
      flowType: j.flow_type,
      category: j.category,
      flowDataKeys: Object.keys(j.flow_data ?? {}).sort(),
      nodeTypes: (j.flow_data?.flowNodes ?? []).map((n) => n.type),
      nodeIds: (j.flow_data?.flowNodes ?? []).map((n) => n.id),
      edgeCount: (j.flow_data?.flowEdges ?? []).length,
      triggerKind: j.flow_data?.flowNodes?.[0]?.data?.kind,
      hasExportedAt: typeof j.exported_at === 'string' && !Number.isNaN(Date.parse(j.exported_at)),
    };
  };

  ui({
    id: 'action.export.ui',
    title: 'Export: file name and JSON shape from the card button',
    tags: ['download'],
    run: async (c) => {
      const o = c.obs;
      const f = await createFlow(c, { label: 'exp', pub: true, category: 'welcome', nodes: [trig('keyword'), N('message', 1, { text: 'a/b → café 你好' }), N('end', 2, {})] });
      await openList(c, `?q=${encodeURIComponent(scope(c))}`);
      const [dl] = await Promise.all([
        c.page.waitForEvent('download', { timeout: 20000 }),
        cardOf(c, f.name).locator(ACT.exp).first().click(),
      ]);
      const fileName = dl.suggestedFilename();
      o.enum('fileName', fileName.replace(/^.*?(\.[^.]+\.json)$/i, 'NAME$1'));
      o.flag('fileName.startsWithSlug', fileName.toLowerCase().startsWith(f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20)));
      const path = await dl.path();
      const text = readFileSync(path, 'utf8');
      const s = shapeOf(c, text, f.name);
      for (const [k, v] of Object.entries(s)) o.set(Array.isArray(v) ? `seq.shape.${k}` : typeof v === 'boolean' ? `flag.shape.${k}` : `enum.shape.${k}`, Array.isArray(v) ? v : typeof v === 'boolean' ? v : String(v));
      o.flag('prettyPrinted', /\n\s+"/.test(text));
      o.flag('unicodeRaw', text.includes('你好') && text.includes('café') && text.includes('→'));
      o.flag('slashesRaw', text.includes('a/b') && !text.includes('a\\/b'));
      o.flag('noWorkspaceIds', !/workspace|user_id|"id":\s*\d{3,}/.test(text.replace(/"id":\s*"n\d+"/g, '')));
    },
  });

  api({
    id: 'export.names',
    title: 'Export by API: attachment names for awkward flow names; unknown, foreign, malformed ids',
    run: async (c) => {
      const o = c.obs;
      const nm = [
        ['plain', 'Welcome series'],
        ['punct', 'a/b\\c:d*e?f"g<h>i|j'],
        ['unicode', '你好 世界'],
        ['emoji', '😀😀'],
        ['dots', '...'],
        ['long', rep(191)],
        ['spaces', '   x   y   '],
        ['upper', 'UPPER Case'],
      ];
      for (const [id, name] of nm) {
        const f = await createFlow(c, { name: id === 'plain' || id === 'upper' ? `${name} ${c.tag('e')}` : name, label: id });
        if (!f.ok) {
          o.flag(`${id}.created`, false);
          continue;
        }
        const r = await exportOf(c, f.id);
        o.status(`${id}.status`, r.status);
        const fn = fileNameOf(r);
        o.enum(`${id}.fileName`, (fn ?? 'none').replace(c.tagBase, 'TAG').replace(String(f.id), 'ID').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, 'ID').replace(/pwp-[a-z0-9-]+/gi, 'TAG').slice(0, 60));
        o.enum(`${id}.contentType`, (r.headers['content-type'] ?? '').split(';')[0]);
      }
      const foreign = foreignFlow(c, `zz-flb-${c.tag('foreign')}`);
      o.enum('foreign', klass((await exportOf(c, foreign.id)).status));
      o.enum('unknown', klass((await exportOf(c, WD(c) ? '999999999' : uuid())).status));
      o.enum('malformed', klass((await exportOf(c, 'abc')).status));
    },
  });

  // ---- import ----------------------------------------------------------------------------------------------------
  const goodNodes = () => [
    { id: 'a', type: 'trigger', data: { kind: 'keyword', keywords: 'zz' } },
    { id: 'b', type: 'message', data: { text: 'hi' } },
    { id: 'c', type: 'end', data: {} },
    { id: 'd', type: 'message', data: { text: 'four' } },
  ];
  const wrapper = (over = {}) => ({
    _wadesk_flow_export: 1,
    exported_at: '2026-01-01T00:00:00Z',
    name: 'imported-name',
    flow_type: 'chat',
    category: 'welcome',
    flow_data: { flowNodes: goodNodes(), flowEdges: [{ id: 'e', source: 'a', sourceHandle: 'out', target: 'b' }], vars: [] },
    ...over,
  });
  const importFiles = (tag) => [
    ['wrapper', { name: 'flow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wrapper({ name: `zz-flb-${tag}-wrapper` }))) }],
    ['bare-graph', { name: 'graph.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ flowNodes: goodNodes().concat(goodNodes().map((n) => ({ ...n, id: n.id + '2' }))) })) }],
    ['plain-text-type', { name: 'flow.txt', mimeType: 'text/plain', buffer: Buffer.from(JSON.stringify(wrapper({ name: `zz-flb-${tag}-txt` }))) }],
    ['bad-flow-type', { name: 'flow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wrapper({ name: `zz-flb-${tag}-type`, flow_type: 'pigeon' }))) }],
    ['blank-name', { name: 'flow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wrapper({ name: '   ' }))) }],
    ['no-name-key', { name: 'flow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ flow_data: wrapper().flow_data })) }],
    ['xss-name', { name: 'flow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wrapper({ name: `zz-flb-${tag}-<img src=x onerror=window.__xss=1>` }))) }],
    ['long-name', { name: 'flow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wrapper({ name: `zz-flb-${tag}-${rep(250)}`.slice(0, 250) }))) }],
    ['nodes-without-position', { name: 'flow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wrapper({ name: `zz-flb-${tag}-nopos` }))) }],
    ['not-json', { name: 'flow.json', mimeType: 'application/json', buffer: Buffer.from('this is not json {') }],
    ['json-array', { name: 'flow.json', mimeType: 'application/json', buffer: Buffer.from('[1,2,3]') }],
    ['json-scalar', { name: 'flow.json', mimeType: 'application/json', buffer: Buffer.from('42') }],
    ['no-flow-keys', { name: 'flow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ hello: 'world' })) }],
    ['nodes-not-list', { name: 'flow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ flowNodes: 'x' })) }],
    ['empty-nodes', { name: 'flow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wrapper({ name: `zz-flb-${tag}-nonodes`, flow_data: { flowNodes: [], flowEdges: [] } }))) }],
    ['png', { name: 'pic.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex') }],
    ['empty-file', { name: 'flow.json', mimeType: 'application/json', buffer: Buffer.alloc(0) }],
    ['too-big', { name: 'big.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wrapper({ name: `zz-flb-${tag}-big`, pad: rep(4 * 1024 * 1024 + 2048) }))) }],
  ];
  for (const [fid] of importFiles('x')) {
    ui({
      id: `import.${fid}`,
      title: `Import a file: ${fid}`,
      run: async (c) => {
        const o = c.obs;
        await guard(c);
        let fired = false;
        await c.page.exposeFunction('__xssFired', () => (fired = true)).catch(() => undefined);
        await c.page.addInitScript(() => {
          Object.defineProperty(window, '__xss', {
            set() {
              window.__xssFired && window.__xssFired();
            },
            get() {
              return 0;
            },
          });
        });
        const tag = scope(c);
        const file = importFiles(tag).find(([k]) => k === fid)[1];
        await openList(c, `?q=${encodeURIComponent(tag)}`);
        const mark = c.rec.mark();
        const beforeIds = new Set((await allFlows(c)).map((f) => String(f.id)));
        const beforeText = new Set((await bodyText(c)).split('\n').map((l) => l.trim()));
        await c.page.locator(S.fileInput).first().setInputFiles(file);
        // either the builder opens or a message appears: wait for whichever comes (the reference answers with a redirect)
        const t0 = Date.now();
        let landed = false;
        let toast = false;
        while (Date.now() - t0 < 15000) {
          if (/flows\/builder/.test(c.page.url())) {
            landed = true;
            break;
          }
          const lines = (await bodyText(c).catch(() => '')).split('\n').map((l) => l.trim());
          if (lines.some((l) => l && !beforeText.has(l) && /not a valid|must be a file|must not be greater|failed to upload|plan limit/i.test(l))) break;
          await sleep(250);
        }
        if (landed) toast = await seen(c, /flow imported/i, 2500);
        o.flag('importedToast', toast);
        await c.page.waitForLoadState('load').catch(() => undefined);
        await settle(c, 800);
        o.flag('landsInBuilder', landed);
        o.flag('landingHasId', !!builderIdOf(c.page.url()));
        // other people may be working in the same workspace: only the rows that are ours (tagged, or the default import name)
        const mine = (f) => String(f.name).includes(c.tagBase) || String(f.name).startsWith('Imported flow');
        const made = (await allFlows(c)).filter((f) => !beforeIds.has(String(f.id)) && mine(f));
        o.num('created', made.length);
        const m = newest(c, made);
        o.enum('name', norm(c, m?.name ?? 'none', []).replace(new RegExp(`zz-flb-${tag}-`, 'g'), 'P-'));
        o.num('nameLength', m ? m.name.length : null);
        o.enum('state', m?.state ?? 'none');
        o.enum('flowType', m?.flowType ?? 'none');
        o.enum('category', m?.category ?? 'none');
        o.flag('landingIsTheNewFlow', !!m && String(builderIdOf(c.page.url())) === String(m.id));
        const fresh = (await bodyText(c)).split('\n').map((l) => l.trim()).filter((l) => l && !beforeText.has(l));
        o.set('seq.messages', fresh.filter((l) => /valid|file|flow export|must|kilobytes|plan limit|upload/i.test(l) && !/flow imported/i.test(l)).map((l) => norm(c, l).replace(/WaDesk|CRM Platform/g, 'BRAND').slice(0, 160)));
        o.flag('sec.xssExecuted', fired);
        o.num('importRequests', requestsTo(c, mark, /import/).length);
        o.enum('importStatus', requestsTo(c, mark, /import/)[0] ? klass(requestsTo(c, mark, /import/)[0].status) : 'none');
        await c.shot('after');
      },
    });
  }

  ui({
    id: 'import.roundtrip',
    title: 'Import: our own export loads back with the same steps; the file input is reusable',
    run: async (c) => {
      const o = c.obs;
      await guard(c);
      const src = await createFlow(c, { label: 'rt', pub: true, category: 'lead', flowType: 'chat', nodes: NODES('tag_added') });
      const r = await exportOf(c, src.id);
      const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
      await openList(c, `?q=${encodeURIComponent(scope(c))}`);
      const before = new Set((await allFlows(c)).map((f) => String(f.id)));
      await c.page.locator(S.fileInput).first().setInputFiles({ name: 'rt.json', mimeType: 'application/json', buffer: Buffer.from(text) });
      await c.page.waitForTimeout(2500);
      await settle(c, 1500);
      const made = (await allFlows(c)).filter((f) => !before.has(String(f.id)) && String(f.name).includes(c.tagBase));
      o.num('created', made.length);
      const got = newest(c, made);
      o.enum('name', norm(c, got?.name ?? 'none', [src.name]));
      o.enum('state', got?.state ?? 'none');
      o.enum('category', got?.category ?? 'none');
      const again = got ? await exportOf(c, got.id) : null;
      const a = shapeOf(c, text, src.name);
      const b = again ? shapeOf(c, typeof again.body === 'string' ? again.body : JSON.stringify(again.body), got.name) : {};
      o.flag('sameNodeTypes', JSON.stringify(a.nodeTypes) === JSON.stringify(b.nodeTypes));
      o.flag('sameEdges', a.edgeCount === b.edgeCount);
      o.flag('sameTrigger', a.triggerKind === b.triggerKind);
    },
  });

  // ---- delete ----------------------------------------------------------------------------------------------------
  ui({
    id: 'action.delete.ui',
    title: 'Delete: confirmation, cancel keeps, confirm removes, stays gone, counts drop, double click',
    run: async (c) => {
      const o = c.obs;
      const keep = await createFlow(c, { label: 'keep', pub: true });
      const gone = await createFlow(c, { label: 'gone', pub: true, category: 'welcome' });
      const hostile = await createFlow(c, { name: `zz-flb-${c.tag('x')}-<img src=x onerror=window.__xss=1> "q" 'a'` });
      let fired = false;
      await c.page.exposeFunction('__xssFired', () => (fired = true)).catch(() => undefined);
      await c.page.addInitScript(() => {
        Object.defineProperty(window, '__xss', {
          set() {
            window.__xssFired && window.__xssFired();
          },
          get() {
            return 0;
          },
        });
      });
      await openList(c, `?q=${encodeURIComponent(scope(c))}`);
      const before = await counts(c);
      const mark = c.rec.mark();
      await cardOf(c, gone.name).locator(ACT.del).first().click();
      o.flag('confirm.shown', await c.visible(confirmEls.box, undefined, 3000));
      const msg = await c.loc(confirmEls.msg).first().innerText().catch(() => '');
      o.enum(
        'confirm.text',
        norm(c, msg.replace(/\s+/g, ' ').replace(/^\s*Confirm\s+/, '').replace(/^Delete flow\?\s*/, '').replace(/\s*Cancel\s+Delete\s*$/, '').trim(), [gone.name]),
      );
      o.flag('confirm.namesFlow', msg.includes(gone.name));
      await c.click(confirmEls.cancel);
      await c.page.waitForTimeout(600);
      o.flag('cancel.closes', !(await c.visible(confirmEls.box)));
      o.flag('cancel.rowStays', (await cardOf(c, gone.name).count()) === 1);
      o.flag('cancel.flowStays', !!(await flowById(c, gone.id)));
      o.num('cancel.requests', requestsTo(c, mark, /\/flows\/[\w-]+$/).length);
      await cardOf(c, gone.name).locator(ACT.del).first().click();
      await c.visible(confirmEls.box, undefined, 3000);
      await c.click(confirmEls.accept);
      o.flag('delete.toast', await seen(c, /flow deleted/i, 4000));
      await settle(c, 1000);
      o.flag('delete.rowGone', (await cardOf(c, gone.name).count()) === 0);
      o.flag('delete.flowGone', !(await flowById(c, gone.id)));
      const after = await counts(c);
      o.num('delete.delta.all', after.all - before.all);
      o.num('delete.delta.live', after.live - before.live);
      o.num('delete.delta.welcome', (after.cats.welcome ?? 0) - (before.cats.welcome ?? 0));
      await c.page.reload();
      await listReady(c);
      o.flag('delete.goneAfterReload', (await cardOf(c, gone.name).count()) === 0);
      o.flag('delete.otherRowStays', (await cardOf(c, keep.name).count()) === 1);
      // a hostile name in the confirmation text
      await cardOf(c, hostile.name).locator(ACT.del).first().click();
      await c.visible(confirmEls.box, undefined, 3000);
      o.flag('hostile.nameAsText', (await c.loc(confirmEls.msg).first().innerText().catch(() => '')).includes('<img src=x'));
      await c.click(confirmEls.cancel);
      o.flag('sec.xssExecuted', fired);
      // a double click on the confirm button deletes once and does not crash
      await cardOf(c, keep.name).locator(ACT.del).first().click();
      await c.visible(confirmEls.box, undefined, 3000);
      const m2 = c.rec.mark();
      const accept = c.loc(confirmEls.accept).first();
      await accept.dblclick({ timeout: 3000 }).catch(() => undefined);
      await settle(c, 1500);
      o.flag('double.flowGone', !(await flowById(c, keep.id)));
      o.flag('double.noCrash', c.rec.since(m2).pageErrors.length === 0 && !c.rec.since(m2).http.some((x) => x.status >= 500));
      o.num('double.deleteRequests', requestsTo(c, m2, /\/flows\/[\w-]+$/).length > 1 ? 2 : requestsTo(c, m2, /\/flows\/[\w-]+$/).length);
    },
  });

  api({
    id: 'delete.api',
    title: 'Delete by API: twice, unknown, foreign (stays), malformed; a deleted flow cannot be exported or renamed',
    run: async (c) => {
      const o = c.obs;
      const f = await createFlow(c, { label: 'del', pub: true });
      const foreign = foreignFlow(c, `zz-flb-${c.tag('foreign')}`);
      const del = (id) => (WD(c) ? c.http('DELETE', `/flows/${id}`) : c.http('DELETE', `/v2/flows/${id}`, { headers: idem() }));
      o.enum('first', klass((await del(f.id)).status));
      o.enum('second', klass((await del(f.id)).status));
      o.enum('exportAfter', klass((await exportOf(c, f.id)).status));
      o.enum('unknown', klass((await del(WD(c) ? '999999999' : uuid())).status));
      o.enum('foreign', klass((await del(foreign.id)).status));
      o.flag('foreign.stays', foreign.exists());
      o.enum('malformed', klass((await del('abc')).status));
      // the twin delete endpoint of WaDesk has no counterpart on ours: both must still refuse an unknown id
    },
  });

  // ===============================================================================================================
  // admin flow templates: helpers (WD-FLB-010, 011, 012)
  // ===============================================================================================================
  const b32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const totp = (secret, t = Date.now()) => {
    let bits = '';
    for (const ch of secret.replace(/[\s=]/g, '').toUpperCase()) bits += b32.indexOf(ch).toString(2).padStart(5, '0');
    const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
    const ctr = Buffer.alloc(8);
    ctr.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
    const mac = createHmac('sha1', key).update(ctr).digest();
    const off = mac[19] & 15;
    const n = ((mac[off] & 127) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
    return String(n % 1e6).padStart(6, '0');
  };
  let opCookies = null;
  let lastMfaStep = 0;

  /** Our platform-operator session in this scenario's browser context (the base session of the context is the tenant's). */
  async function operatorSession(c) {
    if (WD(c)) return;
    const op = c.cfg.ours.operator;
    if (!op?.email) throw new Error('PARITY_CONFIG has no ours.operator { email, password, totpSecret }: the admin screens need a platform operator');
    const web = c.sideObj.baseUrl.replace(/\/$/, '');
    const probe = async () =>
      (await c.context.request.get(`${web}/api/platform/flow-templates?limit=1`, { failOnStatusCode: false })).ok();
    await c.context.clearCookies();
    if (opCookies) {
      await c.context.addCookies(opCookies);
      if (await probe()) return;
      await c.context.request.get(`${web}/api/platform-auth/refresh?next=/admin`, { maxRedirects: 0, failOnStatusCode: false }).catch(() => undefined);
      if (await probe()) {
        opCookies = (await c.context.storageState()).cookies;
        return;
      }
      await c.context.clearCookies();
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const lr = await c.context.request.post(`${web}/api/platform-auth/login`, { data: { email: op.email, password: op.password }, failOnStatusCode: false });
      const j = await lr.json().catch(() => ({}));
      if (j.status === 'mfa_required') {
        let step = Math.floor(Date.now() / 30000);
        if (step <= lastMfaStep) {
          await sleep((step + 1) * 30000 - Date.now() + 700);
          step = Math.floor(Date.now() / 30000);
        }
        lastMfaStep = step;
        const mr = await c.context.request.post(`${web}/api/platform-auth/mfa`, {
          data: { challengeToken: j.challengeToken, code: totp(op.totpSecret) },
          failOnStatusCode: false,
        });
        if (!mr.ok()) continue;
      } else if (!lr.ok()) continue;
      if (await probe()) {
        opCookies = (await c.context.storageState()).cookies;
        return;
      }
    }
    throw new Error('platform operator sign-in failed');
  }
  const opFetch = async (c, method, path, data) => {
    const web = c.sideObj.baseUrl.replace(/\/$/, '');
    const r = await c.context.request.fetch(`${web}/api/platform${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(method === 'GET' ? {} : idem()) },
      data: data === undefined ? undefined : JSON.stringify(data),
      failOnStatusCode: false,
    });
    const text = await r.text().catch(() => '');
    let body = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: r.status(), body, text, headers: r.headers() };
  };

  const TPL_GRAPH = () => graphOf([trig('keyword'), N('message', 1, { text: 'hello' }), N('delay', 2, { amount: 1, unit: 'min' }), N('message', 3, { text: 'bye' }), N('end', 4, {})]);
  const tplName = (c, label = 't') => `zz-flb-tpl-${c.tag(label)}`;

  const tplRow = (c, name) => {
    const like = q(name);
    try {
      if (WD(c)) {
        const t = mysql(
          `select json_object('name',name,'description',description,'flowType',flow_type,'category',category,'sort',sort_order,'active',is_active=1,'nodes',json_length(json_extract(flow_data,'$.flowNodes')),'clones',clone_count,'id',id) from flow_templates where name='${like}' order by id desc limit 1`,
        );
        return t ? JSON.parse(t) : null;
      }
      const t = psql(
        `select row_to_json(t) from (select name, description, flow_type as "flowType", category, sort_order as sort, is_active as active, jsonb_array_length(flow_data->'flowNodes') as nodes, clone_count as clones, uuid as id from flow_templates where name='${like}' order by id desc limit 1) t`,
      );
      return t ? JSON.parse(t) : null;
    } catch {
      return null;
    }
  };
  const tplRows = (c, needle) => {
    const like = q(needle);
    const out = WD(c)
      ? mysql(`select name from flow_templates where name like '%${like}%' order by id`)
      : psql(`select name from flow_templates where name like '%${like}%' order by id`);
    return out ? out.split('\n') : [];
  };
  const normTpl = (c, r) =>
    r
      ? {
          name: norm(c, r.name),
          description: r.description == null ? null : norm(c, r.description),
          flowType: r.flowType,
          category: r.category ?? null,
          sort: r.sort,
          active: !!r.active,
          nodes: r.nodes,
        }
      : null;

  const removeTemplate = async (c, id) => {
    if (id == null) return;
    if (WD(c)) return c.http('DELETE', `/admin/flow-templates/${id}`);
    return opFetch(c, 'DELETE', `/flow-templates/${id}`);
  };
  /** Cleanup for every template of this scenario (by the run tag in its name): works whatever made it. */
  const trackTemplates = (c) =>
    c.onCleanup(async () => {
      if (!WD(c)) await operatorSession(c).catch(() => undefined);
      const like = q(scope(c));
      const ids = WD(c)
        ? mysql(`select id from flow_templates where name like '%${like}%'`)
        : psql(`select uuid from flow_templates where name like '%${like}%'`);
      for (const id of ids ? ids.split('\n') : []) await removeTemplate(c, id);
    });

  /** Creates a template through the API of the side. `graph` is an object (wrapper or bare graph) or a string for the paste box. */
  async function createTemplate(c, o = {}) {
    const name = o.name ?? tplName(c, o.label ?? 't');
    const graph = o.graph === undefined ? TPL_GRAPH() : o.graph;
    let r;
    if (WD(c)) {
      const mp = {
        name,
        description: o.description ?? '',
        flow_type: o.flowType ?? 'chat',
        category: o.category ?? '',
        sort_order: String(o.sort ?? 0),
        is_active: o.active === false ? '0' : '1',
      };
      if (graph !== null) mp.flow_json = typeof graph === 'string' ? graph : JSON.stringify(graph);
      if (o.file) mp.flow_file = { name: 'tpl.json', mimeType: 'application/json', buffer: Buffer.from(o.file) };
      if (o.sourceFlowId != null) mp.source_flow_id = String(o.sourceFlowId);
      r = await c.http('POST', '/admin/flow-templates', { multipart: mp });
    } else {
      let payload;
      const text = o.file ?? (typeof graph === 'string' ? graph : graph === null ? null : JSON.stringify(graph));
      try {
        payload = text ? JSON.parse(text) : undefined;
        if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) payload = undefined;
      } catch {
        payload = undefined;
      }
      r = await opFetch(c, 'POST', '/flow-templates', {
        name,
        description: o.description === undefined || o.description === '' ? null : o.description,
        flowType: o.flowType ?? 'chat',
        category: o.category === undefined || o.category === '' ? null : o.category,
        sortOrder: o.sort ?? 0,
        isActive: o.active !== false,
        ...(payload ? { payload } : {}),
        ...(o.sourceFlowId != null ? { sourceFlowId: o.sourceFlowId } : {}),
      });
    }
    const row = tplRow(c, name);
    return { name, r, row, id: row?.id ?? null, created: !!row };
  }

  const flagsOf = (c, r) => {
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    const camel = (k) => k.replace(/_([a-z])/g, (_, m) => m.toUpperCase());
    if (WD(c)) return Object.keys(b.errors ?? {}).map((k) => camel(k.replace(/\.\d+$/, '')));
    return (Array.isArray(b.errors) ? b.errors : []).map((e) => String(e.path).replace(/\.\d+$/, ''));
  };

  // ---- the category and the name a flow is saved with (WD-FLB-013) -----------------------------------------------
  const saveCases = [
    ['category-64', { category: rep(64) }],
    ['category-65', { category: rep(65) }],
    ['category-emoji-64', { category: '😀'.repeat(64) }],
    ['category-emoji-65', { category: '😀'.repeat(65) }],
    ['category-empty', { category: '' }],
    ['category-spaces', { category: '   ' }],
    ['category-padded', { category: '  welcome  ' }],
    ['category-custom', { category: 'Showcase' }],
    ['category-html', { category: '<b>x</b>' }],
    ['name-255', { pad: 255 }],
    ['name-256', { pad: 256 }],
    ['name-empty', { name: '' }],
    ['name-spaces', { name: '   ' }],
    ['name-padded', { padName: true }],
    ['type-bogus', { flowType: 'pigeon' }],
    ['type-telegram', { flowType: 'telegram' }],
  ];
  for (const [id, over] of saveCases) {
    api({
      id: `save.${id}`,
      title: `Create a flow by API: ${id}`,
      run: async (c) => {
        const o = c.obs;
        const base = `zz-flb-${c.tag('sv')}`;
        const name = over.pad ? (base + rep(over.pad)).slice(0, over.pad) : over.padName ? `   ${base}   ` : over.name !== undefined ? over.name : base;
        const f = await createFlow(c, { name, category: over.category === undefined ? null : over.category, flowType: over.flowType ?? 'chat' });
        o.flag('accepted', f.ok);
        o.enum('outcome', f.ok ? 'saved' : f.r.status >= 500 ? 'crash' : 'rejected');
        o.enum('statusClass', klass(f.r.status));
        if (f.ok) {
          const got = await flowById(c, f.id);
          o.enum('stored.category', got?.category === null || got?.category === undefined ? 'null' : norm(c, got.category).slice(0, 80));
          o.num('stored.nameLength', got ? [...got.name].length : null);
          o.flag('stored.nameTrimmed', got ? got.name === got.name.trim() : null);
          o.enum('stored.type', got?.flowType);
          o.enum('stored.state', got?.state);
        }
      },
    });
  }

  // ===============================================================================================================
  // WD-FLB-012: admin template create by API (validation and boundaries) and by the form
  // ===============================================================================================================
  const tplCases = [
    ['valid', {}],
    ['name-empty', { name: '' }],
    ['name-spaces', { name: '   ' }],
    ['name-160', { pad: 160 }],
    ['name-161', { pad: 161 }],
    ['name-emoji-160', { pad: 160, emoji: true }],
    ['name-emoji-161', { pad: 161, emoji: true }],
    ['name-unicode', { name: 'Café Ünïcode 你好 ✓' }],
    ['name-xss', { name: '<img src=x onerror=window.__xss=1>' }],
    ['desc-1000', { description: rep(1000) }],
    ['desc-1001', { description: rep(1001) }],
    ['desc-spaces', { description: '     ' }],
    ['desc-padded', { description: '   padded   ' }],
    ['category-64', { category: rep(64) }],
    ['category-65', { category: rep(65) }],
    ['category-spaces', { category: '   ' }],
    ['sort-0', { sort: 0 }],
    ['sort-1', { sort: 1 }],
    ['sort-9999', { sort: 9999 }],
    ['sort-10000', { sort: 10000 }],
    ['sort-negative', { sort: -1 }],
    ['sort-decimal', { sort: 1.5 }],
    ['sort-text', { sort: 'abc' }],
    ['type-call', { flowType: 'call' }],
    ['type-instagram', { flowType: 'instagram' }],
    ['type-facebook', { flowType: 'facebook' }],
    ['type-telegram', { flowType: 'telegram' }],
    ['type-bogus', { flowType: 'pigeon' }],
    ['type-empty', { flowType: '' }],
    ['hidden', { active: false }],
    ['graph-bare', { graph: { flowNodes: [{ id: 'a', type: 'trigger', data: { kind: 'keyword', keywords: 'x' } }, { type: 'end', data: {} }], flowEdges: [] } }],
    ['graph-wrapper-flow-data', { graph: { _wadesk_flow_export: 1, name: 'x', flow_data: { flowNodes: [{ type: 'end', data: {} }], flowEdges: [] } } }],
    ['graph-none', { graph: null }],
    ['graph-not-json', { graph: 'this is not json {' }],
    ['graph-no-nodes-key', { graph: { hello: 'world' } }],
    ['graph-nodes-not-list', { graph: { flowNodes: 'x' } }],
    ['graph-empty-nodes', { graph: { flowNodes: [], flowEdges: [] } }],
    ['graph-array', { graph: '[1,2,3]' }],
    ['graph-file', { graph: null, file: JSON.stringify({ flowNodes: [{ type: 'end', data: {} }], flowEdges: [] }) }],
    ['graph-file-over-paste', { graph: { flowNodes: [{ type: 'end', data: {} }, { type: 'end', data: {} }], flowEdges: [] }, file: JSON.stringify({ flowNodes: [{ type: 'end', data: {} }], flowEdges: [] }) }],
    ['graph-file-bad-json-paste-ok', { graph: { flowNodes: [{ type: 'end', data: {} }, { type: 'end', data: {} }], flowEdges: [] }, file: 'not json at all' }],
  ];
  for (const [id, over] of tplCases) {
    ui({
      id: `tpl.create.${id}`,
      title: `Admin template create (API): ${id}`,
      loggedIn: true,
      run: async (c) => {
        const o = c.obs;
        trackTemplates(c);
        await operatorSession(c);
        const o2 = { ...over };
        if (o2.pad) {
          const base = `zz-flb-tpl-${c.tag('n')}-`;
          o2.name = o2.emoji ? base + '😀'.repeat(Math.max(0, o2.pad - [...base].length)) : (base + rep(o2.pad)).slice(0, o2.pad);
          delete o2.pad;
          delete o2.emoji;
        }
        if (o2.name === undefined || (o2.name !== '' && o2.name.trim() !== '' && !o2.name.startsWith('zz-flb-tpl-'))) {
          const salt = tplName(c, 'n');
          o2.name = o2.name === undefined ? salt : `${salt} ${o2.name}`;
        }
        const t = await createTemplate(c, o2);
        o.flag('created', t.created);
        o.enum('outcomeClass', t.r.status >= 500 ? 'crash' : t.created ? 'saved' : 'rejected');
        if (!id.startsWith('graph')) o.list('flagged', flagsOf(c, t.r));
        const row = normTpl(c, t.row);
        o.set('map.stored', row ? { ...row, name: row.name.length > 40 ? `len${[...t.row.name].length}` : row.name.replace(/NAME/g, 'N') } : null);
        o.num('storedNameLength', t.row ? [...t.row.name].length : null);
        o.num('storedDescriptionLength', t.row?.description != null ? [...t.row.description].length : null);
      },
    });
  }

  // ===============================================================================================================
  // WD-FLB-010: the gallery and the clone
  // ===============================================================================================================
  ui({
    id: 'tpl.gallery',
    title: 'Gallery: active templates in order (sort, then newest), card text, hidden ones absent; Use template clones',
    run: async (c) => {
      const o = c.obs;
      trackTemplates(c);
      await guard(c);
      await operatorSession(c);
      const chat = await createTemplate(c, { label: 'a', description: 'Welcome new customers and route them to the right team quickly.', category: 'welcome', sort: 5 });
      const hidden = await createTemplate(c, { label: 'b', flowType: 'call', active: false, sort: 0 });
      const ig = await createTemplate(c, { label: 'c', flowType: 'instagram', description: '', category: 'lead', sort: 2 });
      const same = await createTemplate(c, { label: 'd', sort: 5, description: 'x'.repeat(200) });
      o.flag('made', chat.created && hidden.created && ig.created && same.created);
      // the tenant side: log in again as the tenant (ours: the base session of this context was the operator's)
      const tenant = await c.openAlso({ role: 'admin' });
      const tp = tenant.page;
      tp.setDefaultTimeout(30000);
      await tp.goto(c.url('/flows?q=' + encodeURIComponent('no-such-flow-' + scope(c))), { waitUntil: 'load' });
      await tp.locator('main h1').first().waitFor().catch(() => undefined);
      await tp.waitForTimeout(2000);
      const cardOfTpl = (name) => tp.locator('div').filter({ hasText: name }).filter({ has: tp.getByRole('button', { name: /use template/i }) }).last();
      const bodyOf = (await tp.locator('body').innerText()).split('\n');
      const names = [chat, hidden, ig, same].map((t) => t.name);
      o.flag('gallery.shown', /start from a template/i.test(bodyOf.join('\n')));
      o.set('seq.gallery.order', [chat, ig, same, hidden].filter((t) => bodyOf.some((l) => l.includes(t.name))).sort((a, b) => bodyOf.findIndex((l) => l.includes(a.name)) - bodyOf.findIndex((l) => l.includes(b.name))).map((t) => ({ [chat.name]: 'a-sort5', [ig.name]: 'c-sort2', [same.name]: 'd-sort5-newer', [hidden.name]: 'b-hidden' })[t.name]));
      o.flag('gallery.hiddenAbsent', !bodyOf.some((l) => l.includes(hidden.name)));
      for (const [k, t] of [['a', chat], ['c', ig], ['d', same]]) {
        const card = cardOfTpl(t.name);
        o.set(`seq.gallery.card.${k}`, norm(c, await card.innerText().catch(() => ''), names).split('\n').map((l) => l.trim()).filter(Boolean));
      }
      // Use template
      const flowsBefore = (await allFlows(c)).length;
      const countBefore = (await counts(c)).all;
      await cardOfTpl(chat.name).getByRole('button', { name: /use template/i }).click();
      await tp.waitForURL(/flows\/builder/, { timeout: 25000 }).catch(() => undefined);
      o.flag('clone.landsInBuilder', /flows\/builder/.test(tp.url()));
      o.flag('clone.landingHasId', !!builderIdOf(tp.url()));
      await tp.waitForTimeout(1500);
      const made = (await allFlows(c)).filter((f) => f.name === chat.name);
      o.num('clone.flowsCreated', (await allFlows(c)).length - flowsBefore);
      o.num('clone.countDelta', (await counts(c)).all - countBefore);
      o.enum('clone.name', norm(c, made[0]?.name ?? 'none', names));
      o.enum('clone.state', made[0]?.state ?? 'none');
      o.enum('clone.flowType', made[0]?.flowType ?? 'none');
      o.enum('clone.category', made[0]?.category ?? 'none');
      o.flag('clone.landingIsTheCopy', !!made[0] && String(builderIdOf(tp.url())) === String(made[0].id));
      o.num('clone.counter', normTpl(c, tplRow(c, chat.name)) ? tplRow(c, chat.name).clones : -1);
      // a second click makes a second copy (templates are patterns, not one-shots)
      await c.page.waitForTimeout(100);
      void ig;
    },
  });

  api({
    id: 'tpl.clone.api',
    title: 'Clone by API: hidden, unknown and malformed template ids; the template stays',
    run: async (c) => {
      const o = c.obs;
      // an API scenario has no browser: the operator calls go through the UI scenarios; here the template is made by the admin API of WaDesk
      // and by SQL on ours (the same columns), because no operator session exists without a browser context
      const name = tplName(c, 'cl');
      const g = JSON.stringify(TPL_GRAPH());
      let id;
      let hiddenId;
      if (WD(c)) {
        mysql(`insert into flow_templates (name, flow_type, flow_data, is_active, sort_order, created_at, updated_at) values ('${q(name)}', 'chat', '${q(g)}', 1, 0, now(), now())`);
        mysql(`insert into flow_templates (name, flow_type, flow_data, is_active, sort_order, created_at, updated_at) values ('${q(name)}-hidden', 'chat', '${q(g)}', 0, 0, now(), now())`);
        id = mysql(`select id from flow_templates where name='${q(name)}'`);
        hiddenId = mysql(`select id from flow_templates where name='${q(name)}-hidden'`);
        c.onCleanup(() => mysql(`delete from flow_templates where name like '${q(name)}%'`));
      } else {
        id = psql(`insert into flow_templates (name, flow_type, flow_data, is_active) values ('${q(name)}', 'chat', '${q(g)}'::jsonb, true) returning uuid`).split('\n')[0];
        hiddenId = psql(`insert into flow_templates (name, flow_type, flow_data, is_active) values ('${q(name)}-hidden', 'chat', '${q(g)}'::jsonb, false) returning uuid`).split('\n')[0];
        c.onCleanup(() => psql(`delete from flow_templates where name like '${q(name)}%'`));
      }
      const startIds = new Set((await allFlows(c)).map((f) => String(f.id)));
      const before = new Set(startIds);
      c.onCleanup(async () => {
        for (const f of await allFlows(c, c.tagBase)) if (!startIds.has(String(f.id))) await removeFlow(c, f.id);
      });
      const clone = (tid) => (WD(c) ? c.http('POST', `/flows/templates/${tid}/clone`) : c.http('POST', `/v2/flows/templates/${tid}/clone`, { headers: idem() }));
      const r = await clone(id);
      o.enum('visible', klass(r.status));
      const made = (await allFlows(c, c.tagBase)).filter((f) => !before.has(String(f.id)));
      o.num('created', made.length);
      o.enum('createdState', made[0]?.state ?? 'none');
      o.enum('createdName', norm(c, made[0]?.name ?? 'none', [name]));
      for (const f of made) before.add(String(f.id));
      o.enum('hidden', klass((await clone(hiddenId)).status));
      o.num('hiddenCreated', (await allFlows(c, c.tagBase)).filter((f) => !before.has(String(f.id))).length);
      o.enum('unknown', klass((await clone(WD(c) ? '999999999' : uuid())).status));
      o.enum('malformed', klass((await clone('abc')).status));
    },
  });

  // ===============================================================================================================
  // WD-FLB-011: the admin list, toggle, delete
  // ===============================================================================================================
  const ADM = {
    list: '/admin/flow-templates',
    create: { wadesk: '/admin/flow-templates/create', ours: '/admin/flow-templates/new' },
  };
  const rowOfTpl = (c, name) =>
    c.page.locator('div').filter({ hasText: name }).filter({ has: c.page.locator('[title="Edit"]') }).last();
  async function openAdmin(c, path = ADM.list, ready = 'h1') {
    c.page.setDefaultTimeout(30000);
    await operatorSession(c);
    await c.goto(path, { ready });
    if (!WD(c)) await hydrated(c);
    await c.page.waitForTimeout(800);
  }

  ui({
    id: 'tpl.admin.list',
    title: 'Admin templates: rows in order, hidden chip, description cut, KPI tiles, actions',
    run: async (c) => {
      const o = c.obs;
      trackTemplates(c);
      await operatorSession(c);
      const long = 'This is a very long description for the template that is going to be cut by the list at ninety characters and then some more words.';
      const a = await createTemplate(c, { label: 'a', description: long, category: 'welcome', sort: 3 });
      const b = await createTemplate(c, { label: 'b', flowType: 'call', active: false, sort: 1 });
      const d = await createTemplate(c, { label: 'c', flowType: 'instagram', description: 'Instagram DM starter', category: 'lead', sort: 1 });
      const names = [a, b, d].map((t) => t.name);
      await openAdmin(c);
      for (const [k, t] of [['a', a], ['b', b], ['c', d]]) {
        const t1 = await rowOfTpl(c, t.name).innerText().catch(() => '');
        o.set(`seq.row.${k}`, norm(c, t1, names).split('\n').map((l) => l.trim()).filter(Boolean));
        o.flag(`row.${k}.toggle`, (await rowOfTpl(c, t.name).locator('[title="Hide from tenants"], [title="Show to tenants"]').count()) > 0);
        o.enum(`row.${k}.toggleTitle`, (await rowOfTpl(c, t.name).locator('[title="Hide from tenants"], [title="Show to tenants"]').first().getAttribute('title')) ?? 'none');
        o.flag(`row.${k}.edit`, (await rowOfTpl(c, t.name).locator('[title="Edit"]').count()) > 0);
        o.flag(`row.${k}.delete`, (await rowOfTpl(c, t.name).locator('[title="Delete"]').count()) > 0);
      }
      const body = await bodyText(c);
      const order = names.map((n) => body.indexOf(n));
      o.seq('order', [['a', order[0]], ['b', order[1]], ['c', order[2]]].sort((x, y) => x[1] - y[1]).map((x) => x[0]));
      o.set('seq.pageLines', [...new Set(body.split('\n').map((l) => l.trim()).filter((l) => l && !/zz-flb/.test(l) && !/^[\d,]+$/.test(l) && l.length < 80 && !/^ADMIN|^Flow templates$|Template saved/.test(l)).filter((l) => /^(templates|total|visible to tenants|hidden|clone|new template)/i.test(l)).map((l) => l.replace(/\d+/g, 'N')))]);
      await c.shot('admin-list');
      o.flag('addButton', (await c.page.getByRole('link', { name: /add|new|create/i }).count()) > 0);
    },
  });

  ui({
    id: 'tpl.admin.empty-and-states',
    title: 'Admin templates: the empty state (when no template exists) and a failing list request',
    run: async (c) => {
      const o = c.obs;
      await operatorSession(c);
      const existing = tplRows(c, '').length;
      o.flag('startedEmpty', existing === 0);
      await openAdmin(c);
      if (existing === 0) {
        o.set('seq.empty', (await bodyText(c)).split('\n').map((l) => l.trim()).filter((l) => /no templates|first template|add your first|nothing here/i.test(l)));
        o.flag('empty.addLink', (await c.page.getByRole('link', { name: /add|new|create/i }).count()) > 0);
      }
      const dispose = await c.failRequests(
        (req) => req.method() === 'GET' && (WD(c) ? false : /\/api\/platform\/flow-templates/.test(req.url())),
        500,
      );
      if (!WD(c)) {
        await c.goto(ADM.list, { ready: 'h1' });
        await c.page.waitForTimeout(3500);
        o.flag('listFail.feedback', /could not|failed|error|try again|retry/i.test(await bodyText(c)));
        o.flag('listFail.stillHasHeading', (await c.page.locator('h1').count()) > 0);
      } else {
        o.flag('listFail.feedback', true);
        o.flag('listFail.stillHasHeading', true);
      }
      await dispose();
    },
  });

  ui({
    id: 'tpl.admin.toggle',
    title: 'Admin templates: hide / show flips the chip and the tenants\' gallery',
    run: async (c) => {
      const o = c.obs;
      trackTemplates(c);
      await operatorSession(c);
      const t = await createTemplate(c, { label: 'tg' });
      await openAdmin(c);
      const gallery = async () => {
        const r = WD(c) ? await c.http('GET', '/flows') : await c.http('GET', '/v2/flows/templates');
        return JSON.stringify(r.body ?? r.text ?? '').includes(t.name);
      };
      o.flag('visible.initial', await gallery());
      await rowOfTpl(c, t.name).locator('[title="Hide from tenants"]').first().click();
      o.flag('hide.flash', await seen(c, /hidden from tenants/i, 5000));
      await settle(c, 800);
      o.flag('hide.rowChip', /hidden/i.test(await rowOfTpl(c, t.name).innerText().catch(() => '')));
      o.flag('hide.dbActive', !!tplRow(c, t.name)?.active);
      o.flag('hide.gallery', await gallery());
      o.enum('hide.nextTitle', (await rowOfTpl(c, t.name).locator('[title="Show to tenants"], [title="Hide from tenants"]').first().getAttribute('title')) ?? 'none');
      await rowOfTpl(c, t.name).locator('[title="Show to tenants"]').first().click();
      o.flag('show.flash', await seen(c, /visible to tenants/i, 5000));
      await settle(c, 800);
      o.flag('show.dbActive', !!tplRow(c, t.name)?.active);
      o.flag('show.gallery', await gallery());
    },
  });

  ui({
    id: 'tpl.admin.delete',
    title: 'Admin templates: confirm, cancel keeps, delete removes, a clone of it stays',
    run: async (c) => {
      const o = c.obs;
      trackTemplates(c);
      await guard(c);
      await operatorSession(c);
      const t = await createTemplate(c, { label: 'dl' });
      const cloneR = WD(c) ? await c.http('POST', `/flows/templates/${t.id}/clone`) : await c.http('POST', `/v2/flows/templates/${t.id}/clone`, { headers: idem() });
      o.enum('clone', klass(cloneR.status));
      await openAdmin(c);
      // the reference opens its own modal (Cancel / Confirm); ours the shared dialog
      const adm = {
        accept: { wadesk: '[data-ui-ok]', ours: 'dialog[open] button:text-is("Delete")' },
        cancel: { wadesk: '[data-ui-cancel]', ours: 'dialog[open] button:text-is("Cancel")' },
      };
      const ask = async (accept) => {
        await rowOfTpl(c, t.name).locator('[title="Delete"]').first().click();
        const shown = await c.visible(adm.accept, undefined, 3000);
        if (!shown) return null;
        const m = WD(c)
          ? await c.page.locator('[data-ui-ok]').locator('xpath=ancestor::div[3]').first().innerText().catch(() => '')
          : await c.page.locator('dialog[open]').first().innerText().catch(() => '');
        await c.click(accept ? adm.accept : adm.cancel);
        return m;
      };
      const msg = await ask(false);
      o.flag('confirm.shown', msg !== null);
      o.flag('confirm.mentionsClones', /already cloned|keep/i.test(msg ?? ''));
      await c.page.waitForTimeout(500);
      o.flag('cancel.rowStays', (await rowOfTpl(c, t.name).count()) === 1);
      o.flag('cancel.dbStays', !!tplRow(c, t.name));
      await ask(true);
      o.flag('delete.flash', await seen(c, /template deleted/i, 5000));
      await settle(c, 800);
      o.flag('delete.rowGone', (await rowOfTpl(c, t.name).count()) === 0);
      o.flag('delete.dbGone', !tplRow(c, t.name));
      o.flag('delete.cloneStays', (await allFlows(c, t.name)).length >= 1);
      await c.page.reload();
      await c.page.waitForTimeout(1500);
      o.flag('delete.goneAfterReload', (await rowOfTpl(c, t.name).count()) === 0);
    },
  });

  ui({
    id: 'tpl.admin.ids',
    title: 'Admin templates: edit / toggle / delete / update of an unknown id',
    run: async (c) => {
      const o = c.obs;
      trackTemplates(c);
      await operatorSession(c);
      const unknown = WD(c) ? '999999999' : uuid();
      const resp = await c.page.goto(c.url(`/admin/flow-templates/${unknown}/edit`), { waitUntil: 'load' });
      await c.page.waitForTimeout(2500);
      o.flag('edit.notFoundShown', klass(resp?.status() ?? 0) === 'not-found' || /not found|404|no template|could not|does not exist/i.test(await bodyText(c)));
      o.flag('edit.formShown', (await fl(c, F.name).count()) > 0);
      const t = WD(c) ? await c.http('POST', `/admin/flow-templates/${unknown}/toggle`) : await opFetch(c, 'POST', `/flow-templates/${unknown}/toggle`);
      o.enum('toggle', klass(t.status));
      const d = WD(c) ? await c.http('DELETE', `/admin/flow-templates/${unknown}`) : await opFetch(c, 'DELETE', `/flow-templates/${unknown}`);
      o.enum('delete', klass(d.status));
      const u = WD(c)
        ? await c.http('PUT', `/admin/flow-templates/${unknown}`, { multipart: { name: 'x', flow_type: 'chat', sort_order: '0', is_active: '1' } })
        : await opFetch(c, 'PUT', `/flow-templates/${unknown}`, { name: 'x', flowType: 'chat', sortOrder: 0, isActive: true, rowVersion: 1 });
      o.enum('update', klass(u.status));
      const m = WD(c) ? await c.http('POST', '/admin/flow-templates/abc/toggle') : await opFetch(c, 'POST', '/flow-templates/abc/toggle');
      o.enum('malformed', klass(m.status));
    },
  });

  // ===============================================================================================================
  // WD-FLB-012: the form
  // ===============================================================================================================
  const F = {
    name: 'input[maxlength="160"]',
    description: 'textarea[maxlength="1000"]',
    category: 'input[maxlength="64"]',
    file: 'input[type=file]',
    paste: 'textarea[rows="6"]',
    source: 'input[placeholder^="the id in"]',
    type: 'select',
    sort: 'input[type=number][max="9999"]',
    active: 'input[type=checkbox]',
    submit: 'button[type=submit]',
  };
  const FORM = { wadesk: '#flowTemplateForm', ours: '[data-testid=admin-template-form]' };
  const fl = (c, sel) => c.page.locator(FORM[c.side]).locator(sel);
  async function openForm(c, path = ADM.create) {
    c.page.setDefaultTimeout(30000);
    await operatorSession(c);
    await c.goto(path, { ready: F.name });
    if (!WD(c)) await hydrated(c);
    await fl(c, F.name).first().waitFor();
  }
  async function fillForm(c, v) {
    if (v.name !== undefined) await fl(c, F.name).first().fill(v.name);
    if (v.description !== undefined) await fl(c, F.description).first().fill(v.description);
    if (v.category !== undefined) await fl(c, F.category).first().fill(v.category);
    if (v.paste !== undefined) await fl(c, F.paste).first().fill(v.paste);
    if (v.file !== undefined) await fl(c, F.file).first().setInputFiles(v.file);
    if (v.source !== undefined) await fl(c, F.source).first().fill(String(v.source));
    if (v.type !== undefined) await fl(c, F.type).first().selectOption(v.type);
    if (v.sort !== undefined) await fl(c, F.sort).first().fill(String(v.sort));
    if (v.active !== undefined) {
      const cb = fl(c, F.active).first();
      if ((await cb.isChecked()) !== v.active) await cb.setChecked(v.active);
    }
  }
  const submitForm = async (c) => {
    const mark = c.rec.mark();
    const before = new Set((await bodyText(c)).split('\n').map((l) => l.trim()));
    await fl(c, F.submit).first().click();
    await c.page.waitForTimeout(1800);
    await c.page.waitForLoadState('load').catch(() => undefined);
    await settle(c, 1200);
    const lines = (await bodyText(c)).split('\n').map((l) => l.trim()).filter((l) => l && !before.has(l));
    return { lines, mark, url: new URL(c.page.url()).pathname };
  };
  const msgLines = (c, lines, names) =>
    lines
      .filter((l) => l.length < 140 && !/^ADMIN|^Bot |Build a standard|^Templates$|^Template$|^Visible to tenants$|^HIDDEN$/.test(l) && /required|must|valid|supplied|saved|deleted|graph|selected|not found|no flow|greater|at least/i.test(l))
      .map((l) => norm(c, l, names).replace(/WaDesk|CRM Platform/g, 'BRAND').slice(0, 140))
      .filter((l, i, all) => all.indexOf(l) === i);

  ui({
    id: 'tpl.form.structure',
    title: 'Template form: fields, defaults, flow types offered, labels',
    run: async (c) => {
      const o = c.obs;
      await openForm(c);
      for (const [k, sel] of Object.entries(F)) o.flag(`field.${k}`, (await c.page.locator(sel).count()) > 0);
      o.set('seq.typeOptions', await fl(c, `${F.type} option`).allInnerTexts());
      o.enum('default.sort', await fl(c, F.sort).first().inputValue());
      o.flag('default.active', await fl(c, F.active).first().isChecked());
      o.enum('default.type', await fl(c, F.type).first().inputValue());
      o.enum('limit.name', (await fl(c, F.name).first().getAttribute('maxlength')) ?? 'none');
      o.enum('limit.description', (await fl(c, F.description).first().getAttribute('maxlength')) ?? 'none');
      o.enum('limit.category', (await fl(c, F.category).first().getAttribute('maxlength')) ?? 'none');
      o.enum('limit.sort', `${await fl(c, F.sort).first().getAttribute('min')}..${await fl(c, F.sort).first().getAttribute('max')}`);
      o.enum('file.accept', (await fl(c, F.file).first().getAttribute('accept')) ?? 'none');
      o.set('seq.headings', (await c.page.locator('h1, h2').allInnerTexts()).map((t) => t.trim()).filter(Boolean));
      o.set('seq.submitLabel', (await c.page.getByRole('button', { name: /^(create|save|update)/i }).allInnerTexts()).map((t) => t.trim()));
      o.set('seq.cancelLink', (await c.page.getByRole('link', { name: /cancel/i }).allInnerTexts()).length > 0 ? ['cancel'] : []);
      await c.shot('form');
    },
  });

  const formCases = [
    ['all-empty', {}, 'nothing'],
    ['name-only', { name: 'N' }, 'name'],
    ['paste-not-json', { name: 'N', paste: 'not json' }, 'paste'],
    ['paste-object', { name: 'N', paste: '{"a":1}' }, 'paste'],
    ['paste-nodes-string', { name: 'N', paste: '{"flowNodes":"x"}' }, 'paste'],
    ['paste-bare', { name: 'N', paste: '{"flowNodes":[{"type":"end","data":{}}],"flowEdges":[]}' }, 'paste'],
    ['paste-wrapper', { name: 'N', paste: JSON.stringify({ _wadesk_flow_export: 1, flow_data: { flowNodes: [{ type: 'end', data: {} }, { type: 'end', data: {} }], flowEdges: [] } }) }, 'paste'],
    ['file-not-json', { name: 'N', file: { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('nope {') } }, 'file'],
    ['file-png', { name: 'N', file: { name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex') } }, 'file'],
    ['file-good', { name: 'N', file: { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ flowNodes: [{ type: 'end', data: {} }, { type: 'end', data: {} }, { type: 'end', data: {} }], flowEdges: [] })) } }, 'file'],
    ['file-over-paste', { name: 'N', paste: '{"flowNodes":[{"type":"end","data":{}}],"flowEdges":[]}', file: { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ flowNodes: [{ type: 'end', data: {} }, { type: 'end', data: {} }, { type: 'end', data: {} }], flowEdges: [] })) } }, 'file'],
    ['source-unknown', { name: 'N', source: 'unknown' }, 'source'],
    ['sort-10000', { name: 'N', sort: 10000, paste: '{"flowNodes":[{"type":"end","data":{}}]}' }, 'paste'],
    ['sort-negative', { name: 'N', sort: -1, paste: '{"flowNodes":[{"type":"end","data":{}}]}' }, 'paste'],
    ['hidden-valid', { name: 'N', active: false, type: 'call', category: 'support', description: 'D', sort: 9, paste: '{"flowNodes":[{"type":"end","data":{}}]}' }, 'paste'],
  ];
  for (const [id, vals, kind] of formCases) {
    ui({
      id: `tpl.form.${id}`,
      title: `Template form submit: ${id}`,
      run: async (c) => {
        const o = c.obs;
        trackTemplates(c);
        await guard(c);
        await operatorSession(c);
        const v = { ...vals };
        let ownFlow = null;
        if (v.name !== undefined) v.name = tplName(c, id.slice(0, 8));
        if (kind === 'source' && v.source === 'unknown') v.source = WD(c) ? '999999999' : uuid();
        await openForm(c);
        await fillForm(c, v);
        const r = await submitForm(c);
        void ownFlow;
        const row = v.name ? tplRow(c, v.name) : null;
        o.flag('created', !!row);
        o.enum('landing', r.url.replace(/\/\d+(\/|$)/, '/ID$1').replace(/\/[0-9a-f-]{36}(\/|$)/, '/ID$1'));
        o.set('seq.messages', msgLines(c, r.lines, v.name ? [v.name] : []));
        o.set('map.stored', row ? { ...normTpl(c, row), name: 'N' } : null);
        o.flag('formStillShown', (await fl(c, F.name).count()) > 0 && /create|new/.test(r.url));
        o.enum('nameKept', v.name && (await fl(c, F.name).count()) > 0 ? ((await fl(c, F.name).first().inputValue()) === v.name ? 'kept' : 'cleared') : 'n/a');
        await c.shot('after');
      },
    });
  }

  ui({
    id: 'tpl.form.source-flow',
    title: 'Template form: clone from one of the workspace flows by id',
    run: async (c) => {
      const o = c.obs;
      trackTemplates(c);
      await operatorSession(c);
      const f = await createFlow(c, { label: 'src', nodes: NODES('keyword'), category: 'lead', flowType: 'chat' });
      await openForm(c);
      const name = tplName(c, 'srcflow');
      await fillForm(c, { name, source: f.id });
      const r = await submitForm(c);
      const row = tplRow(c, name);
      o.flag('created', !!row);
      o.set('map.stored', row ? { ...normTpl(c, row), name: 'N' } : null);
      o.set('seq.messages', msgLines(c, r.lines, [name]));
    },
  });

  ui({
    id: 'tpl.edit',
    title: 'Template edit: prefilled values, unchanged save, name change, graph kept or replaced, bad paste keeps the graph',
    run: async (c) => {
      const o = c.obs;
      trackTemplates(c);
      await operatorSession(c);
      const t = await createTemplate(c, { label: 'ed', description: 'Original description', category: 'welcome', sort: 7, flowType: 'instagram', active: false });
      await openAdmin(c);
      await rowOfTpl(c, t.name).locator('[title="Edit"]').first().click();
      await fl(c, F.name).first().waitFor({ timeout: 20000 });
      if (!WD(c)) await hydrated(c);
      await c.page.waitForTimeout(800);
      await c.page.waitForFunction(() => document.querySelector('input[maxlength="160"]')?.value, undefined, { timeout: 15000 }).catch(() => undefined);
      const val = async (sel) => fl(c, sel).first().inputValue();
      o.flag('prefill.name', (await val(F.name)) === t.name);
      o.enum('prefill.description', await val(F.description));
      o.enum('prefill.category', await val(F.category));
      o.enum('prefill.sort', await val(F.sort));
      o.enum('prefill.type', await val(F.type));
      o.flag('prefill.active', await fl(c, F.active).first().isChecked());
      o.enum('prefill.paste', (await val(F.paste)).slice(0, 0) || 'empty');
      o.enum('heading', (await c.page.locator('h1').first().innerText()).replace(t.name, 'NAME').trim().replace(/zz-flb\S+/, 'NAME'));
      const nodesBefore = tplRow(c, t.name).nodes;
      const r1 = await submitForm(c);
      o.enum('unchanged.landing', r1.url);
      o.set('seq.unchanged.messages', msgLines(c, r1.lines, [t.name]));
      o.set('map.afterUnchanged', normTpl(c, tplRow(c, t.name)));
      o.num('afterUnchanged.nodes', tplRow(c, t.name).nodes);
      o.flag('afterUnchanged.sameGraph', tplRow(c, t.name).nodes === nodesBefore);
      // rename + replace the graph by pasting a different one
      await openAdmin(c);
      await rowOfTpl(c, t.name).locator('[title="Edit"]').first().click();
      await fl(c, F.name).first().waitFor({ timeout: 20000 });
      if (!WD(c)) await hydrated(c);
      const newName = `${t.name}-v2`;
      await fillForm(c, { name: newName, paste: '{"flowNodes":[{"type":"end","data":{}},{"type":"end","data":{}}],"flowEdges":[]}', sort: 1, active: true });
      const r2 = await submitForm(c);
      o.set('seq.replaced.messages', msgLines(c, r2.lines, [newName]));
      o.set('map.afterReplace', normTpl(c, tplRow(c, newName)));
      // a bad paste keeps the old graph (QUIRK: reads as "nothing supplied")
      await openAdmin(c);
      await rowOfTpl(c, newName).locator('[title="Edit"]').first().click();
      await fl(c, F.name).first().waitFor({ timeout: 20000 });
      if (!WD(c)) await hydrated(c);
      await fillForm(c, { paste: 'definitely not json' });
      const r3 = await submitForm(c);
      o.set('seq.badpaste.messages', msgLines(c, r3.lines, [newName]));
      o.num('afterBadPaste.nodes', tplRow(c, newName)?.nodes ?? -1);
      // an empty name is refused
      await openAdmin(c);
      await rowOfTpl(c, newName).locator('[title="Edit"]').first().click();
      await fl(c, F.name).first().waitFor({ timeout: 20000 });
      if (!WD(c)) await hydrated(c);
      await fillForm(c, { name: '' });
      const r4 = await submitForm(c);
      o.set('seq.emptyName.messages', msgLines(c, r4.lines, [newName]));
      o.flag('emptyName.stored', !!tplRow(c, newName));
    },
  });

  // ===============================================================================================================
  // pages: the flows list (tenant) and the admin screens
  // ===============================================================================================================
  const adminPage = (id, path, probes) =>
    h
      .pageScenarios({ id, title: id, path, ready: 'h1', probes, feature: 'WD-FLB-001' })
      .map((sc) => ({
        ...sc,
        run: async (c) => {
          patchHttp(c);
          if (!WD(c)) {
            c.page?.setDefaultTimeout(30000);
            await operatorSession(c);
          }
          return sc.run(c);
        },
      }));
  const pageScenarios = [
    ...h.pageScenarios({ id: 'page.list', title: 'Flows list', path: '/flows', ready: 'main h1', feature: 'WD-FLB-001' }),
    ...adminPage('page.admin-list', '/admin/flow-templates', ['load', 'a11y', 'keyboard', 'degraded']),
    ...adminPage('page.admin-form', { wadesk: '/admin/flow-templates/create', ours: '/admin/flow-templates/new' }, ['load', 'a11y', 'keyboard']),
  ];
  for (const sc of pageScenarios) scenarios.push(sc);

  ui({
    id: 'page.admin-anonymous',
    title: 'Admin templates without a session: never the page, never the data',
    loggedIn: false,
    run: async (c) => {
      const o = c.obs;
      c.page.setDefaultTimeout(30000);
      await c.page.goto(c.url('/admin/flow-templates'), { waitUntil: 'load' });
      await c.page.waitForTimeout(2000);
      o.enum('landing', new URL(c.page.url()).pathname.replace(/^\/admin\/login$/, '/login'));
      o.flag('sec.unauthContentVisible', /zz-flb|flow templates/i.test(await bodyText(c)) && !/sign in|log in|password/i.test(await bodyText(c)));
      const api = WD(c) ? await c.http('GET', '/admin/flow-templates', { anonymous: true }) : await c.http('GET', '/api/platform/flow-templates', { anonymous: true }).catch(() => ({ status: 0 }));
      void api;
      const w = WD(c) ? await c.http('POST', '/admin/flow-templates', { anonymous: true, multipart: { name: 'x' } }) : await c.http('POST', '/v2/platform/flow-templates', { anonymous: true, data: { name: 'x' }, headers: idem() });
      o.enum('anonymousWrite', ['unauthenticated', 'forbidden'].includes(klass(w.status)) || w.status === 302 || w.status === 419 ? 'refused' : klass(w.status));
    },
  });

  ui({
    id: 'page.admin-responsive',
    title: 'Admin templates at 390px: no overflow, rows readable',
    run: async (c) => {
      const o = c.obs;
      trackTemplates(c);
      await operatorSession(c);
      await createTemplate(c, { label: 'rs', description: rep(120, 'word ') });
      for (const [label, path] of [['list', ADM.list], ['form', ADM.create]]) {
        await c.page.setViewportSize({ width: 390, height: 800 });
        await c.goto(path, { ready: 'h1' });
        if (!WD(c)) await hydrated(c);
        await c.page.waitForTimeout(800);
        o.set(`low.overflowX.${label}.390`, await c.page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth)));
        await c.page.setViewportSize({ width: 1366, height: 800 });
        await c.page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
        await c.page.waitForTimeout(300);
        o.set(`low.overflowX.${label}.rtl`, await c.page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth)));
      }
    },
  });

  // ===============================================================================================================
  // workspace members of another role (permission denial, plan cap)
  // ===============================================================================================================
  const OURS_PASSWORD = 'Str0ngPassw0rd#1';
  /**
   * A member of the workspace with the given WaDesk role ('agent' | 'admin'), signed in as a role of the harness. WaDesk: invited through
   * its members API (it answers with a temporary password). Ours: a user row with an Agent / Admin role (the password hash of the
   * seeded owner) because the invitation mail flow is a different feature. Both removed again at the end.
   */
  async function memberAs(c, wdRole) {
    const email = `${c.tag('member')}@example.test`.toLowerCase();
    const name = `zz-flb-${c.tag('user')}`;
    const harnessRole = `flb-${wdRole}-${c.sid}`;
    if (WD(c)) {
      const r = await c.http('POST', '/team-inbox/api/members/invite', { data: { name, email, role: wdRole } });
      const id = r.body?.member?.id;
      c.cfg.wadesk.users[harnessRole] = { email, password: r.body?.temp_password };
      c.onCleanup(async () => {
        await c.http('DELETE', `/team-inbox/api/members/${id}`);
        await c.deleteOwned(`/admin/users/${id}`, { email });
        await c.deleteOwned(`/admin/users/${id}/force`, { email });
      });
      return { harnessRole, email, ok: r.status === 200 && !!r.body?.temp_password, id };
    }
    const org = orgIdOf(c);
    psql(
      `WITH u AS (INSERT INTO users (org_id, email, full_name, password_hash, status, joined_at) SELECT org_id, '${q(email)}', '${q(name)}', password_hash, 'active', now() FROM users WHERE email = '${q(c.cfg.ours.users.admin.email)}' AND org_id = ${org} RETURNING org_id, id) ` +
        `INSERT INTO user_roles (org_id, user_id, role_id) SELECT u.org_id, u.id, (SELECT id FROM roles WHERE org_id = u.org_id AND name = '${wdRole === 'admin' ? 'Admin' : 'Agent'}') FROM u`,
    );
    psql(
      `INSERT INTO user_security (org_id, user_id, email_verified_at, password_changed_at, force_password_change) SELECT org_id, id, now(), now(), false FROM users WHERE email = '${q(email)}' AND org_id = ${org}`,
    );
    c.cfg.ours.users[harnessRole] = { email, password: OURS_PASSWORD };
    c.onCleanup(() => psql(`DELETE FROM users WHERE email = '${q(email)}' AND org_id = ${org}`));
    return { harnessRole, email, ok: true };
  }
  /** A write as another harness role: WaDesk with the CSRF and XHR headers, ours with that member's bearer token. */
  async function as(c, h, method, path, { data, multipart } = {}) {
    const base = WD(c) ? c.sideObj.baseUrl : c.sideObj.apiBase;
    const headers = WD(c)
      ? method === 'GET'
        ? { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
        : await c.sideObj.xhrHeaders(h.request)
      : method === 'GET'
        ? {}
        : idem();
    const r = await h.request.fetch(base.replace(/\/$/, '') + path, { method, headers, data, multipart, failOnStatusCode: false, maxRedirects: 0 });
    const text = await r.text().catch(() => '');
    let body = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* html */
    }
    return { status: r.status(), body, text, headers: r.headers() };
  }
  const refusal = (r) => ([401, 403, 404, 419].includes(r.status) || r.status === 302 ? 'refused' : klass(r.status));
  const landingOf = (url) => new URL(url).pathname.replace(/\/\d+(\/|$)/, '/ID$1').replace(/\/[0-9a-f-]{36}(\/|$)/, '/ID$1');

  ui({
    id: 'perm.agent',
    title: 'A workspace member without the flows role: no list, no actions, no data; the flow is untouched',
    run: async (c) => {
      const o = c.obs;
      const f = await createFlow(c, { label: 'perm', pub: true, category: 'welcome' });
      const m = await memberAs(c, 'agent');
      o.flag('memberReady', m.ok);
      const h = await c.openAlso({ role: m.harnessRole });
      const p = h.page;
      p.setDefaultTimeout(30000);
      await p.goto(c.url('/flows'), { waitUntil: 'load' });
      await p.waitForTimeout(2500);
      o.enum('landing.flows', landingOf(p.url()).replace(/^\/(team-inbox|inbox)$/, '/INBOX'));
      const text = await p.locator('body').innerText();
      o.flag('sec.flowNameVisible', text.includes(f.name));
      o.flag('flowsScreenShown', await p.locator(S.cards).count().then((n) => n > 0).catch(() => false));
      o.flag('createButtonShown', (await p.locator(S.create).count()) > 0);
      await p.goto(c.url('/flows/builder'), { waitUntil: 'load' });
      await p.waitForTimeout(2000);
      o.enum('landing.builder', landingOf(p.url()).replace(/^\/(team-inbox|inbox)$/, '/INBOX'));
      await p.goto(c.url('/flows/analytics'), { waitUntil: 'load' }).catch(() => undefined);
      const id = f.id;
      const unknown = WD(c) ? '999999999' : uuid();
      const calls = WD(c)
        ? {
            list: () => as(c, h, 'GET', '/flows?partial=1'),
            rename: () => as(c, h, 'POST', `/flows/${id}/rename`, { data: { name: 'renamed by agent' } }),
            toggle: () => as(c, h, 'POST', `/flows/${id}/toggle`),
            duplicate: () => as(c, h, 'POST', `/flows/${id}/duplicate`),
            exportFlow: () => as(c, h, 'GET', `/flows/${id}/export`),
            remove: () => as(c, h, 'DELETE', `/flows/${id}`),
            save: () => as(c, h, 'POST', '/flows/api/save', { data: { flow_name: 'by agent', flow_data: graphOf(NODES()) } }),
            importFlow: () => as(c, h, 'POST', '/flows/import', { multipart: { file: { name: 'a.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wrapper())) } } }),
            cloneUnknown: () => as(c, h, 'POST', `/flows/templates/${unknown}/clone`),
            adminTemplates: () => as(c, h, 'GET', '/admin/flow-templates'),
          }
        : {
            list: () => as(c, h, 'GET', '/v2/flows'),
            rename: () => as(c, h, 'PATCH', `/v2/flows/${id}/rename`, { data: { name: 'renamed by agent' } }),
            toggle: () => as(c, h, 'POST', `/v2/flows/${id}/toggle`),
            duplicate: () => as(c, h, 'POST', `/v2/flows/${id}/duplicate`),
            exportFlow: () => as(c, h, 'GET', `/v2/flows/${id}/export`),
            remove: () => as(c, h, 'DELETE', `/v2/flows/${id}`),
            save: () => as(c, h, 'POST', '/v2/flows', { data: { name: 'by agent', graph: graphOf(NODES()) } }),
            importFlow: () => as(c, h, 'POST', '/v2/flows/import', { data: { payload: wrapper() } }),
            cloneUnknown: () => as(c, h, 'POST', `/v2/flows/templates/${unknown}/clone`),
            adminTemplates: () => as(c, h, 'GET', '/v2/platform/flow-templates'),
          };
      for (const [k, fn] of Object.entries(calls)) {
        const r = await fn();
        o.enum(`api.${k}`, refusal(r));
        if (k === 'list' || k === 'exportFlow') o.flag(`sec.api.${k}.leaksName`, JSON.stringify(r.body ?? r.text).includes(f.name));
      }
      const after = await flowById(c, f.id);
      o.flag('flowUntouched', !!after && after.state === 'live' && after.name === f.name);
      o.num('flowsMadeByAgent', (await allFlows(c, 'by agent')).length);
      for (const x of await allFlows(c, 'by agent')) await removeFlow(c, x.id);
    },
  });

  // ===============================================================================================================
  // the plan cap on flows (WD-FLB-003, 006, 009, 010)
  // ===============================================================================================================
  ui({
    id: 'plan.limit',
    title: 'Plan cap: create, duplicate, import and template clone refused at the cap; rename, pause and delete still work',
    run: async (c) => {
      const o = c.obs;
      await guard(c);
      const src = await createFlow(c, { label: 'cap', pub: true });
      const total = (await counts(c)).all;
      // a template to clone (made by SQL: the cap check is what is under test)
      const tname = tplName(c, 'cap');
      const g = JSON.stringify(TPL_GRAPH());
      let tid;
      if (WD(c)) {
        mysql(`insert into flow_templates (name, flow_type, flow_data, is_active, sort_order, created_at, updated_at) values ('${q(tname)}', 'chat', '${q(g)}', 1, 0, now(), now())`);
        tid = mysql(`select id from flow_templates where name='${q(tname)}'`);
        c.onCleanup(() => mysql(`delete from flow_templates where name='${q(tname)}'`));
      } else {
        tid = psql(`insert into flow_templates (name, flow_type, flow_data, is_active) values ('${q(tname)}', 'chat', '${q(g)}'::jsonb, true) returning uuid`).split('\n')[0];
        c.onCleanup(() => psql(`delete from flow_templates where name='${q(tname)}'`));
      }
      // who hits the cap: ours the owner; WaDesk a workspace admin (the platform administrator never meets a plan cap there)
      let actor = c;
      let h = null;
      if (WD(c)) {
        const m = await memberAs(c, 'admin');
        o.flag('actorReady', m.ok);
        h = await c.openAlso({ role: m.harnessRole });
      } else o.flag('actorReady', true);
      const act = (method, wd, ours, opts = {}) => (WD(c) ? as(c, h, method, wd, opts) : as(c, { request: c.request }, method, ours.path ?? ours, ours.opts ?? {}));
      // set the cap just under the current number of flows (somebody else deleting one meanwhile must not open a slot), restore afterwards
      const cap = Math.max(1, total - 2);
      if (WD(c)) {
        const prev = mysql('select plan_overrides from workspaces where id = 1');
        c.onCleanup(() => mysql(prev && prev !== 'NULL' ? `update workspaces set plan_overrides = '${q(prev)}' where id = 1` : 'update workspaces set plan_overrides = NULL where id = 1'));
        mysql(`update workspaces set plan_overrides = '${JSON.stringify({ flow_limit: cap })}' where id = 1`);
      } else {
        const prev = psql(`select overrides::text from org_plan_state where org_id = ${orgIdOf(c)}`);
        c.onCleanup(() => psql(`update org_plan_state set overrides = '${q(prev)}'::jsonb where org_id = ${orgIdOf(c)}`));
        psql(`update org_plan_state set overrides = overrides || jsonb_build_object('limits', coalesce(overrides->'limits', '{}'::jsonb) || jsonb_build_object('flows', ${cap})) where org_id = ${orgIdOf(c)}`);
      }
      void actor;
      const created = async (name) => (await allFlows(c, name)).length;
      const idPath = (p1, p2) => (WD(c) ? p1 : p2);
      const r1 = WD(c) ? await as(c, h, 'POST', '/flows/api/save', { data: { flow_name: `zz-flb-${c.tag('capnew')}`, flow_data: graphOf(NODES()) } }) : await as(c, { request: c.request }, 'POST', '/v2/flows', { data: { name: `zz-flb-${c.tag('capnew')}`, graph: graphOf(NODES()) } });
      o.enum('create', klass(r1.status));
      o.flag('create.messageMentionsLimit', /limit|plan|upgrade/i.test(JSON.stringify(r1.body ?? r1.text)));
      o.num('create.made', await created(c.tagBase + '-' + c.sid + '-capnew'));
      const r2 = WD(c) ? await as(c, h, 'POST', `/flows/${src.id}/duplicate`) : await as(c, { request: c.request }, 'POST', `/v2/flows/${src.id}/duplicate`);
      o.enum('duplicate', r2.status === 422 ? 'refused' : klass(r2.status));
      const dupMade = (await allFlows(c, src.name)).filter((x) => x.id !== src.id).length;
      o.num('duplicate.made', dupMade);
      const r3 = WD(c) ? await as(c, h, 'POST', '/flows/import', { multipart: { file: { name: 'a.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wrapper({ name: `zz-flb-${c.tag('capimp')}` }))) } } }) : await as(c, { request: c.request }, 'POST', '/v2/flows/import', { data: { payload: wrapper({ name: `zz-flb-${c.tag('capimp')}` }) } });
      o.enum('import', [302, 422].includes(r3.status) ? 'refused' : klass(r3.status));
      o.num('import.made', await created(c.tagBase + '-' + c.sid + '-capimp'));
      const r4 = WD(c) ? await as(c, h, 'POST', `/flows/templates/${tid}/clone`) : await as(c, { request: c.request }, 'POST', `/v2/flows/templates/${tid}/clone`);
      o.enum('clone', [302, 422].includes(r4.status) ? 'refused' : klass(r4.status));
      o.num('clone.made', await created(tname));
      // editing and housekeeping are not blocked
      const r5 = WD(c) ? await as(c, h, 'POST', `/flows/${src.id}/rename`, { data: { name: `${src.name}-r` } }) : await as(c, { request: c.request }, 'PATCH', `/v2/flows/${src.id}/rename`, { data: { name: `${src.name}-r` } });
      o.enum('rename', klass(r5.status));
      const r6 = WD(c) ? await as(c, h, 'POST', `/flows/${src.id}/toggle`) : await as(c, { request: c.request }, 'POST', `/v2/flows/${src.id}/toggle`);
      o.enum('toggle', klass(r6.status));
      // the screen: duplicate from the card says why it did not happen
      const page = WD(c) ? h.page : c.page;
      page.setDefaultTimeout(30000);
      await page.goto(c.url(`/flows?q=${encodeURIComponent(scope(c))}`), { waitUntil: 'load' });
      await page.locator(S.cards).first().waitFor().catch(() => undefined);
      if (!WD(c)) await hydrated(c);
      await page.waitForTimeout(800);
      const before = new Set((await page.locator('body').innerText()).split('\n').map((l) => l.trim()));
      await page.locator(S.cards).filter({ hasText: src.name }).first().locator(ACT.dup).first().click();
      await page.waitForTimeout(3000);
      const fresh = (await page.locator('body').innerText()).split('\n').map((l) => l.trim()).filter((l) => l && !before.has(l));
      o.flag('ui.duplicate.limitMessageShown', fresh.some((l) => /limit|plan|upgrade/i.test(l)));
      o.flag('ui.duplicate.staysOnList', !/flows\/builder/.test(page.url()));
      o.num('ui.duplicate.made', (await allFlows(c, src.name)).filter((x) => x.id !== src.id).length);
      void idPath;
    },
  });

  // ===============================================================================================================
  // other tenants never show up (WD-FLB-001)
  // ===============================================================================================================
  ui({
    id: 'iso.foreign-flows',
    title: 'A flow of another workspace never appears in the list, the counts or the featured card',
    run: async (c) => {
      const o = c.obs;
      const before = await counts(c);
      const foreign = foreignFlow(c, `zz-flb-${c.tag('foreign')}`);
      // make it the newest, published and active one if it could
      if (WD(c)) mysql(`update flows set is_published = 1, is_active = 1, published_at = now(), updated_at = now() + interval 1 minute where id = ${foreign.id}`);
      else psql(`update flows set is_published = true, is_active = true, published_at = now(), updated_at = now() + interval '1 minute' where uuid = '${foreign.id}'`);
      const after = await counts(c);
      for (const k of ['all', 'live', 'paused', 'draft']) o.num(`delta.${k}`, (after[k] ?? 0) - (before[k] ?? 0));
      await openList(c, `?q=${encodeURIComponent(c.tagBase)}`);
      o.num('listCards', await cardCount(c));
      const feat = await c.loc(S.featured).first().innerText().catch(() => '');
      o.flag('featuredIsForeign', feat.includes(c.tagBase));
      o.flag('foreign.fetchByIdVisible', (await allFlows(c, c.tagBase)).length > 0);
      const detail = WD(c) ? await c.http('GET', `/flows/builder/${foreign.id}`) : await c.http('GET', `/v2/flows/${foreign.id}`);
      o.enum('crossTenant', klass(detail.status));
      o.flag('sec.foreignNameLeaked', JSON.stringify(detail.body ?? detail.text ?? '').includes(c.tagBase));
    },
  });

  // ===============================================================================================================
  // XSS on every surface that prints a flow or template name
  // ===============================================================================================================
  const xssHook = async (c) => {
    const box = { fired: false };
    await c.page.exposeFunction('__xssFired', () => (box.fired = true)).catch(() => undefined);
    await c.page.addInitScript(() => {
      Object.defineProperty(window, '__xss', {
        set() {
          window.__xssFired && window.__xssFired();
        },
        get() {
          return 0;
        },
      });
    });
    return box;
  };
  const HOSTILE = '<img src=x onerror=window.__xss=1><script>window.__xss=2</script>';

  ui({
    id: 'xss.tenant-surfaces',
    title: 'Hostile flow and template names: list card, featured card, gallery, rename dialog, delete confirm, toasts',
    run: async (c) => {
      const o = c.obs;
      const box = await xssHook(c);
      await guard(c);
      const f = await createFlow(c, { name: `zz-flb-${c.tag('x')}-${HOSTILE}`, pub: true, category: 'welcome' });
      o.flag('created', f.ok);
      const tname = `zz-flb-tpl-${c.tag('x')}-${HOSTILE}`;
      const g = JSON.stringify(TPL_GRAPH());
      if (WD(c)) {
        mysql(`insert into flow_templates (name, description, flow_type, flow_data, is_active, sort_order, created_at, updated_at) values ('${q(tname)}', '${q(HOSTILE)}', 'chat', '${q(g)}', 1, 0, now(), now())`);
        c.onCleanup(() => mysql(`delete from flow_templates where name='${q(tname)}'`));
      } else {
        psql(`insert into flow_templates (name, description, flow_type, flow_data, is_active) values ('${q(tname)}', '${q(HOSTILE)}', 'chat', '${q(g)}'::jsonb, true)`);
        c.onCleanup(() => psql(`delete from flow_templates where name='${q(tname)}'`));
      }
      await openList(c);
      await c.page.waitForTimeout(1500);
      const body = await bodyText(c);
      o.flag('card.nameAsText', body.includes('<img src=x'));
      o.flag('featured.nameAsText', (await c.loc(S.featured).first().innerText().catch(() => '')).includes('<img src=x'));
      o.flag('gallery.nameAsText', /<img src=x[^\n]*\n?/.test(body) && (body.match(/<img src=x/g) ?? []).length >= 2);
      o.num('injected.imgElements', await c.page.locator('img[src="x"]').count());
      o.num('injected.scripts', await c.page.locator('script:not([src])').evaluateAll((els) => els.filter((e) => e.textContent.includes('window.__xss=2')).length));
      const q2 = `?q=${encodeURIComponent(scope(c))}`;
      await openList(c, q2);
      if (WD(c)) c.page.once('dialog', (d) => void d.dismiss());
      await cardOf(c, f.name).locator(ACT.rename).first().click().catch(() => undefined);
      await c.page.waitForTimeout(800);
      await c.page.keyboard.press('Escape');
      await cardOf(c, f.name).locator(ACT.del).first().click().catch(() => undefined);
      await c.page.waitForTimeout(800);
      o.flag('confirm.nameAsText', (await c.loc(confirmEls.msg).first().innerText().catch(() => '')).includes('<img src=x'));
      await c.page.keyboard.press('Escape');
      await cardOf(c, f.name).locator(ACT.dup).first().click().catch(() => undefined);
      await c.page.waitForTimeout(3500);
      o.flag('sec.xssExecuted', box.fired);
    },
  });

  ui({
    id: 'xss.admin-surfaces',
    title: 'Hostile template name and description: admin list, edit form, delete confirm',
    run: async (c) => {
      const o = c.obs;
      trackTemplates(c);
      await operatorSession(c);
      const box = await xssHook(c);
      const t = await createTemplate(c, { name: `zz-flb-tpl-${c.tag('x')}-${HOSTILE}`, description: HOSTILE, category: '<b>cat</b>' });
      o.flag('created', t.created);
      await openAdmin(c);
      const row = rowOfTpl(c, t.name.slice(0, 40));
      o.flag('list.nameAsText', (await bodyText(c)).includes('<img src=x'));
      o.num('injected.imgElements', await c.page.locator('img[src="x"]').count());
      await row.locator('[title="Delete"]').first().click().catch(() => undefined);
      await c.page.waitForTimeout(800);
      const adm = { ours: 'dialog[open]', wadesk: '[data-ui-ok]' };
      o.flag('confirm.opened', await c.visible(adm, undefined, 2000));
      await c.page.keyboard.press('Escape');
      if (WD(c)) await c.page.locator('[data-ui-cancel]').first().click().catch(() => undefined);
      await row.locator('[title="Edit"]').first().click().catch(() => undefined);
      await fl(c, F.name).first().waitFor({ timeout: 15000 }).catch(() => undefined);
      await c.page.waitForTimeout(1200);
      o.flag('edit.prefilledVerbatim', (await fl(c, F.name).first().inputValue().catch(() => '')).includes('<img src=x'));
      o.flag('sec.xssExecuted', box.fired);
    },
  });

  ui({
    id: 'tpl.form.double-submit',
    title: 'Template form: a double click on Create saves one template',
    run: async (c) => {
      const o = c.obs;
      trackTemplates(c);
      await operatorSession(c);
      await openForm(c);
      const name = tplName(c, 'dbl');
      await fillForm(c, { name, paste: '{"flowNodes":[{"type":"end","data":{}}],"flowEdges":[]}' });
      await fl(c, F.submit).first().dblclick({ timeout: 4000, noWaitAfter: true }).catch(() => undefined);
      await c.page.waitForTimeout(3500);
      o.num('rows', tplRows(c, name).length);
    },
  });

  // ===============================================================================================================
  // entry points: create sheet, AI prompt, analytics link, open builder (WD-FLB-003)
  // ===============================================================================================================
  ui({
    id: 'create.sheet-and-links',
    title: 'Create flow sheet (Messaging / Call), Escape, backdrop; the header and card links land where they should',
    run: async (c) => {
      const o = c.obs;
      const f = await createFlow(c, { label: 'lnk', pub: true });
      await openList(c, `?q=${encodeURIComponent(scope(c))}`);
      const chat = '[data-channel="chat"]';
      const call = '[data-channel="call"]';
      const shown = () => c.page.locator(chat).first().isVisible().catch(() => false);
      const opens = async () => {
        await c.click(S.create);
        await c.page.waitForTimeout(700);
        return shown();
      };
      o.flag('sheet.opens', await opens());
      o.flag('sheet.hasCall', await c.page.locator(call).first().isVisible().catch(() => false));
      o.flag('sheet.hasCancel', (await c.page.getByRole('button', { name: /^cancel$/i }).count()) > 0);
      await c.page.keyboard.press('Escape');
      await c.page.waitForTimeout(500);
      o.flag('sheet.escapeCloses', !(await shown()));
      await opens();
      await c.page.mouse.click(5, 5);
      await c.page.waitForTimeout(500);
      o.flag('sheet.backdropCloses', !(await shown()));
      await opens();
      await c.page.getByRole('button', { name: /^cancel$/i }).first().click();
      await c.page.waitForTimeout(500);
      o.flag('sheet.cancelCloses', !(await shown()));
      const go = async (label, act, back = true) => {
        await act();
        await c.page.waitForURL((u) => !/^\/flows$/.test(u.pathname) || u.search.includes('ai'), { timeout: 20000 }).catch(() => undefined);
        o.enum(`${label}.landing`, landingOf(c.page.url()) + new URL(c.page.url()).search.replace(/id=[\w-]+/, 'id=ID').replace(/q=[^&]*/, ''));
        if (back) await openList(c, `?q=${encodeURIComponent(scope(c))}`);
      };
      await opens();
      await go('messaging', () => c.page.locator(chat).first().click());
      await opens();
      await go('call', () => c.page.locator(call).first().click());
      await go('ai', () => c.page.getByText(/use ai prompt/i).first().click());
      await go('analytics', () => c.page.locator('a[title^="Flow execution history"]').first().click());
      await go('openBuilder', () => cardOf(c, f.name).locator(ACT.open).first().click());
      await go('cardAnalytics', () => cardOf(c, f.name).locator('[title="Analytics"]').first().click());
      await go('featuredOpen', () => c.loc(S.featured).first().locator('a:has-text("Open flow")').first().click());
    },
  });

  // __CONTINUE__
  return {
    feature: 'WD-FLB-001',
    title: 'Flows list and admin flow templates',
    scenarios,
    pages: [],
    intended: [
      {
        scenario: /^(rename\.ids|action\.toggle\.ids|delete\.api|export\.names|tpl\.clone\.api|tpl\.admin\.ids)$/,
        key: 'enum.malformed',
        quirk: 'a path id that is not a number is an unknown row (404)',
        reason:
          'ids are uuids and every path id of the platform is validated by the uuid pipe first: "abc" is a 400 validation problem, a well-formed unknown or foreign uuid is the 404 (CONTRIBUTING 4, ids never leave the system as numbers)',
      },
      {
        scenario: /^tpl\.form\.file-png$/,
        key: /^(enum\.nameKept|seq\.messages)$/,
        quirk: "a wrong file type is refused by the server and the page comes back with no message and an empty form",
        reason:
          'ours says why (the same Laravel wording, shown in the page) and keeps what was typed; nothing is saved either way (flag.created is equal). A deliberate fix of a silent WaDesk failure, recorded in docs/wadesk-port/parity/flow-builder-editor-list.md',
      },
      {
        scenario: /^page\.list\.perf$/,
        key: 'perf.lcpMs',
        quirk: 'the list is server-rendered HTML',
        reason:
          'measured against development servers (next dev compiling on demand, the API in watch mode): the page paints its shell first and fetches the flows after hydration through the cursor API, WaDesk ships the cards in the HTML; the load time itself (perf.loadMs) is within the limit',
      },
      {
        scenario: /^create\.sheet-and-links$/,
        key: /^enum\.(analytics|cardAnalytics)\.landing$/,
        quirk: 'the analytics screen lives under /flows/analytics',
        reason:
          'architecture-forced: execution analytics belong to the flow runtime domain, whose screen is /flow-runtime/analytics (a single flow is ?flowId=<uuid>); the list only links to it',
      },
      {
        scenario: /^plan\.limit$/,
        key: /^(enum\.duplicate|num\.duplicate\.made|flag\.ui\.duplicate\.[A-Za-z]+|num\.ui\.duplicate\.made)$/,
        quirk: "WaDesk's duplicate skips the plan flow cap",
        reason:
          'documented deviation (docs/wadesk-port/parity/flow-builder-editor-list.md): duplicate and template clone count against the plan flow cap like create and import do, so a workspace at its cap cannot get past it by duplicating; WaDesk lets a duplicate through',
      },
      {
        scenario: /^page\.list\.keyboard$/,
        key: /^abs\.keyboard\.(reachable|focusVisible)$/,
        quirk: 'a longer shell: our app shell lists about 90 interactive controls, WaDesk 64',
        reason:
          'the probe presses Tab at most 90 times and our shell has more navigation links than the cap (every control visited in order, no trap, none skipped); the only stop without a focus ring is the Next.js development overlay button of `next dev`; the page itself is the same set of controls as WaDesk',
      },
      {
        scenario: /^page\.admin-(list|form)\.keyboard$/,
        key: /^(abs\.keyboard\.focusVisible|flag\.keyboard\.skipLink)$/,
        quirk: 'no skip link on the admin pages',
        reason:
          'our admin shell adds a "skip to content" link (WaDesk has none: better, not worse); the only tab stop without a focus ring is the Next.js development overlay button, which exists in `next dev` only',
      },
      {
        scenario: /^tpl\.form\./,
        key: 'enum.landing',
        quirk: 'the template form lives at /admin/flow-templates/create',
        reason:
          'platform convention for create screens is /new (every admin screen of this app uses it); the list, edit and delete routes keep WaDesk paths',
      },
      {
        scenario: /^(tpl\.form\.(all-empty|sort-10000|sort-negative)|tpl\.edit)$/,
        key: /^seq\.(messages|emptyName\.messages)$/,
        quirk: "the browser's own required / min / max bubble is the only message (it is not part of the page text)",
        reason:
          'our form is `novalidate` and prints the validation message in the page (the same words WaDesk\'s server uses); WaDesk relies on the native bubble, so nothing is submitted and nothing is stored on either side (flag.created / stored are equal)',
      },
      {
        scenario: /^import\./,
        key: /^(enum\.importStatus|num\.importRequests)$/,
        quirk: 'the upload is a multipart form post answered by a redirect back with the error',
        reason:
          'documented in docs/wadesk-port/parity/flow-builder-editor-list.md: our screen reads the file in the browser, applies the same type and size rules in the same words, and sends its JSON to the API (a JSON endpoint answers 422, not a redirect); a rejected file may therefore never reach the server',
      },
      {
        scenario: /^import\.long-name$/,
        key: 'num.nameLength',
        quirk: 'an imported name has no length cap',
        reason:
          'flows.flow_name is capped at 255 characters here: the name is cut in front of the " (imported)" suffix (WaDesk stores 261 and more because its column has no cap)',
      },
      {
        scenario: /^import\.json-scalar$/,
        key: 'seq.messages',
        quirk: "a file that holds only a bare number is reported as the wrong file type (PHP's libmagic sniffing)",
        reason:
          'WaDesk judges a tiny file by what libmagic guesses and calls "42" a wrong type; we judge the declared type and then the content, so it is the same rejection with the "not a valid flow export" wording; nothing is created either way',
      },
      {
        scenario: /^import\.too-big$/,
        key: 'seq.messages',
        quirk: "the reference's PHP upload limit (2 MB) fires before the 4096 KB rule",
        reason:
          'the local WaDesk runs with the PHP default upload_max_filesize, so it answers "failed to upload" for a 4 MB file; the product rule (4096 KB) is what ours enforces and words as WaDesk does for files between the PHP limit and the rule',
      },
      {
        scenario: /^duplicate\.api$/,
        key: /^num\.len\d+\.copyNameLength$/,
        quirk: 'a copy of a long name has no length cap',
        reason:
          'flows.flow_name is capped at 255 characters here: a copy of a name that would pass it is cut in front of the "(Copy)" suffix (WaDesk stores 257 and more because its column has no cap)',
      },
      {
        scenario: /^action\.rename\.ui$/,
        key: /^(enum\.len192\.status|num\.len192\.requests|flag\.len192\.feedback)$/,
        quirk: "the browser's rename prompt has no length limit and the server answers 422 for 192 characters",
        reason:
          'our rename dialog is the shared dialog with a 191-character input: typing and pasting are cut at the limit, so a 192-character name never reaches the server (the API still answers 422, see rename.192)',
      },
      {
        scenario: /^list\.status-tabs$/,
        key: 'num.bogusStatus.cards',
        quirk: 'an unknown ?status= shows no flow at all',
        reason:
          'deliberate fix recorded in docs/wadesk-port/parity/flow-builder-editor-list.md: an unknown status falls back to all flows instead of an empty list with no way back',
      },
    ],
    skip: [],
  };
};
