import { Injectable, Logger } from '@nestjs/common';
import { googleCapabilitiesOf, type GoogleCapability } from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import {
  ACCOUNT_HEALTH_CODES,
  GoogleCalendarClient,
  GoogleCalendarError,
  googleFailureCode,
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

/** A used-just-now stamp is written at most this often per workspace per process (the SQL guards across processes too). */
const USED_EVERY_MS = 60_000;

/**
 * Why there is no usable connection. `needs_reconnect` and `scope_missing` are the ones an admin can fix, from the Google account page
 * (`scope_missing`: the account is connected but was not given `capability`; add it).
 */
export class CalendarNotConnectedError extends Error {
  constructor(
    readonly reason: 'none' | 'needs_reconnect' | 'not_configured' | 'scope_missing',
    readonly capability: GoogleCapability | null = null,
  ) {
    super(
      `Google is not usable for this workspace (${reason}${capability ? `: ${capability}` : ''})`,
    );
    this.name = 'CalendarNotConnectedError';
  }
}

/** Whether the stored grant covers a capability. */
export const grantCovers = (conn: Pick<CalendarConnectionRow, 'scopes'>, cap: GoogleCapability) =>
  googleCapabilitiesOf(conn.scopes).includes(cap);

/**
 * Access tokens for a workspace's Google Calendar (TW-APPT-028). The refresh token is stored sealed; an access token (one hour) is
 * refreshed when it is within a minute of expiring and the sealed copy is kept, so the API and the worker do not each refresh on
 * every call. Google does not rotate refresh tokens, so two processes refreshing at once are both right and neither invalidates the
 * other (Reference needed a cache lock against a rotation that never happens; refreshes are only coalesced within one process).
 *
 * `invalid_grant` is the one answer that means the grant itself is dead: the connection is marked `needs_reconnect` (an audit row, an
 * outbox event, and the settings card says so) and every later call stops at once instead of failing at Google each time.
 */
@Injectable()
export class GoogleCalendarTokens {
  private readonly logger = new Logger(GoogleCalendarTokens.name);
  private readonly rows = new Map<number, { at: number; row: CalendarConnectionRow | null }>();
  private readonly refreshing = new Map<number, Promise<string>>();
  /**
   * What this process last WROTE about the account's health (never what it intends to write), so a busy workspace does not write on every
   * call and a failed write is tried again by the next call.
   */
  private readonly health = new Map<
    number,
    { code: string | null; capability: string | null; usedAt: number }
  >();

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
   * refusal is the caller's error. `capability` is what the call needs from the grant: without it the call stops here with
   * `scope_missing` (the page can say "add Sheets") instead of Google answering 403 after a round trip.
   *
   * The outcome is remembered on the connection for the Google account page: an account-level failure (rate limit, outage, a missing
   * scope, a refused grant) as the last error, and the next success clears it.
   */
  async withToken<T>(
    orgId: number,
    fn: (accessToken: string, conn: CalendarConnectionRow) => Promise<T>,
    opts: { capability?: GoogleCapability } = {},
  ): Promise<T> {
    const capability = opts.capability ?? null;
    try {
      const out = await this.callWithToken(orgId, fn, opts.capability);
      this.remember(orgId, null, capability);
      return out;
    } catch (err) {
      const code = this.healthCodeOf(err);
      if (code !== undefined) this.remember(orgId, code, capability);
      throw err;
    }
  }

  private async callWithToken<T>(
    orgId: number,
    fn: (accessToken: string, conn: CalendarConnectionRow) => Promise<T>,
    capability: GoogleCapability | undefined,
  ): Promise<T> {
    const first = await this.accessToken(orgId, false, capability);
    try {
      return await fn(first.token, first.conn);
    } catch (err) {
      if (!(err instanceof GoogleCalendarError) || err.kind !== 'auth') throw err;
      const second = await this.accessToken(orgId, true, capability);
      return fn(second.token, second.conn);
    }
  }

  /**
   * The `GOOGLE_*` code an account-level failure is recorded under, or undefined for one that says nothing about the account. A missing
   * permission is not recorded: the page already shows which permissions are allowed, and one step lacking one is not the account's health.
   */
  /** Records a problem with the connection that no single call raised (for example "the chosen calendar no longer exists"); cleared by the next success. */
  noteProblem(orgId: number, code: string, capability: GoogleCapability): void {
    this.remember(orgId, code, capability);
  }

  private healthCodeOf(err: unknown): string | undefined {
    if (!(err instanceof GoogleCalendarError)) return undefined;
    const code = googleFailureCode(err);
    return ACCOUNT_HEALTH_CODES.has(code) ? code : undefined;
  }

  /**
   * Fire and forget: health bookkeeping must never fail or slow the call it describes. An error is written when it is new (another code,
   * or the same code for another capability); a success clears it only when it is a success of the capability that failed; "used just now"
   * is stamped at most once a minute. The in-memory copy follows the database only after a write commits.
   */
  private remember(orgId: number, code: string | null, capability: string | null): void {
    const cached = this.rows.get(orgId)?.row;
    if (!cached) return;
    const known = this.health.get(orgId) ?? {
      code: cached.lastErrorCode,
      capability: cached.lastErrorCapability,
      usedAt: 0,
    };
    const now = Date.now();
    const writeError =
      code !== null && (known.code !== code || (known.capability ?? null) !== capability);
    const clearError =
      code === null &&
      known.code !== null &&
      (known.capability === null || known.capability === capability);
    const stamp = code === null && now - known.usedAt > USED_EVERY_MS;
    if (!writeError && !clearError && !stamp) return;
    void this.db
      .txAs({ orgId, userId: null }, async (tx) => {
        if (writeError || clearError)
          await this.repo.setLastError(tx, orgId, cached.id, code, capability);
        if (stamp) await this.repo.touchUsed(tx, orgId, cached.id);
      })
      .then(() =>
        this.health.set(orgId, {
          code: writeError ? code : clearError ? null : known.code,
          capability: writeError ? capability : clearError ? null : known.capability,
          usedAt: stamp ? now : known.usedAt,
        }),
      )
      .catch((err: unknown) =>
        this.logger.debug({ err, orgId }, 'could not record Google account health'),
      );
  }

  private async accessToken(
    orgId: number,
    force: boolean,
    capability?: GoogleCapability,
  ): Promise<{ token: string; conn: CalendarConnectionRow }> {
    // The operator's switch (and the client itself) come first: with Google off for the platform nothing may be read or written, whatever
    // a workspace still has stored, and "connect Google" would be no help.
    if (!(await this.config.credentials())) throw new CalendarNotConnectedError('not_configured');
    const conn = await this.connection(orgId, { fresh: force });
    if (!conn) throw new CalendarNotConnectedError('none');
    if (conn.status !== 'active') throw new CalendarNotConnectedError('needs_reconnect');
    if (capability && !grantCovers(conn, capability)) {
      throw new CalendarNotConnectedError('scope_missing', capability);
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
      this.repo.saveAccessToken(tx, orgId, conn.id, sealed, expiresAt, conn.refreshTokenEnc),
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
