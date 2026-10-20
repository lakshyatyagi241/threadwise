import { describe, expect, it } from 'vitest';
import { team } from './fixtures';
import {
  TEAM_SWATCHES,
  emptyTeamForm,
  formFromTeam,
  memberChanges,
  nameProblem,
  sameColor,
  swatchesFor,
  toCreateInput,
  toUpdateInput,
  toggle,
  withLead,
  withMemberRole,
  withMemberToggled,
} from './team-form';

const person = (id: string, role: 'member' | 'lead' = 'member', isPrimary = false) => ({
  id,
  fullName: id,
  presence: 'online' as const,
  isLead: role === 'lead',
  role,
  isPrimary,
  capacity: 20,
});

describe('team form', () => {
  it('starts on the defaults: first swatch, no parent, no manager, receives both, nobody picked', () => {
    expect(emptyTeamForm()).toEqual({
      name: '',
      color: TEAM_SWATCHES[0],
      description: '',
      assignmentStrategy: 'manual',
      parentId: null,
      leadId: null,
      receivesConversations: true,
      receivesRecords: true,
      memberIds: [],
      memberRoles: {},
      primaryChoice: {},
      deviceIds: [],
    });
  });

  it('loads a team into the form', () => {
    const t = team(1, {
      color: '#13478A',
      description: 'Inbound',
      assignmentStrategy: 'sticky',
      deviceIds: ['d1'],
      parentId: 'p1',
      lead: { id: 'm1', fullName: 'A' },
      receivesRecords: false,
      members: [person('m1', 'lead', true), person('m2')],
    });
    expect(formFromTeam(t)).toEqual({
      name: 'Team 1',
      color: '#13478A',
      description: 'Inbound',
      assignmentStrategy: 'sticky',
      parentId: 'p1',
      leadId: 'm1',
      receivesConversations: true,
      receivesRecords: false,
      memberIds: ['m1', 'm2'],
      memberRoles: { m1: 'lead', m2: 'member' },
      primaryChoice: {},
      deviceIds: ['d1'],
    });
  });

  it('trims the name and turns a blank description into null for the create call', () => {
    const input = toCreateInput({ ...emptyTeamForm(), name: '  Sales  ', description: '   ' });
    expect(input.name).toBe('Sales');
    expect(input.description).toBeNull();
  });

  it('sends rowVersion, parent and manager on update and leaves the devices alone unless the picker was shown', () => {
    const t = team(1, { rowVersion: 7, deviceIds: ['d1'] });
    const form = { ...formFromTeam(t), parentId: 'p9', leadId: 'm3' };
    const update = toUpdateInput(form, t, false);
    expect(update).not.toHaveProperty('deviceIds');
    expect(update.rowVersion).toBe(7);
    expect(update.parentId).toBe('p9');
    expect(update.leadId).toBe('m3');
    expect(toUpdateInput({ ...form, deviceIds: [] }, t, true).deviceIds).toEqual([]);
  });

  it('removes every member when the last box is unticked', () => {
    const t = team(1);
    expect(toUpdateInput({ ...formFromTeam(t), memberIds: [] }, t, false).memberIds).toEqual([]);
  });
});

describe('manager and member edits', () => {
  it('choosing a manager puts them on the team as a lead', () => {
    const form = withLead(emptyTeamForm(), 'm1');
    expect(form.leadId).toBe('m1');
    expect(form.memberIds).toEqual(['m1']);
    expect(form.memberRoles.m1).toBe('lead');
    expect(withLead(form, null).leadId).toBeNull();
  });

  it('un-ticking the manager, or making them a plain member, clears the manager', () => {
    const form = withLead(emptyTeamForm(), 'm1');
    expect(withMemberToggled(form, 'm1').leadId).toBeNull();
    expect(withMemberRole(form, 'm1', 'member').leadId).toBeNull();
    expect(withMemberRole(form, 'm1', 'lead').leadId).toBe('m1');
  });

  it('forgets the role and primary choice of somebody taken off the list', () => {
    const base = withMemberRole(withLead(emptyTeamForm(), 'm1'), 'm2', 'lead');
    const form = withMemberToggled({ ...base, primaryChoice: { m2: true } }, 'm2');
    expect(form.memberRoles).toEqual({ m1: 'lead' });
    expect(form.primaryChoice).toEqual({});
  });
});

describe('memberChanges', () => {
  it('lists only the roles and primary marks that differ from what the server returned', () => {
    const saved = team(1, {
      lead: { id: 'm1', fullName: 'A' },
      members: [person('m1', 'lead'), person('m2'), person('m3', 'lead', true)],
    });
    const form = {
      ...formFromTeam(saved),
      memberRoles: { m1: 'lead', m2: 'lead', m3: 'lead' } as const,
      primaryChoice: { m1: true, m3: false },
    };
    expect(memberChanges(form, saved)).toEqual([
      { userId: 'm1', isPrimary: true },
      { userId: 'm2', role: 'lead' },
      { userId: 'm3', isPrimary: false },
    ]);
  });

  it('sends nothing when the person changed nothing', () => {
    const saved = team(1, { members: [person('m1'), person('m2', 'lead', true)] });
    expect(memberChanges(formFromTeam(saved), saved)).toEqual([]);
  });

  it('never demotes the manager the server just made a lead', () => {
    const saved = team(1, { lead: { id: 'm1', fullName: 'A' }, members: [person('m1', 'lead')] });
    const form = { ...formFromTeam(saved), memberRoles: {} };
    expect(memberChanges(form, saved)).toEqual([]);
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
