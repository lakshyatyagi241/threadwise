import { buildBroadcastPlan, type BroadcastPlan } from '../broadcast/plan';
import { resolveBroadcast, type BroadcastSettings } from '../broadcast/config';
import { indexTemplates, type TemplateIndex, type TemplateRow } from '../broadcast/template-link';
import { readManifest } from '../extract/manifest';
import { campaigns, recipients } from '../transform/broadcast';
import { sql, withTenant, type Database } from './db';
import type { Env } from './engine';

/**
 * The loader half of the broadcast step: pass 1 (the plan with the counters of every campaign) before the first campaign is inserted,
 * and the record of the options the run used. Nothing here writes a campaign or a recipient: the engine inserts them whole.
 */
export const BCAST_COLLECTION = '_bcast';

/** digits of contacts.normalized_phone -> how many contacts hold it and the lowest id: the fallback when a contact id does not resolve. */
export async function contactsByDigitsOf(
  db: Database,
  orgId: number,
): Promise<BroadcastPlan['contactsByDigits']> {
  const r = await withTenant(db, { orgId }, (tx) =>
    tx.execute(sql`
      SELECT regexp_replace(normalized_phone, '\\D', '', 'g') AS d, count(*)::int AS n, min(id) AS id
      FROM contacts WHERE org_id = ${orgId} AND normalized_phone IS NOT NULL GROUP BY 1`),
  );
  return new Map(
    (r.rows as Array<{ d: string; n: number; id: number | string }>).map((x) => [
      x.d,
      { n: Number(x.n), id: Number(x.id) },
    ]),
  );
}

/** The migrated templates of the organization (wa_templates) and the Waboo keys that point at them (migration.id_map), for the campaign -> template link. */
export async function templatesOf(db: Database, orgId: number, client: string): Promise<TemplateIndex> {
  const rows = await withTenant(db, { orgId }, async (tx) => ({
    t: await tx.execute(
      sql`SELECT id, template_name, language, meta_template_id FROM wa_templates WHERE org_id = ${orgId}`,
    ),
    k: await tx.execute(sql`
      SELECT source_key, target_id FROM migration.id_map
      WHERE source_client = ${client} AND source_collection = 'broadcast_templates' AND target_table = 'wa_templates'
        AND target_org_id = ${orgId}`),
  }));
  const tpl: TemplateRow[] = (
    rows.t.rows as Array<{ id: number | string; template_name: string; language: string; meta_template_id: string | null }>
  ).map((x) => ({ id: Number(x.id), name: x.template_name, language: x.language, metaId: x.meta_template_id }));
  return indexTemplates(
    tpl,
    (rows.k.rows as Array<{ source_key: string; target_id: number | string }>).map((x) => [x.source_key, Number(x.target_id)]),
  );
}

export const shasOf = (dumpsDir: string, client: string): string[] =>
  ['broadcasting', 'whatsapp_broadcasting_data'].map(
    (c) =>
      readManifest(dumpsDir, client)?.collections.find((x) => x.collection === c)?.sha256 ?? '-',
  );

export async function planBroadcast(a: {
  env: Pick<Env, 'source' | 'client' | 'db' | 'orgId' | 'dumpsDir'>;
  settings: BroadcastSettings;
}): Promise<BroadcastPlan> {
  const { env } = a;
  return buildBroadcastPlan({
    source: env.source,
    client: env.client,
    settings: a.settings,
    contactsByDigits: await contactsByDigitsOf(env.db, env.orgId),
    templates: await templatesOf(env.db, env.orgId, env.client),
    shas: shasOf(env.dumpsDir, env.client),
  });
}

export async function prepareBroadcast(env: Env): Promise<void> {
  if (env.bcast) return;
  const settings = env.bcastSettings ?? resolveBroadcast();
  const plan = await planBroadcast({ env, settings });
  env.bcast = plan;
  await env.db.execute(sql`
    INSERT INTO migration.run_log (source_client, collection, step, run_id, last_key, state, counts)
    VALUES (${env.client}, ${BCAST_COLLECTION}, 'options', ${env.runId}, 0, 'done', ${JSON.stringify(settings)}::jsonb)
    ON CONFLICT (source_client, collection, step) DO UPDATE SET counts = EXCLUDED.counts, updated_at = now()`);
  env.log(
    `  broadcasts         ${plan.campaigns.size} campaign key(s); plan ${JSON.stringify(plan.tally)}`,
  );
  env.log(`  broadcasts         ${new Set([...plan.templates.byKey.values()].map((t) => t.id)).size} migrated template(s) to link campaigns to`);
}

/** Wires the loader hooks into the shared step specs (the specs are also used by the verifier, which needs none of this). */
export function installBroadcastLoader(): void {
  for (const spec of [campaigns, recipients]) {
    spec.prepare = prepareBroadcast;
    spec.fingerprint = (env) => env.bcast?.fingerprint ?? '';
  }
}
