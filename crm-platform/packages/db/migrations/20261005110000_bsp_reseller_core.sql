-- bsp: the allocation register becomes enforceable.
-- Why this migration exists (TW-BSP-006, -010): Reference kept "one row per (workspace, WABA)" only in application code (an
-- updateOrCreate), so two concurrent attaches could leave duplicates and nothing stopped a status outside the three the UI
-- knows. Here the pair is UNIQUE (the attach upserts on it, so a failed or revoked row is retried in place), the status and the
-- credit source are CHECKed, and the operator who attached is recorded (Reference dropped the acting admin, TW-BSP-006 rule 8).
-- The unique key makes the (org_id, waba_id) index from the schema port redundant, so it goes.

ALTER TABLE bsp_credit_allocations
  ADD COLUMN created_by_operator_id bigint REFERENCES platform_operators (id) ON DELETE SET NULL,
  ADD CONSTRAINT uq_bsp_credit_allocations_org_waba UNIQUE (org_id, waba_id),
  ADD CONSTRAINT chk_bsp_credit_allocations_status CHECK (status IN ('attached', 'revoked', 'failed')),
  ADD CONSTRAINT chk_bsp_credit_allocations_source CHECK (credit_source IS NULL OR credit_source IN ('meta', 'aggregator')),
  ADD CONSTRAINT chk_bsp_credit_allocations_currency CHECK (currency = upper(currency) AND length(currency) BETWEEN 1 AND 8);

DROP INDEX idx_bsp_credit_allocations_waba_id;

-- The operator's register lists every tenant newest first by keyset (created_at, id); the primary key leads with org_id and
-- cannot serve that order.
CREATE INDEX idx_bsp_credit_allocations_listing ON bsp_credit_allocations (created_at DESC, id DESC);
