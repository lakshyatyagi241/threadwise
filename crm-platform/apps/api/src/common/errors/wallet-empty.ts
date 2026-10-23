import { ERROR_CODES } from '@crm/contracts';
import { AppError } from './app-error';

/**
 * True for the refusal the wallet's pre-work gate throws (`AiChargeService.guardCall`, `UsageBillingService.assertCanAfford`). Background
 * and public code catches exactly this and takes its fallback path (a fixed reply, a skipped lookup, the original text); every other
 * error is a fault and goes on up.
 */
export const isWalletEmpty = (err: unknown): boolean =>
  err instanceof AppError && err.code === ERROR_CODES.WALLET_EMPTY;
