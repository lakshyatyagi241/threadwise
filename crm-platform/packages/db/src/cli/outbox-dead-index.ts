#!/usr/bin/env tsx
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { buildOutboxDeadIndex } from '../outbox-dead-index';

loadEnv({ path: resolve(__dirname, '../../../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

/**
 * Builds idx_outbox_dead partition by partition without blocking writes. Run as the OWNER (MIGRATION_DATABASE_URL), before the migration
 * that creates the index when event_outbox is large. See src/outbox-dead-index.ts and docs/runbooks/failed-background-work.md.
 */
async function main(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('Neither MIGRATION_DATABASE_URL nor DATABASE_URL is set.');
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { built } = await buildOutboxDeadIndex(client, (m) => console.log(`  ${m}`));
    console.log(
      built.length === 0
        ? 'idx_outbox_dead is already built'
        : `built ${built.length} partition index(es)`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
