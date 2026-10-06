import { Injectable } from '@nestjs/common';
import {
  isBuiltinWhatsappProviderKey,
  renderHeaderTemplates,
  type WhatsappAuthScheme,
  type WhatsappCredentialMode,
  type WhatsappProviderStatus,
  type WhatsappSignatureScheme,
  type WhatsappWebhookMode,
} from '@crm/contracts';
import type { WabaRegistryAuth } from './waba-http';

/**
 * A provider of the platform's WhatsApp provider registry as the send path needs it, secrets opened. Loaded from the database by the
 * `whatsapp-providers` module (the resolver) and kept here, in memory, so every consumer (the inbox adapter, broadcasts, templates, the
 * media pipeline) can turn "the provider this number is on" into a route without a database round trip and without importing a module.
 */
export interface WabaRegistryProvider {
  key: string;
  /** `meta` / `interakt` for the two rows that mirror the WABA module's own routes: those are never routed from here. */
  builtin: 'meta' | 'interakt' | null;
  status: WhatsappProviderStatus;
  baseUrl: string;
  apiVersion: string;
  authScheme: WhatsappAuthScheme;
  headerTemplates: Readonly<Record<string, string>>;
  credentialMode: WhatsappCredentialMode;
  webhookMode: WhatsappWebhookMode;
  signatureScheme: WhatsappSignatureScheme;
  signatureHeaderName: string | null;
  capabilities: { mediaUpload: boolean };
  /** A partner onboarding flow after Embedded Signup, with its solution id (public). */
  partnerProgram?: 'pinnacle' | null;
  partnerSolutionId?: string | null;
  /** Embedded Signup app and configuration of this provider (public); null/absent: the platform's own. */
  onboardingAppId?: string | null;
  onboardingConfigId?: string | null;
  providerToken?: string;
  appSecret?: string;
  webhookSecret?: string;
  verifyToken?: string;
}

/** What a number contributes to a route: its ids and, for a `channel_token` provider, its own token. */
export interface RouteValues {
  wabaId?: string;
  phoneNumberId?: string;
  /** The number's own access token (`wa_provider_configs.credentials_json`). */
  accessToken?: string;
}

/** The provider key of a connection: `meta_json.provider_key`, else the legacy `provider` value (`interakt`, anything else is `meta`). */
export function providerKeyOf(meta: Record<string, unknown> | null | undefined): string {
  const m = meta ?? {};
  if (typeof m.provider_key === 'string' && m.provider_key !== '') return m.provider_key;
  return m.provider === 'interakt' ? 'interakt' : 'meta';
}

@Injectable()
export class WabaRegistryRoutes {
  private byKey = new Map<string, WabaRegistryProvider>();

  /** Replaces the whole snapshot (the resolver refreshes it). */
  replace(providers: readonly WabaRegistryProvider[]): void {
    this.byKey = new Map(providers.map((p) => [p.key, p]));
  }

  get(key: string): WabaRegistryProvider | undefined {
    return this.byKey.get(key);
  }

  /** The verify tokens of the registry's active providers: each answers the GET challenge of its own subscription. */
  verifyTokens(): string[] {
    return [...this.byKey.values()]
      .filter((p) => !p.builtin && p.status !== 'archived' && p.verifyToken)
      .map((p) => p.verifyToken!);
  }

  /**
   * The route of a connection on provider `key`, or null when it has none: the key is built in (those go through WabaHttp's own
   * routes), unknown, archived, or the credential its mode needs is missing. A disabled provider still routes: disabling stops new
   * numbers going to it, it must not stop the ones already there from sending.
   */
  authFor(key: string, values: RouteValues): WabaRegistryAuth | null {
    if (isBuiltinWhatsappProviderKey(key)) return null;
    const p = this.byKey.get(key);
    if (!p || p.builtin || p.status === 'archived') return null;
    const token = p.credentialMode === 'platform_token' ? p.providerToken : values.accessToken;
    if (!token) return null;
    let headers: Record<string, string>;
    try {
      headers =
        p.authScheme === 'bearer'
          ? { authorization: `Bearer ${token}` }
          : renderHeaderTemplates(p.headerTemplates, {
              providerToken: p.providerToken,
              channelToken: values.accessToken,
              wabaId: values.wabaId,
              phoneNumberId: values.phoneNumberId,
            });
    } catch {
      return null; // a value that must not enter a header (a token with a line break): refuse the route, never forge a header
    }
    if (Object.keys(headers).length === 0) return null;
    return {
      provider: 'registry',
      providerKey: p.key,
      baseUrl: p.baseUrl.replace(/\/+$/, ''),
      apiVersion: p.apiVersion,
      headers,
      credentialMode: p.credentialMode,
      webhookMode: p.webhookMode,
      capabilities: { mediaUpload: p.capabilities.mediaUpload },
    };
  }
}
