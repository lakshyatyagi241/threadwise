import type { BroadcastDetail } from '@crm/contracts';
import { statusLabel } from './list-model';

/** The pure half of the broadcast detail screen (TW-BCAST-030 to 034). */

export const TABS = ['overview', 'recipients', 'failures', 'events'] as const;
export type Tab = (typeof TABS)[number];

export const parseTab = (v: string | null): Tab =>
  (TABS as readonly string[]).includes(v ?? '') ? (v as Tab) : 'overview';

export const RECIPIENT_STATUSES = ['pending', 'sent', 'delivered', 'read', 'failed'] as const;

const zoneOk = (tz: string | null) => {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** A stored instant in the broadcast's own time zone (the reference's `wa_local`), "Oct 2, 14:05:09"; a dash when missing. */
export function formatTime(iso: string | null, tz: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en', {
    timeZone: zoneOk(tz) ? (tz as string) : 'UTC',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(d);
}

/** "Oct 2, 2026 14:05", the created time under the title. */
export function formatCreated(iso: string, tz: string | null): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en', {
    timeZone: zoneOk(tz) ? (tz as string) : 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
}

export type Pill = 'success' | 'warning' | 'neutral' | 'danger';

/** The status pill in the detail header: green when completed, amber while moving or with errors, quiet when scheduled. */
export function pillTone(status: string): Pill {
  switch (status) {
    case 'completed':
      return 'success';
    case 'completed_with_errors':
    case 'processing':
      return 'warning';
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

export type RowTone = 'read' | 'delivered' | 'sent' | 'failed' | 'other';
export const rowTone = (status: string): RowTone =>
  status === 'read' || status === 'delivered' || status === 'sent' || status === 'failed'
    ? status
    : 'other';

/** The wamid cut to 16 characters with an ellipsis, as `Str::limit` did. */
export const limitId = (id: string, n = 16) => (id.length > n ? `${id.slice(0, n)}...` : id);

export interface FunnelRow {
  key: 'audience' | 'sent' | 'delivered' | 'read' | 'failed';
  count: number;
  pct: number;
}

/** Audience, sent, delivered, read, failed with their percentages; the bar is capped at 100. */
export function funnel(d: Pick<BroadcastDetail, 'counts' | 'pct'>): FunnelRow[] {
  return [
    { key: 'audience', count: d.counts.total, pct: 100 },
    { key: 'sent', count: d.counts.sent, pct: d.pct.sent },
    { key: 'delivered', count: d.counts.delivered, pct: d.pct.delivered },
    { key: 'read', count: d.counts.read, pct: d.pct.read },
    { key: 'failed', count: d.counts.failed, pct: d.pct.failed },
  ];
}

export const barWidth = (pct: number) => Math.max(0, Math.min(pct, 100));

export interface EventRow {
  key: 'created' | 'scheduledAt' | 'status' | 'completed';
  value: string;
}

/** The four lifecycle rows: three instants in the broadcast's zone and the status text. */
export function eventRows(e: BroadcastDetail['events'], tz: string | null): EventRow[] {
  return [
    { key: 'created', value: formatTime(e.createdAt, tz) },
    { key: 'scheduledAt', value: formatTime(e.scheduledAt, tz) },
    { key: 'status', value: statusLabel(e.status) || '—' },
    { key: 'completed', value: formatTime(e.completedAt, tz) },
  ];
}

export interface Tiles {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  queued: number;
  pct: { sent: number; delivered: number; read: number; failed: number };
}

const pct1 = (n: number, base: number) => (base > 0 ? Math.round((n / base) * 1000) / 10 : 0);

/** The six header tiles from counts: sent, delivered and failed over the audience, read over delivered. */
export function tiles(c: Omit<Tiles, 'pct'>): Tiles {
  return {
    ...c,
    pct: {
      sent: pct1(c.sent, c.total),
      delivered: pct1(c.delivered, c.total),
      read: pct1(c.read, c.delivered),
      failed: pct1(c.failed, c.total),
    },
  };
}
