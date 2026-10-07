// Ours-only: editing a proposal and clicking into another module (Settings) asks before the changes are lost.
export default () => ({
  feature: 'adhoc:proposal-leave-guard',
  title: 'Proposal editor: confirm before leaving with unsaved changes',
  pages: [],
  scenarios: [
    {
      id: 'proposal-leave-guard.menu-click',
      title: 'Unsaved edit + menu click shows the dialog; Keep editing stays; Leave goes',
      tags: ['edge'],
      run: async (c) => {
        const o = c.obs;
        const res = await c.http('POST', '/v2/sales-docs', {
          data: {
            kind: 'proposal',
            title: c.tag('guard'),
            lines: [{ description: 'Line', qty: '1', unitPrice: '10.00' }],
          },
        });
        const doc = res.body;
        if (c.isMine(doc)) c.onCleanup(() => c.deleteOwned(`/v2/sales-docs/${doc.id}`, doc));
        await c.goto(`/proposals/${doc.id}`, { ready: 'main' });
        const title = c.page.getByLabel(/^title/i);
        await title.waitFor();
        const contactsLink = c.page.locator('a[href="/settings"]').first();

        // Untouched: leaving is not interrupted.
        o.flag(
          'guard.cleanNoDialog',
          await (async () => {
            await contactsLink.click();
            await c.page.waitForURL(/\/settings/, { timeout: 15000 });
            return true;
          })(),
        );
        await c.page.goBack();
        await c.page.waitForURL(/\/proposals\//);
        await title.waitFor();

        // Edited: the dialog shows and the page stays.
        await title.fill(`${c.tag('guard')} edited`);
        await c.page.locator('a[href="/settings"]').first().click();
        const dialog = c.page.getByRole('alertdialog').or(c.page.getByRole('dialog'));
        await dialog.waitFor({ timeout: 8000 });
        o.flag(
          'guard.dialogShown',
          await dialog
            .getByText(/leave without saving/i)
            .first()
            .isVisible(),
        );
        o.flag('guard.stillOnProposal', /\/proposals\//.test(c.page.url()));
        await dialog.getByRole('button', { name: /keep editing/i }).click();
        o.flag('guard.keptEdit', (await title.inputValue()).endsWith('edited'));
        o.flag('guard.dialogClosed', (await dialog.count()) === 0);

        // Leave: goes on to the other module.
        await c.page.locator('a[href="/settings"]').first().click();
        await dialog.waitFor({ timeout: 8000 });
        await dialog.getByRole('button', { name: /leave without saving/i }).click();
        await c.page.waitForURL(/\/settings/, { timeout: 15000 });
        o.flag('guard.leftToSettings', true);
      },
    },
  ],
});
