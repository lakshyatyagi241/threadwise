import { NdjsonDirSource } from '../extract/source';
import { docKeys, toDate, type Doc } from '../util';
import { connect, sql, withPrivileged, withTenant } from './db';

/**
 * flow-state: the loader imports every flow unpublished and inactive (so a load can never arm anything). This separate, explicit step
 * gives the flows the state they have in Waboo, and nothing else:
 *   - an automation is live when automation_metadata.status = 'published' AND is_active = true;
 *   - a chatbot flow is live when the bot is active, a version of it is published at the source, and that version was converted
 *     (no NO_PUBLISHED_VERSION / VERSION_EMPTY note): a bot whose published version could not be used stays a draft.
 * Live = is_published true, is_active true, published_at = the source publish date. No audit row, no outbox event (like every other
 * write of this tool). REFUSED while a WhatsApp channel of the organization is connected: a live trigger plus a connected number
 * would answer customers. What it armed is recorded in migration.run_log (collection _flows, step flow_state) so the verifier
 * expects exactly that. Dry run by default; idempotent.
 */
export interface FlowStateOptions {
  dumpsDir: string;
  client: string;
  orgSlug: string;
  targetUrl: string;
  ownerUrl: string;
  apply: boolean;
  /** ONLY the cutover command sets this: it connects the channel first and arms the flows as its last step. */
  allowConnected?: boolean;
  log: (line: string) => void;
}

export const FLOW_STATE_COLLECTION = '_flows';
export const FLOW_STATE_STEP = 'flow_state';
const AUTOMATION_CATEGORY = 'Waboo automation';
const CHATBOT_CATEGORY = 'Waboo chatbot';

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

async function collect(it: AsyncIterable<Doc>): Promise<Doc[]> {
  const out: Doc[] = [];
  for await (const d of it) out.push(d);
  return out;
}

interface FlowRow {
  id: number | string;
  uuid: string;
  flow_name: string;
  category: string;
  is_published: boolean;
  is_active: boolean;
  source_key: string | null;
}

/** The flows this step armed for a client (uuids), as recorded in migration.run_log; empty when the step never ran. The verifier expects exactly these to be live. */
export async function armedFlowUuids(
  db: { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> },
  client: string,
): Promise<Set<string>> {
  const r = (
    await db.execute(
      sql`SELECT counts FROM migration.run_log WHERE source_client = ${client} AND collection = ${FLOW_STATE_COLLECTION} AND step = ${FLOW_STATE_STEP}`,
    )
  ).rows[0] as { counts?: { armed?: string[] } } | undefined;
  return new Set(r?.counts?.armed ?? []);
}

export async function flowState(o: FlowStateOptions): Promise<void> {
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
    if (!org) throw new Error(`FLOWSTATE_NO_ORG: no organization "${o.orgSlug}" made by this tool for ${o.client}`);
    const orgId = Number(org.id);

    const src = new NdjsonDirSource(o.dumpsDir);
    const [autos, bots, versions] = await Promise.all(
      ['automation_metadata', 'chatbots', 'bot_flow_version'].map((c) =>
        src.collections(o.client).includes(c) ? collect(src.read(o.client, c)) : Promise.resolve([] as Doc[]),
      ),
    );

    const rows = (
      await withTenant(worker.db, { orgId }, (tx) =>
        tx.execute(sql`
          SELECT f.id, f.uuid::text AS uuid, f.flow_name, f.category, f.is_published, f.is_active, m.source_key
          FROM flows f
          LEFT JOIN migration.id_map m ON m.source_client = ${o.client} AND m.target_table = 'flows' AND m.target_org_id = ${orgId}
               AND m.target_id = f.id AND m.source_collection IN ('automation_metadata', 'flow_bots')
          WHERE f.org_id = ${orgId} AND f.category IN (${AUTOMATION_CATEGORY}, ${CHATBOT_CATEGORY})
          ORDER BY f.id`),
      )
    ).rows as unknown as FlowRow[];

    const notes = new Set(
      (
        await worker.db.execute(
          sql`SELECT split_part(source_key, '#', 1) AS source_key FROM migration.quarantine WHERE source_client = ${o.client} AND collection = 'flow_bots' AND reason_code IN ('NO_PUBLISHED_VERSION', 'VERSION_EMPTY')`,
        )
      ).rows.map((r) => `${(r as { source_key: string }).source_key}`),
    );

    // the id map holds one or two source keys per flow (the document id and an alias): judge each flow once, by any of its keys
    const byFlow = new Map<string, { row: FlowRow; keys: Set<string> }>();
    for (const r of rows) {
      const cur = byFlow.get(r.uuid) ?? { row: r, keys: new Set<string>() };
      if (r.source_key) cur.keys.add(r.source_key);
      byFlow.set(r.uuid, cur);
    }
    const plan: Array<{ row: FlowRow; live: boolean; why: string; at: string | null }> = [];
    for (const { row: r, keys } of byFlow.values()) {
      if (keys.size === 0) {
        plan.push({ row: r, live: false, why: 'no source record (not made by this tool)', at: null });
        continue;
      }
      if (r.category === AUTOMATION_CATEGORY) {
        const d = autos.find((x) => docKeys(x).some((k) => keys.has(k.key)));
        const live = !!d && text(d.status).toLowerCase() === 'published' && d.is_active === true;
        const at = d ? (toDate(d.publishedOn)?.toISOString() ?? null) : null;
        plan.push({ row: r, live, why: live ? 'published and active at the source' : `source status "${text(d?.status) || 'unknown'}"`, at });
      } else {
        const bot = bots.find((x) => [text(x.id), text(x.bot_id), ...docKeys(x).map((k) => k.key)].some((k) => k !== '' && keys.has(k)));
        const botIds = new Set([text(bot?.id), text(bot?.bot_id)].filter(Boolean));
        const pub = versions
          .filter((v) => botIds.has(text(v.botid)) && text(v.status).toLowerCase() === 'published')
          .sort((a, b) => (toDate(b.publishedAt)?.getTime() ?? 0) - (toDate(a.publishedAt)?.getTime() ?? 0))[0];
        const converted = ![...keys].some((k) => notes.has(k));
        const live = !!bot && bot.is_active !== false && !!pub && converted;
        plan.push({
          row: r,
          live,
          why: live ? 'bot active, published version converted' : !pub ? 'no published version at the source' : !converted ? 'the published version could not be converted (note kept)' : 'bot not active',
          at: pub ? (toDate(pub.publishedAt)?.toISOString() ?? null) : null,
        });
      }
    }
    for (const p of plan)
      o.log(`  flow  ${p.live ? 'LIVE ' : 'draft'}  ${p.row.flow_name.slice(0, 42).padEnd(42)} ${p.why}`);
    const todo = plan.filter((p) => p.live && !(p.row.is_published && p.row.is_active));
    o.log(`  flow  ${plan.filter((p) => p.live).length} live at the source, ${todo.length} to change, ${plan.filter((p) => !p.live).length} stay draft`);
    if (!o.apply) {
      o.log('  flow  DRY RUN: nothing was written (add --apply --confirm-org-slug <slug>)');
      return;
    }

    const connected = Number(
      (
        (
          await withTenant(worker.db, { orgId }, (tx) =>
            tx.execute(sql`SELECT count(*)::int AS n FROM channels WHERE org_id = ${orgId} AND status = 'connected'`),
          )
        ).rows[0] as { n: number }
      ).n,
    );
    if (connected > 0 && !o.allowConnected)
      throw new Error(`FLOWSTATE_CHANNEL_CONNECTED: ${connected} WhatsApp channel(s) are connected: a live flow would answer customers. Nothing was written`);

    for (const p of todo)
      await withTenant(worker.db, { orgId }, (tx) =>
        tx.execute(sql`
          UPDATE flows SET is_published = true, is_active = true, published_at = coalesce(${p.at}::timestamptz, now()), row_version = row_version + 1
          WHERE org_id = ${orgId} AND id = ${Number(p.row.id)}`),
      );
    const armed = plan.filter((p) => p.live).map((p) => p.row.uuid);
    await worker.db.execute(sql`
      INSERT INTO migration.run_log (source_client, collection, step, run_id, last_key, state, counts)
      VALUES (${o.client}, ${FLOW_STATE_COLLECTION}, ${FLOW_STATE_STEP}, 'flow-state', 0, 'done', ${JSON.stringify({ armed, at: new Date().toISOString() })}::jsonb)
      ON CONFLICT (source_client, collection, step) DO UPDATE SET counts = EXCLUDED.counts, updated_at = now()`);
    o.log(`  flow  done: ${todo.length} flow(s) published and active as at the source; ${armed.length} recorded for the verifier`);
  } finally {
    await worker.close();
    await owner.close();
  }
}
