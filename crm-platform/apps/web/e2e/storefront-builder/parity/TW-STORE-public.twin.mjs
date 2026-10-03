// Twin spec for the STORE PUBLIC SHOP (TW-STORE-009..017, 020, 021, 026, 027, 031): the buyer-facing shop at /s/{slug} on Reference and on
// ours: home (all eight themes), product page, cart drawer, checkout form, coupon quote, order tracking, review form, abandoned-cart
// beacon, unknown/disabled shop, search/filter/sort/show-more, keyboard, responsive, a11y, failure states, double submit, XSS.
//
// Fixture: apps/web/e2e/storefront-builder/public/seed-both.mjs seeds the same shops on both sides (ours: org `pubshop-e2e` in
// crm_store; reference: workspaces 9001-9003, product ids 910001+, orders 9100+). Seed before, clean after:
//   node apps/web/e2e/storefront-builder/public/seed-both.mjs seed both      ...      node .../seed-both.mjs clean both
// Run (public pages need no login on either side; our access token is not used, so a run may exceed 15 minutes, but keep segments short):
//   PARITY_WEB_URL=http://localhost:3109 PARITY_API_URL=http://localhost:53109 parity.sh run <this spec> --depth full --workers 1 --only '<segment regex>'
// Segments used (scenario id prefixes): pages. | struct. | cart. | list. | misc. | coupon. | co. | review. | kbd. | fail. | xss.
// Checkout, coupon and review are rate limited per address on both sides (20 / 30 / 10 a minute): the scenarios that post clear the
// reference cache rows of the limiter and our Redis counters first, so run them with --workers 1.
// Checkout places real orders in the tagged fixture workspace; seed-both `clean` removes them (and the reference rows tagged 9001-9003).
import { execFileSync } from 'node:child_process';

export default (h) => {
  const listMode = process.argv.includes('--list');
  const ORG = 'pubshop-e2e';
  const REF_WS = 9001;
  const REF_DB = [
    'exec',
    'threadwise-db',
    'mariadb',
    '-uthreadwise',
    '-pthreadwise_local_pw',
    'threadwise',
    '-N',
    '-B',
    '-r',
    '-e',
  ];
  const OURS_DB = [
    'exec',
    'crm-postgres',
    'psql',
    '-U',
    'crm',
    '-d',
    process.env.STORE_DB || 'crm_store',
    '-tAc',
  ];
  const mysql = (sql) =>
    execFileSync('docker', [...REF_DB, sql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  const psql = (sql) => execFileSync('docker', [...OURS_DB, sql], { encoding: 'utf8' }).trim();
  const jsonOf = (s) => {
    try {
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  };
  const orgSql = `(select id from organizations where slug = '${ORG}')`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------------------------------------------------------------------
  // limiter reset, order readback, review readback, recovery readback
  // ------------------------------------------------------------------------------------------------------------------
  const resetThrottle = (c) => {
    try {
      if (c.side === 'threadwise')
        mysql(
          "delete from cache where `key` regexp '^laravel-cache-[0-9a-f]{32}(:timer)?$' or `key` like '%throttle%'",
        );
      else
        execFileSync(
          'docker',
          [
            'exec',
            'crm-redis',
            'redis-cli',
            'eval',
            "for _,k in ipairs(redis.call('keys','store_rl:*')) do redis.call('del',k) end return 0",
            '0',
          ],
          { stdio: 'ignore' },
        );
    } catch {
      /* the limiter stays as it was; a 429 then shows up as a finding of this scenario */
    }
  };
  const maxOrder = (c) =>
    Number(
      c.side === 'threadwise'
        ? mysql(`select ifnull(max(id),0) from wa_orders where workspace_id=${REF_WS}`)
        : psql(
            `select coalesce(max(extract(epoch from created_at)*1000000),0)::bigint from wa_orders where org_id=${orgSql}`,
          ),
    );
  const ordersAfter = (c, id) => {
    const rows =
      c.side === 'threadwise'
        ? mysql(
            `select json_object('name',customer_name,'phone',customer_phone,'address',customer_address,'notes',notes,'total',total_minor,'shipping',shipping_minor,'discount',discount_minor,'coupon',coupon_code,'pay',payment_method,'status',status,'cur',currency_code,'source',source,'items',items_json,'rto',rto_band) from wa_orders where workspace_id=${REF_WS} and id > ${id} order by id`,
          )
        : psql(
            `select row_to_json(t) from (select customer_name as name, customer_phone as phone, customer_address as address, notes, total_minor as total, shipping_minor as shipping, discount_minor as discount, coupon_code as coupon, payment_method as pay, status, currency_code as cur, source, items_json as items, rto_band as rto from wa_orders where org_id=${orgSql} and extract(epoch from created_at)*1000000 > ${id} order by created_at) t`,
          );
    return rows
      .split('\n')
      .filter(Boolean)
      .map(jsonOf)
      .filter(Boolean)
      .map((r) => {
        const items = typeof r.items === 'string' ? jsonOf(r.items) : r.items;
        return {
          name: r.name,
          phone: r.phone,
          address: r.address,
          notes: r.notes,
          total: Number(r.total),
          shipping: Number(r.shipping),
          discount: Number(r.discount),
          coupon: r.coupon,
          pay: r.pay,
          status: r.status,
          cur: r.cur,
          source: r.source,
          rto: r.rto,
          items: (items || []).map((i) => `${i.name}|${i.qty}|${i.price_minor ?? i.price}`),
        };
      });
  };
  const reviewsAfter = (c, id) => {
    const rows =
      c.side === 'threadwise'
        ? mysql(
            `select json_object('name',customer_name,'rating',rating,'body',body,'status',status,'product',product_id) from wa_product_reviews where workspace_id=${REF_WS} and id > ${id} order by id`,
          )
        : psql(
            `select row_to_json(t) from (select customer_name as name, rating, body, status, product_id as product from wa_product_reviews where org_id=${orgSql} and id > ${id} order by id) t`,
          );
    return rows
      .split('\n')
      .filter(Boolean)
      .map(jsonOf)
      .filter(Boolean)
      .map((r) => ({ ...r, product: Number(r.product) % 1000000 }));
  };
  const maxReview = (c) =>
    Number(
      c.side === 'threadwise'
        ? mysql(`select ifnull(max(id),0) from wa_product_reviews where workspace_id=${REF_WS}`)
        : psql(`select coalesce(max(id),0) from wa_product_reviews where org_id=${orgSql}`),
    );
  const recoveriesCount = (c) =>
    Number(
      c.side === 'threadwise'
        ? mysql(`select count(*) from storefront_cart_recoveries where workspace_id=${REF_WS}`)
        : psql(`select count(*) from storefront_cart_recoveries where org_id=${orgSql}`),
    );

  // ------------------------------------------------------------------------------------------------------------------
  // browser helpers
  // ------------------------------------------------------------------------------------------------------------------
  const consent = (c) => ({
    name: 'crm_cookie_consent',
    value: encodeURIComponent(
      JSON.stringify({
        necessary: true,
        analytics: false,
        marketing: false,
        ts: Math.floor(Date.now() / 1000),
      }),
    ),
    url: c.sideObj.origin(),
  });
  /** Both sides start with the cookie question answered (Reference: the harness sets its cookie; ours: the staff app's banner). */
  const prepContext = async (c, ctx) => {
    if (c.side === 'ours') await ctx.addCookies([consent(c)]);
    await ctx.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = 'nextjs-portal{display:none!important}';
        document.head.appendChild(s);
      });
    });
  };
  /** Public scenarios: no login; consent answered; extra contexts too. */
  const wrap = (sc, { calm = false, hideSr = false } = {}) => ({
    ...sc,
    loggedIn: false,
    needsUi: true,
    dialogPolicy: 'dismiss',
    run: async (c) => {
      await prepContext(c, c.context);
      const orig = c.openAlso.bind(c);
      c.openAlso = async (o) => {
        const hd = await orig({ ...o, loggedIn: false });
        await prepContext(c, hd.context);
        return hd;
      };
      if (hideSr)
        await c.context.addInitScript(() => {
          document.addEventListener('DOMContentLoaded', () => {
            const st = document.createElement('style');
            st.textContent = '.sf-sr,.sf-skip{display:none!important}';
            document.head.appendChild(st);
          });
        });
      if (calm)
        await c.context.addInitScript(() => {
          document.addEventListener('DOMContentLoaded', () => {
            const s = document.createElement('style');
            s.textContent = '*{transition:none!important;animation:none!important}';
            document.head.appendChild(s);
          });
        });
      return sc.run(c);
    },
  });
  const go = async (c, path, wait = 150) => {
    const resp = await c.page.goto(c.url(path), { waitUntil: 'load' });
    await c.page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
    await sleep(wait);
    return resp;
  };
  const T = (c) => {
    const page = c.page;
    return {
      modal: async () => {
        const m = page.locator('#sf-modal[data-open="1"] [data-modal-card], .sf-modal-card');
        if (!(await m.count())) return null;
        return (await m.first().innerText()).replace(/\s+/g, ' ').trim();
      },
      toast: async () => {
        const m = page.locator('#sf-toast.show, .sf-toast.show');
        if (!(await m.count())) return null;
        return (await m.first().innerText()).trim();
      },
      cartRows: async () =>
        page.locator('.sf-cart-row').evaluateAll((rs) =>
          rs.map((r) => ({
            name: r.querySelector('.sf-cart-name')?.textContent.trim(),
            price: r.querySelector('.sf-cart-price')?.textContent.trim(),
            qty: r.querySelector('.sf-qty input')?.value,
          })),
        ),
      footer: async () => {
        const f = page.locator('.sf-drawer-foot');
        return (await f.count()) ? (await f.first().innerText()).replace(/\s+/g, ' ').trim() : null;
      },
      badge: async () => {
        const b = page.locator(
          'button[aria-label^="Cart"] [data-cart-count], button[aria-label^="Cart"] .sf-badge',
        );
        return (await b.count()) ? (await b.first().innerText()).trim() : '0';
      },
      ls: async () =>
        page.evaluate(() => {
          const o = {};
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k.startsWith('sf_'))
              o[k.replace(/_.*$/, '') + '#' + k.split('_')[1]] = localStorage.getItem(k);
          }
          return o;
        }),
      lsCart: async () =>
        page.evaluate(() => {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k.startsWith('sf_cart_')) return localStorage.getItem(k);
          }
          return null;
        }),
    };
  };
  /** Rendered text of the page without the screen-reader-only additions (class sf-sr exists only on ours, documented). */
  const bodyText = (c) =>
    c.page.evaluate(() => {
      const hidden = [...document.querySelectorAll('.sf-sr, .sf-skip')];
      hidden.forEach((e) => (e.style.display = 'none'));
      const t = document.body.innerText.replace(/\s+/g, ' ').trim();
      hidden.forEach((e) => (e.style.display = ''));
      return t;
    });
  /** Cart storage with the product ids removed (ours are uuids, Reference's are numbers: rule uuid-ids). */
  const stripIds = (raw) => {
    try {
      return JSON.stringify(
        JSON.parse(raw).map(({ id, ...l }) => ({
          ...l,
          image: l.image ? String(l.image).slice(0, 30) : l.image,
        })),
      );
    } catch {
      return raw == null ? null : String(raw).slice(0, 40);
    }
  };
  /** Types into a (number) input like a person: select all, then key presses; characters the field refuses are dropped. */
  const typeInto = async (c, loc, v) => {
    await loc.click();
    await c.page.keyboard.press('Control+A');
    if (v === '') await c.page.keyboard.press('Delete');
    else await c.page.keyboard.type(v);
  };
  const idx = (g) => (g < 6 ? g - 1 : g - 2); // product g -> position on page 1 (product 6 is not listed)
  const addBtn = (c, g) => c.page.locator('button:has-text("Add to cart")').nth(idx(g));
  const cartBtn = (c) => c.page.locator('button[aria-label^="Cart"]').first();
  const openCart = async (c) => {
    await cartBtn(c).click();
    await sleep(350);
  };
  const addProducts = async (c, list) => {
    for (const g of list) {
      await addBtn(c, g).click();
      await sleep(160);
    }
  };
  const xssFlag = async (c, key = 'sec.xssExecuted') => {
    const w = await c.page.evaluate(() => !!window.__xss).catch(() => false);
    const dialogs = c.rec.events.dialogs.length;
    c.obs.set(key, !!w || dialogs > 0);
  };
  /** Records plain values as namespaced observations: booleans as flags, numbers as num, everything else as enum text. */
  const rec = (c, obj, prefix = '') => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix + k;
      if (typeof v === 'boolean') c.obs.flag(key, v);
      else if (typeof v === 'number') c.obs.num(key, v);
      else if (Array.isArray(v))
        c.obs.seq(
          key,
          v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))),
        );
      else if (v && typeof v === 'object') c.obs.enum(key, JSON.stringify(v));
      else c.obs.enum(key, v);
    }
  };
  /** map.stored compares plain objects of primitives: flatten the readback rows. */
  const flat = (rows) => {
    const o = {};
    rows.forEach((r, i) => {
      for (const [k, v] of Object.entries(r)) o[`${i}.${k}`] = Array.isArray(v) ? v.join(';') : v;
    });
    return o;
  };
  const cls = (st) =>
    st == null
      ? 'none'
      : st === 429
        ? 'throttled'
        : st >= 500
          ? 'crash'
          : st >= 400
            ? 'rejected'
            : 'ok';
  const norm = (s) => (s == null ? s : String(s).replace(/\s+/g, ' ').trim());

  // ---- checkout helpers -------------------------------------------------------------------------------------------
  const co = (c) => {
    const p = c.page;
    return {
      name: p.locator('#sf-co-name, .sf-checkout input[autocomplete=name]').first(),
      phone: p.locator('#sf-co-phone, .sf-checkout input[type=tel]').first(),
      addr: p.locator('#sf-co-addr, .sf-checkout textarea').first(),
      note: p
        .locator(
          '#sf-co-note, .sf-checkout .sf-field input:not([type=tel]):not([autocomplete=name]):not(.is-upper)',
        )
        .first(),
      coupon: p.locator('#sf-co-coupon, .sf-checkout input.is-upper').first(),
      couponMsg: p.locator('#sf-co-coupon-msg, .sf-coupon-msg').first(),
      status: p.locator('#sf-co-status, .sf-status-msg').first(),
      place: p.getByRole('button', { name: /Place order/ }),
      apply: p.getByRole('button', { name: 'Apply' }),
    };
  };
  const toCheckout = async (c, { items = [1, 9], slug = 'stp-aurora' } = {}) => {
    await go(c, `/s/${slug}`);
    await addProducts(c, items);
    await openCart(c);
    await c.page.getByRole('button', { name: /Order on WhatsApp/ }).dispatchEvent('click');
    await sleep(450);
    return co(c);
  };
  const stubWa = async (c) => {
    const box = { url: null };
    await c.page.route(/^https:\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\//, (route) => {
      box.url = route.request().url();
      route.fulfill({ status: 200, contentType: 'text/html', body: 'wa' });
    });
    return box;
  };
  /** Watches the page's own calls to the shop's checkout / coupon / review / abandon routes. */
  const watch = (c) => {
    const w = { reqs: [], res: [] };
    c.page.on('request', (r) => {
      const m = r.url().match(/\/s\/[^/]+\/(checkout|coupon|review|abandon)$/);
      if (m && r.method() === 'POST') {
        let body = null;
        try {
          body = JSON.parse(r.postData() || '{}');
        } catch {
          /* not json */
        }
        w.reqs.push({ route: m[1], body });
      }
    });
    c.page.on('response', async (r) => {
      const m = r.url().match(/\/s\/[^/]+\/(checkout|coupon|review|abandon)$/);
      if (m && r.request().method() === 'POST')
        w.res.push({ route: m[1], status: r.status(), json: await r.json().catch(() => null) });
    });
    return w;
  };
  const sk = (b, ...names) => {
    for (const n of names) if (b && b[n] !== undefined) return b[n];
    return undefined;
  };
  const fillCo = async (c, v = {}) => {
    const f = co(c);
    const vals = {
      name: 'Asha Test',
      phone: '+91 98765 43210',
      addr: '12 Test St\nBangalore',
      note: '',
      coupon: '',
      ...v,
    };
    for (const k of ['name', 'phone', 'addr', 'note', 'coupon']) {
      if (vals[k] === null) continue;
      await f[k].fill(String(vals[k]));
    }
    return f;
  };
  /** Click "Place order" and describe what happened, in terms both apps share. */
  const placeAndObserve = async (c, { before, waitMs = 2600, dbl = false } = {}) => {
    const w = watch(c);
    const wa = await stubWa(c);
    const f = co(c);
    const t0 = await maxOrder(c);
    if (dbl) await f.place.dblclick().catch(() => {});
    else await f.place.click();
    await sleep(waitMs);
    const last = w.res.filter((r) => r.route === 'checkout').pop();
    const reqs = w.reqs.filter((r) => r.route === 'checkout');
    const status = await f.status.innerText().catch(() => null);
    const modal = await T(c).modal();
    const stored = ordersAfter(c, before ?? t0);
    const wasPlaced = !!wa.url || /placed/i.test(modal || '');
    const o = c.obs;
    o.flag('requestSent', reqs.length > 0);
    o.num('submitRequests', reqs.length);
    o.num('rowsCreated', stored.length);
    o.enum(
      'outcome',
      last
        ? last.status < 300
          ? 'accepted'
          : 'rejected-server'
        : reqs.length
          ? 'no-response'
          : 'rejected-client',
    );
    if (last) o.enum('statusClass.checkout', cls(last.status));
    o.enum('statusMsg', norm(status));
    o.flag('handoff', wasPlaced);
    o.flag('modalPlaced', /placed/i.test(modal || ''));
    o.enum('waHost', wa.url ? new URL(wa.url).host + new URL(wa.url).pathname : null);
    o.enum(
      'waText',
      wa.url
        ? decodeURIComponent(wa.url.replace(/\+/g, '%20'))
            .replace(/#\d+/g, '#N')
            .replace(/(order\/)[A-Za-z0-9]+/g, '$1TOKEN')
            .replace(/https?:\/\/[^/ ]+/g, 'HOST')
        : null,
    );
    const b = reqs[0]?.body;
    if (b) {
      o.enum('req.name', sk(b, 'name') ?? '');
      o.enum('req.phone', sk(b, 'phone') ?? '');
      o.enum('req.address', sk(b, 'address') ?? '');
      o.enum('req.note', sk(b, 'note') ?? '');
      o.enum('req.coupon', sk(b, 'coupon') ?? '');
      o.enum('req.payment', sk(b, 'payment_method', 'paymentMethod'));
      o.num('req.items', (b.items || []).length);
    }
    o.enum('rto', stored.map((r) => r.rto ?? '').join(','));
    o.set('map.stored', flat(stored.map(({ rto, ...r }) => r)));
    o.flag('cartCleared', (await T(c).lsCart()) === null || (await T(c).lsCart()) === '[]');
    const token =
      (wa.url ? decodeURIComponent(wa.url).match(/order\/([A-Za-z0-9]+)/)?.[1] : null) ||
      last?.json?.track_url?.match?.(/order\/([A-Za-z0-9]+)/)?.[1];
    await xssFlag(c);
    return { w, wa, token, stored, last };
  };
  const openTracking = async (c, token, slug = 'stp-aurora') => {
    if (!token) return;
    await go(c, `/s/${slug}/order/${token}`);
    await xssFlag(c, 'sec.xssExecutedTracking');
  };

  // ------------------------------------------------------------------------------------------------------------------
  // scenario list
  // ------------------------------------------------------------------------------------------------------------------
  const FEATURE = 'TW-STORE-009';
  const THEMES = ['aurora', 'meridian', 'verdure', 'bazaar', 'noir', 'kraft', 'mercato', 'studio'];
  const DEEP = ['aurora', 'noir', 'bazaar'];
  const TOKENS = {
    new: 'stptoken00',
    confirmed: 'stptoken01',
    paid: 'stptoken02',
    shipped: 'stptoken03',
    cancelled: 'stptoken04',
    delivered: 'stptoken05',
  };
  const tok = (s) => TOKENS[s].padEnd(40, 'x');
  const scenarios = [];
  const add = (sc, opts) =>
    scenarios.push(wrap({ feature: FEATURE, tags: [], ...sc }, { hideSr: true, ...opts }));

  // ===== A. page probes (load, responsive, a11y, keyboard, degraded, perf) ============================================
  const pageProbes = (pg, probes) => {
    for (const sc of h.pageScenarios(
      { feature: FEATURE, ...pg, probes, public: true },
      { depth: 'full' },
    ))
      scenarios.push(wrap(sc));
  };
  const ALL = ['load', 'responsive', 'a11y', 'keyboard', 'degraded', 'perf'];
  const SOME = ['load', 'responsive', 'a11y', 'keyboard'];
  for (const t of THEMES)
    pageProbes(
      { id: `pages.home-${t}`, title: `Shop home, ${t}`, path: `/s/stp-${t}`, ready: '.sf-count' },
      DEEP.includes(t) ? ALL : SOME,
    );
  const prodOf = { aurora: 1, noir: 2, bazaar: 3, meridian: 4, kraft: 5 };
  for (const [t, g] of Object.entries(prodOf))
    pageProbes(
      {
        id: `pages.product-${t}`,
        title: `Product page ${g}, ${t}`,
        path: `/s/stp-${t}/p/stp-item-${g}`,
        ready: '.sf-pd-actions',
      },
      DEEP.includes(t) ? ALL : ['load', 'a11y'],
    );
  pageProbes(
    {
      id: 'pages.order-new',
      title: 'Order tracking, new',
      path: `/s/stp-aurora/order/${tok('new')}`,
      ready: 'h1',
    },
    ALL,
  );
  pageProbes(
    {
      id: 'pages.order-shipped',
      title: 'Order tracking, shipped',
      path: `/s/stp-aurora/order/${tok('shipped')}`,
      ready: 'h1',
    },
    SOME,
  );
  pageProbes(
    {
      id: 'pages.order-delivered',
      title: 'Order tracking, delivered (meridian)',
      path: `/s/stp-meridian/order/${tok('delivered')}`,
      ready: 'h1',
    },
    ['load', 'a11y'],
  );
  pageProbes(
    { id: 'pages.disabled', title: 'Disabled shop', path: '/s/stp-off', ready: 'body' },
    ALL,
  );
  pageProbes(
    { id: 'pages.unknown', title: 'Unknown shop', path: '/s/zzz-nope', ready: 'body' },
    ALL,
  );
  pageProbes(
    {
      id: 'pages.noproduct',
      title: 'Unknown product',
      path: '/s/stp-aurora/p/nope',
      ready: 'body',
    },
    ['load', 'a11y'],
  );
  pageProbes(
    {
      id: 'pages.noorder',
      title: 'Unknown order',
      path: `/s/stp-aurora/order/${'z'.repeat(40)}`,
      ready: 'body',
    },
    ['load'],
  );
  pageProbes(
    { id: 'pages.empty', title: 'Shop without products', path: '/s/stp-empty', ready: 'body' },
    ['load', 'responsive', 'a11y', 'keyboard'],
  );
  pageProbes(
    {
      id: 'pages.nonumber',
      title: 'Shop without sending number',
      path: '/s/stp-nonumber',
      ready: 'body',
    },
    ['load', 'a11y'],
  );

  // ===== B. structure and computed look (all themes) ====================================================================
  const homeFacts = (c) =>
    c.page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const cs = (s, p) => {
        const e = q(s);
        return e ? getComputedStyle(e)[p] : null;
      };
      const txt = (e) => (e ? e.innerText.replace(/\s+/g, ' ').trim() : null);
      const hid = [...document.querySelectorAll('.sf-sr, .sf-skip')];
      hid.forEach((e) => (e.style.display = 'none'));
      const body = txt(document.body) || '';
      hid.forEach((e) => (e.style.display = ''));
      const bgAt = (x, y) => {
        let e = document.elementFromPoint(x, y);
        while (e) {
          const b = getComputedStyle(e).backgroundColor;
          if (b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') return b;
          e = e.parentElement;
        }
        return 'none';
      };
      return {
        h1: txt(q('h1')),
        textHead: body.slice(0, 220),
        textTail: body.slice(-260),
        cards: document.querySelectorAll('.sf-card, .card').length,
        filterLabels: [...document.querySelectorAll('.sf-filters label, aside label')]
          .map(txt)
          .join('|'),
        navLinks: [...document.querySelectorAll('header a, nav a')]
          .map(txt)
          .filter(Boolean)
          .join('|'),
        bodyFont: cs('h1', 'fontFamily') + '|' + cs('.sf-card h3, .card h3', 'fontFamily'),
        bodyBg: bgAt(8, 600),
        bodyColor: cs('.sf-card h3, .card h3', 'color'),
        headerBg: cs('header', 'backgroundColor'),
        cartBg: cs('button[aria-label^="Cart"]', 'backgroundColor'),
        h1Font: cs('h1', 'fontFamily') + '/' + cs('h1', 'fontSize') + '/' + cs('h1', 'color'),
        cardRadius:
          cs('.sf-card, .card', 'borderRadius') + '/' + cs('.sf-card, .card', 'boxShadow'),
        addBtn: cs('button.add, .sf-add, button:has(+ *)', 'backgroundColor'),
        footerBg: cs('footer', 'backgroundColor') + '/' + cs('footer', 'color'),
        lang: document.documentElement.lang,
        title: document.title,
      };
    });
  for (const t of THEMES)
    add({
      id: `struct.home-${t}`,
      title: `Home of the ${t} shop: texts and computed look`,
      tags: ['struct', t],
      run: async (c) => {
        await go(c, `/s/stp-${t}`);
        const f = await homeFacts(c);
        const { textHead, textTail, ...rest } = f;
        rec(c, rest);
        c.obs.enum('textHead', textHead);
        c.obs.enum('textTail', textTail);
        c.obs.enum(
          'countText',
          norm(
            await c.page
              .locator('.sf-count')
              .first()
              .innerText()
              .catch(() => null),
          ),
        );
        await c.shot('home');
      },
    });
  const productFacts = (c) =>
    c.page.evaluate(() => {
      const t = (s) => document.querySelector(s)?.innerText.trim().replace(/\s+/g, ' ') ?? null;
      return {
        title: document.title,
        name: t('h1'),
        price: t('.sf-pd-price'),
        stock: t('.sf-pd-stock'),
        thumbs: document.querySelectorAll('.sf-pd-thumbs button').length,
        save: t('.sf-pd-save'),
        meta: [...document.querySelectorAll('.sf-pd-meta dt, .sf-pd-meta dd')]
          .map((e) => e.innerText.trim().replace(/\s+/g, ''))
          .join('|'),
        addDisabled: !!document.querySelector('.sf-pd-actions > .sf-cta')?.disabled,
        ask: document
          .querySelector('a.sf-cta-ghost')
          ?.getAttribute('href')
          ?.replace(
            /^(.*?text=)(.*)$/,
            (m, a, b) => a + decodeURIComponent(b.replace(/\+/g, '%20')),
          )
          .replace(/https?:\/\/[^/ ]+/g, 'HOST'),
        tabs: [...document.querySelectorAll('.sf-tabs-head button')]
          .map((e) => e.textContent.trim())
          .join('|'),
        related: [...document.querySelectorAll('.sf-related h3')]
          .map((e) => e.textContent.trim())
          .join(','),
        reviewForms: document.querySelectorAll('#rv-name, .sf-review-form input').length,
        descPane:
          document.querySelector('.sf-tabs-pane')?.innerText.replace(/\s+/g, ' ').slice(0, 160) ??
          null,
        scriptInBody: !!document.querySelector('.sf-tabs-pane script'),
        crumbs: t('.breadcrumb, .sf-breadcrumb'),
      };
    });
  for (const t of THEMES)
    add({
      id: `struct.product-${t}`,
      title: `Product page 1 in ${t}`,
      tags: ['struct', t],
      run: async (c) => {
        await go(c, `/s/stp-${t}/p/stp-item-1`);
        rec(c, await productFacts(c));
        await c.shot('product');
      },
    });
  for (const g of [2, 3, 4, 5, 9, 11, 12, 6, 60])
    add({
      id: `struct.product-aurora-${g}`,
      title: `Product page ${g} (stock, gallery, sale, no image, sold out, draft)`,
      tags: ['struct'],
      run: async (c) => {
        const resp = await go(c, `/s/stp-aurora/p/stp-item-${g}`);
        c.obs.status('load', resp.status());
        if (resp.status() < 300) rec(c, await productFacts(c));
      },
    });
  for (const s of Object.keys(TOKENS))
    add({
      id: `struct.order-${s}`,
      title: `Order tracking page, status ${s}`,
      tags: ['struct', 'tracking'],
      run: async (c) => {
        const shop = s === 'delivered' ? 'meridian' : 'aurora';
        const resp = await go(c, `/s/stp-${shop}/order/${tok(s)}`);
        c.obs.status('load', resp.status());
        const f = await c.page.evaluate(() => ({
          text: (() => {
            const h = [...document.querySelectorAll('.sf-sr, .sf-skip')];
            h.forEach((e) => (e.style.display = 'none'));
            const t = document.body.innerText.replace(/\s+/g, ' ').trim();
            h.forEach((e) => (e.style.display = ''));
            return t;
          })(),
          links: [...document.querySelectorAll('a')].map((a) =>
            decodeURIComponent(a.getAttribute('href') || '').replace(/https?:\/\/[^/]+/, 'HOST'),
          ),
          done: document.querySelectorAll('.step.done, .sf-ot-steps li.is-done').length,
          title: document.title,
        }));
        rec(c, f);
        await c.shot('tracking');
      },
    });
  const notFoundCases = [
    ['disabled', '/s/stp-off'],
    ['unknown', '/s/zzz-nope'],
    ['uppercase-slug', '/s/STP-AURORA'],
    ['trailing-slash', '/s/stp-aurora/'],
    ['noproduct', '/s/stp-aurora/p/nope'],
    ['uppercase-product', '/s/stp-aurora/p/STP-ITEM-1'],
    ['draftProduct', '/s/stp-aurora/p/stp-item-60'],
    ['soldoutProduct', '/s/stp-aurora/p/stp-item-6'],
    ['otherShopProduct', '/s/stp-nonumber/p/stp-item-1'],
    ['noorder', `/s/stp-aurora/order/${'z'.repeat(40)}`],
    ['shortToken', '/s/stp-aurora/order/abc'],
    ['otherShopOrder', `/s/stp-meridian/order/${tok('new')}`],
    ['page0', '/s/stp-aurora?page=0'],
    ['pageX', '/s/stp-aurora?page=abc'],
    ['pageNeg', '/s/stp-aurora?page=-3'],
    ['page2', '/s/stp-aurora?page=2'],
    ['pageHuge', '/s/stp-aurora?page=99999999999'],
    ['xss-slug', '/s/%3Cscript%3Ewindow.__xss%3D1%3C%2Fscript%3E'],
    ['xss-product', '/s/stp-aurora/p/%3Cimg%20src%3Dx%20onerror%3Dwindow.__xss%3D1%3E'],
    ['xss-token', '/s/stp-aurora/order/%3Cimg%20src%3Dx%20onerror%3Dwindow.__xss%3D1%3E'],
    [
      'xss-query',
      '/s/stp-aurora?q=%3Cscript%3Ewindow.__xss%3D1%3C%2Fscript%3E&sort=%22%3E%3Cimg%20src%3Dx%20onerror%3Dwindow.__xss%3D1%3E',
    ],
    ['sql-slug', "/s/stp-aurora'%20OR%201%3D1--"],
    ['dot-slug', '/s/..%2F..%2Fetc'],
    ['empty-slug', '/s/'],
    ['long-slug', `/s/${'a'.repeat(300)}`],
    ['utf8-slug', '/s/%E4%BD%A0%E5%A5%BD'],
    ['nul-slug', '/s/abc%00def'],
  ];
  for (const [k, path] of notFoundCases)
    add({
      id: `struct.notfound-${k}`,
      title: `Odd address: ${k}`,
      tags: ['struct', 'notfound', ...(k.startsWith('xss') ? ['xss'] : [])],
      run: async (c) => {
        const r = await c.page.goto(c.url(path), { waitUntil: 'load' });
        await sleep(300);
        c.obs.status('load', r?.status() ?? null);
        c.obs.enum('title', await c.page.title());
        c.obs.enum('text', norm(await c.page.locator('body').innerText()).slice(0, 200));
        c.obs.enum(
          'count',
          norm(
            await c.page
              .locator('.sf-count')
              .first()
              .innerText()
              .catch(() => null),
          ),
        );
        c.obs.num('cards', await c.page.locator('.sf-card, .card').count());
        await xssFlag(c);
      },
    });
  for (const [k, path] of [
    ['home-noir', '/s/stp-noir'],
    ['product', '/s/stp-aurora/p/stp-item-1'],
    ['product-2', '/s/stp-aurora/p/stp-item-2'],
    ['order', `/s/stp-aurora/order/${tok('new')}`],
    ['bazaar', '/s/stp-bazaar'],
  ])
    add({
      id: `struct.seo-${k}`,
      title: `SEO tags: ${k}`,
      tags: ['struct', 'seo'],
      run: async (c) => {
        await c.page.goto(c.url(path), { waitUntil: 'domcontentloaded' });
        const f = await c.page.evaluate(() => {
          const m = (s) => document.querySelector(s)?.getAttribute('content') ?? null;
          return {
            title: document.title,
            desc: m('meta[name=description]'),
            ogType: m('meta[property="og:type"]'),
            ogSite: m('meta[property="og:site_name"]'),
            ogTitle: m('meta[property="og:title"]'),
            ogDesc: m('meta[property="og:description"]'),
            ogUrl: m('meta[property="og:url"]')?.replace(/https?:\/\/[^/]+/, 'HOST'),
            ogImage: m('meta[property="og:image"]')?.slice(0, 40),
            twitter: m('meta[name="twitter:card"]'),
            robots: m('meta[name=robots]'),
            lang: document.documentElement.lang,
            ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) =>
              JSON.stringify(JSON.parse(s.textContent)).replace(/https?:\/\/[^/"\\]+/g, 'HOST'),
            ),
          };
        });
        rec(c, f);
      },
    });
  add({
    id: 'struct.home-scroll-header',
    title: 'Header position after scrolling the home page',
    tags: ['struct'],
    run: async (c) => {
      await go(c, '/s/stp-aurora');
      await c.page.evaluate(() => window.scrollTo(0, 1500));
      await sleep(250);
      c.obs.num(
        'headerTop',
        await c.page.evaluate(() =>
          Math.round(document.querySelector('header')?.getBoundingClientRect().top ?? -999),
        ),
      );
    },
  });
  add({
    id: 'struct.hidden-toast-pointer',
    title: 'The hidden toast does not catch taps',
    tags: ['struct'],
    run: async (c) => {
      await go(c, '/s/stp-aurora');
      c.obs.enum(
        'pointerEvents',
        await c.page.evaluate(() => {
          const e = document.querySelector('#sf-toast, .sf-toast');
          return e ? getComputedStyle(e).pointerEvents : null;
        }),
      );
    },
  });

  // ===== C. cart ========================================================================================================
  for (const t of DEEP) {
    add({
      id: `cart.${t}.add-drawer`,
      title: `Cart in the ${t} shop: add, badge, drawer, footer`,
      tags: ['cart', t],
      run: async (c) => {
        const x = T(c);
        await go(c, `/s/stp-${t}`);
        await addBtn(c, 1).click();
        await sleep(200);
        c.obs.enum('toastAdd', await x.toast());
        await addBtn(c, 1).click();
        await sleep(200);
        c.obs.enum('badge', await x.badge());
        await page_reload(c);
        c.obs.enum('badgeAfterReload', await x.badge());
        const ls = JSON.parse((await x.lsCart()) || '[]');
        c.obs.enum(
          'lsLines',
          JSON.stringify(
            ls.map((l) => ({ name: l.name, price: l.price, qty: l.qty, image: !!l.image })),
          ),
        );
        await openCart(c);
        c.obs.enum('rows', JSON.stringify(await x.cartRows()));
        c.obs.enum('footer', await x.footer());
        await c.shot('drawer');
        await c.page.keyboard.press('Escape');
        await sleep(250);
        c.obs.enum(
          'drawerAfterEscape',
          await c.page.evaluate(() =>
            [...document.querySelectorAll('.sf-drawer')].map((d) => d.dataset.open).join(','),
          ),
        );
      },
    });
  }
  const page_reload = async (c) => {
    await c.page.reload({ waitUntil: 'load' });
    await c.page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
    await sleep(200);
  };
  add({
    id: 'cart.stock-caps',
    title: 'Stock caps: stock 1, 3 and 0 modals, drawer typing above stock',
    tags: ['cart'],
    run: async (c) => {
      const x = T(c);
      await go(c, '/s/stp-aurora');
      await addBtn(c, 4).click();
      await sleep(200);
      await addBtn(c, 4).click();
      await sleep(300);
      c.obs.enum('stock1Modal', await x.modal());
      await c.page.keyboard.press('Escape');
      await sleep(200);
      await addBtn(c, 12).click();
      await sleep(300);
      c.obs.enum('stock0Modal', await x.modal());
      await c.page.keyboard.press('Escape');
      await sleep(200);
      for (let i = 0; i < 4; i++) {
        await addBtn(c, 2).click();
        await sleep(150);
      }
      c.obs.enum('stock3Modal', await x.modal());
      await c.page.keyboard.press('Escape');
      await sleep(200);
      await openCart(c);
      c.obs.enum('rows', JSON.stringify(await x.cartRows()));
      const row = c.page.locator('.sf-cart-row').filter({ hasText: 'Canvas Tote 2' });
      await row.locator('.sf-qty input').fill('10');
      await row.locator('.sf-qty input').blur();
      await sleep(300);
      c.obs.enum('afterType10', await row.locator('.sf-qty input').inputValue());
      c.obs.enum('toastType', await x.toast());
    },
  });
  const qtyValues = [
    '0',
    '-1',
    '1.5',
    'abc',
    '1e2',
    '  5 ',
    '٣',
    '999999',
    '',
    '+2',
    '2.0',
    '😀',
    '<b>1</b>',
    '00003',
    '1,5',
    '99999999999999999999',
  ];
  for (const [i, v] of qtyValues.entries())
    add({
      id: `cart.stepper-value-${i}`,
      title: `Drawer quantity typed as ${JSON.stringify(v)}`,
      tags: ['cart', 'edge'],
      run: async (c) => {
        const x = T(c);
        await go(c, '/s/stp-aurora');
        await addBtn(c, 1).click();
        await sleep(200);
        await openCart(c);
        const inp = c.page.locator('.sf-cart-row .sf-qty input').first();
        await typeInto(c, inp, v);
        await inp.blur();
        await sleep(300);
        c.obs.enum(
          'qtyShown',
          await c.page
            .locator('.sf-cart-row .sf-qty input')
            .first()
            .inputValue()
            .catch(() => null),
        );
        c.obs.enum('rows', JSON.stringify(await x.cartRows()));
        c.obs.enum('footer', await x.footer());
        c.obs.enum('ls', stripIds(await x.lsCart()));
        c.obs.enum('toast', await x.toast());
        await xssFlag(c);
      },
    });
  add({
    id: 'cart.stepper-buttons-remove',
    title: 'Stepper buttons, minimum 1, remove, empty cart state',
    tags: ['cart'],
    run: async (c) => {
      const x = T(c);
      await go(c, '/s/stp-aurora');
      await addBtn(c, 1).click();
      await sleep(150);
      await addBtn(c, 9).click();
      await sleep(150);
      await openCart(c);
      const row1 = c.page.locator('.sf-cart-row').filter({ hasText: 'Clay Mug 1' });
      await row1.locator('.sf-qty button').first().click();
      await sleep(200);
      c.obs.enum('afterMinusAtOne', await row1.locator('.sf-qty input').inputValue());
      await row1.locator('.sf-qty button').nth(1).click();
      await sleep(200);
      c.obs.enum('afterPlus', await row1.locator('.sf-qty input').inputValue());
      c.obs.enum('footerAfterPlus', await x.footer());
      await c.page.locator('.sf-cart-row').first().locator('.sf-cart-remove').click();
      await sleep(250);
      c.obs.num('rowsAfterRemove', (await x.cartRows()).length);
      await c.page.locator('.sf-cart-row').first().locator('.sf-cart-remove').click();
      await sleep(250);
      c.obs.num('rowsAfterRemoveAll', (await x.cartRows()).length);
      c.obs.enum('emptyDrawer', norm(await c.page.locator('.sf-drawer-body').first().innerText()));
      c.obs.enum('emptyFooter', await x.footer());
      c.obs.enum('badge', await x.badge());
      c.obs.enum('ls', stripIds(await x.lsCart()));
      await c.shot('empty-cart');
    },
  });
  add({
    id: 'cart.shipping-rows',
    title: 'Shipping row: fee, hint, FREE state, total',
    tags: ['cart'],
    run: async (c) => {
      const x = T(c);
      await go(c, '/s/stp-aurora');
      await addBtn(c, 1).click();
      await sleep(150);
      await openCart(c);
      c.obs.enum('small', await x.footer());
      await c.page.keyboard.press('Escape');
      await sleep(250);
      for (let i = 0; i < 3; i++) {
        await addBtn(c, 9).click();
        await sleep(150);
      }
      await openCart(c);
      c.obs.enum('free', await x.footer());
    },
  });
  add({
    id: 'cart.empty-checkout',
    title: 'Checkout with an empty cart',
    tags: ['cart'],
    run: async (c) => {
      await go(c, '/s/stp-aurora');
      await openCart(c);
      await c.page.getByRole('button', { name: /Order on WhatsApp/ }).dispatchEvent('click');
      await sleep(300);
      c.obs.enum('modal', await T(c).modal());
    },
  });
  // tampered local storage
  const lsCases = {
    'not-json': (id) => 'not json{',
    'wrong-shape': (id) => '{"a":1}',
    'empty-array': (id) => '[]',
    'null-entries': (id) => '[null,1,"x"]',
    'negative-qty': (id) => JSON.stringify([{ id, name: 'x', price: 100, qty: -5 }]),
    'huge-qty': (id) => JSON.stringify([{ id, name: 'Huge', price: 100, qty: 1e9 }]),
    'string-qty': (id) => JSON.stringify([{ id, name: 'Str', price: 100, qty: '3' }]),
    'xss-name': (id) =>
      JSON.stringify([
        {
          id,
          name: '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>',
          price: 100,
          qty: 1,
          image: 'javascript:window.__xss=1',
        },
      ]),
    'xss-image': (id) =>
      JSON.stringify([
        {
          id,
          name: 'Img',
          price: 100,
          qty: 1,
          image: '"><img src=x onerror=window.__xss=1>',
        },
      ]),
    'unknown-product': (id) =>
      JSON.stringify([
        {
          id: typeof id === 'number' ? 999999999 : '00000000-0000-4000-8000-000000000000',
          name: 'Ghost',
          price: 100,
          qty: 1,
        },
      ]),
    'duplicate-lines': (id) =>
      JSON.stringify([
        { id, name: 'D', price: 100, qty: 1 },
        { id, name: 'D', price: 100, qty: 2 },
      ]),
  };
  for (const [k, mk] of Object.entries(lsCases))
    add({
      id: `cart.storage-${k}`,
      title: `Tampered cart in local storage: ${k}`,
      tags: ['cart', 'edge', 'xss'],
      run: async (c) => {
        const x = T(c);
        await go(c, '/s/stp-aurora');
        await addBtn(c, 1).click();
        await sleep(200);
        const key = await c.page.evaluate(() =>
          [...Array(localStorage.length).keys()]
            .map((i) => localStorage.key(i))
            .find((k) => k.startsWith('sf_cart_')),
        );
        const real = JSON.parse(await x.lsCart())[0].id;
        await c.page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, mk(real)]);
        await page_reload(c);
        c.obs.enum('badge', await x.badge());
        await openCart(c);
        c.obs.enum('rows', JSON.stringify(await x.cartRows()));
        c.obs.enum('footer', await x.footer());
        await xssFlag(c);
        c.obs.enum('lsAfter', stripIds(await x.lsCart()));
      },
    });

  // ===== D. catalog list: search, filter, sort, show more ===============================================================
  const names = (c) =>
    c.page
      .locator('.card:visible h3, .sf-card h3')
      .evaluateAll((es) =>
        es.filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim()),
      );
  const count = async (c) =>
    norm(
      await c.page
        .locator('.sf-count')
        .first()
        .innerText()
        .catch(() => null),
    );
  const searchTerms = {
    hit: 'mug',
    'hit-upper': 'MUG 1',
    miss: 'zzz',
    percent: '%',
    underscore: '_',
    quote: "'",
    dquote: '"',
    backslash: '\\',
    sql: "' OR 1=1 --",
    spaces: '    ',
    padded: '  mug  ',
    unicode: 'Müller 李雷',
    emoji: '🎉',
    long: 'a'.repeat(400),
    script: '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>',
    regex: '.*',
    number: '12',
    sku: 'SKU-5',
    category: 'bags',
    description: 'everyday',
    'two-words': 'clay mug',
    nul: 'a\u0000b',
  };
  for (const [k, v] of Object.entries(searchTerms))
    add({
      id: `list.search-${k}`,
      title: `Search box: ${k}`,
      tags: ['list', 'edge', ...(k === 'script' ? ['xss'] : [])],
      run: async (c) => {
        await go(c, '/s/stp-aurora');
        const search = c.page.locator('.sf-search input');
        await search.fill(v);
        await sleep(450);
        c.obs.enum('count', await count(c));
        c.obs.enum('first', (await names(c))[0] ?? null);
        c.obs.num('visible', (await names(c)).length);
        c.obs.enum(
          'noResults',
          norm(
            await c.page
              .locator('[data-no-results]:visible, .sf-no-results')
              .first()
              .innerText()
              .catch(() => null),
          ),
        );
        c.obs.enum('urlAfter', new URL(c.page.url()).search);
        await page_reload(c);
        c.obs.enum('inputAfterReload', await c.page.locator('.sf-search input').inputValue());
        await xssFlag(c);
      },
    });
  add({
    id: 'list.search-clear-and-reset',
    title: 'Clear filters and Reset filters after a search',
    tags: ['list'],
    run: async (c) => {
      await go(c, '/s/stp-aurora');
      const search = c.page.locator('.sf-search input');
      await search.fill('zzz');
      await sleep(350);
      c.obs.enum('none', await count(c));
      await c.page.getByRole('button', { name: 'Clear filters' }).click();
      await sleep(300);
      c.obs.enum('afterClear', await count(c));
      c.obs.enum('searchAfterClear', await search.inputValue());
      await search.fill('mug');
      await c.page.getByLabel('Bags').check();
      await sleep(300);
      await c.page.getByRole('button', { name: 'Reset filters' }).click();
      await sleep(300);
      c.obs.enum('afterReset', await count(c));
      c.obs.enum('searchAfterReset', await search.inputValue());
      c.obs.flag('bagsAfterReset', await c.page.getByLabel('Bags').isChecked());
    },
  });
  for (const s of [
    'price-asc',
    'price-desc',
    'name-asc',
    'name-desc',
    'newest',
    'featured',
    'rating',
  ])
    add({
      id: `list.sort-${s}`,
      title: `Sort ${s}`,
      tags: ['list'],
      run: async (c) => {
        await go(c, '/s/stp-aurora');
        const sort = c.page.locator('.sf-toolbar select');
        const opts = await sort.locator('option').evaluateAll((o) => o.map((x) => x.value));
        c.obs.seq('sortOptions', opts);
        if (!opts.includes(s)) {
          c.obs.flag('optionExists', false);
          return;
        }
        await sort.selectOption(s);
        await sleep(300);
        c.obs.seq('first6', (await names(c)).slice(0, 6));
        c.obs.enum('count', await count(c));
        await sort.selectOption('featured');
        await sleep(300);
        c.obs.seq('featuredAfter', (await names(c)).slice(0, 4));
      },
    });
  const filterCases = {
    'cat-bags': async (c) => c.page.getByLabel('Bags').check(),
    'cat-two': async (c) => {
      await c.page.getByLabel('Bags').check();
      await c.page.getByLabel('Decor').check();
    },
    'cat-all': async (c) => {
      for (const l of ['Tops', 'Home', 'Bags', 'Decor']) await c.page.getByLabel(l).check();
    },
    'on-sale': async (c) => c.page.getByLabel('On sale').check(),
    'in-stock-off': async (c) => c.page.getByLabel('In stock only').uncheck(),
    'sale-and-bags': async (c) => {
      await c.page.getByLabel('On sale').check();
      await c.page.getByLabel('Bags').check();
    },
    'sale-and-search-miss': async (c) => {
      await c.page.getByLabel('On sale').check();
      await c.page.locator('.sf-search input').fill('zzz');
    },
  };
  const priceCases = {
    range: ['200', '300'],
    'min-only': ['500', ''],
    'max-only': ['', '150'],
    'min-over-max': ['500', '100'],
    negative: ['-5', '-1'],
    letters: ['abc', 'xyz'],
    decimals: ['100.5', '250.99'],
    exponent: ['1e2', '3e2'],
    huge: ['0', '99999999999999999999'],
    zero: ['0', '0'],
    spaces: [' 200 ', ' 300 '],
    script: ['<img src=x onerror=window.__xss=1>', '1'],
  };
  for (const [k, fn] of Object.entries(filterCases))
    add({
      id: `list.filter-${k}`,
      title: `Filter ${k}`,
      tags: ['list'],
      run: async (c) => {
        await go(c, '/s/stp-aurora');
        await fn(c);
        await sleep(350);
        c.obs.enum('count', await count(c));
        c.obs.seq('first4', (await names(c)).slice(0, 4));
        c.obs.enum('url', new URL(c.page.url()).search);
        await page_reload(c);
        c.obs.enum('countAfterReload', await count(c));
      },
    });
  for (const [k, [a, b]] of Object.entries(priceCases))
    add({
      id: `list.price-${k}`,
      title: `Price range ${k}`,
      tags: ['list', 'edge', ...(k === 'script' ? ['xss'] : [])],
      run: async (c) => {
        await go(c, '/s/stp-aurora');
        const min = c.page.locator('[data-filter-min], .sf-price-range input').first();
        const max = c.page.locator('[data-filter-max], .sf-price-range input').nth(1);
        await min.fill(a).catch(() => {});
        await max.fill(b).catch(() => {});
        await sleep(400);
        c.obs.enum('count', await count(c));
        c.obs.seq('first4', (await names(c)).slice(0, 4));
        c.obs.enum('minShown', await min.inputValue());
        c.obs.enum('maxShown', await max.inputValue());
        await xssFlag(c);
      },
    });
  add({
    id: 'list.view-toggle',
    title: 'Grid and list view',
    tags: ['list'],
    run: async (c) => {
      await go(c, '/s/stp-aurora');
      const cols = () =>
        c.page.evaluate(
          () =>
            getComputedStyle(
              document.querySelector('[data-product-grid], .sf-grid'),
            ).gridTemplateColumns.split(' ').length,
        );
      c.obs.num('colsGrid', await cols());
      await c.page.locator('[data-view="list"], .sf-view-toggle button').nth(1).click();
      await sleep(250);
      c.obs.num('colsList', await cols());
      await page_reload(c);
      c.obs.num('colsAfterReload', await cols());
    },
  });
  add({
    id: 'list.show-more',
    title: 'Show more products (page 2)',
    tags: ['list', 'show-more'],
    run: async (c) => {
      await go(c, '/s/stp-aurora');
      const more = c.page.locator('[data-show-more], .sf-more-btn');
      c.obs.enum(
        'moreText',
        norm(
          await c.page
            .locator('[data-show-more-wrap], .sf-more')
            .first()
            .innerText()
            .catch(() => null),
        ),
      );
      const before = await c.page.locator('.card, .sf-card').count();
      await more.click().catch(() => {});
      await sleep(1600);
      c.obs.flag('cardsAdded', (await c.page.locator('.card, .sf-card').count()) > before);
      c.obs.flag(
        'buttonGone',
        (await c.page.locator('[data-show-more], .sf-more-btn').count()) === 0,
      );
      c.obs.enum('count', await count(c));
    },
  });
  add({
    id: 'list.show-more-server-error',
    title: 'Show more while the server fails',
    tags: ['list', 'fail', 'show-more'],
    run: async (c) => {
      await go(c, '/s/stp-aurora');
      const undo = await c.failRequests((r) => /partial=1|\/more\?/.test(r.url()), 500);
      const before = await c.page.locator('.card, .sf-card').count();
      await c.page
        .locator('[data-show-more], .sf-more-btn')
        .click()
        .catch(() => {});
      await sleep(1500);
      await undo();
      c.obs.flag('cardsAdded', (await c.page.locator('.card, .sf-card').count()) > before);
      c.obs.flag('pageStillUsable', await c.page.locator('.sf-search input').isVisible());
    },
  });

  // ===== E. wishlist, compare, quick view, share, product page behaviour =================================================
  add({
    id: 'misc.wishlist',
    title: 'Wishlist: toggle, badge, storage, drawer',
    tags: ['misc'],
    run: async (c) => {
      const x = T(c);
      await go(c, '/s/stp-aurora');
      const wish = c.page.locator('.sf-wish');
      await wish.nth(0).click({ force: true });
      await sleep(180);
      c.obs.enum('toast1', await x.toast());
      await wish.nth(1).click({ force: true });
      await sleep(180);
      c.obs.enum(
        'badge',
        norm(
          await c.page
            .locator(
              'button[aria-label^="Wishlist"] [data-wish-count], button[aria-label^="Wishlist"] .sf-badge',
            )
            .first()
            .innerText()
            .catch(() => null),
        ),
      );
      await wish.nth(0).click({ force: true });
      await sleep(180);
      c.obs.enum('toastRemove', await x.toast());
      c.obs.seq(
        'storage',
        Object.entries(await x.ls())
          .filter(([k]) => /wish/.test(k))
          .map(([, v]) => String(JSON.parse(v).length)),
      );
      await c.page.locator('button[aria-label^="Wishlist"]').first().click();
      await sleep(400);
      c.obs.enum('drawer', norm(await c.page.locator('.sf-drawer-body').first().innerText()));
    },
  });
  add({
    id: 'misc.compare',
    title: 'Compare: four at most, full message, table',
    tags: ['misc'],
    run: async (c) => {
      const x = T(c);
      for (const g of [1, 2, 3, 4, 5]) {
        await go(c, `/s/stp-aurora/p/stp-item-${g}`);
        await c.page.locator('.sf-pd-icons button').nth(1).click();
        await sleep(280);
        if (g === 1) c.obs.enum('toastFirst', await x.toast());
        if (g === 5) c.obs.enum('fullModal', await x.modal());
      }
      await c.page.keyboard.press('Escape');
      await sleep(200);
      c.obs.enum(
        'bar',
        norm(
          await c.page
            .locator('#sf-compare-bar, .sf-compare-bar')
            .first()
            .innerText()
            .catch(() => null),
        ),
      );
      await c.page
        .getByRole('button', { name: /^Compare/ })
        .last()
        .click()
        .catch(() => {});
      await sleep(400);
      c.obs.enum(
        'table',
        norm(
          await c.page
            .locator('.sf-compare-table')
            .first()
            .innerText()
            .catch(() => ''),
        ).slice(0, 300),
      );
    },
  });
  add({
    id: 'misc.quick-view',
    title: 'Quick view and its add to cart',
    tags: ['misc'],
    run: async (c) => {
      const x = T(c);
      await go(c, '/s/stp-aurora');
      await c.page.locator('.sf-quick').first().click({ force: true });
      await sleep(450);
      c.obs.enum('quick', await x.modal());
      await c.page.getByRole('button', { name: 'Add to cart' }).last().click();
      await sleep(300);
      c.obs.enum('afterAddModal', await x.modal());
      c.obs.enum('toast', await x.toast());
      c.obs.enum('badge', await x.badge());
    },
  });
  add({
    id: 'misc.share',
    title: 'Share dialog on the product page',
    tags: ['misc'],
    run: async (c) => {
      const x = T(c);
      await go(c, '/s/stp-aurora/p/stp-item-1');
      await c.page.locator('.sf-pd-icons button').nth(2).click();
      await sleep(450);
      c.obs.enum('modal', await x.modal());
      c.obs.seq(
        'links',
        await c.page
          .locator('a[href^="https://wa.me/?text"], a[href^="https://t.me"], a[href^="mailto:"]')
          .evaluateAll((a) =>
            a.map((y) =>
              decodeURIComponent(y.href).replace(/https?:\/\/[^/]+\/s\/stp-aurora/, 'BASE'),
            ),
          ),
      );
    },
  });
  add({
    id: 'misc.product-tabs-thumbs',
    title: 'Product page: thumbnails swap, tabs, quantity stepper',
    tags: ['misc'],
    run: async (c) => {
      await go(c, '/s/stp-aurora/p/stp-item-1');
      const src0 = await c.page.locator('.sf-pd-main img').getAttribute('src');
      await c.page.locator('.sf-pd-thumbs button').nth(1).click();
      await sleep(180);
      c.obs.flag(
        'thumbSwap',
        src0 !== (await c.page.locator('.sf-pd-main img').getAttribute('src')),
      );
      for (const i of [0, 1, 2]) {
        await c.page.locator('.sf-tabs-head button').nth(i).click();
        await sleep(180);
        c.obs.enum(
          `pane${i}`,
          norm(await c.page.locator('.sf-tabs-pane:visible').first().innerText()),
        );
      }
      await go(c, '/s/stp-aurora/p/stp-item-2');
      const q = c.page.locator('.sf-pd-actions .sf-qty input');
      await c.page.locator('.sf-pd-actions .sf-qty button').first().click();
      c.obs.enum('qtyMin', await q.inputValue());
      await c.page.locator('.sf-pd-actions .sf-qty button').nth(1).click();
      c.obs.enum('qtyInc', await q.inputValue());
      await q.fill('9');
      await c.page.locator('.sf-pd-actions > .sf-cta').click();
      await sleep(350);
      c.obs.enum('rows', JSON.stringify(await T(c).cartRows()));
      c.obs.enum('toast', await T(c).toast());
      c.obs.enum(
        'drawerOpen',
        await c.page.evaluate(() =>
          [...document.querySelectorAll('.sf-drawer')].map((d) => d.dataset.open).join(','),
        ),
      );
    },
  });
  for (const v of ['0', '-3', '1.5', 'abc', '', '99999', '<b>', '5 '])
    add({
      id: `misc.product-qty-${v.replace(/\W/g, '_') || 'empty'}`,
      title: `Product page quantity typed as ${JSON.stringify(v)} then add (stock 1 product)`,
      tags: ['misc', 'edge'],
      run: async (c) => {
        await go(c, '/s/stp-aurora/p/stp-item-4');
        await typeInto(c, c.page.locator('.sf-pd-actions .sf-qty input'), v);
        await c.page.locator('.sf-pd-actions > .sf-cta').click();
        await sleep(400);
        c.obs.enum('rows', JSON.stringify(await T(c).cartRows()));
        c.obs.enum('toast', await T(c).toast());
        c.obs.enum(
          'qtyShown',
          await c.page
            .locator('.sf-pd-actions .sf-qty input')
            .inputValue()
            .catch(() => null),
        );
        await xssFlag(c);
      },
    });
  add({
    id: 'misc.view-counter',
    title: 'A page view is counted once per day row',
    tags: ['misc'],
    run: async (c) => {
      const q = () =>
        Number(
          c.side === 'threadwise'
            ? mysql(
                "select ifnull(sum(views),0) from wa_storefront_views where storefront_id=(select id from wa_storefronts where slug='stp-kraft')",
              )
            : psql(
                "select coalesce(sum(views),0) from wa_storefront_views where storefront_id=(select id from wa_storefronts where slug='stp-kraft' limit 1)",
              ),
        );
      let n0 = 0;
      try {
        n0 = q();
      } catch {
        c.obs.enum('counter', 'unreadable');
        return;
      }
      await go(c, '/s/stp-kraft');
      await go(c, '/s/stp-kraft/p/stp-item-1');
      await sleep(400);
      c.obs.num('delta', q() - n0);
    },
  });
  add({
    id: 'misc.hover-focus-styles',
    title: 'Card hover and search focus styles',
    tags: ['misc'],
    run: async (c) => {
      await go(c, '/s/stp-aurora');
      const st = (sel) =>
        c.page.evaluate((s) => {
          const e = document.querySelector(s);
          if (!e) return null;
          const k = getComputedStyle(e);
          return [k.transform, k.boxShadow, k.outlineStyle, k.backgroundColor].join('/');
        }, sel);
      await c.page.locator('.sf-card, .card').first().hover();
      await sleep(300);
      c.obs.enum('cardHover', await st('.sf-card:hover, .card:hover'));
      await c.page.locator('.sf-search input').focus();
      await sleep(200);
      c.obs.enum('searchFocus', await st('.sf-search input'));
    },
  });

  // ===== F. coupon quote ================================================================================================
  const couponCodes = {
    SAVE10: 'SAVE10',
    lower: 'save10',
    padded: '  SAVE10  ',
    FLAT100: 'FLAT100',
    SHIPFREE: 'SHIPFREE',
    inactive: 'OFF',
    expired: 'OLD',
    unknown: 'NOPE',
    long: 'A'.repeat(200),
    len64: 'A'.repeat(64),
    len65: 'A'.repeat(65),
    script: '<img src=x onerror="window.__xss=1">',
    sql: "' OR '1'='1",
    unicode: 'ÉTÉ-2024',
    emoji: '🎉',
    inner_space: 'SAVE 10',
    percent: '100%',
    nul: 'A\u0000B',
  };
  for (const [k, code] of Object.entries(couponCodes))
    add({
      id: `coupon.apply-${k}`,
      title: `Coupon code ${k}`,
      tags: ['coupon', 'edge', ...(k === 'script' ? ['xss'] : [])],
      run: async (c) => {
        resetThrottle(c);
        const f = await toCheckout(c, { items: [1, 9] });
        const w = watch(c);
        await f.coupon.fill(code);
        await f.apply.click();
        await sleep(1100);
        c.obs.enum('msg', norm(await f.couponMsg.innerText().catch(() => null)));
        c.obs.enum('inputShown', await f.coupon.inputValue());
        c.obs.num('requests', w.reqs.filter((r) => r.route === 'coupon').length);
        const res = w.res.filter((r) => r.route === 'coupon').pop();
        if (res) c.obs.enum('statusClass.quote', cls(res.status));
        c.obs.enum('footer', await T(c).footer());
        c.obs.enum('summary', (await T(c).modal())?.slice(0, 400));
        await xssFlag(c);
      },
    });
  add({
    id: 'coupon.minimum-subtotal',
    title: 'FLAT100 with a subtotal below and above the minimum',
    tags: ['coupon'],
    run: async (c) => {
      resetThrottle(c);
      const f = await toCheckout(c, { items: [1] });
      await f.coupon.fill('FLAT100');
      await f.apply.click();
      await sleep(1000);
      c.obs.enum('below', norm(await f.couponMsg.innerText().catch(() => null)));
    },
  });
  add({
    id: 'coupon.clear-and-reapply',
    title: 'Apply, clear with the empty box, reapply another',
    tags: ['coupon'],
    run: async (c) => {
      resetThrottle(c);
      const f = await toCheckout(c, { items: [1, 9] });
      for (const [k, code] of [
        ['a', 'SAVE10'],
        ['b', ''],
        ['c', 'SHIPFREE'],
      ]) {
        await f.coupon.fill(code);
        await f.apply.click();
        await sleep(900);
        c.obs.enum(`msg${k}`, norm(await f.couponMsg.innerText().catch(() => null)));
        c.obs.enum(`footer${k}`, await T(c).footer());
      }
      c.obs.enum(
        'upper',
        await c.page.evaluate(
          () =>
            getComputedStyle(document.querySelector('#sf-co-coupon, .sf-checkout input.is-upper'))
              .textTransform,
        ),
      );
    },
  });
  add({
    id: 'coupon.cart-changed-after-apply',
    title: 'Cart quantity changes after a coupon was applied',
    tags: ['coupon'],
    run: async (c) => {
      resetThrottle(c);
      const f = await toCheckout(c, { items: [1, 9] });
      await f.coupon.fill('SAVE10');
      await f.apply.click();
      await sleep(900);
      c.obs.enum('before', await T(c).footer());
      await c.page.keyboard.press('Escape');
      await sleep(250);
      c.obs.enum('modalAfterEscape', await T(c).modal());
    },
  });
  add({
    id: 'coupon.server-error',
    title: 'Coupon quote while the server fails',
    tags: ['coupon', 'fail'],
    run: async (c) => {
      resetThrottle(c);
      const f = await toCheckout(c, { items: [1, 9] });
      const undo = await c.failRequests((r) => /\/coupon$/.test(r.url()), 500);
      await f.coupon.fill('SAVE10');
      await f.apply.click();
      await sleep(1000);
      c.obs.enum('msg', norm(await f.couponMsg.innerText().catch(() => null)));
      await undo();
      await f.apply.click();
      await sleep(1000);
      c.obs.enum('msgAfterRetry', norm(await f.couponMsg.innerText().catch(() => null)));
    },
  });
  add({
    id: 'coupon.offline',
    title: 'Coupon quote while offline',
    tags: ['coupon', 'fail'],
    run: async (c) => {
      resetThrottle(c);
      const f = await toCheckout(c, { items: [1, 9] });
      const undo = await c.failRequests((r) => /\/coupon$/.test(r.url()), 'abort');
      await f.coupon.fill('SAVE10');
      await f.apply.click();
      await sleep(1000);
      c.obs.enum('msg', norm(await f.couponMsg.innerText().catch(() => null)));
      await undo();
    },
  });
  add({
    id: 'coupon.double-apply',
    title: 'Apply clicked twice quickly',
    tags: ['coupon'],
    run: async (c) => {
      resetThrottle(c);
      const f = await toCheckout(c, { items: [1, 9] });
      const w = watch(c);
      await f.coupon.fill('SAVE10');
      await f.apply.dblclick();
      await sleep(1200);
      c.obs.num('submitRequests', w.reqs.filter((r) => r.route === 'coupon').length);
      c.obs.enum('msg', norm(await f.couponMsg.innerText().catch(() => null)));
    },
  });

  // ===== G. checkout form ===============================================================================================
  add({
    id: 'co.form-structure',
    title: 'Checkout dialog structure: fields, limits, placeholders, payment choices, focus',
    tags: ['co'],
    run: async (c) => {
      const f = await toCheckout(c, { items: [1, 9] });
      c.obs.enum('formText', await T(c).modal());
      c.obs.enum(
        'drawerOpenBehind',
        await c.page.evaluate(() =>
          [...document.querySelectorAll('.sf-drawer')].map((d) => d.dataset.open).join(','),
        ),
      );
      c.obs.enum(
        'attrs',
        JSON.stringify(
          await c.page.evaluate(() => {
            const q = (s) => document.querySelector(s);
            const a = (e) =>
              e && {
                max: e.maxLength,
                ph: e.placeholder,
                type: e.type,
                ac: e.autocomplete,
                req: e.required,
                inputmode: e.inputMode,
                label: !!(e.labels && e.labels.length) || !!e.getAttribute('aria-label'),
              };
            return {
              name: a(q('#sf-co-name, .sf-checkout input[autocomplete=name]')),
              phone: a(q('#sf-co-phone, .sf-checkout input[type=tel]')),
              addr: a(q('#sf-co-addr, .sf-checkout textarea')),
              coupon: a(q('#sf-co-coupon, .sf-checkout input.is-upper')),
              pay: [...document.querySelectorAll('input[type=radio]')].map(
                (r) => r.value + ':' + r.checked,
              ),
              dialog: !!document.querySelector('[role=dialog][aria-modal=true], dialog[open]'),
            };
          }),
        ),
      );
      c.obs.enum(
        'activeElement',
        await c.page.evaluate(
          () =>
            document.activeElement?.tagName +
            '/' +
            (document.activeElement?.id ||
              document.activeElement?.getAttribute('autocomplete') ||
              ''),
        ),
      );
      await c.shot('checkout');
      void f;
    },
  });
  add({
    id: 'co.required-in-order',
    title: 'Empty submit, then each required field in turn',
    tags: ['co'],
    run: async (c) => {
      const f = await toCheckout(c, { items: [1, 9] });
      const w = watch(c);
      const m = async (k) => {
        await f.place.click();
        await sleep(220);
        c.obs.enum(k, norm(await f.status.innerText().catch(() => null)));
      };
      await m('empty');
      await f.name.fill('Asha Test');
      await m('nameOnly');
      await f.phone.fill('12345');
      await m('shortPhone');
      await f.phone.fill('1234567');
      await m('sevenDigits');
      await f.phone.fill('abcdefghij');
      await m('letters');
      c.obs.num('submitRequests', w.reqs.filter((r) => r.route === 'checkout').length);
    },
  });
  const matrix = (type, extra = {}) =>
    h.casesFor({ type, ...extra }, 'full').map((k) => ({
      ...k,
      value: typeof k.value === 'function' ? k.value({ max: extra.max, ...extra }) : k.value,
    }));
  const coFields = [
    [
      'name',
      'name',
      { max: 120 },
      [
        'empty',
        'spaces',
        'typical',
        'max',
        'max+1',
        'unicode',
        'html',
        'single-char',
        'padded',
        'emoji',
        'rtl',
        'sql',
        'script',
        'newline',
        'very-long',
        'tab',
        'zero-width',
        'combining',
        'quotes',
        'backslash',
        'percent',
        'null-byte',
      ],
    ],
    ['phone', 'phone', {}, null],
    [
      'addr',
      'address',
      { max: 500 },
      [
        'empty',
        'spaces',
        'typical',
        'unicode',
        'html',
        'padded',
        'emoji',
        'rtl',
        'sql',
        'script',
        'newline',
        'very-long',
        'tab',
        'zero-width',
        'quotes',
        'backslash',
        'percent',
        'null-byte',
      ],
    ],
    [
      'note',
      'text',
      { max: 300 },
      [
        'empty',
        'spaces',
        'typical',
        'max',
        'max+1',
        'unicode',
        'html',
        'emoji',
        'rtl',
        'sql',
        'script',
        'newline',
        'very-long',
        'zero-width',
        'quotes',
        'backslash',
        'percent',
        'null-byte',
      ],
    ],
  ];
  const phoneCases = [
    ['empty', ''],
    ['six', '123456'],
    ['seven', '1234567'],
    ['indian-plain', '9876543210'],
    ['indian-plus', '+91 98765 43210'],
    ['with-dashes', '98765-43210'],
    ['brackets', '(987) 654-3210'],
    ['letters', 'abcdefghij'],
    ['mixed', '98765abc43210'],
    ['fifteen', '123456789012345'],
    ['sixteen', '1234567890123456'],
    ['long', '9'.repeat(40)],
    ['arabic-digits', '٩٨٧٦٥٤٣٢١٠'],
    ['spaces', '          '],
    ['plus-only', '+++++++'],
    ['html', '<b>9876543210</b>'],
    ['script', '9876543210<img src=x onerror=window.__xss=1>'],
    ['sql', "9876543210' OR '1'='1"],
    ['zero-width', '98765\u200b43210'],
    ['leading-zeros', '0009876543210'],
    ['emoji', '98765😀43210'],
    ['newline', '98765\n43210'],
  ];
  for (const [fid, type, ex, only] of coFields) {
    const cases =
      fid === 'phone'
        ? phoneCases.map(([id, value]) => ({ id, value }))
        : matrix(type, ex).filter((k) => !only || only.includes(k.id));
    for (const k of cases)
      add({
        id: `co.${fid}.${k.id.replace(/[^\w+-]/g, '_')}`,
        title: `Checkout ${fid}: ${k.id}`,
        tags: ['co', 'edge', ...(/script|html/.test(k.id) ? ['xss'] : [])],
        run: async (c) => {
          resetThrottle(c);
          const f = await toCheckout(c, { items: [1, 9] });
          const vals = fid === 'phone' ? { phone: k.value } : { [fid]: k.value };
          await fillCo(c, vals);
          const r = await placeAndObserve(c, { before: maxOrder(c) });
          c.obs.num('valueLength', String(k.value).length);
          if (r.token) await openTracking(c, r.token);
          void f;
        },
      });
  }
  const happy = {
    prepaid: { pay: 'prepaid' },
    cod: { pay: 'cod' },
    upi: { pay: 'upi' },
    'with-note': { note: 'leave at door', pay: 'cod' },
    'with-coupon': { coupon: 'SAVE10', pay: 'prepaid' },
    'coupon-shipfree': { coupon: 'SHIPFREE', pay: 'cod' },
    'coupon-lowercase': { coupon: 'save10', pay: 'cod' },
    'coupon-unknown': { coupon: 'NOPE', pay: 'cod' },
    'coupon-expired': { coupon: 'OLD', pay: 'cod' },
    'coupon-below-min': { coupon: 'FLAT100', pay: 'cod', items: [1] },
    'single-item': { pay: 'cod', items: [9] },
    'free-shipping-cart': { pay: 'cod', items: [1, 9, 9, 9] },
    'multi-qty': { pay: 'cod', items: [2, 2, 3] },
  };
  for (const t of DEEP)
    for (const [k, v] of Object.entries(happy)) {
      if (t !== 'aurora' && !['prepaid', 'cod', 'upi'].includes(k)) continue;
      add({
        id: `co.${t}.place-${k}`,
        title: `Place an order (${t}): ${k}`,
        tags: ['co', t],
        run: async (c) => {
          resetThrottle(c);
          const f = await toCheckout(c, { items: v.items || [1, 9], slug: `stp-${t}` });
          c.obs.seq(
            'payChoices',
            await c.page
              .locator('input[type=radio]')
              .evaluateAll((rs) => rs.map((r) => r.value + ':' + r.checked)),
          );
          if (v.pay) {
            const radio = c.page.locator(`input[type=radio][value=${v.pay}]`);
            if (await radio.count()) await radio.check({ force: true });
            else c.obs.flag(`choice.${v.pay}`, false);
          }
          await fillCo(c, { coupon: v.coupon || '', note: v.note || '' });
          if (v.coupon) {
            await f.apply.click().catch(() => {});
            await sleep(900);
            c.obs.enum('couponMsg', norm(await f.couponMsg.innerText().catch(() => null)));
          }
          const r = await placeAndObserve(c, { before: maxOrder(c) });
          if (r.token) {
            await openTracking(c, r.token, `stp-${t}`);
            c.obs.enum(
              'trackText',
              (await bodyText(c))
                .replace(/#\d+/g, '#N')
                .replace(/\d{1,2} \w{3},? \d{4}.*?(?= )/g, 'DATE')
                .slice(0, 500),
            );
          }
        },
      });
    }
  add({
    id: 'co.returning-phone-cod-rto',
    title: 'COD order for a phone with order history (RTO band)',
    tags: ['co'],
    run: async (c) => {
      resetThrottle(c);
      await toCheckout(c, { items: [9] });
      await c.page.locator('input[type=radio][value=cod]').check({ force: true });
      await fillCo(c, { phone: '+91 98765 43210' });
      await placeAndObserve(c, { before: maxOrder(c) });
    },
  });
  add({
    id: 'co.double-submit',
    title: 'Place order clicked twice quickly',
    tags: ['co', 'double'],
    run: async (c) => {
      resetThrottle(c);
      await toCheckout(c, { items: [1, 9] });
      await c.page.locator('input[type=radio][value=cod]').check({ force: true });
      await fillCo(c);
      await placeAndObserve(c, { before: maxOrder(c), dbl: true });
    },
  });
  add({
    id: 'co.enter-key',
    title: 'Enter in a field submits the form',
    tags: ['co'],
    run: async (c) => {
      resetThrottle(c);
      const f = await toCheckout(c, { items: [1, 9] });
      await c.page.locator('input[type=radio][value=cod]').check({ force: true });
      await fillCo(c);
      const w = watch(c);
      await stubWa(c);
      const before = maxOrder(c);
      await f.name.press('Enter');
      await sleep(2200);
      c.obs.num('submitRequests', w.reqs.filter((r) => r.route === 'checkout').length);
      c.obs.num('rowsCreated', ordersAfter(c, before).length);
    },
  });
  add({
    id: 'co.server-error',
    title: 'Place order while the server answers 500',
    tags: ['co', 'fail'],
    run: async (c) => {
      resetThrottle(c);
      await toCheckout(c, { items: [1, 9] });
      await fillCo(c);
      const undo = await c.failRequests((r) => /\/checkout$/.test(r.url()), 500);
      const before = maxOrder(c);
      await placeAndObserve(c, { before });
      await undo();
      const f = co(c);
      c.obs.flag('valuesKept', (await f.name.inputValue().catch(() => '')) === 'Asha Test');
      c.obs.flag('submitUsable', await f.place.isEnabled().catch(() => false));
      c.obs.num('cartLines', JSON.parse((await T(c).lsCart()) || '[]').length);
      const r2 = await placeAndObserve(c, { before });
      void r2;
    },
  });
  add({
    id: 'co.offline',
    title: 'Place order while offline',
    tags: ['co', 'fail'],
    run: async (c) => {
      resetThrottle(c);
      await toCheckout(c, { items: [1, 9] });
      await fillCo(c);
      const undo = await c.failRequests((r) => /\/checkout$/.test(r.url()), 'abort');
      await placeAndObserve(c, { before: maxOrder(c) });
      await undo();
      const f = co(c);
      c.obs.flag('valuesKept', (await f.name.inputValue().catch(() => '')) === 'Asha Test');
      c.obs.flag('submitUsable', await f.place.isEnabled().catch(() => false));
      c.obs.num('cartLines', JSON.parse((await T(c).lsCart()) || '[]').length);
    },
  });
  add({
    id: 'co.slow-server',
    title: 'Place order while the server is slow: busy state, repeat click blocked',
    tags: ['co', 'fail'],
    run: async (c) => {
      resetThrottle(c);
      await toCheckout(c, { items: [1, 9] });
      await fillCo(c);
      const undo = await c.failRequests((r) => /\/checkout$/.test(r.url()), { delay: 2500 });
      const w = watch(c);
      await stubWa(c);
      const f = co(c);
      await f.place.click();
      await sleep(500);
      c.obs.flag('buttonDisabledWhileSending', !(await f.place.isEnabled().catch(() => true)));
      c.obs.enum('statusWhileSending', norm(await f.status.innerText().catch(() => null)));
      await f.place.click({ force: true, timeout: 800 }).catch(() => {});
      await sleep(3500);
      await undo();
      c.obs.num('submitRequests', w.reqs.filter((r) => r.route === 'checkout').length);
    },
  });
  add({
    id: 'co.dialog-keyboard',
    title: 'Checkout dialog: Escape, focus trap, focus return',
    tags: ['co', 'kbd'],
    run: async (c) => {
      const f = await toCheckout(c, { items: [1, 9] });
      const inside = () =>
        c.page.evaluate(
          () =>
            !!document.activeElement?.closest(
              '.sf-modal-card, [data-modal-card], .sf-checkout, .sf-drawer',
            ),
        );
      let stayed = true;
      for (let i = 0; i < 14; i++) {
        await c.page.keyboard.press('Tab');
        if (!(await inside())) stayed = false;
      }
      c.obs.flag('tabStaysInside', stayed);
      await c.page.keyboard.press('Escape');
      await sleep(300);
      c.obs.enum('modalAfterEscape', await T(c).modal());
      c.obs.enum(
        'drawerAfterEscape',
        await c.page.evaluate(() =>
          [...document.querySelectorAll('.sf-drawer')].map((d) => d.dataset.open).join(','),
        ),
      );
      c.obs.enum(
        'focusAfter',
        await c.page.evaluate(
          () =>
            document.activeElement?.tagName +
            '/' +
            (document.activeElement?.getAttribute('aria-label') || '').slice(0, 12),
        ),
      );
      void f;
    },
  });
  add({
    id: 'co.reopen-keeps-values',
    title: 'Close and reopen the checkout: are typed values kept',
    tags: ['co'],
    run: async (c) => {
      const f = await toCheckout(c, { items: [1, 9] });
      await fillCo(c, { note: 'hello' });
      await c.page.keyboard.press('Escape');
      await sleep(300);
      await c.page.keyboard.press('Escape');
      await sleep(300);
      await openCart(c);
      await c.page.getByRole('button', { name: /Order on WhatsApp/ }).dispatchEvent('click');
      await sleep(400);
      const g = co(c);
      c.obs.enum('name', await g.name.inputValue());
      c.obs.enum('note', await g.note.inputValue());
      void f;
    },
  });
  add({
    id: 'co.stale-cart-price',
    title: 'Cart line with a tampered price: the order total is derived on the server',
    tags: ['co', 'edge'],
    run: async (c) => {
      resetThrottle(c);
      await go(c, '/s/stp-aurora');
      await addBtn(c, 1).click();
      await sleep(200);
      const key = await c.page.evaluate(() =>
        [...Array(localStorage.length).keys()]
          .map((i) => localStorage.key(i))
          .find((k) => k.startsWith('sf_cart_')),
      );
      await c.page.evaluate((k) => {
        const v = JSON.parse(localStorage.getItem(k));
        v.forEach((l) => {
          l.price = 1;
          l.qty = 2;
        });
        localStorage.setItem(k, JSON.stringify(v));
      }, key);
      await page_reload(c);
      await openCart(c);
      await c.page.getByRole('button', { name: /Order on WhatsApp/ }).dispatchEvent('click');
      await sleep(400);
      await fillCo(c, { coupon: '' });
      await c.page.locator('input[type=radio][value=cod]').check({ force: true });
      await placeAndObserve(c, { before: maxOrder(c) });
    },
  });
  add({
    id: 'co.nonumber-shop',
    title: 'Shop without a sending number: order placed dialog with the tracking link',
    tags: ['co'],
    run: async (c) => {
      resetThrottle(c);
      await go(c, '/s/stp-nonumber');
      await c.page.locator('button:has-text("Add to cart")').first().click();
      await sleep(200);
      await openCart(c);
      await c.page.getByRole('button', { name: /Order on WhatsApp/ }).dispatchEvent('click');
      await sleep(400);
      await fillCo(c);
      await c.page
        .locator('input[type=radio][value=cod]')
        .check({ force: true })
        .catch(() => {});
      const r = await placeAndObserve(c, { before: maxOrder(c) });
      c.obs.enum(
        'dialog',
        await T(c)
          .modal()
          .then((m) =>
            (m || '')
              .replace(/order\/[A-Za-z0-9]+/g, 'order/TOKEN')
              .replace(/https?:\/\/[^/ ]+/g, 'HOST'),
          ),
      );
      void r;
    },
  });
  add({
    id: 'co.sold-out-after-add',
    title: 'Product turned out of stock between adding and ordering',
    tags: ['co', 'edge'],
    run: async (c) => {
      resetThrottle(c);
      await toCheckout(c, { items: [4] });
      const sql = (v) =>
        c.side === 'threadwise'
          ? mysql(`update wa_products set stock_qty=${v} where id=910004`)
          : psql(`update wa_products set stock_qty=${v} where id=910004 and org_id=${orgSql}`);
      try {
        sql(0);
        c.onCleanup(() => sql(1));
        await fillCo(c);
        await placeAndObserve(c, { before: maxOrder(c) });
      } finally {
        sql(1);
      }
    },
  });
  add({
    id: 'co.product-removed-after-add',
    title: 'Product archived between adding and ordering',
    tags: ['co', 'edge'],
    run: async (c) => {
      resetThrottle(c);
      await toCheckout(c, { items: [3] });
      const sql = (v) =>
        c.side === 'threadwise'
          ? mysql(`update wa_products set status='${v}' where id=910003`)
          : psql(`update wa_products set status='${v}' where id=910003 and org_id=${orgSql}`);
      try {
        sql('archived');
        await fillCo(c);
        await placeAndObserve(c, { before: maxOrder(c) });
      } finally {
        sql('active');
      }
    },
  });
  add({
    id: 'co.mobile-layout',
    title: 'Checkout at 390px: fits the viewport, button reachable',
    tags: ['co', 'responsive'],
    run: async (c) => {
      await c.page.setViewportSize({ width: 390, height: 844 });
      const f = await toCheckout(c, { items: [1, 9] });
      c.obs.set(
        'low.overflowX.mobile',
        await c.page.evaluate(() =>
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 ? 1 : 0,
        ),
      );
      await f.place.scrollIntoViewIfNeeded();
      const box = await f.place.boundingBox();
      c.obs.flag('placeInViewport', !!box && box.x >= 0 && box.x + box.width <= 391);
      c.obs.flag(
        'toastCoversPlace',
        await c.page.evaluate(() => {
          const t = document.querySelector('#sf-toast, .sf-toast');
          const b = [...document.querySelectorAll('button')].find((x) =>
            /Place order/.test(x.textContent),
          );
          if (!t || !b) return false;
          const r = b.getBoundingClientRect();
          const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return !!e?.closest('#sf-toast, .sf-toast');
        }),
      );
      await c.shot('mobile-checkout');
    },
  });
  // abandoned-cart beacon
  const beaconPhones = {
    six: '123456',
    seven: '1234567',
    normal: '+91 98765 43210',
    letters: 'abcdefghij',
    spaces: '      ',
    dashes: '1-2-3-4-5-6-7',
  };
  for (const [k, ph] of Object.entries(beaconPhones))
    add({
      id: `co.beacon-${k}`,
      title: `Abandoned-cart beacon on leaving a phone of kind ${k}`,
      tags: ['co', 'beacon'],
      run: async (c) => {
        resetThrottle(c);
        const f = await toCheckout(c, { items: [1, 9] });
        const w = watch(c);
        const n0 = recoveriesCount(c);
        await f.name.fill('Beacon Tester');
        await f.phone.fill(ph);
        await f.phone.blur();
        await sleep(900);
        const first = w.reqs.filter((r) => r.route === 'abandon');
        await f.phone.focus();
        await f.phone.fill(ph + '0');
        await f.phone.blur();
        await sleep(700);
        c.obs.num('beaconsAfterFirstBlur', first.length);
        c.obs.num('beaconsAfterSecondBlur', w.reqs.filter((r) => r.route === 'abandon').length);
        const b = first[0]?.body;
        if (b) {
          c.obs.enum('body.name', sk(b, 'name'));
          c.obs.enum('body.phone', sk(b, 'phone'));
          c.obs.num('body.items', (b.items || []).length);
          c.obs.seq(
            'body.keys',
            Object.keys(b)
              .map((x) => x.replace(/_/g, '').toLowerCase())
              .sort(),
          );
        }
        const res = w.res.filter((r) => r.route === 'abandon')[0];
        if (res) c.obs.enum('statusClass.abandon', cls(res.status));
        c.obs.num('recoveryRows', recoveriesCount(c) - n0);
      },
    });
  add({
    id: 'co.beacon-server-error',
    title: 'Beacon fails: the checkout keeps working silently',
    tags: ['co', 'beacon', 'fail'],
    run: async (c) => {
      resetThrottle(c);
      const f = await toCheckout(c, { items: [1, 9] });
      const undo = await c.failRequests((r) => /\/abandon$/.test(r.url()), 500);
      await f.phone.fill('+91 98765 43210');
      await f.phone.blur();
      await sleep(800);
      await undo();
      c.obs.flag('formStillThere', await f.place.isVisible());
      c.obs.flag(
        'noVisibleError',
        !(norm(await f.status.innerText().catch(() => '')) || '').length,
      );
    },
  });

  // ===== H. review form =================================================================================================
  const reviewTab = async (c, g = 1) => {
    await go(c, `/s/stp-aurora/p/stp-item-${g}`);
    await c.page.locator('.sf-tabs-head button').nth(2).click();
    await sleep(200);
    const pane = c.page.locator('.sf-tabs-pane:visible');
    return {
      pane,
      btn: pane.getByRole('button', { name: 'Submit review' }),
      msg: pane.locator('#rv-msg, .sf-form-msg').first(),
      name: pane.locator('#rv-name, .sf-review-form input').first(),
      rating: pane.locator('select').first(),
      body: pane.locator('textarea').first(),
    };
  };
  const submitReview = async (c, vals, g = 1, { dbl = false } = {}) => {
    resetThrottle(c);
    const r = await reviewTab(c, g);
    const w = watch(c);
    const before = maxReview(c);
    if (vals.name != null) await r.name.fill(vals.name);
    if (vals.rating != null) await r.rating.selectOption(String(vals.rating)).catch(() => {});
    if (vals.body != null) await r.body.fill(vals.body);
    if (dbl) await r.btn.dblclick();
    else await r.btn.click();
    await sleep(1400);
    c.obs.enum('msg', norm(await r.msg.innerText().catch(() => null)));
    c.obs.num('submitRequests', w.reqs.filter((x) => x.route === 'review').length);
    const res = w.res.filter((x) => x.route === 'review').pop();
    if (res) c.obs.enum('statusClass.review', cls(res.status));
    c.obs.enum(
      'outcome',
      res
        ? res.status < 300
          ? 'accepted'
          : 'rejected-server'
        : w.reqs.length
          ? 'no-response'
          : 'rejected-client',
    );
    const rows = reviewsAfter(c, before);
    c.obs.num('rowsCreated', rows.length);
    c.obs.set('map.stored', flat(rows));
    c.obs.enum('nameAfter', await r.name.inputValue().catch(() => null));
    c.obs.enum('bodyAfter', await r.body.inputValue().catch(() => null));
    const body = c.rec.events.http.length;
    void body;
    await xssFlag(c);
    return r;
  };
  add({
    id: 'review.form-structure',
    title: 'Review form fields: rating options, limits',
    tags: ['review'],
    run: async (c) => {
      const r = await reviewTab(c);
      c.obs.seq(
        'ratingOptions',
        await r.rating
          .locator('option')
          .evaluateAll((o) => o.map((x) => x.value + ':' + x.textContent.trim())),
      );
      c.obs.enum('ratingDefault', await r.rating.inputValue());
      c.obs.enum(
        'limits',
        JSON.stringify(
          await c.page.evaluate(() => ({
            name: document.querySelector('#rv-name, .sf-review-form input')?.maxLength,
            body: document.querySelector('.sf-tabs-pane:not([hidden]) textarea')?.maxLength,
          })),
        ),
      );
      c.obs.enum('listText', norm(await r.pane.innerText()));
    },
  });
  const reviewNames = {
    empty: '',
    spaces: '    ',
    typical: 'Pat Tester',
    one: 'P',
    max120: 'n'.repeat(120),
    over120: 'n'.repeat(121),
    long500: 'n'.repeat(500),
    unicode: 'Zoë 李雷',
    emoji: 'Pat 🎉',
    rtl: 'مرحبا',
    html: '<b>bold</b>',
    script: '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>',
    sql: "Robert'); DROP TABLE x;--",
    newline: 'a\nb',
    zw: 'ab\u200bcd',
    padded: '  Pat  ',
  };
  for (const [k, v] of Object.entries(reviewNames))
    add({
      id: `review.name-${k}`,
      title: `Review name: ${k}`,
      tags: ['review', 'edge', ...(/script|html/.test(k) ? ['xss'] : [])],
      run: async (c) => {
        await submitReview(c, { name: v, rating: 4, body: 'Good value' });
      },
    });
  const reviewBodies = {
    empty: '',
    spaces: '   ',
    typical: 'Nice and warm',
    one: 'x',
    max1000: 'b'.repeat(1000),
    over1000: 'b'.repeat(1001),
    over2000: 'b'.repeat(2001),
    over5000: 'b'.repeat(5001),
    unicode: 'Très bien 李雷',
    emoji: '🎉🚀',
    html: 'Nice <b>stuff</b> <a href="javascript:alert(1)">x</a>',
    script: '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>',
    newline: 'line one\nline two',
    sql: "'; --",
    url: 'see https://example.com/?a=1&b=2',
    nul: 'a\u0000b',
  };
  for (const [k, v] of Object.entries(reviewBodies))
    add({
      id: `review.body-${k}`,
      title: `Review body: ${k}`,
      tags: ['review', 'edge', ...(/script|html/.test(k) ? ['xss'] : [])],
      run: async (c) => {
        await submitReview(c, { name: 'Body Tester', rating: 5, body: v });
      },
    });
  for (const rt of [1, 2, 3, 4, 5])
    add({
      id: `review.rating-${rt}`,
      title: `Review rating ${rt}`,
      tags: ['review'],
      run: async (c) => {
        await submitReview(c, { name: 'Rating Tester', rating: rt, body: 'ok' });
      },
    });
  add({
    id: 'review.rating-tampered',
    title: 'Rating forced to 0, 6 and a word in the select',
    tags: ['review', 'edge'],
    run: async (c) => {
      for (const v of ['0', '6', 'x', '-1', '4.5']) {
        resetThrottle(c);
        const r = await reviewTab(c);
        await r.name.fill('Tamper');
        await r.rating.evaluate((s, val) => {
          const o = document.createElement('option');
          o.value = val;
          o.textContent = val;
          s.appendChild(o);
          s.value = val;
        }, v);
        const w = watch(c);
        const before = maxReview(c);
        await r.btn.click();
        await sleep(1200);
        const rows = reviewsAfter(c, before);
        c.obs.enum(
          `rating.${v}.status`,
          String(w.res.filter((x) => x.route === 'review').pop()?.status ?? 'none'),
        );
        c.obs.enum(`rating.${v}.stored`, JSON.stringify(rows.map((x) => x.rating)));
      }
    },
  });
  add({
    id: 'review.double-submit',
    title: 'Submit review clicked twice',
    tags: ['review', 'double'],
    run: async (c) => {
      await submitReview(c, { name: 'Twice', rating: 5, body: 'once or twice' }, 1, { dbl: true });
    },
  });
  add({
    id: 'review.other-product',
    title: 'Review on another product and on a sold-out one',
    tags: ['review'],
    run: async (c) => {
      await submitReview(c, { name: 'Other', rating: 3, body: 'x' }, 2);
    },
  });
  add({
    id: 'review.server-error',
    title: 'Review while the server answers 500',
    tags: ['review', 'fail'],
    run: async (c) => {
      resetThrottle(c);
      const r = await reviewTab(c);
      await r.name.fill('Err Tester');
      await r.body.fill('keep me');
      const undo = await c.failRequests((x) => /\/review$/.test(x.url()), 500);
      await r.btn.click();
      await sleep(1200);
      await undo();
      c.obs.enum('msg', norm(await r.msg.innerText().catch(() => null)));
      c.obs.flag(
        'valuesKept',
        (await r.name.inputValue()) === 'Err Tester' && (await r.body.inputValue()) === 'keep me',
      );
      c.obs.flag('submitUsable', await r.btn.isEnabled());
    },
  });
  add({
    id: 'review.offline',
    title: 'Review while offline',
    tags: ['review', 'fail'],
    run: async (c) => {
      resetThrottle(c);
      const r = await reviewTab(c);
      await r.name.fill('Off Tester');
      const undo = await c.failRequests((x) => /\/review$/.test(x.url()), 'abort');
      await r.btn.click();
      await sleep(1200);
      await undo();
      c.obs.enum('msg', norm(await r.msg.innerText().catch(() => null)));
      c.obs.flag('valuesKept', (await r.name.inputValue()) === 'Off Tester');
    },
  });
  add({
    id: 'review.list-shows-only-approved',
    title: 'Only approved reviews and the average are shown; markup is text',
    tags: ['review', 'xss'],
    run: async (c) => {
      const r = await reviewTab(c);
      c.obs.enum('pane', norm(await r.pane.innerText()));
      c.obs.flag('rawBoldInserted', (await c.page.locator('.sf-tabs-pane b').count()) > 0);
      c.obs.enum(
        'summary',
        norm(
          await c.page
            .locator('.sf-pd-top, .sf-pd-rating, .sf-pd-info')
            .first()
            .innerText()
            .catch(() => ''),
        ).slice(0, 200),
      );
    },
  });

  // ===== I. keyboard ====================================================================================================
  add({
    id: 'kbd.home-tab-order',
    title: 'Home page: Tab order through header, filters and the first cards',
    tags: ['kbd'],
    run: async (c) => {
      await go(c, '/s/stp-aurora');
      const stops = [];
      for (let i = 0; i < 30; i++) {
        await c.page.keyboard.press('Tab');
        stops.push(
          await c.page.evaluate(() => {
            const e = document.activeElement;
            if (!e || e === document.body) return null;
            return (
              e.tagName.toLowerCase() +
              ':' +
              (
                e.getAttribute('aria-label') ||
                e.innerText ||
                e.getAttribute('placeholder') ||
                e.getAttribute('name') ||
                ''
              )
                .trim()
                .replace(/\s+/g, ' ')
                .slice(0, 24)
            );
          }),
        );
      }
      c.obs.seq(
        'stops',
        stops.map((s) => s || 'none'),
      );
    },
  });
  add({
    id: 'kbd.enter-adds-to-cart',
    title:
      'Keyboard: Enter on Add to cart, then the cart button opens the drawer and Escape closes it',
    tags: ['kbd'],
    run: async (c) => {
      await go(c, '/s/stp-aurora');
      await addBtn(c, 1).focus();
      await c.page.keyboard.press('Enter');
      await sleep(250);
      c.obs.enum('badge', await T(c).badge());
      await cartBtn(c).focus();
      await c.page.keyboard.press('Enter');
      await sleep(400);
      c.obs.flag('drawerOpen', (await c.page.locator('.sf-cart-row').count()) > 0);
      c.obs.enum(
        'focusInside',
        await c.page.evaluate(() => !!document.activeElement?.closest('.sf-drawer')),
      );
      for (let i = 0; i < 12; i++) await c.page.keyboard.press('Tab');
      c.obs.flag(
        'trapped',
        await c.page.evaluate(() => !!document.activeElement?.closest('.sf-drawer')),
      );
      await c.page.keyboard.press('Escape');
      await sleep(300);
      c.obs.enum(
        'focusAfterClose',
        await c.page.evaluate(() =>
          (
            document.activeElement?.getAttribute('aria-label') ||
            document.activeElement?.tagName ||
            ''
          ).slice(0, 12),
        ),
      );
    },
  });
  add({
    id: 'kbd.modal-focus',
    title: 'Keyboard: quick view dialog traps focus and Escape returns it',
    tags: ['kbd'],
    run: async (c) => {
      await go(c, '/s/stp-aurora');
      await c.page.locator('.sf-quick').first().focus();
      await c.page.keyboard.press('Enter');
      await sleep(450);
      c.obs.flag('modalOpen', !!(await T(c).modal()));
      c.obs.flag(
        'focusInside',
        await c.page.evaluate(
          () => !!document.activeElement?.closest('.sf-modal-card, [data-modal-card]'),
        ),
      );
      for (let i = 0; i < 10; i++) await c.page.keyboard.press('Tab');
      c.obs.flag(
        'trapped',
        await c.page.evaluate(
          () => !!document.activeElement?.closest('.sf-modal-card, [data-modal-card]'),
        ),
      );
      await c.page.keyboard.press('Escape');
      await sleep(300);
      c.obs.flag('modalClosed', !(await T(c).modal()));
      c.obs.enum(
        'focusAfter',
        await c.page.evaluate(() =>
          (document.activeElement?.className || document.activeElement?.tagName || '')
            .toString()
            .slice(0, 14),
        ),
      );
    },
  });
  add({
    id: 'kbd.tabs-product',
    title: 'Keyboard: product tabs with arrow keys',
    tags: ['kbd'],
    run: async (c) => {
      await go(c, '/s/stp-aurora/p/stp-item-1');
      await c.page.locator('.sf-tabs-head button').first().focus();
      await c.page.keyboard.press('ArrowRight');
      await sleep(150);
      c.obs.enum(
        'afterArrow',
        await c.page.evaluate(() => (document.activeElement?.textContent || '').trim()),
      );
      c.obs.enum(
        'pane',
        norm(await c.page.locator('.sf-tabs-pane:visible').first().innerText()).slice(0, 60),
      );
      await c.page.keyboard.press('Enter');
      await sleep(150);
      c.obs.enum(
        'paneAfterEnter',
        norm(await c.page.locator('.sf-tabs-pane:visible').first().innerText()).slice(0, 60),
      );
    },
  });
  add({
    id: 'kbd.skip-link-and-landmarks',
    title: 'Landmarks and heading outline of the shop home',
    tags: ['kbd'],
    run: async (c) => {
      await go(c, '/s/stp-aurora');
      rec(
        c,
        await c.page.evaluate(() => ({
          main: document.querySelectorAll('main,[role=main]').length,
          nav: document.querySelectorAll('nav,[role=navigation]').length,
          header: document.querySelectorAll('header,[role=banner]').length,
          footer: document.querySelectorAll('footer,[role=contentinfo]').length,
          h1: document.querySelectorAll('h1').length,
          imgNoAlt: [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt'))
            .length,
          btnNoName: [...document.querySelectorAll('button')].filter(
            (b) => !(b.innerText || b.getAttribute('aria-label') || b.title || '').trim(),
          ).length,
        })),
      );
    },
  });

  // ===== J. responsive ==================================================================================================
  for (const [vp, w, hgt] of [
    ['phone', 390, 844],
    ['small', 340, 700],
    ['tablet', 768, 1024],
    ['wide', 1920, 1080],
  ])
    add({
      id: `struct.responsive-${vp}`,
      title: `Home layout at ${w}px: columns, search, nav, drawer width`,
      tags: ['struct', 'responsive'],
      run: async (c) => {
        await c.page.setViewportSize({ width: w, height: hgt });
        await go(c, '/s/stp-aurora');
        rec(
          c,
          await c.page.evaluate((w) => {
            const vis = (e) => {
              const r = e.getBoundingClientRect();
              const s = getComputedStyle(e);
              return (
                r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'
              );
            };
            const grid = document.querySelector('[data-product-grid], .sf-grid');
            return {
              cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : null,
              searchVisible:
                !!document.querySelector('.sf-search') && vis(document.querySelector('.sf-search')),
              navVisible: [...document.querySelectorAll('header nav a, .sf-nav a')].some(vis),
              overflowX:
                document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
              filtersWidth:
                Math.round(
                  document.querySelector('.sf-filters, aside')?.getBoundingClientRect().width ?? -1,
                ) >
                w * 0.9
                  ? 'full'
                  : 'side',
            };
          }, w),
        );
        await openCart(c);
        c.obs.enum(
          'drawerWidth',
          await c.page.evaluate(() => {
            const d = document.querySelector('.sf-drawer');
            return d
              ? Math.round((d.getBoundingClientRect().width / window.innerWidth) * 100) + '%'
              : null;
          }),
        );
        await c.shot('responsive');
      },
    });
  add({
    id: 'struct.zoom-200',
    title: 'Home at 200% zoom (viewport 683px): no horizontal overflow',
    tags: ['struct', 'responsive'],
    run: async (c) => {
      await c.page.setViewportSize({ width: 683, height: 450 });
      await go(c, '/s/stp-aurora');
      c.obs.set(
        'low.overflowX.zoom200',
        await c.page.evaluate(() =>
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 ? 1 : 0,
        ),
      );
    },
  });
  add({
    id: 'struct.rtl-text',
    title: 'Shop shown with dir=rtl on the document: layout does not break',
    tags: ['struct', 'responsive'],
    run: async (c) => {
      await go(c, '/s/stp-aurora');
      await c.page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
      await sleep(200);
      c.obs.set(
        'low.overflowX.rtl',
        await c.page.evaluate(() =>
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 ? 1 : 0,
        ),
      );
    },
  });

  // ===== K. failure states of the page itself ===========================================================================
  add({
    id: 'fail.shop-offline-after-load',
    title: 'Cart, filters and drawers keep working after the network drops',
    tags: ['fail'],
    run: async (c) => {
      await go(c, '/s/stp-aurora');
      await c.context.setOffline(true);
      await addBtn(c, 1).click();
      await sleep(250);
      c.obs.enum('badge', await T(c).badge());
      await c.page.locator('.sf-search input').fill('mug');
      await sleep(350);
      c.obs.enum('count', await count(c));
      await openCart(c);
      c.obs.num('rows', (await T(c).cartRows()).length);
      await c.context.setOffline(false);
    },
  });
  add({
    id: 'fail.home-500-on-assets',
    title: 'Images fail to load: placeholders, no broken layout',
    tags: ['fail'],
    run: async (c) => {
      const undo = await c.failRequests((r) => r.resourceType() === 'image', 'abort');
      await go(c, '/s/stp-aurora');
      c.obs.num('cards', await c.page.locator('.sf-card, .card').count());
      c.obs.set(
        'low.overflowX.noimages',
        await c.page.evaluate(() =>
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 ? 1 : 0,
        ),
      );
      await undo();
    },
  });
  add({
    id: 'fail.javascript-disabled',
    title: 'Without JavaScript the shop still renders its catalog',
    tags: ['fail'],
    run: async (c) => {
      const h2 = await c.openAlso({ viewport: { width: 1280, height: 800 } });
      await h2.context.close().catch(() => {});
      const ctx = await c.sideObj.browser.newContext({ javaScriptEnabled: false, locale: 'en-US' });
      if (c.side === 'ours') await ctx.addCookies([consent(c)]);
      const p = await ctx.newPage();
      const r = await p.goto(c.url('/s/stp-aurora'), { waitUntil: 'load' });
      c.obs.status('load', r.status());
      c.obs.num('cards', await p.locator('.sf-card, .card').count());
      c.obs.flag('h1', (await p.locator('h1').count()) > 0);
      await ctx.close();
    },
  });
  add({
    id: 'fail.slow-home',
    title: 'Home page requests delayed: no error shown, page completes',
    tags: ['fail'],
    run: async (c) => {
      const undo = await c.failRequests((r) => r.resourceType() === 'document', { delay: 1500 });
      const r = await c.page.goto(c.url('/s/stp-aurora'), { waitUntil: 'load' });
      await undo();
      c.obs.status('load', r.status());
      c.obs.num('cards', await c.page.locator('.sf-card, .card').count());
    },
  });
  for (const rt of ['checkout', 'coupon', 'review', 'abandon'])
    add({
      id: `fail.throttle-${rt}`,
      title: `Route ${rt}: per-address limit answers 429 after the allowed number of calls`,
      tags: ['fail', 'throttle'],
      run: async (c) => {
        resetThrottle(c);
        await go(c, '/s/stp-aurora');
        const total = { checkout: 22, coupon: 32, review: 12, abandon: 32 }[rt];
        const out = await c.page.evaluate(
          async ([slug, route, n]) => {
            const res = [];
            for (let i = 0; i < n; i++) {
              const r = await fetch(`/s/${slug}/${route}`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Accept: 'application/json',
                  'X-Requested-With': 'XMLHttpRequest',
                },
                body: '{}',
              });
              res.push(r.status);
            }
            return res;
          },
          ['stp-aurora', rt, total],
        );
        const cls = (s) =>
          s === 429 ? 'throttled' : s >= 500 ? 'crash' : s >= 400 ? 'rejected' : 'ok';
        c.obs.seq('classes', out.map(cls));
        c.obs.num(
          'firstThrottled',
          out.findIndex((s) => s === 429),
        );
        resetThrottle(c);
      },
    });
  for (const [k, body] of Object.entries({
    empty: '{}',
    'not-json': 'not json',
    array: '[]',
    null: 'null',
    'huge-items': JSON.stringify({
      name: 'a',
      phone: '9876543210',
      items: Array.from({ length: 500 }, () => ({ id: 1, qty: 1 })),
    }),
    'xss-body': JSON.stringify({
      name: '<img src=x onerror=window.__xss=1>',
      phone: '9876543210',
      items: [],
    }),
  }))
    add({
      id: `fail.raw-checkout-${k}`,
      title: `Raw POST to the checkout route: ${k}`,
      tags: ['fail', 'edge'],
      run: async (c) => {
        resetThrottle(c);
        await go(c, '/s/stp-aurora');
        const r = await c.page.evaluate(
          async ([b]) => {
            const x = await fetch('/s/stp-aurora/checkout', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
              },
              body: b,
            });
            return { status: x.status, type: x.headers.get('content-type') || '' };
          },
          [body],
        );
        const cls =
          r.status === 429
            ? 'throttled'
            : r.status >= 500
              ? 'crash'
              : r.status >= 400
                ? 'rejected'
                : 'ok';
        c.obs.enum('class', cls);
        c.obs.flag('jsonAnswer', /json/.test(r.type));
        resetThrottle(c);
      },
    });
  for (const method of ['GET', 'PUT', 'DELETE'])
    add({
      id: `fail.method-${method}-checkout`,
      title: `${method} on the checkout route`,
      tags: ['fail', 'edge'],
      run: async (c) => {
        await go(c, '/s/stp-aurora');
        const st = await c.page.evaluate(
          async ([m]) =>
            (
              await fetch('/s/stp-aurora/checkout', {
                method: m,
                headers: { Accept: 'application/json' },
              })
            ).status,
          [method],
        );
        c.obs.enum('class', st >= 500 ? 'crash' : st >= 400 ? 'rejected' : 'ok');
      },
    });
  add({
    id: 'fail.csrf-less-cross-origin-post',
    title: 'Checkout route answers a POST that carries no cookies and no XHR header',
    tags: ['fail', 'edge'],
    run: async (c) => {
      resetThrottle(c);
      const r = await c.page.request.post(c.url('/s/stp-aurora/checkout'), {
        data: {},
        failOnStatusCode: false,
        headers: { 'Content-Type': 'application/json' },
      });
      const st = r.status();
      c.obs.enum(
        'class',
        st === 429 ? 'throttled' : st >= 500 ? 'crash' : st >= 400 ? 'rejected' : 'ok',
      );
      resetThrottle(c);
    },
  });

  // ===== L. XSS in text inputs and addresses (collected scenarios already tagged xss above) ================================
  add({
    id: 'xss.everything-at-once',
    title: 'One script payload in every shop input, then all pages it can reach',
    tags: ['xss'],
    run: async (c) => {
      resetThrottle(c);
      const P = '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>';
      const f = await toCheckout(c, { items: [1, 9] });
      await fillCo(c, { name: P, phone: '9876543210', addr: P, note: P, coupon: P.slice(0, 60) });
      await f.apply.click().catch(() => {});
      await sleep(900);
      await xssFlag(c, 'sec.xssAfterCoupon');
      const r = await placeAndObserve(c, { before: maxOrder(c) });
      if (r.token) await openTracking(c, r.token);
      await reviewTab(c).then(async (rv) => {
        await rv.name.fill(P);
        await rv.body.fill(P);
        await rv.btn.click();
        await sleep(1200);
      });
      await go(c, '/s/stp-aurora/p/stp-item-1');
      await c.page.locator('.sf-tabs-head button').nth(2).click();
      await sleep(250);
      await xssFlag(c, 'sec.xssAfterReviewPage');
    },
  });

  return {
    feature: FEATURE,
    title:
      'Public shop: home (8 themes), product, cart, checkout, coupon, tracking, review, beacon, 404, lists, keyboard, a11y, failures',
    pages: [],
    scenarios: listMode ? scenarios : scenarios,
    intended: [
      {
        scenario: /^struct\.notfound-page2$/,
        key: /^(enum\.count|num\.cards)$/,
        quirk: 'drafts',
        reason:
          'drafts are not public on ours (D-03): the second page holds 10 products where Reference lists the draft too (11)',
      },
      {
        scenario: /^(cart\.stepper-value-(7|15)|misc\.product-qty-99999)$/,
        key: /^enum\.(footer|ls|rows|toast)$/,
        reason:
          'ours holds at most 999 of a product on one line (contract limit STORE_CART_MAX_QTY, shown as "Limit reached"); Reference lets a line grow without bound and only the server decides at checkout',
      },
      {
        scenario: /^misc\.product-qty-/,
        key: /^enum\.(qtyShown|rows)$/,
        reason:
          'ours turns a typed quantity into a whole number from 1 and shows it (zero, negative, decimal or empty add one); Reference keeps the typed text and a zero or negative quantity adds nothing because its add routine subtracts',
      },
      {
        scenario: /^struct\.home-meridian$/,
        key: /^enum\.(bodyFont|h1Font)$/,
        reason:
          'fallback family only: ours ends the Fraunces stack with Georgia, serif where Reference writes serif on this theme; Fraunces is self-hosted, so the fallback is never shown unless the font file fails',
      },
      {
        scenario: /^kbd\.(enter-adds-to-cart|modal-focus)$/,
        key: /^(enum\.focusInside|flag\.focusInside|flag\.trapped|enum\.focusAfterClose|enum\.focusAfter)$/,
        reason:
          'ours moves focus into an opened drawer or dialog, keeps it inside and returns it to the opener on close (accessibility behaviour); Reference leaves focus on the page behind',
      },
      {
        scenario: /^kbd\.tabs-product$/,
        key: /^enum\.(afterArrow|pane|paneAfterEnter)$/,
        reason:
          'ours uses the ARIA tabs pattern (arrow keys move between tabs, one tab stop); Reference tab buttons ignore arrow keys',
      },
      {
        scenario: /^kbd\.skip-link-and-landmarks$/,
        key: 'num.main',
        reason: 'ours wraps the shop in a main landmark (accessibility addition); Reference has none',
      },

      {
        scenario: /^pages\.(disabled|unknown|noproduct|noorder)\.(load|degraded)$/,
        key: /^low\.(degraded\.)?pageErrors$/,
        quirk: 'next-dev-notfound',
        reason:
          'under next dev, React 19 dev profiling throws "cannot have a negative time stamp" when an async server component calls notFound() after an await (reproduced with any async page, also after moving notFound into the route component); the 404 renders and the status is right; production builds have no dev profiler. Not verified on a production build.',
      },
      {
        scenario: /^pages\..*\.keyboard$/,
        key: 'flag.keyboard.skipLink',
        reason:
          'ours adds a "Skip to content" link as the first tab stop (accessibility addition, documented in the public-shop parity notes); Reference has none',
      },
      {
        scenario: /^pages\..*\.keyboard$/,
        key: 'abs.keyboard.reachable',
        reason:
          'Reference tabs into its closed off-screen cart, wishlist, compare and checkout panels and into a duplicate image link per card and every tab button; ours makes closed panels inert, drops the duplicate image link from the tab order and uses the ARIA tabs pattern (one tab stop, arrow keys; covered by kbd.tabs-product), so fewer stops are reachable',
      },

      {
        scenario: /^struct\.home-/,
        key: 'enum.countText',
        quirk: 'drafts',
        reason:
          'drafts are not public on ours (decision D-03): the seeded catalog counts 58 products where Reference lists the draft too (59)',
      },
      {
        scenario: /^list\.(search|filter|sort|price)/,
        key: /^enum\.count|enum\.noResults|enum\.countAfterReload/,
        quirk: 'drafts',
        reason:
          'drafts are not public on ours (D-03): the draft product is one more hit on Reference when a filter matches it',
      },
      {
        scenario: /^list\.show-more/,
        key: /./,
        quirk: 'show-more',
        reason:
          'Reference Show more fails with HTTP 500 and removes the button (QUIRK, documented); ours loads page 2 as the inventory specifies',
      },
      {
        scenario: /^misc\.share$/,
        key: /^enum\.modal$|^seq\.links$/,
        quirk: 'share',
        reason:
          'Reference prints stray attribute text in the dialog and loads the QR from a third party; ours is clean and local',
      },
      {
        scenario: /^struct\.notfound-|^struct\.product-aurora-60$/,
        key: /^enum\.(text|title)$/,
        reason:
          'the 404 screen shows the platform brand name from the site settings instead of the Reference product name',
      },
      {
        scenario: /^struct\.product-aurora-60$/,
        key: /./,
        quirk: 'drafts',
        reason: 'a draft product has no public page on ours (D-03); Reference serves it',
      },
      {
        scenario: /^struct\.notfound-(draftProduct)$/,
        key: /./,
        quirk: 'drafts',
        reason: 'a draft product has no public page on ours (D-03); Reference serves it',
      },
      {
        scenario: /^struct\.home-scroll-header$/,
        key: 'num.headerTop',
        quirk: 'sticky-header',
        reason:
          'Reference declares the header sticky but overflow-x hidden on html and body stops it in every browser; ours stays sticky as the CSS intends',
      },
      {
        scenario: /^struct\.hidden-toast-pointer$/,
        key: 'enum.pointerEvents',
        quirk: 'toast-taps',
        reason:
          'Reference toast keeps catching taps when hidden (no pointer-events none); ours lets them through',
      },
      {
        scenario: /^co\./,
        key: 'enum.rto',
        quirk: 'rto-lookup',
        reason:
          'Reference compares digits with a stored phone that contains a plus sign, so it never finds history; ours does',
      },
    ],
    skip: [
      {
        scenario: /^pages\..*\.perf$/,
        side: 'both',
        reason:
          'against next dev the timing of the first compile dominates; production-build timing is not comparable',
      },
    ],
    severity: {},
  };
};
