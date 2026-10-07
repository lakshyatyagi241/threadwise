import { createHmac, randomBytes } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/** The WooCommerce companion plugin download (TW-ECOM-032), against a real Postgres. */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

/** A connected store, written the way a connect would (keys are placeholders: the plugin never uses them). */
async function wooStore(t: Tenant): Promise<{ uuid: string; secret: string; dbId: number }> {
  const secret = randomBytes(30).toString('base64url');
  const r = await h.owner.query(
    `INSERT INTO woocommerce_integrations (org_id, user_id, store_url, store_name, store_currency, consumer_key, consumer_secret, webhook_secret)
     VALUES ($1, $2, $3, 'W', 'USD', 'k', 's', $4) RETURNING id, uuid`,
    [t.orgId, t.adminUserId, `https://${secret.slice(0, 6).toLowerCase()}.test`, secret],
  );
  return { uuid: r.rows[0].uuid as string, secret, dbId: Number(r.rows[0].id) };
}

/** Reads the zip's files back through its central directory. */
function unzip(buf: Buffer): Map<string, string> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    const at = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(at, at + csize);
    out.set(name, (method === 8 ? inflateRawSync(raw) : raw).toString('utf8'));
    p += 46 + nlen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

const download = (t: string, id: string) =>
  api
    .http()
    .get(`/v2/woocommerce/${id}/plugin`)
    .set(bearer(t))
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

describe('GET /woocommerce/:id/plugin', () => {
  it('downloads a zip with this store’s address, secret and a 30 minute delay, and logs no secret', async () => {
    const t = await api.signup('plg');
    const s = await wooStore(t);

    const written: string[] = [];
    const spies = [
      vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => {
        written.push(String(c));
        return true;
      }),
      vi.spyOn(process.stderr, 'write').mockImplementation((c: unknown) => {
        written.push(String(c));
        return true;
      }),
    ];
    let res: Awaited<ReturnType<typeof download>>;
    try {
      res = await download(t.admin, s.uuid);
    } finally {
      spies.forEach((x) => x.mockRestore());
    }

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="[a-z0-9-]+-woocommerce\.zip"$/,
    );
    const files = unzip(res.body as Buffer);
    const slug = /filename="([a-z0-9-]+)-woocommerce\.zip"/.exec(
      res.headers['content-disposition'] as string,
    )![1]!;
    const php = files.get(`${slug}-woocommerce/${slug}-woocommerce.php`)!;
    expect(php).toContain(s.secret);
    expect(php).toContain(`/v2/woocommerce/webhook/${s.secret}`);
    expect(php).toContain('const DELAY_MINUTES = 30;');
    expect(php).not.toMatch(/\{\{[A-Z_]+\}\}/);

    // No log line, and no audit row, carries the secret.
    expect(written.join('')).not.toContain(s.secret);
    const audit = await h.owner.query(
      `SELECT action, delta::text AS delta FROM audit_log WHERE org_id = $1 AND module = 'woocommerce_integrations'`,
      [t.orgId],
    );
    expect(audit.rows.some((r) => r.action === 'export')).toBe(true);
    expect(JSON.stringify(audit.rows)).not.toContain(s.secret);
  });

  it('a delivery signed the way the plugin signs it is accepted, a wrong key is not', async () => {
    const t = await api.signup('plg');
    const s = await wooStore(t);
    const body = JSON.stringify({
      token: 'abcd1234-ef56',
      email: 'shopper@example.test',
      phone: '+919812345678',
      billing: { phone: '+919812345678', country: 'IN' },
    });
    const send = (key: string, topic = 'checkout.created') =>
      api
        .http()
        .post(`/v2/woocommerce/webhook/${s.secret}`)
        .set('Content-Type', 'application/json')
        .set('X-WC-Webhook-Topic', topic)
        .set('X-WC-Webhook-Delivery-ID', randomBytes(8).toString('hex'))
        .set('X-WC-Webhook-Signature', createHmac('sha256', key).update(body).digest('base64'))
        .send(body);

    expect((await send('not-the-secret')).status).toBe(401);
    expect((await send(s.secret)).status).toBe(200);
    expect((await send(s.secret, 'subscription.payment_failed')).status).toBe(200);
    const logged = await h.owner.query(
      `SELECT event_type FROM woocommerce_integration_logs WHERE org_id = $1 AND integration_id = $2`,
      [t.orgId, s.dbId],
    );
    expect(logged.rows.map((r) => r.event_type)).toEqual(
      expect.arrayContaining(['checkout.created', 'subscription.payment_failed']),
    );
  });

  it('answers 404 for another workspace’s store and for an unknown one', async () => {
    const t = await api.signup('plg');
    const other = await api.signup('plh');
    const s = await wooStore(t);
    expect((await download(other.admin, s.uuid)).status).toBe(404);
    expect((await download(t.admin, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await download(t.admin, 'not-a-uuid')).status).toBe(400);
  });

  it('answers 403 without ecom.connect, even with ecom.read, and 401 without a session', async () => {
    const t = await api.signup('plg');
    const s = await wooStore(t);
    const viewer = await api.member(t, 'viewer', [['ecom.read']]);
    expect((await download(viewer.token, s.uuid)).status).toBe(403);
    const manager = await api.member(t, 'manager', [['ecom.connect']]);
    expect((await download(manager.token, s.uuid)).status).toBe(200);
    expect((await api.http().get(`/v2/woocommerce/${s.uuid}/plugin`)).status).toBe(401);
  });
});
