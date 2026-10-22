-- Index audit (Sheet 3 #D-09). Read-only; run with psql against any database:
--   psql "$DATABASE_URL" -At -F' | ' -f tools/perf/index-audit.sql
--
-- Sections 1 (PREFIX) and 2 (DUP) are provable from the catalog alone, so run them anywhere: an index that is a strict left prefix of
-- another btree index on the same table (same opclasses, sort options and WHERE predicate, no INCLUDE columns, not unique, not
-- constraint-backed) serves nothing the longer index cannot, and costs a btree write on every insert, delete and key update.
-- Section 3 (UNUSED) is only meaningful on production after a full week of production-like load; on a dev database every index shows 0.
-- Drop with DROP INDEX CONCURRENTLY, one statement per no-transaction migration (see 20270329090000_drop_idx_contacts_data.sql).
with ix as (
  select i.indexrelid, i.indrelid, c.relname idx, t.relname tbl, i.indisunique uq, i.indisprimary pk,
         string_to_array(i.indkey::text, ' ')::int[] keys, string_to_array(i.indclass::text, ' ')::oid[] cls,
         coalesce(pg_get_expr(i.indpred, i.indrelid), '') pred, coalesce(pg_get_expr(i.indexprs, i.indrelid), '') ex,
         i.indnatts, i.indnkeyatts nk, am.amname am, pg_relation_size(i.indexrelid) sz, i.indoption::text opt,
         exists(select 1 from pg_constraint k where k.conindid = i.indexrelid) is_con
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  join pg_class t on t.oid = i.indrelid
  join pg_am am on am.oid = c.relam
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public' and i.indisvalid and t.relkind in ('r', 'p'))
select '1 PREFIX' kind, a.tbl, a.idx drop_candidate, 'covered by ' || b.idx keep, a.sz
from ix a
join ix b on a.indrelid = b.indrelid and a.indexrelid <> b.indexrelid
 and a.am = 'btree' and b.am = 'btree' and not a.uq and not a.pk and not a.is_con and a.indnatts = a.nk
 and a.ex = '' and b.ex = '' and a.pred = b.pred and a.nk < b.nk and 0 <> all (a.keys[1:a.nk])
 and a.keys[1:a.nk] = b.keys[1:a.nk] and a.cls[1:a.nk] = b.cls[1:a.nk]
 and split_part(a.opt, ' ', 1) = split_part(b.opt, ' ', 1)
union all
select '2 DUP', a.tbl, a.idx, 'identical to ' || b.idx, a.sz
from ix a
join ix b on a.indrelid = b.indrelid and a.indexrelid > b.indexrelid
 and a.keys = b.keys and a.cls = b.cls and a.pred = b.pred and a.ex = b.ex and a.uq = b.uq and a.am = b.am
 and a.nk = b.nk and a.indnatts = b.indnatts and a.opt = b.opt
union all
select '3 UNUSED (idx_scan=0)', s.relname, s.indexrelname, 'since stats reset: ' || coalesce(d.stats_reset::text, 'never'), pg_relation_size(s.indexrelid)
from pg_stat_user_indexes s
join pg_index i on i.indexrelid = s.indexrelid
cross join (select stats_reset from pg_stat_database where datname = current_database()) d
where s.idx_scan = 0 and not i.indisunique and not i.indisprimary
  and not exists (select 1 from pg_constraint k where k.conindid = s.indexrelid)
order by 1, 5 desc, 2, 3;
