-- Keeps the visibility map of conversations current, so the inbox's badge counts stay index-only.
-- Why this migration exists: an index-only scan skips the heap only for pages the visibility map marks all-visible, and every
-- inbound message or read clears that mark until the next VACUUM. With the server default (vacuum after 20% of the table changed,
-- 80k of 400k threads), a burst of 14k updates on the bench left 17% of pages unmarked: the default badges went from 14 ms to
-- 83-110 ms, and the archived ones from 3 ms to 22-33 ms. Vacuuming after 1% changed (4k threads here) keeps the map within a few
-- minutes of the writes, and autovacuum skips the pages already marked, so each run stays small. Measured on the bench: after the same
-- burst, autovacuum ran within about a minute and the map was fully marked again, with no manual VACUUM.
-- The analyze threshold is lowered too, so the planner's row estimates follow the same churn.
ALTER TABLE conversations SET (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_vacuum_insert_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.02
);
