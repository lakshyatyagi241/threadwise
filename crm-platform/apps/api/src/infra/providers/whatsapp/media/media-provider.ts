import { WabaHttp, type WabaAuth } from '../../whatsapp-cloud-api-waba/waba-http';

/**
 * Where a channel's WhatsApp calls go and how they are authenticated, as the media pipeline needs it.
 *
 * There is ONE WhatsApp client in the platform: `WabaHttp` (the WABA domain's). It knows the two routes a number can use (Meta Graph
 * directly with the business token, or Interakt's Graph proxy with the tech-partner key), the base address and API version of each,
 * and the headers each wants; the media pipeline asks it, never hardcodes a host or an `Authorization` header. A channel's route and
 * credentials come from the connection it is linked to (`ChannelRuntime.credentials`: `route`, `accessToken`, `authKey`,
 * `businessAccountId`), opened by the channel registry for the one call.
 *
 * The pipeline needs only a slice of that: `MediaProviderProfile` (a test can build one in a few lines).
 */
export type MediaRoute = 'meta' | 'interakt';

export interface MediaAuthContext {
  route: MediaRoute;
  /** The WhatsApp Business Account id (Interakt's `x-waba-id`). */
  wabaId?: string;
  phoneNumberId?: string;
  /** Meta route: the business access token. */
  channelToken?: string;
  /** Interakt route: the tech-partner key. */
  authKey?: string;
}

export interface MediaProviderProfile {
  /** `https://graph.facebook.com` or `https://amped-express.interakt.ai/api`: no version, no trailing slash. */
  baseUrl: string;
  /** `v25.0`. */
  apiVersion: string;
  /** `channel_token`: the customer's business token does the work (Meta route). `platform_token`: the platform's partner key does (Interakt). */
  credentialMode: 'platform_token' | 'channel_token';
  buildHeaders(ctx: MediaAuthContext): Record<string, string>;
  /** Whether the route has a media upload endpoint. Interakt documents none: a file goes by public link instead. */
  capabilities: { mediaUpload: boolean };
}

/** The slice of a channel the pipeline reads. `ChannelRuntime` satisfies it structurally. */
export interface MediaChannel {
  orgId: number;
  uuid: string;
  externalId: string | null;
  /** Opened credentials; never logged. */
  credentials: Readonly<Record<string, string | undefined>>;
}

/** What a channel contributes to header building. */
export function authContextOf(channel: MediaChannel): MediaAuthContext {
  const c = channel.credentials;
  return {
    route: c.route === 'interakt' ? 'interakt' : 'meta',
    wabaId: c.businessAccountId,
    phoneNumberId: channel.externalId ?? c.phoneNumberId,
    channelToken: c.accessToken,
    authKey: c.authKey,
  };
}

/** The `WabaHttp` credentials for a context, or null when the connection has none (nothing is sent without them). */
export function wabaAuthOf(ctx: MediaAuthContext): WabaAuth | null {
  if (ctx.route === 'interakt') {
    return ctx.authKey && ctx.wabaId
      ? {
          provider: 'interakt',
          authKey: ctx.authKey,
          wabaId: ctx.wabaId,
          phoneNumberId: ctx.phoneNumberId,
        }
      : null;
  }
  return ctx.channelToken ? { provider: 'meta', accessToken: ctx.channelToken } : null;
}

/** The profile of one route, from `WabaHttp`'s own configuration (read on each call: the platform admin can change it live). */
export function profileOf(http: WabaHttp, route: MediaRoute): MediaProviderProfile {
  const root = http.baseUrl(route);
  const cut = root.lastIndexOf('/');
  return {
    baseUrl: root.slice(0, cut),
    apiVersion: root.slice(cut + 1),
    credentialMode: route === 'interakt' ? 'platform_token' : 'channel_token',
    buildHeaders: (ctx) => {
      const auth = wabaAuthOf(ctx);
      return auth ? http.headers(auth) : {};
    },
    capabilities: { mediaUpload: route !== 'interakt' },
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
