import { expect, test } from '@playwright/test';

/**
 * The public developer reference (/developers/docs, WD-API-149) against the running stack (web :3001, API :3000). No login: every
 * test runs as an anonymous visitor. The reference part needs the API up (it serves /docs/api.json); the "API unreachable" case
 * is simulated by failing the page's own server fetch, which a browser test cannot do, so it is covered by the unit tests instead.
 */
test.describe('Developer reference (public)', () => {
  test('opens without signing in, is noindex, and shows the base URL and the introduction', async ({
    page,
  }) => {
    const res = await page.goto('/developers/docs');
    expect(res?.status()).toBe(200);
    expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('REST API');
    await expect(page.locator('code', { hasText: /\/api\/v1$/ }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What you can do' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Authentication' })).toBeVisible();
    await expect(page.getByText('Authorization: Bearer YOUR_API_KEY').first()).toBeVisible();
  });

  test('states the real rate limit and that webhook delivery is not live yet', async ({ page }) => {
    await page.goto('/developers/docs');
    await expect(page.getByText('600 requests per minute')).toBeVisible();
    await expect(page.getByText('Webhook delivery is coming')).toBeVisible();
    await expect(page.getByText('message_received')).toHaveCount(0);
  });

  test('"Get an API key" leads to /developers, and the spec link opens the OpenAPI document', async ({
    page,
  }) => {
    await page.goto('/developers/docs');
    await expect(page.getByRole('link', { name: 'Get an API key' })).toHaveAttribute(
      'href',
      '/developers',
    );
    const spec = page.getByRole('link', { name: 'OpenAPI spec' });
    await expect(spec).toHaveAttribute('href', /\/docs\/api\.json$/);
    await expect(spec).toHaveAttribute('target', '_blank');
  });

  test('lists endpoints by group, opens a card, shows a cURL on the base URL, and the filter narrows the list', async ({
    page,
  }) => {
    await page.goto('/developers/docs');
    const cards = page.locator('[data-endpoint]');
    await expect(cards.first()).toBeVisible();
    const all = await cards.count();
    expect(all).toBeGreaterThan(5);

    const first = cards.first();
    const head = first.getByRole('button').first();
    await expect(head).toHaveAttribute('aria-expanded', 'false');
    await head.click();
    await expect(head).toHaveAttribute('aria-expanded', 'true');
    await expect(first.locator('pre').first()).toContainText('curl -X');
    await expect(first.locator('pre').first()).toContainText('/api/v1/');
    await expect(first.locator('pre').first()).toContainText('Authorization: Bearer YOUR_API_KEY');

    await page.getByLabel('Filter endpoints').fill('contacts');
    const narrowed = await cards.count();
    expect(narrowed).toBeGreaterThan(0);
    expect(narrowed).toBeLessThan(all);
    await page.getByLabel('Filter endpoints').fill('zzz-no-such-endpoint');
    await expect(page.getByText(/No endpoint matches/)).toBeVisible();
    await page.getByRole('button', { name: 'Clear the filter' }).click();
    await expect(cards).toHaveCount(all);
  });

  test('keyboard: a card opens with Enter on its head, and a deep link opens its card', async ({
    page,
  }) => {
    await page.goto('/developers/docs');
    const head = page.locator('[data-endpoint]').first().getByRole('button').first();
    await head.focus();
    await page.keyboard.press('Enter');
    await expect(head).toHaveAttribute('aria-expanded', 'true');

    const id = await page.locator('[data-endpoint]').nth(1).getAttribute('id');
    await page.goto(`/developers/docs#${id}`);
    await expect(page.locator(`#${id}`).getByRole('button').first()).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  test('copy buttons copy the text', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/developers/docs');
    await page.getByRole('button', { name: 'Copy the base URL' }).click();
    await expect(page.getByText('Copied').first()).toBeAttached();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/api\/v1$/);
  });

  test('/docs and /docs/api redirect to /developers/docs without a login', async ({
    page,
    request,
  }) => {
    for (const path of ['/docs', '/docs/api']) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(302);
      expect(res.headers().location).toContain('/developers/docs');
    }
    await page.goto('/docs/api');
    await expect(page).toHaveURL(/\/developers\/docs$/);
  });

  test('works on a phone width: no sideways scroll, the filter is reachable', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/developers/docs');
    await expect(page.getByLabel('Filter endpoints')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('is right-to-left in Arabic', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'ar', url: baseURL! }]);
    await page.goto('/developers/docs');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });
});
