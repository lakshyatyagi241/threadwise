import type { Soft } from '../transform/types';
import { cutText, str, toDate, type Doc } from '../util';
import type { CreditSettings } from './config';
import { counter, plainDecimal, scaled, toMinor } from './decimal';

/**
 * The per-document rules of the credits step, as pure functions of one document: the plan of pass 1 (which needs the verdict of every
 * document BEFORE the first row is written, because balance_after is part of an immutable row) and the transforms both call them.
 * reconcile/oracle-credits.ts writes the same rules a second time, independently.
 */

/** WALLET_LIMITS.maxAmountMinor of the application (packages/contracts wallet-message-billing/money.ts): hundredths. */
export const MAX_MINOR = 1_000_000_000n;
export const INT4 = 2_147_483_647;

export interface Win {
  lo: number;
  hi: number;
}
/** The window ensure_monthly_partition accepts (10 years back to 1 year ahead), measured from the dump time. */
export function windowOf(referenceAt: string): Win {
  const r = new Date(referenceAt);
  const y = r.getUTCFullYear();
  const m = r.getUTCMonth();
  return { lo: Date.UTC(y - 10, m, 1), hi: Date.UTC(y + 1, m + 1, 1) };
}
const monthStart = (d: Date): number => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);

export type DateVerdict =
  { ok: true; at: Date } | { ok: false; code: 'NO_DATE' | 'BAD_DATE'; reason: string };

export function dateVerdict(v: unknown, win: Win): DateVerdict {
  const at = v === null || v === undefined || v === '' ? null : toDate(v);
  if (!at)
    return { ok: false, code: 'NO_DATE', reason: 'created_time is missing or not a readable date' };
  if (monthStart(at) < win.lo || monthStart(at) >= win.hi)
    return {
      ok: false,
      code: 'BAD_DATE',
      reason: 'created_time is outside the partition window (10 years back, 1 year ahead)',
    };
  return { ok: true, at };
}

// ------------------------------------------------------------------------------------------------------------------- credit_logs

export type Verdict<T, X = unknown> =
  | ({ kind: 'load' } & T)
  | ({ kind: 'exclude'; code: string; reason: string } & X)
  | { kind: 'quarantine'; code: string; reason: string };

export interface WalletLoad {
  at: Date;
  /** hundredths, positive: how much the wallet pays */
  minor: bigint;
  /** the exact decimal text of credits_deducted */
  plain: string;
  /** exact - posted, scaled by 10^18 (0 when the amount had at most two fraction digits) */
  residual: bigint;
}
/** What an excluded document leaves unposted (BELOW_LEDGER_PRECISION), scaled by 10^18. */
export interface Unposted {
  unposted?: bigint;
}

export function workspaceOf(doc: Doc): string {
  return str(doc.workspace_id) ?? '';
}

export function walletVerdict(
  doc: Doc,
  s: CreditSettings,
  win: Win,
): Verdict<WalletLoad, Unposted> {
  if (!s.wallet)
    return {
      kind: 'exclude',
      code: 'WALLET_NOT_MIGRATED',
      reason:
        'the run was started with --no-wallet: no wallet row is written (token counters still load)',
    };
  if (s.workspaceId !== null && workspaceOf(doc) !== s.workspaceId)
    return {
      kind: 'quarantine',
      code: 'OTHER_WORKSPACE',
      reason: 'workspace_id is not the one chosen with --credit-workspace-id',
    };
  const d = dateVerdict(doc.created_time, win);
  if (!d.ok) return { kind: 'quarantine', code: d.code, reason: d.reason };
  const plain = plainDecimal(doc.credits_deducted);
  if (plain === null)
    return {
      kind: 'quarantine',
      code: 'NOT_A_NUMBER',
      reason: 'credits_deducted is missing or is not a finite number',
    };
  if (plain.startsWith('-'))
    return {
      kind: 'quarantine',
      code: 'NEGATIVE_DEDUCTION',
      reason:
        'credits_deducted is negative: not guessed to be a refund (the wallet ledger has no row for it)',
    };
  const minor = toMinor(plain);
  if (minor === 0n) {
    const exact = scaled(plain);
    return exact === 0n
      ? {
          kind: 'exclude',
          code: 'ZERO_AMOUNT',
          reason: 'credits_deducted is 0: no money moved (a ledger row cannot be zero)',
        }
      : {
          kind: 'exclude',
          code: 'BELOW_LEDGER_PRECISION',
          reason:
            'credits_deducted rounds to less than 0.01, the ledger precision (the exact amount is summed in the report)',
          unposted: exact,
        };
  }
  if (minor > MAX_MINOR)
    return {
      kind: 'quarantine',
      code: 'AMOUNT_OVER_LIMIT',
      reason: 'credits_deducted is above the 10,000,000.00 the wallet accepts in one posting',
    };
  return {
    kind: 'load',
    at: d.at,
    minor,
    plain,
    residual: scaled(plain) - minor * 10n ** 16n,
  };
}

export interface TokenLoad {
  at: Date;
  prompt: number;
  completion: number;
  total: number;
  soft: Soft[];
}

export function tokensVerdict(doc: Doc, s: CreditSettings, win: Win): Verdict<TokenLoad> {
  if (s.workspaceId !== null && workspaceOf(doc) !== s.workspaceId)
    return {
      kind: 'quarantine',
      code: 'OTHER_WORKSPACE',
      reason: 'workspace_id is not the one chosen with --credit-workspace-id',
    };
  const d = dateVerdict(doc.created_time, win);
  if (!d.ok) return { kind: 'quarantine', code: d.code, reason: d.reason };
  const soft: Soft[] = [];
  const read = (field: string): number | null => {
    const v = doc[field];
    if (v === null || v === undefined || v === '') return null;
    const n = counter(v);
    if (n === null || n > INT4) {
      soft.push({
        code: 'BAD_TOKEN_COUNT',
        reason: `${field} is not a whole non-negative number that fits the column: stored as 0`,
        detail: { field },
      });
      return null;
    }
    return n;
  };
  let prompt = read('input_tokens') ?? 0;
  let completion = read('output_tokens') ?? 0;
  const used = read('tokens_used');
  read('cached_input_tokens'); // no column: only checked, so a bad value is reported
  let total = prompt + completion;
  if (total > INT4) {
    soft.push({
      code: 'TOKEN_OVERFLOW',
      reason: 'input + output tokens exceed the column: all three counters stored as 0',
    });
    prompt = 0;
    completion = 0;
    total = 0;
  } else if (used !== null) {
    if (used < total)
      soft.push({
        code: 'TOKEN_TOTAL_MISMATCH',
        reason: 'tokens_used is lower than input + output: stored as their sum',
        detail: { used, sum: total },
      });
    else total = used; // Waboo's figure (cached tokens may be counted in it) is kept
  }
  return { kind: 'load', at: d.at, prompt, completion, total, soft };
}

/** `type: openai_api` is the one vendor tag seen in the pilot data. */
export function providerOf(type: unknown, model: unknown): { provider: string; soft: Soft[] } {
  const t = (str(type) ?? '').toLowerCase();
  const m = str(model) ?? '';
  if (t === 'openai_api') return { provider: 'openai', soft: [] };
  const prefix = /^([a-z0-9][a-z0-9_.-]{0,40})\//i.exec(m)?.[1]?.toLowerCase();
  if (prefix) return { provider: prefix, soft: [] };
  return {
    provider: 'unknown',
    soft: [
      {
        code: 'PROVIDER_GUESS',
        reason: 'neither type nor the model name says which vendor: provider stored as "unknown"',
        detail: { type: t.slice(0, 40), model: m.slice(0, 80) },
      },
    ],
  };
}

export const clip = (v: unknown, n: number): string | null => {
  const s = str(v);
  return s === null ? null : cutText(s, n);
};

// -------------------------------------------------------------------------------------------- whatsapp_broadcasting_data (billing)

/** The same two-line rule as the broadcast step's NON_BROADCAST_SOURCE: not source = broadcast, or no broadcast_id. */
export function isNonBroadcast(doc: Doc): boolean {
  return (str(doc.source) ?? '').toLowerCase() !== 'broadcast' || !str(doc.broadcast_id);
}

export interface UsageLoad {
  at: Date;
  wamid: string;
}

export function usageVerdict(doc: Doc, win: Win): Verdict<UsageLoad> {
  const wamid = str(doc.message_id);
  if (!wamid)
    return {
      kind: 'quarantine',
      code: 'NO_MESSAGE_ID',
      reason: 'message_id is missing: a usage charge is keyed by the WhatsApp message id (wamid)',
    };
  const d = dateVerdict(doc.created_time, win);
  if (!d.ok) return { kind: 'quarantine', code: d.code, reason: d.reason };
  return { kind: 'load', at: d.at, wamid };
}

export const USAGE_CATEGORIES = new Set(['marketing', 'utility', 'authentication', 'service']);
