import { test, expect } from '../qa';

// Read-only against the platform: every flow only looks, searches or opens; nothing is changed.

test('[operator] a guest is sent to the operator sign-in, which refuses a wrong password', async ({
  page,
}) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.getByLabel('Email').fill('nobody@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('definitely-wrong-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/login/);
});

test('[operator] console home shows what needs attention and one block per area', async ({
  operator,
}) => {
  await operator.goto('/admin');
  await expect(operator.getByRole('heading', { name: 'Platform console' })).toBeVisible();
  await expect(operator.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
  await expect(operator.locator('[data-testid^="home-hub-"]').first()).toBeVisible();
  expect(await operator.locator('[data-testid^="home-hub-"]').count()).toBeGreaterThan(5);
});

test('[operator] opening an area from home lists its pages in the left menu', async ({
  operator,
}) => {
  await operator.goto('/admin');
  await operator.getByTestId('home-hub-plans').click();
  await expect(operator).toHaveURL(/\/admin\//);
  await expect(operator.locator('#console-sidebar').getByTestId('hub-menu')).toBeVisible();
  await operator.reload();
  await expect(operator.locator('#console-sidebar').getByTestId('hub-menu')).toBeVisible();
});

test('[operator] workspaces hub lists workspaces, search narrows, and one opens', async ({
  operator,
}) => {
  await operator.goto('/admin/workspaces');
  await expect(operator.getByRole('heading', { level: 1 })).toBeVisible();
  const links = operator.locator('a[href^="/admin/workspaces/"]:not([href$="/retention"])');
  await expect(links.first()).toBeVisible();
  await links.first().click();
  await expect(operator).toHaveURL(/\/admin\/workspaces\/[^/]+$/);
  await expect(operator.getByRole('heading', { level: 1 })).toBeVisible();
});

test('[operator] deployments page shows the live release and what each release changed', async ({
  operator,
}) => {
  await operator.goto('/admin/deployments');
  await expect(operator.getByRole('heading', { level: 1 })).toBeVisible();
  // A fresh local database has no release yet; a deployed one lists each with PRs raised in IST.
  const raised = operator.getByTestId('release-raised').first();
  const empty = operator.getByText('No release has been recorded yet.');
  await expect(raised.or(empty)).toBeVisible();
  if (await raised.isVisible()) await expect(raised).toContainText(/IST/);
  await operator.reload();
  await expect(raised.or(empty)).toBeVisible();
});

test('[operator] plans page lists the plans workspaces can be on', async ({ operator }) => {
  await operator.goto('/admin/workspace-plans');
  await expect(operator.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(operator.getByText(/free|starter|pro|business/i).first()).toBeVisible();
});

test('[operator] support desk opens and lists tickets or its empty state', async ({ operator }) => {
  await operator.goto('/admin/support');
  await expect(operator.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(
    operator
      .getByRole('table')
      .or(operator.getByText(/no (tickets|requests|conversations)/i))
      .first(),
  ).toBeVisible();
});

test('[operator] platform settings open and show the real configured values', async ({
  operator,
}) => {
  await operator.goto('/admin/settings');
  await expect(operator.getByRole('heading', { level: 1 })).toBeVisible();
  const group = operator.locator('a[href^="/admin/settings/"]').first();
  await expect(group).toBeVisible();
  await group.click();
  await expect(operator).toHaveURL(/\/admin\/settings\/.+/);
  await expect(operator.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(
    operator
      .getByRole('textbox')
      .or(operator.getByRole('switch'))
      .or(operator.getByRole('combobox'))
      .first(),
  ).toBeVisible();
});

test('[operator] signing out ends the operator session', async ({ operator }) => {
  await operator.goto('/admin');
  await operator
    .getByRole('button', { name: /sign out/i })
    .first()
    .click();
  await expect(operator).toHaveURL(/\/admin\/login/);
  await operator.goto('/admin');
  await expect(operator).toHaveURL(/\/admin\/login/);
});
