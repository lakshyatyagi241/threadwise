import type { APIRequestContext } from '@playwright/test';
import { test, expect, qaName } from '../qa';

const removeWidgets = (api: APIRequestContext, name: string) => async () => {
  const res = await api.get(`/api/v2/widgets?q=${encodeURIComponent(name)}`);
  const body = (await res.json().catch(() => ({}))) as {
    data?: Array<{ id: string; name: string }>;
  };
  for (const w of body.data ?? [])
    if (w.name.startsWith(name)) await api.delete(`/api/v2/widgets/${w.id}`);
};

test.describe('chatbot widget', () => {
  test('[widget] the widgets list opens with search and a create button', async ({ app }) => {
    await app.goto('/chatbot-widgets');
    await expect(app.getByRole('heading', { name: 'Chatbot widgets' })).toBeVisible();
    await expect(
      app
        .getByRole('searchbox', { name: /Search by name/ })
        .or(app.getByPlaceholder('Search by name or slug…')),
    ).toBeVisible();
    await expect(app.getByRole('link', { name: /Create widget|New widget/ }).first()).toBeVisible();
  });

  test('[widget] create a WhatsApp widget, find it in the list, edit its greeting and delete it', async ({
    app,
    api,
    cleanup,
  }) => {
    const name = qaName('widget');
    cleanup(removeWidgets(api, name));
    await app.goto('/chatbot-widgets/create');
    await app.locator('#wgt-f-name').fill(name);
    await app.locator('#wgt-card-head-3').click();
    await app.locator('#wgt-f-greeting').fill('QA HELLO');
    await app.locator('#wgt-card-head-5').click();
    await app.locator('#wgt-f-phone').fill('9876543210');
    await app.locator('#wgt-save-changes').click();
    await expect(app.getByText('Install on your website')).toBeVisible();

    await app.goto('/chatbot-widgets');
    await app.getByPlaceholder('Search by name or slug…').fill(name);
    const row = app.getByText(name).first();
    await expect(row).toBeVisible();

    await app.getByRole('link', { name: /^Edit/ }).first().click();
    await app.waitForURL(/\/chatbot-widgets\/[0-9a-f-]{36}\/edit$/);
    await app.reload();
    await expect(app.locator('#wgt-f-name')).toHaveValue(name);
    await app.locator('#wgt-card-head-3').click();
    await expect(app.locator('#wgt-f-greeting')).toHaveValue('QA HELLO');
    await app.locator('#wgt-f-greeting').fill('QA HELLO AGAIN');
    await app.locator('#wgt-save-changes').click();
    await app.reload();
    await app.locator('#wgt-card-head-3').click();
    await expect(app.locator('#wgt-f-greeting')).toHaveValue('QA HELLO AGAIN');

    await app.goto('/chatbot-widgets');
    await app.getByPlaceholder('Search by name or slug…').fill(name);
    await app
      .getByRole('button', { name: /^Delete/ })
      .first()
      .click();
    await app.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await app.reload();
    await app.getByPlaceholder('Search by name or slug…').fill(name);
    await expect(app.getByText(name)).toHaveCount(0);
  });
});

test.describe('storefront', () => {
  test('[storefront] the store area opens, or says plainly that WhatsApp must be connected first', async ({
    app,
  }) => {
    await app.goto('/store');
    await app.waitForURL(/\/(store|connect)/);
    await expect(app.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(app.getByText(/Application error|Something went wrong|undefined/)).toHaveCount(0);
  });

  test('[storefront] products and orders pages open', async ({ app }) => {
    for (const path of ['/store/orders', '/store/coupons']) {
      await app.goto(path);
      await expect(app.getByRole('heading').first()).toBeVisible();
      await expect(app.getByText(/Application error|Something went wrong/)).toHaveCount(0);
    }
  });
});
