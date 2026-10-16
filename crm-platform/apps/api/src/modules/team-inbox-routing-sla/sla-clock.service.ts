import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import { dueAt, effectiveTargets } from '../../common/sla-time';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { ConversationsRepository, InboxRealtimePublisher } from '../team-inbox-conversations';
import { SlaPoliciesRepository } from './sla-policies.repository';

export const SLA_PLAN_FEATURE = 'inbox_sla';

export type SlaStartOutcome =
  | { started: true; policy: string; firstResponseDue: string | null; resolutionDue: string | null }
  | { started: false; reason: 'plan' | 'no_policy' | 'no_targets' | 'not_found' };

/**
 * Starts the response clocks of a conversation (TW-TIB2-026): when the customer starts a conversation, or writes again after it was
 * resolved or closed, the workspace's default policy gives the due times. Targets come from the policy and the conversation's priority
 * (an override replaces the policy's value); with `respectBusinessHours` the minutes count only inside the workspace's business hours
 * in its time zone. The clock starts when the customer began waiting (`waiting_since`), so a message that was queued behind others is
 * not late before it started.
 *
 * Fixes over Reference: a conversation that was resolved starts a new cycle when the customer writes again (Reference's clock ran once
 * per conversation for ever); no policy marked default means no clock (Reference applied "any" policy by accident); a plan without
 * `inbox_sla` starts nothing.
 */
@Injectable()
export class SlaClockService {
  private readonly logger = new Logger(SlaClockService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly policies: SlaPoliciesRepository,
    private readonly entitlements: PlanEntitlementService,
    private readonly conversations: ConversationsRepository,
    private readonly publisher: InboxRealtimePublisher,
  ) {}

  async start(orgId: number, conversationUuid: string, now = new Date()): Promise<SlaStartOutcome> {
    if (!(await this.entitlements.featureEnabled(orgId, SLA_PLAN_FEATURE))) {
      return { started: false, reason: 'plan' };
    }
    const done = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT id, priority, waiting_since FROM conversations
        WHERE org_id = ${orgId} AND uuid = ${conversationUuid} FOR UPDATE`);
      const c = (res.rows as Array<Record<string, unknown>>)[0];
      if (!c) return { started: false as const, reason: 'not_found' as const };
      const policy = await this.policies.defaultPolicy(tx, orgId);
      if (!policy) return { started: false as const, reason: 'no_policy' as const };

      const targets = effectiveTargets(policy, policy.priorityOverrides, String(c.priority));
      if (targets.firstResponseMinutes === null && targets.resolutionMinutes === null) {
        return { started: false as const, reason: 'no_targets' as const };
      }
      // The schedule and the zone the owner set on the workspace (see RoutingRulesRepository.businessHours).
      const settings = (
        await tx.execute(sql`
          SELECT ws.business_hours, COALESCE(o.settings ->> 'timezone', 'UTC') AS timezone
          FROM organizations o
          LEFT JOIN workspace_settings ws ON ws.org_id = o.id
          WHERE o.id = ${orgId}`)
      ).rows[0] as { business_hours?: unknown; timezone?: string | null } | undefined;
      const hours = settings?.business_hours ?? null;
      const zone = settings?.timezone ?? 'UTC';
      const anchor = c.waiting_since ? new Date(String(c.waiting_since)) : now;
      const first = dueAt(
        anchor,
        targets.firstResponseMinutes,
        policy.respectBusinessHours,
        hours,
        zone,
      );
      const resolution = dueAt(
        anchor,
        targets.resolutionMinutes,
        policy.respectBusinessHours,
        hours,
        zone,
      );

      await tx.execute(sql`
        UPDATE conversations SET sla_policy_id = ${policy.id},
          sla_first_response_due = ${first ? first.toISOString() : null}::timestamptz,
          sla_resolution_due = ${resolution ? resolution.toISOString() : null}::timestamptz,
          sla_breached = false
        WHERE org_id = ${orgId} AND id = ${Number(c.id)}`);
      const row = await this.conversations.byUuid(tx, orgId, conversationUuid);
      return {
        started: true as const,
        policy: policy.uuid,
        firstResponseDue: first ? first.toISOString() : null,
        resolutionDue: resolution ? resolution.toISOString() : null,
        row,
      };
    });
    if (!done.started) return done;
    if (done.row) {
      await this.publisher.conversationChanged(
        orgId,
        {
          uuid: done.row.uuid,
          rowVersion: done.row.rowVersion,
          assigneeUserId: done.row.assigneeUserId,
          assigneeTeamId: done.row.assigneeTeamId,
          channelOwnerUserId: done.row.channelOwnerUserId,
        },
        ['sla'],
      );
    }
    this.logger.debug({ orgId, conversationUuid }, 'sla clock started');
    return {
      started: true,
      policy: done.policy,
      firstResponseDue: done.firstResponseDue,
      resolutionDue: done.resolutionDue,
    };
  }
}
