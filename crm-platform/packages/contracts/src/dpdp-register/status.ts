/**
 * The DPDP register's vocabulary. The register tracks what the platform does today against the DPDP Act 2023 and the DPDP Rules 2025;
 * none of these words says "compliant".
 */

/** The state of one obligation. `unverified` means a check could not be decided (a probe failed or an attestation expired). */
export const DPDP_ITEM_STATUSES = [
  'following',
  'partial',
  'not_following',
  'not_applicable',
  'unverified',
] as const;
export type DpdpItemStatus = (typeof DPDP_ITEM_STATUSES)[number];

/** The result of one yes/no check. */
export const DPDP_CHECK_RESULTS = ['pass', 'fail', 'unknown'] as const;
export type DpdpCheckResult = (typeof DPDP_CHECK_RESULTS)[number];

/** Where a check's result comes from: read at request time, recorded by a super admin, or declared in the catalog. */
export const DPDP_CHECK_SOURCES = ['live', 'attested', 'code'] as const;
export type DpdpCheckSource = (typeof DPDP_CHECK_SOURCES)[number];

/** The groups of section 3 of the plan, A to I: grounds and consent, rights, retention, security, breach, children, transfers, SDF, governance. */
export const DPDP_GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] as const;
export type DpdpGroup = (typeof DPDP_GROUPS)[number];

/** Who carries the obligation: the workspace (tenant), the platform, or both. */
export const DPDP_OWNERS = ['tenant', 'platform', 'both'] as const;
export type DpdpOwner = (typeof DPDP_OWNERS)[number];

/** The Schedule penalty tier of the provision, in crore rupees, or `none`. */
export const DPDP_PENALTY_TIERS = ['250', '200', '150', '50', 'none'] as const;
export type DpdpPenaltyTier = (typeof DPDP_PENALTY_TIERS)[number];
