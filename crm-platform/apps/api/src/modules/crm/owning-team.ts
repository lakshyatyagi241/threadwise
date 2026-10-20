import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

/**
 * The internal id of a team named by uuid in a list filter ("Team": contacts, deals, tasks), or `undefined` when the team is not in this
 * workspace (the caller answers an empty list, like any unknown id in a filter).
 *
 * The filter reads the record's `owning_team_id` (BL-382, decision D8: the owner's primary team when the owner was set). It narrows a
 * list; it never widens what the caller's scope lets them see.
 */
export async function resolveTeamId(
  tx: Tx,
  orgId: number,
  teamUuid: string,
): Promise<number | undefined> {
  const res = await tx.execute(
    sql`SELECT id FROM teams WHERE org_id = ${orgId} AND uuid = ${teamUuid}::uuid`,
  );
  const row = res.rows[0] as { id: string | number } | undefined;
  return row ? Number(row.id) : undefined;
}
