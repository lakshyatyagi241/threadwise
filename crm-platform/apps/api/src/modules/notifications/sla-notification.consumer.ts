import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { notifyConfig } from '../../config/domains/notifications.env';
import { DatabaseService } from '../../infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { MemberDirectory } from '../../realtime';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { capRecipients } from './conversation-notification-rules';
import { NotificationFanout } from './notification-fanout';

/** Raised by the SLA sweep when a conversation's response clock ran out (`conversation.sla_breached`). */
export const SLA_BREACH_EVENT = 'conversation.sla_breached';
/** The permission whose holders are told when a breached conversation has nobody to own it. */
export const PERM_SLA_MANAGE = 'inbox.sla.manage';
const PLAN_FEATURE = 'inbox_sla';

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Who hears of a breach: the assignee; else the members of the assigned team; else whoever manages SLA policies. Pure, for the tests. */
export function slaAudience(facts: {
  assigneeUserId: number | null;
  teamMemberIds: readonly number[];
  managerIds: readonly number[];
}): number[] {
  if (facts.assigneeUserId !== null) return [facts.assigneeUserId];
  if (facts.teamMemberIds.length > 0) return [...facts.teamMemberIds];
  return [...facts.managerIds];
}

export function slaCopy(kind: string): { title: string; body: string } {
  return kind === 'resolution'
    ? {
        title: 'SLA breached: not resolved in time',
        body: 'This conversation passed its resolution target.',
      }
    : {
        title: 'SLA breached: no first reply in time',
        body: 'This customer has waited longer than the first-response target.',
      };
}

/**
 * Tells the people responsible for a conversation that its response clock ran out (`sla_breached`): one bell row per person and breach
 * (the key carries the outbox event id, so a redelivery writes nothing twice and a later cycle's breach is news again). Active members
 * only, at most `NOTIFY_MAX_RECIPIENTS`. A workspace whose plan lacks `inbox_sla` hears nothing. The row names the conversation (the
 * customer's name stays in the app: the push carries only the title, see `push-payload.ts`).
 */
@Injectable()
export class SlaNotificationConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'sla-notifications';
  readonly eventTypes = [SLA_BREACH_EVENT] as const;
  private readonly logger = new Logger(SlaNotificationConsumer.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly registry: OutboxSubscriberRegistry,
    private readonly directory: MemberDirectory,
    private readonly entitlements: PlanEntitlementService,
    private readonly fanout: NotificationFanout,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const conversationUuid = str(event.payload.conversationId);
    if (!conversationUuid) return;
    if (!(await this.entitlements.featureEnabled(event.orgId, PLAN_FEATURE))) return;
    const kind = str(event.payload.kind) ?? 'first_response';
    const managers = (await this.directory.viewers(event.orgId, PERM_SLA_MANAGE))
      .filter((v) => v.scope !== null)
      .map((v) => v.userId);

    const pending = await this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT c.id, c.assignee_user_id, c.assignee_team_id, c.title, ct.name AS contact_name
        FROM conversations c LEFT JOIN contacts ct ON ct.org_id = c.org_id AND ct.id = c.contact_id
        WHERE c.org_id = ${event.orgId} AND c.uuid = ${conversationUuid}`);
      const c = (res.rows as Array<Record<string, unknown>>)[0];
      if (!c) return [];
      const teamMembers =
        c.assignee_team_id === null
          ? []
          : (
              await tx.execute(
                sql`SELECT user_id FROM team_members WHERE org_id = ${event.orgId} AND team_id = ${Number(c.assignee_team_id)}`,
              )
            ).rows.map((r) => Number((r as { user_id: unknown }).user_id));
      const wanted = slaAudience({
        assigneeUserId: c.assignee_user_id === null ? null : Number(c.assignee_user_id),
        teamMemberIds: teamMembers,
        managerIds: managers,
      });
      if (wanted.length === 0) return [];
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
      const copy = slaCopy(kind);
      const name = str(c.contact_name) ?? str(c.title);
      return this.fanout.write(tx, event.orgId, 'sla_breached', capped.userIds, () => ({
        title: copy.title,
        body: name ? `${name}: ${copy.body}` : copy.body,
        link: `/inbox?c=${conversationUuid}`,
        data: { conversationId: conversationUuid, kind },
        dedupeKey: `sla:${conversationUuid}:${kind}:${event.id}`,
        subjectKind: 'conversation',
        subjectUuid: conversationUuid,
      }));
    });
    await this.fanout.publish(event.orgId, pending);
    if (pending.length > 0) this.logger.debug({ orgId: event.orgId }, 'sla breach told');
  }
}
