import { test, expect } from '../qa';

test('[billing] plans page shows the current plan and the plans on offer', async ({ app }) => {
  await app.goto('/account/plans');
  await expect(app.getByRole('heading', { name: 'Plans', level: 1 })).toBeVisible();
  await expect(app.getByRole('region', { name: 'Usage and limits' })).toBeVisible();
  await app.reload();
  await expect(app.getByRole('region', { name: 'Usage and limits' })).toBeVisible();
  await expect(app.getByText('Current plan').first()).toBeVisible();
});

test('[billing] wallet shows the balance and the add-money form validates without charging', async ({
  app,
}) => {
  await app.goto('/billing/wallet');
  await expect(app.getByRole('heading', { name: 'Wallet', level: 1 })).toBeVisible();
  await expect(app.getByText('Balance', { exact: true }).first()).toBeVisible();
  await expect(app.getByText('Recent activity').first()).toBeVisible();
  // Invalid amount is refused client-side; nothing is submitted, no payment starts.
  const amount = app.getByLabel('Amount');
  await amount.fill('0');
  await app.getByRole('button', { name: 'Add money' }).click();
  await expect(app.getByText('Enter a whole amount of 1 or more.')).toBeVisible();
  await expect(app).toHaveURL(/\/billing\/wallet/);
});

test('[billing] wallet statement lists transactions and its filters narrow and reset', async ({
  app,
}) => {
  await app.goto('/billing/wallet/statement');
  await expect(app.getByRole('heading', { name: 'Wallet statement', level: 1 })).toBeVisible();
  await expect(app.getByText('Current balance')).toBeVisible();
  await app.getByLabel('Search').fill('qa-auto-no-such-transaction');
  await app.getByRole('button', { name: 'Apply' }).click();
  await expect(app.getByText('Nothing matches these filters. Change or reset them.')).toBeVisible();
  await app.getByRole('button', { name: 'Reset' }).click();
  await expect(app.getByText('Nothing matches these filters. Change or reset them.')).toHaveCount(
    0,
  );
  await expect(app.getByText('Current balance')).toBeVisible();
});

test('[billing] wallet link opens the full statement and back returns to the wallet', async ({
  app,
}) => {
  await app.goto('/billing/wallet');
  await app
    .getByRole('link', { name: /full statement/i })
    .first()
    .click();
  await expect(app).toHaveURL(/\/billing\/wallet\/statement/);
  await app.getByRole('link', { name: 'Back to wallet' }).click();
  await expect(app).toHaveURL(/\/billing\/wallet$/);
});

test('[billing] affiliate and coupons pages render for the workspace', async ({ app }) => {
  await app.goto('/account/affiliate');
  await expect(app.getByRole('heading', { level: 1 })).toBeVisible();
  await app.goto('/store/coupons');
  await expect(app.getByRole('heading', { level: 1 })).toBeVisible();
});
