import {
  call,
  closeCall,
  customerAsks,
  expect,
  faqBase,
  getSettings,
  login,
  member,
  newWorkspace,
  open,
  openFaqs,
  operator,
  putSettings,
  reloadFaqs,
  repliesTo,
  seedFaq,
  type Sim,
  simulator,
  sqlOne,
  type State,
  tabTo,
  test,
  waitIndexed,
  type Workspace,
} from './support';
import type { Page } from '@playwright/test';

test.describe.configure({ timeout: 120_000 });

/**
 * The second check ("borderline check"): a match that only just clears the bar is double-checked by a small chat model that can only
 * withhold an answer. With the offline AI the judge answers by a marker in the customer's text: `[[reject]]` vetoes,
 * `[[judge-fail]]` is a provider failure and `[[judge-garbage]]` an unreadable answer (both let the match stand); anything else is
 * confirmed. A check runs only when the meaning score is in [threshold, threshold + band), so every test first reads the score of
 * the exact text it will use and puts the bar just under it.
 */
const verifySwitch = (page: Page) =>
  page.getByRole('switch', { name: 'Check close calls with a second opinion' });
const band = (page: Page) => page.getByRole('slider', { name: 'How close counts as a close call' });
const sens = (page: Page) =>
  page.getByRole('slider', { name: 'Answer when the match is at least' });
const save = (page: Page) => page.getByRole('button', { name: 'Save settings' });
const discard = (page: Page) => page.getByRole('button', { name: 'Discard' });
const sentence = (page: Page) => page.locator('p[aria-live="polite"]');
const card = (page: Page) => page.getByRole('region', { name: 'Second check for close calls' });
const verifyGroup = (page: Page) => page.getByRole('group', { name: 'Second check', exact: true });

const QUESTION = 'How do I get a refund for my order?';
const ANSWER = 'Refunds take 5 days.';
const MODEL = 'openai/gpt-4o-mini';

/** Puts the platform's second-check config back to what a fresh install has. */
async function restorePlatform() {
  const op = await operator();
  try {
    await op.patch({ verifyEnabled: true, verifyModel: MODEL, verifyPerHour: 300 });
  } finally {
    await op.dispose();
  }
}

const arrange = closeCall;

const testQuery = async (w: Workspace, query: string) =>
  (await call(w, 'POST', `${faqBase(w)}/test`, { query })).body;

async function fresh(browser: import('@playwright/test').Browser, label: string) {
  const ws = await newWorkspace(label);
  await seedFaq(ws, {
    question: QUESTION,
    answerText: ANSWER,
    variations: ['refund policy'],
  });
  await seedFaq(ws, { question: 'Where is my parcel?', answerText: 'Check tracking.' });
  await waitIndexed(ws);
  // A first save makes the row the later saves lock against.
  await putSettings(ws, { enabled: true });
  return { ws, state: await login(browser, ws.email) };
}

async function ask(page: Page, text: string) {
  const box = page.getByLabel('Customer message');
  await box.fill(text);
  await box.press('Enter');
}

test.afterAll(async () => {
  await restorePlatform();
});

test.describe('the settings card', () => {
  test('starts off with the defaults, and Save and Discard wait for a change', async ({
    browser,
    watch,
  }) => {
    const { ws, state } = await fresh(browser, 'scdefault');
    const { page } = await open(browser, state, watch);
    await openFaqs(page, ws, 'settings');
    await expect(page.getByRole('heading', { name: 'Second check for close calls' })).toBeVisible();
    await expect(verifySwitch(page)).not.toBeChecked();
    await expect(verifySwitch(page)).toBeEnabled();
    await expect(card(page).getByText('Off', { exact: true })).toBeVisible();
    await expect(
      card(page).getByText('Every match that reaches the bar is answered without a second look.'),
    ).toBeVisible();
    await expect(band(page)).toHaveAttribute('aria-valuetext', '+10%');
    await expect(band(page)).toHaveAttribute('min', '0.01');
    await expect(band(page)).toHaveAttribute('max', '0.3');
    await expect(
      card(page).getByText(/^Every match scoring 50% or more is answered\./),
    ).toBeVisible();
    await expect(save(page)).toBeDisabled();
    await expect(discard(page)).toBeDisabled();
    const s = await getSettings(ws);
    expect(s).toMatchObject({
      verifyMode: 'off',
      verifyBand: 0.1,
      verifyAvailable: true,
      verifyModel: MODEL,
    });
    // The facts list mentions the check only while the platform offers it.
    await expect(page.getByText(/^Second check \(optional\)/)).toBeVisible();
  });

  test('turning it on explains it, saves, survives a reload and can be turned off again', async ({
    browser,
    watch,
  }) => {
    const { ws, state } = await fresh(browser, 'scon');
    const { page } = await open(browser, state, watch);
    await openFaqs(page, ws, 'settings');
    await verifySwitch(page).click();
    await expect(verifySwitch(page)).toBeChecked();
    await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
    await expect(save(page)).toBeEnabled();
    await expect(card(page).getByText('On', { exact: true })).toBeVisible();
    await expect(card(page).getByText(/it never makes an answer happen\./)).toBeVisible();
    await expect(sentence(page)).toHaveText(
      `Matches scoring from 50% up to 60% are checked by ${MODEL}. A "no" means no answer is sent and the message appears under Unanswered.`,
    );
    // Nothing was saved by clicking.
    expect((await getSettings(ws)).verifyMode).toBe('off');

    await save(page).click();
    await expect(page.getByText('Settings saved.')).toBeVisible();
    await expect(save(page)).toBeDisabled();
    await expect.poll(async () => (await getSettings(ws)).verifyMode).toBe('borderline');
    await reloadFaqs(page);
    await expect(verifySwitch(page)).toBeChecked();
    await expect(band(page)).toHaveAttribute('aria-valuetext', '+10%');

    await verifySwitch(page).click();
    await save(page).click();
    await expect(page.getByText('Settings saved.').first()).toBeVisible();
    await expect.poll(async () => (await getSettings(ws)).verifyMode).toBe('off');
    expect((await getSettings(ws)).verifyBand).toBe(0.1);
  });

  test('the band slider works by keyboard from 1% to 30%, and the sentence follows it and the bar', async ({
    browser,
    watch,
  }) => {
    const { ws, state } = await fresh(browser, 'scband');
    const { page } = await open(browser, state, watch);
    await openFaqs(page, ws, 'settings');
    await verifySwitch(page).click();
    await band(page).focus();
    await band(page).press('Home');
    await expect(band(page)).toHaveAttribute('aria-valuetext', '+1%');
    await expect(sentence(page)).toContainText('from 50% up to 51%');
    await band(page).press('ArrowLeft');
    await expect(band(page)).toHaveAttribute('aria-valuetext', '+1%');
    for (let i = 0; i < 4; i++) await band(page).press('ArrowRight');
    await expect(band(page)).toHaveAttribute('aria-valuetext', '+5%');
    await expect(page.getByText('+5%', { exact: true })).toBeVisible();
    await expect(sentence(page)).toContainText('from 50% up to 55%');
    await band(page).press('End');
    await expect(band(page)).toHaveAttribute('aria-valuetext', '+30%');
    await band(page).press('ArrowRight');
    await expect(band(page)).toHaveAttribute('aria-valuetext', '+30%');
    await expect(sentence(page)).toContainText('from 50% up to 80%');
    await band(page).press('ArrowLeft');
    await expect(sentence(page)).toContainText('from 50% up to 79%');

    // The bar moves the sentence too, and the top of the range stops at 100%.
    await sens(page).focus();
    await sens(page).press('Home');
    await expect(sentence(page)).toContainText('from 5% up to 34%');
    await sens(page).press('End');
    await expect(sentence(page)).toContainText('from 99% up to 100%');
    await expect(sentence(page)).not.toContainText('up to 100%.100');

    // Turning the check off swaps the sentence for the plain one at the same bar.
    await verifySwitch(page).click();
    await expect(sentence(page)).toContainText('Every match scoring 99% or more is answered.');
    await verifySwitch(page).click();

    await band(page).press('Home');
    for (let i = 0; i < 6; i++) await band(page).press('ArrowRight');
    await sens(page).press('Home');
    await save(page).click();
    await expect(page.getByText('Settings saved.')).toBeVisible();
    await expect
      .poll(async () => {
        const s = await getSettings(ws);
        return [s.verifyMode, s.verifyBand, s.threshold];
      })
      .toEqual(['borderline', 0.07, 0.05]);
    await reloadFaqs(page);
    await expect(band(page)).toHaveAttribute('aria-valuetext', '+7%');
    await expect(sentence(page)).toContainText('from 5% up to 12%');
  });

  test('a changed card is dirty, Discard undoes it, and leaving is guarded', async ({
    browser,
    watch,
  }) => {
    const { ws, state } = await fresh(browser, 'scdirty');
    const { page } = await open(browser, state, watch);
    await openFaqs(page, ws, 'settings');
    await verifySwitch(page).click();
    await band(page).focus();
    await band(page).press('End');
    await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
    await discard(page).click();
    await expect(verifySwitch(page)).not.toBeChecked();
    await expect(band(page)).toHaveAttribute('aria-valuetext', '+10%');
    await expect(page.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
    await expect(save(page)).toBeDisabled();

    // Changing the band alone is a change; putting it back is not.
    await band(page).press('ArrowRight');
    await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
    await band(page).press('ArrowLeft');
    await expect(page.getByText('Unsaved changes', { exact: true })).toHaveCount(0);

    await verifySwitch(page).click();
    await page
      .getByRole('navigation', { name: 'FAQ sections' })
      .getByRole('link', { name: 'Test' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Leave without saving?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Stay' }).click();
    await expect(page).toHaveURL(/[?&]view=settings$/);
    await expect(verifySwitch(page)).toBeChecked();

    // The browser's own prompt guards a reload.
    const kinds: string[] = [];
    page.on('dialog', (d) => {
      kinds.push(d.type());
      void d.dismiss();
    });
    await page.evaluate(() => location.reload());
    await expect.poll(() => kinds).toContain('beforeunload');

    await page
      .getByRole('navigation', { name: 'FAQ sections' })
      .getByRole('link', { name: 'Test' })
      .click();
    await page
      .getByRole('dialog', { name: 'Leave without saving?' })
      .getByRole('button', { name: 'Leave' })
      .click();
    await expect(page).toHaveURL(/[?&]view=test$/);
    expect((await getSettings(ws)).verifyMode).toBe('off');
  });

  test('two people saving: the second sees the conflict, reloads, and nothing is overwritten', async ({
    browser,
    watch,
  }) => {
    watch.allow(/409/);
    const { ws, state } = await fresh(browser, 'scconflict');
    const one = await open(browser, state, watch);
    const two = await open(browser, state, watch);
    await openFaqs(one.page, ws, 'settings');
    await openFaqs(two.page, ws, 'settings');

    await verifySwitch(one.page).click();
    await save(one.page).click();
    await expect(one.page.getByText('Settings saved.')).toBeVisible();

    await band(two.page).focus();
    await band(two.page).press('End');
    await save(two.page).click();
    await expect(
      two.page.getByText(
        'Someone else saved these settings. Reload to see their version, then make your change again.',
      ),
    ).toBeVisible();
    expect(await getSettings(ws)).toMatchObject({ verifyMode: 'borderline', verifyBand: 0.1 });

    await two.page.getByRole('button', { name: 'Reload settings' }).click();
    await expect(verifySwitch(two.page)).toBeChecked();
    await expect(band(two.page)).toHaveAttribute('aria-valuetext', '+10%');
    await band(two.page).focus();
    await band(two.page).press('End');
    await save(two.page).click();
    await expect(two.page.getByText('Settings saved.')).toBeVisible();
    expect(await getSettings(ws)).toMatchObject({ verifyMode: 'borderline', verifyBand: 0.3 });
  });

  test('a double click on Save sends one request', async ({ browser, watch }) => {
    const { ws, state } = await fresh(browser, 'scdouble');
    const { page } = await open(browser, state, watch);
    const puts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PUT' && /\/faq\/flows\/[^/]+\/settings$/.test(new URL(r.url()).pathname))
        puts.push(r.url());
    });
    await page.route(/\/faq\/flows\/[^/]+\/settings$/, async (route) => {
      if (route.request().method() === 'PUT') await new Promise((r) => setTimeout(r, 1000));
      await route.continue();
    });
    await openFaqs(page, ws, 'settings');
    await verifySwitch(page).click();
    await save(page).dblclick();
    await expect(page.getByText('Settings saved.')).toBeVisible();
    await page.waitForTimeout(1200); // a second request, if any, would have been sent by now
    expect(puts, 'a double click must send one request').toHaveLength(1);
    await expect(page.getByText('Someone else saved these settings.')).toHaveCount(0);
    expect((await getSettings(ws)).verifyMode).toBe('borderline');
  });

  test('a member who may only read sees the card but cannot change it', async ({
    browser,
    watch,
  }) => {
    const { ws } = await fresh(browser, 'screader');
    await putSettings(ws, { verifyMode: 'borderline', verifyBand: 0.2 });
    const reader = await member(ws, 'reader', ['faq.entries.read', 'flb.flows.read']);
    const readerState = await login(browser, reader.email);
    const { page } = await open(browser, readerState, watch);
    await openFaqs(page, ws, 'settings');
    await expect(verifySwitch(page)).toBeChecked();
    await expect(verifySwitch(page)).toBeDisabled();
    await expect(band(page)).toBeDisabled();
    await expect(band(page)).toHaveAttribute('aria-valuetext', '+20%');
    await expect(save(page)).toHaveCount(0);
    await expect(
      page.getByText(/Changing these settings needs the permission faq.settings.manage/),
    ).toBeVisible();
    const refused = await call(
      ws,
      'PUT',
      `${faqBase(ws)}/settings`,
      { enabled: true, threshold: 0.5, minMargin: 0, logQueries: true, verifyMode: 'off' },
      reader.token,
    );
    expect(refused.status).toBe(403);
    expect((await getSettings(ws)).verifyMode).toBe('borderline');
  });

  test('the API refuses a band outside 1% to 30% and a mode it does not know', async () => {
    const ws = await newWorkspace('scapi');
    await putSettings(ws, {});
    const cur = await getSettings(ws);
    const put = (patch: object) =>
      call(ws, 'PUT', `${faqBase(ws)}/settings`, {
        enabled: cur.enabled,
        threshold: cur.threshold,
        minMargin: cur.minMargin,
        logQueries: cur.logQueries,
        rowVersion: cur.rowVersion,
        ...patch,
      });
    for (const bad of [0, 0.009, 0.31, 1, -0.1, '0.1']) {
      const r = await put({ verifyMode: 'borderline', verifyBand: bad });
      expect(r.status, `band ${String(bad)}`).toBe(422);
    }
    expect((await put({ verifyMode: 'always' })).status).toBe(422);
    expect((await put({ verifyMode: 'borderline', verifyBand: 0.01 })).status).toBeLessThan(300);
    expect(await getSettings(ws)).toMatchObject({ verifyMode: 'borderline', verifyBand: 0.01 });
  });
});

test.describe('when the platform switches the check off', () => {
  test('the card says so and is disabled, the facts list drops it, and a decision is "skipped"', async ({
    browser,
    watch,
  }) => {
    const { ws, state } = await fresh(browser, 'scplatform');
    await arrange(ws, 'refund');
    const op = await operator();
    try {
      await op.patch({ verifyEnabled: false });
      await expect.poll(async () => (await getSettings(ws)).verifyAvailable).toBe(false);
      const { page } = await open(browser, state, watch);
      await openFaqs(page, ws, 'settings');
      await expect(
        card(page).getByText(/The platform has switched the second check off/),
      ).toBeVisible();
      await expect(verifySwitch(page)).toBeDisabled();
      await expect(band(page)).toBeDisabled();
      // The workspace's own choice is kept (and shown) for when the platform allows it again.
      await expect(verifySwitch(page)).toBeChecked();
      await expect(page.getByText(/^Second check \(optional\)/)).toHaveCount(0);

      // A close call is then not checked, and the playground says why.
      await openFaqs(page, ws, 'test');
      await ask(page, 'refund');
      await expect(page.getByText('Would answer', { exact: true }).first()).toBeVisible();
      await expect(verifyGroup(page).getByText('Second check skipped')).toBeVisible();
      await expect(verifyGroup(page)).toContainText('The check is switched off for the platform.');
    } finally {
      await op.patch({ verifyEnabled: true });
      await op.dispose();
    }
    await expect.poll(async () => (await getSettings(ws)).verifyAvailable).toBe(true);
  });

  test('a changed platform model shows in the sentence, and a very long one does not break the page', async ({
    browser,
    watch,
  }) => {
    const { ws, state } = await fresh(browser, 'scmodel');
    await putSettings(ws, { verifyMode: 'borderline' });
    const long = `vendor/${'very-long-model-name-'.repeat(5)}end`.slice(0, 120);
    const op = await operator();
    try {
      await op.patch({ verifyModel: long });
      await expect.poll(async () => (await getSettings(ws)).verifyModel).toBe(long);
      const { page } = await open(browser, state, watch, { viewport: { width: 375, height: 800 } });
      await openFaqs(page, ws, 'settings');
      await expect(sentence(page)).toContainText(`are checked by ${long}.`);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        'the model name must not widen the page',
      ).toBe(true);
    } finally {
      await op.patch({ verifyModel: MODEL });
      await op.dispose();
    }
  });
});

test.describe('the playground and "Try it" show the second check', () => {
  let ws: Workspace;
  let state: State;
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    ({ ws, state } = await fresh(browser, 'scplay'));
  });

  test('a close call that the check confirms: "Second check: yes", the model and the reason', async ({
    browser,
    watch,
  }) => {
    const { score, threshold } = await arrange(ws, 'refund');
    expect(score - threshold).toBeLessThan(0.1);
    const { page } = await open(browser, state, watch);
    await openFaqs(page, ws, 'test');
    await ask(page, 'refund');
    await expect(page.getByText('Would answer', { exact: true }).first()).toBeVisible();
    await expect(verifyGroup(page)).toBeVisible();
    await expect(verifyGroup(page).getByText('Second check: yes')).toBeVisible();
    await expect(verifyGroup(page)).toContainText(MODEL);
    await expect(verifyGroup(page)).toContainText('Same request as the FAQ.');
    await expect(verifyGroup(page)).toContainText('agreed the answer fits');
    await expect(page.getByRole('region', { name: 'What the customer would get' })).toContainText(
      ANSWER,
    );
  });

  test('a close call that the check vetoes: "Answer withheld", "Second check: no", nothing to send', async ({
    browser,
    watch,
  }) => {
    await arrange(ws, 'refund [[reject]]');
    const { page } = await open(browser, state, watch);
    await openFaqs(page, ws, 'test');
    await ask(page, 'refund [[reject]]');
    await expect(page.getByText('Answer withheld', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Would answer', { exact: true })).toHaveCount(0);
    await expect(verifyGroup(page).getByText('Second check: no')).toBeVisible();
    await expect(verifyGroup(page)).toContainText('A different request from the FAQ.');
    await expect(verifyGroup(page)).toContainText('The answer was withheld');
    await expect(page.getByRole('region', { name: 'What the customer would get' })).toHaveCount(0);
    // The numbers still say the score was enough: the veto is the only thing that held it back.
    await expect(page.getByText('50%').first()).toBeVisible();
    // A decision from the playground is a test: it never reaches the insights.
    const summary = (await call(ws, 'GET', `${faqBase(ws)}/insights/summary?days=30`)).body;
    expect(summary.totals.messages).toBe(0);
    const stored = (await testQuery(ws, 'refund [[reject]]')).verify;
    expect(stored).toMatchObject({ verdict: 'rejected', model: MODEL });
  });

  test('a check that fails still lets the answer through: "Second check failed"', async ({
    browser,
    watch,
  }) => {
    await arrange(ws, 'refund [[judge-fail]]');
    const { page } = await open(browser, state, watch);
    await openFaqs(page, ws, 'test');
    await ask(page, 'refund [[judge-fail]]');
    await expect(page.getByText('Would answer', { exact: true }).first()).toBeVisible();
    await expect(verifyGroup(page).getByText('Second check failed')).toBeVisible();
    await expect(verifyGroup(page)).toContainText('could not run, so the match stood');
    await expect(page.getByRole('region', { name: 'What the customer would get' })).toContainText(
      ANSWER,
    );
  });

  test('an unreadable verdict is also "failed" and the match stands', async ({
    browser,
    watch,
  }) => {
    await arrange(ws, 'refund [[judge-garbage]]');
    const { page } = await open(browser, state, watch);
    await openFaqs(page, ws, 'test');
    await ask(page, 'refund [[judge-garbage]]');
    await expect(page.getByText('Would answer', { exact: true }).first()).toBeVisible();
    await expect(verifyGroup(page).getByText('Second check failed')).toBeVisible();
    await expect(verifyGroup(page)).toContainText(
      'The model did not answer in the expected form, so the match stood.',
    );
  });

  test('past the hourly cap the check is "skipped" and the match stands', async ({
    browser,
    watch,
  }) => {
    await arrange(ws, 'refund');
    const op = await operator();
    try {
      await op.patch({ verifyPerHour: 0 });
      await expect
        .poll(async () => (await testQuery(ws, 'refund')).verify?.verdict, { timeout: 30_000 })
        .toBe('skipped');
      const { page } = await open(browser, state, watch);
      await openFaqs(page, ws, 'test');
      await ask(page, 'refund');
      await expect(page.getByText('Would answer', { exact: true }).first()).toBeVisible();
      await expect(verifyGroup(page).getByText('Second check skipped')).toBeVisible();
      await expect(verifyGroup(page)).toContainText('The hourly limit for checks was reached.');
      // Even a message the judge would veto is let through: nothing can veto without a check.
      await arrange(ws, 'refund [[reject]]');
      await ask(page, 'refund [[reject]]');
      await expect(page.getByText('Would answer', { exact: true }).first()).toBeVisible();
      await expect(verifyGroup(page).getByText('Second check skipped')).toBeVisible();
    } finally {
      await op.patch({ verifyPerHour: 300 });
      await op.dispose();
    }
  });

  test('no chip outside the band, for an exact phrase, with the check off, or below the bar', async ({
    browser,
    watch,
  }) => {
    const { score } = await arrange(ws, 'refund');
    const { page } = await open(browser, state, watch);
    await openFaqs(page, ws, 'test');

    // Far above the bar (more than a band): answered with no second look.
    await putSettings(ws, { threshold: Math.round((score - 0.3) * 100) / 100 });
    await reloadFaqs(page);
    await ask(page, 'refund');
    await expect(page.getByText('Would answer', { exact: true }).first()).toBeVisible();
    await expect(verifyGroup(page)).toHaveCount(0);
    expect((await testQuery(ws, 'refund')).verify).toBeNull();

    // An exact phrase is never a close call, even when the bar is right under 100%.
    await putSettings(ws, { threshold: 0.95, verifyBand: 0.1 });
    await ask(page, 'refund policy');
    await expect(page.getByText('Exact match', { exact: true })).toBeVisible();
    await expect(verifyGroup(page)).toHaveCount(0);
    expect((await testQuery(ws, 'refund policy')).verify).toBeNull();

    // Below the bar: nothing to check.
    await ask(page, 'weather forecast tomorrow');
    await expect(page.getByText('Below threshold', { exact: true }).first()).toBeVisible();
    await expect(verifyGroup(page)).toHaveCount(0);

    // The check off: the same close call carries no chip.
    await arrange(ws, 'refund');
    await putSettings(ws, { verifyMode: 'off' });
    await ask(page, 'refund');
    await expect(page.getByText('Would answer', { exact: true }).first()).toBeVisible();
    await expect(verifyGroup(page)).toHaveCount(0);

    // The edge of the band: the check runs while score < bar + band. A score of 70.71% with the bar at 65%: a band of 5 points ends
    // at 70% (outside), a band of 6 ends at 71% (inside).
    const edge = await testQuery(ws, 'refund');
    expect(edge.score).toBe(0.7071);
    await putSettings(ws, { threshold: 0.65, verifyMode: 'borderline', verifyBand: 0.05 });
    expect((await testQuery(ws, 'refund')).verify).toBeNull();
    await putSettings(ws, { verifyBand: 0.06 });
    expect((await testQuery(ws, 'refund')).verify?.verdict).toBe('confirmed');
  });

  test('"Try it" in the FAQ editor shows the same chip and reason', async ({ browser, watch }) => {
    await arrange(ws, 'refund [[reject]]');
    const faq = (await call(ws, 'GET', `${faqBase(ws)}/entries?limit=10`)).body.data.find(
      (e: any) => e.question === QUESTION,
    );
    const { page } = await open(browser, state, watch);
    await openFaqs(page, ws, faq.id);
    await page.locator('#faq-tryit-input').fill('refund [[reject]]');
    await page.locator('#faq-tryit-input').press('Enter');
    await expect(page.getByText('Answer withheld', { exact: true }).first()).toBeVisible();
    await expect(verifyGroup(page).getByText('Second check: no')).toBeVisible();
    await expect(verifyGroup(page)).toContainText('A different request from the FAQ.');
    // The same text with the marker removed is confirmed.
    await arrange(ws, 'refund');
    await page.locator('#faq-tryit-input').fill('refund');
    await page.locator('#faq-tryit-input').press('Enter');
    await expect(verifyGroup(page).getByText('Second check: yes')).toBeVisible();
  });

  test('the chip is readable: group name, text not colour alone, markup in a reason stays text', async ({
    browser,
    watch,
  }) => {
    await arrange(ws, 'refund [[reject]]');
    const { page } = await open(browser, state, watch);
    await openFaqs(page, ws, 'test');
    await ask(page, 'refund [[reject]]');
    const group = verifyGroup(page);
    await expect(group).toBeVisible();
    // The verdict is spelled out in words inside the labelled group, so a screen reader hears it.
    await expect(group).toContainText('Second check: no');
    await expect(group).toContainText('Checked by');
    await expect(group).toContainText('Reason');
    await expect(page.locator('img[onerror]')).toHaveCount(0);
  });
});

test.describe('a customer on the simulator', () => {
  let ws: Workspace;
  let state: State;
  let sim: Sim;
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    ({ ws, state } = await fresh(browser, 'scjourney'));
    sim = await simulator(ws);
  });

  const verdictOf = (from: string) =>
    sqlOne(
      `SELECT l.verify_verdict FROM faq_match_logs l JOIN conversations c ON c.org_id=l.org_id AND c.id=l.conversation_id
       WHERE l.org_id=${ws.orgId} AND c.peer_key='${from}'`,
    ) ?? '';
  const outcomeOf = (from: string) =>
    sqlOne(
      `SELECT l.outcome FROM faq_match_logs l JOIN conversations c ON c.org_id=l.org_id AND c.id=l.conversation_id
       WHERE l.org_id=${ws.orgId} AND c.peer_key='${from}'`,
    ) ?? '';

  test('a confirmed close call is answered and the log keeps the verdict', async () => {
    test.setTimeout(480_000);
    await arrange(ws, 'refund');
    const from = await customerAsks(ws, sim, 'refund', (f) => repliesTo(ws, f).length >= 1);
    expect(repliesTo(ws, from)).toEqual([ANSWER]);
    expect(outcomeOf(from)).toBe('answered');
    expect(verdictOf(from)).toBe('confirmed');
  });

  test('a close call the check vetoes sends nothing; Unanswered shows it with the reason and teaching works', async ({
    browser,
    watch,
  }) => {
    test.setTimeout(480_000);
    await arrange(ws, 'refund [[reject]]');
    const from = await customerAsks(ws, sim, 'refund [[reject]]');
    expect(outcomeOf(from)).toBe('below_threshold');
    expect(verdictOf(from)).toBe('rejected');
    await new Promise((r) => setTimeout(r, 1500));
    expect(repliesTo(ws, from)).toEqual([]);

    const { page } = await open(browser, state, watch);
    await openFaqs(page, ws, 'unanswered');
    const row = page
      .getByRole('list', { name: 'Unanswered messages' })
      .getByRole('listitem')
      .filter({ hasText: 'refund [[reject]]' });
    await expect(row).toBeVisible();
    await expect(row.getByText('Second check: no')).toBeVisible();
    await expect(row).toContainText('A different request from the FAQ.');
    await expect(row).toContainText(
      'above the 49% bar, but the second check said it does not answer the message',
    );
    await expect(row).toContainText(QUESTION);

    // The match log in Insights says "Answer withheld" for the same message.
    await openFaqs(page, ws, 'insights');
    const logRow = page.getByRole('row').filter({ hasText: 'refund [[reject]]' });
    await expect(logRow).toBeVisible();
    await expect(logRow.getByText('Answer withheld')).toBeVisible();

    // Teaching it: the message becomes a phrasing, and the next customer gets the answer with no check at all (an exact phrase).
    await openFaqs(page, ws, 'unanswered');
    await row.getByRole('button', { name: 'Add to an FAQ' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add this message to which FAQ?' });
    await dialog.getByRole('searchbox', { name: 'Search FAQs' }).fill('refund');
    await dialog.getByRole('button', { name: QUESTION }).click();
    await expect(
      page.getByText(`Added to "${QUESTION}". It will be answered from now on.`),
    ).toBeVisible();
    await expect(row).toHaveCount(0);
    const entry = (await call(ws, 'GET', `${faqBase(ws)}/entries?limit=10`)).body.data.find(
      (e: any) => e.question === QUESTION,
    );
    const full = (await call(ws, 'GET', `${faqBase(ws)}/entries/${entry.id}`)).body;
    expect(full.variations.find((v: any) => v.text === 'refund [[reject]]')?.source).toBe(
      'learned',
    );

    const again = await customerAsks(
      ws,
      sim,
      'refund [[reject]]',
      (f) => repliesTo(ws, f).length >= 1,
    );
    expect(repliesTo(ws, again)).toEqual([ANSWER]);
    expect(verdictOf(again)).toBe('');
    // The playground agrees: it is an exact phrase now.
    expect((await testQuery(ws, 'refund [[reject]]')).tier).toBe('exact');
  });

  test('a check that fails lets the customer have the answer', async () => {
    test.setTimeout(480_000);
    await arrange(ws, 'refund [[judge-fail]]');
    const from = await customerAsks(
      ws,
      sim,
      'refund [[judge-fail]]',
      (f) => repliesTo(ws, f).length >= 1,
    );
    expect(repliesTo(ws, from)).toEqual([ANSWER]);
    expect(outcomeOf(from)).toBe('answered');
    expect(verdictOf(from)).toBe('error');
  });

  test('outside the band, for an exact phrase, and with the check off the log carries no verdict', async () => {
    test.setTimeout(480_000);
    // Exact phrase with the bar right under 100%.
    await putSettings(ws, { threshold: 0.95, verifyMode: 'borderline', verifyBand: 0.1 });
    const exact = await customerAsks(ws, sim, 'refund policy', (f) => repliesTo(ws, f).length >= 1);
    expect(repliesTo(ws, exact)).toEqual([ANSWER]);
    expect(verdictOf(exact)).toBe('');
    // Off: a close call is answered unchecked.
    await arrange(ws, 'refund [[reject]] soon');
    await putSettings(ws, { verifyMode: 'off' });
    const off = await customerAsks(
      ws,
      sim,
      'refund [[reject]] soon',
      (f) => repliesTo(ws, f).length >= 1,
    );
    expect(repliesTo(ws, off)).toEqual([ANSWER]);
    expect(verdictOf(off)).toBe('');
  });

  test('with the platform check off a close call the judge would veto is answered, as "skipped", and the stats do not count it', async () => {
    test.setTimeout(480_000);
    await arrange(ws, 'refund [[reject]] now');
    const op = await operator();
    try {
      await op.patch({ verifyEnabled: false });
      await expect.poll(async () => (await getSettings(ws)).verifyAvailable).toBe(false);
      const stats = (await op.get()).stats;
      const from = await customerAsks(
        ws,
        sim,
        'refund [[reject]] now',
        (f) => repliesTo(ws, f).length >= 1,
      );
      expect(repliesTo(ws, from)).toEqual([ANSWER]);
      expect(outcomeOf(from)).toBe('answered');
      expect(verdictOf(from)).toBe('skipped');
      const after = (await op.get()).stats;
      expect(after.vetoed30d).toBe(stats.vetoed30d);
      expect(after.verified30d).toBe(stats.verified30d);
    } finally {
      await op.patch({ verifyEnabled: true });
      await op.dispose();
    }
  });
});

test.describe('looks and layout', () => {
  test('dark mode: the card and its sentence are readable', async ({ browser, watch }) => {
    const { ws, state } = await fresh(browser, 'scdark');
    await putSettings(ws, { verifyMode: 'borderline' });
    const { page } = await open(browser, state, watch, { colorScheme: 'dark', theme: 'dark' });
    await openFaqs(page, ws, 'settings');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(verifySwitch(page)).toBeChecked();
    await expect(sentence(page)).toBeVisible();
    const colours = await sentence(page).evaluate((el) => {
      const s = getComputedStyle(el);
      let bg = 'rgba(0, 0, 0, 0)';
      for (let n: Element | null = el; n; n = n.parentElement) {
        const b = getComputedStyle(n).backgroundColor;
        if (b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') {
          bg = b;
          break;
        }
      }
      return { fg: s.color, bg };
    });
    const lum = (c: string) => {
      const [r, g, b] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
    };
    expect(lum(colours.fg)).toBeGreaterThan(lum(colours.bg));
    await band(page).focus();
    await band(page).press('End');
    await expect(sentence(page)).toContainText('up to 80%');
  });

  test('right to left: the card mirrors, keeps its controls and works', async ({
    browser,
    watch,
  }) => {
    const { ws, state } = await fresh(browser, 'scrtl');
    const { page } = await open(browser, state, watch, { locale: 'ar' });
    await openFaqs(page, ws, 'settings');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const sw = page.locator('#faq-verify');
    const slider = page.locator('#faq-verify-band');
    await expect(sw).toBeVisible();
    await expect(slider).toBeVisible();
    await sw.click();
    await expect(sw).toBeChecked();
    // The sentence is translated and carries the numbers and the model name.
    await expect(sentence(page)).toContainText('50');
    await expect(sentence(page)).toContainText(MODEL);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await slider.focus();
    await slider.press('Home');
    await expect(slider).toHaveValue('0.01');
  });

  test('phone width: the card fits and its controls work by touch size', async ({
    browser,
    watch,
  }) => {
    const { ws, state } = await fresh(browser, 'scphone');
    const { page } = await open(browser, state, watch, { viewport: { width: 375, height: 800 } });
    await openFaqs(page, ws, 'settings');
    await verifySwitch(page).scrollIntoViewIfNeeded();
    await verifySwitch(page).click();
    await expect(verifySwitch(page)).toBeChecked();
    for (const control of [verifySwitch(page), band(page)]) {
      const box = await control.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(sentence(page)).toBeVisible();
  });

  test('keyboard only: Tab reaches the switch and the slider, Space and arrows change them', async ({
    browser,
    watch,
  }) => {
    const { ws, state } = await fresh(browser, 'sckeys');
    const { page } = await open(browser, state, watch);
    await openFaqs(page, ws, 'settings');
    await tabTo(page, verifySwitch(page), 80);
    await expect(verifySwitch(page)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(verifySwitch(page)).toBeChecked();
    await tabTo(page, band(page), 10);
    await expect(band(page)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(band(page)).toHaveAttribute('aria-valuetext', '+11%');
    // The sentence is a polite live region, so the change is announced.
    await expect(sentence(page)).toHaveAttribute('aria-live', 'polite');
    await expect(sentence(page)).toContainText('up to 61%');
  });
});
