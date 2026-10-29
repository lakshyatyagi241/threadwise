import { test, expect, qaName } from '../qa';

test.describe('campaigns', () => {
  test('[campaigns] the campaigns list opens with search and a create button', async ({ app }) => {
    await app.goto('/campaigns');
    await expect(app.getByRole('heading', { name: 'WhatsApp campaigns', level: 1 })).toBeVisible();
    await expect(app.getByPlaceholder('Search campaigns…')).toBeVisible();
    await expect(
      app.getByRole('link', { name: /Create campaign|New WA campaign/ }).first(),
    ).toBeVisible();
  });

  test('[campaigns] searching for a campaign that does not exist shows an empty state', async ({
    app,
  }) => {
    await app.goto('/campaigns');
    await app.getByPlaceholder('Search campaigns…').fill(qaName('nothing-here'));
    await expect(app.getByText(/No data found|No campaigns|nothing/i).first()).toBeVisible();
  });

  test('[campaigns] the create screen opens, takes a name and does not send anything', async ({
    app,
  }) => {
    await app.goto('/campaigns/create');
    await expect(app.getByRole('heading', { name: 'Create new WhatsApp campaign' })).toBeVisible();
    await app.locator('#camp-name').fill(qaName('draft'));
    await expect(app.locator('#camp-name')).toHaveValue(/QA-AUTO/);
    await expect(app.getByRole('button', { name: /^(Send now|Launch)/ })).toHaveCount(0);
  });

  test('[campaigns] scheduled, recurring and history tabs open', async ({ app }) => {
    for (const p of ['/campaigns/scheduled', '/campaigns/recurring', '/campaigns/history']) {
      await app.goto(p);
      await expect(app.getByRole('heading').first()).toBeVisible();
      await expect(app.getByText(/Application error|Something went wrong/)).toHaveCount(0);
    }
  });
});
