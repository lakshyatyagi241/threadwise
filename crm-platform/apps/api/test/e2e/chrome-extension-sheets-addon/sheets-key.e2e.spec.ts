import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Api,
  addon,
  generateKey,
  installSheets,
  memberWithKey,
  rows,
  startHarness,
  uninstallSheets,
  type Harness,
} from './support';

/**
 * A member's personal Sheets key (TW-EXT-001 to 003, 005, 006): create, replace, look at, revoke, with the secret shown once and only its
 * hash kept, and the setup page and source download around it. Real Postgres and Redis, the real app.
 */
let h: Harness;
let api: Api;
let sourceDir: string;

beforeAll(async () => {
  sourceDir = mkdtempSync(join(tmpdir(), 'sheets-src-'));
  writeFileSync(
    join(sourceDir, 'Code.gs'),
    "const CRM_BASE = 'https://placeholder.invalid';\nfunction onOpen() {}\n",
  );
  writeFileSync(join(sourceDir, 'appsscript.json'), '{"timeZone":"UTC"}');
  process.env.EXT_SHEETS_ADDON_DIR = sourceDir;
  h = await startHarness();
  api = new Api(h);
}, 240_000);

afterAll(async () => {
  delete process.env.EXT_SHEETS_ADDON_DIR;
  rmSync(sourceDir, { recursive: true, force: true });
  await h?.stop();
});

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const keyApi = (token: string) => api.as(token);

describe('creating a key', () => {
  it('is refused until the workspace has installed the add-on, and says why on the setup page', async () => {
    const t = await api.signup('ek-noinst');
    const res = await keyApi(t.admin).post('/v2/extension/sheets/key');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EXT_APP_NOT_INSTALLED');

    const page = await keyApi(t.admin).get('/v2/extension/sheets/overview');
    expect(page.status, JSON.stringify(page.body)).toBe(200);
    expect(page.body).toMatchObject({
      installed: false,
      blockers: ['not_installed'],
      key: { active: false, suffix: null, masked: null },
      can: { readContacts: false, writeContacts: false, readCatalog: false, writeCatalog: false },
    });
  });

  it('shows the secret once, in the Reference format, and keeps only its hash and last 8 characters', async () => {
    const t = await api.signup('ek-once');
    await installSheets(h, t);
    const res = await keyApi(t.admin).post('/v2/extension/sheets/key');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.headers['cache-control']).toContain('no-store');
    const key = res.body.key as string;
    expect(key).toMatch(/^wsn_live_[0-9a-f]{32}$/);
    expect(res.body).toMatchObject({
      active: true,
      rotated: false,
      suffix: key.slice(-8),
      masked: `wsn_live_••••••••${key.slice(-8)}`,
      lastUsedAt: null,
    });

    const [row] = await rows(h, 'user_settings', t, `user_id = ${t.adminUserId}`);
    expect(row.sheets_key_hash).toBe(sha256(key));
    expect(row.sheets_key_suffix).toBe(key.slice(-8));
    expect(JSON.stringify(row)).not.toContain(key);

    // The status and the setup page never carry the secret again.
    const status = await keyApi(t.admin).get('/v2/extension/sheets/key');
    expect(status.body).toMatchObject({ active: true, suffix: key.slice(-8) });
    expect(JSON.stringify(status.body)).not.toContain(key);
    const page = await keyApi(t.admin).get('/v2/extension/sheets/overview');
    expect(page.body.installed).toBe(true);
    expect(JSON.stringify(page.body)).not.toContain(key);
  });

  it('writes an audit row and an outbox event that name the member and the suffix, never the secret', async () => {
    const t = await api.signup('ek-audit');
    await installSheets(h, t);
    const key = await generateKey(api, t.admin);
    const audit = await rows(h, 'audit_log', t, `module = 'ext_sheets_key'`);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'insert',
      actor_type: 'user',
      actor_id: t.adminUserId,
    });
    expect(JSON.stringify(audit[0].delta)).toContain(key.slice(-8));
    const outbox = await rows(h, 'event_outbox', t, `aggregate_module = 'ext_sheets_key'`);
    expect(outbox.map((o) => o.event_type)).toEqual(['ext.sheets_key.generated']);
    expect(JSON.stringify([audit, outbox])).not.toContain(key);
  });

  it('replaces the previous key at once: one active key per member', async () => {
    const t = await api.signup('ek-rotate');
    await installSheets(h, t);
    const first = await generateKey(api, t.admin);
    expect((await addon(h, first).get('/health')).status).toBe(200);

    const res = await keyApi(t.admin).post('/v2/extension/sheets/key');
    expect(res.body.rotated).toBe(true);
    const second = res.body.key as string;
    expect(second).not.toBe(first);

    const old = await addon(h, first).get('/health');
    expect(old.status).toBe(401);
    expect(old.body).toMatchObject({ ok: false, code: 'EXT_KEY_INVALID' });
    expect((await addon(h, second).get('/health')).status).toBe(200);
    expect(
      await rows(
        h,
        'user_settings',
        t,
        `user_id = ${t.adminUserId} AND sheets_key_hash IS NOT NULL`,
      ),
    ).toHaveLength(1);
    const audit = await rows(h, 'audit_log', t, `module = 'ext_sheets_key'`);
    expect(audit.map((a) => a.action).sort()).toEqual(['insert', 'update']);
  });

  it('gives each member their own key, and one member revoking does not touch another', async () => {
    const t = await api.signup('ek-two');
    await installSheets(h, t);
    const a = await memberWithKey(api, t, 'ann');
    const b = await memberWithKey(api, t, 'bob');
    expect(a.key).not.toBe(b.key);

    const ha = await addon(h, a.key).get('/health');
    const hb = await addon(h, b.key).get('/health');
    expect(ha.body.user.email).not.toBe(hb.body.user.email);

    expect((await keyApi(a.session).delete('/v2/extension/sheets/key')).status).toBe(200);
    expect((await addon(h, a.key).get('/health')).status).toBe(401);
    expect((await addon(h, b.key).get('/health')).status).toBe(200);
  });

  it('needs the role permission to create a key, but not to look at or revoke one', async () => {
    const t = await api.signup('ek-perm');
    await installSheets(h, t);
    const m = await api.member(t, 'noperm', [['record.contacts.read']]);
    const denied = await keyApi(m.token).post('/v2/extension/sheets/key');
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('FORBIDDEN');
    expect((await keyApi(m.token).get('/v2/extension/sheets/overview')).status).toBe(403);
    expect((await keyApi(m.token).get('/v2/extension/sheets/key')).body.active).toBe(false);
    expect((await keyApi(m.token).delete('/v2/extension/sheets/key')).status).toBe(200);
  });

  it('answers 401 with no session', async () => {
    expect((await api.http().post('/v2/extension/sheets/key')).status).toBe(401);
    expect((await api.http().get('/v2/extension/sheets/key')).status).toBe(401);
    expect((await api.http().delete('/v2/extension/sheets/key')).status).toBe(401);
  });
});

describe('revoking a key', () => {
  it('stops the add-on on its next call, clears every key column, and is safe to press twice', async () => {
    const t = await api.signup('ek-revoke');
    await installSheets(h, t);
    const key = await generateKey(api, t.admin);
    expect((await addon(h, key).get('/health')).status).toBe(200);

    const res = await keyApi(t.admin).delete('/v2/extension/sheets/key');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      active: false,
      suffix: null,
      masked: null,
      createdAt: null,
      lastUsedAt: null,
    });
    expect((await addon(h, key).get('/health')).status).toBe(401);
    const [row] = await rows(h, 'user_settings', t, `user_id = ${t.adminUserId}`);
    expect([
      row.sheets_key_hash,
      row.sheets_key_suffix,
      row.sheets_key_created_at,
      row.sheets_key_last_used_at,
    ]).toEqual([null, null, null, null]);

    expect((await keyApi(t.admin).delete('/v2/extension/sheets/key')).status).toBe(200);
    const audit = await rows(h, 'audit_log', t, `module = 'ext_sheets_key' AND action = 'delete'`);
    expect(audit).toHaveLength(1);
    const events = await rows(h, 'event_outbox', t, `event_type = 'ext.sheets_key.revoked'`);
    expect(events).toHaveLength(1);
  });

  it('works after the add-on is uninstalled, so a member can always switch their key off', async () => {
    const t = await api.signup('ek-uninst');
    await installSheets(h, t);
    const key = await generateKey(api, t.admin);
    await uninstallSheets(h, t);
    expect((await addon(h, key).get('/health')).body.code).toBe('EXT_APP_NOT_INSTALLED');
    expect((await keyApi(t.admin).delete('/v2/extension/sheets/key')).body.active).toBe(false);
  });

  it('records when the add-on last used the key, at most once a minute', async () => {
    const t = await api.signup('ek-used');
    await installSheets(h, t);
    const key = await generateKey(api, t.admin);
    expect((await keyApi(t.admin).get('/v2/extension/sheets/key')).body.lastUsedAt).toBeNull();
    await addon(h, key).get('/health');
    await new Promise((r) => setTimeout(r, 500));
    const first = (await keyApi(t.admin).get('/v2/extension/sheets/key')).body.lastUsedAt as string;
    expect(first).toBeTruthy();
    await addon(h, key).get('/health');
    await new Promise((r) => setTimeout(r, 500));
    expect((await keyApi(t.admin).get('/v2/extension/sheets/key')).body.lastUsedAt).toBe(first);
  });
});

describe('the setup page and the source download', () => {
  it('tells the member what their role lets the add-on do, and lists the files', async () => {
    const t = await api.signup('ek-page');
    await installSheets(h, t);
    const viewer = await api.member(t, 'viewer', [
      ['app.google-sheets.use'],
      ['record.contacts.read'],
    ]);
    const page = await keyApi(viewer.token).get('/v2/extension/sheets/overview');
    expect(page.status, JSON.stringify(page.body)).toBe(200);
    expect(page.body.can).toEqual({
      readContacts: true,
      writeContacts: false,
      readCatalog: false,
      writeCatalog: false,
    });
    expect(page.body.shops).toEqual([]);
    expect(page.body.apiBase).toBe('http://localhost:3999');
    expect(page.body.marketplaceUrl).toContain('workspace.google.com');
    const names = page.body.files.map((f: { name: string }) => f.name);
    expect(names).toEqual([
      'Code.gs',
      'Dialog.html',
      'Settings.html',
      'Help.html',
      'appsscript.json',
      'README.md',
    ]);
    expect(page.body.files[0]).toMatchObject({ available: true });
    expect(page.body.files[1]).toMatchObject({ available: false, sizeBytes: 0 });
  });

  it('serves Code.gs already pointing at this installation, as a download', async () => {
    const t = await api.signup('ek-file');
    await installSheets(h, t);
    const res = await keyApi(t.admin).get('/v2/extension/sheets/files/Code.gs');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="Code.gs"');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-type']).toContain('text/javascript');
    expect(res.text).toContain("const CRM_BASE = 'http://localhost:3999';");
    expect(res.text).not.toContain('placeholder.invalid');
    expect((await keyApi(t.admin).get('/v2/extension/sheets/files/appsscript.json')).status).toBe(
      200,
    );
  });

  it('answers 404 for a file that is not one of the six, or not on the server yet, and 403 without the permission', async () => {
    const t = await api.signup('ek-file404');
    await installSheets(h, t);
    for (const name of ['secret.txt', '..%2Fpackage.json', 'Dialog.html']) {
      expect((await keyApi(t.admin).get(`/v2/extension/sheets/files/${name}`)).status, name).toBe(
        404,
      );
    }
    const m = await api.member(t, 'nofiles', [['record.contacts.read']]);
    expect((await keyApi(m.token).get('/v2/extension/sheets/files/Code.gs')).status).toBe(403);
    expect((await api.http().get('/v2/extension/sheets/files/Code.gs')).status).toBe(401);
  });
});

describe('the admin has the permission by default', () => {
  it('the workspace admin can create a key without any grant being added', async () => {
    const t = await api.signup('ek-admin');
    await installSheets(h, t);
    expect((await keyApi(t.admin).post('/v2/extension/sheets/key')).status).toBe(201);
  });
});
