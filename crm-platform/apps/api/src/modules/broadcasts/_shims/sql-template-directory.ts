import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { TemplateDirectory, TemplateRecord } from './tokens';

interface Raw {
  id: number | string;
  uuid: string;
  template_type: string;
  attachment_type: string | null;
  attachment_file: string | null;
  meta_template_id: string | null;
  meta_status: string | null;
  paused_until: Date | string | null;
  quality_score: string | null;
}

/** Reads `wa_templates` directly until the templates domain exports its own lookup. */
@Injectable()
export class SqlTemplateDirectory implements TemplateDirectory {
  async find(tx: Tx, orgId: number, uuid: string): Promise<TemplateRecord | undefined> {
    const res = await tx.execute(sql`
      SELECT id, uuid, template_type, attachment_type, attachment_file, meta_template_id, meta_status,
             paused_until, quality_score
      FROM wa_templates WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`);
    const r = res.rows[0] as unknown as Raw | undefined;
    if (!r) return undefined;
    return {
      id: Number(r.id),
      uuid: r.uuid,
      templateType: r.template_type,
      attachmentType: r.attachment_type,
      attachmentFile: r.attachment_file,
      metaTemplateId: r.meta_template_id,
      metaStatus: r.meta_status,
      pausedUntil: r.paused_until ? new Date(r.paused_until) : null,
      qualityScore: r.quality_score,
    };
  }

  /** Only an absolute URL can be checked; a stored path needs the storage domain, so its check is skipped for now. */
  mediaUrl(path: string): string | null {
    return /^https?:\/\//i.test(path) ? path : null;
  }

  /** The platform setting lives in the settings domain; off until that domain exposes it (the guard then does not run). */
  async wabaTemplatesV2Enabled(_tx: Tx): Promise<boolean> {
    return false;
  }
}
