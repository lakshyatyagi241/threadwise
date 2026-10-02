-- inv: exact tax percentages, so country presets can be stored without rounding.
-- Why this migration exists: tax_rates.rate_bp is an integer number of basis points (1/100 of a percent), which cannot hold Quebec's
-- QST 9.975%, Mexico's 10.6667% retention or four US state bases (MN 6.875, MO 4.225, NJ 6.625, NM 4.875): docs/tax-engine.md
-- "Seeding tax_rates". The engine (@crm/tax) already takes percent strings with up to 4 decimals, so the percentage becomes the source
-- of truth (numeric(7,4)) on the rate, on the line that snapshots it and on the tax summary. rate_bp stays as the rounded value for
-- readers that only need two decimals; a CHECK keeps the two in step so they can never disagree.

ALTER TABLE tax_rates
  ADD COLUMN rate_percent numeric(7,4);
UPDATE tax_rates SET rate_percent = rate_bp / 100.0;
ALTER TABLE tax_rates
  ALTER COLUMN rate_percent SET NOT NULL,
  ADD CONSTRAINT chk_tax_rates_percent CHECK (rate_percent BETWEEN 0 AND 100 AND rate_bp = round(rate_percent * 100)::int);

ALTER TABLE invoice_items
  ADD COLUMN tax_rate_percent numeric(7,4) NOT NULL DEFAULT 0;
-- the backfill touches issued invoices' lines: the freeze trigger is paused for it (the values are derived, nothing a buyer saw changes)
ALTER TABLE invoice_items DISABLE TRIGGER trg_invoice_items_freeze;
UPDATE invoice_items SET tax_rate_percent = tax_rate_bp / 100.0;
ALTER TABLE invoice_items ENABLE TRIGGER trg_invoice_items_freeze;
ALTER TABLE invoice_items
  ADD CONSTRAINT chk_invoice_items_percent CHECK (tax_rate_percent BETWEEN 0 AND 100 AND tax_rate_bp = round(tax_rate_percent * 100)::int);

ALTER TABLE invoice_tax_summary
  ADD COLUMN rate_percent numeric(7,4) NOT NULL DEFAULT 0;
ALTER TABLE invoice_tax_summary DISABLE TRIGGER trg_invoice_tax_summary_freeze;
UPDATE invoice_tax_summary SET rate_percent = rate_bp / 100.0;
ALTER TABLE invoice_tax_summary ENABLE TRIGGER trg_invoice_tax_summary_freeze;
ALTER TABLE invoice_tax_summary
  DROP CONSTRAINT uq_invoice_tax_summary_row,
  ADD CONSTRAINT uq_invoice_tax_summary_row UNIQUE (org_id, invoice_id, tax_label, rate_percent, inclusive),
  ADD CONSTRAINT chk_invoice_tax_summary_percent CHECK (rate_percent BETWEEN 0 AND 100 AND rate_bp = round(rate_percent * 100)::int);
