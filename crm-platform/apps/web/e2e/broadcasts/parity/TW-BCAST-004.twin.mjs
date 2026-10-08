// TW-BCAST-004 twin: the broadcasts list and the single-page "Create new broadcast" screen (TW-BCAST-001, 004 to 008). Both screens run on
// both apps: page probes for each plus structure scenarios that check the same words, sections and buttons are present. Nothing is sent
// or stored: the create scenarios stop before "Add Broadcast".
const KPI = ['Sent', 'Delivered', 'Read', 'Failed', 'Processing'];
const VIEWS = ['All broadcasts', 'Scheduled', 'Processing', 'Completed', 'Failed'];
const RANGES = ['All time', '7d', '30d', '90d'];
const COLUMNS = [
  'Name',
  'Template',
  'Contacts',
  'Sent',
  'Delivered',
  'Read',
  'Failed',
  'Clicked',
  'Status',
];
const HELP = ['What is a broadcast?', 'When should I schedule it?', 'How do I improve results?'];

const has = async (c, text, o = {}) =>
  (await c.page.getByText(text, { exact: o.exact ?? false }).count()) > 0;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const listPath = '/broadcasts';
const createPath = '/broadcasts/create';

export default (h) => ({
  feature: 'TW-BCAST-004',
  title: 'Broadcasts list and the single-page create screen',
  pages: [
    {
      id: 'broadcasts-list',
      title: 'Template broadcasts',
      path: { threadwise: listPath, ours: listPath },
      ready: { threadwise: 'main', ours: 'main' },
      probes: h.ALL_PAGE_PROBES,
    },
    {
      id: 'broadcast-create',
      title: 'Create new broadcast',
      path: { threadwise: createPath, ours: createPath },
      ready: { threadwise: 'form#broadcastForm', ours: 'main' },
      probes: h.ALL_PAGE_PROBES,
    },
  ],
  scenarios: [
    {
      id: 'list.structure',
      title:
        'The list has the same heading, tiles, views, range pills, search, column heads and help cards',
      run: async (c) => {
        await c.goto(listPath, { ready: 'main' });
        c.obs.flag('flag.heading', await has(c, 'Template'));
        for (const k of KPI) c.obs.flag(`flag.kpi.${slug(k)}`, await has(c, k, { exact: true }));
        for (const k of VIEWS) c.obs.flag(`flag.view.${slug(k)}`, await has(c, k, { exact: true }));
        for (const k of RANGES)
          c.obs.flag(`flag.range.${slug(k)}`, await has(c, k, { exact: true }));
        for (const k of COLUMNS)
          c.obs.flag(`flag.col.${slug(k)}`, await has(c, k, { exact: false }));
        for (const k of HELP) c.obs.flag(`flag.help.${slug(k)}`, await has(c, k));
        c.obs.flag(
          'flag.search',
          (await c.page.getByPlaceholder(/search broadcasts/i).count()) > 0,
        );
        c.obs.flag('flag.recent', await has(c, 'Recent broadcasts'));
        c.obs.set('sec.xss', false);
      },
    },
    {
      id: 'list.empty-state',
      title: 'A search with no match shows "No data found" with Reset filters and Create broadcast',
      run: async (c) => {
        await c.goto(listPath, { ready: 'main' });
        await c.page.getByPlaceholder(/search broadcasts/i).fill('zzzz-no-such-broadcast');
        await c.page.waitForTimeout(1200);
        c.obs.flag('flag.empty.title', await has(c, 'No data found'));
        c.obs.flag('flag.empty.reset', await has(c, 'Reset filters'));
        c.obs.flag('flag.empty.create', await has(c, 'Create broadcast', { exact: true }));
        c.obs.set('sec.xss', false);
      },
    },
    {
      id: 'create.structure',
      title:
        'The create screen has the setup, device, audience and schedule sections, the preview and the header actions',
      run: async (c) => {
        await c.goto(createPath, { ready: 'main' });
        for (const k of [
          'Broadcast setup',
          'Broadcast name',
          'Select template message',
          'Who do you want to send it to?',
          'When do you want to send your broadcast?',
          'Send now',
          'Schedule for later',
          'Draft / unsaved',
          'Add Broadcast',
        ])
          c.obs.flag(`flag.create.${slug(k)}`, await has(c, k));
        c.obs.flag('flag.create.device', await has(c, 'Send from device'));
        c.obs.flag(
          'flag.create.search',
          (await c.page.getByPlaceholder(/search by name or phone/i).count()) > 0,
        );
        c.obs.flag('flag.create.preview', await has(c, 'Pick a template to preview'));
        c.obs.set('sec.xss', false);
      },
    },
    {
      id: 'create.validation',
      title: 'Add Broadcast with nothing filled does not leave the page',
      run: async (c) => {
        await c.goto(createPath, { ready: 'main' });
        await c.page.getByRole('button', { name: /add broadcast/i }).click();
        await c.page.waitForTimeout(800);
        c.obs.flag('flag.still-on-create', /\/broadcasts\/create/.test(c.page.url()));
        c.obs.set('sec.xss', false);
      },
    },
  ],
  intended: [
    {
      scenario: /^(broadcasts-list|broadcast-create)\.keyboard$/,
      key: 'abs.keyboard.focusVisible',
      quirk: 'the Next.js dev-tools button has no focus ring',
      reason:
        'the one tab stop without a ring is the `nextjs-portal` dev-tools button, which only the dev server renders; a production build has no such stop',
    },
  ],
});
