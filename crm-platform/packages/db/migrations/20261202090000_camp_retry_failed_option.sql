-- Per-campaign choice to retry failed messages (the classic builder's "Retry failed messages automatically" checkbox).
-- Why: until now every campaign retried a transient failure under the platform's retry settings and a person could not turn it off
-- for one send. Default true keeps every existing campaign exactly as it was; false makes the first failure final.
-- Not the same as retry_enabled, which is the guided wizard's own switch for Meta's frequency-cap (131049) retries every 24 hours.
ALTER TABLE wpcampaigns
  ADD COLUMN retry_failed boolean NOT NULL DEFAULT true;
