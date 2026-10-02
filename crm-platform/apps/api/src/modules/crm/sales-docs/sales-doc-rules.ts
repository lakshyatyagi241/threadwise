import { createHash, randomBytes } from 'node:crypto';
import {
  ERROR_CODES,
  type SalesDocActions,
  type SalesDocKind,
  type SalesDocStatus,
} from '@crm/contracts';
import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { resolveTimezone, todayIn } from '../deals/deal-calendar';

/**
 * Pure rules of the sales-docs module: the status machine, the number format, the public token and the expiry test. Kept out of the
 * repository and the service so a unit test can pin them without a database.
 */

export const SALES_DOC_MODULE = 'sales_docs';

export type SalesDocAction =
  'send' | 'view' | 'accept' | 'decline' | 'expire' | 'revise' | 'extend' | 'convert_invoice';

/**
 * The machine (D-15: Reference let a PATCH set any status from any status). `send` on an open document is a re-send and keeps its status;
 * `extend` keeps an open document's status and reopens an expired one to where it was (viewed if the buyer had opened it).
 */
const NEXT: Record<
  SalesDocStatus,
  Partial<Record<SalesDocAction, SalesDocStatus | 'same' | 'reopen'>>
> = {
  draft: { send: 'sent', accept: 'accepted', decline: 'declined' },
  sent: {
    send: 'same',
    view: 'viewed',
    accept: 'accepted',
    decline: 'declined',
    expire: 'expired',
    revise: 'draft',
    extend: 'same',
  },
  viewed: {
    send: 'same',
    accept: 'accepted',
    decline: 'declined',
    expire: 'expired',
    revise: 'draft',
    extend: 'same',
  },
  accepted: { convert_invoice: 'converted' },
  declined: { revise: 'draft' },
  expired: { revise: 'draft', extend: 'reopen' },
  converted: {},
};

/** The status after `action`, or 409 SALESDOC_INVALID_TRANSITION. `viewed` only matters for reopening an expired document. */
export function nextStatus(
  from: SalesDocStatus,
  action: SalesDocAction,
  opts: { everViewed?: boolean } = {},
): SalesDocStatus {
  const to = NEXT[from][action];
  if (to === undefined) throw invalidTransition(from, action);
  if (to === 'same') return from;
  if (to === 'reopen') return opts.everViewed ? 'viewed' : 'sent';
  return to;
}

export function canTransition(from: SalesDocStatus, action: SalesDocAction): boolean {
  return NEXT[from][action] !== undefined;
}

export function invalidTransition(from: SalesDocStatus, action: SalesDocAction): AppError {
  return new AppError(
    ERROR_CODES.SALESDOC_INVALID_TRANSITION,
    `A ${from} document cannot be ${past(action)}.`,
    HttpStatus.CONFLICT,
    [
      { path: 'from', message: from },
      { path: 'action', message: action },
    ],
  );
}

const past = (a: SalesDocAction): string =>
  ({
    send: 'sent',
    view: 'viewed',
    accept: 'accepted',
    decline: 'declined',
    expire: 'expired',
    revise: 'revised',
    extend: 'extended',
    convert_invoice: 'converted to an invoice',
  })[a];

/** Only a draft is edited in place; accepted and converted documents are evidence and are never deleted. */
export const isEditable = (s: SalesDocStatus): boolean => s === 'draft';
export const isDeletable = (s: SalesDocStatus): boolean => s !== 'accepted' && s !== 'converted';
export const isOpen = (s: SalesDocStatus): boolean => s === 'sent' || s === 'viewed';

/** What the status allows next (the web uses it to show or hide the buttons; the service enforces the same rules). */
export function actionsOf(status: SalesDocStatus, hasDeal: boolean): SalesDocActions {
  return {
    edit: isEditable(status),
    send: canTransition(status, 'send'),
    decide: canTransition(status, 'accept'),
    revise: canTransition(status, 'revise'),
    extend: canTransition(status, 'extend'),
    convertInvoice: canTransition(status, 'convert_invoice'),
    convertDeal: !hasDeal,
    delete: isDeletable(status),
  };
}

// --- numbering -------------------------------------------------------------------------------------------------------------

export interface NumberingSettings {
  proposalPrefix: string;
  estimatePrefix: string;
  numberPadding: number;
  proposalStart: number;
  estimateStart: number;
}

export const DEFAULT_NUMBERING: NumberingSettings = {
  proposalPrefix: 'PRO',
  estimatePrefix: 'EST',
  numberPadding: 4,
  proposalStart: 1,
  estimateStart: 1,
};

/** `PRO-0007`; past the padding the number simply grows (`PRO-10000`). */
export function formatNumber(prefix: string, padding: number, seq: number): string {
  return `${prefix}-${String(seq).padStart(padding, '0')}`;
}

export const prefixFor = (s: NumberingSettings, kind: SalesDocKind): string =>
  kind === 'proposal' ? s.proposalPrefix : s.estimatePrefix;
export const startFor = (s: NumberingSettings, kind: SalesDocKind): number =>
  kind === 'proposal' ? s.proposalStart : s.estimateStart;

// --- the public token ------------------------------------------------------------------------------------------------------

/** 256 random bits, base64url: 43 characters, unguessable. Only its SHA-256 is looked up; an encrypted copy lets staff copy the link. */
export const generateToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');
/** The shape of a token, checked before any lookup so junk never reaches the database. */
export const looksLikeToken = (raw: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(raw);

// --- expiry ----------------------------------------------------------------------------------------------------------------

/**
 * An open document is past its valid-until date when the date is before today in the WORKSPACE's zone (Reference compared with the
 * server's date): a document valid until the 15th is still valid all of the 15th.
 */
export function isOverdue(
  status: SalesDocStatus,
  validUntil: string | null,
  tzRaw: string | null,
  now: Date = new Date(),
): boolean {
  if (!isOpen(status) || !validUntil) return false;
  return validUntil < todayIn(resolveTimezone(tzRaw), now);
}

/** `YYYY-MM-DD` plus `days`, calendar arithmetic in UTC (the date has no zone). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
