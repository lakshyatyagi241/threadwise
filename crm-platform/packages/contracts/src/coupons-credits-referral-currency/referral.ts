import { z } from 'zod';
import { cursorSchema } from '../common/pagination';
import { uuidSchema } from '../common/ids';

/**
 * The affiliate (referral) screen of the signed-in user (TW-CPN-029..037). One Affiliate screen replaces Reference's account tab and
 * its history page, so both read the same numbers in the same unit.
 *
 * UNIT CONVENTION (one for every field here and the same as the wallet's `*Minor` fields): money is an integer number of
 * HUNDREDTHS of the platform currency, next to the `currency` code. 250 with USD means 2.50 USD. Reference showed money on one
 * screen and raw "credits" on the other; the CSV carries the same hundredths.
 *
 * Every id is a uuid. Everything is scoped to the caller: a user only ever sees the people they referred.
 */

/** The alphabet of a referral code: no 0, O, 1, I or L, so a code read aloud or from a screenshot is not misread. */
export const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REFERRAL_CODE_LENGTH = 10;

export const REFERRAL_RANGES = ['7d', '30d', '90d', 'all'] as const;
export const referralRangeSchema = z.enum(REFERRAL_RANGES);
export type ReferralRange = z.infer<typeof referralRangeSchema>;
export const DEFAULT_REFERRAL_RANGE: ReferralRange = '90d';

export const REFERRAL_BUCKETS = ['daily', 'weekly', 'monthly'] as const;
export const referralBucketSchema = z.enum(REFERRAL_BUCKETS);
export type ReferralBucket = z.infer<typeof referralBucketSchema>;

/** What the account tab shows without asking for more (TW-CPN-037). */
export const REFERRAL_RECENT_LIMIT = 50;
export const REFERRAL_PAGE_SIZE = 20;
export const REFERRAL_PAYOUTS_LIMIT = 8;
export const REFERRAL_TOP_CODES_LIMIT = 5;

export const referralRowSchema = z.object({
  id: uuidSchema,
  createdAt: z.string().datetime(),
  /** The referee's name, or null when the account has none (the screen shows a generic label). */
  refereeName: z.string().nullable(),
  refereeEmail: z.string().nullable(),
  /** What the referee typed or arrived with (upper-case). */
  codeUsed: z.string(),
  /** Hundredths of the platform currency; 0 until the first payment pays out. */
  creditsAwardedMinor: z.number().int().nonnegative(),
  status: z.enum(['paid', 'pending']),
  /** The wallet entry of the payout, or null while unpaid. */
  walletTxId: uuidSchema.nullable(),
});
export type ReferralRow = z.infer<typeof referralRowSchema>;

const moneyShape = {
  /** ISO code of the platform currency every amount below is in. */
  currency: z.string(),
};

/** GET /v2/me/referral: the code, the link, what a referral earns and the 50 most recent referrals. */
export const referralOverviewSchema = z.object({
  ...moneyShape,
  code: z.string(),
  link: z.string().url(),
  /** What the referrer earns when the referee makes the first payment (0: the programme pays nothing right now). */
  rewardMinor: z.number().int().nonnegative(),
  /** The flat price of one message, so the screen can say how many messages a reward covers. */
  messagePriceMinor: z.number().int().positive(),
  /** True when the platform bills per message, which is the only case a reward "spends per message". */
  payPerMessage: z.boolean(),
  lifetimeCount: z.number().int().nonnegative(),
  last30dCount: z.number().int().nonnegative(),
  earnedMinor: z.number().int().nonnegative(),
  recent: z.array(referralRowSchema).max(REFERRAL_RECENT_LIMIT),
});
export type ReferralOverview = z.infer<typeof referralOverviewSchema>;

export const referralListQuerySchema = z.object({
  range: referralRangeSchema.default(DEFAULT_REFERRAL_RANGE),
  /** Absent: the server picks by range length (daily up to 14 days, weekly up to 90, else monthly). A value is always honoured. */
  bucket: referralBucketSchema.optional(),
  q: z.string().trim().max(120).optional(),
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(REFERRAL_PAGE_SIZE),
});
export type ReferralListQuery = z.input<typeof referralListQuerySchema>;
export type ReferralListParams = z.output<typeof referralListQuerySchema>;

export const referralExportQuerySchema = z.object({
  range: referralRangeSchema.default(DEFAULT_REFERRAL_RANGE),
});
export type ReferralExportQuery = z.output<typeof referralExportQuerySchema>;

export const referralVolumePointSchema = z.object({
  /** First day of the bucket (UTC), `YYYY-MM-DD`. */
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  signups: z.number().int().nonnegative(),
  creditsMinor: z.number().int().nonnegative(),
});
export type ReferralVolumePoint = z.infer<typeof referralVolumePointSchema>;

export const referralStatsSchema = z.object({
  /** Sign-ups inside the selected range. */
  signupsInRange: z.number().int().nonnegative(),
  /** Sign-ups in the window of the same length right before it. */
  signupsPrevious: z.number().int().nonnegative(),
  /** Whole percent against the previous window; +100 when the previous window had none and this one has, else 0. */
  deltaPercent: z.number().int(),
  signupsLifetime: z.number().int().nonnegative(),
  signups30d: z.number().int().nonnegative(),
  creditsEarnedMinor: z.number().int().nonnegative(),
  credits30dMinor: z.number().int().nonnegative(),
  /** Lifetime credits over lifetime sign-ups, rounded; 0 with no sign-ups. */
  avgPerSignupMinor: z.number().int().nonnegative(),
});
export type ReferralStats = z.infer<typeof referralStatsSchema>;

export const referralTopCodeSchema = z.object({
  code: z.string(),
  signups: z.number().int().nonnegative(),
  creditsMinor: z.number().int().nonnegative(),
});

export const referralPayoutSchema = z.object({
  id: uuidSchema,
  amountMinor: z.number().int().positive(),
  createdAt: z.string().datetime(),
  balanceAfterMinor: z.number().int(),
});

/** GET /v2/me/referrals: one page of the table plus everything the dashboard draws, over the same range. */
export const referralListResponseSchema = z.object({
  ...moneyShape,
  code: z.string(),
  link: z.string().url(),
  rewardMinor: z.number().int().nonnegative(),
  messagePriceMinor: z.number().int().positive(),
  payPerMessage: z.boolean(),
  filters: z.object({
    range: referralRangeSchema,
    bucket: referralBucketSchema,
    q: z.string().nullable(),
  }),
  data: z.array(referralRowSchema),
  page: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    limit: z.number().int(),
    /** Rows matching the range and the search (the table footer's "of N"). */
    total: z.number().int().nonnegative(),
  }),
  /** Computed over the range and ignore the search text. */
  stats: referralStatsSchema,
  volume: z.array(referralVolumePointSchema),
  topCodes: z.array(referralTopCodeSchema).max(REFERRAL_TOP_CODES_LIMIT),
  payouts: z.array(referralPayoutSchema).max(REFERRAL_PAYOUTS_LIMIT),
});
export type ReferralListResponse = z.infer<typeof referralListResponseSchema>;

/** The columns of the CSV export, in order. */
export const REFERRAL_CSV_COLUMNS = [
  'id',
  'created_at',
  'referee_name',
  'referee_email',
  'code_used',
  'credits_awarded',
  'wallet_tx_id',
] as const;

/** Outbox event written when a referral pays out (the referrer's workspace wallet was credited). */
export const REFERRAL_REWARDED_EVENT = 'referral.rewarded';

/** The wallet ledger's source and subject type of a referral payout: the affiliate screen's "recent payouts" reads this same source. */
export const REFERRAL_PAYOUT_SOURCE = 'referral.paid';
export const REFERRAL_SUBJECT = 'referral';
