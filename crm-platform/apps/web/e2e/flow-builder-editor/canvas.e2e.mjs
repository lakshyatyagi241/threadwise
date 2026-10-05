// Browser run of the flow builder canvas against a running web app + API (TW-FLB-014..018, 022): real mouse drags from the
// palette onto the canvas, wiring, pan / zoom, undo and redo, the pre-save popup, save, reload, publish.
//   WEB=http://localhost:3110 FLB_EMAIL=... FLB_PASSWORD=... FLB_ORG=... CHROME=/path/to/chrome node canvas.e2e.mjs
// Needs `playwright-core` and a workspace admin with the flow permissions. It creates one throw-away flow named
// "zz-e2e-canvas-<time>" and deletes it at the end (also when a check fails).
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const WEB = process.env.WEB ?? 'http://localhost:3110';
const EMAIL = process.env.FLB_EMAIL ?? 'flb-demo@example.com';
const PASSWORD = process.env.FLB_PASSWORD ?? 'Str0ngPassw0rd#1';
const ORG_SLUG = process.env.FLB_ORG ?? 'flow-builder-demo';
const CHROME =
  process.env.CHROME ??
  `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
const NAME = `zz-e2e-canvas-${Date.now()}`;

const results = [];
let shot = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

let flowId = null;
const api = (path, init) =>
  page.evaluate(
    async ([p, i]) => {
      const r = await fetch(`/api/v2${p}`, {
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          ...(i?.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...i,
      });
      return { status: r.status, json: r.status === 204 ? null : await r.json().catch(() => null) };
    },
    [path, init],
  );

// --- helpers on the canvas ---------------------------------------------------------------------------------------------
const canvas = () => page.locator('[data-testid="canvas"]');
const nodeLocator = (id) => page.locator(`[data-node-id="${id}"]`);
const nodes = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-node-id]')].map((e) => ({
      id: e.getAttribute('data-node-id'),
      type: e.getAttribute('data-node-type'),
      start: !!e.textContent?.startsWith('START'),
      selected: e.classList.contains('selected'),
      invalid: e.classList.contains('node-invalid'),
      x: Math.round(parseFloat(e.style.left)),
      y: Math.round(parseFloat(e.style.top)),
    })),
  );
const edgeCount = () => page.locator('path.edge-hit').count();
const idOfType = async (type) => (await nodes()).find((n) => n.type === type)?.id;
const pill = () => page.locator('header [role="status"]').innerText();
const toastText = () =>
  page.evaluate(
    () =>
      [...document.querySelectorAll('div')]
        .filter((d) => /z-\[60\]/.test(d.className))
        .map((d) => d.textContent)[0] ?? null,
  );
const zoomText = () => page.locator('[data-testid="zoom-level"]').innerText();
const transform = () =>
  page.evaluate(() => document.querySelector('[data-testid="canvas"] > div').style.transform);

/** Drags a palette card onto the canvas with the real HTML5 drag and drop (retried: the first drag after boot can be lost). */
async function dragFromPalette(label, x, y) {
  const before = (await nodes()).length;
  const card = page.locator('.pal-card', { hasText: label }).first();
  for (let i = 0; i < 3; i++) {
    await card.dragTo(canvas(), { targetPosition: { x, y } });
    await sleep(200);
    if ((await nodes()).length > before) return;
  }
}
const portCenter = async (sel) => {
  const bb = await page.locator(sel).first().boundingBox();
  return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
};
/** Press an output port and release over a target point, with real mouse moves in between. */
async function wireTo(srcSel, target) {
  const a = await portCenter(srcSel);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + target.x) / 2, (a.y + target.y) / 2, { steps: 5 });
  await page.mouse.move(target.x, target.y, { steps: 5 });
  await page.mouse.up();
  await sleep(150);
}
const wire = async (srcSel, tgtSel) => wireTo(srcSel, await portCenter(tgtSel));
const titleBox = (id) =>
  page.locator(`[data-node-id="${id}"] .chip-icon + div > div`).first().boundingBox();

try {
  // --- sign in --------------------------------------------------------------------------------------------------------
  await page.goto(`${WEB}/login`);
  const slug = page.locator('input[name=orgSlug], input[name=workspace]');
  if (await slug.count()) await slug.first().fill(ORG_SLUG);
  await page.fill('input[name=email]', EMAIL);
  await page.fill('input[type=password]', PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }),
    page.click('button[type=submit]'),
  ]);

  // Throw-away flows left behind by an earlier crashed run.
  const stale = await api(`/flows?q=${encodeURIComponent('zz-e2e-canvas-')}`);
  for (const f of stale.json?.data ?? stale.json?.items ?? [])
    if (String(f.name).startsWith('zz-e2e-canvas-'))
      await api(`/flows/${f.id}`, { method: 'DELETE' });

  const openBuilder = async (path) => {
    await page.goto(`${WEB}${path}`);
    await page
      .addStyleTag({ content: 'nextjs-portal{display:none!important}' })
      .catch(() => undefined);
    await canvas().waitFor();
    await page.waitForFunction(() => document.fonts.status === 'loaded').catch(() => undefined);
    await sleep(600);
    // The cookie banner sits over the bottom of the page on a first visit.
    const decline = page.getByRole('button', { name: /^decline$/i });
    if (await decline.count())
      await decline
        .first()
        .click()
        .catch(() => undefined);
  };
  await openBuilder('/flows/builder');

  await check(
    'shell: toolbar, palette 35 nodes with the WhatsApp badge, empty canvas, Draft pill, 95% zoom',
    async () => {
      assert.equal(
        await page.locator('header input[aria-label="Flow name"]').inputValue(),
        'New flow',
      );
      assert.equal(await page.locator('a[title="Back to flows"]').getAttribute('href'), '/flows');
      assert.equal(
        await page
          .locator('aside[aria-label="Node palette"]')
          .innerText()
          .then((t) => /ADD A NODE\s*WhatsApp\s*35/i.test(t.replace(/\n/g, ' '))),
        true,
      );
      assert.equal(await pill(), 'Draft');
      assert.equal(await zoomText(), '95%');
      assert.equal((await nodes()).length, 0);
      assert.equal(
        await page
          .locator('header button', { hasText: /^Save/ })
          .first()
          .innerText()
          .then((t) => t.startsWith('Save')),
        true,
      );
    },
  );

  await check(
    'palette: search narrows by label / description / group, empty search says "No nodes match."',
    async () => {
      const search = page.locator('input[aria-label="Search nodes"]');
      await search.fill('sheet');
      assert.deepEqual(
        await page.locator('.pal-card').evaluateAll((els) => els.map((e) => e.textContent)),
        ['Google SheetsWrite or read a row'],
      );
      await search.fill('tap-to-pick');
      assert.equal(await page.locator('.pal-card').count(), 1);
      await search.fill('zzzz');
      assert.equal(
        await page
          .locator('aside[aria-label="Node palette"]')
          .innerText()
          .then((t) => t.includes('No nodes match.')),
        true,
      );
      await search.fill('');
      assert.equal(await page.locator('.pal-card').count(), 35);
    },
  );

  await check('palette: the collapse handle hides and shows the panel', async () => {
    await page.locator('button[aria-label="Hide sidebar"]').click();
    assert.equal(await page.locator('aside[aria-label="Node palette"]').count(), 0);
    await page.locator('button[aria-label="Show sidebar"]').first().click();
    assert.equal(await page.locator('aside[aria-label="Node palette"]').count(), 1);
  });

  // --- build a graph with real drags -------------------------------------------------------------------------------
  await check(
    'drag from the palette: the first node is START, the Trigger is a singleton, double-click adds at the centre',
    async () => {
      await dragFromPalette('Send message', 480, 110);
      let ns = await nodes();
      assert.equal(ns.length, 1);
      assert.equal(ns[0].type, 'message');
      assert.equal(ns[0].start, true, 'first node is START');
      assert.equal(await pill(), 'Unsaved');
      await dragFromPalette('Trigger', 200, 110);
      assert.equal((await nodes()).filter((n) => n.type === 'trigger').length, 1);
      const before = (await nodes()).length;
      await page
        .locator('.pal-card', { hasText: 'Trigger' })
        .first()
        .dragTo(canvas(), { targetPosition: { x: 200, y: 330 } });
      await sleep(250);
      assert.equal((await nodes()).length, before, 'a second Trigger is refused');
      assert.equal(await toastText(), 'Trigger can only exist once.');
      await page.locator('.pal-card', { hasText: 'Condition' }).first().dblclick();
      await sleep(300);
      ns = await nodes();
      const cond = ns.find((n) => n.type === 'condition');
      assert.ok(cond, 'condition added by double-click');
      const box = await canvas().boundingBox();
      const bb = await nodeLocator(cond.id).boundingBox();
      assert.ok(
        Math.abs(bb.x + bb.width / 2 - (box.x + box.width / 2)) < 12,
        'centred horizontally',
      );
      await dragFromPalette('Quick replies', 900, 150);
      await dragFromPalette('End', 1030, 600);
      ns = await nodes();
      assert.deepEqual(ns.map((n) => n.type).sort(), [
        'buttons',
        'condition',
        'end',
        'message',
        'trigger',
      ]);
      assert.equal(ns.filter((n) => n.start).length, 1);
    },
  );

  await check(
    'node cards: Trigger has no input dot, Condition has yes / no ports, Quick replies one port per option',
    async () => {
      const t = await idOfType('trigger');
      const c = await idOfType('condition');
      const q = await idOfType('buttons');
      assert.equal(await page.locator(`[data-port="in:${t}"]`).count(), 0);
      assert.equal(await page.locator(`[data-port="in:${c}"]`).count(), 1);
      assert.equal(await page.locator(`[data-port="out:${c}:yes"]`).count(), 1);
      assert.equal(await page.locator(`[data-port="out:${c}:no"]`).count(), 1);
      assert.equal(await page.locator(`[data-port^="out:${q}:p"]`).count(), 2);
      assert.equal(await page.locator(`[data-port^="out:${await idOfType('end')}:"]`).count(), 0);
    },
  );

  await check(
    'connect: output port to input port and release over a card body; a self connection is ignored',
    async () => {
      const [t, m, c, q, e] = await Promise.all(
        ['trigger', 'message', 'condition', 'buttons', 'end'].map(idOfType),
      );
      await wire(`[data-port^="out:${t}:"]`, `[data-port="in:${m}"]`);
      await wire(`[data-port^="out:${m}:"]`, `[data-port="in:${q}"]`);
      await wire(`[data-port="out:${q}:p0"]`, `[data-port="in:${c}"]`);
      // release over the card body (not on the dot)
      const cb = await titleBox(e);
      await wireTo(`[data-port="out:${c}:yes"]`, { x: cb.x + 8, y: cb.y + 4 });
      await wire(`[data-port="out:${c}:no"]`, `[data-port="in:${e}"]`);
      assert.equal(await edgeCount(), 5);
      await wire(`[data-port^="out:${m}:"]`, `[data-port="in:${m}"]`);
      assert.equal(await edgeCount(), 5, 'self connection ignored');
      // ...and it left no undo entry: one Ctrl+Z undoes the last real connection, not a no-op
      await page.keyboard.press('Control+z');
      await sleep(150);
      assert.equal(await edgeCount(), 4);
      await page.keyboard.press('Control+y');
      await sleep(150);
      assert.equal(await edgeCount(), 5);
    },
  );

  await check('Escape cancels a connection that is being drawn', async () => {
    const m = await idOfType('message');
    const a = await portCenter(`[data-port^="out:${m}:"]`);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 90, a.y + 70, { steps: 4 });
    assert.equal(await page.locator('path.edge-path.preview').count(), 1);
    await page.keyboard.press('Escape');
    await sleep(100);
    assert.equal(await page.locator('path.edge-path.preview').count(), 0);
    await page.mouse.up();
    assert.equal(await edgeCount(), 5);
  });

  await check(
    'click an edge: "Delete" popup removes it; Ctrl+Z brings it back, Ctrl+Y removes it again',
    async () => {
      await page.locator('[data-testid="canvas"]').click({ position: { x: 5, y: 700 } });
      const mid = await page
        .locator('path.edge-hit')
        .first()
        .evaluate((el) => {
          const pt = el.getPointAtLength(el.getTotalLength() / 2);
          const m = el.getScreenCTM();
          return { x: pt.x * m.a + m.e, y: pt.y * m.d + m.f };
        });
      await page.mouse.click(mid.x, mid.y);
      await page.locator('.edge-popup').waitFor();
      assert.equal(await page.locator('.edge-popup').innerText(), 'Delete');
      await page.locator('.edge-popup').click();
      assert.equal(await edgeCount(), 4);
      await page.keyboard.press('Control+z');
      await sleep(150);
      assert.equal(await edgeCount(), 5);
      await page.keyboard.press('Control+y');
      await sleep(150);
      assert.equal(await edgeCount(), 4);
      await page.keyboard.press('Control+Shift+z');
      await sleep(100);
      await page.keyboard.press('Control+z');
      await sleep(150);
      assert.equal(await edgeCount(), 5);
    },
  );

  await check(
    'select a node: action bar with pin / edit / duplicate / delete; Ctrl+D copies 40 px down-right, disconnected, not START',
    async () => {
      const q = await idOfType('buttons');
      const before = (await nodes()).find((n) => n.id === q);
      await (await nodeLocator(q).locator('.chip-icon + div > div').first()).click();
      assert.equal(await page.locator('.node-actions button').count(), 4);
      await page.keyboard.press('Control+d');
      await sleep(200);
      const ns = await nodes();
      assert.equal(ns.length, 6);
      const copy = ns.find((n) => n.type === 'buttons' && n.id !== q);
      assert.equal(copy.x, before.x + 40);
      assert.equal(copy.y, before.y + 40);
      assert.equal(copy.start, false);
      assert.equal(copy.selected, true);
      assert.equal(await page.locator(`[data-port="in:${copy.id}"]`).count(), 1);
      await page.keyboard.press('Backspace');
      await sleep(200);
      assert.equal((await nodes()).length, 5, 'Backspace deletes the selected node');
      assert.equal(await edgeCount(), 5, 'the copy had no edges');
    },
  );

  await check(
    'pin as START moves the ribbon; Escape clears the selection; the Trigger cannot be duplicated',
    async () => {
      const c = await idOfType('condition');
      await (await nodeLocator(c).locator('.chip-icon + div > div').first()).click();
      await page.locator('.node-actions button').first().click();
      await sleep(100);
      const ns = await nodes();
      assert.deepEqual(
        ns.filter((n) => n.start).map((n) => n.type),
        ['condition'],
      );
      const t = await idOfType('trigger');
      await (await nodeLocator(t).locator('.chip-icon + div > div').first()).click();
      await page.keyboard.press('Control+d');
      await sleep(150);
      assert.equal(await toastText(), 'Trigger can only exist once — can’t duplicate.');
      await page.keyboard.press('Escape');
      await sleep(100);
      assert.equal((await nodes()).filter((n) => n.selected).length, 0);
      // put START back on the Trigger for the saved graph
      await (await nodeLocator(t).locator('.chip-icon + div > div').first()).click();
      await page.locator('.node-actions button').first().click();
      await sleep(100);
      assert.deepEqual(
        (await nodes()).filter((n) => n.start).map((n) => n.type),
        ['trigger'],
      );
      await page.locator('[data-testid="canvas"]').click({ position: { x: 5, y: 700 } });
    },
  );

  await check(
    'zoom buttons step 10 % within 40..180 %, Reset gives 100 % at pan 40,40; Ctrl+wheel zooms, wheel pans, empty-canvas drag pans',
    async () => {
      await page.locator('button[aria-label="Zoom in"]').click();
      assert.equal(await zoomText(), '105%');
      await page.locator('button[aria-label="Zoom out"]').click();
      await page.locator('button[aria-label="Zoom out"]').click();
      assert.equal(await zoomText(), '85%');
      for (let i = 0; i < 8; i++) await page.locator('button[aria-label="Zoom out"]').click();
      assert.equal(await zoomText(), '40%');
      for (let i = 0; i < 16; i++) await page.locator('button[aria-label="Zoom in"]').click();
      assert.equal(await zoomText(), '180%');
      await page.locator('button[aria-label="Reset view"]').click();
      assert.equal(await zoomText(), '100%');
      assert.equal(await transform(), 'translate(40px, 40px) scale(1)');
      const box = await canvas().boundingBox();
      await page.mouse.move(box.x + 600, box.y + 600);
      await page.mouse.wheel(0, 100);
      await sleep(100);
      assert.equal(await transform(), 'translate(40px, -60px) scale(1)');
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -200);
      await page.keyboard.up('Control');
      await sleep(100);
      assert.equal(await zoomText(), '130%');
      await page.locator('button[aria-label="Reset view"]').click();
      await page.mouse.move(box.x + 700, box.y + 700);
      await page.mouse.down();
      await page.mouse.move(box.x + 760, box.y + 740, { steps: 4 });
      await page.mouse.up();
      assert.equal(await transform(), 'translate(100px, 80px) scale(1)');
      await page.locator('button[aria-label="Reset view"]').click();
    },
  );

  await check('minimap: shows every node and a draggable viewport rectangle', async () => {
    assert.equal(await page.locator('[data-testid="minimap"] rect.mm-node').count(), 5);
    const before = await transform();
    const v = await page.locator('[data-testid="minimap"] rect.mm-view').boundingBox();
    await page.mouse.move(v.x + 5, v.y + 5);
    await page.mouse.down();
    await page.mouse.move(v.x + 25, v.y + 15, { steps: 4 });
    await page.mouse.up();
    assert.notEqual(await transform(), before);
    await page.locator('button[aria-label="Reset view"]').click();
  });

  await check(
    'moving a node is one undo step; the undo and redo buttons follow the history',
    async () => {
      const m = await idOfType('message');
      const before = (await nodes()).find((n) => n.id === m);
      const bb = await titleBox(m);
      await page.mouse.move(bb.x + 10, bb.y + 5);
      await page.mouse.down();
      await page.mouse.move(bb.x + 90, bb.y + 65, { steps: 6 });
      await page.mouse.up();
      await sleep(150);
      const after = (await nodes()).find((n) => n.id === m);
      assert.ok(after.x !== before.x && after.y !== before.y);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+z');
      await sleep(150);
      const undone = (await nodes()).find((n) => n.id === m);
      assert.equal(undone.x, before.x);
      assert.equal(undone.y, before.y);
      assert.equal(await page.locator('button[aria-label="Redo"]').isDisabled(), false);
      await page.locator('button[aria-label="Redo"]').click();
      await sleep(150);
      assert.equal((await nodes()).find((n) => n.id === m).x, after.x);
    },
  );

  // --- the pre-save popup ------------------------------------------------------------------------------------------------
  await check(
    'Save with an unconnected node: red popup with the Reference sentence, the node outlined and selected; wiring clears it',
    async () => {
      await dragFromPalette('Send media', 300, 640);
      const orphan = (await nodes()).find((n) => n.type === 'media');
      await page.locator('header button', { hasText: /^Save/ }).first().click();
      await sleep(300);
      const popup = page.locator('[role="alert"]', { hasText: "Can't save" });
      assert.equal(await popup.count(), 1);
      const text = (await popup.innerText()).replace(/\s+/g, ' ');
      assert.ok(text.includes("Can't save — 1 node needs fixing"), text);
      assert.ok(text.includes('"Send media" is not connected to anything.'), text);
      assert.ok(
        text.includes('The affected nodes are outlined in red. Connect them, then save again.'),
        text,
      );
      const ns = await nodes();
      assert.equal(ns.find((n) => n.id === orphan.id).invalid, true);
      assert.equal(ns.find((n) => n.id === orphan.id).selected, true);
      assert.equal(
        await page.locator('[data-testid="flow-builder"] [role="dialog"]').count(),
        0,
        'no save dialog was opened',
      );
      // wire it: the popup and the outline clear as soon as the edges change
      const e = await idOfType('end');
      const m = await idOfType('message');
      await wire(`[data-port^="out:${m}:"]`, `[data-port="in:${orphan.id}"]`);
      assert.equal(await popup.count(), 0);
      assert.equal((await nodes()).filter((n) => n.invalid).length, 0);
      await page.keyboard.press('Control+z');
      await sleep(150);
      // keep the graph tidy: drop the media node again
      await (await nodeLocator(orphan.id).locator('.chip-icon + div > div').first()).click();
      await page.keyboard.press('Backspace');
      await sleep(150);
      assert.equal((await nodes()).length, 5);
      void e;
    },
  );

  // --- save ---------------------------------------------------------------------------------------------------------------
  await check(
    'Save on a new flow asks for a name (blank disables it), saves, replaces the URL with /flows/builder/<id> and toasts',
    async () => {
      await page.locator('header button', { hasText: /^Save/ }).first().click();
      const name = page.locator('input[placeholder="e.g. Welcome flow"]');
      await name.waitFor();
      await name.fill('');
      assert.equal(await page.getByRole('button', { name: /Save flow/ }).isDisabled(), true);
      await name.fill(NAME);
      await name.press('Enter');
      await page.waitForURL(/\/flows\/builder\/[0-9a-f-]{36}$/);
      flowId = page.url().split('/').pop();
      await sleep(300);
      assert.equal(await toastText(), `Flow saved · "${NAME}"`);
      assert.equal(await pill(), 'Draft');
      assert.equal(await page.locator('header input[aria-label="Flow name"]').inputValue(), NAME);
      assert.equal(
        await page
          .locator('header button', { hasText: /^Save/ })
          .first()
          .innerText()
          .then((t) => t.startsWith('Save changes')),
        true,
      );
    },
  );

  await check(
    'API: the saved graph has the five nodes, five edges with Reference handle names and the Trigger as START',
    async () => {
      const r = await api(`/flows/${flowId}`);
      assert.equal(r.status, 200);
      const g = r.json.graph;
      assert.deepEqual(g.flowNodes.map((n) => n.type).sort(), [
        'buttons',
        'condition',
        'end',
        'message',
        'trigger',
      ]);
      assert.equal(g.flowNodes.find((n) => n.isStart).type, 'trigger');
      assert.equal(g.flowEdges.length, 5);
      const handles = g.flowEdges.map((e) => e.sourceHandle).sort();
      assert.deepEqual(handles, ['no', 'out', 'out', 'p0', 'yes']);
      assert.equal(r.json.isPublished, false);
      assert.equal(r.json.name, NAME);
    },
  );

  let saved;
  await check(
    'reload re-opens the same flow: same nodes, positions, edges, START, name and a Draft pill',
    async () => {
      saved = await nodes();
      const edges = await edgeCount();
      await openBuilder(`/flows/builder/${flowId}`);
      await page.waitForFunction(() => document.querySelectorAll('[data-node-id]').length === 5);
      const again = await nodes();
      const norm = (ns) =>
        ns
          .map(({ type, start, x, y }) => ({ type, start, x, y }))
          .sort((a, b) => a.type.localeCompare(b.type));
      assert.deepEqual(norm(again), norm(saved));
      assert.equal(await edgeCount(), edges);
      assert.equal(await pill(), 'Draft');
      assert.equal(await page.locator('header input[aria-label="Flow name"]').inputValue(), NAME);
    },
  );

  await check(
    'edit + Save on an existing flow saves silently (no name dialog) and keeps the same row',
    async () => {
      const m = await idOfType('message');
      const bb = await titleBox(m);
      await page.mouse.move(bb.x + 10, bb.y + 5);
      await page.mouse.down();
      await page.mouse.move(bb.x + 70, bb.y + 45, { steps: 5 });
      await page.mouse.up();
      await sleep(150);
      assert.equal(await pill(), 'Unsaved');
      const moved = (await nodes()).find((n) => n.id === m);
      await page.locator('header button', { hasText: /^Save/ }).first().click();
      await sleep(1200);
      assert.equal(await page.locator('input[placeholder="e.g. Welcome flow"]').count(), 0);
      assert.equal(await toastText(), `Flow saved · "${NAME}"`);
      assert.equal(await pill(), 'Draft');
      const r = await api(`/flows/${flowId}`);
      const n = r.json.graph.flowNodes.find((x) => x.id === m);
      assert.equal(Math.round(n.x), moved.x);
      assert.equal(Math.round(n.y), moved.y);
    },
  );

  await check(
    'Publish: pill reads Published, toast "Published", the API row is published; reload keeps it',
    async () => {
      await page.locator('header button', { hasText: 'Publish' }).click();
      await page.waitForFunction(
        () => document.querySelector('header [role="status"]')?.textContent?.trim() === 'Published',
      );
      const r = await api(`/flows/${flowId}`);
      assert.equal(r.json.isPublished, true);
      await openBuilder(`/flows/builder/${flowId}`);
      await page.waitForFunction(() => document.querySelectorAll('[data-node-id]').length === 5);
      assert.equal(await pill(), 'Published');
    },
  );

  await check('Publish with a broken graph saves nothing and shows the popup', async () => {
    await dragFromPalette('Send media', 300, 640);
    const before = (await api(`/flows/${flowId}`)).json.graph.flowNodes.length;
    await page.locator('header button', { hasText: 'Publish' }).click();
    await sleep(300);
    assert.equal(await page.locator('[role="alert"]', { hasText: "Can't save" }).count(), 1);
    assert.equal((await api(`/flows/${flowId}`)).json.graph.flowNodes.length, before);
  });

  await check(
    'the flow list shows exactly one row for this flow (Publish on a saved flow does not create a copy)',
    async () => {
      const r = await api(`/flows?q=${encodeURIComponent(NAME)}`);
      assert.equal(r.status, 200);
      const rows = (r.json.data ?? r.json.items ?? []).filter((f) => f.name === NAME);
      assert.equal(rows.length, 1);
    },
  );

  await check(
    'a never-saved graph published straight away creates ONE published row (Reference made two)',
    async () => {
      await openBuilder('/flows/builder');
      await dragFromPalette('Trigger', 200, 150);
      await dragFromPalette('Send message', 560, 150);
      const [t, m] = await Promise.all([idOfType('trigger'), idOfType('message')]);
      await wire(`[data-port^="out:${t}:"]`, `[data-port="in:${m}"]`);
      await page.locator('header input[aria-label="Flow name"]').fill(`${NAME}-pub`);
      await page.locator('header button', { hasText: 'Publish' }).click();
      await page.waitForURL(/\/flows\/builder\/[0-9a-f-]{36}$/);
      await page.waitForFunction(
        () => document.querySelector('header [role="status"]')?.textContent?.trim() === 'Published',
      );
      const id2 = page.url().split('/').pop();
      const list = await api(`/flows?q=${encodeURIComponent(`${NAME}-pub`)}`);
      const rows = (list.json.data ?? list.json.items ?? []).filter(
        (f) => f.name === `${NAME}-pub`,
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].isPublished, true);
      await api(`/flows/${id2}`, { method: 'DELETE' });
    },
  );

  await check(
    'the back arrow goes to /flows without a prompt (Reference has none, even with unsaved edits)',
    async () => {
      await openBuilder(`/flows/builder/${flowId}`);
      await page.locator('header input[aria-label="Flow name"]').fill(`${NAME} edited`);
      assert.equal(await pill(), 'Unsaved');
      let dialog = null;
      page.once('dialog', (d) => {
        dialog = d.message();
        void d.dismiss();
      });
      await page.locator('a[title="Back to flows"]').click();
      await page.waitForURL(/\/flows$/);
      assert.equal(dialog, null);
    },
  );

  await check('no uncaught page errors during the run', async () => {
    assert.deepEqual(errors, []);
  });
} finally {
  if (flowId) {
    const r = await api(`/flows/${flowId}`, { method: 'DELETE' }).catch(() => ({ status: 'n/a' }));
    results.push([
      r.status === 204 ? 'ok' : 'FAIL',
      `cleanup: throw-away flow deleted (${r.status})`,
    ]);
  }
  await browser.close();
}

for (const [s, n] of results) console.log(`${s === 'ok' ? 'PASS' : 'FAIL'}  ${n}`);
const failed = results.filter(([s]) => s !== 'ok').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
