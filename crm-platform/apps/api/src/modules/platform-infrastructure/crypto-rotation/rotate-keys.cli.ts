#!/usr/bin/env node
/* eslint-disable no-console -- command-line tool: console is its interface */
import { resolve } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { isDone, rotateKeys, type ColumnReport } from './rotate-keys';

loadEnv({ path: resolve(__dirname, '../../../../../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

/**
 * Moves every sealed secret in the database to the current encryption key, wherever it is stored (TW-INFRA-023).
 * Procedure and caveats: docs/runbooks/key-rotation.md.
 *
 *   node dist/src/modules/platform-infrastructure/crypto-rotation/rotate-keys.cli.js [--dry-run] [--only=t1,t2] [--exclude=t3]
 *
 * Exit 0: a real run moved everything it found; a dry run found nothing to move. Exit 2: something could not be read, or was
 * changed under us and needs another run (a dry run also exits 2 when it would move something). Do NOT drop the old key from
 * CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS until a real run exits 0 AND a following --dry-run exits 0.
 */
const list = (name: string): string[] | undefined => {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg
    ? arg
        .slice(name.length + 3)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
};

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
    `current key id: ${crypto.currentKeyId}${dryRun ? '  (dry run: nothing is written)' : ''}`,
  );
  console.log(`database: ${new URL(url).pathname.slice(1)} on ${new URL(url).host}`);

  const reader = new Client({ connectionString: url });
  const writer = new Client({ connectionString: url });
  await Promise.all([reader.connect(), writer.connect()]);
  let reports: ColumnReport[];
  try {
    for (const c of [reader, writer]) {
      await c.query(`SELECT set_config('app.privileged', 'on', false)`);
      await c.query(`SET statement_timeout = 0`);
    }
    reports = await rotateKeys(reader, writer, crypto, {
      dryRun,
      only: list('only'),
      exclude: list('exclude'),
      log: (line) => console.log(line),
    });
  } finally {
    await Promise.all([reader.end(), writer.end()]);
  }

  const byKey: Record<string, number> = {};
  for (const r of reports)
    for (const [k, n] of Object.entries(r.byKey)) byKey[k] = (byKey[k] ?? 0) + n;
  console.log('\nsealed blobs found, by the key that sealed them (before this run):');
  for (const [k, n] of Object.entries(byKey).sort()) {
    console.log(`  ${k === crypto.currentKeyId ? `${k} (current)` : k}: ${n}`);
  }
  for (const r of reports) {
    for (const f of r.failed) console.log(`  UNREADABLE ${r.column}: ${f}`);
  }
  const done = isDone(reports, dryRun);
  console.log(
    done
      ? dryRun
        ? '\nnothing is left under an old key.'
        : '\nevery sealed blob is now under the current key. Run once more with --dry-run to confirm before dropping the old key.'
      : dryRun
        ? '\nNOT DONE: the blobs above are under an old key (or unreadable). Run without --dry-run to move them.'
        : '\nNOT DONE: some blobs are unreadable or changed while we worked. Run again; keep the old keys until this exits 0.',
  );
  if (!done) process.exitCode = 2;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
