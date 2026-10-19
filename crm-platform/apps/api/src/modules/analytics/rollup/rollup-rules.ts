import { ANALYTICS_EVENT as E, METRIC, type MetricId } from '@crm/contracts';

/** Columns of an_events that can feed a rollup dimension. */
export type DimCol =
  | 'type'
  | 'channel_kind'
  | 'direction'
  | 'status'
  | 'source_kind'
  | 'k1'
  | 'k2'
  | 'channel_id'
  | 'contact_id'
  | 'conversation_id'
  | 'campaign_id'
  | 'flow_id'
  | 'agent_id'
  | 'template_id'
  | 'device_id'
  /** Not a column: `source_kind * 16 + k1`, the packed third dimension of MSG_FEED (see `packFeedClass` in contracts). */
  | 'feed_class';

export type MeasureCol = 'amount_minor' | 'duration_ms' | 'tokens';

/**
 * How events become one metric's rollup rows. Everything here is a constant in code; the SQL builders only ever interpolate these values,
 * never anything a caller supplies.
 */
export interface RollupRule {
  metric: MetricId;
  types: readonly number[];
  /** Event columns that feed d1, d2, d3 (null leaves the dimension 0). */
  dims: readonly [DimCol | null, DimCol | null, DimCol | null];
  /** n = number of events, or the sum of their qty. */
  n: 'count' | 'qty';
  s1?: MeasureCol;
  s2?: MeasureCol;
  /** Histogram metric: d3 becomes the latency bucket index of this column (dims[2] must be null). */
  histOn?: 'duration_ms';
  /** Extra constant predicate on the event alias `e`, for example 'e.campaign_id IS NOT NULL'. */
  where?: string;
  /** Also write org_id = 0 platform rows (UTC buckets, across all workspaces). */
  platform?: boolean;
  /**
   * A state-change event: it also LEAVES a state. The event column named here holds the state it left (null at creation), and the rule adds a
   * second row with that state as d1 and a negative n, so a bucket always holds how many things are in each state now. Needs `n: 'qty'` and
   * dims[0] to be the column of the state entered.
   */
  paired?: DimCol;
}

const MSG = [
  E.MSG_QUEUED,
  E.MSG_SENT,
  E.MSG_DELIVERED,
  E.MSG_READ,
  E.MSG_FAILED,
  E.MSG_RECEIVED,
] as const;

export const ROLLUP_RULES: readonly RollupRule[] = [
  {
    metric: METRIC.MSG_COUNT,
    types: MSG,
    dims: ['type', 'channel_kind', 'source_kind'],
    n: 'count',
    platform: true,
  },
  {
    metric: METRIC.MSG_BY_CAMPAIGN,
    types: MSG,
    dims: ['campaign_id', 'type', null],
    n: 'count',
    where: 'e.campaign_id IS NOT NULL',
  },
  {
    // The Message History's numbers (cards, volume, type mix): how many messages created in each bucket are in each status now, by channel
    // and by the packed source and kind class (the "type" and "source" filters). Events are MSG_STATE, stamped with the message's creation
    // time; a status change is one event that enters the new status and (paired) leaves the old one. Messages created before the
    // cut-over are in MSG_FEED_BASE. Design: docs/superpowers/specs/2026-10-19-message-count-rollup-design.md.
    metric: METRIC.MSG_FEED,
    types: [E.MSG_STATE],
    dims: ['status', 'channel_id', 'feed_class'],
    n: 'qty',
    paired: 'k2',
    where: 'e.occurred_at >= an_msg_feed_cutover()',
  },
  {
    // First replies by channel: n = replies, s1 = their reply time in ms. The average first-response time is s1 / n (decision D9: replies
    // that happened in the window).
    metric: METRIC.CONV_REPLY_BY_CHANNEL,
    types: [E.CONV_FIRST_REPLY],
    dims: ['channel_id', null, null],
    n: 'count',
    s1: 'duration_ms',
  },
  {
    metric: METRIC.CONV_FIRST_REPLY_HIST,
    types: [E.CONV_FIRST_REPLY],
    dims: ['agent_id', null, null],
    n: 'count',
    s1: 'duration_ms',
    histOn: 'duration_ms',
  },
];

export const RULE_BY_METRIC: ReadonlyMap<MetricId, RollupRule> = new Map(
  ROLLUP_RULES.map((r) => [r.metric, r]),
);
