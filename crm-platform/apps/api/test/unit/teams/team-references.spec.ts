import { describe, expect, it } from 'vitest';
import {
  routingActionsNameTeam,
  withoutTeam,
} from '../../../src/modules/workspaces-teams-tenancy/team-references';

const T = '11111111-1111-4111-8111-111111111111';
const U = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

describe('removing a deleted team from a routing rule (BL-380, gap 14)', () => {
  it('finds a rule that names the team', () => {
    expect(
      routingActionsNameTeam(
        [{ type: 'assign', strategy: 'round_robin', userIds: [], teamIds: [T] }],
        T,
      ),
    ).toBe(true);
    expect(routingActionsNameTeam([{ type: 'assign', userIds: [U], teamIds: [OTHER] }], T)).toBe(
      false,
    );
    expect(routingActionsNameTeam([{ type: 'mark_spam' }], T)).toBe(false);
    expect(routingActionsNameTeam(null, T)).toBe(false);
  });

  it('takes the team out and keeps the rest of the targets', () => {
    const out = withoutTeam(
      [{ type: 'assign', strategy: 'round_robin', userIds: [U], teamIds: [T, OTHER], rrCursor: 3 }],
      T,
    );
    expect(out.actions).toEqual([
      { type: 'assign', strategy: 'round_robin', userIds: [U], teamIds: [OTHER], rrCursor: 3 },
    ]);
    expect(out.deactivate).toBe(false);
  });

  it('a rule whose only target was the team loses the assignment but keeps its other actions', () => {
    const out = withoutTeam(
      [
        { type: 'assign', strategy: 'round_robin', userIds: [], teamIds: [T], rrCursor: null },
        { type: 'set_priority', priority: 'high' },
      ],
      T,
    );
    expect(out.actions).toEqual([{ type: 'set_priority', priority: 'high' }]);
    expect(out.deactivate).toBe(false);
  });

  it('switches off a rule left with nothing to do, and drops a reassignment that needed the assignment', () => {
    const out = withoutTeam(
      [
        { type: 'assign', strategy: 'round_robin', userIds: [], teamIds: [T] },
        { type: 'set_escalation', minutes: 10, reassign: true, priority: null },
        { type: 'note', description: 'sales west' },
      ],
      T,
    );
    expect(out.actions).toEqual([{ type: 'note', description: 'sales west' }]);
    expect(out.deactivate).toBe(true);
  });

  it('keeps an escalation priority when only its reassignment depended on the team', () => {
    const out = withoutTeam(
      [
        { type: 'assign', strategy: 'round_robin', userIds: [], teamIds: [T] },
        { type: 'set_escalation', minutes: 10, reassign: true, priority: 'urgent' },
      ],
      T,
    );
    expect(out.actions).toEqual([
      { type: 'set_escalation', minutes: 10, reassign: false, priority: 'urgent' },
    ]);
    expect(out.deactivate).toBe(false);
  });

  it('is idempotent: a second run changes nothing', () => {
    const once = withoutTeam([{ type: 'assign', userIds: [U], teamIds: [T] }], T);
    const twice = withoutTeam(once.actions, T);
    expect(twice.actions).toEqual(once.actions);
  });
});
