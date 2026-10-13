import type { Tx } from '@crm/db';
import type { OutboxService } from '../../kernel/outbox/outbox.service';
import type { GroupEventDraft } from './device-groups-rules';

/** `event_outbox.aggregate_module` of every `whatsapp.device_group.*` event; the aggregate id is `wa_device_groups.id`. */
export const DEVICE_GROUP_AGGREGATE = 'whatsapp-devices-baileys';

/**
 * Writes the drafts to the outbox in the caller's transaction. The payload names the group and the number by uuid (the consumers in other
 * domains must not need internal ids) and carries counters only: never a member's number, the subject or the invite code.
 */
export async function emitDeviceGroupEvents(
  outbox: OutboxService,
  tx: Tx,
  orgId: number,
  group: { id: number; uuid: string; device_uuid: string },
  drafts: GroupEventDraft[],
): Promise<void> {
  for (const d of drafts) {
    await outbox.emit(tx, {
      orgId,
      aggregateModule: DEVICE_GROUP_AGGREGATE,
      aggregateId: group.id,
      eventType: d.type,
      payload: { groupUuid: group.uuid, deviceId: group.device_uuid, ...d.extra },
    });
  }
}
