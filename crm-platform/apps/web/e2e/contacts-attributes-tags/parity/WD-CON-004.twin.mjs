// WD-CON-004 twin: the Contact Hub filters. WaDesk offers fixed filters only (stage, consent, tag, group); ours adds ad-hoc
// conditions and groups ("Add condition", the segment rule builder). Page probes run on both apps; the condition scenarios
// run on ours only.
const listCalls = (c) => {
  const seen = [];
  c.page.on(
    'response',
    (r) =>
      /\/contacts\?/.test(r.url()) && seen.push({ s: r.status(), u: decodeURIComponent(r.url()) }),
  );
  return seen;
};

export default (h) => ({
  feature: 'WD-CON-004',
  title: 'Contact Hub: conditions and groups as a filter',
  pages: [
    {
      id: 'contacts-hub',
      title: 'Contact Hub',
      path: { wadesk: '/contacts', ours: '/contacts' },
      ready: { wadesk: 'table', ours: 'main' },
      probes: h.ALL_PAGE_PROBES,
    },
  ],
  scenarios: [
    {
      id: 'conditions.panel-apply-clear',
      title:
        'Add condition opens the builder; Apply refetches with the conditions; Clear removes them',
      tags: ['ours'],
      run: {
        wadesk: async (c) => c.obs.info('n/a', 'WaDesk has fixed filters only'),
        ours: async (c) => {
          await c.goto('/contacts', { ready: 'main' });
          const seen = listCalls(c);
          await c.page.getByRole('button', { name: 'Add condition' }).click();
          const panel = c.page.locator('#hub-advanced-filter');
          await panel.waitFor();
          c.obs.flag('flag.panel.opens', await panel.isVisible());
          // an empty builder opens with one condition ready: Stage equals ...; pick the first real value
          await panel.getByLabel('Value of condition 1').waitFor();
          c.obs.flag('flag.panel.row-ready', (await panel.locator('select').count()) >= 3);
          await panel.getByLabel('Value of condition 1').selectOption({ index: 1 });
          await panel.getByRole('button', { name: 'Apply' }).click();
          await c.page.waitForTimeout(1800);
          const withRules = seen.filter((x) => /[?&]rules=/.test(x.u));
          c.obs.flag('flag.apply.sent-to-server', withRules.length > 0);
          c.obs.status('status.apply.api', Math.max(0, ...withRules.map((x) => x.s)));
          c.obs.flag('flag.apply.in-url', /rules=/.test(decodeURIComponent(c.page.url())));
          c.obs.flag(
            'flag.apply.badge',
            (await c.page.getByRole('button', { name: /^Conditions/ }).count()) === 1,
          );
          await c.page.getByRole('button', { name: /^Conditions/ }).click();
          await c.page
            .locator('#hub-advanced-filter')
            .getByRole('button', { name: 'Clear conditions' })
            .click();
          await c.page.waitForTimeout(1200);
          c.obs.flag('flag.clear.url-clean', !/rules=/.test(decodeURIComponent(c.page.url())));
          c.obs.set('sec.xss', false);
        },
      },
    },
    {
      id: 'conditions.bad-rules-url',
      title: 'A hand-edited rules value never breaks the page',
      tags: ['ours', 'edge'],
      run: {
        wadesk: async (c) => c.obs.info('n/a', 'no counterpart'),
        ours: async (c) => {
          const seen = listCalls(c);
          await c.goto('/contacts?rules=not-json', { ready: 'main' });
          c.obs.flag('flag.bad.table-still-renders', (await c.page.locator('main').count()) > 0);
          await c.goto('/contacts?rules=' + encodeURIComponent('{"type":"nope"}'), {
            ready: 'main',
          });
          await c.page.waitForTimeout(1500);
          c.obs.status(
            'status.bad.api-never-5xx',
            Math.max(0, ...seen.map((x) => x.s)) >= 500 ? 500 : 200,
          );
          c.obs.flag('flag.bad.page-alive', (await c.page.locator('main').count()) > 0);
          c.obs.set('sec.xss', false);
        },
      },
    },
  ],
  skip: [
    {
      scenario: /^conditions\./,
      side: 'wadesk',
      reason:
        'WaDesk has fixed filters only (no conditions or groups); compared against absolute expectations',
    },
  ],
});
