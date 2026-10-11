// Twin spec for the admin Financial dashboard (TW-PLAN-026): page probes plus one scenario that counts how often the
// chart legend labels and the panel headings appear. Reads only; nothing is created or changed on either side.
export default () => {
  const exactCount = (c, text) =>
    c.page.evaluate((t) => {
      const root = document.querySelector('main, .content, body') || document.body;
      let n = 0;
      for (const el of root.querySelectorAll('*')) {
        if (el.children.length === 0 && (el.textContent || '').trim().toLowerCase() === t) n++;
      }
      return n;
    }, text);

  return {
    feature: 'TW-PLAN-026',
    title: 'Admin Financial dashboard: probes, legend appears once per chart, panels present',
    pages: [
      {
        id: 'financial',
        title: 'Financial dashboard',
        path: '/admin/financial',
        ready: { threadwise: 'main, .content, body', ours: 'main h1' },
        probes: ['load', 'responsive', 'a11y', 'keyboard', 'auth'],
      },
    ],
    scenarios: [
      {
        id: 'financial.legend-once',
        title: 'Revenue and Refunds labels are not repeated by a second legend under the chart',
        run: async (c) => {
          await c.goto('/admin/financial', {
            ready: { threadwise: 'main, .content, body', ours: 'main h1' },
          });
          await c.afterAction({ quiet: 800 });
          c.obs.num('num.label.refunds', await exactCount(c, 'refunds'));
          c.obs.num('num.label.revenue', await exactCount(c, 'revenue'));
        },
      },
      {
        id: 'financial.panels',
        title: 'The dashboard shows the same panels',
        run: async (c) => {
          await c.goto('/admin/financial', {
            ready: { threadwise: 'main, .content, body', ours: 'main h1' },
          });
          const body = ((await c.page.locator('body').innerText()) || '').toLowerCase();
          for (const p of ['payment methods', 'order status', 'top paying workspaces'])
            c.obs.flag(`panel.${p}`, body.includes(p));
          c.obs.flag(
            'panel.latest orders',
            body.includes('latest orders') || body.includes('recent orders'),
          );
        },
      },
    ],
    intended: [
      {
        scenario: /keyboard$/,
        key: 'flag.keyboard.skipLink',
        quirk: 'Reference console has no skip-to-content link',
        reason:
          'ours adds a skip link on every console page; a deliberate improvement over Reference',
      },
      {
        scenario: /^financial\.legend-once$/,
        key: /^num\.num\.label\./,
        quirk:
          'empty revenue window: Reference still draws axes and a legend, ours shows a "No data" state',
        reason:
          'with no paid orders our chart panel shows its empty state and no legend; the counts only line up on a window with orders, which the twin run data does not have',
      },
      {
        scenario: /keyboard$/,
        key: 'abs.keyboard.focusVisible',
        quirk: 'our web app runs in next dev for the twin run',
        reason:
          'the one tab stop without a focus ring is the next dev overlay button (a nextjs-portal element); it does not exist in a production build',
      },
      {
        scenario: /\.load$/,
        key: 'perf.lcpMs',
        quirk: 'our web app runs in next dev for the twin run',
        reason:
          'first paint includes the dev-server compile; a production build is not what is measured',
      },
    ],
    skip: [],
  };
};
