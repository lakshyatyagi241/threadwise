#!/usr/bin/env tsx
/* eslint-disable no-console -- command-line tool: console is its interface */
import { resolve } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { sealPlaintextSecrets } from '../../../common/crypto/seal-plaintext-secrets';

loadEnv({ path: resolve(__dirname, '../../../../../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

/**
 * Seals or hashes the secrets the encryption audit found in plaintext (E2, E3, E7, E8). Idempotent and resumable.
 *
 *   pnpm --filter @crm/api exec tsx src/modules/platform-infrastructure/crypto-rotation/seal-plaintext-secrets.cli.ts [--dry-run] [--scrub]
 *
 *   1. Deploy the release that reads both forms, and wait until the old release is gone.
 *   2. Run it with --dry-run, then without: every plaintext row gets its sealed copy and lookup hash.
 *   3. Set SECRETS_LEGACY_PLAINTEXT_MIRROR=off, redeploy, then run it with --scrub to blank the legacy plaintext columns.
 * Details and rollback: docs/security/encryption-audit/Sheet3-35-encryption-audit-REPORT.html.
 */
async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const scrub = process.argv.includes('--scrub');
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
  const client = new Client({ connectionString: url });
  await client.connect();
  let skipped = 0;
  try {
    await client.query(`SELECT set_config('app.privileged', 'on', false)`);
    for (const r of await sealPlaintextSecrets(client, crypto, { dryRun, scrub })) {
      console.log(
        `${r.target}: found ${r.found}, ${dryRun ? 'would change' : 'changed'} ${dryRun ? r.found : r.done}, changed by someone else ${r.skipped}`,
      );
      skipped += r.skipped;
    }
  } finally {
    await client.end();
  }
  if (skipped > 0) process.exitCode = 2;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
