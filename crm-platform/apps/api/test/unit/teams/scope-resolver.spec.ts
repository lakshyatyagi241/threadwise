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
    for (const scope of ['own', 'team'] as RecordScope[]) {
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
function fakeTx(teamOf: Record<number, number[]>) {
  const execute = vi.fn(async (q: SQL) => {
    const { sql: text, params } = dialect.sqlToQuery(q);
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

describe('conversation mode (the inbox rule, unchanged)', () => {
  const people = [null, 1, 2];
  const teamsOf = [null, 7, 8];
  const viewers: Array<{ userId: number; scope: RecordScope | null; teamIds: number[] }> = [
    { userId: 1, scope: null, teamIds: [7] },
    { userId: 1, scope: 'all', teamIds: [] },
    { userId: 1, scope: 'team', teamIds: [] },
    { userId: 1, scope: 'team', teamIds: [7] },
    { userId: 1, scope: 'own', teamIds: [7] },
  ];

  /** The rule as it stood in realtime/audience/conversation-visibility.ts before BL-380, frozen. */
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
        if (a.assigneeUserId === v.userId) return true;
        if (a.assigneeTeamId !== null && v.teamIds.includes(a.assigneeTeamId)) return true;
        return a.assigneeUserId === null && a.assigneeTeamId === null;
      case 'own':
        return a.assigneeUserId === v.userId;
    }
  };

  it('allows exactly what the old switch allowed, for every viewer and assignment', () => {
    for (const v of viewers) {
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

  it('keeps an unassigned conversation visible to team scope, and only to team scope', () => {
    const open = { assigneeUserId: null, assigneeTeamId: null };
    expect(conversationScopeAllows({ userId: 1, scope: 'team', teamIds: [] }, open)).toBe(true);
    expect(conversationScopeAllows({ userId: 1, scope: 'own', teamIds: [] }, open)).toBe(false);
  });

  it('the SQL form says the same in words', () => {
    const q = (v: Parameters<typeof conversationScopeCondition>[0]) =>
      dialect.sqlToQuery(conversationScopeCondition(v, 'c')).sql;
    expect(q({ userId: 1, scope: null, teamIds: [] })).toBe('FALSE');
    expect(q({ userId: 1, scope: 'all', teamIds: [] })).toBe('TRUE');
    expect(q({ userId: 1, scope: 'own', teamIds: [] })).toBe('c.assignee_user_id = $1');
    expect(q({ userId: 1, scope: 'team', teamIds: [7, 8] })).toBe(
      '(c.assignee_user_id = $1 OR c.assignee_team_id IN ($2, $3) OR (c.assignee_user_id IS NULL AND c.assignee_team_id IS NULL))',
    );
  });
});
