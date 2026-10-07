// Ours-only: "Send campaign" in the Contact Hub opens the broadcast wizard on a draft whose audience is the ticked contacts.
async function seed(c) {
  const made = [];
  for (const [i, label] of ['mango', 'apple'].entries()) {
    const res = await c.http('POST', '/v2/contacts', {
      data: { name: c.tag(label), phone: `+91${9 - i}${c.digits(9)}` },
    });
    const row = res.body;
    if (c.isMine(row)) {
      made.push(row);
      c.onCleanup(() => c.deleteOwned(`/v2/contacts/${row.id}`, row));
    }
  }
  return made;
}

export default () => ({
  feature: 'adhoc:contacts-send-campaign',
  title: 'Contact Hub: send a campaign to the ticked contacts',
  pages: [],
  scenarios: [
    {
      id: 'contacts-send-campaign.opens-wizard',
      title:
        'Ticking a row and pressing Send Campaign opens the wizard on a draft holding that selection',
      tags: ['edge'],
      run: async (c) => {
        const o = c.obs;
        const made = await seed(c);
        await c.goto('/contacts', { ready: 'main' });
        const send = c.page.getByRole('button', { name: /send campaign/i });
        await send.waitFor();
        o.flag('send.disabledWithoutSelection', await send.isDisabled());
        const row = c.page.locator('tbody tr', { hasText: made[0].name });
        await row.getByRole('checkbox').check();
        o.flag('send.enabledWithSelection', !(await send.isDisabled()));
        await send.click();
        await c.page.waitForURL(/\/campaigns\/wizard\/[0-9a-f-]{36}/, { timeout: 15000 });
        const id = c.page.url().match(/wizard\/([0-9a-f-]{36})/)[1];
        o.flag('send.noComingSoonToast', (await c.page.getByText(/coming soon/i).count()) === 0);
        const draft = await c.http('GET', `/v2/broadcast-wizard/drafts/${id}`);
        const sel = draft.body?.draft?.audience?.selection;
        o.flag(
          'send.draftHoldsTickedId',
          JSON.stringify(sel?.ids) === JSON.stringify([made[0].id]),
        );
        const count = await c.http('POST', '/v2/broadcast-wizard/audience/count', {
          data: { audience: draft.body.draft.audience },
        });
        o.flag('send.countIsOne', count.body?.matching === 1);
        c.onCleanup(async () => {
          if (draft.body?.id)
            await c.http('DELETE', `/v2/broadcast-wizard/drafts/${draft.body.id}`);
        });
      },
    },
  ],
});
