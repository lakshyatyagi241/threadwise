import { readManifest, verifyDump } from '../extract/manifest';
import { NdjsonDirSource } from '../extract/source';
import { norm } from '../reconcile';
import { STEPS, transformDoc } from '../transform';
import { resolveBroadcast, type BroadcastSettings } from '../broadcast/config';
import { buildIndex } from '../transform/source-index';
import type { HandlerSpec, Row, TableSpec } from '../transform/types';
import { docKeysWith, sanitizeError } from '../util';
import { connect, q, sql, withPrivileged, withTenant, type Database } from './db';
import { ctxOf, IdMap, rowUuid, type Env } from './engine';
import { BCAST_COLLECTION, planBroadcast } from './broadcast';
import { linkedCampaigns } from './campaignlink';
import { acquireRunLock, startHeartbeat, type LockConn } from './run';

/**
 * UPDATE MODE. The loader is insert-only (a source document already in migration.id_map is skipped), so everything changed in Waboo
 * after the first load never reached WaDesk. `update` brings the rows of the opted-in steps (HandlerSpec.update) back in line:
 *
 *  - for each source document whose id_map row exists, the transform output is compared column by column (every column the step
 *    writes, except display_id and the step's `update.ignore`) with the stored row, read through the same normalisation the verifier
 *    uses; ONLY the changed columns are updated. Nothing else is ever touched: a column the migration does not write is not in the
 *    statement. Foreign keys (owner_id ...) resolve through id_map exactly as in a fresh load; custom field values live in
 *    contacts.data and are rebuilt by the same transform.
 *  - updated_at takes the source time (it is one of the compared columns). The tables' touch trigger would overwrite it with now(),
 *    so for the statements of one batch ONLY that table's `trg_<table>_touch` is disabled (ALTER TABLE ... DISABLE/ENABLE TRIGGER, in
 *    the same transaction: it rolls back with it; the table is write-locked, readable, for that transaction) and row_version is
 *    bumped by hand, + 1 per updated row. Other triggers (contacts_normalize) keep running. No event_outbox, audit_log or
 *    contact_events row: plain UPDATE statements, as everywhere in this tool. Needs the OWNER login (table owner) for the apply.
 *  - LOCAL-EDIT RULE: a row is updated only when its row_version still equals the one this tool left on it (migration.id_map
 *    .written_version; NULL = never updated by the tool = the 1 the loader inserted). Every UPDATE of the row by anything else
 *    (a user, the app, an import) bumps row_version through the touch trigger, so a different version means "edited since": the row
 *    is counted as CONFLICT_LOCAL_EDIT (and the columns that differ are counted per column), and left exactly as it is. The UPDATE
 *    itself repeats the check (WHERE row_version = ...), so an edit racing the run is a conflict too, never overwritten.
 *  - a document that is now soft-deleted / excluded / quarantined at the source, or no longer in the dump at all, is REPORTED
 *    (counted, keys listed), not deleted. The one exception is a step with `update.prune` (list memberships): the link row is
 *    deleted when the document is gone while its contact is still live and the row was never edited.
 *  - a row deleted in WaDesk since the load is counted (TARGET_MISSING) and not re-created; a document not in id_map yet is counted
 *    (NEW_IN_SOURCE) and left for the normal `run`.
 *  - a unique-key clash on update is rolled back to a savepoint and counted (UNIQUE_CONFLICT); the rest of the batch goes on.
 *  - idempotent: after an apply, the same comparison finds nothing to change. Dry run (default) writes nothing and prints the same counts.
 */
export interface UpdateOptions {
  dumpsDir: string;
  client: string;
  orgSlug: string;
  targetUrl: string;
  ownerUrl: string;
  apply: boolean;
  defaultCountryCode: string | null;
  /** handler names or groups (default: every step that opted in) */
  steps?: string[];
  batch?: number;
  skipHash?: boolean;
  lockWaitSeconds?: number;
  log: (line: string) => void;
}

export const UPDATE_COLLECTION = '_update';
const KEY_LIST_CAP = 2000;
const KEY_PRINT_CAP = 40;

export interface StepUpdate {
  step: string;
  tables: string[];
  read: number;
  unchanged: number;
  /** rows that differ and were (apply) / would be (dry) updated */
  changed: number;
  conflictLocalEdit: number;
  sourceExcluded: number;
  sourceGone: number;
  targetMissing: number;
  newInSource: number;
  uniqueConflict: number;
  /** a changed row whose new value is outside the step's `update.allow` list (never written) */
  refused: number;
  pruned: number;
  /** columns that changed, per column, over the updated rows */
  cols: Record<string, number>;
  /** columns that differ on rows left alone because of a local edit */
  conflictCols: Record<string, number>;
  excludedKeys: string[];
  goneKeys: string[];
}

const blank = (step: string, tables: string[]): StepUpdate => ({
  step,
  tables,
  read: 0,
  unchanged: 0,
  changed: 0,
  conflictLocalEdit: 0,
  sourceExcluded: 0,
  sourceGone: 0,
  targetMissing: 0,
  newInSource: 0,
  uniqueConflict: 0,
  refused: 0,
  pruned: 0,
  cols: {},
  conflictCols: {},
  excludedKeys: [],
  goneKeys: [],
});

const bump = (m: Record<string, number>, k: string, by = 1): void => {
  m[k] = (m[k] ?? 0) + by;
};

// --- pure decisions (unit tested) -------------------------------------------------------------------------------------------------

/** The columns whose value differs between what a fresh load would write and what is stored, compared the way the verifier compares. */
export function diffColumns(
  columns: Array<{ name: string; pg: string }>,
  skip: ReadonlySet<string>,
  want: Row,
  have: Row,
): string[] {
  return columns
    .filter((c) => !skip.has(c.name))
    .filter((c) => norm(want[c.name], c.pg) !== norm(have[c.name], c.pg))
    .map((c) => c.name);
}

export type Verdict = 'unchanged' | 'update' | 'conflict';

/** `writtenVersion` undefined = the tool never updated the row = the inserted version 1. */
export function decide(diff: string[], storedVersion: number, writtenVersion?: number): Verdict {
  if (diff.length === 0) return 'unchanged';
  return storedVersion === (writtenVersion ?? 1) ? 'update' : 'conflict';
}

/** Columns not to compare for one document: a document with no usable date got the dump's generatedAt as its date, which moves with every export. */
export function skipFor(ts: TableSpec, ignore: string[] | undefined, noDate: boolean): Set<string> {
  return new Set([
    ...(ts.skipCompare ?? []),
    ...(ignore ?? []),
    ...(noDate ? ['created_at', 'updated_at'] : []),
  ]);
}

// --- one step -------------------------------------------------------------------------------------------------------------------

interface Item {
  base: string;
  table: string;
  uuid: string;
  row: Row;
  noDate: boolean;
}
interface Plan {
  table: string;
  uuid: string;
  id: number;
  version: number;
  set: string[];
  row: Row;
}

const selectExpr = (c: { name: string; pg: string }): string =>
  c.pg === 'timestamptz'
    ? `to_char(${q(c.name)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS ${q(c.name)}`
    : c.pg === 'date'
      ? `to_char(${q(c.name)}, 'YYYY-MM-DD') AS ${q(c.name)}`
      : c.pg === 'time'
        ? `to_char(${q(c.name)}, 'HH24:MI:SS') AS ${q(c.name)}`
        : q(c.name);

const pgCode = (e: unknown): string | undefined => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code ?? x?.cause?.code;
};

async function writtenVersions(db: Database, client: string, mc: string): Promise<Map<string, number>> {
  try {
    const r = await db.execute(sql`
      SELECT target_uuid::text AS uuid, max(written_version) AS v FROM migration.id_map
      WHERE source_client = ${client} AND source_collection = ${mc} AND written_version IS NOT NULL
      GROUP BY target_uuid`);
    return new Map((r.rows as Array<{ uuid: string; v: number }>).map((x) => [x.uuid, Number(x.v)]));
  } catch (e) {
    throw new Error(
      `UPDATE_SCHEMA: migration.id_map has no written_version column (${sanitizeError(e)}); run \`init\` once as the owner first`,
    );
  }
}

export async function runUpdateStep(
  env: Env,
  spec: HandlerSpec,
  o: { apply: boolean; ownerDb?: Database; batch: number },
): Promise<StepUpdate> {
  const mc = spec.mapCollection;
  const tables = Object.keys(spec.tables);
  for (const t of tables) {
    const ts = spec.tables[t]!;
    if (ts.keyless || ts.custom || ts.noUuid || ts.windowCol)
      throw new Error(`UPDATE_UNSUPPORTED: ${spec.handler} writes ${t} without a uuid; update mode cannot match its rows`);
  }
  const rep = blank(spec.handler, tables);
  const written = await writtenVersions(env.db, env.client, mc);
  // campaign-link (load/campaignlink.ts) is the tool's own earlier writer of wpcampaigns: it left row_version 2 on exactly these campaigns
  const linked = await linkedCampaigns(env.db, env.client).catch(() => new Set<string>());
  const baseline = (uuid: string): number => written.get(uuid) ?? (linked.has(uuid) ? 2 : 1);
  await prepareContext(env, spec);
  const ignore = spec.update?.ignore;
  const ctx = ctxOf(env);
  const seen = new Set<string>();
  const primary = new Set<string>();
  const stream = spec.read
    ? spec.read({ idx: env.idx, source: env.source, client: env.client, ctx })
    : env.source.read(env.client, spec.collection);
  let chunk: Item[] = [];

  const flush = async (): Promise<void> => {
    if (chunk.length === 0) return;
    const items = chunk;
    chunk = [];
    const plans: Plan[] = [];
    for (const table of tables) {
      const list = items.filter((i) => i.table === table);
      if (list.length === 0) continue;
      const ts = spec.tables[table]!;
      const res = await withTenant(env.db, { orgId: env.orgId }, (tx) =>
        tx.execute(sql`
          SELECT id, uuid::text AS uuid, row_version, ${sql.raw(ts.columns.map(selectExpr).join(', '))}
          FROM ${sql.raw(q(table))} WHERE org_id = ${env.orgId}
            AND uuid = ANY (ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(list.map((l) => l.uuid))}::jsonb)::uuid))`),
      );
      const found = new Map((res.rows as Row[]).map((r) => [r.uuid as string, r]));
      for (const it of list) {
        const have = found.get(it.uuid);
        if (!have) {
          rep.targetMissing++;
          continue;
        }
        const diff = diffColumns(ts.columns, skipFor(ts, ignore, it.noDate), it.row, have);
        const verdict = decide(diff, Number(have.row_version), baseline(it.uuid));
        const allow = spec.update?.allow ?? {};
        if (verdict === 'update' && diff.some((c) => allow[c] && !allow[c]!.includes(String(it.row[c])))) {
          rep.refused++;
          continue;
        }
        if (verdict === 'unchanged') rep.unchanged++;
        else if (verdict === 'conflict') {
          rep.conflictLocalEdit++;
          for (const c of diff) bump(rep.conflictCols, c);
        } else {
          rep.changed++;
          for (const c of diff) bump(rep.cols, c);
          plans.push({
            table,
            uuid: it.uuid,
            id: Number(have.id),
            version: Number(have.row_version),
            set: diff,
            row: it.row,
          });
        }
      }
    }
    if (o.apply && plans.length > 0) await applyPlans(env, spec, o.ownerDb!, plans, rep, written);
  };

  for await (const doc of stream) {
    const keys = docKeysWith(doc, spec.aliasKeys);
    // every document of the file counts as present (steps sharing one collection, e.g. stages and statuses, must not see each other's as gone)
    for (const k of keys) seen.add(k.key);
    if (spec.only && !spec.only(doc)) continue;
    const base = keys[0]?.key;
    if (!base || primary.has(base)) continue; // no key / a duplicate key: the loader quarantined it, nothing to compare
    primary.add(base);
    rep.read++;
    if (!env.idmap.get(mc, base)) {
      rep.newInSource++;
      continue;
    }
    const out = transformDoc(spec, doc, ctx);
    if (out.kind === 'exclude' || out.kind === 'quarantine') {
      rep.sourceExcluded++;
      if (rep.excludedKeys.length < KEY_LIST_CAP) rep.excludedKeys.push(`${base}:${out.code}`);
      continue;
    }
    if (out.kind !== 'rows') continue;
    const noDate = (out.soft ?? []).some((s) => s.code === 'NO_DATE');
    for (const r of out.rows)
      chunk.push({ base, table: r.table, uuid: rowUuid(env.client, mc, base, r.sub), row: r.row, noDate });
    if (chunk.length >= o.batch) await flush();
  }
  await flush();

  // documents that were loaded and are no longer in the dump at all
  const gone = env.idmap.keys(mc).filter((k) => !seen.has(k) && tables.includes(env.idmap.get(mc, k)!.table));
  const prune: string[] = [];
  for (const k of gone) {
    if (spec.update?.prune?.(k, env)) prune.push(k);
    else {
      rep.sourceGone++;
      if (rep.goneKeys.length < KEY_LIST_CAP) rep.goneKeys.push(k);
    }
  }
  if (prune.length > 0) await pruneRows(env, spec, prune, o, rep, baseline);
  return rep;
}

async function applyPlans(
  env: Env,
  spec: HandlerSpec,
  ownerDb: Database,
  plans: Plan[],
  rep: StepUpdate,
  written: Map<string, number>,
): Promise<void> {
  const tables = [...new Set(plans.map((p) => p.table))];
  const done: Array<{ uuid: string; v: number }> = [];
  await withTenant(ownerDb, { orgId: env.orgId }, async (tx) => {
    for (const table of tables) {
      const ts = spec.tables[table]!;
      const types = new Map(ts.columns.map((c) => [c.name, c.pg]));
      const trg = `trg_${table}_touch`;
      const hasTouch =
        (
          await tx.execute(sql`
            SELECT 1 FROM pg_trigger WHERE tgrelid = ${q(table)}::regclass AND tgname = ${trg} AND NOT tgisinternal`)
        ).rows.length > 0;
      if (hasTouch) await tx.execute(sql.raw(`ALTER TABLE ${q(table)} DISABLE TRIGGER ${q(trg)}`));
      for (const p of plans.filter((x) => x.table === table)) {
        const sets = sql.join(
          p.set.map((c) => {
            const v = p.row[c];
            const pg = types.get(c)!;
            return sql`${sql.raw(q(c))} = ${pg === 'jsonb' ? (v === null || v === undefined ? null : JSON.stringify(v)) : (v ?? null)}::${sql.raw(pg)}`;
          }),
          sql`, `,
        );
        await tx.execute(sql`SAVEPOINT upd_row`);
        try {
          const r = await tx.execute(sql`
            UPDATE ${sql.raw(q(table))} SET ${sets}, row_version = row_version + 1
            WHERE org_id = ${env.orgId} AND id = ${p.id} AND row_version = ${p.version}
            RETURNING row_version`);
          await tx.execute(sql`RELEASE SAVEPOINT upd_row`);
          if (r.rows.length === 0) {
            // edited between the read and the write: a local edit, never overwritten
            rep.changed--;
            rep.conflictLocalEdit++;
            for (const c of p.set) {
              bump(rep.cols, c, -1);
              bump(rep.conflictCols, c);
            }
          } else done.push({ uuid: p.uuid, v: Number((r.rows[0] as { row_version: number }).row_version) });
        } catch (e) {
          await tx.execute(sql`ROLLBACK TO SAVEPOINT upd_row`);
          if (pgCode(e) !== '23505') throw e;
          rep.changed--;
          rep.uniqueConflict++;
          for (const c of p.set) bump(rep.cols, c, -1);
        }
      }
      if (hasTouch) await tx.execute(sql.raw(`ALTER TABLE ${q(table)} ENABLE TRIGGER ${q(trg)}`));
    }
    if (done.length > 0)
      await tx.execute(sql`
        UPDATE migration.id_map m SET written_version = x.v
        FROM jsonb_to_recordset(${JSON.stringify(done)}::jsonb) AS x(uuid uuid, v bigint)
        WHERE m.source_client = ${env.client} AND m.target_org_id = ${env.orgId} AND m.target_uuid = x.uuid`);
  });
  for (const d of done) written.set(d.uuid, d.v);
}

async function pruneRows(
  env: Env,
  spec: HandlerSpec,
  keys: string[],
  o: { apply: boolean; ownerDb?: Database },
  rep: StepUpdate,
  baseline: (uuid: string) => number,
): Promise<void> {
  const mc = spec.mapCollection;
  const refs = keys.map((k) => ({ key: k, ref: env.idmap.get(mc, k)! }));
  const table = refs[0]!.ref.table;
  const res = await withTenant(env.db, { orgId: env.orgId }, (tx) =>
    tx.execute(sql`
      SELECT id, row_version FROM ${sql.raw(q(table))} WHERE org_id = ${env.orgId}
        AND id IN (SELECT jsonb_array_elements_text(${JSON.stringify(refs.map((r) => r.ref.id))}::jsonb)::bigint)`),
  );
  const have = new Map((res.rows as Array<{ id: number; row_version: number }>).map((r) => [Number(r.id), Number(r.row_version)]));
  const del: Array<{ key: string; id: number; version: number }> = [];
  for (const { key, ref } of refs) {
    const v = have.get(ref.id);
    if (v === undefined) rep.targetMissing++;
    else if (v !== baseline(ref.uuid)) {
      rep.conflictLocalEdit++;
      rep.sourceGone++;
      if (rep.goneKeys.length < KEY_LIST_CAP) rep.goneKeys.push(key);
    } else del.push({ key, id: ref.id, version: v });
  }
  rep.pruned += del.length;
  if (!o.apply || del.length === 0) return;
  const removed = await withTenant(o.ownerDb!, { orgId: env.orgId }, async (tx) => {
    const r = await tx.execute(sql`
      DELETE FROM ${sql.raw(q(table))} t USING jsonb_to_recordset(${JSON.stringify(del)}::jsonb) AS x(id bigint, version bigint)
      WHERE t.org_id = ${env.orgId} AND t.id = x.id AND t.row_version = x.version
      RETURNING t.id`);
    const gone = new Set((r.rows as Array<{ id: number }>).map((x) => Number(x.id)));
    const keysGone = del.filter((d) => gone.has(d.id)).map((d) => d.key);
    await tx.execute(sql`
      DELETE FROM migration.id_map WHERE source_client = ${env.client} AND source_collection = ${mc}
        AND source_key IN (SELECT jsonb_array_elements_text(${JSON.stringify(keysGone)}::jsonb))`);
    return gone.size;
  });
  rep.pruned -= del.length - removed; // a row edited between the read and the delete stays
  rep.conflictLocalEdit += del.length - removed;
}

// --- the command ----------------------------------------------------------------------------------------------------------------

/**
 * The per-step context `run` builds in its prepare hook, minus everything that writes. Broadcast steps need the plan of pass 1 (campaign
 * verdicts, roll-ups, the template link): built from the same dump with the switches the run RECORDED (run_log _bcast / options; the
 * defaults when there is no record), so a document gets the same verdict as in a fresh load. Not supported, on purpose: flows / widgets
 * (the plan creates derived documents and flows are armed by flow-state), credits (an immutable ledger) and chat (the plan creates
 * channels and partitions): they are not opted in and `update` refuses to select them.
 */
async function prepareContext(env: Env, spec: HandlerSpec): Promise<void> {
  if (spec.handler !== 'campaigns' && spec.handler !== 'recipients') return;
  if (env.bcast) return;
  const rec = (
    await env.db.execute(
      sql`SELECT counts FROM migration.run_log WHERE source_client = ${env.client} AND collection = ${BCAST_COLLECTION} AND step = 'options'`,
    )
  ).rows[0] as { counts?: Partial<BroadcastSettings> } | undefined;
  const settings = resolveBroadcast(rec?.counts ?? {});
  env.bcastSettings = settings;
  env.bcast = await planBroadcast({ env, settings });
  env.log(`  update ${spec.handler.padEnd(18)} broadcast plan built (${rec ? 'switches as recorded by the run' : 'no recorded switches: defaults'})`);
}

export function updatableSteps(names?: string[]): HandlerSpec[] {
  const all = STEPS.filter((s) => s.update);
  if (!names || names.length === 0) return all;
  const want = new Set(names);
  const bad = [...want].filter((n) => !all.some((s) => s.handler === n));
  if (bad.length > 0)
    throw new Error(
      `UPDATE_STEPS: ${bad.join(', ')} cannot be updated; steps that can: ${all.map((s) => s.handler).join(', ')}`,
    );
  return all.filter((s) => want.has(s.handler));
}

export async function updateRows(o: UpdateOptions): Promise<StepUpdate[]> {
  const specs = updatableSteps(o.steps);
  const source = new NdjsonDirSource(o.dumpsDir);
  const manifest = readManifest(o.dumpsDir, o.client);
  if (!manifest) throw new Error(`UPDATE_NO_MANIFEST: ${o.client}: no manifest.json in the dump`);
  if (!o.skipHash) {
    const problems = await verifyDump(source, o.dumpsDir, o.client);
    if (problems.length > 0)
      throw new Error(`UPDATE_DUMP_CHANGED: the dump does not match manifest.json:\n  ${problems.join('\n  ')}`);
  }
  const owner = connect(o.ownerUrl, 'owner');
  const worker = connect(o.targetUrl, 'worker');
  const lockConn = await worker.pool.connect();
  let stopBeat: () => void = () => undefined;
  try {
    const org = (
      await withPrivileged(owner.db, (tx) =>
        tx.execute(
          sql`SELECT id FROM organizations WHERE slug = ${o.orgSlug} AND settings #>> '{legacy,waboo,client}' = ${o.client}`,
        ),
      )
    ).rows[0] as { id: number | string } | undefined;
    if (!org) throw new Error(`UPDATE_NO_ORG: no organization "${o.orgSlug}" made by this tool for ${o.client}`);
    const orgId = Number(org.id);
    // one run per client at a time, the same lock `run` takes
    await acquireRunLock(lockConn as LockConn, o.client, o.lockWaitSeconds ?? 120, 15, o.log);
    stopBeat = startHeartbeat(lockConn as LockConn, o.client);

    const idmap = new IdMap();
    await idmap.load(worker.db, o.client);
    const env: Env = {
      source,
      client: o.client,
      dumpsDir: o.dumpsDir,
      db: worker.db,
      orgId,
      idmap,
      idx: await buildIndex(source, o.client, manifest.generatedAt),
      batchSize: o.batch ?? 500,
      defaultCountryCode: o.defaultCountryCode,
      fallbackAt: manifest.generatedAt,
      pkCache: new Map(),
      force: false,
      runId: `update-${Date.now()}`,
      log: o.log,
    };
    const out: StepUpdate[] = [];
    for (const spec of specs) {
      if (!source.collections(o.client).includes(spec.collection)) {
        o.log(`  update ${spec.handler.padEnd(18)} (no ${spec.collection} in the source)`);
        continue;
      }
      const r = await runUpdateStep(env, spec, { apply: o.apply, ownerDb: owner.db, batch: o.batch ?? 500 });
      out.push(r);
      report(r, o);
      if (o.apply)
        await worker.db.execute(sql`
          INSERT INTO migration.run_log (source_client, collection, step, run_id, last_key, state, counts)
          VALUES (${o.client}, ${UPDATE_COLLECTION}, ${`update:${spec.handler}`}, ${env.runId}, ${r.read}, 'done', ${JSON.stringify({ ...r, at: new Date().toISOString() })}::jsonb)
          ON CONFLICT (source_client, collection, step) DO UPDATE SET run_id = EXCLUDED.run_id, last_key = EXCLUDED.last_key, counts = EXCLUDED.counts, updated_at = now()`);
    }
    o.log(
      o.apply
        ? '  update done. Run reconcile next: updated rows carry row_version > 1 and the verifier accepts exactly the version this tool recorded.'
        : '  update DRY RUN: nothing was written (add --apply --confirm-org-slug <slug>)',
    );
    return out;
  } finally {
    stopBeat();
    await lockConn.query('SELECT pg_advisory_unlock_all()').catch(() => undefined);
    lockConn.release();
    await worker.close();
    await owner.close();
  }
}

function report(r: StepUpdate, o: UpdateOptions): void {
  const p = `  update ${r.step.padEnd(18)}`;
  o.log(
    `${p} ${r.tables.join('+')}: read ${r.read}, unchanged ${r.unchanged}, ${o.apply ? 'updated' : 'to update'} ${r.changed}, CONFLICT_LOCAL_EDIT ${r.conflictLocalEdit}, UNIQUE_CONFLICT ${r.uniqueConflict}, refused (value not allowed) ${r.refused}, ${o.apply ? 'removed' : 'to remove'} ${r.pruned}`,
  );
  o.log(
    `${p} not touched: source excluded/quarantined now ${r.sourceExcluded}, gone from the dump ${r.sourceGone}, row deleted in WaDesk ${r.targetMissing}, new in the source (left for run) ${r.newInSource}`,
  );
  for (const [c, n] of Object.entries(r.cols).sort((a, b) => b[1] - a[1])) o.log(`${p} column ${c}: ${n}`);
  for (const [c, n] of Object.entries(r.conflictCols).sort((a, b) => b[1] - a[1]))
    o.log(`${p} left alone (local edit) column ${c}: ${n}`);
  if (r.excludedKeys.length > 0)
    o.log(`${p} now excluded (key:code), first ${Math.min(KEY_PRINT_CAP, r.excludedKeys.length)}: ${r.excludedKeys.slice(0, KEY_PRINT_CAP).join(' ')}`);
  if (r.goneKeys.length > 0)
    o.log(`${p} gone from the dump, first ${Math.min(KEY_PRINT_CAP, r.goneKeys.length)}: ${r.goneKeys.slice(0, KEY_PRINT_CAP).join(' ')}`);
}
