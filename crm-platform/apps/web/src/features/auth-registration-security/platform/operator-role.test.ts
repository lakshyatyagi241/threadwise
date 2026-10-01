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
