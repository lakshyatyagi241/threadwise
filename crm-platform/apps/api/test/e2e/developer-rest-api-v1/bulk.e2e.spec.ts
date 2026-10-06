import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, tenantWithKey, type Harness } from './support';

/**
 * The bulk group of the customer API: broadcasts, campaigns and scheduled messages (WD-API-080 to 095). The real app on a real Postgres and
 * Redis; nothing is sent (no worker runs, and the bridge is stubbed), so a "running" campaign or broadcast is a row and a queued job.
 */
describe('customer API v1: bulk', () => {
  let h: Harness;
  let api: Api;

  beforeAll(async () => {
    h = await startHarness();
    api = new Api(h);
  }, 240_000);
  afterAll(async () => h.stop());

  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  const FUTURE = '2031-03-10';
  type Tenant = Awaited<ReturnType<typeof tenantWithKey>>;

  let seq = 0;
  const phone = () => `+9198${String(seq++).padStart(8, '0')}`;
  const contacts = (t: Tenant, n: number, extra: { isUnsubscribed?: boolean } = {}) =>
    api.seedContacts(
      t.tenant,
      Array.from({ length: n }, (_, i) => ({ name: `P${seq}-${i}`, phone: phone(), ...extra })),
    );
  const template = async (t: Tenant, o: { type?: string; name?: string } = {}) =>
    (
      await h.owner.query(
        `INSERT INTO wa_templates (org_id, template_name, template_body, template_type, status)
         VALUES ($1, $2, 'Hello', $3, 'approved') RETURNING uuid`,
        [t.tenant.orgId, o.name ?? `t${randomUUID().slice(0, 8)}`, o.type ?? 'standard'],
      )
    ).rows[0].uuid as string;
  const device = async (t: Tenant, name = 'Phone') =>
    (
      await h.owner.query(
        `INSERT INTO devices (org_id, device_name, phone_number, status, active)
         VALUES ($1, $2, $3, 'connected', true) RETURNING uuid`,
        [t.tenant.orgId, name, phone()],
      )
    ).rows[0].uuid as string;
  const group = async (t: Tenant, members: string[]) => {
    const g = (
      await h.owner.query(
        `INSERT INTO contact_groups (org_id, name) VALUES ($1, $2) RETURNING id, uuid`,
        [t.tenant.orgId, `g${randomUUID().slice(0, 6)}`],
      )
    ).rows[0];
    for (const m of members) {
      await h.owner.query(
        `INSERT INTO contact_group_members (org_id, group_id, contact_id)
         SELECT $1, $2, id FROM contacts WHERE org_id = $1 AND uuid = $3`,
        [t.tenant.orgId, g.id, m],
      );
    }
    return g.uuid as string;
  };
  const overrides = (orgId: number, json: object) =>
    h.owner.query(
      `INSERT INTO org_plan_state (org_id, overrides) VALUES ($1, $2::jsonb) ON CONFLICT (org_id) DO UPDATE SET overrides = $2::jsonb`,
      [orgId, JSON.stringify(json)],
    );
  const count = async (table: string, orgId: number) =>
    Number(
      (await h.owner.query(`SELECT count(*)::int AS n FROM ${table} WHERE org_id = $1`, [orgId]))
        .rows[0].n,
    );

  // ================================================================================================ authentication and scopes

  describe('authentication, scopes and plan (WD-API-080 to 094)', () => {
    it('every route answers 401 missing_api_key without a key and 401 invalid_api_key with a wrong one', async () => {
      const t = await tenantWithKey(api, 'bulk-auth');
      const routes: Array<['get' | 'post' | 'delete', string]> = [
        ['post', '/broadcasts'],
        ['get', '/broadcasts'],
        ['get', `/broadcasts/${randomUUID()}`],
        ['get', `/broadcasts/${randomUUID()}/recipients`],
        ['post', `/broadcasts/${randomUUID()}/stop`],
        ['get', '/campaigns/statistics'],
        ['get', '/campaigns'],
        ['post', '/campaigns'],
        ['get', `/campaigns/${randomUUID()}`],
        ['post', `/campaigns/${randomUUID()}/stop`],
        ['delete', `/campaigns/${randomUUID()}`],
        ['post', '/scheduled'],
        ['get', '/scheduled'],
        ['get', `/scheduled/${randomUUID()}`],
        ['delete', `/scheduled/${randomUUID()}`],
      ];
      for (const [method, path] of routes) {
        const res = await t.call.raw(method, path);
        expect(res.status, `${method} ${path}`).toBe(401);
        expect(res.body.error.code, `${method} ${path}`).toBe('missing_api_key');
      }
      const wrong = await t.call.raw('get', '/broadcasts').set('authorization', 'Bearer wsk_nope');
      expect(wrong.status).toBe(401);
      expect(wrong.body.error.code).toBe('invalid_api_key');
    });

    it('a key scoped to reading cannot write, a write scope also reads, and another resource is refused (WD-API-080, 081, 084)', async () => {
      const t = await tenantWithKey(api, 'bulk-scope');
      await h.owner.query(
        `UPDATE api_keys SET scopes = ARRAY['broadcasts:read'] WHERE org_id = $1`,
        [t.tenant.orgId],
      );
      expect((await t.call.get('/broadcasts')).status).toBe(200);
      const denied = await t.call.post('/broadcasts', {
        name: 'x',
        template_id: randomUUID(),
        group_id: randomUUID(),
      });
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe('forbidden');
      expect((await t.call.post(`/broadcasts/${randomUUID()}/stop`)).status).toBe(403);
      expect((await t.call.get('/campaigns')).status).toBe(403);
      expect((await t.call.get('/scheduled')).status).toBe(403);

      await h.owner.query(
        `UPDATE api_keys SET scopes = ARRAY['campaigns:write', 'scheduled:write'] WHERE org_id = $1`,
        [t.tenant.orgId],
      );
      expect((await t.call.get('/campaigns')).status).toBe(200);
      expect((await t.call.get('/campaigns/statistics')).status).toBe(200);
      expect((await t.call.get('/scheduled')).status).toBe(200);
      expect((await t.call.get('/broadcasts')).status).toBe(403);
    });

    it('a workspace whose plan has no public API gets 403 plan_feature_disabled on these routes too', async () => {
      const t = await tenantWithKey(api, 'bulk-plan');
      await overrides(t.tenant.orgId, { features: { public_api: false } });
      for (const path of ['/broadcasts', '/campaigns', '/scheduled']) {
        const res = await t.call.get(path);
        expect(res.status, path).toBe(403);
        expect(res.body.error.code, path).toBe('plan_feature_disabled');
      }
    });
  });

  // ================================================================================================ broadcasts

  describe('broadcasts', () => {
    it('WD-API-080: two workspace contacts and a template make a processing broadcast with 2 pending recipients, audited and evented', async () => {
      const t = await tenantWithKey(api, 'bc-create');
      const tpl = await template(t);
      const ids = await contacts(t, 2);
      const res = await t.call.post('/broadcasts', {
        name: 'Launch',
        template_id: tpl,
        recipients: ids,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const d = res.body.data;
      expect(d).toMatchObject({
        name: 'Launch',
        status: 'processing',
        template_id: tpl,
        device_id: null,
        total_recipients: 2,
        counts: { sent: 0, delivered: 0, read: 0, failed: 0, clicked: 0, pending: 2 },
        scheduled_at: expect.stringMatching(ISO),
        completed_at: null,
      });
      expect(d.created_at).toMatch(ISO);
      expect(res.body.meta).toEqual({ broadcast_ids: [d.id], devices_count: 1 });
      const rows = await h.owner.query(
        `SELECT bc.status FROM broadcast_contacts bc JOIN broadcasts b ON b.org_id = bc.org_id AND b.id = bc.broadcast_id WHERE b.uuid = $1`,
        [d.id],
      );
      expect(rows.rows).toEqual([{ status: 'pending' }, { status: 'pending' }]);
      expect(await api.auditCount(t.tenant.orgId, 'broadcasts', 'insert')).toBe(1);
      expect((await api.events(t.tenant.orgId, 'broadcast.created')).length).toBe(1);
      expect(JSON.stringify(res.body)).not.toMatch(/"id":\s*\d+[,}]/);
    });

    it('WD-API-080: recipients of another workspace and no group answer 422 no_recipients and create nothing', async () => {
      const a = await tenantWithKey(api, 'bc-norecip-a');
      const b = await tenantWithKey(api, 'bc-norecip-b');
      const tpl = await template(a);
      const foreign = await contacts(b, 2);
      const res = await a.call.post('/broadcasts', {
        name: 'x',
        template_id: tpl,
        recipients: foreign,
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('no_recipients');
      expect(await count('broadcasts', a.tenant.orgId)).toBe(0);
    });

    it('WD-API-080: a lone opted-out recipient is refused with 422 no_recipients and the reason, not a 500', async () => {
      const t = await tenantWithKey(api, 'bc-optout');
      const tpl = await template(t);
      const ids = await contacts(t, 1, { isUnsubscribed: true });
      const res = await t.call.post('/broadcasts', {
        name: 'x',
        template_id: tpl,
        recipients: ids,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.error.code).toBe('no_recipients');
      expect(res.body.error.message).toMatch(/opted-out/);
      expect(await count('broadcasts', t.tenant.orgId)).toBe(0);
    });

    it("WD-API-080: another workspace's template is 422 invalid_template, another workspace's group 422 invalid_group", async () => {
      const a = await tenantWithKey(api, 'bc-scope-a');
      const b = await tenantWithKey(api, 'bc-scope-b');
      const mine = await contacts(a, 1);
      const foreignTpl = await template(b);
      const foreignGroup = await group(b, await contacts(b, 1));

      const badTpl = await a.call.post('/broadcasts', {
        name: 'x',
        template_id: foreignTpl,
        recipients: mine,
      });
      expect(badTpl.status).toBe(422);
      expect(badTpl.body.error.code).toBe('invalid_template');

      const badGroup = await a.call.post('/broadcasts', {
        name: 'x',
        template_id: await template(a),
        group_id: foreignGroup,
      });
      expect(badGroup.status).toBe(422);
      expect(badGroup.body.error.code).toBe('invalid_group');
      expect(await count('broadcasts', a.tenant.orgId)).toBe(0);
    });

    it('WD-API-080: a group is the audience (its members, once)', async () => {
      const t = await tenantWithKey(api, 'bc-group');
      const tpl = await template(t);
      const members = await contacts(t, 3);
      const g = await group(t, members);
      const res = await t.call.post('/broadcasts', {
        name: 'G',
        template_id: tpl,
        group_id: g,
        recipients: [members[0]!],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.total_recipients).toBe(3);
    });

    it('WD-API-080: neither recipients nor a group is a 422 validation error naming recipients', async () => {
      const t = await tenantWithKey(api, 'bc-validate');
      const tpl = await template(t);
      for (const body of [
        { name: 'x', template_id: tpl },
        { name: 'x', template_id: tpl, recipients: [] },
      ]) {
        const res = await t.call.post('/broadcasts', body);
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('validation_failed');
        expect(res.body.error.details.recipients).toBeDefined();
      }
      const noName = await t.call.post('/broadcasts', { template_id: tpl, group_id: randomUUID() });
      expect(noName.status).toBe(422);
      expect(noName.body.error.details.name).toBeDefined();
      const notUuid = await t.call.post('/broadcasts', {
        name: 'x',
        template_id: tpl,
        recipients: [1, 2],
      });
      expect(notUuid.status).toBe(422);
      expect(await count('broadcasts', t.tenant.orgId)).toBe(0);
    });

    it('WD-API-080: schedule_at makes a scheduled broadcast; its wall clock is read in `timezone`, an offset inside it does not move it (INTENDED)', async () => {
      const t = await tenantWithKey(api, 'bc-later');
      const tpl = await template(t);
      const ids = await contacts(t, 1);
      const plain = await t.call.post('/broadcasts', {
        name: 'a',
        template_id: tpl,
        recipients: ids,
        schedule_at: `${FUTURE} 09:00`,
      });
      expect(plain.status, JSON.stringify(plain.body)).toBe(201);
      expect(plain.body.data.status).toBe('scheduled');
      expect(plain.body.data.scheduled_at).toBe('2031-03-10T09:00:00.000Z');

      const zoned = await t.call.post('/broadcasts', {
        name: 'b',
        template_id: tpl,
        recipients: ids,
        schedule_at: `${FUTURE}T09:00:00+02:00`,
        timezone: 'Asia/Kolkata',
      });
      expect(zoned.status, JSON.stringify(zoned.body)).toBe(201);
      expect(zoned.body.data.scheduled_at).toBe('2031-03-10T03:30:00.000Z');

      const past = await t.call.post('/broadcasts', {
        name: 'c',
        template_id: tpl,
        recipients: ids,
        schedule_at: '2001-01-01 10:00',
      });
      expect(past.status).toBe(201);
      expect(past.body.data.status).toBe('scheduled');

      const junk = await t.call.post('/broadcasts', {
        name: 'd',
        template_id: tpl,
        recipients: ids,
        schedule_at: 'next friday',
      });
      expect(junk.status).toBe(422);
      expect(junk.body.error.details.schedule_at).toBeDefined();
      const badZone = await t.call.post('/broadcasts', {
        name: 'e',
        template_id: tpl,
        recipients: ids,
        schedule_at: `${FUTURE} 09:00`,
        timezone: 'Mars/Base',
      });
      expect(badZone.status).toBe(422);
      expect(await count('broadcasts', t.tenant.orgId)).toBe(3);
    });

    it('WD-API-080: a connected device is the sender; one that does not resolve is ignored and the broadcast has none (WaDesk)', async () => {
      const t = await tenantWithKey(api, 'bc-device');
      const b = await tenantWithKey(api, 'bc-device-b');
      const tpl = await template(t);
      const ids = await contacts(t, 1);
      const dev = await device(t, 'Alpha');
      const foreignDev = await device(b, 'Other');

      const bare = await t.call.post('/broadcasts', {
        name: 'a',
        template_id: tpl,
        recipients: ids,
        device_id: dev,
      });
      expect(bare.status, JSON.stringify(bare.body)).toBe(201);
      expect(bare.body.data.device_id).toBe(`baileys:${dev}`);
      const keyed = await t.call.post('/broadcasts', {
        name: 'b',
        template_id: tpl,
        recipients: ids,
        device_id: `baileys:${dev}`,
      });
      expect(keyed.body.data.device_id).toBe(`baileys:${dev}`);

      for (const device_id of [foreignDev, `baileys:${randomUUID()}`, 'cfg_4', '7']) {
        const res = await t.call.post('/broadcasts', {
          name: 'c',
          template_id: tpl,
          recipients: ids,
          device_id,
        });
        expect(res.status, device_id).toBe(201);
        expect(res.body.data.device_id, device_id).toBeNull();
      }
    });

    it('WD-API-080: at the plan limit the answer is the v1 envelope with 402 plan_limit (WaDesk: 422 plan_limit_reached; INTENDED)', async () => {
      const t = await tenantWithKey(api, 'bc-cap');
      const tpl = await template(t);
      const ids = await contacts(t, 1);
      await overrides(t.tenant.orgId, { limits: { broadcasts: 1 } });
      const make = () =>
        t.call.post('/broadcasts', { name: 'c', template_id: tpl, recipients: ids });
      expect((await make()).status).toBe(201);
      const refused = await make();
      expect(refused.status).toBe(402);
      expect(refused.body.error.code).toBe('plan_limit');
      expect(await count('broadcasts', t.tenant.orgId)).toBe(1);
    });

    it('WD-API-081: lists newest first with cursor paging, per_page as an alias, a status filter and nothing of another workspace', async () => {
      const a = await tenantWithKey(api, 'bc-list-a');
      const b = await tenantWithKey(api, 'bc-list-b');
      const tpl = await template(a);
      const ids = await contacts(a, 1);
      const made: string[] = [];
      for (const [i, schedule_at] of [undefined, undefined, `${FUTURE} 09:00`].entries()) {
        const r = await a.call.post('/broadcasts', {
          name: `B${i}`,
          template_id: tpl,
          recipients: ids,
          schedule_at,
        });
        made.push(r.body.data.id);
      }
      await b.call.post('/broadcasts', {
        name: 'foreign',
        template_id: await template(b),
        recipients: await contacts(b, 1),
      });

      const all = await a.call.get('/broadcasts');
      expect(all.status).toBe(200);
      expect(all.body.data.map((x: { id: string }) => x.id)).toEqual([...made].reverse());
      expect(all.body.meta).toEqual({ limit: 25, next_cursor: null, has_more: false });

      const first = await a.call.get('/broadcasts?limit=2');
      expect(first.body.data).toHaveLength(2);
      expect(first.body.meta).toMatchObject({ limit: 2, has_more: true });
      const second = await a.call.get(
        `/broadcasts?per_page=2&cursor=${first.body.meta.next_cursor}`,
      );
      expect(second.body.data.map((x: { id: string }) => x.id)).toEqual([made[0]]);
      expect(second.body.meta).toMatchObject({ limit: 2, has_more: false, next_cursor: null });

      const scheduled = await a.call.get('/broadcasts?status=scheduled');
      expect(scheduled.body.data.map((x: { id: string }) => x.id)).toEqual([made[2]]);
      expect((await a.call.get('/broadcasts?status=nonsense')).body.data).toEqual([]);

      expect((await a.call.get('/broadcasts?limit=1000')).body.meta.limit).toBe(100);
      const page = await a.call.get('/broadcasts?page=2');
      expect(page.status).toBe(422);
      expect(page.body.error.details.page[0]).toMatch(/cursor/);
    });

    it('WD-API-082: counts cascade (sent includes delivered includes read) and pending is what is neither sent nor failed', async () => {
      const t = await tenantWithKey(api, 'bc-show');
      const tpl = await template(t);
      const ids = await contacts(t, 10);
      const created = await t.call.post('/broadcasts', {
        name: 'Show',
        template_id: tpl,
        recipients: ids,
      });
      const id = created.body.data.id as string;

      const fresh = await t.call.get(`/broadcasts/${id}`);
      expect(fresh.status).toBe(200);
      expect(fresh.body.data.counts).toEqual({
        sent: 0,
        delivered: 0,
        read: 0,
        failed: 0,
        clicked: 0,
        pending: 10,
      });

      const states = [
        'sent',
        'delivered',
        'delivered',
        'delivered',
        'delivered',
        'read',
        'read',
        'failed',
      ];
      const rows = (
        await h.owner.query(
          `SELECT bc.id FROM broadcast_contacts bc JOIN broadcasts b ON b.org_id = bc.org_id AND b.id = bc.broadcast_id WHERE b.uuid = $1 ORDER BY bc.id`,
          [id],
        )
      ).rows;
      for (const [i, status] of states.entries()) {
        await h.owner.query(`UPDATE broadcast_contacts SET status = $1 WHERE id = $2`, [
          status,
          rows[i].id,
        ]);
      }
      const shown = await t.call.get(`/broadcasts/${id}`);
      expect(shown.body.data.counts).toEqual({
        sent: 7,
        delivered: 6,
        read: 2,
        failed: 1,
        clicked: 0,
        pending: 2,
      });
      expect(shown.body.data.total_recipients).toBe(10);
    });

    it('WD-API-082: a missing, foreign or malformed id is 404 not_found', async () => {
      const a = await tenantWithKey(api, 'bc-404-a');
      const b = await tenantWithKey(api, 'bc-404-b');
      const mine = (
        await a.call.post('/broadcasts', {
          name: 'm',
          template_id: await template(a),
          recipients: await contacts(a, 1),
        })
      ).body.data.id as string;
      for (const path of [`/broadcasts/${randomUUID()}`, '/broadcasts/12', '/broadcasts/abc']) {
        const res = await b.call.get(path);
        expect(res.status, path).toBe(404);
        expect(res.body.error.code, path).toBe('not_found');
      }
      for (const path of [`/broadcasts/${mine}`, `/broadcasts/${mine}/recipients`]) {
        expect((await b.call.get(path)).status, path).toBe(404);
      }
      expect((await b.call.post(`/broadcasts/${mine}/stop`)).status).toBe(404);
      expect((await a.call.get(`/broadcasts/${mine}`)).status).toBe(200);
    });

    it('WD-API-083: recipients are paged by cursor, show the reason a recipient failed, default to pending and carry no phone number', async () => {
      const t = await tenantWithKey(api, 'bc-recipients');
      const tpl = await template(t);
      const ids = await contacts(t, 3);
      const id = (
        await t.call.post('/broadcasts', { name: 'R', template_id: tpl, recipients: ids })
      ).body.data.id as string;
      await h.owner.query(
        `UPDATE broadcast_contacts SET status = 'failed', error_message = 'Number is not on WhatsApp'
         WHERE id = (SELECT min(bc.id) FROM broadcast_contacts bc JOIN broadcasts b ON b.org_id = bc.org_id AND b.id = bc.broadcast_id WHERE b.uuid = $1)`,
        [id],
      );

      const res = await t.call.get(`/broadcasts/${id}/recipients`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.meta).toMatchObject({ limit: 25, has_more: false, next_cursor: null });
      expect(res.body.meta.stats).toEqual({
        sent: 0,
        delivered: 0,
        read: 0,
        failed: 1,
        processing: 0,
        queued: 2,
      });
      const failed = res.body.data.find((r: { status: string }) => r.status === 'failed');
      expect(failed).toMatchObject({
        error: 'Number is not on WhatsApp',
        wa_message_id: null,
        sent_at: null,
      });
      expect(res.body.data.filter((r: { status: string }) => r.status === 'pending')).toHaveLength(
        2,
      );
      expect(new Set(res.body.data.map((r: { contact_id: string }) => r.contact_id))).toEqual(
        new Set(ids),
      );
      expect(Object.keys(res.body.data[0]).sort()).toEqual([
        'contact_id',
        'delivered_at',
        'error',
        'read_at',
        'sent_at',
        'status',
        'wa_message_id',
      ]);
      const phones = (
        await h.owner.query(`SELECT phone FROM contacts WHERE org_id = $1`, [t.tenant.orgId])
      ).rows.map((r) => r.phone as string);
      for (const p of phones) expect(JSON.stringify(res.body)).not.toContain(p.replace('+', ''));

      const p1 = await t.call.get(`/broadcasts/${id}/recipients?limit=2`);
      expect(p1.body.data).toHaveLength(2);
      const p2 = await t.call.get(
        `/broadcasts/${id}/recipients?limit=2&cursor=${p1.body.meta.next_cursor}`,
      );
      expect(p2.body.data).toHaveLength(1);
      expect(p2.body.meta.has_more).toBe(false);
    });

    it('WD-API-084: stopping a scheduled broadcast cancels it with an end time, an audit row and a status event carrying the previous status', async () => {
      const t = await tenantWithKey(api, 'bc-stop');
      const tpl = await template(t);
      const ids = await contacts(t, 2);
      const id = (
        await t.call.post('/broadcasts', {
          name: 'S',
          template_id: tpl,
          recipients: ids,
          schedule_at: `${FUTURE} 09:00`,
        })
      ).body.data.id as string;

      const res = await t.call.post(`/broadcasts/${id}/stop`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({
        id,
        status: 'cancelled',
        completed_at: expect.stringMatching(ISO),
      });
      const row = (
        await h.owner.query(`SELECT status, completed_at FROM broadcasts WHERE uuid = $1`, [id])
      ).rows[0];
      expect(row.status).toBe('cancelled');
      expect(row.completed_at).not.toBeNull();
      const events = await api.events(t.tenant.orgId, 'broadcast.status_changed');
      expect(events.at(-1)).toMatchObject({
        uuid: id,
        status: 'cancelled',
        previousStatus: 'scheduled',
      });
      expect(await api.auditCount(t.tenant.orgId, 'broadcasts', 'update')).toBeGreaterThan(0);
      // Recipient rows are left as they were (WaDesk).
      const left = await h.owner.query(
        `SELECT DISTINCT bc.status FROM broadcast_contacts bc JOIN broadcasts b ON b.org_id = bc.org_id AND b.id = bc.broadcast_id WHERE b.uuid = $1`,
        [id],
      );
      expect(left.rows).toEqual([{ status: 'pending' }]);

      const again = await t.call.post(`/broadcasts/${id}/stop`);
      expect(again.status).toBe(422);
      expect(again.body.error.code).toBe('not_stoppable');
      expect((await t.call.get(`/broadcasts/${id}`)).body.data.status).toBe('cancelled');
    });

    it('WD-API-084: an in-flight broadcast can be stopped, a completed one cannot and keeps its status', async () => {
      const t = await tenantWithKey(api, 'bc-stop2');
      const tpl = await template(t);
      const ids = await contacts(t, 1);
      const live = (
        await t.call.post('/broadcasts', { name: 'L', template_id: tpl, recipients: ids })
      ).body.data.id as string;
      expect((await t.call.post(`/broadcasts/${live}/stop`)).body.data.status).toBe('cancelled');

      const done = (
        await t.call.post('/broadcasts', { name: 'D', template_id: tpl, recipients: ids })
      ).body.data.id as string;
      await h.owner.query(`UPDATE broadcasts SET status = 'completed' WHERE uuid = $1`, [done]);
      const res = await t.call.post(`/broadcasts/${done}/stop`);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('not_stoppable');
      expect(res.body.error.message).toMatch(/scheduled or in-flight/);
      expect(
        (await h.owner.query(`SELECT status FROM broadcasts WHERE uuid = $1`, [done])).rows[0]
          .status,
      ).toBe('completed');
    });
  });

  // ================================================================================================ campaigns

  describe('campaigns', () => {
    const campaignBody = (dev: string, over: Record<string, unknown> = {}) => ({
      campaign_name: 'Diwali offer',
      device_id: dev,
      campaign_type: 'custom',
      schedule_type: 'now',
      custom_message: 'Hello there',
      contacts: [phone(), phone()],
      ...over,
    });
    const recipientsOf = async (uuid: string) =>
      (
        await h.owner.query(
          `SELECT r.status, r.variant, c.phone, c.name FROM wp_campaign_contacts r
           JOIN wpcampaigns w ON w.org_id = r.org_id AND w.id = r.campaign_id
           JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id
           WHERE w.uuid = $1 ORDER BY r.id`,
          [uuid],
        )
      ).rows as Array<{ status: string; variant: string | null; phone: string; name: string }>;
    const setRecipients = async (uuid: string, statuses: string[]) => {
      const ids = (
        await h.owner.query(
          `SELECT r.id FROM wp_campaign_contacts r JOIN wpcampaigns w ON w.org_id = r.org_id AND w.id = r.campaign_id WHERE w.uuid = $1 ORDER BY r.id`,
          [uuid],
        )
      ).rows;
      for (const [i, s] of statuses.entries())
        await h.owner.query(`UPDATE wp_campaign_contacts SET status = $1 WHERE id = $2`, [
          s,
          ids[i].id,
        ]);
    };
    const setStatus = (uuid: string, status: string) =>
      h.owner.query(`UPDATE wpcampaigns SET status = $1 WHERE uuid = $2`, [status, uuid]);
    /** A scheduled campaign with `n` numbers. */
    const scheduled = async (
      t: Tenant,
      dev: string,
      n: number,
      over: Record<string, unknown> = {},
    ) => {
      const res = await t.call.post(
        '/campaigns',
        campaignBody(dev, {
          schedule_type: 'later',
          send_date: FUTURE,
          send_time: '09:00',
          contacts: Array.from({ length: n }, phone),
          ...over,
        }),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.data.id as string;
    };

    it('WD-API-087: a send-now custom campaign answers 201 with the stored row (running, counts 0 until a read: kept from WaDesk) and two queued rows', async () => {
      const t = await tenantWithKey(api, 'camp-create');
      const dev = await device(t);
      const res = await t.call.post('/campaigns', campaignBody(dev));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const d = res.body.data;
      expect(d).toMatchObject({
        name: 'Diwali offer',
        type: 'custom',
        status: 'running',
        device_id: `baileys:${dev}`,
        template_id: null,
        flow_id: null,
        ab_testing: false,
        ab_split: 50,
        schedule_type: 'now',
        scheduled_for: null,
        completed_at: null,
        counts: {
          total_recipients: 0,
          sent: 0,
          delivered: 0,
          read: 0,
          failed: 0,
          clicked: 0,
          responded: 0,
        },
        metrics: { delivery_rate: 0, read_rate: 0, click_rate: 0, response_rate: 0 },
      });
      expect(d.created_at).toMatch(ISO);
      expect((await recipientsOf(d.id)).map((r) => r.status)).toEqual(['queued', 'queued']);
      expect(
        (await h.owner.query(`SELECT custom_message FROM wpcampaigns WHERE uuid = $1`, [d.id]))
          .rows[0].custom_message,
      ).not.toContain('Hello');
      expect(await api.auditCount(t.tenant.orgId, 'campaigns', 'insert')).toBe(1);
      expect((await api.events(t.tenant.orgId, 'campaign.created')).length).toBe(1);

      const shown = await t.call.get(`/campaigns/${d.id}`);
      expect(shown.body.data.counts.total_recipients).toBe(2);
    });

    it('WD-API-095: numbers become workspace contacts: an existing one in another format is reused, a new one is named after its last four digits, short ones are dropped', async () => {
      const t = await tenantWithKey(api, 'camp-numbers');
      const dev = await device(t);
      await api.seedContacts(t.tenant, [{ name: 'Existing', phone: '+14155550199' }]);
      const before = await count('contacts', t.tenant.orgId);
      const res = await t.call.post(
        '/campaigns',
        campaignBody(dev, {
          contacts: ['1 (415) 555-0199', '+1 415 555 0100', '12345', 'call me', '14155550100'],
        }),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(await count('contacts', t.tenant.orgId)).toBe(before + 1);
      const rows = await recipientsOf(res.body.data.id);
      expect(rows).toHaveLength(2);
      const fresh = rows.find((r) => r.phone === '+14155550100')!;
      expect(fresh.name).toMatch(/0100$/);
      expect(rows.find((r) => r.name === 'Existing')).toBeDefined();

      const none = await t.call.post(
        '/campaigns',
        campaignBody(dev, { contacts: ['12345', 'abc'] }),
      );
      expect(none.status).toBe(422);
      expect(none.body.error.code).toBe('create_failed');
    });

    it("WD-API-095: the sender is a bare uuid or a key of this workspace; a number, another workspace's sender or a stale key is 422 create_failed on device_id (INTENDED)", async () => {
      const a = await tenantWithKey(api, 'camp-sender-a');
      const b = await tenantWithKey(api, 'camp-sender-b');
      const dev = await device(a);
      const foreign = await device(b);

      for (const device_id of [dev, `baileys:${dev}`]) {
        const ok = await a.call.post('/campaigns', campaignBody(device_id));
        expect(ok.status, device_id).toBe(201);
        expect(ok.body.data.device_id).toBe(`baileys:${dev}`);
      }
      for (const device_id of [foreign, `baileys:${randomUUID()}`, 'cfg_999', '15551234567']) {
        const res = await a.call.post('/campaigns', campaignBody(device_id));
        expect(res.status, device_id).toBe(422);
        expect(res.body.error.code, device_id).toBe('create_failed');
        expect(res.body.error.details.device_id, device_id).toBeDefined();
      }
      const wabaId = (
        await h.owner.query(
          `INSERT INTO wa_provider_configs (org_id, provider, display_label, phone_number, status) VALUES ($1, 'waba', 'Cloud', $2, 'connected') RETURNING uuid`,
          [a.tenant.orgId, phone()],
        )
      ).rows[0].uuid as string;
      const cloud = await a.call.post('/campaigns', campaignBody(wabaId));
      expect(cloud.status, JSON.stringify(cloud.body)).toBe(201);
      expect(cloud.body.data.device_id).toBe(`waba:${wabaId}`);
      expect(
        (
          await h.owner.query(`SELECT provider FROM wpcampaigns WHERE uuid = $1`, [
            cloud.body.data.id,
          ])
        ).rows[0].provider,
      ).toBe('waba');
    });

    it('WD-API-087: later needs send_date and send_time (422 validation_failed), and with a zone is echoed as scheduled with that local time', async () => {
      const t = await tenantWithKey(api, 'camp-later');
      const dev = await device(t);
      const missing = await t.call.post(
        '/campaigns',
        campaignBody(dev, { schedule_type: 'later' }),
      );
      expect(missing.status).toBe(422);
      expect(missing.body.error.code).toBe('validation_failed');
      expect(missing.body.error.details.send_date).toBeDefined();
      expect(missing.body.error.details.send_time).toBeDefined();

      const res = await t.call.post(
        '/campaigns',
        campaignBody(dev, {
          schedule_type: 'later',
          send_date: FUTURE,
          send_time: '9:00 AM',
          timezone: 'Asia/Kolkata',
        }),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data).toMatchObject({
        status: 'scheduled',
        schedule_type: 'scheduled',
        timezone: 'Asia/Kolkata',
      });
      const shown = await t.call.get(`/campaigns/${res.body.data.id}`);
      expect(shown.body.data.scheduled_for).toBe('2031-03-10T03:30:00.000Z');
      expect(shown.body.data.counts.total_recipients).toBe(2);
    });

    it('WD-API-087: a recurring campaign needs no start; it is weekly and scheduled', async () => {
      const t = await tenantWithKey(api, 'camp-recurring');
      const dev = await device(t);
      const res = await t.call.post(
        '/campaigns',
        campaignBody(dev, { schedule_type: 'recurring' }),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data).toMatchObject({ status: 'scheduled', schedule_type: 'recurring' });
      const row = (
        await h.owner.query(
          `SELECT repeat_interval, repeat_until FROM wpcampaigns WHERE uuid = $1`,
          [res.body.data.id],
        )
      ).rows[0];
      expect(row).toEqual({ repeat_interval: 'weekly', repeat_until: null });
    });

    it('WD-API-087: an unknown zone is 422 create_failed with details on timezone; so is a name over 191 characters', async () => {
      const t = await tenantWithKey(api, 'camp-zone');
      const dev = await device(t);
      const zone = await t.call.post('/campaigns', campaignBody(dev, { timezone: 'Mars/Base' }));
      expect(zone.status).toBe(422);
      expect(zone.body.error.code).toBe('create_failed');
      expect(zone.body.error.details.timezone).toBeDefined();
      const name = await t.call.post(
        '/campaigns',
        campaignBody(dev, { campaign_name: 'x'.repeat(192) }),
      );
      expect(name.status).toBe(422);
      expect(name.body.error.code).toBe('create_failed');
      expect(name.body.error.details.campaign_name).toBeDefined();
      expect(await count('wpcampaigns', t.tenant.orgId)).toBe(0);
    });

    it("WD-API-087: another workspace's template is 422 create_failed 'Template not found.', an authentication template is refused", async () => {
      const a = await tenantWithKey(api, 'camp-tpl-a');
      const b = await tenantWithKey(api, 'camp-tpl-b');
      const dev = await device(a);
      const foreign = await a.call.post(
        '/campaigns',
        campaignBody(dev, { campaign_type: 'template', template_id: await template(b) }),
      );
      expect(foreign.status).toBe(422);
      expect(foreign.body.error.code).toBe('create_failed');
      expect(foreign.body.error.message).toBe('Template not found.');

      const auth = await a.call.post(
        '/campaigns',
        campaignBody(dev, {
          campaign_type: 'template',
          template_id: await template(a, { type: 'auth' }),
        }),
      );
      expect(auth.status).toBe(422);
      expect(auth.body.error.code).toBe('create_failed');

      const good = await a.call.post(
        '/campaigns',
        campaignBody(dev, { campaign_type: 'template', template_id: await template(a) }),
      );
      expect(good.status, JSON.stringify(good.body)).toBe(201);
      expect(good.body.data).toMatchObject({ type: 'template', template_id: expect.any(String) });
      // WaDesk did not require the template of a template campaign (kept): the campaign is made and fails at send time.
      const bare = await a.call.post(
        '/campaigns',
        campaignBody(dev, { campaign_type: 'template' }),
      );
      expect(bare.status).toBe(201);
      expect(await count('wpcampaigns', a.tenant.orgId)).toBe(2);
    });

    it('WD-API-087: A/B testing splits recipients 7 to 3 at ab_split 70; 5 is a 422', async () => {
      const t = await tenantWithKey(api, 'camp-ab');
      const dev = await device(t);
      const res = await t.call.post(
        '/campaigns',
        campaignBody(dev, {
          ab_testing: 'true',
          ab_split: 70,
          contacts: Array.from({ length: 10 }, phone),
        }),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data).toMatchObject({ ab_testing: true, ab_split: 70 });
      const rows = await recipientsOf(res.body.data.id);
      expect(rows.filter((r) => r.variant === 'A')).toHaveLength(7);
      expect(rows.filter((r) => r.variant === 'B')).toHaveLength(3);

      const bad = await t.call.post(
        '/campaigns',
        campaignBody(dev, { ab_testing: true, ab_split: 5 }),
      );
      expect(bad.status).toBe(422);
      expect(bad.body.error.details.ab_split).toBeDefined();
    });

    it('WD-API-087: validation answers 422 in the envelope; the quota answers 402 plan_limit', async () => {
      const t = await tenantWithKey(api, 'camp-validate');
      const dev = await device(t);
      for (const [over, field] of [
        [{ campaign_type: 'custom', custom_message: '' }, 'custom_message'],
        [{ contacts: [] }, 'contacts'],
        [{ campaign_type: 'fax' }, 'campaign_type'],
        [{ schedule_type: 'yesterday' }, 'schedule_type'],
      ] as const) {
        const res = await t.call.post('/campaigns', campaignBody(dev, over));
        expect(res.status, field).toBe(422);
        expect(res.body.error.code, field).toBe('validation_failed');
        expect(res.body.error.details[field], field).toBeDefined();
      }
      const noDevice = await t.call.post('/campaigns', {
        ...campaignBody(dev),
        device_id: undefined,
      });
      expect(noDevice.status).toBe(422);
      expect(noDevice.body.error.details.device_id).toBeDefined();

      await overrides(t.tenant.orgId, { limits: { total_campaigns: 1 } });
      expect((await t.call.post('/campaigns', campaignBody(dev))).status).toBe(201);
      const refused = await t.call.post('/campaigns', campaignBody(dev));
      expect(refused.status).toBe(402);
      expect(refused.body.error.code).toBe('plan_limit');
    });

    it('WD-API-085: the rollup counts campaigns by status and sums messages and rates; nothing of another workspace', async () => {
      const a = await tenantWithKey(api, 'camp-stats-a');
      const b = await tenantWithKey(api, 'camp-stats-b');
      const empty = await a.call.get('/campaigns/statistics');
      expect(empty.status).toBe(200);
      expect(empty.body.data).toEqual({
        campaigns: { total: 0, active: 0, completed: 0, scheduled: 0, failed: 0 },
        messages: {
          total_recipients: 0,
          sent: 0,
          delivered: 0,
          read: 0,
          failed: 0,
          clicked: 0,
          responded: 0,
        },
        rates: { delivery_rate: 0, read_rate: 0, click_rate: 0, response_rate: 0 },
      });

      const dev = await device(a);
      const one = await scheduled(a, dev, 5);
      const two = await scheduled(a, dev, 1);
      await scheduled(a, dev, 1);
      await scheduled(b, await device(b), 3);
      await setRecipients(one, ['sent', 'delivered', 'delivered', 'delivered', 'read']);
      await setStatus(one, 'completed');
      await setStatus(two, 'completed');

      const res = await a.call.get('/campaigns/statistics');
      expect(res.body.data.campaigns).toEqual({
        total: 3,
        active: 0,
        completed: 2,
        scheduled: 1,
        failed: 0,
      });
      expect(res.body.data.messages).toMatchObject({
        total_recipients: 7,
        sent: 5,
        delivered: 4,
        read: 1,
      });
      expect(res.body.data.rates.delivery_rate).toBe(80);
      expect(res.body.data.rates.read_rate).toBe(25);
    });

    it('WD-API-086: lists newest first with filters, cursor paging, rounded metrics and nothing of another workspace', async () => {
      const a = await tenantWithKey(api, 'camp-list-a');
      const b = await tenantWithKey(api, 'camp-list-b');
      const dev = await device(a);
      const spring = await scheduled(a, dev, 5, { campaign_name: 'Spring Sale' });
      const winter = await scheduled(a, dev, 1, { campaign_name: 'Winter' });
      const tplCamp = (
        await a.call.post(
          '/campaigns',
          campaignBody(dev, {
            campaign_name: 'Tpl',
            campaign_type: 'template',
            template_id: await template(a),
          }),
        )
      ).body.data.id as string;
      await scheduled(b, await device(b), 1);
      await setRecipients(spring, ['sent', 'delivered', 'delivered', 'delivered', 'sent']);
      await setStatus(spring, 'completed');

      const all = await a.call.get('/campaigns');
      expect(all.status).toBe(200);
      expect(all.body.data.map((c: { id: string }) => c.id)).toEqual([tplCamp, winter, spring]);
      expect(all.body.meta).toEqual({ limit: 25, next_cursor: null, has_more: false });
      const row = all.body.data.find((c: { id: string }) => c.id === spring);
      expect(row.metrics.delivery_rate).toBe(60);
      expect(row.counts).toMatchObject({ total_recipients: 5, sent: 5, delivered: 3 });

      expect(
        (await a.call.get('/campaigns?status=completed')).body.data.map(
          (c: { id: string }) => c.id,
        ),
      ).toEqual([spring]);
      expect(
        (await a.call.get('/campaigns?search=SPRING')).body.data.map((c: { id: string }) => c.id),
      ).toEqual([spring]);
      expect(
        (await a.call.get('/campaigns?campaign_type=template')).body.data.map(
          (c: { id: string }) => c.id,
        ),
      ).toEqual([tplCamp]);
      expect((await a.call.get('/campaigns?search=nothing')).body.data).toEqual([]);

      const p1 = await a.call.get('/campaigns?per_page=2');
      expect(p1.body.data).toHaveLength(2);
      expect(p1.body.meta.has_more).toBe(true);
      const p2 = await a.call.get(`/campaigns?limit=2&cursor=${p1.body.meta.next_cursor}`);
      expect(p2.body.data.map((c: { id: string }) => c.id)).toEqual([spring]);
      expect(p2.body.meta).toMatchObject({ has_more: false, next_cursor: null });
    });

    it('WD-API-088: show has live counts in data and meta; failed, read and delivered cascade; zero sent has zero metrics', async () => {
      const t = await tenantWithKey(api, 'camp-show');
      const dev = await device(t);
      const id = await scheduled(t, dev, 4);
      const zero = await t.call.get(`/campaigns/${id}`);
      expect(zero.status).toBe(200);
      expect(zero.body.meta.counts).toEqual({
        total: 4,
        sent: 0,
        delivered: 0,
        read: 0,
        failed: 0,
        clicked: 0,
        responded: 0,
      });
      expect(zero.body.meta.metrics).toEqual({
        delivery_rate: 0,
        read_rate: 0,
        click_rate: 0,
        response_rate: 0,
      });

      await setRecipients(id, ['failed', 'read', 'delivered', 'delivered']);
      const res = await t.call.get(`/campaigns/${id}`);
      expect(res.body.meta.counts).toEqual({
        total: 4,
        sent: 3,
        delivered: 3,
        read: 1,
        failed: 1,
        clicked: 0,
        responded: 0,
      });
      expect(res.body.data.counts).toMatchObject({
        total_recipients: 4,
        sent: 3,
        delivered: 3,
        read: 1,
        failed: 1,
      });
      expect(res.body.meta.metrics.delivery_rate).toBe(100);
      expect(res.body.meta.metrics.read_rate).toBeCloseTo(33.3333, 3);
      expect(res.body.data.metrics.read_rate).toBe(33.33);
      expect(res.body.data.status).toBe('completed');
    });

    it('WD-API-088, 089, 090: a missing, foreign or malformed id is 404 not_found on show, stop and delete', async () => {
      const a = await tenantWithKey(api, 'camp-404-a');
      const b = await tenantWithKey(api, 'camp-404-b');
      const mine = await scheduled(a, await device(a), 1);
      for (const [method, path] of [
        ['get', `/campaigns/${mine}`],
        ['post', `/campaigns/${mine}/stop`],
        ['delete', `/campaigns/${mine}`],
        ['get', `/campaigns/${randomUUID()}`],
        ['get', '/campaigns/12'],
      ] as const) {
        const res =
          method === 'get'
            ? await b.call.get(path)
            : method === 'post'
              ? await b.call.post(path)
              : await b.call.delete(path);
        expect(res.status, `${method} ${path}`).toBe(404);
        expect(res.body.error.code).toBe('not_found');
      }
      expect((await a.call.get(`/campaigns/${mine}`)).status).toBe(200);
    });

    it('WD-API-089: stopping a scheduled campaign answers stopped with an end time and a status event; a completed one is 422 not_stoppable', async () => {
      const t = await tenantWithKey(api, 'camp-stop');
      const dev = await device(t);
      const id = await scheduled(t, dev, 2);
      const res = await t.call.post(`/campaigns/${id}/stop`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({
        id,
        status: 'stopped',
        completed_at: expect.stringMatching(ISO),
      });
      expect(
        (await h.owner.query(`SELECT status FROM wpcampaigns WHERE uuid = $1`, [id])).rows[0]
          .status,
      ).toBe('cancelled');
      expect((await t.call.get(`/campaigns/${id}`)).body.data.status).toBe('stopped');
      const events = await api.events(t.tenant.orgId, 'campaign.status_updated');
      expect(events.at(-1)).toMatchObject({
        uuid: id,
        status: 'cancelled',
        previousStatus: 'scheduled',
      });

      const again = await t.call.post(`/campaigns/${id}/stop`);
      expect(again.status).toBe(422);
      expect(again.body.error.code).toBe('not_stoppable');

      const done = await scheduled(t, dev, 1);
      await setStatus(done, 'completed');
      await h.owner.query(
        `UPDATE wp_campaign_contacts SET status = 'sent' WHERE campaign_id = (SELECT id FROM wpcampaigns WHERE uuid = $1)`,
        [done],
      );
      const refused = await t.call.post(`/campaigns/${done}/stop`);
      expect(refused.status).toBe(422);
      expect(refused.body.error.code).toBe('not_stoppable');
      expect(
        (await h.owner.query(`SELECT status FROM wpcampaigns WHERE uuid = $1`, [done])).rows[0]
          .status,
      ).toBe('completed');
    });

    it('WD-API-089: a campaign just launched (running) can be stopped (INTENDED: WaDesk refused until it was processing)', async () => {
      const t = await tenantWithKey(api, 'camp-stop-running');
      const dev = await device(t);
      const id = (await t.call.post('/campaigns', campaignBody(dev))).body.data.id as string;
      const res = await t.call.post(`/campaigns/${id}/stop`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.status).toBe('stopped');
    });

    it('WD-API-090: deleting a completed campaign removes it and its recipients; running is 422 delete_failed; a stopped one can be deleted (INTENDED)', async () => {
      const t = await tenantWithKey(api, 'camp-delete');
      const dev = await device(t);
      const done = await scheduled(t, dev, 2);
      await h.owner.query(
        `UPDATE wp_campaign_contacts SET status = 'sent' WHERE campaign_id = (SELECT id FROM wpcampaigns WHERE uuid = $1)`,
        [done],
      );
      await setStatus(done, 'completed');
      const res = await t.call.delete(`/campaigns/${done}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({ deleted: true, message: expect.any(String) });
      expect((await t.call.get(`/campaigns/${done}`)).status).toBe(404);
      expect(await count('wp_campaign_contacts', t.tenant.orgId)).toBe(0);
      expect(await api.auditCount(t.tenant.orgId, 'campaigns', 'delete')).toBe(1);

      const running = (await t.call.post('/campaigns', campaignBody(dev))).body.data.id as string;
      const refused = await t.call.delete(`/campaigns/${running}`);
      expect(refused.status).toBe(422);
      expect(refused.body.error.code).toBe('delete_failed');
      expect((await t.call.get(`/campaigns/${running}`)).status).toBe(200);

      await t.call.post(`/campaigns/${running}/stop`);
      expect((await t.call.delete(`/campaigns/${running}`)).status).toBe(200);
    });
  });

  // ================================================================================================ scheduled messages

  describe('scheduled messages', () => {
    const inMinutes = (m: number) =>
      new Date(Date.now() + m * 60_000).toISOString().slice(0, 16).replace('T', ' ');
    const body = (over: Record<string, unknown> = {}) => ({
      name: 'Reminder',
      message: 'See you soon',
      recipients: [phone()],
      run_at: `${FUTURE} 10:30`,
      ...over,
    });
    const rowOf = async (uuid: string) =>
      (await h.owner.query(`SELECT * FROM scheduled_messages WHERE uuid = $1`, [uuid])).rows[0];

    it('WD-API-091: a schedule ten minutes ahead is saved with status scheduled, one recipient and no phone number in the answer', async () => {
      const t = await tenantWithKey(api, 'sch-create');
      const dev = await device(t);
      const number = phone();
      const res = await t.call.post(
        '/scheduled',
        body({ recipients: [number], run_at: inMinutes(10), device_id: dev }),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const d = res.body.data;
      expect(d).toMatchObject({
        name: 'Reminder',
        type: 'text',
        status: 'scheduled',
        message: 'See you soon',
        template_id: null,
        device_id: `baileys:${dev}`,
        recipient_count: 1,
        timezone: 'UTC',
        total_sent: 0,
        total_delivered: 0,
        total_failed: 0,
      });
      expect(new Date(d.run_at).getTime()).toBeGreaterThan(Date.now() + 8 * 60_000);
      expect(d.run_at).toMatch(ISO);
      expect(d.created_at).toMatch(ISO);
      expect(JSON.stringify(res.body)).not.toContain(number.replace('+', ''));
      const row = await rowOf(d.id);
      expect(row).toMatchObject({
        status: 'scheduled',
        schedule_type: 'once',
        recipient_type: 'number',
        total_recipients: 1,
      });
      expect(row.message_content).toBe('See you soon');
    });

    it('WD-API-091: run_at is read in the zone (Asia/Kolkata 09:00 is 03:30 UTC); an offset in the text is honoured', async () => {
      const t = await tenantWithKey(api, 'sch-zone');
      await device(t);
      const zoned = await t.call.post(
        '/scheduled',
        body({ run_at: '2031-12-01 09:00', timezone: 'Asia/Kolkata' }),
      );
      expect(zoned.status, JSON.stringify(zoned.body)).toBe(201);
      expect(zoned.body.data.run_at).toBe('2031-12-01T03:30:00.000Z');
      expect(zoned.body.data.timezone).toBe('Asia/Kolkata');

      const offset = await t.call.post(
        '/scheduled',
        body({ run_at: '2031-12-01T09:00:00+02:00', timezone: 'Asia/Kolkata' }),
      );
      expect(offset.body.data.run_at).toBe('2031-12-01T07:00:00.000Z');
    });

    it('WD-API-091: under two minutes ahead, an unparseable time or a bad zone is 422 schedule_failed with details; nothing is saved', async () => {
      const t = await tenantWithKey(api, 'sch-time');
      await device(t);
      const soon = await t.call.post('/scheduled', body({ run_at: inMinutes(0) }));
      expect(soon.status).toBe(422);
      expect(soon.body.error.code).toBe('schedule_failed');
      expect(soon.body.error.message).toMatch(/2 minutes/);
      expect(soon.body.error.details.run_at).toBeDefined();

      const junk = await t.call.post('/scheduled', body({ run_at: 'tomorrow morning' }));
      expect(junk.status).toBe(422);
      expect(junk.body.error.code).toBe('schedule_failed');
      const zone = await t.call.post('/scheduled', body({ timezone: 'Mars/Base' }));
      expect(zone.status).toBe(422);
      expect(zone.body.error.details.timezone).toBeDefined();
      expect(await count('scheduled_messages', t.tenant.orgId)).toBe(0);
    });

    it("WD-API-091: another workspace's template is 404 template_not_found; neither message nor template is a validation error", async () => {
      const a = await tenantWithKey(api, 'sch-tpl-a');
      const b = await tenantWithKey(api, 'sch-tpl-b');
      await device(a);
      const foreign = await a.call.post(
        '/scheduled',
        body({ message: undefined, template_id: await template(b) }),
      );
      expect(foreign.status).toBe(404);
      expect(foreign.body.error.code).toBe('template_not_found');

      const neither = await a.call.post('/scheduled', body({ message: undefined }));
      expect(neither.status).toBe(422);
      expect(neither.body.error.code).toBe('validation_failed');
      expect(neither.body.error.details.message).toBeDefined();
      for (const bad of [{ recipients: [] }, { name: '' }, { run_at: undefined }]) {
        expect((await a.call.post('/scheduled', body(bad))).status).toBe(422);
      }
      expect(await count('scheduled_messages', a.tenant.orgId)).toBe(0);
    });

    it('WD-API-091: formatted duplicates collapse to one recipient; a template schedule is typed template', async () => {
      const t = await tenantWithKey(api, 'sch-numbers');
      await device(t);
      const res = await t.call.post(
        '/scheduled',
        body({ recipients: ['+91 98765-43210', '919876543210'] }),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.recipient_count).toBe(1);

      const tpl = await template(t);
      const withTemplate = await t.call.post(
        '/scheduled',
        body({ message: undefined, template_id: tpl }),
      );
      expect(withTemplate.status, JSON.stringify(withTemplate.body)).toBe(201);
      expect(withTemplate.body.data).toMatchObject({ type: 'template', template_id: tpl });
    });

    it('WD-API-091: with no device_id the most recent connected device sends; with none connected, or an unknown device, it is 422 (INTENDED: WaDesk saved a message that never sends)', async () => {
      const t = await tenantWithKey(api, 'sch-sender');
      const none = await t.call.post('/scheduled', body());
      expect(none.status).toBe(422);
      expect(none.body.error.code).toBe('schedule_failed');
      expect(none.body.error.details.device_id).toBeDefined();

      await device(t, 'Old');
      const newest = await device(t, 'New');
      const res = await t.call.post('/scheduled', body());
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.device_id).toBe(`baileys:${newest}`);

      const unknown = await t.call.post('/scheduled', body({ device_id: randomUUID() }));
      expect(unknown.status).toBe(422);
      expect(unknown.body.error.details.device_id).toBeDefined();
      const foreign = await device(await tenantWithKey(api, 'sch-sender-b'));
      expect((await t.call.post('/scheduled', body({ device_id: foreign }))).status).toBe(422);
    });

    it('WD-API-092: lists the workspace newest first with cursor paging, cancelled ones included, nothing of another workspace', async () => {
      const a = await tenantWithKey(api, 'sch-list-a');
      const b = await tenantWithKey(api, 'sch-list-b');
      await device(a);
      await device(b);
      const ids: string[] = [];
      for (const run_at of ['2031-03-10 10:00', '2031-03-11 10:00', '2031-03-12 10:00']) {
        ids.push((await a.call.post('/scheduled', body({ run_at }))).body.data.id);
      }
      await b.call.post('/scheduled', body());
      await a.call.delete(`/scheduled/${ids[0]}`);

      const all = await a.call.get('/scheduled');
      expect(all.status).toBe(200);
      expect(all.body.data).toHaveLength(3);
      expect(new Set(all.body.data.map((s: { id: string }) => s.id))).toEqual(new Set(ids));
      expect(all.body.data.find((s: { id: string }) => s.id === ids[0]).status).toBe('cancelled');
      expect(all.body.meta).toEqual({ limit: 25, next_cursor: null, has_more: false });
      for (const s of all.body.data) expect(JSON.stringify(s)).not.toMatch(/phone|\+91/);

      const p1 = await a.call.get('/scheduled?limit=1');
      expect(p1.body.data).toHaveLength(1);
      expect(p1.body.meta).toMatchObject({ limit: 1, has_more: true });
      const p2 = await a.call.get(`/scheduled?limit=2&cursor=${p1.body.meta.next_cursor}`);
      expect(p2.body.data).toHaveLength(2);
      expect(p2.body.meta).toMatchObject({ has_more: false, next_cursor: null });
      expect(new Set([...p1.body.data, ...p2.body.data].map((s: { id: string }) => s.id))).toEqual(
        new Set(ids),
      );
      expect((await a.call.get('/scheduled?cursor=%25%25')).status).toBe(422);
      expect((await a.call.get('/scheduled?limit=999')).body.meta.limit).toBe(100);
    });

    it('WD-API-093: show carries the name, message, run_at, timezone and totals; foreign and malformed ids are 404', async () => {
      const a = await tenantWithKey(api, 'sch-show-a');
      const b = await tenantWithKey(api, 'sch-show-b');
      await device(a);
      const made = (
        await a.call.post(
          '/scheduled',
          body({ timezone: 'Asia/Kolkata', run_at: '2031-12-01 09:00' }),
        )
      ).body.data;
      await h.owner.query(
        `UPDATE scheduled_messages SET total_sent = 3, total_delivered = 2, total_failed = 1 WHERE uuid = $1`,
        [made.id],
      );

      const res = await a.call.get(`/scheduled/${made.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: made.id,
        name: 'Reminder',
        message: 'See you soon',
        run_at: '2031-12-01T03:30:00.000Z',
        timezone: 'Asia/Kolkata',
        total_sent: 3,
        total_delivered: 2,
        total_failed: 1,
        recipient_count: 1,
      });
      const digits = (
        await h.owner.query(`SELECT phone FROM scheduled_message_contacts WHERE org_id = $1`, [
          a.tenant.orgId,
        ])
      ).rows.map((r) => String(r.phone));
      for (const d of digits) expect(JSON.stringify(res.body)).not.toContain(d);
      for (const path of [`/scheduled/${made.id}`, `/scheduled/${randomUUID()}`, '/scheduled/12']) {
        const miss = await b.call.get(path);
        expect(miss.status, path).toBe(404);
        expect(miss.body.error.code, path).toBe('not_found');
      }
    });

    it('WD-API-094: DELETE cancels and keeps the row; a second DELETE, a finished or a failed schedule is 422 not_cancellable', async () => {
      const a = await tenantWithKey(api, 'sch-cancel-a');
      const b = await tenantWithKey(api, 'sch-cancel-b');
      await device(a);
      const id = (await a.call.post('/scheduled', body())).body.data.id as string;

      expect((await b.call.delete(`/scheduled/${id}`)).status).toBe(404);
      expect((await rowOf(id)).status).toBe('scheduled');

      const res = await a.call.delete(`/scheduled/${id}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({ id, status: 'cancelled' });
      expect((await rowOf(id)).status).toBe('cancelled');
      expect((await a.call.get(`/scheduled/${id}`)).body.data.status).toBe('cancelled');

      const again = await a.call.delete(`/scheduled/${id}`);
      expect(again.status).toBe(422);
      expect(again.body.error.code).toBe('not_cancellable');
      expect(again.body.error.message).toBe('This schedule is already finished.');

      for (const status of ['completed', 'failed']) {
        const other = (await a.call.post('/scheduled', body())).body.data.id as string;
        await h.owner.query(`UPDATE scheduled_messages SET status = $1 WHERE uuid = $2`, [
          status,
          other,
        ]);
        const refused = await a.call.delete(`/scheduled/${other}`);
        expect(refused.status, status).toBe(422);
        expect(refused.body.error.code, status).toBe('not_cancellable');
        expect((await rowOf(other)).status).toBe(status);
      }
    });
  });
});
