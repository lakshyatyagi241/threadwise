import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { TaskResponse } from '@crm/contracts';
import { KEYS } from '../api/hooks';
import type { TaskSource } from '../api/service';
import {
  inlineCreateBody,
  inlineDraft,
  isPending,
  optimisticAdd,
  optimisticToggle,
  pendingTask,
  toggled,
  validateInline,
} from './inline-tasks';

const CONTACT = '294dca7c-5806-4548-9035-dcca9befc7b1';
const ME = '11111111-1111-4111-8111-111111111111';
const source: TaskSource = { kind: 'contact', id: CONTACT };
const now = new Date('2026-10-16T09:00:00Z');

const task = (over: Partial<TaskResponse> = {}): TaskResponse => ({
  id: '5b0d0f6e-0000-4000-8000-000000000001',
  title: 'Call back',
  notes: null,
  priority: 'medium',
  status: 'open',
  dueAt: '2026-10-17T10:00:00.000Z',
  doneAt: null,
  remindedAt: null,
  bucket: 'upcoming',
  overdue: false,
  assignee: { id: ME, name: 'Asha' },
  createdBy: { id: ME, name: 'Asha' },
  contact: { id: CONTACT, name: 'Aarav' },
  deal: null,
  company: null,
  outcome: null,
  source: 'manual',
  rowVersion: 1,
  createdAt: '2026-10-16T08:00:00.000Z',
  updatedAt: '2026-10-16T08:00:00.000Z',
  ...over,
});

const page = (tasks: TaskResponse[]) => ({
  pages: [{ tasks, nextCursor: null, hasMore: false }],
  pageParams: [undefined],
});

/** A client holding the open and the completed list of the contact, as the Tasks section loads them. */
function seeded(open: TaskResponse[], done: TaskResponse[] = []) {
  const qc = new QueryClient();
  const openKey = [...KEYS.list, source, { status: 'open' }];
  const doneKey = [...KEYS.list, source, { status: 'done', sort: 'completed' }];
  qc.setQueryData(openKey, page(open));
  qc.setQueryData(doneKey, page(done));
  const ids = (key: unknown[]) =>
    (qc.getQueryData(key) as ReturnType<typeof page>).pages[0]!.tasks.map((t) => t.id);
  return { qc, openKey, doneKey, ids };
}

describe('the inline task row', () => {
  it('starts on tomorrow at 17:00, for me, medium priority', () => {
    const d = inlineDraft(ME, new Date(2026, 9, 16, 9, 0));
    expect(d).toMatchObject({
      title: '',
      assigneeId: ME,
      priority: 'medium',
      due: '2026-10-17T17:00',
    });
  });

  it('needs a title and a due date, and nothing else', () => {
    const ok = { ...inlineDraft(ME, now), title: 'Send the quote' };
    expect(validateInline(ok)).toEqual({});
    expect(validateInline({ ...ok, title: '   ' })).toEqual({ title: 'titleRequired' });
    expect(validateInline({ ...ok, title: 'x'.repeat(256) })).toEqual({ title: 'titleTooLong' });
    expect(validateInline({ ...ok, due: '' })).toEqual({ due: 'dueRequired' });
    expect(validateInline({ ...ok, due: 'not a date' })).toEqual({ due: 'dueInvalid' });
  });

  it('links the new task to the contact (or the deal, or the company) it is added on', () => {
    const d = { ...inlineDraft(ME, now), title: ' Send the quote ', priority: 'high' as const };
    expect(inlineCreateBody(d, { kind: 'contact', id: CONTACT })).toMatchObject({
      title: 'Send the quote',
      priority: 'high',
      assigneeId: ME,
      contactId: CONTACT,
    });
    expect(inlineCreateBody(d, { kind: 'deal', id: 'd' })).toHaveProperty('dealId', 'd');
    expect(inlineCreateBody(d, { kind: 'company', id: 'c' })).toHaveProperty('companyId', 'c');
    expect(inlineCreateBody(d, { kind: 'contact', id: CONTACT })).not.toHaveProperty('dealId');
  });
});

describe('optimistic add', () => {
  const pending = (body = inlineCreateBody({ ...inlineDraft(ME, now), title: 'New' }, source)) =>
    pendingTask(body, { assignee: { id: ME, name: 'Asha' }, createdBy: null }, now);

  it('shows the task at the top of the open list at once, and not in the completed list', () => {
    const { qc, openKey, doneKey, ids } = seeded([task()]);
    const p = pending();
    expect(isPending(p.id)).toBe(true);
    optimisticAdd(qc, source, p);
    expect(ids(openKey)).toEqual([p.id, task().id]);
    expect(ids(doneKey)).toEqual([]);
  });

  it('puts the cache back exactly as it was when the save fails', () => {
    const { qc, openKey, ids } = seeded([task()]);
    const before = qc.getQueryData(openKey);
    const { rollback } = optimisticAdd(qc, source, pending());
    rollback();
    expect(qc.getQueryData(openKey)).toEqual(before);
    expect(ids(openKey)).toEqual([task().id]);
  });

  it('swaps the made-up row for the saved task when the server answers', () => {
    const { qc, openKey, ids } = seeded([]);
    const p = pending();
    const { confirm } = optimisticAdd(qc, source, p);
    const real = task({ id: '5b0d0f6e-0000-4000-8000-0000000000ff', title: 'New' });
    confirm(real);
    expect(ids(openKey)).toEqual([real.id]);
  });

  it('leaves the lists of other records alone', () => {
    const qc = new QueryClient();
    const other: TaskSource = { kind: 'contact', id: 'other' };
    const key = [...KEYS.list, other, { status: 'open' }];
    qc.setQueryData(key, page([task()]));
    optimisticAdd(qc, source, pending());
    expect((qc.getQueryData(key) as ReturnType<typeof page>).pages[0]!.tasks).toHaveLength(1);
  });
});

describe('optimistic complete', () => {
  it('ticks the task in every list of the record at once', () => {
    const { qc, openKey, ids } = seeded([task()]);
    optimisticToggle(qc, source, task(), now);
    const row = (qc.getQueryData(openKey) as ReturnType<typeof page>).pages[0]!.tasks[0]!;
    expect(row.status).toBe('done');
    expect(row.doneAt).toBe(now.toISOString());
    expect(row.bucket).toBeNull();
    expect(ids(openKey)).toEqual([task().id]);
  });

  it('puts the row back exactly as it was when the call fails', () => {
    const { qc, openKey } = seeded([task()]);
    const before = qc.getQueryData(openKey);
    const rollback = optimisticToggle(qc, source, task(), now);
    expect((qc.getQueryData(openKey) as ReturnType<typeof page>).pages[0]!.tasks[0]!.status).toBe(
      'done',
    );
    rollback();
    expect(qc.getQueryData(openKey)).toEqual(before);
  });

  it('unticking a done task reopens it with its bucket and overdue flag', () => {
    const done = task({ status: 'done', doneAt: '2026-10-16T08:30:00.000Z', bucket: null });
    const open = toggled(done, now);
    expect(open).toMatchObject({
      status: 'open',
      doneAt: null,
      bucket: 'upcoming',
      overdue: false,
    });
    const late = toggled({ ...done, dueAt: '2026-10-15T10:00:00.000Z' }, now);
    expect(late).toMatchObject({ status: 'open', bucket: 'overdue', overdue: true });
  });
});
