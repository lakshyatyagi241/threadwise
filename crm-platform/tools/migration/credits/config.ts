import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { minorText, plainDecimal, toMinor } from './decimal';

/**
 * The operator's side of the credits step. Every human decision is a visible switch or file here, recorded by the run
 * (`migration.run_log _credits options`) and compared by reconcile.
 *
 *  - `credit-opening.json` (default `<dumps>/<client>/credit-opening.json`): the balance of the Waboo credit pool at the end of the
 *    migrated credit history, confirmed OUTSIDE the dump. `credit_logs.new_balance` is not that balance (WhatsApp debits and
 *    purchases are not in credit_logs), so it is never used as one.
 *  - `--no-wallet`: load the token counters and the usage charges but write NO wallet rows.
 *  - `--credit-workspace-id`: the one Waboo workspace whose credit rows load, when the dump holds several.
 */
export class CreditsConfigError extends Error {}

export interface CreditOpeningFile {
  /** the balance as a decimal STRING with at most two fraction digits ("1234.50"); a JSON number is refused (no floats near money) */
  amount: string;
  /** ISO 4217 currency of the wallet: three upper-case letters */
  currency: string;
  /** when the balance was read; must not be before the last migrated credit row */
  asOf: string;
  /** a person and where the figure came from (billing screen, invoice number ...) */
  confirmedBy: string;
  note?: string;
}

export interface CreditOpening {
  /** B in hundredths */
  minor: bigint;
  amountText: string;
  currency: string;
  asOf: string;
  confirmedBy: string;
  note: string | null;
  sha256: string;
}

export interface CreditOptions {
  /** path of credit-opening.json (default: <dumps>/<client>/credit-opening.json when it exists) */
  openingPath?: string;
  /** write no wallet rows (explicit opt-out) */
  noWallet?: boolean;
  /** the Waboo workspace_id whose credit rows load */
  workspaceId?: string;
}

export interface CreditSettings {
  wallet: boolean;
  opening: CreditOpening | null;
  workspaceId: string | null;
}

export const OPENING_FILE = 'credit-opening.json';
const KEYS = new Set(['amount', 'currency', 'asOf', 'confirmedBy', 'note']);

export function parseOpening(text: string): CreditOpening {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new CreditsConfigError('CREDITS_OPENING: credit-opening.json is not valid JSON');
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    throw new CreditsConfigError('CREDITS_OPENING: credit-opening.json must be a JSON object');
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o))
    if (!KEYS.has(k))
      throw new CreditsConfigError(
        `CREDITS_OPENING: unknown key "${k}" in credit-opening.json (allowed: ${[...KEYS].join(', ')})`,
      );
  if (typeof o.amount !== 'string')
    throw new CreditsConfigError(
      'CREDITS_OPENING: "amount" must be a decimal STRING such as "1234.50" (a JSON number is refused: money is never a float)',
    );
  const plain = /^\d+(\.\d{1,2})?$/.test(o.amount.trim()) ? plainDecimal(o.amount) : null;
  if (plain === null)
    throw new CreditsConfigError(
      'CREDITS_OPENING: "amount" must be a non-negative decimal with at most two fraction digits',
    );
  if (typeof o.currency !== 'string' || !/^[A-Z]{3}$/.test(o.currency))
    throw new CreditsConfigError(
      'CREDITS_OPENING: "currency" must be an ISO 4217 code in capitals (INR, USD ...)',
    );
  const asOf = typeof o.asOf === 'string' ? new Date(o.asOf) : null;
  if (
    !asOf ||
    Number.isNaN(asOf.getTime()) ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:\d\d)$/.test(o.asOf as string)
  )
    throw new CreditsConfigError(
      'CREDITS_OPENING: "asOf" must be an ISO date-time WITH a zone, such as 2026-10-08T18:30:00Z (a date without a zone is read in the machine\'s zone)',
    );
  const by = typeof o.confirmedBy === 'string' ? o.confirmedBy.trim() : '';
  if (by.length < 3 || by.length > 160)
    throw new CreditsConfigError(
      'CREDITS_OPENING: "confirmedBy" must say who confirmed the balance and where it came from (3..160 characters)',
    );
  const note = typeof o.note === 'string' && o.note.trim() ? o.note.trim().slice(0, 300) : null;
  const minor = toMinor(plain);
  return {
    minor,
    amountText: minorText(minor),
    currency: o.currency,
    asOf: asOf.toISOString(),
    confirmedBy: by,
    note,
    sha256: createHash('sha256').update(text).digest('hex'),
  };
}

export function resolveCredits(
  o: CreditOptions | undefined,
  dumpsDir: string,
  client: string,
  creditDocs: number,
): CreditSettings {
  const opts = o ?? {};
  const wallet = !opts.noWallet;
  const path = opts.openingPath ?? join(dumpsDir, client, OPENING_FILE);
  let opening: CreditOpening | null = null;
  if (wallet) {
    if (existsSync(path)) opening = parseOpening(readFileSync(path, 'utf8'));
    else if (opts.openingPath)
      throw new CreditsConfigError(`CREDITS_OPENING: ${path} does not exist`);
  }
  if (wallet && creditDocs > 0 && !opening)
    throw new CreditsConfigError(
      `CREDITS_OPENING_REQUIRED: the dump has ${creditDocs} credit_logs rows but there is no ${OPENING_FILE}. Wallet rows are NOT written without a balance that was confirmed outside the dump ` +
        `(credit_logs.new_balance is not the balance: WhatsApp debits and purchases are not in credit_logs). Put {"amount":"1234.50","currency":"INR","asOf":"<ISO>","confirmedBy":"<who, where from>"} ` +
        `at ${path} (or pass --credit-opening FILE), or pass --no-wallet to load only the token counters and the usage charges. Nothing was written`,
    );
  const ws = opts.workspaceId?.trim();
  return { wallet, opening, workspaceId: ws ? ws : null };
}

/** What the run records and reconcile compares. */
export const recordOf = (s: CreditSettings): Record<string, unknown> => ({
  wallet: s.wallet,
  workspaceId: s.workspaceId,
  opening: s.opening
    ? {
        amount: s.opening.amountText,
        currency: s.opening.currency,
        asOf: s.opening.asOf,
        confirmedBy: s.opening.confirmedBy,
        sha256: s.opening.sha256,
      }
    : null,
});
