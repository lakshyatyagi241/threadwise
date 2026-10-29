import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/** Global and Restricted record scope on campaigns (BL-430): a restricted role sees and acts on only the campaigns it created. */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const KEYS = [
  'camp.campaigns.read',
  'camp.campaigns.update',
  'camp.campaigns.delete',
  'camp.campaigns.control',
  'camp.campaigns.export',
];

async function campaign(t: Tenant, createdBy: number, name: string): Promise<string> {
  const r = await h.owner.query(
    `INSERT INTO wpcampaigns (org_id, campaign_name, campaign_type, status, schedule_type, timezone, total_recipients, created_by)
     VALUES ($1,$2,'text','running','now','UTC',0,$3) RETURNING uuid`,
    [t.orgId, name, createdBy],
  );
  return r.rows[0].uuid as string;
}

const as = (token: string) => ({ authorization: `Bearer ${token}` });

describe('campaign record scope', () => {
  it('a restricted role sees only the campaigns it created, a global role sees all', async () => {
    const t = await api.signup('crs1');
    const mine = await api.member(
      t,
      'restricted',
      KEYS.map((k) => [k, 'own'] as [string, 'own']),
    );
    const global = await api.member(
      t,
      'global',
      KEYS.map((k) => [k, 'all'] as [string, 'all']),
    );
    const own = await campaign(t, mine.userId, 'Mine');
    const other = await campaign(t, t.adminUserId, 'Theirs');

    const list = await api.http().get('/v2/campaigns').set(as(mine.token));
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.data.map((c: { name: string }) => c.name)).toEqual(['Mine']);
    expect(list.body.statusCounts.all).toBe(1);

    const wide = await api.http().get('/v2/campaigns').set(as(global.token));
    expect(wide.body.data.map((c: { name: string }) => c.name).sort()).toEqual(['Mine', 'Theirs']);

    const get = (token: string, uuid: string, path = '') =>
      api.http().get(`/v2/campaigns/${uuid}${path}`).set(as(token));
    expect((await get(mine.token, own)).status).toBe(200);
    for (const path of ['', '/config', '/live', '/statistics', '/recipients', '/export']) {
      expect((await get(mine.token, other, path)).status, path).toBe(404);
      expect((await get(global.token, other, path)).status, path).toBe(200);
    }
  });

  it('a restricted role cannot cancel, resume, edit or delete a campaign it did not create', async () => {
    const t = await api.signup('crs2');
    const mine = await api.member(
      t,
      'restricted',
      KEYS.map((k) => [k, 'own'] as [string, 'own']),
    );
    const other = await campaign(t, t.adminUserId, 'Theirs');
    const own = await campaign(t, mine.userId, 'Mine');
    const post = (path: string) =>
      api
        .http()
        .post(`/v2/campaigns/${path}`)
        .set(as(mine.token))
        .set('idempotency-key', randomUUID())
        .send({});

    expect((await post(`${other}/cancel`)).status).toBe(404);
    expect((await post(`${other}/resume`)).status).toBe(404);
    expect((await post(`${own}/cancel`)).status).toBe(200);
    const del = await api
      .http()
      .delete(`/v2/campaigns/${other}`)
      .set(as(mine.token))
      .set('idempotency-key', randomUUID());
    expect(del.status).toBe(404);
    const bulk = await post('bulk-delete').send({ ids: [other, own] });
    expect(bulk.body.ids).toEqual([own]);
    const left = await h.owner.query(`SELECT 1 FROM wpcampaigns WHERE uuid = $1`, [other]);
    expect(left.rowCount).toBe(1);
  });

  it('applies to the campaign summary, the wizard history and the legacy broadcasts too', async () => {
    const t = await api.signup('crs3');
    const mine = await api.member(
      t,
      'restricted',
      KEYS.map((k) => [k, 'own'] as [string, 'own']),
    );
    const global = await api.member(
      t,
      'global',
      KEYS.map((k) => [k, 'all'] as [string, 'all']),
    );
    const own = await campaign(t, mine.userId, 'Mine');
    const other = await campaign(t, t.adminUserId, 'Theirs');
    const get = (token: string, path: string) => api.http().get(path).set(as(token));

    // The director summary of one campaign.
    expect((await get(mine.token, `/v2/campaigns/${own}/summary`)).status).toBe(200);
    expect((await get(mine.token, `/v2/campaigns/${other}/summary`)).status).toBe(404);
    expect((await get(global.token, `/v2/campaigns/${other}/summary`)).status).toBe(200);

    // The wizard's History page lists runs: a restricted role gets only its own.
    const history = await get(mine.token, '/v2/broadcast-wizard/history');
    expect(history.status, JSON.stringify(history.body)).toBe(200);
    const names = (b: { data: Array<{ name: string }> }) => b.data.map((x) => x.name).sort();
    expect(names(history.body)).toEqual(['Mine']);
    expect(names((await get(global.token, '/v2/broadcast-wizard/history')).body)).toEqual([
      'Mine',
      'Theirs',
    ]);

    // The legacy broadcasts: list, detail and summary.
    const broadcast = async (userId: number, name: string) =>
      (
        await h.owner.query(
          `INSERT INTO broadcasts (org_id, user_id, name, status) VALUES ($1,$2,$3,'completed') RETURNING uuid`,
          [t.orgId, userId, name],
        )
      ).rows[0].uuid as string;
    const myB = await broadcast(mine.userId, 'MyB');
    const otherB = await broadcast(t.adminUserId, 'TheirB');
    const list = await get(mine.token, '/v2/broadcasts');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(names(list.body)).toEqual(['MyB']);
    expect((await get(mine.token, `/v2/broadcasts/${myB}`)).status).toBe(200);
    expect((await get(mine.token, `/v2/broadcasts/${otherB}`)).status).toBe(404);
    expect((await get(global.token, `/v2/broadcasts/${otherB}`)).status).toBe(200);
    const summary = await get(mine.token, '/v2/broadcasts/summary');
    expect(summary.body.stats.total).toBe(1);
  });
});
