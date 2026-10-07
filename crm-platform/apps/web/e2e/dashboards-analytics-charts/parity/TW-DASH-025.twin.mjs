// TW-DASH-025 twin: Engagement funnel (analytics + dashboard card). Page probes run on both apps; the funnel-shape checks run on ours
// only (the tapered-band graph is a deliberate redesign of Reference's stacked rows, so there is nothing to compare shape against).
const shapeRun = (path, vp) => async (c) => {
  await c.goto(path, { ready: 'main' });
  const funnel = c.page.locator('[data-testid="engagement-funnel"]').first();
  await funnel.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  const found = (await funnel.count()) > 0;
  c.obs.flag('flag.funnel.present', found);
  if (!found) return;
  const info = await funnel.evaluate((el) => {
    const items = [...el.querySelectorAll('ol > li')];
    const bands = items.map((li) => li.querySelector('[style*="clip-path"]'));
    const widths = bands.map((b) => (b ? b.getBoundingClientRect().width : 0));
    const clips = bands.map((b) => (b ? b.style.clipPath : ''));
    const box = el.getBoundingClientRect();
    return {
      stages: items.length,
      allBands: bands.every(Boolean),
      trapezoid: clips.every((p) => /^polygon\(([^,]+,){3}[^,]+\)$/.test(p)),
      sameWidth: widths.every((w) => Math.abs(w - widths[0]) < 1),
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      clipped: el.scrollWidth > box.width + 1,
      text: el.innerText,
    };
  });
  c.obs.set('count.funnel.stages', info.stages);
  c.obs.flag('flag.funnel.every-stage-has-band', info.allBands);
  c.obs.flag('flag.funnel.bands-are-trapezoids', info.trapezoid);
  c.obs.flag('flag.funnel.bands-share-row-width', info.sameWidth);
  c.obs.flag(`flag.funnel.no-page-overflow.${vp}`, !info.overflowX);
  c.obs.flag(`flag.funnel.no-card-clip.${vp}`, !info.clipped);
  c.obs.flag('flag.funnel.shows-percent', /\d+(\.\d)?%/.test(info.text));
  c.obs.flag('flag.funnel.shows-activity', /inbound messages/i.test(info.text));
};

export default (h) => ({
  feature: 'TW-DASH-025',
  title: 'Engagement funnel graph (analytics and dashboard)',
  pages: [
    {
      id: 'analytics',
      title: 'Analytics (funnel card)',
      path: '/analytics',
      ready: { threadwise: 'body', ours: 'main' },
      probes: h.ALL_PAGE_PROBES,
    },
    {
      id: 'dashboard',
      title: 'Dashboard (funnel card)',
      path: '/dashboard',
      ready: { threadwise: 'body', ours: 'main' },
      probes: h.ALL_PAGE_PROBES,
    },
  ],
  scenarios: [
    ['analytics-desktop', '/analytics', 'desktop'],
    ['dashboard-desktop', '/dashboard', 'desktop'],
  ].map(([id, path, vp]) => ({
    id: `funnel.shape.${id}`,
    title: `Funnel graph structure: ${id}`,
    tags: ['edge'],
    run: {
      ours: shapeRun(path, vp),
      threadwise: async (c) =>
        c.obs.info('n/a', 'Reference draws plain stacked rows, shape not comparable'),
    },
  })),
  intended: [
    {
      scenario: /\.keyboard$/,
      key: 'abs.keyboard.focusVisible',
      quirk: 'the stop without a ring is the Next.js dev-tools overlay element',
      reason:
        'dev server only: the overlay is not part of the app and does not exist in a production build',
    },
  ],
  skip: [
    {
      scenario: /^funnel\.shape\./,
      side: 'threadwise',
      reason:
        'tapered-band graph is a deliberate redesign; judged against absolute expectations on ours',
    },
  ],
});
