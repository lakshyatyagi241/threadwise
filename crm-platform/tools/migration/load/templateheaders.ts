import type { Source } from '../extract/source';
import { headerLinks } from '../transform/templates';
import { connect, sql, withPrivileged, withTenant } from './db';

/**
 * template-headers: gives the templates an EARLIER load wrote the Meta copy of their media header file (`header_sample_url`), so the
 * template shows its image or video at once and the files step can copy it into our storage (`header_media_key`). Earlier loads dropped
 * it (HEADER_SAMPLE_NOT_KEPT), so every migrated media template showed an empty picture.
 *
 * Writes ONE column, `wa_templates.header_sample_url`, only where it is empty and the template is a media (image, video, document)
 * template. The table has the touch trigger, so a changed row gets updated_at = now() and row_version + 1, as the template-quality step
 * does. Matches the dump's templates to the loaded rows through migration.id_map. Idempotent. Dry run by default; counts only in the
 * output (a link carries a signature, so it is never printed).
 */
export interface TemplateHeadersOptions {
  client: string;
  orgSlug: string;
  ownerUrl: string;
  source: Source;
  apply: boolean;
  log: (line: string) => void;
}

export async function templateHeaders(o: TemplateHeadersOptions): Promise<void> {
  const links = await headerLinks(o.source, o.client);
  o.log(`  headers  ${links.size} template key(s) in the dump carry a media header link`);
  const owner = connect(o.ownerUrl, 'owner');
  try {
    const org = (
      await withPrivileged(owner.db, (tx) =>
        tx.execute(
          sql`SELECT id FROM organizations WHERE slug = ${o.orgSlug} AND settings #>> '{legacy,waboo,client}' = ${o.client}`,
        ),
      )
    ).rows[0] as { id: number | string } | undefined;
    if (!org)
      throw new Error(
        `TEMPLATEHEADERS_NO_ORG: no organization "${o.orgSlug}" made by this tool for ${o.client}`,
      );
    const orgId = Number(org.id);
    await withTenant(owner.db, { orgId }, async (tx) => {
      const rows = (
        await tx.execute(sql`
          SELECT m.source_key AS key, t.id AS id
          FROM migration.id_map m JOIN wa_templates t ON t.org_id = m.target_org_id AND t.id = m.target_id
          WHERE m.source_client = ${o.client} AND m.source_collection = 'broadcast_templates' AND m.target_table = 'wa_templates'
            AND m.target_org_id = ${orgId} AND t.header_sample_url IS NULL AND t.attachment_type IN ('image', 'video', 'document')`)
      ).rows as Array<{ key: string; id: number | string }>;
      const todo = rows
        .map((r) => ({ id: Number(r.id), url: links.get(String(r.key)) }))
        .filter((r): r is { id: number; url: string } => typeof r.url === 'string');
      o.log(
        `  headers  ${rows.length} loaded media template(s) have no header link; ${todo.length} can be given one from the dump, ${rows.length - todo.length} cannot (no link in the dump)`,
      );
      if (!o.apply) {
        o.log('  headers  DRY RUN: nothing was written (add --apply --confirm-org-slug <slug>)');
        return;
      }
      let changed = 0;
      for (const r of todo) {
        const res = await tx.execute(
          sql`UPDATE wa_templates SET header_sample_url = ${r.url} WHERE org_id = ${orgId} AND id = ${r.id} AND header_sample_url IS NULL`,
        );
        changed += Number((res as { rowCount?: number }).rowCount ?? 0);
      }
      o.log(
        `  headers  done: ${changed} template(s) given their header link; run the files step to copy the files`,
      );
    });
  } finally {
    await owner.close();
  }
}
