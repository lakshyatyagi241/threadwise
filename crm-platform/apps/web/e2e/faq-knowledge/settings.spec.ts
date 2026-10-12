import {
  call,
  expect,
  faqBase,
  getSettings,
  login,
  newWorkspace,
  open,
  openFaqs,
  operator,
  putSettings,
  reloadFaqs,
  seedFaq,
  type State,
  test,
  waitIndexed,
  waitReindexed,
  type Workspace,
} from './support';
import type { Page } from '@playwright/test';

/** A flow's FAQ settings (`?tab=faqs&view=settings`): the switch, sensitivity, ambiguity guard and logging, versioned saves, and the facts beside them. */
const answerSwitch = (page: Page) =>
  page.getByRole('switch', { name: "Answer customers with this flow's FAQs" });
const keepSwitch = (page: Page) =>
  page.getByRole('switch', { name: 'Keep customer messages in the match log' });
const sens = (page: Page) =>
  page.getByRole('slider', { name: 'Answer when the match is at least' });
const margin = (page: Page) =>
  page.getByRole('slider', { name: 'Minimum lead over the second best' });
const save = (page: Page) => page.getByRole('button', { name: 'Save settings' });
const discard = (page: Page) => page.getByRole('button', { name: 'Discard' });

async function fresh(browser: import('@playwright/test').Browser, label: string, saved = false) {
  const ws = await newWorkspace(label);
  const state = await login(browser, ws.email);
  // A first save makes the row the later saves lock against.
  if (saved) await putSettings(ws, {});
  return { ws, state };
}

test('the answering switch: save is off until something changes, Discard undoes, and the choice survives a reload', async ({
  browser,
  watch,
}) => {
  const { ws, state } = await fresh(browser, 'setswitch');
  const { page } = await open(browser, state, watch);
  await openFaqs(page, ws, 'settings');
  await expect(answerSwitch(page)).not.toBeChecked();
  await expect(save(page)).toBeDisabled();
  await expect(discard(page)).toBeDisabled();
  await expect(page.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  // The settings screen does not repeat the state banner.
  await expect(page.getByText('FAQ answering is OFF for this flow')).toHaveCount(0);

  await answerSwitch(page).click();
  await expect(answerSwitch(page)).toBeChecked();
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await expect(save(page)).toBeEnabled();
  await discard(page).click();
  await expect(answerSwitch(page)).not.toBeChecked();
  await expect(save(page)).toBeDisabled();
  expect((await getSettings(ws)).enabled).toBe(false);

  await answerSwitch(page).click();
  await save(page).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await expect(save(page)).toBeDisabled();
  await expect.poll(async () => (await getSettings(ws)).enabled).toBe(true);
  await reloadFaqs(page);
  await expect(answerSwitch(page)).toBeChecked();
  await expect(page.getByText('On', { exact: true })).toBeVisible();

  // Back off again: a later save uses the version it read, no conflict.
  await answerSwitch(page).click();
  await save(page).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await expect.poll(async () => (await getSettings(ws)).enabled).toBe(false);
});

test('the sensitivity slider works by keyboard and presets, and a preset names its number', async ({
  browser,
  watch,
}) => {
  const { ws, state } = await fresh(browser, 'setsens');
  const { page } = await open(browser, state, watch);
  await openFaqs(page, ws, 'settings');
  const slider = sens(page);
  await expect(slider).toBeVisible();
  const rec = Math.round((await getSettings(ws)).recommendedThreshold * 100);
  await expect(slider).toHaveAttribute('aria-valuetext', `${rec}%`);
  await expect(page.getByRole('button', { name: /^Balanced/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await slider.focus();
  await slider.press('Home');
  await expect(slider).toHaveAttribute('aria-valuetext', '5%');
  await slider.press('End');
  await expect(slider).toHaveAttribute('aria-valuetext', '99%');
  await slider.press('ArrowLeft');
  await expect(slider).toHaveAttribute('aria-valuetext', '98%');
  await slider.press('Home');
  for (let i = 0; i < 5; i++) await slider.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext', '10%');
  await expect(page.getByText(/At 10%, a message is answered only when/)).toBeVisible();
  for (const name of ['Strict', 'Balanced', 'Forgiving']) {
    await expect(page.getByRole('button', { name: new RegExp(`^${name}`) })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  }

  // Presets: each button carries its percentage and moves the slider there.
  for (const name of ['Strict', 'Forgiving', 'Balanced']) {
    const button = page.getByRole('button', { name: new RegExp(`^${name} \\(\\d+%\\)$`) });
    const n = Number(/\((\d+)%\)/.exec((await button.textContent())!)![1]);
    await button.click();
    await expect(slider).toHaveAttribute('aria-valuetext', `${n}%`);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  // Away from the recommended value a shortcut back appears; at it, it does not.
  await expect(page.getByRole('button', { name: /^Use the recommended value/ })).toHaveCount(0);
  await slider.focus();
  await slider.press('ArrowRight');
  await slider.press('ArrowRight');
  await page.getByRole('button', { name: `Use the recommended value (${rec}%)` }).click();
  await expect(slider).toHaveAttribute('aria-valuetext', `${rec}%`);

  await page.getByRole('button', { name: /^Strict/ }).click();
  const strict = Number(
    /\((\d+)%\)/.exec((await page.getByRole('button', { name: /^Strict/ }).textContent())!)![1],
  );
  await save(page).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await expect.poll(async () => Math.round((await getSettings(ws)).threshold * 100)).toBe(strict);
  await reloadFaqs(page);
  await expect(sens(page)).toHaveAttribute('aria-valuetext', `${strict}%`);
});

test('the minimum lead and the log switch are saved', async ({ browser, watch }) => {
  const { ws, state } = await fresh(browser, 'setmargin');
  const { page } = await open(browser, state, watch);
  await openFaqs(page, ws, 'settings');
  await expect(margin(page)).toHaveAttribute('aria-valuetext', 'Off');
  await margin(page).focus();
  for (let i = 0; i < 10; i++) await margin(page).press('ArrowRight');
  await expect(margin(page)).toHaveAttribute('aria-valuetext', '10%');
  await margin(page).press('End');
  await expect(margin(page)).toHaveAttribute('aria-valuetext', '50%');
  await margin(page).press('ArrowRight');
  await expect(margin(page)).toHaveAttribute('aria-valuetext', '50%');
  await margin(page).press('Home');
  await expect(margin(page)).toHaveAttribute('aria-valuetext', 'Off');
  for (let i = 0; i < 15; i++) await margin(page).press('ArrowRight');

  await expect(keepSwitch(page)).toBeChecked();
  await expect(page.getByText(/The text of each message is kept for 90 days/)).toBeVisible();
  await keepSwitch(page).click();
  await expect(page.getByText(/Only scores and outcomes are kept, never the text\./)).toBeVisible();
  await save(page).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await expect.poll(async () => (await getSettings(ws)).minMargin).toBe(0.15);
  expect((await getSettings(ws)).logQueries).toBe(false);
  await reloadFaqs(page);
  await expect(margin(page)).toHaveAttribute('aria-valuetext', '15%');
  await expect(keepSwitch(page)).not.toBeChecked();
});

test('two people saving: the second sees the conflict and reloads the other version', async ({
  browser,
  watch,
}) => {
  watch.allow(/409/);
  const { ws, state } = await fresh(browser, 'setconflict', true);
  const one = await open(browser, state, watch);
  const two = await open(browser, state, watch);
  await openFaqs(one.page, ws, 'settings');
  await openFaqs(two.page, ws, 'settings');

  await answerSwitch(one.page).click();
  await save(one.page).click();
  await expect(one.page.getByText('Settings saved.')).toBeVisible();

  await keepSwitch(two.page).click();
  await save(two.page).click();
  await expect(
    two.page.getByText(
      'Someone else saved these settings. Reload to see their version, then make your change again.',
    ),
  ).toBeVisible();
  // Nothing of the second person's was saved over the first's.
  const now = await getSettings(ws);
  expect(now).toMatchObject({ enabled: true, logQueries: true });

  await two.page.getByRole('button', { name: 'Reload settings' }).click();
  await expect(answerSwitch(two.page)).toBeChecked();
  await expect(keepSwitch(two.page)).toBeChecked();
  await expect(two.page.getByText('Someone else saved these settings.')).toHaveCount(0);
  await expect(save(two.page)).toBeDisabled();
  await keepSwitch(two.page).click();
  await save(two.page).click();
  await expect(two.page.getByText('Settings saved.')).toBeVisible();
  expect(await getSettings(ws)).toMatchObject({ enabled: true, logQueries: false });
});

test('limits and usage describe the flow', async ({ browser, watch }) => {
  const { ws, state } = await fresh(browser, 'setfacts');
  await seedFaq(ws, { question: 'Fact one', variations: ['fact uno', 'fact eins'] });
  await seedFaq(ws, { question: 'Fact two', variations: ['fact dos'] });
  const s = await getSettings(ws);
  expect(s.usage).toEqual({ faqs: 2, variations: 5 });
  const { page } = await open(browser, state, watch);
  await openFaqs(page, ws, 'settings');
  const facts = page.getByRole('region', { name: 'Model and limits' });
  await expect(facts).toContainText(s.embeddingModel);
  await expect(facts.getByText(`2 of ${s.limits.maxFaqs}`)).toBeVisible();
  await expect(
    facts.locator('dt', { hasText: 'Phrasings in use' }).locator('xpath=following-sibling::dd[1]'),
  ).toHaveText('5');
  await expect(
    facts
      .locator('dt', { hasText: 'Phrasings allowed per FAQ' })
      .locator('xpath=following-sibling::dd[1]'),
  ).toHaveText(String(s.limits.maxVariationsPerFaq));
  await expect(page.getByRole('region', { name: 'How matching works' })).toContainText('Exact:');
  await waitIndexed(ws);
});

test.describe('platform changes', () => {
  test('a changed embedding model shows the review banner until the settings are saved', async ({
    browser,
    watch,
  }) => {
    test.setTimeout(600_000);
    const { ws, state } = await fresh(browser, 'setmodel', true);
    await seedFaq(ws, { question: 'Model FAQ', answerText: 'M.', variations: ['model faq two'] });
    await waitIndexed(ws);
    const before = await getSettings(ws);
    expect(before.modelChanged).toBe(false);

    const op = await operator();
    const original = (await op.get()).config.embeddingModel as string;
    try {
      const next = (await op.get()).config.allowedModels.find((m: any) => m.id !== original)!;
      await op.patch({ embeddingModel: next.id });
      const after = await getSettings(ws);
      expect(after.modelChanged).toBe(true);
      expect(after.embeddingModel).toBe(next.id);
      expect(after.recommendedThreshold).toBe(next.recommendedThreshold);

      const { page } = await open(browser, state, watch);
      // The banner is on every FAQ screen except settings, and links to it.
      await openFaqs(page, ws);
      await expect(
        page.getByText('The platform changed the AI model after you tuned this threshold.'),
      ).toBeVisible();
      await page.getByRole('link', { name: 'Review sensitivity' }).click();
      await expect(page).toHaveURL(/[?&]view=settings$/);
      await expect(page.getByText('Review your sensitivity', { exact: true })).toBeVisible();
      await expect(page.getByText(`Scores belong to the model ${next.id}.`)).toBeVisible();
      await expect(
        page.getByText(`recommended ${Math.round(next.recommendedThreshold * 100)}%`),
      ).toBeVisible();

      // Accepting the new recommended value and saving clears the notice everywhere.
      const useRec = page.getByRole('button', {
        name: `Use the recommended value (${Math.round(next.recommendedThreshold * 100)}%)`,
      });
      if (await useRec.count()) await useRec.click();
      else {
        // The old value already equals the new recommendation: nudge, then come back so there is something to save.
        await answerToggle(page);
      }
      await save(page).click();
      await expect(page.getByText('Settings saved.')).toBeVisible();
      await expect(page.getByText('Review your sensitivity', { exact: true })).toHaveCount(0);
      expect((await getSettings(ws)).modelChanged).toBe(false);
      await openFaqs(page, ws);
      await expect(
        page.getByText('The platform changed the AI model after you tuned this threshold.'),
      ).toHaveCount(0);
    } finally {
      await op.patch({ embeddingModel: original });
      await waitReindexed(op);
      await op.dispose();
    }
  });

  test('platform limits are shown: a full flow cannot add FAQs and a full FAQ cannot add phrasings', async ({
    browser,
    watch,
  }) => {
    test.setTimeout(120_000);
    const { ws, state } = await fresh(browser, 'setlimits', true);
    const faq = await seedFaq(ws, {
      question: 'Limit one',
      answerText: 'L1.',
      variations: ['limit uno'],
    });
    await seedFaq(ws, { question: 'Limit two', answerText: 'L2.' });
    const op = await operator();
    const was = (await op.get()).config;
    try {
      await op.patch({ maxFaqs: 2, maxVariationsPerFaq: 3 });
      const { page } = await open(browser, state, watch);
      await openFaqs(page, ws, 'new');
      await expect(
        page.getByText('This flow is at its limit of 2 FAQs. Delete one to add another.'),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create FAQ' })).toBeDisabled();

      await openFaqs(page, ws, faq.id);
      await expect(page.getByLabel('2 of 3 phrasings used')).toBeVisible();
      await page.getByRole('textbox', { name: 'New phrasing' }).fill('limit three');
      await page.getByRole('textbox', { name: 'New phrasing' }).press('Enter');
      await expect(page.getByLabel('3 of 3 phrasings used')).toBeVisible();
      await expect(page.getByText('This FAQ is at its limit of 3 phrasings.')).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'New phrasing' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Suggest with AI' })).toBeDisabled();

      await openFaqs(page, ws, 'settings');
      await expect(page.getByText('2 of 2')).toBeVisible();
      await expect(
        page
          .getByRole('region', { name: 'Model and limits' })
          .locator('dt', { hasText: 'Phrasings allowed per FAQ' })
          .locator('xpath=following-sibling::dd[1]'),
      ).toHaveText('3');
    } finally {
      await op.patch({ maxFaqs: was.maxFaqs, maxVariationsPerFaq: was.maxVariationsPerFaq });
      await op.dispose();
    }
  });

  test('when the platform switches the engine off, every screen says so and edits are refused', async ({
    browser,
    watch,
  }) => {
    watch.allow(/422/);
    test.setTimeout(120_000);
    const { ws, state } = await fresh(browser, 'setengine', true);
    const op = await operator();
    try {
      await op.patch({ engineEnabled: false });
      const { page } = await open(browser, state, watch);
      await openFaqs(page, ws);
      await expect(
        page.getByText(/FAQ answering has been switched off by the platform/),
      ).toBeVisible();
      await openFaqs(page, ws, 'settings');
      await expect(
        page.getByText(
          /FAQ answering is switched off by the platform\. Whatever you set here applies once it is back on\./,
        ),
      ).toBeVisible();
      await openFaqs(page, ws, 'new');
      await page.getByRole('textbox', { name: 'Question', exact: true }).fill('Blocked while off');
      await page.getByLabel('Answer text').fill('Blocked.');
      await page.getByRole('button', { name: 'Create FAQ' }).click();
      await expect(
        page.getByText('FAQ answering is switched off for the whole platform right now.'),
      ).toBeVisible();
      await expect(page).toHaveURL(/[?&]view=new$/);
      expect((await call(ws, 'GET', `${faqBase(ws)}/entries`)).body.data).toHaveLength(0);
    } finally {
      await op.patch({ engineEnabled: true });
      await op.dispose();
    }
  });
});

async function answerToggle(page: Page) {
  await answerSwitch(page).click();
  await answerSwitch(page).click();
  await page.getByRole('button', { name: /^Strict/ }).click();
}
