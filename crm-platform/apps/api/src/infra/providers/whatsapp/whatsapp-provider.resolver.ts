import { graphApiConfig } from './graph-api.config';

/**
 * PORT: which WhatsApp provider a channel talks through, and how.
 *
 * WhatsApp traffic does not have to go to Meta directly with a token the customer pasted. The platform can send through a BSP whose
 * Partner API is a Meta Graph API compatible proxy (Interakt: the same paths and payloads under another base URL, authenticated with
 * headers instead of `Authorization: Bearer`), with one platform-level credential and the customer's WABA and number ids. The Graph
 * client therefore never hardcodes a host, a version or an authentication scheme: it asks this port, per channel, and uses what comes
 * back.
 *
 * WHO IMPLEMENTS IT
 *   - `StaticMetaDirectResolver` (below, bound by default): graph.facebook.com (or `GRAPH_API_BASE_URL`), `Authorization: Bearer` with
 *     the channel's own sealed access token, webhooks signed with the channel's own app secret. Mode `channel_token`.
 *   - The WhatsApp provider registry (`modules/whatsapp-providers`, platform admin): reads the platform-level provider row and the
 *     workspace's assignment, opens the sealed platform credentials and answers with a profile whose `buildHeaders` carries them.
 *     Mode `platform_token`. It is bound by passing it to `WhatsappProviderResolverModule.register({ resolver })` where
 *     `ChatConversationsModule` imports that module; nothing else changes.
 *
 * WHAT A PROFILE MEANS
 *   - `baseUrl` + `apiVersion` form the root every path is appended to: `<baseUrl>/<apiVersion>/<path>`. Interakt:
 *     `https://amped-express.interakt.ai/api` + `v24.0`. No trailing slash on `baseUrl`.
 *   - `buildHeaders` returns every header the provider needs for ONE call (the access token, the account and number ids). It is the only
 *     place a credential is turned into a header, and the Graph client scrubs every value it returns from errors and logs.
 *   - `credentialMode`: `channel_token` = the channel's own sealed credentials hold an `accessToken` (and, for signed webhooks, an
 *     `appSecret`); `platform_token` = the channel holds only `{ phoneNumberId, businessAccountId }` and the platform's credential does
 *     the work, so a failed token is the platform's problem, not something the customer can fix.
 *   - `webhook`: how a delivery for this provider proves who sent it. `meta_app_secret_sha256`: `X-Hub-Signature-256` over the raw
 *     body with `secret`. `shared_secret_header`: the request carries `headerName` equal to `secret`. A null `secret` fails closed
 *     (nothing is accepted). `verifyToken` answers the GET subscription challenge of the provider-level route (null: no challenge).
 *   - `capabilities`: which calls the provider supports; the adapter only makes the ones that are `true` (a health check asks for
 *     `health_status` only when `healthStatus` is set; webhook configuration per number only when `numberWebhookConfig` is).
 */
export type WhatsAppCredentialMode = 'platform_token' | 'channel_token';

export interface WhatsAppProviderCapabilities {
  templates: boolean;
  mediaUpload: boolean;
  businessProfile: boolean;
  /** `?fields=health_status` is answered (the can_send_message entities). */
  healthStatus: boolean;
  /** `POST /{phone-number-id}` with `webhook_configuration` sets this number's callback and verify token. */
  numberWebhookConfig: boolean;
  analytics: boolean;
}

export interface WhatsAppWebhookScheme {
  signatureScheme: 'meta_app_secret_sha256' | 'shared_secret_header';
  /** The secret the delivery is checked with. Null: not configured, every delivery is refused. */
  secret: string | null;
  /** For `shared_secret_header`: the header that carries the secret (lower case). */
  headerName?: string;
  /** The verify token the provider-level GET challenge must present. Null: that route answers no challenge. */
  verifyToken?: string | null;
}

export interface HeaderContext {
  wabaId?: string;
  phoneNumberId?: string;
  /** The channel's own access token (credential mode `channel_token`). */
  channelToken?: string;
}

export interface ResolvedWhatsAppProvider {
  providerKey: string;
  adapterKind: 'meta_graph';
  baseUrl: string;
  apiVersion: string;
  credentialMode: WhatsAppCredentialMode;
  buildHeaders(ctx: HeaderContext): Record<string, string>;
  webhook: WhatsAppWebhookScheme;
  capabilities: WhatsAppProviderCapabilities;
}

/** What a resolver needs to know about a channel. `ChannelRuntime` satisfies it structurally. */
export interface ChannelProviderRef {
  orgId: number;
  uuid: string;
  externalId: string | null;
  /** The channel's opened credentials (empty in `platform_token` mode but for the ids). Never logged. */
  credentials: Readonly<Record<string, string | undefined>>;
}

export interface WhatsAppProviderResolver {
  /** The provider this channel's workspace is assigned to. Throws when there is none. */
  resolveForChannel(channel: ChannelProviderRef): Promise<ResolvedWhatsAppProvider>;
  /** A provider by its key, for the provider-level webhook route (no channel is known yet). Null for an unknown or switched-off key. */
  resolveByKey(providerKey: string): Promise<ResolvedWhatsAppProvider | null>;
}

export const WHATSAPP_PROVIDER_RESOLVER = Symbol('WHATSAPP_PROVIDER_RESOLVER');

/** The `root` a profile's paths hang from. */
export const providerRoot = (p: Pick<ResolvedWhatsAppProvider, 'baseUrl' | 'apiVersion'>): string =>
  `${p.baseUrl.replace(/\/+$/, '')}/${p.apiVersion}`;

/** The key of the built-in direct-to-Meta provider. */
export const META_DIRECT_PROVIDER_KEY = 'meta_direct';

/**
 * The default: Meta's Graph API directly, authenticated with the channel's own token, webhooks signed with the channel's own app
 * secret. The base URL and version come from `GRAPH_API_BASE_URL` / `META_GRAPH_VERSION` at call time (a test points them at a fake
 * server). It has no platform-level secret, so the provider-level webhook route has nothing to verify with and refuses everything
 * until a registry-backed resolver replaces it.
 */
export class StaticMetaDirectResolver implements WhatsAppProviderResolver {
  resolveForChannel(): Promise<ResolvedWhatsAppProvider> {
    return Promise.resolve(this.profile());
  }

  resolveByKey(providerKey: string): Promise<ResolvedWhatsAppProvider | null> {
    return Promise.resolve(providerKey === META_DIRECT_PROVIDER_KEY ? this.profile() : null);
  }

  private profile(): ResolvedWhatsAppProvider {
    const cfg = graphApiConfig();
    return {
      providerKey: META_DIRECT_PROVIDER_KEY,
      adapterKind: 'meta_graph',
      baseUrl: cfg.baseUrl,
      apiVersion: cfg.version,
      credentialMode: 'channel_token',
      buildHeaders: ({ channelToken }): Record<string, string> =>
        channelToken ? { authorization: `Bearer ${channelToken}` } : {},
      webhook: { signatureScheme: 'meta_app_secret_sha256', secret: null, verifyToken: null },
      capabilities: {
        templates: true,
        mediaUpload: true,
        businessProfile: true,
        healthStatus: true,
        numberWebhookConfig: true,
        analytics: true,
      },
    };
  }
}
