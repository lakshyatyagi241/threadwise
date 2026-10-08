import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { notifyConfig } from '../../config/domains/notifications.env';
import { MemberDirectory } from '../../realtime';
import { capRecipients } from './conversation-notification-rules';
import { NotificationFanout, type PendingNotification } from './notification-fanout';
import { NotificationPublisher } from './notification.publisher';
import {
  DEVICE_NOTIFY_EVENTS,
  DEVICE_RECOVERY_WINDOW_HOURS,
  DEVICE_RENOTIFY_MINUTES,
  deviceCopy,
  deviceNoticeFor,
  maskedNumber,
} from './phase2-notification-rules';

export const PERM_DEVICES_READ = 'wa.devices.read';

/**
 * Tells the people who can see the workspace's WhatsApp devices when a personal number drops, is logged out by WhatsApp, or comes back
 * (docs/specs/realtime-notifications.md catalogue row 8).
 *
 *   device.disconnected / device.logged_out   a row for everyone holding `wa.devices.read`, once per person and kind per hour
 *                                             (a flapping number does not flood the bell)
 *   device.status_changed (worker_silent)     the same, for the sweep that marks a silent worker's number disconnected
 *   device.connected                          "back online", only for a number whose drop was announced in the last 24 hours; the
 *                                             unread drop rows are marked read (the problem is gone), and a first pairing says nothing
 *
 * A disconnect the person asked for (`reason: user`) is not announced. A row never carries a QR, a pairing code or a number beyond its last
 * four digits. The device is read again at delivery: one that was deleted since is dropped. Idempotent through the outbox event id; the
 * live push goes out after the commit. Runs in the worker under the event's own tenant, never privileged.
 */
@Injectable()
export class DeviceNotificationConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'device-notifications';
  readonly eventTypes = DEVICE_NOTIFY_EVENTS;
  private readonly logger = new Logger(DeviceNotificationConsumer.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly registry: OutboxSubscriberRegistry,
    private readonly directory: MemberDirectory,
    private readonly fanout: NotificationFanout,
    private readonly publisher: NotificationPublisher,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const type = deviceNoticeFor(event.eventType, event.payload);
    const deviceId = Number(event.aggregateId);
    if (!type || !Number.isInteger(deviceId)) return;

    const viewers = (await this.directory.viewers(event.orgId, PERM_DEVICES_READ)).filter(
      (v) => v.scope !== null,
    );
    const capped = capRecipients(
      viewers.map((v) => v.userId),
      notifyConfig().maxRecipients,
    );
    if (capped.truncated) {
      this.logger.warn({ orgId: event.orgId, deviceId }, 'device notification truncated');
    }
    if (capped.userIds.length === 0) return;
    const reason = typeof event.payload.reason === 'string' ? event.payload.reason : null;

    const outcome = await this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT uuid, device_name, phone_digits, phone_number FROM devices
        WHERE org_id = ${event.orgId} AND id = ${deviceId}`);
      const d = res.rows[0] as
        | {
            uuid: string;
            device_name: string | null;
            phone_digits: string | null;
            phone_number: string | null;
          }
        | undefined;
      if (!d) return { pending: [] as PendingNotification[], cleared: [] as ClearedRows[] };
      const subject = { subjectKind: 'device', subjectUuid: d.uuid } as const;
      const copy = deviceCopy(
        type,
        d.device_name,
        maskedNumber(d.phone_digits ?? d.phone_number),
        reason,
      );
      const data = {
        deviceId: d.uuid,
        deviceName: d.device_name,
        maskedNumber: maskedNumber(d.phone_digits ?? d.phone_number),
        state: typeof event.payload.state === 'string' ? event.payload.state : undefined,
        reason,
      };
      const link = `/devices/${d.uuid}`;
      let userIds = capped.userIds;
      let cleared: ClearedRows[] = [];

      if (type === 'device_connected') {
        // Back online is news only to people who were told it went down; their drop rows are done with.
        const told = await tx.execute(sql`
          SELECT DISTINCT user_id FROM inbox_notifications
          WHERE org_id = ${event.orgId} AND subject_kind = 'device' AND subject_uuid = ${d.uuid}::uuid
            AND type IN ('device_disconnected', 'device_logged_out')
            AND created_at > now() - ${`${DEVICE_RECOVERY_WINDOW_HOURS} hours`}::interval`);
        const toldIds = new Set(
          (told.rows as Array<{ user_id: string | number }>).map((r) => Number(r.user_id)),
        );
        userIds = userIds.filter((id) => toldIds.has(id));
        const read = await tx.execute(sql`
          UPDATE inbox_notifications SET read_at = now()
          WHERE org_id = ${event.orgId} AND subject_kind = 'device' AND subject_uuid = ${d.uuid}::uuid
            AND type IN ('device_disconnected', 'device_logged_out') AND read_at IS NULL
          RETURNING user_id, uuid`);
        cleared = groupCleared(read.rows as Array<{ user_id: string | number; uuid: string }>);
      } else {
        // The same kind of drop already announced to this person inside the window stays quiet.
        const recent = await tx.execute(sql`
          SELECT DISTINCT user_id FROM inbox_notifications
          WHERE org_id = ${event.orgId} AND subject_kind = 'device' AND subject_uuid = ${d.uuid}::uuid
            AND type = ${type}
            AND created_at > now() - ${`${DEVICE_RENOTIFY_MINUTES} minutes`}::interval`);
        const quiet = new Set(
          (recent.rows as Array<{ user_id: string | number }>).map((r) => Number(r.user_id)),
        );
        userIds = userIds.filter((id) => !quiet.has(id));
      }

      const pending = await this.fanout.write(tx, event.orgId, type, userIds, () => ({
        title: copy.title,
        body: copy.body,
        link,
        data,
        dedupeKey: `device:${event.id}`,
        ...subject,
      }));
      return { pending, cleared };
    });

    // After the commit.
    await this.fanout.publish(event.orgId, outcome.pending);
    for (const c of outcome.cleared) {
      await this.publisher.read(event.orgId, c.userId, c.uuids);
    }
  }
}

export interface ClearedRows {
  userId: number;
  uuids: string[];
}

export function groupCleared(
  rows: Array<{ user_id: string | number; uuid: string }>,
): ClearedRows[] {
  const by = new Map<number, string[]>();
  for (const r of rows) {
    const id = Number(r.user_id);
    by.set(id, [...(by.get(id) ?? []), r.uuid]);
  }
  return [...by].map(([userId, uuids]) => ({ userId, uuids }));
}
