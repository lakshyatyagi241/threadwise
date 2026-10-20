import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { isTeamPeer } from '../../../kernel/rbac/scope';

type Raw = Record<string, unknown>;

export interface LeaveMember {
  id: number;
  uuid: string;
  fullName: string;
  status: string;
}

export interface LeaveRow {
  id: number;
  uuid: string;
  userId: number;
  userUuid: string;
  userName: string;
  startsOn: string;
  endsOn: string | null;
  reason: string | null;
  status: string;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  rowVersion: number;
}

export interface DelegateRow {
  userId: number;
  delegateId: number;
  delegateUuid: string;
  delegateName: string;
  delegateStatus: string;
}

const day = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
const date = (v: unknown): Date | null => (v == null ? null : new Date(v as string | Date));

const toRow = (r: Raw): LeaveRow => ({
  id: Number(r.id),
  uuid: String(r.uuid),
  userId: Number(r.user_id),
  userUuid: String(r.user_uuid),
  userName: String(r.user_name ?? ''),
  startsOn: day(r.starts_on)!,
  endsOn: day(r.ends_on),
  reason: (r.reason as string | null) ?? null,
  status: String(r.status),
  startedAt: date(r.started_at),
  endedAt: date(r.ended_at),
  createdAt: new Date(r.created_at as string | Date),
  rowVersion: Number(r.row_version),
});

const toMember = (r: Raw): LeaveMember => ({
  id: Number(r.id),
  uuid: String(r.uuid),
  fullName: String(r.full_name),
  status: String(r.status),
});

const SELECT = sql`
  SELECT l.id, l.uuid, l.user_id, u.uuid AS user_uuid, u.full_name AS user_name,
         l.starts_on::text AS starts_on, l.ends_on::text AS ends_on, l.reason, l.status, l.started_at, l.ended_at, l.created_at,
         l.row_version
  FROM member_leaves l JOIN users u ON u.org_id = l.org_id AND u.id = l.user_id`;

/** Data access for member leave and delegates. Every method runs inside the tenant transaction it is handed. */
@Injectable()
export class LeaveRepository {
  async member(tx: Tx, orgId: number, uuid: string): Promise<LeaveMember | null> {
    const res = await tx.execute(
      sql`SELECT id, uuid, full_name, status FROM users WHERE org_id = ${orgId} AND uuid = ${uuid}`,
    );
    return res.rows[0] ? toMember(res.rows[0] as Raw) : null;
  }

  async memberById(tx: Tx, orgId: number, id: number): Promise<LeaveMember | null> {
    const res = await tx.execute(
      sql`SELECT id, uuid, full_name, status FROM users WHERE org_id = ${orgId} AND id = ${id}`,
    );
    return res.rows[0] ? toMember(res.rows[0] as Raw) : null;
  }

  /** Whether `a` and `b` share at least one team (the `team` record scope of `team.leave.manage`). */
  async shareTeam(tx: Tx, orgId: number, a: number, b: number): Promise<boolean> {
    return isTeamPeer(tx, orgId, a, b);
  }

  async byUuid(tx: Tx, orgId: number, uuid: string, lock = false): Promise<LeaveRow | null> {
    const res = await tx.execute(
      lock
        ? sql`${SELECT} WHERE l.org_id = ${orgId} AND l.uuid = ${uuid} FOR UPDATE OF l`
        : sql`${SELECT} WHERE l.org_id = ${orgId} AND l.uuid = ${uuid}`,
    );
    return res.rows[0] ? toRow(res.rows[0] as Raw) : null;
  }

  async byId(tx: Tx, orgId: number, id: number): Promise<LeaveRow | null> {
    const res = await tx.execute(sql`${SELECT} WHERE l.org_id = ${orgId} AND l.id = ${id}`);
    return res.rows[0] ? toRow(res.rows[0] as Raw) : null;
  }

  async list(
    tx: Tx,
    orgId: number,
    filter: { view: 'open' | 'all'; memberId?: number; limit: number },
  ): Promise<LeaveRow[]> {
    const where = [sql`l.org_id = ${orgId}`];
    if (filter.view === 'open') where.push(sql`l.status IN ('scheduled', 'active')`);
    if (filter.memberId !== undefined) where.push(sql`l.user_id = ${filter.memberId}`);
    const res = await tx.execute(
      sql`${SELECT} WHERE ${sql.join(where, sql` AND `)} ORDER BY l.starts_on, l.id LIMIT ${filter.limit}`,
    );
    return (res.rows as Raw[]).map(toRow);
  }

  /** A leave of this person that still counts and shares a day with the range (an open end is infinity). */
  async overlapping(
    tx: Tx,
    orgId: number,
    userId: number,
    startsOn: string,
    endsOn: string | null,
    exceptId?: number,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM member_leaves
      WHERE org_id = ${orgId} AND user_id = ${userId} AND status IN ('scheduled', 'active')
        AND daterange(starts_on, ends_on, '[]') && daterange(${startsOn}::date, ${endsOn}::date, '[]')
        ${exceptId === undefined ? sql`` : sql`AND id <> ${exceptId}`}
      LIMIT 1`);
    return res.rows.length > 0;
  }

  async insert(
    tx: Tx,
    orgId: number,
    v: {
      userId: number;
      startsOn: string;
      endsOn: string | null;
      reason: string | null;
      status: 'scheduled' | 'active';
      createdBy: number | null;
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO member_leaves (org_id, user_id, starts_on, ends_on, reason, status, started_at, created_by)
      VALUES (${orgId}, ${v.userId}, ${v.startsOn}::date, ${v.endsOn}::date, ${v.reason}, ${v.status},
              ${v.status === 'active' ? sql`now()` : sql`NULL`}, ${v.createdBy})
      RETURNING id`);
    return Number((res.rows[0] as Raw).id);
  }

  /** Optimistic update; false when the version moved. `startedNow` stamps `started_at` when the change makes the leave active. */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    rowVersion: number,
    v: {
      startsOn: string;
      endsOn: string | null;
      reason: string | null;
      status: string;
      startedNow: boolean;
    },
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE member_leaves SET starts_on = ${v.startsOn}::date, ends_on = ${v.endsOn}::date, reason = ${v.reason},
             status = ${v.status}, started_at = ${v.startedNow ? sql`now()` : sql`started_at`}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${rowVersion}
      RETURNING id`);
    return res.rows.length > 0;
  }

  /** The leave is over (ended early) or withdrawn before it began (cancelled). */
  async finish(
    tx: Tx,
    orgId: number,
    id: number,
    status: 'ended' | 'cancelled',
    endsOn: string | null,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE member_leaves SET status = ${status}, ended_at = now(),
             ends_on = COALESCE(${endsOn}::date, ends_on)
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  // --- delegate ----------------------------------------------------------------------------------------------------------------

  async delegateOf(tx: Tx, orgId: number, userId: number): Promise<DelegateRow | null> {
    const res = await tx.execute(sql`
      SELECT d.user_id, d.delegate_user_id, du.uuid AS delegate_uuid, du.full_name AS delegate_name, du.status AS delegate_status
      FROM member_delegates d JOIN users du ON du.org_id = d.org_id AND du.id = d.delegate_user_id
      WHERE d.org_id = ${orgId} AND d.user_id = ${userId}`);
    const r = res.rows[0] as Raw | undefined;
    return r
      ? {
          userId: Number(r.user_id),
          delegateId: Number(r.delegate_user_id),
          delegateUuid: String(r.delegate_uuid),
          delegateName: String(r.delegate_name),
          delegateStatus: String(r.delegate_status),
        }
      : null;
  }

  /** Walk the delegate chain from `start` (start's delegate, that person's delegate, ...) and say whether it reaches `target`. */
  async chainReaches(tx: Tx, orgId: number, start: number, target: number): Promise<boolean> {
    const res = await tx.execute(sql`
      WITH RECURSIVE chain(user_id, depth) AS (
        SELECT delegate_user_id, 1 FROM member_delegates WHERE org_id = ${orgId} AND user_id = ${start}
        UNION ALL
        SELECT d.delegate_user_id, c.depth + 1 FROM chain c
        JOIN member_delegates d ON d.org_id = ${orgId} AND d.user_id = c.user_id
        WHERE c.depth < 50
      )
      SELECT 1 FROM chain WHERE user_id = ${target} LIMIT 1`);
    return res.rows.length > 0;
  }

  async setDelegate(
    tx: Tx,
    orgId: number,
    userId: number,
    delegateId: number,
    by: number | null,
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO member_delegates (org_id, user_id, delegate_user_id, created_by)
      VALUES (${orgId}, ${userId}, ${delegateId}, ${by})
      ON CONFLICT (org_id, user_id) DO UPDATE SET delegate_user_id = EXCLUDED.delegate_user_id`);
  }

  async clearDelegate(tx: Tx, orgId: number, userId: number): Promise<void> {
    await tx.execute(
      sql`DELETE FROM member_delegates WHERE org_id = ${orgId} AND user_id = ${userId}`,
    );
  }

  // --- numbers for the screens and the notice ---------------------------------------------------------------------------------

  async workload(
    tx: Tx,
    orgId: number,
    userId: number,
  ): Promise<{ ownedContacts: number; openConversations: number }> {
    const res = await tx.execute(sql`
      SELECT (SELECT count(*)::int FROM contacts WHERE org_id = ${orgId} AND owner_id = ${userId}) AS contacts,
             (SELECT count(*)::int FROM conversations WHERE org_id = ${orgId} AND assignee_user_id = ${userId}
                AND archived = FALSE AND status = 'open') AS conversations`);
    const r = res.rows[0] as Raw;
    return { ownedContacts: Number(r.contacts), openConversations: Number(r.conversations) };
  }

  async audit(
    tx: Tx,
    e: {
      orgId: number;
      actorId: number | null;
      actorType: string;
      recordId: number;
      action: string;
      delta?: Record<string, unknown>;
      requestId?: string | null;
    },
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id)
      VALUES (${e.orgId}, ${e.actorId}, ${e.actorType}, 'members', ${e.recordId}, ${e.action},
              ${e.delta ? JSON.stringify(e.delta) : null}::jsonb, ${e.requestId ?? null})`);
  }
}
