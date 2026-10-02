-- Follow-up to 20261010090000: the comparison that lets a deleted tax rate unlink a frozen line looked at every column, but the
-- generated column `tax_rate_bp` is not computed yet while a BEFORE trigger runs, so a line never compared equal and the delete
-- still failed. Compare everything except the link and the generated rounding.

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
       AND (to_jsonb(NEW) - 'tax_rate_id' - 'tax_rate_bp') = (to_jsonb(OLD) - 'tax_rate_id' - 'tax_rate_bp')
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'the lines of an issued invoice are frozen' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
