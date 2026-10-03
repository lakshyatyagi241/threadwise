import {
  whatsappCloudCredentialsSchema,
  type ChannelCapabilities,
  type WhatsappCloudCredentials,
} from '@crm/contracts';
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
import type { InboundMediaFetcher, OutboundMediaUploader, PreparedWhatsappMedia } from './media';
import { buildHealth, type Read } from './meta-health';
import { META_FAILURE } from './meta-errors';
import type { MetaCtx, MetaGraphClient } from './meta-graph.client';
import { normaliseMetaWebhook } from './meta-inbound';
import { buildMessageBody } from './meta-outbound';
import { verifyDelivery } from './meta-signature';
import type {
  ResolvedWhatsAppProvider,
  WhatsAppProviderResolver,
} from './whatsapp-provider.resolver';

const META_CAPABILITIES: ChannelCapabilities = {
  windowHours: 24,
  templates: true,
  media: ['image', 'video', 'audio', 'document', 'sticker', 'location', 'contact'],
  reactions: true,
  editDelete: false,
  receipts: ['sent', 'delivered', 'read'],
  // The Cloud API shows a typing indicator to the customer together with a read receipt (`markRead` with `typing`).
  typing: true,
};

const settle = async <T>(p: Promise<T>): Promise<Read<T>> => {
  try {
    return { ok: true, value: await p };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof ChannelError
          ? err
          : new ChannelError(META_FAILURE.PROVIDER_UNREACHABLE, (err as Error).message, true),
    };
  }
};

/** What a platform-level credential failing means: not something the customer can fix by pasting a token. */
export const PROVIDER_CREDENTIALS_REJECTED = 'PROVIDER_CREDENTIALS_REJECTED';

/**
 * WhatsApp through a Graph-API-shaped provider as a channel adapter: the first real channel (plan-inbox-chat.md Phase 2).
 *
 * WHICH provider is decided per channel by the `WhatsAppProviderResolver` port: Meta directly with the customer's own token, or a
 * BSP proxy with the platform's credential. The adapter never names a host, a version or a header; it asks the resolver and hands
 * the profile to the Graph client.
 *
 *   send         every outbound kind through `POST /{phone-number-id}/messages`; a file is uploaded first by the media pipeline
 *                (`OutboundMediaUploader`). A refusal comes back as a `ChannelError` with a stable code and a retry decision
 *                (`meta-errors.ts`); the client itself never retries.
 *   inbound      the signature scheme the provider's profile names, over the raw body, with this channel's secret or the provider's;
 *                the payload is normalised by `normaliseMetaWebhook`. Inbound files are copied by the media pipeline (`inboundMedia`).
 *   health       live reads of the number, the account, the webhook subscription and (own token and app id) the token itself.
 *   webhooks     `configureNumberWebhook`: per-number callback override where the provider offers it, else app subscription.
 *   markRead     read receipt, with the typing indicator on request.
 *
 * Nothing here was exercised against a live Meta or BSP account; the unit and end-to-end tests run it against recorded payload
 * shapes and a fake Graph server.
 */
export class MetaCloudChannelAdapter implements ChannelAdapter {
  readonly kind = 'whatsapp_cloud' as const;
  readonly live = true;
  readonly publicWebhook = true;
  readonly credentialsSchema = whatsappCloudCredentialsSchema;
  readonly secretFields = ['accessToken', 'appSecret'] as const;

  constructor(
    private readonly graph: MetaGraphClient,
    private readonly resolver: WhatsAppProviderResolver,
    private readonly uploader: OutboundMediaUploader,
    readonly inboundMedia: InboundMediaFetcher,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  externalIdOf(credentials: Readonly<Record<string, string | undefined>>): string | null {
    return (credentials as Partial<WhatsappCloudCredentials>).phoneNumberId ?? null;
  }

  capabilities(): ChannelCapabilities {
    return { ...META_CAPABILITIES, media: [...META_CAPABILITIES.media] };
  }

  windowInfo(_channel: ChannelRuntime, lastInboundAt: Date | null, now: Date): WindowInfo {
    return windowFromLastInbound(META_CAPABILITIES.windowHours, lastInboundAt, now);
  }

  // --- outbound --------------------------------------------------------------------------------------------------------------

  async send(channel: ChannelRuntime, envelope: OutboundEnvelope): Promise<SendResult> {
    const { ctx, provider } = await this.context(channel);
    try {
      let prepared: PreparedWhatsappMedia | undefined;
      if (envelope.kind === 'media') {
        prepared = await this.uploader.prepare(channel, {
          key: envelope.media.key,
          mediaKind: envelope.media.mediaKind,
          mime: envelope.media.mime,
          name: envelope.media.name,
        });
      }
      const sent = await this.graph.sendMessage(ctx, buildMessageBody(envelope, prepared));
      return { providerMessageId: sent.messageId, acceptedAt: this.clock() };
    } catch (err) {
      // Meta no longer has the uploaded file (a cached media id went stale): the next attempt must upload again.
      if (envelope.kind === 'media' && err instanceof ChannelError && err.code === META_FAILURE.MEDIA_REJECTED) {
        await this.uploader.forget(channel, { key: envelope.media.key, mime: envelope.media.mime }).catch(() => undefined);
      }
      throw this.attribute(err, provider);
    }
  }

  async markRead(channel: ChannelRuntime, providerMessageId: string, options: { typing?: boolean } = {}): Promise<void> {
    const { ctx, provider } = await this.context(channel);
    try {
      await this.graph.markRead(ctx, providerMessageId, options.typing === true);
    } catch (err) {
      throw this.attribute(err, provider);
    }
  }

  // --- inbound ---------------------------------------------------------------------------------------------------------------

  async verifyInbound(
    channel: ChannelRuntime,
    rawBody: Buffer,
    headers: Readonly<Record<string, string | undefined>>,
  ): Promise<boolean> {
    let provider: ResolvedWhatsAppProvider;
    try {
      provider = await this.resolver.resolveForChannel(channel);
    } catch {
      return false; // no provider for this channel's workspace: nothing to verify against, nothing accepted
    }
    // The channel's own app secret wins when it has one (a customer's own Meta app signs with that); otherwise the provider's.
    const secret = channel.credentials.appSecret ?? provider.webhook.secret;
    return verifyDelivery(provider.webhook.signatureScheme, secret, provider.webhook.headerName, rawBody, headers);
  }

  parseInbound(channel: ChannelRuntime, payload: unknown): ParsedInbound {
    return normaliseMetaWebhook(payload, {
      phoneNumberId: channel.externalId ?? channel.credentials.phoneNumberId ?? null,
    });
  }

  // --- connection ------------------------------------------------------------------------------------------------------------

  async credentialRequirements(orgId: number) {
    const provider = await this.resolver.resolveForChannel({ orgId, uuid: '', externalId: null, credentials: {} });
    return {
      providerKey: provider.providerKey,
      credentialMode: provider.credentialMode,
      // The webhook signature needs an app secret only when the customer's own Meta app is the sender.
      required:
        provider.credentialMode === 'platform_token'
          ? ['phoneNumberId', 'businessAccountId']
          : ['phoneNumberId', 'accessToken', 'appSecret'],
    };
  }

  async checkHealth(channel: ChannelRuntime): Promise<ChannelHealthResult> {
    const { ctx, provider } = await this.context(channel);
    const withAccount = ctx.wabaId ? { ...ctx, wabaId: ctx.wabaId } : null;
    const withApp =
      provider.credentialMode === 'channel_token' && ctx.channelToken && ctx.appId && ctx.appSecret
        ? { ...ctx, channelToken: ctx.channelToken, appId: ctx.appId, appSecret: ctx.appSecret }
        : null;

    const [phone, waba, subscribedApps, token] = await Promise.all([
      settle(this.graph.getPhoneNumber(ctx)),
      withAccount ? settle(this.graph.getWaba(withAccount)) : Promise.resolve(null),
      withAccount ? settle(this.graph.getSubscribedApps(withAccount)) : Promise.resolve(null),
      withApp ? settle(this.graph.debugToken(withApp)) : Promise.resolve(null),
    ]);
    const attributed = <T>(r: Read<T> | null): Read<T> | null =>
      r && !r.ok ? { ok: false, error: this.attribute(r.error, provider) as ChannelError } : r;
    const verdict = buildHealth({
      now: this.clock(),
      phone: attributed(phone)!,
      waba: attributed(waba),
      subscribedApps: attributed(subscribedApps),
      token,
    });
    // A platform credential failing is not something the customer can fix: never ask them to paste a token for it.
    return provider.credentialMode === 'platform_token' ? { ...verdict, needsReauth: false } : verdict;
  }

  async webhookMode(channel: ChannelRuntime): Promise<'subscribe' | 'number_override'> {
    const { provider } = await this.context(channel);
    // A BSP proxy has no app-level callback for this customer: the URL must be set per number.
    return provider.credentialMode === 'platform_token' && provider.capabilities.numberWebhookConfig ? 'number_override' : 'subscribe';
  }

  async configureNumberWebhook(
    channel: ChannelRuntime,
    config?: { callbackUrl: string; verifyToken: string },
  ): Promise<{ overrideApplied: boolean }> {
    const { ctx, provider } = await this.context(channel);
    try {
      if (config && provider.capabilities.numberWebhookConfig) {
        await this.graph.setNumberWebhook(ctx, config);
        return { overrideApplied: true };
      }
      if (!ctx.wabaId) {
        throw new ChannelError(
          'CHANNEL_ACCOUNT_ID_MISSING',
          'Add the WhatsApp Business Account id to this channel before configuring its webhook',
          false,
        );
      }
      await this.graph.subscribeApp({ ...ctx, wabaId: ctx.wabaId }, config);
      return { overrideApplied: config !== undefined };
    } catch (err) {
      throw this.attribute(err, provider);
    }
  }

  // --- internals -------------------------------------------------------------------------------------------------------------

  /** The provider profile and the call context for one channel. Missing ids are a permanent refusal that needs a person. */
  private async context(channel: ChannelRuntime): Promise<{ ctx: MetaCtx; provider: ResolvedWhatsAppProvider }> {
    const c = channel.credentials;
    const phoneNumberId = channel.externalId ?? c.phoneNumberId;
    const provider = await this.resolver.resolveForChannel(channel).catch((err: Error) => {
      throw new ChannelError(
        PROVIDER_CREDENTIALS_REJECTED,
        `No WhatsApp provider is available for this workspace: ${err.message}`,
        false,
        { providerFault: true },
      );
    });
    const own = provider.credentialMode === 'channel_token';
    if (!phoneNumberId || (own && !c.accessToken)) {
      throw new ChannelError(
        META_FAILURE.NO_CREDENTIALS,
        'This WhatsApp channel has no usable access token or phone number id. Enter the credentials again.',
        false,
        { needsReauth: true },
      );
    }
    return {
      provider,
      ctx: {
        provider,
        phoneNumberId,
        wabaId: c.businessAccountId,
        channelToken: own ? c.accessToken : undefined,
        appId: c.appId,
        appSecret: c.appSecret,
      },
    };
  }

  /**
   * In `platform_token` mode a refused credential is the platform's: the code says so and the channel goes to `error`, not to
   * `needs_reauth`, because there is no token the customer could paste.
   */
  private attribute(err: unknown, provider: ResolvedWhatsAppProvider): unknown {
    if (provider.credentialMode === 'platform_token' && err instanceof ChannelError && err.needsReauth) {
      return new ChannelError(
        PROVIDER_CREDENTIALS_REJECTED,
        `The WhatsApp provider refused the platform's credentials (${err.providerCode ?? err.code}). Contact support.`,
        false,
        { providerFault: true, providerCode: err.providerCode },
      );
    }
    return err;
  }
}
