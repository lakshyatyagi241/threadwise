import { Injectable, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { DatabaseService } from '../../../infra/db/database.service';
import {
  UnsupportedSendError,
  type EngineTransport,
  type OpenTransport,
  type SendCommand,
  type SenderRef,
} from './outbound';
import { OutboundRegistry } from './outbound-registry.service';

interface ConfigRow {
  credentials_json: string | null;
}

const digits = (s: string) => s.replace(/\D+/g, '');
const whatsapp = (n: string) => `whatsapp:+${digits(n.replace(/^whatsapp:/i, ''))}`;

/**
 * Twilio WhatsApp numbers (engine `twilio`, TW-NODE-027): text, media with an optional caption, and a location pin, sent through
 * Twilio's Messages API with the number's own account SID and token. Templates (a `ContentSid`) belong to the template
 * pipeline. Twilio reports delivery to a status callback owned by the WhatsApp provider domain; none is set here, so Twilio
 * never calls a route that does not exist yet.
 */
@Injectable()
export class TwilioTransport implements EngineTransport, OnModuleInit {
  /** Overridable in tests. */
  baseUrl = 'https://api.twilio.com';
  timeoutMs = 20_000;

  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly registry: OutboundRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register('twilio', this);
  }

  async open(orgId: number, sender: SenderRef): Promise<OpenTransport> {
    const row = await this.db.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT credentials_json FROM wa_provider_configs WHERE org_id = ${orgId} AND id = ${sender.id}`,
      );
      return res.rows[0] as unknown as ConfigRow | undefined;
    });
    let creds: Record<string, unknown> = {};
    if (row?.credentials_json) {
      try {
        creds = JSON.parse(this.crypto.decrypt(row.credentials_json)) as Record<string, unknown>;
      } catch {
        throw new Error(
          'The Twilio credentials of this number cannot be read. Reconnect the number.',
        );
      }
    }
    const sid = String(creds.account_sid ?? '');
    const token = String(creds.auth_token ?? '');
    const from = String(creds.from_number ?? '');
    if (!sid || !token || !from) {
      throw new Error(
        'This Twilio number has no account SID, auth token or from-number. Reconnect the number.',
      );
    }

    return {
      send: async (command) => {
        const form = this.form(command, from);
        const res = await fetch(
          `${this.baseUrl}/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
          {
            method: 'POST',
            headers: {
              authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
              'content-type': 'application/x-www-form-urlencoded',
            },
            body: form,
            signal: AbortSignal.timeout(this.timeoutMs),
          },
        );
        const json = (await res.json().catch(() => ({}))) as {
          sid?: string;
          message?: string;
          code?: number;
        };
        if (!res.ok) {
          throw new Error(
            `Twilio refused the message${json.code ? ` (${json.code})` : ''}: ${json.message ?? `HTTP ${res.status}`}`,
          );
        }
        return { providerMessageId: json.sid ?? null };
      },
    };
  }

  private form(command: SendCommand, from: string): URLSearchParams {
    const f = new URLSearchParams({ From: whatsapp(from) });
    switch (command.type) {
      case 'text':
        // A caller footer is appended on this engine as on the Cloud API.
        f.set('To', whatsapp(command.to));
        f.set('Body', command.footer ? `${command.body}\n\n${command.footer}` : command.body);
        return f;
      case 'media':
        f.set('To', whatsapp(command.to));
        f.set('MediaUrl', command.mediaUrl);
        if (command.caption) f.set('Body', command.caption);
        return f;
      case 'location':
        f.set('To', whatsapp(command.to));
        f.set('PersistentAction', `geo:${command.latitude},${command.longitude}`);
        f.set('Body', (command.name ?? '').trim() || 'Location');
        return f;
      case 'template':
        throw new UnsupportedSendError(
          'A Meta template cannot be sent through Twilio here; send its text instead.',
        );
      default:
        throw new UnsupportedSendError(
          `A ${command.type === 'contact' ? 'contact card' : 'group message'} cannot be sent through Twilio.`,
        );
    }
  }
}
