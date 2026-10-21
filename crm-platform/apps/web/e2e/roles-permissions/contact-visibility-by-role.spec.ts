import { expect, test, type Page } from '@playwright/test';

/**
 * Journey J-002 (P0): what a teammate sees depends on their role. The admin sees the seeded demo contacts in the Contact Hub; an agent
 * (the Agent preset reads only contacts it owns) searching for the same contact gets the empty state, not the row. Also the Roles
 * screen: the five preset roles are listed and the Owner role is locked. Signs in as the seeded local admin and agent
 * (`pnpm --filter @crm/api seed:auth`); creates and changes nothing, so it is safe on the shared dev database.
 */
const ORG = process.env.E2E_ORG ?? 'Admin';
const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'nachiket.challawar@geta.ai',
  password: process.env.E2E_PASSWORD ?? 'Passw0rd!',
};
const AGENT = {
  email: process.env.E2E_AGENT_EMAIL ?? 'agent@admin.test',
  password: ADMIN.password,
};
const CONTACT = process.env.E2E_CONTACT ?? 'Demo Contact 1';

async function signIn(page: Page, who: { email: string; password: string }) {
  const res = await page.request.post('/api/auth/login', {
    data: { orgSlug: ORG, email: who.email, password: who.password },
  });
  expect(res.ok(), `sign in as ${who.email}`).toBe(true);
}

async function searchContacts(page: Page, text: string) {
  await page.goto('/contacts');
  await page
    .getByRole('button', { name: 'Decline' })
    .click({ timeout: 3000 })
    .catch(() => undefined);
  await page.getByPlaceholder('Search contacts...').first().fill(text);
}

test.describe('roles and permissions: what each role sees', () => {
  test('the admin finds the contact in the Contact Hub', async ({ page }) => {
    await signIn(page, ADMIN);
    await searchContacts(page, CONTACT);
    await expect(page.getByRole('link', { name: CONTACT, exact: true })).toBeVisible();
  });

  test('an agent searching for the same contact gets the empty state, not the row', async ({
    page,
  }) => {
    await signIn(page, AGENT);
    await searchContacts(page, CONTACT);
    await expect(page.getByText('No data found')).toBeVisible();
    await expect(page.getByRole('link', { name: CONTACT, exact: true })).toHaveCount(0);
  });

  test('the Roles screen lists the preset roles and locks the Owner role', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/settings/roles');
    await expect(page.getByRole('heading', { name: 'Roles & permissions' })).toBeVisible();
    for (const role of ['Owner', 'Admin', 'Manager', 'Agent', 'Viewer']) {
      await expect(
        page.getByRole('row', { name: new RegExp(`^${role}\\b.*Preset`) }),
      ).toBeVisible();
    }
    await expect(page.getByRole('row', { name: /^Owner\b.*Locked/ })).toBeVisible();
  });
});
