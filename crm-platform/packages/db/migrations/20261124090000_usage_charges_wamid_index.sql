-- wallet: look up what a message was charged by its provider message id.
-- Why this migration exists: the campaign pages now show what each campaign cost, which joins the campaign's recipient rows to
-- usage_charges on (org_id, wamid). Without an index that join scanned every partition of the charge log.
CREATE INDEX idx_usage_charges_org_wamid ON usage_charges (org_id, wamid);
