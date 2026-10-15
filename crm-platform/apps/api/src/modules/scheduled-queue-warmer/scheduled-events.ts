import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { OutboxService } from '../../kernel/outbox/outbox.service';

export const SCHEDULED_STATUS_EVENT = 'scheduled.status_changed';

/**
 * `scheduled.status_changed` for a scheduled message that just reached a terminal state (`completed` or `failed`), in the caller's
 * transaction so the event commits with the status it describes. The scheduled-message runner had no events before; the bell's
 * "your scheduled message finished or failed" notification (BL-096 phase 2) is its first consumer. The payload carries no recipient
 * list or message text: the consumer re-reads the record for the name and the creator.
 */
export async function emitScheduledStatus(
  outbox: OutboxService,
  tx: Tx,
  orgId: number,
  scheduledId: number,
  status: 'completed' | 'failed',
  extra: { reason?: string | null; sent?: number; failed?: number } = {},
): Promise<void> {
  const res = await tx.execute(sql`
    SELECT uuid, schedule_name FROM scheduled_messages WHERE org_id = ${orgId} AND id = ${scheduledId}`);
  const row = res.rows[0] as { uuid: string; schedule_name: string } | undefined;
  if (!row) return;
  await outbox.emit(tx, {
    orgId,
    aggregateModule: 'scheduled_messages',
    aggregateId: scheduledId,
    eventType: SCHEDULED_STATUS_EVENT,
    payload: {
      uuid: row.uuid,
      name: row.schedule_name,
      status,
      reason: extra.reason ?? null,
      sent: extra.sent,
      failed: extra.failed,
    },
  });
}

export const SCHEDULED_UPDATED_EVENT = 'scheduled.updated';

/**
 * `scheduled.updated` when a person edited a schedule that had not started (TW-SCHED-016), in the edit's own transaction. The payload
 * names the fields that changed and nothing else: no message text, no recipients.
 */
export async function emitScheduledUpdated(
  outbox: OutboxService,
  tx: Tx,
  orgId: number,
  scheduledId: number,
  fields: string[],
): Promise<void> {
  const res = await tx.execute(sql`
    SELECT uuid, schedule_name FROM scheduled_messages WHERE org_id = ${orgId} AND id = ${scheduledId}`);
  const row = res.rows[0] as { uuid: string; schedule_name: string } | undefined;
  if (!row) return;
  await outbox.emit(tx, {
    orgId,
    aggregateModule: 'scheduled_messages',
    aggregateId: scheduledId,
    eventType: SCHEDULED_UPDATED_EVENT,
    payload: { uuid: row.uuid, name: row.schedule_name, fields },
  });
}
