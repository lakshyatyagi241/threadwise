import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { quickAccessResponseSchema } from '@crm/contracts';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/** Quick-access tiles over HTTP (WD-DASH-009). */
let h: Harness;
let api: Api;
let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  a = await api.signup('qaa');
  b = await api.signup('qab');
}, 240_000);
afterAll(async () => {
  await h?.stop();
});

describe('quick access (WD-DASH-009)', () => {
  it('needs a signed-in user', async () => {
    expect((await api.http().get('/v2/quick-access')).status).toBe(401);
  });

  it('never customised: the ten default tiles', async () => {
    const res = await api.as(a.admin).get('/v2/quick-access');
    expect(res.status).toBe(200);
    const body = quickAccessResponseSchema.parse(res.body);
    expect(body.tiles).toHaveLength(10);
    expect(body.tiles[0]).toMatchObject({ key: 'inbox', url: '/inbox', custom: false });
  });

  it('12 items store 10; javascript: and a 60-char label are handled; the write is audited', async () => {
    const items = [
      { key: 'analytics' },
      { label: 'x'.repeat(60), url: '/long' },
      { label: 'Bad', url: 'javascript:alert(1)' },
      ...Array.from({ length: 10 }, (_, i) => ({ label: `c${i}`, url: `/c${i}` })),
    ];
    const res = await api.as(a.admin).put('/v2/quick-access').send({ items });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.tiles).toHaveLength(10);
    expect(res.body.tiles[1].label).toHaveLength(40);
    expect(res.body.tiles.some((t: { label: string }) => t.label === 'Bad')).toBe(false);
    const again = quickAccessResponseSchema.parse(
      (await api.as(a.admin).get('/v2/quick-access')).body,
    );
    expect(again.tiles.map((t) => t.label)).toEqual(
      res.body.tiles.map((t: { label: string }) => t.label),
    );
    const audit = await h.owner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'user_settings' AND action = 'update'`,
      [a.orgId],
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it('saving an empty list brings the defaults back', async () => {
    await api.as(a.admin).put('/v2/quick-access').send({ items: [] });
    const body = quickAccessResponseSchema.parse(
      (await api.as(a.admin).get('/v2/quick-access')).body,
    );
    expect(body.tiles).toHaveLength(10);
    expect(body.tiles[0]!.key).toBe('inbox');
  });

  it('is per user and per workspace: another workspace is untouched', async () => {
    await api
      .as(a.admin)
      .put('/v2/quick-access')
      .send({ items: [{ key: 'deals' }] });
    const mine = quickAccessResponseSchema.parse(
      (await api.as(a.admin).get('/v2/quick-access')).body,
    );
    const theirs = quickAccessResponseSchema.parse(
      (await api.as(b.admin).get('/v2/quick-access')).body,
    );
    expect(mine.tiles).toHaveLength(1);
    expect(theirs.tiles).toHaveLength(10);
  });
});
