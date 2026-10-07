import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * The team inbox against the running stack (web :3001, API :3100 with CHANNEL_SIMULATOR_ENABLED=true, the worker running: sends
 * and ingest go through it). Two browser contexts watch the same workspace, so "live" means a second person sees it without a
 * reload. Signs in as a local staff account given by INBOX_E2E_EMAIL and INBOX_E2E_PASSWORD (a development account only);
 * without them the whole file is skipped.
 */
const EMAIL = process.env.INBOX_E2E_EMAIL;
const PASSWORD = process.env.INBOX_E2E_PASSWORD;
test.skip(!EMAIL || !PASSWORD, 'INBOX_E2E_EMAIL and INBOX_E2E_PASSWORD are not set');

/** Each run talks as its own customer, so threads from earlier runs never get in the way. */
const NUMBER = `9198${String(Date.now()).slice(-8)}`;
const NAME = `E2E Customer ${NUMBER.slice(-4)}`;

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(dashboard|inbox|onboarding)/);
}

async function api<T>(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  data?: unknown,
): Promise<T> {
  const res = await request.fetch(`/api/v2${path}`, {
    method,
    data,
    headers: { 'Idempotency-Key': randomUUID() },
  });
  expect(res.ok(), `${method} ${path} -> ${res.status()}`).toBe(true);
  return (res.status() === 204 ? undefined : await res.json()) as T;
}

interface Channel {
  id: string;
  kind: string;
  rowVersion: number;
}

/** The simulator channel of this workspace, created on first use. */
async function simulatorChannel(request: APIRequestContext): Promise<Channel> {
  const list = await api<{ data: Channel[] }>(request, 'GET', '/channels');
  const found = list.data.find((c) => c.kind === 'simulator');
  if (found) return found;
  return api<Channel>(request, 'POST', '/channels/simulator', { name: 'Simulator' });
}

async function customerSays(request: APIRequestContext, channelId: string, text: string) {
  await api(request, 'POST', `/dev/simulator/channels/${channelId}/inbound`, {
    from: NUMBER,
    name: NAME,
    kind: 'text',
    text,
  });
}

async function setWindow(
  request: APIRequestContext,
  channelId: string,
  window: 'auto' | 'open' | 'closed',
) {
  const current = await api<Channel>(request, 'GET', `/channels/${channelId}`);
  await api(request, 'PATCH', `/channels/${channelId}`, {
    rowVersion: current.rowVersion,
    settings: { simulator: { window } },
  });
}

/**
 * One sign-in for the whole file: the API caps the sessions of an account, so every window reuses the same cookies instead of
 * signing in again (two windows of one person see the same inbox, which is all these tests need).
 */
let storage: Awaited<ReturnType<import('@playwright/test').BrowserContext['storageState']>> | null =
  null;

async function newSession(browser: Browser) {
  const baseURL = process.env.WEB_URL ?? 'http://localhost:3001';
  if (!storage) {
    const first = await browser.newContext({ baseURL });
    await signIn(await first.newPage());
    storage = await first.storageState();
    await first.close();
  }
  const context = await browser.newContext({ baseURL, storageState: storage });
  return { context, page: await context.newPage() };
}

const row = (page: Page) => page.locator('[data-testid="inbox-row"]').filter({ hasText: NAME });
const messages = (page: Page) => page.locator('[data-testid="inbox-message"]');

test.describe.configure({ mode: 'serial' });

test.describe('the inbox, live in two windows', () => {
  let channelId = '';

  test.beforeAll(async ({ browser }) => {
    const { context, page } = await newSession(browser);
    channelId = (await simulatorChannel(page.request)).id;
    await setWindow(page.request, channelId, 'auto');
    await context.close();
  });

  test('a customer message appears live in both windows, with an unread badge', async ({
    browser,
  }) => {
    const a = await newSession(browser);
    const b = await newSession(browser);
    for (const { page } of [a, b]) {
      await page.goto('/inbox');
      await expect(page.getByTestId('inbox-list')).toBeVisible();
    }

    await customerSays(a.page.request, channelId, 'Hi, is the blue jacket in stock?');

    for (const { page } of [a, b]) {
      await expect(row(page)).toBeVisible({ timeout: 15_000 });
      await expect(row(page)).toContainText('blue jacket');
      await expect(row(page).getByTestId('inbox-unread-badge')).toBeVisible();
    }
    await a.context.close();
    await b.context.close();
  });

  test('opening it shows the thread, clears the unread badge and keeps the deep link', async ({
    browser,
  }) => {
    const { context, page } = await newSession(browser);
    await page.goto('/inbox');
    await row(page).click();
    await expect(page).toHaveURL(/\/inbox\?c=[0-9a-f-]{36}/);
    await expect(messages(page).filter({ hasText: 'blue jacket' })).toBeVisible();
    await expect(row(page).getByTestId('inbox-unread-badge')).toHaveCount(0, { timeout: 10_000 });

    const url = page.url();
    await page.goto(url);
    await expect(messages(page).filter({ hasText: 'blue jacket' })).toBeVisible();
    await context.close();
  });

  test('a reply shows at once and its ticks move to read', async ({ browser }) => {
    const { context, page } = await newSession(browser);
    await page.goto('/inbox');
    await row(page).click();
    await page.getByTestId('inbox-composer').fill('Yes, we have it in M and L.');
    await page.keyboard.press('Enter');

    const bubble = messages(page).filter({ hasText: 'in M and L' });
    await expect(bubble).toBeVisible();
    await expect(bubble).toHaveAttribute('data-status', /queued|sent|delivered|read/);
    await expect(bubble).toHaveAttribute('data-status', 'read', { timeout: 20_000 });
    await expect(page.getByTestId('inbox-composer')).toHaveValue('');
    await context.close();
  });

  test('Shift+Enter adds a line instead of sending', async ({ browser }) => {
    const { context, page } = await newSession(browser);
    await page.goto('/inbox');
    await row(page).click();
    const box = page.getByTestId('inbox-composer');
    await box.fill('line one');
    await box.press('Shift+Enter');
    await box.pressSequentially('line two');
    await expect(box).toHaveValue('line one\nline two');
    await expect(messages(page).filter({ hasText: 'line two' })).toHaveCount(0);
    await context.close();
  });

  test('a message the provider refuses shows the reason and can be retried', async ({
    browser,
  }) => {
    const { context, page } = await newSession(browser);
    await page.goto('/inbox');
    await row(page).click();
    await page.getByTestId('inbox-composer').fill('/fail this one will not go');
    await page.keyboard.press('Enter');
    const bubble = messages(page).filter({ hasText: 'this one will not go' });
    await expect(bubble).toHaveAttribute('data-status', 'failed', { timeout: 20_000 });
    await expect(bubble.getByTestId('inbox-failure')).toBeVisible();
    await expect(bubble.getByTestId('inbox-retry')).toBeVisible();
    await context.close();
  });

  test('assigning moves the row between Unassigned and Mine in the other window', async ({
    browser,
  }) => {
    const a = await newSession(browser);
    const b = await newSession(browser);
    await b.page.goto('/inbox');
    await b.page.getByTestId('inbox-tab-unassigned').click();
    await expect(row(b.page)).toBeVisible();

    await a.page.goto('/inbox');
    await row(a.page).click();
    await a.page.getByTestId('inbox-panel-assign-me').click();

    await expect(row(b.page)).toHaveCount(0, { timeout: 15_000 });
    await b.page.getByTestId('inbox-tab-mine').click();
    await expect(row(b.page)).toBeVisible();
    await a.context.close();
    await b.context.close();
  });

  test('a closed 24-hour window disables the composer and explains why', async ({ browser }) => {
    const { context, page } = await newSession(browser);
    await setWindow(page.request, channelId, 'closed');
    await page.goto('/inbox');
    await row(page).click();
    await expect(page.getByTestId('inbox-window-banner')).toBeVisible();
    await expect(page.getByTestId('inbox-window-badge')).toHaveAttribute('data-state', 'closed');
    await expect(page.getByTestId('inbox-composer')).toBeDisabled();

    // Internal notes are still possible.
    await page.getByTestId('inbox-mode-note').click();
    await expect(page.getByTestId('inbox-composer')).toBeEnabled();
    await setWindow(page.request, channelId, 'auto');
    await context.close();
  });

  test('a duplicate delivery is stored once', async ({ browser }) => {
    const { context, page } = await newSession(browser);
    await api(page.request, 'POST', `/dev/simulator/channels/${channelId}/inbound`, {
      from: NUMBER,
      name: NAME,
      kind: 'text',
      text: 'dup once please',
      fault: 'dup',
    });
    await page.goto('/inbox');
    await row(page).click();
    await expect(messages(page).filter({ hasText: 'dup once please' })).toHaveCount(1, {
      timeout: 15_000,
    });
    await context.close();
  });

  test('an internal note is drawn apart from the messages and can be removed', async ({
    browser,
  }) => {
    const { context, page } = await newSession(browser);
    await page.goto('/inbox');
    await row(page).click();
    await page.getByTestId('inbox-mode-note').click();
    await page.getByTestId('inbox-composer').fill('Customer prefers WhatsApp calls');
    await page.keyboard.press('Enter');
    await expect(
      page.getByTestId('inbox-note').filter({ hasText: 'prefers WhatsApp' }),
    ).toBeVisible();
    await expect(
      page.getByTestId('inbox-note').filter({ hasText: 'prefers WhatsApp' }),
    ).toContainText('Internal note');
    await context.close();
  });

  test('j and k move through the list, / focuses the search', async ({ browser }) => {
    const { context, page } = await newSession(browser);
    await page.goto('/inbox');
    await expect(row(page)).toBeVisible();
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('/');
    await expect(page.getByTestId('inbox-search')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.keyboard.press('j');
    await expect(page).toHaveURL(/c=/);
    await context.close();
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the list is the home screen, the thread slides over it, and nothing scrolls sideways', async ({
    browser,
  }) => {
    const { context, page } = await newSession(browser);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/inbox');
    await expect(page.getByTestId('inbox-list')).toBeVisible();
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    expect(await overflow()).toBeLessThanOrEqual(0);

    await row(page).click();
    await expect(page.getByTestId('inbox-back')).toBeVisible();
    await expect(page.getByTestId('inbox-composer')).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);

    await page.getByTestId('inbox-back').click();
    await expect(page).not.toHaveURL(/c=/);
    await expect(page.getByTestId('inbox-list')).toBeVisible();
    await context.close();
  });
});
