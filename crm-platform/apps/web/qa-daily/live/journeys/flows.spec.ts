import type { Page } from '@playwright/test';
import { test, expect, qaName } from '../qa';

const canvas = (p: Page) => p.getByTestId('canvas');
const nodeCount = (p: Page) => p.locator('[data-node-id]').count();
const saveButton = (p: Page) => p.locator('header button', { hasText: /^Save/ }).first();

async function addNode(p: Page, label: string, x: number, y: number) {
  const before = await nodeCount(p);
  await p
    .locator('.pal-card', { hasText: label })
    .first()
    .dragTo(canvas(p), { targetPosition: { x, y } });
  // The first drag after boot can be lost: retry until the node shows up.
  await expect
    .poll(async () => nodeCount(p), { timeout: 4000 })
    .toBeGreaterThan(before)
    .catch(async () => {
      await p
        .locator('.pal-card', { hasText: label })
        .first()
        .dragTo(canvas(p), { targetPosition: { x, y } });
    });
  await expect.poll(() => nodeCount(p)).toBeGreaterThan(before);
}

async function center(p: Page, sel: string) {
  const bb = (await p.locator(sel).first().boundingBox())!;
  return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
}

test.describe('flow builder', () => {
  test('[flows] the flows list opens and a new flow starts empty as a draft', async ({ app }) => {
    await app.goto('/flows');
    await expect(app.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await app.goto('/flows/builder');
    await expect(canvas(app)).toBeVisible();
    await expect(app.locator('header input[aria-label="Flow name"]')).toHaveValue('New flow');
    await expect(app.locator('header [role="status"]')).toHaveText('Draft');
    await expect(app.locator('aside[aria-label="Node palette"]')).toBeVisible();
    expect(await nodeCount(app)).toBe(0);
  });

  test('[flows] build a two-step flow, save it, reopen it and find it unchanged', async ({
    app,
    api,
    cleanup,
  }) => {
    const name = qaName('flow');
    cleanup(async () => {
      const res = await api.get(`/api/v2/flows?q=${encodeURIComponent(name)}`);
      const body = (await res.json().catch(() => ({}))) as {
        data?: Array<{ id: string; name: string }>;
      };
      for (const f of body.data ?? [])
        if (f.name === name) await api.delete(`/api/v2/flows/${f.id}`);
    });
    await app.goto('/flows/builder');
    await expect(canvas(app)).toBeVisible();
    await addNode(app, 'Trigger', 200, 110);
    await addNode(app, 'Send message', 520, 110);
    expect(await nodeCount(app)).toBe(2);

    const out = await center(app, '[data-port^="out:"]');
    const target = await center(app, '[data-port^="in:"]');
    await app.mouse.move(out.x, out.y);
    await app.mouse.down();
    await app.mouse.move((out.x + target.x) / 2, (out.y + target.y) / 2, { steps: 5 });
    await app.mouse.move(target.x, target.y, { steps: 5 });
    await app.mouse.up();
    await expect(app.locator('path.edge-hit')).toHaveCount(1);
    await expect(app.locator('header [role="status"]')).toHaveText('Unsaved');

    await saveButton(app).click();
    await app.locator('input[placeholder="e.g. Welcome flow"]').fill(name);
    await app.getByRole('button', { name: /Save flow/ }).click();
    await app.waitForURL(/\/flows\/builder\/[0-9a-f-]{36}$/);
    await expect(app.locator('header [role="status"]')).toHaveText('Draft');

    await app.reload();
    await expect(canvas(app)).toBeVisible();
    await expect(app.locator('header input[aria-label="Flow name"]')).toHaveValue(name);
    await expect(app.locator('[data-node-id]')).toHaveCount(2);
    await expect(app.locator('path.edge-hit')).toHaveCount(1);
    await expect(app.locator('header [role="status"]')).toHaveText('Draft');
  });

  test('[flows] saving a flow with an unconnected step is refused with a plain explanation', async ({
    app,
  }) => {
    await app.goto('/flows/builder');
    await addNode(app, 'Trigger', 200, 110);
    await addNode(app, 'Send message', 520, 110);
    await saveButton(app).click();
    const popup = app.locator('[role="alert"]', { hasText: "Can't save" });
    await expect(popup).toContainText('needs fixing');
    await expect(popup).toContainText('is not connected to anything');
    await expect(app.locator('input[placeholder="e.g. Welcome flow"]')).toHaveCount(0);
  });

  test('[flows] publishing a saved flow marks it Published @destructive', async ({
    app,
    api,
    cleanup,
    destructive,
  }) => {
    destructive();
    const name = qaName('flow pub');
    cleanup(async () => {
      const res = await api.get(`/api/v2/flows?q=${encodeURIComponent(name)}`);
      const body = (await res.json().catch(() => ({}))) as {
        data?: Array<{ id: string; name: string }>;
      };
      for (const f of body.data ?? [])
        if (f.name === name) await api.delete(`/api/v2/flows/${f.id}`);
    });
    await app.goto('/flows/builder');
    await addNode(app, 'Trigger', 200, 110);
    await addNode(app, 'Send message', 520, 110);
    const out = await center(app, '[data-port^="out:"]');
    const target = await center(app, '[data-port^="in:"]');
    await app.mouse.move(out.x, out.y);
    await app.mouse.down();
    await app.mouse.move(target.x, target.y, { steps: 8 });
    await app.mouse.up();
    await saveButton(app).click();
    await app.locator('input[placeholder="e.g. Welcome flow"]').fill(name);
    await app.getByRole('button', { name: /Save flow/ }).click();
    await app.waitForURL(/\/flows\/builder\/[0-9a-f-]{36}$/);
    await app
      .getByRole('button', { name: /^Publish/ })
      .first()
      .click();
    await expect(app.locator('header [role="status"]')).toHaveText('Published');
    await app.reload();
    await expect(app.locator('header [role="status"]')).toHaveText('Published');
  });
});
