import { sql } from 'drizzle-orm';
import { MESSAGE_STATUS_CODE } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { channelRowOwnerSql } from '../../realtime';
import { type FeedRollup, type HistoryContext, type HistorySelection } from '../chat-conversations';
import type { MessageFeedService } from '../analytics';

/** The key of `ANALYTICS_SOURCES` that moves the History's message counts: legacy (scan), shadow (scan, compared with the rollup), rollup. */
export const HISTORY_METRIC_KEY = 'msg_feed';

/** The channels a viewer may not see: another person's personal mailbox, unless the workspace lets admins read them (`channelVisibleTo`). */
export async function hiddenChannelIds(
  tx: Tx,
  orgId: number,
  viewer: { userId: number; readsPersonalMail?: boolean },
): Promise<number[]> {
  if (viewer.readsPersonalMail === true) return [];
  const res = await tx.execute(sql`
    SELECT ch.id FROM channels ch
     WHERE ch.org_id = ${orgId} AND ${channelRowOwnerSql('ch')} IS NOT NULL AND ${channelRowOwnerSql('ch')} <> ${viewer.userId}`);
  return (res.rows as Array<{ id: string | number }>).map((r) => Number(r.id));
}

/**
 * Whether the rollup can answer this request exactly: the viewer sees every conversation (the rollup has no per-conversation scope), no
 * filter picks a channel, template, campaign, broadcast or scheduled send, there is no text search, and (for the charts, which bucket) the
 * request's zone is the workspace's.
 */
export function rollupApplies(
  hc: HistoryContext,
  sel: HistorySelection,
  zone: { requested?: string; workspace: string },
): boolean {
  return (
    hc.bulk &&
    hc.hiddenChannelIds !== undefined &&
    Object.keys(sel.scoping).length === 0 &&
    !sel.narrow.q &&
    (zone.requested === undefined || zone.requested === zone.workspace)
  );
}

/** The History's message counts read from the rollups, hiding the channels the viewer may not see. */
export function feedRollup(
  tx: Tx,
  feed: MessageFeedService,
  hc: HistoryContext,
  sel: HistorySelection,
  tz: string,
): FeedRollup {
  const hidden = hc.hiddenChannelIds ?? [];
  const w = (window: { from: Date; to: Date }) => ({ orgId: hc.orgId, ...window, tz });
  const c = MESSAGE_STATUS_CODE;
  return {
    counts: async (window) => {
      const by = (await feed.counts(tx, w(window), { hiddenChannelIds: hidden })).byStatus;
      const at = (s: number) => by.get(s) ?? 0;
      const out = {
        queued: at(c.queued),
        sentStatus: at(c.sent),
        delivered: at(c.delivered),
        read: at(c.read),
        failed: at(c.failed),
        received: at(c.received),
      };
      return { ...out, total: Object.values(out).reduce((a, b) => a + b, 0) };
    },
    avgFirstReplySeconds: (window) => feed.averageFirstReplySeconds(tx, w(window), { hidden }),
    volume: (unit, seriesFrom) =>
      feed.volume(tx, w({ from: seriesFrom, to: sel.window.to }), unit, {
        hiddenChannelIds: hidden,
      }),
    typeMix: async () =>
      [...(await feed.byType(tx, w(sel.window), { hiddenChannelIds: hidden }))].map(
        ([type, n]) => ({ type, n }),
      ),
  };
}
