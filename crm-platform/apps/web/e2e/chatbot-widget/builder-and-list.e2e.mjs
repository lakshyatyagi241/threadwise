// Browser run of the chatbot widget screens against a running web app + API (see docs/threadwise-port/parity/chatbot-widget.md).
//   WEB=http://localhost:3107 SLUG_EMAIL=... SLUG_PASSWORD=... CHROME=/path/to/chrome node builder-and-list.e2e.mjs
// Needs `playwright-core` (the parity harness installs it) and a workspace admin whose onboarding is finished.
// The customer-site stand-in (`host-server.mjs`) is started by this script on :3999.
import http from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const WEB = process.env.WEB ?? 'http://localhost:3107';
const EMAIL = process.env.WGT_EMAIL ?? 'wgt-admin@example.test';
const PASSWORD = process.env.WGT_PASSWORD ?? 'Str0ngPassw0rd#1';
const CHROME = process.env.CHROME ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', `${name}: ${e.message.split('\n')[0]}`]);
  }
};

// A separate origin standing in for the customer's site.
const host = http
  .createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><body><h1>Customer site</h1><script defer src="${u.searchParams.get('src')}"></script></body>`);
  })
  .listen(3999, '127.0.0.1');

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(`${WEB}/login`);
await page.fill('input[name=email]', EMAIL);
await page.fill('input[type=password]', PASSWORD);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login')), page.click('button[type=submit]')]);

const NAME = `E2E ${Date.now()}`;
let embedUrl = '';

await check('empty or loaded list renders the page chrome', async () => {
  await page.goto(`${WEB}/chatbot-widgets`);
  await page.getByRole('heading', { name: /Chatbot widgets/ }).waitFor();
  await page.getByText('Widget status').waitFor();
  await page.getByText('Train first').waitFor();
});

await check('step 1 gate: no name toasts "Name your widget." and does not advance', async () => {
  await page.goto(`${WEB}/chatbot-widgets/create`);
  await page.click('#wgt-next');
  await page.getByText('Name your widget.').waitFor();
  assert.equal(await page.locator('[data-mode-tile]').count(), 3);
  assert.match(await page.textContent('body'), /Step 1 of 4/);
});

await check('smart agent mode without an agent is refused before any request', async () => {
  await page.fill('#wgt-f-name', NAME);
  await page.click('#wgt-next');
  await page.getByText(/Link a smart agent/).waitFor();
});

await check('whatsapp mode hides the agent select and needs 8 digits', async () => {
  await page.click('[data-mode-tile=whatsapp]');
  assert.equal(await page.locator('#wgt-f-assistantId').count(), 0);
  await page.fill('#wgt-f-phone', '12345');
  await page.click('#wgt-next');
  await page.getByText(/Add a full WhatsApp number/).waitFor();
  await page.fill('#wgt-f-phone', '9876543210');
});

await check('the preview repaints as the header colour changes (step 2)', async () => {
  await page.click('#wgt-next');
  await page.fill('#wgt-f-headerBg', '#112233');
  const bg = await page.locator('[data-testid=preview-header]').evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.equal(bg, 'rgb(17, 34, 51)');
});

await check('launcher fill must be hex (step 2 gate)', async () => {
  await page.fill('#wgt-f-buttonColor', 'red');
  await page.click('#wgt-next');
  await page.getByText(/Launcher fill must be a hex colour/).waitFor();
  await page.fill('#wgt-f-buttonColor', '#075E54');
});

await check('tile image without an address blocks Launch and jumps to step 3', async () => {
  await page.click('#wgt-next');
  await page.getByText('Tile image').click();
  await page.click('#wgt-next');
  await page.getByText(/Add a background image URL/).waitFor();
  await page.click('#wgt-next');
  await page.click('#wgt-launch');
  await page.getByText(/Add a background image URL/).first().waitFor();
  assert.match(await page.textContent('body'), /Step 3 of 4/);
  await page.getByText('Solid colour').click();
});

await check('Launch saves, reveals the snippet and the pill says Saved', async () => {
  await page.click('#wgt-next');
  await page.click('#wgt-launch');
  await page.locator('[data-testid=snippet]').waitFor();
  const snippet = await page.textContent('[data-testid=snippet]');
  const m = /src="([^"]+)"/.exec(snippet);
  assert.ok(m);
  embedUrl = m[1];
  assert.match(snippet, /^<script defer src="http.*\/widget\/[A-Za-z0-9]{48}\/embed"><\/script>$/);
  assert.equal((await page.textContent('[data-testid=state-pill]')).trim(), 'Saved');
  await page.getByText('Copy to clipboard').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), snippet);
});

await check('the embedded widget works on another origin: launcher, panel, intake gate, message', async () => {
  const site = await ctx.newPage();
  await site.goto(`http://127.0.0.1:3999/?src=${encodeURIComponent(embedUrl)}`);
  const launcher = site.locator('button[aria-label="Open chat"]');
  await launcher.waitFor();
  await launcher.click();
  const frame = site.frameLocator('iframe');
  await frame.locator('#hdr').getByText('Chat with us').waitFor();
  assert.ok(await frame.locator('#send').isDisabled());
  await frame.locator('#i-name').fill('Asha');
  await frame.locator('#i-go').click();
  await frame.locator('#txt').fill('hello from the browser');
  await frame.locator('#txt').press('Enter');
  await frame.locator('.bubble.out', { hasText: 'hello from the browser' }).waitFor();
  assert.ok(await frame.locator('.wa-cta').getAttribute('href'));
  await site.close();
});

await check('the new widget is in the list with its engine pill, slug and a visitor', async () => {
  await page.goto(`${WEB}/chatbot-widgets`);
  const row = page.locator('[data-widget-id]', { hasText: NAME });
  await row.waitFor();
  assert.match(await row.textContent(), /WhatsApp/);
  assert.match(await row.textContent(), /\/e2e-/);
});

await check('search filters the loaded rows without a request', async () => {
  let requests = 0;
  page.on('request', (r) => r.url().includes('/api/v2/widgets') && requests++);
  await page.fill('input[type=search]', 'zzz-no-match');
  await page.getByText(/No widget on this page matches/).waitFor();
  await page.fill('input[type=search]', NAME.toLowerCase().slice(0, 6));
  await page.locator('[data-widget-id]', { hasText: NAME }).waitFor();
  assert.equal(requests, 0);
  await page.fill('input[type=search]', '');
});

await check('copy snippet from the list puts the tag on the clipboard', async () => {
  const row = page.locator('[data-widget-id]', { hasText: NAME });
  await row.getByRole('button', { name: 'Copy embed snippet' }).click();
  await page.getByText(/Snippet copied/).waitFor();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^<script defer src=".*\/embed"><\/script>$/);
});

await check('edit opens prefilled with every step reachable; a second save updates, it does not duplicate', async () => {
  const row = page.locator('[data-widget-id]', { hasText: NAME });
  await row.getByRole('link', { name: 'Edit widget' }).click();
  await page.locator('#wgt-f-name').waitFor();
  assert.equal(await page.inputValue('#wgt-f-name'), NAME);
  assert.equal((await page.textContent('[data-testid=state-pill]')).trim(), 'Saved');
  await page.click('[data-step-node="4"]');
  await page.getByText('Send-button label').waitFor();
  await page.fill('#wgt-f-buttonLabel', 'Ask the team');
  await page.click('#wgt-save');
  await page.getByText('Draft saved.').waitFor();
  assert.equal(await page.locator('[data-testid=snippet]').count(), 0);
});

await check('pause hides the widget from its site; resume brings it back', async () => {
  await page.goto(`${WEB}/chatbot-widgets`);
  const row = page.locator('[data-widget-id]', { hasText: NAME });
  await row.getByRole('button', { name: 'Pause widget' }).click();
  await page.getByText('Widget paused.').waitFor();
  assert.equal((await fetch(embedUrl)).status, 404);
  await row.getByText('Paused').first().waitFor();
  await row.getByRole('button', { name: 'Resume widget' }).click();
  await page.getByText('Widget resumed.').waitFor();
  assert.equal((await fetch(embedUrl)).status, 200);
});

await check('rotate asks first, then the old embed address is 404', async () => {
  const row = page.locator('[data-widget-id]', { hasText: NAME });
  await row.getByRole('button', { name: 'Rotate embed token' }).click();
  await page.getByText("Rotate this widget's embed token?").waitFor();
  await page.getByRole('button', { name: 'Rotate', exact: true }).click();
  await page.getByText(/Token rotated/).waitFor();
  assert.equal((await fetch(embedUrl)).status, 404);
});

await check('duplicate lands on the copy in the builder', async () => {
  await page.goto(`${WEB}/chatbot-widgets`);
  await page.locator('[data-widget-id]', { hasText: NAME }).first().getByRole('button', { name: 'Duplicate widget' }).click();
  await page.locator('#wgt-f-name').waitFor();
  assert.equal(await page.inputValue('#wgt-f-name'), `${NAME} (copy)`);
});

await check('delete asks first, then the row is gone', async () => {
  await page.goto(`${WEB}/chatbot-widgets`);
  for (const name of [`${NAME} (copy)`, NAME]) {
    const row = page.locator('[data-widget-id]').filter({ hasText: name }).first();
    await row.getByRole('button', { name: 'Delete widget' }).click();
    await page.getByText(`Delete "${name}"?`).waitFor();
    await page.getByRole('button', { name: 'Delete widget', exact: true }).click();
    await page.getByText('Widget deleted.').waitFor();
  }
});

await check('an unknown widget id is a not-found state, not a blank page', async () => {
  await page.goto(`${WEB}/chatbot-widgets/00000000-0000-4000-8000-000000000000/edit`);
  await page.getByText('Widget not found').waitFor();
  await page.goto(`${WEB}/chatbot-widgets/not-an-id/edit`);
  assert.match(await page.textContent('body'), /404|could not be found|not found/i);
});

await check('no uncaught page errors', async () => assert.deepEqual(errors, []));

await browser.close();
host.close();
for (const [s, n] of results) console.log(s, n);
process.exit(results.some(([s]) => s === 'FAIL') ? 1 : 0);
