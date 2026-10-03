import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { EcomTemplate, EcomTemplates } from './tokens';

/** Reads `wa_templates` until the templates domain exports its own lookup. */
@Injectable()
export class SqlEcomTemplates implements EcomTemplates {
  async sendable(tx: Tx, orgId: number, id: number): Promise<EcomTemplate | undefined> {
    const res = await tx.execute(sql`
      SELECT id, uuid, template_name, language, template_body, header, footer FROM wa_templates
      WHERE org_id = ${orgId} AND id = ${id}
        AND (meta_template_id IS NULL OR upper(coalesce(meta_status, '')) = 'APPROVED')`);
    const r = res.rows[0] as
      | {
          id: number | string;
          uuid: string;
          template_name: string;
          language: string;
          template_body: string | null;
          header: string | null;
          footer: string | null;
        }
      | undefined;
    return r
      ? {
          id: Number(r.id),
          uuid: r.uuid,
          name: r.template_name,
          language: r.language,
          body: r.template_body ?? '',
          header: r.header,
          footer: r.footer,
        }
      : undefined;
  }

  async idOf(tx: Tx, orgId: number, uuid: string): Promise<number | undefined> {
    const res = await tx.execute(
      sql`SELECT id FROM wa_templates WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as { id: number | string } | undefined;
    return r ? Number(r.id) : undefined;
  }
}
