import { ApiError } from '@/lib/api';
import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { aarav, page, phoneOnly, vipTag } from '@/test/contacts-fixtures';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import {
  attachContactTag,
  createContact,
  deleteContact,
  detachContactTag,
  getContact,
  getContactTags,
  listContacts,
  updateContact,
} from './api';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('contacts api', () => {
  it('lists a page with the tags expanded and sends only the filters that are set', async () => {
    const http = mockFetch(jsonResponse(200, page([aarav], 'cursor-2', { total: 1 })));
    const result = await listContacts({
      limit: 50,
      q: 'aarav',
      lifecycleStage: 'qualified',
      unsubscribed: false,
      source: undefined,
    });
    expect(result.data[0]?.name).toBe('Aarav Sharma');
    expect(result.page).toEqual({ nextCursor: 'cursor-2', hasMore: true, limit: 50 });
    expect(result.meta).toEqual({ total: 1 });
    const url = new URL(http.calls[0]!.url);
    expect(url.pathname).toBe('/v2/contacts');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: '50',
      q: 'aarav',
      lifecycleStage: 'qualified',
      unsubscribed: 'false',
      expand: 'tags',
    });
    expect(http.calls[0]?.init.method).toBe('GET');
    expect(http.calls[0]?.headers.Authorization).toBe('Bearer access-1');
  });

  it('asks for the next page with the cursor', async () => {
    const http = mockFetch(jsonResponse(200, page([phoneOnly])));
    await listContacts({ limit: 50, cursor: 'cursor-2' });
    expect(new URL(http.calls[0]!.url).searchParams.get('cursor')).toBe('cursor-2');
  });

  it('refuses an answer that is not a contact page', async () => {
    mockFetch(jsonResponse(200, { data: [{ id: 'not-a-contact' }], page: {} }));
    await expect(listContacts({ limit: 50 })).rejects.toMatchObject({
      code: 'CLIENT_CONTRACT_MISMATCH',
    });
  });

  it('reads one contact and its tags', async () => {
    const http = mockFetch(jsonResponse(200, aarav), jsonResponse(200, [vipTag]));
    await expect(getContact(aarav.id)).resolves.toMatchObject({ rowVersion: 3 });
    await expect(getContactTags(aarav.id)).resolves.toEqual([vipTag]);
    expect(http.calls.map((call) => new URL(call.url).pathname)).toEqual([
      `/v2/contacts/${aarav.id}`,
      `/v2/contacts/${aarav.id}/tags`,
    ]);
  });

  it('creates a contact with a POST that carries the idempotency key', async () => {
    const http = mockFetch(jsonResponse(201, aarav));
    await createContact({ name: 'Aarav Sharma', phone: '+919812345678' }, 'key-1');
    const call = http.calls[0]!;
    expect(new URL(call.url).pathname).toBe('/v2/contacts');
    expect(call.init.method).toBe('POST');
    expect(call.body).toEqual({ name: 'Aarav Sharma', phone: '+919812345678' });
    expect(call.headers['Idempotency-Key']).toBe('key-1');
  });

  it('updates with the row version it read, and fails with the conflict code on a stale one', async () => {
    const http = mockFetch(
      jsonResponse(200, aarav),
      jsonResponse(409, {
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        code: 'ROW_VERSION_CONFLICT',
      }),
    );
    await updateContact(aarav.id, { name: 'A. Sharma', rowVersion: 3 });
    expect(http.calls[0]?.init.method).toBe('PATCH');
    expect(http.calls[0]?.body).toEqual({ name: 'A. Sharma', rowVersion: 3 });
    const failure: unknown = await updateContact(aarav.id, { name: 'X', rowVersion: 2 }).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).isRowVersionConflict).toBe(true);
  });

  it('attaches a tag by name and detaches it by id', async () => {
    const http = mockFetch(jsonResponse(201, vipTag), jsonResponse(204));
    await expect(attachContactTag(aarav.id, 'VIP')).resolves.toMatchObject({ name: 'VIP' });
    await detachContactTag(aarav.id, vipTag.id);
    expect(http.calls[0]?.init.method).toBe('POST');
    expect(http.calls[0]?.body).toEqual({ name: 'VIP' });
    expect(http.calls[1]?.init.method).toBe('DELETE');
    expect(new URL(http.calls[1]!.url).pathname).toBe(`/v2/contacts/${aarav.id}/tags/${vipTag.id}`);
  });

  it('deletes a contact with a DELETE on its own path', async () => {
    const http = mockFetch(jsonResponse(204));
    await deleteContact(aarav.id);
    expect(http.calls[0]?.init.method).toBe('DELETE');
    expect(new URL(http.calls[0]!.url).pathname).toBe(`/v2/contacts/${aarav.id}`);
  });
});
