// WD-DASH-003 twin: dashboard date-range window. WaDesk has four ranges; ours adds a custom From/To range (intended).
// Page probes run on both apps; the custom-range scenarios run on ours only (WaDesk has no such control).
const API = /\/dashboard\/(summary|widgets|throughput)/;

const customRun = (name, query, expect) => async (c) => {
  const seen = [];
  c.page.on('response', (r) => API.test(r.url()) && seen.push({ s: r.status(), u: r.url() }));
  await c.goto(`/dashboard?range=custom${query}`, { ready: 'main' });
  await c.page.waitForTimeout(1500);
  c.obs.status(`status.${name}.api`, seen.length ? Math.max(...seen.map((x) => x.s)) : 0);
  c.obs.flag(
    `flag.${name}.has-date-inputs`,
    (await c.page.locator('input[type=date]').count()) === 2,
  );
  c.obs.flag(`flag.${name}.error-shown-or-ok`, expect(seen));
  const xss = await c.page.evaluate(() => Boolean(window.__xss));
  c.obs.set('sec.xss', xss);
};

export default (h) => ({
  feature: 'WD-DASH-003',
  title: 'Dashboard date range with custom From/To',
  pages: [
    {
      id: 'dashboard',
      title: 'Operator dashboard',
      path: '/dashboard',
      ready: { wadesk: 'body', ours: 'main' },
      probes: h.ALL_PAGE_PROBES,
    },
  ],
  scenarios: [
    [
      'valid',
      '&from=2026-10-01&to=2026-10-05',
      (s) => s.length >= 3 && s.every((x) => x.s === 200),
    ],
    ['reversed', '&from=2026-10-05&to=2026-10-01', (s) => s.every((x) => x.s === 200)],
    ['future-to', '&from=2026-10-01&to=2099-01-01', (s) => s.every((x) => x.s === 200)],
    ['no-dates', '', (s) => s.every((x) => x.s === 200)],
    ['too-long', '&from=2000-01-01&to=2026-10-01', (s) => s.some((x) => x.s === 422)],
    [
      'garbage',
      '&from=nope&to=%27%3E%3Cimg%20src%3Dx%20onerror%3Dwindow.__xss%3D1%3E',
      (s) => s.every((x) => x.s === 200),
    ],
  ].map(([name, q, ok]) => ({
    id: `dash-custom.${name}`,
    title: `Custom range: ${name}`,
    tags: ['edge'],
    run: {
      ours: customRun(name, q, ok),
      wadesk: async (c) => c.obs.info('n/a', 'no custom range in WaDesk'),
    },
  })),
  intended: [
    {
      scenario: /^dashboard\.keyboard$/,
      key: 'abs.keyboard.focusVisible',
      quirk: 'the stop without a ring is the Next.js dev-tools overlay element',
      reason:
        'dev server only: the overlay is not part of the app and does not exist in a production build',
    },
  ],
  skip: [
    {
      scenario: /^dash-custom\./,
      side: 'wadesk',
      reason: 'WaDesk has no custom date range; compared against absolute expectations',
    },
  ],
});
