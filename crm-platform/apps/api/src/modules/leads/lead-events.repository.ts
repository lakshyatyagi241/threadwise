import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { LeadEventStatus } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { decodeCursor } from '../../common/pagination/cursor';

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const d = (v: unknown): Date | null => (v ? new Date(v as string) : null);
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export interface LeadEventRow {
  id: number;
  uuid: string;
  sourceId: number;
  sourceUuid: string;
  externalId: string;
  status: LeadEventStatus;
  isTest: boolean;
  reason: string | null;
  error: string | null;
  contactId: number | null;
  contactUuid: string | null;
  dealId: number | null;
  dealUuid: string | null;
  /** The stored NormalisedLead; null once purged. */
  payload: Record<string, unknown> | null;
  payloadExpiresAt: Date | null;
  attempts: number;
  duplicateCount: number;
  receivedAt: Date;
  processedAt: Date | null;
  /** created_at at microsecond precision (keyset cursor). */
  createdAtIso: string;
  createdAt: Date;
  updatedAt: Date;
  rowVersion: number;
}

const toRow = (r: Raw): LeadEventRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  sourceId: Number(r.source_id),
  sourceUuid: r.source_uuid as string,
  externalId: r.external_id as string,
  status: r.status as LeadEventStatus,
  isTest: r.is_test as boolean,
  reason: s(r.reason),
  error: s(r.error),
  contactId: n(r.contact_id),
  contactUuid: s(r.contact_uuid),
  dealId: n(r.deal_id),
  dealUuid: s(r.deal_uuid),
  payload: (r.payload ?? null) as Record<string, unknown> | null,
  payloadExpiresAt: d(r.payload_expires_at),
  attempts: Number(r.attempts),
  duplicateCount: Number(r.duplicate_count),
  receivedAt: new Date(r.received_at as string),
  processedAt: d(r.processed_at),
  createdAtIso: r.created_at_iso as string,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  rowVersion: Number(r.row_version),
});

const SELECT = sql`
  SELECT e.*, to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso,
         s.uuid AS source_uuid, c.uuid AS contact_uuid, dl.uuid AS deal_uuid
  FROM lead_events e
  JOIN lead_sources s ON s.org_id = e.org_id AND s.id = e.source_id
  LEFT JOIN contacts c ON c.org_id = e.org_id AND c.id = e.contact_id
  LEFT JOIN deals dl ON dl.org_id = e.org_id AND dl.id = e.deal_id`;

export interface ClaimInput {
  sourceId: number;
  externalId: string;
  isTest: boolean;
  /** The NormalisedLead as received. */
  payload: unknown;
  expiresAt: Date;
  receivedAt: Date;
}

export type Claim =
  /** A new event: this call owns it. */
  | { kind: 'claimed'; row: LeadEventRow }
  /** The same lead was received before and nothing needs doing (a repeat). */
  | { kind: 'repeat'; row: LeadEventRow }
  /** A `failed` (or abandoned, still `received`) event delivered again: this call takes it over and processes it. */
  | { kind: 'reclaimed'; row: LeadEventRow };

/** A `received` event older than this is taken to be abandoned by a crashed process (the pipeline finishes in well under a second). */
const STALE_RECEIVED_MS = 5 * 60_000;

@Injectable()
export class LeadEventsRepository {
  /**
   * Stores a delivery before anything else happens to it: idempotency is the unique key, not a check-then-insert. The conflict path
   * locks the existing row so two simultaneous repeats count correctly and only one can take over a failed event.
   */
  async claim(tx: Tx, orgId: number, input: ClaimInput): Promise<Claim> {
    const inserted = await tx.execute(sql`
      INSERT INTO lead_events (org_id, source_id, external_id, is_test, payload, payload_expires_at, received_at)
      VALUES (${orgId}, ${input.sourceId}, ${input.externalId}, ${input.isTest}, ${JSON.stringify(input.payload)}::jsonb,
              ${input.expiresAt.toISOString()}::timestamptz, ${input.receivedAt.toISOString()}::timestamptz)
      ON CONFLICT (org_id, source_id, external_id) DO NOTHING
      RETURNING id`);
    const insertedId = (inserted.rows[0] as { id: number | string } | undefined)?.id;
    if (insertedId !== undefined) {
      return { kind: 'claimed', row: (await this.findById(tx, orgId, Number(insertedId)))! };
    }

    const existing = await tx.execute(sql`
      SELECT id, status, updated_at FROM lead_events
      WHERE org_id = ${orgId} AND source_id = ${input.sourceId} AND external_id = ${input.externalId}
      FOR UPDATE`);
    const e = existing.rows[0] as
      { id: number | string; status: string; updated_at: string } | undefined;
    // The row can only vanish between the two statements if its source was deleted meanwhile: treat as a fresh claim by retrying once.
    if (!e) return this.claimAfterVanish(tx, orgId, input);
    const id = Number(e.id);
    const stale =
      e.status === 'received' && Date.now() - new Date(e.updated_at).getTime() > STALE_RECEIVED_MS;
    if (e.status === 'failed' || stale) {
      await tx.execute(sql`
        UPDATE lead_events SET status = 'received', attempts = attempts + 1, reason = NULL, error = NULL, processed_at = NULL,
          payload = ${JSON.stringify(input.payload)}::jsonb, payload_expires_at = ${input.expiresAt.toISOString()}::timestamptz,
          payload_purged_at = NULL
        WHERE org_id = ${orgId} AND id = ${id}`);
      return { kind: 'reclaimed', row: (await this.findById(tx, orgId, id))! };
    }
    await tx.execute(sql`
      UPDATE lead_events SET duplicate_count = duplicate_count + 1, last_duplicate_at = now()
      WHERE org_id = ${orgId} AND id = ${id}`);
    return { kind: 'repeat', row: (await this.findById(tx, orgId, id))! };
  }

  /** Which of these ids the source holds and has no reason to re-run (see `LeadIngestPort.settled`). */
  async settled(
    tx: Tx,
    orgId: number,
    sourceId: number,
    externalIds: readonly string[],
  ): Promise<string[]> {
    if (externalIds.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT external_id FROM lead_events
      WHERE org_id = ${orgId} AND source_id = ${sourceId}
        AND external_id = ANY(ARRAY[${sql.join(
          externalIds.map((id) => sql`${id}`),
          sql`, `,
        )}]::text[])
        AND status <> 'failed'
        AND NOT (status = 'received' AND updated_at < now() - (${STALE_RECEIVED_MS / 1000} * interval '1 second'))`);
    return (res.rows as Array<{ external_id: string }>).map((r) => r.external_id);
  }

  private async claimAfterVanish(tx: Tx, orgId: number, input: ClaimInput): Promise<Claim> {
    const res = await tx.execute(sql`
      INSERT INTO lead_events (org_id, source_id, external_id, is_test, payload, payload_expires_at, received_at)
      VALUES (${orgId}, ${input.sourceId}, ${input.externalId}, ${input.isTest}, ${JSON.stringify(input.payload)}::jsonb,
              ${input.expiresAt.toISOString()}::timestamptz, ${input.receivedAt.toISOString()}::timestamptz)
      RETURNING id`);
    return {
      kind: 'claimed',
      row: (await this.findById(tx, orgId, Number((res.rows[0] as { id: number | string }).id)))!,
    };
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<LeadEventRow | undefined> {
    const res = await tx.execute(sql`${SELECT} WHERE e.org_id = ${orgId} AND e.id = ${id}`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    sourceId: number,
    uuid: string,
    forUpdate = false,
  ): Promise<LeadEventRow | undefined> {
    const res = await tx.execute(sql`
      ${SELECT} WHERE e.org_id = ${orgId} AND e.source_id = ${sourceId} AND e.uuid = ${uuid}::uuid
      ${forUpdate ? sql`FOR UPDATE OF e` : sql``}`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  /** Newest first, keyset on (created_at, id) like every list here. */
  async list(
    tx: Tx,
    orgId: number,
    sourceId: number,
    f: { status?: LeadEventStatus; isTest?: boolean; limit: number; cursor?: string },
  ): Promise<LeadEventRow[]> {
    const where: SQL[] = [sql`e.org_id = ${orgId}`, sql`e.source_id = ${sourceId}`];
    if (f.status) where.push(sql`e.status = ${f.status}`);
    if (f.isTest !== undefined) where.push(sql`e.is_test = ${f.isTest}`);
    if (f.cursor) {
      const c = decodeCursor(f.cursor);
      where.push(
        sql`(e.created_at, e.id) < (${c.createdAtIso ?? c.createdAt.toISOString()}::timestamptz, ${c.id})`,
      );
    }
    const res = await tx.execute(sql`
      ${SELECT} WHERE ${sql.join(where, sql` AND `)}
      ORDER BY e.created_at DESC, e.id DESC LIMIT ${f.limit + 1}`);
    return (res.rows as Raw[]).map(toRow);
  }

  /** The newest event of a source whose payload is still held: what the mapping preview works from. */
  async latestWithPayload(
    tx: Tx,
    orgId: number,
    sourceId: number,
  ): Promise<LeadEventRow | undefined> {
    const res = await tx.execute(sql`
      ${SELECT} WHERE e.org_id = ${orgId} AND e.source_id = ${sourceId} AND e.payload IS NOT NULL AND NOT e.is_test
      ORDER BY e.created_at DESC, e.id DESC LIMIT 1`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async finish(
    tx: Tx,
    orgId: number,
    id: number,
    v: {
      status: LeadEventStatus;
      reason?: string | null;
      error?: string | null;
      contactId?: number | null;
      dealId?: number | null;
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE lead_events SET status = ${v.status}, reason = ${v.reason ?? null}, error = ${v.error ?? null},
        contact_id = ${v.contactId ?? null}, deal_id = ${v.dealId ?? null}, processed_at = now()
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async setDeal(
    tx: Tx,
    orgId: number,
    id: number,
    dealId: number | null,
    error: string | null,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE lead_events SET deal_id = ${dealId}, error = ${error} WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** The event a retry re-processes: back to `received` with the attempt counted, so a concurrent delivery treats it as in flight. */
  async markRetry(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE lead_events SET status = 'received', attempts = attempts + 1, reason = NULL, error = NULL, processed_at = NULL
      WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
