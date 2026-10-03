import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OperatorRole } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  canEditSection,
  canRunDangerActions,
  sectionEditors,
  type OperatorSection,
} from './operator-role';

const SECTIONS: OperatorSection[] = ['policy', 'registration', 'social', 'authPages', 'plans'];

describe('canEditSection', () => {
  it('lets only super admins change policy, registration, social login and the plan catalogue', () => {
    for (const section of ['policy', 'registration', 'social', 'plans'] as const) {
      expect(canEditSection('super_admin', section)).toBe(true);
      expect(canEditSection('support', section)).toBe(false);
      expect(canEditSection('auditor', section)).toBe(false);
    }
  });
  it('also lets support change the auth pages', () => {
    expect(canEditSection('super_admin', 'authPages')).toBe(true);
    expect(canEditSection('support', 'authPages')).toBe(true);
    expect(canEditSection('auditor', 'authPages')).toBe(false);
  });
  it('never lets an auditor change anything', () => {
    for (const section of SECTIONS) expect(canEditSection('auditor', section)).toBe(false);
  });
});

describe('canRunDangerActions', () => {
  it('limits the danger zone to super admins', () => {
    expect(canRunDangerActions('super_admin')).toBe(true);
    expect(canRunDangerActions('support')).toBe(false);
    expect(canRunDangerActions('auditor')).toBe(false);
  });
});

describe('sectionEditors', () => {
  it('names the roles the read-only notice should mention', () => {
    expect(sectionEditors('policy')).toBe('superAdmin');
    expect(sectionEditors('authPages')).toBe('superAdminSupport');
  });
});

/**
 * The matrix as published in the parity document. The screens and the API must both follow it, so a
 * role change is a deliberate edit here and in the document, not a side effect.
 */
const MATRIX: Record<OperatorSection | 'danger', readonly OperatorRole[]> = {
  policy: ['super_admin'],
  danger: ['super_admin'],
  registration: ['super_admin'],
  social: ['super_admin'],
  authPages: ['super_admin', 'support'],
  plans: ['super_admin'],
};
const ROLES: OperatorRole[] = ['super_admin', 'support', 'auditor'];

describe('operator role matrix', () => {
  it.each(SECTIONS)('%s: the screens offer editing to exactly the published roles', (section) => {
    expect(ROLES.filter((r) => canEditSection(r, section))).toEqual(
      ROLES.filter((r) => MATRIX[section].includes(r)),
    );
  });

  it('offers the danger zone to exactly the published roles', () => {
    expect(ROLES.filter((r) => canRunDangerActions(r))).toEqual(
      ROLES.filter((r) => MATRIX.danger.includes(r)),
    );
  });

  it('keeps auditors read-only everywhere', () => {
    for (const roles of Object.values(MATRIX)) expect(roles).not.toContain('auditor');
  });
});

describe('operator role matrix against the API guards', () => {
  const api = join(process.cwd(), '..', 'api', 'src', 'modules');
  const platform = join(api, 'auth', 'controllers', 'platform.controller.ts');
  const plans = join(api, 'plans-subscriptions-trials', 'platform-plans.controller.ts');
  const guards = (source: string): Map<string, string[]> => {
    const out = new Map<string, string[]>();
    const re = /@(?:Patch|Post|Put|Delete)\('([^']+)'\)\s*@OperatorRoles\(([^)]*)\)/g;
    for (const m of source.matchAll(re)) {
      out.set(
        m[1]!,
        [...m[2]!.matchAll(/'([a-z_]+)'/g)].map((r) => r[1]!),
      );
    }
    return out;
  };
  const rolesOf = (route: string, from: Map<string, string[]>) => {
    const roles = from.get(route);
    expect(roles, `no @OperatorRoles found for ${route}`).toBeDefined();
    return roles!;
  };

  it.skipIf(!existsSync(platform))('follows the platform controller', () => {
    const g = guards(readFileSync(platform, 'utf8'));
    expect(rolesOf('policy', g)).toEqual(MATRIX.policy);
    expect(rolesOf('registration', g)).toEqual(MATRIX.registration);
    expect(rolesOf('social-captcha', g)).toEqual(MATRIX.social);
    expect(rolesOf('auth-pages', g)).toEqual(MATRIX.authPages);
    expect(rolesOf('branding-footer', g)).toEqual(MATRIX.registration);
    for (const route of [
      'danger/revoke-sessions',
      'danger/force-password-reset',
      'danger/rotate-webhook-secrets',
      'danger/halt-sends',
      'danger/resume-sends',
    ])
      expect(rolesOf(route, g)).toEqual(MATRIX.danger);
  });

  it.skipIf(!existsSync(plans))('lets only super admins write the plan catalogue', () => {
    const roles = [...readFileSync(plans, 'utf8').matchAll(/@OperatorRoles\(([^)]*)\)/g)].map((m) =>
      [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((r) => r[1]!),
    );
    expect(roles.length).toBeGreaterThan(0);
    for (const r of roles) expect(r).toEqual(MATRIX.plans);
  });
});
