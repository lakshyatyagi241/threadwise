import { describe, expect, it } from 'vitest';
import { WSP_TIER_RANK, type WspRoleTier } from '@crm/contracts';
import {
  assertCanActOn,
  assertCanGrantRole,
  canGrantRole,
  grantableTiers,
  memberTier,
  tierOfRole,
} from '../../../src/modules/workspaces-teams-tenancy/member-rules';
import {
  toMemberStatus,
  toPresence,
} from '../../../src/modules/workspaces-teams-tenancy/members.mapper';

const role = (systemKey: string | null, name = 'x') => ({ systemKey, name });
const TIERS: WspRoleTier[] = ['owner', 'admin', 'manager', 'agent', 'custom', 'viewer'];

describe('WD-WSP-020: the role model on top of RBAC', () => {
  it('maps the system presets and the Agent preset to their tiers; any role an organization made reads custom', () => {
    expect(tierOfRole(role('admin', 'Admin'))).toBe('admin');
    expect(tierOfRole(role('manager', 'Manager'))).toBe('manager');
    expect(tierOfRole(role('readonly', 'Viewer'))).toBe('viewer');
    expect(tierOfRole(role('agent', 'Sales'))).toBe('agent');
    expect(tierOfRole(role(null, 'Agent'))).toBe('agent');
    expect(tierOfRole(role(null, '  agent '))).toBe('agent');
    expect(tierOfRole(role(null, 'Counsellor'))).toBe('custom');
    // A custom role that borrows a preset's name but carries another system key is not an agent.
    expect(tierOfRole(role('something', 'Agent'))).toBe('custom');
  });

  it('ranks owner 100, admin 80, manager 60, agent 40 (custom too), viewer 20', () => {
    expect(WSP_TIER_RANK).toEqual({
      owner: 100,
      admin: 80,
      manager: 60,
      agent: 40,
      custom: 40,
      viewer: 20,
    });
  });

  describe("a member's tier", () => {
    it('is owner for the organization owner whatever their roles are', () => {
      expect(memberTier(true, [role(null, 'Counsellor')])).toBe('owner');
      expect(memberTier(true, [])).toBe('owner');
    });

    it('is the highest of their roles', () => {
      expect(memberTier(false, [role('readonly'), role('manager'), role(null, 'Agent')])).toBe(
        'manager',
      );
      expect(memberTier(false, [role('readonly'), role(null, 'Custom')])).toBe('custom');
    });

    it('prefers the named agent preset over a custom role of the same rank', () => {
      expect(memberTier(false, [role(null, 'Counsellor'), role(null, 'Agent')])).toBe('agent');
    });

    it('reads custom when the member has no role at all', () => {
      expect(memberTier(false, [])).toBe('custom');
    });
  });

  describe('canGrantRole (WD-WSP-020 rule 4 / WD-WSP-046)', () => {
    it('lets only the owner grant Admin (no admin to admin chains)', () => {
      expect(canGrantRole({ tier: 'owner' }, 'admin')).toBe(true);
      expect(canGrantRole({ tier: 'admin' }, 'admin')).toBe(false);
      expect(canGrantRole({ tier: 'manager' }, 'admin')).toBe(false);
    });

    it('never lets anyone grant Owner', () => {
      for (const tier of TIERS) expect(canGrantRole({ tier }, 'owner')).toBe(false);
    });

    it('never lets anyone grant above their own rank, and lets them grant at or below it', () => {
      expect(canGrantRole({ tier: 'admin' }, 'manager')).toBe(true);
      expect(canGrantRole({ tier: 'manager' }, 'manager')).toBe(true);
      expect(canGrantRole({ tier: 'manager' }, 'agent')).toBe(true);
      expect(canGrantRole({ tier: 'agent' }, 'manager')).toBe(false);
      expect(canGrantRole({ tier: 'viewer' }, 'agent')).toBe(false);
      expect(canGrantRole({ tier: 'viewer' }, 'viewer')).toBe(true);
      expect(canGrantRole({ tier: 'agent' }, 'custom')).toBe(true);
    });

    it('answers grantable tiers: an Owner all but owner, an Admin manager/agent/custom/viewer (WaDesk: manager, agent, viewer)', () => {
      expect(grantableTiers({ tier: 'owner' })).toEqual([
        'admin',
        'manager',
        'agent',
        'custom',
        'viewer',
      ]);
      expect(grantableTiers({ tier: 'admin' })).toEqual(['manager', 'agent', 'custom', 'viewer']);
      expect(grantableTiers({ tier: 'manager' })).toEqual(['manager', 'agent', 'custom', 'viewer']);
      expect(grantableTiers({ tier: 'viewer' })).toEqual(['viewer']);
    });

    it('refuses with 403 WSP_CANNOT_GRANT_ROLE naming the role', () => {
      expect(() => assertCanGrantRole({ tier: 'admin' }, 'admin', 'Admin')).toThrowError(
        expect.objectContaining({ code: 'WSP_CANNOT_GRANT_ROLE', status: 403 }),
      );
      expect(() => assertCanGrantRole({ tier: 'owner' }, 'admin', 'Admin')).not.toThrow();
    });
  });

  describe('assertCanActOn: nobody acts on a member who outranks them', () => {
    it('allows equal and lower ranks', () => {
      expect(() => assertCanActOn({ tier: 'admin' }, { tier: 'admin' })).not.toThrow();
      expect(() => assertCanActOn({ tier: 'admin' }, { tier: 'viewer' })).not.toThrow();
      expect(() => assertCanActOn({ tier: 'owner' }, { tier: 'admin' })).not.toThrow();
    });

    it('refuses a higher rank with 403 WSP_CANNOT_ACT_ON_HIGHER_RANK, the owner included', () => {
      expect(() => assertCanActOn({ tier: 'admin' }, { tier: 'owner' })).toThrowError(
        expect.objectContaining({ code: 'WSP_CANNOT_ACT_ON_HIGHER_RANK', status: 403 }),
      );
      expect(() => assertCanActOn({ tier: 'manager' }, { tier: 'admin' })).toThrow();
      expect(() => assertCanActOn({ tier: 'viewer' }, { tier: 'agent' })).toThrow();
    });
  });
});

describe('WD-WSP-015: what the members list shows', () => {
  it('reads pending when invited and not joined yet, inactive when removed, active otherwise', () => {
    const at = new Date();
    expect(toMemberStatus({ status: 'active', invitedAt: at, joinedAt: null })).toBe('pending');
    expect(toMemberStatus({ status: 'active', invitedAt: at, joinedAt: at })).toBe('active');
    expect(toMemberStatus({ status: 'active', invitedAt: null, joinedAt: null })).toBe('active');
    expect(toMemberStatus({ status: 'inactive', invitedAt: at, joinedAt: null })).toBe('inactive');
  });

  it('shows the four presence labels the inbox stores and offline for anything else', () => {
    expect(toPresence('online')).toBe('online');
    expect(toPresence('away')).toBe('away');
    expect(toPresence('busy')).toBe('busy');
    expect(toPresence('offline')).toBe('offline');
    expect(toPresence('dnd')).toBe('offline');
    expect(toPresence(null)).toBe('offline');
  });
});
