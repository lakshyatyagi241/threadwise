import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { LineTemplateRow, LineTemplates } from './tokens';

interface Raw {
  id: number | string;
  uuid: string;
  template_name: string;
  template_body: string;
  buttons: unknown;
}

const toTemplate = (r: Raw): LineTemplateRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  name: r.template_name,
  body: r.template_body,
  buttons: r.buttons ?? [],
});

/** Reads `wa_templates` where the channel is line until the templates domain exports its own lookup. */
@Injectable()
export class SqlLineTemplates implements LineTemplates {
  async list(tx: Tx, orgId: number): Promise<LineTemplateRow[]> {
    const res = await tx.execute(sql`
      SELECT id, uuid, template_name, template_body, buttons FROM wa_templates
      WHERE org_id = ${orgId} AND channel = 'line' ORDER BY id DESC`);
    return (res.rows as unknown as Raw[]).map(toTemplate);
  }

  async find(tx: Tx, orgId: number, uuid: string): Promise<LineTemplateRow | undefined> {
    const res = await tx.execute(sql`
      SELECT id, uuid, template_name, template_body, buttons FROM wa_templates
      WHERE org_id = ${orgId} AND channel = 'line' AND uuid = ${uuid}::uuid`);
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toTemplate(r) : undefined;
  }
}
