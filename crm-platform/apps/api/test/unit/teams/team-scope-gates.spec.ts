import { describe, expect, it, vi } from 'vitest';
import { RbacService } from '../../../src/kernel/rbac/rbac.service';
import { RECORD_SCOPE_RANK, isTeamScope } from '@crm/contracts';
import { viewerReadsUnassigned } from '../../../src/realtime/audience/conversation-visibility';

/**
 * BL-382: the small rules around the new scope and the unassigned-queue permission.
 */
describe('scope order', () => {
  it('sorts own < team < team_and_below < all, so the widest allow wins and nobody grants wider than they hold', () => {
    expect(RECORD_SCOPE_RANK.own).toBeLessThan(RECORD_SCOPE_RANK.team);
    expect(RECORD_SCOPE_RANK.team).toBeLessThan(RECORD_SCOPE_RANK.team_and_below);
    expect(RECORD_SCOPE_RANK.team_and_below).toBeLessThan(RECORD_SCOPE_RANK.all);
  });
  it('names the two scopes that reach people through teams', () => {
    expect(isTeamScope('team')).toBe(true);
    expect(isTeamScope('team_and_below')).toBe(true);
    expect(isTeamScope('own')).toBe(false);
    expect(isTeamScope('all')).toBe(false);
    expect(isTeamScope(null)).toBe(false);
  });
});

describe('viewerReadsUnassigned: the read permission decides, acting rights keep their old rule', () => {
  it('for reading, it is exactly whether the person holds inbox.conversation.read_unassigned', () => {
    expect(viewerReadsUnassigned('inbox.conversation.read', 'team', true)).toBe(true);
    expect(viewerReadsUnassigned('inbox.conversation.read', 'team', false)).toBe(false);
    expect(viewerReadsUnassigned('inbox.conversation.read', 'team_and_below', false)).toBe(false);
  });
  it('for acting (reply, note, assign, resolve...) a team-scoped grant still covers the queue, an own-scoped one does not', () => {
    expect(viewerReadsUnassigned('inbox.conversation.reply', 'team', false)).toBe(true);
    expect(viewerReadsUnassigned('inbox.conversation.reply', 'team_and_below', false)).toBe(true);
    expect(viewerReadsUnassigned('inbox.conversation.reply', 'own', true)).toBe(false);
    expect(viewerReadsUnassigned('inbox.conversation.reply', null, true)).toBe(false);
  });
});

describe('RbacService: team_and_below needs the plan feature team_hierarchy (BL-383 fallback)', () => {
  const stored = new Map<
    string,
    { effect: 'allow' | 'deny'; scope: 'all' | 'team' | 'team_and_below' | 'own' }
  >([
    ['record.contacts.read', { effect: 'allow', scope: 'team_and_below' }],
    ['record.deals.read', { effect: 'allow', scope: 'team' }],
    ['record.tasks.read', { effect: 'deny', scope: 'team_and_below' }],
  ]);
  const make = (gate?: { enabled: (org: number) => Promise<boolean> }) => {
    const svc = new RbacService({} as never, {} as never, gate);
    vi.spyOn(svc as never, 'rawGrantsForUser').mockResolvedValue(stored as never);
    return svc;
  };

  it('keeps the scope when the workspace has the feature', async () => {
    const g = await make({ enabled: async () => true }).grantsForUser(1, 1);
    expect(g.get('record.contacts.read')?.scope).toBe('team_and_below');
  });

  it('resolves it as team when the plan lacks the feature, and touches nothing else', async () => {
    const g = await make({ enabled: async () => false }).grantsForUser(1, 1);
    expect(g.get('record.contacts.read')).toEqual({ effect: 'allow', scope: 'team' });
    expect(g.get('record.deals.read')?.scope).toBe('team');
    expect(g.get('record.tasks.read')?.effect).toBe('deny');
  });

  it('an entitlement that cannot be read narrows too (fail closed)', async () => {
    const g = await make({ enabled: async () => Promise.reject(new Error('down')) }).grantsForUser(
      1,
      1,
    );
    expect(g.get('record.contacts.read')?.scope).toBe('team');
  });

  it('asks nothing when no grant holds the scope', async () => {
    const enabled = vi.fn(async () => false);
    const svc = new RbacService({} as never, {} as never, { enabled });
    vi.spyOn(svc as never, 'rawGrantsForUser').mockResolvedValue(
      new Map([['x', { effect: 'allow', scope: 'team' }]]) as never,
    );
    await svc.grantsForUser(1, 1);
    expect(enabled).not.toHaveBeenCalled();
  });
});
