import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { schema } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { NotificationsRepository } from './notifications.repository';
import {
  TASK_NOTIFY_EVENTS,
  copyFor,
  dedupeKeyFor,
  recipientFor,
  type TaskEventFacts,
  type TaskNotifyEvent,
} from './task-notification-rules';

const { users } = schema;

interface TaskMeta {
  actorType?: string;
  actorId?: number | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * Turns task events into in-app notifications (TW-NOTIF-015): the assignee when a task is assigned to them, the assignee
 * (else the creator) when it falls due, the creator when someone else completes it.
 *
 * Idempotent: the notification's dedupe key is the event type plus the outbox event id, and the insert is
 * ON CONFLICT DO NOTHING on (org, user, key), so the drain's at-least-once delivery cannot notify twice while two real
 * events for the same task (assigned, reassigned, assigned back) each notify. The task is read again at delivery time
 * so a notification about a state that no longer holds (reassigned since, completed since, deleted) is dropped rather
 * than sent late.
 *
 * Runs in the worker process under the event's own tenant (RLS applies), never privileged.
 */
@Injectable()
export class TaskNotificationConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'task-notifications';
  readonly eventTypes = TASK_NOTIFY_EVENTS;
  private readonly logger = new Logger(TaskNotificationConsumer.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: NotificationsRepository,
    private readonly registry: OutboxSubscriberRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const p = event.payload;
    const meta = (p._meta ?? {}) as TaskMeta;
    const eventType = event.eventType as TaskNotifyEvent;
    const taskUuid = str(p.uuid);
    if (!taskUuid) return;

    await this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => {
      // The people the event names, plus the actor (an internal id in `_meta`), resolved in one query.
      const ids = [str(p.assigneeId), str(p.createdById)].filter((v): v is string => v !== null);
      const actorId = meta.actorType === 'user' && meta.actorId ? Number(meta.actorId) : null;
      const wanted = [
        ...(ids.length > 0 ? [inArray(users.uuid, ids)] : []),
        ...(actorId !== null ? [eq(users.id, actorId)] : []),
      ];
      if (wanted.length === 0) return;
      const found = await tx
        .select({ uuid: users.uuid, id: users.id, fullName: users.fullName, status: users.status })
        .from(users)
        .where(and(eq(users.orgId, event.orgId), or(...wanted)));
      const rows = found.map((r) => ({
        uuid: r.uuid,
        id: Number(r.id),
        full_name: r.fullName,
        status: r.status,
      }));
      const actor = actorId !== null ? rows.find((r) => Number(r.id) === actorId) : undefined;

      const facts: TaskEventFacts = {
        eventType,
        taskUuid,
        taskTitle: str(p.title) ?? '',
        dueAt: str(p.dueAt),
        assigneeUuid: str(p.assigneeId),
        createdByUuid: str(p.createdById),
        actorUuid: actor?.uuid ?? null,
      };
      const recipient = recipientFor(facts);
      if (!recipient) return;
      const user = rows.find((r) => r.uuid === recipient.userUuid);
      if (!user || user.status !== 'active') return;

      // The task as it is now: drop what is no longer true.
      const current = await tx.execute(sql`
        SELECT t.status, au.uuid::text AS assignee_uuid
        FROM tasks t LEFT JOIN users au ON au.org_id = t.org_id AND au.id = t.assignee_id
        WHERE t.org_id = ${event.orgId} AND t.uuid = ${taskUuid}::uuid
      `);
      const now = current.rows[0] as { status: string; assignee_uuid: string | null } | undefined;
      if (!now) return;
      if (eventType === 'task.due' && now.status !== 'open') return;
      if (eventType === 'task.assigned' && now.assignee_uuid !== recipient.userUuid) return;

      const copy = copyFor(recipient.type, facts.taskTitle, actor?.full_name ?? null);
      const written = await this.repo.insertOnce(tx, event.orgId, {
        userId: Number(user.id),
        type: recipient.type,
        title: copy.title,
        body: copy.body,
        link: `/tasks?task=${taskUuid}`,
        data: {
          taskId: taskUuid,
          taskTitle: facts.taskTitle,
          dueAt: facts.dueAt,
          actorName: actor?.full_name ?? null,
        },
        dedupeKey: dedupeKeyFor(eventType, event.id),
      });
      if (written) {
        this.logger.debug(
          { orgId: event.orgId, type: recipient.type, eventId: event.id },
          'task notification written',
        );
      }
    });
  }
}
