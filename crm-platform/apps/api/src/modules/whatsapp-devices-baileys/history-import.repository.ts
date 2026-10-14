import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { RunFields } from './history-import.mapper';

export interface HistoryRunRow extends RunFields {
  id: number;
  uuid: string;
  device_id: number;
  state: string;
  mode: 'recent' | 'full';
  max_messages: number;
  max_messages_per_chat: number;
  max_chats: number;
  batches_count: number;
  last_batch_at: Date | null;
  created_at: Date;
  org_id: number;
}

const COLUMNS = sql.raw(`
  r.org_id, r.id, r.uuid, r.device_id, r.state, r.mode, r.window_days, r.max_messages, r.max_messages_per_chat, r.max_chats,
  r.chats_count, r.contacts_count, r.messages_count, r.batches_count, r.progress, r.error_code,
  r.started_at, r.last_batch_at, r.finished_at, r.created_at`);

const toRun = (x: Record<string, unknown>): HistoryRunRow => ({
  org_id: Number(x.org_id),
  id: Number(x.id),
  uuid: String(x.uuid),
  device_id: Number(x.device_id),
  state: String(x.state),
  mode: x.mode === 'full' ? 'full' : 'recent',
  window_days: Number(x.window_days),
  max_messages: Number(x.max_messages),
  max_messages_per_chat: Number(x.max_messages_per_chat),
  max_chats: Number(x.max_chats),
  chats_count: Number(x.chats_count),
  contacts_count: Number(x.contacts_count),
  messages_count: Number(x.messages_count),
  batches_count: Number(x.batches_count),
  progress: Number(x.progress),
  error_code: (x.error_code as string | null) ?? null,
  started_at: x.started_at ? new Date(x.started_at as string) : null,
  last_batch_at: x.last_batch_at ? new Date(x.last_batch_at as string) : null,
  finished_at: x.finished_at ? new Date(x.finished_at as string) : null,
  created_at: new Date(x.created_at as string),
});

export interface NewRun {
  deviceId: number;
  mode: 'recent' | 'full';
  requestedByUserId: number | null;
  windowDays: number;
  maxMessages: number;
  maxMessagesPerChat: number;
  maxChats: number;
}

/** Tenant-scoped access to history-import runs. Every method runs inside the caller's `DatabaseService` transaction. */
@Injectable()
export class HistoryImportRepository {
  async latest(tx: Tx, orgId: number, deviceId: number): Promise<HistoryRunRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM wa_device_history_imports r
       WHERE r.org_id = ${orgId} AND r.device_id = ${deviceId} ORDER BY r.id DESC LIMIT 1`);
    const row = res.rows[0] as Record<string, unknown> | undefined;
    return row ? toRun(row) : null;
  }

  /** The run that may still receive batches (idle or running), locked for the caller's update when asked. */
  async active(
    tx: Tx,
    orgId: number,
    deviceId: number,
    lock = false,
  ): Promise<HistoryRunRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM wa_device_history_imports r
       WHERE r.org_id = ${orgId} AND r.device_id = ${deviceId} AND r.state IN ('idle', 'running')
       ${lock ? sql`FOR UPDATE` : sql``}`);
    const row = res.rows[0] as Record<string, unknown> | undefined;
    return row ? toRun(row) : null;
  }

  async isActive(tx: Tx, orgId: number, runId: number): Promise<boolean> {
    const res = await tx.execute(
      sql`SELECT 1 FROM wa_device_history_imports WHERE org_id = ${orgId} AND id = ${runId} AND state IN ('idle', 'running')`,
    );
    return res.rows.length === 1;
  }

  /** Ends whatever run is active on the device as cancelled (a new request supersedes it; a disconnect ends it). */
  async cancelActive(tx: Tx, orgId: number, deviceId: number): Promise<HistoryRunRow | null> {
    const res = await tx.execute(sql`
      UPDATE wa_device_history_imports r SET state = 'cancelled', finished_at = now()
       WHERE r.org_id = ${orgId} AND r.device_id = ${deviceId} AND r.state IN ('idle', 'running')
      RETURNING ${COLUMNS}`);
    const row = res.rows[0] as Record<string, unknown> | undefined;
    return row ? toRun(row) : null;
  }

  async insert(tx: Tx, orgId: number, v: NewRun): Promise<HistoryRunRow> {
    const res = await tx.execute(sql`
      INSERT INTO wa_device_history_imports AS r
        (org_id, device_id, mode, requested_by_user_id, window_days, max_messages, max_messages_per_chat, max_chats)
      VALUES (${orgId}, ${v.deviceId}, ${v.mode}, ${v.requestedByUserId}, ${v.windowDays}, ${v.maxMessages}, ${v.maxMessagesPerChat}, ${v.maxChats})
      RETURNING ${COLUMNS}`);
    return toRun(res.rows[0] as Record<string, unknown>);
  }

  async setDeviceMode(
    tx: Tx,
    orgId: number,
    deviceId: number,
    mode: 'none' | 'recent' | 'full',
  ): Promise<void> {
    await tx.execute(
      sql`UPDATE devices SET history_import_mode = ${mode} WHERE org_id = ${orgId} AND id = ${deviceId} AND history_import_mode <> ${mode}`,
    );
  }

  /** idle -> running, once, when the first batch arrives. */
  async markRunning(tx: Tx, orgId: number, runId: number): Promise<void> {
    await tx.execute(sql`
      UPDATE wa_device_history_imports SET state = 'running', started_at = coalesce(started_at, now())
       WHERE org_id = ${orgId} AND id = ${runId} AND state = 'idle'`);
  }

  /**
   * Adds what one batch stored and moves the progress forward. Only a still-active run is touched: a cancel that landed while the batch
   * was being stored wins, and the totals keep what was really stored. Returns false when the run is no longer active.
   */
  async addBatch(
    tx: Tx,
    orgId: number,
    runId: number,
    d: { chats: number; contacts: number; messages: number; progress: number | null },
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE wa_device_history_imports SET
        chats_count = chats_count + ${d.chats}, contacts_count = contacts_count + ${d.contacts},
        messages_count = messages_count + ${d.messages}, batches_count = batches_count + 1,
        progress = GREATEST(progress, ${d.progress ?? 0}), last_batch_at = now()
       WHERE org_id = ${orgId} AND id = ${runId} AND state IN ('idle', 'running')
      RETURNING id`);
    return res.rows.length === 1;
  }

  /** Ends an active run in a final state and gives the device its normal socket back. Returns the row, or null when it was not active. */
  async finish(
    tx: Tx,
    orgId: number,
    runId: number,
    state: 'done' | 'failed' | 'cancelled' | 'limit_reached',
    errorCode: string | null,
  ): Promise<HistoryRunRow | null> {
    const res = await tx.execute(sql`
      UPDATE wa_device_history_imports r SET state = ${state}, error_code = ${errorCode}, finished_at = now(),
             progress = CASE WHEN ${state} = 'done' AND ${errorCode}::text IS NULL THEN 100 ELSE progress END
       WHERE r.org_id = ${orgId} AND r.id = ${runId} AND r.state IN ('idle', 'running')
      RETURNING ${COLUMNS}`);
    const row = res.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const run = toRun(row);
    await this.setDeviceMode(tx, orgId, run.device_id, 'none');
    return run;
  }

  /** For the sweep (privileged, every workspace): runs that went quiet, and runs whose history never came. */
  async dueForSweep(
    tx: Tx,
    idleSeconds: number,
    awaitMinutes: number,
  ): Promise<{ quiet: HistoryRunRow[]; stale: HistoryRunRow[] }> {
    const quiet = await tx.execute(sql`
      SELECT ${COLUMNS} FROM wa_device_history_imports r
       WHERE r.state = 'running' AND r.last_batch_at < now() - make_interval(secs => ${idleSeconds}) LIMIT 100`);
    const stale = await tx.execute(sql`
      SELECT ${COLUMNS} FROM wa_device_history_imports r
       WHERE r.state = 'idle' AND r.created_at < now() - make_interval(mins => ${awaitMinutes}) LIMIT 100`);
    return {
      quiet: (quiet.rows as Array<Record<string, unknown>>).map(toRun),
      stale: (stale.rows as Array<Record<string, unknown>>).map(toRun),
    };
  }

  /** The inbox channel's thread count and device facts the sink needs, in one read. */
  async deviceFacts(
    tx: Tx,
    orgId: number,
    deviceId: number,
  ): Promise<{
    uuid: string;
    name: string;
    countryCode: string | null;
    phone: string;
    mode: string;
  } | null> {
    const res = await tx.execute(sql`
      SELECT uuid, device_name, country_code, phone_number, history_import_mode
        FROM devices WHERE org_id = ${orgId} AND id = ${deviceId}`);
    const r = res.rows[0] as
      | {
          uuid: string;
          device_name: string;
          country_code: string | null;
          phone_number: string;
          history_import_mode: string;
        }
      | undefined;
    return r
      ? {
          uuid: r.uuid,
          name: r.device_name,
          countryCode: r.country_code,
          phone: r.phone_number,
          mode: r.history_import_mode,
        }
      : null;
  }
}
