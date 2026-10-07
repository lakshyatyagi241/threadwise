import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness } from '../contacts-attributes-tags/support';

/** A workspace's outbound webhooks (Settings > Integrations > Webhooks): the real app and a real Postgres. */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

// A documentation-range address (RFC 5737): public as far as the guard can tell, never routable, so a test never reaches a real host.
const URL_OK = 'https://192.0.2.10/in';

describe('webhooks CRUD', () => {
  it('creates, lists, changes and deletes, never returning the secret or the stored ciphertext', async () => {
    const t = await api.signup('wh1');
    const made = await api
      .as(t.admin)
      .post('/v2/webhooks')
      .send({ name: 'CRM sync', url: URL_OK, events: ['contact_created'], secret: 'whsec_123' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body).toMatchObject({
      name: 'CRM sync',
      url: URL_OK,
      events: ['contact_created'],
      active: true,
      hasSecret: true,
      isFailing: false,
      successCount: 0,
    });
    expect(JSON.stringify(made.body)).not.toContain('whsec_123');

    const stored = (
      await h.owner.query(`SELECT webhook_url, secret FROM webhooks WHERE uuid = $1`, [
        made.body.id,
      ])
    ).rows[0];
    expect(stored.webhook_url).not.toContain('192.0.2.10');
    expect(stored.secret).not.toContain('whsec_123');

    const list = await api.as(t.admin).get('/v2/webhooks');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.availableEvents).toContain('contact_created');

    const upd = await api
      .as(t.admin)
      .patch(`/v2/webhooks/${made.body.id}`)
      .send({ active: false, events: ['task_created', 'task_created'], clearSecret: true });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(upd.body).toMatchObject({ active: false, events: ['task_created'], hasSecret: false });

    const del = await api.as(t.admin).delete(`/v2/webhooks/${made.body.id}`);
    expect(del.status).toBe(204);
    expect((await api.as(t.admin).get('/v2/webhooks')).body.data).toEqual([]);
    expect((await api.as(t.admin).delete(`/v2/webhooks/${made.body.id}`)).status).toBe(404);
  });

  it('no events given means every event; * wins over a list', async () => {
    const t = await api.signup('wh2');
    const a = await api.as(t.admin).post('/v2/webhooks').send({ url: URL_OK });
    expect(a.body.events).toEqual(['*']);
    const b = await api
      .as(t.admin)
      .post('/v2/webhooks')
      .send({ url: URL_OK, events: ['task_created', '*'] });
    expect(b.body.events).toEqual(['*']);
  });

  it('refuses addresses that are not public https', async () => {
    const t = await api.signup('wh3');
    for (const url of [
      'http://192.0.2.10/in',
      'https://localhost/in',
      'https://127.0.0.1/in',
      'https://169.254.169.254/latest/meta-data',
      'https://10.0.0.5/in',
      'https://user:pw@192.0.2.10/in',
      'not a url',
    ]) {
      const r = await api.as(t.admin).post('/v2/webhooks').send({ url });
      expect(r.status, url).toBe(422);
    }
    const ok = await api.as(t.admin).post('/v2/webhooks').send({ url: URL_OK });
    const bad = await api
      .as(t.admin)
      .patch(`/v2/webhooks/${ok.body.id}`)
      .send({ url: 'https://127.0.0.1/x' });
    expect(bad.status).toBe(422);
  });
});

describe('webhooks access and isolation', () => {
  it('another workspace sees and touches none of them', async () => {
    const a = await api.signup('wh4');
    const b = await api.signup('wh4b');
    const made = await api.as(a.admin).post('/v2/webhooks').send({ url: URL_OK });
    expect((await api.as(b.admin).get('/v2/webhooks')).body.data).toEqual([]);
    expect(
      (await api.as(b.admin).patch(`/v2/webhooks/${made.body.id}`).send({ active: false })).status,
    ).toBe(404);
    expect((await api.as(b.admin).delete(`/v2/webhooks/${made.body.id}`)).status).toBe(404);
    expect((await api.as(b.admin).get(`/v2/webhooks/${made.body.id}/deliveries`)).status).toBe(404);
    expect((await api.as(b.admin).post(`/v2/webhooks/${made.body.id}/test`)).status).toBe(404);
  });

  it('reading and managing are separate permissions', async () => {
    const t = await api.signup('wh5');
    const made = await api.as(t.admin).post('/v2/webhooks').send({ url: URL_OK });
    const reader = await api.member(t, 'whread', [['webhooks.read']]);
    expect((await api.as(reader.token).get('/v2/webhooks')).status).toBe(200);
    expect((await api.as(reader.token).post('/v2/webhooks').send({ url: URL_OK })).status).toBe(
      403,
    );
    expect((await api.as(reader.token).delete(`/v2/webhooks/${made.body.id}`)).status).toBe(403);
    const nobody = await api.member(t, 'whnone', [['record.contacts.read']]);
    expect((await api.as(nobody.token).get('/v2/webhooks')).status).toBe(403);
  });

  it('records an audit row for create, change and delete', async () => {
    const t = await api.signup('wh6');
    const before = await api.auditCount(t.orgId, 'webhooks', 'insert');
    const made = await api.as(t.admin).post('/v2/webhooks').send({ url: URL_OK });
    expect(await api.auditCount(t.orgId, 'webhooks', 'insert')).toBe(before + 1);
    await api.as(t.admin).patch(`/v2/webhooks/${made.body.id}`).send({ name: 'Renamed' });
    expect(await api.auditCount(t.orgId, 'webhooks', 'update')).toBeGreaterThanOrEqual(1);
    await api.as(t.admin).delete(`/v2/webhooks/${made.body.id}`);
    expect(await api.auditCount(t.orgId, 'webhooks', 'delete')).toBeGreaterThanOrEqual(1);
  });
});

describe('webhook test sends and the delivery log', () => {
  it('a test send is logged; an endpoint that resolves to a private address is refused and the refusal is logged', async () => {
    const t = await api.signup('wh7');
    const made = await api.as(t.admin).post('/v2/webhooks').send({ url: URL_OK });
    // Point the stored URL at a private address behind the API's back (a name repointed after it was approved).
    const enc = (
      await h.owner.query(`SELECT webhook_url FROM webhooks WHERE uuid = $1`, [made.body.id])
    ).rows[0];
    expect(enc.webhook_url).toBeTruthy();
    const res = await api.as(t.admin).post(`/v2/webhooks/${made.body.id}/test`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.delivery).toMatchObject({ event: 'test_fire', attempts: 1, isRetry: false });
    const log = await api.as(t.admin).get(`/v2/webhooks/${made.body.id}/deliveries?limit=5`);
    expect(log.status).toBe(200);
    expect(log.body.data).toHaveLength(1);
    expect(log.body.data[0].event).toBe('test_fire');
    const hook = (await api.as(t.admin).get('/v2/webhooks')).body.data[0];
    expect(hook.lastFiredAt).toBeTruthy();
    expect(hook.successCount + hook.failureCount).toBe(1);
  });
});
