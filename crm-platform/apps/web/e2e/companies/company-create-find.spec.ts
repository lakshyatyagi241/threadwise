import { expect, test, type Page } from '@playwright/test';

/**
 * Journey J-004 (P1): a company is created from the Companies screen and found again by search, whatever script its name is written in
 * (plain emoji text, Arabic, Hebrew, Chinese/Japanese). Signs in as the seeded local workspace admin
 * (`pnpm --filter @crm/api seed:auth`) and removes every company it created (named with this run's id), so it is safe on the shared dev
 * database.
 */
const ORG = process.env.E2E_ORG ?? 'Admin';
const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'nachiket.challawar@geta.ai',
  password: process.env.E2E_PASSWORD ?? 'Passw0rd!',
};
const RUN = `e2e${Date.now().toString(36)}`;
const NAMES = {
  'emoji-plain': `Acme ${RUN} 🚀 Ltd`,
  arabic: `شركة ${RUN} المحدودة`,
  hebrew: `חברת ${RUN} בע״מ`,
  cjk: `株式会社 ${RUN} 公司`,
} as const;

async function signIn(page: Page) {
  const res = await page.request.post('/api/auth/login', {
    data: { orgSlug: ORG, email: ADMIN.email, password: ADMIN.password },
  });
  expect(res.ok(), 'sign in as the workspace admin').toBe(true);
}

test.describe.configure({ mode: 'serial' });

test.afterAll(async ({ browser }) => {
  // Anything this run left behind (a failed test stops the serial run early): companies carrying the run id.
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await signIn(page);
    const list = await page.request.get(`/api/v2/companies?search=${RUN}&limit=50`);
    const body = (await list.json()) as { data?: Array<{ id: string; name: string }> };
    for (const c of (body.data ?? []).filter((x) => x.name.includes(RUN))) {
      await page.request.delete(`/api/v2/companies/${c.id}`);
    }
  } finally {
    await context.close();
  }
});

for (const [script, name] of Object.entries(NAMES)) {
  test(`a company named in ${script} is created and found by search`, async ({ page }) => {
    await signIn(page);
    await page.goto('/companies');
    await page
      .getByRole('button', { name: 'Decline' })
      .click({ timeout: 3000 })
      .catch(() => undefined);

    await page.getByRole('button', { name: 'New company' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#company-name').fill(name);
    await dialog.getByRole('button', { name: 'Create' }).click();
    // creating a company opens its page: wait for it (the name may be mixed-direction text, so match the run id)
    await expect(page).toHaveURL(/\/companies\/[^/]+$/);
    await expect(page.getByRole('heading', { name: new RegExp(RUN) })).toBeVisible();

    await page.goto('/companies');
    await page
      .getByRole('button', { name: 'Decline' })
      .click({ timeout: 3000 })
      .catch(() => undefined);
    await page.getByPlaceholder('Search companies…').fill(name);
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  });
}
