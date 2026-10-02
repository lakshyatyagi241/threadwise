import { z } from 'zod';
import { cursorSchema, pageInfoSchema } from '../common/pagination';
import { uuidSchema } from '../common/ids';

/**
 * Referral and affiliate (TW-CPN-029..038). Every user has one code; a person who signs up with it is attributed once to the
 * referrer, and the referrer is paid a fixed wallet bonus when that person's FIRST order is paid. Amounts are hundredths of the
 * platform currency (`*Minor`), as in the wallet.
 */
export const REFERRAL_LIMITS = { pageSize: 20, codeMax: 16, codeLength: 10 } as const;

/** Alphabet of generated codes: no 0, O, 1, I or L, so a code survives being read aloud. */
export const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Keeps letters and digits, upper-cases, drops anything empty or longer than 16 (the `?ref=` cookie rule, TW-CPN-030). */
export function sanitizeReferralCode(raw: string | null | undefined): string | null {
  const code = (raw ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return code !== '' && code.length <= REFERRAL_LIMITS.codeMax ? code : null;
}

export const referralRangeSchema = z.enum(['7d', '30d', '90d', 'all']);
export type ReferralRange = z.infer<typeof referralRangeSchema>;
export const referralBucketSchema = z.enum(['daily', 'weekly', 'monthly']);
export type ReferralBucket = z.infer<typeof referralBucketSchema>;

/** The caller's own code and what it earns (account Affiliate tab, history header, share panel). */
export const referralMeResponseSchema = z.object({
  code: z.string(),
  /** `<app url>/register?ref=<code>` */
  link: z.string(),
  /** The bonus per referee's first paid order, hundredths of `currency`. */
  rewardMinor: z.number().int().nonnegative(),
  /** The platform currency the reward is counted in. */
  currency: z.string(),
  /** Wallet credits that pay for one message, hundredths (the "= N messages" copy). */
  creditsPerMessage: z.number().int().positive(),
  /** Whether the workspace pays per message (one line of the "How it works" list). */
  payPerMessage: z.boolean(),
});
export type ReferralMeResponse = z.infer<typeof referralMeResponseSchema>;

export const referralRowSchema = z.object({
  id: uuidSchema,
  createdAt: z.string(),
  refereeName: z.string(),
  refereeEmail: z.string().nullable(),
  codeUsed: z.string(),
  /** What the referrer was paid for this referee, hundredths; 0 until the referee's first paid order. */
  creditsAwardedMinor: z.number().int().nonnegative(),
  /** Id of the wallet transaction that paid it, or null. */
  walletTxId: z.string().nullable(),
  status: z.enum(['paid', 'no-payout']),
});
export type ReferralRow = z.infer<typeof referralRowSchema>;

export const referralHistoryQuerySchema = z.object({
  range: referralRangeSchema.default('90d'),
  /** Absent = daily up to 14 days, weekly up to 90, else monthly. */
  bucket: referralBucketSchema.optional(),
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(REFERRAL_LIMITS.pageSize),
  cursor: cursorSchema.optional(),
});
export type ReferralHistoryQuery = z.infer<typeof referralHistoryQuerySchema>;

export const referralStatsSchema = z.object({
  signupsLifetime: z.number().int(),
  creditsLifetimeMinor: z.number().int(),
  signupsRange: z.number().int(),
  creditsRangeMinor: z.number().int(),
  signups30d: z.number().int(),
  credits30dMinor: z.number().int(),
  avgPerSignupMinor: z.number().int(),
  /** Signups vs the previous window of equal length, whole percent. */
  deltaPct: z.number().int(),
});

export const referralHistoryResponseSchema = z.object({
  data: z.array(referralRowSchema),
  page: pageInfoSchema,
  /** Rows matching the search, over every page. */
  total: z.number().int(),
  stats: referralStatsSchema,
  volume: z.object({
    labels: z.array(z.string()),
    signups: z.array(z.number().int()),
    creditsMinor: z.array(z.number().int()),
    bucket: referralBucketSchema,
  }),
  topCodes: z.array(
    z.object({
      code: z.string(),
      signups: z.number().int(),
      creditsMinor: z.number().int(),
      pct: z.number().int(),
    }),
  ),
  /** The last referral payouts (source `referral.paid`), newest first. */
  payouts: z.array(
    z.object({
      id: z.string(),
      amountMinor: z.number().int(),
      balanceAfterMinor: z.number().int(),
      description: z.string(),
      createdAt: z.string(),
    }),
  ),
  range: referralRangeSchema,
});
export type ReferralHistoryResponse = z.infer<typeof referralHistoryResponseSchema>;

export const referralExportQuerySchema = z.object({ range: referralRangeSchema.default('90d') });
export type ReferralExportQuery = z.infer<typeof referralExportQuerySchema>;

/** The Account page's Affiliate tab: the code card, three counters and the 50 newest referrals (TW-CPN-037). */
export const referralSummaryResponseSchema = z.object({
  me: referralMeResponseSchema,
  /** True lifetime figures (Reference counted only the 50 rows it showed). */
  signupsLifetime: z.number().int(),
  signups30d: z.number().int(),
  earnedMinor: z.number().int(),
  recent: z.array(referralRowSchema),
});
export type ReferralSummaryResponse = z.infer<typeof referralSummaryResponseSchema>;
