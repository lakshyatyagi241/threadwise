import { SetMetadata } from '@nestjs/common';

export const ALLOW_WHILE_GATED_KEY = 'auth:allow-while-gated';
export const OPERATOR_ROLES_KEY = 'auth:operator-roles';

export interface AllowWhileGatedOptions {
  /** Also reachable by a suspended account (sign out, the session probe the lock screen reads). */
  suspended?: boolean;
}

/**
 * Account gates (unverified email under a "block" policy, forced password
 * change, required MFA enrolment) turn every route into a problem+json
 * refusal. Routes the user needs in order to *resolve* the gate (enrol,
 * change password, resend the verification mail, sign out) opt out with this.
 */
export const AllowWhileGated = (options: AllowWhileGatedOptions = {}) =>
  SetMetadata(ALLOW_WHILE_GATED_KEY, options);

/** Platform operator roles allowed on a route. Omitted: any active operator. */
export const OperatorRoles = (...roles: Array<'super_admin' | 'support' | 'auditor'>) =>
  SetMetadata(OPERATOR_ROLES_KEY, roles);
