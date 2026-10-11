import { expect, test } from '@playwright/test';
import {
  GEMINI,
  LARGE,
  LAUNCH,
  cleanupTag,
  poolWorkspace,
  openFaq,
  operatorApi,
  runTag,
  signInOperator,
  sql,
  sqlNum,
  statNum,
  stat,
  waitReady,
  withoutPlatformKey,
  type Workspace,
} from './admin-support';

test.use({ launchOptions: LAUNCH });
test.setTimeout(240_000);

const TAG = runTag('pwadmov');
let ws: Workspace;

/** The ten numbers of the overview, computed the way the API documents them, straight from the tables. */
function dbNumbers() {
  const model = LARGE;
  return {
    enabled: sqlNum(`SELECT count(*) FROM faq_settings WHERE enabled`),
    faqs: sqlNum(`SELECT count(*) FROM faqs`),
    variations: sqlNum(`SELECT count(*) FROM faq_variations`),
    ready: sqlNum(
      `SELECT count(*) FROM faq_variations WHERE embed_state='ready' AND embedding_model='${model}'`,
    ),
    waiting: sqlNum(`SELECT count(*) FROM faq_variations WHERE embed_state='pending'`),
    failed: sqlNum(`SELECT count(*) FROM faq_variations WHERE embed_state='failed'`),
    matches: sqlNum(
      `SELECT count(*) FROM faq_match_logs WHERE origin='inbound' AND created_at >= now() - interval '30 days'`,
    ),
    answered: sqlNum(
      `SELECT count(*) FROM faq_match_logs WHERE origin='inbound' AND outcome IN ('answered','flow_started') AND created_at >= now() - interval '30 days'`,
    ),
    tokens: sqlNum(
      `SELECT COALESCE(sum(total_tokens),0) FROM ai_token_usage WHERE provider='openrouter' AND model IN ('${LARGE}','${GEMINI}') AND created_at >= now() - interval '30 days'`,
    ),
  };
}

async function uiNumbers(page: import('@playwright/test').Page) {
  const hint =
    (await page.getByText(/workspaces? (have|has) FAQs switched on/).textContent()) ?? '';
  const totals = (await page.getByText(/FAQs · .* variations/).textContent()) ?? '';
  const nums = totals.match(/[\d,]+/g)!.map((n) => Number(n.replace(/,/g, '')));
  return {
    enabled: Number(hint.match(/\d[\d,]*/)![0].replace(/,/g, '')),
    faqs: nums[0],
    variations: nums[1],
    ready: await statNum(page, 'Indexing health', 'Ready'),
    waiting: await statNum(page, 'Indexing health', 'Waiting'),
    failed: await statNum(page, 'Indexing health', 'Failed'),
    matches: await statNum(page, 'Last 30 days', 'Customer messages checked'),
    answered: await statNum(page, 'Last 30 days', 'Answered'),
    tokens: await statNum(page, 'Last 30 days', 'Embedding tokens'),
  };
}

test.describe('platform FAQ engine: overview numbers', () => {
  test.describe('with workspace data', () => {
    test.beforeAll(async () => {
      ws = await poolWorkspace('A');
      await ws.enable(0.5);
      await ws.faq(`Where is the ${TAG} parcel`, [
        `${TAG} parcel tracking`,
        `${TAG} delivery status`,
      ]);
      await ws.faq(`How do I pay ${TAG}`, [`${TAG} payment methods`]);
      await waitReady(ws);
      // One answered and one unanswered inbound customer message through the simulator.
      const ch = await ws.call('POST', '/channels/simulator', {
        name: `${TAG} sim`,
        settings: { simulator: { latencyMs: { sent: 0, delivered: 150, read: 400 } } },
      });
      expect(ch.status, JSON.stringify(ch.body)).toBe(201);
      for (const [i, text] of [
        `Where is the ${TAG} parcel`,
        `qzxv wlkj ${TAG} nothing like any faq`,
      ].entries()) {
        const r = await ws.call('POST', `/dev/simulator/channels/${ch.body.id}/inbound`, {
          from: `9199${TAG.slice(-7)}${i}`,
          name: 'Cust',
          text,
        });
        expect(r.status, JSON.stringify(r.body)).toBe(202);
      }
      await expect
        .poll(
          () =>
            sqlNum(
              `SELECT count(*) FROM faq_match_logs WHERE org_id=${ws.orgId} AND origin='inbound' AND query LIKE '%${TAG}%'`,
            ),
          { timeout: 60_000 },
        )
        .toBe(2);
    });

    test.afterAll(() => cleanupTag(TAG));

    test('every status number agrees with the database', async ({ page }) => {
      expect(
        sqlNum(
          `SELECT count(*) FROM faq_match_logs WHERE query LIKE '%${TAG}%' AND outcome='answered'`,
        ),
      ).toBe(1);
      await signInOperator(page);
      await openFaq(page);
      await expect
        .poll(async () => JSON.stringify(await uiNumbers(page)), { timeout: 30_000 })
        .toBe(JSON.stringify(dbNumbers()));
      const n = dbNumbers();
      expect(n.faqs).toBeGreaterThanOrEqual(2);
      expect(n.matches).toBeGreaterThanOrEqual(2);
      expect(n.answered).toBeGreaterThanOrEqual(1);
      expect(n.tokens).toBeGreaterThan(0);
      // The answer rate is answered / checked, shown as a percentage.
      const rate = n.matches > 0 ? Math.round((n.answered / n.matches) * 100) : null;
      await expect(stat(page, 'Last 30 days', 'Answer rate')).toHaveText(`${rate}%`);
    });

    test('a failed vector shows in the failed count, the stale count and the workspace row', async ({
      page,
    }) => {
      const row = sql(
        `SELECT id FROM faq_variations WHERE org_id=${ws.orgId} AND faq_id IN (SELECT id FROM faqs WHERE question LIKE '%${TAG}%') ORDER BY id LIMIT 1`,
      );
      sql(
        `UPDATE faq_variations SET embed_state='failed', embed_attempts=5, embed_error='pw seeded failure' WHERE org_id=${ws.orgId} AND id=${row}`,
      );
      try {
        await signInOperator(page);
        await openFaq(page);
        await expect.poll(async () => (await uiNumbers(page)).failed).toBe(dbNumbers().failed);
        expect((await uiNumbers(page)).failed).toBeGreaterThanOrEqual(1);
        await page.getByRole('searchbox', { name: 'Search workspaces' }).fill(ws.name);
        const wsRow = page.getByRole('row', { name: new RegExp(ws.name) }).first();
        await expect(wsRow).toContainText(
          `${sqlNum(`SELECT count(*) FROM faq_variations WHERE org_id=${ws.orgId} AND embed_state='failed'`)} failed`,
        );
        await expect(page.getByRole('button', { name: 'Retry failed' })).toBeEnabled();
        // A vector made by a model other than the one in use counts as an older-model vector, not as ready.
        sql(
          `UPDATE faq_variations SET embedding_model='${GEMINI}' WHERE org_id=${ws.orgId} AND embed_state='ready' AND id <> ${row} AND faq_id IN (SELECT id FROM faqs WHERE question LIKE '%${TAG}%')`,
        );
        await page.reload();
        await openFaq(page);
        const stale = sqlNum(
          `SELECT count(*) FROM faq_variations WHERE embed_state='ready' AND embedding_model IS DISTINCT FROM '${LARGE}'`,
        );
        expect(stale).toBeGreaterThan(0);
        await expect(
          page.getByText(new RegExp(`${stale} vectors? (belongs?|belong) to an older model`)),
        ).toBeVisible();
        await expect.poll(async () => (await uiNumbers(page)).ready).toBe(dbNumbers().ready);
      } finally {
        sql(
          `UPDATE faq_variations SET embedding_model='${LARGE}' WHERE org_id=${ws.orgId} AND embed_state='ready' AND faq_id IN (SELECT id FROM faqs WHERE question LIKE '%${TAG}%')`,
        );
        sql(
          `UPDATE faq_variations SET embed_state='ready', embed_attempts=0, embed_error=NULL WHERE org_id=${ws.orgId} AND embed_state='failed' AND embedding IS NOT NULL`,
        );
      }
    });
  });

  test('the platform key shows Ready, then Missing with a link to AI provider keys, then Ready again', async ({
    page,
  }) => {
    const op = await operatorApi();
    try {
      await signInOperator(page);
      await openFaq(page);
      const card = page.getByRole('group', { name: 'Platform OpenRouter key' });
      await expect(card.getByText('Ready', { exact: true })).toBeVisible();
      await expect(card.getByRole('link')).toHaveCount(0);
      await withoutPlatformKey(op, async () => {
        await page.reload();
        await openFaq(page);
        await expect(card.getByText('Missing', { exact: true })).toBeVisible();
        const link = card.getByRole('link', { name: 'Add the key in AI provider keys' });
        await expect(link).toHaveAttribute('href', '/admin/api-keys');
        expect((await op.overview()).platformKeyReady).toBe(false);
      });
      await page.reload();
      await openFaq(page);
      await expect(card.getByText('Ready', { exact: true })).toBeVisible();
      expect((await op.overview()).platformKeyReady).toBe(true);
    } finally {
      await op.dispose();
    }
  });

  test('the engine card counts workspaces that switched FAQs on', async ({ page }) => {
    await signInOperator(page);
    await openFaq(page);
    const n = sqlNum(`SELECT count(*) FROM faq_settings WHERE enabled`);
    expect(n).toBeGreaterThanOrEqual(1);
    await expect(
      page.getByText(
        n === 1 ? '1 workspace has FAQs switched on' : `${n} workspaces have FAQs switched on`,
      ),
    ).toBeVisible();
  });
});

/** The real overview answer with some fields replaced (to reach states the data does not produce on demand). */
async function mockOverview(page: import('@playwright/test').Page, change: (o: any) => void) {
  await page.route('**/api/platform/faq', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    change(body);
    await route.fulfill({ response: res, json: body });
  });
}

test.describe('platform FAQ engine: overview states', () => {
  test.beforeEach(async ({ page }) => {
    await signInOperator(page);
  });

  test('nothing indexed yet: no progress bar, a dash for the rate, singular wording, large numbers grouped', async ({
    page,
  }) => {
    await mockOverview(page, (o) => {
      Object.assign(o.stats, {
        workspacesEnabled: 1,
        faqs: 0,
        variations: 0,
        ready: 0,
        pending: 0,
        failed: 0,
        staleModel: 0,
        matches30d: 0,
        answered30d: 0,
        embeddingTokens30d: 1234567,
      });
    });
    await openFaq(page);
    await expect(page.getByText('1 workspace has FAQs switched on')).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expect(page.getByText('Nothing is waiting to be indexed.')).toBeVisible();
    await expect(stat(page, 'Last 30 days', 'Answer rate')).toHaveText('-');
    await expect(stat(page, 'Last 30 days', 'Embedding tokens')).toHaveText('1,234,567');
    await expect(page.getByText('0 FAQs · 0 variations')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry failed', exact: true })).toBeDisabled();
  });

  test('one older-model vector uses the singular, several the plural, and none shows no chip', async ({
    page,
  }) => {
    await mockOverview(page, (o) => {
      o.stats.staleModel = 1;
    });
    await openFaq(page);
    await expect(
      page.getByText(
        '1 vector belongs to an older model and matches nothing until it is re-embedded',
      ),
    ).toBeVisible();
    await page.unroute('**/api/platform/faq');
    await mockOverview(page, (o) => {
      o.stats.staleModel = 3;
    });
    await page.reload();
    await openFaq(page);
    await expect(
      page.getByText(
        '3 vectors belong to an older model and match nothing until they are re-embedded',
      ),
    ).toBeVisible();
  });

  test('a configured model that is not on the allowed list is shown as such, not silently replaced', async ({
    page,
  }) => {
    await mockOverview(page, (o) => {
      o.config.embeddingModel = 'acme/unknown-embedding';
    });
    await openFaq(page);
    await expect(page.getByRole('group', { name: 'Embedding model in use' })).toContainText(
      'Not on the allowed list',
    );
    await expect(page.getByRole('combobox', { name: 'Embedding model' })).toHaveValue(
      'acme/unknown-embedding',
    );
    await expect(
      page.getByRole('option', { name: 'acme/unknown-embedding (not on the allowed list)' }),
    ).toHaveCount(1);
  });

  test('a failed first load shows the error with a request id and Try again recovers; the page has no settings meanwhile', async ({
    page,
  }) => {
    let fail = true;
    await page.route('**/api/platform/faq', (route) =>
      fail && route.request().method() === 'GET'
        ? route.fulfill({
            status: 500,
            contentType: 'application/problem+json',
            body: JSON.stringify({
              type: 'https://errors.crm.platform/internal',
              title: 'x',
              status: 500,
              code: 'INTERNAL_ERROR',
              requestId: 'pw-ov-1',
            }),
          })
        : route.continue(),
    );
    await page.goto('/admin/faq', { timeout: 120_000 });
    await expect(
      page.getByText('Something went wrong on our side. Try again in a moment.'),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('pw-ov-1')).toBeVisible();
    await expect(page.getByRole('switch')).toHaveCount(0);
    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('switch', { name: 'FAQ engine' })).toBeVisible();
  });

  test('an empty workspace list shows the empty state, not an empty table', async ({ page }) => {
    await page.route('**/api/platform/faq/workspaces*', (route) =>
      route.fulfill({ json: { data: [] } }),
    );
    await openFaq(page);
    await expect(page.getByText('No workspaces yet')).toBeVisible();
    await expect(page.getByText('Workspaces appear here once they exist.')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('an answer in an unexpected shape is reported as an error instead of showing undefined', async ({
    page,
  }) => {
    await mockOverview(page, (o) => {
      delete o.stats;
    });
    await page.goto('/admin/faq', { timeout: 120_000 });
    await expect(page.getByRole('heading', { name: 'FAQ engine', level: 1 })).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByText('undefined')).toHaveCount(0);
    await expect(page.getByText('NaN')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});
