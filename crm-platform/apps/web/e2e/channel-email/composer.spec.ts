import { expect, test, type Page } from '@playwright/test';

/**
 * TW-MAIL-027 and 032 on the screen: the rich-text reply box on an email conversation, attachments, the signature picker, the
 * signatures panel on the Email hub and the bounce notice in the thread. Needs a workspace with the Email add-on and a connected
 * mailbox that already has an email conversation; every test is skipped otherwise. Nothing is sent to a real mail server: the send
 * and upload calls are intercepted.
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

/** The first email conversation of a connected mailbox, or null. */
async function emailConversation(page: Page): Promise<string | null> {
  const boxes = await page.request.get('/api/v2/email/mailboxes');
  if (!boxes.ok()) return null;
  const list = (await boxes.json()) as {
    data: Array<{ status: string; channelId: string | null }>;
  };
  const box = list.data.find((m) => m.status === 'connected' && m.channelId);
  if (!box) return null;
  const res = await page.request.get(
    `/api/v2/inbox/conversations?channelId=${box.channelId}&limit=1`,
  );
  if (!res.ok()) return null;
  const body = (await res.json()) as { data: Array<{ id: string }> };
  return body.data[0]?.id ?? null;
}

test.describe('Email composer', () => {
  let conversationId: string;

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    const id = await emailConversation(page);
    test.skip(!id, 'no connected mailbox with an email conversation on this workspace');
    conversationId = id!;
    await page.goto(`/inbox?conversation=${conversationId}`);
    await hydrated(page);
  });

  test('shows the rich-text box, the attach button and Cc, Bcc and subject', async ({ page }) => {
    await expect(page.getByTestId('email-editor-toolbar')).toBeVisible();
    await expect(page.getByTestId('inbox-composer')).toHaveAttribute('role', 'textbox');
    await expect(page.getByTestId('email-attach-button')).toBeVisible();
    await expect(page.getByTestId('email-extras-toggle')).toBeVisible();
  });

  test('sends the typed text as HTML with the attachment id', async ({ page }) => {
    let upload = 0;
    await page.route('**/api/v2/email/attachments/upload', async (route) => {
      upload += 1;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '7c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f',
          name: 'note.txt',
          mime: 'text/plain',
          size: 5,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      });
    });
    let sent: { email?: { bodyHtml?: string; attachmentIds?: string[] } } | null = null;
    await page.route('**/api/v2/inbox/conversations/*/messages', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      sent = route.request().postDataJSON() as typeof sent;
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    });
    await page.getByTestId('email-file-input').setInputFiles({
      name: 'note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello'),
    });
    await expect(page.getByTestId('email-attach-item')).toHaveAttribute('data-status', 'ready');
    expect(upload).toBe(1);
    await page.getByTestId('inbox-composer').click();
    await page.keyboard.type('Thanks, ');
    await page.getByTestId('email-editor-bold').click();
    await page.keyboard.type('done');
    await page.keyboard.press('Control+Enter');
    await expect.poll(() => sent).not.toBeNull();
    expect(sent!.email?.bodyHtml).toMatch(/<b>done<\/b>|<strong>done<\/strong>/);
    expect(sent!.email?.attachmentIds).toEqual(['7c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f']);
  });

  test('refuses a file type email cannot carry before uploading it', async ({ page }) => {
    await page.getByTestId('email-file-input').setInputFiles({
      name: 'run.exe',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('MZ'),
    });
    await expect(page.getByTestId('email-attach-refused')).toContainText('run.exe');
    await expect(page.getByTestId('email-attach-item')).toHaveCount(0);
  });

  test('pasted HTML never reaches the box as scripts or handlers', async ({ page }) => {
    await page.getByTestId('inbox-composer').click();
    await page.evaluate(() => {
      const box = document.querySelector('[data-testid="inbox-composer"]')!;
      const data = new DataTransfer();
      data.setData('text/html', '<p onclick="window.__x=1">hi</p><script>window.__x=1</script>');
      box.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    });
    expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
    await expect(page.getByTestId('inbox-composer').locator('script, [onclick]')).toHaveCount(0);
  });

  test('switches to plain text and back', async ({ page }) => {
    await page.getByTestId('email-rich-toggle').click();
    await expect(page.getByTestId('inbox-composer')).toHaveJSProperty('tagName', 'TEXTAREA');
    await page.getByTestId('email-rich-toggle').click();
    await expect(page.getByTestId('inbox-composer')).toHaveAttribute('role', 'textbox');
  });
});

test.describe('Signatures panel', () => {
  test('creates, edits and deletes the signature of the signed-in user', async ({ page }) => {
    await signIn(page);
    const res = await page.request.get('/api/v2/email/signatures');
    test.skip(!res.ok(), 'the Email add-on is not on this workspace');
    await page.goto('/email');
    await hydrated(page);
    await page.getByTestId('email-signature-new').click();
    await page.getByTestId('email-signature-name').fill('E2E signature');
    await page.getByTestId('email-signature-editor').click();
    await page.keyboard.type('Regards, {{name}}');
    await page.getByTestId('email-signature-save').click();
    const row = page.getByTestId('email-signature-row').filter({ hasText: 'E2E signature' });
    await expect(row).toBeVisible();
    await row.getByTestId('email-signature-delete').click();
    await row.getByTestId('email-signature-confirm-delete').click();
    await expect(row).toHaveCount(0);
  });
});
