import { Injectable, Logger } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import {
  GoogleCalendarClient,
  GoogleCalendarError,
} from '../../infra/providers/appointments-booking';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { GoogleCalendarConfig } from './google-calendar-config.service';
import {
  GoogleCalendarConnectionRepository,
  type CalendarConnectionRow,
} from './google-calendar-connection.repository';

export const CALENDAR_AUDIT_MODULE = 'appointment_calendar';

/** How long a process keeps a workspace's connection row before reading it again (a connect or disconnect in this process drops it at once). */
const CONNECTION_TTL_MS = 15_000;
/** A token that expires within this window is refreshed before it is used. */
const EXPIRY_MARGIN_MS = 60_000;

/** Why there is no usable connection. `needs_reconnect` is the one an admin can fix, from the settings card. */
export class CalendarNotConnectedError extends Error {
  constructor(readonly reason: 'none' | 'needs_reconnect' | 'not_configured') {
    super(`Google Calendar is not usable for this workspace (${reason})`);
    this.name = 'CalendarNotConnectedError';
  }
}

/**
 * Access tokens for a workspace's Google Calendar (WD-APPT-028). The refresh token is stored sealed; an access token (one hour) is
 * refreshed when it is within a minute of expiring and the sealed copy is kept, so the API and the worker do not each refresh on
 * every call. Google does not rotate refresh tokens, so two processes refreshing at once are both right and neither invalidates the
 * other (WaDesk needed a cache lock against a rotation that never happens; refreshes are only coalesced within one process).
 *
 * `invalid_grant` is the one answer that means the grant itself is dead: the connection is marked `needs_reconnect` (an audit row, an
 * outbox event, and the settings card says so) and every later call stops at once instead of failing at Google each time.
 */
@Injectable()
export class GoogleCalendarTokens {
  private readonly logger = new Logger(GoogleCalendarTokens.name);
  private readonly rows = new Map<number, { at: number; row: CalendarConnectionRow | null }>();
  private readonly refreshing = new Map<number, Promise<string>>();

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: GoogleCalendarConnectionRepository,
    private readonly crypto: CryptoService,
    private readonly config: GoogleCalendarConfig,
    private readonly client: GoogleCalendarClient,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** The workspace's connection row (cached briefly), or null. `fresh` reads the database. */
  async connection(
    orgId: number,
    opts: { fresh?: boolean } = {},
  ): Promise<CalendarConnectionRow | null> {
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
   * Runs `fn` with a valid access token. A token Google refuses (401: revoked early) is refreshed once and the call repeated; a second
   * refusal is the caller's error.
   */
  async withToken<T>(
    orgId: number,
    fn: (accessToken: string, conn: CalendarConnectionRow) => Promise<T>,
  ): Promise<T> {
    const first = await this.accessToken(orgId, false);
    try {
      return await fn(first.token, first.conn);
    } catch (err) {
      if (!(err instanceof GoogleCalendarError) || err.kind !== 'auth') throw err;
      const second = await this.accessToken(orgId, true);
      return fn(second.token, second.conn);
    }
  }

  private async accessToken(
    orgId: number,
    force: boolean,
  ): Promise<{ token: string; conn: CalendarConnectionRow }> {
    const conn = await this.connection(orgId, { fresh: force });
    if (!conn) throw new CalendarNotConnectedError('none');
    if (conn.status !== 'active') throw new CalendarNotConnectedError('needs_reconnect');
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

  private async refresh(orgId: number, conn: CalendarConnectionRow): Promise<string> {
    const creds = await this.config.credentials();
    if (!creds) throw new CalendarNotConnectedError('not_configured');
    let tokens;
    try {
      tokens = await this.client.refresh(creds, this.crypto.decrypt(conn.refreshTokenEnc));
    } catch (err) {
      if (err instanceof GoogleCalendarError && err.kind === 'invalid_grant') {
        await this.markNeedsReconnect(orgId, conn, err.reason);
        throw new CalendarNotConnectedError('needs_reconnect');
      }
      throw err;
    }
    const expiresAt = new Date(Date.now() + tokens.expiresInSeconds * 1000);
    const sealed = this.crypto.encrypt(tokens.accessToken);
    await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.saveAccessToken(tx, orgId, conn.id, sealed, expiresAt),
    );
    this.rows.set(orgId, {
      at: Date.now(),
      row: { ...conn, accessTokenEnc: sealed, accessTokenExpiresAt: expiresAt },
    });
    return tokens.accessToken;
  }

  /** Google no longer honours the grant. Written once (the first caller to see it), however many callers do. */
  private async markNeedsReconnect(
    orgId: number,
    conn: CalendarConnectionRow,
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
            module: CALENDAR_AUDIT_MODULE,
            recordId: conn.id,
            action: 'update',
            delta: { status: { old: 'active', new: 'needs_reconnect' } },
          });
          await this.outbox.emit(tx, {
            orgId,
            aggregateModule: CALENDAR_AUDIT_MODULE,
            aggregateId: conn.id,
            eventType: 'appointment_calendar.needs_reconnect',
            payload: { uuid: conn.uuid, provider: 'google', reason: reason.slice(0, 100) },
          });
        }),
    );
    this.logger.warn(
      { orgId, reason },
      'Google refused the stored grant: the calendar needs reconnecting',
    );
  }
}
