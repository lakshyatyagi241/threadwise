import type { OperatorRole } from '@crm/contracts';

/**
 * What each operator role may do, mirroring the API's `@OperatorRoles` guards (the server stays the
 * authority; this only decides what the UI offers). Auditors read everything and change nothing.
 * Security policy, registration policy and social login / captcha are super-admin only; the auth
 * pages are also open to support; the danger-zone actions are super-admin only; the plan catalogue
 * is read by every role and written by super admins only.
 */
export type OperatorSection = 'policy' | 'registration' | 'social' | 'authPages' | 'plans';

const SECTION_ROLES: Record<OperatorSection, readonly OperatorRole[]> = {
  policy: ['super_admin'],
  registration: ['super_admin'],
  social: ['super_admin'],
  authPages: ['super_admin', 'support'],
  plans: ['super_admin'],
};

export const canEditSection = (role: OperatorRole, section: OperatorSection): boolean =>
  SECTION_ROLES[section].includes(role);

export const canRunDangerActions = (role: OperatorRole): boolean => role === 'super_admin';

/** Which roles the read-only notice should name: just super admins, or super admins and support. */
export const sectionEditors = (section: OperatorSection): 'superAdmin' | 'superAdminSupport' =>
  SECTION_ROLES[section].includes('support') ? 'superAdminSupport' : 'superAdmin';
