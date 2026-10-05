#!/usr/bin/env node
/* eslint-disable no-console -- command-line tool: console is its interface */
import { randomBytes } from 'node:crypto';
import { closeSync, openSync, utimesSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { S3Client, type S3Config } from './s3-client';
import { openFile, parseKey } from './seal';
import { syncOffsite } from './sync';

/**
 * Off-host copies of the database dumps (TW-INFRA-056). Runs in the API image as the `offsite` service, next to `backup`.
 * Docs and recovery: docs/runbooks/backup-restore.md.
 *
 *   loop            (default) every OFFSITE_SYNC_MINUTES: seal and upload new dumps, then thin the bucket to the retention policy
 *   once            one pass, exit 1 if anything failed
 *   check           write, read back and delete a small test object; prove the settings work
 *   list            what is in the bucket
 *   fetch <name> [destination]    download a dump and open it with the backup key
 *
 * Settings (all in /opt/desk/.env):
 *   OFFSITE_S3_ENDPOINT, OFFSITE_S3_BUCKET, OFFSITE_S3_ACCESS_KEY_ID, OFFSITE_S3_SECRET_ACCESS_KEY,
 *   OFFSITE_BACKUP_KEY (32 bytes base64: seals the dumps; keep it apart from the bucket keys),
 *   optional OFFSITE_S3_REGION (auto), OFFSITE_S3_PREFIX (desk), OFFSITE_S3_PATH_STYLE (true),
 *   OFFSITE_SYNC_MINUTES (30), OFFSITE_BACKUP_PREVIOUS_KEYS (to open older dumps after changing the key).
 */
const env = process.env;
const DIR = env.BACKUP_DIR ?? '/backups';
const MARKER = env.OFFSITE_MARKER ?? '/tmp/offsite-ok';

function config(): { s3: S3Config; prefix: string; key: Buffer; previous: Buffer[] } | string {
  const need = [
    'OFFSITE_S3_ENDPOINT',
    'OFFSITE_S3_BUCKET',
    'OFFSITE_S3_ACCESS_KEY_ID',
    'OFFSITE_S3_SECRET_ACCESS_KEY',
    'OFFSITE_BACKUP_KEY',
  ];
  const missing = need.filter((n) => !env[n]?.trim());
  if (missing.length > 0) return `not configured (missing ${missing.join(', ')})`;
  try {
    return {
      s3: {
        endpoint: env.OFFSITE_S3_ENDPOINT!.trim().replace(/\/+$/, ''),
        region: env.OFFSITE_S3_REGION?.trim() || 'auto',
        bucket: env.OFFSITE_S3_BUCKET!.trim(),
        accessKeyId: env.OFFSITE_S3_ACCESS_KEY_ID!.trim(),
        secretAccessKey: env.OFFSITE_S3_SECRET_ACCESS_KEY!.trim(),
        pathStyle: (env.OFFSITE_S3_PATH_STYLE ?? 'true') !== 'false',
      },
      prefix: (env.OFFSITE_S3_PREFIX?.trim() || 'desk').replace(/^\/+|\/+$/g, ''),
      key: parseKey(env.OFFSITE_BACKUP_KEY!),
      previous: (env.OFFSITE_BACKUP_PREVIOUS_KEYS ?? '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
        .map(parseKey),
    };
  } catch (err) {
    return (err as Error).message;
  }
}

const touch = () => {
  const now = new Date();
  try {
    utimesSync(MARKER, now, now);
  } catch {
    closeSync(openSync(MARKER, 'w'));
  }
};
const stamp = () => new Date().toISOString();
const log = (line: string) => console.log(`${stamp()} offsite: ${line}`);

async function pass(c: Exclude<ReturnType<typeof config>, string>): Promise<boolean> {
  const r = await syncOffsite({
    dir: DIR,
    client: new S3Client(c.s3),
    prefix: c.prefix,
    key: c.key,
    log,
  });
  log(
    `${r.uploaded.length} uploaded, ${r.alreadyThere} already there, ${r.pruned.length} pruned, ${r.failed.length} failed (${r.local} dumps on this host)`,
  );
  return r.failed.length === 0;
}

async function main(): Promise<number> {
  const cmd = process.argv[2] ?? 'loop';
  const c = config();
  if (typeof c === 'string') {
    log(c);
    // Not configured is a state, not a crash: say so once and stop (the service is `restart: on-failure`).
    return cmd === 'loop' ? 0 : 1;
  }
  const client = new S3Client(c.s3);

  switch (cmd) {
    case 'loop': {
      const every = Math.max(1, Number(env.OFFSITE_SYNC_MINUTES) || 30) * 60_000;
      log(`copying ${DIR} to ${c.s3.bucket}/${c.prefix} every ${every / 60_000} min`);
      for (;;) {
        try {
          if (await pass(c)) touch();
        } catch (err) {
          log(`pass failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        await new Promise((r) => setTimeout(r, every));
      }
    }
    case 'once':
      return (await pass(c)) ? 0 : 1;
    case 'check': {
      const key = `${c.prefix}/connection-test-${randomBytes(4).toString('hex')}.txt`;
      const file = join(tmpdir(), basename(key));
      await writeFile(file, 'off-host backup connection test, safe to delete');
      const { createHash } = await import('node:crypto');
      const { readFile } = await import('node:fs/promises');
      const body = await readFile(file);
      await client.put(key, file, body.length, createHash('sha256').update(body).digest('hex'));
      const head = await client.head(key);
      await client.delete(key);
      await rm(file, { force: true });
      if (!head || head.size !== body.length)
        throw new Error('written but not read back correctly');
      log(`ok: wrote, read back and deleted a test object in ${c.s3.bucket}/${c.prefix}`);
      return 0;
    }
    case 'list': {
      for (const o of await client.list(`${c.prefix}/`))
        console.log(`${String(o.size).padStart(12)}  ${o.key}`);
      return 0;
    }
    case 'fetch': {
      const name = process.argv[3];
      if (!name) throw new Error('usage: fetch <dump name or key> [destination]');
      const key = name.includes('/')
        ? name
        : `${c.prefix}/${name.endsWith('.enc') ? name : `${name}.enc`}`;
      const dest = process.argv[4] ?? basename(key).replace(/\.enc$/, '');
      const tmp = `${dest}.sealed`;
      await client.get(key, tmp);
      try {
        await openFile(tmp, dest, [c.key, ...c.previous]);
      } finally {
        await rm(tmp, { force: true });
      }
      log(`wrote ${dest}`);
      return 0;
    }
    default:
      console.error(
        'usage: offsite-backup.cli.js [loop | once | check | list | fetch <name> [destination]]',
      );
      return 2;
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
