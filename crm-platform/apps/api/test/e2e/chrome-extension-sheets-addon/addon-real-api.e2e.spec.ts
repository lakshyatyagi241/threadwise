/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installBodyLimits } from '../../../src/modules/platform-infrastructure/body-limits/body-limits';
import { startRemoteAppsScript, type RemoteAppsScript } from '../../support/apps-script-remote';
import { Api, installSheets, rows, startHarness, type Harness, type Tenant } from './support';

/**
 * The UNCHANGED add-on source (`Code.gs` and its dialogs' server functions), run by the Apps Script emulator in a worker thread, talking
 * over real HTTP to the real Nest app with real Postgres and Redis. The emulator stands in for Google only: the menu, dialogs, sheet,
 * properties and triggers are mocks; the CRM side is the real thing. `UrlFetchApp.fetch` is synchronous in Apps Script, so the script runs
 * in a worker that blocks while this thread makes the real request (see test/support/apps-script-remote.ts).
 */
let h: Harness;
let api: Api;
let serverUrl: string;
const VIRTUAL = 'https://api.example.com';
const remotes: RemoteAppsScript[] = [];

beforeAll(async () => {
  h = await startHarness({ configureApp: (app) => installBodyLimits(app as never) });
  api = new Api(h);
  await h.app.listen(0, '127.0.0.1');
  serverUrl = `http://127.0.0.1:${(h.app.getHttpServer().address() as AddressInfo).port}`;
}, 240_000);
afterEach(async () => {
  await Promise.all(remotes.splice(0).map((r) => r.stop()));
});
afterAll(async () => h?.stop());

let ipCounter = 1;

interface Member {
  t: Tenant;
  key: string;
  /** The Webhook URL exactly as the CRM shows it, with the address the add-on believes it talks to. */
  hookUrl: string;
  remote: RemoteAppsScript;
}

/** A workspace with the add-on installed, a member with a key, and the add-on loaded in an emulated spreadsheet. */
async function member(label: string): Promise<Member> {
  const t = await api.signup(label);
  await installSheets(h, t);
  const made = await api.as(t.admin).post('/v2/extension/sheets/key');
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const hookUrl = (made.body.webhookUrl as string).replace(/^https?:\/\/[^/]+/, VIRTUAL);
  const remote = await startRemoteAppsScript({
    serverUrl,
    virtualOrigin: VIRTUAL,
    headers: { 'x-forwarded-for': `10.99.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}` },
  });
  remotes.push(remote);
  return { t, key: made.body.key as string, hookUrl, remote };
}

const page = async <T = any>(m: Member, fn: string, ...args: unknown[]): Promise<T> => {
  const r = await m.remote.callFromClient(fn, ...args);
  expect(r.error, `${fn}: ${r.error}`).toBeNull();
  return r.value as T;
};
const statusColumn = async (m: Member, sheet = 'Leads') => {
  const grid = (await m.remote.grid(sheet)) as unknown[][];
  const col = (grid[0] ?? []).indexOf('CRM status');
  return col < 0 ? null : grid.slice(1).map((r) => r[col]);
};
const contactsOf = (m: Member) => rows(h, 'contacts', m.t);
const webhookPosts = (m: Member) =>
  m.remote.httpLog.filter((r) => r.method === 'post' && r.url.endsWith('/webhook'));

const SETTINGS = (m: Member, extra: Record<string, unknown> = {}) => ({
  url: m.hookUrl,
  sheet: 'Leads',
  column: 'Email',
  onEvent: true,
  onSchedule: true,
  ...extra,
});

describe('Initial Setup against the real CRM', () => {
  it('Send Test records the columns without creating anything, then Submit connects and installs both triggers', async () => {
    const m = await member('addon-setup');
    await m.remote.loadSheet(
      'Leads',
      [
        ['Name', 'Email', 'Phone'],
        ['Ann', 'ann@example.com', ''],
      ],
      { activate: true },
    );
    expect((await m.remote.fireOpen()).ok).toBe(true);
    expect(await m.remote.menuCaptions()).toContain('Initial Setup');
    expect((await m.remote.clickMenu('Initial Setup')).ok).toBe(true);

    expect((await page(m, 'getSettingsState')).hasKey).toBe(false);

    const test = await page(m, 'testWebhook', m.hookUrl, 'Email', 'Leads');
    expect(test).toMatchObject({ ok: true, sheet: 'Leads', sampleRow: true, triggerFound: true });
    expect(test.fields).toEqual(['Name', 'Email', 'Phone']);
    expect(test.user.name).toBeTruthy();
    expect(await contactsOf(m)).toEqual([]);

    // The CRM's own setup page now shows the columns it saw.
    const overview = await api.as(m.t.admin).get('/v2/extension/sheets/overview');
    expect(overview.body.lastCapture).toMatchObject({
      event: 'test',
      sheetName: 'Leads',
      rows: 1,
      fields: ['Name', 'Email', 'Phone'],
    });
    expect(overview.body.lastCapture.sample).toMatchObject({ Email: 'ann@example.com' });

    const saved = await page(m, 'submitSetup', SETTINGS(m));
    expect(saved).toMatchObject({ ok: true, triggers: { onEvent: true, onSchedule: true } });
    expect(saved.masked).toBe(`wsn_live_••••••••${m.key.slice(-8)}`);
    const triggers = (await m.remote.triggerList()) as Array<{ fn: string }>;
    expect(triggers.map((t) => t.fn).sort()).toEqual(['crmOnEditSend', 'crmScheduledSend']);
    expect((await m.remote.properties('user')).CRM_SHEETS_KEY).toBe(m.key);
    expect(await m.remote.properties('document')).not.toHaveProperty('CRM_SHEETS_KEY');
    // Submit again with an empty URL box: the saved connection is kept.
    expect(await page(m, 'submitSetup', SETTINGS(m, { url: '', onEvent: false }))).toMatchObject({
      ok: true,
    });
    expect(((await m.remote.triggerList()) as unknown[]).length).toBe(1);

    // The key is in no log, document property, sheet, dialog or alert, and the CRM never saw it anywhere but the Authorization header.
    expect(await m.remote.everythingVisible()).not.toContain(m.key);
    expect(await m.remote.logText()).toBe('');
    for (const f of (await m.remote.fetchRecords()) as Array<{ url: string; body?: string }>) {
      expect(f.url).not.toContain(m.key);
      expect(f.body ?? '').not.toContain(m.key);
    }
  });

  it('a Webhook URL with a key the CRM does not know is refused with a readable sentence and saves nothing', async () => {
    const m = await member('addon-badkey');
    const wrong = `${VIRTUAL}/api/v1/sheets-addon/webhook/wsn_live_${'0'.repeat(32)}`;
    const r = await page(m, 'saveKey', wrong);
    expect(r).toMatchObject({ ok: false, status: 401, code: 'EXT_KEY_INVALID' });
    expect(r.message).toMatch(/not valid any more/);
    expect(await m.remote.properties('user')).toEqual({});
  });

  it('Check connection (menu) and Send a test row (menu) read the real answers', async () => {
    const m = await member('addon-menu');
    await m.remote.loadSheet(
      'Leads',
      [
        ['Name', 'Email'],
        ['Ann', 'ann@example.com'],
      ],
      { activate: true },
    );
    await m.remote.fireOpen();
    await page(m, 'submitSetup', SETTINGS(m, { onEvent: false, onSchedule: false }));
    await m.remote.clickMenu('Check connection');
    await m.remote.clickMenu('Send a test row');
    const alerts = (await m.remote.alertRecords()) as Array<{ title: string; message: string }>;
    expect(alerts[0]!.message).toMatch(
      /^Connected as .+ \(.+@example\.test\)\.\nWorkspace: .+\n\nThis key can:\n {2}\[x\] pull contacts\n {2}\[x\] push contacts\n {2}\[x\] see shops\n {2}\[x\] sync products$/,
    );
    expect(alerts[1]).toMatchObject({
      title: 'Send a test row',
      message: 'The CRM received the test and saw these columns: Name, Email',
    });
  });
});

describe('rows from the sheet become contacts, once', () => {
  it('an edit posts the row, the CRM creates the contact, and the status column says so', async () => {
    const m = await member('addon-edit');
    await m.remote.loadSheet(
      'Leads',
      [
        ['Name', 'Email', 'Phone'],
        ['Ann', '', ''],
      ],
      { activate: true },
    );
    await m.remote.fireOpen();
    await page(m, 'submitSetup', SETTINGS(m, { onSchedule: false }));
    const edit = await m.remote.fireEdit({
      sheet: 'Leads',
      row: 2,
      col: 2,
      values: 'ann@example.com',
    });
    expect(edit.delivered).toBe(1);
    expect(edit.results[0]).toMatchObject({ ok: true });

    const contacts = await contactsOf(m);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      name: 'Ann',
      email: 'ann@example.com',
      source: 'google_sheets',
      created_by: m.t.adminUserId,
    });
    expect(await statusColumn(m)).toEqual(['created']);
    expect(await m.remote.sheetNames()).toContain('CRM sync state');
    expect((await m.remote.sheetInfo('CRM sync state'))!.hidden).toBe(true);
    expect(webhookPosts(m).map((p) => p.status)).toEqual([200]);
  });

  it('sending the same row again is "unchanged": no second contact, and a changed row updates the same one', async () => {
    const m = await member('addon-idem');
    await m.remote.loadSheet(
      'Leads',
      [
        ['Name', 'Email', 'Phone'],
        ['Ann', 'ann@example.com', ''],
      ],
      { activate: true },
    );
    await m.remote.fireOpen();
    await page(m, 'submitSetup', SETTINGS(m));

    await m.remote.fireEdit({ sheet: 'Leads', row: 2, col: 2, values: 'ann@example.com' });
    const first = await contactsOf(m);
    expect(await statusColumn(m)).toEqual(['created']);

    // The same row delivered again (an edit that changed nothing), by the edit trigger and by the hourly sweep.
    await m.remote.fireEdit({ sheet: 'Leads', row: 2, col: 2 });
    expect(await statusColumn(m)).toEqual(['unchanged']);
    await m.remote.fireTimer();
    expect(await contactsOf(m)).toHaveLength(1);
    expect(((await contactsOf(m))[0] as any).id).toBe((first[0] as any).id);

    // The sweep sends nothing for a row that was already sent.
    const posts = webhookPosts(m).length;
    await m.remote.fireTimer();
    expect(webhookPosts(m)).toHaveLength(posts);

    // A changed row updates the same contact.
    // The name changes; the trigger column is Email, so the row goes out when the email cell is edited.
    await m.remote.loadSheet('Leads', [['Ann Rao']], { at: [2, 1] });
    await m.remote.fireEdit({ sheet: 'Leads', row: 2, col: 2 });
    expect(await statusColumn(m)).toEqual(['updated']);
    const after = await contactsOf(m);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: (first[0] as any).id, name: 'Ann Rao' });
  });

  it('the same person on two rows of one call is one contact', async () => {
    const m = await member('addon-twice');
    await m.remote.loadSheet(
      'Leads',
      [
        ['Name', 'Email', 'Phone'],
        ['Ann', 'ann@example.com', ''],
        ['Ann R', 'ANN@example.com', ''],
      ],
      { activate: true },
    );
    await page(m, 'submitSetup', SETTINGS(m, { onEvent: false }));
    await m.remote.fireTimer();
    expect(await contactsOf(m)).toHaveLength(1);
    expect(await statusColumn(m)).toEqual(['created', 'updated']);
  });

  it('the CRM reasons for a refused row reach the status column in the CRM words', async () => {
    const m = await member('addon-bad');
    await m.remote.loadSheet(
      'Leads',
      [
        ['Name', 'Email', 'Phone'],
        ['A', 'not-an-email', ''],
        ['B', '', 'not a phone'],
        ['C', '', ''],
        ['D', 'd@example.com', ''],
      ],
      { activate: true },
    );
    await page(m, 'submitSetup', SETTINGS(m, { column: '', onEvent: false }));
    await m.remote.fireTimer();
    const statuses = (await statusColumn(m)) as string[];
    expect(statuses[0]).toBe('failed: email: This is not an email address.');
    expect(statuses[1]).toBe('failed: phone: This is not a usable phone number.');
    expect(statuses[2]).toBe('failed: email: Give an email or a phone number.');
    expect(statuses[3]).toBe('created');
    expect((await contactsOf(m)).map((c: any) => c.email)).toEqual(['d@example.com']);
  });

  it('600 rows go out as two chunks, each row once, and all become contacts', async () => {
    const m = await member('addon-600');
    const data: unknown[][] = [['Name', 'Email', 'Phone']];
    for (let i = 1; i <= 600; i++) data.push([`Person ${i}`, `bulk${i}@example.com`, '']);
    await m.remote.loadSheet('Leads', data, { activate: true });
    await page(m, 'submitSetup', SETTINGS(m, { onEvent: false }));
    const [run] = (await m.remote.fireTimer()) as Array<{ ok: boolean; killed: boolean }>;
    expect(run).toMatchObject({ ok: true, killed: false });

    const posts = webhookPosts(m);
    expect(posts.map((p) => JSON.parse(p.body!).rows.length)).toEqual([500, 100]);
    expect(posts.every((p) => p.status === 200)).toBe(true);
    expect(await contactsOf(m)).toHaveLength(600);
    expect((await statusColumn(m))!.every((s) => s === 'created')).toBe(true);
    expect(((await m.remote.grid('CRM sync state')) as unknown[]).length).toBe(600);

    // Nothing is sent again.
    await m.remote.fireTimer();
    expect(webhookPosts(m)).toHaveLength(2);
    expect(await contactsOf(m)).toHaveLength(600);
  }, 120_000);

  it('Push contacts sends the active sheet the way the hourly sweep does, and "unchanged" on a repeat', async () => {
    const m = await member('addon-push');
    await m.remote.loadSheet(
      'Leads',
      [
        ['Name', 'Email', 'Phone', 'attr:City'],
        ['Ann', 'ann@example.com', '+919876543210', 'Pune'],
      ],
      { activate: true },
    );
    await page(m, 'saveKey', m.hookUrl);
    expect(await page(m, 'runPush', {})).toMatchObject({
      ok: true,
      created: 1,
      updated: 0,
      unchanged: 0,
      failed: 0,
    });
    expect(await page(m, 'runPush', {})).toMatchObject({ ok: true, created: 0, unchanged: 1 });
    const [c] = (await contactsOf(m)) as any[];
    expect(c).toMatchObject({ phone: '+919876543210', email: 'ann@example.com' });
    expect(c.data).toMatchObject({ City: 'Pune' });
  });
});

describe('what the member reads when the CRM says no', () => {
  it('a revoked key reads as "not valid any more", in the dialog and in the menu alert, and stops the triggers sending', async () => {
    const m = await member('addon-revoked');
    await m.remote.loadSheet(
      'Leads',
      [
        ['Name', 'Email'],
        ['Ann', 'ann@example.com'],
      ],
      { activate: true },
    );
    await m.remote.fireOpen();
    await page(m, 'submitSetup', SETTINGS(m));
    const revoke = await api.as(m.t.admin).delete('/v2/extension/sheets/key');
    expect(revoke.status).toBe(200);

    const r = await page(m, 'checkConnection');
    expect(r).toMatchObject({ ok: false, status: 401, code: 'EXT_KEY_INVALID' });
    expect(r.message).toBe(
      'The key in your Webhook URL is not valid any more. Create a new one in the CRM (Settings > Google Sheets add-on), then paste the new Webhook URL in Initial Setup.',
    );
    await m.remote.clickMenu('Check connection');
    const alerts = (await m.remote.alertRecords()) as Array<{ message: string }>;
    expect(alerts.at(-1)!.message).toBe(r.message);

    await m.remote.fireEdit({ sheet: 'Leads', row: 2, col: 2, values: 'x@example.com' });
    await m.remote.fireTimer();
    expect(await contactsOf(m)).toEqual([]);
    expect(await m.remote.sheetNames()).not.toContain('CRM sync state');
  });

  it('the per-key limit answers 429 with Retry-After and the add-on reads it', async () => {
    const m = await member('addon-429');
    await page(m, 'saveKey', m.hookUrl);
    // 120 calls a minute per key (SHEETS_KEY_RATE_PER_MINUTE); the connection check above was the first.
    let limited: any = null;
    for (let i = 0; i < 125 && !limited; i++) {
      const r = await page(m, 'checkConnection');
      if (!r.ok) limited = r;
    }
    expect(limited, 'the 121st call in a minute is refused').not.toBeNull();
    expect(limited).toMatchObject({ ok: false, status: 429, code: 'RATE_LIMITED' });
    expect(limited.retryAfter).toBeGreaterThan(0);
    expect(limited.message).toMatch(/^Too many requests\. Wait \d+ seconds and try again\.$/);
    const statuses = m.remote.httpLog.map((r) => r.status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('a role that may not create contacts reads the CRM sentence', async () => {
    const t = await api.signup('addon-role');
    await installSheets(h, t);
    const viewer = await api.member(t, 'viewer', [
      ['app.google-sheets.use'],
      ['record.contacts.read'],
    ]);
    const made = await api.as(viewer.token).post('/v2/extension/sheets/key');
    expect(made.status).toBe(201);
    const remote = await startRemoteAppsScript({
      serverUrl,
      virtualOrigin: VIRTUAL,
      headers: { 'x-forwarded-for': `10.98.0.${ipCounter++ % 250}` },
    });
    remotes.push(remote);
    const m: Member = {
      t,
      key: made.body.key,
      hookUrl: (made.body.webhookUrl as string).replace(/^https?:\/\/[^/]+/, VIRTUAL),
      remote,
    };
    await remote.loadSheet(
      'Leads',
      [
        ['Name', 'Email'],
        ['Ann', 'ann@example.com'],
      ],
      { activate: true },
    );
    const r = await page(m, 'saveKey', m.hookUrl);
    expect(r.ok).toBe(true);
    await remote.fireOpen();
    // The saved check says what this key may do, and the menu hides what it cannot.
    expect(((await remote.menuCaptions()) as string[]).join('|')).not.toMatch(
      /Push contacts|Sync products/,
    );
    const submit = await page(m, 'submitSetup', SETTINGS(m, { onEvent: false }));
    expect(submit.ok).toBe(true);
    await remote.fireTimer();
    expect(await contactsOf(m)).toEqual([]);
  });
});

describe('pull contacts and sync products', () => {
  it('Pull contacts writes the workspace contacts into a "CRM contacts" sheet, newest first, with custom properties as attr: columns', async () => {
    const m = await member('addon-pull');
    await api.seedContacts(m.t, [
      {
        name: '=SUM(1,1)',
        email: 'formula@example.com',
        phone: '+919876543210',
        data: { City: 'Pune' },
      },
      { name: 'Raj', email: 'raj@example.com' },
    ]);
    await m.remote.loadSheet('Leads', [['Name']], { activate: true });
    await page(m, 'saveKey', m.hookUrl);
    const r = await page(m, 'runPull', {});
    expect(r).toMatchObject({ ok: true, pulled: 2, sheet: 'CRM contacts', truncated: false });
    const grid = (await m.remote.grid('CRM contacts')) as string[][];
    expect(grid[0]).toEqual(expect.arrayContaining(['id', 'name', 'email', 'phone', 'attr:City']));
    const nameCol = grid[0]!.indexOf('name');
    const phoneCol = grid[0]!.indexOf('phone');
    const formulaRow = grid.find(
      (row) => row[grid[0]!.indexOf('email')] === 'formula@example.com',
    )!;
    // Kept as text: not evaluated as a formula, and the leading + of the number survives.
    expect(formulaRow[nameCol]).toBe('=SUM(1,1)');
    expect(formulaRow[phoneCol]).toBe('+919876543210');
    expect(formulaRow[grid[0]!.indexOf('attr:City')]).toBe('Pune');
    expect(await m.remote.activeSheetName()).toBe('CRM contacts');
  });

  it('Sync products creates the shop and its products from the active sheet and lists the shop afterwards', async () => {
    const m = await member('addon-products');
    await m.remote.loadSheet(
      'Products',
      [
        ['Name', 'Price', 'SKU', 'Stock'],
        ['Blue Tee', 499, 'TEE-1', 10],
        ['Red Cap', '19.99', 'CAP-1', ''],
      ],
      { activate: true },
    );
    await page(m, 'saveKey', m.hookUrl);
    const r = await page(m, 'runProductSync', {
      shopName: 'Corner Store',
      currency: 'inr',
      description: 'Sheet shop',
    });
    expect(r).toMatchObject({
      ok: true,
      created: 2,
      failed: 0,
      shop: { name: 'Corner Store', created: true },
    });
    expect(await statusColumn(m, 'Products')).toEqual(['created', 'created']);
    const products = await rows(h, 'wa_products', m.t);
    expect(products.map((p: any) => [p.sku, p.price_minor])).toEqual([
      ['TEE-1', 49900],
      ['CAP-1', 1999],
    ]);

    const listing = await page(m, 'listShops');
    expect(listing).toMatchObject({ ok: true, shopName: 'Corner Store' });
    expect(listing.shops.map((s: any) => s.name)).toEqual(['Corner Store']);
    expect((await m.remote.properties('document')).CRM_SHOP_ID).toBe(listing.shopId);

    // A second sync updates in place.
    const again = await page(m, 'runProductSync', {
      shopName: 'Corner Store',
      shopId: listing.shopId,
    });
    expect(again).toMatchObject({ ok: true, created: 0, unchanged: 2 });
    expect(await rows(h, 'wa_products', m.t)).toHaveLength(2);
    expect((await page(m, 'forgetShop')).ok).toBe(true);
  });
});

describe('the emulator is only a stand-in for Google', () => {
  it('records what really went over HTTP: the add-on talked to the real server and only to it', async () => {
    const m = await member('addon-http');
    await page(m, 'saveKey', m.hookUrl);
    const hits = m.remote.httpLog;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((r) => r.url.startsWith(`${serverUrl}/api/v1/sheets-addon/`))).toBe(true);
    expect(hits.every((r) => r.status === 200)).toBe(true);
  });

  it('an address that is not the CRM fails like a DNS error and is reported, not thrown', async () => {
    const m = await member('addon-dns');
    const r = await page(
      m,
      'saveKey',
      `https://elsewhere.example.test/api/v1/sheets-addon/webhook/${m.key}`,
    );
    expect(r).toMatchObject({ ok: false, code: 'NETWORK' });
    expect(r.message).toBe(
      'Could not reach the CRM at https://elsewhere.example.test. Check your connection and try again.',
    );
  });
});
