import {
  call,
  expect,
  faqBase,
  faqUrl,
  login,
  member,
  type Member,
  newWorkspace,
  open,
  openFaqs,
  putSettings,
  seedFaq,
  type State,
  test,
  waitIndexed,
  type Workspace,
} from './support';

/**
 * What each kind of member sees on a flow's FAQs tab: read-only, no FAQ access at all (no tab), no flow access at all, and a
 * manager who cannot switch answering. A member opens the tab through the flow builder, so each one also holds `flb.flows.read`.
 */
let ws: Workspace;
let faq: any;
let reader: Member;
let nobody: Member;
let noflows: Member;
let manager: Member;
let states: { reader: State; nobody: State; noflows: State; manager: State };

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  ws = await newWorkspace('perm');
  faq = await seedFaq(ws, {
    question: 'Permission FAQ',
    answerText: 'Seen by everyone with read.',
    variations: ['permission phrasing'],
  });
  await waitIndexed(ws);
  reader = await member(ws, 'reader', ['faq.entries.read', 'flb.flows.read']);
  // Can open the flow builder but holds no FAQ permission: the FAQs tab is not offered.
  nobody = await member(ws, 'nobody', ['flb.flows.read']);
  // Cannot even open the builder.
  noflows = await member(ws, 'noflows', ['inbox.conversation.read']);
  manager = await member(ws, 'manager', [
    'flb.flows.read',
    'faq.entries.read',
    'faq.entries.create',
    'faq.entries.update',
    'faq.entries.delete',
    'faq.insights.read',
  ]);
  states = {
    reader: await login(browser, reader.email),
    nobody: await login(browser, nobody.email),
    noflows: await login(browser, noflows.email),
    manager: await login(browser, manager.email),
  };
});

test.describe('read only', () => {
  test('the list has no way to add, change or delete; the other tabs are not offered', async ({
    browser,
    watch,
  }) => {
    const { page } = await open(browser, states.reader, watch);
    await openFaqs(page, ws);
    await expect(page.getByRole('link', { name: 'Permission FAQ', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add FAQ' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete Permission FAQ' })).toHaveCount(0);
    await expect(page.getByRole('switch', { name: 'Active: Permission FAQ' })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: 'Select Permission FAQ' })).toBeDisabled();
    const tabs = page.getByRole('navigation', { name: 'FAQ sections' });
    await expect(tabs.getByRole('link', { name: 'FAQs' })).toBeVisible();
    await expect(tabs.getByRole('link', { name: 'Test' })).toBeVisible();
    await expect(tabs.getByRole('link', { name: 'Settings' })).toBeVisible();
    await expect(tabs.getByRole('link', { name: 'Unanswered' })).toHaveCount(0);
    await expect(tabs.getByRole('link', { name: 'Insights' })).toHaveCount(0);
    // Answering is off: the banner tells a reader whom to ask instead of offering a button.
    await expect(
      page.getByText('Ask someone with the permission faq.settings.manage'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn on FAQ answering' })).toHaveCount(0);
  });

  test('the editor is read only: no Save, Delete, add, edit, remove or AI suggestions', async ({
    browser,
    watch,
  }) => {
    const { page } = await open(browser, states.reader, watch);
    await openFaqs(page, ws, faq.id);
    await expect(
      page.getByText('You can view this FAQ but your role cannot change it.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Question', exact: true })).toHaveAttribute(
      'readonly',
      '',
    );
    await expect(page.getByLabel('Answer text')).toHaveAttribute('readonly', '');
    await expect(page.getByLabel('Category')).toHaveAttribute('readonly', '');
    await expect(page.getByLabel('Status')).toBeDisabled();
    await expect(
      page.getByRole('list', { name: 'Phrasings' }).getByText('permission phrasing'),
    ).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'New phrasing' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Suggest with AI' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit permission phrasing' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove permission phrasing' })).toHaveCount(0);
    // Reading, trying and testing stay available.
    await page.getByRole('textbox', { name: 'Customer message' }).fill('permission phrasing');
    await page.getByRole('button', { name: 'Try' }).click();
    await expect(page.getByText('Would answer', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Add this phrase as a variation/ })).toHaveCount(
      0,
    );
    // Typing into a read-only box changes nothing and does not raise the unsaved warning.
    await page.getByRole('textbox', { name: 'Question', exact: true }).click();
    await page.keyboard.type('zzz');
    await expect(page.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  });

  test('creating is refused with a named permission, and the API agrees', async ({
    browser,
    watch,
  }) => {
    watch.allow(/403/);
    const { page } = await open(browser, states.reader, watch);
    await openFaqs(page, ws, 'new');
    await expect(page.getByText('You do not have access to this screen')).toBeVisible();
    await expect(page.getByText('faq.entries.create')).toBeVisible();
    await openFaqs(page, ws, 'unanswered');
    await expect(page.getByText('faq.insights.read')).toBeVisible();
    await openFaqs(page, ws, 'insights');
    await expect(page.getByText('faq.insights.read')).toBeVisible();
    for (const [method, path, body] of [
      ['POST', `${faqBase(ws)}/entries`, { question: 'x', answerType: 'text', answerText: 'y' }],
      [
        'PATCH',
        `${faqBase(ws)}/entries/${faq.id}`,
        { question: 'x', answerType: 'text', answerText: 'y', status: 'active', rowVersion: 1 },
      ],
      ['DELETE', `${faqBase(ws)}/entries/${faq.id}`, undefined],
      [
        'PUT',
        `${faqBase(ws)}/settings`,
        { enabled: true, threshold: 0.5, minMargin: 0, logQueries: true },
      ],
      ['GET', `${faqBase(ws)}/insights/summary`, undefined],
    ] as const) {
      const r = await call(ws, method, path, body, reader.token);
      expect(r.status, `${method} ${path}`).toBe(403);
    }
  });

  test('the settings can be read but not changed', async ({ browser, watch }) => {
    const { page } = await open(browser, states.reader, watch);
    await openFaqs(page, ws, 'settings');
    await expect(
      page.getByText(/Changing these settings needs the permission faq\.settings\.manage/).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('switch', { name: "Answer customers with this flow's FAQs" }),
    ).toBeDisabled();
    await expect(
      page.getByRole('switch', { name: 'Keep customer messages in the match log' }),
    ).toBeDisabled();
    await expect(
      page.getByRole('slider', { name: 'Answer when the match is at least' }),
    ).toBeDisabled();
    await expect(
      page.getByRole('slider', { name: 'Minimum lead over the second best' }),
    ).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save settings' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Strict/ })).toBeDisabled();
  });
});

test.describe('no FAQ permission', () => {
  test('the flow opens without a FAQs tab, a deep link to it falls back to Build, and the API refuses', async ({
    browser,
    watch,
  }) => {
    watch.allow(/403/);
    const { page } = await open(browser, states.nobody, watch);
    for (const view of [undefined, 'test', 'settings', 'unanswered', 'insights', 'new', faq.id]) {
      await page.goto(faqUrl(ws, view), { timeout: 120_000 });
      // The builder opens on its own page (with one page only, it shows no tab bar at all).
      await expect(page.getByRole('textbox', { name: 'Flow name' })).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.getByRole('tab', { name: 'FAQs' }), String(view)).toHaveCount(0);
      await expect(page.getByRole('tablist', { name: 'Flow sections' })).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: 'FAQ sections' })).toHaveCount(0);
    }
    expect((await call(ws, 'GET', `${faqBase(ws)}/entries`, undefined, nobody.token)).status).toBe(
      403,
    );
  });

  test('without access to flows the builder itself is closed, and so is every FAQ screen in it', async ({
    browser,
    watch,
  }) => {
    watch.allow(/403/);
    const { page } = await open(browser, states.noflows, watch);
    await page.goto(faqUrl(ws, 'test'), { timeout: 120_000 });
    await expect(page).toHaveURL(/\/inbox/, { timeout: 60_000 });
    await expect(page.getByRole('navigation', { name: 'FAQ sections' })).toHaveCount(0);
    expect((await call(ws, 'GET', `${faqBase(ws)}/entries`, undefined, noflows.token)).status).toBe(
      403,
    );
  });

  test('there is no FAQ entry in the menu for anybody, and /faq leads to the flows', async ({
    browser,
    watch,
  }) => {
    // A reader has no right to the dashboard or the inbox: their own 403s are not what this test judges.
    watch.allow(/403/);
    const { page } = await open(browser, states.reader, watch);
    await page.goto('/dashboard');
    await expect(page.locator('h1, h2').first()).toBeVisible();
    await expect(page.locator('a[href="/faq"]')).toHaveCount(0);
    await page.goto('/faq');
    await expect(page).toHaveURL(/\/flows$/, { timeout: 60_000 });
  });
});

test.describe('manager without the settings permission', () => {
  test('can write and review but cannot switch answering on', async ({ browser, watch }) => {
    const { page } = await open(browser, states.manager, watch);
    await openFaqs(page, ws);
    await expect(page.getByRole('link', { name: 'Add FAQ' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete Permission FAQ' })).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'FAQ sections' });
    await expect(tabs.getByRole('link', { name: 'Unanswered' })).toBeVisible();
    await expect(tabs.getByRole('link', { name: 'Insights' })).toBeVisible();
    await expect(page.getByText('FAQ answering is OFF for this flow')).toBeVisible();
    await expect(
      page.getByText('Ask someone with the permission faq.settings.manage'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn on FAQ answering' })).toHaveCount(0);

    await openFaqs(page, ws, 'settings');
    await expect(
      page.getByRole('switch', { name: "Answer customers with this flow's FAQs" }),
    ).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save settings' })).toHaveCount(0);

    // What a manager may do works: add a FAQ and remove it.
    await openFaqs(page, ws, 'new');
    await page.getByRole('textbox', { name: 'Question', exact: true }).fill('Manager made this');
    await page.getByLabel('Answer text').fill('Yes.');
    await page.getByRole('button', { name: 'Create FAQ' }).click();
    await expect(page.getByText('FAQ created.')).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Delete this FAQ?' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(page.getByText('FAQ deleted.')).toBeVisible();
    await expect(page).toHaveURL(/\?tab=faqs$/);

    const put = await call(
      ws,
      'PUT',
      `${faqBase(ws)}/settings`,
      { enabled: true, threshold: 0.5, minMargin: 0, logQueries: true },
      manager.token,
    );
    expect(put.status).toBe(403);
    await putSettings(ws, { enabled: false });
  });

  test('the unanswered and insights screens are usable', async ({ browser, watch }) => {
    const { page } = await open(browser, states.manager, watch);
    await openFaqs(page, ws, 'unanswered');
    await expect(page.getByText('Nothing waiting')).toBeVisible();
    await openFaqs(page, ws, 'insights');
    await expect(page.getByText('No messages yet')).toBeVisible();
  });
});
