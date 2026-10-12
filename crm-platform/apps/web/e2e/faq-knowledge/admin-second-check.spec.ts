import { expect, test } from '@playwright/test';
import {
  DEFAULTS,
  LAUNCH,
  SUPER,
  SUPPORT,
  field,
  openFaq,
  operatorApi,
  patches,
  restoreConfig,
  save,
  saveAndCapture,
  signInOperator,
  statNum,
  watch,
} from './admin-support';
import {
  call,
  closeCall,
  faqBase,
  getSettings,
  newWorkspace,
  putSettings,
  seedFaq,
  waitIndexed,
} from './support';

/**
 * `/admin/faq`, the "Second check for close calls" part of the operator's settings: the platform switch, the model that judges and the
 * hourly cap per workspace, plus the two numbers it adds to the status strip. Global config is changed here, so every test puts it
 * back in `afterEach`.
 */
test.use({ launchOptions: LAUNCH });
test.setTimeout(240_000);

test.beforeEach(async ({ page }) => {
  await signInOperator(page);
});
test.afterEach(async () => {
  await restoreConfig();
});

const legend = (page: import('@playwright/test').Page) =>
  page.getByRole('group', { name: 'Second check for close calls' });
const modelProblem = (page: import('@playwright/test').Page) =>
  page
    .getByRole('alert')
    .filter({ hasText: 'Use an OpenRouter model id such as openai/gpt-4o-mini.' });

test.describe('the fields', () => {
  test('show the saved config, and Save and Discard wait for a change', async ({ page }) => {
    const w = watch(page);
    await openFaq(page);
    await expect(legend(page)).toBeVisible();
    await expect(
      legend(page).getByText(/double-checks matches that only just reached a flow's bar/),
    ).toBeVisible();
    await expect(field.verifySwitch(page)).toBeChecked();
    await expect(field.verifyModel(page)).toHaveValue(DEFAULTS.verifyModel);
    await expect(field.verifyPerHour(page)).toHaveValue(String(DEFAULTS.verifyPerHour));
    await expect(
      legend(page).getByText(
        'Past this, a close call stands unchecked for the rest of the hour. 0 means never check.',
      ),
    ).toBeVisible();
    await expect(save(page)).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Discard changes' })).toBeDisabled();
    await expect(page.getByText('No changes to save.')).toBeVisible();
    // The API holds the same three values.
    const config = (await (await operatorApi()).overview()).config;
    expect(config).toMatchObject({
      verifyEnabled: true,
      verifyModel: DEFAULTS.verifyModel,
      verifyPerHour: DEFAULTS.verifyPerHour,
    });
    expect(w.consoleIssues).toEqual([]);
    expect(w.failures).toEqual([]);
  });

  test('every change is counted, Discard puts the saved values back, and typing the saved value again is no change', async ({
    page,
  }) => {
    await openFaq(page);
    await field.verifySwitch(page).click();
    await expect(page.getByText('1 change ready to save')).toBeVisible();
    await field.verifyModel(page).fill('anthropic/claude-3.5-haiku');
    await field.verifyPerHour(page).fill('25');
    await expect(page.getByText('3 changes ready to save')).toBeVisible();
    await expect(save(page)).toBeEnabled();
    await page.getByRole('button', { name: 'Discard changes' }).click();
    await expect(field.verifySwitch(page)).toBeChecked();
    await expect(field.verifyModel(page)).toHaveValue(DEFAULTS.verifyModel);
    await expect(field.verifyPerHour(page)).toHaveValue('300');
    await expect(save(page)).toBeDisabled();

    // Away and back is not a change; spaces around the model id are not either.
    await field.verifyPerHour(page).fill('301');
    await field.verifyPerHour(page).fill('300');
    await expect(save(page)).toBeDisabled();
    await field.verifyModel(page).fill(`  ${DEFAULTS.verifyModel}  `);
    await expect(save(page)).toBeDisabled();
    await field.verifySwitch(page).click();
    await field.verifySwitch(page).click();
    await expect(save(page)).toBeDisabled();
  });
});

test.describe('validation', () => {
  test('a bad model id is refused with a message and nothing is sent', async ({ page }) => {
    const sent = patches(page);
    await openFaq(page);
    for (const bad of ['open ai/gpt', 'ab', '', '   ', 'model!name', 'ünï/model', 'a/b c']) {
      await field.verifyModel(page).fill(bad);
      await save(page).click();
      await expect(modelProblem(page), `value "${bad}"`).toBeVisible();
      await expect(field.verifyModel(page)).toHaveAttribute('aria-invalid', 'true');
    }
    expect(sent).toEqual([]);
    // Fixing it clears the message and Save goes through.
    await field.verifyModel(page).fill('google/gemini-2.0-flash-001');
    await expect(modelProblem(page)).toHaveCount(0);
    expect(await saveAndCapture(page)).toEqual({ verifyModel: 'google/gemini-2.0-flash-001' });
    await expect(page.getByText('Settings saved.')).toBeVisible();
  });

  test('a longer model id than 120 characters cannot be typed in', async ({ page }) => {
    const sent = patches(page);
    await openFaq(page);
    await field.verifyModel(page).fill(`a/${'b'.repeat(130)}`);
    expect((await field.verifyModel(page).inputValue()).length).toBeLessThanOrEqual(120);
    expect(sent).toEqual([]);
  });

  const bad: Array<[string, 'integer' | 'range']> = [
    ['-1', 'integer'],
    ['1.5', 'integer'],
    ['abc', 'integer'],
    ['', 'integer'],
    ['1e3', 'integer'],
    ['100001', 'range'],
    ['99999999999', 'range'],
  ];
  test('the hourly cap: negative, fractional, empty and huge values are refused with a message', async ({
    page,
  }) => {
    const sent = patches(page);
    await openFaq(page);
    for (const [value, kind] of bad) {
      await field.verifyPerHour(page).fill(value);
      await save(page).click();
      await expect(
        page.getByRole('alert').filter({
          hasText:
            kind === 'integer' ? 'Enter a whole number.' : 'Enter a value between 0 and 100,000.',
        }),
        `value "${value}"`,
      ).toBeVisible();
      await expect(field.verifyPerHour(page)).toHaveAttribute('aria-invalid', 'true');
    }
    expect(sent).toEqual([]);
    await field.verifyPerHour(page).fill('300');
    await expect(
      page.getByRole('alert').filter({ hasText: /Enter (a whole number|a value between)/ }),
    ).toHaveCount(0);
  });

  test('the hourly cap accepts both ends: 0 (never check) and 100,000', async ({ page }) => {
    await openFaq(page);
    await field.verifyPerHour(page).fill('0');
    expect(await saveAndCapture(page)).toEqual({ verifyPerHour: 0 });
    await expect(page.getByText('Settings saved.')).toBeVisible();
    await expect(save(page)).toBeDisabled();
    await field.verifyPerHour(page).fill('100000');
    expect(await saveAndCapture(page)).toEqual({ verifyPerHour: 100000 });
    await expect(save(page)).toBeDisabled();
    await expect(field.verifyPerHour(page)).toHaveValue('100000');
    await field.verifyPerHour(page).fill('  42  ');
    expect(await saveAndCapture(page)).toEqual({ verifyPerHour: 42 });
    await expect(field.verifyPerHour(page)).toHaveValue('42');
  });

  test('the API refuses the same values and changes nothing', async () => {
    const op = await operatorApi();
    try {
      const before = (await op.overview()).config;
      for (const body of [
        { verifyModel: 'bad model' },
        { verifyModel: 'ab' },
        { verifyModel: 'a'.repeat(121) },
        { verifyPerHour: -1 },
        { verifyPerHour: 100001 },
        { verifyPerHour: 1.5 },
        { verifyPerHour: '5' },
        { verifyEnabled: 'yes' },
      ]) {
        const r = await op.patch('/faq', body);
        expect(r.status, JSON.stringify(body)).toBe(422);
      }
      const after = (await op.overview()).config;
      expect(after).toEqual(before);
    } finally {
      await op.dispose();
    }
  });
});

test.describe('saving', () => {
  test('only the changed fields are sent; the toast confirms; a reload and the API agree', async ({
    page,
  }) => {
    const sent = patches(page);
    await openFaq(page);
    await field.verifySwitch(page).click();
    await field.verifyModel(page).fill('  anthropic/claude-3.5-haiku:beta  ');
    await field.verifyPerHour(page).fill('25');
    expect(await saveAndCapture(page)).toEqual({
      verifyEnabled: false,
      verifyModel: 'anthropic/claude-3.5-haiku:beta',
      verifyPerHour: 25,
    });
    await expect(page.getByText('Settings saved.')).toBeVisible();
    await expect(save(page)).toBeDisabled();
    await page.reload();
    await openFaq(page);
    await expect(field.verifySwitch(page)).not.toBeChecked();
    await expect(field.verifyModel(page)).toHaveValue('anthropic/claude-3.5-haiku:beta');
    await expect(field.verifyPerHour(page)).toHaveValue('25');
    const op = await operatorApi();
    try {
      const config = (await op.overview()).config;
      expect(config).toMatchObject({
        verifyEnabled: false,
        verifyModel: 'anthropic/claude-3.5-haiku:beta',
        verifyPerHour: 25,
      });
      // The engine switch and the other limits were left alone.
      expect(config).toMatchObject({
        engineEnabled: DEFAULTS.engineEnabled,
        maxFaqs: DEFAULTS.maxFaqs,
        semanticPerHour: DEFAULTS.semanticPerHour,
      });
    } finally {
      await op.dispose();
    }
    expect(sent).toHaveLength(1);
  });

  test('Enter in the model field submits, and a double click on Save sends one request', async ({
    page,
  }) => {
    const sent = patches(page);
    await page.route('**/api/platform/faq', async (route) => {
      if (route.request().method() === 'PATCH') await new Promise((r) => setTimeout(r, 1000));
      await route.continue();
    });
    await openFaq(page);
    await field.verifyModel(page).fill('openai/gpt-4.1-mini');
    await field.verifyModel(page).press('Enter');
    await field.verifyModel(page).press('Enter');
    await expect(page.getByText('Settings saved.')).toBeVisible();
    await field.verifyPerHour(page).fill('77');
    await save(page).dblclick();
    await expect(page.getByText('Settings saved.').first()).toBeVisible();
    await page.waitForTimeout(1300); // a second request, if any, would have been sent by now
    expect(sent).toEqual([{ verifyModel: 'openai/gpt-4.1-mini' }, { verifyPerHour: 77 }]);
  });

  test('a rejected save keeps what was typed and says so', async ({ page }) => {
    await page.route('**/api/platform/faq', async (route) => {
      if (route.request().method() === 'PATCH')
        return route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({
            type: 'about:blank',
            title: 'Unprocessable',
            status: 422,
            detail: 'no',
            code: 'VALIDATION_FAILED',
            errors: [{ path: 'verifyModel', message: 'Not allowed.' }],
          }),
        });
      return route.continue();
    });
    await openFaq(page);
    await field.verifyModel(page).fill('vendor/some-model');
    await save(page).click();
    await expect(field.verifyModel(page)).toHaveValue('vendor/some-model');
    await expect(save(page)).toBeEnabled();
    await expect(page.getByText('Settings saved.')).toHaveCount(0);
    await expect(
      page.getByText('Some values are not valid. Check the highlighted fields.'),
    ).toBeVisible();
  });
});

test.describe('what it does to workspaces', () => {
  test('switching the check off for the platform shows in a workspace at once, and so does the model', async ({
    page,
  }) => {
    const ws = await newWorkspace('admsc');
    await putSettings(ws, { verifyMode: 'borderline' });
    expect(await getSettings(ws)).toMatchObject({
      verifyAvailable: true,
      verifyModel: DEFAULTS.verifyModel,
      verifyMode: 'borderline',
    });
    await openFaq(page);
    await field.verifySwitch(page).click();
    await save(page).click();
    await expect(page.getByText('Settings saved.')).toBeVisible();
    await expect(save(page)).toBeDisabled();
    await expect.poll(async () => (await getSettings(ws)).verifyAvailable).toBe(false);
    // The workspace's own choice is kept, only its effect is gone.
    expect((await getSettings(ws)).verifyMode).toBe('borderline');

    await field.verifySwitch(page).click();
    await field.verifyModel(page).fill('openai/gpt-4.1-nano');
    await save(page).click();
    await expect(page.getByText('Settings saved.').first()).toBeVisible();
    await expect.poll(async () => (await getSettings(ws)).verifyAvailable).toBe(true);
    await expect.poll(async () => (await getSettings(ws)).verifyModel).toBe('openai/gpt-4.1-nano');
  });

  test('the two numbers beside the others count checks and withheld answers', async ({ page }) => {
    const ws = await newWorkspace('admscstats');
    await seedFaq(ws, {
      question: 'How do I get a refund for my order?',
      answerText: 'Refunds take 5 days.',
    });
    await waitIndexed(ws);
    await putSettings(ws, { enabled: true });

    const op = await operatorApi();
    try {
      await openFaq(page);
      const before = {
        checked: await statNum(page, 'Last 30 days', 'Second checks'),
        withheld: await statNum(page, 'Last 30 days', 'Answers withheld'),
      };
      expect(before.checked).toBeGreaterThanOrEqual(before.withheld);
      const was = (await op.overview()).stats;
      expect(was.verified30d).toBe(before.checked);
      expect(was.vetoed30d).toBe(before.withheld);

      // Two confirmed close calls and one veto: each message is made a close call first.
      await closeCall(ws, 'refund');
      for (let i = 0; i < 2; i++) {
        const r = await call(ws, 'POST', `${faqBase(ws)}/test`, { query: 'refund' });
        expect(r.body.verify.verdict).toBe('confirmed');
      }
      await closeCall(ws, 'refund [[reject]]');
      expect(
        (await call(ws, 'POST', `${faqBase(ws)}/test`, { query: 'refund [[reject]]' })).body.verify
          .verdict,
      ).toBe('rejected');
      // A failed check is not counted: nothing was judged.
      await closeCall(ws, 'refund [[judge-fail]]');
      expect(
        (await call(ws, 'POST', `${faqBase(ws)}/test`, { query: 'refund [[judge-fail]]' })).body
          .verify.verdict,
      ).toBe('error');
      const now = (await op.overview()).stats;
      expect(now.verified30d - was.verified30d).toBe(3);
      expect(now.vetoed30d - was.vetoed30d).toBe(1);

      await page.reload();
      await openFaq(page);
      await expect(page.getByRole('group', { name: 'Last 30 days', exact: true })).toBeVisible();
      expect(await statNum(page, 'Last 30 days', 'Second checks')).toBe(now.verified30d);
      expect(await statNum(page, 'Last 30 days', 'Answers withheld')).toBe(now.vetoed30d);
    } finally {
      await op.dispose();
    }
  });
});

test.describe('who may see it', () => {
  test('a support operator gets the no-access state, no field, and the API refuses the new fields', async ({
    page,
  }) => {
    await signInOperator(page, SUPPORT);
    await page.goto('/admin/faq', { timeout: 120_000 });
    await expect(page.getByRole('heading', { name: 'FAQ engine', level: 1 })).toBeVisible({
      timeout: 120_000,
    });
    await expect(
      page.getByText('Only a super admin can see or change the FAQ engine.'),
    ).toBeVisible();
    await expect(field.verifySwitch(page)).toHaveCount(0);
    await expect(field.verifyModel(page)).toHaveCount(0);
    await expect(field.verifyPerHour(page)).toHaveCount(0);
    await expect(page.getByText('Second checks')).toHaveCount(0);

    const read = await page.request.get('/api/platform/faq');
    expect(read.status()).toBe(403);
    const write = await page.request.patch('/api/platform/faq', {
      data: { verifyEnabled: false, verifyPerHour: 1 },
      headers: { 'idempotency-key': `pw-${Date.now()}` },
    });
    expect(write.status()).toBe(403);
    // Nothing changed.
    const op = await operatorApi(SUPER);
    try {
      expect((await op.overview()).config).toMatchObject({
        verifyEnabled: true,
        verifyPerHour: DEFAULTS.verifyPerHour,
      });
    } finally {
      await op.dispose();
    }
  });
});

test.describe('looks', () => {
  for (const cfg of [
    { name: 'dark mode', opts: { colorScheme: 'dark' as const } },
    { name: 'a phone width', opts: { viewport: { width: 375, height: 800 } } },
  ]) {
    test(`${cfg.name}: the fields stay in view and the page does not scroll sideways`, async ({
      browser,
    }) => {
      const ctx = await browser.newContext({
        baseURL: process.env.WEB_URL ?? 'http://localhost:3201',
        ...cfg.opts,
      });
      const p = await ctx.newPage();
      try {
        await signInOperator(p);
        await openFaq(p);
        await field.verifyModel(p).scrollIntoViewIfNeeded();
        await expect(field.verifySwitch(p)).toBeVisible();
        await expect(field.verifyModel(p)).toBeVisible();
        await expect(field.verifyPerHour(p)).toBeVisible();
        const box = await field.verifyModel(p).boundingBox();
        const width = p.viewportSize()!.width;
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        expect(
          await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
      } finally {
        await ctx.close();
      }
    });
  }

  test('right to left: the model id and the cap stay left to right inside a mirrored page', async ({
    browser,
  }) => {
    const base = process.env.WEB_URL ?? 'http://localhost:3201';
    const ctx = await browser.newContext({ baseURL: base });
    await ctx.addCookies([{ name: 'NEXT_LOCALE', value: 'ar', url: base }]);
    const p = await ctx.newPage();
    try {
      await signInOperator(p);
      await p.goto('/admin/faq', { timeout: 120_000 });
      await expect(p.locator('html')).toHaveAttribute('dir', 'rtl', { timeout: 120_000 });
      const verify = p.locator('fieldset').first();
      await expect(verify.locator('input[dir="ltr"]')).toHaveCount(2, { timeout: 120_000 });
      for (const input of await verify.locator('input[dir="ltr"]').all()) {
        await expect(input).toBeVisible();
        expect(await input.evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
      }
      expect(
        await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    } finally {
      await ctx.close();
    }
  });
});
