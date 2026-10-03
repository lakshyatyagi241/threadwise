// Browser run of the catalog and product screens against a running web app + API (docs/threadwise-port/parity/catalog-products.md).
//   WEB=http://localhost:3108 API=http://localhost:53108 node catalog-flows.e2e.mjs
// Needs the API started with CAT_PROVIDER_MODE=fixture (an in-memory Meta and Node bridge, nothing leaves the machine),
// `playwright` from the parity harness (bootstrap.sh installs it) and docker with the dev Postgres (psql runs through
// `docker exec crm-postgres`; override with PSQL='["psql","-U","crm","-d","crm_cat","-tAc"]').
// It signs up its own organisation (fresh e-mail per run), turns the wa_storefront plan flag on for it, inserts one connected
// device and two reviews with SQL (there is no other way to make them: the public shop and the device pairing belong to other
// domains) and removes nothing else: every row it creates belongs to that throw-away organisation.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(
  process.env.PW_MODULES ??
    `${resolve(here, '../../../../.claude/skills/threadwise-playwright-parity/harness')}/`,
);
const { chromium } = require('playwright');

const WEB = process.env.WEB ?? 'http://localhost:3108';
const API = process.env.API ?? 'http://localhost:53108';
const SHOTS = process.env.SHOTS ?? '/tmp/cat-e2e-shots';
const PSQL = JSON.parse(
  process.env.PSQL ?? '["docker","exec","crm-postgres","psql","-U","crm","-d","crm_cat","-tAc"]',
);
const psql = (sql) => execFileSync(PSQL[0], [...PSQL.slice(1), sql], { encoding: 'utf8' }).trim();
mkdirSync(SHOTS, { recursive: true });

const STAMP = Date.now();
const EMAIL = `cat-e2e-${STAMP}@example.com`;
const PASS = 'Str0ngPassw0rd#1';
const results = [];
let page;
let shotN = 0;
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', `${name}: ${e.message.split('\n')[0]}`]);
    await page?.screenshot({ path: `${SHOTS}/fail-${++shotN}.png` }).catch(() => undefined);
  }
};

// ---- account, plan and data -------------------------------------------------------------------------------------------

const call = async (path, token, method = 'GET', body) => {
  const res = await fetch(`${API}/v2${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'idempotency-key': crypto.randomUUID(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

const signup = await call('/auth/signup', null, 'POST', {
  orgName: `Cat E2E ${STAMP}`,
  fullName: 'Cat E2E',
  email: EMAIL,
  password: PASS,
  acceptTerms: true,
});
assert.equal(signup.status, 201, `signup ${signup.status}`);
const login = await call('/auth/login', null, 'POST', { email: EMAIL, password: PASS });
const token = login.json.tokens.accessToken;
const ORG = login.json.orgSlug;
await call('/onboarding/workspace', token, 'POST', { name: `Cat E2E ${STAMP}`, timezone: 'UTC' });
assert.ok((await call('/onboarding/complete', token, 'POST', {})).status < 300);
const orgSql = `(SELECT id FROM organizations WHERE slug = '${ORG}')`;
const setFlag = (on) =>
  psql(
    `UPDATE org_plan_state SET overrides = '${on ? '{"features":{"wa_storefront":true}}' : '{}'}'::jsonb WHERE org_id = ${orgSql}`,
  );

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(`${WEB}/login`);
await page.fill('input[name=email]', EMAIL);
await page.fill('input[type=password]', PASS);
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith('/login')),
  page.click('button[type=submit]'),
]);
await page.waitForTimeout(1200);
await page
  .getByRole('button', { name: /decline|reject/i })
  .first()
  .click({ timeout: 3000 })
  .catch(() => undefined);

const open = async (path) => {
  await page.goto(`${WEB}${path}`);
  await page.waitForLoadState('networkidle').catch(() => undefined);
};
const toast = (text) => page.getByText(text, { exact: false }).first().waitFor();
const body = () => page.locator('body').innerText();
const nav = () => page.locator('nav, aside').filter({ has: page.locator('a[href]') });

// ---- plan gate (TW-CAT-001) -------------------------------------------------------------------------------------------

await check('a plan without wa_storefront gets the paywall sheet on every tab', async () => {
  await open('/catalog');
  await page.getByTestId('catalog-paywall').waitFor();
  assert.match(await page.getByTestId('catalog-paywall').innerText(), /is not on your plan/);
  // The shell does not know the plan flags yet (it resolves the menu with planFeatures unknown), so the entry is listed
  // and the paywall is the gate; src/features/catalog-products/nav.test.ts covers the gate declaration itself.
  assert.ok((await page.locator('a[href="/catalog"]').count()) > 0);
  await open('/catalog/send');
  await page.getByTestId('catalog-paywall').waitFor();
  await page.screenshot({ path: `${SHOTS}/ours-paywall.png` });
});

await check('products and reviews have no plan gate', async () => {
  await open('/store/products');
  await page.getByRole('heading', { name: 'Catalog' }).waitFor();
  assert.equal(await page.getByTestId('catalog-paywall').count(), 0);
  await open('/store/reviews');
  await page.getByText('No pending reviews.').waitFor();
});

setFlag(true);

await check(
  'with the flag on, the menu lists Catalog and the page opens the Setup tab',
  async () => {
    await open('/catalog');
    await page.getByTestId('catalog-pill').waitFor();
    assert.equal(await page.getByTestId('catalog-paywall').count(), 0);
    assert.ok((await page.locator('a[href="/catalog"]').count()) > 0, 'menu entry missing');
    await page.getByTestId('catalog-pill').filter({ hasText: 'Not connected' }).waitFor();
    const tabs = await page.locator('nav[aria-label="Catalog sections"] a').allInnerTexts();
    assert.deepEqual(tabs, ['Setup', 'Send', 'Collections', 'Activity']);
  },
);

// ---- empty states with nothing connected ------------------------------------------------------------------------------

await check(
  'no sender: Setup, Send, Collections and Activity show their Reference empty states',
  async () => {
    await open('/catalog');
    await page.getByText('Connect a device first').waitFor();
    await open('/catalog/send');
    await page
      .getByText('You need a connected WhatsApp device to send catalog messages.')
      .waitFor();
    await open('/catalog/collections');
    await page.getByText('No collections yet. Create your first one above.').waitFor();
    await open('/catalog/activity');
    await page.getByText('No sends yet').waitFor();
    await page.getByText('Send another →').waitFor();
  },
);

// ---- connect (TW-CAT-002, 004) ----------------------------------------------------------------------------------------

const fillConnect = async ({ id = '', token: tok = '', phone = '' }) => {
  await page.fill('#cat-catalog-id', id);
  await page.fill('#cat-token', tok);
  await page.fill('#cat-phone-id', phone);
};

await check(
  'connect: a short token is refused before any request, a bad catalog id shows Meta text and the hint',
  async () => {
    await open('/catalog');
    await page.locator('summary').first().click();
    await fillConnect({ id: '123456789', token: 'short' });
    await page.getByRole('button', { name: 'Connect & verify' }).click();
    await page.getByText('The access token must be at least 20 characters.').waitFor();
    await fillConnect({ id: 'bad-123', token: 'T'.repeat(30) });
    await page.getByRole('button', { name: 'Connect & verify' }).click();
    await page.getByText(/Unsupported get request/).waitFor();
    assert.match(await body(), /code 100/);
    assert.match(await body(), /catalog_management/);
    await page.getByTestId('catalog-pill').filter({ hasText: 'Not connected' }).waitFor();
  },
);

await check(
  'connect: valid credentials connect, the header pill and the connected Setup appear',
  async () => {
    await fillConnect({ id: '123456789', token: 'T'.repeat(30), phone: '555000111' });
    await page.getByRole('button', { name: 'Connect & verify' }).click();
    await page.getByText('Catalog connected.').first().waitFor();
    await page.getByText('ID 123456789').waitFor();
    await page
      .getByTestId('catalog-pill')
      .filter({ hasText: /META CLOUD · connected/ })
      .waitFor();
    for (const label of ['Total', 'Synced', 'Pending', 'Failed'])
      await page.getByText(label, { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Sync to Meta' }).waitFor();
    await page.screenshot({ path: `${SHOTS}/ours-setup-connected-empty.png`, fullPage: true });
  },
);

// ---- products (TW-CAT-019, 020, 021, 022) -----------------------------------------------------------------------------

const NAME = `cat-e2e Red Tee ${STAMP}`;
const SKU = `E2E-${STAMP}`;

await check('product form: required fields, live preview and the profit indicator', async () => {
  await open('/store/products/create');
  await page.getByRole('heading', { name: 'Add a product' }).waitFor();
  await page.getByRole('button', { name: 'Create product' }).click();
  await page.getByText('This field is required.').first().waitFor();
  await page.fill('#cat-p-name', NAME);
  await page.fill('#cat-p-price', '1299.50');
  await page.fill('#cat-p-compare', '1999');
  assert.match(await page.getByTestId('profit-indicator').innerText(), /-35% off/);
  await page.fill('#cat-p-compare', '1000');
  assert.match(await page.getByTestId('profit-indicator').innerText(), /Compare < price/);
  await page.fill('#cat-p-compare', '1299.50');
  assert.match(await page.getByTestId('profit-indicator').innerText(), /0% · same/);
  await page.fill('#cat-p-compare', '1999');
  const preview = page.locator('#cat-form-preview').locator('..');
  assert.match(await preview.innerText(), new RegExp(NAME.slice(0, 12)));
  assert.match(await preview.innerText(), /1,299\.50/);
  await page.selectOption('#cat-p-currency', 'USD');
  assert.match(await preview.innerText(), /\$ 1,299\.50/);
  await page.selectOption('#cat-p-currency', 'INR');
});

await check(
  'product create: price in minor units, tags de-duplicated, gallery URLs, success toast and list row',
  async () => {
    await page.fill('#cat-p-sku', SKU);
    await page.fill('#cat-p-description', 'Soft cotton tee');
    await page.fill('#cat-p-category', 'Apparel');
    await page.fill('#cat-p-tags', 'cotton, summer, cotton, ');
    await page.getByRole('button', { name: 'Add image URL' }).click();
    await page.getByLabel('Gallery image 1 URL').fill('https://picsum.photos/seed/e2e/300/300');
    await page.getByRole('button', { name: 'Create product' }).click();
    await page.getByText('Product created.').first().waitFor();
    await page.waitForURL(/\/store\/products(\?|$)/);
    const row = page.locator('tr', { hasText: NAME });
    await row.waitFor();
    assert.match(await row.innerText(), /₹ 1,299\.50/);
    assert.match(await row.innerText(), /In stock/);
    const listed = await call(`/catalog/products?q=${encodeURIComponent(SKU)}`, token);
    const p = listed.json.data.find((x) => x.sku === SKU);
    assert.equal(p.priceMinor, 129950);
    assert.equal(p.comparePriceMinor, 199900);
    assert.deepEqual(p.tags, ['cotton', 'summer']);
  },
);

await check(
  'product edit keeps the slug when renamed, and the stock toggle shows "Out" in the list',
  async () => {
    const listed = await call(`/catalog/products?q=${encodeURIComponent(SKU)}`, token);
    const before = listed.json.data.find((x) => x.sku === SKU);
    await open('/store/products');
    await page.locator('tr', { hasText: NAME }).getByRole('link', { name: 'Edit' }).click();
    await page.getByRole('heading', { name: NAME }).waitFor();
    await page.fill('#cat-p-name', `${NAME} v2`);
    await page.locator('#cat-p-instock').uncheck();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText('Product updated.').first().waitFor();
    const row = page.locator('tr', { hasText: `${NAME} v2` });
    await row.waitFor();
    assert.match(await row.innerText(), /Out/);
    const after = (
      await call(`/catalog/products?q=${encodeURIComponent(SKU)}`, token)
    ).json.data.find((x) => x.sku === SKU);
    assert.equal(after.slug, before.slug);
    // put the stock back so the later steps see an available product
    await page
      .locator('tr', { hasText: `${NAME} v2` })
      .getByRole('link', { name: 'Edit' })
      .click();
    await page.locator('#cat-p-instock').check();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText('Product updated.').first().waitFor();
  },
);

await check('products list: search by SKU, no-match state and clear', async () => {
  await open('/store/products');
  await page.getByPlaceholder('Search by name or SKU...').fill(SKU);
  await page.keyboard.press('Enter');
  await page.locator('tr', { hasText: `${NAME} v2` }).waitFor();
  await page.getByPlaceholder('Search by name or SKU...').fill('zzz-no-such');
  await page.keyboard.press('Enter');
  await page
    .getByText(/zzz-no-such/)
    .first()
    .waitFor();
  await page.getByRole('button', { name: /clear/i }).click();
  await page.locator('tr', { hasText: `${NAME} v2` }).waitFor();
});

await check(
  'share modal: storefront and phone notes, a bad number is refused, send fails without a device',
  async () => {
    await open('/store/products');
    await page
      .locator('tr', { hasText: `${NAME} v2` })
      .getByRole('button', { name: 'Share' })
      .click();
    const dlg = page.locator('dialog[open]');
    await dlg.getByText('Share product', { exact: false }).waitFor();
    const links = dlg.locator('input[readonly]');
    await page.waitForFunction(() => document.querySelector('dialog[open] input[readonly]'));
    assert.match(await links.nth(0).inputValue(), /set up your storefront slug first/);
    assert.match(await links.nth(1).inputValue(), /connect a phone number first/);
    assert.equal(await dlg.getByRole('button', { name: 'Copy' }).first().isDisabled(), true);
    await dlg.getByPlaceholder(/WhatsApp number/).fill('12345');
    await dlg.getByRole('button', { name: 'Send', exact: true }).click();
    await dlg.getByText(/valid WhatsApp number/i).waitFor();
    await page.screenshot({ path: `${SHOTS}/ours-share-modal.png` });
    await page.keyboard.press('Escape');
  },
);

// ---- connected Setup: health, sync, poll, import, commerce, automation (TW-CAT-005..011) ------------------------

await check(
  'Setup (connected): health card counts the product without an image, tiles and the waiting text',
  async () => {
    await open('/catalog');
    await page.getByText('Catalog health').waitFor();
    assert.match(await body(), /1 product needs attention before it can sell\./);
    assert.match(await body(), /1 no image/);
    await page.getByText('Show products to fix').click();
    await page.getByRole('link', { name: 'Fix →' }).first().waitFor();
    assert.match(
      await body(),
      /0 waiting\./,
      'creating the product already pushed it (TW-CAT-012)',
    );
    assert.match(await body(), /Pending\s*1/i);
  },
);

await check(
  'Sync to Meta pushes, logs the chunk, then Refresh status settles it to Synced',
  async () => {
    await page.getByRole('button', { name: 'Sync to Meta' }).click();
    await page
      .getByText(/done · 0 queued/)
      .first()
      .waitFor();
    await page.getByRole('button', { name: 'Refresh status' }).click();
    await page
      .getByText(/Polled · synced\+1 · failed\+0/)
      .first()
      .waitFor();
    await page.getByRole('button', { name: 'Import from Meta' }).click();
    await page
      .getByText(/Imported 0 · updated 0 · skipped 0 of 0/)
      .first()
      .waitFor();
    await page.screenshot({ path: `${SHOTS}/ours-setup-connected.png`, fullPage: true });
    const row = page.locator('tr', { hasText: `${NAME} v2` });
    await row
      .getByText(/synced/i)
      .first()
      .waitFor();
  },
);

await check(
  'commerce settings save to Meta; automation saves, validates max products and keeps its values',
  async () => {
    await page.locator('#cat-cart').uncheck();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Commerce settings updated.').first().waitFor();
    await page.locator('#cat-concierge').check();
    await page.fill('#cat-concierge-max', '50');
    await page.getByRole('button', { name: 'Save automation' }).click();
    await page.getByText('Enter a whole number from 1 to 30.').waitFor();
    await page.fill('#cat-concierge-max', '12');
    await page.fill('#cat-concierge-header', 'Here is what I found');
    await page.fill('#cat-pay-url', 'https://pay.example.com/c');
    await page.getByRole('button', { name: 'Save automation' }).click();
    await page.getByText('Automation settings saved.').first().waitFor();
    await open('/catalog');
    assert.equal(await page.locator('#cat-cart').isChecked(), false);
    assert.equal(await page.locator('#cat-concierge-max').inputValue(), '12');
    assert.equal(await page.locator('#cat-pay-url').inputValue(), 'https://pay.example.com/c');
  },
);

// ---- collections (TW-CAT-017, 018) ------------------------------------------------------------------------------------

const COLL = `cat-e2e Summer ${STAMP}`;
await check(
  'collections: create keeps the panel closed after, the card shows the count',
  async () => {
    await open('/catalog/collections');
    await page.getByText('New collection').click();
    await page.getByRole('button', { name: 'Create collection' }).click();
    await page
      .getByText(/Enter a name|required/i)
      .first()
      .waitFor();
    await page.getByLabel(/^Name/).first().fill(COLL);
    await page
      .getByLabel(/^Description/)
      .first()
      .fill('Seeded by the e2e run');
    await page.getByText(`${NAME} v2`, { exact: true }).first().click();
    assert.match(await page.getByText(/^1\/30$/).innerText(), /1\/30/);
    await page.getByRole('button', { name: 'Create collection' }).click();
    await page.getByText('Collection created.').first().waitFor();
    const card = page.locator('article', { hasText: COLL });
    await card.waitFor();
    assert.match(await card.innerText(), /1 product/);
    assert.equal(
      await page.locator('details[open]').count(),
      0,
      'the New collection panel should close',
    );
  },
);

await check('collections: edit renames, delete asks first', async () => {
  const card = () => page.locator('article', { hasText: COLL });
  await card().getByRole('button', { name: 'Edit', exact: true }).click();
  await card().getByLabel(/^Name/).first().fill(`${COLL} edited`);
  await card().getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Collection updated.').first().waitFor();
  const renamed = page.locator('article', { hasText: `${COLL} edited` });
  await renamed.waitFor();
  await renamed.getByRole('button', { name: 'Delete', exact: true }).click();
  const dlg = page.locator('dialog[open]');
  await dlg.getByText(/Products are not affected/).waitFor();
  await dlg.getByRole('button', { name: 'Delete' }).click();
  await page.getByText('Collection deleted.').first().waitFor();
  await page.locator('article', { hasText: COLL }).first().waitFor({ state: 'detached' });
  // keep one collection for the send panel
  await page.getByText('New collection').click();
  await page.getByLabel(/^Name/).first().fill(COLL);
  await page.getByText(`${NAME} v2`, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Create collection' }).click();
  await page.locator('article', { hasText: COLL }).waitFor();
});

// ---- send (TW-CAT-014, 015, 016, 023) ---------------------------------------------------------------------------------

psql(
  `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active) VALUES (${orgSql}, 'cat-e2e Support', '91', '9810411122', 'connected', true)`,
);

await check(
  'Send tab: format tiles drive the product rules, summary and button label',
  async () => {
    await call('/catalog/products', token, 'POST', {
      name: `cat-e2e Second ${STAMP}`,
      sku: `E2E2-${STAMP}`,
      priceMajor: '20',
      currencyCode: 'INR',
      inStock: true,
      status: 'active',
      tags: [],
      galleryUrls: [],
    });
    await open('/catalog/send');
    await page.getByText('Recipients', { exact: true }).first().waitFor();
    assert.match(await body(), /Send product →/);
    await page.getByText(`${NAME} v2`, { exact: true }).first().click();
    await page.getByText(`cat-e2e Second ${STAMP}`, { exact: true }).first().click();
    assert.match(await body(), /\(1 selected\)/);
    await page.getByText('Product list (carousel)').click();
    assert.match(await body(), /Send carousel →/);
    await page.getByText(`${NAME} v2`, { exact: true }).first().click();
    assert.match(await body(), /\(2 selected \/ 30\)/);
    await page.getByText('Catalog link').first().click();
    assert.match(await body(), /Send catalog link →/);
    assert.equal(
      await page.locator('#cat-send-products').count(),
      0,
      'products step hidden in link mode',
    );
    await page.getByText('Single product').first().click();
  },
);

await check(
  'Send tab: manual numbers are counted, de-duplicated by the server, and a send reports the result',
  async () => {
    await page.getByText('Manual numbers').click();
    await page.fill('#cat-manual', '+919810000001\n919810000001\n12345');
    assert.match(await body(), /(1|2) recipients?/);
    await page.getByText('Catalog link').first().click();
    await page.getByRole('button', { name: 'Send catalog link →' }).click();
    await page
      .getByText(/Sent to 1 recipient/)
      .first()
      .waitFor();
    await page.getByText('Product list (carousel)').click();
    await page.getByText(`${NAME} v2`, { exact: true }).first().click();
    await page.getByRole('button', { name: 'Send carousel →' }).click();
    await page
      .getByText(/Sent to 1 recipient/)
      .first()
      .waitFor();
    await page.screenshot({ path: `${SHOTS}/ours-send-result.png`, fullPage: true });
  },
);

await check('Send tab: no recipients is refused with the Reference message', async () => {
  await page.fill('#cat-manual', '');
  await page.getByRole('button', { name: 'Send carousel →' }).click();
  await page.getByText('Pick at least one contact, group or paste a number.').waitFor();
});

await check('collection Send panel: empty number asks first, then sends as MPM', async () => {
  await open('/catalog/collections');
  const card = page.locator('article', { hasText: COLL });
  await card.getByRole('button', { name: 'Send', exact: true }).click();
  await card.getByRole('button', { name: 'Send as MPM' }).click();
  await card.getByText('Enter a recipient number first.').waitFor();
  await card.getByPlaceholder('Number with country code').fill('+919810000002');
  await card.getByRole('button', { name: 'Send as MPM' }).click();
  await card.getByText(/Sent to 1 recipient/).waitFor();
});

await check(
  'Activity lists the sends newest first with the mode pills and the full number (mask_phone is switched off in Reference)',
  async () => {
    await open('/catalog/activity');
    const rows = page.locator('tbody tr');
    await rows.first().waitFor();
    assert.ok((await rows.count()) >= 3, `rows: ${await rows.count()}`);
    const text = await page.locator('tbody').innerText();
    assert.match(text, /MPM/);
    assert.match(text, /LINK/);
    assert.match(text, /919810000002/, 'Reference shows the number in full');
    await page.screenshot({ path: `${SHOTS}/ours-activity.png`, fullPage: true });
  },
);

await check(
  'Setup (connected) shows the recent send count; disconnect asks first and returns to the unconnected view',
  async () => {
    await open('/catalog');
    await page.getByRole('button', { name: 'Disconnect' }).click();
    const dlg = page.locator('dialog[open]');
    await dlg.getByText(/Products stay on Meta/).waitFor();
    await dlg.getByRole('button', { name: 'Disconnect' }).click();
    await page.getByText('Catalog disconnected.').first().waitFor();
    await page.getByTestId('catalog-pill').filter({ hasText: 'Not connected' }).waitFor();
    await page.getByText('Ready to send').first().waitFor();
    assert.match(await body(), /Unofficial API carousel mode/);
  },
);

// ---- reviews (TW-CAT-027) ---------------------------------------------------------------------------------------------

await check('reviews: tabs with counts, approve, reject, delete with confirmation', async () => {
  for (const [who, rating] of [
    ['Asha', 4],
    ['Ben', 2],
  ]) {
    psql(
      `INSERT INTO wa_product_reviews (org_id, product_id, customer_name, rating, body, status)
       SELECT org_id, id, 'cat-e2e ${who}', ${rating}, 'Review by ${who}', 'pending' FROM wa_products
       WHERE org_id = ${orgSql} AND sku = '${SKU}'`,
    );
  }
  await open('/store/reviews');
  await page.getByText('cat-e2e Asha').waitFor();
  assert.match(await page.getByRole('link', { name: /Pending/ }).innerText(), /Pending\s+2/);
  const asha = page.locator('article', { hasText: 'cat-e2e Asha' });
  assert.equal(await asha.getByRole('button', { name: 'Approve' }).count(), 1);
  await asha.getByRole('button', { name: 'Approve' }).click();
  await page.getByText('Review approved.').first().waitFor();
  await page.getByRole('link', { name: /Approved/ }).click();
  const approved = page.locator('article', { hasText: 'cat-e2e Asha' });
  await approved.waitFor();
  assert.equal(
    await approved.getByRole('button', { name: 'Approve' }).count(),
    0,
    'no Approve on the approved tab',
  );
  await page.getByRole('link', { name: /Pending/ }).click();
  const ben = page.locator('article', { hasText: 'cat-e2e Ben' });
  await ben.getByRole('button', { name: 'Reject' }).click();
  await page.getByText('Review rejected.').first().waitFor();
  await page.getByRole('link', { name: /Rejected/ }).click();
  const rejected = page.locator('article', { hasText: 'cat-e2e Ben' });
  await rejected.waitFor();
  assert.equal(
    await rejected.getByRole('button', { name: 'Reject' }).count(),
    0,
    'no Reject on the rejected tab',
  );
  await rejected.getByRole('button', { name: 'Delete' }).click();
  const dlg = page.locator('dialog[open]');
  await dlg.getByText('Delete this review?').waitFor();
  await dlg.getByRole('button', { name: 'Delete' }).click();
  await page.getByText('Review deleted.').first().waitFor();
  await page.getByText('No rejected reviews.').waitFor();
  await page.screenshot({ path: `${SHOTS}/ours-reviews.png`, fullPage: true });
});

// ---- delete, then tidy up ---------------------------------------------------------------------------------------------

await check('product delete asks first, removes the row and the list says so', async () => {
  await open('/store/products');
  const row = page.locator('tr', { hasText: `${NAME} v2` });
  await row.getByRole('button', { name: 'Delete' }).click();
  const dlg = page.locator('dialog[open]');
  await dlg.getByText('Delete this product?').waitFor();
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(
    await page.locator('tr', { hasText: `${NAME} v2` }).count(),
    1,
    'cancel keeps the row',
  );
  await row.getByRole('button', { name: 'Delete' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Delete' }).click();
  await page.getByText('Product removed.').first().waitFor();
  await page.locator('tr', { hasText: `${NAME} v2` }).waitFor({ state: 'detached' });
});

await check('the paywall returns when the plan loses the flag', async () => {
  setFlag(false);
  await open('/catalog');
  await page.getByTestId('catalog-paywall').waitFor();
});

await check('RTL: the Arabic locale mirrors the catalog shell', async () => {
  setFlag(true);
  await ctx.addCookies([{ name: 'NEXT_LOCALE', value: 'ar', url: WEB }]);
  await open('/catalog/collections');
  await page.getByTestId('catalog-pill').waitFor();
  assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
  await page.screenshot({ path: `${SHOTS}/ours-collections-rtl.png` });
  await ctx.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: WEB }]);
});

await check('no uncaught page errors', async () => assert.deepEqual(errors, []));

await browser.close();
for (const [s, n] of results) console.log(s, n);
console.log(`${results.filter(([s]) => s === 'ok').length}/${results.length} passed`);
process.exit(results.some(([s]) => s === 'FAIL') ? 1 : 0);
