import { sql } from 'drizzle-orm';

/**
 * The graph a flow RUNS from: the copy kept when it was last published, while it is published; otherwise the draft. A saved edit to a
 * published bot therefore goes live at the next Publish, not at once. `alias` is the table's alias in the query (`f`), or none.
 * Both names are fixed words, never input.
 */
export const liveFlowData = (alias: 'f' | '' = '') => {
  const p = alias ? `${alias}.` : '';
  return sql.raw(
    `CASE WHEN ${p}is_published AND ${p}published_flow_data IS NOT NULL THEN ${p}published_flow_data ELSE ${p}flow_data END`,
  );
};

/** The trigger columns and sender a flow matches and sends on (2029_flows_published_trigger_snapshot.sql). */
export type LiveTriggerColumn =
  | 'trigger_kind'
  | 'trigger_value'
  | 'trigger_keywords'
  | 'trigger_config'
  | 'trigger_device_id'
  | 'trigger_channel_id'
  | 'provider';

/**
 * A trigger column as it is live: the copy kept at Publish while the flow is published; otherwise the draft column the builder saves.
 * So a keyword, channel or schedule typed into the draft changes nothing for customers until the next Publish. Same rule and same
 * `alias` as `liveFlowData`. The column name is a fixed word from `LiveTriggerColumn`, never input.
 */
export const liveTrigger = (column: LiveTriggerColumn, alias: 'f' | '' = '') => {
  const p = alias ? `${alias}.` : '';
  return sql.raw(
    `CASE WHEN ${p}is_published AND ${p}published_flow_data IS NOT NULL THEN ${p}published_${column} ELSE ${p}${column} END`,
  );
};
