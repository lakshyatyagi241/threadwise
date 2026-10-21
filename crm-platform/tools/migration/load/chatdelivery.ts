import type { Source } from '../extract/source';
import { isNonBroadcast } from '../credits/rules';
import { classifyDelivery, mergeReceipts, receiptOf, type Receipt } from '../inbox/delivery';
import { connect, sql, withPrivileged, withTenant } from './db';

/**
 * chat-delivery: gives the outbound messages an EARLIER load wrote `sent` the delivery state Waboo had (delivered / read / failed), from
 * the billing log `whatsapp_broadcasting_data` (inbox/delivery.ts). The chat history has no receipt, so the loader leaves every outbound
 * turn `sent`; the dashboard then cannot tell a message that was only sent from one that was delivered.
 * Which rows: messages of ONE organization that this tool loaded (migration.id_map, collection chathistory), outbound, with a
 * provider_message_id that matches a billing-log row (not a broadcast recipient: those have their own state on the campaign).
 * BLOCKED: the dumps checked carry no outbound provider id (chathistory.meta_msg_id is empty or absent), so no row matches; the join
 * key is not verified (README section 9, "Delivery state"). The run then logs CHATDELIVERY_NO_KEY and moves nothing.
 * What changes: `status`, `delivered_at`, `read_at` (and failure_code / failure_reason for a failed one), only FORWARD from `sent`; a
 * message the live app already moved is never touched. `messages` has no touch trigger. Never `queued`, so nothing is re-dispatched.
 * The touched message uuids are recorded in migration.run_log (_chat / chat_delivery) and reconcile expects exactly those to differ.
 * Idempotent. Dry run by default; counts only in the output.
 */
export interface ChatDeliveryOptions {
  client: string;
  orgSlug: string;
  targetUrl: string;
  ownerUrl: string;
  source: Source;
  apply: boolean;
  batch?: number;
  log: (line: string) => void;
}

export const DELIVERY_STEP = 'chat_delivery';

/** Message uuids chat-delivery touched; the verifier lets exactly these differ from `sent`. */
export async function deliveryChangedMessages(
  db: { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> },
  client: string,
): Promise<Set<string>> {
  const r = (
    await db.execute(
      sql`SELECT counts FROM migration.run_log WHERE source_client = ${client} AND collection = '_chat' AND step = ${DELIVERY_STEP}`,
    )
  ).rows[0] as { counts?: { messages?: string[] } } | undefined;
  return new Set(r?.counts?.messages ?? []);
}

export async function chatDelivery(o: ChatDeliveryOptions): Promise<void> {
  if (!o.source.collections(o.client).includes('whatsapp_broadcasting_data'))
    throw new Error(`CHATDELIVERY_NO_DUMP: the dump of ${o.client} has no whatsapp_broadcasting_data (ship the dumps first)`);
  const want = new Map<string, Receipt>();
  let logRows = 0;
  for await (const doc of o.source.read(o.client, 'whatsapp_broadcasting_data')) {
    if (!isNonBroadcast(doc)) continue;
    const r = receiptOf(doc);
    if (!r) continue;
    logRows++;
    const prev = want.get(r.wamid);
    want.set(r.wamid, prev ? mergeReceipts(prev, r) : r);
  }

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
      throw new Error(`CHATDELIVERY_NO_ORG: no organization "${o.orgSlug}" made by this tool for ${o.client}`);
    const orgId = Number(org.id);

    const rows = (
      await withTenant(worker.db, { orgId }, (tx) =>
        tx.execute(sql`
          SELECT m.id, m.uuid::text AS uuid, m.status, m.provider_message_id AS wamid, m.created_at::text AS created_at
          FROM messages m
          JOIN migration.id_map im ON im.source_client = ${o.client} AND im.source_collection = 'chathistory'
               AND im.target_table = 'messages' AND im.target_org_id = ${orgId} AND im.target_id = m.id
          WHERE m.org_id = ${orgId} AND m.direction = 'out' AND m.provider_message_id IS NOT NULL`),
      )
    ).rows as unknown as Array<{ id: number | string; uuid: string; status: string; wamid: string; created_at: string }>;
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    const c = classifyDelivery(rows, want, (r) => (r as (typeof rows)[number]).wamid);
    if (rows.length === 0 && logRows > 0)
      o.log(
        `  delivery  CHATDELIVERY_NO_KEY: ${logRows} receipt(s) in the billing log, but no loaded outbound message has a provider id (chathistory.meta_msg_id is empty or absent in this dump): nothing can match, see README "Delivery state"`,
      );
    const by = (s: string): number => c.todo.filter((t) => t.receipt.status === s).length;
    o.log(
      `  delivery  ${logRows} receipt(s) in the billing log, ${rows.length} outbound message(s) of this tool with a provider id: ${c.todo.length} ${o.apply ? 'to move' : 'would move'} (delivered ${by('delivered')}, read ${by('read')}, failed ${by('failed')}), ${c.alreadyRight} already right, ${c.kept} moved by the app (kept), ${c.noReceipt} with no receipt`,
    );
    if (!o.apply) {
      o.log('  delivery  DRY RUN: nothing was written (add --apply --confirm-org-slug <slug>)');
      return;
    }
    let done = 0;
    for (let i = 0; i < c.todo.length; i += o.batch ?? 200) {
      const part = c.todo.slice(i, i + (o.batch ?? 200));
      // the update and its run_log record are ONE transaction: reconcile never sees one without the other
      done += await withTenant(worker.db, { orgId }, async (tx) => {
        const uuids: string[] = [];
        for (const t of part) {
          const m = byId.get(String(t.id))!;
          const r = t.receipt;
          const res = await tx.execute(sql`
            UPDATE messages SET status = ${r.status}, delivered_at = ${r.deliveredAt}::timestamptz, read_at = ${r.readAt}::timestamptz,
                   failure_code = ${r.failureCode}, failure_reason = ${r.failureReason}
            WHERE org_id = ${orgId} AND id = ${t.id} AND created_at = ${m.created_at}::timestamptz AND status = 'sent'
            RETURNING uuid::text AS uuid`);
          for (const x of res.rows as Array<{ uuid: string }>) uuids.push(x.uuid);
        }
        if (uuids.length > 0)
          await tx.execute(sql`
            INSERT INTO migration.run_log AS rl (source_client, collection, step, run_id, last_key, state, counts)
            VALUES (${o.client}, '_chat', ${DELIVERY_STEP}, 'chat-delivery', 0, 'done', ${JSON.stringify({ messages: uuids })}::jsonb)
            ON CONFLICT (source_client, collection, step) DO UPDATE SET
              counts = jsonb_build_object('messages', (
                SELECT coalesce(jsonb_agg(DISTINCT u ORDER BY u), '[]'::jsonb)
                FROM jsonb_array_elements_text(coalesce(rl.counts->'messages', '[]'::jsonb) || (EXCLUDED.counts->'messages')) u)),
              updated_at = now()`);
        return uuids.length;
      });
    }
    o.log(`  delivery  done: ${done} message(s) moved on`);
  } finally {
    await worker.close();
    await owner.close();
  }
}
