#!/usr/bin/env tsx
import { resolve } from 'node:path';
import { hash } from '@node-rs/argon2';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

loadEnv({ path: resolve(__dirname, '../../../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

/**
 * Development seed.
 *
 * Creates TWO tenants on purpose. Every isolation test needs a second org that
 * the first must not be able to see — seeding one tenant makes it impossible to
 * tell working RLS from absent RLS.
 *
 * Passwords here are well-known and weak by design. The CLI refuses to run
 * against NODE_ENV=production.
 */

const DEMO_PASSWORD = 'Passw0rd!';

interface SeedOrg {
  slug: string;
  name: string;
  adminEmail: string;
}

const ORGS: SeedOrg[] = [
  { slug: 'Admin', name: 'Admin', adminEmail: 'nachiket.challawar@geta.ai' },
  { slug: 'test_tenent', name: 'test_tenent', adminEmail: 'nachiket.challawar+ten@geta.ai' },
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('refusing to seed with NODE_ENV=production');
    process.exit(1);
  }
  // Seeding writes across tenants, so it runs as the owner like migrations do.
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('Neither MIGRATION_DATABASE_URL nor DATABASE_URL is set.');
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  const passwordHash = await hash(DEMO_PASSWORD);

  try {
    // Session-level privileged mode: the seed writes across tenants, which is
    // exactly what RLS is there to stop for ordinary connections.
    await client.query(`SELECT set_config('app.privileged', 'on', false)`);
    await client.query('BEGIN');

    for (const org of ORGS) {
      const { rows: orgRows } = await client.query<{ id: number }>(
        `INSERT INTO organizations (slug, name, plan, tier)
         VALUES ($1, $2, 'growth', 'standard')
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [org.slug, org.name],
      );
      const orgId = orgRows[0]!.id;

      // --- roles -----------------------------------------------------------
      // Admin is created locked. The role_grants trigger then refuses further
      // grant changes, so its grants are inserted BEFORE the lock is set.
      const { rows: adminRoleRows } = await client.query<{ id: number }>(
        `INSERT INTO roles (org_id, name, system_key, is_locked)
         VALUES ($1, 'Admin', 'admin', false)
         ON CONFLICT (org_id, name) DO UPDATE SET is_locked = false
         RETURNING id`,
        [orgId],
      );
      const adminRoleId = adminRoleRows[0]!.id;

      await client.query(
        `INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
         SELECT $1, $2, key, 'allow', 'all' FROM permission_defs
         ON CONFLICT (org_id, role_id, permission_key) DO NOTHING`,
        [orgId, adminRoleId],
      );
      await client.query(`UPDATE roles SET is_locked = true WHERE org_id = $1 AND id = $2`, [
        orgId,
        adminRoleId,
      ]);

      const { rows: agentRoleRows } = await client.query<{ id: number }>(
        `INSERT INTO roles (org_id, name, system_key)
         VALUES ($1, 'Counsellor', NULL)
         ON CONFLICT (org_id, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [orgId],
      );
      const counsellorRoleId = agentRoleRows[0]!.id;

      // Scope 'own': a counsellor sees the contacts they own, nobody else's.
      await client.query(
        `INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
         VALUES
           ($1, $2, 'record.contacts.read',   'allow', 'own'),
           ($1, $2, 'record.contacts.create', 'allow', 'all'),
           ($1, $2, 'record.contacts.update', 'allow', 'own'),
           ($1, $2, 'inbox.conversation.read','allow', 'own'),
           ($1, $2, 'inbox.conversation.reply','allow','own'),
           ($1, $2, 'record.deals.read',   'allow', 'own'),
           ($1, $2, 'record.deals.create', 'allow', 'all'),
           ($1, $2, 'record.deals.update', 'allow', 'own'),
           ($1, $2, 'record.pipelines.read', 'allow', 'all'),
           ($1, $2, 'record.tasks.read',   'allow', 'own'),
           ($1, $2, 'record.tasks.create', 'allow', 'all'),
           ($1, $2, 'record.tasks.update', 'allow', 'own'),
           ($1, $2, 'record.tasks.delete', 'allow', 'own'),
           ($1, $2, 'record.sales-docs.read',   'allow', 'own'),
           ($1, $2, 'record.sales-docs.create', 'allow', 'all'),
           ($1, $2, 'record.sales-docs.update', 'allow', 'own'),
           ($1, $2, 'record.sales-docs.send',   'allow', 'own')
         ON CONFLICT (org_id, role_id, permission_key) DO NOTHING`,
        [orgId, counsellorRoleId],
      );

      // --- users -----------------------------------------------------------
      // No password_hash: staff sign in via Clerk now (see AuthService.loginViaClerk).
      // auth_subject starts null and gets linked on that user's first Clerk login —
      // matched by (org_id, email), same row, same role, no re-provisioning.
      const { rows: userRows } = await client.query<{ id: number }>(
        `INSERT INTO users (org_id, email, full_name)
         VALUES ($1, $2, 'Demo Admin')
         ON CONFLICT (org_id, email) DO UPDATE SET full_name = EXCLUDED.full_name
         RETURNING id`,
        [orgId, org.adminEmail],
      );
      const adminUserId = userRows[0]!.id;

      await client.query(
        `INSERT INTO user_roles (org_id, user_id, role_id) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [orgId, adminUserId, adminRoleId],
      );

      // --- sub-agent + a lead they submitted --------------------------------
      const { rows: agentRows } = await client.query<{ id: number }>(
        `INSERT INTO partner_agents (org_id, code, name, email, phone, password_hash)
         VALUES ($1, 'AG-DEMO', 'Demo Sub-Agent', $2, '+919999900001', $3)
         ON CONFLICT (org_id, code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [orgId, `agent@${org.slug}.test`, passwordHash],
      );
      const agentId = agentRows[0]!.id;

      const { rows: contactRows } = await client.query<{ id: number }>(
        `INSERT INTO contacts (org_id, name, email, phone, owner_id, lifecycle_stage,
                               submitted_by_agent_id, data)
         VALUES ($1, 'Lakshya Tyagi', 'lakshya.demo@example.com', '+919876543210',
                 $2, 'qualified', $3, '{"college_tag":"RIT Dubai"}'::jsonb)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [orgId, adminUserId, agentId],
      );

      if (contactRows[0]) {
        const contactId = contactRows[0].id;
        await client.query(
          `INSERT INTO contact_identities (org_id, contact_id, kind, value, is_primary, verified)
           VALUES ($1, $2, 'email', 'lakshya.demo@example.com', true, false),
                  ($1, $2, 'phone', '+919876543210', true, false)
           ON CONFLICT (org_id, kind, value) DO NOTHING`,
          [orgId, contactId],
        );
        await client.query(
          `INSERT INTO partner_agent_leads (org_id, agent_id, contact_id, college_tag, submitted_payload)
           VALUES ($1, $2, $3, 'RIT Dubai',
                   '{"name":"Lakshya Tyagi","email":"lakshya.demo@example.com","mobile":"+919876543210"}'::jsonb)
           ON CONFLICT (org_id, agent_id, contact_id) DO NOTHING`,
          [orgId, agentId, contactId],
        );
      }

      // A few plain contacts so list endpoints and cursor pagination have
      // something to page through.
      await client.query(
        `INSERT INTO contacts (org_id, name, email, phone, owner_id, lifecycle_stage)
         SELECT $1,
                'Demo Contact ' || i,
                'demo' || i || '@' || $2 || '.test',
                '+9198765' || lpad(i::text, 5, '0'),
                $3,
                (ARRAY['new','contacted','qualified','interview_scheduled'])[1 + (i % 4)]
         FROM generate_series(1, 25) AS i
         ON CONFLICT DO NOTHING`,
        [orgId, org.slug, adminUserId],
      );

      console.log(`seeded org ${org.slug} (id=${orgId})`);
    }

    await client.query('COMMIT');
    console.log(
      `\ndone. Staff login (Clerk): sign in as ${ORGS[0]!.adminEmail} (org: ${ORGS[0]!.slug}) — ` +
        'first login links this seeded row automatically, no password set.',
    );
    console.log(
      `     Agent login (password, unchanged): agent@${ORGS[0]!.slug}.test / ${DEMO_PASSWORD}`,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
