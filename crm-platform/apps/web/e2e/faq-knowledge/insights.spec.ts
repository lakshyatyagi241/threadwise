import {
  call,
  customerSays,
  expect,
  faqBase,
  logCount,
  login,
  newWorkspace,
  open,
  openFaqs,
  putSettings,
  repliesTo,
  seedFaq,
  seedFlow,
  simulator,
  type State,
  test,
  waitIndexed,
  type Workspace,
} from './support';
import type { Page } from '@playwright/test';

/** A flow's insights (the Insights screen of its FAQs tab): the numbers must agree with exactly what a simulated customer sent, and the log must explain each decision. */
let ws: Workspace;
let state: State;
let fresh: Workspace;
let freshState: State;
let n = 0;
const customer = () => `9196${String(Date.now()).slice(-6)}${String(++n).padStart(2, '0')}`;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  fresh = await newWorkspace('insfresh');
  freshState = await login(browser, fresh.email);

  ws = await newWorkspace('insights');
  state = await login(browser, ws.email);
  const sim = await simulator(ws);
  await seedFaq(ws, {
    question: 'Where is my order?',
    answerText: 'Ships tomorrow.',
    variations: ['track my order'],
  });
  await seedFaq(ws, {
    question: 'Talk to billing',
    flowId: seedFlow(ws, 'Pwins billing flow', 'Billing flow here.'),
  });
  await seedFaq(ws, { question: 'Never asked about this', answerText: 'Nobody asks.' });
  await waitIndexed(ws);
  await putSettings(ws, { enabled: true, threshold: 0.8 });

  const sent: Array<[string, string]> = [
    ['where is my order', 'a'],
    ['track my order', 'b'],
    ['talk to billing', 'c'],
    ['order cancellation', 'd'],
    ['completely unrelated words', 'e'],
  ];
  for (const [text] of sent) await customerSays(ws, sim, text, customer());
  await expect.poll(() => logCount(ws), { timeout: 40_000 }).toBe(5);
  await expect.poll(() => repliesTo(ws, '0').length).toBe(0);
});

const kpi = (page: Page) => page.getByRole('group', { name: 'Key numbers' });

test('a workspace with no traffic shows the empty insights', async ({ browser, watch }) => {
  const { page } = await open(browser, freshState, watch);
  await openFaqs(page, fresh, 'insights');
  await expect(page.getByText('No messages yet')).toBeVisible();
  await expect(kpi(page)).toHaveCount(0);
  await expect(page.getByText('No messages here yet.')).toBeVisible();
});

test('the key numbers and rankings agree with what was sent and with the API', async ({
  browser,
  watch,
}) => {
  const api = (await call(ws, 'GET', `${faqBase(ws)}/insights/summary?days=30`)).body;
  expect(api.totals).toMatchObject({
    messages: 5,
    answered: 2,
    flowStarted: 1,
    unanswered: 2,
    providerErrors: 0,
  });
  expect(api.answerRate).toBeCloseTo(0.6, 5);

  const { page } = await open(browser, state, watch);
  await openFaqs(page, ws, 'insights');
  const k = kpi(page);
  await expect(k).toBeVisible();
  const tile = (label: string) => k.getByText(label, { exact: true }).locator('..');
  await expect(tile('Messages checked')).toContainText('5');
  await expect(tile('Answer rate')).toContainText('60%');
  await expect(tile('Flows started')).toContainText('1');
  await expect(tile('Unanswered')).toContainText('2');
  await expect(tile('Unanswered')).toContainText('2 to review');
  await expect(tile('Provider errors')).toContainText('0');

  const top = page.getByRole('region', { name: 'Top FAQs' });
  await expect(top.getByRole('listitem').first()).toContainText('Where is my order?');
  await expect(top.getByRole('listitem').first()).toContainText('2 answers');
  await expect(top.getByRole('listitem').nth(1)).toContainText('Talk to billing');
  await expect(top.getByRole('listitem').nth(1)).toContainText('1 answer');
  await expect(page.getByRole('region', { name: 'Never matched' })).toContainText('1');

  // Ranges: each button is a toggle and the numbers stay (everything happened today).
  for (const days of [7, 30, 90]) {
    await page.getByRole('button', { name: `${days} days` }).click();
    await expect(page.getByRole('button', { name: `${days} days` })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(tile('Messages checked')).toContainText('5');
  }
});

test('the score histogram has a table view with the same counts', async ({ browser, watch }) => {
  const { page } = await open(browser, state, watch);
  await openFaqs(page, ws, 'insights');
  const hist = page.getByRole('region', { name: 'How well messages scored' });
  await expect(hist.getByRole('img', { name: /Histogram of match scores/ })).toBeVisible();
  await expect(hist.getByText('Threshold 80%')).toBeVisible();
  await hist.getByRole('button', { name: 'Show as table' }).click();
  const table = hist.getByRole('table', { name: 'Score distribution' });
  await expect(table).toBeVisible();
  const rows = await table
    .getByRole('row')
    .evaluateAll((trs) =>
      trs
        .slice(1)
        .map((tr) => Array.from(tr.querySelectorAll('th,td')).map((c) => c.textContent?.trim())),
    );
  const answered = rows.reduce((s, r) => s + Number(r[1]), 0);
  const unanswered = rows.reduce((s, r) => s + Number(r[2]), 0);
  expect(rows).toHaveLength(10);
  expect({ answered, unanswered }).toEqual({ answered: 3, unanswered: 2 });
  // The near miss (about 71%) sits in the 70-80% bucket, the exact phrases at the top.
  expect(rows.find((r) => r[0] === '70-80%')?.[2]).toBe('1');
  expect(rows.find((r) => r[0] === '90-100%')?.[1]).toBe('3');
  await hist.getByRole('button', { name: 'Show as chart' }).click();
  await expect(hist.getByRole('img', { name: /Histogram of match scores/ })).toBeVisible();

  const daily = page.getByRole('region', { name: 'Messages per day' });
  await daily.getByRole('button', { name: 'Show as table' }).click();
  await expect(daily.getByRole('table').getByRole('row').nth(-1)).toContainText('3');
});

test('the match log filters, searches, and expands a row to its candidates and scores', async ({
  browser,
  watch,
}) => {
  const { page } = await open(browser, state, watch);
  await openFaqs(page, ws, 'insights');
  const log = page.getByRole('region', { name: 'Match log' });
  const rows = log
    .locator('tbody > tr')
    .filter({ has: page.getByRole('button', { name: /details$/ }) });
  await expect(rows).toHaveCount(5);

  const views = log.getByRole('group', { name: 'Show' });
  await views.getByRole('button', { name: 'Answered', exact: true }).click();
  await expect(rows).toHaveCount(3);
  await views.getByRole('button', { name: 'Unanswered' }).click();
  await expect(rows).toHaveCount(2);
  await views.getByRole('button', { name: 'Errors' }).click();
  await expect(log.getByText('No messages here yet.')).toBeVisible();
  await views.getByRole('button', { name: 'All' }).click();
  await expect(rows).toHaveCount(5);

  await log.getByRole('searchbox', { name: 'Search the log' }).fill('CANCELLATION');
  await expect(rows).toHaveCount(1);
  const row = rows.first();
  await expect(row).toContainText('order cancellation');
  await expect(row).toContainText('Below threshold');
  await expect(row.getByText(/^7\d%$/)).toBeVisible();

  await row.getByRole('button', { name: 'Show details' }).click();
  await expect(row.getByRole('button', { name: 'Hide details' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  const detail = log.locator('tbody tr[id^="faq-log-"]');
  await expect(detail).toContainText('The best match scored');
  await expect(detail).toContainText('below the 80% bar');
  await expect(detail).toContainText('Where is my order?');
  await expect(detail).toContainText('matched on');
  await expect(detail).toContainText(/Tier: Meaning match/);
  await expect(detail).toContainText(/Model: \S+/);
  await expect(detail).toContainText(/Time: \d+ ms/);
  await row.getByRole('button', { name: 'Hide details' }).click();
  await expect(detail).toHaveCount(0);
});

test('a flow start and an answer are labelled differently in the log', async ({
  browser,
  watch,
}) => {
  const { page } = await open(browser, state, watch);
  await openFaqs(page, ws, 'insights');
  const log = page.getByRole('region', { name: 'Match log' });
  await log.getByRole('searchbox', { name: 'Search the log' }).fill('talk to billing');
  const row = log.locator('tbody > tr').first();
  await expect(row).toContainText('Talk to billing');
  await expect(row).toContainText('100%');
  await row.getByRole('button', { name: 'Show details' }).click();
  await expect(log.locator('tbody tr[id^="faq-log-"]')).toContainText(
    'Sent the customer to the step of "Talk to billing"',
  );
  await expect(log.locator('tbody tr[id^="faq-log-"]')).toContainText('Exact match');
});
