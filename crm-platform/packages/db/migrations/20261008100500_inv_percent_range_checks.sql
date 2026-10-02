-- inv: put back the 0..100 percent range checks that dropping the old basis-point columns took with them.
-- Why this migration exists: 20261008100100 replaced the writable rate_bp columns by generated ones (DROP COLUMN ... ADD COLUMN), and
-- dropping a column also drops every CHECK that mentions it, so chk_tax_rates_percent, chk_invoice_items_percent and
-- chk_invoice_tax_summary_percent (which stated "0 to 100 percent") disappeared with it. The range is the invariant; the generated
-- column keeps the basis-point mirror in step by itself, so the checks now only need to state the range.

ALTER TABLE tax_rates
  ADD CONSTRAINT chk_tax_rates_percent CHECK (rate_percent BETWEEN 0 AND 100);
ALTER TABLE invoice_items
  ADD CONSTRAINT chk_invoice_items_percent CHECK (tax_rate_percent BETWEEN 0 AND 100);
ALTER TABLE invoice_tax_summary
  ADD CONSTRAINT chk_invoice_tax_summary_percent CHECK (rate_percent BETWEEN 0 AND 100);
