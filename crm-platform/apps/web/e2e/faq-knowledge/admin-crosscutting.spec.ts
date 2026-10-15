import { expect, test, type Page } from '@playwright/test';
import {
  LAUNCH,
  WEB,
  field,
  openFaq,
  restoreConfig,
  save,
  signInOperator,
  sw,
  watch,
  arabic,
} from './admin-support';

test.use({ launchOptions: LAUNCH });
test.setTimeout(240_000);

test.beforeEach(async ({ page }) => {
  await signInOperator(page);
});
test.afterEach(async () => {
  await restoreConfig();
});

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.documentElement.clientWidth,
  }));

/** Visible interactive controls whose boxes overlap another control's box (a layout that stacks them on top of each other). */
const overlaps = (page: Page) =>
  page.evaluate(() => {
    const els = Array.from(
      document.querySelectorAll<HTMLElement>(
        'main button, main input, main select, main a[href], main [role="switch"]',
      ),
    ).filter((e) => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    });
    const bad: string[] = [];
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i].getBoundingClientRect();
        const b = els[j].getBoundingClientRect();
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 2 && h > 2 && !els[i].contains(els[j]) && !els[j].contains(els[i]))
          bad.push(`${els[i].outerHTML.slice(0, 60)} x ${els[j].outerHTML.slice(0, 60)}`);
      }
    }
    return bad;
  });

/** Text that spills out of its card (a clipped or overflowing label). */
const spills = (page: Page) =>
  page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        'main [role="group"], main section, main fieldset, main label, main dd, main dt, main h2, main button',
      ),
    )
      .filter(
        (e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible',
      )
      .map((e) => `${e.tagName} ${(e.textContent ?? '').slice(0, 50)}`),
  );

async function contrastProblems(page: Page, min: number) {
  return page.evaluate((minRatio) => {
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bgOf = (el: Element | null): number[] => {
      for (let e = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c.length >= 3 && (c[3] ?? 1) > 0.9) return c;
      }
      return [255, 255, 255];
    };
    const out: string[] = [];
    const walker = document.createTreeWalker(document.querySelector('main')!, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = (n.textContent ?? '').trim();
      const el = n.parentElement;
      if (!t || !el || el.closest('[aria-hidden="true"]')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      if ((el as HTMLButtonElement).disabled || el.closest('button:disabled')) continue;
      const fg = parse(cs.color);
      const a = fg[3] ?? 1;
      const bg = bgOf(el);
      const mixed = fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
      const l1 = lum(mixed) + 0.05;
      const l2 = lum(bg) + 0.05;
      const ratio = Math.max(l1, l2) / Math.min(l1, l2);
      if (ratio < minRatio) out.push(`${ratio.toFixed(2)} "${t.slice(0, 40)}"`);
    }
    return out;
  }, min);
}

test.describe('cross-cutting: console and network', () => {
  test('using every part of the page raises no console error or warning and no unexpected 4xx/5xx', async ({
    page,
  }) => {
    const w = watch(page);
    await openFaq(page);
    await expect(page.getByRole('row').nth(1)).toBeVisible();
    await field.maxFaqs(page).fill('511');
    await field.slider(page).isDisabled();
    await field.follow(page).uncheck();
    await field.slider(page).press('ArrowRight');
    await field.generation(page).fill('openai/gpt-4o');
    await page.getByRole('button', { name: 'Discard changes' }).click();
    await sw(page).click();
    await save(page).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard changes' }).click();
    await page.getByRole('button', { name: 'Re-index everything', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('searchbox', { name: 'Search workspaces' }).fill('pw');
    await page.getByRole('combobox', { name: 'Rows' }).selectOption('10');
    await expect(page.getByRole('table')).toBeVisible();
    await page.reload();
    await openFaq(page);
    expect(w.consoleIssues).toEqual([]);
    expect(w.failures).toEqual([]);
  });

  test('every control has an accessible name, also inside the dialogs', async ({ page }) => {
    await openFaq(page);
    const unnamed = (yaml: string) =>
      yaml
        .split('\n')
        .filter((l) =>
          /^\s*- (button|textbox|combobox|checkbox|switch|slider|link|searchbox|progressbar|table|region|group|dialog)(\s*\[[^\]]*\])*:?\s*$/.test(
            l,
          ),
        );
    expect(unnamed(await page.locator('main').ariaSnapshot())).toEqual([]);
    await sw(page).click();
    await save(page).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(unnamed(await dialog.ariaSnapshot())).toEqual([]);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Discard changes' }).click();
    await page.getByRole('button', { name: 'Re-index everything', exact: true }).click();
    expect(unnamed(await page.getByRole('dialog').ariaSnapshot())).toEqual([]);
    // Inputs are tied to their visible labels (clicking the label focuses the control).
    await page.keyboard.press('Escape');
    await page.getByText('Maximum variations per FAQ', { exact: true }).click();
    await expect(field.maxVars(page)).toBeFocused();
    await page.getByText('Generation model', { exact: true }).click();
    await expect(field.generation(page)).toBeFocused();
  });

  test('the Tab order follows the visual order of the form', async ({ page }) => {
    await openFaq(page);
    await field.follow(page).uncheck();
    await sw(page).focus();
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      seen.push(
        await page.evaluate(() => {
          const e = document.activeElement as HTMLElement;
          return (
            e.getAttribute('aria-label') ??
            document.querySelector(`label[for="${e.id}"]`)?.textContent?.trim().slice(0, 40) ??
            e.textContent?.trim().slice(0, 30) ??
            e.tagName
          );
        }),
      );
      await page.keyboard.press('Tab');
    }
    const expected = [
      'FAQ engine',
      'Embedding model',
      'Generation model',
      'Default match threshold',
      'Follow the model',
      // The second-check block sits between the model settings and the limits.
      'Allow the second check',
      'Check model',
      'Second checks per workspace per hour',
      'Maximum FAQs per flow',
      'Maximum variations per FAQ',
      'Semantic matches per workspace per hour',
      'Save changes',
    ];
    expected.forEach((name, i) => expect(seen[i], `stop ${i + 1}`).toContain(name));
  });
});

test.describe('cross-cutting: dialogs and focus', () => {
  test('the engine dialog traps focus, Escape closes it and focus returns to Save', async ({
    page,
  }) => {
    await openFaq(page);
    await sw(page).click();
    await save(page).click();
    const dialog = page.getByRole('dialog', { name: 'Review before saving' });
    await expect(dialog).toBeVisible();
    // Focus starts inside the dialog; Tab may leave through the browser's own UI (the body) but never reaches the page behind it.
    const where = () =>
      page.evaluate(() => {
        const a = document.activeElement;
        return a?.closest('dialog')
          ? 'dialog'
          : a === document.body || a === document.documentElement
            ? 'browser'
            : `page:${a?.tagName}`;
      });
    expect(await where()).toBe('dialog');
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(['dialog', 'browser'], `Tab ${i + 1}`).toContain(await where());
    }
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(['dialog', 'browser'], `Shift+Tab ${i + 1}`).toContain(await where());
    }
    // Clicking outside (the backdrop) closes it too.
    await page.mouse.click(2, 2);
    await expect(dialog).toBeHidden();
    await expect(save(page)).toBeFocused();
    await save(page).click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(save(page)).toBeFocused();
  });

  test('after a confirmed save focus is left somewhere useful, not on the page body', async ({
    page,
  }) => {
    await openFaq(page);
    await field.maxFaqs(page).fill('512');
    await save(page).click();
    await expect(page.getByText('Settings saved.')).toBeVisible();
    const active = await page.evaluate(() => document.activeElement?.tagName);
    expect(active, 'focus should stay in the page after a save, not fall to <body>').not.toBe(
      'BODY',
    );
  });

  test('after the engine dialog is confirmed focus is left somewhere useful', async ({ page }) => {
    await openFaq(page);
    await field.maxFaqs(page).fill('513');
    await page
      .getByRole('combobox', { name: 'Embedding model' })
      .selectOption('google/gemini-embedding-2');
    await save(page).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Settings saved.')).toBeVisible();
    const active = await page.evaluate(() => document.activeElement?.tagName);
    expect(active, 'focus should stay in the page after the dialog, not fall to <body>').not.toBe(
      'BODY',
    );
  });
});

test.describe('cross-cutting: responsive, theme, RTL', () => {
  for (const [name, size] of [
    ['mobile 375x812', { width: 375, height: 812 }],
    ['tablet 768x1024', { width: 768, height: 1024 }],
  ] as const) {
    test(`${name}: no horizontal page scroll, nothing overlaps, the table scrolls inside its card`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await openFaq(page);
      await expect(page.getByRole('row').nth(1)).toBeVisible();
      const scroll = await noHorizontalScroll(page);
      expect(scroll.doc, 'document scrolls sideways').toBeLessThanOrEqual(0);
      expect(scroll.body).toBeLessThanOrEqual(0);
      expect(await overlaps(page)).toEqual([]);
      expect(await spills(page)).toEqual([]);
      // Every action is reachable by scrolling down: Save and the maintenance buttons end up inside the viewport width.
      for (const b of [
        save(page),
        page.getByRole('button', { name: 'Re-index everything', exact: true }),
      ]) {
        await b.scrollIntoViewIfNeeded();
        const box = (await b.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      }
      // A dialog fits the screen too.
      await sw(page).click();
      await save(page).click();
      const dialogBox = (await page.getByRole('dialog').boundingBox())!;
      expect(dialogBox.x).toBeGreaterThanOrEqual(0);
      expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(size.width);
      await page.keyboard.press('Escape');
      expect((await noHorizontalScroll(page)).doc).toBeLessThanOrEqual(0);
    });
  }

  test('mobile: touch targets of the controls are at least 24px high', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openFaq(page);
    const small = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          'main button, main select, main input:not([type="checkbox"]):not([type="range"])',
        ),
      )
        .filter((e) => e.getBoundingClientRect().width > 0)
        .map((e) => ({
          t: (e.getAttribute('aria-label') ?? e.textContent ?? e.id).trim().slice(0, 30),
          h: e.getBoundingClientRect().height,
        }))
        .filter((e) => e.h < 24),
    );
    expect(small).toEqual([]);
  });

  test('dark mode: readable text (contrast 4.5:1), no overlap, no horizontal scroll', async ({
    page,
    context,
  }) => {
    await context.addCookies([{ name: 'crm_theme', value: 'dark', url: WEB }]);
    await page.emulateMedia({ colorScheme: 'dark' });
    await openFaq(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('row').nth(1)).toBeVisible();
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const [r, g, b] = bg.match(/[\d.]+/g)!.map(Number);
    expect((r + g + b) / 3, `body background ${bg} should be dark`).toBeLessThan(90);
    expect(await contrastProblems(page, 4.5)).toEqual([]);
    expect(await overlaps(page)).toEqual([]);
    expect((await noHorizontalScroll(page)).doc).toBeLessThanOrEqual(0);
    await sw(page).click();
    await save(page).click();
    expect(
      await page.getByRole('dialog').evaluate((d) => getComputedStyle(d).backgroundColor),
    ).not.toBe('rgba(0, 0, 0, 0)');
    await page.keyboard.press('Escape');
  });

  test('light mode: readable text (contrast 4.5:1)', async ({ page }) => {
    await openFaq(page);
    await expect(page.getByRole('row').nth(1)).toBeVisible();
    expect(await contrastProblems(page, 4.5)).toEqual([]);
  });

  test('Arabic: right-to-left, no overlap, no horizontal scroll on desktop and phone, numbers and ids stay left-to-right', async ({
    page,
    context,
  }) => {
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'ar', url: WEB }]);
    const w = watch(page);
    const ar = arabic();
    await openFaq(page, ar);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.getByRole('row').nth(1)).toBeVisible();
    expect(await overlaps(page)).toEqual([]);
    expect(await spills(page)).toEqual([]);
    expect((await noHorizontalScroll(page)).doc).toBeLessThanOrEqual(0);
    // The settings form mirrors: the switch sits at the start (right) edge area, the labels are right-aligned.
    const labelBox = (await page.getByText(ar.maxFaqs, { exact: true }).boundingBox())!;
    const maxFaqs = page.getByRole('textbox', { name: ar.maxFaqs });
    const inputBox = (await maxFaqs.boundingBox())!;
    expect(labelBox.x + labelBox.width).toBeGreaterThanOrEqual(inputBox.x + inputBox.width - 2);
    for (const input of [
      maxFaqs,
      page.getByRole('textbox', { name: ar.generation }),
      page.getByRole('slider', { name: ar.threshold }),
    ]) {
      await expect(input).toHaveAttribute('dir', 'ltr');
    }
    await page.setViewportSize({ width: 375, height: 812 });
    expect((await noHorizontalScroll(page)).doc).toBeLessThanOrEqual(0);
    expect(await overlaps(page)).toEqual([]);
    expect(w.consoleIssues).toEqual([]);
  });

  test('Arabic: the engine dialog still opens and closes with the keyboard', async ({
    page,
    context,
  }) => {
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'ar', url: WEB }]);
    const ar = arabic();
    await openFaq(page, ar);
    const arSave = page.getByRole('button', { name: ar.save, exact: true });
    await page.getByRole('switch', { name: ar.engineSwitch }).click();
    await arSave.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(arSave).toBeFocused();
  });
});
