import request from 'supertest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';
import { makeZip, manifestJson } from '../../unit/addons-extension-registry/zip-fixture';

/** Add-on packs and installable extensions end to end through HTTP, as a super admin, a support operator and a workspace. */
let h: Harness;
let modulesDir: string;
const api = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
let superToken = '';
let supportToken = '';
const ops = (m: 'get' | 'post' | 'patch' | 'delete', p: string, t = superToken) =>
  api()[m](`/v2/platform${p}`).set(bearer(t));

beforeAll(async () => {
  modulesDir = mkdtempSync(join(tmpdir(), 'addons-e2e-'));
  process.env.ADDONS_DIR = modulesDir;
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
  const sup = await api()
    .post('/v2/platform/auth/login')
    .send({ email: 'support@platform.test', password: OPERATOR_PASSWORD });
  supportToken = sup.body.tokens.accessToken as string;
}, 240_000);

afterAll(async () => {
  await h?.stop();
  rmSync(modulesDir, { recursive: true, force: true });
});

describe('billing add-on packs', () => {
  const body = {
    name: 'Extra Seats',
    amount: '9',
    currency: 'usd',
    limits: { users: 5, tags: 0, bogus_key: 3 },
  };

  it('creates a pack: slug derived, money a string, zero limits dropped, audited', async () => {
    const res = await ops('post', '/addons').send({
      ...body,
      features: ['analytics', 'bogus_flag'],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      slug: 'extra_seats',
      amount: '9.00',
      currency: 'USD',
      grants: { features: ['analytics'], limits: { users: 5 } },
      activePurchases: 0,
    });
    const ev = await h.owner.query(
      `SELECT 1 FROM security_events WHERE event LIKE 'platform.addon.%'`,
    );
    expect(ev.rowCount).toBeGreaterThan(0);
  });

  it('refuses a core feature (on for every plan) as an add-on, naming it, and stores nothing', async () => {
    const before = await h.owner.query(`SELECT count(*)::int AS n FROM plans WHERE kind = 'addon'`);
    const res = await ops('post', '/addons').send({
      ...body,
      name: 'Shop Pack',
      features: ['analytics', 'shopify', 'woocommerce'],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    const text = JSON.stringify(res.body);
    expect(text).toContain('features');
    expect(text).toContain('Shopify');
    expect(text).toContain('Woocommerce');
    expect(text).not.toContain('Analytics is part of every plan');
    const after = await h.owner.query(`SELECT count(*)::int AS n FROM plans WHERE kind = 'addon'`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('refuses adding a core feature on update, but lets a pack that already holds one be edited', async () => {
    const created = (
      await ops('post', '/addons').send({ ...body, name: 'Legacy Pack', features: ['analytics'] })
    ).body;
    const add = await ops('patch', `/addons/${created.id}`).send({
      features: ['analytics', 'sales_pipeline'],
      rowVersion: created.rowVersion,
    });
    expect(add.status, JSON.stringify(add.body)).toBe(422);
    expect(JSON.stringify(add.body)).toContain('Sales pipeline');

    // A pack saved before the rule: the core flag is in its stored grants; renaming it must not be blocked.
    await h.owner.query(
      `UPDATE plans SET features = features || '{"sales_pipeline": true}'::jsonb WHERE slug = $1`,
      [created.slug],
    );
    const fresh = (await ops('get', `/addons/${created.id}`)).body;
    const rename = await ops('patch', `/addons/${created.id}`).send({
      name: 'Legacy Renamed',
      features: fresh.grants.features,
      rowVersion: fresh.rowVersion,
    });
    expect(rename.status, JSON.stringify(rename.body)).toBe(200);
    expect(rename.body.name).toBe('Legacy Renamed');
  });

  it('rejects an offer at or above the price, with the field named', async () => {
    const res = await ops('post', '/addons').send({ ...body, name: 'Bad', offerAmount: '9' });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('offerAmount');
  });

  it('read-only for support; stale rowVersion conflicts; lists and fetches', async () => {
    const created = (await ops('post', '/addons').send({ ...body, name: 'Lock Me' })).body;
    expect((await ops('get', '/addons', supportToken)).status).toBe(200);
    const denied = await ops('patch', `/addons/${created.id}`, supportToken).send({
      name: 'x',
      rowVersion: created.rowVersion,
    });
    expect(denied.status).toBe(403);
    const ok = await ops('patch', `/addons/${created.id}`).send({
      name: 'Renamed',
      rowVersion: created.rowVersion,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe('Renamed');
    const stale = await ops('patch', `/addons/${created.id}`).send({
      name: 'Again',
      rowVersion: created.rowVersion,
    });
    expect(stale.status).toBe(409);
    expect((await ops('get', `/addons/${created.id}`)).body.name).toBe('Renamed');
  });

  it('refuses to delete a pack that is owned, deletes one that is not', async () => {
    const owned = (await ops('post', '/addons').send({ ...body, name: 'Owned One' })).body;
    const org = await h.owner.query(
      `INSERT INTO organizations (slug, name) VALUES ('addon-e2e-org', 'x') RETURNING id`,
    );
    await h.owner.query(
      `INSERT INTO workspace_addons (org_id, package_id, status)
       SELECT $1, id, 'active' FROM plans WHERE uuid = $2`,
      [org.rows[0].id, owned.id],
    );
    expect((await ops('delete', `/addons/${owned.id}`)).status).toBe(409);
    const free = (await ops('post', '/addons').send({ ...body, name: 'Unowned' })).body;
    expect((await ops('delete', `/addons/${free.id}`)).status).toBe(200);
    expect((await ops('get', `/addons/${free.id}`)).status).toBe(404);
  });

  it('takes a pack off sale without touching what owners hold (WD-ADD-029)', async () => {
    const pack = (await ops('post', '/addons').send({ ...body, name: 'Sale Switch' })).body;
    const org = await h.owner.query(
      `INSERT INTO organizations (slug, name) VALUES ('addon-e2e-sale', 'x') RETURNING id`,
    );
    await h.owner.query(
      `INSERT INTO workspace_addons (org_id, package_id, status)
       SELECT $1, id, 'active' FROM plans WHERE uuid = $2`,
      [org.rows[0].id, pack.id],
    );
    const flip = (isActive: boolean, rowVersion: number, token = superToken) =>
      ops('patch', `/addons/${pack.id}/active`, token).send({ isActive, rowVersion });

    expect((await flip(false, pack.rowVersion, supportToken)).status).toBe(403);
    const off = await flip(false, pack.rowVersion);
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    // off sale, yet the workspace that owns it is still an active owner
    expect(off.body).toMatchObject({ isActive: false, activePurchases: 1 });
    const still = await h.owner.query(
      `SELECT count(*)::int AS n FROM workspace_addons WHERE status = 'active' AND org_id = $1`,
      [org.rows[0].id],
    );
    expect(still.rows[0].n).toBe(1);
    // a stale rowVersion is a conflict; the right one puts it back on sale
    expect((await flip(true, pack.rowVersion)).status).toBe(409);
    const on = await flip(true, off.body.rowVersion);
    expect(on.body.isActive).toBe(true);
    const ev = await h.owner.query(
      `SELECT event FROM security_events
       WHERE event IN ('platform.addon.deactivated', 'platform.addon.activated')`,
    );
    expect(ev.rows.map((r: { event: string }) => r.event)).toEqual(
      expect.arrayContaining(['platform.addon.deactivated', 'platform.addon.activated']),
    );
  });
});

describe('extensions: install, toggle, remove', () => {
  const upload = (zip: Buffer, t = superToken) =>
    api()
      .post('/v2/platform/extensions/upload')
      .set(bearer(t))
      .field('purchaseCode', 'abc-123')
      .attach('extension', zip, 'pkg.zip');

  it('installs a valid package under the modules dir and lists it', async () => {
    const zip = makeZip([
      {
        name: 'extension.json',
        data: manifestJson({ slug: 'demo_mod', name: 'Demo', version: '1.0.0' }),
      },
      { name: 'hello.txt', data: 'hi' },
    ]);
    const res = await upload(zip);
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    expect(existsSync(join(modulesDir, 'demo_mod', 'hello.txt'))).toBe(true);
    const page = await ops('get', '/extensions');
    expect(page.body.extensions.map((e: { slug: string }) => e.slug)).toContain('demo_mod');
  });

  it('refuses a support operator, a traversal package and a package with no manifest', async () => {
    const good = makeZip([
      { name: 'extension.json', data: manifestJson({ slug: 'nope', name: 'N', version: '1.0.0' }) },
    ]);
    expect((await upload(good, supportToken)).status).toBe(403);
    expect((await upload(makeZip([{ name: 'readme.txt', data: 'no manifest' }]))).status).toBe(422);
    const bad = makeZip([
      { name: 'extension.json', data: manifestJson({ slug: 'evil', name: 'E', version: '1.0.0' }) },
      { name: '../escape.txt', data: 'x' },
    ]);
    await upload(bad);
    expect(existsSync(join(modulesDir, '..', 'escape.txt'))).toBe(false);
  });

  it('toggles and removes: files go, and the row goes', async () => {
    const page = await ops('get', '/extensions');
    const row = page.body.extensions.find((e: { slug: string }) => e.slug === 'demo_mod');
    const off = await ops('post', `/extensions/${row.id}/toggle`).send({
      rowVersion: row.rowVersion,
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    const del = await ops('delete', `/extensions/${row.id}`);
    expect(del.status).toBe(200);
    expect(existsSync(join(modulesDir, 'demo_mod', 'hello.txt'))).toBe(false);
  });

  it('verify answers 200 with ok for a code', async () => {
    const res = await ops('post', '/extensions/verify').send({ purchaseCode: 'abc-123' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
