import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { MEMBER_LEAVE_ENDED, MEMBER_LEAVE_STARTED } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../../infra/db/database.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';

const BATCH = 200;

type Raw = Record<string, unknown>;

/** The workspace's today as SQL: its own zone, UTC when it has none or names one Postgres does not know. */
const TODAY = sql`(now() AT TIME ZONE coalesce(
  (SELECT n.name FROM pg_timezone_names n WHERE n.name = o.settings ->> 'timezone'), 'UTC'))::date`;

/**
 * The leave sweep (BL-112): flips `member_leaves.status` when a leave's first day arrives (scheduled -> active, announced with
 * `member.leave.started`) and when its last day has passed (active -> ended, `member.leave.ended`), each IN THE WORKSPACE'S OWN
 * CALENDAR. Routing never waits for it (it derives "away" from the dates), so a late run delays only the announcement and the notice
 * to the leads.
 *
 * Each change and its outbox event are one transaction, claimed with `FOR UPDATE SKIP LOCKED`: however many workers run, a leave is
 * announced once, and a crash between the status and the event cannot happen. A leave whose whole window passed while the worker was
 * down is started and ended in the same pass, in that order.
 *
 * Runs privileged: it spans every workspace by definition (a sanctioned use). Imported by WorkersModule only.
 */
@Injectable()
export class LeaveSweepService {
  private readonly logger = new Logger(LeaveSweepService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
  ) {}

  @Interval(300_000)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.sweep();
      if (r.started + r.ended > 0) this.logger.debug(r, 'leave sweep');
    } catch (err) {
      this.logger.error({ err }, 'leave sweep failed');
    } finally {
      this.running = false;
    }
  }

  /** One pass. Returns how many leaves started and ended. */
  async sweep(limit = BATCH): Promise<{ started: number; ended: number }> {
    return this.db.privileged(async (tx) => {
      const started = await this.start(tx, limit);
      const ended = await this.finish(tx, limit);
      return { started, ended };
    });
  }

  private async start(tx: Tx, limit: number): Promise<number> {
    const res = await tx.execute(sql`
      WITH claimed AS (
        SELECT l.org_id, l.id FROM member_leaves l JOIN organizations o ON o.id = l.org_id
        WHERE l.status = 'scheduled' AND l.starts_on <= ${TODAY}
        ORDER BY l.starts_on, l.id LIMIT ${limit}
        FOR UPDATE OF l SKIP LOCKED
      ), flipped AS (
        UPDATE member_leaves t SET status = 'active', started_at = now()
        FROM claimed WHERE t.org_id = claimed.org_id AND t.id = claimed.id
        RETURNING t.org_id, t.id, t.uuid, t.user_id, t.starts_on, t.ends_on
      )
      SELECT f.org_id, f.id, f.uuid, f.user_id, f.starts_on::text AS starts_on, f.ends_on::text AS ends_on,
             u.uuid AS user_uuid, u.full_name AS user_name,
             coalesce(o.settings ->> 'timezone', 'UTC') AS timezone,
             (SELECT count(*)::int FROM contacts c WHERE c.org_id = f.org_id AND c.owner_id = f.user_id) AS contacts,
             (SELECT count(*)::int FROM conversations c WHERE c.org_id = f.org_id AND c.assignee_user_id = f.user_id
                AND c.archived = FALSE AND c.status = 'open') AS conversations,
             (SELECT du.uuid FROM member_delegates d JOIN users du ON du.org_id = d.org_id AND du.id = d.delegate_user_id
               WHERE d.org_id = f.org_id AND d.user_id = f.user_id) AS delegate_uuid
      FROM flipped f JOIN users u ON u.org_id = f.org_id AND u.id = f.user_id
      JOIN organizations o ON o.id = f.org_id`);
    for (const r of res.rows as Raw[]) {
      const orgId = Number(r.org_id);
      const userId = Number(r.user_id);
      await tx.execute(sql`
        INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta)
        VALUES (${orgId}, NULL, 'system', 'members', ${userId}, 'member.leave.started',
                ${JSON.stringify({ startsOn: { old: null, new: r.starts_on }, endsOn: { old: null, new: r.ends_on } })}::jsonb)`);
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: 'members',
        aggregateId: userId,
        eventType: MEMBER_LEAVE_STARTED,
        payload: {
          leaveId: r.uuid,
          memberId: r.user_uuid,
          memberUserId: userId,
          memberName: r.user_name,
          startsOn: r.starts_on,
          endsOn: r.ends_on,
          timezone: r.timezone,
          ownedContacts: Number(r.contacts),
          openConversations: Number(r.conversations),
          delegateId: r.delegate_uuid ?? null,
        },
      });
    }
    return res.rows.length;
  }

  private async finish(tx: Tx, limit: number): Promise<number> {
    const res = await tx.execute(sql`
      WITH claimed AS (
        SELECT l.org_id, l.id FROM member_leaves l JOIN organizations o ON o.id = l.org_id
        WHERE l.status = 'active' AND l.ends_on IS NOT NULL AND l.ends_on < ${TODAY}
        ORDER BY l.ends_on, l.id LIMIT ${limit}
        FOR UPDATE OF l SKIP LOCKED
      ), flipped AS (
        UPDATE member_leaves t SET status = 'ended', ended_at = now()
        FROM claimed WHERE t.org_id = claimed.org_id AND t.id = claimed.id
        RETURNING t.org_id, t.id, t.uuid, t.user_id, t.starts_on, t.ends_on
      )
      SELECT f.org_id, f.uuid, f.user_id, f.starts_on::text AS starts_on, f.ends_on::text AS ends_on, u.uuid AS user_uuid,
             coalesce(o.settings ->> 'timezone', 'UTC') AS timezone
      FROM flipped f JOIN users u ON u.org_id = f.org_id AND u.id = f.user_id
      JOIN organizations o ON o.id = f.org_id`);
    for (const r of res.rows as Raw[]) {
      const orgId = Number(r.org_id);
      const userId = Number(r.user_id);
      await tx.execute(sql`
        INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta)
        VALUES (${orgId}, NULL, 'system', 'members', ${userId}, 'member.leave.ended',
                ${JSON.stringify({ status: { old: 'active', new: 'ended' } })}::jsonb)`);
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: 'members',
        aggregateId: userId,
        eventType: MEMBER_LEAVE_ENDED,
        payload: {
          leaveId: r.uuid,
          memberId: r.user_uuid,
          memberUserId: userId,
          startsOn: r.starts_on,
          endsOn: r.ends_on,
          timezone: r.timezone,
          early: false,
        },
      });
    }
    return res.rows.length;
  }
}
