import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeManifest } from '../../../extract/manifest';
import { NdjsonDirSource } from '../../../extract/source';
import { OWNER_EMAIL, writeFixtures } from '../../../test/fixtures';
import { cloneScratch, dropAll, scratchUrls, withDb } from './scratch';

const S = scratchUrls();
const TOOL = resolve(__dirname, '../../..');
const SCRIPT = resolve(__dirname, '../set-owner-password.cjs');
const API_MODULES = resolve(TOOL, '../../apps/api/node_modules');
const work = mkdtempSync(join(tmpdir(), 'waboo-sop-'));
const PW = 'Correct-Horse-9-Battery!';

const sop = (env: Record<string, string>, args: string[]) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    env: {
      PATH: process.env.PATH ?? '',
      SystemRoot: process.env.SystemRoot ?? '',
      NODE_PATH: API_MODULES,
      ...env,
    },
    encoding: 'utf8',
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout.trim() };
};

async function q<T = Record<string, unknown>>(
  url: string,
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query(text, params)).rows as T[];
  } finally {
    await c.end();
  }
}

/** Row counts of every public table, read as the owner (RLS does not apply). */
async function allCounts(url: string): Promise<Record<string, number>> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const tables = (
      await c.query(
        `SELECT relname FROM pg_class WHERE relkind IN ('r','p') AND relnamespace = 'public'::regnamespace AND NOT relispartition ORDER BY 1`,
      )
    ).rows.map((r) => r.relname as string);
    const out: Record<string, number> = {};
    for (const t of tables)
      out[t] = Number((await c.query(`SELECT count(*) n FROM "${t}"`)).rows[0].n);
    return out;
  } finally {
    await c.end();
  }
}

let db: Awaited<ReturnType<typeof cloneScratch>>;
let ownerUuid: string;
let ownerId: number;
let orgId: number;
let other: string;

beforeAll(async () => {
  if (!S) return;
  db = await cloneScratch('sop');
  const dir = join(work, 'dumps');
  mkdirSync(dir, { recursive: true });
  writeFixtures(dir, { bulk: 5, access: true });
  const src = new NdjsonDirSource(dir);
  await writeManifest(src, dir, 'acme');
  const env = {
    TARGET_DATABASE_URL: db.worker,
    MIGRATION_DATABASE_URL: db.owner,
    SOURCE_DUMPS_DIR: dir,
  };
  for (const args of [
    ['init'],
    [
      'run',
      '--client',
      'acme',
      '--org-name',
      'Acme',
      '--org-slug',
      'acme',
      '--owner-email',
      OWNER_EMAIL,
      '--batch',
      '7',
    ],
  ]) {
    const r = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'cli.ts', ...args], {
      cwd: TOOL,
      env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env },
      encoding: 'utf8',
    });
    if (r.status !== 0)
      throw new Error(`setup ${args[0]} failed: ${r.stdout}${r.stderr}`.slice(0, 2000));
  }
  const o = (
    await q<{ id: number; uuid: string; org_id: number }>(
      db.owner,
      `SELECT u.id, u.uuid::text, u.org_id FROM users u WHERE u.email = $1`,
      [OWNER_EMAIL],
    )
  )[0]!;
  ownerUuid = o.uuid;
  ownerId = Number(o.id);
  orgId = Number(o.org_id);
  other = (
    await q<{ email: string }>(
      db.owner,
      `SELECT email FROM users WHERE org_id = $1 AND email <> $2 ORDER BY id LIMIT 1`,
      [orgId, OWNER_EMAIL],
    )
  )[0]!.email;
}, 600_000);

afterAll(async () => {
  await dropAll();
  rmSync(work, { recursive: true, force: true });
});

const base = (extra: string[] = []): string[] => [
  '--org-slug',
  'acme',
  '--email',
  OWNER_EMAIL,
  '--confirm-db-name',
  db.name,
  ...extra,
];
const good = () => ({ TARGET_DATABASE_URL: db.worker, OWNER_NEW_PASSWORD: PW });

describe.skipIf(!S)('set-owner-password.cjs', () => {
  it('refuses everything it should, and changes nothing when it refuses', async () => {
    const before = await allCounts(db.owner);
    const hashBefore = await q(
      db.owner,
      `SELECT id, password_hash FROM users WHERE org_id = $1 ORDER BY id`,
      [orgId],
    );
    expect(hashBefore.every((r) => r.password_hash === null)).toBe(true);

    const cases: Array<[string, Record<string, string>, string[], RegExp]> = [
      [
        'a non-owner user',
        good(),
        ['--org-slug', 'acme', '--email', other, '--confirm-db-name', db.name],
        /not the owner/,
      ],
      [
        'a missing org',
        good(),
        ['--org-slug', 'no-such-org', '--email', OWNER_EMAIL, '--confirm-db-name', db.name],
        /no organization with slug/,
      ],
      [
        'a missing user',
        good(),
        ['--org-slug', 'acme', '--email', 'nobody@example.test', '--confirm-db-name', db.name],
        /no user with that email/,
      ],
      [
        'a wrong --confirm-db-name',
        good(),
        ['--org-slug', 'acme', '--email', OWNER_EMAIL, '--confirm-db-name', 'crm'],
        /confirm-db-name must be exactly/,
      ],
      [
        'no --confirm-db-name',
        good(),
        ['--org-slug', 'acme', '--email', OWNER_EMAIL],
        /--confirm-db-name is required/,
      ],
      [
        'no --org-slug',
        good(),
        ['--email', OWNER_EMAIL, '--confirm-db-name', db.name],
        /--org-slug is required/,
      ],
      ['no password', { TARGET_DATABASE_URL: db.worker }, base(), /OWNER_NEW_PASSWORD is not set/],
      [
        'a weak password',
        { TARGET_DATABASE_URL: db.worker, OWNER_NEW_PASSWORD: 'short1A!' },
        base(),
        /the password needs: at least 12/,
      ],
      [
        'the email name in the password',
        {
          TARGET_DATABASE_URL: db.worker,
          OWNER_NEW_PASSWORD: `Xx-${OWNER_EMAIL.split('@')[0]}-9!`,
        },
        base(),
        /not containing the email name/,
      ],
      [
        'a password flag',
        good(),
        [...base(), '--password', 'Sup3r-Secret-Value!'],
        /unknown flag --password/,
      ],
      [
        'a superuser login',
        { TARGET_DATABASE_URL: db.owner, OWNER_NEW_PASSWORD: PW },
        base(),
        /bypasses row-level security/,
      ],
      [
        'a non-local host',
        {
          TARGET_DATABASE_URL: 'postgres://u:hunter2x@db.example.com:5432/crm',
          OWNER_NEW_PASSWORD: PW,
        },
        ['--org-slug', 'acme', '--email', OWNER_EMAIL, '--confirm-db-name', 'crm'],
        /refusing to run against db\.example\.com/,
      ],
    ];
    for (const [name, env, args, re] of cases) {
      const r = sop(env, args);
      expect(r.status, `${name}: ${r.out}`).toBe(3);
      expect(r.out, name).toMatch(re);
      expect(r.out, `${name} leaked`).not.toContain(PW);
      expect(r.out).not.toContain('Sup3r-Secret-Value');
      expect(r.out).not.toContain('hunter2x');
      expect(r.out).not.toMatch(/postgres(ql)?:\/\//);
    }
    // an unreachable but local database: a clean failure, no URL
    const dead = sop(
      { TARGET_DATABASE_URL: 'postgres://u:hunter2x@127.0.0.1:1/crm', OWNER_NEW_PASSWORD: PW },
      ['--org-slug', 'acme', '--email', OWNER_EMAIL, '--confirm-db-name', 'crm'],
    );
    expect(dead.status).toBe(1);
    expect(dead.out).not.toContain('hunter2x');

    expect(await allCounts(db.owner)).toEqual(before);
    expect(
      await q(db.owner, `SELECT id, password_hash FROM users WHERE org_id = $1 ORDER BY id`, [
        orgId,
      ]),
    ).toEqual(hashBefore);
  });

  it('sets the owner password: the app verifier accepts it, a wrong one is rejected, nothing else changes', async () => {
    const before = await allCounts(db.owner);
    const usersBefore = await q(
      db.owner,
      `SELECT * FROM users WHERE org_id = $1 AND id <> $2 ORDER BY id`,
      [orgId, ownerId],
    );
    const secBefore = await q(
      db.owner,
      `SELECT * FROM user_security WHERE org_id = $1 AND user_id <> $2 ORDER BY user_id`,
      [orgId, ownerId],
    );
    expect(
      (
        await q(
          db.owner,
          `SELECT email_verified_at FROM user_security WHERE org_id = $1 AND user_id = $2`,
          [orgId, ownerId],
        )
      )[0]!.email_verified_at,
    ).toBeNull();

    const r = sop(good(), base());
    expect(r.status, r.out).toBe(0);
    expect(r.stdout).toBe(`ok ${ownerUuid}`);
    expect(r.out).not.toContain(PW);

    // exactly the two rows the app's own reset flow writes
    expect(await allCounts(db.owner)).toEqual(before);
    expect(
      await q(db.owner, `SELECT * FROM users WHERE org_id = $1 AND id <> $2 ORDER BY id`, [
        orgId,
        ownerId,
      ]),
    ).toEqual(usersBefore);
    expect(
      await q(
        db.owner,
        `SELECT * FROM user_security WHERE org_id = $1 AND user_id <> $2 ORDER BY user_id`,
        [orgId, ownerId],
      ),
    ).toEqual(secBefore);
    const sec = (
      await q<{
        email_verified_at: Date;
        password_changed_at: Date;
        force_password_change: boolean;
      }>(db.owner, `SELECT * FROM user_security WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        ownerId,
      ])
    )[0]!;
    expect(sec.email_verified_at).toBeInstanceOf(Date);
    expect(sec.password_changed_at).toBeInstanceOf(Date);
    expect(sec.force_password_change).toBe(false);

    // read it back the way the app's login does (LoginService.findUser: tenant GUCs set, worker login) and verify with the app's verifier
    const c = new Client({ connectionString: withDb(S!.worker, db.name) });
    await c.connect();
    let stored: string | null;
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgId)]);
      stored = (
        await c.query(`SELECT u.password_hash FROM users u WHERE u.org_id = $1 AND u.email = $2`, [
          orgId,
          OWNER_EMAIL,
        ])
      ).rows[0].password_hash;
      await c.query('ROLLBACK');
    } finally {
      await c.end();
    }
    expect(stored).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);

    let passwords: {
      verifyOrDummy(h: string | null, p: string): Promise<boolean>;
      hash(p: string): Promise<string>;
    };
    let which: string;
    try {
      const mod =
        await import('../../../../../apps/api/src/modules/auth/security/password.service');
      passwords = new mod.PasswordService({} as never);
      which = 'the API PasswordService';
    } catch {
      const { verify, hash } = await import(resolve(API_MODULES, '@node-rs/argon2'));
      passwords = {
        hash: (p) => hash(p),
        verifyOrDummy: async (h, p) => Boolean(h) && (await verify(h, p).catch(() => false)),
      };
      which = '@node-rs/argon2 verify (the library PasswordService wraps)';
    }
    console.log(`[set-owner-password] verified with ${which}`);
    expect(await passwords.verifyOrDummy(stored, PW)).toBe(true);
    expect(await passwords.verifyOrDummy(stored, PW + 'x')).toBe(false);
    expect(await passwords.verifyOrDummy(stored, 'wrong-password-1!A')).toBe(false);
    // the same library, same parameters: a hash made by the app verifies with the stored one's parameters
    const appHash = await passwords.hash(PW);
    expect(appHash.split('$').slice(0, 4)).toEqual(stored!.split('$').slice(0, 4));
  });

  it('can be run again (it just sets the new password)', async () => {
    const again = sop(
      { TARGET_DATABASE_URL: db.worker, OWNER_NEW_PASSWORD: 'Another-Good-Pass-7#' },
      base(),
    );
    expect(again.status, again.out).toBe(0);
    expect(again.stdout).toBe(`ok ${ownerUuid}`);
  });
});
