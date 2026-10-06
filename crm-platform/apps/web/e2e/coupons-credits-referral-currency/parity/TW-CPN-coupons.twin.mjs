// Twin spec for the admin coupons console (TW-CPN-001..005): list, KPIs, status pills, search, create form, edit, toggle and
// delete, on the running Reference admin console and on our operator console. TW-CPN-006..008 (the discount engine and the
// checkout preview) have no screen of their own and need a plan to price: neither side has a plan in this environment, so
// they are not compared here (the API e2e suite covers our engine).
//
// Run (our API, web app and the scratch database are expected up; see the parity README):
//   export PARITY_WEB_URL=http://localhost:3400 PARITY_API_URL=http://localhost:3300 PARITY_CONFIG=<json with ours.operator>
//   parity.sh run apps/web/e2e/coupons-credits-referral-currency/parity/TW-CPN-coupons.twin.mjs --depth full --workers 1
// `--workers 1` matters: the KPI cards and the list counts are platform-wide and the scenarios assume nobody else writes.
//
// Test data: every coupon this run creates carries the run tag (pwp-...) in its code or its description. Cleanup deletes
// rows by tag only, through each side's own delete route (never a seeded coupon).
import {
  TW,
  cls,
  q,
  qs,
  qp,
  lines,
  mysql,
  psql,
  idem,
  operatorSession,
  opFetch,
} from './cpn-shared.mjs';

export default (h) => {
  const depth = h.cfg.depth || 'full';

  // ---------------------------------------------------------------------------------------------------------------
  // data helpers (each side's own surface)
  // ---------------------------------------------------------------------------------------------------------------
  const likeOf = (c) => `${c.tagBase}`.toLowerCase();
  /** Ids (Reference bigint / ours uuid) of coupons whose code or description carries `like` (case-insensitive). */
  const findIds = (c, like) => {
    const l = q(like.toLowerCase());
    return TW(c)
      ? lines(
          mysql(
            `select id from coupons where lower(code) like '%${l}%' or lower(ifnull(description,'')) like '%${l}%'`,
          ),
        )
      : lines(
          psql(
            `select uuid from coupons where lower(code) like '%${l}%' or lower(coalesce(description,'')) like '%${l}%'`,
          ),
        );
  };
  const idByCode = (c, code) =>
    TW(c)
      ? mysql(`select id from coupons where code = '${qs(c, code)}' limit 1`)
      : psql(`select uuid from coupons where code = '${qs(c, code)}' limit 1`);
  const SEP = '\u001f';
  const rowWhere = (c, where) =>
    TW(c)
      ? mysql(
          `select concat_ws(char(31), code, type, cast(amount as char), ifnull(description,''), ifnull(admin_note,''), is_active, ifnull(cast(max_uses as char),''), ifnull(cast(per_user_limit as char),''), ifnull(currency_code,''), ifnull(cast(max_discount_amount as char),''), ifnull(cast(min_order_amount as char),''), first_purchase_only, stackable_with_other, uses_count) from coupons where ${where.threadwise} limit 1`,
        )
      : psql(
          `select concat_ws(chr(31), code, type, amount::numeric::text, coalesce(description,''), coalesce(admin_note,''), is_active::int, coalesce(max_uses::text,''), coalesce(per_user_limit::text,''), coalesce(currency_code,''), coalesce(max_discount_amount::numeric::text,''), coalesce(min_order_amount::numeric::text,''), first_purchase_only::int, stackable_with_other::int, uses_count) from coupons where ${where.ours} limit 1`,
        );
  const normNum = (v) => (v === '' || v == null ? '' : String(Number(v)));
  /** The stored coupon as comparable text (decimals normalised: 10.0000 and 10 are the same). */
  const parseRow = (r) => {
    if (!r) return null;
    const [
      cd,
      type,
      amount,
      desc,
      note,
      active,
      maxUses,
      perUser,
      cur,
      cap,
      min,
      first,
      stack,
      uses,
    ] = r.split(SEP);
    return {
      code: cd,
      type,
      amount: normNum(amount),
      description: desc,
      adminNote: note,
      active,
      maxUses,
      perUser,
      currency: cur,
      cap: normNum(cap),
      min: normNum(min),
      firstOnly: first,
      stackable: stack,
      uses,
    };
  };
  const stored = (c, code) => {
    const e = qs(c, code);
    return parseRow(rowWhere(c, { threadwise: `code = '${e}'`, ours: `code = '${e}'` }));
  };
  const storedById = (c, id) =>
    parseRow(
      rowWhere(c, {
        threadwise: `id = ${Number(id)}`,
        ours: `uuid = '${qp(id)}'`,
      }),
    );
  const auditCount = (c) =>
    Number(
      TW(c)
        ? mysql(`select count(*) from audit_logs where action like 'coupon.%'`)
        : psql(`select count(*) from security_events where event like 'platform.coupon.%'`),
    );
  const dt = (d) => d.toISOString().slice(0, 16); // datetime-local text
  const normName = (s) => {
    const n = String(s)
      .toLowerCase()
      .replace(/[^a-z]/g, '');
    return n === 'applicablepackageids' ? 'applicableplans' : n;
  };

  /** Create through each side's own API. o: code, type, amount, description, adminNote, maxUses, perUser, currency, cap, min, startsAt, expiresAt (Date), active, firstOnly, stackable, plans[] */
  async function create(c, o) {
    const o2 = { type: 'percent', amount: '10', active: true, ...o };
    if (TW(c)) {
      const form = {
        code: o2.code,
        type: o2.type,
        amount: String(o2.amount),
        is_active: o2.active ? '1' : '0',
        first_purchase_only: o2.firstOnly ? '1' : '0',
        stackable_with_other: o2.stackable ? '1' : '0',
      };
      if (o2.description != null) form.description = o2.description;
      if (o2.adminNote != null) form.admin_note = o2.adminNote;
      if (o2.maxUses != null) form.max_uses = String(o2.maxUses);
      if (o2.perUser != null) form.per_user_limit = String(o2.perUser);
      if (o2.currency != null) form.currency_code = o2.currency;
      if (o2.cap != null) form.max_discount_amount = String(o2.cap);
      if (o2.min != null) form.min_order_amount = String(o2.min);
      if (o2.startsAt) form.starts_at = dt(o2.startsAt);
      if (o2.expiresAt) form.expires_at = dt(o2.expiresAt);
      (o2.plans || []).forEach((p, i) => (form[`applicable_package_ids[${i}]`] = String(p)));
      const r = await c.http('POST', '/admin/coupons', { form });
      const flagged =
        r.status === 422 && r.body?.errors ? Object.keys(r.body.errors).map(normName) : [];
      return {
        status: r.status,
        ok: r.status < 400,
        flagged,
        id: r.status < 400 ? idByCode(c, o2.code.toUpperCase()) : null,
      };
    }
    const body = {
      code: o2.code,
      type: o2.type,
      amount: String(o2.amount),
      isActive: !!o2.active,
      firstPurchaseOnly: !!o2.firstOnly,
      stackableWithOther: !!o2.stackable,
    };
    if (o2.description != null) body.description = o2.description;
    if (o2.adminNote != null) body.adminNote = o2.adminNote;
    if (o2.maxUses != null) body.maxUses = Number(o2.maxUses);
    if (o2.perUser != null) body.perUserLimit = Number(o2.perUser);
    if (o2.currency != null) body.currencyCode = o2.currency;
    if (o2.cap != null) body.maxDiscountAmount = String(o2.cap);
    if (o2.min != null) body.minOrderAmount = String(o2.min);
    if (o2.startsAt) body.startsAt = o2.startsAt.toISOString();
    if (o2.expiresAt) body.expiresAt = o2.expiresAt.toISOString();
    if (o2.plans) body.applicablePlans = o2.plans;
    const r = await opFetch(c, 'POST', '/coupons', body);
    const flagged =
      r.status === 422 && Array.isArray(r.json?.errors)
        ? r.json.errors.map((e) => normName(e.path))
        : [];
    return {
      status: r.status,
      ok: r.ok,
      flagged,
      id: r.json?.id ?? null,
      rowVersion: r.json?.rowVersion,
    };
  }
  const remove = (c, id) =>
    TW(c) ? c.http('DELETE', `/admin/coupons/${id}`) : opFetch(c, 'DELETE', `/coupons/${id}`);
  /** Deletes every coupon whose code or description carries `like`. Only ever called with this run's tag. */
  async function sweep(c, like) {
    if (!TW(c)) await operatorSession(c).catch(() => undefined);
    for (const id of findIds(c, like)) await remove(c, id).catch(() => undefined);
  }
  /** Deletes what this scenario made (its own tag segment `<run>-<sid>-`), whatever created it. */
  const track = (c) => c.onCleanup(() => sweep(c, `${c.tagBase}-${c.sid}-`));
  const adminSession = async (c) => {
    c.page?.setDefaultTimeout(30000);
    if (!TW(c)) await operatorSession(c);
  };
  const wrap = (scs, before) =>
    scs.map((sc) => ({
      ...sc,
      run: async (c) => {
        await adminSession(c);
        if (before) await before(c);
        track(c);
        return sc.run(c);
      },
    }));

  /** Three list rows every list scenario can rely on, made once per run (code `<run>-lst-a|b|c`). */
  async function ensureListData(c) {
    const base = `${c.tagBase}-lst-`;
    if (findIds(c, base).length >= 3) return;
    await sweep(c, base);
    const day = 86400000;
    await create(c, {
      code: `${base}a`,
      type: 'percent',
      amount: '10',
      description: 'list seed a',
    });
    await create(c, {
      code: `${base}b`,
      type: 'fixed',
      amount: '5',
      description: 'list seed b',
      active: false,
    });
    await create(c, {
      code: `${base}c`,
      type: 'percent',
      amount: '20',
      description: 'list seed c',
      startsAt: new Date(Date.now() - 3 * day),
      expiresAt: new Date(Date.now() - day),
    });
  }

  const row = (c, code) => c.page.locator('tbody tr', { hasText: code });
  const openMenu = async (c, rowLoc) => {
    await rowLoc
      .locator(TW(c) ? '[data-row-menu-toggle]' : '[aria-haspopup]')
      .first()
      .click();
    await c.page.waitForTimeout(250);
  };
  const clickDelete = async (c, rowLoc) => {
    await openMenu(c, rowLoc);
    if (TW(c)) await rowLoc.locator('[data-row-menu-panel] button[type=submit]').first().click();
    else
      await c.page
        .getByRole('menuitem', { name: /delete/i })
        .or(c.page.getByRole('button', { name: /^delete$/i }))
        .first()
        .click();
  };
  const confirmBtn = {
    threadwise: { role: 'button', name: /yes, delete/i },
    ours: { role: 'button', name: /yes, delete/i },
  };
  const cancelBtn = {
    threadwise: { role: 'button', name: /^cancel$/i },
    ours: { role: 'button', name: /^cancel$/i },
  };

  const kpis = async (c) => {
    const t = await c.page.locator('main').innerText();
    const grab = (label) => {
      const m = t.match(new RegExp(`${label}\\s*\\n\\s*([\\d,]+)`, 'i'));
      return m ? Number(m[1].replace(/,/g, '')) : null;
    };
    return {
      total: grab('Total coupons'),
      active: grab('Active'),
      expired: grab('Expired'),
      redeemed: grab('Total redemptions'),
    };
  };
  const codesOnPage = async (c, like) => {
    const texts = await c.page.locator('tbody tr td:first-child').allInnerTexts();
    return texts
      .map((x) => x.split('\n')[0].trim().toLowerCase())
      .filter((x) => x.includes(like.toLowerCase()))
      .map((x) => x.slice(like.length))
      .sort();
  };
  const searchFor = async (c, term) => {
    const input = c.loc({ threadwise: 'input[name=q]', ours: 'input[type=search]' }).first();
    await input.fill(term);
    await input.press('Enter');
    await c.afterAction({ quiet: 800 });
  };
  const openList = (c) => c.goto('/admin/coupons', { ready: 'table' });

  // ---------------------------------------------------------------------------------------------------------------
  // the create form (generated matrix)
  // ---------------------------------------------------------------------------------------------------------------
  const F = (id, threadwise, ours, extra = {}) => ({ id, loc: { threadwise, ours }, ...extra });
  // Reference's browser number inputs refuse text, thousands separators and decimal commas outright (the browser empties the
  // field), so there is no Reference behaviour to compare for those typed values; the same values are compared through the
  // API in `api.rules`.
  const NOT_TYPEABLE = ['text', 'thousands', 'comma-decimal'];
  const couponForm = {
    id: 'coupon-create',
    title: 'Create coupon',
    feature: 'TW-CPN-002',
    open: {
      threadwise: async (c) => c.goto('/admin/coupons/create', { ready: '#couponForm' }),
      ours: async (c) => {
        await operatorSession(c);
        await c.goto('/admin/coupons/new', { ready: '#couponForm' });
      },
    },
    root: '#couponForm',
    submit: 'button[type=submit]',
    valid: () => ({ type: 'percent', amount: '10' }),
    tagField: ['code', 'description'],
    fields: [
      F('code', '[name=code]', '#co-code', { type: 'text', required: true, max: 64, unique: true }),
      F('description', '[name=description]', '#co-desc', { type: 'textarea', max: 255 }),
      F('admin_note', '[name=admin_note]', '#co-note', { type: 'textarea', max: 1000 }),
      F('type', '[name=type]', '#co-type', { type: 'select', required: true }),
      F('amount', '[name=amount]', '#co-amount', {
        type: 'money',
        skipCases: NOT_TYPEABLE,
        required: true,
      }),
      F('max_discount_amount', '[name=max_discount_amount]', '#co-max-discount', {
        type: 'money',
        skipCases: NOT_TYPEABLE,
      }),
      F('currency_code', '[name=currency_code]', '#co-currency', {
        type: 'select',
        // the two catalogues differ (Reference's list is its own fallback, ours the platform catalogue), so the option matrix is
        // not comparable; the currency lock is compared through the API (`api.rules`, case currency-*)
        skipMatrix: true,
      }),
      F('min_order_amount', '[name=min_order_amount]', '#co-min', {
        type: 'money',
        skipCases: NOT_TYPEABLE,
      }),
      F('starts_at', '[name=starts_at]', '#co-start', { type: 'datetime', skipMatrix: true }),
      F('expires_at', '[name=expires_at]', '#co-exp', { type: 'datetime', skipMatrix: true }),
      F('max_uses', '[name=max_uses]', '#co-max-uses', {
        type: 'integer',
        skipCases: NOT_TYPEABLE,
      }),
      F('per_user_limit', '[name=per_user_limit]', '#co-per-user', {
        type: 'integer',
        skipCases: NOT_TYPEABLE,
      }),
    ],
    readback: {
      threadwise: async (c, { tag }) => readback(c, tag),
      ours: async (c, { tag }) => readback(c, tag),
    },
    cleanup: async (c, { values }) => {
      // every accepted submit leaves a row: remove what carries this scenario's tag
      await sweep(c, `${c.tagBase}-${c.sid}-`);
      void values;
    },
    countAfter: async (c, tag) => findIds(c, String(tag).toLowerCase()).length,
  };
  /** What was stored for the submitted tag, as comparable text. */
  async function readback(c, tag) {
    if (!tag) return {};
    const id = findIds(c, tag)[0];
    if (!id) return { rowCreated: false };
    return { rowCreated: true, ...storedById(c, id) };
  }

  // the generated form scenarios, wrapped so ours runs inside an operator session and nothing is left behind
  const formScenarios = wrap(h.formScenarios(couponForm, { depth }), null);
  // the form open step already signs ours in; `wrap` adds the sweep and the longer action timeout

  // ---------------------------------------------------------------------------------------------------------------
  // lists, deletes (generated)
  // ---------------------------------------------------------------------------------------------------------------
  const couponList = {
    id: 'coupon-list',
    title: 'Coupons list',
    feature: 'TW-CPN-001',
    page: '/admin/coupons',
    ready: 'table',
    rows: { threadwise: 'tbody tr:has(td a, td button)', ours: 'tbody tr' },
    search: {
      input: { threadwise: 'input[name=q]', ours: 'input[type=search]' },
      submit: 'enter',
      term: '-lst-a',
    },
    filters: [
      {
        id: 'active',
        control: {
          threadwise: 'button[name=status][value=active]',
          ours: { role: 'button', name: /^active/i },
        },
      },
      {
        id: 'disabled',
        control: {
          threadwise: 'button[name=status][value=disabled]',
          ours: { role: 'button', name: /^disabled/i },
        },
      },
      {
        id: 'expired',
        control: {
          threadwise: 'button[name=status][value=expired]',
          ours: { role: 'button', name: /^expired/i },
        },
      },
    ],
    rowOpen: { threadwise: 'tbody tr [data-row-menu-toggle]', ours: 'tbody tr [aria-haspopup]' },
  };
  const listScenarios = wrap(h.listScenarios(couponList, { depth }), ensureListData);

  const couponDelete = {
    id: 'coupon-delete',
    title: 'Delete coupon',
    feature: 'TW-CPN-005',
    page: '/admin/coupons',
    ready: 'table',
    seed: {
      threadwise: async (c) => {
        const code = c.tag('del');
        await create(c, { code, description: 'delete me' });
        return { code };
      },
      ours: async (c) => {
        await operatorSession(c);
        const code = c.tag('del');
        await create(c, { code, description: 'delete me' });
        return { code };
      },
    },
    row: (made, c) => c.page.locator('tbody tr', { hasText: made.code }),
    start: async (c, rowLoc) => clickDelete(c, rowLoc),
    confirm: confirmBtn,
    cancel: cancelBtn,
    cleanup: async (c, made) => sweep(c, made?.code ?? `${c.tagBase}-${c.sid}-`),
  };
  const deleteScenarios = h.deleteScenarios(couponDelete).map((sc) => ({
    ...sc,
    run: async (c) => {
      await adminSession(c);
      track(c);
      return sc.run(c);
    },
  }));

  // ---------------------------------------------------------------------------------------------------------------
  // pages
  // ---------------------------------------------------------------------------------------------------------------
  const adminPage = (id, title, path, probes, ready) =>
    wrap(h.pageScenarios({ id, title, path, ready, probes, feature: 'TW-CPN-001' }), null);
  const pageScenarios = [
    ...adminPage(
      'page.list',
      'Coupons list',
      '/admin/coupons',
      ['load', 'a11y', 'keyboard', 'degraded'],
      {
        threadwise: 'table',
        ours: 'table',
      },
    ),
    ...adminPage(
      'page.create',
      'New coupon',
      { threadwise: '/admin/coupons/create', ours: '/admin/coupons/new' },
      ['load', 'a11y', 'keyboard', 'degraded'],
      '#couponForm',
    ),
    // no session at all: never the page, never the data
    ...h.pageScenarios({
      id: 'page.list-anonymous',
      title: 'Coupons list without a session',
      path: '/admin/coupons',
      ready: 'body',
      probes: ['auth'],
      feature: 'TW-CPN-001',
    }),
  ];

  // ---------------------------------------------------------------------------------------------------------------
  // custom scenarios
  // ---------------------------------------------------------------------------------------------------------------
  const scenarios = [];
  const add = (sc) =>
    scenarios.push({ feature: sc.feature || 'TW-CPN-002', ...sc, run: wrapRun(sc.run) });
  function wrapRun(run) {
    return async (c) => {
      await adminSession(c);
      track(c);
      return run(c);
    };
  }

  add({
    id: 'responsive.list-and-form',
    title: 'List and form at 390, 820 and 1366 px: no horizontal overflow',
    feature: 'TW-CPN-001',
    tags: ['page', 'responsive'],
    run: async (c) => {
      for (const [name, path, ready] of [
        ['list', '/admin/coupons', { threadwise: 'table', ours: 'main h1' }],
        ['form', { threadwise: '/admin/coupons/create', ours: '/admin/coupons/new' }, '#couponForm'],
      ]) {
        for (const vp of [390, 820, 1366]) {
          await c.page.setViewportSize({ width: vp, height: 900 });
          await c.goto(path, { ready });
          const overflow = await c.page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          c.obs.set(`low.overflowX.${name}.${vp}`, Math.max(0, overflow));
        }
      }
      await c.page.setViewportSize({ width: 1366, height: 900 });
    },
  });

  add({
    id: 'kpi.counts-follow-writes',
    title: 'KPI cards move by one when a coupon is created, disabled and removed',
    feature: 'TW-CPN-001',
    run: async (c) => {
      const o = c.obs;
      await openList(c);
      const k0 = await kpis(c);
      const code = c.tag('kpi');
      await create(c, { code, description: 'kpi seed' });
      await openList(c);
      const k1 = await kpis(c);
      o.num('delta.created.total', k1.total - k0.total);
      o.num('delta.created.active', k1.active - k0.active);
      const id = idByCode(c, code.toUpperCase());
      if (TW(c)) await c.http('POST', `/admin/coupons/${id}/toggle`);
      else await opFetch(c, 'PATCH', `/coupons/${id}/active`, { isActive: false });
      await openList(c);
      const k2 = await kpis(c);
      o.num('delta.disabled.active', k2.active - k1.active);
      o.num('delta.disabled.total', k2.total - k1.total);
      const exp = c.tag('kpx');
      await create(c, {
        code: exp,
        startsAt: new Date(Date.now() - 4 * 86400000),
        expiresAt: new Date(Date.now() - 86400000),
      });
      await openList(c);
      const k3 = await kpis(c);
      o.num('delta.expired.expired', k3.expired - k2.expired);
      await sweep(c, `${c.tagBase}-${c.sid}-`);
      await openList(c);
      const k4 = await kpis(c);
      o.num('delta.removed.total', k4.total - k0.total);
    },
  });

  add({
    id: 'list.status-membership',
    title: 'Each status pill lists the right coupons; an unknown status behaves as All',
    feature: 'TW-CPN-001',
    run: async (c) => {
      const o = c.obs;
      const day = 86400000;
      const ids = {};
      const mk = async (key, extra) => {
        const code = c.tag(key);
        await create(c, { code, ...extra });
        ids[key] = code.toLowerCase();
        return code;
      };
      await mk('on', {});
      await mk('off', { active: false });
      await mk('old', {
        startsAt: new Date(Date.now() - 4 * day),
        expiresAt: new Date(Date.now() - day),
      });
      await mk('oldoff', {
        active: false,
        startsAt: new Date(Date.now() - 4 * day),
        expiresAt: new Date(Date.now() - day),
      });
      await mk('later', { expiresAt: new Date(Date.now() + 30 * day) });
      const prefix = `${c.tagBase}-${c.sid}-`.toLowerCase();
      let all = [];
      const suffixes = (xs) => xs.map((x) => x.replace(/-\d+$/, '').replace(/^.*?-/, ''));
      for (const pill of ['all', 'active', 'disabled', 'expired']) {
        await openList(c);
        await searchFor(c, prefix);
        if (pill !== 'all')
          await c.click({
            threadwise: `button[name=status][value=${pill}]`,
            ours: { role: 'button', name: new RegExp(`^${pill}`, 'i') },
          });
        await c.afterAction({ quiet: 800 });
        const got = await codesOnPage(c, prefix);
        o.list(`pill.${pill}`, suffixes(got));
        if (pill === 'all') all = suffixes(got);
      }
      // an unknown status value: does the list behave as All, or refuse?
      let bogus;
      if (TW(c)) {
        await c.goto(`/admin/coupons?status=bogus&q=${encodeURIComponent(prefix)}`, {
          ready: 'table',
        });
        bogus = suffixes(await codesOnPage(c, prefix));
      } else {
        const r = await opFetch(c, 'GET', `/coupons?status=bogus&q=${encodeURIComponent(prefix)}`);
        bogus = r.ok
          ? suffixes(
              (r.json?.data ?? [])
                .map((x) => x.code.toLowerCase())
                .filter((x) => x.includes(prefix))
                .map((x) => x.slice(prefix.length))
                .sort(),
            )
          : null;
      }
      o.enum(
        'bogus.behavesAs',
        bogus === null
          ? 'refused'
          : JSON.stringify(bogus) === JSON.stringify(all)
            ? 'all'
            : 'other',
      );
    },
  });

  add({
    id: 'list.search-wildcards',
    title: 'Searching % and _ : literal text or SQL wildcards',
    feature: 'TW-CPN-001',
    run: async (c) => {
      const o = c.obs;
      await create(c, { code: c.tag('wc-a'), description: 'plain' });
      await create(c, { code: c.tag('wc-b'), description: 'plain' });
      const prefix = `${c.tagBase}-${c.sid}-`.toLowerCase();
      for (const [id, term] of [
        ['percent', `%${prefix.slice(0, 6)}`],
        ['underscore', `${prefix.slice(0, 3)}_${prefix.slice(4, 8)}`],
        ['tag', prefix],
      ]) {
        await openList(c);
        await searchFor(c, term);
        o.num(`matches.${id}`, (await codesOnPage(c, prefix)).length);
      }
    },
  });

  add({
    id: 'list.pagination-twelve',
    title: 'Fourteen coupons: twelve on the first page, the rest on the second',
    feature: 'TW-CPN-001',
    run: async (c) => {
      const o = c.obs;
      for (let i = 1; i <= 14; i++)
        await create(c, { code: c.tag(`pg${i}`), description: 'page seed' });
      const prefix = `${c.tagBase}-${c.sid}-`.toLowerCase();
      await openList(c);
      await searchFor(c, prefix);
      o.num('page1.rows', (await codesOnPage(c, prefix)).length);
      o.num('page1.rowsAll', await c.page.locator('tbody tr td:first-child').count());
      const next = c
        .loc({
          threadwise: 'a[href*="page=2"]:visible',
          ours: {
            any: [
              { role: 'button', name: /^2$|next|›/i },
              { role: 'link', name: /^2$|next/i },
            ],
          },
        })
        .first();
      const visible = await next.isVisible().catch(() => false);
      o.flag('nextControl', visible);
      if (visible) {
        await next.click();
        await c.afterAction({ quiet: 800 });
        o.num('page2.rows', (await codesOnPage(c, prefix)).length);
      }
    },
  });

  add({
    id: 'list.discount-column',
    title:
      'The Discount, Uses and Validity cells show percent / fixed amounts, redemptions against the cap, and the date range',
    feature: 'TW-CPN-001',
    run: async (c) => {
      const o = c.obs;
      const day = 86400000;
      const pct = c.tag('dc-p');
      const fix = c.tag('dc-f');
      await create(c, { code: pct, type: 'percent', amount: '12.5', maxUses: 40 });
      await create(c, {
        code: fix,
        type: 'fixed',
        amount: '7.5',
        currency: 'USD',
        startsAt: new Date(Date.now() + 2 * day),
        expiresAt: new Date(Date.now() + 9 * day),
      });
      await openList(c);
      await searchFor(c, `${c.tagBase}-${c.sid}-dc`);
      const cells = async (code) => {
        const r = row(c, code.toUpperCase()).first();
        return (await r.locator('td').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim());
      };
      const p = await cells(pct);
      const f = await cells(fix);
      o.enum('percent.discountText', p[1]);
      o.flag('percent.usesShowsCap', /0\s*\/\s*40/.test(p[2]));
      o.flag('percent.validityForever', /forever/i.test(p[3]));
      o.flag('fixed.discountHasPercentSign', /%/.test(f[1]));
      o.num('fixed.discountDigits', Number(f[1].replace(/[^0-9.]/g, '')));
      o.flag('fixed.validityShowsRange', /→|->|–|—|to/i.test(f[3]) || f[3].split(' ').length > 2);
      o.flag('fixed.usesUncapped', /∞|infin|unlimited/i.test(f[2]));
      o.info('fixedCells', f);
    },
  });

  add({
    id: 'toggle.ui',
    title: 'The row switch flips the coupon and the state survives a reload',
    feature: 'TW-CPN-004',
    run: async (c) => {
      const o = c.obs;
      const code = c.tag('tg');
      await create(c, { code });
      const up = code.toUpperCase();
      await openList(c);
      await searchFor(c, code);
      const r = row(c, up).first();
      const sw = TW(c) ? r.locator('label').first() : r.getByRole('switch');
      const before = audit(c);
      await sw.click();
      await c.afterAction({ quiet: 900 });
      o.enum('after1', stored(c, up)?.active);
      await c.page.reload({ waitUntil: 'load' });
      await c.quiet();
      o.enum('afterReload1', stored(c, up)?.active);
      await openList(c);
      await searchFor(c, code);
      const sw2 = TW(c)
        ? row(c, up).first().locator('label').first()
        : row(c, up).first().getByRole('switch');
      await sw2.click();
      await c.afterAction({ quiet: 900 });
      o.enum('after2', stored(c, up)?.active);
      o.num('auditDelta', audit(c) - before);
      function audit(cc) {
        return auditCount(cc);
      }
    },
  });

  add({
    id: 'toggle.missing',
    title: 'Toggling a coupon that does not exist answers not-found',
    feature: 'TW-CPN-004',
    api: false,
    run: async (c) => {
      const r = TW(c)
        ? await c.http('POST', '/admin/coupons/987654321/toggle')
        : await opFetch(c, 'PATCH', `/coupons/${'00000000-0000-4000-8000-000000000000'}/active`, {
            isActive: true,
          });
      c.obs.status('toggle.missing', cls(r.status));
    },
  });

  add({
    id: 'edit.screen',
    title: 'Edit screen: prefilled values equal what was stored; save keeps or changes them',
    feature: 'TW-CPN-003',
    run: async (c) => {
      const o = c.obs;
      const code = c.tag('ed');
      const up = code.toUpperCase();
      await create(c, {
        code,
        type: 'percent',
        amount: '15',
        description: `edit ${code}`,
        adminNote: 'internal',
        maxUses: 50,
        perUser: 2,
        cap: 30,
        min: 5,
        firstOnly: true,
        stackable: true,
      });
      const id = idByCode(c, up);
      await c.goto(`/admin/coupons/${id}/edit`, { ready: '#couponForm' });
      const val = async (sel) =>
        c.page
          .locator(sel)
          .first()
          .inputValue()
          .catch(() => null);
      const sels = TW(c)
        ? {
            code: '[name=code]',
            amount: '[name=amount]',
            maxUses: '[name=max_uses]',
            perUser: '[name=per_user_limit]',
            cap: '[name=max_discount_amount]',
            min: '[name=min_order_amount]',
            desc: '[name=description]',
          }
        : {
            code: '#co-code',
            amount: '#co-amount',
            maxUses: '#co-max-uses',
            perUser: '#co-per-user',
            cap: '#co-max-discount',
            min: '#co-min',
            desc: '#co-desc',
          };
      o.enum('prefill.code', (await val(sels.code))?.toUpperCase());
      o.enum('prefill.amount', normNum(await val(sels.amount)));
      o.enum('prefill.maxUses', await val(sels.maxUses));
      o.enum('prefill.perUser', await val(sels.perUser));
      o.enum('prefill.cap', normNum(await val(sels.cap)));
      o.enum('prefill.min', normNum(await val(sels.min)));
      // unchanged save is a no-op on the stored row and writes no audit row
      const a0 = auditCount(c);
      const save = c
        .loc({ threadwise: '#couponForm button[type=submit]', ours: '#couponForm button[type=submit]' })
        .first();
      const m0 = c.rec.mark();
      await save.click();
      await c.afterAction({ quiet: 900 });
      o.flag(
        'save.unchanged.noRequestError',
        c.rec.since(m0).http.every((x) => x.status < 400),
      );
      o.num('save.unchanged.auditDelta', auditCount(c) - a0);
      o.enum('save.unchanged.stored', JSON.stringify(stored(c, up)));
      o.enum(
        'save.pathAfter',
        new URL(c.page.url()).pathname
          .replace(/\/[^/]+\/edit$/, '/:id/edit')
          .replace(/^\/admin\/coupons$/, '/list'),
      );
      // change the description, clear the max uses
      await c.goto(`/admin/coupons/${id}/edit`, { ready: '#couponForm' });
      await c.fill(sels.desc, `changed ${code}`);
      await c.fill(sels.maxUses, '');
      await save.click();
      await c.afterAction({ quiet: 900 });
      const s = stored(c, up);
      o.enum(
        'save.changed.description',
        s?.description === `changed ${code}` ? 'changed' : s?.description,
      );
      o.enum('save.changed.maxUses', s?.maxUses === '' ? 'cleared' : s?.maxUses);
      o.enum('save.changed.cap', s?.cap);
      o.num('save.changed.auditDelta', auditCount(c) - a0);
    },
  });

  add({
    id: 'edit.missing-id',
    title: 'Edit screen for an unknown id answers not-found',
    feature: 'TW-CPN-003',
    run: async (c) => {
      const resp = await c.page.goto(
        c.url(
          TW(c)
            ? '/admin/coupons/987654321/edit'
            : '/admin/coupons/00000000-0000-4000-8000-000000000000/edit',
        ),
        { waitUntil: 'load' },
      );
      await c.quiet();
      c.obs.status('edit.missing', cls(resp?.status() ?? 0));
      c.obs.flag('shows.form', await c.visible('#couponForm'));
    },
  });

  add({
    id: 'edit.rename-collision',
    title: 'Renaming to a code another coupon already has is refused and nothing changes',
    feature: 'TW-CPN-003',
    run: async (c) => {
      const o = c.obs;
      const a = c.tag('ra');
      const b = c.tag('rb');
      await create(c, { code: a });
      await create(c, { code: b });
      const id = idByCode(c, b.toUpperCase());
      const r = TW(c)
        ? await c.http('PATCH', `/admin/coupons/${id}`, {
            form: { code: a.toLowerCase(), type: 'percent', amount: '10' },
          })
        : await opFetch(c, 'PATCH', `/coupons/${id}`, { code: a.toLowerCase(), rowVersion: 1 });
      o.status('rename.collision', cls(r.status));
      o.enum(
        'rename.codeAfter',
        stored(c, b.toUpperCase())?.code === b.toUpperCase() ? 'unchanged' : 'changed',
      );
    },
  });

  add({
    id: 'edit.concurrent',
    title: 'Two edits of the same coupon: last write wins or the second is refused',
    feature: 'TW-CPN-003',
    run: async (c) => {
      const o = c.obs;
      const code = c.tag('cc');
      const created = await create(c, { code, description: 'v0' });
      const id = created.id;
      let r1;
      let r2;
      if (TW(c)) {
        const body = (d) => ({ form: { code, type: 'percent', amount: '10', description: d } });
        r1 = await c.http('PATCH', `/admin/coupons/${id}`, body('first'));
        r2 = await c.http('PATCH', `/admin/coupons/${id}`, body('second'));
      } else {
        r1 = await opFetch(c, 'PATCH', `/coupons/${id}`, {
          description: 'first',
          rowVersion: created.rowVersion,
        });
        r2 = await opFetch(c, 'PATCH', `/coupons/${id}`, {
          description: 'second',
          rowVersion: created.rowVersion,
        });
      }
      o.status('first', cls(r1.status));
      o.enum(
        'concurrentEdit',
        r2.status === 409 ? 'conflict' : r2.status < 400 ? 'last-write-wins' : `other-${r2.status}`,
      );
      o.enum('finalDescription', stored(c, code.toUpperCase())?.description);
    },
  });

  add({
    id: 'api.rules',
    title:
      'Create rules: bounds, cross-field and reference checks (which cases are accepted, which fields are flagged)',
    feature: 'TW-CPN-002',
    run: async (c) => {
      const o = c.obs;
      const day = 86400000;
      const cases = {
        'percent-150': { amount: '150' },
        'percent-0': { amount: '0' },
        'amount-negative': { amount: '-5' },
        'amount-many-decimals': { amount: '10.123456' },
        'fixed-ok': { type: 'fixed', amount: '5', currency: 'USD' },
        'fixed-cap-on-fixed': { type: 'fixed', amount: '5', cap: '3' },
        'max-uses-0': { maxUses: 0 },
        'max-uses-1': { maxUses: 1 },
        'per-user-0': { perUser: 0 },
        'expires-before-starts': {
          startsAt: new Date(Date.now() + 2 * day),
          expiresAt: new Date(Date.now() + day),
        },
        'expires-equals-starts': {
          startsAt: new Date(Date.now() + day),
          expiresAt: new Date(Date.now() + day),
        },
        'currency-too-long': { currency: 'ABCDEFGHI' },
        'currency-unknown-short': { currency: 'ZZZ' },
        'min-negative': { min: '-1' },
        'cap-negative': { cap: '-1' },
        'amount-text': { amount: 'abc' },
        'amount-thousands': { amount: '1,000' },
        'amount-comma-decimal': { amount: '1,5' },
        'amount-exp': { amount: '1e3' },
        'amount-plus': { amount: '+5' },
        'amount-leading-zeros': { amount: '007' },
        'amount-overflow': { amount: '99999999999999999999' },
        'cap-exp': { cap: '1e3' },
        'min-exp': { min: '1e3' },
        'max-uses-2147483647': { maxUses: 2147483647 },
        'max-uses-2147483648': { maxUses: 2147483648 },
        'per-user-2147483647': { perUser: 2147483647 },
        'currency-usd': { type: 'fixed', amount: '5', currency: 'USD' },
        'plan-unknown': { plans: TW(c) ? [987654321] : ['00000000-0000-4000-8000-000000000000'] },
        'description-256': { description: 'd'.repeat(256) },
        'note-1001': { adminNote: 'n'.repeat(1001) },
      };
      for (const [name, extra] of Object.entries(cases)) {
        const code = c.tag(name.slice(0, 10));
        const r = await create(c, { code, ...extra });
        o.flag(`case.${name}.accepted`, r.ok);
        o.status(`case.${name}`, cls(r.status));
        o.list(`case.${name}.flagged`, r.flagged);
        if (r.ok) await remove(c, r.id ?? idByCode(c, code.toUpperCase()));
      }
    },
  });

  add({
    id: 'api.code-rules',
    title:
      'Code handling: upper-casing, case-insensitive uniqueness, spaces, 64 limit, stored value',
    feature: 'TW-CPN-002',
    run: async (c) => {
      const o = c.obs;
      const base = c.tag('cr');
      const r1 = await create(c, { code: base });
      o.flag('create.accepted', r1.ok);
      o.enum(
        'stored.code',
        stored(c, base.toUpperCase())?.code === base.toUpperCase()
          ? 'upper'
          : (stored(c, base)?.code ?? 'missing'),
      );
      const r2 = await create(c, { code: base.toUpperCase() });
      o.status('dup.exact', cls(r2.status));
      const r3 = await create(c, { code: base.toLowerCase() });
      o.status('dup.case', cls(r3.status));
      const spaced = c.tag('sp');
      const r4 = await create(c, { code: `  ${spaced}  ` });
      o.flag('padded.accepted', r4.ok);
      o.enum(
        'padded.stored',
        stored(c, spaced.toUpperCase())
          ? 'trimmed'
          : stored(c, `  ${spaced.toUpperCase()}  `)
            ? 'kept-spaces'
            : 'missing',
      );
      const r5 = await create(c, { code: `${spaced}-in ner`.slice(0, 40) });
      o.flag('inner-space.accepted', r5.ok);
      const long = (c.tag('lg') + 'x'.repeat(70)).slice(0, 64);
      const r6 = await create(c, { code: long });
      o.flag('len64.accepted', r6.ok);
      const r7 = await create(c, { code: (long + 'y').slice(0, 65) });
      o.flag('len65.accepted', r7.ok);
    },
  });

  add({
    id: 'delete.api-twice',
    title: 'Deleting twice: the second answers not-found; deleting writes one audit row',
    feature: 'TW-CPN-005',
    run: async (c) => {
      const o = c.obs;
      const code = c.tag('dd');
      const r = await create(c, { code });
      const a0 = auditCount(c);
      const d1 = await remove(c, r.id);
      const d2 = await remove(c, r.id);
      o.status('first', cls(d1.status));
      o.status('second', cls(d2.status));
      o.num('auditDelta', auditCount(c) - a0);
      o.flag('gone', !stored(c, code.toUpperCase()));
    },
  });

  add({
    id: 'audit.create-update-delete',
    title: 'Create, update, toggle and delete each leave exactly one audit row',
    feature: 'TW-CPN-002',
    run: async (c) => {
      const o = c.obs;
      const code = c.tag('au');
      const a0 = auditCount(c);
      const r = await create(c, { code });
      o.num('create', auditCount(c) - a0);
      let a1 = auditCount(c);
      if (TW(c))
        await c.http('PATCH', `/admin/coupons/${r.id}`, {
          form: { code, type: 'percent', amount: '11' },
        });
      else
        await opFetch(c, 'PATCH', `/coupons/${r.id}`, { amount: '11', rowVersion: r.rowVersion });
      o.num('update', auditCount(c) - a1);
      a1 = auditCount(c);
      if (TW(c)) await c.http('POST', `/admin/coupons/${r.id}/toggle`);
      else await opFetch(c, 'PATCH', `/coupons/${r.id}/active`, { isActive: false });
      o.num('toggle', auditCount(c) - a1);
      a1 = auditCount(c);
      await remove(c, r.id);
      o.num('delete', auditCount(c) - a1);
    },
  });

  add({
    id: 'security.unauthenticated-api',
    title: 'The coupon endpoints refuse a caller without a session',
    feature: 'TW-CPN-001',
    run: async (c) => {
      const o = c.obs;
      const get = await c.http(
        'GET',
        TW(c) ? '/admin/coupons' : `${c.sideObj.baseUrl}/api/platform/coupons`,
        { anonymous: true },
      );
      o.enum(
        'unauth.list',
        get.status === 401 || get.status === 302 || get.status === 403
          ? 'refused'
          : `open-${get.status}`,
      );
      const post = TW(c)
        ? await c.http('POST', '/admin/coupons', {
            anonymous: true,
            form: { code: 'X', type: 'percent', amount: '1' },
          })
        : await c.http('POST', `${c.sideObj.baseUrl}/api/platform/coupons`, {
            anonymous: true,
            data: { code: 'X', type: 'percent', amount: '1' },
            headers: idem(),
          });
      o.enum(
        'unauth.create',
        post.status === 401 || post.status === 302 || post.status === 403 || post.status === 419
          ? 'refused'
          : `open-${post.status}`,
      );
      o.flag('sec.unauthContentVisible', get.status === 200 && /coupon/i.test(get.text || ''));
    },
  });

  return {
    feature: 'TW-CPN-001',
    title:
      'Admin coupons: list, KPIs, pills, search, create, edit, toggle, delete (TW-CPN-001..005)',
    pages: [],
    scenarios: [
      ...pageScenarios,
      ...formScenarios,
      ...listScenarios,
      ...deleteScenarios,
      ...scenarios,
    ],
    teardown: {
      threadwise: async (c) => sweep(c, likeOf(c)),
      ours: async (c) => sweep(c, likeOf(c)),
    },
    intended: [
      // --- typed numbers: ours takes plain decimals only ----------------------------------------------------------
      {
        scenario:
          /^coupon-create\.(amount|max_discount_amount|min_order_amount)\.(exp|plus-sign|huge|max|max\+1)$/,
        key: /^(enum\.outcome|flag\.accepted|map\.stored|set\.flaggedFields|status\.submit|abs\.focusQuality|num\.submitRequests)$/,
        quirk:
          'Reference takes exponent notation and a leading plus sign, and answers 500 when a number overflows its column',
        reason:
          'ours accepts plain decimals only (up to 8 whole digits and 4 decimals, the numeric(12,4) column) and says so on the field before any request; Reference answers 500 for numbers its column cannot hold',
      },
      {
        scenario: /^coupon-create\.(max_uses|per_user_limit)\.(exp|huge|max|max\+1)$/,
        key: /^(enum\.outcome|flag\.accepted|map\.stored|set\.flaggedFields|status\.submit|abs\.focusQuality|num\.submitRequests)$/,
        quirk:
          'Reference takes exponent notation, answers 500 or silently drops values that overflow, and has no ceiling below 4 billion',
        reason:
          'ours accepts whole numbers from 1 to 2,000,000,000 (a 32-bit counter) written as plain digits and flags the field otherwise',
      },
      {
        scenario: /^coupon-create\.(max_uses|per_user_limit)\.leading-zeros$/,
        key: 'map.stored',
        quirk:
          'Reference refuses 007 for a whole-number field (PHP integer rule) and shows only a summary box',
        reason: 'ours reads 007 as the number 7 and stores 7',
      },
      // --- text storage ----------------------------------------------------------------------------------------------
      {
        scenario: /^coupon-create\.(admin_note|code|description)\.null-byte$/,
        key: /^(enum\.outcome|flag\.accepted|flag\.formLevelError|map\.stored|status\.submit|abs\.focusQuality)$/,
        quirk: 'Reference stores a NUL byte inside a text value',
        reason:
          'PostgreSQL cannot store a NUL byte: ours refuses the value with a form-level error instead of storing something else',
      },
      {
        scenario: /^coupon-create\.(admin_note|description|code)\.emoji$/,
        key: 'map.stored',
        quirk: 'Reference stores four-byte characters as question marks (its table is not utf8mb4)',
        reason: 'ours stores the emoji intact; the Reference data loss is a bug we do not reproduce',
      },
      {
        scenario: /^coupon-create\.(admin_note|description)\.newline$/,
        key: 'map.stored',
        quirk: 'an HTML form post carries line breaks as CRLF',
        reason:
          'ours sends the typed line break (LF) in JSON; the text is the same, only the transport differs',
      },
      {
        scenario: /^coupon-create\.(admin_note|description|code)\.zero-width$/,
        key: 'map.stored',
        quirk: 'Reference string trimming also removes a trailing zero-width joiner',
        reason: 'ours keeps every character exactly as typed (it only trims ordinary whitespace)',
      },
      {
        scenario: /^coupon-create\.code\.unicode$/,
        key: 'map.stored',
        quirk: 'Reference upper-cases ASCII letters only (PHP strtoupper)',
        reason:
          'ours upper-cases the whole code with full Unicode rules, so accented letters match what the operator sees',
      },
      {
        scenario: /^coupon-create\.(code\.spaces|max_uses\.huge|per_user_limit\.(exp|huge))$/,
        key: /^(enum\.outcome|flag\.accepted|map\.stored|set\.flaggedFields|status\.submit|abs\.focusQuality|num\.submitRequests)$/,
        quirk: 'Reference refuses these with a summary box that no single field carries',
        reason:
          'both sides refuse the value and store nothing; ours flags the field and blocks before any request, Reference sends the request and shows a summary box the harness reads as no feedback',
      },
      // --- load time of the dev server ----------------------------------------------------------------------------------
      {
        scenario: /^page\.(list|create)\.load$/,
        key: /^perf\.(lcpMs|loadMs)$/,
        quirk: 'our web app runs in next dev for the twin run',
        reason:
          'the first paint includes the dev server compile of the page and its data requests; a production build is not what is measured here',
      },
      // --- keyboard probe artefacts ------------------------------------------------------------------------------------
      {
        scenario: /^page\.(list|create)\.keyboard$/,
        key: 'flag.keyboard.skipLink',
        quirk: 'Reference console has no skip-to-content link',
        reason:
          'ours adds a skip link on every console page (better keyboard access); a deliberate improvement over Reference',
      },
      {
        scenario: /^page\.(list|create)\.keyboard$/,
        key: /^abs\.keyboard\.(reachable|focusVisible)$/,
        quirk:
          'the keyboard probe keys a stop by its viewport position, which repeats after the page scrolls',
        reason:
          'a manual Tab walk over the same screens reaches every control (the probe stops early when scrolling puts a later row at the position of an earlier one) and the only stop without a focus ring is the framework dev overlay of the dev server',
      },
      {
        scenario: /^api\.rules$/,
        key: /case\.(amount-exp|amount-plus|amount-overflow|cap-exp|min-exp)\b/,
        quirk:
          'Reference takes exponent notation and a leading plus sign, and answers 500 for an amount that overflows its column',
        reason:
          'ours accepts plain decimals only (up to 8 whole digits and 4 decimals) and answers 422 naming the field; Reference answers 500 for numbers its column cannot hold',
      },
      {
        scenario: /^api\.rules$/,
        key: /case\.(max-uses-2147483647|max-uses-2147483648|per-user-2147483647)\b/,
        quirk: 'Reference has no ceiling below 4 billion for the redemption counters',
        reason:
          'ours accepts counters from 1 to 2,000,000,000 (a 32-bit counter with headroom) and answers 422 naming the field above that',
      },
      {
        scenario: /^api\.code-rules$/,
        key: /^status\.dup\.(exact|case)$/,
        quirk: 'Reference reports a taken code as a validation error (422)',
        reason:
          'a taken code answers 409 with the stable code CPN_COUPON_CODE_TAKEN; the duplicate is refused and nothing is saved on both sides, only the status class differs',
      },
      {
        scenario: /^edit\.rename-collision$/,
        key: 'status.rename.collision',
        quirk: 'Reference reports a taken code as a validation error (422)',
        reason:
          'renaming onto a taken code answers 409 CPN_COUPON_CODE_TAKEN; refused and unchanged on both sides, only the status class differs',
      },
      {
        scenario: /^api\.rules$/,
        key: /amount-many-decimals/,
        quirk:
          'Reference silently rounds an amount typed with more than four decimals to its numeric(12,4) column',
        reason:
          'we refuse an amount with more than four decimals (422 on amount) instead of storing a different number than the operator typed',
      },
      {
        scenario: /^edit\.concurrent$/,
        key: 'enum.finalDescription',
        quirk: 'Reference lets the last of two stale edits win',
        reason:
          'consequence of optimistic locking (rule optimistic-locking): the stale second edit is refused, so the first edit stays',
      },
      {
        scenario: /^list\.search-wildcards$/,
        key: /^num\.matches\.(percent|underscore)$/,
        quirk: 'Reference search passes % and _ to LIKE unescaped, so they act as wildcards',
        reason:
          'search is literal: % and _ match only themselves (inventory TW-CPN-001 port note: escape LIKE wildcards)',
      },
    ],
    skip: [],
  };
};
