import { expect, test, type Page } from '@playwright/test';

/**
 * Form validation in the browser (QA task 12): the public forms a visitor meets first. For each form the same scenarios are generated:
 * submit empty, leave each required field blank, bad emails, only spaces, 10,000 characters, a script payload, emoji and right-to-left
 * text, Enter to submit, and that the error goes away once the field is fixed. Only invalid or incomplete data is ever submitted, so no
 * account is created and no mail is sent.
 *
 * What "validated" means here: the form says so (an `aria-invalid` field, an alert with text, or a native invalid field), it stays on the
 * page, it never answers with a 5xx, and a script in a field never runs.
 *
 *   HEADLESS=1 WEB_URL=http://localhost:3001 pnpm --filter @crm/web exec playwright test e2e/form-validation
 *
 * P0 forms guard access to the product (sign in, sign up, reset); P1 is the marketing contact form. The title of each test starts with its priority.
 */
type Field = { label: RegExp; kind: 'text' | 'email' | 'password' | 'tel' | 'area'; valid: string };
type Form = {
  id: string;
  prio: 'P0' | 'P1';
  path: string;
  submit: RegExp;
  fields: Field[];
  required: number[];
};

const FORMS: Form[] = [
  {
    id: 'login',
    prio: 'P0',
    path: '/login',
    submit: /^sign in$/i,
    fields: [
      { label: /^email/i, kind: 'email', valid: 'visitor@example.test' },
      { label: /^password/i, kind: 'password', valid: 'Correct-Horse-9' },
    ],
    required: [0, 1],
  },
  {
    id: 'signup',
    prio: 'P0',
    path: '/signup',
    submit: /^continue$/i,
    fields: [
      { label: /full name/i, kind: 'text', valid: 'Test Visitor' },
      { label: /work email/i, kind: 'email', valid: 'visitor@example.test' },
      { label: /mobile number/i, kind: 'tel', valid: '9876543210' },
    ],
    required: [0, 1, 2],
  },
  {
    id: 'forgot-password',
    prio: 'P0',
    path: '/forgot-password',
    submit: /email reset link/i,
    fields: [
      { label: /workspace/i, kind: 'text', valid: 'acme' },
      { label: /^email/i, kind: 'email', valid: 'visitor@example.test' },
    ],
    required: [0, 1],
  },
  {
    id: 'find-workspace',
    prio: 'P0',
    path: '/find-workspace',
    submit: /email me my workspace/i,
    fields: [{ label: /^email/i, kind: 'email', valid: 'visitor@example.test' }],
    required: [0],
  },
  {
    id: 'contact',
    prio: 'P1',
    path: '/contact',
    submit: /send message/i,
    fields: [
      { label: /your name/i, kind: 'text', valid: 'Test Visitor' },
      { label: /work email/i, kind: 'email', valid: 'visitor@example.test' },
      { label: /^message/i, kind: 'area', valid: 'Hello, this is a test message.' },
    ],
    required: [0, 1, 2],
  },
];

const BAD_EMAILS = ['not-an-email', 'a@b', 'a b@c.com', '@x.com', 'x@@y.com'];
const XSS = '"><img src=x onerror="window.__xss=1"><script>window.__xss=1</script>';
const UNICODE = 'مرحبا بالعالم 😀 日本語 Zoë';

/** What the form shows after a submit: native invalid fields, aria-invalid fields, alerts with text. */
async function indication(page: Page) {
  return page.evaluate(() => {
    const vis = (e: Element) => {
      const s = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const aria = [...document.querySelectorAll('[aria-invalid="true"]')].filter(vis).length;
    const alerts = [...document.querySelectorAll('[role="alert"], [aria-live="assertive"]')].filter(
      (e) => vis(e) && (e.textContent ?? '').trim().length > 0,
    ).length;
    // the browser focuses the first invalid field when a native check stops a submit; an invalid field that merely exists does not count
    const active = document.activeElement;
    const native = active && active.closest('form') && active.matches(':invalid') ? 1 : 0;
    return { aria, alerts, native, any: aria + alerts + native > 0 };
  });
}

for (const form of FORMS) {
  test.describe(`${form.prio} form ${form.id}`, () => {
    let serverErrors: string[] = [];
    let writes = 0;

    test.beforeEach(async ({ page }) => {
      serverErrors = [];
      writes = 0;
      page.on('response', (r) => {
        if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`);
      });
      page.on('request', (r) => {
        if (['POST', 'PUT', 'PATCH'].includes(r.method()) && /\/api\//.test(r.url())) writes++;
      });
      page.on('dialog', (d) => void d.dismiss());
      await page.goto(form.path, { waitUntil: 'load' });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
      // control: a fresh form shows no problem, so a later "shows a problem" cannot pass by itself
      expect((await indication(page)).any, 'a fresh form already shows a problem').toBe(false);
    });

    const field = (page: Page, i: number) => page.getByLabel(form.fields[i]!.label).first();
    const submit = (page: Page) => page.getByRole('button', { name: form.submit }).first();
    const fillValid = async (page: Page, except = -1) => {
      for (const [i, f] of form.fields.entries())
        if (i !== except) await field(page, i).fill(f.valid);
    };
    const stays = async (page: Page) => {
      await page.waitForTimeout(400);
      expect(new URL(page.url()).pathname, 'stays on the form').toBe(
        form.path === '/register' ? '/signup' : form.path,
      );
      expect(serverErrors, 'no 5xx').toEqual([]);
    };
    const showsProblem = async (page: Page, why: string) => {
      await expect
        .poll(async () => (await indication(page)).any, { message: why, timeout: 4000 })
        .toBe(true);
    };

    test(`[${form.prio}] submitting empty says what is wrong`, async ({ page }) => {
      await submit(page).click();
      await showsProblem(page, 'an empty form shows a problem');
      await stays(page);
    });

    for (const i of form.required) {
      test(`[${form.prio}] ${form.fields[i]!.label.source} left blank is refused`, async ({
        page,
      }) => {
        await fillValid(page, i);
        await submit(page).click();
        await showsProblem(page, 'a blank required field shows a problem');
        await stays(page);
      });
    }

    for (const [i, f] of form.fields.entries()) {
      if (f.kind === 'email') {
        for (const bad of BAD_EMAILS) {
          test(`[${form.prio}] ${f.label.source} rejects "${bad}"`, async ({ page }) => {
            await fillValid(page, i);
            await field(page, i).fill(bad);
            await submit(page).click();
            await showsProblem(page, 'a bad email shows a problem');
            await stays(page);
          });
        }
      }
      if (f.kind === 'text' || f.kind === 'area') {
        test(`[${form.prio}] ${f.label.source} with only spaces is refused`, async ({ page }) => {
          await fillValid(page, i);
          await field(page, i).fill('     ');
          await submit(page).click();
          await showsProblem(page, 'spaces only shows a problem');
          await stays(page);
        });
      }
      test(`[${form.prio}] ${f.label.source} takes 10,000 characters without breaking`, async ({
        page,
      }) => {
        await field(page, i).fill('x'.repeat(10_000));
        await submit(page).click();
        await page.waitForTimeout(500);
        expect(serverErrors, 'no 5xx').toEqual([]);
        await expect(page.locator('body')).toBeVisible();
        await expect(submit(page)).toBeEnabled({ timeout: 5000 });
      });
      test(`[${form.prio}] ${f.label.source} never runs a script, and keeps emoji and right-to-left text`, async ({
        page,
      }) => {
        await field(page, i).fill(XSS);
        await submit(page).click();
        await page.waitForTimeout(500);
        expect(
          await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
          'a script ran',
        ).toBeUndefined();
        await field(page, i).fill(UNICODE);
        await submit(page).click();
        await page.waitForTimeout(400);
        expect(serverErrors, 'no 5xx').toEqual([]);
        if (f.kind !== 'tel') expect(await field(page, i).inputValue()).toBe(UNICODE);
      });
    }

    test(`[${form.prio}] Enter in the last single-line field submits like the button`, async ({
      page,
    }) => {
      // Enter in a textarea adds a line, so use the last single-line field
      const single = form.fields.flatMap((f, i) => (f.kind === 'area' ? [] : [i]));
      await field(page, single[single.length - 1]!).press('Enter');
      await showsProblem(page, 'Enter on an empty form shows a problem');
      await stays(page);
    });

    test(`[${form.prio}] an incomplete form does not write to the server, and the problem goes away once fixed`, async ({
      page,
    }) => {
      await fillValid(page, 0);
      await submit(page).click();
      await showsProblem(page, 'one blank field shows a problem');
      expect(writes, 'writes sent for an incomplete form').toBe(0);
      await field(page, 0).fill(form.fields[0]!.valid);
      await expect
        .poll(async () => (await indication(page)).aria, {
          message: 'the problem clears once the field is filled',
          timeout: 4000,
        })
        .toBe(0);
    });
  });
}
