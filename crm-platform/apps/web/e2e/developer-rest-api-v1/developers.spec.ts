import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * The Developers console (/developers) against the running stack (web :3001, API :3000). Signs in as a local workspace admin
 * given by DEVAPI_E2E_EMAIL and DEVAPI_E2E_PASSWORD whose plan includes `public_api` (a development account only); without them the
 * file is skipped. The workspace's own keys are revoked at the start so the run begins with "No key yet", and the key the run
 * creates is revoked at the end. The one-key rule is the plan's `api_keys` cap: a plan with a larger cap still shows the live key.
 */
const EMAIL = process.env.DEVAPI_E2E_EMAIL;
const PASSWORD = process.env.DEVAPI_E2E_PASSWORD;
test.skip(!EMAIL || !PASSWORD, 'DEVAPI_E2E_EMAIL and DEVAPI_E2E_PASSWORD are not set');

const NAME = `E2E key ${Date.now().toString().slice(-6)}`;

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(dashboard|inbox|onboarding)/);
}

async function revokeAll(request: APIRequestContext) {
  const res = await request.get('/api/v2/developer/keys?limit=100');
  expect(res.ok(), `list keys -> ${res.status()}`).toBe(true);
  const { data } = (await res.json()) as { data: Array<{ id: string; status: string }> };
  for (const k of data.filter((x) => x.status === 'active')) {
    const r = await request.delete(`/api/v2/developer/keys/${k.id}`, {
      headers: { 'Idempotency-Key': randomUUID() },
    });
    expect(r.ok(), `revoke ${k.id} -> ${r.status()}`).toBe(true);
  }
}

test.describe.configure({ mode: 'serial' });

test.describe('Developers console', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signIn(page);
    await revokeAll(page.request);
    await ctx.close();
  });

  test('empty state, validation, create, one-time banner, reload, revoke', async ({ page }) => {
    await revokeAll(page.request);
    await page.goto('/developers');

    // Empty state: the create form and the "No key yet" pill; the rail and quickstart are there.
    await expect(page.getByRole('heading', { name: 'Create your key' })).toBeVisible();
    await expect(page.getByText('No key yet')).toBeVisible();
    await expect(page.getByText('Authorization: Bearer <key>')).toBeVisible();
    await expect(page.getByTestId('quickstart-curl')).toContainText('Bearer YOUR_API_KEY');
    await expect(page.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/settings');

    // Validation: empty and 121 characters never reach the API.
    const name = page.getByLabel('Key name');
    await page.getByRole('button', { name: 'Create key' }).click();
    await expect(page.getByText('Enter a name for the key.')).toBeVisible();
    await expect(name).toHaveAttribute('maxlength', '120');
    await name.evaluate((el: HTMLInputElement) => {
      el.removeAttribute('maxlength');
    });
    await name.fill('x'.repeat(121));
    await page.getByRole('button', { name: 'Create key' }).click();
    await expect(page.getByText('The name can be at most 120 characters.')).toBeVisible();

    // Create: double click makes one key; the banner holds the raw key and the quickstart uses it.
    await name.fill(NAME);
    await page.getByRole('button', { name: 'Create key' }).dblclick();
    const banner = page.getByRole('heading', { name: 'Your new API key' });
    await expect(banner).toBeVisible();
    const secret = (await page.getByTestId('api-key-secret').textContent()) ?? '';
    expect(secret).toMatch(/^wsk_/);
    await expect(page.getByTestId('quickstart-curl')).toContainText(`Bearer ${secret}`);
    await expect(page.getByText('API key created. Copy it now')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your API key' })).toBeVisible();
    await expect(page.getByText(NAME)).toBeVisible();
    await expect(page.getByText('Key active')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create your key' })).toHaveCount(0);

    // The secret is not in storage or the URL.
    const leaked = await page.evaluate((s) => {
      const all = [...Object.values(localStorage), ...Object.values(sessionStorage), location.href];
      return all.some((v) => String(v).includes(s));
    }, secret);
    expect(leaked).toBe(false);

    // Reload: the banner and the secret are gone for good; the key card stays with its prefix.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Your API key' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your new API key' })).toHaveCount(0);
    await expect(page.getByText(secret)).toHaveCount(0);
    await expect(page.getByText(`${secret.slice(0, 12)}…`)).toBeVisible();
    await expect(page.getByText('Last used never')).toBeVisible();

    // Revoke: cancel changes nothing, confirm brings the form back.
    await page.getByRole('button', { name: 'Revoke', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Revoke this key?' });
    await expect(dialog).toContainText('This cannot be undone');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Your API key' })).toBeVisible();
    await page.getByRole('button', { name: 'Revoke', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Revoke this key?' })
      .getByRole('button', { name: 'Revoke' })
      .click();
    await expect(page.getByRole('heading', { name: 'Create your key' })).toBeVisible();
    await expect(page.getByText('No key yet')).toBeVisible();
    await expect(page.getByText('API key revoked.')).toBeVisible();
  });

  test('a second create is refused with the plan-limit sentence when the cap is one', async ({
    page,
  }) => {
    await revokeAll(page.request);
    await page.goto('/developers');
    await page.getByLabel('Key name').fill(NAME);
    await page.getByRole('button', { name: 'Create key' }).click();
    await expect(page.getByRole('heading', { name: 'Your new API key' })).toBeVisible();

    // A stale tab still shows the form; the API refuses and the page shows the server's sentence in the red notice.
    const res = await page.request.post('/api/v2/developer/keys', {
      data: { name: `${NAME} again` },
      headers: { 'Idempotency-Key': randomUUID() },
    });
    test.skip(res.ok(), 'this plan allows more than one key; the cap is the plan decision');
    expect(res.status()).toBe(422);
    const problem = (await res.json()) as { code: string; detail: string };
    expect(problem.code).toBe('PLAN_LIMIT_REACHED');
    expect(problem.detail).toContain('You already have an active API key');
  });

  test('a key made without restricting it is marked Full access in the list', async ({ page }) => {
    await revokeAll(page.request);
    await page.goto('/developers');

    // Off by default, and no scope picker until it is turned on.
    await expect(page.getByRole('switch', { name: 'Restrict this key' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(page.getByText('Allowed scopes')).toHaveCount(0);

    await page.getByLabel('Key name').fill(NAME);
    await page.getByRole('button', { name: 'Create key' }).click();
    await expect(page.getByRole('heading', { name: 'Your new API key' })).toBeVisible();
    const access = page.getByTestId('key-access');
    await expect(access).toContainText('Full access');
    await expect(access).not.toContainText('Restricted');

    const res = await page.request.get('/api/v2/developer/keys?limit=100');
    const { data } = (await res.json()) as { data: Array<{ scopes: string[] }> };
    expect(data[0]?.scopes).toEqual([]);
  });

  test('Restrict this key: nothing ticked is refused, a write scope includes its read, the card shows the scopes', async ({
    page,
  }) => {
    await revokeAll(page.request);
    await page.goto('/developers');
    await page.getByLabel('Key name').fill(NAME);

    const restrict = page.getByRole('switch', { name: 'Restrict this key' });
    await restrict.click();
    await expect(restrict).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Allowed scopes')).toBeVisible();

    // On with nothing ticked is refused in the form: no key is made, least of all a full-access one.
    await page.getByRole('button', { name: 'Create key' }).click();
    await expect(
      page.getByText('Tick at least one scope, or turn off Restrict this key.'),
    ).toBeVisible();
    const none = await page.request.get('/api/v2/developer/keys?limit=100');
    expect(((await none.json()) as { data: unknown[] }).data).toHaveLength(0);

    // A ticked write scope shows its read as included and locked; ticking something clears the message.
    const contactsWrite = page.getByLabel('contacts:write', { exact: true });
    const contactsRead = page.getByLabel('contacts:read', { exact: true });
    await contactsWrite.check();
    await expect(page.getByText('Tick at least one scope')).toHaveCount(0);
    await expect(contactsRead).toBeChecked();
    await expect(contactsRead).toBeDisabled();
    await page.getByLabel('messages:read', { exact: true }).check();

    await page.getByRole('button', { name: 'Create key' }).click();
    await expect(page.getByRole('heading', { name: 'Your new API key' })).toBeVisible();
    const access = page.getByTestId('key-access');
    await expect(access).toContainText('Restricted');
    await expect(access).toContainText('contacts:write');
    await expect(access).toContainText('messages:read');
    await expect(access).not.toContainText('Full access');

    // What the card shows is what the server stored, once each and without the implied read.
    const res = await page.request.get('/api/v2/developer/keys?limit=100');
    const { data } = (await res.json()) as { data: Array<{ scopes: string[] }> };
    expect(data[0]?.scopes).toEqual(['contacts:write', 'messages:read']);
  });

  test('copy button confirms and the docs link points at /developers/docs', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await revokeAll(page.request);
    await page.goto('/developers');
    await page.getByRole('button', { name: 'Copy', exact: true }).first().click();
    await expect(page.getByRole('status').filter({ hasText: 'Copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/api\/v1$/);
    await expect(page.getByRole('link', { name: 'Open docs' })).toHaveAttribute(
      'href',
      '/developers/docs',
    );
  });
});
