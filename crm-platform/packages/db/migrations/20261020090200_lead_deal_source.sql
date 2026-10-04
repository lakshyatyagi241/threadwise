-- lead: a deal made from a lead source carries the source value `lead_ad` (spec L-08).
-- Why this migration exists: `chk_deals_source` (20261003100000) lists the values a deal's source may hold, `form` is reserved for a
-- Reference form the product does not have, and none of the ten names an ad or portal lead. The same value is added to DEAL_SOURCES in
-- @crm/contracts, so the deals list can filter by it. Existing rows are untouched: the new list is a superset of the old one.

ALTER TABLE deals DROP CONSTRAINT chk_deals_source;
ALTER TABLE deals ADD CONSTRAINT chk_deals_source
  CHECK (source IN ('manual','inbox','order','shopify','woo','form','api','flow','facebook','ai','lead_ad'));
