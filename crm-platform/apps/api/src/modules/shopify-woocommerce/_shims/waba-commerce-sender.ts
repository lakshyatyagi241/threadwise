import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../../infra/db/database.service';
import { EngineSenderRegistry } from '../../broadcasts';
import type { CommerceSender, EcomTemplate } from './tokens';

/**
 * Sends through the organization's primary connected WhatsApp Cloud API number, using the broadcasts engine adapter. Baileys and
 * Twilio numbers have no adapter yet, so an organization without a connected Cloud API number gets a clear failure (logged on the
 * event), never a silent skip.
 */
@Injectable()
export class WabaCommerceSender implements CommerceSender {
  constructor(
    private readonly db: DatabaseService,
    private readonly engines: EngineSenderRegistry,
  ) {}

  async send(
    orgId: number,
    m: { to: string; template: EcomTemplate; params: string[]; reference: string },
  ): Promise<{ providerMessageId: string | null }> {
    const row = await this.db.txAs({ orgId }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT id, phone_number FROM wa_provider_configs
        WHERE org_id = ${orgId} AND provider = 'waba' AND status = 'connected'
        ORDER BY is_primary DESC, id DESC LIMIT 1`);
      return res.rows[0] as { id: number | string; phone_number: string | null } | undefined;
    });
    if (!row) throw new Error('No WhatsApp Cloud API number is connected to send from.');
    const adapter = this.engines.get('waba');
    if (!adapter) throw new Error('The WhatsApp Cloud API sender is not available.');
    const opened = await adapter.open(orgId, {
      engine: 'waba',
      id: Number(row.id),
      phoneDigits: (row.phone_number ?? '').replace(/\D/g, ''),
      label: row.phone_number ?? '',
    });
    return opened.send({
      to: m.to,
      templateName: m.template.name,
      language: m.template.language,
      clientReference: m.reference,
      components: m.params.length
        ? [{ type: 'body', parameters: m.params.map((text) => ({ type: 'text', text })) }]
        : [],
    });
  }
}
