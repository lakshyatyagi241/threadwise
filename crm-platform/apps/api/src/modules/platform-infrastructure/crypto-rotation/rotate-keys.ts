import type { CryptoService } from '../../../common/crypto/crypto.service';
import { collectSealed, ENVELOPE_SOURCE, mapSealed } from './envelope';

/** The slice of `pg.Client` this needs, so a test can drive it with any connection. */
export interface RotationDb {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export type RotationCrypto = Pick<
  CryptoService,
  'isCurrent' | 'reencrypt' | 'keyIdOf' | 'currentKeyId'
>;

export interface ColumnReport {
  /** `table.column`. For a partitioned table this is the parent. */
  column: string;
  kind: 'text' | 'jsonb';
  /** Sealed blobs found. */
  found: number;
  /** Blobs by the key that sealed them (`legacy` = written before key ids existed). */
  byKey: Record<string, number>;
  /** Already under the current key. */
  current: number;
  /** Moved to the current key, or in a dry run the number that would move. */
  rewritten: number;
  /** Rows that changed while we worked and were left alone: run again. */
  changed: number;
  /** Blobs no key in the ring can open (a key already dropped, or a string that only looks like a blob). */
  failed: string[];
}

export interface RotationOptions {
  dryRun?: boolean;
  /** Only these tables (`name` or `schema.name`); default all. */
  only?: string[];
  /** Skip these tables. */
  exclude?: string[];
  batchSize?: number;
  log?: (line: string) => void;
}

const MAX_FAILED_LISTED = 20;
const DEFAULT_EXCLUDE = ['_migrations'];

interface ColumnRef {
  schema: string;
  table: string;
  column: string;
  kind: 'text' | 'jsonb';
}

/**
 * Every text and jsonb column of every ordinary table (a partition is covered through its parent, so nothing is read twice).
 * Found from the catalogue, not from a list: a domain that starts storing ciphertext next year is rotated without anyone
 * remembering to register it.
 */
export async function listColumns(db: RotationDb): Promise<ColumnRef[]> {
  const res = await db.query(`
    SELECT n.nspname AS schema, c.relname AS "table", a.attname AS "column",
           CASE WHEN t.typname = 'jsonb' THEN 'jsonb' ELSE 'text' END AS kind
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_type t ON t.oid = a.atttypid
    WHERE c.relkind IN ('r', 'p')
      AND NOT c.relispartition
      AND n.nspname = 'public'
      AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
      AND (t.typname IN ('text', 'varchar', 'bpchar', 'jsonb'))
    ORDER BY n.nspname, c.relname, a.attnum`);
  return res.rows.map((r) => ({
    schema: String(r.schema),
    table: String(r.table),
    column: String(r.column),
    kind: r.kind === 'jsonb' ? 'jsonb' : 'text',
  }));
}

const quote = (id: string): string => `"${id.replace(/"/g, '""')}"`;
const matches = (name: string, schema: string, list: string[] | undefined): boolean =>
  !!list?.some((x) => x === name || x === `${schema}.${name}`);

const DEFAULT_BATCH = 500;
const MAX_BATCH = 10_000;

/**
 * The rows fetched per round trip. It is written into the SQL text (`FETCH ${batch} FROM rot`: a cursor FETCH cannot take a bound
 * parameter), so it must be provably a small positive integer and anything else is refused, never coerced.
 */
export function rotationBatchSize(requested: number | undefined): number {
  const n = requested ?? DEFAULT_BATCH;
  if (!Number.isInteger(n) || n < 1 || n > MAX_BATCH) {
    throw new Error(
      `Rotation batch size must be an integer from 1 to ${MAX_BATCH}, got ${String(requested)}`,
    );
  }
  return n;
}

/**
 * Finds every sealed blob in the database and (unless `dryRun`) moves it to the current key (TW-INFRA-023).
 *
 * Two connections are needed: `reader` holds a cursor open on a consistent snapshot, `writer` makes the changes one row at a
 * time. Each change is compare-and-swap on the row's physical address and its old value, so a row someone edited meanwhile is
 * left alone and reported as `changed` (run again) rather than overwritten. Both connections must already be privileged
 * (`app.privileged = on`), as row-level security hides other tenants' rows otherwise.
 */
export async function rotateKeys(
  reader: RotationDb,
  writer: RotationDb,
  crypto: RotationCrypto,
  options: RotationOptions = {},
): Promise<ColumnReport[]> {
  const batch = rotationBatchSize(options.batchSize);
  const reports: ColumnReport[] = [];
  const exclude = [...DEFAULT_EXCLUDE, ...(options.exclude ?? [])];

  for (const col of await listColumns(reader)) {
    if (options.only?.length && !matches(col.table, col.schema, options.only)) continue;
    if (matches(col.table, col.schema, exclude)) continue;
    const report = await scanColumn(reader, writer, crypto, col, batch, options.dryRun === true);
    if (report.found > 0 || report.failed.length > 0) {
      reports.push(report);
      options.log?.(
        `${report.column}: ${report.found} sealed, ${report.current} current, ${options.dryRun ? 'would rewrite' : 'rewritten'} ${report.rewritten}, changed meanwhile ${report.changed}, unreadable ${report.failed.length}`,
      );
    }
  }
  return reports;
}

async function scanColumn(
  reader: RotationDb,
  writer: RotationDb,
  crypto: RotationCrypto,
  col: ColumnRef,
  batch: number,
  dryRun: boolean,
): Promise<ColumnReport> {
  const name = `${col.table}.${col.column}`;
  const report: ColumnReport = {
    column: name,
    kind: col.kind,
    found: 0,
    byKey: {},
    current: 0,
    rewritten: 0,
    changed: 0,
    failed: [],
  };
  const from = `${quote(col.schema)}.${quote(col.table)}`;
  const c = quote(col.column);
  // jsonb is searched as text first (cheap), then walked; text must be exactly a blob.
  const filter =
    col.kind === 'jsonb'
      ? `${c}::text LIKE '%v1:%'`
      : `${c} ~ '${ENVELOPE_SOURCE.replace(/'/g, "''")}'`;

  const fail = (what: string) => {
    if (report.failed.length < MAX_FAILED_LISTED) report.failed.push(what);
  };

  await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await reader.query(
      `DECLARE rot NO SCROLL CURSOR FOR
       SELECT tableoid::regclass::text AS tbl, ctid::text AS tid, ${c} AS v FROM ${from} WHERE ${filter}`,
    );
    for (;;) {
      const page = (await reader.query(`FETCH ${batch} FROM rot`)).rows;
      if (page.length === 0) break;
      for (const row of page) {
        const where = `${String(row.tbl)} ${String(row.tid)}`;
        const blobs = col.kind === 'jsonb' ? collectSealed(row.v) : [String(row.v)];
        let needsWrite = false;
        for (const blob of blobs) {
          report.found += 1;
          let keyId: string | null;
          try {
            keyId = crypto.keyIdOf(blob);
          } catch {
            keyId = null;
          }
          const label = keyId ?? 'legacy';
          report.byKey[label] = (report.byKey[label] ?? 0) + 1;
          if (crypto.isCurrent(blob)) {
            report.current += 1;
            continue;
          }
          try {
            crypto.reencrypt(blob); // opens it: proves a key in the ring can read it
            needsWrite = true;
          } catch {
            fail(`${where} (${label})`);
          }
        }
        if (!needsWrite) continue;

        const movable = (blob: string): string => {
          try {
            return crypto.reencrypt(blob);
          } catch {
            return blob; // unreadable ones stay as they are and are already reported
          }
        };
        if (dryRun) {
          report.rewritten += blobs.filter((b) => !crypto.isCurrent(b) && movable(b) !== b).length;
          continue;
        }
        const swapped =
          col.kind === 'jsonb'
            ? await swapJson(
                writer,
                String(row.tbl),
                c,
                String(row.tid),
                row.v,
                mapSealed(row.v, movable),
              )
            : await swapText(
                writer,
                String(row.tbl),
                c,
                String(row.tid),
                String(row.v),
                movable(String(row.v)),
              );
        if (swapped)
          report.rewritten += blobs.filter((b) => !crypto.isCurrent(b) && movable(b) !== b).length;
        else report.changed += 1;
      }
    }
  } finally {
    await reader.query('ROLLBACK');
  }
  return report;
}

/** Compare-and-swap on the row's address and old value: true if it still held `previous`. */
async function swapText(
  db: RotationDb,
  table: string,
  col: string,
  tid: string,
  previous: string,
  next: string,
): Promise<boolean> {
  const res = await db.query(
    `UPDATE ${table} SET ${col} = $3 WHERE ctid = $1::tid AND ${col} = $2 RETURNING 1`,
    [tid, previous, next],
  );
  return res.rows.length === 1;
}

async function swapJson(
  db: RotationDb,
  table: string,
  col: string,
  tid: string,
  previous: unknown,
  next: unknown,
): Promise<boolean> {
  const res = await db.query(
    `UPDATE ${table} SET ${col} = $3::jsonb WHERE ctid = $1::tid AND ${col} = $2::jsonb RETURNING 1`,
    [tid, JSON.stringify(previous), JSON.stringify(next)],
  );
  return res.rows.length === 1;
}

/**
 * True when nothing more needs doing. After a real run: no blob was unreadable and no row moved under us (everything found has
 * been moved, or already was current). After a dry run: additionally nothing would be moved, i.e. the work is already done.
 */
export function isDone(reports: ColumnReport[], dryRun = false): boolean {
  return reports.every(
    (r) => r.changed === 0 && r.failed.length === 0 && (!dryRun || r.rewritten === 0),
  );
}
