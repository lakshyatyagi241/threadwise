// WD-CON-020 twin: Import and export history (Settings > Data and security). WaDesk has no such screen in the workspace
// settings, so the scenarios run on ours only (absolute expectations).
const na = async (c) => c.obs.info('n/a', 'no counterpart');

export default (h) => ({
  feature: 'WD-CON-020',
  title: 'Import and export history',
  pages: [
    {
      id: 'import-export',
      title: 'Import and export',
      path: { wadesk: '/contacts', ours: '/import-export' },
      ready: { wadesk: 'body', ours: 'main' },
      probes: ['load', 'a11y', 'auth', 'degraded'],
    },
  ],
  scenarios: [
    {
      id: 'history.tile-and-page',
      title: 'The Settings tile is live (not Soon) and opens a page with Imports and Exports',
      tags: ['ours'],
      run: {
        wadesk: na,
        ours: async (c) => {
          await c.goto('/settings/security', { ready: 'main' });
          const tile = c.page.getByRole('link', { name: /Import and export/i });
          c.obs.flag('flag.tile.is-link', (await tile.count()) >= 1);
          await c.goto('/import-export', { ready: 'main' });
          await c.page.getByRole('heading', { name: 'Import and export', level: 1 }).waitFor();
          c.obs.flag(
            'flag.page.imports-panel',
            (await c.page.getByRole('heading', { name: 'Imports' }).count()) === 1,
          );
          c.obs.flag(
            'flag.page.exports-panel',
            (await c.page.getByRole('heading', { name: 'Exports' }).count()) === 1,
          );
          c.obs.flag(
            'flag.page.import-button',
            (await c.page.getByRole('button', { name: 'Import contacts' }).count()) === 1,
          );
          c.obs.set('sec.xss', false);
        },
      },
    },
    {
      id: 'history.export-appears',
      title: 'An export taken now shows up in the Exports list',
      tags: ['ours', 'write'],
      run: {
        wadesk: na,
        ours: async (c) => {
          const r = await c.http('POST', '/v2/contacts/export', {
            data: { filter: {}, bom: false },
          });
          c.obs.status('status.export', r.status);
          await c.goto('/import-export', { ready: 'main' });
          await c.page.waitForTimeout(1500);
          const rows = await c.page
            .locator(
              'h2:has-text("Exports") >> xpath=ancestor::div[contains(@class,"rounded-xl")][1]',
            )
            .locator('tbody tr')
            .count();
          c.obs.flag('flag.exports.has-row', rows >= 1);
          c.obs.flag(
            'flag.exports.scope-text',
            (await c.page.getByText('Everything matching').count()) >= 1,
          );
          c.obs.set('sec.xss', false);
        },
      },
    },
  ],
  skip: [
    {
      scenario: /^history\./,
      side: 'wadesk',
      reason:
        'WaDesk has no import or export history screen; compared against absolute expectations',
    },
  ],
});
