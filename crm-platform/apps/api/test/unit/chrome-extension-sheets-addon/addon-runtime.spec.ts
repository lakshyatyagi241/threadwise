/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { AppsScriptHarness, SCOPE } from '../../support/apps-script-harness';
import {
  FAKE_HOOK_URL,
  FAKE_KEY,
  FAKE_ORIGIN,
  fromPage,
  leadsSheet,
  newKit,
  submit,
} from '../../support/apps-script-addon-kit';

/**
 * The add-on's public entry points, driven through the Apps Script emulator: the menu, Initial Setup, Send Test, Submit, the key, and
 * what the member reads when the CRM says no. Code.gs is loaded unchanged; only Google and the CRM are faked.
 */

const ADDON_ITEMS = [
  'Initial Setup',
  'Send a test row',
  'Check connection',
  '---',
  'Pull contacts into a sheet',
  'Push contacts from this sheet',
  '---',
  'Sync products to a shop',
  '---',
  'Help',
];

describe('menu: onOpen and onInstall', () => {
  it('builds the add-on menu with every item before any connection check', () => {
    const { h } = newKit();
    expect(h.fireOpen().ok).toBe(true);
    const menus = h.menus();
    expect(menus).toHaveLength(1);
    expect(menus[0]!.kind).toBe('addon');
    expect(h.menuCaptions()).toEqual(ADDON_ITEMS);
  });

  it('onInstall builds the same menu', () => {
    const { h } = newKit();
    expect(h.fireInstall().ok).toBe(true);
    expect(h.menuCaptions()).toEqual(ADDON_ITEMS);
  });

  it('falls back to a plain "CRM" menu when createAddonMenu is not available', () => {
    const { h } = newKit({ addonMenu: 'unavailable' });
    expect(h.fireOpen().ok).toBe(true);
    const menu = h.menus()[0]!;
    expect(menu.kind).toBe('custom');
    expect(menu.title).toBe('CRM');
    expect(h.menuCaptions('CRM')).toEqual(ADDON_ITEMS);
  });

  it('still builds the menu before the member has authorized the add-on (AuthMode.NONE and LIMITED)', () => {
    for (const authMode of ['NONE', 'LIMITED'] as const) {
      const { h } = newKit();
      const r = h.fireOpen({ authMode });
      expect(r.ok, `${authMode}: ${r.error}`).toBe(true);
      expect(h.menuCaptions()).toEqual(ADDON_ITEMS);
      expect(h.fetchRecords()).toEqual([]);
    }
  });

  it('finishes far inside the 30 seconds a simple trigger gets', () => {
    const { h } = newKit();
    const r = h.fireOpen();
    expect(r.elapsedMs).toBeLessThan(1000);
  });

  it('hides the groups the saved connection check says the key cannot use', () => {
    const { h, crm } = newKit();
    crm.can = {
      read_contacts: true,
      write_contacts: false,
      read_catalog: false,
      write_catalog: false,
    };
    fromPage(h, 'saveKey', FAKE_HOOK_URL);
    expect(h.menuCaptions()).toEqual([
      'Initial Setup',
      'Send a test row',
      'Check connection',
      '---',
      'Pull contacts into a sheet',
      '---',
      'Help',
    ]);
    // The next time the sheet opens, the menu is built from the saved answer.
    h.clearRecords();
    h.fireOpen();
    expect(h.menuCaptions()).not.toContain('Push contacts from this sheet');
    expect(h.menuCaptions()).not.toContain('Sync products to a shop');
  });

  it('names only functions that exist and can be run from a menu click', () => {
    const { h } = newKit();
    h.fireOpen();
    for (const item of h.menus()[0]!.items) {
      if (item.fn) expect(h.hasFunction(item.fn), item.fn).toBe(true);
    }
  });

  it('opens each dialog with the right file, title and size, and hands the page its mode', () => {
    const { h } = newKit();
    h.loadSheet('Leads', [['Email'], ['a@example.com']], { activate: true });
    h.fireOpen();
    const opens: Array<[string, string, number, number, string | null]> = [
      ['Initial Setup', 'Initial Setup', 520, 640, null],
      ['Pull contacts into a sheet', 'Pull contacts', 520, 440, 'pull'],
      ['Push contacts from this sheet', 'Push contacts', 520, 480, 'push'],
      ['Sync products to a shop', 'Sync products to a shop', 520, 560, 'products'],
      ['Help', 'Help', 520, 520, null],
    ];
    for (const [caption, title, width, height, mode] of opens) {
      const r = h.clickMenu(caption);
      expect(r.ok, `${caption}: ${r.error}`).toBe(true);
      const dialog = h.dialogHtml().at(-1)!;
      expect(dialog).toMatchObject({ kind: 'modal', title, width, height });
      if (mode) expect(dialog.html).toContain(`var MODE = '${mode}';`);
      expect(dialog.html).not.toContain('<?');
    }
  });
});

describe('Initial Setup: the connection', () => {
  it('shows a fresh sheet as not connected and lists the sheets without the add-on own ones', () => {
    const { h } = newKit();
    h.loadSheet('Leads', [['Email']]);
    h.loadSheet('CRM contacts', [['id']]);
    h.loadSheet('CRM sync state', [['k', 'v']]);
    const state = fromPage(h, 'getSettingsState');
    expect(state.hasKey).toBe(false);
    expect(state.masked).toBe('');
    expect(state.sheets).toEqual(['Sheet1', 'Leads']);
    expect(state.onEvent).toBe(false);
    expect(state.onSchedule).toBe(false);
  });

  it('saves a pasted Webhook URL after the CRM accepts it, keeping server and key in the member own properties only', () => {
    const { h, crm } = newKit();
    const saved = fromPage(h, 'saveKey', FAKE_HOOK_URL);
    expect(saved.ok).toBe(true);
    expect(saved.user).toMatchObject({ name: 'Asha Rao' });
    expect(saved.masked).toBe(`wsn_live_••••••••${FAKE_KEY.slice(-8)}`);
    expect(h.properties('user')).toMatchObject({
      CRM_SHEETS_KEY: FAKE_KEY,
      CRM_SHEETS_BASE: FAKE_ORIGIN,
    });
    expect(JSON.parse(h.properties('user').CRM_SHEETS_CAN!)).toMatchObject({
      write_contacts: true,
    });
    expect(h.properties('document')).toEqual({});
    expect(h.properties('script')).toEqual({});
    expect(crm.callsTo('/health')).toHaveLength(1);
  });

  it('never sends the key anywhere but the Authorization header', () => {
    const { h } = newKit();
    submit(h, { onEvent: true });
    for (const f of h.fetchRecords()) {
      expect(f.url).not.toContain(FAKE_KEY);
      expect(f.body ?? '').not.toContain(FAKE_KEY);
      expect(f.headers.Authorization).toBe(`Bearer ${FAKE_KEY}`);
    }
  });

  it('never leaves the key in a log, a document property, a sheet, a dialog or an alert, and never returns it to a page', () => {
    const { h } = newKit();
    leadsSheet(h, 3);
    h.fireOpen();
    submit(h, { onEvent: true, onSchedule: true, column: 'B' });
    for (const [fn, args] of [
      ['getSettingsState', []],
      ['getDialogState', []],
      ['checkConnection', []],
      ['testWebhook', [FAKE_HOOK_URL, 'B', 'Leads']],
    ] as const) {
      const out = JSON.stringify(h.callFromClient(fn, ...args));
      expect(out, fn).not.toContain(FAKE_KEY);
    }
    h.clickMenu('Send a test row');
    h.clickMenu('Check connection');
    h.clickMenu('Initial Setup');
    h.fireEdit({ sheet: 'Leads', row: 2, col: 2, values: 'changed@example.com' });
    h.fireTimer();
    expect(h.everythingVisible()).not.toContain(FAKE_KEY);
    expect(h.logText()).toBe('');
  });

  it('shows only a masked copy in the settings state', () => {
    const { h } = newKit();
    submit(h);
    const state = fromPage(h, 'getSettingsState');
    expect(state.hasKey).toBe(true);
    expect(state.masked).toBe(`wsn_live_••••••••${FAKE_KEY.slice(-8)}`);
    expect(state.base).toBe(FAKE_ORIGIN);
    expect(state.masked).not.toContain(FAKE_KEY.slice(9, 24));
  });

  it('refuses text that is not a Webhook URL, with a sentence that says what to paste', () => {
    const { h, crm } = newKit();
    const empty = fromPage(h, 'saveKey', '   ');
    expect(empty).toMatchObject({
      ok: false,
      code: 'EXT_KEY_MISSING',
      message: 'Paste your Webhook URL first.',
    });
    const bad = fromPage(h, 'saveKey', 'https://example.com/hello');
    expect(bad.code).toBe('EXT_KEY_INVALID');
    expect(bad.message).toMatch(/Settings > Google Sheets add-on/);
    expect(crm.calls).toEqual([]);
    expect(h.properties('user')).toEqual({});
  });

  it('does not keep a key the CRM rejects, and keeps the earlier working one', () => {
    const { h, crm } = newKit();
    fromPage(h, 'saveKey', FAKE_HOOK_URL);
    const other = `wsn_live_${'ab'.repeat(16)}`;
    const failed = fromPage(h, 'saveKey', `${FAKE_ORIGIN}/api/v1/sheets-addon/webhook/${other}`);
    expect(failed).toMatchObject({ ok: false, code: 'EXT_KEY_INVALID', status: 401 });
    expect(failed.message).toMatch(/not valid any more/);
    expect(h.properties('user').CRM_SHEETS_KEY).toBe(FAKE_KEY);
    expect(h.properties('user').CRM_SHEETS_BASE).toBe(FAKE_ORIGIN);
    // And a first-time failure leaves nothing behind.
    const fresh = newKit();
    fresh.crm.key = other;
    expect(fromPage(fresh.h, 'saveKey', FAKE_HOOK_URL).ok).toBe(false);
    expect(fresh.h.properties('user')).toEqual({});
    expect(crm.calls.length).toBeGreaterThan(0);
  });

  it('removes the key, what it learned and both triggers, and shows the full menu again', () => {
    const { h } = newKit();
    submit(h, { onEvent: true, onSchedule: true });
    expect(h.triggerList()).toHaveLength(2);
    expect(fromPage(h, 'clearKey')).toEqual({ ok: true });
    expect(h.properties('user')).toEqual({});
    expect(h.triggerList()).toEqual([]);
    expect(h.properties('document')).toMatchObject({
      CRM_HOOK_EVENT: 'off',
      CRM_HOOK_SCHEDULE: 'off',
    });
    expect(fromPage(h, 'getSettingsState').hasKey).toBe(false);
  });
});

describe('the Webhook URL, as pasted', () => {
  const parse = (h: AppsScriptHarness, text: unknown) =>
    h.evaluate<any>(`parseConnection_(${JSON.stringify(text)})`);
  const hook = (origin: string, key = FAKE_KEY) => `${origin}/api/v1/sheets-addon/webhook/${key}`;

  it('accepts the URL with a trailing slash, surrounding spaces and a path prefix, and splits server from key', () => {
    const { h } = newKit();
    expect(parse(h, hook('https://crm.example.test'))).toEqual({
      base: 'https://crm.example.test',
      key: FAKE_KEY,
    });
    expect(parse(h, `  ${hook('https://crm.example.test')}/\n`)).toEqual({
      base: 'https://crm.example.test',
      key: FAKE_KEY,
    });
    expect(parse(h, hook('https://crm.example.test:8443'))).toEqual({
      base: 'https://crm.example.test:8443',
      key: FAKE_KEY,
    });
    expect(parse(h, hook('https://example.test/crm'))).toEqual({
      base: 'https://example.test/crm',
      key: FAKE_KEY,
    });
    expect(parse(h, hook('https://CRM.Example.TEST'))).toEqual({
      base: 'https://CRM.Example.TEST',
      key: FAKE_KEY,
    });
  });

  it('accepts a bare key and then uses the address written into the downloaded copy', () => {
    const { h } = newKit();
    expect(parse(h, FAKE_KEY)).toEqual({ base: '', key: FAKE_KEY });
    expect(parse(h, ` ${FAKE_KEY}\n`)).toEqual({ base: '', key: FAKE_KEY });
  });

  it.each([
    ['plain http', hook('http://crm.example.test')],
    ['a query string', `${hook('https://crm.example.test')}?x=1`],
    ['a fragment', `${hook('https://crm.example.test')}#top`],
    ['an uppercase key', hook('https://crm.example.test', FAKE_KEY.toUpperCase())],
    ['a short key', hook('https://crm.example.test', 'wsn_live_abc')],
    ['a key with 33 characters', hook('https://crm.example.test', `${FAKE_KEY}0`)],
    ['the wrong path', `https://crm.example.test/api/v2/sheets-addon/webhook/${FAKE_KEY}`],
    ['no host', `https:///api/v1/sheets-addon/webhook/${FAKE_KEY}`],
    ['two URLs pasted', `${hook('https://a.example.test')} ${hook('https://b.example.test')}`],
    ['a space inside', `https://crm.example.test /api/v1/sheets-addon/webhook/${FAKE_KEY}`],
    ['a number', 12345],
    ['nothing', undefined],
    ['null', null],
  ])('rejects %s', (_label, text) => {
    const { h } = newKit();
    expect(parse(h, text)).toBeNull();
  });

  it('a pasted address on another host is the server used from then on', () => {
    const { h, crm } = newKit();
    // The fake only answers on its own origin, so a wrong host fails like a DNS error.
    const r = fromPage(h, 'saveKey', hook('https://wrong.example.test'));
    expect(r).toMatchObject({ ok: false, code: 'NETWORK' });
    expect(r.message).toBe(
      'Could not reach the CRM at https://wrong.example.test. Check your connection and try again.',
    );
    expect(h.fetchRecords().map((f) => f.failed)).toEqual([
      'DNS error: https://wrong.example.test/api/v1/sheets-addon/health',
    ]);
    expect(crm.sentRows()).toEqual([]);
    expect(h.properties('user')).toEqual({});
  });
});

describe('Send Test', () => {
  it('sends row 2 as a test, reports the columns the CRM saw and writes nothing into the sheet', () => {
    const { h, crm } = newKit();
    leadsSheet(h, 2);
    const before = h.grid('Leads');
    const r = fromPage(h, 'testWebhook', FAKE_HOOK_URL, 'B', 'Leads');
    expect(r).toMatchObject({ ok: true, sheet: 'Leads', sampleRow: true, triggerFound: true });
    expect(r.fields).toEqual(['Name', 'Email', 'Phone']);
    expect(r.user.name).toBe('Asha Rao');
    expect(h.grid('Leads')).toEqual(before);
    expect(h.sheetNames()).not.toContain('CRM sync state');
    const call = crm.callsTo('/webhook')[0]!;
    expect(call.event).toBe('test');
    expect(call.rows).toBe(1);
    // Nothing is saved: the connection is checked with the pasted key without storing it.
    expect(h.properties('user')).toEqual({});
  });

  it('sends the headings alone when the sheet has no data row yet', () => {
    const { h } = newKit();
    h.loadSheet('Leads', [['Name', 'Email']], { activate: true });
    const r = fromPage(h, 'testWebhook', FAKE_HOOK_URL, '', 'Leads');
    expect(r).toMatchObject({ ok: true, sampleRow: false, triggerFound: true });
    expect(r.fields).toEqual(['Name', 'Email']);
  });

  it('says when the trigger column is not in row 1', () => {
    const { h } = newKit();
    leadsSheet(h, 1);
    expect(fromPage(h, 'testWebhook', FAKE_HOOK_URL, 'Company', 'Leads').triggerFound).toBe(false);
    expect(fromPage(h, 'testWebhook', FAKE_HOOK_URL, 'Email', 'Leads').triggerFound).toBe(true);
  });

  it('uses the saved connection when the URL box is left empty, as the page promises ("Leave it empty to keep the saved one")', () => {
    const { h } = newKit();
    leadsSheet(h, 1);
    submit(h);
    const r = fromPage(h, 'testWebhook', '', '', 'Leads');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.fields).toEqual(['Name', 'Email', 'Phone']);
  });

  it('the menu item sends a test with the saved key and shows the columns in an alert', () => {
    const { h } = newKit();
    leadsSheet(h, 1);
    submit(h);
    const r = h.clickMenu('Send a test row');
    expect(r.ok).toBe(true);
    expect(h.alertRecords().at(-1)).toMatchObject({
      title: 'Send a test row',
      message: 'The CRM received the test and saw these columns: Name, Email, Phone',
    });
  });

  it('the menu item says how to connect when no key is saved', () => {
    const { h } = newKit();
    h.fireOpen();
    h.clickMenu('Send a test row');
    expect(h.alertRecords().at(-1)!.message).toBe(
      'No Webhook URL is saved yet. Open Initial Setup and paste the Webhook URL from the CRM.',
    );
  });

  it('the menu item works when the server is plain http (a local installation), which the pasted-URL pattern refuses', () => {
    const { h, crm } = newKit({ crmBase: 'http://localhost:3999' });
    crm.key = FAKE_KEY;
    // The download rewrote CRM_BASE to the installation's address; the member pastes only the key.
    h.setProperty('user', 'CRM_SHEETS_KEY', FAKE_KEY);
    h.setProperty('user', 'CRM_SHEETS_BASE', 'http://localhost:3999');
    leadsSheet(h, 1);
    h.fireOpen();
    const seen: string[] = [];
    h.fetchHandler = (req) => {
      seen.push(req.url);
      return crm.handler({ ...req, url: req.url.replace('http://localhost:3999', FAKE_ORIGIN) });
    };
    h.clickMenu('Send a test row');
    expect(h.alertRecords().at(-1)!.message).toMatch(/^The CRM received the test/);
    expect(seen.every((u) => u.startsWith('http://localhost:3999/api/v1/sheets-addon/'))).toBe(
      true,
    );
  });
});

describe('Submit: the edit and hourly triggers', () => {
  const handlers = (h: AppsScriptHarness) =>
    h
      .triggerList()
      .map((t) => `${t.fn}:${t.event}`)
      .sort();

  it('installs the edit trigger on this spreadsheet and the hourly one, and remembers the choices in the document', () => {
    const { h } = newKit();
    leadsSheet(h, 1);
    const r = submit(h, { column: 'B', onEvent: true, onSchedule: true });
    expect(r).toMatchObject({ ok: true, triggers: { onEvent: true, onSchedule: true } });
    expect(handlers(h)).toEqual(['crmOnEditSend:ON_EDIT', 'crmScheduledSend:CLOCK']);
    const edit = h.triggerList().find((t) => t.fn === 'crmOnEditSend')!;
    expect(edit.sourceId).toBe(h.spreadsheetId());
    expect(h.properties('document')).toEqual({
      CRM_HOOK_SHEET: 'Leads',
      CRM_HOOK_COLUMN: 'B',
      CRM_HOOK_EVENT: 'on',
      CRM_HOOK_SCHEDULE: 'on',
    });
    expect(h.properties('user')).not.toHaveProperty('CRM_HOOK_COLUMN');
  });

  it('is idempotent: submitting again keeps one trigger of each kind', () => {
    const { h } = newKit();
    leadsSheet(h, 1);
    for (let i = 0; i < 3; i++) submit(h, { onEvent: true, onSchedule: true });
    expect(handlers(h)).toEqual(['crmOnEditSend:ON_EDIT', 'crmScheduledSend:CLOCK']);
  });

  it('removes a trigger when its box is unticked, and only that one', () => {
    const { h } = newKit();
    leadsSheet(h, 1);
    submit(h, { onEvent: true, onSchedule: true });
    submit(h, { onEvent: false, onSchedule: true });
    expect(handlers(h)).toEqual(['crmScheduledSend:CLOCK']);
    submit(h, { onEvent: true, onSchedule: false });
    expect(handlers(h)).toEqual(['crmOnEditSend:ON_EDIT']);
    submit(h, {});
    expect(handlers(h)).toEqual([]);
  });

  it('cleans up duplicate triggers left by an older version', () => {
    const { h } = newKit();
    leadsSheet(h, 1);
    for (let i = 0; i < 3; i++) {
      h.evaluate(
        `ScriptApp.newTrigger('crmOnEditSend').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create()`,
      );
    }
    expect(h.triggerList()).toHaveLength(3);
    submit(h, { onEvent: true });
    expect(handlers(h)).toEqual(['crmOnEditSend:ON_EDIT']);
  });

  it('does not touch triggers that belong to other functions', () => {
    const { h } = newKit();
    leadsSheet(h, 1);
    h.evaluate(`ScriptApp.newTrigger('onOpen').timeBased().everyHours(1).create()`);
    submit(h, { onEvent: true });
    submit(h, {});
    expect(handlers(h)).toEqual(['onOpen:CLOCK']);
  });

  it('answers with a readable message when Google refuses the triggers (20 per user per script), after saving the connection', () => {
    const { h } = newKit();
    leadsSheet(h, 1);
    for (let i = 0; i < 20; i++)
      h.evaluate(`ScriptApp.newTrigger('onOpen').timeBased().everyHours(1).create()`);
    const r = submit(h, { onEvent: true });
    expect(r).toMatchObject({ ok: false, code: 'TRIGGERS' });
    expect(r.message).toMatch(
      /^Saved, but Google did not let the add-on create its triggers: .*too many triggers/,
    );
    expect(h.properties('user').CRM_SHEETS_KEY).toBe(FAKE_KEY);
  });

  it('survives a manifest without the scriptapp scope by saying so instead of crashing', () => {
    const { h } = newKit({
      scopes: [SCOPE.containerUi, SCOPE.externalRequest, SCOPE.spreadsheetsCurrentOnly],
    });
    leadsSheet(h, 1);
    const r = submit(h, { onEvent: true });
    expect(r).toMatchObject({ ok: false, code: 'TRIGGERS' });
    expect(r.message).toContain('script.scriptapp');
  });

  it('can be submitted again without pasting the URL: the saved connection is kept and the new settings apply', () => {
    const { h } = newKit();
    leadsSheet(h, 1);
    submit(h, { column: 'B', onEvent: false });
    const again = submit(h, { url: '', column: 'C', onEvent: true });
    expect(again.ok, JSON.stringify(again)).toBe(true);
    expect(h.properties('document')).toMatchObject({ CRM_HOOK_COLUMN: 'C', CRM_HOOK_EVENT: 'on' });
    expect(h.properties('user').CRM_SHEETS_KEY).toBe(FAKE_KEY);
    expect(h.triggerList()).toHaveLength(1);
  });

  it('refuses a blank URL when nothing is saved yet', () => {
    const { h } = newKit();
    const r = submit(h, { url: '' });
    expect(r).toMatchObject({ ok: false, code: 'EXT_KEY_MISSING' });
  });
});

describe('what the member reads when the CRM says no', () => {
  const message = (h: AppsScriptHarness) => fromPage(h, 'checkConnection');

  it('401: the key is not valid any more', () => {
    const { h, crm } = newKit();
    submit(h);
    crm.key = 'wsn_live_' + 'f'.repeat(32);
    const r = message(h);
    expect(r).toMatchObject({
      ok: false,
      status: 401,
      code: 'EXT_KEY_INVALID',
      requestId: 'req-401',
    });
    expect(r.message).toBe(
      'The key in your Webhook URL is not valid any more. Create a new one in the CRM (Settings > Google Sheets add-on), then paste the new Webhook URL in Initial Setup.',
    );
  });

  it('403 EXT_APP_NOT_INSTALLED and EXT_SCOPE_NOT_GRANTED', () => {
    const { h, crm } = newKit();
    submit(h);
    crm.answerNext({
      status: 403,
      body: JSON.stringify({ ok: false, code: 'EXT_APP_NOT_INSTALLED', error: 'x' }),
    });
    expect(message(h).message).toBe(
      'The Google Sheets add-on is not installed in this workspace. Ask an admin to install it from the Marketplace.',
    );
    crm.answerNext({
      status: 403,
      body: JSON.stringify({
        ok: false,
        code: 'EXT_SCOPE_NOT_GRANTED',
        error: 'No contacts permission.',
      }),
    });
    expect(message(h).message).toBe(
      'No contacts permission. Ask an admin to reinstall the add-on and accept its permissions.',
    );
  });

  it('403 for a role: the server sentence is shown as it is', () => {
    const { h, crm } = newKit();
    submit(h);
    crm.answerNext({
      status: 403,
      body: JSON.stringify({
        ok: false,
        code: 'FORBIDDEN',
        error: 'Your role does not allow you to create or edit contacts.',
      }),
    });
    expect(message(h).message).toBe('Your role does not allow you to create or edit contacts.');
  });

  it('413: asks for fewer rows', () => {
    const { h, crm } = newKit();
    submit(h);
    crm.answerNext({
      status: 413,
      body: JSON.stringify({ ok: false, code: 'PAYLOAD_TOO_LARGE', error: 'big' }),
    });
    expect(message(h).message).toBe('The request was too large. Send fewer rows at a time.');
    crm.answerNext({ status: 413, body: '<html>Request Entity Too Large</html>' });
    expect(message(h).message).toBe('The request was too large. Send fewer rows at a time.');
  });

  it('429 with a short Retry-After: waits and tries again, up to twice, then gives up with the time to wait', () => {
    const { h, crm } = newKit();
    submit(h);
    h.clearRecords();
    const limited = {
      status: 429,
      headers: { 'Retry-After': '2' },
      body: JSON.stringify({ ok: false, code: 'RATE_LIMITED', error: 'slow' }),
    };
    crm.answerNext(limited);
    const start = h.now();
    const ok = message(h);
    expect(ok.ok).toBe(true);
    expect(h.now() - start).toBeGreaterThanOrEqual(2000);
    expect(h.fetchRecords().map((f) => f.status)).toEqual([429, 200]);

    h.clearRecords();
    crm.answerNext(limited);
    crm.answerNext(limited);
    crm.answerNext(limited);
    const failed = message(h);
    expect(failed).toMatchObject({ ok: false, status: 429, retryAfter: 2 });
    expect(failed.message).toBe('Too many requests. Wait 2 seconds and try again.');
    expect(h.fetchRecords()).toHaveLength(3);
  });

  it('429 with a long Retry-After or none: does not wait inside the script', () => {
    const { h, crm } = newKit();
    submit(h);
    h.clearRecords();
    crm.answerNext({ status: 429, headers: { 'retry-after': '90' }, body: '{}' });
    const start = h.now();
    expect(message(h).message).toBe('Too many requests. Wait 90 seconds and try again.');
    expect(h.now() - start).toBeLessThan(2000);
    crm.answerNext({ status: 429, body: '{}' });
    expect(message(h).message).toBe('Too many requests. Wait a minute and try again.');
    expect(h.fetchRecords()).toHaveLength(2);
  });

  it('a 5xx with an HTML body still reads as a sentence, and a reference when the server gave one', () => {
    const { h, crm } = newKit();
    submit(h);
    crm.answerNext({ status: 502, body: '<html>Bad gateway</html>' });
    expect(message(h)).toMatchObject({
      ok: false,
      code: 'HTTP_502',
      message: 'The CRM could not complete the request.',
    });
    crm.answerNext({
      status: 500,
      body: JSON.stringify({
        ok: false,
        code: 'INTERNAL',
        error: 'Something broke.',
        requestId: 'r-9',
      }),
    });
    expect(message(h)).toMatchObject({
      code: 'INTERNAL',
      message: 'Something broke.',
      requestId: 'r-9',
    });
  });

  it('a 200 that is not the add-on envelope is a failure, not a success', () => {
    const { h, crm } = newKit();
    submit(h);
    crm.answerNext({ status: 200, body: '<html>captive portal</html>' });
    expect(message(h).ok).toBe(false);
    crm.answerNext({ status: 200, body: JSON.stringify({ ok: false, code: 'X', error: 'no' }) });
    expect(message(h)).toMatchObject({ ok: false, code: 'X' });
  });

  it('a network exception from UrlFetchApp (DNS, refused) is caught and named', () => {
    const { h, crm } = newKit();
    submit(h);
    crm.failNextWithNetworkError();
    expect(message(h)).toMatchObject({
      ok: false,
      code: 'NETWORK',
      message: `Could not reach the CRM at ${FAKE_ORIGIN}. Check your connection and try again.`,
    });
  });

  it('Google daily fetch quota used up: says so instead of blaming the connection', () => {
    const { h } = newKit({ limits: { urlFetchCallsPerDay: 3 } });
    submit(h);
    h.setUrlFetchCalls(3);
    const r = message(h);
    expect(r).toMatchObject({ ok: false, code: 'QUOTA' });
    expect(r.message).toMatch(/limit for web requests/i);
  });

  it('Check connection (menu) shows who is connected, and the failure sentence otherwise', () => {
    const { h, crm } = newKit();
    submit(h);
    h.clickMenu('Check connection');
    expect(h.alertRecords().at(-1)!.message).toBe(
      'Connected as Asha Rao (asha@example.test).\nWorkspace: Acme Co\n\nThis key can:\n  [x] pull contacts\n  [x] push contacts\n  [x] see shops\n  [x] sync products',
    );
    crm.key = 'wsn_live_' + '1'.repeat(32);
    h.clickMenu('Check connection');
    expect(h.alertRecords().at(-1)!.message).toMatch(/not valid any more/);
    const none = newKit();
    none.h.fireOpen();
    none.h.clickMenu('Check connection');
    expect(none.h.alertRecords().at(-1)!.message).toMatch(/No Webhook URL is saved yet/);
  });
});

describe('the page-to-script boundary', () => {
  it('every function a page calls returns something Google can carry back (no Dates, no functions)', () => {
    const { h } = newKit();
    leadsSheet(h, 2);
    submit(h, { onEvent: true });
    for (const fn of ['getSettingsState', 'getDialogState', 'checkConnection', 'listShops']) {
      const r = h.callFromClient(fn);
      expect(r.ok, `${fn}: ${r.error}`).toBe(true);
    }
  });

  it('refuses a call to a private function, as Google does', () => {
    const { h } = newKit();
    const r = h.callFromClient('readKey_');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/private/);
  });
});
