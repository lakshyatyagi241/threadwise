// Re-runnable Playwright walk of the admin store screens on OUR app (the twin of the reference walk in ref-walk.mjs).
//
//   export PATH=$HOME/.nvm/versions/node/v22.23.0/bin:$PATH
//   BASE=http://localhost:3108 EMAIL=... PASS=... node apps/web/e2e/storefront-builder/admin/walk.mjs
//
// Needs: the web app, the API, an org admin (see the signup call in the parity notes) and one connected device row for
// that org (the wizard refuses to create a shop without a sender). Screenshots land in OUT (default /tmp/sf-admin-shots).
// The script creates its own shop ("E2E Walk Shop") and deletes it again, so it can be re-run.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire('/home/getaweblpubt10/.npm/_npx/6bcb61ec6d5aea22/node_modules/');
const { chromium } = require('playwright');

const BASE = process.env.BASE ?? 'http://localhost:3108';
const EMAIL = process.env.EMAIL ?? 'store-admin@example.com';
const PASS = process.env.PASS ?? 'Str0ngPassw0rd#1';
const OUT = process.env.OUT ?? '/tmp/sf-admin-shots';
const SHOP = 'E2E Walk Shop';
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
const page = await ctx.newPage();
const consoleErrors = [];
page.on(
  'response',
  (r) =>
    r.status() >= 400 &&
    !r.url().includes('/_next/') &&
    consoleErrors.push(`${r.status()} ${r.url()}`),
);
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
const settle = () => page.waitForLoadState('networkidle').catch(() => {});

// ---- sign in
await page.goto(`${BASE}/login`);
await page.locator('input[name=email]').fill(EMAIL);
await page.locator('input[name=password]').fill(PASS);
await page.getByRole('button', { name: /sign in|log in/i }).click();
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
check('signed in', true, page.url());

// ---- the menu has the Store entry (a real link, not the coming-soon placeholder)
await page.goto(`${BASE}/dashboard`);
await settle();
check('menu: Store links to /store', (await page.locator('a[href="/store"]').count()) > 0);

// ---- wizard
await page.goto(`${BASE}/connect?platform=wa-store`);
await settle();
await shot('01-wizard-initial');
const gate = await page.getByText('Connect WhatsApp first').count();
if (gate > 0) {
  check('wizard: no sender shows "Connect WhatsApp first"', true);
  check(
    'wizard: gate links to the channels screen',
    (await page.locator('a[href="/channels"]').count()) > 0,
  );
  console.log(
    'No connected device for this org: insert one in crm_commerce.devices and re-run to walk the rest.',
  );
  await browser.close();
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

// create a shop (or reach the add form)
if ((await page.getByRole('heading', { name: /Set up your store/ }).count()) === 0) {
  await page.goto(`${BASE}/connect?platform=wa-store&action=add`);
  await settle();
}
await shot('02-wizard-add');
await page.getByLabel('Shop name').fill(SHOP);
check(
  'wizard: slug readout follows the name',
  (await page.getByTestId('slug-readout').innerText()) === 'e2e-walk-shop',
);
check(
  'wizard: built-in URL preview shows the slug',
  (await page.getByTestId('built-in-url').innerText()).endsWith('/s/e2e-walk-shop'),
);

// validation: bad domain
await page.getByLabel(/Custom domain/).fill('https://bad.example.com');
await page.getByRole('button', { name: /Create shop/ }).click();
check(
  'wizard: a domain with a scheme is refused',
  (await page.getByText(/doesn't look like a valid domain/).count()) > 0,
);
await page.getByLabel(/Custom domain/).fill('');
await page.getByRole('button', { name: /Create shop/ }).click();
await page.getByText(`Shop "${SHOP}" created.`).waitFor({ timeout: 15000 });
check('wizard: create shows the success toast and returns to the list', true);
await settle();
await shot('03-wizard-list');
check(
  'wizard: the new shop is in the list',
  (await page.getByRole('heading', { name: SHOP }).count()) > 0,
);
check(
  'wizard: card shows a Live pill',
  (await page.getByText('Live', { exact: true }).count()) > 0,
);

// share modal
const card = page.locator('article', { hasText: SHOP });
await card.getByRole('button', { name: `Share ${SHOP}` }).click();
check(
  'share: modal opens with the shop name',
  await page.getByRole('dialog').getByText(SHOP).first().isVisible(),
);
await page.getByRole('button', { name: 'Copy', exact: true }).click();
await page
  .getByRole('button', { name: /Copied/ })
  .waitFor({ timeout: 3000 })
  .catch(() => {});
check(
  'share: Copy reads "Copied ✓"',
  (await page.getByRole('button', { name: /Copied/ }).count()) > 0,
);
check(
  'share: clipboard holds the shop URL',
  (await page.evaluate(() => navigator.clipboard.readText())).includes('/s/e2e-walk-shop'),
);
await page.getByText('Show QR code').click();
check(
  'share: the QR code is an inline SVG (no third party)',
  (await page.locator('dialog svg[role="img"], dialog svg title').count()) > 0,
);
await shot('04-share');
await page.keyboard.press('Escape');
check('share: Escape closes the modal', (await page.locator('dialog[open]').count()) === 0);

// edit
await card.getByRole('link', { name: /Edit/ }).click();
await page.getByRole('button', { name: 'Save changes' }).waitFor({ timeout: 15000 });
await settle();
await shot('05-wizard-edit');
check(
  'wizard edit: slug is locked',
  (await page.getByText(/Locked once the store is live/).count()) > 0,
);
check(
  'wizard edit: "This shop is live" panel',
  (await page.getByText('This shop is live').count()) > 0,
);
await page.getByLabel('Shop name').fill(`${SHOP} 2`);
check(
  'wizard edit: renaming does not change the slug',
  (await page.getByTestId('slug-readout').innerText()) === 'e2e-walk-shop',
);
await page.getByRole('button', { name: 'Save changes' }).click();
await page.getByText(`Shop "${SHOP} 2" updated.`).waitFor({ timeout: 15000 });
check('wizard edit: save shows the toast', true);

// ---- dashboard
await page.goto(`${BASE}/store`);
await settle();
await shot('06-dashboard');
for (const label of ['Revenue (30d)', 'Orders (30d)', 'Avg order', 'Products', 'Visits (30d)']) {
  check(`dashboard: KPI "${label}"`, (await page.getByText(label, { exact: true }).count()) > 0);
}
check('dashboard: sales chart is an SVG', (await page.locator('svg[role="img"]').count()) > 0);
check('dashboard: Bestsellers card', (await page.getByText('Bestsellers').count()) > 0);
check('dashboard: Recent orders card', (await page.getByText('Recent orders').count()) > 0);
check(
  'dashboard: empty copy for no orders (or a table)',
  (await page.getByText(/No orders yet|Customer/).count()) > 0,
);
const side = page.getByRole('complementary', { name: 'Store' });
for (const label of [
  'Orders',
  'Groups',
  'Coupons',
  'Payments',
  'Checkout gateways',
  'Customers',
  'Invoices',
]) {
  const row = side.locator('[aria-disabled="true"]', { hasText: label });
  check(
    `sidebar: ${label} is disabled with "Coming soon"`,
    (await row.count()) === 1 && (await row.innerText()).includes('Coming soon'),
  );
}
check(
  'sidebar: Products links to /store/products',
  (await side.locator('a[href="/store/products"]').count()) === 1,
);
check(
  'sidebar: Reviews links to /store/reviews',
  (await side.locator('a[href="/store/reviews"]').count()) === 1,
);
check(
  'sidebar: public URL box has Open and Copy',
  (await side.getByText('Copy', { exact: true }).count()) === 1,
);

// ---- settings
await side.getByRole('link', { name: 'Storefront' }).click();
await page.getByRole('heading', { name: 'Storefront design' }).waitFor({ timeout: 15000 });
await page.locator('input[type=radio]').first().waitFor({ timeout: 15000 });
await settle();
await shot('07-settings');
check(
  'settings: title',
  (await page.getByRole('heading', { name: 'Storefront design' }).count()) > 0,
);
await page.locator('input[type=radio]').first().waitFor({ timeout: 15000 });
check(
  'settings: eight theme tiles',
  (await page.locator('input[type=radio][name$="-theme"]').count()) === 8,
  String(await page.locator('input[type=radio]').count()),
);
await page.getByText('Noir', { exact: false }).first().click();
await page.getByLabel('Hero text').fill('Hello from the walk');
await page.getByLabel('Brand color (hex)').fill('red');
await page.getByRole('button', { name: 'Save' }).click();
check(
  'settings: invalid colour is refused before the request',
  (await page.getByText(/hex color/).count()) > 0,
);
await page.getByLabel('Brand color (hex)').fill('#12ab9F');
await page.getByLabel('Flat shipping fee').fill('49.5');
await page.getByLabel('Free shipping above').fill('999');
await page.getByLabel('Provider').selectOption('razorpay_api');
await page.getByLabel('Key ID').fill('rzp_test_walk');
await page.getByLabel('Key secret').fill('s3cret-walk');
await page.getByRole('button', { name: 'Save' }).click();
await page.getByText('Storefront updated.').waitFor({ timeout: 15000 });
check('settings: save shows "Storefront updated."', true);
await settle();
check(
  'settings: secret box is empty again and says it is stored',
  (await page.getByLabel('Key secret').inputValue()) === '' &&
    (await page.getByLabel('Key secret').getAttribute('placeholder'))?.includes('saved'),
);
await page.reload();
await settle();
check(
  'settings: values persist after reload',
  (await page.getByLabel('Hero text').inputValue()) === 'Hello from the walk' &&
    (await page.getByLabel('Flat shipping fee').inputValue()).startsWith('49.5'),
);
await page.getByLabel('Abandoned-cart recovery', { exact: false }).count();
await page.getByLabel('Delay (minutes)').fill('3');
await page.getByRole('button', { name: 'Save' }).click();
check(
  'settings: delay below 5 is refused',
  (await page.getByText(/whole number from 5 to 1440/).count()) > 0,
);
await page.getByLabel('Delay (minutes)').fill('30');
await page.getByLabel('Custom domain').fill('shop.e2e-walk.example.com');
await page.getByRole('button', { name: 'Save' }).click();
await page.getByText('Storefront updated.').waitFor({ timeout: 15000 });
await settle();
check(
  'settings: unverified domain shows the CNAME hint and Verify now',
  (await page.getByText('Add this CNAME at your DNS provider:').count()) > 0 &&
    (await page.getByRole('button', { name: 'Verify now' }).count()) > 0,
);
await page.getByRole('button', { name: 'Verify now' }).click();
await page.getByText(/CNAME not pointing to/).waitFor({ timeout: 15000 });
check('settings: Verify now reports a failure for a domain without DNS', true);
await shot('08-settings-domain');

// ---- redirect when no shop is known is covered by the wizard delete below
await page.goto(`${BASE}/connect?platform=wa-store`);
await settle();
const own = page.locator('article', { hasText: SHOP });
await own.getByRole('button', { name: /^Delete / }).click();
check(
  'delete: confirm dialog names the shop',
  (await page
    .getByRole('dialog')
    .getByText(/Delete .*\?/)
    .count()) > 0,
);
await shot('09-delete-confirm');
await page.getByRole('button', { name: 'Yes, delete' }).click();
await page.getByText('Shop deleted.').waitFor({ timeout: 15000 });
check('delete: toast "Shop deleted."', true);

// ---- /store with no shop sends the person to the wizard (only when this was the last shop)
await page.goto(`${BASE}/store`);
await settle();
const finalUrl = page.url();
console.log('after delete /store ->', finalUrl);

// the 404 STORE_NO_SHOP of /store/overview after the last shop is deleted is the expected redirect trigger
const unexpected = consoleErrors.filter(
  (e) => !(e.startsWith('404') && e.includes('/store/overview')),
);
check(
  'no unexpected 4xx/5xx responses',
  unexpected.length === 0,
  unexpected.slice(0, 3).join(' | '),
);
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
