import { z } from 'zod';
import { pageInfoSchema } from '../common/pagination';

/** `credit` puts money in, `debit` takes it out. Spends are debits: Reference stored them positive and its statement showed them as money in. */
export const walletDirectionSchema = z.enum(['in', 'out']);
export type WalletDirection = z.infer<typeof walletDirectionSchema>;

export const walletTxTypeSchema = z.enum(['earn', 'spend', 'refund', 'admin_adjust', 'topup']);
export type WalletTxType = z.infer<typeof walletTxTypeSchema>;

export const walletBillingModeSchema = z.enum(['wallet', 'plan']);

/**
 * An amount to the ledger's exact precision, as text ("192.999", "-0.958", "7.00"): at least two decimals, at most four. The
 * `...Minor` integers beside it are hundredths and lose the third and fourth decimal; screens show this one when it is present.
 */
export const exactAmountSchema = z.string().regex(/^-?\d+\.\d{2,4}$/);

// --- the wallet home (TW-WALLET-020, -023, -025) ---------------------------------------------------------------------------

export const walletSummarySchema = z.object({
  currency: z.string(),
  balanceMinor: z.number().int(),
  balanceExact: exactAmountSchema.optional(),
  /** `wallet` = every delivered message is charged; `plan` = the plan's monthly messages are free, the wallet pays beyond them. */
  billingMode: walletBillingModeSchema,
  perCountryEnabled: z.boolean(),
  /** The flat price of a message when per-country pricing is off (hundredths). */
  flatPriceMinor: z.number().int(),
  /** About how many messages the balance buys at the flat price; null when per-country prices apply or the price is 0. */
  approxMessages: z.number().int().nullable(),
  spent30dMinor: z.number().int(),
  spent30dExact: exactAmountSchema.optional(),
  /** Earnings only (referral payouts): Reference also counted top-ups and refunds here. */
  earned30dMinor: z.number().int(),
  earned30dExact: exactAmountSchema.optional(),
  toppedUp30dMinor: z.number().int(),
  refunded30dMinor: z.number().int(),
  lowBalanceThresholdMinor: z.number().int(),
  lowBalance: z.boolean(),
  plan: z.object({
    monthlyMessagesLimit: z.number().int(),
    usedThisMonth: z.number().int(),
    active: z.boolean(),
    endsAt: z.string().nullable(),
  }),
  topupUrl: z.string(),
});
export type WalletSummary = z.infer<typeof walletSummarySchema>;

export const walletTransactionSchema = z.object({
  id: z.string().uuid(),
  type: walletTxTypeSchema,
  direction: walletDirectionSchema,
  /** Signed: money in is positive, money out is negative. */
  amountMinor: z.number().int(),
  amountExact: exactAmountSchema.optional(),
  balanceAfterMinor: z.number().int(),
  balanceAfterExact: exactAmountSchema.optional(),
  source: z.string().nullable(),
  description: z.string().nullable(),
  /** The reason an operator gave for a manual adjustment. */
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type WalletTransaction = z.infer<typeof walletTransactionSchema>;

export const walletLedgerQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  cursor: z.string().min(1).max(512).optional(),
});
export type WalletLedgerQuery = z.infer<typeof walletLedgerQuerySchema>;

export const walletLedgerResponseSchema = z.object({
  data: z.array(walletTransactionSchema),
  page: pageInfoSchema,
});
export type WalletLedgerResponse = z.infer<typeof walletLedgerResponseSchema>;

// --- the statement (TW-WALLET-021, -022) -----------------------------------------------------------------------------------

/** `topup` really lists top-ups here (it matched nothing in Reference, where top-ups were stored as earnings). */
export const statementTypeSchema = z.enum([
  'all',
  'topup',
  'earn',
  'spend',
  'refund',
  'admin_adjust',
]);
export type StatementType = z.infer<typeof statementTypeSchema>;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

export const statementQuerySchema = z.object({
  type: statementTypeSchema.default('all'),
  from: isoDate,
  to: isoDate,
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(512).optional(),
});
export type StatementQuery = z.infer<typeof statementQuerySchema>;

export const messageContextSchema = z.object({
  /** campaign | broadcast | flow | scheduled | auto_reply | chat | api */
  channel: z.string().nullable(),
  campaignName: z.string().nullable(),
  recipient: z.string().nullable(),
  template: z.string().nullable(),
  country: z.string().nullable(),
  category: z.string().nullable(),
  engine: z.string().nullable(),
});
export type MessageContext = z.infer<typeof messageContextSchema>;

export const statementRowSchema = walletTransactionSchema.extend({
  moneyInMinor: z.number().int(),
  moneyInExact: exactAmountSchema.optional(),
  moneyOutMinor: z.number().int(),
  moneyOutExact: exactAmountSchema.optional(),
  context: messageContextSchema.nullable(),
});
export type StatementRow = z.infer<typeof statementRowSchema>;

export const statementResponseSchema = z.object({
  currency: z.string(),
  /** Over the WHOLE filtered set, not just this page. */
  summary: z.object({
    currentBalanceMinor: z.number().int(),
    currentBalanceExact: exactAmountSchema.optional(),
    moneyInMinor: z.number().int(),
    moneyInExact: exactAmountSchema.optional(),
    moneyOutMinor: z.number().int(),
    moneyOutExact: exactAmountSchema.optional(),
    netMinor: z.number().int(),
    netExact: exactAmountSchema.optional(),
    count: z.number().int(),
  }),
  data: z.array(statementRowSchema),
  page: pageInfoSchema,
});
export type StatementResponse = z.infer<typeof statementResponseSchema>;

/**
 * One payload for the mobile app and the browser extension (TW-WALLET-025, -029): billing mode, balance, what is left to send, and
 * the month's spend. `messagesRemaining` is -1 for "unlimited", as Reference's integrations expect.
 */
export const walletSnapshotSchema = z.object({
  billingMode: walletBillingModeSchema,
  currency: z.string(),
  balanceMinor: z.number().int(),
  flatPriceMinor: z.number().int(),
  /** Wallet mode: how many messages the balance buys at the flat price. Plan mode: what is left of the plan allowance. -1 = unlimited. */
  messagesRemaining: z.number().int(),
  /** Plan mode only: messages the wallet would cover once the allowance is used. */
  walletBufferMessages: z.number().int().nullable(),
  spentThisMonthMinor: z.number().int(),
  planActive: z.boolean(),
  monthlyMessagesLimit: z.number().int(),
  usedThisMonth: z.number().int(),
});
export type WalletSnapshot = z.infer<typeof walletSnapshotSchema>;
