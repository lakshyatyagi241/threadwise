import { ApiError } from '@/lib/api';
import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { contactId, noteA, noteB, pageOf } from '@/test/contact-notes-fixtures';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import {
  createContactNote,
  deleteContactNote,
  listContactNotes,
  updateContactNote,
} from './notes-api';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('contact notes api', () => {
  it('lists a page of notes with the limit and the cursor', async () => {
    const http = mockFetch(jsonResponse(200, pageOf([noteA, noteB], 'cursor-2')));
    const result = await listContactNotes(contactId, { limit: 20, cursor: 'cursor-1' });
    expect(result.data.map((n) => n.id)).toEqual([noteA.id, noteB.id]);
    expect(result.page).toEqual({ nextCursor: 'cursor-2', hasMore: true, limit: 20 });
    const call = http.calls[0]!;
    const url = new URL(call.url);
    expect(url.pathname).toBe(`/v2/contacts/${contactId}/notes`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '20', cursor: 'cursor-1' });
    expect(call.init.method).toBe('GET');
    expect(call.headers.Authorization).toBe('Bearer access-1');
  });

  it('leaves the cursor out of the first page', async () => {
    const http = mockFetch(jsonResponse(200, pageOf([])));
    await listContactNotes(contactId, { limit: 20 });
    expect(Object.fromEntries(new URL(http.calls[0]!.url).searchParams)).toEqual({ limit: '20' });
  });

  it('refuses an answer that is not a page of notes', async () => {
    mockFetch(jsonResponse(200, { data: [{ id: 'not-a-note' }], page: {} }));
    await expect(listContactNotes(contactId, { limit: 20 })).rejects.toMatchObject({
      code: 'CLIENT_CONTRACT_MISMATCH',
    });
  });

  it('keeps a contact id from leaving its place in the path', async () => {
    const http = mockFetch(jsonResponse(200, pageOf([])));
    await listContactNotes('x/../../tasks', { limit: 20 });
    expect(new URL(http.calls[0]!.url).pathname).toBe('/v2/contacts/x%2F..%2F..%2Ftasks/notes');
  });

  it('creates a note with a POST that carries the idempotency key', async () => {
    const http = mockFetch(jsonResponse(201, noteA));
    await expect(createContactNote(contactId, { body: 'Hello' }, 'key-1')).resolves.toMatchObject({
      id: noteA.id,
    });
    const call = http.calls[0]!;
    expect(new URL(call.url).pathname).toBe(`/v2/contacts/${contactId}/notes`);
    expect(call.init.method).toBe('POST');
    expect(call.body).toEqual({ body: 'Hello' });
    expect(call.headers['Idempotency-Key']).toBe('key-1');
  });

  it('updates with the row version it read, and fails with the conflict code on a stale one', async () => {
    const http = mockFetch(
      jsonResponse(200, noteB),
      jsonResponse(409, {
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        code: 'ROW_VERSION_CONFLICT',
      }),
    );
    await updateContactNote(contactId, noteB.id, { body: 'Changed', rowVersion: 3 });
    const call = http.calls[0]!;
    expect(new URL(call.url).pathname).toBe(`/v2/contacts/${contactId}/notes/${noteB.id}`);
    expect(call.init.method).toBe('PATCH');
    expect(call.body).toEqual({ body: 'Changed', rowVersion: 3 });
    expect(call.headers['Idempotency-Key']).toEqual(expect.any(String));

    const failure: unknown = await updateContactNote(contactId, noteB.id, {
      body: 'Changed',
      rowVersion: 2,
    }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).isRowVersionConflict).toBe(true);
  });

  it('deletes a note and accepts the empty 204 answer', async () => {
    const http = mockFetch(jsonResponse(204));
    await expect(deleteContactNote(contactId, noteA.id)).resolves.toBeUndefined();
    const call = http.calls[0]!;
    expect(new URL(call.url).pathname).toBe(`/v2/contacts/${contactId}/notes/${noteA.id}`);
    expect(call.init.method).toBe('DELETE');
    expect(call.body).toBeUndefined();
  });

  it('fails with the not-found code for a note that is gone', async () => {
    mockFetch(
      jsonResponse(404, {
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        code: 'NOT_FOUND',
      }),
    );
    await expect(deleteContactNote(contactId, noteA.id)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('fails with the offline code when there is no connection', async () => {
    mockFetch(new TypeError('Network request failed'));
    await expect(listContactNotes(contactId, { limit: 20 })).rejects.toMatchObject({
      code: 'CLIENT_NETWORK',
    });
  });
});
