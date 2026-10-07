// Inbox status filter: one Resolved (no Closed), "Open" first. WaDesk lists Open and Pending together; the structure differs, so the
// scenario runs on ours only (absolute expectations); the page probes run on both.
export default (h) => ({
  feature: 'WD-TIB1-001',
  title: 'Inbox status filter',
  pages: [
    {
      id: 'inbox',
      title: 'Inbox',
      path: { wadesk: '/team-inbox', ours: '/inbox' },
      ready: { wadesk: 'body', ours: 'main' },
      probes: ['load', 'auth'],
    },
  ],
  scenarios: [
    {
      id: 'inbox.status-options',
      title: 'The status filter reads Open first, has one Resolved and no Closed',
      tags: ['ours'],
      run: {
        wadesk: async (c) => c.obs.info('n/a', 'different filter'),
        ours: async (c) => {
          await c.goto('/inbox', { ready: 'main' });
          const select = c.page.getByLabel('Status', { exact: true });
          await select.waitFor({ timeout: 10000 });
          const opts = await select.locator('option').allInnerTexts();
          c.obs.flag('flag.status.open-first', opts[0] === 'Open');
          c.obs.flag('flag.status.one-resolved', opts.filter((o) => o === 'Resolved').length === 1);
          c.obs.flag('flag.status.no-closed', !opts.includes('Closed'));
          c.obs.flag('flag.status.no-open-and-pending', !opts.includes('Open and pending'));
          c.obs.set('sec.xss', false);
        },
      },
    },
  ],
  skip: [
    {
      scenario: /^inbox\./,
      side: 'wadesk',
      reason: 'WaDesk has its own filter; compared against absolute expectations',
    },
  ],
});
