-- inv: totals use the sales-docs semantics, and the tax columns can hold what a country-aware tax engine returns.
-- Why this migration exists:
--  1. 20261007100000 gave invoices a separate `doc_discount_minor` and a subtotal before line discounts, which disagrees with
--     proposals and estimates (subtotal = sum of line nets, discount = the document-level discount). A quote converted to an
--     invoice must show the buyer the same figures, so the invoice adopts the quote's semantics and the redundant column goes.
--  2. The owner's direction: tax is country-aware (GST with CGST/SGST/IGST and HSN/SAC and GSTIN, VAT with reverse charge, US sales
--     tax, Canada GST/HST/PST). The columns below hold the facts a legal invoice prints: the regime, both parties' tax ids and
--     countries, the place of supply, the reverse-charge flag, and per-line / per-rate tax COMPONENTS (a CGST + SGST split is two
--     components of one rate). The totals function stays behind one call (computeInvoice in @crm/contracts) so the @crm/tax package
--     can replace it without another schema change.

-- --- 1. totals semantics -----------------------------------------------------------------------------------------------------

ALTER TABLE invoices DROP CONSTRAINT chk_invoices_totals;
ALTER TABLE invoices DROP COLUMN doc_discount_minor;
ALTER TABLE invoices ADD CONSTRAINT chk_invoices_totals CHECK (
  subtotal_minor >= 0 AND discount_minor >= 0 AND tax_minor >= 0 AND shipping_minor >= 0 AND total_minor >= 0
  AND tax_added_minor >= 0 AND tax_added_minor <= tax_minor
  AND discount_minor <= subtotal_minor
  AND total_minor = subtotal_minor - discount_minor + tax_added_minor + shipping_minor
);

CREATE OR REPLACE FUNCTION invoices_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'void' AND NEW.status <> 'void' THEN
    RAISE EXCEPTION 'a void invoice cannot be reopened' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'draft' THEN
    RAISE EXCEPTION 'an issued invoice cannot go back to draft' USING ERRCODE = '55000';
  END IF;
  IF (NEW.invoice_number, NEW.series, NEW.seq, NEW.doc_type, NEW.currency, NEW.currency_exponent,
      NEW.subtotal_minor, NEW.discount_minor, NEW.shipping_minor, NEW.tax_minor, NEW.tax_added_minor,
      NEW.total_minor, NEW.discount_kind, NEW.discount_value, NEW.tax_inclusive, NEW.buyer_name, NEW.issued_at, NEW.issue_date,
      NEW.tax_regime, NEW.buyer_tax_id, NEW.buyer_country, NEW.place_of_supply, NEW.reverse_charge, NEW.seller_snapshot_json)
     IS DISTINCT FROM
     (OLD.invoice_number, OLD.series, OLD.seq, OLD.doc_type, OLD.currency, OLD.currency_exponent,
      OLD.subtotal_minor, OLD.discount_minor, OLD.shipping_minor, OLD.tax_minor, OLD.tax_added_minor,
      OLD.total_minor, OLD.discount_kind, OLD.discount_value, OLD.tax_inclusive, OLD.buyer_name, OLD.issued_at, OLD.issue_date,
      OLD.tax_regime, OLD.buyer_tax_id, OLD.buyer_country, OLD.place_of_supply, OLD.reverse_charge, OLD.seller_snapshot_json)
  THEN
    RAISE EXCEPTION 'an issued invoice is frozen: its number, parties, tax facts, currency and amounts cannot change'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
-- (the trigger from 20261007100000 already points at invoices_freeze(); the new columns are added below, before the first write)

-- --- 2. tax facts ------------------------------------------------------------------------------------------------------------

ALTER TABLE invoices
  -- which rule set priced the document: 'none', 'gst_in', 'vat', 'us_sales_tax', 'ca_gst_hst_pst', 'other' (the @crm/tax preset id)
  ADD COLUMN tax_regime      text NOT NULL DEFAULT 'none',
  ADD COLUMN buyer_tax_id    text,
  ADD COLUMN buyer_country   text,
  -- the jurisdiction the supply is taxed in: an ISO 3166-2 code ("IN-MH", "US-CA") or a country code ("DE"); drives CGST+SGST vs IGST
  ADD COLUMN place_of_supply text,
  ADD COLUMN reverse_charge  boolean NOT NULL DEFAULT false,
  -- the seller's own tax ids and legal wording come from the settings snapshot taken at issue (seller_snapshot_json)
  ADD COLUMN legal_notes     text,
  ADD CONSTRAINT chk_invoices_regime CHECK (tax_regime ~ '^[a-z0-9_]{1,32}$'),
  ADD CONSTRAINT chk_invoices_countries CHECK (
    (buyer_country IS NULL OR buyer_country ~ '^[A-Z]{2}$')
    AND (place_of_supply IS NULL OR place_of_supply ~ '^[A-Z]{2}(-[A-Z0-9]{1,3})?$')
  ),
  -- reverse charge means the BUYER accounts for the tax: no tax is charged on the document
  ADD CONSTRAINT chk_invoices_reverse_charge CHECK (NOT reverse_charge OR tax_minor = 0);

ALTER TABLE invoice_items
  -- the tax type of the rate that priced the line ('gst', 'vat', 'sales_tax', 'hst', 'pst', ...) and its components
  ADD COLUMN tax_type        text,
  -- [{ "type": "CGST", "rateBp": 900, "amountMinor": "900" }, ...]: one entry per component of a compound rate
  ADD COLUMN tax_components  jsonb,
  ADD CONSTRAINT chk_invoice_items_hsn CHECK (hsn_sac IS NULL OR hsn_sac ~ '^[0-9A-Za-z]{2,12}$');

ALTER TABLE invoice_tax_summary
  ADD COLUMN tax_type        text,
  ADD COLUMN tax_components  jsonb;

ALTER TABLE tax_rates
  ADD COLUMN tax_type        text NOT NULL DEFAULT 'other',
  ADD COLUMN country         text,
  ADD COLUMN region          text,
  -- compound rates (GST 18% = CGST 9% + SGST 9%): [{ "type": "CGST", "rateBp": 900 }, ...]; null for a simple rate
  ADD COLUMN components      jsonb,
  ADD COLUMN effective_from  date,
  ADD COLUMN effective_to    date,
  ADD COLUMN default_hsn_sac text,
  ADD CONSTRAINT chk_tax_rates_type CHECK (tax_type IN ('gst', 'cgst', 'sgst', 'igst', 'vat', 'sales_tax', 'hst', 'pst', 'qst', 'other')),
  ADD CONSTRAINT chk_tax_rates_country CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT chk_tax_rates_window CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
  ADD CONSTRAINT chk_tax_rates_hsn CHECK (default_hsn_sac IS NULL OR default_hsn_sac ~ '^[0-9A-Za-z]{2,12}$');

ALTER TABLE invoice_settings
  -- the invoicing profile (WD-INV-021, owner direction): who the seller is, per country
  ADD COLUMN seller_country       text,
  ADD COLUMN seller_state         text,
  ADD COLUMN default_tax_regime   text NOT NULL DEFAULT 'none',
  ADD COLUMN bank_details         jsonb,
  ADD COLUMN number_format        text NOT NULL DEFAULT '{PREFIX}-{YEAR}-{SEQ}',
  ADD COLUMN invoice_title        text,
  ADD CONSTRAINT chk_invoice_settings_country CHECK (seller_country IS NULL OR seller_country ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT chk_invoice_settings_regime CHECK (default_tax_regime ~ '^[a-z0-9_]{1,32}$'),
  ADD CONSTRAINT chk_invoice_settings_format CHECK (
    number_format LIKE '%{SEQ}%' AND char_length(number_format) <= 60
    AND number_format !~ '[^A-Za-z0-9{}_./ -]'
  );
