-- Follow-up to 20261010090000 / 20261010090100: invoice_items_freeze() is attached to more than one table (the lines and the tax
-- summary rows of an invoice), and only the lines have a tax_rate_id, so reading OLD.tax_rate_id failed on the other table.
-- Read the link through jsonb, which is simply NULL where a row has no such column.

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
       AND (to_jsonb(OLD) ->> 'tax_rate_id') IS NOT NULL AND (to_jsonb(NEW) ->> 'tax_rate_id') IS NULL
       AND (to_jsonb(NEW) - 'tax_rate_id' - 'tax_rate_bp') = (to_jsonb(OLD) - 'tax_rate_id' - 'tax_rate_bp')
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'the lines of an issued invoice are frozen' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
