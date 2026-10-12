import {
  answering,
  customerSays,
  expect,
  go,
  logCount,
  login,
  newWorkspace,
  open,
  openFaqs,
  putSettings,
  repliesTo,
  seedFaq,
  seedFlow,
  type Sim,
  simulator,
  sql,
  type State,
  test,
  waitIndexed,
  type Workspace,
} from './support';

/** A simulated customer writes in: the FAQ answers with text, starts its flow, or stays quiet. Checked in the database and in the team inbox. */
let ws: Workspace;
let state: State;
let sim: Sim;
let n = 0;
/** A different customer per test, so replies never mix. */
const customer = () => `9197${String(Date.now()).slice(-6)}${String(++n).padStart(2, '0')}`;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  ws = await newWorkspace('loop');
  state = await login(browser, ws.email);
  sim = await simulator(ws);
  await seedFaq(ws, {
    question: 'Where is my order?',
    answerText: 'Your order ships tomorrow.',
    variations: ['track my order'],
  });
  await seedFaq(ws, {
    question: 'Talk to billing',
    flowId: seedFlow(ws, 'Pwloop billing flow', 'You are now talking to the billing flow.'),
    variations: ['billing agent please'],
  });
  await waitIndexed(ws);
  await putSettings(ws, { enabled: true });
});

test('with answering on, a customer message gets the FAQ text, and the team inbox shows it', async ({
  browser,
  watch,
}) => {
  // The inbox's own contact panel asks for appointments and gets a 422 here: not a FAQ screen, so not judged by this test.
  watch.allow(/\/appointments\?/, /status of 422.*\/inbox/);
  const from = customer();
  await customerSays(ws, sim, 'where is my ORDER', from);
  await expect
    .poll(() => repliesTo(ws, from), { timeout: 30_000 })
    .toEqual(['Your order ships tomorrow.']);
  await expect
    .poll(() => logCount(ws, "AND outcome='answered'"), { timeout: 15_000 })
    .toBeGreaterThan(0);

  const { page } = await open(browser, state, watch);
  await go(page, '/inbox');
  await page.getByText('Asha').first().click();
  await expect(page.getByText('Your order ships tomorrow.').first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText('where is my ORDER').first()).toBeVisible();
});

test('a similar message in other words is answered by meaning', async () => {
  const from = customer();
  await customerSays(ws, sim, 'order tracking', from);
  await expect
    .poll(() => repliesTo(ws, from), { timeout: 30_000 })
    .toEqual(['Your order ships tomorrow.']);
  // A retry window later there is still exactly one reply.
  await customerSays(ws, sim, 'track order', from);
  await expect.poll(() => repliesTo(ws, from).length, { timeout: 30_000 }).toBe(2);
});

test('a flow-linked FAQ starts its flow instead of sending text', async () => {
  const from = customer();
  await customerSays(ws, sim, 'talk to billing', from);
  await expect
    .poll(() => repliesTo(ws, from), { timeout: 30_000 })
    .toEqual(['You are now talking to the billing flow.']);
  await expect
    .poll(() => logCount(ws, "AND outcome='flow_started'"), { timeout: 15_000 })
    .toBeGreaterThan(0);
});

test('with answering off nothing is sent; switching it on answers the next message only', async ({
  browser,
  watch,
}) => {
  const quiet = await newWorkspace('loopoff');
  const quietState = await login(browser, quiet.email);
  const quietSim = await simulator(quiet);
  await seedFaq(quiet, {
    question: 'Where is my order?',
    answerText: 'Your order ships tomorrow.',
  });
  await waitIndexed(quiet);
  const from = customer();

  await customerSays(quiet, quietSim, 'where is my order', from);
  // Wait until the platform has surely handled the first message: the conversation exists and holds it.
  await expect.poll(() => Number(sqlCount(quiet, from)), { timeout: 30_000 }).toBeGreaterThan(0);
  expect(repliesTo(quiet, from)).toEqual([]);
  expect(logCount(quiet)).toBe(0);

  const { page } = await open(browser, quietState, watch);
  await openFaqs(page, quiet);
  await expect(page.getByText('FAQ answering is OFF for this flow')).toBeVisible();
  await page.getByRole('button', { name: 'Turn on FAQ answering' }).click();
  await expect(page.getByText('FAQ answering is on.')).toBeVisible();

  await customerSays(quiet, quietSim, 'where is my order', from);
  await expect
    .poll(() => repliesTo(quiet, from), { timeout: 30_000 })
    .toEqual(['Your order ships tomorrow.']);
  expect(await answering(quiet, false)).toMatchObject({ enabled: false });
});

const sqlCount = (w: Workspace, from: string) =>
  sql(
    `SELECT count(*) FROM messages m JOIN conversations c ON c.org_id=m.org_id AND c.id=m.conversation_id WHERE c.org_id=${w.orgId} AND c.peer_key='${from}' AND m.direction='in'`,
  )[0]![0]!;
