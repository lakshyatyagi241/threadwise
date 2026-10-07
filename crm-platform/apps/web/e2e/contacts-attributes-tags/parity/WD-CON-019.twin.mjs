// WD-CON-019 twin: Contact Hub bulk update, visible Import and Columns, import from a group, the stage board, and the
// time zone dropdown of scheduled campaigns. WaDesk's menus and screens are structured differently, so the scenarios run
// on ours only (absolute expectations); the page probes run on both.
const mine = (c) => c.tag('hub');
const phone = (n) => `+9198765${String(10000 + n).slice(-5)}`;
const makeContact = async (c, name, n) => {
  const r = await c.http('POST', '/v2/contacts', { data: { name, phone: phone(n) } });
  const id = r.body?.id;
  if (id) c.onCleanup(() => c.deleteOwned(`/v2/contacts/${id}`, { name }));
  return { id, status: r.status };
};
const na = async (c) => c.obs.info('n/a', 'no counterpart');

export default (h) => ({
  feature: 'WD-CON-019',
  title: 'Contact Hub: bulk update, Import/Columns, board view, group import; campaign time zone',
  pages: [
    {
      id: 'groups',
      title: 'Groups',
      path: '/contact-groups',
      ready: { wadesk: 'body', ours: 'main' },
      probes: ['load', 'a11y', 'auth'],
    },
  ],
  scenarios: [
    {
      id: 'hub.visible-actions',
      title: 'Import and Columns are labelled buttons on the Hub; Groups has Import',
      tags: ['ours'],
      run: {
        wadesk: na,
        ours: async (c) => {
          await c.goto('/contacts', { ready: 'main' });
          c.obs.flag(
            'flag.hub.import-button',
            (await c.page.getByRole('button', { name: 'Import', exact: true }).count()) === 1,
          );
          c.obs.flag(
            'flag.hub.columns-button',
            (await c.page.getByRole('button', { name: /^Columns/ }).count()) === 1,
          );
          await c.page.getByRole('button', { name: /^Columns/ }).click();
          c.obs.flag(
            'flag.hub.add-field-item',
            (await c.page.getByRole('menuitem', { name: /custom field as a column/i }).count()) ===
              1,
          );
          await c.page.keyboard.press('Escape');
          await c.page.getByRole('button', { name: 'Import', exact: true }).click();
          c.obs.flag('flag.hub.import-opens', await c.page.getByRole('dialog').isVisible());
          await c.goto('/contact-groups', { ready: 'main' });
          c.obs.flag(
            'flag.groups.import-header',
            (await c.page.getByRole('button', { name: 'Import contacts' }).count()) === 1,
          );
          c.obs.set('sec.xss', false);
        },
      },
    },
    {
      id: 'hub.bulk-update',
      title:
        'Update on selected contacts changes the chosen field on all of them (test contacts are removed after)',
      tags: ['ours', 'write'],
      run: {
        wadesk: na,
        ours: async (c) => {
          const base = mine(c);
          const a = await makeContact(c, `${base}-a`, 1);
          const b = await makeContact(c, `${base}-b`, 2);
          c.obs.status('status.seed', Math.max(a.status, b.status));
          await c.goto(`/contacts?q=${encodeURIComponent(base)}`, { ready: 'main' });
          await c.page.waitForTimeout(1500);
          await c.page
            .getByLabel(new RegExp(`${base}-a`))
            .first()
            .check();
          await c.page
            .getByLabel(new RegExp(`${base}-b`))
            .first()
            .check();
          await c.page.getByRole('button', { name: 'More Actions' }).first().click();
          await c.page.getByRole('menuitem', { name: 'Update' }).click();
          const dlg = c.page.getByRole('dialog');
          await dlg.waitFor();
          c.obs.flag(
            'flag.update.apply-disabled-when-nothing',
            await dlg.getByRole('button', { name: /^Update 2/ }).isDisabled(),
          );
          await dlg.getByLabel('Stage').selectOption({ index: 2 });
          const done = c.page
            .waitForResponse((r) => /\/contacts\/bulk\/update/.test(r.url()), { timeout: 15000 })
            .catch(() => null);
          await dlg.getByRole('button', { name: /^Update 2/ }).click();
          const r = await done;
          c.obs.status('status.update.api', r ? r.status() : 0);
          const body = r ? await r.json().catch(() => ({})) : {};
          c.obs.flag(
            'flag.update.both-succeeded',
            (body.succeeded ?? []).length === 2 && (body.failed ?? []).length === 0,
          );
          c.obs.set('sec.xss', false);
        },
      },
    },
    {
      id: 'groups.import-preselects-group',
      title: 'Import from a group card opens the import with that group chosen',
      tags: ['ours', 'write'],
      run: {
        wadesk: na,
        ours: async (c) => {
          const name = mine(c);
          const g = await c.http('POST', '/v2/contact-groups', { data: { name } });
          c.obs.status('status.group.create', g.status);
          if (g.body?.id)
            c.onCleanup(() => c.deleteOwned(`/v2/contact-groups/${g.body.id}`, { name }));
          await c.goto('/contact-groups', { ready: 'main' });
          const card = c.page
            .locator('div', { hasText: name })
            .filter({ has: c.page.getByRole('button', { name: 'Import', exact: true }) })
            .last();
          await card.getByRole('button', { name: 'Import', exact: true }).click();
          const dlg = c.page.getByRole('dialog');
          await dlg.waitFor();
          const chosen = await dlg
            .locator('select')
            .evaluateAll(
              (els, n) => els.some((e) => e.options[e.selectedIndex]?.text.startsWith(n)),
              name,
            );
          c.obs.flag('flag.import.group-preselected', chosen);
          c.obs.set('sec.xss', false);
        },
      },
    },
    {
      id: 'hub.board-view',
      title: 'The board view shows one column per stage; a card moves with its stage list',
      tags: ['ours', 'write'],
      run: {
        wadesk: na,
        ours: async (c) => {
          const base = mine(c);
          const a = await makeContact(c, `${base}-card`, 3);
          c.obs.status('status.seed', a.status);
          await c.goto(`/contacts?q=${encodeURIComponent(base)}`, { ready: 'main' });
          await c.page.getByRole('button', { name: /board view/i }).click();
          const board = c.page.getByRole('list', { name: 'Contacts by stage' });
          await board.waitFor();
          const cols = await board
            .getByRole('listitem')
            .filter({ has: c.page.locator('h3') })
            .count();
          c.obs.flag('flag.board.has-columns', cols >= 3);
          const card = board.getByRole('link', { name: `${base}-card` });
          await card.waitFor();
          c.obs.flag('flag.board.card-shown', (await card.count()) === 1);
          const before = (await c.http('GET', `/v2/contacts/${a.id}`)).body?.lifecycleStage;
          const move = c.page.getByLabel(new RegExp(`Move ${base}-card to stage`));
          const saved = c.page
            .waitForResponse(
              (r) => /^(PUT|PATCH)$/.test(r.request().method()) && /\/contacts\//.test(r.url()),
              { timeout: 15000 },
            )
            .catch(() => null);
          await move.selectOption({ index: 2 });
          const r = await saved;
          c.obs.status('status.move.api', r ? r.status() : 0);
          await c.page.waitForTimeout(1500);
          const in2 = await board.getByRole('link', { name: `${base}-card` }).count();
          c.obs.flag('flag.board.moved-once', in2 === 1);
          const after = (await c.http('GET', `/v2/contacts/${a.id}`)).body?.lifecycleStage;
          c.obs.flag('flag.board.stage-changed', Boolean(after) && after !== before);
          c.obs.set('sec.xss', false);
        },
      },
    },
    {
      id: 'campaign.timezone-dropdown',
      title: 'Scheduling a campaign for later shows the time zone as a dropdown, not a text box',
      tags: ['ours'],
      run: {
        wadesk: na,
        ours: async (c) => {
          await c.goto('/campaigns/create', { ready: 'main' });
          await c.page.getByRole('radio', { name: /^Schedule/ }).click();
          const tz = c.page.locator('#camp-tz');
          await tz.waitFor({ timeout: 8000 }).catch(() => null);
          c.obs.flag('flag.tz.exists', (await tz.count()) === 1);
          c.obs.flag(
            'flag.tz.is-select',
            (await tz.evaluate((e) => e?.tagName === 'SELECT').catch(() => false)) === true,
          );
          c.obs.flag(
            'flag.tz.many-options',
            (await tz
              .locator('option')
              .count()
              .catch(() => 0)) > 100,
          );
          c.obs.set('sec.xss', false);
        },
      },
    },
  ],
  skip: [
    {
      scenario: /^(hub|groups\.|campaign)/,
      side: 'wadesk',
      reason:
        'WaDesk menus and screens are structured differently; compared against absolute expectations',
    },
  ],
});
