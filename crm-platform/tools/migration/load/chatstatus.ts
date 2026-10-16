import { readManifest } from '../extract/manifest';
import type { Source } from '../extract/source';
import { resolveInbox, type InboxOptions } from '../inbox/config';
import { buildIndex } from '../transform/source-index';
import { connect, sql, withPrivileged, withTenant } from './db';
import { IdMap } from './engine';
import { planFor } from './inbox';

/**
 * chat-status: closes the conversations an EARLIER load wrote as open although Waboo has them closed. A thread's status is that of its
 * newest visitor_logs session (inbox/plan.ts); an earlier load read it from the chat turns only, which rarely carry it, so every
 * closed conversation of such a client came across open (Rhythm Watches: 59 of 59).
 * What changes: `conversations.status` open -> closed and `resolved_at` (the planner's value: the time of the thread's last message),
 * nothing else. Never the other way: a conversation that is closed in WaDesk stays closed, one that is open in Waboo stays as it is.
 * A conversation somebody resolved or reassigned in WaDesk (resolved_by / resolved_by_agent_id set) is never touched. conversations HAS
 * the touch trigger: each changed row gets updated_at = now() and row_version + 1; their uuids are recorded in migration.run_log
 * (_chat / chat_status) and reconcile expects exactly that. Idempotent. Dry run by default; counts only in the output.
 */
export interface ChatStatusOptions {
  client: string;
  orgSlug: string;
  targetUrl: string;
  ownerUrl: string;
  source: Source;
  dumpsDir: string;
  inbox?: InboxOptions;
  apply: boolean;
  batch?: number;
  log: (line: string) => void;
}

export const STATUS_STEP = 'chat_status';

/** Conversation uuids chat-status touched (updated_at / row_version moved); the verifier expects exactly these to differ. */
export async function statusChangedConversations(
  db: { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> },
  client: string,
): Promise<Set<string>> {
  const r = (
    await db.execute(
      sql`SELECT counts FROM migration.run_log WHERE source_client = ${client} AND collection = '_chat' AND step = ${STATUS_STEP}`,
    )
  ).rows[0] as { counts?: { conversations?: string[] } } | undefined;
  return new Set(r?.counts?.conversations ?? []);
}

export interface StatusCounts {
  todo: Array<{ id: number; uuid: string; resolvedAt: string | null }>;
  alreadyRight: number;
  keptOpenInWaboo: number;
  keptClosedInWaDesk: number;
  touchedByPerson: number;
  notPlanned: number;
}

/** Pure: which conversations get closed. Only open -> closed, only when nobody resolved or reassigned the row in WaDesk. */
export function classifyStatus(
  rows: Array<{
    id: number | string;
    uuid: string;
    status: string;
    resolved_by: number | string | null;
    resolved_by_agent_id: number | string | null;
  }>,
  want: Map<string, { status: 'open' | 'closed'; resolvedAt: string | null }>,
): StatusCounts {
  const out: StatusCounts = {
    todo: [],
    alreadyRight: 0,
    keptOpenInWaboo: 0,
    keptClosedInWaDesk: 0,
    touchedByPerson: 0,
    notPlanned: 0,
  };
  for (const r of rows) {
    const w = want.get(r.uuid);
    if (!w) {
      out.notPlanned++;
      continue;
    }
    if (r.status === w.status) {
      if (w.status === 'open') out.keptOpenInWaboo++;
      else out.alreadyRight++;
    } else if (r.status === 'closed') out.keptClosedInWaDesk++; // Waboo says open, WaDesk closed: never reopened
    else if (r.resolved_by !== null || r.resolved_by_agent_id !== null) out.touchedByPerson++;
    else out.todo.push({ id: Number(r.id), uuid: r.uuid, resolvedAt: w.resolvedAt });
  }
  return out;
}

export async function chatStatus(o: ChatStatusOptions): Promise<void> {
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
    if (!org)
      throw new Error(`CHATSTATUS_NO_ORG: no organization "${o.orgSlug}" made by this tool for ${o.client}`);
    const orgId = Number(org.id);
    if (!o.source.collections(o.client).includes('chathistory'))
      throw new Error(`CHATSTATUS_NO_DUMP: the dump of ${o.client} has no chathistory (ship the dumps first)`);
    const settings = resolveInbox(o.inbox, o.dumpsDir, o.client);
    const fallbackAt = readManifest(o.dumpsDir, o.client)?.generatedAt ?? new Date().toISOString();
    const idx = await buildIndex(o.source, o.client, fallbackAt);
    const idmap = new IdMap();
    await idmap.load(worker.db, o.client);
    const plan = await planFor({
      db: worker.db,
      orgId,
      client: o.client,
      source: o.source,
      fallbackAt,
      idmap,
      idx,
      settings,
    });

    const want = new Map<string, { status: 'open' | 'closed'; resolvedAt: string | null }>();
    for (const t of plan.threads.values()) want.set(t.uuid, { status: t.status, resolvedAt: t.resolvedAt });
    const rows = (
      await withTenant(worker.db, { orgId }, (tx) =>
        tx.execute(sql`
          SELECT id, uuid::text AS uuid, status, resolved_by, resolved_by_agent_id FROM conversations
          WHERE org_id = ${orgId} AND routing_meta #>> '{legacy,source}' = 'waboo'`),
      )
    ).rows as unknown as Array<{
      id: number | string;
      uuid: string;
      status: string;
      resolved_by: number | string | null;
      resolved_by_agent_id: number | string | null;
    }>;

    const c = classifyStatus(rows, want);
    o.log(
      `  status  ${rows.length} conversation(s) of this tool: ${c.alreadyRight} already closed as in Waboo, ${c.keptOpenInWaboo} open as in Waboo, ${c.todo.length} ${o.apply ? 'to close' : 'would be closed'}, ${c.touchedByPerson} left (resolved or reassigned in WaDesk), ${c.keptClosedInWaDesk} closed in WaDesk but open in Waboo (never reopened), ${c.notPlanned} not planned`,
    );
    if (!o.apply) {
      o.log('  status  DRY RUN: nothing was written (add --apply --confirm-org-slug <slug>)');
      return;
    }
    let done = 0;
    for (let i = 0; i < c.todo.length; i += o.batch ?? 200) {
      const part = c.todo.slice(i, i + (o.batch ?? 200));
      // the update and its run_log record are ONE transaction: reconcile never sees one without the other
      const got = await withTenant(worker.db, { orgId }, async (tx) => {
        const res = await tx.execute(sql`
          UPDATE conversations c SET status = 'closed', resolved_at = x.resolved_at::timestamptz
          FROM jsonb_to_recordset(${JSON.stringify(part.map((p) => ({ id: p.id, resolved_at: p.resolvedAt })))}::jsonb)
               AS x(id bigint, resolved_at text)
          WHERE c.org_id = ${orgId} AND c.id = x.id AND c.status = 'open'
            AND c.resolved_by IS NULL AND c.resolved_by_agent_id IS NULL
          RETURNING c.uuid::text AS uuid`);
        const uuids = (res.rows as Array<{ uuid: string }>).map((r) => r.uuid);
        if (uuids.length > 0)
          await tx.execute(sql`
            INSERT INTO migration.run_log AS rl (source_client, collection, step, run_id, last_key, state, counts)
            VALUES (${o.client}, '_chat', ${STATUS_STEP}, 'chat-status', 0, 'done', ${JSON.stringify({ conversations: uuids })}::jsonb)
            ON CONFLICT (source_client, collection, step) DO UPDATE SET
              counts = jsonb_build_object('conversations', (
                SELECT coalesce(jsonb_agg(DISTINCT u ORDER BY u), '[]'::jsonb)
                FROM jsonb_array_elements_text(coalesce(rl.counts->'conversations', '[]'::jsonb) || (EXCLUDED.counts->'conversations')) u)),
              updated_at = now()`);
        return uuids.length;
      });
      done += got;
    }
    o.log(`  status  done: ${done} conversation(s) closed`);
  } finally {
    await worker.close();
    await owner.close();
  }
}
