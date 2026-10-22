import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CONFERENCING_APP_SLUG,
  CONFERENCING_CONFIRM_OUTCOME,
  CONNECTED_VIDEO_PROVIDERS,
  ERROR_CODES,
  type ConferencingCallbackQuery,
  type ConferencingConfirmInput,
  type ConferencingConnection,
  type ConferencingConnectionList,
  type ConferencingStartInput,
  type ConferencingStartResponse,
  type ConnectedVideoProvider,
} from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import { ConferencingError, teamsGrantCovers } from '../../infra/providers/meeting-conferencing';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { RbacService } from '../../kernel/rbac/rbac.service';
import {
  ConferencingConnectionRepository,
  type ConferencingConnectionRow,
} from './conferencing-connection.repository';
import {
  DEFAULT_RETURN,
  deriveStateKey,
  newState,
  returnUrl,
  signState,
  signTicket,
  STATE_TTL_SECONDS,
  TICKET_TTL_SECONDS,
  verifyState,
  verifyTicket,
} from './conferencing-state';
import { CONFERENCING_AUDIT_MODULE, ConferencingTokens } from './conferencing-tokens.service';

/**
 * A person's own Zoom / Teams connection (BL-360): the consent URL, the public callback, the confirmation by the same signed-in person, the
 * state of each card, and disconnecting. The workspace must have installed the Marketplace listing first; nothing here works without it.
 * Modelled on the Microsoft calendar connection (see `conferencing-state.ts` for why the callback exchanges nothing).
 */
@Injectable()
export class ConferencingConnectService {
  private readonly logger = new Logger(ConferencingConnectService.name);
  private readonly credentialsKey: string;
  private stateKeyPromise?: Promise<Buffer>;
  private readonly webUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ConferencingConnectionRepository,
    private readonly tokens: ConferencingTokens,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly rbac: RbacService,
    env: ConfigService<Env, true>,
  ) {
    this.credentialsKey = env.get('CREDENTIALS_ENCRYPTION_KEY', { infer: true });
    this.webUrl = env.get('WEB_APP_URL', { infer: true }).replace(/\/$/, '');
  }

  /** Derived once, on the first request that needs it: the HKDF runs on the libuv pool, not on the event loop. */
  private stateKey(): Promise<Buffer> {
    return (this.stateKeyPromise ??= deriveStateKey(this.credentialsKey));
  }

  // --- staff -----------------------------------------------------------------------------------------------------------

  /** The cards of Settings, Video meetings, for the signed-in person. */
  async list(): Promise<ConferencingConnectionList> {
    const ctx = RequestContextStore.require();
    if (ctx.userId === null) throw AppError.unauthenticated();
    const slugs = CONNECTED_VIDEO_PROVIDERS.map((p) => CONFERENCING_APP_SLUG[p]);
    const { installed, published, mine } = await this.db.tx(async (tx) => ({
      installed: await this.repo.installedApps(tx, ctx.orgId, slugs),
      published: await this.repo.publishedApps(tx, slugs),
      mine: await this.repo.listForUser(tx, ctx.orgId, ctx.userId!),
    }));
    const data: ConferencingConnection[] = [];
    for (const provider of CONNECTED_VIDEO_PROVIDERS) {
      const conn = mine.find((c) => c.provider === provider);
      const slug = CONFERENCING_APP_SLUG[provider];
      data.push(await this.card(provider, installed.has(slug), published.has(slug), conn));
    }
    return { data, canInstall: this.canInstall() };
  }

  private async card(
    provider: ConnectedVideoProvider,
    installed: boolean,
    published: boolean,
    conn: ConferencingConnectionRow | undefined,
  ): Promise<ConferencingConnection> {
    const configured = await this.tokens.adapter(provider).configured();
    const covers = provider !== 'teams' || !conn || teamsGrantCovers(conn.scopes);
    const installable = published && configured;
    const status = !installed
      ? // Not installed: installable now, or not available yet (a draft listing, or a provider the operator has not set up).
        installable
        ? 'not_installed'
        : 'not_available'
      : !configured
        ? 'unavailable'
        : !conn
          ? 'disconnected'
          : conn.status !== 'active' || !covers
            ? 'needs_reconnect'
            : 'connected';
    return {
      provider,
      status,
      listingPublished: published,
      configured,
      // A deep link to the listing page: the Integrations list may not show it, and a person must not land on an empty list.
      listingPath:
        !installed && installable ? `/marketplace/app/${CONFERENCING_APP_SLUG[provider]}` : null,
      account: conn?.accountEmail ?? null,
      connectedAt: conn?.connectedAt.toISOString() ?? null,
      lastErrorCode: conn?.lastErrorCode ?? null,
    };
  }

  canInstall(): boolean {
    const ctx = RequestContextStore.require();
    return ctx.grants ? this.rbac.can(ctx.grants, 'market.apps.install').allowed : false;
  }

  /** The consent URL, bound to this workspace and person. The browser is sent there by the web app. */
  async start(
    provider: ConnectedVideoProvider,
    input: ConferencingStartInput,
  ): Promise<ConferencingStartResponse> {
    const ctx = RequestContextStore.require();
    if (ctx.userId === null) throw AppError.unauthenticated();
    await this.requireInstalled(ctx.orgId, provider);
    const adapter = this.tokens.adapter(provider);
    if (!(await adapter.configured())) throw this.notConfigured(provider);
    const state = newState(
      {
        orgId: ctx.orgId,
        userId: ctx.userId,
        provider,
        returnTo: input.returnTo ?? DEFAULT_RETURN,
      },
      Date.now(),
    );
    return {
      url: await adapter.authorizeUrl(signState(state, await this.stateKey())),
      expiresInSeconds: STATE_TTL_SECONDS,
    };
  }

  /** Forgets the grant here. Neither provider offers an app a way to withdraw a person's consent: the person removes it in their account. */
  async disconnect(provider: ConnectedVideoProvider): Promise<ConferencingConnection> {
    const ctx = RequestContextStore.require();
    if (ctx.userId === null) throw AppError.unauthenticated();
    await this.db.tx(async (tx) => {
      const live = await this.repo.find(tx, ctx.orgId, ctx.userId!, provider, true);
      if (!live) return;
      await this.repo.remove(tx, ctx.orgId, live.id);
      await this.audit.record(tx, {
        module: CONFERENCING_AUDIT_MODULE,
        recordId: live.id,
        action: 'delete',
        delta: { status: { old: live.status, new: 'disconnected' } },
      });
      await this.outbox.emit(tx, {
        orgId: ctx.orgId,
        aggregateModule: CONFERENCING_AUDIT_MODULE,
        aggregateId: live.id,
        eventType: 'conferencing.disconnected',
        payload: { uuid: live.uuid, provider },
      });
    });
    const out = (await this.list()).data.find((c) => c.provider === provider)!;
    return out;
  }

  // --- the public callback -----------------------------------------------------------------------------------------------

  /**
   * The provider's redirect: verifies the state and sends the browser back to the app, with a ticket when the provider returned a code.
   * Nothing is exchanged or stored here (see `conferencing-state.ts`); the ticket is confirmed by the person on the connection page.
   */
  async callback(
    provider: ConnectedVideoProvider,
    query: ConferencingCallbackQuery,
  ): Promise<string> {
    const checked = verifyState(query.state ?? '', await this.stateKey(), Date.now());
    if (!checked.ok || checked.value.provider !== provider) {
      this.logger.warn(
        { provider, reason: checked.ok ? 'provider' : checked.reason },
        'a video consent callback with a bad state',
      );
      return returnUrl(this.webUrl, DEFAULT_RETURN, {
        video: !checked.ok && checked.reason === 'expired' ? 'expired' : 'failed',
        provider,
      });
    }
    const { userId, returnTo } = checked.value;
    const done = (outcome: string) =>
      returnUrl(this.webUrl, returnTo, { video: outcome, provider });
    if (query.error) return done('denied');
    if (!query.code || userId === null) return done('failed');
    if (!(await this.tokens.adapter(provider).configured())) return done('not_configured');
    const ticket = signTicket(
      {
        orgId: checked.value.orgId,
        userId,
        provider,
        returnTo,
        sealedCode: this.crypto.encrypt(query.code),
        expiresAt: Date.now() + TICKET_TTL_SECONDS * 1000,
      },
      await this.stateKey(),
    );
    return returnUrl(this.webUrl, returnTo, {
      video: CONFERENCING_CONFIRM_OUTCOME,
      provider,
      ticket,
    });
  }

  /**
   * The same signed-in person confirms: only now is the code exchanged. A ticket from another workspace or another person is refused
   * before the provider is called.
   */
  async confirm(
    provider: ConnectedVideoProvider,
    input: ConferencingConfirmInput,
  ): Promise<ConferencingConnection> {
    const ctx = RequestContextStore.require();
    if (ctx.userId === null) throw AppError.unauthenticated();
    const checked = verifyTicket(input.ticket, await this.stateKey(), Date.now());
    if (!checked.ok || checked.value.provider !== provider) {
      throw new AppError(
        ERROR_CODES.CONF_CONFIRM_INVALID,
        'This connection link is not valid any more. Press Connect again.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const t = checked.value;
    if (t.orgId !== ctx.orgId || t.userId !== ctx.userId) {
      throw new AppError(
        ERROR_CODES.CONF_CONFIRM_NOT_YOURS,
        'This connection was started by someone else. Nothing was connected.',
        HttpStatus.FORBIDDEN,
      );
    }
    await this.requireInstalled(ctx.orgId, provider);
    const adapter = this.tokens.adapter(provider);
    let code: string;
    try {
      code = this.crypto.decrypt(t.sealedCode);
    } catch {
      throw new AppError(
        ERROR_CODES.CONF_CONFIRM_INVALID,
        'This connection link is not valid any more. Press Connect again.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    let granted;
    let account;
    try {
      granted = await adapter.exchangeCode(code);
      account = await adapter.profile(granted.accessToken);
    } catch (err) {
      throw this.asApiError(err, provider);
    }
    if (!granted.refreshToken) {
      // Without a refresh token the grant dies within the hour: ask again rather than store half a connection.
      throw new AppError(
        ERROR_CODES.CONF_PROVIDER_FAILED,
        'The provider did not allow us to stay connected. Press Connect again and accept all the permissions.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    if (provider === 'teams' && !teamsGrantCovers(granted.scope)) {
      throw new AppError(
        ERROR_CODES.CONF_NEEDS_RECONNECT,
        'Microsoft was not given permission to create meetings. Press Connect again and accept all the permissions.',
        HttpStatus.CONFLICT,
      );
    }
    await this.db.tx(async (tx) => {
      const row = await this.repo.upsert(tx, ctx.orgId, {
        userId: ctx.userId!,
        provider,
        accountEmail: account.email,
        accountSub: account.id,
        refreshTokenEnc: this.crypto.encrypt(granted.refreshToken!),
        accessTokenEnc: this.crypto.encrypt(granted.accessToken),
        accessTokenExpiresAt: new Date(Date.now() + granted.expiresInSeconds * 1000),
        scopes: granted.scope,
      });
      await this.audit.record(tx, {
        module: CONFERENCING_AUDIT_MODULE,
        recordId: row.id,
        action: 'insert',
        delta: { provider: { old: null, new: provider } },
      });
      await this.outbox.emit(tx, {
        orgId: ctx.orgId,
        aggregateModule: CONFERENCING_AUDIT_MODULE,
        aggregateId: row.id,
        eventType: 'conferencing.connected',
        payload: { uuid: row.uuid, provider },
      });
    });
    return (await this.list()).data.find((c) => c.provider === provider)!;
  }

  // --- helpers ---------------------------------------------------------------------------------------------------------

  private async requireInstalled(orgId: number, provider: ConnectedVideoProvider): Promise<void> {
    const installed = await this.db.tx((tx) =>
      this.repo.installedApps(tx, orgId, [CONFERENCING_APP_SLUG[provider]]),
    );
    if (!installed.has(CONFERENCING_APP_SLUG[provider])) {
      throw new AppError(
        ERROR_CODES.CONF_APP_NOT_INSTALLED,
        'Install this integration from the Marketplace first.',
        HttpStatus.CONFLICT,
      );
    }
  }

  private notConfigured(provider: ConnectedVideoProvider): AppError {
    return new AppError(
      ERROR_CODES.CONF_NOT_CONFIGURED,
      provider === 'zoom'
        ? 'Zoom is not set up for this platform. Ask your platform administrator to add the Zoom app.'
        : 'Microsoft Teams is not set up for this platform. Ask your platform administrator to add the Microsoft app.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  private asApiError(err: unknown, provider: ConnectedVideoProvider): AppError {
    if (err instanceof ConferencingError) {
      if (err.kind === 'invalid_client') return this.notConfigured(provider);
      if (err.kind === 'invalid_grant') {
        return new AppError(
          ERROR_CODES.CONF_CONFIRM_INVALID,
          'The provider did not accept this sign-in. Press Connect again.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }
    this.logger.warn({ provider, err: String(err) }, 'a video provider did not answer');
    return new AppError(
      ERROR_CODES.CONF_PROVIDER_FAILED,
      'The provider did not answer. Try again in a moment.',
      HttpStatus.BAD_GATEWAY,
    );
  }
}
