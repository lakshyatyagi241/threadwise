import {
  agent,
  me,
  owner,
  pendingAgent,
  readOnlySummary,
  summary,
  ADMIN_ROLE,
  AGENT_ROLE,
} from '@/test/members-fixtures';
import {
  canChangeRole,
  canRemove,
  canReset,
  canResend,
  grantableRoles,
  hasActions,
  primaryRole,
  roleOptions,
  seatsLine,
  tierQuery,
  validateInvite,
  visibleTiers,
} from './member-rules';

const asker = summary.me;

describe('what a person may do to a member', () => {
  it('lets an admin change, reset and remove an agent', () => {
    expect(canChangeRole(agent, asker)).toBe(true);
    expect(canReset(agent, asker)).toBe(true);
    expect(canRemove(agent, asker)).toBe(true);
    expect(canResend(agent, asker)).toBe(false);
  });

  it('sends a pending invite again instead of resetting a password', () => {
    expect(canResend(pendingAgent, asker)).toBe(true);
    expect(canReset(pendingAgent, asker)).toBe(false);
  });

  it('never lets a person act on themselves', () => {
    expect(hasActions(me, asker)).toBe(false);
  });

  it('never lets a person act on someone of a higher tier, and never removes an owner', () => {
    expect(canChangeRole(owner, asker)).toBe(false);
    expect(canReset(owner, asker)).toBe(false);
    expect(canRemove(owner, asker)).toBe(false);
    expect(hasActions(owner, asker)).toBe(false);
  });

  it("lets an owner change another owner's role but still not remove them", () => {
    const ownerAsker = { ...asker, id: 'someone-else', tier: 'owner' as const };
    expect(canChangeRole(owner, ownerAsker)).toBe(true);
    expect(canRemove(owner, ownerAsker)).toBe(false);
  });

  it('offers nothing to a person with no rights', () => {
    const ro = readOnlySummary.me;
    expect(hasActions(agent, { ...ro, id: 'x' })).toBe(false);
  });

  it('needs the assign right to change a role, and the invite right for the rest', () => {
    expect(canChangeRole(agent, { ...asker, canAssignRoles: false })).toBe(false);
    expect(canRemove(agent, { ...asker, canInvite: false })).toBe(false);
  });
});

describe('roles', () => {
  it('shows the role whose tier is the display tier', () => {
    expect(primaryRole({ tier: 'agent', roles: [ADMIN_ROLE, AGENT_ROLE] })).toEqual(AGENT_ROLE);
    expect(primaryRole({ tier: 'custom', roles: [AGENT_ROLE] })).toEqual(AGENT_ROLE);
  });

  it('offers what may be granted, and keeps the current role visible but not pickable', () => {
    const options = roleOptions(summary.roles, primaryRole(owner));
    expect(options[0]).toMatchObject({ tier: 'owner', disabled: true });
    expect(options.filter((o) => !o.disabled).map((o) => o.tier)).toEqual([
      'admin',
      'manager',
      'agent',
      'viewer',
    ]);
  });

  it('orders the roles of an invitation agent first', () => {
    expect(grantableRoles(summary.roles).map((r) => r.tier)).toEqual([
      'agent',
      'manager',
      'admin',
      'viewer',
    ]);
  });
});

describe('filters and seats', () => {
  it('hides the custom filter until someone has a custom role, and sends no tier for "all"', () => {
    expect(visibleTiers(summary)).not.toContain('custom');
    expect(visibleTiers({ ...summary, counts: { ...summary.counts, custom: 1 } })).toContain(
      'custom',
    );
    expect(tierQuery('all')).toBeUndefined();
    expect(tierQuery('agent')).toBe('agent');
  });

  it('says how many seats are used, and when they are all used; nothing without a cap', () => {
    expect(seatsLine({ used: 4, limit: 10 })).toEqual({ used: 4, limit: 10, full: false });
    expect(seatsLine({ used: 10, limit: 10 })?.full).toBe(true);
    expect(seatsLine({ used: 4, limit: null })).toBeNull();
    expect(seatsLine(undefined)).toBeNull();
  });
});

describe('validateInvite', () => {
  const role = AGENT_ROLE.id;
  it('accepts a name, an email and a role', () => {
    expect(
      validateInvite({ fullName: ' Riya Shah ', email: ' riya@example.test ', roleId: role }),
    ).toEqual({
      input: { fullName: 'Riya Shah', email: 'riya@example.test', roleId: role },
    });
  });

  it('names what is wrong, field by field', () => {
    expect(validateInvite({ fullName: '  ', email: '', roleId: role })).toEqual({
      errors: { fullName: 'required', email: 'required' },
    });
    expect(validateInvite({ fullName: 'x'.repeat(192), email: 'nope', roleId: role })).toEqual({
      errors: { fullName: 'tooLong', email: 'invalid' },
    });
  });
});
