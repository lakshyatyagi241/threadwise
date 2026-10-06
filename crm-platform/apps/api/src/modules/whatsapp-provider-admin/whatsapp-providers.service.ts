import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  checkProviderBaseUrl,
  ERROR_CODES,
  isBuiltinWhatsappProviderKey,
  placeholdersOf,
  type CreateWhatsappProviderInput,
  type TestWhatsappProviderInput,
  type TestWhatsappProviderResponse,
  type UpdateWhatsappProviderInput,
  type WhatsappProvider,
  type WhatsappProviderList,
  type WhatsappProviderStatus,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import { WABA_ENV, type WabaEnv } from '../../config/domains/whatsapp-cloud-api-waba.env';
import {
  assertPublicUrl,
  UnsafeProviderUrlError,
} from '../../infra/providers/whatsapp-cloud-api-waba/provider-url-guard';
import { WabaApiError } from '../../infra/providers/whatsapp-cloud-api-waba/waba-errors';
import { WabaHttp, type WabaAuth } from '../../infra/providers/whatsapp-cloud-api-waba/waba-http';
import { WabaRegistryRoutes } from '../../infra/providers/whatsapp-cloud-api-waba/waba-registry-routes';
import { AuthAuditService } from '../auth';
import { WEBHOOK_PATH } from '../whatsapp-cloud-api-waba';
import {
  mergeSecrets,
  openProvider,
  redactSecrets,
  safeTestPath,
  ProviderStore,
  WhatsAppProviderResolver,
  type ProviderPatch,
  type ProviderRow,
  type ProviderSecrets,
} from '../whatsapp-provider-registry';
import { toProvider } from './provider.mapper';

const UNIQUE_VIOLATION = '23505';
const TEST_TIMEOUT_MS = 10_000;

const isUniqueViolation = (e: unknown): boolean => {
  const c = (e as { code?: string; cause?: { code?: string } } | null) ?? {};
  return c.code === UNIQUE_VIOLATION || c.cause?.code === UNIQUE_VIOLATION;
};

/** The columns an operator may change on a built-in provider; everything else belongs to the console WhatsApp settings page. */
const BUILTIN_EDITABLE = new Set(['label', 'notes', 'billingMode']);

/**
 * The operator's side of the WhatsApp provider registry: list, add, change, enable / disable / archive, the default, and a live test.
 *
 * Providers are platform data: every statement runs on the platform store (the privileged door), and every write carries its audit
 * event in the same transaction. Secrets are sealed with CryptoService and write only; the answers say whether a secret is stored and
 * its last four characters. The address of a provider is checked before it is saved (https, public DNS name, resolves to public
 * addresses only) and again before every call through it, so it is never a way into the platform's own network.
 */
@Injectable()
export class WhatsappProvidersService {
  constructor(
    private readonly store: ProviderStore,
    private readonly crypto: CryptoService,
    private readonly audit: AuthAuditService,
    private readonly resolver: WhatsAppProviderResolver,
    private readonly http: WabaHttp,
    @Inject(WABA_ENV) private readonly env: WabaEnv,
  ) {}

  // --- reads ---------------------------------------------------------------------------------------------------------------------

  async list(): Promise<WhatsappProviderList> {
    const rows = await this.store.tx((tx) => this.store.all(tx));
    return { data: rows.map((r) => this.view(r)) };
  }

  async get(uuid: string): Promise<WhatsappProvider> {
    return this.view(await this.store.tx((tx) => this.requireWithCounts(tx, uuid)));
  }

  // --- writes --------------------------------------------------------------------------------------------------------------------

  async create(input: CreateWhatsappProviderInput, operatorId: number): Promise<WhatsappProvider> {
    if (isBuiltinWhatsappProviderKey(input.key)) {
      throw new AppError(
        ERROR_CODES.WAP_PROVIDER_KEY_TAKEN,
        'That key belongs to a built-in provider.',
        HttpStatus.CONFLICT,
      );
    }
    const baseUrl = await this.checkedBaseUrl(input.baseUrl);
    const authScheme = input.authScheme ?? (input.headerTemplates ? 'custom_headers' : 'bearer');
    // A partner program gives every number its own token, so it implies channel_token.
    const credentialMode =
      input.credentialMode ?? (input.partnerProgram ? 'channel_token' : 'platform_token');
    const headerTemplates = input.headerTemplates ?? {};
    this.assertCredentialCarried(authScheme, headerTemplates, credentialMode);
    const { secrets, hints } = mergeSecrets({}, input.credentials, undefined);

    try {
      const id = await this.store.tx(async (tx) => {
        const row = await this.store.insert(tx, {
          key: input.key,
          label: input.label,
          adapterKind: input.adapterKind ?? 'meta_graph',
          baseUrl,
          apiVersion: input.apiVersion ?? 'v25.0',
          authScheme,
          headerTemplates,
          credentialMode,
          credentialsEnc: this.seal(secrets),
          credentialHints: hints,
          webhookMode: input.webhookMode ?? 'number_level_override',
          signatureScheme: input.signatureScheme ?? 'meta_app_secret_sha256',
          signatureHeaderName: input.signatureHeaderName ?? null,
          billingMode: input.billingMode ?? 'provider_credit_line',
          capabilities: { mediaUpload: input.capabilities?.mediaUpload ?? true },
          onboarding: input.onboarding ?? 'manual',
          onboardingAppId: input.onboardingAppId ?? null,
          onboardingConfigId: input.onboardingConfigId ?? null,
          partnerProgram: input.partnerProgram ?? null,
          partnerSolutionId: input.partnerProgram ? (input.partnerSolutionId ?? null) : null,
          notes: input.notes ?? null,
          operatorId,
        });
        await this.audit.record(tx, {
          event: 'platform.whatsapp_providers.created',
          status: 'success',
          payload: { provider: row.uuid, key: row.key, keysSet: Object.keys(secrets) },
        });
        return row.uuid;
      });
      await this.resolver.invalidate();
      return this.get(id);
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new AppError(
          ERROR_CODES.WAP_PROVIDER_KEY_TAKEN,
          'A provider with that key already exists.',
          HttpStatus.CONFLICT,
        );
      }
      throw e;
    }
  }

  async update(uuid: string, input: UpdateWhatsappProviderInput): Promise<WhatsappProvider> {
    const before = await this.store.tx((tx) => this.requireWithCounts(tx, uuid));
    const { rowVersion, credentials, clearCredentials, ...fields } = input;
    const touched = Object.keys(fields).filter(
      (k) => (fields as Record<string, unknown>)[k] !== undefined,
    );
    if (before.builtin) {
      const refused = touched.filter((k) => !BUILTIN_EDITABLE.has(k));
      if (refused.length > 0 || credentials || (clearCredentials?.length ?? 0) > 0) {
        throw new AppError(
          ERROR_CODES.WAP_PROVIDER_BUILTIN,
          'A built-in provider mirrors the WABA module: change its address, version and secrets on the console WhatsApp settings page.',
          HttpStatus.CONFLICT,
        );
      }
    }
    if (
      fields.credentialMode !== undefined &&
      fields.credentialMode !== before.credential_mode &&
      (before.number_count ?? 0) > 0
    ) {
      throw new AppError(
        ERROR_CODES.WAP_PROVIDER_IN_USE,
        'Numbers are connected through this provider; switch them to another provider before changing whose credential it uses.',
        HttpStatus.CONFLICT,
      );
    }

    const patch: ProviderPatch = {};
    if (fields.label !== undefined) patch.label = fields.label;
    if (fields.baseUrl !== undefined) patch.base_url = await this.checkedBaseUrl(fields.baseUrl);
    if (fields.apiVersion !== undefined) patch.api_version = fields.apiVersion;
    if (fields.authScheme !== undefined) patch.auth_scheme = fields.authScheme;
    if (fields.headerTemplates !== undefined) patch.header_templates = fields.headerTemplates;
    if (fields.credentialMode !== undefined) patch.credential_mode = fields.credentialMode;
    if (fields.webhookMode !== undefined) patch.webhook_mode = fields.webhookMode;
    if (fields.signatureScheme !== undefined) patch.signature_scheme = fields.signatureScheme;
    if (fields.signatureHeaderName !== undefined)
      patch.signature_header_name = fields.signatureHeaderName;
    if (fields.billingMode !== undefined) patch.billing_mode = fields.billingMode;
    if (fields.capabilities?.mediaUpload !== undefined)
      patch.capabilities = { mediaUpload: fields.capabilities.mediaUpload };
    if (fields.onboarding !== undefined) patch.onboarding = fields.onboarding;
    if (fields.onboardingAppId !== undefined) patch.onboarding_app_id = fields.onboardingAppId;
    if (fields.onboardingConfigId !== undefined)
      patch.onboarding_config_id = fields.onboardingConfigId;
    if (fields.partnerProgram !== undefined) {
      patch.partner_program = fields.partnerProgram;
      // The program and its solution id live and die together (a CHECK holds them to it).
      patch.partner_solution_id = fields.partnerProgram
        ? (fields.partnerSolutionId ?? before.partner_solution_id)
        : null;
    } else if (fields.partnerSolutionId !== undefined && before.partner_program) {
      patch.partner_solution_id = fields.partnerSolutionId;
    }
    if (fields.notes !== undefined) patch.notes = fields.notes;

    // The merged result must still be coherent (a custom-header provider keeps a header that carries its credential).
    const merged = {
      authScheme: patch.auth_scheme ?? before.auth_scheme,
      headerTemplates: patch.header_templates ?? before.header_templates,
      credentialMode: patch.credential_mode ?? before.credential_mode,
      signatureScheme: patch.signature_scheme ?? before.signature_scheme,
      signatureHeaderName:
        patch.signature_header_name !== undefined
          ? patch.signature_header_name
          : before.signature_header_name,
    };
    if (!before.builtin) {
      this.assertCredentialCarried(
        merged.authScheme,
        merged.headerTemplates,
        merged.credentialMode,
      );
      if (merged.signatureScheme === 'shared_secret_header' && !merged.signatureHeaderName) {
        throw AppError.validation('Name the header that carries the secret', [
          { path: 'signatureHeaderName', message: 'Required' },
        ]);
      }
    }

    let keysSet: string[] = [];
    if (credentials || (clearCredentials?.length ?? 0) > 0) {
      const current = this.openSecrets(before);
      const { secrets, hints } = mergeSecrets(current, credentials, clearCredentials);
      patch.credentials_enc = this.seal(secrets);
      patch.credential_hints = hints;
      keysSet = [
        ...Object.keys(credentials ?? {}),
        ...(clearCredentials ?? []).map((k) => `-${k}`),
      ];
    }

    await this.store.tx(async (tx) => {
      const after = await this.store.update(tx, before.id, patch, rowVersion);
      if (!after) throw AppError.rowVersionConflict('WhatsApp provider');
      await this.audit.record(tx, {
        event: 'platform.whatsapp_providers.updated',
        status: 'success',
        payload: {
          provider: after.uuid,
          key: after.key,
          fields: [...touched, ...(keysSet.length ? ['credentials'] : [])],
          keysSet,
        },
      });
    });
    await this.resolver.invalidate();
    return this.get(uuid);
  }

  /** Activate, disable or archive. Disabling never stops numbers already on the provider; archiving needs none left. */
  async setStatus(
    uuid: string,
    status: WhatsappProviderStatus,
    rowVersion: number,
  ): Promise<WhatsappProvider> {
    const before = await this.store.tx((tx) => this.requireWithCounts(tx, uuid));
    if (status === before.status) return this.view(before);
    if (status === 'active') this.assertUsable(before);
    if (status !== 'active' && before.is_default) {
      throw new AppError(
        ERROR_CODES.WAP_PROVIDER_IS_DEFAULT,
        'This is the default provider. Make another one the default (or clear the default) first.',
        HttpStatus.CONFLICT,
      );
    }
    if (status === 'archived') {
      if (before.builtin) {
        throw new AppError(
          ERROR_CODES.WAP_PROVIDER_BUILTIN,
          'A built-in provider cannot be archived.',
          HttpStatus.CONFLICT,
        );
      }
      if ((before.number_count ?? 0) > 0 || (before.workspace_count ?? 0) > 0) {
        throw new AppError(
          ERROR_CODES.WAP_PROVIDER_IN_USE,
          'Numbers or workspace overrides still use this provider. Switch them away first.',
          HttpStatus.CONFLICT,
        );
      }
    }
    await this.store.tx(async (tx) => {
      const after = await this.store.update(tx, before.id, { status }, rowVersion);
      if (!after) throw AppError.rowVersionConflict('WhatsApp provider');
      await this.audit.record(tx, {
        event: 'platform.whatsapp_providers.status_changed',
        status: 'success',
        payload: { provider: after.uuid, key: after.key, from: before.status, to: status },
      });
    });
    await this.resolver.invalidate();
    return this.get(uuid);
  }

  async makeDefault(uuid: string, rowVersion: number): Promise<WhatsappProvider> {
    const before = await this.store.tx((tx) => this.requireWithCounts(tx, uuid));
    this.assertUsable(before);
    if (before.status !== 'active') {
      throw new AppError(
        ERROR_CODES.WAP_PROVIDER_DISABLED,
        'Only an active provider can be the default.',
        HttpStatus.CONFLICT,
      );
    }
    await this.store.tx(async (tx) => {
      const current = await this.store.byId(tx, before.id);
      if (!current || current.row_version !== rowVersion) {
        throw AppError.rowVersionConflict('WhatsApp provider');
      }
      const previous = (await this.store.defaultActive(tx))?.key ?? null;
      await this.store.makeDefault(tx, before.id);
      await this.audit.record(tx, {
        event: 'platform.whatsapp_providers.default_changed',
        status: 'success',
        payload: { provider: before.uuid, key: before.key, previous },
      });
    });
    await this.resolver.invalidate();
    return this.get(uuid);
  }

  /** No registry default: new numbers follow the platform setting (the console WhatsApp page / WABA_DEFAULT_PROVIDER) again. */
  async clearDefault(): Promise<WhatsappProviderList> {
    await this.store.tx(async (tx) => {
      const previous = (await this.store.defaultActive(tx))?.key ?? null;
      await this.store.clearDefault(tx);
      await this.audit.record(tx, {
        event: 'platform.whatsapp_providers.default_changed',
        status: 'success',
        payload: { provider: null, key: null, previous },
      });
    });
    await this.resolver.invalidate();
    return this.list();
  }

  // --- live test -----------------------------------------------------------------------------------------------------------------

  /**
   * One authenticated GET to the provider (`<baseUrl>/<version><path>`, default `/me`) with its stored credential. The optional ids
   * and test token only fill header placeholders for this call; nothing of them is stored or returned. A refusal to even try (address
   * refused, credential missing) is an answer, not an error. The answer holds the provider's own words with every secret removed.
   */
  async test(
    uuid: string,
    input: TestWhatsappProviderInput,
  ): Promise<TestWhatsappProviderResponse> {
    const row = await this.store.tx((tx) => this.requireWithCounts(tx, uuid));
    const path = safeTestPath(input.path);
    if (!path)
      throw AppError.validation('The test path is not allowed', [
        { path: 'path', message: 'Not allowed' },
      ]);

    const started = Date.now();
    const secrets: string[] = [input.channelToken ?? ''];
    const done = (r: {
      ok: boolean;
      httpStatus: number | null;
      errorCode: string | null;
      message: string | null;
    }) => ({
      ok: r.ok,
      testedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      httpStatus: r.httpStatus,
      errorCode: r.errorCode,
      message: r.message === null ? null : redactSecrets(r.message, secrets).slice(0, 500),
    });

    let result: ReturnType<typeof done>;
    const route = this.testRoute(row, input);
    if ('refusal' in route) {
      result = done({
        ok: false,
        httpStatus: null,
        errorCode: route.refusal.code,
        message: route.refusal.message,
      });
    } else {
      secrets.push(...route.secrets);
      try {
        await this.http.call(route.auth, { method: 'GET', path, timeoutMs: TEST_TIMEOUT_MS });
        result = done({ ok: true, httpStatus: 200, errorCode: null, message: null });
      } catch (e) {
        if (e instanceof UnsafeProviderUrlError) {
          result = done({
            ok: false,
            httpStatus: null,
            errorCode: ERROR_CODES.WAP_BASE_URL_REFUSED,
            message: e.reason,
          });
        } else if (e instanceof WabaApiError) {
          result = done({
            ok: false,
            httpStatus: e.status === 0 ? null : e.status,
            errorCode: e.status === 0 ? 'PROVIDER_UNREACHABLE' : `HTTP_${e.status}`,
            message: e.message,
          });
        } else {
          result = done({
            ok: false,
            httpStatus: null,
            errorCode: 'PROVIDER_UNREACHABLE',
            message: 'The call failed.',
          });
        }
      }
    }

    await this.store.tx(async (tx) => {
      await this.store.recordTest(tx, row.id, result);
      await this.audit.record(tx, {
        event: 'platform.whatsapp_providers.tested',
        status: result.ok ? 'success' : 'failure',
        payload: {
          provider: row.uuid,
          key: row.key,
          httpStatus: result.httpStatus,
          errorCode: result.errorCode,
        },
      });
    });
    return {
      provider: { id: row.uuid, key: row.key, label: row.label },
      result,
    };
  }

  // --- internals -----------------------------------------------------------------------------------------------------------------

  private view(row: ProviderRow): WhatsappProvider {
    return toProvider(row, this.env, WEBHOOK_PATH);
  }

  private async requireWithCounts(tx: Tx, uuid: string): Promise<ProviderRow> {
    const found = (await this.store.all(tx)).find((r) => r.uuid === uuid);
    if (!found) throw AppError.notFound('WhatsApp provider', uuid);
    return found;
  }

  /** The route the test goes through, or why there is none. */
  private testRoute(
    row: ProviderRow,
    input: TestWhatsappProviderInput,
  ): { auth: WabaAuth; secrets: string[] } | { refusal: { code: string; message: string } } {
    const missing = (message: string) => ({
      refusal: { code: ERROR_CODES.WAP_CREDENTIALS_MISSING as string, message },
    });
    if (row.builtin === 'interakt') {
      const key = this.env.INTERAKT_PARTNER_AUTH_KEY;
      if (!key)
        return missing(
          'The Interakt partner key is not set on the console WhatsApp settings page.',
        );
      return {
        auth: {
          provider: 'interakt',
          authKey: key,
          wabaId: input.wabaId ?? '',
          ...(input.phoneNumberId ? { phoneNumberId: input.phoneNumberId } : {}),
        },
        secrets: [key],
      };
    }
    if (row.builtin === 'meta') {
      if (!input.channelToken)
        return missing('Send a test access token: each number holds its own on this provider.');
      return {
        auth: { provider: 'meta', accessToken: input.channelToken },
        secrets: [input.channelToken],
      };
    }
    const routes = new WabaRegistryRoutes();
    const opened = openProvider(row, this.crypto);
    routes.replace([{ ...opened, status: 'active' }]);
    const auth = routes.authFor(row.key, {
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      accessToken: input.channelToken,
    });
    if (!auth) {
      return missing(
        row.credential_mode === 'platform_token'
          ? 'This provider has no partner token stored yet.'
          : 'Send a test access token: each number holds its own on this provider.',
      );
    }
    return {
      auth,
      secrets: [
        opened.providerToken ?? '',
        opened.appSecret ?? '',
        opened.webhookSecret ?? '',
        input.channelToken ?? '',
      ],
    };
  }

  /** Activation and default need the credential the provider's mode relies on. Built-in routes use the WABA module's own settings. */
  private assertUsable(row: ProviderRow): void {
    if (row.builtin) return;
    if (row.credential_mode === 'platform_token' && !row.credential_hints.providerToken) {
      throw new AppError(
        ERROR_CODES.WAP_CREDENTIALS_MISSING,
        'Store the provider token before activating this provider.',
        HttpStatus.CONFLICT,
      );
    }
  }

  /** A custom-header scheme must carry the credential its mode relies on, or every call would go out unauthenticated. */
  private assertCredentialCarried(
    authScheme: string,
    templates: Readonly<Record<string, string>>,
    mode: string,
  ): void {
    if (authScheme !== 'custom_headers') return;
    const wanted = mode === 'platform_token' ? 'providerToken' : 'channelToken';
    const carried = Object.values(templates).some((v) => placeholdersOf(v).includes(wanted));
    if (!carried) {
      throw AppError.validation(`A header must carry {{${wanted}}}`, [
        { path: 'headerTemplates', message: `One header needs {{${wanted}}}` },
      ]);
    }
  }

  /** Normalises and checks an address: https on a public host that resolves to public addresses only. */
  private async checkedBaseUrl(raw: string): Promise<string> {
    const allowDev =
      this.env.WABA_PROVIDER_ALLOW_PRIVATE_HOSTS && process.env.NODE_ENV !== 'production';
    const verdict = checkProviderBaseUrl(raw, { allowDevLoopback: allowDev });
    if (!verdict.ok) throw this.refused(verdict.reason);
    try {
      await assertPublicUrl(verdict.url, {
        allowDevHosts: this.env.WABA_PROVIDER_ALLOW_PRIVATE_HOSTS,
      });
    } catch (e) {
      if (e instanceof UnsafeProviderUrlError) throw this.refused(e.reason);
      throw e;
    }
    return verdict.url;
  }

  private refused(reason: string): AppError {
    return new AppError(
      ERROR_CODES.WAP_BASE_URL_REFUSED,
      `That address is refused: ${reason}.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      [{ path: 'baseUrl', message: reason }],
    );
  }

  private seal(secrets: ProviderSecrets): string | null {
    return Object.keys(secrets).length === 0 ? null : this.crypto.encrypt(JSON.stringify(secrets));
  }

  private openSecrets(row: ProviderRow): ProviderSecrets {
    if (!row.credentials_enc) return {};
    try {
      return JSON.parse(this.crypto.decrypt(row.credentials_enc)) as ProviderSecrets;
    } catch {
      return {};
    }
  }
}
