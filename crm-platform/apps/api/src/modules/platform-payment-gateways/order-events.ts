import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import type { OutboxService } from '../../kernel/outbox/outbox.service';
import type { OrderRow } from './orders.repository';

/**
 * The audit row and the outbox event of an order change, written in the SAME transaction as the change (repo rule 6). Unlike
 * AuditService it takes the org from the order, because the return and webhook receivers run with no tenant context at all.
 * Order numbers, statuses and amounts are recorded; credentials and provider payloads never are.
 */
export type OrderEvent = 'created' | 'paid' | 'failed' | 'cancelled';

export async function recordOrderEvent(
  tx: Tx,
  outbox: OutboxService,
  order: Pick<
    OrderRow,
    'id' | 'orgId' | 'orderNumber' | 'kind' | 'currency' | 'totalAmount' | 'gatewaySlug'
  >,
  event: OrderEvent,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const ctx = RequestContextStore.peek();
  const actorType =
    ctx && ctx.orgId === order.orgId && ctx.actorType === 'user' ? 'user' : 'system';
  const delta = {
    status: { old: null, new: event === 'created' ? 'pending' : event === 'paid' ? 'paid' : event },
    orderNumber: { old: null, new: order.orderNumber },
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, { old: null, new: v }])),
  };
  await tx.execute(sql`
    INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id)
    VALUES (${order.orgId}, ${actorType === 'user' ? ctx!.actorId : null}, ${actorType}, 'orders', ${order.id},
      ${event === 'created' ? 'insert' : 'update'}, ${JSON.stringify(delta)}::jsonb, ${ctx?.requestId ?? null})`);
  await outbox.emit(tx, {
    aggregateModule: 'orders',
    aggregateId: order.id,
    eventType: `paygw.order.${event}`,
    orgId: order.orgId,
    payload: {
      orderNumber: order.orderNumber,
      kind: order.kind,
      currency: order.currency,
      total: order.totalAmount,
      gateway: order.gatewaySlug,
      ...extra,
    },
  });
}
