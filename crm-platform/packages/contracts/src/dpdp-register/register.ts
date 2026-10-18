import { z } from 'zod';
import type { DpdpCheckKey } from './checks';
import type {
  DpdpCheckResult,
  DpdpCheckSource,
  DpdpGroup,
  DpdpItemStatus,
  DpdpOwner,
  DpdpPenaltyTier,
} from './status';

/**
 * What a super admin records for an attestable check. `result` is pass or fail (`unknown` is only what an expired or missing
 * attestation resolves to). `expiresInDays` is how long the statement counts before the check goes back to unknown.
 */
export const dpdpAttestInputSchema = z.object({
  result: z.enum(['pass', 'fail']),
  note: z.string().trim().min(10).max(2000),
  evidenceUrl: z
    .string()
    .trim()
    .max(2048)
    .url()
    .refine((value) => /^https:\/\//i.test(value), 'Use an https link.')
    .optional(),
  expiresInDays: z.number().int().min(1).max(365).default(90),
});
export type DpdpAttestInput = z.infer<typeof dpdpAttestInputSchema>;

/** One recorded attestation as the register shows it. Times are ISO strings. */
export interface DpdpAttestationView {
  result: 'pass' | 'fail';
  note: string;
  evidenceUrl: string | null;
  byName: string;
  at: string;
  expiresAt: string;
}

/** One check of an item. `detail` is a key from a closed set of texts, with `params` for the numbers and names it shows. */
export interface DpdpCheckView {
  key: DpdpCheckKey;
  source: DpdpCheckSource;
  result: DpdpCheckResult;
  detail: string;
  params?: Record<string, string | number | boolean>;
  attestation?: DpdpAttestationView;
}

export interface DpdpItemView {
  id: string;
  group: DpdpGroup;
  citation: string;
  owner: DpdpOwner;
  penaltyTier: DpdpPenaltyTier;
  planItems: string[];
  status: DpdpItemStatus;
  conditional: boolean;
  checks: DpdpCheckView[];
}

/** A commencement date. `daysLeft` is never negative: it is 0 once the date has passed. */
export interface DpdpMilestone {
  id: string;
  date: string;
  daysLeft: number;
  passed: boolean;
}

export interface DpdpRegisterResponse {
  generatedAt: string;
  milestones: DpdpMilestone[];
  summary: {
    total: number;
    following: number;
    partial: number;
    notFollowing: number;
    unverified: number;
    byTier: Record<DpdpPenaltyTier, { notFollowing: number; partial: number; unverified: number }>;
  };
  groups: { id: DpdpGroup; items: DpdpItemView[] }[];
}

export interface DpdpHistoryResponse {
  data: DpdpAttestationView[];
}
