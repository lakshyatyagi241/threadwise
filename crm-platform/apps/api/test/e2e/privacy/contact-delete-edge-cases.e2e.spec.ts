import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  conversationOf,
  simChannel,
  simInbound,
  startPipeline,
  type Pipeline,
  type SimChannel,
} from '../chat-conversations/pipeline-support';
import type { Tenant } from '../contacts-attributes-tags/support';

/**
 * Edge cases of deleting a contact from the CRM (single and bulk): unknown, malformed, stale and foreign ids, a second or parallel
 * delete, a reader or an "own" scope that may not delete, bad query values, a bulk request with duplicates or past one batch, and
 * what the delete leaves behind (conversations, the AI scoring log, the audit trail).
 */
let p: Pipeline;
let a: Tenant;
let b: Tenant;
let ch: SimChannel;

const q = async (sql: string, params: unknown[] = []) => (await p.h.owner.query(sql, params)).rows;
const n = async (sql: string, params: unknown[] = []) => Number((await q(sql, params))[0]?.n ?? 0);

const contactId = async (t: Tenant, uuid: string) =>
  Number(
    (await q(`SELECT id FROM contacts WHERE org_id = $1 AND uuid = $2`, [t.orgId, uuid]))[0].id,
  );

const contactExists = (t: Tenant, uuid: string) =>
  n(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1 AND uuid = $2`, [t.orgId, uuid]);

const deleteAudits = (t: Tenant) =>
  n(
    `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'contacts' AND action = 'delete'`,
    [t.orgId],
  );

async function seedWithHistory(t: Tenant, phone: string, name: string) {
  const created = await p.api
    .as(t.admin)
    .post('/v2/contacts')
    .send({ name, phone: `+${phone}` });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const uuid = created.body.id as string;
  const id = await contactId(t, uuid);
  await simInbound(p, t, ch, { from: phone, name, text: `hi from ${name}` });
  const conv = await conversationOf(p, t, ch, phone);
  await p.h.owner.query(`UPDATE conversations SET contact_id = $1 WHERE id = $2 AND org_id = $3`, [
    id,
    conv.id,
    t.orgId,
  ]);
  return { uuid, id, convId: Number(conv.id) };
}

beforeAll(async () => {
  p = await startPipeline();
  a = await p.api.signup('delA');
  b = await p.api.signup('delB');
  ch = await simChannel(p, a);
}, 720_000);

afterAll(async () => {
  await p?.stop();
});

describe('single delete: ids and repeats', () => {
  it('an unknown contact is 404 and writes no audit row', async () => {
    const before = await deleteAudits(a);
    const res = await p.api.as(a.admin).delete(`/v2/contacts/${randomUUID()}`);
    expect(res.status).toBe(404);
    expect(await deleteAudits(a)).toBe(before);
  });

  it('a malformed id is 400, not a server error', async () => {
    const res = await p.api.as(a.admin).delete('/v2/contacts/not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('a contact of another workspace is 404 and stays', async () => {
    const created = await p.api
      .as(b.admin)
      .post('/v2/contacts')
      .send({ name: 'Tenant B only', phone: '+919800000090' });
    expect(created.status).toBe(201);
    const res = await p.api.as(a.admin).delete(`/v2/contacts/${created.body.id}`);
    expect(res.status).toBe(404);
    expect(await contactExists(b, created.body.id)).toBe(1);
  });

  it('a second delete of the same contact is 404 and writes no second audit row', async () => {
    const x = await seedWithHistory(a, '919800000101', 'Twice Gone');
    expect((await p.api.as(a.admin).delete(`/v2/contacts/${x.uuid}`)).status).toBe(204);
    const before = await deleteAudits(a);
    expect((await p.api.as(a.admin).delete(`/v2/contacts/${x.uuid}`)).status).toBe(404);
    expect(await deleteAudits(a)).toBe(before);
  });

  it('two parallel deletes of one contact: one 204, one 404, one audit row', async () => {
    const x = await seedWithHistory(a, '919800000102', 'Race Delete');
    const before = await deleteAudits(a);
    const [r1, r2] = await Promise.all([
      p.api.as(a.admin).delete(`/v2/contacts/${x.uuid}`),
      p.api.as(a.admin).delete(`/v2/contacts/${x.uuid}`),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([204, 404]);
    expect(await deleteAudits(a)).toBe(before + 1);
    expect(await contactExists(a, x.uuid)).toBe(0);
  });

  it('a junk eraseHistory value is 422 and deletes nothing', async () => {
    const x = await seedWithHistory(a, '919800000103', 'Junk Flag');
    const res = await p.api.as(a.admin).delete(`/v2/contacts/${x.uuid}?eraseHistory=maybe`);
    expect(res.status).toBe(422);
    expect(await contactExists(a, x.uuid)).toBe(1);
    expect(
      await n(`SELECT count(*)::int AS n FROM conversations WHERE org_id = $1 AND id = $2`, [
        a.orgId,
        x.convId,
      ]),
    ).toBe(1);
  });
});

describe('single delete: who may delete', () => {
  it('a member who can only read is 403 and the contact stays', async () => {
    const reader = await p.api.member(a, 'delReader', [['record.contacts.read']]);
    const x = await seedWithHistory(a, '919800000111', 'Read Only Target');
    const res = await p.api.as(reader.token).delete(`/v2/contacts/${x.uuid}`);
    expect(res.status).toBe(403);
    expect(await contactExists(a, x.uuid)).toBe(1);
  });

  it('scope "own": a contact owned by someone else is refused and stays', async () => {
    const m = await p.api.member(a, 'delOwn', [
      ['record.contacts.delete', 'own'],
      ['record.contacts.read', 'own'],
    ]);
    const [theirs] = await p.api.seedContacts(a, [
      { name: 'Someone Else', phone: '+919800000121', ownerId: a.adminUserId },
    ]);
    const res = await p.api.as(m.token).delete(`/v2/contacts/${theirs}`);
    expect(res.status).toBe(404);
    expect(await contactExists(a, theirs)).toBe(1);
  });

  it('scope "own": the caller may delete a contact they own', async () => {
    const m = await p.api.member(a, 'delOwner', [
      ['record.contacts.delete', 'own'],
      ['record.contacts.read', 'own'],
    ]);
    const [mine] = await p.api.seedContacts(a, [
      { name: 'Mine To Delete', phone: '+919800000122', ownerId: m.userId },
    ]);
    expect((await p.api.as(m.token).delete(`/v2/contacts/${mine}`)).status).toBe(204);
    expect(await contactExists(a, mine)).toBe(0);
  });
});

describe('single delete: what it leaves behind', () => {
  it('the audit row stays and only its changed values are cleared; the audit trail stays append-only otherwise', async () => {
    const x = await seedWithHistory(a, '919800000151', 'Audit Kept');
    const version = (await q(`SELECT row_version FROM contacts WHERE id = $1`, [x.id]))[0]
      .row_version;
    const patched = await p.api
      .as(a.admin)
      .patch(`/v2/contacts/${x.uuid}`)
      .send({ name: 'Audit Renamed', rowVersion: version });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    const before = (
      await q(
        `SELECT id, action, delta FROM audit_log WHERE org_id = $1 AND module = 'contacts' AND record_id = $2 AND action = 'update' AND delta IS NOT NULL`,
        [a.orgId, x.id],
      )
    )[0];
    expect(before).toBeDefined();
    expect((await p.api.as(a.admin).delete(`/v2/contacts/${x.uuid}`)).status).toBe(204);
    const after = (await q(`SELECT action, delta FROM audit_log WHERE id = $1`, [before.id]))[0];
    expect(after).toEqual({ action: 'update', delta: null });
    // Any other change to an audit row is refused, for the table owner too.
    await expect(
      p.h.owner.query(`UPDATE audit_log SET action = 'edited' WHERE id = $1`, [before.id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      p.h.owner.query(`UPDATE audit_log SET delta = '{"name":"x"}'::jsonb WHERE id = $1`, [
        before.id,
      ]),
    ).rejects.toThrow(/append-only/);
  });

  it('the AI scoring log loses the name and the reasons but keeps the cost row', async () => {
    const x = await seedWithHistory(a, '919800000131', 'Scored Person');
    await p.h.owner.query(
      `INSERT INTO lead_scoring_runs (org_id, contact_id, contact_name, status, trigger, score, reasons, model, cost_usd, cost_source)
       VALUES ($1,$2,'Scored Person','ok','created',40,'["Replied twice"]'::jsonb,'m',0.00123,'vendor')`,
      [a.orgId, x.id],
    );
    expect((await p.api.as(a.admin).delete(`/v2/contacts/${x.uuid}`)).status).toBe(204);
    const run = (
      await q(
        `SELECT contact_id, contact_name, reasons, cost_usd::text AS cost FROM lead_scoring_runs WHERE org_id = $1 AND score = 40 AND model = 'm'`,
        [a.orgId],
      )
    )[0];
    expect(run).toEqual({
      contact_id: null,
      contact_name: null,
      reasons: null,
      cost: '0.00123000',
    });
  });

  it('the conversation is erased and the lead stays, unlinked', async () => {
    const x = await seedWithHistory(a, '919800000141', 'Business Kept');
    await p.h.owner.query(
      `INSERT INTO leads (org_id, name, phone, email, contact_id, source) VALUES ($1,'Business Kept','+919800000141','bk@example.test',$2,'manual')`,
      [a.orgId, x.id],
    );
    expect((await p.api.as(a.admin).delete(`/v2/contacts/${x.uuid}`)).status).toBe(204);
    expect(
      await n(`SELECT count(*)::int AS n FROM conversations WHERE org_id = $1 AND id = $2`, [
        a.orgId,
        x.convId,
      ]),
    ).toBe(0);
    expect(
      await n(
        `SELECT count(*)::int AS n FROM leads WHERE org_id = $1 AND name = 'Business Kept' AND contact_id IS NULL`,
        [a.orgId],
      ),
    ).toBe(1);
  });
});

describe('bulk delete edge cases', () => {
  it('a duplicated id is deleted once and counted once', async () => {
    const [dup] = await p.api.seedContacts(a, [{ name: 'Dup Once', phone: '+919800000201' }]);
    const res = await p.api
      .as(a.admin)
      .post('/v2/contacts/bulk/delete')
      .send({ ids: [dup, dup] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ changed: 1, failedCount: 0 });
    expect(await contactExists(a, dup)).toBe(0);
  });

  it('an id from another workspace is listed as failed; that workspace keeps its contact', async () => {
    const [mine] = await p.api.seedContacts(a, [{ name: 'Mine Bulk', phone: '+919800000211' }]);
    const [theirs] = await p.api.seedContacts(b, [{ name: 'Theirs Bulk', phone: '+919800000212' }]);
    const res = await p.api
      .as(a.admin)
      .post('/v2/contacts/bulk/delete')
      .send({ ids: [mine, theirs] });
    expect(res.body).toMatchObject({ changed: 1, failedCount: 1 });
    expect(res.body.failed[0].id).toBe(theirs);
    expect(await contactExists(b, theirs)).toBe(1);
  });

  it('an empty id list is refused and deletes nothing', async () => {
    const before = await n(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [a.orgId]);
    const res = await p.api.as(a.admin).post('/v2/contacts/bulk/delete').send({ ids: [] });
    expect(res.status).toBe(422);
    expect(await n(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [a.orgId])).toBe(
      before,
    );
  });

  it('eraseHistory=false keeps the conversation without the identity', async () => {
    const x = await seedWithHistory(a, '919800000221', 'Bulk Anonymised');
    const res = await p.api
      .as(a.admin)
      .post('/v2/contacts/bulk/delete')
      .send({ ids: [x.uuid], eraseHistory: false });
    expect(res.body).toMatchObject({ changed: 1 });
    expect(await contactExists(a, x.uuid)).toBe(0);
    const conv = (
      await q(`SELECT peer_key, peer_name FROM conversations WHERE id = $1`, [x.convId])
    )[0];
    expect(conv.peer_key).toMatch(/^erased:/);
    expect(conv.peer_name).toBeNull();
  });

  it('more contacts than one batch are all deleted, with one audit row each', async () => {
    await p.h.owner.query(
      `INSERT INTO contacts (org_id, name, phone)
       SELECT $1, 'Batch Load ' || g, '+9198' || lpad(g::text, 8, '0') FROM generate_series(1, 520) g`,
      [a.orgId],
    );
    const before = await deleteAudits(a);
    const res = await p.api
      .as(a.admin)
      .post('/v2/contacts/bulk/delete')
      .send({ filter: { q: 'Batch Load' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ matched: 520, changed: 520, failedCount: 0 });
    expect(await deleteAudits(a)).toBe(before + 520);
    expect(
      await n(
        `SELECT count(*)::int AS n FROM contacts WHERE org_id = $1 AND name LIKE 'Batch Load %'`,
        [a.orgId],
      ),
    ).toBe(0);
  });
});
