import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ERROR_CODES,
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
import { toDto } from './waba-connections.mapper';
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
}

const UNIQUE_VIOLATION = '23505';
const MODULE = 'wa_provider_configs';

/**
 * Connecting and keeping WhatsApp Business numbers wired (TW-WABA-004..022).
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
  ) {}

  // --- reading -----------------------------------------------------------------------------------------------------

  readiness(): WabaReadiness {
    const r = this.admin.readiness();
    return { ...r, webhookUrl: this.callback().url };
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

  /** Embedded Signup: the browser finished Meta's popup and hands us the one-time code (TW-WABA-009). */
  async connectEmbedded(input: ConnectEmbeddedInput): Promise<ConnectResult> {
    const ready = this.admin.readiness();
    if (!this.env.META_APP_ID || !this.env.META_APP_SECRET) {
      throw this.notConfigured(
        `META_APP_ID and META_APP_SECRET${ready.missing.length ? ` (still unset: ${ready.missing.join(', ')})` : ''}`,
      );
    }
    const provider = this.routeForNewNumbers();

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

    const conn: WabaConnection = {
      provider,
      wabaId,
      phoneNumberId: phone.id,
      accessToken: token.accessToken,
      ...(provider === 'interakt' ? { authKey: this.env.INTERAKT_PARTNER_AUTH_KEY } : {}),
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

    const wired = await this.wire(conn, warnings, /* abortOnMissingScope */ true);

    const saved = await this.persist({
      provider,
      via: 'embedded',
      phone,
      wabaId,
      businessId,
      businessName: owner?.name ?? null,
      businessVerified,
      credentials: {
        access_token: token.accessToken,
        ...(provider === 'interakt' ? { auth_key: this.env.INTERAKT_PARTNER_AUTH_KEY } : {}),
      },
      label: phone.verifiedName,
      tokenExpiresAt: token.expiresInSeconds
        ? new Date(Date.now() + token.expiresInSeconds * 1000)
        : null,
      inboundWired: wired,
      coexistence: input.coexistence === true || isCoexistence(phone.platformType),
    });
    // Embedded Signup registers a number itself; only the direct route repeats Reference's silent register.
    if (provider === 'meta' && !isCoexistence(phone.platformType))
      await this.autoRegister(saved.row, conn);
    return { connection: toDto(saved.row), warnings };
  }

  /** Manual connect: the admin pastes Phone Number ID, WABA ID and a System User token (TW-WABA-006). */
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
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      accessToken: token,
    };
    const warnings: string[] = [];
    const wired = await this.wire(conn, warnings, true);

    const saved = await this.persist({
      provider: 'meta',
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

  /** The pre-save token self-check (TW-WABA-007): what the token can and cannot do, before anything is stored. */
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

  /** Fix inbound: re-run subscribe + override with the stored token and report whether it is wired (TW-WABA-014). */
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

  /** Register the number on the Cloud API; the PIN is the typed one, else the stored one, else a new one (TW-WABA-012). */
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

  /** Verified paste of a new token (TW-WABA-019). */
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

  /** Swap the stored token for a fresh long-lived one without reconnecting (TW-WABA-020). */
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

  /** Stop sending from the number: credentials wiped, row kept so history still points at it (TW-WABA-017). */
  async disconnect(uuid: string): Promise<WabaConnectionDto> {
    const { orgId } = RequestContextStore.require();
    const row = await this.require(uuid);
    // Meta keeps delivering to this app otherwise: unsubscribing is what Reference's "port notes" ask for. Best effort.
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

  /** Delete the number's row (TW-WABA-018). */
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

  /** Live read of the number from Meta plus the issues that follow from it (TW-WABA-021, 022). */
  async health(uuid: string): Promise<WabaHealth> {
    let row = await this.require(uuid);
    const meta = row.meta_json ?? {};
    const creds = this.creds(row);
    let liveReadFailed = false;
    let liveReadError: string | null = null;
    const tryConn = this.tryConn(row);
    if (tryConn && row.status !== 'disconnected') {
      try {
        const phone = await this.admin.getPhone(authFor(tryConn), tryConn.phoneNumberId);
        row = await this.touch(row, phoneMeta(phone), 'health', {
          lastHealthAt: new Date(),
          phoneNumber: phone.displayPhoneNumber ?? row.phone_number,
        });
      } catch (e) {
        liveReadFailed = true;
        liveReadError = translateConnectError(asApiError(e));
      }
    }
    const m = row.meta_json ?? meta;
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
      },
      new Date(),
    );
    return {
      connection: toDto(row),
      overall,
      issues,
      tokenHint: maskToken(creds?.access_token),
      checkedAt: new Date().toISOString(),
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

  /** The route a number connected through Embedded Signup uses. Interakt needs its partner key; without it, go direct. */
  private routeForNewNumbers(): WabaProviderKind {
    if (this.env.WABA_DEFAULT_PROVIDER === 'interakt') {
      if (!this.env.INTERAKT_PARTNER_AUTH_KEY || !this.env.INTERAKT_SOLUTION_ID) {
        throw this.notConfigured(
          'INTERAKT_PARTNER_AUTH_KEY and INTERAKT_SOLUTION_ID (or set WABA_DEFAULT_PROVIDER=meta)',
        );
      }
      return 'interakt';
    }
    return 'meta';
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
            payload: { connectionId: row.uuid, provider: a.provider, reconnect: true },
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
          payload: { connectionId: row.uuid, provider: a.provider, reconnect: false },
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

  /** Register right after a direct connect. A failure never blocks the connect (TW-WABA-012 rule 7). */
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
    const provider: WabaProviderKind = m.provider === 'interakt' ? 'interakt' : 'meta';
    return {
      provider,
      wabaId,
      phoneNumberId,
      accessToken: creds.access_token,
      authKey: creds.auth_key,
    };
  }

  private connOf(row: WabaRow): WabaConnection {
    const conn = this.tryConn(row);
    if (!conn || (!conn.accessToken && !conn.authKey)) throw this.noCredentials();
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
