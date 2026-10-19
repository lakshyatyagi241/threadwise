import { describe, expect, it } from 'vitest';
import { managersOf } from '../../../src/modules/admin/users/users.mapper';
import type { TeamTree, UserTeamRow } from '../../../src/modules/admin/users/users.repository';

const row = (over: Partial<UserTeamRow>): UserTeamRow => ({
  userId: 1,
  teamId: 1,
  teamUuid: 't1',
  teamName: 'Sales',
  teamColor: '#075E54',
  role: 'member',
  isPrimary: false,
  ...over,
});
const lead = (userId: number, name: string) => ({ userId, uuid: `u${userId}`, name });
const tree = (entries: Array<[number, number | null, ReturnType<typeof lead> | null]>): TeamTree =>
  new Map(entries.map(([id, parentId, l]) => [id, { parentId, lead: l }]));

describe('managersOf', () => {
  it('is the manager of the primary team when that team has one', () => {
    const t = tree([
      [1, null, lead(10, 'Mina')],
      [2, null, lead(11, 'Raj')],
    ]);
    const rows = [row({ teamId: 1, isPrimary: true }), row({ teamId: 2 })];
    expect(managersOf(1, rows, t)).toEqual([{ id: 'u10', fullName: 'Mina' }]);
  });

  it('falls back to the managers of every team, each once, when there is no primary team or it has none above', () => {
    const t = tree([
      [1, null, lead(10, 'Mina')],
      [2, null, lead(11, 'Raj')],
      [3, null, lead(10, 'Mina')],
      [4, null, null],
    ]);
    const rows = [row({ teamId: 1 }), row({ teamId: 2 }), row({ teamId: 3 })];
    expect(managersOf(1, rows, t).map((m) => m.id)).toEqual(['u10', 'u11']);
    const primaryWithout = [row({ teamId: 4, isPrimary: true }), row({ teamId: 2 })];
    expect(managersOf(1, primaryWithout, t)).toEqual([{ id: 'u11', fullName: 'Raj' }]);
  });

  it("a team's own manager is managed by the manager of the parent team, going up until somebody else is found", () => {
    const t = tree([
      [1, null, lead(10, 'Mina')], // Sales
      [2, 1, lead(1, 'Me')], // Sales West, managed by the person asking
      [3, 2, null], // Sales West A, no manager of its own
    ]);
    expect(managersOf(1, [row({ teamId: 2, isPrimary: true })], t)).toEqual([
      { id: 'u10', fullName: 'Mina' },
    ]);
    // A member of the sub-team with no manager looks up two levels and finds Sales West's manager first.
    expect(managersOf(5, [row({ userId: 5, teamId: 3, isPrimary: true })], t)).toEqual([
      { id: 'u1', fullName: 'Me' },
    ]);
  });

  it("the top manager has nobody above them, and other people's rows are ignored", () => {
    const t = tree([[1, null, lead(1, 'Me')]]);
    expect(managersOf(1, [row({ teamId: 1, isPrimary: true, role: 'lead' })], t)).toEqual([]);
    expect(managersOf(2, [row({ userId: 2, teamId: 1 })], t)).toEqual([
      { id: 'u1', fullName: 'Me' },
    ]);
    expect(managersOf(3, [row({ userId: 2, teamId: 1 })], t)).toEqual([]);
  });

  it('cannot loop on bad data', () => {
    const t = tree([
      [1, 2, null],
      [2, 1, null],
    ]);
    expect(managersOf(1, [row({ teamId: 1, isPrimary: true })], t)).toEqual([]);
  });
});
