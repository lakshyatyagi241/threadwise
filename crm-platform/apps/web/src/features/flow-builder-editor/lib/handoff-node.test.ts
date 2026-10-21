import { flbDefaultNodeData, flbPortsFor } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  destinationOf,
  handoffProblem,
  isHandoffNode,
  peopleOf,
  returnMessageHasNoExit,
  upgradeLegacy,
} from './handoff-node';

describe('the Human handoff node data', () => {
  it('a new node is the Human handoff with three exits and an optional fourth (returned); an old Assign agent keeps its one exit', () => {
    const fresh = flbDefaultNodeData('assign');
    expect(isHandoffNode(fresh)).toBe(true);
    expect(flbPortsFor({ type: 'assign', data: fresh }).map((p) => p.id)).toEqual([
      'assigned',
      'waiting',
      'unavailable',
      'returned',
    ]);
    const old = { team: 't1', userId: '', message: 'note' };
    expect(isHandoffNode(old)).toBe(false);
    expect(flbPortsFor({ type: 'assign', data: old })).toHaveLength(1);
  });

  it('upgrading keeps the person or the team and the note, and starts the new fields empty', () => {
    expect(upgradeLegacy({ team: 't1', userId: '', message: 'hello' })).toMatchObject({
      handoff: 2,
      destination: 'team',
      team: 't1',
      message: 'hello',
      customerMessage: '',
      offHoursMessage: '',
      returnMessage: '',
    });
    expect(upgradeLegacy({ team: 't1', userId: 'u1' })).toMatchObject({
      destination: 'person',
      userId: 'u1',
    });
  });

  it('reads the destination, defaulting to a team', () => {
    expect(destinationOf({})).toBe('team');
    expect(destinationOf({ destination: 'person' })).toBe('person');
    expect(destinationOf({ destination: 'rules' })).toBe('rules');
    expect(destinationOf({ destination: 'nonsense' })).toBe('team');
  });

  it('asks for what the destination needs, and nothing for the assignment rules', () => {
    expect(handoffProblem({ handoff: 2, destination: 'team', team: '' })).toBe('chooseTeam');
    expect(handoffProblem({ handoff: 2, destination: 'team', team: 't1' })).toBeNull();
    expect(handoffProblem({ handoff: 2, destination: 'person', userId: '' })).toBe('choosePerson');
    expect(handoffProblem({ handoff: 2, destination: 'rules' })).toBeNull();
    // the older node always needed a team
    expect(handoffProblem({ team: '' })).toBe('chooseTeam');
    expect(handoffProblem({ team: 't1' })).toBeNull();
  });

  it('lists every member of every team once', () => {
    const a = { id: 'u1', name: 'Asha' };
    const b = { id: 'u2', name: 'Ben' };
    expect(peopleOf([{ members: [a, b] }, { members: [b] }])).toEqual([a, b]);
  });
});

describe('the message for when the bot is back', () => {
  it('needs the returned exit: a message with no wire on it is reported, an empty one never is', () => {
    const d = { handoff: 2, returnMessage: 'Hi, I am back' };
    expect(returnMessageHasNoExit(d, false)).toBe(true);
    expect(returnMessageHasNoExit(d, true)).toBe(false);
    expect(returnMessageHasNoExit({ handoff: 2, returnMessage: '   ' }, false)).toBe(false);
    // the older Assign agent step has no such exit and no message
    expect(returnMessageHasNoExit({ returnMessage: 'x' }, false)).toBe(false);
  });
});
