import { test, expect } from '../qa';

// Anonymous visitor: uses the plain `page`/`request` fixtures, no session.
test.describe('public pages', () => {
  test('[public] login page renders and refuses an empty or wrong sign-in', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create an account' })).toBeVisible();

    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(
      page.getByRole('alert').or(page.locator('[aria-invalid="true"]')).first(),
    ).toBeVisible();

    await page.getByLabel('Email').fill('nobody@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill('definitely-wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('[public] register page renders its sign-up form and links back to sign in', async ({
    page,
  }) => {
    await page.goto('/register');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByLabel('Email').first()).toBeVisible();
    await page
      .getByRole('link', { name: /sign in|log in/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('[public] forgot-password page accepts an email and does not reveal whether it exists', async ({
    page,
  }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('Workspace').fill('qa-auto-no-such-workspace');
    await page.getByLabel('Email').fill('qa-nobody@example.invalid');
    await page.getByRole('button', { name: 'Email reset link' }).click();
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
  });

  test('[public] developer reference is readable without signing in', async ({ page }) => {
    const res = await page.goto('/developers/docs');
    expect(res?.status()).toBe(200);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('REST API');
    await expect(page.getByRole('heading', { name: 'Authentication' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get an API key' })).toHaveAttribute(
      'href',
      '/developers',
    );
  });

  test('[public] health and readiness endpoints answer 200', async ({ request }) => {
    for (const path of ['/api/health', '/api/ready']) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
    }
  });

  test('[public] robots.txt and sitemap.xml are served', async ({ request }) => {
    const robots = await request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toMatch(/User-agent:/i);
    const map = await request.get('/sitemap.xml');
    expect(map.status()).toBe(200);
    expect(await map.text()).toMatch(/<urlset|<sitemapindex/);
  });

  test('[public] an unknown address shows a friendly 404, not a stack trace', async ({ page }) => {
    const res = await page.goto('/qa-auto-this-page-does-not-exist');
    expect(res?.status()).toBe(404);
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/404|not found/i);
    expect(body).not.toMatch(
      /at \w+ \(|node_modules|TypeError|ReferenceError|Internal Server Error/,
    );
  });

  test('[public] the signed-in app sends a guest to sign in', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});
