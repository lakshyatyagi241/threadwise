import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';
import { PRIVACY_ALLOWLIST } from '../../../src/modules/privacy/registry/allowlist';
import { KNOWN_NO_FK_LINKS } from '../../../src/modules/privacy/registry/known-links';
import {
  PERSONAL_DATA_REGISTRY,
  registeredSpecs,
  registeredTables,
} from '../../../src/modules/privacy/registry';
import type { Link, Replacement, TableSpec } from '../../../src/modules/privacy/registry/types';

/**
 * BL-142: the personal-data registry is enforced against the REAL migrated schema.
 *
 * A table that points at a person (a foreign key to contacts, to conversations, a contact column, a column holding a phone, an email,
 * an address, an IP or a person's name) must be declared by a holder in `src/modules/privacy/manifests`, or sit in
 * `registry/allowlist.ts` with a written reason. Adding such a table without doing either fails here, which is the point: a new module
 * cannot ship a place where a person's data lives that erasure and export do not know about.
 *
 * The declarations are checked against the schema as well (columns exist, replacements fit the column type, a `cascade` claim is a real
 * cascading foreign key), so the registry cannot drift from the migrations.
 *
 * `REGISTRY_TEST_DATABASE_URL` points the suite at a database that is already migrated (a developer's scratch database); without it a
 * container is started and every migration is applied.
 */
interface Col {
  table: string;
  column: string;
  type: string;
  nullable: boolean;
}
interface Fk {
  table: string;
  columns: string[];
  parent: string;
  del: string;
}

/** Columns that hold a person's contact value or identity (the heuristic of rule E). */
const PII_COLUMN =
  /(^|_)(phone|email|msisdn|mobile)(_e164|_digits|_number)?$|^ip(_address)?$|(^|_)ip$|user_agent$|^recipient$|^peer_(key|name)$|^(buyer|customer|invitee|signer|caller|callee|visitor)_(name|email|phone)$|^(first|last|full|middle)_name$/;
/** Columns named like a link to a contact. */
const CONTACT_COLUMN = /^(lead_|target_)?contact_(id|uuid)$/;
/** Columns that hold an object-storage locator. */
const STORAGE_COLUMN =
  /(^|_)(storage_key|media_key|object_key|recording_path|pdf_path|media_path|attachment_path|file_path)$/;

const TEXT_TYPES = new Set(['text', 'character varying', 'citext', 'character']);

describe('personal-data registry against the migrated schema', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let owner: Client;
  let tables: string[] = [];
  let cols: Col[] = [];
  let fks: Fk[] = [];
  const reasons = new Map<string, string[]>();
  const colsOf = (t: string) => cols.filter((c) => c.table === t);
  const col = (t: string, c: string) => cols.find((x) => x.table === t && x.column === c);

  beforeAll(async () => {
    const url = process.env.REGISTRY_TEST_DATABASE_URL;
    if (url) {
      owner = new Client({ connectionString: url });
      await owner.connect();
    } else {
      container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
        .withDatabase('crm')
        .withUsername('crm')
        .withPassword('crm')
        .start();
      owner = new Client({ connectionString: container.getConnectionUri() });
      await owner.connect();
      await runMigrations(container.getConnectionUri(), {
        dir: resolve(__dirname, '../../../../../packages/db/migrations'),
        log: () => undefined,
      });
    }

    tables = (
      await owner.query<{ t: string }>(`
        SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relispartition ORDER BY 1`)
    ).rows.map((r) => r.t);
    cols = (
      await owner.query<{ table: string; column: string; type: string; nullable: boolean }>(`
        SELECT c.table_name AS "table", c.column_name AS "column", c.data_type AS type, c.is_nullable = 'YES' AS nullable
          FROM information_schema.columns c
         WHERE c.table_schema = 'public'`)
    ).rows.filter((c) => tables.includes(c.table));
    fks = (
      await owner.query<{ table: string; columns: string[]; parent: string; del: string }>(`
        SELECT k.conrelid::regclass::text AS "table", k.confrelid::regclass::text AS parent, k.confdeltype::text AS del,
               ARRAY(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid = k.conrelid AND a.attnum = ANY(k.conkey)) AS columns
          FROM pg_constraint k WHERE k.contype = 'f' AND k.connamespace = 'public'::regnamespace`)
    ).rows;

    // ---- which tables point at a person, and why ------------------------------------------------------------------------------
    const why = (t: string, r: string) => reasons.set(t, [...(reasons.get(t) ?? []), r]);
    for (const k of fks) {
      if (!tables.includes(k.table)) continue;
      if (k.parent === 'contacts') why(k.table, `foreign key to contacts (${k.columns.join(',')})`);
      if (k.parent === 'conversations')
        why(k.table, `foreign key to conversations (${k.columns.join(',')})`);
    }
    for (const c of cols) if (CONTACT_COLUMN.test(c.column)) why(c.table, `column ${c.column}`);
    for (const l of KNOWN_NO_FK_LINKS) why(l.table, `known link ${l.column}`);
    for (const c of cols)
      if (PII_COLUMN.test(c.column)) why(c.table, `personal-value column ${c.column}`);
  }, 240_000);

  afterAll(async () => {
    await owner?.end();
    await container?.stop();
  });

  const registered = () => registeredTables();
  const specs = () => registeredSpecs();

  it('every table that points at a person is registered or allow-listed with a reason', () => {
    const missing = [...reasons.keys()]
      .filter((t) => !registered().has(t) && !(t in PRIVACY_ALLOWLIST))
      .sort()
      .map((t) => `${t}: ${[...new Set(reasons.get(t))].join('; ')}`);
    expect(
      missing,
      `Register these in apps/api/src/modules/privacy/manifests or allow-list them with a reason:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('the detector is not vacuous: with nothing registered it flags the tables we know hold personal data', () => {
    const flagged = new Set(reasons.keys());
    for (const t of [
      'contacts',
      'messages',
      'conversations',
      'invoices',
      'wa_calls',
      'ai_call_logs',
      'lead_scoring_runs',
      'contact_files',
      'leads',
      'web_form_submissions',
      'appointments',
    ]) {
      // `contacts` itself has no inbound pointer: it is covered by its own columns.
      if (t === 'contacts') continue;
      expect(flagged.has(t), `${t} should be detected as pointing at a person`).toBe(true);
    }
    expect(flagged.size).toBeGreaterThan(80);
  });

  it('the allow-list has no stale entry, no empty reason, and no table that is also registered', () => {
    const stale = Object.keys(PRIVACY_ALLOWLIST).filter((t) => !tables.includes(t));
    expect(stale, 'allow-listed tables that no longer exist').toEqual([]);
    const both = Object.keys(PRIVACY_ALLOWLIST).filter((t) => registered().has(t));
    expect(both, 'tables both registered and allow-listed').toEqual([]);
    const thin = Object.entries(PRIVACY_ALLOWLIST)
      .filter(([, e]) => e.reason.trim().length < 20)
      .map(([t]) => t);
    expect(thin, 'allow-list entries need a real sentence').toEqual([]);
    // An allow-listed table that no longer matches any rule is dead weight.
    const unneeded = Object.keys(PRIVACY_ALLOWLIST).filter((t) => !reasons.has(t));
    expect(unneeded, 'allow-listed tables that no rule flags any more').toEqual([]);
  });

  it('every registered table exists, once, and every declared column exists', () => {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const { holder, spec } of specs()) {
      if (!tables.includes(spec.table)) {
        problems.push(`${holder.key}: table ${spec.table} does not exist`);
        continue;
      }
      if (seen.has(spec.table)) problems.push(`${spec.table} is registered twice`);
      seen.add(spec.table);
      const need = (name: string, what: string) => {
        if (!col(spec.table, name)) problems.push(`${spec.table}.${name} (${what}) does not exist`);
      };
      for (const l of ([] as Link[]).concat(spec.link as Link | Link[]))
        checkLink(l, spec.table, need, problems);
      for (const c of spec.pii) need(c, 'pii');
      for (const s of spec.storage ?? []) need(s.column, 'storage');
      for (const c of spec.exportOmit ?? []) need(c, 'exportOmit');
      const set = anonymiseOf(spec);
      for (const c of Object.keys(set)) need(c, 'replacement');
      if (!col(spec.table, 'org_id'))
        problems.push(`${spec.table} has no org_id: a registry table must be tenant data`);
    }
    expect(problems).toEqual([]);
  });

  it('every replacement fits its column', () => {
    const problems: string[] = [];
    for (const { spec } of specs()) {
      for (const [c, r] of Object.entries(anonymiseOf(spec))) {
        const meta = col(spec.table, c);
        if (!meta) continue;
        const bad = misfit(r, meta);
        if (bad) problems.push(`${spec.table}.${c}: ${bad}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('every cascade and unlink claim is a real foreign key', () => {
    const problems: string[] = [];
    for (const { spec } of specs()) {
      if (spec.disposition !== 'cascade' && spec.disposition !== 'fk_null') continue;
      const want = spec.disposition === 'cascade' ? 'c' : 'n';
      const hit = fks.find(
        (k) => k.table === spec.table && k.parent === spec.parent && k.del === want,
      );
      if (!hit) {
        problems.push(
          `${spec.table}: declared ${spec.disposition} from ${spec.parent}, but no foreign key ${spec.table} -> ${spec.parent} with ON DELETE ${want === 'c' ? 'CASCADE' : 'SET NULL'}`,
        );
      }
    }
    expect(problems).toEqual([]);
  });

  it('a foreign key to contacts is never left to chance: it is declared, and a contact delete cannot be blocked', () => {
    const toContacts = fks.filter((k) => k.parent === 'contacts' && tables.includes(k.table));
    const blocking = toContacts.filter((k) => k.del === 'a' || k.del === 'r').map((k) => k.table);
    expect(blocking, 'foreign keys that would block deleting a contact').toEqual([]);
    const undeclared = toContacts
      .map((k) => k.table)
      .filter((t) => !registered().has(t) && !(t in PRIVACY_ALLOWLIST));
    expect(undeclared).toEqual([]);
  });

  it('the known links that have no foreign key still exist and are registered', () => {
    const gone = KNOWN_NO_FK_LINKS.filter((l) => !col(l.table, l.column)).map(
      (l) => `${l.table}.${l.column}`,
    );
    expect(gone, 'known links whose column disappeared').toEqual([]);
    const unregistered = KNOWN_NO_FK_LINKS.filter((l) => !registered().has(l.table)).map(
      (l) => l.table,
    );
    expect(unregistered).toEqual([]);
  });

  it('every object-storage locator on a registered table is declared as storage', () => {
    const problems: string[] = [];
    for (const { spec } of specs()) {
      const declared = new Set((spec.storage ?? []).map((s) => s.column));
      for (const c of colsOf(spec.table)) {
        if (STORAGE_COLUMN.test(c.column) && TEXT_TYPES.has(c.type) && !declared.has(c.column)) {
          problems.push(
            `${spec.table}.${c.column} looks like a stored file and is not declared in storage`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('financial records are only ever anonymised, under a declared legal hold', () => {
    const wrong = specs()
      .filter(({ spec }) => spec.tier === 'financial')
      .filter(
        ({ spec }) => spec.disposition === 'delete' || !('legalHold' in spec) || !spec.legalHold,
      )
      .map(({ spec }) => spec.table);
    expect(wrong).toEqual([]);
  });

  it('every holder has a key, a module, subjects, and both handlers', () => {
    const keys = new Set<string>();
    for (const h of PERSONAL_DATA_REGISTRY) {
      expect(h.key).toMatch(/^[a-z]+(\.[a-z_]+)?$/);
      expect(keys.has(h.key), `duplicate holder key ${h.key}`).toBe(false);
      keys.add(h.key);
      expect(h.module.length).toBeGreaterThan(2);
      expect(h.subjects.length).toBeGreaterThan(0);
      expect(typeof h.export).toBe('function');
      expect(typeof h.erase).toBe('function');
    }
  });

  it('prints the coverage numbers', () => {
    const contactLinked = [...reasons.entries()].filter(([, r]) =>
      r.some(
        (x) =>
          x.startsWith('foreign key to contacts') ||
          x.startsWith('column ') ||
          x.startsWith('known link'),
      ),
    );
    const flagged = reasons.size;
    const reg = [...reasons.keys()].filter((t) => registered().has(t)).length;
    const allowed = [...reasons.keys()].filter((t) => t in PRIVACY_ALLOWLIST).length;
    console.info(
      `[privacy-registry] tables in schema: ${tables.length}; flagged as pointing at a person: ${flagged}; ` +
        `registered: ${reg}; allow-listed: ${allowed}; contact-linked (fk/column/known): ${contactLinked.length}; ` +
        `holders: ${PERSONAL_DATA_REGISTRY.length}; registered tables: ${registered().size}; ` +
        `follow-ups on the allow-list: ${Object.values(PRIVACY_ALLOWLIST).filter((e) => e.kind === 'follow_up').length}`,
    );
    expect(reg + allowed).toBe(flagged);
  });
});

function checkLink(
  l: Link,
  table: string,
  need: (c: string, what: string) => void,
  problems: string[],
): void {
  need(l.column, `link ${l.by}`);
  if (l.by === 'via') {
    for (const inner of ([] as Link[]).concat(l.link as Link | Link[])) {
      // The inner link is on the other table, checked by that table's own declaration of the same columns.
      void inner;
    }
    if (!l.table || !l.key) problems.push(`${table}: via link without table/key`);
  }
}

function anonymiseOf(spec: TableSpec): Readonly<Record<string, Replacement>> {
  if (spec.disposition === 'anonymise') return spec.set;
  if (spec.disposition === 'delete' && spec.whenAnonymising && spec.whenAnonymising !== 'keep')
    return spec.whenAnonymising;
  return {};
}

function misfit(r: Replacement, c: Col): string | null {
  if (typeof r === 'object') return TEXT_TYPES.has(c.type) ? null : `a text value into ${c.type}`;
  switch (r) {
    case 'null':
      return c.nullable ? null : 'NULL into a NOT NULL column';
    case 'tombstone':
    case 'empty_text':
    case 'erased_uuid':
      return TEXT_TYPES.has(c.type) ? null : `text into ${c.type}`;
    case 'empty_object':
    case 'empty_array':
      return c.type === 'jsonb' ? null : `json into ${c.type}`;
    case 'false':
      return c.type === 'boolean' ? null : `boolean into ${c.type}`;
    case 'now':
      return c.type.startsWith('timestamp') ? null : `a timestamp into ${c.type}`;
  }
}
