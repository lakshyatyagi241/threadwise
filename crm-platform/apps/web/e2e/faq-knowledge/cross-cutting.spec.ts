import {
  customerSays,
  expect,
  logCount,
  login,
  newWorkspace,
  open,
  openFaqs,
  type OpenOptions,
  putSettings,
  seedFaq,
  seedFlow,
  simulator,
  type State,
  test,
  waitIndexed,
  type Workspace,
} from './support';
import type { Page } from '@playwright/test';

/** Every screen, with data on it: clean console, named controls, phones and tablets, dark mode, right-to-left, focus. */
let ws: Workspace;
let state: State;
let faqId: string;
/** The screens of the flow's FAQs tab: the `view` of each (undefined is the list). */
let paths: Array<string | undefined>;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  ws = await newWorkspace('cross');
  state = await login(browser, ws.email);
  const sim = await simulator(ws);
  const first = await seedFaq(ws, {
    question: 'Where is my order?',
    answerText: 'Your order ships tomorrow.',
    category: 'Shipping',
    variations: ['track my order', 'order status'],
  });
  faqId = first.id;
  await seedFaq(ws, {
    question: 'Talk to billing',
    flowId: seedFlow(ws, 'Pwcross billing flow'),
    category: 'Billing',
  });
  await seedFaq(ws, { question: 'Paused example', status: 'paused', answerText: 'Paused answer.' });
  await waitIndexed(ws);
  await putSettings(ws, { enabled: true, threshold: 0.8 });
  for (const text of ['where is my order', 'order cancellation', 'unrelated gibberish words']) {
    await customerSays(ws, sim, text, `9194${String(Date.now()).slice(-7)}`);
  }
  await expect.poll(() => logCount(ws), { timeout: 40_000 }).toBe(3);
  paths = [undefined, 'new', faqId, 'test', 'unanswered', 'insights', 'settings'];
});

/** Elements a person can operate that have no accessible name (read from the browser's own accessibility tree). */
async function unnamedControls(page: Page): Promise<string[]> {
  const snapshot = await panel(page).ariaSnapshot();
  return snapshot
    .split('\n')
    .map((l) => l.trim())
    .filter((l) =>
      /^- (button|link|textbox|searchbox|checkbox|combobox|slider|switch|radio|tab|spinbutton)(\s*\[[^\]]*\])*:?\s*$/.test(
        l,
      ),
    );
}

async function ready(page: Page, view?: string) {
  await openFaqs(page, ws, view);
  // Let the data on the screen arrive (skeletons and spinners are gone).
  await expect(panel(page).locator('.animate-pulse')).toHaveCount(0, { timeout: 20_000 });
}

/** The FAQs tab of the flow builder: what these checks judge (the builder around it is another domain's screen). */
const panel = (page: Page) => page.locator('#web-bot-panel-faqs');

test('every screen opens with a clean console, no failed request and every control named', async ({
  browser,
  watch,
}) => {
  const { page } = await open(browser, state, watch);
  for (const path of paths) {
    await ready(page, path);
    expect(await unnamedControls(page), `unnamed controls on ${path ?? 'list'}`).toEqual([]);
  }
  // The same, with the screens' own dialogs and panels open.
  await ready(page);
  await page.getByRole('button', { name: 'Delete Paused example' }).click();
  expect(await unnamedControls(page), 'delete dialog').toEqual([]);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await ready(page, faqId);
  await page.getByRole('button', { name: 'Paste many' }).click();
  await page.getByText('Advanced: sensitivity for this FAQ only').click();
  await page.getByLabel('Use a custom sensitivity for this FAQ').check();
  expect(await unnamedControls(page), 'editor panels').toEqual([]);
  await ready(page, 'unanswered');
  await page.getByRole('button', { name: 'Add to an FAQ' }).first().click();
  expect(await unnamedControls(page), 'picker').toEqual([]);
});

for (const [name, viewport] of [
  ['phone', { width: 375, height: 812 }],
  ['tablet', { width: 768, height: 1024 }],
] as const) {
  test(`on a ${name} nothing scrolls sideways and the main action is reachable`, async ({
    browser,
    watch,
  }) => {
    const { page } = await open(browser, state, watch, { viewport });
    const overflow = () =>
      page.evaluate(() => ({
        page: document.documentElement.scrollWidth - window.innerWidth,
        wide: Array.from(document.querySelectorAll<HTMLElement>('#web-bot-panel-faqs *'))
          .filter((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0 || getComputedStyle(el).position === 'fixed')
              return false;
            // Inside a horizontal scroller (the table, the tab bar) is allowed.
            for (let p: HTMLElement | null = el.parentElement; p; p = p.parentElement)
              if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) return false;
            return r.right > window.innerWidth + 1;
          })
          .slice(0, 5)
          .map((el) => `${el.tagName}.${String(el.className).slice(0, 60)}`),
      }));
    for (const path of paths) {
      await ready(page, path);
      const o = await overflow();
      expect(o.page, `sideways scroll on ${path ?? 'list'}`).toBeLessThanOrEqual(0);
      expect(o.wide, `content past the edge on ${path ?? 'list'}`).toEqual([]);
    }
    // The primary action of each screen is on screen after scrolling, and usable.
    await ready(page);
    await page.getByRole('link', { name: 'Add FAQ' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('link', { name: 'Add FAQ' })).toBeInViewport();
    await ready(page, 'new');
    await page.getByRole('textbox', { name: 'Question', exact: true }).fill(`${name} made FAQ`);
    await page.getByLabel('Answer text').fill('Typed on a phone.');
    await page.getByRole('button', { name: 'Create FAQ' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Create FAQ' })).toBeInViewport();
    await page.getByRole('button', { name: 'Create FAQ' }).click();
    await expect(page.getByText('FAQ created.')).toBeVisible();
    await ready(page, 'settings');
    await page.getByRole('switch', { name: 'Keep customer messages in the match log' }).click();
    await page.getByRole('button', { name: 'Save settings' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Save settings' })).toBeInViewport();
    await ready(page, 'test');
    await expect(page.getByRole('button', { name: 'Run' })).toBeInViewport();
    // The sections of the FAQ area stay reachable: the tab bar scrolls inside itself.
    await page
      .getByRole('navigation', { name: 'FAQ sections' })
      .getByRole('link', { name: 'Insights' })
      .scrollIntoViewIfNeeded();
    await page
      .getByRole('navigation', { name: 'FAQ sections' })
      .getByRole('link', { name: 'Insights' })
      .click();
    await expect(page).toHaveURL(/[?&]view=insights$/);
  });
}

test('dark mode keeps text readable on every screen', async ({ browser, watch }) => {
  const { page } = await open(browser, state, watch, { colorScheme: 'dark', theme: 'dark' });
  for (const path of paths) {
    await ready(page, path);
    const bad = await page.evaluate(() => {
      const parse = (c: string): number[] => (c.match(/[\d.]+/g) ?? []).map(Number);
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
      };
      const backdrop = (el: Element): number[] => {
        for (let p: Element | null = el; p; p = p.parentElement) {
          const c = parse(getComputedStyle(p).backgroundColor);
          if ((c[3] ?? 1) > 0.5) return c;
        }
        return [0, 0, 0];
      };
      const out: string[] = [];
      const bg = lum(backdrop(document.body));
      if (bg > 0.3) out.push(`page background is light (${bg.toFixed(2)})`);
      for (const el of Array.from(
        document.querySelectorAll<HTMLElement>('#web-bot-panel-faqs *'),
      )) {
        if (
          el.childNodes.length === 0 ||
          !Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent?.trim())
        )
          continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden')
          continue;
        if ((el as HTMLButtonElement).disabled || el.closest('[disabled],[aria-disabled="true"]'))
          continue;
        const fg = parse(getComputedStyle(el).color);
        const b = lum(backdrop(el));
        const f = lum(fg);
        const ratio = (Math.max(b, f) + 0.05) / (Math.min(b, f) + 0.05);
        if (ratio < 3)
          out.push(
            `${el.tagName} "${el.textContent!.trim().slice(0, 30)}" ratio ${ratio.toFixed(2)}`,
          );
      }
      return out.slice(0, 8);
    });
    expect(bad, `dark mode on ${path ?? 'list'}`).toEqual([]);
  }
});

test('right-to-left: the page turns around, nothing scrolls sideways and no control is cut off', async ({
  browser,
  watch,
}) => {
  const { page } = await open(browser, state, watch, {
    locale: 'ar',
    viewport: { width: 1280, height: 800 },
  });
  for (const path of paths) {
    await ready(page, path);
    expect(
      await page.evaluate(() => document.documentElement.dir),
      `dir on ${path ?? 'list'}`,
    ).toBe('rtl');
    const probs = await page.evaluate(() => {
      const out: string[] = [];
      if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push('sideways scroll');
      for (const el of Array.from(
        document.querySelectorAll<HTMLElement>(
          '#web-bot-panel-faqs button, #web-bot-panel-faqs a, #web-bot-panel-faqs input, #web-bot-panel-faqs select, #web-bot-panel-faqs textarea, #web-bot-panel-faqs label',
        ),
      )) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.left < -1 || r.right > window.innerWidth + 1)
          out.push(`${el.tagName} off screen "${(el.textContent ?? '').trim().slice(0, 20)}"`);
        const cs = getComputedStyle(el);
        if (
          el.tagName === 'BUTTON' &&
          cs.overflow === 'hidden' &&
          el.scrollWidth > el.clientWidth + 1
        )
          out.push(`BUTTON clipped "${(el.textContent ?? '').trim().slice(0, 20)}"`);
      }
      return out.slice(0, 8);
    });
    expect(probs, `rtl on ${path ?? 'list'}`).toEqual([]);
  }
  // The back arrow and the progress marker mirror: the editor's back link points the other way.
  await ready(page, faqId);
  // (The back link is the one with an arrow; its name is translated.)
  const arrow = panel(page).locator('a[href$="?tab=faqs"]:has(svg)').first().locator('svg').first();
  expect(await arrow.evaluate((el) => getComputedStyle(el).rotate)).toBe('180deg');
});

test.describe('focus does not get lost', () => {
  test('removing a phrasing leaves focus inside the panel', async ({ browser, watch }) => {
    const faq = await seedFaq(ws, {
      question: 'Focus after remove',
      variations: ['focus one', 'focus two'],
    });
    const { page } = await open(browser, state, watch);
    await ready(page, faq.id);
    await page.getByRole('button', { name: 'Remove focus one' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('list', { name: 'Phrasings' }).getByText('focus one')).toHaveCount(
      0,
    );
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName ?? 'none'))
      .not.toBe('BODY');
  });

  test('dismissing and teaching an unanswered message keep focus on the page', async ({
    browser,
    watch,
  }) => {
    const { page } = await open(browser, state, watch);
    await ready(page, 'unanswered');
    const items = page.getByRole('list', { name: 'Unanswered messages' }).getByRole('listitem');
    const before = await items.count();
    expect(before).toBeGreaterThan(1);
    await items.first().getByRole('button', { name: 'Dismiss' }).click();
    await expect(items).toHaveCount(before - 1);
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName ?? 'none'))
      .not.toBe('BODY');

    await items.first().getByRole('button', { name: 'Add to an FAQ' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add this message to which FAQ?' });
    await expect(dialog.getByRole('searchbox', { name: 'Search FAQs' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Where is my order?' }).click();
    await expect(items).toHaveCount(before - 2);
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName ?? 'none'))
      .not.toBe('BODY');
  });

  test('deleting a FAQ from the editor goes to the list without a failed request', async ({
    browser,
    watch,
  }) => {
    const faq = await seedFaq(ws, { question: 'Delete from editor', answerText: 'Gone.' });
    const { page } = await open(browser, state, watch);
    await ready(page, faq.id);
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete this FAQ?' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('FAQ deleted.')).toBeVisible();
    await expect(page).toHaveURL(/\?tab=faqs$/);
    await expect(page.getByRole('link', { name: 'Delete from editor', exact: true })).toHaveCount(
      0,
    );
  });

  test('the leave dialog returns focus to where the person was', async ({ browser, watch }) => {
    const { page } = await open(browser, state, watch);
    await ready(page, 'new');
    await page.getByRole('textbox', { name: 'Question', exact: true }).fill('Dirty');
    const tab = page
      .getByRole('navigation', { name: 'FAQ sections' })
      .getByRole('link', { name: 'Test' });
    await tab.click();
    const dialog = page.getByRole('dialog', { name: 'Leave without saving?' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/[?&]view=new$/);
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName ?? 'none'))
      .not.toBe('BODY');
  });
});

export type { OpenOptions };
