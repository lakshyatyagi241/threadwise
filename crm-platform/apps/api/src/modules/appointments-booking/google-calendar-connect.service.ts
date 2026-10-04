import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ERROR_CODES,
  type CalendarCallbackOutcome,
  type CalendarCallbackQuery,
  type CalendarConnectStartInput,
  type CalendarConnectStartResponse,
  type CalendarListResponse,
  type CalendarStatusResponse,
  type SelectCalendarInput,
} from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { GOOGLE_CALENDAR_REQUIRED_SCOPES } from '../../config/domains/appointments-booking.env';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import {
  GoogleCalendarClient,
  GoogleCalendarError,
} from '../../infra/providers/appointments-booking';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { GoogleCalendarAdapter } from './google-calendar.adapter';
import { GoogleCalendarConfig } from './google-calendar-config.service';
import { GoogleCalendarConnectionRepository } from './google-calendar-connection.repository';
import {
  deriveStateKey,
  newState,
  returnUrl,
  signState,
  STATE_TTL_SECONDS,
  verifyState,
} from './google-calendar-state';
import {
  CALENDAR_AUDIT_MODULE,
  CalendarNotConnectedError,
  GoogleCalendarTokens,
} from './google-calendar-tokens.service';

const DEFAULT_RETURN = '/appointments/settings';

/**
 * Connecting a workspace to Google Calendar (TW-APPT-028): the consent URL, the public callback that completes it, which calendar
 * bookings go to, and disconnecting. One Google account per workspace.
 *
 * What differs from Reference (listed in the inventory's port decisions and parity/product-extensions.md): the OAuth `state` is signed
 * and expires instead of living in a session; only calendar scopes are asked for (Reference bundled Sheets, Docs, Drive and Forms); a
 * grant Google later refuses is shown as "needs reconnect" instead of failing silently; disconnecting revokes at Google first and
 * carries on if Google cannot be reached, as Reference did.
 */
@Injectable()
export class GoogleCalendarConnectService {
  private readonly logger = new Logger(GoogleCalendarConnectService.name);
  private readonly stateKey: Buffer;
  private readonly webUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: GoogleCalendarConnectionRepository,
    private readonly tokens: GoogleCalendarTokens,
    private readonly config: GoogleCalendarConfig,
    private readonly client: GoogleCalendarClient,
    private readonly adapter: GoogleCalendarAdapter,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    env: ConfigService<Env, true>,
  ) {
    this.stateKey = deriveStateKey(env.get('CREDENTIALS_ENCRYPTION_KEY', { infer: true }));
    this.webUrl = env.get('WEB_APP_URL', { infer: true }).replace(/\/$/, '');
  }

  // --- staff -----------------------------------------------------------------------------------------------------------

  async status(): Promise<CalendarStatusResponse> {
    return this.statusOf(RequestContextStore.require().orgId);
  }

  async statusOf(orgId: number): Promise<CalendarStatusResponse> {
    const [conn, creds] = await Promise.all([
      this.tokens.connection(orgId, { fresh: true }),
      this.config.credentials(),
    ]);
    // Without a platform client nothing can be refreshed or written, whatever the stored grant says.
    const status = !creds
      ? 'unavailable'
      : !conn
        ? 'disconnected'
        : conn.status === 'active'
          ? 'connected'
          : 'needs_reconnect';
    return {
      provider: 'google',
      connected: status === 'connected',
      account: conn?.accountEmail ?? null,
      status,
      calendarId: conn?.calendarId ?? null,
      calendarName: conn
        ? (conn.calendarName ?? (conn.calendarId === 'primary' ? null : conn.calendarId))
        : null,
      connectedAt: conn?.connectedAt.toISOString() ?? null,
    };
  }

  /** The consent URL, bound to this workspace and admin. The browser is sent there by the web app. */
  async start(input: CalendarConnectStartInput): Promise<CalendarConnectStartResponse> {
    const ctx = RequestContextStore.require();
    const creds = await this.config.credentials();
    if (!creds) {
      throw new AppError(
        ERROR_CODES.APPT_CALENDAR_NOT_CONFIGURED,
        'Google Calendar is not set up for this platform. Ask your platform administrator to add the Google OAuth client.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const state = signState(
      newState(
        { orgId: ctx.orgId, userId: ctx.userId, returnTo: input.returnTo ?? DEFAULT_RETURN },
        Date.now(),
      ),
      this.stateKey,
    );
    return {
      url: this.client.authorizeUrl(creds, state),
      expiresInSeconds: STATE_TTL_SECONDS,
    };
  }

  /** The writable calendars of the connected account, for the picker. */
  async calendars(): Promise<CalendarListResponse> {
    const orgId = RequestContextStore.require().orgId;
    try {
      const list = await this.tokens.withToken(orgId, (token) => this.client.listCalendars(token));
      return { data: list };
    } catch (err) {
      throw this.asApiError(err);
    }
  }

  /** Bookings go to this calendar from now on; events already written stay where they are (each appointment remembers its own). */
  async selectCalendar(input: SelectCalendarInput): Promise<CalendarStatusResponse> {
    const ctx = RequestContextStore.require();
    let name: string | null;
    try {
      // The choice is checked against the account's own list: a typed id the account cannot write to would fail every booking later.
      const list = await this.tokens.withToken(ctx.orgId, (token) =>
        this.client.listCalendars(token),
      );
      const picked = list.find((c) => c.id === input.calendarId);
      if (!picked) {
        throw AppError.validation('That calendar is not one this Google account can write to.', [
          { path: 'calendarId', message: 'not_writable' },
        ]);
      }
      name = picked.name;
    } catch (err) {
      throw this.asApiError(err);
    }
    await this.db.tx(async (tx) => {
      const conn = await this.repo.find(tx, ctx.orgId, true);
      if (!conn || conn.status !== 'active') throw this.notConnected();
      await this.repo.setCalendar(tx, ctx.orgId, conn.id, input.calendarId, name);
      await this.audit.record(tx, {
        module: CALENDAR_AUDIT_MODULE,
        recordId: conn.id,
        action: 'update',
        delta: { calendarId: { old: conn.calendarId, new: input.calendarId } },
      });
      await this.outbox.emit(tx, {
        orgId: ctx.orgId,
        aggregateModule: CALENDAR_AUDIT_MODULE,
        aggregateId: conn.id,
        eventType: 'appointment_calendar.calendar_selected',
        payload: { uuid: conn.uuid, provider: 'google' },
      });
    });
    this.adapter.forget(ctx.orgId);
    return this.statusOf(ctx.orgId);
  }

  /** Withdraws the grant at Google, then forgets it here. A Google that cannot be reached does not trap the admin: the local copy goes anyway. */
  async disconnect(): Promise<CalendarStatusResponse> {
    const ctx = RequestContextStore.require();
    const conn = await this.tokens.connection(ctx.orgId, { fresh: true });
    if (!conn) return this.statusOf(ctx.orgId);
    try {
      await this.client.revoke(this.crypto.decrypt(conn.refreshTokenEnc));
    } catch (err) {
      this.logger.warn(
        { orgId: ctx.orgId, err },
        'Google did not confirm the revoke; disconnecting here regardless',
      );
    }
    await this.db.tx(async (tx) => {
      const live = await this.repo.find(tx, ctx.orgId, true);
      if (!live) return;
      await this.repo.remove(tx, ctx.orgId, live.id);
      await this.audit.record(tx, {
        module: CALENDAR_AUDIT_MODULE,
        recordId: live.id,
        action: 'delete',
        delta: { status: { old: live.status, new: 'disconnected' } },
      });
      await this.outbox.emit(tx, {
        orgId: ctx.orgId,
        aggregateModule: CALENDAR_AUDIT_MODULE,
        aggregateId: live.id,
        eventType: 'appointment_calendar.disconnected',
        payload: { uuid: live.uuid, provider: 'google' },
      });
    });
    this.adapter.forget(ctx.orgId);
    return this.statusOf(ctx.orgId);
  }

  // --- the public callback ---------------------------------------------------------------------------------------------

  /**
   * Completes the consent: verifies the signed state, trades the code for tokens, checks Google granted what the work needs, reads the
   * account, and stores the sealed grant. Always ends in a redirect back to the page the admin came from with `?calendar=<outcome>`;
   * nothing about Google's answer is shown on this address.
   */
  async callback(query: CalendarCallbackQuery): Promise<string> {
    const checked = verifyState(query.state ?? '', this.stateKey, Date.now());
    if (!checked.ok) {
      // No trustworthy state: nobody to bind this to, nothing is stored.
      this.logger.warn({ reason: checked.reason }, 'Google Calendar callback with a bad state');
      return returnUrl(
        this.webUrl,
        DEFAULT_RETURN,
        checked.reason === 'expired' ? 'expired' : 'failed',
      );
    }
    const { state } = checked;
    const done = (outcome: CalendarCallbackOutcome) =>
      returnUrl(this.webUrl, state.returnTo, outcome);

    if (query.error) return done('denied');
    if (!query.code) return done('failed');
    const creds = await this.config.credentials();
    if (!creds) return done('not_configured');

    try {
      const grant = await this.client.exchangeCode(creds, query.code);
      const granted = new Set(grant.scope.split(/\s+/).filter(Boolean));
      if (GOOGLE_CALENDAR_REQUIRED_SCOPES.some((s) => !granted.has(s))) {
        // The person unticked a permission on Google's screen. What was just granted is withdrawn rather than left dangling.
        await this.client.revoke(grant.refreshToken ?? grant.accessToken).catch(() => undefined);
        return done('missing_scope');
      }
      const account = await this.client
        .userinfo(grant.accessToken)
        .catch(() => ({ sub: null, email: null }));

      const stored = await RequestContextStore.run(
        {
          requestId: `calendar-connect-${state.nonce}`,
          orgId: state.orgId,
          actorType: 'user',
          actorId: state.userId,
          userId: state.userId,
        },
        () =>
          this.db.txAs({ orgId: state.orgId, userId: state.userId }, async (tx) => {
            const before = await this.repo.find(tx, state.orgId, true);
            // Google issues a refresh token on every consent here (`prompt=consent`); if one ever does not arrive, the same account
            // keeps the one it had.
            const refreshTokenEnc = grant.refreshToken
              ? this.crypto.encrypt(grant.refreshToken)
              : before && before.accountSub !== null && before.accountSub === account.sub
                ? before.refreshTokenEnc
                : null;
            if (!refreshTokenEnc) return false;
            const row = await this.repo.upsert(tx, state.orgId, {
              connectedBy: state.userId,
              accountEmail: account.email,
              accountSub: account.sub,
              refreshTokenEnc,
              accessTokenEnc: this.crypto.encrypt(grant.accessToken),
              accessTokenExpiresAt: new Date(Date.now() + grant.expiresInSeconds * 1000),
              scopes: [...granted].join(' '),
            });
            await this.audit.record(tx, {
              module: CALENDAR_AUDIT_MODULE,
              recordId: row.id,
              action: before ? 'update' : 'insert',
              delta: { status: { old: before?.status ?? 'disconnected', new: 'connected' } },
            });
            await this.outbox.emit(tx, {
              orgId: state.orgId,
              aggregateModule: CALENDAR_AUDIT_MODULE,
              aggregateId: row.id,
              eventType: 'appointment_calendar.connected',
              payload: { uuid: row.uuid, provider: 'google' },
            });
            return true;
          }),
      );
      if (!stored) {
        this.logger.warn(
          { orgId: state.orgId },
          'Google returned no refresh token: nothing stored',
        );
        await this.client.revoke(grant.accessToken).catch(() => undefined);
        return done('failed');
      }
      this.adapter.forget(state.orgId);
      return done('connected');
    } catch (err) {
      this.logger.warn({ orgId: state.orgId, err }, 'Google Calendar connect failed');
      return done('failed');
    }
  }

  // --- internals -------------------------------------------------------------------------------------------------------

  private notConnected(): AppError {
    return new AppError(
      ERROR_CODES.APPT_CALENDAR_NOT_CONNECTED,
      'No Google Calendar is connected for this workspace.',
      HttpStatus.CONFLICT,
    );
  }

  /** What a staff call tells the caller about a Google failure: never Google's own text. */
  private asApiError(err: unknown): Error {
    if (err instanceof AppError) return err;
    if (err instanceof CalendarNotConnectedError) {
      if (err.reason === 'not_configured') {
        return new AppError(
          ERROR_CODES.APPT_CALENDAR_NOT_CONFIGURED,
          'Google Calendar is not set up for this platform.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      return this.notConnected();
    }
    if (err instanceof GoogleCalendarError) {
      this.logger.warn(
        { kind: err.kind, status: err.status, reason: err.reason },
        'Google Calendar call failed',
      );
      return new AppError(
        ERROR_CODES.APPT_CALENDAR_PROVIDER_FAILED,
        'Google Calendar did not answer. Try again in a moment.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
