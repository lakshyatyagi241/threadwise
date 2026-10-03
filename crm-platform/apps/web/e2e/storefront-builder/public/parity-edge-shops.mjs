// The two edge shops of seed-both.mjs on both sides: `stp-empty` (no products) and `stp-nonumber` (products, no sending number:
// no WhatsApp links, checkout ends on the "Order placed" dialog). Writes pub-empty-* and pub-nonumber-* screenshots to ./shots/pub/.
//   node parity-edge-shops.mjs      env: PLAYWRIGHT_DIR
import { createRequire } from 'node:module';
const require = createRequire(
  process.env.PLAYWRIGHT_DIR ??
    new URL('../../../../../.claude/skills/threadwise-playwright-parity/harness/', import.meta.url)
      .pathname,
);
const { chromium } = require('playwright');
const B = {
  ref: process.env.REF ?? 'http://127.0.0.1:8000',
  ours: process.env.OURS ?? 'http://localhost:3109',
};
const OUT = process.env.OUT ?? '/tmp/sf-parity/pub';
const b = await chromium.launch();
const res = {};
for (const side of ['ref', 'ours']) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const dec = () => p.getByRole('button', { name: 'Decline' });
  const go = async (u) => {
    await p.goto(B[side] + u, { waitUntil: 'networkidle' });
    await p.addStyleTag({
      content:
        '*{transition:none!important;animation:none!important} nextjs-portal{display:none!important}',
    });
    if (side === 'ours')
      await dec()
        .first()
        .waitFor({ timeout: 2500 })
        .catch(() => {});
    if (await dec().count())
      await dec()
        .first()
        .click()
        .catch(() => {});
    await p.mouse.move(2, 2);
  };
  const r = {};
  await go('/s/stp-empty');
  await p.screenshot({ path: OUT + `pub-empty-home-1440-${side}.png`, fullPage: true });
  r.emptyText = (await p.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300);
  await go('/s/stp-nonumber');
  await p.screenshot({ path: OUT + `pub-nonumber-home-1440-${side}.png` });
  r.footerLinks = await p.evaluate(() =>
    [...document.querySelectorAll('footer a')].map((a) => a.getAttribute('href')),
  );
  await go('/s/stp-nonumber/p/stp-plain-1');
  r.ask = await p.locator('a.sf-cta-ghost').count();
  r.pdText = (await p.locator('.pd, .sf-pd').first().innerText())
    .replace(/\s+/g, ' ')
    .slice(0, 200);
  await p.screenshot({ path: OUT + `pub-nonumber-product-1440-${side}.png` });
  // checkout
  await p.locator('.sf-pd-actions > .sf-cta').click();
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: /Order on WhatsApp/ }).dispatchEvent('click');
  await p.waitForTimeout(400);
  await p.locator('#sf-co-name, .sf-checkout input[autocomplete=name]').first().fill('Nina');
  await p.locator('#sf-co-phone, .sf-checkout input[type=tel]').first().fill('+1 555 000 1111');
  let res2 = null;
  p.on('response', async (r) => {
    if (r.url().endsWith('/checkout')) res2 = await r.json().catch(() => null);
  });
  await p.getByRole('button', { name: /Place order/ }).click();
  await p.waitForTimeout(2500);
  r.placed = (
    await p.locator('#sf-modal [data-modal-card], .sf-modal-card').first().innerText()
  ).replace(/\s+/g, ' ');
  r.resMsg = res2?.message;
  r.hasWa = !!res2?.wa_url || !!res2?.waUrl;
  r.trackLink = await p
    .locator('.sf-modal-card a.sf-cta-ghost, #sf-modal a.sf-cta-ghost')
    .first()
    .getAttribute('href')
    .then((h) => h.replace(/order\/.*/, 'order/TOKEN'));
  await p.screenshot({ path: OUT + `pub-nonumber-placed-1440-${side}.png` });
  res[side] = r;
  await ctx.close();
}
await b.close();
console.log(JSON.stringify(res, null, 1));
