import { expect, test, type Page } from '@playwright/test';
import {
  cleanupTag,
  LAUNCH,
  openFaq,
  poolWorkspace,
  runTag,
  signInOperator,
  sql,
  sqlNum,
  waitReady,
} from './admin-support';

test.use({ launchOptions: LAUNCH });
test.setTimeout(240_000);

interface Row {
  name: string;
  enabled: boolean;
  faqs: number;
  variations: number;
  pending: number;
  failed: number;
  matches: number;
  answered: number;
}

/**
 * The documented ordering (switched on first, then most variations, then oldest), straight from the tables. FAQs belong to flows, so
 * a workspace's numbers add up over its flows and it counts as switched on when any of its flows is.
 */
function dbRows(limit: number, search = ''): Row[] {
  const like = search
    ? `'%${search.replace(/[\\%_]/g, (m) => `\\${m}`).replace(/'/g, "''")}%'`
    : null;
  const out = sql(`
    SELECT o.name || '|' || EXISTS (SELECT 1 FROM faq_settings s WHERE s.org_id=o.id AND s.enabled) || '|' ||
      (SELECT count(*) FROM faqs f WHERE f.org_id=o.id) || '|' ||
      (SELECT count(*) FROM faq_variations v WHERE v.org_id=o.id) || '|' ||
      (SELECT count(*) FROM faq_variations v WHERE v.org_id=o.id AND v.embed_state='pending') || '|' ||
      (SELECT count(*) FROM faq_variations v WHERE v.org_id=o.id AND v.embed_state='failed') || '|' ||
      (SELECT count(*) FROM faq_match_logs l WHERE l.org_id=o.id AND l.origin='inbound' AND l.created_at >= now() - interval '30 days') || '|' ||
      (SELECT count(*) FROM faq_match_logs l WHERE l.org_id=o.id AND l.origin='inbound' AND l.outcome IN ('answered','flow_started') AND l.created_at >= now() - interval '30 days')
    FROM organizations o
    WHERE ${like ? `o.name ILIKE ${like}` : 'true'}
    ORDER BY EXISTS (SELECT 1 FROM faq_settings s WHERE s.org_id=o.id AND s.enabled) DESC, (SELECT count(*) FROM faq_variations v WHERE v.org_id=o.id) DESC, o.id
    LIMIT ${limit}`);
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [name, enabled, faqs, variations, pending, failed, matches, answered] = l.split('|');
      return {
        name,
        enabled: enabled === 'true',
        faqs: +faqs,
        variations: +variations,
        pending: +pending,
        failed: +failed,
        matches: +matches,
        answered: +answered,
      };
    });
}

const table = (page: Page) => page.getByRole('table', { name: 'Workspaces by FAQ activity' });
const search = (page: Page) => page.getByRole('searchbox', { name: 'Search workspaces' });
const limitSel = (page: Page) => page.getByRole('combobox', { name: 'Rows' });
const bodyRows = (page: Page) => table(page).locator('tbody tr');
/** React strict mode (dev) fires and aborts the first request of a mount; consecutive repeats are that, not extra calls. */
const dedupe = <T>(xs: T[]) => xs.filter((x, i) => i === 0 || x !== xs[i - 1]);
const isList = (r: { url: () => string }) =>
  new URL(r.url()).pathname === '/api/platform/faq/workspaces';

async function uiRows(page: Page): Promise<Row[]> {
  return bodyRows(page).evaluateAll((trs) =>
    trs.map((tr) => {
      const num = (s: string) => Number(s.replace(/[^0-9]/g, ''));
      const cells = Array.from(tr.querySelectorAll('td')).map((c) => c.textContent ?? '');
      const idx = cells[3] ?? '';
      return {
        name: tr.querySelector('th')?.textContent ?? '',
        enabled: cells[0] === 'On',
        faqs: num(cells[1]),
        variations: num(cells[2]),
        pending: /(\d[\d,]*) waiting/.test(idx) ? num(idx.match(/(\d[\d,]*) waiting/)![1]) : 0,
        failed: /(\d[\d,]*) failed/.test(idx) ? num(idx.match(/(\d[\d,]*) failed/)![1]) : 0,
        matches: num(cells[4]),
        answered: num(cells[5].split('(')[0]),
      };
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await signInOperator(page);
});

test.describe('workspaces table', () => {
  test("a workspace's numbers add up over its flows, and it is switched on when any flow is", async ({
    page,
  }) => {
    const ws = await poolWorkspace('B');
    const TAG = runTag('pwadmflows');
    const second = ws.newFlow(`${TAG} second flow`);
    try {
      await ws.disable();
      await ws.disable(second);
      await ws.faq(`${TAG} first flow question`, [`${TAG} first phrase`]);
      await ws.faq(
        `${TAG} second flow question`,
        [`${TAG} second phrase`, `${TAG} third phrase`],
        'Answer',
        second,
      );
      await waitReady(ws);
      // Both flows have FAQs, none is switched on: the workspace is off and still counts everything it has.
      await openFaq(page);
      await search(page).fill(ws.name);
      await expect.poll(async () => (await uiRows(page)).map((r) => r.name)).toEqual([ws.name]);
      let row = (await uiRows(page))[0]!;
      expect(row).toEqual(dbRows(1, ws.name)[0]);
      expect(row.enabled).toBe(false);
      const perFlow = sql(
        `SELECT count(*) FROM faqs WHERE org_id=${ws.orgId} AND owner_flow_id IN (SELECT id FROM flows WHERE org_id=${ws.orgId} AND uuid IN ('${ws.flowUuid}','${second}'))`,
      );
      expect(row.faqs).toBe(Number(perFlow));
      expect(row.faqs).toBeGreaterThanOrEqual(2);

      // One flow of the two switched on is enough for the workspace to be on; the numbers do not change.
      await ws.enable(0.5, second);
      await page.reload();
      await search(page).fill(ws.name);
      await expect.poll(async () => (await uiRows(page)).map((r) => r.name)).toEqual([ws.name]);
      await expect.poll(async () => (await uiRows(page))[0]?.enabled).toBe(true);
      row = (await uiRows(page))[0]!;
      expect(row).toEqual(dbRows(1, ws.name)[0]);
      expect(row.faqs).toBe(Number(perFlow));
    } finally {
      await ws.disable(second).catch(() => undefined);
      cleanupTag(TAG);
      // The extra flow goes too (its FAQs and settings go with it).
      sql(`DELETE FROM flows WHERE org_id=${ws.orgId} AND uuid='${second}'`);
    }
  });

  test('lists workspaces in the documented order with numbers that match the database', async ({
    page,
  }) => {
    await openFaq(page);
    await expect(bodyRows(page).first()).toBeVisible();
    await expect
      .poll(async () => (await uiRows(page)).length)
      .toBe(Math.min(25, sqlNum('SELECT count(*) FROM organizations')));
    expect(await uiRows(page)).toEqual(dbRows(25));
    // Switched-on workspaces come before the rest.
    const rows = await uiRows(page);
    const firstOff = rows.findIndex((r) => !r.enabled);
    if (firstOff > -1) expect(rows.slice(firstOff).every((r) => !r.enabled)).toBe(true);
    await expect(table(page).getByRole('columnheader')).toHaveText([
      'Workspace',
      'FAQs',
      'FAQs written',
      'Variations',
      'Indexing',
      'Matches (30 days)',
      'Answered (30 days)',
    ]);
  });

  test('the rows selector offers 10, 25, 50 and 100 and sends the limit', async ({ page }) => {
    const limits: string[] = [];
    page.on(
      'request',
      (r) => isList(r) && limits.push(new URL(r.url()).searchParams.get('limit') ?? ''),
    );
    await openFaq(page);
    await expect(bodyRows(page).first()).toBeVisible();
    await expect(limitSel(page).getByRole('option')).toHaveText([
      '10 rows',
      '25 rows',
      '50 rows',
      '100 rows',
    ]);
    await expect(limitSel(page)).toHaveValue('25');
    await limitSel(page).selectOption('10');
    await expect
      .poll(async () => (await uiRows(page)).length)
      .toBe(Math.min(10, sqlNum('SELECT count(*) FROM organizations')));
    expect(await uiRows(page)).toEqual(dbRows(10));
    await limitSel(page).selectOption('100');
    await expect
      .poll(async () => (await uiRows(page)).length)
      .toBe(Math.min(100, sqlNum('SELECT count(*) FROM organizations')));
    expect(dedupe(limits)).toEqual(['25', '10', '100']);
  });

  test('typing a name searches once after a pause, case-insensitively, and trims spaces', async ({
    page,
  }) => {
    const searches: Array<string | null> = [];
    page.on(
      'request',
      (r) => isList(r) && searches.push(new URL(r.url()).searchParams.get('search')),
    );
    await openFaq(page);
    await expect(bodyRows(page).first()).toBeVisible();
    searches.length = 0;
    await search(page).pressSequentially('  PWADM ', { delay: 60 });
    await expect.poll(() => searches.length, { timeout: 10_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(800);
    expect(dedupe(searches)).toEqual(['PWADM']);
    const expected = dbRows(25, 'PWADM');
    await expect
      .poll(async () => (await uiRows(page)).map((r) => r.name))
      .toEqual(expected.map((r) => r.name));
    // Clearing the box goes back to the full list.
    await search(page).fill('   ');
    await expect.poll(async () => (await uiRows(page)).length).toBe(dbRows(25).length);
  });

  test('a search with no result shows the empty state with a Clear search button', async ({
    page,
  }) => {
    await openFaq(page);
    await search(page).fill('zzz-no-such-workspace-zzz');
    await expect(page.getByText('No workspace matches that search')).toBeVisible();
    await expect(table(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(search(page)).toHaveValue('');
    await expect(bodyRows(page).first()).toBeVisible();
  });

  test('"%" and "_" are searched literally, not as wildcards', async ({ page }) => {
    const ws = await poolWorkspace('B');
    const original = ws.name;
    const odd = `pwadm 100%_sure ${Date.now()}`;
    sql(`UPDATE organizations SET name='${odd}' WHERE id=${ws.orgId}`);
    try {
      await openFaq(page);
      await search(page).fill('%');
      await expect
        .poll(async () => (await uiRows(page)).map((r) => r.name))
        .toEqual(dbRows(25, '%').map((r) => r.name));
      expect((await uiRows(page)).map((r) => r.name)).toContain(odd);
      expect((await uiRows(page)).every((r) => r.name.includes('%'))).toBe(true);
      await search(page).fill('100%_sure');
      await expect.poll(async () => (await uiRows(page)).map((r) => r.name)).toEqual([odd]);
      await search(page).fill('_');
      await expect
        .poll(async () => (await uiRows(page)).every((r) => r.name.includes('_')))
        .toBe(true);
      await search(page).fill('100%x');
      await expect(page.getByText('No workspace matches that search')).toBeVisible();
      await search(page).fill(`100_`);
      await expect(page.getByText('No workspace matches that search')).toBeVisible();
    } finally {
      sql(`UPDATE organizations SET name='${original}' WHERE id=${ws.orgId}`);
    }
  });

  test('the search box limits itself to 100 characters', async ({ page }) => {
    await openFaq(page);
    await expect(search(page)).toHaveAttribute('maxlength', '100');
  });

  test('a failed first load shows an error with a request id and Try again recovers', async ({
    page,
  }) => {
    let fail = true;
    await page.route('**/api/platform/faq/workspaces*', (route) =>
      fail
        ? route.fulfill({
            status: 500,
            contentType: 'application/problem+json',
            headers: { 'x-request-id': 'pw-req-123' },
            body: JSON.stringify({
              type: 'https://errors.crm.platform/internal',
              title: 'Internal',
              status: 500,
              code: 'INTERNAL_ERROR',
              requestId: 'pw-req-123',
            }),
          })
        : route.continue(),
    );
    await openFaq(page);
    const workspaces = page
      .getByRole('heading', { name: 'Workspaces' })
      .locator('xpath=ancestor::*[contains(@class,"space-y-4")][1]');
    await expect(
      workspaces.getByText('Something went wrong on our side. Try again in a moment.'),
    ).toBeVisible();
    await expect(workspaces.getByText('pw-req-123')).toBeVisible();
    await expect(table(page)).toHaveCount(0);
    // The rest of the page still works.
    await expect(page.getByRole('region', { name: 'Engine status' })).toBeVisible();
    fail = false;
    await workspaces.getByRole('button', { name: 'Try again' }).click();
    await expect(bodyRows(page).first()).toBeVisible();
    await expect(workspaces.getByText('Something went wrong')).toHaveCount(0);
  });

  test('a failed search shows the error and Try again repeats that same search', async ({
    page,
  }) => {
    await openFaq(page);
    await expect(bodyRows(page).first()).toBeVisible();
    let fail = true;
    const seen: Array<string | null> = [];
    await page.route('**/api/platform/faq/workspaces*', (route) => {
      seen.push(new URL(route.request().url()).searchParams.get('search'));
      return fail
        ? route.fulfill({
            status: 503,
            contentType: 'application/problem+json',
            body: JSON.stringify({
              type: 'https://errors.crm.platform/unavailable',
              title: 'x',
              status: 503,
              code: 'UNAVAILABLE',
            }),
          })
        : route.continue();
    });
    await search(page).fill('pwadm');
    await expect(
      page.getByText('Something went wrong on our side. Try again in a moment.'),
    ).toBeVisible();
    await expect(table(page)).toHaveCount(0);
    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(bodyRows(page).first()).toBeVisible();
    expect(new Set(seen)).toEqual(new Set(['pwadm']));
    await expect
      .poll(async () => (await uiRows(page)).map((r) => r.name))
      .toEqual(dbRows(25, 'pwadm').map((r) => r.name));
  });

  test('an offline network shows the connection message', async ({ page }) => {
    await page.route('**/api/platform/faq/workspaces*', (route) => route.abort('connectionfailed'));
    await openFaq(page);
    await expect(
      page.getByText('Could not reach the server. Check your connection and try again.'),
    ).toBeVisible();
  });
});
