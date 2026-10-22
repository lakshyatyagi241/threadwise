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
