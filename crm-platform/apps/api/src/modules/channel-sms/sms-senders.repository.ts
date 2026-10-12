import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { SmsMeta } from './sender-rules';

export interface SenderRow {
  id: number;
  uuid: string;
  /** `connected` or `disconnected`; `failed` once the provider refused the key at send time. */
  status: string;
  /** The From number or id as typed. */
  fromNumber: string;
  label: string;
  /** Encrypted JSON `{account_sid, auth_token, from_number}`. */
  credentials: string | null;
  meta: SmsMeta;
  connectedAt: Date | null;
  rowVersion: number;
}

interface Raw {
  id: number | string;
  uuid: string;
  status: string;
  phone_number: string | null;
  display_label: string | null;
  credentials_json: string | null;
  meta_json: SmsMeta | null;
  connected_at: Date | string | null;
  row_version: number;
}

const COLUMNS = sql.raw(
  `id, uuid, status, phone_number, display_label, credentials_json, meta_json, connected_at, row_version`,
);

const toRow = (r: Raw): SenderRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  status: r.status,
  fromNumber: r.phone_number ?? '',
  label: r.display_label ?? '',
  credentials: r.credentials_json,
  meta: r.meta_json ?? {},
  connectedAt: r.connected_at === null ? null : new Date(r.connected_at),
  rowVersion: r.row_version,
});

const first = (rows: unknown[]): SenderRow | undefined => {
  const r = (rows as Raw[])[0];
  return r ? toRow(r) : undefined;
};

/**
 * SMS senders are `wa_provider_configs` rows with provider = 'sms' (Reference's shared table), always inside the caller's tenant
 * transaction: RLS scopes every statement, and every query also names the org.
 */
@Injectable()
export class SmsSendersRepository {
  async list(tx: Tx, orgId: number): Promise<SenderRow[]> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM wa_provider_configs WHERE org_id = ${orgId} AND provider = 'sms' ORDER BY id`,
    );
    return (res.rows as unknown as Raw[]).map(toRow);
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    lock = false,
  ): Promise<SenderRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM wa_provider_configs WHERE org_id = ${orgId} AND provider = 'sms' AND uuid = ${uuid}::uuid ${lock ? sql`FOR UPDATE` : sql``}`,
    );
    return first(res.rows);
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<SenderRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM wa_provider_configs WHERE org_id = ${orgId} AND provider = 'sms' AND id = ${id}`,
    );
    return first(res.rows);
  }

  /** The row for this From value exactly as typed, locked: re-submitting the same value updates it (TW-SMS-002 rule 5). */
  async findByFrom(tx: Tx, orgId: number, from: string): Promise<SenderRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM wa_provider_configs WHERE org_id = ${orgId} AND provider = 'sms' AND phone_number = ${from} FOR UPDATE`,
    );
    return first(res.rows);
  }

  /** The workspace's connected Twilio SMS sender a lookup is billed to: the oldest (no SMS sender is ever primary). */
  async firstConnectedTwilio(tx: Tx, orgId: number): Promise<SenderRow | undefined> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider = 'sms' AND status = 'connected'
        AND coalesce(meta_json ->> 'sms_provider', 'twilio') = 'twilio'
      ORDER BY is_primary DESC, id LIMIT 1`);
    return first(res.rows);
  }

  /** Every Twilio SMS sender of the workspace: whose auth token may have signed a delivery report. */
  async twilioSenders(tx: Tx, orgId: number): Promise<SenderRow[]> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider = 'sms' AND coalesce(meta_json ->> 'sms_provider', 'twilio') = 'twilio'
      ORDER BY id`);
    return (res.rows as unknown as Raw[]).map(toRow);
  }

  /** The encrypted keys of the workspace's WhatsApp Twilio connection (any status, oldest), for the "leave blank to reuse" path. */
  async twilioWhatsappCredentials(tx: Tx, orgId: number): Promise<string | null> {
    const res = await tx.execute(sql`
      SELECT credentials_json FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider = 'twilio' ORDER BY id LIMIT 1`);
    return (
      (res.rows[0] as { credentials_json: string | null } | undefined)?.credentials_json ?? null
    );
  }

  /**
   * What counts against the workspace's device cap (TW-SMS-002 rule 6): its personal numbers and every Cloud API, Twilio and SMS
   * connection together.
   */
  async countDeviceRows(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(sql`
      SELECT (SELECT count(*) FROM devices WHERE org_id = ${orgId})::int
           + (SELECT count(*) FROM wa_provider_configs WHERE org_id = ${orgId} AND provider IN ('waba', 'twilio', 'sms'))::int AS n`);
    return Number((res.rows[0] as { n: number }).n);
  }

  /**
   * Inserts the sender, or updates the one with the same From value (a concurrent connect of the same value lands on the update
   * instead of failing on the unique index). `created` says which happened.
   */
  async upsert(
    tx: Tx,
    orgId: number,
    v: { from: string; label: string; credentials: string; meta: SmsMeta },
  ): Promise<{ row: SenderRow; created: boolean }> {
    const res = await tx.execute(sql`
      INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, display_label, is_primary, connected_at,
                                       credentials_json, meta_json)
      VALUES (${orgId}, 'sms', 'connected', ${v.from}, ${v.label}, false, now(), ${v.credentials}, ${JSON.stringify(v.meta)}::jsonb)
      ON CONFLICT (org_id, phone_number) WHERE provider = 'sms' DO UPDATE
        SET status = 'connected', display_label = EXCLUDED.display_label, connected_at = now(),
            credentials_json = EXCLUDED.credentials_json, meta_json = EXCLUDED.meta_json
      RETURNING ${COLUMNS}, (xmax = 0) AS created`);
    const r = res.rows[0] as unknown as Raw & { created: boolean };
    return { row: toRow(r), created: r.created };
  }

  async setStatus(
    tx: Tx,
    orgId: number,
    id: number,
    status: 'connected' | 'disconnected' | 'failed',
    lastError: string | null = null,
  ): Promise<SenderRow> {
    const res = await tx.execute(sql`
      UPDATE wa_provider_configs
      SET status = ${status}, meta_json = coalesce(meta_json, '{}'::jsonb) || jsonb_build_object('last_error', ${lastError}::text)
      WHERE org_id = ${orgId} AND provider = 'sms' AND id = ${id}
      RETURNING ${COLUMNS}`);
    return toRow((res.rows as unknown as Raw[])[0]!);
  }

  async remove(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(
      sql`DELETE FROM wa_provider_configs WHERE org_id = ${orgId} AND provider = 'sms' AND id = ${id}`,
    );
  }

  // --- the monthly allowance (plan_usage, metric `sms_sent`, one row per calendar month) -------------------------------------

  async used(tx: Tx, orgId: number, metric: string, period: string): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count FROM plan_usage WHERE org_id = ${orgId} AND metric = ${metric} AND period = ${period}`,
    );
    return Number((res.rows[0] as { count: number } | undefined)?.count ?? 0);
  }

  /**
   * Takes one message from the allowance, atomically: the statement only counts when the month is still under `cap` (0 = no cap), so
   * two sends at once cannot both take the last place. False when the allowance is spent.
   */
  async reserve(
    tx: Tx,
    orgId: number,
    metric: string,
    period: string,
    cap: number,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      INSERT INTO plan_usage (org_id, metric, period, count) VALUES (${orgId}, ${metric}, ${period}, 1)
      ON CONFLICT (org_id, metric, period) DO UPDATE SET count = plan_usage.count + 1
        WHERE ${cap}::int = 0 OR plan_usage.count < ${cap}::int
      RETURNING count`);
    return res.rows.length > 0;
  }

  /** Gives a reservation back: the provider refused the message, and a failed send does not count (TW-SMS-026 rule 3). */
  async release(tx: Tx, orgId: number, metric: string, period: string): Promise<void> {
    await tx.execute(sql`
      UPDATE plan_usage SET count = greatest(count - 1, 0)
      WHERE org_id = ${orgId} AND metric = ${metric} AND period = ${period}`);
  }

  // --- contacts (the send-side opt-out, TW-SMS-024) ---------------------------------------------------------------------------

  async isOptedOut(tx: Tx, orgId: number, contactId: number): Promise<boolean> {
    const res = await tx.execute(
      sql`SELECT is_unsubscribed FROM contacts WHERE org_id = ${orgId} AND id = ${contactId}`,
    );
    return (res.rows[0] as { is_unsubscribed: boolean } | undefined)?.is_unsubscribed === true;
  }

  /** The recipient replied STOP at the provider (Twilio 21610): flags them so the next send does not try again. True when it changed. */
  async markOptedOut(tx: Tx, orgId: number, contactId: number): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE contacts SET is_unsubscribed = true, unsubscribed_at = coalesce(unsubscribed_at, now())
      WHERE org_id = ${orgId} AND id = ${contactId} AND NOT is_unsubscribed
      RETURNING id`);
    return res.rows.length > 0;
  }
}
