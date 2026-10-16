import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ERROR_CODES,
  type ConnectImapMailboxInput,
  type MailCallbackQuery,
  type MailConnectOutcome,
  type MailProvider,
  type MailScope,
  type StartMailboxConnectInput,
  type StartMailboxConnectResponse,
} from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import type { MailAccountProfile, PasswordConnection } from '../../infra/providers/channel-email';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { MailDriverError } from './drivers/mail-driver';
import { MailDriverRegistry } from './drivers/mail-driver.registry';
import { MailAccess } from './mail-access.service';
import { MailChannelSync } from './mail-channel.sync';
import { passwordConnectionOf, publicSummaryOf, sealConnection } from './mail-connection';
import { mailboxLimit, notConfigured } from './mail-errors';
import { MailPlan } from './mail-plan';
import {
  mayAct,
  personalConnectRefusal,
  personalDisabled,
  personalNotAllowed,
  viewOf,
} from './mail-personal-policy';
import { deriveStateKey, newState, returnUrl, signState, verifyState } from './mail-state';
import { MailSyncPublisher } from './mail-sync.publisher';
import { MAIL_AUDIT_MODULE } from './mail-tokens.service';
import { MailboxesRepository, type MailboxRow, type ConnectInput } from './mailboxes.repository';

const DEFAULT_RETURN = '/email';

/** Why a connection ends without storing a mailbox. */
class Outcome extends Error {
  constructor(readonly outcome: MailConnectOutcome) {
    super(outcome);
  }
}

/** What `persist` is given: who is connecting what, with which credentials. */
interface Persist {
  orgId: number;
  userId: number | null;
  provider: MailProvider;
  scope: MailScope;
  /** The mailbox being reconnected, by uuid. */
  mailboxId: string | null;
  account: MailAccountProfile;
  /** What the connection must carry to be usable: a refresh token (sign-in providers) or the sealed logins (password providers). */
  requires: 'refresh_token' | 'connection';
  /** The display name to give a NEW mailbox. */
  displayName: string | null;
  credentials: Pick<
    ConnectInput,
    | 'refreshTokenEnc'
    | 'accessTokenEnc'
    | 'accessTokenExpiresAt'
    | 'scopes'
    | 'connectionEnc'
    | 'connectionPublic'
  >;
}

/**
 * Connecting a mailbox (TW-MAIL-020, 031, 034, 035), whatever its provider. A sign-in provider (Google, Microsoft) is `start` + the public
 * `callback`; a password provider (IMAP/SMTP) is `connectWithPassword`. Both end in `persist`, the one place that enforces the plan
 * limit, the account check, the shared/personal rule and writes the audit row and the event. Several mailboxes per workspace up to the
 * plan's `email_mailboxes`; connecting an address the workspace already has (a reconnect) updates that row instead of adding a second,
 * and an account that is not the mailbox being reconnected is refused (`wrong_account`).
 *
 * What differs from Reference: Reference bridged to MailTrixy and never saw the provider; here the platform's own client does the OAuth,
 * the state is signed and expires instead of living in a session, only read and send scopes are asked for, and a grant the provider later
 * refuses is shown as "needs reconnecting" instead of failing silently.
 */
@Injectable()
export class MailConnectService {
  private readonly logger = new Logger(MailConnectService.name);
  private readonly stateKey: Buffer;
  private readonly webUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MailboxesRepository,
    private readonly drivers: MailDriverRegistry,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly plan: MailPlan,
    private readonly channel: MailChannelSync,
    private readonly sync: MailSyncPublisher,
    private readonly access: MailAccess,
    env: ConfigService<Env, true>,
  ) {
    this.stateKey = deriveStateKey(env.get('CREDENTIALS_ENCRYPTION_KEY', { infer: true }));
    this.webUrl = env.get('WEB_APP_URL', { infer: true }).replace(/\/$/, '');
  }

  /** The consent URL, bound to this workspace and admin. The browser is sent there by the web app. */
  async start(input: StartMailboxConnectInput): Promise<StartMailboxConnectResponse> {
    const ctx = RequestContextStore.require();
    const driver = this.drivers.oauth(input.provider);

    let loginHint: string | null = null;
    let scope: MailScope = input.scope;
    if (input.mailboxId) {
      const existing = await this.assertMayReconnect(ctx.orgId, input.mailboxId);
      loginHint = existing.address;
      scope = existing.scope;
    } else {
      await this.assertMayConnectNew(ctx.orgId, scope);
      // Refuse early, before the person goes through the provider's screens for nothing. The callback checks again.
      const [limit, active] = await Promise.all([
        this.plan.mailboxLimit(ctx.orgId),
        this.db.tx((tx) => this.repo.countActive(tx, ctx.orgId)),
      ]);
      if (limit > 0 && active >= limit) throw mailboxLimit(limit);
    }

    let authorizeUrl: string;
    try {
      const state = signState(
        newState(
          {
            orgId: ctx.orgId,
            userId: ctx.userId,
            returnTo: input.returnTo,
            mailboxId: input.mailboxId ?? null,
            provider: driver.provider,
            scope,
          },
          Date.now(),
        ),
        this.stateKey,
      );
      authorizeUrl = await driver.authorizeUrl({ state, loginHint });
    } catch (err) {
      if (err instanceof MailDriverError && err.kind === 'not_configured') throw notConfigured();
      throw err;
    }
    return { authorizeUrl };
  }

  /**
   * Completes the consent: verifies the signed state, trades the code for tokens, checks the provider granted what the work needs, reads
   * the account, and stores the sealed grant. Always ends in a redirect back to the page the admin came from with `?email=<outcome>`;
   * nothing about the provider's answer is shown on this address. `routeProvider` is the provider the callback address belongs to: a
   * state minted for another provider is refused.
   */
  async callback(
    query: MailCallbackQuery,
    routeProvider: MailProvider = 'google',
  ): Promise<string> {
    const checked = verifyState(query.state ?? '', this.stateKey, Date.now());
    if (!checked.ok || checked.state.provider !== routeProvider) {
      // No trustworthy state: nobody to bind this to, nothing is stored.
      this.logger.warn(
        { reason: checked.ok ? 'provider' : checked.reason },
        'mail callback with a bad state',
      );
      return returnUrl(this.webUrl, DEFAULT_RETURN, 'failed');
    }
    const { state } = checked;
    const done = (outcome: MailConnectOutcome) => returnUrl(this.webUrl, state.returnTo, outcome);

    if (query.error) return done('denied');
    if (!query.code) return done('failed');
    const driver = this.drivers.find(state.provider);
    if (!driver || driver.authKind !== 'oauth') return done('failed');

    let accessToken: string | null = null;
    let refreshToken: string | null = null;
    let stored: MailboxRow | null = null;

    try {
      // The workspace may have lost the add-on while the person was on the provider's screen.
      if (!(await this.plan.isEnabled(state.orgId))) throw new Outcome('failed');

      const grant = await driver.exchange(query.code);
      accessToken = grant.accessToken;
      refreshToken = grant.refreshToken;
      const granted = new Set(grant.scopes);
      if (driver.requiredScopes.some((s) => !granted.has(s))) throw new Outcome('missing_scope');
      const account = await driver.profile(grant.accessToken);
      if (!account.address) throw new Outcome('failed');
      account.address = account.address.trim().toLowerCase();

      // The person may have lost the right (or the workspace switched personal mailboxes off) while on the provider's screens.
      if (state.scope === 'personal' && !state.mailboxId) {
        const refusal = await this.access.personalRefusalFor(state.orgId, state.userId);
        if (refusal) throw new Outcome('failed');
      }
      stored = await this.runAs(state.orgId, state.userId, `mail-connect-${state.nonce}`, () =>
        this.persist({
          orgId: state.orgId,
          userId: state.userId,
          provider: driver.provider,
          scope: state.scope,
          mailboxId: state.mailboxId,
          account,
          requires: 'refresh_token',
          displayName: account.name,
          credentials: {
            refreshTokenEnc: grant.refreshToken ? this.crypto.encrypt(grant.refreshToken) : null,
            accessTokenEnc: this.crypto.encrypt(grant.accessToken),
            accessTokenExpiresAt: new Date(Date.now() + grant.expiresInSeconds * 1000),
            scopes: [...granted].join(' '),
            connectionEnc: grant.extras
              ? sealConnection(this.crypto, { extras: grant.extras })
              : null,
            connectionPublic: null,
          },
        }),
      );
    } catch (err) {
      if (err instanceof Outcome) {
        // What was just granted is withdrawn rather than left dangling. A reconnect that failed keeps the old grant: only the NEW token goes.
        await driver.revoke(refreshToken ?? accessToken ?? '').catch(() => undefined);
        return done(err.outcome);
      }
      if (err instanceof MailDriverError && err.kind === 'not_configured')
        return done('not_configured');
      this.logger.warn(
        { orgId: state.orgId, provider: state.provider, err: (err as Error).message },
        'mail connect failed',
      );
      return done('failed');
    }

    await this.afterConnect(state.orgId, state.userId, `mail-connect-${state.nonce}`, stored);
    return done('connected');
  }

  /**
   * Connects a mailbox with its server settings and password (IMAP/SMTP, TW-MAIL-031). Both logins are verified by the driver BEFORE
   * anything is stored; a refused password or an unreachable server is a 422 with its own code. The password is sealed and never returned.
   * Returns the stored row (the controller answers with `MailboxesService.get`).
   */
  async connectWithPassword(input: ConnectImapMailboxInput): Promise<MailboxRow> {
    const ctx = RequestContextStore.require();
    const driver = this.drivers.password('imap');

    if (input.mailboxId) {
      await this.assertMayReconnect(ctx.orgId, input.mailboxId);
    } else {
      await this.assertMayConnectNew(ctx.orgId, input.scope);
      const [limit, active] = await Promise.all([
        this.plan.mailboxLimit(ctx.orgId),
        this.db.tx((tx) => this.repo.countActive(tx, ctx.orgId)),
      ]);
      if (limit > 0 && active >= limit) throw mailboxLimit(limit);
    }

    const connection: PasswordConnection = passwordConnectionOf(input);
    let account: MailAccountProfile;
    try {
      account = await driver.verify(connection);
    } catch (err) {
      throw this.verifyFailure(err);
    }
    // The address the person typed is the mailbox (IMAP servers do not report one).
    account = { ...account, address: input.address };

    let row: MailboxRow;
    try {
      row = await this.persist({
        orgId: ctx.orgId,
        userId: ctx.userId,
        provider: driver.provider,
        scope: input.scope,
        mailboxId: input.mailboxId ?? null,
        account,
        requires: 'connection',
        displayName: input.displayName,
        credentials: {
          refreshTokenEnc: null,
          accessTokenEnc: null,
          accessTokenExpiresAt: null,
          scopes: null,
          connectionEnc: sealConnection(this.crypto, { login: connection }),
          connectionPublic: publicSummaryOf(connection),
        },
      });
    } catch (err) {
      if (err instanceof Outcome) {
        if (err.outcome === 'limit') throw mailboxLimit(await this.plan.mailboxLimit(ctx.orgId));
        throw this.outcomeError(err.outcome);
      }
      throw err;
    }
    await this.afterConnect(ctx.orgId, ctx.userId, `mail-connect-${row.uuid}`, row);
    return row;
  }

  /**
   * May the caller add a NEW mailbox of this scope? A shared one needs `mail.mailboxes.manage`. A personal one needs the workspace policy to
   * enable personal mailboxes (422 MAIL_PERSONAL_DISABLED) and the caller to be among the people it lets connect one (403
   * MAIL_PERSONAL_NOT_ALLOWED): admins only, or any member holding `mail.mailboxes.manage_personal`.
   */
  private async assertMayConnectNew(orgId: number, scope: MailScope): Promise<void> {
    const actor = this.access.actor();
    if (scope === 'shared') {
      if (!actor.canManageShared) throw AppError.forbidden('mail.mailboxes.manage');
      return;
    }
    const policy = await this.db.tx((tx) => this.access.policy(tx, orgId));
    const refusal = personalConnectRefusal(actor, policy);
    if (refusal === 'disabled') throw personalDisabled();
    if (refusal === 'not_allowed') throw personalNotAllowed();
  }

  /**
   * May the caller renew the login of this mailbox? Shared: `mail.mailboxes.manage`. Personal: only its owner (their login is theirs; an admin
   * cannot take it over, and does not learn it exists unless the hub already shows it to them). Reconnecting an existing personal mailbox
   * stays possible after the policy is switched off: turning the policy off never takes a person's own mailbox away.
   */
  private async assertMayReconnect(orgId: number, uuid: string): Promise<MailboxRow> {
    const actor = this.access.actor();
    const { row, policy } = await this.db.tx(async (tx) => ({
      row: await this.repo.byUuid(tx, orgId, uuid),
      policy: await this.access.policy(tx, orgId),
    }));
    if (!row) throw AppError.notFound('Mailbox', uuid);
    if (viewOf(actor, row, policy) === 'none') throw AppError.notFound('Mailbox', uuid);
    if (!mayAct(actor, row, 'reconnect')) {
      throw AppError.forbidden(
        row.scope === 'shared' ? 'mail.mailboxes.manage' : 'mail.mailboxes.manage_personal',
      );
    }
    return row;
  }

  /** The one transaction that stores a connection: checks, the row, the audit entry and the event. Throws `Outcome`. */
  private persist(input: Persist): Promise<MailboxRow> {
    return this.db.txAs({ orgId: input.orgId, userId: input.userId }, async (tx) => {
      const target = input.mailboxId
        ? await this.repo.byUuid(tx, input.orgId, input.mailboxId, true)
        : undefined;
      if (input.mailboxId && !target) throw new Outcome('failed');
      const address = input.account.address;
      // The person must sign in to the account the mailbox IS (by address, and by the provider's id once known).
      if (target) {
        const sameAddress = target.address.toLowerCase() === address;
        const sameAccount =
          target.accountSub === null ||
          input.account.sub === null ||
          target.accountSub === input.account.sub;
        if (!sameAddress || !sameAccount || target.provider !== input.provider) {
          throw new Outcome('wrong_account');
        }
        // Only the owner can renew the login of a personal mailbox.
        if (target.scope === 'personal' && target.ownerUserId !== input.userId) {
          throw new Outcome('failed');
        }
      }
      const existing = target ?? (await this.repo.byAddress(tx, input.orgId, address, true));
      if (
        existing &&
        existing.accountSub &&
        input.account.sub &&
        existing.accountSub !== input.account.sub
      ) {
        throw new Outcome('wrong_account');
      }
      // An address the workspace holds as another provider's, or as the other kind of mailbox, is not taken over by a new connection.
      if (
        existing &&
        existing.status !== 'disconnected' &&
        (existing.provider !== input.provider ||
          existing.scope !== input.scope ||
          (existing.scope === 'personal' && existing.ownerUserId !== input.userId))
      ) {
        throw new Outcome('wrong_account');
      }
      const c = input.credentials;
      // A reconnect that came back without a refresh token keeps the one the mailbox has (the provider issues one only on first consent).
      const refreshTokenEnc =
        c.refreshTokenEnc ??
        (existing && existing.status !== 'disconnected' ? existing.refreshTokenEnc : null);
      if (input.requires === 'refresh_token' ? !refreshTokenEnc : !c.connectionEnc) {
        throw new Outcome('failed');
      }

      // A mailbox that counts against the plan already (connected, needs reauth, error) is not a new one.
      if (!existing || existing.status === 'disconnected') {
        const [limit, active] = await Promise.all([
          this.plan.mailboxLimit(input.orgId),
          this.repo.countActive(tx, input.orgId),
        ]);
        if (limit > 0 && active >= limit) throw new Outcome('limit');
      }
      // A mailbox that is still connected keeps its kind; a disconnected one is picked up as whatever this connection is.
      const scope = existing && existing.status !== 'disconnected' ? existing.scope : input.scope;
      const connect: ConnectInput = {
        provider: input.provider,
        scope,
        ownerUserId: scope === 'personal' ? input.userId : null,
        address,
        accountSub: input.account.sub,
        displayName: existing?.displayName ?? input.displayName ?? address,
        refreshTokenEnc,
        accessTokenEnc: c.accessTokenEnc,
        accessTokenExpiresAt: c.accessTokenExpiresAt,
        scopes: c.scopes,
        connectionEnc: c.connectionEnc,
        connectionPublic: c.connectionPublic,
        connectedBy: input.userId,
      };
      if (scope === 'personal' && connect.ownerUserId === null) throw new Outcome('failed');
      const row = existing
        ? await this.repo.reconnect(tx, input.orgId, existing.id, connect)
        : await this.repo.insert(tx, input.orgId, connect);
      await this.audit.record(tx, {
        module: MAIL_AUDIT_MODULE,
        recordId: row.id,
        action: existing ? 'update' : 'insert',
        delta: { status: { old: existing?.status ?? 'disconnected', new: 'connected' } },
      });
      await this.outbox.emit(tx, {
        orgId: input.orgId,
        aggregateModule: MAIL_AUDIT_MODULE,
        aggregateId: row.id,
        eventType: existing ? 'mail.mailbox.reconnected' : 'mail.mailbox.connected',
        payload: { uuid: row.uuid, provider: row.provider, address: row.address, scope: row.scope },
      });
      return row;
    });
  }

  /** The inbox channel and the first sync. Best effort: the mailbox is saved, and the sweep repairs either. */
  private async afterConnect(
    orgId: number,
    userId: number | null,
    requestId: string,
    row: MailboxRow,
  ): Promise<void> {
    await this.runAs(orgId, userId, requestId, () => this.channel.sync(orgId, row));
    await this.sync.enqueue(orgId, row.uuid);
  }

  private runAs<T>(
    orgId: number,
    userId: number | null,
    requestId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    return RequestContextStore.run(
      { requestId, orgId, actorType: 'user', actorId: userId, userId },
      fn,
    );
  }

  /** A failed verification as the API's own answer: which login was refused, or that the server did not answer. */
  private verifyFailure(err: unknown): AppError {
    if (err instanceof MailDriverError) {
      if (err.kind === 'auth_failed') {
        const smtp = err.providerCode === 'smtp';
        return new AppError(
          smtp ? ERROR_CODES.MAIL_SMTP_AUTH_FAILED : ERROR_CODES.MAIL_IMAP_AUTH_FAILED,
          err.message,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      return new AppError(
        ERROR_CODES.MAIL_IMAP_CONNECT_FAILED,
        err.message,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return new AppError(
      ERROR_CODES.MAIL_IMAP_CONNECT_FAILED,
      'The mail server could not be reached.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  /** `Outcome` as an API answer, for the flows that are not a browser redirect. */
  private outcomeError(outcome: MailConnectOutcome): AppError {
    if (outcome === 'wrong_account') {
      return new AppError(
        ERROR_CODES.MAIL_WRONG_ACCOUNT,
        'This is not the account of the mailbox being reconnected.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return new AppError(
      ERROR_CODES.MAIL_MAILBOX_UNAVAILABLE,
      'The mailbox could not be connected.',
      HttpStatus.CONFLICT,
    );
  }
}
