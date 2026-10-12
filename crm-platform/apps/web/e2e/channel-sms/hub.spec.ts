import { expect, test, type Page } from '@playwright/test';

/**
 * TW-SMS-001, 002, 005, 008, 009 against the running stack: the `/sms` hub (delivery-report address, empty state, connect form
 * validation, number lookup guard) and the live segment counter in the campaign builder. It signs in as the seeded local workspace
 * admin and never submits real provider credentials, so no sender is created and a provider is never called; the checks that need a
 * connected sender (toggle, remove, SMS card in the broadcast chooser) are skipped when the workspace has none.
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

async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('main') ?? document.body;
    return Object.keys(el.firstElementChild ?? el).some((k) => k.startsWith('__react'));
  });
}

test.describe('SMS hub', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto('/sms');
    await hydrated(page);
  });

  test('shows the delivery-report address and no receive-path copy', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toContainText('SMS');
    await expect(page.getByText('Delivery report URL')).toBeVisible();
    await expect(page.locator('code', { hasText: '/sms/status' }).first()).toBeVisible();
    await expect(page.getByText(/inbound/i)).toHaveCount(0);
    await expect(page.getByText(/team inbox/i)).toHaveCount(0);
  });

  test('connect form: checks before the provider is asked', async ({ page }) => {
    const submit = page.getByRole('button', { name: 'Verify + connect SMS' });

    await submit.click();
    await expect(page.getByText('The from number field is required.').first()).toBeVisible();

    await page.getByLabel('From number / Sender ID').fill('+17372508034');
    await page.getByLabel('Twilio Account SID').fill('SKnotanaccountsid');
    await submit.click();
    await expect(page.getByText(/must start with AC/).first()).toBeVisible();

    await page.getByLabel('SMS provider').selectOption('msg91');
    await expect(page.getByLabel('Twilio Account SID')).toHaveCount(0);
    await submit.click();
    await expect(page.getByText('An MSG91 auth key is required.').first()).toBeVisible();
  });

  test('MSG91 / India (DLT) options open on MSG91 and carry the delivery-report box', async ({
    page,
  }) => {
    await page.getByLabel('SMS provider').selectOption('msg91');
    await expect(page.getByLabel('DLT Sender ID')).toBeVisible();
    await expect(page.getByLabel('DLT Template ID')).toBeVisible();
    await expect(page.getByText('MSG91 panel delivery reports')).toBeVisible();
  });

  test('number lookup: an empty field runs nothing', async ({ page }) => {
    let called = false;
    page.on('request', (r) => {
      if (r.url().includes('/sms/lookup')) called = true;
    });
    // The shell has its own status regions, so look only inside the lookup card.
    const card = page.locator('div', { has: page.locator('#sms-lookup') }).last();
    await page.getByRole('button', { name: 'Check number' }).click();
    await page.waitForTimeout(500);
    await expect(card.getByRole('status')).toHaveCount(0);
    expect(called).toBe(false);
  });

  test('setup guide has the three blocks', async ({ page }) => {
    for (const name of ['Twilio (global)', 'MSG91 (India / DLT)', 'Segments, cost and billing']) {
      await expect(page.locator('summary', { hasText: name })).toBeVisible();
    }
  });
});

test.describe('SMS in the campaign builder', () => {
  test('a connected SMS sender shows the segment counter and hides what a text cannot carry', async ({
    page,
  }) => {
    await signIn(page);
    const res = await page.request.get('/api/v2/sms/senders');
    const body = (await res.json()) as { data?: Array<{ senderKey: string; active: boolean }> };
    const sender = body.data?.find((s) => s.active);
    test.skip(!sender, 'no active SMS sender in this workspace');

    await page.goto(`/campaigns/create?sender=${encodeURIComponent(sender!.senderKey)}`);
    await hydrated(page);
    const cookieBar = page.getByTestId('cookie-bar');
    if (await cookieBar.isVisible().catch(() => false)) {
      await cookieBar.getByRole('button', { name: 'Decline' }).click();
    }
    await page.getByLabel('Campaign name').fill('E2E SMS');
    await page.getByRole('button', { name: 'Next', exact: true }).click();

    const body1 = page.locator('#camp-message');
    await body1.fill('a'.repeat(161));
    await expect(page.getByTestId('sms-segment-counter')).toContainText('2 segments');
    await body1.fill('Hello 😀');
    await expect(page.getByTestId('sms-segment-counter')).toContainText('UCS-2');
    await expect(page.locator('#camp-header')).toHaveCount(0);
    await expect(page.locator('#camp-footer')).toHaveCount(0);
    await expect(page.locator('#camp-attach-type')).toHaveCount(0);
  });
});
