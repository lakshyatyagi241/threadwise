#!/usr/bin/env tsx
/* eslint-disable no-console -- command-line tool: console is its interface */
import { resolve } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { reencryptSecrets } from './reencrypt-secrets';

loadEnv({ path: resolve(__dirname, '../../../../../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

/**
 * WARNING: this moves only the AUTH domain's secrets (platform settings, MFA). About thirty other places in the database
 * (channel and gateway credentials, OAuth tokens, sales-document and appointment data, ...) are NOT touched, so following the
 * steps below and then dropping the old key would make them unreadable. To rotate the key use
 * crypto-rotation/rotate-keys.cli.ts in platform-infrastructure, which finds every sealed value itself
 * (docs/runbooks/key-rotation.md). Kept because the AUTH tests and its targets are still useful on their own.
 *
 * Moves every stored secret onto the current encryption key (TW-AUTH-047).
 *
 *   1. put the old key in CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS and the new one
 *      in CREDENTIALS_ENCRYPTION_KEY (comma-separated base64, 32 bytes each);
 *   2. deploy, so the app can still read the old blobs;
 *   3. run this until "failed" is empty and "rewritten" is 0
 *      (`--dry-run` only counts);
 *   4. drop the old key from CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS.
 *
 *   pnpm --filter @crm/api exec tsx src/modules/auth/maintenance/reencrypt-secrets.cli.ts [--dry-run]
 */
async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('Neither MIGRATION_DATABASE_URL nor DATABASE_URL is set.');
    process.exit(1);
  }
  if (!process.env.CREDENTIALS_ENCRYPTION_KEY) {
    console.error('CREDENTIALS_ENCRYPTION_KEY is not set.');
    process.exit(1);
  }
  const crypto = new CryptoService({
    get: (key: string) => process.env[key],
  } as unknown as ConfigService<never, true>);
  console.log(
    `current key id: ${crypto.currentKeyId}${dryRun ? ' (dry run, nothing is written)' : ''}`,
  );

  const client = new Client({ connectionString: url });
  await client.connect();
  let failed = 0;
  try {
    await client.query(`SELECT set_config('app.privileged', 'on', false)`);
    for (const r of await reencryptSecrets(client, crypto, { dryRun })) {
      console.log(
        `${r.target}: scanned ${r.scanned}, already current ${r.current}, ${dryRun ? 'would rewrite' : 'rewritten'} ${r.rewritten}, failed ${r.failed.length}`,
      );
      for (const f of r.failed) console.log(`  could not move: ${f}`);
      failed += r.failed.length;
    }
  } finally {
    await client.end();
  }
  if (failed > 0) process.exitCode = 2;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
