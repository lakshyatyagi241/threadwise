-- 2041_campaign_legacy_cost
-- Why this migration exists (not what it does — the SQL says that):
--
-- A campaign's cost is added up from the usage charges of its messages. A campaign migrated from the old system has none (the
-- migration writes historical charges as inert 'free' rows, and only for non-broadcast sends), so it showed a cost of 0.00 while the
-- old system showed what was billed and what was refunded. The migration now keeps those two amounts on the campaign, in hundredths
-- of the wallet currency, and the campaign's cost uses them when it has no charge rows of its own. Additive and nullable: a campaign
-- made in this application has NULL in both and nothing changes for it.

ALTER TABLE wpcampaigns ADD COLUMN legacy_billed_minor bigint;
ALTER TABLE wpcampaigns ADD COLUMN legacy_refunded_minor bigint;

ALTER TABLE wpcampaigns ADD CONSTRAINT ck_wpcampaigns_legacy_cost
  CHECK ((legacy_billed_minor IS NULL OR legacy_billed_minor >= 0) AND (legacy_refunded_minor IS NULL OR legacy_refunded_minor >= 0));
