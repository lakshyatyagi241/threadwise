import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import {
  WHATSAPP_PROVIDER,
  type WhatsAppProvider,
} from '../../infra/providers/whatsapp/whatsapp.port';
import type { DispatchSender } from './_shims/tokens';

export interface OutgoingMessage {
  /** Destination as digits. */
  to: string;
  templateName: string;
  language: string;
  /** Correlates the provider's receipts back to the recipient row. */
  clientReference: string;
  /** The recipient's own Cloud API components (header media, buttons, carousel, variables); only the waba engine uses them. */
  components?: unknown[];
}

/** A sender with its credentials loaded once for the whole run. */
export interface OpenedSender {
  send(message: OutgoingMessage): Promise<{ providerMessageId: string | null }>;
}

/** One adapter per engine. `open` throws when the number cannot send (no credentials). */
export interface EngineSender {
  open(orgId: number, sender: DispatchSender): Promise<OpenedSender>;
}

interface ConfigRow {
  credentials_json: string | null;
  meta_json: Record<string, unknown> | null;
}

/**
 * WhatsApp Cloud API numbers (engine `waba`), sent through the shared Meta provider. The Baileys, Twilio and SMS engines
 * have no adapter yet: a broadcast on one of them fails at dispatch with a clear reason (see EngineSenderRegistry).
 */
@Injectable()
export class WabaEngineSender implements EngineSender {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
  ) {}

  async open(orgId: number, sender: DispatchSender): Promise<OpenedSender> {
    const row = await this.db.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT credentials_json, meta_json FROM wa_provider_configs WHERE org_id = ${orgId} AND id = ${sender.id}`,
      );
      return res.rows[0] as unknown as ConfigRow | undefined;
    });

    let creds: Record<string, unknown> = {};
    if (row?.credentials_json) {
      try {
        creds = JSON.parse(this.crypto.decrypt(row.credentials_json)) as Record<string, unknown>;
      } catch {
        throw new Error(
          'The WhatsApp Cloud API credentials of this number cannot be read. Reconnect the number.',
        );
      }
    }
    const meta = row?.meta_json ?? {};
    const accessToken = String(creds.access_token ?? '');
    const senderId = String(creds.phone_number_id ?? meta.phone_number_id ?? '');
    if (!accessToken || !senderId) {
      throw new Error(
        'This WhatsApp Cloud API number has no access token or phone number id. Reconnect the number.',
      );
    }

    return {
      send: async (m) => {
        const res = await this.provider.sendTemplate(
          { senderId, accessToken },
          {
            to: m.to,
            templateName: m.templateName,
            language: m.language,
            variables: {},
            ...(m.components ? { components: m.components } : {}),
            clientReference: m.clientReference,
            screen: { bulk: true, source: 'broadcast' },
          },
        );
        return { providerMessageId: res.providerMessageId };
      },
    };
  }
}

/** Which adapter sends for which engine. Tests and later domains register their own. */
@Injectable()
export class EngineSenderRegistry {
  private readonly senders = new Map<string, EngineSender>();

  constructor(waba: WabaEngineSender) {
    this.senders.set('waba', waba);
  }

  register(engine: string, sender: EngineSender): void {
    this.senders.set(engine, sender);
  }

  get(engine: string): EngineSender | undefined {
    return this.senders.get(engine);
  }
}
