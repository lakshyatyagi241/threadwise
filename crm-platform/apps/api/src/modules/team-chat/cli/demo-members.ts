import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import type { Client } from 'pg';

/**
 * Demo teammates for local work (WD-TCHAT-032, WaDesk's TeamChatDemoMembersSeeder): ten fictional people, eight agents and
 * two managers, so the members rail and the mobile layout can be tried with a realistic roster. Idempotent: users are matched
 * by email, the role link is added only when missing. The `.test` domain cannot receive mail; the password is random and
 * never shown, so nobody can sign in as them. Cleanup: delete the users on the `wadesk-demo.test` domain.
 */
export const DEMO_DOMAIN = 'wadesk-demo.test';

export const DEMO_MEMBERS: ReadonlyArray<{ name: string; role: 'Agent' | 'Manager' }> = [
  { name: 'Aarav Sharma', role: 'Agent' },
  { name: 'Diya Patel', role: 'Agent' },
  { name: 'Rohan Gupta', role: 'Agent' },
  { name: 'Ananya Reddy', role: 'Agent' },
  { name: 'Vikram Singh', role: 'Agent' },
  { name: 'Meera Nair', role: 'Agent' },
  { name: 'Arjun Kapoor', role: 'Agent' },
  { name: 'Priya Desai', role: 'Agent' },
  { name: 'Sneha Iyer', role: 'Manager' },
  { name: 'Karan Mehta', role: 'Manager' },
];

export const demoEmail = (name: string): string =>
  `${name.toLowerCase().replace(/\s+/g, '.')}@${DEMO_DOMAIN}`;

/** Adds the demo roster to one organization; returns how many users and role links were created and the member total. */
export async function seedDemoMembers(
  client: Client,
  orgId: number,
): Promise<{ usersCreated: number; linksCreated: number; members: number }> {
  const passwordHash = await hash(randomBytes(24).toString('hex'));
  let usersCreated = 0;
  let linksCreated = 0;
  await client.query(`SELECT set_config('app.privileged', 'on', false)`);
  await client.query('BEGIN');
  try {
    await client.query('SELECT provision_workspace_presets($1)', [orgId]); // the Agent and Manager presets exist
    for (const m of DEMO_MEMBERS) {
      const email = demoEmail(m.name);
      const user = await client.query<{ id: number; created: boolean }>(
        `INSERT INTO users (org_id, email, full_name, password_hash)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (org_id, email) DO UPDATE SET email = users.email
         RETURNING id, (xmax = 0) AS created`,
        [orgId, email, m.name, passwordHash],
      );
      const row = user.rows[0]!;
      if (row.created) usersCreated += 1;
      await client.query(
        `INSERT INTO user_security (org_id, user_id, email_verified_at, password_changed_at)
         VALUES ($1, $2, now(), now())
         ON CONFLICT (org_id, user_id) DO UPDATE
           SET email_verified_at = COALESCE(user_security.email_verified_at, now())`,
        [orgId, row.id],
      );
      const link = await client.query(
        `INSERT INTO user_roles (org_id, user_id, role_id)
         SELECT $1, $2, r.id FROM roles r WHERE r.org_id = $1 AND r.name = $3
         ON CONFLICT DO NOTHING`,
        [orgId, row.id, m.role],
      );
      linksCreated += link.rowCount ?? 0;
    }
    const total = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM users WHERE org_id = $1`,
      [orgId],
    );
    await client.query('COMMIT');
    return { usersCreated, linksCreated, members: Number(total.rows[0]!.n) };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}
