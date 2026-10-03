import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { applyTemplateEvent, languageMatches, type TemplateFacts } from './template-event-rules';

interface TemplateRow {
  id: number | string;
  template_name: string;
  language: string;
  status: string;
  meta_status: string | null;
  quality_score: string | null;
  category: string;
  approved_at: Date | string | null;
  meta_template_id: string | null;
}

/**
 * Mirrors Meta's template webhooks onto `wa_templates` (WD-WABA-041, WD-TPL-029). A shim until the templates domain exports
 * `TemplateService.applyMetaEvent`: it reads and writes the table directly, scoped to the receiving number's
 * `provider_config_id` so a spoofed WABA id cannot touch another workspace's rows.
 */
@Injectable()
export class WabaTemplateEvents {
  private readonly logger = new Logger(WabaTemplateEvents.name);

  /** True when a template was found and changed. */
  async apply(
    tx: Tx,
    orgId: number,
    configId: number,
    field: string,
    value: Record<string, unknown>,
    now: Date,
  ): Promise<boolean> {
    const row = await this.find(tx, orgId, configId, value);
    if (!row) {
      this.logger.log(
        { orgId, configId, field, templateId: value.message_template_id },
        'template event for no known template',
      );
      return false;
    }
    const facts: TemplateFacts = {
      status: row.status,
      metaStatus: row.meta_status,
      qualityScore: row.quality_score,
      category: row.category,
      approvedAt: row.approved_at ? new Date(row.approved_at) : null,
      metaTemplateId: row.meta_template_id,
    };
    const p = applyTemplateEvent(field, value, facts, now);
    if (!p) return false;

    const sets = [sql`last_synced_at = ${p.lastSyncedAt}`];
    if (p.metaStatus !== undefined) sets.push(sql`meta_status = ${p.metaStatus}`);
    if (p.status !== undefined) sets.push(sql`status = ${p.status}`);
    if (p.rejectionReasonCode !== undefined)
      sets.push(sql`rejection_reason_code = ${p.rejectionReasonCode}`);
    if (p.pausedUntil !== undefined) sets.push(sql`paused_until = ${p.pausedUntil}`);
    if (p.approvedAt !== undefined) sets.push(sql`approved_at = ${p.approvedAt}`);
    if (p.qualityScore !== undefined) sets.push(sql`quality_score = ${p.qualityScore}`);
    if (p.metaCategory !== undefined) sets.push(sql`meta_category = ${p.metaCategory}`);
    if (p.metaTemplateId !== undefined) sets.push(sql`meta_template_id = ${p.metaTemplateId}`);
    await tx.execute(
      sql`UPDATE wa_templates SET ${sql.join(sets, sql`, `)} WHERE org_id = ${orgId} AND id = ${Number(row.id)}`,
    );
    return true;
  }

  private async find(
    tx: Tx,
    orgId: number,
    configId: number,
    value: Record<string, unknown>,
  ): Promise<TemplateRow | null> {
    const cols = sql.raw(
      'id, template_name, language, status, meta_status, quality_score, category, approved_at, meta_template_id',
    );
    const metaId = value.message_template_id;
    if (metaId !== undefined && metaId !== null && String(metaId) !== '') {
      const byId = await tx.execute(sql`
        SELECT ${cols} FROM wa_templates
        WHERE org_id = ${orgId} AND provider_config_id = ${configId} AND meta_template_id = ${String(metaId)}`);
      if (byId.rows[0]) return byId.rows[0] as unknown as TemplateRow;
    }
    const name = typeof value.message_template_name === 'string' ? value.message_template_name : '';
    const language =
      typeof value.message_template_language === 'string' ? value.message_template_language : '';
    if (!name) return null;
    const byName = await tx.execute(sql`
      SELECT ${cols} FROM wa_templates
      WHERE org_id = ${orgId} AND provider_config_id = ${configId} AND lower(template_name) = lower(${name})`);
    const candidates = byName.rows as unknown as TemplateRow[];
    return candidates.find((r) => !language || languageMatches(r.language, language)) ?? null;
  }
}
