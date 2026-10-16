import { ApiError } from '@/lib/api';
import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import {
  PIPELINE_ID,
  acmeDeal,
  activityPage,
  board,
  contactChoices,
  dealPage,
  lostReasons,
  noteEntry,
  settingsRequired,
  stageProposal,
  taskEntry,
  team,
  wonDeal,
} from '@/test/deals-fixtures';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import {
  addActivity,
  createDeal,
  deleteDeal,
  getBoard,
  getDeal,
  getDealSettings,
  listActivities,
  listAssignees,
  listDeals,
  listLostReasons,
  listPipelines,
  listStageDeals,
  markDealLost,
  markDealWon,
  moveDealStage,
  reopenDeal,
  searchContacts,
  setActivityDone,
  updateDeal,
} from './api';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

const url = (call: { url: string } | undefined) => new URL((call as { url: string }).url);

describe('deals api: reading', () => {
  it('asks for the board of a pipeline with one card per column and only the filters that are set', async () => {
    const http = mockFetch(jsonResponse(200, board));
    const result = await getBoard({
      pipelineId: PIPELINE_ID,
      limit: 1,
      q: 'acme',
      unassigned: true,
      ownerId: undefined,
    });
    expect(result.kpis.winRate).toBe(50);
    expect(result.stages).toHaveLength(4);
    const call = http.calls[0]!;
    expect(url(call).pathname).toBe('/v2/deals/board');
    expect(Object.fromEntries(url(call).searchParams)).toEqual({
      pipelineId: PIPELINE_ID,
      limit: '1',
      q: 'acme',
      unassigned: 'true',
    });
    expect(call.init.method).toBe('GET');
    expect(call.headers.Authorization).toBe('Bearer access-1');
  });

  it('pages one column of the board with its cursor', async () => {
    const http = mockFetch(jsonResponse(200, dealPage([acmeDeal], 'cursor-2')));
    const page = await listStageDeals(stageProposal.id, { limit: 25, cursor: 'cursor-1' });
    expect(page.page).toEqual({ nextCursor: 'cursor-2', hasMore: true, limit: 25 });
    expect(url(http.calls[0]).pathname).toBe(`/v2/deals/board/stages/${stageProposal.id}/deals`);
    expect(url(http.calls[0]).searchParams.get('cursor')).toBe('cursor-1');
  });

  it('lists the deals of a pipeline, newest first, narrowed by status', async () => {
    const http = mockFetch(jsonResponse(200, dealPage([wonDeal])));
    await listDeals({ pipelineId: PIPELINE_ID, limit: 50, status: 'won', source: 'api' });
    expect(url(http.calls[0]).pathname).toBe('/v2/deals');
    expect(Object.fromEntries(url(http.calls[0]).searchParams)).toEqual({
      pipelineId: PIPELINE_ID,
      limit: '50',
      status: 'won',
      source: 'api',
    });
  });

  it('reads one deal', async () => {
    const http = mockFetch(jsonResponse(200, acmeDeal));
    await expect(getDeal(acmeDeal.id)).resolves.toMatchObject({ rowVersion: 3, value: '12500.00' });
    expect(url(http.calls[0]).pathname).toBe(`/v2/deals/${acmeDeal.id}`);
  });

  it('refuses an answer that is not a board', async () => {
    mockFetch(jsonResponse(200, { pipeline: {}, stages: 'none' }));
    await expect(getBoard({ limit: 1 })).rejects.toMatchObject({
      code: 'CLIENT_CONTRACT_MISMATCH',
    });
  });

  it('refuses a deal whose amount is not a string', async () => {
    mockFetch(jsonResponse(200, { ...acmeDeal, value: 12500 }));
    await expect(getDeal(acmeDeal.id)).rejects.toMatchObject({ code: 'CLIENT_CONTRACT_MISMATCH' });
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
    await expect(getBoard({ limit: 1 })).rejects.toMatchObject({
      status: 422,
      code: 'PLAN_FEATURE_LOCKED',
    });
  });

  it('reports no connection as such', async () => {
    mockFetch(new TypeError('Network request failed'));
    const error: unknown = await getBoard({ limit: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isConnectivity).toBe(true);
  });

  it('lists the pipelines, the active lost reasons and the deal settings', async () => {
    const http = mockFetch(
      jsonResponse(200, []),
      jsonResponse(200, lostReasons),
      jsonResponse(200, settingsRequired),
    );
    await expect(listPipelines()).resolves.toEqual([]);
    await expect(listLostReasons()).resolves.toHaveLength(1);
    await expect(getDealSettings()).resolves.toEqual({ lostReasonRequired: true, rowVersion: 1 });
    expect(http.calls.map((call) => url(call).pathname)).toEqual([
      '/v2/pipelines',
      '/v2/deal-lost-reasons',
      '/v2/deal-settings',
    ]);
    expect(url(http.calls[1]).searchParams.get('activeOnly')).toBe('true');
  });

  it('lists the timeline of a deal a page at a time', async () => {
    const http = mockFetch(jsonResponse(200, activityPage([noteEntry, taskEntry], 'c-2')));
    const page = await listActivities(acmeDeal.id, { limit: 30, cursor: 'c-1' });
    expect(page.data).toHaveLength(2);
    expect(url(http.calls[0]).pathname).toBe(`/v2/deals/${acmeDeal.id}/activities`);
    expect(Object.fromEntries(url(http.calls[0]).searchParams)).toEqual({
      limit: '30',
      cursor: 'c-1',
    });
  });

  it('lists the team and searches contacts for the pickers', async () => {
    const http = mockFetch(jsonResponse(200, team), jsonResponse(200, contactChoices));
    await expect(listAssignees()).resolves.toHaveLength(3);
    await expect(searchContacts('aar')).resolves.toHaveLength(1);
    expect(url(http.calls[0]).pathname).toBe('/v2/contacts/assignees');
    expect(Object.fromEntries(url(http.calls[1]).searchParams)).toEqual({ q: 'aar', limit: '20' });
  });
});

describe('deals api: writing', () => {
  it('creates a deal with a POST that carries the idempotency key', async () => {
    const http = mockFetch(jsonResponse(201, acmeDeal));
    await createDeal({ title: 'New', currency: 'USD', value: '10.00' }, 'key-1');
    const call = http.calls[0]!;
    expect(url(call).pathname).toBe('/v2/deals');
    expect(call.init.method).toBe('POST');
    expect(call.body).toEqual({ title: 'New', currency: 'USD', value: '10.00' });
    expect(call.headers['Idempotency-Key']).toBe('key-1');
  });

  it('updates with the row version it read, and fails with the conflict code on a stale one', async () => {
    const http = mockFetch(
      jsonResponse(200, acmeDeal),
      jsonResponse(409, {
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        code: 'ROW_VERSION_CONFLICT',
      }),
    );
    await updateDeal(acmeDeal.id, { title: 'Renamed', rowVersion: 3 }, 'key-2');
    expect(http.calls[0]?.init.method).toBe('PATCH');
    expect(url(http.calls[0]).pathname).toBe(`/v2/deals/${acmeDeal.id}`);
    expect(http.calls[0]?.body).toEqual({ title: 'Renamed', rowVersion: 3 });
    const error: unknown = await updateDeal(acmeDeal.id, { rowVersion: 1 }).catch(
      (e: unknown) => e,
    );
    expect((error as ApiError).isRowVersionConflict).toBe(true);
  });

  it('moves a deal to a stage with its version and the reason for a lost one', async () => {
    const http = mockFetch(jsonResponse(200, acmeDeal));
    await moveDealStage(
      acmeDeal.id,
      { stageId: stageProposal.id, lostReason: 'Price', rowVersion: 3 },
      'key-3',
    );
    expect(http.calls[0]?.init.method).toBe('PATCH');
    expect(url(http.calls[0]).pathname).toBe(`/v2/deals/${acmeDeal.id}/stage`);
    expect(http.calls[0]?.body).toEqual({
      stageId: stageProposal.id,
      lostReason: 'Price',
      rowVersion: 3,
    });
    expect(http.calls[0]?.headers['Idempotency-Key']).toBe('key-3');
  });

  it('marks won, lost and reopens with POSTs that carry the version', async () => {
    const http = mockFetch(
      jsonResponse(200, wonDeal),
      jsonResponse(200, acmeDeal),
      jsonResponse(200, acmeDeal),
    );
    await markDealWon(acmeDeal.id, 3, 'key-4');
    await markDealLost(acmeDeal.id, { reason: 'Price', rowVersion: 3 });
    await reopenDeal(wonDeal.id, { rowVersion: 7 });
    expect(http.calls.map((call) => [call.init.method, url(call).pathname, call.body])).toEqual([
      ['POST', `/v2/deals/${acmeDeal.id}/won`, { rowVersion: 3 }],
      ['POST', `/v2/deals/${acmeDeal.id}/lost`, { reason: 'Price', rowVersion: 3 }],
      ['POST', `/v2/deals/${wonDeal.id}/reopen`, { rowVersion: 7 }],
    ]);
    expect(http.calls[0]?.headers['Idempotency-Key']).toBe('key-4');
  });

  it('deletes with a DELETE and expects nothing back', async () => {
    const http = mockFetch(jsonResponse(204));
    await expect(deleteDeal(acmeDeal.id, 'key-5')).resolves.toBeUndefined();
    expect(http.calls[0]?.init.method).toBe('DELETE');
    expect(url(http.calls[0]).pathname).toBe(`/v2/deals/${acmeDeal.id}`);
    expect(http.calls[0]?.headers['Idempotency-Key']).toBe('key-5');
  });

  it('adds a timeline entry, and completes or reopens a task of it', async () => {
    const http = mockFetch(
      jsonResponse(201, taskEntry),
      jsonResponse(200, { ...taskEntry, done: true }),
      jsonResponse(200, taskEntry),
    );
    await addActivity(
      acmeDeal.id,
      { type: 'task', body: 'Follow up', dueAt: '2026-10-31T09:00:00+05:30' },
      'key-6',
    );
    await setActivityDone(acmeDeal.id, taskEntry.id, true);
    await setActivityDone(acmeDeal.id, taskEntry.id, false);
    expect(http.calls.map((call) => [call.init.method, url(call).pathname])).toEqual([
      ['POST', `/v2/deals/${acmeDeal.id}/activities`],
      ['POST', `/v2/deals/${acmeDeal.id}/activities/${taskEntry.id}/complete`],
      ['POST', `/v2/deals/${acmeDeal.id}/activities/${taskEntry.id}/reopen`],
    ]);
    expect(http.calls[0]?.body).toEqual({
      type: 'task',
      body: 'Follow up',
      dueAt: '2026-10-31T09:00:00+05:30',
    });
  });
});
