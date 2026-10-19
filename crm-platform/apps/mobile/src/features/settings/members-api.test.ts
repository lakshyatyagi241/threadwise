import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { agent, pageOf, pendingAgent, summary, AGENT_ROLE } from '@/test/members-fixtures';
import {
  changeMemberRole,
  fetchMembers,
  fetchMembersSummary,
  inviteMember,
  removeMember,
  resendInvite,
  resetMemberPassword,
} from './members-api';

const url = (call: { url: string } | undefined) => new URL(call?.url ?? 'http://x');
const action = { member: agent, emailSent: true, inviteLink: null };

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('the team members API', () => {
  it('asks for a page of members with only the filters that are set', async () => {
    const http = mockFetch(jsonResponse(200, pageOf([agent])), jsonResponse(200, pageOf([agent])));
    await expect(fetchMembers({ q: ' ', tier: undefined }, undefined)).resolves.toMatchObject({
      data: [{ fullName: 'Meera Nair' }],
    });
    await fetchMembers({ q: ' meera ', tier: 'agent' }, 'cursor-1');
    expect(url(http.calls[0]).pathname).toBe('/v2/workspace/members');
    expect([...url(http.calls[0]).searchParams.keys()]).toEqual(['limit']);
    expect(Object.fromEntries(url(http.calls[1]).searchParams)).toEqual({
      q: 'meera',
      tier: 'agent',
      limit: '30',
      cursor: 'cursor-1',
    });
  });

  it('reads the summary', async () => {
    const http = mockFetch(jsonResponse(200, summary));
    await expect(fetchMembersSummary()).resolves.toMatchObject({ seats: { used: 4, limit: 10 } });
    expect(url(http.calls[0]).pathname).toBe('/v2/workspace/members/summary');
  });

  it('invites, sends an invite again, resets a password, changes a role and removes with the right method and route', async () => {
    const http = mockFetch(
      jsonResponse(201, { ...action, member: pendingAgent }),
      jsonResponse(200, action),
      jsonResponse(200, action),
      jsonResponse(200, agent),
      new Response(null, { status: 204 }),
    );
    await inviteMember({
      fullName: 'Rohan Mehta',
      email: 'rohan@example.test',
      roleId: AGENT_ROLE.id,
    });
    await resendInvite(pendingAgent.id);
    await resetMemberPassword(agent.id);
    await changeMemberRole(agent.id, { roleId: AGENT_ROLE.id, rowVersion: 3 });
    await removeMember(agent.id);
    expect(http.calls.map((c) => [c.init.method, url(c).pathname])).toEqual([
      ['POST', '/v2/workspace/members/invite'],
      ['POST', `/v2/workspace/members/${pendingAgent.id}/resend-invite`],
      ['POST', `/v2/workspace/members/${agent.id}/reset-password`],
      ['PATCH', `/v2/workspace/members/${agent.id}/role`],
      ['DELETE', `/v2/workspace/members/${agent.id}`],
    ]);
    expect(http.calls[3]?.body).toEqual({ roleId: AGENT_ROLE.id, rowVersion: 3 });
  });

  it('refuses an answer in a shape this build does not understand', async () => {
    mockFetch(jsonResponse(200, { data: [{ id: 1 }], page: {} }));
    await expect(fetchMembers({ q: '', tier: undefined }, undefined)).rejects.toMatchObject({
      code: 'CLIENT_CONTRACT_MISMATCH',
    });
  });
});
