import { sql } from 'drizzle-orm';
import type { PrivacyDisposition, PrivacyErasureLine, PrivacyHistoryMode } from '@crm/contracts';
import { SECRET_COLUMN, rowsOf, setClause } from './sql';
import type {
  EraseOutcome,
  ExportSection,
  ExportedTable,
  HolderManifest,
  PersonalDataHolder,
  PrivacyCtx,
  ResolvedSubject,
  TableSpec,
} from './types';

const DEFAULT_EXPORT_CAP = 50_000;
const DEFAULT_ORDER = 50;
/** Rows the database removes or unlinks, and rows kept as they are, are only counted: that must happen BEFORE anything is changed. */
const COUNT_ONLY_ORDER = 5;

/** Execution order of a table: counting-only tables first, then the declared order (default 50), the contact row (900) last. */
export function orderOf(spec: TableSpec): number {
  if (spec.order !== undefined) return spec.order;
  return spec.disposition === 'cascade' ||
    spec.disposition === 'fk_null' ||
    spec.disposition === 'retain'
    ? COUNT_ONLY_ORDER
    : DEFAULT_ORDER;
}

/**
 * Turns a declaration into a holder with its two handlers. The handlers are generic on purpose: what a table holds and how it is
 * handled is data (reviewable in one place, checked against the schema by the registry test), not hand-written SQL per module.
 */
export function defineHolder(manifest: HolderManifest): PersonalDataHolder {
  const ordered = [...manifest.tables].sort((a, b) => orderOf(a) - orderOf(b));
  return {
    ...manifest,
    tables: ordered,
    export: (ctx, subject) => exportHolder(manifest.key, ordered, ctx, subject),
    erase: (ctx, subject, mode) => eraseHolder(manifest.key, ordered, ctx, subject, mode),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// export

/** Internal ids never leave the system (CONTRIBUTING rule 4): the person gets values, and uuids where the row has one. */
function cleanRow(spec: TableSpec, row: Record<string, unknown>): Record<string, unknown> {
  const omit = new Set(spec.exportOmit ?? []);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'org_id' || k === 'id' || omit.has(k) || SECRET_COLUMN.test(k)) continue;
    if (k.endsWith('_id') && typeof v === 'number') continue;
    out[k] = v;
  }
  return out;
}

async function exportHolder(
  key: string,
  specs: readonly TableSpec[],
  ctx: PrivacyCtx,
  subject: ResolvedSubject,
): Promise<ExportSection> {
  const tables: ExportedTable[] = [];
  for (const spec of specs) {
    const cap = spec.exportCap ?? DEFAULT_EXPORT_CAP;
    const res = await ctx.tx.execute(sql`
      SELECT to_jsonb(t) AS j FROM ${sql.identifier(spec.table)} t
       WHERE ${rowsOf(spec, subject, 'export')} ORDER BY t.ctid LIMIT ${cap + 1}`);
    const raw = (res.rows as Array<{ j: Record<string, unknown> }>).map((r) => r.j);
    tables.push({
      table: spec.table,
      rows: raw.slice(0, cap).map((r) => cleanRow(spec, r)),
      count: Math.min(raw.length, cap),
      truncated: raw.length > cap,
    });
  }
  return { holder: key, tables };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// erase

const countOf = async (
  ctx: PrivacyCtx,
  spec: TableSpec,
  subject: ResolvedSubject,
): Promise<number> => {
  const res = await ctx.tx.execute(
    sql`SELECT count(*)::int AS n FROM ${sql.identifier(spec.table)} WHERE ${rowsOf(spec, subject)}`,
  );
  return Number((res.rows[0] as { n: number }).n);
};

/** Queues the object-storage keys of the rows about to go. Returns how many distinct keys there are. */
async function collectFiles(
  ctx: PrivacyCtx,
  spec: TableSpec,
  subject: ResolvedSubject,
): Promise<number> {
  let found = 0;
  for (const s of spec.storage ?? []) {
    const col = sql.identifier(s.column);
    if (ctx.dryRun) {
      const res = await ctx.tx.execute(sql`
        SELECT count(DISTINCT ${col})::int AS n FROM ${sql.identifier(spec.table)}
         WHERE ${rowsOf(spec, subject)} AND ${col} IS NOT NULL AND btrim(${col}::text) <> ''`);
      found += Number((res.rows[0] as { n: number }).n);
    } else {
      const res = await ctx.tx.execute(sql`
        WITH q AS (
          INSERT INTO privacy_erasure_files (org_id, request_id, storage_key)
          SELECT DISTINCT ${ctx.orgId}::bigint, ${ctx.requestId}::bigint, ${col}::text FROM ${sql.identifier(spec.table)}
           WHERE ${rowsOf(spec, subject)} AND ${col} IS NOT NULL AND btrim(${col}::text) <> ''
          RETURNING 1)
        SELECT count(*)::int AS n FROM q`);
      found += Number((res.rows[0] as { n: number }).n);
    }
  }
  return found;
}

async function deleteRows(
  ctx: PrivacyCtx,
  spec: TableSpec,
  subject: ResolvedSubject,
): Promise<number> {
  const res = await ctx.tx.execute(sql`
    WITH d AS (DELETE FROM ${sql.identifier(spec.table)} WHERE ${rowsOf(spec, subject)} RETURNING 1)
    SELECT count(*)::int AS n FROM d`);
  return Number((res.rows[0] as { n: number }).n);
}

async function updateRows(
  ctx: PrivacyCtx,
  spec: TableSpec,
  subject: ResolvedSubject,
  set: Readonly<Record<string, import('./types').Replacement>>,
): Promise<number> {
  // audit_log is append-only except for this erasure's redaction (migration 20261217090000): the setting is on for this one
  // statement and the transaction, and the database accepts only a NULL `delta` on contacts rows.
  const redacting = spec.table === 'audit_log';
  if (redacting) await ctx.tx.execute(sql`SELECT set_config('app.audit_redact', 'on', true)`);
  const res = await ctx.tx.execute(sql`
    WITH u AS (UPDATE ${sql.identifier(spec.table)} SET ${setClause(set)} WHERE ${rowsOf(spec, subject)} RETURNING 1)
    SELECT count(*)::int AS n FROM u`);
  if (redacting) await ctx.tx.execute(sql`SELECT set_config('app.audit_redact', 'off', true)`);
  return Number((res.rows[0] as { n: number }).n);
}

const line = (
  holder: string,
  table: string,
  disposition: PrivacyDisposition,
  count: number,
  reason: string | null,
): PrivacyErasureLine => ({ holder, table, disposition, count, reason });

/** One table of one holder. The pipeline calls this directly so that tables of different holders run in one global order. */
export async function eraseSpec(
  key: string,
  spec: TableSpec,
  ctx: PrivacyCtx,
  subject: ResolvedSubject,
  mode: PrivacyHistoryMode,
): Promise<{ line: PrivacyErasureLine; files: number } | null> {
  if (!ctx.tiers.includes(spec.tier)) return null;
  const files = await collectFiles(ctx, spec, subject);

  switch (spec.disposition) {
    case 'delete': {
      const keep = mode === 'anonymise' ? spec.whenAnonymising : undefined;
      if (keep === 'keep') {
        return {
          files,
          line: line(
            key,
            spec.table,
            'retained',
            await countOf(ctx, spec, subject),
            'Kept: holds no personal value once its conversation is anonymised.',
          ),
        };
      }
      if (keep) {
        const n = ctx.dryRun
          ? await countOf(ctx, spec, subject)
          : await updateRows(ctx, spec, subject, keep);
        return {
          files,
          line: line(
            key,
            spec.table,
            'anonymised',
            n,
            "History kept without the person's identity (chosen for this request).",
          ),
        };
      }
      const n = ctx.dryRun
        ? await countOf(ctx, spec, subject)
        : await deleteRows(ctx, spec, subject);
      return { files, line: line(key, spec.table, 'deleted', n, null) };
    }
    case 'anonymise': {
      const n = ctx.dryRun
        ? await countOf(ctx, spec, subject)
        : await updateRows(ctx, spec, subject, spec.set);
      return {
        files,
        line: line(key, spec.table, 'anonymised', n, spec.legalHold?.reason ?? null),
      };
    }
    case 'cascade': {
      // Removed by the database with its parent (the foreign key is checked by the registry test); counted now, while it is there.
      const n = await countOf(ctx, spec, subject);
      if (mode === 'anonymise' && spec.parentKeptWhenAnonymising) {
        return {
          files,
          line: line(
            key,
            spec.table,
            'retained',
            n,
            'Link rows without personal values; they stay with the kept conversation.',
          ),
        };
      }
      return { files, line: line(key, spec.table, 'cascaded', n, null) };
    }
    case 'fk_null':
      return {
        files,
        line: line(key, spec.table, 'unlinked', await countOf(ctx, spec, subject), spec.reason),
      };
    case 'retain':
      return {
        files,
        line: line(key, spec.table, 'retained', await countOf(ctx, spec, subject), spec.reason),
      };
  }
}

async function eraseHolder(
  key: string,
  specs: readonly TableSpec[],
  ctx: PrivacyCtx,
  subject: ResolvedSubject,
  mode: PrivacyHistoryMode,
): Promise<EraseOutcome> {
  const lines: PrivacyErasureLine[] = [];
  let files = 0;
  for (const spec of specs) {
    const done = await eraseSpec(key, spec, ctx, subject, mode);
    if (!done) continue;
    lines.push(done.line);
    files += done.files;
  }
  return { holder: key, lines, files };
}
