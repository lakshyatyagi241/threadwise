import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { PrivacyErasureReport } from '@crm/contracts';

export interface RequestRow {
  id: number;
  uuid: string;
  requestType: string;
  status: string;
  subjectKind: string;
  contactId: number | null;
  contactUuid: string | null;
  leadId: number | null;
  leadUuid: string | null;
  identifierKind: string | null;
  identifierCipher: string | null;
  subjectLabel: string;
  requesterChannel: string;
  internalNote: string | null;
  receivedAt: Date;
  dueAt: Date;
  verificationMethod: string | null;
  verificationEvidenceRef: string | null;
  verifiedAt: Date | null;
  legalHold: boolean;
  legalHoldReason: string | null;
  historyMode: string;
  rejectionReason: string | null;
  dryRunAt: Date | null;
  dryRunSummary: PrivacyErasureReport | null;
  resultSummary: Record<string, unknown>;
  proof: Record<string, unknown> | null;
  proofSha256: string | null;
  completedAt: Date | null;
  createdAt: Date;
  rowVersion: number;
}

export interface EventRow {
  uuid: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorName: string | null;
  detail: Record<string, unknown>;
  createdAt: Date;
}

export interface ExportRow {
  id: number;
  uuid: string;
  requestId: number;
  requestedBy: number | null;
  status: string;
  fileName: string | null;
  fileBytes: number | null;
  sectionCounts: Record<string, number>;
  error: string | null;
  requestedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date | null;
}

const REQUEST_COLS = sql`r.id, r.uuid, r.request_type, r.status, r.subject_kind, r.contact_id, c.uuid AS contact_uuid, r.lead_id,
  l.uuid AS lead_uuid, r.subject_identifier_kind, r.subject_identifier_cipher, r.subject_label, r.requester_channel, r.internal_note,
  r.received_at, r.due_at, r.verification_method, r.verification_evidence_ref, r.verified_at, r.legal_hold, r.legal_hold_reason,
  r.history_mode, r.rejection_reason, r.dry_run_at, r.dry_run_summary, r.result_summary, r.proof, r.proof_sha256, r.completed_at,
  r.created_at, r.row_version`;

const REQUEST_FROM = sql`privacy_requests r
  LEFT JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id
  LEFT JOIN leads l ON l.org_id = r.org_id AND l.id = r.lead_id`;

const toRequest = (r: Record<string, unknown>): RequestRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  requestType: r.request_type as string,
  status: r.status as string,
  subjectKind: r.subject_kind as string,
  contactId: r.contact_id === null ? null : Number(r.contact_id),
  contactUuid: (r.contact_uuid as string | null) ?? null,
  leadId: r.lead_id === null ? null : Number(r.lead_id),
  leadUuid: (r.lead_uuid as string | null) ?? null,
  identifierKind: (r.subject_identifier_kind as string | null) ?? null,
  identifierCipher: (r.subject_identifier_cipher as string | null) ?? null,
  subjectLabel: r.subject_label as string,
  requesterChannel: r.requester_channel as string,
  internalNote: (r.internal_note as string | null) ?? null,
  receivedAt: new Date(r.received_at as string),
  dueAt: new Date(r.due_at as string),
  verificationMethod: (r.verification_method as string | null) ?? null,
  verificationEvidenceRef: (r.verification_evidence_ref as string | null) ?? null,
  verifiedAt: r.verified_at ? new Date(r.verified_at as string) : null,
  legalHold: r.legal_hold as boolean,
  legalHoldReason: (r.legal_hold_reason as string | null) ?? null,
  historyMode: r.history_mode as string,
  rejectionReason: (r.rejection_reason as string | null) ?? null,
  dryRunAt: r.dry_run_at ? new Date(r.dry_run_at as string) : null,
  dryRunSummary: (r.dry_run_summary as PrivacyErasureReport | null) ?? null,
  resultSummary: (r.result_summary as Record<string, unknown>) ?? {},
  proof: (r.proof as Record<string, unknown> | null) ?? null,
  proofSha256: (r.proof_sha256 as string | null) ?? null,
  completedAt: r.completed_at ? new Date(r.completed_at as string) : null,
  createdAt: new Date(r.created_at as string),
  rowVersion: Number(r.row_version),
});

const toExport = (r: Record<string, unknown>): ExportRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  requestId: Number(r.request_id),
  requestedBy: r.requested_by === null ? null : Number(r.requested_by),
  status: r.status as string,
  fileName: (r.file_name as string | null) ?? null,
  fileBytes: r.file_bytes === null ? null : Number(r.file_bytes),
  sectionCounts: (r.section_counts as Record<string, number>) ?? {},
  error: (r.error as string | null) ?? null,
  requestedAt: new Date(r.requested_at as string),
  startedAt: r.started_at ? new Date(r.started_at as string) : null,
  completedAt: r.completed_at ? new Date(r.completed_at as string) : null,
  expiresAt: r.expires_at ? new Date(r.expires_at as string) : null,
});

const EXPORT_COLS = sql`id, uuid, request_id, requested_by, status, file_name, file_bytes, section_counts, error, requested_at,
  started_at, completed_at, expires_at`;

/** All SQL of the rights service. Every method runs in the transaction it is given; tenant isolation is the RLS policy plus `org_id = $1`. */
@Injectable()
export class PrivacyRequestsRepository {
  // ---- requests ---------------------------------------------------------------------------------------------------------------

  async insert(
    tx: Tx,
    orgId: number,
    v: {
      requestType: string;
      subjectKind: string;
      contactId: number | null;
      leadId: number | null;
      identifierKind: string | null;
      identifierCipher: string | null;
      subjectLabel: string;
      requesterChannel: string;
      internalNote: string | null;
      dueAt: Date;
      historyMode: string;
      createdBy: number | null;
    },
  ): Promise<RequestRow> {
    const res = await tx.execute(sql`
      INSERT INTO privacy_requests (org_id, request_type, subject_kind, contact_id, lead_id, subject_identifier_kind,
        subject_identifier_cipher, subject_label, requester_channel, internal_note, due_at, history_mode, created_by)
      VALUES (${orgId}, ${v.requestType}, ${v.subjectKind}, ${v.contactId}, ${v.leadId}, ${v.identifierKind}, ${v.identifierCipher},
        ${v.subjectLabel}, ${v.requesterChannel}, ${v.internalNote}, ${v.dueAt.toISOString()}::timestamptz, ${v.historyMode},
        ${v.createdBy})
      RETURNING id`);
    return (await this.byId(tx, orgId, Number((res.rows[0] as { id: number }).id)))!;
  }

  async byId(tx: Tx, orgId: number, id: number): Promise<RequestRow | null> {
    const res = await tx.execute(
      sql`SELECT ${REQUEST_COLS} FROM ${REQUEST_FROM} WHERE r.org_id = ${orgId} AND r.id = ${id}`,
    );
    return res.rows[0] ? toRequest(res.rows[0] as Record<string, unknown>) : null;
  }

  async byUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    opts: { lock?: boolean } = {},
  ): Promise<RequestRow | null> {
    if (opts.lock) {
      // Serialises the actions on one request (verify, export, erase): lock the bare row, then read it with its joins.
      const locked = await tx.execute(
        sql`SELECT id FROM privacy_requests WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid FOR UPDATE`,
      );
      if (!locked.rows[0]) return null;
      return this.byId(tx, orgId, Number((locked.rows[0] as { id: number }).id));
    }
    const res = await tx.execute(
      sql`SELECT ${REQUEST_COLS} FROM ${REQUEST_FROM} WHERE r.org_id = ${orgId} AND r.uuid = ${uuid}::uuid`,
    );
    return res.rows[0] ? toRequest(res.rows[0] as Record<string, unknown>) : null;
  }

  async list(
    tx: Tx,
    orgId: number,
    f: {
      status?: string;
      requestType?: string;
      overdue?: boolean;
      limit: number;
      after?: { receivedAt: Date; id: number };
    },
  ): Promise<RequestRow[]> {
    const where: SQL[] = [sql`r.org_id = ${orgId}`];
    if (f.status) where.push(sql`r.status = ${f.status}`);
    if (f.requestType) where.push(sql`r.request_type = ${f.requestType}`);
    if (f.overdue)
      where.push(sql`r.status IN ('received', 'verifying', 'in_progress') AND r.due_at < now()`);
    if (f.after) {
      where.push(
        sql`(r.received_at, r.id) < (${f.after.receivedAt.toISOString()}::timestamptz, ${f.after.id}::bigint)`,
      );
    }
    const res = await tx.execute(sql`
      SELECT ${REQUEST_COLS} FROM ${REQUEST_FROM} WHERE ${sql.join(where, sql` AND `)}
       ORDER BY r.received_at DESC, r.id DESC LIMIT ${f.limit + 1}`);
    return (res.rows as Array<Record<string, unknown>>).map(toRequest);
  }

  async setStatus(
    tx: Tx,
    orgId: number,
    id: number,
    status: string,
    extra: {
      verification?: { method: string | null; evidenceRef: string | null; by: number | null };
      rejectionReason?: string;
      completed?: boolean;
    } = {},
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE privacy_requests SET status = ${status},
        verification_method = CASE WHEN ${extra.verification ? true : false} THEN ${extra.verification?.method ?? null} ELSE verification_method END,
        verification_evidence_ref = CASE WHEN ${extra.verification ? true : false} THEN ${extra.verification?.evidenceRef ?? null} ELSE verification_evidence_ref END,
        verified_at = CASE WHEN ${extra.verification ? true : false} THEN now() ELSE verified_at END,
        verified_by = CASE WHEN ${extra.verification ? true : false} THEN ${extra.verification?.by ?? null}::bigint ELSE verified_by END,
        rejection_reason = COALESCE(${extra.rejectionReason ?? null}, rejection_reason),
        completed_at = CASE WHEN ${extra.completed ? true : false} THEN now() ELSE completed_at END
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async setHold(
    tx: Tx,
    orgId: number,
    id: number,
    held: boolean,
    reason: string | null,
    by: number | null,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE privacy_requests SET legal_hold = ${held}, legal_hold_reason = ${held ? reason : null},
        legal_hold_set_by = ${held ? by : null}::bigint, legal_hold_set_at = ${held ? sql`now()` : sql`NULL`}
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async saveDryRun(tx: Tx, orgId: number, id: number, report: PrivacyErasureReport): Promise<void> {
    await tx.execute(sql`
      UPDATE privacy_requests SET dry_run_at = now(), dry_run_summary = ${JSON.stringify(report)}::jsonb
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async saveErasure(
    tx: Tx,
    orgId: number,
    id: number,
    v: { result: Record<string, unknown>; proof: Record<string, unknown>; proofSha256: string },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE privacy_requests SET status = 'completed', completed_at = now(), result_summary = ${JSON.stringify(v.result)}::jsonb,
        proof = ${JSON.stringify(v.proof)}::jsonb, proof_sha256 = ${v.proofSha256}, subject_identifier_cipher = NULL
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** A completed request keeps no sealed identifier. */
  async dropIdentifier(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(
      sql`UPDATE privacy_requests SET subject_identifier_cipher = NULL WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  /** Open requests whose clock ran out. */
  async expireOverdue(tx: Tx, graceDays: number): Promise<Array<{ orgId: number; id: number }>> {
    const res = await tx.execute(sql`
      UPDATE privacy_requests SET status = 'expired', subject_identifier_cipher = NULL
       WHERE status IN ('received', 'verifying') AND due_at < now() - make_interval(days => ${graceDays})
       RETURNING org_id, id`);
    return (res.rows as Array<{ org_id: number | string; id: number | string }>).map((r) => ({
      orgId: Number(r.org_id),
      id: Number(r.id),
    }));
  }

  // ---- events -----------------------------------------------------------------------------------------------------------------

  async addEvent(
    tx: Tx,
    orgId: number,
    requestId: number,
    e: {
      type: string;
      from?: string | null;
      to?: string | null;
      actorUserId: number | null;
      detail?: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO privacy_request_events (org_id, request_id, event_type, from_status, to_status, actor_user_id, detail)
      VALUES (${orgId}, ${requestId}, ${e.type}, ${e.from ?? null}, ${e.to ?? null}, ${e.actorUserId},
              ${JSON.stringify(e.detail ?? {})}::jsonb)`);
  }

  async events(tx: Tx, orgId: number, requestId: number): Promise<EventRow[]> {
    const res = await tx.execute(sql`
      SELECT e.uuid, e.event_type, e.from_status, e.to_status, u.full_name AS actor_name, e.detail, e.created_at
        FROM privacy_request_events e
        LEFT JOIN users u ON u.org_id = e.org_id AND u.id = e.actor_user_id
       WHERE e.org_id = ${orgId} AND e.request_id = ${requestId} ORDER BY e.id`);
    return (res.rows as Array<Record<string, unknown>>).map((r) => ({
      uuid: r.uuid as string,
      eventType: r.event_type as string,
      fromStatus: (r.from_status as string | null) ?? null,
      toStatus: (r.to_status as string | null) ?? null,
      actorName: (r.actor_name as string | null) ?? null,
      detail: (r.detail as Record<string, unknown>) ?? {},
      createdAt: new Date(r.created_at as string),
    }));
  }

  // ---- exports ----------------------------------------------------------------------------------------------------------------

  async createExport(
    tx: Tx,
    orgId: number,
    requestId: number,
    requestedBy: number | null,
  ): Promise<ExportRow> {
    const res = await tx.execute(sql`
      INSERT INTO privacy_request_exports (org_id, request_id, requested_by) VALUES (${orgId}, ${requestId}, ${requestedBy})
      RETURNING ${EXPORT_COLS}`);
    return toExport(res.rows[0] as Record<string, unknown>);
  }

  async exportByUuid(tx: Tx, orgId: number, uuid: string): Promise<ExportRow | null> {
    const res = await tx.execute(
      sql`SELECT ${EXPORT_COLS} FROM privacy_request_exports WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    return res.rows[0] ? toExport(res.rows[0] as Record<string, unknown>) : null;
  }

  async exportsOf(tx: Tx, orgId: number, requestId: number): Promise<ExportRow[]> {
    const res = await tx.execute(sql`
      SELECT ${EXPORT_COLS} FROM privacy_request_exports WHERE org_id = ${orgId} AND request_id = ${requestId}
       ORDER BY requested_at DESC LIMIT 10`);
    return (res.rows as Array<Record<string, unknown>>).map(toExport);
  }

  async activeExport(tx: Tx, orgId: number, requestId: number): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM privacy_request_exports WHERE org_id = ${orgId} AND request_id = ${requestId} AND status IN ('queued', 'running') LIMIT 1`);
    return res.rows.length > 0;
  }

  /** queued -> running; false when another worker (or an earlier attempt) already took it. */
  async claimExport(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE privacy_request_exports SET status = 'running', started_at = now()
       WHERE org_id = ${orgId} AND id = ${id} AND status = 'queued' RETURNING id`);
    return res.rows.length > 0;
  }

  async finishExport(
    tx: Tx,
    orgId: number,
    id: number,
    v: { fileName: string; zip: Buffer; sections: Record<string, number>; expiresAt: Date },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE privacy_request_exports SET status = 'ready', file_name = ${v.fileName}, file_bytes = ${v.zip.length},
        file_zip = ${v.zip}, section_counts = ${JSON.stringify(v.sections)}::jsonb, completed_at = now(),
        expires_at = ${v.expiresAt.toISOString()}::timestamptz, error = NULL
       WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async failExport(tx: Tx, orgId: number, id: number, message: string): Promise<void> {
    await tx.execute(sql`
      UPDATE privacy_request_exports SET status = 'failed', error = ${message}, completed_at = now()
       WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async exportFile(tx: Tx, orgId: number, id: number): Promise<Buffer | null> {
    const res = await tx.execute(sql`
      SELECT file_zip FROM privacy_request_exports
       WHERE org_id = ${orgId} AND id = ${id} AND status = 'ready' AND expires_at > now() AND file_zip IS NOT NULL`);
    const row = res.rows[0] as { file_zip: Buffer | string } | undefined;
    if (!row) return null;
    return Buffer.isBuffer(row.file_zip)
      ? row.file_zip
      : Buffer.from(String(row.file_zip).replace(/^\\x/, ''), 'hex');
  }

  /** Worker sweep (privileged): drops the file of an export past its week, fails one whose worker died. */
  async expireExports(tx: Tx): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE privacy_request_exports SET status = 'expired', file_zip = NULL
       WHERE status = 'ready' AND expires_at <= now() RETURNING id`);
    return res.rows.length;
  }

  async failStuckExports(tx: Tx, olderThanMs: number): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE privacy_request_exports SET status = 'failed', error = 'The export did not finish. Request it again.', completed_at = now()
       WHERE status = 'running' AND started_at < now() - make_interval(secs => ${olderThanMs / 1000}) RETURNING id`);
    return res.rows.length;
  }

  // ---- settings ---------------------------------------------------------------------------------------------------------------

  async slaDays(tx: Tx, orgId: number): Promise<number | null> {
    const res = await tx.execute(
      sql`SELECT sla_days FROM privacy_settings WHERE org_id = ${orgId}`,
    );
    return res.rows[0] ? Number((res.rows[0] as { sla_days: number }).sla_days) : null;
  }

  async saveSla(tx: Tx, orgId: number, days: number, userId: number | null): Promise<void> {
    await tx.execute(sql`
      INSERT INTO privacy_settings (org_id, sla_days, updated_by) VALUES (${orgId}, ${days}, ${userId})
      ON CONFLICT (org_id) DO UPDATE SET sla_days = EXCLUDED.sla_days, updated_by = EXCLUDED.updated_by`);
  }

  // ---- subjects ---------------------------------------------------------------------------------------------------------------

  async contactByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{
    id: number;
    name: string | null;
    phone: string | null;
    email: string | null;
  } | null> {
    const res = await tx.execute(
      sql`SELECT id, name, phone, email::text AS email FROM contacts WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as
      | { id: number | string; name: string | null; phone: string | null; email: string | null }
      | undefined;
    return r ? { id: Number(r.id), name: r.name, phone: r.phone, email: r.email } : null;
  }

  async leadByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{
    id: number;
    name: string | null;
    phone: string | null;
    email: string | null;
  } | null> {
    const res = await tx.execute(
      sql`SELECT id, name, coalesce(phone_e164, phone) AS phone, email FROM leads WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as
      | { id: number | string; name: string | null; phone: string | null; email: string | null }
      | undefined;
    return r ? { id: Number(r.id), name: r.name, phone: r.phone, email: r.email } : null;
  }

  async searchSubjects(
    tx: Tx,
    orgId: number,
    q: string,
  ): Promise<
    Array<{
      kind: 'contact' | 'lead';
      uuid: string;
      name: string | null;
      phone: string | null;
      email: string | null;
    }>
  > {
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const digits = q.replace(/\D/g, '');
    const phoneCond =
      digits.length >= 4
        ? sql` OR regexp_replace(coalesce(normalized_phone, phone, ''), '\\D', '', 'g') LIKE ${`%${digits}%`}`
        : sql``;
    const leadPhoneCond =
      digits.length >= 4
        ? sql` OR regexp_replace(coalesce(phone_e164, phone, ''), '\\D', '', 'g') LIKE ${`%${digits}%`}`
        : sql``;
    const res = await tx.execute(sql`
      (SELECT 'contact' AS kind, uuid, name, phone, email::text AS email FROM contacts
        WHERE org_id = ${orgId} AND (name ILIKE ${like} OR email::text ILIKE ${like}${phoneCond}) ORDER BY id LIMIT 10)
      UNION ALL
      (SELECT 'lead' AS kind, uuid, name, coalesce(phone_e164, phone) AS phone, email FROM leads
        WHERE org_id = ${orgId} AND (name ILIKE ${like} OR email ILIKE ${like}${leadPhoneCond}) ORDER BY id LIMIT 5)`);
    return (res.rows as Array<Record<string, unknown>>).map((r) => ({
      kind: r.kind as 'contact' | 'lead',
      uuid: r.uuid as string,
      name: (r.name as string | null) ?? null,
      phone: (r.phone as string | null) ?? null,
      email: (r.email as string | null) ?? null,
    }));
  }

  async userUuid(tx: Tx, orgId: number, userId: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT uuid FROM users WHERE org_id = ${orgId} AND id = ${userId}`,
    );
    return res.rows[0] ? (res.rows[0] as { uuid: string }).uuid : null;
  }

  // ---- storage bridge (worker) ------------------------------------------------------------------------------------------------

  /** Moves the keys an erasure found to the platform purge queue (privileged: that queue is platform-owned). */
  async moveFilesToPurgeQueue(tx: Tx, limit: number): Promise<number> {
    const res = await tx.execute(sql`
      WITH picked AS (
        SELECT f.id, f.org_id, f.storage_key FROM privacy_erasure_files f ORDER BY f.id LIMIT ${limit} FOR UPDATE SKIP LOCKED
      ), queued AS (
        INSERT INTO storage_purge_queue (org_id, org_uuid, storage_key)
        SELECT p.org_id, o.uuid, p.storage_key FROM picked p JOIN organizations o ON o.id = p.org_id
        RETURNING 1
      ), gone AS (
        DELETE FROM privacy_erasure_files f USING picked p WHERE f.id = p.id AND f.org_id = p.org_id RETURNING 1
      )
      SELECT (SELECT count(*) FROM gone)::int AS n`);
    return Number((res.rows[0] as { n: number }).n);
  }
}
