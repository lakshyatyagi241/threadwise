import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import type {
  CallDirection,
  CallHandlerType,
  CallPermissionStatus,
  CallStatus,
} from '@crm/contracts';

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (res as { rows: Row[] }).rows;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const date = (v: unknown): Date | null => (v ? new Date(v as string) : null);
const json = (v: unknown) => sql`${JSON.stringify(v ?? null)}::jsonb`;

/** A WhatsApp number as the calling domain reads it: the connection's own columns plus the calling switch. */
export interface NumberRow {
  id: number;
  uuid: string;
  status: string;
  phoneNumber: string | null;
  displayLabel: string | null;
  callingEnabled: boolean;
  callingEnabledAt: Date | null;
  meta: Record<string, unknown> | null;
}

const toNumber = (r: Row): NumberRow => ({
  id: Number(r.id),
  uuid: String(r.uuid),
  status: String(r.status),
  phoneNumber: (r.phone_number as string | null) ?? null,
  displayLabel: (r.display_label as string | null) ?? null,
  callingEnabled: r.calling_enabled === true,
  callingEnabledAt: date(r.calling_enabled_at),
  meta: (r.meta_json as Record<string, unknown> | null) ?? null,
});

export interface CallRow {
  id: number;
  uuid: string;
  configId: number | null;
  metaCallId: string | null;
  correlationId: string | null;
  direction: CallDirection;
  fromPhone: string;
  toPhone: string;
  contactId: number | null;
  conversationId: number | null;
  handlerType: CallHandlerType | null;
  handlerUserId: number | null;
  assistantId: number | null;
  status: CallStatus;
  endReason: string | null;
  startedAt: Date | null;
  answeredAt: Date | null;
  endedAt: Date | null;
  durationSec: number;
  recordingPath: string | null;
  meta: Record<string, unknown> | null;
}

const CALL_COLS = sql`id, uuid, wa_provider_config_id, meta_call_id, correlation_id, direction, from_phone, to_phone, contact_id,
  conversation_id, handler_type, handler_user_id, assistant_id, status, end_reason, started_at, answered_at, ended_at, duration_sec,
  recording_path, meta_payload`;

const toCall = (r: Row): CallRow => ({
  id: Number(r.id),
  uuid: String(r.uuid),
  configId: num(r.wa_provider_config_id),
  metaCallId: (r.meta_call_id as string | null) ?? null,
  correlationId: (r.correlation_id as string | null) ?? null,
  direction: r.direction as CallDirection,
  fromPhone: String(r.from_phone),
  toPhone: String(r.to_phone),
  contactId: num(r.contact_id),
  conversationId: num(r.conversation_id),
  handlerType: (r.handler_type as CallHandlerType | null) ?? null,
  handlerUserId: num(r.handler_user_id),
  assistantId: num(r.assistant_id),
  status: r.status as CallStatus,
  endReason: (r.end_reason as string | null) ?? null,
  startedAt: date(r.started_at),
  answeredAt: date(r.answered_at),
  endedAt: date(r.ended_at),
  durationSec: Number(r.duration_sec),
  recordingPath: (r.recording_path as string | null) ?? null,
  meta: (r.meta_payload as Record<string, unknown> | null) ?? null,
});

export interface NewCall {
  configId: number;
  metaCallId?: string | null;
  correlationId?: string | null;
  direction: CallDirection;
  fromPhone: string;
  toPhone: string;
  contactId: number | null;
  conversationId: number | null;
  status: CallStatus;
  startedAt: Date;
  meta?: Record<string, unknown> | null;
}

export interface PermissionRow {
  id: number;
  status: CallPermissionStatus;
  grantedAt: Date | null;
  expiresAt: Date | null;
}

/** The ledger steps after which the set of ringing calls is different. */
const RINGING_STEPS = new Set([
  'connect',
  'accept_sent',
  'accept_failed',
  'reject_sent',
  'terminate',
  'terminate_sent',
]);

/** SQL for calls, their events, the permission ledger and the numbers' calling switch. Every method runs in the caller's transaction. */
@Injectable()
export class CallsRepository {
  constructor(private readonly outbox: OutboxService) {}

  // --- numbers ---------------------------------------------------------------------------------------------------------------

  async numbers(tx: Tx, orgId: number): Promise<NumberRow[]> {
    const res = await tx.execute(sql`
      SELECT id, uuid, status, phone_number, display_label, calling_enabled, calling_enabled_at, meta_json
      FROM wa_provider_configs WHERE org_id = ${orgId} AND provider = 'waba'
      ORDER BY is_primary DESC, connected_at DESC NULLS LAST, id`);
    return rowsOf(res).map(toNumber);
  }

  async numberByUuid(tx: Tx, orgId: number, uuid: string): Promise<NumberRow | null> {
    const res = await tx.execute(sql`
      SELECT id, uuid, status, phone_number, display_label, calling_enabled, calling_enabled_at, meta_json
      FROM wa_provider_configs WHERE org_id = ${orgId} AND provider = 'waba' AND uuid = ${uuid}::uuid`);
    const r = rowsOf(res)[0];
    return r ? toNumber(r) : null;
  }

  async numberById(tx: Tx, orgId: number, id: number): Promise<NumberRow | null> {
    const res = await tx.execute(sql`
      SELECT id, uuid, status, phone_number, display_label, calling_enabled, calling_enabled_at, meta_json
      FROM wa_provider_configs WHERE org_id = ${orgId} AND provider = 'waba' AND id = ${id}`);
    const r = rowsOf(res)[0];
    return r ? toNumber(r) : null;
  }

  async setCalling(
    tx: Tx,
    orgId: number,
    id: number,
    enabled: boolean,
    meta: unknown,
  ): Promise<NumberRow> {
    const res = await tx.execute(sql`
      UPDATE wa_provider_configs
         SET calling_enabled = ${enabled}, calling_enabled_at = ${enabled ? sql`now()` : sql`NULL`},
             calling_enabled_meta = ${json(meta)}
       WHERE org_id = ${orgId} AND id = ${id}
       RETURNING id, uuid, status, phone_number, display_label, calling_enabled, calling_enabled_at, meta_json`);
    return toNumber(rowsOf(res)[0]!);
  }

  /**
   * Same as `setCalling`, but only when the flag still reads `expected`: a check that read the number a moment ago must not overwrite a
   * switch a person (or the automatic one) made since. With `unchangedSince` (the database time a check began) the row must also be
   * untouched since then: a toggle that landed while the check waited on Meta wins even when its value happens to match. `null` when
   * either no longer holds.
   */
  async setCallingIf(
    tx: Tx,
    orgId: number,
    id: number,
    expected: boolean,
    enabled: boolean,
    meta: unknown,
    unchangedSince?: Date,
  ): Promise<NumberRow | null> {
    const res = await tx.execute(sql`
      UPDATE wa_provider_configs
         SET calling_enabled = ${enabled}, calling_enabled_at = ${enabled ? sql`now()` : sql`NULL`},
             calling_enabled_meta = ${json(meta)}
       WHERE org_id = ${orgId} AND id = ${id} AND calling_enabled = ${expected}
         ${unchangedSince ? sql`AND updated_at <= ${unchangedSince.toISOString()}::timestamptz` : sql``}
       RETURNING id, uuid, status, phone_number, display_label, calling_enabled, calling_enabled_at, meta_json`);
    const r = rowsOf(res)[0];
    return r ? toNumber(r) : null;
  }

  /** The number a conversation is on, when it is a WhatsApp Cloud API one: through the channel the number is the inbox view of. */
  async numberOfConversation(tx: Tx, orgId: number, conversationUuid: string) {
    const res = await tx.execute(sql`
      SELECT c.id AS conversation_id, c.peer_key, ch.waba_config_id, ch.kind
      FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId} AND c.uuid = ${conversationUuid}::uuid`);
    const r = rowsOf(res)[0];
    return r
      ? {
          conversationId: Number(r.conversation_id),
          peerKey: String(r.peer_key),
          configId: num(r.waba_config_id),
          kind: String(r.kind),
        }
      : null;
  }

  /** The inbox channel of a number, and a thread of a customer on it, by the customer's digits. */
  async threadFor(tx: Tx, orgId: number, configId: number, digits: string) {
    const res = await tx.execute(sql`
      SELECT ch.uuid AS channel_uuid, c.id AS conversation_id, c.contact_id
      FROM channels ch
      LEFT JOIN conversations c ON c.org_id = ch.org_id AND c.channel_id = ch.id AND c.peer_key = ${digits}
      WHERE ch.org_id = ${orgId} AND ch.waba_config_id = ${configId}
      ORDER BY c.id NULLS LAST LIMIT 1`);
    const r = rowsOf(res)[0];
    return r
      ? {
          channelUuid: String(r.channel_uuid),
          conversationId: num(r.conversation_id),
          contactId: num(r.contact_id),
        }
      : null;
  }

  async contactByPhone(
    tx: Tx,
    orgId: number,
    digits: string,
  ): Promise<{ id: number; name: string | null } | null> {
    const res = await tx.execute(sql`
      SELECT id, coalesce(name, first_name) AS name FROM contacts
      WHERE org_id = ${orgId} AND normalized_phone = ${'+' + digits} ORDER BY id LIMIT 1`);
    const r = rowsOf(res)[0];
    return r ? { id: Number(r.id), name: (r.name as string | null) ?? null } : null;
  }

  async contactIdByUuid(tx: Tx, orgId: number, uuid: string): Promise<number | null> {
    const res = await tx.execute(
      sql`SELECT id FROM contacts WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    return num(rowsOf(res)[0]?.id);
  }

  async conversationIdByUuid(tx: Tx, orgId: number, uuid: string): Promise<number | null> {
    const res = await tx.execute(
      sql`SELECT id FROM conversations WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    return num(rowsOf(res)[0]?.id);
  }

  // --- permission ledger -----------------------------------------------------------------------------------------------------

  async permission(
    tx: Tx,
    orgId: number,
    configId: number,
    forms: string[],
  ): Promise<PermissionRow | null> {
    if (forms.length === 0) return null;
    const res = await tx.execute(sql`
      SELECT id, status, granted_at, expires_at FROM wa_call_permissions
      WHERE org_id = ${orgId} AND wa_provider_config_id = ${configId}
        AND contact_phone IN (${sql.join(
          forms.map((f) => sql`${f}`),
          sql`, `,
        )})
      ORDER BY updated_at DESC, id DESC LIMIT 1`);
    const r = rowsOf(res)[0];
    return r
      ? {
          id: Number(r.id),
          status: r.status as CallPermissionStatus,
          grantedAt: date(r.granted_at),
          expiresAt: date(r.expires_at),
        }
      : null;
  }

  /** One row per (number, customer): a second answer replaces the first. */
  async upsertPermission(
    tx: Tx,
    orgId: number,
    configId: number,
    digits: string,
    v: { status: CallPermissionStatus; grantedAt: Date | null; expiresAt: Date | null },
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO wa_call_permissions (org_id, wa_provider_config_id, contact_phone, status, granted_at, expires_at)
      VALUES (${orgId}, ${configId}, ${digits}, ${v.status}, ${v.grantedAt?.toISOString() ?? null}::timestamptz,
              ${v.expiresAt?.toISOString() ?? null}::timestamptz)
      ON CONFLICT (org_id, wa_provider_config_id, contact_phone)
      DO UPDATE SET status = EXCLUDED.status, granted_at = EXCLUDED.granted_at, expires_at = EXCLUDED.expires_at`);
  }

  // --- calls -----------------------------------------------------------------------------------------------------------------

  async insertCall(tx: Tx, orgId: number, c: NewCall): Promise<CallRow> {
    const res = await tx.execute(sql`
      INSERT INTO wa_calls (org_id, provider, wa_provider_config_id, meta_call_id, correlation_id, direction, from_phone, to_phone,
                            contact_id, conversation_id, status, started_at, meta_payload)
      VALUES (${orgId}, 'waba', ${c.configId}, ${c.metaCallId ?? null}, ${c.correlationId ?? null}, ${c.direction}, ${c.fromPhone},
              ${c.toPhone}, ${c.contactId}, ${c.conversationId}, ${c.status}, ${c.startedAt.toISOString()}::timestamptz,
              ${json(c.meta ?? null)})
      RETURNING ${CALL_COLS}`);
    return toCall(rowsOf(res)[0]!);
  }

  async byUuid(tx: Tx, orgId: number, uuid: string, forUpdate = false): Promise<CallRow | null> {
    const base = sql`SELECT ${CALL_COLS} FROM wa_calls WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`;
    const res = await tx.execute(forUpdate ? sql`${base} FOR UPDATE` : base);
    const r = rowsOf(res)[0];
    return r ? toCall(r) : null;
  }

  /** The row Meta's event is about: by Meta's id, or by the correlation id we sent with the dial and Meta echoes back. */
  async byMetaOrCorrelation(
    tx: Tx,
    orgId: number,
    metaCallId: string | null,
    correlation: string | null,
  ): Promise<CallRow | null> {
    if (!metaCallId && !correlation) return null;
    const res = await tx.execute(sql`
      SELECT ${CALL_COLS} FROM wa_calls
      WHERE org_id = ${orgId} AND (
        ${metaCallId ? sql`meta_call_id = ${metaCallId}` : sql`false`}
        OR ${correlation ? sql`correlation_id = ${correlation}` : sql`false`})
      ORDER BY id LIMIT 1 FOR UPDATE`);
    const r = rowsOf(res)[0];
    return r ? toCall(r) : null;
  }

  async patchCall(
    tx: Tx,
    orgId: number,
    id: number,
    p: Partial<{
      metaCallId: string | null;
      status: CallStatus;
      handlerType: CallHandlerType | null;
      handlerUserId: number | null;
      contactId: number | null;
      conversationId: number | null;
      direction: CallDirection;
      startedAt: Date;
      answeredAt: Date | null;
      endedAt: Date | null;
      endReason: string | null;
      durationSec: number;
      recordingPath: string | null;
      errorPayload: unknown;
      meta: unknown;
    }>,
  ): Promise<void> {
    const set: ReturnType<typeof sql>[] = [];
    const add = (col: string, v: ReturnType<typeof sql>) => set.push(sql`${sql.raw(col)} = ${v}`);
    if ('metaCallId' in p) add('meta_call_id', sql`${p.metaCallId ?? null}`);
    if (p.status) add('status', sql`${p.status}`);
    if ('handlerType' in p) add('handler_type', sql`${p.handlerType ?? null}`);
    if ('handlerUserId' in p) add('handler_user_id', sql`${p.handlerUserId ?? null}`);
    if ('contactId' in p) add('contact_id', sql`${p.contactId ?? null}`);
    if ('conversationId' in p) add('conversation_id', sql`${p.conversationId ?? null}`);
    if (p.direction) add('direction', sql`${p.direction}`);
    if (p.startedAt) add('started_at', sql`${p.startedAt.toISOString()}::timestamptz`);
    if ('answeredAt' in p)
      add('answered_at', sql`${p.answeredAt?.toISOString() ?? null}::timestamptz`);
    if ('endedAt' in p) add('ended_at', sql`${p.endedAt?.toISOString() ?? null}::timestamptz`);
    if ('endReason' in p) add('end_reason', sql`${p.endReason ?? null}`);
    if (p.durationSec !== undefined) add('duration_sec', sql`${p.durationSec}`);
    if ('recordingPath' in p) add('recording_path', sql`${p.recordingPath ?? null}`);
    if ('errorPayload' in p) add('error_payload', json(p.errorPayload));
    if ('meta' in p) add('meta_payload', json(p.meta));
    if (set.length === 0) return;
    await tx.execute(
      sql`UPDATE wa_calls SET ${sql.join(set, sql`, `)} WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  /**
   * The claim that makes two operators accepting at once safe (TW-CALL-013 rule 1): one statement moves a ringing call to connecting
   * for this person, and only one caller gets the row back. null: it was not ringing any more.
   */
  async claim(tx: Tx, orgId: number, uuid: string, userId: number): Promise<CallRow | null> {
    const res = await tx.execute(sql`
      UPDATE wa_calls SET status = 'connecting', handler_type = 'operator', handler_user_id = ${userId}
      WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid AND status = 'ringing'
      RETURNING ${CALL_COLS}`);
    const r = rowsOf(res)[0];
    return r ? toCall(r) : null;
  }

  /** Puts a claimed call back in line when Meta refused the accept, so someone else (or the fallback) can take it. */
  async release(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE wa_calls SET status = 'ringing', handler_type = NULL, handler_user_id = NULL
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'connecting'`);
  }

  /** Ringing inbound calls of the last `windowMinutes`, newest first (the operators' incoming-call poll, TW-CALL-012). */
  async ringing(tx: Tx, orgId: number, windowMinutes: number, limit: number) {
    const res = await tx.execute(sql`
      SELECT w.uuid, w.direction, w.from_phone, w.to_phone, w.started_at, w.meta_call_id, w.assistant_id, w.meta_payload,
             ct.uuid AS contact_uuid, coalesce(ct.name, ct.first_name) AS contact_name
      FROM wa_calls w LEFT JOIN contacts ct ON ct.org_id = w.org_id AND ct.id = w.contact_id
      WHERE w.org_id = ${orgId} AND w.status = 'ringing' AND w.direction = 'USER_INITIATED'
        AND w.started_at >= now() - make_interval(mins => ${windowMinutes})
      ORDER BY w.started_at DESC LIMIT ${limit}`);
    return rowsOf(res);
  }

  async logEvent(
    tx: Tx,
    orgId: number,
    callId: number,
    type: string,
    payload: unknown,
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO wa_call_events (org_id, wa_call_id, event_type, payload)
      VALUES (${orgId}, ${callId}, ${type}, ${json(payload)})`);
    // The steps that change who sees a ringing call: a worker turns this into a push, so no screen has to poll fast (TW-CALL-012).
    if (RINGING_STEPS.has(type)) {
      await this.outbox.emit(tx, {
        aggregateModule: 'wa_calls',
        aggregateId: callId,
        eventType: 'call.changed',
        payload: { step: type },
        orgId,
      });
    }
  }
}
