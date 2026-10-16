import {
  currencyExponent,
  ERROR_CODES,
  type CallLogRow,
  type ConversationSummary,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { titleCaseKey } from './contact-model';

/**
 * Pure helpers behind the contact's Deals, Conversations, Field history and Communication stats sections.
 * Nothing here talks to the network or to React.
 */

// --- who is "this contact" in a list that has no contact filter ---------------------------------------------------------

/** The digits of a phone number ("+91 98765-43210" -> "919876543210"); empty when there are none. */
export function phoneDigits(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D+/g, '');
}

/** Fewer digits than this is not a phone number worth searching by (the inbox would match half the workspace). */
const MIN_PHONE_DIGITS = 5;

/**
 * What to put in `q` of a list that can only search by text (the inbox list, the call log): the phone's digits, else the
 * e-mail address, else the name. `null` when the contact has none of them, so nothing is searched at all.
 * The result is only a way to narrow the list: the rows are always re-checked against the contact id (`conversationsOfContact`, `callsOfContact`).
 */
export function contactSearchTerm(contact: {
  phone: string | null;
  email: string | null;
  name: string | null;
}): string | null {
  const digits = phoneDigits(contact.phone);
  if (digits.length >= MIN_PHONE_DIGITS) return digits;
  const email = contact.email?.trim();
  if (email) return email;
  const name = contact.name?.trim();
  return name ? name : null;
}

/** The rows that really belong to this contact: a fuzzy search match for somebody else is dropped. */
export function conversationsOfContact<T extends Pick<ConversationSummary, 'contact'>>(
  rows: readonly T[],
  contactId: string,
): T[] {
  return rows.filter((r) => r.contact?.id === contactId);
}

export function callsOfContact<T extends Pick<CallLogRow, 'contactId'>>(
  rows: readonly T[],
  contactId: string,
): T[] {
  return rows.filter((r) => r.contactId === contactId);
}

// --- conversation figures -----------------------------------------------------------------------------------------------

export interface ConversationFigures {
  count: number;
  /** Unread messages over all the conversations found. */
  unread: number;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
}

const later = (a: string | null, b: string | null): string | null => {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
};

/**
 * The only message figures the API gives per contact: how many conversations, the unread counters and the latest inbound and
 * outbound instants. There are no per-contact sent / delivered / read counts, so none are made up here.
 */
export function conversationFigures(
  rows: readonly Pick<ConversationSummary, 'unreadCount' | 'lastInboundAt' | 'lastOutboundAt'>[],
): ConversationFigures {
  return rows.reduce<ConversationFigures>(
    (acc, r) => ({
      count: acc.count + 1,
      unread: acc.unread + r.unreadCount,
      lastInboundAt: later(acc.lastInboundAt, r.lastInboundAt),
      lastOutboundAt: later(acc.lastOutboundAt, r.lastOutboundAt),
    }),
    { count: 0, unread: 0, lastInboundAt: null, lastOutboundAt: null },
  );
}

// --- call figures -------------------------------------------------------------------------------------------------------

export interface CallFigures {
  total: number;
  answered: number;
  missed: number;
  /** Whole minutes of talk time (the sum of the seconds, then divided: the log's own rounding). */
  minutes: number;
}

/**
 * Totals over a contact's calls. Same meaning as the call log's cards: answered = ended with talk time (`completed`); missed =
 * a call the customer placed that nobody talked to (an inbound call that is not completed and not still running).
 */
export function callFigures(
  rows: readonly Pick<CallLogRow, 'status' | 'direction' | 'durationSec'>[],
): CallFigures {
  let answered = 0;
  let missed = 0;
  let seconds = 0;
  for (const r of rows) {
    seconds += r.durationSec;
    if (r.status === 'completed') answered += 1;
    else if (r.direction === 'inbound' && r.status !== 'in-progress') missed += 1;
  }
  return { total: rows.length, answered, missed, minutes: Math.floor(seconds / 60) };
}

/** `YYYY-MM-DD` (UTC) of the day `days` days before `now`: the `from` of a call-log request that reaches that far back. */
export function dayBefore(now: Date, days: number): string {
  const d = new Date(now.getTime() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

// --- money --------------------------------------------------------------------------------------------------------------

/**
 * One amount in its own currency ("$1,250.00", "¥1,000"). The API sends an exact decimal string in major units; nothing is
 * converted or added across currencies. An unknown code falls back to "CODE 1,250.00".
 */
export function formatMoney(amount: string, currency: string, locale: string): string {
  const exp = currencyExponent(currency);
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${currency} ${amount}`;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString(locale, { minimumFractionDigits: exp, maximumFractionDigits: exp })}`;
  }
}

// --- answers that mean "not on your plan / no access" -------------------------------------------------------------------

/**
 * A read the plan or the person's role does not allow: 402 (payment required), 403, or 422 `PLAN_FEATURE_LOCKED`. Such a section
 * says so in one quiet line instead of showing an error.
 */
export function isNotAvailableToYou(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 402 || error.status === 403) return true;
  return error.status === 422 && error.code === ERROR_CODES.PLAN_FEATURE_LOCKED;
}

// --- field history ------------------------------------------------------------------------------------------------------

/** A field's old or new value as text; empty (null, undefined, blank, empty list) is an empty string and the screen draws a dash. */
export function historyValueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (Array.isArray(value) && value.length === 0) return '';
  try {
    const json = JSON.stringify(value);
    return json === '{}' || json === undefined ? '' : json;
  } catch {
    return String(value);
  }
}

/** A stable list key for an entry (the API sends no id: one audit row can change several fields at the same instant). */
export const historyEntryKey = (
  e: { fieldKey: string; changedAt: string; actorType: string },
  index: number,
): string => `${e.changedAt}|${e.fieldKey}|${e.actorType}|${index}`;

/**
 * `q` for the call log: a call is found by the customer's number or by part of the contact's name (an e-mail address matches
 * nothing there), so the phone's digits, else the name. `null` when neither exists.
 */
export function callSearchTerm(contact: {
  phone: string | null;
  name: string | null;
}): string | null {
  const digits = phoneDigits(contact.phone);
  if (digits.length >= MIN_PHONE_DIGITS) return digits;
  const name = contact.name?.trim();
  return name ? name : null;
}

/**
 * A readable name for a field key that has no message of its own: `customFields.lead_source` -> "Lead Source",
 * `someFieldKey` -> "Some Field Key".
 */
export function fallbackFieldLabel(fieldKey: string): string {
  const bare = fieldKey.replace(/^customFields\./, '');
  return titleCaseKey(bare.replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
}
