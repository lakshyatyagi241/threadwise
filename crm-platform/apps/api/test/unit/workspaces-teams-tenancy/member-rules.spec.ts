import { describe, expect, it } from 'vitest';
import { WSP_TIER_RANK, type WspRoleTier } from '@crm/contracts';
import { PRESET_RANK } from '../../../src/modules/roles-permissions/workspace-role-rules.service';
import {
  assertCanActOn,
  tierOfRole,
} from '../../../src/modules/workspaces-teams-tenancy/member-rules';
import {
  toMemberStatus,
  toPresence,
} from '../../../src/modules/workspaces-teams-tenancy/members.mapper';

const role = (systemKey: string | null) => ({ systemKey });

describe('TW-WSP-020: the role model is the RBAC presets', () => {
  it('maps each preset system_key to its tier; the top preset (system_key admin) is the Owner', () => {
    expect(tierOfRole(role('admin'))).toBe('owner');
    expect(tierOfRole(role('workspace_admin'))).toBe('admin');
    expect(tierOfRole(role('manager'))).toBe('manager');
    expect(tierOfRole(role('agent'))).toBe('agent');
    expect(tierOfRole(role('viewer'))).toBe('viewer');
  });

  it('reads custom for a role without a preset key, whatever it is called, and for a key it does not know', () => {
    expect(tierOfRole(role(null))).toBe('custom');
    expect(tierOfRole(role('readonly'))).toBe('custom');
    expect(tierOfRole(role('something'))).toBe('custom');
  });

  it('ranks the tiers exactly as the RBAC ladder does (one model), a custom role below every preset', () => {
    const presetOf: Record<Exclude<WspRoleTier, 'custom'>, keyof typeof PRESET_RANK> = {
      owner: 'admin',
      admin: 'workspace_admin',
      manager: 'manager',
      agent: 'agent',
      viewer: 'viewer',
    };
    for (const [tier, key] of Object.entries(presetOf)) {
      expect(WSP_TIER_RANK[tier as WspRoleTier], tier).toBe(PRESET_RANK[key]);
    }
    expect(WSP_TIER_RANK.custom).toBe(0);
  });

  describe('assertCanActOn: nobody acts on a member who outranks them', () => {
    it('allows equal and lower ranks', () => {
      expect(() => assertCanActOn({ tier: 'admin' }, { tier: 'admin' })).not.toThrow();
      expect(() => assertCanActOn({ tier: 'admin' }, { tier: 'viewer' })).not.toThrow();
      expect(() => assertCanActOn({ tier: 'admin' }, { tier: 'custom' })).not.toThrow();
      expect(() => assertCanActOn({ tier: 'owner' }, { tier: 'admin' })).not.toThrow();
      expect(() => assertCanActOn({ tier: 'custom' }, { tier: 'custom' })).not.toThrow();
    });

    it('refuses a higher rank with 403 WSP_CANNOT_ACT_ON_HIGHER_RANK, the Owner included', () => {
      expect(() => assertCanActOn({ tier: 'admin' }, { tier: 'owner' })).toThrowError(
        expect.objectContaining({ code: 'WSP_CANNOT_ACT_ON_HIGHER_RANK', status: 403 }),
      );
      expect(() => assertCanActOn({ tier: 'manager' }, { tier: 'admin' })).toThrow();
      expect(() => assertCanActOn({ tier: 'viewer' }, { tier: 'agent' })).toThrow();
      expect(() => assertCanActOn({ tier: 'custom' }, { tier: 'agent' })).toThrow();
    });
  });
});

describe('TW-WSP-015: what the members list shows', () => {
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
