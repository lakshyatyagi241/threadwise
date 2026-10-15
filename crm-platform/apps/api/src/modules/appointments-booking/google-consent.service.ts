import { createHash } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  GOOGLE_CAPABILITIES,
  googleCapabilitiesOf,
  googleMissingScopes,
  type CalendarCallbackOutcome,
  type CalendarCallbackQuery,
  type GoogleCapability,
  type GoogleConnectResponse,
  type GoogleConsentRequest,
  type GoogleConsentResult,
} from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import { GoogleCalendarClient } from '../../infra/providers/appointments-booking';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { RbacService, type GrantSet } from '../../kernel/rbac/rbac.service';
import { AppointmentsRepository } from './appointments.repository';
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
import { CALENDAR_AUDIT_MODULE, GoogleCalendarTokens } from './google-calendar-tokens.service';
import { GoogleConsentRepository, type ConsentRow } from './google-consent.repository';

const DEFAULT_RETURN = '/appointments/settings';
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

/**
 * Connecting Google, with a confirmation (TW-GACC-010). Pressing Connect creates a server-side record bound to the admin, the workspace and
 * what was asked for; the signed state names it. Google's redirect lands on the API's origin, which cannot see the person's session, so
 * the callback only PARKS what Google returned (sealed, ten minutes at most) and sends the browser to a page of the app. There the same
 * signed-in admin reads "connect <google email> to <workspace> for <permissions>?" and confirms, and only then is the grant stored.
 *
 * Why it matters: without it, an admin could send their consent link to somebody else, and the somebody's Google account (Sheets, Drive)
 * would end up connected to the admin's workspace. Now that link ends on a page that refuses it ("started by someone else"), the parked
 * grant is withdrawn at Google, and nothing is stored. The same holds for a link used twice (the claim is atomic: one code exchange per
 * record), an expired one, another workspace, and a cancel.
 *
 * Withdrawing a parked grant: only when it cannot be the stored account's (no account stored, or a different Google user), because a revoke
 * of a refresh token may reach the grant that already works when the Google user is the same. Otherwise the parked tokens are just
 * forgotten.
 */
@Injectable()
export class GoogleConsentService {
  private readonly logger = new Logger(GoogleConsentService.name);
  private readonly stateKey: Buffer;
  private readonly webUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly requests: GoogleConsentRepository,
    private readonly connections: GoogleCalendarConnectionRepository,
    private readonly tokens: GoogleCalendarTokens,
    private readonly config: GoogleCalendarConfig,
    private readonly client: GoogleCalendarClient,
    private readonly adapter: GoogleCalendarAdapter,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly rbac: RbacService,
    private readonly appts: AppointmentsRepository,
    env: ConfigService<Env, true>,
  ) {
    this.stateKey = deriveStateKey(env.get('CREDENTIALS_ENCRYPTION_KEY', { infer: true }));
    this.webUrl = env.get('WEB_APP_URL', { infer: true }).replace(/\/$/, '');
  }

  // --- pressing Connect ------------------------------------------------------------------------------------------------

  /** The consent URL, with a record bound to the caller. Null when the platform has no Google client. */
  async start(
    capabilities: readonly GoogleCapability[],
    returnTo: string,
  ): Promise<GoogleConnectResponse | null> {
    const ctx = RequestContextStore.require();
    if (ctx.userId === null) throw AppError.unauthenticated();
    const creds = await this.config.credentials();
    if (!creds) return null;
    const unique = GOOGLE_CAPABILITIES.filter((c) => capabilities.includes(c));
    const existing = await this.tokens.connection(ctx.orgId, { fresh: true });
    const state = newState(
      { orgId: ctx.orgId, userId: ctx.userId, returnTo, capabilities: unique },
      Date.now(),
    );
    await this.db.tx((tx) =>
      this.requests.create(tx, ctx.orgId, {
        nonceHash: sha(state.nonce),
        userId: ctx.userId!,
        capabilities: unique,
        returnTo,
        expiresAt: new Date(state.expiresAt),
      }),
    );
    return {
      url: this.client.authorizeUrl(
        creds,
        signState(state, this.stateKey),
        unique,
        existing?.accountEmail,
      ),
      expiresInSeconds: STATE_TTL_SECONDS,
    };
  }

  // --- Google's redirect (public) --------------------------------------------------------------------------------------

  /**
   * Verifies the state, claims its record once, trades the code for tokens, checks what Google granted, and parks the result. Ends in a
   * redirect: to the confirmation page when there is something to confirm, otherwise back where the admin came from with the outcome.
   */
  async callback(query: CalendarCallbackQuery): Promise<string> {
    const checked = verifyState(query.state ?? '', this.stateKey, Date.now());
    if (!checked.ok) {
      this.logger.warn({ reason: checked.reason }, 'Google consent callback with a bad state');
      return returnUrl(
        this.webUrl,
        DEFAULT_RETURN,
        checked.reason === 'expired' ? 'expired' : 'failed',
      );
    }
    const { state } = checked;
    const orgId = state.orgId;
    const hash = sha(state.nonce);
    const done = (outcome: CalendarCallbackOutcome) =>
      returnUrl(this.webUrl, state.returnTo, outcome);

    if (query.error) {
      await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.requests.finishByNonce(tx, orgId, hash, 'cancelled'),
      );
      return done('denied');
    }
    const claim = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.requests.claim(tx, orgId, hash),
    );
    if (claim.row === null) {
      // A link that was already used, or never issued, or too old: nothing is exchanged and nothing is stored.
      return done(claim.why === 'expired' ? 'expired' : 'failed');
    }
    const req = claim.row;
    const reject = async () => {
      await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.requests.finish(tx, orgId, req.id, 'rejected'),
      );
    };
    if (!query.code) {
      await reject();
      return done('failed');
    }
    const creds = await this.config.credentials();
    if (!creds) {
      await reject();
      return done('not_configured');
    }

    try {
      const grant = await this.client.exchangeCode(creds, query.code);
      const granted = new Set(grant.scope.split(/\s+/).filter(Boolean));
      const account = await this.client
        .userinfo(grant.accessToken)
        .catch(() => ({ sub: null, email: null }));
      const prior = await this.tokens.connection(orgId, { fresh: true });
      const withdraw = async () =>
        this.client.revoke(grant.refreshToken ?? grant.accessToken).catch(() => undefined);
      // With an account stored, an unknown identity stores and withdraws nothing (it could be the same Google user).
      if (prior && account.sub === null) {
        await reject();
        return done('failed');
      }
      const missing = googleMissingScopes(grant.scope, req.capabilities as GoogleCapability[]);
      if (missing.length > 0) {
        // Kept for confirmation only on the account that is already stored (a short grant there is a working superset).
        const sameAccount = prior !== null && prior.accountSub === account.sub;
        if (!sameAccount) {
          if (prior === null || prior.accountSub !== null) await withdraw();
          await reject();
          return done('missing_scope');
        }
      }
      // Google issues a refresh token on every consent here (`prompt=consent`); the same account may keep the one it had.
      const keepsOld =
        prior !== null && prior.accountSub !== null && prior.accountSub === account.sub;
      if (!grant.refreshToken && !keepsOld) {
        this.logger.warn({ orgId }, 'Google returned no refresh token: nothing stored');
        await withdraw();
        await reject();
        return done('failed');
      }
      await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.requests.fill(tx, orgId, req.id, {
          accountEmail: account.email,
          accountSub: account.sub,
          scopes: [...granted].join(' '),
          missingScopes: missing,
          refreshTokenEnc: grant.refreshToken ? this.crypto.encrypt(grant.refreshToken) : null,
          accessTokenEnc: this.crypto.encrypt(grant.accessToken),
          accessTokenExpiresAt: new Date(Date.now() + grant.expiresInSeconds * 1000),
        }),
      );
      return `${this.webUrl}/google-account/confirm?request=${req.uuid}`;
    } catch (err) {
      this.logger.warn({ orgId, err }, 'Google consent callback failed');
      await reject().catch(() => undefined);
      return done('failed');
    }
  }

  // --- the confirmation page (signed in) -------------------------------------------------------------------------------

  /** What the person is about to connect. Only the admin who pressed Connect, in that workspace, may see it. */
  async details(uuid: string): Promise<GoogleConsentRequest> {
    const { req, orgName } = await this.mine(uuid);
    const requested = req.capabilities as GoogleCapability[];
    const granted = googleCapabilitiesOf(req.scopes);
    const prior = await this.tokens.connection(req.orgId, { fresh: true });
    return {
      id: req.uuid,
      googleEmail: req.accountEmail,
      workspaceName: orgName,
      requested,
      granted: requested.filter((c) => granted.includes(c)),
      missing: requested.filter((c) => !granted.includes(c)),
      replacesAccount:
        prior && prior.accountSub !== null && prior.accountSub !== req.accountSub
          ? prior.accountEmail
          : null,
      expiresAt: req.expiresAt.toISOString(),
      returnTo: req.returnTo,
    };
  }

  /** Stores the grant, once, for the admin who pressed Connect. */
  async confirm(uuid: string): Promise<GoogleConsentResult> {
    const { req } = await this.mine(uuid);
    const ctx = RequestContextStore.require();
    const granted = new Set((req.scopes ?? '').split(/\s+/).filter(Boolean));
    // The caller's permissions as they are NOW (an endpoint with no permission key has none loaded on the request).
    const grants = await this.rbac.grantsForUser(ctx.orgId, ctx.userId!);
    const stored = await this.db.tx(async (tx) => {
      // The row is locked and re-read: two confirmations at once store one grant and the second finds it used.
      const locked = await this.requests.find(tx, ctx.orgId, uuid, true);
      if (!locked || locked.status !== 'awaiting_confirm') return 'used' as const;
      if (locked.expiresAt.getTime() <= Date.now()) return 'expired' as const;
      const before = await this.connections.find(tx, ctx.orgId, true);
      // Checked again NOW, against the connection as it is now and the caller's permissions as they are now (not as they were when Connect
      // was pressed): a grant that Sheets, Docs or Forms have meanwhile started to share needs `google.account.manage`, and so does anything
      // beyond the calendar.
      if (
        !this.mayConnect(grants, locked.capabilities as GoogleCapability[], before?.scopes ?? null)
      ) {
        return 'forbidden' as const;
      }
      const refreshTokenEnc =
        locked.refreshTokenEnc ??
        (before && before.accountSub !== null && before.accountSub === locked.accountSub
          ? before.refreshTokenEnc
          : null);
      if (!refreshTokenEnc || !locked.accessTokenEnc || !locked.accessTokenExpiresAt) {
        return 'used' as const;
      }
      const row = await this.connections.upsert(tx, ctx.orgId, {
        connectedBy: locked.userId,
        accountEmail: locked.accountEmail,
        accountSub: locked.accountSub,
        refreshTokenEnc,
        accessTokenEnc: locked.accessTokenEnc,
        accessTokenExpiresAt: locked.accessTokenExpiresAt,
        scopes: [...granted].join(' '),
      });
      // Another Google account: the upcoming events live in the OLD account's calendar, which this workspace can no longer read or write.
      // They are detached (no event id, no drift state), so the reconcile never reads them as "missing" and the next change to a booking
      // writes a fresh event in the new account.
      if (before && before.accountSub !== null && before.accountSub !== locked.accountSub) {
        await this.appts.detachGoogleEvents(tx, ctx.orgId);
      }
      await this.audit.record(tx, {
        module: CALENDAR_AUDIT_MODULE,
        recordId: row.id,
        action: before ? 'update' : 'insert',
        delta: {
          status: { old: before?.status ?? 'disconnected', new: 'connected' },
          capabilities: {
            old: before ? googleCapabilitiesOf(before.scopes).join(',') : null,
            new: googleCapabilitiesOf(row.scopes).join(','),
          },
        },
      });
      await this.outbox.emit(tx, {
        orgId: ctx.orgId,
        aggregateModule: CALENDAR_AUDIT_MODULE,
        aggregateId: row.id,
        eventType: 'appointment_calendar.connected',
        payload: { uuid: row.uuid, provider: 'google' },
      });
      await this.requests.finish(tx, ctx.orgId, locked.id, 'confirmed');
      return {
        replacedRefreshTokenEnc:
          before && before.accountSub !== null && before.accountSub !== locked.accountSub
            ? before.refreshTokenEnc
            : null,
      };
    });
    if (stored === 'forbidden') {
      // The person may no longer do this: nothing is stored and the parked grant is withdrawn.
      await this.discard(req, 'rejected');
      throw AppError.forbidden('google.account.manage');
    }
    if (stored === 'expired') throw this.expired();
    if (stored === 'used') throw this.used();
    // Another Google account replaced the stored one: the old account's grant is withdrawn, or it would live on at Google.
    if (stored.replacedRefreshTokenEnc) {
      await this.client
        .revoke(this.crypto.decrypt(stored.replacedRefreshTokenEnc))
        .catch(() => undefined);
    }
    this.adapter.forget(ctx.orgId);
    return {
      outcome: req.missingScopes.length > 0 ? 'missing_scope' : 'connected',
      returnTo: req.returnTo,
    };
  }

  /**
   * Whether the signed-in caller may connect these capabilities over the grant that is stored now: `google.account.manage` always; the
   * booking-settings key (`record.booking-types.update`, the calendar card's key) only for a calendar-only consent over a calendar-only grant.
   */
  private mayConnect(
    grants: GrantSet,
    requested: readonly GoogleCapability[],
    storedScopes: string | null,
  ): boolean {
    if (this.rbac.can(grants, 'google.account.manage').allowed) return true;
    const calendarOnly =
      requested.every((c) => c === 'calendar') &&
      googleCapabilitiesOf(storedScopes).every((c) => c === 'calendar');
    return calendarOnly && this.rbac.can(grants, 'record.booking-types.update').allowed;
  }

  /** The admin changed their mind: the parked grant is dropped (and withdrawn where that is safe). */
  async cancel(uuid: string): Promise<GoogleConsentResult> {
    const { req } = await this.mine(uuid);
    await this.discard(req, 'cancelled');
    return { outcome: 'cancelled', returnTo: req.returnTo };
  }

  // --- the sweep -------------------------------------------------------------------------------------------------------

  /** Withdraws and forgets every consent that ran out of time (the worker's sweep; privileged to see all workspaces). */
  async sweepExpired(limit = 50): Promise<number> {
    const due = await this.db.privileged((tx) => this.requests.due(tx, limit));
    let n = 0;
    for (const req of due) {
      try {
        await this.discard(req, 'expired');
        n += 1;
      } catch (err) {
        this.logger.warn({ err, request: req.uuid }, 'could not discard an expired Google consent');
      }
    }
    return n;
  }

  // --- internals -------------------------------------------------------------------------------------------------------

  /**
   * Loads a request for the signed-in caller. Not theirs (a forwarded link used by someone else): refused, the parked grant is withdrawn
   * and the request ended, so the link is worth nothing afterwards. Another workspace cannot even see it (tenant isolation): not found.
   */
  private async mine(uuid: string): Promise<{ req: ConsentRow; orgName: string }> {
    const ctx = RequestContextStore.require();
    const found = await this.db.tx(async (tx) => {
      const req = await this.requests.find(tx, ctx.orgId, uuid);
      const org = await tx.execute(sql`SELECT name FROM organizations WHERE id = ${ctx.orgId}`);
      return { req, orgName: String((org.rows[0] as { name?: string } | undefined)?.name ?? '') };
    });
    const req = found.req;
    if (!req) {
      throw new AppError(
        ERROR_CODES.GOOGLE_CONSENT_NOT_FOUND,
        'This Google connection is not waiting for confirmation.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (req.userId !== ctx.userId) {
      if (req.status === 'awaiting_confirm') await this.discard(req, 'rejected');
      throw new AppError(
        ERROR_CODES.GOOGLE_CONSENT_NOT_YOURS,
        'This Google connection was started by someone else. Nothing was connected. Ask the person who started it to connect again.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (req.status === 'pending') {
      throw new AppError(
        ERROR_CODES.GOOGLE_CONSENT_NOT_FOUND,
        'Google has not answered this connection yet.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (req.status !== 'awaiting_confirm')
      throw req.status === 'expired' ? this.expired() : this.used();
    if (req.expiresAt.getTime() <= Date.now()) {
      await this.discard(req, 'expired');
      throw this.expired();
    }
    return { req, orgName: found.orgName };
  }

  /**
   * Ends a request and forgets its tokens; withdraws the parked grant at Google when it cannot be the stored account's. The end is one
   * atomic statement that returns what the request held, so two workers (or a worker and the person) never both revoke.
   */
  private async discard(
    req: ConsentRow,
    status: 'cancelled' | 'rejected' | 'expired',
  ): Promise<void> {
    const held = await this.db.txAs({ orgId: req.orgId, userId: null }, (tx) =>
      this.requests.end(tx, req.orgId, req.id, status),
    );
    if (!held) return; // somebody else ended it first: nothing left to withdraw
    const token = held.refreshTokenEnc ?? held.accessTokenEnc;
    if (!token) return;
    const prior = await this.db.txAs({ orgId: req.orgId, userId: null }, (tx) =>
      this.connections.find(tx, req.orgId),
    );
    const couldBeStored =
      prior !== null && prior !== undefined && prior.accountSub === held.accountSub;
    if (!couldBeStored) {
      await this.client.revoke(this.crypto.decrypt(token)).catch(() => undefined);
    }
  }

  private expired(): AppError {
    return new AppError(
      ERROR_CODES.GOOGLE_CONSENT_EXPIRED,
      'This Google connection took too long to confirm. Press Connect again.',
      HttpStatus.GONE,
    );
  }

  private used(): AppError {
    return new AppError(
      ERROR_CODES.GOOGLE_CONSENT_USED,
      'This Google connection was already confirmed, cancelled or refused. Press Connect to start again.',
      HttpStatus.CONFLICT,
    );
  }
}
