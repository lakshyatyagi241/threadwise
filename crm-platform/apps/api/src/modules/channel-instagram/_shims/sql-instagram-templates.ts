import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { InstagramTemplate, InstagramTemplates } from './tokens';

interface Raw {
  id: number | string;
  uuid: string;
  template_name: string;
  template_body: string;
  buttons: unknown;
}

const toTemplate = (r: Raw): InstagramTemplate => ({
  id: Number(r.id),
  uuid: r.uuid,
  name: r.template_name,
  body: r.template_body,
  buttons: Array.isArray(r.buttons) ? r.buttons : [],
});

/** Reads `wa_templates` where the channel is instagram until the templates domain exports its own lookup. */
@Injectable()
export class SqlInstagramTemplates implements InstagramTemplates {
  async list(tx: Tx, orgId: number): Promise<InstagramTemplate[]> {
    const res = await tx.execute(sql`
      SELECT id, uuid, template_name, template_body, buttons FROM wa_templates
      WHERE org_id = ${orgId} AND channel = 'instagram' ORDER BY id DESC`);
    return (res.rows as unknown as Raw[]).map(toTemplate);
  }

  async find(tx: Tx, orgId: number, uuid: string): Promise<InstagramTemplate | undefined> {
    const res = await tx.execute(sql`
      SELECT id, uuid, template_name, template_body, buttons FROM wa_templates
      WHERE org_id = ${orgId} AND channel = 'instagram' AND uuid = ${uuid}::uuid`);
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toTemplate(r) : undefined;
  }
}
