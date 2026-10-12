import { expect, test, type Page } from '@playwright/test';

/**
 * TW-MAIL-019, 020, 023 against the running stack: the `/email` hub (Connect Gmail, the provider-not-ready state, the Soon provider
 * cards, the setup guide and the `?email=` outcome message). It signs in as the seeded local workspace admin and never completes
 * a Google sign-in, so no mailbox is created and Google is never called; checks that need a connected mailbox, or a workspace that
 * has the Email add-on, are skipped when the workspace does not have it.
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

type MailboxList = {
  data: Array<{ id: string; status: string; channelId: string | null }>;
  limit: number;
  used: number;
  providerReady: boolean;
};

/** The hub needs the add-on; without it the API answers 402/403 and the workspace has no Email screen. */
async function mailboxes(page: Page): Promise<MailboxList | null> {
  const res = await page.request.get('/api/v2/email/mailboxes');
  return res.ok() ? ((await res.json()) as MailboxList) : null;
}

test.describe('Email hub', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    test.skip(!(await mailboxes(page)), 'the Email add-on is not on this workspace');
    await page.goto('/email');
    await hydrated(page);
  });

  test('shows the hub with the Connect Gmail card and the usage meter', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Email');
    await expect(page.getByTestId('email-provider-google')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect Gmail' })).toBeVisible();
    await expect(page.getByTestId('email-usage')).toContainText(/mailbox/);
  });

  test('Connect Gmail is switched off, with who to ask, while Google is not set up', async ({
    page,
  }) => {
    const list = await mailboxes(page);
    test.skip(list?.providerReady !== false, 'Google credentials are set on this stack');
    await expect(page.getByRole('button', { name: 'Connect Gmail' })).toBeDisabled();
    await expect(page.getByTestId('email-not-ready')).toContainText('platform administrator');
  });

  test('Connect Gmail asks the API for the Google address (no real sign-in)', async ({ page }) => {
    const list = await mailboxes(page);
    test.skip(!list?.providerReady || list.used >= (list.limit || Infinity), 'cannot connect here');
    let asked = false;
    await page.route('**/api/v2/email/mailboxes/connect', async (route) => {
      asked = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authorizeUrl: 'http://localhost/e2e-google-stub' }),
      });
    });
    await page.route('http://localhost/e2e-google-stub', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<p>stub</p>' }),
    );
    await page.getByRole('button', { name: 'Connect Gmail' }).click();
    await expect.poll(() => asked).toBe(true);
  });

  test('IMAP and Microsoft are listed as disabled Soon cards', async ({ page }) => {
    for (const id of ['imap', 'microsoft']) {
      const card = page.getByTestId(`email-provider-${id}`);
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute('aria-disabled', 'true');
      await expect(card.getByRole('button', { name: 'Soon' })).toBeDisabled();
    }
  });

  test('setup guide has the three blocks', async ({ page }) => {
    for (const name of [
      'Connect Gmail or Google Workspace',
      'What we read and send',
      'If something looks wrong',
    ]) {
      await expect(page.locator('summary', { hasText: name })).toBeVisible();
    }
  });

  test('a return from Google with ?email=denied says so and tidies the address', async ({
    page,
  }) => {
    await page.goto('/email?email=denied');
    await hydrated(page);
    await expect(page.getByTestId('email-outcome')).toContainText('cancelled');
    await expect(page).toHaveURL(/\/email$/);
  });

  test('a connected mailbox shows its status, counts and Open in inbox', async ({ page }) => {
    const list = await mailboxes(page);
    const box = list?.data.find((m) => m.status === 'connected' && m.channelId);
    test.skip(!box, 'no connected mailbox in this workspace');
    const card = page.getByTestId('email-mailbox').first();
    await expect(card.getByTestId('email-status')).toHaveText('Connected');
    await card.getByTestId('email-open-inbox').click();
    await expect(page).toHaveURL(new RegExp(`/inbox\\?channel=${box!.channelId}`));
  });
});
