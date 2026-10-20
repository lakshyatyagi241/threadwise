// Ours-only: the contact detail shows values imported from another system in a readable form.
// An ISO timestamp is shown as a date, and the agent id in `last_chat_assigned_to` is shown as the agent's name.
const UNKNOWN_AGENT = '00000000-0000-4000-8000-000000000000';
const ISO = '2026-03-21T15:29:05.374Z';

async function seed(c, custom) {
  const res = await c.http('POST', '/v2/contacts', {
    data: {
      name: c.tag('imported'),
      phone: `+91${9}${c.digits(9)}`,
      email: `${c.tag('imp')}@example.test`,
      customFields: custom,
    },
  });
  const made = res.body ?? (await res.json?.());
  if (c.isMine(made)) c.onCleanup(() => c.deleteOwned(`/v2/contacts/${made.id}`, made));
  return made;
}

async function agent(c) {
  const res = await c.http('GET', '/v2/contacts/assignees');
  const rows = res.body ?? (await res.json?.());
  return Array.isArray(rows) ? rows[0] : undefined;
}

// The text of one labelled row ("Last Chat Assigned To  <value>") after "Show all details" is open; '' when the row is absent.
async function rowText(c, id, label) {
  await c.goto(`/contacts/${id}`, { ready: 'main' });
  await c.page
    .getByRole('button', { name: /show all details/i })
    .first()
    .click();
  await c.afterAction({ quiet: 500 });
  const lab = c.page.locator('main').getByText(label, { exact: true });
  if ((await lab.count()) === 0) return '';
  return (await lab.first().locator('xpath=..').innerText()).replace(/\s+/g, ' ').trim();
}

export default () => ({
  feature: 'adhoc:contact-detail-imported-values',
  title: 'Contact detail: imported timestamp and agent id read as a date and a name',
  pages: [],
  scenarios: [
    {
      id: 'imported.agent-name',
      title: 'The agent id shows the agent name, not the id',
      tags: ['edge'],
      run: async (c) => {
        const o = c.obs;
        const who = await agent(c);
        o.flag('seed.agentFound', Boolean(who?.id));
        if (!who?.id) return;
        const made = await seed(c, { last_chat_assigned_to: who.id });
        const row = await rowText(c, made.id, 'Last Chat Assigned To');
        o.flag('agent.rowShown', row !== '');
        o.flag('agent.nameShown', row.includes(who.fullName));
        o.flag('agent.uuidHidden', !row.includes(who.id));
      },
    },
    {
      id: 'imported.agent-id-upper-case',
      title: 'An upper-case stored agent id still shows the name',
      tags: ['edge'],
      run: async (c) => {
        const o = c.obs;
        const who = await agent(c);
        if (!who?.id) return;
        const made = await seed(c, { last_chat_assigned_to: who.id.toUpperCase() });
        const row = await rowText(c, made.id, 'Last Chat Assigned To');
        o.flag('agent.nameShownUpper', row.includes(who.fullName));
      },
    },
    {
      id: 'imported.agent-id-unknown',
      title: 'An id nobody answers for stays as stored (nothing is lost)',
      tags: ['edge'],
      run: async (c) => {
        const o = c.obs;
        const made = await seed(c, { last_chat_assigned_to: UNKNOWN_AGENT });
        const row = await rowText(c, made.id, 'Last Chat Assigned To');
        o.flag('agent.unknownKept', row.includes(UNKNOWN_AGENT));
      },
    },
    {
      id: 'imported.other-key-uuid-untouched',
      title: 'A UUID under any other key is not replaced',
      tags: ['edge'],
      run: async (c) => {
        const o = c.obs;
        const who = await agent(c);
        if (!who?.id) return;
        const made = await seed(c, { module_ref: who.id });
        const row = await rowText(c, made.id, 'Module Ref');
        o.flag('other.uuidKept', row.includes(who.id));
      },
    },
    {
      id: 'imported.iso-timestamp',
      title: 'An imported ISO timestamp reads as a date, not as 2026-03-21T15:29:05.374Z',
      tags: ['edge'],
      run: async (c) => {
        const o = c.obs;
        const made = await seed(c, { created_time: ISO });
        const row = await rowText(c, made.id, 'Created Time');
        o.flag('date.rowShown', row !== '');
        o.flag('date.rawIsoHidden', row !== '' && !row.includes('T15:29:05'));
        o.flag('date.yearShown', /2026/.test(row));
      },
    },
  ],
});
