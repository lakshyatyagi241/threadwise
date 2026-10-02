import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../../infra/db/database.service';
import { EngineSenderRegistry, WabaEngineSender } from '../../broadcasts';
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
    private readonly waba: WabaEngineSender,
  ) {}

  /** The connected Cloud API number to send from: the chosen one (`engine:uuid`) or the primary. */
  private async number(
    orgId: number,
    senderKey: string | null | undefined,
  ): Promise<{ id: number; phone: string }> {
    // A chosen number must be a Cloud API one; the other engines have no adapter here yet.
    const [engine, uuid] = (senderKey ?? '').split(':');
    if (senderKey && engine !== 'waba')
      throw new Error(
        `Sending from a ${engine ?? 'this'} number is not supported yet. Choose a Cloud API number.`,
      );
    const row = await this.db.txAs({ orgId }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT id, phone_number FROM wa_provider_configs
        WHERE org_id = ${orgId} AND provider = 'waba' AND status = 'connected'
          AND (${uuid ?? null}::uuid IS NULL OR uuid = ${uuid ?? null}::uuid)
        ORDER BY is_primary DESC, id DESC LIMIT 1`);
      return res.rows[0] as { id: number | string; phone_number: string | null } | undefined;
    });
    if (!row)
      throw new Error(
        senderKey
          ? 'The chosen WhatsApp number is not connected.'
          : 'No WhatsApp Cloud API number is connected to send from.',
      );
    return { id: Number(row.id), phone: row.phone_number ?? '' };
  }

  async send(
    orgId: number,
    m: {
      to: string;
      template: EcomTemplate;
      params: string[];
      reference: string;
      senderKey?: string | null;
    },
  ): Promise<{ providerMessageId: string | null }> {
    const num = await this.number(orgId, m.senderKey);
    const adapter = this.engines.get('waba');
    if (!adapter) throw new Error('The WhatsApp Cloud API sender is not available.');
    const opened = await adapter.open(orgId, {
      engine: 'waba',
      id: num.id,
      phoneDigits: num.phone.replace(/\D/g, ''),
      label: num.phone,
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

  async canSend(orgId: number): Promise<boolean> {
    return this.number(orgId, null).then(
      () => true,
      () => false,
    );
  }

  async sendText(
    orgId: number,
    m: { to: string; body: string; reference: string },
  ): Promise<{ providerMessageId: string | null }> {
    const num = await this.number(orgId, null);
    return this.waba.sendSessionText(orgId, num.id, {
      to: m.to,
      body: m.body,
      clientReference: m.reference,
    });
  }
}
