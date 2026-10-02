-- Deleting a tax rate must not fail because an issued invoice used it.
--
-- invoice_items.tax_rate_id is `ON DELETE SET NULL` (a line keeps its own snapshot of the rate: name, percent, amounts), but
-- the freeze trigger refused every UPDATE of a line of an issued invoice, so the cascade of that foreign key raised
-- "the lines of an issued invoice are frozen" and `DELETE /tax-rates/:id` answered 500 for any rate an issued invoice used.
-- The one change a frozen line may take is exactly that unlink: tax_rate_id goes from a value to NULL and nothing else moves.

CREATE OR REPLACE FUNCTION invoice_items_freeze() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status text;
  parent_id bigint := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  parent_org bigint := CASE WHEN TG_OP = 'DELETE' THEN OLD.org_id ELSE NEW.org_id END;
BEGIN
  SELECT status INTO parent_status FROM invoices WHERE org_id = parent_org AND id = parent_id;
  IF parent_status IS NOT NULL AND parent_status <> 'draft' THEN
    -- the foreign key's ON DELETE SET NULL (a deleted tax rate): only the link goes, the line's own snapshot stays
    IF TG_OP = 'UPDATE'
       AND OLD.tax_rate_id IS NOT NULL AND NEW.tax_rate_id IS NULL
       AND (to_jsonb(NEW) - 'tax_rate_id') = (to_jsonb(OLD) - 'tax_rate_id')
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'the lines of an issued invoice are frozen' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
