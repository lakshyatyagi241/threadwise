import {
  entries,
  expect,
  login,
  newWorkspace,
  open,
  openFaqs,
  seedFaq,
  type State,
  test,
  type Workspace,
} from './support';

/** The FAQ list of a flow (its FAQs tab): search, filters, the status switch, row actions, paging and bulk actions. */
let ws: Workspace;
let state: State;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  ws = await newWorkspace('list');
  state = await login(browser, ws.email);
  await seedFaq(ws, {
    question: 'Refund policy',
    category: 'Billing',
    answerText: 'Refunds take five days.',
    variations: ['money back', '100% refund', 'refund_policy_v2'],
  });
  await seedFaq(ws, {
    question: 'Opening hours',
    category: 'Support',
    status: 'paused',
    answerText: 'We open at nine.',
    variations: ['when are you open'],
  });
  await seedFaq(ws, {
    question: 'Shipping time',
    category: 'Shipping',
    answerText: 'Delivery takes two days.',
    variations: ['how long is delivery'],
  });
});

const rows = (page: import('@playwright/test').Page) => page.locator('tbody tr');
const rowOf = (page: import('@playwright/test').Page, question: string) =>
  page.locator('tbody tr').filter({ has: page.getByRole('link', { name: question, exact: true }) });

test.describe('search and filters', () => {
  test('search finds questions and phrasings, ignoring case, and treats % and _ literally', async ({
    browser,
    watch,
  }) => {
    const { page } = await open(browser, state, watch);
    await openFaqs(page, ws);
    await expect(rows(page)).toHaveCount(3);
    const search = page.getByLabel('Search FAQs');

    await search.fill('REFUND');
    await expect(rows(page)).toHaveCount(1);
    await expect(rowOf(page, 'Refund policy')).toBeVisible();

    // A variation's text finds its FAQ.
    await search.fill('when are YOU open');
    await expect(rows(page)).toHaveCount(1);
    await expect(rowOf(page, 'Opening hours')).toBeVisible();

    // (Answers are not searched: the API looks at the question and its phrasings.) Another phrasing finds its FAQ.
    await search.fill('how long is delivery');
    await expect(rows(page)).toHaveCount(1);
    await expect(rowOf(page, 'Shipping time')).toBeVisible();

    // `%` is a literal percent sign, not "anything": only the FAQ with "100%" matches.
    await search.fill('%');
    await expect(rows(page)).toHaveCount(1);
    await expect(rowOf(page, 'Refund policy')).toBeVisible();
    // `_` is a literal underscore, not "any one character".
    await search.fill('_');
    await expect(rows(page)).toHaveCount(1);
    await expect(rowOf(page, 'Refund policy')).toBeVisible();
    await search.fill('refund_policy');
    await expect(rows(page)).toHaveCount(1);
    await search.fill('refund policy_');
    await expect(page.getByText('No FAQ matches these filters')).toBeVisible();

    // Clearing the filters brings every FAQ back.
    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    await expect(rows(page)).toHaveCount(3);
    await expect(search).toHaveValue('');
  });

  test('status and category filters narrow the list and combine', async ({ browser, watch }) => {
    const { page } = await open(browser, state, watch);
    await openFaqs(page, ws);
    await expect(rows(page)).toHaveCount(3);

    await page.getByLabel('Status').selectOption({ label: 'Paused' });
    await expect(rows(page)).toHaveCount(1);
    await expect(rowOf(page, 'Opening hours')).toBeVisible();

    await page.getByLabel('Status').selectOption({ label: 'Active' });
    await expect(rows(page)).toHaveCount(2);
    await expect(rowOf(page, 'Opening hours')).toHaveCount(0);

    await page.getByLabel('Category').selectOption({ label: 'Shipping' });
    await expect(rows(page)).toHaveCount(1);
    await expect(rowOf(page, 'Shipping time')).toBeVisible();

    // Paused + Shipping: nothing, and the empty message offers the way out.
    await page.getByLabel('Status').selectOption({ label: 'Paused' });
    await expect(page.getByText('No FAQ matches these filters')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).last().click();
    await expect(rows(page)).toHaveCount(3);
  });
});

test.describe('row actions', () => {
  test('the status switch pauses and activates, with a toast and the saved status', async ({
    browser,
    watch,
  }) => {
    const faq = await seedFaq(ws, { question: 'Toggle me please', answerText: 'Toggled.' });
    const { page } = await open(browser, state, watch);
    await openFaqs(page, ws);
    await page.getByLabel('Search FAQs').fill('Toggle me please');
    const row = rowOf(page, 'Toggle me please');
    const sw = row.getByRole('switch', { name: 'Active: Toggle me please' });
    await expect(sw).toBeChecked();

    await sw.click();
    await expect(page.getByText('FAQ paused.')).toBeVisible();
    await expect(sw).not.toBeChecked();
    await expect(row.getByText('Paused', { exact: true })).toBeVisible();
    await expect
      .poll(async () => (await entries(ws)).data.find((e: any) => e.id === faq.id).status)
      .toBe('paused');

    await sw.click();
    await expect(page.getByText('FAQ activated.')).toBeVisible();
    await expect(sw).toBeChecked();
    await expect
      .poll(async () => (await entries(ws)).data.find((e: any) => e.id === faq.id).status)
      .toBe('active');
  });

  test('delete asks first: cancel keeps the FAQ, confirm removes it', async ({
    browser,
    watch,
  }) => {
    const faq = await seedFaq(ws, { question: 'Delete this one', answerText: 'Bye.' });
    await seedFaq(ws, { question: 'Keep this neighbour', answerText: 'Stay.' });
    const { page } = await open(browser, state, watch);
    await openFaqs(page, ws);
    await page.getByLabel('Search FAQs').fill('this');
    await expect(rowOf(page, 'Delete this one')).toBeVisible();

    const trigger = page.getByRole('button', { name: 'Delete Delete this one' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Delete this FAQ?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      '"Delete this one" and all its phrasings will be deleted for good.',
    );
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(rowOf(page, 'Delete this one')).toBeVisible();
    // Focus goes back to the control that opened the dialog.
    await expect(trigger).toBeFocused();
    expect((await entries(ws)).data.some((e: any) => e.id === faq.id)).toBe(true);

    await trigger.click();
    await page
      .getByRole('dialog', { name: 'Delete this FAQ?' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(page.getByText('FAQ deleted.')).toBeVisible();
    await expect(rowOf(page, 'Delete this one')).toHaveCount(0);
    await expect(rowOf(page, 'Keep this neighbour')).toBeVisible();
    expect((await entries(ws)).data.some((e: any) => e.id === faq.id)).toBe(false);
    // After the row is gone, focus is somewhere inside the page, not lost on <body>.
    const active = await page.evaluate(() => document.activeElement?.tagName ?? 'none');
    expect(active, 'focus after deleting a row').not.toBe('BODY');
  });

  test('the question and the edit icon both open the editor', async ({ browser, watch }) => {
    const faq = await seedFaq(ws, { question: 'Open me', answerText: 'Opened.' });
    const { page } = await open(browser, state, watch);
    await openFaqs(page, ws);
    await page.getByLabel('Search FAQs').fill('Open me');
    await page.getByRole('link', { name: 'Open me', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`[?&]view=${faq.id}$`));
    await expect(page.getByRole('heading', { name: 'Edit FAQ', level: 1 })).toBeVisible();
    await page.goBack();
    await page.getByLabel('Search FAQs').fill('Open me');
    await page.getByRole('link', { name: 'Edit Open me' }).click();
    await expect(page).toHaveURL(new RegExp(`[?&]view=${faq.id}$`));
  });
});

test.describe('paging and bulk actions', () => {
  test('27 FAQs page 20 + 7 with Load more, no gaps and no repeats', async ({ browser, watch }) => {
    const big = await newWorkspace('paging');
    const bigState = await login(browser, big.email);
    const questions = Array.from(
      { length: 27 },
      (_, i) => `Question number ${String(i + 1).padStart(2, '0')}`,
    );
    for (const q of questions) await seedFaq(big, { question: q, answerText: `Answer ${q}` });

    const { page } = await open(browser, bigState, watch);
    await openFaqs(page, big);
    await expect(rows(page)).toHaveCount(20);
    await expect(page.getByRole('group', { name: 'FAQ totals' })).toContainText('27');
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(rows(page)).toHaveCount(27);
    await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);

    const shown = await rows(page).evaluateAll((trs) =>
      trs.map((tr) => tr.querySelector('a')?.textContent ?? ''),
    );
    expect(new Set(shown).size, 'no repeated row').toBe(27);
    expect([...shown].sort()).toEqual([...questions].sort());
  });

  test('bulk pause, activate and delete work on the selected rows only, and say how many', async ({
    browser,
    watch,
  }) => {
    const names = ['Bulk alpha', 'Bulk beta', 'Bulk gamma'];
    for (const q of names) await seedFaq(ws, { question: q, answerText: `Reply ${q}` });
    await seedFaq(ws, { question: 'Bulk bystander', answerText: 'Untouched.' });
    const { page } = await open(browser, state, watch);
    await openFaqs(page, ws);
    await page.getByLabel('Search FAQs').fill('Bulk');
    await expect(rows(page)).toHaveCount(4);

    for (const q of names) await page.getByRole('checkbox', { name: `Select ${q}` }).check();
    const bar = page.getByRole('region', { name: 'Bulk actions' });
    await expect(bar).toContainText('3 FAQs selected');

    await bar.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText('3 FAQs paused.')).toBeVisible();
    await expect(bar).toHaveCount(0);
    for (const q of names)
      await expect(rowOf(page, q).getByText('Paused', { exact: true })).toBeVisible();
    await expect(rowOf(page, 'Bulk bystander').getByText('Active', { exact: true })).toBeVisible();

    // Select all on the page, then drop one: the count follows.
    await page.getByRole('checkbox', { name: 'Select all FAQs on this page' }).check();
    await expect(page.getByRole('region', { name: 'Bulk actions' })).toContainText(
      '4 FAQs selected',
    );
    await page.getByRole('checkbox', { name: 'Select Bulk bystander' }).uncheck();
    await expect(page.getByRole('region', { name: 'Bulk actions' })).toContainText(
      '3 FAQs selected',
    );
    await page
      .getByRole('region', { name: 'Bulk actions' })
      .getByRole('button', { name: 'Activate' })
      .click();
    await expect(page.getByText('3 FAQs activated.')).toBeVisible();
    for (const q of names)
      await expect(rowOf(page, q).getByText('Active', { exact: true })).toBeVisible();

    // Clear selection works, and delete asks first.
    await page.getByRole('checkbox', { name: 'Select Bulk alpha' }).check();
    await page.getByRole('checkbox', { name: 'Select Bulk beta' }).check();
    await page
      .getByRole('region', { name: 'Bulk actions' })
      .getByRole('button', { name: 'Clear selection' })
      .click();
    await expect(page.getByRole('region', { name: 'Bulk actions' })).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Select Bulk alpha' }).check();
    await page.getByRole('checkbox', { name: 'Select Bulk beta' }).check();
    await page
      .getByRole('region', { name: 'Bulk actions' })
      .getByRole('button', { name: 'Delete' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Delete 2 FAQs?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(rows(page)).toHaveCount(4);
    await page
      .getByRole('region', { name: 'Bulk actions' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await page
      .getByRole('dialog', { name: 'Delete 2 FAQs?' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(page.getByText('2 FAQs deleted.')).toBeVisible();
    await expect(rows(page)).toHaveCount(2);
    await expect(rowOf(page, 'Bulk gamma')).toBeVisible();
    await expect(rowOf(page, 'Bulk bystander')).toBeVisible();
    const left = (await entries(ws)).data.map((e: any) => e.question);
    expect(left).not.toContain('Bulk alpha');
    expect(left).toContain('Bulk bystander');
  });
});
