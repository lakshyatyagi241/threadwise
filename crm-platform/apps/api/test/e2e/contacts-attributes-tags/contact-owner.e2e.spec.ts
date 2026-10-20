import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from './support';

/**
 * The owner of a contact end to end: who may be named, who sees what, the list filter (several people and "nobody"), the
 * reassignment of a whole filter through `POST /contacts/bulk/owner`, and the audit and outbox trail it leaves.
 * Reference had only a creator (`user_id`, never shown); the owner is an extension recorded in the parity notes.
 */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const uuidOf = async (userId: number) =>
  (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [userId])).rows[0].uuid as string;

const ownerOfRow = async (t: Tenant, contactUuid: string) =>
  (
    await h.owner.query(
      `SELECT u.uuid AS owner FROM contacts c LEFT JOIN users u ON u.org_id = c.org_id AND u.id = c.owner_id
       WHERE c.org_id = $1 AND c.uuid = $2`,
      [t.orgId, contactUuid],
    )
  ).rows[0].owner as string | null;

const phone = (i: number) => `+9170${String(20_000_000 + i)}`;

const KEYS = ['record.contacts.read', 'record.contacts.create', 'record.contacts.update'] as const;
const scoped = (scope: 'all' | 'team' | 'own'): Array<[string, 'all' | 'team' | 'own']> =>
  KEYS.map((k) => [k, scope]);

describe('create and edit with an owner', () => {
  let t: Tenant;
  let asha: { token: string; userId: number };
  let ashaUuid: string;
  let adminUuid: string;

  beforeAll(async () => {
    t = await api.signup('own');
    asha = await api.member(t, 'asha', scoped('all'));
    ashaUuid = await uuidOf(asha.userId);
    adminUuid = await uuidOf(t.adminUserId);
  });

  it('a contact created without an owner belongs to its creator (Reference stamped user_id with the caller)', async () => {
    const res = await api
      .as(asha.token)
      .post('/v2/contacts')
      .send({ firstName: 'Default', phone: phone(1) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.ownerId).toBe(ashaUuid);
  });

  it('can be given to someone else, or to nobody with null', async () => {
    const other = await api
      .as(asha.token)
      .post('/v2/contacts')
      .send({ firstName: 'Given', phone: phone(2), ownerId: adminUuid });
    expect(other.status, JSON.stringify(other.body)).toBe(201);
    expect(other.body.ownerId).toBe(adminUuid);

    const nobody = await api
      .as(asha.token)
      .post('/v2/contacts')
      .send({ firstName: 'Nobody', phone: phone(3), ownerId: null });
    expect(nobody.status, JSON.stringify(nobody.body)).toBe(201);
    expect(nobody.body.ownerId).toBeNull();
  });

  it('refuses a person who does not exist, and a person of another workspace (tenant isolation)', async () => {
    const stranger = await api.signup('own-other');
    const strangerUuid = await uuidOf(stranger.adminUserId);
    for (const ownerId of [randomUUID(), strangerUuid]) {
      const res = await api
        .as(asha.token)
        .post('/v2/contacts')
        .send({ firstName: 'Ghost', phone: phone(4), ownerId });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    }
  });

  it('changes and clears the owner on an edit, keeping row-version handling', async () => {
    const made = await api
      .as(asha.token)
      .post('/v2/contacts')
      .send({ firstName: 'Edit', phone: phone(5) });
    const moved = await api
      .as(asha.token)
      .patch(`/v2/contacts/${made.body.id}`)
      .send({ ownerId: adminUuid, rowVersion: made.body.rowVersion });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.ownerId).toBe(adminUuid);
    expect(moved.body.rowVersion).toBeGreaterThan(made.body.rowVersion);

    const stale = await api
      .as(asha.token)
      .patch(`/v2/contacts/${made.body.id}`)
      .send({ ownerId: null, rowVersion: made.body.rowVersion });
    expect(stale.status).toBe(409);

    const cleared = await api
      .as(asha.token)
      .patch(`/v2/contacts/${made.body.id}`)
      .send({ ownerId: null, rowVersion: moved.body.rowVersion });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(cleared.body.ownerId).toBeNull();
  });

  it('an edit that does not touch the owner keeps it, whoever saves', async () => {
    const made = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ firstName: 'Keeps', phone: phone(6), ownerId: ashaUuid });
    const saved = await api
      .as(t.admin)
      .patch(`/v2/contacts/${made.body.id}`)
      .send({ lastName: 'Same', rowVersion: made.body.rowVersion });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.ownerId).toBe(ashaUuid);
  });
});

describe('the record scope bounds who a contact may be handed to', () => {
  let t: Tenant;
  let own: { token: string; userId: number };
  let mate: { token: string; userId: number };
  let far: { token: string; userId: number };
  let ownUuid: string;
  let mateUuid: string;
  let farUuid: string;

  beforeAll(async () => {
    t = await api.signup('scope');
    own = await api.member(t, 'ownscope', scoped('own'));
    mate = await api.member(t, 'mate', scoped('all'));
    far = await api.member(t, 'far', scoped('all'));
    ownUuid = await uuidOf(own.userId);
    mateUuid = await uuidOf(mate.userId);
    farUuid = await uuidOf(far.userId);
  });

  it('an own-scope member can create for themselves but not for a colleague, nor for nobody', async () => {
    const mine = await api
      .as(own.token)
      .post('/v2/contacts')
      .send({ firstName: 'Mine', phone: phone(10), ownerId: ownUuid });
    expect(mine.status, JSON.stringify(mine.body)).toBe(201);

    for (const ownerId of [mateUuid, null]) {
      const res = await api
        .as(own.token)
        .post('/v2/contacts')
        .send({ firstName: 'Away', phone: phone(11), ownerId });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(JSON.stringify(res.body)).toContain('ownerId');
    }
  });

  it('an own-scope member cannot hand an existing contact to a colleague', async () => {
    const mine = await api
      .as(own.token)
      .post('/v2/contacts')
      .send({ firstName: 'Stay', phone: phone(12) });
    const res = await api
      .as(own.token)
      .patch(`/v2/contacts/${mine.body.id}`)
      .send({ ownerId: mateUuid, rowVersion: mine.body.rowVersion });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(await ownerOfRow(t, mine.body.id)).toBe(ownUuid);
  });

  it('the owner picker marks who each person may assign to: all, a team, or only themselves', async () => {
    const asAll = (await api.as(t.admin).get('/v2/contacts/assignees')).body as Array<{
      id: string;
      canAssign: boolean;
    }>;
    expect(asAll.length).toBeGreaterThanOrEqual(4);
    expect(asAll.every((p) => p.canAssign)).toBe(true);

    const asOwn = (await api.as(own.token).get('/v2/contacts/assignees')).body as Array<{
      id: string;
      canAssign: boolean;
    }>;
    expect(asOwn.filter((p) => p.canAssign).map((p) => p.id)).toEqual([ownUuid]);

    // A team reaches the colleague they share a team with, and nobody else.
    const teamMember = await api.member(t, 'teamy', scoped('team'));
    const teamUuid = await uuidOf(teamMember.userId);
    const team = await h.owner.query(
      `INSERT INTO teams (org_id, name) VALUES ($1, 'Sales') RETURNING id`,
      [t.orgId],
    );
    for (const u of [teamMember.userId, mate.userId]) {
      await h.owner.query(`INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`, [
        t.orgId,
        team.rows[0].id,
        u,
      ]);
    }
    const asTeam = (await api.as(teamMember.token).get('/v2/contacts/assignees')).body as Array<{
      id: string;
      canAssign: boolean;
    }>;
    expect(
      asTeam
        .filter((p) => p.canAssign)
        .map((p) => p.id)
        .sort(),
    ).toEqual([teamUuid, mateUuid].sort());
    expect(asTeam.find((p) => p.id === farUuid)?.canAssign).toBe(false);
  });
});

describe('filtering by owner', () => {
  let t: Tenant;
  let a: { token: string; userId: number };
  let b: { token: string; userId: number };
  let c: { token: string; userId: number };
  let aU: string;
  let bU: string;
  let cU: string;

  beforeAll(async () => {
    t = await api.signup('flt');
    a = await api.member(t, 'fa', scoped('all'));
    b = await api.member(t, 'fb', scoped('all'));
    c = await api.member(t, 'fc', scoped('own'));
    [aU, bU, cU] = await Promise.all([uuidOf(a.userId), uuidOf(b.userId), uuidOf(c.userId)]);
    await api.seedContacts(t, [
      { name: 'A one', phone: phone(30), ownerId: a.userId },
      { name: 'A two', phone: phone(31), ownerId: a.userId },
      { name: 'B one', phone: phone(32), ownerId: b.userId },
      { name: 'C one', phone: phone(33), ownerId: c.userId },
      { name: 'Nobody one', phone: phone(34), ownerId: null },
      { name: 'Nobody two', phone: phone(35), ownerId: null },
    ]);
  });

  const names = async (token: string, query: string) =>
    (
      ((await api.as(token).get(`/v2/contacts?${query}&limit=100`)).body.data ?? []) as Array<{
        name: string;
      }>
    )
      .map((r) => r.name)
      .sort();

  it('one person, several people, nobody, and people together with nobody', async () => {
    expect(await names(t.admin, `ownerIds=${aU}`)).toEqual(['A one', 'A two']);
    expect(await names(t.admin, `ownerIds=${aU},${bU}`)).toEqual(['A one', 'A two', 'B one']);
    expect(await names(t.admin, 'unassigned=true')).toEqual(['Nobody one', 'Nobody two']);
    expect(await names(t.admin, `ownerIds=${bU}&unassigned=true`)).toEqual([
      'B one',
      'Nobody one',
      'Nobody two',
    ]);
    // the single-person filter that existed before keeps working
    expect(await names(t.admin, `ownerId=${bU}`)).toEqual(['B one']);
  });

  it('an unknown person owns nothing; with "nobody" asked as well, only the unassigned come back', async () => {
    expect(await names(t.admin, `ownerIds=${randomUUID()}`)).toEqual([]);
    expect(await names(t.admin, `ownerIds=${randomUUID()}&unassigned=true`)).toEqual([
      'Nobody one',
      'Nobody two',
    ]);
  });

  it('a person of another workspace owns nothing here (tenant isolation)', async () => {
    const stranger = await api.signup('flt-other');
    const strangerUuid = await uuidOf(stranger.adminUserId);
    expect(await names(t.admin, `ownerIds=${strangerUuid}`)).toEqual([]);
  });

  it('the owner filter never widens what an own-scope member sees', async () => {
    // c may only see their own contact, whatever owner they ask for
    expect(await names(c.token, `ownerIds=${aU},${bU}`)).toEqual([]);
    expect(await names(c.token, 'unassigned=true')).toEqual([]);
    expect(await names(c.token, `ownerIds=${cU},${aU}`)).toEqual(['C one']);
    expect(await names(c.token, '')).toEqual(['C one']);
  });

  it('the total shown for the filter is the count of those people', async () => {
    const res = await api
      .as(t.admin)
      .get(`/v2/contacts?ownerIds=${aU},${bU}&includeTotal=true&limit=1`);
    expect(res.body.meta.total).toBe(3);
  });

  it('save-as-segment turns the owner filter into rules that select the same contacts', async () => {
    const seg = await api
      .as(t.admin)
      .post('/v2/segments/from-filters')
      .send({ name: 'A, B or nobody', filter: { ownerIds: [aU, bU], unassigned: true } });
    expect(seg.status, JSON.stringify(seg.body)).toBeLessThan(300);
    const members = await api.as(t.admin).get(`/v2/contacts?segmentId=${seg.body.id}&limit=100`);
    expect((members.body.data as Array<{ name: string }>).map((r) => r.name).sort()).toEqual([
      'A one',
      'A two',
      'B one',
      'Nobody one',
      'Nobody two',
    ]);
  });
});

describe('reassigning a selection, or everything a filter matches', () => {
  let t: Tenant;
  let boss: { token: string; userId: number };
  let from: { token: string; userId: number };
  let to: { token: string; userId: number };
  let limited: { token: string; userId: number };
  let fromU: string;
  let toU: string;
  let limitedU: string;

  beforeAll(async () => {
    t = await api.signup('re');
    boss = await api.member(t, 'boss', scoped('all'));
    from = await api.member(t, 'from', scoped('all'));
    to = await api.member(t, 'to', scoped('all'));
    limited = await api.member(t, 'lim', scoped('own'));
    [fromU, toU, limitedU] = await Promise.all([
      uuidOf(from.userId),
      uuidOf(to.userId),
      uuidOf(limited.userId),
    ]);
  });

  const countOwned = async (userId: number | null) =>
    Number(
      (
        await h.owner.query(
          `SELECT count(*)::int AS n FROM contacts WHERE org_id = $1 AND owner_id ${
            userId === null ? 'IS NULL' : `= ${userId}`
          }`,
          [t.orgId],
        )
      ).rows[0].n,
    );

  it('"select all N" of one owner, then Update > Owner: every contact of that person moves, others stay', async () => {
    await api.seedContacts(
      t,
      Array.from({ length: 30 }, (_, i) => ({
        name: `Book ${i}`,
        phone: phone(100 + i),
        ownerId: from.userId,
      })),
    );
    await api.seedContacts(t, [{ name: 'Elsewhere', phone: phone(200), ownerId: to.userId }]);
    // what the screen shows for the filter is what the bulk request acts on
    const shown = await api
      .as(boss.token)
      .get(`/v2/contacts?ownerIds=${fromU}&includeTotal=true&limit=5`);
    expect(shown.body.meta.total).toBe(30);

    const res = await api
      .as(boss.token)
      .post('/v2/contacts/bulk/owner')
      .send({ filter: { ownerIds: [fromU] }, ownerId: toU });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ matched: 30, changed: 30, failedCount: 0, succeeded: [] });
    expect(await countOwned(from.userId)).toBe(0);
    expect(await countOwned(to.userId)).toBe(31);

    // nothing left to move: matched, none changed (idempotent)
    const again = await api
      .as(boss.token)
      .post('/v2/contacts/bulk/owner')
      .send({ filter: { ownerIds: [fromU] }, ownerId: toU });
    expect(again.body).toMatchObject({ matched: 0, changed: 0 });
  });

  it('leaves the same trail a single edit does: one audit row and one contact.updated per contact moved', async () => {
    const before = (await api.events(t.orgId, 'contact.updated')).length;
    const ids = await api.seedContacts(t, [
      { name: 'Trail 1', phone: phone(210), ownerId: from.userId },
      { name: 'Trail 2', phone: phone(211), ownerId: from.userId },
    ]);
    const auditBefore = await api.auditCount(t.orgId, 'contacts', 'update');
    const res = await api
      .as(boss.token)
      .post('/v2/contacts/bulk/owner')
      .send({ ids, ownerId: toU });
    expect(res.body).toMatchObject({ matched: 2, changed: 2, failedCount: 0 });
    expect(res.body.succeeded.sort()).toEqual([...ids].sort());
    expect(await api.auditCount(t.orgId, 'contacts', 'update')).toBe(auditBefore + 2);
    const events = await api.events(t.orgId, 'contact.updated');
    expect(events.length).toBe(before + 2);
    expect(events.slice(-2)).toEqual(
      expect.arrayContaining([expect.objectContaining({ ownerId: toU, previousOwnerId: fromU })]),
    );
    const delta = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'contacts' AND action = 'update' ORDER BY id DESC LIMIT 1`,
      [t.orgId],
    );
    expect(delta.rows[0].delta).toEqual({ ownerId: { old: fromU, new: toU } });
  });

  it('can unassign a whole filter', async () => {
    const res = await api
      .as(boss.token)
      .post('/v2/contacts/bulk/owner')
      .send({ filter: { q: 'Trail' }, ownerId: null });
    expect(res.body).toMatchObject({ matched: 2, changed: 2 });
    expect(await countOwned(null)).toBeGreaterThanOrEqual(2);
  });

  it('refuses a person who is not an active member of this workspace, and one of another (tenant isolation)', async () => {
    const stranger = await api.signup('re-other');
    const strangerUuid = await uuidOf(stranger.adminUserId);
    await h.owner.query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [to.userId]);
    for (const ownerId of [strangerUuid, toU, randomUUID()]) {
      const res = await api
        .as(boss.token)
        .post('/v2/contacts/bulk/owner')
        .send({ filter: { q: 'Elsewhere' }, ownerId });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    }
    await h.owner.query(`UPDATE users SET status = 'active' WHERE id = $1`, [to.userId]);
  });

  it('an own-scope member moves only their own contacts, only to themselves, and never to nobody', async () => {
    await api.seedContacts(t, [
      { name: 'Lim mine', phone: phone(220), ownerId: limited.userId },
      { name: 'Lim theirs', phone: phone(221), ownerId: to.userId },
    ]);
    // handing contacts to a colleague, or to nobody, is outside an own scope
    for (const ownerId of [toU, null]) {
      const res = await api
        .as(limited.token)
        .post('/v2/contacts/bulk/owner')
        .send({ filter: { q: 'Lim ' }, ownerId });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    }
    // taking everything that matches for themselves: only what they already see is touched
    const res = await api
      .as(limited.token)
      .post('/v2/contacts/bulk/owner')
      .send({ filter: { q: 'Lim ' }, ownerId: limitedU });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ matched: 1, changed: 0 });
    const theirs = await h.owner.query(
      `SELECT owner_id FROM contacts WHERE org_id = $1 AND name = 'Lim theirs'`,
      [t.orgId],
    );
    expect(Number(theirs.rows[0].owner_id)).toBe(to.userId);
  });

  it('needs the update permission', async () => {
    const reader = await api.member(t, 'reader', [['record.contacts.read']]);
    const res = await api
      .as(reader.token)
      .post('/v2/contacts/bulk/owner')
      .send({ filter: { q: 'Elsewhere' }, ownerId: null });
    expect(res.status).toBe(403);
  });

  it('an unusable selection is a validation error, not a silent no-op', async () => {
    const neither = await api.as(boss.token).post('/v2/contacts/bulk/owner').send({ ownerId: toU });
    expect(neither.status).toBe(422);
    const missing = await api
      .as(boss.token)
      .post('/v2/contacts/bulk/owner')
      .send({ filter: { q: 'x' } });
    expect(missing.status).toBe(422);
  });
});

describe('exports carry the owner', () => {
  it('adds an owner_email column, empty for an unassigned contact', async () => {
    const t = await api.signup('exp');
    const m = await api.member(t, 'exo', scoped('all'));
    const email = (await h.owner.query(`SELECT email FROM users WHERE id = $1`, [m.userId])).rows[0]
      .email as string;
    await api.seedContacts(t, [
      { name: 'Exp Owned', phone: phone(300), ownerId: m.userId },
      { name: 'Exp Free', phone: phone(301), ownerId: null },
    ]);
    const res = await api
      .as(t.admin)
      .post('/v2/contacts/export')
      .send({ filter: { q: 'Exp ' }, bom: false })
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.setEncoding('utf8');
        r.on('data', (c: string) => (data += c));
        r.on('end', () => cb(null, data));
      });
    const lines = (res.body as string).trim().split(/\r?\n/);
    const header = lines[0]!.split(',');
    const col = header.indexOf('owner_email');
    expect(col).toBeGreaterThan(-1);
    const owned = lines.find((l) => l.startsWith('Exp Owned'))!;
    const free = lines.find((l) => l.startsWith('Exp Free'))!;
    expect(owned).toContain(email);
    expect(free.endsWith(',') || !free.includes('@example.test')).toBe(true);
  });
});
