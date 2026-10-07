import type { ResolvedWabaConnection } from './waba-connections.port';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  isBuiltinWhatsappProviderKey,
  type ConnectEmbeddedInput,
  type ConnectManualInput,
  type ConnectResult,
  type RegisterNumberInput,
  type SetTokenInput,
  type UpdateBusinessProfileInput,
  type VerifyTokenInput,
  type VerifyTokenResult,
  type WabaBusinessProfile,
  type WabaConnection as WabaConnectionDto,
  type WabaHealth,
  type WabaReadiness,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { WABA_ENV, type WabaEnv } from '../../config/domains/whatsapp-cloud-api-waba.env';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import {
  WABA_ADMIN,
  type PhoneInfo,
  type WabaAdminPort,
  type WabaConnection,
} from '../../infra/providers/whatsapp-cloud-api-waba/waba-admin.port';
import {
  translateConnectError,
  translateRegisterError,
  WabaApiError,
} from '../../infra/providers/whatsapp-cloud-api-waba/waba-errors';
import type { WabaProviderKind } from '../../infra/providers/whatsapp-cloud-api-waba/waba-http';
import {
  providerKeyOf,
  WabaRegistryRoutes,
  type WabaRegistryProvider,
} from '../../infra/providers/whatsapp-cloud-api-waba/waba-registry-routes';
import { WhatsAppProviderResolver } from '../whatsapp-provider-registry';
import { toDto } from './waba-connections.mapper';
import { PinnacleOnboardingService } from './pinnacle-onboarding.service';
import { WabaHealthDetailsService } from './waba-health-details.service';
import { WabaConnectionsRepository, type WabaRow } from './waba-connections.repository';
import {
  cleanPin,
  deriveHealth,
  generatePin,
  inboundUrlKey,
  isCoexistence,
  isOnPremise,
  maskToken,
  verifyTokenFor,
  webhookUrl,
} from './waba-rules';

/** What is stored encrypted in `credentials_json`. */
interface StoredCredentials {
  access_token?: string;
  /** Interakt tech-partner key, kept per number like Geta so the route can flip without a re-onboarding. */
  auth_key?: string;
  app_id?: string;
  app_secret?: string;
  /** The two-step PIN that registered the number; never returned by the API. */
  register_pin?: string;
  /** A partner program's own key for this number (Pinnacle's client apikey): the channel token of its registry route. */
  channel_token?: string;
  /** The partner login created for the client, kept so it can be handed over; never returned by the API. */
  partner_username?: string;
  partner_password?: string;
}

export type { ResolvedWabaConnection };

/** The provider a number is being moved to (the operator's switch). `registry` is the provider's descriptor, secrets opened; null for a built-in route. */
export interface ProviderMoveTarget {
  key: string;
  builtin: 'meta' | 'interakt' | null;
  credentialMode: 'platform_token' | 'channel_token';
  registry: WabaRegistryProvider | null;
}

export type ProviderMoveRequirement =
  'number_token_needed' | 'provider_token_needed' | 'ids_missing' | 'reconnect_needed';

/** What moving one number to another provider did (or, on a dry run, would do). Nothing here is a secret. */
export interface ProviderMoveResult {
  numberId: string;
  label: string | null;
  phoneNumber: string | null;
  fromKey: string;
  /** Dry run: `ready` | `blocked`. Applied: `switched` | `repointed` (a disconnected number) | `blocked` | `failed`. */
  state: 'ready' | 'blocked' | 'switched' | 'repointed' | 'failed';
  requirements: ProviderMoveRequirement[];
  resubscribe: boolean;
  inboundWired: boolean | null;
  message: string | null;
}

const UNIQUE_VIOLATION = '23505';
const MODULE = 'wa_provider_configs';

/**
 * Connecting and keeping WhatsApp Business numbers wired (WD-WABA-004..022).
 *
 * Every call to Meta or Interakt happens OUTSIDE a database transaction (a transaction held across a slow Graph call pins a
 * connection); each write is one short transaction carrying its audit row and outbox event. Meta's own words reach the user
 * (translated), and the code on the problem body says what to do about it.
 */
@Injectable()
export class WabaConnectService {
  private readonly logger = new Logger(WabaConnectService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WabaConnectionsRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService<Env, true>,
    @Inject(WABA_ENV) private readonly env: WabaEnv,
    @Inject(WABA_ADMIN) private readonly admin: WabaAdminPort,
    private readonly healthDetails: WabaHealthDetailsService,
    private readonly routes: WabaRegistryRoutes,
    private readonly providers: WhatsAppProviderResolver,
    private readonly pinnacleOnboarding: PinnacleOnboardingService,
  ) {}

  // --- reading -----------------------------------------------------------------------------------------------------

  /**
   * What the browser launches Embedded Signup with. The solution id is the provider's, not the platform's: a workspace on Interakt
   * sends Interakt's, one on a partner program (Pinnacle) sends that program's, and a plain Meta workspace sends none. Sending the
   * wrong one is visible to the person signing up (Meta names the partner in the popup) and onboards the number with the wrong one.
   */
  async readiness(): Promise<WabaReadiness> {
    const r = this.admin.readiness();
    const base = { ...r, webhookUrl: this.callback().url };
    const { orgId } = RequestContextStore.require();
    let route: Awaited<ReturnType<WhatsAppProviderResolver['forNewNumbers']>>;
    try {
      route = await this.providers.forNewNumbers(orgId);
    } catch {
      // A workspace whose provider is unavailable still needs a readable answer; connecting will say why it cannot.
      return base;
    }
    if (route.key === 'interakt') return base;
    const reg = route.registry;
    const partner = reg?.partnerProgram ? reg : null;
    return {
      ...base,
      solutionId: partner ? (partner.partnerSolutionId ?? null) : null,
      // The code Meta returns is exchanged with the platform's own app (META_APP_ID), so the app never changes; a partner program
      // may bring its own signup configuration of that app.
      configId: partner?.onboardingConfigId ?? base.configId,
    };
  }

  async list(): Promise<WabaConnectionDto[]> {
    const { orgId } = RequestContextStore.require();
    const rows = await this.db.tx((tx) => this.repo.list(tx, orgId));
    return rows.map(toDto);
  }

  async get(uuid: string): Promise<WabaConnectionDto> {
    return toDto(await this.require(uuid));
  }

  // --- connecting --------------------------------------------------------------------------------------------------

  /** Embedded Signup: the browser finished Meta's popup and hands us the one-time code (WD-WABA-009). */
  async connectEmbedded(input: ConnectEmbeddedInput): Promise<ConnectResult> {
    const ready = this.admin.readiness();
    if (!this.env.META_APP_ID || !this.env.META_APP_SECRET) {
      throw this.notConfigured(
        `META_APP_ID and META_APP_SECRET${ready.missing.length ? ` (still unset: ${ready.missing.join(', ')})` : ''}`,
      );
    }
    const { orgId } = RequestContextStore.require();
    const route = await this.routeForNewNumbers(orgId);
    const provider = route.provider;

    const token = await this.meta('Meta token exchange failed', () =>
      this.admin.exchangeCode(input.code),
    );

    // The ids from the popup are only hints. A WABA this token was not granted is somebody else's, however it got here.
    const inspected = await this.meta('Could not inspect the Meta token', () =>
      this.admin.inspectToken(token.accessToken),
    );
    if (!inspected.isValid)
      throw this.rejected('Meta says the token from Embedded Signup is not valid. Try again.');
    let found: string | null = input.wabaId ?? inspected.wabaIds[0] ?? null;
    if (input.wabaId && inspected.wabaIds.length > 0 && !inspected.wabaIds.includes(input.wabaId)) {
      throw new AppError(
        ERROR_CODES.WABA_ID_MISMATCH,
        'That WhatsApp Business Account was not granted to this sign-up.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (!found)
      found = await this.meta('Could not find a WhatsApp Business Account', () =>
        this.admin.discoverWabaId(token.accessToken),
      );
    if (!found) {
      throw new AppError(
        ERROR_CODES.WABA_NO_WABA,
        'Meta did not return a WhatsApp Business Account. Try again, or use Add WABA > Manual.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const wabaId: string = found;
    const phones = await this.meta('Could not list the phone numbers', () =>
      this.admin.listPhoneNumbers(token.accessToken, wabaId),
    );
    const phone = input.phoneNumberId
      ? phones.find((p) => p.id === input.phoneNumberId)
      : phones[0];
    if (input.phoneNumberId && !phone) {
      throw new AppError(
        ERROR_CODES.WABA_ID_MISMATCH,
        'That phone number is not on the WhatsApp Business Account.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (!phone) {
      throw new AppError(
        ERROR_CODES.WABA_NO_PHONE,
        'No phone number is registered on this WhatsApp Business Account yet. Meta can take a minute to finish: try again shortly.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const owner = await this.admin.getOwnerBusiness(token.accessToken, wabaId);
    const businessId = input.businessId ?? owner?.id ?? null;
    const businessVerified = businessId
      ? await this.admin.isBusinessVerified(token.accessToken, businessId)
      : false;

    // A partner program (Pinnacle) opens the client's account first: its own key is what every send for this number carries.
    const partner = PinnacleOnboardingService.applies(route.registry) ? route.registry : null;
    const onboarded = partner
      ? await this.pinnacleOnboarding.onboard({
          registry: partner,
          wabaId,
          phoneNumberId: phone.id,
          displayPhoneNumber: phone.displayPhoneNumber ?? null,
          businessId,
          accessToken: token.accessToken,
        })
      : null;

    const conn: WabaConnection = {
      provider,
      providerKey: route.key,
      wabaId,
      phoneNumberId: phone.id,
      accessToken: token.accessToken,
      ...(provider === 'interakt' ? { authKey: this.env.INTERAKT_PARTNER_AUTH_KEY } : {}),
      ...this.registryOf(
        route.registry,
        wabaId,
        phone.id,
        onboarded?.channelToken ?? token.accessToken,
      ),
    };

    const warnings: string[] = [];
    if (provider === 'interakt') {
      const registered = await this.admin.registerWithInterakt(wabaId, phone.displayPhoneNumber);
      if (!registered)
        warnings.push(
          'Interakt did not confirm the new account. Messages may be refused until it does; use Fix inbound to retry.',
        );
    }
    await this.admin.assignSystemUser(wabaId, token.accessToken);

    // The webhook subscription is a Meta call made with the client's Meta token, not through the partner.
    const wireConn: WabaConnection = partner
      ? {
          provider: 'meta',
          providerKey: 'meta',
          wabaId,
          phoneNumberId: phone.id,
          accessToken: token.accessToken,
        }
      : conn;
    const wired = await this.wire(wireConn, warnings, /* abortOnMissingScope */ true);

    const saved = await this.persist({
      provider,
      providerKey: route.key,
      via: 'embedded',
      phone,
      wabaId,
      businessId,
      businessName: owner?.name ?? null,
      businessVerified,
      credentials: {
        access_token: token.accessToken,
        ...(provider === 'interakt' ? { auth_key: this.env.INTERAKT_PARTNER_AUTH_KEY } : {}),
        ...(onboarded
          ? {
              channel_token: onboarded.channelToken,
              ...(onboarded.username ? { partner_username: onboarded.username } : {}),
              ...(onboarded.password ? { partner_password: onboarded.password } : {}),
            }
          : {}),
      },
      label: phone.verifiedName,
      tokenExpiresAt: token.expiresInSeconds
        ? new Date(Date.now() + token.expiresInSeconds * 1000)
        : null,
      inboundWired: wired,
      coexistence: input.coexistence === true || isCoexistence(phone.platformType),
    });
    // Embedded Signup registers a number itself; only the direct route repeats WaDesk's silent register.
    if (provider === 'meta' && !route.registry && !isCoexistence(phone.platformType))
      await this.autoRegister(saved.row, conn);
    if (partner && onboarded) {
      let row = saved.row;
      if (businessId) {
        await this.pinnacleOnboarding.scheduleCreditLine({
          orgId,
          rowId: row.id,
          providerKey: route.key,
          wabaId,
          businessId,
        });
      } else {
        warnings.push(
          'The business that owns this WhatsApp account could not be read, so the Meta credit line was not shared with Pinnacle. Connect again once Meta shows it.',
        );
      }
      row = await this.touch(
        row,
        { partner_program: 'pinnacle', credit_line_assigned: false },
        'partner_onboard',
      );
      return { connection: toDto(row), warnings };
    }
    return { connection: toDto(saved.row), warnings };
  }

  /** Manual connect: the admin pastes Phone Number ID, WABA ID and a System User token (WD-WABA-006). */
  async connectManual(input: ConnectManualInput): Promise<ConnectResult> {
    const app =
      input.appId && input.appSecret ? { id: input.appId, secret: input.appSecret } : undefined;
    const extended = await this.admin.extendToken(input.accessToken, app);
    const token = extended.accessToken;

    let phone: PhoneInfo;
    try {
      phone = await this.admin.getPhone(
        { provider: 'meta', accessToken: token },
        input.phoneNumberId,
      );
    } catch (e) {
      throw this.rejected(translateConnectError(asApiError(e)), 'accessToken', e);
    }
    if (isOnPremise(phone.platformType)) {
      const unverified =
        (phone.codeVerificationStatus ?? '').toUpperCase() === 'NOT_VERIFIED'
          ? ' The number is also not verified yet.'
          : '';
      throw new AppError(
        ERROR_CODES.WABA_ON_PREMISE,
        `This number is still on the WhatsApp On-Premises API, which Meta shut down on 23 Oct 2025. Verify it and register it on the Cloud API in WhatsApp Manager, then connect again.${unverified}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'phoneNumberId', message: 'Not on the Cloud API.' }],
      );
    }

    const owner = input.businessId ? null : await this.admin.getOwnerBusiness(token, input.wabaId);
    const businessId = input.businessId ?? owner?.id ?? null;
    const conn: WabaConnection = {
      provider: 'meta',
      providerKey: 'meta',
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      accessToken: token,
    };
    const warnings: string[] = [];
    const wired = await this.wire(conn, warnings, true);

    const saved = await this.persist({
      provider: 'meta',
      providerKey: 'meta',
      via: 'manual',
      phone,
      wabaId: input.wabaId,
      businessId,
      businessName: owner?.name ?? null,
      businessVerified: false,
      credentials: {
        access_token: token,
        ...(app ? { app_id: app.id, app_secret: app.secret } : {}),
      },
      label: input.displayLabel?.trim() || phone.verifiedName,
      tokenExpiresAt: extended.expiresInSeconds
        ? new Date(Date.now() + extended.expiresInSeconds * 1000)
        : null,
      inboundWired: wired,
      coexistence: isCoexistence(phone.platformType),
    });
    if (!isCoexistence(phone.platformType)) await this.autoRegister(saved.row, conn);
    return { connection: toDto(saved.row), warnings };
  }

  /** The pre-save token self-check (WD-WABA-007): what the token can and cannot do, before anything is stored. */
  async verifyToken(input: VerifyTokenInput): Promise<VerifyTokenResult> {
    const checks: VerifyTokenResult['checks'] = [];
    const token = input.accessToken;
    let tokenOk = true;

    try {
      const inspected = await this.admin.inspectToken(token);
      tokenOk = inspected.isValid;
      checks.push({
        key: 'token',
        ok: inspected.isValid,
        title: inspected.isValid ? 'Token is valid' : 'Token is not valid',
        detail: inspected.expiresAt
          ? `Expires ${inspected.expiresAt.toISOString().slice(0, 10)}.`
          : 'It does not expire.',
      });
      const scopes = new Set(inspected.scopes);
      const missing = ['whatsapp_business_messaging', 'whatsapp_business_management'].filter(
        (s) => !scopes.has(s),
      );
      checks.push({
        key: 'management_scope',
        ok: missing.length === 0,
        title:
          missing.length === 0
            ? 'Both WhatsApp permissions are granted'
            : 'A WhatsApp permission is missing',
        detail:
          missing.length === 0
            ? 'whatsapp_business_messaging and whatsapp_business_management.'
            : `Regenerate the token with: ${missing.join(', ')}.`,
      });
    } catch (e) {
      // No platform app to inspect with: the phone probe below still proves the token works for the number.
      if (!(e instanceof WabaApiError) || e.status !== 0) {
        tokenOk = false;
        checks.push({
          key: 'token',
          ok: false,
          title: 'Token was rejected',
          detail: translateConnectError(asApiError(e)),
        });
      }
    }

    if (input.phoneNumberId && tokenOk) {
      try {
        const phone = await this.admin.getPhone(
          { provider: 'meta', accessToken: token },
          input.phoneNumberId,
        );
        checks.push({
          key: 'phone',
          ok: true,
          title: 'The token can read this number',
          detail: `${phone.verifiedName ?? 'Unnamed'} ${phone.displayPhoneNumber ?? ''}`.trim(),
        });
        const onPrem = isOnPremise(phone.platformType);
        checks.push({
          key: 'cloud_api',
          ok: !onPrem,
          title: onPrem ? 'The number is not on the Cloud API' : 'The number is on the Cloud API',
          detail: onPrem
            ? 'Register it on the Cloud API in WhatsApp Manager first.'
            : (phone.platformType ?? 'CLOUD_API'),
        });
      } catch (e) {
        checks.push({
          key: 'phone',
          ok: false,
          title: 'The token cannot read this number',
          detail: translateConnectError(asApiError(e)),
        });
      }
    }
    if (input.wabaId && tokenOk) {
      try {
        await this.admin.listPhoneNumbers(token, input.wabaId);
        checks.push({
          key: 'waba',
          ok: true,
          title: 'The token can read this WhatsApp Business Account',
          detail: input.wabaId,
        });
      } catch (e) {
        checks.push({
          key: 'waba',
          ok: false,
          title: 'The token cannot read this WhatsApp Business Account',
          detail: translateConnectError(asApiError(e)),
        });
      }
    }
    return { ok: checks.every((c) => c.ok), checks };
  }

  // --- per-number actions ------------------------------------------------------------------------------------------

  /** Fix inbound: re-run subscribe + override with the stored token and report whether it is wired (WD-WABA-014). */
  async resubscribe(uuid: string): Promise<ConnectResult> {
    const row = await this.require(uuid);
    const conn = this.connOf(row);
    const warnings: string[] = [];
    const wired = await this.wire(conn, warnings, true);
    const updated = await this.touch(
      row,
      { inbound_wired: wired, inbound_checked_at: new Date().toISOString() },
      'resubscribe',
    );
    return { connection: toDto(updated), warnings };
  }

  /** Register the number on the Cloud API; the PIN is the typed one, else the stored one, else a new one (WD-WABA-012). */
  async register(uuid: string, input: RegisterNumberInput): Promise<WabaConnectionDto> {
    const row = await this.require(uuid);
    const conn = this.connOf(row);
    const creds = this.creds(row);
    const pin = cleanPin(input.pin) ?? creds?.register_pin ?? generatePin();
    try {
      await this.admin.registerPhone(conn, pin);
    } catch (e) {
      const err = asApiError(e);
      // Meta says "already registered" when it is; that is success.
      if (!/already/i.test(err.message)) throw this.rejected(translateRegisterError(err), 'pin', e);
    }
    const updated = await this.saveCredentials(row, { ...creds, register_pin: pin }, 'register');
    return toDto(updated);
  }

  async setPrimary(uuid: string): Promise<WabaConnectionDto> {
    const { orgId } = RequestContextStore.require();
    const row = await this.require(uuid);
    const updated = await this.db.tx(async (tx) => {
      await this.repo.demoteOthers(tx, orgId, row.id);
      const next = await this.repo.update(tx, orgId, row.id, { isPrimary: true });
      await this.audit.record(tx, {
        module: MODULE,
        recordId: row.id,
        action: 'update',
        delta: { is_primary: { old: row.is_primary, new: true } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE,
        aggregateId: row.id,
        eventType: 'whatsapp.connection.primary_changed',
        payload: { connectionId: row.uuid },
      });
      return next!;
    });
    return toDto(updated);
  }

  /** Verified paste of a new token (WD-WABA-019). */
  async setToken(uuid: string, input: SetTokenInput): Promise<WabaConnectionDto> {
    const row = await this.require(uuid);
    const meta = row.meta_json ?? {};
    const phoneId = String(meta.phone_number_id ?? '');
    try {
      if (phoneId)
        await this.admin.getPhone({ provider: 'meta', accessToken: input.accessToken }, phoneId);
      else {
        const t = await this.admin.inspectToken(input.accessToken);
        if (!t.isValid) throw new Error('invalid');
      }
    } catch (e) {
      throw this.rejected(
        `Meta rejected this token: ${e instanceof WabaApiError ? translateConnectError(e) : 'it is not valid'}`,
        'accessToken',
        e,
      );
    }
    const creds = { ...(this.creds(row) ?? {}), access_token: input.accessToken };
    const updated = await this.saveCredentials(row, creds, 'set_token', {
      status: 'connected',
      connectedAt: row.connected_at ?? new Date(),
      metaPatch: { last_error: null },
    });
    return toDto(updated);
  }

  /** Swap the stored token for a fresh long-lived one without reconnecting (WD-WABA-020). */
  async renewToken(uuid: string): Promise<WabaConnectionDto> {
    const row = await this.require(uuid);
    const creds = this.creds(row);
    if (!creds?.access_token) throw this.noCredentials();
    const app =
      creds.app_id && creds.app_secret ? { id: creds.app_id, secret: creds.app_secret } : undefined;
    if (!app && (!this.env.META_APP_ID || !this.env.META_APP_SECRET)) {
      throw this.notConfigured('META_APP_ID and META_APP_SECRET, or paste a fresh token instead');
    }
    const id = app?.id ?? this.env.META_APP_ID!;
    const secret = app?.secret ?? this.env.META_APP_SECRET!;
    // extendToken swallows a refusal and hands the old token back; here the refusal is the answer.
    const before = creds.access_token;
    const renewed = await this.admin.extendToken(before, { id, secret });
    if (renewed.accessToken === before) {
      throw this.rejected(
        'Meta could not renew this token. If it is expired or revoked you will need to reconnect the number.',
        'token',
      );
    }
    const updated = await this.saveCredentials(
      row,
      { ...creds, access_token: renewed.accessToken },
      'refresh_token',
      {
        status: 'connected',
        connectedAt: row.connected_at ?? new Date(),
        metaPatch: {
          token_expires_at: renewed.expiresInSeconds
            ? new Date(Date.now() + renewed.expiresInSeconds * 1000).toISOString()
            : null,
          last_error: null,
        },
      },
    );
    return toDto(updated);
  }

  async rename(uuid: string, label: string, rowVersion?: number): Promise<WabaConnectionDto> {
    const { orgId } = RequestContextStore.require();
    const row = await this.require(uuid);
    const updated = await this.db.tx(async (tx) => {
      const next = await this.repo.update(tx, orgId, row.id, { displayLabel: label }, rowVersion);
      if (!next) throw AppError.rowVersionConflict('WhatsApp number');
      await this.audit.record(tx, {
        module: MODULE,
        recordId: row.id,
        action: 'update',
        delta: { display_label: { old: row.display_label, new: label } },
      });
      return next;
    });
    return toDto(updated);
  }

  /** Stop sending from the number: credentials wiped, row kept so history still points at it (WD-WABA-017). */
  async disconnect(uuid: string): Promise<WabaConnectionDto> {
    const { orgId } = RequestContextStore.require();
    const row = await this.require(uuid);
    // Meta keeps delivering to this app otherwise: unsubscribing is what WaDesk's "port notes" ask for. Best effort.
    const conn = this.tryConn(row);
    if (conn)
      await this.admin
        .unsubscribe(conn)
        .catch((e) =>
          this.logger.warn(
            { id: row.uuid, err: asApiError(e).message },
            'unsubscribe on disconnect failed',
          ),
        );

    const updated = await this.db.tx(async (tx) => {
      const next = await this.repo.update(tx, orgId, row.id, {
        status: 'disconnected',
        credentialsJson: null,
        isPrimary: false,
        connectedAt: null,
      });
      if (row.is_primary) await this.repo.promoteNext(tx, orgId);
      await this.audit.record(tx, {
        module: MODULE,
        recordId: row.id,
        action: 'update',
        delta: { status: { old: row.status, new: 'disconnected' } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE,
        aggregateId: row.id,
        eventType: 'whatsapp.connection.disconnected',
        payload: { connectionId: row.uuid },
      });
      return next!;
    });
    return toDto(updated);
  }

  /** Delete the number's row (WD-WABA-018). */
  async remove(uuid: string): Promise<void> {
    const { orgId } = RequestContextStore.require();
    const row = await this.require(uuid);
    const conn = this.tryConn(row);
    if (conn) await this.admin.unsubscribe(conn).catch(() => undefined);
    await this.db.tx(async (tx) => {
      await this.repo.delete(tx, orgId, row.id);
      if (row.is_primary) await this.repo.promoteNext(tx, orgId);
      await this.audit.record(tx, { module: MODULE, recordId: row.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE,
        aggregateId: row.id,
        eventType: 'whatsapp.connection.removed',
        payload: { connectionId: row.uuid },
      });
    });
  }

  // --- health and profile ------------------------------------------------------------------------------------------

  /** Live read of the number from Meta plus the issues that follow from it (WD-WABA-021, 022). */
  async health(uuid: string): Promise<WabaHealth> {
    let row = await this.require(uuid);
    const creds = this.creds(row);
    let liveReadFailed = false;
    let liveReadError: string | null = null;
    const tryConn = this.tryConn(row);
    let phoneExtra = { accountMode: null, isOfficialBusinessAccount: null, isPinEnabled: null } as {
      accountMode: string | null;
      isOfficialBusinessAccount: boolean | null;
      isPinEnabled: boolean | null;
    };
    let extra: Awaited<ReturnType<WabaHealthDetailsService['collect']>> | null = null;
    if (tryConn && row.status !== 'disconnected') {
      try {
        const phone = await this.admin.getPhone(authFor(tryConn), tryConn.phoneNumberId);
        phoneExtra = {
          accountMode: phone.accountMode,
          isOfficialBusinessAccount: phone.isOfficialBusinessAccount,
          isPinEnabled: phone.isPinEnabled,
        };
        row = await this.touch(row, phoneMeta(phone), 'health', {
          lastHealthAt: new Date(),
          phoneNumber: phone.displayPhoneNumber ?? row.phone_number,
        });
        // The other nodes only make sense when the token reached the phone; they run in parallel and never fail the page.
        extra = await this.healthDetails.collect(tryConn, phoneExtra);
      } catch (e) {
        liveReadFailed = true;
        liveReadError = translateConnectError(asApiError(e));
      }
    }
    const m = row.meta_json ?? {};
    const { overall, issues } = deriveHealth(
      {
        status: row.status,
        hasToken: Boolean(creds?.access_token),
        tokenExpiresAt:
          typeof m.token_expires_at === 'string' ? new Date(m.token_expires_at) : null,
        platformType: (m.platform_type as string | null) ?? null,
        qualityRating: (m.quality_rating as string | null) ?? null,
        nameStatus: (m.name_status as string | null) ?? null,
        codeVerificationStatus: (m.code_verification_status as string | null) ?? null,
        inboundWired: typeof m.inbound_wired === 'boolean' ? m.inbound_wired : null,
        liveReadFailed,
        liveReadError,
        ...(extra?.facts ?? {}),
      },
      new Date(),
    );
    return {
      connection: toDto(row),
      overall,
      issues,
      tokenHint: maskToken(creds?.access_token),
      checkedAt: new Date().toISOString(),
      details: extra?.details ?? {
        waba: null,
        token: { valid: null, scopes: [], expiresAt: null, appId: null },
        webhook: null,
        templates: null,
        phone: phoneExtra,
        errors: liveReadError ? [liveReadError] : [],
      },
    };
  }

  async getProfile(uuid: string): Promise<WabaBusinessProfile> {
    const conn = this.connOf(await this.require(uuid));
    return this.meta('Could not read the business profile', () =>
      this.admin.getBusinessProfile(conn),
    );
  }

  async updateProfile(
    uuid: string,
    patch: UpdateBusinessProfileInput,
  ): Promise<WabaBusinessProfile> {
    const row = await this.require(uuid);
    const conn = this.connOf(row);
    await this.meta('Could not update the business profile', () =>
      this.admin.updateBusinessProfile(conn, {
        ...patch,
        ...(patch.email !== undefined ? { email: patch.email } : {}),
      }),
    );
    await this.db.tx((tx) =>
      this.audit.record(tx, {
        module: MODULE,
        recordId: row.id,
        action: 'update',
        delta: { business_profile: { old: null, new: Object.keys(patch) } },
      }),
    );
    return this.admin.getBusinessProfile(conn);
  }

  /**
   * The decrypted provider connection of a stored number, for other domains that call Meta on its behalf (message templates).
   * Reads inside the caller's transaction; the Meta call itself must happen outside it. `null` when the number does not exist
   * in this organization; `conn` is null when it has no usable credentials.
   */
  async resolveConnection(
    tx: Tx,
    orgId: number,
    ref: { uuid: string } | { id: number },
  ): Promise<ResolvedWabaConnection | null> {
    const row =
      'uuid' in ref
        ? await this.repo.findByUuid(tx, orgId, ref.uuid)
        : await this.repo.findById(tx, orgId, ref.id);
    if (!row) return null;
    await this.providers.ensureKnown(providerKeyOf(row.meta_json));
    const conn = this.tryConn(row);
    return {
      id: row.id,
      uuid: row.uuid,
      status: row.status,
      label: row.display_label ?? row.phone_number,
      phoneNumber: row.phone_number,
      wabaId: typeof row.meta_json?.waba_id === 'string' ? row.meta_json.waba_id : null,
      phoneNumberId:
        typeof row.meta_json?.phone_number_id === 'string' ? row.meta_json.phone_number_id : null,
      conn: conn && (conn.accessToken || conn.authKey || conn.registry) ? conn : null,
    };
  }

  /**
   * The operator's switch, one number: re-point it at another provider of the registry. The number keeps its id, its credentials and
   * its inbox channel; only the route it is reached through changes (`meta_json.provider_key`).
   *
   * A connected number is first re-subscribed through the NEW route (the webhook must reach us through it), and is only re-pointed when
   * that worked, so a failed switch changes nothing. A number whose target needs a credential it does not have is `blocked` and listed
   * with what is missing; a disconnected number is re-pointed only (no webhook to move) and needs a reconnect. The write, its audit row
   * and the `whatsapp.connection.connected` event the inbox listens to (so the channel stays linked) are one transaction. Runs for the
   * workspace `orgId` on behalf of an operator, outside any tenant request.
   */
  async moveToProvider(
    orgId: number,
    uuid: string,
    target: ProviderMoveTarget,
    opts: { dryRun: boolean; reason?: string },
  ): Promise<ProviderMoveResult> {
    const row = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.findByUuid(tx, orgId, uuid),
    );
    if (!row) throw AppError.notFound('WhatsApp number', uuid);
    const meta = row.meta_json ?? {};
    const fromKey = providerKeyOf(meta);
    const creds = this.creds(row);
    const wabaId = String(meta.waba_id ?? '');
    const phoneNumberId = String(meta.phone_number_id ?? '');
    const repointOnly = row.status === 'disconnected' || !creds;
    const base = {
      numberId: row.uuid,
      label: row.display_label ?? row.phone_number,
      phoneNumber: row.phone_number,
      fromKey,
    };

    const requirements: ProviderMoveRequirement[] = [];
    if (repointOnly) requirements.push('reconnect_needed');
    else {
      if (!wabaId || !phoneNumberId) requirements.push('ids_missing');
      if (target.credentialMode === 'channel_token' && !creds?.access_token)
        requirements.push('number_token_needed');
      if (target.builtin === 'interakt' && !this.env.INTERAKT_PARTNER_AUTH_KEY)
        requirements.push('provider_token_needed');
      if (
        target.registry &&
        target.credentialMode === 'platform_token' &&
        !target.registry.providerToken
      )
        requirements.push('provider_token_needed');
    }
    const blocked = requirements.filter((r) => r !== 'reconnect_needed').length > 0;
    if (blocked) {
      return {
        ...base,
        state: 'blocked',
        requirements,
        resubscribe: false,
        inboundWired: null,
        message: 'The target provider needs something this number does not have yet.',
      };
    }
    if (opts.dryRun) {
      return {
        ...base,
        state: 'ready',
        requirements,
        resubscribe: !repointOnly,
        inboundWired: null,
        message: repointOnly ? 'Disconnected: it is only re-pointed and needs a reconnect.' : null,
      };
    }

    const family: WabaProviderKind = target.key === 'interakt' ? 'interakt' : 'meta';
    let wired: boolean | null = null;
    let nextCreds: StoredCredentials | null = null;
    let message: string | null = null;
    if (!repointOnly) {
      const registry = target.registry
        ? this.routes.authFor(target.key, {
            wabaId,
            phoneNumberId,
            accessToken: creds?.access_token,
          })
        : undefined;
      if (target.registry && !registry) {
        return {
          ...base,
          state: 'failed',
          requirements,
          resubscribe: false,
          inboundWired: null,
          message: 'The target provider has no route for this number.',
        };
      }
      const authKey =
        target.builtin === 'interakt' ? this.env.INTERAKT_PARTNER_AUTH_KEY : undefined;
      const conn: WabaConnection = {
        provider: family,
        providerKey: target.key,
        wabaId,
        phoneNumberId,
        accessToken: creds?.access_token,
        ...(authKey ? { authKey } : {}),
        ...(registry ? { registry } : {}),
      };
      if (authKey) {
        nextCreds = { ...(creds ?? {}), auth_key: authKey };
        const registered = await this.admin.registerWithInterakt(wabaId, row.phone_number);
        if (!registered)
          message = 'Interakt did not confirm the account; use Fix inbound to retry.';
      }
      const cb = this.callback();
      if (cb.url) {
        const sub = await this.admin.subscribe(conn, { url: cb.url, verifyToken: cb.verifyToken });
        if (!sub.ok) {
          return {
            ...base,
            state: 'failed',
            requirements,
            resubscribe: false,
            inboundWired: null,
            message: `The webhook could not be re-subscribed through the new provider: ${sub.error ? translateConnectError(sub.error) : 'unknown error'}. Nothing was changed.`,
          };
        }
        const verified = await this.admin.verifyInboundWired(conn, cb.url);
        wired = verified ?? (sub.overrideApplied ? true : null);
        if (!sub.overrideApplied && verified !== true) {
          message =
            'Subscribed, but the provider did not accept a per-number callback; the callback configured on its Meta app applies.';
        }
      } else {
        message =
          'No public webhook URL is configured (WABA_WEBHOOK_PUBLIC_URL); the webhook was not moved.';
      }
    }

    const now = new Date();
    const credentialsJson = nextCreds ? this.crypto.encrypt(JSON.stringify(nextCreds)) : undefined;
    await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const next = await this.repo.update(tx, orgId, row.id, {
        ...(credentialsJson !== undefined ? { credentialsJson } : {}),
        metaPatch: {
          provider: family,
          provider_key: target.key,
          ...(repointOnly ? {} : { inbound_wired: wired, inbound_checked_at: now.toISOString() }),
          provider_switched_at: now.toISOString(),
          provider_switched_from: fromKey,
        },
      });
      if (!next) throw AppError.notFound('WhatsApp number', uuid);
      const actor = RequestContextStore.peek();
      await tx.execute(sql`
        INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id)
        VALUES (${orgId}, ${actor?.actorId ?? null}, ${actor?.actorType ?? 'system'}, ${MODULE}, ${row.id}, 'update',
                ${JSON.stringify({
                  provider_key: { old: fromKey, new: target.key },
                  ...(opts.reason ? { reason: { old: null, new: opts.reason.slice(0, 500) } } : {}),
                })}::jsonb,
                ${actor?.requestId ?? null})`);
      // The inbox keeps the number's channel linked by this event; a disconnected number must not be revived by it.
      if (!repointOnly) {
        await this.outbox.emit(tx, {
          aggregateModule: MODULE,
          aggregateId: row.id,
          eventType: 'whatsapp.connection.connected',
          orgId,
          payload: {
            connectionId: row.uuid,
            provider: family,
            providerKey: target.key,
            fromProviderKey: fromKey,
            reconnect: true,
            switched: true,
          },
        });
      }
    });
    return {
      ...base,
      state: repointOnly ? 'repointed' : 'switched',
      requirements,
      resubscribe: !repointOnly,
      inboundWired: wired,
      message,
    };
  }

  // --- internals ---------------------------------------------------------------------------------------------------

  private callback(): { url: string | null; verifyToken: string } {
    const base = this.env.WABA_WEBHOOK_PUBLIC_URL ?? this.config.get('APP_URL', { infer: true });
    return {
      url: webhookUrl(
        base,
        inboundUrlKey(this.config.get('CREDENTIALS_ENCRYPTION_KEY', { infer: true })),
      ),
      verifyToken: verifyTokenFor(
        this.env.WABA_VERIFY_TOKEN ?? this.config.get('WHATSAPP_VERIFY_TOKEN', { infer: true }),
        this.config.get('CREDENTIALS_ENCRYPTION_KEY', { infer: true }),
      ),
    };
  }

  /**
   * The route a number connected through Embedded Signup uses: the workspace's override, else the registry default, else the platform
   * setting (`WABA_DEFAULT_PROVIDER`). Interakt needs its partner key; without it, say so.
   */
  private async routeForNewNumbers(
    orgId: number,
  ): Promise<{ key: string; provider: WabaProviderKind; registry: WabaRegistryProvider | null }> {
    const route = await this.providers.forNewNumbers(orgId);
    if (route.key === 'interakt') {
      if (!this.env.INTERAKT_PARTNER_AUTH_KEY || !this.env.INTERAKT_SOLUTION_ID) {
        throw this.notConfigured(
          'INTERAKT_PARTNER_AUTH_KEY and INTERAKT_SOLUTION_ID (or set WABA_DEFAULT_PROVIDER=meta)',
        );
      }
    }
    return { key: route.key, provider: route.provider, registry: route.registry };
  }

  /** The resolved route of a number on a registry provider, as a partial connection (empty for the two built-in routes). */
  private registryOf(
    provider: WabaRegistryProvider | null,
    wabaId: string,
    phoneNumberId: string,
    accessToken: string | undefined,
  ): Pick<WabaConnection, 'registry'> {
    if (!provider) return {};
    const registry = this.routes.authFor(provider.key, { wabaId, phoneNumberId, accessToken });
    if (!registry) throw this.providerUnavailable();
    return { registry };
  }

  /**
   * Subscribe the WABA to this platform and prove it. Collects the human-facing caveats in `warnings`; returns the inbound
   * verdict (true, or null when unproven). A token without whatsapp_business_management aborts: nothing else can work.
   */
  private async wire(
    conn: WabaConnection,
    warnings: string[],
    abortOnMissingScope: boolean,
  ): Promise<boolean | null> {
    const cb = this.callback();
    if (!cb.url) {
      warnings.push(
        'No public webhook URL is configured (WABA_WEBHOOK_PUBLIC_URL), so Meta cannot deliver incoming messages here yet.',
      );
      return null;
    }
    const sub = await this.admin.subscribe(conn, { url: cb.url, verifyToken: cb.verifyToken });
    if (!sub.ok) {
      if (sub.error?.missingBusinessManagement && abortOnMissingScope) {
        throw new AppError(
          ERROR_CODES.WABA_MISSING_PERMISSION,
          translateConnectError(sub.error),
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'accessToken', message: 'Missing whatsapp_business_management.' }],
        );
      }
      warnings.push(
        `Subscribing to inbound messages failed: ${sub.error ? translateConnectError(sub.error) : 'unknown error'}. Use Fix inbound to retry.`,
      );
      return null;
    }
    const verified = await this.admin.verifyInboundWired(conn, cb.url);
    if (!sub.overrideApplied && verified !== true) {
      warnings.push(
        `This number is on its own Meta app, so it still delivers to that app's webhook. Set the callback URL ${cb.url} and the verify token in the app's WhatsApp > Configuration, then use Fix inbound.`,
      );
      return null;
    }
    return verified ?? (sub.overrideApplied ? true : null);
  }

  private async persist(a: {
    provider: WabaProviderKind;
    /** The provider registry key the number is on. */
    providerKey: string;
    via: 'embedded' | 'manual';
    phone: PhoneInfo;
    wabaId: string;
    businessId: string | null;
    businessName: string | null;
    businessVerified: boolean;
    credentials: StoredCredentials;
    label: string | null;
    tokenExpiresAt: Date | null;
    inboundWired: boolean | null;
    coexistence: boolean;
  }): Promise<{ row: WabaRow; created: boolean }> {
    const { orgId } = RequestContextStore.require();
    const now = new Date();
    const meta = {
      provider: a.provider,
      provider_key: a.providerKey,
      waba_id: a.wabaId,
      phone_number_id: a.phone.id,
      business_id: a.businessId,
      business_name: a.businessName,
      business_verified: a.businessVerified,
      ...phoneMeta(a.phone),
      connected_via: a.via,
      coexistence: a.coexistence ? true : null,
      token_expires_at: a.tokenExpiresAt ? a.tokenExpiresAt.toISOString() : null,
      inbound_wired: a.inboundWired,
      inbound_checked_at: now.toISOString(),
      last_error: null,
    };
    const encrypted = this.crypto.encrypt(JSON.stringify(a.credentials));
    try {
      return await this.db.tx(async (tx) => {
        const existing = await this.repo.findByIds(tx, orgId, a.wabaId, a.phone.id);
        if (existing) {
          const row = (await this.repo.update(tx, orgId, existing.id, {
            status: 'connected',
            phoneNumber: a.phone.displayPhoneNumber ?? existing.phone_number,
            displayLabel: a.label ?? existing.display_label,
            credentialsJson: encrypted,
            metaPatch: meta,
            connectedAt: now,
            lastHealthAt: now,
          }))!;
          await this.audit.record(tx, {
            module: MODULE,
            recordId: row.id,
            action: 'update',
            delta: { status: { old: existing.status, new: 'connected' } },
          });
          await this.outbox.emit(tx, {
            aggregateModule: MODULE,
            aggregateId: row.id,
            eventType: 'whatsapp.connection.connected',
            payload: {
              connectionId: row.uuid,
              provider: a.provider,
              providerKey: a.providerKey,
              reconnect: true,
            },
          });
          return { row, created: false };
        }
        const first = !(await this.repo.hasAnyWaba(tx, orgId));
        const row = await this.repo.insert(tx, orgId, {
          status: 'connected',
          isPrimary: first,
          phoneNumber: a.phone.displayPhoneNumber,
          displayLabel: a.label,
          credentialsJson: encrypted,
          metaJson: meta,
          connectedAt: now,
        });
        if (first) await this.repo.demoteOthers(tx, orgId, row.id);
        await this.audit.record(tx, {
          module: MODULE,
          recordId: row.id,
          action: 'insert',
          delta: { phone_number: { old: null, new: a.phone.displayPhoneNumber } },
        });
        await this.outbox.emit(tx, {
          aggregateModule: MODULE,
          aggregateId: row.id,
          eventType: 'whatsapp.connection.connected',
          payload: {
            connectionId: row.uuid,
            provider: a.provider,
            providerKey: a.providerKey,
            reconnect: false,
          },
        });
        return { row, created: true };
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new AppError(
          ERROR_CODES.WABA_NUMBER_IN_USE,
          'This WhatsApp number is already connected in another workspace. Disconnect it there first.',
          HttpStatus.CONFLICT,
        );
      }
      throw e;
    }
  }

  /** Register right after a direct connect. A failure never blocks the connect (WD-WABA-012 rule 7). */
  private async autoRegister(row: WabaRow, conn: WabaConnection): Promise<void> {
    const pin = generatePin();
    try {
      await this.admin.registerPhone(conn, pin);
      await this.saveCredentials(
        row,
        { ...(this.creds(row) ?? {}), register_pin: pin },
        'register',
      );
    } catch (e) {
      this.logger.debug({ id: row.uuid, err: asApiError(e).message }, 'auto-register skipped');
    }
  }

  private async saveCredentials(
    row: WabaRow,
    creds: StoredCredentials,
    why: string,
    extra: { status?: string; connectedAt?: Date | null; metaPatch?: Record<string, unknown> } = {},
  ): Promise<WabaRow> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const next = await this.repo.update(tx, orgId, row.id, {
        credentialsJson: this.crypto.encrypt(JSON.stringify(creds)),
        ...extra,
      });
      await this.audit.record(tx, {
        module: MODULE,
        recordId: row.id,
        action: 'update',
        delta: { credentials: { old: '[encrypted]', new: `[encrypted:${why}]` } },
      });
      return next!;
    });
  }

  private async touch(
    row: WabaRow,
    metaPatch: Record<string, unknown>,
    why: string,
    extra: { lastHealthAt?: Date; phoneNumber?: string | null } = {},
  ): Promise<WabaRow> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const next = await this.repo.update(tx, orgId, row.id, { metaPatch, ...extra });
      await this.audit.record(tx, {
        module: MODULE,
        recordId: row.id,
        action: 'update',
        delta: { meta: { old: null, new: why } },
      });
      return next ?? row;
    });
  }

  private async require(uuid: string): Promise<WabaRow> {
    const { orgId } = RequestContextStore.require();
    const row = await this.db.tx((tx) => this.repo.findByUuid(tx, orgId, uuid));
    if (!row) throw AppError.notFound('WhatsApp number', uuid);
    await this.providers.ensureKnown(providerKeyOf(row.meta_json));
    return row;
  }

  private creds(row: WabaRow): StoredCredentials | null {
    if (!row.credentials_json) return null;
    try {
      return JSON.parse(this.crypto.decrypt(row.credentials_json)) as StoredCredentials;
    } catch {
      return null;
    }
  }

  private tryConn(row: WabaRow): WabaConnection | null {
    const creds = this.creds(row);
    const m = row.meta_json ?? {};
    const wabaId = String(m.waba_id ?? '');
    const phoneNumberId = String(m.phone_number_id ?? '');
    if (!creds || !wabaId || !phoneNumberId) return null;
    // The provider key is authoritative; `provider` alone is what numbers connected before the registry have.
    const providerKey = providerKeyOf(m);
    const provider: WabaProviderKind = providerKey === 'interakt' ? 'interakt' : 'meta';
    let registry: WabaConnection['registry'];
    if (!isBuiltinWhatsappProviderKey(providerKey)) {
      registry =
        this.routes.authFor(providerKey, {
          wabaId,
          phoneNumberId,
          // A partner program's number sends with its own key; every other registry number with its access token.
          accessToken: creds.channel_token ?? creds.access_token,
        }) ?? undefined;
      // A provider that is gone, archived or without its credential carries nothing: the number reads as having no usable credentials.
      if (!registry) return null;
    }
    return {
      provider,
      providerKey,
      wabaId,
      phoneNumberId,
      accessToken: creds.access_token,
      authKey: creds.auth_key,
      ...(registry ? { registry } : {}),
    };
  }

  private connOf(row: WabaRow): WabaConnection {
    const conn = this.tryConn(row);
    if (!conn || (!conn.accessToken && !conn.authKey && !conn.registry)) throw this.noCredentials();
    return conn;
  }

  /** Runs a call to Meta, turning its failures into problem+json errors with the reason in Meta's words. */
  private async meta<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw this.rejected(`${what}: ${translateConnectError(asApiError(e))}`, undefined, e);
    }
  }

  private rejected(message: string, field?: string, cause?: unknown): AppError {
    const err = cause instanceof WabaApiError ? cause : null;
    if (err?.missingBusinessManagement) {
      return new AppError(
        ERROR_CODES.WABA_MISSING_PERMISSION,
        message,
        HttpStatus.UNPROCESSABLE_ENTITY,
        field ? [{ path: field, message }] : undefined,
      );
    }
    if (err && err.retryable) {
      return new AppError(
        ERROR_CODES.WABA_PROVIDER_UNAVAILABLE,
        message,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return new AppError(
      ERROR_CODES.WABA_PROVIDER_REJECTED,
      message,
      HttpStatus.UNPROCESSABLE_ENTITY,
      field ? [{ path: field, message }] : undefined,
    );
  }

  private notConfigured(what: string): AppError {
    return new AppError(
      ERROR_CODES.WABA_NOT_CONFIGURED,
      `WhatsApp Embedded Signup is not configured on this platform: set ${what}. Ask the platform admin, or use Add WABA > Manual.`,
      HttpStatus.CONFLICT,
    );
  }

  private providerUnavailable(): AppError {
    return new AppError(
      ERROR_CODES.PROVIDER_UNAVAILABLE,
      'The WhatsApp provider for this number is not available. Ask the platform admin.',
      HttpStatus.CONFLICT,
    );
  }

  private noCredentials(): AppError {
    return new AppError(
      ERROR_CODES.WABA_NO_CREDENTIALS,
      'No access token is stored for this number. Reconnect it, or paste a token on its health page.',
      HttpStatus.CONFLICT,
    );
  }
}

const asApiError = (e: unknown): WabaApiError =>
  e instanceof WabaApiError ? e : WabaApiError.network(e);

function authFor(conn: WabaConnection) {
  if (conn.registry) return conn.registry;
  return conn.provider === 'interakt' && conn.authKey
    ? ({
        provider: 'interakt',
        authKey: conn.authKey,
        wabaId: conn.wabaId,
        phoneNumberId: conn.phoneNumberId,
      } as const)
    : ({ provider: 'meta', accessToken: conn.accessToken ?? '' } as const);
}

function phoneMeta(p: PhoneInfo): Record<string, unknown> {
  return {
    verified_name: p.verifiedName,
    display_phone_number: p.displayPhoneNumber,
    quality_rating: p.qualityRating,
    messaging_limit_tier: p.messagingLimitTier,
    code_verification_status: p.codeVerificationStatus,
    name_status: p.nameStatus,
    account_mode: p.accountMode,
    throughput: p.throughput,
    platform_type: p.platformType,
    is_official_business_account: p.isOfficialBusinessAccount,
    is_pin_enabled: p.isPinEnabled,
    last_onboarded_time: p.lastOnboardedTime,
    phone_status: p.status,
  };
}

function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } } | null) ?? {};
  return code.code === UNIQUE_VIOLATION || code.cause?.code === UNIQUE_VIOLATION;
}
