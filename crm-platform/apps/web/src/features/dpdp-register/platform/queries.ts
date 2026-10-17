import { z } from 'zod';
import type {
  DpdpAttestationView,
  DpdpCheckView,
  DpdpHistoryResponse,
  DpdpItemView,
  DpdpMilestone,
  DpdpRegisterResponse,
} from '@crm/contracts';
import {
  DPDP_ATTESTABLE_CHECKS,
  DPDP_CHECK_RESULTS,
  DPDP_CHECK_SOURCES,
  DPDP_CODE_CHECKS,
  DPDP_GROUPS,
  DPDP_ITEM_STATUSES,
  DPDP_LIVE_CHECKS,
  DPDP_OWNERS,
  DPDP_PENALTY_TIERS,
} from '@crm/contracts';

export const REGISTER_KEY = ['operator', 'dpdp-register'] as const;
/** The attestations of one check. Under `REGISTER_KEY` so one prefix covers the page. */
export const historyKey = (checkKey: string) => [...REGISTER_KEY, 'history', checkKey] as const;

type Out<T> = z.ZodType<T, z.ZodTypeDef, unknown>;
const count = z.number().int().nonnegative();

const attestationSchema = z.object({
  result: z.enum(['pass', 'fail']),
  note: z.string(),
  evidenceUrl: z.string().nullable(),
  byName: z.string(),
  at: z.string(),
  expiresAt: z.string(),
}) satisfies Out<DpdpAttestationView>;

const checkSchema = z.object({
  key: z.enum([...DPDP_LIVE_CHECKS, ...DPDP_ATTESTABLE_CHECKS, ...DPDP_CODE_CHECKS]),
  source: z.enum(DPDP_CHECK_SOURCES),
  result: z.enum(DPDP_CHECK_RESULTS),
  detail: z.string(),
  params: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  attestation: attestationSchema.optional(),
}) satisfies Out<DpdpCheckView>;

const itemSchema = z.object({
  id: z.string(),
  group: z.enum(DPDP_GROUPS),
  citation: z.string(),
  owner: z.enum(DPDP_OWNERS),
  penaltyTier: z.enum(DPDP_PENALTY_TIERS),
  planItems: z.array(z.string()),
  status: z.enum(DPDP_ITEM_STATUSES),
  conditional: z.boolean(),
  checks: z.array(checkSchema),
}) satisfies Out<DpdpItemView>;

const milestoneSchema = z.object({
  id: z.string(),
  date: z.string(),
  daysLeft: count,
  passed: z.boolean(),
}) satisfies Out<DpdpMilestone>;

const tierSchema = z.object({ notFollowing: count, partial: count, unverified: count });

/**
 * The contracts package ships these response shapes as types only, so the web keeps the runtime check here. Each schema is
 * assigned to the contract type: a renamed or added field breaks the build instead of showing `undefined`.
 */
export const registerSchema: Out<DpdpRegisterResponse> = z.object({
  generatedAt: z.string(),
  milestones: z.array(milestoneSchema),
  summary: z.object({
    total: count,
    following: count,
    partial: count,
    notFollowing: count,
    unverified: count,
    byTier: z.object({
      '250': tierSchema,
      '200': tierSchema,
      '150': tierSchema,
      '50': tierSchema,
      none: tierSchema,
    }),
  }),
  groups: z.array(z.object({ id: z.enum(DPDP_GROUPS), items: z.array(itemSchema) })),
});

export const historySchema: Out<DpdpHistoryResponse> = z.object({
  data: z.array(attestationSchema),
});
