import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { notifyConfig } from '../../config/domains/notifications.env';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { DatabaseService } from '../../infra/db/database.service';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { MemberDirectory } from '../../realtime';
import { capRecipients } from './conversation-notification-rules';
import { groupCleared, type ClearedRows } from './device-notification.consumer';
import {
  GROUPS_PLAN_FEATURE,
  GROUP_NOTIFY_EVENTS,
  GROUP_RECOVERY_WINDOW_DAYS,
  PERM_GROUPS_MANAGE,
  groupFlagCopy,
  groupFlagKey,
  groupNoticeFor,
  groupRequestCollapseKey,
  groupRequestCopy,
  groupRequestKey,
} from './group-notification-rules';
import { NotificationFanout, type PendingNotification } from './notification-fanout';
import { NotificationPublisher } from './notification.publisher';

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

interface GroupFacts {
  uuid: string;
  subject: string | null;
  suspended: boolean;
  connectionUuid: string | null;
  pending: number;
}

const SUBJECT_KIND = 'waba_group';

/**
 * Tells the people who manage a business number's WhatsApp groups when someone asks to join and when Meta suspends or restores a group
 * (BL-099, docs/specs/waba-groups-management.md 11):
 *
 *   whatsapp.group.join_request (new)      ONE unread row per person and group (`collapse_key wgjr:<group>`), its count going up with every
 *                                          request ("5 people want to join Sales"); a burst of ten is one row
 *   whatsapp.group.join_request (handled)  no row: requests that were approved, rejected or revoked leave the queue, and when it is empty
 *                                          the unread join-request rows of that group are marked read (nothing is waiting any more)
 *   whatsapp.group.suspended (true)        a row for each person, "<group> was suspended"
 *   whatsapp.group.suspended (false)       "<group> is active again", only for people told about the suspension in the last 30 days; their
 *                                          unread suspension rows are marked read
 *
 * Audience: everyone holding `waba.groups.manage` (admins included), at most `NOTIFY_MAX_RECIPIENTS`. The Groups plan feature gates the
 * lot: a workspace whose plan lacks `waba_groups` gets nothing, silently. The group is read again at delivery: one deleted since is
 * dropped, and an event the group's current state has already overtaken (a suspension that was cleared before the worker got to it, a
 * request that was handled) writes nothing. The rows carry the group's name and a count, never a member's number or the invite link.
 * Idempotent through the outbox event id; the live push goes out after the commit. Runs in the worker under the event's own tenant.
 */
@Injectable()
export class WabaGroupNotificationConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'waba-group-notifications';
  readonly eventTypes = GROUP_NOTIFY_EVENTS;
  private readonly logger = new Logger(WabaGroupNotificationConsumer.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly registry: OutboxSubscriberRegistry,
    private readonly directory: MemberDirectory,
    private readonly entitlements: PlanEntitlementService,
    private readonly fanout: NotificationFanout,
    private readonly publisher: NotificationPublisher,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const notice = groupNoticeFor(event.eventType, event.payload);
    const groupUuid = str(event.payload.groupUuid);
    if (!notice || !groupUuid) return;
    // The plan gate of the Groups screen: a plan without the feature has no Groups, so nobody hears about one.
    if (!(await this.entitlements.featureEnabled(event.orgId, GROUPS_PLAN_FEATURE))) return;

    const viewers = (await this.directory.viewers(event.orgId, PERM_GROUPS_MANAGE)).filter(
      (v) => v.scope !== null,
    );
    const capped = capRecipients(
      viewers.map((v) => v.userId),
      notifyConfig().maxRecipients,
    );
    if (capped.truncated) {
      this.logger.warn({ orgId: event.orgId, groupUuid }, 'group notification truncated');
    }

    const outcome = await this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => {
      const empty = { pending: [] as PendingNotification[], cleared: [] as ClearedRows[] };
      const g = await this.group(tx, event.orgId, groupUuid);
      if (!g) return empty;
      const subject = { subjectKind: SUBJECT_KIND, subjectUuid: g.uuid } as const;
      const data = {
        groupId: g.uuid,
        connectionId: g.connectionUuid ?? undefined,
        groupName: g.subject,
      };
      const link = g.connectionUuid ? `/waba-groups?account=${g.connectionUuid}` : '/waba-groups';

      if (notice.kind === 'settled') {
        // Nothing is waiting any more: close the join-request rows of this group.
        if (g.pending > 0) return empty;
        return {
          pending: [] as PendingNotification[],
          cleared: await this.markRead(tx, event.orgId, g.uuid, 'waba_group_join_request'),
        };
      }
      if (capped.userIds.length === 0) return empty;

      if (notice.kind === 'requested') {
        // The queue was emptied before this event was delivered: the requests are already dealt with.
        if (g.pending === 0) return empty;
        const pending = await this.fanout.writeCollapsing(
          tx,
          event.orgId,
          notice.type,
          capped.userIds,
          () => ({
            link,
            dedupeKey: groupRequestKey(g.uuid, event.id),
            eventId: Number(event.id),
            collapseKey: groupRequestCollapseKey(g.uuid),
            adds: notice.count,
            ...subject,
            build: (count) => {
              const copy = groupRequestCopy(g.subject, count);
              return { title: copy.title, body: copy.body, data: { ...data, count } };
            },
          }),
          { throttleKey: `wg:${g.uuid}` },
        );
        return { pending, cleared: [] as ClearedRows[] };
      }

      // Overtaken by a later change of the flag: its own event speaks for the present state.
      if (notice.kind === 'suspended' ? !g.suspended : g.suspended) return empty;

      let userIds = capped.userIds;
      let cleared: ClearedRows[] = [];
      if (notice.kind === 'cleared') {
        // "Active again" is news only to people who were told it was suspended; their suspension rows are done with.
        const told = await tx.execute(sql`
          SELECT DISTINCT user_id FROM inbox_notifications
          WHERE org_id = ${event.orgId} AND subject_kind = ${SUBJECT_KIND} AND subject_uuid = ${g.uuid}::uuid
            AND type = 'waba_group_suspended'
            AND created_at > now() - ${`${GROUP_RECOVERY_WINDOW_DAYS} days`}::interval`);
        const toldIds = new Set(
          (told.rows as Array<{ user_id: string | number }>).map((r) => Number(r.user_id)),
        );
        userIds = userIds.filter((id) => toldIds.has(id));
        cleared = await this.markRead(tx, event.orgId, g.uuid, 'waba_group_suspended');
      }
      const copy = groupFlagCopy(notice.type, g.subject);
      const pending = await this.fanout.write(tx, event.orgId, notice.type, userIds, () => ({
        title: copy.title,
        body: copy.body,
        link,
        data,
        dedupeKey: groupFlagKey(g.uuid, event.id),
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

  /** The group as it is now, with its number's uuid and how many join requests wait. Null when it is gone. */
  private async group(tx: Tx, orgId: number, uuid: string): Promise<GroupFacts | null> {
    const res = await tx.execute(sql`
      SELECT g.uuid, g.subject, g.suspended, c.uuid AS connection_uuid,
             CASE WHEN jsonb_typeof(g.meta_json -> 'join_requests') = 'object'
                  THEN (SELECT count(*) FROM jsonb_object_keys(g.meta_json -> 'join_requests'))
                  ELSE 0 END AS pending
      FROM waba_groups g
      LEFT JOIN wa_provider_configs c ON c.org_id = g.org_id AND c.id = g.provider_config_id
      WHERE g.org_id = ${orgId} AND g.uuid = ${uuid}::uuid`);
    const r = res.rows[0] as
      | {
          uuid: string;
          subject: string | null;
          suspended: boolean;
          connection_uuid: string | null;
          pending: string | number;
        }
      | undefined;
    if (!r) return null;
    return {
      uuid: r.uuid,
      subject: r.subject,
      suspended: r.suspended === true,
      connectionUuid: r.connection_uuid,
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
