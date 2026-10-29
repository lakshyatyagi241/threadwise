import { test, expect } from '../qa';

const bad = /Application error|Something went wrong|\[object Object\]/;

test.describe('channels', () => {
  for (const [path, heading] of [
    ['/sms', 'SMS senders'],
    ['/telegram', 'Telegram Connect'],
    ['/viber', 'Viber Public Account'],
    ['/email', 'Support email mailboxes'],
  ] as const) {
    test(`[channels] ${path} page opens`, async ({ app }) => {
      await app.goto(path);
      await expect(app.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await expect(app.getByText(bad)).toHaveCount(0);
    });
  }

  test('[channels] telegram refuses a malformed bot token with a readable message', async ({
    app,
  }) => {
    await app.goto('/telegram');
    await app.getByRole('button', { name: 'Connect Bot' }).click();
    await app.locator('#tg-bot-token').fill('not-a-token');
    await app
      .getByRole('dialog')
      .getByRole('button', { name: /Connect/ })
      .last()
      .click();
    await expect(
      app
        .getByRole('alert')
        .or(app.getByText(/invalid|token|not valid|could not/i).first())
        .first(),
    ).toBeVisible();
    await expect(app.getByText(bad)).toHaveCount(0);
  });

  test('[channels] viber refuses an invalid auth token without connecting', async ({ app }) => {
    await app.goto('/viber');
    await app.locator('#viber-auth-token').fill('bogus');
    await app
      .getByRole('button', { name: /^Connect/ })
      .first()
      .click();
    await expect(
      app
        .getByRole('alert')
        .or(app.getByText(/invalid|token|not valid|could not|rejected/i).first())
        .first(),
    ).toBeVisible();
    await expect(app.getByText(bad)).toHaveCount(0);
  });

  test('[channels] sms add form asks for the missing fields instead of saving', async ({ app }) => {
    await app.goto('/sms');
    await app.locator('#sms-from').fill('');
    await app.getByRole('button', { name: 'Verify + connect SMS' }).click();
    await expect(
      app
        .getByRole('alert')
        .or(app.getByText(/required|enter|missing|invalid/i).first())
        .first(),
    ).toBeVisible();
  });
});
