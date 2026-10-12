import type { ChannelCapabilities } from '@crm/contracts';
import {
  ChannelError,
  windowFromLastInbound,
  type ChannelAdapter,
  type ChannelHealthResult,
  type ChannelRuntime,
  type OutboundEnvelope,
  type ParsedInbound,
  type SendResult,
  type WindowInfo,
} from '../chat-conversations/channel.port';
import type { WabaAdminPort, WabaConnection } from '../whatsapp-cloud-api-waba/waba-admin.port';
import { WabaApiError } from '../whatsapp-cloud-api-waba/waba-errors';
import type { WabaHttp } from '../whatsapp-cloud-api-waba/waba-http';
import {
  authContextOf,
  wabaAuthOf,
  type InboundMediaFetcher,
  type OutboundMediaUploader,
  type PreparedWhatsappMedia,
} from './media';
import { assertGroupSendKind, isGroupPeer } from './group-peer';
import { buildHealth, type Read } from './meta-health';
import { META_FAILURE, metaFailure } from './meta-errors';
import { normaliseMetaWebhook } from './meta-inbound';
import { buildMessageBody } from './meta-outbound';
import type { OutboundSendGuard } from './send-guard.port';

const META_CAPABILITIES: ChannelCapabilities = {
  windowHours: 24,
  templates: true,
  media: ['image', 'video', 'audio', 'document', 'sticker', 'location', 'contact'],
  interactive: true,
  reactions: true,
  editDelete: false,
  receipts: ['sent', 'delivered', 'read'],
  // The Cloud API shows a typing indicator to the customer together with a read receipt (`markRead` with `typing`).
  typing: true,
};

/** The Graph API normally answers in well under a second; a hung connection must not hold a send worker. */
const SEND_TIMEOUT_MS = 15_000;

/** What a platform-level credential failing means: not something the customer can fix by pasting a token. */
export const PROVIDER_CREDENTIALS_REJECTED = 'PROVIDER_CREDENTIALS_REJECTED';

const NOT_LINKED_MESSAGE =
  'This WhatsApp channel is not linked to a connected WhatsApp number with a usable token. Connect or reconnect the number under WhatsApp numbers.';

/**
 * WhatsApp as a channel adapter: the inbox's view of a number connected in the WABA domain (plan-inbox-chat.md Phase 2).
 *
 * There is ONE WhatsApp stack. A number is connected, its token kept and its webhook received by the WABA domain
 * (`wa_provider_configs`, `WabaConnectService`, the public webhook with its signature check); this adapter is a consumer of it:
 *
 *   credentials  none of its own. The channel registry opens them for the one call from the connection the channel is linked to
 *                (`channels.waba_config_id`): `route` ('meta' | 'interakt'), `accessToken`, `authKey`, `businessAccountId`; the sender
 *                is the channel's `externalId` (the phone number id).
 *   send         every outbound kind through `POST /{phone-number-id}/messages` on `WabaHttp` (the platform's one WhatsApp client:
 *                address, version, auth headers and timeout per route); a file is first got to WhatsApp by the media pipeline
 *                (`OutboundMediaUploader`: an upload on the Meta route, a temporary public link on Interakt, which documents no upload).
 *                A refusal (`WabaApiError`) comes back as a `ChannelError` with a stable code and a retry decision (`meta-errors.ts`);
 *                nothing here retries. The emergency halt and the content screen run once, in the dispatcher; the workspace's outgoing
 *                footer is appended to plain text here, after the screen, so it is never read as the sender's own words.
 *   inbound      not here: the WABA webhook authenticates, routes and de-duplicates, then hands each message and delivery report to
 *                the inbox (`WabaInboundSink`), which normalises them with `normaliseMetaWebhook`. Files are copied by the media
 *                pipeline (`inboundMedia`).
 *   health       live reads of the number, the account, the webhook subscription and the token through `WabaAdminPort`.
 *   markRead     read receipt, with the typing indicator on request.
 *
 * Nothing here was exercised against a live Meta or Interakt account; the unit tests run it against recorded payload shapes and a
 * stubbed `fetch`.
 */
export class MetaCloudChannelAdapter implements ChannelAdapter {
  readonly kind = 'whatsapp_cloud' as const;
  readonly live = true;
  /** The webhook is the WABA domain's (`/v2/public/webhooks/whatsapp`), not a per-channel URL. */
  readonly publicWebhook = false;
  /** A WhatsApp channel takes no credentials: they are the connection's. */
  readonly credentialsSchema = null;
  readonly secretFields = [] as const;

  constructor(
    private readonly http: WabaHttp,
    private readonly admin: WabaAdminPort,
    private readonly guard: OutboundSendGuard,
    private readonly uploader: OutboundMediaUploader,
    readonly inboundMedia: InboundMediaFetcher,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  externalIdOf(): string | null {
    return null;
  }

  capabilities(): ChannelCapabilities {
    return { ...META_CAPABILITIES, media: [...META_CAPABILITIES.media] };
  }

  windowInfo(_channel: ChannelRuntime, lastInboundAt: Date | null, now: Date): WindowInfo {
    return windowFromLastInbound(META_CAPABILITIES.windowHours, lastInboundAt, now);
  }

  // --- outbound --------------------------------------------------------------------------------------------------------------

  async send(channel: ChannelRuntime, envelope: OutboundEnvelope): Promise<SendResult> {
    // Before the file upload and any Graph call: a group thread (`g:<group id>`) takes text, files and templates only; the body
    // builder addresses it as a group (never as a phone number).
    if (isGroupPeer(envelope.to)) assertGroupSendKind(envelope.kind);
    const call = this.callContext(channel);
    try {
      let prepared: PreparedWhatsappMedia | undefined;
      if (envelope.kind === 'media') {
        prepared = await this.uploader.prepare(channel, {
          key: envelope.media.key,
          mediaKind: envelope.media.mediaKind,
          mime: envelope.media.mime,
          name: envelope.media.name,
          sha256: envelope.media.sha256,
        });
      }
      const outgoing =
        envelope.kind === 'text'
          ? {
              ...envelope,
              body: await this.guard.withFooter({ orgId: channel.orgId, body: envelope.body }),
            }
          : envelope;
      const json = await this.http.call<{
        messages?: Array<{ id?: unknown; message_status?: unknown }>;
      }>(call.auth, {
        method: 'POST',
        path: `/${call.phoneNumberId}/messages`,
        json: buildMessageBody(outgoing, prepared),
        timeoutMs: SEND_TIMEOUT_MS,
      });
      const first = json.messages?.[0];
      if (typeof first?.id !== 'string' || first.id === '') {
        // Accepted without an id: it may have been sent, so a retry could double-send. Not retryable.
        throw new ChannelError(
          META_FAILURE.BAD_RESPONSE,
          'The provider accepted the message but returned no message id',
          false,
        );
      }
      // A 200 with message_status "failed" is a rejection the receipt webhook will repeat; fail it now.
      if (first.message_status === 'failed') {
        throw new ChannelError(
          META_FAILURE.PROVIDER_REJECTED,
          'WhatsApp rejected the message',
          false,
        );
      }
      return { providerMessageId: first.id, acceptedAt: this.clock() };
    } catch (err) {
      // Meta no longer has the uploaded file (a cached media id went stale): the next attempt must upload again.
      const failure = this.classify(err, call);
      if (
        envelope.kind === 'media' &&
        failure instanceof ChannelError &&
        failure.code === META_FAILURE.MEDIA_REJECTED
      ) {
        await this.uploader
          .forget(channel, {
            key: envelope.media.key,
            mime: envelope.media.mime,
            sha256: envelope.media.sha256,
          })
          .catch(() => undefined);
      }
      throw failure;
    }
  }

  async markRead(
    channel: ChannelRuntime,
    providerMessageId: string,
    options: { typing?: boolean } = {},
  ): Promise<void> {
    const call = this.callContext(channel);
    try {
      await this.http.call(call.auth, {
        method: 'POST',
        path: `/${call.phoneNumberId}/messages`,
        json: {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: providerMessageId,
          ...(options.typing === true ? { typing_indicator: { type: 'text' } } : {}),
        },
        timeoutMs: SEND_TIMEOUT_MS,
      });
    } catch (err) {
      throw this.classify(err, call);
    }
  }

  // --- inbound ---------------------------------------------------------------------------------------------------------------

  /** Never: no provider posts to a channel URL for WhatsApp (see `publicWebhook`). The WABA webhook is the authenticated door. */
  verifyInbound(): boolean {
    return false;
  }

  parseInbound(channel: ChannelRuntime, payload: unknown): ParsedInbound {
    return normaliseMetaWebhook(payload, { phoneNumberId: channel.externalId ?? null });
  }

  // --- connection ------------------------------------------------------------------------------------------------------------

  async checkHealth(channel: ChannelRuntime): Promise<ChannelHealthResult> {
    const call = this.callContext(channel);
    const { conn, auth } = call;
    const read = async <T>(p: Promise<T>): Promise<Read<T>> => {
      try {
        return { ok: true, value: await p };
      } catch (err) {
        const failure = this.classify(err, call);
        return {
          ok: false,
          error:
            failure instanceof ChannelError
              ? failure
              : new ChannelError(META_FAILURE.PROVIDER_UNREACHABLE, failure.message, true),
        };
      }
    };
    const [phone, waba, subscribedApps, token] = await Promise.all([
      read(this.admin.getPhone(auth, call.phoneNumberId)),
      conn.wabaId ? read(this.admin.getWabaDetails(conn)) : Promise.resolve(null),
      conn.wabaId ? read(this.admin.getSubscribedApps(conn)) : Promise.resolve(null),
      // A token of a provider outside Meta cannot be inspected on Graph.
      conn.accessToken && conn.registry?.credentialMode !== 'channel_token'
        ? read(this.admin.inspectToken(conn.accessToken))
        : Promise.resolve(null),
    ]);
    const verdict = buildHealth({ now: this.clock(), phone, waba, subscribedApps, token });
    // The partner key of the Interakt route is the platform's: never ask the customer to paste a token for it.
    return usesPlatformCredential(conn)
      ? {
          ...verdict,
          needsReauth: false,
          providerFault: verdict.needsReauth || verdict.providerFault,
        }
      : verdict;
  }

  // --- internals -------------------------------------------------------------------------------------------------------------

  /** The call context of one channel. A missing id or credential is a permanent refusal that needs a person. */
  private callContext(channel: ChannelRuntime) {
    const ctx = authContextOf(channel);
    const auth = wabaAuthOf(ctx);
    if (!ctx.phoneNumberId || !auth) {
      throw new ChannelError(META_FAILURE.NO_CREDENTIALS, NOT_LINKED_MESSAGE, false, {
        needsReauth: true,
      });
    }
    const conn: WabaConnection = {
      provider: ctx.route,
      wabaId: ctx.wabaId ?? '',
      phoneNumberId: ctx.phoneNumberId,
      accessToken: ctx.channelToken,
      authKey: ctx.authKey,
      ...(ctx.registry ? { registry: ctx.registry } : {}),
    };
    return {
      auth,
      conn,
      phoneNumberId: ctx.phoneNumberId,
      secrets: [ctx.channelToken, ctx.authKey, ...Object.values(ctx.registry?.headers ?? {})],
    };
  }

  /**
   * An error as our vocabulary: a `WabaApiError` through the code table; on the Interakt route a refused credential is the platform's
   * (there is no token the customer could paste), so it goes to `error` and not `needs_reauth`.
   */
  private classify(
    err: unknown,
    call: { conn: WabaConnection; secrets: Array<string | undefined> },
  ): Error {
    if (!(err instanceof WabaApiError)) return err as Error;
    const failure = metaFailure(err, call.secrets);
    if (usesPlatformCredential(call.conn) && failure.needsReauth) {
      return new ChannelError(
        PROVIDER_CREDENTIALS_REJECTED,
        `The WhatsApp provider refused the platform's credentials (${failure.providerCode ?? failure.code}). Contact support.`,
        false,
        { providerFault: true, providerCode: failure.providerCode },
      );
    }
    return failure;
  }
}

/** The platform's own credential does the work (Interakt's partner key, a registry provider in `platform_token` mode): a customer has no token to paste. */
function usesPlatformCredential(conn: WabaConnection): boolean {
  return conn.provider === 'interakt' || conn.registry?.credentialMode === 'platform_token';
}
