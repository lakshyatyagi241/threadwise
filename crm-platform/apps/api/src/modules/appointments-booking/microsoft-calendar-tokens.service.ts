import { Injectable, Logger } from '@nestjs/common';
import { MICROSOFT_CALENDAR_REQUIRED_SCOPE } from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import {
  MicrosoftCalendarClient,
  MicrosoftCalendarError,
  microsoftHealthCode,
} from '../../infra/providers/appointments-booking';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { MicrosoftCalendarConfig } from './microsoft-calendar-config.service';
import {
  MicrosoftCalendarConnectionRepository,
  type MicrosoftConnectionRow,
} from './microsoft-calendar-connection.repository';

/** Audit module and outbox aggregate of the Microsoft connection (its row ids are not the Google connection's, so they get their own module). */
export const MICROSOFT_CALENDAR_AUDIT_MODULE = 'appointment_calendar_microsoft';

/** How long a process keeps a workspace's connection row before reading it again (a connect or disconnect in this process drops it at once). */
const CONNECTION_TTL_MS = 15_000;
/** A token that expires within this window is refreshed before it is used. */
const EXPIRY_MARGIN_MS = 60_000;
/** A used-just-now stamp is written at most this often per workspace per process (the SQL guards across processes too). */
const USED_EVERY_MS = 60_000;

/** Why there is no usable Microsoft connection. `needs_reconnect` and `scope_missing` are the ones an admin can fix. */
export class MicrosoftNotConnectedError extends Error {
  constructor(readonly reason: 'none' | 'needs_reconnect' | 'not_configured' | 'scope_missing') {
    super(`Microsoft Calendar is not usable for this workspace (${reason})`);
    this.name = 'MicrosoftNotConnectedError';
  }
}

/** Whether the stored grant lets us read and write calendars (a person can untick a permission on the consent screen). */
export const microsoftGrantCovers = (conn: Pick<MicrosoftConnectionRow, 'scopes'>): boolean =>
  (conn.scopes ?? '')
    .split(/\s+/)
    .some((s) => s.toLowerCase() === MICROSOFT_CALENDAR_REQUIRED_SCOPE.toLowerCase());

/**
 * Access tokens for a workspace's Outlook / Microsoft 365 calendar (BL-035). The refresh token is stored sealed; an access token (about an
 * hour) is refreshed when it is within a minute of expiring, and the sealed copies are replaced, so the API and the worker do not each
 * refresh on every call. Microsoft ROTATES refresh tokens: the one in an answer replaces the one that was used (refreshes are coalesced
 * within one process, and a refresh that loses the race to another process writes nothing, see the repository).
 *
 * `invalid_grant` is the one answer that means the grant itself is dead: the connection is marked `needs_reconnect` (an audit row, an outbox
 * event, and the settings card says so) and every later call stops at once instead of failing at Microsoft each time.
 */
@Injectable()
export class MicrosoftCalendarTokens {
  private readonly logger = new Logger(MicrosoftCalendarTokens.name);
  private readonly rows = new Map<number, { at: number; row: MicrosoftConnectionRow | null }>();
  private readonly refreshing = new Map<number, Promise<string>>();
  private readonly health = new Map<number, { code: string | null; usedAt: number }>();

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MicrosoftCalendarConnectionRepository,
    private readonly crypto: CryptoService,
    private readonly config: MicrosoftCalendarConfig,
    private readonly client: MicrosoftCalendarClient,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** The workspace's connection row (cached briefly), or null. `fresh` reads the database. */
  async connection(
    orgId: number,
    opts: { fresh?: boolean } = {},
  ): Promise<MicrosoftConnectionRow | null> {
    const hit = this.rows.get(orgId);
    if (!opts.fresh && hit && Date.now() - hit.at < CONNECTION_TTL_MS) return hit.row;
    const row =
      (await this.db.txAs({ orgId, userId: null }, (tx) => this.repo.find(tx, orgId))) ?? null;
    this.rows.set(orgId, { at: Date.now(), row });
    return row;
  }

  invalidate(orgId: number): void {
    this.rows.delete(orgId);
  }

  /**
   * Runs `fn` with a valid access token. A token Graph refuses (401: revoked early) is refreshed once and the call repeated; a second
   * refusal is the caller's error. The outcome is remembered on the connection for the settings card: an account-level failure as the last
   * error, and the next success clears it.
   */
  async withToken<T>(
    orgId: number,
    fn: (accessToken: string, conn: MicrosoftConnectionRow) => Promise<T>,
  ): Promise<T> {
    try {
      const first = await this.accessToken(orgId, false);
      let out: T;
      try {
        out = await fn(first.token, first.conn);
      } catch (err) {
        if (!(err instanceof MicrosoftCalendarError) || err.kind !== 'auth') throw err;
        const second = await this.accessToken(orgId, true);
        out = await fn(second.token, second.conn);
      }
      this.remember(orgId, null);
      return out;
    } catch (err) {
      if (err instanceof MicrosoftCalendarError) {
        const code = microsoftHealthCode(err);
        if (code) this.remember(orgId, code);
      }
      throw err;
    }
  }

  /** Fire and forget: health bookkeeping must never fail or slow the call it describes. */
  private remember(orgId: number, code: string | null): void {
    const cached = this.rows.get(orgId)?.row;
    if (!cached) return;
    const known = this.health.get(orgId) ?? { code: cached.lastErrorCode, usedAt: 0 };
    const now = Date.now();
    const writeError = code !== null && known.code !== code;
    const clearError = code === null && known.code !== null;
    const stamp = code === null && now - known.usedAt > USED_EVERY_MS;
    if (!writeError && !clearError && !stamp) return;
    void this.db
      .txAs({ orgId, userId: null }, async (tx) => {
        if (writeError || clearError) await this.repo.setLastError(tx, orgId, cached.id, code);
        if (stamp) await this.repo.touchUsed(tx, orgId, cached.id);
      })
      .then(() =>
        this.health.set(orgId, {
          code: writeError ? code : clearError ? null : known.code,
          usedAt: stamp ? now : known.usedAt,
        }),
      )
      .catch((err: unknown) =>
        this.logger.debug({ err, orgId }, 'could not record Microsoft calendar health'),
      );
  }

  private async accessToken(
    orgId: number,
    force: boolean,
  ): Promise<{ token: string; conn: MicrosoftConnectionRow }> {
    // The operator's switch (and the app itself) come first: with Microsoft off for the platform nothing may be read or written, whatever a
    // workspace still has stored, and "connect Microsoft" would be no help.
    if (!(await this.config.credentials())) throw new MicrosoftNotConnectedError('not_configured');
    const conn = await this.connection(orgId, { fresh: force });
    if (!conn) throw new MicrosoftNotConnectedError('none');
    if (conn.status !== 'active') throw new MicrosoftNotConnectedError('needs_reconnect');
    if (!microsoftGrantCovers(conn)) throw new MicrosoftNotConnectedError('scope_missing');
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
    let pending = this.refreshing.get(orgId);
    if (!pending) {
      pending = this.refresh(orgId, conn).finally(() => this.refreshing.delete(orgId));
      this.refreshing.set(orgId, pending);
    }
    return { token: await pending, conn };
  }

  private async refresh(orgId: number, conn: MicrosoftConnectionRow): Promise<string> {
    const creds = await this.config.credentials();
    if (!creds) throw new MicrosoftNotConnectedError('not_configured');
    let tokens;
    try {
      tokens = await this.client.refresh(creds, this.crypto.decrypt(conn.refreshTokenEnc));
    } catch (err) {
      if (err instanceof MicrosoftCalendarError && err.kind === 'invalid_grant') {
        await this.markNeedsReconnect(orgId, conn, err.reason);
        throw new MicrosoftNotConnectedError('needs_reconnect');
      }
      throw err;
    }
    const expiresAt = new Date(Date.now() + tokens.expiresInSeconds * 1000);
    const sealedAccess = this.crypto.encrypt(tokens.accessToken);
    const sealedRefresh = tokens.refreshToken ? this.crypto.encrypt(tokens.refreshToken) : null;
    const stored = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.saveTokens(
        tx,
        orgId,
        conn.id,
        { accessTokenEnc: sealedAccess, expiresAt, refreshTokenEnc: sealedRefresh },
        conn.refreshTokenEnc,
      ),
    );
    // Only the writer's copy is cached: when another process won the race, the next read of the row finds its tokens.
    if (stored) {
      this.rows.set(orgId, {
        at: Date.now(),
        row: {
          ...conn,
          accessTokenEnc: sealedAccess,
          accessTokenExpiresAt: expiresAt,
          refreshTokenEnc: sealedRefresh ?? conn.refreshTokenEnc,
        },
      });
    } else {
      this.invalidate(orgId);
    }
    return tokens.accessToken;
  }

  /** Microsoft no longer honours the grant. Written once (the first caller to see it), however many callers do. */
  private async markNeedsReconnect(
    orgId: number,
    conn: MicrosoftConnectionRow,
    reason: string,
  ): Promise<void> {
    this.invalidate(orgId);
    await RequestContextStore.run(
      {
        requestId: `calendar-reconnect-${conn.uuid}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () =>
        this.db.txAs({ orgId, userId: null }, async (tx) => {
          if (!(await this.repo.markNeedsReconnect(tx, orgId, conn.id, reason))) return;
          await this.audit.record(tx, {
            module: MICROSOFT_CALENDAR_AUDIT_MODULE,
            recordId: conn.id,
            action: 'update',
            delta: { status: { old: 'active', new: 'needs_reconnect' } },
          });
          await this.outbox.emit(tx, {
            orgId,
            aggregateModule: MICROSOFT_CALENDAR_AUDIT_MODULE,
            aggregateId: conn.id,
            eventType: 'appointment_calendar.needs_reconnect',
            payload: { uuid: conn.uuid, provider: 'microsoft', reason: reason.slice(0, 100) },
          });
        }),
    );
    this.logger.warn(
      { orgId, reason },
      'Microsoft refused the stored grant: the calendar needs reconnecting',
    );
  }
}
