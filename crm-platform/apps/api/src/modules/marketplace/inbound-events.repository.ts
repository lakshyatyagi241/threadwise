import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { jsonb } from './sql-helpers';

type Raw = Record<string, unknown>;

export interface NewInboundEvent {
  connectionId: number;
  method: 'POST' | 'GET';
  format: 'json' | 'form' | 'xml' | 'query';
  contentType: string | null;
  /** The raw body, or the query string of a GET. */
  body: string;
  headers: Record<string, string>;
  sourceIp: string | null;
}

/** A claimed delivery: what the worker needs to read it again. */
export interface ClaimedInboundEvent {
  id: number;
  uuid: string;
  connectionId: number;
  method: 'POST' | 'GET';
  format: 'json' | 'form' | 'xml' | 'query';
  contentType: string | null;
  body: string;
  attempts: number;
}

export interface InboundCounts {
  received: number;
  accepted: number;
  duplicates: number;
  rejected: number;
}

/** How long the sweep leaves a fresh delivery to the job the door queued for it before it queues one itself. */
export const INBOUND_GRACE_SECONDS = 15;
/** A delivery 'processing' for longer than this belongs to a worker that died; the sweep takes it over. */
export const INBOUND_STALE_SECONDS = 300;

/**
 * The delivery inbox of portal connections (`marketplace_inbound_events`): every delivery to a connection that answers at once is written
 * here BEFORE the sender is answered, and the worker processes it afterwards. The raw body (a person's name and phone) is kept only until
 * the delivery is processed; one that could not be read or processed keeps it, for support, until the retention sweep deletes the row.
 */
@Injectable()
export class InboundEventsRepository {
  async insert(tx: Tx, orgId: number, e: NewInboundEvent): Promise<{ id: number; uuid: string }> {
    const res = await tx.execute(sql`
      INSERT INTO marketplace_inbound_events
        (org_id, connection_id, method, format, content_type, body, headers, source_ip, next_attempt_at)
      VALUES (${orgId}, ${e.connectionId}, ${e.method}, ${e.format}, ${e.contentType}, ${e.body}, ${jsonb(e.headers)},
              ${e.sourceIp}, now() + (${INBOUND_GRACE_SECONDS} || ' seconds')::interval)
      RETURNING id, uuid`);
    const r = (res.rows as Raw[])[0]!;
    return { id: Number(r.id), uuid: r.uuid as string };
  }

  /** Takes a delivery for processing: a fresh or failed one, or one a dead worker left. Null when someone else has it or it is done. */
  async claim(tx: Tx, orgId: number, id: number): Promise<ClaimedInboundEvent | null> {
    const res = await tx.execute(sql`
      UPDATE marketplace_inbound_events
         SET status = 'processing', attempts = attempts + 1, claimed_at = now()
       WHERE org_id = ${orgId} AND id = ${id}
         AND (status IN ('received', 'failed')
              OR (status = 'processing' AND claimed_at < now() - (${INBOUND_STALE_SECONDS} || ' seconds')::interval))
         AND body IS NOT NULL
      RETURNING id, uuid, connection_id, method, format, content_type, body, attempts`);
    const r = (res.rows as Raw[])[0];
    if (!r) return null;
    return {
      id: Number(r.id),
      uuid: r.uuid as string,
      connectionId: Number(r.connection_id),
      method: r.method as ClaimedInboundEvent['method'],
      format: r.format as ClaimedInboundEvent['format'],
      contentType: (r.content_type as string | null) ?? null,
      body: r.body as string,
      attempts: Number(r.attempts),
    };
  }

  /** Done: the body goes (the lead pipeline holds the lead and its own raw event), the counts stay for the connection page. */
  async processed(tx: Tx, orgId: number, id: number, counts: InboundCounts): Promise<void> {
    await tx.execute(sql`
      UPDATE marketplace_inbound_events
         SET status = 'processed', body = NULL, error = NULL, claimed_at = NULL, processed_at = now(),
             leads_received = ${counts.received}, leads_accepted = ${counts.accepted},
             leads_duplicate = ${counts.duplicates}, leads_rejected = ${counts.rejected}
       WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** A delivery that can never be processed (unreadable, no lead in it, its connection switched off): the body stays for support. */
  async rejected(
    tx: Tx,
    orgId: number,
    id: number,
    error: string,
    counts?: InboundCounts,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE marketplace_inbound_events
         SET status = 'rejected', error = ${error.slice(0, 300)}, claimed_at = NULL, processed_at = now(),
             leads_received = ${counts?.received ?? 0}, leads_accepted = ${counts?.accepted ?? 0},
             leads_duplicate = ${counts?.duplicates ?? 0}, leads_rejected = ${counts?.rejected ?? 0}
       WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** The lead pipeline could not take it now: try again from the stored copy after `delaySeconds`. */
  async retryLater(
    tx: Tx,
    orgId: number,
    id: number,
    error: string,
    delaySeconds: number,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE marketplace_inbound_events
         SET status = 'failed', error = ${error.slice(0, 300)}, claimed_at = NULL,
             next_attempt_at = now() + (${delaySeconds} || ' seconds')::interval
       WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** Deliveries nobody is working on whose time has come, across workspaces. Runs on the privileged path (the worker's sweep). */
  async due(tx: Tx, limit: number): Promise<Array<{ orgId: number; id: number }>> {
    const res = await tx.execute(sql`
      SELECT org_id, id FROM marketplace_inbound_events
       WHERE (status IN ('received', 'failed') AND next_attempt_at <= now())
          OR (status = 'processing' AND claimed_at < now() - (${INBOUND_STALE_SECONDS} || ' seconds')::interval)
       ORDER BY received_at, id
       LIMIT ${limit}`);
    return (res.rows as Raw[]).map((r) => ({ orgId: Number(r.org_id), id: Number(r.id) }));
  }

  /** Retention: deliveries older than this many days go, with whatever body they still hold. */
  async trim(tx: Tx, days: number): Promise<number> {
    const res = await tx.execute(sql`
      DELETE FROM marketplace_inbound_events
       WHERE received_at < now() - (${days} || ' days')::interval RETURNING id`);
    return (res.rows as Raw[]).length;
  }
}
