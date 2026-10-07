import { expect, test, type Page } from '@playwright/test';

/**
 * WD-ASHELL-003/004/005 against the running stack. Signs in as a local `support` operator (not
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

/** The rail's hubs, top to bottom (console-layout.ts). Each opens on its first page and shows the others as tabs. */
const HUBS = [
  'reports',
  'plans',
  'billing',
  'messaging',
  'support',
  'website',
  'whatsapp',
  'apps',
  'team',
  'settings',
  'system',
];

const palette = (page: Page) => page.getByTestId('console-palette');
const paletteField = (page: Page) => palette(page).getByRole('combobox');

const aside = (page: Page) => page.locator('#console-sidebar');
const hub = (page: Page, id: string) => aside(page).getByTestId(`hub-${id}`);
/** The tab bar above the open page. Its links carry the live count, so tabs are addressed by test id. */
const tabs = (page: Page) => page.getByTestId('hub-tabs');
const tab = (page: Page, id: string) => tabs(page).getByTestId(`tab-${id}`);

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
    await expect(aside(page).locator('a[href="/admin/plans"]')).toHaveCount(0);
  });

  test('signing out ends the session', async ({ page }) => {
    await signIn(page, SUPPORT);
    await open(page, '/admin');
    await page
      .getByRole('button', { name: /sign out/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/admin\/login/);
    // No rail on the sign-in page, so there is nothing to wait for hydrating.
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});

test.describe('rail (desktop)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, SUPPORT);
  });

  test('Home is highlighted on /admin, with what needs attention and one card per hub', async ({
    page,
  }) => {
    await open(page, '/admin');
    await expect(aside(page).getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('heading', { name: 'Platform console' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
    expect(await page.locator('[data-testid^="home-hub-"]').count()).toBe(HUBS.length);
  });

  test('the menu is eleven hubs ordered by the job to be done, not one heading per domain', async ({
    page,
  }) => {
    await open(page, '/admin');
    const ids = await aside(page)
      .locator('[data-testid^="hub-"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
    expect(ids).toEqual(HUBS.map((id) => `hub-${id}`));
  });

  test('every hub opens on a page whose tab bar lists the hub, with no page in two bars', async ({
    page,
  }) => {
    const seen: string[] = [];
    for (const id of HUBS) {
      await open(page, '/admin');
      await hub(page, id).click();
      await expect(hub(page, id)).toHaveAttribute('aria-current', 'page');
      if (id === 'settings') {
        // Settings is one entry: its page lists the others as tiles, so there is no tab bar.
        await expect(tabs(page)).toHaveCount(0);
        continue;
      }
      await expect(tabs(page)).toBeVisible();
      const hrefs = await tabs(page)
        .locator('a')
        .evaluateAll((els) => els.map((el) => el.getAttribute('href')!));
      expect(hrefs.length, id).toBeGreaterThanOrEqual(2);
      expect(hrefs.length, id).toBeLessThanOrEqual(10); // nine tabs, and "More"
      seen.push(...hrefs);
    }
    expect(new Set(seen).size).toBe(seen.length);
  });

  test('only the deepest matching page is highlighted: its hub in the rail, its tab in the bar', async ({
    page,
  }) => {
    await open(page, '/admin/security/events');
    await expect(aside(page).locator('[aria-current="page"]')).toHaveCount(1);
    await expect(hub(page, 'team')).toHaveAttribute('aria-current', 'page');
    await expect(tab(page, 'security-events')).toHaveAttribute('aria-current', 'page');
    await expect(tab(page, 'security')).not.toHaveAttribute('aria-current', 'page');
  });

  test('a tab opens its page and keeps the hub, and a detail page keeps its list tab', async ({
    page,
  }) => {
    await open(page, '/admin/roles');
    await tab(page, 'security').click();
    await expect(page).toHaveURL(/\/admin\/security$/);
    await expect(hub(page, 'team')).toHaveAttribute('aria-current', 'page');
    await open(page, '/admin/roles/new');
    await expect(tab(page, 'roles')).toHaveAttribute('aria-current', 'page');
  });

  test('a Settings page offers a way back to the Settings hub instead of a tab bar', async ({
    page,
  }) => {
    await open(page, '/admin/settings/general');
    await expect(hub(page, 'settings')).toHaveAttribute('aria-current', 'page');
    await expect(tabs(page)).toHaveCount(0);
    await page.getByTestId('hub-back').click();
    await expect(page).toHaveURL(/\/admin\/settings$/);
  });

  test('Flow templates, which had no menu entry, is a tab of Apps', async ({ page }) => {
    await open(page, '/admin/marketplace');
    await tab(page, 'flow-templates').click();
    await expect(page).toHaveURL(/\/admin\/flow-templates/);
  });

  test('the Plans tab shows the live plan count', async ({ page }) => {
    const api = await page.request.get('/api/platform/plans');
    expect(api.ok()).toBe(true);
    const total = ((await api.json()) as { summary: { total: number } }).summary.total;
    expect(total).toBeGreaterThan(0);
    await open(page, '/admin/plans');
    await expect(tabs(page).getByTestId('count-plans')).toHaveText(String(total));
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
    await expect(aside(page).getByText('Home', { exact: true })).toBeHidden();
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
    await expect(aside(page).getByRole('link', { name: 'Home' })).toBeVisible();
  });

  test('the collapsed rail shows one icon per hub, and an icon opens its hub', async ({ page }) => {
    await open(page, '/admin');
    await page.getByTestId('console-sidebar-toggle').click();
    await expect(aside(page)).toHaveAttribute('data-collapsed', 'true');
    // Icons only: no name is on screen, but every hub can be reached.
    await expect(aside(page).getByText('Plans & pricing', { exact: true })).toBeHidden();
    for (const id of HUBS) await expect(hub(page, id)).toBeVisible();

    await hub(page, 'plans').click();
    await expect(page).toHaveURL(/\/admin\/plans/);
    await expect(tab(page, 'plans')).toHaveAttribute('aria-current', 'page');
  });

  test('the brand row and the account row stay in view while the hub list scrolls', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 420 });
    await open(page, '/admin/settings/general');
    const nav = aside(page).locator('nav');
    expect(await nav.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await nav.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(
      aside(page).getByRole('link', { name: /account and two-factor/i }),
    ).toBeInViewport();
    await expect(aside(page).getByText('CRM', { exact: true })).toBeInViewport();
  });

  test('Ctrl+K opens the search with the field focused; typing finds a page and Enter opens it', async ({
    page,
  }) => {
    await open(page, '/admin');
    await page.keyboard.press('Control+K');
    await expect(palette(page)).toBeVisible();
    await expect(paletteField(page)).toBeFocused();
    // Before anything is typed it offers the first eight pages of the menu (WD-ASHELL-019).
    await expect(palette(page).getByRole('option')).toHaveCount(8);
    await expect(palette(page).getByRole('option').first()).toContainText('Home');

    await paletteField(page).fill('wallet logs');
    const first = palette(page).getByRole('option').first();
    await expect(first).toContainText('Wallet logs');
    await expect(first).toContainText('Messaging billing');
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/admin\/wallet\/logs/);
    await expect(palette(page)).toHaveCount(0);
    await expect(hub(page, 'messaging')).toHaveAttribute('aria-current', 'page');
    await expect(tab(page, 'wallet-logs')).toHaveAttribute('aria-current', 'page');
  });

  test('the search finds a page by the words of its address, and says so when nothing matches', async ({
    page,
  }) => {
    await open(page, '/admin');
    await page.getByTestId('console-search-trigger').click();
    await paletteField(page).fill('api keys');
    await expect(palette(page).getByRole('option')).toHaveCount(1);
    await expect(palette(page).getByRole('option')).toContainText('AI provider keys');

    await paletteField(page).fill('zzzzzz');
    await expect(palette(page).getByRole('option')).toHaveCount(0);
    await expect(palette(page)).toContainText('No results for');
    await page.keyboard.press('Enter'); // nothing highlighted: nothing happens
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('arrow keys move through the results and wrap around', async ({ page }) => {
    await open(page, '/admin');
    await page.keyboard.press('Control+K');
    await paletteField(page).fill('invoices');
    const options = palette(page).getByRole('option');
    const count = await options.count();
    expect(count).toBeGreaterThan(1);
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(paletteField(page)).toHaveAttribute('aria-activedescendant', /option-1$/);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(options.nth(count - 1)).toHaveAttribute('aria-selected', 'true');
  });

  test('Escape closes the search and gives focus back; Ctrl+K again also closes it', async ({
    page,
  }) => {
    await open(page, '/admin');
    const trigger = page.getByTestId('console-search-trigger');
    await trigger.click();
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette(page)).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await page.keyboard.press('Control+K');
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press('Control+K');
    await expect(palette(page)).toHaveCount(0);
  });

  test('the search finds a page by a hidden keyword, and lists at most twelve matches', async ({
    page,
  }) => {
    await open(page, '/admin');
    await page.keyboard.press('Control+K');
    await paletteField(page).fill('stripe');
    await expect(palette(page).getByRole('option').first()).toContainText('Payment gateways');
    await paletteField(page).fill('settings');
    expect(await palette(page).getByRole('option').count()).toBeLessThanOrEqual(12);
  });

  test('a click outside the card closes the search', async ({ page }) => {
    await open(page, '/admin');
    await page.keyboard.press('Control+K');
    await expect(palette(page)).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(palette(page)).toHaveCount(0);
  });

  test('clicking a result opens it', async ({ page }) => {
    await open(page, '/admin');
    await page.keyboard.press('Control+K');
    await paletteField(page).fill('coupons');
    await palette(page).getByRole('option').first().click();
    await expect(page).toHaveURL(/\/admin\/coupons/);
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

  test('choosing a hub closes the drawer', async ({ page }) => {
    await page.getByTestId('console-menu-button').click();
    await hub(page, 'plans').click();
    await expect(page).toHaveURL(/\/admin\/plans/);
    await expect(aside(page)).toBeHidden();
  });

  test('the page never scrolls sideways', async ({ page }) => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('the compact search button opens the search on a phone', async ({ page }) => {
    await page.getByTestId('console-search-trigger-compact').click();
    await expect(palette(page)).toBeVisible();
    await paletteField(page).fill('security events');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin\/security\/events/);
  });

  test('Escape closes only the search, not the menu drawer behind it', async ({ page }) => {
    await page.getByTestId('console-menu-button').click();
    await expect(aside(page)).toBeVisible();
    await page.keyboard.press('Control+K');
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette(page)).toHaveCount(0);
    await expect(aside(page)).toBeVisible();
  });

  test('a collapsed-rail cookie does not shrink the phone drawer', async ({ page, context }) => {
    await context.addCookies([{ name: 'crm_console_sidebar', value: 'collapsed', url: ORIGIN }]);
    await reload(page);
    await page.getByTestId('console-menu-button').click();
    await expect(aside(page).getByText('Home', { exact: true })).toBeVisible();
    expect((await aside(page).boundingBox())!.width).toBeGreaterThan(200);
  });
});
