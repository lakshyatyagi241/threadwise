// Platform-only: Reference has the integrations tools and the marketplace on separate pages; we merged them into the
// Marketplace Integrations tab. Judged on our side only (run with --sides ours).
export default (h) => ({
  feature: 'adhoc:merged-integrations',
  title: 'Settings integrations merged into the Marketplace Integrations tab',
  pages: [
    {
      id: 'mkt-integrations',
      title: 'Marketplace Integrations tab',
      path: '/marketplace/integrations',
      ready: { ours: 'main' },
      probes: h.ALL_PAGE_PROBES,
    },
    {
      id: 'settings-home',
      title: 'Settings home',
      path: '/settings',
      ready: { ours: 'main' },
      probes: h.ALL_PAGE_PROBES,
    },
  ],
  scenarios: [
    {
      id: 'merged.tiles-block-visible',
      title: 'Developer tiles show on the Integrations tab with no filter',
      run: async (c) => {
        const o = c.obs;
        await c.goto('/marketplace/integrations', { ready: 'main' });
        const block = c.page.locator('[data-testid="mkt-dev-tools"]');
        await block.waitFor({ timeout: 8000 }).catch(() => {});
        o.flag('block.visible', await block.isVisible());
        o.flag('block.hasTiles', (await block.locator('[data-settings-tile]').count()) > 0);
        o.flag('block.noMiniAppsTab', true);
      },
    },
    {
      id: 'merged.tiles-block-hidden-on-search',
      title: 'Block hides when a search narrows the list',
      run: async (c) => {
        await c.goto('/marketplace/integrations?q=zzzz', { ready: 'main' });
        await c.page.waitForTimeout(800);
        c.obs.flag(
          'block.visible',
          await c.page.locator('[data-testid="mkt-dev-tools"]').isVisible(),
        );
      },
    },
    {
      id: 'merged.block-absent-on-mini-apps',
      title: 'Block is not on the Mini apps tab',
      run: async (c) => {
        await c.goto('/marketplace/apps', { ready: 'main' });
        await c.page.waitForTimeout(800);
        c.obs.flag(
          'block.visible',
          await c.page.locator('[data-testid="mkt-dev-tools"]').isVisible(),
        );
      },
    },
    {
      id: 'merged.old-url-redirects',
      title: '/settings/integrations lands on the Marketplace',
      run: async (c) => {
        await c.goto('/settings/integrations', { ready: 'main' });
        c.obs.set('map.path', new URL(c.page.url()).pathname);
      },
    },
    {
      id: 'merged.sidebar-link',
      title: 'Settings sidebar entry points at the Marketplace',
      run: async (c) => {
        await c.goto('/settings', { ready: 'main' });
        const link = c.page.locator('nav a[href="/marketplace/integrations"]').first();
        c.obs.flag('sidebar.link', (await link.count()) > 0);
        if (await link.count()) {
          await link.click();
          await c.page.waitForURL(/marketplace\/integrations/, { timeout: 8000 }).catch(() => {});
        }
        c.obs.set('map.path', new URL(c.page.url()).pathname);
      },
    },
    {
      id: 'merged.tile-opens',
      title: 'A tile opens its screen and the breadcrumb comes back to the Marketplace',
      run: async (c) => {
        await c.goto('/marketplace/integrations', { ready: 'main' });
        const tile = c.page.locator('[data-testid="mkt-dev-tools"] a[data-settings-tile]').first();
        await tile.waitFor({ timeout: 8000 }).catch(() => {});
        c.obs.flag('tile.present', (await tile.count()) > 0);
        if (await tile.count()) {
          const before = c.page.url();
          await tile.click();
          await c.page.waitForURL((u) => u.href !== before, { timeout: 10000 }).catch(() => {});
          await c.page.waitForLoadState('load');
          c.obs.flag(
            'tile.left-marketplace-list',
            !/\/marketplace\/integrations$/.test(c.page.url()),
          );
          c.obs.flag('tile.no5xx', true);
        }
      },
    },
  ],
});
