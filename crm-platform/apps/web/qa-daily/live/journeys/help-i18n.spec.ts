import { test, expect } from '../qa';

test('[help] help center lists guides, search finds one and it opens', async ({ app }) => {
  await app.goto('/help');
  await expect(app.getByRole('heading', { name: 'Help & guides', level: 1 })).toBeVisible();
  const search = app.getByRole('searchbox', { name: 'Search help' });
  await search.fill('zzzz-no-such-guide');
  await expect(app.getByText('No guides match your search')).toBeVisible();
  await search.fill('getting started');
  const guide = app.locator('a[href="/help/getting-started"]');
  await expect(guide).toBeVisible();
  await guide.click();
  await expect(app).toHaveURL(/\/help\/getting-started/);
  await expect(app.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(app.getByRole('navigation', { name: 'On this page' })).toBeVisible();
  await app.reload();
  await expect(app.getByRole('heading', { level: 1 })).toBeVisible();
});

test('[help] an unknown guide shows the not-found page', async ({ app }) => {
  const res = await app.goto('/help/qa-auto-no-such-guide');
  expect(res?.status()).toBe(404);
  await expect(app.getByText('404')).toBeVisible();
});

test('[i18n] switching the language changes visible text and persists after reload', async ({
  app,
  cleanup,
}) => {
  await app.goto('/dashboard');
  const switcher = app.getByLabel('Change language');
  await expect(switcher).toBeVisible();
  const before = await app.locator('nav, aside').first().innerText();
  cleanup(async () => {
    await app.request.patch('/api/v2/me/locale', { data: { code: 'en' } });
    await app.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: app.url() }]);
  });
  await switcher.click();
  await app.getByRole('menuitemradio', { name: /español|spanish/i }).click();
  await expect.poll(async () => app.locator('nav, aside').first().innerText()).not.toBe(before);
  await expect(app.locator('html')).toHaveAttribute('lang', /^es/);
  await app.reload();
  await expect(app.locator('html')).toHaveAttribute('lang', /^es/);
  await app.getByLabel(/Change language|Cambiar idioma/i).click();
  await app.getByRole('menuitemradio', { name: /english/i }).click();
  await expect(app.locator('html')).toHaveAttribute('lang', /^en/);
});
