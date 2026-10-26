# Message table bloat and archival (Sheet 3 D-08)

Target from the sheet: bloat under 20 % on the message tables; archival windows approved.

## Where things stand

| Question                    | Answer                                                                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Why does `messages` bloat?  | An outgoing message is updated up to three times (queued, sent, delivered, read). `status` is in the predicate of `idx_messages_queued`, so no update can be HOT: every update leaves a dead row and a dead entry in all 12 indexes. |
| Is the table under 20 %?    | With the server default there is no margin: 19.7 % in the bench, at the edge before autovacuum even starts. After migration `2035_messages_autovacuum.sql` (vacuum after 2 % changed): 5.3 %.                                        |
| Are the indexes under 20 %? | No, and vacuum settings do not change that: about 30 % in every run. They need rebuilding on closed months (procedure below).                                                                                                        |
| Production numbers?         | Not measured. No read access to production in this work. `tools/db-bloat/estimate.sql` and the weekly digest now give them (below).                                                                                                  |
| Archival windows approved?  | **No. Proposed below, waiting for a decision by the product owner and whoever owns privacy.** Nothing is archived or deleted by this change.                                                                                         |

## Measured (tools/db-bloat/bench.sql)

Real Postgres 16, a copy of `messages` with all its indexes, 200,000 rows, 40 % outgoing, each updated three times. Autovacuum is switched off on the
copies and the script vacuums at the point autovacuum's own rule (`50 + scale factor x rows` dead rows) would fire, so the three are compared on the
same rule instead of racing a background worker.

| Variant                                                       | Vacuums | HOT updates | Table size | Table bloat                                    | All indexes  |
| ------------------------------------------------------------- | ------- | ----------- | ---------- | ---------------------------------------------- | ------------ |
| default: vacuum after 20 % changed                            | 5       | 0 %         | 59 MB      | **19.7 %**                                     | 30.7 % bloat |
| tuned: vacuum after 2 % changed (**what the migration sets**) | 30      | 0 %         | 50 MB      | **5.3 %**                                      | 29.8 % bloat |
| no `idx_messages_queued`, fillfactor 85, 2 %                  | 30      | 67 %        | 57 MB      | 16.6 % (15 % of it is the reserved free space) | 27.3 % bloat |

Table bloat is free space plus dead tuples as a share of the table (`pgstattuple`). An index's bloat is its size against the size of the same index
after `REINDEX`. Per index, the primary key reached 50 % bloat in the default and tuned runs and 2.6 % in the HOT run, and the trigram index on `body`
(the biggest, about half of all index bytes) stayed at 24-32 % in all three.

What it means:

1. **Vacuum early.** Vacuuming after 2 % instead of 20 % cut table bloat from 19.7 % to 5.3 %. It costs six times as many vacuums, each one a tenth of the size.
   Applied to every `messages` partition and to every month created from now on (migration 2035). Not applied to other tables: they were not measured.
2. **Vacuum does not fix index bloat.** A B-tree page is only reused once it is empty, so a closed month keeps its half-empty index pages. Rebuild them.
3. **The cause is the partial index.** Without `idx_messages_queued` two thirds of the updates become HOT (no index writes at all) and the primary key stays
   at 2.6 %. It cannot just be dropped: `QueuedMessageRecoveryService` (every 30 s) uses it to find messages stuck in `queued`, and without it that is a scan of
   `messages`. The way out is a separate small table of messages awaiting dispatch (written with the message, deleted when sent), after which the index goes.
   That is a change to the send path, not a database setting: **follow-up, not done here.**

## Rebuilding indexes on closed months

Only for months that have ended (no more inserts, few updates). Off-peak, one index at a time, from a psql session as the table owner. `CONCURRENTLY` does not
block reads or writes; it needs free disk of about the size of the index and takes longer than a plain rebuild.

```sql
-- the closed-month indexes, biggest first: rebuild the ones that the estimate or pgstattuple_approx show as bloated
select i.indexrelid::regclass as idx, pg_size_pretty(pg_relation_size(i.indexrelid)) as size
from pg_index i join pg_class t on t.oid = i.indrelid
where t.relname ~ '^messages_[0-9]{6}$' and t.relname < 'messages_' || to_char(date_trunc('month', now()), 'YYYYMM')
order by pg_relation_size(i.indexrelid) desc limit 20;

reindex index concurrently <idx from the list>;
```

If a run is cancelled it leaves an invalid copy named `..._ccnew`; drop it (`drop index concurrently`) and run again. Do not run two at once.
Check the effect with the same query after: the sizes should fall by about a third.

## Seeing it in production

- `psql "$READONLY_URL" -f tools/db-bloat/estimate.sql`: per partition of `messages`, `message_events`, `conversation_events`, `conversations`, `message_ledger`:
  size, dead-row share, an estimated bloat share, last autovacuum and the table's storage options. Read-only. The estimate is only as good as the last `ANALYZE`;
  for an exact number on one table install `pgstattuple` (superuser) and run `select * from pgstattuple_approx('public.messages_202610'::regclass)`.
- The Monday database digest (D-06) now ends with "Table health": the five tables over 64 MB with the largest share of dead rows and when autovacuum last ran.
  A closed month high on that list, or a table that has never been vacuumed, is the sign to look.

## Archival windows: proposal, not approved

What exists today:

| Data                            | Live                                        | Archive                           | Where it is done                                                    |
| ------------------------------- | ------------------------------------------- | --------------------------------- | ------------------------------------------------------------------- |
| `an_events`                     | 60 days                                     | kept for ever                     | data-retention job (monthly partitions, verified, then dropped)     |
| `audit_log`                     | 365 days, once a super admin saves a policy | per policy                        | same job, opt-in                                                    |
| `message_events` (delivery log) | 90 days                                     | 1 year (`message_event_archives`) | message-log archive sweep, daily                                    |
| `messages` (the conversations)  | **for ever**                                | none                              | nothing: only a whole-workspace wipe after plan expiry removes them |
| `conversation_events`           | **for ever**                                | none                              | nothing                                                             |

`messages` is the table that grows without limit, and it is customer conversation history, so how long it stays live is a product and privacy decision, not a
database one. Mechanism, if approved: add `messages` to `STREAM_POLICIES` (`apps/api/src/modules/data-retention/retention-policies.ts`) with `optIn: true`, the same
path the audit log took, so nothing is cut until a super admin saves a policy and the job is really running.

Proposed for decision (the numbers are a starting point, not a measurement):

| Data                  | Proposed live window | Proposed archive window | Decision needed from         |
| --------------------- | -------------------- | ----------------------- | ---------------------------- |
| `messages`            | 24 months            | 5 years, then delete    | product owner, privacy/legal |
| `conversation_events` | 12 months            | 2 years, then delete    | product owner                |
| `message_events`      | 90 days (unchanged)  | 1 year (unchanged)      | none                         |

| Approved by | Date | Windows as approved |
| ----------- | ---- | ------------------- |
|             |      |                     |

Questions that must be answered before `messages` is archived (the audit-log design shows why each one matters):

1. **Erasure.** A privacy erase of a contact must reach archived months. The analytics archive avoids this by leaving out the column that links to a person; a
   message archive cannot, because the body is the personal data.
2. **Reading old conversations.** The inbox, search (`idx_messages_body_trgm`) and AI context read `messages` directly. An archived month is not searchable and not
   shown, so the product must accept that history older than the window is available only by export.
3. **Legal hold.** A workspace under hold must be skipped (the hold check already exists for the plan wipe).
4. **Plans.** Whether the window is one number for everybody or part of the plan, as retention already is for the workspace wipe.
5. **Size first.** Measure before choosing: `select relname, pg_size_pretty(pg_total_relation_size(oid)) from pg_class where relname ~ '^messages_[0-9]{6}$' order by 1;`
   on production gives the monthly growth that the windows have to be set against.
