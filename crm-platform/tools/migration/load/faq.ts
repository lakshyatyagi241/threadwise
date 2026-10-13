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
