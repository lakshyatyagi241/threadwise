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
  | 'device_id';

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
