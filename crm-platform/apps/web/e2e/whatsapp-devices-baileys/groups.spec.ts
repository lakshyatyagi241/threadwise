import { expect, test, type Page } from '@playwright/test';

/**
 * The Groups tab of the Unofficial WhatsApp API area (`/devices/groups`) against the running stack (web :3001, API :3000). Signs in
 * as a local staff account given by WADEV_E2E_EMAIL and WADEV_E2E_PASSWORD (a development account of a workspace the operator allowed
 * to use personal numbers, holding wa.groups.*); without them the whole file is skipped. A test that needs a linked number, or a group,
 * skips itself when the workspace has none.
 *
 * Nothing here changes WhatsApp: no group is created, no member added, nothing joined. Those actions are risky on a real number, so the
 * create form is only driven as far as its guards (the risk box, the 20-number cap, the notice) and then left unsent.
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

/** Opens the tab and waits until it settled into one of its views. Returns which. */
async function openGroups(page: Page): Promise<'ready' | 'noDevice' | 'blocked'> {
  await page.goto('/devices/groups');
  const ready = page.getByTestId('groups-kpis');
  const noDevice = page.getByTestId('groups-state-noDevice');
  const blocked = page.locator(
    '[data-testid="groups-state-gateOff"], [data-testid="groups-state-denied"]',
  );
  await expect(ready.or(noDevice).or(blocked)).toBeVisible({ timeout: 20_000 });
  if (await ready.isVisible()) return 'ready';
  if (await noDevice.isVisible()) return 'noDevice';
  return 'blocked';
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('the Groups tab sits next to Numbers and Warmer and opens the groups page', async ({
  page,
}) => {
  const view = await openGroups(page);
  test.skip(
    view === 'blocked',
    'this workspace is not allowed to use personal numbers, or the role cannot read groups',
  );
  const tabs = page.getByRole('navigation', { name: 'Unofficial WhatsApp API' });
  await expect(tabs.getByRole('link', { name: 'Numbers' })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Groups' })).toHaveAttribute('aria-current', 'page');
  await tabs.getByRole('link', { name: 'Numbers' }).click();
  await expect(page).toHaveURL(/\/devices$/);
  await page
    .getByRole('navigation', { name: 'Unofficial WhatsApp API' })
    .getByRole('link', { name: 'Groups' })
    .click();
  await expect(page).toHaveURL(/\/devices\/groups/);
});

test('without a linked number it says so and offers the way to connect one', async ({ page }) => {
  const view = await openGroups(page);
  test.skip(view !== 'noDevice', 'the workspace has a linked number');
  await expect(page.getByTestId('groups-state-noDevice')).toContainText(
    'No personal number connected',
  );
  await expect(page.getByRole('link', { name: 'Connect a number' })).toHaveAttribute(
    'href',
    '/devices',
  );
});

test('shows the number rail, the counters and the limits of the number on show', async ({
  page,
}) => {
  const view = await openGroups(page);
  test.skip(view !== 'ready', 'needs a linked personal number');
  const rail = page.getByTestId('groups-rail');
  await expect(rail).toBeVisible();
  // Every number is online or offline, and links to its own groups.
  const first = rail.locator('a[data-device]').first();
  await expect(first).toHaveAttribute('href', /\/devices\/groups\?device=[0-9a-f-]{36}/);
  await expect(first).toContainText(/Online|Offline/);
  await expect(page.getByTestId('groups-kpis')).toContainText('Groups');
  await expect(page.getByTestId('groups-kpis')).toContainText('Waiting to join');
});

test('the create form guards the ban risk: a name, valid numbers (at most 20) and the ticked risk box are needed', async ({
  page,
}) => {
  const view = await openGroups(page);
  test.skip(view !== 'ready', 'needs a linked personal number');
  const open = page.getByTestId('groups-create-open');
  test.skip(!(await open.isVisible()), 'the role cannot create groups');
  await open.click();
  const form = page.getByTestId('groups-create');
  await expect(form.getByTestId('groups-create-risk')).toContainText(
    'WhatsApp can restrict this number',
  );
  const submit = form.getByRole('button', { name: 'Create group' });
  await expect(submit).toBeDisabled();

  await form.getByLabel('Group name').fill('E2E guard check');
  await form.getByLabel('People to add').fill('+919876543210');
  await expect(submit).toBeDisabled(); // the risk box is still open

  // The full notice is one click away.
  await form.getByText('Read the full risk notice').click();
  await expect(form.getByTestId('risk-notice')).toBeVisible();

  await form.getByRole('checkbox').last().check();
  await expect(submit).toBeEnabled();

  // Something that is not a phone number is named and blocks the send.
  await form.getByLabel('People to add').fill('+919876543210\nnot-a-number');
  await expect(form.getByTestId('groups-numbers-invalid')).toContainText('not-a-number');
  await expect(submit).toBeDisabled();

  // More than 20 numbers in one call is refused before it is sent.
  const many = Array.from({ length: 21 }, (_, i) => `+9198765${String(10000 + i)}`).join('\n');
  await form.getByLabel('People to add').fill(many);
  await expect(form.getByTestId('groups-numbers-over')).toBeVisible();
  await expect(submit).toBeDisabled();

  // Nothing is sent: leave the form.
  await form.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('groups-create')).toHaveCount(0);
});

test('a row shows its badges, and the members window opens for a manager', async ({ page }) => {
  const view = await openGroups(page);
  test.skip(view !== 'ready', 'needs a linked personal number');
  const row = page.locator('[data-group-row]').first();
  test.skip((await row.count()) === 0, 'this number is in no group yet');
  await expect(row.getByTestId('groups-badges')).toBeVisible();
  await expect(row.getByTestId('groups-subject')).not.toBeEmpty();
  const members = row.getByRole('button', { name: 'Members' });
  test.skip(!(await members.isVisible()), 'the role cannot manage groups');
  await members.click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: /Members of/ })).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('Search members')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('a group the number is not an admin of is read-only with the reason on the row', async ({
  page,
}) => {
  const view = await openGroups(page);
  test.skip(view !== 'ready', 'needs a linked personal number');
  const row = page.locator('[data-group-row]:has([data-badge="notAdmin"])').first();
  test.skip((await row.count()) === 0, 'the number is an admin of every group it is in');
  const edit = row.getByRole('button', { name: 'Edit' });
  if (await edit.isVisible()) await expect(edit).toBeDisabled();
  await expect(row.getByTestId('groups-blocked-note')).toBeVisible();
});

test('"Open chat" on a group with a conversation opens that conversation in the inbox', async ({
  page,
}) => {
  const view = await openGroups(page);
  test.skip(view !== 'ready', 'needs a linked personal number');
  const link = page.getByTestId('groups-open-chat').first();
  test.skip((await link.count()) === 0, 'no group has an inbox conversation yet');
  await link.click();
  await expect(page).toHaveURL(/\/inbox\?c=[0-9a-f-]{36}/);
  // A personal-number group thread offers the way back to the Groups tab.
  await expect(page.getByTestId('inbox-open-group')).toBeVisible({ timeout: 20_000 });
});
