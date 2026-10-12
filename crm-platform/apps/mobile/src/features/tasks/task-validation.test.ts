import { createTaskSchema, updateTaskSchema } from '@crm/contracts';
import { callAarav, looseTask } from '@/test/tasks-fixtures';
import { session } from '@/test/dashboard-fixtures';
import { fromDueAt } from './dates';
import {
  EMPTY_TASK,
  buildCreateBody,
  buildUpdateBody,
  contractProblems,
  validateTask,
  valuesOfTask,
  type TaskFormValues,
} from './task-validation';

const ME = session.user.id;
const valid: TaskFormValues = { ...EMPTY_TASK, title: 'Call Aarav' };

describe('validateTask', () => {
  it('accepts a title alone', () => {
    expect(validateTask(valid)).toEqual({});
  });

  it('needs a title', () => {
    expect(validateTask({ ...valid, title: '   ' }).title).toBe('tasks.form.errors.titleRequired');
  });

  it('allows at most 255 characters in the title', () => {
    expect(validateTask({ ...valid, title: 'a'.repeat(255) })).toEqual({});
    expect(validateTask({ ...valid, title: 'a'.repeat(256) }).title).toBe(
      'tasks.form.errors.titleTooLong',
    );
  });

  it('needs a letter in the title, in any script', () => {
    expect(validateTask({ ...valid, title: '12345 -- !!' }).title).toBe(
      'tasks.form.errors.titleNeedsLetter',
    );
    expect(validateTask({ ...valid, title: '2026 Q4' })).toEqual({});
    expect(validateTask({ ...valid, title: 'ग्राहक को कॉल करें' })).toEqual({});
  });

  it('allows at most 5000 characters in the description', () => {
    expect(validateTask({ ...valid, notes: 'n'.repeat(5000) })).toEqual({});
    expect(validateTask({ ...valid, notes: 'n'.repeat(5001) }).notes).toBe(
      'tasks.form.errors.notesTooLong',
    );
  });

  it('checks the shape of the day and the time', () => {
    expect(validateTask({ ...valid, date: '31/10/2026', time: '10:00' }).date).toBe(
      'tasks.form.errors.dateInvalid',
    );
    expect(validateTask({ ...valid, date: '2026-10-31', time: '25:00' }).time).toBe(
      'tasks.form.errors.timeInvalid',
    );
  });

  it('wants the day and the time together, or neither', () => {
    expect(validateTask({ ...valid, date: '2026-10-31' }).time).toBe(
      'tasks.form.errors.timeNeeded',
    );
    expect(validateTask({ ...valid, time: '10:00' }).date).toBe('tasks.form.errors.dateNeeded');
    expect(validateTask({ ...valid, date: '2026-10-31', time: '10:00' })).toEqual({});
  });
});

describe('buildCreateBody', () => {
  it('sends the title and the default priority, and leaves out what is empty', () => {
    const body = buildCreateBody({ ...valid, title: '  Call Aarav  ' });
    expect(body).toEqual({ title: 'Call Aarav', priority: 'medium' });
    expect(createTaskSchema.safeParse(body).success).toBe(true);
  });

  it('sends every field that is filled, with the due date as an ISO instant with an offset', () => {
    const body = buildCreateBody({
      ...valid,
      notes: ' Bring the quote ',
      priority: 'high',
      date: '2026-10-31',
      time: '14:30',
      assignee: { kind: 'user', id: '66666666-6666-4666-8666-666666666666', name: 'Dev Patel' },
      contact: { id: callAarav.contact!.id, name: 'Aarav Sharma' },
    });
    expect(body).toMatchObject({
      title: 'Call Aarav',
      notes: 'Bring the quote',
      priority: 'high',
      assigneeId: '66666666-6666-4666-8666-666666666666',
      contactId: callAarav.contact!.id,
    });
    expect(body.dueAt).toMatch(/^2026-10-31T14:30:00[+-]\d{2}:\d{2}$/);
    expect(createTaskSchema.safeParse(body).success).toBe(true);
  });

  it('leaves the assignee out for "Me" (the API assigns the caller) and sends null for nobody', () => {
    expect(buildCreateBody(valid)).not.toHaveProperty('assigneeId');
    expect(buildCreateBody({ ...valid, assignee: { kind: 'none' } }).assigneeId).toBeNull();
  });
});

describe('valuesOfTask', () => {
  it('fills the form from the task, the due date on the phone clock', () => {
    const values = valuesOfTask(callAarav, ME);
    expect(values).toMatchObject({
      title: 'Call Aarav about the quote',
      notes: 'Ask whether the quote for 40 seats is approved.',
      priority: 'medium',
      assignee: { kind: 'me' },
      contact: { id: callAarav.contact!.id, name: 'Aarav Sharma' },
    });
    expect({ date: values.date, time: values.time }).toEqual(fromDueAt(callAarav.dueAt));
  });

  it('knows someone else, and nobody', () => {
    expect(valuesOfTask(callAarav, 'someone-else').assignee).toEqual({
      kind: 'user',
      id: ME,
      name: 'Asha Verma',
    });
    expect(valuesOfTask(looseTask, ME)).toMatchObject({
      assignee: { kind: 'none' },
      contact: null,
      date: '',
      time: '',
      notes: '',
    });
  });
});

describe('buildUpdateBody', () => {
  it('sends nothing when nothing changed', () => {
    expect(buildUpdateBody(callAarav, valuesOfTask(callAarav, ME), ME)).toEqual({});
  });

  it('sends only what changed', () => {
    const values = {
      ...valuesOfTask(callAarav, ME),
      title: 'Call Aarav today',
      priority: 'high' as const,
    };
    expect(buildUpdateBody(callAarav, values, ME)).toEqual({
      title: 'Call Aarav today',
      priority: 'high',
    });
  });

  it('clears what was emptied with null', () => {
    const values: TaskFormValues = {
      ...valuesOfTask(callAarav, ME),
      notes: '',
      date: '',
      time: '',
      assignee: { kind: 'none' },
      contact: null,
    };
    expect(buildUpdateBody(callAarav, values, ME)).toEqual({
      notes: null,
      dueAt: null,
      assigneeId: null,
      contactId: null,
    });
  });

  it('sets a due date on a task that had none, and changes the assignee and the contact', () => {
    const values: TaskFormValues = {
      ...valuesOfTask(looseTask, ME),
      date: '2026-11-01',
      time: '08:15',
      assignee: { kind: 'me' },
      contact: { id: callAarav.contact!.id, name: 'Aarav Sharma' },
    };
    const body = buildUpdateBody(looseTask, values, ME);
    expect(body.dueAt).toMatch(/^2026-11-01T08:15:00[+-]\d{2}:\d{2}$/);
    expect(body.assigneeId).toBe(ME);
    expect(body.contactId).toBe(callAarav.contact!.id);
  });

  it('does not count the seconds the form cannot show as a change of the due date', () => {
    const task = { ...callAarav, dueAt: new Date(2026, 9, 20, 10, 0, 37).toISOString() };
    expect(buildUpdateBody(task, valuesOfTask(task, ME), ME)).toEqual({});
  });
});

describe('contractProblems', () => {
  it('lets a body through that the schema accepts', () => {
    expect(contractProblems(buildCreateBody(valid), 'create')).toEqual({});
    expect(contractProblems({ title: 'x', rowVersion: 2 }, 'update')).toEqual({});
  });

  it('names the field the schema refuses', () => {
    expect(contractProblems({ title: 'x', dueAt: '2026-10-31' }, 'create')).toEqual({
      date: 'tasks.form.errors.dueInvalid',
    });
    expect(contractProblems({ title: '', rowVersion: 1 }, 'update')).toEqual({
      title: 'tasks.form.errors.titleRequired',
    });
    expect(updateTaskSchema.safeParse({ title: 'x' }).success).toBe(false);
  });
});
