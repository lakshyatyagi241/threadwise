import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { ListLegalHoldsQuery, LegalHoldScope, LegalHoldStatus } from '@crm/contracts';
import { bigintArray } from '../registry/sql';
import type { ResolvedSubject } from '../registry/types';

export interface HoldRow {
  id: number;
  uuid: string;
  scope: LegalHoldScope;
  contactId: number | null;
  contactUuid: string | null;
  leadId: number | null;
  leadUuid: string | null;
  subjectLabel: string;
  reasonCategory: string;
  caseRef: string;
  note: string | null;
  reviewAt: Date | null;
  expiresAt: Date | null;
  status: LegalHoldStatus;
  placedBy: number | null;
  placedByName: string | null;
  placedAt: Date;
  lastReviewedByName: string | null;
  lastReviewedAt: Date | null;
  releasedByName: string | null;
  releasedAt: Date | null;
  releaseNote: string | null;
  restrictedCases: number;
  rowVersion: number;
}

export interface HistoryRow {
  at: Date;
  action: string;
  actor: string | null;
  delta: Record<string, { old: unknown; new: unknown }> | null;
}

const COLS = sql`h.id, h.uuid, h.scope, h.contact_id, c.uuid AS contact_uuid, h.lead_id, l.uuid AS lead_uuid, h.subject_label,
  h.reason_category, h.case_ref, h.note, h.review_at, h.expires_at, h.status, h.placed_by, pu.full_name AS placed_by_name, h.placed_at,
  ru.full_name AS reviewed_by_name, h.last_reviewed_at, xu.full_name AS released_by_name, h.released_at, h.release_note, h.row_version,
  (SELECT count(*)::int FROM privacy_requests r
    WHERE r.org_id = h.org_id AND r.restricted_hold_id = h.id AND r.restricted_at IS NOT NULL) AS restricted_cases`;

const FROM = sql`legal_holds h
  LEFT JOIN contacts c ON c.org_id = h.org_id AND c.id = h.contact_id
  LEFT JOIN leads l ON l.org_id = h.org_id AND l.id = h.lead_id
  LEFT JOIN users pu ON pu.org_id = h.org_id AND pu.id = h.placed_by
  LEFT JOIN users ru ON ru.org_id = h.org_id AND ru.id = h.last_reviewed_by
  LEFT JOIN users xu ON xu.org_id = h.org_id AND xu.id = h.released_by`;

const toHold = (r: Record<string, unknown>): HoldRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  scope: r.scope as LegalHoldScope,
  contactId: r.contact_id === null ? null : Number(r.contact_id),
  contactUuid: (r.contact_uuid as string | null) ?? null,
  leadId: r.lead_id === null ? null : Number(r.lead_id),
  leadUuid: (r.lead_uuid as string | null) ?? null,
  subjectLabel: r.subject_label as string,
  reasonCategory: r.reason_category as string,
  caseRef: r.case_ref as string,
  note: (r.note as string | null) ?? null,
  reviewAt: r.review_at ? new Date(r.review_at as string) : null,
  expiresAt: r.expires_at ? new Date(r.expires_at as string) : null,
  status: r.status as LegalHoldStatus,
  placedBy: r.placed_by === null ? null : Number(r.placed_by),
  placedByName: (r.placed_by_name as string | null) ?? null,
  placedAt: new Date(r.placed_at as string),
  lastReviewedByName: (r.reviewed_by_name as string | null) ?? null,
  lastReviewedAt: r.last_reviewed_at ? new Date(r.last_reviewed_at as string) : null,
  releasedByName: (r.released_by_name as string | null) ?? null,
  releasedAt: r.released_at ? new Date(r.released_at as string) : null,
  releaseNote: (r.release_note as string | null) ?? null,
  restrictedCases: Number(r.restricted_cases ?? 0),
  rowVersion: Number(r.row_version),
});

/** All SQL of the legal-hold register. Every method runs in the transaction it is given; isolation is the RLS policy plus `org_id = $1`. */
@Injectable()
export class LegalHoldsRepository {
  async insert(
    tx: Tx,
    orgId: number,
    v: {
      scope: LegalHoldScope;
      contactId: number | null;
      leadId: number | null;
      subjectLabel: string;
      reasonCategory: string;
      caseRef: string;
      note: string | null;
      reviewAt: Date | null;
      expiresAt: Date | null;
      placedBy: number | null;
    },
  ): Promise<HoldRow> {
    const res = await tx.execute(sql`
      INSERT INTO legal_holds (org_id, scope, contact_id, lead_id, subject_label, reason_category, case_ref, note, review_at, expires_at, placed_by)
      VALUES (${orgId}, ${v.scope}, ${v.contactId}, ${v.leadId}, ${v.subjectLabel}, ${v.reasonCategory}, ${v.caseRef}, ${v.note},
              ${v.reviewAt?.toISOString() ?? null}::timestamptz, ${v.expiresAt?.toISOString() ?? null}::timestamptz, ${v.placedBy})
      RETURNING id`);
    return (await this.byId(tx, orgId, Number((res.rows[0] as { id: number }).id)))!;
  }

  async byId(tx: Tx, orgId: number, id: number): Promise<HoldRow | null> {
    const res = await tx.execute(
      sql`SELECT ${COLS} FROM ${FROM} WHERE h.org_id = ${orgId} AND h.id = ${id}`,
    );
    return res.rows[0] ? toHold(res.rows[0] as Record<string, unknown>) : null;
  }

  async byUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    opts: { lock?: boolean } = {},
  ): Promise<HoldRow | null> {
    if (opts.lock) {
      const locked = await tx.execute(
        sql`SELECT id FROM legal_holds WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid FOR UPDATE`,
      );
      if (!locked.rows[0]) return null;
      return this.byId(tx, orgId, Number((locked.rows[0] as { id: number }).id));
    }
    const res = await tx.execute(
      sql`SELECT ${COLS} FROM ${FROM} WHERE h.org_id = ${orgId} AND h.uuid = ${uuid}::uuid`,
    );
    return res.rows[0] ? toHold(res.rows[0] as Record<string, unknown>) : null;
  }

  private filters(orgId: number, f: ListLegalHoldsQuery): SQL[] {
    const where: SQL[] = [sql`h.org_id = ${orgId}`];
    if (f.status) where.push(sql`h.status = ${f.status}`);
    if (f.reasonCategory) where.push(sql`h.reason_category = ${f.reasonCategory}`);
    if (f.scope) where.push(sql`h.scope = ${f.scope}`);
    if (f.reviewDue)
      where.push(sql`h.status = 'active' AND h.review_at IS NOT NULL AND h.review_at < now()`);
    if (f.q) {
      const like = `%${f.q.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
      where.push(sql`h.case_ref ILIKE ${like}`);
    }
    return where;
  }

  async list(
    tx: Tx,
    orgId: number,
    f: ListLegalHoldsQuery,
    after?: { placedAt: Date; id: number },
    limit = f.limit + 1,
  ): Promise<HoldRow[]> {
    const where = this.filters(orgId, f);
    if (after) {
      where.push(
        sql`(h.placed_at, h.id) < (${after.placedAt.toISOString()}::timestamptz, ${after.id}::bigint)`,
      );
    }
    const res = await tx.execute(sql`
      SELECT ${COLS} FROM ${FROM} WHERE ${sql.join(where, sql` AND `)}
       ORDER BY h.placed_at DESC, h.id DESC LIMIT ${limit}`);
    return (res.rows as Array<Record<string, unknown>>).map(toHold);
  }

  /** The active hold that names exactly this subject (not one that covers it through a link). */
  async activeFor(
    tx: Tx,
    orgId: number,
    scope: LegalHoldScope,
    subjectId: number | null,
  ): Promise<HoldRow | null> {
    const cond =
      scope === 'contact'
        ? sql`h.contact_id = ${subjectId}`
        : scope === 'lead'
          ? sql`h.lead_id = ${subjectId}`
          : sql`TRUE`;
    const res = await tx.execute(sql`
      SELECT ${COLS} FROM ${FROM}
       WHERE h.org_id = ${orgId} AND h.status = 'active' AND h.scope = ${scope} AND ${cond}`);
    return res.rows[0] ? toHold(res.rows[0] as Record<string, unknown>) : null;
  }

  /** The active hold (not past its end date) that covers one contact or lead, directly, through the person's other record, or as a workspace hold. */
  async coveringFor(
    tx: Tx,
    orgId: number,
    kind: 'contact' | 'lead',
    id: number,
  ): Promise<HoldRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLS} FROM ${FROM}
       WHERE h.org_id = ${orgId} AND h.status = 'active' AND (h.expires_at IS NULL OR h.expires_at > now())
         AND (h.scope = 'workspace'
              OR (${kind === 'contact'} AND (h.contact_id = ${id}
                    OR h.lead_id IN (SELECT x.id FROM leads x WHERE x.org_id = ${orgId} AND x.contact_id = ${id})))
              OR (${kind === 'lead'} AND (h.lead_id = ${id}
                    OR h.contact_id = (SELECT x.contact_id FROM leads x WHERE x.org_id = ${orgId} AND x.id = ${id}))))
       ORDER BY (h.scope = 'workspace'), h.id LIMIT 1`);
    return res.rows[0] ? toHold(res.rows[0] as Record<string, unknown>) : null;
  }

  /** An active hold covering the resolved person (any of their contacts or leads, or the workspace); null when only the operator's hold applies. */
  async coveringHold(tx: Tx, orgId: number, subject: ResolvedSubject): Promise<HoldRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLS} FROM ${FROM}
       WHERE h.org_id = ${orgId} AND h.status = 'active' AND (h.expires_at IS NULL OR h.expires_at > now())
         AND (h.scope = 'workspace'
              OR h.contact_id = ANY(${bigintArray(subject.contactIds)})
              OR h.lead_id = ANY(${bigintArray(subject.leadIds)})
              OR h.lead_id IN (SELECT x.id FROM leads x WHERE x.org_id = ${orgId} AND x.contact_id = ANY(${bigintArray(subject.contactIds)}))
              OR h.contact_id IN (SELECT x.contact_id FROM leads x WHERE x.org_id = ${orgId} AND x.id = ANY(${bigintArray(subject.leadIds)})))
       ORDER BY (h.scope = 'workspace'), h.id LIMIT 1`);
    return res.rows[0] ? toHold(res.rows[0] as Record<string, unknown>) : null;
  }

  /** Active holds whose end date has passed, one workspace or (privileged) all. */
  async dueForExpiry(
    tx: Tx,
    orgId: number | null,
    limit: number,
  ): Promise<Array<{ orgId: number; id: number }>> {
    const res = await tx.execute(sql`
      SELECT org_id, id FROM legal_holds
       WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= now()
         AND (${orgId}::bigint IS NULL OR org_id = ${orgId}::bigint)
       ORDER BY expires_at LIMIT ${limit}`);
    return (res.rows as Array<{ org_id: number | string; id: number | string }>).map((r) => ({
      orgId: Number(r.org_id),
      id: Number(r.id),
    }));
  }

  async end(
    tx: Tx,
    orgId: number,
    id: number,
    v: { status: 'released' | 'expired'; by: number | null; note: string | null },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE legal_holds SET status = ${v.status}, released_at = now(), released_by = ${v.by}::bigint, release_note = ${v.note}
       WHERE org_id = ${orgId} AND id = ${id} AND status = 'active'`);
  }

  async update(
    tx: Tx,
    orgId: number,
    id: number,
    v: {
      reviewAt?: Date | null;
      expiresAt?: Date | null;
      caseRef?: string;
      note?: string | null;
    },
  ): Promise<void> {
    const sets: SQL[] = [];
    if (v.reviewAt !== undefined)
      sets.push(sql`review_at = ${v.reviewAt?.toISOString() ?? null}::timestamptz`);
    if (v.expiresAt !== undefined)
      sets.push(sql`expires_at = ${v.expiresAt?.toISOString() ?? null}::timestamptz`);
    if (v.caseRef !== undefined) sets.push(sql`case_ref = ${v.caseRef}`);
    if (v.note !== undefined) sets.push(sql`note = ${v.note}`);
    if (sets.length === 0) return;
    await tx.execute(sql`
      UPDATE legal_holds SET ${sql.join(sets, sql`, `)} WHERE org_id = ${orgId} AND id = ${id} AND status = 'active'`);
  }

  async markReviewed(
    tx: Tx,
    orgId: number,
    id: number,
    v: {
      by: number | null;
      nextReviewAt: Date | null | undefined;
      note: string | null | undefined;
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE legal_holds SET last_reviewed_at = now(), last_reviewed_by = ${v.by}::bigint,
        review_at = CASE WHEN ${v.nextReviewAt !== undefined} THEN ${v.nextReviewAt?.toISOString() ?? null}::timestamptz ELSE review_at END,
        note = CASE WHEN ${v.note !== undefined} THEN ${v.note ?? null} ELSE note END
       WHERE org_id = ${orgId} AND id = ${id} AND status = 'active'`);
  }

  // ---- rights cases -------------------------------------------------------------------------------------------------------------

  /**
   * Open erasure cases that name this hold's subject by contact or lead, set to restricted. Returns them for the event and the outbox
   * event. A case for a phone or an email (no stored link) is handled by the service, which has to resolve the person first.
   */
  async restrictOpenErasures(
    tx: Tx,
    orgId: number,
    hold: HoldRow,
  ): Promise<Array<{ id: number; uuid: string }>> {
    const subject =
      hold.scope === 'workspace'
        ? sql`TRUE`
        : hold.scope === 'contact'
          ? sql`(r.contact_id = ${hold.contactId}
                 OR r.lead_id IN (SELECT x.id FROM leads x WHERE x.org_id = ${orgId} AND x.contact_id = ${hold.contactId}))`
          : sql`(r.lead_id = ${hold.leadId}
                 OR r.contact_id = (SELECT x.contact_id FROM leads x WHERE x.org_id = ${orgId} AND x.id = ${hold.leadId}))`;
    const res = await tx.execute(sql`
      UPDATE privacy_requests r SET restricted_at = now(), restricted_hold_id = ${hold.id}
       WHERE r.org_id = ${orgId} AND r.request_type = 'erasure' AND r.status IN ('received', 'verifying', 'in_progress')
         AND r.restricted_at IS NULL AND ${subject}
       RETURNING r.id, r.uuid`);
    return (res.rows as Array<{ id: number | string; uuid: string }>).map((r) => ({
      id: Number(r.id),
      uuid: r.uuid,
    }));
  }

  /** Open, not yet restricted erasure cases whose person is a free phone or email (resolved by the service). */
  async openIdentifierErasures(tx: Tx, orgId: number): Promise<number[]> {
    const res = await tx.execute(sql`
      SELECT id FROM privacy_requests
       WHERE org_id = ${orgId} AND request_type = 'erasure' AND subject_kind = 'identifier'
         AND status IN ('received', 'verifying', 'in_progress') AND restricted_at IS NULL`);
    return (res.rows as Array<{ id: number | string }>).map((r) => Number(r.id));
  }

  /** The cases that wait on this hold, locked for the rest of the transaction. */
  async restrictedBy(tx: Tx, orgId: number, holdId: number): Promise<number[]> {
    const res = await tx.execute(sql`
      SELECT id FROM privacy_requests
       WHERE org_id = ${orgId} AND restricted_hold_id = ${holdId} AND restricted_at IS NOT NULL ORDER BY id FOR UPDATE`);
    return (res.rows as Array<{ id: number | string }>).map((r) => Number(r.id));
  }

  // ---- history ------------------------------------------------------------------------------------------------------------------

  async history(tx: Tx, orgId: number, holdId: number): Promise<HistoryRow[]> {
    const res = await tx.execute(sql`
      SELECT a.at, a.action, u.full_name AS actor, a.delta
        FROM audit_log a
        LEFT JOIN users u ON a.actor_type = 'user' AND u.org_id = a.org_id AND u.id = a.actor_id
       WHERE a.org_id = ${orgId} AND a.module = 'legal_holds' AND a.record_id = ${holdId}
       ORDER BY a.at DESC, a.id DESC LIMIT 100`);
    return (res.rows as Array<Record<string, unknown>>).map((r) => ({
      at: new Date(r.at as string),
      action: r.action as string,
      actor: (r.actor as string | null) ?? null,
      delta: (r.delta as HistoryRow['delta']) ?? null,
    }));
  }
}
