import { readManifest } from '../extract/manifest';
import type { Source } from '../extract/source';
import { resolveInbox, type InboxOptions } from '../inbox/config';
import { buildIndex } from '../transform/source-index';
import { connect, sql, withPrivileged, withTenant } from './db';
import { IdMap } from './engine';
import { planFor } from './inbox';

/**
 * chat-relink: gives the conversations an EARLIER load wrote with `contact_id` NULL (the contact was not migrated yet, or its phone
 * matched nothing then) the contact the planner resolves NOW, by the same rule as a fresh load (inbox/plan.ts): the newest turn's
 * user.contact_id / context.contact_id through migration.id_map, else the single contact with the thread's phone digits. Several
 * contacts with that number, or none: the conversation stays NULL (counted). A conversation that already has a contact is never touched
 * (counted "differs" when the rules would pick another one).
 * What changes: `conversations.contact_id` and nothing else. title, peer_name and preview come from the turns (visitor name, last message),
 * never from the contact, so a fresh load would not write anything else differently. conversations HAS the touch trigger: each relinked
 * row gets updated_at = now() and row_version + 1; their uuids are recorded in migration.run_log (_chat / chat_relink) and reconcile
 * expects exactly that. Idempotent: a linked row is not picked again. Dry run by default; counts only in the output.
 */
export interface ChatRelinkOptions {
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

export const RELINK_STEP = 'chat_relink';

/** Conversation uuids chat-relink touched (updated_at / row_version moved); the verifier expects exactly these to differ. */
export async function relinkedConversations(
  db: { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> },
  client: string,
): Promise<Set<string>> {
  const r = (
    await db.execute(
      sql`SELECT counts FROM migration.run_log WHERE source_client = ${client} AND collection = '_chat' AND step = ${RELINK_STEP}`,
    )
  ).rows[0] as { counts?: { conversations?: string[] } } | undefined;
  return new Set(r?.counts?.conversations ?? []);
}

export interface RelinkCounts {
  todo: Array<{ id: number; uuid: string; contact: number }>;
  linked: number;
  differs: number;
  stillNull: number;
  notPlanned: number;
}

/** Pure: which conversations get which contact. A non-null link is never a candidate; NULL + a resolved contact is. */
export function classifyRelink(
  rows: Array<{ id: number | string; uuid: string; contact_id: number | string | null }>,
  want: Map<string, number | null>,
): RelinkCounts {
  const out: RelinkCounts = { todo: [], linked: 0, differs: 0, stillNull: 0, notPlanned: 0 };
  for (const r of rows) {
    if (!want.has(r.uuid)) {
      out.notPlanned++;
      continue;
    }
    const w = want.get(r.uuid) ?? null;
    if (r.contact_id !== null) {
      if (w !== null && w !== Number(r.contact_id)) out.differs++;
      else out.linked++;
    } else if (w === null) out.stillNull++;
    else out.todo.push({ id: Number(r.id), uuid: r.uuid, contact: w });
  }
  return out;
}

export async function chatRelink(o: ChatRelinkOptions): Promise<void> {
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
      throw new Error(`CHATRELINK_NO_ORG: no organization "${o.orgSlug}" made by this tool for ${o.client}`);
    const orgId = Number(org.id);
    if (!o.source.collections(o.client).includes('chathistory'))
      throw new Error(`CHATRELINK_NO_DUMP: the dump of ${o.client} has no chathistory (ship the dumps first)`);
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

    const want = new Map<string, number | null>(); // conversation uuid -> contact the planner resolves now
    for (const t of plan.threads.values()) want.set(t.uuid, t.contactId);
    const rows = (
      await withTenant(worker.db, { orgId }, (tx) =>
        tx.execute(sql`
          SELECT id, uuid::text AS uuid, contact_id FROM conversations
          WHERE org_id = ${orgId} AND routing_meta #>> '{legacy,source}' = 'waboo'`),
      )
    ).rows as unknown as Array<{ id: number | string; uuid: string; contact_id: number | string | null }>;

    const { todo, linked, differs, stillNull, notPlanned } = classifyRelink(rows, want);
    o.log(
      `  relink  ${rows.length} conversation(s) of this tool: ${linked} already linked, ${todo.length} ${o.apply ? 'to link' : 'would be linked'}, ${stillNull} stay NULL (no single contact), ${differs} linked to another contact than the rules pick now (left), ${notPlanned} not in the plan (left)`,
    );
    if (!o.apply) {
      o.log('  relink  DRY RUN: nothing was written (add --apply --confirm-org-slug <slug>)');
      return;
    }
    let done = 0;
    for (let i = 0; i < todo.length; i += o.batch ?? 200) {
      const part = todo.slice(i, i + (o.batch ?? 200));
      // the update and its run_log record are ONE transaction: reconcile never sees one without the other
      const got = await withTenant(worker.db, { orgId }, async (tx) => {
        const res = await tx.execute(sql`
          UPDATE conversations c SET contact_id = x.contact
          FROM jsonb_to_recordset(${JSON.stringify(part)}::jsonb) AS x(id bigint, contact bigint)
          WHERE c.org_id = ${orgId} AND c.id = x.id AND c.contact_id IS NULL
            AND EXISTS (SELECT 1 FROM contacts k WHERE k.org_id = c.org_id AND k.id = x.contact)
          RETURNING c.uuid::text AS uuid`);
        const uuids = (res.rows as Array<{ uuid: string }>).map((r) => r.uuid);
        if (uuids.length > 0)
          await tx.execute(sql`
            INSERT INTO migration.run_log AS rl (source_client, collection, step, run_id, last_key, state, counts)
            VALUES (${o.client}, '_chat', ${RELINK_STEP}, 'chat-relink', 0, 'done', ${JSON.stringify({ conversations: uuids })}::jsonb)
            ON CONFLICT (source_client, collection, step) DO UPDATE SET
              counts = jsonb_build_object('conversations', (
                SELECT coalesce(jsonb_agg(DISTINCT u ORDER BY u), '[]'::jsonb)
                FROM jsonb_array_elements_text(coalesce(rl.counts->'conversations', '[]'::jsonb) || (EXCLUDED.counts->'conversations')) u)),
              updated_at = now()`);
        return uuids.length;
      });
      done += got;
    }
    o.log(`  relink  done: ${done} conversation(s) linked`);
  } finally {
    await worker.close();
    await owner.close();
  }
}
