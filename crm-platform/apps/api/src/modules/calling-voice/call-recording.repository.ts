import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type {
  CallRecordingConsentMethod,
  CallRecordingConsentMode,
  CallRecordingDeleteReason,
} from '@crm/contracts';

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (res as { rows: Row[] }).rows;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

export interface RecordingSettingsRow {
  enabled: boolean;
  consentMode: CallRecordingConsentMode;
  retentionDays: number;
  noticeText: string | null;
  noticeVersion: number;
  rowVersion: number;
  updatedAt: string | null;
}

/** What a call row says about its recording: the evidence, the clock, the hold. Read by the gate, the upload and the log. */
export interface RecordingState {
  id: number;
  uuid: string;
  status: string;
  direction: string;
  contactId: number | null;
  customerPhone: string;
  recordingPath: string | null;
  consentStatus: 'granted' | 'declined' | null;
  consentMethod: CallRecordingConsentMethod | null;
  consentAt: string | null;
  noticeVersion: number | null;
  noticeSha256: string | null;
  storedAt: string | null;
  legalHold: boolean;
  holdReason: string | null;
  deletedAt: string | null;
  deletedReason: CallRecordingDeleteReason | null;
}

const toState = (r: Row): RecordingState => {
  const inbound = r.direction === 'USER_INITIATED';
  return {
    id: Number(r.id),
    uuid: String(r.uuid),
    status: String(r.status),
    direction: String(r.direction),
    contactId: num(r.contact_id),
    customerPhone: String((inbound ? r.from_phone : r.to_phone) ?? ''),
    recordingPath: (r.recording_path as string | null) ?? null,
    consentStatus: (r.recording_consent_status as RecordingState['consentStatus']) ?? null,
    consentMethod: (r.recording_consent_method as CallRecordingConsentMethod | null) ?? null,
    consentAt: iso(r.recording_consent_at),
    noticeVersion: num(r.recording_notice_version),
    noticeSha256: (r.recording_notice_sha256 as string | null) ?? null,
    storedAt: iso(r.recording_stored_at),
    legalHold: r.recording_legal_hold === true,
    holdReason: (r.recording_hold_reason as string | null) ?? null,
    deletedAt: iso(r.recording_deleted_at),
    deletedReason: (r.recording_deleted_reason as CallRecordingDeleteReason | null) ?? null,
  };
};

const STATE_COLS = sql`id, uuid, status, direction, contact_id, from_phone, to_phone, recording_path, recording_consent_status,
  recording_consent_method, recording_consent_at, recording_notice_version, recording_notice_sha256, recording_stored_at,
  recording_legal_hold, recording_hold_reason, recording_deleted_at, recording_deleted_reason`;

/** SQL of call recording consent and lifecycle (BL-144). Every method runs in the caller's transaction. */
@Injectable()
export class CallRecordingRepository {
  // --- the workspace's rules ----------------------------------------------------------------------------------------------

  async getSettings(tx: Tx, orgId: number): Promise<RecordingSettingsRow | null> {
    const res = await tx.execute(sql`
      SELECT enabled, consent_mode, retention_days, notice_text, notice_version, row_version, updated_at
      FROM call_recording_settings WHERE org_id = ${orgId}`);
    const r = rowsOf(res)[0];
    if (!r) return null;
    return {
      enabled: r.enabled === true,
      consentMode: r.consent_mode as CallRecordingConsentMode,
      retentionDays: Number(r.retention_days),
      noticeText: (r.notice_text as string | null) ?? null,
      noticeVersion: Number(r.notice_version),
      rowVersion: Number(r.row_version),
      updatedAt: iso(r.updated_at),
    };
  }

  /** First save inserts (no version); later saves need the version they read. False on a conflict. */
  async saveSettings(
    tx: Tx,
    orgId: number,
    v: Pick<
      RecordingSettingsRow,
      'enabled' | 'consentMode' | 'retentionDays' | 'noticeText' | 'noticeVersion'
    >,
    userId: number | null,
    rowVersion: number | undefined,
  ): Promise<boolean> {
    if (rowVersion === undefined) {
      const res = await tx.execute(sql`
        INSERT INTO call_recording_settings (org_id, enabled, consent_mode, retention_days, notice_text, notice_version, updated_by)
        VALUES (${orgId}, ${v.enabled}, ${v.consentMode}, ${v.retentionDays}, ${v.noticeText}, ${v.noticeVersion}, ${userId})
        ON CONFLICT (org_id) DO NOTHING RETURNING org_id`);
      return rowsOf(res).length > 0;
    }
    const res = await tx.execute(sql`
      UPDATE call_recording_settings
      SET enabled = ${v.enabled}, consent_mode = ${v.consentMode}, retention_days = ${v.retentionDays},
          notice_text = ${v.noticeText}, notice_version = ${v.noticeVersion}, updated_by = ${userId}
      WHERE org_id = ${orgId} AND row_version = ${rowVersion} RETURNING org_id`);
    return rowsOf(res).length > 0;
  }

  async addNoticeVersion(
    tx: Tx,
    orgId: number,
    version: number,
    body: string,
    sha256: string,
    userId: number | null,
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO call_recording_notice_versions (org_id, version, body, sha256, created_by)
      VALUES (${orgId}, ${version}, ${body}, ${sha256}, ${userId})`);
  }

  async noticeSha(tx: Tx, orgId: number, version: number): Promise<string | null> {
    const res = await tx.execute(sql`
      SELECT sha256 FROM call_recording_notice_versions WHERE org_id = ${orgId} AND version = ${version}`);
    return (rowsOf(res)[0]?.sha256 as string | undefined) ?? null;
  }

  // --- one call -----------------------------------------------------------------------------------------------------------

  async stateByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    forUpdate = false,
  ): Promise<RecordingState | null> {
    const base = sql`SELECT ${STATE_COLS} FROM wa_calls WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`;
    const res = await tx.execute(forUpdate ? sql`${base} FOR UPDATE` : base);
    const r = rowsOf(res)[0];
    return r ? toState(r) : null;
  }

  async writeConsent(
    tx: Tx,
    orgId: number,
    callId: number,
    c: {
      status: 'granted' | 'declined';
      method: CallRecordingConsentMethod;
      userId: number | null;
      noticeVersion: number;
      noticeSha256: string;
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE wa_calls
      SET recording_consent_status = ${c.status}, recording_consent_method = ${c.method}, recording_consent_at = now(),
          recording_consent_by = ${c.userId}, recording_notice_version = ${c.noticeVersion}, recording_notice_sha256 = ${c.noticeSha256}
      WHERE org_id = ${orgId} AND id = ${callId}`);
  }

  /** The file is stored: the path, the retention clock, and a new file replaces any earlier removal mark. */
  async writeStored(tx: Tx, orgId: number, callId: number, key: string): Promise<void> {
    await tx.execute(sql`
      UPDATE wa_calls
      SET recording_path = ${key}, recording_stored_at = now(), recording_deleted_at = NULL, recording_deleted_reason = NULL,
          recording_started_at = coalesce(recording_started_at, now())
      WHERE org_id = ${orgId} AND id = ${callId}`);
  }

  /** The file is gone from storage: forget the path, keep the call. */
  async writeRemoved(
    tx: Tx,
    orgId: number,
    callId: number,
    reason: CallRecordingDeleteReason,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE wa_calls
      SET recording_path = NULL, recording_deleted_at = now(), recording_deleted_reason = ${reason}
      WHERE org_id = ${orgId} AND id = ${callId}`);
  }

  async writeHold(
    tx: Tx,
    orgId: number,
    callId: number,
    hold: boolean,
    reason: string | null,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE wa_calls SET recording_legal_hold = ${hold}, recording_hold_reason = ${hold ? reason : null}
      WHERE org_id = ${orgId} AND id = ${callId}`);
  }

  // --- the retention sweep (all workspaces; runs privileged) ---------------------------------------------------------------

  /** A recording stored without a clock (written by something other than the upload) starts its window when the sweep first sees it. */
  async stampUnclocked(tx: Tx): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE wa_calls SET recording_stored_at = now()
      WHERE recording_path IS NOT NULL AND recording_stored_at IS NULL RETURNING id`);
    return rowsOf(res).length;
  }

  /** Recordings older than their workspace's window (90 days when the workspace never chose one), not on hold, oldest first. */
  async expired(
    tx: Tx,
    now: Date,
    limit: number,
    defaultDays: number,
  ): Promise<Array<{ orgId: number; id: number; key: string }>> {
    const res = await tx.execute(sql`
      SELECT w.org_id, w.id, w.recording_path
      FROM wa_calls w
      LEFT JOIN call_recording_settings s ON s.org_id = w.org_id
      WHERE w.recording_path IS NOT NULL AND NOT w.recording_legal_hold
        AND w.recording_stored_at < ${now.toISOString()}::timestamptz - make_interval(days => coalesce(s.retention_days, ${defaultDays}))
      ORDER BY w.recording_stored_at, w.id
      LIMIT ${limit}`);
    return rowsOf(res).map((r) => ({
      orgId: Number(r.org_id),
      id: Number(r.id),
      key: String(r.recording_path),
    }));
  }

  /**
   * Locks one recording the sweep means to remove and checks it again under the lock: still stored under the same key, not held, still
   * past its window. A hold placed, a recording replaced or a window lengthened since the sweep read the list makes this return false and the
   * recording is left alone; a hold placed after this lock waits for the sweep's transaction.
   */
  async lockExpired(
    tx: Tx,
    orgId: number,
    callId: number,
    key: string,
    now: Date,
    defaultDays: number,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT w.id
      FROM wa_calls w
      LEFT JOIN call_recording_settings s ON s.org_id = w.org_id
      WHERE w.org_id = ${orgId} AND w.id = ${callId} AND w.recording_path = ${key} AND NOT w.recording_legal_hold
        AND w.recording_stored_at < ${now.toISOString()}::timestamptz - make_interval(days => coalesce(s.retention_days, ${defaultDays}))
      FOR UPDATE OF w SKIP LOCKED`);
    return rowsOf(res).length > 0;
  }
}
