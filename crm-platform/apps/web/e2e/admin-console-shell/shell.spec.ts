import { expect, test, type Page } from '@playwright/test';

/**
 * TW-ASHELL-003/004/005 against the running stack. Signs in as a local `support` operator (not
 * forced through MFA enrolment), created with `pnpm --filter @crm/api operator:create`; the gated
 * super admin has its own test. Both accounts exist only in the local development database.
 */
const SUPPORT = { email: 'e2e-support@example.test', password: 'E2e-Console-Pass1' };
const SUPER_ADMIN = { email: 'operator@example.test', password: 'Passw0rd!' };
const ORIGIN = 'http://localhost:3001';

async function signIn(page: Page, who: { email: string; password: string }) {
  const res = await page.request.post('/api/platform-auth/login', { data: who });
  expect(res.ok(), `operator login for ${who.email}`).toBe(true);
}

/** True once React has attached to the rail: before that, a click on the server-rendered HTML does nothing. */
async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('#console-sidebar');
    return !!el && Object.keys(el).some((k) => k.startsWith('__react'));
  });
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await hydrated(page);
}

async function reload(page: Page) {
  await page.reload();
  await hydrated(page);
}

const aside = (page: Page) => page.locator('#console-sidebar');
const openGroups = (page: Page) =>
  aside(page).locator('[data-testid^="group-"][aria-expanded="true"]');

test.describe('access', () => {
  test('a guest is sent to the operator sign-in', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('a gated super admin gets only the enrolment page, with the menu disabled', async ({
    page,
  }) => {
    await signIn(page, SUPER_ADMIN);
    await open(page, '/admin');
    await expect(page).toHaveURL(/\/admin\/account\/security/);
    await expect(aside(page).locator('[aria-disabled="true"]').first()).toBeVisible();
    await expect(aside(page).getByRole('link', { name: 'Plans' })).toHaveCount(0);
  });

  test('signing out ends the session', async ({ page }) => {
    await signIn(page, SUPPORT);
    await open(page, '/admin');
    await page
      .getByRole('button', { name: /sign out/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/admin\/login/);
    await open(page, '/admin');
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});

test.describe('rail (desktop)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, SUPPORT);
  });

  test('Overview is highlighted on /admin and the page lists every area', async ({ page }) => {
    await open(page, '/admin');
    await expect(aside(page).getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('heading', { name: 'Platform console' })).toBeVisible();
    expect(
      await page.locator('#console-main section[aria-labelledby]').count(),
    ).toBeGreaterThanOrEqual(3);
  });

  test('only the deepest matching leaf is highlighted, and only its group is open', async ({
    page,
  }) => {
    await open(page, '/admin/security/events');
    const current = aside(page).locator('[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute('href', '/admin/security/events');
    await expect(openGroups(page)).toHaveCount(1);
  });

  test('groups collapse and expand independently', async ({ page }) => {
    await open(page, '/admin/security');
    expect(await aside(page).locator('[data-testid^="group-"]').count()).toBeGreaterThanOrEqual(3);

    // Located by its label so the locator keeps matching while aria-expanded flips.
    const security = aside(page).getByRole('button', { name: /^Show or hide Security$/ });
    await expect(security).toHaveAttribute('aria-expanded', 'true');
    await security.click();
    await expect(security).toHaveAttribute('aria-expanded', 'false');
    await expect(aside(page).getByRole('link', { name: 'Security events' })).toBeHidden();
    await security.click();
    await expect(security).toHaveAttribute('aria-expanded', 'true');
    await expect(aside(page).getByRole('link', { name: 'Security events' })).toBeVisible();

    const plans = aside(page).getByRole('button', { name: /^Show or hide Plans/ });
    await expect(plans).toHaveAttribute('aria-expanded', 'false');
    await plans.click();
    await expect(plans).toHaveAttribute('aria-expanded', 'true');
    await expect(openGroups(page)).toHaveCount(2);
  });

  test('the Plans badge shows the live plan count and no other leaf shows one', async ({
    page,
  }) => {
    const api = await page.request.get('/api/platform/plans');
    expect(api.ok()).toBe(true);
    const total = ((await api.json()) as { summary: { total: number } }).summary.total;
    expect(total).toBeGreaterThan(0);
    await open(page, '/admin/plans');
    await expect(aside(page).getByTestId('count-plans')).toHaveText(String(total));
    await expect(aside(page).locator('[data-testid^="count-"]')).toHaveCount(1);
  });

  test('collapsing the rail hides labels, sets the cookie and survives a reload with no flash', async ({
    page,
    context,
  }) => {
    await open(page, '/admin');
    await expect(aside(page)).toHaveAttribute('data-collapsed', 'false');
    const toggle = page.getByTestId('console-sidebar-toggle');
    await expect(toggle).toHaveAttribute('aria-label', 'Collapse sidebar');
    await toggle.click();
    await expect(aside(page)).toHaveAttribute('data-collapsed', 'true');
    await expect(toggle).toHaveAttribute('aria-label', 'Expand sidebar');
    await expect(aside(page).getByText('Overview', { exact: true })).toBeHidden();
    expect((await aside(page).boundingBox())!.width).toBeLessThan(100);

    const cookie = (await context.cookies()).find((c) => c.name === 'crm_console_sidebar');
    expect(cookie?.value).toBe('collapsed');

    // The server renders it collapsed in the first response: read the raw HTML, not the hydrated DOM.
    const html = await (await page.request.get('/admin')).text();
    expect(html).toMatch(/id="console-sidebar"[^>]*data-collapsed="true"/);

    await reload(page);
    await expect(aside(page)).toHaveAttribute('data-collapsed', 'true');

    await page.getByTestId('console-sidebar-toggle').click();
    await expect(aside(page)).toHaveAttribute('data-collapsed', 'false');
    const expanded = await (await page.request.get('/admin')).text();
    expect(expanded).toMatch(/id="console-sidebar"[^>]*data-collapsed="false"/);
  });

  test('a tampered cookie never hides the menu', async ({ page, context }) => {
    await context.addCookies([{ name: 'crm_console_sidebar', value: 'garbage', url: ORIGIN }]);
    await open(page, '/admin');
    await expect(aside(page)).toHaveAttribute('data-collapsed', 'false');
    await expect(aside(page).getByRole('link', { name: 'Overview' })).toBeVisible();
  });

  test('the collapsed rail still reaches every page', async ({ page }) => {
    await open(page, '/admin');
    await page.getByTestId('console-sidebar-toggle').click();
    await aside(page).getByRole('link', { name: 'Plans' }).click();
    await expect(page).toHaveURL(/\/admin\/plans/);
    await expect(aside(page)).toHaveAttribute('data-collapsed', 'true');
  });

  test('keyboard users reach the skip link first, and the theme toggles', async ({ page }) => {
    await open(page, '/admin');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: /skip to/i })).toBeFocused();
    const before = await page.locator('html').getAttribute('data-theme');
    await page
      .getByRole('button', { name: /switch to (dark|light)/i })
      .first()
      .click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', before ?? '');
  });

  test('right-to-left languages put the rail on the right', async ({ page }) => {
    await open(page, '/admin');
    await page.getByLabel(/language/i).selectOption('ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const box = (await aside(page).boundingBox())!;
    expect(box.x + box.width).toBeGreaterThan(page.viewportSize()!.width - 5);
  });
});

test.describe('rail (phone)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await signIn(page, SUPPORT);
    await open(page, '/admin');
  });

  test('the rail is off-screen until the menu button opens it as a drawer', async ({ page }) => {
    await expect(aside(page)).toBeHidden();
    await expect(page.getByTestId('console-sidebar-toggle')).toBeHidden();
    await page.getByTestId('console-menu-button').click();
    await expect(aside(page)).toBeVisible();
    await expect(page.getByTestId('console-menu-button')).toHaveAttribute('aria-expanded', 'true');
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  });

  test('the backdrop closes the drawer and unlocks scrolling', async ({ page }) => {
    await page.getByTestId('console-menu-button').click();
    await page.mouse.click(380, 400);
    await expect(aside(page)).toBeHidden();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  });

  test('Escape closes the drawer and returns focus to the menu button', async ({ page }) => {
    await page.getByTestId('console-menu-button').click();
    await page.keyboard.press('Escape');
    await expect(aside(page)).toBeHidden();
    await expect(page.getByTestId('console-menu-button')).toBeFocused();
  });

  test('choosing a page closes the drawer', async ({ page }) => {
    await page.getByTestId('console-menu-button').click();
    // Only the active group is open on first paint, so open the one holding Plans.
    await aside(page)
      .getByRole('button', { name: /^Show or hide Plans/ })
      .click();
    await aside(page).getByRole('link', { name: 'Plans' }).click();
    await expect(page).toHaveURL(/\/admin\/plans/);
    await expect(aside(page)).toBeHidden();
  });

  test('the page never scrolls sideways', async ({ page }) => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('a collapsed-rail cookie does not shrink the phone drawer', async ({ page, context }) => {
    await context.addCookies([{ name: 'crm_console_sidebar', value: 'collapsed', url: ORIGIN }]);
    await reload(page);
    await page.getByTestId('console-menu-button').click();
    await expect(aside(page).getByText('Overview', { exact: true })).toBeVisible();
    expect((await aside(page).boundingBox())!.width).toBeGreaterThan(200);
  });
});
