import type { NotificationType } from '@crm/contracts';

/** The task events that notify someone. `task.created` is not one: an assignment on creation emits `task.assigned` too. */
export const TASK_NOTIFY_EVENTS = ['task.assigned', 'task.due', 'task.completed'] as const;
export type TaskNotifyEvent = (typeof TASK_NOTIFY_EVENTS)[number];

/** What the outbox event says, reduced to what the rules need (ids are the uuids the payload carries). */
export interface TaskEventFacts {
  eventType: TaskNotifyEvent;
  taskUuid: string;
  taskTitle: string;
  dueAt: string | null;
  assigneeUuid: string | null;
  createdByUuid: string | null;
  /** The user who caused the event; null when the system did (the due sweep, an API key). */
  actorUuid: string | null;
}

export interface Recipient {
  userUuid: string;
  type: NotificationType;
}

/**
 * Who is told, if anyone (TW-NOTIF-015 rules 4 and 5, plus completion):
 *  - assigned: the new assignee, unless they assigned it to themselves;
 *  - due: the assignee, else the creator (Reference's fallback);
 *  - completed: the creator, unless they completed it themselves.
 */
export function recipientFor(f: TaskEventFacts): Recipient | null {
  switch (f.eventType) {
    case 'task.assigned':
      return f.assigneeUuid && f.assigneeUuid !== f.actorUuid
        ? { userUuid: f.assigneeUuid, type: 'task_assigned' }
        : null;
    case 'task.due': {
      const who = f.assigneeUuid ?? f.createdByUuid;
      return who ? { userUuid: who, type: 'task_due' } : null;
    }
    case 'task.completed':
      return f.createdByUuid && f.createdByUuid !== f.actorUuid
        ? { userUuid: f.createdByUuid, type: 'task_completed' }
        : null;
  }
}

/** Plain text, at most `max` characters (Reference stripped tags and cut the body at 200). */
export function plainText(value: string, max = 200): string {
  const text = value
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The server's English wording, stored as the fallback; the web client words known types in the viewer's language from
 * `data` (so these strings are what a client sees only for a type it has no message for).
 */
export function copyFor(
  type: NotificationType,
  taskTitle: string,
  actorName: string | null,
): { title: string; body: string } {
  const task = plainText(taskTitle, 160);
  switch (type) {
    case 'task_assigned':
      return {
        title: 'Task assigned to you',
        body: actorName ? `${plainText(actorName, 60)} assigned you: ${task}` : task,
      };
    case 'task_due':
      return { title: 'Task due', body: task };
    case 'task_completed':
      return {
        title: 'Task completed',
        body: actorName ? `${plainText(actorName, 60)} completed: ${task}` : task,
      };
  }
}

/** One key per event and person: a redelivery of the same event collides, a later real event does not. */
export const dedupeKeyFor = (eventType: string, eventId: string): string =>
  `${eventType}:${eventId}`;
