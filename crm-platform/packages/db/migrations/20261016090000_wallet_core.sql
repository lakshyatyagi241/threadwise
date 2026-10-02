-- wallet: the money engine becomes enforceable (WD-WALLET-001, -004, -005, -009, -011, -015, -021, -031).
-- Why this migration exists: the schema port copied WaDesk's wallet tables as they were. That left (a) a ledger whose spends were
-- stored with a POSITIVE amount, so the statement showed charges as money in (WD-WALLET-001 rule 5), (b) no row-level protection
-- against rewriting a posted entry, (c) idempotency by "check, then insert" (WD-WALLET-009 rule 2), (d) Meta costs rounded to
-- whole cents (WD-WALLET-005 rule 5), (e) a monthly quota counted by scanning every charge (WD-WALLET-010 rule 3) and (f) no
-- trail of who changed what. Here:
--   * wallets            one money balance per workspace (numeric major units); `low_balance_alerted_at` re-armed by a top-up
--   * wallet_transactions signed amount + explicit direction, immutable once posted, admin adjustments need a note and an actor
--   * usage_charge_keys  the idempotency gate for settlement: UNIQUE (org_id, provider_message_id), because the partitioned
--                        usage_charges cannot carry a unique key without its partition column
--   * wallet_usage_months the per-month message counter that decides free plan quota, updated under the wallet row lock
--   * wallet_events      what happened to a workspace's wallet (tenant-scoped, append-only)
--   * wallet_platform_log what an operator changed on the platform side (rates, switches, imports), operator-only
--   * message_rates      CHECKed shape and a micro-unit Meta cost; the starter rate card is seeded here, in the unit the admin
--                        grid shows (hundredths of the currency unit)

-- ---------------------------------------------------------------------------------------------------------------------------
-- wallet_transactions: signed, directional, attributable, immutable
-- ---------------------------------------------------------------------------------------------------------------------------

UPDATE wallet_transactions SET type = 'topup' WHERE type = 'wallet.topup';
UPDATE wallet_transactions SET amount = -amount WHERE type = 'spend' AND amount > 0;

ALTER TABLE wallet_transactions
  ADD COLUMN direction text,
  ADD COLUMN note text,
  ADD COLUMN actor_type text NOT NULL DEFAULT 'system',
  ADD COLUMN actor_label text,
  ADD COLUMN operator_id bigint REFERENCES platform_operators (id) ON DELETE SET NULL,
  ADD COLUMN request_id text;

UPDATE wallet_transactions SET direction = CASE WHEN amount < 0 THEN 'out' ELSE 'in' END;

ALTER TABLE wallet_transactions
  ALTER COLUMN direction SET NOT NULL,
  ADD CONSTRAINT chk_wallet_transactions_kind CHECK (kind = 'credit'),
  ADD CONSTRAINT chk_wallet_transactions_type CHECK (type IN ('earn', 'spend', 'refund', 'admin_adjust', 'topup')),
  ADD CONSTRAINT chk_wallet_transactions_direction CHECK (
    (direction = 'in' AND amount > 0) OR (direction = 'out' AND amount < 0)),
  ADD CONSTRAINT chk_wallet_transactions_actor_type CHECK (actor_type IN ('user', 'platform_operator', 'system')),
  -- An adjustment made by hand must say why and who (the requirement behind the super-admin "add balance" screen).
  ADD CONSTRAINT chk_wallet_transactions_adjust_note CHECK (
    type <> 'admin_adjust'
    OR (length(btrim(coalesce(note, ''))) >= 5 AND length(btrim(coalesce(actor_label, ''))) > 0
        AND actor_type = 'platform_operator'));

CREATE INDEX idx_wallet_transactions_org_created ON wallet_transactions (org_id, created_at DESC, id DESC);

-- A posted entry is history: it is never edited. The only change the database itself may make is the user reference going to
-- NULL (ON DELETE SET NULL of the user or the operator), and nothing but a privileged session may delete a row (the workspace
-- being deleted, which cascades).
DROP TRIGGER trg_wallet_transactions_touch ON wallet_transactions;

CREATE FUNCTION wallet_transactions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF app_is_privileged() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'wallet_transactions is append-only: a posted entry cannot be deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (to_jsonb(NEW) - 'user_id' - 'operator_id' - 'updated_at' - 'row_version')
     IS NOT DISTINCT FROM (to_jsonb(OLD) - 'user_id' - 'operator_id' - 'updated_at' - 'row_version')
     AND (NEW.user_id IS NULL OR NEW.user_id IS NOT DISTINCT FROM OLD.user_id)
     AND (NEW.operator_id IS NULL OR NEW.operator_id IS NOT DISTINCT FROM OLD.operator_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'wallet_transactions is append-only: a posted entry cannot be changed' USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER trg_wallet_transactions_immutable BEFORE UPDATE OR DELETE ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION wallet_transactions_immutable();

-- ---------------------------------------------------------------------------------------------------------------------------
-- wallets
-- ---------------------------------------------------------------------------------------------------------------------------

ALTER TABLE wallets ADD COLUMN low_balance_alerted_at timestamptz;

-- ---------------------------------------------------------------------------------------------------------------------------
-- usage_charges (the per-message ledger, partitioned): what was priced, what was taken, why a message was free
-- ---------------------------------------------------------------------------------------------------------------------------

ALTER TABLE usage_charges
  ADD COLUMN price_credits integer NOT NULL DEFAULT 0,
  ADD COLUMN shortfall_credits integer NOT NULL DEFAULT 0,
  ADD COLUMN billing_mode text NOT NULL DEFAULT 'plan',
  ADD COLUMN free_reason text,
  ADD COLUMN cost_micros bigint,
  ADD COLUMN refunded_at timestamptz,
  ADD COLUMN refund_tx_id bigint,
  ADD CONSTRAINT chk_usage_charges_amounts CHECK (credits >= 0 AND price_credits >= 0 AND shortfall_credits >= 0 AND revenue_minor >= 0),
  ADD CONSTRAINT chk_usage_charges_mode CHECK (billing_mode IN ('plan', 'wallet')),
  ADD CONSTRAINT chk_usage_charges_free_reason CHECK (
    free_reason IS NULL OR free_reason IN ('rate_is_zero', 'within_plan_free_quota', 'no_wallet_owner', 'wallet_empty'));

CREATE INDEX idx_usage_charges_wallet_tx ON usage_charges (org_id, wallet_tx_id) WHERE wallet_tx_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------------------
-- usage_charge_keys: one row per provider message id, the gate that makes settlement idempotent
-- ---------------------------------------------------------------------------------------------------------------------------

CREATE TABLE usage_charge_keys (
  org_id bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id bigint GENERATED BY DEFAULT AS IDENTITY,
  uuid uuid NOT NULL DEFAULT gen_random_uuid(),
  provider_message_id text NOT NULL,
  charge_id bigint,
  charge_created_at timestamptz,
  status text NOT NULL DEFAULT 'charged',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, uuid),
  CONSTRAINT uq_usage_charge_keys_message UNIQUE (org_id, provider_message_id),
  CONSTRAINT chk_usage_charge_keys_status CHECK (status IN ('free', 'charged', 'refunded')),
  CONSTRAINT chk_usage_charge_keys_message CHECK (length(btrim(provider_message_id)) > 0)
);

ALTER TABLE usage_charge_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_charge_keys FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON usage_charge_keys FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());
CREATE TRIGGER trg_usage_charge_keys_touch BEFORE UPDATE ON usage_charge_keys
  FOR EACH ROW EXECUTE FUNCTION touch_row();

-- ---------------------------------------------------------------------------------------------------------------------------
-- wallet_usage_months: messages counted against the plan's free quota, per calendar month (UTC)
-- ---------------------------------------------------------------------------------------------------------------------------

CREATE TABLE wallet_usage_months (
  org_id bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id bigint GENERATED BY DEFAULT AS IDENTITY,
  uuid uuid NOT NULL DEFAULT gen_random_uuid(),
  month date NOT NULL,
  messages integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, uuid),
  CONSTRAINT uq_wallet_usage_months_month UNIQUE (org_id, month),
  CONSTRAINT chk_wallet_usage_months_first_day CHECK (month = date_trunc('month', month)::date),
  CONSTRAINT chk_wallet_usage_months_messages CHECK (messages >= 0)
);

ALTER TABLE wallet_usage_months ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_usage_months FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON wallet_usage_months FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());
CREATE TRIGGER trg_wallet_usage_months_touch BEFORE UPDATE ON wallet_usage_months
  FOR EACH ROW EXECUTE FUNCTION touch_row();

-- ---------------------------------------------------------------------------------------------------------------------------
-- wallet_events: the workspace's wallet trail (append-only)
-- ---------------------------------------------------------------------------------------------------------------------------

CREATE TABLE wallet_events (
  org_id bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id bigint GENERATED BY DEFAULT AS IDENTITY,
  uuid uuid NOT NULL DEFAULT gen_random_uuid(),
  event text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  actor_type text NOT NULL DEFAULT 'system',
  actor_label text,
  subject_type text,
  subject_id bigint,
  message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, uuid),
  CONSTRAINT chk_wallet_events_severity CHECK (severity IN ('info', 'warning', 'error')),
  CONSTRAINT chk_wallet_events_actor_type CHECK (actor_type IN ('user', 'platform_operator', 'system'))
);
CREATE INDEX idx_wallet_events_org_created ON wallet_events (org_id, created_at DESC, id DESC);
CREATE INDEX idx_wallet_events_event ON wallet_events (event, created_at DESC);
CREATE INDEX idx_wallet_events_created ON wallet_events (created_at DESC, id DESC);

ALTER TABLE wallet_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_events FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON wallet_events FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());

CREATE FUNCTION wallet_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND app_is_privileged() THEN RETURN OLD; END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER trg_wallet_events_append_only BEFORE UPDATE OR DELETE ON wallet_events
  FOR EACH ROW EXECUTE FUNCTION wallet_log_append_only();

-- ---------------------------------------------------------------------------------------------------------------------------
-- wallet_platform_log: what an operator changed on the platform side. No tenant owns a row, so only a privileged session
-- reads or writes it.
-- ---------------------------------------------------------------------------------------------------------------------------

CREATE TABLE wallet_platform_log (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  uuid uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  event text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  actor_type text NOT NULL DEFAULT 'platform_operator',
  actor_label text,
  operator_id bigint REFERENCES platform_operators (id) ON DELETE SET NULL,
  message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_wallet_platform_log_severity CHECK (severity IN ('info', 'warning', 'error'))
);
CREATE INDEX idx_wallet_platform_log_created ON wallet_platform_log (created_at DESC, id DESC);
CREATE INDEX idx_wallet_platform_log_event ON wallet_platform_log (event, created_at DESC);

ALTER TABLE wallet_platform_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_platform_log FORCE  ROW LEVEL SECURITY;
CREATE POLICY operator_only ON wallet_platform_log FOR ALL
  USING      (app_is_privileged())
  WITH CHECK (app_is_privileged());
CREATE TRIGGER trg_wallet_platform_log_append_only BEFORE UPDATE OR DELETE ON wallet_platform_log
  FOR EACH ROW EXECUTE FUNCTION wallet_log_append_only();

-- ---------------------------------------------------------------------------------------------------------------------------
-- message_rates: shape, precision, starter rate card
-- ---------------------------------------------------------------------------------------------------------------------------

-- Millionths of one currency unit: a utility message at 0.004 USD is 4000, which the whole-cent `meta_cost_minor` rounded to 0
-- (WD-WALLET-005 rule 5). `meta_cost_minor` stays, derived, because the reseller P&L reads it.
ALTER TABLE message_rates
  ADD COLUMN meta_cost_micros bigint,
  ADD CONSTRAINT chk_message_rates_country CHECK (country_code ~ '^([A-Z]{2})?$'),
  ADD CONSTRAINT chk_message_rates_category CHECK (category IN ('', 'marketing', 'utility', 'authentication', 'service')),
  ADD CONSTRAINT chk_message_rates_amounts CHECK (credits >= 0 AND (meta_cost_micros IS NULL OR meta_cost_micros >= 0));

UPDATE message_rates SET meta_cost_micros = meta_cost_minor * 10000 WHERE meta_cost_minor IS NOT NULL AND meta_cost_micros IS NULL;

-- The starter card of a fresh install (WD-WALLET-032), in hundredths of the currency unit, the unit the admin grid shows: a
-- US marketing message is 12.00. WaDesk's install migration stored whole credits here (1, 12) that the same grid then read as
-- 0.01 and 0.12 (its open question 8); this seeds what the grid and its "re-seed" button mean.
INSERT INTO message_rates (country_code, category, credits) VALUES
  ('',   '',               100),
  ('',   'service',          0),
  ('',   'utility',        100),
  ('',   'authentication', 100),
  ('IN', 'marketing',      100), ('IN', 'utility', 100), ('IN', 'authentication', 100),
  ('US', 'marketing',     1200), ('US', 'utility', 200), ('US', 'authentication', 600),
  ('GB', 'marketing',     1200), ('GB', 'utility', 200), ('GB', 'authentication', 600),
  ('BR', 'marketing',      600),
  ('AE', 'marketing',      500),
  ('MX', 'marketing',      300)
ON CONFLICT (country_code, category) DO NOTHING;
