import { describe, expect, it } from 'vitest';
import { createTaskSchema, updateTaskSchema, type TaskResponse } from '@crm/contracts';
import { createBody, draftOf, emptyDraft, patchBody, validateDraft } from './task-form';

const ME = '3f1c2b7a-5d4e-4a90-8b21-0c9d7e6f5a43';
const CONTACT = '9a8b7c6d-1e2f-4a3b-9c4d-5e6f7a8b9c0d';

const task: TaskResponse = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Call Acme',
  notes: 'ask about seats',
  priority: 'high',
  status: 'open',
  dueAt: '2026-10-05T14:30:00.000Z',
  doneAt: null,
  remindedAt: null,
  bucket: 'upcoming',
  overdue: false,
  assignee: { id: ME, name: 'Me' },
  createdBy: { id: ME, name: 'Me' },
  contact: { id: CONTACT, name: 'Acme' },
  deal: null,
  company: null,
  source: 'manual',
  kind: 'task',
  rowVersion: 3,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

describe('validateDraft', () => {
  it('needs a title', () => {
    expect(validateDraft({ ...emptyDraft(ME), title: '   ' }).title).toBe('titleRequired');
    expect(validateDraft({ ...emptyDraft(ME), title: 'ok', due: '2026-10-05T14:30' })).toEqual({});
  });
  it('needs a due date, an assignee and a priority', () => {
    const p = validateDraft({ ...emptyDraft(''), title: 'a', priority: '' as never });
    expect(p).toEqual({
      due: 'dueRequired',
      assignee: 'assigneeRequired',
      priority: 'priorityRequired',
    });
  });
  it('limits the title to 255 and the notes to 5000 characters', () => {
    expect(validateDraft({ ...emptyDraft(ME), title: 'x'.repeat(256) }).title).toBe('titleTooLong');
    expect(validateDraft({ ...emptyDraft(ME), title: 'x'.repeat(255) }).title).toBeUndefined();
    expect(validateDraft({ ...emptyDraft(ME), title: 'a', notes: 'n'.repeat(5001) }).notes).toBe(
      'notesTooLong',
    );
  });
  it('rejects a due value that is not a date', () => {
    expect(validateDraft({ ...emptyDraft(ME), title: 'a', due: 'tomorrow-ish' }).due).toBe(
      'dueInvalid',
    );
  });
});

describe('createBody', () => {
  it('builds a body the contract accepts, with the due date as an instant with an offset', () => {
    const body = createBody({
      ...emptyDraft(ME),
      title: '  Send quote ',
      due: '2026-10-05T14:30',
      contactId: CONTACT,
    });
    expect(body.title).toBe('Send quote');
    expect(body.dueAt).toMatch(/Z$/);
    expect(createTaskSchema.safeParse(body).success).toBe(true);
  });
  it('sends null for an empty assignee, due date and notes (nobody, no date, no notes)', () => {
    const body = createBody({ ...emptyDraft(''), title: 'a' });
    expect(body).toMatchObject({
      assigneeId: null,
      dueAt: null,
      notes: null,
      contactId: null,
      dealId: null,
    });
  });
  it('carries the company a task was started from, and leaves the key out when there is none', () => {
    const co = '5f1c1e0e-2f4b-4a58-9c1e-1d7a0f0f0001';
    const body = createBody({ ...emptyDraft(ME), title: 'a', companyId: co });
    expect(body.companyId).toBe(co);
    expect(createTaskSchema.safeParse(body).success).toBe(true);
    expect(createBody({ ...emptyDraft(ME), title: 'a' })).not.toHaveProperty('companyId');
  });
  it('defaults the assignee to the person given', () => {
    expect(createBody({ ...emptyDraft(ME), title: 'a' }).assigneeId).toBe(ME);
  });
});

describe('patchBody', () => {
  it('sends nothing for an untouched form', () => {
    expect(patchBody(task, draftOf(task))).toEqual({});
  });
  it('sends only what changed', () => {
    const d = { ...draftOf(task), priority: 'low' as const, title: ' Call Acme today ' };
    expect(patchBody(task, d)).toEqual({ priority: 'low', title: 'Call Acme today' });
  });
  it('clears with null: no date, no assignee, unlinked, no notes', () => {
    const d = { ...draftOf(task), due: '', assigneeId: '', contactId: '', notes: '' };
    expect(patchBody(task, d)).toEqual({
      dueAt: null,
      assigneeId: null,
      contactId: null,
      notes: null,
    });
  });
  it('produces a body the update contract accepts once the row version is added', () => {
    const patch = patchBody(task, { ...draftOf(task), dealId: ME });
    expect(updateTaskSchema.safeParse({ ...patch, rowVersion: task.rowVersion }).success).toBe(
      true,
    );
  });
});
