import { test, expect } from '../qa';

test.use({ viewport: { width: 390, height: 844 } });

/** No horizontal scroll: the page is not wider than the phone. */
const fits = (p: import('@playwright/test').Page) =>
  p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const [name, path] of [
  ['dashboard', '/dashboard'],
  ['help center', '/help'],
  ['wallet', '/billing/wallet'],
  ['webhooks', '/webhooks'],
  ['developers', '/developers'],
] as const) {
  test(`[responsive] ${name} fits a 390px phone with no sideways scroll`, async ({ app }) => {
    await app.setViewportSize({ width: 390, height: 844 });
    await app.goto(path);
    await expect(app.getByRole('heading', { level: 1 }).first()).toBeVisible();
    expect(await fits(app), `${path} overflows horizontally`).toBe(true);
  });
}

test('[responsive] the mobile menu opens, lists the main areas and navigates', async ({ app }) => {
  await app.setViewportSize({ width: 390, height: 844 });
  await app.goto('/dashboard');
  await app.getByTestId('cookie-bar').getByRole('button').first().click();
  await app.getByRole('button', { name: 'Open menu' }).click();
  const drawer = app.getByRole('dialog', { name: 'Main menu' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('link', { name: 'Help', exact: true }).click();
  await expect(app).toHaveURL(/\/help/);
  await expect(app.getByRole('heading', { name: 'Help & guides', level: 1 })).toBeVisible();
});

test('[responsive] the webhook form is reachable and usable on a phone', async ({ app }) => {
  await app.setViewportSize({ width: 390, height: 844 });
  await app.goto('/webhooks');
  await app.getByRole('button', { name: 'Add webhook' }).first().click();
  const dialog = app.getByRole('dialog', { name: 'Add a webhook' });
  await expect(dialog.getByLabel('Endpoint URL')).toBeInViewport();
  const box = await dialog.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

test('[responsive] the public login page fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeInViewport();
  expect(await fits(page)).toBe(true);
});

test('[responsive] the operator console fits a phone', async ({ operator }) => {
  await operator.setViewportSize({ width: 390, height: 844 });
  await operator.goto('/admin');
  await expect(operator.getByRole('heading', { name: 'Platform console' })).toBeVisible();
  expect(await fits(operator)).toBe(true);
});
