#!/usr/bin/env tsx
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { verifySchema } from '../verify';

// Repo root .env — one file for the API, the worker and this CLI.
loadEnv({ path: resolve(__dirname, '../../../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

/**
 * pnpm db:verify-schema [--verbose] [--strict]
 *
 * Drift check between the Drizzle schema and the database named by
 * MIGRATION_DATABASE_URL (see ./verify.ts for what it compares). Run it against a
 * database with every migration applied. Errors exit 1; --strict also fails on warnings.
 */
async function main(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'Neither MIGRATION_DATABASE_URL nor DATABASE_URL is set. Copy .env.example to .env first.',
    );
    process.exit(1);
  }
  const strict = process.argv.includes('--strict');
  const verbose = process.argv.includes('--verbose') || strict;
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const r = await verifySchema(client);
    console.log(`checked ${r.declared} Drizzle tables against ${r.inDatabase} database tables`);
    if (verbose) for (const w of r.warnings) console.log(`warn   ${w}`);
    for (const e of r.errors) console.log(`ERROR  ${e}`);
    console.log(
      `${r.errors.length} error(s), ${r.warnings.length} warning(s)${verbose || r.warnings.length === 0 ? '' : ' (pass --verbose to list them)'}`,
    );
    if (r.errors.length > 0 || (strict && r.warnings.length > 0)) process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
