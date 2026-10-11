import {
  call,
  deleteFlow,
  entries,
  expect,
  go,
  login,
  newWorkspace,
  open,
  phrasingBox,
  questionBox,
  seedFaq,
  seedFlow,
  tabTo,
  test,
  waitIndexed,
  type State,
  type Workspace,
} from './support';

/** The editor again: conflicts, the leave guard, flow answers, AI suggestions, hostile text and keyboard-only use. */
let ws: Workspace;
let state: State;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  ws = await newWorkspace('editoradv');
  state = await login(browser, ws.email);
});

const entry = async (id: string) => (await call(ws, 'GET', `/v2/faq/entries/${id}`)).body;

test.describe('conflicts and leaving', () => {
  test('a stale save shows the conflict, keeps the draft, and "Keep my edits" saves on top of the latest', async ({
    browser,
    watch,
  }) => {
    watch.allow(/409/);
    const faq = await seedFaq(ws, { question: 'Conflict FAQ', answerText: 'Original answer.' });
    const one = await open(browser, state, watch);
    const two = await open(browser, state, watch);
    await go(one.page, `/faq/${faq.id}`);
    await go(two.page, `/faq/${faq.id}`);

    await one.page.getByLabel('Answer text').fill('Answer from the first person.');
    await one.page.getByRole('button', { name: 'Save changes' }).click();
    await expect(one.page.getByText('FAQ saved.')).toBeVisible();

    await two.page.getByLabel('Category').fill('Second person');
    await two.page.getByRole('button', { name: 'Save changes' }).click();
    const alert = two.page.getByText('Someone else changed this FAQ');
    await expect(alert).toBeVisible();
    await expect(two.page.getByRole('button', { name: 'Load the latest version' })).toBeVisible();
    // The draft is still on screen and nothing was saved over the first person's work.
    await expect(two.page.getByLabel('Category')).toHaveValue('Second person');
    expect((await entry(faq.id)).category).toBe(null);
    expect((await entry(faq.id)).answerText).toBe('Answer from the first person.');

    await two.page.getByRole('button', { name: 'Keep my edits' }).click();
    await expect(
      two.page.getByText('Updated to the latest version. Your edits are kept; save to apply them.'),
    ).toBeVisible();
    await expect(alert).toHaveCount(0);
    await expect(two.page.getByLabel('Category')).toHaveValue('Second person');
    await two.page.getByRole('button', { name: 'Save changes' }).click();
    await expect(two.page.getByText('FAQ saved.')).toBeVisible();
    expect((await entry(faq.id)).category).toBe('Second person');
  });

  test('"Load the latest version" replaces the draft with what was saved', async ({
    browser,
    watch,
  }) => {
    watch.allow(/409/);
    const faq = await seedFaq(ws, {
      question: 'Conflict reload FAQ',
      answerText: 'Original answer.',
    });
    const one = await open(browser, state, watch);
    const two = await open(browser, state, watch);
    await go(one.page, `/faq/${faq.id}`);
    await go(two.page, `/faq/${faq.id}`);
    await one.page.getByLabel('Answer text').fill('Newer answer.');
    await one.page.getByRole('button', { name: 'Save changes' }).click();
    await expect(one.page.getByText('FAQ saved.')).toBeVisible();

    await two.page.getByLabel('Answer text').fill('Stale edit.');
    await two.page.getByRole('button', { name: 'Save changes' }).click();
    await expect(two.page.getByText('Someone else changed this FAQ')).toBeVisible();
    await two.page.getByRole('button', { name: 'Load the latest version' }).click();
    await expect(two.page.getByLabel('Answer text')).toHaveValue('Newer answer.');
    await expect(two.page.getByText('Someone else changed this FAQ')).toHaveCount(0);
    // Now clean: nothing to save until something changes.
    await expect(two.page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  test('unsaved changes are guarded: stay keeps the draft, leave goes on, saving removes the guard', async ({
    browser,
    watch,
  }) => {
    const faq = await seedFaq(ws, { question: 'Guard FAQ', answerText: 'Guarded.' });
    const { page } = await open(browser, state, watch);
    await go(page, `/faq/${faq.id}`);
    await expect(page.getByText('Unsaved changes')).toHaveCount(0);
    await page.getByLabel('Answer text').fill('Guarded, edited.');
    await expect(page.getByText('Unsaved changes')).toBeVisible();

    await page
      .getByRole('navigation', { name: 'FAQ sections' })
      .getByRole('link', { name: 'Settings' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Leave without saving?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page).toHaveURL(new RegExp(`/faq/${faq.id}$`));
    await expect(page.getByLabel('Answer text')).toHaveValue('Guarded, edited.');

    // The browser's own prompt guards a reload or a closed tab.
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.type());
      void d.dismiss();
    });
    await page.getByLabel('Answer text').click();
    await page.evaluate(() => location.reload());
    await expect.poll(() => dialogs).toContain('beforeunload');
    await expect(page).toHaveURL(new RegExp(`/faq/${faq.id}$`));

    await page.getByRole('link', { name: 'Back to FAQs' }).click();
    await page
      .getByRole('dialog', { name: 'Leave without saving?' })
      .getByRole('button', { name: 'Leave' })
      .click();
    await expect(page).toHaveURL(/\/faq$/);
    expect((await entry(faq.id)).answerText).toBe('Guarded.');

    // After a save there is nothing to guard.
    await page.goto(`/faq/${faq.id}`);
    await page.getByLabel('Answer text').fill('Saved version.');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('FAQ saved.')).toBeVisible();
    await expect(page.getByText('Unsaved changes')).toHaveCount(0);
    await page.getByRole('link', { name: 'Back to FAQs' }).click();
    await expect(page).toHaveURL(/\/faq$/);
  });

  test('a new FAQ with only phrasings typed is also guarded', async ({ browser, watch }) => {
    const { page } = await open(browser, state, watch);
    await go(page, '/faq/new');
    await phrasingBox(page).fill('just a phrasing');
    await phrasingBox(page).press('Enter');
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await page
      .getByRole('navigation', { name: 'FAQ sections' })
      .getByRole('link', { name: 'Unanswered' })
      .click();
    await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toBeVisible();
  });
});

test.describe('flow answers', () => {
  test('pick a flow from a searchable list; the text answer is not saved with it, and back again', async ({
    browser,
    watch,
  }) => {
    const names = ['Pwflow Welcome', 'Pwflow Billing help', 'Pwflow Returns'];
    const ids = names.map((n) => seedFlow(ws, n));
    const { page } = await open(browser, state, watch);
    await go(page, '/faq/new');
    await questionBox(page).fill('How do I get billing help?');
    await page.getByLabel('Answer text').fill('A text that must not survive as the flow answer.');
    await page.getByRole('tab', { name: 'Start a flow' }).click();

    // Without a flow chosen, saving explains what is missing and focuses it.
    await page.getByRole('button', { name: 'Create FAQ' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Choose the flow to start.' }),
    ).toBeVisible();

    const search = page.getByRole('searchbox', { name: 'Search flows' });
    const flowOptions = page.getByRole('listbox', { name: 'Flows' }).getByRole('option');
    await expect(page.getByRole('option', { name: /Pwflow Welcome/ })).toBeVisible();
    await search.fill('billing');
    await expect(flowOptions).toHaveCount(1);
    await expect(page.getByRole('option', { name: /Pwflow Billing help/ })).toBeVisible();
    await search.fill('zzzz-nothing');
    await expect(page.getByText('No flow has that name.')).toBeVisible();
    await search.fill('Pwflow');
    await expect(flowOptions).toHaveCount(3);
    await page
      .getByRole('option', { name: /Pwflow Billing help/ })
      .getByRole('button')
      .click();
    await expect(page.getByText('Chosen')).toBeVisible();
    await expect(page.getByRole('option', { name: /Pwflow Billing help/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByText('Choose the flow to start.')).toHaveCount(0);

    await page.getByRole('button', { name: 'Create FAQ' }).click();
    await expect(page.getByText('FAQ created.')).toBeVisible();
    await page.waitForURL(/\/faq\/[0-9a-f-]{36}$/);
    const id = page.url().split('/').pop()!;
    const saved = await entry(id);
    expect(saved).toMatchObject({
      answerType: 'flow',
      flowId: ids[1],
      flowName: 'Pwflow Billing help',
      answerText: null,
    });

    // The list names the flow instead of an answer text.
    await page.goto('/faq');
    await page.getByLabel('Search FAQs').fill('billing help');
    await expect(page.locator('tbody tr').filter({ hasText: 'Pwflow Billing help' })).toBeVisible();

    // Back to a text answer: the flow is released.
    await page.goto(`/faq/${id}`);
    await expect(page.getByRole('tab', { name: 'Start a flow' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByRole('tab', { name: 'Text answer' }).click();
    await page.getByLabel('Answer text').fill('A plain text now.');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('FAQ saved.')).toBeVisible();
    expect(await entry(id)).toMatchObject({
      answerType: 'text',
      flowId: null,
      answerText: 'A plain text now.',
    });
  });

  test('a flow deleted later shows "Flow missing" in the list and in the editor', async ({
    browser,
    watch,
  }) => {
    const flowId = seedFlow(ws, 'Pwflow Doomed');
    const faq = await seedFaq(ws, { question: 'Doomed flow FAQ', flowId });
    const { page } = await open(browser, state, watch);
    await go(page, '/faq');
    await page.getByLabel('Search FAQs').fill('Doomed flow FAQ');
    await expect(page.locator('tbody tr').filter({ hasText: 'Pwflow Doomed' })).toBeVisible();

    deleteFlow(ws, flowId);
    await page.reload();
    await page.getByLabel('Search FAQs').fill('Doomed flow FAQ');
    await expect(page.locator('tbody tr').filter({ hasText: 'Flow missing' })).toBeVisible();

    await page.goto(`/faq/${faq.id}`);
    await expect(page.getByText(/The flow this FAQ started no longer exists/)).toBeVisible();
    await expect(page.getByText('Chosen')).toHaveCount(0);
    // Saving without choosing another flow is refused by name; choosing one repairs it.
    const other = seedFlow(ws, 'Pwflow Replacement');
    await page.getByRole('searchbox', { name: 'Search flows' }).fill('Replacement');
    await page
      .getByRole('option', { name: /Pwflow Replacement/ })
      .getByRole('button')
      .click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('FAQ saved.')).toBeVisible();
    expect((await entry(faq.id)).flowId).toBe(other);
  });
});

test.describe('suggestions', () => {
  test('AI suggestions are only proposals: tick, untick, add, and they are saved as AI phrasings', async ({
    browser,
    watch,
  }) => {
    const faq = await seedFaq(ws, { question: 'Suggest for me?', answerText: 'Sure.' });
    await waitIndexed(ws);
    const { page } = await open(browser, state, watch);
    await go(page, `/faq/${faq.id}`);
    const before = (await entry(faq.id)).variations.length;

    await page.getByRole('button', { name: 'Suggest with AI' }).click();
    const box = page.getByRole('group', { name: 'Suggested phrasings' });
    await expect(box).toBeVisible();
    const items = box.getByRole('checkbox');
    await expect(items).toHaveCount(8);
    await expect(items.first()).toBeChecked();
    // Nothing was saved by asking.
    expect((await entry(faq.id)).variations.length).toBe(before);

    await items.nth(0).uncheck();
    await items.nth(1).uncheck();
    await expect(page.getByRole('button', { name: 'Add selected (6)' })).toBeEnabled();
    const kept = await items.evaluateAll((els) =>
      els
        .filter((e) => (e as HTMLInputElement).checked)
        .map((e) => e.closest('li')?.textContent ?? ''),
    );
    await page.getByRole('button', { name: 'Add selected (6)' }).click();
    await expect(box).toHaveCount(0);
    const saved = (await entry(faq.id)).variations.filter((v: any) => v.source === 'ai');
    expect(saved).toHaveLength(6);
    expect(saved.map((v: any) => v.text).sort()).toEqual(kept.map((k: string) => k.trim()).sort());
    await expect(
      page.getByRole('list', { name: 'Phrasings' }).getByText('AI', { exact: true }),
    ).toHaveCount(6);

    // Discard saves nothing; unticking everything disables adding.
    await page.getByRole('button', { name: 'Suggest with AI' }).click();
    await expect(box).toBeVisible();
    await expect(box.getByRole('checkbox')).toHaveCount(2);
    await box.getByRole('checkbox').first().uncheck();
    await box.getByRole('checkbox').last().uncheck();
    await expect(page.getByRole('button', { name: /^Add selected \(0\)/ })).toBeDisabled();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(box).toHaveCount(0);
    expect((await entry(faq.id)).variations.length).toBe(before + 6);
  });

  test('on an unsaved FAQ the button waits for the first save', async ({ browser, watch }) => {
    const { page } = await open(browser, state, watch);
    await go(page, '/faq/new');
    await expect(page.getByRole('button', { name: 'Suggest with AI' })).toBeDisabled();
    await expect(
      page.getByText('Save the FAQ first, then AI can suggest phrasings.'),
    ).toBeVisible();
  });
});

test.describe('odd text and keyboard', () => {
  test('markup, emoji, Hindi and very long words stay plain text and survive a reload', async ({
    browser,
    watch,
  }) => {
    const question = '<img src=x onerror="window.__xss=1"> Where is my 📦? मेरा ऑर्डर कहाँ है?';
    const answer = `<script>window.__xss=2</script>\n**not bold** 🚚 मेरा ऑर्डर रास्ते में है\n${'Supercalifragilistic'.repeat(30)}`;
    const { page } = await open(browser, state, watch);
    let alerts = 0;
    page.on('dialog', (d) => {
      alerts++;
      void d.dismiss();
    });
    await go(page, '/faq/new');
    await questionBox(page).fill(question);
    await page.getByLabel('Answer text').fill(answer);
    await phrasingBox(page).fill('<b>bold phrasing</b> 😀');
    await phrasingBox(page).press('Enter');
    await expect(page.getByText('How it looks in WhatsApp')).toBeVisible();
    await page.getByRole('button', { name: 'Create FAQ' }).click();
    await expect(page.getByText('FAQ created.')).toBeVisible();
    await page.waitForURL(/\/faq\/[0-9a-f-]{36}$/);
    const id = page.url().split('/').pop()!;

    for (const where of [`/faq/${id}`, '/faq']) {
      await page.goto(where);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (where === '/faq') await page.getByLabel('Search FAQs').fill('Where is my');
      await expect(
        page.getByText('<img src=x onerror="window.__xss=1">', { exact: false }).first(),
      ).toBeVisible();
      expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
      expect(await page.locator('img[src="x"]').count()).toBe(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
    expect(alerts).toBe(0);
    await page.goto(`/faq/${id}`);
    await expect(page.getByLabel('Answer text')).toHaveValue(answer);
    await expect(questionBox(page)).toHaveValue(question);
    await expect(page.getByText('<b>bold phrasing</b> 😀')).toBeVisible();
    await expect(page.locator('b', { hasText: 'bold phrasing' })).toHaveCount(0);
    expect((await entry(id)).answerText).toBe(answer);
  });

  test('the whole create flow works with the keyboard alone', async ({ browser, watch }) => {
    const { page } = await open(browser, state, watch);
    await go(page, '/faq/new');
    const kb = page.keyboard;
    await tabTo(page, questionBox(page));
    await kb.type('Keyboard only question?');
    await tabTo(page, page.getByLabel('Category'));
    await kb.type('Keys');
    await tabTo(page, page.getByLabel('Answer text'));
    await kb.type('Typed without a mouse.');
    await tabTo(page, phrasingBox(page));
    await kb.type('keyboard phrasing one');
    await kb.press('Enter');
    await expect(
      page.getByRole('list', { name: 'Phrasings' }).getByText('keyboard phrasing one'),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/faq\/new$/);
    await tabTo(page, page.getByRole('button', { name: 'Create FAQ' }));
    await kb.press('Enter');
    await expect(page.getByText('FAQ created.')).toBeVisible();
    await expect(page).toHaveURL(/\/faq\/[0-9a-f-]{36}$/);
    const made = (await entries(ws)).data.find(
      (e: any) => e.question === 'Keyboard only question?',
    );
    expect(made).toMatchObject({ category: 'Keys', variationCount: 2 });
  });
});
