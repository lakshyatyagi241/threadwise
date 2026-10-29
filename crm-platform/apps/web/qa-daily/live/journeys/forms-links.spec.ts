import type { APIRequestContext } from '@playwright/test';
import { test, expect, qaName } from '../qa';

const removeById = (api: APIRequestContext, path: string) => async () => {
  await api.delete(path);
};

test.describe('whatsapp forms', () => {
  test('[wa-forms] create a form, rename it, add a field, save the draft and find it after reload', async ({
    app,
    api,
    cleanup,
  }) => {
    const title = qaName('wa form');
    await app.goto('/wa-forms');
    await expect(app.getByRole('heading', { name: 'WhatsApp Forms' })).toBeVisible();
    await app.getByRole('button', { name: 'New form' }).click();
    await app.waitForURL(/\/wa-forms\/[0-9a-f-]{36}$/);
    const id = app.url().split('/').pop()!;
    cleanup(removeById(api, `/api/v2/wa-forms/${id}`));

    await app.getByLabel('Title', { exact: true }).fill(title);
    await app.getByRole('button', { name: '+ Email' }).click();
    await app.getByRole('button', { name: 'Save draft' }).click();
    await expect(app.getByText('Saved.')).toBeVisible();

    await app.reload();
    await expect(app.getByRole('heading', { name: title })).toBeVisible();
    await expect(app.getByLabel('Field type').nth(1)).toHaveValue('email');
  });

  test('[wa-forms] testing a form without usable WhatsApp credentials explains what to do, never publishes', async ({
    app,
    api,
    cleanup,
  }) => {
    await app.goto('/wa-forms');
    await app.getByRole('button', { name: 'New form' }).click();
    await app.waitForURL(/\/wa-forms\/[0-9a-f-]{36}$/);
    const id = app.url().split('/').pop()!;
    cleanup(removeById(api, `/api/v2/wa-forms/${id}`));
    await app.getByLabel('Title', { exact: true }).fill(qaName('wa form preview'));
    await app.getByRole('button', { name: 'Test form' }).click();
    // Either Meta's preview is ready, or the screen says in words why not: never a raw code or a blank page.
    const notice = app
      .getByRole('alert')
      .or(
        app.getByText(
          /Nothing is published|Connect a WhatsApp Cloud API number|usable credentials|Meta/i,
        ),
      )
      .first();
    await expect(notice).toBeVisible();
    await expect(app.getByText(/WFL_|undefined|\[object Object\]/)).toHaveCount(0);
    await expect(app.getByText('Published', { exact: true })).toHaveCount(0);
  });

  test('[wa-forms] a form can be found by search and deleted from the list', async ({
    app,
    api,
    cleanup,
  }) => {
    const title = qaName('wa form del');
    const res = await api.post('/api/v2/wa-forms', {
      data: {
        title,
        audienceType: 'lead_capture',
        submissionCap: 0,
        sendButtonLabel: 'Send',
        definition: {
          screens: [
            {
              id: 'A',
              fields: [{ id: 'name', kind: 'short_text', label: 'Full name', required: true }],
            },
          ],
        },
      },
    });
    expect(res.ok(), 'seed a form through the API').toBe(true);
    const id = ((await res.json()) as { id: string }).id;
    cleanup(removeById(api, `/api/v2/wa-forms/${id}`));

    await app.goto('/wa-forms');
    await app.getByTestId('wa-forms-search').fill(title);
    const row = app.getByRole('row', { name: new RegExp(title) });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Delete' }).click();
    await app.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await app.reload();
    await app.getByTestId('wa-forms-search').fill(title);
    await expect(app.getByText(title)).toHaveCount(0);
  });
});

test.describe('whatsapp links', () => {
  test('[wa-links] mint a link, see it in the list, then delete it', async ({
    app,
    api,
    cleanup,
  }) => {
    const name = qaName('link');
    cleanup(async () => {
      const res = await api.get('/api/v2/wa-links?limit=100');
      const body = (await res.json().catch(() => ({}))) as {
        data?: Array<{ id: string; name: string }>;
      };
      for (const l of body.data ?? [])
        if (l.name === name) await api.delete(`/api/v2/wa-links/${l.id}`);
    });
    await app.goto('/wa-links/new');
    await app.getByLabel('Name', { exact: true }).fill(name);
    await app.getByLabel('Phone number').fill('5550100');
    await app.getByRole('button', { name: 'Mint link' }).click();
    await expect(app.getByRole('heading', { name: 'Your link' })).toBeVisible();

    await app.goto('/wa-links');
    await app.getByPlaceholder('Search by name or link').fill(name);
    const row = app.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Delete' }).click();
    await app.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await app.reload();
    await app.getByPlaceholder('Search by name or link').fill(name);
    await expect(app.getByText(name)).toHaveCount(0);
  });

  test('[wa-links] minting without a name or phone number is refused with a plain message', async ({
    app,
  }) => {
    await app.goto('/wa-links/new');
    await app.getByRole('button', { name: 'Mint link' }).click();
    await expect(app.getByText('Check the destination and short link fields.')).toBeVisible();
    await expect(app.getByRole('heading', { name: 'Your link' })).toHaveCount(0);
  });
});

test.describe('web forms', () => {
  test('[web-forms] create a blank form, see its embed code, and delete it', async ({
    app,
    api,
    cleanup,
  }) => {
    const name = qaName('web form');
    await app.goto('/forms');
    await expect(app.getByRole('heading', { name: 'Forms', exact: true })).toBeVisible();
    await app.getByRole('button', { name: 'New form' }).first().click();
    const dialog = app.getByRole('dialog');
    await dialog
      .getByRole('radio', { name: 'Blank' })
      .or(dialog.getByRole('button', { name: 'Blank' }))
      .first()
      .click();
    await dialog.getByLabel('Form name').fill(name);
    await dialog.getByRole('button', { name: 'Create form' }).click();
    await app.waitForURL(/\/forms\/[0-9a-f-]{36}$/);
    const id = app.url().split('/').pop()!;
    cleanup(removeById(api, `/api/v2/forms/${id}`));

    await app.getByRole('tab', { name: 'Share' }).click();
    await expect(app.getByText('Script embed')).toBeVisible();
    await expect(app.getByText('Iframe embed')).toBeVisible();
    await expect(app.getByText(/<script|<iframe/).first()).toBeVisible();

    await app.goto('/forms');
    await app.getByRole('searchbox', { name: 'Search forms' }).fill(name);
    await expect(app.getByText(name)).toBeVisible();
  });

  test('[web-forms] creating a form without a name asks for one', async ({ app }) => {
    await app.goto('/forms');
    await app.getByRole('button', { name: 'New form' }).first().click();
    const dialog = app.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Create form' }).click();
    await expect(
      dialog
        .getByText('Enter a name for the form.')
        .or(dialog.getByText('Choose a template to continue.')),
    ).toBeVisible();
    await expect(app).toHaveURL(/\/forms$/);
  });
});

test.describe('groups', () => {
  test('[groups] contact groups page opens', async ({ app }) => {
    await app.goto('/contact-groups');
    await expect(app.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(app.getByText(/Application error|Something went wrong/)).toHaveCount(0);
  });
});
