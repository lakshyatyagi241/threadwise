import type {
  ChannelProviderRef,
  HeaderContext,
  ResolvedWhatsAppProvider,
  WhatsAppProviderResolver,
} from '../whatsapp-provider.resolver';

/**
 * Where a channel's WhatsApp calls go and how they are authenticated, as the media pipeline needs it.
 *
 * WhatsApp is reached either directly through Meta's Graph API (the channel's own bearer token) or through a Graph-compatible BSP proxy
 * (Interakt's Partner API: another address, and `x-access-token` / `x-waba-id` headers instead of `Authorization: Bearer`). The media
 * pipeline therefore never hardcodes a host or an `Authorization` header: it asks the platform's `WhatsAppProviderResolver` (global
 * `WHATSAPP_PROVIDER_RESOLVER`, `whatsapp-provider.resolver.ts`) for the channel's provider and uses its base URL, its headers and its
 * `mediaUpload` capability for the media lookup, the upload and, where the download host is the provider's own or Meta's, the file
 * download. Without a bound resolver the direct-to-Meta default is used.
 *
 * The pipeline needs only a slice of `ResolvedWhatsAppProvider` (so a test can build one in a few lines): `MediaProviderProfile`.
 */
export type MediaProviderProfile = Pick<
  ResolvedWhatsAppProvider,
  'baseUrl' | 'apiVersion' | 'credentialMode' | 'buildHeaders'
> & { capabilities: Pick<ResolvedWhatsAppProvider['capabilities'], 'mediaUpload'> };

export type MediaAuthContext = HeaderContext;
/** `ChannelRuntime` satisfies this structurally. */
export type MediaChannel = ChannelProviderRef;
export type MediaProviderResolver = Pick<WhatsAppProviderResolver, 'resolveForChannel'>;

/** What a channel contributes to header building. */
export function authContextOf(channel: MediaChannel): MediaAuthContext {
  const c = channel.credentials;
  return {
    wabaId: c.businessAccountId,
    phoneNumberId: channel.externalId ?? c.phoneNumberId,
    channelToken: c.accessToken,
  };
}

/** `<baseUrl>/<apiVersion>`, the root every call is appended to. */
export const rootOf = (p: Pick<MediaProviderProfile, 'baseUrl' | 'apiVersion'>): string =>
  `${p.baseUrl.replace(/\/+$/, '')}/${p.apiVersion}`;

export const providerHostOf = (p: Pick<MediaProviderProfile, 'baseUrl'>): string =>
  new URL(p.baseUrl).hostname.toLowerCase();

/**
 * The values of a header set: what must never reach a log or an error message. A bearer value is listed twice, whole and without its
 * scheme, because a provider that echoes a credential back in an error text echoes the bare token.
 */
export const secretsIn = (headers: Record<string, string>): string[] =>
  Object.values(headers).flatMap((v) => [v, v.replace(/^Bearer\s+/i, '')]);
