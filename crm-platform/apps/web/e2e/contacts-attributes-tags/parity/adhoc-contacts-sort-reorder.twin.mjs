// Ours-only: the contacts table sorts from its column headers and the columns can be rearranged.
const sortedLike = (list, dir) =>
  JSON.stringify(list) ===
  JSON.stringify(
    [...list].sort((a, b) => dir * a.localeCompare(b, undefined, { sensitivity: 'base' })),
  );

// An empty workspace shows the empty state, so each scenario makes a few tagged contacts and removes only those.
async function seed(c) {
  for (const [i, label] of ['mango', 'Apple', 'cherry'].entries()) {
    const res = await c.http('POST', '/v2/contacts', {
      data: {
        name: c.tag(label),
        phone: `+91${9 - i}${c.digits(9)}`,
        email: `${label.toLowerCase()}-${c.tag('e')}@example.test`,
      },
    });
    const made = res.body ?? (await res.json?.());
    if (c.isMine(made)) c.onCleanup(() => c.deleteOwned(`/v2/contacts/${made.id}`, made));
  }
}

export default () => ({
  feature: 'adhoc:contacts-sort-reorder',
  title: 'Contacts: sort by column, rearrange columns',
  pages: [],
  scenarios: [
    {
      id: 'contacts-sort.header-click',
      title: 'Name header sorts A to Z, Z to A, then back; the URL follows',
      tags: ['edge'],
      run: async (c) => {
        const o = c.obs;
        await seed(c);
        await c.goto('/contacts', { ready: 'main' });
        const header = c.page.locator('thead').getByRole('button', { name: /contact name/i });
        await header.waitFor();
        const names = async () =>
          (
            await c.page.locator('tbody tr td:nth-child(2) a[href^="/contacts/"]').allInnerTexts()
          ).map((s) => s.trim());
        await header.click();
        await c.page.waitForURL(/sort=name/);
        await c.afterAction({ quiet: 500 });
        o.flag('sort.ascOrdered', sortedLike(await names(), 1));
        o.flag(
          'sort.ariaAscending',
          (await c.page.locator('th[aria-sort="ascending"]').count()) === 1,
        );
        await header.click();
        await c.page.waitForURL(/order=desc|sort=name(?!.*order=asc)/);
        await c.afterAction({ quiet: 500 });
        o.flag('sort.descOrdered', sortedLike(await names(), -1));
        await header.click();
        await c.afterAction({ quiet: 500 });
        o.flag('sort.backToDefault', !c.page.url().includes('sort='));
        o.flag(
          'sort.tagsNotSortable',
          (await c.page.locator('thead').getByRole('button', { name: /tags/i }).count()) === 0,
        );
      },
    },
    {
      id: 'contacts-columns.drag-reorder',
      title: 'Dragging a header moves the column, it survives a reload, and name stays first',
      tags: ['edge'],
      run: async (c) => {
        const o = c.obs;
        await seed(c);
        await c.goto('/contacts', { ready: 'main' });
        await c.page.evaluate(() => localStorage.removeItem('cat:contacts:column-order'));
        await c.page.reload();
        const th = c.page.locator('thead th[scope=col]');
        await th.first().waitFor();
        const heads = async () => (await th.allInnerTexts()).map((s) => s.trim().toLowerCase());
        const before = await heads();
        await th.filter({ hasText: /email/i }).dragTo(th.filter({ hasText: /phone/i }));
        await c.afterAction({ quiet: 300 });
        const after = await heads();
        const at = (re) => after.findIndex((h) => re.test(h));
        o.flag('reorder.emailBeforePhone', at(/email/) < at(/phone/));
        o.flag('reorder.nameFirst', /name/.test(after[0]));
        o.flag('reorder.changed', JSON.stringify(before) !== JSON.stringify(after));
        await c.page.reload();
        await th.first().waitFor();
        o.flag('reorder.persists', JSON.stringify(await heads()) === JSON.stringify(after));
        o.flag('reorder.nameNotDraggable', (await th.first().getAttribute('draggable')) !== 'true');
        await c.page.evaluate(() => localStorage.removeItem('cat:contacts:column-order'));
      },
    },
  ],
});
