import type { Page } from '@playwright/test';
import {
  answering,
  bindFlow,
  call,
  customerAsks,
  customerSays,
  entries,
  expect,
  faqBase,
  faqPanel,
  faqUrl,
  flowIdOf,
  getSettings,
  login,
  logRowsOf,
  member,
  newWorkspace,
  open,
  openFaqs,
  operator,
  putSettings,
  questionBox,
  repliesTo,
  seedBuilderFlow,
  seedFaq,
  seedStepsFlow,
  simulator,
  sql,
  sqlOne,
  type State,
  test,
  viewOf,
  waitIndexed,
  type Workspace,
} from './support';

/**
 * FAQs belong to a flow (ADR-0021, addendum 2): what the FAQs tab of a Simple flow looks like in each state, how it is addressed,
 * that two flows of one workspace share nothing, and what a customer on the simulator gets from which flow.
 */
const HEADINGS: Record<string, string> = {
  list: 'FAQs',
  new: 'New FAQ',
  test: 'How would my bot answer this?',
  unanswered: 'Unanswered messages',
  insights: 'FAQ insights',
  settings: 'FAQ settings',
};
const heading = (page: Page, name: string) =>
  faqPanel(page).getByRole('heading', { name, level: 1 });
/** The two steps every seeded flow has (a trigger and a message called "Welcome"). */
const twoSteps = (ws: Workspace, name: string) =>
  seedBuilderFlow(
    ws,
    name,
    [
      { id: 't', type: 'trigger' },
      { id: 'a', type: 'message', data: { text: 'Welcome' } },
    ],
    [['t', 'out', 'a']],
  );

test.describe('the FAQs tab', () => {
  let ws: Workspace;
  let state: State;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    ws = await newWorkspace('pftab');
    state = await login(browser, ws.email);
    await seedFaq(ws, { question: 'Tab seed question', answerText: 'Seeded.' });
  });

  test('a flow that is not saved yet has the tab switched off with the reason; saving switches it on', async ({
    browser,
    watch,
  }) => {
    const { page } = await open(browser, state, watch, { viewport: { width: 1440, height: 1000 } });
    await page.goto('/flows/simple', { timeout: 120_000 });
    await expect(page.getByRole('textbox', { name: 'Flow name' })).toBeVisible({ timeout: 60_000 });
    const tab = page.getByRole('tab', { name: 'FAQs' });
    await expect(tab).toBeVisible();
    await expect(tab).toBeDisabled();
    await expect(tab).toHaveAttribute('title', 'Save the flow first.');
    await expect(page.getByRole('tab', { name: 'Build' })).toHaveAttribute('aria-selected', 'true');

    // A link that asks for the tab of a flow that does not exist yet still opens on Build.
    await page.goto('/flows/simple?tab=faqs', { timeout: 120_000 });
    await expect(page.getByRole('textbox', { name: 'Flow name' })).toBeVisible({ timeout: 60_000 });
    await expect(faqPanel(page)).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'FAQs' })).toBeDisabled();

    // One save later the flow exists and the tab opens.
    await page.getByRole('textbox', { name: 'Flow name' }).fill('Saved from the tab test');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'FAQs' })).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByRole('tab', { name: 'FAQs' })).not.toHaveAttribute('title', /.+/);
    await page.getByRole('tab', { name: 'FAQs' }).click();
    await expect(heading(page, 'FAQs')).toBeVisible();
    await expect(page.getByText('Teach your bot the answers to common questions')).toBeVisible();
    // It is the new flow's tab: nothing of any other flow is in it.
    await expect(page.getByText('Tab seed question')).toHaveCount(0);
    const created = sqlOne(
      `SELECT uuid FROM flows WHERE org_id=${ws.orgId} AND flow_name='Saved from the tab test'`,
    );
    expect(created).toBeTruthy();
    expect(
      Number(
        sqlOne(
          `SELECT count(*) FROM faqs WHERE org_id=${ws.orgId} AND owner_flow_id=${flowIdOf(ws, created!)}`,
        ),
      ),
    ).toBe(0);
  });

  test('a saved flow opens on Build, the tab shows that flow only, and Build brings the flow back', async ({
    browser,
    watch,
  }) => {
    const { page } = await open(browser, state, watch, { viewport: { width: 1440, height: 1000 } });
    await page.goto(`/flows/simple/${ws.flowUuid}`, { timeout: 120_000 });
    await expect(page.getByRole('textbox', { name: 'Flow name' })).toHaveValue('Main flow', {
      timeout: 60_000,
    });
    const build = page.getByRole('tab', { name: 'Build' });
    const faqs = page.getByRole('tab', { name: 'FAQs' });
    await expect(build).toHaveAttribute('aria-selected', 'true');
    await expect(faqs).toBeEnabled();
    await expect(faqPanel(page)).toBeHidden();
    // A chat flow has no Customize or Install tab, only Build and FAQs.
    await expect(page.getByRole('tab')).toHaveCount(2);

    await faqs.click();
    await expect(page).toHaveURL(/[?&]tab=faqs$/);
    await expect(faqs).toHaveAttribute('aria-selected', 'true');
    await expect(heading(page, 'FAQs')).toBeVisible();
    await expect(
      faqPanel(page).getByText('Questions customers ask in Main flow', { exact: false }),
    ).toBeVisible();
    await expect(
      faqPanel(page).getByRole('link', { name: 'Tab seed question', exact: true }),
    ).toBeVisible();

    await build.click();
    await expect(page).not.toHaveURL(/tab=/);
    await expect(build).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Welcome').first()).toBeVisible();
  });

  test('a member who may not read FAQs gets no FAQs tab at all', async ({ browser, watch }) => {
    watch.allow(/403/);
    const m = await member(ws, 'noreader', ['flb.flows.read']);
    const mstate = await login(browser, m.email);
    const { page } = await open(browser, mstate, watch);
    await page.goto(`/flows/simple/${ws.flowUuid}`, { timeout: 120_000 });
    await expect(page.getByRole('textbox', { name: 'Flow name' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('tab', { name: 'FAQs' })).toHaveCount(0);
    expect((await call(ws, 'GET', `${faqBase(ws)}/entries`, undefined, m.token)).status).toBe(403);
  });
});

test.describe('addresses', () => {
  let ws: Workspace;
  let state: State;
  let faqId: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    ws = await newWorkspace('pfaddr');
    state = await login(browser, ws.email);
    faqId = (await seedFaq(ws, { question: 'Address seed question', answerText: 'Seeded.' })).id;
  });

  test('every screen has its own link: a deep link, a reload and an unknown view all land right', async ({
    browser,
    watch,
  }) => {
    const { page } = await open(browser, state, watch);
    for (const [view, name] of [
      [undefined, HEADINGS.list!],
      ['new', HEADINGS.new!],
      [faqId, 'Edit FAQ'],
      ['test', HEADINGS.test!],
      ['unanswered', HEADINGS.unanswered!],
      ['insights', HEADINGS.insights!],
      ['settings', HEADINGS.settings!],
      // A view nobody knows is the list, not an empty page.
      ['nonsense', HEADINGS.list!],
    ] as const) {
      await openFaqs(page, ws, view);
      await expect(heading(page, name), `view ${view}`).toBeVisible();
      await expect(page.getByRole('tab', { name: 'FAQs' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    }
    await openFaqs(page, ws, 'settings');
    await page.reload();
    await expect(heading(page, HEADINGS.settings!)).toBeVisible({ timeout: 60_000 });
    expect(viewOf(page)).toBe('settings');
  });

  test('the browser back and forward buttons walk the screens in order', async ({
    browser,
    watch,
  }) => {
    const { page } = await open(browser, state, watch);
    await openFaqs(page, ws);
    const nav = faqPanel(page).getByRole('navigation').first();
    await nav.getByRole('link', { name: 'Test' }).click();
    await expect(heading(page, HEADINGS.test!)).toBeVisible();
    await nav.getByRole('link', { name: 'Settings' }).click();
    await expect(heading(page, HEADINGS.settings!)).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await page.goBack();
    await expect(heading(page, HEADINGS.test!)).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Test' })).toHaveAttribute('aria-current', 'page');
    await page.goBack();
    await expect(heading(page, HEADINGS.list!)).toBeVisible();
    await page.goForward();
    await expect(heading(page, HEADINGS.test!)).toBeVisible();
    await page.goForward();
    await expect(heading(page, HEADINGS.settings!)).toBeVisible();

    // The list opens an FAQ and back returns to the list.
    await nav.getByRole('link', { name: 'FAQs' }).click();
    await page.getByRole('link', { name: 'Address seed question', exact: true }).click();
    await expect(heading(page, 'Edit FAQ')).toBeVisible();
    expect(viewOf(page)).toBe(faqId);
    await page.goBack();
    await expect(heading(page, HEADINGS.list!)).toBeVisible();
  });

  test('/faq and everything under it lead to the flows', async ({ browser, watch }) => {
    const { page } = await open(browser, state, watch);
    for (const path of ['/faq', '/faq/new', `/faq/${faqId}`, '/faq/test', '/faq/anything/at/all']) {
      await page.goto(path, { timeout: 120_000 });
      await expect(page, path).toHaveURL(/\/flows$/, { timeout: 60_000 });
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    }
  });

  test('there is no FAQ entry in the menu', async ({ browser, watch }) => {
    const { page } = await open(browser, state, watch, { viewport: { width: 1440, height: 1000 } });
    await page.goto('/flows', { timeout: 120_000 });
    const menu = page.getByRole('navigation', { name: 'Main menu' });
    await expect(menu).toBeVisible({ timeout: 60_000 });
    // Open every group in turn and read every link the page offers (a group opens as a flyout, one at a time).
    const seen = new Map<string, string>();
    const read = async () => {
      const found = await page
        .locator('a[href]')
        .evaluateAll((as) =>
          as.map((a) => [a.getAttribute('href') ?? '', (a.textContent ?? '').trim()] as const),
        );
      for (const [href, text] of found) seen.set(href, text);
    };
    await read();
    const groups = menu.getByRole('button');
    const count = await groups.count();
    for (let i = 0; i < count; i++) {
      await groups.nth(i).click();
      await read();
      await page.keyboard.press('Escape');
    }
    expect(seen.size, 'the menu links that were read').toBeGreaterThan(10);
    expect(
      [...seen].filter(([href, text]) => /^\/faq(\/|$|\?)/.test(href) || /^FAQs?$/i.test(text)),
    ).toEqual([]);
  });
});

test.describe('the builders', () => {
  test('the Advanced builder has no FAQs tab, and the Simple one keeps the flow it was editing', async ({
    browser,
    watch,
  }) => {
    const ws = await newWorkspace('pfadv', { builder: 'advanced' });
    const uuid = twoSteps(ws, 'Canvas flow');
    const state = await login(browser, ws.email);
    const { page } = await open(browser, state, watch, { viewport: { width: 1440, height: 1000 } });
    await page.goto(`/flows/builder/${uuid}`, { timeout: 120_000 });
    await page.locator('[data-testid="canvas"]').waitFor({ timeout: 120_000 });
    await expect(page.getByRole('tab', { name: 'FAQs' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'FAQs', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tablist', { name: 'Flow sections' })).toHaveCount(0);
  });

  test('switching between Build and FAQs does not lose what was edited and not yet saved', async ({
    browser,
    watch,
  }) => {
    const ws = await newWorkspace('pfedit');
    const state = await login(browser, ws.email);
    const { page } = await open(browser, state, watch, { viewport: { width: 1440, height: 1000 } });
    await page.goto(`/flows/simple/${ws.flowUuid}`, { timeout: 120_000 });
    const name = page.getByRole('textbox', { name: 'Flow name' });
    await expect(name).toHaveValue('Main flow', { timeout: 60_000 });
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeDisabled();

    await name.fill('Renamed and not saved');
    // Open the message step (the steps are collapsed) and change its text.
    await page.getByRole('button', { name: /^1\.1 Message/ }).click();
    const text = page.locator('textarea').first();
    await text.fill('Welcome, edited and not saved');
    await expect(save).toBeEnabled();

    for (let round = 0; round < 2; round++) {
      await page.getByRole('tab', { name: 'FAQs' }).click();
      await expect(heading(page, 'FAQs')).toBeVisible();
      await page.getByRole('tab', { name: 'Build' }).click();
      await expect(name).toHaveValue('Renamed and not saved');
      await expect(page.locator('textarea').first()).toHaveValue('Welcome, edited and not saved');
      await expect(save).toBeEnabled();
    }
    // Nothing was saved by switching, and one save keeps the edits.
    expect(
      sqlOne(`SELECT flow_name FROM flows WHERE org_id=${ws.orgId} AND uuid='${ws.flowUuid}'`),
    ).toBe('Main flow');
    await save.click();
    await expect(save).toBeDisabled({ timeout: 30_000 });
    expect(
      sqlOne(`SELECT flow_name FROM flows WHERE org_id=${ws.orgId} AND uuid='${ws.flowUuid}'`),
    ).toBe('Renamed and not saved');
  });

  test('an FAQ with unsaved edits asks before the builder leaves the tab', async ({
    browser,
    watch,
  }) => {
    const ws = await newWorkspace('pfleave');
    const state = await login(browser, ws.email);
    const { page } = await open(browser, state, watch, { viewport: { width: 1440, height: 1000 } });
    await openFaqs(page, ws, 'new');
    await questionBox(page).fill('Typed and not saved');

    await page.getByRole('tab', { name: 'Build' }).click();
    const dialog = page.getByRole('dialog', { name: 'Leave the FAQs without saving?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep editing' }).click();
    await expect(dialog).toBeHidden();
    await expect(heading(page, 'New FAQ')).toBeVisible();
    await expect(questionBox(page)).toHaveValue('Typed and not saved');

    await page.getByRole('tab', { name: 'Build' }).click();
    await dialog.getByRole('button', { name: 'Leave' }).click();
    await expect(faqPanel(page)).toBeHidden();
    await expect(page.getByRole('tab', { name: 'Build' })).toHaveAttribute('aria-selected', 'true');
    expect((await entries(ws)).data).toHaveLength(0);
    // Without unsaved edits the tab changes without asking.
    await page.getByRole('tab', { name: 'FAQs' }).click();
    await page.getByRole('tab', { name: 'Build' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('two flows in one workspace share nothing', () => {
  let ws: Workspace;
  let state: State;
  let flowB: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    ws = await newWorkspace('pftwo');
    flowB = twoSteps(ws, 'Second flow');
    state = await login(browser, ws.email);
  });

  test('the same question can live in both flows; inside one flow it is refused', async ({
    browser,
    watch,
  }) => {
    watch.allow(/409/);
    const q = 'Do you give student discounts?';
    const a = await seedFaq(ws, { question: q, answerText: 'Answer in flow one.' });
    const b = await seedFaq(ws, { question: q, answerText: 'Answer in flow two.', owner: flowB });
    expect(a.id).not.toBe(b.id);
    // Each flow's list holds its own, with its own answer.
    expect((await entries(ws)).data.map((e: any) => e.answerPreview)).toEqual([
      'Answer in flow one.',
    ]);
    expect((await entries(ws, '', flowB)).data.map((e: any) => e.answerPreview)).toEqual([
      'Answer in flow two.',
    ]);
    // A flow's FAQ is not reachable through another flow.
    expect((await call(ws, 'GET', `${faqBase(ws, flowB)}/entries/${a.id}`)).status).toBe(404);
    expect((await call(ws, 'GET', `${faqBase(ws)}/entries/${b.id}`)).status).toBe(404);

    // The same question twice in one flow, even in other letters and spacing: refused, in the API and on the screen.
    const dup = await call(ws, 'POST', `${faqBase(ws)}/entries`, {
      question: ' do you GIVE student   discounts? ',
      answerType: 'text',
      answerText: 'x',
    });
    expect(dup.status).toBe(409);
    const { page } = await open(browser, state, watch);
    await openFaqs(page, ws, 'new');
    await questionBox(page).fill('DO you give student discounts?');
    await page.getByLabel('Answer text').fill('A duplicate.');
    await page.getByRole('button', { name: 'Create FAQ' }).click();
    await expect(page.getByText('Another FAQ already has this question.')).toBeVisible();

    // Flow two's screen shows its own FAQ and nothing from flow one.
    await openFaqs(page, flowB);
    await expect(page.getByRole('link', { name: q, exact: true })).toHaveCount(1);
    await expect(page.getByText('Answer in flow two.')).toBeVisible();
    await expect(page.getByText('Answer in flow one.')).toHaveCount(0);
    await expect(faqPanel(page).getByRole('group', { name: 'FAQ totals' })).toContainText('1');
  });

  test('settings are per flow: the switch, the sensitivity, the lead and the log setting', async ({
    browser,
    watch,
  }) => {
    const own = await newWorkspace('pfsettings');
    const ownB = twoSteps(own, 'Flow B');
    const ownState = await login(browser, own.email);
    await putSettings(own, { enabled: true, threshold: 0.9, minMargin: 0.2, logQueries: false });
    const a = await getSettings(own);
    const b = await getSettings(own, ownB);
    expect(a).toMatchObject({ enabled: true, threshold: 0.9, minMargin: 0.2, logQueries: false });
    expect(b).toMatchObject({ enabled: false, logQueries: true });
    expect(b.threshold).not.toBe(0.9);
    expect(b.minMargin).toBe(0);

    const { page } = await open(browser, ownState, watch);
    await openFaqs(page, own, 'settings');
    const answer = page.getByRole('switch', { name: "Answer customers with this flow's FAQs" });
    const sens = page.getByRole('slider', { name: 'Answer when the match is at least' });
    await expect(answer).toBeChecked();
    await expect(sens).toHaveAttribute('aria-valuetext', '90%');
    await openFaqs(page, ownB, 'settings');
    await expect(answer).not.toBeChecked();
    await expect(sens).not.toHaveAttribute('aria-valuetext', '90%');
    await expect(
      page.getByRole('switch', { name: 'Keep customer messages in the match log' }),
    ).toBeChecked();
    await expect(
      faqPanel(page).getByText('Switch FAQ answering on for Flow B', { exact: false }),
    ).toBeVisible();

    // Saving one flow's settings does not touch the other's, and each keeps its own version for conflicts.
    await answer.click();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Settings saved.')).toBeVisible();
    expect((await getSettings(own, ownB)).enabled).toBe(true);
    expect(await getSettings(own)).toMatchObject({ enabled: true, threshold: 0.9 });
    await putSettings(own, { enabled: false }, ownB);
    expect((await getSettings(own)).enabled).toBe(true);
  });

  test('the log, the unanswered messages and the insights of each flow hold only its own messages', async ({
    browser,
    watch,
  }) => {
    test.setTimeout(600_000);
    const own = await newWorkspace('pflog');
    const sim1 = await simulator(own, 'Channel one');
    const sim2 = await simulator(own, 'Channel two');
    const flowTwo = twoSteps(own, 'Flow two');
    bindFlow(own, own.flowUuid, sim1);
    bindFlow(own, flowTwo, sim2);
    await seedFaq(own, { question: 'Where is my parcel now', answerText: 'Parcel in flow one.' });
    await seedFaq(own, {
      owner: flowTwo,
      question: 'What are your weekend hours',
      answerText: 'Hours in flow two.',
    });
    await waitIndexed(own);
    await putSettings(own, { enabled: true, threshold: 0.8 });
    await putSettings(own, { enabled: true, threshold: 0.8 }, flowTwo);

    const one = await customerAsks(
      own,
      sim1,
      'where is my parcel now',
      (f) => repliesTo(own, f).length >= 1,
    );
    const oneMiss = await customerAsks(own, sim1, 'zzqq xxww nothing alike');
    const two = await customerAsks(
      own,
      sim2,
      'what are your weekend hours',
      (f) => repliesTo(own, f).length >= 1,
    );
    expect(repliesTo(own, one)).toEqual(['Parcel in flow one.']);
    expect(repliesTo(own, oneMiss)).toEqual([]);
    expect(repliesTo(own, two)).toEqual(['Hours in flow two.']);

    const queries = (flow: string) => logRowsOf(own, flow).map((r) => r[0]);
    expect(queries(own.flowUuid).sort()).toEqual([
      'where is my parcel now',
      'zzqq xxww nothing alike',
    ]);
    expect(queries(flowTwo)).toEqual(['what are your weekend hours']);

    const { page } = await open(browser, await login(browser, own.email), watch, {
      viewport: { width: 1440, height: 1000 },
    });
    // Insights: the numbers and the log of each flow.
    await openFaqs(page, own, 'insights');
    const kpi = faqPanel(page).getByRole('group', { name: 'Key numbers' });
    await expect(kpi.getByText('Messages checked', { exact: true }).locator('..')).toContainText(
      '2',
    );
    const log = faqPanel(page).getByRole('region', { name: 'Match log' });
    await expect(log).toContainText('where is my parcel now');
    await expect(log).not.toContainText('weekend hours');
    await openFaqs(page, flowTwo, 'insights');
    await expect(kpi.getByText('Messages checked', { exact: true }).locator('..')).toContainText(
      '1',
    );
    await expect(log).toContainText('what are your weekend hours');
    await expect(log).not.toContainText('where is my parcel');
    // Unanswered: only the miss of flow one is waiting there, and nothing in flow two.
    await openFaqs(page, own, 'unanswered');
    await expect(faqPanel(page).getByText('zzqq xxww nothing alike')).toBeVisible();
    await openFaqs(page, flowTwo, 'unanswered');
    await expect(faqPanel(page).getByText('Nothing waiting')).toBeVisible();
    await expect(faqPanel(page).getByText('zzqq xxww nothing alike')).toHaveCount(0);
    // The API agrees, per flow.
    const sum1 = (await call(own, 'GET', `${faqBase(own)}/insights/summary?days=30`)).body;
    const sum2 = (await call(own, 'GET', `${faqBase(own, flowTwo)}/insights/summary?days=30`)).body;
    expect(sum1.totals).toMatchObject({ messages: 2, answered: 1, unanswered: 1 });
    expect(sum2.totals).toMatchObject({ messages: 1, answered: 1, unanswered: 0 });
  });

  test('deleting a flow deletes its FAQs, and only its FAQs', async () => {
    const own = await newWorkspace('pfdelete');
    const doomed = twoSteps(own, 'Doomed flow');
    const doomedId = flowIdOf(own, doomed);
    await seedFaq(own, { owner: doomed, question: 'Doomed one', variations: ['doomed uno'] });
    await seedFaq(own, { owner: doomed, question: 'Doomed two' });
    await seedFaq(own, { question: 'Survivor', variations: ['survivor uno'] });
    await putSettings(own, { enabled: true }, doomed);
    await waitIndexed(own);
    const count = (table: string, col = 'owner_flow_id') =>
      Number(
        sqlOne(`SELECT count(*) FROM ${table} WHERE org_id=${own.orgId} AND ${col}=${doomedId}`),
      );
    expect(count('faqs')).toBe(2);

    const del = await call(own, 'DELETE', `/v2/flows/${doomed}`);
    expect(del.status, JSON.stringify(del.body)).toBeLessThan(300);
    expect(count('faqs')).toBe(0);
    expect(
      Number(
        sqlOne(
          `SELECT count(*) FROM faq_variations v JOIN faqs f ON f.org_id=v.org_id AND f.id=v.faq_id WHERE v.org_id=${own.orgId} AND f.owner_flow_id=${doomedId}`,
        ),
      ),
    ).toBe(0);
    expect(count('faq_settings', 'flow_id')).toBe(0);
    // The FAQs of the other flow are untouched, and the deleted flow's FAQ routes say it is gone.
    expect((await entries(own)).data.map((e: any) => e.question)).toEqual(['Survivor']);
    expect(
      (await call(own, 'GET', `${faqBase(own, doomed)}/entries`)).status,
    ).toBeGreaterThanOrEqual(400);
  });

  test('the platform limit is per flow: a full flow cannot add, the next flow still can', async ({
    browser,
    watch,
  }) => {
    test.setTimeout(180_000);
    const own = await newWorkspace('pflimit');
    const other = twoSteps(own, 'Roomy flow');
    const ownState = await login(browser, own.email);
    await seedFaq(own, { question: 'Limit one' });
    await seedFaq(own, { question: 'Limit two' });
    const op = await operator();
    const was = (await op.get()).config;
    try {
      await op.patch({ maxFaqs: 2 });
      const full = await call(own, 'POST', `${faqBase(own)}/entries`, {
        question: 'Limit three',
        answerType: 'text',
        answerText: 'x',
      });
      expect(full.status).toBe(422);
      expect(JSON.stringify(full.body)).toMatch(/LIMIT/i);
      // The other flow of the same workspace has its own two.
      await seedFaq(own, { owner: other, question: 'Roomy one' });
      await seedFaq(own, { owner: other, question: 'Roomy two' });
      expect((await entries(own, '', other)).data).toHaveLength(2);

      const { page } = await open(browser, ownState, watch);
      await openFaqs(page, own, 'new');
      await expect(
        page.getByText('This flow is at its limit of 2 FAQs. Delete one to add another.'),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create FAQ' })).toBeDisabled();
      await openFaqs(page, own, 'settings');
      await expect(page.getByText('2 of 2')).toBeVisible();

      // A third flow, empty, has all its room.
      const third = twoSteps(own, 'Third flow');
      await openFaqs(page, third, 'new');
      await expect(page.getByText(/is at its limit/)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Create FAQ' })).toBeEnabled();
    } finally {
      await op.patch({ maxFaqs: was.maxFaqs });
      await op.dispose();
    }
  });
});

test.describe('where an FAQ sends the customer', () => {
  let ws: Workspace;
  let state: State;
  let target: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    ws = await newWorkspace('pftarget');
    target = seedStepsFlow(ws, 'Elsewhere flow');
    state = await login(browser, ws.email);
  });

  test("the picker starts on a step of this flow and lists this flow's steps; another flow is the second choice", async ({
    browser,
    watch,
  }) => {
    const { page } = await open(browser, state, watch);
    await openFaqs(page, ws, 'new');
    await questionBox(page).fill('Take me back to the welcome');
    await page.getByRole('tab', { name: 'Go to a step' }).click();
    const here = page.getByRole('radio', { name: /A step of this flow/ });
    const other = page.getByRole('radio', { name: /A step of another flow/ });
    await expect(here).toBeChecked();
    await expect(other).not.toBeChecked();
    await expect(page.getByText('The customer continues inside Main flow.')).toBeVisible();
    const select = page.getByLabel('Go to', { exact: true });
    await expect(select).toBeEnabled();
    // This flow's own steps (the trigger is the flow's start), and no flow chooser.
    await expect(select.locator('option')).toHaveText(["The flow's start", 'Send message · #a']);
    await expect(page.getByRole('searchbox', { name: 'Search flows' })).toHaveCount(0);

    await select.selectOption('a');
    await page.getByRole('button', { name: 'Create FAQ' }).click();
    await expect(page.getByText('FAQ created.')).toBeVisible();
    const made = (await entries(ws)).data.find(
      (e: any) => e.question === 'Take me back to the welcome',
    );
    expect(made).toMatchObject({ answerType: 'flow', flowId: ws.flowUuid, flowNodeId: 'a' });
    // The list names it as this flow.
    await openFaqs(page, ws);
    const row = page.locator('tbody tr').filter({ hasText: 'Take me back to the welcome' });
    await expect(row).toContainText('This flow');
    await expect(row).toContainText('Goes to:');

    // The second choice: the flow chooser lists the other flows of the workspace and never this one.
    await openFaqs(page, ws, made.id);
    await expect(page.getByRole('radio', { name: /A step of this flow/ })).toBeChecked();
    await other.check();
    await expect(page.getByRole('searchbox', { name: 'Search flows' })).toBeVisible();
    await expect(page.getByRole('option', { name: /Elsewhere flow/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /Main flow/ })).toHaveCount(0);
    await page
      .getByRole('option', { name: /Elsewhere flow/ })
      .getByRole('button')
      .click();
    await page.getByLabel('Go to', { exact: true }).selectOption('b');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('FAQ saved.')).toBeVisible();
    expect((await call(ws, 'GET', `${faqBase(ws)}/entries/${made.id}`)).body).toMatchObject({
      flowId: target,
      flowNodeId: 'b',
      flowName: 'Elsewhere flow',
    });
    // And back to this flow: the step of the other flow is not kept.
    await page.getByRole('radio', { name: /A step of this flow/ }).check();
    await expect(page.getByLabel('Go to', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect
      .poll(async () => (await call(ws, 'GET', `${faqBase(ws)}/entries/${made.id}`)).body)
      .toMatchObject({ flowId: ws.flowUuid, flowNodeId: null });
  });

  test('a workspace with one flow has no other flow to hand the customer to', async ({
    browser,
    watch,
  }) => {
    const solo = await newWorkspace('pfsolo');
    const soloState = await login(browser, solo.email);
    const { page } = await open(browser, soloState, watch);
    await openFaqs(page, solo, 'new');
    await page.getByRole('tab', { name: 'Go to a step' }).click();
    await page.getByRole('radio', { name: /A step of another flow/ }).check();
    await expect(page.getByText('There is no other flow in this workspace.')).toBeVisible();
  });
});

test.describe('the FAQ step of a flow', () => {
  test("its inspector speaks of this flow's FAQs and links to the FAQs tab of this flow", async ({
    browser,
    watch,
  }) => {
    const ws = await newWorkspace('pfstep', { builder: 'advanced' });
    const empty = seedBuilderFlow(
      ws,
      'Step flow',
      [
        { id: 't', type: 'trigger', x: 60, y: 120 },
        {
          id: 'f',
          type: 'faq',
          x: 540,
          y: 200,
          data: {
            query: '{{user_message}}',
            category: '',
            minScore: null,
            sendAnswer: true,
            save: 'faq',
          },
        },
      ],
      [['t', 'out', 'f']],
    );
    const state = await login(browser, ws.email);
    const { page } = await open(browser, state, watch, { viewport: { width: 1600, height: 1000 } });
    await page.goto(`/flows/builder/${empty}`, { timeout: 120_000 });
    await page.locator('[data-testid="canvas"]').waitFor({ timeout: 120_000 });
    await page.locator('[data-node-id="f"] .chip-icon + div > div').first().click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    await expect(inspector.getByText(/^This flow has no FAQs yet/)).toBeVisible();
    await expect(
      inspector.getByRole('link', { name: 'Add the first FAQ of this flow' }),
    ).toHaveAttribute('href', faqUrl(empty, 'new'));
    const manage = inspector.getByRole('link', { name: "Manage this flow's FAQs" });
    await expect(manage).toHaveAttribute('href', faqUrl(empty));

    // The FAQs of ANOTHER flow of the workspace do not count: this flow still has none.
    await seedFaq(ws, { question: 'Belongs elsewhere', category: 'Elsewhere' });
    await page.reload();
    await page.locator('[data-testid="canvas"]').waitFor({ timeout: 120_000 });
    await page.locator('[data-node-id="f"] .chip-icon + div > div').first().click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(inspector.getByText(/^This flow has no FAQs yet/)).toBeVisible();
    await expect(inspector.locator('select option')).toHaveText(['All FAQs']);

    // The link goes to the FAQs tab of this very flow. (App defect D3, see the report: in a workspace on the Advanced builder the
    // Simple route sends the person straight back to the canvas, so the FAQs cannot be reached from the step.)
    await manage.click();
    await expect(page).toHaveURL(new RegExp(`/flows/simple/${empty}\\?tab=faqs`), {
      timeout: 60_000,
    });
    await expect(heading(page, 'FAQs')).toBeVisible({ timeout: 60_000 });
    await expect(faqPanel(page).getByText('Belongs elsewhere')).toHaveCount(0);
  });
});

/**
 * A simulated customer writes in. Every scenario has its own channel(s) and flows, so what one scenario seeds never answers in another.
 * A flow answers only when it is published, active, switched on, has an active FAQ and sits on the channel the message came in on.
 */
test.describe('what a customer gets, and from which flow', () => {
  test.describe.configure({ timeout: 600_000 });
  let n = 0;
  const tag = () => `pfj${Date.now().toString(36)}${n++}`;

  /** The text the customer receives, once the FAQ engine has looked at the message. */
  async function ask(
    ws: Workspace,
    sim: Awaited<ReturnType<typeof simulator>>,
    text: string,
    replies = 0,
  ) {
    const from = await customerAsks(ws, sim, text, (f) => repliesTo(ws, f).length >= replies);
    if (replies === 0) await new Promise((r) => setTimeout(r, 2500));
    return { from, got: repliesTo(ws, from) };
  }

  test("a flow's FAQs answer on its own channel and never on another flow's channel", async () => {
    const ws = await newWorkspace('pfjchan');
    const chanA = await simulator(ws, 'Channel A');
    const chanB = await simulator(ws, 'Channel B');
    const flowB = twoSteps(ws, 'Flow B');
    bindFlow(ws, ws.flowUuid, chanA);
    bindFlow(ws, flowB, chanB);
    const t = tag();
    await seedFaq(ws, { question: `${t} ship abroad`, answerText: 'A says: we ship abroad.' });
    await seedFaq(ws, {
      owner: flowB,
      question: `${t} weekend hours`,
      answerText: 'B says: nine to five.',
    });
    await waitIndexed(ws);
    await putSettings(ws, { enabled: true });
    await putSettings(ws, { enabled: true }, flowB);

    // Each flow answers its own question on its own channel.
    expect((await ask(ws, chanA, `${t} ship abroad`, 1)).got).toEqual(['A says: we ship abroad.']);
    expect((await ask(ws, chanB, `${t} weekend hours`, 1)).got).toEqual(['B says: nine to five.']);
    // And stays silent for the other flow's question: the flow of that channel looks at it and finds nothing.
    expect((await ask(ws, chanA, `${t} weekend hours`)).got).toEqual([]);
    expect((await ask(ws, chanB, `${t} ship abroad`)).got).toEqual([]);

    // The log is per flow: each flow has its answered message and the message it could not answer.
    const rows = (flow: string) =>
      logRowsOf(ws, flow)
        .map((r) => `${r[0]} | ${r[1]}`)
        .sort();
    expect(rows(ws.flowUuid)).toEqual(
      [`${t} ship abroad | answered`, `${t} weekend hours | below_threshold`].sort(),
    );
    expect(rows(flowB)).toEqual(
      [`${t} ship abroad | below_threshold`, `${t} weekend hours | answered`].sort(),
    );
  });

  test('two flows on one channel: the closest FAQ wins whichever flow it is in', async () => {
    const ws = await newWorkspace('pfjbest');
    const chan = await simulator(ws);
    const second = twoSteps(ws, 'Second flow');
    bindFlow(ws, ws.flowUuid, chan);
    bindFlow(ws, second, chan);
    const t = tag();
    await seedFaq(ws, {
      question: `${t} cancel my subscription`,
      answerText: 'First flow: cancel here.',
    });
    await seedFaq(ws, {
      owner: second,
      question: `${t} pause my subscription`,
      answerText: 'Second flow: pause here.',
    });
    await waitIndexed(ws);
    await putSettings(ws, { enabled: true, threshold: 0.5 });
    await putSettings(ws, { enabled: true, threshold: 0.5 }, second);

    expect((await ask(ws, chan, `${t} cancel my subscription`, 1)).got).toEqual([
      'First flow: cancel here.',
    ]);
    expect((await ask(ws, chan, `${t} pause my subscription`, 1)).got).toEqual([
      'Second flow: pause here.',
    ]);
    // One log row per message, in the flow that answered.
    expect(logRowsOf(ws, ws.flowUuid).map((r) => r[0])).toEqual([`${t} cancel my subscription`]);
    expect(logRowsOf(ws, second).map((r) => r[0])).toEqual([`${t} pause my subscription`]);
  });

  test('a tie goes to the lowest flow, and to the flow the customer is already in when there is one', async () => {
    const ws = await newWorkspace('pfjlive');
    const chan = await simulator(ws);
    // The customer's flow parks them in a delay (a live, sleeping run) and is keyword started.
    const parking = seedBuilderFlow(
      ws,
      'Parking flow',
      [
        { id: 't', type: 'trigger' },
        { id: 'd', type: 'delay', data: { amount: 60, unit: 'min' } },
        { id: 'z', type: 'end' },
      ],
      [
        ['t', 'out', 'd'],
        ['d', 'out', 'z'],
      ],
      { keywords: 'parkme' },
    );
    expect(flowIdOf(ws, ws.flowUuid)).toBeLessThan(flowIdOf(ws, parking));
    bindFlow(ws, ws.flowUuid, chan);
    bindFlow(ws, parking, chan);
    const t = tag();
    // The same question in both flows: a tie at 100%.
    await seedFaq(ws, { question: `${t} holiday schedule`, answerText: 'From the early flow.' });
    await seedFaq(ws, {
      owner: parking,
      question: `${t} holiday schedule`,
      answerText: 'From the parking flow.',
    });
    await waitIndexed(ws);
    await putSettings(ws, { enabled: true });
    await putSettings(ws, { enabled: true }, parking);

    expect((await ask(ws, chan, `${t} holiday schedule`, 1)).got).toEqual(['From the early flow.']);

    // A customer parked in the second flow: it is tried first and wins the tie.
    const from = `9196${String(Date.now()).slice(-7)}01`;
    await customerSays(ws, chan, 'parkme', from);
    await expect
      .poll(
        () =>
          sql(
            `SELECT 1 FROM flow_runs r JOIN flows f ON f.org_id=r.org_id AND f.id=r.flow_id WHERE r.org_id=${ws.orgId} AND f.uuid='${parking}' AND r.status='sleeping'`,
          ).length,
        { timeout: 120_000, intervals: [1000, 2000] },
      )
      .toBeGreaterThan(0);
    await customerSays(ws, chan, `${t} holiday schedule`, from);
    await expect
      .poll(() => repliesTo(ws, from), { timeout: 120_000, intervals: [1000, 2000] })
      .toEqual(['From the parking flow.']);
    expect(logRowsOf(ws, parking).map((r) => `${r[0]} | ${r[1]}`)).toEqual([
      `${t} holiday schedule | answered`,
    ]);
  });

  test('switching one flow off silences that flow only', async () => {
    const ws = await newWorkspace('pfjoff');
    const chan = await simulator(ws);
    const second = twoSteps(ws, 'Second flow');
    bindFlow(ws, ws.flowUuid, chan);
    bindFlow(ws, second, chan);
    const t = tag();
    await seedFaq(ws, { question: `${t} refund policy`, answerText: 'One: refunds.' });
    await seedFaq(ws, {
      owner: second,
      question: `${t} delivery times`,
      answerText: 'Two: deliveries.',
    });
    await waitIndexed(ws);
    await putSettings(ws, { enabled: true });
    await putSettings(ws, { enabled: true }, second);
    expect((await ask(ws, chan, `${t} refund policy`, 1)).got).toEqual(['One: refunds.']);
    expect((await ask(ws, chan, `${t} delivery times`, 1)).got).toEqual(['Two: deliveries.']);

    // The first flow is switched off: its FAQ is silent, the second flow still answers.
    await answering(ws, false);
    expect((await ask(ws, chan, `${t} refund policy`)).got).toEqual([]);
    expect((await ask(ws, chan, `${t} delivery times`, 1)).got).toEqual(['Two: deliveries.']);
    // The switch is in the screen too, per flow.
    expect((await getSettings(ws)).enabled).toBe(false);
    expect((await getSettings(ws, second)).enabled).toBe(true);

    // Back on: it answers again.
    await answering(ws, true);
    expect((await ask(ws, chan, `${t} refund policy`, 1)).got).toEqual(['One: refunds.']);
  });

  test('an FAQ that goes to a step of its own flow takes the customer there', async () => {
    const ws = await newWorkspace('pfjstep');
    const chan = await simulator(ws);
    bindFlow(ws, ws.flowUuid, chan);
    const t = tag();
    await seedFaq(ws, {
      question: `${t} start over`,
      flowId: ws.flowUuid,
      flowNodeId: 'a',
    });
    await waitIndexed(ws);
    await putSettings(ws, { enabled: true });
    // The step "Welcome" of this very flow is what the customer receives.
    expect((await ask(ws, chan, `${t} start over`, 1)).got).toEqual(['Welcome']);
    expect(
      Number(
        sqlOne(
          `SELECT count(*) FROM faq_match_logs WHERE org_id=${ws.orgId} AND outcome='flow_started'`,
        ),
      ),
    ).toBe(1);
  });
});
