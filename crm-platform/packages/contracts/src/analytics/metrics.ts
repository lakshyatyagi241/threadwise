/**
 * Metric ids are stored (smallint in the rollup tables): never renumber. Phase 0 registers three metrics that prove the three rollup shapes
 * (plain counts, a per-entity breakdown, a latency histogram).
 */
export const METRIC = {
  MSG_COUNT: 1,
  MSG_BY_CAMPAIGN: 2,
  CONV_FIRST_REPLY_HIST: 3,
} as const;

export type MetricId = (typeof METRIC)[keyof typeof METRIC];

export interface MetricDef {
  id: MetricId;
  key: string;
  description: string;
  /** What d1, d2, d3 mean for this metric, in order. A histogram metric uses d3 as the bucket index. */
  dims: readonly string[];
  /** Largest window a caller may ask for, in days. */
  windowDaysMax: number;
}

export const METRICS: readonly MetricDef[] = [
  {
    id: METRIC.MSG_COUNT,
    key: 'msg_count',
    description: 'Message transitions by event type, channel kind and source kind',
    dims: ['event_type', 'channel_kind', 'source_kind'],
    windowDaysMax: 366,
  },
  {
    id: METRIC.MSG_BY_CAMPAIGN,
    key: 'msg_by_campaign',
    description: 'Message transitions of campaign and broadcast sends, by campaign',
    dims: ['campaign_id', 'event_type'],
    windowDaysMax: 366,
  },
  {
    id: METRIC.CONV_FIRST_REPLY_HIST,
    key: 'conv_first_reply_hist',
    description: 'First reply time of conversations, by agent, as a latency histogram',
    dims: ['agent_id', '', 'bucket'],
    windowDaysMax: 366,
  },
];
