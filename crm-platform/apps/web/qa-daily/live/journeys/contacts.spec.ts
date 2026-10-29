import { expect, qaName, test } from '../qa';
import { open } from './helpers';

/** A unique 10-digit national number per run so the phone never collides with another contact. */
const phone = () => `9${String(Date.now()).slice(-9)}`;

test('[contacts] create a contact, find it by search, open it and see it again after a reload', async ({
  app,
  api,
  cleanup,
}) => {
  const first = qaName('contact');
  await open(app, '/contacts');
  await app.getByRole('button', { name: 'Add Contact' }).click();
  const dialog = app.getByRole('dialog', { name: /New contact/ });
  await dialog.getByLabel('First name *').fill(first);
  await dialog.getByLabel('Number').fill(phone());
  await dialog
    .getByRole('button', { name: /^(Create|Save)/ })
    .last()
    .click();
  await expect(dialog).toBeHidden();

  cleanup(async () => {
    const list = await api.get(`/api/v2/contacts?search=${encodeURIComponent(first)}&limit=20`);
    const body = (await list.json()) as { data?: Array<{ id: string; firstName?: string }> };
    for (const c of body.data ?? [])
      if (c.firstName === first) await api.delete(`/api/v2/contacts/${c.id}`);
  });

  await app.getByPlaceholder('Search contacts...').fill(first);
  await expect(app.getByText(first).first()).toBeVisible();
  await app.reload();
  await app.getByPlaceholder('Search contacts...').fill(first);
  await app.getByText(first).first().click();
  await expect(app.getByText(first).first()).toBeVisible();
});
