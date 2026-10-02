import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { TelegramTemplate, TelegramTemplates } from './tokens';

interface Raw {
  id: number | string;
  uuid: string;
  template_name: string;
  template_body: string;
  buttons: unknown;
}

const toTemplate = (r: Raw): TelegramTemplate => ({
  id: Number(r.id),
  uuid: r.uuid,
  name: r.template_name,
  body: r.template_body,
  buttons: r.buttons ?? [],
});

/** Reads `wa_templates` where the channel is telegram until the templates domain exports its own lookup. */
@Injectable()
export class SqlTelegramTemplates implements TelegramTemplates {
  async list(tx: Tx, orgId: number): Promise<TelegramTemplate[]> {
    const res = await tx.execute(sql`
      SELECT id, uuid, template_name, template_body, buttons FROM wa_templates
      WHERE org_id = ${orgId} AND channel = 'telegram' ORDER BY id DESC`);
    return (res.rows as unknown as Raw[]).map(toTemplate);
  }

  async find(tx: Tx, orgId: number, uuid: string): Promise<TelegramTemplate | undefined> {
    const res = await tx.execute(sql`
      SELECT id, uuid, template_name, template_body, buttons FROM wa_templates
      WHERE org_id = ${orgId} AND channel = 'telegram' AND uuid = ${uuid}::uuid`);
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toTemplate(r) : undefined;
  }
}
