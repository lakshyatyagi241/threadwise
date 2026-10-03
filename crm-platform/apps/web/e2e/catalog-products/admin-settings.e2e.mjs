// Browser run of the operator console's "WhatsApp Catalog" settings page (WD-CAT-030): /admin/settings/catalog.
//   OPERATOR_TOTP_SECRET='ABCD EFGH ...' WEB=http://localhost:3108 node admin-settings.e2e.mjs
// The seeded operator (operator@example.test, super admin) must have two-factor turned on; the page needs its authenticator
// secret to sign in. Without OPERATOR_TOTP_SECRET the run reports "skipped" and exits 0, it does not guess.
// It saves a Graph version and restores the one it found, so the page ends as it began.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(
  process.env.PW_MODULES ??
    `${resolve(here, '../../../../.claude/skills/wadesk-playwright-parity/harness')}/`,
);
const { chromium } = require('playwright');

const WEB = process.env.WEB ?? 'http://localhost:3108';
const EMAIL = process.env.OPERATOR_EMAIL ?? 'operator@example.test';
const PASSWORD = process.env.OPERATOR_PASSWORD ?? 'Passw0rd!';
const SECRET = process.env.OPERATOR_TOTP_SECRET;
const SHOTS = process.env.SHOTS ?? '/tmp/cat-e2e-shots';
mkdirSync(SHOTS, { recursive: true });
if (!SECRET) {
  console.log('skipped: set OPERATOR_TOTP_SECRET (the operator authenticator key) to run this');
  process.exit(0);
}

function totp(secretB32, t = Date.now()) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secretB32.replace(/[\s=]/g, '').toUpperCase())
    bits += A.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8);
  ctr.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = createHmac('sha1', key).update(ctr).digest();
  const o = h[19] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}

const results = [];
let page;
let shotN = 0;
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', `${name}: ${e.message.split('\n')[0]}`]);
    await page?.screenshot({ path: `${SHOTS}/admin-fail-${++shotN}.png` }).catch(() => undefined);
  }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await check('the operator signs in with the authenticator code', async () => {
  await page.goto(`${WEB}/admin/login`);
  await page.fill('input[name=email]', EMAIL);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  const code = page.getByLabel(/code/i).first();
  await code.waitFor();
  await code.fill(totp(SECRET));
  await Promise.all([
    page.waitForURL(
      (u) => !u.pathname.startsWith('/admin/login') && !/verify|mfa/.test(u.pathname),
    ),
    page
      .getByRole('button', { name: /verify|continue|sign in|confirm/i })
      .first()
      .click(),
  ]);
});

const heading = () => page.getByRole('heading', { level: 1 });
let savedVersion = 'v23.0';

await check(
  'the console menu lists Catalog under Platform settings and the page opens',
  async () => {
    await page.goto(`${WEB}/admin/settings/catalog`);
    await heading().waitFor();
    assert.match(await heading().innerText(), /WhatsApp\s+Catalog/);
    const link = page.locator('a[href="/admin/settings/catalog"]').first();
    await link.waitFor({ state: 'attached' });
  },
);

await check('the three usage tiles and the five-step merchant walkthrough are there', async () => {
  const tiles = page.getByTestId('catalog-admin-usage');
  await tiles.waitFor();
  const text = await tiles.innerText();
  for (const label of ['Workspaces connected', 'Products synced', 'Catalog messages sent'])
    assert.match(text, new RegExp(label));
  assert.equal(await page.locator('ol > li').count(), 5);
  await page.screenshot({ path: `${SHOTS}/ours-admin-catalog.png`, fullPage: true });
});

await check('a Graph version that is not vNN.N is refused with the field message', async () => {
  savedVersion = await page.getByLabel('Graph API version').inputValue();
  await page.getByLabel('Graph API version').fill('24');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Please fix the highlighted fields:').waitFor();
  await page.getByText('Use a Graph API version such as v23.0.').first().waitFor();
});

await check('a 2-letter currency is refused', async () => {
  await page.getByLabel('Graph API version').fill('v24.0');
  await page.getByLabel('Default currency').fill('EU');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Use a 3-letter currency code.').first().waitFor();
});

await check(
  'saving stores the version and the upper-cased currency, and Reset draft restores the saved values',
  async () => {
    await page.getByLabel('Default currency').fill('eur');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText('Catalog settings saved.').waitFor();
    await page.reload();
    await heading().waitFor();
    assert.equal(await page.getByLabel('Graph API version').inputValue(), 'v24.0');
    assert.equal(await page.getByLabel('Default currency').inputValue(), 'EUR');
    await page.getByLabel('Graph API version').fill('v99.9');
    await page.getByRole('button', { name: 'Reset draft' }).click();
    assert.equal(await page.getByLabel('Graph API version').inputValue(), 'v24.0');
  },
);

await check(
  'the app secret is write-only: it is never shown, and a blank save keeps it',
  async () => {
    await page.getByLabel('Meta App Secret').fill('s3cret-value-1234');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText('Catalog settings saved.').waitFor();
    await page.reload();
    await heading().waitFor();
    const field = page.getByLabel('Meta App Secret');
    assert.equal(await field.inputValue(), '');
    assert.match((await field.getAttribute('placeholder')) ?? '', /saved/);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText('Catalog settings saved.').waitFor();
    await page.reload();
    assert.match(
      (await page.getByLabel('Meta App Secret').getAttribute('placeholder')) ?? '',
      /saved/,
    );
  },
);

await check('the feature switches toggle and persist', async () => {
  const sw = page.getByRole('switch', { name: 'Allow Commerce checkout' });
  const before = await sw.getAttribute('aria-checked');
  await sw.click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Catalog settings saved.').waitFor();
  await page.reload();
  const after = await page
    .getByRole('switch', { name: 'Allow Commerce checkout' })
    .getAttribute('aria-checked');
  assert.notEqual(after, before);
  await page.getByRole('switch', { name: 'Allow Commerce checkout' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Catalog settings saved.').waitFor();
});

await check(
  'a blank Graph version falls back to the default instead of breaking the URLs (WaDesk quirk fixed)',
  async () => {
    await page.getByLabel('Graph API version').fill('');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText('Catalog settings saved.').waitFor();
    await page.reload();
    await heading().waitFor();
    assert.equal(await page.getByLabel('Graph API version').inputValue(), 'v23.0');
  },
);

await check('the original Graph version is put back', async () => {
  await page.getByLabel('Graph API version').fill(savedVersion);
  await page.getByLabel('Default currency').fill('USD');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Catalog settings saved.').waitFor();
});

await check('no uncaught page errors', async () => assert.deepEqual(errors, []));

await browser.close();
for (const [s, n] of results) console.log(s, n);
console.log(`${results.filter(([s]) => s === 'ok').length}/${results.length} passed`);
process.exit(results.some(([s]) => s === 'FAIL') ? 1 : 0);
