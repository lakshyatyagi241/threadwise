// Public shop end-to-end script (Playwright is not a repo dependency: set PLAYWRIGHT_DIR to a node_modules that has it).
//   1. seed:  node seed-both.mjs seed ours        (database crm_store, org slug `pubshop-e2e`, shops `stp-<theme>`)
//   2. run:   BASE=http://localhost:3109 SHOTS=/tmp/shots PLAYWRIGHT_DIR=/path/to/node_modules/ node shop.e2e.mjs
// It checks the buyer flows on the Aurora shop (desktop and phone), then walks all eight themes and takes screenshots of home,
// product, cart drawer, checkout and the tracking page at 1440 and 390 px, placing one real order per theme. Behaviour is
// WaDesk's, quirks included (see the "Public shop" section of docs/wadesk-port/parity/storefront-builder.md).
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(
  process.env.PLAYWRIGHT_DIR ??
    new URL('../../../../../.claude/skills/wadesk-playwright-parity/harness/', import.meta.url)
      .pathname,
);
const { chromium } = require('playwright');
const BASE = process.env.BASE ?? 'http://localhost:3109';
const SHOTS = process.env.SHOTS ?? '/tmp/sf-shots';
const THEMES = ['aurora', 'meridian', 'verdure', 'bazaar', 'noir', 'kraft', 'mercato', 'studio'];
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

const browser = await chromium.launch();

/** Opens a page and dismisses the platform cookie banner (root layout, not part of the shop) so it never covers a button. */
async function open(page, path) {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  const decline = page.getByRole('button', { name: 'Decline' });
  await decline
    .first()
    .waitFor({ timeout: 2500 })
    .catch(() => {});
  if (await decline.count())
    await decline
      .first()
      .click()
      .catch(() => {});
  return res;
}

async function fillCheckout(page, name = 'Asha Test') {
  await page.fill('.sf-checkout input[autocomplete=name]', name);
  await page.fill('.sf-checkout input[type=tel]', '+91 98765 43210');
  await page.fill('.sf-checkout textarea', '12 Test Street');
}

/** Places the order. The buyer is sent to wa.me (stubbed here, nothing real is opened) or sees the "Order placed" dialog. */
async function placeOrder(page) {
  let waUrl = null;
  await page.route('https://wa.me/**', (route) => {
    waUrl = route.request().url();
    route.fulfill({ status: 200, contentType: 'text/html', body: 'wa' });
  });
  await page.click('.sf-checkout button[type=submit]');
  // The hand-off navigates away to the stubbed wa.me page; without a number the "Order placed" dialog opens instead.
  for (let i = 0; i < 60 && !waUrl; i++) {
    if (
      await page
        .locator('.sf-modal-title:has-text("placed")')
        .count()
        .catch(() => 0)
    )
      break;
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(300);
  return waUrl;
}

const addBtn = (page, n = 0) => page.locator('button:has-text("Add to cart")').nth(n);
const cartButton = (page) => page.locator('button[aria-label^="Cart"]').first();
const SHOP = 'stp-aurora';

// ───────── functional checks on Aurora ─────────
for (const [label, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['phone', { width: 390, height: 844 }],
]) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => {
    if (!/negative time stamp/.test(e.message)) errors.push(e.message);
  }); // dev-only React profiler noise
  await open(page, `/s/${SHOP}`);
  check(
    `[${label}] home shows a full first page (48 cards)`,
    (await page.locator('.sf-card').count()) === 48,
  );
  check(
    `[${label}] no horizontal scroll`,
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  );
  check(
    `[${label}] fonts are self-hosted (Plus Jakarta Sans, Fraunces, JetBrains Mono)`,
    await page.evaluate(async () => {
      await document.fonts.ready;
      const loaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family);
      return ['Plus Jakarta Sans', 'Fraunces', 'JetBrains Mono'].every((n) =>
        loaded.some((l) => l.replace(/"/g, '') === n),
      );
    }),
  );
  check(
    `[${label}] strip and hero default copy`,
    (await page.locator('.sf-strip').innerText()).startsWith('Order on WhatsApp') &&
      (await page.locator('.sf-hero h1').innerText()) === 'Welcome to Aurora Goods.',
  );

  if (label === 'desktop') {
    await page.fill('.sf-search input', 'mug 1');
    check(`[${label}] search narrows`, (await page.locator('.sf-card:visible').count()) < 48);
    await page.fill('.sf-search input', '');
  }
  await page.selectOption('.sf-toolbar select', 'price-desc');
  const first = await page.locator('.sf-card .sf-card-price b').first().innerText();
  check(`[${label}] sort price high to low`, /₹ 589/.test(first), first);
  await page.selectOption('.sf-toolbar select', 'featured');
  check(
    `[${label}] QUIRK: Featured keeps the last sort order`,
    /₹ 589/.test(await page.locator('.sf-card .sf-card-price b').first().innerText()),
  );
  await page.click('.sf-reset');

  await page.click('.sf-more-btn');
  await page.waitForFunction(() => document.querySelectorAll('.sf-card').length > 48, null, {
    timeout: 15000,
  });
  check(
    `[${label}] show more appends the rest (58 in all, the draft is not listed)`,
    (await page.locator('.sf-card').count()) === 58,
  );
  check(
    `[${label}] show more button gone after last page`,
    (await page.locator('.sf-more-btn').count()) === 0,
  );

  // wishlist + quick view
  await page.locator('.sf-wish').first().click({ force: true });
  check(
    `[${label}] wishlist badge`,
    (await page.locator('.sf-actions .sf-badge').first().innerText()) === '1',
  );
  await page.locator('.sf-quick').first().click({ force: true });
  check(`[${label}] quick view opens`, await page.locator('.sf-modal-card .sf-qv').isVisible());
  await page.keyboard.press('Escape');
  check(`[${label}] Escape closes the modal`, (await page.locator('.sf-modal-card').count()) === 0);

  // stock cap on the cards: products 2 and 3 have a stock of 3 (the phone run uses the other one: a placed order takes stock)
  const lowStock = label === 'desktop' ? 2 : 3;
  await open(page, `/s/${SHOP}`);
  for (let i = 0; i < 3; i++) await addBtn(page, lowStock - 1).click();
  await addBtn(page, lowStock - 1).click();
  check(
    `[${label}] a 4th add of a 3-in-stock product is refused`,
    (await page.locator('.sf-modal-title').innerText()).includes('Only 3 in stock'),
  );
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.scrollTo(0, 0));
  await cartButton(page).click();
  check(`[${label}] cart holds 3`, (await page.locator('.sf-cart-row input').inputValue()) === '3');
  check(
    `[${label}] shipping row shows fee and hint`,
    (await page.locator('.sf-drawer-foot').innerText()).includes('more for free shipping'),
  );
  await page.keyboard.press('Escape');

  // product page: low stock pill, the product's own stock is not capped there (QUIRK), tabs, two review blocks
  await open(page, `/s/${SHOP}/p/stp-item-${lowStock}`);
  check(
    `[${label}] low stock pill`,
    (await page.locator('.sf-pd-stock').innerText()).includes('Only 3 left'),
  );
  await page.locator('.sf-pd-actions .sf-qty input').fill('9');
  await page.locator('.sf-pd-actions > .sf-cta').click();
  check(
    `[${label}] QUIRK: the product page does not clamp its own product to stock`,
    (await page.locator('.sf-cart-row input').inputValue()) === '12',
  );
  await page.keyboard.press('Escape');

  // checkout validation, coupon, order
  await page.evaluate(() => window.scrollTo(0, 0));
  await cartButton(page).click();
  await page.click('.sf-order-btn');
  check(
    `[${label}] the cart drawer stays open behind the checkout dialog`,
    (await page.locator('.sf-drawer[data-open="1"]').count()) === 1,
  );
  await page.click('.sf-checkout button[type=submit]');
  check(
    `[${label}] name required`,
    (await page.locator('.sf-status-msg').innerText()).includes('enter your name'),
  );
  await page.fill('.sf-checkout input[autocomplete=name]', 'Asha');
  await page.fill('.sf-checkout input[type=tel]', '12-34');
  await page.click('.sf-checkout button[type=submit]');
  check(
    `[${label}] phone needs 7 digits`,
    (await page.locator('.sf-status-msg').innerText()).includes('valid WhatsApp number'),
  );
  await fillCheckout(page);
  await page.fill('.sf-coupon input', 'save10');
  await page.click('.sf-coupon button');
  await page.waitForSelector('.sf-coupon-msg.is-ok');
  check(
    `[${label}] coupon quote`,
    (await page.locator('.sf-coupon-msg.is-ok').innerText()).includes('You save'),
  );
  await page.fill('.sf-coupon input', 'nope');
  await page.click('.sf-coupon button');
  await page.waitForSelector('.sf-coupon-msg.is-error');
  check(
    `[${label}] bad coupon message`,
    (await page.locator('.sf-coupon-msg.is-error').innerText()).includes('not valid'),
  );
  await page.fill('.sf-coupon input', 'SAVE10');
  await page.check('input[value=cod]');
  const wa = await placeOrder(page);
  const waText = wa ? decodeURIComponent(wa.split('?text=')[1] ?? '') : '';
  check(
    `[${label}] hands off to wa.me with the confirmation text and the tracking link`,
    !!wa &&
      /^https:\/\/wa\.me\/919876543210\?text=/.test(wa) &&
      /^Hi Aurora Goods! I just placed order #\d+ \(₹ [\d,]+\.\d\d\)\. My name is Asha Test\.\nTrack: .*\/s\/stp-aurora\/order\/[A-Za-z0-9]{40}$/.test(
        waText,
      ),
    waText.replace(/\n/g, ' | '),
  );
  check(
    `[${label}] cart cleared`,
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('sf_cart_stp-aurora') ?? '[]').length === 0,
    ),
  );
  const track = waText.match(/Track: (.*)$/)?.[1]?.replace(/^https?:\/\/[^/]+/, '') ?? '';
  await open(page, track);
  check(
    `[${label}] tracking page shows steps and a total with two decimals`,
    (await page.locator('.sf-ot-steps li').count()) === 4 &&
      /Total\s*₹ [\d,]+\.\d\d/.test(
        (await page.locator('.sf-ot-totals').innerText()).replace(/\n/g, ' '),
      ),
  );
  check(
    `[${label}] tracking page is noindex and has no shop SEO tags`,
    (await page.locator('meta[name=robots]').getAttribute('content'))?.includes('noindex') ===
      true && (await page.locator('meta[property="og:title"]').count()) === 0,
  );

  // review
  await open(page, `/s/${SHOP}/p/stp-item-1`);
  check(
    `[${label}] QUIRK: the review form is on the page twice (tab and Reviews block)`,
    (await page.locator('.sf-review-form').count()) === 2,
  );
  await page.click('[role=tab]:has-text("Reviews")');
  const tabForm = page.locator('.sf-tabs-pane:not([hidden]) .sf-review-form');
  await tabForm.locator('button[type=submit]').click();
  check(
    `[${label}] review needs a name`,
    (await tabForm.locator('.sf-form-msg').innerText()).includes('add your name'),
  );
  // the bottom block works on its own (WaDesk's duplicate ids made it unusable)
  const blockForm = page.locator('.sf-reviews-box .sf-review-form');
  await blockForm.locator('input').fill('Asha');
  await blockForm.locator('textarea').fill('Lovely.');
  await blockForm.locator('button[type=submit]').click();
  await page.waitForSelector('.sf-reviews-box .sf-form-msg.is-ok', { timeout: 10000 });
  check(`[${label}] review posted pending`, true);
  check(`[${label}] product body sanitised`, !(await page.content()).includes('alert(1)'));
  check(
    `[${label}] JSON-LD present and the title has no platform suffix`,
    (await page.locator('script[type="application/ld+json"]').count()) === 1 &&
      (await page.title()) === 'stp Clay Mug 1 · Aurora Goods',
  );
  check(
    `[${label}] og:type product`,
    (await page.locator('meta[property="og:type"]').getAttribute('content')) === 'product',
  );

  // share + compare
  await page.click('.sf-pd-icons button[aria-label*="Share"]');
  check(`[${label}] share dialog with local QR`, await page.locator('.sf-share-grid').isVisible());
  await page.click('.sf-qr summary');
  check(
    `[${label}] QR is inline svg, no third-party image`,
    (await page.locator('.sf-qr-box svg').count()) === 1 &&
      (await page.locator('img[src*="qrserver"]').count()) === 0,
  );
  await page.keyboard.press('Escape');
  await page.click('.sf-pd-icons button[aria-label*="ompare"]');
  check(`[${label}] compare bar shows`, await page.locator('.sf-compare-bar').isVisible());

  // 404s
  const missing = await page.goto(`${BASE}/s/no-such-shop`, { waitUntil: 'networkidle' });
  check(`[${label}] unknown shop is 404`, missing?.status() === 404);
  check(
    `[${label}] the 404 is WaDesk's platform screen`,
    (await page.locator('.sf-404 h1').innerText()) === 'This page took a wrong turn.',
  );
  const badTrack = await page.goto(`${BASE}/s/${SHOP}/order/not-a-token`, {
    waitUntil: 'networkidle',
  });
  check(`[${label}] wrong token is 404`, badTrack?.status() === 404);
  const off = await page.goto(`${BASE}/s/stp-off`, { waitUntil: 'networkidle' });
  check(`[${label}] disabled shop is 404`, off?.status() === 404);
  check(`[${label}] no page errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ───────── proxy guard ─────────
{
  const ctx = await browser.newContext();
  const res = await ctx.request.post(`${BASE}/s/${SHOP}/coupon`, {
    data: { code: 'x', items: [] },
    headers: { origin: 'https://evil.test' },
  });
  check('cross-origin POST is refused', res.status() === 403, String(res.status()));
  await ctx.close();
}

// ───────── eight themes, screenshots ─────────
for (const [w, h] of [
  [1440, 900],
  [390, 844],
]) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const slug = `stp-${theme}`;
    const shot = (n) =>
      page.screenshot({
        path: `${SHOTS}/${theme}_${n}_${w}.png`,
        fullPage: n === 'home' || n === 'product' || n === 'track',
      });
    await open(page, `/s/${slug}`);
    check(
      `[${theme} ${w}] data-sf-theme applied`,
      (await page.getAttribute('.sf-root', 'data-sf-theme')) === theme,
    );
    check(
      `[${theme} ${w}] no horizontal scroll`,
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    );
    await shot('home');
    await open(page, `/s/${slug}/p/stp-item-1`);
    await shot('product');
    await page.locator('.sf-pd-actions > .sf-cta').click();
    await page.waitForSelector('.sf-drawer[data-open="1"] .sf-cart-row');
    await page.waitForTimeout(400);
    await shot('cart');
    await page.click('.sf-order-btn');
    await fillCheckout(page);
    await page.waitForTimeout(200);
    await shot('checkout');
    const wa = await placeOrder(page);
    const track = decodeURIComponent(wa ?? '')
      .match(/Track: (.*)$/)?.[1]
      ?.replace(/^https?:\/\/[^/]+/, '');
    check(`[${theme} ${w}] order placed`, !!track, track ?? '');
    if (track) {
      await open(page, track);
      await shot('track');
    }
    await ctx.close();
  }
}

await browser.close();
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
