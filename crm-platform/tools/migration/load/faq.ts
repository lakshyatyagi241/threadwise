import { sql, type TenantTx } from './db';

/**
 * The loader half of the faq_knowledge step. faq_settings is keyed by (org_id, flow_id) and has no uuid, so the engine cannot insert it:
 * the step's afterInsert hook (load/flows.ts) calls this with the owner flows of the FAQs it just inserted. SAFETY: enabled is false,
 * always; a settings row that exists (a person already saved the screen) is never touched, never switched on or off. The other columns
 * take the table defaults (threshold 0.450, min_margin 0, log_queries true, verify off).
 */
export async function writeFaqSettings(
  tx: TenantTx,
  orgId: number,
  flowIds: number[],
): Promise<number> {
  if (flowIds.length === 0) return 0;
  const res = await tx.execute(sql`
    INSERT INTO faq_settings (org_id, flow_id, enabled)
    SELECT ${orgId}::bigint, f::bigint, false
    FROM jsonb_array_elements_text(${JSON.stringify(flowIds)}::jsonb) AS f
    ON CONFLICT (org_id, flow_id) DO NOTHING
    RETURNING flow_id`);
  return res.rows.length;
}

/**
 * flow-state companion: a Waboo FAQ answers whenever its bot is live (there is no per-FAQ switch at the source), so the FAQs of a flow
 * that flow-state arms are switched on with it: faqs.status 'active' and faq_settings.enabled true. Only a FAQ this tool made
 * (migration.id_map, collection faq_knowledge) that is still paused AND still at the row_version the tool left is touched, so a FAQ a
 * person paused or edited after the load keeps their choice. Returns what it changed (or would change when `apply` is false).
 */
export async function armFaqs(
  tx: TenantTx,
  o: { orgId: number; client: string; flowIds: number[]; apply: boolean },
): Promise<{ faqs: number; settings: number }> {
  if (o.flowIds.length === 0) return { faqs: 0, settings: 0 };
  const ids = JSON.stringify(o.flowIds);
  const owned = sql`
    SELECT f.id FROM faqs f
    JOIN migration.id_map m ON m.source_client = ${o.client} AND m.target_table = 'faqs' AND m.target_org_id = ${o.orgId}
         AND m.target_id = f.id AND m.source_collection = 'faq_knowledge'
    WHERE f.org_id = ${o.orgId} AND f.status = 'paused' AND f.row_version = coalesce(m.written_version, 1)
      AND f.owner_flow_id IN (SELECT jsonb_array_elements_text(${ids}::jsonb)::bigint)`;
  if (!o.apply) {
    const n = (await tx.execute(sql`SELECT count(*)::int AS n FROM (${owned}) x`)).rows[0] as { n: number };
    const s = (
      await tx.execute(sql`SELECT count(*)::int AS n FROM faq_settings WHERE org_id = ${o.orgId} AND NOT enabled
        AND flow_id IN (SELECT jsonb_array_elements_text(${ids}::jsonb)::bigint)`)
    ).rows[0] as { n: number };
    return { faqs: n.n, settings: s.n };
  }
  const f = await tx.execute(sql`
    UPDATE faqs SET status = 'active' WHERE org_id = ${o.orgId} AND id IN (SELECT id FROM (${owned}) x) RETURNING id`);
  const s = await tx.execute(sql`
    UPDATE faq_settings SET enabled = true WHERE org_id = ${o.orgId} AND NOT enabled
      AND flow_id IN (SELECT jsonb_array_elements_text(${ids}::jsonb)::bigint) RETURNING flow_id`);
  return { faqs: f.rows.length, settings: s.rows.length };
}
