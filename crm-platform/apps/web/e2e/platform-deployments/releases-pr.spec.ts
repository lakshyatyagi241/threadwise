import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

/**
 * The operator console's Product releases tab shows the pull request behind each release: its number, what it changes and when it was
 * raised, in Indian time. Runs against the real API and database: two platform_releases rows are written the way the deploy scripts
 * write them (one with a PR, one without) and removed afterwards. The browser is set to Los Angeles to show the time does not follow it.
 *
 * Needs the local stack and the Postgres container (override its name with E2E_PG_CONTAINER). Signs in as the local `support` operator
 * created with `pnpm --filter @crm/api operator:create`.
 */
const SUPPORT = { email: 'e2e-support@example.test', password: 'E2e-Console-Pass1' };
const PG = process.env.E2E_PG_CONTAINER ?? 'crm-platform-postgres';
const WITH_PR = 'e2e00000-0000-4000-8000-000000000001';
const NO_PR = 'e2e00000-0000-4000-8000-000000000002';

function sql(statement: string) {
  execFileSync(
    'docker',
    ['exec', '-i', PG, 'sh', '-c', 'exec psql -X -q -U "$POSTGRES_USER" -d crm -v ON_ERROR_STOP=1'],
    { input: statement },
  );
}

test.use({ timezoneId: 'America/Los_Angeles', locale: 'en-US' });

test.beforeAll(() => {
  sql(`
    DELETE FROM platform_releases WHERE attempt IN ('${WITH_PR}', '${NO_PR}');
    INSERT INTO platform_releases (attempt, tag, state, started_at, updated_at, finished_at,
                                   pr_number, pr_title, pr_body, pr_created_at)
    VALUES ('${WITH_PR}', 'e2e0001', 'ok', now(), now(), now(), 823, 'Show PR details on releases',
            $$Adds the PR number to each release.
Shows what the change does.$$, '2026-10-26T08:15:00Z'),
           ('${NO_PR}', 'e2e0002', 'ok', now() - interval '1 minute', now(), now(), NULL, NULL, NULL, NULL);
  `);
});

test.afterAll(() => {
  sql(`DELETE FROM platform_releases WHERE attempt IN ('${WITH_PR}', '${NO_PR}');`);
});

test('a release shows its PR number, description and raised time in IST', async ({ page }) => {
  const res = await page.request.post('/api/platform-auth/login', { data: SUPPORT });
  expect(res.ok(), 'operator login').toBe(true);

  await page.goto('/admin/deployments');
  const row = page.getByRole('row').filter({ hasText: 'e2e0001' });
  await expect(row).toBeVisible();

  await expect(row.getByTestId('release-pr')).toContainText('#823');
  await expect(row.getByTestId('release-pr')).toContainText('Show PR details on releases');
  await expect(row.getByTestId('release-description')).toContainText(
    'Adds the PR number to each release.',
  );
  await expect(row.getByTestId('release-description')).toContainText('Shows what the change does.');
  // 08:15 UTC is 13:45 in India (UTC+5:30) while the browser is in Los Angeles.
  await expect(row.getByTestId('release-raised')).toContainText('Oct 26, 2026');
  await expect(row.getByTestId('release-raised')).toContainText('1:45:00 PM IST');
});

test('a release with no PR on record says so', async ({ page }) => {
  await page.request.post('/api/platform-auth/login', { data: SUPPORT });
  await page.goto('/admin/deployments');
  const row = page.getByRole('row').filter({ hasText: 'e2e0002' });
  await expect(row).toBeVisible();
  await expect(row.getByTestId('release-pr')).toContainText('No pull request on record');
  await expect(row.getByTestId('release-raised')).toContainText('No pull request on record');
});
