import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { ViberTemplate, ViberTemplates } from './tokens';

interface Raw {
  id: number | string;
  uuid: string;
  template_name: string;
  template_body: string;
  buttons: unknown;
}

const toTemplate = (r: Raw): ViberTemplate => ({
  id: Number(r.id),
  uuid: r.uuid,
  name: r.template_name,
  body: r.template_body,
  buttons: r.buttons ?? [],
});

/** Reads `wa_templates` where the channel is viber until the templates domain exports its own lookup. */
@Injectable()
export class SqlViberTemplates implements ViberTemplates {
  async list(tx: Tx, orgId: number): Promise<ViberTemplate[]> {
    const res = await tx.execute(sql`
      SELECT id, uuid, template_name, template_body, buttons FROM wa_templates
      WHERE org_id = ${orgId} AND channel = 'viber' ORDER BY id DESC`);
    return (res.rows as unknown as Raw[]).map(toTemplate);
  }

  async find(tx: Tx, orgId: number, uuid: string): Promise<ViberTemplate | undefined> {
    const res = await tx.execute(sql`
      SELECT id, uuid, template_name, template_body, buttons FROM wa_templates
      WHERE org_id = ${orgId} AND channel = 'viber' AND uuid = ${uuid}::uuid`);
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toTemplate(r) : undefined;
  }
}
