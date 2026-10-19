import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { ActivityOptionRef, CallEntrySource, CallOutcome } from '@crm/contracts';
import { optionRefColumns, optionRefFrom } from '../../crm/activity-types/activity-option-ref';

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (res as { rows: Row[] }).rows;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** One call log entry with the names its answer needs. Ids ending in `Id` are internal; the mapper only hands out the uuids. */
export interface EntryRow {
  id: number;
  uuid: string;
  source: CallEntrySource;
  direction: 'inbound' | 'outbound';
  outcome: CallOutcome;
  /** The outcome as the Phone activity lists it (null on an entry logged before the lists existed or by a source that only knows the built-in outcome). */
  outcomeOption: ActivityOptionRef | null;
  outcomeOptionId: number | null;
  startedAt: Date;
  durationSec: number;
  contactId: number | null;
  contactUuid: string | null;
  contactName: string | null;
  customerPhone: string | null;
  ourPhone: string | null;
  numberLabel: string | null;
  handlerUserId: number | null;
  handlerUuid: string | null;
  handlerName: string | null;
  notes: string | null;
  externalId: string | null;
  hasRecordingRef: boolean;
  /** A telephony provider reported it (a record of what happened, not a note a person typed). */
  viaConnection: boolean;
  followUpTaskId: number | null;
  followUpTaskUuid: string | null;
  activityId: number | null;
  createdBy: number | null;
  createdByUuid: string | null;
  createdAt: Date;
  updatedAt: Date;
  rowVersion: number;
}

const toEntry = (r: Row): EntryRow => ({
  id: Number(r.id),
  uuid: String(r.uuid),
  source: r.source as CallEntrySource,
  direction: r.direction as 'inbound' | 'outbound',
  outcome: r.outcome as CallOutcome,
  outcomeOption: optionRefFrom(r, 'outcome_opt'),
  outcomeOptionId: num(r.outcome_option_id),
  startedAt: new Date(r.started_at as string),
  durationSec: Number(r.duration_sec),
  contactId: num(r.contact_id),
  contactUuid: str(r.contact_uuid),
  contactName: str(r.contact_name),
  customerPhone: str(r.customer_phone),
  ourPhone: str(r.our_phone),
  numberLabel: str(r.number_label),
  handlerUserId: num(r.handler_user_id),
  handlerUuid: str(r.handler_uuid),
  handlerName: str(r.handler_name),
  notes: str(r.notes),
  externalId: str(r.external_id),
  hasRecordingRef: r.recording_ref !== null && r.recording_ref !== undefined,
  viaConnection: r.via_connection === true,
  followUpTaskId: num(r.follow_up_task_id),
  followUpTaskUuid: str(r.task_uuid),
  activityId: num(r.activity_id),
  createdBy: num(r.created_by),
  createdByUuid: str(r.created_by_uuid),
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  rowVersion: Number(r.row_version),
});

const SELECT = sql`SELECT e.id, e.uuid, e.source, e.direction, e.outcome, e.started_at, e.duration_sec, e.contact_id, ct.uuid AS contact_uuid,
    coalesce(ct.name, ct.first_name) AS contact_name, e.customer_phone, e.our_phone, e.number_label, e.handler_user_id,
    hu.uuid AS handler_uuid, hu.full_name AS handler_name, e.notes, e.external_id, e.recording_ref, (e.telephony_connection_id IS NOT NULL) AS via_connection, e.follow_up_task_id, e.outcome_option_id,
    ${optionRefColumns('oo', 'oa', 'outcome_opt')},
    tk.uuid AS task_uuid, e.activity_id, e.created_by, cu.uuid AS created_by_uuid, e.created_at, e.updated_at, e.row_version
  FROM call_log_entries e
  LEFT JOIN contacts ct ON ct.org_id = e.org_id AND ct.id = e.contact_id
  LEFT JOIN users hu ON hu.org_id = e.org_id AND hu.id = e.handler_user_id
  LEFT JOIN users cu ON cu.org_id = e.org_id AND cu.id = e.created_by
  LEFT JOIN tasks tk ON tk.org_id = e.org_id AND tk.id = e.follow_up_task_id
  LEFT JOIN activity_type_options oo ON oo.org_id = e.org_id AND oo.id = e.outcome_option_id
  LEFT JOIN activity_types oa ON oa.org_id = oo.org_id AND oa.id = oo.activity_type_id`;

export interface NewEntry {
  source: CallEntrySource;
  direction: 'inbound' | 'outbound';
  outcome: CallOutcome;
  /** A current outcome of the Phone activity this entry was logged with; `outcome` is what it counts as. */
  outcomeOptionId?: number | null;
  startedAt: Date;
  durationSec: number;
  contactId: number | null;
  customerPhone: string | null;
  ourPhone: string | null;
  numberLabel: string | null;
  handlerUserId: number | null;
  notes: string | null;
  externalId: string | null;
  telephonyConnectionId: number | null;
  recording: { ref: string; method: string; noticeVersion: number } | null;
  createdBy: number | null;
}

export interface EntryPatch {
  outcome?: CallOutcome;
  /** `null` clears it (the outcome was changed to a built-in one without naming a list item). */
  outcomeOptionId?: number | null;
  direction?: 'inbound' | 'outbound';
  startedAt?: Date;
  durationSec?: number;
  notes?: string | null;
}

export interface LifecycleStage {
  value: string;
  label: string | null;
  isWon: boolean;
  isLost: boolean;
}

/** SQL of the call log entries. Every method runs in the caller's transaction; the workspace is `orgId` and RLS backs it. */
@Injectable()
export class CallLogEntriesRepository {
  /** Inserts the entry; null when (source, external id) already has one (the same report again). */
  async insert(tx: Tx, orgId: number, e: NewEntry): Promise<{ id: number; uuid: string } | null> {
    const res = await tx.execute(sql`
      INSERT INTO call_log_entries (org_id, source, direction, outcome, started_at, duration_sec, contact_id, customer_phone, our_phone,
                                    number_label, handler_user_id, notes, external_id, telephony_connection_id, recording_ref,
                                    recording_stored_at, recording_consent_status, recording_consent_method, recording_notice_version,
                                    created_by, outcome_option_id)
      VALUES (${orgId}, ${e.source}, ${e.direction}, ${e.outcome}, ${e.startedAt.toISOString()}::timestamptz, ${e.durationSec},
              ${e.contactId}, ${e.customerPhone}, ${e.ourPhone}, ${e.numberLabel}, ${e.handlerUserId}, ${e.notes}, ${e.externalId},
              ${e.telephonyConnectionId}, ${e.recording?.ref ?? null}, ${e.recording ? sql`now()` : null},
              ${e.recording ? 'granted' : null}, ${e.recording?.method ?? null}, ${e.recording?.noticeVersion ?? null}, ${e.createdBy}, ${e.outcomeOptionId ?? null})
      ON CONFLICT (org_id, source, external_id) DO NOTHING
      RETURNING id, uuid`);
    const r = rowsOf(res)[0];
    return r ? { id: Number(r.id), uuid: String(r.uuid) } : null;
  }

  async byExternal(
    tx: Tx,
    orgId: number,
    source: CallEntrySource,
    externalId: string,
  ): Promise<EntryRow | undefined> {
    const res = await tx.execute(sql`
      ${SELECT} WHERE e.org_id = ${orgId} AND e.source = ${source} AND e.external_id = ${externalId}`);
    const r = rowsOf(res)[0];
    return r ? toEntry(r) : undefined;
  }

  async byId(tx: Tx, orgId: number, id: number): Promise<EntryRow | undefined> {
    const res = await tx.execute(sql`${SELECT} WHERE e.org_id = ${orgId} AND e.id = ${id}`);
    const r = rowsOf(res)[0];
    return r ? toEntry(r) : undefined;
  }

  /** By uuid; `lock` takes the row for update (an edit or a delete reads, decides and writes under it). */
  async byUuid(tx: Tx, orgId: number, uuid: string, lock = false): Promise<EntryRow | undefined> {
    if (lock) {
      // FOR UPDATE cannot sit on the outer joins of SELECT, so the row is locked on its own first.
      const held = await tx.execute(sql`
        SELECT id FROM call_log_entries WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid FOR UPDATE`);
      if (rowsOf(held).length === 0) return undefined;
    }
    const res = await tx.execute(
      sql`${SELECT} WHERE e.org_id = ${orgId} AND e.uuid = ${uuid}::uuid`,
    );
    const r = rowsOf(res)[0];
    return r ? toEntry(r) : undefined;
  }

  /** The line and the task the entry made, once they exist. */
  async link(
    tx: Tx,
    orgId: number,
    id: number,
    links: { activityId?: number | null; followUpTaskId?: number | null },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE call_log_entries
      SET activity_id = coalesce(${links.activityId ?? null}::bigint, activity_id),
          follow_up_task_id = coalesce(${links.followUpTaskId ?? null}::bigint, follow_up_task_id)
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** Writes the fields of an edit; false when the row changed under it (a stale `rowVersion`). */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    rowVersion: number,
    p: EntryPatch,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE call_log_entries
      SET outcome = ${p.outcome ?? sql`outcome`},
          outcome_option_id = ${p.outcomeOptionId === undefined ? sql`outcome_option_id` : p.outcomeOptionId},
          direction = ${p.direction ?? sql`direction`},
          started_at = ${p.startedAt ? sql`${p.startedAt.toISOString()}::timestamptz` : sql`started_at`},
          duration_sec = ${p.durationSec ?? sql`duration_sec`},
          notes = ${p.notes === undefined ? sql`notes` : p.notes}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${rowVersion}
      RETURNING id`);
    return rowsOf(res).length === 1;
  }

  async remove(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM call_log_entries WHERE org_id = ${orgId} AND id = ${id}`);
  }

  // --- contacts and people -----------------------------------------------------------------------------------------------------

  /**
   * The contact that owns a phone: an identity first, then the stored number (the same two reads `resolveOrCreateByIdentity` makes,
   * without ever creating). `viewerScopeSql` limits the match to contacts a person may read; null reads any (a system report).
   */
  async contactByPhone(
    tx: Tx,
    orgId: number,
    e164: string,
    digits: string,
  ): Promise<{ id: number; uuid: string; ownerId: number | null } | null> {
    const res = await tx.execute(sql`
      SELECT c.id, c.uuid, c.owner_id
      FROM contacts c
      WHERE c.org_id = ${orgId}
        AND (c.id IN (SELECT i.contact_id FROM contact_identities i WHERE i.org_id = ${orgId} AND i.kind = 'phone' AND i.value = ${e164})
             OR c.normalized_phone IN (${e164}, ${digits}))
      ORDER BY c.id
      LIMIT 1`);
    const r = rowsOf(res)[0];
    return r ? { id: Number(r.id), uuid: String(r.uuid), ownerId: num(r.owner_id) } : null;
  }

  /** A contact's own phone as stored, for an entry logged against a contact with no number typed. */
  async contactPhone(tx: Tx, orgId: number, contactId: number): Promise<string | null> {
    const res = await tx.execute(sql`
      SELECT coalesce(normalized_phone, phone) AS phone FROM contacts WHERE org_id = ${orgId} AND id = ${contactId}`);
    return str(rowsOf(res)[0]?.phone);
  }

  async userName(tx: Tx, orgId: number, userId: number): Promise<string | null> {
    const res = await tx.execute(sql`
      SELECT full_name FROM users WHERE org_id = ${orgId} AND id = ${userId}`);
    return str(rowsOf(res)[0]?.full_name);
  }

  /** The number on a person's profile, to ring first in a click-to-call. */
  async userPhone(tx: Tx, orgId: number, userId: number): Promise<string | null> {
    const res = await tx.execute(sql`
      SELECT phone_e164 FROM user_profiles WHERE org_id = ${orgId} AND user_id = ${userId}`);
    return str(rowsOf(res)[0]?.phone_e164);
  }

  async taskId(tx: Tx, orgId: number, uuid: string): Promise<number | null> {
    const res = await tx.execute(
      sql`SELECT id FROM tasks WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    return num(rowsOf(res)[0]?.id);
  }

  // --- the lifecycle nudge -----------------------------------------------------------------------------------------------------

  /** The workspace's active lifecycle stages in their order. */
  async lifecycleStages(tx: Tx, orgId: number): Promise<LifecycleStage[]> {
    const res = await tx.execute(sql`
      SELECT value, label, coalesce(is_won, false) AS is_won, coalesce(is_lost, false) AS is_lost
      FROM status_options
      WHERE org_id = ${orgId} AND module_key = 'contacts' AND option_group = 'lifecycle_stage' AND is_active
      ORDER BY position, id`);
    return rowsOf(res).map((r) => ({
      value: String(r.value),
      label: str(r.label),
      isWon: r.is_won === true,
      isLost: r.is_lost === true,
    }));
  }

  async contactStage(tx: Tx, orgId: number, contactId: number): Promise<string | null> {
    const res = await tx.execute(sql`
      SELECT lifecycle_stage FROM contacts WHERE org_id = ${orgId} AND id = ${contactId}`);
    return str(rowsOf(res)[0]?.lifecycle_stage);
  }
}
