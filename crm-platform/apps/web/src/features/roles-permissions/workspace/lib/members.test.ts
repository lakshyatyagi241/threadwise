import { describe, expect, it } from 'vitest';
import type { UserResponse } from '@crm/contracts';
import {
  canChangeMemberRoles,
  filterMembers,
  generatePassword,
  grantableRoles,
  presetSlug,
  roleFilterCounts,
  rolesChanged,
  sortRoles,
  teamFilterOptions,
} from './members';

const U = (
  id: string,
  name: string,
  roles: string[],
  email = `${name}@x.io`,
  teams: string[] = [],
): UserResponse => ({
  id,
  email,
  fullName: name,
  status: 'active',
  roles: roles.map((r) => ({ id: r, name: r })),
  teams: teams.map((t, i) => ({
    id: t,
    name: `Team ${t}`,
    color: '#075E54',
    role: 'member' as const,
    isPrimary: i === 0,
  })),
  managers: [],
  rowVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
const members = [
  U('1', 'Ada', ['owner']),
  U('2', 'Bo', ['agent', 'custom']),
  U('3', 'Cy', ['agent']),
];

describe('presetSlug / sortRoles', () => {
  it('maps the Owner row (historical key admin) and the ladder', () => {
    expect(presetSlug('admin')).toBe('owner');
    expect(presetSlug('workspace_admin')).toBe('admin');
    expect(presetSlug(null)).toBeNull();
  });
  it('puts presets in ladder order before custom roles', () => {
    const sorted = sortRoles([
      { name: 'Zed', systemKey: null },
      { name: 'Viewer', systemKey: 'viewer' },
      { name: 'Owner', systemKey: 'admin' },
      { name: 'Alpha', systemKey: null },
    ]);
    expect(sorted.map((r) => r.name)).toEqual(['Owner', 'Viewer', 'Alpha', 'Zed']);
  });
});

describe('roleFilterCounts / filterMembers', () => {
  it('counts members per role (a two-role member counts in both)', () => {
    const c = roleFilterCounts(members);
    expect(c.all).toBe(3);
    expect(c.byRole.get('agent')).toBe(2);
    expect(c.byRole.get('custom')).toBe(1);
    expect(c.byRole.get('viewer')).toBeUndefined();
  });
  it('filters by role and by name or email', () => {
    expect(filterMembers(members, { roleId: 'agent', search: '' }).map((m) => m.id)).toEqual([
      '2',
      '3',
    ]);
    expect(filterMembers(members, { roleId: null, search: ' ADA@' }).map((m) => m.id)).toEqual([
      '1',
    ]);
    expect(filterMembers(members, { roleId: 'owner', search: 'bo' })).toEqual([]);
  });
});

describe('grantable roles and role-change gating', () => {
  const roles = [
    { id: 'owner', grantable: false },
    { id: 'agent', grantable: true },
    { id: 'custom', grantable: true },
  ];
  it('keeps only grantable roles', () => {
    expect(grantableRoles(roles).map((r) => r.id)).toEqual(['agent', 'custom']);
  });
  it('disables the caller own row, a member above the caller and a caller without the key', () => {
    const base = { roles, hasPermission: true };
    expect(canChangeMemberRoles({ ...base, isSelf: true, member: members[2]! })).toBe(false);
    expect(canChangeMemberRoles({ ...base, isSelf: false, member: members[0]! })).toBe(false);
    expect(canChangeMemberRoles({ ...base, isSelf: false, member: members[1]! })).toBe(true);
    expect(
      canChangeMemberRoles({ ...base, hasPermission: false, isSelf: false, member: members[2]! }),
    ).toBe(false);
  });
  it('detects a changed selection', () => {
    expect(rolesChanged([{ id: 'a' }, { id: 'b' }], ['b', 'a'])).toBe(false);
    expect(rolesChanged([{ id: 'a' }], ['a', 'b'])).toBe(true);
    expect(rolesChanged([{ id: 'a' }], ['b'])).toBe(true);
  });
});

describe('generatePassword', () => {
  it('has 16 characters covering four classes', () => {
    for (let i = 0; i < 20; i += 1) {
      const p = generatePassword();
      expect(p).toHaveLength(16);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[0-9]/);
      expect(p).toMatch(/[^A-Za-z0-9]/);
    }
  });
});

describe('team filter', () => {
  const people = [
    U('1', 'Ada', ['owner'], 'a@x.io', ['s']),
    U('2', 'Bo', ['agent'], 'b@x.io', ['s', 'h']),
    U('3', 'Cy', ['agent'], 'c@x.io', []),
  ];

  it('keeps only the people on the chosen team, together with the role and search filters', () => {
    expect(filterMembers(people, { roleId: null, search: '', teamId: 's' }).map((m) => m.id)).toEqual(['1', '2']);
    expect(filterMembers(people, { roleId: 'agent', search: '', teamId: 's' }).map((m) => m.id)).toEqual(['2']);
    expect(filterMembers(people, { roleId: null, search: 'cy', teamId: 's' })).toEqual([]);
    expect(filterMembers(people, { roleId: null, search: '', teamId: null })).toHaveLength(3);
    expect(filterMembers(people, { roleId: null, search: '' })).toHaveLength(3);
  });

  it('offers the teams of the people shown, by name, with how many are on each', () => {
    expect(teamFilterOptions(people)).toEqual([
      { id: 'h', name: 'Team h', count: 1 },
      { id: 's', name: 'Team s', count: 2 },
    ]);
    expect(teamFilterOptions([people[2]!])).toEqual([]);
  });
});
