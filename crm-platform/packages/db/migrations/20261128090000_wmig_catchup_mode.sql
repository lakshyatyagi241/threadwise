-- wmig: a third run mode, `catchup` (re-run an already-loaded client: forced export, new rows only, wallet synced, then verified).
-- Additive: only widens the two mode CHECKs of 20261113100000 / 20261114100000.

ALTER TABLE waboo_migration_runs DROP CONSTRAINT chk_wmig_mode;
ALTER TABLE waboo_migration_runs ADD CONSTRAINT chk_wmig_mode CHECK (mode IN ('dry', 'load', 'catchup'));
ALTER TABLE waboo_migration_batches DROP CONSTRAINT chk_wmigb_mode;
ALTER TABLE waboo_migration_batches ADD CONSTRAINT chk_wmigb_mode CHECK (mode IN ('dry', 'load', 'catchup'));
