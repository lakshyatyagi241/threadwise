import {
  call,
  customerAsks,
  deleteFlow,
  entries,
  expect,
  go,
  login,
  member,
  newWorkspace,
  open,
  putSettings,
  questionBox,
  repliesTo,
  seedFaq,
  seedStepsFlow,
  setFlowNodes,
  simulator,
  sqlOne,
  tabTo,
  test,
  waitIndexed,
  type Sim,
  type State,
  type Workspace,
} from './support';
import type { Page } from '@playwright/test';

test.describe.configure({ timeout: 120_000 });

/**
 * "Link to node": a FAQ that starts a flow can start it at one of the flow's steps. The picker, what is saved, what the list says, the
 * warning when the step is deleted later, who may change it, and what a customer really receives.
 */
let ws: Workspace;
let state: State;
let n = 0;
const tag = () => `Lnk${Date.now().toString(36)}${(n++).toString(36)}`;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  ws = await newWorkspace('linknode');
  state = await login(browser, ws.email);
});

const entry = async (id: string) => (await call(ws, 'GET', `/v2/faq/entries/${id}`)).body;
/** The update call as the editor makes it: the whole entry again, with these fields changed. */
const patchEntry = async (id: string, changes: Record<string, unknown>, as?: string) => {
  const cur = await entry(id);
  return call(
    ws,
    'PATCH',
    `/v2/faq/entries/${id}`,
    {
      question: cur.question,
      answerType: cur.answerType,
      answerText: cur.answerText,
      flowId: cur.flowId,
      flowNodeId: cur.flowNodeId,
      category: cur.category,
      status: cur.status,
      rowVersion: cur.rowVersion,
      ...changes,
    },
    as,
  );
};
const startAt = (page: Page) => page.getByLabel('Start at', { exact: true });
const optionTexts = (page: Page) =>
  startAt(page)
    .locator('option')
    .evaluateAll((os) => os.map((o) => o.textContent ?? ''));
const flowTab = (page: Page) => page.getByRole('tab', { name: 'Start a flow' });
const save = (page: Page) => page.getByRole('button', { name: 'Save changes' });

/** The flow chooser of the editor: open the flow tab and click the flow of that name. */
async function pickFlow(page: Page, name: string) {
  await flowTab(page).click();
  await page.getByRole('searchbox', { name: 'Search flows' }).fill(name);
  await page
    .getByRole('option', { name: new RegExp(name) })
    .getByRole('button')
    .click();
  await expect(page.getByRole('option', { name: new RegExp(name) })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}

/** A flow of three steps whose names can be chosen, for the tests about what the picker shows. */
function seedNamedFlow(name: string, labels: Array<[string, string]>): string {
  const nodes = [
    { id: 't', type: 'trigger', data: {}, isStart: true },
    ...labels.map(([id, label]) => ({ id, type: 'message', data: { label, text: `says ${id}` } })),
  ];
  const edges = labels.map(([id], i) => ({
    source: i === 0 ? 't' : labels[i - 1]![0],
    sourceHandle: 'out',
    target: id,
  }));
  return sqlOne(
    `INSERT INTO flows (org_id, flow_name, flow_data, trigger_kind, is_published, is_active, provider, flow_type)
     VALUES (${ws.orgId}, '${name.replace(/'/g, "''")}', '${JSON.stringify({ flowNodes: nodes, flowEdges: edges, vars: {} }).replace(/'/g, "''")}'::jsonb, 'keyword', true, true, 'simulator', 'chat')
     RETURNING uuid`,
  )!;
}

test.describe('the "Start at" picker', () => {
  test('lists the flow start and every step, and creating the FAQ saves the chosen step', async ({
    browser,
    watch,
  }) => {
    const t = tag();
    const flowId = seedStepsFlow(ws, `${t} flow`);
    const { page } = await open(browser, state, watch);
    await go(page, '/faq/new');
    // Nothing to start at before a flow is chosen.
    await flowTab(page).click();
    await expect(startAt(page)).toHaveCount(0);

    await questionBox(page).fill(`${t} question`);
    await pickFlow(page, `${t} flow`);
    await expect(startAt(page)).toBeVisible();
    // The end state: the steps are loaded and the select can be used (the skeleton may be too quick to see).
    await expect(startAt(page)).toBeEnabled();
    await expect(page.getByText('Loading the steps of this flow')).toHaveCount(0);
    await expect(startAt(page)).toHaveValue('');
    expect(await optionTexts(page)).toEqual([
      "The flow's start",
      'Send message · #a',
      'Send message · Second',
      expect.stringMatching(/^.+ · #z$/),
    ]);
    await expect(
      page.getByText('Choose a step to skip the beginning of the flow.', { exact: false }),
    ).toBeVisible();

    await startAt(page).selectOption({ label: 'Send message · Second' });
    await expect(startAt(page)).toHaveValue('b');
    await page.getByRole('button', { name: 'Create FAQ' }).click();
    await expect(page.getByText('FAQ created.')).toBeVisible();
    await page.waitForURL(/\/faq\/[0-9a-f-]{36}$/);
    const id = page.url().split('/').pop()!;
    expect(await entry(id)).toMatchObject({
      answerType: 'flow',
      flowId,
      flowNodeId: 'b',
      flowNodeLabel: 'Second',
    });

    // It is still chosen after a reload, and the select is clean.
    await page.reload();
    await expect(flowTab(page)).toHaveAttribute('aria-selected', 'true');
    await expect(startAt(page)).toHaveValue('b');
    await expect(save(page)).toBeDisabled();
  });

  test('going back to "The flow\'s start" saves no step', async ({ browser, watch }) => {
    const t = tag();
    const flowId = seedStepsFlow(ws, `${t} flow`);
    const faq = await seedFaq(ws, { question: `${t} q`, flowId, flowNodeId: 'b' });
    expect(faq.flowNodeId).toBe('b');
    const { page } = await open(browser, state, watch);
    await go(page, `/faq/${faq.id}`);
    await expect(startAt(page)).toHaveValue('b');
    await startAt(page).selectOption({ label: "The flow's start" });
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await save(page).click();
    await expect(page.getByText('FAQ saved.')).toBeVisible();
    expect(await entry(faq.id)).toMatchObject({ flowId, flowNodeId: null, flowNodeLabel: null });
    await page.reload();
    await expect(startAt(page)).toHaveValue('');
  });

  test('choosing another flow clears the step; choosing the same flow again keeps it', async ({
    browser,
    watch,
  }) => {
    const t = tag();
    const one = seedStepsFlow(ws, `${t} one`);
    const two = seedNamedFlow(`${t} two`, [
      ['x1', 'Alpha'],
      ['x2', 'Beta'],
    ]);
    const faq = await seedFaq(ws, { question: `${t} q`, flowId: one, flowNodeId: 'b' });
    const { page } = await open(browser, state, watch);
    await go(page, `/faq/${faq.id}`);
    await expect(startAt(page)).toHaveValue('b');

    // The same flow chosen again: the step stays.
    await page.getByRole('searchbox', { name: 'Search flows' }).fill(`${t} one`);
    await page
      .getByRole('option', { name: new RegExp(`${t} one`) })
      .getByRole('button')
      .click();
    await expect(startAt(page)).toHaveValue('b');

    await page.getByRole('searchbox', { name: 'Search flows' }).fill(`${t} two`);
    await page
      .getByRole('option', { name: new RegExp(`${t} two`) })
      .getByRole('button')
      .click();
    await expect(startAt(page)).toHaveValue('');
    await expect
      .poll(() => optionTexts(page))
      .toEqual(["The flow's start", 'Send message · Alpha', 'Send message · Beta']);
    await startAt(page).selectOption('x2');
    await save(page).click();
    await expect(page.getByText('FAQ saved.')).toBeVisible();
    expect(await entry(faq.id)).toMatchObject({ flowId: two, flowNodeId: 'x2' });

    // And back to the first flow: it starts clean, not on a step the other flow does not have.
    await page.getByRole('searchbox', { name: 'Search flows' }).fill(`${t} one`);
    await page
      .getByRole('option', { name: new RegExp(`${t} one`) })
      .getByRole('button')
      .click();
    await expect(startAt(page)).toHaveValue('');
    await save(page).click();
    await expect.poll(async () => (await entry(faq.id)).flowId).toBe(one);
    expect(await entry(faq.id)).toMatchObject({ flowNodeId: null });
  });

  test('the text answer tab drops the step', async ({ browser, watch }) => {
    const t = tag();
    const flowId = seedStepsFlow(ws, `${t} flow`);
    const faq = await seedFaq(ws, { question: `${t} q`, flowId, flowNodeId: 'b' });
    const { page } = await open(browser, state, watch);
    await go(page, `/faq/${faq.id}`);
    await expect(startAt(page)).toHaveValue('b');
    await page.getByRole('tab', { name: 'Text answer' }).click();
    await page.getByLabel('Answer text').fill('Just text now.');
    await save(page).click();
    await expect(page.getByText('FAQ saved.')).toBeVisible();
    expect(await entry(faq.id)).toMatchObject({
      answerType: 'text',
      flowId: null,
      flowNodeId: null,
      flowNodeLabel: null,
      answerText: 'Just text now.',
    });
    // Going back to a flow later (a fresh load of the saved FAQ) does not bring the old step back.
    await page.reload();
    await expect(page.getByLabel('Answer text')).toHaveValue('Just text now.');
    await pickFlow(page, `${t} flow`);
    await expect(startAt(page)).toBeEnabled();
    await expect(startAt(page)).toHaveValue('');
  });

  test('a flow with only its trigger says there are no other steps', async ({ browser, watch }) => {
    const t = tag();
    const flowId = seedNamedFlow(`${t} bare`, []);
    const { page } = await open(browser, state, watch);
    await go(page, '/faq/new');
    await pickFlow(page, `${t} bare`);
    await expect(startAt(page)).toBeEnabled();
    await expect(
      page.getByText('This flow has no other steps, so it starts at its beginning.'),
    ).toBeVisible();
    expect(await optionTexts(page)).toEqual(["The flow's start"]);
    expect((await call(ws, 'GET', `/v2/faq/flows/${flowId}/nodes`)).body.data).toEqual([
      { id: 't', type: 'trigger', label: '' },
    ]);
  });

  test('the whole choice works with the keyboard alone', async ({ browser, watch }) => {
    const t = tag();
    const flowId = seedStepsFlow(ws, `${t} flow`);
    const { page } = await open(browser, state, watch);
    await go(page, '/faq/new');
    const kb = page.keyboard;
    await tabTo(page, questionBox(page));
    await kb.type(`${t} keyboard question`);
    await flowTab(page).focus();
    await kb.press('Enter');
    await tabTo(page, page.getByRole('searchbox', { name: 'Search flows' }));
    await kb.type(`${t} flow`);
    await tabTo(
      page,
      page.getByRole('option', { name: new RegExp(`${t} flow`) }).getByRole('button'),
    );
    await kb.press('Enter');
    await expect(startAt(page)).toBeEnabled();
    await tabTo(page, startAt(page));
    await expect(startAt(page)).toBeFocused();
    // Arrow keys on the focused select move through the steps: start, #a, Second.
    await kb.press('ArrowDown');
    await kb.press('ArrowDown');
    await expect(startAt(page)).toHaveValue('b');
    await tabTo(page, page.getByRole('button', { name: 'Create FAQ' }));
    await kb.press('Enter');
    await expect(page.getByText('FAQ created.')).toBeVisible();
    const made = (await entries(ws)).data.find((e: any) => e.question === `${t} keyboard question`);
    expect(made).toMatchObject({ flowId, flowNodeId: 'b' });
  });

  test('a step whose name is markup, very long or an emoji is shown as plain, contained text', async ({
    browser,
    watch,
  }) => {
    const t = tag();
    const hostile = '<img src=x onerror="window.__xss=1"> step';
    const long = `Very long step name ${'wordy'.repeat(60)}`;
    const flowId = seedNamedFlow(`${t} odd`, [
      ['h1', hostile],
      ['h2', long],
      ['h3', 'Thanks 🙏 and 😀'],
    ]);
    const { page } = await open(browser, state, watch);
    let alerts = 0;
    page.on('dialog', (d) => {
      alerts++;
      void d.dismiss();
    });
    await go(page, '/faq/new');
    await questionBox(page).fill(`${t} odd question`);
    await pickFlow(page, `${t} odd`);
    await expect(startAt(page)).toBeEnabled();
    expect(await optionTexts(page)).toEqual([
      "The flow's start",
      `Send message · ${hostile}`,
      `Send message · ${long}`,
      'Send message · Thanks 🙏 and 😀',
    ]);
    await startAt(page).selectOption('h2');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      'the long step name must not widen the page',
    ).toBe(true);
    const box = await startAt(page).boundingBox();
    expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);

    await page.getByRole('button', { name: 'Create FAQ' }).click();
    await expect(page.getByText('FAQ created.')).toBeVisible();
    const made = (await entries(ws)).data.find((e: any) => e.question === `${t} odd question`);
    await page.goto('/faq');
    await page.getByLabel('Search FAQs').fill(`${t} odd question`);
    const row = page.locator('tbody tr').filter({ hasText: `${t} odd question` });
    await expect(row.getByText(/^Starts at: Very long step name/)).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      'the long step name must not widen the list',
    ).toBe(true);

    // The hostile name as the saved step.
    expect((await patchEntry(made.id, { flowNodeId: 'h1' })).status).toBe(200);
    await page.reload();
    await page.getByLabel('Search FAQs').fill(`${t} odd question`);
    await expect(row.getByText(`Starts at: ${hostile}`, { exact: false })).toBeVisible();
    await page.goto(`/faq/${made.id}`);
    await expect(startAt(page)).toHaveValue('h1');
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    expect(alerts).toBe(0);
    expect(flowId).toBeTruthy();
  });
});

test.describe('what the list and the editor say', () => {
  test('the list shows "Starts at" for a linked FAQ and nothing for one without a step', async ({
    browser,
    watch,
  }) => {
    const t = tag();
    const flowId = seedStepsFlow(ws, `${t} flow`);
    await seedFaq(ws, { question: `${t} with step`, flowId, flowNodeId: 'b' });
    await seedFaq(ws, { question: `${t} plain`, flowId });
    const { page } = await open(browser, state, watch);
    await go(page, '/faq');
    await page.getByLabel('Search FAQs').fill(t);
    const withStep = page.locator('tbody tr').filter({ hasText: `${t} with step` });
    const plain = page.locator('tbody tr').filter({ hasText: `${t} plain` });
    await expect(withStep).toContainText(`${t} flow`);
    await expect(withStep.getByText('Starts at: Second')).toBeVisible();
    await expect(plain).toContainText(`${t} flow`);
    await expect(plain.getByText(/Starts at:/)).toHaveCount(0);
    await expect(plain.getByText('Step missing')).toHaveCount(0);
  });

  test('a step with no name is listed under its step type, and the trigger counts as the flow start', async ({
    browser,
    watch,
  }) => {
    const t = tag();
    const flowId = seedStepsFlow(ws, `${t} flow`);
    const noName = await seedFaq(ws, { question: `${t} no name`, flowId, flowNodeId: 'a' });
    const atTrigger = await seedFaq(ws, { question: `${t} trigger`, flowId, flowNodeId: 't' });
    expect(noName.flowNodeLabel).toBe('message');
    const { page } = await open(browser, state, watch);
    await go(page, '/faq');
    await page.getByLabel('Search FAQs').fill(t);
    await expect(
      page
        .locator('tbody tr')
        .filter({ hasText: `${t} no name` })
        .getByText('Starts at: Send message'),
    ).toBeVisible();
    await go(page, `/faq/${noName.id}`);
    await expect(startAt(page)).toHaveValue('a');
    // The start node is "The flow's start" in the select, whichever way the FAQ was linked.
    await go(page, `/faq/${atTrigger.id}`);
    await expect(startAt(page)).toHaveValue('');
    await expect(page.getByText('The step this FAQ starts at is gone')).toHaveCount(0);
  });

  test('a step deleted from the flow: warning, "Step missing", a refused save and the one-click fix', async ({
    browser,
    watch,
  }) => {
    watch.allow(/422/);
    const t = tag();
    const flowId = seedStepsFlow(ws, `${t} flow`);
    const faq = await seedFaq(ws, { question: `${t} doomed step`, flowId, flowNodeId: 'b' });
    const { page } = await open(browser, state, watch);
    await go(page, '/faq');
    await page.getByLabel('Search FAQs').fill(`${t} doomed`);
    const row = page.locator('tbody tr').filter({ hasText: `${t} doomed step` });
    await expect(row.getByText('Starts at: Second')).toBeVisible();

    // The author deletes the step from the flow.
    setFlowNodes(ws, flowId, [
      { id: 't', type: 'trigger' },
      { id: 'a', type: 'message', data: { text: 'Intro step' } },
    ]);
    await page.reload();
    await page.getByLabel('Search FAQs').fill(`${t} doomed`);
    await expect(row.getByText('Step missing')).toBeVisible();
    await expect(row.getByText(/Starts at:/)).toHaveCount(0);
    expect((await entry(faq.id)).flowNodeLabel).toBeNull();

    await page.goto(`/faq/${faq.id}`);
    const warning = page.getByText('The step this FAQ starts at is gone');
    await expect(warning).toBeVisible();
    await expect(startAt(page)).toHaveValue('b');
    expect(await optionTexts(page)).toEqual([
      "The flow's start",
      'Deleted step (choose another)',
      'Send message · #a',
    ]);

    // Saving another change while the step is still stale is refused, naming the field, and nothing is saved.
    await page.getByLabel('Category').fill('Stale step');
    await save(page).click();
    const refused = page.getByRole('alert').filter({
      hasText:
        "The chosen step is no longer in this flow. Pick another step, or start at the flow's start.",
    });
    await expect(refused).toBeVisible();
    // The message is on the step select, which is marked invalid and has the focus.
    await expect(startAt(page)).toHaveAttribute('aria-invalid', 'true');
    expect((await entry(faq.id)).category).toBeNull();
    expect((await entry(faq.id)).flowNodeId).toBe('b');

    // One click: start at the flow's start. The warning goes, the focus moves to the select, and the save goes through.
    await page.getByRole('button', { name: "Start at the flow's start" }).click();
    await expect(warning).toHaveCount(0);
    await expect(startAt(page)).toHaveValue('');
    await expect(startAt(page)).toBeFocused();
    await save(page).click();
    await expect(page.getByText('FAQ saved.')).toBeVisible();
    expect(await entry(faq.id)).toMatchObject({ flowNodeId: null, category: 'Stale step' });
    await page.goto('/faq');
    await page.getByLabel('Search FAQs').fill(`${t} doomed`);
    await expect(row).toBeVisible();
    await expect(row.getByText('Step missing')).toHaveCount(0);
  });

  test('a deleted step can also be replaced by choosing another step', async ({
    browser,
    watch,
  }) => {
    const t = tag();
    const flowId = seedStepsFlow(ws, `${t} flow`);
    const faq = await seedFaq(ws, { question: `${t} replace`, flowId, flowNodeId: 'b' });
    setFlowNodes(ws, flowId, [
      { id: 't', type: 'trigger' },
      { id: 'a', type: 'message', data: { label: 'Only left', text: 'x' } },
    ]);
    const { page } = await open(browser, state, watch);
    await go(page, `/faq/${faq.id}`);
    await expect(page.getByText('The step this FAQ starts at is gone')).toBeVisible();
    await startAt(page).selectOption({ label: 'Send message · Only left' });
    await expect(page.getByText('The step this FAQ starts at is gone')).toHaveCount(0);
    await save(page).click();
    await expect(page.getByText('FAQ saved.')).toBeVisible();
    expect(await entry(faq.id)).toMatchObject({ flowNodeId: 'a', flowNodeLabel: 'Only left' });
  });

  test('the flow deleted while the editor is open: saving is refused at the flow, nothing is saved', async ({
    browser,
    watch,
  }) => {
    watch.allow(/422/);
    const t = tag();
    const flowId = seedStepsFlow(ws, `${t} flow`);
    const faq = await seedFaq(ws, { question: `${t} gone while open`, flowId, flowNodeId: 'b' });
    const { page } = await open(browser, state, watch);
    await go(page, `/faq/${faq.id}`);
    await expect(startAt(page)).toHaveValue('b');
    deleteFlow(ws, flowId);
    await page.getByLabel('Category').fill('Too late');
    await save(page).click();
    await expect(
      page.getByRole('alert').filter({
        hasText: 'The chosen flow no longer exists in this workspace. Pick another one.',
      }),
    ).toBeVisible();
    expect((await entry(faq.id)).category).toBeNull();
  });

  test('the whole flow deleted: "Flow missing" and no step picker', async ({ browser, watch }) => {
    const t = tag();
    const flowId = seedStepsFlow(ws, `${t} flow`);
    const faq = await seedFaq(ws, { question: `${t} flowgone`, flowId, flowNodeId: 'b' });
    deleteFlow(ws, flowId);
    const { page } = await open(browser, state, watch);
    await go(page, '/faq');
    await page.getByLabel('Search FAQs').fill(`${t} flowgone`);
    const row = page.locator('tbody tr').filter({ hasText: `${t} flowgone` });
    await expect(row.getByText('Flow missing')).toBeVisible();
    await expect(row.getByText(/Step missing|Starts at/)).toHaveCount(0);
    await go(page, `/faq/${faq.id}`);
    await expect(page.getByText(/The flow this FAQ started no longer exists/)).toBeVisible();
    await expect(startAt(page)).toHaveCount(0);
  });
});

test.describe('editing safely', () => {
  test('a changed step is guarded when leaving, and saving removes the guard', async ({
    browser,
    watch,
  }) => {
    const t = tag();
    const flowId = seedStepsFlow(ws, `${t} flow`);
    const faq = await seedFaq(ws, { question: `${t} guard`, flowId });
    const { page } = await open(browser, state, watch);
    await go(page, `/faq/${faq.id}`);
    await expect(startAt(page)).toBeEnabled();
    await expect(page.getByText('Unsaved changes')).toHaveCount(0);
    await startAt(page).selectOption('b');
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await page.getByRole('link', { name: 'Back to FAQs' }).click();
    const dialog = page.getByRole('dialog', { name: 'Leave without saving?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep editing' }).click();
    await expect(startAt(page)).toHaveValue('b');
    // Putting it back is no change at all.
    await startAt(page).selectOption({ label: "The flow's start" });
    await expect(page.getByText('Unsaved changes')).toHaveCount(0);
    await startAt(page).selectOption('b');

    // The browser's own prompt guards a reload.
    const kinds: string[] = [];
    page.on('dialog', (d) => {
      kinds.push(d.type());
      void d.dismiss();
    });
    await page.getByLabel('Category').click();
    await page.evaluate(() => location.reload());
    await expect.poll(() => kinds).toContain('beforeunload');
    expect((await entry(faq.id)).flowNodeId).toBeNull();

    await save(page).click();
    await expect(page.getByText('FAQ saved.')).toBeVisible();
    await expect(page.getByText('Unsaved changes')).toHaveCount(0);
    await page.getByRole('link', { name: 'Back to FAQs' }).click();
    await expect(page).toHaveURL(/\/faq$/);
  });

  test('two people: the stale save is refused and keeping the edits applies the step on top of the latest', async ({
    browser,
    watch,
  }) => {
    watch.allow(/409/);
    const t = tag();
    const flowId = seedStepsFlow(ws, `${t} flow`);
    const faq = await seedFaq(ws, { question: `${t} conflict`, flowId });
    const one = await open(browser, state, watch);
    const two = await open(browser, state, watch);
    await go(one.page, `/faq/${faq.id}`);
    await go(two.page, `/faq/${faq.id}`);
    await expect(startAt(two.page)).toBeEnabled();

    await one.page.getByLabel('Category').fill('From the first');
    await save(one.page).click();
    await expect(one.page.getByText('FAQ saved.')).toBeVisible();

    await startAt(two.page).selectOption('b');
    await save(two.page).click();
    await expect(two.page.getByText('Someone else changed this FAQ')).toBeVisible();
    await expect(startAt(two.page)).toHaveValue('b');
    expect((await entry(faq.id)).flowNodeId).toBeNull();
    await two.page.getByRole('button', { name: 'Keep my edits' }).click();
    await expect(startAt(two.page)).toHaveValue('b');
    await save(two.page).click();
    await expect(two.page.getByText('FAQ saved.')).toBeVisible();
    // "Keep my edits" saves the whole draft on top of the latest version: the step is applied.
    expect(await entry(faq.id)).toMatchObject({ flowNodeId: 'b', flowNodeLabel: 'Second' });
  });

  test('a double click on Create FAQ makes one FAQ with the step', async ({ browser, watch }) => {
    const t = tag();
    seedStepsFlow(ws, `${t} flow`);
    const { page } = await open(browser, state, watch);
    const posts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/faq\/entries$/.test(new URL(r.url()).pathname))
        posts.push(r.url());
    });
    await page.route(/\/faq\/entries$/, async (route) => {
      if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 1000));
      await route.continue();
    });
    await go(page, '/faq/new');
    await questionBox(page).fill(`${t} double`);
    await pickFlow(page, `${t} flow`);
    await expect(startAt(page)).toBeEnabled();
    await startAt(page).selectOption('b');
    await page.getByRole('button', { name: 'Create FAQ' }).dblclick();
    await expect(page.getByText('FAQ created.')).toBeVisible();
    await page.waitForURL(/\/faq\/[0-9a-f-]{36}$/);
    expect(posts).toHaveLength(1);
    const made = (await entries(ws)).data.filter((e: any) => e.question === `${t} double`);
    expect(made).toHaveLength(1);
    expect(made[0].flowNodeId).toBe('b');
  });

  test('the steps list failing to load can be retried', async ({ browser, watch }) => {
    watch.allow(/500/, /Failed to load resource/);
    const t = tag();
    const flowId = seedStepsFlow(ws, `${t} flow`);
    const faq = await seedFaq(ws, { question: `${t} retry`, flowId, flowNodeId: 'b' });
    const { page } = await open(browser, state, watch);
    let failing = true;
    await page.route(/\/faq\/flows\/[0-9a-f-]{36}\/nodes/, async (route) => {
      if (failing)
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      else await route.continue();
    });
    await go(page, `/faq/${faq.id}`);
    await expect(page.getByRole('alert').filter({ hasText: 'Try again' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(startAt(page)).toHaveCount(0);
    failing = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(startAt(page)).toHaveValue('b');
    await expect(page.getByRole('alert').filter({ hasText: 'Try again' })).toHaveCount(0);
  });
});

test.describe('API rules', () => {
  test('a flow of another workspace is refused by the steps list and by saving', async () => {
    const other = await newWorkspace('linkother');
    const foreign = seedOtherFlow(other);
    const refused = await call(ws, 'GET', `/v2/faq/flows/${foreign}/nodes`);
    expect(refused.status).toBe(422);
    expect(refused.body.code ?? refused.body.type).toMatch(/FLOW_NOT_FOUND|flow-not-found/i);
    // Its steps never leak into the answer.
    expect(JSON.stringify(refused.body)).not.toContain('Foreign step');
    // A flow that does not exist at all behaves the same; a malformed id is a bad request.
    expect(
      (await call(ws, 'GET', '/v2/faq/flows/00000000-0000-4000-8000-000000000000/nodes')).status,
    ).toBe(422);
    expect((await call(ws, 'GET', '/v2/faq/flows/not-a-uuid/nodes')).status).toBe(400);
    // The foreign workspace itself can read them.
    expect((await call(other, 'GET', `/v2/faq/flows/${foreign}/nodes`)).body.data).toHaveLength(2);

    const create = await call(ws, 'POST', '/v2/faq/entries', {
      question: 'Foreign flow FAQ',
      answerType: 'flow',
      flowId: foreign,
      flowNodeId: 'f1',
    });
    expect(create.status).toBe(422);
    expect(create.body.errors ?? create.body.details ?? []).toBeDefined();
    expect((await entries(ws)).data.some((e: any) => e.question === 'Foreign flow FAQ')).toBe(
      false,
    );
  });

  test('a step that is not in the flow is refused with the field named, on create and on update', async () => {
    const t = tag();
    const flowId = seedStepsFlow(ws, `${t} flow`);
    const bad = await call(ws, 'POST', '/v2/faq/entries', {
      question: `${t} bad step`,
      answerType: 'flow',
      flowId,
      flowNodeId: 'nope',
    });
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.body)).toContain('flowNodeId');
    const faq = await seedFaq(ws, { question: `${t} ok`, flowId });
    const upd = await patchEntry(faq.id, { flowNodeId: 'nope' });
    expect(upd.status).toBe(422);
    expect(JSON.stringify(upd.body)).toContain('flowNodeId');
    expect((await entry(faq.id)).flowNodeId).toBeNull();
    // A step with a text answer is not a thing: it is dropped, not kept.
    const text = await call(ws, 'POST', '/v2/faq/entries', {
      question: `${t} text with step`,
      answerType: 'text',
      answerText: 'Hi',
      flowNodeId: 'b',
    });
    if (text.status === 201) expect(text.body.flowNodeId).toBeNull();
  });
});

test.describe('who may change it', () => {
  test('a read-only member sees the step as text, with no select', async ({ browser, watch }) => {
    const t = tag();
    const flowId = seedStepsFlow(ws, `${t} flow`);
    const withStep = await seedFaq(ws, { question: `${t} ro step`, flowId, flowNodeId: 'b' });
    const gone = await seedFaq(ws, { question: `${t} ro gone`, flowId, flowNodeId: 'a' });
    const reader = await member(ws, 'reader', ['faq.entries.read']);
    const readerState = await login(browser, reader.email);
    const { page } = await open(browser, readerState, watch);
    await go(page, `/faq/${withStep.id}`);
    await expect(page.getByText('Starts at step: Second')).toBeVisible();
    await expect(startAt(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);

    setFlowNodes(ws, flowId, [{ id: 't', type: 'trigger' }]);
    await go(page, `/faq/${gone.id}`);
    await expect(
      page.getByText('The step this FAQ starts at no longer exists, so customers get no answer.'),
    ).toBeVisible();
    await expect(startAt(page)).toHaveCount(0);
    // The API refuses what the screen does not offer.
    const nope = await patchEntry(withStep.id, { flowNodeId: null }, reader.token);
    expect(nope.status).toBe(403);
    // Reading the steps is allowed with the read permission.
    expect(
      (await call(ws, 'GET', `/v2/faq/flows/${flowId}/nodes`, undefined, reader.token)).status,
    ).toBe(200);
  });
});

test.describe('looks and layout', () => {
  async function linked(t: string) {
    const flowId = seedStepsFlow(ws, `${t} flow`);
    return seedFaq(ws, { question: `${t} look`, flowId, flowNodeId: 'b' });
  }

  test('dark mode: the select and its warning are visible and readable', async ({
    browser,
    watch,
  }) => {
    const t = tag();
    const faq = await linked(t);
    const { page } = await open(browser, state, watch, { colorScheme: 'dark', theme: 'dark' });
    await go(page, `/faq/${faq.id}`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(startAt(page)).toHaveValue('b');
    const colours = await startAt(page).evaluate((el) => {
      const s = getComputedStyle(el);
      return { fg: s.color, bg: s.backgroundColor };
    });
    expect(colours.fg).not.toBe(colours.bg);
    const lum = (c: string) => {
      const [r, g, b] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
    };
    // Light text on a dark field.
    expect(lum(colours.fg)).toBeGreaterThan(lum(colours.bg));
    setFlowNodes(
      ws,
      sqlOne(`SELECT uuid FROM flows WHERE org_id=${ws.orgId} AND flow_name='${t} flow'`)!,
      [{ id: 't', type: 'trigger' }],
    );
    await page.reload();
    await expect(page.getByText('The step this FAQ starts at is gone')).toBeVisible();
    await expect(page.getByRole('button', { name: "Start at the flow's start" })).toBeVisible();
  });

  test('right to left: the select is mirrored and still works', async ({ browser, watch }) => {
    const t = tag();
    const faq = await linked(t);
    const { page } = await open(browser, state, watch, { locale: 'ar' });
    await go(page, `/faq/${faq.id}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const select = page.locator('#faq-flow-node select');
    await expect(select).toBeVisible();
    await expect(select).toHaveValue('b');
    // The label is translated (not the English one) and it names the select.
    await expect(page.getByLabel('Start at', { exact: true })).toHaveCount(0);
    expect(await select.evaluate((el) => (el as HTMLSelectElement).labels?.length ?? 0)).toBe(1);
    expect(await select.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await select.selectOption('a');
    await expect(select).toHaveValue('a');
  });

  test('phone width: the select fits the screen and can be changed', async ({ browser, watch }) => {
    const t = tag();
    const faq = await linked(t);
    const { page } = await open(browser, state, watch, { viewport: { width: 375, height: 700 } });
    await go(page, `/faq/${faq.id}`);
    await expect(startAt(page)).toHaveValue('b');
    const box = await startAt(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await startAt(page).scrollIntoViewIfNeeded();
    await startAt(page).selectOption('a');
    await expect(page.getByText('Unsaved changes')).toBeVisible();
  });
});

/** What a customer receives: the FAQ is matched on the simulator and its flow is started at the chosen step. */
test.describe('the customer journey', () => {
  let cws: Workspace;
  let sim: Sim;
  let missingFlow: string;

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    cws = await newWorkspace('linkjourney');
    sim = await simulator(cws);
    const flowId = seedStepsFlow(cws, 'Journey flow');
    await seedFaq(cws, { question: 'Take me to the second step', flowId, flowNodeId: 'b' });
    await seedFaq(cws, { question: 'Take me to the beginning', flowId });
    missingFlow = seedStepsFlow(cws, 'Journey flow with a hole');
    await seedFaq(cws, { question: 'Take me to the hole', flowId: missingFlow, flowNodeId: 'b' });
    await waitIndexed(cws);
    await putSettings(cws, { enabled: true });
    setFlowNodes(cws, missingFlow, [
      { id: 't', type: 'trigger' },
      { id: 'a', type: 'message', data: { text: 'Intro step' } },
    ]);
  });

  test('a FAQ linked to a step sends only that step, and one without a step sends the whole flow', async () => {
    test.setTimeout(600_000);
    const stepper = await customerAsks(
      cws,
      sim,
      'take me to the second step',
      (from) => repliesTo(cws, from).length >= 1,
    );
    expect(repliesTo(cws, stepper)).toEqual(['Second step']);

    const whole = await customerAsks(
      cws,
      sim,
      'take me to the beginning',
      (from) => repliesTo(cws, from).length >= 1,
    );
    // Without a step the flow starts at its beginning: the first message is the intro, and the second step follows it.
    expect(repliesTo(cws, whole)[0]).toBe('Intro step');
    await expect
      .poll(() => repliesTo(cws, whole), { timeout: 300_000, intervals: [1000, 2000, 5000] })
      .toEqual(['Intro step', 'Second step']);
    // The flow is over: nothing else trickled in for the first customer in the meantime.
    await new Promise((r) => setTimeout(r, 1000));
    expect(repliesTo(cws, stepper)).toEqual(['Second step']);
    // The match log tells the truth: both started a flow, with no error.
    expect(
      Number(
        sqlOne(
          `SELECT count(*) FROM faq_match_logs WHERE org_id=${cws.orgId} AND outcome='flow_started' AND error IS NULL AND query IN ('take me to the second step','take me to the beginning')`,
        ),
      ),
    ).toBeGreaterThanOrEqual(2);
    expect(
      Number(
        sqlOne(
          `SELECT count(*) FROM faq_match_logs WHERE org_id=${cws.orgId} AND outcome='flow_started' AND error IS NOT NULL`,
        ),
      ),
    ).toBe(0);
  });

  test('a FAQ whose step was deleted sends nothing and the log shows the error', async ({
    browser,
    watch,
  }) => {
    test.setTimeout(600_000);
    const from = await customerAsks(cws, sim, 'take me to the hole');
    expect(
      sqlOne(
        `SELECT l.outcome FROM faq_match_logs l JOIN conversations c ON c.org_id=l.org_id AND c.id=l.conversation_id WHERE l.org_id=${cws.orgId} AND c.peer_key='${from}'`,
      ),
    ).toBe('not_sent');
    // Give the flow engine time to (wrongly) send anything, then check the customer got nothing.
    await new Promise((r) => setTimeout(r, 2000));
    expect(repliesTo(cws, from)).toEqual([]);
    const error = sqlOne(
      `SELECT l.error FROM faq_match_logs l JOIN conversations c ON c.org_id=l.org_id AND c.id=l.conversation_id WHERE l.org_id=${cws.orgId} AND c.peer_key='${from}'`,
    );
    expect(error ?? '').not.toBe('');

    const errors = (await call(cws, 'GET', '/v2/faq/insights/log?view=errors&limit=50')).body;
    expect(errors.data.map((r: any) => r.query)).toContain('take me to the hole');

    const cstate = await login(browser, cws.email);
    const { page } = await open(browser, cstate, watch);
    await go(page, '/faq/insights');
    await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Errors' }).click();
    const row = page.getByRole('row').filter({ hasText: 'take me to the hole' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Show details' }).click();
    await expect(
      page.getByText('Error: The step this should start at is no longer in the flow'),
    ).toBeVisible();
  });
});

/** A flow that exists in the other workspace; two steps, the first named so a leak would be seen. */
function seedOtherFlow(other: Workspace): string {
  const graph = {
    flowNodes: [
      { id: 't', type: 'trigger', data: {}, isStart: true },
      { id: 'f1', type: 'message', data: { label: 'Foreign step', text: 'x' } },
    ],
    flowEdges: [{ source: 't', sourceHandle: 'out', target: 'f1' }],
    vars: {},
  };
  return sqlOne(
    `INSERT INTO flows (org_id, flow_name, flow_data, trigger_kind, is_published, is_active, provider, flow_type)
     VALUES (${other.orgId}, 'Foreign flow', '${JSON.stringify(graph)}'::jsonb, 'keyword', true, true, 'simulator', 'chat')
     RETURNING uuid`,
  )!;
}
