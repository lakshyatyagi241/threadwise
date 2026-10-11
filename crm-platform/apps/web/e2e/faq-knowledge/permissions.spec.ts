import {
  call,
  expect,
  go,
  login,
  member,
  newWorkspace,
  open,
  putSettings,
  seedFaq,
  test,
  waitIndexed,
  type Member,
  type State,
  type Workspace,
} from './support';

/** What each kind of member sees: read-only, no access at all, and a manager who cannot switch answering. */
let ws: Workspace;
let faq: any;
let reader: Member;
let nobody: Member;
let manager: Member;
let states: { reader: State; nobody: State; manager: State };

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  ws = await newWorkspace('perm');
  faq = await seedFaq(ws, {
    question: 'Permission FAQ',
    answerText: 'Seen by everyone with read.',
    variations: ['permission phrasing'],
  });
  await waitIndexed(ws);
  reader = await member(ws, 'reader', ['faq.entries.read']);
  nobody = await member(ws, 'nobody', ['inbox.conversation.read']);
  manager = await member(ws, 'manager', [
    'faq.entries.read',
    'faq.entries.create',
    'faq.entries.update',
    'faq.entries.delete',
    'faq.insights.read',
  ]);
  states = {
    reader: await login(browser, reader.email),
    nobody: await login(browser, nobody.email),
    manager: await login(browser, manager.email),
  };
});

test.describe('read only', () => {
  test('the list has no way to add, change or delete; the other tabs are not offered', async ({
    browser,
    watch,
  }) => {
    const { page } = await open(browser, states.reader, watch);
    await go(page, '/faq');
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
    await go(page, `/faq/${faq.id}`);
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
    await expect(page.getByText('Unsaved changes')).toHaveCount(0);
  });

  test('creating is refused with a named permission, and the API agrees', async ({
    browser,
    watch,
  }) => {
    watch.allow(/403/);
    const { page } = await open(browser, states.reader, watch);
    // A no-access screen has no page title, so `go` (which waits for one) is not used.
    await page.goto('/faq/new');
    await expect(page.getByText('You do not have access to this screen')).toBeVisible();
    await expect(page.getByText('faq.entries.create')).toBeVisible();
    await page.goto('/faq/unanswered');
    await expect(page.getByText('faq.insights.read')).toBeVisible();
    await page.goto('/faq/insights');
    await expect(page.getByText('faq.insights.read')).toBeVisible();
    for (const [method, path, body] of [
      ['POST', '/v2/faq/entries', { question: 'x', answerType: 'text', answerText: 'y' }],
      [
        'PATCH',
        `/v2/faq/entries/${faq.id}`,
        { question: 'x', answerType: 'text', answerText: 'y', status: 'active', rowVersion: 1 },
      ],
      ['DELETE', `/v2/faq/entries/${faq.id}`, undefined],
      [
        'PUT',
        '/v2/faq/settings',
        { enabled: true, threshold: 0.5, minMargin: 0, logQueries: true },
      ],
      ['GET', '/v2/faq/insights/summary', undefined],
    ] as const) {
      const r = await call(ws, method, path, body, reader.token);
      expect(r.status, `${method} ${path}`).toBe(403);
    }
  });

  test('the settings can be read but not changed', async ({ browser, watch }) => {
    const { page } = await open(browser, states.reader, watch);
    await go(page, '/faq/settings');
    await expect(
      page.getByText(/Changing them needs the permission faq\.settings\.manage/).first(),
    ).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Answer customers with FAQs' })).toBeDisabled();
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
  test('there is no sidebar entry and the screens explain what is missing', async ({
    browser,
    watch,
  }) => {
    watch.allow(/403/);
    const { page } = await open(browser, states.nobody, watch);
    await page.goto('/dashboard');
    await expect(page.locator('h1, h2').first()).toBeVisible();
    await expect(page.locator('a[href="/faq"]')).toHaveCount(0);
    for (const path of [
      '/faq',
      '/faq/test',
      '/faq/settings',
      '/faq/unanswered',
      '/faq/insights',
      '/faq/new',
      `/faq/${faq.id}`,
    ]) {
      await page.goto(path);
      await expect(page.getByText('You do not have access to this screen'), path).toBeVisible();
    }
    await expect(
      page.getByRole('navigation', { name: 'FAQ sections' }).getByRole('link'),
    ).toHaveCount(0);
    expect((await call(ws, 'GET', '/v2/faq/entries', undefined, nobody.token)).status).toBe(403);
  });
});

test.describe('manager without the settings permission', () => {
  test('can write and review but cannot switch answering on', async ({ browser, watch }) => {
    const { page } = await open(browser, states.manager, watch);
    await go(page, '/faq');
    await expect(page.getByRole('link', { name: 'Add FAQ' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete Permission FAQ' })).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'FAQ sections' });
    await expect(tabs.getByRole('link', { name: 'Unanswered' })).toBeVisible();
    await expect(tabs.getByRole('link', { name: 'Insights' })).toBeVisible();
    await expect(page.getByText('FAQ answering is OFF for customers')).toBeVisible();
    await expect(
      page.getByText('Ask someone with the permission faq.settings.manage'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn on FAQ answering' })).toHaveCount(0);

    await go(page, '/faq/settings');
    await expect(page.getByRole('switch', { name: 'Answer customers with FAQs' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save settings' })).toHaveCount(0);

    // What a manager may do works: add a FAQ and remove it.
    await go(page, '/faq/new');
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
    await expect(page).toHaveURL(/\/faq$/);

    const put = await call(
      ws,
      'PUT',
      '/v2/faq/settings',
      { enabled: true, threshold: 0.5, minMargin: 0, logQueries: true },
      manager.token,
    );
    expect(put.status).toBe(403);
    await putSettings(ws, { enabled: false });
  });

  test('the unanswered and insights screens are usable', async ({ browser, watch }) => {
    const { page } = await open(browser, states.manager, watch);
    await go(page, '/faq/unanswered');
    await expect(page.getByText('Nothing waiting')).toBeVisible();
    await go(page, '/faq/insights');
    await expect(page.getByText('No messages yet')).toBeVisible();
  });
});
