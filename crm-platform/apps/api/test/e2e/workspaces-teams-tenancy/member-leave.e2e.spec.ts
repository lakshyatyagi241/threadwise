import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '../../../src/common/workspace-calendar';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { OutboxService } from '../../../src/kernel/outbox/outbox.service';
import { OutboxSubscriberRegistry } from '../../../src/kernel/outbox/outbox-subscribers';
import { MemberDirectory } from '../../../src/realtime';
import { NotificationFanout, NotificationsRepository } from '../../../src/modules/notifications';
import { NotificationPrefsResolver } from '../../../src/modules/notifications/notification-prefs.resolver';
import { MemberLeaveNotificationConsumer } from '../../../src/modules/notifications/member-leave-notification.consumer';
import { LeaveSweepService } from '../../../src/modules/workspaces-teams-tenancy/leave/leave-sweep.service';
import {
  Api,
  startHarness,
  type Grant,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * Member leave and delegate (BL-112), phase 1: the API with its permissions (own scope for everyone, all for managers), the validation
 * (past start, overlap, dates), the status flips by the worker sweep in the WORKSPACE's own calendar, the delegate rules (self, inactive,
 * cycles), the audit and outbox rows, the notice to the leads and tenant isolation. Real Postgres (restricted role), real Redis.
 */
let h: Harness;
let api: Api;
beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 300_000);
afterAll(async () => {
  await h?.stop();
});

const get = <T>(cls: new (...a: never[]) => T): T => h.app.get(cls as never, { strict: false });
const sweeper = () => new LeaveSweepService(get(DatabaseService), get(OutboxService));

const SELF: Grant[] = [
  ['team.leave.read', 'all'],
  ['team.leave.manage', 'own'],
];
const MANAGER: Grant[] = [
  ['team.leave.read', 'all'],
  ['team.leave.manage', 'all'],
];

interface Person {
  token: string;
  userId: number;
  uuid: string;
}
const uuidOf = async (userId: number) =>
  (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [userId])).rows[0].uuid as string;
const person = async (t: Tenant, name: string, grants: Grant[]): Promise<Person> => {
  const m = await api.member(t, name, grants);
  return { ...m, uuid: await uuidOf(m.userId) };
};

const call = (token: string) => ({
  list: (qs = '') =>
    api.http().get(`/v2/workspace/leaves${qs}`).set('authorization', `Bearer ${token}`),
  overview: (member: string) =>
    api.http().get(`/v2/workspace/members/${member}/leave`).set('authorization', `Bearer ${token}`),
  create: (member: string, body: Record<string, unknown>) =>
    api
      .http()
      .post(`/v2/workspace/members/${member}/leaves`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', randomUUID())
      .send(body),
  update: (id: string, body: Record<string, unknown>) =>
    api
      .http()
      .patch(`/v2/workspace/leaves/${id}`)
      .set('authorization', `Bearer ${token}`)
      .send(body),
  end: (id: string) =>
    api.http().delete(`/v2/workspace/leaves/${id}`).set('authorization', `Bearer ${token}`),
  delegate: (member: string, delegateId: string | null) =>
    api
      .http()
      .put(`/v2/workspace/members/${member}/delegate`)
      .set('authorization', `Bearer ${token}`)
      .send({ delegateId }),
});

/** Today in the workspace's calendar, as the API reports it. */
const todayOf = async (t: Tenant): Promise<string> =>
  (await call(t.admin).list()).body.today as string;

const events = async (t: Tenant, type: string) =>
  (
    await h.owner.query(
      `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = $2 ORDER BY id`,
      [t.orgId, type],
    )
  ).rows.map((r) => r.payload as Record<string, unknown>);

const auditActions = async (t: Tenant, userId: number) =>
  (
    await h.owner.query(
      `SELECT action FROM audit_log WHERE org_id = $1 AND module = 'members' AND record_id = $2 ORDER BY id`,
      [t.orgId, userId],
    )
  ).rows.map((r) => r.action as string);

describe('the leave API', () => {
  let t: Tenant;
  let other: Tenant;
  let today: string;
  let ag1: Person;
  let ag2: Person;
  let mgr: Person;
  let reader: Person;
  let nobody: Person;

  beforeAll(async () => {
    t = await api.signup('lv');
    other = await api.signup('lvo');
    ag1 = await person(t, 'lvag1', SELF);
    ag2 = await person(t, 'lvag2', SELF);
    mgr = await person(t, 'lvmgr', MANAGER);
    reader = await person(t, 'lvreader', [['team.leave.read', 'all']]);
    nobody = await person(t, 'lvnobody', [['record.contacts.read', 'all']]);
    today = await todayOf(t);
  });

  it("permissions: everyone with the manage key sets their own leave; only the all scope sets another person's; reading needs its own key", async () => {
    const own = await call(ag1.token).create(ag1.uuid, {
      startsOn: addDays(today, 30),
      endsOn: addDays(today, 32),
    });
    expect(own.status, JSON.stringify(own.body)).toBe(201);

    const forOther = await call(ag1.token).create(ag2.uuid, { startsOn: addDays(today, 30) });
    expect(forOther.status).toBe(403);

    const byManager = await call(mgr.token).create(ag2.uuid, {
      startsOn: addDays(today, 30),
      endsOn: addDays(today, 31),
    });
    expect(byManager.status, JSON.stringify(byManager.body)).toBe(201);

    // a reader sees but cannot write; a person with neither key sees nothing
    expect((await call(reader.token).list()).status).toBe(200);
    expect(
      (await call(reader.token).create(reader.uuid, { startsOn: addDays(today, 60) })).status,
    ).toBe(403);
    expect((await call(nobody.token).list()).status).toBe(403);
    expect(
      (await call(nobody.token).create(nobody.uuid, { startsOn: addDays(today, 60) })).status,
    ).toBe(403);

    // a manager can also end someone else's leave, an agent cannot
    const leave = byManager.body as { id: string };
    expect((await call(ag1.token).end(leave.id)).status).toBe(403);
    expect((await call(mgr.token).end(leave.id)).status).toBe(200);
    // clean up the first one so later tests start from an empty calendar
    expect((await call(ag1.token).end((own.body as { id: string }).id)).status).toBe(200);
  });

  it('the account menu flow works for a role WITHOUT team.read (a Viewer-like role): own id, delegate picker, set leave, see it, end it', async () => {
    const viewerLike = await person(t, 'lvviewer', SELF); // holds only the two leave keys, no team.read
    const auth = { authorization: `Bearer ${viewerLike.token}` };
    // the member id the menu needs, and the people the delegate picker offers: no permission key on either
    const summary = await api.http().get('/v2/workspace/members/summary').set(auth);
    expect(summary.status, JSON.stringify(summary.body)).toBe(200);
    expect(summary.body.me.id).toBe(viewerLike.uuid);
    const members = await api.http().get('/v2/workspace/members?limit=50').set(auth);
    expect(members.status).toBe(200);
    expect((members.body.data as Array<{ id: string }>).some((m) => m.id === ag2.uuid)).toBe(true);

    const set = await call(viewerLike.token).create(viewerLike.uuid, {
      startsOn: today,
      endsOn: addDays(today, 3),
    });
    expect(set.status, JSON.stringify(set.body)).toBe(201);
    const del = await call(viewerLike.token).delegate(viewerLike.uuid, ag2.uuid);
    expect(del.status, JSON.stringify(del.body)).toBe(200);

    const panel = await call(viewerLike.token).overview(viewerLike.uuid);
    expect(panel.status).toBe(200);
    expect(panel.body.current).toMatchObject({ onLeaveNow: true, endsOn: addDays(today, 3) });
    expect(panel.body.can.manage).toBe(true);
    expect(panel.body.delegate).toMatchObject({ id: ag2.uuid });

    // "End leave now" and removing the delegate also work for yourself; someone else's panel stays read-only
    expect((await call(viewerLike.token).end((set.body as { id: string }).id)).status).toBe(200);
    expect((await call(viewerLike.token).delegate(viewerLike.uuid, null)).status).toBe(200);
    const others = await call(viewerLike.token).overview(ag2.uuid);
    expect(others.status).toBe(200);
    expect(others.body.can.manage).toBe(false);
  });

  it('the reason is for the person and their managers, never for colleagues', async () => {
    const made = await call(ag1.token).create(ag1.uuid, {
      startsOn: addDays(today, 40),
      endsOn: addDays(today, 45),
      reason: 'Surgery, please keep private',
    });
    expect(made.status).toBe(201);
    const id = made.body.id as string;
    const seenBy = async (token: string) =>
      ((await call(token).list()).body.data as Array<{ id: string; reason: string | null }>).find(
        (l) => l.id === id,
      )!.reason;
    expect(await seenBy(ag1.token)).toBe('Surgery, please keep private');
    expect(await seenBy(mgr.token)).toBe('Surgery, please keep private');
    expect(await seenBy(t.admin)).toBe('Surgery, please keep private');
    expect(await seenBy(ag2.token)).toBeNull();
    expect(await seenBy(reader.token)).toBeNull();
    // the panel: workload only for those who may manage
    expect((await call(ag2.token).overview(ag1.uuid)).body.workload).toBeNull();
    expect((await call(mgr.token).overview(ag1.uuid)).body.workload).toMatchObject({
      ownedContacts: 0,
      openConversations: 0,
    });
    expect((await call(ag1.token).end(id)).status).toBe(200);
  });

  it('validation: a first day in the past, a last day before the first, a day that does not exist, a member who is not active', async () => {
    const past = await call(ag1.token).create(ag1.uuid, { startsOn: addDays(today, -1) });
    expect(past.status).toBe(422);
    expect(past.body.code).toBe('WSP_LEAVE_INVALID');
    const backwards = await call(ag1.token).create(ag1.uuid, {
      startsOn: addDays(today, 5),
      endsOn: addDays(today, 4),
    });
    expect(backwards.status).toBe(422);
    const nonsense = await call(ag1.token).create(ag1.uuid, { startsOn: '2026-02-31' });
    expect(nonsense.status).toBe(422);
    // a suspended member
    const away = await person(t, 'lvsusp', SELF);
    await h.owner.query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [away.userId]);
    const susp = await call(mgr.token).create(away.uuid, { startsOn: addDays(today, 5) });
    expect(susp.status).toBe(422);
    // an unknown member
    expect(
      (await call(mgr.token).create(randomUUID(), { startsOn: addDays(today, 5) })).status,
    ).toBe(404);
  });

  it('overlap: a second leave sharing a day is refused, a neighbouring day is fine, an ended leave frees its days', async () => {
    const a = await call(ag2.token).create(ag2.uuid, {
      startsOn: addDays(today, 100),
      endsOn: addDays(today, 110),
    });
    expect(a.status).toBe(201);
    const clash = await call(ag2.token).create(ag2.uuid, {
      startsOn: addDays(today, 110),
      endsOn: addDays(today, 115),
    });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('WSP_LEAVE_OVERLAP');
    const open = await call(ag2.token).create(ag2.uuid, { startsOn: addDays(today, 105) });
    expect(open.status).toBe(409); // an open-ended leave reaches into the first one
    const next = await call(ag2.token).create(ag2.uuid, {
      startsOn: addDays(today, 111),
      endsOn: addDays(today, 112),
    });
    expect(next.status).toBe(201);
    // moving a leave onto another's days is refused as well
    const move = await call(ag2.token).update(next.body.id, {
      rowVersion: next.body.rowVersion,
      startsOn: addDays(today, 109),
    });
    expect(move.status).toBe(409);
    // ending the first frees its days
    expect((await call(ag2.token).end(a.body.id)).status).toBe(200);
    const again = await call(ag2.token).create(ag2.uuid, {
      startsOn: addDays(today, 100),
      endsOn: addDays(today, 110),
    });
    expect(again.status).toBe(201);
    // the database rule holds without the service: the exclusion constraint refuses an overlapping row
    await expect(
      h.owner.query(
        `INSERT INTO member_leaves (org_id, user_id, starts_on, ends_on) VALUES ($1, $2, $3, $4)`,
        [t.orgId, ag2.userId, addDays(today, 105), addDays(today, 106)],
      ),
    ).rejects.toMatchObject({ code: '23P01' });
    for (const id of [next.body.id, again.body.id]) await call(ag2.token).end(id);
  });

  it('a leave that begins today is active at once and announced (with what the person holds); a future one waits for the sweep', async () => {
    const holder = await person(t, 'lvholder', SELF);
    await h.owner.query(
      `INSERT INTO contacts (org_id, name, owner_id) SELECT $1, 'c' || g, $2 FROM generate_series(1, 3) g`,
      [t.orgId, holder.userId],
    );
    const before = (await events(t, 'member.leave.started')).length;

    const future = await call(holder.token).create(holder.uuid, {
      startsOn: addDays(today, 7),
      endsOn: addDays(today, 9),
    });
    expect(future.status).toBe(201);
    expect(future.body).toMatchObject({ status: 'scheduled', onLeaveNow: false });
    expect((await events(t, 'member.leave.started')).length).toBe(before);

    const now = await call(holder.token).create(holder.uuid, {
      startsOn: today,
      endsOn: addDays(today, 3),
    });
    // today..+3 does not share a day with +7..+9
    expect(now.status, JSON.stringify(now.body)).toBe(201);
    expect(now.body).toMatchObject({ status: 'active', onLeaveNow: true });
    const started = await events(t, 'member.leave.started');
    expect(started.length).toBe(before + 1);
    expect(started.at(-1)).toMatchObject({
      memberId: holder.uuid,
      startsOn: today,
      endsOn: addDays(today, 3),
      ownedContacts: 3,
      openConversations: 0,
    });
    expect(await auditActions(t, holder.userId)).toEqual(
      expect.arrayContaining(['member.leave.created', 'member.leave.started']),
    );

    // the member panel
    const panel = (await call(holder.token).overview(holder.uuid)).body;
    expect(panel.current).toMatchObject({ id: now.body.id, onLeaveNow: true });
    expect(panel.upcoming.map((l: { id: string }) => l.id)).toEqual([future.body.id]);
    expect(panel.workload).toMatchObject({ ownedContacts: 3 });

    // changing it: a stale version is 409; an active leave keeps its first day; its end moves; a scheduled one moved to today begins
    expect(
      (await call(holder.token).update(now.body.id, { rowVersion: 99, endsOn: addDays(today, 2) }))
        .status,
    ).toBe(409);
    const keep = await call(holder.token).update(now.body.id, {
      rowVersion: now.body.rowVersion,
      startsOn: addDays(today, 1),
    });
    expect(keep.status).toBe(422);
    const shorter = await call(holder.token).update(now.body.id, {
      rowVersion: now.body.rowVersion,
      endsOn: addDays(today, 2),
    });
    expect(shorter.status, JSON.stringify(shorter.body)).toBe(200);
    expect(shorter.body.endsOn).toBe(addDays(today, 2));
    expect(
      (
        await call(holder.token).update(now.body.id, {
          rowVersion: shorter.body.rowVersion,
          endsOn: addDays(today, -1),
        })
      ).status,
    ).toBe(422);
    expect((await events(t, 'member.leave.started')).length).toBe(before + 1);

    // ending the active one: the person is back today (last day away = yesterday, but never before the first day), event says early
    const ended = await call(holder.token).end(now.body.id);
    expect(ended.status).toBe(200);
    expect(ended.body.status).toBe('ended');
    expect(ended.body.endsOn).toBe(today); // started today: the single day stays on record
    expect(ended.body.onLeaveNow).toBe(false);
    expect((await events(t, 'member.leave.ended')).at(-1)).toMatchObject({
      memberId: holder.uuid,
      early: true,
    });
    expect((await call(holder.token).end(now.body.id)).status).toBe(422); // already over

    // cancelling the future one raises no event
    const endedCount = (await events(t, 'member.leave.ended')).length;
    const cancelled = await call(holder.token).end(future.body.id);
    expect(cancelled.body.status).toBe('cancelled');
    expect((await events(t, 'member.leave.ended')).length).toBe(endedCount);
    // and an ended or cancelled leave cannot be changed
    expect(
      (
        await call(holder.token).update(future.body.id, {
          rowVersion: cancelled.body.rowVersion,
          endsOn: addDays(today, 20),
        })
      ).status,
    ).toBe(422);
  });

  it('a scheduled leave moved to start today begins at once and is announced', async () => {
    const mover = await person(t, 'lvmover', SELF);
    const sched = await call(mover.token).create(mover.uuid, {
      startsOn: addDays(today, 12),
      endsOn: addDays(today, 14),
    });
    const before = (await events(t, 'member.leave.started')).length;
    const moved = await call(mover.token).update(sched.body.id, {
      rowVersion: sched.body.rowVersion,
      startsOn: today,
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body).toMatchObject({ status: 'active', onLeaveNow: true });
    expect((await events(t, 'member.leave.started')).length).toBe(before + 1);
    await call(mover.token).end(sched.body.id);
  });

  it("tenants never see or touch each other's leave", async () => {
    const mine = await call(ag1.token).create(ag1.uuid, {
      startsOn: addDays(today, 200),
      endsOn: addDays(today, 201),
    });
    expect(mine.status).toBe(201);
    const foreign = await call(other.admin).list('?view=all');
    expect((foreign.body.data as Array<{ id: string }>).some((l) => l.id === mine.body.id)).toBe(
      false,
    );
    expect((await call(other.admin).end(mine.body.id)).status).toBe(404);
    expect(
      (await call(other.admin).update(mine.body.id, { rowVersion: 1, endsOn: addDays(today, 205) }))
        .status,
    ).toBe(404);
    expect((await call(other.admin).create(ag1.uuid, { startsOn: addDays(today, 5) })).status).toBe(
      404,
    );
    expect((await call(other.admin).overview(ag1.uuid)).status).toBe(404);
    expect((await call(other.admin).delegate(ag1.uuid, null)).status).toBe(404);
    await call(ag1.token).end(mine.body.id);
  });
});

describe('the sweep: the workspace calendar decides the day', () => {
  /** A workspace in a time zone, with one member; the owner connection arranges the rows. */
  async function workspace(label: string, timezone: string) {
    const t = await api.signup(label);
    await h.owner.query(
      `UPDATE organizations SET settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('timezone', $2::text) WHERE id = $1`,
      [t.orgId, timezone],
    );
    const member = await person(t, `${label}m`, SELF);
    const localToday = (
      await h.owner.query(`SELECT (now() AT TIME ZONE $1)::date::text AS d`, [
        timezone === 'Not/AZone' ? 'UTC' : timezone, // Postgres itself refuses it: that is what the sweep must survive
      ])
    ).rows[0].d as string;
    return { t, member, localToday };
  }
  const row = async (id: number) =>
    (
      await h.owner.query(`SELECT status, started_at, ended_at FROM member_leaves WHERE id = $1`, [
        id,
      ])
    ).rows[0];
  const seed = async (
    orgId: number,
    userId: number,
    startsOn: string,
    endsOn: string | null,
    status: string,
  ) =>
    Number(
      (
        await h.owner.query(
          `INSERT INTO member_leaves (org_id, user_id, starts_on, ends_on, status) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [orgId, userId, startsOn, endsOn, status],
        )
      ).rows[0].id,
    );

  it('the same calendar date arrives first in the zone that is ahead: a leave starting on the date UTC+14 shows is started there and still waiting at UTC-11', async () => {
    const east = await workspace('swe', 'Pacific/Kiritimati');
    const west = await workspace('sww', 'Pacific/Pago_Pago');
    expect(east.localToday > west.localToday).toBe(true);
    const date = east.localToday;
    const eastLeave = await seed(
      east.t.orgId,
      east.member.userId,
      date,
      addDays(date, 2),
      'scheduled',
    );
    const westLeave = await seed(
      west.t.orgId,
      west.member.userId,
      date,
      addDays(date, 2),
      'scheduled',
    );

    const first = await sweeper().sweep();
    expect(first.started).toBeGreaterThanOrEqual(1);
    expect((await row(eastLeave)).status).toBe('active');
    expect((await row(eastLeave)).started_at).not.toBeNull();
    expect((await row(westLeave)).status).toBe('scheduled');

    expect((await events(east.t, 'member.leave.started')).map((e) => e.memberId)).toEqual([
      east.member.uuid,
    ]);
    expect(await events(west.t, 'member.leave.started')).toEqual([]);
    expect(await auditActions(east.t, east.member.userId)).toContain('member.leave.started');

    // announced once, however often the sweep runs
    await sweeper().sweep();
    expect((await events(east.t, 'member.leave.started')).length).toBe(1);
  });

  it('a leave ends the day after its last day (workspace calendar); an open-ended one never ends by itself', async () => {
    const w = await workspace('swend', 'Pacific/Kiritimati');
    const d = w.localToday;
    const lastDayToday = await seed(w.t.orgId, w.member.userId, addDays(d, -3), d, 'active');
    expect((await sweeper().sweep()).ended).toBe(0);
    expect((await row(lastDayToday)).status).toBe('active'); // today is its last day of leave

    await h.owner.query(`UPDATE member_leaves SET ends_on = $2 WHERE id = $1`, [
      lastDayToday,
      addDays(d, -1),
    ]);
    const swept = await sweeper().sweep();
    expect(swept.ended).toBeGreaterThanOrEqual(1);
    expect((await row(lastDayToday)).status).toBe('ended');
    expect((await row(lastDayToday)).ended_at).not.toBeNull();
    expect((await events(w.t, 'member.leave.ended')).at(-1)).toMatchObject({
      memberId: w.member.uuid,
      early: false,
      endsOn: addDays(d, -1),
    });

    const openEnded = await seed(w.t.orgId, w.member.userId, addDays(d, -30), null, 'active');
    await sweeper().sweep();
    expect((await row(openEnded)).status).toBe('active');
  });

  it('a window that passed entirely while the worker was down is started and ended in one pass, in that order', async () => {
    const w = await workspace('swgap', 'UTC');
    const d = w.localToday;
    const id = await seed(w.t.orgId, w.member.userId, addDays(d, -10), addDays(d, -8), 'scheduled');
    await sweeper().sweep();
    expect((await row(id)).status).toBe('ended');
    const types = (
      await h.owner.query(
        `SELECT event_type FROM event_outbox WHERE org_id = $1 AND event_type LIKE 'member.leave.%' ORDER BY id`,
        [w.t.orgId],
      )
    ).rows.map((r) => r.event_type);
    expect(types).toEqual(['member.leave.started', 'member.leave.ended']);
  });

  it('a bad time zone in the settings falls back to UTC instead of stopping the sweep for everyone', async () => {
    const w = await workspace('swbad', 'Not/AZone');
    const utcToday = (await h.owner.query(`SELECT (now() AT TIME ZONE 'UTC')::date::text AS d`))
      .rows[0].d as string;
    const id = await seed(w.t.orgId, w.member.userId, utcToday, addDays(utcToday, 1), 'scheduled');
    await sweeper().sweep();
    expect((await row(id)).status).toBe('active');
  });
});

describe('the delegate', () => {
  let t: Tenant;
  let other: Tenant;
  let a: Person;
  let b: Person;
  let c: Person;
  let mgr: Person;
  let foreign: Person;

  beforeAll(async () => {
    t = await api.signup('dg');
    other = await api.signup('dgo');
    a = await person(t, 'dga', SELF);
    b = await person(t, 'dgb', SELF);
    c = await person(t, 'dgc', SELF);
    mgr = await person(t, 'dgmgr', MANAGER);
    foreign = await person(other, 'dgf', SELF);
  });

  const delegateOf = async (userId: number) =>
    (
      await h.owner.query(
        `SELECT delegate_user_id FROM member_delegates WHERE org_id = $1 AND user_id = $2`,
        [t.orgId, userId],
      )
    ).rows[0]?.delegate_user_id;

  it('a person names a delegate for themselves; changing it and removing it are audited and announced', async () => {
    const set = await call(a.token).delegate(a.uuid, b.uuid);
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.delegate).toMatchObject({ id: b.uuid, onLeaveNow: false });
    expect(Number(await delegateOf(a.userId))).toBe(b.userId);

    const same = await call(a.token).delegate(a.uuid, b.uuid);
    expect(same.status).toBe(200);
    const n = (await events(t, 'member.delegate.changed')).length;
    expect(n).toBe(1); // setting the same delegate again says nothing

    const changed = await call(a.token).delegate(a.uuid, c.uuid);
    expect(changed.body.delegate.id).toBe(c.uuid);
    expect((await events(t, 'member.delegate.changed')).at(-1)).toMatchObject({
      memberId: a.uuid,
      delegateId: c.uuid,
      previousDelegateId: b.uuid,
    });

    const removed = await call(a.token).delegate(a.uuid, null);
    expect(removed.status).toBe(200);
    expect(removed.body.delegate).toBeNull();
    expect(await delegateOf(a.userId)).toBeUndefined();
    expect((await events(t, 'member.delegate.changed')).at(-1)).toMatchObject({
      delegateId: null,
      previousDelegateId: c.uuid,
    });
    // removing what is not there is quiet
    const count = (await events(t, 'member.delegate.changed')).length;
    expect((await call(a.token).delegate(a.uuid, null)).status).toBe(200);
    expect((await events(t, 'member.delegate.changed')).length).toBe(count);
    expect(await auditActions(t, a.userId)).toContain('member.delegate.changed');
  });

  it('only a manager names a delegate for somebody else', async () => {
    expect((await call(b.token).delegate(a.uuid, c.uuid)).status).toBe(403);
    expect((await call(mgr.token).delegate(a.uuid, c.uuid)).status).toBe(200);
    expect(Number(await delegateOf(a.userId))).toBe(c.userId);
    await call(mgr.token).delegate(a.uuid, null);
  });

  it('refuses yourself, a suspended member, a member of another workspace and an unknown person', async () => {
    const self = await call(a.token).delegate(a.uuid, a.uuid);
    expect(self.status).toBe(422);
    expect(self.body.code).toBe('WSP_DELEGATE_INVALID');
    const gone = await person(t, 'dggone', SELF);
    await h.owner.query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [gone.userId]);
    expect((await call(a.token).delegate(a.uuid, gone.uuid)).body.code).toBe(
      'WSP_DELEGATE_INVALID',
    );
    expect((await call(a.token).delegate(a.uuid, foreign.uuid)).body.code).toBe(
      'WSP_DELEGATE_INVALID',
    );
    expect((await call(a.token).delegate(a.uuid, randomUUID())).body.code).toBe(
      'WSP_DELEGATE_INVALID',
    );
    expect(await delegateOf(a.userId)).toBeUndefined();
  });

  it('refuses a circle: direct (A to B, B to A) and long (A to B to C, C to A)', async () => {
    expect((await call(a.token).delegate(a.uuid, b.uuid)).status).toBe(200);
    const direct = await call(b.token).delegate(b.uuid, a.uuid);
    expect(direct.status).toBe(422);
    expect(direct.body.code).toBe('WSP_DELEGATE_CYCLE');

    expect((await call(b.token).delegate(b.uuid, c.uuid)).status).toBe(200);
    const long = await call(c.token).delegate(c.uuid, a.uuid);
    expect(long.status).toBe(422);
    expect(long.body.code).toBe('WSP_DELEGATE_CYCLE');
    // a chain that does not close is fine
    expect((await call(c.token).delegate(c.uuid, mgr.uuid)).status).toBe(200);
    for (const p of [a, b, c]) await call(p.token).delegate(p.uuid, null);
  });

  it('the database refuses a self delegate and a delegate from another workspace even without the service', async () => {
    await expect(
      h.owner.query(
        `INSERT INTO member_delegates (org_id, user_id, delegate_user_id) VALUES ($1,$2,$2)`,
        [t.orgId, a.userId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      h.owner.query(
        `INSERT INTO member_delegates (org_id, user_id, delegate_user_id) VALUES ($1,$2,$3)`,
        [t.orgId, a.userId, foreign.userId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('the panel names the delegate and whether they are away themselves', async () => {
    await call(a.token).delegate(a.uuid, b.uuid);
    expect((await call(a.token).overview(a.uuid)).body.delegate).toEqual({
      id: b.uuid,
      name: 'dgb',
      onLeaveNow: false,
    });
    const today = await todayOf(t);
    await call(b.token).create(b.uuid, { startsOn: today, endsOn: addDays(today, 1) });
    expect((await call(a.token).overview(a.uuid)).body.delegate).toMatchObject({
      id: b.uuid,
      onLeaveNow: true,
    });
    // a delegate who leaves the workspace takes the arrangement with them
    await h.owner.query(`DELETE FROM users WHERE id = $1`, [b.userId]).catch(() => undefined);
  });
});

describe('who is told', () => {
  it('the leads hear of a leave with what the person holds; the person does not; a redelivery writes nothing twice', async () => {
    const t = await api.signup('nt');
    const lead = await person(t, 'ntlead', MANAGER);
    const away = await person(t, 'ntaway', MANAGER); // a manager going away is told to the OTHER leads only
    const plain = await person(t, 'ntplain', SELF);
    const today = await todayOf(t);
    await h.owner.query(
      `INSERT INTO contacts (org_id, name, owner_id) VALUES ($1, 'x', $2), ($1, 'y', $2)`,
      [t.orgId, away.userId],
    );
    const made = await call(away.token).create(away.uuid, {
      startsOn: today,
      endsOn: addDays(today, 4),
    });
    expect(made.status).toBe(201);
    const ev = (
      await h.owner.query(
        `SELECT id, org_id, aggregate_module, aggregate_id, event_type, payload FROM event_outbox
         WHERE org_id = $1 AND event_type = 'member.leave.started' ORDER BY id DESC LIMIT 1`,
        [t.orgId],
      )
    ).rows[0];
    const consumer = new MemberLeaveNotificationConsumer(
      get(DatabaseService),
      get(OutboxSubscriberRegistry),
      get(MemberDirectory),
      new NotificationFanout(
        new NotificationsRepository(),
        new NotificationPrefsResolver(get(DatabaseService)),
        new Proxy({}, { get: () => async () => undefined }) as never,
      ),
    );
    const event = {
      id: String(ev.id),
      orgId: t.orgId,
      aggregateModule: ev.aggregate_module,
      aggregateId: String(ev.aggregate_id),
      eventType: ev.event_type,
      payload: ev.payload,
    };
    await consumer.handle(event as never);
    await consumer.handle(event as never);

    const rows = (
      await h.owner.query(
        `SELECT user_id, title, body, link FROM inbox_notifications WHERE org_id = $1 AND type = 'member_leave_started' ORDER BY id`,
        [t.orgId],
      )
    ).rows;
    const told = rows.map((r) => Number(r.user_id));
    expect(told).toContain(lead.userId);
    expect(told).toContain(t.adminUserId);
    expect(told).not.toContain(away.userId);
    expect(told).not.toContain(plain.userId);
    expect(new Set(told).size).toBe(told.length); // once each
    const mine = rows.find((r) => Number(r.user_id) === lead.userId)!;
    expect(mine.title).toContain('ntaway is on leave until');
    expect(mine.body).toContain('2 contacts');
    expect(mine.link).toBe(`/team-members?member=${away.uuid}&reassign=1`);
  });
});
