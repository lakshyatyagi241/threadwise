import { test, type BrowserContext, type Page } from '@playwright/test';
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkLayout, settle, severityOf, type Defect } from './layout-checks';

/**
 * Responsive layout (QA task 20): every static page of the web app at 360, 390, 768, 1024, 1440 and 1920 px wide, loaded fresh at each
 * width and checked for layout defects: sideways page scroll, a control that cannot be reached, content cut off by the screen, a control
 * covered by something else, a broken image, an error screen. Severity rules are in `layout-checks.ts`; a P0 or P1 defect fails the route.
 *
 *   HEADLESS=1 WEB_URL=http://localhost:3001 pnpm --filter @crm/web exec playwright test e2e/responsive
 *   RESPONSIVE_FILTER=contacts ...       only routes containing that text
 *   RESPONSIVE_ROUTES=/a,/b ...          only exactly these routes (to re-check the ones that failed)
 *   RESPONSIVE_WIDTHS=360,1440 ...       only these widths (a quick pass)
 *   RESPONSIVE_SCOPE=public|authed ...   only pages that need no sign-in, or only those that do (default all)
 *   RESPONSIVE_OUT=/path/results.jsonl   where every defect is written, one JSON line each (default /tmp/responsive-results.jsonl)
 *
 * Routes are generated from `src/app/**\/page.tsx`, so a new page is covered the day it is added. Dynamic pages (`[id]`, `[token]`) need
 * real data and are not generated; the report counts how many are left out. Needs the running stack and the seeded workspace.
 */
const cfg = JSON.parse(
  readFileSync(join(process.cwd(), 'e2e/responsive/responsive.config.json'), 'utf8'),
) as {
  widths: Array<{ width: number; height: number }>;
  skipGroups: string[];
  authedGroups: string[];
  known: Record<string, string>;
};
// RESPONSIVE_WIDTHS=360,1440 limits a run to those widths (a quick pass); the default is all six
const onlyWidths = process.env.RESPONSIVE_WIDTHS?.split(',').map(Number);
if (onlyWidths) cfg.widths = cfg.widths.filter((w) => onlyWidths.includes(w.width));
const BASE = process.env.WEB_URL ?? 'http://localhost:3001';
const OUT = process.env.RESPONSIVE_OUT ?? '/tmp/responsive-results.jsonl';
const ADMIN = {
  org: process.env.E2E_ORG ?? 'Admin',
  email: process.env.E2E_ADMIN_EMAIL ?? 'nachiket.challawar@geta.ai',
  password: process.env.E2E_PASSWORD ?? 'Passw0rd!',
};

type Route = { url: string; authed: boolean };

function discover(): Route[] {
  const root = join(process.cwd(), 'src/app');
  const out: Route[] = [];
  const walk = (dir: string, segs: string[]) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name), [...segs, e.name]);
      else if (e.name === 'page.tsx') {
        if (segs.some((s) => cfg.skipGroups.includes(s) || s.includes('[') || s === 'api'))
          continue;
        out.push({
          url: '/' + segs.filter((s) => !/^\(.*\)$/.test(s)).join('/'),
          authed: segs.some((s) => cfg.authedGroups.includes(s)),
        });
      }
    }
  };
  walk(root, []);
  const only = process.env.RESPONSIVE_ROUTES?.split(',').filter(Boolean);
  const filter = process.env.RESPONSIVE_FILTER;
  const scope = process.env.RESPONSIVE_SCOPE ?? 'all';
  return out
    .sort((a, b) => a.url.localeCompare(b.url))
    .filter((r) => !filter || r.url.includes(filter))
    .filter((r) => !only || only.includes(r.url))
    .filter((r) => scope === 'all' || (scope === 'public') === !r.authed);
}

let signedIn: { at: number; state: Awaited<ReturnType<BrowserContext['storageState']>> } | null =
  null;
async function authState(browser: import('@playwright/test').Browser) {
  // one sign-in, renewed every 10 minutes: the API caps concurrent sessions per account
  if (signedIn && Date.now() - signedIn.at < 10 * 60_000) return signedIn.state;
  const ctx = await browser.newContext({ baseURL: BASE });
  const res = await ctx.request.post('/api/auth/login', {
    data: { orgSlug: ADMIN.org, email: ADMIN.email, password: ADMIN.password },
  });
  if (!res.ok()) throw new Error(`sign in failed: ${res.status()}`);
  const state = await ctx.storageState();
  await ctx.close();
  signedIn = { at: Date.now(), state };
  return state;
}

for (const route of discover()) {
  test(`${route.authed ? 'signed in' : 'public'} ${route.url}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const found: Defect[] = [];
    const ctx = await browser.newContext({
      baseURL: BASE,
      viewport: { width: cfg.widths[0]!.width, height: cfg.widths[0]!.height },
      storageState: route.authed ? await authState(browser) : undefined,
    });
    const page: Page = await ctx.newPage();
    try {
      for (const w of cfg.widths) {
        await page.setViewportSize({ width: w.width, height: w.height });
        await page.goto(route.url, { waitUntil: 'domcontentloaded' });
        await settle(page);
        for (const d of await checkLayout(page, w.width)) found.push({ ...d, width: w.width });
      }
    } finally {
      await ctx.close();
    }
    const rows = found.map((d) => ({
      route: route.url,
      authed: route.authed,
      ...d,
      severity: severityOf(d),
    }));
    for (const r of rows) appendFileSync(OUT, JSON.stringify(r) + '\n');
    appendFileSync(
      OUT,
      JSON.stringify({
        route: route.url,
        authed: route.authed,
        checked: cfg.widths.map((w) => w.width),
      }) + '\n',
    );
    const blocking = rows.filter((r) => r.severity === 'P0' || r.severity === 'P1');
    const allowed = cfg.known[route.url];
    test.info().annotations.push({
      type: 'defects',
      description: `${rows.length} (${blocking.length} P0/P1)`,
    });
    if (blocking.length && !allowed) {
      const lines = blocking
        .slice(0, 12)
        .map((r) => `${r.severity} @${r.width}px ${r.kind}: ${r.detail}`);
      throw new Error(
        `${blocking.length} P0/P1 layout defect(s) on ${route.url}:\n${lines.join('\n')}`,
      );
    }
  });
}
