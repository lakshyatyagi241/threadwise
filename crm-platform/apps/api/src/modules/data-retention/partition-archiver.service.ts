import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { createHash, type Hash } from 'node:crypto';
import { appendFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { createGunzip, gzip } from 'node:zlib';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';
import {
  ARCHIVE_STORAGE,
  readBytes,
  type ArchiveStorage,
} from '../../infra/providers/data-retention/archive-storage.port';
import { failureKeyOf, manifestKeyOf, objectKeyOf, prefixOf } from './archive-keys';
import {
  isPastLiveWindow,
  monthOfPartition,
  partitionName,
  type StreamPolicy,
} from './retention-policies';

const gzipAsync = promisify(gzip);

/** The one thing the service needs from the database layer; `DatabaseService` satisfies it and tests can hand in an adapter. */
export interface Privileged {
  privileged<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export const ARCHIVER_OPTIONS = Symbol('ARCHIVER_OPTIONS');
export interface ArchiverOptions {
  /** Rows read per query and compressed per chunk. */
  batchRows?: number;
}

/** Written last, after every object it names, so a manifest never describes objects that are not there yet. */
export interface ArchiveManifest {
  version: 1;
  stream: string;
  month: string;
  partitionKey: string;
  /** Columns present in each line, in table order. */
  columns: string[];
  /** Columns left out on purpose (see `StreamPolicy.omitColumns`). */
  omitted: string[];
  createdAt: string;
  totalRows: number;
  orgs: Record<string, ArchiveOrgEntry>;
}
export interface ArchiveOrgEntry {
  key: string;
  rows: number;
  /** Size of the gzip object in the store. */
  bytes: number;
  /** SHA-256 of the uncompressed NDJSON. */
  sha256: string;
}

export type ArchiveResult =
  | {
      status: 'dropped';
      stream: string;
      month: string;
      rows: number;
      orgs: number;
      bytes: number;
      /** False when an earlier run had already exported and verified this month and only the drop was left. */
      exported: boolean;
    }
  | { status: 'absent'; stream: string; month: string }
  | { status: 'failed'; stream: string; month: string; reason: string };

/** A month that failed this many nights in a row is not retried until `PAUSE_MS` after its last failure. */
const PAUSE_AFTER_FAILURES = 3;
const PAUSE_MS = 7 * 86_400_000;

/** `archive/<stream>/<yyyy-mm>/_failures.json`: how many nights in a row the month failed, and why. Removed when the month is dropped. */
interface FailureMarker {
  count: number;
  lastAt: string;
  reason: string;
}

const IDENT = /^[a-z][a-z0-9_]*$/;
const DEFAULT_BATCH_ROWS = 20_000;
const FIRST_ID = '-9223372036854775808';

interface BatchRow {
  id: string;
  org: string;
  j: string;
}

/**
 * Moves a closed monthly partition out of Postgres: exports it to the archive store, proves the copy is complete, and only then drops it
 * (docs/superpowers/specs/2026-10-16-event-based-analytics-design.md, section 6).
 *
 *  1. Rows are read once in id order, in batches, and appended (one gzip member per batch) to one temp file per workspace, so memory
 *     stays at one batch however large the month is. Columns named in `omitColumns` are never read.
 *  2. Each file is uploaded as `archive/<stream>/<yyyy-mm>/<org>.ndjson.gz`, then `_manifest.json` (rows, bytes, sha256 per workspace).
 *  3. Every object is read back from the store: its decompressed line count and hash must equal the manifest's.
 *  4. In one transaction the partition is locked against writes, its rows are counted per workspace again and compared with the manifest,
 *     and `drop_closed_partition` detaches and drops it. If anything changed since the export nothing is dropped; the next run starts over.
 *
 * Every step is safe to repeat: a run that died after step 3 finds a valid manifest with matching counts and only does step 4.
 */
@Injectable()
export class PartitionArchiver {
  private readonly logger = new Logger(PartitionArchiver.name);
  private readonly batchRows: number;

  constructor(
    @Inject(DatabaseService) private readonly db: Privileged,
    @Inject(ARCHIVE_STORAGE) private readonly storage: ArchiveStorage,
    @Optional() @Inject(ARCHIVER_OPTIONS) options?: ArchiverOptions,
  ) {
    this.batchRows = options?.batchRows ?? DEFAULT_BATCH_ROWS;
  }

  /** Months that currently have a partition, oldest first. */
  async existingMonths(policy: StreamPolicy): Promise<string[]> {
    assertPolicy(policy);
    const rows = await this.db.privileged(
      async (tx) =>
        (
          await tx.execute(sql`
            SELECT c.relname AS name
              FROM pg_inherits i
              JOIN pg_class c ON c.oid = i.inhrelid AND c.relnamespace = 'public'::regnamespace
              JOIN pg_class p ON p.oid = i.inhparent AND p.relnamespace = 'public'::regnamespace
             WHERE p.relname = ${policy.stream}`)
        ).rows as Array<{ name: string }>,
    );
    return rows
      .map((r) => monthOfPartition(policy.stream, r.name))
      .filter((m): m is string => m !== null)
      .sort();
  }

  /** Archives and drops every existing partition that is past the stream's live window. Months without a partition are skipped. */
  async archiveEligible(policy: StreamPolicy, opts: { now?: Date } = {}): Promise<ArchiveResult[]> {
    const now = opts.now ?? new Date();
    const results: ArchiveResult[] = [];
    for (const month of await this.existingMonths(policy)) {
      if (!isPastLiveWindow(month, now, policy.liveDays)) continue;
      const result = await this.archiveMonth(policy, month, { now });
      if (result.status !== 'absent') results.push(result);
    }
    return results;
  }

  /** Size of a month's partition from the catalog (no scan), for a dry run. Null when there is no such partition. */
  async inspect(
    policy: StreamPolicy,
    month: string,
  ): Promise<{ part: string; estimatedRows: number | null; bytes: number } | null> {
    assertPolicy(policy);
    const part = partitionName(policy.stream, month);
    const rows = await this.db.privileged(
      async (tx) =>
        (
          await tx.execute(sql`
            SELECT c.reltuples::bigint::text AS rows, pg_total_relation_size(c.oid)::text AS bytes
              FROM pg_inherits i
              JOIN pg_class c ON c.oid = i.inhrelid AND c.relnamespace = 'public'::regnamespace
              JOIN pg_class p ON p.oid = i.inhparent AND p.relnamespace = 'public'::regnamespace
             WHERE p.relname = ${policy.stream} AND c.relname = ${part}`)
        ).rows as Array<{ rows: string; bytes: string }>,
    );
    const row = rows[0];
    if (!row) return null;
    // reltuples is -1 until the table has been analysed.
    return {
      part,
      estimatedRows: Number(row.rows) < 0 ? null : Number(row.rows),
      bytes: Number(row.bytes),
    };
  }

  /**
   * Archives one closed month and drops its partition. A partition that disappears while this runs (a second worker finished first)
   * is reported as `absent`, not as an error. A month that fails `PAUSE_AFTER_FAILURES` nights in a row (a failed check, changing
   * rows, an error) is left alone for a week instead of being counted, exported and uploaded again every night.
   */
  async archiveMonth(
    policy: StreamPolicy,
    month: string,
    opts: { now?: Date } = {},
  ): Promise<ArchiveResult> {
    assertPolicy(policy);
    const { stream } = policy;
    const now = opts.now ?? new Date();
    if (!isPastLiveWindow(month, now, policy.liveDays)) {
      throw new Error(`${stream} ${month} is inside its live window of ${policy.liveDays} days`);
    }
    const part = partitionName(stream, month);

    const failures = await this.readFailures(stream, month);
    const pausedUntil =
      failures && failures.count >= PAUSE_AFTER_FAILURES
        ? new Date(Date.parse(failures.lastAt) + PAUSE_MS)
        : null;
    if (
      failures &&
      pausedUntil &&
      pausedUntil > now &&
      (await this.partitionColumns(stream, part))
    ) {
      const reason = `paused after ${failures.count} failed attempts (last: ${failures.reason}); next attempt after ${pausedUntil.toISOString()}`;
      return { status: 'failed', stream, month, reason };
    }

    try {
      const result = await this.archive(policy, month, part);
      if (result.status === 'failed') {
        await this.noteFailure(stream, month, failures, now, result.reason);
      } else {
        await this.clearFailures(stream, month);
      }
      return result;
    } catch (err) {
      // "relation does not exist" only means someone else finished if the partition really is gone; any other missing table is a bug.
      if (isUndefinedTable(err) && (await this.partitionColumns(stream, part)) === null) {
        return { status: 'absent', stream, month };
      }
      await this.noteFailure(
        stream,
        month,
        failures,
        now,
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  }

  /** Best effort: the back-off is an optimisation, so a store that cannot be read or written must not stop the month being tried. */
  private async readFailures(stream: string, month: string): Promise<FailureMarker | null> {
    try {
      const bytes = await readBytes(this.storage, failureKeyOf(stream, month));
      if (!bytes) return null;
      const parsed = JSON.parse(bytes.toString('utf8')) as Partial<FailureMarker>;
      return typeof parsed.count === 'number' && typeof parsed.lastAt === 'string'
        ? { count: parsed.count, lastAt: parsed.lastAt, reason: String(parsed.reason ?? '') }
        : null;
    } catch {
      return null;
    }
  }

  private async noteFailure(
    stream: string,
    month: string,
    previous: FailureMarker | null,
    now: Date,
    reason: string,
  ): Promise<void> {
    const marker: FailureMarker = {
      count: (previous?.count ?? 0) + 1,
      lastAt: now.toISOString(),
      reason: reason.slice(0, 300),
    };
    if (marker.count >= PAUSE_AFTER_FAILURES) {
      this.logger.error(
        { stream, month, failures: marker.count, reason: marker.reason },
        'retention paused for this month after repeated failures; it needs a look',
      );
    }
    try {
      await this.storage.putBytes(failureKeyOf(stream, month), Buffer.from(JSON.stringify(marker)));
    } catch (err) {
      this.logger.warn({ err, stream, month }, 'could not record the failed attempt');
    }
  }

  private async clearFailures(stream: string, month: string): Promise<void> {
    try {
      await this.storage.delete(failureKeyOf(stream, month));
    } catch {
      // A leftover marker only delays a retry of a month that has already gone.
    }
  }

  private async archive(policy: StreamPolicy, month: string, part: string): Promise<ArchiveResult> {
    const stream = policy.stream;
    const columns = await this.partitionColumns(stream, part);
    if (columns === null) return { status: 'absent', stream, month };

    const counts = await this.countByOrg(policy, part);
    let manifest = await this.readManifest(stream, month);
    let exported = false;
    if (!(manifest && sameCounts(manifest, counts) && (await this.verify(manifest)).ok)) {
      manifest = await this.exportMonth(policy, month, part, columns);
      exported = true;
      const check = await this.verify(manifest);
      if (!check.ok) {
        this.logger.error({ stream, month, reason: check.reason }, 'archive verification failed');
        return { status: 'failed', stream, month, reason: check.reason };
      }
    }

    const outcome = await this.dropIfUnchanged(policy, month, part, manifest);
    if (outcome === 'changed') {
      const reason = 'rows changed after the export; the month will be exported again';
      this.logger.warn({ stream, month }, reason);
      return { status: 'failed', stream, month, reason };
    }
    if (outcome === 'gone') return { status: 'absent', stream, month };

    const entries = Object.values(manifest.orgs);
    const bytes = entries.reduce((sum, e) => sum + e.bytes, 0);
    this.logger.log(
      { stream, month, rows: manifest.totalRows, orgs: entries.length, bytes, exported },
      'partition archived and dropped',
    );
    return {
      status: 'dropped',
      stream,
      month,
      rows: manifest.totalRows,
      orgs: entries.length,
      bytes,
      exported,
    };
  }

  /** Column names of the partition in table order, or null when `stream` has no such partition. */
  private async partitionColumns(stream: string, part: string): Promise<string[] | null> {
    const rows = await this.db.privileged(
      async (tx) =>
        (
          await tx.execute(sql`
            SELECT a.attname AS name
              FROM pg_inherits i
              JOIN pg_class c ON c.oid = i.inhrelid AND c.relnamespace = 'public'::regnamespace
              JOIN pg_class p ON p.oid = i.inhparent AND p.relnamespace = 'public'::regnamespace
              JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
             WHERE p.relname = ${stream} AND c.relname = ${part}
             ORDER BY a.attnum`)
        ).rows as Array<{ name: string }>,
    );
    return rows.length === 0 ? null : rows.map((r) => r.name);
  }

  private async countByOrg(policy: StreamPolicy, part: string): Promise<Map<string, number>> {
    return this.db.privileged((tx) => this.countInTx(tx, policy, part));
  }

  private async countInTx(
    tx: Tx,
    policy: StreamPolicy,
    part: string,
  ): Promise<Map<string, number>> {
    const org = sql.identifier(policy.orgColumn);
    const rows = (
      await tx.execute(
        sql`SELECT ${org}::text AS org, count(*)::text AS rows FROM public.${sql.identifier(part)} GROUP BY 1`,
      )
    ).rows as Array<{ org: string; rows: string }>;
    return new Map(rows.map((r) => [assertOrg(r.org), Number(r.rows)]));
  }

  private async readManifest(stream: string, month: string): Promise<ArchiveManifest | null> {
    // A manifest has one entry per workspace (about 200 bytes each); 128 MiB leaves room for hundreds of thousands.
    const bytes = await readBytes(this.storage, manifestKeyOf(stream, month), 128 * 1024 * 1024);
    if (!bytes) return null;
    try {
      const parsed = JSON.parse(bytes.toString('utf8')) as Partial<ArchiveManifest>;
      if (
        parsed.version === 1 &&
        parsed.stream === stream &&
        parsed.month === month &&
        typeof parsed.totalRows === 'number' &&
        typeof parsed.orgs === 'object' &&
        parsed.orgs !== null
      ) {
        return parsed as ArchiveManifest;
      }
    } catch {
      // A damaged manifest is treated like a missing one: the month is exported again.
    }
    return null;
  }

  private async exportMonth(
    policy: StreamPolicy,
    month: string,
    part: string,
    columns: string[],
  ): Promise<ArchiveManifest> {
    const { stream } = policy;
    const work = await mkdtemp(join(tmpdir(), 'archive-export-'));
    try {
      const exportColumns = columns.filter((c) => !policy.omitColumns.includes(c));
      for (const needed of [policy.idColumn, policy.orgColumn, policy.partitionKey]) {
        if (!exportColumns.includes(needed)) {
          throw new Error(`${part} has no column "${needed}" (policy for ${stream})`);
        }
      }
      const select = sql.join(
        exportColumns.map((c) => sql.identifier(c)),
        sql`, `,
      );
      const id = sql.identifier(policy.idColumn);
      const orgCol = sql.identifier(policy.orgColumn);

      const files = new Map<string, { path: string; rows: number; hash: Hash }>();
      let last = FIRST_ID;
      for (;;) {
        const batch = await this.db.privileged(
          async (tx) =>
            (
              await tx.execute(sql`
                SELECT r.${id}::text AS id, r.${orgCol}::text AS org, to_json(r)::text AS j
                  FROM (SELECT ${select} FROM public.${sql.identifier(part)}
                         WHERE ${id} > ${last}::bigint ORDER BY ${id} LIMIT ${this.batchRows}) r
                 ORDER BY r.${id}`)
            ).rows as unknown as BatchRow[],
        );
        if (batch.length === 0) break;
        const byOrg = new Map<string, string[]>();
        for (const row of batch) {
          const org = assertOrg(row.org);
          const lines = byOrg.get(org);
          if (lines) lines.push(row.j);
          else byOrg.set(org, [row.j]);
        }
        for (const [org, lines] of byOrg) {
          let file = files.get(org);
          if (!file) {
            file = { path: join(work, `${org}.ndjson.gz`), rows: 0, hash: createHash('sha256') };
            files.set(org, file);
          }
          const chunk = Buffer.from(`${lines.join('\n')}\n`, 'utf8');
          file.hash.update(chunk);
          file.rows += lines.length;
          // One gzip member per batch; concatenated members are one valid gzip stream.
          await appendFile(file.path, await gzipAsync(chunk));
        }
        last = batch[batch.length - 1]!.id;
        if (batch.length < this.batchRows) break;
      }

      const orgs: Record<string, ArchiveOrgEntry> = {};
      let totalRows = 0;
      for (const [org, file] of [...files].sort(([a], [b]) => Number(a) - Number(b))) {
        const key = objectKeyOf(stream, month, org);
        await this.storage.putFile(key, file.path);
        orgs[org] = {
          key,
          rows: file.rows,
          bytes: (await stat(file.path)).size,
          sha256: file.hash.digest('hex'),
        };
        totalRows += file.rows;
      }
      const manifest: ArchiveManifest = {
        version: 1,
        stream,
        month,
        partitionKey: policy.partitionKey,
        columns: exportColumns,
        omitted: [...policy.omitColumns],
        createdAt: new Date().toISOString(),
        totalRows,
        orgs,
      };
      await this.storage.putBytes(
        manifestKeyOf(stream, month),
        Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
      );

      // A workspace that had rows in an earlier export and has none now must not keep a stale object.
      const named = new Set(Object.values(orgs).map((e) => e.key));
      for (const object of await this.storage.list(prefixOf(stream, month))) {
        if (object.key.endsWith('.ndjson.gz') && !named.has(object.key)) {
          await this.storage.delete(object.key);
        }
      }
      return manifest;
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  /**
   * Reads every object back and compares it with the manifest. A damaged or missing object is a failed check, not an error; an
   * unreachable store is an error (the exception propagates and nothing is dropped).
   */
  private async verify(
    manifest: ArchiveManifest,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const sizes = new Map(
      (await this.storage.list(prefixOf(manifest.stream, manifest.month))).map((o) => [
        o.key,
        o.bytes,
      ]),
    );
    for (const [org, entry] of Object.entries(manifest.orgs)) {
      const size = sizes.get(entry.key);
      if (size === undefined)
        return { ok: false, reason: `object for workspace ${org} is missing` };
      if (size !== entry.bytes) {
        return {
          ok: false,
          reason: `object for workspace ${org} has ${size} bytes, expected ${entry.bytes}`,
        };
      }
      const source = await this.storage.openRead(entry.key);
      if (!source) return { ok: false, reason: `object for workspace ${org} is missing` };
      const hash = createHash('sha256');
      let rows = 0;
      try {
        await pipeline(
          source,
          createGunzip(),
          new Writable({
            write(chunk: Buffer, _enc, done) {
              hash.update(chunk);
              for (let at = chunk.indexOf(10); at !== -1; at = chunk.indexOf(10, at + 1)) rows += 1;
              done();
            },
          }),
        );
      } catch (err) {
        return {
          ok: false,
          reason: `object for workspace ${org} is unreadable: ${(err as Error).message}`,
        };
      }
      if (rows !== entry.rows) {
        return {
          ok: false,
          reason: `object for workspace ${org} has ${rows} rows, expected ${entry.rows}`,
        };
      }
      if (hash.digest('hex') !== entry.sha256) {
        return { ok: false, reason: `object for workspace ${org} does not match its checksum` };
      }
    }
    return { ok: true };
  }

  /**
   * Locks the partition against writers, counts it again, and drops it only if it still holds exactly what the manifest says.
   * Returns `gone` when the partition vanished meanwhile (another worker finished first).
   */
  private async dropIfUnchanged(
    policy: StreamPolicy,
    month: string,
    part: string,
    manifest: ArchiveManifest,
  ): Promise<'dropped' | 'changed' | 'gone'> {
    return this.db.privileged(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(sql`LOCK TABLE public.${sql.identifier(part)} IN SHARE MODE`);
      if (!sameCounts(manifest, await this.countInTx(tx, policy, part))) return 'changed';
      const res = await tx.execute(
        sql`SELECT drop_closed_partition(${policy.stream}::regclass, ${`${month}-01`}::date) AS dropped`,
      );
      return (res.rows[0] as { dropped: boolean }).dropped ? 'dropped' : 'gone';
    });
  }
}

/** Postgres error 42P01. The driver may wrap it, so look one level down too. */
function isUndefinedTable(err: unknown): boolean {
  const code = (e: unknown) => (e as { code?: string } | null)?.code;
  return code(err) === '42P01' || code((err as { cause?: unknown } | null)?.cause) === '42P01';
}

function sameCounts(manifest: ArchiveManifest, counts: Map<string, number>): boolean {
  const orgs = Object.entries(manifest.orgs);
  if (orgs.length !== counts.size) return false;
  return orgs.every(([org, entry]) => counts.get(org) === entry.rows);
}

/** Workspace ids become object names and manifest keys, so they must be plain non-negative integers. */
function assertOrg(value: string): string {
  if (!/^\d{1,18}$/.test(value))
    throw new Error(`unexpected workspace id ${JSON.stringify(value)}`);
  return value;
}

function assertPolicy(policy: StreamPolicy): void {
  for (const id of [
    policy.stream,
    policy.partitionKey,
    policy.idColumn,
    policy.orgColumn,
    ...policy.omitColumns,
  ]) {
    if (!IDENT.test(id))
      throw new Error(
        `retention policy for ${policy.stream}: bad identifier ${JSON.stringify(id)}`,
      );
  }
  for (const needed of [policy.idColumn, policy.orgColumn, policy.partitionKey]) {
    if (policy.omitColumns.includes(needed)) {
      throw new Error(`retention policy for ${policy.stream}: cannot omit "${needed}"`);
    }
  }
}
