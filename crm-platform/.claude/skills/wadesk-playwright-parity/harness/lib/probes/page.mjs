// Page-level probes: every screen gets the same battery on both apps, no feature knowledge needed.
//   load        status, console/network noise, structure of what the user sees, timings
//   responsive  three viewports: overflow, navigation collapse, tap targets, screenshots
//   a11y        axe-core (WCAG 2.x A/AA + best practice), grouped by impact
//   keyboard    Tab traversal: reachability, traps, visible focus, skip link
//   degraded    data requests fail with 500 while the page loads: is there an error state, or a blank/forever spinner
//   auth        the page without a session: redirect to login, or protected content shown
//   perf        median of three cold-ish loads
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { median, statusClass } from '../util.mjs';
import { snapshotInPage } from '../snapshot.mjs';
import { settle } from '../sides.mjs';
import { pick } from '../util.mjs';

const require = createRequire(import.meta.url);
let AXE_SRC;
const axeSource = () => (AXE_SRC ||= readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));

const pathFor = (pg, c) => pick(pg.path, c.side) ?? pg[c.side];

// ---------------------------------------------------------------------------------------------------------------
function structureKeys(c, s) {
  const o = c.obs;
  // `ui.` keys describe structure. Differences are REVIEW items (a human/LLM looks at the screenshots), never hard failures:
  // two apps legitimately differ in how many buttons or columns they show, and some depend on the data present.
  o.set('ui.title.present', !!(s.title || '').trim());
  o.set('ui.h1.count', s.counts.h1);
  o.set('ui.lang', s.lang || '');
  o.set('ui.landmark.main', s.landmarks.main);
  o.set('ui.landmark.nav', s.landmarks.nav);
  o.set('ui.count.forms', s.counts.forms);
  o.set('ui.count.tables', s.counts.tables);
  o.set('ui.count.inputs', s.counts.inputs);
  o.set('ui.count.tabs', s.counts.tabs);
  o.set('ui.count.buttons', s.counts.buttons);
  o.set('ui.count.dialogs', s.counts.dialogs);
  s.tables.slice(0, 4).forEach((t, i) => {
    o.set(`ui.table.${i}.columns`, t.columns);
    o.set(`ui.table.${i}.sortableHeaders`, t.sortable);
    if (t.rows > 0 && !t.emptyRow) {
      // only meaningful when the table has data to look at
      o.set(`ui.table.${i}.rowActions`, t.hasRowActions);
      o.set(`ui.table.${i}.checkboxColumn`, t.hasCheckboxColumn);
    }
    o.info(`table.${i}.rows`, t.emptyRow ? 0 : t.rows);
  });
  o.set('ui.pagination.kind', s.pagination.kind);
  o.set('ui.pagination.showsTotal', s.pagination.showsTotal);
  o.set('low.brokenImages', s.counts.brokenImages);
  o.set('low.unnamedInteractive', s.counts.unnamedInteractive);
  o.info('emptyState', s.emptyState);
  o.info(
    'headings',
    s.headings.slice(0, 8).map((h) => `h${h.level}:${h.text}`),
  );
  o.info(
    'tableHeaders',
    s.tables.slice(0, 3).map((t) => t.headers),
  );
  o.info(
    'buttons',
    s.buttons.slice(0, 40).map((b) => b.name),
  );
}

function noiseKeys(c, sum) {
  const o = c.obs;
  o.set('low.consoleErrors', sum.consoleErrors);
  o.set('low.pageErrors', sum.pageErrors);
  o.set('low.failedRequests', sum.failedRequests);
  o.set('low.http4xx', sum.http4xx);
  o.set('low.http5xx', sum.http5xx);
  o.info('dataRequests', sum.dataRequests);
  o.info('websockets', sum.websockets);
}

async function timings(c) {
  return c.page
    .evaluate(
      () =>
        new Promise((resolve) => {
          const n = performance.getEntriesByType('navigation')[0];
          const base = {
            dcl: n ? Math.round(n.domContentLoadedEventEnd) : null,
            load: n ? Math.round(n.loadEventEnd) : null,
            ttfb: n ? Math.round(n.responseStart) : null,
            requests: performance.getEntriesByType('resource').length,
            bytes: Math.round(
              performance
                .getEntriesByType('resource')
                .reduce((a, r) => a + (r.transferSize || 0), 0) / 1024,
            ),
          };
          try {
            new PerformanceObserver((l) => {
              const e = l.getEntries();
              resolve({ ...base, lcp: Math.round(e[e.length - 1].startTime) });
            }).observe({ type: 'largest-contentful-paint', buffered: true });
            setTimeout(() => resolve({ ...base, lcp: null }), 600);
          } catch {
            resolve({ ...base, lcp: null });
          }
        }),
    )
    .catch(() => ({}));
}

// ---------------------------------------------------------------------------------------------------------------
async function probeLoad(c, pg) {
  const mark = c.rec.mark();
  const t0 = Date.now();
  const resp = await c.step('load page', () => c.goto(pathFor(pg, c), { ready: pg.ready }));
  const ms = Date.now() - t0;
  c.obs.status('load', resp?.status() ?? null);
  const s = await c.snap('load');
  structureKeys(c, s);
  noiseKeys(c, c.rec.summary(mark));
  const t = await timings(c);
  c.obs.set('perf.loadMs', ms);
  c.obs.set('perf.lcpMs', t.lcp ?? null);
  c.obs.info('timings', t);
  await c.shot('load');
}

async function probeResponsive(c, pg) {
  for (const vp of c.cfg.viewports) {
    const h = await c.openAlso({ viewport: vp });
    const page = h.page;
    await page.goto(c.url(pathFor(pg, c)), { waitUntil: 'load' });
    await settle(page, { quiet: c.cfg.timeouts.quiet });
    const m = await page.evaluate(() => {
      const vis = (e) => {
        const r = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const interactive = [
        ...document.querySelectorAll(
          'a[href], button, input:not([type=hidden]), select, textarea, [role=button]',
        ),
      ].filter(vis);
      const small = interactive.filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width < 24 || r.height < 24;
      }).length;
      const navLinks = [
        ...document.querySelectorAll('nav a[href], [role=navigation] a[href], aside a[href]'),
      ].filter(vis).length;
      const burger = [...document.querySelectorAll('button, [role=button]')]
        .filter(vis)
        .some((b) =>
          /menu|nav|burger|toggle/i.test(
            (b.getAttribute('aria-label') || '') +
              ' ' +
              b.className +
              ' ' +
              (b.getAttribute('aria-controls') || ''),
          ),
        );
      const el = document.documentElement;
      return {
        overflowX: el.scrollWidth > el.clientWidth + 1,
        small,
        navLinks,
        burger,
        textClipped: [...document.querySelectorAll('h1,h2,h3,button,a')]
          .filter(vis)
          .filter(
            (e) =>
              e.scrollWidth > e.clientWidth + 2 &&
              getComputedStyle(e).overflow !== 'visible' &&
              getComputedStyle(e).textOverflow !== 'ellipsis',
          ).length,
      };
    });
    c.obs.set(`low.overflowX.${vp.name}`, m.overflowX ? 1 : 0);
    c.obs.set(`low.smallTargets.${vp.name}`, m.small);
    c.obs.set(`low.clippedText.${vp.name}`, m.textClipped);
    c.obs.set(
      `ui.nav.${vp.name}`,
      m.navLinks > 0 ? 'links-visible' : m.burger ? 'collapsed' : 'none',
    );
    const file = `${c.shotsDir}/${c.side}-responsive-${vp.name}.png`;
    await page.screenshot({ path: file }).catch(() => {});
    c.shots.push({ label: `responsive-${vp.name}`, side: c.side, file });
    await c.sideObj.release(h);
    c.extraHandles = c.extraHandles.filter((x) => x !== h);
  }
}

async function probeA11y(c, pg) {
  await c.goto(pathFor(pg, c), { ready: pg.ready });
  await c.page.evaluate(axeSource());
  const res = await c.page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, {
      resultTypes: ['violations'],
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
      },
    });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact || 'minor',
      nodes: v.nodes.length,
    }));
  });
  const by = (imp) => res.filter((v) => v.impact === imp).length;
  c.obs.set('low.a11y.critical', by('critical'));
  c.obs.set('low.a11y.serious', by('serious'));
  c.obs.set('low.a11y.moderate', by('moderate'));
  c.obs.set('low.a11y.minor', by('minor'));
  c.obs.set(
    'lowset.a11y.rules',
    [
      ...new Set(res.filter((v) => ['critical', 'serious'].includes(v.impact)).map((v) => v.id)),
    ].sort(),
  );
  c.obs.info(
    'a11y.all',
    res.map((v) => `${v.id}(${v.impact},${v.nodes})`),
  );
}

async function probeKeyboard(c, pg) {
  await c.goto(pathFor(pg, c), { ready: pg.ready });
  await c.page.evaluate(() => {
    document.activeElement?.blur?.();
    window.scrollTo(0, 0);
  });
  const visited = new Map();
  let last = '';
  let stuck = 0;
  let focusVisible = 0;
  let stops = 0;
  const sig = () =>
    c.page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body || e === document.documentElement) return null;
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      const fv =
        (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ||
        (cs.boxShadow && cs.boxShadow !== 'none') ||
        e.matches(':focus-visible');
      return {
        key: `${e.tagName}|${Math.round(r.left)}|${Math.round(r.top)}|${(e.getAttribute('aria-label') || e.innerText || e.name || '').slice(0, 20)}`,
        visible: r.width > 0 && r.height > 0,
        fv: !!fv,
        text: (e.getAttribute('aria-label') || e.innerText || e.getAttribute('name') || '')
          .trim()
          .slice(0, 30),
      };
    });
  const MAX = 90;
  for (let i = 0; i < MAX; i++) {
    await c.page.keyboard.press('Tab');
    const s = await sig();
    if (!s) break; // focus left the document: one full cycle
    if (s.key === last) {
      if (++stuck >= 3) break;
    } else stuck = 0;
    last = s.key;
    if (visited.has(s.key)) break;
    visited.set(s.key, s);
    stops += 1;
    if (s.fv) focusVisible += 1;
  }
  const total = await c.page.evaluate(() => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    return [
      ...document.querySelectorAll(
        'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter(vis).length;
  });
  const first = [...visited.values()][0];
  c.obs.set(
    'abs.keyboard.reachable',
    total ? Math.min(1, Math.round((stops / total) * 100) / 100) : 1,
  );
  c.obs.set(
    'abs.keyboard.focusVisible',
    stops ? Math.round((focusVisible / stops) * 100) / 100 : 1,
  );
  c.obs.set('low.keyboard.trap', stuck >= 3 ? 1 : 0);
  c.obs.flag('keyboard.skipLink', !!first && /skip/i.test(first.text));
  c.obs.info('keyboard.stops', stops);
  c.obs.info('keyboard.interactive', total);
}

async function probeDegraded(c, pg) {
  let hit = 0;
  const undo = await c.failRequests((r) => {
    const m = ['xhr', 'fetch'].includes(r.resourceType());
    if (m) hit += 1;
    return m;
  }, 500);
  const mark = c.rec.mark();
  await c.goto(pathFor(pg, c));
  await c.page.waitForTimeout(1500);
  await undo();
  if (!hit) {
    c.obs.info('degraded', 'no data requests while loading (server-rendered): nothing to degrade');
    return;
  }
  const st = await c.page.evaluate(() => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const main = document.querySelector('main, [role=main]') || document.body;
    const live = [
      ...document.querySelectorAll(
        '[role=alert], [role=status], [class*=toast], [class*=error], [class*=alert]',
      ),
    ].some((e) => vis(e) && e.textContent.trim().length > 2);
    const textual =
      /(error|failed|try again|went wrong|unable|couldn.?t|could not|offline|retry)/i.test(
        main.innerText || '',
      );
    const spinner = [
      ...document.querySelectorAll(
        '[aria-busy=true], [role=progressbar], [class*=spinner], [class*=skeleton], [class*=animate-spin], [class*=loading]',
      ),
    ].some(vis);
    return {
      errorShown: live || textual,
      spinner,
      blank: (main.innerText || '').trim().length < 15,
    };
  });
  c.obs.set('abs.degraded.errorShown', st.errorShown);
  c.obs.set('low.degraded.spinnerStuck', st.spinner ? 1 : 0);
  c.obs.set('low.degraded.blankPage', st.blank ? 1 : 0);
  c.obs.set('low.degraded.pageErrors', c.rec.since(mark).pageErrors.length);
  await c.shot('degraded');
}

async function probeAuth(c, pg) {
  if (pg.public) {
    c.obs.info('auth', 'public page');
    return;
  }
  const h = await c.openAlso({ loggedIn: false });
  const mark = h.rec.mark();
  const resp = await h.page.goto(c.url(pathFor(pg, c)), { waitUntil: 'load' }).catch(() => null);
  await settle(h.page, { quiet: c.cfg.timeouts.quiet });
  const path = new URL(h.page.url()).pathname;
  const toLogin =
    /login|sign-?in|auth|session/i.test(path) ||
    (await h.page.locator('input[type=password]').count()) > 0;
  const status = resp?.status() ?? null;
  const kind = toLogin
    ? 'redirect-login'
    : status === 401 || status === 403
      ? 'forbidden'
      : status === 404
        ? 'not-found'
        : 'content-visible';
  c.obs.enum('unauthenticated', kind);
  c.obs.set('sec.unauthContentVisible', kind === 'content-visible');
  void mark;
  await c.sideObj.release(h);
  c.extraHandles = c.extraHandles.filter((x) => x !== h);
}

async function probePerf(c, pg) {
  const loads = [];
  const lcps = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    await c.goto(pathFor(pg, c), { ready: pg.ready });
    loads.push(Date.now() - t0);
    const t = await timings(c);
    if (t.lcp) lcps.push(t.lcp);
  }
  c.obs.set('perf.loadMs', median(loads));
  c.obs.set('perf.lcpMs', median(lcps));
  c.obs.info('perf.samples', loads);
}

export const PAGE_PROBES = {
  load: probeLoad,
  responsive: probeResponsive,
  a11y: probeA11y,
  keyboard: probeKeyboard,
  degraded: probeDegraded,
  auth: probeAuth,
  perf: probePerf,
};
export const DEFAULT_PAGE_PROBES = [
  'load',
  'responsive',
  'a11y',
  'keyboard',
  'degraded',
  'auth',
  'perf',
];
export const QUICK_PAGE_PROBES = ['load', 'a11y', 'auth'];

export function pageScenarios(pg, { depth = 'full' } = {}) {
  let wanted = pg.probes || (depth === 'quick' ? QUICK_PAGE_PROBES : DEFAULT_PAGE_PROBES);
  if (pg.public) wanted = wanted.filter((n) => n !== 'auth'); // a public page has no "without a session" case
  return wanted.map((name) => ({
    loggedIn: !pg.public, // public pages (login, signup) are opened without a session
    id: `${pg.id}.${name}`,
    title: `${pg.title || pg.id}: ${name}`,
    feature: pg.feature,
    tags: ['page', name, ...(pg.tags || [])],
    needsUi: true,
    run: async (c) => {
      const fn = PAGE_PROBES[name];
      if (!fn) throw new Error(`unknown page probe "${name}"`);
      return fn(c, pg);
    },
  }));
}

export { statusClass, snapshotInPage };
