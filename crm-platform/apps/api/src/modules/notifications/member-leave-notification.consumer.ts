import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  MEMBER_LEAVE_STARTED,
  PERM_TEAM_LEAVE_MANAGE,
  ROUTING_BLOCKED_BY_LEAVE,
} from '@crm/contracts';
import { notifyConfig } from '../../config/domains/notifications.env';
import { DatabaseService } from '../../infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { MemberDirectory } from '../../realtime';
import { capRecipients } from './conversation-notification-rules';
import { NotificationFanout } from './notification-fanout';

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The wording of "somebody went on leave", with what is stranded. Pure, for the tests. */
export function leaveStartedCopy(p: {
  name: string;
  endsOn: string | null;
  ownedContacts: number;
  openConversations: number;
  delegateName: string | null;
}): { title: string; body: string } {
  const until = p.endsOn ? ` until ${p.endsOn}` : '';
  const holds =
    p.ownedContacts + p.openConversations === 0
      ? 'They hold no contacts or open chats.'
      : `They own ${p.ownedContacts} contact${p.ownedContacts === 1 ? '' : 's'} and ${p.openConversations} open chat${p.openConversations === 1 ? '' : 's'}.`;
  const cover = p.delegateName
    ? ` ${p.delegateName} stands in for them.`
    : ' They named no delegate: reassign their work if it should be looked after.';
  return { title: `${p.name} is on leave${until}`, body: `${holds}${cover}` };
}

/**
 * Tells the leads about leave (BL-112): who holds `team.leave.manage` for everyone (managers and above) hears that
 *  - a member went on leave (`member.leave.started`), with how many contacts and open chats they hold, whether a delegate covers them, and a
 *    link to the reassign screen (`member_leave_started`); one bell row per lead and leave, so a redelivery writes nothing twice;
 *  - routing found nobody for a new chat because the people it wanted are away (`routing.blocked_by_leave`, `assignment_blocked_by_leave`).
 * The person who left is not told about their own leave. Active members only, at most `NOTIFY_MAX_RECIPIENTS`.
 */
@Injectable()
export class MemberLeaveNotificationConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'member-leave-notifications';
  readonly eventTypes = [MEMBER_LEAVE_STARTED, ROUTING_BLOCKED_BY_LEAVE] as const;
  private readonly logger = new Logger(MemberLeaveNotificationConsumer.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly registry: OutboxSubscriberRegistry,
    private readonly directory: MemberDirectory,
    private readonly fanout: NotificationFanout,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    if (event.eventType === MEMBER_LEAVE_STARTED) return this.leaveStarted(event);
    if (event.eventType === ROUTING_BLOCKED_BY_LEAVE) return this.blocked(event);
  }

  /** Leads: holders of the manage key with scope `all`. */
  private async leads(orgId: number): Promise<number[]> {
    return (await this.directory.viewers(orgId, PERM_TEAM_LEAVE_MANAGE))
      .filter((v) => v.scope === 'all')
      .map((v) => v.userId);
  }

  private async leaveStarted(event: OutboxEvent): Promise<void> {
    const p = event.payload;
    const leaveId = str(p.leaveId);
    const memberUuid = str(p.memberId);
    const memberUserId = typeof p.memberUserId === 'number' ? p.memberUserId : null;
    const name = str(p.memberName);
    if (!leaveId || !memberUuid || !name) return;
    const wanted = (await this.leads(event.orgId)).filter((id) => id !== memberUserId);
    if (wanted.length === 0) return;

    const pending = await this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => {
      const active = await tx.execute(
        sql`SELECT id FROM users WHERE org_id = ${event.orgId} AND status = 'active'
            AND id IN (${sql.join(
              wanted.map((id) => sql`${id}`),
              sql`, `,
            )})`,
      );
      const capped = capRecipients(
        active.rows.map((r) => Number((r as { id: unknown }).id)),
        notifyConfig().maxRecipients,
      );
      const delegateUuid = str(p.delegateId);
      let delegateName: string | null = null;
      if (delegateUuid) {
        const d = await tx.execute(
          sql`SELECT full_name FROM users WHERE org_id = ${event.orgId} AND uuid = ${delegateUuid}`,
        );
        delegateName = str((d.rows[0] as { full_name?: unknown } | undefined)?.full_name);
      }
      const copy = leaveStartedCopy({
        name,
        endsOn: str(p.endsOn),
        ownedContacts: num(p.ownedContacts),
        openConversations: num(p.openConversations),
        delegateName,
      });
      return this.fanout.write(tx, event.orgId, 'member_leave_started', capped.userIds, () => ({
        title: copy.title,
        body: copy.body,
        link: `/team-members?member=${memberUuid}&reassign=1`,
        data: {
          leaveId,
          memberId: memberUuid,
          endsOn: str(p.endsOn),
          ownedContacts: num(p.ownedContacts),
          openConversations: num(p.openConversations),
        },
        dedupeKey: `leave-started:${leaveId}`,
        subjectKind: 'member',
        subjectUuid: memberUuid,
      }));
    });
    await this.fanout.publish(event.orgId, pending);
    if (pending.length > 0) this.logger.debug({ orgId: event.orgId }, 'leave start told');
  }

  private async blocked(event: OutboxEvent): Promise<void> {
    const conversationUuid = str(event.payload.conversationId);
    const messageUuid = str(event.payload.messageUuid);
    if (!conversationUuid || !messageUuid) return;
    const wanted = await this.leads(event.orgId);
    if (wanted.length === 0) return;

    const pending = await this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => {
      const active = await tx.execute(
        sql`SELECT id FROM users WHERE org_id = ${event.orgId} AND status = 'active'
            AND id IN (${sql.join(
              wanted.map((id) => sql`${id}`),
              sql`, `,
            )})`,
      );
      const capped = capRecipients(
        active.rows.map((r) => Number((r as { id: unknown }).id)),
        notifyConfig().maxRecipients,
      );
      return this.fanout.write(
        tx,
        event.orgId,
        'assignment_blocked_by_leave',
        capped.userIds,
        () => ({
          title: 'A new chat has nobody to take it',
          body: 'The people routing chose are on leave and have no available delegate. Assign it by hand.',
          link: `/inbox?c=${conversationUuid}`,
          data: { conversationId: conversationUuid },
          dedupeKey: `routing-blocked:${conversationUuid}:${messageUuid}`,
          subjectKind: 'conversation',
          subjectUuid: conversationUuid,
        }),
      );
    });
    await this.fanout.publish(event.orgId, pending);
  }
}
