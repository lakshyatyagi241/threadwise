import { Inject, Injectable, Optional } from '@nestjs/common';
import { isBuiltinWhatsappProviderKey } from '@crm/contracts';
import { sql } from 'drizzle-orm';
import {
  providerKeyOf,
  WabaRegistryRoutes,
} from '../../../infra/providers/whatsapp-cloud-api-waba/waba-registry-routes';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { DatabaseService } from '../../../infra/db/database.service';
import {
  WHATSAPP_PROVIDER,
  type ChannelCredentials,
  type WhatsAppProvider,
} from '../../../infra/providers/whatsapp/whatsapp.port';
import {
  UnsupportedSendError,
  type EngineTransport,
  type OpenTransport,
  type SendCommand,
  type SenderRef,
} from './outbound';

type MediaCommand = Extract<SendCommand, { type: 'media' }>;

/** The Meta media type: from the MIME type, or the file extension when none is given; anything else is a document. */
function mediaKind(c: MediaCommand): 'image' | 'video' | 'audio' | 'document' {
  if (c.voiceNote) return 'audio';
  const mime = c.mimeType?.toLowerCase() ?? '';
  const ext = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(c.fileName ?? c.mediaUrl)?.[1]?.toLowerCase() ?? '';
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image';
  if (mime.startsWith('video/') || ['mp4', '3gp'].includes(ext)) return 'video';
  if (mime.startsWith('audio/') || ['mp3', 'ogg', 'aac', 'm4a', 'opus'].includes(ext))
    return 'audio';
  return 'document';
}

interface ConfigRow {
  credentials_json: string | null;
  meta_json: Record<string, unknown> | null;
}

/**
 * WhatsApp Cloud API numbers (engine `waba`), through the shared Meta provider. Text and media: Meta delivers free text
 * inside the 24-hour customer window; media goes by public https link. Locations and contacts stay on the broadcast
 * pipeline, as WaDesk did. Templates go through the broadcast pipeline.
 */
@Injectable()
export class WabaTransport implements EngineTransport {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
    @Optional() private readonly routes?: WabaRegistryRoutes,
  ) {}

  async open(orgId: number, sender: SenderRef): Promise<OpenTransport> {
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
    const credentials: ChannelCredentials = {
      senderId,
      accessToken,
      route,
      ...(route === 'interakt' ? { authKey } : {}),
      ...(registry ? { registry } : {}),
      ...(wabaId ? { businessAccountId: wabaId } : {}),
      marketingLite: meta.is_mm_lite_onboarded === true,
    };

    return {
      send: async (command: SendCommand, context) => {
        const screen = context.screen ? { screen: context.screen } : {};
        if (command.type === 'media') {
          // Meta fetches the file itself from a public https link.
          if (!/^https:\/\//i.test(command.mediaUrl)) {
            throw new UnsupportedSendError(
              'The WhatsApp Cloud API needs a public https link for media.',
            );
          }
          const kind = mediaKind(command);
          // The envelope is the provider's; `body` is what Meta documents under the type key (no caption on audio).
          const res = await this.provider.sendMessage(credentials, {
            to: command.to,
            type: kind,
            body: {
              link: command.mediaUrl,
              ...(command.caption && kind !== 'audio' ? { caption: command.caption } : {}),
              ...(kind === 'document' && command.fileName ? { filename: command.fileName } : {}),
            },
            clientReference: context.clientReference,
            ...screen,
          });
          return { providerMessageId: res.providerMessageId };
        }
        if (command.type !== 'text') {
          throw new UnsupportedSendError(
            `A single ${command.type} message is not supported on the WhatsApp Cloud API. Send it as a campaign or broadcast.`,
          );
        }
        const res = await this.provider.sendText(credentials, {
          to: command.to,
          body: command.body,
          clientReference: context.clientReference,
          ...screen,
        });
        return { providerMessageId: res.providerMessageId };
      },
    };
  }
}
