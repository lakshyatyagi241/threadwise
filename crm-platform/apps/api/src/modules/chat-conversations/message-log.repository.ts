import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { MessageLogExportStatus, MessageStatus } from '@crm/contracts';
import type { Tx } from '@crm/db';
import type { ExportMessageInfo, StoredEvent } from './message-log-rules';

/**
 * SQL of the message log beyond the live event table (which `MessagesRepository` owns): the archive of old events, the export rows, and
 * the lookups an export needs to put a recipient and a template name next to each event. Every method takes the transaction it runs in
 * and names `org_id` itself, except the sweeps, which run privileged across workspaces and say so.
 */

type Raw = Record<string, unknown>;
const rowsOf = (res: { rows: unknown[] }): Raw[] => res.rows as Raw[];

export interface ExportRow {
  id: number;
  uuid: string;
  orgId: number;
  requestedBy: number;
  emailedTo: string | null;
  rangeFrom: string;
  rangeTo: string;
  messageStatus: MessageStatus | null;
  status: MessageLogExportStatus;
  rowCount: number | null;
  fileName: string | null;
  fileBytes: number | null;
  error: string | null;
  requestedAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
}

const toExport = (r: Raw): ExportRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  orgId: Number(r.org_id),
  requestedBy: Number(r.requested_by),
  emailedTo: (r.emailed_to as string | null) ?? null,
  rangeFrom: r.range_from as string,
  rangeTo: r.range_to as string,
  messageStatus: (r.message_status as MessageStatus | null) ?? null,
  status: r.status as MessageLogExportStatus,
  rowCount: r.row_count === null ? null : Number(r.row_count),
  fileName: (r.file_name as string | null) ?? null,
  fileBytes: r.file_bytes === null ? null : Number(r.file_bytes),
  error: (r.error as string | null) ?? null,
  requestedAt: new Date(r.requested_at as string),
  completedAt: r.completed_at ? new Date(r.completed_at as string) : null,
  expiresAt: r.expires_at ? new Date(r.expires_at as string) : null,
});

const EXPORT_COLUMNS =
  sql.raw(`id, uuid, org_id, requested_by, emailed_to, range_from::text AS range_from,
  range_to::text AS range_to, message_status, status, row_count, file_name, file_bytes, error, requested_at, completed_at, expires_at`);

/** One event of the live table, with what an export needs to find its message. */
export interface LiveEvent extends StoredEvent {
  id: number;
  messageId: number;
  messageCreatedAt: string;
}

@Injectable()
export class MessageLogRepository {
  // --- archive: read -----------------------------------------------------------------------------------------------------------

  /** The archived objects of a workspace for days `from..to` (inclusive, `YYYY-MM-DD`), oldest first. */
  async archivesBetween(
    tx: Tx,
    orgId: number,
    from: string,
    to: string,
  ): Promise<Array<{ day: string; payload: Buffer }>> {
    const res = await tx.execute(sql`
      SELECT day::text AS day, payload_gz FROM message_event_archives
      WHERE org_id = ${orgId} AND day >= ${from}::date AND day <= ${to}::date ORDER BY day`);
    return rowsOf(res).map((r) => ({ day: r.day as string, payload: r.payload_gz as Buffer }));
  }

  // --- live table: export read -------------------------------------------------------------------------------------------------

  /** A page of the live events in `[from, to)` after the keyset `(afterAt, afterId)`, oldest first. */
  async liveEventsPage(
    tx: Tx,
    orgId: number,
    from: Date,
    to: Date,
    after: { at: string; id: number } | null,
    limit: number,
  ): Promise<Array<LiveEvent & { atText: string }>> {
    const res = await tx.execute(sql`
      SELECT id, message_id, message_created_at::text AS message_created_at, event, detail, created_at, created_at::text AS at_text
      FROM message_events
      WHERE org_id = ${orgId} AND created_at >= ${from} AND created_at < ${to}
        ${after ? sql`AND (created_at, id) > (${after.at}::timestamptz, ${after.id})` : sql``}
      ORDER BY created_at, id LIMIT ${limit}`);
    return rowsOf(res).map((r) => ({
      id: Number(r.id),
      messageId: Number(r.message_id),
      messageCreatedAt: r.message_created_at as string,
      event: r.event as string,
      detail: (r.detail as Record<string, unknown>) ?? {},
      at: new Date(r.created_at as string),
      atText: r.at_text as string,
    }));
  }

  /**
   * What an export shows next to each event: the message's uuid, status and kind, the recipient, the channel and the template's name.
   * Keyed `"<id>|<created_at>"`. A message that no longer exists has no entry (its columns stay blank).
   */
  async messageInfos(
    tx: Tx,
    orgId: number,
    refs: Array<{ messageId: number; messageCreatedAt: string }>,
  ): Promise<Map<string, ExportMessageInfo>> {
    const out = new Map<string, ExportMessageInfo>();
    if (refs.length === 0) return out;
    const keys = JSON.stringify(refs.map((r) => ({ id: r.messageId, ts: r.messageCreatedAt })));
    const res = await tx.execute(sql`
      SELECT m.id, m.created_at::text AS created_at, m.uuid, m.kind, m.status, c.peer_key, ch.kind AS channel_kind, t.template_name
      FROM jsonb_to_recordset(${keys}::jsonb) AS k(id bigint, ts timestamptz)
      JOIN messages m ON m.org_id = ${orgId} AND m.id = k.id AND m.created_at = k.ts
      LEFT JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
      LEFT JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      LEFT JOIN wa_templates t ON t.org_id = m.org_id AND t.id = m.template_id`);
    for (const r of rowsOf(res)) {
      out.set(`${Number(r.id)}|${r.created_at as string}`, {
        uuid: r.uuid as string,
        recipient: (r.peer_key as string | null) ?? '',
        channel: (r.channel_kind as string | null) ?? '',
        kind: r.kind as string,
        template: (r.template_name as string | null) ?? '',
        status: r.status as string,
      });
    }
    return out;
  }

  /** uuid by internal id, for the users named in `retry` events. */
  async userUuids(tx: Tx, orgId: number, ids: number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    if (ids.length === 0) return out;
    const res = await tx.execute(
      sql`SELECT id, uuid FROM users WHERE org_id = ${orgId} AND id IN (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )})`,
    );
    for (const r of rowsOf(res)) out.set(Number(r.id), r.uuid as string);
    return out;
  }

  /** Name and address of a user, for the "your export is ready" mail and the "Retried by" column. */
  async userContact(
    tx: Tx,
    orgId: number,
    userId: number,
  ): Promise<{ email: string; name: string } | null> {
    const res = await tx.execute(
      sql`SELECT email::text AS email, full_name FROM users WHERE org_id = ${orgId} AND id = ${userId}`,
    );
    const r = rowsOf(res)[0];
    return r ? { email: r.email as string, name: r.full_name as string } : null;
  }

  async userNames(tx: Tx, orgId: number, ids: number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    if (ids.length === 0) return out;
    const res = await tx.execute(
      sql`SELECT id, full_name FROM users WHERE org_id = ${orgId} AND id IN (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )})`,
    );
    for (const r of rowsOf(res)) out.set(Number(r.id), r.full_name as string);
    return out;
  }

  // --- the archive sweep (privileged, every workspace) ------------------------------------------------------------------------

  /** The oldest event time before `cutoff` that is still in the live table; null when nothing is due. */
  async oldestDue(tx: Tx, cutoff: Date): Promise<Date | null> {
    const res = await tx.execute(
      sql`SELECT min(created_at) AS at FROM message_events WHERE created_at < ${cutoff}`,
    );
    const at = rowsOf(res)[0]?.at;
    return at ? new Date(at as string) : null;
  }

  /** The workspaces that have events in `[from, to)`. */
  async orgsWithEvents(tx: Tx, from: Date, to: Date): Promise<number[]> {
    const res = await tx.execute(
      sql`SELECT DISTINCT org_id FROM message_events WHERE created_at >= ${from} AND created_at < ${to} ORDER BY org_id`,
    );
    return rowsOf(res).map((r) => Number(r.org_id));
  }

  /** The next batch of one workspace's events in `[from, to)` after id `afterId`, as archive lines. */
  async dueBatch(
    tx: Tx,
    orgId: number,
    from: Date,
    to: Date,
    afterId: number,
    limit: number,
  ): Promise<Array<{ id: number; line: Record<string, unknown> }>> {
    const res = await tx.execute(sql`
      SELECT id, message_id, message_created_at::text AS message_created_at, event, detail, created_at FROM message_events
      WHERE org_id = ${orgId} AND created_at >= ${from} AND created_at < ${to} AND id > ${afterId}
      ORDER BY id LIMIT ${limit}`);
    return rowsOf(res).map((r) => ({
      id: Number(r.id),
      line: {
        id: Number(r.id),
        messageId: Number(r.message_id),
        // The database's own text, microseconds included: it is the key that finds the message again (see `MessagesRepository`).
        messageCreatedAt: r.message_created_at as string,
        event: r.event,
        detail: r.detail ?? {},
        at: new Date(r.created_at as string).toISOString(),
      },
    }));
  }

  /**
   * Stores one more gzip member for the workspace's day. A day swept twice (a crash after the insert is impossible, the delete is in the
   * same transaction; a stray late event is possible) appends instead of overwriting: gzip members concatenate.
   */
  async appendArchive(
    tx: Tx,
    orgId: number,
    day: string,
    count: number,
    payload: Buffer,
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO message_event_archives (org_id, day, event_count, payload_gz)
      VALUES (${orgId}, ${day}::date, ${count}, ${payload})
      ON CONFLICT (org_id, day) DO UPDATE SET
        event_count = message_event_archives.event_count + EXCLUDED.event_count,
        payload_gz = message_event_archives.payload_gz || EXCLUDED.payload_gz`);
  }

  /** Deletes the events that were just archived (those up to `maxId`). Returns how many went. */
  async deleteArchived(
    tx: Tx,
    orgId: number,
    from: Date,
    to: Date,
    maxId: number,
  ): Promise<number> {
    const res = await tx.execute(sql`
      DELETE FROM message_events
      WHERE org_id = ${orgId} AND created_at >= ${from} AND created_at < ${to} AND id <= ${maxId}
      RETURNING 1`);
    return rowsOf(res).length;
  }

  /** Deletes archive days before `cutoffDay`, at most `limit` at a time. */
  async purgeArchives(tx: Tx, cutoffDay: string, limit: number): Promise<number> {
    const res = await tx.execute(sql`
      DELETE FROM message_event_archives WHERE (org_id, id) IN (
        SELECT org_id, id FROM message_event_archives WHERE day < ${cutoffDay}::date LIMIT ${limit})
      RETURNING 1`);
    return rowsOf(res).length;
  }

  /** Drops the file of every export past its time and marks it `expired`. */
  async expireExports(tx: Tx, now: Date): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE message_log_exports SET status = 'expired', file_gz = NULL
      WHERE status = 'ready' AND expires_at < ${now} RETURNING 1`);
    return rowsOf(res).length;
  }

  /** Marks an export that has been `running` for more than `olderThanMs` as failed: its worker died. */
  async failStuckExports(tx: Tx, now: Date, olderThanMs: number): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE message_log_exports SET status = 'failed', error = 'The export was interrupted. Request it again.'
      WHERE status = 'running' AND started_at < ${new Date(now.getTime() - olderThanMs)} RETURNING 1`);
    return rowsOf(res).length;
  }

  // --- exports -------------------------------------------------------------------------------------------------------------------

  async createExport(
    tx: Tx,
    orgId: number,
    input: {
      requestedBy: number;
      emailedTo: string | null;
      from: string;
      to: string;
      messageStatus: MessageStatus | null;
    },
  ): Promise<ExportRow> {
    const res = await tx.execute(sql`
      INSERT INTO message_log_exports (org_id, requested_by, emailed_to, range_from, range_to, message_status)
      VALUES (${orgId}, ${input.requestedBy}, ${input.emailedTo}, ${input.from}::date, ${input.to}::date, ${input.messageStatus})
      RETURNING ${EXPORT_COLUMNS}`);
    return toExport(rowsOf(res)[0]!);
  }

  async activeExport(tx: Tx, orgId: number): Promise<ExportRow | null> {
    const res = await tx.execute(sql`
      SELECT ${EXPORT_COLUMNS} FROM message_log_exports
      WHERE org_id = ${orgId} AND status IN ('queued', 'running') LIMIT 1`);
    const r = rowsOf(res)[0];
    return r ? toExport(r) : null;
  }

  async listExports(tx: Tx, orgId: number, limit: number): Promise<ExportRow[]> {
    const res = await tx.execute(sql`
      SELECT ${EXPORT_COLUMNS} FROM message_log_exports WHERE org_id = ${orgId}
      ORDER BY requested_at DESC, id DESC LIMIT ${limit}`);
    return rowsOf(res).map(toExport);
  }

  async exportByUuid(tx: Tx, orgId: number, uuid: string): Promise<ExportRow | null> {
    const res = await tx.execute(sql`
      SELECT ${EXPORT_COLUMNS} FROM message_log_exports WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`);
    const r = rowsOf(res)[0];
    return r ? toExport(r) : null;
  }

  /** queued -> running. False when another worker has it or it is no longer queued. */
  async claimExport(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE message_log_exports SET status = 'running', started_at = now(), error = NULL
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'queued' RETURNING 1`);
    return rowsOf(res).length > 0;
  }

  async finishExport(
    tx: Tx,
    orgId: number,
    id: number,
    f: { fileName: string; file: Buffer; rowCount: number; expiresAt: Date },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE message_log_exports SET status = 'ready', file_name = ${f.fileName}, file_gz = ${f.file}, file_bytes = ${f.file.length},
        row_count = ${f.rowCount}, completed_at = now(), expires_at = ${f.expiresAt}, error = NULL
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'running'`);
  }

  async failExport(tx: Tx, orgId: number, id: number, error: string): Promise<void> {
    await tx.execute(sql`
      UPDATE message_log_exports SET status = 'failed', error = ${error.slice(0, 500)}, completed_at = now()
      WHERE org_id = ${orgId} AND id = ${id} AND status IN ('queued', 'running')`);
  }

  async exportFile(tx: Tx, orgId: number, id: number): Promise<Buffer | null> {
    const res = await tx.execute(
      sql`SELECT file_gz FROM message_log_exports WHERE org_id = ${orgId} AND id = ${id} AND status = 'ready'`,
    );
    return (rowsOf(res)[0]?.file_gz as Buffer | undefined) ?? null;
  }
}
