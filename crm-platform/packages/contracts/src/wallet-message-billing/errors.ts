/** Stable codes of the wallet and per-message billing domain (WD-WALLET). The web switches on these, never on the wording. */
export const WALLET_ERROR_CODES = {
  /** A bulk send was refused because the workspace pays per message and its wallet is empty (WD-WALLET-013). */
  WALLET_EMPTY: 'WALLET_EMPTY',
  /** A debit asked for more than the balance holds. Settlement never raises this (it charges what is there). */
  WALLET_INSUFFICIENT_BALANCE: 'WALLET_INSUFFICIENT_BALANCE',
  /** The workspace has no wallet to adjust or read. */
  WALLET_NOT_FOUND: 'WALLET_NOT_FOUND',
  /** An operator adjustment without a usable note (the note is mandatory). */
  WALLET_NOTE_REQUIRED: 'WALLET_NOTE_REQUIRED',
  /** The amount of a top-up or adjustment is outside what is accepted. */
  WALLET_AMOUNT_INVALID: 'WALLET_AMOUNT_INVALID',
  /** A rate row that cannot be saved (country, category or amount out of range, duplicate key). */
  WALLET_RATE_INVALID: 'WALLET_RATE_INVALID',
  /** The rate card file could not be read or has no usable row. */
  WALLET_IMPORT_FAILED: 'WALLET_IMPORT_FAILED',
  /** Neither the live Meta source nor the bundled card could be read. */
  WALLET_SYNC_FAILED: 'WALLET_SYNC_FAILED',
} as const;
