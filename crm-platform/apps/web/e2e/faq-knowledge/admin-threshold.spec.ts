import { expect, test } from '@playwright/test';
import {
  DEFAULTS,
  LAUNCH,
  field,
  openFaq,
  operatorApi,
  patches,
  restoreConfig,
  save,
  saveAndCapture,
  signInOperator,
  sw,
  watch,
} from './admin-support';

test.use({ launchOptions: LAUNCH });
test.setTimeout(240_000);

test.beforeEach(async ({ page }) => {
  await signInOperator(page);
});
test.afterEach(async () => {
  await restoreConfig();
});

test.describe('settings form: default threshold', () => {
  test('keyboard: arrows, Home, End and PageUp move the slider and the shown value, and the saved number is sent', async ({
    page,
  }) => {
    await openFaq(page);
    const slider = field.slider(page);
    await expect(slider).toBeDisabled();
    await expect(field.follow(page)).toBeChecked();
    await field.follow(page).uncheck();
    await expect(slider).toBeEnabled();
    await expect(slider).toHaveValue('0.5');
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await expect(slider).toHaveValue('0.51');
    await expect(page.getByRole('status').filter({ hasText: '0.51' })).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(slider).toHaveValue('0.49');
    await page.keyboard.press('Home');
    await expect(slider).toHaveValue('0.05');
    await page.keyboard.press('End');
    await expect(slider).toHaveValue('0.99');
    await page.keyboard.press('ArrowUp');
    await expect(slider).toHaveValue('0.99');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await expect(slider).toHaveValue('0.05');
    for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowRight');
    await expect(slider).toHaveValue('0.3');
    expect(await saveAndCapture(page)).toEqual({ defaultThreshold: 0.3 });
    await expect(page.getByText('Settings saved.')).toBeVisible();
    expect((await (await operatorApi()).overview()).config).toMatchObject({
      defaultThreshold: 0.3,
      defaultThresholdCustom: true,
    });
    await page.reload();
    await openFaq(page);
    await expect(field.follow(page)).not.toBeChecked();
    await expect(slider).toHaveValue('0.3');
    await expect(slider).toBeEnabled();
  });

  test('"follow the model" on sends null, off sends the number, and it shows the recommended value', async ({
    page,
  }) => {
    const op = await operatorApi();
    try {
      await op.setConfig({ defaultThreshold: 0.8 });
      await openFaq(page);
      await expect(field.follow(page)).not.toBeChecked();
      await expect(field.slider(page)).toHaveValue('0.8');
      await expect(
        page.getByText("The default sensitivity is the model's recommended value (0.50)"),
      ).toBeVisible();
      await field.follow(page).check();
      // The slider now shows the model's recommended number and cannot be moved.
      await expect(field.slider(page)).toHaveValue('0.5');
      await expect(field.slider(page)).toBeDisabled();
      await expect(page.getByRole('status').filter({ hasText: '0.50' })).toBeVisible();
      expect(await saveAndCapture(page)).toEqual({ defaultThreshold: null });
      await expect(page.getByText('Settings saved.')).toBeVisible();
      const { config } = await op.overview();
      expect(config).toMatchObject({ defaultThreshold: 0.5, defaultThresholdCustom: false });
      // Off again without moving the slider fixes the number it shows.
      await field.follow(page).uncheck();
      expect(await saveAndCapture(page)).toEqual({ defaultThreshold: 0.5 });
      await expect(page.getByText('Settings saved.').first()).toBeVisible();
    } finally {
      await op.dispose();
    }
  });

  test('unticking and re-ticking "follow the model" is not a change', async ({ page }) => {
    await openFaq(page);
    await field.follow(page).uncheck();
    await expect(save(page)).toBeEnabled();
    await field.follow(page).check();
    await expect(save(page)).toBeDisabled();
  });
});

test.describe('settings form: stale form and server answers', () => {
  test('a change made elsewhere in between is not overwritten by saving a different field', async ({
    page,
  }) => {
    const op = await operatorApi();
    try {
      await openFaq(page);
      await op.setConfig({ maxVariationsPerFaq: 61, semanticPerHour: 601 });
      await field.maxFaqs(page).fill('504');
      expect(await saveAndCapture(page)).toEqual({ maxFaqs: 504 });
      await expect(page.getByText('Settings saved.')).toBeVisible();
      const { config } = await op.overview();
      expect(config).toMatchObject({ maxFaqs: 504, maxVariationsPerFaq: 61, semanticPerHour: 601 });
      // The form shows what the server answered, not the stale draft.
      await expect(field.maxVars(page)).toHaveValue('61');
      await expect(field.perHour(page)).toHaveValue('601');
    } finally {
      await op.dispose();
    }
  });

  test('a limit the operator edits is sent even when the server value changed meanwhile (the edit is intended)', async ({
    page,
  }) => {
    const op = await operatorApi();
    try {
      await openFaq(page);
      await field.maxVars(page).fill('70');
      await op.setConfig({ maxVariationsPerFaq: 61 });
      expect(await saveAndCapture(page)).toEqual({ maxVariationsPerFaq: 70 });
      await expect(field.maxVars(page)).toHaveValue('70');
      expect((await op.overview()).config.maxVariationsPerFaq).toBe(70);
    } finally {
      await op.dispose();
    }
  });

  test('a server validation answer is shown on the field and nothing is lost', async ({ page }) => {
    await page.route('**/api/platform/faq', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      await route.fulfill({
        status: 422,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'https://errors.crm.platform/validation_failed',
          title: 'Unprocessable Entity',
          status: 422,
          code: 'VALIDATION_FAILED',
          detail: 'Request payload failed validation',
          errors: [{ path: 'maxFaqs', message: 'Too big' }],
        }),
      });
    });
    await openFaq(page);
    await field.maxFaqs(page).fill('505');
    await save(page).click();
    await expect(
      page.getByText('Some values are not valid. Check the highlighted fields.'),
    ).toBeVisible();
    await expect(
      page.getByRole('alert').filter({ hasText: 'This value is not valid.' }),
    ).toBeVisible();
    await expect(field.maxFaqs(page)).toHaveValue('505');
    await expect(save(page)).toBeEnabled();
    // Editing the field clears the server's complaint about it.
    await field.maxFaqs(page).fill('506');
    await expect(
      page.getByRole('alert').filter({ hasText: 'This value is not valid.' }),
    ).toHaveCount(0);
  });

  test('a server error shows a calm message and keeps the form editable', async ({ page }) => {
    await page.route('**/api/platform/faq', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      await route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'https://errors.crm.platform/internal',
          title: 'Internal',
          status: 500,
          code: 'INTERNAL_ERROR',
        }),
      });
    });
    await openFaq(page);
    await field.maxFaqs(page).fill('507');
    await save(page).click();
    await expect(
      page.getByText('Something went wrong on our side. Try again in a moment.'),
    ).toBeVisible();
    await expect(field.maxFaqs(page)).toHaveValue('507');
    await expect(save(page)).toBeEnabled();
  });

  test('a rejected embedding model shows the dedicated message', async ({ page }) => {
    await page.route('**/api/platform/faq', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      await route.fulfill({
        status: 422,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'https://errors.crm.platform/faq_model_not_allowed',
          title: 'x',
          status: 422,
          code: 'FAQ_MODEL_NOT_ALLOWED',
        }),
      });
    });
    await openFaq(page);
    await field.maxFaqs(page).fill('508');
    await save(page).click();
    await expect(page.getByText('That embedding model is not on the allowed list.')).toBeVisible();
  });

  test('the page itself raises no console problem while the form is used', async ({ page }) => {
    const w = watch(page);
    await openFaq(page);
    await field.maxFaqs(page).fill('509');
    await saveAndCapture(page);
    await expect(page.getByText('Settings saved.')).toBeVisible();
    await expect(sw(page)).toBeChecked();
    expect(w.consoleIssues).toEqual([]);
    expect(w.failures).toEqual([]);
    expect(DEFAULTS.maxFaqs).toBe(500);
  });
});
