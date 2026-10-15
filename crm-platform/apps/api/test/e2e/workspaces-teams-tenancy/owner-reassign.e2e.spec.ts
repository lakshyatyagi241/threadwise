import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { OwnerReassignRepository } from '../../../src/modules/crm/owner-reassign/owner-reassign.repository';
import { OwnerReassignService } from '../../../src/modules/crm/owner-reassign/owner-reassign.service';
import { OwnerRestoreSweepService } from '../../../src/modules/crm/owner-reassign/owner-restore-sweep.service';
import { DealsApi, startHarness, type Harness } from '../deals-pipelines/support';
import type { Tenant } from '../contacts-attributes-tags/support';

/**
 * Reassign on demand with an opt-in restore (BL-112 phase 2): the batch moves a person's contacts and open deals with one audit row and
 * event each; restore returns only what nobody changed since (the trigger stamps the batch on the record), including the
 * "changed meanwhile" cases (a single edit, a bulk move, a later batch, a deleted record); targets (person, delegate, team round
 * robin) and their refusals; the record scope; the undo window; the automatic return by the sweep; tenant isolation.
 */
let h: Harness;
let api: DealsApi;
beforeAll(async () => {
  h = await startHarness();
  api = new DealsApi(h);
}, 600_000);
afterAll(async () => {
  await h?.stop();
});

const get = <T>(cls: new (...a: never[]) => T): T => h.app.get(cls as never, { strict: false });
const sweeper = () =>
  new OwnerRestoreSweepService(
    get(DatabaseService),
    get(OwnerReassignRepository),
    get(OwnerReassignService),
  );

const uuidOf = async (userId: number) =>
  (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [userId])).rows[0].uuid as string;

const call = (token: string) => ({
  preview: (fromUserId: string) =>
    api.as(token).post('/v2/owner-reassignments/preview').send({ fromUserId }),
  create: (body: Record<string, unknown>) =>
    api.as(token).post('/v2/owner-reassignments').set('idempotency-key', randomUUID()).send(body),
  restore: (id: string) => api.as(token).post(`/v2/owner-reassignments/${id}/restore`).send({}),
  get: (id: string) => api.as(token).get(`/v2/owner-reassignments/${id}`),
  list: (qs = '') => api.as(token).get(`/v2/owner-reassignments${qs}`),
});

interface World {
  t: Tenant;
  boss: string; // admin token
  from: { token: string; userId: number; uuid: string };
  to: { token: string; userId: number; uuid: string };
  third: { token: string; userId: number; uuid: string };
  contacts: string[];
  deals: string[];
}

/** A workspace where `from` owns 6 contacts, 3 open deals and 1 won deal. */
async function world(label: string): Promise<World> {
  const t = await api.signup(label);
  const person = async (n: string) => {
    const m = await api.memberWithRole(t, `${label}${n}`, 'Agent');
    return { ...m, uuid: await uuidOf(m.userId) };
  };
  const from = await person('from');
  const to = await person('to');
  const third = await person('third');
  const contacts = await api.seedContacts(
    t,
    Array.from({ length: 6 }, (_, i) => ({ name: `${label}-c${i}`, ownerId: from.userId })),
  );
  const deals: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const d = await api.deal(t.admin, {
      title: `${label}-d${i}`,
      value: '100',
      ownerId: from.uuid,
    });
    deals.push(d.id);
  }
  expect((await api.as(t.admin).post(`/v2/deals/${deals[3]}/won`).send({})).status).toBe(200);
  return { t, boss: t.admin, from, to, third, contacts, deals };
}

const ownerOfContact = async (uuid: string) =>
  Number(
    (await h.owner.query(`SELECT owner_id FROM contacts WHERE uuid = $1`, [uuid])).rows[0]
      ?.owner_id,
  );
const ownerOfDeal = async (uuid: string) =>
  Number(
    (await h.owner.query(`SELECT owner_user_id FROM deals WHERE uuid = $1`, [uuid])).rows[0]
      .owner_user_id,
  );
const stamp = async (uuid: string) =>
  (await h.owner.query(`SELECT owner_batch_id FROM contacts WHERE uuid = $1`, [uuid])).rows[0]
    ?.owner_batch_id;

describe('moving', () => {
  let w: World;
  beforeAll(async () => {
    w = await world('ra');
  });

  it('previews what would move, then moves contacts and OPEN deals to one person with an audit row and an event each', async () => {
    const pv = await call(w.boss).preview(w.from.uuid);
    expect(pv.status).toBe(200);
    expect(pv.body).toMatchObject({ contacts: 6, openDeals: 3 });

    const made = await call(w.boss).create({
      fromUserId: w.from.uuid,
      target: { kind: 'user', userId: w.to.uuid },
      reason: 'Holiday',
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body).toMatchObject({
      status: 'applied',
      movedContacts: 6,
      movedDeals: 3,
      remaining: 0,
      reason: 'Holiday',
      target: { kind: 'user', userId: w.to.uuid },
      canRestore: true,
    });
    for (const c of w.contacts) expect(await ownerOfContact(c)).toBe(w.to.userId);
    for (const d of w.deals.slice(0, 3)) expect(await ownerOfDeal(d)).toBe(w.to.userId);
    expect(await ownerOfDeal(w.deals[3]!)).toBe(w.from.userId); // the won deal is history

    const audits = await h.owner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'contacts' AND action = 'update'
         AND delta -> 'ownerId' ->> 'new' = $2`,
      [w.t.orgId, w.to.uuid],
    );
    expect(audits.rows[0].n).toBe(6);
    const evs = await h.owner.query(
      `SELECT count(*)::int AS n FROM event_outbox WHERE org_id = $1 AND event_type = 'contact.updated' AND payload ->> 'previousOwnerId' = $2`,
      [w.t.orgId, w.from.uuid],
    );
    expect(evs.rows[0].n).toBe(6);
    const dealEvs = await h.owner.query(
      `SELECT count(*)::int AS n FROM event_outbox WHERE org_id = $1 AND event_type = 'deal.owner_changed' AND payload ->> 'previousOwnerId' = $2`,
      [w.t.orgId, w.from.uuid],
    );
    expect(dealEvs.rows[0].n).toBe(3);
    const batch = (
      await h.owner.query(`SELECT id FROM owner_reassign_batches WHERE uuid = $1`, [made.body.id])
    ).rows[0];
    expect(Number(await stamp(w.contacts[0]!))).toBe(Number(batch.id));
    expect(
      (
        await h.owner.query(
          `SELECT 1 FROM event_outbox WHERE org_id = $1 AND event_type = 'owner.reassign.applied'`,
          [w.t.orgId],
        )
      ).rows.length,
    ).toBe(1);

    expect((await call(w.boss).get(made.body.id)).body.id).toBe(made.body.id);
    expect((await call(w.boss).list(`?fromUserId=${w.from.uuid}`)).body.data.length).toBe(1);
  });

  it('a person with nothing to move is refused; so is moving to themselves', async () => {
    const empty = await call(w.boss).create({
      fromUserId: w.third.uuid,
      target: { kind: 'user', userId: w.to.uuid },
    });
    expect(empty.status).toBe(422);
    expect(empty.body.code).toBe('WSP_REASSIGN_INVALID');
    const self = await call(w.boss).create({
      fromUserId: w.to.uuid,
      target: { kind: 'user', userId: w.to.uuid },
    });
    expect(self.status).toBe(422);
    expect(
      (
        await call(w.boss).create({
          fromUserId: randomUUID(),
          target: { kind: 'user', userId: w.to.uuid },
        })
      ).status,
    ).toBe(404);
  });

  it('the return day must be after today', async () => {
    const r = await call(w.boss).create({
      fromUserId: w.to.uuid,
      target: { kind: 'user', userId: w.third.uuid },
      restoreOn: '2020-01-01',
    });
    expect(r.status).toBe(422);
  });
});

describe('restoring: only what nobody changed since', () => {
  it('everything untouched comes back, with its audit row and event; a second restore is refused', async () => {
    const w = await world('rb');
    const made = (
      await call(w.boss).create({
        fromUserId: w.from.uuid,
        target: { kind: 'user', userId: w.to.uuid },
      })
    ).body;
    const back = await call(w.boss).restore(made.id);
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body).toMatchObject({
      status: 'restored',
      restoredContacts: 6,
      restoredDeals: 3,
      notRestored: 0,
      canRestore: false,
    });
    for (const c of w.contacts) {
      expect(await ownerOfContact(c)).toBe(w.from.userId);
      expect(await stamp(c)).toBeNull();
    }
    for (const d of w.deals) expect(await ownerOfDeal(d)).toBe(w.from.userId);
    const audits = await h.owner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'contacts' AND delta -> 'ownerId' ->> 'new' = $2`,
      [w.t.orgId, w.from.uuid],
    );
    expect(audits.rows[0].n).toBe(6);
    const again = await call(w.boss).restore(made.id);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('WSP_REASSIGN_NOT_RESTORABLE');
  });

  it('the changed-meanwhile cases stay put: a bulk move, a single edit, a deleted contact, a deal reassigned', async () => {
    const w = await world('rc');
    const made = (
      await call(w.boss).create({
        fromUserId: w.from.uuid,
        target: { kind: 'user', userId: w.to.uuid },
      })
    ).body;

    // 1. somebody moves two contacts to a third person through the bulk route
    const bulk = await api
      .as(w.boss)
      .post('/v2/contacts/bulk/owner')
      .send({ ids: [w.contacts[0], w.contacts[1]], ownerId: w.third.uuid });
    expect(bulk.status, JSON.stringify(bulk.body)).toBe(200);
    // 2. a single edit moves one back to the original owner (a deliberate later decision: it must NOT be touched either)
    const cur = await api.as(w.boss).get(`/v2/contacts/${w.contacts[2]}`);
    const edit = await api
      .as(w.boss)
      .patch(`/v2/contacts/${w.contacts[2]}`)
      .send({ ownerId: w.from.uuid, rowVersion: cur.body.rowVersion });
    expect(edit.status, JSON.stringify(edit.body)).toBeLessThan(300);
    // 3. a contact is deleted
    await h.owner.query(`DELETE FROM contacts WHERE uuid = $1`, [w.contacts[3]]);
    // 4. a deal is given to the third person
    const dealNow = await api.as(w.boss).get(`/v2/deals/${w.deals[0]}`);
    const dealEdit = await api
      .as(w.boss)
      .patch(`/v2/deals/${w.deals[0]}`)
      .send({ ownerId: w.third.uuid, rowVersion: dealNow.body.rowVersion });
    expect(dealEdit.status, JSON.stringify(dealEdit.body)).toBe(200);

    const back = await call(w.boss).restore(made.id);
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    // contacts: 6 moved; c0, c1 (bulk), c2 (edit), c3 (deleted) not restored; c4, c5 back
    expect(back.body).toMatchObject({ status: 'restored', restoredContacts: 2, restoredDeals: 2 });
    expect(back.body.notRestored).toBe(4 + 1);
    expect(await ownerOfContact(w.contacts[0]!)).toBe(w.third.userId);
    expect(await ownerOfContact(w.contacts[1]!)).toBe(w.third.userId);
    expect(await ownerOfContact(w.contacts[2]!)).toBe(w.from.userId); // already theirs, by the edit
    expect(await ownerOfContact(w.contacts[4]!)).toBe(w.from.userId);
    expect(await ownerOfContact(w.contacts[5]!)).toBe(w.from.userId);
    expect(await ownerOfDeal(w.deals[0]!)).toBe(w.third.userId);
    expect(await ownerOfDeal(w.deals[1]!)).toBe(w.from.userId);
  });

  it('a later batch that moved the same records wins: the first batch restores none of them', async () => {
    const w = await world('rd');
    const first = (
      await call(w.boss).create({
        fromUserId: w.from.uuid,
        target: { kind: 'user', userId: w.to.uuid },
        includeDeals: false,
      })
    ).body;
    const second = (
      await call(w.boss).create({
        fromUserId: w.to.uuid,
        target: { kind: 'user', userId: w.third.uuid },
        includeDeals: false,
      })
    ).body;
    expect(second.movedContacts).toBe(6);
    const r1 = (await call(w.boss).restore(first.id)).body;
    expect(r1).toMatchObject({ restoredContacts: 0, notRestored: 6 });
    for (const c of w.contacts) expect(await ownerOfContact(c)).toBe(w.third.userId);
    // restoring the second returns them to the middle person, and the deals were never part of either
    const r2 = (await call(w.boss).restore(second.id)).body;
    expect(r2.restoredContacts).toBe(6);
    for (const c of w.contacts) expect(await ownerOfContact(c)).toBe(w.to.userId);
    for (const d of w.deals.slice(0, 3)) expect(await ownerOfDeal(d)).toBe(w.from.userId);
  });

  it('includeDeals false leaves the deals alone', async () => {
    const w = await world('re');
    const made = (
      await call(w.boss).create({
        fromUserId: w.from.uuid,
        target: { kind: 'user', userId: w.to.uuid },
        includeDeals: false,
      })
    ).body;
    expect(made.movedDeals).toBe(0);
    for (const d of w.deals) expect(await ownerOfDeal(d)).toBe(w.from.userId);
  });

  it('the undo window: closed after 14 days unless a return was planned; a person who left is not given the work back', async () => {
    const w = await world('rf');
    const made = (
      await call(w.boss).create({
        fromUserId: w.from.uuid,
        target: { kind: 'user', userId: w.to.uuid },
      })
    ).body;
    await h.owner.query(
      `UPDATE owner_reassign_batches SET undo_until = now() - interval '1 day' WHERE uuid = $1`,
      [made.id],
    );
    expect((await call(w.boss).get(made.id)).body.canRestore).toBe(false);
    expect((await call(w.boss).restore(made.id)).status).toBe(409);

    await h.owner.query(
      `UPDATE owner_reassign_batches SET restore_on = current_date + 30 WHERE uuid = $1`,
      [made.id],
    );
    await h.owner.query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [w.from.userId]);
    const blocked = await call(w.boss).restore(made.id);
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(200);
    expect(blocked.body.status).toBe('restore_blocked');
    for (const c of w.contacts) expect(await ownerOfContact(c)).toBe(w.to.userId);
  });
});

describe('targets', () => {
  it('the delegate: used when there is one and they are present; refused with none or when away', async () => {
    const w = await world('rg');
    const none = await call(w.boss).create({
      fromUserId: w.from.uuid,
      target: { kind: 'delegate' },
    });
    expect(none.status).toBe(422);
    await h.owner.query(
      `INSERT INTO member_delegates (org_id, user_id, delegate_user_id) VALUES ($1,$2,$3)`,
      [w.t.orgId, w.from.userId, w.to.userId],
    );
    await h.owner.query(
      `INSERT INTO member_leaves (org_id, user_id, starts_on, ends_on, status)
       VALUES ($1,$2,(now() AT TIME ZONE 'UTC')::date - 1,(now() AT TIME ZONE 'UTC')::date + 3,'active')`,
      [w.t.orgId, w.to.userId],
    );
    expect(
      (await call(w.boss).create({ fromUserId: w.from.uuid, target: { kind: 'delegate' } })).status,
    ).toBe(422);
    await h.owner.query(`DELETE FROM member_leaves WHERE org_id = $1`, [w.t.orgId]);
    const ok = await call(w.boss).create({ fromUserId: w.from.uuid, target: { kind: 'delegate' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.target).toMatchObject({ kind: 'delegate', userId: w.to.uuid });
    expect(await ownerOfContact(w.contacts[0]!)).toBe(w.to.userId);
  });

  it('a team: round robin over the members who are present, never the person leaving or somebody on leave', async () => {
    const w = await world('rh');
    const m4 = await api.memberWithRole(w.t, 'rhm4', 'Agent');
    const team = (
      await h.owner.query(
        `INSERT INTO teams (org_id, name) VALUES ($1,'Desk') RETURNING id, uuid`,
        [w.t.orgId],
      )
    ).rows[0];
    for (const id of [w.from.userId, w.to.userId, w.third.userId, m4.userId]) {
      await h.owner.query(`INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`, [
        w.t.orgId,
        team.id,
        id,
      ]);
    }
    await h.owner.query(
      `INSERT INTO member_leaves (org_id, user_id, starts_on, ends_on, status)
       VALUES ($1,$2,(now() AT TIME ZONE 'UTC')::date - 1,(now() AT TIME ZONE 'UTC')::date + 3,'active')`,
      [w.t.orgId, m4.userId],
    );
    const made = await call(w.boss).create({
      fromUserId: w.from.uuid,
      target: { kind: 'team', teamId: team.uuid },
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.target).toMatchObject({ kind: 'team', teamName: 'Desk' });
    const owners = await Promise.all(w.contacts.map(ownerOfContact));
    expect(owners.filter((o) => o === w.to.userId).length).toBe(3);
    expect(owners.filter((o) => o === w.third.userId).length).toBe(3);
    expect(owners).not.toContain(w.from.userId);
    expect(owners).not.toContain(m4.userId);

    const empty = (
      await h.owner.query(`INSERT INTO teams (org_id, name) VALUES ($1,'Empty') RETURNING uuid`, [
        w.t.orgId,
      ])
    ).rows[0];
    expect(
      (
        await call(w.boss).create({
          fromUserId: w.to.uuid,
          target: { kind: 'team', teamId: empty.uuid },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call(w.boss).create({
          fromUserId: w.to.uuid,
          target: { kind: 'team', teamId: randomUUID() },
        })
      ).status,
    ).toBe(404);
  });
});

describe('who may', () => {
  it('own scope: only their own book, only to themselves; deals need the deals grant', async () => {
    const w = await world('ri');
    const own = await api.member(w.t, 'riown', [
      ['record.contacts.update', 'own'],
      ['record.contacts.read', 'own'],
      ['team.leave.read', 'all'],
    ]);
    // somebody else's book: forbidden
    expect((await call(own.token).preview(w.from.uuid)).status).toBe(403);
    expect(
      (
        await call(own.token).create({
          fromUserId: w.from.uuid,
          target: { kind: 'user', userId: await uuidOf(own.userId) },
        })
      ).status,
    ).toBe(403);
    // their own book to a colleague: forbidden (a record that vanishes from their view)
    await api.seedContacts(w.t, [{ name: 'mine', ownerId: own.userId }]);
    const toOther = await call(own.token).create({
      fromUserId: await uuidOf(own.userId),
      target: { kind: 'user', userId: w.to.uuid },
      includeDeals: false,
    });
    expect(toOther.status).toBe(403);
    // restore of a batch about somebody else: forbidden
    const made = (
      await call(w.boss).create({
        fromUserId: w.from.uuid,
        target: { kind: 'user', userId: w.to.uuid },
      })
    ).body;
    expect((await call(own.token).restore(made.id)).status).toBe(403);
    // a reader can see the history but not move
    const reader = await api.member(w.t, 'rirdr', [['team.leave.read', 'all']]);
    expect((await call(reader.token).list()).status).toBe(200);
    expect(
      (
        await call(reader.token).create({
          fromUserId: w.from.uuid,
          target: { kind: 'user', userId: w.to.uuid },
        })
      ).status,
    ).toBe(403);
  });

  it('an all-scope contact editor without deal rights cannot move deals, and can move contacts alone', async () => {
    const w = await world('rj');
    const lead = await api.member(w.t, 'rjlead', [
      ['record.contacts.update', 'all'],
      ['record.contacts.read', 'all'],
      ['team.leave.read', 'all'],
    ]);
    expect(
      (
        await call(lead.token).create({
          fromUserId: w.from.uuid,
          target: { kind: 'user', userId: w.to.uuid },
        })
      ).status,
    ).toBe(403);
    const ok = await call(lead.token).create({
      fromUserId: w.from.uuid,
      target: { kind: 'user', userId: w.to.uuid },
      includeDeals: false,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.movedContacts).toBe(6);
  });

  it("tenants never see or touch each other's batches", async () => {
    const w = await world('rk');
    const other = await api.signup('rko');
    const made = (
      await call(w.boss).create({
        fromUserId: w.from.uuid,
        target: { kind: 'user', userId: w.to.uuid },
      })
    ).body;
    expect((await call(other.admin).get(made.id)).status).toBe(404);
    expect((await call(other.admin).restore(made.id)).status).toBe(404);
    expect((await call(other.admin).preview(w.from.uuid)).status).toBe(404);
    expect(
      (
        await call(other.admin).create({
          fromUserId: w.from.uuid,
          target: { kind: 'user', userId: w.to.uuid },
        })
      ).status,
    ).toBe(404);
    expect((await call(other.admin).list()).body.data).toEqual([]);
  });
});

describe('the automatic return', () => {
  it('on the return day the sweep restores the batch as the system, leaving what was changed meanwhile; a planned return stays for later days', async () => {
    const w = await world('rl');
    const due = (
      await call(w.boss).create({
        fromUserId: w.from.uuid,
        target: { kind: 'user', userId: w.to.uuid },
        restoreOn: '2199-01-01',
      })
    ).body;
    expect(due.restoreOn).toBe('2199-01-01');
    // somebody changes one contact meanwhile
    expect(
      (
        await api
          .as(w.boss)
          .post('/v2/contacts/bulk/owner')
          .send({ ids: [w.contacts[0]], ownerId: w.third.uuid })
      ).status,
    ).toBe(200);

    await sweeper().sweep();
    expect((await call(w.boss).get(due.id)).body.status).toBe('applied'); // not yet the day

    await h.owner.query(
      `UPDATE owner_reassign_batches SET restore_on = (now() AT TIME ZONE 'UTC')::date WHERE uuid = $1`,
      [due.id],
    );
    expect(await sweeper().sweep()).toBeGreaterThanOrEqual(1);
    const done = (await call(w.boss).get(due.id)).body;
    expect(done).toMatchObject({
      status: 'restored',
      restoredContacts: 5,
      restoredDeals: 3,
      notRestored: 1,
    });
    expect(await ownerOfContact(w.contacts[0]!)).toBe(w.third.userId);
    expect(await ownerOfContact(w.contacts[1]!)).toBe(w.from.userId);
    const ev = (
      await h.owner.query(
        `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = 'owner.reassign.restored'`,
        [w.t.orgId],
      )
    ).rows;
    expect(ev.length).toBe(1);
    expect(ev[0].payload).toMatchObject({ automatic: true, contacts: 5 });
    // a second pass does nothing
    expect(await sweeper().sweep()).toBe(0);
  });
});
