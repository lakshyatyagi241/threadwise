import { describe, expect, it } from 'vitest';
import { team } from './fixtures';
import {
  TEAM_SWATCHES,
  emptyTeamForm,
  formFromTeam,
  nameProblem,
  sameColor,
  swatchesFor,
  toCreateInput,
  toUpdateInput,
  toggle,
} from './team-form';

describe('team form', () => {
  it('starts on Reference defaults: first swatch, manual strategy, nobody picked', () => {
    expect(emptyTeamForm()).toEqual({
      name: '',
      color: TEAM_SWATCHES[0],
      assignmentStrategy: 'manual',
      memberIds: [],
      deviceIds: [],
    });
  });

  it('loads a team into the form', () => {
    const t = team(1, {
      color: '#13478A',
      assignmentStrategy: 'sticky',
      deviceIds: ['d1'],
      members: [{ id: 'm1', fullName: 'A', presence: 'online', isLead: false, capacity: 20 }],
    });
    expect(formFromTeam(t)).toEqual({
      name: 'Team 1',
      color: '#13478A',
      assignmentStrategy: 'sticky',
      memberIds: ['m1'],
      deviceIds: ['d1'],
    });
  });

  it('trims the name for the create call', () => {
    expect(toCreateInput({ ...emptyTeamForm(), name: '  Sales  ' }).name).toBe('Sales');
  });

  it('sends rowVersion on update and leaves the devices alone unless the picker was shown', () => {
    const t = team(1, { rowVersion: 7, deviceIds: ['d1'] });
    const form = formFromTeam(t);
    expect(toUpdateInput(form, t, false)).not.toHaveProperty('deviceIds');
    expect(toUpdateInput(form, t, false).rowVersion).toBe(7);
    expect(toUpdateInput({ ...form, deviceIds: [] }, t, true).deviceIds).toEqual([]);
  });

  it('removes every member when the last box is unticked', () => {
    const t = team(1);
    expect(toUpdateInput({ ...formFromTeam(t), memberIds: [] }, t, false).memberIds).toEqual([]);
  });
});

describe('nameProblem', () => {
  it('requires a name of at most 64 characters', () => {
    expect(nameProblem('   ')).toBe('required');
    expect(nameProblem('Sales')).toBeNull();
    expect(nameProblem('x'.repeat(64))).toBeNull();
    expect(nameProblem('x'.repeat(65))).toBe('tooLong');
  });
});

describe('swatches', () => {
  it('compares colours without # and case', () => {
    expect(sameColor('#075e54', '075E54')).toBe(true);
    expect(sameColor('#075E54', '#13478A')).toBe(false);
  });

  it('adds a team colour that is not one of the six, so editing keeps it', () => {
    expect(swatchesFor('#075e54')).toHaveLength(6);
    expect(swatchesFor('#123456')).toHaveLength(7);
    expect(swatchesFor('#123456').at(-1)).toBe('#123456');
  });
});

describe('toggle', () => {
  it('adds and removes an id without mutating', () => {
    const base = ['a'];
    expect(toggle(base, 'b')).toEqual(['a', 'b']);
    expect(toggle(base, 'a')).toEqual([]);
    expect(base).toEqual(['a']);
  });
});
