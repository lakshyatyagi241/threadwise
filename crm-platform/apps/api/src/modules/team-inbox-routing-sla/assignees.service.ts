import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  AGENT_STATUS_AUTOMATION_FEATURE,
  type InboxAssignee,
  type InboxAssigneeTeam,
  type InboxAssigneesResponse,
} from '@crm/contracts';
import { loadAgentStatuses, presenceWord } from '../../common/agent-status';
import { RequestContextStore } from '../../common/context/request-context';
import { loadWorkspaceCalendar, onLeaveMap } from '../../common/workspace-calendar';
import { DatabaseService } from '../../infra/db/database.service';
import { MemberDirectory, PERM_CONVERSATION_READ } from '../../realtime';
import { PlanEntitlementService } from '../plans-subscriptions-trials';

type Raw = Record<string, unknown>;

/**
 * `GET /inbox/assignees`: the picker's content (TW-TIB2-021). Active members who may read the inbox (the ones a conversation can be
 * given to, see `AssignmentService`), each with their availability and how many conversations they hold right now, and the teams.
 *
 * Someone on leave today (the workspace calendar, BL-112) carries `onLeave` with the last day away and their delegate: the picker greys
 * them ("On leave until <date>"). A manual assignment to them is still allowed; routing never picks them.
 *
 * Availability is the EFFECTIVE status (`loadAgentStatuses`, docs/specs/agent-status-bar.md): `online` = Available, `offline` = Away (the
 * person chose it, or they are on leave), `away` = Away because they are outside their own working hours, `busy` = the legacy busy value. A
 * member nobody has switched is Available (the picker used to say offline while routing said online; there is one rule now). The load is a
 * live count of open conversations: Reference kept a counter that drifted whenever a thread was resolved or snoozed.
 */
@Injectable()
export class AssigneesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly directory: MemberDirectory,
    private readonly entitlements: PlanEntitlementService,
  ) {}

  async list(): Promise<InboxAssigneesResponse> {
    const ctx = RequestContextStore.require();
    const viewers = await this.directory.viewers(ctx.orgId, PERM_CONVERSATION_READ);
    const canOpenInbox = new Set(viewers.filter((v) => v.scope !== null).map((v) => v.userId));

    const automation = await this.entitlements.featureEnabled(
      ctx.orgId,
      AGENT_STATUS_AUTOMATION_FEATURE,
    );
    return this.db.tx(async (tx) => {
      const people = await tx.execute(sql`
        SELECT u.id, u.uuid, u.full_name, u.email,
               (SELECT count(*)::int FROM conversations c
                 WHERE c.org_id = u.org_id AND c.assignee_user_id = u.id AND c.archived = FALSE
                   AND c.status = 'open') AS open_conversations
        FROM users u
        WHERE u.org_id = ${ctx.orgId} AND u.status = 'active'
        ORDER BY lower(u.full_name), u.id`);
      const shown = (people.rows as Raw[]).filter((r) => canOpenInbox.has(Number(r.id)));
      const cal = await loadWorkspaceCalendar(tx, ctx.orgId);
      const ids = shown.map((r) => Number(r.id));
      const statuses = await loadAgentStatuses(tx, ctx.orgId, ids, {
        automationAllowed: automation,
      });
      const away = await onLeaveMap(tx, ctx.orgId, ids, cal.today);
      // Somebody who chose Available during their own leave is available (manual choice beats leave): no "on leave" mark.
      for (const id of [...away.keys()]) if (statuses.get(id)?.routable) away.delete(id);
      const delegates = new Map<number, string>();
      if (away.size > 0) {
        const d = await tx.execute(sql`
          SELECT d.user_id, du.id AS delegate_id, du.uuid FROM member_delegates d
          JOIN users du ON du.org_id = d.org_id AND du.id = d.delegate_user_id AND du.status = 'active'
          WHERE d.org_id = ${ctx.orgId} AND d.user_id IN (${sql.join(
            [...away.keys()].map((i) => sql`${i}`),
            sql`, `,
          )})`);
        const delegateAway = await onLeaveMap(
          tx,
          ctx.orgId,
          (d.rows as Raw[]).map((r) => Number(r.delegate_id)),
          cal.today,
        );
        for (const r of d.rows as Raw[]) {
          if (!delegateAway.has(Number(r.delegate_id))) {
            delegates.set(Number(r.user_id), r.uuid as string);
          }
        }
      }
      const users: InboxAssignee[] = shown.map((r) => ({
        id: r.uuid as string,
        name: (r.full_name as string | null) ?? null,
        email: r.email as string,
        availability: presenceWord(statuses.get(Number(r.id))),
        openConversations: Number(r.open_conversations),
        isMe: Number(r.id) === ctx.userId,
        onLeave: away.has(Number(r.id))
          ? {
              until: away.get(Number(r.id)) ?? null,
              delegateId: delegates.get(Number(r.id)) ?? null,
            }
          : null,
      }));

      const teamRows = await tx.execute(sql`
        SELECT t.uuid, t.name, t.color, t.assignment_strategy,
               (SELECT count(*)::int FROM team_members m WHERE m.org_id = t.org_id AND m.team_id = t.id) AS members
        FROM teams t
        WHERE t.org_id = ${ctx.orgId} AND t.receives_conversations
        ORDER BY t.sort, lower(t.name), t.id`);
      const teams: InboxAssigneeTeam[] = (teamRows.rows as Raw[]).map((r) => ({
        id: r.uuid as string,
        name: r.name as string,
        color: (r.color as string | null) ?? null,
        memberCount: Number(r.members),
        assignmentStrategy: r.assignment_strategy as string,
      }));
      return { users, teams };
    });
  }
}
