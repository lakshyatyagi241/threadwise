import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

/**
 * The operator console's Product releases tab shows, for each pull request a release carries, what it changes and when it was raised,
 * in Indian time. Runs against the real API and database: one platform_releases row is written the way the deploy scripts write it and
 * removed afterwards. The browser is set to Los Angeles to show the time does not follow it.
 *
 * Needs the local stack and the Postgres container (override its name with E2E_PG_CONTAINER). Signs in as the local `support` operator
 * created with `pnpm --filter @crm/api operator:create`.
 */
const SUPPORT = { email: 'e2e-support@example.test', password: 'E2e-Console-Pass1' };
const PG = process.env.E2E_PG_CONTAINER ?? 'crm-platform-postgres';
const ATTEMPT = 'e2e00000-0000-4000-8000-000000000001';

function sql(statement: string) {
  execFileSync(
    'docker',
    ['exec', '-i', PG, 'sh', '-c', 'exec psql -X -q -U "$POSTGRES_USER" -d crm -v ON_ERROR_STOP=1'],
    { input: statement },
  );
}

test.use({ timezoneId: 'America/Los_Angeles', locale: 'en-US' });

test.beforeAll(() => {
  const changes = JSON.stringify([
    {
      pr: 823,
      title: 'Show PR details on releases',
      author: 'Vedant',
      body: 'Adds the PR description.\nShows when it was raised.',
      createdAt: '2026-10-26T08:15:00Z',
    },
    { pr: 824, title: 'An entry without details', author: 'Akshay', body: null, createdAt: null },
  ]);
  sql(`
    DELETE FROM platform_releases WHERE attempt = '${ATTEMPT}';
    INSERT INTO platform_releases (attempt, tag, state, started_at, updated_at, finished_at, changes)
    VALUES ('${ATTEMPT}', 'e2e0001', 'ok', now(), now(), now(), $json$${changes}$json$::jsonb);
  `);
});

test.afterAll(() => {
  sql(`DELETE FROM platform_releases WHERE attempt = '${ATTEMPT}';`);
});

test('a release shows each PR number, what it changes and when it was raised in IST', async ({
  page,
}) => {
  const res = await page.request.post('/api/platform-auth/login', { data: SUPPORT });
  expect(res.ok(), 'operator login').toBe(true);

  await page.goto('/admin/deployments');
  const row = page.getByRole('row').filter({ hasText: 'e2e0001' });
  await expect(row).toBeVisible();

  await expect(row).toContainText('#823');
  await expect(row).toContainText('Show PR details on releases');
  await expect(row).toContainText('#824');
  // Two lines per change: the description the API sends is not shown.
  await expect(row.getByTestId('release-description')).toHaveCount(0);
  await expect(row).not.toContainText('Adds the PR description.');
  // 08:15 UTC is 13:45 in India (UTC+5:30) while the browser is in Los Angeles.
  await expect(row.getByTestId('release-raised')).toHaveCount(1);
  await expect(row.getByTestId('release-raised')).toContainText('Oct 26, 2026');
  await expect(row.getByTestId('release-raised')).toContainText('1:45:00 PM IST');
});
