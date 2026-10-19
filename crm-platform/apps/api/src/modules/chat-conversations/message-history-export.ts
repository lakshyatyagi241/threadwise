import { sql } from 'drizzle-orm';
import type { MessageHistoryFilters } from '@crm/contracts';
import { csvCell, csvSafe } from './message-log-rules';
import { HISTORY_CSV_HEADER } from './message-history-rules';
import type { HistoryContext, HistorySelection } from './message-history.query';

/**
 * The file of a Message History export. The window and filters were resolved on the day of the request and stored on the export row
 * (`filters`); the worker builds the feed again with them. An export is the capability `inbox.logs.export` of a caller who reads every
 * conversation (the request refuses anyone else), so the file has every row and the full numbers, like the delivery log export does.
 */

export interface StoredHistoryFilters extends Omit<MessageHistoryFilters, 'range' | 'from' | 'to'> {
  window: { from: string; to: string };
}

export const HISTORY_CSV_HEAD = `${HISTORY_CSV_HEADER.map((h) => csvCell(h)).join(',')}\r\n`;

/** The selection a stored export means. Throws on a window that is not two instants: a row written by something else. */
export function selectionOfStored(f: Record<string, unknown> | null): HistorySelection {
  const w = (f as { window?: { from?: unknown; to?: unknown } } | null)?.window;
  const from = typeof w?.from === 'string' ? new Date(w.from) : null;
  const to = typeof w?.to === 'string' ? new Date(w.to) : null;
  if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error('message history export has no window');
  }
  const s = f as unknown as StoredHistoryFilters;
  return {
    window: { from, to },
    scoping: {
      ...(s.channelId ? { channelId: s.channelId } : {}),
      ...(s.templateId ? { templateId: s.templateId } : {}),
      ...(s.campaignId ? { campaignId: s.campaignId } : {}),
      ...(s.broadcastId ? { broadcastId: s.broadcastId } : {}),
      ...(s.scheduledId ? { scheduledId: s.scheduledId } : {}),
    },
    narrow: {
      ...(s.dir ? { dir: s.dir } : {}),
      ...(s.type ? { type: s.type } : {}),
      ...(s.source ? { source: s.source } : {}),
      ...(s.status ? { status: s.status } : {}),
      ...(s.q ? { q: s.q } : {}),
    },
  };
}

/** What the worker sees: every conversation, every recipient row, every contact; charges are not in the file. */
export const exportContext = (orgId: number): HistoryContext => ({
  orgId,
  conversationJoins: sql``,
  conversationVisible: sql`TRUE`,
  bulk: true,
  contacts: { scope: 'all', userId: 0, teamIds: [] },
  cost: false,
});

/** One line of the file, from a raw row of the feed. A cell a spreadsheet would run as a formula is prefixed (Reference did the same). */
export function historyCsvLine(r: Record<string, unknown>): string {
  const s = (v: unknown): string => (typeof v === 'string' ? v : '');
  const phone = s(r.phone);
  return [
    `${r.entity_kind === 'message' ? 'm' : String(r.entity_kind)[0]}:${s(r.uid)}`,
    s(r.source),
    new Date(s(r.at_text)).toISOString(),
    s(r.direction),
    csvSafe(phone),
    csvSafe(s(r.contact_name)),
    s(r.status),
    s(r.type),
    csvSafe(s(r.body)),
    csvSafe(s(r.channel_name)),
    csvSafe(s(r.template_name)),
    csvSafe(s(r.entity_name)),
    csvSafe(s(r.fail_code)),
    csvSafe(s(r.fail_reason)),
  ]
    .map(csvCell)
    .join(',');
}
