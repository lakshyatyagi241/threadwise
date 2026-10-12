import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type MailCallbackQuery,
  type MailConnectOutcome,
  type StartMailboxConnectInput,
  type StartMailboxConnectResponse,
} from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { GOOGLE_MAIL_REQUIRED_SCOPES } from '../../config/domains/channel-email.env';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import { GoogleMailOAuthClient } from '../../infra/providers/channel-email';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { MailChannelSync } from './mail-channel.sync';
import { GoogleMailConfig } from './mail-config.service';
import { mailboxLimit, notConfigured } from './mail-errors';
import { MailPlan } from './mail-plan';
import { deriveStateKey, newState, returnUrl, signState, verifyState } from './mail-state';
import { MailSyncPublisher } from './mail-sync.publisher';
import { MAIL_AUDIT_MODULE } from './mail-tokens.service';
import { MailboxesRepository, type MailboxRow } from './mailboxes.repository';

const DEFAULT_RETURN = '/email';

/** Why a callback ends without storing a mailbox. */
class Outcome extends Error {
  constructor(readonly outcome: MailConnectOutcome) {
    super(outcome);
  }
}

/**
 * Connecting a Gmail mailbox (TW-MAIL-020): the consent URL, and the public callback that completes it. Several mailboxes per workspace
 * up to the plan's `email_mailboxes`; connecting an address the workspace already has (a reconnect) updates that row instead of adding a
 * second, and a Google account that is not the mailbox being reconnected is refused (`wrong_account`).
 *
 * What differs from Reference: Reference bridged to MailTrixy and never saw Google; here the platform's own Google client does the OAuth,
 * the state is signed and expires instead of living in a session, only `gmail.readonly` and `gmail.send` are asked for, and a grant that
 * Google later refuses is shown as "needs reconnecting" instead of failing silently.
 */
@Injectable()
export class MailConnectService {
  private readonly logger = new Logger(MailConnectService.name);
  private readonly stateKey: Buffer;
  private readonly webUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MailboxesRepository,
    private readonly config: GoogleMailConfig,
    private readonly oauth: GoogleMailOAuthClient,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly plan: MailPlan,
    private readonly channel: MailChannelSync,
    private readonly sync: MailSyncPublisher,
    env: ConfigService<Env, true>,
  ) {
    this.stateKey = deriveStateKey(env.get('CREDENTIALS_ENCRYPTION_KEY', { infer: true }));
    this.webUrl = env.get('WEB_APP_URL', { infer: true }).replace(/\/$/, '');
  }

  /** The consent URL, bound to this workspace and admin. The browser is sent there by the web app. */
  async start(input: StartMailboxConnectInput): Promise<StartMailboxConnectResponse> {
    const ctx = RequestContextStore.require();
    const creds = await this.config.credentials();
    if (!creds) throw notConfigured();

    let loginHint: string | undefined;
    if (input.mailboxId) {
      const existing = await this.db.tx((tx) => this.repo.byUuid(tx, ctx.orgId, input.mailboxId!));
      if (!existing) throw AppError.notFound('Mailbox', input.mailboxId);
      loginHint = existing.address;
    } else {
      // Refuse early, before the person goes through Google's screens for nothing. The callback checks again.
      const [limit, active] = await Promise.all([
        this.plan.mailboxLimit(ctx.orgId),
        this.db.tx((tx) => this.repo.countActive(tx, ctx.orgId)),
      ]);
      if (limit > 0 && active >= limit) throw mailboxLimit(limit);
    }
    const state = signState(
      newState(
        {
          orgId: ctx.orgId,
          userId: ctx.userId,
          returnTo: input.returnTo,
          mailboxId: input.mailboxId ?? null,
        },
        Date.now(),
      ),
      this.stateKey,
    );
    return { authorizeUrl: this.oauth.authorizeUrl(creds, state, loginHint) };
  }

  /**
   * Completes the consent: verifies the signed state, trades the code for tokens, checks Google granted what the work needs, reads the
   * account, and stores the sealed grant. Always ends in a redirect back to the page the admin came from with `?email=<outcome>`; nothing
   * about Google's answer is shown on this address.
   */
  async callback(query: MailCallbackQuery): Promise<string> {
    const checked = verifyState(query.state ?? '', this.stateKey, Date.now());
    if (!checked.ok) {
      // No trustworthy state: nobody to bind this to, nothing is stored.
      this.logger.warn({ reason: checked.reason }, 'Google mail callback with a bad state');
      return returnUrl(this.webUrl, DEFAULT_RETURN, 'failed');
    }
    const { state } = checked;
    const done = (outcome: MailConnectOutcome) => returnUrl(this.webUrl, state.returnTo, outcome);

    if (query.error) return done('denied');
    if (!query.code) return done('failed');
    const creds = await this.config.credentials();
    if (!creds) return done('not_configured');

    let accessToken: string | null = null;
    let refreshToken: string | null = null;
    let stored: MailboxRow | null = null;

    try {
      // The workspace may have lost the add-on while the person was on Google's screen.
      if (!(await this.plan.isEnabled(state.orgId))) throw new Outcome('failed');

      const grant = await this.oauth.exchangeCode(creds, query.code);
      accessToken = grant.accessToken;
      refreshToken = grant.refreshToken;
      const granted = new Set(grant.scope.split(/\s+/).filter(Boolean));
      if (GOOGLE_MAIL_REQUIRED_SCOPES.some((s) => !granted.has(s)))
        throw new Outcome('missing_scope');
      const account = await this.oauth.userinfo(grant.accessToken);
      if (!account.email) throw new Outcome('failed');
      const address = account.email;

      const result = await RequestContextStore.run(
        {
          requestId: `mail-connect-${state.nonce}`,
          orgId: state.orgId,
          actorType: 'user',
          actorId: state.userId,
          userId: state.userId,
        },
        () =>
          this.db.txAs({ orgId: state.orgId, userId: state.userId }, async (tx) => {
            const target = state.mailboxId
              ? await this.repo.byUuid(tx, state.orgId, state.mailboxId, true)
              : undefined;
            if (state.mailboxId && !target) throw new Outcome('failed');
            // The person must sign in to the account the mailbox IS (by address, and by Google's id once known).
            if (target) {
              const sameAddress = target.address.toLowerCase() === address;
              const sameAccount =
                target.accountSub === null ||
                account.sub === null ||
                target.accountSub === account.sub;
              if (!sameAddress || !sameAccount) throw new Outcome('wrong_account');
            }
            const existing = target ?? (await this.repo.byAddress(tx, state.orgId, address, true));
            if (
              existing &&
              existing.accountSub &&
              account.sub &&
              existing.accountSub !== account.sub
            ) {
              throw new Outcome('wrong_account');
            }
            const sealedRefresh = grant.refreshToken
              ? this.crypto.encrypt(grant.refreshToken)
              : existing && existing.status !== 'disconnected' && existing.refreshTokenEnc
                ? existing.refreshTokenEnc
                : null;
            if (!sealedRefresh) throw new Outcome('failed');

            // A mailbox that counts against the plan already (connected, needs reauth, error) is not a new one.
            if (!existing || existing.status === 'disconnected') {
              const [limit, active] = await Promise.all([
                this.plan.mailboxLimit(state.orgId),
                this.repo.countActive(tx, state.orgId),
              ]);
              if (limit > 0 && active >= limit) throw new Outcome('limit');
            }
            const input = {
              address,
              accountSub: account.sub,
              displayName: existing?.displayName ?? account.name ?? address,
              refreshTokenEnc: sealedRefresh,
              accessTokenEnc: this.crypto.encrypt(grant.accessToken),
              accessTokenExpiresAt: new Date(Date.now() + grant.expiresInSeconds * 1000),
              scopes: [...granted].join(' '),
              connectedBy: state.userId,
            };
            const row = existing
              ? await this.repo.reconnect(tx, state.orgId, existing.id, input)
              : await this.repo.insert(tx, state.orgId, input);
            await this.audit.record(tx, {
              module: MAIL_AUDIT_MODULE,
              recordId: row.id,
              action: existing ? 'update' : 'insert',
              delta: { status: { old: existing?.status ?? 'disconnected', new: 'connected' } },
            });
            await this.outbox.emit(tx, {
              orgId: state.orgId,
              aggregateModule: MAIL_AUDIT_MODULE,
              aggregateId: row.id,
              eventType: existing ? 'mail.mailbox.reconnected' : 'mail.mailbox.connected',
              payload: { uuid: row.uuid, provider: 'google', address: row.address },
            });
            return { row };
          }),
      );
      stored = result.row;
    } catch (err) {
      if (err instanceof Outcome) {
        // What was just granted is withdrawn rather than left dangling. A reconnect that failed keeps the old grant: only the NEW token goes.
        await this.oauth.revoke(refreshToken ?? accessToken ?? '').catch(() => undefined);
        return done(err.outcome);
      }
      this.logger.warn(
        { orgId: state.orgId, err: (err as Error).message },
        'Google mail connect failed',
      );
      return done('failed');
    }

    // The inbox channel and the first sync. Best effort: the mailbox is saved, and the sweep repairs either.
    await RequestContextStore.run(
      {
        requestId: `mail-connect-${state.nonce}`,
        orgId: state.orgId,
        actorType: 'user',
        actorId: state.userId,
        userId: state.userId,
      },
      () => this.channel.sync(state.orgId, stored!),
    );
    await this.sync.enqueue(state.orgId, stored.uuid);
    return done('connected');
  }
}
