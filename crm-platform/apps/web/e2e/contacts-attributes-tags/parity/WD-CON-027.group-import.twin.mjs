// Importing from the Groups screen must name its group (an existing one or a new name), and the file's own group column must not
// create other groups. WaDesk's import has an optional group and applies the column; ours differs by design, so the scenario runs
// on ours only (absolute expectations); the page probes run on both.
const na = async (c) => c.obs.info('n/a', 'no counterpart');
const csv = (tag, d) =>
  `name,last_name,country_code,mobile,email,group\n` +
  `${tag}-a,Test,91,9${d}1,${tag}-a@example.com,"${tag}-colA, ${tag}-colB"\n` +
  `${tag}-b,Test,91,9${d}2,${tag}-b@example.com,${tag}-colC\n`;

export default (h) => ({
  feature: 'WD-CON-027',
  title: 'Import from the Groups screen: a required group',
  pages: [
    {
      id: 'groups',
      title: 'Groups',
      path: '/contact-groups',
      ready: { wadesk: 'body', ours: 'main' },
      probes: ['load', 'auth'],
    },
  ],
  scenarios: [
    {
      id: 'import.group-required',
      title:
        'Import stays disabled until a group is chosen; the file group column is ignored; a new name creates exactly one group',
      tags: ['ours', 'write'],
      run: {
        wadesk: na,
        ours: async (c) => {
          const tag = c.tag('imp');
          c.onCleanup(async () => {
            const list = await c.http('GET', '/v2/contact-groups?limit=200');
            for (const g of list.body?.data ?? [])
              if (String(g.name).startsWith(tag))
                await c.deleteOwned(`/v2/contact-groups/${g.id}`, { name: g.name });
            const cs = await c.http('GET', `/v2/contacts?q=${encodeURIComponent(tag)}&limit=50`);
            for (const x of cs.body?.data ?? [])
              await c.deleteOwned(`/v2/contacts/${x.id}`, { name: x.name });
          });
          await c.goto('/contact-groups', { ready: 'main' });
          await c.page.getByRole('button', { name: 'Import contacts' }).click();
          const dlg = c.page.getByRole('dialog');
          await dlg.waitFor();
          await dlg.locator('input[type=file]').setInputFiles({
            name: `${tag}.csv`,
            mimeType: 'text/csv',
            buffer: Buffer.from(csv(tag, c.digits(8))),
          });
          await dlg.getByText('Add these contacts to').waitFor({ timeout: 15000 });
          // wait for the preview to finish so the button reflects the file
          await dlg
            .getByText(/New contacts/i)
            .first()
            .waitFor({ timeout: 15000 });
          const go = dlg.getByRole('button').last(); // Cancel comes first, the import button last
          c.obs.flag(
            'flag.group.required-shown',
            (await dlg.getByText('Add these contacts to').count()) === 1,
          );
          c.obs.flag('flag.import.disabled-without-group', await go.isDisabled());

          const name = `${tag}-target`;
          await dlg.getByRole('radio', { name: 'A new group' }).check();
          await dlg.getByPlaceholder('New group name').fill(name);
          c.obs.flag('flag.import.enabled-with-new-name', !(await go.isDisabled()));
          const done = c.page
            .waitForResponse(
              (r) => r.request().method() === 'POST' && /\/contacts\/import$/.test(r.url()),
              { timeout: 20000 },
            )
            .catch(() => null);
          await go.click();
          const r = await done;
          c.obs.status('status.import', r ? r.status() : 0);
          await c.page.waitForTimeout(2500);
          const groups = (await c.http('GET', '/v2/contact-groups?limit=200')).body?.data ?? [];
          const mine = groups.filter((g) => String(g.name).startsWith(tag));
          c.obs.set(
            'enum.groups.created',
            mine
              .map((g) => g.name.replace(tag, 'T'))
              .sort()
              .join(','),
          );
          c.obs.flag('flag.groups.exactly-one-target', mine.length === 1 && mine[0].name === name);
          c.obs.flag(
            'flag.groups.target-has-both',
            mine.length === 1 && Number(mine[0].contactCount ?? mine[0].memberCount ?? 0) === 2,
          );
          c.obs.set('sec.xss', false);
        },
      },
    },
    {
      id: 'import.existing-group',
      title:
        'An existing group can be chosen; every contact joins it and the file group column creates nothing',
      tags: ['ours', 'write'],
      run: {
        wadesk: na,
        ours: async (c) => {
          const tag = c.tag('imp2');
          const made = await c.http('POST', '/v2/contact-groups', {
            data: { name: `${tag}-existing` },
          });
          const gid = made.body?.id;
          c.onCleanup(async () => {
            const list = await c.http('GET', '/v2/contact-groups?limit=200');
            for (const g of list.body?.data ?? [])
              if (String(g.name).startsWith(tag))
                await c.deleteOwned(`/v2/contact-groups/${g.id}`, { name: g.name });
            const cs = await c.http('GET', `/v2/contacts?q=${encodeURIComponent(tag)}&limit=50`);
            for (const x of cs.body?.data ?? [])
              await c.deleteOwned(`/v2/contacts/${x.id}`, { name: x.name });
          });
          await c.goto('/contact-groups', { ready: 'main' });
          await c.page.getByRole('button', { name: 'Import contacts' }).click();
          const dlg = c.page.getByRole('dialog');
          await dlg.waitFor();
          await dlg
            .locator('input[type=file]')
            .setInputFiles({
              name: `${tag}.csv`,
              mimeType: 'text/csv',
              buffer: Buffer.from(csv(tag, c.digits(8))),
            });
          await dlg
            .getByText(/New contacts/i)
            .first()
            .waitFor({ timeout: 15000 });
          const go = dlg.getByRole('button').last();
          c.obs.flag('flag.existing.disabled-until-chosen', await go.isDisabled());
          await dlg
            .getByRole('combobox', { name: 'An existing group' })
            .selectOption({ label: `${tag}-existing` });
          c.obs.flag('flag.existing.enabled-after-choice', !(await go.isDisabled()));
          const done = c.page
            .waitForResponse(
              (r) => r.request().method() === 'POST' && /\/contacts\/import$/.test(r.url()),
              { timeout: 20000 },
            )
            .catch(() => null);
          await go.click();
          const r = await done;
          c.obs.status('status.import', r ? r.status() : 0);
          await c.page.waitForTimeout(2500);
          const groups = (await c.http('GET', '/v2/contact-groups?limit=200')).body?.data ?? [];
          const mine = groups.filter((g) => String(g.name).startsWith(tag));
          c.obs.flag('flag.groups.only-the-chosen-one', mine.length === 1 && mine[0].id === gid);
          c.obs.flag(
            'flag.groups.chosen-has-both',
            mine.length === 1 && Number(mine[0].contactCount ?? mine[0].memberCount ?? 0) === 2,
          );
          c.obs.set('sec.xss', false);
        },
      },
    },
  ],
  skip: [
    {
      scenario: /^import\./,
      side: 'wadesk',
      reason:
        'WaDesk has an optional group and applies the CSV column; compared against absolute expectations',
    },
  ],
});
