#!/usr/bin/env tsx
/* eslint-disable no-console -- command-line tool: console is its interface */
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { LocalDiskMediaStore } from '../../../infra/providers/chat-conversations/media/local-disk-media.store';
import { chatMediaConfig } from '../../../infra/providers/chat-conversations/media/media.config';
import { seedDemoCalls } from './demo-calls';

loadEnv({ path: resolve(__dirname, '../../../../../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

/**
 * `pnpm --filter @crm/api seed:demo-calls`: sample WhatsApp calls (a month of them, with a few playable recordings) for the call log
 * and the call analytics. Target organization = SEED_ORG_ID if set, else the lowest id; SEED_CALLS sets how many (default 60).
 * Safe to run again: it adds nothing the second time. Dev only.
 */
async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed demo calls with NODE_ENV=production.');
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
    const org = await client.query(
      wanted
        ? `SELECT id, slug FROM organizations WHERE id = $1`
        : `SELECT id, slug FROM organizations ORDER BY id LIMIT 1`,
      wanted ? [wanted] : [],
    );
    const row = org.rows[0];
    if (!row) {
      console.error('No organization found.');
      process.exit(1);
    }
    const r = await seedDemoCalls(client, Number(row.id), {
      count: process.env.SEED_CALLS ? Number(process.env.SEED_CALLS) : 60,
      store: new LocalDiskMediaStore(chatMediaConfig().localDir),
    });
    console.log(
      `org "${String(row.slug)}": ${r.created} calls created (${r.existing} already there), ${r.recordings} recordings written`,
    );
  } finally {
    await client.end();
  }
}
void main();
