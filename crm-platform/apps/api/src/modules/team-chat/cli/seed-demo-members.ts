#!/usr/bin/env tsx
/* eslint-disable no-console -- command-line tool: console is its interface */
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { seedDemoMembers } from './demo-members';

loadEnv({ path: resolve(__dirname, '../../../../../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

/** `pnpm --filter @crm/api seed:team-chat-demo`: target organization = SEED_ORG_ID if set, else the lowest id. Dev only. */
async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed demo teammates with NODE_ENV=production.');
    process.exit(1);
  }
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('Neither MIGRATION_DATABASE_URL nor DATABASE_URL is set.');
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`SELECT set_config('app.privileged', 'on', false)`);
    const wanted = process.env.SEED_ORG_ID ? Number(process.env.SEED_ORG_ID) : null;
    const org = await client.query<{ id: number; slug: string }>(
      wanted
        ? `SELECT id, slug FROM organizations WHERE id = $1`
        : `SELECT id, slug FROM organizations ORDER BY id LIMIT 1`,
      wanted ? [wanted] : [],
    );
    if (!org.rows[0]) {
      console.error('No organization found.');
      process.exit(1);
    }
    const r = await seedDemoMembers(client, org.rows[0].id);
    console.log(
      `org "${org.rows[0].slug}": ${r.usersCreated} users created, ${r.linksCreated} roles linked, ${r.members} members in total`,
    );
  } finally {
    await client.end();
  }
}
void main();
