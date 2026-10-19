import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { assignees, fallback, pricing, rulesOf } from '@/test/routing-fixtures';
import {
  deleteRule,
  duplicateRule,
  fetchAssigneeNames,
  fetchRoutingSettings,
  fetchRule,
  fetchRules,
  reorderRules,
  saveRoutingSettings,
  updateRule,
} from './routing-api';

const url = (call: { url: string } | undefined) => new URL(call?.url ?? 'http://x');

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('the auto-assignment API', () => {
  it('asks for a page of rules with only the filters that are set', async () => {
    const http = mockFetch(
      jsonResponse(200, rulesOf([pricing])),
      jsonResponse(200, rulesOf([fallback])),
    );
    await expect(fetchRules(' ', undefined)).resolves.toMatchObject({ total: 1 });
    await fetchRules(' price ', 'cursor-1');
    expect(url(http.calls[0]).pathname).toBe('/v2/inbox/routing/rules');
    expect([...url(http.calls[0]).searchParams.keys()]).toEqual(['limit']);
    expect(Object.fromEntries(url(http.calls[1]).searchParams)).toEqual({
      q: 'price',
      limit: '50',
      cursor: 'cursor-1',
    });
  });

  it('reads one rule, switches it with the version that was read, copies it, reorders and deletes', async () => {
    const http = mockFetch(
      jsonResponse(200, pricing),
      jsonResponse(200, pricing),
      jsonResponse(201, fallback),
      jsonResponse(200, { ok: true }),
      new Response(null, { status: 204 }),
    );
    await fetchRule(pricing.id);
    await updateRule(pricing.id, { rowVersion: 3, isActive: false });
    await duplicateRule(pricing.id);
    await reorderRules([fallback.id, pricing.id]);
    await deleteRule(pricing.id);
    expect(http.calls.map((c) => [c.init.method, url(c).pathname])).toEqual([
      ['GET', `/v2/inbox/routing/rules/${pricing.id}`],
      ['PATCH', `/v2/inbox/routing/rules/${pricing.id}`],
      ['POST', `/v2/inbox/routing/rules/${pricing.id}/duplicate`],
      ['POST', '/v2/inbox/routing/rules/reorder'],
      ['DELETE', `/v2/inbox/routing/rules/${pricing.id}`],
    ]);
    expect(http.calls[1]?.body).toEqual({ rowVersion: 3, isActive: false });
    expect(http.calls[3]?.body).toEqual({ ids: [fallback.id, pricing.id] });
  });

  it('reads and saves the setting that keeps a returning contact with their agent', async () => {
    const http = mockFetch(
      jsonResponse(200, { keepContactAgent: false }),
      jsonResponse(200, { keepContactAgent: true }),
    );
    await expect(fetchRoutingSettings()).resolves.toEqual({ keepContactAgent: false });
    await expect(saveRoutingSettings(true)).resolves.toEqual({ keepContactAgent: true });
    expect(http.calls[1]?.init.method).toBe('PUT');
    expect(http.calls[1]?.body).toEqual({ keepContactAgent: true });
  });

  it('reads the names of the agents and teams', async () => {
    mockFetch(jsonResponse(200, assignees));
    await expect(fetchAssigneeNames()).resolves.toMatchObject({ teams: [{ name: 'Sales' }] });
  });

  it('refuses an answer in a shape this build does not understand', async () => {
    mockFetch(jsonResponse(200, { data: [{ id: 1 }] }));
    await expect(fetchRules('', undefined)).rejects.toMatchObject({
      code: 'CLIENT_CONTRACT_MISMATCH',
    });
  });
});
