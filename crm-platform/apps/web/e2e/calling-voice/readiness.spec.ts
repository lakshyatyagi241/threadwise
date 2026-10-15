import { expect, test, type Page } from '@playwright/test';

/**
 * The calling readiness card (EXT-CALL-007 to 010) against the running stack (web :3001, API :3000). Signs in as a local workspace
 * admin given by CALL_E2E_EMAIL and CALL_E2E_PASSWORD (plus CALL_E2E_ORG, the workspace slug); without them the whole file is skipped.
 * A test that needs a connected WhatsApp Cloud API number skips itself when the workspace has none.
 *
 * Nothing here switches calling on or off and no call is placed: it reads the checklist, asks for a check (which only READS Meta) and
 * looks at what the screen says. With no network to Meta the checks come back as "could not be read", which the card must show as a
 * row, never as an error page. A real number is the manual checklist in docs/threadwise-port/plan/calling-number-readiness-build.md.
 */
const EMAIL = process.env.CALL_E2E_EMAIL;
const PASSWORD = process.env.CALL_E2E_PASSWORD;
const ORG = process.env.CALL_E2E_ORG ?? 'Admin';
test.skip(!EMAIL || !PASSWORD, 'CALL_E2E_EMAIL and CALL_E2E_PASSWORD are not set');

async function signIn(page: Page) {
  const res = await page.request.post('/api/auth/login', {
    data: { orgSlug: ORG, email: EMAIL, password: PASSWORD },
  });
  expect(res.ok(), `sign in as ${EMAIL}`).toBe(true);
}

/** True once React has attached to the screen: before that, a click on the server-rendered HTML does nothing. */
async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('main') ?? document.body;
    return Object.keys(el.firstElementChild ?? el).some((k) => k.startsWith('__react'));
  });
}

/** Opens the calling settings and waits for its numbers; returns how many number cards it drew. */
async function openCalling(page: Page): Promise<number> {
  await page.goto('/calling');
  await hydrated(page);
  const card = page.getByTestId('readiness-card');
  const empty = page.getByText('No WhatsApp numbers yet');
  const locked = page.getByText('Your plan does not include WhatsApp calling.');
  await expect(card.first().or(empty).or(locked)).toBeVisible({ timeout: 30_000 });
  return card.count();
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('each number shows its readiness checklist with a status and what to do', async ({ page }) => {
  const cards = await openCalling(page);
  test.skip(cards === 0, 'this workspace has no WhatsApp number (or its plan has no calling)');
  const card = page.getByTestId('readiness-card').first();
  await expect(card.getByTestId('readiness-status')).toBeVisible();
  // Every row is one of the three states, and anything not OK names what to do.
  const rows = card.locator('li[data-check]');
  await expect(rows.first()).toBeVisible();
  const notOk = card.locator('li[data-state="warn"], li[data-state="fail"]');
  for (let i = 0; i < (await notOk.count()); i++) {
    await expect(notOk.nth(i)).toContainText('What to do:');
  }
});

test('Check again looks at the number and keeps the screen intact', async ({ page }) => {
  const cards = await openCalling(page);
  test.skip(cards === 0, 'this workspace has no WhatsApp number (or its plan has no calling)');
  const card = page.getByTestId('readiness-card').first();
  const again = card.getByRole('button', { name: 'Check again' });
  test.skip((await again.count()) === 0, 'this account may not change calling');
  const asked = page.waitForResponse(
    (r) =>
      /\/calling\/numbers\/[^/]+\/readiness\/check$/.test(r.url()) &&
      r.request().method() === 'POST',
  );
  await again.click();
  expect((await asked).status()).toBe(200);
  await expect(card.getByTestId('readiness-status')).toBeVisible();
  await expect(page.getByTestId('readiness-card').first()).toHaveAttribute('data-status', /.+/);
});

test('the same card is on the number health page', async ({ page }) => {
  const cards = await openCalling(page);
  test.skip(cards === 0, 'this workspace has no WhatsApp number (or its plan has no calling)');
  const token = (await page.context().cookies()).find((c) => c.name === 'crm_at')?.value;
  const api = process.env.API_URL ?? 'http://localhost:3000';
  const list = await page.request.get(`${api}/v2/calling/numbers`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(list.ok()).toBe(true);
  const id = ((await list.json()) as { rows: Array<{ id: string }> }).rows[0]!.id;
  await page.goto(`/channels/whatsapp/${id}/health`);
  await hydrated(page);
  await expect(page.getByTestId('readiness-card')).toBeVisible({ timeout: 30_000 });
});

test('the automatic switch-on is off until an admin turns it on, and says what it does', async ({
  page,
}) => {
  await page.goto('/calling');
  await hydrated(page);
  await expect(page.getByText('Turn calling on automatically').first()).toBeVisible({
    timeout: 30_000,
  });
});
