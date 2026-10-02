import { randomInt } from 'node:crypto';
import type { SuppTicketStatus } from '@crm/contracts';

/**
 * The ticket state rules, in one place so the operator panel, the customer reply and every later writer
 * (kanban, playbooks) behave the same (WD-SUPP-012 port note). Pure functions: no database, no clock.
 */

const NUMBER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** `TKT-` plus six random upper-case letters or digits (WD-SUPP-002). */
export function ticketNumber(random: (max: number) => number = randomInt): string {
  let out = 'TKT-';
  for (let i = 0; i < 6; i++) out += NUMBER_ALPHABET[random(NUMBER_ALPHABET.length)];
  return out;
}

/** The documented fallback after repeated collisions: `TKT-` + four letters + `-` + last four digits of the unix time. */
export function fallbackTicketNumber(
  now: number,
  random: (max: number) => number = randomInt,
): string {
  let letters = '';
  for (let i = 0; i < 4; i++) letters += NUMBER_ALPHABET[random(26)];
  return `TKT-${letters}-${String(Math.floor(now / 1000) % 10000).padStart(4, '0')}`;
}

const OPEN_LIKE: readonly SuppTicketStatus[] = ['open', 'in_progress', 'pending'];

/**
 * What `resolved_at` becomes when an operator sets a status (WD-SUPP-012).
 *   - resolved: stamp once (an already-resolved ticket keeps its original time)
 *   - closed: keep whatever is there (resolved then closed keeps the resolution time)
 *   - open / in_progress / pending: cleared.
 * DEVIATION from WaDesk: it cleared only when the CURRENT status was `resolved`, so resolved -> closed -> open kept a
 * stale timestamp that then counted the reopened ticket as resolved. Reopening always clears it here.
 */
export function resolvedAtAfterStatus(
  next: SuppTicketStatus,
  current: Date | null,
  now: Date,
): Date | null {
  if (next === 'resolved') return current ?? now;
  if (next === 'closed') return current;
  return OPEN_LIKE.includes(next) ? null : current;
}

export interface StaffReplyEffect {
  /** Stamp first_response_at (only when empty). */
  stampFirstResponse: boolean;
  /** Stamp last_reply_at. */
  touchLastReply: boolean;
  /** New status, or null for no change. */
  status: SuppTicketStatus | null;
}

/**
 * A reply moves an `open` ticket to `in_progress`, starts the first-response clock's end and bumps last_reply_at.
 * DEVIATION from WaDesk: an internal note changes nothing on the ticket (WaDesk moved it to in_progress and bumped
 * last_reply_at, so a private note looked like activity the customer never saw).
 */
export function staffReplyEffect(
  ticket: { status: SuppTicketStatus; firstResponseAt: Date | null },
  isInternalNote: boolean,
): StaffReplyEffect {
  if (isInternalNote) return { stampFirstResponse: false, touchLastReply: false, status: null };
  return {
    stampFirstResponse: ticket.firstResponseAt === null,
    touchLastReply: true,
    status: ticket.status === 'open' ? 'in_progress' : null,
  };
}

export type CustomerReplyEffect =
  { allowed: false } | { allowed: true; reopen: boolean; status: SuppTicketStatus | null };

/**
 * The owner's follow-up (WD-SUPP-005). A resolved ticket reopens as `in_progress` with resolved_at cleared; `pending`
 * stays pending (WaDesk behaviour, kept: an operator moves it). DEVIATION: a closed ticket refuses the reply, where
 * WaDesk's form hid the box but its endpoint still accepted a hand-made POST and reopened it.
 */
export function customerReplyEffect(status: SuppTicketStatus): CustomerReplyEffect {
  if (status === 'closed') return { allowed: false };
  if (status === 'resolved') return { allowed: true, reopen: true, status: 'in_progress' };
  return { allowed: true, reopen: false, status: null };
}

/** The customer-side "open" count: neither resolved nor closed (WaDesk counted closed as open; deliberate fix). */
export const isCustomerOpen = (status: SuppTicketStatus): boolean =>
  status !== 'resolved' && status !== 'closed';

/** Escapes LIKE wildcards so a search for `50%` finds "50%" and not everything. */
export const escapeLike = (q: string): string => q.replace(/[\\%_]/g, (c) => `\\${c}`);

export const excerpt = (text: string, max = 140): string =>
  text.length <= max ? text : `${text.slice(0, max).trimEnd()}...`;
