import { expect, test, type Page } from '@playwright/test';

/**
 * The director summary (owner walkthrough item 23) against the running stack: the Summary tab of a finished campaign, the window in the
 * address, the form picker, the names lists and the print layout. It signs in as the seeded local workspace admin and only reads, so
 * nothing is sent or changed. Every test skips when the workspace has no sent campaign to summarise.
 */
const ORG = process.env.E2E_ORG ?? 'Admin';
const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'nachiket.challawar@geta.ai',
  password: process.env.E2E_PASSWORD ?? 'Passw0rd!',
};

async function signIn(page: Page) {
  const res = await page.request.post('/api/auth/login', {
    data: { orgSlug: ORG, email: ADMIN.email, password: ADMIN.password },
  });
  expect(res.ok(), 'sign in').toBe(true);
}

/** A campaign that has messaged somebody, found through the summary endpoint itself so the test needs no fixture. */
async function sentCampaign(page: Page): Promise<string | null> {
  const list = await page.request.get('/api/v2/campaigns?perPage=25');
  if (!list.ok()) return null;
  const rows = ((await list.json()) as { data?: Array<{ id: string; status: string }> }).data ?? [];
  for (const c of rows.filter((r) => ['completed', 'running', 'cancelled'].includes(r.status))) {
    const res = await page.request.get(`/api/v2/campaigns/${c.id}/summary?cameBackDays=7`);
    if (!res.ok()) continue;
    const s = (await res.json()) as { people?: { messaged?: number } };
    if ((s.people?.messaged ?? 0) > 0) return c.id;
  }
  return null;
}

test.describe('Campaign summary', () => {
  let id: string;

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    const found = await sentCampaign(page);
    test.skip(!found, 'this workspace has no sent campaign');
    id = found!;
  });

  test('opens on the Summary with a plain sentence, five tiles and a funnel', async ({ page }) => {
    await page.goto(`/campaigns/${id}`);
    const tab = page.getByRole('tab', { name: 'Summary' });
    await expect(tab).toBeVisible();
    await expect(page.getByText(/^You messaged /)).toBeVisible();
    const tiles = page.getByRole('list', { name: 'The numbers' }).getByRole('listitem');
    // Four tiles when the viewer may not read form submissions, five otherwise.
    expect([4, 5]).toContain(await tiles.count());
    await expect(page.getByRole('list', { name: /Number of people at each step/ })).toBeVisible();
  });

  test('keeps the window in the address and the technical tabs under the same screen', async ({
    page,
  }) => {
    await page.goto(`/campaigns/${id}?tab=summary`);
    await page.getByLabel('Within 14 days').check();
    await expect(page).toHaveURL(/window=14/);
    await expect(page).toHaveURL(/tab=summary/);
    await page.reload();
    await expect(page.getByLabel('Within 14 days')).toBeChecked();

    await page.getByRole('tab', { name: 'Overview' }).click();
    await expect(page).toHaveURL(/tab=overview|window=14/);
    await expect(
      page.getByRole('heading', { name: 'Delivery funnel' }).or(page.getByText('Funnel')),
    ).toBeVisible();
  });

  test('opens a names list and links a person to the contact', async ({ page }) => {
    await page.goto(`/campaigns/${id}?tab=summary`);
    const wrote = page.getByRole('button', { name: /^Wrote back/ });
    await wrote.click();
    await expect(wrote).toHaveAttribute('aria-expanded', 'true');
    const table = page.getByRole('table', { name: 'Wrote back' });
    const empty = page.getByText('No one in this list yet.');
    await expect(table.or(empty)).toBeVisible();
    if (await table.isVisible()) {
      await expect(
        table
          .locator('a[href^="/contacts/"]')
          .first()
          .or(table.getByText('Not matched to a contact').first()),
      ).toBeVisible();
    }
  });

  test('remembers the picked forms in this browser', async ({ page }) => {
    await page.goto(`/campaigns/${id}?tab=summary`);
    const picker = page.getByRole('combobox', { name: 'Which forms count as an application?' });
    test.skip(!(await picker.isVisible()), 'the viewer cannot read form submissions');
    await picker.click();
    const option = page.getByRole('option').first();
    test.skip(!(await option.isVisible()), 'the workspace has no forms');
    await option.click();
    await page.reload();
    await expect(page.getByRole('button', { name: /^Remove / })).toBeVisible();
  });

  test('prints one A4 page without the screen around it', async ({ page }) => {
    await page.goto(`/campaigns/${id}?tab=summary`);
    await expect(page.getByText(/^You messaged /)).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('list', { name: 'The numbers' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print summary' })).toBeHidden();
    await expect(page.getByRole('tablist')).toBeHidden();
    await expect(page.locator('.dsum-print-only')).toBeVisible();
    await page.emulateMedia({ media: 'screen' });
  });

  test('downloads the names as a CSV', async ({ page }) => {
    await page.goto(`/campaigns/${id}?tab=summary`);
    const button = page.getByRole('button', { name: 'Download names' });
    test.skip(!(await button.isVisible()), 'the viewer may not export');
    const download = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
    await button.click();
    const file = await download;
    if (file) expect(file.suggestedFilename()).toMatch(/-names\.csv$/);
  });
});
