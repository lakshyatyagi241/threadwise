import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { SlaKind } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { channelOwnerSql } from '../../realtime';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { ConversationEventsRepository, InboxRealtimePublisher } from '../team-inbox-conversations';
import { SLA_PLAN_FEATURE } from './sla-clock.service';

const BATCH = 200;
/** The outbox event the notification consumer listens for (kept in step with `sla-notification.consumer.ts`). */
export const SLA_BREACH_EVENT = 'conversation.sla_breached';

type Raw = Record<string, unknown>;

interface Touched {
  orgId: number;
  uuid: string;
  rowVersion: number;
  assigneeUserId: number | null;
  assigneeTeamId: number | null;
  channelOwnerUserId: number | null;
}

export interface SweepResult {
  answered: number;
  breached: number;
}

/**
 * Keeps the response clocks honest, once a minute, for every workspace whose plan has `inbox_sla` (TW-TIB2-028):
 *
 *  1. A first-response clock whose customer has been answered (`waiting_since` is clear) is closed: the due time is cleared and a
 *     `first_response` event records whether the answer came in time. An answer after the due time is a breach (flagged, announced).
 *  2. A live conversation (open) whose first-response clock (customer
 *     still waiting) or resolution clock ran out, and is not flagged yet, is flagged `sla_breached`, gets a `sla_breach` event
 *     (`kind`, `dueAt`) and the outbox event `conversation.sla_breached`, which the notification consumer turns into bell rows. A snoozed,
 *     resolved, closed or spam conversation is skipped: a snoozed one is checked after it wakes.
 *
 * One flag per conversation cycle: a breach is announced once. Safe on every worker at once (`SKIP LOCKED`) and safe to repeat.
 * Imported by the worker only.
 */
@Injectable()
export class SlaSweepService {
  private readonly logger = new Logger(SlaSweepService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly events: ConversationEventsRepository,
    private readonly outbox: OutboxService,
    private readonly publisher: InboxRealtimePublisher,
    private readonly entitlements: PlanEntitlementService,
  ) {}

  @Interval(60_000)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.sweep();
      if (r.answered + r.breached > 0) this.logger.log(r, 'sla sweep');
    } catch (err) {
      this.logger.error({ err }, 'sla sweep failed');
    } finally {
      this.running = false;
    }
  }

  async sweep(): Promise<SweepResult> {
    const orgs = await this.orgsWithWork();
    if (orgs.length === 0) return { answered: 0, breached: 0 };
    const touched: Touched[] = [];
    const inOrgs = sql.join(
      orgs.map((o) => sql`${o}`),
      sql`, `,
    );
    const result = await this.db.privileged(async (tx) => {
      const answered = await this.closeAnswered(tx, inOrgs, touched);
      const breached = await this.flagBreaches(tx, inOrgs, touched);
      return { answered, breached };
    });
    for (const t of touched) {
      await this.publisher.conversationChanged(
        t.orgId,
        {
          uuid: t.uuid,
          rowVersion: t.rowVersion,
          assigneeUserId: t.assigneeUserId,
          assigneeTeamId: t.assigneeTeamId,
          channelOwnerUserId: t.channelOwnerUserId,
        },
        ['sla'],
      );
    }
    return result;
  }

  /** Workspaces that have a clock to look at and the plan to use it (one plan lookup per workspace, not per conversation). */
  private async orgsWithWork(): Promise<number[]> {
    const res = await this.db.privileged((tx) =>
      tx.execute(sql`
        SELECT DISTINCT org_id FROM conversations
        WHERE (sla_first_response_due IS NOT NULL OR sla_resolution_due IS NOT NULL) AND NOT sla_breached
           OR (sla_first_response_due IS NOT NULL AND waiting_since IS NULL)`),
    );
    const out: number[] = [];
    for (const r of res.rows as Raw[]) {
      const orgId = Number(r.org_id);
      if (await this.entitlements.featureEnabled(orgId, SLA_PLAN_FEATURE)) out.push(orgId);
    }
    return out;
  }

  private async closeAnswered(tx: Tx, inOrgs: SQL, touched: Touched[]): Promise<number> {
    const res = await tx.execute(sql`
      SELECT c.id, c.org_id, c.uuid, c.sla_first_response_due AS due,
             COALESCE(c.last_outbound_at, c.first_response_at, now()) AS answered_at
      FROM conversations c
      WHERE c.org_id IN (${inOrgs}) AND c.sla_first_response_due IS NOT NULL AND c.waiting_since IS NULL
      ORDER BY c.id LIMIT ${BATCH} FOR UPDATE OF c SKIP LOCKED`);
    let late = 0;
    for (const r of res.rows as Raw[]) {
      const orgId = Number(r.org_id);
      const id = Number(r.id);
      const due = new Date(String(r.due));
      const answeredAt = new Date(String(r.answered_at));
      const within = answeredAt.getTime() <= due.getTime();
      await tx.execute(
        sql`UPDATE conversations SET sla_first_response_due = NULL WHERE org_id = ${orgId} AND id = ${id}`,
      );
      await this.events.append(tx, orgId, {
        conversationId: id,
        type: 'first_response',
        actorKind: 'system',
        payload: { withinSla: within, dueAt: due.toISOString(), at: answeredAt.toISOString() },
      });
      if (!within && (await this.flag(tx, orgId, id, 'first_response', due))) late += 1;
      await this.track(tx, orgId, id, touched);
    }
    return late;
  }

  private async flagBreaches(tx: Tx, inOrgs: SQL, touched: Touched[]): Promise<number> {
    const res = await tx.execute(sql`
      SELECT c.id, c.org_id,
             (c.sla_first_response_due <= now() AND c.waiting_since IS NOT NULL) AS first_due,
             c.sla_first_response_due AS first_at, c.sla_resolution_due AS resolution_at
      FROM conversations c
      WHERE c.org_id IN (${inOrgs}) AND NOT c.sla_breached AND c.status = 'open'
        AND ((c.sla_first_response_due <= now() AND c.waiting_since IS NOT NULL) OR c.sla_resolution_due <= now())
      ORDER BY c.id LIMIT ${BATCH} FOR UPDATE OF c SKIP LOCKED`);
    let n = 0;
    for (const r of res.rows as Raw[]) {
      const orgId = Number(r.org_id);
      const id = Number(r.id);
      const kind: SlaKind = r.first_due === true ? 'first_response' : 'resolution';
      const due = new Date(String(kind === 'first_response' ? r.first_at : r.resolution_at));
      if (await this.flag(tx, orgId, id, kind, due)) {
        n += 1;
        await this.track(tx, orgId, id, touched);
      }
    }
    return n;
  }

  /** Sets the flag once; false when it was already set. */
  private async flag(
    tx: Tx,
    orgId: number,
    id: number,
    kind: SlaKind,
    due: Date,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE conversations SET sla_breached = true
      WHERE org_id = ${orgId} AND id = ${id} AND NOT sla_breached
      RETURNING uuid`);
    const row = (res.rows as Raw[])[0];
    if (!row) return false;
    await this.events.append(tx, orgId, {
      conversationId: id,
      type: 'sla_breach',
      actorKind: 'system',
      payload: { kind, dueAt: due.toISOString() },
    });
    await this.outbox.emit(tx, {
      orgId,
      aggregateModule: 'conversations',
      aggregateId: id,
      eventType: SLA_BREACH_EVENT,
      payload: { conversationId: String(row.uuid), kind, dueAt: due.toISOString() },
    });
    return true;
  }

  private async track(tx: Tx, orgId: number, id: number, touched: Touched[]): Promise<void> {
    const res = await tx.execute(sql`
      SELECT c.uuid, c.row_version, c.assignee_user_id, c.assignee_team_id,
             ${channelOwnerSql('c')} AS channel_owner
      FROM conversations c WHERE c.org_id = ${orgId} AND c.id = ${id}`);
    const r = (res.rows as Raw[])[0];
    if (!r) return;
    touched.push({
      orgId,
      uuid: String(r.uuid),
      rowVersion: Number(r.row_version),
      assigneeUserId: r.assignee_user_id === null ? null : Number(r.assignee_user_id),
      assigneeTeamId: r.assignee_team_id === null ? null : Number(r.assignee_team_id),
      channelOwnerUserId:
        r.channel_owner === null || r.channel_owner === undefined ? null : Number(r.channel_owner),
    });
  }
}
