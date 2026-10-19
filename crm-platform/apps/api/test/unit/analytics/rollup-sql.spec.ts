import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { METRIC } from '@crm/contracts';
import { ROLLUP_RULES, type RollupRule } from '../../../src/modules/analytics/rollup/rollup-rules';
import {
  recordedWindow,
  rollupSelect,
  rollupUpsert,
} from '../../../src/modules/analytics/rollup/rollup-sql';

const dialect = new PgDialect();
const render = (q: ReturnType<typeof sql>) => dialect.sqlToQuery(q);
const rule = (metric: number) => ROLLUP_RULES.find((r) => r.metric === metric)!;
const window = recordedWindow(new Date('2026-10-16T00:00:00Z'), new Date('2026-10-16T00:10:00Z'));

describe('rollup rules', () => {
  it('has one rule per registered metric and no histogram rule that also uses d3', () => {
    expect(new Set(ROLLUP_RULES.map((r) => r.metric)).size).toBe(ROLLUP_RULES.length);
    for (const r of ROLLUP_RULES) if (r.histOn) expect(r.dims[2]).toBeNull();
  });
});

describe('the message feed rule', () => {
  it('rolls the state events up by status, channel and the packed feed class, entering and leaving', () => {
    const { sql: text } = render(rollupSelect(rule(METRIC.MSG_FEED), 'hour', 'org', window));
    // two halves: the state entered (d1 = status, n = +qty) and the state left (d1 = k2, n = -qty, only where k2 is set)
    expect(text.match(/from an_events e/gi)).toHaveLength(2);
    expect(text).toMatch(/e\.type in \(7\)/i);
    expect(text).toMatch(/coalesce\(e\.status, 0\)::bigint as d1/i);
    expect(text).toMatch(/coalesce\(e\.k2, 0\)::bigint as d1/i);
    expect(text).toMatch(/e\.k2 IS NOT NULL/);
    expect(text).toMatch(/-coalesce\(sum\(e\.qty\), 0\)::bigint as n/i);
    expect(text).toMatch(/coalesce\(sum\(e\.qty\), 0\)::bigint as n/i);
    expect(text).toMatch(/union all/i);
    expect(text).toMatch(/coalesce\(e\.channel_id, 0\)::bigint as d2/i);
    expect(text).toMatch(
      /\(coalesce\(e\.source_kind, 0\) \* 16 \+ coalesce\(e\.k1, 0\)\)::bigint as d3/i,
    );
    expect(text).toMatch(/e\.occurred_at >= an_msg_feed_cutover\(\)/);
  });

  it('refuses a paired rule that cannot be signed', () => {
    const bad: RollupRule = { ...rule(METRIC.MSG_FEED), n: 'count' };
    expect(() => rollupSelect(bad, 'hour', 'org', window)).toThrow(/paired rule needs/);
    const badDim: RollupRule = {
      ...rule(METRIC.MSG_FEED),
      dims: ['direction', 'channel_id', 'feed_class'],
    };
    expect(() => rollupSelect(badDim, 'hour', 'org', window)).toThrow(/paired rule needs/);
  });

  it('rolls first replies up by channel with the reply time as the sum', () => {
    const { sql: text } = render(
      rollupSelect(rule(METRIC.CONV_REPLY_BY_CHANNEL), 'day', 'org', window),
    );
    expect(text).toMatch(/e\.type in \(42\)/i);
    expect(text).toMatch(/coalesce\(e\.channel_id, 0\)::bigint as d1/i);
    expect(text).toMatch(/coalesce\(sum\(e\.duration_ms\), 0\)::bigint as s1/i);
  });
});

describe('rollupSelect', () => {
  it('groups org rows by the workspace timezone and lists the event types', () => {
    const { sql: text } = render(rollupSelect(rule(METRIC.MSG_COUNT), 'hour', 'org', window));
    expect(text).toMatch(/from an_events e/i);
    expect(text).toMatch(/left join workspace_settings ws on ws\.org_id = e\.org_id/i);
    expect(text).toMatch(/left join pg_timezone_names tz on tz\.name = ws\.timezone/i);
    expect(text).toMatch(/date_trunc\('hour', e\.occurred_at AT TIME ZONE coalesce\(tz\.name/i);
    expect(text).toMatch(/e\.type in \(1, 2, 3, 4, 5, 6\)/i);
    expect(text).toMatch(/e\.org_id as org_id/i);
  });

  it('writes platform rows in UTC with org_id 0 and no timezone join', () => {
    const { sql: text } = render(rollupSelect(rule(METRIC.MSG_COUNT), 'day', 'platform', window));
    expect(text).toMatch(/0::bigint as org_id/i);
    expect(text).not.toMatch(/workspace_settings/i);
    expect(text).toMatch(/AT TIME ZONE 'UTC'/);
    expect(text).toMatch(/::date/);
  });

  it('turns a histogram metric into d3 bucket indexes, one WHEN per latency edge', () => {
    const { sql: text } = render(
      rollupSelect(rule(METRIC.CONV_FIRST_REPLY_HIST), 'day', 'org', window),
    );
    expect(text.match(/WHEN e\.duration_ms < /g)).toHaveLength(14);
    expect(text).toMatch(/e\.type in \(42\)/i);
  });

  it('adds the rule predicate and keeps the window as bound parameters', () => {
    const q = render(rollupSelect(rule(METRIC.MSG_BY_CAMPAIGN), 'hour', 'org', window));
    expect(q.sql).toMatch(/e\.campaign_id IS NOT NULL/);
    expect(q.params).toEqual(['2026-10-16T00:00:00.000Z', '2026-10-16T00:10:00.000Z']);
  });

  it('refuses a rule whose metric id is not an integer', () => {
    const bad = { ...rule(METRIC.MSG_COUNT), metric: 1.5 } as unknown as RollupRule;
    expect(() => rollupSelect(bad, 'hour', 'org', window)).toThrow(/not an integer/);
  });
});

describe('rollupUpsert', () => {
  it('adds the slice to the existing row instead of replacing it', () => {
    const { sql: text } = render(rollupUpsert(rule(METRIC.MSG_COUNT), 'day', 'org', window));
    expect(text).toMatch(
      /insert into an_rollup_day \(org_id, metric, bucket, d1, d2, d3, n, s1, s2\)/i,
    );
    expect(text).toMatch(/on conflict \(org_id, metric, bucket, d1, d2, d3\) do update/i);
    expect(text).toMatch(/n = an_rollup_day\.n \+ excluded\.n/i);
    expect(text).toMatch(/s1 = an_rollup_day\.s1 \+ excluded\.s1/i);
  });
});
