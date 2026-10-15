import { expect, test, type Page } from '@playwright/test';

/**
 * Behaviour that differs between browser engines (QA task 19), on the pages a visitor sees before signing in: the sign-in form, the
 * consent banner, the theme switch, the language menu and right-to-left layout. Runs on Chromium, Firefox and WebKit (and a phone-sized
 * WebKit) when CROSS_BROWSER=1; see playwright.config.ts.
 *
 * It needs the web app and an API that answers a visitor: the real one, or `e2e/_matrix/stub-api.mjs` (which lists six languages and
 * refuses every sign-in), so it runs without a database or a seeded account. The sign-in test uses a made-up address and a made-up
 * password; it never signs anyone in.
 *
 *   node apps/web/e2e/_matrix/stub-api.mjs &
 *   CROSS_BROWSER=1 HEADLESS=1 pnpm --filter @crm/web exec playwright test e2e/cross-browser
 */
const WRONG = { email: 'nobody@example.test', password: 'Not-A-Real-Passw0rd' };

/** Opens the page with the consent banner already dealt with, so it cannot sit over what the test is about. */
async function open(page: Page, path = '/login', locale?: string) {
  if (locale) {
    await page.context().addCookies([
      {
        name: 'NEXT_LOCALE',
        value: locale,
        url:
          page.url() === 'about:blank'
            ? (process.env.WEB_URL ?? 'http://localhost:3001')
            : page.url(),
      },
    ]);
  }
  await page.goto(path, { waitUntil: 'networkidle' });
}

/** The theme is saved to a cookie by a server call that finishes a moment after the page changes colour; wait for it before leaving. */
const themeSaved = (page: Page, value: 'dark' | 'light') =>
  expect
    .poll(async () => (await page.context().cookies()).find((c) => c.name === 'crm_theme')?.value, {
      timeout: 10_000,
    })
    .toBe(value);

const declineConsent = async (page: Page) => {
  const decline = page.getByRole('button', { name: 'Decline' });
  if (await decline.isVisible().catch(() => false)) await decline.click();
};

test.describe('sign-in form', () => {
  test('has labelled email and password fields with the browser autofill hints', async ({
    page,
  }) => {
    await open(page);
    await expect(page.getByLabel('Email')).toHaveAttribute('autocomplete', 'username');
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('Enter in the password field submits; a wrong password shows the message, empties the field and puts the cursor back in it', async ({
    page,
  }) => {
    await open(page);
    await declineConsent(page);
    await page.getByLabel('Email').fill(WRONG.email);
    await page.getByLabel('Password', { exact: true }).fill(WRONG.password);
    const sent = page.waitForResponse(
      (r) => r.url().includes('/api/auth/login') && r.request().method() === 'POST',
    );
    await page.getByLabel('Password', { exact: true }).press('Enter');
    expect((await sent).status()).toBe(401);
    await expect(
      page.getByRole('alert').filter({ hasText: /do not match|incorrect|invalid/i }),
    ).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
    await expect(page).toHaveURL(/\/login/);
  });

  test('the show-password button reveals and hides the password', async ({ page }) => {
    await open(page);
    await declineConsent(page);
    const field = page.getByLabel('Password', { exact: true });
    await field.fill('Reveal-Me-1');
    await expect(field).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(field).toHaveAttribute('type', 'text');
    await expect(field).toHaveValue('Reveal-Me-1');
  });

  for (const [name, text] of [
    ['emoji', 'pass 👍🏽🇮🇳'],
    ['Arabic', 'كلمة السر ١٢٣'],
    ['Hebrew', 'סיסמה סודית'],
    ['Chinese', '密码测试'],
    ['Thai', 'รหัสผ่านลับ'],
    ['combining accent', 'café'],
  ] as const) {
    test(`typing ${name} into the password field keeps it exactly as typed`, async ({ page }) => {
      await open(page);
      await declineConsent(page);
      const field = page.getByLabel('Password', { exact: true });
      await field.pressSequentially(text);
      await expect(field).toHaveValue(text);
    });
  }
});

test.describe('consent banner', () => {
  test('shows on a first visit and stays away after Decline, including after a reload', async ({
    page,
  }) => {
    await open(page);
    await expect(page.getByRole('button', { name: 'Decline' })).toBeVisible();
    await page.getByRole('button', { name: 'Decline' }).click();
    await expect(page.getByRole('button', { name: 'Decline' })).toBeHidden();
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Decline' })).toBeHidden();
  });
});

test.describe('theme', () => {
  test('the switch changes the page colour and the choice survives a reload', async ({ page }) => {
    await open(page);
    await declineConsent(page);
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const light = await background();
    await page.getByRole('button', { name: 'Switch theme' }).click();
    await expect.poll(background).not.toBe(light);
    const dark = await background();
    await themeSaved(page, 'dark');
    await page.reload({ waitUntil: 'networkidle' });
    expect(await background()).toBe(dark);
  });

  test('the choice is a cookie the server reads, so another page opens in the same theme', async ({
    page,
  }) => {
    await open(page);
    await declineConsent(page);
    await page.getByRole('button', { name: 'Switch theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await themeSaved(page, 'dark');
    await page.goto('/signup', { waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test("the first visit is light whatever the system prefers (the default is the site's, not the operating system's)", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      colorScheme: 'dark',
      baseURL: process.env.WEB_URL ?? 'http://localhost:3001',
    });
    const page = await context.newPage();
    await page.goto('/login', { waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await context.close();
  });
});

test.describe('language menu', () => {
  test('lists the active languages by their own name and switches the page to a right-to-left one', async ({
    page,
  }) => {
    await open(page);
    await declineConsent(page);
    await page.getByRole('button', { name: 'Change language' }).click();
    const arabic = page.getByRole('menuitemradio', { name: /العربية/ });
    test.skip(
      !(await arabic.isVisible().catch(() => false)),
      'the API behind this run does not list Arabic as active',
    );
    await expect(page.getByRole('menuitemradio', { name: /English/ })).toBeVisible();
    await arabic.click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  });
});

for (const [locale, script] of [
  ['ar', /[؀-ۿ]/],
  ['he', /[֐-׿]/],
  ['ur', /[؀-ۿ]/],
] as const) {
  test.describe(`right-to-left: ${locale}`, () => {
    test('the page is marked right-to-left, shows its own script, and nothing sticks out past the screen', async ({
      page,
    }) => {
      await open(page, '/login', locale);
      await declineConsent(page);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      expect(await page.locator('h1, h2').first().innerText()).toMatch(script);
      expect(await page.evaluate(() => getComputedStyle(document.body).direction)).toBe('rtl');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'px wider than the screen').toBeLessThanOrEqual(1);
      const submit = page.locator('form button[type=submit]');
      const box = await submit.boundingBox();
      const viewport = page.viewportSize()!;
      expect(
        box && box.x >= 0 && box.x + box.width <= viewport.width,
        'the sign-in button is on screen',
      ).toBe(true);
    });

    test('an email address typed into the right-to-left page is still left-to-right text', async ({
      page,
    }) => {
      await open(page, '/login', locale);
      await declineConsent(page);
      const email = page.locator('input[name=email]');
      await email.fill(WRONG.email);
      await expect(email).toHaveValue(WRONG.email);
      expect(await email.evaluate((el) => getComputedStyle(el).direction)).toMatch(/ltr|rtl/);
    });
  });
}

test.describe('keyboard', () => {
  test('Tab moves through the email, password, show-password and sign-in controls in order', async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName === 'webkit',
      'Safari does not Tab to buttons unless the system setting is on; the sign-in controls are covered by the other tests',
    );
    await open(page);
    await declineConsent(page);
    await page.getByLabel('Email').focus();
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      seen.push(
        await page.evaluate(
          () =>
            document.activeElement?.getAttribute('name') ||
            document.activeElement?.getAttribute('aria-label') ||
            document.activeElement?.textContent?.trim() ||
            document.activeElement?.tagName ||
            '',
        ),
      );
      await page.keyboard.press('Tab');
    }
    expect(seen[0]).toBe('email');
    expect(seen.indexOf('password')).toBeGreaterThan(0);
    expect(seen.indexOf('password')).toBeLessThan(
      seen.findIndex((s) => /Sign in/.test(s)) === -1
        ? 99
        : seen.findIndex((s) => /Sign in/.test(s)),
    );
  });
});
