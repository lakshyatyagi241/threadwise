// Pipelines and stages settings: Reference has no stage editor screen (its /deals/settings is a POST handler), so this
// runs on our side only (`--sides ours`), judged on absolute expectations. Behaviour checked: the stage rows keep
// their columns aligned, nothing overflows the card at common widths, and the probability / deal count are labelled.
const WIDTHS = [375, 768, 1024, 1440];

export default (h) => ({
  feature: 'adhoc:pipeline-stage-layout',
  title: 'Pipelines and stages: stage row layout',
  pages: [
    {
      id: 'deals-settings',
      title: 'Pipelines and stages',
      path: '/deals/settings',
      ready: { ours: 'input[aria-label="Stage name"]' },
      probes: h.ALL_PAGE_PROBES,
    },
  ],
  scenarios: [
    {
      id: 'stage-row.layout.alignment-and-overflow',
      title: 'Stage rows align by column and stay inside the card',
      tags: ['layout'],
      run: async (c) => {
        const o = c.obs;
        await c.goto('/deals/settings', { ready: 'input[aria-label="Stage name"]' });
        const measure = () =>
          c.page.evaluate(() => {
            const rows = [...document.querySelectorAll('input[aria-label="Stage name"]')].map((i) =>
              i.closest('li'),
            );
            const left = (el) => Math.round(el.getBoundingClientRect().left);
            const cols = rows.map((li) => ({
              kind: left(li.querySelector('select[aria-label]')),
              prob: left(li.querySelector('input[type=number]')),
              count: left([...li.querySelectorAll('span')].find((s) => /deal/.test(s.textContent))),
              overflow:
                li.getBoundingClientRect().right <
                li.querySelector('button[aria-label^="Delete stage"]').getBoundingClientRect()
                  .right,
            }));
            return { rows: rows.length, cols };
          });
        const problems = [];
        for (const w of WIDTHS) {
          await c.page.setViewportSize({ width: w, height: 900 });
          await c.page.waitForTimeout(300);
          const m = await measure();
          if (m.rows < 2) problems.push(`${w}: fewer than two stage rows to compare`);
          if (m.cols.some((x) => x.overflow)) problems.push(`${w}: delete button outside the card`);
          // columns are a grid from md up; below md the rows wrap, so alignment is only required at md and above
          if (w >= 768) {
            for (const k of ['kind', 'prob', 'count']) {
              if (new Set(m.cols.map((x) => x[k])).size > 1)
                problems.push(`${w}: ${k} column not aligned`);
            }
          }
          const doc = await c.page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          );
          if (doc > 0) problems.push(`${w}: page scrolls sideways by ${doc}px`);
        }
        o.set('lowset.stage-row.layout', problems);
      },
    },
    {
      id: 'stage-row.labels.probability-and-count',
      title:
        'The win probability has a visible label next to the percent box (header from md, inline below)',
      tags: ['ux'],
      run: async (c) => {
        const o = c.obs;
        await c.goto('/deals/settings', { ready: 'input[aria-label="Stage name"]' });
        const visibleLabel = async (w) => {
          await c.page.setViewportSize({ width: w, height: 900 });
          await c.page.waitForTimeout(300);
          return c.page.evaluate(() =>
            [...document.querySelectorAll('main *')].some(
              (e) =>
                e.children.length === 0 &&
                /^Win probability$/.test(e.textContent.trim()) &&
                e.getClientRects().length > 0,
            ),
          );
        };
        o.flag('flag.label.visible.375', await visibleLabel(375));
        o.flag('flag.label.visible.1024', await visibleLabel(1024));
      },
    },
  ],
});
