import { describe, expect, it } from 'vitest';
import { member, summary } from './fixtures';
import {
  canChangeRole,
  canRemove,
  canReset,
  canResend,
  initials,
  primaryRole,
  roleOptions,
  seatsLine,
  tierQuery,
  visibleTiers,
} from './roles';

describe('visibleTiers', () => {
  it('lists WaDesk pills in order and hides the custom pill when nobody has a custom role', () => {
    expect(visibleTiers(summary('owner'))).toEqual([
      'all',
      'owner',
      'admin',
      'manager',
      'agent',
      'viewer',
    ]);
  });

  it('adds the custom pill once someone holds one', () => {
    const s = summary('owner');
    s.counts.custom = 2;
    expect(visibleTiers(s).at(-1)).toBe('custom');
  });

  it('shows the WaDesk pills before the summary arrives', () => {
    expect(visibleTiers(undefined)).toHaveLength(6);
  });
});

describe('tierQuery', () => {
  it('sends no filter for "all"', () => {
    expect(tierQuery('all')).toBeUndefined();
    expect(tierQuery('agent')).toBe('agent');
  });
});

describe('row permissions', () => {
  const owner = summary('owner').me;
  const admin = summary('admin').me;
  const manager = summary('manager').me;

  it('lets an owner change an admin or another owner but never themselves', () => {
    expect(canChangeRole(member(2, 'admin'), owner)).toBe(true);
    expect(canChangeRole(member(3, 'owner'), owner)).toBe(true);
    expect(canChangeRole(member(1, 'owner'), owner)).toBe(false);
  });

  it('makes a row read-only for someone of a higher tier than the caller, an Owner row for anyone but an Owner', () => {
    expect(canChangeRole(member(4, 'owner'), admin)).toBe(false);
    expect(canChangeRole(member(5, 'agent'), admin)).toBe(true);
  });

  it('shows no actions at all to a caller without the permissions', () => {
    const agent = member(6, 'agent');
    expect(canChangeRole(agent, manager)).toBe(false);
    expect(canRemove(agent, manager)).toBe(false);
    expect(canReset(agent, manager)).toBe(false);
    expect(canResend(agent, manager)).toBe(false);
  });

  it('never offers remove on the owner or on oneself', () => {
    expect(canRemove(member(7, 'owner'), owner)).toBe(false);
    expect(canRemove(member(1, 'admin'), owner)).toBe(false);
    expect(canRemove(member(8, 'agent'), owner)).toBe(true);
  });

  it('swaps reset password for resend invite on a pending member', () => {
    const pending = member(9, 'agent', { status: 'pending', joinedAt: null });
    expect(canReset(pending, admin)).toBe(false);
    expect(canResend(pending, admin)).toBe(true);
    const active = member(10, 'agent');
    expect(canReset(active, admin)).toBe(true);
    expect(canResend(active, admin)).toBe(false);
  });
});

describe('roleOptions', () => {
  it('offers only grantable roles', () => {
    const s = summary('admin');
    const names = roleOptions(s.roles, undefined).map((r) => r.name);
    expect(names).toEqual(['manager', 'agent', 'viewer']);
  });

  it('keeps a current role the caller cannot grant, disabled, so the select still shows it', () => {
    const s = summary('admin');
    const m = member(2, 'admin');
    const options = roleOptions(s.roles, primaryRole(m));
    expect(options[0]).toMatchObject({ tier: 'admin', disabled: true });
    expect(options.slice(1).every((o) => !o.disabled)).toBe(true);
  });
});

describe('primaryRole', () => {
  it('prefers the role of the display tier', () => {
    const m = member(2, 'manager');
    m.roles = [{ id: 'a', name: 'viewer', tier: 'viewer' }, ...m.roles];
    expect(primaryRole(m)?.tier).toBe('manager');
  });
});

describe('initials', () => {
  it('takes the first letters of the first two words', () => {
    expect(initials('riya shah')).toBe('RS');
    expect(initials('  Asha  Devi  Kumar ')).toBe('AD');
    expect(initials('Cher')).toBe('C');
  });
  it('falls back to a question mark', () => expect(initials('   ')).toBe('?'));
});

describe('seatsLine', () => {
  it('is hidden when the plan has no cap', () => {
    expect(seatsLine({ used: 3, limit: null })).toBeNull();
    expect(seatsLine(undefined)).toBeNull();
  });
  it('flags a full workspace', () => {
    expect(seatsLine({ used: 3, limit: 5 })).toEqual({ used: 3, limit: 5, full: false });
    expect(seatsLine({ used: 5, limit: 5 })?.full).toBe(true);
  });
});
