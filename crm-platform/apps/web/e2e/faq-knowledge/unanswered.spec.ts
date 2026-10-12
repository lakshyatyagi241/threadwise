import {
  call,
  customerSays,
  entries,
  expect,
  faqBase,
  logCount,
  login,
  newWorkspace,
  open,
  openFaqs,
  putSettings,
  reloadFaqs,
  repliesTo,
  seedFaq,
  type Sim,
  simulator,
  type State,
  test,
  waitIndexed,
  type Workspace,
} from './support';
import type { Page } from '@playwright/test';

/** Messages nobody answered: they show up with their near miss, and each can teach the bot, become a FAQ, or be dismissed. */
let ws: Workspace;
let state: State;
let sim: Sim;
let n = 0;
const customer = () => `9195${String(Date.now()).slice(-6)}${String(++n).padStart(2, '0')}`;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  ws = await newWorkspace('unans');
  state = await login(browser, ws.email);
  sim = await simulator(ws);
  await seedFaq(ws, {
    question: 'Where is my order?',
    answerText: 'Your order ships tomorrow.',
    variations: ['track my order'],
  });
  await seedFaq(ws, { question: 'Reset my password', answerText: 'Use the reset link.' });
  await waitIndexed(ws);
  // A high bar, so a message that shares one word with a phrasing is a near miss, not an answer.
  await putSettings(ws, { enabled: true, threshold: 0.8 });
});

const list = (page: Page) => page.getByRole('list', { name: 'Unanswered messages' });
const row = (page: Page, text: string) =>
  list(page).getByRole('listitem').filter({ hasText: text });

async function arrives(w: Workspace, text: string) {
  await expect
    .poll(() => logCount(w, `AND query='${text.replace(/'/g, "''")}'`), { timeout: 30_000 })
    .toBeGreaterThan(0);
}

test('an unanswered message appears with its closest FAQ, and teaching it makes the next one answered', async ({
  browser,
  watch,
}) => {
  const text = 'order cancellation';
  const from = customer();
  await customerSays(ws, sim, text, from);
  await arrives(ws, text);
  expect(repliesTo(ws, from)).toEqual([]);

  const { page } = await open(browser, state, watch);
  await openFaqs(page, ws, 'unanswered');
  const item = row(page, text);
  await expect(item).toBeVisible();
  await expect(item).toContainText('Closest FAQ:');
  await expect(item).toContainText('Where is my order?');
  await expect(item.getByText(/^7\d%$/).first()).toBeVisible();
  await expect(item.getByText(/The best match scored 7\d%, below the 80% bar/)).toBeVisible();
  // The tab carries the count of messages waiting.
  await expect(
    page.getByRole('navigation', { name: 'FAQ sections' }).getByLabel(/unanswered messages?$/),
  ).toBeVisible();

  await item.getByRole('button', { name: 'Add to an FAQ' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add this message to which FAQ?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('searchbox', { name: 'Search FAQs' }).fill('password');
  await expect(dialog.getByRole('button', { name: 'Reset my password' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Where is my order?' })).toHaveCount(0);
  await dialog.getByRole('searchbox', { name: 'Search FAQs' }).fill('where');
  await dialog.getByRole('button', { name: 'Where is my order?' }).click();

  await expect(
    page.getByText('Added to "Where is my order?". It will be answered from now on.'),
  ).toBeVisible();
  await expect(row(page, text)).toHaveCount(0);
  const faq = (await entries(ws)).data.find((e: any) => e.question === 'Where is my order?');
  const full = (await call(ws, 'GET', `${faqBase(ws)}/entries/${faq.id}`)).body;
  expect(full.variations.find((v: any) => v.text === text)?.source).toBe('learned');

  // Once indexed (or at once, as an exact phrase) the same words get the FAQ's answer.
  const again = customer();
  await customerSays(ws, sim, text, again);
  await expect
    .poll(() => repliesTo(ws, again), { timeout: 30_000 })
    .toEqual(['Your order ships tomorrow.']);
  // The earlier unanswered rows with the same text are all resolved.
  await reloadFaqs(page);
  await expect(row(page, text)).toHaveCount(0);
});

test('"Create FAQ from this" fills the editor, and saving resolves the message', async ({
  browser,
  watch,
}) => {
  const text = 'refund for damaged parcel';
  await customerSays(ws, sim, text, customer());
  await arrives(ws, text);
  const { page } = await open(browser, state, watch);
  await openFaqs(page, ws, 'unanswered');
  await row(page, text).getByRole('button', { name: 'Create FAQ from this' }).click();

  await expect(page).toHaveURL(/[?&]view=new/);
  await expect(
    page.getByText('The question was filled in from an unanswered customer message.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Question', exact: true })).toHaveValue(text);
  await page.getByLabel('Answer text').fill('Refunds for damaged parcels take five days.');
  await page.getByRole('button', { name: 'Create FAQ' }).click();
  await expect(page.getByText('FAQ created.')).toBeVisible();

  await openFaqs(page, ws, 'unanswered');
  await expect(page.getByRole('heading', { name: 'Unanswered messages', level: 1 })).toBeVisible();
  await expect(row(page, text)).toHaveCount(0);
  const log = (await call(ws, 'GET', `${faqBase(ws)}/insights/log?view=unanswered&limit=100`)).body;
  expect(log.data.map((r: any) => r.query)).not.toContain(text);
});

test('Dismiss removes the message and it stays gone after a reload', async ({ browser, watch }) => {
  const text = 'qwerty zxcvb gibberish';
  await customerSays(ws, sim, text, customer());
  await arrives(ws, text);
  const { page } = await open(browser, state, watch);
  await openFaqs(page, ws, 'unanswered');
  await expect(row(page, text)).toBeVisible();
  await row(page, text).getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByText('Message dismissed.')).toBeVisible();
  await expect(row(page, text)).toHaveCount(0);
  await reloadFaqs(page);
  await expect(page.getByRole('heading', { name: 'Unanswered messages', level: 1 })).toBeVisible();
  await expect(row(page, text)).toHaveCount(0);
});

test('the search box narrows the list, and an empty list says nothing is waiting', async ({
  browser,
  watch,
}) => {
  const own = await newWorkspace('unanssearch');
  const ownState = await login(browser, own.email);
  const ownSim = await simulator(own);
  await seedFaq(own, { question: 'Opening hours', answerText: 'Nine to five.' });
  await waitIndexed(own);
  await putSettings(own, { enabled: true, threshold: 0.9 });
  const { page } = await open(browser, ownState, watch);
  await openFaqs(page, own, 'unanswered');
  await expect(page.getByText('Nothing waiting')).toBeVisible();

  for (const t of ['alpha unique words', 'beta unique words']) {
    await customerSays(own, ownSim, t, customer());
    await arrives(own, t);
  }
  await reloadFaqs(page);
  await expect(list(page).getByRole('listitem')).toHaveCount(2);
  await page.getByRole('searchbox', { name: 'Search unanswered messages' }).fill('BETA');
  await expect(list(page).getByRole('listitem')).toHaveCount(1);
  await page
    .getByRole('searchbox', { name: 'Search unanswered messages' })
    .fill('nothing like this');
  await expect(page.getByText('No message matches your search')).toBeVisible();
});

test('with customer messages not kept, the text is hidden and teaching is not offered', async ({
  browser,
  watch,
}) => {
  const own = await newWorkspace('unansprivate');
  const ownState = await login(browser, own.email);
  const ownSim = await simulator(own);
  await seedFaq(own, { question: 'Opening hours', answerText: 'Nine to five.' });
  await waitIndexed(own);
  await putSettings(own, { enabled: true, threshold: 0.9, logQueries: false });
  const secret = 'my secret account number 12345';
  await customerSays(own, ownSim, secret, customer());
  await expect
    .poll(() => logCount(own, "AND outcome='below_threshold'"), { timeout: 30_000 })
    .toBeGreaterThan(0);

  const { page } = await open(browser, ownState, watch);
  await openFaqs(page, own, 'unanswered');
  await expect(page.getByText('Message text not kept (query logging is off)')).toBeVisible();
  await expect(page.getByText(secret)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add to an FAQ' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create FAQ from this' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Dismiss' })).toBeVisible();

  // The insights log keeps the score and the length, never the words.
  await openFaqs(page, own, 'insights');
  await expect(page.getByText(secret)).toHaveCount(0);
  await expect(page.getByText(`Not kept (${secret.length} characters)`)).toBeVisible();
  const log = (await call(own, 'GET', `${faqBase(own)}/insights/log?view=all`)).body;
  expect(JSON.stringify(log)).not.toContain('secret account');
  // The API refuses to learn from it as well.
  const id = log.data[0].id;
  const faq = (await entries(own)).data[0];
  const learn = await call(own, 'POST', `${faqBase(own)}/insights/log/${id}/learn`, {
    faqId: faq.id,
  });
  expect(learn.status).toBeGreaterThanOrEqual(400);
});
