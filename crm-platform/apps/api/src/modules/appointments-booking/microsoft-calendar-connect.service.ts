import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ERROR_CODES,
  MICROSOFT_CALENDAR_CONFIRM_OUTCOME,
  type CalendarCallbackQuery,
  type CalendarConnectStartInput,
  type CalendarConnectStartResponse,
  type CalendarListResponse,
  type CalendarProviderStatus,
  type MicrosoftCalendarConfirmInput,
  type MicrosoftCalendarConfirmResponse,
  type SelectCalendarInput,
} from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import {
  MicrosoftCalendarClient,
  MicrosoftCalendarError,
} from '../../infra/providers/appointments-booking';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { AppointmentsRepository } from './appointments.repository';
import { CalendarProviders } from './calendar-providers.service';
import { MicrosoftCalendarAdapter } from './microsoft-calendar.adapter';
import { MicrosoftCalendarConfig } from './microsoft-calendar-config.service';
import { MicrosoftCalendarConnectionRepository } from './microsoft-calendar-connection.repository';
import {
  deriveMicrosoftKey,
  newState,
  returnUrl,
  signState,
  signTicket,
  STATE_TTL_SECONDS,
  TICKET_TTL_SECONDS,
  verifyState,
  verifyTicket,
} from './microsoft-calendar-state';
import {
  MICROSOFT_CALENDAR_AUDIT_MODULE,
  microsoftGrantCovers,
  MicrosoftCalendarTokens,
  MicrosoftNotConnectedError,
} from './microsoft-calendar-tokens.service';

const DEFAULT_RETURN = '/appointments/settings';

/**
 * Connecting a workspace to Outlook / Microsoft 365 (BL-035), modelled on the Google connection (TW-APPT-028, TW-GACC-010): the consent URL,
 * the public callback, a confirmation by the same signed-in admin, which calendar bookings go to, and disconnecting. One Microsoft account
 * per workspace.
 *
 * The confirmation differs in mechanism from Google's, for the same purpose. Google's callback exchanges the code and parks the tokens until
 * the admin confirms; Microsoft has no way to withdraw a token we were given, so here the callback exchanges NOTHING: it verifies the
 * signed state and hands the browser a signed ticket that carries the sealed code. The code is exchanged only when the admin who pressed
 * Connect, in that workspace, confirms. A forwarded consent link ends on a page that refuses it, and nothing was ever requested for it.
 */
@Injectable()
export class MicrosoftCalendarConnectService {
  private readonly logger = new Logger(MicrosoftCalendarConnectService.name);
  private readonly key: Buffer;
  private readonly webUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MicrosoftCalendarConnectionRepository,
    private readonly tokens: MicrosoftCalendarTokens,
    private readonly config: MicrosoftCalendarConfig,
    private readonly client: MicrosoftCalendarClient,
    private readonly adapter: MicrosoftCalendarAdapter,
    private readonly providers: CalendarProviders,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly appts: AppointmentsRepository,
    env: ConfigService<Env, true>,
  ) {
    this.key = deriveMicrosoftKey(env.get('CREDENTIALS_ENCRYPTION_KEY', { infer: true }));
    this.webUrl = env.get('WEB_APP_URL', { infer: true }).replace(/\/$/, '');
  }

  // --- staff -----------------------------------------------------------------------------------------------------------

  /** This provider's card: state, the account, the chosen calendar and the last failure. `active`: bookings are written here. */
  async statusOf(orgId: number): Promise<CalendarProviderStatus> {
    const [conn, creds, write] = await Promise.all([
      this.tokens.connection(orgId, { fresh: true }),
      this.config.credentials(),
      this.providers.writeProvider(orgId),
    ]);
    const status = !creds
      ? 'unavailable'
      : !conn
        ? 'disconnected'
        : conn.status !== 'active'
          ? 'needs_reconnect'
          : microsoftGrantCovers(conn)
            ? 'connected'
            : 'disconnected';
    return {
      provider: 'microsoft',
      status,
      account: conn?.accountEmail ?? null,
      calendarId: conn?.calendarId ?? null,
      calendarName: conn
        ? (conn.calendarName ?? (conn.calendarId === 'primary' ? null : conn.calendarId))
        : null,
      connectedAt: conn?.connectedAt.toISOString() ?? null,
      lastErrorCode: conn?.lastErrorCode ?? null,
      active: write === 'microsoft',
    };
  }

  /** The consent URL, bound to this workspace and admin. The browser is sent there by the web app. */
  async start(input: CalendarConnectStartInput): Promise<CalendarConnectStartResponse> {
    const ctx = RequestContextStore.require();
    if (ctx.userId === null) throw AppError.unauthenticated();
    const creds = await this.config.credentials();
    if (!creds) {
      throw new AppError(
        ERROR_CODES.APPT_CALENDAR_NOT_CONFIGURED,
        'Outlook / Microsoft 365 is not set up for this platform. Ask your platform administrator to add the Microsoft app.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const held = await this.tokens.connection(ctx.orgId, { fresh: true });
    const state = newState(
      { orgId: ctx.orgId, userId: ctx.userId, returnTo: input.returnTo ?? DEFAULT_RETURN },
      Date.now(),
    );
    return {
      url: this.client.authorizeUrl(creds, signState(state, this.key), held?.accountEmail),
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

  /** Bookings go to this calendar from now on; events already written stay where they are (an event is addressed by its own id). */
  async selectCalendar(input: SelectCalendarInput): Promise<CalendarProviderStatus> {
    const ctx = RequestContextStore.require();
    let name: string;
    try {
      // The choice is checked against the account's own list: a typed id the account cannot write to would fail every booking later.
      const list = await this.tokens.withToken(ctx.orgId, (token) =>
        this.client.listCalendars(token),
      );
      const picked = list.find((c) => c.id === input.calendarId);
      if (!picked) {
        throw AppError.validation('That calendar is not one this Microsoft account can write to.', [
          { path: 'calendarId', message: 'not_writable' },
        ]);
      }
      name = picked.name;
    } catch (err) {
      throw this.asApiError(err);
    }
    await this.db.tx(async (tx) => {
      const conn = await this.repo.find(tx, ctx.orgId, true);
      if (!conn || conn.status !== 'active' || !microsoftGrantCovers(conn)) {
        throw this.notConnected();
      }
      await this.repo.setCalendar(tx, ctx.orgId, conn.id, input.calendarId, name);
      await this.audit.record(tx, {
        module: MICROSOFT_CALENDAR_AUDIT_MODULE,
        recordId: conn.id,
        action: 'update',
        delta: { calendarId: { old: conn.calendarId, new: input.calendarId } },
      });
      await this.outbox.emit(tx, {
        orgId: ctx.orgId,
        aggregateModule: MICROSOFT_CALENDAR_AUDIT_MODULE,
        aggregateId: conn.id,
        eventType: 'appointment_calendar.calendar_selected',
        payload: { uuid: conn.uuid, provider: 'microsoft' },
      });
    });
    this.adapter.forget(ctx.orgId);
    return this.statusOf(ctx.orgId);
  }

  /**
   * Forgets the grant here. Microsoft offers an app no way to withdraw a person's consent (they remove it themselves at
   * myaccount.microsoft.com), so unlike Google there is nothing to revoke: the sealed tokens are deleted and are worth nothing afterwards.
   */
  async disconnect(): Promise<CalendarProviderStatus> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const live = await this.repo.find(tx, ctx.orgId, true);
      if (!live) return;
      await this.repo.remove(tx, ctx.orgId, live.id);
      // A choice that named this provider is meaningless now: back to automatic.
      if ((await this.providers.readPreference(tx, ctx.orgId)) === 'microsoft') {
        await this.providers.writePreference(tx, ctx.orgId, ctx.userId, null);
      }
      await this.audit.record(tx, {
        module: MICROSOFT_CALENDAR_AUDIT_MODULE,
        recordId: live.id,
        action: 'delete',
        delta: { status: { old: live.status, new: 'disconnected' } },
      });
      await this.outbox.emit(tx, {
        orgId: ctx.orgId,
        aggregateModule: MICROSOFT_CALENDAR_AUDIT_MODULE,
        aggregateId: live.id,
        eventType: 'appointment_calendar.disconnected',
        payload: { uuid: live.uuid, provider: 'microsoft' },
      });
    });
    this.adapter.forget(ctx.orgId);
    this.providers.forgetPreference(ctx.orgId);
    return this.statusOf(ctx.orgId);
  }

  // --- the public callback ---------------------------------------------------------------------------------------------

  /**
   * Microsoft's redirect: verifies the state and sends the browser back to the app, with a ticket when Microsoft returned a code. Nothing
   * is exchanged or stored here (see the class comment); the ticket is confirmed by the admin on the settings page.
   */
  async callback(query: CalendarCallbackQuery): Promise<string> {
    const checked = verifyState(query.state ?? '', this.key, Date.now());
    if (!checked.ok) {
      this.logger.warn({ reason: checked.reason }, 'Microsoft consent callback with a bad state');
      return returnUrl(this.webUrl, DEFAULT_RETURN, {
        outlook: checked.reason === 'expired' ? 'expired' : 'failed',
      });
    }
    const { orgId, userId, returnTo } = checked.value;
    const done = (outcome: string) => returnUrl(this.webUrl, returnTo, { outlook: outcome });
    if (query.error) return done('denied');
    if (!query.code || userId === null) return done('failed');
    if (!(await this.config.credentials())) return done('not_configured');
    const ticket = signTicket(
      {
        orgId,
        userId,
        returnTo,
        sealedCode: this.crypto.encrypt(query.code),
        expiresAt: Date.now() + TICKET_TTL_SECONDS * 1000,
      },
      this.key,
    );
    return returnUrl(this.webUrl, returnTo, {
      outlook: MICROSOFT_CALENDAR_CONFIRM_OUTCOME,
      ticket,
    });
  }

  // --- the confirmation (signed in) ------------------------------------------------------------------------------------

  /**
   * Exchanges the code and stores the grant, once, for the admin who pressed Connect. A ticket that is not this person's, in this workspace,
   * is refused before Microsoft is asked for anything.
   */
  async confirm(input: MicrosoftCalendarConfirmInput): Promise<MicrosoftCalendarConfirmResponse> {
    const ctx = RequestContextStore.require();
    const checked = verifyTicket(input.ticket, this.key, Date.now());
    if (!checked.ok) throw this.invalid(checked.reason === 'expired');
    const ticket = checked.value;
    if (ticket.orgId !== ctx.orgId || ticket.userId !== ctx.userId) {
      throw new AppError(
        ERROR_CODES.APPT_CALENDAR_CONFIRM_NOT_YOURS,
        'This Microsoft connection was started by someone else. Nothing was connected. Ask the person who started it to connect again.',
        HttpStatus.FORBIDDEN,
      );
    }
    const creds = await this.config.credentials();
    if (!creds) {
      throw new AppError(
        ERROR_CODES.APPT_CALENDAR_NOT_CONFIGURED,
        'Outlook / Microsoft 365 is not set up for this platform.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    let code: string;
    try {
      code = this.crypto.decrypt(ticket.sealedCode);
    } catch {
      throw this.invalid(false);
    }

    let grant;
    let account;
    try {
      grant = await this.client.exchangeCode(creds, code);
      account = await this.client.me(grant.accessToken).catch(() => ({ id: null, address: null }));
    } catch (err) {
      // A code is good once and for about ten minutes: an exchange that fails means this ticket is spent. Press Connect again.
      this.logger.warn({ orgId: ctx.orgId, err: String(err) }, 'Microsoft code exchange failed');
      throw this.invalid(false);
    }
    const granted = grant.scope.split(/\s+/).filter(Boolean);
    const hasCalendar = granted.some((s) => s.toLowerCase().endsWith('calendars.readwrite'));
    const prior = await this.tokens.connection(ctx.orgId, { fresh: true });
    // `offline_access` is what makes Microsoft return a refresh token; without one there is nothing to keep.
    if (!hasCalendar || !grant.refreshToken) {
      this.logger.warn(
        { orgId: ctx.orgId, hasCalendar },
        'Microsoft grant is not usable: nothing stored',
      );
      return { outcome: 'missing_scope', returnTo: ticket.returnTo };
    }
    // With an account stored, an unknown identity could be the same user or another: do not guess, store nothing.
    if (prior && account.id === null) throw this.invalid(false);

    await this.db.tx(async (tx) => {
      const before = await this.repo.find(tx, ctx.orgId, true);
      const row = await this.repo.upsert(tx, ctx.orgId, {
        connectedBy: ctx.userId,
        accountEmail: account.address,
        accountSub: account.id,
        refreshTokenEnc: this.crypto.encrypt(grant.refreshToken!),
        accessTokenEnc: this.crypto.encrypt(grant.accessToken),
        accessTokenExpiresAt: new Date(Date.now() + grant.expiresInSeconds * 1000),
        scopes: granted.join(' '),
      });
      // Another Microsoft account: the upcoming events live in the OLD account's calendar, which this workspace can no longer read or write.
      // They are detached, so the next change to a booking (or the back-fill) writes a fresh event in the new account.
      if (before && before.accountSub !== null && before.accountSub !== account.id) {
        await this.appts.detachEvents(tx, ctx.orgId, 'microsoft');
      }
      await this.audit.record(tx, {
        module: MICROSOFT_CALENDAR_AUDIT_MODULE,
        recordId: row.id,
        action: before ? 'update' : 'insert',
        delta: { status: { old: before?.status ?? 'disconnected', new: 'connected' } },
      });
      await this.outbox.emit(tx, {
        orgId: ctx.orgId,
        aggregateModule: MICROSOFT_CALENDAR_AUDIT_MODULE,
        aggregateId: row.id,
        eventType: 'appointment_calendar.connected',
        payload: { uuid: row.uuid, provider: 'microsoft' },
      });
    });
    this.adapter.forget(ctx.orgId);
    return { outcome: 'connected', returnTo: ticket.returnTo };
  }

  // --- internals -------------------------------------------------------------------------------------------------------

  private invalid(expired: boolean): AppError {
    return new AppError(
      ERROR_CODES.APPT_CALENDAR_CONFIRM_INVALID,
      expired
        ? 'This Microsoft connection took too long to confirm. Press Connect again.'
        : 'This Microsoft connection can no longer be confirmed. Press Connect again.',
      HttpStatus.GONE,
    );
  }

  private notConnected(): AppError {
    return new AppError(
      ERROR_CODES.APPT_CALENDAR_NOT_CONNECTED,
      'No Outlook / Microsoft 365 calendar is connected for this workspace.',
      HttpStatus.CONFLICT,
    );
  }

  /** What a staff call tells the caller about a Microsoft failure: never Microsoft's own text. */
  private asApiError(err: unknown): Error {
    if (err instanceof AppError) return err;
    if (err instanceof MicrosoftNotConnectedError) {
      if (err.reason === 'not_configured') {
        return new AppError(
          ERROR_CODES.APPT_CALENDAR_NOT_CONFIGURED,
          'Outlook / Microsoft 365 is not set up for this platform.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      return this.notConnected();
    }
    if (err instanceof MicrosoftCalendarError) {
      this.logger.warn(
        { kind: err.kind, status: err.status, reason: err.reason },
        'Microsoft Calendar call failed',
      );
      return new AppError(
        ERROR_CODES.APPT_CALENDAR_PROVIDER_FAILED,
        'Outlook / Microsoft 365 did not answer. Try again in a moment.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
