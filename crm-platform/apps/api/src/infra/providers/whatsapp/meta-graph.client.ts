import { ChannelError } from '../chat-conversations/channel.port';
import { GraphTransportError, type GraphHttp, type GraphRequest, type GraphResponse } from './graph-http';
import { META_FAILURE, metaFailure, scrub, transportFailure } from './meta-errors';
import { providerRoot, type ResolvedWhatsAppProvider } from './whatsapp-provider.resolver';

/**
 * A small typed client for the parts of the Graph API the WhatsApp channel uses, written against a RESOLVED PROVIDER PROFILE
 * (`whatsapp-provider.resolver.ts`) instead of graph.facebook.com: the base URL, the API version and the authentication headers all
 * come from the profile, so the same client speaks to Meta directly and to a Graph-compatible BSP proxy.
 *
 * It does three things and nothing else: build the path, call the HTTP seam, and turn a failure into a `ChannelError`
 * (`meta-errors.ts`). No retries (the dispatch worker owns them), no caching, no state. Every secret that is in a request (each
 * authentication header value, the channel token, the app secret) is scrubbed out of every error message before it leaves.
 */
export interface MetaCtx {
  provider: ResolvedWhatsAppProvider;
  phoneNumberId: string;
  /** The WhatsApp Business Account (WABA) id: needed for the account node, the subscription and (BSP) the `x-waba-id` header. */
  wabaId?: string;
  /** The channel's own access token (credential mode `channel_token`). */
  channelToken?: string;
  /** With `appSecret` and a channel token: lets `debug_token` ask Meta about the token itself. */
  appId?: string;
  appSecret?: string;
}

export interface SentMessage {
  /** The wamid. */
  messageId: string;
  /** The recipient as WhatsApp resolved it (`contacts[0].wa_id`). */
  recipientWaId: string | null;
}

export interface PhoneNode {
  verified_name?: string;
  display_phone_number?: string;
  quality_rating?: string;
  messaging_limit_tier?: string;
  code_verification_status?: string;
  name_status?: string;
  status?: string;
  platform_type?: string;
  throughput?: { level?: string };
  health_status?: HealthStatus;
}

export interface WabaNode {
  name?: string;
  account_review_status?: string;
  business_verification_status?: string;
  health_status?: HealthStatus;
}

export interface HealthStatus {
  can_send_message?: string;
  entities?: Array<{
    entity_type?: string;
    id?: string;
    can_send_message?: string;
    errors?: Array<{ error_code?: number; error_description?: string; possible_solution?: string }>;
    additional_info?: string[];
  }>;
}

export interface TokenDebug {
  is_valid?: boolean;
  /** Seconds since the epoch; 0 for a token that never expires (a System User token). */
  expires_at?: number;
  scopes?: string[];
}

const PHONE_FIELDS_RICH =
  'verified_name,display_phone_number,quality_rating,messaging_limit_tier,code_verification_status,name_status,status,platform_type,throughput,health_status';
/** What every Meta account can read; used when the richer request is refused (one unreadable field fails the whole call). */
const PHONE_FIELDS_CORE =
  'verified_name,display_phone_number,quality_rating,messaging_limit_tier,code_verification_status,name_status,status,platform_type';
/** The field list a BSP's Partner API documents for a number; the last resort. */
const PHONE_FIELDS_MINIMAL =
  'status,is_official_business_account,id,name_status,code_verification_status,display_phone_number,platform_type,messaging_limit_tier,throughput';
const WABA_FIELDS_RICH = 'name,account_review_status,business_verification_status,health_status';
const WABA_FIELDS_CORE = 'name,account_review_status,business_verification_status';
const WABA_FIELDS_HEALTH = 'health_status';

export class MetaGraphClient {
  constructor(private readonly http: GraphHttp, private readonly sendTimeoutMs: () => number, private readonly readTimeoutMs: () => number) {}

  /** `POST /{phone-number-id}/messages`. */
  async sendMessage(ctx: MetaCtx, body: Record<string, unknown>): Promise<SentMessage> {
    const res = await this.call(ctx, 'POST', `/${ctx.phoneNumberId}/messages`, { body, timeoutMs: this.sendTimeoutMs() });
    const json = res.json as { messages?: Array<{ id?: unknown }>; contacts?: Array<{ wa_id?: unknown }> } | null;
    const id = json?.messages?.[0]?.id;
    if (typeof id !== 'string' || id === '') {
      // Accepted without an id: it may have been sent, so a retry could double-send. Not retryable.
      throw new ChannelError(META_FAILURE.BAD_RESPONSE, 'The provider accepted the message but returned no message id', false);
    }
    const wa = json?.contacts?.[0]?.wa_id;
    return { messageId: id, recipientWaId: typeof wa === 'string' ? wa : null };
  }

  /** Marks an inbound message read; with `typing`, also shows the typing indicator to the customer (until a reply or 25 s). */
  async markRead(ctx: MetaCtx, messageId: string, typing = false): Promise<void> {
    await this.call(ctx, 'POST', `/${ctx.phoneNumberId}/messages`, {
      body: {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        ...(typing ? { typing_indicator: { type: 'text' } } : {}),
      },
      timeoutMs: this.readTimeoutMs(),
    });
  }

  /** `GET /{phone-number-id}`. A refused field list falls back to a shorter one: rich, core, then the BSP's documented list. */
  async getPhoneNumber(ctx: MetaCtx): Promise<PhoneNode> {
    const lists = ctx.provider.capabilities.healthStatus
      ? [PHONE_FIELDS_RICH, PHONE_FIELDS_CORE, PHONE_FIELDS_MINIMAL]
      : [PHONE_FIELDS_CORE, PHONE_FIELDS_MINIMAL];
    return this.readNode<PhoneNode>(ctx, `/${ctx.phoneNumberId}`, lists);
  }

  /** `GET /{waba-id}`. */
  async getWaba(ctx: MetaCtx & { wabaId: string }): Promise<WabaNode> {
    const lists = ctx.provider.capabilities.healthStatus ? [WABA_FIELDS_RICH, WABA_FIELDS_CORE, WABA_FIELDS_HEALTH] : [WABA_FIELDS_CORE];
    return this.readNode<WabaNode>(ctx, `/${ctx.wabaId}`, lists);
  }

  /** `GET /{waba-id}/subscribed_apps`: the apps whose webhooks this account feeds. */
  async getSubscribedApps(ctx: MetaCtx & { wabaId: string }): Promise<Array<{ id?: string; name?: string }>> {
    const res = await this.call(ctx, 'GET', `/${ctx.wabaId}/subscribed_apps`, { timeoutMs: this.readTimeoutMs() });
    const data = (res.json as { data?: Array<{ whatsapp_business_api_data?: { id?: string; name?: string } }> } | null)?.data;
    return (data ?? []).map((d) => ({ id: d.whatsapp_business_api_data?.id, name: d.whatsapp_business_api_data?.name }));
  }

  /**
   * `POST /{waba-id}/subscribed_apps`. With `override`, Meta is told to deliver THIS account's webhooks to `callbackUrl` (verified
   * with `verifyToken`, which Meta echoes back in its own GET challenge during this very call) instead of the app's default.
   */
  async subscribeApp(
    ctx: MetaCtx & { wabaId: string },
    override?: { callbackUrl: string; verifyToken: string },
  ): Promise<void> {
    await this.call(ctx, 'POST', `/${ctx.wabaId}/subscribed_apps`, {
      body: override ? { override_callback_uri: override.callbackUrl, verify_token: override.verifyToken } : undefined,
      timeoutMs: this.readTimeoutMs(),
    });
  }

  /** `POST /{phone-number-id}` with `webhook_configuration`: this number's callback and verify token (Meta and BSP proxies). */
  async setNumberWebhook(ctx: MetaCtx, cfg: { callbackUrl: string; verifyToken: string }): Promise<void> {
    await this.call(ctx, 'POST', `/${ctx.phoneNumberId}`, {
      body: { webhook_configuration: { override_callback_uri: cfg.callbackUrl, verify_token: cfg.verifyToken } },
      timeoutMs: this.readTimeoutMs(),
    });
  }

  /** `GET /debug_token`, asked with the app's own credentials (`app_id|app_secret`): validity, expiry and scopes of the token. */
  async debugToken(ctx: MetaCtx & { channelToken: string; appId: string; appSecret: string }): Promise<TokenDebug> {
    const res = await this.call(ctx, 'GET', '/debug_token', {
      query: { input_token: ctx.channelToken, access_token: `${ctx.appId}|${ctx.appSecret}` },
      timeoutMs: this.readTimeoutMs(),
      noAuthHeaders: true,
    });
    return (res.json as { data?: TokenDebug } | null)?.data ?? {};
  }

  // --- internals -------------------------------------------------------------------------------------------------------------

  private async readNode<T>(ctx: MetaCtx, path: string, fieldLists: string[]): Promise<T> {
    let last: unknown;
    for (const fields of fieldLists) {
      try {
        const res = await this.call(ctx, 'GET', path, { query: { fields }, timeoutMs: this.readTimeoutMs() });
        return (res.json ?? {}) as T;
      } catch (err) {
        last = err;
        // 100 (or a bare 400): a field in the list is not readable for this account. Anything else (a bad token, a down service)
        // would fail the same way again, so it is not retried with a shorter list.
        const fieldProblem = err instanceof ChannelError && (err.providerCode === '100' || err.providerCode === '400');
        if (!fieldProblem) throw err;
      }
    }
    throw last;
  }

  /** Every value that must never reach a log, an error or a screen: what the headers carry, the token, the app secret. */
  private secretsOf(ctx: MetaCtx, headers: Record<string, string>): string[] {
    const fromHeaders = Object.entries(headers)
      .filter(([k]) => !/^(accept|content-type|content-length)$/i.test(k))
      .flatMap(([, v]) => [v, v.replace(/^Bearer\s+/i, '')]);
    return [...fromHeaders, ctx.channelToken ?? '', ctx.appSecret ?? ''].filter((s) => s.length >= 6);
  }

  /** One call; a non-2xx answer or a failed connection becomes a `ChannelError`. */
  private async call(
    ctx: MetaCtx,
    method: GraphRequest['method'],
    path: string,
    opts: { body?: unknown; query?: Record<string, string | undefined>; timeoutMs: number; noAuthHeaders?: boolean },
  ): Promise<GraphResponse> {
    const headers = opts.noAuthHeaders
      ? {}
      : ctx.provider.buildHeaders({ wabaId: ctx.wabaId, phoneNumberId: ctx.phoneNumberId, channelToken: ctx.channelToken });
    const secrets = this.secretsOf(ctx, headers);
    let res: GraphResponse;
    try {
      res = await this.http.request({
        method,
        root: providerRoot(ctx.provider),
        path,
        query: opts.query,
        body: opts.body,
        headers,
        timeoutMs: opts.timeoutMs,
      });
    } catch (err) {
      if (err instanceof GraphTransportError) throw transportFailure(err);
      throw new ChannelError(META_FAILURE.PROVIDER_UNREACHABLE, scrub((err as Error).message, secrets), true);
    }
    if (res.status >= 200 && res.status < 300) return res;
    throw metaFailure(res, secrets);
  }
}
