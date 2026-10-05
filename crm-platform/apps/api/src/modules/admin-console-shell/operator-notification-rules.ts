import {
  OPERATOR_NOTIFICATION_TYPES,
  type OperatorNotification,
  type OperatorNotificationType,
  type OperatorNotificationsQuery,
} from '@crm/contracts';

/** How many of each kind Reference reads before merging, and how many the bell and the page show. */
export const PER_KIND_LIMIT = 40;
export const BELL_LIMIT = 15;
export const PAGE_LIMIT = 120;
/** A first-time operator sees the last two weeks as unread. */
export const FIRST_SEEN_DAYS = 14;
export const STATS_DAYS = 30;

/** Where each kind leads in the console. */
export const ACTION_URL: Record<OperatorNotificationType, string> = {
  signup: '/admin/workspace-plans',
  payment: '/admin/financial',
  ticket: '/admin/support',
  contact: '/admin/contact-messages',
  workspace: '/admin/workspace-plans',
};

/** A source row, before it is dressed as a notification. */
export interface FeedRow {
  type: OperatorNotificationType;
  uuid: string;
  at: Date;
  /** Kind-specific facts: name and email, order number, amount, subject, topic. */
  a: string | null;
  b: string | null;
  /** Orders only: paid or not. */
  paid?: boolean;
}

const join = (...parts: Array<string | null | undefined>): string | null => {
  const text = parts.filter((p) => p && p.trim() !== '').join(' · ');
  return text === '' ? null : text;
};

/** Money arrives as a string with four decimals; show two without going through a float. */
export function money(currency: string | null, total: string | null): string | null {
  if (total === null) return null;
  const [whole = '0', frac = ''] = total.split('.');
  return join(currency, `${whole}.${(frac + '00').slice(0, 2)}`)?.replace(' · ', ' ') ?? null;
}

export function toNotification(row: FeedRow, seen: Date): OperatorNotification {
  const base = {
    id: `${row.type}-${row.uuid}`,
    type: row.type,
    unread: row.at.getTime() > seen.getTime(),
    actionUrl: ACTION_URL[row.type],
    at: row.at.toISOString(),
  };
  switch (row.type) {
    case 'signup':
      return {
        ...base,
        titleKey: 'signup',
        ref: null,
        message: join(row.a, row.b),
        severity: 'info',
      };
    case 'payment':
      return {
        ...base,
        titleKey: row.paid ? 'paymentReceived' : 'newOrder',
        ref: row.a,
        message: row.b,
        severity: row.paid ? 'success' : 'info',
      };
    case 'ticket':
      return {
        ...base,
        titleKey: 'newTicket',
        ref: null,
        message: row.a ?? row.b,
        severity: 'warning',
      };
    case 'contact':
      return {
        ...base,
        titleKey: 'newContactMessage',
        ref: null,
        message: join(row.a, row.b),
        severity: 'info',
      };
    case 'workspace':
      return { ...base, titleKey: 'newWorkspace', ref: null, message: row.a, severity: 'info' };
  }
}

/** Newest first, capped; an unknown type in a row is dropped rather than shown. */
export function merge(rows: readonly FeedRow[], seen: Date, limit: number): OperatorNotification[] {
  return rows
    .filter((r) => (OPERATOR_NOTIFICATION_TYPES as readonly string[]).includes(r.type))
    .sort((x, y) => y.at.getTime() - x.at.getTime())
    .slice(0, limit)
    .map((r) => toNotification(r, seen));
}

/** The page's free-text filter: title words, order number and detail, case-insensitive (Reference matches title and message). */
export function matchesQuery(
  n: OperatorNotification,
  titles: Record<OperatorNotification['titleKey'], string>,
  q: OperatorNotificationsQuery['q'],
): boolean {
  const needle = q?.trim().toLowerCase();
  if (!needle) return true;
  return `${titles[n.titleKey]} ${n.ref ?? ''} ${n.message ?? ''}`.toLowerCase().includes(needle);
}

export function seenAt(stored: unknown, now: Date): Date {
  const parsed = typeof stored === 'string' ? new Date(stored) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
  return new Date(now.getTime() - FIRST_SEEN_DAYS * 86_400_000);
}
