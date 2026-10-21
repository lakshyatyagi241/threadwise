-- Prototype behind docs/superpowers/specs/2026-10-19-message-count-rollup-design.md: events from messages, the hourly and daily rollups, and
-- the reads compared with the live scan. Run on a throw-away database filled by tools/perf/seed.sql (1M messages, org 1), migrations applied:
--   psql "$MIGRATION_DATABASE_URL" -f tools/perf/message-rollup-prototype.sql
-- It writes to an_events, an_rollup_hour and an_rollup_day (metric 11 is a placeholder id) and never touches messages. Run it once per database (a second
-- run hits the rollup primary keys). Not a migration.
\timing on
SET work_mem = '64MB';

-- 1. Events from the messages as they stand (out: queued, sent, delivered; in: received). A real backfill reads message_events for the
--    true transitions; this is enough to size the tables and to prove the read side.
INSERT INTO an_events (org_id, type, recorded_at, occurred_at, direction, status, channel_id, conversation_id, qty)
SELECT m.org_id, t.type, m.created_at + t.lag, m.created_at + t.lag, CASE WHEN m.direction = 'in' THEN 2 ELSE 1 END, t.type, c.channel_id, m.conversation_id, 1
FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
CROSS JOIN LATERAL (VALUES (1, interval '0'), (2, interval '2 seconds'), (3, interval '5 seconds')) AS t(type, lag)
WHERE m.direction = 'out' AND m.org_id = 1
UNION ALL
SELECT m.org_id, 6, m.created_at, m.created_at, 2, 6, c.channel_id, m.conversation_id, 1
FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id WHERE m.direction = 'in' AND m.org_id = 1;
ANALYZE an_events;

-- 2. The rollups, dims = (type, channel_id, source_kind); buckets in UTC here (the real worker buckets in the workspace timezone).
INSERT INTO an_rollup_hour (org_id, metric, bucket, d1, d2, d3, n)
SELECT e.org_id, 11, date_trunc('hour', e.occurred_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', e.type::bigint, coalesce(e.channel_id, 0), coalesce(e.source_kind, 0)::bigint, count(*)
FROM an_events e WHERE e.type IN (1, 2, 3, 4, 5, 6) GROUP BY 1, 2, 3, 4, 5, 6;
INSERT INTO an_rollup_day (org_id, metric, bucket, d1, d2, d3, n)
SELECT e.org_id, 11, (date_trunc('day', e.occurred_at AT TIME ZONE 'UTC'))::date, e.type::bigint, coalesce(e.channel_id, 0), coalesce(e.source_kind, 0)::bigint, count(*)
FROM an_events e WHERE e.type IN (1, 2, 3, 4, 5, 6) GROUP BY 1, 2, 3, 4, 5, 6;
ANALYZE an_rollup_hour; ANALYZE an_rollup_day;
SELECT (SELECT count(*) FROM an_rollup_hour WHERE metric = 11) AS hour_rows, (SELECT count(*) FROM an_rollup_day WHERE metric = 11) AS day_rows;

-- 3. Reads, as the app role, in a UTC session (the bucket boundaries and the read must use the same zone: see the design, section 6).
BEGIN;
SET LOCAL TIME ZONE 'UTC'; SET LOCAL ROLE crm_app_user; SELECT set_config('app.org_id', '1', true);
-- live: the cards over a 30-day window with arbitrary minutes
SELECT count(*) FILTER (WHERE direction = 'out') AS out_n, count(*) FILTER (WHERE direction = 'in') AS in_n, count(*) FILTER (WHERE status = 'delivered') AS delivered
FROM messages WHERE org_id = 1 AND created_at >= now() - interval '30 days' AND created_at < now() - interval '1 minute' AND kind NOT IN ('system', 'reaction') AND deleted_at IS NULL;
-- rollup: the full hours from the hour table, the two partial hours from the events, stitched
WITH full_hours AS (
  SELECT d1, sum(n) AS n FROM an_rollup_hour
  WHERE org_id = 1 AND metric = 11
    AND bucket >= date_trunc('hour', now() - interval '30 days') + interval '1 hour' AND bucket < date_trunc('hour', now() - interval '1 minute') GROUP BY d1),
edges AS (
  SELECT type::bigint AS d1, count(*) AS n FROM an_events
  WHERE org_id = 1 AND type IN (1, 2, 3, 4, 5, 6)
    AND ((occurred_at >= now() - interval '30 days' AND occurred_at < date_trunc('hour', now() - interval '30 days') + interval '1 hour')
      OR (occurred_at >= date_trunc('hour', now() - interval '1 minute') AND occurred_at < now() - interval '1 minute')) GROUP BY 1),
u AS (SELECT * FROM full_hours UNION ALL SELECT * FROM edges)
SELECT sum(n) FILTER (WHERE d1 = 1) AS out_n, sum(n) FILTER (WHERE d1 = 6) AS in_n, sum(n) FILTER (WHERE d1 = 3) AS delivered FROM u;
-- the all-time total of a workspace (the More hub's message history): live count against the day rollup
SELECT count(*) FROM messages WHERE org_id = 1;
SELECT sum(n) FROM an_rollup_day WHERE org_id = 1 AND metric = 11 AND d1 IN (1, 6);
ROLLBACK;
