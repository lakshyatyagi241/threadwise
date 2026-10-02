import { Inject, Injectable, Logger } from '@nestjs/common';
import { WABA_ENV, type WabaEnv } from '../../../config/domains/whatsapp-cloud-api-waba.env';
import {
  authOf,
  type BusinessProfile,
  type PhoneInfo,
  type PlatformReadiness,
  type SubscribeResult,
  type TokenExchange,
  type TokenInspection,
  type WabaAdminPort,
  type WabaConnection,
} from './waba-admin.port';
import { WabaApiError } from './waba-errors';
import { WabaHttp, type WabaAuth } from './waba-http';

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
    const token = conn.accessToken;
    if (!token) throw noToken();
    await this.http.graph(token, {
      method: 'POST',
      path: `/${conn.phoneNumberId}/register`,
      json: { messaging_product: 'whatsapp', pin },
    });
  }

  async unsubscribe(conn: WabaConnection): Promise<void> {
    if (!conn.accessToken) throw noToken();
    await this.http.graph(conn.accessToken, {
      method: 'DELETE',
      path: `/${conn.wabaId}/subscribed_apps`,
    });
  }

  async verifyInboundWired(conn: WabaConnection, expectedUrl: string): Promise<boolean | null> {
    if (!conn.accessToken) return null;
    try {
      const res = await this.http.graph<{
        data?: Array<{
          whatsapp_business_api_data?: { id?: string; override_callback_uri?: string };
        }>;
      }>(conn.accessToken, { method: 'GET', path: `/${conn.wabaId}/subscribed_apps` });
      const want = expectedUrl.replace(/\/+$/, '');
      for (const entry of res.data ?? []) {
        const d = entry.whatsapp_business_api_data;
        if (d?.override_callback_uri && d.override_callback_uri.replace(/\/+$/, '') === want)
          return true;
        if (
          d?.id &&
          this.env.META_APP_ID &&
          d.id === this.env.META_APP_ID &&
          conn.provider === 'meta'
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
