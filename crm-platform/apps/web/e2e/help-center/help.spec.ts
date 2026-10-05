import { expect, test, type Page } from '@playwright/test';
import { HELP_DOCS } from '../../src/features/_registry/help.generated';
import { NAV } from '../../src/features/_registry/nav.generated';
import { SETTINGS } from '../../src/features/_registry/settings.generated';

/**
 * The Help center against the running stack: the Help icon above Settings (rail and drawer), `/help` with search, a guide page and
 * its "On this page" links, an unknown guide (404), a guide that the workspace's plan does not include (absent from the list and
 * its address is a 404), and the "?" on a page. Signs in as the seeded local workspace admin (`pnpm --filter @crm/api seed:auth`),
 * reads the plan's features from the API, and creates no data.
 */
const ORG = process.env.E2E_ORG ?? 'Admin';
const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'nachiket.challawar@geta.ai',
  password: process.env.E2E_PASSWORD ?? 'Passw0rd!',
};
const API = process.env.API_URL ?? 'http://localhost:3000';

async function signIn(page: Page) {
  const res = await page.request.post('/api/auth/login', {
    data: { orgSlug: ORG, email: ADMIN.email, password: ADMIN.password },
  });
  expect(res.ok(), `sign in as ${ADMIN.email}`).toBe(true);
}

/** True once React has attached to the screen: before that, a click on the server-rendered HTML does nothing. */
async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('main') ?? document.body;
    return Object.keys(el.firstElementChild ?? el).some((k) => k.startsWith('__react'));
  });
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await hydrated(page);
}

/** The plan features this workspace has, read from the API with the session's access token. */
async function planFeatures(page: Page): Promise<string[]> {
  const token = (await page.context().cookies()).find((c) => c.name === 'crm_at')?.value;
  expect(token, 'access cookie after sign-in').toBeTruthy();
  const res = await page.request.get(`${API}/v2/billing/entitlements`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), 'entitlements').toBe(true);
  return ((await res.json()) as { features: string[] }).features;
}

/** A guide the workspace's plan hides: its own gate, or every documented screen's gate, names a feature the plan lacks. */
function hiddenByPlan(features: string[]) {
  const gate = new Map<string, string | undefined>([
    ...NAV.map((n): [string, string | undefined] => [`nav:${n.id}`, n.gates?.planFeature]),
    ...SETTINGS.map((t): [string, string | undefined] => [`tile:${t.id}`, t.gates?.planFeature]),
  ]);
  const lacking = (feature: string | undefined) => Boolean(feature && !features.includes(feature));
  return HELP_DOCS.filter(
    (d) =>
      lacking(d.gates.planFeature) ||
      (d.documents.length > 0 && d.documents.every((ref) => lacking(gate.get(ref)))),
  );
}

test.describe('Help center', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('the Help icon sits directly above Settings in the rail', async ({ page }) => {
    await open(page, '/dashboard');
    const pinned = page.locator('aside nav[aria-label="Help and settings"]');
    const help = pinned.getByRole('link', { name: 'Help' });
    const settings = pinned.getByRole('link', { name: 'Settings' });
    await expect(help).toHaveAttribute('href', '/help');
    const [h, s] = [await help.boundingBox(), await settings.boundingBox()];
    expect(h && s && h.y < s.y, 'Help is above Settings').toBe(true);
  });

  test('and in the mobile drawer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '/dashboard');
    await page.getByRole('button', { name: 'Open menu' }).click();
    const drawer = page.getByRole('dialog', { name: 'Main menu' });
    const help = drawer.getByRole('link', { name: 'Help', exact: true });
    const settings = drawer.getByRole('link', { name: 'Settings', exact: true });
    const [h, s] = [await help.boundingBox(), await settings.boundingBox()];
    expect(h && s && h.y < s.y, 'Help is above Settings').toBe(true);
  });

  test('/help lists the guides and search filters them', async ({ page }) => {
    await open(page, '/help');
    await expect(page.getByRole('heading', { name: 'Help center', level: 1 })).toBeVisible();
    await expect(page.locator('a[href="/help/getting-started"]')).toBeVisible();
    const status = page.getByRole('status');
    const all = await status.textContent();
    expect(all).toMatch(/\d+ guides/);

    await page.getByRole('searchbox', { name: 'Search help' }).fill('tooltip');
    await expect(page.locator('a[href="/help/using-help"]')).toBeVisible();
    await expect(page.locator('a[href="/help/getting-started"]')).toHaveCount(0);
    await expect(status).toHaveText(/^\d+ guides?$/);

    await page.getByRole('searchbox', { name: 'Search help' }).fill('zzzz-no-such-guide');
    await expect(page.getByText('No guides match your search')).toBeVisible();

    await page.getByRole('searchbox', { name: 'Search help' }).fill('');
    await expect(status).toHaveText(all!);
  });

  test('a guide shows "On this page" and a heading link focuses its heading', async ({ page }) => {
    await open(page, '/help/using-help');
    await expect(
      page.getByRole('heading', { name: 'Using the help center', level: 1 }),
    ).toBeVisible();
    const toc = page.getByRole('navigation', { name: 'On this page' });
    await expect(toc).toBeVisible();
    await toc.getByRole('link', { name: 'Searching' }).click();
    await expect(page).toHaveURL(/#searching$/);
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('searching');
  });

  test('an unknown guide is a 404', async ({ page }) => {
    const res = await page.goto('/help/does-not-exist-anywhere');
    expect(res?.status()).toBe(404);
  });

  test('a guide the plan does not include is absent from the list, search and its address', async ({
    page,
  }) => {
    const features = await planFeatures(page);
    const hidden = hiddenByPlan(features).find((d) => d.text.en);
    test.skip(!hidden, 'no guide on the seeded workspace is gated on a feature its plan lacks');
    const title = hidden!.text.en.title;

    await open(page, '/help');
    await expect(page.locator(`a[href="/help/${hidden!.id}"]`)).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Search help' }).fill(title);
    await expect(page.locator(`a[href="/help/${hidden!.id}"]`)).toHaveCount(0);

    const res = await page.goto(`/help/${hidden!.id}`);
    expect(res?.status()).toBe(404);
  });

  test('the page tip opens, shows the summary, closes on Escape and links to the guide', async ({
    page,
  }) => {
    const guide = HELP_DOCS.find((d) => d.documents.includes('nav:contacts'));
    test.skip(!guide, 'no guide documents the Contacts screen');
    await open(page, '/contacts');

    const tip = page.getByRole('button', { name: `Help: ${guide!.text.en.title}` });
    await expect(tip).toHaveAttribute('aria-expanded', 'false');
    await tip.click();
    await expect(tip).toHaveAttribute('aria-expanded', 'true');
    const bubble = page.getByRole('group', { name: guide!.text.en.title });
    await expect(bubble).toContainText(guide!.text.en.summary);

    await page.keyboard.press('Escape');
    await expect(tip).toHaveAttribute('aria-expanded', 'false');
    await expect(tip).toBeFocused();

    await tip.click();
    await page.getByRole('link', { name: 'Read the guide' }).click();
    await expect(page).toHaveURL(new RegExp(`/help/${guide!.id}$`));
    await expect(page.getByRole('heading', { level: 1, name: guide!.text.en.title })).toBeVisible();
  });
});
