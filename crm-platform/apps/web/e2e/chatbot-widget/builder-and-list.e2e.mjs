// Browser run of the chatbot widget screens against a running web app + API (see docs/wadesk-port/parity/chatbot-widget.md).
//   WEB=http://localhost:3107 WGT_EMAIL=... WGT_PASSWORD=... CHROME=/path/to/chrome node builder-and-list.e2e.mjs
// Needs `playwright-core` (the parity harness installs it) and a workspace admin whose onboarding is finished.
// The smart-agent steps need one assistant row: this script inserts it with `psql` through `docker exec crm-postgres`
// (override the whole command with PSQL='["psql","-U","crm","-d","crm_wgt","-tAc"]') and removes it at the end.
// The customer-site stand-in is started by this script on :3999; wa.me is answered locally, nothing leaves the machine.
import http from 'node:http';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const WEB = process.env.WEB ?? 'http://localhost:3107';
const EMAIL = process.env.WGT_EMAIL ?? 'wgt-admin@example.test';
const PASSWORD = process.env.WGT_PASSWORD ?? 'Str0ngPassw0rd#1';
const ORG_SLUG = process.env.WGT_ORG ?? 'widget-org';
const CHROME =
  process.env.CHROME ??
  `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
const PSQL = JSON.parse(
  process.env.PSQL ??
    '["docker","exec","crm-postgres","psql","-U","crm","-d","crm_wgt","-tAc"]',
);
const psql = (sql) =>
  execFileSync(PSQL[0], [...PSQL.slice(1), sql], { encoding: 'utf8' }).trim();

const results = [];
let shot = 0;
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', `${name}: ${e.message.split('\n')[0]}`]);
    await page
      .screenshot({ path: `${process.env.SHOTS ?? '.'}/fail-${++shot}.png` })
      .catch(() => undefined);
  }
};

// A separate origin standing in for the customer's site.
const host = http
  .createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    res.setHeader('content-type', 'text/html');
    res.end(
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body><h1>Customer site</h1><script defer src="${u.searchParams.get('src')}"></script></body>`,
    );
  })
  .listen(3999, '127.0.0.1');

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
// "Start Conversation" opens WhatsApp in a new tab: answer it here so the run needs no network.
const opened = [];
const answerWhatsapp = (c) =>
  c.route('https://wa.me/**', (route) => {
    opened.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>WhatsApp</h1>' });
  });
await answerWhatsapp(ctx);
// The customer's site gets a browser context of its own: a second tab in the builder's context would take the builder's
// frames out of the foreground, and the preview frame would stop receiving clicks.
const siteCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await answerWhatsapp(siteCtx);
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(`${WEB}/login`);
const slug = page.locator('input[name=orgSlug], input[name=workspace]');
if (await slug.count()) await slug.first().fill(ORG_SLUG);
await page.fill('input[name=email]', EMAIL);
await page.fill('input[type=password]', PASSWORD);
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith('/login')),
  page.click('button[type=submit]'),
]);

// The consent bar floats over the bottom of every page until a choice is made.
await page.waitForTimeout(1500);
await page
  .getByRole('button', { name: /decline|reject/i })
  .first()
  .click({ timeout: 4000 })
  .catch(() => undefined);

const STAMP = Date.now();
const AGENT = `E2E agent ${STAMP}`;
const WIZARD = `E2E wizard ${STAMP}`;
const NAME = `E2E whatsapp ${STAMP}`;
psql(
  `INSERT INTO ai_chat_assistants (org_id, name, slug, fallback_message) VALUES ((SELECT id FROM organizations WHERE slug = '${ORG_SLUG}'), '${AGENT}', 'e2e-agent-${STAMP}', 'fallback') RETURNING uuid`,
);

const wizardEmbed = { url: '' };
let embedUrl = '';

/** The launcher and the panel the real embed script draws, on the stand-in customer site. */
const onSite = async (src, viewport = { width: 1280, height: 800 }) => {
  const site = await siteCtx.newPage();
  await site.setViewportSize(viewport);
  await site.goto(`http://127.0.0.1:3999/?src=${encodeURIComponent(src)}`);
  return site;
};
const preview = () => page.frameLocator('[data-testid=launcher-preview-frame]');
/** Polls until `fn` is truthy (the preview frame is sandboxed, so the page cannot read into it: ask it through the locators). */
const until = async (fn, ms = 10000) => {
  const start = Date.now();
  for (;;) {
    try {
      if (await fn()) return;
    } catch {
      /* not there yet */
    }
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${fn.toString().slice(0, 90)}`);
    await page.waitForTimeout(100);
  }
};
const cardOpen = (n) => page.locator(`[data-card="${n}"]`).getAttribute('data-open');

// --- the list ------------------------------------------------------------------------------------------------------------

await check('empty or loaded list renders the page chrome', async () => {
  await page.goto(`${WEB}/chatbot-widgets`);
  await page.getByRole('heading', { name: /Chatbot widgets/ }).waitFor();
  await page.getByText('Widget status').waitFor();
  await page.getByText('Train first').waitFor();
});

// --- the four-step wizard: smart agent and both engines (WaDesk's builder, unchanged) ------------------------------------------

await check('step 1 gate: no name toasts "Name your widget." and does not advance', async () => {
  await page.goto(`${WEB}/chatbot-widgets/create`);
  await page.click('#wgt-next');
  await page.getByText('Name your widget.').waitFor();
  assert.equal(await page.locator('[data-mode-tile]').count(), 3);
  assert.match(await page.textContent('body'), /Step 1 of 4/);
});

await check('smart agent mode without an agent is refused before any request', async () => {
  await page.fill('#wgt-f-name', WIZARD);
  await page.click('#wgt-next');
  await page.getByText(/Link a smart agent/).waitFor();
});

await check('the wizard stays the wizard for Smart agent and Smart + WhatsApp', async () => {
  await page.click('[data-mode-tile=both]');
  assert.equal(await page.locator('[data-testid=whatsapp-builder]').count(), 0);
  assert.match(await page.textContent('body'), /Step 1 of 4/);
  await page.selectOption('#wgt-f-assistantId', { label: AGENT });
  await page.fill('#wgt-f-phone', '12345');
  await page.click('#wgt-next');
  await page.getByText(/Add a full WhatsApp number/).waitFor();
  await page.fill('#wgt-f-phone', '9876543210');
});

await check('the preview repaints as the header colour changes (step 2)', async () => {
  await page.click('#wgt-next');
  await page.fill('#wgt-f-headerBg', '#112233');
  const bg = await page
    .locator('[data-testid=preview-header]')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
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
  await page.locator('label', { hasText: /^Tile image$/ }).click();
  await page.click('#wgt-next');
  await page.getByText(/Add a background image URL/).waitFor();
  // Save draft walks every step, so an incomplete draft can never be saved.
  await page.click('#wgt-save');
  await page
    .getByText(/Add a background image URL/)
    .first()
    .waitFor();
  assert.match(await page.textContent('body'), /Step 3 of 4/);
  await page.locator('label', { hasText: /^Solid colour$/ }).click();
});

await check('Launch saves, reveals the snippet and the pill says Saved', async () => {
  await page.click('#wgt-next');
  await page.click('#wgt-launch');
  await page.locator('[data-testid=snippet]').waitFor();
  const snippet = await page.textContent('[data-testid=snippet]');
  const m = /src="([^"]+)"/.exec(snippet);
  assert.ok(m);
  wizardEmbed.url = m[1];
  assert.match(snippet, /^<script defer src="http.*\/widget\/[A-Za-z0-9]{48}\/embed"><\/script>$/);
  assert.equal((await page.textContent('[data-testid=state-pill]')).trim(), 'Saved');
  await page.getByText('Copy to clipboard').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), snippet);
});

await check(
  'the wizard widget works on another origin: launcher, framed chat, intake gate, message',
  async () => {
    const site = await onSite(wizardEmbed.url);
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
  },
);

// --- the WhatsApp widget page: Install & Customize (WD-WGT-028) ------------------------------------------------------------

await check('choosing WhatsApp turns the builder into the Install & Customize page with five cards, the first open', async () => {
  await page.goto(`${WEB}/chatbot-widgets/create`);
  await page.click('[data-mode-tile=whatsapp]');
  await page.getByRole('heading', { name: /WhatsApp Widget/ }).waitFor();
  await page.getByText('Install & Customize').waitFor();
  assert.equal(await page.locator('[data-card]').count(), 5);
  const head = page.locator('[data-card] h2 button > span:first-child');
  assert.deepEqual(await head.locator('span:nth-child(1)').allTextContents(), [
    'Style your WhatsApp chat button',
    'Design your messenger',
    'Set your welcome message',
    'Set your Chat Button position',
    'Configure your WhatsApp number',
  ]);
  assert.deepEqual(await head.locator('span:nth-child(2)').allTextContents(), [
    'Pick a beautiful chat button designs what suits your website best',
    'Pick a beautiful image for your messenger',
    'Welcome your customers',
    'Adjust your button position on computers and mobile',
    'Connect the WhatsApp number to the messenger',
  ]);
  assert.equal(await cardOpen(1), 'true');
  assert.equal(await page.getByRole('button', { name: 'Save Changes' }).count(), 1);
  assert.equal(await page.locator('[data-testid=launcher-preview-frame]').count(), 1);
});

await check('it is an accordion: one card open at a time, the open one has the green border, a click on it closes it', async () => {
  await page.click('#wgt-card-head-3');
  assert.equal(await cardOpen(3), 'true');
  assert.equal(await cardOpen(1), 'false');
  assert.equal(await page.locator('[data-card][data-open=true]').count(), 1);
  assert.equal(await page.locator('#wgt-card-body-1').isHidden(), true);
  // the open card is the green one (emerald border), the closed ones carry the neutral border
  assert.match(await page.locator('[data-card="3"]').getAttribute('class'), /border-emerald-500/);
  assert.doesNotMatch(await page.locator('[data-card="1"]').getAttribute('class'), /border-emerald-500/);
  await page.click('#wgt-card-head-3');
  assert.equal(await page.locator('[data-card][data-open=true]').count(), 0);
  await page.click('#wgt-card-head-1');
});

await check('card 1: both button types are shown as samples; the preview follows the choice', async () => {
  assert.match(await page.locator('[data-button-type=pill]').innerText(), /Chat With Us/);
  assert.equal(await page.locator('[data-button-type=icon]').innerText(), '');
  const launcher = preview().locator('[data-testid=wgt-launcher]');
  await launcher.waitFor();
  assert.match(await launcher.innerText(), /Chat With Us/);
  await page.locator('[data-button-type=icon] input').check();
  await until(async () => (await preview().locator('[data-testid=wgt-launcher]').innerText()) === '');
  const box = await preview().locator('[data-testid=wgt-launcher]').boundingBox();
  assert.ok(Math.abs(box.width - box.height) < 1, 'icon-only is round');
  await page.locator('[data-button-type=pill] input').check();
});

await check('card 1: twelve named colours, the chosen one outlined; the preview takes its gradient', async () => {
  const names = await page.locator('[data-colour]:not([data-colour=custom])').allTextContents();
  assert.deepEqual(
    names.map((n) => n.trim()),
    [
      'The Original',
      'Teal Deal',
      'Green Lime',
      'Blue Lagoon',
      'Red Cherry',
      'Orange Sunset',
      'Yellow Sand',
      'Pink Margarita',
      'Navy Suit',
      'Purple Velvet',
      'Silver Spoon',
      'Dark Night',
    ],
  );
  assert.equal(await page.locator('[data-colour=original]').getAttribute('aria-checked'), 'true');
  await page.click('[data-colour=blue-lagoon]');
  assert.equal(await page.locator('[data-colour=blue-lagoon]').getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('[data-colour=original]').getAttribute('aria-checked'), 'false');
  assert.match(await page.locator('[data-colour=blue-lagoon]').getAttribute('class'), /outline-violet-600/);
  assert.equal(
    await page.locator('[data-colour=blue-lagoon]').evaluate((el) => getComputedStyle(el).outlineStyle),
    'solid',
  );
  await until(async () => (await preview().locator('[data-testid=wgt-launcher]').evaluate((el) => el.style.background)).includes('rgb(56, 189, 248)'));
});

await check('card 1: "Pick a custom color" takes a hex colour and the preview follows it', async () => {
  await page.fill('#wgt-f-customColour', '#336699');
  await page.locator('[data-colour=custom]').waitFor();
  assert.match(await page.locator('[data-colour=custom]').innerText(), /#336699/);
  await until(async () => (await preview().locator('[data-testid=wgt-launcher]').evaluate((el) => el.style.background)).includes('rgb(51, 102, 153)'));
  await page.click('[data-colour=original]');
});

await check('card 2: built-in images and an own image address; a bad address is refused on save', async () => {
  await page.click('#wgt-card-head-2');
  assert.equal(await page.locator('[data-avatar]').count(), 4);
  const before = await preview().locator('[data-testid=wgt-launcher]').count();
  assert.equal(before, 1);
  await page.locator('[data-avatar=store]').click();
  await until(async () => ((await preview().locator('#wgt-panel-preview img').getAttribute('src')) ?? '').includes('image/svg'));
  await page.fill('#wgt-f-avatar', 'javascript:alert(1)');
  await page.fill('#wgt-f-name', NAME);
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await page.getByText('Use a built-in image or an http(s) image address.').waitFor();
  assert.equal(await cardOpen(2), 'true');
  await page.fill('#wgt-f-avatar', 'https://example.com/logo.png');
  await page.locator('[data-avatar=chat]').click();
  assert.equal(await page.inputValue('#wgt-f-avatar'), '');
});

await check('card 3: greeting and intro message reach the panel in the preview, with a time and Start Conversation', async () => {
  await page.click('#wgt-card-head-3');
  await page.fill('#wgt-f-greeting', 'Namaste!');
  await page.fill('#wgt-f-introMessage', 'We reply within minutes.');
  const panel = preview().locator('[data-testid=wgt-embed]');
  await preview().locator('[data-testid=wgt-launcher]').click();
  await preview().locator('[data-testid=wgt-greeting]').getByText('Namaste!').waitFor();
  await preview().locator('[data-testid=wgt-intro]').getByText('We reply within minutes.').waitFor();
  assert.match(await preview().locator('[data-testid=wgt-intro]').innerText(), /\d{1,2}:\d{2}/);
  await preview().getByText('Typically replies within 5 mins').waitFor();
  assert.equal(await preview().locator('[data-testid=wgt-start]').innerText(), 'Start Conversation');
  assert.equal(await panel.count(), 1);
  // the panel stays open while the options keep changing
  await page.fill('#wgt-f-greeting', 'Namaste friends!');
  await preview().locator('[data-testid=wgt-greeting]').getByText('Namaste friends!').waitFor();
  assert.equal(await preview().locator('[data-testid=wgt-close]').isVisible(), true);
});

await check('card 3: the round button closes the panel and the launcher is back', async () => {
  await preview().locator('[data-testid=wgt-close]').click();
  await preview().locator('[data-testid=wgt-launcher]').waitFor();
  assert.equal(await preview().locator('[data-testid=wgt-start]').isVisible(), false);
});

await check('card 4: desktop and mobile previews, side and spacing change where the launcher sits', async () => {
  await page.click('#wgt-card-head-4');
  assert.equal(await page.locator('[data-testid=launcher-preview]').getAttribute('data-device'), 'desktop');
  // defaults: desktop right 10/10, mobile right 10/60
  assert.equal(await page.inputValue('#wgt-f-desktopSideSpacing'), '10');
  assert.equal(await page.inputValue('#wgt-f-desktopBottomSpacing'), '10');
  assert.equal(await page.inputValue('#wgt-f-mobileSideSpacing'), '10');
  assert.equal(await page.inputValue('#wgt-f-mobileBottomSpacing'), '60');
  const place = () =>
    preview()
      .locator('[data-testid=wgt-embed]')
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return { left: s.left, right: s.right, bottom: s.bottom, dev: el.getAttribute('data-dev') };
      });
  let p = await place();
  assert.equal(p.dev, 'd');
  assert.equal(p.right, '10px');
  assert.equal(p.bottom, '10px');
  await page.locator('[data-side=desktop-left]').click();
  await page.fill('#wgt-f-desktopSideSpacing', '24');
  await page.fill('#wgt-f-desktopBottomSpacing', '32');
  await until(async () => (await place()).left === '24px');
  p = await place();
  assert.equal(p.bottom, '32px');
  await page.locator('[data-preview-device=mobile]').click();
  await until(async () => (await place()).dev === 'm');
  assert.equal(await page.locator('[data-testid=launcher-preview]').getAttribute('data-device'), 'mobile');
  p = await place();
  assert.equal(p.bottom, '60px');
  assert.equal(p.right, '10px');
  await page.locator('[data-side=mobile-left]').click();
  await page.fill('#wgt-f-mobileSideSpacing', '6');
  await page.fill('#wgt-f-mobileBottomSpacing', '90');
  await until(async () => (await place()).bottom === '90px');
  p = await place();
  assert.equal(p.left, '6px');
  await page.locator('[data-preview-device=desktop]').click();
});

await check('card 4: spacing must be a whole number from 0 to 500; save opens the card and flags the box', async () => {
  for (const bad of ['-1', '501', '1.5', '']) {
    await page.fill('#wgt-f-mobileSideSpacing', bad);
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await page.getByText('Spacing must be a whole number of pixels from 0 to 500.').first().waitFor();
    assert.equal(await cardOpen(4), 'true', bad);
    assert.equal(await page.locator('#wgt-f-mobileSideSpacing').getAttribute('aria-invalid'), 'true', bad);
  }
  await page.fill('#wgt-f-mobileSideSpacing', '6');
});

await check('card 5: a number under 8 digits is refused on save and opens card 5', async () => {
  await page.click('#wgt-card-head-5');
  await page.fill('#wgt-f-phone', '12345');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await page.getByText(/Add a full WhatsApp number/).first().waitFor();
  assert.equal(await cardOpen(5), 'true');
  await page.fill('#wgt-f-phone', '9876543210');
  await page.fill('#wgt-f-prefilledMessage', 'Hi there, I need help');
});

await check('Start Conversation in the preview opens WhatsApp for the number with the pre-filled message in a new tab', async () => {
  // the preview repaints a moment after the last keystroke: wait for the frame that carries the new link
  await until(async () =>
    ((await preview().locator('[data-testid=wgt-start]').getAttribute('data-wa')) ?? '').includes('Hi+there'),
  );
  await preview().locator('[data-testid=wgt-launcher]').click();
  opened.length = 0;
  const popup = ctx.waitForEvent('page');
  await preview().locator('[data-testid=wgt-start]').click();
  const tab = await popup;
  await until(() => opened.length > 0);
  assert.match(opened[0], /^https:\/\/wa\.me\/91\d{10}\?text=Hi\+there%2C\+I\+need\+help$/);
  await tab.close();
  await preview().locator('[data-testid=wgt-close]').click();
});

await check('Save Changes saves once, shows the install snippet and the pill says Saved', async () => {
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await page.getByText('Changes saved. Your widget is live.').waitFor();
  const snippet = await page.textContent('[data-testid=snippet]');
  const m = /src="([^"]+)"/.exec(snippet);
  assert.ok(m);
  embedUrl = m[1];
  assert.match(snippet, /^<script defer src="http.*\/widget\/[A-Za-z0-9]{48}\/embed"><\/script>$/);
  assert.equal((await page.textContent('[data-testid=state-pill]')).trim(), 'Saved');
  await page.getByRole('button', { name: 'Copy code' }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), snippet);
});

await check('the real embed on a customer site: greeting, intro, business name, Start Conversation to wa.me', async () => {
  const site = await onSite(embedUrl);
  const launcher = site.locator('[data-testid=wgt-launcher]');
  await launcher.waitFor();
  assert.match(await launcher.innerText(), /Chat With Us/);
  // placement: desktop left 24 / bottom 32
  const wrap = site.locator('[data-testid=wgt-embed]');
  const at = await wrap.evaluate((el) => {
    const s = getComputedStyle(el);
    return { left: s.left, bottom: s.bottom, dev: el.getAttribute('data-dev') };
  });
  assert.deepEqual(at, { left: '24px', bottom: '32px', dev: 'd' });
  assert.equal(await site.locator('iframe').count(), 0);
  await launcher.click();
  await site.locator('[data-testid=wgt-greeting]').getByText('Namaste friends!').waitFor();
  await site.locator('[data-testid=wgt-intro]').getByText('We reply within minutes.').waitFor();
  await site.locator('[data-testid=wgt-name]').getByText(NAME).waitFor();
  opened.length = 0;
  const popup = siteCtx.waitForEvent('page');
  await site.locator('[data-testid=wgt-start]').click();
  const tab = await popup;
  await until(() => opened.length > 0);
  assert.match(opened[0], /^https:\/\/wa\.me\/91\d{10}\?text=Hi\+there%2C\+I\+need\+help$/);
  await tab.close();
  await site.locator('[data-testid=wgt-close]').click();
  await launcher.waitFor();
  await site.close();
});

await check('the real embed follows the window width: the mobile placement applies on a phone', async () => {
  const site = await onSite(embedUrl, { width: 390, height: 800 });
  const wrap = site.locator('[data-testid=wgt-embed]');
  await wrap.waitFor();
  const at = await wrap.evaluate((el) => {
    const s = getComputedStyle(el);
    return { left: s.left, bottom: s.bottom, dev: el.getAttribute('data-dev') };
  });
  assert.deepEqual(at, { left: '6px', bottom: '90px', dev: 'm' });
  // the panel fits the phone
  await site.locator('[data-testid=wgt-launcher]').click();
  const box = await site.locator('#wgt-panel-' + (await wrap.getAttribute('class')).slice(4).replace('wgt-', '')).boundingBox().catch(() => null);
  const panelBox = box ?? (await site.locator('[role=dialog]').boundingBox());
  assert.ok(panelBox.x >= 0 && panelBox.x + panelBox.width <= 390, 'panel inside the viewport');
  // resize to a desktop width: the placement switches without a reload
  await site.setViewportSize({ width: 1280, height: 800 });
  await site.waitForFunction(
    () => document.querySelector('[data-testid=wgt-embed]').getAttribute('data-dev') === 'd',
  );
  await site.close();
});

await check('the new widget is in the list with its engine pill and slug', async () => {
  await page.goto(`${WEB}/chatbot-widgets`);
  const row = page.locator('[data-widget-id]', { hasText: NAME });
  await row.waitFor();
  assert.match(await row.textContent(), /WhatsApp/);
  assert.match(await row.textContent(), /\/e2e-whatsapp-/);
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
  assert.match(
    await page.evaluate(() => navigator.clipboard.readText()),
    /^<script defer src=".*\/embed"><\/script>$/,
  );
});

await check('edit opens the WhatsApp page prefilled with every saved option; a second save updates, it does not duplicate', async () => {
  const before = await page.locator('[data-widget-id]').count();
  const row = page.locator('[data-widget-id]', { hasText: NAME });
  await row.getByRole('link', { name: 'Edit widget' }).click();
  await page.locator('#wgt-f-name').waitFor();
  assert.equal(await page.inputValue('#wgt-f-name'), NAME);
  assert.equal((await page.textContent('[data-testid=state-pill]')).trim(), 'Saved');
  assert.equal(await page.locator('[data-testid=snippet]').count(), 1);
  assert.equal(await page.locator('[data-colour=original]').getAttribute('aria-checked'), 'true');
  await page.click('#wgt-card-head-3');
  assert.equal(await page.inputValue('#wgt-f-greeting'), 'Namaste friends!');
  assert.equal(await page.inputValue('#wgt-f-introMessage'), 'We reply within minutes.');
  await page.click('#wgt-card-head-4');
  assert.equal(await page.inputValue('#wgt-f-desktopSideSpacing'), '24');
  assert.equal(await page.inputValue('#wgt-f-desktopBottomSpacing'), '32');
  assert.equal(await page.inputValue('#wgt-f-mobileSideSpacing'), '6');
  assert.equal(await page.inputValue('#wgt-f-mobileBottomSpacing'), '90');
  assert.equal(await page.locator('[data-side=desktop-left] input').isChecked(), true);
  await page.click('#wgt-card-head-5');
  assert.equal(await page.inputValue('#wgt-f-prefilledMessage'), 'Hi there, I need help');
  await page.click('#wgt-card-head-3');
  await page.fill('#wgt-f-greeting', 'Hello again');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await page.getByText('Changes saved. Your widget is live.').waitFor();
  await page.goto(`${WEB}/chatbot-widgets`);
  await page.locator('[data-widget-id]', { hasText: NAME }).waitFor();
  assert.equal(await page.locator('[data-widget-id]').count(), before);
  const site = await onSite(embedUrl);
  await site.locator('[data-testid=wgt-launcher]').click();
  await site.locator('[data-testid=wgt-greeting]').getByText('Hello again').waitFor();
  await site.close();
});

await check('switching the engine on the WhatsApp page brings the four-step wizard back with the same name', async () => {
  const row = page.locator('[data-widget-id]', { hasText: NAME });
  await row.getByRole('link', { name: 'Edit widget' }).click();
  await page.locator('#wgt-f-name').waitFor();
  await page.locator('[data-mode-tile=ai]').click();
  await page.locator('#wgt-next').waitFor();
  assert.equal(await page.inputValue('#wgt-f-name'), NAME);
  assert.match(await page.textContent('body'), /Step 1 of 4/);
  // nothing was saved by looking
  await page.goto(`${WEB}/chatbot-widgets`);
});

await check('rotate asks first, then the old embed address is 404', async () => {
  const row = page.locator('[data-widget-id]', { hasText: NAME });
  await row.getByRole('button', { name: 'Rotate embed token' }).click();
  await page.getByText("Rotate this widget's embed token?").waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Rotate' }).click();
  await page.getByText(/Token rotated/).waitFor();
  assert.equal((await fetch(embedUrl)).status, 404);
});

await check('duplicate lands on the copy in the builder (the WhatsApp page keeps its options)', async () => {
  await page.goto(`${WEB}/chatbot-widgets`);
  await page
    .locator('[data-widget-id]', { hasText: NAME })
    .first()
    .getByRole('button', { name: 'Duplicate widget' })
    .click();
  await page.locator('#wgt-f-name').waitFor();
  assert.equal(await page.inputValue('#wgt-f-name'), `${NAME} (copy)`);
  await page.click('#wgt-card-head-3');
  assert.equal(await page.inputValue('#wgt-f-greeting'), 'Hello again');
});

await check('delete asks first, then the row is gone', async () => {
  await page.goto(`${WEB}/chatbot-widgets`);
  for (const name of [`${NAME} (copy)`, NAME, WIZARD]) {
    const row = page.locator('[data-widget-id]').filter({ hasText: name }).first();
    await row.getByRole('button', { name: 'Delete widget' }).click();
    await page.getByText(`Delete "${name}"?`).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete widget' }).click();
    await page.getByText('Widget deleted.').waitFor();
    await page.getByText('Widget deleted.').waitFor({ state: 'hidden' }).catch(() => undefined);
  }
  assert.equal(await page.locator('[data-widget-id]', { hasText: STAMP.toString() }).count(), 0);
});

await check('an unknown widget id is a not-found state, not a blank page', async () => {
  await page.goto(`${WEB}/chatbot-widgets/00000000-0000-4000-8000-000000000000/edit`);
  await page.getByText('Widget not found').waitFor();
  await page.goto(`${WEB}/chatbot-widgets/not-an-id/edit`);
  assert.match(await page.textContent('body'), /404|could not be found|not found/i);
});

await check('no uncaught page errors', async () => assert.deepEqual(errors, []));

psql(`DELETE FROM ai_chat_assistants WHERE name = '${AGENT}'`);
await browser.close();
host.close();
for (const [s, n] of results) console.log(s, n);
process.exit(results.some(([s]) => s === 'FAIL') ? 1 : 0);
