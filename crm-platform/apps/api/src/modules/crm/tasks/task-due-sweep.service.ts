import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../../infra/db/database.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { TASK_MODULE } from './tasks.service';

const BATCH = 200;

/**
 * The due-reminder sweep (WD-TASK-010): the hook point a notification consumer subscribes to. Every minute it claims open tasks
 * whose due time has passed and that were never reminded, stamps `reminded_at` and writes one `task.due` event per task, all in
 * one transaction, so a task is reminded once however many workers run and a crash between the stamp and the event cannot
 * happen. Reopening a task or moving its due date clears the stamp (the API does that), which arms it again.
 *
 * What WaDesk did on the inbox poll (and only when someone had the inbox open) is a job here; WaDesk stamped even when nobody
 * could be told, and so does this: the event carries the assignee (or the creator when there is none) and the consumer decides.
 *
 * Runs privileged: it spans every workspace by definition (one of the sanctioned uses). Imported by WorkersModule only.
 */
@Injectable()
export class TaskDueSweepService {
  private readonly logger = new Logger(TaskDueSweepService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
  ) {}

  @Interval(60_000)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.sweep();
      if (n > 0) this.logger.debug({ reminded: n }, 'task due sweep');
    } catch (err) {
      this.logger.error({ err }, 'task due sweep failed');
    } finally {
      this.running = false;
    }
  }

  /** One pass. Returns how many tasks were stamped and announced. */
  async sweep(limit = BATCH): Promise<number> {
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        WITH claimed AS (
          SELECT id, org_id FROM tasks
          WHERE status = 'open' AND reminded_at IS NULL AND due_at IS NOT NULL AND due_at <= now()
          ORDER BY due_at, id
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        ), stamped AS (
          UPDATE tasks t SET reminded_at = now()
          FROM claimed WHERE t.org_id = claimed.org_id AND t.id = claimed.id
          RETURNING t.org_id, t.id, t.uuid, t.title, t.priority, t.due_at, t.assignee_id, t.created_by,
                    t.contact_id, t.deal_id, t.company_id, t.source
        ), linked AS (
          UPDATE deal_activities a SET reminded_at = now()
          FROM stamped s WHERE a.org_id = s.org_id AND a.task_id = s.id
          RETURNING a.id
        )
        SELECT s.org_id, s.id, s.uuid, s.title, s.priority, s.due_at, s.source,
               au.uuid AS assignee_uuid, cu.uuid AS created_by_uuid,
               c.uuid AS contact_uuid, d.uuid AS deal_uuid, co.uuid AS company_uuid,
               (SELECT count(*) FROM linked) AS linked_rows
        FROM stamped s
        LEFT JOIN users au ON au.org_id = s.org_id AND au.id = s.assignee_id
        LEFT JOIN users cu ON cu.org_id = s.org_id AND cu.id = s.created_by
        LEFT JOIN contacts c ON c.org_id = s.org_id AND c.id = s.contact_id
        LEFT JOIN deals d ON d.org_id = s.org_id AND d.id = s.deal_id
        LEFT JOIN companies co ON co.org_id = s.org_id AND co.id = s.company_id
      `);
      for (const r of res.rows as Array<Record<string, unknown>>) {
        await this.outbox.emit(tx, {
          orgId: Number(r.org_id),
          aggregateModule: TASK_MODULE,
          aggregateId: Number(r.id),
          eventType: 'task.due',
          payload: {
            uuid: r.uuid,
            title: r.title,
            priority: r.priority,
            dueAt: r.due_at ? new Date(r.due_at as string).toISOString() : null,
            assigneeId: r.assignee_uuid ?? null,
            // Who to tell when nobody is assigned (WaDesk's fallback).
            createdById: r.created_by_uuid ?? null,
            contactId: r.contact_uuid ?? null,
            dealId: r.deal_uuid ?? null,
            companyId: r.company_uuid ?? null,
            source: r.source,
          },
        });
      }
      return res.rows.length;
    });
  }
}
