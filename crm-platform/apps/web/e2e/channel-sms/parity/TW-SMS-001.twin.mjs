// TW-SMS-001/002/005/008 twin: the SMS hub (/sms) and its connect form. Nothing is connected or sent: the connect form is only
// opened and its client/server validation exercised up to (not including) the provider credential check, because that check calls
// Twilio / MSG91 on the network and a twin run never talks to a real provider.
const SECTIONS = ['Connected numbers', 'Setup guide'];
const CONNECT_FIELDS = [
  { id: 'provider', threadwise: '[name=sms_provider]', ours: '#sms-provider', kind: 'select' },
  { id: 'from', threadwise: '[name=from_number]', ours: '#sms-from', kind: 'text', max: 32 },
  { id: 'sid', threadwise: '[name=account_sid]', ours: '#sms-sid', kind: 'text', max: 64 },
  { id: 'token', threadwise: '[name=auth_token]', ours: '#sms-token', kind: 'password', max: 255 },
  {
    id: 'dlt-sender',
    threadwise: '[name=sender_id]',
    ours: '#sms-sender-id',
    kind: 'text',
    max: 16,
  },
  {
    id: 'dlt-template',
    threadwise: '[name=dlt_template_id]',
    ours: '#sms-dlt-template',
    kind: 'text',
    max: 64,
  },
  { id: 'rate', threadwise: '[name=rate_per_segment]', ours: '#sms-rate', kind: 'number' },
  { id: 'currency', threadwise: '[name=currency]', ours: '#sms-currency', kind: 'text', max: 8 },
];
const has = async (c, text, o = {}) =>
  (await c.page.getByText(text, { exact: o.exact ?? false }).count()) > 0;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export default (h) => ({
  feature: 'TW-SMS-001',
  title: 'SMS hub and connect form (send-only)',
  pages: [
    {
      id: 'sms-hub',
      title: 'SMS hub',
      path: '/sms',
      ready: { threadwise: 'main', ours: 'main' },
      probes: h.ALL_PAGE_PROBES,
    },
  ],
  scenarios: [
    {
      id: 'hub.structure',
      title:
        'The hub shows connected numbers, the lookup tool, the connect form and the setup guide',
      run: async (c) => {
        await c.goto('/sms', { ready: 'main' });
        for (const s of SECTIONS) c.obs.flag(`flag.section.${slug(s)}`, await has(c, s));
        c.obs.flag('flag.lookup', await has(c, /check a number/i));
        c.obs.flag('flag.connect-button', await has(c, /verify \+ connect sms/i));
        c.obs.flag('flag.delivery-report-url', await has(c, /delivery|status/i));
        // send-only: the hub must not offer a receive path.
        c.obs.set('flag.no-inbound-copy', !(await has(c, /inbound webhook|reply from the inbox/i)));
        c.obs.set('sec.xss', false);
      },
    },
    {
      id: 'connect.form-structure',
      title: 'The connect form has the same fields, kinds and length limits',
      run: async (c) => {
        await c.goto('/sms', { ready: 'main' });
        for (const f of CONNECT_FIELDS) {
          const el = c.page.locator(f[c.side]).first();
          const present = (await el.count()) > 0;
          c.obs.flag(`flag.field.${f.id}.present`, present);
          if (!present) continue;
          const tag = await el.evaluate((n) => n.tagName.toLowerCase());
          const type = await el.evaluate((n) => n.getAttribute('type') || '');
          c.obs.enum(`enum.field.${f.id}.kind`, tag === 'select' ? 'select' : type || 'text');
          if (f.max) c.obs.num(`num.field.${f.id}.max`, Number(await el.getAttribute('maxlength')));
        }
        const select = c.page.locator(CONNECT_FIELDS[0][c.side]).first();
        const options = await select.locator('option').allTextContents();
        c.obs.set(
          'set.provider-options',
          options.map((o) => o.trim().toLowerCase().replace(/\s.*$/, '')),
        );
        c.obs.set('sec.xss', false);
      },
    },
    {
      id: 'connect.empty-submit',
      title: 'Submitting with the From number blank saves nothing and flags the field',
      run: async (c) => {
        await c.goto('/sms', { ready: 'main' });
        const before = await c.page.locator('[data-sms-sender], .sms-number, article').count();
        await c.click({ role: 'button', name: /verify \+ connect sms/i });
        await c.afterAction({ quiet: 800 });
        c.obs.flag('flag.stays-on-hub', new URL(c.page.url()).pathname.startsWith('/sms'));
        const invalid = await c.page
          .locator(
            `${CONNECT_FIELDS[1][c.side]}:invalid, ${CONNECT_FIELDS[1][c.side]}[aria-invalid=true]`,
          )
          .count();
        const msg = await has(c, /from number.*required|required/i);
        c.obs.flag('flag.from-flagged', invalid > 0 || msg);
        const after = await c.page.locator('[data-sms-sender], .sms-number, article').count();
        c.obs.flag('flag.nothing-saved', after === before);
        c.obs.set('sec.xss', false);
      },
    },
    {
      id: 'connect.xss-in-from',
      title: 'Script typed into the From number is never executed',
      tags: ['xss'],
      run: async (c) => {
        await c.goto('/sms', { ready: 'main' });
        await c.page.evaluate(() => {
          window.__xss = false;
        });
        await c.page
          .locator(CONNECT_FIELDS[1][c.side])
          .fill('<img src=x onerror="window.__xss=true">');
        await c.click({ role: 'button', name: /verify \+ connect sms/i });
        await c.afterAction({ quiet: 800 });
        c.obs.set('sec.xssExecuted', await c.page.evaluate(() => window.__xss === true));
      },
    },
    {
      id: 'lookup.blank-guard',
      title: 'The lookup tool does nothing for a blank number',
      run: async (c) => {
        await c.goto('/sms', { ready: 'main' });
        const input = c.page.locator('[name=sms-lookup], input[placeholder*="555"]').first();
        c.obs.flag('flag.lookup-input', (await input.count()) > 0);
        await c.click({ role: 'button', name: /check number/i });
        await c.afterAction({ quiet: 600 });
        c.obs.flag('flag.lookup-no-crash', !(await has(c, /server error|something went wrong/i)));
        c.obs.set('sec.xss', false);
      },
    },
  ],
  intended: [
    {
      scenario: /sms-hub\.responsive/,
      key: /^low\.smallTargets\./,
      quirk:
        'shared Settings breadcrumb (settings-hub) draws two 19-20px links above every Settings tile screen',
      reason:
        'not part of the SMS screen and outside its zone; the breadcrumb is shared by every tile (follow-up for settings-hub)',
    },
    {
      scenario: /sms-hub\.keyboard/,
      key: 'abs.keyboard.focusVisible',
      quirk: 'the Next.js development overlay portal takes one Tab stop with no focus ring',
      reason:
        'dev-server artifact only (measured: the single stop without a ring is NEXTJS-PORTAL); every SMS control shows a ring',
    },
    {
      scenario: /hub\.structure/,
      key: 'flag.no-inbound-copy',
      quirk: 'Reference hub documents the inbound webhook and replying from the inbox',
      reason:
        'owner decision: SMS is send-only, so the hub carries no receive-path copy or inbound URL',
    },
    {
      scenario: /connect\.empty-submit/,
      key: 'flag.from-flagged',
      quirk: 'Reference validates server-side and reloads',
      reason:
        'we validate in the form first and keep the typed values, with the same field flagged',
    },
  ],
  skip: [
    {
      scenario: /connect\.(valid|verify)/,
      side: 'threadwise',
      reason: 'a valid connect calls Twilio/MSG91; compared from fixtures and API e2e instead',
    },
  ],
});
