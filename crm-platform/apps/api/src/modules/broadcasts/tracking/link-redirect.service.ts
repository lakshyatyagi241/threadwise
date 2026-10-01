import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { BroadcastProgressService } from '../broadcast-progress.service';
import { clickWebhook } from '../webhook-events';
import { isBot, isTokenShape } from './link-rules';

const IP_UNIQUE_SECONDS = 3600;
/** A link-preview crawler can hit one link many times at once; this only stops a flood from one address. */
const HITS_PER_MINUTE = 600;

interface Link {
  link_id: number | string;
  link_org_id: number | string;
  original_url: string;
  expires_at: Date | string | null;
}

/**
 * The public tracked-link redirect (WD-BCAST-018).
 *
 * The token names the tenant, and the row that does is behind row-level security, so the first lookup goes through a narrow
 * SECURITY DEFINER function (migration 20261002110200) that returns four columns for one token. The click itself is then
 * recorded under the normal tenant context.
 */
@Injectable()
export class LinkRedirectService {
  private readonly logger = new Logger(LinkRedirectService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
    private readonly progress: BroadcastProgressService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** The address to send the visitor to; throws 404 for an unknown token and 410 for an expired one. */
  async go(token: string, ip: string, userAgent: string): Promise<string> {
    if (!isTokenShape(token)) throw AppError.notFound('Link');
    await this.rateLimit(ip);

    const res = await this.db.primary.execute(sql`SELECT * FROM bcast_link_lookup(${token})`);
    const link = res.rows[0] as unknown as Link | undefined;
    if (!link) throw AppError.notFound('Link');
    if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
      throw new AppError(ERROR_CODES.BCAST_LINK_EXPIRED, 'Link expired', HttpStatus.GONE);
    }

    if (!isBot(userAgent)) {
      try {
        await this.record(Number(link.link_org_id), Number(link.link_id), ip, userAgent);
      } catch (err) {
        // A failed count must never stop the visitor from reaching the page.
        this.logger.warn({ err: String(err) }, '[BCAST] click could not be recorded');
      }
    }
    return link.original_url;
  }

  private async rateLimit(ip: string): Promise<void> {
    try {
      const key = `link_hits:${ip}:${Math.floor(Date.now() / 60_000)}`;
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.expire(key, 120);
      if (n > HITS_PER_MINUTE)
        throw new AppError(
          ERROR_CODES.RATE_LIMITED,
          'Too many requests',
          HttpStatus.TOO_MANY_REQUESTS,
        );
    } catch (err) {
      if (err instanceof AppError) throw err;
      // Redis down: the redirect keeps working, unthrottled.
    }
  }

  /** Is this the first hit from this address on this link in the last hour? */
  private async ipIsNew(linkId: number, ip: string): Promise<boolean> {
    try {
      return (
        (await this.redis.set(
          `link_click_ip:${linkId}:${ip}`,
          '1',
          'EX',
          IP_UNIQUE_SECONDS,
          'NX',
        )) === 'OK'
      );
    } catch {
      return false;
    }
  }

  private async record(
    orgId: number,
    linkId: number,
    ip: string,
    userAgent: string,
  ): Promise<void> {
    const ipNew = await this.ipIsNew(linkId, ip);
    await this.db.txAs({ orgId }, async (tx) => {
      const link = await tx.execute(sql`
        SELECT broadcast_id, contact_id FROM wa_link_clicks WHERE org_id = ${orgId} AND id = ${linkId} FOR UPDATE`);
      const row = link.rows[0] as
        { broadcast_id: number | string | null; contact_id: number | string | null } | undefined;
      if (!row) return;
      const broadcastId = row.broadcast_id === null ? null : Number(row.broadcast_id);
      const contactId = row.contact_id === null ? null : Number(row.contact_id);

      // The broadcast counts contacts who clicked, not clicks. Two taps at once must not both be "the first": serialise on
      // the contact, then look at what they had before this tap.
      let firstForContact = false;
      if (broadcastId !== null && contactId !== null) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`bcast-click:${orgId}:${broadcastId}:${contactId}`}, 0))`,
        );
        const prior = await tx.execute(sql`
          SELECT coalesce(sum(clicks), 0)::int AS n FROM wa_link_clicks
          WHERE org_id = ${orgId} AND broadcast_id = ${broadcastId} AND contact_id = ${contactId}`);
        firstForContact = Number((prior.rows[0] as { n: number }).n) === 0;
      }

      await tx.execute(sql`
        UPDATE wa_link_clicks SET clicks = clicks + 1,
          unique_clicks = unique_clicks + ${ipNew ? 1 : 0},
          first_click_at = coalesce(first_click_at, now()), last_click_at = now(),
          last_ip = left(${ip}, 45), last_user_agent = left(${userAgent}, 191)
        WHERE org_id = ${orgId} AND id = ${linkId}`);

      if (broadcastId === null || contactId === null) return;
      if (firstForContact) {
        await tx.execute(
          sql`UPDATE broadcasts SET clicked_count = clicked_count + 1 WHERE org_id = ${orgId} AND id = ${broadcastId}`,
        );
      }
      const who = await tx.execute(sql`
        SELECT c.uuid AS contact_uuid, l.phone, l.original_url, l.token, t.uuid AS template_uuid
        FROM wa_link_clicks l
        JOIN contacts c ON c.org_id = l.org_id AND c.id = l.contact_id
        LEFT JOIN wa_templates t ON t.org_id = l.org_id AND t.id = l.template_id
        WHERE l.org_id = ${orgId} AND l.id = ${linkId}`);
      const w = who.rows[0] as
        | {
            contact_uuid: string;
            phone: string | null;
            original_url: string;
            token: string;
            template_uuid: string | null;
          }
        | undefined;
      const snap = w ? await this.progress.snapshot(tx, orgId, broadcastId) : null;
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: 'broadcasts',
        aggregateId: broadcastId,
        eventType: 'broadcast.link_clicked',
        payload: {
          contactId,
          linkId,
          unique: ipNew,
          webhook:
            w && snap
              ? clickWebhook(snap, {
                  campaignId: null,
                  messageId: null,
                  contactUuid: w.contact_uuid,
                  templateUuid: w.template_uuid,
                  phone: w.phone,
                  originalUrl: w.original_url,
                  token: w.token,
                  ip,
                  userAgent,
                  at: new Date(),
                })
              : [],
        },
      });
    });
  }
}
