-- Sheet 3 D-08: how much does the message table bloat under its real update pattern, and what changes it?
-- Run on a THROWAWAY database that has all migrations applied (never on a live one; it creates and removes tables of its own):
--   psql -v rows=200000 -d <scratch> -f tools/db-bloat/bench.sql
-- messages is written once and then, for outgoing rows (40 %), updated three times (queued -> sent -> delivered -> read). status is in the
-- predicate of the partial index idx_messages_queued, so those updates cannot be HOT: each writes a new row version AND a new entry into every
-- index (12 on messages, one of them a trigram GIN on body). Three copies of the table take the same updates:
--   bench_default  vacuumed the way the server default would (after 20 % of the rows changed)
--   bench_tuned    vacuumed after 2 % changed (autovacuum_vacuum_scale_factor 0.02)
--   bench_hot      the same 2 %, but without idx_messages_queued and with fillfactor 85, so the updates can be HOT
-- Autovacuum is switched off on the copies and the script runs VACUUM itself at the point autovacuum's rule (50 + scale x rows dead rows)
-- would fire, so the three are compared on the same rule, not on a race with the background worker.
\set ON_ERROR_STOP on
\if :{?rows} \else \set rows 200000 \endif
create extension if not exists pgstattuple;
drop table if exists bench_default, bench_tuned, bench_hot;
create table bench_default (like messages including all);
create table bench_tuned (like messages including all);
create table bench_hot (like messages including all);
alter table bench_default set (autovacuum_enabled = false);
alter table bench_tuned set (autovacuum_enabled = false);
alter table bench_hot set (autovacuum_enabled = false, fillfactor = 85);
select format('drop index %I', indexname) from pg_indexes where tablename = 'bench_hot' and indexdef like '%''queued''%' \gexec

insert into bench_default (org_id, conversation_id, seq, direction, sender_kind, body, status, meta, created_at)
select 1 + (g % 20), 1 + (g % 4000), g, case when g % 5 < 3 then 'in' else 'out' end, case when g % 5 < 3 then 'customer' else 'agent' end,
       repeat(md5(g::text), 3), case when g % 5 < 3 then 'received' else 'queued' end, '{}'::jsonb, now() - (g % 30) * interval '1 hour'
from generate_series(1, :rows) g;
insert into bench_tuned select * from bench_default;
insert into bench_hot select * from bench_default;
vacuum analyze bench_default, bench_tuned, bench_hot;
select pg_stat_reset_single_table_counters(c) from (values ('bench_default'::regclass), ('bench_tuned'), ('bench_hot')) v(c);

-- 3 steps x 20 chunks of conversations. A chunk leaves about rows/50 dead versions behind; a vacuum runs after every k-th chunk, k being
-- how many chunks it takes to pass the threshold.
create temp table plan as
with v(name, tbl, scale) as (values ('default', 'bench_default', 0.20), ('tuned', 'bench_tuned', 0.02), ('hot', 'bench_hot', 0.02)),
     s(step, from_s, to_s, col) as (values (1, 'queued', 'sent', 'sent_at'), (2, 'sent', 'delivered', 'delivered_at'), (3, 'delivered', 'read', 'read_at')),
     c(chunk) as (select generate_series(0, 19)),
     n as (select v.name, v.tbl, s.*, c.chunk, (s.step - 1) * 20 + c.chunk + 1 as nth,
                  ceil((50 + v.scale * :rows) / (:rows / 50.0))::int as k from v, s, c)
select name, nth, 1 as part,
       format($u$update %s set status = %L, %I = now(), provider_message_id = coalesce(provider_message_id, md5(id::text))
                 where direction = 'out' and status = %L and conversation_id between %s and %s$u$,
              tbl, to_s, col, from_s, chunk * 200 + 1, (chunk + 1) * 200) as stmt from n
union all
select name, nth, 2, format('vacuum %s', tbl) from n where nth % k = 0;
select stmt from plan order by name, nth, part \gexec
select name, count(*) filter (where part = 2) as vacuums into temp table plan_vacuums from plan group by name;

\echo
\echo '== tables: bloat = free space + dead tuples as a share of the table (pgstattuple)'
select v.variant, pg_size_pretty(pg_table_size(v.t)) as table_size, pg_size_pretty(pg_indexes_size(v.t)) as indexes_size,
       round(100.0 * u.n_tup_hot_upd / nullif(u.n_tup_upd, 0), 1) as hot_update_pct,
       (select vacuums from plan_vacuums p where p.name = v.variant) as vacuums,
       round((s.free_percent + s.dead_tuple_percent)::numeric, 1) as table_bloat_pct
from (values ('default', 'bench_default'::regclass), ('tuned', 'bench_tuned'), ('hot', 'bench_hot')) v(variant, t)
join pg_stat_user_tables u on u.relid = v.t, lateral pgstattuple(v.t) s order by 1;

-- an index's bloat = its size now against the size of the same index rebuilt
create temp table bench_idx as
  select v.variant, i.indexrelid::regclass::text as idx, pg_relation_size(i.indexrelid) as now_bytes
  from (values ('default', 'bench_default'::regclass), ('tuned', 'bench_tuned'), ('hot', 'bench_hot')) v(variant, t) join pg_index i on i.indrelid = v.t;
reindex table bench_default; reindex table bench_tuned; reindex table bench_hot;
\echo '== indexes over 1 MB'
select b.variant, regexp_replace(b.idx, '^bench_[a-z]+_', '') as idx, pg_size_pretty(b.now_bytes) as before, pg_size_pretty(pg_relation_size(b.idx::regclass)) as rebuilt,
       round(100.0 * (b.now_bytes - pg_relation_size(b.idx::regclass)) / nullif(b.now_bytes, 0), 1) as bloat_pct
from bench_idx b where b.now_bytes > 1048576 order by b.variant, b.now_bytes desc;
\echo '== all indexes together'
select variant, pg_size_pretty(sum(now_bytes)::bigint) as before, pg_size_pretty(sum(pg_relation_size(idx::regclass))::bigint) as rebuilt,
       round(100.0 * (sum(now_bytes) - sum(pg_relation_size(idx::regclass))) / sum(now_bytes), 1) as bloat_pct
from bench_idx group by variant order by variant;
drop table bench_default, bench_tuned, bench_hot;
