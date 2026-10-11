import {
  call,
  expect,
  go,
  login,
  newWorkspace,
  open,
  putSettings,
  seedFaq,
  test,
  waitIndexed,
  type State,
  type Workspace,
} from './support';
import type { Page } from '@playwright/test';

/** `/faq/test`: what the bot would do with a message, in words and numbers. Fixture AI: shared words match, no shared words do not. */
let ws: Workspace;
let state: State;
let empty: Workspace;
let emptyState: State;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  ws = await newWorkspace('play');
  state = await login(browser, ws.email);
  await seedFaq(ws, {
    question: 'Where is my order?',
    answerText: 'Your order is on its way.',
    variations: ['track my order'],
  });
  await seedFaq(ws, {
    question: 'Where can I track a parcel?',
    answerText: 'Parcels are tracked under Orders.',
    variations: ['parcel tracking'],
  });
  await seedFaq(ws, {
    question: 'Reset my password',
    answerText: 'Use the forgot password link.',
    variations: ['forgot password'],
  });
  await waitIndexed(ws);
  await putSettings(ws, { minMargin: 0 });
  empty = await newWorkspace('playempty');
  emptyState = await login(browser, empty.email);
});

/** Types the message and presses Enter in the playground's box. */
async function ask(page: Page, text: string) {
  const box = page.getByLabel('Customer message');
  await box.fill(text);
  await box.press('Enter');
}
const verdict = (page: Page, title: string) => page.getByText(title, { exact: true }).first();

test('an exact phrase answers at 100% with the answer the customer would get', async ({
  browser,
  watch,
}) => {
  const { page } = await open(browser, state, watch);
  await go(page, '/faq/test');
  await expect(
    page.getByText('Type a message above and run it to see the decision.'),
  ).toBeVisible();
  await ask(page, 'WHERE is my   order?');
  await expect(verdict(page, 'Would answer')).toBeVisible();
  await expect(page.getByText('Exact match', { exact: true })).toBeVisible();
  await expect(page.getByText('100%').first()).toBeVisible();
  const winner = page.getByRole('region', { name: 'What the customer would get' });
  await expect(winner).toContainText('Where is my order?');
  await expect(winner).toContainText('Your order is on its way.');
  await expect(
    page.getByRole('img', { name: /^Score 100%, the bar to reach is \d+%$/ }).first(),
  ).toBeVisible();
  // The decision tells which model decided, how long it took, and the best candidates.
  await expect(page.getByText('Top matches')).toBeVisible();
  await expect(page.getByText(/Best$/).first()).toBeVisible();
});

test('a different wording is matched by meaning, a stranger is below the bar', async ({
  browser,
  watch,
}) => {
  const { page } = await open(browser, state, watch);
  await go(page, '/faq/test');
  await ask(page, 'password reset help');
  await expect(verdict(page, 'Would answer')).toBeVisible();
  await expect(page.getByText('Meaning match', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'What the customer would get' })).toContainText(
    'Use the forgot password link.',
  );

  await ask(page, 'weather forecast tomorrow');
  await expect(verdict(page, 'Below threshold')).toBeVisible();
  await expect(page.getByRole('region', { name: 'What the customer would get' })).toHaveCount(0);
});

test('two FAQs that score alike are ambiguous once a minimum lead is set', async ({
  browser,
  watch,
}) => {
  const own = await newWorkspace('playamb');
  const ownState = await login(browser, own.email);
  await seedFaq(own, { question: 'Track my order', answerText: 'A', variations: ['order status'] });
  await seedFaq(own, {
    question: 'Track a parcel',
    answerText: 'B',
    variations: ['parcel status'],
  });
  await waitIndexed(own);
  const { page } = await open(browser, ownState, watch);
  await go(page, '/faq/test');
  // No lead needed: the first one just wins.
  await ask(page, 'track');
  await expect(verdict(page, 'Would answer')).toBeVisible();

  await putSettings(own, { minMargin: 0.2 });
  await page.reload();
  await ask(page, 'track');
  await expect(verdict(page, 'Ambiguous')).toBeVisible();
  await expect(page.getByText('Lead over the runner-up')).toBeVisible();
  await expect(page.getByText(/0 points \(needs 20\)/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'What the customer would get' })).toHaveCount(0);
});

test('when the AI provider fails the decision falls back to spelling and says so', async ({
  browser,
  watch,
}) => {
  const { page } = await open(browser, state, watch);
  await go(page, '/faq/test');
  // Close to a saved phrasing: spelling similarity still finds it.
  await ask(page, 'where is my order [[fail]]');
  await expect(page.getByText('Spelling fallback', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Note:/)).toBeVisible();

  // Nothing near it: the failure is reported as such.
  await ask(page, 'qqq [[fail]] zzz');
  await expect(verdict(page, 'Provider error')).toBeVisible();
  await expect(page.getByText(/^Note:/)).toBeVisible();
  await expect(
    page.getByText('The AI provider could not be reached, so only spelling matching was possible.'),
  ).toBeVisible();
});

test('a message that is too short is explained', async ({ browser, watch }) => {
  const { page } = await open(browser, state, watch);
  await go(page, '/faq/test');
  await ask(page, 'a');
  await expect(verdict(page, 'Below threshold')).toBeVisible();
  await expect(page.getByText(/Too short to match/)).toBeVisible();
  await ask(page, '??');
  await expect(page.getByText(/Too short to match/)).toBeVisible();
});

test('a workspace with no FAQs says there is nothing to match', async ({ browser, watch }) => {
  const { page } = await open(browser, emptyState, watch);
  await go(page, '/faq/test');
  await ask(page, 'where is my order');
  await expect(verdict(page, 'No FAQs to match')).toBeVisible();
  await expect(page.getByText('There are no active FAQs with live phrasings yet.')).toBeVisible();
});

test('"Add this phrase as a variation" saves the tested message on that FAQ', async ({
  browser,
  watch,
}) => {
  const faq = await seedFaq(ws, { question: 'Do you sell gift cards?', answerText: 'Yes we do.' });
  await waitIndexed(ws);
  const { page } = await open(browser, state, watch);
  await go(page, '/faq/test');
  await ask(page, 'gift certificates available');
  const add = page.getByRole('button', {
    name: 'Add this phrase as a variation to Do you sell gift cards?',
  });
  await expect(add).toBeVisible();
  await add.click();
  await expect(page.getByText('Added as a phrasing of Do you sell gift cards?.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Added' })).toBeDisabled();
  const saved = (await call(ws, 'GET', `/v2/faq/entries/${faq.id}`)).body;
  expect(saved.variations.map((v: any) => v.text)).toContain('gift certificates available');
  expect(saved.variations.find((v: any) => v.text === 'gift certificates available').source).toBe(
    'manual',
  );
  await waitIndexed(ws);
  // Run it again: it is now an exact phrase.
  await ask(page, 'gift certificates available');
  await expect(page.getByText('Exact match', { exact: true })).toBeVisible();
});

test('the session keeps the last 10 tests, newest first, and a test is never counted in the insights', async ({
  browser,
  watch,
}) => {
  const own = await newWorkspace('playhist');
  const ownState = await login(browser, own.email);
  await seedFaq(own, { question: 'History seed', answerText: 'H.' });
  await waitIndexed(own);
  const { page } = await open(browser, ownState, watch);
  await go(page, '/faq/test');
  const history = page.getByRole('complementary', { name: 'This session' });
  await expect(history).toContainText('Your last 10 tests appear here.');
  for (let i = 1; i <= 11; i++) {
    await ask(page, `unrelated message number ${i}`);
    // A second Enter while a test is running is ignored, so wait for each result before the next message.
    await expect(history.getByRole('button').first()).toContainText(`number ${i}`);
  }
  await expect(history.getByRole('button')).toHaveCount(10);
  await expect(history.getByRole('button').first()).toContainText('unrelated message number 11');
  await expect(history.getByRole('button', { name: /number 1 / })).toHaveCount(0);
  await expect(history.getByRole('button', { name: /number 1$/ })).toHaveCount(0);
  // The same text again moves to the top instead of being listed twice.
  await ask(page, 'unrelated message number 5');
  await expect(history.getByRole('button').first()).toContainText('number 5');
  await expect(history.getByRole('button')).toHaveCount(10);
  await expect(history.getByRole('button').first()).toContainText('number 5');
  // Clicking an older one restores its text and its decision.
  await history.getByRole('button', { name: /number 9/ }).click();
  await expect(page.getByLabel('Customer message')).toHaveValue('unrelated message number 9');

  const summary = (await call(own, 'GET', '/v2/faq/insights/summary?days=30')).body;
  expect(summary.totals.messages).toBe(0);
  const unanswered = (await call(own, 'GET', '/v2/faq/insights/log?view=unanswered')).body;
  expect(unanswered.data).toHaveLength(0);
});

test('the Run button is off for an empty message and Enter submits', async ({ browser, watch }) => {
  const { page } = await open(browser, state, watch);
  await go(page, '/faq/test');
  await expect(page.getByRole('button', { name: 'Run' })).toBeDisabled();
  await page.getByLabel('Customer message').fill('   ');
  await expect(page.getByRole('button', { name: 'Run' })).toBeDisabled();
  await page.getByLabel('Customer message').fill('reset password');
  await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled();
  await page.getByLabel('Customer message').press('Enter');
  await expect(verdict(page, 'Would answer')).toBeVisible();
});
