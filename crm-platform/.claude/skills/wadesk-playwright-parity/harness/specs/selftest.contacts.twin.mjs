// Self-test spec: WaDesk's own "Add contact" modal and Contacts list, used on BOTH sides (reference vs itself, then
// reference vs deliberately broken copies). It doubles as the worked example for references/spec-format.md.
// It is a harness regression test, not a statement about any feature of ours.
export default (h) => {
  const openForm = async (c) => {
    await c.goto('/contacts');
    await c.page
      .getByRole('button', { name: /add contact/i })
      .first()
      .click();
    await c.page.locator('#addContactForm').waitFor({ state: 'visible' });
  };
  const confirmBtn = { role: 'button', name: /^confirm$/i };
  // create one contact through the UI and return the tag that identifies its row
  const seedContact = async (c) => {
    const tag = c.tag('del');
    await openForm(c);
    await c.page.locator('#addContactForm [name=first_name]').fill(tag);
    await c.page.locator('#addContactForm [name=mobile]').fill('9' + c.digits(9));
    await c.page.locator('#addContactForm button[type=submit]').click();
    await c.page.locator('#addContactForm').waitFor({ state: 'hidden', timeout: 8000 });
    return { tag };
  };
  const rowFor = (made, c) => c.page.locator('tbody tr', { hasText: made.tag });
  // delete every contact this harness created (a name field carries the run prefix). Uses the app's own DELETE
  // endpoint with its CSRF token: one request per row instead of one click-through per row.
  const cleanup = async (c) => {
    for (let round = 0; round < 20; round++) {
      await c.goto('/contacts?q=pwp-&per_page=500');
      const ids = await c.page.$$eval('tbody tr button[data-edit-contact]', (bs) =>
        bs.filter((b) => /pwp-/.test(b.dataset.name || '')).map((b) => b.dataset.editContact),
      );
      if (!ids.length) return;
      for (const id of ids) await c.http('DELETE', `/contacts/${id}`);
    }
  };
  return {
    feature: 'adhoc:selftest-wadesk-contacts',
    title: 'Self-test on the WaDesk Contacts screen',
    pages: [
      {
        id: 'contacts-page',
        title: 'Contacts list',
        path: '/contacts',
        ready: 'table',
        probes: h.ALL_PAGE_PROBES,
      },
    ],
    forms: [
      {
        id: 'contact-create',
        title: 'Add contact',
        tagField: ['first_name', 'last_name'],
        open: openForm,
        root: '#addContactForm',
        submit: 'button[type=submit]',
        cancel: { role: 'button', name: /^cancel$/i },
        valid: (c) => ({
          title: { option: 'first' },
          last_name: 'Tester',
          mobile: '9' + c.digits(9),
        }),
        fields: [
          { id: 'title', type: 'select', required: true, loc: '[name=title]' },
          { id: 'first_name', type: 'name', required: true, max: 255, loc: '[name=first_name]' },
          { id: 'middle_name', type: 'name', loc: '[name=middle_name]' },
          { id: 'last_name', type: 'name', loc: '[name=last_name]' },
          {
            id: 'mobile',
            type: 'phone',
            required: true,
            unique: true,
            sample: (c) => '9' + c.digits(9),
            loc: '[name=mobile]',
          },
          { id: 'email', type: 'email', loc: '[name=email]' },
          { id: 'msg', type: 'textarea', loc: '[name=msg]' },
          { id: 'source', type: 'text', loc: '[name=source]' },
        ],
      },
    ],
    deletes: [
      {
        id: 'contact-delete',
        title: 'Delete contact',
        page: '/contacts',
        ready: 'table',
        seed: seedContact,
        row: (made, c) => rowFor(made, c),
        start: async (c, row) => {
          await row.locator('form[data-ajax="delete-contact"] button').first().click();
        },
        confirm: confirmBtn,
        cancel: { role: 'button', name: /^cancel$/i },
      },
    ],
    teardown: { both: cleanup },
  };
};
