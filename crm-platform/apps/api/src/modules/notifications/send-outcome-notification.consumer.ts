import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { NotificationFanout } from './notification-fanout';
import {
  SEND_OUTCOME_EVENTS,
  outcomeCopy,
  outcomeRecipients,
  sendKindOf,
  sendOutcomeFor,
  sendOutcomeKey,
  type SendKind,
} from './phase2-notification-rules';

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : undefined;

interface SendFacts {
  name: string | null;
  creatorUserId: number | null;
  total?: number;
  sent?: number;
  failed?: number;
}

const SUBJECT_KIND: Record<SendKind, string> = {
  broadcast: 'broadcast',
  campaign: 'campaign',
  scheduled_message: 'scheduled_message',
};
const LINK: Record<SendKind, (uuid: string) => string> = {
  broadcast: (u) => `/broadcasts/${u}`,
  campaign: (u) => `/campaigns/${u}`,
  scheduled_message: (u) => `/scheduled/${u}`,
};

/**
 * Tells the person who started a broadcast, a campaign or a scheduled message that it finished or failed (catalogue row 9), and for a
 * failure the workspace admins too:
 *
 *   broadcast.status_changed    completed, completed_with_errors -> broadcast_completed; failed -> broadcast_failed
 *   campaign.status_updated     completed -> campaign_completed; failed -> campaign_failed
 *   scheduled.status_changed    completed -> scheduled_completed; failed -> scheduled_failed (a new event of the scheduled-message
 *                               runner: it had none)
 *
 * Every other status (running, paused, cancelled...) says nothing. The record is read again at delivery for its name, its creator and its
 * counts; one that was deleted since is dropped. The workspace toggles map as the spec says (completed -> `broadcast_completed` /
 * `campaign_completed`, failed -> `campaign_failed`) and the person's own preference decides the rest. The key carries the status and the
 * outbox event id, so a redelivery writes nothing twice while a retried broadcast that finishes again notifies again.
 */
@Injectable()
export class SendOutcomeNotificationConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'send-outcome-notifications';
  readonly eventTypes = SEND_OUTCOME_EVENTS;
  private readonly logger = new Logger(SendOutcomeNotificationConsumer.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly registry: OutboxSubscriberRegistry,
    private readonly fanout: NotificationFanout,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const kind = sendKindOf(event.eventType);
    const uuid = str(event.payload.uuid);
    const status = str(event.payload.status);
    if (!kind || !uuid || !status) return;
    const type = sendOutcomeFor(kind, status);
    if (!type) return;

    const pending = await this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => {
      const facts = await this.facts(tx, event, kind, uuid);
      if (!facts) return [];
      const admins = type.endsWith('_failed') ? await this.adminIds(tx, event.orgId) : [];
      const activeCreator = await this.activeUser(tx, event.orgId, facts.creatorUserId);
      const userIds = outcomeRecipients(type, activeCreator, admins);
      if (userIds.length === 0) return [];

      const reason = str(event.payload.reason) ?? str(event.payload.failureReason);
      const copy = outcomeCopy(kind, type, facts.name, { ...facts, reason });
      // One unread row per record and outcome: a campaign that finishes again before the bell was read updates the row (newest counts,
      // moved to the top) instead of stacking a copy. Once read, the next finish writes a fresh row.
      return this.fanout.writeCollapsing(tx, event.orgId, type, userIds, () => ({
        link: LINK[kind](uuid),
        dedupeKey: sendOutcomeKey(kind, uuid, status, event.id),
        collapseKey: `send:${kind}:${uuid}:${type}`,
        adds: 1,
        eventId: Number(event.id),
        subjectKind: SUBJECT_KIND[kind],
        subjectUuid: uuid,
        build: (count) => ({
          title: copy.title,
          body: copy.body,
          data: {
            kind,
            id: uuid,
            name: facts.name,
            status,
            total: facts.total,
            sent: facts.sent,
            failed: facts.failed,
            reason: reason ? reason.slice(0, 200) : null,
            runs: count,
          },
        }),
      }));
    });
    await this.fanout.publish(event.orgId, pending);
    if (pending.length > 0) {
      this.logger.debug({ orgId: event.orgId, type, count: pending.length }, 'send outcome told');
    }
  }

  /** The record as it is now (its name, its creator, its counts); null when it is gone. */
  private async facts(
    tx: Tx,
    event: OutboxEvent,
    kind: SendKind,
    uuid: string,
  ): Promise<SendFacts | null> {
    const orgId = event.orgId;
    if (kind === 'broadcast') {
      const res = await tx.execute(sql`
        SELECT name, user_id, total_recipients, success_count, fail_count FROM broadcasts
        WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`);
      const r = res.rows[0] as
        | {
            name: string;
            user_id: string | number | null;
            total_recipients: number;
            success_count: number;
            fail_count: number;
          }
        | undefined;
      return r
        ? {
            name: r.name,
            creatorUserId: r.user_id === null ? null : Number(r.user_id),
            total: Number(r.total_recipients),
            sent: Number(r.success_count),
            failed: Number(r.fail_count),
          }
        : null;
    }
    if (kind === 'campaign') {
      const res = await tx.execute(sql`
        SELECT campaign_name AS name, created_by, total_recipients, sent_count, failed_count FROM wpcampaigns
        WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`);
      const r = res.rows[0] as
        | {
            name: string;
            created_by: string | number | null;
            total_recipients: number;
            sent_count: number;
            failed_count: number;
          }
        | undefined;
      return r
        ? {
            name: r.name,
            creatorUserId: r.created_by === null ? null : Number(r.created_by),
            total: Number(r.total_recipients),
            sent: Number(r.sent_count),
            failed: Number(r.failed_count),
          }
        : null;
    }
    const res = await tx.execute(sql`
      SELECT schedule_name, user_id FROM scheduled_messages
      WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`);
    const r = res.rows[0] as { schedule_name: string; user_id: string | number | null } | undefined;
    if (!r) return null;
    return {
      name: r.schedule_name,
      creatorUserId: r.user_id === null ? null : Number(r.user_id),
      sent: num(event.payload.sent),
      failed: num(event.payload.failed),
    };
  }

  private async adminIds(tx: Tx, orgId: number): Promise<number[]> {
    const res = await tx.execute(sql`
      SELECT DISTINCT u.id FROM users u
      JOIN user_roles ur ON ur.org_id = u.org_id AND ur.user_id = u.id
      JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id
      WHERE u.org_id = ${orgId} AND u.status = 'active' AND r.system_key = 'admin'`);
    return (res.rows as Array<{ id: string | number }>).map((r) => Number(r.id));
  }

  /** The creator's id when they are still an active member, else null (a removed person is not notified). */
  private async activeUser(tx: Tx, orgId: number, userId: number | null): Promise<number | null> {
    if (userId === null) return null;
    const res = await tx.execute(
      sql`SELECT id FROM users WHERE org_id = ${orgId} AND id = ${userId} AND status = 'active'`,
    );
    return res.rows.length > 0 ? userId : null;
  }
}
