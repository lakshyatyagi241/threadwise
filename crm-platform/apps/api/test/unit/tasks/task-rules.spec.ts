import { describe, expect, it } from 'vitest';
import {
  bucketOf,
  decodeTaskCursor,
  defaultSort,
  encodeTaskCursor,
  titleFromBody,
} from '../../../src/modules/crm/tasks/task-rules';
import { taskScopeCondition } from '../../../src/modules/crm/tasks/tasks.repository';
import { createTaskSchema, listTasksQuerySchema, updateTaskSchema } from '@crm/contracts';

describe('bucketOf (WD-TASK-009)', () => {
  const now = new Date('2026-10-05T10:00:00Z');
  const dayEnd = new Date('2026-10-06T00:00:00Z');

  it('a task due before now is overdue, even earlier the same day', () => {
    expect(bucketOf('open', new Date('2026-10-05T09:00:00Z'), now, dayEnd)).toBe('overdue');
  });
  it('due later today is today; the next day is upcoming; undated is no_date', () => {
    expect(bucketOf('open', new Date('2026-10-05T15:00:00Z'), now, dayEnd)).toBe('today');
    expect(bucketOf('open', new Date('2026-10-06T00:00:00Z'), now, dayEnd)).toBe('upcoming');
    expect(bucketOf('open', null, now, dayEnd)).toBe('no_date');
  });
  it('a done task has no bucket', () => {
    expect(bucketOf('done', new Date('2020-01-01T00:00:00Z'), now, dayEnd)).toBeNull();
  });
});

describe('titleFromBody (WD-TASK-014)', () => {
  it('a short single line is the title and needs no notes', () => {
    expect(titleFromBody('  Call back  ')).toEqual({ title: 'Call back', notes: null });
  });
  it('the first line is the title and the whole text is kept as notes', () => {
    expect(titleFromBody('Send proposal\nwith pricing')).toEqual({
      title: 'Send proposal',
      notes: 'Send proposal\nwith pricing',
    });
  });
  it('a long line is cut at 255 characters and the full text kept', () => {
    const long = 'x'.repeat(400);
    const r = titleFromBody(long);
    expect(r.title).toHaveLength(255);
    expect(r.notes).toBe(long);
  });
});

describe('list order and cursor', () => {
  it('done lists default to completion order, everything else to soonest due', () => {
    expect(defaultSort('done', undefined)).toBe('completed');
    expect(defaultSort('open', undefined)).toBe('due');
    expect(defaultSort('all', undefined)).toBe('due');
    expect(defaultSort('done', 'created')).toBe('created');
  });
  it('a cursor round-trips with microsecond precision and the infinite keys', () => {
    const key = '2026-10-05T10:00:00.123456Z';
    expect(decodeTaskCursor(encodeTaskCursor('created', key, 42), 'created')).toEqual({
      key,
      id: 42,
    });
    expect(decodeTaskCursor(encodeTaskCursor('due', 'infinity', 7), 'due')).toEqual({
      key: 'infinity',
      id: 7,
    });
  });
  it('a cursor from another sort, or a damaged one, is a 400', () => {
    const c = encodeTaskCursor('due', 'infinity', 7);
    expect(() => decodeTaskCursor(c, 'created')).toThrow(/Invalid pagination cursor/);
    expect(() => decodeTaskCursor('!!!', 'due')).toThrow(/Invalid pagination cursor/);
    expect(() => decodeTaskCursor(encodeTaskCursor('due', 'garbage', 1), 'due')).toThrow();
  });
});

describe('record scope condition', () => {
  it('all adds nothing; a caller with no user id sees nothing', () => {
    expect(taskScopeCondition(1, 'all', 5)).toBeUndefined();
    expect(taskScopeCondition(1, 'own', null)).toBeDefined();
  });
});

describe('contracts', () => {
  it('a due date needs an offset (a bare date is not read as midnight)', () => {
    expect(createTaskSchema.safeParse({ title: 'x', dueAt: '2026-10-05' }).success).toBe(false);
    expect(
      createTaskSchema.safeParse({ title: 'x', dueAt: '2026-10-05T10:00:00+05:30' }).success,
    ).toBe(true);
  });
  it('a title is required, trimmed, at most 255 characters', () => {
    expect(createTaskSchema.safeParse({ title: '   ' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: 'x'.repeat(256) }).success).toBe(false);
    expect(createTaskSchema.parse({ title: '  hi ' }).title).toBe('hi');
  });
  it('an update carries a rowVersion', () => {
    expect(updateTaskSchema.safeParse({ title: 'x' }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ title: 'x', rowVersion: 1 }).success).toBe(true);
  });
  it('the list query takes csv priorities and boolean words', () => {
    const q = listTasksQuerySchema.parse({ priority: 'high,low', mine: 'true', due: 'overdue' });
    expect(q.priority).toEqual(['high', 'low']);
    expect(q.mine).toBe(true);
    expect(q.status).toBe('open');
    expect(q.limit).toBe(50);
    expect(listTasksQuerySchema.safeParse({ priority: 'urgent' }).success).toBe(false);
  });
});
