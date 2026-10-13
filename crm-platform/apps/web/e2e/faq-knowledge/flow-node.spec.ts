import {
  type BuilderNode,
  call,
  customerAsks,
  enableAutomation,
  expect,
  faqUrl,
  flowGraph,
  go,
  login,
  newWorkspace,
  open,
  repliesTo,
  seedBuilderFlow,
  seedFaq,
  type Sim,
  simulator,
  sql,
  type State,
  tabTo,
  test,
  waitIndexed,
  type Workspace,
} from './support';
import type { Locator, Page } from '@playwright/test';

test.describe.configure({ timeout: 120_000 });

/**
 * The flow builder's "Answer from FAQ" node (AI group): the palette entry, the card, the inspector form with its minimum-score check,
 * what is saved, the test chat, the Simple builder's step, and a real customer going through a published flow that uses it.
 * Flows are seeded by SQL in the shape the builder opens (every node has a position) and read back from the database after a save.
 */
let ws: Workspace;
let state: State;
let empty: Workspace;
let emptyState: State;
let n = 0;
const tag = () => `Fn${Date.now().toString(36)}${(n++).toString(36)}`;

const BIG = { width: 1600, height: 1000 };
const MIN_SCORE_MSG = "Enter a number from 0.05 to 0.99, or use this flow's setting.";
const SAVE_BLOCKED =
  '"Answer from FAQ" has a minimum score outside 0.05 to 0.99 — fix it or leave it blank to use the flow\'s setting.';

/**
 * The FAQs of a flow: the "Answer from FAQ" step answers from the FAQs of the flow it is in, so every flow a test builds gets its own
 * two (a Shipping one and an Account one). The phrasings are what the customer journeys type.
 */
async function standardFaqs(w: Workspace, flow: string) {
  await seedFaq(w, {
    owner: flow,
    question: 'Where is my order?',
    answerText: 'Your order ships tomorrow.',
    category: 'Shipping',
    variations: ['faqnodea where is my order', 'faqnoded where is my order'],
  });
  await seedFaq(w, {
    owner: flow,
    question: 'Reset my password',
    answerText: 'Use the reset link.',
    category: 'Account',
    variations: ['faqnodec reset my password'],
  });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  ws = await newWorkspace('flownode', { builder: 'advanced' });
  state = await login(browser, ws.email);
  empty = await newWorkspace('flownodeempty', { builder: 'advanced' });
  emptyState = await login(browser, empty.email);
});

const canvas = (page: Page) => page.locator('[data-testid="canvas"]');
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });
const field = (page: Page, label: string): Locator =>
  inspector(page)
    .locator('div.mb-4')
    .filter({ has: page.locator('label', { hasText: label }) })
    .first();
const nodes = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-node-id]')].map((e) => ({
      id: e.getAttribute('data-node-id')!,
      type: e.getAttribute('data-node-type')!,
    })),
  );
const nodeCard = (page: Page, id: string) => page.locator(`[data-node-id="${id}"]`);
const port = (page: Page, sel: string) => page.locator(`[data-port="${sel}"]`);
const edgeCount = (page: Page) => page.locator('path.edge-hit').count();
const saveButton = (page: Page) => page.locator('header').getByRole('button', { name: /^Save/ });

/** The three nodes the tests share: a Trigger and one message for each exit. */
const BRANCHES: BuilderNode[] = [
  { id: 't', type: 'trigger', x: 60, y: 120 },
  { id: 'A', type: 'message', data: { text: 'Answered branch' }, x: 960, y: 60 },
  { id: 'B', type: 'message', data: { text: 'No match branch' }, x: 960, y: 380 },
];
const faqNode = (id: string, data: Record<string, unknown> = {}): BuilderNode => ({
  id,
  type: 'faq',
  x: 540,
  y: 200,
  data: {
    query: '{{user_message}}',
    category: '',
    minScore: null,
    sendAnswer: true,
    save: 'faq',
    ...data,
  },
});
/** Trigger, an FAQ node `f`, and a message on each exit, all wired. */
async function wiredFlow(
  w: Workspace,
  name: string,
  data: Record<string, unknown> = {},
  opts: { keywords?: string; published?: boolean; faqs?: boolean } = {},
) {
  const { faqs = true, ...flowOpts } = opts;
  const uuid = seedBuilderFlow(
    w,
    name,
    [BRANCHES[0]!, faqNode('f', data), BRANCHES[1]!, BRANCHES[2]!],
    [
      ['t', 'out', 'f'],
      ['f', 'matched', 'A'],
      ['f', 'no_match', 'B'],
    ],
    flowOpts,
  );
  if (faqs) await standardFaqs(w, uuid);
  return uuid;
}

/**
 * Opens the builder on a flow and waits for its nodes. A load that the dev server cut short (a recompile aborts the requests) leaves
 * a blank canvas, as the builder does for any flow it cannot read, so the page is loaded again (up to 3 times).
 */
async function openBuilder(page: Page, uuid: string, expected = 1) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`/flows/builder/${uuid}`, { timeout: 120_000 });
    await canvas(page).waitFor({ timeout: 120_000 });
    await page
      .addStyleTag({ content: 'nextjs-portal{display:none!important}' })
      .catch(() => undefined);
    const until = Date.now() + (attempt === 3 ? 30_000 : 12_000);
    while (Date.now() < until && (await nodes(page)).length < expected)
      await page.waitForTimeout(300);
    if ((await nodes(page)).length >= expected) return;
  }
  await expect.poll(async () => (await nodes(page)).length).toBeGreaterThanOrEqual(expected);
}

/** Selects a node by its title and opens the inspector with the pencil of its action bar. */
async function openInspector(page: Page, id: string) {
  await nodeCard(page, id).locator('.chip-icon + div > div').first().click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(inspector(page)).toBeVisible();
  await expect(inspector(page).getByText('Answer from FAQ').first()).toBeVisible();
}

/** The real HTML5 drag of a palette card onto the canvas (retried: the first drag after boot can be lost). */
async function dragFromPalette(page: Page, label: string, x: number, y: number) {
  const before = (await nodes(page)).length;
  const card = page.locator('.pal-card', { hasText: label }).first();
  for (let i = 0; i < 4; i++) {
    await card.dragTo(canvas(page), { targetPosition: { x, y } });
    await page.waitForTimeout(250);
    if ((await nodes(page)).length > before) return;
  }
  throw new Error(`The "${label}" card could not be dropped on the canvas`);
}

/** Press an output port and release over the input port of another node, with real mouse moves in between. */
async function wire(page: Page, from: string, to: string) {
  const centre = async (sel: string) => {
    const bb = await port(page, sel).boundingBox();
    return { x: bb!.x + bb!.width / 2, y: bb!.y + bb!.height / 2 };
  };
  const a = await centre(from);
  const b = await centre(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

const savedNode = (w: Workspace, uuid: string, id: string) =>
  flowGraph(w, uuid).flowNodes.find((x: any) => x.id === id);

test.describe('in the advanced builder', () => {
  test('the palette offers one "Answer from FAQ" card in the AI group, found by name or description', async ({
    browser,
    watch,
  }) => {
    const uuid = seedBuilderFlow(ws, tag(), [BRANCHES[0]!], []);
    const { page } = await open(browser, state, watch, { viewport: BIG });
    await openBuilder(page, uuid);
    const search = page.locator('input[aria-label="Search nodes"]');
    const all = await page.locator('.pal-card').count();
    expect(all).toBeGreaterThanOrEqual(46);

    await search.fill('FAQ');
    await expect(page.locator('.pal-card')).toHaveCount(1);
    const card = page.locator('.pal-card').first();
    await expect(card).toContainText('Answer from FAQ');
    await expect(card).toContainText('Match a message to your FAQs');
    await expect(card).toHaveAttribute('data-palette-type', 'faq');
    await expect(card).toHaveAttribute('draggable', 'true');
    // It sits under the AI heading.
    await expect(
      page.locator('aside[aria-label="Node palette"]').getByText('AI', { exact: true }),
    ).toBeVisible();
    for (const q of ['faq', 'your faqs', 'match a message']) {
      await search.fill(q);
      await expect(page.locator('.pal-card'), q).toHaveCount(1);
    }
    await search.fill('zzzz');
    await expect(page.getByText('No nodes match.')).toBeVisible();
    await search.fill('');
    await expect(page.locator('.pal-card')).toHaveCount(all);
  });

  test('add it, fill every field, wire both exits, save: the saved flow has the node and the two exits', async ({
    browser,
    watch,
  }) => {
    test.setTimeout(240_000);
    const t = tag();
    const uuid = seedBuilderFlow(ws, t, BRANCHES, []);
    await standardFaqs(ws, uuid);
    const { page } = await open(browser, state, watch, { viewport: BIG });
    await openBuilder(page, uuid, 3);

    await page.locator('input[aria-label="Search nodes"]').fill('FAQ');
    await dragFromPalette(page, 'Answer from FAQ', 700, 260);
    const faq = (await nodes(page)).find((x) => x.type === 'faq')!;
    expect(faq).toBeDefined();
    // The card: its two exits, its defaults.
    const card = nodeCard(page, faq.id);
    await expect(card).toContainText('Answer from FAQ');
    await expect(card).toContainText('{{user_message}}');
    await expect(card).toContainText('All FAQs');
    await expect(card).toContainText('flow score');
    await expect(card).toContainText('save → {{faq}}');
    await expect(card).toContainText('answered');
    await expect(card).toContainText('no match');
    await expect(port(page, `in:${faq.id}`)).toHaveCount(1);
    await expect(port(page, `out:${faq.id}:matched`)).toHaveCount(1);
    await expect(port(page, `out:${faq.id}:no_match`)).toHaveCount(1);
    await expect(page.locator(`[data-port^="out:${faq.id}:"]`)).toHaveCount(2);

    await wire(page, 'out:t:out', `in:${faq.id}`);
    await wire(page, `out:${faq.id}:matched`, 'in:A');
    await wire(page, `out:${faq.id}:no_match`, 'in:B');
    await expect.poll(() => edgeCount(page)).toBe(3);

    await openInspector(page, faq.id);
    // The form, every part of it.
    const q = field(page, 'Message to match').locator('input');
    await expect(q).toHaveValue('{{user_message}}');
    await q.fill('{{answer}}');
    const category = field(page, 'Only these FAQs').locator('select');
    await expect
      .poll(() => category.locator('option').evaluateAll((os) => os.map((o) => o.textContent)))
      .toEqual(['All FAQs', 'Account', 'Shipping']);
    await category.selectOption('Shipping');
    const useWorkspace = field(page, 'Minimum score').getByRole('checkbox', {
      name: "Use this flow's setting",
    });
    await expect(useWorkspace).toBeChecked();
    await expect(field(page, 'Minimum score').locator('input[type=number]')).toHaveCount(0);
    await useWorkspace.uncheck();
    const min = field(page, 'Minimum score').locator('input[type=number]');
    await expect(min).toHaveValue('0.5');
    await min.fill('0.65');
    const send = field(page, 'Send the answer to the customer').getByRole('checkbox', {
      name: 'Send a matching text answer as a message',
    });
    await expect(send).toBeChecked();
    await expect(
      field(page, 'Send the answer to the customer').getByText(
        'A matching text FAQ is sent to the customer.',
      ),
    ).toBeVisible();
    await send.uncheck();
    await expect(
      field(page, 'Send the answer to the customer').getByText(
        /^Nothing is sent: the answer is only saved/,
      ),
    ).toBeVisible();
    const saveAs = field(page, 'Save the result as').locator('input');
    await expect(saveAs).toHaveValue('faq');
    await saveAs.fill('myfaq');
    for (const [name, what] of [
      ['answer', 'the answer text'],
      ['matched', 'yes or no'],
      ['question', 'the question of the FAQ that matched'],
      ['score', 'how close the match was'],
      ['id', 'the id of the FAQ that matched'],
    ] as const) {
      await expect(
        inspector(page)
          .locator('li')
          .filter({ hasText: `{{myfaq.${name}}}` }),
      ).toContainText(what);
    }
    // The card follows the form.
    await expect(card).toContainText('{{answer}}');
    await expect(card).toContainText('FAQs: Shipping');
    await expect(card).toContainText('min score 0.65');
    await expect(card).toContainText('not sent');
    await expect(card).toContainText('save → {{myfaq}}');

    await saveButton(page).click();
    await expect
      .poll(() => savedNode(ws, uuid, faq.id)?.data, { timeout: 30_000 })
      .toEqual({
        query: '{{answer}}',
        category: 'Shipping',
        minScore: 0.65,
        sendAnswer: false,
        save: 'myfaq',
      });
    const graph = flowGraph(ws, uuid);
    const edges = graph.flowEdges
      .map((e: any) => `${e.source}:${e.sourceHandle}>${e.target}`)
      .sort();
    expect(edges).toEqual(
      [`${faq.id}:matched>A`, `${faq.id}:no_match>B`, `t:out>${faq.id}`].sort(),
    );
    expect(graph.flowNodes.find((x: any) => x.id === faq.id).type).toBe('faq');

    // After a reload every field is back.
    await openBuilder(page, uuid, 4);
    await openInspector(page, faq.id);
    await expect(field(page, 'Message to match').locator('input')).toHaveValue('{{answer}}');
    await expect(field(page, 'Only these FAQs').locator('select')).toHaveValue('Shipping');
    await expect(
      field(page, 'Minimum score').getByRole('checkbox', { name: "Use this flow's setting" }),
    ).not.toBeChecked();
    await expect(field(page, 'Minimum score').locator('input[type=number]')).toHaveValue('0.65');
    await expect(
      field(page, 'Send the answer to the customer').getByRole('checkbox'),
    ).not.toBeChecked();
    await expect(field(page, 'Save the result as').locator('input')).toHaveValue('myfaq');
    expect(await edgeCount(page)).toBe(3);
  });

  test('the minimum score: 0.04, 1.0 and other values outside 0.05 to 0.99 are refused inline and when saving', async ({
    browser,
    watch,
  }) => {
    test.setTimeout(240_000);
    const t = tag();
    const uuid = await wiredFlow(ws, t);
    const { page } = await open(browser, state, watch, { viewport: BIG });
    await openBuilder(page, uuid, 4);
    await openInspector(page, 'f');
    const own = field(page, 'Minimum score');
    await own.getByRole('checkbox', { name: "Use this flow's setting" }).uncheck();
    const min = own.locator('input[type=number]');
    const alert = own.getByRole('alert');
    await expect(alert).toHaveCount(0);

    for (const bad of ['0.04', '1.0', '1', '0', '-0.5', '5', '0.049', '0.991']) {
      await min.fill(bad);
      await expect(alert, `value ${bad}`).toHaveText(MIN_SCORE_MSG);
      await expect(min).toHaveAttribute('aria-invalid', 'true');
    }
    // The ends are fine, and so is a blank field (the workspace setting applies).
    for (const good of ['0.05', '0.99', '0.5', '0.123']) {
      await min.fill(good);
      await expect(alert, `value ${good}`).toHaveCount(0);
    }
    await min.fill('');
    await expect(alert).toHaveCount(0);

    // Saving with a bad score is refused by name, the node is outlined, and nothing is saved.
    await min.fill('0.04');
    await saveButton(page).click();
    const popup = page.getByRole('alert').filter({ hasText: "Can't save" });
    await expect(popup).toBeVisible();
    await expect(popup).toContainText(SAVE_BLOCKED);
    await expect(nodeCard(page, 'f')).toHaveClass(/node-invalid/);
    expect(savedNode(ws, uuid, 'f').data.minScore).toBeNull();
    // Fixing it clears the popup and the save goes through.
    await min.fill('0.99');
    await saveButton(page).click();
    await expect.poll(() => savedNode(ws, uuid, 'f').data.minScore, { timeout: 30_000 }).toBe(0.99);
    await expect(popup).toHaveCount(0);

    // "Use the workspace setting" goes back to no score of its own.
    await own.getByRole('checkbox', { name: "Use this flow's setting" }).check();
    await expect(min).toHaveCount(0);
    await saveButton(page).click();
    await expect.poll(() => savedNode(ws, uuid, 'f').data.minScore, { timeout: 30_000 }).toBeNull();
  });

  test('a blank minimum score is saved as "no score of its own"', async ({ browser, watch }) => {
    const uuid = await wiredFlow(ws, tag(), { minScore: 0.7 });
    const { page } = await open(browser, state, watch, { viewport: BIG });
    await openBuilder(page, uuid, 4);
    await openInspector(page, 'f');
    const own = field(page, 'Minimum score');
    await expect(own.locator('input[type=number]')).toHaveValue('0.7');
    await own.locator('input[type=number]').fill('');
    await expect(own.getByRole('alert')).toHaveCount(0);
    await saveButton(page).click();
    await expect
      .poll(() => [null, ''].includes(savedNode(ws, uuid, 'f').data.minScore), { timeout: 30_000 })
      .toBe(true);
  });

  test("the category list is this flow's FAQ categories, and a saved category nobody uses any more is kept", async ({
    browser,
    watch,
  }) => {
    const uuid = await wiredFlow(ws, tag(), { category: 'Retired' });
    const { page } = await open(browser, state, watch, { viewport: BIG });
    await openBuilder(page, uuid, 4);
    await openInspector(page, 'f');
    const category = field(page, 'Only these FAQs').locator('select');
    await expect(category).toHaveValue('Retired');
    // The workspace's categories arrive after the form opens; the saved one stays selectable and says nobody uses it.
    await expect
      .poll(() =>
        category.locator('option').evaluateAll((os) => os.map((o) => o.textContent).sort()),
      )
      .toEqual(['Account', 'All FAQs', 'Retired (no FAQ uses it)', 'Shipping']);
    await expect(category).toHaveValue('Retired');
    await expect(category.locator('option').first()).toHaveText('All FAQs');
    // The card names it.
    await expect(nodeCard(page, 'f')).toContainText('FAQs: Retired');
    // Another edit does not lose it.
    await field(page, 'Message to match').locator('input').fill('{{user_message}} please');
    await saveButton(page).click();
    await expect
      .poll(() => savedNode(ws, uuid, 'f').data.query, { timeout: 30_000 })
      .toBe('{{user_message}} please');
    expect(savedNode(ws, uuid, 'f').data.category).toBe('Retired');
    // Choosing "All FAQs" empties it.
    await category.selectOption({ label: 'All FAQs' });
    await saveButton(page).click();
    await expect.poll(() => savedNode(ws, uuid, 'f').data.category, { timeout: 30_000 }).toBe('');
    await expect(nodeCard(page, 'f')).toContainText('All FAQs');
  });

  test('a flow with no FAQs is told so, with a link to add the first one', async ({
    browser,
    watch,
  }) => {
    const uuid = await wiredFlow(empty, tag(), {}, { faqs: false });
    const { page } = await open(browser, emptyState, watch, { viewport: BIG });
    await openBuilder(page, uuid, 4);
    await openInspector(page, 'f');
    const hint = inspector(page).getByText(
      /^This flow has no FAQs yet, so this step always leaves by no match\./,
    );
    await expect(hint).toBeVisible();
    // The link opens the FAQs tab of THIS flow, on the new FAQ screen.
    const link = inspector(page).getByRole('link', { name: 'Add the first FAQ of this flow' });
    await expect(link).toHaveAttribute('href', faqUrl(uuid, 'new'));
    // The step's intro links to the flow's FAQs too.
    await expect(
      inspector(page).getByRole('link', { name: "Manage this flow's FAQs" }),
    ).toHaveAttribute('href', faqUrl(uuid));
    await expect(field(page, 'Only these FAQs').locator('select option')).toHaveText(['All FAQs']);

    // A flow that has FAQs does not see it, and its categories are listed.
    const withFaqs = await open(browser, state, watch, { viewport: BIG });
    const uuid2 = await wiredFlow(ws, tag());
    await openBuilder(withFaqs.page, uuid2, 4);
    await openInspector(withFaqs.page, 'f');
    await expect(field(withFaqs.page, 'Only these FAQs').locator('select option')).toHaveText([
      'All FAQs',
      'Account',
      'Shipping',
    ]);
    await expect(withFaqs.page.getByText(/has no FAQs yet/)).toHaveCount(0);
  });

  test('the form and the card show markup, emoji and very long text as plain text', async ({
    browser,
    watch,
  }) => {
    const uuid = await wiredFlow(ws, tag());
    const { page } = await open(browser, state, watch, { viewport: BIG });
    let alerts = 0;
    page.on('dialog', (d) => {
      alerts++;
      void d.dismiss();
    });
    await openBuilder(page, uuid, 4);
    await openInspector(page, 'f');
    const hostile = '<img src=x onerror="window.__xss=1"> where is my 📦 ' + 'x'.repeat(300);
    await field(page, 'Message to match').locator('input').fill(hostile);
    await field(page, 'Save the result as').locator('input').fill('<b>name</b> 😀');
    await expect(nodeCard(page, 'f')).toContainText('<img src=x onerror="window.__xss=1">');
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    expect(alerts).toBe(0);
    // The long text stays inside its card.
    const card = await nodeCard(page, 'f').boundingBox();
    const text = await nodeCard(page, 'f').locator('text=/where is my/').first().boundingBox();
    expect(text!.x + text!.width).toBeLessThanOrEqual(card!.x + card!.width + 1);
    await saveButton(page).click();
    await expect.poll(() => savedNode(ws, uuid, 'f').data.query, { timeout: 30_000 }).toBe(hostile);
    await openBuilder(page, uuid, 4);
    await expect(nodeCard(page, 'f')).toContainText('<img src=x onerror="window.__xss=1">');
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  });

  test('the form works with the keyboard alone', async ({ browser, watch }) => {
    const uuid = await wiredFlow(ws, tag());
    const { page } = await open(browser, state, watch, { viewport: BIG });
    await openBuilder(page, uuid, 4);
    await openInspector(page, 'f');
    const kb = page.keyboard;
    await tabTo(page, field(page, 'Message to match').locator('input'), 40);
    await kb.press('Control+a');
    await kb.type('keyboard {{user_message}}');
    await tabTo(page, field(page, 'Only these FAQs').locator('select'), 10);
    await kb.press('ArrowDown');
    await expect(field(page, 'Only these FAQs').locator('select')).toHaveValue('Account');
    await tabTo(
      page,
      field(page, 'Minimum score').getByRole('checkbox', { name: "Use this flow's setting" }),
      10,
    );
    await kb.press('Space');
    const min = field(page, 'Minimum score').locator('input[type=number]');
    await expect(min).toBeVisible();
    await tabTo(page, min, 5);
    await kb.press('Control+a');
    await kb.type('0.8');
    await tabTo(page, field(page, 'Send the answer to the customer').getByRole('checkbox'), 5);
    await kb.press('Space');
    await tabTo(page, field(page, 'Save the result as').locator('input'), 5);
    await kb.press('Control+a');
    await kb.type('kb');
    await saveButton(page).focus();
    await kb.press('Enter');
    await expect
      .poll(() => savedNode(ws, uuid, 'f').data, { timeout: 30_000 })
      .toEqual({
        query: 'keyboard {{user_message}}',
        category: 'Account',
        minScore: 0.8,
        sendAnswer: false,
        save: 'kb',
      });
  });

  test('deleting the node removes its edges, and undo and redo bring them back and take them away', async ({
    browser,
    watch,
  }) => {
    const uuid = await wiredFlow(ws, tag());
    const { page } = await open(browser, state, watch, { viewport: BIG });
    await openBuilder(page, uuid, 4);
    expect(await edgeCount(page)).toBe(3);
    await nodeCard(page, 'f').locator('.chip-icon + div > div').first().click();
    await page.getByRole('button', { name: 'Delete node' }).click();
    await expect.poll(async () => (await nodes(page)).some((x) => x.type === 'faq')).toBe(false);
    expect(await edgeCount(page)).toBe(0);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await nodes(page)).some((x) => x.id === 'f')).toBe(true);
    expect(await edgeCount(page)).toBe(3);
    await page.keyboard.press('Control+y');
    await expect.poll(async () => (await nodes(page)).some((x) => x.id === 'f')).toBe(false);
    expect(await edgeCount(page)).toBe(0);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await nodes(page)).some((x) => x.id === 'f')).toBe(true);
    // Nothing was saved by deleting and undoing.
    expect(savedNode(ws, uuid, 'f')).toBeDefined();
    // A copy of the node (Ctrl+D) is a new node with the same settings and no edges.
    await nodeCard(page, 'f').locator('.chip-icon + div > div').first().click();
    await page.keyboard.press('Control+d');
    await expect
      .poll(async () => (await nodes(page)).filter((x) => x.type === 'faq').length)
      .toBe(2);
    expect(await edgeCount(page)).toBe(3);
  });

  test('the test chat says the step is simulated and takes the exit that is connected', async ({
    browser,
    watch,
  }) => {
    const both = await wiredFlow(ws, tag());
    const onlyNoMatch = seedBuilderFlow(
      ws,
      tag(),
      [BRANCHES[0]!, faqNode('f', { query: 'where is my order', save: 'myfaq' }), BRANCHES[2]!],
      [
        ['t', 'out', 'f'],
        ['f', 'no_match', 'B'],
      ],
    );
    const { page } = await open(browser, state, watch, { viewport: BIG });
    await openBuilder(page, both, 4);
    await page.getByRole('button', { name: 'Test', exact: true }).click();
    await expect(page.getByText('Simulate a chat')).toBeVisible();
    await page.getByPlaceholder('Type a reply…').fill('hello there');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    // The step says it is simulated and names what it would have matched and where the answer would be saved.
    await expect(
      page.getByText(
        '(simulated) Answer from FAQ for "{{user_message}}": the test chat does not look up your FAQs, so nothing is sent and {{faq}} stays empty. Taking the "answered" exit.',
        { exact: true },
      ),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByTestId('test-log').getByText('Answered branch', { exact: true }),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByTestId('test-log').getByText('No match branch', { exact: true }),
    ).toHaveCount(0);

    await openBuilder(page, onlyNoMatch, 3);
    await page.getByRole('button', { name: 'Test', exact: true }).click();
    await page.getByPlaceholder('Type a reply…').fill('hello again');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(
      page.getByText(
        '(simulated) Answer from FAQ for "where is my order": the test chat does not look up your FAQs, and the "answered" exit is not connected, so taking "no match". {{myfaq}} stays empty.',
        { exact: true },
      ),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByTestId('test-log').getByText('No match branch', { exact: true }),
    ).toBeVisible({
      timeout: 30_000,
    });
  });

  test('dark mode and a right-to-left page keep the form usable', async ({ browser, watch }) => {
    const uuid = await wiredFlow(ws, tag());
    const dark = await open(browser, state, watch, {
      viewport: BIG,
      colorScheme: 'dark',
      theme: 'dark',
    });
    await openBuilder(dark.page, uuid, 4);
    await openInspector(dark.page, 'f');
    await expect(field(dark.page, 'Message to match').locator('input')).toBeVisible();
    const colours = await field(dark.page, 'Message to match')
      .locator('input')
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return { fg: s.color, bg: s.backgroundColor };
      });
    expect(colours.fg).not.toBe(colours.bg);

    const rtl = await open(browser, state, watch, { viewport: BIG, locale: 'ar' });
    await openBuilder(rtl.page, uuid, 4);
    await expect(rtl.page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(nodeCard(rtl.page, 'f')).toBeVisible();
    // The inspector still opens on the node (its pencil is the second button of the action bar).
    await nodeCard(rtl.page, 'f').locator('.chip-icon + div > div').first().click();
    await rtl.page.locator('.node-actions button').nth(1).click();
    const panel = rtl.page
      .locator('aside')
      .filter({ has: rtl.page.locator('input[value="{{user_message}}"]') });
    await expect(panel).toBeVisible();
    await expect(panel.locator('input[value="{{user_message}}"]')).toBeEditable();
  });
});

test.describe('in the Simple builder', () => {
  let sws: Workspace;
  let sstate: State;
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    // (`newWorkspace` already switched the workspace to the Simple builder and gave it the automation feature.)
    sws = await newWorkspace('flownodesimple');
    sstate = await login(browser, sws.email);
  });

  const stepCard = (page: Page) =>
    page.locator('section[id^="step-"]').filter({ hasText: 'Answer from FAQ' }).last();
  const sfield = (page: Page, label: string): Locator =>
    stepCard(page)
      .locator('div.space-y-1\\.5')
      .filter({ has: page.locator('label', { hasText: label }) })
      .first();
  const addButtons = (page: Page) => page.getByRole('button', { name: 'Add a step' });
  const faqItem = (page: Page) => page.getByRole('menuitem', { name: /^Answer from FAQ/ });
  const simpleSave = (page: Page) => page.getByRole('button', { name: 'Save', exact: true });
  const twoSteps = () =>
    seedBuilderFlow(
      sws,
      tag(),
      [
        { id: 't', type: 'trigger' },
        { id: 'a', type: 'message', data: { text: 'Welcome' } },
        { id: 'b', type: 'message', data: { text: 'Second step here' } },
      ],
      [
        ['t', 'out', 'a'],
        ['a', 'out', 'b'],
      ],
    );
  async function openSimple(page: Page, uuid: string, text = 'Welcome') {
    await page.goto(`/flows/simple/${uuid}`, { timeout: 120_000 });
    await page.getByText(text).first().waitFor({ timeout: 90_000 });
  }

  test('it is offered under "Answer", can only go last, and nothing can follow it', async ({
    browser,
    watch,
  }) => {
    const uuid = twoSteps();
    const { page } = await open(browser, sstate, watch, {
      viewport: { width: 1440, height: 1000 },
    });
    await openSimple(page, uuid);
    expect(await addButtons(page).count()).toBe(3);

    // Before the first step and between two steps: listed, but off, with the reason.
    for (const at of [0, 1]) {
      await addButtons(page).nth(at).click();
      const menu = page.getByRole('menu');
      await expect(menu.getByText('Answer', { exact: true })).toBeVisible();
      await expect(faqItem(page)).toBeDisabled();
      await expect(faqItem(page)).toHaveAttribute(
        'title',
        'Answer from FAQ has two exits, so it can only go last.',
      );
      await expect(faqItem(page)).toContainText(
        "Match the customer's message to your FAQs. Ends this flow: one exit if an FAQ answered, another if not",
      );
      await addButtons(page).nth(at).click();
      await expect(menu).toHaveCount(0);
    }
    // After the last step it is on, and choosing it adds the step and opens it.
    await addButtons(page).nth(2).click();
    await expect(faqItem(page)).toBeEnabled();
    await faqItem(page).click();
    await expect(stepCard(page)).toBeVisible();
    await expect(stepCard(page).getByText('1.3', { exact: true })).toBeVisible();
    await expect(stepCard(page)).toContainText('From your FAQs');
    await expect(
      page.getByText(
        'This step ends this part: what is sent next depends on whether an FAQ answered.',
      ),
    ).toBeVisible();
    // Nothing can follow it: no "+" below it and no "Then go to".
    expect(await addButtons(page).count()).toBe(3);
    await expect(page.getByText('Then go to', { exact: true })).toHaveCount(0);
    await expect(stepCard(page).getByRole('button', { name: 'Duplicate' })).toHaveCount(0);
    await expect(stepCard(page).getByRole('button', { name: 'Move down' })).toBeDisabled();
    // Another one cannot be put before it either: its slot is not the end.
    await addButtons(page).nth(2).click();
    await expect(faqItem(page)).toBeDisabled();
    await addButtons(page).nth(2).click();

    // Deleting it gives the end of the part back.
    await stepCard(page).getByRole('button', { name: 'Delete step' }).click();
    await expect(page.getByText('1.3', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Then go to', { exact: true })).toBeVisible();
    // A step cannot be moved after it.
    await addButtons(page).nth(2).click();
    await faqItem(page).click();
    const second = page.locator('#step-b');
    await second.getByRole('button', { name: 'Move down' }).click();
    // Still last: the FAQ step is 1.3 and holds the end of the part.
    await expect(stepCard(page).getByText('1.3', { exact: true })).toBeVisible();
  });

  test('fill it, point both exits at new parts, save: the graph has the node, the exits and the parts', async ({
    browser,
    watch,
  }) => {
    test.setTimeout(240_000);
    const uuid = seedBuilderFlow(
      sws,
      tag(),
      [
        { id: 't', type: 'trigger' },
        { id: 'a', type: 'message', data: { text: 'Welcome' } },
      ],
      [['t', 'out', 'a']],
    );
    await standardFaqs(sws, uuid);
    const { page } = await open(browser, sstate, watch, {
      viewport: { width: 1440, height: 1100 },
    });
    await openSimple(page, uuid);
    await addButtons(page).nth(1).click();
    await faqItem(page).click();
    await expect(stepCard(page)).toBeVisible();

    await sfield(page, 'Message to match').locator('input').fill('{{answer}}');
    const category = sfield(page, 'Only these FAQs').locator('select');
    await expect
      .poll(() => category.locator('option').evaluateAll((os) => os.map((o) => o.textContent)))
      .toEqual(['All FAQs', 'Account', 'Shipping']);
    await category.selectOption('Shipping');
    const useWorkspace = sfield(page, 'Minimum score').getByRole('checkbox', {
      name: "Use this flow's setting",
    });
    await useWorkspace.uncheck();
    const min = sfield(page, 'Minimum score').getByRole('spinbutton', { name: 'Minimum score' });
    await expect(min).toHaveValue('0.5');
    for (const bad of ['0.04', '1', '1.0', '0']) {
      await min.fill(bad);
      await expect(sfield(page, 'Minimum score').getByRole('alert'), bad).toHaveText(MIN_SCORE_MSG);
    }
    await min.fill('0.05');
    await expect(sfield(page, 'Minimum score').getByRole('alert')).toHaveCount(0);
    await min.fill('0.75');
    await sfield(page, 'Send the answer to the customer').getByRole('checkbox').uncheck();
    await expect(
      sfield(page, 'Send the answer to the customer').getByText(
        /^Nothing is sent: the answer is only saved/,
      ),
    ).toBeVisible();
    await sfield(page, 'Save the result as').locator('input').fill('simplefaq');
    await expect(
      stepCard(page).getByText('{{simplefaq.answer}}', { exact: false }).first(),
    ).toBeVisible();

    // Both exits lead to a new part each; every part gets a message.
    const flowsNav = page.getByRole('navigation', { name: 'Flows' });
    const toExit = async (label: string, partName: string, text: string) => {
      const card = stepCard(page);
      if ((await sfield(page, label).count()) === 0)
        await card.getByRole('button', { expanded: false }).first().click();
      await sfield(page, label).locator('select').selectOption({ label: '+ Lead to a new flow…' });
      await expect(flowsNav.getByText(partName)).toBeVisible();
      await page.locator('textarea').first().fill(text);
      await flowsNav.getByText('Main flow').click();
    };
    await toExit('If an FAQ answered, go to', 'Flow 2', 'Answered part');
    await toExit('If no FAQ answered, go to', 'Flow 3', 'No match part');

    // Collapsed, the step shows where each exit goes.
    if ((await stepCard(page).getByRole('button', { expanded: true }).count()) > 0)
      await stepCard(page).getByRole('button', { expanded: true }).first().click();
    await expect(stepCard(page).getByText('Answered → 2.1')).toBeVisible();
    await expect(stepCard(page).getByText('No match → 3.1')).toBeVisible();

    await simpleSave(page).click();
    await expect(page.getByText(/^Saved "/)).toBeVisible();
    const graph = flowGraph(sws, uuid);
    const faq = graph.flowNodes.find((x: any) => x.type === 'faq');
    expect(faq).toBeDefined();
    expect(faq.data).toEqual({
      query: '{{answer}}',
      category: 'Shipping',
      minScore: 0.75,
      sendAnswer: false,
      save: 'simplefaq',
    });
    const text = (id: string) => graph.flowNodes.find((x: any) => x.id === id)?.data?.text;
    const edge = (handle: string) =>
      graph.flowEdges.find((e: any) => e.source === faq.id && e.sourceHandle === handle);
    expect(text(edge('matched').target)).toBe('Answered part');
    expect(text(edge('no_match').target)).toBe('No match part');
    // Nothing leaves the FAQ node by any other port, and the step before it leads into it.
    expect(graph.flowEdges.filter((e: any) => e.source === faq.id)).toHaveLength(2);
    expect(graph.flowEdges.some((e: any) => e.source === 'a' && e.target === faq.id)).toBe(true);

    // Read back after a reload: the parts, the exits and every field.
    await openSimple(page, uuid);
    await expect(flowsNav.getByText('Flow 2')).toBeVisible();
    await expect(flowsNav.getByText('Flow 3')).toBeVisible();
    await expect(stepCard(page).getByText('Answered → 2.1')).toBeVisible();
    await expect(stepCard(page).getByText('No match → 3.1')).toBeVisible();
    await stepCard(page).getByRole('button', { expanded: false }).first().click();
    await expect(sfield(page, 'Message to match').locator('input')).toHaveValue('{{answer}}');
    await expect(sfield(page, 'Only these FAQs').locator('select')).toHaveValue('Shipping');
    await expect(
      sfield(page, 'Minimum score').getByRole('checkbox', { name: "Use this flow's setting" }),
    ).not.toBeChecked();
    await expect(
      sfield(page, 'Minimum score').getByRole('spinbutton', { name: 'Minimum score' }),
    ).toHaveValue('0.75');
    await expect(
      sfield(page, 'Send the answer to the customer').getByRole('checkbox'),
    ).not.toBeChecked();
    await expect(sfield(page, 'Save the result as').locator('input')).toHaveValue('simplefaq');
    await expect(
      sfield(page, 'If an FAQ answered, go to').locator('select option:checked'),
    ).toContainText('2.1 · Message · Answered part');
    await expect(
      sfield(page, 'If no FAQ answered, go to').locator('select option:checked'),
    ).toContainText('3.1 · Message · No match part');
  });

  test('a bad minimum score is shown on the step and blocks saving, naming the step', async ({
    browser,
    watch,
  }) => {
    const uuid = seedBuilderFlow(
      sws,
      tag(),
      [
        { id: 't', type: 'trigger' },
        { id: 'a', type: 'message', data: { text: 'Welcome' } },
        {
          id: 'f',
          type: 'faq',
          data: {
            query: '{{user_message}}',
            category: '',
            minScore: 0.04,
            sendAnswer: true,
            save: 'faq',
          },
        },
      ],
      [
        ['t', 'out', 'a'],
        ['a', 'out', 'f'],
      ],
    );
    const { page } = await open(browser, sstate, watch, {
      viewport: { width: 1440, height: 1000 },
    });
    await openSimple(page, uuid);
    await expect(page.getByText('1 to fix')).toBeVisible();
    // Publishing is refused and says which step; Save still works (a draft may be unfinished).
    await page.getByRole('button', { name: 'Publish changes' }).click();
    const problem = page.getByRole('button', {
      name: "Step 1.2: the minimum score must be from 0.05 to 0.99, or use the flow's setting.",
    });
    await expect(problem).toBeVisible();
    await expect(page.getByText('Fix these before publishing:')).toBeVisible();
    // The problem opens the step, where the field says the same.
    await problem.click();
    await expect(sfield(page, 'Minimum score').getByRole('alert')).toHaveText(MIN_SCORE_MSG);
    await sfield(page, 'Minimum score')
      .getByRole('spinbutton', { name: 'Minimum score' })
      .fill('0.99');
    await expect(page.getByText('1 to fix')).toHaveCount(0);
    await simpleSave(page).click();
    await expect(page.getByText(/^Saved "/)).toBeVisible();
    expect(savedNode(sws, uuid, 'f').data.minScore).toBe(0.99);
  });

  test('a flow saved by the advanced builder opens in Simple with the step, its exits and its parts', async ({
    browser,
    watch,
  }) => {
    const uuid = seedBuilderFlow(
      sws,
      tag(),
      [
        { id: 't', type: 'trigger' },
        { id: 'a', type: 'message', data: { text: 'Welcome' } },
        {
          id: 'f',
          type: 'faq',
          data: {
            query: '{{user_message}}',
            category: 'Account',
            minScore: 0.6,
            sendAnswer: true,
            save: 'acct',
          },
        },
        { id: 'p', type: 'message', data: { text: 'Answered part from the canvas' } },
        { id: 'q', type: 'message', data: { text: 'No match part from the canvas' } },
      ],
      [
        ['t', 'out', 'a'],
        ['a', 'out', 'f'],
        ['f', 'matched', 'p'],
        ['f', 'no_match', 'q'],
      ],
    );
    await standardFaqs(sws, uuid);
    const { page } = await open(browser, sstate, watch, {
      viewport: { width: 1440, height: 1000 },
    });
    await openSimple(page, uuid);
    await expect(stepCard(page).getByText('Answer from FAQ').first()).toBeVisible();
    await expect(stepCard(page)).toContainText('From your FAQs · Account');
    await expect(stepCard(page).getByText(/^Answered → \d\.\d$/)).toBeVisible();
    await expect(stepCard(page).getByText(/^No match → \d\.\d$/)).toBeVisible();
    await expect(page.getByText('Then go to', { exact: true })).toHaveCount(0);
    await stepCard(page).getByRole('button', { expanded: false }).first().click();
    await expect(sfield(page, 'Only these FAQs').locator('select')).toHaveValue('Account');
    await expect(sfield(page, 'Save the result as').locator('input')).toHaveValue('acct');
    await expect(
      sfield(page, 'If an FAQ answered, go to').locator('select option:checked'),
    ).toContainText('Answered part from the canvas');
    await expect(
      sfield(page, 'If no FAQ answered, go to').locator('select option:checked'),
    ).toContainText('No match part from the canvas');
    // Pointing an exit at "Ends here" saves as no edge on that port.
    await sfield(page, 'If no FAQ answered, go to')
      .locator('select')
      .selectOption({ label: 'Ends here (nothing more is sent)' });
    await simpleSave(page).click();
    await expect(page.getByText(/^Saved "/)).toBeVisible();
    const edges = flowGraph(sws, uuid).flowEdges.filter((e: any) => e.source === 'f');
    expect(edges.map((e: any) => e.sourceHandle)).toEqual(['matched']);
  });
});

/** A published flow answers a real customer on the simulator: the FAQ answer, then the branch the match took. */
test.describe('a customer goes through a published flow with the node', () => {
  let sim: Sim;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    // Keyword flows: the workspace's own FAQ answering stays off, so only the node looks at the message.
    sim = await simulator(ws);
    const branches = (suffix: string): BuilderNode[] => [
      BRANCHES[0]!,
      { id: 'A', type: 'message', data: { text: `Answered branch${suffix}` }, x: 960, y: 60 },
      { id: 'B', type: 'message', data: { text: `No match branch${suffix}` }, x: 960, y: 380 },
    ];
    const flow = (
      name: string,
      keywords: string,
      data: Record<string, unknown>,
      suffix: string,
      answered?: string,
    ) => {
      const b = branches(suffix);
      if (answered) b[1]!.data = { text: answered };
      return seedBuilderFlow(
        ws,
        name,
        [b[0]!, faqNode('f', data), b[1]!, b[2]!],
        [
          ['t', 'out', 'f'],
          ['f', 'matched', 'A'],
          ['f', 'no_match', 'B'],
        ],
        { keywords },
      );
    };
    // Each flow answers from its own FAQs.
    const made = [
      flow('Journey A', 'faqnodea', {}, ''),
      flow('Journey C', 'faqnodec', { category: 'Shipping' }, ' C'),
      flow(
        'Journey D',
        'faqnoded',
        { sendAnswer: false, save: 'ans' },
        ' D',
        'Got: {{ans.matched}} {{ans.answer}}',
      ),
    ];
    for (const uuid of made) await standardFaqs(ws, uuid);
    await waitIndexed(ws);
  });

  test('a message that matches an FAQ gets its answer and then the "answered" branch', async () => {
    test.setTimeout(600_000);
    const from = await customerAsks(
      ws,
      sim,
      'faqnodea where is my order',
      (f) => repliesTo(ws, f).length >= 2,
    );
    expect(repliesTo(ws, from)).toEqual(['Your order ships tomorrow.', 'Answered branch']);
    // The match is in the log as a match made by a flow, and it was not sent twice.
    // Flow-origin rows are kept out of the workspace's log views on purpose, so read the table.
    const rows = sql(
      `SELECT outcome, origin FROM faq_match_logs WHERE org_id=${ws.orgId} AND query='faqnodea where is my order' ORDER BY id`,
    );
    expect(rows).toEqual([['answered', 'flow']]);
  });

  test('a message nothing matches takes the "no match" branch and no FAQ text is sent', async () => {
    test.setTimeout(600_000);
    const from = await customerAsks(
      ws,
      sim,
      'faqnodea qqzz wwxx',
      (f) => repliesTo(ws, f).length >= 1,
    );
    expect(repliesTo(ws, from)).toEqual(['No match branch']);
  });

  test('"Only these FAQs" keeps an FAQ of another category from answering', async () => {
    test.setTimeout(600_000);
    // "Reset my password" is an Account FAQ and its phrase is typed exactly, but this node only looks at Shipping.
    const from = await customerAsks(
      ws,
      sim,
      'faqnodec reset my password',
      (f) => repliesTo(ws, f).length >= 1,
    );
    expect(repliesTo(ws, from)).toEqual(['No match branch C']);
  });

  test('with "send the answer" off nothing is sent by the node, and the answer is in the variables', async () => {
    test.setTimeout(600_000);
    const from = await customerAsks(
      ws,
      sim,
      'faqnoded where is my order',
      (f) => repliesTo(ws, f).length >= 1,
    );
    expect(repliesTo(ws, from)).toEqual(['Got: yes Your order ships tomorrow.']);
  });
});
