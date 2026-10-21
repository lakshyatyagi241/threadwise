import { describe, expect, it } from 'vitest';
import { team } from './fixtures';
import {
  TEAM_SWATCHES,
  defaultHours,
  emptyTeamForm,
  formFromTeam,
  hoursProblem,
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

describe('handoff settings of a team (BL-396)', () => {
  const week = Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((k) => [
      k,
      { enabled: k !== 'sun', from: '08:00', to: '16:00' },
    ]),
  );

  it('reads the saved hours, time zone and default assignee back into the form', () => {
    const t = team(1, {
      unusedSettings: {
        businessHours: { days: week },
        timezone: 'Asia/Kolkata',
        defaultAssignee: { id: 'u1', fullName: 'Asha' },
      },
    });
    const form = formFromTeam(t);
    expect(form.defaultAssigneeId).toBe('u1');
    expect(form.timezone).toBe('Asia/Kolkata');
    expect(form.hours?.mon).toEqual({ enabled: true, from: '08:00', to: '16:00' });
    expect(form.hours?.sun.enabled).toBe(false);
  });

  it('no saved hours means always open, and a stored value this build cannot read starts from the default week', () => {
    expect(formFromTeam(team(1)).hours).toBeNull();
    const odd = team(1, {
      unusedSettings: { businessHours: { mon: ['09:00', '17:00'] }, timezone: null, defaultAssignee: null },
    });
    expect(formFromTeam(odd).hours).toEqual(defaultHours());
  });

  it('sends the hours with their time zone, and null (always open) when they are off', () => {
    const t = team(1, { rowVersion: 3 });
    const on = {
      ...formFromTeam(t),
      memberIds: ['u1'],
      defaultAssigneeId: 'u1',
      timezone: 'Europe/London',
      hours: defaultHours(),
    };
    const update = toUpdateInput(on, t, false);
    expect(update.timezone).toBe('Europe/London');
    expect(update.defaultAssigneeId).toBe('u1');
    expect(update.businessHours?.days.mon).toEqual({ enabled: true, from: '09:00', to: '18:00' });
    const off = toUpdateInput({ ...on, hours: null }, t, false);
    expect(off.businessHours).toBeNull();
    expect(off.timezone).toBeNull();
  });

  it('drops a default assignee who is no longer on the team', () => {
    const t = team(1);
    const form = { ...formFromTeam(t), memberIds: ['u2'], defaultAssigneeId: 'u1' };
    expect(toUpdateInput(form, t, false).defaultAssigneeId).toBeNull();
    expect(toCreateInput({ ...emptyTeamForm(), name: 'A', defaultAssigneeId: 'u1' }).defaultAssigneeId).toBeNull();
  });

  it('flags an open day with a missing or equal opening and closing time', () => {
    expect(hoursProblem(null)).toBe(false);
    expect(hoursProblem(defaultHours())).toBe(false);
    const bad = defaultHours();
    bad.mon = { enabled: true, from: '09:00', to: '09:00' };
    expect(hoursProblem(bad)).toBe(true);
    bad.mon = { enabled: false, from: '', to: '' };
    expect(hoursProblem(bad)).toBe(false);
  });
});
