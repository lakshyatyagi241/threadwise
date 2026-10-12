import {
  entries,
  expect,
  getSettings,
  go,
  login,
  newWorkspace,
  open,
  openFaqs,
  phrasingBox,
  questionBox,
  reloadFaqs,
  seedFaq,
  type State,
  test,
  waitIndexed,
  type Workspace,
} from './support';

/**
 * A brand new workspace: the empty state teaches the feature, answering is switched on from the banner, and the first FAQ is
 * written in the editor with its phrasings typed one by one, added with the button and pasted in bulk.
 */
let ws: Workspace;
let state: State;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  ws = await newWorkspace('first');
  state = await login(browser, ws.email);
});

test('the empty list explains the feature, and the banner switches answering on', async ({
  browser,
  watch,
}) => {
  const { page } = await open(browser, state, watch);
  await openFaqs(page, ws);

  await expect(page.getByRole('heading', { name: 'FAQs', level: 1 })).toBeVisible();
  await expect(page.getByText('Teach your bot the answers to common questions')).toBeVisible();
  await expect(page.getByText(/other ways to ask the same thing/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add your first FAQ' })).toBeVisible();
  // No toolbar to filter an empty list.
  await expect(page.getByLabel('Search FAQs')).toHaveCount(0);

  // Answering is off for every flow until someone switches it on, and the banner says so on this very screen.
  await expect(page.getByText('FAQ answering is OFF for this flow')).toBeVisible();
  expect((await getSettings(ws)).enabled).toBe(false);
  await page.getByRole('button', { name: 'Turn on FAQ answering' }).click();
  await expect(page.getByText('FAQ answering is on.')).toBeVisible();
  await expect(page.getByText('FAQ answering is OFF for this flow')).toHaveCount(0);
  await expect.poll(async () => (await getSettings(ws)).enabled).toBe(true);

  // It survives a reload (the banner reads the saved setting).
  await reloadFaqs(page);
  await expect(page.getByRole('heading', { name: 'FAQs', level: 1 })).toBeVisible();
  await expect(page.getByText('FAQ answering is OFF for this flow')).toHaveCount(0);
});

test('create a FAQ: Enter and Add and Paste many each add phrasings without submitting the form', async ({
  browser,
  watch,
}) => {
  const { page } = await open(browser, state, watch);
  await openFaqs(page, ws);
  await page.getByRole('link', { name: 'Add your first FAQ' }).click();
  await expect(page).toHaveURL(/[?&]view=new$/);
  await expect(page.getByRole('heading', { name: 'New FAQ', level: 1 })).toBeVisible();

  await questionBox(page).fill('Where is my order?');
  await page.getByLabel('Category').fill('Shipping');
  await page.getByLabel('Answer text').fill('Your order is on its way.\nTrack it in your account.');
  await expect(page.getByText('How it looks in WhatsApp')).toBeVisible();

  const phrasings = page.getByRole('list', { name: 'Phrasings' });

  // 1) Typing and pressing Enter adds the phrasing and must NOT submit the outer form (a real bug once).
  const add = phrasingBox(page);
  await add.fill('order status please');
  await add.press('Enter');
  await expect(phrasings.getByText('order status please')).toBeVisible();
  await expect(add).toHaveValue('');
  await expect(page).toHaveURL(/[?&]view=new$/);
  await expect(page.getByText('FAQ created.')).toHaveCount(0);
  // No validation errors appeared (the form was not submitted), and the field is ready for the next phrasing.
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
  await expect(add).toBeFocused();

  // 2) The Add button.
  await add.fill('where is my package');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(phrasings.getByText('where is my package')).toBeVisible();
  await expect(page).toHaveURL(/[?&]view=new$/);

  // 3) Paste many: duplicates (of the question, of an existing phrasing, repeated lines) are counted and left out.
  await page.getByRole('button', { name: 'Paste many' }).click();
  await page
    .getByLabel('One phrasing per line')
    .fill(
      [
        'track my parcel',
        'TRACK   my parcel',
        'where IS my order?',
        'Order status please',
        '',
        'has my order shipped',
      ].join('\n'),
    );
  await expect(page.getByText('2 new phrasings will be added')).toBeVisible();
  await expect(page.getByText('3 duplicates left out')).toBeVisible();
  await page.getByRole('button', { name: 'Add 2 phrasings' }).click();
  await expect(phrasings.getByText('track my parcel')).toBeVisible();
  await expect(phrasings.getByText('has my order shipped')).toBeVisible();
  await expect(page).toHaveURL(/[?&]view=new$/);
  // Question + 4 phrasings.
  await expect(page.getByLabel(/^5 of \d+ phrasings used$/)).toBeVisible();

  // Nothing was saved yet.
  expect((await entries(ws)).data.some((e: any) => e.question === 'Where is my order?')).toBe(
    false,
  );

  // Save.
  await page.getByRole('button', { name: 'Create FAQ' }).click();
  await expect(page.getByText('FAQ created.')).toBeVisible();
  await expect(page).toHaveURL(/[?&]view=[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Edit FAQ', level: 1 })).toBeVisible();

  const saved = (await entries(ws)).data.find((e: any) => e.question === 'Where is my order?');
  expect(saved).toMatchObject({ category: 'Shipping', status: 'active', variationCount: 5 });

  // The phrasings go from Indexing to Live by themselves (the editor polls), no reload.
  const live = phrasings.getByText('Live', { exact: true });
  await expect(live).toHaveCount(5, { timeout: 60_000 });
  await expect(phrasings.getByText('Indexing', { exact: true })).toHaveCount(0);
  await waitIndexed(ws);

  // Sources: the question is locked, the pasted ones are "Written".
  await expect(phrasings.getByText('Question', { exact: true })).toBeVisible();
  await expect(phrasings.getByText('Written', { exact: true })).toHaveCount(4);
});

test('the list shows a FAQ with its phrasing count, live bar and answer preview', async ({
  browser,
  watch,
}) => {
  await seedFaq(ws, {
    question: 'Where do I find my invoice?',
    answerText: 'Invoices live under Billing.',
    category: 'Billing',
    variations: ['invoice download', 'get my bill', 'send me the receipt', 'tax invoice copy'],
  });
  await waitIndexed(ws);
  const { page } = await open(browser, state, watch);
  await openFaqs(page, ws);
  const row = page.getByRole('row').filter({ hasText: 'Where do I find my invoice?' });
  await expect(row).toBeVisible();
  await expect(row.getByText('5 phrasings')).toBeVisible();
  await expect(row.getByText('Billing', { exact: true })).toBeVisible();
  await expect(row.getByText('Invoices live under Billing.')).toBeVisible();
  await expect(row.getByRole('img', { name: '5 live, 0 indexing, 0 failed' })).toBeVisible();
  await expect(row.getByText('Not yet')).toBeVisible();
  await expect(
    row.getByRole('switch', { name: 'Active: Where do I find my invoice?' }),
  ).toBeChecked();

  const totals = page.getByRole('group', { name: 'FAQ totals' });
  await expect(totals.getByText('Phrasings')).toBeVisible();
});
