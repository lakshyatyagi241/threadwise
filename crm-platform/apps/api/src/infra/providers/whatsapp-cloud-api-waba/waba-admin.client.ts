import { Inject, Injectable, Logger } from '@nestjs/common';
import { WABA_ENV, type WabaEnv } from '../../../config/domains/whatsapp-cloud-api-waba.env';
import {
  authOf,
  type BusinessProfile,
  type AppSubscriptionState,
  type QrCodeInfo,
  type SubscriptionDetail,
  type PhoneInfo,
  type PlatformReadiness,
  type SubscribeResult,
  type TokenExchange,
  type TokenInspection,
  type WabaAdminPort,
  type WabaConnection,
  type WabaDetails,
} from './waba-admin.port';
import { WabaApiError } from './waba-errors';
import { WabaHttp, type WabaAuth, type WabaRequest } from './waba-http';

/** Every field the connect screens and the health page read, in one request (union of Reference's and Geta's lists). */
export const PHONE_FIELDS = [
  'verified_name',
  'display_phone_number',
  'quality_rating',
  'messaging_limit_tier',
  'code_verification_status',
  'name_status',
  'account_mode',
  'throughput',
  'platform_type',
  'is_official_business_account',
  'is_pin_enabled',
  'last_onboarded_time',
  'status',
].join(',');

const PROFILE_FIELDS = 'about,address,description,email,profile_picture_url,websites,vertical';

/** Meta needs a moment after a first subscribe before it accepts an override (#100); Reference retries 3 x 1 s. */
const OVERRIDE_RETRIES = 3;
const OVERRIDE_RETRY_DELAY_MS = 1_000;

interface RawPhone {
  id: string;
  verified_name?: string;
  display_phone_number?: string;
  quality_rating?: string;
  messaging_limit_tier?: string;
  code_verification_status?: string;
  name_status?: string;
  account_mode?: string;
  throughput?: unknown;
  platform_type?: string;
  is_official_business_account?: boolean;
  is_pin_enabled?: boolean;
  last_onboarded_time?: string;
  status?: string;
}

const toPhone = (p: RawPhone): PhoneInfo => ({
  id: p.id,
  verifiedName: p.verified_name ?? null,
  // Meta formats the number for display ("+91 91122 90122"); everything downstream wants digits and a plus.
  displayPhoneNumber: p.display_phone_number ? p.display_phone_number.replace(/\s+/g, '') : null,
  displayPhoneNumberRaw: p.display_phone_number ?? null,
  qualityRating: p.quality_rating ?? null,
  messagingLimitTier: p.messaging_limit_tier ?? null,
  codeVerificationStatus: p.code_verification_status ?? null,
  nameStatus: p.name_status ?? null,
  accountMode: p.account_mode ?? null,
  throughput: p.throughput ?? null,
  platformType: p.platform_type ?? null,
  isOfficialBusinessAccount: p.is_official_business_account ?? null,
  isPinEnabled: p.is_pin_enabled ?? null,
  lastOnboardedTime: p.last_onboarded_time ?? null,
  status: p.status ?? null,
});

/**
 * Meta Graph + Interakt adapter for account operations.
 *
 * The split mirrors what Geta runs in production: the Embedded Signup exchange, token inspection, phone listing and the app
 * subscription are ALWAYS Graph calls with the business token; Interakt adds only the partner registration and, for runtime
 * calls (phone details, profile), the `amped-express` route with the partner key. Geta never ran an Interakt-routed
 * `override_callback_uri` through `subscribed_apps` (its attempt overwrote the payload with `{}`); the proven call is the
 * per-phone `webhook_configuration` (migrate_waba.py), which is what `subscribe` uses for the Interakt route.
 */
@Injectable()
export class WabaAdminClient implements WabaAdminPort {
  private readonly logger = new Logger(WabaAdminClient.name);

  /** Replaced in tests so the retry loop does not really wait. */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));

  constructor(
    @Inject(WABA_ENV) private readonly env: WabaEnv,
    private readonly http: WabaHttp,
  ) {}

  readiness(): PlatformReadiness {
    const e = this.env;
    const missing: string[] = [];
    if (!e.META_APP_ID) missing.push('META_APP_ID');
    if (!e.META_APP_SECRET) missing.push('META_APP_SECRET');
    if (!e.META_EMBEDDED_CONFIG_ID) missing.push('META_EMBEDDED_CONFIG_ID');
    if (e.WABA_DEFAULT_PROVIDER === 'interakt') {
      if (!e.INTERAKT_PARTNER_AUTH_KEY) missing.push('INTERAKT_PARTNER_AUTH_KEY');
      if (!e.INTERAKT_SOLUTION_ID) missing.push('INTERAKT_SOLUTION_ID');
    }
    return {
      embeddedSignupReady: missing.length === 0,
      appId: e.META_APP_ID ?? null,
      configId: e.META_EMBEDDED_CONFIG_ID ?? null,
      solutionId: e.INTERAKT_SOLUTION_ID ?? null,
      graphVersion: e.META_API_VERSION,
      coexistence: e.WABA_COEXISTENCE,
      defaultProvider: e.WABA_DEFAULT_PROVIDER,
      missing,
    };
  }

  // --- tokens ------------------------------------------------------------------------------------------------------

  async exchangeCode(code: string): Promise<TokenExchange> {
    const { META_APP_ID: id, META_APP_SECRET: secret } = this.env;
    if (!id || !secret) throw notConfigured('META_APP_ID and META_APP_SECRET');
    const res = await this.http.graph<{ access_token?: string; expires_in?: number }>(
      this.env.META_SYSTEM_USER_TOKEN ?? null,
      // No redirect_uri on purpose: a popup code is in-window, and sending one switches Meta to classic OAuth validation (100/191).
      {
        method: 'GET',
        path: '/oauth/access_token',
        query: { client_id: id, client_secret: secret, code },
      },
    );
    if (!res.access_token) throw new Error('Meta accepted the code but returned no access token');
    return {
      accessToken: res.access_token,
      expiresInSeconds: res.expires_in && res.expires_in > 0 ? res.expires_in : null,
    };
  }

  async extendToken(token: string, app?: { id: string; secret: string }): Promise<TokenExchange> {
    const id = app?.id ?? this.env.META_APP_ID;
    const secret = app?.secret ?? this.env.META_APP_SECRET;
    if (!id || !secret) return { accessToken: token, expiresInSeconds: null };
    try {
      const res = await this.http.graph<{ access_token?: string; expires_in?: number }>(null, {
        method: 'GET',
        path: '/oauth/access_token',
        query: {
          grant_type: 'fb_exchange_token',
          client_id: id,
          client_secret: secret,
          fb_exchange_token: token,
        },
      });
      if (!res.access_token) return { accessToken: token, expiresInSeconds: null };
      return {
        accessToken: res.access_token,
        expiresInSeconds: res.expires_in && res.expires_in > 0 ? res.expires_in : null,
      };
    } catch {
      // A token the app cannot extend still works; Reference keeps the pasted one.
      return { accessToken: token, expiresInSeconds: null };
    }
  }

  async inspectToken(token: string): Promise<TokenInspection> {
    const inspector = this.inspectorToken();
    const res = await this.http.graph<{
      data?: {
        is_valid?: boolean;
        user_id?: string;
        app_id?: string;
        scopes?: string[];
        expires_at?: number;
        granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
      };
    }>(inspector, { method: 'GET', path: '/debug_token', query: { input_token: token } });
    const d = res.data ?? {};
    const wabaIds = (d.granular_scopes ?? [])
      .filter((g) => g.scope === 'whatsapp_business_management')
      .flatMap((g) => g.target_ids ?? []);
    return {
      isValid: d.is_valid !== false,
      userId: d.user_id ?? null,
      appId: d.app_id ?? null,
      scopes: d.scopes ?? [],
      wabaIds,
      expiresAt: d.expires_at && d.expires_at > 0 ? new Date(d.expires_at * 1000) : null,
    };
  }

  /** `debug_token` needs an app or system-user token, not the one being inspected. */
  private inspectorToken(): string {
    if (this.env.META_SYSTEM_USER_TOKEN) return this.env.META_SYSTEM_USER_TOKEN;
    if (this.env.META_APP_ID && this.env.META_APP_SECRET)
      return `${this.env.META_APP_ID}|${this.env.META_APP_SECRET}`;
    throw notConfigured('META_APP_ID and META_APP_SECRET (or META_SYSTEM_USER_TOKEN)');
  }

  // --- discovery ---------------------------------------------------------------------------------------------------

  async discoverWabaId(token: string): Promise<string | null> {
    const inspected = await this.inspectToken(token);
    if (inspected.wabaIds[0]) return inspected.wabaIds[0];
    if (!this.env.META_BUSINESS_ID) return null;
    const res = await this.http.graph<{ data?: Array<{ id: string }> }>(token, {
      method: 'GET',
      path: `/${this.env.META_BUSINESS_ID}/client_whatsapp_business_accounts`,
    });
    return res.data?.[0]?.id ?? null;
  }

  async listPhoneNumbers(token: string, wabaId: string): Promise<PhoneInfo[]> {
    const res = await this.http.graph<{ data?: RawPhone[] }>(token, {
      method: 'GET',
      path: `/${wabaId}/phone_numbers`,
      query: { fields: `id,${PHONE_FIELDS}` },
    });
    return (res.data ?? []).map(toPhone);
  }

  async getPhone(auth: WabaAuth, phoneNumberId: string): Promise<PhoneInfo> {
    const res = await this.http.call<RawPhone>(auth, {
      method: 'GET',
      path: `/${phoneNumberId}`,
      query: { fields: PHONE_FIELDS },
    });
    return toPhone({ ...res, id: res.id ?? phoneNumberId });
  }

  async getOwnerBusiness(
    token: string,
    wabaId: string,
  ): Promise<{ id: string; name: string | null } | null> {
    try {
      const res = await this.http.graph<{ owner_business_info?: { id?: string; name?: string } }>(
        token,
        {
          method: 'GET',
          path: `/${wabaId}`,
          query: { fields: 'owner_business_info{id,name}' },
          timeoutMs: 10_000,
        },
      );
      const o = res.owner_business_info;
      return o?.id ? { id: o.id, name: o.name ?? null } : null;
    } catch {
      return null;
    }
  }

  async isBusinessVerified(token: string, businessId: string): Promise<boolean> {
    try {
      const res = await this.http.graph<{ verification_status?: string }>(token, {
        method: 'GET',
        path: `/${businessId}`,
        query: { fields: 'verification_status' },
      });
      return res.verification_status === 'verified';
    } catch {
      return false;
    }
  }

  // --- webhook wiring ----------------------------------------------------------------------------------------------

  async subscribe(
    conn: WabaConnection,
    callback: { url: string; verifyToken: string },
  ): Promise<SubscribeResult> {
    if (conn.registry) return this.subscribeViaRegistry(conn, callback);
    const token = conn.accessToken;
    if (!token) return { ok: false, overrideApplied: false, error: noToken() };
    return conn.provider === 'interakt'
      ? this.subscribeViaInterakt(conn, token, callback)
      : this.subscribeDirect(conn, token, callback);
  }

  /**
   * Interakt: the WABA is subscribed to the platform's Meta app (Graph, business token), then the per-phone callback is
   * pointed at us through Interakt. Interakt did not document `verify_token` there, so it is offered first and dropped on a 4xx.
   */
  private async subscribeViaInterakt(
    conn: WabaConnection,
    token: string,
    callback: { url: string; verifyToken: string },
  ): Promise<SubscribeResult> {
    try {
      await this.http.graph(token, { method: 'POST', path: `/${conn.wabaId}/subscribed_apps` });
    } catch (e) {
      return { ok: false, overrideApplied: false, error: asApiError(e) };
    }
    if (!conn.authKey) return { ok: true, overrideApplied: false };
    const auth = authOf(conn);
    for (const body of [
      {
        webhook_configuration: {
          override_callback_uri: callback.url,
          verify_token: callback.verifyToken,
        },
      },
      { webhook_configuration: { override_callback_uri: callback.url } },
    ]) {
      try {
        await this.http.call(auth, { method: 'POST', path: `/${conn.phoneNumberId}`, json: body });
        return { ok: true, overrideApplied: true };
      } catch (e) {
        const err = asApiError(e);
        if (err.missingBusinessManagement) return { ok: false, overrideApplied: false, error: err };
        this.logger.warn(
          { phoneNumberId: conn.phoneNumberId, status: err.status, code: err.code },
          'interakt callback override refused',
        );
      }
    }
    return { ok: true, overrideApplied: false };
  }

  /**
   * A number on a provider of the registry (`conn.registry`): the same Graph-shaped calls, through the provider's own address and
   * credential. Like the built-in Interakt route the WABA is subscribed first and the per-number callback override is then offered
   * (`verify_token` first, dropped on a refusal); a provider whose webhook is configured once on the Meta app (`meta_app_level`) is
   * only subscribed. Nothing here was exercised against a live provider.
   */
  private async subscribeViaRegistry(
    conn: WabaConnection,
    callback: { url: string; verifyToken: string },
  ): Promise<SubscribeResult> {
    const route = conn.registry!;
    try {
      await this.http.call(route, { method: 'POST', path: `/${conn.wabaId}/subscribed_apps` });
    } catch (e) {
      return { ok: false, overrideApplied: false, error: asApiError(e) };
    }
    if (route.webhookMode !== 'number_level_override') return { ok: true, overrideApplied: false };
    for (const body of [
      {
        webhook_configuration: {
          override_callback_uri: callback.url,
          verify_token: callback.verifyToken,
        },
      },
      { webhook_configuration: { override_callback_uri: callback.url } },
    ]) {
      try {
        await this.http.call(route, { method: 'POST', path: `/${conn.phoneNumberId}`, json: body });
        return { ok: true, overrideApplied: true };
      } catch (e) {
        const err = asApiError(e);
        if (err.missingBusinessManagement) return { ok: false, overrideApplied: false, error: err };
        this.logger.warn(
          { providerKey: route.providerKey, status: err.status, code: err.code },
          'registry provider callback override refused',
        );
      }
    }
    return { ok: true, overrideApplied: false };
  }

  /** The account node of a connection: through its registry provider, else Graph with the business token. */
  private viaRoute<T>(conn: WabaConnection, req: WabaRequest): Promise<T> {
    if (conn.registry) return this.http.call<T>(conn.registry, req);
    if (!conn.accessToken) return Promise.reject(noToken());
    return this.http.graph<T>(conn.accessToken, req);
  }

  /** Reference TW-WABA-011: atomic subscribe + override, plain subscribe fallback, then retry the override. */
  private async subscribeDirect(
    conn: WabaConnection,
    token: string,
    callback: { url: string; verifyToken: string },
  ): Promise<SubscribeResult> {
    const path = `/${conn.wabaId}/subscribed_apps`;
    try {
      await this.http.graph(token, {
        method: 'POST',
        path,
        json: { override_callback_uri: callback.url, verify_token: callback.verifyToken },
      });
      return { ok: true, overrideApplied: true };
    } catch (e) {
      const err = asApiError(e);
      if (err.missingBusinessManagement) return { ok: false, overrideApplied: false, error: err };
    }

    try {
      await this.http.graph(token, { method: 'POST', path });
    } catch (e) {
      return { ok: false, overrideApplied: false, error: asApiError(e) };
    }

    for (let i = 0; i < OVERRIDE_RETRIES; i++) {
      await this.sleep(OVERRIDE_RETRY_DELAY_MS);
      try {
        await this.http.graph(token, {
          method: 'POST',
          path,
          json: { override_callback_uri: callback.url, verify_token: callback.verifyToken },
        });
        return { ok: true, overrideApplied: true };
      } catch (e) {
        const err = asApiError(e);
        if (err.missingBusinessManagement) return { ok: false, overrideApplied: false, error: err };
      }
    }
    // Subscribed, but inbound only reaches us if the app's own webhook configuration points here.
    return { ok: true, overrideApplied: false };
  }

  async registerWithInterakt(wabaId: string, phone: string | null): Promise<boolean> {
    const { INTERAKT_PARTNER_AUTH_KEY: key, INTERAKT_SOLUTION_ID: solution } = this.env;
    if (!key || !solution) return false;
    try {
      await this.http.absolute(this.env.INTERAKT_TP_SIGNUP_URL, {
        method: 'POST',
        // The raw key, no "Bearer": that is how tp-signup authenticates.
        headers: { authorization: key },
        json: {
          entry: [
            {
              changes: [
                {
                  value: {
                    event: 'PARTNER_ADDED',
                    waba_info: {
                      waba_id: wabaId,
                      solution_id: solution,
                      phone_number: phone ?? '',
                    },
                  },
                },
              ],
            },
          ],
          object: 'tech_partner',
        },
      });
      return true;
    } catch (e) {
      this.logger.warn({ wabaId, err: asApiError(e).message }, 'interakt tp-signup failed');
      return false;
    }
  }

  async assignSystemUser(wabaId: string, _token: string): Promise<boolean> {
    const { META_SYSTEM_USER_ID: user, META_SYSTEM_USER_TOKEN: sys } = this.env;
    if (!user || !sys) return false;
    try {
      await this.http.graph(sys, {
        method: 'POST',
        path: `/${wabaId}/assigned_users`,
        query: { user, tasks: "['MANAGE']" },
      });
      return true;
    } catch (e) {
      this.logger.warn({ wabaId, err: asApiError(e).message }, 'assigning the system user failed');
      return false;
    }
  }

  async registerPhone(conn: WabaConnection, pin: string): Promise<void> {
    if (!conn.registry && !conn.accessToken) throw noToken();
    await this.viaRoute(conn, {
      method: 'POST',
      path: `/${conn.phoneNumberId}/register`,
      json: { messaging_product: 'whatsapp', pin },
    });
  }

  async requestVerificationCode(
    conn: WabaConnection,
    method: 'SMS' | 'VOICE',
    language: string,
  ): Promise<void> {
    if (!conn.registry && !conn.accessToken) throw noToken();
    await this.viaRoute(conn, {
      method: 'POST',
      path: `/${conn.phoneNumberId}/request_code`,
      json: { code_method: method, language },
    });
  }

  async verifyCode(conn: WabaConnection, code: string): Promise<void> {
    if (!conn.registry && !conn.accessToken) throw noToken();
    await this.viaRoute(conn, {
      method: 'POST',
      path: `/${conn.phoneNumberId}/verify_code`,
      json: { code },
    });
  }

  async unsubscribe(conn: WabaConnection): Promise<void> {
    if (!conn.registry && !conn.accessToken) throw noToken();
    await this.viaRoute(conn, {
      method: 'DELETE',
      path: `/${conn.wabaId}/subscribed_apps`,
    });
  }

  async verifyInboundWired(conn: WabaConnection, expectedUrl: string): Promise<boolean | null> {
    if (!conn.registry && !conn.accessToken) return null;
    try {
      const res = await this.viaRoute<{
        data?: Array<{
          whatsapp_business_api_data?: { id?: string; override_callback_uri?: string };
        }>;
      }>(conn, { method: 'GET', path: `/${conn.wabaId}/subscribed_apps` });
      const want = expectedUrl.replace(/\/+$/, '');
      for (const entry of res.data ?? []) {
        const d = entry.whatsapp_business_api_data;
        if (d?.override_callback_uri && d.override_callback_uri.replace(/\/+$/, '') === want)
          return true;
        if (
          d?.id &&
          this.env.META_APP_ID &&
          d.id === this.env.META_APP_ID &&
          conn.provider === 'meta' &&
          !conn.registry
        )
          return true;
      }
      return null;
    } catch (e) {
      this.logger.warn(
        { wabaId: conn.wabaId, err: asApiError(e).message },
        'could not read the WABA subscription',
      );
      return null;
    }
  }

  async getWabaDetails(conn: WabaConnection): Promise<WabaDetails> {
    const auth = authOf(conn);
    const rich =
      'name,currency,timezone_id,account_review_status,business_verification_status,ownership_type,owner_business_info{id,name}';
    const safe = 'name,currency,timezone_id,account_review_status';
    const read = async (fields: string) =>
      this.http.call<{
        name?: string;
        currency?: string;
        timezone_id?: string;
        account_review_status?: string;
        business_verification_status?: string;
        ownership_type?: string;
        owner_business_info?: { name?: string };
      }>(auth, { method: 'GET', path: `/${conn.wabaId}`, query: { fields }, timeoutMs: 12_000 });
    let r;
    try {
      r = await read(rich);
    } catch (e) {
      // One unreadable field fails the whole request: retry with the subset that always reads.
      if (asApiError(e).status === 0) throw e;
      r = await read(safe);
    }
    return {
      name: r.name ?? null,
      currency: r.currency ?? null,
      timezoneId: r.timezone_id ?? null,
      accountReviewStatus: r.account_review_status ?? null,
      businessVerificationStatus: r.business_verification_status ?? null,
      ownerBusinessName: r.owner_business_info?.name ?? null,
      ownershipType: r.ownership_type ?? null,
    };
  }

  async getSubscribedApps(conn: WabaConnection): Promise<string[]> {
    const res = await this.http.call<{
      data?: Array<{ whatsapp_business_api_data?: { id?: string; name?: string; link?: string } }>;
    }>(authOf(conn), {
      method: 'GET',
      path: `/${conn.wabaId}/subscribed_apps`,
      timeoutMs: 12_000,
    });
    return (res.data ?? []).map(
      (d) => d.whatsapp_business_api_data?.name ?? d.whatsapp_business_api_data?.id ?? 'app',
    );
  }

  // --- the Meta app's own subscription and the per-WABA diagnostic (TW-WABA-002, 003, 015) -------------------------------

  async getAppSubscription(app: { id: string; secret: string }): Promise<AppSubscriptionState> {
    const res = await this.http.graph<{
      data?: Array<{
        object?: string;
        callback_url?: string;
        fields?: Array<string | { name?: string }>;
      }>;
    }>(`${app.id}|${app.secret}`, {
      method: 'GET',
      path: `/${app.id}/subscriptions`,
      timeoutMs: 15_000,
    });
    const waba = (res.data ?? []).find((s) => s.object === 'whatsapp_business_account');
    return {
      hasWabaObject: Boolean(waba),
      fields: (waba?.fields ?? [])
        .map((f) => (typeof f === 'string' ? f : (f.name ?? '')))
        .filter(Boolean),
      callbackUrl: waba?.callback_url ?? null,
    };
  }

  async setAppSubscription(
    app: { id: string; secret: string },
    input: { callbackUrl: string; verifyToken: string; fields: string[] },
  ): Promise<void> {
    const form = new FormData();
    form.set('object', 'whatsapp_business_account');
    form.set('callback_url', input.callbackUrl);
    form.set('fields', input.fields.join(','));
    form.set('verify_token', input.verifyToken);
    await this.http.graph(`${app.id}|${app.secret}`, {
      method: 'POST',
      path: `/${app.id}/subscriptions`,
      form,
      timeoutMs: 20_000,
    });
  }

  async getSubscriptionDetails(conn: WabaConnection): Promise<SubscriptionDetail[]> {
    const res = await this.http.call<{
      data?: Array<{
        name?: string;
        whatsapp_business_api_data?: { id?: string; name?: string; override_callback_uri?: string };
      }>;
    }>(authOf(conn), {
      method: 'GET',
      path: `/${conn.wabaId}/subscribed_apps`,
      timeoutMs: 12_000,
    });
    return (res.data ?? []).map((d) => ({
      name: d.whatsapp_business_api_data?.name ?? d.name ?? null,
      callbackUrl: d.whatsapp_business_api_data?.override_callback_uri ?? null,
    }));
  }

  // --- analytics, username, QR codes (TW-WABA-023, 025, 027) -------------------------------------------------------

  async getTemplateClicks(
    conn: WabaConnection,
    templateIds: string[],
    startSeconds: number,
    endSeconds: number,
  ): Promise<number> {
    const res = await this.http.call<{
      data?: Array<{
        data_points?: Array<{ template_id?: string; clicked?: Array<{ count?: number }> }>;
      }>;
    }>(authOf(conn), {
      method: 'GET',
      path: `/${conn.wabaId}/template_analytics`,
      query: {
        start: String(startSeconds),
        end: String(endSeconds),
        granularity: 'DAILY',
        metric_types: JSON.stringify(['CLICKED']),
        template_ids: JSON.stringify(templateIds.map(Number)),
      },
      timeoutMs: 20_000,
    });
    return sumClicks(res, templateIds);
  }

  async enableTemplateInsights(conn: WabaConnection): Promise<void> {
    const form = new FormData();
    form.set('is_enabled_for_insights', 'true');
    await this.http.call(authOf(conn), {
      method: 'POST',
      path: `/${conn.wabaId}`,
      form,
      timeoutMs: 15_000,
    });
  }

  async getConversationAnalytics(
    conn: WabaConnection,
    startSeconds: number,
    endSeconds: number,
  ): Promise<Array<{ conversation_type?: string; conversation?: number; cost?: number }>> {
    const fields = `conversation_analytics.start(${startSeconds}).end(${endSeconds}).granularity(MONTHLY).dimensions(["CONVERSATION_TYPE"])`;
    const res = await this.http.call<{
      conversation_analytics?: {
        data?: Array<{
          data_points?: Array<{ conversation_type?: string; conversation?: number; cost?: number }>;
        }>;
      };
    }>(authOf(conn), {
      method: 'GET',
      path: `/${conn.wabaId}`,
      query: { fields },
      timeoutMs: 12_000,
    });
    return (res.conversation_analytics?.data ?? []).flatMap((d) => d.data_points ?? []);
  }

  async getReservedUsername(conn: WabaConnection): Promise<string | null> {
    const res = await this.http.call<{ username?: string | { username?: string } }>(authOf(conn), {
      method: 'GET',
      path: `/${conn.phoneNumberId}`,
      query: { fields: 'username' },
      timeoutMs: 12_000,
    });
    const u = typeof res.username === 'string' ? res.username : res.username?.username;
    return u ? u.toLowerCase() : null;
  }

  async claimUsername(conn: WabaConnection, username: string): Promise<'reserved' | 'approved'> {
    const form = new FormData();
    form.set('username', username);
    const res = await this.http.call<{ status?: string; username_status?: string }>(authOf(conn), {
      method: 'POST',
      path: `/${conn.phoneNumberId}/username`,
      form,
      timeoutMs: 20_000,
    });
    const s = String(res.status ?? res.username_status ?? 'reserved').toLowerCase();
    return s === 'approved' ? 'approved' : 'reserved';
  }

  async releaseUsername(conn: WabaConnection): Promise<void> {
    await this.http.call(authOf(conn), {
      method: 'DELETE',
      path: `/${conn.phoneNumberId}/username`,
      timeoutMs: 20_000,
    });
  }

  async listQrCodes(conn: WabaConnection): Promise<QrCodeInfo[]> {
    const res = await this.http.call<{ data?: QrCodeRaw[] }>(authOf(conn), {
      method: 'GET',
      path: `/${conn.phoneNumberId}/message_qrdls`,
      query: { fields: 'code,prefilled_message,deep_link_url,qr_image_url' },
      timeoutMs: 20_000,
    });
    return (res.data ?? []).map(toQr);
  }

  async createQrCode(conn: WabaConnection, prefilledMessage: string): Promise<QrCodeInfo> {
    const form = new FormData();
    form.set('prefilled_message', prefilledMessage);
    form.set('generate_qr_image', 'PNG');
    const res = await this.http.call<QrCodeRaw>(authOf(conn), {
      method: 'POST',
      path: `/${conn.phoneNumberId}/message_qrdls`,
      form,
      timeoutMs: 20_000,
    });
    return toQr({ ...res, prefilled_message: res.prefilled_message ?? prefilledMessage });
  }

  async deleteQrCode(conn: WabaConnection, code: string): Promise<void> {
    await this.http.call(authOf(conn), {
      method: 'DELETE',
      path: `/${conn.phoneNumberId}/message_qrdls/${encodeURIComponent(code)}`,
      timeoutMs: 20_000,
    });
  }

  // --- business profile --------------------------------------------------------------------------------------------

  async getBusinessProfile(conn: WabaConnection): Promise<BusinessProfile> {
    const res = await this.http.call<{
      data?: Array<{
        about?: string;
        address?: string;
        description?: string;
        email?: string;
        profile_picture_url?: string;
        websites?: string[];
        vertical?: string;
      }>;
    }>(authOf(conn), {
      method: 'GET',
      path: `/${conn.phoneNumberId}/whatsapp_business_profile`,
      query: { fields: PROFILE_FIELDS },
    });
    const p = res.data?.[0] ?? {};
    return {
      about: p.about ?? null,
      address: p.address ?? null,
      description: p.description ?? null,
      email: p.email ?? null,
      profilePictureUrl: p.profile_picture_url ?? null,
      websites: p.websites ?? [],
      vertical: p.vertical ?? null,
    };
  }

  async updateBusinessProfile(
    conn: WabaConnection,
    patch: Partial<BusinessProfile> & { profilePictureHandle?: string },
  ): Promise<void> {
    const body: Record<string, unknown> = { messaging_product: 'whatsapp' };
    if (patch.about !== undefined) body.about = patch.about;
    if (patch.address !== undefined) body.address = patch.address;
    if (patch.description !== undefined) body.description = patch.description;
    if (patch.email !== undefined) body.email = patch.email;
    if (patch.websites !== undefined) body.websites = patch.websites;
    if (patch.vertical !== undefined) body.vertical = patch.vertical;
    if (patch.profilePictureHandle) body.profile_picture_handle = patch.profilePictureHandle;
    await this.http.call(authOf(conn), {
      method: 'POST',
      path: `/${conn.phoneNumberId}/whatsapp_business_profile`,
      json: body,
    });
  }
}

interface QrCodeRaw {
  code?: string;
  prefilled_message?: string;
  deep_link_url?: string;
  qr_image_url?: string;
}

const toQr = (r: QrCodeRaw): QrCodeInfo => ({
  code: r.code ?? '',
  prefilledMessage: r.prefilled_message ?? '',
  deepLinkUrl: r.deep_link_url ?? (r.code ? `https://wa.me/message/${r.code}` : null),
  qrImageUrl: r.qr_image_url ?? null,
});

function asApiError(e: unknown): WabaApiError {
  return e instanceof WabaApiError ? e : WabaApiError.network(e);
}

const noToken = () =>
  new WabaApiError(
    'This connection has no access token. Reconnect the number.',
    0,
    null,
    null,
    null,
    null,
    null,
    false,
    null,
  );

const notConfigured = (what: string) =>
  new WabaApiError(
    `WhatsApp onboarding is not configured on this platform: set ${what}.`,
    0,
    null,
    null,
    null,
    null,
    null,
    false,
    null,
  );

/** Every button `count` of every day bucket, for the requested templates only (a response may carry others). */
export function sumClicks(
  res: {
    data?: Array<{
      data_points?: Array<{ template_id?: string | number; clicked?: Array<{ count?: number }> }>;
    }>;
  },
  templateIds: string[],
): number {
  const wanted = new Set(templateIds.map(String));
  let total = 0;
  for (const bucket of res.data ?? []) {
    for (const point of bucket.data_points ?? []) {
      if (point.template_id !== undefined && !wanted.has(String(point.template_id))) continue;
      for (const c of point.clicked ?? []) total += Number(c.count ?? 0);
    }
  }
  return total;
}
