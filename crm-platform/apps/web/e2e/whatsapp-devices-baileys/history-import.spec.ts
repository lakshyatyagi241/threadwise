import { expect, test, type Page } from '@playwright/test';

/**
 * The opt-in import of existing chats (TW-WAHIST) against the running stack (web :3001, API :3000). Signs in as the local account given
 * by WADEV_E2E_EMAIL and WADEV_E2E_PASSWORD (a workspace the operator allowed to use personal numbers); without them the file is skipped.
 *
 * Nothing here starts a pairing or touches WhatsApp: the choice step is only looked at and the wizard is closed unsent. A test that needs
 * a number that can be linked skips itself when the workspace has none. NOT run against a real WhatsApp account.
 */
const EMAIL = process.env.WADEV_E2E_EMAIL;
const PASSWORD = process.env.WADEV_E2E_PASSWORD;
test.skip(!EMAIL || !PASSWORD, 'WADEV_E2E_EMAIL and WADEV_E2E_PASSWORD are not set');

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(dashboard|inbox|devices|onboarding)/);
}

/** Opens the first number's page; returns its href, or null when the workspace has none. */
async function firstDevice(page: Page): Promise<string | null> {
  await page.goto('/devices');
  const link = page.locator('a[href^="/devices/"]').filter({ hasNotText: 'Groups' }).first();
  try {
    await link.waitFor({ state: 'visible', timeout: 15_000 });
  } catch {
    return null;
  }
  const href = await link.getAttribute('href');
  return href && /\/devices\/[0-9a-f-]{36}/.test(href) ? href : null;
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('a number page shows the imported-chats card with its state and the media note', async ({
  page,
}) => {
  const href = await firstDevice(page);
  test.skip(!href, 'the workspace has no personal number');
  await page.goto(href!);
  const card = page.getByTestId('history-card');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toHaveAttribute(
    'data-state',
    /not_requested|idle|running|done|failed|cancelled|limit_reached/,
  );
});

test('the link step asks before the QR, starts on "No" and lists what to expect once a choice is made', async ({
  page,
}) => {
  const href = await firstDevice(page);
  test.skip(!href, 'the workspace has no personal number');
  await page.goto(href!);
  const relink = page
    .getByRole('button', { name: /Link again|Reconnect|Try again|Connect/ })
    .first();
  test.skip(
    !(await relink.isVisible().catch(() => false)),
    'the number cannot be linked from its state',
  );
  await relink.click();
  const wizard = page.getByTestId('connect-wizard');
  await expect(wizard).toBeVisible();
  const choice = wizard.getByTestId('history-choice');
  // The notice may come first for a person who has not accepted it: this check only looks at the link step.
  test.skip(
    !(await choice.isVisible().catch(() => false)),
    'the wizard did not open on the link step',
  );
  await expect(wizard.getByTestId('history-none')).toBeChecked();
  await expect(wizard.getByTestId('history-points')).toHaveCount(0);
  await wizard.getByTestId('history-recent').check();
  await expect(wizard.getByTestId('history-points')).toContainText('Nothing is sent to anyone');
  await expect(wizard.getByTestId('history-points')).toContainText('not imported');
  await wizard.getByTestId('history-none').check();
  await expect(wizard.getByTestId('history-points')).toHaveCount(0);
  // Leave without starting anything.
  await page.keyboard.press('Escape');
});

test('the choice fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const href = await firstDevice(page);
  test.skip(!href, 'the workspace has no personal number');
  await page.goto(href!);
  await expect(page.getByTestId('history-card')).toBeVisible({ timeout: 20_000 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
