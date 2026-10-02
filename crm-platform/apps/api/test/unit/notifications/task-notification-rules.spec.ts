import { describe, expect, it } from 'vitest';
import {
  copyFor,
  dedupeKeyFor,
  plainText,
  recipientFor,
  type TaskEventFacts,
} from '../../../src/modules/notifications/task-notification-rules';

const facts = (over: Partial<TaskEventFacts>): TaskEventFacts => ({
  eventType: 'task.assigned',
  taskUuid: 't1',
  taskTitle: 'Call the client',
  dueAt: null,
  assigneeUuid: 'assignee',
  createdByUuid: 'creator',
  actorUuid: 'creator',
  ...over,
});

describe('recipientFor', () => {
  it('assigned: the assignee, unless they did it to themselves', () => {
    expect(recipientFor(facts({}))).toEqual({ userUuid: 'assignee', type: 'task_assigned' });
    expect(recipientFor(facts({ actorUuid: 'assignee' }))).toBeNull();
    expect(recipientFor(facts({ assigneeUuid: null }))).toBeNull();
  });

  it('due: the assignee, else the creator, whoever caused it (the sweep has no actor)', () => {
    const due = { eventType: 'task.due' as const, actorUuid: null };
    expect(recipientFor(facts(due))).toEqual({ userUuid: 'assignee', type: 'task_due' });
    expect(recipientFor(facts({ ...due, assigneeUuid: null }))).toEqual({
      userUuid: 'creator',
      type: 'task_due',
    });
    expect(recipientFor(facts({ ...due, assigneeUuid: null, createdByUuid: null }))).toBeNull();
  });

  it('completed: the creator, unless they completed it themselves', () => {
    const done = { eventType: 'task.completed' as const };
    expect(recipientFor(facts({ ...done, actorUuid: 'assignee' }))).toEqual({
      userUuid: 'creator',
      type: 'task_completed',
    });
    expect(recipientFor(facts({ ...done, actorUuid: 'creator' }))).toBeNull();
    expect(recipientFor(facts({ ...done, createdByUuid: null }))).toBeNull();
    // Completed by the system or an API key: the creator still hears about it.
    expect(recipientFor(facts({ ...done, actorUuid: null }))?.userUuid).toBe('creator');
  });
});

describe('copy', () => {
  it('strips tags, collapses space and cuts to the limit', () => {
    expect(plainText('<b>Hi</b>   there')).toBe('Hi there');
    expect(plainText('x'.repeat(300), 200)).toHaveLength(200);
  });

  it('words each type, naming the actor when known', () => {
    expect(copyFor('task_assigned', 'Call', 'Asha')).toEqual({
      title: 'Task assigned to you',
      body: 'Asha assigned you: Call',
    });
    expect(copyFor('task_assigned', 'Call', null).body).toBe('Call');
    expect(copyFor('task_due', 'Call', null)).toEqual({ title: 'Task due', body: 'Call' });
    expect(copyFor('task_completed', 'Call', 'Ravi').body).toBe('Ravi completed: Call');
  });

  it('the dedupe key is per event, so a redelivery collides but a later event does not', () => {
    expect(dedupeKeyFor('task.assigned', '41')).toBe(dedupeKeyFor('task.assigned', '41'));
    expect(dedupeKeyFor('task.assigned', '41')).not.toBe(dedupeKeyFor('task.assigned', '42'));
  });
});
