import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { LeadFirstReplyStatus, SpeedToLeadChannel } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { FIRST_REPLY_MAX_ATTEMPTS, FIRST_REPLY_STALE_CLAIM_MS } from './lead-first-reply.rules';

type Raw = Record<string, unknown>;
const d = (v: unknown): Date | null => (v ? new Date(v as string) : null);

/** A first message with the facts of its lead the worker needs to decide. */
export interface FirstReplyRow {
  id: number;
  uuid: string;
  leadEventId: number;
  leadEventUuid: string;
  isTest: boolean;
  sourceId: number;
  contactId: number | null;
  channel: SpeedToLeadChannel;
  status: LeadFirstReplyStatus;
  reason: string | null;
  dueAt: Date;
  expiresAt: Date;
  attempts: number;
  sentAt: Date | null;
  /** When the lead was submitted at its provider (the lead event's `received_at`). */
  leadReceivedAt: Date;
  /** When the pipeline scheduled this message. */
  createdAt: Date;
}

const toRow = (r: Raw): FirstReplyRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  leadEventId: Number(r.lead_event_id),
  leadEventUuid: r.lead_event_uuid as string,
  isTest: r.is_test as boolean,
  sourceId: Number(r.source_id),
  contactId: r.contact_id === null || r.contact_id === undefined ? null : Number(r.contact_id),
  channel: r.channel as SpeedToLeadChannel,
  status: r.status as LeadFirstReplyStatus,
  reason: (r.reason as string | null) ?? null,
  dueAt: new Date(r.due_at as string),
  expiresAt: new Date(r.expires_at as string),
  attempts: Number(r.attempts),
  sentAt: d(r.sent_at),
  leadReceivedAt: new Date(r.lead_received_at as string),
  createdAt: new Date(r.created_at as string),
});

const SELECT = sql`
  SELECT f.*, e.uuid AS lead_event_uuid, e.is_test, e.source_id, e.received_at AS lead_received_at
  FROM lead_first_replies f
  JOIN lead_events e ON e.org_id = f.org_id AND e.id = f.lead_event_id`;

/**
 * `lead_first_replies`: the automatic first message of a lead, and the queue the worker drains. A row is claimed by moving it to
 * `sending` in one statement with FOR UPDATE SKIP LOCKED, so any number of workers can run the same query without coordinating.
 */
@Injectable()
export class LeadFirstRepliesRepository {
  /** Schedules the message of a lead; null when this lead already has one (the unique key is the "never twice"). */
  async insertOnce(
    tx: Tx,
    orgId: number,
    v: {
      leadEventId: number;
      contactId: number;
      channel: SpeedToLeadChannel;
      dueAt: Date;
      expiresAt: Date;
    },
  ): Promise<FirstReplyRow | null> {
    const res = await tx.execute(sql`
      INSERT INTO lead_first_replies (org_id, lead_event_id, contact_id, channel, due_at, expires_at)
      VALUES (${orgId}, ${v.leadEventId}, ${v.contactId}, ${v.channel}, ${v.dueAt.toISOString()}::timestamptz,
              ${v.expiresAt.toISOString()}::timestamptz)
      ON CONFLICT (org_id, lead_event_id) DO NOTHING
      RETURNING id`);
    const id = (res.rows[0] as { id: number | string } | undefined)?.id;
    return id === undefined ? null : ((await this.byId(tx, orgId, Number(id))) ?? null);
  }

  async byId(tx: Tx, orgId: number, id: number): Promise<FirstReplyRow | undefined> {
    const res = await tx.execute(sql`${SELECT} WHERE f.org_id = ${orgId} AND f.id = ${id}`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  /**
   * Takes every message that is due in every workspace, `limit` at a time (privileged: the list of due rows is not tenant data).
   * Each is moved to `sending` with the attempt counted; the caller then works on it under its own workspace.
   */
  async claimDue(tx: Tx, limit: number): Promise<Array<{ orgId: number; id: number }>> {
    const res = await tx.execute(sql`
      UPDATE lead_first_replies SET status = 'sending', claimed_at = now(), attempts = attempts + 1
      WHERE (org_id, id) IN (
        SELECT org_id, id FROM lead_first_replies
        WHERE status IN ('scheduled', 'held') AND due_at <= now()
        ORDER BY due_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
      RETURNING org_id, id`);
    return (res.rows as Raw[]).map((r) => ({ orgId: Number(r.org_id), id: Number(r.id) }));
  }

  /** Takes one message if it is due right now (the delay-0 path: the consumer tries at once instead of waiting for the sweep). */
  async claimOne(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE lead_first_replies SET status = 'sending', claimed_at = now(), attempts = attempts + 1
      WHERE (org_id, id) IN (
        SELECT org_id, id FROM lead_first_replies
        WHERE org_id = ${orgId} AND id = ${id} AND status IN ('scheduled', 'held') AND due_at <= now() FOR UPDATE SKIP LOCKED)
      RETURNING id`);
    return res.rows.length > 0;
  }

  /**
   * A worker that died holding a claim. A WhatsApp message is put back (the conversation ledger dedupes on the row's uuid, so trying
   * again cannot send it twice); an SMS or an email is NOT retried: the provider has no idempotency key and the message may already
   * have gone, so it ends `failed / interrupted` and a person decides. A message claimed too many times is given up either way.
   */
  async recoverStale(tx: Tx): Promise<number> {
    const stale = sql`status = 'sending' AND claimed_at < now() - (${Math.floor(FIRST_REPLY_STALE_CLAIM_MS / 1000)} * interval '1 second')`;
    const back = await tx.execute(sql`
      UPDATE lead_first_replies SET status = 'scheduled', due_at = now()
      WHERE ${stale} AND channel = 'whatsapp' AND attempts < ${FIRST_REPLY_MAX_ATTEMPTS}
      RETURNING id`);
    const gone = await tx.execute(sql`
      UPDATE lead_first_replies SET status = 'failed', reason = 'interrupted'
      WHERE ${stale}
      RETURNING id`);
    return back.rows.length + gone.rows.length;
  }

  async finish(
    tx: Tx,
    orgId: number,
    id: number,
    v: {
      status: LeadFirstReplyStatus;
      reason: string | null;
      /** The channel it was really decided on: the source's setting can change while a message waits. */
      channel: SpeedToLeadChannel;
      dueAt?: Date;
      sentAt?: Date;
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE lead_first_replies SET status = ${v.status}, reason = ${v.reason}, channel = ${v.channel},
        due_at = COALESCE(${v.dueAt?.toISOString() ?? null}::timestamptz, due_at),
        sent_at = COALESCE(${v.sentAt?.toISOString() ?? null}::timestamptz, sent_at),
        claimed_at = NULL
      WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
