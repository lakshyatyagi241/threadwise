// Screenshots the same pages of the WaDesk reference and of our shop (same seed: seed-both.mjs) for a visual diff.
//   node parity-capture.mjs <scenario[,scenario]> <theme[,theme]|all> <viewport[,viewport]>
//   scenarios: home full product cart checkout order notfound filter quick drawers hover; viewports: 1440 390 768
//   env: REF=http://127.0.0.1:8000 OURS=http://localhost:3109 OUT=/tmp/shots/pub. Compare the pairs with parity-diff.py.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(
  process.env.PLAYWRIGHT_DIR ??
    new URL('../../../../../.claude/skills/wadesk-playwright-parity/harness/', import.meta.url)
      .pathname,
);
const { chromium } = require('playwright');
const OUT = process.env.OUT ?? '/tmp/sf-parity/pub';
fs.mkdirSync(OUT, { recursive: true });
const BASES = {
  ref: process.env.REF ?? 'http://127.0.0.1:8000',
  ours: process.env.OURS ?? 'http://localhost:3109',
};
const ALL = ['aurora', 'meridian', 'verdure', 'bazaar', 'noir', 'kraft', 'mercato', 'studio'];
const VPS = {
  1440: { width: 1440, height: 900 },
  390: { width: 390, height: 844 },
  768: { width: 768, height: 1024 },
};
const [scs = 'home', th = 'aurora', vps = '1440'] = process.argv.slice(2);
const themes = th === 'all' ? ALL : th.split(',');
const TOK = {
  new: 'stptoken00',
  confirmed: 'stptoken01',
  paid: 'stptoken02',
  shipped: 'stptoken03',
  cancelled: 'stptoken04',
  delivered: 'stptoken05',
};
const tok = (s) => TOK[s].padEnd(40, 'x');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page
    .addStyleTag({
      content:
        '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important} nextjs-portal,[data-nextjs-toast]{display:none!important}',
    })
    .catch(() => {});
  await page.waitForTimeout(500);
}
async function open(page, side, path) {
  await page.goto(BASES[side] + path, { waitUntil: 'domcontentloaded' });
  await settle(page);
  // platform cookie banner exists on ours only (root layout, WD-SET-033): decline it so it never covers the shop
  const dec = page.getByRole('button', { name: 'Decline' });
  if (side === 'ours')
    await dec
      .first()
      .waitFor({ timeout: 2500 })
      .catch(() => {});
  if (await dec.count()) {
    await dec
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(200);
  }
  await page.mouse.move(2, 2);
}
const shot = async (page, name, opts = {}) =>
  page.screenshot({ path: `${OUT}/${name}.png`, ...opts });
// WaDesk's hidden toast keeps catching taps on a phone (no pointer-events:none), so the reference button is clicked by event
const orderBtn = (page, side) =>
  side === 'ref'
    ? page.getByRole('button', { name: /Order on WhatsApp/ }).dispatchEvent('click')
    : page.getByRole('button', { name: /Order on WhatsApp/ }).click();
const addToCartBtn = (page, n = 0) => page.locator('button:has-text("Add to cart")').nth(n);
const SC = {
  async home(page, side, t, vp) {
    await open(page, side, `/s/stp-${t}`);
    await shot(page, `pub-${t}-home-${vp}-${side}`);
    await page.evaluate(() => document.getElementById('categories')?.scrollIntoView());
    await sleep(300);
    await shot(page, `pub-${t}-grid-${vp}-${side}`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await sleep(300);
    await shot(page, `pub-${t}-bottom-${vp}-${side}`);
  },
  async full(page, side, t, vp) {
    await open(page, side, `/s/stp-${t}`);
    await shot(page, `pub-${t}-full-${vp}-${side}`, { fullPage: true });
  },
  async product(page, side, t, vp) {
    await open(page, side, `/s/stp-${t}/p/stp-item-1`);
    await shot(page, `pub-${t}-product-${vp}-${side}`);
    await page.evaluate(() => window.scrollTo(0, window.innerHeight * 0.9));
    await sleep(300);
    await shot(page, `pub-${t}-product2-${vp}-${side}`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await sleep(300);
    await shot(page, `pub-${t}-productbot-${vp}-${side}`);
    await shot(page, `pub-${t}-productfull-${vp}-${side}`, { fullPage: true });
  },
  async cart(page, side, t, vp) {
    await open(page, side, `/s/stp-${t}`);
    await addToCartBtn(page, 0).click();
    await sleep(300);
    await addToCartBtn(page, 0).click();
    await sleep(200);
    await addToCartBtn(page, 4).click();
    await sleep(400);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('button[aria-label^="Cart"]').first().click();
    await sleep(500);
    await shot(page, `pub-${t}-cart-${vp}-${side}`);
  },
  async checkout(page, side, t, vp) {
    await open(page, side, `/s/stp-${t}`);
    await addToCartBtn(page, 0).click();
    await sleep(300);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('button[aria-label^="Cart"]').first().click();
    await sleep(400);
    await orderBtn(page, side);
    await sleep(500);
    await shot(page, `pub-${t}-checkout-${vp}-${side}`);
    await page.getByRole('button', { name: /Place order/ }).click();
    await sleep(500);
    await shot(page, `pub-${t}-checkouterr-${vp}-${side}`);
  },
  async order(page, side, t, vp) {
    for (const s of Object.keys(TOK)) {
      const shop = s === 'delivered' ? 'meridian' : 'aurora';
      await open(page, side, `/s/stp-${shop}/order/${tok(s)}`);
      await shot(page, `pub-order-${s}-${vp}-${side}`, { fullPage: true });
    }
  },
  async notfound(page, side, t, vp) {
    await open(page, side, `/s/stp-off`);
    await shot(page, `pub-disabled-${vp}-${side}`);
    await open(page, side, `/s/stp-nope`);
    await shot(page, `pub-unknown-${vp}-${side}`);
    await open(page, side, `/s/stp-aurora/p/nope`);
    await shot(page, `pub-noproduct-${vp}-${side}`);
    await open(page, side, `/s/stp-aurora/order/${'z'.repeat(40)}`);
    await shot(page, `pub-noorder-${vp}-${side}`);
  },
  async filter(page, side, t, vp) {
    await open(page, side, `/s/stp-${t}`);
    await page.locator('.sf-search input').fill('mug');
    await sleep(400);
    await shot(page, `pub-${t}-search-${vp}-${side}`);
    await page.locator('.sf-search input').fill('');
    await sleep(200);
    await page.locator('select').first().selectOption({ index: 2 });
    await sleep(300);
    await page
      .getByLabel('Bags')
      .first()
      .check()
      .catch(() => {});
    await sleep(300);
    await page.evaluate(() => document.getElementById('categories')?.scrollIntoView());
    await sleep(300);
    await shot(page, `pub-${t}-filtered-${vp}-${side}`);
    await page.locator('.sf-search input').fill('zzzz');
    await sleep(300);
    await shot(page, `pub-${t}-nomatch-${vp}-${side}`);
  },
  async hover(page, side, t, vp) {
    await open(page, side, `/s/stp-${t}`);
    await page.evaluate(() => window.scrollTo(0, 420));
    await sleep(200);
    const card = page.locator('.sf-card, .card').nth(1);
    await card.hover();
    await sleep(500);
    await shot(page, `pub-${t}-hovercard-${vp}-${side}`);
    await addToCartBtn(page, 1).hover();
    await sleep(300);
    await shot(page, `pub-${t}-hoveradd-${vp}-${side}`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('.sf-search input').focus();
    await page.keyboard.type('mu');
    await sleep(300);
    await shot(page, `pub-${t}-searchfocus-${vp}-${side}`);
    await page.locator('.sf-nav a').nth(1).hover();
    await sleep(250);
    await shot(page, `pub-${t}-hovernav-${vp}-${side}`);
    await page.locator('.sf-icon-btn').nth(2).hover();
    await sleep(250);
    await shot(page, `pub-${t}-hovericon-${vp}-${side}`);
    await page.evaluate(() => window.scrollTo(0, 600));
    await sleep(300);
    await shot(page, `pub-${t}-scrolled-${vp}-${side}`);
  },
  async quick(page, side, t, vp) {
    await open(page, side, `/s/stp-${t}`);
    await page.locator('.sf-card-img, .img').first().scrollIntoViewIfNeeded();
    await page.locator('.sf-quick').first().click({ force: true });
    await sleep(500);
    await shot(page, `pub-${t}-quick-${vp}-${side}`);
  },
  async drawers(page, side, t, vp) {
    await open(page, side, `/s/stp-${t}`);
    for (const n of [0, 1, 2]) await page.locator('.sf-wish').nth(n).click({ force: true });
    await sleep(200);
    await page.locator('button[aria-label^="Wishlist"]').first().click();
    await sleep(500);
    await shot(page, `pub-${t}-wish-${vp}-${side}`);
    await page.keyboard.press('Escape');
    await sleep(400);
    await page
      .locator('.sf-wish')
      .first()
      .evaluate(() => {});
    await page.locator('button[aria-label^="Cart"]').first().click();
    await sleep(500);
    await shot(page, `pub-${t}-cartempty-${vp}-${side}`);
    await page.keyboard.press('Escape');
    await sleep(400);
  },
};
const browser = await chromium.launch();
for (const sc of scs.split(','))
  for (const t of themes)
    for (const vp of vps.split(','))
      for (const side of ['ref', 'ours']) {
        const ctx = await browser.newContext({ viewport: VPS[vp] });
        const page = await ctx.newPage();
        try {
          await SC[sc](page, side, t, vp);
        } catch (e) {
          console.log('ERR', sc, t, vp, side, e.message.split('\n')[0]);
          await shot(page, `ERR-${sc}-${t}-${vp}-${side}`).catch(() => {});
        }
        await ctx.close();
      }
await browser.close();
