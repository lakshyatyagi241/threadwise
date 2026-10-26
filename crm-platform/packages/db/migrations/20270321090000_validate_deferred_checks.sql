-- Validates the eight CHECK constraints that 20270131090000_con_enum_checks_closed_sets.sql added NOT VALID (QA task 47/48, int-validated).
-- NOT VALID checks new and updated rows only; a constraint that is never validated is a promise about rows nobody has looked at.
-- Each one is validated only when no stored row violates it: VALIDATE CONSTRAINT takes a SHARE UPDATE EXCLUSIVE lock (reads and writes go on) and
-- scans the table once, and a violating row would fail the whole deploy. A constraint with a violating row is left NOT VALID and reported
-- (RAISE NOTICE with the table and the first offending value) so the data can be fixed and this re-run by hand.
-- Partition children are skipped: validating the parent validates them.
DO $$
DECLARE
  c record;
  bad text;
BEGIN
  FOR c IN
    SELECT con.conname, con.conrelid::regclass AS tbl, pg_get_expr(con.conbin, con.conrelid) AS expr
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
     WHERE con.contype = 'c' AND NOT con.convalidated AND NOT rel.relispartition
       AND con.conname IN ('chk_cart_recoveries_status', 'chk_shopify_waitlist_status', 'chk_woocommerce_waitlist_status',
                           'chk_wa_pending_orders_status', 'chk_ai_training_sources_kind', 'chk_ai_training_sources_status',
                           'chk_users_status', 'chk_event_outbox_status')
  LOOP
    EXECUTE format('SELECT 1 FROM %s WHERE (%s) IS FALSE LIMIT 1', c.tbl, c.expr) INTO bad;
    IF bad IS NULL THEN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', c.tbl, c.conname);
    ELSE
      RAISE NOTICE 'constraint % on % left NOT VALID: a stored row violates it', c.conname, c.tbl;
    END IF;
  END LOOP;
END $$;
