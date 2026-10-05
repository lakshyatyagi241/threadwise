import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ERROR_CODES, isBuiltinWhatsappProviderKey } from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import { WABA_ENV, type WabaEnv } from '../../config/domains/whatsapp-cloud-api-waba.env';
import {
  WabaRegistryRoutes,
  type WabaRegistryProvider,
} from '../../infra/providers/whatsapp-cloud-api-waba/waba-registry-routes';
import { chooseNewNumberProvider, type ProviderSecrets, type RouteSource } from './provider-rules';
import { ProviderStore, type ProviderRow } from './provider-store';

/** How often each process re-reads the registry, so a change made through the operator API reaches the worker without a restart. */
const REFRESH_MS = 15_000;
/** A provider key the snapshot does not know is re-read at most this often (a provider created a moment ago, a number just switched). */
const UNKNOWN_KEY_RELOAD_MS = 2_000;

const BUILTIN_LABELS: Record<string, string> = {
  meta: 'Meta Cloud API (direct)',
  interakt: 'Interakt Partner API',
};

/** The provider a number connected now goes through. */
export interface NewNumberRoute {
  key: string;
  label: string;
  source: RouteSource;
  /** The legacy family: `interakt` for the built-in Interakt route, `meta` for everything else. Routing uses `key` and `registry`. */
  provider: 'meta' | 'interakt';
  /** The provider's descriptor, secrets opened; null for the two built-in routes (the WABA module's own code and environment). */
  registry: WabaRegistryProvider | null;
}

/** Opens a stored provider row into what the send path keeps in memory. */
export function openProvider(row: ProviderRow, crypto: CryptoService): WabaRegistryProvider {
  let secrets: ProviderSecrets = {};
  if (row.credentials_enc) {
    try {
      secrets = JSON.parse(crypto.decrypt(row.credentials_enc)) as ProviderSecrets;
    } catch {
      secrets = {}; // an unreadable envelope is "no secret": the provider cannot send until the operator saves it again
    }
  }
  return {
    key: row.key,
    builtin: row.builtin,
    status: row.status,
    baseUrl: row.base_url,
    apiVersion: row.api_version,
    authScheme: row.auth_scheme,
    headerTemplates: row.header_templates,
    credentialMode: row.credential_mode,
    webhookMode: row.webhook_mode,
    signatureScheme: row.signature_scheme,
    signatureHeaderName: row.signature_header_name,
    capabilities: { mediaUpload: row.capabilities?.mediaUpload !== false },
    ...secrets,
  };
}

/**
 * Which provider carries a WhatsApp number (the provider registry's read side).
 *
 *   new numbers   the workspace's override, else the registry default, else the platform setting (`WABA_DEFAULT_PROVIDER`).
 *   a connection  the `provider_key` its `meta_json` records; rows from before the registry have none and are `interakt` or `meta`
 *                 by their old `provider` value, which is exactly what they were routed by.
 *
 * The registry is kept in memory (`WabaRegistryRoutes`, in the global providers module) and re-read every few seconds, so a send
 * never waits on this table. Built-in `meta` and `interakt` are never routed from the registry: they keep going through `WabaHttp`'s own
 * routes and `WABA_ENV`, so an empty registry changes nothing.
 */
@Injectable()
export class WhatsAppProviderResolver implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppProviderResolver.name);
  private timer?: NodeJS.Timeout;
  private lastLoadAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly store: ProviderStore,
    private readonly crypto: CryptoService,
    private readonly routes: WabaRegistryRoutes,
    @Inject(WABA_ENV) private readonly env: WabaEnv,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Re-reads the registry into memory. Single-flight; a failure keeps what is in memory (a database outage must not stop sending). */
  refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = this.store
      .tx((tx) => this.store.forRouting(tx))
      .then((rows) => {
        this.routes.replace(rows.map((r) => openProvider(r, this.crypto)));
        this.lastLoadAt = Date.now();
      })
      .catch((e: unknown) => {
        this.logger.warn(
          { err: (e as Error).message },
          'could not refresh the WhatsApp provider registry',
        );
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  /** The verify tokens providers of the registry hold, besides the platform's own (the webhook's GET handshake accepts either). */
  verifyTokens(): string[] {
    return this.routes.verifyTokens();
  }

  /** After a write through the operator API: this process sees it now, the others within the refresh interval. */
  invalidate(): Promise<void> {
    this.lastLoadAt = 0;
    return this.refresh();
  }

  /** Makes sure `key` is in memory when it exists: a provider created or a number switched moments ago may not be in this process yet. */
  async ensureKnown(key: string): Promise<void> {
    if (isBuiltinWhatsappProviderKey(key) || this.routes.get(key)) return;
    if (Date.now() - this.lastLoadAt < UNKNOWN_KEY_RELOAD_MS) return;
    await this.refresh();
  }

  /** The provider a number connected NOW for this workspace goes through, or the reason it cannot. */
  async forNewNumbers(orgId: number): Promise<NewNumberRoute> {
    const { assignment, registryDefault } = await this.store.tx(async (tx) => ({
      assignment: await this.store.assignmentOf(tx, orgId),
      registryDefault: await this.store.defaultActive(tx),
    }));

    const choice = chooseNewNumberProvider({
      override: assignment
        ? { key: assignment.provider_key, status: assignment.provider_status }
        : null,
      registryDefault: registryDefault ? { key: registryDefault.key } : null,
      platformSetting: this.env.WABA_DEFAULT_PROVIDER,
    });
    if (!choice.ok) {
      throw new AppError(
        ERROR_CODES.PROVIDER_UNAVAILABLE,
        'The WhatsApp provider assigned to this workspace is not active. Ask the platform admin.',
        HttpStatus.CONFLICT,
      );
    }
    const label =
      assignment?.provider_label ??
      (registryDefault && registryDefault.key === choice.key ? registryDefault.label : null) ??
      BUILTIN_LABELS[choice.key] ??
      choice.key;
    if (isBuiltinWhatsappProviderKey(choice.key)) {
      return {
        key: choice.key,
        label,
        source: choice.source,
        provider: choice.key,
        registry: null,
      };
    }

    await this.ensureKnown(choice.key);
    const registry = this.routes.get(choice.key);
    if (!registry || registry.status !== 'active') {
      throw new AppError(
        ERROR_CODES.PROVIDER_UNAVAILABLE,
        'The WhatsApp provider for this workspace is not available. Ask the platform admin.',
        HttpStatus.CONFLICT,
      );
    }
    if (registry.credentialMode === 'platform_token' && !registry.providerToken) {
      throw new AppError(
        ERROR_CODES.WAP_CREDENTIALS_MISSING,
        'The WhatsApp provider for this workspace has no partner token stored yet. Ask the platform admin.',
        HttpStatus.CONFLICT,
      );
    }
    return { key: choice.key, label, source: choice.source, provider: 'meta', registry };
  }

  /**
   * The providers behind the numbers named in a webhook payload, for authenticating it: the registry providers (`custom`) and whether
   * any number is on a built-in route. A key the registry does not know (a provider removed under a live number) comes back as a
   * provider with a scheme and no secret, which verifies nothing: refused, never waved through.
   */
  async payloadProviders(
    phoneNumberIds: string[],
  ): Promise<{ custom: WabaRegistryProvider[]; hasBuiltin: boolean }> {
    const keys = await this.store.tx((tx) => this.store.keysOfPhones(tx, phoneNumberIds));
    const custom: WabaRegistryProvider[] = [];
    let hasBuiltin = false;
    for (const key of keys) {
      if (isBuiltinWhatsappProviderKey(key)) {
        hasBuiltin = true;
        continue;
      }
      await this.ensureKnown(key);
      custom.push(
        this.routes.get(key) ?? {
          key,
          builtin: null,
          status: 'archived',
          baseUrl: '',
          apiVersion: '',
          authScheme: 'bearer',
          headerTemplates: {},
          credentialMode: 'channel_token',
          webhookMode: 'number_level_override',
          signatureScheme: 'meta_app_secret_sha256',
          signatureHeaderName: null,
          capabilities: { mediaUpload: false },
        },
      );
    }
    return { custom, hasBuiltin };
  }
}
