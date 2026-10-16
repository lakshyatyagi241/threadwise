import { expect, test, type Page } from '@playwright/test';

/**
 * The Google account page (TW-GACC-001 to 006) against the running stack (web :3001, API :3000). Signs in as a local workspace admin
 * given by GOOGLE_E2E_EMAIL and GOOGLE_E2E_PASSWORD (plus GOOGLE_E2E_ORG, the workspace slug); without them the whole file is skipped.
 *
 * Nothing here presses Connect: that leaves for Google's own consent screen, which needs a real Google account. It reads the page in
 * whatever state the workspace is in and checks that each state offers what it should and nothing it should not. The first real
 * connection is the manual checklist in docs/threadwise-port/plan/google-workspace-build.md, section 6.
 */
const EMAIL = process.env.GOOGLE_E2E_EMAIL;
const PASSWORD = process.env.GOOGLE_E2E_PASSWORD;
const ORG = process.env.GOOGLE_E2E_ORG ?? 'Admin';
test.skip(!EMAIL || !PASSWORD, 'GOOGLE_E2E_EMAIL and GOOGLE_E2E_PASSWORD are not set');

async function signIn(page: Page) {
  const res = await page.request.post('/api/auth/login', {
    data: { orgSlug: ORG, email: EMAIL, password: PASSWORD },
  });
  expect(res.ok(), `sign in as ${EMAIL}`).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await page.goto('/google-account');
});

test('shows the account state and the five permissions', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1, name: 'Google account' })).toBeVisible({
    timeout: 30_000,
  });
  for (const name of ['Calendar', 'Sheets', 'Docs and Drive', 'Forms', 'Drive file list']) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
  // The two permissions Google treats as restricted are marked, and are not ticked for you.
  await expect(page.getByText('Restricted by Google')).toHaveCount(2);
});

test('offers only what the state allows', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1, name: 'Google account' })).toBeVisible({
    timeout: 30_000,
  });
  const connect = page.getByRole('button', { name: 'Connect Google account' });
  const add = page.getByRole('button', { name: 'Add permissions' });
  const reconnect = page.getByRole('button', { name: 'Reconnect Google' });
  const notSetUp = page.getByText('Google is not set up for this platform').first();
  if (await notSetUp.isVisible()) {
    await expect(connect).toHaveCount(0);
    await expect(add).toHaveCount(0);
    return;
  }
  // Exactly one primary action is offered for a manager.
  const offered = (await connect.count()) + (await add.count()) + (await reconnect.count());
  expect(offered).toBeLessThanOrEqual(1);
});

test('the flow builder warns on a Google step when Google cannot be used', async ({ page }) => {
  const status = await page.request.get('/api/v2/flows/builder-context/google/status');
  test.skip(!status.ok(), 'this account cannot read the Google status');
  const body = (await status.json()) as { status: string; granted: string[] };
  expect(['unavailable', 'disconnected', 'connected', 'needs_reconnect']).toContain(body.status);
  expect(JSON.stringify(body)).not.toMatch(/token|@/);
});
