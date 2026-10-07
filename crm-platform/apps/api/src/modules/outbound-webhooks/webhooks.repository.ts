import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';

const { webhooks, webhookDeliveries } = schema;

export type WebhookRow = typeof webhooks.$inferSelect;
export type DeliveryRow = typeof webhookDeliveries.$inferSelect;

export interface NewWebhook {
  userId: number | null;
  name: string | null;
  urlEnc: string;
  secretEnc: string | null;
  events: string[];
  active: boolean;
}

export interface DeliveryLog {
  webhookId: number;
  event: string;
  statusCode: number | null;
  latencyMs: number | null;
  attempts: number;
  isRetry: boolean;
  payload: unknown;
  responseBody: string | null;
  error: string | null;
}

/** Rows of `webhooks` and `webhook_deliveries` (RLS keeps every query inside the caller's workspace). */
@Injectable()
export class WebhooksRepository {
  /** Serialises creation per workspace: the plan-cap check and the insert must not interleave. */
  async lockForCreate(tx: Tx, orgId: number): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`webhooks:${orgId}`}))`);
  }

  /** The inbox's outbound webhooks and these are one allowance to the customer (see plan-usage `webhooks`). */
  async countAll(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT ((SELECT count(*) FROM outbound_webhooks WHERE org_id = ${orgId})
                + (SELECT count(*) FROM webhooks WHERE org_id = ${orgId}))::int AS n`,
    );
    return Number((res.rows[0] as { n: number }).n);
  }

  async list(tx: Tx, orgId: number): Promise<WebhookRow[]> {
    return tx
      .select()
      .from(webhooks)
      .where(eq(webhooks.orgId, orgId))
      .orderBy(desc(webhooks.createdAt), desc(webhooks.id))
      .limit(200);
  }

  async active(tx: Tx, orgId: number): Promise<WebhookRow[]> {
    return tx
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.orgId, orgId), eq(webhooks.status, true)));
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<WebhookRow | undefined> {
    const [row] = await tx
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.orgId, orgId), eq(webhooks.uuid, uuid)))
      .limit(1);
    return row;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<WebhookRow | undefined> {
    const [row] = await tx
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.orgId, orgId), eq(webhooks.id, id)))
      .limit(1);
    return row;
  }

  async insert(tx: Tx, orgId: number, w: NewWebhook): Promise<WebhookRow> {
    const [row] = await tx
      .insert(webhooks)
      .values({
        orgId,
        uuid: crypto.randomUUID(),
        userId: w.userId,
        name: w.name,
        environment: 'Production',
        httpMethod: 'POST',
        webhookUrl: w.urlEnc,
        secret: w.secretEnc,
        events: w.events,
        status: w.active,
      })
      .returning();
    return row!;
  }

  /** Last-write-wins (see updateWebhookSchema): the health counters move the row version on every delivery. */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    patch: Partial<typeof webhooks.$inferInsert>,
  ): Promise<WebhookRow | undefined> {
    const [row] = await tx
      .update(webhooks)
      .set(patch)
      .where(and(eq(webhooks.orgId, orgId), eq(webhooks.id, id)))
      .returning();
    return row;
  }

  async remove(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.delete(webhooks).where(and(eq(webhooks.orgId, orgId), eq(webhooks.id, id)));
    // The log of a deleted endpoint goes with it (Reference left it orphaned, still stored).
    await tx
      .delete(webhookDeliveries)
      .where(and(eq(webhookDeliveries.orgId, orgId), eq(webhookDeliveries.webhookId, id)));
  }

  async deliveries(
    tx: Tx,
    orgId: number,
    webhookId: number,
    limit: number,
  ): Promise<DeliveryRow[]> {
    return tx
      .select()
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.orgId, orgId), eq(webhookDeliveries.webhookId, webhookId)))
      .orderBy(desc(webhookDeliveries.firedAt), desc(webhookDeliveries.id))
      .limit(limit);
  }

  async logDelivery(tx: Tx, orgId: number, d: DeliveryLog): Promise<DeliveryRow> {
    const [row] = await tx
      .insert(webhookDeliveries)
      .values({
        orgId,
        webhookId: d.webhookId,
        eventName: d.event,
        statusCode: d.statusCode,
        latencyMs: d.latencyMs,
        attempts: d.attempts,
        isRetry: d.isRetry,
        payload: d.payload,
        responseBody: d.responseBody,
        error: d.error,
      })
      .returning();
    return row!;
  }

  /** The endpoint's own health numbers after an attempt. `final` means the retries are over. */
  async recordResult(
    tx: Tx,
    orgId: number,
    id: number,
    r: {
      ok: boolean;
      final: boolean;
      statusCode: number | null;
      latencyMs: number;
      error: string | null;
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE webhooks SET
        success_count = success_count + ${r.ok ? 1 : 0},
        failure_count = failure_count + ${!r.ok && r.final ? 1 : 0},
        retry_count = retry_count + ${!r.ok && !r.final ? 1 : 0},
        is_failing = CASE WHEN ${r.ok} THEN false WHEN ${r.final} THEN true ELSE is_failing END,
        last_status_code = ${r.statusCode},
        last_latency_ms = ${r.latencyMs},
        last_fired_at = now(),
        last_error = ${r.ok ? null : r.error}
      WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
