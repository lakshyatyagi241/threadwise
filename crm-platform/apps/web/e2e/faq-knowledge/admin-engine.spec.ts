import { expect, test } from '@playwright/test';
import {
  LAUNCH,
  WEB,
  cleanupTag,
  openFaq,
  operatorApi,
  poolWorkspace,
  restoreConfig,
  runTag,
  save,
  signInOperator,
  signInWorkspace,
  sql,
  sqlNum,
  sw,
  waitReady,
  type Workspace,
  faqUrl,
} from './admin-support';

test.use({ launchOptions: LAUNCH });
test.setTimeout(300_000);

const TAG = runTag('pwadmeng');

test.afterEach(async () => {
  await restoreConfig();
});

const dialog = (page: import('@playwright/test').Page) =>
  page.getByRole('dialog', { name: 'Review before saving' });

test.describe('engine switch: confirmation', () => {
  test('cancelling the confirmation keeps the engine on and nothing is saved', async ({ page }) => {
    const sent: string[] = [];
    page.on('request', (r) => r.method() === 'PATCH' && sent.push(r.url()));
    await signInOperator(page);
    await openFaq(page);
    await sw(page).click();
    await expect(sw(page)).not.toBeChecked();
    await save(page).click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole('alert')).toContainText(
      'Turning the engine off stops every workspace from answering customers',
    );
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog(page)).toBeHidden();
    expect(sent).toEqual([]);
    const op = await operatorApi();
    try {
      expect((await op.overview()).config.engineEnabled).toBe(true);
    } finally {
      await op.dispose();
    }
    await expect(
      page.getByRole('group', { name: 'Engine', exact: true }).getByText('On', { exact: true }),
    ).toBeVisible();
    // The form still holds the unsaved choice, so it can be reviewed again or discarded.
    await expect(save(page)).toBeEnabled();
    await page.getByRole('button', { name: 'Discard changes' }).click();
    await expect(sw(page)).toBeChecked();
  });

  test('Escape also cancels and puts focus back on the Save button', async ({ page }) => {
    await signInOperator(page);
    await openFaq(page);
    await sw(page).click();
    await save(page).click();
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(save(page)).toBeFocused();
    const op = await operatorApi();
    try {
      expect((await op.overview()).config.engineEnabled).toBe(true);
    } finally {
      await op.dispose();
    }
  });

  test('confirming turns the engine off, the page says so, and turning it on needs no confirmation', async ({
    page,
  }) => {
    await signInOperator(page);
    await openFaq(page);
    await sw(page).click();
    await save(page).click();
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.method() === 'PATCH' && r.url().endsWith('/api/platform/faq')),
      dialog(page).getByRole('button', { name: 'Save changes' }).click(),
    ]);
    expect(req.postDataJSON()).toEqual({ engineEnabled: false });
    await expect(page.getByText('Settings saved.')).toBeVisible();
    const engine = page.getByRole('group', { name: 'Engine', exact: true });
    await expect(engine.getByText('Off', { exact: true })).toBeVisible();
    await expect(
      engine.getByText('No workspace is answering from FAQs and edits are blocked.'),
    ).toBeVisible();
    await page.reload();
    await openFaq(page);
    await expect(sw(page)).not.toBeChecked();
    // Back on: saved at once, no dialog.
    await sw(page).click();
    await save(page).click();
    await expect(page.getByText('Settings saved.')).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    await expect(engine.getByText('On', { exact: true })).toBeVisible();
    await expect(sw(page)).toBeChecked();
  });

  test('turning off together with another change sends both once the dialog is confirmed', async ({
    page,
  }) => {
    await signInOperator(page);
    await openFaq(page);
    await sw(page).click();
    await page.getByRole('textbox', { name: 'Maximum FAQs per flow' }).fill('510');
    await save(page).click();
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.method() === 'PATCH' && r.url().endsWith('/api/platform/faq')),
      dialog(page).getByRole('button', { name: 'Save changes' }).click(),
    ]);
    expect(req.postDataJSON()).toEqual({ engineEnabled: false, maxFaqs: 510 });
  });
});

test.describe('engine switch: effect on a workspace', () => {
  let ws: Workspace;
  let channelId: string;
  const answer = `Answer ${TAG}`;
  const question = `Where is the ${TAG} parcel`;

  test.beforeAll(async () => {
    ws = await poolWorkspace('A');
    await ws.enable(0.5);
    await ws.faq(question, [`${TAG} parcel tracking`], answer);
    await waitReady(ws);
    const ch = await ws.call('POST', '/channels/simulator', {
      name: `${TAG} sim`,
      settings: { simulator: { latencyMs: { sent: 0, delivered: 150, read: 400 } } },
    });
    expect(ch.status, JSON.stringify(ch.body)).toBe(201);
    channelId = ch.body.id;
  });
  test.afterAll(() => cleanupTag(TAG));

  const customer = async (peer: string, text: string) => {
    const r = await ws.call('POST', `/dev/simulator/channels/${channelId}/inbound`, {
      from: peer,
      name: 'Cust',
      text,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(202);
  };
  const outbound = (peer: string) =>
    sql(
      `SELECT m.body FROM messages m JOIN conversations c ON c.org_id=m.org_id AND c.id=m.conversation_id WHERE c.org_id=${ws.orgId} AND c.peer_key='${peer}' AND m.direction='out'`,
    );

  test('a workspace admin sees the platform banner, cannot create FAQs, and customers get no FAQ answer; turning on restores all', async ({
    browser,
    page,
  }) => {
    const peerOff = `9198${String(Date.now()).slice(-8)}`;
    const peerOn = `9197${String(Date.now()).slice(-8)}`;
    const wsPage = await (await browser.newContext({ baseURL: WEB })).newPage();
    const op = await operatorApi();
    try {
      await signInWorkspace(wsPage, ws);
      await wsPage.goto(faqUrl(ws), { timeout: 120_000 });
      await expect(
        wsPage.getByText('FAQ answering has been switched off by the platform'),
      ).toHaveCount(0);

      // The operator switches the engine off through the screen.
      await signInOperator(page);
      await openFaq(page);
      await sw(page).click();
      await save(page).click();
      await dialog(page).getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByText('Settings saved.')).toBeVisible();

      // Workspace admin: the banner, a blocked create, and what the API says.
      await wsPage.reload();
      await expect(
        wsPage.getByText(
          'FAQ answering has been switched off by the platform. Customers get no FAQ answers until it is switched back on.',
        ),
      ).toBeVisible({ timeout: 60_000 });
      const created = await ws.call('POST', `/faq/flows/${ws.flowUuid}/entries`, {
        question: `${TAG} blocked`,
        answerType: 'text',
        answerText: 'x',
        variations: [],
      });
      expect(created.status).toBe(422);
      expect(created.body.code).toBe('FAQ_ENGINE_DISABLED');
      expect(
        sqlNum(
          `SELECT count(*) FROM faqs WHERE org_id=${ws.orgId} AND question LIKE '%${TAG} blocked%'`,
        ),
      ).toBe(0);
      const settings = await ws.call('GET', `/faq/flows/${ws.flowUuid}/settings`);
      expect(settings.body.engineEnabled).toBe(false);

      // The create form shows a clear message instead of failing silently.
      await wsPage.goto(faqUrl(ws, 'new'), { timeout: 120_000 });
      await wsPage
        .getByRole('textbox', { name: /question/i })
        .first()
        .fill(`${TAG} via form`);
      await wsPage
        .getByRole('textbox', { name: /answer/i })
        .first()
        .fill('typed answer');
      await wsPage.getByRole('button', { name: 'Create FAQ' }).click();
      await expect(
        wsPage.getByText('FAQ answering is switched off for the whole platform right now.'),
      ).toBeVisible({ timeout: 30_000 });
      expect(
        sqlNum(
          `SELECT count(*) FROM faqs WHERE org_id=${ws.orgId} AND question LIKE '%${TAG} via form%'`,
        ),
      ).toBe(0);

      // The playground is blocked too, with the same clear message on screen.
      const test = await ws.call('POST', `/faq/flows/${ws.flowUuid}/test`, { query: question });
      expect(test.status).toBe(422);
      expect(test.body.code).toBe('FAQ_ENGINE_DISABLED');
      await wsPage.goto(faqUrl(ws, 'test'), { timeout: 120_000 });
      await wsPage.getByRole('textbox', { name: 'Customer message' }).fill(question);
      await wsPage.getByRole('button', { name: 'Run', exact: true }).click();
      await expect(
        wsPage.getByText('FAQ answering is switched off for the whole platform right now.'),
      ).toBeVisible({ timeout: 30_000 });

      // A customer message gets no FAQ answer and leaves no match log.
      await customer(peerOff, question);
      await expect
        .poll(
          () =>
            sqlNum(
              `SELECT count(*) FROM messages m JOIN conversations c ON c.org_id=m.org_id AND c.id=m.conversation_id WHERE c.org_id=${ws.orgId} AND c.peer_key='${peerOff}' AND m.direction='in'`,
            ),
          { timeout: 30_000 },
        )
        .toBe(1);
      await page.waitForTimeout(8000);
      expect(outbound(peerOff)).toBe('');
      expect(
        sqlNum(
          `SELECT count(*) FROM faq_match_logs WHERE org_id=${ws.orgId} AND query LIKE '%${TAG}%' AND created_at > now() - interval '2 minutes'`,
        ),
      ).toBe(0);

      // Back on: the banner goes, FAQs can be written, and the same customer message is answered.
      await sw(page).click();
      await save(page).click();
      await expect(page.getByText('Settings saved.')).toBeVisible();
      await wsPage.goto(faqUrl(ws), { timeout: 120_000 });
      await expect(wsPage.getByRole('heading', { name: /FAQ/ }).first()).toBeVisible();
      await expect(wsPage.getByText('switched off by the platform')).toHaveCount(0);
      const again = await ws.call('POST', `/faq/flows/${ws.flowUuid}/entries`, {
        question: `${TAG} created after`,
        answerType: 'text',
        answerText: 'ok',
        variations: [],
      });
      expect(again.status, JSON.stringify(again.body)).toBe(201);
      // The worker keeps the platform config for up to 5 s (PlatformSettingsService cache); wait that window out, as for switching off.
      await page.waitForTimeout(6000);
      await customer(peerOn, question);
      await expect.poll(() => outbound(peerOn), { timeout: 60_000 }).toContain(answer);
    } finally {
      await op.setConfig({ engineEnabled: true });
      await op.dispose();
      await wsPage.context().close();
    }
  });
});
