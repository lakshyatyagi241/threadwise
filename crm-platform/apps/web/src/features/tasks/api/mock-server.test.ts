import { describe, expect, it } from 'vitest';
import {
  taskBulkResultSchema,
  taskCountsResponseSchema,
  taskPageResponseSchema,
  taskResponseSchema,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { configureMock } from './http';
import { mockCall } from './mock-server';

/**
 * The development stand-in must speak the contract: every answer is parsed by the shared schemas, and the rules the spec
 * gives the server (version conflicts, idempotent complete, assignee check, buckets) hold, or the screens would be built
 * against behaviour the real API will not have.
 */
const ME = '77777777-7777-4777-8777-777777777777';
configureMock({ id: ME, name: 'Tester' });

const page = (query: Record<string, string | number | boolean | undefined> = {}, path = '/tasks') =>
  mockCall(path, { query, schema: taskPageResponseSchema });

describe('tasks stand-in', () => {
  it('lists open tasks soonest first, undated last, in pages that chain by cursor', async () => {
    const first = await page({ limit: 10 });
    expect(first.data).toHaveLength(10);
    expect(first.page.hasMore).toBe(true);
    const dated = first.data.filter((t) => t.dueAt);
    expect(dated.map((t) => t.dueAt)).toEqual([...dated.map((t) => t.dueAt)].sort());
    const second = await page({ limit: 10, cursor: first.page.nextCursor ?? undefined });
    expect(second.data[0]!.id).not.toBe(first.data[0]!.id);
    expect(first.data.every((t) => t.status === 'open')).toBe(true);
  });

  it('"mine" only returns tasks assigned to the signed-in person', async () => {
    const mine = await page({ mine: true, limit: 100 });
    expect(mine.data.length).toBeGreaterThan(0);
    expect(mine.data.every((t) => t.assignee?.id === ME)).toBe(true);
  });

  it('cuts the buckets from the due instant and flags overdue', async () => {
    const overdue = await page({ due: 'overdue', limit: 100 });
    expect(overdue.data.length).toBeGreaterThan(0);
    expect(overdue.data.every((t) => t.bucket === 'overdue' && t.overdue)).toBe(true);
    const none = await page({ due: 'none', limit: 100 });
    expect(none.data.every((t) => t.dueAt === null && t.bucket === 'no_date')).toBe(true);
  });

  it('counts partition the open tasks and agree with the lists', async () => {
    const c = await mockCall('/tasks/counts', { schema: taskCountsResponseSchema });
    expect(c.overdue + c.today + c.upcoming + c.noDate).toBe(c.open);
    const all = await page({ limit: 200 });
    expect(all.data).toHaveLength(c.open);
    const done = await page({ status: 'done', limit: 200 });
    expect(done.data).toHaveLength(c.done);
    expect(done.data.every((t) => t.status === 'done' && t.doneAt)).toBe(true);
  });

  it('creates a task assigned to the caller by default, open and medium priority', async () => {
    const t = await mockCall('/tasks', {
      method: 'POST',
      body: { title: 'New one' },
      schema: taskResponseSchema,
    });
    expect(t).toMatchObject({
      status: 'open',
      priority: 'medium',
      assignee: { id: ME },
      doneAt: null,
    });
  });

  it('refuses an assignee who is not a member with TASK_ASSIGNEE_INVALID', async () => {
    const err = await mockCall('/tasks', {
      method: 'POST',
      body: { title: 'x', assigneeId: '99999999-9999-4999-8999-999999999999' },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('TASK_ASSIGNEE_INVALID');
  });

  it('complete and reopen are idempotent and keep status and doneAt in agreement', async () => {
    const t = await mockCall('/tasks', {
      method: 'POST',
      body: { title: 'Toggle me' },
      schema: taskResponseSchema,
    });
    const a = await mockCall(`/tasks/${t.id}/complete`, {
      method: 'POST',
      schema: taskResponseSchema,
    });
    const b = await mockCall(`/tasks/${t.id}/complete`, {
      method: 'POST',
      schema: taskResponseSchema,
    });
    expect(a.status).toBe('done');
    expect(a.doneAt).not.toBeNull();
    expect(b.rowVersion).toBe(a.rowVersion);
    const c = await mockCall(`/tasks/${t.id}/reopen`, {
      method: 'POST',
      schema: taskResponseSchema,
    });
    expect(c).toMatchObject({ status: 'open', doneAt: null });
  });

  it('answers 409 ROW_VERSION_CONFLICT for a stale version and applies a current one', async () => {
    const t = await mockCall('/tasks', {
      method: 'POST',
      body: { title: 'Edit me' },
      schema: taskResponseSchema,
    });
    const ok = await mockCall(`/tasks/${t.id}`, {
      method: 'PATCH',
      body: { priority: 'high', rowVersion: t.rowVersion },
      schema: taskResponseSchema,
    });
    expect(ok.priority).toBe('high');
    expect(ok.rowVersion).toBe(t.rowVersion + 1);
    const err = await mockCall(`/tasks/${t.id}`, {
      method: 'PATCH',
      body: { priority: 'low', rowVersion: t.rowVersion },
    }).catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).code).toBe('ROW_VERSION_CONFLICT');
  });

  it('bulk calls report each success and each failure', async () => {
    const t = await mockCall('/tasks', {
      method: 'POST',
      body: { title: 'Bulk' },
      schema: taskResponseSchema,
    });
    const ghost = '88888888-8888-4888-8888-888888888888';
    const res = await mockCall('/tasks/bulk/complete', {
      method: 'POST',
      body: { ids: [t.id, ghost] },
      schema: taskBulkResultSchema,
    });
    expect(res.succeeded).toEqual([t.id]);
    expect(res.failed.map((f) => f.id)).toEqual([ghost]);
  });

  it('lists the tasks of one contact on the linked route', async () => {
    const linked = await page(
      { limit: 100 },
      '/contacts/00000000-0000-4000-8000-0000000000c1/tasks',
    );
    expect(linked.data.length).toBeGreaterThan(0);
    expect(linked.data.every((t) => t.contact?.id === '00000000-0000-4000-8000-0000000000c1')).toBe(
      true,
    );
  });
});
