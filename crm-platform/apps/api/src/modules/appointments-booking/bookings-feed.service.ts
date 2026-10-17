import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import {
  BOOKINGS_FEED_FUTURE_DAYS,
  BOOKINGS_FEED_PAST_DAYS,
  type BookingsFeedLink,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { RbacService } from '../../kernel/rbac/rbac.service';
import { generateManageToken, hashToken, looksLikeToken } from './appointment-rules';
import { AppointmentsRepository, appointmentScopeCondition } from './appointments.repository';
import { buildIcsCalendar } from './ics';
import { BookingPublicThrottle } from './public-throttle';

export const FEED_AUDIT_MODULE = 'appointment_feed';
const DAY_MS = 86_400_000;
/** The most bookings one feed carries: a person with more than this in the window sees the nearest ones. */
const FEED_LIMIT = 2_000;
/** `last_used_at` is stamped at most this often per link, however often a calendar app polls. */
const USED_EVERY_SQL = `interval '5 minutes'`;

/**
 * A person's own bookings as a subscribable calendar (BL-035): a link they paste into Apple Calendar, Outlook or Google Calendar ("subscribe by
 * address"). The link is a 256-bit bearer token only that person holds (one per person; making a new one replaces the old at once, and ending it
 * stops the feed). Only the token's hash is a lookup key; an encrypted copy lets the person copy the link again.
 *
 * What the feed shows is decided when it is READ, not when the link is made: the person's CURRENT record scope over appointments (their own, their
 * team's or all). A person who loses the capability, or is deactivated, sees an empty (or no) feed with the same link. Each event carries the
 * booking's title, time and place and nothing else: no phone, e-mail, notes, answers or manage link, so a link that leaks (calendar apps cache the
 * feed on their own servers) leaks times and names, not contact details.
 */
@Injectable()
export class BookingsFeedService {
  private readonly logger = new Logger(BookingsFeedService.name);
  private readonly apiUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly appts: AppointmentsRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly rbac: RbacService,
    private readonly throttle: BookingPublicThrottle,
    config: ConfigService<Env, true>,
  ) {
    this.apiUrl = config.get('APP_URL', { infer: true }).replace(/\/$/, '');
  }

  // --- the signed-in person ----------------------------------------------------------------------------------------------

  async link(): Promise<BookingsFeedLink> {
    const ctx = RequestContextStore.require();
    const userId = this.me(ctx.userId);
    const row = await this.db.tx((tx) => this.find(tx, ctx.orgId, userId));
    return row ? this.linkOf(row) : { url: null, createdAt: null, lastUsedAt: null };
  }

  /** Makes the link, or replaces it with a new one (the old one stops working at once). */
  async rotate(): Promise<BookingsFeedLink> {
    const ctx = RequestContextStore.require();
    const userId = this.me(ctx.userId);
    const token = generateManageToken();
    const row = await this.db.tx(async (tx) => {
      const before = await this.find(tx, ctx.orgId, userId, true);
      const res = await tx.execute(sql`
        INSERT INTO appointment_feed_tokens (org_id, user_id, token_hash, token_enc)
        VALUES (${ctx.orgId}, ${userId}, ${hashToken(token)}, ${this.crypto.encrypt(token)})
        ON CONFLICT (org_id, user_id) DO UPDATE
          SET token_hash = EXCLUDED.token_hash, token_enc = EXCLUDED.token_enc, last_used_at = NULL
        RETURNING *`);
      const created = (res.rows as unknown as FeedRow[])[0]!;
      await this.audit.record(tx, {
        module: FEED_AUDIT_MODULE,
        recordId: Number(created.id),
        action: before ? 'update' : 'insert',
        // The token is a credential and never goes into an audit row or an event.
        delta: { link: { old: before ? 'set' : null, new: 'set' } },
      });
      await this.outbox.emit(tx, {
        orgId: ctx.orgId,
        aggregateModule: FEED_AUDIT_MODULE,
        aggregateId: Number(created.id),
        eventType: before ? 'appointment_feed.rotated' : 'appointment_feed.created',
        payload: { uuid: created.uuid, userId },
      });
      return created;
    });
    return this.linkOf(row);
  }

  async revoke(): Promise<void> {
    const ctx = RequestContextStore.require();
    const userId = this.me(ctx.userId);
    await this.db.tx(async (tx) => {
      const before = await this.find(tx, ctx.orgId, userId, true);
      if (!before) return;
      await tx.execute(
        sql`DELETE FROM appointment_feed_tokens WHERE org_id = ${ctx.orgId} AND id = ${before.id}`,
      );
      await this.audit.record(tx, {
        module: FEED_AUDIT_MODULE,
        recordId: Number(before.id),
        action: 'delete',
        delta: { link: { old: 'set', new: null } },
      });
      await this.outbox.emit(tx, {
        orgId: ctx.orgId,
        aggregateModule: FEED_AUDIT_MODULE,
        aggregateId: Number(before.id),
        eventType: 'appointment_feed.revoked',
        payload: { uuid: before.uuid, userId },
      });
    });
  }

  // --- the calendar app (no login: the token is the credential) --------------------------------------------------------

  /** The `.ics` of the person's bookings. An unknown, revoked or malformed link is the same 404, and costs no query when it is malformed. */
  async render(file: string): Promise<string> {
    const ctx = RequestContextStore.require();
    const token = file.replace(/\.ics$/i, '');
    await this.throttle.check('feed', ctx.ip, token, true);
    if (!looksLikeToken(token) || !/\.ics$/i.test(file)) throw AppError.notFound('Calendar feed');
    const hit = await this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT t.org_id, t.user_id, o.name AS org_name FROM appointment_feed_tokens t
          JOIN users u ON u.org_id = t.org_id AND u.id = t.user_id AND u.status = 'active'
          JOIN organizations o ON o.id = t.org_id
         WHERE t.token_hash = ${hashToken(token)}`);
      return (
        res.rows as Array<{ org_id: number | string; user_id: number | string; org_name: string }>
      )[0];
    });
    if (!hit) throw AppError.notFound('Calendar feed');
    const orgId = Number(hit.org_id);
    const userId = Number(hit.user_id);
    ctx.orgId = orgId;
    ctx.userId = userId;

    const grants = await this.rbac.grantsForUser(orgId, userId);
    const allowed = this.rbac.can(grants, 'record.appointments.read');
    const now = Date.now();
    const rows = allowed.allowed
      ? await this.db.tx((tx) =>
          this.appts.list(tx, orgId, {
            filter: {
              from: new Date(now - BOOKINGS_FEED_PAST_DAYS * DAY_MS),
              to: new Date(now + BOOKINGS_FEED_FUTURE_DAYS * DAY_MS),
            },
            scope: appointmentScopeCondition(orgId, allowed.scope, userId),
            window: 'all',
            status: ['pending', 'confirmed'],
            order: 'asc',
            limit: FEED_LIMIT,
          }),
        )
      : [];
    // Stamped at most every few minutes however often the app polls.
    void this.db
      .txAs({ orgId, userId: null }, (tx) =>
        tx.execute(sql`
          UPDATE appointment_feed_tokens SET last_used_at = now()
           WHERE org_id = ${orgId} AND user_id = ${userId}
             AND (last_used_at IS NULL OR last_used_at < now() - ${sql.raw(USED_EVERY_SQL)})`),
      )
      .catch((err: unknown) => this.logger.debug({ err }, 'could not stamp the feed link as used'));

    return buildIcsCalendar(
      rows.map((r) => ({
        uid: `${r.uuid}@appointments`,
        title: r.title,
        location: r.meetUrl ?? r.location,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        status: r.status,
        sequence: r.rowVersion,
        stampedAt: r.updatedAt,
      })),
      { name: `${hit.org_name} bookings`, refreshMinutes: 15 },
    );
  }

  // --- internals -------------------------------------------------------------------------------------------------------

  private me(userId: number | null): number {
    if (userId === null) throw AppError.unauthenticated();
    return userId;
  }

  private async find(
    tx: Tx,
    orgId: number,
    userId: number,
    lock = false,
  ): Promise<FeedRow | undefined> {
    const res = await tx.execute(
      sql`SELECT * FROM appointment_feed_tokens WHERE org_id = ${orgId} AND user_id = ${userId} ${lock ? sql`FOR UPDATE` : sql``}`,
    );
    return (res.rows as unknown as FeedRow[])[0];
  }

  private linkOf(row: FeedRow): BookingsFeedLink {
    return {
      url: `${this.apiUrl}/v2/public/appointments/feed/${this.crypto.decrypt(row.token_enc)}.ics`,
      createdAt: new Date(row.created_at).toISOString(),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
    };
  }
}

interface FeedRow {
  id: number | string;
  uuid: string;
  token_enc: string;
  created_at: string | Date;
  last_used_at: string | Date | null;
}
