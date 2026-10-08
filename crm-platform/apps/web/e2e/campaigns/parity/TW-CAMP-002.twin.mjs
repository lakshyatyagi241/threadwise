// TW-CAMP-002 twin: the campaigns list and the five-step campaign builder. Both screens run on both apps: page probes for each,
// plus structure scenarios that check the same words, steps and buttons are present. Reference's builder stops at Compose until a
// sender is connected, so the later steps are compared by what the source declares, not live.
const STEPS = ['Setup', 'Compose', 'Recipients', 'Schedule', 'Review'];
const TYPES = ['Custom message', 'Use template', 'Flow builder'];
const TILES = ['Sent', 'Delivered', 'Read', 'Failed', 'Processing'];
const STATUS = [
  'All campaigns',
  'Recently created',
  'Recently updated',
  'Scheduled',
  'Processing',
  'Completed',
  'Failed',
];
const KINDS = ['All types', 'Custom message', 'Template', 'Flow builder'];
const RANGES = ['All time', 'Last 7 days', 'Last 30 days', 'Last 90 days'];
const HELP = [
  'What is a WhatsApp campaign?',
  'How do I improve delivery?',
  'Which campaign should I launch first?',
];

const has = async (c, text, o = {}) =>
  (await c.page.getByText(text, { exact: o.exact ?? false }).count()) > 0;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export default (h) => ({
  feature: 'TW-CAMP-002',
  title: 'Campaigns list and the five-step campaign builder',
  pages: [
    {
      id: 'campaigns-list',
      title: 'WhatsApp campaigns',
      path: { threadwise: '/wa-campaigns', ours: '/campaigns' },
      ready: { threadwise: 'main', ours: 'main' },
      probes: h.ALL_PAGE_PROBES,
    },
    {
      id: 'campaign-builder',
      title: 'Create a campaign',
      path: { threadwise: '/wa-campaigns/create', ours: '/campaigns/create' },
      ready: { threadwise: 'form#campaignForm', ours: 'main' },
      probes: h.ALL_PAGE_PROBES,
    },
  ],
  scenarios: [
    {
      id: 'list.structure',
      title:
        'The list has the same heading, tiles, status and type views, range pills, search and help cards',
      run: async (c) => {
        await c.goto(c.side === 'threadwise' ? '/wa-campaigns' : '/campaigns', { ready: 'main' });
        c.obs.flag('flag.heading', await has(c, 'WhatsApp'));
        for (const k of TILES) c.obs.flag(`flag.tile.${slug(k)}`, await has(c, k, { exact: true }));
        for (const k of STATUS)
          c.obs.flag(`flag.status.${slug(k)}`, await has(c, k, { exact: true }));
        for (const k of KINDS) c.obs.flag(`flag.type.${slug(k)}`, await has(c, k, { exact: true }));
        for (const k of RANGES)
          c.obs.flag(`flag.range.${slug(k)}`, await has(c, k, { exact: true }));
        for (const k of HELP) c.obs.flag(`flag.help.${slug(k)}`, await has(c, k));
        c.obs.flag('flag.search', (await c.page.getByPlaceholder(/search campaigns/i).count()) > 0);
        c.obs.flag('flag.new', (await c.page.getByText(/new wa campaign/i).count()) > 0);
        c.obs.set('sec.xss', false);
      },
    },
    {
      id: 'list.empty-state',
      title: 'A search with no match shows "No data found" with Reset filters and Create campaign',
      run: async (c) => {
        await c.goto(c.side === 'threadwise' ? '/wa-campaigns' : '/campaigns', { ready: 'main' });
        await c.page.getByPlaceholder(/search campaigns/i).fill('zzzz-no-such-campaign');
        await c.page.waitForTimeout(1200);
        c.obs.flag('flag.empty.title', await has(c, 'No data found'));
        c.obs.flag('flag.empty.reset', await has(c, 'Reset filters'));
        c.obs.flag('flag.empty.create', await has(c, 'Create campaign', { exact: true }));
        c.obs.set('sec.xss', false);
      },
    },
    {
      id: 'builder.structure',
      title:
        'The builder shows the five steps, the three campaign types, A/B and the header actions',
      run: async (c) => {
        await c.goto(c.side === 'threadwise' ? '/wa-campaigns/create' : '/campaigns/create', {
          ready: 'main',
        });
        for (const k of STEPS) c.obs.flag(`flag.step.${slug(k)}`, await has(c, k, { exact: true }));
        for (const k of TYPES) c.obs.flag(`flag.type.${slug(k)}`, await has(c, k, { exact: true }));
        c.obs.flag('flag.ab', await has(c, 'Enable A/B test'));
        c.obs.flag('flag.ai', await has(c, 'Build with AI'));
        c.obs.flag('flag.save-draft', await has(c, 'Save draft', { exact: true }));
        c.obs.flag('flag.draft-chip', await has(c, 'Draft / unsaved'));
        c.obs.flag('flag.live-preview', await has(c, 'Live preview'));
        c.obs.flag('flag.name', (await c.page.getByLabel(/campaign name/i).count()) > 0);
        c.obs.set('sec.xss', false);
      },
    },
    {
      id: 'builder.engine-gate',
      title:
        'Nothing picked shows every campaign type; picking a Meta number (test number included) leaves only Use template; clearing the pick shows all again',
      tags: ['ours'],
      run: {
        threadwise: async (c) => c.obs.info('n/a', 'the local Reference has no connected number to pick'),
        ours: async (c) => {
          await c.goto('/campaigns/create', { ready: 'main' });
          const shown = async () => ({
            custom: await has(c, 'Custom message', { exact: true }),
            template: await has(c, 'Use template', { exact: true }),
            flow: await has(c, 'Flow builder', { exact: true }),
          });
          const first = await shown();
          c.obs.flag('flag.first.all-three', first.custom && first.template && first.flow);
          const options = await c.page
            .locator('#camp-sender option')
            .evaluateAll((os) => os.map((o) => ({ value: o.value, text: o.textContent ?? '' })));
          const meta = options.find((o) => o.value.startsWith('waba:'));
          c.obs.flag('flag.has-meta-number', Boolean(meta));
          if (meta) {
            await c.page.locator('#camp-sender').selectOption(meta.value);
            const onMeta = await shown();
            c.obs.flag(
              'flag.meta.only-template',
              onMeta.template && !onMeta.custom && !onMeta.flow,
            );
            await c.page.locator('#camp-sender').selectOption('');
            const back = await shown();
            c.obs.flag('flag.cleared.all-three', back.custom && back.template && back.flow);
          }
          c.obs.set('sec.xss', false);
        },
      },
    },
    {
      id: 'builder.ai-modal',
      title: 'Build with AI opens a brief with the same fields',
      run: async (c) => {
        await c.goto(c.side === 'threadwise' ? '/wa-campaigns/create' : '/campaigns/create', {
          ready: 'main',
        });
        await c.page.getByRole('button', { name: /build with ai/i }).click();
        await c.page.waitForTimeout(800);
        for (const k of [
          'AI model',
          'Business name',
          'Product or service',
          'Campaign goal',
          'Tone',
          'CTA button label',
          'CTA destination URL',
          'Target audience',
          'Offer / hook',
        ])
          c.obs.flag(`flag.ai.${slug(k)}`, await has(c, k));
        c.obs.flag('flag.ai.generate', await has(c, 'Generate campaign'));
        c.obs.set('sec.xss', false);
      },
    },
    {
      id: 'builder.setup-validation',
      title: 'Next with no name does not leave the Setup step',
      run: async (c) => {
        await c.goto(c.side === 'threadwise' ? '/wa-campaigns/create' : '/campaigns/create', {
          ready: 'main',
        });
        await c.page.getByRole('button', { name: /^next$/i }).click();
        await c.page.waitForTimeout(600);
        c.obs.flag('flag.still-on-setup', await has(c, 'Campaign setup'));
        // Reference keeps every step in the page and hides the others, so ask whether the Compose field is visible, not present.
        c.obs.flag(
          'flag.compose-not-shown',
          !(await c.page
            .getByText('Header text')
            .first()
            .isVisible()
            .catch(() => false)),
        );
        c.obs.set('sec.xss', false);
      },
    },
  ],
  skip: [
    {
      scenario: /^builder\.engine-gate$/,
      side: 'threadwise',
      reason: 'the local Reference has no connected number, so its engine gate cannot be driven live',
    },
  ],
  intended: [
    {
      scenario: /^(campaigns-list|campaign-builder|campaign-create)\.keyboard$/,
      key: 'abs.keyboard.focusVisible',
      quirk: 'the Next.js dev-tools button has no focus ring',
      reason:
        'the one tab stop without a ring is the `nextjs-portal` dev-tools button, which only the dev server renders (checked by tabbing the page and reading the focused element); a production build has no such stop',
    },
    {
      scenario: /^campaigns-list\.keyboard$/,
      key: 'abs.keyboard.reachable',
      quirk: 'probe stops at the first repeated focus position',
      reason:
        'the campaign cards scroll inside the page, so rows tabbed into view repeat a position and the probe ends early; tabbing reaches every control (checked by hand)',
    },
  ],
});
