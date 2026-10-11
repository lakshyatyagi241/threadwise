import { expect, test } from '@playwright/test';
import {
  LAUNCH,
  SUPER,
  SUPPORT,
  faqCalls,
  openFaq,
  signInOperator,
  sw,
  watch,
} from './admin-support';

test.use({ launchOptions: LAUNCH });
test.setTimeout(240_000);

const aside = (page: import('@playwright/test').Page) => page.locator('#console-sidebar');
const palette = (page: import('@playwright/test').Page) => page.getByTestId('console-palette');

test.describe('platform FAQ engine: access', () => {
  test('no session is sent to the operator sign-in and comes back with next=', async ({ page }) => {
    await page.goto('/admin/faq', { timeout: 120_000 });
    await expect(page).toHaveURL(/\/admin\/login/);
    const next = new URL(page.url()).searchParams.get('next');
    expect(next).toBe('/admin/faq');
  });

  test('no session: the platform FAQ API answers 401 through the proxy', async ({ request }) => {
    const res = await request.get('/api/platform/faq');
    expect(res.status()).toBe(401);
  });

  test('a support operator gets the no-access state and the page calls no platform FAQ route', async ({
    page,
  }) => {
    const calls = faqCalls(page);
    await signInOperator(page, SUPPORT);
    await page.goto('/admin/faq', { timeout: 120_000 });
    await expect(page.getByRole('heading', { name: 'FAQ engine', level: 1 })).toBeVisible({
      timeout: 120_000,
    });
    await expect(
      page.getByText('Only a super admin can see or change the FAQ engine.'),
    ).toBeVisible();
    await expect(page.getByRole('switch')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Engine status' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Re-index everything' })).toHaveCount(0);
    // Give any (wrong) query time to fire, then assert that nothing went out.
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    expect(calls).toEqual([]);
  });

  test('a support operator does not see the menu entry, and the API refuses a direct call', async ({
    page,
  }) => {
    await signInOperator(page, SUPPORT);
    await page.goto('/admin/settings/general', { timeout: 120_000 });
    await expect(aside(page)).toBeVisible({ timeout: 120_000 });
    await expect(aside(page).getByRole('link', { name: 'AI provider keys' })).toHaveCount(0);
    await expect(aside(page).getByRole('link', { name: 'FAQ engine' })).toHaveCount(0);
    const res = await page.request.get('/api/platform/faq');
    expect(res.status()).toBe(403);
    const patch = await page.request.patch('/api/platform/faq', {
      data: { maxFaqs: 400 },
      headers: { 'idempotency-key': `pw-${Date.now()}` },
    });
    expect(patch.status()).toBe(403);
  });

  test('the super admin sees the page with its sections', async ({ page }) => {
    await signInOperator(page, SUPER);
    const w = watch(page);
    await openFaq(page);
    for (const name of ['Engine status', 'Settings', 'Maintenance', 'Workspaces']) {
      await expect(
        page.getByRole(name === 'Engine status' ? 'region' : 'heading', { name }),
      ).toBeVisible();
    }
    await expect(sw(page)).toBeChecked();
    expect(w.consoleIssues).toEqual([]);
    expect(w.failures).toEqual([]);
  });

  test('the sidebar lists FAQ engine under Settings and marks it current', async ({ page }) => {
    await signInOperator(page, SUPER);
    await openFaq(page);
    const link = aside(page).getByRole('link', { name: 'FAQ engine' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/admin/faq');
    await expect(link).toHaveAttribute('aria-current', 'page');
    // It sits in the Settings area: the area's own link is the active one.
    await expect(
      aside(page).getByTestId('hub-menu').getByRole('link', { name: 'FAQ engine' }),
    ).toBeVisible();
    await expect(aside(page).getByRole('link', { name: 'Settings hub' })).toBeVisible();
  });

  test('the search palette finds "FAQ engine" and opens it', async ({ page }) => {
    await signInOperator(page, SUPER);
    await page.goto('/admin/account/security', { timeout: 120_000 });
    await expect(aside(page)).toBeVisible({ timeout: 120_000 });
    await page.waitForFunction(() => {
      const el = document.querySelector('#console-sidebar');
      return !!el && Object.keys(el).some((k) => k.startsWith('__react'));
    });
    await page.keyboard.press('Control+K');
    await expect(palette(page)).toBeVisible();
    await palette(page).getByRole('combobox').fill('FAQ engine');
    const first = palette(page).getByRole('option').first();
    await expect(first).toContainText('FAQ engine');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin\/faq$/);
    await expect(page.getByRole('heading', { name: 'FAQ engine', level: 1 })).toBeVisible({
      timeout: 120_000,
    });
  });

  test('the palette also finds it by a keyword (embedding) and not for a support operator', async ({
    page,
  }) => {
    await signInOperator(page, SUPER);
    await page.goto('/admin/account/security', { timeout: 120_000 });
    await page.waitForFunction(() => {
      const el = document.querySelector('#console-sidebar');
      return !!el && Object.keys(el).some((k) => k.startsWith('__react'));
    });
    await page.keyboard.press('Control+K');
    await palette(page).getByRole('combobox').fill('embedding');
    await expect(palette(page).getByRole('option', { name: /FAQ engine/ })).toBeVisible();
    await signInOperator(page, SUPPORT);
    await page.goto('/admin/account/security', { timeout: 120_000 });
    await page.waitForFunction(() => {
      const el = document.querySelector('#console-sidebar');
      return !!el && Object.keys(el).some((k) => k.startsWith('__react'));
    });
    await page.keyboard.press('Control+K');
    await palette(page).getByRole('combobox').fill('embedding');
    await expect(palette(page).getByRole('option', { name: /FAQ engine/ })).toHaveCount(0);
  });
});
