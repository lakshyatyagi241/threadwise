import { test, expect, type Page } from '@playwright/test';

/**
 * The two sign-in pages themselves, driven the way a person uses them. Every other journey signs in through the API to save time;
 * these two type into the form with the real QA accounts (QA_EMAIL/QA_PASSWORD for the workspace, QA_OP_EMAIL/QA_OP_PASSWORD for /admin).
 *
 * Safety: they import from @playwright/test, not from ../qa, so they make no extra API logins. They never submit a wrong password,
 * and they never retry: a retry after a wrong or empty password would be a second failed sign-in on a real account. Missing
 * credentials fail the test on production (a skipped sign-in test would look green) and skip it locally instead of submitting an empty form.
 * They create no records, only a session; the operator one signs out at the end. Tracing, screenshots and video are off for this file because a
 * Playwright trace records typed values, and these tests type real passwords.
 */
test.describe.configure({ retries: 0 });
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

/** Production must never skip a sign-in check silently; locally an unset account just skips it. */
function need(email: string | undefined, password: string | undefined, names: string) {
  if (email && password) return;
  if (process.env.QA_TARGET === 'prod') throw new Error(`${names} must be set when QA_TARGET=prod`);
  test.skip(true, `${names} are not set`);
}

const path = (page: Page) => new URL(page.url()).pathname;

/** Server errors and uncaught script errors on the page itself; asserted at the end of each journey. */
function watch(page: Page) {
  const seen: string[] = [];
  page.on('pageerror', (e) => seen.push(`script error: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 500)
      seen.push(`${r.request().method()} ${new URL(r.url()).pathname} -> ${r.status()}`);
  });
  return seen;
}

async function signIn(page: Page, path: string, email: string, password: string) {
  await page.goto(path);
  await page
    .getByRole('button', { name: /^decline$/i })
    .first()
    .click({ timeout: 3000 })
    .catch(() => undefined);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test.describe('sign-in pages', () => {
  test('[login] a workspace user signs in on /login and lands inside the app', async ({ page }) => {
    const { QA_EMAIL: email, QA_PASSWORD: password } = process.env;
    need(email, password, 'QA_EMAIL and QA_PASSWORD');
    const errors = watch(page);
    await signIn(page, '/login', email!, password!);
    await expect.poll(() => path(page), { timeout: 30_000 }).toMatch(/^\/dashboard(\/|$)/);
    await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Application error|Something went wrong/)).toHaveCount(0);
    await page.reload(); // the session survives a reload
    await expect.poll(() => path(page)).toMatch(/^\/dashboard(\/|$)/);
    await expect(page.getByRole('navigation').first()).toBeVisible();
    expect(errors, 'the page misbehaved underneath').toEqual([]);
  });

  test('[operator] an operator signs in on /admin/login and lands in the console', async ({
    page,
  }) => {
    const { QA_OP_EMAIL: email, QA_OP_PASSWORD: password } = process.env;
    need(email, password, 'QA_OP_EMAIL and QA_OP_PASSWORD');
    const errors = watch(page);
    await signIn(page, '/admin/login', email!, password!);
    await expect
      .poll(() => path(page), { timeout: 30_000 })
      .toMatch(/^\/admin(\/(?!login(\/|$)).*)?$/);
    await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Application error|Something went wrong/)).toHaveCount(0);
    await page.reload();
    await expect.poll(() => path(page)).toMatch(/^\/admin(\/(?!login(\/|$)).*)?$/);
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    expect(errors, 'the page misbehaved underneath').toEqual([]);
    await page.getByRole('button', { name: 'Sign out' }).click(); // do not leave an operator session behind
    await expect.poll(() => path(page), { timeout: 15_000 }).toMatch(/^\/admin\/login/);
  });
});
