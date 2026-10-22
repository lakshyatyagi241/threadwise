import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
} from '@playwright/test';
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, type Scenario } from './scenarios.mjs';

/**
 * What makes a screenshot repeatable. Anything that changes between two runs of the same page is removed here, not tolerated by a
 * loose threshold: the clock, the language and time zone, animation, the cookie banner, loading spinners and text that is a date or
 * "5 minutes ago". A page that still differs between two runs is a flaky scenario, and `tools/visual/flake.mjs` fails the run for a P0.
 */
const cfg = loadConfig();
const BASE = process.env.WEB_URL ?? 'http://localhost:3001';
const ORG = process.env.E2E_ORG ?? 'Admin';
const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'nachiket.challawar@geta.ai',
  password: process.env.E2E_PASSWORD ?? 'Passw0rd!',
};

type State = Awaited<ReturnType<BrowserContext['storageState']>>;
let signingIn: Promise<State> | null = null;
/**
 * One sign-in per worker. Sharing one session between workers does not work: when its access token expires every context refreshes
 * with the same refresh token, the API sees a replayed token and ends the session, and the rest of the run records the sign-in page.
 * What the account pages list (the account's sessions) is therefore trimmed per page (`hide` in the config), not made to agree.
 */
export function authState(browser: Browser): Promise<State> {
  signingIn ??= (async () => {
    const ctx = await browser.newContext({ baseURL: BASE });
    const res = await ctx.request.post('/api/auth/login', {
      data: { orgSlug: ORG, email: ADMIN.email, password: ADMIN.password },
    });
    expect(res.ok(), 'sign in as the seeded admin').toBe(true);
    const state = await ctx.storageState();
    await ctx.close();
    return state;
  })();
  return signingIn;
}

export async function newContext(browser: Browser, s: Scenario) {
  const consent = encodeURIComponent(
    JSON.stringify({ necessary: true, analytics: false, marketing: false, ts: 1_767_000_000 }),
  );
  const storage = s.authed ? await authState(browser) : { cookies: [], origins: [] };
  const ctx = await browser.newContext({
    baseURL: BASE,
    viewport: { width: s.width, height: s.height },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    storageState: {
      cookies: [
        ...storage.cookies,
        {
          name: cfg.consentCookie,
          value: consent,
          domain: new URL(BASE).hostname,
          path: '/',
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: storage.origins,
    },
  });
  await ctx.clock.setFixedTime(new Date(cfg.fixedTime));
  // no randomness in what is drawn: ids, jitter and shuffles come from a fixed sequence
  await ctx.addInitScript(() => {
    let seed = 42;
    Math.random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  });
  return ctx;
}

/** Text that is a date, a clock time or a relative time becomes one fixed string of the same shape, so a moving date cannot move a pixel. */
const normalizeText = () => {
  const rules: Array<[RegExp, string]> = [
    [
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2}(?:, \d{4})?/g,
      'Jan 15, 2026',
    ],
    [/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, '15/01/2026'],
    [/\b\d{4}-\d{2}-\d{2}\b/g, '2026-01-15'],
    [/\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:AM|PM|am|pm)?/g, '09:30'],
    [/\b\d+\s?(?:s|m|h|d)\sago\b/gi, '1h ago'],
    [
      /\b(?:\d+\s(?:second|minute|hour|day|week|month|year)s?\sago|in\s\d+\s(?:second|minute|hour|day|week|month|year)s?)\b/g,
      '1 hour ago',
    ],
    [/\b(?:just now|yesterday|today)\b/gi, 'today'],
  ];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const el = node.parentElement;
    if (!el || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(el.tagName)) continue;
    let t = node.nodeValue ?? '';
    for (const [re, to] of rules) t = t.replace(re, to);
    if (t !== node.nodeValue) node.nodeValue = t;
  }
};

const FREEZE_CSS = `
  *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; scroll-behavior: auto !important; }
  [data-next-badge-root], nextjs-portal, #__next-build-watcher { display: none !important; }
`;

/** Wait until `ok()` is true on `n` polls in a row, or `ms` has passed. Never throws: a page that never settles is reported by the comparison. */
async function until(ok: () => Promise<boolean>, n: number, every: number, ms: number) {
  const end = Date.now() + ms;
  let streak = 0;
  while (Date.now() < end) {
    streak = (await ok()) ? streak + 1 : 0;
    if (streak >= n) return;
    await new Promise((r) => setTimeout(r, every));
  }
}

/**
 * Load the page and wait until it has stopped changing, then remove what moves. "Stopped" is measured, not guessed: no fetch or XHR in
 * flight for a while, every image decoded, no spinner or skeleton, and the same text and height on several polls in a row. A fixed
 * sleep would be a flaky test with a delay in it.
 */
export async function open(page: Page, url: string) {
  const inflight = new Set<Request>();
  page.on('request', (r) => {
    if (r.resourceType() === 'fetch' || r.resourceType() === 'xhr') inflight.add(r);
  });
  page.on('requestfinished', (r) => inflight.delete(r));
  page.on('requestfailed', (r) => inflight.delete(r));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load').catch(() => undefined);
  await page.addStyleTag({ content: FREEZE_CSS });
  // no data request in flight on four polls 150 ms apart
  await until(async () => inflight.size === 0, 4, 150, 12_000);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() =>
    Promise.all(
      Array.from(document.images).map((i) =>
        i.complete
          ? undefined
          : new Promise((r) => {
              i.onload = i.onerror = () => r(undefined);
            }),
      ),
    ),
  );
  const state = () =>
    page.evaluate(() => {
      const busy = document.querySelector(
        '[aria-busy="true"], [role="progressbar"], .animate-spin, [class*="skeleton" i], [data-loading="true"]',
      );
      return `${busy ? 'busy' : 'idle'}|${document.documentElement.scrollHeight}|${document.body.innerText.length}`;
    });
  let last = '';
  await until(
    async () => {
      const now = await state();
      const same = now === last && now.startsWith('idle');
      last = now;
      return same;
    },
    4,
    150,
    12_000,
  );
  await page.evaluate(normalizeText);
  const hide = cfg.hide[new URL(page.url()).pathname] ?? [];
  if (hide.length)
    await page.evaluate(
      (sels) => sels.forEach((q) => document.querySelectorAll(q).forEach((el) => el.remove())),
      hide,
    );
  await page.evaluate(() => {
    // a date field holds the date in a value, not in text
    for (const el of Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[type=date], input[type=datetime-local], input[type=time]',
      ),
    ))
      el.value =
        el.type === 'date' ? '2026-01-15' : el.type === 'time' ? '09:30' : '2026-01-15T09:30';
  });
  await page.mouse.move(0, 0);
}

/** The height to record: the whole page up to the cap, so a long list cannot make a baseline huge. */
export async function shotHeight(page: Page, viewportHeight: number) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  return Math.min(Math.max(h, viewportHeight), cfg.maxShotHeight);
}
