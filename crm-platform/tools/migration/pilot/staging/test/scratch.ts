import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

/** The local scratch Postgres (pilot/scratch-db.cjs): throwaway credentials, 127.0.0.1 only. */
const ENV = resolve(__dirname, '../../.scratch.env');

export function scratchUrls(): { owner: string; worker: string } | null {
  if (!existsSync(ENV)) return null;
  const e = Object.fromEntries(
    readFileSync(ENV, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
  return { owner: e.MIGRATION_DATABASE_URL!, worker: e.TARGET_DATABASE_URL! };
}

export const withDb = (url: string, db: string, user?: string, pass?: string): string => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  if (user) u.username = user;
  if (pass) u.password = pass;
  return u.toString();
};

export async function sqlOn(url: string, ...stmts: string[]): Promise<void> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    for (const s of stmts) await c.query(s);
  } finally {
    await c.end();
  }
}

let n = 0;
const made: string[] = [];

/** A throwaway database cloned from the migrated scratch database; removed by dropAll(). */
export async function cloneScratch(
  label: string,
): Promise<{ name: string; owner: string; worker: string }> {
  const s = scratchUrls()!;
  const admin = withDb(s.owner, 'postgres');
  const name = `pf_${label}_${process.pid}_${n++}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const tpl = new URL(s.owner).pathname.slice(1);
  made.push(name);
  for (let attempt = 1; ; attempt++) {
    try {
      await sqlOn(
        admin,
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${tpl}' AND pid <> pg_backend_pid()`,
        `CREATE DATABASE ${name} TEMPLATE ${tpl}`,
      );
      break;
    } catch (e) {
      if (attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  return { name, owner: withDb(s.owner, name), worker: withDb(s.worker, name) };
}

export async function dropAll(): Promise<void> {
  const s = scratchUrls();
  if (!s) return;
  for (const name of made.splice(0))
    await sqlOn(withDb(s.owner, 'postgres'), `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
}
