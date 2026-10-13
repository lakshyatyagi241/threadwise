import { rowUuid } from '../load/engine';
import { sql, withTenant, type Database } from '../load/db';
import type { Outcome } from '../transform/types';

/**
 * The verifier of the faq_knowledge step, for what the generic row-by-row check cannot see: faq_variations (no uuid, hangs off its FAQ)
 * and faq_settings (keyed by flow, no uuid). The faqs rows themselves are compared column by column by reconcile/index.ts.
 *   - every loaded FAQ carries exactly the variations (text + source) its document says, no more, no fewer
 *   - SAFETY, in SQL: no FAQ of the organization is anything but paused, no flow switch is on, no variation holds a vector or is
 *     anything but pending, none was tried: the tool copies no vector and makes no call (these checks are off under --allow-extra-rows,
 *     because the application's worker legitimately settles variations and people enable FAQs after the cutover)
 *   - every flow that owns an FAQ has its faq_settings row, and the tables hold nothing the source does not account for
 */
interface Args {
  db: Database;
  orgId: number;
  client: string;
  items: Array<{ base: string; outcome: Extract<Outcome, { kind: 'rows' }> }>;
  allowExtraRows: boolean;
  alarm: (m: string) => void;
}

export async function verifyFaq(a: Args): Promise<void> {
  const { db, orgId, client, alarm } = a;
  const want = new Map<string, string[]>(); // faq uuid -> sorted "source NUL text"
  const owners = new Set<number>();
  let wantVariations = 0;
  for (const it of a.items) {
    const faq = it.outcome.rows.find((r) => r.table === 'faqs');
    if (!faq) continue;
    const vars = it.outcome.rows
      .filter((r) => r.table === 'faq_variations')
      .map((r) => `${String(r.row.source)}\u0000${String(r.row.text)}`)
      .sort();
    want.set(rowUuid(client, 'faq_knowledge', it.base, faq.sub), vars);
    owners.add(Number(faq.row.owner_flow_id));
    wantVariations += vars.length;
  }

  await withTenant(db, { orgId }, async (tx) => {
    const got = new Map<string, string[]>();
    const unsafe: string[] = [];
    if (want.size > 0) {
      const r = await tx.execute(sql`
        SELECT f.uuid::text AS uuid, f.status, v.text, v.source, v.embed_state, v.embedding IS NOT NULL AS has_vector,
               v.embedding_model, v.embed_attempts
        FROM faqs f LEFT JOIN faq_variations v ON v.org_id = f.org_id AND v.faq_id = f.id
        WHERE f.org_id = ${orgId} AND f.uuid IN (SELECT jsonb_array_elements_text(${JSON.stringify([...want.keys()])}::jsonb)::uuid)`);
      for (const x of r.rows as Array<{
        uuid: string;
        status: string;
        text: string | null;
        source: string | null;
        embed_state: string | null;
        has_vector: boolean | null;
        embedding_model: string | null;
        embed_attempts: number | null;
      }>) {
        const list = got.get(x.uuid) ?? [];
        got.set(x.uuid, list);
        if (x.text === null) continue;
        list.push(`${x.source}\u0000${x.text}`);
        if (
          !a.allowExtraRows &&
          (x.embed_state !== 'pending' ||
            x.has_vector ||
            x.embedding_model !== null ||
            Number(x.embed_attempts) !== 0)
        )
          unsafe.push(`a variation of FAQ ${x.uuid.slice(0, 8)} is not pending, or holds a vector or an attempt`);
        if (!a.allowExtraRows && x.status !== 'paused')
          unsafe.push(`FAQ ${x.uuid.slice(0, 8)} is ${x.status}, not paused`);
      }
    }
    for (const [uuid, vars] of want) {
      const have = (got.get(uuid) ?? []).sort();
      if (!got.has(uuid)) continue; // TARGET_MISSING is the generic check's finding
      if (have.join('\u0001') !== vars.join('\u0001'))
        alarm(
          `FAQ_VARIATIONS_MISMATCH: FAQ ${uuid.slice(0, 8)} should hold ${vars.length} variation(s) and holds ${have.length} (texts or sources differ)`,
        );
    }
    for (const m of [...new Set(unsafe)].slice(0, 20)) alarm(`FAQ_SAFETY: ${m}`);

    // every owner flow has a settings row; a person who already saved the screen keeps their switch
    const owned = [...owners];
    if (owned.length > 0) {
      const s = await tx.execute(sql`
        SELECT flow_id, enabled FROM faq_settings
        WHERE org_id = ${orgId} AND flow_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(owned)}::jsonb)::bigint)`);
      const rows = s.rows as Array<{ flow_id: number | string; enabled: boolean }>;
      const have = new Set(rows.map((x) => Number(x.flow_id)));
      const missing = owned.filter((f) => !have.has(f)).length;
      if (missing > 0) alarm(`FAQ_SETTINGS_MISSING: ${missing} flow(s) own a migrated FAQ and have no faq_settings row`);
      if (!a.allowExtraRows && rows.some((x) => x.enabled))
        alarm('FAQ_SAFETY: a faq_settings row of a migrated flow is enabled (the tool never switches FAQ answering on)');
    }

    if (!a.allowExtraRows) {
      const t = (
        await tx.execute(sql`
          SELECT (SELECT count(*) FROM faq_variations WHERE org_id = ${orgId})::int AS variations,
                 (SELECT count(*) FROM faq_settings WHERE org_id = ${orgId})::int AS settings,
                 (SELECT count(*) FROM faq_settings WHERE org_id = ${orgId} AND enabled)::int AS enabled,
                 (SELECT count(*) FROM faqs WHERE org_id = ${orgId} AND status <> 'paused')::int AS active,
                 (SELECT count(*) FROM faq_match_logs WHERE org_id = ${orgId})::int AS logs`)
      ).rows[0] as { variations: number; settings: number; enabled: number; active: number; logs: number };
      if (t.variations !== wantVariations)
        alarm(`EXTRA_ROWS: faq_variations holds ${t.variations} row(s), the source accounts for ${wantVariations}`);
      if (t.settings !== owners.size)
        alarm(`EXTRA_ROWS: faq_settings holds ${t.settings} row(s), the source accounts for ${owners.size}`);
      if (t.enabled > 0) alarm(`FAQ_SAFETY: ${t.enabled} faq_settings row(s) are enabled`);
      if (t.active > 0) alarm(`FAQ_SAFETY: ${t.active} FAQ(s) are not paused`);
      if (t.logs > 0) alarm(`EXTRA_ROWS: faq_match_logs holds ${t.logs} row(s); the migration writes none`);
    }
  });
}
