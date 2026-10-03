// Runs the same behavioural probes (cart, stock caps, shipping, coupons, checkout hand-off, lists, wishlist and compare, quick view,
// product page, review, SEO tags, 404s, tracking pages) on the reference and on our shop and prints the differing results.
//   node parity-behave.mjs [probe]      env: REF OURS PLAYWRIGHT_DIR; results as JSON in ./beh/
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(
  process.env.PLAYWRIGHT_DIR ??
    new URL('../../../../../.claude/skills/threadwise-playwright-parity/harness/', import.meta.url)
      .pathname,
);
const { chromium } = require('playwright');
const BASES = {
  ref: process.env.REF ?? 'http://127.0.0.1:8000',
  ours: process.env.OURS ?? 'http://localhost:3109',
};
const only = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const results = { ref: {}, ours: {} };
const T = (page) => ({
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
    page
      .locator('.sf-cart-row')
      .evaluateAll((rs) =>
        rs.map((r) => ({
          name: r.querySelector('.sf-cart-name')?.textContent.trim(),
          price: r.querySelector('.sf-cart-price')?.textContent.trim(),
          qty: r.querySelector('.sf-qty input')?.value,
        })),
      ),
  footer: async () => {
    const f = page.locator('.sf-drawer-foot');
    return (await f.first().innerText()).replace(/\s+/g, ' ').trim();
  },
  badge: async () => {
    const b = page.locator(
      'button[aria-label^="Cart"] [data-cart-count], button[aria-label^="Cart"] .sf-badge',
    );
    return (await b.count()) ? (await b.first().innerText()).trim() : '0';
  },
  ls: async (side) =>
    page.evaluate(() => {
      const o = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith('sf_'))
          o[k.replace(/\d+$/, '#').replace(/stp-[a-z]+$/, '#')] = localStorage.getItem(k);
      }
      return o;
    }),
});
async function open(page, side, path) {
  await page.goto(BASES[side] + path, { waitUntil: 'networkidle' });
  await page.addStyleTag({
    content:
      '*{transition:none!important;animation:none!important} nextjs-portal{display:none!important}',
  });
  const dec = page.getByRole('button', { name: 'Decline' });
  if (side === 'ours') {
    await dec
      .first()
      .waitFor({ timeout: 2500 })
      .catch(() => {});
  }
  if (await dec.count())
    await dec
      .first()
      .click()
      .catch(() => {});
  await page.mouse.move(2, 2);
}
const addBtn = (page, i) => page.locator('button:has-text("Add to cart")').nth(i);
const cardIdx = (n) => n - 1; // product g -> index on page 1 (g=6 missing so >6 shifts)
const idx = (g) => (g < 6 ? g - 1 : g - 2);
const probes = {
  async cart(page, side, t) {
    const out = {};
    await open(page, side, '/s/stp-aurora');
    await addBtn(page, idx(1)).click();
    await sleep(200);
    out.toastAdd = await t.toast();
    await addBtn(page, idx(1)).click();
    await sleep(200);
    out.badge = await t.badge();
    await page.reload({ waitUntil: 'networkidle' });
    out.badgeAfterReload = await t.badge();
    out.ls = Object.values(await t.ls()).map((v) =>
      JSON.parse(v).map((l) => ({ name: l.name, price: l.price, qty: l.qty, image: !!l.image })),
    );
    // stock 1 product (g=4)
    await addBtn(page, idx(4)).click();
    await sleep(200);
    await addBtn(page, idx(4)).click();
    await sleep(300);
    out.stock1Modal = await t.modal();
    await page.keyboard.press('Escape');
    await sleep(200);
    // stock 0 (g=12)
    await addBtn(page, idx(12)).click();
    await sleep(300);
    out.stock0Modal = await t.modal();
    await page.keyboard.press('Escape');
    await sleep(200);
    // stock 3 (g=2): add 3 then 4th
    for (let i = 0; i < 4; i++) {
      await addBtn(page, idx(2)).click();
      await sleep(150);
    }
    out.stock3Modal = await t.modal();
    await page.keyboard.press('Escape');
    await sleep(200);
    await page.locator('button[aria-label^="Cart"]').first().click();
    await sleep(400);
    out.rows = await t.cartRows();
    out.footer = await t.footer();
    // drawer stepper typing 10 on g=2
    const row = page.locator('.sf-cart-row').filter({ hasText: 'Canvas Tote 2' });
    const inp = row.locator('.sf-qty input');
    await inp.fill('10');
    await inp.blur();
    await sleep(300);
    out.afterType10 = await row.locator('.sf-qty input').inputValue();
    out.toastType = await t.toast();
    // increase on a no-stock-limit product beyond: set qty 0 -> min1
    const row1 = page.locator('.sf-cart-row').filter({ hasText: 'Clay Mug 1' });
    await row1.locator('.sf-qty input').fill('0');
    await row1.locator('.sf-qty input').blur();
    await sleep(300);
    out.afterType0 = await page
      .locator('.sf-cart-row')
      .filter({ hasText: 'Clay Mug 1' })
      .locator('.sf-qty input')
      .inputValue();
    await page
      .locator('.sf-cart-row')
      .filter({ hasText: 'Clay Mug 1' })
      .locator('.sf-qty button')
      .nth(1)
      .click();
    await sleep(200);
    out.afterInc = await page
      .locator('.sf-cart-row')
      .filter({ hasText: 'Clay Mug 1' })
      .locator('.sf-qty input')
      .inputValue();
    await page.locator('.sf-cart-row').first().locator('.sf-cart-remove').click();
    await sleep(200);
    out.rowsAfterRemove = (await t.cartRows()).length;
    return out;
  },
  async shipping(page, side, t) {
    const out = {};
    await open(page, side, '/s/stp-aurora');
    const price = {}; // add product 1 (109) x1, then check
    await addBtn(page, idx(1)).click();
    await sleep(150);
    await page.locator('button[aria-label^="Cart"]').first().click();
    await sleep(300);
    out.sub109 = await t.footer();
    await page.keyboard.press('Escape');
    await sleep(200);
    for (let i = 0; i < 3; i++) {
      await addBtn(page, idx(9)).click();
      await sleep(150);
    } // 9 -> 18900 each => 109+567=676 > 500
    await page.locator('button[aria-label^="Cart"]').first().click();
    await sleep(300);
    out.subFree = await t.footer();
    return out;
  },
  async checkout(page, side, t) {
    const out = {};
    await open(page, side, '/s/stp-aurora');
    await page.locator('button[aria-label^="Cart"]').first().click();
    await sleep(300);
    await page.getByRole('button', { name: /Order on WhatsApp/ }).dispatchEvent('click');
    await sleep(300);
    out.emptyModal = await t.modal();
    await page.keyboard.press('Escape');
    await sleep(200);
    await addBtn(page, idx(1)).click();
    await sleep(200);
    await addBtn(page, idx(9)).click();
    await sleep(200);
    await page.locator('button[aria-label^="Cart"]').first().click();
    await sleep(300);
    await page.getByRole('button', { name: /Order on WhatsApp/ }).dispatchEvent('click');
    await sleep(400);
    out.drawerOpenBehind = await page.evaluate(() =>
      [...document.querySelectorAll('.sf-drawer')].map((d) => d.dataset.open).join(','),
    );
    out.formText = await t.modal();
    const status = () => page.locator('#sf-co-status, .sf-status-msg').first().innerText();
    const inputs = {
      name: page.locator('#sf-co-name, .sf-checkout input[autocomplete=name]').first(),
      phone: page.locator('#sf-co-phone, .sf-checkout input[type=tel]').first(),
      addr: page.locator('#sf-co-addr, .sf-checkout textarea').first(),
      note: page
        .locator(
          '#sf-co-note, .sf-checkout .sf-field input:not([type=tel]):not([autocomplete=name]):not(.is-upper)',
        )
        .first(),
      coupon: page.locator('#sf-co-coupon, .sf-checkout input.is-upper').first(),
    };
    const place = page.getByRole('button', { name: /Place order/ });
    await place.click();
    await sleep(200);
    out.errName = await status();
    await inputs.name.fill('Asha Test');
    await place.click();
    await sleep(200);
    out.errPhone = await status();
    await inputs.phone.fill('12345');
    await place.click();
    await sleep(200);
    out.errPhoneShort = await status();
    const msg = () => page.locator('#sf-co-coupon-msg, .sf-coupon-msg').first().innerText();
    out.coupons = {};
    for (const code of ['SAVE10', 'save10', 'FLAT100', 'SHIPFREE', 'OFF', 'OLD', 'NOPE']) {
      await inputs.coupon.fill(code);
      await page.getByRole('button', { name: 'Apply' }).click();
      await sleep(1000);
      out.coupons[code] = await msg();
    }
    await inputs.coupon.fill('');
    await page.getByRole('button', { name: 'Apply' }).click();
    await sleep(300);
    out.couponClear = await msg();
    out.couponUpper = await (async () => {
      await inputs.coupon.fill('abc');
      return page.evaluate(
        (el) =>
          getComputedStyle(document.querySelector('#sf-co-coupon, .sf-checkout input.is-upper'))
            .textTransform,
      );
    })();
    out.maxlens = await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      return {
        name: q('#sf-co-name, .sf-checkout input[autocomplete=name]')?.maxLength,
        phone: q('#sf-co-phone, .sf-checkout input[type=tel]')?.maxLength,
        addr: q('#sf-co-addr, .sf-checkout textarea')?.maxLength,
        ph: q('#sf-co-phone, .sf-checkout input[type=tel]')?.placeholder,
        pay: [...document.querySelectorAll('input[type=radio]')].map(
          (r) => r.value + ':' + r.checked,
        ),
      };
    });
    // place order with COD + SAVE10, capture request & response
    await inputs.coupon.fill('SAVE10');
    await inputs.phone.fill('+91 98765 43210');
    await inputs.addr.fill('12 Test St\nBangalore');
    await inputs.note.fill('leave at door');
    await page.locator('input[type=radio][value=cod]').check();
    let req = null,
      res = null;
    page.on('request', (r) => {
      if (r.url().endsWith('/checkout') && r.method() === 'POST')
        req = JSON.parse(r.postData() || '{}');
    });
    page.on('response', async (r) => {
      if (r.url().endsWith('/checkout') && r.request().method() === 'POST')
        res = await r.json().catch(() => null);
    });
    let nav = null;
    await page.route('https://wa.me/**', (route) => {
      nav = route.request().url();
      route.fulfill({ status: 200, contentType: 'text/html', body: 'wa' });
    });
    await place.click();
    await sleep(2500);
    out.reqKeys = req ? Object.keys(req).sort() : null;
    out.reqItems = req?.items?.length;
    out.reqCoupon = req?.coupon;
    out.reqPay = req?.payment_method;
    out.reqPhone = req?.phone;
    out.reqAddr = req?.address;
    out.resKeys = res ? Object.keys(res).sort() : null;
    out.resMsg = res?.message;
    out.waUrl = nav
      ? decodeURIComponent(nav)
          .replace(/#\d+/, '#N')
          .replace(/(order\/)[A-Za-z0-9]+/, '$1TOKEN')
          .replace(/Total[^.]*\./, 'Total.')
      : null;
    out.waUrlHost = nav ? new URL(nav).pathname : null;
    out.trackUrl = res?.track_url?.replace(/order\/[A-Za-z0-9]+/, 'order/TOKEN');
    out.cartAfter = Object.values(await t.ls()).map((v) => JSON.parse(v).length);
    out.statusAfter = await status().catch(() => null);
    return out;
  },
  async lists(page, side, t) {
    const out = {};
    await open(page, side, '/s/stp-aurora');
    const names = () =>
      page
        .locator('.card:visible h3, .sf-card h3')
        .evaluateAll((es) =>
          es.filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim()),
        );
    const count = () => page.locator('.sf-count').first().innerText();
    out.count0 = await count();
    const search = page.locator('.sf-search input');
    await search.fill('mug');
    await sleep(300);
    out.searchMug = await count();
    out.searchMugFirst = (await names())[0];
    await search.fill('MUG 1');
    await sleep(300);
    out.searchMug1 = await count();
    await search.fill('zzz');
    await sleep(300);
    out.none = await count();
    out.noneMsg = await page
      .locator('[data-no-results]:visible, .sf-no-results')
      .first()
      .innerText()
      .catch(() => null);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await sleep(300);
    out.afterClear = await count();
    out.searchAfterClear = await search.inputValue();
    const sort = page.locator('.sf-toolbar select');
    await sort.selectOption('price-desc');
    await sleep(300);
    out.priceDesc = (await names()).slice(0, 3);
    await sort.selectOption('name-asc');
    await sleep(300);
    out.nameAsc = (await names()).slice(0, 3);
    await sort.selectOption('featured');
    await sleep(300);
    out.featuredAfterSort = (await names()).slice(0, 3);
    await page.getByLabel('Bags').check();
    await sleep(300);
    out.bags = await count();
    await page.getByLabel('Decor').check();
    await sleep(300);
    out.bagsDecor = await count();
    await page.getByLabel('Bags').uncheck();
    await page.getByLabel('Decor').uncheck();
    const min = page.locator('[data-filter-min], .sf-price-range input').first(),
      max = page.locator('[data-filter-max], .sf-price-range input').nth(1);
    await min.fill('200');
    await max.fill('300');
    await sleep(300);
    out.price200_300 = await count();
    await min.fill('');
    await max.fill('');
    await page.getByLabel('On sale').check();
    await sleep(300);
    out.sale = await count();
    await page.getByLabel('On sale').uncheck();
    await page.getByLabel('In stock only').uncheck();
    await sleep(300);
    out.noStockFilter = await count();
    await page.getByLabel('In stock only').check();
    await page.getByRole('button', { name: 'Reset filters' }).click();
    await sleep(200);
    // list view
    await page.locator('[data-view="list"], .sf-view-toggle button').nth(1).click();
    await sleep(200);
    out.listCols = await page.evaluate(
      () =>
        getComputedStyle(
          document.querySelector('[data-product-grid], .sf-grid'),
        ).gridTemplateColumns.split(' ').length,
    );
    await page.locator('[data-view="grid"], .sf-view-toggle button').nth(0).click();
    // show more
    const more = page.locator('[data-show-more], .sf-more-btn');
    out.moreText = (
      await page.locator('[data-show-more-wrap], .sf-more').first().innerText()
    ).replace(/\s+/g, ' ');
    await more.click();
    await sleep(1500);
    out.afterMoreCount = await count();
    out.moreGone = (await page.locator('[data-show-more], .sf-more-btn').count()) === 0;
    out.cards = await page.locator('.card, .sf-card').count();
    out.lastNames = (await names()).slice(-3);
    return out;
  },
  async wish(page, side, t) {
    const out = {};
    await open(page, side, '/s/stp-aurora');
    const wish = page.locator('.sf-wish');
    await wish.nth(0).click({ force: true });
    await sleep(150);
    out.toast1 = await t.toast();
    await wish.nth(1).click({ force: true });
    await sleep(150);
    out.wishBadge = await page
      .locator(
        'button[aria-label^="Wishlist"] [data-wish-count], button[aria-label^="Wishlist"] .sf-badge',
      )
      .first()
      .innerText();
    await wish.nth(0).click({ force: true });
    await sleep(150);
    out.toastRemove = await t.toast();
    out.ls = Object.entries(await t.ls()).map(([k, v]) => k + '=' + JSON.parse(v).length);
    await page.locator('button[aria-label^="Wishlist"]').first().click();
    await sleep(400);
    out.wishDrawer = (await page.locator('.sf-drawer-body').first().innerText()).replace(
      /\s+/g,
      ' ',
    );
    await page.keyboard.press('Escape');
    await sleep(200);
    // compare: need product page toggle; on cards compare is only on product page
    await open(page, side, '/s/stp-aurora/p/stp-item-1');
    const cmp = page.locator('.sf-pd-icons button').nth(1);
    await cmp.click();
    await sleep(150);
    out.cmpToast = await t.toast();
    // compare through related cards? only product page buttons. Add 4 other products via their pages
    for (const g of [2, 3, 4, 5]) {
      await open(page, side, `/s/stp-aurora/p/stp-item-${g}`);
      await page.locator('.sf-pd-icons button').nth(1).click();
      await sleep(250);
      if (g === 5) out.cmpFullModal = await t.modal();
    }
    await page.keyboard.press('Escape');
    await sleep(200);
    out.cmpBar = (
      await page.locator('#sf-compare-bar, .sf-compare-bar').first().innerText()
    ).replace(/\s+/g, ' ');
    await page
      .getByRole('button', { name: /^Compare/ })
      .last()
      .click()
      .catch(() => {});
    await sleep(400);
    out.cmpTable = (
      await page
        .locator('.sf-compare-table')
        .first()
        .innerText()
        .catch(() => '')
    )
      .replace(/\s+/g, ' ')
      .slice(0, 300);
    return out;
  },
  async quick(page, side, t) {
    const out = {};
    await open(page, side, '/s/stp-aurora');
    await page.locator('.sf-quick').first().click({ force: true });
    await sleep(400);
    out.quick = await t.modal();
    await page.getByRole('button', { name: 'Add to cart' }).last().click();
    await sleep(300);
    out.afterAddModal = await t.modal();
    out.toast = await t.toast();
    out.badge = await t.badge();
    await open(page, side, '/s/stp-aurora/p/stp-item-1');
    await page.locator('.sf-pd-icons button').nth(2).click();
    await sleep(400);
    out.share = await t.modal();
    out.shareLinks = await page
      .locator('a[href^="https://wa.me/?text"], a[href^="https://t.me"], a[href^="mailto:"]')
      .evaluateAll((a) =>
        a.map((x) => decodeURIComponent(x.href).replace(/https?:\/\/[^/]+\/s\/stp-aurora/, 'BASE')),
      );
    out.qr = await page
      .locator('.sf-qr summary, details summary')
      .first()
      .innerText()
      .catch(() => null);
    return out;
  },
  async product(page, side, t) {
    const out = {};
    for (const g of [1, 2, 3, 4, 12, 11, 5]) {
      await open(page, side, `/s/stp-aurora/p/stp-item-${g}`);
      out['p' + g] = await page.evaluate(() => ({
        stock: document.querySelector('.sf-pd-stock')?.textContent.trim().replace(/\s+/g, ' '),
        thumbs: document.querySelectorAll('.sf-pd-thumbs button').length,
        save: document.querySelector('.sf-pd-save')?.textContent.trim().replace(/\s+/g, ' '),
        meta: [...document.querySelectorAll('.sf-pd-meta dt')]
          .map((e) => e.textContent.trim())
          .join('|'),
        addDisabled: document.querySelector('.sf-pd-actions > .sf-cta')?.disabled,
        ask: document
          .querySelector('a.sf-cta-ghost')
          ?.getAttribute('href')
          ?.replace(/^(.*?text=)(.*)$/, (m, a, b) => a + decodeURIComponent(b)),
        tabs: [...document.querySelectorAll('.sf-tabs-head button')]
          .map((e) => e.textContent.trim())
          .join('|'),
        related: document.querySelectorAll('.sf-related .card, .sf-related .sf-card').length,
        relatedNames: [...document.querySelectorAll('.sf-related h3')]
          .map((e) => e.textContent.trim())
          .join(','),
        rvForms: document.querySelectorAll('#rv-name, .sf-review-form input').length,
        descPane: document
          .querySelector('.sf-tabs-pane')
          ?.innerText.replace(/\s+/g, ' ')
          .slice(0, 120),
        bodyHasScript: !!document.querySelector('.sf-tabs-pane script'),
        crumbs: document
          .querySelector('.breadcrumb, .sf-breadcrumb')
          ?.textContent.replace(/\s+/g, ' ')
          .trim(),
      }));
    }
    // thumbs click swap
    await open(page, side, '/s/stp-aurora/p/stp-item-1');
    const src0 = await page.locator('.sf-pd-main img').getAttribute('src');
    await page.locator('.sf-pd-thumbs button').nth(1).click();
    await sleep(150);
    const src1 = await page.locator('.sf-pd-main img').getAttribute('src');
    out.thumbSwap = src0 !== src1;
    // tabs
    await page
      .getByRole('tab', { name: 'Shipping & returns' })
      .click()
      .catch(async () => {
        await page.locator('.sf-tabs-head button').nth(1).click();
      });
    await sleep(150);
    out.shipPane = (await page.locator('.sf-tabs-pane:visible').first().innerText()).replace(
      /\s+/g,
      ' ',
    );
    await page.locator('.sf-tabs-head button').nth(2).click();
    await sleep(150);
    out.reviewsPane = (await page.locator('.sf-tabs-pane:visible').first().innerText()).replace(
      /\s+/g,
      ' ',
    );
    // qty add stock quirk on p4 (stock 1)
    await open(page, side, '/s/stp-aurora/p/stp-item-4');
    await page.locator('.sf-pd-actions .sf-qty input').fill('5');
    await page.locator('.sf-pd-actions > .sf-cta').click();
    await sleep(400);
    out.p4add5 = await t.cartRows();
    out.p4toast = await t.toast();
    out.drawerOpen = await page.evaluate(() =>
      [...document.querySelectorAll('.sf-drawer')].map((d) => d.dataset.open).join(','),
    );
    // qty stepper min 1
    await open(page, side, '/s/stp-aurora/p/stp-item-2');
    await page.locator('.sf-pd-actions .sf-qty button').first().click();
    out.qtyMin = await page.locator('.sf-pd-actions .sf-qty input').inputValue();
    await page.locator('.sf-pd-actions .sf-qty button').nth(1).click();
    out.qtyInc = await page.locator('.sf-pd-actions .sf-qty input').inputValue();
    await page.locator('.sf-pd-actions .sf-qty input').fill('9');
    await page.locator('.sf-pd-actions > .sf-cta').click();
    await sleep(300);
    out.p2add9 = await t.cartRows();
    out.p2toast = await t.toast();
    return out;
  },
  async review(page, side, t) {
    const out = {};
    await open(page, side, '/s/stp-aurora/p/stp-item-1');
    await page.locator('.sf-tabs-head button').nth(2).click();
    await sleep(150);
    const form = page.locator('.sf-tabs-pane:visible');
    const btn = form.getByRole('button', { name: 'Submit review' });
    const msg = form.locator('#rv-msg, .sf-form-msg').first();
    await btn.click();
    await sleep(300);
    out.empty = await msg.innerText();
    await form.locator('#rv-name, .sf-review-form input').first().fill('Parity Tester');
    await form.locator('select').first().selectOption('4');
    await form.locator('textarea').first().fill('Nice <b>stuff</b>');
    await btn.click();
    await sleep(1200);
    out.ok = await msg.innerText();
    out.nameCleared = await form.locator('#rv-name, .sf-review-form input').first().inputValue();
    out.ratingMaxLen = await form.locator('textarea').first().getAttribute('maxlength');
    return out;
  },
  async seo(page, side, t) {
    const out = {};
    for (const [k, path] of [
      ['home', '/s/stp-noir'],
      ['product', '/s/stp-aurora/p/stp-item-1'],
      ['product2', '/s/stp-aurora/p/stp-item-2'],
      ['order', '/s/stp-aurora/order/' + 'stptoken00'.padEnd(40, 'x')],
    ]) {
      await page.goto(BASES[side] + path, { waitUntil: 'domcontentloaded' });
      out[k] = await page.evaluate(() => {
        const m = (s) => document.querySelector(s)?.getAttribute('content');
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
            s.textContent.replace(/https?:\/\/[^/"]+/g, 'HOST'),
          ),
        };
      });
    }
    return out;
  },
  async notfound(page, side, t) {
    const out = {};
    for (const [k, path] of [
      ['disabled', '/s/stp-off'],
      ['unknown', '/s/zzz-nope'],
      ['noproduct', '/s/stp-aurora/p/nope'],
      ['draftProduct', '/s/stp-aurora/p/stp-item-60'],
      ['soldoutProduct', '/s/stp-aurora/p/stp-item-6'],
      ['noorder', '/s/stp-aurora/order/' + 'z'.repeat(40)],
      ['shortToken', '/s/stp-aurora/order/abc'],
      ['otherShopOrder', '/s/stp-meridian/order/' + 'stptoken00'.padEnd(40, 'x')],
      ['page0', '/s/stp-aurora?page=0'],
      ['pageX', '/s/stp-aurora?page=abc'],
      ['page2', '/s/stp-aurora?page=2'],
      ['pageHuge', '/s/stp-aurora?page=99'],
    ]) {
      const r = await page.goto(BASES[side] + path, { waitUntil: 'domcontentloaded' });
      out[k] = {
        status: r.status(),
        title: await page.title(),
        text: (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 160),
        count: await page
          .locator('.sf-count')
          .first()
          .innerText()
          .catch(() => null),
      };
    }
    return out;
  },
  async orders(page, side, t) {
    const out = {};
    for (const s of ['new', 'confirmed', 'paid', 'shipped', 'cancelled', 'delivered']) {
      const tok = {
        new: 'stptoken00',
        confirmed: 'stptoken01',
        paid: 'stptoken02',
        shipped: 'stptoken03',
        cancelled: 'stptoken04',
        delivered: 'stptoken05',
      }[s].padEnd(40, 'x');
      const shop = s === 'delivered' ? 'meridian' : 'aurora';
      await page.goto(BASES[side] + `/s/stp-${shop}/order/${tok}`, { waitUntil: 'networkidle' });
      out[s] = await page.evaluate(() => ({
        text: document.body.innerText.replace(/\s+/g, ' ').trim(),
        links: [...document.querySelectorAll('a')].map((a) =>
          decodeURIComponent(a.getAttribute('href') || ''),
        ),
        done: document.querySelectorAll('.step.done, .sf-ot-steps li.is-done').length,
        title: document.title,
      }));
    }
    return out;
  },
};
for (const side of ['ref', 'ours']) {
  for (const [name, fn] of Object.entries(probes)) {
    if (only && only !== name) continue;
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      results[side][name] = await fn(page, side, T(page));
    } catch (e) {
      results[side][name] = {
        ERROR:
          e.message.split('\n').slice(0, 3).join(' | ') +
          ' @' +
          (e.stack.split('\n').find((l) => l.includes('behave.mjs')) || ''),
      };
    }
    await ctx.close();
  }
}
await browser.close();
fs.mkdirSync('beh', { recursive: true });
fs.writeFileSync('beh/ref.json', JSON.stringify(results.ref, null, 1));
fs.writeFileSync('beh/ours.json', JSON.stringify(results.ours, null, 1));
const flat = (o, p = '') =>
  Object.entries(o || {}).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? flat(v, p + k + '.')
      : [[p + k, JSON.stringify(v)]],
  );
for (const name of Object.keys(results.ref)) {
  const a = Object.fromEntries(flat(results.ref[name])),
    b = Object.fromEntries(flat(results.ours[name]));
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const diffs = keys.filter((k) => a[k] !== b[k]);
  console.log(`#### ${name}: ${keys.length - diffs.length} same, ${diffs.length} differ`);
  for (const k of diffs) console.log(`  ${k}\n     ref : ${a[k]}\n     ours: ${b[k]}`);
}
