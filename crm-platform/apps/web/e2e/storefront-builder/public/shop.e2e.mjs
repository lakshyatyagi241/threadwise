// Public shop end-to-end script (Playwright is not a repo dependency: set PLAYWRIGHT_DIR to a node_modules that has it).
//   1. seed:  docker exec -i crm-postgres psql -U crm -d crm_commerce < seed.sql
//   2. run:   BASE=http://localhost:3108 SHOTS=/tmp/shots PLAYWRIGHT_DIR=/path/to/node_modules/ node shop.e2e.mjs
// It checks the buyer flows on the Aurora shop (desktop and phone), then walks all eight themes and takes screenshots of
// home, product, cart drawer, checkout and the tracking page at 1440 and 390 px, placing one real order per theme.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(
  process.env.PLAYWRIGHT_DIR ?? '/home/getaweblpubt10/.npm/_npx/6bcb61ec6d5aea22/node_modules/',
);
const { chromium } = require('playwright');
const BASE = process.env.BASE ?? 'http://localhost:3108';
const SHOTS = process.env.SHOTS ?? '/tmp/sf-shots';
const THEMES = ['aurora', 'meridian', 'verdure', 'bazaar', 'noir', 'kraft', 'mercato', 'studio'];
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

const browser = await chromium.launch();

async function fillCheckout(page, name = 'Asha Test') {
  await page.fill('.sf-checkout input[autocomplete=name]', name);
  await page.fill('.sf-checkout input[type=tel]', '+91 98765 43210');
  await page.fill('.sf-checkout textarea', '12 Test Street');
}

async function placeOrder(page) {
  await page.click('.sf-checkout button[type=submit]');
  await page.waitForSelector('.sf-modal-title:has-text("placed")', { timeout: 15000 });
  return page.getAttribute('.sf-placed-links a[href*="/order/"]', 'href');
}

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
  await page.goto(`${BASE}/s/sf-aurora`, { waitUntil: 'networkidle' });
  check(
    `[${label}] home shows a full first page (47-48 cards; a sold-out one is filtered)`,
    [47, 48].includes(await page.locator('.sf-card').count()),
  );
  check(
    `[${label}] no horizontal scroll`,
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  );

  await page.fill('.sf-search input', 'mug 1');
  check(`[${label}] search narrows`, (await page.locator('.sf-card').count()) < 48);
  await page.fill('.sf-search input', '');

  await page.selectOption('.sf-toolbar select', 'price-desc');
  const first = await page.locator('.sf-card .sf-card-price b').first().innerText();
  check(`[${label}] sort price high to low`, /₹ (57|58)\d/.test(first), first);
  await page.selectOption('.sf-toolbar select', 'featured');

  await page.click('.sf-more-btn');
  await page.waitForFunction(() => document.querySelectorAll('.sf-card').length > 48, null, {
    timeout: 15000,
  });
  check(`[${label}] show more appends`, (await page.locator('.sf-card').count()) >= 59);
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

  // stock cap: item-2 has stock 3
  await page.goto(`${BASE}/s/sf-aurora/p/${label === 'desktop' ? 'item-2' : 'item-3'}`, {
    waitUntil: 'networkidle',
  });
  check(
    `[${label}] low stock pill`,
    (await page.locator('.sf-pd-stock').innerText()).includes('Only 3 left'),
  );
  for (let i = 0; i < 3; i++) {
    await page.locator('.sf-pd-add').click();
    await page.keyboard.press('Escape');
  }
  await page.locator('.sf-pd-add').click();
  await page.keyboard.press('Escape');
  await page.click('.sf-actions .sf-icon-btn:last-child');
  check(
    `[${label}] cart is clamped to stock (3)`,
    (await page.locator('.sf-cart-row input').inputValue()) === '3',
  );
  check(
    `[${label}] shipping row shows fee and hint`,
    (await page.locator('.sf-drawer-foot').innerText()).includes('more for free shipping'),
  );
  // focus trap: Tab stays inside the drawer
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
  check(
    `[${label}] focus stays in the drawer`,
    await page.evaluate(() => !!document.activeElement?.closest('.sf-drawer-panel')),
  );
  await page.keyboard.press('Escape');

  // checkout validation, coupon, order
  await page.click('.sf-actions .sf-icon-btn:last-child');
  await page.click('.sf-order-btn');
  await page.click('.sf-checkout button[type=submit]');
  check(
    `[${label}] name required`,
    (await page.locator('.sf-checkout [role=alert]').innerText()).includes('enter your name'),
  );
  await page.fill('.sf-checkout input[autocomplete=name]', 'Asha');
  await page.fill('.sf-checkout input[type=tel]', '12-34');
  await page.click('.sf-checkout button[type=submit]');
  check(
    `[${label}] phone needs 7 digits`,
    (await page.locator('.sf-checkout [role=alert]').innerText()).includes('valid WhatsApp number'),
  );
  await fillCheckout(page);
  await page.fill('.sf-coupon input', 'save10');
  await page.click('.sf-coupon button');
  await page.waitForSelector('.sf-coupon + .sf-form-msg.is-ok');
  check(
    `[${label}] coupon quote`,
    (await page.locator('.sf-coupon + .sf-form-msg.is-ok').innerText()).includes('You save'),
  );
  await page.fill('.sf-coupon input', 'nope');
  await page.click('.sf-coupon button');
  await page.waitForSelector('.sf-coupon + .sf-form-msg.is-error');
  check(
    `[${label}] bad coupon message`,
    (await page.locator('.sf-coupon + .sf-form-msg.is-error').innerText()).includes('not valid'),
  );
  await page.fill('.sf-coupon input', 'SAVE10');
  await page.check('input[value=cod]');
  const track = await placeOrder(page);
  check(
    `[${label}] order placed with tracking link`,
    !!track && /\/s\/sf-aurora\/order\//.test(track),
    track ?? '',
  );
  check(
    `[${label}] cart cleared`,
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('sf_cart_sf-aurora') ?? '[]').length === 0,
    ),
  );
  await page.goto(`${BASE}${track}`, { waitUntil: 'networkidle' });
  check(
    `[${label}] tracking page shows steps and total`,
    (await page.locator('.sf-ot-steps li').count()) === 4 &&
      (await page.locator('.sf-ot-totals').innerText()).includes('Total'),
  );
  check(
    `[${label}] tracking page is noindex`,
    (await page.locator('meta[name=robots]').getAttribute('content'))?.includes('noindex') === true,
  );

  // review
  await page.goto(`${BASE}/s/sf-aurora/p/item-1`, { waitUntil: 'networkidle' });
  check(`[${label}] one review form only`, (await page.locator('.sf-review-form').count()) === 1);
  await page.click('[role=tab]:has-text("Reviews")');
  await page.click('.sf-review-form button[type=submit]');
  check(
    `[${label}] review needs a name`,
    (await page.locator('.sf-review-form .sf-form-msg').innerText()).includes('add your name'),
  );
  await page.fill('.sf-review-form input', 'Asha');
  await page.fill('.sf-review-form textarea', 'Lovely.');
  await page.click('.sf-review-form button[type=submit]');
  await page.waitForSelector('.sf-review-form .sf-form-msg.is-ok', { timeout: 10000 });
  check(`[${label}] review posted pending`, true);
  check(`[${label}] product body sanitised`, !(await page.content()).includes('alert(1)'));
  check(
    `[${label}] JSON-LD present`,
    (await page.locator('script[type="application/ld+json"]').count()) === 1,
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
  await page.click('.sf-pd-icons button[aria-label*="compare"]');
  check(`[${label}] compare bar shows`, await page.locator('.sf-compare-bar').isVisible());

  // 404s
  const missing = await page.goto(`${BASE}/s/no-such-shop`, { waitUntil: 'networkidle' });
  check(`[${label}] unknown shop is 404`, missing?.status() === 404);
  const badTrack = await page.goto(`${BASE}/s/sf-aurora/order/not-a-token`, {
    waitUntil: 'networkidle',
  });
  check(`[${label}] wrong token is 404`, badTrack?.status() === 404);
  check(`[${label}] no page errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ───────── proxy guard ─────────
{
  const ctx = await browser.newContext();
  const res = await ctx.request.post(`${BASE}/s/sf-aurora/coupon`, {
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
    const slug = `sf-${theme}`;
    const shot = (n) =>
      page.screenshot({
        path: `${SHOTS}/${theme}_${n}_${w}.png`,
        fullPage: n === 'home' || n === 'product' || n === 'track',
      });
    await page.goto(`${BASE}/s/${slug}`, { waitUntil: 'networkidle' });
    check(
      `[${theme} ${w}] data-sf-theme applied`,
      (await page.getAttribute('.sf-root', 'data-sf-theme')) === theme,
    );
    check(
      `[${theme} ${w}] no horizontal scroll`,
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    );
    await shot('home');
    await page.goto(`${BASE}/s/${slug}/p/item-1`, { waitUntil: 'networkidle' });
    await shot('product');
    await page.locator('.sf-pd-add').click();
    await page.waitForSelector('.sf-drawer[data-open="1"] .sf-cart-row');
    await page.waitForTimeout(400);
    await shot('cart');
    await page.click('.sf-order-btn');
    await fillCheckout(page);
    await page.waitForTimeout(200);
    await shot('checkout');
    const track = await placeOrder(page);
    await page.goto(`${BASE}${track}`, { waitUntil: 'networkidle' });
    await shot('track');
    await ctx.close();
  }
}

await browser.close();
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
