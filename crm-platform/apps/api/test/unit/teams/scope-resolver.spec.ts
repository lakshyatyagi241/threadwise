import { PgDialect } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { RecordScope } from '@crm/contracts';
import type { Tx } from '@crm/db';
import {
  canActOn,
  conversationScopeAllows,
  conversationScopeCondition,
  scopeOwnerCondition,
  scopeOwnerPredicate,
  teamPeers,
  teamPeersBelow,
  withDescendants,
} from '../../../src/kernel/rbac/scope';

const dialect = new PgDialect();
const render = (q: SQL | undefined) => (q ? dialect.sqlToQuery(q) : null);

describe('scopeOwnerCondition (BL-380)', () => {
  const cols = [sql`t.assignee_id`, sql`t.created_by`];

  it('adds nothing for all', () => {
    expect(scopeOwnerCondition({ orgId: 1, userId: 5 }, 'all', cols)).toBeUndefined();
    expect(scopeOwnerCondition({ orgId: 1, userId: null }, 'all', cols)).toBeUndefined();
  });

  it('sees nothing without a signed-in person below all', () => {
    for (const scope of ['own', 'team', 'team_and_below'] as RecordScope[]) {
      expect(render(scopeOwnerCondition({ orgId: 1, userId: null }, scope, cols))?.sql).toBe(
        'false',
      );
      expect(render(scopeOwnerCondition({ orgId: 1, userId: undefined }, scope, cols))?.sql).toBe(
        'false',
      );
    }
  });

  it('own is any person column being me, creator included', () => {
    const q = render(scopeOwnerCondition({ orgId: 1, userId: 5 }, 'own', cols))!;
    expect(q.sql).toBe('(t.assignee_id = $1 OR t.created_by = $2)');
    expect(q.params).toEqual([5, 5]);
  });

  it('a single column needs no brackets', () => {
    const q = render(scopeOwnerCondition({ orgId: 1, userId: 5 }, 'own', sql`f.created_by`))!;
    expect(q.sql).toBe('f.created_by = $1');
  });

  it('team is own plus the teammates on every column, so a person in no team still sees their own', () => {
    const q = render(scopeOwnerCondition({ orgId: 1, userId: 5 }, 'team', cols))!;
    expect(q.sql).toContain('t.assignee_id = $1');
    expect(q.sql).toContain('t.created_by = $2');
    expect(q.sql.match(/FROM team_members tm1/g)).toHaveLength(2);
    expect(q.sql).toContain('t.assignee_id IN (SELECT tm2.user_id');
    expect(q.sql).toContain('t.created_by IN (SELECT tm2.user_id');
  });

  it('team_and_below is team with the teams below mine: one recursive, depth-bounded walk per column', () => {
    const q = render(scopeOwnerCondition({ orgId: 1, userId: 5 }, 'team_and_below', cols))!;
    expect(q.sql).toContain('t.assignee_id = $1');
    expect(q.sql).toContain('t.created_by = $2');
    expect(q.sql.match(/WITH RECURSIVE team_tree/g)).toHaveLength(2);
    expect(q.sql).toContain('JOIN teams t ON t.org_id = $');
    expect(q.sql).toContain('team_tree.depth < $');
    // The bound is a parameter, not a literal: 10 levels at most.
    expect(q.params).toContain(10);
    expect(q.sql).not.toContain('tm1');
  });

  it('a record with no column to look at is never visible below all', () => {
    expect(render(scopeOwnerCondition({ orgId: 1, userId: 5 }, 'team', []))?.sql).toBe('false');
  });

  it('the predicate form never yields NULL', () => {
    expect(render(scopeOwnerPredicate({ orgId: 1, userId: 5 }, 'all', cols))?.sql).toBe('TRUE');
    expect(render(scopeOwnerPredicate({ orgId: 1, userId: 5 }, 'own', cols))?.sql).toMatch(
      /^COALESCE\(/,
    );
  });
});

/** A transaction that answers the team lookup from a fixture and counts the queries. */
function fakeTx(teamOf: Record<number, number[]>, parentOf: Record<number, number | null> = {}) {
  const execute = vi.fn(async (q: SQL) => {
    const { sql: text, params } = dialect.sqlToQuery(q);
    if (text.includes('WITH RECURSIVE team_tree')) {
      // The reach of `team_and_below`: the actor's teams plus everything below them, then the people in those teams.
      // Parameters: org, org, USER, org, depth.
      const me = Number(params[2]);
      const parents = new Map(Object.entries(parentOf).map(([k, v]) => [Number(k), v]));
      const reach = new Set(withDescendants(teamOf[me] ?? [], parents));
      const peers = new Set<number>();
      for (const [u, teams] of Object.entries(teamOf)) {
        if (teams.some((t) => reach.has(t))) peers.add(Number(u));
      }
      return { rows: [...peers].map((user_id) => ({ user_id })) };
    }
    if (text.includes('DISTINCT tm2.user_id')) {
      const me = Number(params[1]);
      const mine = teamOf[me] ?? [];
      const peers = new Set<number>();
      for (const [u, teams] of Object.entries(teamOf)) {
        if (teams.some((t) => mine.includes(t))) peers.add(Number(u));
      }
      return { rows: [...peers].map((user_id) => ({ user_id })) };
    }
    return { rows: [] };
  });
  return { tx: { execute } as unknown as Tx, execute };
}

describe('canActOn (one record, the same answer as the list)', () => {
  const teams = { 1: [10], 2: [10], 3: [20], 4: [10, 20], 5: [] as number[] };

  it.each([
    ['all', 5, [3], true],
    ['own', 1, [1], true],
    ['own', 1, [null, 1], true],
    ['own', 1, [2], false],
    ['own', 1, [null, null], false],
    ['team', 1, [2], true],
    ['team', 1, [3], false],
    ['team', 4, [3], true],
    ['team', 4, [1], true],
    ['team', 5, [5], true],
    ['team', 5, [1], false],
    ['team', 1, [null], false],
    ['team', 1, [3, 2], true],
  ] as Array<[RecordScope, number, Array<number | null>, boolean]>)(
    '%s as %i on %j is %s',
    async (scope, actor, people, expected) => {
      const { tx } = fakeTx(teams);
      expect(await canActOn(tx, { orgId: 1, userId: actor }, scope, people)).toBe(expected);
    },
  );

  describe('team_and_below (BL-382)', () => {
    // 1 and 2 are in team 10 (the top), 3 in team 20 (child of 10), 4 in team 30 (grandchild), 5 in team 40 (a sibling tree), 6 in no team.
    const t = { 1: [10], 2: [10], 3: [20], 4: [30], 5: [40], 6: [] as number[] };
    const parents = { 10: null, 20: 10, 30: 20, 40: null };

    it.each([
      ['team_and_below', 1, [3], true],
      ['team_and_below', 1, [4], true],
      ['team_and_below', 1, [5], false],
      ['team_and_below', 3, [1], false],
      ['team_and_below', 3, [4], true],
      ['team_and_below', 6, [6], true],
      ['team_and_below', 6, [1], false],
      ['team', 1, [3], false],
      ['team', 1, [2], true],
    ] as Array<[RecordScope, number, Array<number | null>, boolean]>)(
      '%s as %i on %j is %s',
      async (scope, actor, people, expected) => {
        const { tx } = fakeTx(t, parents);
        expect(await canActOn(tx, { orgId: 1, userId: actor }, scope, people)).toBe(expected);
      },
    );

    it('asks the database for the reach once per transaction', async () => {
      const { tx, execute } = fakeTx(t, parents);
      await canActOn(tx, { orgId: 1, userId: 1 }, 'team_and_below', [3]);
      await canActOn(tx, { orgId: 1, userId: 1 }, 'team_and_below', [4]);
      await teamPeersBelow(tx, { orgId: 1, userId: 1 });
      expect(execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('withDescendants (the in-memory twin of the recursive query)', () => {
    const parentOf = new Map<number, number | null>([
      [10, null],
      [20, 10],
      [30, 20],
      [40, null],
      [50, 10],
    ]);
    it('adds every team below, once', () => {
      expect(withDescendants([10], parentOf).sort()).toEqual([10, 20, 30, 50]);
      expect(withDescendants([20, 40], parentOf).sort()).toEqual([20, 30, 40]);
      expect(withDescendants([], parentOf)).toEqual([]);
    });
    it('survives a corrupt cycle and a depth bound', () => {
      const loop = new Map<number, number | null>([
        [1, 2],
        [2, 1],
      ]);
      expect(withDescendants([1], loop).sort()).toEqual([1, 2]);
      const chain = new Map<number, number | null>([
        [2, 1],
        [3, 2],
        [4, 3],
      ]);
      expect(withDescendants([1], chain, 2).sort()).toEqual([1, 2, 3]);
    });
  });

  it('refuses a caller with no person below all, and allows all', async () => {
    const { tx } = fakeTx(teams);
    expect(await canActOn(tx, { orgId: 1, userId: null }, 'own', [1])).toBe(false);
    expect(await canActOn(tx, { orgId: 1, userId: null }, 'all', [1])).toBe(true);
  });

  it('asks the database for the teammates once per transaction', async () => {
    const { tx, execute } = fakeTx(teams);
    await canActOn(tx, { orgId: 1, userId: 1 }, 'team', [2]);
    await canActOn(tx, { orgId: 1, userId: 1 }, 'team', [3]);
    await teamPeers(tx, { orgId: 1, userId: 1 });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('conversation mode (the inbox rule, with the unassigned queue as a permission)', () => {
  const people = [null, 1, 2];
  const teamsOf = [null, 7, 8];
  type V = {
    userId: number;
    scope: RecordScope | null;
    teamIds: number[];
    readsUnassigned: boolean;
  };
  const viewers: V[] = [
    { userId: 1, scope: null, teamIds: [7], readsUnassigned: true },
    { userId: 1, scope: 'all', teamIds: [], readsUnassigned: false },
    { userId: 1, scope: 'team', teamIds: [], readsUnassigned: true },
    { userId: 1, scope: 'team', teamIds: [7], readsUnassigned: true },
    { userId: 1, scope: 'team', teamIds: [7], readsUnassigned: false },
    { userId: 1, scope: 'team_and_below', teamIds: [7, 8], readsUnassigned: true },
    { userId: 1, scope: 'team_and_below', teamIds: [7, 8], readsUnassigned: false },
    { userId: 1, scope: 'own', teamIds: [7], readsUnassigned: true },
    { userId: 1, scope: 'own', teamIds: [7], readsUnassigned: false },
  ];

  /** The rule as it stood in realtime/audience/conversation-visibility.ts before BL-380, frozen (the unassigned part always on). */
  const legacy = (
    v: { userId: number; scope: RecordScope | null; teamIds: readonly number[] },
    a: { assigneeUserId: number | null; assigneeTeamId: number | null },
  ): boolean => {
    switch (v.scope) {
      case null:
        return false;
      case 'all':
        return true;
      case 'team':
      case 'team_and_below':
        if (a.assigneeUserId === v.userId) return true;
        if (a.assigneeTeamId !== null && v.teamIds.includes(a.assigneeTeamId)) return true;
        return a.assigneeUserId === null && a.assigneeTeamId === null;
      case 'own':
        return a.assigneeUserId === v.userId;
    }
  };

  it('with the permission, allows exactly what the old switch allowed (nothing changes for a migrated role)', () => {
    for (const v of viewers.filter((x) => x.readsUnassigned || x.scope === 'own')) {
      for (const assigneeUserId of people) {
        for (const assigneeTeamId of teamsOf) {
          const a = { assigneeUserId, assigneeTeamId };
          expect(conversationScopeAllows(v, a), `${v.scope} ${JSON.stringify(a)}`).toBe(
            legacy(v, a),
          );
        }
      }
    }
  });

  it('without the permission, a team viewer loses exactly the unassigned conversations', () => {
    for (const v of viewers.filter((x) => !x.readsUnassigned && x.scope !== null)) {
      for (const assigneeUserId of people) {
        for (const assigneeTeamId of teamsOf) {
          const a = { assigneeUserId, assigneeTeamId };
          const unassigned = assigneeUserId === null && assigneeTeamId === null;
          const expected =
            v.scope === 'all' || (legacy(v, a) && !(unassigned && v.scope !== 'own'));
          expect(conversationScopeAllows(v, a), `${v.scope} ${JSON.stringify(a)}`).toBe(expected);
        }
      }
    }
  });

  it('the permission widens team and team_and_below only: all and own ignore it', () => {
    const open = { assigneeUserId: null, assigneeTeamId: null };
    const view = (scope: RecordScope, readsUnassigned: boolean) =>
      conversationScopeAllows({ userId: 1, scope, teamIds: [], readsUnassigned }, open);
    expect(view('team', true)).toBe(true);
    expect(view('team', false)).toBe(false);
    expect(view('team_and_below', true)).toBe(true);
    expect(view('team_and_below', false)).toBe(false);
    expect(view('own', true)).toBe(false);
    expect(view('all', false)).toBe(true);
  });

  it('a conversation assigned to a team outside my reach is not unassigned', () => {
    const v: V = { userId: 1, scope: 'team', teamIds: [7], readsUnassigned: true };
    expect(conversationScopeAllows(v, { assigneeUserId: null, assigneeTeamId: 9 })).toBe(false);
    expect(
      conversationScopeAllows(
        { ...v, scope: 'team_and_below', teamIds: [7, 9] },
        { assigneeUserId: null, assigneeTeamId: 9 },
      ),
    ).toBe(true);
  });

  it('the SQL form says the same in words', () => {
    const q = (v: Parameters<typeof conversationScopeCondition>[0]) =>
      dialect.sqlToQuery(conversationScopeCondition(v, 'c')).sql;
    expect(q({ userId: 1, scope: null, teamIds: [], readsUnassigned: true })).toBe('FALSE');
    expect(q({ userId: 1, scope: 'all', teamIds: [], readsUnassigned: false })).toBe('TRUE');
    expect(q({ userId: 1, scope: 'own', teamIds: [], readsUnassigned: true })).toBe(
      'c.assignee_user_id = $1',
    );
    expect(q({ userId: 1, scope: 'team', teamIds: [7, 8], readsUnassigned: true })).toBe(
      '(c.assignee_user_id = $1 OR c.assignee_team_id IN ($2, $3) OR (c.assignee_user_id IS NULL AND c.assignee_team_id IS NULL))',
    );
    expect(q({ userId: 1, scope: 'team', teamIds: [7, 8], readsUnassigned: false })).toBe(
      '(c.assignee_user_id = $1 OR c.assignee_team_id IN ($2, $3))',
    );
    expect(q({ userId: 1, scope: 'team_and_below', teamIds: [], readsUnassigned: false })).toBe(
      '(c.assignee_user_id = $1)',
    );
  });
});
