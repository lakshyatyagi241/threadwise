import { ApiError } from '@/lib/api';
import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import {
  assignees,
  cityField,
  planSelect,
  priya,
  statusOptions,
} from '@/test/contact-properties-fixtures';
import { aarav } from '@/test/contacts-fixtures';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import {
  listAssignees,
  listContactFields,
  listContactStatusOptions,
  listFieldOptions,
  setContactAssignee,
} from './properties-api';

const pageOf = <T>(data: T[], next: string | null = null) => ({
  data,
  page: { nextCursor: next, hasMore: next !== null, limit: 200 },
});

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('properties api', () => {
  it('lists the properties of the contacts module, the switched-off ones included', async () => {
    const http = mockFetch(jsonResponse(200, pageOf([cityField, planSelect])));
    const result = await listContactFields();
    expect(result.map((f) => f.key)).toEqual(['city', 'plan']);
    expect(result[1]?.options?.map((o) => o.value)).toEqual(['basic', 'pro', 'legacy']);
    const url = new URL(http.calls[0]!.url);
    expect(url.pathname).toBe('/v2/fields');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      moduleKey: 'contacts',
      includeInactive: 'true',
      limit: '200',
    });
    expect(http.calls[0]?.init.method).toBe('GET');
    expect(http.calls[0]?.headers.Authorization).toBe('Bearer access-1');
  });

  it('follows the cursor to the end of the list', async () => {
    const http = mockFetch(
      jsonResponse(200, pageOf([cityField], 'cursor-2')),
      jsonResponse(200, pageOf([planSelect])),
    );
    const result = await listContactFields();
    expect(result.map((f) => f.key)).toEqual(['city', 'plan']);
    expect(new URL(http.calls[1]!.url).searchParams.get('cursor')).toBe('cursor-2');
    expect(http.remaining()).toBe(0);
  });

  it('refuses an answer that is not a property list', async () => {
    mockFetch(jsonResponse(200, pageOf([{ id: 'x' }])));
    await expect(listContactFields()).rejects.toMatchObject({ code: 'CLIENT_CONTRACT_MISMATCH' });
  });

  it('says so when the person may not read the properties', async () => {
    mockFetch(
      jsonResponse(403, {
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        code: 'RBAC_FORBIDDEN',
      }),
    );
    const failure: unknown = await listContactFields().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 403, code: 'RBAC_FORBIDDEN' });
  });

  it('reads the options of one property', async () => {
    const http = mockFetch(jsonResponse(200, planSelect.options));
    const result = await listFieldOptions(planSelect.id);
    expect(result.map((o) => o.label)).toEqual(['Basic', 'Pro', 'Legacy plan']);
    expect(new URL(http.calls[0]!.url).pathname).toBe(`/v2/fields/${planSelect.id}/options`);
  });

  it('lists the lifecycle stages, statuses and lost reasons of the contacts module', async () => {
    const http = mockFetch(jsonResponse(200, pageOf(statusOptions)));
    const result = await listContactStatusOptions();
    expect(result).toHaveLength(statusOptions.length);
    const url = new URL(http.calls[0]!.url);
    expect(url.pathname).toBe('/v2/status-options');
    expect(Object.fromEntries(url.searchParams)).toEqual({ moduleKey: 'contacts', limit: '200' });
  });

  it('lists the people a contact can be given to', async () => {
    const http = mockFetch(jsonResponse(200, assignees));
    expect(await listAssignees()).toEqual(assignees);
    expect(new URL(http.calls[0]!.url).pathname).toBe('/v2/contacts/assignees');
  });

  it('gives a contact to someone with one idempotency key, and reads the per-contact outcome', async () => {
    const http = mockFetch(jsonResponse(200, { succeeded: [aarav.id], failed: [] }));
    const result = await setContactAssignee({ ids: [aarav.id], ownerId: priya.id }, 'key-1');
    expect(result).toEqual({ succeeded: [aarav.id], failed: [] });
    expect(new URL(http.calls[0]!.url).pathname).toBe('/v2/contacts/assignee');
    expect(http.calls[0]?.init.method).toBe('POST');
    expect(http.calls[0]?.body).toEqual({ ids: [aarav.id], ownerId: priya.id });
    expect(http.calls[0]?.headers['Idempotency-Key']).toBe('key-1');
  });

  it('takes a contact from its owner with a null owner, and returns the failures instead of throwing', async () => {
    const failed = [{ id: aarav.id, code: 'FORBIDDEN', message: 'no' }];
    const http = mockFetch(jsonResponse(200, { succeeded: [], failed }));
    const result = await setContactAssignee({ ids: [aarav.id], ownerId: null });
    expect(result.failed).toEqual(failed);
    expect(http.calls[0]?.body).toEqual({ ids: [aarav.id], ownerId: null });
    expect(http.calls[0]?.headers['Idempotency-Key']).toEqual(expect.any(String));
  });

  it('throws the API error for a call the API refused as a whole', async () => {
    mockFetch(
      jsonResponse(404, {
        type: 'about:blank',
        title: 'Not found',
        status: 404,
        code: 'NOT_FOUND',
      }),
    );
    await expect(setContactAssignee({ ids: [aarav.id], ownerId: priya.id })).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});
