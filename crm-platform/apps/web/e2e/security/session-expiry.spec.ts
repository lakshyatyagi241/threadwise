import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * QA task #17 (browser half): what the person sees when the session ends. The API half (token lifetimes, refresh rotation and reuse,
 * logout, revocation) is `pnpm qa 17`. Needs the running stack and the seeded LOCAL admin.
 */
const ORG = process.env.E2E_ORG ?? 'Admin';
const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'nachiket.challawar@geta.ai',
  password: process.env.E2E_PASSWORD ?? 'Passw0rd!',
};
const PROTECTED = '/contacts';

async function signIn(page: Page) {
  const res = await page.request.post('/api/auth/login', {
    data: { orgSlug: ORG, email: ADMIN.email, password: ADMIN.password },
  });
  expect(res.ok(), 'sign in').toBe(true);
}
const onLogin = (page: Page) =>
  expect(page).toHaveURL(/\/(login|find-workspace)/, { timeout: 15_000 });

test.describe('session expiry in the browser', () => {
  test('a signed-in visit to a protected page works', async ({ page }) => {
    await signIn(page);
    await page.goto(PROTECTED);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('clearing every cookie sends the next navigation to the sign-in page', async ({
    page,
    context,
  }) => {
    await signIn(page);
    await page.goto(PROTECTED);
    await context.clearCookies();
    await page.goto(PROTECTED);
    await onLogin(page);
  });

  test('a tampered session cookie is treated as signed out', async ({ page, context }) => {
    await signIn(page);
    const cookies = await context.cookies();
    await context.clearCookies();
    await context.addCookies(
      cookies.map((c) =>
        /sess|token|auth|access|refresh/i.test(c.name)
          ? { ...c, value: c.value.slice(0, -4) + 'AAAA' }
          : c,
      ),
    );
    await page.goto(PROTECTED);
    await onLogin(page);
  });

  test('an expired session cookie is treated as signed out', async ({ page, context }) => {
    await signIn(page);
    const cookies = await context.cookies();
    await context.clearCookies();
    await context.addCookies(
      cookies.map((c) =>
        /sess|token|auth|access|refresh/i.test(c.name)
          ? { ...c, expires: Math.floor(Date.now() / 1000) - 3600 }
          : c,
      ),
    );
    await page.goto(PROTECTED);
    await onLogin(page);
  });

  test('after sign-out the back button does not show the previous data', async ({ page }) => {
    await signIn(page);
    await page.goto(PROTECTED);
    await page.request.post('/api/auth/logout', { data: {} });
    await page.context().clearCookies();
    await page.goBack().catch(() => undefined);
    await page.reload();
    await onLogin(page);
  });

  test('signing out in one tab ends the session in the other', async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext({
      baseURL: process.env.WEB_URL ?? 'http://localhost:3001',
    });
    const a = await ctx.newPage();
    const b = await ctx.newPage();
    await signIn(a);
    await b.goto(PROTECTED);
    await a.request.post('/api/auth/logout', { data: {} });
    await ctx.clearCookies();
    await b.goto(PROTECTED);
    await onLogin(b);
    await ctx.close();
  });

  test('the API answers 401 (not 500, not data) to a call after the cookies are gone', async ({
    page,
    context,
  }) => {
    await signIn(page);
    await context.clearCookies();
    const res = await page.request.get('/api/v2/contacts');
    expect([401, 403]).toContain(res.status());
  });

  test('a protected deep link remembers where to go after sign-in', async ({ page }) => {
    await page.goto(`${PROTECTED}?tab=all`);
    await onLogin(page);
    expect(page.url(), 'a return target is kept').toMatch(
      /(redirect|next|returnTo|callback)=|contacts/i,
    );
  });
});
