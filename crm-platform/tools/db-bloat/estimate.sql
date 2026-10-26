-- Sheet 3 D-08: table bloat of the message tables on a LIVE database. Read-only (catalog and statistics views only); safe on the primary
-- or a replica. Run: psql "$READONLY_URL" -f tools/db-bloat/estimate.sql
-- Change the pattern to look at other tables:  psql ... -v tables='^(messages|message_events)' -f tools/db-bloat/estimate.sql
--
-- Per leaf partition (a partitioned parent has no storage of its own):
--   dead_pct       dead tuples as a share of all tuples (pg_stat_user_tables): what autovacuum has not cleaned yet.
--   est_bloat_pct  heap pages the live rows would need, from the planner's own width statistics (pg_stats.avg_width) and the fill factor,
--                  against the pages the table actually has. An ESTIMATE: it is only as good as the last ANALYZE, and it reads high for tables
--                  with wide, TOASTed columns. For an exact number on one table use pgstattuple_approx (see the runbook).
-- Indexes are not in this report (their bloat needs pgstattuple or a rebuild to measure; see docs/performance/db/message-bloat-and-archival.md).
\if :{?tables} \else \set tables '^(messages|message_events|conversation_events|conversations|message_ledger)(_[0-9]{6}|_default)?$' \endif

with width as (
  -- average stored width of one row from the column statistics, per table
  select s.schemaname, s.tablename, sum(s.avg_width)::numeric as cols_bytes, count(*) as cols
  from pg_stats s group by 1, 2
), t as (
  select c.oid, n.nspname as schema, c.relname as tbl, c.relpages, c.reltuples,
         coalesce((select substring(o from 'fillfactor=([0-9]+)')::int from unnest(c.reloptions) o where o like 'fillfactor=%'), 100) as fillfactor,
         c.reloptions
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and n.nspname = 'public' and c.relname ~ :'tables'
)
select t.tbl as "table",
       pg_size_pretty(pg_table_size(t.oid)) as heap_and_toast,
       u.n_live_tup as live_rows,
       u.n_dead_tup as dead_rows,
       round(100.0 * u.n_dead_tup / nullif(u.n_live_tup + u.n_dead_tup, 0), 1) as dead_pct,
       round(100.0 * greatest(0, t.relpages - ceil(t.reltuples * (w.cols_bytes + 28) / (8192 * 0.96 * t.fillfactor / 100.0))) / nullif(t.relpages, 0), 1) as est_bloat_pct,
       to_char(u.last_autovacuum, 'YYYY-MM-DD HH24:MI') as last_autovacuum,
       u.autovacuum_count as autovacuums,
       coalesce(array_to_string(t.reloptions, ' '), '') as table_options
from t
left join pg_stat_user_tables u on u.relid = t.oid
left join width w on w.schemaname = t.schema and w.tablename = t.tbl
where t.relpages > 0
order by pg_table_size(t.oid) desc
limit 40;

-- Is the exact tool available? (needs the pgstattuple extension; `create extension pgstattuple` as a superuser)
select case when exists (select 1 from pg_extension where extname = 'pgstattuple')
            then 'pgstattuple is installed: select * from pgstattuple_approx(''public.messages_202610''::regclass);'
            else 'pgstattuple is not installed: the numbers above are estimates.' end as exact_measurement;
