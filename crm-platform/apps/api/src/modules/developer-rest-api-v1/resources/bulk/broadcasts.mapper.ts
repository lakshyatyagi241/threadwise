import type { BroadcastResponse, BroadcastDetail } from '@crm/contracts';
import type { V1Broadcast } from '@crm/contracts';

interface Cascaded {
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  clicked: number;
}

/**
 * Reference's `pending`: whatever is neither sent nor failed, so a recipient being processed counts as pending (its `processing` bucket is
 * not exposed). Floored at 0.
 */
const pending = (total: number, c: Cascaded) => Math.max(0, total - c.sent - c.failed);

/** A broadcast row (create, list) with the cached counters; `sent` includes delivered includes read, as the counters are kept. */
export function toV1Broadcast(b: BroadcastResponse): V1Broadcast {
  const c: Cascaded = {
    sent: b.successCount,
    delivered: b.deliveredCount,
    read: b.readCount,
    failed: b.failCount,
    clicked: b.clickedCount,
  };
  return shape(b, c);
}

/** The detail read: counts come live from the recipient rows (TW-API-082 rule 2's slow path, always, so the answer never lags a webhook). */
export function toV1BroadcastDetail(d: BroadcastDetail): V1Broadcast {
  const k = d.counts;
  return shape(d.broadcast, {
    sent: k.sent,
    delivered: k.delivered,
    read: k.read,
    failed: k.failed,
    clicked: k.clicked,
  });
}

function shape(b: BroadcastResponse, c: Cascaded): V1Broadcast {
  return {
    id: b.id,
    name: b.name,
    status: b.status,
    template_id: b.templateId,
    device_id: b.senderKey,
    total_recipients: b.totalRecipients,
    counts: { ...c, pending: pending(b.totalRecipients, c) },
    scheduled_at: b.scheduledAt,
    completed_at: b.completedAt,
    created_at: b.createdAt,
    updated_at: b.updatedAt,
  };
}
