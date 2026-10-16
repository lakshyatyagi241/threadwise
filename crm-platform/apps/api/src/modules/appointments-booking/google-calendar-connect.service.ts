import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ERROR_CODES,
  GOOGLE_CAPABILITIES,
  googleCapabilitiesOf,
  googleCapabilityRestricted,
  type CalendarCallbackQuery,
  type CalendarConnectStartInput,
  type CalendarConnectStartResponse,
  type CalendarListResponse,
  type CalendarStatusResponse,
  type GoogleAccountResponse,
  type GoogleCapability,
  type GoogleConnectResponse,
  type SelectCalendarInput,
} from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import {
  GoogleCalendarClient,
  GoogleCalendarError,
} from '../../infra/providers/appointments-booking';
import { AuditService } from '../../kernel/audit/audit.service';
import { RbacService } from '../../kernel/rbac/rbac.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { GoogleCalendarAdapter } from './google-calendar.adapter';
import { GoogleConsentService } from './google-consent.service';
import { GoogleCalendarConfig } from './google-calendar-config.service';
import { GoogleCalendarConnectionRepository } from './google-calendar-connection.repository';
import { deriveStateKey } from './google-calendar-state';
import {
  CALENDAR_AUDIT_MODULE,
  CalendarNotConnectedError,
  GoogleCalendarTokens,
  grantCovers,
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
    private readonly rbac: RbacService,
    private readonly consent: GoogleConsentService,
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
    // Without a platform client nothing can be refreshed or written, whatever the stored grant says. An account connected for Sheets only
    // has no calendar yet: for the calendar card it is "disconnected" (Connect adds the calendar permissions to what it already has).
    const status = !creds
      ? 'unavailable'
      : !conn
        ? 'disconnected'
        : conn.status !== 'active'
          ? 'needs_reconnect'
          : grantCovers(conn, 'calendar')
            ? 'connected'
            : 'disconnected';
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

  /** The consent URL for the calendar, bound to this workspace and admin. The browser is sent there by the web app. */
  async start(input: CalendarConnectStartInput): Promise<CalendarConnectStartResponse> {
    const orgId = RequestContextStore.require().orgId;
    const held = await this.tokens.connection(orgId, { fresh: true });
    // The grant is the whole workspace's Google account: a booking-settings editor may connect the calendar, but may not replace an
    // account that Sheets, Docs or Forms also use unless they may manage the Google account. A reconnect asks for what was held.
    this.requireManageWhenShared(held);
    const heldCapabilities = held ? googleCapabilitiesOf(held.scopes) : [];
    const started = await this.begin(
      ['calendar', ...heldCapabilities],
      input.returnTo ?? DEFAULT_RETURN,
    );
    if (!started) {
      throw new AppError(
        ERROR_CODES.APPT_CALENDAR_NOT_CONFIGURED,
        'Google Calendar is not set up for this platform. Ask your platform administrator to add the Google OAuth client.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return started;
  }

  /**
   * The consent URL for any set of capabilities (the Google account page): Google is asked only for the scopes of what was ticked, and
   * `include_granted_scopes` keeps what the account already has. Null when the platform has no Google client.
   */
  async begin(
    capabilities: readonly GoogleCapability[],
    returnTo: string,
  ): Promise<GoogleConnectResponse | null> {
    return this.consent.start(capabilities, returnTo);
  }

  /** The Google account page's view of the connection: state, the account, which capabilities the grant covers, and the last failure. */
  async account(): Promise<GoogleAccountResponse> {
    return this.accountOf(RequestContextStore.require().orgId);
  }

  async accountOf(orgId: number): Promise<GoogleAccountResponse> {
    const [conn, creds] = await Promise.all([
      this.tokens.connection(orgId, { fresh: true }),
      this.config.credentials(),
    ]);
    const granted = new Set(googleCapabilitiesOf(conn?.scopes));
    return {
      status: !creds
        ? 'unavailable'
        : !conn
          ? 'disconnected'
          : conn.status === 'active'
            ? 'connected'
            : 'needs_reconnect',
      account: conn?.accountEmail ?? null,
      connectedAt: conn?.connectedAt.toISOString() ?? null,
      capabilities: GOOGLE_CAPABILITIES.map((key) => ({
        key,
        granted: granted.has(key),
        restricted: googleCapabilityRestricted(key),
      })),
      calendarId: conn?.calendarId ?? null,
      calendarName: conn
        ? (conn.calendarName ?? (conn.calendarId === 'primary' ? null : conn.calendarId))
        : null,
      lastError:
        conn?.lastErrorCode && conn.lastErrorAt
          ? {
              code: conn.lastErrorCode,
              at: conn.lastErrorAt.toISOString(),
              capability: (GOOGLE_CAPABILITIES as readonly string[]).includes(
                conn.lastErrorCapability ?? '',
              )
                ? (conn.lastErrorCapability as GoogleCapability)
                : null,
            }
          : null,
      lastUsedAt: conn?.lastUsedAt?.toISOString() ?? null,
    };
  }

  /** The writable calendars of the connected account, for the picker. */
  async calendars(): Promise<CalendarListResponse> {
    const orgId = RequestContextStore.require().orgId;
    try {
      const list = await this.tokens.withToken(orgId, (token) => this.client.listCalendars(token), {
        capability: 'calendar',
      });
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
      const list = await this.tokens.withToken(
        ctx.orgId,
        (token) => this.client.listCalendars(token),
        { capability: 'calendar' },
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
      if (!conn || conn.status !== 'active' || !grantCovers(conn, 'calendar')) {
        throw this.notConnected();
      }
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
    this.requireManageWhenShared(conn);
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

  /** Google's redirect: see `GoogleConsentService` (the grant is parked, and stored only when the same admin confirms it). */
  callback(query: CalendarCallbackQuery): Promise<string> {
    return this.consent.callback(query);
  }

  // --- internals -------------------------------------------------------------------------------------------------------

  /**
   * The calendar routes need only `record.booking-types.update`, but the grant they act on is shared. When it also carries Sheets, Docs, Forms
   * or the file list, replacing or withdrawing it takes `google.account.manage`, so a booking editor cannot switch off every Google step.
   */
  private requireManageWhenShared(conn: { scopes: string | null } | null | undefined): void {
    if (!conn || googleCapabilitiesOf(conn.scopes).every((c) => c === 'calendar')) return;
    const grants = RequestContextStore.require().grants;
    if (!grants || !this.rbac.can(grants, 'google.account.manage').allowed) {
      throw AppError.forbidden('google.account.manage');
    }
  }

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
