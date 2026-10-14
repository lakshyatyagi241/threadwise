import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  type AgentAvailability,
  type InboxAssignee,
  type InboxAssigneeTeam,
  type InboxAssigneesResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { loadWorkspaceCalendar, onLeaveMap } from '../../common/workspace-calendar';
import { DatabaseService } from '../../infra/db/database.service';
import { MemberDirectory, PERM_CONVERSATION_READ } from '../../realtime';

type Raw = Record<string, unknown>;

/**
 * `GET /inbox/assignees`: the picker's content (TW-TIB2-021). Active members who may read the inbox (the ones a conversation can be
 * given to, see `AssignmentService`), each with their availability and how many conversations they hold right now, and the teams.
 *
 * Someone on leave today (the workspace calendar, BL-112) carries `onLeave` with the last day away and their delegate: the picker greys
 * them ("On leave until <date>"). A manual assignment to them is still allowed; routing never picks them.
 *
 * Availability is the stored status (online, away, busy, offline; no row means offline, as Reference). The load is a live count of open and
 * pending conversations: Reference kept a counter that drifted whenever a thread was resolved or snoozed.
 */
@Injectable()
export class AssigneesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly directory: MemberDirectory,
  ) {}

  async list(): Promise<InboxAssigneesResponse> {
    const ctx = RequestContextStore.require();
    const viewers = await this.directory.viewers(ctx.orgId, PERM_CONVERSATION_READ);
    const canOpenInbox = new Set(viewers.filter((v) => v.scope !== null).map((v) => v.userId));

    return this.db.tx(async (tx) => {
      const people = await tx.execute(sql`
        SELECT u.id, u.uuid, u.full_name, u.email,
               COALESCE(s.status, 'offline') AS availability,
               (SELECT count(*)::int FROM conversations c
                 WHERE c.org_id = u.org_id AND c.assignee_user_id = u.id AND c.archived = FALSE
                   AND c.status IN ('open', 'pending')) AS open_conversations
        FROM users u
        LEFT JOIN agent_statuses s ON s.org_id = u.org_id AND s.user_id = u.id
        WHERE u.org_id = ${ctx.orgId} AND u.status = 'active'
        ORDER BY lower(u.full_name), u.id`);
      const shown = (people.rows as Raw[]).filter((r) => canOpenInbox.has(Number(r.id)));
      const cal = await loadWorkspaceCalendar(tx, ctx.orgId);
      const ids = shown.map((r) => Number(r.id));
      const away = await onLeaveMap(tx, ctx.orgId, ids, cal.today);
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
          availability: r.availability as AgentAvailability,
          openConversations: Number(r.open_conversations),
          isMe: Number(r.id) === ctx.userId,
          onLeave: away.has(Number(r.id))
            ? { until: away.get(Number(r.id)) ?? null, delegateId: delegates.get(Number(r.id)) ?? null }
            : null,
        }));

      const teamRows = await tx.execute(sql`
        SELECT t.uuid, t.name, t.color, t.assignment_strategy,
               (SELECT count(*)::int FROM team_members m WHERE m.org_id = t.org_id AND m.team_id = t.id) AS members
        FROM teams t
        WHERE t.org_id = ${ctx.orgId}
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
