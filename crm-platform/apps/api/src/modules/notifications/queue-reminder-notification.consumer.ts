import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { CONVERSATION_QUEUE_REMINDER } from '@crm/contracts';
import { notifyConfig } from '../../config/domains/notifications.env';
import { DatabaseService } from '../../infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { MemberDirectory, PERM_CONVERSATION_READ, channelOwnerSql } from '../../realtime';
import { senderName } from './conversation-notification.consumer';
import {
  capRecipients,
  recipientsForAssignment,
  recipientsForNewChat,
} from './conversation-notification-rules';
import { NotificationFanout } from './notification-fanout';

const PERM_ASSIGN = 'inbox.conversation.assign';
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * The reminder step of the waiting queue's timers (`conversation.queue_reminder`, written by `QueueTimersService`): the chat has waited
 * as long as the workspace chose, so the people who can take it are told once more. The recipients are decided at delivery time from the
 * chat as it is NOW: the members of its team who may read it, or, when it has no team, the people who may read it AND assign chats (the
 * leads). A chat that was taken, resolved or handed back since is no longer worth an alert. One bell row per person per wait (the dedupe
 * key holds the handoff card), written through the shared `NotificationFanout`, with the push after the commit. Worker only.
 */
@Injectable()
export class QueueReminderNotificationConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'queue-reminder-notifications';
  readonly eventTypes = [CONVERSATION_QUEUE_REMINDER] as const;
  private readonly logger = new Logger(QueueReminderNotificationConsumer.name);

  constructor(
    private readonly registry: OutboxSubscriberRegistry,
    private readonly db: DatabaseService,
    private readonly directory: MemberDirectory,
    private readonly fanout: NotificationFanout,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    if (!notifyConfig().conversationsEnabled) return;
    const conversationUuid = str(event.payload.conversationId);
    const handoffId = str(event.payload.handoffId);
    const minutes = typeof event.payload.minutes === 'number' ? event.payload.minutes : null;
    if (!conversationUuid || !handoffId) return;
    const orgId = event.orgId;

    const [readers, leads] = await Promise.all([
      this.directory.viewers(orgId, PERM_CONVERSATION_READ),
      this.directory.viewers(orgId, PERM_ASSIGN),
    ]);
    const pending = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT c.status, c.archived, c.handling, c.assignee_user_id, c.assignee_team_id, c.title, c.peer_name, c.peer_key,
               ch.kind AS channel_kind, ${channelOwnerSql('c')} AS channel_owner_user_id
        FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
        WHERE c.org_id = ${orgId} AND c.uuid = ${conversationUuid}::uuid`);
      const r = res.rows[0] as
        | {
            status: string;
            archived: boolean;
            handling: string | null;
            assignee_user_id: string | number | null;
            assignee_team_id: string | number | null;
            title: string;
            peer_name: string | null;
            peer_key: string;
            channel_kind: string;
            channel_owner_user_id: string | number | null;
          }
        | undefined;
      // Still waiting for somebody, or this is late news.
      if (
        !r ||
        r.status !== 'open' ||
        r.archived ||
        r.handling !== 'waiting' ||
        r.assignee_user_id !== null
      )
        return [];
      const teamId = r.assignee_team_id === null ? null : Number(r.assignee_team_id);
      const record = {
        assigneeUserId: null,
        assigneeTeamId: teamId,
        channelOwnerUserId:
          r.channel_owner_user_id === null ? null : Number(r.channel_owner_user_id),
      };
      const who =
        teamId !== null
          ? recipientsForAssignment(
              { toUserId: null, toTeamId: teamId, byUserId: null },
              record,
              readers,
            ).userIds
          : recipientsForNewChat(record, readers, leads);
      const capped = capRecipients(who, notifyConfig().maxRecipients);
      if (capped.truncated) {
        this.logger.warn(
          { orgId, conversationId: conversationUuid },
          'queue reminder truncated to the recipient cap',
        );
      }
      const name = senderName(r);
      const link = `/inbox?c=${conversationUuid}`;
      return this.fanout.write(tx, orgId, 'chat_waiting', capped.userIds, (userId) => ({
        title: `No one has taken ${name ?? 'a customer'} yet`,
        body: minutes === null ? null : `Waiting in the queue for ${minutes} minutes`,
        link,
        data: {
          conversationId: conversationUuid,
          contactName: name,
          channelKind: r.channel_kind,
          source: 'queue_reminder',
          minutes,
        },
        dedupeKey: `queue_reminder:${handoffId}:${userId}`,
        subjectKind: 'conversation',
        subjectUuid: conversationUuid,
      }));
    });
    await this.fanout.publish(orgId, pending);
  }
}
