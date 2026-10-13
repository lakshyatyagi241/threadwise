// Platform-only: Reference keeps the integration tools on Settings and the marketplace on a separate page; we show the tools as cards in
// the Marketplace (Add-ons and Integrations tabs) and no longer list them in Settings. Judged on our side only (run with --sides ours).
const ADDON_IDS = [
  'google-calendar',
  'rest-api',
  'webhooks',
  'geta-publishing',
  'i18n-translation',
  'addons',
];
const INTEGRATION_IDS = ['shopify', 'woocommerce', 'google-sheets-addon', 'email'];
const ids = (c, tab) =>
  c.page
    .locator(`[data-testid="mkt-tools-${tab}"] [data-testid^="tool-card-"]`)
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').replace('tool-card-', '')));

export default (h) => ({
  feature: 'adhoc:marketplace-tools',
  title:
    'Integration tools as cards in the Marketplace (Add-ons and Integrations tabs), removed from Settings',
  pages: [
    {
      id: 'mkt-integrations',
      title: 'Integrations tab',
      path: '/marketplace/integrations',
      ready: { ours: 'main' },
      probes: h.ALL_PAGE_PROBES,
    },
    {
      id: 'mkt-addons',
      title: 'Add-ons tab',
      path: '/marketplace/addons',
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
      id: 'tools.three-tabs',
      title: 'The Marketplace has Mini apps, Integrations and Add-ons tabs, in that order',
      run: async (c) => {
        await c.goto('/marketplace/addons', { ready: 'main' });
        const hrefs = await c.page
          .locator('nav[aria-label] a[href^="/marketplace/"]')
          .evaluateAll((els) =>
            els
              .map((e) => e.getAttribute('href'))
              .filter((x) => /\/(apps|integrations|addons)$/.test(x)),
          );
        c.obs.set('map.tabs', hrefs.join(','));
        c.obs.flag(
          'addons.tab.current',
          (await c.page.locator('a[aria-current="page"][href="/marketplace/addons"]').count()) ===
            1,
        );
        await c.shot('addons-tab');
      },
    },
    {
      id: 'tools.addons-cards',
      title: 'Add-ons tab shows only add-on cards',
      run: async (c) => {
        await c.goto('/marketplace/addons', { ready: 'main' });
        await c.page
          .locator('[data-testid="mkt-tools-addons"]')
          .waitFor({ timeout: 8000 })
          .catch(() => {});
        const got = await ids(c, 'addons');
        c.obs.flag('has.cards', got.length > 0);
        c.obs.flag(
          'only.addon.ids',
          got.every((x) => ADDON_IDS.includes(x)),
        );
        c.obs.set('map.order', got.join(','));
      },
    },
    {
      id: 'tools.integrations-cards',
      title:
        'Integrations tab shows Shopify, WooCommerce, Sheets and Email cards, and no add-on cards',
      run: async (c) => {
        await c.goto('/marketplace/integrations', { ready: 'main' });
        await c.page
          .locator('[data-testid="mkt-tools-integrations"]')
          .waitFor({ timeout: 8000 })
          .catch(() => {});
        const got = await ids(c, 'integrations');
        c.obs.flag('has.cards', got.length > 0);
        c.obs.flag(
          'only.integration.ids',
          got.every((x) => INTEGRATION_IDS.includes(x)),
        );
        c.obs.set('map.order', got.join(','));
        c.obs.flag(
          'addon.block.absent',
          (await c.page.locator('[data-testid="mkt-tools-addons"]').count()) === 0,
        );
        await c.shot('integrations-tab');
      },
    },
    {
      id: 'tools.hidden-on-search',
      title: 'Integration cards hide while searching',
      run: async (c) => {
        await c.goto('/marketplace/integrations?q=zzzz', { ready: 'main' });
        await c.page.waitForTimeout(800);
        c.obs.flag(
          'block.visible',
          await c.page.locator('[data-testid="mkt-tools-integrations"]').isVisible(),
        );
      },
    },
    {
      id: 'tools.settings-has-no-section',
      title:
        'Settings no longer lists Integrations and developer, and search does not find its tiles',
      run: async (c) => {
        await c.goto('/settings', { ready: 'main' });
        c.obs.flag(
          'section.link',
          (await c.page.locator('nav a[href="/settings/integrations"]').count()) > 0,
        );
        c.obs.flag(
          'mkt.link.in.settings',
          (await c.page.locator('nav[aria-label] a[href="/marketplace/integrations"]').count()) > 0,
        );
        await c.page
          .getByRole('searchbox')
          .or(c.page.locator('input[type=search]'))
          .first()
          .fill('webhooks');
        await c.page.waitForTimeout(900);
        c.obs.flag(
          'search.finds.webhooks.tile',
          (await c.page.locator('[data-settings-tile="webhooks"]').count()) > 0,
        );
        await c.shot('settings');
      },
    },
    {
      id: 'tools.old-url-redirects',
      title: '/settings/integrations lands on the Marketplace',
      run: async (c) => {
        await c.goto('/settings/integrations', { ready: 'main' });
        c.obs.set('map.path', new URL(c.page.url()).pathname);
      },
    },
    {
      id: 'tools.card-opens',
      title: 'A card opens its screen, which has a Marketplace breadcrumb',
      run: async (c) => {
        await c.goto('/marketplace/addons', { ready: 'main' });
        const card = c.page.locator('[data-testid="mkt-tools-addons"] a[href]').first();
        await card.waitFor({ timeout: 8000 }).catch(() => {});
        c.obs.flag('card.present', (await card.count()) > 0);
        if (await card.count()) {
          await c.page.waitForTimeout(1500); // let the page hydrate before clicking
          const before = c.page.url();
          // noWaitAfter: a dev server compiles the target on first visit, which can take longer than the click's own wait.
          await card.click({ noWaitAfter: true });
          await c.page.waitForURL((u) => u.href !== before, { timeout: 70000 }).catch(() => {});
          await c.page.waitForLoadState('load');
          await c.page.waitForTimeout(1200);
          c.obs.flag('left.addons.tab', !/\/marketplace\/addons$/.test(c.page.url()));
          c.obs.flag(
            'breadcrumb.marketplace',
            (await c.page.locator('nav ol a[href="/marketplace/integrations"]').count()) > 0,
          );
          c.obs.flag(
            'breadcrumb.addons.tab',
            (await c.page.locator('nav ol a[href="/marketplace/addons"]').count()) > 0,
          );
        }
      },
    },
  ],
});
