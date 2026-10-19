import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConnectedVideoProvider } from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import {
  ConferencingError,
  teamsGrantCovers,
  VIDEO_PROVIDER_ADAPTERS,
  type VideoProviderAdapter,
  type VideoProviderAdapters,
} from '../../infra/providers/meeting-conferencing';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import {
  ConferencingConnectionRepository,
  type ConferencingConnectionRow,
} from './conferencing-connection.repository';

/** Audit module and outbox aggregate of a person's video connection. */
export const CONFERENCING_AUDIT_MODULE = 'conferencing_connection';

/** A token that expires within this window is refreshed before it is used. */
const EXPIRY_MARGIN_MS = 60_000;

/** Why there is no usable connection. `needs_reconnect` and `scope_missing` are the ones the person can fix. */
export class VideoNotConnectedError extends Error {
  constructor(readonly reason: 'none' | 'needs_reconnect' | 'not_configured' | 'scope_missing') {
    super(`The video connection is not usable (${reason})`);
    this.name = 'VideoNotConnectedError';
  }
}

/** The account-level failure code worth showing a person on their connection card; a one-off miss (a missing meeting) is not one. */
export function healthCodeOf(err: ConferencingError): string | null {
  switch (err.kind) {
    case 'forbidden':
      return 'forbidden';
    case 'rate_limit':
      return 'rate_limited';
    case 'server':
    case 'network':
    case 'timeout':
      return 'unavailable';
    default:
      return null;
  }
}

/**
 * Access tokens for a person's own Zoom / Teams account (BL-360). The refresh token is stored sealed; an access token (about an hour) is
 * refreshed when it is within a minute of expiring, and the sealed copies are replaced. Zoom and Microsoft ROTATE refresh tokens: the one
 * in an answer replaces the one that was used (refreshes are coalesced within one process, and a refresh that loses the race to another
 * process writes nothing, see the repository).
 *
 * `invalid_grant` is the one answer that means the grant itself is dead: the connection is marked `needs_reconnect` (an audit row, an
 * outbox event, and the person's card says so) and every later call stops at once instead of failing at the provider each time.
 */
@Injectable()
export class ConferencingTokens {
  private readonly logger = new Logger(ConferencingTokens.name);
  private readonly refreshing = new Map<string, Promise<string>>();
  private readonly health = new Map<number, string | null>();

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ConferencingConnectionRepository,
    private readonly crypto: CryptoService,
    @Inject(VIDEO_PROVIDER_ADAPTERS) private readonly adapters: VideoProviderAdapters,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  adapter(provider: ConnectedVideoProvider): VideoProviderAdapter {
    return this.adapters[provider];
  }

  async connection(
    orgId: number,
    userId: number,
    provider: ConnectedVideoProvider,
  ): Promise<ConferencingConnectionRow | null> {
    return (
      (await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.repo.find(tx, orgId, userId, provider),
      )) ?? null
    );
  }

  /** Runs `fn` with a valid access token. A token the provider refuses (401: revoked early) is refreshed once and the call repeated. */
  async withToken<T>(
    orgId: number,
    userId: number,
    provider: ConnectedVideoProvider,
    fn: (accessToken: string, adapter: VideoProviderAdapter) => Promise<T>,
  ): Promise<T> {
    const adapter = this.adapters[provider];
    let conn: ConferencingConnectionRow | null = null;
    try {
      const first = await this.accessToken(orgId, userId, provider, false);
      conn = first.conn;
      let out: T;
      try {
        out = await fn(first.token, adapter);
      } catch (err) {
        if (!(err instanceof ConferencingError) || err.kind !== 'auth') throw err;
        const second = await this.accessToken(orgId, userId, provider, true);
        out = await fn(second.token, adapter);
      }
      this.remember(orgId, conn, null);
      return out;
    } catch (err) {
      if (err instanceof ConferencingError && conn) {
        const code = healthCodeOf(err);
        if (code) this.remember(orgId, conn, code);
      }
      throw err;
    }
  }

  /** Fire and forget: health bookkeeping must never fail or slow the call it describes. */
  private remember(orgId: number, conn: ConferencingConnectionRow, code: string | null): void {
    const known = this.health.has(conn.id) ? this.health.get(conn.id)! : conn.lastErrorCode;
    if (known === code && code !== null) return;
    if (code === null && known === null) {
      // Cheap path: the stamp "used just now" is the only write, and the SQL guards it to once a minute.
      void this.db
        .txAs({ orgId, userId: null }, (tx) => this.repo.touchUsed(tx, orgId, conn.id))
        .catch((err: unknown) => this.logger.debug({ err, orgId }, 'could not stamp the connection'));
      return;
    }
    this.health.set(conn.id, code);
    void this.db
      .txAs({ orgId, userId: null }, async (tx) => {
        await this.repo.setLastError(tx, orgId, conn.id, code);
        if (code === null) await this.repo.touchUsed(tx, orgId, conn.id);
      })
      .catch((err: unknown) =>
        this.logger.debug({ err, orgId }, 'could not record the video connection health'),
      );
  }

  private async accessToken(
    orgId: number,
    userId: number,
    provider: ConnectedVideoProvider,
    force: boolean,
  ): Promise<{ token: string; conn: ConferencingConnectionRow }> {
    const adapter = this.adapters[provider];
    // The platform's app first: with it switched off nothing may be made, whatever a person still has stored.
    if (!(await adapter.configured())) throw new VideoNotConnectedError('not_configured');
    const conn = await this.connection(orgId, userId, provider);
    if (!conn) throw new VideoNotConnectedError('none');
    if (conn.status !== 'active') throw new VideoNotConnectedError('needs_reconnect');
    if (provider === 'teams' && !teamsGrantCovers(conn.scopes)) {
      throw new VideoNotConnectedError('scope_missing');
    }
    if (
      !force &&
      conn.accessTokenEnc &&
      conn.accessTokenExpiresAt &&
      conn.accessTokenExpiresAt.getTime() - Date.now() > EXPIRY_MARGIN_MS
    ) {
      try {
        return { token: this.crypto.decrypt(conn.accessTokenEnc), conn };
      } catch {
        // Sealed with a key that is gone: fall through and refresh.
      }
    }
    const key = `${orgId}:${conn.id}`;
    let pending = this.refreshing.get(key);
    if (!pending) {
      pending = this.refresh(orgId, adapter, conn).finally(() => this.refreshing.delete(key));
      this.refreshing.set(key, pending);
    }
    return { token: await pending, conn };
  }

  private async refresh(
    orgId: number,
    adapter: VideoProviderAdapter,
    conn: ConferencingConnectionRow,
  ): Promise<string> {
    let tokens;
    try {
      tokens = await adapter.refresh(this.crypto.decrypt(conn.refreshTokenEnc));
    } catch (err) {
      if (err instanceof ConferencingError && err.kind === 'invalid_grant') {
        await this.markNeedsReconnect(orgId, conn, err.reason);
        throw new VideoNotConnectedError('needs_reconnect');
      }
      // The platform's own client is wrong or expired: nothing the person can fix, and their grant is untouched.
      if (err instanceof ConferencingError && err.kind === 'invalid_client') {
        throw new VideoNotConnectedError('not_configured');
      }
      throw err;
    }
    const expiresAt = new Date(Date.now() + tokens.expiresInSeconds * 1000);
    const sealedAccess = this.crypto.encrypt(tokens.accessToken);
    const sealedRefresh = tokens.refreshToken ? this.crypto.encrypt(tokens.refreshToken) : null;
    await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.saveTokens(
        tx,
        orgId,
        conn.id,
        { accessTokenEnc: sealedAccess, expiresAt, refreshTokenEnc: sealedRefresh },
        conn.refreshTokenEnc,
      ),
    );
    return tokens.accessToken;
  }

  /** The provider no longer honours the grant. Written once (the first caller to see it), however many callers do. */
  private async markNeedsReconnect(
    orgId: number,
    conn: ConferencingConnectionRow,
    reason: string,
  ): Promise<void> {
    await RequestContextStore.run(
      {
        requestId: `conferencing-reconnect-${conn.uuid}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () =>
        this.db.txAs({ orgId, userId: null }, async (tx) => {
          if (!(await this.repo.markNeedsReconnect(tx, orgId, conn.id, reason))) return;
          await this.audit.record(tx, {
            module: CONFERENCING_AUDIT_MODULE,
            recordId: conn.id,
            action: 'update',
            delta: { status: { old: 'active', new: 'needs_reconnect' } },
          });
          await this.outbox.emit(tx, {
            orgId,
            aggregateModule: CONFERENCING_AUDIT_MODULE,
            aggregateId: conn.id,
            eventType: 'conferencing.needs_reconnect',
            payload: { uuid: conn.uuid, provider: conn.provider, reason: reason.slice(0, 100) },
          });
        }),
    );
    this.logger.warn(
      { orgId, provider: conn.provider, reason },
      'a video provider refused a stored grant: the person needs to reconnect',
    );
  }
}
