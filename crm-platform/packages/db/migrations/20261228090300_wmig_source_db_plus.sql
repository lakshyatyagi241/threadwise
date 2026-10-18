-- A Waboo database (organization) name may contain a plus sign: Mongo allows it in database names.
ALTER TABLE waboo_migration_runs DROP CONSTRAINT chk_wmig_db;
ALTER TABLE waboo_migration_runs ADD CONSTRAINT chk_wmig_db CHECK (source_db ~ '^[A-Za-z0-9_+]{1,128}$');
