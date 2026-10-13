import { buildBroadcastPlan } from '../broadcast/plan';
import { resolveBroadcast, type BroadcastOptions } from '../broadcast/config';
import { linkTemplate, type LinkHow, type UnlinkedWhy } from '../broadcast/template-link';
import type { Source } from '../extract/source';
import { primaryKey } from '../util';
import { templatesOf } from './broadcast';
import { connect, sql, withPrivileged, withTenant } from './db';
import { writeQuarantine } from './engine';

/**
 * campaign-link: gives the campaigns an EARLIER load wrote with `template_id` NULL (the templates were not migrated yet) their
 * wa_templates row. Same exact rules as a fresh load (broadcast/template-link.ts: the Waboo template id, confirmed by the name and by the
 * Meta id of the recipients; the Meta id; the name only when nothing else is known; anything unclear stays NULL and is counted).
 *
 * Which rows: wpcampaigns of ONE organization that this tool loaded (migration.id_map, collection broadcasting) AND `template_id IS NULL`.
 * A campaign that already has a template is never touched (counted: "already linked", and "differs" when the rules would pick another).
 * What changes: `wpcampaigns.template_id` and nothing else. `template_id_a/_b` stay NULL (no A/B test), no status, counter or flag moves,
 * so nothing can send. wpcampaigns HAS the touch trigger (migration 20261001103000): each linked row gets updated_at = now() and
 * row_version + 1; their uuids are recorded in migration.run_log (_bcast / campaign_link) and reconcile expects exactly that. The
 * foreign key (org_id, template_id) -> wa_templates is satisfied by construction (the id comes from wa_templates of the same org).
 * The campaign's quarantine log follows: the TEMPLATE_UNLINKED row of a linked campaign is removed; a link found by Meta id or name
 * (not by the template id) gets TEMPLATE_LINKED_VIA, exactly as a fresh load writes it.
 * Idempotent: a linked campaign has a template and is not picked again. One transaction per campaign batch. Dry run by default.
 */
export interface CampaignLinkOptions {
  client: string;
  orgSlug: string;
  targetUrl: string;
  ownerUrl: string;
  source: Source;
  apply: boolean;
  log: (line: string) => void;
}

export const LINK_COLLECTION = '_bcast';
export const LINK_STEP = 'campaign_link';

const bump = (m: Map<string, number>, k: string): void => void m.set(k, (m.get(k) ?? 0) + 1);
const show = (m: Map<string, number>): string =>
  [...m].sort().map(([k, n]) => `${k}=${n}`).join(' ') || '(none)';

export async function campaignLink(o: CampaignLinkOptions): Promise<void> {
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
    if (!org) throw new Error(`CAMPAIGNLINK_NO_ORG: no organization "${o.orgSlug}" made by this tool for ${o.client}`);
    const orgId = Number(org.id);
    if (!o.source.collections(o.client).includes('broadcasting'))
      throw new Error(`CAMPAIGNLINK_NO_DUMP: the dump of ${o.client} has no broadcasting collection (ship the dumps first)`);

    // the switches the campaigns were loaded with decide which campaigns exist and which recipients count (their Meta ids)
    const rec = (
      await worker.db.execute(
        sql`SELECT counts FROM migration.run_log WHERE source_client = ${o.client} AND collection = '_bcast' AND step = 'options'`,
      )
    ).rows[0] as { counts?: BroadcastOptions } | undefined;
    if (!rec?.counts) o.log('  link  WARNING: no record of the broadcast switches of the load; the defaults are used');
    const templates = await templatesOf(worker.db, orgId, o.client);
    const plan = await buildBroadcastPlan({
      source: o.source,
      client: o.client,
      settings: resolveBroadcast(rec?.counts ?? {}),
      contactsByDigits: new Map(),
      templates,
      shas: [],
    });

    const rows = (
      await withTenant(worker.db, { orgId }, (tx) =>
        tx.execute(sql`
          SELECT im.source_key, c.id, c.uuid::text AS uuid, c.template_id
          FROM migration.id_map im
          JOIN wpcampaigns c ON c.org_id = ${orgId} AND c.id = im.target_id
          WHERE im.source_client = ${o.client} AND im.source_collection = 'broadcasting' AND im.target_table = 'wpcampaigns'
            AND im.target_org_id = ${orgId}`),
      )
    ).rows as unknown as Array<{ source_key: string; id: number | string; uuid: string; template_id: number | string | null }>;
    const target = new Map(rows.map((r) => [r.source_key, r]));

    const todo: Array<{ key: string; id: number; uuid: string; template: number; how: LinkHow }> = [];
    const tally = new Map<string, number>();
    const unlinked = new Map<string, number>();
    const seen = new Set<string>();
    for await (const doc of o.source.read(o.client, 'broadcasting')) {
      const key = primaryKey(doc);
      const entry = plan.campaigns.get(key);
      if (seen.has(key) || !entry || entry.primary !== key || entry.verdict !== 'load') continue;
      seen.add(key);
      const t = target.get(key);
      if (!t) {
        bump(tally, 'campaign not in the target');
        continue;
      }
      const link = linkTemplate(doc, plan.templates, plan.metaIds.get(key));
      if (t.template_id !== null) {
        bump(tally, link.id === null || link.id === Number(t.template_id) ? 'already linked' : 'already linked, rules pick another (untouched)');
        continue;
      }
      if (link.id === null) {
        bump(tally, 'stay NULL');
        bump(unlinked, link.why as UnlinkedWhy);
        continue;
      }
      bump(tally, `${o.apply ? 'to link' : 'would link'} via ${link.how}`);
      todo.push({ key, id: Number(t.id), uuid: t.uuid, template: link.id, how: link.how! });
    }
    o.log(`  link  ${seen.size} loaded campaign(s) of the dump: ${show(tally)}`);
    o.log(`  link  campaigns that stay NULL, by reason: ${show(unlinked)}`);
    if (!o.apply) {
      o.log('  link  DRY RUN: nothing was written (add --apply --confirm-org-slug <slug>)');
      return;
    }

    const touched: string[] = [];
    for (let i = 0; i < todo.length; i += 100) {
      const part = todo.slice(i, i + 100);
      const done = await withTenant(worker.db, { orgId }, async (tx) => {
        const ok: typeof todo = [];
        for (const p of part) {
          const u = await tx.execute(sql`
            UPDATE wpcampaigns SET template_id = ${p.template}
            WHERE org_id = ${orgId} AND id = ${p.id} AND template_id IS NULL
            RETURNING id`);
          if (u.rows.length > 0) ok.push(p);
        }
        return ok;
      });
      for (const p of done) {
        touched.push(p.uuid);
        await worker.db.execute(
          sql`DELETE FROM migration.quarantine WHERE source_client = ${o.client} AND collection = 'broadcasting' AND source_key = ${`${p.key}#TEMPLATE_UNLINKED`} AND reason_code = 'TEMPLATE_UNLINKED'`,
        );
        if (p.how !== 'reference')
          await writeQuarantine(worker.db, o.client, [
            {
              collection: 'broadcasting',
              source_key: `${p.key}#TEMPLATE_LINKED_VIA`,
              reason_code: 'TEMPLATE_LINKED_VIA',
              reason: `the template id did not resolve; the template was found by its ${p.how === 'meta' ? 'Meta id' : 'name'} (exact, unique)`,
              doc: { detail: { how: p.how } },
            },
          ]);
      }
    }
    if (touched.length > 0) {
      const prev = (
        await worker.db.execute(
          sql`SELECT counts FROM migration.run_log WHERE source_client = ${o.client} AND collection = ${LINK_COLLECTION} AND step = ${LINK_STEP}`,
        )
      ).rows[0] as { counts?: { campaigns?: string[] } } | undefined;
      const all = [...new Set([...(prev?.counts?.campaigns ?? []), ...touched])];
      await worker.db.execute(sql`
        INSERT INTO migration.run_log (source_client, collection, step, run_id, last_key, state, counts)
        VALUES (${o.client}, ${LINK_COLLECTION}, ${LINK_STEP}, 'campaign-link', 0, 'done', ${JSON.stringify({ campaigns: all, at: new Date().toISOString() })}::jsonb)
        ON CONFLICT (source_client, collection, step) DO UPDATE SET counts = EXCLUDED.counts, updated_at = now()`);
    }
    o.log(`  link  done: ${touched.length} campaign(s) linked to their template (updated_at / row_version moved on exactly these)`);
  } finally {
    await worker.close();
    await owner.close();
  }
}

/** The campaign uuids campaign-link touched (updated_at / row_version moved); the verifier expects exactly these to differ. */
export async function linkedCampaigns(
  db: { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> },
  client: string,
): Promise<Set<string>> {
  const r = (
    await db.execute(
      sql`SELECT counts FROM migration.run_log WHERE source_client = ${client} AND collection = ${LINK_COLLECTION} AND step = ${LINK_STEP}`,
    )
  ).rows[0] as { counts?: { campaigns?: string[] } } | undefined;
  return new Set(r?.counts?.campaigns ?? []);
}
