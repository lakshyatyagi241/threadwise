import { randomUUID } from 'node:crypto';
import { test, expect, qaName, QA_PREFIX } from '../qa';

/** True once React has attached to the screen: before that, a click on the server-rendered HTML does nothing. */
export async function hydrated(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('main') ?? document.body;
    return Object.keys(el.firstElementChild ?? el).some((k) => k.startsWith('__react'));
  });
}

test('[developer-api] create an API key in the UI, call the public API with it, then revoke it', async ({
  app,
  api,
  cleanup,
}) => {
  const list = await api.get('/api/v2/developer/keys?limit=100');
  expect(list.ok(), 'list keys').toBe(true);
  const { data } = (await list.json()) as {
    data: Array<{ id: string; name: string; status: string }>;
  };
  const active = data.filter((k) => k.status === 'active');
  // One key per workspace: never touch a key somebody else made.
  test.skip(
    active.some((k) => !k.name.startsWith(QA_PREFIX)),
    'the workspace holds a real API key',
  );
  for (const k of active)
    await api.delete(`/api/v2/developer/keys/${k.id}`, {
      headers: { 'Idempotency-Key': randomUUID() },
    });

  const name = qaName('api key');
  await app.goto('/developers');
  await hydrated(app);
  await app.getByLabel('Key name').fill(name);
  await app.getByRole('button', { name: 'Create key' }).click();
  await expect(app.getByRole('heading', { name: 'Your new API key' })).toBeVisible();
  const secret = (await app.getByTestId('api-key-secret').textContent()) ?? '';
  expect(secret).toMatch(/^wsk_/);
  cleanup(async () => {
    const r = await api.get('/api/v2/developer/keys?limit=100');
    const keys = ((await r.json()) as { data: Array<{ id: string; name: string; status: string }> })
      .data;
    for (const k of keys.filter((x) => x.status === 'active' && x.name === name))
      await api.delete(`/api/v2/developer/keys/${k.id}`, {
        headers: { 'Idempotency-Key': randomUUID() },
      });
  });

  // The key authenticates a public API call; a wrong key does not.
  const ok = await app.context().browser()!.newContext({ baseURL: app.url() });
  try {
    const good = await ok.request.get('/api/v1/contacts?limit=1', {
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(good.status(), 'call with the new key').toBe(200);
    const bad = await ok.request.get('/api/v1/contacts?limit=1', {
      headers: { Authorization: 'Bearer wsk_invalid' },
    });
    expect(bad.status()).toBe(401);
  } finally {
    await ok.close();
  }

  await app.reload();
  await expect(app.getByRole('heading', { name: 'Your API key' })).toBeVisible();
  await expect(app.getByText(name)).toBeVisible();
  await app.getByRole('button', { name: 'Revoke', exact: true }).click();
  await app
    .getByRole('dialog', { name: 'Revoke this key?' })
    .getByRole('button', { name: 'Revoke' })
    .click();
  await expect(app.getByRole('heading', { name: 'Create your key' })).toBeVisible();

  const ctx = await app.context().browser()!.newContext({ baseURL: app.url() });
  try {
    const after = await ctx.request.get('/api/v1/contacts?limit=1', {
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(after.status(), 'a revoked key stops working').toBe(401);
  } finally {
    await ctx.close();
  }
});

test('[developer-api] add an outbound webhook to a URL that never receives events, see it after reload, delete it', async ({
  app,
  api,
  cleanup,
}) => {
  const name = qaName('webhook');
  await app.goto('/webhooks');
  await hydrated(app);
  await expect(app.getByRole('heading', { name: 'Webhooks', level: 1 })).toBeVisible();
  await app.getByRole('button', { name: 'Add webhook' }).first().click();
  const dialog = app.getByRole('dialog', { name: 'Add a webhook' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Endpoint URL').fill('https://example.com/qa-auto-webhook');
  // Inactive: nothing is ever delivered to the endpoint. (The API refuses unresolvable hosts such as example.invalid.)
  await dialog.getByRole('switch', { name: 'Active' }).click();
  await dialog.getByRole('button', { name: 'Add webhook' }).click();
  const row = app
    .getByRole('list', { name: 'Webhooks' })
    .getByRole('listitem')
    .filter({ hasText: name });
  cleanup(async () => {
    const r = await api.get('/api/v2/webhooks');
    if (!r.ok()) return;
    const body = (await r.json()) as { data?: Array<{ id: string; name: string | null }> };
    for (const w of body.data ?? [])
      if (w.name === name) await api.delete(`/api/v2/webhooks/${w.id}`);
  });
  await expect(row).toBeVisible();

  await app.reload();
  await expect(row).toBeVisible();
  await expect(row).toContainText('example.com');

  await row.getByRole('button', { name: 'Delete' }).click();
  await app
    .getByRole('dialog', { name: 'Delete this webhook?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(row).toHaveCount(0);
  await app.reload();
  await expect(app.getByText(name)).toHaveCount(0);
});
