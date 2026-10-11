-- cat: migration 20261017090300_cat_value_checks added nine CHECK constraints NOT VALID and nothing ever validated them, so
-- they guard new writes but say nothing about rows that were already there (tenancy audit TI-007; data integrity, not isolation).
-- VALIDATE CONSTRAINT takes only a SHARE UPDATE EXCLUSIVE lock: reads and writes continue while it scans.
--
-- Cannot fail a deploy on existing data: a constraint whose table holds an offending row is left NOT VALID and named in a NOTICE,
-- so a person can find and fix those rows and validate it by hand with the same ALTER TABLE statement.
SELECT set_config('app.privileged', 'on', true);

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname
      FROM pg_constraint
     WHERE contype = 'c'
       AND NOT convalidated
       AND conname IN (
         'chk_wa_products_status', 'chk_wa_products_price', 'chk_wa_products_stock', 'chk_wa_products_meta_sync_status',
         'chk_wa_product_reviews_rating', 'chk_wa_product_reviews_status',
         'chk_wa_stock_reservations_qty', 'chk_wa_stock_reservations_status', 'chk_wa_catalogs_provider'
       )
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', c.tbl, c.conname);
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE '% on % has rows that break it: left NOT VALID', c.conname, c.tbl;
    END;
  END LOOP;
END
$$;
