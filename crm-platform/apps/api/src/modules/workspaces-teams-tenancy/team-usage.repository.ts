import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { WspTeamDeletePreview } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { routingActionsNameTeam, withoutTeam } from './team-references';

type Raw = Record<string, unknown>;

/** Routing rules whose `assign` entry names this team uuid. `actions` is a jsonb list of typed entries. */
const namesTeam = (uuid: string): SQL => sql`EXISTS (
  SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.actions) = 'array' THEN r.actions ELSE '[]'::jsonb END) a
  WHERE a ->> 'type' = 'assign' AND COALESCE(a -> 'teamIds', '[]'::jsonb) @> jsonb_build_array(${uuid}::text))`;

/**
 * What references a team besides its members, read before a delete (the preview) and cleaned after it (the `team.deleted` consumer).
 * Conversations, segment shares and batches hold a real foreign key and are cleaned by the database; routing rules and record
 * assignment rules keep team uuids inside JSON, where nothing cleaned them until BL-380.
 */
@Injectable()
export class TeamUsageRepository {
  async usage(tx: Tx, orgId: number, team: { id: number; uuid: string }): Promise<WspTeamDeletePreview> {
    const res = await tx.execute(sql`
      SELECT
        (SELECT count(*)::int FROM team_members WHERE org_id = ${orgId} AND team_id = ${team.id}) AS members,
        (SELECT count(*)::int FROM routing_rules r WHERE r.org_id = ${orgId} AND ${namesTeam(team.uuid)}) AS routing_rules,
        (SELECT count(*)::int FROM assignment_rules ar
          WHERE ar.org_id = ${orgId} AND COALESCE(ar.team_ids, '[]'::jsonb) @> jsonb_build_array(${team.uuid}::text)) AS assignment_rules,
        (SELECT count(*)::int FROM segment_shares WHERE org_id = ${orgId} AND team_id = ${team.id}) AS segment_shares,
        (SELECT count(*)::int FROM conversations WHERE org_id = ${orgId} AND assignee_team_id = ${team.id}) AS conversations,
        (SELECT count(*)::int FROM team_members tm1
          WHERE tm1.org_id = ${orgId} AND tm1.team_id = ${team.id}
            AND EXISTS (
              SELECT 1 FROM team_members tm2
              WHERE tm2.org_id = tm1.org_id AND tm2.team_id = tm1.team_id AND tm2.user_id <> tm1.user_id
                AND NOT EXISTS (
                  SELECT 1 FROM team_members a JOIN team_members b ON b.org_id = a.org_id AND b.team_id = a.team_id
                  WHERE a.org_id = tm1.org_id AND a.user_id = tm1.user_id AND a.team_id <> tm1.team_id
                    AND b.user_id = tm2.user_id))) AS reach`);
    const r = (res.rows[0] ?? {}) as Raw;
    return {
      members: Number(r.members ?? 0),
      routingRules: Number(r.routing_rules ?? 0),
      assignmentRules: Number(r.assignment_rules ?? 0),
      segmentShares: Number(r.segment_shares ?? 0),
      conversationsAssigned: Number(r.conversations ?? 0),
      peopleWithReachChange: Number(r.reach ?? 0),
    };
  }

  /**
   * Takes a deleted team's uuid out of every routing rule's targets and every assignment rule's pool. Idempotent: a second run finds
   * nothing to change. Returns how many of each it changed (for the log).
   */
  async dropReferences(
    tx: Tx,
    orgId: number,
    teamUuid: string,
  ): Promise<{ routingRules: number; routingRulesSwitchedOff: number; assignmentRules: number }> {
    const rules = await tx.execute(sql`
      SELECT r.id, r.actions FROM routing_rules r
      WHERE r.org_id = ${orgId} AND ${namesTeam(teamUuid)} FOR UPDATE`);
    let off = 0;
    for (const row of rules.rows as Raw[]) {
      if (!routingActionsNameTeam(row.actions, teamUuid)) continue;
      const next = withoutTeam(row.actions, teamUuid);
      if (next.deactivate) off += 1;
      await tx.execute(sql`
        UPDATE routing_rules
        SET actions = ${JSON.stringify(next.actions)}::jsonb
            ${next.deactivate ? sql`, is_active = false` : sql``}
        WHERE org_id = ${orgId} AND id = ${Number(row.id)}`);
    }
    const pools = await tx.execute(sql`
      UPDATE assignment_rules
      SET team_ids = COALESCE((
        SELECT jsonb_agg(t) FROM jsonb_array_elements(team_ids) t WHERE t <> to_jsonb(${teamUuid}::text)), '[]'::jsonb)
      WHERE org_id = ${orgId} AND COALESCE(team_ids, '[]'::jsonb) @> jsonb_build_array(${teamUuid}::text)
      RETURNING id`);
    return {
      routingRules: rules.rows.length,
      routingRulesSwitchedOff: off,
      assignmentRules: pools.rows.length,
    };
  }
}
