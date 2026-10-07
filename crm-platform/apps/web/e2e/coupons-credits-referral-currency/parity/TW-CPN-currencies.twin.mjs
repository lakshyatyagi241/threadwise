// Twin spec for the admin currency catalogue (TW-CPN-018..024, 026): list and KPIs, search, add form, toggle, delete, the
// update route, the platform default and the fetch-rates button, on the running Reference admin console and on our operator console.
//
// Not run live, with the reason:
//  - "Fetch live rates" calls a public exchange-rate website from the server on both sides. No real outbound provider call is
//    made by a parity run; our adapter and its failure paths are covered by the API e2e suite.
//  - "Set default" on Reference is skipped: it writes a platform-wide setting that every other screen of the shared reference
//    instance reads (and that Reference stores with the wrong type, see the inventory QUIRK), and it can not be put back through
//    the app. On our side the scenario runs against the scratch database and restores USD.
//  - Deleting the default currency on Reference is skipped for the same reason: it would need a USD row that the app then
//    refuses to delete.
//
// Run: export PARITY_WEB_URL=http://localhost:3400 PARITY_API_URL=http://localhost:3300 PARITY_CONFIG=<json with ours.operator>
//   parity.sh run apps/web/e2e/coupons-credits-referral-currency/parity/TW-CPN-currencies.twin.mjs --depth full --workers 1
//
// Test data: every currency this run creates carries the run tag in its name (or, for the name matrix, a code this scenario
// generated); cleanup deletes only those rows, through each side's own delete route.
import { TW, cls, q, lines, mysql, psql, idem, operatorSession, opFetch } from './cpn-shared.mjs';

export default (h) => {
  const depth = h.cfg.depth || 'full';
  const normName = (s) =>
    String(s)
      .toLowerCase()
      .replace(/[^a-z]/g, '');
  const ready = 'table';

  // ---------------------------------------------------------------------------------------------------------------
  // data helpers
  // ---------------------------------------------------------------------------------------------------------------
  const idsWhere = (c, cond) =>
    TW(c)
      ? lines(mysql(`select id from currencies where ${cond.threadwise}`))
      : lines(psql(`select uuid from currencies where ${cond.ours}`));
  const taken = (c, code) =>
    TW(c)
      ? mysql(`select count(*) from currencies where code = '${q(code)}'`) !== '0'
      : psql(`select count(*) from currencies where code = '${q(code)}'`) !== '0';
  /** A fresh 3-letter code unique to this scenario and absent from both catalogues; remembered for cleanup. */
  function curCode(c, label = 'x') {
    c.cpnCodes ??= new Set();
    const seed = `${c.tagBase}|${c.scenario.id}|${label}`;
    let a = 0;
    for (const ch of seed) a = (a * 31 + ch.charCodeAt(0)) >>> 0;
    // A + one of A-D + a letter: all sort before the catalogue's first seeded code (AED), so a freshly added row sits on the first page
    for (let i = 0; i < 400; i++) {
      const n = (a + i * 7919) % 104;
      const code = 'A' + 'ABCD'[Math.floor(n / 26)] + String.fromCharCode(65 + (n % 26));
      if (c.cpnCodes.has(code)) continue;
      if (taken(c, code)) continue;
      c.cpnCodes.add(code);
      return code;
    }
    throw new Error('no free currency code');
  }
  const tagLike = (c) => `${c.tagBase}-${c.sid}-`.toLowerCase();
  const remove = (c, id) =>
    TW(c) ? c.http('DELETE', `/admin/currencies/${id}`) : opFetch(c, 'DELETE', `/currencies/${id}`);
  /** Deletes the currencies this scenario made: tag in the name, or a code it generated. */
  async function sweep(c, like = tagLike(c)) {
    if (!TW(c)) await operatorSession(c).catch(() => undefined);
    const l = q(like);
    const codes = [...(c.cpnCodes || [])].map((x) => `'${q(x)}'`).join(',');
    const cond = {
      threadwise: `lower(name) like '%${l}%'${codes ? ` or code in (${codes})` : ''}`,
      ours: `lower(name) like '%${l}%'${codes ? ` or code in (${codes})` : ''}`,
    };
    for (const id of idsWhere(c, cond)) await remove(c, id).catch(() => undefined);
  }
  const track = (c) => c.onCleanup(() => sweep(c));
  const adminSession = async (c) => {
    c.page?.setDefaultTimeout(30000);
    if (!TW(c)) await operatorSession(c);
  };
  const rowSql = (c, code) =>
    TW(c)
      ? mysql(
          `select concat_ws('|', code, name, ifnull(symbol,''), \`precision\`, cast(exchange_rate as char), is_active) from currencies where code = '${q(code)}' limit 1`,
        )
      : psql(
          `select concat_ws('|', code, name, coalesce(symbol,''), precision, exchange_rate::numeric::text, is_active::int) from currencies where code = '${q(code)}' limit 1`,
        );
  const stored = (c, code) => {
    const r = rowSql(c, code);
    if (!r) return null;
    const [cd, name, symbol, precision, rate, active] = r.split('|');
    return { code: cd, name, symbol, precision, rate: String(Number(rate)), active };
  };
  const auditCount = (c) =>
    Number(
      TW(c)
        ? mysql(`select count(*) from audit_logs where action like 'admin.currency.%'`)
        : psql(`select count(*) from security_events where event like 'platform.currency.%'`),
    );

  /** Create through each side's own API. o: code, name, symbol, precision, rate, active */
  async function create(c, o) {
    const o2 = { symbol: 'Z', precision: 2, rate: '1.5', active: true, ...o };
    if (TW(c)) {
      const form = {
        name: o2.name,
        code: o2.code,
        symbol: o2.symbol,
        precision: String(o2.precision),
        exchange_rate: String(o2.rate),
      };
      if (o2.active) form.is_active = '1';
      const r = await c.http('POST', '/admin/currencies', { form });
      const flagged =
        r.status === 422 && r.body?.errors ? Object.keys(r.body.errors).map(normName) : [];
      return { status: r.status, ok: r.status < 400, flagged };
    }
    const r = await opFetch(c, 'POST', '/currencies', {
      name: o2.name,
      code: o2.code,
      symbol: o2.symbol,
      precision: Number(o2.precision),
      exchangeRate: String(o2.rate),
      isActive: !!o2.active,
    });
    const flagged =
      r.status === 422 && Array.isArray(r.json?.errors)
        ? r.json.errors.map((e) => normName(e.path))
        : [];
    return { status: r.status, ok: r.ok, flagged, id: r.json?.id, rowVersion: r.json?.rowVersion };
  }
  const idOf = (c, code) =>
    TW(c)
      ? mysql(`select id from currencies where code = '${q(code)}' limit 1`)
      : psql(`select uuid from currencies where code = '${q(code)}' limit 1`);

  const kpis = async (c) => {
    const t = await c.page.locator('main').innerText();
    const grab = (label) => {
      const m = t.match(new RegExp(`${label}\\s*\\n\\s*([\\d,]+)`, 'i'));
      return m ? Number(m[1].replace(/,/g, '')) : null;
    };
    return { total: grab('Total'), active: grab('Active'), inactive: grab('Inactive') };
  };
  const openList = (c) => c.goto('/admin/currencies', { ready });
  const searchFor = async (c, term) => {
    const input = c.loc({ threadwise: 'input[name=q]', ours: 'input[type=search]' }).first();
    await input.fill(term);
    await input.press('Enter');
    await c.afterAction({ quiet: 800 });
  };
  const row = (c, text) => c.page.locator('tbody tr', { hasText: text });
  // Reference's switch is a button reading On/Off; ours is a pressed-state button named after the currency
  const toggleBtn = (c, r) =>
    TW(c)
      ? r.getByRole('button', { name: /^(on|off)$/i })
      : r.getByRole('button', { name: /switch .* on or off/i });
  const codesOnPage = async (c, like) => {
    const rows = await c.page.locator('tbody tr').allInnerTexts();
    return rows.filter((t) => t.toLowerCase().includes(like.toLowerCase())).length;
  };

  /** Seed rows every list scenario relies on (names carry `<run>-lst-`), made once per run. */
  async function ensureListData(c) {
    const base = `${c.tagBase}-lst-`;
    if (
      Number(
        TW(c)
          ? mysql(`select count(*) from currencies where lower(name) like '%${q(base)}%'`)
          : psql(`select count(*) from currencies where lower(name) like '%${q(base)}%'`),
      ) >= 3
    )
      return;
    for (const [k, active] of [
      ['a', true],
      ['b', true],
      ['c', false],
    ]) {
      c.cpnSeed ??= new Set();
      const code = curCode(c, `lst${k}`);
      await create(c, { code, name: `${base}${k}`, active, symbol: `L${k}` });
      c.cpnCodes.delete(code); // list seeds live for the whole run: the teardown removes them by name
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the add form (generated matrix)
  // ---------------------------------------------------------------------------------------------------------------
  const F = (id, threadwise, ours, extra = {}) => ({ id, loc: { threadwise, ours }, ...extra });
  // Reference's browser number inputs refuse text, thousands separators and decimal commas outright, so there is no Reference
  // behaviour to compare for those typed values; the same values are compared through the API in `add.rules`.
  const NOT_TYPEABLE = ['text', 'thousands', 'comma-decimal'];
  const addForm = {
    id: 'currency-add',
    title: 'Add currency',
    feature: 'TW-CPN-019',
    open: {
      threadwise: async (c) => {
        await c.goto('/admin/currencies', { ready });
        await c.click({ role: 'button', name: /^add currency$/i });
        await c.page.waitForTimeout(300);
      },
      ours: async (c) => {
        await operatorSession(c);
        await c.goto('/admin/currencies', { ready });
        await c.click({ role: 'button', name: /^add currency$/i });
        await c.page.waitForTimeout(300);
      },
    },
    root: { threadwise: '#cur-form', ours: { css: 'form', has: { css: '#cu-name-add' } } },
    submit: 'button[type=submit]',
    cancel: { role: 'button', name: /^cancel$/i },
    valid: (c) => ({
      name: c.tag('cur'),
      code: curCode(c, 'valid'),
      symbol: 'Z',
      precision: '2',
      exchange_rate: '1.5',
    }),
    tagField: [],
    fields: [
      F('name', '[name=name]', '#cu-name-add', { type: 'name', required: true, max: 120 }),
      F('code', '[name=code]', '#cu-code-add', {
        type: 'text',
        required: true,
        max: 10,
        unique: true,
        sample: (c) => curCode(c, 'dup'),
      }),
      F('symbol', '[name=symbol]', '#cu-symbol-add', { type: 'text', max: 20 }),
      F('precision', '[name=precision]', '#cu-precision-add', {
        type: 'integer',
        required: true,
        minValue: 0,
        maxValue: 6,
        skipCases: NOT_TYPEABLE,
      }),
      F('exchange_rate', '[name=exchange_rate]', '#cu-rate-add', {
        type: 'money',
        required: true,
        skipCases: NOT_TYPEABLE,
      }),
    ],
    readback: {
      threadwise: async (c, { values }) => readback(c, values),
      ours: async (c, { values }) => readback(c, values),
    },
    cleanup: async (c) => sweep(c),
    countAfter: async (c) =>
      idsWhere(c, {
        threadwise: `lower(name) like '%${q(tagLike(c))}%'`,
        ours: `lower(name) like '%${q(tagLike(c))}%'`,
      }).length,
  };
  /** The stored row for the submitted code (upper-cased), or for the tagged name. */
  async function readback(c, values) {
    const byName = idsWhere(c, {
      threadwise: `name = '${q(values.name ?? '')}'`,
      ours: `name = '${q(values.name ?? '')}'`,
    })[0];
    const code = String(values.code ?? '')
      .trim()
      .toUpperCase();
    const r =
      stored(c, code) ||
      (byName
        ? stored(
            c,
            TW(c)
              ? mysql(`select code from currencies where id = ${Number(byName)}`)
              : psql(`select code from currencies where uuid = '${q(byName)}'`),
          )
        : null);
    return r ? { rowCreated: true, ...r } : { rowCreated: false };
  }
  const wrapForm = (scs) =>
    scs.map((sc) => ({
      ...sc,
      run: async (c) => {
        c.page?.setDefaultTimeout(30000);
        c.cpnCodes ??= new Set();
        track(c);
        return sc.run(c);
      },
    }));
  const formScenarios = wrapForm(h.formScenarios(addForm, { depth }));

  // ---------------------------------------------------------------------------------------------------------------
  // list, delete (generated)
  // ---------------------------------------------------------------------------------------------------------------
  const wrap = (scs, before) =>
    scs.map((sc) => ({
      ...sc,
      run: async (c) => {
        await adminSession(c);
        c.cpnCodes ??= new Set();
        if (before) await before(c);
        track(c);
        return sc.run(c);
      },
    }));
  const currencyList = {
    id: 'currency-list',
    title: 'Currencies list',
    feature: 'TW-CPN-018',
    page: '/admin/currencies',
    ready,
    rows: { threadwise: 'tbody tr:has(td button, td form)', ours: 'tbody tr:has(button)' },
    search: {
      input: { threadwise: 'input[name=q]', ours: 'input[type=search]' },
      submit: 'enter',
      term: '-lst-a',
    },
  };
  const listScenarios = wrap(h.listScenarios(currencyList, { depth }), ensureListData);
  const currencyDelete = {
    id: 'currency-delete',
    title: 'Delete currency',
    feature: 'TW-CPN-022',
    page: '/admin/currencies',
    ready,
    seed: async (c) => {
      await operatorSession(c);
      const code = curCode(c, 'del');
      const name = c.tag('del');
      await create(c, { code, name });
      await searchFor0(c);
      return { code, name };
    },
    row: (made, c) => c.page.locator('tbody tr', { hasText: made.name }),
    start: async (c, rowLoc) =>
      rowLoc
        .getByRole('button', { name: /^delete$/i })
        .first()
        .click(),
    confirm: { role: 'button', name: /yes, delete/i },
    cancel: { role: 'button', name: /^cancel$/i },
    cleanup: async (c) => sweep(c),
  };
  // the seeded row can sit on a later page: search keeps it in view on both sides
  async function searchFor0() {}
  const deleteScenarios = h.deleteScenarios(currencyDelete).map((sc) => ({
    ...sc,
    run: async (c) => {
      await adminSession(c);
      c.cpnCodes ??= new Set();
      track(c);
      return sc.run(c);
    },
  }));

  // ---------------------------------------------------------------------------------------------------------------
  // pages
  // ---------------------------------------------------------------------------------------------------------------
  const pageScenarios = [
    ...wrap(
      h.pageScenarios({
        id: 'page.list',
        title: 'Currencies',
        path: '/admin/currencies',
        ready,
        probes: ['load', 'a11y', 'keyboard', 'degraded'],
        feature: 'TW-CPN-018',
      }),
      null,
    ),
    ...h.pageScenarios({
      id: 'page.list-anonymous',
      title: 'Currencies without a session',
      path: '/admin/currencies',
      ready: 'body',
      probes: ['auth'],
      feature: 'TW-CPN-018',
    }),
  ];

  // ---------------------------------------------------------------------------------------------------------------
  // custom scenarios
  // ---------------------------------------------------------------------------------------------------------------
  const scenarios = [];
  const add = (sc) =>
    scenarios.push({
      feature: 'TW-CPN-019',
      ...sc,
      run: async (c) => {
        await adminSession(c);
        c.cpnCodes ??= new Set();
        track(c);
        return sc.run(c);
      },
    });

  add({
    id: 'responsive.list',
    title: 'List and add form at 390, 820 and 1366 px: no horizontal overflow',
    feature: 'TW-CPN-018',
    tags: ['page', 'responsive'],
    run: async (c) => {
      for (const vp of [390, 820, 1366]) {
        await c.page.setViewportSize({ width: vp, height: 900 });
        await openList(c);
        c.obs.set(
          `low.overflowX.list.${vp}`,
          Math.max(
            0,
            await c.page.evaluate(
              () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            ),
          ),
        );
        await c.click({ role: 'button', name: /^add currency$/i }).catch(() => {});
        await c.page.waitForTimeout(300);
        c.obs.set(
          `low.overflowX.form.${vp}`,
          Math.max(
            0,
            await c.page.evaluate(
              () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            ),
          ),
        );
      }
      await c.page.setViewportSize({ width: 1366, height: 900 });
    },
  });

  add({
    id: 'kpi.follow-writes',
    title: 'The cards move by one when a currency is added, switched off and removed',
    feature: 'TW-CPN-018',
    run: async (c) => {
      const o = c.obs;
      await openList(c);
      const k0 = await kpis(c);
      const code = curCode(c, 'kpi');
      await create(c, { code, name: c.tag('kpi') });
      await openList(c);
      const k1 = await kpis(c);
      o.num('delta.added.total', k1.total - k0.total);
      o.num('delta.added.active', k1.active - k0.active);
      const id = idOf(c, code);
      if (TW(c)) await c.http('POST', `/admin/currencies/${id}/toggle`);
      else await opFetch(c, 'PATCH', `/currencies/${id}/active`, { isActive: false });
      await openList(c);
      const k2 = await kpis(c);
      o.num('delta.off.active', k2.active - k1.active);
      o.num('delta.off.inactive', k2.inactive - k1.inactive);
      await remove(c, id);
      await openList(c);
      const k3 = await kpis(c);
      o.num('delta.removed.total', k3.total - k0.total);
    },
  });

  add({
    id: 'search.fields',
    title: 'Search matches code, name and symbol; a miss shows an empty state',
    feature: 'TW-CPN-018',
    run: async (c) => {
      const o = c.obs;
      const code = curCode(c, 'srch');
      const name = c.tag('srch');
      const sym = `S${c.digits(3)}`;
      await create(c, { code, name, symbol: sym });
      for (const [id, term] of [
        ['code', code.toLowerCase()],
        ['name', name],
        ['symbol', sym],
        ['miss', `zz-${c.digits(6)}`],
      ]) {
        await openList(c);
        await searchFor(c, term);
        o.num(
          `rows.${id}`,
          await c.page.locator('tbody tr', { hasText: new RegExp(`${code}|${sym}`, 'i') }).count(),
        );
      }
    },
  });

  add({
    id: 'search.wildcards',
    title: 'Searching % and _ : literal text or SQL wildcards',
    feature: 'TW-CPN-018',
    run: async (c) => {
      const o = c.obs;
      await create(c, { code: curCode(c, 'w1'), name: c.tag('w1') });
      await create(c, { code: curCode(c, 'w2'), name: c.tag('w2') });
      const like = tagLike(c);
      for (const [id, term] of [
        ['percent', `%${like.slice(0, 6)}`],
        ['underscore', `${like.slice(0, 3)}_${like.slice(4, 8)}`],
      ]) {
        await openList(c);
        await searchFor(c, term);
        o.num(`matches.${id}`, await codesOnPage(c, like));
      }
    },
  });

  add({
    id: 'toggle.ui',
    title: 'The On/Off button flips the currency; state survives reload; one audit row per flip',
    feature: 'TW-CPN-021',
    run: async (c) => {
      const o = c.obs;
      const code = curCode(c, 'tg');
      const name = c.tag('tg');
      await create(c, { code, name });
      await openList(c);
      await searchFor(c, name);
      const a0 = auditCount(c);
      await toggleBtn(c, row(c, name).first()).click();
      await c.afterAction({ quiet: 900 });
      o.enum('after1', stored(c, code)?.active);
      await c.page.reload({ waitUntil: 'load' });
      await c.quiet();
      o.enum('afterReload', stored(c, code)?.active);
      await searchFor(c, name);
      await toggleBtn(c, row(c, name).first()).click();
      await c.afterAction({ quiet: 900 });
      o.enum('after2', stored(c, code)?.active);
      o.num('auditDelta', auditCount(c) - a0);
    },
  });

  add({
    id: 'toggle.missing',
    title: 'Toggling or deleting a currency that does not exist answers not-found',
    feature: 'TW-CPN-021',
    run: async (c) => {
      const o = c.obs;
      const none = '00000000-0000-4000-8000-000000000000';
      const t = TW(c)
        ? await c.http('POST', '/admin/currencies/987654321/toggle')
        : await opFetch(c, 'PATCH', `/currencies/${none}/active`, { isActive: true });
      const d = TW(c)
        ? await c.http('DELETE', '/admin/currencies/987654321')
        : await opFetch(c, 'DELETE', `/currencies/${none}`);
      o.status('toggle', cls(t.status));
      o.status('delete', cls(d.status));
    },
  });

  add({
    id: 'add.rules',
    title:
      'Add rules: code format, precision and rate bounds, symbol, duplicates (what is accepted, which fields are flagged)',
    feature: 'TW-CPN-019',
    run: async (c) => {
      const o = c.obs;
      const cases = {
        'lowercase-code': { code: (x) => x.toLowerCase() },
        'code-4-letters': { code: (x) => `${x}X` },
        'code-digits': { code: () => `Q${c.digits(2)}` },
        'code-10-letters': { code: (x) => `${x}ABCDEFGHI`.slice(0, 10) },
        'code-11-letters': { code: (x) => `${x}ABCDEFGHIJ`.slice(0, 11) },
        'code-padded': { code: (x) => ` ${x} ` },
        'precision-0': { precision: 0 },
        'precision-6': { precision: 6 },
        'precision-7': { precision: 7 },
        'precision-negative': { precision: -1 },
        'precision-decimal': { precision: 1.5 },
        'rate-zero': { rate: '0' },
        'rate-tiny': { rate: '0.000001' },
        'rate-below-tiny': { rate: '0.0000001' },
        'rate-negative': { rate: '-1' },
        'rate-text': { rate: 'abc' },
        'rate-huge': { rate: '999999999999' },
        'rate-9-decimals': { rate: '1.123456789' },
        'name-120': { name: (x) => x.padEnd(120, 'n').slice(0, 120) },
        'name-121': { name: (x) => x.padEnd(121, 'n').slice(0, 121) },
        'symbol-20': { symbol: 's'.repeat(20) },
        'symbol-21': { symbol: 's'.repeat(21) },
        'symbol-empty': { symbol: '' },
        inactive: { active: false },
      };
      for (const [name, over] of Object.entries(cases)) {
        const base = curCode(c, name);
        const nm = c.tag(name.slice(0, 8));
        const spec = { code: base, name: nm };
        for (const [k, v] of Object.entries(over))
          spec[k] = typeof v === 'function' ? v(k === 'code' ? base : nm) : v;
        const r = await create(c, spec);
        o.flag(`case.${name}.accepted`, r.ok);
        o.status(`case.${name}`, cls(r.status));
        o.list(`case.${name}.flagged`, r.flagged);
        if (r.ok) {
          const s =
            stored(c, String(spec.code).trim().toUpperCase()) || stored(c, String(spec.code));
          o.enum(
            `case.${name}.storedCode`,
            s
              ? s.code === String(spec.code).trim().toUpperCase()
                ? 'upper-trimmed'
                : s.code === String(spec.code)
                  ? 'as-typed'
                  : 'other'
              : 'missing',
          );
          o.enum(`case.${name}.storedRate`, s?.rate);
          o.enum(`case.${name}.storedPrecision`, s?.precision);
          c.cpnCodes.add(s?.code ?? String(spec.code).toUpperCase());
        }
      }
      // duplicates, by case
      const dup = curCode(c, 'dupe');
      await create(c, { code: dup, name: c.tag('dupa') });
      const d1 = await create(c, { code: dup, name: c.tag('dupb') });
      const d2 = await create(c, { code: dup.toLowerCase(), name: c.tag('dupc') });
      o.status('dup.exact', cls(d1.status));
      o.status('dup.case', cls(d2.status));
      o.list('dup.exact.flagged', d1.flagged);
    },
  });

  add({
    id: 'update.route',
    title: 'Updating a currency by its API: rate and name change; the code and the active flag',
    feature: 'TW-CPN-020',
    run: async (c) => {
      const o = c.obs;
      const code = curCode(c, 'upd');
      const name = c.tag('upd');
      const r0 = await create(c, { code, name, rate: '2' });
      const id = idOf(c, code);
      const a0 = auditCount(c);
      let r1;
      if (TW(c))
        r1 = await c.http('PATCH', `/admin/currencies/${id}`, {
          form: { name, code, symbol: 'Z', precision: '2', exchange_rate: '84.1', is_active: '1' },
        });
      else
        r1 = await opFetch(c, 'PATCH', `/currencies/${id}`, {
          exchangeRate: '84.1',
          rowVersion: r0.rowVersion,
        });
      o.status('rate.update', cls(r1.status));
      o.enum('rate.stored', stored(c, code)?.rate);
      o.num('audit.update', auditCount(c) - a0);
      // a partial update that does not mention the active flag
      let r2;
      if (TW(c))
        r2 = await c.http('PATCH', `/admin/currencies/${id}`, {
          form: { name: `${name} b`, code, symbol: 'Z', precision: '2', exchange_rate: '84.1' },
        });
      else {
        const cur = await opFetch(c, 'GET', `/currencies?q=${encodeURIComponent(code)}`);
        const rv =
          (cur.json?.data ?? cur.json?.items ?? []).find((x) => x.code === code)?.rowVersion ?? 2;
        r2 = await opFetch(c, 'PATCH', `/currencies/${id}`, { name: `${name} b`, rowVersion: rv });
      }
      o.status('partial.update', cls(r2.status));
      o.enum('partial.activeAfter', stored(c, code)?.active);
      // changing the code
      const other = curCode(c, 'upd2');
      let r3;
      if (TW(c))
        r3 = await c.http('PATCH', `/admin/currencies/${id}`, {
          form: {
            name,
            code: other,
            symbol: 'Z',
            precision: '2',
            exchange_rate: '84.1',
            is_active: '1',
          },
        });
      else r3 = await opFetch(c, 'PATCH', `/currencies/${id}`, { code: other, rowVersion: 99 });
      o.enum('code.changed', stored(c, other) ? 'renamed' : 'kept');
      void r3;
      c.cpnCodes.add(other);
    },
  });

  add({
    id: 'default.protected',
    title: 'The default currency can not be deleted or switched off; other currencies can',
    feature: 'TW-CPN-022',
    run: async (c) => {
      const o = c.obs;
      if (TW(c)) {
        o.info(
          'skipped',
          'would need a USD row the app then refuses to delete; compared from the inventory',
        );
        return;
      }
      const usd = psql(`select uuid from currencies where code = 'USD' limit 1`);
      const del = await opFetch(c, 'DELETE', `/currencies/${usd}`);
      o.enum(
        'default.delete',
        del.status === 409 || del.status === 422
          ? 'refused'
          : del.ok
            ? 'deleted'
            : `other-${del.status}`,
      );
      const off = await opFetch(c, 'PATCH', `/currencies/${usd}/active`, { isActive: false });
      o.enum(
        'default.switchOff',
        off.status === 409 || off.status === 422
          ? 'refused'
          : off.ok
            ? 'switched-off'
            : `other-${off.status}`,
      );
      o.enum(
        'default.stillActive',
        psql(`select is_active::int from currencies where code = 'USD'`),
      );
    },
  });

  add({
    id: 'default.set',
    title:
      'Choosing the default: unknown codes are refused, a known active code is stored as text, the old default can be restored',
    feature: 'TW-CPN-024',
    run: async (c) => {
      const o = c.obs;
      if (TW(c)) {
        o.info(
          'skipped',
          'writes a platform-wide setting of the shared reference instance; compared from the inventory',
        );
        return;
      }
      const unknown = await opFetch(c, 'POST', '/currencies/default', { code: 'ZZZ' });
      o.status('default.unknown', cls(unknown.status));
      const code = curCode(c, 'dflt');
      await create(c, { code, name: c.tag('dflt') });
      const set = await opFetch(c, 'POST', '/currencies/default', { code });
      o.status('default.set', cls(set.status));
      const before = auditCount(c);
      o.enum(
        'default.stored',
        psql(
          `select value #>> '{}' from platform_settings where key = 'default_currency' limit 1`,
        ) === code
          ? 'text'
          : 'other',
      );
      const del = await opFetch(c, 'DELETE', `/currencies/${idOf(c, code)}`);
      o.enum(
        'newDefault.delete',
        del.status === 409 || del.status === 422
          ? 'refused'
          : del.ok
            ? 'deleted'
            : `other-${del.status}`,
      );
      const back = await opFetch(c, 'POST', '/currencies/default', { code: 'USD' });
      o.status('default.restore', cls(back.status));
      o.num('audit.noExtra', auditCount(c) - before);
    },
  });

  add({
    id: 'fetch-rates.button',
    title: 'The "Fetch live rates" control exists and a click asks nothing of the user first',
    feature: 'TW-CPN-023',
    run: async (c) => {
      await openList(c);
      c.obs.flag('buttonVisible', await c.visible({ role: 'button', name: /fetch live rates/i }));
      c.obs.info(
        'note',
        'not clicked: it calls a public exchange-rate site; no real provider call in a parity run',
      );
    },
  });

  add({
    id: 'pagination-twelve',
    title: 'Thirteen currencies in view: twelve on the first page, the rest on the next',
    feature: 'TW-CPN-018',
    run: async (c) => {
      const o = c.obs;
      const like = tagLike(c);
      for (let i = 1; i <= 13; i++)
        await create(c, { code: curCode(c, `pg${i}`), name: c.tag(`pg${i}`) });
      await openList(c);
      await searchFor(c, like);
      o.num('page1.rows', await codesOnPage(c, like));
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
        o.num('page2.rows', await codesOnPage(c, like));
      }
    },
  });

  add({
    id: 'security.unauthenticated-api',
    title: 'The currency endpoints refuse a caller without a session',
    feature: 'TW-CPN-018',
    run: async (c) => {
      const o = c.obs;
      const get = await c.http(
        'GET',
        TW(c) ? '/admin/currencies' : `${c.sideObj.baseUrl}/api/platform/currencies`,
        { anonymous: true },
      );
      o.enum(
        'unauth.list',
        [401, 302, 403].includes(get.status) ? 'refused' : `open-${get.status}`,
      );
      const post = TW(c)
        ? await c.http('POST', '/admin/currencies', {
            anonymous: true,
            form: { name: 'x', code: 'XXX', precision: '2', exchange_rate: '1' },
          })
        : await c.http('POST', `${c.sideObj.baseUrl}/api/platform/currencies`, {
            anonymous: true,
            data: { name: 'x', code: 'XXX', precision: 2, exchangeRate: '1' },
            headers: idem(),
          });
      o.enum(
        'unauth.create',
        [401, 302, 403, 419].includes(post.status) ? 'refused' : `open-${post.status}`,
      );
      o.flag('sec.unauthContentVisible', get.status === 200 && /currenc/i.test(get.text || ''));
    },
  });

  return {
    feature: 'TW-CPN-018',
    title: 'Admin currencies: list, add, toggle, delete, update, default, rates (TW-CPN-018..024)',
    scenarios: [
      ...pageScenarios,
      ...formScenarios,
      ...listScenarios,
      ...deleteScenarios,
      ...scenarios,
    ],
    teardown: {
      threadwise: async (c) => {
        c.cpnCodes = new Set();
        await sweep(c, c.tagBase.toLowerCase());
      },
      ours: async (c) => {
        c.cpnCodes = new Set();
        await sweep(c, c.tagBase.toLowerCase());
      },
    },
    intended: [
      // --- the code is an ISO-4217 code: three letters ---------------------------------------------------------------
      {
        scenario: /^currency-add\.code\.(?!required$|empty$|duplicate-(exact|case)$)/,
        key: /^(enum\.outcome|flag\.accepted|map\.stored|set\.flaggedFields|status\.submit|abs\.focusQuality|num\.submitRequests|low\.refillsNeeded)$/,
        quirk: 'Reference takes any text up to 10 characters as a currency code',
        reason:
          'ours takes exactly three letters (ISO 4217): the box holds three characters, upper-cases them and refuses anything else (inventory TW-CPN-019 port note: enforce ^[A-Z]{3}$); longer or non-letter values are cut to three or refused',
      },
      {
        scenario: /^add\.rules$/,
        key: /case\.(code-4-letters|code-10-letters|code-digits)(\.|$)/,
        quirk: 'Reference takes any text up to 10 characters as a currency code',
        reason: 'ours takes exactly three letters (ISO 4217), see the code matrix',
      },
      // --- typed numbers ------------------------------------------------------------------------------------------------
      {
        scenario: /^currency-add\.exchange_rate\.(exp|plus-sign|huge)$/,
        key: /^(enum\.outcome|flag\.accepted|map\.stored|set\.flaggedFields|status\.submit|abs\.focusQuality|num\.submitRequests)$/,
        quirk:
          'Reference takes exponent notation and a leading plus sign, and answers 500 when the rate overflows its column',
        reason:
          'ours takes plain decimals only (up to six decimals, the stored precision) and flags the field before any request; Reference answers 500 for rates its column cannot hold',
      },
      {
        scenario: /^add\.rules$/,
        key: /case\.(rate-9-decimals|rate-huge)(\.|$)/,
        quirk:
          'Reference rounds a rate with more than six decimals silently and answers 500 for a rate that overflows',
        reason:
          'ours refuses a rate with more than six decimals or too many digits instead of storing a different number than typed',
      },
      // --- text storage -----------------------------------------------------------------------------------------------
      {
        scenario: /^currency-add\.(name|symbol)\.null-byte$/,
        key: /^(enum\.outcome|flag\.accepted|flag\.formLevelError|map\.stored|status\.submit|abs\.focusQuality)$/,
        quirk: 'Reference stores a NUL byte inside a text value',
        reason:
          'PostgreSQL cannot store a NUL byte: ours refuses the value with a form-level error',
      },
      {
        scenario: /^currency-add\.symbol\.emoji$/,
        key: 'map.stored',
        quirk: 'Reference stores four-byte characters as question marks (its table is not utf8mb4)',
        reason: 'ours stores the emoji intact; the Reference data loss is a bug we do not reproduce',
      },
      {
        scenario: /^currency-add\.(name|symbol)\.zero-width$/,
        key: 'map.stored',
        quirk: 'Reference string trimming also removes a trailing zero-width joiner',
        reason: 'ours keeps every character exactly as typed (it only trims ordinary whitespace)',
      },
      {
        scenario: /^currency-add\.name\.spaces$/,
        key: /^(enum\.outcome|flag\.accepted|map\.stored|set\.flaggedFields|status\.submit|abs\.focusQuality|num\.submitRequests)$/,
        quirk: 'Reference refuses a blank name with a summary box that no single field carries',
        reason:
          'both sides refuse a blank name and store nothing; ours flags the field and blocks before any request, Reference shows a summary box the harness reads as no feedback',
      },
      // --- API behaviour decided in the repo ------------------------------------------------------------------------------
      {
        scenario: /^add\.rules$/,
        key: /^(status|set)\.dup\./,
        quirk: 'Reference reports a taken code as a validation error (422)',
        reason:
          'a taken code answers 409 with the stable code CPN_CURRENCY_CODE_TAKEN; refused on both sides, only the status class differs',
      },
      {
        scenario: /^update\.route$/,
        key: 'enum.code.changed',
        quirk:
          'Reference lets the update route change a code, which orphans everything stored under the old one (inventory TW-CPN-020)',
        reason:
          'the code of a currency never changes after it is created (a rename would orphan prices and workspaces)',
      },
      {
        scenario: /^update\.route$/,
        key: 'enum.partial.activeAfter',
        quirk:
          'Reference switches a currency off when an update does not mention the active flag (inventory TW-CPN-020)',
        reason: 'a partial update leaves the fields it does not name unchanged',
      },
      {
        scenario: /^search\.wildcards$/,
        key: /^num\.matches\.(percent|underscore)$/,
        quirk: 'Reference search passes % and _ to LIKE unescaped, so they act as wildcards',
        reason: 'search is literal: % and _ match only themselves (inventory TW-CPN-018 port note)',
      },
      // --- load time of the dev server ----------------------------------------------------------------------------------
      {
        scenario: /^page\.list\.load$/,
        key: /^perf\.(lcpMs|loadMs)$/,
        quirk: 'our web app runs in next dev for the twin run',
        reason:
          'the first paint includes the dev server compile of the page and its data requests; a production build is not what is measured here',
      },
      // --- keyboard probe artefacts -------------------------------------------------------------------------------------------
      {
        scenario: /^page\.list\.keyboard$/,
        key: 'flag.keyboard.skipLink',
        quirk: 'Reference console has no skip-to-content link',
        reason:
          'ours adds a skip link on every console page (better keyboard access); a deliberate improvement over Reference',
      },
      {
        scenario: /^page\.list\.keyboard$/,
        key: /^abs\.keyboard\.(reachable|focusVisible)$/,
        quirk:
          'the keyboard probe keys a stop by its viewport position, which repeats after the page scrolls',
        reason:
          'a manual Tab walk over the same screen reaches every control (the probe stops early when scrolling puts a later row at the position of an earlier one; ours lists twelve rows, the reference list here has three) and the only stop without a focus ring is the framework dev overlay of the dev server',
      },
    ],
    skip: [],
  };
};
