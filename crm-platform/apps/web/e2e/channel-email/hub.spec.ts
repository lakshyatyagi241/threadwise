import { expect, test, type Page } from '@playwright/test';

/**
 * TW-MAIL-019, 020, 023, 031, 034, 035 against the running stack: the `/email` hub (the three provider cards, the provider-not-ready
 * state, the IMAP form with its client-side checks and the server's which-login-failed answer, the sharing panel, the setup guide and the
 * `?email=` outcome message). It signs in as the seeded local workspace admin and never completes
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

  test('lists Google, Microsoft 365 and IMAP / SMTP as provider cards, none of them "Soon"', async ({
    page,
  }) => {
    for (const id of ['google', 'microsoft', 'imap']) {
      await expect(page.getByTestId(`email-provider-${id}`)).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Connect Microsoft 365' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect IMAP / SMTP' })).toBeVisible();
    await expect(page.getByText('Soon', { exact: true })).toHaveCount(0);
  });

  test('the IMAP form checks the fields and shows which login the server refused', async ({
    page,
  }) => {
    const list = await mailboxes(page);
    test.skip(!list || list.used >= (list.limit || Infinity), 'cannot connect here');
    await page.getByRole('button', { name: 'Connect IMAP / SMTP' }).click();
    const form = page.getByTestId('email-imap-form');
    await expect(form).toBeVisible();
    // empty submit: every required field is named, nothing is sent
    let sent = 0;
    await page.route('**/api/v2/email/mailboxes/connect-imap', async (route) => {
      sent += 1;
      await route.fulfill({
        status: 422,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'SMTP login refused',
          status: 422,
          code: 'MAIL_SMTP_AUTH_FAILED',
        }),
      });
    });
    await form.getByTestId('email-imap-submit').click();
    await expect(form.getByText('This field is required.').first()).toBeVisible();
    expect(sent).toBe(0);
    // a valid form: the answer says it was the outgoing server, and the password is cleared
    await form.getByLabel('Mailbox address').fill('support@example.test');
    await form.getByLabel('Display name').fill('Support');
    await form.getByLabel('Server').first().fill('imap.example.test');
    await form.getByLabel('User name').first().fill('support');
    await form.getByLabel('Password').first().fill('not-a-real-password');
    await form.getByLabel('Server').nth(1).fill('smtp.example.test');
    await form.getByTestId('email-imap-submit').click();
    await expect(page.getByTestId('email-imap-failure')).toContainText('outgoing server (SMTP)');
    expect(sent).toBe(1);
    await expect(form.getByLabel('Password').first()).toHaveValue('');
  });

  test('Microsoft 365 asks the API for its own sign-in address (no real sign-in)', async ({
    page,
  }) => {
    const providers = await page.request.get('/api/v2/email/providers');
    test.skip(!providers.ok(), 'providers are not available');
    const ms = (
      (await providers.json()) as { data: Array<{ provider: string; ready: boolean }> }
    ).data.find((p) => p.provider === 'microsoft');
    test.skip(!ms?.ready, 'Microsoft credentials are not set on this stack');
    const list = await mailboxes(page);
    test.skip(!list || list.used >= (list.limit || Infinity), 'cannot connect here');
    let body: { provider?: string; scope?: string } = {};
    await page.route('**/api/v2/email/mailboxes/connect', async (route) => {
      body = route.request().postDataJSON() as typeof body;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authorizeUrl: 'http://localhost/e2e-microsoft-stub' }),
      });
    });
    await page.route('http://localhost/e2e-microsoft-stub', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<p>stub</p>' }),
    );
    await page.getByRole('button', { name: 'Connect Microsoft 365' }).click();
    await expect.poll(() => body.provider).toBe('microsoft');
    expect(body.scope).toBe('shared');
  });

  test('the Email sharing panel saves the policy with its row version (admin)', async ({
    page,
  }) => {
    const res = await page.request.get('/api/v2/email/settings');
    test.skip(!res.ok(), 'the sharing policy is not available here');
    const before = (await res.json()) as { personalMailboxesEnabled: boolean; rowVersion: number };
    const panel = page.getByTestId('email-sharing');
    test.skip(!(await panel.isVisible()), 'this user may not manage the sharing policy');
    const toggle = panel.getByRole('switch', { name: 'Personal mailboxes' });
    await toggle.click();
    await panel.getByTestId('email-sharing-save').click();
    await expect(page.getByText('Email sharing saved.')).toBeVisible();
    const after = (await (await page.request.get('/api/v2/email/settings')).json()) as {
      personalMailboxesEnabled: boolean;
      rowVersion: number;
    };
    expect(after.personalMailboxesEnabled).toBe(!before.personalMailboxesEnabled);
    expect(after.rowVersion).toBeGreaterThan(before.rowVersion);
    // put it back so the run leaves the workspace as it found it
    await toggle.click();
    await panel.getByTestId('email-sharing-save').click();
    await expect(page.getByText('Email sharing saved.').first()).toBeVisible();
  });

  test('setup guide has its five blocks', async ({ page }) => {
    for (const name of [
      'Connect Gmail or Google Workspace',
      'Connect Microsoft 365 or another mail provider',
      'Personal mailboxes and sharing',
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
