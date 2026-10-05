import { Inject, Injectable, Optional } from '@nestjs/common';
import { isBuiltinWhatsappProviderKey } from '@crm/contracts';
import { sql } from 'drizzle-orm';
import {
  providerKeyOf,
  WabaRegistryRoutes,
} from '../../infra/providers/whatsapp-cloud-api-waba/waba-registry-routes';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import {
  WHATSAPP_PROVIDER,
  type WhatsAppProvider,
} from '../../infra/providers/whatsapp/whatsapp.port';
import { OutboundRegistry, type SendCommand } from '../node-bridge-runtime';
import type { DispatchSender } from './_shims/tokens';

export interface OutgoingMessage {
  /** Destination as digits. */
  to: string;
  templateName: string;
  language: string;
  /** Correlates the provider's receipts back to the recipient row. */
  clientReference: string;
  /** Template category, so a marketing send on a Marketing-Messages-Lite number takes the cheaper endpoint. */
  category?: string;
  /** The recipient's own Cloud API components (header media, buttons, carousel, variables); only the waba engine uses them. */
  components?: unknown[];
}

/** A free-text message (a campaign's custom text, media and buttons), for the engines that can send one. */
export interface OutgoingText {
  /** Destination as digits. */
  to: string;
  text: string;
  clientReference: string;
  header?: string | null;
  footer?: string | null;
  buttons?: unknown[];
  quickReplies?: unknown[];
  media?: { kind: 'image' | 'video' | 'document'; url: string } | null;
  /** The sender's number is paced and capped by the dispatcher; the transport only needs to know it is a bulk send. */
  screen?: { bulk?: boolean; source?: string };
}

/**
 * A template body for engines that send plain text: each `{{n}}` or `{{name}}` takes the next resolved value (positional
 * numbers index the list, names take their order of first appearance). A missing value renders empty, never as the raw tag.
 */
export function renderPlainBody(templateBody: string, values: string[] | undefined): string {
  const seen = new Map<string, number>();
  return templateBody.replace(/\{\{\s*([^\s{}]+?)\s*\}\}/g, (_m, key: string) => {
    const idx = /^\d+$/.test(key)
      ? Number(key) - 1
      : (seen.get(key) ?? seen.set(key, seen.size).get(key)!);
    return values?.[idx] ?? '';
  });
}

/** What a plain-text engine sends for one recipient: header, body and footer as lines, media as the file with that text as caption. */
export function commandForText(m: OutgoingText): SendCommand {
  const text = [m.header, m.text, m.footer].filter((x): x is string => !!x?.trim()).join('\n\n');
  if (m.media) {
    return {
      type: 'media',
      to: m.to,
      mediaUrl: m.media.url,
      ...(text ? { caption: text } : {}),
    };
  }
  return { type: 'text', to: m.to, body: text };
}

/** A sender with its credentials loaded once for the whole run. */
export interface OpenedSender {
  send(message: OutgoingMessage): Promise<{ providerMessageId: string | null }>;
  /**
   * A custom (non-template) message. Absent where the engine cannot send one: the Cloud API only allows free text inside an open
   * 24-hour customer session, so a campaign on it must use an approved template (WaDesk refuses it the same way).
   */
  sendText?(message: OutgoingText): Promise<{ providerMessageId: string | null }>;
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
 * WhatsApp Cloud API numbers (engine `waba`), sent through the shared Meta provider. The SMS engine has no adapter yet: a
 * broadcast on it fails at dispatch with a clear reason (see EngineSenderRegistry).
 */
@Injectable()
export class WabaEngineSender implements EngineSender {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
    @Optional() private readonly routes?: WabaRegistryRoutes,
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
    const authKey = String(creds.auth_key ?? '');
    const senderId = String(creds.phone_number_id ?? meta.phone_number_id ?? '');
    const wabaId = String(meta.waba_id ?? '');
    // `provider` in meta_json says which route reaches the number; rows from the manual connect predate it and are direct.
    const providerKey = providerKeyOf(meta);
    const route = providerKey === 'interakt' ? 'interakt' : 'meta';
    // A number on a provider of the platform's registry sends through that provider's own route (address, version, headers).
    const registry = isBuiltinWhatsappProviderKey(providerKey)
      ? undefined
      : this.routes?.authFor(providerKey, { wabaId, phoneNumberId: senderId, accessToken });
    if (!isBuiltinWhatsappProviderKey(providerKey) && !registry) {
      throw new Error(
        'The WhatsApp provider of this number is not available. Ask the platform admin, or reconnect the number.',
      );
    }
    const usable = registry
      ? true
      : route === 'interakt'
        ? Boolean(authKey && wabaId)
        : Boolean(accessToken);
    if (!usable || !senderId) {
      throw new Error(
        'This WhatsApp Cloud API number has no access token or phone number id. Reconnect the number.',
      );
    }
    const credentials = {
      senderId,
      accessToken,
      route,
      ...(route === 'interakt' ? { authKey } : {}),
      ...(registry ? { registry } : {}),
      ...(wabaId ? { businessAccountId: wabaId } : {}),
      marketingLite: meta.is_mm_lite_onboarded === true,
    } as const;

    return {
      send: async (m) => {
        const res = await this.provider.sendTemplate(credentials, {
          to: m.to,
          templateName: m.templateName,
          language: m.language,
          ...(m.category ? { category: m.category } : {}),
          variables: {},
          ...(m.components ? { components: m.components } : {}),
          clientReference: m.clientReference,
          screen: { bulk: true, source: 'broadcast' },
        });
        return { providerMessageId: res.providerMessageId };
      },
    };
  }
}

/**
 * The unofficial engine and Twilio (WD-NODE-037, 038): one adapter over the NODE transports, so a broadcast reaches them
 * through the same send port a scheduled message uses. They send free text (the rendered template), never a Meta template.
 */
@Injectable()
export class TransportEngineSender implements EngineSender {
  constructor(private readonly outbound: OutboundRegistry) {}

  async open(orgId: number, sender: DispatchSender): Promise<OpenedSender> {
    const transport = this.outbound.get(sender.engine);
    if (!transport) throw new Error(`No sender is connected for engine ${sender.engine}.`);
    const open = await transport.open(orgId, sender);
    return {
      send: async () => {
        throw new Error('This engine sends the rendered text, not a Meta template.');
      },
      sendText: async (m) => {
        const out = await open.send(commandForText(m), {
          clientReference: m.clientReference,
          screen: m.screen ?? { bulk: true, source: 'broadcast' },
        });
        return { providerMessageId: out.providerMessageId ?? null };
      },
    };
  }
}

/** Which adapter sends for which engine. Tests and later domains register their own. */
@Injectable()
export class EngineSenderRegistry {
  private readonly senders = new Map<string, EngineSender>();

  constructor(waba: WabaEngineSender, other: TransportEngineSender) {
    this.senders.set('waba', waba);
    this.senders.set('baileys', other);
    this.senders.set('twilio', other);
  }

  register(engine: string, sender: EngineSender): void {
    this.senders.set(engine, sender);
  }

  get(engine: string): EngineSender | undefined {
    return this.senders.get(engine);
  }
}
