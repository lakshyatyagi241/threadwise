import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inject } from 'vitest';
import { sql } from 'drizzle-orm';
import { NdjsonDirSource } from '../extract/source';
import { writeManifest } from '../extract/manifest';
import { connect, ensureSchema, type Database } from '../load/db';
import { runClient, type RunOptions } from '../load/run';
import { reconcile } from '../reconcile';
import { writeFixtures, type FixtureOptions } from './fixtures';

export const CLIENTS = ['acme', 'globex'] as const;

const swap = (url: string, user: string, pass: string, db: string): string => {
  const u = new URL(url);
  u.username = user;
  u.password = pass;
  u.pathname = `/${db}`;
  return u.toString();
};

export interface TestDb {
  name: string;
  /** superuser URL: used for mutations and for `init` / org creation */
  ownerUrl: string;
  /** crm_worker_user URL: what the loader and verifier run as */
  workerUrl: string;
  drop(): Promise<void>;
}

let counter = 0;
/** A fresh database cloned from the migrated template, with the tool's own schema created. */
export async function cloneDb(label: string, from?: string): Promise<TestDb> {
  const admin = connect(inject('adminUrl'), 'admin');
  const name = `mig_${label}_${process.pid}_${counter++}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  try {
    // a template must have no other sessions; a pool that is still closing in the previous test can briefly hold one
    const tpl = from ?? inject('template');
    for (let attempt = 1; ; attempt++) {
      try {
        await admin.db.execute(
          sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${tpl} AND pid <> pg_backend_pid()`,
        );
        await admin.db.execute(sql.raw(`CREATE DATABASE ${name} TEMPLATE ${tpl}`));
        break;
      } catch (e) {
        const cause = (e as { cause?: { message?: string } }).cause?.message ?? String(e);
        if (attempt >= 5)
          throw new Error(`CREATE DATABASE ${name} TEMPLATE ${tpl} failed: ${cause}`);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  } finally {
    await admin.close();
  }
  const ownerUrl = swap(inject('adminUrl'), 'crm', 'crm', name);
  const workerUrl = swap(inject('adminUrl'), 'crm_worker_user', 'crm_worker_dev', name);
  if (!from) {
    const owner = connect(ownerUrl, 'init');
    try {
      await ensureSchema(owner.db);
    } finally {
      await owner.close();
    }
  }
  return {
    name,
    ownerUrl,
    workerUrl,
    async drop() {
      const a = connect(inject('adminUrl'), 'admin');
      try {
        await a.db.execute(sql.raw(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
      } finally {
        await a.close();
      }
    },
  };
}

export interface Dumps {
  dir: string;
  source: NdjsonDirSource;
  cleanup(): void;
}

export async function makeDumps(opts?: FixtureOptions): Promise<Dumps> {
  const dir = mkdtempSync(join(tmpdir(), 'migtool-dumps-'));
  writeFixtures(dir, opts);
  const source = new NdjsonDirSource(dir);
  for (const c of CLIENTS) await writeManifest(source, dir, c);
  return { dir, source, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export const runOpts = (
  d: Dumps,
  db: TestDb,
  client: string,
  extra: Partial<RunOptions> = {},
): RunOptions => ({
  source: d.source,
  dumpsDir: d.dir,
  client,
  targetUrl: db.workerUrl,
  ownerUrl: db.ownerUrl,
  org: { name: client, slug: client },
  batchSize: 7,
  defaultCountryCode: null,
  log: () => undefined,
  ...extra,
});

export async function runAll(d: Dumps, db: TestDb, extra: Partial<RunOptions> = {}): Promise<void> {
  for (const c of CLIENTS) await runClient(runOpts(d, db, c, extra));
}

export const verify = (d: Dumps, db: TestDb, client: string) =>
  reconcile({
    source: d.source,
    dumpsDir: d.dir,
    client,
    targetUrl: db.workerUrl,
    sampleSize: 1000,
    skipHash: false,
  });

/** Run SQL as the owner (superuser: RLS does not apply), for mutations and counts. */
export async function asOwner<T>(db: TestDb, fn: (d: Database) => Promise<T>): Promise<T> {
  const c = connect(db.ownerUrl, 'owner');
  try {
    return await fn(c.db);
  } finally {
    await c.close();
  }
}

export const count = async (db: TestDb, table: string): Promise<number> =>
  asOwner(db, async (d) =>
    Number(
      (
        (await d.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`))).rows[0] as {
          n: number;
        }
      ).n,
    ),
  );

/** Content snapshot that is stable across runs: ids are replaced by the deterministic uuids of the rows they point at. */
export async function snapshot(db: TestDb): Promise<string> {
  const refs: Record<string, string> = {
    field_id: 'fields',
    section_id: 'field_sections',
    contact_id: 'contacts',
    group_id: 'contact_groups',
    tag_id: 'tags',
    parent_option_id: 'field_options',
    child_option_id: 'field_options',
    depends_on_field_id: 'fields',
    stage_option_id: 'status_options',
  };
  const tables = [
    'field_sections',
    'fields',
    'field_options',
    'field_dependencies',
    'field_option_dependencies',
    'status_options',
    'tags',
    'contact_groups',
    'contacts',
    'contact_group_members',
    'contact_notes',
    'wa_templates',
  ];
  return asOwner(db, async (d) => {
    const uuidOf = new Map<string, string>();
    const all: Record<string, Array<Record<string, unknown>>> = {};
    for (const t of tables) {
      const rows = (await d.execute(sql.raw(`SELECT * FROM ${t} ORDER BY uuid`))).rows as Array<
        Record<string, unknown>
      >;
      all[t] = rows;
      for (const r of rows) uuidOf.set(`${t}:${String(r.org_id)}:${String(r.id)}`, String(r.uuid));
    }
    const out: Record<string, unknown[]> = {};
    for (const t of tables) {
      out[t] = all[t]!.map((r) => {
        const o: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) {
          if (k === 'id' || k === 'org_id' || k === 'row_version' || k === 'search_vector')
            continue;
          o[k] =
            refs[k] && v !== null
              ? (uuidOf.get(`${refs[k]}:${String(r.org_id)}:${String(v)}`) ?? `?${String(v)}`)
              : v;
        }
        return o;
      });
    }
    return JSON.stringify(out);
  });
}

/** Raw collection files for several clients (an array of docs or exact text), then a manifest for each. */
export async function customDumps(
  clients: Record<string, Record<string, Array<Record<string, unknown>> | string>>,
): Promise<Dumps> {
  const dir = mkdtempSync(join(tmpdir(), 'migtool-custom-'));
  for (const [client, colls] of Object.entries(clients)) {
    mkdirSync(join(dir, client), { recursive: true });
    for (const [coll, docs] of Object.entries(colls)) {
      const body =
        typeof docs === 'string'
          ? docs
          : docs.map((d) => JSON.stringify(d)).join(String.fromCharCode(10)) +
            String.fromCharCode(10);
      writeFileSync(join(dir, client, `${coll}.ndjson`), body);
    }
  }
  const source = new NdjsonDirSource(dir);
  for (const c of Object.keys(clients)) await writeManifest(source, dir, c);
  return { dir, source, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
