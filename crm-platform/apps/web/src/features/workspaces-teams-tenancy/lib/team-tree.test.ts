import { describe, expect, it } from 'vitest';
import { team } from './fixtures';
import { descendantIds, parentChoices, subtreeHeight, treeOrder } from './team-tree';

const sales = team(1, { name: 'Sales', depth: 1 });
const west = team(2, { name: 'West', parentId: sales.id, depth: 2 });
const east = team(3, { name: 'East', parentId: sales.id, depth: 2 });
const westA = team(4, { name: 'West A', parentId: west.id, depth: 3 });
const support = team(5, { name: 'Support', depth: 1 });

describe('treeOrder', () => {
  it('lists a team before its sub-teams, siblings by name', () => {
    const rows = treeOrder([westA, east, support, west, sales]);
    expect(rows.map((r) => [r.team.name, r.level])).toEqual([
      ['Sales', 0],
      ['East', 1],
      ['West', 1],
      ['West A', 2],
      ['Support', 0],
    ]);
  });

  it('shows a team whose parent is not loaded at the top instead of dropping it', () => {
    expect(treeOrder([west]).map((r) => [r.team.name, r.level])).toEqual([['West', 0]]);
  });

  it('places each team once even if the data loops, and still shows both', () => {
    const a = team(8, { name: 'A', parentId: team(9).id });
    const b = team(9, { name: 'B', parentId: a.id });
    const rows = treeOrder([a, b]);
    expect(rows.map((r) => r.team.name)).toEqual(['A', 'B']);
  });
});

describe('hierarchy helpers', () => {
  const all = [sales, west, east, westA, support];

  it('finds a team and everything below it', () => {
    expect([...descendantIds(all, west.id)].sort()).toEqual([west.id, westA.id].sort());
  });

  it('counts the levels of a subtree', () => {
    expect(subtreeHeight(all, sales.id)).toBe(3);
    expect(subtreeHeight(all, support.id)).toBe(1);
  });

  it('never offers a team or its own sub-teams as its parent, and blocks a placement that is too deep', () => {
    const choices = parentChoices(all, west, 3);
    expect(choices.map((c) => c.team.name)).toEqual(['Sales', 'East', 'Support']);
    // West has one level below it: under East (depth 2) it would be 4 deep, over the limit of 3.
    expect(choices.find((c) => c.team.name === 'East')!.allowed).toBe(false);
    expect(choices.find((c) => c.team.name === 'Sales')!.allowed).toBe(true);
    expect(choices.find((c) => c.team.name === 'Support')!.allowed).toBe(true);
  });

  it('offers every team for a new one, within the limit', () => {
    const choices = parentChoices(all, null, 3);
    expect(choices).toHaveLength(5);
    expect(choices.find((c) => c.team.name === 'West A')!.allowed).toBe(false);
  });
});
