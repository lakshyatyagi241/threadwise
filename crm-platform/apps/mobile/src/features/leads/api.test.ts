import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { SOURCE_ID, eventPage, facebookForm, hookAddress, reviewLead } from '@/test/leads-fixtures';
import {
  getLeadSource,
  listLeadEvents,
  listLeadSources,
  retryLeadEvent,
  setLeadSourceStatus,
} from './api';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

const url = (call: { url: string } | undefined) => new URL((call as { url: string }).url);

describe('leads api', () => {
  it('lists the sources and reads one', async () => {
    const http = mockFetch(
      jsonResponse(200, { data: [facebookForm], hookAddress }),
      jsonResponse(200, facebookForm),
    );
    await expect(listLeadSources()).resolves.toMatchObject({
      data: [{ name: 'Facebook lead form' }],
    });
    await getLeadSource(SOURCE_ID);
    expect(url(http.calls[0]).pathname).toBe('/v2/lead-sources');
    expect(url(http.calls[1]).pathname).toBe(`/v2/lead-sources/${SOURCE_ID}`);
  });

  it('pauses a source with the version that was read', async () => {
    const http = mockFetch(jsonResponse(200, { ...facebookForm, status: 'paused', rowVersion: 4 }));
    const result = await setLeadSourceStatus(SOURCE_ID, 3, 'paused', 'key-1');
    expect(http.calls[0].init.method).toBe('PATCH');
    expect(http.calls[0].body).toEqual({ rowVersion: 3, status: 'paused' });
    expect(http.calls[0].headers['Idempotency-Key']).toBe('key-1');
    expect(result.status).toBe('paused');
  });

  it('pages the leads of a source and sends only the filters that are set', async () => {
    const http = mockFetch(jsonResponse(200, eventPage([reviewLead], 'c-2')));
    const page = await listLeadEvents(SOURCE_ID, {
      limit: 25,
      cursor: 'c-1',
      status: 'needs_review',
    });
    expect(url(http.calls[0]).pathname).toBe(`/v2/lead-sources/${SOURCE_ID}/events`);
    expect(Object.fromEntries(url(http.calls[0]).searchParams)).toEqual({
      limit: '25',
      cursor: 'c-1',
      status: 'needs_review',
    });
    expect(page.page.nextCursor).toBe('c-2');
  });

  it('asks for every status when none is given', async () => {
    const http = mockFetch(jsonResponse(200, eventPage([])));
    await listLeadEvents(SOURCE_ID, { limit: 25 });
    expect(Object.fromEntries(url(http.calls[0]).searchParams)).toEqual({ limit: '25' });
  });

  it('retries a lead with a POST and returns the event as it is now', async () => {
    const http = mockFetch(jsonResponse(200, { event: { ...reviewLead, status: 'created' } }));
    const answer = await retryLeadEvent(SOURCE_ID, reviewLead.id, 'key-2');
    expect(http.calls[0].init.method).toBe('POST');
    expect(url(http.calls[0]).pathname).toBe(
      `/v2/lead-sources/${SOURCE_ID}/events/${reviewLead.id}/retry`,
    );
    expect(answer.event.status).toBe('created');
  });
});
