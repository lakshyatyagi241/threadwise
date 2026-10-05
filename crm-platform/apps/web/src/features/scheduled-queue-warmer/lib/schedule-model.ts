import type { ScheduleStatus, ScheduleSummary, ScheduleTab } from '@crm/contracts';

/** The pure half of the scheduled-message list and detail screens (WD-SCHED-001, 002, 013): tabs, labels, actions, totals. */

export const TABS: readonly ScheduleTab[] = [
  'all',
  'upcoming',
  'running',
  'paused',
  'completed',
  'failed',
];
export const PAGE_SIZE = 25;
/** Schedules move through queued, running and done on the worker, so the list follows along. */
export const POLL_MS = 15_000;

export interface ListState {
  tab: ScheduleTab;
  q: string;
  /** 1-based. */
  page: number;
}

export function parseState(search: URLSearchParams): ListState {
  const tab = search.get('tab') as ScheduleTab | null;
  const page = Number(search.get('page'));
  return {
    tab: tab && TABS.includes(tab) ? tab : 'all',
    q: search.get('q')?.trim() ?? '',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** Only what differs from the default goes into the address. */
export function stateToSearch(s: ListState): string {
  const p = new URLSearchParams();
  if (s.tab !== 'all') p.set('tab', s.tab);
  if (s.q) p.set('q', s.q);
  if (s.page > 1) p.set('page', String(s.page));
  const out = p.toString();
  return out ? `?${out}` : '';
}

export const totalPages = (total: number, size = PAGE_SIZE) => Math.max(1, Math.ceil(total / size));

export type Tone = 'success' | 'warning' | 'danger' | 'neutral';

/** The status pill's tone: queued is green, paused amber, failed red, the rest quiet (the reference's pills). */
export const statusTone = (s: ScheduleStatus): Tone =>
  s === 'scheduled'
    ? 'success'
    : s === 'paused'
      ? 'warning'
      : s === 'failed'
        ? 'danger'
        : 'neutral';

export interface Actions {
  pause: boolean;
  resume: boolean;
  runNow: boolean;
  cancel: boolean;
  retry: boolean;
  /** Offered on every status: while actionable it removes the schedule, afterwards it clears history. */
  delete: boolean;
}

export function availableActions(status: ScheduleStatus): Actions {
  const live = status === 'scheduled' || status === 'running' || status === 'paused';
  return {
    pause: status === 'scheduled' || status === 'running',
    resume: status === 'paused',
    runNow: live,
    cancel: live,
    retry: status === 'failed',
    delete: true,
  };
}

export const isFinished = (s: ScheduleStatus) =>
  s === 'completed' || s === 'cancelled' || s === 'failed';

export interface When {
  key: 'overdue' | 'now' | 'minutes' | 'hours' | 'tomorrow' | 'date';
  n?: number;
}

/** "in 12m", "in 3h", "tomorrow" or a date, as the "up next" strip and the send time column word it. */
export function relativeWhen(targetMs: number, nowMs: number): When {
  const diff = Math.round((targetMs - nowMs) / 60_000);
  if (diff < 0) return { key: 'overdue' };
  if (diff < 1) return { key: 'now' };
  if (diff < 60) return { key: 'minutes', n: diff };
  if (diff < 60 * 24) return { key: 'hours', n: Math.round(diff / 60) };
  if (diff < 60 * 48) return { key: 'tomorrow' };
  return { key: 'date' };
}

/** The next time a schedule fires, falling back to when it was first set for. */
export const nextWhen = (s: ScheduleSummary) => s.nextRunAt ?? s.scheduledAt;

export interface Totals {
  totalSent: number;
  /** Percent of what completed schedules sent that was delivered, one decimal. */
  deliveryRate: number;
}

/** The strip's "Total sent" and "Delivery rate" over the schedules in hand (the list endpoint carries no workspace totals). */
export function totalsOf(items: ScheduleSummary[]): Totals {
  const totalSent = items.reduce((n, s) => n + s.totalSent, 0);
  const done = items.filter((s) => s.status === 'completed');
  const sent = done.reduce((n, s) => n + s.totalSent, 0);
  const delivered = done.reduce((n, s) => n + s.totalDelivered, 0);
  return { totalSent, deliveryRate: sent > 0 ? Math.round((delivered / sent) * 1000) / 10 : 0 };
}

export const RECIPIENT_TABS = ['all', 'sent', 'delivered', 'read', 'failed', 'pending'] as const;
export type RecipientTab = (typeof RECIPIENT_TABS)[number];

/** Which recipient statuses a tab shows: "sent" includes delivered and read, "delivered" includes read (as the KPI strip counts). */
export function recipientTabMatches(tab: RecipientTab, status: string): boolean {
  switch (tab) {
    case 'all':
      return true;
    case 'sent':
      return status === 'sent' || status === 'delivered' || status === 'read';
    case 'delivered':
      return status === 'delivered' || status === 'read';
    case 'read':
      return status === 'read';
    case 'failed':
      return status === 'failed';
    case 'pending':
      return status === 'pending' || status === 'processing';
  }
}

export interface Funnel {
  all: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  pending: number;
  deliveryRate: number;
  readRate: number;
  failRate: number;
  progressPct: number;
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

/** The detail page's counters from the recipient status breakdown, with the reference's rates. */
export function funnelOf(breakdown: Record<string, number>, totalRecipients: number): Funnel {
  const n = (k: string) => breakdown[k] ?? 0;
  const read = n('read');
  const delivered = n('delivered') + read;
  const sent = n('sent') + delivered;
  const failed = n('failed');
  const pending = n('pending') + n('processing');
  const all = totalRecipients || sent + failed + pending;
  return {
    all,
    sent,
    delivered,
    read,
    failed,
    pending,
    deliveryRate: pct(delivered, sent),
    readRate: pct(read, sent),
    failRate: pct(failed, all),
    progressPct: Math.min(100, pct(sent, all)),
  };
}

/** The recipient's number as the server returns it (already masked), with a leading plus. */
export const phoneText = (p: string) => (p.startsWith('+') ? p : `+${p}`);
