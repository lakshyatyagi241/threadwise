import { describe, expect, it, vi } from 'vitest';
import {
  createTaskOutcomeSchema,
  createTaskSchema,
  ERROR_CODES,
  listTaskOutcomesQuerySchema,
  reorderTaskOutcomesSchema,
  taskTransitionSchema,
  updateTaskOutcomeSchema,
} from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { outcomeUsable } from '../../../src/modules/crm/tasks/task-rules';
import {
  TaskOutcomesService,
  toTaskOutcomeResponse,
} from '../../../src/modules/crm/tasks/task-outcomes.service';
import type { TaskOutcomeRow } from '../../../src/modules/crm/tasks/task-outcomes.repository';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

const row = (over: Partial<TaskOutcomeRow> = {}): TaskOutcomeRow => ({
  id: 1,
  uuid: U1,
  name: 'Interested',
  sortOrder: 0,
  isActive: true,
  rowVersion: 1,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  taskCount: 0,
  ...over,
});

describe('outcomeUsable', () => {
  it('accepts an active outcome', () => {
    expect(outcomeUsable({ id: 1, isActive: true }, null)).toBe(true);
  });
  it('refuses an unknown outcome', () => {
    expect(outcomeUsable(undefined, null)).toBe(false);
  });
  it('refuses a hidden outcome the task does not already carry', () => {
    expect(outcomeUsable({ id: 1, isActive: false }, null)).toBe(false);
    expect(outcomeUsable({ id: 1, isActive: false }, 2)).toBe(false);
  });
  it('keeps a hidden outcome on the task that already has it', () => {
    expect(outcomeUsable({ id: 1, isActive: false }, 1)).toBe(true);
  });
});

describe('task outcome contracts', () => {
  it('trims and requires a name, and caps it at 191 characters', () => {
    expect(createTaskOutcomeSchema.parse({ name: '  Left message ' }).name).toBe('Left message');
    expect(createTaskOutcomeSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(createTaskOutcomeSchema.safeParse({ name: 'x'.repeat(192) }).success).toBe(false);
  });
  it('needs the row version to update', () => {
    expect(updateTaskOutcomeSchema.safeParse({ name: 'A' }).success).toBe(false);
    expect(updateTaskOutcomeSchema.safeParse({ isActive: false, rowVersion: 2 }).success).toBe(true);
  });
  it('reads activeOnly from a query string', () => {
    expect(listTaskOutcomesQuerySchema.parse({ activeOnly: 'true' }).activeOnly).toBe(true);
    expect(listTaskOutcomesQuerySchema.parse({}).activeOnly).toBeUndefined();
  });
  it('reorders by uuid', () => {
    expect(reorderTaskOutcomesSchema.safeParse({ outcomeIds: [U1, U2] }).success).toBe(true);
    expect(reorderTaskOutcomesSchema.safeParse({ outcomeIds: ['x'] }).success).toBe(false);
    expect(reorderTaskOutcomesSchema.safeParse({ outcomeIds: [] }).success).toBe(false);
  });
  it('lets a task be created, completed or cleared with an outcome id', () => {
    expect(createTaskSchema.safeParse({ title: 'a', outcomeId: U1 }).success).toBe(true);
    expect(createTaskSchema.safeParse({ title: 'a', outcomeId: 'nope' }).success).toBe(false);
    expect(taskTransitionSchema.safeParse({ outcomeId: U1 }).success).toBe(true);
    expect(taskTransitionSchema.safeParse({ outcomeId: null }).success).toBe(true);
  });
});

describe('toTaskOutcomeResponse', () => {
  it('exposes the uuid as the id and the count of tasks that carry it', () => {
    const r = toTaskOutcomeResponse(row({ taskCount: 3, isActive: false }));
    expect(r).toMatchObject({ id: U1, name: 'Interested', taskCount: 3, isActive: false });
    expect(r.createdAt).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('TaskOutcomesService', () => {
  const ctx = { orgId: 7 } as never;
  const make = (repo: Record<string, unknown>) => {
    const tx = { transaction: async (fn: (t: unknown) => unknown) => fn(tx) };
    const db = { tx: async (fn: (t: unknown) => unknown) => fn(tx) };
    const audit = { record: vi.fn(), diff: vi.fn(() => ({})) };
    const outbox = { emit: vi.fn() };
    return {
      svc: new TaskOutcomesService(db as never, repo as never, audit as never, outbox as never),
      audit,
      outbox,
    };
  };
  const run = <T>(fn: () => Promise<T>) => RequestContextStore.run(ctx, fn);

  it('refuses a name another outcome has, ignoring case', async () => {
    const { svc } = make({ byName: async () => row() });
    await expect(run(() => svc.create({ name: 'INTERESTED' }))).rejects.toMatchObject({
      code: ERROR_CODES.TASK_OUTCOME_NAME_TAKEN,
    });
  });

  it('adds a new outcome last', async () => {
    const insert = vi.fn(async () => ({ id: 5, uuid: U2 }));
    const { svc, outbox } = make({
      byName: async () => undefined,
      maxOrder: async () => 4,
      insert,
      byUuid: async () => row({ id: 5, uuid: U2, name: 'No response', sortOrder: 5 }),
    });
    const created = await run(() => svc.create({ name: 'No response' }));
    expect(insert).toHaveBeenCalledWith(expect.anything(), 7, {
      name: 'No response',
      isActive: true,
      sortOrder: 5,
    });
    expect(created.sortOrder).toBe(5);
    expect(outbox.emit).toHaveBeenCalledOnce();
  });

  it('refuses to delete an outcome that tasks carry', async () => {
    const del = vi.fn();
    const { svc } = make({ byUuid: async () => row({ taskCount: 2 }), delete: del });
    await expect(run(() => svc.remove(U1))).rejects.toMatchObject({
      code: ERROR_CODES.TASK_OUTCOME_IN_USE,
    });
    expect(del).not.toHaveBeenCalled();
  });

  it('deletes an outcome no task carries', async () => {
    const del = vi.fn();
    const { svc, audit } = make({ byUuid: async () => row(), delete: del });
    await run(() => svc.remove(U1));
    expect(del).toHaveBeenCalledWith(expect.anything(), 7, 1);
    expect(audit.record).toHaveBeenCalledOnce();
  });

  it('reports a stale row version as a conflict', async () => {
    const { svc } = make({
      byUuid: async () => row(),
      byName: async () => undefined,
      update: async () => false,
    });
    await expect(run(() => svc.update(U1, { isActive: false, rowVersion: 1 }))).rejects.toMatchObject({
      code: ERROR_CODES.ROW_VERSION_CONFLICT,
    });
  });

  it('refuses a rename onto another outcome name', async () => {
    const { svc } = make({
      byUuid: async () => row(),
      byName: async () => row({ id: 9, uuid: U2, name: 'Left message' }),
    });
    await expect(run(() => svc.update(U1, { name: 'left message', rowVersion: 1 }))).rejects.toMatchObject({
      code: ERROR_CODES.TASK_OUTCOME_NAME_TAKEN,
    });
  });

  it('accepts a reorder that lists every outcome once and rejects the rest', async () => {
    const setOrder = vi.fn();
    const list = async () => [row(), row({ id: 2, uuid: U2, name: 'Left message' })];
    const { svc } = make({ list, setOrder });
    await run(() => svc.reorder({ outcomeIds: [U2, U1] }));
    expect(setOrder).toHaveBeenCalledWith(expect.anything(), 7, [2, 1]);
    for (const bad of [[U1], [U1, U1], [U1, '33333333-3333-4333-8333-333333333333']]) {
      await expect(run(() => svc.reorder({ outcomeIds: bad }))).rejects.toMatchObject({
        code: ERROR_CODES.TASK_OUTCOME_ORDER_INVALID,
      });
    }
  });
});
