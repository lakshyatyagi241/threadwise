import { expect, test, type Page } from '@playwright/test';
import {
  LAUNCH,
  cleanupTag,
  openFaq,
  poolWorkspace,
  restoreConfig,
  runTag,
  signInOperator,
  sql,
  sqlNum,
  statNum,
  waitNoPending,
  waitReady,
} from './admin-support';

test.use({ launchOptions: LAUNCH });
test.setTimeout(420_000);

const TAG = runTag('pwadmmnt');
const reindexAll = (page: Page) =>
  page.getByRole('button', { name: 'Re-index everything', exact: true });
const retryFailed = (page: Page) => page.getByRole('button', { name: 'Retry failed', exact: true });
const isOverviewGet = (r: { method: () => string; url: () => string }) =>
  r.method() === 'GET' && new URL(r.url()).pathname === '/api/platform/faq';
const isReindex = (r: { method: () => string; url: () => string }) =>
  r.method() === 'POST' && new URL(r.url()).pathname === '/api/platform/faq/reindex';

test.beforeEach(async ({ page }) => {
  await signInOperator(page);
});
test.afterEach(async () => {
  await restoreConfig();
});
test.afterAll(() => cleanupTag(TAG));

test.describe('maintenance: confirmation and requests', () => {
  test('Re-index everything asks first; Cancel and Escape send nothing and focus returns to the button', async ({
    page,
  }) => {
    const posts: string[] = [];
    page.on('request', (r) => isReindex(r) && posts.push(r.url()));
    await openFaq(page);
    await reindexAll(page).click();
    const dialog = page.getByRole('dialog', { name: 'Re-index everything?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Every stored vector is made again with the current model.');
    await expect(dialog).toContainText('embedding tokens are billed again');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(reindexAll(page)).toBeFocused();
    await reindexAll(page).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(reindexAll(page)).toBeFocused();
    expect(posts).toEqual([]);
  });

  test('a double click on the confirm button queues once and the toast shows the count', async ({
    page,
  }) => {
    const bodies: unknown[] = [];
    await page.route('**/api/platform/faq/reindex', async (route) => {
      bodies.push(route.request().postDataJSON());
      await new Promise((r) => setTimeout(r, 1000));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ queued: 7 }),
      });
    });
    await openFaq(page);
    await reindexAll(page).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Re-index everything' }).dblclick();
    await expect(page.getByText('7 vectors queued.')).toBeVisible();
    await page.waitForTimeout(1200);
    expect(bodies).toEqual([{ scope: 'all' }]);
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('a server error closes the dialog and shows a calm message', async ({ page }) => {
    await page.route('**/api/platform/faq/reindex', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'https://errors.crm.platform/internal',
          title: 'x',
          status: 500,
          code: 'INTERNAL_ERROR',
        }),
      }),
    );
    await openFaq(page);
    await reindexAll(page).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Re-index everything' }).click();
    await expect(
      page.getByText('Something went wrong on our side. Try again in a moment.'),
    ).toBeVisible();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(reindexAll(page)).toBeEnabled();
  });

  test('Retry failed is disabled with a hint while nothing failed', async ({ page }) => {
    test.skip(
      sqlNum(`SELECT count(*) FROM faq_variations WHERE embed_state='failed'`) > 0,
      'another run left failed vectors',
    );
    await openFaq(page);
    await expect(retryFailed(page)).toBeDisabled();
    await expect(page.getByText('No failed vectors to retry.')).toBeVisible();
    await expect(reindexAll(page)).toBeEnabled();
  });
});

test.describe('maintenance: re-indexing and polling', () => {
  test('Re-index everything queues every vector, the page polls and shows progress, then stops polling when nothing waits', async ({
    page,
  }) => {
    const gets: number[] = [];
    page.on('request', (r) => isOverviewGet(r) && gets.push(Date.now()));
    await openFaq(page);
    await expect
      .poll(() => statNum(page, 'Indexing health', 'Waiting'))
      .toBe(sqlNum(`SELECT count(*) FROM faq_variations WHERE embed_state='pending'`));
    const all = sqlNum('SELECT count(*) FROM faq_variations');
    expect(all).toBeGreaterThan(0);
    await reindexAll(page).click();
    const [req] = await Promise.all([
      page.waitForRequest(isReindex),
      page.getByRole('dialog').getByRole('button', { name: 'Re-index everything' }).click(),
    ]);
    expect(req.postDataJSON()).toEqual({ scope: 'all' });
    await expect(
      page.getByText(new RegExp(`^${all.toLocaleString('en-US')} vectors? queued\\.`)),
    ).toBeVisible();
    await expect(
      page.getByText(/Refreshing every 5 seconds while [\d,]+ are waiting\./),
    ).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Indexing progress' })).toBeVisible();
    await expect(page.getByText('Nothing is waiting to be indexed.')).toBeVisible({
      timeout: 240_000,
    });
    await expect(page.getByRole('progressbar', { name: 'Indexing progress' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
    // It re-read the overview while rows waited (at least once beyond the load and the post-queue refresh).
    expect(gets.length).toBeGreaterThanOrEqual(3);
    // Quiet: no further overview request once nothing is waiting (two poll periods).
    await page.waitForTimeout(1500);
    const quietFrom = gets.length;
    await page.waitForTimeout(12_000);
    expect(gets.length).toBe(quietFrom);
  });

  test('the progress bar and text agree with the database while vectors wait', async ({ page }) => {
    await openFaq(page);
    await reindexAll(page).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Re-index everything' }).click();
    await expect(page.getByText(/queued\./)).toBeVisible();
    const bar = page.getByRole('progressbar', { name: 'Indexing progress' });
    await expect(bar).toBeVisible();
    // Read the bar and its text in one tick so both describe the same overview.
    const { now, text } = await page.evaluate(() => ({
      now: Number(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')),
      text:
        Array.from(document.querySelectorAll('p')).find((p) =>
          /^[\d,]+ of [\d,]+ ready$/.test(p.textContent ?? ''),
        )?.textContent ?? '',
    }));
    const [ready, total] = (text.match(/[\d,]+/g) ?? []).map((n) => Number(n.replace(/,/g, '')));
    expect(total).toBeGreaterThan(0);
    expect(ready).toBeLessThanOrEqual(total);
    expect(now).toBe(Math.floor((ready / total) * 100));
    await expect(bar).toHaveAttribute('aria-valuenow', '100', { timeout: 240_000 });
    await waitNoPending(240_000);
  });
});

test.describe('maintenance: failed vectors', () => {
  test('Retry failed re-queues a failed vector, which then becomes ready, and the button is disabled again', async ({
    page,
  }) => {
    const ws = await poolWorkspace('A');
    await ws.enable(0.5);
    await ws.faq(`Failed ${TAG} sample`, [`${TAG} failed phrase`]);
    await waitReady(ws);
    const id = sql(
      `SELECT v.id FROM faq_variations v JOIN faqs f ON f.org_id=v.org_id AND f.id=v.faq_id WHERE f.question LIKE '%${TAG}%' ORDER BY v.id LIMIT 1`,
    );
    sql(
      `UPDATE faq_variations SET embed_state='failed', embed_attempts=5, embed_error='pw seeded failure' WHERE id=${id}`,
    );
    await openFaq(page);
    await expect(retryFailed(page)).toBeEnabled();
    await expect
      .poll(() => statNum(page, 'Indexing health', 'Failed'))
      .toBe(sqlNum(`SELECT count(*) FROM faq_variations WHERE embed_state='failed'`));
    const failedBefore = sqlNum(`SELECT count(*) FROM faq_variations WHERE embed_state='failed'`);
    await retryFailed(page).click();
    const dialog = page.getByRole('dialog', { name: 'Retry the failed vectors?' });
    await expect(dialog).toContainText('Only the vectors that gave up are queued again.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(sql(`SELECT embed_state FROM faq_variations WHERE id=${id}`)).toBe('failed');
    await retryFailed(page).click();
    const [req] = await Promise.all([
      page.waitForRequest(isReindex),
      dialog.getByRole('button', { name: 'Retry failed' }).click(),
    ]);
    expect(req.postDataJSON()).toEqual({ scope: 'failed' });
    await expect(page.getByText(new RegExp(`^${failedBefore} vectors? queued\\.`))).toBeVisible();
    await expect
      .poll(() => sql(`SELECT embed_state FROM faq_variations WHERE id=${id}`), { timeout: 90_000 })
      .toBe('ready');
    await expect(page.getByText('Nothing is waiting to be indexed.')).toBeVisible({
      timeout: 60_000,
    });
    await expect
      .poll(() => statNum(page, 'Indexing health', 'Failed'))
      .toBe(sqlNum(`SELECT count(*) FROM faq_variations WHERE embed_state='failed'`));
    if (sqlNum(`SELECT count(*) FROM faq_variations WHERE embed_state='failed'`) === 0) {
      await expect(retryFailed(page)).toBeDisabled();
      await expect(page.getByText('No failed vectors to retry.')).toBeVisible();
    }
  });

  test('a variation the provider refuses fails after five attempts, shows as failed, and Retry failed queues it again', async ({
    page,
  }) => {
    const ws = await poolWorkspace('A');
    await ws.enable(0.5);
    await ws.faq(`Refused ${TAG} [[fail]] question`, []);
    const row = () =>
      sql(
        `SELECT v.embed_state || '|' || v.embed_attempts FROM faq_variations v JOIN faqs f ON f.org_id=v.org_id AND f.id=v.faq_id WHERE f.question LIKE '%${TAG}%[[fail]]%'`,
      );
    await expect.poll(row, { timeout: 180_000, intervals: [3000] }).toBe('failed|5');
    await openFaq(page);
    await expect(retryFailed(page)).toBeEnabled();
    await ws.faq(`${TAG} unrelated`, []);
    await expect.poll(() => statNum(page, 'Indexing health', 'Failed')).toBeGreaterThanOrEqual(1);
    const failed = sqlNum(`SELECT count(*) FROM faq_variations WHERE embed_state='failed'`);
    await page.getByRole('searchbox', { name: 'Search workspaces' }).fill(ws.name);
    await expect(page.getByRole('row', { name: new RegExp(ws.name) }).first()).toContainText(
      /\d+ failed/,
    );
    await retryFailed(page).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Retry failed' }).click();
    await expect(page.getByText(new RegExp(`^${failed} vectors? queued\\.`))).toBeVisible();
    // The attempts start from zero again; the provider still refuses, so it ends up failed once more.
    await expect
      .poll(
        () =>
          sql(
            `SELECT count(*) FROM faq_variations v JOIN faqs f ON f.org_id=v.org_id AND f.id=v.faq_id WHERE f.question LIKE '%${TAG}%[[fail]]%' AND v.embed_attempts < 5`,
          ),
        { timeout: 30_000 },
      )
      .toBe('1');
    await expect.poll(row, { timeout: 180_000, intervals: [3000] }).toBe('failed|5');
  });
});
