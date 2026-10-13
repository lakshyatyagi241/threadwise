import { Injectable, Logger, type OnModuleInit, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { notifyConfig } from '../../config/domains/notifications.env';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { DatabaseService } from '../../infra/db/database.service';
import { MemberDirectory } from '../../realtime';
import {
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../auth/unofficial-whatsapp.port';
import { capRecipients } from './conversation-notification-rules';
import { groupCleared, type ClearedRows } from './device-notification.consumer';
import {
  DEVICE_GROUP_NOTIFY_EVENTS,
  PERM_DEVICE_GROUPS_MANAGE,
  deviceGroupNoticeFor,
  deviceGroupRemovedCopy,
  deviceGroupRemovedKey,
  deviceGroupRequestCollapseKey,
  deviceGroupRequestCopy,
  deviceGroupRequestKey,
} from './device-group-notification-rules';
import { NotificationFanout, type PendingNotification } from './notification-fanout';
import { NotificationPublisher } from './notification.publisher';

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

const SUBJECT_KIND = 'device_group';

interface GroupFacts {
  uuid: string;
  subject: string | null;
  deviceUuid: string;
  deviceName: string | null;
  left: boolean;
  pending: number;
}

/**
 * Tells the people who manage a personal number's WhatsApp groups when someone asks to join and when the number is removed from a group
 * (the personal-number twin of `WabaGroupNotificationConsumer`, BL-099):
 *
 *   whatsapp.device_group.join_request (new)      ONE unread row per person and group (`collapse_key dgjr:<group>`), its count going up with
 *                                                 every request ("5 people want to join Sales"); a burst of ten is one row
 *   whatsapp.device_group.join_request (settled)  no row: when the queue is empty the unread request rows of that group are marked read
 *   whatsapp.device_group.left (removed: true)    one row per person, "Removed from <group>" (a leave made on the phone or on the screen is
 *                                                 not news)
 *
 * Audience: everyone holding `wa.groups.manage`, at most `NOTIFY_MAX_RECIPIENTS`, and only while the workspace is on the unofficial
 * allow-list. The group is read again at delivery: one deleted since is dropped, and an event the group's current state has overtaken (a
 * request that was handled, a number that is back in the group) writes nothing. Rows carry the group's name, the number's label and a count,
 * never a member's phone number or the invite code. Idempotent through the outbox event id; the live push goes out after the commit. Runs
 * in the worker under the event's own tenant.
 */
@Injectable()
export class DeviceGroupNotificationConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'device-group-notifications';
  readonly eventTypes = DEVICE_GROUP_NOTIFY_EVENTS;
  private readonly logger = new Logger(DeviceGroupNotificationConsumer.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly registry: OutboxSubscriberRegistry,
    private readonly directory: MemberDirectory,
    private readonly fanout: NotificationFanout,
    private readonly publisher: NotificationPublisher,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly gate: UnofficialWhatsappGate,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const notice = deviceGroupNoticeFor(event.eventType, event.payload);
    const groupUuid = str(event.payload.groupUuid);
    if (!notice || !groupUuid) return;
    if (!(await this.gate.isEnabledFor(event.orgId))) return;

    const viewers = (await this.directory.viewers(event.orgId, PERM_DEVICE_GROUPS_MANAGE)).filter(
      (v) => v.scope !== null,
    );
    const capped = capRecipients(
      viewers.map((v) => v.userId),
      notifyConfig().maxRecipients,
    );
    if (capped.truncated) {
      this.logger.warn({ orgId: event.orgId, groupUuid }, 'device group notification truncated');
    }

    const outcome = await this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => {
      const empty = { pending: [] as PendingNotification[], cleared: [] as ClearedRows[] };
      const g = await this.group(tx, event.orgId, groupUuid);
      if (!g) return empty;
      const subject = { subjectKind: SUBJECT_KIND, subjectUuid: g.uuid } as const;
      const data = { groupId: g.uuid, deviceId: g.deviceUuid, groupName: g.subject };
      const link = `/devices/groups?device=${g.deviceUuid}`;

      if (notice.kind === 'settled') {
        // Nothing is waiting any more: close the join-request rows of this group.
        if (g.pending > 0) return empty;
        return {
          pending: [] as PendingNotification[],
          cleared: await this.markRead(tx, event.orgId, g.uuid, 'device_group_join_request'),
        };
      }
      if (capped.userIds.length === 0) return empty;

      if (notice.kind === 'requested') {
        // The queue was emptied (or the number left) before this event was delivered: the requests are already dealt with.
        if (g.pending === 0 || g.left) return empty;
        const pending = await this.fanout.writeCollapsing(
          tx,
          event.orgId,
          notice.type,
          capped.userIds,
          () => ({
            link,
            dedupeKey: deviceGroupRequestKey(g.uuid, event.id),
            eventId: Number(event.id),
            collapseKey: deviceGroupRequestCollapseKey(g.uuid),
            adds: notice.count,
            ...subject,
            build: (count) => {
              const copy = deviceGroupRequestCopy(g.subject, count);
              return { title: copy.title, body: copy.body, data: { ...data, count } };
            },
          }),
          { throttleKey: `dg:${g.uuid}` },
        );
        return { pending, cleared: [] as ClearedRows[] };
      }

      // removed: a number that is back in the group since (the row was cleared) has nothing to report.
      if (!g.left) return empty;
      const copy = deviceGroupRemovedCopy(g.subject, g.deviceName);
      const pending = await this.fanout.write(tx, event.orgId, notice.type, capped.userIds, () => ({
        title: copy.title,
        body: copy.body,
        link,
        data,
        dedupeKey: deviceGroupRemovedKey(g.uuid, event.id),
        ...subject,
      }));
      // Requests waiting on a group the number is not in any more cannot be handled: close their rows.
      const cleared = await this.markRead(tx, event.orgId, g.uuid, 'device_group_join_request');
      return { pending, cleared };
    });

    // After the commit.
    await this.fanout.publish(event.orgId, outcome.pending);
    for (const c of outcome.cleared) {
      await this.publisher.read(event.orgId, c.userId, c.uuids);
    }
  }

  /** The group as it is now, with its number's uuid and label and how many join requests wait. Null when it is gone. */
  private async group(tx: Tx, orgId: number, uuid: string): Promise<GroupFacts | null> {
    const res = await tx.execute(sql`
      SELECT g.uuid, g.subject, d.uuid AS device_uuid, d.device_name,
             (g.left_at IS NOT NULL) AS "left", jsonb_array_length(g.join_requests) AS pending
        FROM wa_device_groups g
        JOIN devices d ON d.org_id = g.org_id AND d.id = g.device_id
       WHERE g.org_id = ${orgId} AND g.uuid = ${uuid}::uuid`);
    const r = res.rows[0] as
      | {
          uuid: string;
          subject: string | null;
          device_uuid: string;
          device_name: string | null;
          left: boolean;
          pending: string | number;
        }
      | undefined;
    if (!r) return null;
    return {
      uuid: r.uuid,
      subject: r.subject,
      deviceUuid: r.device_uuid,
      deviceName: r.device_name,
      left: r.left === true,
      pending: Number(r.pending),
    };
  }

  /** Marks the unread rows of this type about the group as read, for everyone; returns them per person for the live announcement. */
  private async markRead(
    tx: Tx,
    orgId: number,
    groupUuid: string,
    type: string,
  ): Promise<ClearedRows[]> {
    const read = await tx.execute(sql`
      UPDATE inbox_notifications SET read_at = now()
      WHERE org_id = ${orgId} AND subject_kind = ${SUBJECT_KIND} AND subject_uuid = ${groupUuid}::uuid
        AND type = ${type} AND read_at IS NULL
      RETURNING user_id, uuid`);
    return groupCleared(read.rows as Array<{ user_id: string | number; uuid: string }>);
  }
}
