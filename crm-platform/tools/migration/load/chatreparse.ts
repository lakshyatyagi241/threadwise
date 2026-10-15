import { previewOf } from '../inbox/peer';
import { parseTurn } from '../inbox/parse';
import { connect, sql, withPrivileged, withTenant } from './db';

/**
 * chat-reparse: repairs the bot messages an EARLIER load stored with an empty body because the parser did not read the interactive
 * elements (`{interactive: {header, body, footer, action}}`) of `bot_response.response[]`. The original payload is kept in
 * `messages.meta.legacy.response`, so no dump is needed: this reads only the database.
 *
 * Which rows: messages of ONE organization that this tool loaded (migration.id_map, collection chathistory), outbound, body NULL or
 * blank, `meta.legacy.response` present, `media_key` NULL and not yet copied by copy-files (no `filesCopiedAt`).
 * What changes, per row, from the NEW parser run on the saved payload: `body`, `kind`, and `meta.legacy` (+ `mediaUrl`, `interactive`,
 * `location` when the parser now finds them). Nothing else: not created_at / seq / direction / sender / status / media_key. `messages`
 * has no touch trigger and no updated_at column, so this is a plain UPDATE. No event_outbox, audit or notification row.
 * Conversation: when the repaired message is the LAST one of its conversation and the stored preview is still what the loader derived
 * from the empty body (`previewOf({kind: old kind, body: null})`), preview is set to `previewOf` of the new kind and body. Nothing else of
 * the conversation moves (no counter depends on the body). `conversations` HAS a touch trigger, so those rows get updated_at = now()
 * and row_version + 1; their uuids are recorded in migration.run_log (_chat / chat_reparse) and reconcile expects exactly that.
 * Idempotent: a repaired row has a body, so it is not picked again; a row with a media url but no text is picked again but computes
 * the same values and counts as unchanged. One transaction per batch of conversations. Dry run by default.
 */
export interface ChatReparseOptions {
  client: string;
  orgSlug: string;
  targetUrl: string;
  ownerUrl: string;
  apply: boolean;
  /** conversations per transaction */
  batch?: number;
  log: (line: string) => void;
}

export const REPARSE_COLLECTION = '_chat';
export const REPARSE_STEP = 'chat_reparse';

export interface RepairInput {
  kind: string;
  meta: Record<string, unknown>;
}
export interface Repair {
  /** false: nothing to write (already right, or still unreadable) */
  change: boolean;
  body: string | null;
  kind: string;
  /** keys to merge into meta.legacy */
  legacyPatch: Record<string, unknown>;
  /** true when the saved payload still has no text and no media */
  unreadable: boolean;
  /** key sets of the elements of an unreadable payload (structure only) */
  shapes: string[];
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** The key set of every element of a saved `bot_response`, no values: '<string>' / '<null>' for bare ones. */
export function elementShapes(response: unknown): string[] {
  const r = obj(response)?.response;
  const list = Array.isArray(r) ? r : r === undefined ? [] : [r];
  return list.map((e) => {
    const o = obj(e);
    if (o) return Object.keys(o).sort().join(',') || '<empty object>';
    return e === null ? '<null>' : `<${typeof e}>`;
  });
}

/** What the new parser makes of one saved row. Pure: the database part is below. */
export function repairOf(row: RepairInput): Repair {
  const legacy = obj(row.meta.legacy) ?? {};
  const response = legacy.response;
  const turn = parseTurn({ bot_response: response, ctype: legacy.ctype });
  const unreadable = turn.direction !== 'out' || (turn.body === null && turn.mediaUrl === null);
  const none: Repair = {
    change: false,
    body: null,
    kind: row.kind,
    legacyPatch: {},
    unreadable,
    shapes: unreadable ? elementShapes(response) : [],
  };
  if (unreadable) return none;
  const patch: Record<string, unknown> = {};
  for (const k of ['mediaUrl', 'interactive', 'location'] as const) {
    const v = turn.legacy[k];
    if (v !== undefined && JSON.stringify(v) !== JSON.stringify(legacy[k])) patch[k] = v;
  }
  const change = turn.body !== null || turn.kind !== row.kind || Object.keys(patch).length > 0;
  return { ...none, change, body: turn.body, kind: turn.kind, legacyPatch: patch, unreadable: false };
}

interface Cand {
  id: number;
  createdAt: string;
  conversationId: number;
  kind: string;
  meta: Record<string, unknown>;
}

const chunks = <T>(a: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

export async function chatReparse(o: ChatReparseOptions): Promise<void> {
  const owner = connect(o.ownerUrl, 'owner');
  const worker = connect(o.targetUrl, 'worker');
  try {
    const org = (
      await withPrivileged(owner.db, (tx) =>
        tx.execute(
          sql`SELECT id FROM organizations WHERE slug = ${o.orgSlug} AND settings #>> '{legacy,waboo,client}' = ${o.client}`,
        ),
      )
    ).rows[0] as { id: number | string } | undefined;
    if (!org) throw new Error(`CHATREPARSE_NO_ORG: no organization "${o.orgSlug}" made by this tool for ${o.client}`);
    const orgId = Number(org.id);

    const rows = (
      await withTenant(worker.db, { orgId }, (tx) =>
        tx.execute(sql`
          SELECT m.id, m.created_at::text AS created_at, m.conversation_id, m.kind, m.meta
          FROM messages m
          JOIN migration.id_map im ON im.source_client = ${o.client} AND im.source_collection = 'chathistory'
               AND im.target_table = 'messages' AND im.target_org_id = ${orgId} AND im.target_id = m.id
          WHERE m.org_id = ${orgId} AND m.direction = 'out' AND (m.body IS NULL OR btrim(m.body) = '')
            AND m.media_key IS NULL AND m.meta #> '{legacy,response}' IS NOT NULL
            AND m.meta #>> '{legacy,filesCopiedAt}' IS NULL
          ORDER BY m.conversation_id, m.seq`),
      )
    ).rows as unknown as Array<{ id: number | string; created_at: string; conversation_id: number | string; kind: string; meta: Record<string, unknown> }>;
    const cands: Cand[] = rows.map((r) => ({
      id: Number(r.id),
      createdAt: r.created_at,
      conversationId: Number(r.conversation_id),
      kind: r.kind,
      meta: r.meta,
    }));

    const plan = cands.map((c) => ({ c, r: repairOf(c) }));
    const todo = plan.filter((p) => p.r.change);
    const stuck = plan.filter((p) => p.r.unreadable);
    const same = plan.length - todo.length - stuck.length;
    const kinds = new Map<string, number>();
    for (const p of todo) kinds.set(`${p.c.kind}->${p.r.kind}`, (kinds.get(`${p.c.kind}->${p.r.kind}`) ?? 0) + 1);
    const shapes = new Map<string, number>();
    for (const p of stuck) for (const s of p.r.shapes) shapes.set(s, (shapes.get(s) ?? 0) + 1);

    o.log(`  chat  ${cands.length} outbound messages of this tool with an empty body: ${todo.length} ${o.apply ? 'to repair' : 'would change'}, ${same} already right, ${stuck.length} stay unreadable`);
    for (const [k, n] of [...kinds].sort()) o.log(`  chat  kind ${k}: ${n}`);
    o.log(`  chat  with a body ${todo.filter((p) => p.r.body !== null).length}, with a media url ${todo.filter((p) => p.r.legacyPatch.mediaUrl !== undefined).length}, with buttons kept ${todo.filter((p) => p.r.legacyPatch.interactive !== undefined).length}`);
    for (const [s, n] of [...shapes].sort((a, b) => b[1] - a[1])) o.log(`  chat  unreadable element keys [${s}]: ${n}`);
    if (!o.apply) {
      o.log('  chat  DRY RUN: nothing was written (add --apply --confirm-org-slug <slug>)');
      return;
    }

    const byConv = new Map<number, typeof todo>();
    for (const p of todo) byConv.set(p.c.conversationId, [...(byConv.get(p.c.conversationId) ?? []), p]);
    let messages = 0;
    let previews = 0;
    const touched: string[] = [];
    for (const part of chunks([...byConv.keys()], o.batch ?? 100)) {
      const res = await withTenant(worker.db, { orgId }, async (tx) => {
        let m = 0;
        const done = new Map<number, number>(); // message id -> 1
        for (const cid of part)
          for (const p of byConv.get(cid)!) {
            const patch = JSON.stringify(p.r.legacyPatch);
            const upd = await tx.execute(sql`
              UPDATE messages
              SET body = ${p.r.body}, kind = ${p.r.kind},
                  meta = jsonb_set(meta, '{legacy}', COALESCE(meta->'legacy', '{}'::jsonb) || ${patch}::jsonb)
              WHERE org_id = ${orgId} AND id = ${p.c.id} AND created_at = ${p.c.createdAt}::timestamptz
                AND (body IS NULL OR btrim(body) = '')
              RETURNING id`);
            if (upd.rows.length > 0) {
              m++;
              done.set(p.c.id, 1);
            }
          }
        let pv = 0;
        const uuids: string[] = [];
        const convs = (
          await tx.execute(sql`
            SELECT id, uuid::text AS uuid, preview, last_message_id FROM conversations
            WHERE org_id = ${orgId} AND id IN (${sql.join(part.map((id) => sql`${id}`), sql`, `)})`)
        ).rows as unknown as Array<{ id: number | string; uuid: string; preview: string | null; last_message_id: number | string | null }>;
        for (const cv of convs) {
          const last = byConv.get(Number(cv.id))?.find((p) => p.c.id === Number(cv.last_message_id) && done.has(p.c.id));
          if (!last) continue;
          const was = previewOf({ kind: last.c.kind, body: null });
          const now = previewOf({ kind: last.r.kind, body: last.r.body });
          if ((cv.preview ?? '') !== was || now === was) continue;
          const u = await tx.execute(sql`
            UPDATE conversations SET preview = ${now}
            WHERE org_id = ${orgId} AND id = ${Number(cv.id)} AND preview IS NOT DISTINCT FROM ${cv.preview}
            RETURNING id`);
          if (u.rows.length > 0) {
            pv++;
            uuids.push(cv.uuid);
          }
        }
        return { m, pv, uuids };
      });
      messages += res.m;
      previews += res.pv;
      touched.push(...res.uuids);
    }
    if (touched.length > 0) {
      const prev = (
        await worker.db.execute(
          sql`SELECT counts FROM migration.run_log WHERE source_client = ${o.client} AND collection = ${REPARSE_COLLECTION} AND step = ${REPARSE_STEP}`,
        )
      ).rows[0] as { counts?: { conversations?: string[] } } | undefined;
      const all = [...new Set([...(prev?.counts?.conversations ?? []), ...touched])];
      await worker.db.execute(sql`
        INSERT INTO migration.run_log (source_client, collection, step, run_id, last_key, state, counts)
        VALUES (${o.client}, ${REPARSE_COLLECTION}, ${REPARSE_STEP}, 'chat-reparse', 0, 'done', ${JSON.stringify({ conversations: all, at: new Date().toISOString() })}::jsonb)
        ON CONFLICT (source_client, collection, step) DO UPDATE SET counts = EXCLUDED.counts, updated_at = now()`);
    }
    o.log(`  chat  done: ${messages} message(s) repaired, ${previews} conversation preview(s) updated; ${stuck.length} stay unreadable`);
    o.log('  chat  next: run the files copy for iskm/rhythm (copy-files.cjs plan, then copy) to fetch the images under meta.legacy.mediaUrl');
  } finally {
    await worker.close();
    await owner.close();
  }
}

/** The set of conversation uuids chat-reparse touched (updated_at / row_version moved); the verifier expects exactly these to differ. */
export async function reparsedConversations(
  db: { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> },
  client: string,
): Promise<Set<string>> {
  const r = (
    await db.execute(
      sql`SELECT counts FROM migration.run_log WHERE source_client = ${client} AND collection = ${REPARSE_COLLECTION} AND step = ${REPARSE_STEP}`,
    )
  ).rows[0] as { counts?: { conversations?: string[] } } | undefined;
  return new Set(r?.counts?.conversations ?? []);
}
