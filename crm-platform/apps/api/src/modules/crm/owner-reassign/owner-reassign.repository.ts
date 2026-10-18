import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;

export interface BatchRow {
  id: number;
  uuid: string;
  orgId: number;
  fromUserId: number;
  fromUserUuid: string;
  fromUserName: string;
  fromUserStatus: string;
  toKind: 'user' | 'delegate' | 'team';
  toUserUuid: string | null;
  toUserName: string | null;
  toTeamUuid: string | null;
  toTeamName: string | null;
  includeDeals: boolean;
  reason: string | null;
  restoreOn: string | null;
  status: 'applied' | 'restored' | 'restore_blocked';
  movedContacts: number;
  movedDeals: number;
  restoredContacts: number;
  restoredDeals: number;
  notRestored: number;
  remaining: number;
  undoUntil: Date;
  restoredAt: Date | null;
  createdAt: Date;
}

/** Who is acting, for the audit rows and events the statements write. A system actor has no user. */
export interface Actor {
  actorId: number | null;
  actorType: string;
  requestId: string | null;
}

const metaJson = (a: Actor) =>
  JSON.stringify({ requestId: a.requestId, actorType: a.actorType, actorId: a.actorId });

const toBatch = (r: Raw): BatchRow => ({
  id: Number(r.id),
  uuid: String(r.uuid),
  orgId: Number(r.org_id),
  fromUserId: Number(r.from_user_id),
  fromUserUuid: String(r.from_uuid),
  fromUserName: String(r.from_name),
  fromUserStatus: String(r.from_status),
  toKind: r.to_kind as BatchRow['toKind'],
  toUserUuid: (r.to_user_uuid as string | null) ?? null,
  toUserName: (r.to_user_name as string | null) ?? null,
  toTeamUuid: (r.to_team_uuid as string | null) ?? null,
  toTeamName: (r.to_team_name as string | null) ?? null,
  includeDeals: r.include_deals === true,
  reason: (r.reason as string | null) ?? null,
  restoreOn: (r.restore_on as string | null) ?? null,
  status: r.status as BatchRow['status'],
  movedContacts: Number(r.moved_contacts),
  movedDeals: Number(r.moved_deals),
  restoredContacts: Number(r.restored_contacts),
  restoredDeals: Number(r.restored_deals),
  notRestored: Number(r.not_restored),
  remaining: Number(r.remaining),
  undoUntil: new Date(r.undo_until as string | Date),
  restoredAt: r.restored_at ? new Date(r.restored_at as string | Date) : null,
  createdAt: new Date(r.created_at as string | Date),
});

const SELECT = sql`
  SELECT b.id, b.org_id, b.uuid, b.from_user_id, fu.uuid AS from_uuid, fu.full_name AS from_name, fu.status AS from_status,
         b.to_kind, tu.uuid AS to_user_uuid, tu.full_name AS to_user_name, tt.uuid AS to_team_uuid, tt.name AS to_team_name,
         b.include_deals, b.reason, b.restore_on::text AS restore_on, b.status, b.moved_contacts, b.moved_deals,
         b.restored_contacts, b.restored_deals, b.not_restored, b.remaining, b.undo_until, b.restored_at, b.created_at
  FROM owner_reassign_batches b
  JOIN users fu ON fu.org_id = b.org_id AND fu.id = b.from_user_id
  LEFT JOIN users tu ON tu.org_id = b.org_id AND tu.id = b.to_user_id
  LEFT JOIN teams tt ON tt.org_id = b.org_id AND tt.id = b.to_team_id`;

/**
 * Data access for reassign batches. The records carry the batch that placed their owner (`owner_batch_id`, stamped by a trigger from
 * the transaction setting `app.owner_batch_id`); a restore selects exactly the rows still stamped with its batch.
 */
@Injectable()
export class OwnerReassignRepository {
  /** Serialises batches of one person (two managers pressing the button at once). */
  async lockPerson(tx: Tx, orgId: number, userId: number): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${orgId}::int, ${userId}::int)`);
  }

  async counts(
    tx: Tx,
    orgId: number,
    fromId: number,
  ): Promise<{ contacts: number; openDeals: number }> {
    const res = await tx.execute(sql`
      SELECT (SELECT count(*)::int FROM contacts WHERE org_id = ${orgId} AND owner_id = ${fromId}) AS contacts,
             (SELECT count(*)::int FROM deals WHERE org_id = ${orgId} AND owner_user_id = ${fromId} AND status = 'open') AS deals`);
    const r = res.rows[0] as Raw;
    return { contacts: Number(r.contacts), openDeals: Number(r.deals) };
  }

  async teamMemberIds(tx: Tx, orgId: number, teamUuid: string): Promise<number[] | null> {
    const t = await tx.execute(
      sql`SELECT id FROM teams WHERE org_id = ${orgId} AND uuid = ${teamUuid}`,
    );
    if (!t.rows[0]) return null;
    const m = await tx.execute(sql`
      SELECT tm.user_id FROM team_members tm JOIN users u ON u.org_id = tm.org_id AND u.id = tm.user_id AND u.status = 'active'
      WHERE tm.org_id = ${orgId} AND tm.team_id = ${Number((t.rows[0] as Raw).id)} ORDER BY tm.user_id`);
    return (m.rows as Raw[]).map((r) => Number(r.user_id));
  }

  async teamId(tx: Tx, orgId: number, teamUuid: string): Promise<number | null> {
    const t = await tx.execute(
      sql`SELECT id FROM teams WHERE org_id = ${orgId} AND uuid = ${teamUuid}`,
    );
    return t.rows[0] ? Number((t.rows[0] as Raw).id) : null;
  }

  async userStatus(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; status: string } | null> {
    const r = await tx.execute(
      sql`SELECT id, status FROM users WHERE org_id = ${orgId} AND uuid = ${uuid}`,
    );
    const row = r.rows[0] as Raw | undefined;
    return row ? { id: Number(row.id), status: String(row.status) } : null;
  }

  async insert(
    tx: Tx,
    orgId: number,
    v: {
      fromUserId: number;
      toKind: string;
      toUserId: number | null;
      toTeamId: number | null;
      includeDeals: boolean;
      reason: string | null;
      restoreOn: string | null;
      undoDays: number;
      createdBy: number | null;
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO owner_reassign_batches
        (org_id, from_user_id, to_kind, to_user_id, to_team_id, include_deals, reason, restore_on, undo_until, created_by)
      VALUES (${orgId}, ${v.fromUserId}, ${v.toKind}, ${v.toUserId}, ${v.toTeamId}, ${v.includeDeals}, ${v.reason},
              ${v.restoreOn}::date, now() + make_interval(days => ${v.undoDays}), ${v.createdBy})
      RETURNING id`);
    return Number((res.rows[0] as Raw).id);
  }

  async byUuid(tx: Tx, orgId: number, uuid: string, lock = false): Promise<BatchRow | null> {
    const res = await tx.execute(
      lock
        ? sql`${SELECT} WHERE b.org_id = ${orgId} AND b.uuid = ${uuid} FOR UPDATE OF b`
        : sql`${SELECT} WHERE b.org_id = ${orgId} AND b.uuid = ${uuid}`,
    );
    return res.rows[0] ? toBatch(res.rows[0] as Raw) : null;
  }

  async byId(tx: Tx, orgId: number, id: number): Promise<BatchRow> {
    const res = await tx.execute(sql`${SELECT} WHERE b.org_id = ${orgId} AND b.id = ${id}`);
    return toBatch(res.rows[0] as Raw);
  }

  async list(
    tx: Tx,
    orgId: number,
    fromUserId: number | undefined,
    limit: number,
  ): Promise<BatchRow[]> {
    const res = await tx.execute(sql`${SELECT} WHERE b.org_id = ${orgId}
      ${fromUserId === undefined ? sql`` : sql`AND b.from_user_id = ${fromUserId}`}
      ORDER BY b.created_at DESC, b.id DESC LIMIT ${limit}`);
    return (res.rows as Raw[]).map(toBatch);
  }

  /** Marks the batch on the rows for the statements that follow in this transaction (`''` = no batch, which clears the stamp). */
  async announce(tx: Tx, batchId: number | null): Promise<void> {
    await tx.execute(
      sql`SELECT set_config('app.owner_batch_id', ${batchId === null ? '' : String(batchId)}, true)`,
    );
  }

  /**
   * Gives up to `cap` contacts of `fromId` to `targets` in turns (round robin by id; a single target takes all). One audit row and one
   * `contact.updated` event per contact, as the bulk owner route writes them. Returns how many moved.
   */
  async moveContacts(
    tx: Tx,
    orgId: number,
    fromId: number,
    targets: readonly number[],
    cap: number,
    actor: Actor,
    /** The workspace marks a reassigned contact uncontacted (BL-290). A restore after leave never does. */
    markUncontacted = false,
  ): Promise<number> {
    const arr = sql`ARRAY[${sql.join(
      targets.map((t) => sql`${t}::bigint`),
      sql`, `,
    )}]::bigint[]`;
    const res = await tx.execute(sql`
      WITH picked AS (
        SELECT c.id, c.uuid, row_number() OVER (ORDER BY c.id) AS rn
        FROM contacts c WHERE c.org_id = ${orgId} AND c.owner_id = ${fromId} ORDER BY c.id LIMIT ${cap}
      ), upd AS (
        UPDATE contacts SET owner_id = (${arr})[1 + ((picked.rn - 1) % ${targets.length})], updated_by = ${actor.actorId}::bigint,
          uncontacted_since = CASE WHEN ${markUncontacted}::boolean THEN coalesce(contacts.uncontacted_since, now()) ELSE contacts.uncontacted_since END
        FROM picked WHERE contacts.org_id = ${orgId} AND contacts.id = picked.id AND contacts.owner_id = ${fromId}
        RETURNING contacts.id, picked.uuid, contacts.owner_id AS new_owner
      ), au AS (
        INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id)
        SELECT ${orgId}::bigint, ${actor.actorId}::bigint, ${actor.actorType}, 'contacts', upd.id, 'update',
               jsonb_build_object('ownerId', jsonb_build_object('old', fu.uuid::text, 'new', nu.uuid::text)), ${actor.requestId}
        FROM upd JOIN users fu ON fu.org_id = ${orgId} AND fu.id = ${fromId} JOIN users nu ON nu.org_id = ${orgId} AND nu.id = upd.new_owner
      ), ev AS (
        INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload)
        SELECT ${orgId}::bigint, 'contacts', upd.id, 'contact.updated',
               jsonb_build_object('uuid', upd.uuid, 'ownerId', nu.uuid::text, 'previousOwnerId', fu.uuid::text, '_meta', ${metaJson(actor)}::jsonb)
        FROM upd JOIN users fu ON fu.org_id = ${orgId} AND fu.id = ${fromId} JOIN users nu ON nu.org_id = ${orgId} AND nu.id = upd.new_owner
      )
      SELECT count(*)::int AS n FROM upd`);
    return Number((res.rows[0] as Raw).n);
  }

  /** The same for the OPEN deals of `fromId` (won and lost deals stay with the person: they are history). */
  async moveDeals(
    tx: Tx,
    orgId: number,
    fromId: number,
    targets: readonly number[],
    cap: number,
    actor: Actor,
  ): Promise<number> {
    const arr = sql`ARRAY[${sql.join(
      targets.map((t) => sql`${t}::bigint`),
      sql`, `,
    )}]::bigint[]`;
    const res = await tx.execute(sql`
      WITH picked AS (
        SELECT d.id, d.uuid, row_number() OVER (ORDER BY d.id) AS rn
        FROM deals d WHERE d.org_id = ${orgId} AND d.owner_user_id = ${fromId} AND d.status = 'open' ORDER BY d.id LIMIT ${cap}
      ), upd AS (
        UPDATE deals SET owner_user_id = (${arr})[1 + ((picked.rn - 1) % ${targets.length})]
        FROM picked WHERE deals.org_id = ${orgId} AND deals.id = picked.id AND deals.owner_user_id = ${fromId}
        RETURNING deals.id, picked.uuid, deals.owner_user_id AS new_owner
      ), au AS (
        INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id)
        SELECT ${orgId}::bigint, ${actor.actorId}::bigint, ${actor.actorType}, 'deals', upd.id, 'update',
               jsonb_build_object('ownerId', jsonb_build_object('old', fu.uuid::text, 'new', nu.uuid::text)), ${actor.requestId}
        FROM upd JOIN users fu ON fu.org_id = ${orgId} AND fu.id = ${fromId} JOIN users nu ON nu.org_id = ${orgId} AND nu.id = upd.new_owner
      ), ev AS (
        INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload)
        SELECT ${orgId}::bigint, 'deals', upd.id, 'deal.owner_changed',
               jsonb_build_object('uuid', upd.uuid, 'ownerId', nu.uuid::text, 'previousOwnerId', fu.uuid::text, '_meta', ${metaJson(actor)}::jsonb)
        FROM upd JOIN users fu ON fu.org_id = ${orgId} AND fu.id = ${fromId} JOIN users nu ON nu.org_id = ${orgId} AND nu.id = upd.new_owner
      )
      SELECT count(*)::int AS n FROM upd`);
    return Number((res.rows[0] as Raw).n);
  }

  /** Puts back the contacts still stamped with this batch (nobody changed their owner since). */
  async restoreContacts(
    tx: Tx,
    orgId: number,
    batchId: number,
    fromId: number,
    actor: Actor,
  ): Promise<number> {
    const res = await tx.execute(sql`
      WITH picked AS (
        SELECT c.id, c.uuid, c.owner_id AS cur FROM contacts c WHERE c.org_id = ${orgId} AND c.owner_batch_id = ${batchId}
      ), upd AS (
        UPDATE contacts SET owner_id = ${fromId}, updated_by = ${actor.actorId}::bigint
        FROM picked WHERE contacts.org_id = ${orgId} AND contacts.id = picked.id AND contacts.owner_batch_id = ${batchId}
        RETURNING contacts.id, picked.uuid, picked.cur
      ), au AS (
        INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id)
        SELECT ${orgId}::bigint, ${actor.actorId}::bigint, ${actor.actorType}, 'contacts', upd.id, 'update',
               jsonb_build_object('ownerId', jsonb_build_object('old', cu.uuid::text, 'new', fu.uuid::text)), ${actor.requestId}
        FROM upd JOIN users fu ON fu.org_id = ${orgId} AND fu.id = ${fromId} LEFT JOIN users cu ON cu.org_id = ${orgId} AND cu.id = upd.cur
      ), ev AS (
        INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload)
        SELECT ${orgId}::bigint, 'contacts', upd.id, 'contact.updated',
               jsonb_build_object('uuid', upd.uuid, 'ownerId', fu.uuid::text, 'previousOwnerId', cu.uuid::text, '_meta', ${metaJson(actor)}::jsonb)
        FROM upd JOIN users fu ON fu.org_id = ${orgId} AND fu.id = ${fromId} LEFT JOIN users cu ON cu.org_id = ${orgId} AND cu.id = upd.cur
      )
      SELECT count(*)::int AS n FROM upd`);
    return Number((res.rows[0] as Raw).n);
  }

  async restoreDeals(
    tx: Tx,
    orgId: number,
    batchId: number,
    fromId: number,
    actor: Actor,
  ): Promise<number> {
    const res = await tx.execute(sql`
      WITH picked AS (
        SELECT d.id, d.uuid, d.owner_user_id AS cur FROM deals d WHERE d.org_id = ${orgId} AND d.owner_batch_id = ${batchId}
      ), upd AS (
        UPDATE deals SET owner_user_id = ${fromId}
        FROM picked WHERE deals.org_id = ${orgId} AND deals.id = picked.id AND deals.owner_batch_id = ${batchId}
        RETURNING deals.id, picked.uuid, picked.cur
      ), au AS (
        INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id)
        SELECT ${orgId}::bigint, ${actor.actorId}::bigint, ${actor.actorType}, 'deals', upd.id, 'update',
               jsonb_build_object('ownerId', jsonb_build_object('old', cu.uuid::text, 'new', fu.uuid::text)), ${actor.requestId}
        FROM upd JOIN users fu ON fu.org_id = ${orgId} AND fu.id = ${fromId} LEFT JOIN users cu ON cu.org_id = ${orgId} AND cu.id = upd.cur
      ), ev AS (
        INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload)
        SELECT ${orgId}::bigint, 'deals', upd.id, 'deal.owner_changed',
               jsonb_build_object('uuid', upd.uuid, 'ownerId', fu.uuid::text, 'previousOwnerId', cu.uuid::text, '_meta', ${metaJson(actor)}::jsonb)
        FROM upd JOIN users fu ON fu.org_id = ${orgId} AND fu.id = ${fromId} LEFT JOIN users cu ON cu.org_id = ${orgId} AND cu.id = upd.cur
      )
      SELECT count(*)::int AS n FROM upd`);
    return Number((res.rows[0] as Raw).n);
  }

  async saveApplied(
    tx: Tx,
    orgId: number,
    id: number,
    v: { contacts: number; deals: number; remaining: number },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE owner_reassign_batches SET moved_contacts = ${v.contacts}, moved_deals = ${v.deals}, remaining = ${v.remaining}
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async saveRestored(
    tx: Tx,
    orgId: number,
    id: number,
    v: { status: string; contacts: number; deals: number; notRestored: number; by: number | null },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE owner_reassign_batches SET status = ${v.status}, restored_contacts = ${v.contacts}, restored_deals = ${v.deals},
             not_restored = ${v.notRestored}, restored_at = now(), restored_by = ${v.by}
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async audit(
    tx: Tx,
    e: {
      orgId: number;
      actor: Actor;
      recordId: number;
      action: string;
      delta: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id)
      VALUES (${e.orgId}, ${e.actor.actorId}, ${e.actor.actorType}, 'members', ${e.recordId}, ${e.action},
              ${JSON.stringify(e.delta)}::jsonb, ${e.actor.requestId})`);
  }
}
