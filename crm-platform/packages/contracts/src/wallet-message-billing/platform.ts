import { z } from 'zod';
import { pageInfoSchema } from '../common/pagination';
import { WALLET_LIMITS } from './money';
import { walletTransactionSchema, walletTxTypeSchema } from './wallet';

// --- settings and switches (TW-WALLET-003, -005, -008) ----------------------------------------------------------------------

export const walletSettingsSchema = z.object({
  currency: z.string(),
  /** What a message costs when per-country pricing is off, hundredths (Reference: "credits per message"). */
  flatPriceMinor: z.number().int().min(1),
  /** Paid to a referrer on the referee's first paid order, hundredths. */
  referralSignupMinor: z.number().int().min(0),
  /** The low-balance alert fires at or under this balance, hundredths. */
  lowBalanceThresholdMinor: z.number().int().min(0),
  /** A bulk send is refused unless the wallet covers this share of its estimated cost (0 = refuse only an empty wallet). */
  launchCoveragePercent: z.number().int().min(0).max(100),
  perCountryEnabled: z.boolean(),
  payPerMessage: z.boolean(),
  /** Whether a live Meta pricing endpoint is configured (on the reseller page); false means "Sync" uses the bundled card. */
  metaRatesLive: z.boolean(),
  updatedAt: z.string().nullable(),
});
export type WalletSettings = z.infer<typeof walletSettingsSchema>;

/** The three flat economics settings (TW-WALLET-003). Money is text so no float carries it. */
export const updateWalletSettingsSchema = z.object({
  flatPrice: z
    .string()
    .trim()
    .regex(/^\d{1,7}(\.\d{1,2})?$/, 'Enter an amount with at most 2 decimals')
    .refine(
      (v) => Number(v) >= 0.01,
      'The flat price cannot be 0; use the rate grid for free messages',
    ),
  referralSignup: z
    .string()
    .trim()
    .regex(/^\d{1,7}(\.\d{1,2})?$/, 'Enter an amount with at most 2 decimals'),
  lowBalanceThreshold: z
    .string()
    .trim()
    .regex(/^\d{1,7}(\.\d{1,2})?$/, 'Enter an amount with at most 2 decimals'),
  launchCoveragePercent: z.number().int().min(0).max(100),
});
export type UpdateWalletSettingsInput = z.infer<typeof updateWalletSettingsSchema>;

/**
 * The two master switches, saved on their own (Reference overwrote both on every rate save, so a stale page could flip them,
 * TW-WALLET-005 rule 1). Send only what changes.
 */
export const updateSwitchesSchema = z
  .object({ perCountryEnabled: z.boolean().optional(), payPerMessage: z.boolean().optional() })
  .refine((v) => v.perCountryEnabled !== undefined || v.payPerMessage !== undefined, {
    message: 'Send at least one switch',
  });
export type UpdateSwitchesInput = z.infer<typeof updateSwitchesSchema>;

// --- workspaces and the manual adjustment ---------------------------------------------------------------------------------

export const platformWalletListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  /** Narrow to wallets at or under their alert threshold. */
  lowOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(512).optional(),
});
export type PlatformWalletListQuery = z.infer<typeof platformWalletListQuerySchema>;

export const platformWalletRowSchema = z.object({
  workspaceId: z.string().uuid(),
  workspaceName: z.string(),
  slug: z.string(),
  currency: z.string(),
  balanceMinor: z.number().int(),
  billingMode: z.enum(['wallet', 'plan']),
  lowBalance: z.boolean(),
  lastActivityAt: z.string().nullable(),
});
export type PlatformWalletRow = z.infer<typeof platformWalletRowSchema>;

export const platformWalletListSchema = z.object({
  data: z.array(platformWalletRowSchema),
  page: pageInfoSchema,
  /** Across every workspace, not just this page. */
  totals: z.object({
    workspaces: z.number().int(),
    floatMinor: z.number().int(),
    lowBalance: z.number().int(),
  }),
  currency: z.string(),
});
export type PlatformWalletList = z.infer<typeof platformWalletListSchema>;

export const platformWalletDetailSchema = z.object({
  workspace: z.object({ id: z.string().uuid(), name: z.string(), slug: z.string() }),
  currency: z.string(),
  balanceMinor: z.number().int(),
  billingMode: z.enum(['wallet', 'plan']),
  lowBalanceThresholdMinor: z.number().int(),
  lowBalance: z.boolean(),
  lastActivityAt: z.string().nullable(),
  recent: z.array(
    walletTransactionSchema.extend({ actorLabel: z.string().nullable(), actorType: z.string() }),
  ),
});
export type PlatformWalletDetail = z.infer<typeof platformWalletDetailSchema>;

/**
 * Putting money into (or taking it out of) a workspace's wallet by hand. The note is mandatory: it is the reason on the ledger
 * row, in the audit trail and in what the customer sees. The request must also carry an `Idempotency-Key` so a double click
 * posts once.
 */
export const adjustWalletSchema = z.object({
  direction: z.enum(['credit', 'debit']),
  /** Whole currency units with up to 2 decimals, e.g. "250" or "250.50". */
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount with at most 2 decimals')
    .refine((v) => Number(v) > 0, 'The amount must be greater than 0')
    .refine(
      (v) => Math.round(Number(v) * 100) <= WALLET_LIMITS.maxAmountMinor,
      'That amount is above the limit for a single adjustment',
    ),
  note: z
    .string()
    .trim()
    .min(WALLET_LIMITS.noteMin, `Say why in at least ${WALLET_LIMITS.noteMin} characters`)
    .max(WALLET_LIMITS.noteMax),
});
export type AdjustWalletInput = z.infer<typeof adjustWalletSchema>;

export const adjustWalletResultSchema = z.object({
  /** Null when nothing moved (a deduction from an empty wallet). */
  transactionId: z.string().uuid().nullable(),
  direction: z.enum(['credit', 'debit']),
  requestedMinor: z.number().int(),
  /** A debit never takes a wallet below 0: this is what was actually taken. Equals `requestedMinor` for a credit. */
  appliedMinor: z.number().int(),
  balanceBeforeMinor: z.number().int(),
  balanceAfterMinor: z.number().int(),
  replayed: z.boolean(),
});
export type AdjustWalletResult = z.infer<typeof adjustWalletResultSchema>;

// --- logs and reconciliation ------------------------------------------------------------------------------------------------

export const walletLogSeveritySchema = z.enum(['info', 'warning', 'error']);

export const walletLogQuerySchema = z.object({
  /** `workspace` = events of wallets, `platform` = what operators changed, `all` = both, merged by time. */
  scope: z.enum(['all', 'workspace', 'platform']).default('all'),
  event: z.string().trim().max(80).optional(),
  severity: walletLogSeveritySchema.optional(),
  workspaceId: z.string().uuid().optional(),
  q: z.string().trim().max(120).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(512).optional(),
});
export type WalletLogQuery = z.infer<typeof walletLogQuerySchema>;

export const walletLogRowSchema = z.object({
  id: z.string(),
  scope: z.enum(['workspace', 'platform']),
  event: z.string(),
  severity: walletLogSeveritySchema,
  message: z.string(),
  workspaceId: z.string().uuid().nullable(),
  workspaceName: z.string().nullable(),
  actorType: z.string(),
  actorLabel: z.string().nullable(),
  payload: z.record(z.unknown()),
  requestId: z.string().nullable(),
  createdAt: z.string(),
});
export type WalletLogRow = z.infer<typeof walletLogRowSchema>;

export const walletLogListSchema = z.object({
  data: z.array(walletLogRowSchema),
  page: pageInfoSchema,
});
export type WalletLogList = z.infer<typeof walletLogListSchema>;

/** Every event name the domain writes, so the log filter offers exactly these. */
export const WALLET_LOG_EVENTS = [
  'wallet.topup.credited',
  'wallet.admin.adjusted',
  'wallet.charge.settled',
  'wallet.charge.partial',
  'wallet.charge.unbilled',
  'wallet.charge.refunded',
  'wallet.low_balance.alerted',
  'wallet.launch.blocked',
  'wallet.reconcile.mismatch',
  'wallet.reconcile.ok',
  'wallet.settle.failed',
  'platform.rate.saved',
  'platform.rate.deleted',
  'platform.rates.imported',
  'platform.rates.synced',
  'platform.rates.seeded',
  'platform.settings.saved',
  'platform.switches.changed',
] as const;

export const reconciliationSchema = z.object({
  checkedAt: z.string(),
  workspacesChecked: z.number().int(),
  mismatches: z.array(
    z.object({
      workspaceId: z.string().uuid(),
      workspaceName: z.string(),
      balanceMinor: z.number().int(),
      ledgerMinor: z.number().int(),
      differenceMinor: z.number().int(),
    }),
  ),
});
export type Reconciliation = z.infer<typeof reconciliationSchema>;

export const platformWalletOverviewSchema = z.object({
  currency: z.string(),
  floatMinor: z.number().int(),
  workspacesWithBalance: z.number().int(),
  lowBalanceWorkspaces: z.number().int(),
  last30d: z.object({
    toppedUpMinor: z.number().int(),
    chargedMinor: z.number().int(),
    refundedMinor: z.number().int(),
    adjustedInMinor: z.number().int(),
    adjustedOutMinor: z.number().int(),
    chargedMessages: z.number().int(),
    freeMessages: z.number().int(),
  }),
});
export type PlatformWalletOverview = z.infer<typeof platformWalletOverviewSchema>;

export { walletTxTypeSchema };
