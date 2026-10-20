import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

/**
 * Per workspace, the roles whose visible set of conversations differs from the rule that applied before BL-382 (decision D2): a role
 * that reads conversations at scope `team` or `team_and_below` and does NOT hold `inbox.conversation.read_unassigned` no longer sees the
 * conversations assigned to nobody. The migration `20270225090100_inbox_read_unassigned_permission` grants the permission to every role
 * that read at `team`, so right after it this report is empty; it lists the roles an administrator changed since (or created without it),
 * and the roles that run on a database where the migration has not been applied yet (every `team` reader is listed, with the key marked
 * as missing), so an operator can see who would be affected before and after a switch.
 *
 *   pnpm --filter @crm/api report:unassigned-visibility -- [--org <slug|id>] [--json]
 *
 * Read-only. For each listed role: how many active members hold it, and how many unassigned conversations (not archived) exist in the
 * workspace right now, which is what those members stop seeing. Exit code 0 always; the report is information, not a gate.
 */
export interface RoleDifference {
  roleId: number;
  role: string;
  readScope: 'team' | 'team_and_below';
  members: number;
  /** Unassigned, not archived conversations of the workspace: what a member of this role no longer sees. */
  unassignedConversations: number;
}

export interface WorkspaceDifference {
  orgId: number;
  slug: string;
  roles: RoleDifference[];
}

type Queryable = Pick<Client, 'query'>;

export async function runReport(db: Queryable, org?: string): Promise<WorkspaceDifference[]> {
  const res = await db.query(
    `SELECT o.id AS org_id, o.slug, r.id AS role_id, r.name AS role, g.record_scope::text AS read_scope,
            (SELECT count(*) FROM user_roles ur JOIN users u ON u.org_id = ur.org_id AND u.id = ur.user_id AND u.status <> 'inactive'
              WHERE ur.org_id = r.org_id AND ur.role_id = r.id)::int AS members,
            (SELECT count(*) FROM conversations c
              WHERE c.org_id = o.id AND c.assignee_user_id IS NULL AND c.assignee_team_id IS NULL AND NOT c.archived)::int AS unassigned
       FROM organizations o
       JOIN roles r ON r.org_id = o.id
       JOIN role_grants g ON g.org_id = r.org_id AND g.role_id = r.id
        AND g.permission_key = 'inbox.conversation.read' AND g.effect = 'allow'
        AND g.record_scope::text IN ('team', 'team_and_below')
      WHERE ($1::text IS NULL OR o.slug = $1 OR o.id::text = $1)
        AND NOT EXISTS (
          SELECT 1 FROM role_grants u
           WHERE u.org_id = r.org_id AND u.role_id = r.id
             AND u.permission_key = 'inbox.conversation.read_unassigned' AND u.effect = 'allow')
      ORDER BY o.id, r.name`,
    [org ?? null],
  );
  const byOrg = new Map<number, WorkspaceDifference>();
  for (const row of res.rows as Array<{
    org_id: string;
    slug: string;
    role_id: string;
    role: string;
    read_scope: 'team' | 'team_and_below';
    members: number;
    unassigned: number;
  }>) {
    const orgId = Number(row.org_id);
    const entry = byOrg.get(orgId) ?? { orgId, slug: row.slug, roles: [] };
    entry.roles.push({
      roleId: Number(row.role_id),
      role: row.role,
      readScope: row.read_scope,
      members: Number(row.members),
      unassignedConversations: Number(row.unassigned),
    });
    byOrg.set(orgId, entry);
  }
  return [...byOrg.values()];
}

export function formatReport(report: WorkspaceDifference[]): string {
  if (report.length === 0) {
    return 'No workspace has a role whose visible conversations would change: every role that reads at a team scope holds inbox.conversation.read_unassigned.';
  }
  const lines: string[] = [];
  for (const w of report) {
    lines.push(`${w.slug} (id ${w.orgId})`);
    for (const r of w.roles) {
      lines.push(
        `  - ${r.role}: reads at ${r.readScope}, no inbox.conversation.read_unassigned; ${r.members} active member(s) lose the ${r.unassignedConversations} unassigned conversation(s)`,
      );
    }
  }
  return lines.join('\n');
}

async function main(): Promise<number> {
  loadEnv({ path: resolve(__dirname, '../../../../../../.env') });
  loadEnv({ path: resolve(process.cwd(), '.env') });
  const arg = (name: string): string | undefined => {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 ? process.argv[i + 1] : undefined;
  };
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('MIGRATION_DATABASE_URL (or DATABASE_URL) is not set');
    return 1;
  }
  if (process.argv.includes('--org') && !arg('org')) {
    console.error('--org takes a workspace slug or id');
    return 1;
  }
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    // The tables are under row-level security: read every workspace, read-only, in one transaction.
    await db.query('BEGIN READ ONLY');
    await db.query("SELECT set_config('app.privileged', 'on', true)");
    const report = await runReport(db, arg('org'));
    await db.query('ROLLBACK');
    process.stdout.write(
      `${process.argv.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report)}\n`,
    );
    return 0;
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
