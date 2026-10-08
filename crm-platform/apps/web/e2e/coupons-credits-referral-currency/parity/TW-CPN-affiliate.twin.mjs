// Twin spec for the referral / affiliate programme (TW-CPN-029..033, 035..037): the code a user gets, the share link, the
// "?ref=" capture and the registration paths, attribution, the Account affiliate tab and the Affiliate history dashboard
// (KPIs, volume chart, search, range, buckets, paging) and the CSV export, on the running Reference and on our app.
//
// Seeded by NORMAL USE on both sides: a referrer registers (Reference: the registration form, workspace step and "start free";
// ours: sign-up + onboarding), then referees register with the referrer's code (Reference: the real registration route with the
// ?ref= cookie or the form field; ours: the sign-up API / form, then the worker consumers attribute the referral).
//
// Not run live, with the reason:
//  - The reward on a referee's first paid order (TW-CPN-033) needs a paid order; a parity run makes no real payment and neither
//    side has a sandbox gateway here. Our consumer, its lock and the wallet credit are covered by the API e2e suite
//    (referral-affiliate.e2e.spec.ts, 39 tests) and the reward on Reference is compared from the inventory only.
//  - The affiliate reward setting (TW-CPN-034) lives in the wallet console (WALLET owns it).
//
// Run: export PARITY_WEB_URL=http://localhost:3400 PARITY_API_URL=http://localhost:3300 PARITY_CONFIG=<json>
//   (the worker must run for our attribution: pnpm --filter @crm/api start:worker with the scratch .env)
//   parity.sh run apps/web/e2e/coupons-credits-referral-currency/parity/TW-CPN-affiliate.twin.mjs --depth full --workers 1
//
// Test data: every user this run creates has a name and an e-mail that start with the run tag. Cleanup removes exactly those:
// Reference through its admin user routes (trash, then force delete) and its admin workspace trash (the trashed workspace row of
// the tagged referrer is purged by name because the app has no screen for that); ours by deleting the tagged organisations
// in the scratch database (the repo has no delete-organisation route).
import { readFileSync } from 'node:fs';
import { TW, cls, q, lines, mysql, psql, idem, sleep, uuid } from './cpn-shared.mjs';

const PASS = 'Str0ng!Passw0rd#2030';

export default (h) => {
  const depth = h.cfg.depth || 'full';

  // ---------------------------------------------------------------------------------------------------------------
  // data access
  // ---------------------------------------------------------------------------------------------------------------
  const userId = (c, email) =>
    TW(c)
      ? mysql(`select id from users where email = '${q(email)}' limit 1`)
      : psql(`select id from users where email = '${q(email)}' limit 1`);
  const codeOf = (c, email) =>
    TW(c)
      ? mysql(`select ifnull(referral_code,'') from users where email = '${q(email)}' limit 1`)
      : psql(
          `select coalesce((select code from referral_codes rc where rc.user_id = u.id limit 1),'') from users u where u.email = '${q(email)}' limit 1`,
        );
  const referralOf = (c, refereeEmail) => {
    const r = TW(c)
      ? mysql(
          `select concat_ws('|', r.code_used, r.credits_awarded, ru.email) from referrals r join users ru on ru.id = r.referred_user_id where ru.email = '${q(refereeEmail)}' limit 1`,
        )
      : psql(
          `select concat_ws('|', r.code_used, r.credits_awarded, ru.email) from referrals r join users ru on ru.id = r.referred_user_id where ru.email = '${q(refereeEmail)}' limit 1`,
        );
    if (!r) return null;
    const [code, credits] = r.split('|');
    return { code, credits: Number(credits) };
  };
  const referralCount = (c, referrerEmail) =>
    Number(
      TW(c)
        ? mysql(
            `select count(*) from referrals r join users u on u.id = r.referrer_user_id where u.email = '${q(referrerEmail)}'`,
          )
        : psql(
            `select count(*) from referrals r join users u on u.id = r.referrer_user_id where u.email = '${q(referrerEmail)}'`,
          ),
    );
  /** Ours attributes through the worker: wait for the row (or its absence) to settle. */
  async function settleReferral(c, email, want = true, ms = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const r = referralOf(c, email);
      if (!!r === want) return r;
      await sleep(400);
    }
    return referralOf(c, email);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // registering users on each side (normal use)
  // ---------------------------------------------------------------------------------------------------------------
  const ip = () =>
    `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  /** Registers a user through the side's own registration route. o: name, email, ref (field), cookieRef (arrive with ?ref=) */
  async function register(c, o) {
    const email = o.email;
    if (TW(c)) {
      const g = await c.openAlso({ loggedIn: false });
      if (o.cookieRef != null)
        await g.request.get(c.url(`/register?ref=${encodeURIComponent(o.cookieRef)}`));
      else await g.request.get(c.url('/register'));
      const tok = (await (await g.request.get(c.url('/csrf-token'))).json()).token;
      const form = {
        _token: tok,
        name: o.name,
        email,
        mobile: `9${c.digits(9)}`,
        country_code: '+91',
        password: PASS,
        password_confirmation: PASS,
        agree: '1',
      };
      if (o.ref != null) form.ref = o.ref;
      const r = await g.request.post(c.url('/register'), {
        form,
        headers: { 'X-CSRF-TOKEN': tok },
        maxRedirects: 0,
        failOnStatusCode: false,
      });
      const ok = r.status() === 302 && /register\/workspace/.test(r.headers().location || '');
      return { ok, status: ok ? 201 : 422, g, location: r.headers().location };
    }
    const r = await c.http('POST', '/v2/auth/signup', {
      anonymous: true,
      data: {
        orgName: o.name,
        fullName: o.name,
        email,
        password: PASS,
        acceptTerms: true,
        ...(o.ref != null ? { referralCode: o.ref } : {}),
      },
      headers: { ...idem(), 'x-forwarded-for': ip() },
    });
    return { ok: r.status === 201 || r.status === 200, status: r.status, body: r.body };
  }
  const emailOf = (c, label) => `${c.tag(label)}@example.com`;

  /** The referrer of the run, with a workspace so every customer screen opens. Built once per side. */
  const fixtures = {};
  const locks = {};
  const attempts = {};
  function getFixture(c) {
    const key = c.side;
    locks[key] ??= Promise.resolve();
    const run = locks[key].then(async () => {
      if (fixtures[key]) return fixtures[key];
      attempts[key] = (attempts[key] || 0) + 1; // a half-built referrer of an earlier attempt stays (the teardown removes it by tag)
      const sfx = attempts[key] > 1 ? attempts[key] : '';
      const email = `${c.tagBase}-ref-a${sfx}@example.com`;
      const name = `${c.tagBase}-ref-a${sfx}`;
      const reg = await register(c, { name, email });
      if (!reg.ok)
        throw new Error(
          `referrer registration failed on ${key}: ${reg.status} ${reg.location ?? ''} ${JSON.stringify(reg.body ?? '').slice(0, 200)}`,
        );
      let orgSlug = null;
      if (TW(c)) {
        const p = reg.g.page;
        p.setDefaultTimeout(90000);
        await p.goto(c.url('/register/workspace'), { waitUntil: 'load' });
        await p.fill('[name=name]', `${c.tagBase}-ws`);
        for (const n of ['industry', 'size_range']) {
          const o = await p
            .locator(`[name=${n}] option`)
            .evaluateAll((os) => os.map((x) => x.value).filter(Boolean));
          await p.selectOption(`[name=${n}]`, o[0]);
        }
        await Promise.all([p.waitForLoadState('load'), p.click('button[type=submit]')]);
        const free = p.getByRole('link', { name: /start free/i }).first();
        await free.waitFor({ state: 'visible' });
        await free.click();
        await p.waitForTimeout(2500);
      } else {
        orgSlug = reg.body?.orgSlug;
        const tok = reg.body?.tokens?.accessToken;
        const auth = { Authorization: `Bearer ${tok}`, ...idem() };
        await c.http('POST', '/v2/onboarding/workspace', {
          data: { name: `${c.tagBase}-ws`, timezone: 'UTC' },
          headers: { ...auth, 'x-forwarded-for': ip() },
        });
        await c.http('POST', '/v2/onboarding/complete', {
          data: {},
          headers: { ...auth, ...idem(), 'x-forwarded-for': ip() },
        });
        await c.http('GET', '/v2/me/referral', {
          headers: { Authorization: `Bearer ${tok}`, 'x-forwarded-for': ip() },
        });
      }
      // ours issues the code through the worker or lazily on first read: wait for it
      const t0 = Date.now();
      while (!codeOf(c, email) && Date.now() - t0 < 15000) await sleep(400);
      const fx = {
        email,
        name,
        orgSlug,
        code: codeOf(c, email),
        id: userId(c, email),
        referees: [],
      };
      fixtures[key] = fx;
      return fx;
    });
    locks[key] = run.catch(() => undefined);
    return run;
  }

  /** Makes the referees the screens show: named, mixed registration paths, one formula-like name. */
  const refereesDone = {};
  async function ensureReferees(c, n = 3) {
    const fx = await getFixture(c);
    const key = c.side;
    refereesDone[key] ??= Promise.resolve();
    const run = refereesDone[key].then(async () => {
      if (fx.referees.length >= n) return fx;
      const specs = [
        { label: 'r1', name: `${c.tagBase}-ref-r1`, how: 'cookie' },
        { label: 'r2', name: `${c.tagBase}-ref-r2`, how: 'field' },
        { label: 'r3', name: `=${c.tagBase}-ref-r3`, how: 'field' },
      ].slice(fx.referees.length, n);
      for (const s of specs) {
        const email = `${c.tagBase}-ref-${s.label}@example.com`;
        const r = await register(c, {
          name: s.name,
          email,
          // the remembered-code (cookie) path of ours lives in the web server and is compared by the UI scenarios below
          ...(s.how === 'cookie' && TW(c) ? { cookieRef: fx.code } : { ref: fx.code }),
        });
        if (!r.ok) throw new Error(`referee ${s.label} registration failed on ${key}: ${r.status}`);
        await settleReferral(c, email, true);
        await sleep(1100); // second-resolution timestamps: keep the newest-first order of the three referees unambiguous
        fx.referees.push({ email, name: s.name, label: s.label });
      }
      return fx;
    });
    refereesDone[key] = run.catch(() => undefined);
    return run;
  }

  async function loginAs(c, user) {
    await c.context.clearCookies();
    c.page.setDefaultTimeout(30000);
    if (TW(c)) {
      await c.sideObj.prepareContext(c.context);
      await c.page.goto(c.url('/login'), { waitUntil: 'load' });
      await c.page.fill('input[name=email]', user.email);
      await c.page.fill('input[name=password]', PASS);
      await Promise.all([
        c.page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }),
        c.page.click('button[type=submit]'),
      ]);
    } else {
      await c.page.goto(c.url('/login'), { waitUntil: 'load' });
      const org = c.page
        .locator('input[name=orgSlug],input[name=org],input[name=workspace]')
        .first();
      if (await org.isVisible().catch(() => false)) await org.fill(user.orgSlug);
      await c.page.locator('input[type=email],input[name=email]').first().fill(user.email);
      await c.page.locator('input[type=password]').first().fill(PASS);
      await Promise.all([
        c.page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }),
        c.page.locator('button[type=submit]').first().click(),
      ]);
    }
    await c.quiet();
  }
  const asReferrer = async (c, n = 0) => {
    const fx = n ? await ensureReferees(c, n) : await getFixture(c);
    await loginAs(c, fx);
    return fx;
  };

  // ---------------------------------------------------------------------------------------------------------------
  // reading the screens
  // ---------------------------------------------------------------------------------------------------------------
  const OVERVIEW = { threadwise: '/account?tab=affiliate', ours: '/account/affiliate' };
  const HISTORY = { threadwise: '/affiliate-history', ours: '/account/affiliate' };
  const overviewReady = { threadwise: 'main h1', ours: 'main h1' };
  const historyReady = { threadwise: '#ah-rows, #ah-range', ours: '#aff-range' };
  const mainText = (c) => c.page.locator('main').innerText();
  const numAfter = (text, label) => {
    const m = text.match(new RegExp(`${label}\\s*\\n\\s*([\\d,.]+)`, 'i'));
    return m ? Number(m[1].replace(/,/g, '')) : null;
  };
  const rowsLoc = (c) =>
    TW(c)
      ? c.page.locator('#ah-rows tr')
      : c.page
          .locator('main table', { has: c.page.locator('th', { hasText: /referee/i }) })
          .locator('tbody tr');
  const rowTexts = async (c, like = '') => {
    const t = await rowsLoc(c).allInnerTexts();
    return t
      .map((x) => x.replace(/\s+/g, ' ').trim())
      .filter((x) => !like || x.toLowerCase().includes(like.toLowerCase()));
  };
  const setRange = async (c, id) => {
    const sel = c.loc({ threadwise: '#ah-range', ours: '#aff-range' }).first();
    const opts = await sel
      .locator('option')
      .evaluateAll((os) => os.map((o) => ({ v: o.value, t: o.textContent.trim() })));
    const pick = opts.find((o) =>
      id === 'all'
        ? /all/i.test(o.t + o.v)
        : id === '7d'
          ? /7/.test(o.t + o.v)
          : id === '30d'
            ? /30/.test(o.t + o.v)
            : /90/.test(o.t + o.v),
    );
    await sel.selectOption(pick.v);
    await c.afterAction({ quiet: 900 });
    return opts.map((o) => o.t.toLowerCase().replace(/\s+/g, ' '));
  };
  const searchFor = async (c, term) => {
    const input = c.loc({ threadwise: '#ah-search', ours: '#aff-search' }).first();
    await input.fill(term);
    // both screens debounce the box and fetch behind it: wait for the table to catch up before reading it
    await c.page.waitForTimeout(3500);
    await c.afterAction({ quiet: 1200 });
  };

  // ---------------------------------------------------------------------------------------------------------------
  // scenarios
  // ---------------------------------------------------------------------------------------------------------------
  const wrap = (scs, n = 0) =>
    scs.map((sc) => ({
      ...sc,
      run: async (c) => {
        await asReferrer(c, n);
        return sc.run(c);
      },
    }));
  const pages = [
    ...wrap(
      h.pageScenarios({
        id: 'page.overview',
        title: 'Account affiliate tab',
        path: OVERVIEW,
        ready: overviewReady,
        probes: ['load', 'a11y', 'keyboard', 'degraded'],
        feature: 'TW-CPN-037',
      }),
      3,
    ),
    ...wrap(
      h.pageScenarios({
        id: 'page.history',
        title: 'Affiliate history',
        path: HISTORY,
        ready: historyReady,
        probes: ['load', 'a11y', 'keyboard', 'degraded'],
        feature: 'TW-CPN-035',
      }),
      3,
    ),
    ...h.pageScenarios({
      id: 'page.overview-anonymous',
      title: 'Affiliate screens without a session',
      path: OVERVIEW,
      ready: 'body',
      probes: ['auth'],
      feature: 'TW-CPN-037',
    }),
    ...h.pageScenarios({
      id: 'page.history-anonymous',
      title: 'Affiliate history without a session',
      path: HISTORY,
      ready: 'body',
      probes: ['auth'],
      feature: 'TW-CPN-035',
    }),
  ];

  const scenarios = [];
  const add = (sc, n = 3) =>
    scenarios.push({
      feature: 'TW-CPN-035',
      ...sc,
      run: async (c) => {
        await asReferrer(c, n);
        return sc.run(c);
      },
    });

  add({
    id: 'responsive.screens',
    title: 'Both affiliate screens at 390, 820 and 1366 px: no horizontal overflow',
    feature: 'TW-CPN-037',
    tags: ['page', 'responsive'],
    run: async (c) => {
      for (const [name, path, ready] of [
        ['overview', OVERVIEW, overviewReady],
        ['history', HISTORY, historyReady],
      ]) {
        for (const vp of [390, 820, 1366]) {
          await c.page.setViewportSize({ width: vp, height: 900 });
          await c.goto(path, { ready });
          c.obs.set(
            `low.overflowX.${name}.${vp}`,
            Math.max(
              0,
              await c.page.evaluate(
                () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
              ),
            ),
          );
        }
      }
      await c.page.setViewportSize({ width: 1366, height: 900 });
    },
  });

  add({
    id: 'overview.code-and-link',
    title:
      "The account tab shows the user's own code (10 characters, A-Z and digits) and a link that ends with ?ref=<code>; the code does not change on reload",
    feature: 'TW-CPN-029',
    run: async (c) => {
      const o = c.obs;
      const fx = await getFixture(c);
      await c.goto(OVERVIEW, { ready: overviewReady });
      const t = await mainText(c);
      o.flag('codeShown', t.includes(fx.code));
      o.flag('linkShown', t.includes(`register?ref=${fx.code}`));
      o.num('code.length', fx.code.length);
      o.flag('code.alphabet', /^[A-Z0-9]+$/.test(fx.code));
      o.flag('code.noLookalikes', !/[01OIL]/.test(fx.code));
      await c.page.reload({ waitUntil: 'load' });
      await c.quiet();
      o.flag(
        'codeStableOnReload',
        (await mainText(c)).includes(fx.code) && codeOf(c, fx.email) === fx.code,
      );
      o.flag('copyControl', await c.visible({ role: 'button', name: /copy/i }));
    },
  });

  add({
    id: 'overview.counters',
    title: 'Signed-up counters, earned and the recent referrals match the three referees',
    feature: 'TW-CPN-037',
    run: async (c) => {
      const o = c.obs;
      const fx = await ensureReferees(c, 3);
      await c.goto(OVERVIEW, { ready: overviewReady });
      const t = await mainText(c);
      if (TW(c)) {
        o.num('signups30d', numAfter(t, 'Sign-ups \\(30d\\)'));
        o.num('signupsTotal', numAfter(t, 'Sign-ups \\(total\\)'));
      } else {
        o.num('signups30d', numAfter(t, 'Referrals, last 30 days'));
        await c.goto(HISTORY, { ready: historyReady });
        await setRange(c, 'all');
        o.num('signupsTotal', numAfter(await mainText(c), 'Referrals in range'));
      }
      const names = await rowTexts(c, '');
      o.num(
        'recent.tagged',
        await (async () => {
          await c.goto(OVERVIEW, { ready: overviewReady });
          return (await c.page.locator('main table tbody tr').allInnerTexts()).filter((x) =>
            x.includes(c.tagBase),
          ).length;
        })(),
      );
      o.num('referees.expected', fx.referees.length);
      void names;
    },
  });

  add({
    id: 'history.kpis-and-rows',
    title:
      'History: lifetime and 30-day counts, earned, average, the rows (referee, code used, status) and the footer',
    feature: 'TW-CPN-035',
    run: async (c) => {
      const o = c.obs;
      const fx = await ensureReferees(c, 3);
      await c.goto(HISTORY, { ready: historyReady });
      if (!TW(c)) await setRange(c, 'all');
      const t = await mainText(c);
      if (TW(c)) {
        o.num(
          'signupsLifetime',
          Number(
            (await c.page.locator('[data-ah=signupsLifetime]').first().innerText()).replace(
              /\D/g,
              '',
            ),
          ),
        );
        o.num(
          'signups30d',
          Number(
            (await c.page.locator('[data-ah=signups30d]').first().innerText()).replace(/\D/g, ''),
          ),
        );
        o.num(
          'totalRows',
          Number(
            (await c.page.locator('[data-ah=totalRows]').first().innerText()).replace(/\D/g, ''),
          ),
        );
      } else {
        o.num('signupsLifetime', numAfter(t, 'Referrals in range'));
        o.num('signups30d', numAfter(t, 'Referrals, last 30 days'));
        o.num('totalRows', await rowsLoc(c).count());
      }
      const rows = await rowTexts(c, c.tagBase);
      o.num('rows.tagged', rows.length);
      o.list(
        'rows.codeUsed',
        rows.map((r) => (r.includes(fx.code) ? 'own-code' : 'other')),
      );
      o.list(
        'rows.status',
        rows.map((r) =>
          /paid|credited/i.test(r) && !/no payout|unpaid/i.test(r) ? 'paid' : 'unpaid',
        ),
      );
      o.flag(
        'rows.newestFirst',
        await (async () => {
          const all = await rowTexts(c, c.tagBase);
          const order = fx.referees.map((x) => x.label).reverse();
          const seen = all
            .map((r) => (/r(\d)/.exec(r) || [])[1])
            .filter(Boolean)
            .map((d) => `r${d}`);
          return JSON.stringify(seen) === JSON.stringify(order);
        })(),
      );
    },
  });

  add({
    id: 'history.search',
    title:
      'Search by referee name, e-mail and code; a miss shows the empty state; KPIs do not move',
    feature: 'TW-CPN-035',
    run: async (c) => {
      const o = c.obs;
      const fx = await ensureReferees(c, 3);
      await c.goto(HISTORY, { ready: historyReady });
      if (!TW(c)) await setRange(c, 'all');
      const kpiBefore = numAfter(
        await mainText(c),
        TW(c) ? 'SIGNUPS \\(LIFETIME\\)[^\\n]*' : 'Referrals in range',
      );
      for (const [id, term] of [
        ['name', `${c.tagBase}-ref-r2`],
        ['email', `${c.tagBase}-ref-r1@example`],
        ['code', fx.code.toLowerCase()],
        ['miss', `zz-${c.digits(8)}`],
        ['percent', '%'],
        ['spaces', '   '],
      ]) {
        await searchFor(c, term);
        const rows = await rowTexts(c);
        o.info(
          `rowsText.${id}`,
          rows.map((r) => r.slice(0, 70)),
        );
        o.info(`mainTail.${id}`, (await mainText(c)).replace(/\s+/g, ' ').slice(-160));
        o.num(`rows.${id}`, rows.filter((x) => x.includes(c.tagBase)).length);
        o.flag(
          `emptyState.${id}`,
          rows.filter((x) => x.includes(c.tagBase)).length === 0 &&
            /(no|nothing|0)/i.test(await mainText(c)),
        );
        await c.shot(`search-${id}`);
      }
      await searchFor(c, '');
      void kpiBefore;
    },
  });

  add({
    id: 'history.range-and-buckets',
    title:
      "Range choices, the 7-day view contains today's referrals, bucket buttons switch the chart",
    feature: 'TW-CPN-035',
    run: async (c) => {
      const o = c.obs;
      await ensureReferees(c, 3);
      await c.goto(HISTORY, { ready: historyReady });
      const opts = await setRange(c, '7d');
      o.num('range.optionCount', opts.length);
      o.num('range7.rows.tagged', (await rowTexts(c, c.tagBase)).length);
      await setRange(c, '30d');
      o.num('range30.rows.tagged', (await rowTexts(c, c.tagBase)).length);
      await setRange(c, '90d');
      const bucketBtn = (name) =>
        c
          .loc({
            threadwise: { role: 'button', name: new RegExp(`^${name}$`, 'i') },
            ours: { role: 'tab', name: new RegExp(`^${name}$`, 'i') },
          })
          .first();
      for (const b of ['Daily', 'Weekly', 'Monthly']) {
        o.flag(
          `bucket.${b}.present`,
          await bucketBtn(b)
            .isVisible()
            .catch(() => false),
        );
        await bucketBtn(b)
          .click()
          .catch(() => {});
        await c.afterAction({ quiet: 700 });
        const mark = await c.page
          .locator('main')
          .evaluate((m) => m.querySelectorAll('canvas, svg').length > 0);
        o.flag(`bucket.${b}.chartDrawn`, mark);
      }
      o.flag('pageStillRenders', await c.visible({ threadwise: '#ah-search', ours: '#aff-search' }));
    },
  });

  add({
    id: 'history.pagination',
    title: 'More than 20 referrals: a first page of twenty and the rest reachable',
    feature: 'TW-CPN-035',
    run: async (c) => {
      const o = c.obs;
      const fx = await ensureReferees(c, 3);
      const have = referralCount(c, fx.email);
      for (let i = have; i < 23; i++) {
        const email = `${c.tagBase}-ref-bulk${i}@example.com`;
        const r = await register(c, { name: `${c.tagBase}-ref-bulk${i}`, email, ref: fx.code });
        if (!r.ok) throw new Error(`bulk referee ${i} failed: ${r.status}`);
        if (!TW(c)) await settleReferral(c, email, true);
      }
      o.num('db.referrals', referralCount(c, fx.email));
      await c.goto(HISTORY, { ready: historyReady });
      if (!TW(c)) await setRange(c, 'all');
      o.num('page1.rows', (await rowTexts(c)).length);
      const next = c
        .loc({ threadwise: '[data-ah-page=next]', ours: { role: 'button', name: /^next$/i } })
        .first();
      o.flag('nextEnabled', await next.isEnabled().catch(() => false));
      await next.click().catch(() => {});
      await c.afterAction({ quiet: 900 });
      o.num('page2.rows', (await rowTexts(c)).length);
    },
  });

  add({
    id: 'export.csv',
    title: 'CSV export: columns, rows (newest first), encoding and spreadsheet-formula safety',
    feature: 'TW-CPN-036',
    run: async (c) => {
      const o = c.obs;
      const fx = await ensureReferees(c, 3);
      await c.goto(HISTORY, { ready: historyReady });
      if (!TW(c)) await setRange(c, '90d');
      const trigger = TW(c)
        ? c.page.locator('#ah-export')
        : c.page.getByRole('button', { name: /export csv/i });
      const [dl] = await Promise.all([
        c.page.waitForEvent('download', { timeout: 20000 }),
        trigger.first().click(),
      ]);
      const path = await dl.path();
      const raw = readFileSync(path);
      const text = raw.toString('utf8');
      const bom = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
      const body = text.replace(/^﻿/, '');
      const rows = body.split(/\r?\n/).filter(Boolean);
      const split = (l) =>
        l
          .match(/("([^"]|"")*"|[^,]*)(,|$)/g)
          ?.map((x) => x.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')) ?? [];
      const head = split(rows[0]).map((x) => x.toLowerCase().replace(/[^a-z]/g, ''));
      o.num('columns', head.length);
      o.flag(
        'hasCodeColumn',
        head.some((x) => /code/.test(x)),
      );
      o.flag(
        'hasCreditsColumn',
        head.some((x) => /credit/.test(x)),
      );
      o.flag(
        'hasWalletTxColumn',
        head.some((x) => /(tx|transaction)/.test(x)),
      );
      const mine = rows.slice(1).filter((l) => l.includes(c.tagBase));
      o.num('rows.tagged', mine.filter((l) => !l.includes('bulk')).length);
      o.flag('bom', bom);
      o.flag('crlf', /\r\n/.test(text));
      const formulaRow = mine.find((l) => l.includes('ref-r3'));
      o.flag('formulaCellNeutralised', !!formulaRow && !/(^|,)"?=/.test(formulaRow));
      o.flag(
        'footerNewestFirst',
        await (async () => {
          const order = mine.map((l) => (/ref-r(\d)/.exec(l) || [])[1]).filter(Boolean);
          return JSON.stringify(order) === JSON.stringify([...order].sort((a, b) => b - a));
        })(),
      );
      o.enum(
        'contentType',
        (await dl.suggestedFilename()).replace(/[0-9]+/g, 'N').replace(/-N/g, ''),
      );
      o.flag(
        'onlyOwnCode',
        mine.every((l) => l.includes(fx.code)),
      );
    },
  });

  add({
    id: 'tenancy.other-user-sees-nothing',
    title: "A referee (a different user) sees none of the referrer's referrals",
    feature: 'TW-CPN-035',
    run: async (c) => {
      const o = c.obs;
      const fx = await ensureReferees(c, 3);
      const r1 = fx.referees[0];
      // log in as the first referee: Reference needs a workspace for the account screens, so read the history page only
      const refereeUser = TW(c) ? { email: r1.email } : { email: r1.email, orgSlug: undefined };
      if (!TW(c))
        refereeUser.orgSlug = psql(
          `select o.slug from organizations o join users u on u.org_id = o.id where u.email = '${q(r1.email)}'`,
        );
      await loginAs(c, refereeUser);
      const resp = await c.page.goto(c.url(HISTORY[c.side]), { waitUntil: 'load' });
      await c.quiet();
      o.flag(
        'ownerRowsVisible',
        (await c.page.locator('body').innerText()).includes(c.tagBase + '-ref-r2'),
      );
      o.status('history.status', cls(resp?.status() ?? 0));
    },
  });

  // --- registration paths ------------------------------------------------------------------------------------------
  const regScenario = (id, title, feature, how) => ({
    id,
    title,
    feature,
    run: async (c) => {
      const o = c.obs;
      const fx = await getFixture(c);
      const email = emailOf(c, id.slice(0, 8));
      const before = referralCount(c, fx.email);
      const spec = how(c, fx);
      const r = await register(c, { name: c.tag('reg'), email, ...spec });
      o.flag('registered', r.ok);
      o.status('register', cls(r.status));
      const ref = await settleReferral(
        c,
        email,
        spec.expectRow ?? true,
        spec.expectRow === false ? 4000 : 15000,
      );
      o.flag('attributed', !!ref);
      o.flag('codeUsedIsReferrerCode', ref?.code === fx.code);
      o.enum(
        'codeUsedShape',
        ref ? (/^[A-Z0-9]+$/.test(ref.code) ? 'upper-alnum' : 'other') : null,
      );
      o.num('referrerDelta', referralCount(c, fx.email) - before);
    },
  });
  const noFixture = (sc) => ({ ...sc, run: sc.run });
  for (const sc of [
    regScenario(
      'reg.valid-code-field',
      "Register with the referrer's code in the form field: one referral, code stored upper-case",
      'TW-CPN-031',
      (c, fx) => ({ ref: fx.code }),
    ),
    regScenario(
      'reg.lowercase-field',
      'A lower-case code in the form field still attributes',
      'TW-CPN-031',
      (c, fx) => ({ ref: fx.code.toLowerCase() }),
    ),
    regScenario(
      'reg.hyphenated-field',
      'A hyphenated code (ABCD-1234 style) in the form field',
      'TW-CPN-031',
      (c, fx) => ({ ref: `${fx.code.slice(0, 5)}-${fx.code.slice(5)}`, expectRow: undefined }),
    ),
    regScenario(
      'reg.unknown-code',
      'An unknown code: registration still succeeds, nothing is attributed',
      'TW-CPN-031',
      () => ({ ref: 'ZZZZZZZZZZ', expectRow: false }),
    ),
    regScenario(
      'reg.too-long-field',
      'A 17-character code in the field is refused or ignored; registration outcome is compared',
      'TW-CPN-031',
      () => ({ ref: 'A'.repeat(17), expectRow: false }),
    ),
    regScenario('reg.symbols', 'A code with symbols is ignored', 'TW-CPN-031', () => ({
      ref: '***',
      expectRow: false,
    })),
    regScenario(
      'reg.no-code',
      'No code at all: registration succeeds with no referral',
      'TW-CPN-031',
      () => ({ expectRow: false }),
    ),
  ])
    scenarios.push({ ...noFixture(sc), run: sc.run });

  /** Registers through the real screen: arrive with ?ref=, fill the form, leave the referral box alone or type into it. */
  async function registerViaUi(c, o) {
    const g = await c.openAlso({ loggedIn: false });
    const p = g.page;
    p.setDefaultTimeout(60000);
    const path = TW(c) ? '/register' : '/signup';
    await p.goto(
      c.url(`${path}${o.arrive != null ? `?ref=${encodeURIComponent(o.arrive)}` : ''}`),
      { waitUntil: 'load' },
    );
    await p.waitForTimeout(1500);
    const refBox = p.locator(TW(c) ? '[name=ref]' : '[name=referralCode]').first();
    const prefilled = await refBox.inputValue().catch(() => '');
    if (TW(c)) {
      await p.fill('[name=name]', o.name);
      await p.fill('[name=email]', o.email);
      await p.fill('[name=mobile]', `9${c.digits(9)}`);
      if (o.typed != null) await refBox.fill(o.typed);
      await p.fill('[name=password]', PASS);
      await p.fill('[name=password_confirmation]', PASS);
      await p.check('[name=agree]');
    } else {
      // our consent banner sits over the bottom of the form: decline the optional cookies first (the privacy-preserving choice)
      const decline = p.getByRole('button', { name: /^decline$/i }).first();
      if (await decline.isVisible().catch(() => false)) await decline.click();
      await p.fill('[name=fullName]', o.name);
      await p.fill('[name=email]', o.email);
      await p.fill('[name=orgName]', o.name);
      await p.fill('[name=phone]', `9${c.digits(9)}`);
      if (o.typed != null) await refBox.fill(o.typed);
      await p.fill('[name=password]', PASS);
      await p.fill('[name=confirmPassword]', PASS);
      await p.check('[name=acceptTerms]');
    }
    await Promise.all([
      p.waitForLoadState('load').catch(() => {}),
      p.locator('button[type=submit]').first().click(),
    ]);
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      const u = new URL(p.url()).pathname;
      if (!/^\/(register|signup)$/.test(u)) break;
      await p.waitForTimeout(500);
    }
    const left = !/^\/(register|signup)$/.test(new URL(p.url()).pathname);
    return { left, prefilled, url: p.url() };
  }
  const uiScenario = (id, title, feature, how) => ({
    id,
    title,
    feature,
    run: async (c) => {
      const o = c.obs;
      const fx = await getFixture(c);
      const email = emailOf(c, id.slice(4, 12));
      const before = referralCount(c, fx.email);
      const spec = how(fx);
      const r = await registerViaUi(c, { name: c.tag('ui'), email, ...spec });
      o.flag('registered', r.left);
      o.enum(
        'refBoxPrefill',
        r.prefilled === ''
          ? 'empty'
          : r.prefilled.toUpperCase().replace(/-/g, '') === fx.code
            ? 'the-code'
            : 'other',
      );
      const ref = await settleReferral(
        c,
        email,
        spec.expectRow ?? true,
        spec.expectRow === false ? 4000 : 15000,
      );
      o.flag('attributed', !!ref);
      o.flag('codeUsedIsReferrerCode', ref?.code === fx.code);
      o.num('referrerDelta', referralCount(c, fx.email) - before);
    },
  });
  for (const sc of [
    uiScenario(
      'reg.ui-cookie-code',
      'Arrive with ?ref=<code>, leave the referral box alone, register: attributed',
      'TW-CPN-030',
      (fx) => ({ arrive: fx.code }),
    ),
    uiScenario(
      'reg.ui-cookie-lower-hyphen',
      'Arrive with a lower-case hyphenated ?ref=: still attributed (normalised)',
      'TW-CPN-030',
      (fx) => ({ arrive: `${fx.code.slice(0, 5)}-${fx.code.slice(5)}`.toLowerCase() }),
    ),
    uiScenario(
      'reg.ui-typed-code',
      'No ?ref=, the code typed into the referral box: attributed',
      'TW-CPN-031',
      (fx) => ({ typed: fx.code }),
    ),
    uiScenario(
      'reg.ui-typed-hyphenated',
      'The code typed with a hyphen into the box: attributed or refused',
      'TW-CPN-031',
      (fx) => ({ typed: `${fx.code.slice(0, 5)}-${fx.code.slice(5)}`, expectRow: undefined }),
    ),
    uiScenario(
      'reg.ui-typed-symbols',
      'Symbols typed into the box: registration outcome',
      'TW-CPN-031',
      () => ({ typed: '***', expectRow: false }),
    ),
    uiScenario(
      'reg.ui-unknown-arrival',
      'Arrive with an unknown ?ref=: registration works, nothing attributed',
      'TW-CPN-031',
      () => ({ arrive: 'ZZZZZZZZZZ', expectRow: false }),
    ),
    uiScenario(
      'reg.ui-box-beats-arrival',
      'A code typed in the box wins over the remembered one',
      'TW-CPN-031',
      (fx) => ({ arrive: 'ZZZZZZZZZZ', typed: fx.code }),
    ),
  ])
    scenarios.push({ ...sc });

  add(
    {
      id: 'reg.ref-field-structure',
      title:
        'The registration screen carries an optional referral field (max 16) filled from ?ref=',
      feature: 'TW-CPN-030',
      run: async (c) => {
        const o = c.obs;
        const fx = await getFixture(c);
        const g = await c.openAlso({ loggedIn: false });
        const path = TW(c) ? '/register' : '/signup';
        const code = fx.code.toLowerCase();
        await g.page.goto(c.url(`${path}?ref=${code}`), { waitUntil: 'load' });
        await g.page.waitForTimeout(1500);
        const field = g.page.locator(TW(c) ? '[name=ref]' : '[name=referralCode]').first();
        o.flag('field.present', await field.count().then((n) => n > 0));
        o.num('field.maxlength', await field.evaluate((e) => e.maxLength).catch(() => -1));
        o.enum(
          'field.prefill',
          (await field.inputValue().catch(() => '')).toUpperCase() === fx.code
            ? 'code'
            : (await field.inputValue().catch(() => '')) === ''
              ? 'empty'
              : 'other',
        );
        const cookies = await g.context.cookies();
        const ck = cookies.find((x) => /ref/i.test(x.name));
        o.flag('cookie.set', !!ck);
        o.flag('cookie.httpOnly', !!ck?.httpOnly);
        o.enum('cookie.sameSite', ck?.sameSite ?? null);
        o.flag(
          'cookie.thirtyDays',
          !!ck &&
            ck.expires > 0 &&
            Math.abs(ck.expires - (Date.now() / 1000 + 30 * 86400)) < 2 * 86400,
        );
        // a 17-character value sets no cookie
        await g.context.clearCookies();
        await g.page.goto(c.url(`${path}?ref=${'a'.repeat(17)}`), { waitUntil: 'load' });
        o.flag('cookie.noneForLong', !(await g.context.cookies()).some((x) => /ref/i.test(x.name)));
        await g.context.clearCookies();
        await g.page.goto(c.url(`${path}?ref=***`), { waitUntil: 'load' });
        o.flag(
          'cookie.noneForSymbols',
          !(await g.context.cookies()).some((x) => /ref/i.test(x.name)),
        );
      },
    },
    0,
  );

  add(
    {
      id: 'access.customer-cannot-open-admin',
      title:
        'A signed-in customer opening the operator coupon and currency screens and APIs is refused',
      feature: 'TW-CPN-001',
      run: async (c) => {
        const o = c.obs;
        const resp = await c.page.goto(c.url('/admin/coupons'), { waitUntil: 'load' });
        await c.quiet();
        o.status('screen.coupons', cls(resp?.status() ?? 0));
        const landed = new URL(c.page.url()).pathname;
        o.flag(
          'screen.showsCoupons',
          await c.page
            .locator('main')
            .innerText()
            .then((t) => /discount coupons|new coupon/i.test(t))
            .catch(() => false),
        );
        o.enum(
          'screen.landing',
          /login/.test(landed) ? 'login' : landed.startsWith('/admin') ? 'admin' : 'elsewhere',
        );
        const api = TW(c)
          ? await c.http('GET', '/admin/currencies')
          : await c.http('GET', `${c.sideObj.baseUrl}/api/platform/currencies`);
        o.status('api.currencies', cls(api.status));
        o.flag('sec.unauthContentVisible', api.status === 200 && /currenc/i.test(api.text || ''));
      },
    },
    0,
  );

  return {
    feature: 'TW-CPN-035',
    title:
      'Referral and affiliate: code, link, registration paths, account tab, history, export (TW-CPN-029..037)',
    scenarios: [...pages, ...scenarios],
    teardown: {
      threadwise: async (c) => {
        const ids = lines(mysql(`select id from users where email like '${q(c.tagBase)}%'`));
        const tok = async () => (await (await c.request.get(c.url('/csrf-token'))).json()).token;
        for (const id of ids) {
          for (const path of [`/admin/users/${id}`, `/admin/users/${id}/force`])
            await c.request
              .fetch(c.url(path), {
                method: 'DELETE',
                headers: {
                  'X-CSRF-TOKEN': await tok(),
                  'X-Requested-With': 'XMLHttpRequest',
                  Accept: 'application/json',
                },
                failOnStatusCode: false,
                maxRedirects: 0,
              })
              .catch(() => undefined);
        }
        for (const id of lines(
          mysql(
            `select id from workspaces where name like '${q(c.tagBase)}%' and deleted_at is null`,
          ),
        ))
          await c.request
            .fetch(c.url(`/admin/workspaces/${id}`), {
              method: 'DELETE',
              headers: {
                'X-CSRF-TOKEN': await tok(),
                'X-Requested-With': 'XMLHttpRequest',
                Accept: 'application/json',
              },
              failOnStatusCode: false,
              maxRedirects: 0,
            })
            .catch(() => undefined);
        // the trashed workspace of the tagged referrer and its membership row: no screen purges them
        mysql(
          `delete from workspace_user where workspace_id in (select id from workspaces where name like '${q(c.tagBase)}%')`,
        );
        mysql(
          `delete from workspaces where name like '${q(c.tagBase)}%' and deleted_at is not null`,
        );
      },
      ours: async (c) => {
        const like = q(c.tagBase.toLowerCase());
        psql(`DO $$
DECLARE r record; ids bigint[]; p int;
BEGIN
  PERFORM set_config('app.privileged','on',true);
  SELECT array_agg(id) INTO ids FROM organizations WHERE lower(name) LIKE '%${like}%';
  IF ids IS NULL THEN RETURN; END IF;
  FOR p IN 1..8 LOOP
    FOR r IN SELECT DISTINCT c.conrelid::regclass::text AS tbl, a.attname AS col
             FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
             WHERE c.confrelid='organizations'::regclass AND c.contype='f' AND array_length(c.conkey,1)=1 LOOP
      BEGIN
        EXECUTE format('DELETE FROM %s WHERE %I = ANY($1)', r.tbl, r.col) USING ids;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END LOOP;
  END LOOP;
  DELETE FROM organizations WHERE id = ANY(ids);
END $$`);
      },
    },
    intended: [
      {
        scenario: /^access\.customer-cannot-open-admin$/,
        key: /^(enum\.screen\.landing|status\.screen\.coupons|status\.api\.currencies)$/,
        quirk: 'Reference has one sign-in for customers and admins and answers a customer with 403',
        reason:
          'our operator console is a separate sign-in (platform operators): a customer session is simply not an operator session, so the screen shows the operator sign-in and the API answers 401; no console data is returned either way',
      },
      {
        scenario: /^export\.csv$/,
        key: /^flag\.(bom|crlf|formulaCellNeutralised)$/,
        quirk:
          'Reference writes the export without a byte-order mark and does not neutralise cells that start with = + - @',
        reason:
          'ours writes UTF-8 with a BOM and CRLF line ends so spreadsheets open it correctly, and prefixes cells that would run as a formula (CSV injection) with a quote',
      },
      {
        scenario: /^reg\.(hyphenated-field|symbols)$/,
        key: /^(flag\.registered|status\.register)$/,
        quirk: 'Reference ignores a malformed referral value at sign-up and registers the user',
        reason:
          'the sign-up API only accepts 1 to 16 letters and digits for referralCode; the web server normalises the ?ref= cookie and the box before it calls the API, so the screen behaves like Reference (reg.ui-* scenarios are the same) and only a direct API call with a malformed value is refused with a 422',
      },
      {
        scenario: /^reg\.ui-(cookie-lower-hyphen|typed-hyphenated)$/,
        key: /^(flag\.attributed|flag\.codeUsedIsReferrerCode|num\.referrerDelta)$/,
        quirk:
          'Reference does not re-clean the referral value of the registration box (inventory TW-CPN-031 rule 2): a hyphenated or lower-case code typed or arriving through the link is searched as written and finds no referrer',
        reason:
          'ours cleans the code wherever it arrives (case and hyphens ignored), so a visitor who brings a hyphenated code is attributed; Reference registers the user but loses the referral',
      },
      {
        scenario: /^page\.(overview|history)\.keyboard$/,
        key: /^abs\.keyboard\.(reachable|focusVisible)$/,
        quirk: 'the keyboard probe counts every enabled control as a Tab stop',
        reason:
          'the Daily/Weekly/Monthly tab strip follows the ARIA roving-tabindex pattern (one Tab stop, arrow keys inside), so its other two tabs are not Tab stops by design; the only stop without a focus ring is the framework dev overlay of the dev server',
      },
    ],
    skip: [],
  };
};
