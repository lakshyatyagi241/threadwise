import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import type { Client } from 'pg';
import * as schema from './schema';
import { indexStates } from './index-state';

/**
 * Drift check between the Drizzle schema and the live database (the SQL
 * migrations are the source of truth, the Drizzle schema mirrors them for typing).
 *
 * Run it against a database that has had every migration applied:
 *
 *   pnpm db:verify-schema
 *
 * Errors fail the run (exit 1): they are the mismatches that turn into runtime
 * failures — a column Drizzle selects that does not exist, a NOT NULL column Drizzle
 * would insert without, a type or key that disagrees. Warnings are drift that cannot
 * break a query but means the schema file is not a faithful reference.
 *
 * Also asserts the tenancy rule from outside the SQL: every table with an `org_id`
 * column has row-level security enabled AND forced and at least one policy.
 */

interface DbColumn {
  table: string;
  column: string;
  type: string;
  notNull: boolean;
  hasDefault: boolean;
}
interface DbConstraint {
  name: string;
  kind: 'p' | 'u' | 'f' | 'c';
  table: string;
  columns: string[];
  foreignTable: string | null;
  foreignColumns: string[] | null;
  deleteRule: string | null;
}
interface DbIndex {
  name: string;
  table: string;
  unique: boolean;
  columns: string[];
  partial: boolean;
  /** False when a CREATE INDEX CONCURRENTLY failed and left the index behind: the planner never uses it. */
  valid: boolean;
}

const DELETE_RULE: Record<string, string> = {
  a: 'no action',
  r: 'restrict',
  c: 'cascade',
  n: 'set null',
  d: 'set default',
};

/** Tables that exist for the runtime itself, not the domain model. */
const IGNORED_DB_TABLES = new Set(['_migrations']);

function normType(raw: string): string {
  const t = raw
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/, /g, ',')
    .replace('timestamp with time zone', 'timestamptz')
    .replace('timestamp without time zone', 'timestamp')
    .replace('time without time zone', 'time')
    .replace('time with time zone', 'timetz')
    .replace('character varying', 'varchar')
    .replace(/^int8$/, 'bigint')
    .replace(/^int4$/, 'integer')
    .replace(/^int2$/, 'smallint');
  return t === 'numeric' ? 'numeric' : t;
}

const same = (a: readonly string[], b: readonly string[]): boolean => a.join(',') === b.join(',');
const unquote = (s: string): string => s.replace(/^"|"$/g, '');
/** Column names of an index, with `?` for expression columns (those are compared by index name only). */
const indexColumnNames = (cols: readonly unknown[]): string[] =>
  cols.map((c) =>
    typeof c === 'object' && c !== null && 'name' in c && typeof c.name === 'string' ? c.name : '?',
  );

async function loadCatalog(client: Client): Promise<{
  columns: Map<string, Map<string, DbColumn>>;
  constraints: DbConstraint[];
  indexes: DbIndex[];
  rls: Map<string, { enabled: boolean; forced: boolean; policies: number; hasOrgId: boolean }>;
}> {
  const cols = await client.query<{
    table: string;
    column: string;
    type: string;
    not_null: boolean;
    has_default: boolean;
  }>(`
    SELECT c.relname AS "table", a.attname AS "column",
           format_type(a.atttypid, a.atttypmod) AS type,
           a.attnotnull AS not_null,
           (a.atthasdef OR a.attidentity <> '') AS has_default
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relispartition
      AND a.attnum > 0 AND NOT a.attisdropped
  `);
  const columns = new Map<string, Map<string, DbColumn>>();
  for (const r of cols.rows) {
    if (!columns.has(r.table)) columns.set(r.table, new Map());
    columns.get(r.table)!.set(r.column, {
      table: r.table,
      column: r.column,
      type: normType(r.type),
      notNull: r.not_null,
      hasDefault: r.has_default,
    });
  }

  const cons = await client.query<{
    name: string;
    kind: 'p' | 'u' | 'f' | 'c';
    table: string;
    columns: string[] | null;
    foreign_table: string | null;
    foreign_columns: string[] | null;
    delete_rule: string | null;
  }>(`
    SELECT c.conname AS name, c.contype AS kind, rel.relname AS "table",
      (SELECT array_agg(att.attname::text ORDER BY k.ord)
         FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
         JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = k.attnum) AS columns,
      frel.relname AS foreign_table,
      (SELECT array_agg(att.attname::text ORDER BY k.ord)
         FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
         JOIN pg_attribute att ON att.attrelid = c.confrelid AND att.attnum = k.attnum) AS foreign_columns,
      c.confdeltype AS delete_rule
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    LEFT JOIN pg_class frel ON frel.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    WHERE n.nspname = 'public' AND c.contype IN ('p','u','f','c') AND NOT rel.relispartition
      AND c.conparentid = 0
  `);
  const constraints: DbConstraint[] = cons.rows.map((r) => ({
    name: r.name,
    kind: r.kind,
    table: r.table,
    columns: r.columns ?? [],
    foreignTable: r.foreign_table,
    foreignColumns: r.foreign_columns,
    deleteRule: r.delete_rule ? (DELETE_RULE[r.delete_rule] ?? r.delete_rule) : null,
  }));

  const idx = await client.query<{
    name: string;
    table: string;
    unique: boolean;
    partial: boolean;
    valid: boolean;
    columns: string[];
  }>(`
    SELECT i.relname AS name, t.relname AS "table", ix.indisunique AS "unique",
           (ix.indpred IS NOT NULL) AS partial, ix.indisvalid AS valid,
           (SELECT array_agg(pg_get_indexdef(ix.indexrelid, k + 1, true) ORDER BY k)
              FROM generate_series(0, ix.indnkeyatts - 1) k) AS columns
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND NOT ix.indisprimary AND NOT i.relispartition
      AND NOT t.relispartition
      AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = ix.indexrelid)
  `);
  const indexes: DbIndex[] = idx.rows.map((r) => ({ ...r }));

  const rlsRows = await client.query<{
    table: string;
    enabled: boolean;
    forced: boolean;
    policies: string;
    has_org_id: boolean;
  }>(`
    SELECT c.relname AS "table", c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
           (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies,
           EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped) AS has_org_id
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relispartition
  `);
  const rls = new Map(
    rlsRows.rows.map((r) => [
      r.table,
      {
        enabled: r.enabled,
        forced: r.forced,
        policies: Number(r.policies),
        hasOrgId: r.has_org_id,
      },
    ]),
  );
  return { columns, constraints, indexes, rls };
}

function compareTable(
  table: PgTable,
  cat: Awaited<ReturnType<typeof loadCatalog>>,
  err: Report['err'],
  warn: Report['warn'],
): void {
  const cfg = getTableConfig(table);
  const name = cfg.name;
  const dbCols = cat.columns.get(name);
  if (!dbCols) {
    err(name, 'declared in Drizzle but the table does not exist in the database');
    return;
  }
  const declared = new Map(cfg.columns.map((c) => [c.name, c]));

  for (const [colName, col] of declared) {
    const db = dbCols.get(colName);
    if (!db) {
      err(name, `column ${colName} is declared in Drizzle but missing in the database`);
      continue;
    }
    const drizzleType = normType(col.getSQLType());
    const dbType = db.type;
    // Enum columns report the enum's name from both sides; numeric precision may be absent in one.
    const typeOk =
      drizzleType === dbType ||
      (drizzleType === 'numeric' && dbType.startsWith('numeric')) ||
      (dbType === 'numeric' && drizzleType.startsWith('numeric'));
    if (!typeOk)
      err(name, `column ${colName}: Drizzle says ${drizzleType}, database says ${dbType}`);
    if (col.notNull !== db.notNull) {
      err(
        name,
        `column ${colName}: Drizzle notNull=${col.notNull}, database NOT NULL=${db.notNull}`,
      );
    }
    if (col.hasDefault && !db.hasDefault) {
      err(name, `column ${colName}: Drizzle has a default, the database has none`);
    } else if (!col.hasDefault && db.hasDefault && db.notNull) {
      warn(name, `column ${colName}: database has a default Drizzle does not know about`);
    }
  }
  for (const [colName, db] of dbCols) {
    if (declared.has(colName)) continue;
    if (db.notNull && !db.hasDefault) {
      err(
        name,
        `column ${colName} is NOT NULL without a default in the database but missing from Drizzle (inserts will fail)`,
      );
    } else {
      warn(name, `column ${colName} exists in the database but not in Drizzle`);
    }
  }

  const dbCons = cat.constraints.filter((c) => c.table === name);

  // primary key
  const dbPk = dbCons.find((c) => c.kind === 'p');
  const pkCols = cfg.primaryKeys.length
    ? cfg.primaryKeys[0]!.columns.map((c) => c.name)
    : cfg.columns.filter((c) => c.primary).map((c) => c.name);
  if (dbPk && !same(dbPk.columns, pkCols)) {
    err(
      name,
      `primary key: Drizzle (${pkCols.join(', ')}) vs database (${dbPk.columns.join(', ')})`,
    );
  } else if (!dbPk && pkCols.length) {
    err(name, 'primary key declared in Drizzle but none in the database');
  } else if (dbPk && !pkCols.length) {
    warn(name, `primary key (${dbPk.columns.join(', ')}) is not declared in Drizzle`);
  }

  // unique sets: constraints and unique indexes both count
  const declaredUniques: string[][] = [
    ...cfg.uniqueConstraints.map((u) => u.columns.map((c) => c.name)),
    ...cfg.indexes.filter((i) => i.config.unique).map((i) => indexColumnNames(i.config.columns)),
    ...cfg.columns.filter((c) => c.isUnique).map((c) => [c.name]),
  ];
  const dbUniques: string[][] = [
    ...dbCons.filter((c) => c.kind === 'u').map((c) => c.columns),
    ...cat.indexes.filter((i) => i.table === name && i.unique).map((i) => i.columns.map(unquote)),
  ];
  for (const u of declaredUniques) {
    if (!dbUniques.some((d) => same(d, u)))
      err(name, `unique (${u.join(', ')}) declared in Drizzle but not in the database`);
  }
  for (const u of dbUniques) {
    if (!declaredUniques.some((d) => same(d, u)))
      warn(name, `unique (${u.join(', ')}) exists in the database but not in Drizzle`);
  }

  // foreign keys
  const dbFks = dbCons.filter((c) => c.kind === 'f');
  const declaredFks = cfg.foreignKeys.map((fk) => {
    const ref = fk.reference();
    return {
      columns: ref.columns.map((c) => c.name),
      foreignTable: getTableConfig(ref.foreignTable).name,
      foreignColumns: ref.foreignColumns.map((c) => c.name),
      onDelete: (fk.onDelete ?? 'no action').toLowerCase(),
    };
  });
  for (const fk of declaredFks) {
    const hit = dbFks.find(
      (d) =>
        same(d.columns, fk.columns) &&
        d.foreignTable === fk.foreignTable &&
        same(d.foreignColumns ?? [], fk.foreignColumns),
    );
    if (!hit) {
      err(
        name,
        `foreign key (${fk.columns.join(', ')}) -> ${fk.foreignTable} declared in Drizzle but not in the database`,
      );
    } else if (
      hit.deleteRule !== fk.onDelete &&
      !(hit.deleteRule === 'no action' && fk.onDelete === 'no action')
    ) {
      err(
        name,
        `foreign key (${fk.columns.join(', ')}) -> ${fk.foreignTable}: Drizzle ON DELETE ${fk.onDelete}, database ${hit.deleteRule}`,
      );
    }
  }
  for (const d of dbFks) {
    if (
      !declaredFks.some((fk) => same(d.columns, fk.columns) && d.foreignTable === fk.foreignTable)
    ) {
      warn(
        name,
        `foreign key (${d.columns.join(', ')}) -> ${d.foreignTable} exists in the database but not in Drizzle`,
      );
    }
  }

  // plain indexes (column lists only; expression and partial indexes are compared by name)
  const dbIdx = cat.indexes.filter((i) => i.table === name && !i.unique);
  for (const ix of cfg.indexes.filter((i) => !i.config.unique)) {
    const ixName = ix.config.name;
    const cols = indexColumnNames(ix.config.columns);
    const hit = dbIdx.find((d) => d.name === ixName);
    if (!hit) err(name, `index ${ixName} declared in Drizzle but not in the database`);
    else if (!hit.partial && !cols.includes('?') && !same(hit.columns.map(unquote), cols)) {
      err(
        name,
        `index ${ixName}: Drizzle (${cols.join(', ')}) vs database (${hit.columns.join(', ')})`,
      );
    }
  }
  for (const d of dbIdx) {
    if (!cfg.indexes.some((i) => i.config.name === d.name))
      warn(name, `index ${d.name} exists in the database but not in Drizzle`);
  }

  // check constraints: presence by name
  const dbChecks = new Set(dbCons.filter((c) => c.kind === 'c').map((c) => c.name));
  for (const ck of cfg.checks) {
    if (!dbChecks.has(ck.name))
      err(name, `check constraint ${ck.name} declared in Drizzle but not in the database`);
  }
}

export interface VerifyResult {
  /** Mismatches that become runtime failures. */
  errors: string[];
  /** Drift that cannot break a query but means the schema file is not a faithful reference. */
  warnings: string[];
  /** Drizzle tables checked. */
  declared: number;
  /** Base tables found in the database. */
  inDatabase: number;
}

interface Report {
  err: (table: string, msg: string) => number;
  warn: (table: string, msg: string) => number;
}

/** Compare every Drizzle table against the live catalog of an already-connected client. */
export async function verifySchema(client: Client): Promise<VerifyResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err: Report['err'] = (table, msg) => errors.push(`${table}: ${msg}`);
  const warn: Report['warn'] = (table, msg) => warnings.push(`${table}: ${msg}`);

  const cat = await loadCatalog(client);
  const tables = Object.values(schema as Record<string, unknown>).filter((v): v is PgTable =>
    is(v, PgTable),
  );
  const declaredNames = new Set<string>();
  for (const t of tables) {
    declaredNames.add(getTableConfig(t).name);
    compareTable(t, cat, err, warn);
  }
  for (const dbTable of cat.columns.keys()) {
    if (declaredNames.has(dbTable) || IGNORED_DB_TABLES.has(dbTable)) continue;
    if (/_(default|\d{6})$/.test(dbTable)) continue; // partitions
    warn(dbTable, 'exists in the database but has no Drizzle declaration');
  }
  for (const ix of await indexStates(client, null)) {
    if (!ix.valid) {
      err(
        ix.table,
        `index ${ix.name} is INVALID (a CREATE INDEX CONCURRENTLY failed): DROP INDEX CONCURRENTLY ${ix.quoted}, then rerun the migration`,
      );
    }
  }
  for (const [table, r] of cat.rls) {
    if (!r.hasOrgId || IGNORED_DB_TABLES.has(table)) continue;
    if (!r.enabled || !r.forced || r.policies === 0) {
      err(
        table,
        `tenant table without working RLS (enabled=${r.enabled} forced=${r.forced} policies=${r.policies})`,
      );
    }
  }
  return { errors, warnings, declared: tables.length, inDatabase: cat.columns.size };
}
