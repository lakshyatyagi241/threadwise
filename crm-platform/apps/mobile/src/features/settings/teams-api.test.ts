import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { sales, teamPageOf } from '@/test/teams-fixtures';
import { createTeam, deleteTeam, fetchTeams, updateTeam } from './teams-api';

const url = (call: { url: string } | undefined) => new URL(call?.url ?? 'http://x');

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('the teams API', () => {
  it('asks for a page of teams, after the cursor when there is one', async () => {
    const http = mockFetch(
      jsonResponse(200, teamPageOf([sales])),
      jsonResponse(200, teamPageOf([])),
    );
    await expect(fetchTeams(undefined)).resolves.toMatchObject({ data: [{ name: 'Sales' }] });
    await fetchTeams('cursor-1');
    expect(url(http.calls[0]).pathname).toBe('/v2/workspace/teams');
    expect(Object.fromEntries(url(http.calls[0]).searchParams)).toEqual({ limit: '50' });
    expect(Object.fromEntries(url(http.calls[1]).searchParams)).toEqual({
      limit: '50',
      cursor: 'cursor-1',
    });
  });

  it('creates, edits and deletes with the right method and route', async () => {
    const http = mockFetch(
      jsonResponse(201, sales),
      jsonResponse(200, sales),
      new Response(null, { status: 204 }),
    );
    await createTeam({
      name: 'Sales',
      color: '#13478A',
      assignmentStrategy: 'manual',
      memberIds: [],
      deviceIds: [],
      receivesConversations: true,
      receivesRecords: true,
    });
    await updateTeam(sales.id, { name: 'Sales EU', memberIds: [], rowVersion: 4 });
    await deleteTeam(sales.id);
    expect(http.calls.map((c) => `${c.init.method} ${url(c).pathname}`)).toEqual([
      'POST /v2/workspace/teams',
      `PATCH /v2/workspace/teams/${sales.id}`,
      `DELETE /v2/workspace/teams/${sales.id}`,
    ]);
    expect(http.calls[1]?.body).toEqual({
      name: 'Sales EU',
      memberIds: [],
      rowVersion: 4,
    });
  });
});
