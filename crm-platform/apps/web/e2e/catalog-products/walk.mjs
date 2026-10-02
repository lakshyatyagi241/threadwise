// Re-runnable Playwright walk of the catalog and product screens on OUR app.
//
//   export PATH=$HOME/.nvm/versions/node/v22.23.0/bin:$PATH
//   BASE=http://localhost:3108 API=http://localhost:53108 node apps/web/e2e/catalog-products/walk.mjs
//
// Needs the web app and the API. It signs up its own organization admin (a fresh e-mail per run), seeds 30 products with
// external image URLs through the API, then drives every screen. Screenshots land in OUT (default /tmp/cat-web-shots).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire('/home/getaweblpubt10/.npm/_npx/6bcb61ec6d5aea22/node_modules/');
const { chromium } = require('playwright');

const BASE = process.env.BASE ?? 'http://localhost:3108';
const API = process.env.API ?? 'http://localhost:53108';
const OUT = process.env.OUT ?? '/tmp/cat-web-shots';
const PASS = 'Str0ngPassw0rd#1';
const EMAIL = process.env.EMAIL ?? `cat-walk-${Date.now()}@example.com`;
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

async function api(path, token, method = 'GET', body) {
  const res = await fetch(`${API}/v2${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'idempotency-key': crypto.randomUUID(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

// ---- account and seed data
if (!process.env.EMAIL) {
  const su = await fetch(`${API}/v2/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      orgName: 'Cat Walk Org',
      fullName: 'Cat Walker',
      email: EMAIL,
      password: PASS,
      acceptTerms: true,
    }),
  });
  check('signup', su.status === 201, String(su.status));
}
const login = await (
  await fetch(`${API}/v2/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  })
).json();
const token = login.tokens.accessToken;
// first-run setup gates the app until it is finished
await api('/onboarding/workspace', token, 'POST', { name: 'Cat Walk Org', timezone: 'UTC' });
const done = await api('/onboarding/complete', token, 'POST', {});
check('onboarding finished', done.status < 300, String(done.status));
const ids = [];
for (let i = 1; i <= 30; i++) {
  const r = await api('/catalog/products', token, 'POST', {
    name: `Walk Tee ${String(i).padStart(2, '0')}`,
    sku: `WT-${String(i).padStart(3, '0')}`,
    priceMajor: String(100 + i),
    comparePriceMajor: i % 3 === 0 ? String(200 + i) : null,
    currencyCode: 'USD',
    category: i % 2 ? 'Apparel' : null,
    imageUrl: i % 5 === 0 ? null : `https://picsum.photos/seed/walk${i}/300/300`,
    inStock: i % 7 !== 0,
    status: 'active',
    tags: [],
    galleryUrls: [],
  });
  if (r.status === 201 || r.status === 200) ids.push(r.json.id);
}
check('seeded 30 products', ids.length === 30, String(ids.length));
await api('/catalog/collections', token, 'POST', {
  name: 'Summer Sale',
  description: 'Seeded',
  productIds: ids.slice(0, 3),
  isActive: true,
});

// ---- browser
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('response', async (r) => {
  if (r.status() >= 400 && r.url().includes('/api/v2/'))
    console.log(
      'HTTP',
      r.status(),
      r.request().method(),
      r.url().replace(BASE, ''),
      (await r.text().catch(() => '')).slice(0, 300),
    );
});
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
const settle = async () => {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(900);
};
const visit = async (path, name) => {
  await page.goto(`${BASE}${path}`);
  await settle();
  await shot(name);
};

await page.goto(`${BASE}/login`);
await page.locator('input[name=email]').fill(EMAIL);
await page.locator('input[name=password]').fill(PASS);
await page.getByRole('button', { name: /sign in|log in/i }).click();
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
check('signed in', true);

// ---- catalog shell and the four tabs
await visit('/catalog', 'setup-none');
check(
  'shell: breadcrumb and title',
  (await page.getByText('Integrations / WhatsApp Catalog').count()) > 0 &&
    (await page.getByText('WhatsApp chats').count()) > 0,
);
check(
  'shell: Not connected pill',
  (await page.getByTestId('catalog-pill').innerText()).includes('Not connected'),
);
const tabs = await page.locator('nav[aria-label="Catalog sections"] a').allInnerTexts();
check('shell: tab order', tabs.join('|') === 'Setup|Send|Collections|Activity', tabs.join('|'));
check(
  'setup: Connect a device first',
  (await page.getByText('Connect a device first').count()) > 0,
);
check('menu: Catalog link is real', (await page.locator('a[href="/catalog"]').count()) > 0);

// connect form: client validation then the server answers
await page.getByText('Or link a catalog manually').click();
await page.getByRole('button', { name: 'Connect & verify' }).click();
check(
  'connect: required fields flagged',
  (await page.getByText('This field is required.').count()) >= 2,
);
await page.locator('#cat-catalog-id').fill('123456789');
await page.locator('#cat-token').fill('short');
await page.getByRole('button', { name: 'Connect & verify' }).click();
check(
  'connect: token under 20 characters refused',
  (await page.getByText('at least 20 characters').count()) > 0,
);
await page.locator('#cat-token').fill('EAAxxxxxxxxxxxxxxxxxxxxxxxxxx');
await page.getByRole('button', { name: 'Connect & verify' }).click();
await settle();
await page.waitForTimeout(1500);
await shot('setup-connect-error');
const alerts = await page.locator('[role=alert]').allInnerTexts();
check(
  'connect: server refusal shown, not a raw error',
  alerts.length > 0 && !alerts.join(' ').includes('Request failed'),
  alerts.join(' / ').slice(0, 140),
);

await visit('/catalog/send', 'send-none');
check('send: Connect a device first', (await page.getByText('Connect a device first').count()) > 0);
await visit('/catalog/collections', 'collections');
check('collections: seeded card', (await page.getByText('Summer Sale').count()) > 0);
await page.getByText('New collection').click();
await page.locator('#cat-col-new-name').fill('Walk Set');
await page.getByRole('button', { name: 'Create collection' }).click();
check(
  'collections: no products refused',
  (await page.getByText('Pick at least one product.').count()) > 0,
);
await page.locator('#cat-col-new-picker label').nth(0).click();
await page.locator('#cat-col-new-picker label').nth(1).click();
await page.getByRole('button', { name: 'Create collection' }).click();
await settle();
await page.waitForTimeout(800);
await shot('collections-created');
check('collections: created', (await page.getByText('Walk Set').count()) > 0);
const walkSet = page.locator('article', { hasText: 'Walk Set' });
await walkSet.getByRole('button', { name: 'Edit' }).click();
await shot('collections-edit');
await page.getByRole('button', { name: 'Save changes' }).click();
await settle();
await walkSet.getByRole('button', { name: 'Delete' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
await settle();
check('collections: deleted', (await page.getByText('Walk Set').count()) === 0);
await visit('/catalog/activity', 'activity-empty');
check('activity: empty state', (await page.getByText('No sends yet').count()) > 0);

// ---- products list
await visit('/store/products', 'products');
check('products: 25 rows on page 1', (await page.locator('tbody tr').count()) === 25);
check('products: showing 25 of 30', (await page.getByText('Showing 25 of 30').count()) > 0);
await page.getByRole('button', { name: 'Go to page 2' }).click();
await settle();
check(
  'products: page 2 has 5 rows',
  (await page.locator('tbody tr').count()) === 5 && page.url().includes('page=2'),
);
await page.getByPlaceholder('Search by name or SKU...').fill('WT-007');
await page.keyboard.press('Enter');
await settle();
check(
  'products: search by SKU',
  (await page.locator('tbody tr').count()) === 1 && page.url().includes('q=WT-007'),
);
await shot('products-search');
await page.getByRole('button', { name: 'Share' }).first().click();
await page.getByRole('dialog').waitFor();
await settle();
await shot('products-share');
check(
  'share: modal with copy rows',
  (await page.locator('#share-public').count()) === 1 &&
    (await page.locator('#share-wa').count()) === 1,
);
await page.locator('#share-send-phone').fill('123');
await page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click();
check(
  'share: short number refused',
  (await page.getByText('Enter a valid WhatsApp number').count()) > 0,
);
await page.keyboard.press('Escape');
await page.goto(`${BASE}/store/products?q=zzzz`);
await settle();
check('products: no-match state', (await page.getByText('No products match').count()) > 0);

// ---- product form
await visit('/store/products/create', 'product-create');
await page.getByRole('button', { name: 'Create product' }).click();
check(
  'form: name and price required',
  (await page.getByText('This field is required.').count()) >= 2,
);
await page.locator('#cat-p-name').fill('Browser Made Tee');
await page.locator('#cat-p-price').fill('80');
await page.locator('#cat-p-compare').fill('100');
check(
  'form: profit indicator -20% off',
  (await page.getByTestId('profit-indicator').innerText()).includes('20%'),
);
await page.getByRole('button', { name: 'Add image URL' }).click();
await page.getByLabel('Gallery image 1 URL').fill('https://picsum.photos/seed/g1/200/200');
await page.locator('#cat-p-image').fill('https://picsum.photos/seed/main/300/300');
await page.locator('#cat-p-tags').fill('a, b, a');
await shot('product-create-filled');
await page.getByRole('button', { name: 'Create product' }).click();
await page.waitForURL(/\/store\/products$/, { timeout: 15000 });
await settle();
await page.getByPlaceholder('Search by name or SKU...').fill('Browser Made');
await page.keyboard.press('Enter');
await settle();
check('form: created product listed', (await page.getByText('Browser Made Tee').count()) > 0);
await page.getByRole('link', { name: 'Edit' }).first().click();
await page.waitForURL(/\/edit$/);
await settle();
await shot('product-edit');
check(
  'edit: prefilled with two decimals',
  (await page.locator('#cat-p-price').inputValue()) === '80.00',
);
await page.locator('#cat-p-name').fill('Browser Made Tee 2');
await page.getByRole('button', { name: 'Save changes' }).click();
await page.waitForURL(/\/store\/products$/, { timeout: 15000 });
await settle();
await page.getByPlaceholder('Search by name or SKU...').fill('Browser Made');
await page.keyboard.press('Enter');
await settle();
check('edit: saved', (await page.getByText('Browser Made Tee 2').count()) > 0);
await page.getByRole('button', { name: 'Delete' }).first().click();
await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
await settle();
check('delete: product gone', (await page.getByText('Browser Made Tee 2').count()) === 0);

// ---- reviews
await visit('/store/reviews', 'reviews');
check(
  'reviews: tabs with counts',
  (await page.locator('nav[aria-label="Review status"] a').count()) === 3,
);
check('reviews: empty pending', (await page.getByText('No pending reviews.').count()) > 0);
await visit('/store/reviews?status=rejected', 'reviews-rejected');
check('reviews: rejected tab', (await page.getByText('No rejected reviews.').count()) > 0);

// ---- arabic + rtl
await ctx.addCookies([{ name: 'NEXT_LOCALE', value: 'ar', url: BASE }]);
await visit('/store/products', 'products-ar');
check('rtl: document is rtl', (await page.locator('html').getAttribute('dir')) === 'rtl');
await visit('/catalog/collections', 'collections-ar');

check(
  'no console errors',
  consoleErrors.filter((e) => !/favicon|hydrat|status of 422|NETWORK_CHANGED/i.test(e)).length ===
    0,
  consoleErrors.slice(0, 2).join(' | ').slice(0, 200),
);
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
