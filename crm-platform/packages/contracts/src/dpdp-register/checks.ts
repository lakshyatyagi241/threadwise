import type { DpdpCheckSource } from './status';

/** Read by the API at request time from configuration or the database (spec section 4.1). A probe that throws is `unknown`, never `pass`. */
export const DPDP_LIVE_CHECKS = [
  'mfa.operators',
  'mfa.workspace_admins',
  'logs.audit_retention',
  'logs.session_retention',
  'redis.auth',
  'crypto.rotation_complete',
  'lifecycle.enabled',
  'errors.vendor_region',
  'ai.platform_key_off',
  'consent.default_opt_in',
] as const;
export type DpdpLiveCheck = (typeof DPDP_LIVE_CHECKS)[number];

/** Facts a program cannot read: a super admin records the result with a note (spec section 4.2). The list is closed. */
export const DPDP_ATTESTABLE_CHECKS = [
  'hosting.region_documented',
  'storage.encrypted_at_rest',
  'backup.offsite_configured',
  'backup.restore_drill',
  'security.pentest_report',
  'legal.counsel_engaged',
  'legal.vendor_dpas',
  'governance.contacts_named',
] as const;
export type DpdpAttestableCheck = (typeof DPDP_ATTESTABLE_CHECKS)[number];

/** Gaps the running code cannot show; each has a fixed result in the catalog that the PR shipping the fix changes (spec section 4.3). */
export const DPDP_CODE_CHECKS = [
  'pii.column_encryption',
  'rls.privileged_guc_fixed',
  'logs.erasure_keeps_year',
  'ci.security_jobs_scheduled',
  'ai.workspace_switch',
  'transfer.country_killswitch',
  'dpa.acceptance_persisted',
  'consent.lawful_basis_dpdp',
  'lifecycle.exit_and_orphans_fixed',
  'evidence.board_pack',
  'grievance.intake_built',
] as const;
export type DpdpCodeCheck = (typeof DPDP_CODE_CHECKS)[number];

export type DpdpCheckKey = DpdpLiveCheck | DpdpAttestableCheck | DpdpCodeCheck;

const LIVE = new Set<string>(DPDP_LIVE_CHECKS);
const ATTESTABLE = new Set<string>(DPDP_ATTESTABLE_CHECKS);

/** The source of a check, decided by which list its key is in. */
export function dpdpCheckSource(key: DpdpCheckKey): DpdpCheckSource {
  if (LIVE.has(key)) return 'live';
  if (ATTESTABLE.has(key)) return 'attested';
  return 'code';
}
