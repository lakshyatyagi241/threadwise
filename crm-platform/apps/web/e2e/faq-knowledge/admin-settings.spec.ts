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

test.describe('settings form: dirty state and what is sent', () => {
  test('Save and Discard are disabled until something changes, and Discard puts the saved values back', async ({
    page,
  }) => {
    await openFaq(page);
    await expect(save(page)).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Discard changes' })).toBeDisabled();
    await expect(page.getByText('No changes to save.')).toBeVisible();
    await field.maxFaqs(page).fill('501');
    await expect(save(page)).toBeEnabled();
    await expect(page.getByText('1 change ready to save')).toBeVisible();
    await field.maxVars(page).fill('61');
    await expect(page.getByText('2 changes ready to save')).toBeVisible();
    await page.getByRole('button', { name: 'Discard changes' }).click();
    await expect(field.maxFaqs(page)).toHaveValue('500');
    await expect(field.maxVars(page)).toHaveValue('60');
    await expect(save(page)).toBeDisabled();
    // Typing the saved value back is not a change either.
    await field.maxFaqs(page).fill('501');
    await field.maxFaqs(page).fill('500');
    await expect(save(page)).toBeDisabled();
  });

  test('only the changed field is sent, the toast confirms and the value survives a reload', async ({
    page,
  }) => {
    const sent = patches(page);
    await openFaq(page);
    await field.maxFaqs(page).fill('501');
    expect(await saveAndCapture(page)).toEqual({ maxFaqs: 501 });
    await expect(page.getByText('Settings saved.')).toBeVisible();
    await expect(save(page)).toBeDisabled();
    await expect(field.maxFaqs(page)).toHaveValue('501');
    await page.reload();
    await openFaq(page);
    await expect(field.maxFaqs(page)).toHaveValue('501');
    expect(sent).toHaveLength(1);
  });

  test('two changed fields send exactly those two, all limits at their boundaries are accepted', async ({
    page,
  }) => {
    await openFaq(page);
    await field.maxVars(page).fill('500');
    await field.perHour(page).fill('0');
    expect(await saveAndCapture(page)).toEqual({ maxVariationsPerFaq: 500, semanticPerHour: 0 });
    await expect(page.getByText('Settings saved.')).toBeVisible();
    await field.maxFaqs(page).fill('20000');
    await field.maxVars(page).fill('1');
    await field.perHour(page).fill('100000');
    expect(await saveAndCapture(page)).toEqual({
      maxFaqs: 20000,
      maxVariationsPerFaq: 1,
      semanticPerHour: 100000,
    });
    await expect(page.getByText('Settings saved.').first()).toBeVisible();
    await expect(field.maxFaqs(page)).toHaveValue('20000');
  });

  test('Enter in a field submits the form, a second Enter while saving sends nothing more', async ({
    page,
  }) => {
    const sent = patches(page);
    await page.route('**/api/platform/faq', async (route) => {
      if (route.request().method() === 'PATCH') await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });
    await openFaq(page);
    await field.maxFaqs(page).fill('502');
    await field.maxFaqs(page).press('Enter');
    await field.maxFaqs(page).press('Enter');
    await expect(page.getByRole('button', { name: 'Saving' })).toBeDisabled();
    await expect(page.getByText('Settings saved.')).toBeVisible();
    expect(sent).toEqual([{ maxFaqs: 502 }]);
  });

  test('a double click on Save sends one request', async ({ page }) => {
    const sent = patches(page);
    await page.route('**/api/platform/faq', async (route) => {
      if (route.request().method() === 'PATCH') await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });
    await openFaq(page);
    await field.maxVars(page).fill('59');
    await save(page).dblclick();
    await expect(page.getByText('Settings saved.').first()).toBeVisible();
    await page.waitForTimeout(1500); // a second request, if any, would have been sent by now
    expect(sent).toEqual([{ maxVariationsPerFaq: 59 }]);
  });
});

test.describe('settings form: validation', () => {
  const cases: Array<{
    key: 'maxFaqs' | 'maxVars' | 'perHour';
    name: string;
    bad: Array<[string, string]>;
  }> = [
    {
      key: 'maxFaqs',
      name: 'Maximum FAQs per workspace',
      bad: [
        ['0', 'range'],
        ['-1', 'integer'],
        ['20001', 'range'],
        ['1.5', 'integer'],
        ['abc', 'integer'],
        ['', 'integer'],
        ['1e3', 'integer'],
      ],
    },
    {
      key: 'maxVars',
      name: 'Maximum variations per FAQ',
      bad: [
        ['0', 'range'],
        ['-5', 'integer'],
        ['501', 'range'],
        ['2.5', 'integer'],
        [' ', 'integer'],
      ],
    },
    {
      key: 'perHour',
      name: 'Semantic matches per workspace per hour',
      bad: [
        ['-1', 'integer'],
        ['100001', 'range'],
        ['0.5', 'integer'],
        ['ten', 'integer'],
      ],
    },
  ];
  const message = { integer: 'Enter a whole number.' } as const;
  const ranges = {
    maxFaqs: 'Enter a value between 1 and 20,000.',
    maxVars: 'Enter a value between 1 and 500.',
    perHour: 'Enter a value between 0 and 100,000.',
  };

  for (const c of cases) {
    test(`${c.name}: every bad value is refused with a message and nothing is sent`, async ({
      page,
    }) => {
      const sent = patches(page);
      await openFaq(page);
      for (const [value, kind] of c.bad) {
        await field[c.key](page).fill(value);
        // A blank-only value equals no saved value, so the form is dirty and Save shows the problem.
        await save(page).click();
        const expected = kind === 'integer' ? message.integer : ranges[c.key];
        await expect(
          page.getByRole('alert').filter({ hasText: expected }),
          `value "${value}"`,
        ).toBeVisible();
        await expect(field[c.key](page)).toHaveAttribute('aria-invalid', 'true');
      }
      expect(sent).toEqual([]);
      // Fixing the value clears the problem.
      await field[c.key](page).fill(
        c.key === 'perHour' ? '600' : c.key === 'maxFaqs' ? '500' : '60',
      );
      await expect(
        page.getByRole('alert').filter({ hasText: /Enter (a whole number|a value between)/ }),
      ).toHaveCount(0);
    });
  }

  test('a limit with spaces around a valid number is accepted and sent as a number', async ({
    page,
  }) => {
    await openFaq(page);
    await field.maxFaqs(page).fill('  503  ');
    expect(await saveAndCapture(page)).toEqual({ maxFaqs: 503 });
    await expect(page.getByText('Settings saved.')).toBeVisible();
  });

  test('generation model: spaces inside, too short and empty are refused; surrounding spaces are not a change', async ({
    page,
  }) => {
    const sent = patches(page);
    await openFaq(page);
    const msg = page
      .getByRole('alert')
      .filter({ hasText: 'Use an OpenRouter model id such as openai/gpt-4o-mini.' });
    for (const bad of [
      'open ai/gpt',
      'ab',
      '',
      '   ',
      'openai/gpt 4o',
      'model!name',
      'ünï/model',
    ]) {
      await field.generation(page).fill(bad);
      if (bad.trim() === '' || bad.trim().length < 3 || /[^A-Za-z0-9._:/-]/.test(bad.trim())) {
        await save(page).click();
        await expect(msg, `value "${bad}"`).toBeVisible();
        await expect(field.generation(page)).toHaveAttribute('aria-invalid', 'true');
      }
    }
    expect(sent).toEqual([]);
    await field.generation(page).fill('  openai/gpt-4o-mini  ');
    await expect(save(page)).toBeDisabled();
    await expect(msg).toHaveCount(0);
  });

  test('generation model: a valid OpenRouter slug is trimmed, sent alone and kept after reload', async ({
    page,
  }) => {
    await openFaq(page);
    await field.generation(page).fill('  anthropic/claude-3.5-haiku:beta  ');
    expect(await saveAndCapture(page)).toEqual({
      generationModel: 'anthropic/claude-3.5-haiku:beta',
    });
    await expect(page.getByText('Settings saved.')).toBeVisible();
    await page.reload();
    await openFaq(page);
    await expect(field.generation(page)).toHaveValue('anthropic/claude-3.5-haiku:beta');
  });

  test('a 121 character generation model is refused', async ({ page }) => {
    await openFaq(page);
    await field.generation(page).fill(`a/${'b'.repeat(119)}`);
    const typed = await field.generation(page).inputValue();
    // The input caps what can be typed at 120; if a longer value gets in, the form must refuse it.
    if (typed.length > 120) {
      await save(page).click();
      await expect(
        page.getByRole('alert').filter({ hasText: 'Use an OpenRouter model id' }),
      ).toBeVisible();
    } else {
      expect(typed.length).toBeLessThanOrEqual(120);
    }
  });
});
