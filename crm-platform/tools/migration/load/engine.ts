import { readManifest } from '../extract/manifest';
import type { Source } from '../extract/source';
import type { SourceIndex } from '../transform/source-index';
import { transformDoc } from '../transform';
import type { AccessCtx } from '../transform/access-plan';
import type { InboxSettings } from '../inbox/config';
import type { ChatPlan } from '../inbox/plan';
import type { BroadcastSettings } from '../broadcast/config';
import type { BroadcastPlan } from '../broadcast/plan';
import type { CreditSettings } from '../credits/config';
import type { CreditsPlan } from '../credits/plan';
import type { FlowSettings } from '../flows/config';
import type { FlowPlan } from '../flows/plan';
import type {
  AdoptOutcome,
  Ctx,
  HandlerSpec,
  Row,
  Soft,
  TableSpec,
  TargetRef,
} from '../transform/types';
import {
  docKeys,
  docKeysWith,
  plain,
  primaryKey,
  sanitizeError,
  scrub,
  sha256,
  stripNul,
  uuidv5,
  type Doc,
} from '../util';
import { q, sql, withTenant, type Database, type TenantTx } from './db';

/** source (client, collection, key) -> target row, kept in memory for the run and written to migration.id_map in the batch's transaction. */
export class IdMap {
  private readonly m = new Map<string, TargetRef>();
  private static k = (collection: string, key: unknown): string =>
    `${collection}\u0000${String(key)}`;

  async load(db: Database, client: string): Promise<void> {
    this.m.clear();
    const r = await db.execute(sql`
      SELECT source_collection, source_key, target_table, target_id, target_uuid::text AS target_uuid
      FROM migration.id_map WHERE source_client = ${client}`);
    for (const row of r.rows as Array<{
      source_collection: string;
      source_key: string;
      target_table: string;
      target_id: number;
      target_uuid: string;
    }>) {
      this.m.set(IdMap.k(row.source_collection, row.source_key), {
        table: row.target_table,
        id: Number(row.target_id),
        uuid: row.target_uuid,
      });
    }
  }
  get(collection: string, key: unknown): TargetRef | undefined {
    return key === null || key === undefined || key === ''
      ? undefined
      : this.m.get(IdMap.k(collection, key));
  }
  put(collection: string, key: string, ref: TargetRef): void {
    this.m.set(IdMap.k(collection, key), ref);
  }
  /** Every source key registered for a collection (primary keys and aliases): update mode looks for documents that vanished. */
  keys(collection: string): string[] {
    const p = `${collection}\u0000`;
    return [...this.m.keys()].filter((k) => k.startsWith(p)).map((k) => k.slice(p.length));
  }
}

export interface Counts {
  read: number;
  migrated: number;
  quarantined: number;
  excluded: number;
  already: number;
  inserted: number;
  softIssues: number;
}
export const zeroCounts = (): Counts => ({
  read: 0,
  migrated: 0,
  quarantined: 0,
  excluded: 0,
  already: 0,
  inserted: 0,
  softIssues: 0,
});

export interface Env {
  source: Source;
  client: string;
  dumpsDir: string;
  db: Database;
  orgId: number;
  idmap: IdMap;
  idx: SourceIndex;
  batchSize: number;
  defaultCountryCode: string | null;
  /** The dump manifest's generatedAt: the stand-in timestamp for a document with no usable date. */
  fallbackAt: string;
  /** Roles and users steps: reviewed maps, permission catalogue, preset roles, cross-document plans (see load/access.ts). */
  access?: AccessCtx;
  /** Inbox step: the plan of pass 1 (set by the step's own prepare hook once contacts, users and channels exist). */
  chat?: ChatPlan;
  /** Inbox step: the channel map and flags (resolved before anything is written). */
  inbox?: InboxSettings;
  /** Broadcast steps: the switches of the run (validated before anything is written) and the plan of pass 1 (set by the step's prepare hook). */
  bcastSettings?: BroadcastSettings;
  bcast?: BroadcastPlan;
  /** Credits steps: the operator's switches and the plan of pass 1 (built before anything is written, from the dump alone). */
  creditSettings?: CreditSettings;
  credits?: CreditsPlan;
  /** Flow and widget steps: the switches of the run and the plan of pass 1 (set by the step's prepare hook). */
  flowSettings?: FlowSettings;
  flows?: FlowPlan;
  /** The owner login (or the same transaction in a dry run): used for the one write the worker may not make (organizations). */
  ownerDb?: Database;
  ownerEmail?: string | null;
  /** Cache of primary keys per source collection (see primaryKeySet). */
  pkCache?: Map<string, Set<string>>;
  /** Ignore checkpoints and re-read everything (still idempotent). */
  force: boolean;
  runId: string;
  /** Test hook: called after each committed batch; throw to simulate a crash. */
  afterBatch?: (info: { step: string; batch: number }) => void | Promise<void>;
  /** Test hook: called inside the batch's transaction before it commits; throw to simulate a crash that rolls the batch back. */
  midBatch?: (info: { step: string; batch: number }) => void | Promise<void>;
  log: (line: string) => void;
}

export const ctxOf = (
  env: Pick<
    Env,
    | 'client'
    | 'orgId'
    | 'idmap'
    | 'idx'
    | 'defaultCountryCode'
    | 'fallbackAt'
    | 'access'
    | 'chat'
    | 'bcast'
    | 'credits'
    | 'flows'
  >,
): Ctx => ({
  client: env.client,
  orgId: env.orgId,
  defaultCountryCode: env.defaultCountryCode,
  fallbackAt: env.fallbackAt,
  idx: env.idx,
  access: env.access,
  chat: env.chat,
  bcast: env.bcast,
  credits: env.credits,
  flows: env.flows,
  ref: (collection, key) => env.idmap.get(collection, key),
});

export const rowUuid = (client: string, mapCollection: string, key: string, sub: string): string =>
  uuidv5(`${client}|${mapCollection}|${key}${sub}`);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT_RE = /^-?\d+$/;
const NUM_RE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const TS_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)?$/;

/**
 * Why a value cannot go into a column of this Postgres type, or null when it can. Postgres only says "invalid input syntax"
 * (SQLSTATE 22P02) without naming the column, so every value is judged BEFORE the insert and a bad one is named by table and column
 * (never by value: a value can be personal data).
 */
export function badCell(pg: string, v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = pg.toLowerCase();
  if (t === 'uuid') return typeof v === 'string' && UUID_RE.test(v) ? null : 'not a uuid';
  if (t === 'bigint' || t === 'integer' || t === 'smallint') {
    const ok =
      typeof v === 'number' ? Number.isInteger(v) : typeof v === 'string' && INT_RE.test(v);
    if (!ok) return `not a whole number (${typeof v})`;
    if (t === 'integer' && Math.abs(Number(v)) > 2_147_483_647) return 'outside the integer range';
    if (t === 'smallint' && Math.abs(Number(v)) > 32_767) return 'outside the smallint range';
    return null;
  }
  if (t.startsWith('numeric') || t === 'double precision' || t === 'real')
    return (typeof v === 'number' && Number.isFinite(v)) ||
      (typeof v === 'string' && NUM_RE.test(v.trim()))
      ? null
      : `not a number (${typeof v})`;
  if (t === 'boolean') return typeof v === 'boolean' ? null : `not a boolean (${typeof v})`;
  if (t === 'timestamptz' || t === 'timestamp') {
    if (typeof v !== 'string' || !TS_RE.test(v)) return `not an ISO timestamp (${typeof v})`;
    const y = Number(v.slice(0, 4));
    return Number.isNaN(Date.parse(v.replace(' ', 'T'))) || y < 1 || y > 9999
      ? 'not a valid date'
      : null;
  }
  if (t === 'date')
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : 'not a date';
  if (t === 'text' || t.startsWith('varchar') || t.startsWith('character')) {
    if (typeof v === 'string' && LONE.test(v)) return 'holds half of an emoji (a lone surrogate)';
    return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
      ? null
      : `not text (${typeof v})`;
  }
  if (t === 'jsonb' || t === 'json')
    return hasLone(v, 0) ? 'holds half of an emoji (a lone surrogate)' : null;
  return null; // arrays, time ...: left to the database
}

/** A string with half of a surrogate pair: not valid in a JSON document Postgres parses (22P02). */
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
function hasLone(v: unknown, depth: number): boolean {
  if (typeof v === 'string') return LONE.test(v);
  if (depth > 12 || v === null || typeof v !== 'object') return false;
  for (const x of Array.isArray(v) ? v : Object.values(v as Record<string, unknown>))
    if (hasLone(x, depth + 1)) return true;
  return false;
}

function assertCells(table: string, spec: TableSpec, rows: Array<Row & { uuid?: string }>): void {
  for (const r of rows)
    for (const c of spec.columns) {
      const why = badCell(c.pg, r[c.name]);
      if (why)
        throw new Error(
          `ROW_VALUE_REJECTED: ${table}.${c.name} (${c.pg}) ${why}; row ${r.uuid ?? r.id ?? '?'}. Nothing was written for this batch`,
        );
    }
}

/** One INSERT per table per batch. Returns the uuids that were actually inserted (conflicts are skipped, never overwritten). */
export async function insertRows(
  tx: TenantTx,
  orgId: number,
  table: string,
  spec: TableSpec,
  items: Array<{ uuid: string; row: Row }>,
): Promise<Set<string>> {
  if (items.length === 0) return new Set();
  const names = spec.columns.map((c) => c.name);
  const cols = sql.raw(['org_id', 'uuid', ...names].map(q).join(', '));
  const sel = sql.raw(['uuid', ...names].map((n) => `x.${q(n)}`).join(', '));
  const defs = sql.raw(
    ['uuid uuid', ...spec.columns.map((c) => `${q(c.name)} ${c.pg}`)].join(', '),
  );
  assertCells(
    table,
    spec,
    items.map((i) => ({ uuid: i.uuid, ...i.row })),
  );
  const json = JSON.stringify(items.map((i) => ({ uuid: i.uuid, ...i.row })));
  const res = await tx.execute(sql`
    INSERT INTO ${sql.raw(q(table))} (${cols})
    SELECT ${orgId}::bigint, ${sel} FROM jsonb_to_recordset(${json}::jsonb) AS x(${defs})
    ON CONFLICT DO NOTHING
    RETURNING uuid::text AS uuid`);
  return new Set((res.rows as Array<{ uuid: string }>).map((r) => r.uuid));
}

/** Rows of a table with no uuid (role_grants, user_roles ...): a conflict on the primary key is skipped, never overwritten. */
export async function insertKeyless(
  tx: TenantTx,
  orgId: number,
  table: string,
  spec: TableSpec,
  rows: Row[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const names = spec.columns.map((c) => c.name);
  const cols = sql.raw(['org_id', ...names].map(q).join(', '));
  const sel = sql.raw(names.map((n) => `x.${q(n)}`).join(', '));
  const defs = sql.raw(spec.columns.map((c) => `${q(c.name)} ${c.pg}`).join(', '));
  const res = await tx.execute(sql`
    INSERT INTO ${sql.raw(q(table))} (${cols})
    SELECT ${orgId}::bigint, ${sel} FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(${defs})
    ON CONFLICT DO NOTHING
    RETURNING 1 AS one`);
  return res.rows.length;
}

async function idsByUuid(
  tx: TenantTx,
  orgId: number,
  table: string,
  uuids: string[],
  window?: { col: string; from: string; to: string },
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (uuids.length === 0) return out;
  const bound = window
    ? sql`AND ${sql.raw(q(window.col))} BETWEEN ${window.from}::timestamptz AND ${window.to}::timestamptz`
    : sql``;
  const res = await tx.execute(sql`
    SELECT id, uuid::text AS uuid FROM ${sql.raw(q(table))}
    WHERE org_id = ${orgId} AND uuid = ANY (ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(uuids)}::jsonb)::uuid)) ${bound}`);
  for (const r of res.rows as Array<{ id: number; uuid: string }>) out.set(r.uuid, Number(r.id));
  return out;
}

interface MapRow {
  collection: string;
  key: string;
  kind: string;
  table: string;
  id: number;
  uuid: string | null;
}

interface QRow {
  collection: string;
  source_key: string;
  reason_code: string;
  reason: string;
  doc: unknown;
}

export async function writeQuarantine(
  tx: TenantTx | Database,
  client: string,
  rows: QRow[],
): Promise<void> {
  if (rows.length === 0) return;
  // nothing credential-looking and no NUL ever reaches the quarantine table
  const clean = rows.map((r) => ({
    collection: stripNul(r.collection),
    source_key: stripNul(r.source_key),
    reason_code: r.reason_code,
    reason: stripNul(r.reason),
    doc: r.doc === undefined ? null : stripNul(scrub(r.doc).value),
  }));
  await tx.execute(sql`
    INSERT INTO migration.quarantine (source_client, collection, source_key, reason_code, reason, doc)
    SELECT ${client}, x.collection, x.source_key, x.reason_code, x.reason, x.doc
    FROM jsonb_to_recordset(${JSON.stringify(clean)}::jsonb) AS x(collection text, source_key text, reason_code text, reason text, doc jsonb)
    ON CONFLICT (source_client, collection, source_key, reason_code)
    DO UPDATE SET reason = EXCLUDED.reason, doc = EXCLUDED.doc, at = now()`);
}

export async function writeIdMap(
  tx: TenantTx | Database,
  client: string,
  orgId: number,
  rows: MapRow[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx.execute(sql`
    INSERT INTO migration.id_map (source_client, source_collection, source_key, key_kind, target_table, target_org_id, target_id, target_uuid)
    SELECT ${client}, x.collection, x.key, x.kind, x.tbl, ${orgId}::bigint, x.id, x.uuid
    FROM jsonb_to_recordset(${JSON.stringify(rows.map((r) => ({ ...r, tbl: r.table })))}::jsonb)
      AS x(collection text, key text, kind text, tbl text, id bigint, uuid uuid)
    ON CONFLICT DO NOTHING`);
}

function groupSoft(base: string, collection: string, soft: Soft[]): QRow[] {
  const byCode = new Map<string, Soft[]>();
  for (const s of soft) byCode.set(s.code, [...(byCode.get(s.code) ?? []), s]);
  return [...byCode].map(([code, list]) => ({
    collection,
    source_key: `${base}#${code}`,
    reason_code: code,
    reason: list[0]!.reason,
    doc:
      list.length === 1
        ? { detail: plain(list[0]!.detail) }
        : { detail: list.map((s) => plain(s.detail)) },
  }));
}

async function processBatch(
  env: Env,
  spec: HandlerSpec,
  docs: Array<{ doc: Doc; dup: number }>,
  prim: Set<string>,
  lastN: number,
  tx: TenantTx,
  baseCounts: Counts,
  batchNo: number,
): Promise<{ d: Counts; maps: MapRow[] }> {
  const d = zeroCounts();
  const mc = spec.mapCollection;
  const ctx = ctxOf(env);
  const quarantine: QRow[] = [];
  const planned: Array<{
    base: string;
    keys: ReturnType<typeof docKeys>;
    rows: Array<{ table: string; sub: string; row: Row; uuid: string }>;
    soft: Soft[];
    adopt?: { table: AdoptOutcome['table']; column: AdoptOutcome['column']; value: string };
  }> = [];
  const keyless = (table: string): boolean => Boolean(spec.tables[table]?.keyless);

  const batchAliases = new Set<string>();
  for (const { doc, dup } of docs) {
    const keys = docKeysWith(doc, spec.aliasKeys);
    const base = keys[0]?.key;
    if (!base) {
      quarantine.push({
        collection: mc,
        source_key: primaryKey(doc),
        reason_code: 'NO_KEY',
        reason: 'document has neither _id nor id',
        doc: plain(doc),
      });
      d.quarantined++;
      continue;
    }
    if (dup > 1) {
      // the same primary key a second time in one file: never silently skipped as "already migrated"
      quarantine.push({
        collection: mc,
        source_key: `${base}#dup${dup}`,
        reason_code: 'DUPLICATE_KEY',
        reason: `the primary key appears ${dup} times in the dump; only the first is migrated`,
        doc: plain(doc),
      });
      d.quarantined++;
      continue;
    }
    // "already migrated" keys on the PRIMARY key only: a string id that equals another document's key must not hide this one
    if (env.idmap.get(mc, base)) {
      d.already++;
      continue;
    }
    const out = transformDoc(spec, doc, ctx);
    if (out.kind === 'exclude') d.excluded++;
    else if (out.kind === 'quarantine') {
      quarantine.push({
        collection: mc,
        source_key: base,
        reason_code: out.code,
        reason: out.reason,
        doc: plain(doc),
      });
      d.quarantined++;
    } else {
      const soft = [...(out.soft ?? [])];
      const regKeys = [keys[0]!];
      for (const k of keys.slice(1)) {
        if (prim.has(k.key) || env.idmap.get(mc, k.key) || batchAliases.has(k.key)) {
          soft.push({
            code: 'KEY_COLLISION',
            reason:
              'the string id of this document equals the key of another document; references by that key resolve to the other one',
            detail: k.key,
          });
        } else {
          batchAliases.add(k.key);
          regKeys.push(k);
        }
      }
      planned.push({
        base,
        keys: regKeys,
        soft,
        rows:
          out.kind === 'rows'
            ? out.rows.map((r) => ({ ...r, uuid: rowUuid(env.client, mc, base, r.sub) }))
            : [],
        adopt:
          out.kind === 'adopt'
            ? { table: out.table, column: out.column, value: out.value }
            : undefined,
      });
    }
  }

  // insert per table, then read the ids back by uuid (covers rows that already existed)
  const byTable = new Map<string, Array<{ uuid: string; row: Row }>>();
  for (const p of planned)
    for (const r of p.rows)
      if (!keyless(r.table))
        byTable.set(r.table, [...(byTable.get(r.table) ?? []), { uuid: r.uuid, row: r.row }]);
  const idOf = new Map<string, number>();
  for (const [table, items] of byTable) {
    const ts = spec.tables[table]!;
    const uuids = items.map((i) => i.uuid);
    if (ts.custom) {
      // a table with no uuid column (partitioned stream): the loader writes it and hands back the ids; this transaction also writes id_map
      const made = await ts.custom(tx, env.orgId, items);
      d.inserted += made.inserted;
      for (const [u, id] of made.ids) idOf.set(u, id);
      continue;
    }
    // a partitioned table cannot hold a unique key: ids are looked up inside the batch's own time range
    const times = ts.windowCol ? items.map((i) => String(i.row[ts.windowCol!])).sort() : [];
    const window = ts.windowCol
      ? { col: ts.windowCol, from: times[0]!, to: times[times.length - 1]! }
      : undefined;
    // display ids are reserved only for rows that do not exist yet, so a rerun never inflates the counter
    const have = await idsByUuid(tx, env.orgId, table, uuids, window);
    const fresh = items.filter((i) => !have.has(i.uuid));
    await spec.beforeInsert?.(
      tx,
      ctx,
      table,
      fresh.map((i) => i.row),
    );
    // ON CONFLICT cannot protect a table with no unique key: rows that exist are never offered to the INSERT
    const inserted = await insertRows(tx, env.orgId, table, ts, ts.windowCol ? fresh : items);
    d.inserted += inserted.size;
    const got = await idsByUuid(tx, env.orgId, table, uuids, window);
    for (const [u, id] of got) idOf.set(u, id);
    await spec.afterInsert?.(
      tx,
      ctx,
      table,
      fresh.map((i) => ({ uuid: i.uuid, row: i.row, id: got.get(i.uuid) })),
    );
  }

  // rows without a uuid hang off the first (keyed) row of their document
  const hanging = new Map<string, Row[]>();
  for (const p of planned) {
    const parent = p.rows.find((r) => !keyless(r.table));
    const parentId = parent ? idOf.get(parent.uuid) : undefined;
    if (parentId === undefined) continue;
    for (const r of p.rows) {
      const kl = spec.tables[r.table]?.keyless;
      if (kl)
        hanging.set(r.table, [
          ...(hanging.get(r.table) ?? []),
          { ...r.row, [kl.parentCol]: parentId },
        ]);
    }
  }
  for (const [table, rows] of hanging)
    d.inserted += await insertKeyless(tx, env.orgId, table, spec.tables[table]!, rows);

  const maps: MapRow[] = [];
  for (const p of planned) {
    if (p.adopt) {
      const a = p.adopt;
      const found = await tx.execute(sql`
        SELECT id, uuid::text AS uuid FROM ${sql.raw(q(a.table))}
        WHERE org_id = ${env.orgId} AND ${sql.raw(q(a.column))} = ${a.value} ORDER BY id LIMIT 1`);
      const hit = found.rows[0] as { id: number | string; uuid: string } | undefined;
      if (!hit) {
        quarantine.push({
          collection: mc,
          source_key: p.base,
          reason_code: 'ADOPT_TARGET_MISSING',
          reason: `the ${a.table} row this document maps onto does not exist`,
          doc: null,
        });
        d.quarantined++;
        continue;
      }
      d.migrated++;
      for (const k of p.keys)
        maps.push({
          collection: mc,
          key: k.key,
          kind: k.kind,
          table: a.table,
          id: Number(hit.id),
          uuid: hit.uuid,
        });
      quarantine.push(...groupSoft(p.base, mc, p.soft));
      d.softIssues += p.soft.length;
      continue;
    }
    const keyedRows = p.rows.filter((r) => !keyless(r.table));
    const resolved = keyedRows.filter((r) => idOf.has(r.uuid));
    for (const r of keyedRows) {
      if (!idOf.has(r.uuid)) {
        quarantine.push({
          collection: mc,
          source_key: `${p.base}${r.sub}#UNIQUE_CONFLICT`,
          reason_code: 'UNIQUE_CONFLICT',
          reason: `a unique constraint on ${r.table} already holds an equal row`,
          doc: plain(r.row),
        });
      }
    }
    if (resolved.length === 0) {
      d.quarantined++;
      continue;
    }
    d.migrated++;
    for (const k of p.keys)
      maps.push({
        collection: mc,
        key: k.key,
        kind: k.kind,
        table: resolved[0]!.table,
        id: idOf.get(resolved[0]!.uuid)!,
        uuid: resolved[0]!.uuid,
      });
    quarantine.push(...groupSoft(p.base, mc, p.soft));
    d.softIssues += p.soft.length;
  }

  await writeQuarantine(tx, env.client, quarantine);
  await writeIdMap(tx, env.client, env.orgId, maps);
  await env.midBatch?.({ step: spec.handler, batch: batchNo });
  const total = sumCounts(baseCounts, d);
  await tx.execute(sql`
    INSERT INTO migration.run_log (source_client, collection, step, run_id, last_key, state, counts, source_sha256)
    VALUES (${env.client}, ${mc}, ${spec.handler}, ${env.runId}, ${lastN}, 'running', ${JSON.stringify(total)}::jsonb, ${shaOf(env, spec)})
    ON CONFLICT (source_client, collection, step)
    DO UPDATE SET run_id = EXCLUDED.run_id, last_key = EXCLUDED.last_key, state = 'running', counts = EXCLUDED.counts,
                  source_sha256 = EXCLUDED.source_sha256, updated_at = now()`);

  // the caller applies `maps` to the in-memory id map only once the transaction has committed
  return { d, maps };
}

export const sumCounts = (a: Counts, b: Counts): Counts => ({
  read: a.read + b.read,
  migrated: a.migrated + b.migrated,
  quarantined: a.quarantined + b.quarantined,
  excluded: a.excluded + b.excluded,
  already: a.already + b.already,
  inserted: a.inserted + b.inserted,
  softIssues: a.softIssues + b.softIssues,
});

function baseSha(env: Env, spec: HandlerSpec): string | null {
  const m = readManifest(env.dumpsDir, env.client);
  const of = (c: string): string | null =>
    m?.collections.find((x) => x.collection === c)?.sha256 ?? null;
  const own = of(spec.collection);
  if (own === null || !spec.shaCollections?.length) return own;
  // a derived step reads several collections: a change in any of them is a change of this step's input
  return sha256([own, ...spec.shaCollections.map((c) => of(c) ?? '-')].join(':'));
}

function shaOf(env: Env, spec: HandlerSpec): string | null {
  const sha = baseSha(env, spec);
  const fp = spec.fingerprint?.(env);
  return sha !== null && fp ? `${sha}:${fp}` : sha;
}

export async function getLog(
  db: Database,
  client: string,
  collection: string,
  step: string,
): Promise<{
  last_key: number;
  state: string;
  counts: Counts;
  source_sha256: string | null;
} | null> {
  const r = await db.execute(sql`
    SELECT last_key, state, counts, source_sha256 FROM migration.run_log
    WHERE source_client = ${client} AND collection = ${collection} AND step = ${step}`);
  const row = r.rows[0] as
    { last_key: number; state: string; counts: Counts; source_sha256: string | null } | undefined;
  return row ? { ...row, last_key: Number(row.last_key) } : null;
}

/** Runs one step: stream, batch, one tenant transaction per batch, checkpoint inside it. Resumable and idempotent. */
/** The primary key (ObjectId hex, else string id) of every document of a source collection. */
export async function primaryKeySet(
  env: Pick<Env, 'source' | 'client' | 'pkCache'>,
  collection: string,
): Promise<Set<string>> {
  const cache = env.pkCache ?? new Map<string, Set<string>>();
  const hit = cache.get(collection);
  if (hit) return hit;
  const out = new Set<string>();
  if (env.source.collections(env.client).includes(collection)) {
    for await (const d of env.source.read(env.client, collection)) {
      const k = docKeys(d)[0]?.key;
      if (k !== undefined) out.add(k);
    }
  }
  cache.set(collection, out);
  return out;
}

export async function runStep(env: Env, spec: HandlerSpec): Promise<Counts> {
  const mc = spec.mapCollection;
  if (!spec.read && !env.source.collections(env.client).includes(spec.collection)) {
    env.log(`  ${spec.handler.padEnd(18)} (no ${spec.collection} in the source)`);
    return zeroCounts();
  }
  const base = baseSha(env, spec);
  const prior = env.force ? null : await getLog(env.db, env.client, mc, spec.handler);
  const baseOf = (x: string | null): string | null => (x === null ? null : x.split(':')[0]!);
  if (prior && prior.state === 'done' && baseOf(prior.source_sha256) === base) {
    env.log(`  ${spec.handler.padEnd(18)} already done (${JSON.stringify(prior.counts)})`);
    return prior.counts;
  }
  // a step with a plan: channels, partitions and the plan itself are made before the first batch (and not at all for a finished step)
  await spec.prepare?.(env);
  const sha = shaOf(env, spec);
  const log = prior;
  let skip = 0;
  let counts = zeroCounts();
  if (log && log.state !== 'done' && log.source_sha256 === sha) {
    skip = log.last_key;
    counts = log.counts;
    env.log(`  ${spec.handler.padEnd(18)} resuming after ${skip} documents`);
  }

  const stream = spec.loadOrder
    ? spec.loadOrder(env)
    : spec.read
      ? spec.read({ idx: env.idx, source: env.source, client: env.client, ctx: ctxOf(env) })
      : env.source.read(env.client, spec.collection);
  let n = 0;
  let batchNo = 0;
  let batch: Array<{ doc: Doc; dup: number }> = [];
  let readInBatch = 0;
  let lastGroup: string | undefined;
  // every primary key seen so far in this file, resumed runs included, so a duplicate is never mistaken for "already migrated"
  const seen = new Map<string, number>();
  const prim = spec.virtual ? new Set<string>() : await primaryKeySet(env, spec.collection);
  const flush = async (upTo: number = n): Promise<void> => {
    if (batch.length === 0) return;
    const docs = batch;
    const last = upTo;
    batch = [];
    let got: Awaited<ReturnType<typeof processBatch>>;
    try {
      got = await withTenant(env.db, { orgId: env.orgId }, (tx) =>
        processBatch(env, spec, docs, prim, last, tx, counts, batchNo + 1),
      );
    } catch (e) {
      // never the driver's text: it carries the bound parameters, i.e. other contacts' emails and phones
      const first = docKeysWith(docs[0]!.doc, spec.aliasKeys)[0]?.key ?? '(no key)';
      const lastKey = docKeysWith(docs[docs.length - 1]!.doc, spec.aliasKeys)[0]?.key ?? '(no key)';
      throw new Error(
        `${spec.handler}: ${sanitizeError(e)} (batch ${batchNo + 1}, ${docs.length} documents of ${spec.collection}, source keys ${first} .. ${lastKey})`,
      );
    }
    for (const m of got.maps)
      env.idmap.put(m.collection, m.key, { table: m.table, id: m.id, uuid: m.uuid ?? '' });
    got.d.read = readInBatch;
    readInBatch = 0;
    counts = sumCounts(counts, got.d);
    batchNo++;
    await env.afterBatch?.({ step: spec.handler, batch: batchNo });
  };
  for await (const doc of stream) {
    n++;
    const k = docKeysWith(doc, spec.aliasKeys)[0]?.key;
    const dup = k === undefined ? 1 : (seen.get(k) ?? 0) + 1;
    if (k !== undefined) seen.set(k, dup);
    if (n <= skip) continue;
    if (spec.only && !spec.only(doc)) continue;
    // a batch closes only between groups (inbox: a thread and its messages are one atomic unit)
    const g = spec.group?.(doc, env);
    if (g !== undefined && batch.length >= env.batchSize && g !== lastGroup) await flush(n - 1);
    lastGroup = g;
    readInBatch++;
    batch.push({ doc, dup });
    if (g === undefined && batch.length >= env.batchSize) await flush();
  }
  await flush();
  await env.db.execute(sql`
    INSERT INTO migration.run_log (source_client, collection, step, run_id, last_key, state, counts, source_sha256)
    VALUES (${env.client}, ${mc}, ${spec.handler}, ${env.runId}, ${n}, 'done', ${JSON.stringify(counts)}::jsonb, ${sha})
    ON CONFLICT (source_client, collection, step)
    DO UPDATE SET run_id = EXCLUDED.run_id, last_key = EXCLUDED.last_key, state = 'done', counts = EXCLUDED.counts,
                  source_sha256 = EXCLUDED.source_sha256, updated_at = now()`);
  env.log(`  ${spec.handler.padEnd(18)} ${JSON.stringify(counts)}`);
  return counts;
}
