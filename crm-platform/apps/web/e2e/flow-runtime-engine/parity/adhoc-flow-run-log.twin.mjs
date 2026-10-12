// Twin spec for the per-node run log (TW-FLR-083). Reference keeps no per-node log, so this feature has no counterpart there: run it
// with `--sides ours`, where it is judged on absolute expectations (no console or page errors, a11y, keyboard, no script execution,
// no 5xx) for the screens that show the log.
export default (h) => ({
  feature: 'adhoc:flow-run-log',
  title: 'Flow run list and run log (execution timeline)',
  pages: [
    {
      id: 'flow-runs',
      title: 'Flow runs list',
      path: '/flow-runtime',
      ready: { ours: 'main' },
      probes: h.ALL_PAGE_PROBES,
    },
    {
      id: 'flow-analytics',
      title: 'Flow analytics (history, errors, retries)',
      path: '/flow-runtime/analytics',
      ready: { ours: 'main' },
      probes: h.ALL_PAGE_PROBES,
    },
  ],
  scenarios: [
    {
      id: 'run-log.detail.timeline',
      title: 'A run opens its execution timeline, and the log API answers in the documented shape',
      tags: ['edge'],
      run: async (c) => {
        const list = await c.http('GET', '/v2/flow-runtime/runs?limit=1');
        const first = list.body?.items?.[0];
        c.obs.flag('flag.list.ok', list.status === 200);
        if (!first) {
          // A workspace with no runs has nothing to open; the timeline is covered by the API e2e (run-log.e2e.spec.ts).
          c.obs.info('no-runs', true);
          return;
        }
        const detail = await c.http('GET', `/v2/flow-runtime/runs/${first.id}`);
        c.obs.flag('flag.detail.ok', detail.status === 200);
        const body = detail.body ?? {};
        c.obs.flag('flag.detail.hasLog', Array.isArray(body.log));
        c.obs.flag(
          'flag.detail.hasTotals',
          ['nodeCount', 'errorCount', 'durationMs'].every((k) => typeof body[k] === 'number'),
        );
        c.obs.flag(
          'flag.detail.hasPathFlags',
          typeof body.flowChanged === 'boolean' && Array.isArray(body.removedNodeIds),
        );
        await c.goto(`/flow-runtime/runs/${first.id}`, { ready: 'main' });
        c.obs.flag('flag.timeline.visible', await c.visible({ text: /timeline/i }));
        // The errors-only filter must not break the screen, whatever the run holds.
        const errorsOnly = c.loc({ role: 'button', name: /errors only/i });
        if (await errorsOnly.count()) {
          await c.click({ role: 'button', name: /errors only/i });
          c.obs.flag(
            'flag.filter.keepsPage',
            await c.visible({ role: 'heading', name: /timeline/i }),
          );
        }
        // The log shows text from customers and nodes: nothing in it may run as script.
        c.obs.set('sec.timeline.xss', await c.page.evaluate(() => Boolean(window.__xss)));
      },
    },
  ],
});
