// WD-API-140..148 twin: the workspace's Webhooks screen. WaDesk's webhook management lives in its integrations UI and API; the
// structure differs, so the scenarios run on ours only (absolute expectations); the page probes run on both.
const na = async (c) => c.obs.info('n/a', 'different screen');
const URL_OK = 'https://192.0.2.10/hook'; // RFC 5737 documentation range: public for the guard, never routable.

export default (h) => ({
  feature: 'WD-API-140',
  title: 'Outbound webhooks: the Webhooks screen',
  pages: [
    {
      id: 'webhooks',
      title: 'Webhooks',
      path: { wadesk: '/webhooks', ours: '/webhooks' },
      ready: { wadesk: 'body', ours: 'main' },
      probes: ['load', 'a11y', 'auth', 'degraded'],
    },
  ],
  scenarios: [
    {
      id: 'webhooks.tile-and-page',
      title: 'The Settings tile is live (not Soon) and opens the page',
      tags: ['ours'],
      run: {
        wadesk: na,
        ours: async (c) => {
          await c.goto('/settings/integrations', { ready: 'main' });
          c.obs.flag(
            'flag.tile.is-link',
            (await c.page.getByRole('link', { name: /Webhooks/ }).count()) >= 1,
          );
          await c.goto('/webhooks', { ready: 'main' });
          await c.page.getByRole('heading', { name: 'Webhooks', level: 1 }).waitFor();
          c.obs.flag(
            'flag.page.add-button',
            (await c.page.getByRole('button', { name: 'Add webhook' }).first().count()) === 1,
          );
          c.obs.set('sec.xss', false);
        },
      },
    },
    {
      id: 'webhooks.validation',
      title:
        'The form names what is wrong with the URL and the events; a private address is refused by the server',
      tags: ['ours', 'edge'],
      run: {
        wadesk: na,
        ours: async (c) => {
          await c.goto('/webhooks', { ready: 'main' });
          await c.page.getByRole('button', { name: 'Add webhook' }).first().click();
          const dlg = c.page.getByRole('dialog');
          await dlg.waitFor();
          await dlg.getByRole('button', { name: 'Add webhook' }).click();
          c.obs.flag(
            'flag.form.empty-url-error',
            (await dlg.getByText('Enter the endpoint URL.').count()) === 1,
          );
          await dlg.getByLabel(/Endpoint URL/).fill('http://192.0.2.10/hook');
          await dlg.getByRole('button', { name: 'Add webhook' }).click();
          c.obs.flag(
            'flag.form.http-error',
            (await dlg.getByText('The URL must start with https://.').count()) === 1,
          );
          await dlg.getByLabel(/Endpoint URL/).fill('https://127.0.0.1/hook');
          await dlg.getByLabel('All events').uncheck();
          await dlg.getByRole('button', { name: 'Add webhook' }).click();
          c.obs.flag(
            'flag.form.pick-events-error',
            (await dlg.getByText(/Pick at least one event/).count()) === 1,
          );
          await dlg.getByLabel('Contact created').check();
          await dlg.getByRole('button', { name: 'Add webhook' }).click();
          await c.page.waitForTimeout(1200);
          c.obs.flag(
            'flag.form.private-refused',
            (await dlg.getByText(/private or reserved|internal/i).count()) >= 1,
          );
          c.obs.set('sec.xss', false);
        },
      },
    },
    {
      id: 'webhooks.lifecycle',
      title: 'Add, test, see the log, switch off and delete (the test endpoint is removed after)',
      tags: ['ours', 'write'],
      run: {
        wadesk: na,
        ours: async (c) => {
          const name = c.tag('hook');
          await c.goto('/webhooks', { ready: 'main' });
          await c.page.getByRole('button', { name: 'Add webhook' }).first().click();
          const dlg = c.page.getByRole('dialog');
          await dlg.waitFor();
          await dlg.getByLabel('Name').fill(name);
          await dlg.getByLabel(/Endpoint URL/).fill(URL_OK);
          await dlg.getByLabel('Signing secret').fill('s3cret-value');
          await dlg.getByLabel('All events').uncheck();
          await dlg.getByLabel('Contact created').check();
          await dlg.getByLabel('Task created').check();
          const made = c.page
            .waitForResponse(
              (r) => r.request().method() === 'POST' && /\/webhooks$/.test(r.url()),
              { timeout: 15000 },
            )
            .catch(() => null);
          await dlg.getByRole('button', { name: 'Add webhook' }).click();
          const r = await made;
          c.obs.status('status.create', r ? r.status() : 0);
          const body = r ? await r.json().catch(() => ({})) : {};
          if (body?.id) c.onCleanup(() => c.deleteOwned(`/v2/webhooks/${body.id}`, { name }));
          c.obs.flag(
            'flag.create.secret-not-echoed',
            !JSON.stringify(body).includes('s3cret-value'),
          );
          const row = c.page.getByRole('listitem').filter({ hasText: name });
          await row.waitFor({ timeout: 8000 });
          c.obs.flag(
            'flag.row.shown-with-events',
            (await row.getByText('Contact created').count()) === 1 &&
              (await row.getByText('Task created').count()) === 1,
          );
          c.obs.flag('flag.row.signed-badge', (await row.getByText('Signed').count()) === 1);

          await row.getByRole('button', { name: 'Send test' }).click();
          await c.page
            .getByText(/The test (failed|was delivered)/)
            .first()
            .waitFor({ timeout: 25000 });
          await row.getByRole('button', { name: 'Deliveries' }).click();
          const log = c.page.getByRole('dialog');
          await log.waitFor();
          await log
            .getByRole('table')
            .waitFor({ timeout: 8000 })
            .catch(() => null);
          c.obs.flag(
            'flag.log.has-test-row',
            (await log.getByRole('cell', { name: 'Test', exact: true }).count()) >= 1,
          );
          await log.getByRole('button', { name: 'Close' }).first().click();

          await row.getByRole('switch').click();
          await c.page.waitForTimeout(1200);
          c.obs.flag(
            'flag.row.switched-off',
            (await row.getByText('Off', { exact: true }).count()) === 1,
          );

          await row.getByRole('button', { name: 'Delete' }).click();
          await c.page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
          await c.page.waitForTimeout(1500);
          c.obs.flag(
            'flag.row.deleted',
            (await c.page.getByRole('listitem').filter({ hasText: name }).count()) === 0,
          );
          c.obs.set('sec.xss', false);
        },
      },
    },
  ],
  skip: [
    {
      scenario: /^webhooks\./,
      side: 'wadesk',
      reason:
        'WaDesk manages webhooks in its own integrations screens; compared against absolute expectations',
    },
  ],
});
