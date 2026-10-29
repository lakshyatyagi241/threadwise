-- Campaign cost of campaigns that were migrated BEFORE migration 2041 (wpcampaigns.legacy_billed_minor / legacy_refunded_minor).
--
-- Why: the broadcast step now writes what Waboo billed and refunded per campaign into those two columns, and the campaign list shows
-- billed less refunded when a campaign has no usage charges of its own. A campaign loaded earlier has the amounts only as text in
-- migration.quarantine (reason COST_FIELDS, doc.detail), because the old load had no column for them. This fills the columns from there,
-- once, for the campaigns whose columns are still empty. It is idempotent (it never overwrites a value) and touches nothing else.
-- It is a one-off for already loaded clients; a new load writes the columns itself.
--
-- Run as the owner inside one transaction and look at the preview first. `touch_row` stamps updated_at / row_version on the campaigns it
-- changes, which is expected for a data fix.
--
--   BEGIN;
--   \i campaign-legacy-cost-backfill.sql      -- prints the preview, then updates
--   -- check the row count, then COMMIT; (or ROLLBACK;)
--
-- Amounts: Waboo's decimal text -> hundredths, rounded half up (numeric rounding is half away from zero, the same for these positive
-- amounts), the same rule as the tool's own `minorOf`.

\echo == preview: the campaigns that will get an amount
SELECT m.source_client, c.org_id, c.id, c.campaign_name,
       round((q.doc->'detail'->>'billable_amount')::numeric * 100)::bigint  AS billed_minor,
       round((q.doc->'detail'->>'refunded_amount')::numeric * 100)::bigint AS refunded_minor
  FROM migration.quarantine q
  JOIN migration.id_map m
    ON m.source_client = q.source_client AND m.source_collection = 'broadcasting'
   AND m.source_key = split_part(q.source_key, '#', 1) AND m.target_table = 'wpcampaigns'
  JOIN wpcampaigns c ON c.org_id = m.target_org_id AND c.id = m.target_id
 WHERE q.collection = 'broadcasting' AND q.reason_code = 'COST_FIELDS'
   AND c.legacy_billed_minor IS NULL AND c.legacy_refunded_minor IS NULL
   AND (q.doc->'detail'->>'billable_amount') ~ '^\d+(\.\d+)?$'
 ORDER BY m.source_client, c.id;

UPDATE wpcampaigns c
   SET legacy_billed_minor = round((q.doc->'detail'->>'billable_amount')::numeric * 100)::bigint,
       legacy_refunded_minor = CASE WHEN (q.doc->'detail'->>'refunded_amount') ~ '^\d+(\.\d+)?$'
                                    THEN round((q.doc->'detail'->>'refunded_amount')::numeric * 100)::bigint END
  FROM migration.quarantine q
  JOIN migration.id_map m
    ON m.source_client = q.source_client AND m.source_collection = 'broadcasting'
   AND m.source_key = split_part(q.source_key, '#', 1) AND m.target_table = 'wpcampaigns'
 WHERE c.org_id = m.target_org_id AND c.id = m.target_id
   AND q.collection = 'broadcasting' AND q.reason_code = 'COST_FIELDS'
   AND c.legacy_billed_minor IS NULL AND c.legacy_refunded_minor IS NULL
   AND (q.doc->'detail'->>'billable_amount') ~ '^\d+(\.\d+)?$';
