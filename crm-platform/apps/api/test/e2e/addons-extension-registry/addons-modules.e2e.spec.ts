import request from 'supertest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { PlatformSettingsService } from '../../../src/modules/auth';
import { EngineConnectionService } from '../../../src/modules/addons-extension-registry';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';
import { makeZip, manifestJson } from '../../unit/addons-extension-registry/zip-fixture';

/**
 * The module side of the add-on domain end to end: engine connections (WD-ADD-017..021, 022), what modules add to
 * navigation and to the plan catalogue (012, 013, 014), in-place modules (009, 010) and the workspace catalogue
 * (033). A stub engine on loopback plays the sibling product; the guard that normally refuses loopback is switched
 * off for this file only.
 */
let h: Harness;
let modulesDir: string;
let engine: Server;
let engineUrl = '';
/** What the stub engine answers and how often it was asked. */
const stub = { status: 200, calls: 0, secrets: [] as string[] };
const api = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
let superToken = '';
const ops = (m: 'get' | 'post' | 'patch' | 'delete', p: string) =>
  api()[m](`/v2/platform${p}`).set(bearer(superToken));

beforeAll(async () => {
  modulesDir = mkdtempSync(join(tmpdir(), 'addons-mod-e2e-'));
  Object.assign(process.env, {
    ADDONS_DIR: modulesDir,
    ADDONS_REGISTRY_TTL_MS: '0',
    ADDONS_ALLOW_PRIVATE_ENGINE_URLS: 'true',
  });
  engine = createServer((req, res) => {
    stub.calls += 1;
    const secret = String(
      req.headers['x-instaflow-secret'] ?? req.headers['x-mailtrixy-secret'] ?? '',
    );
    stub.secrets.push(secret);
    res.statusCode = stub.status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((r) => engine.listen(0, '127.0.0.1', r));
  engineUrl = `http://127.0.0.1:${(engine.address() as AddressInfo).port}`;

  h = await startHarness();
  const first = await api()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await api().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  await api()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: hotp(base32Decode(setup.body.secret), totpStep(Date.now())) });
  superToken = token;
}, 240_000);

afterAll(async () => {
  engine?.close();
  await h?.stop();
  rmSync(modulesDir, { recursive: true, force: true });
});

const drop = (slug: string, manifest: Record<string, unknown>) => {
  mkdirSync(join(modulesDir, slug), { recursive: true });
  writeFileSync(join(modulesDir, slug, 'extension.json'), JSON.stringify({ slug, ...manifest }));
};

const connect = (engineKey: 'instagram' | 'email', body: Record<string, unknown>) =>
  ops('post', `/extensions/engines/${engineKey}/connect`).send(body);
const page = async () => (await ops('get', '/extensions')).body;

describe('engine connections (WD-ADD-017 to 020)', () => {
  it('connects when the engine answers: saved, connected, brand kept, secret never returned', async () => {
    stub.status = 200;
    const res = await connect('instagram', {
      url: `${engineUrl}/`,
      brand: 'InstaMagic',
      secret: 's3cret',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ ok: true, message: 'InstaMagic connected.' });
    expect(res.body.engine).toMatchObject({
      url: engineUrl,
      brand: 'InstaMagic',
      connected: true,
      hasSecret: true,
    });
    expect(JSON.stringify(res.body)).not.toContain('s3cret');
    expect(stub.secrets.at(-1)).toBe('s3cret');
  });

  it('a blank secret re-tests with the stored one', async () => {
    const res = await connect('instagram', { url: engineUrl, brand: '' });
    expect(res.body.ok).toBe(true);
    expect(stub.secrets.at(-1)).toBe('s3cret');
  });

  it('a 401 leaves the URL saved and the engine not connected, with the reason', async () => {
    stub.status = 401;
    const res = await connect('instagram', {
      url: engineUrl,
      brand: 'InstaMagic',
      secret: 'wrong',
    });
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toBe(
      'InstaMagic not connected - Secret rejected by InstaMagic (HTTP 401).',
    );
    const s = (await page()).engines.instagram;
    expect(s).toMatchObject({ url: engineUrl, connected: false });
    expect(s.lastError).toContain('Secret rejected');
    stub.status = 200;
  });

  it('refuses an address with credentials, and a support operator cannot connect', async () => {
    const bad = await connect('instagram', { url: 'http://user:pw@127.0.0.1:9' });
    expect(bad.status).toBe(422);
    const sup = await api()
      .post('/v2/platform/auth/login')
      .send({ email: 'support@platform.test', password: OPERATOR_PASSWORD });
    const res = await api()
      .post('/v2/platform/extensions/engines/instagram/connect')
      .set(bearer(sup.body.tokens.accessToken))
      .send({ url: engineUrl });
    expect(res.status).toBe(403);
  });

  it('disconnect wipes the URL and the secret, keeps the brand, and is idempotent', async () => {
    await connect('instagram', { url: engineUrl, brand: 'InstaMagic', secret: 's3cret' });
    const res = await ops('post', '/extensions/engines/instagram/disconnect');
    expect(res.body).toMatchObject({ ok: true, message: 'InstaMagic disconnected.' });
    expect(res.body.engine).toMatchObject({
      url: '',
      connected: false,
      hasSecret: false,
      brand: 'InstaMagic',
    });
    expect((await ops('post', '/extensions/engines/instagram/disconnect')).status).toBe(200);
  });

  it('audits connect and disconnect without any secret', async () => {
    const rows = await h.owner.query(
      `SELECT event, payload::text AS payload FROM security_events WHERE event LIKE 'platform.engine.instagram.%'`,
    );
    const events = rows.rows.map((r: { event: string }) => r.event);
    expect(events).toEqual(
      expect.arrayContaining([
        'platform.engine.instagram.connect',
        'platform.engine.instagram.disconnect',
      ]),
    );
    for (const r of rows.rows as Array<{ payload: string }>) {
      expect(r.payload).not.toContain('s3cret');
      expect(r.payload).not.toContain('wrong');
    }
  });

  it('email: a blank secret with none stored fails without calling the engine; with one it connects', async () => {
    const before = stub.calls;
    const none = await connect('email', { url: engineUrl });
    expect(none.body.ok).toBe(false);
    expect(none.body.message).toContain('Could not verify a MailTrixy deployment');
    expect(stub.calls).toBe(before);
    const ok = await connect('email', { url: engineUrl, secret: 'mail-secret' });
    expect(ok.body).toMatchObject({ ok: true, message: 'MailTrixy connected.' });
    expect(stub.secrets.at(-1)).toBe('mail-secret');
    // the Instagram card is unaffected by the email connection
    expect((await page()).engines.instagram.connected).toBe(false);
    const off = await ops('post', '/extensions/engines/email/disconnect');
    expect(off.body.engine).toMatchObject({ url: '', connected: false, hasSecret: false });
  });
});

describe('one Instagram engine at a time (WD-ADD-021) and its teardown (022)', () => {
  it('a running native module blocks the remote engine; a deactivated one does not', async () => {
    drop('instagram', { name: 'Instagram', version: '1.0.0' });
    expect((await page()).engines.instagram.blockedByNative).toBe(true);
    const blocked = await connect('instagram', { url: engineUrl, secret: 'x' });
    expect(blocked.status).toBe(409);
    expect(JSON.stringify(blocked.body)).toContain('ADD_ENGINE_CONFLICT');

    const off = await ops('post', '/extensions/modules/instagram/toggle');
    expect(off.body.active).toBe(false);
    // one predicate for the page and the server: the card is no longer blocked and the connect is accepted
    expect((await page()).engines.instagram.blockedByNative).toBe(false);
    const ok = await connect('instagram', { url: engineUrl, secret: 'x' });
    expect(ok.body.ok).toBe(true);
  });

  it('when the native module is gone, a self-wired connection is cleared and a remote one is kept', async () => {
    const engines = h.app.get(EngineConnectionService);
    // still present (deactivated): nothing to reconcile
    expect(await engines.reconcileNativeInstagram()).toBe(false);

    rmSync(join(modulesDir, 'instagram'), { recursive: true, force: true });
    expect(existsSync(join(modulesDir, 'instagram'))).toBe(false);
    // the connection from the previous test points at 127.0.0.1, i.e. at this very machine: self-wired
    expect(await engines.reconcileNativeInstagram()).toBe(true);
    expect((await page()).engines.instagram.connected).toBe(false);
    expect(await engines.reconcileNativeInstagram()).toBe(false);

    await h.owner.query(
      `UPDATE platform_settings
       SET value = jsonb_set(value, '{instagram}', '{"url":"https://engine.example.com","connected":true}'::jsonb)
       WHERE key = 'addons.engines'`,
    );
    // the settings are read through a short-lived snapshot; this write bypassed the service
    h.app.get(PlatformSettingsService).invalidate();
    expect(await engines.reconcileNativeInstagram()).toBe(false);
    expect((await page()).engines.instagram).toMatchObject({
      url: 'https://engine.example.com',
      connected: true,
    });
  });
});

describe('in-place modules (WD-ADD-009, 010)', () => {
  it('lists a folder-only module, deactivates it without deleting files, and re-activates it', async () => {
    drop('field_notes', { name: 'Field notes', version: '2.1.0' });
    const listed = (await page()).modules.find((m: { slug: string }) => m.slug === 'field_notes');
    expect(listed).toMatchObject({ name: 'Field notes', version: '2.1.0', active: true });

    const off = await ops('post', '/extensions/modules/field_notes/toggle');
    expect(off.body).toMatchObject({ ok: true, active: false });
    expect(existsSync(join(modulesDir, 'field_notes', 'extension.json'))).toBe(true);
    expect(existsSync(join(modulesDir, 'field_notes', '.disabled'))).toBe(true);
    expect(
      (await page()).modules.find((m: { slug: string }) => m.slug === 'field_notes').active,
    ).toBe(false);

    const on = await ops('post', '/extensions/modules/field_notes/toggle');
    expect(on.body.active).toBe(true);
    expect(existsSync(join(modulesDir, 'field_notes', '.disabled'))).toBe(false);
  });

  it('refuses an unknown slug and a slug that would climb out of the folder', async () => {
    expect((await ops('post', '/extensions/modules/nothing_here/toggle')).status).toBe(404);
    expect((await ops('post', '/extensions/modules/..%2Fetc/toggle')).status).toBe(404);
  });

  it('a package-installed module is switched on its own row, not by a marker', async () => {
    const zip = makeZip([
      {
        name: 'extension.json',
        data: manifestJson({ slug: 'row_mod', name: 'Row', version: '1.0.0' }),
      },
    ]);
    await api()
      .post('/v2/platform/extensions/upload')
      .set(bearer(superToken))
      .field('purchaseCode', 'abc')
      .attach('extension', zip, 'p.zip');
    expect((await ops('post', '/extensions/modules/row_mod/toggle')).status).toBe(409);
    // and it is not listed twice (the row is authoritative)
    const p = await page();
    expect(p.modules.map((m: { slug: string }) => m.slug)).not.toContain('row_mod');
    expect(p.extensions.map((m: { slug: string }) => m.slug)).toContain('row_mod');
  });
});

describe('what modules add to navigation and to the plan catalogue (WD-ADD-012, 013, 014)', () => {
  const manifest = {
    name: 'Reports',
    version: '1.0.0',
    nav: {
      admin: [
        { key: 'reports', href: '/admin/reports', label: 'Reports' },
        { key: 'no_href', label: 'Broken' },
        { key: 'offsite', href: 'https://evil.example/steal', label: 'Off-site' },
      ],
    },
    plan_features: { access_reports: { label: 'Reports', group: 'Analytics' } },
    plan_limits: {
      report_exports: { label: 'Report exports', group: 'Analytics', default: null },
      report_seats: { label: 'Report seats', default: 0 },
    },
  };
  const upload = () =>
    api()
      .post('/v2/platform/extensions/upload')
      .set(bearer(superToken))
      .field('purchaseCode', 'abc')
      .attach(
        'extension',
        makeZip([{ name: 'extension.json', data: manifestJson({ slug: 'reports', ...manifest }) }]),
        'r.zip',
      );

  it('an active module adds its nav (valid items only, hrefs forced onto this app) and its plan fields', async () => {
    expect((await upload()).status).toBeLessThan(300);
    const nav = (await ops('get', '/extensions/nav')).body;
    const keys = nav.admin.map((n: { key: string }) => n.key);
    expect(keys).toContain('reports');
    expect(keys).not.toContain('no_href');
    expect(nav.admin.find((n: { key: string }) => n.key === 'offsite').href).toBe('/steal');
    expect(nav.admin.find((n: { key: string }) => n.key === 'reports')).toMatchObject({
      module: 'reports',
      label: 'Reports',
    });

    const fields = (await ops('get', '/addons/fields')).body;
    expect(fields.features).toContainEqual(
      expect.objectContaining({
        key: 'access_reports',
        label: 'Reports',
        group: 'Analytics',
        source: 'reports',
      }),
    );
    const limit = fields.limits.find((l: { key: string }) => l.key === 'report_exports');
    // unlimited is null, not 0
    expect(limit.default).toBeNull();
    expect(fields.limits.find((l: { key: string }) => l.key === 'report_seats').default).toBe(0);
    expect(Array.isArray(fields.currencies)).toBe(true);
  });

  it('a pack can grant the module flag; switching the module off removes it at once, and an unlisted key is dropped', async () => {
    const make = (features: string[]) =>
      ops('post', '/addons').send({
        name: `Reports pack ${features.length}`,
        amount: '5',
        currency: 'USD',
        features,
      });
    const ok = await make(['access_reports']);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.grants.features).toEqual(['access_reports']);

    const row = (await page()).extensions.find((e: { slug: string }) => e.slug === 'reports');
    const off = await ops('post', `/extensions/${row.id}/toggle`).send({
      rowVersion: row.rowVersion,
    });
    expect(off.body.status).toBe('disabled');
    // the very next request sees it: nothing stale
    const nav = (await ops('get', '/extensions/nav')).body.admin.map((n: { key: string }) => n.key);
    expect(nav).not.toContain('reports');
    const fields = (await ops('get', '/addons/fields')).body;
    expect(fields.features.map((f: { key: string }) => f.key)).not.toContain('access_reports');
    const dropped = await make(['access_reports']);
    expect(dropped.body.grants.features).toEqual([]);
  });

  it('a removed module contributes nothing and the nav answers for an empty registry', async () => {
    const row = (await page()).extensions.find((e: { slug: string }) => e.slug === 'reports');
    expect((await ops('delete', `/extensions/${row.id}`)).status).toBe(200);
    const nav = (await ops('get', '/extensions/nav')).body;
    expect(nav.admin.map((n: { key: string }) => n.key)).not.toContain('reports');
    expect(nav.user).toEqual([]);
  });
});

describe('the workspace catalogue (WD-ADD-033)', () => {
  let token = '';
  let orgId = 0;
  const get = () => api().get('/v2/addons').set(bearer(token));

  beforeAll(async () => {
    const signup = await api()
      .post('/v2/auth/signup')
      .set('x-forwarded-for', '10.9.1.1')
      .send({
        orgName: 'Addon WS',
        fullName: 'Add Owner',
        email: `addon-ws${Date.now()}@example.test`,
        password: 'Str0ngPassw0rd#1',
        acceptTerms: true,
      });
    expect(signup.status, JSON.stringify(signup.body)).toBe(201);
    token = signup.body.tokens.accessToken as string;
    orgId = Number(
      (await h.owner.query(`SELECT id FROM organizations WHERE name = 'Addon WS'`)).rows[0].id,
    );
  });

  it('withholds the catalogue from a workspace with no active paid plan', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ eligible: false, owned: [], catalog: [] });
  });

  it('shows owned and buyable add-ons once the plan is paid: Active for a feature pack, Buy again for a boost', async () => {
    await h.owner.query(
      `INSERT INTO plans (slug, name, is_free, kind, amount) VALUES ('paid_ws', 'Paid', false, 'plan', '29')`,
    );
    await h.owner.query(`UPDATE organizations SET plan = 'paid_ws' WHERE id = $1`, [orgId]);
    const feature = (
      await ops('post', '/addons').send({
        name: 'Analytics pack',
        amount: '5',
        currency: 'USD',
        features: ['analytics'],
      })
    ).body;
    const boost = (
      await ops('post', '/addons').send({
        name: 'Seat pack',
        amount: '3',
        currency: 'USD',
        limits: { users: 2 },
        features: ['automation'],
      })
    ).body;
    const fresh = (
      await ops('post', '/addons').send({
        name: 'Brand pack',
        amount: '0',
        currency: 'USD',
        features: ['remove_branding'],
        isLifetime: true,
      })
    ).body;
    const own = (uuid: string, ends: string | null) =>
      h.owner.query(
        `INSERT INTO workspace_addons (org_id, package_id, status, ends_at)
         SELECT $1, id, 'active', $3::timestamptz FROM plans WHERE uuid = $2`,
        [orgId, uuid, ends],
      );
    await own(feature.id, null);
    await own(boost.id, null);
    await own(boost.id, new Date(Date.now() + 86_400_000).toISOString());
    // an expired purchase is not owned
    await own(fresh.id, new Date(Date.now() - 86_400_000).toISOString());

    const res = await get();
    expect(res.body.eligible).toBe(true);
    const card = (name: string) => res.body.catalog.find((c: { name: string }) => c.name === name);
    expect(card('Analytics pack')).toMatchObject({ state: 'active', ownedCount: 1 });
    expect(card('Seat pack')).toMatchObject({ state: 'buy_again', ownedCount: 2 });
    expect(card('Brand pack')).toMatchObject({
      state: 'buy',
      ownedCount: 0,
      isFree: true,
      isLifetime: true,
    });
    // bullets: the feature spelled out, "+N" and the key's label for a boost
    expect(card('Seat pack').grantBullets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'limit_add', amount: 2, label: 'Users' }),
        expect.objectContaining({ kind: 'feature', label: 'Automation' }),
      ]),
    );
    expect(res.body.owned.map((o: { name: string }) => o.name).sort()).toEqual([
      'Analytics pack',
      'Seat pack',
      'Seat pack',
    ]);
    expect(res.body.owned.filter((o: { endsAt: string | null }) => o.endsAt === null)).toHaveLength(
      2,
    );
  });

  it('keeps off-sale packs out of the catalogue and needs a sign-in', async () => {
    const packs = (await ops('get', '/addons')).body.data as Array<{
      id: string;
      name: string;
      rowVersion: number;
    }>;
    const brand = packs.find((p) => p.name === 'Brand pack')!;
    await ops('patch', `/addons/${brand.id}/active`).send({
      isActive: false,
      rowVersion: brand.rowVersion,
    });
    const res = await get();
    expect(res.body.catalog.map((c: { name: string }) => c.name)).not.toContain('Brand pack');
    expect((await api().get('/v2/addons')).status).toBe(401);
  });
});

describe('install gates and audit (WD-ADD-002, 003, 005, 021, 023)', () => {
  const upload = (slug: string, version: string, code: string | null = 'abc-123') => {
    const r = api()
      .post('/v2/platform/extensions/upload')
      .set(bearer(superToken))
      .attach(
        'extension',
        makeZip([{ name: 'extension.json', data: manifestJson({ slug, name: slug, version }) }]),
        'p.zip',
      );
    return code === null ? r : r.field('purchaseCode', code);
  };

  it('refuses an upload without a purchase code, and verify says so without storing the code', async () => {
    const res = await upload('gate_mod', '1.0.0', '');
    expect(res.status).toBe(422);
    expect(existsSync(join(modulesDir, 'gate_mod'))).toBe(false);
    const v = await ops('post', '/extensions/verify').send({ purchaseCode: '' });
    expect(v.body).toEqual({ ok: false, message: 'Enter your purchase code first.' });
    const ev = await h.owner.query(
      `SELECT payload::text AS payload FROM security_events WHERE event = 'platform.extension.verify'`,
    );
    for (const r of ev.rows as Array<{ payload: string }>)
      expect(r.payload).not.toContain('abc-123');
  });

  it('installing the same slug again upgrades it in place: one row, new version, flagged as an upgrade', async () => {
    const first = await upload('gate_mod', '1.0.0');
    expect(first.body).toMatchObject({ ok: true, upgraded: false });
    const second = await upload('gate_mod', '1.1.0');
    expect(second.body).toMatchObject({ ok: true, upgraded: true });
    const rows = (await page()).extensions.filter((e: { slug: string }) => e.slug === 'gate_mod');
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe('1.1.0');
    const ev = await h.owner.query(
      `SELECT payload->>'version' AS version FROM security_events WHERE event = 'platform.extension.installed' AND payload->>'slug' = 'gate_mod' ORDER BY id`,
    );
    expect(ev.rows.map((r: { version: string }) => r.version)).toEqual(['1.0.0', '1.1.0']);
  });

  it('the native Instagram package is refused while a remote engine on another host is connected', async () => {
    // left connected to https://engine.example.com by the teardown test above
    const res = await upload('instagram', '1.0.0');
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('Disconnect');
    expect(existsSync(join(modulesDir, 'instagram'))).toBe(false);
    await ops('post', '/extensions/engines/instagram/disconnect');
    const ok = await upload('instagram', '1.0.0');
    expect(ok.status, JSON.stringify(ok.body)).toBeLessThan(300);
    // and now the remote connect is blocked by the native module
    expect((await page()).engines.instagram.blockedByNative).toBe(true);
    const row = (await page()).extensions.find((e: { slug: string }) => e.slug === 'instagram');
    expect((await ops('delete', `/extensions/${row.id}`)).status).toBe(200);
    expect((await page()).engines.instagram.blockedByNative).toBe(false);
  });
});
