-- Why this migration exists: a HOT update needs room for the new row version on the SAME page, and contacts pages are packed full
-- (fillfactor 100), so even a data-only update with no indexed column changed cannot stay heap-only.
--
-- Evidence (prod, 2026-10-22): contacts had 72,228 updates and 8 HOT ones; the two migrations before this one remove the indexes that
-- blocked the common `SET data = ...` update. Leaving 10% free per page lets those updates stay on their page.
--
-- This changes only how pages are filled from now on; it rewrites nothing and takes a short SHARE UPDATE EXCLUSIVE lock (reads and
-- writes continue). Existing pages gain room as vacuum and new inserts fill them. Reversible: ALTER TABLE contacts RESET (fillfactor).
ALTER TABLE contacts SET (fillfactor = 90);
