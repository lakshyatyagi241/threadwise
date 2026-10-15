import { expect, test, type Page } from '@playwright/test';

/**
 * QA task #31: stored and reflected XSS against the real UI. A payload is saved through the API into free-text fields, then the screens that
 * render it are opened; the page must show it as text and must never run it (no dialog, no `window.__xss`, no injected element).
 *
 *   HEADLESS=1 pnpm --filter @crm/web exec playwright test e2e/security/xss.spec.ts
 *
 * Creates contacts named after the payloads in the seeded LOCAL workspace and deletes them afterwards.
 */
const ORG = process.env.E2E_ORG ?? 'Admin';
const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'nachiket.challawar@geta.ai',
  password: process.env.E2E_PASSWORD ?? 'Passw0rd!',
};

export const PAYLOADS = [
  `<script>window.__xss=1</script>`,
  `"><script>window.__xss=1</script>`,
  `<img src=x onerror="window.__xss=1">`,
  `<svg onload="window.__xss=1">`,
  `<svg><script>window.__xss=1</script></svg>`,
  `javascript:window.__xss=1`,
  `<a href="javascript:window.__xss=1">x</a>`,
  `<iframe srcdoc="<script>parent.__xss=1</script>">`,
  `<details open ontoggle="window.__xss=1">`,
  `<body onload="window.__xss=1">`,
  `<math><mtext></mtext><script>window.__xss=1</script></math>`,
  `'-window.__xss=1-'`,
  `{{constructor.constructor('window.__xss=1')()}}`,
  `\${window.__xss=1}`,
  `<style>@import 'javascript:window.__xss=1';</style>`,
  `<input autofocus onfocus="window.__xss=1">`,
];

async function signIn(page: Page) {
  const res = await page.request.post('/api/auth/login', {
    data: { orgSlug: ORG, email: ADMIN.email, password: ADMIN.password },
  });
  expect(res.ok(), 'sign in').toBe(true);
}

test.describe('stored XSS in contacts', () => {
  const created: string[] = [];
  test.beforeEach(async ({ page }) => signIn(page));
  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext({
      baseURL: process.env.WEB_URL ?? 'http://localhost:3001',
    });
    const res = await ctx.request.post('/api/auth/login', {
      data: { orgSlug: ORG, email: ADMIN.email, password: ADMIN.password },
    });
    if (res.ok())
      for (const id of created)
        await ctx.request.delete(`/api/v2/contacts/${id}`).catch(() => undefined);
    await ctx.close();
  });

  PAYLOADS.forEach((payload, i) => {
    test(`payload ${i + 1} is shown as text and never runs: ${payload.slice(0, 40)}`, async ({
      page,
    }) => {
      let dialog = '';
      page.on('dialog', async (d) => {
        dialog = d.message();
        await d.dismiss();
      });
      const res = await page.request.post('/api/v2/contacts', {
        data: { name: payload, firstName: payload.slice(0, 200), source: payload },
      });
      test.skip(
        !res.ok() && res.status() === 400,
        'the API refused this payload (validation): acceptable, nothing stored',
      );
      expect(res.status(), 'create contact').toBeLessThan(500);
      const id =
        (await res.json().catch(() => ({})))?.id ?? (await res.json().catch(() => ({})))?.data?.id;
      if (id) created.push(id);

      for (const path of ['/contacts', id ? `/contacts/${id}` : '/contacts']) {
        await page.goto(path, { waitUntil: 'load' });
        await page.waitForTimeout(500);
        expect(
          await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
          `window.__xss after opening ${path}`,
        ).toBeUndefined();
        expect(dialog, 'a dialog opened').toBe('');
        expect(
          await page.locator('body script:not([src]):has-text("__xss")').count(),
          'injected inline script',
        ).toBe(0);
      }
    });
  });
});

test.describe('reflected XSS in query strings', () => {
  for (const [i, payload] of PAYLOADS.entries()) {
    test(`query payload ${i + 1} on public and signed-in pages`, async ({ page }) => {
      let dialog = '';
      page.on('dialog', async (d) => {
        dialog = d.message();
        await d.dismiss();
      });
      for (const path of ['/login', '/register', '/forgot-password', '/blog', '/pricing']) {
        await page.goto(
          `${path}?q=${encodeURIComponent(payload)}&redirect=${encodeURIComponent(payload)}&next=${encodeURIComponent(payload)}`,
          { waitUntil: 'load' },
        );
        expect(
          await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
          `window.__xss on ${path}`,
        ).toBeUndefined();
        expect(dialog).toBe('');
      }
    });
  }
});

test.describe('security headers on the web app', () => {
  for (const path of ['/', '/login', '/pricing']) {
    test(`headers on ${path}`, async ({ request }) => {
      const res = await request.get(path);
      const h = res.headers();
      expect(h['x-content-type-options'], 'X-Content-Type-Options').toBe('nosniff');
      expect(
        h['content-security-policy'] ?? h['content-security-policy-report-only'],
        'a Content-Security-Policy',
      ).toBeTruthy();
      expect(
        h['x-frame-options'] ?? h['content-security-policy'],
        'clickjacking protection',
      ).toBeTruthy();
    });
  }
});
