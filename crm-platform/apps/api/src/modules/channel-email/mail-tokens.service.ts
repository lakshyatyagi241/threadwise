import { Injectable, Logger } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { GoogleMailError, GoogleMailOAuthClient } from '../../infra/providers/channel-email';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { MailChannelSync } from './mail-channel.sync';
import { GoogleMailConfig } from './mail-config.service';
import { MailboxUnavailableError } from './mail-errors';
import { MailboxesRepository, type MailboxRow } from './mailboxes.repository';

export const MAIL_AUDIT_MODULE = 'mail_mailboxes';

/** A token that expires within this window is refreshed before it is used. */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * Access tokens for a connected mailbox (TW-MAIL-020, 028). The refresh token is stored sealed; an access token (one hour) is refreshed
 * when it is within a minute of expiring and the sealed copy is kept, so the API and the worker do not each refresh on every call. Google
 * does not rotate refresh tokens, so two processes refreshing at once are both right; refreshes are only coalesced within one process.
 *
 * `invalid_grant` is the one answer that means the grant itself is dead: the mailbox is marked `needs_reauth` (an audit row, an outbox
 * event, its channel switched to read-only, and the hub says "Reconnect"), and every later call stops at once instead of failing at Google
 * each time. The mailbox row is always read fresh: sync runs once a minute and a send is a person's action, so a cache buys nothing.
 */
@Injectable()
export class MailTokens {
  private readonly logger = new Logger(MailTokens.name);
  private readonly refreshing = new Map<string, Promise<string>>();

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MailboxesRepository,
    private readonly crypto: CryptoService,
    private readonly config: GoogleMailConfig,
    private readonly oauth: GoogleMailOAuthClient,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly channel: MailChannelSync,
  ) {}

  /** The mailbox row, or null. */
  load(orgId: number, uuid: string): Promise<MailboxRow | null> {
    return this.db
      .txAs({ orgId, userId: null }, (tx) => this.repo.byUuid(tx, orgId, uuid))
      .then((r) => r ?? null);
  }

  /**
   * Runs `fn` with a valid access token for the mailbox. A token Google refuses (401: revoked early) is refreshed once and the call
   * repeated; a second refusal is the caller's error. Throws `MailboxUnavailableError` when the mailbox cannot be used at all.
   */
  async withToken<T>(
    orgId: number,
    uuid: string,
    fn: (accessToken: string, mailbox: MailboxRow) => Promise<T>,
  ): Promise<T> {
    const first = await this.accessToken(orgId, uuid, false);
    try {
      return await fn(first.token, first.mailbox);
    } catch (err) {
      if (!(err instanceof GoogleMailError) || err.kind !== 'auth') throw err;
      const second = await this.accessToken(orgId, uuid, true);
      return fn(second.token, second.mailbox);
    }
  }

  private async accessToken(
    orgId: number,
    uuid: string,
    force: boolean,
  ): Promise<{ token: string; mailbox: MailboxRow }> {
    const mailbox = await this.load(orgId, uuid);
    if (!mailbox) throw new MailboxUnavailableError('none');
    if (mailbox.status === 'disconnected' || !mailbox.refreshTokenEnc) {
      throw new MailboxUnavailableError('disconnected');
    }
    if (mailbox.status === 'needs_reauth') throw new MailboxUnavailableError('needs_reauth');
    if (
      !force &&
      mailbox.accessTokenEnc &&
      mailbox.accessTokenExpiresAt &&
      mailbox.accessTokenExpiresAt.getTime() - Date.now() > EXPIRY_MARGIN_MS
    ) {
      try {
        return { token: this.crypto.decrypt(mailbox.accessTokenEnc), mailbox };
      } catch {
        // Sealed with a key that is gone: fall through and refresh.
      }
    }
    const key = `${orgId}:${uuid}`;
    let pending = this.refreshing.get(key);
    if (!pending) {
      pending = this.refresh(orgId, mailbox).finally(() => this.refreshing.delete(key));
      this.refreshing.set(key, pending);
    }
    return { token: await pending, mailbox };
  }

  private async refresh(orgId: number, mailbox: MailboxRow): Promise<string> {
    const creds = await this.config.credentials();
    if (!creds) throw new MailboxUnavailableError('not_configured');
    let tokens;
    try {
      tokens = await this.oauth.refresh(creds, this.crypto.decrypt(mailbox.refreshTokenEnc!));
    } catch (err) {
      if (err instanceof GoogleMailError && err.kind === 'invalid_grant') {
        await this.markNeedsReauth(orgId, mailbox, err.reason);
        throw new MailboxUnavailableError('needs_reauth');
      }
      throw err;
    }
    const expiresAt = new Date(Date.now() + tokens.expiresInSeconds * 1000);
    const sealed = this.crypto.encrypt(tokens.accessToken);
    await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.saveAccessToken(tx, orgId, mailbox.id, sealed, expiresAt),
    );
    return tokens.accessToken;
  }

  /** Google no longer honours the grant. Written once (the first caller to see it), however many callers do. */
  async markNeedsReauth(orgId: number, mailbox: MailboxRow, reason: string): Promise<void> {
    const changed = await RequestContextStore.run(
      {
        requestId: `mail-reauth-${mailbox.uuid}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () =>
        this.db.txAs({ orgId, userId: null }, async (tx) => {
          const message = `Google no longer allows access to this mailbox (${reason || 'revoked'}). Reconnect it.`;
          if (!(await this.repo.markNeedsReauth(tx, orgId, mailbox.id, message))) return false;
          await this.audit.record(tx, {
            module: MAIL_AUDIT_MODULE,
            recordId: mailbox.id,
            action: 'update',
            delta: { status: { old: mailbox.status, new: 'needs_reauth' } },
          });
          await this.outbox.emit(tx, {
            orgId,
            aggregateModule: MAIL_AUDIT_MODULE,
            aggregateId: mailbox.id,
            eventType: 'mail.mailbox.needs_reauth',
            payload: { uuid: mailbox.uuid, provider: 'google', reason: reason.slice(0, 100) },
          });
          return true;
        }),
    );
    if (!changed) return;
    this.logger.warn(
      { orgId, mailbox: mailbox.uuid, reason },
      'Google refused the stored grant: the mailbox needs reconnecting',
    );
    const fresh = await this.load(orgId, mailbox.uuid);
    if (fresh)
      await RequestContextStore.run(
        {
          requestId: `mail-reauth-${mailbox.uuid}`,
          orgId,
          actorType: 'system',
          actorId: null,
          userId: null,
        },
        () => this.channel.sync(orgId, fresh),
      );
  }
}
