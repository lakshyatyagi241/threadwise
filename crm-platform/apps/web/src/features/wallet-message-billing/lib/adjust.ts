import {
  WALLET_LIMITS,
  adjustWalletSchema,
  type AdjustWalletInput,
  type AdjustWalletResult,
} from '@crm/contracts';
import { parseAmount } from './money';

export type AdjustDirection = AdjustWalletInput['direction'];

export interface AdjustDraft {
  direction: AdjustDirection;
  amount: string;
  note: string;
}

export const EMPTY_ADJUST: AdjustDraft = { direction: 'credit', amount: '', note: '' };

export type AmountProblem = 'required' | 'invalid' | 'zero' | 'tooLarge';
export type NoteProblem = 'short' | 'long';

export interface AdjustCheck {
  input: AdjustWalletInput | null;
  amount: AmountProblem | null;
  note: NoteProblem | null;
  /** The amount in hundredths when it parses, for the summary and the preview. */
  amountMinor: number | null;
}

/**
 * Client-side check with the contract's own schema; the server stays the authority. The submit button is enabled only when
 * `input` is not null, so a missing or too-short reason can never be sent.
 */
export function checkAdjust(draft: AdjustDraft): AdjustCheck {
  const text = draft.amount.trim();
  const amountMinor = parseAmount(text);
  let amount: AmountProblem | null = null;
  if (text === '') amount = 'required';
  else if (amountMinor === null) amount = 'invalid';
  else if (amountMinor === 0) amount = 'zero';
  else if (amountMinor > WALLET_LIMITS.maxAmountMinor) amount = 'tooLarge';

  const noteLen = draft.note.trim().length;
  const note: NoteProblem | null =
    noteLen < WALLET_LIMITS.noteMin ? 'short' : noteLen > WALLET_LIMITS.noteMax ? 'long' : null;

  const parsed = adjustWalletSchema.safeParse({
    direction: draft.direction,
    amount: text,
    note: draft.note,
  });
  return {
    input: amount === null && note === null && parsed.success ? parsed.data : null,
    amount,
    note,
    amountMinor,
  };
}

/** What the balance will be if the adjustment applies in full. A debit stops at 0, as the server does. */
export function previewBalance(
  balanceMinor: number,
  direction: AdjustDirection,
  amountMinor: number,
): number {
  return direction === 'credit'
    ? balanceMinor + amountMinor
    : Math.max(0, balanceMinor - amountMinor);
}

/** A debit larger than the balance only takes what is there. */
export const willBeCapped = (
  balanceMinor: number,
  direction: AdjustDirection,
  amountMinor: number,
): boolean => direction === 'debit' && amountMinor > balanceMinor;

/** `partial` = the server applied less than was asked (a debit hit 0): the operator is told what really happened. */
export function outcomeOf(result: AdjustWalletResult): 'applied' | 'partial' {
  return result.appliedMinor < result.requestedMinor ? 'partial' : 'applied';
}

/**
 * One Idempotency-Key per distinct submission: a retry of the same request replays it, while a changed amount, direction or
 * reason is a new request and gets a new key. The key is created when the dialog opens and kept until it closes.
 */
export interface KeyMemo {
  signature: string;
  key: string;
}

export const signatureOf = (workspaceId: string, input: AdjustWalletInput): string =>
  JSON.stringify([workspaceId, input.direction, input.amount, input.note]);

export function keyFor(
  memo: KeyMemo | null,
  signature: string,
  generate: () => string = () => crypto.randomUUID(),
): KeyMemo {
  return memo && memo.signature === signature ? memo : { signature, key: generate() };
}
