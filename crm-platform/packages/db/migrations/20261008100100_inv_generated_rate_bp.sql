-- inv: rate_bp becomes a function of rate_percent.
-- Why this migration exists: 20261008100000 added the exact percentage beside rate_bp and a CHECK to keep the two in step. A column that
-- can be derived should not be writable: rate_bp is now GENERATED from rate_percent, so there is one source of truth, nothing to
-- keep in step, and a writer cannot get them wrong. Readers that want basis points keep reading rate_bp.

ALTER TABLE tax_rates
  DROP COLUMN rate_bp,
  ADD COLUMN rate_bp integer GENERATED ALWAYS AS (round(rate_percent * 100)::int) STORED;

ALTER TABLE invoice_items
  DROP COLUMN tax_rate_bp,
  ADD COLUMN tax_rate_bp integer GENERATED ALWAYS AS (round(tax_rate_percent * 100)::int) STORED;

ALTER TABLE invoice_tax_summary
  DROP COLUMN rate_bp,
  ADD COLUMN rate_bp integer GENERATED ALWAYS AS (round(rate_percent * 100)::int) STORED;

-- the tax types a country profile can name (the @crm/tax engine's list)
ALTER TABLE tax_rates DROP CONSTRAINT chk_tax_rates_type;
ALTER TABLE tax_rates ADD CONSTRAINT chk_tax_rates_type CHECK (tax_type IN (
  'vat', 'gst', 'cgst', 'sgst', 'utgst', 'igst', 'hst', 'pst', 'qst', 'sales_tax', 'sst', 'consumption_tax', 'iva', 'tds', 'tcs',
  'withholding', 'custom', 'other'
));
