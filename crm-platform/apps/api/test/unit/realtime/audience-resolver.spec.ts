import { describe, expect, it, vi } from 'vitest';
import { AudienceResolver } from '../../../src/realtime/audience/audience.resolver';
import type { ConversationViewer } from '../../../src/realtime/audience/conversation-visibility';
import type { MemberDirectory } from '../../../src/realtime/audience/member-directory.service';

const MY_TEAM = 100;
const OTHER_TEAM = 200;

/** A workspace of five people: one of each scope, a team member, and someone with no grant. */
const WORKSPACE: ConversationViewer[] = [
  { userId: 1, scope: 'all', teamIds: [] },
  { userId: 2, scope: 'team', teamIds: [MY_TEAM] },
  { userId: 3, scope: 'team', teamIds: [OTHER_TEAM] },
  { userId: 4, scope: 'own', teamIds: [MY_TEAM] },
  { userId: 5, scope: null, teamIds: [MY_TEAM] },
];

function resolver() {
  const viewers = vi.fn(async () => WORKSPACE);
  const directory = { viewers } as unknown as MemberDirectory;
  return { resolver: new AudienceResolver(directory), viewers };
}
const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b);

describe('AudienceResolver.forConversation', () => {
  it('an unassigned conversation goes to the all-scope reader and to team-scope readers, not to own-scope or no grant', async () => {
    const { resolver: r } = resolver();
    const audience = await r.forConversation(1, { assigneeUserId: null, assigneeTeamId: null });
    expect(sorted(audience)).toEqual([1, 2, 3]);
  });

  it("one assigned to a person reaches that person (even with scope own), the all reader, nobody else's", async () => {
    const { resolver: r } = resolver();
    const audience = await r.forConversation(1, { assigneeUserId: 4, assigneeTeamId: null });
    expect(sorted(audience)).toEqual([1, 4]);
  });

  it('one assigned to a team reaches that team (team scope) and the all reader, not another team', async () => {
    const { resolver: r } = resolver();
    const audience = await r.forConversation(1, { assigneeUserId: null, assigneeTeamId: MY_TEAM });
    expect(sorted(audience)).toEqual([1, 2]);
  });

  it('never includes a member without a read grant, even their own assignment', async () => {
    const { resolver: r } = resolver();
    const audience = await r.forConversation(1, { assigneeUserId: 5, assigneeTeamId: MY_TEAM });
    expect(audience).not.toContain(5);
  });

  it('alsoUserIds adds people who must hear of the change (the previous assignee), excludeUserIds removes the actor', async () => {
    const { resolver: r } = resolver();
    const audience = await r.forConversation(
      1,
      { assigneeUserId: 2, assigneeTeamId: null },
      { alsoUserIds: [4, 4], excludeUserIds: [1] },
    );
    expect(sorted(audience)).toEqual([2, 4]);
  });

  it('asks the directory for the conversation read permission unless told otherwise', async () => {
    const { resolver: r, viewers } = resolver();
    await r.forConversation(9, { assigneeUserId: null, assigneeTeamId: null });
    await r.forConversation(
      9,
      { assigneeUserId: null, assigneeTeamId: null },
      { permission: 'inbox.conversation.note' },
    );
    expect(viewers).toHaveBeenNthCalledWith(1, 9, 'inbox.conversation.read');
    expect(viewers).toHaveBeenNthCalledWith(2, 9, 'inbox.conversation.note');
  });
});
