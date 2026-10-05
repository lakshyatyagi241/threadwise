// Twin spec for the billing hardening screens: the billing settings form (TW-PAYGW-007), the add-on pack form (TW-ADD-028)
// and their lists, on the Reference admin console and on ours. Reads only: nothing is created or changed on either side.
// Our console runs as a read-only support operator (a super admin must enrol two-factor first), so controls are disabled
// on our side; structure and probes are still comparable.
// The grace-period field and the add-on "Billing" mode are new in our build (Reference has neither): they are recorded as
// info, never as a difference in the shared fields.
export default () => {
  const labels = (c, root) =>
    c.page.evaluate((sel) => {
      const scope = document.querySelector(sel) || document.body;
      return [...scope.querySelectorAll('label')]
        .map((l) => (l.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase())
        .filter(Boolean);
    }, root);
  const has = (all, text) => all.some((l) => l.startsWith(text));

  const settingsFields = [
    'rate (%)',
    'label',
    'legal company name',
    'tax number',
    'registered address',
    'registration / cin',
    'billing email',
    'support phone',
    'window (days)',
    'yearly discount',
  ];
  const addonFields = [
    'name',
    'subtitle',
    'price',
    'offer price',
    'currency',
    'duration',
    'unit',
    'sort order',
    'active',
    'lifetime',
  ];

  return {
    feature: 'TW-PAYGW-007',
    title:
      'Billing settings and add-on pack form: shared fields, probes, new fields recorded as info',
    pages: [
      {
        id: 'billing-settings',
        title: 'Billing settings',
        path: '/admin/checkout-settings',
        ready: { threadwise: 'form', ours: 'main h1' },
        probes: ['load', 'responsive', 'a11y', 'keyboard', 'auth'],
      },
      {
        id: 'addon-form',
        title: 'New add-on',
        path: { threadwise: '/admin/addons/create', ours: '/admin/addons/new' },
        ready: { threadwise: '#addonForm, form', ours: 'main h1' },
        probes: ['load', 'responsive', 'a11y', 'keyboard', 'auth'],
      },
      {
        id: 'addon-list',
        title: 'Add-ons list',
        path: '/admin/addons',
        ready: { threadwise: 'main, .content, body', ours: 'main h1' },
        probes: ['load', 'responsive', 'a11y', 'auth'],
      },
    ],
    scenarios: [
      {
        id: 'settings.fields',
        title: 'The billing settings form keeps every Reference field; the grace period is ours alone',
        run: async (c) => {
          await c.goto('/admin/checkout-settings', { ready: { threadwise: 'form', ours: 'main h1' } });
          const all = await labels(c, 'main');
          for (const f of settingsFields) c.obs.flag(`field.${f}`, has(all, f));
          c.obs.flag(
            'section.autoRenew',
            all.some((l) => l.includes('auto-renew')) ||
              (await c.page.getByText(/auto-renewing subscriptions/i).count()) > 0,
          );
          c.obs.info('graceField', has(all, 'grace period'));
        },
      },
      {
        id: 'addon.fields',
        title: 'The add-on form keeps every Reference field; the billing mode is ours alone',
        run: async (c) => {
          await c.goto(
            { threadwise: '/admin/addons/create', ours: '/admin/addons/new' },
            { ready: { threadwise: 'form', ours: 'main h1' } },
          );
          const all = await labels(c, 'main');
          for (const f of addonFields) c.obs.flag(`field.${f}`, has(all, f));
          c.obs.info('billingModeField', has(all, 'billing'));
        },
      },
      {
        id: 'addon.units',
        title: 'The add-on duration unit offers days, weeks, months and years',
        run: async (c) => {
          await c.goto(
            { threadwise: '/admin/addons/create', ours: '/admin/addons/new' },
            { ready: { threadwise: 'form', ours: 'main h1' } },
          );
          const sel = c.side === 'threadwise' ? 'select[name=plan_unit]' : '#addon-unit';
          const opts = await c.page.locator(`${sel} option`).allTextContents();
          c.obs.set(
            'set.units',
            opts.map((o) => o.trim().toLowerCase()),
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
          'ours adds a skip link on every console page (better keyboard access); a deliberate improvement over Reference',
      },
      {
        scenario: /^addon-form\.keyboard$/,
        key: 'abs.keyboard.reachable',
        quirk: 'twin run signs in as the read-only support operator',
        reason:
          'a super admin must enrol two-factor first, so the run uses a support operator whose form controls are disabled and skipped by Tab; the ratio counts them as present',
      },
      {
        scenario: /\.load$/,
        key: 'perf.lcpMs',
        quirk: 'our web app runs in next dev for the twin run',
        reason:
          'the first paint includes the dev-server compile; the same ratio shows on admin pages this change did not touch, a production build is not what is measured',
      },
    ],
    skip: [],
  };
};
