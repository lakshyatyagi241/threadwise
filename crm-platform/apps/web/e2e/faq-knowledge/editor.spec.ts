import {
  entries,
  expect,
  go,
  login,
  newWorkspace,
  open,
  phrasingBox,
  questionBox,
  seedFaq,
  tabTo,
  test,
  waitIndexed,
  type State,
  type Workspace,
} from './support';

/** The editor: validation, limits, duplicate questions, locked question row, odd text, double submit, keyboard only. */
let ws: Workspace;
let state: State;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  ws = await newWorkspace('editor');
  state = await login(browser, ws.email);
});

const byQuestion = async (q: string) =>
  (await entries(ws)).data.filter((e: any) => e.question === q);

test.describe('validation', () => {
  test('an empty question and an empty answer are explained inline and nothing is sent', async ({
    browser,
    watch,
  }) => {
    const { page } = await open(browser, state, watch);
    const posts: string[] = [];
    page.on(
      'request',
      (r) => r.method() === 'POST' && r.url().includes('/faq/entries') && posts.push(r.url()),
    );
    await go(page, '/faq/new');
    await page.getByRole('button', { name: 'Create FAQ' }).click();
    await expect(page.getByText('Write the question customers ask.').first()).toBeVisible();
    await expect(page.getByText('Write the answer customers should get.')).toBeVisible();
    // The first invalid field takes focus, and it is marked invalid for a screen reader.
    await expect(questionBox(page)).toBeFocused();
    await expect(questionBox(page)).toHaveAttribute('aria-invalid', 'true');
    expect(posts).toEqual([]);

    // Typing a question alone is not enough: the answer is still required.
    await questionBox(page).fill('Do you ship abroad?');
    await page.getByRole('button', { name: 'Create FAQ' }).click();
    await expect(page.getByLabel('Answer text')).toBeFocused();
    expect(posts).toEqual([]);

    // Whitespace is not an answer.
    await page.getByLabel('Answer text').fill('    \n  ');
    await page.getByRole('button', { name: 'Create FAQ' }).click();
    await expect(page.getByText('Write the answer customers should get.')).toBeVisible();
    expect(posts).toEqual([]);

    // A message goes away as soon as its field is right, not at the next save (it used to stay until then).
    await page.getByLabel('Answer text').fill('Yes, worldwide.');
    await expect(page.getByText('Write the answer customers should get.')).toHaveCount(0);
    await expect(page.getByLabel('Answer text')).not.toHaveAttribute('aria-invalid', 'true');
    await questionBox(page).fill('');
    await page.getByRole('button', { name: 'Create FAQ' }).click();
    await expect(page.getByText('Write the question customers ask.').first()).toBeVisible();
    await questionBox(page).fill('Do you ship abroad??');
    await expect(page.getByText('Write the question customers ask.')).toHaveCount(0);
  });

  test('counters follow the text and over-long fields are refused with the limit named', async ({
    browser,
    watch,
  }) => {
    const { page } = await open(browser, state, watch);
    await go(page, '/faq/new');
    await expect(page.getByText('0 / 500')).toBeVisible();
    await expect(page.getByText('0 / 4096 characters')).toBeVisible();
    await questionBox(page).fill('x'.repeat(120));
    await expect(page.getByText('120 / 500')).toBeVisible();
    await page.getByLabel('Answer text').fill('y'.repeat(37));
    await expect(page.getByText('37 / 4096 characters')).toBeVisible();

    // The boxes accept a little over the limit so a paste is not cut silently; saving names the limit.
    await questionBox(page).fill('q'.repeat(520));
    await page.getByLabel('Category').fill('c'.repeat(61));
    await page.getByLabel('Answer text').fill('a'.repeat(4100));
    await expect(page.getByText('4100 / 4096 characters')).toBeVisible();
    await page.getByRole('button', { name: 'Create FAQ' }).click();
    await expect(page.getByText('The question can be at most 500 characters.')).toBeVisible();
    await expect(page.getByText('The category can be at most 60 characters.')).toBeVisible();
    await expect(page.getByText('The answer can be at most 4096 characters.')).toBeVisible();
    expect(await byQuestion('q'.repeat(520))).toHaveLength(0);

    // Exactly at the limits is fine.
    await questionBox(page).fill('Boundary question ' + 'b'.repeat(500 - 18));
    await page.getByLabel('Category').fill('c'.repeat(60));
    await page.getByLabel('Answer text').fill('a'.repeat(4096));
    await page.getByRole('button', { name: 'Create FAQ' }).click();
    await expect(page.getByText('FAQ created.')).toBeVisible();
    const made = (await entries(ws)).data.find((e: any) =>
      e.question.startsWith('Boundary question'),
    );
    expect(made.question).toHaveLength(500);
  });

  test('a phrasing over 500 characters and a duplicate phrasing are explained', async ({
    browser,
    watch,
  }) => {
    const { page } = await open(browser, state, watch);
    await go(page, '/faq/new');
    await questionBox(page).fill('Do you gift wrap?');
    await phrasingBox(page).fill('gift wrapping available');
    await phrasingBox(page).press('Enter');
    // Same phrasing again, different case and spacing: refused with a message, not added twice.
    await phrasingBox(page).fill('Gift   WRAPPING available');
    await phrasingBox(page).press('Enter');
    await expect(page.getByText('This FAQ already has that phrasing.')).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Phrasings' }).getByText(/gift\s+wrapping available/i),
    ).toHaveCount(1);
    // The question itself counts as a phrasing.
    await phrasingBox(page).fill('do you gift wrap?');
    await phrasingBox(page).press('Enter');
    await expect(page.getByText('This FAQ already has that phrasing.')).toBeVisible();

    await page.getByRole('button', { name: 'Paste many' }).click();
    await page.getByLabel('One phrasing per line').fill(`${'w'.repeat(501)}\nshort one`);
    await expect(page.getByText('1 line is over 500 characters and left out.')).toBeVisible();
    await expect(page.getByText('1 new phrasing will be added')).toBeVisible();
    await page.getByRole('button', { name: 'Add 1 phrasing' }).click();
    await expect(
      page.getByRole('list', { name: 'Phrasings' }).getByText('short one'),
    ).toBeVisible();
  });

  test('a duplicate question shows the API error inline and keeps the draft', async ({
    browser,
    watch,
  }) => {
    watch.allow(/409/);
    await seedFaq(ws, { question: 'Do you offer discounts?', answerText: 'Sometimes.' });
    const { page } = await open(browser, state, watch);
    await go(page, '/faq/new');
    await questionBox(page).fill('do you OFFER   discounts?');
    await page.getByLabel('Answer text').fill('My typed answer');
    await page.getByLabel('Category').fill('Promos');
    await phrasingBox(page).fill('any coupon codes');
    await phrasingBox(page).press('Enter');
    await page.getByRole('button', { name: 'Create FAQ' }).click();

    await expect(page.getByText('Another FAQ already has this question.')).toBeVisible();
    await expect(page).toHaveURL(/\/faq\/new$/);
    await expect(questionBox(page)).toBeFocused();
    await expect(questionBox(page)).toHaveAttribute('aria-invalid', 'true');
    // Nothing the person typed was lost.
    await expect(questionBox(page)).toHaveValue('do you OFFER   discounts?');
    await expect(page.getByLabel('Answer text')).toHaveValue('My typed answer');
    await expect(page.getByLabel('Category')).toHaveValue('Promos');
    await expect(
      page.getByRole('list', { name: 'Phrasings' }).getByText('any coupon codes'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create FAQ' })).toBeEnabled();
    // Fixing the question clears the message and the save goes through.
    await questionBox(page).fill('Do you offer student discounts?');
    await expect(page.getByText('Another FAQ already has this question.')).toHaveCount(0);
    await page.getByRole('button', { name: 'Create FAQ' }).click();
    await expect(page.getByText('FAQ created.')).toBeVisible();
  });
});

test.describe('editing a saved FAQ', () => {
  test('the question row is locked; other phrasings can be edited and removed', async ({
    browser,
    watch,
  }) => {
    const faq = await seedFaq(ws, {
      question: 'Edit phrasings FAQ',
      answerText: 'Ok.',
      variations: ['first way', 'second way', 'third way'],
    });
    await waitIndexed(ws);
    const { page } = await open(browser, state, watch);
    await go(page, `/faq/${faq.id}`);
    const list = page.getByRole('list', { name: 'Phrasings' });
    const questionRow = list.getByRole('listitem').filter({ hasText: 'Edit phrasings FAQ' });
    await expect(questionRow.getByText('Question', { exact: true })).toBeVisible();
    await expect(questionRow.getByRole('button')).toHaveCount(0);
    await expect(list.getByText('Live', { exact: true })).toHaveCount(4);

    // Edit one inline: Enter saves it (and does not submit the FAQ form), Escape abandons.
    await page.getByRole('button', { name: 'Edit second way' }).click();
    const box = page.getByLabel('Edit phrasing');
    await expect(box).toBeFocused();
    await box.fill('abandoned');
    await box.press('Escape');
    await expect(list.getByText('abandoned')).toHaveCount(0);
    await expect(list.getByText('second way')).toBeVisible();
    await page.getByRole('button', { name: 'Edit second way' }).click();
    await page.getByLabel('Edit phrasing').fill('second way, reworded');
    await page.getByLabel('Edit phrasing').press('Enter');
    await expect(list.getByText('second way, reworded')).toBeVisible();
    await expect(page.getByText('FAQ saved.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    // A reworded phrasing is indexed again.
    await expect(list.getByText('Live', { exact: true })).toHaveCount(4, { timeout: 60_000 });

    // Remove asks first.
    await page.getByRole('button', { name: 'Remove first way' }).click();
    const dialog = page.getByRole('dialog', { name: 'Remove this phrasing?' });
    await expect(dialog).toContainText('"first way" will no longer reach this FAQ.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(list.getByText('first way', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Remove first way' }).click();
    await page
      .getByRole('dialog', { name: 'Remove this phrasing?' })
      .getByRole('button', { name: 'Remove' })
      .click();
    await expect(list.getByText('first way', { exact: true })).toHaveCount(0);
    await expect(list.getByRole('listitem')).toHaveCount(3);
    const after = await (await entries(ws)).data.find((e: any) => e.id === faq.id);
    expect(after.variationCount).toBe(3);

    // Renaming the question renames the locked first phrasing too.
    await questionBox(page).fill('Edit phrasings FAQ renamed');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('FAQ saved.')).toBeVisible();
    await expect(
      list.getByRole('listitem').filter({ hasText: 'Edit phrasings FAQ renamed' }),
    ).toBeVisible();
  });

  test('double-clicking Create makes exactly one FAQ', async ({ browser, watch }) => {
    const { page } = await open(browser, state, watch);
    await go(page, '/faq/new');
    await questionBox(page).fill('Double click safety');
    await page.getByLabel('Answer text').fill('One only.');
    await page.getByRole('button', { name: 'Create FAQ' }).dblclick();
    await expect(page).toHaveURL(/\/faq\/[0-9a-f-]{36}$/);
    await expect.poll(async () => (await byQuestion('Double click safety')).length).toBe(1);
    // Give a stray second request time to land, then check again.
    await page.waitForTimeout(1500);
    expect(await byQuestion('Double click safety')).toHaveLength(1);
  });

  test('a per-FAQ sensitivity can be set with the keyboard and removed again', async ({
    browser,
    watch,
  }) => {
    const faq = await seedFaq(ws, { question: 'Threshold FAQ', answerText: 'T.' });
    const { page } = await open(browser, state, watch);
    await go(page, `/faq/${faq.id}`);
    await page.getByText('Advanced: sensitivity for this FAQ only').click();
    await expect(page.getByText(/Following the workspace sensitivity \(\d+%\)\./)).toBeVisible();
    await page.getByLabel('Use a custom sensitivity for this FAQ').check();
    const slider = page.getByRole('slider', { name: /Match at or above/ });
    await slider.focus();
    await slider.press('End');
    await expect(slider).toHaveAttribute('aria-valuetext', '99%');
    await slider.press('Home');
    await expect(slider).toHaveAttribute('aria-valuetext', '5%');
    await slider.press('ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuetext', '6%');
    for (let i = 0; i < 44; i++) await slider.press('ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuetext', '50%');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('FAQ saved.')).toBeVisible();
    await expect
      .poll(
        async () => (await entries(ws)).data.find((e: any) => e.id === faq.id).thresholdOverride,
      )
      .toBe(0.5);

    await page.reload();
    await page.getByText('Advanced: sensitivity for this FAQ only').click();
    await expect(page.getByLabel('Use a custom sensitivity for this FAQ')).toBeChecked();
    await page.getByLabel('Use a custom sensitivity for this FAQ').uncheck();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('FAQ saved.')).toBeVisible();
    await expect
      .poll(
        async () => (await entries(ws)).data.find((e: any) => e.id === faq.id).thresholdOverride,
      )
      .toBe(null);
  });
});
