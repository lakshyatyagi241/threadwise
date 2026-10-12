import { ApiError } from '@/lib/api';
import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { callAarav, contactChoices, doneTask, taskPage, team } from '@/test/tasks-fixtures';
import { aarav } from '@/test/contacts-fixtures';
import {
  completeTask,
  createTask,
  deleteTask,
  getLinkedContact,
  getTask,
  listAssignees,
  listTasks,
  reopenTask,
  searchContacts,
  taskListPath,
  updateTask,
} from './api';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

const url = (call: { url: string } | undefined) => new URL((call as { url: string }).url);

describe('tasks api', () => {
  it('picks the route for each kind of list', () => {
    expect(taskListPath({ kind: 'mine' })).toBe('/v2/tasks/my');
    expect(taskListPath({ kind: 'all' })).toBe('/v2/tasks');
    expect(taskListPath({ kind: 'contact', contactId: 'c-1' })).toBe('/v2/contacts/c-1/tasks');
  });

  it('lists a page and sends only the filters that are set', async () => {
    const http = mockFetch(jsonResponse(200, taskPage([callAarav], 'cursor-2')));
    const result = await listTasks(
      { kind: 'mine' },
      {
        limit: 50,
        status: 'open',
        priority: 'high',
        due: 'today',
        q: 'quote',
        unassigned: undefined,
      },
    );
    expect(result.data[0]?.title).toBe('Call Aarav about the quote');
    expect(result.page).toEqual({ nextCursor: 'cursor-2', hasMore: true, limit: 50 });
    const first = url(http.calls[0]);
    expect(first.pathname).toBe('/v2/tasks/my');
    expect(Object.fromEntries(first.searchParams)).toEqual({
      limit: '50',
      status: 'open',
      priority: 'high',
      due: 'today',
      q: 'quote',
    });
    expect(http.calls[0]?.init.method).toBe('GET');
    expect(http.calls[0]?.headers.Authorization).toBe('Bearer access-1');
  });

  it('asks a contact’s route for its tasks, with the cursor and the owner flags', async () => {
    const http = mockFetch(jsonResponse(200, taskPage([doneTask])));
    await listTasks(
      { kind: 'contact', contactId: aarav.id },
      { limit: 50, status: 'done', cursor: 'cursor-2', mine: true },
    );
    const first = url(http.calls[0]);
    expect(first.pathname).toBe(`/v2/contacts/${aarav.id}/tasks`);
    expect(first.searchParams.get('cursor')).toBe('cursor-2');
    expect(first.searchParams.get('mine')).toBe('true');
    expect(first.searchParams.get('status')).toBe('done');
  });

  it('refuses an answer that is not a task page', async () => {
    mockFetch(jsonResponse(200, { data: [{ id: 'not-a-task' }], page: {} }));
    await expect(listTasks({ kind: 'all' }, { limit: 50, status: 'open' })).rejects.toMatchObject({
      code: 'CLIENT_CONTRACT_MISMATCH',
    });
  });

  it('shows the plan lock as its code', async () => {
    mockFetch(
      jsonResponse(422, {
        type: 'about:blank',
        title: 'Unprocessable',
        status: 422,
        code: 'PLAN_FEATURE_LOCKED',
      }),
    );
    await expect(listTasks({ kind: 'all' }, { limit: 50, status: 'open' })).rejects.toMatchObject({
      status: 422,
      code: 'PLAN_FEATURE_LOCKED',
    });
  });

  it('reads one task', async () => {
    const http = mockFetch(jsonResponse(200, callAarav));
    await expect(getTask(callAarav.id)).resolves.toMatchObject({ rowVersion: 2 });
    expect(url(http.calls[0]).pathname).toBe(`/v2/tasks/${callAarav.id}`);
  });

  it('creates a task with a POST that carries the idempotency key', async () => {
    const http = mockFetch(jsonResponse(201, callAarav));
    await createTask({ title: 'Call Aarav', priority: 'high' }, 'key-1');
    const call = http.calls[0]!;
    expect(url(call).pathname).toBe('/v2/tasks');
    expect(call.init.method).toBe('POST');
    expect(call.body).toEqual({ title: 'Call Aarav', priority: 'high' });
    expect(call.headers['Idempotency-Key']).toBe('key-1');
  });

  it('updates with the row version it read, and fails with the conflict code on a stale one', async () => {
    const http = mockFetch(
      jsonResponse(200, callAarav),
      jsonResponse(409, {
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        code: 'ROW_VERSION_CONFLICT',
      }),
    );
    await updateTask(callAarav.id, { title: 'New title', rowVersion: 2 }, 'key-2');
    expect(http.calls[0]?.init.method).toBe('PATCH');
    expect(url(http.calls[0]).pathname).toBe(`/v2/tasks/${callAarav.id}`);
    expect(http.calls[0]?.body).toEqual({ title: 'New title', rowVersion: 2 });
    const error: unknown = await updateTask(callAarav.id, { rowVersion: 1 }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isRowVersionConflict).toBe(true);
  });

  it('completes and reopens with the version, and the answer is the task', async () => {
    const http = mockFetch(jsonResponse(200, doneTask), jsonResponse(200, callAarav));
    await expect(completeTask(callAarav.id, 2, 'key-3')).resolves.toMatchObject({ status: 'done' });
    await expect(reopenTask(doneTask.id, 7)).resolves.toMatchObject({ status: 'open' });
    expect(http.calls.map((call) => [call.init.method, url(call).pathname, call.body])).toEqual([
      ['POST', `/v2/tasks/${callAarav.id}/complete`, { rowVersion: 2 }],
      ['POST', `/v2/tasks/${doneTask.id}/reopen`, { rowVersion: 7 }],
    ]);
    expect(http.calls[0]?.headers['Idempotency-Key']).toBe('key-3');
  });

  it('deletes with a DELETE and expects nothing back', async () => {
    const http = mockFetch(jsonResponse(204));
    await expect(deleteTask(callAarav.id, 'key-4')).resolves.toBeUndefined();
    expect(http.calls[0]?.init.method).toBe('DELETE');
    expect(url(http.calls[0]).pathname).toBe(`/v2/tasks/${callAarav.id}`);
    expect(http.calls[0]?.headers['Idempotency-Key']).toBe('key-4');
  });

  it('lists the team from the contacts route', async () => {
    const http = mockFetch(jsonResponse(200, team));
    await expect(listAssignees()).resolves.toHaveLength(2);
    expect(url(http.calls[0]).pathname).toBe('/v2/contacts/assignees');
  });

  it('searches contacts for the picker, 20 at a time', async () => {
    const http = mockFetch(jsonResponse(200, contactChoices), jsonResponse(200, contactChoices));
    await searchContacts('aar');
    await searchContacts('');
    expect(Object.fromEntries(url(http.calls[0]).searchParams)).toEqual({ q: 'aar', limit: '20' });
    expect(url(http.calls[0]).pathname).toBe('/v2/contacts/select-data');
    expect(Object.fromEntries(url(http.calls[1]).searchParams)).toEqual({ limit: '20' });
  });

  it('refuses a contact search answer of the wrong shape', async () => {
    mockFetch(jsonResponse(200, [{ id: 1 }]));
    await expect(searchContacts('x')).rejects.toMatchObject({ code: 'CLIENT_CONTRACT_MISMATCH' });
  });

  it('reads the contact a task is added for', async () => {
    const http = mockFetch(jsonResponse(200, aarav));
    await expect(getLinkedContact(aarav.id)).resolves.toMatchObject({ name: 'Aarav Sharma' });
    expect(url(http.calls[0]).pathname).toBe(`/v2/contacts/${aarav.id}`);
  });
});
