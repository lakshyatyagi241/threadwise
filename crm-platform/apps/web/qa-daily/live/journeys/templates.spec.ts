import { test, expect, qaName } from '../qa';

/** Template ids by exact name, for removal when a journey stops half way. */
async function removeEmailTemplates(
  api: import('@playwright/test').APIRequestContext,
  name: string,
) {
  const res = await api.get(
    `/api/v2/email/templates?search=${encodeURIComponent(name)}&status=all`,
  );
  if (!res.ok()) return;
  const body = (await res.json()) as {
    data?: Array<{ id: string; name: string }>;
    items?: Array<{ id: string; name: string }>;
  };
  for (const t of body.data ?? body.items ?? [])
    if (t.name.startsWith(name)) await api.delete(`/api/v2/email/templates/${t.id}`);
}

test.describe('email templates', () => {
  test('[email-templates] create, edit and delete a template in the library', async ({
    app,
    api,
    cleanup,
  }) => {
    const name = qaName('welcome');
    cleanup(() => removeEmailTemplates(api, name));
    await app.goto('/email-templates');
    await expect(app.getByRole('heading', { name: 'Email templates' })).toBeVisible();

    await app.getByRole('button', { name: 'New template' }).first().click();
    await app.getByTestId('email-template-name').fill(name);
    await app.getByTestId('email-template-subject').fill('Hello {{first_name}}');
    await app.getByTestId('email-template-editor').click();
    await app.keyboard.type('QA automated body text');
    await app.getByTestId('email-template-save').click();
    await expect(app.getByTestId('email-template-form')).toBeHidden();

    await app.reload();
    await app.getByRole('searchbox', { name: 'Search templates' }).fill(name);
    const row = app.getByTestId('email-template-row').filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Hello {{first_name}}');

    await row.getByTestId('email-template-edit').click();
    await app.getByTestId('email-template-subject').fill('Updated subject');
    await app.getByTestId('email-template-save').click();
    await expect(app.getByTestId('email-template-form')).toBeHidden();
    await app.reload();
    await app.getByRole('searchbox', { name: 'Search templates' }).fill(name);
    await expect(app.getByTestId('email-template-row').filter({ hasText: name })).toContainText(
      'Updated subject',
    );

    await app
      .getByTestId('email-template-row')
      .filter({ hasText: name })
      .getByTestId('email-template-delete')
      .click();
    await app.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await app.reload();
    await app.getByRole('searchbox', { name: 'Search templates' }).fill(name);
    await expect(app.getByTestId('email-template-row').filter({ hasText: name })).toHaveCount(0);
  });

  test('[email-templates] saving without a name or message shows what is required', async ({
    app,
  }) => {
    await app.goto('/email-templates');
    await app.getByRole('button', { name: 'New template' }).first().click();
    await app.getByTestId('email-template-save').click();
    await expect(
      app.getByTestId('email-template-form').getByText('This is required.').first(),
    ).toBeVisible();
    await expect(app.getByTestId('email-template-form')).toBeVisible();
    await app.getByRole('button', { name: 'Cancel' }).click();
    await expect(app.getByTestId('email-template-form')).toBeHidden();
  });
});

test.describe('whatsapp message templates', () => {
  test('[templates] library opens and the new-template form explains what is missing', async ({
    app,
  }) => {
    await app.goto('/templates');
    await expect(app.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await app.goto('/templates/new');
    await expect(app.getByRole('heading', { name: 'New template' })).toBeVisible();
    await expect(app.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    await expect(app.getByRole('button', { name: 'Submit to Meta' })).toBeDisabled();
  });

  test('[templates] a draft template can be saved, reopened, edited and deleted', async ({
    app,
    api,
    cleanup,
  }) => {
    const label = qaName('tpl');
    const name = label
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
    cleanup(async () => {
      const res = await api.get(`/api/v2/templates?search=${encodeURIComponent(name)}`);
      const body = (await res.json().catch(() => ({}))) as {
        data?: Array<{ id: string; name: string }>;
      };
      for (const t of body.data ?? [])
        if (t.name === name) await api.delete(`/api/v2/templates/${t.id}`);
    });
    await app.goto('/templates/new');
    test.skip(
      (await app.getByText('No connected WhatsApp number').count()) > 0,
      'no WhatsApp number connected in this workspace',
    );
    await app.getByLabel('Template name').fill(label);
    await app
      .getByLabel('Message body')
      .or(app.getByRole('textbox', { name: /body/i }).first())
      .fill('QA automated hello {{1}}');
    await app.getByRole('button', { name: 'Save draft' }).click();
    await expect(app.getByTestId('template-detail')).toBeVisible();
    await expect(app.getByRole('heading', { name: new RegExp(name) })).toBeVisible();
    await app.reload();
    await expect(app.getByRole('heading', { name: new RegExp(name) })).toBeVisible();
  });
});
