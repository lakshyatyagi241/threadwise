-- 20261217090000_analytics_events
-- The event store and rollup tables behind event-based analytics (docs/superpowers/specs/2026-10-16-event-based-analytics-design.md).
-- an_events is an append-only stream written in the business transaction; the rollup worker folds it into an_rollup_hour and an_rollup_day by a
-- recorded_at watermark kept in an_rollup_state. No foreign keys, so the an_* set can move to another Postgres later.

CREATE SEQUENCE an_events_id_seq;

CREATE TABLE an_events (
  id              bigint      NOT NULL DEFAULT nextval('an_events_id_seq'),
  org_id          bigint      NOT NULL,
  type            smallint    NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  occurred_at     timestamptz NOT NULL,
  channel_kind    smallint,
  direction       smallint,
  status          smallint,
  source_kind     smallint,
  k1              smallint,
  k2              smallint,
  channel_id      bigint,
  contact_id      bigint,
  conversation_id bigint,
  campaign_id     bigint,
  flow_id         bigint,
  agent_id        bigint,
  template_id     bigint,
  device_id       bigint,
  qty             integer     NOT NULL DEFAULT 1,
  amount_minor    bigint,
  duration_ms     integer,
  tokens          integer,
  props           jsonb,
  PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

-- Rollup scans read a recorded_at window of the newest partition: a tiny BRIN does it. Drill-down reads one org over an occurred_at range.
CREATE INDEX idx_an_events_recorded_brin ON an_events USING brin (recorded_at) WITH (pages_per_range = 32);
CREATE INDEX idx_an_events_org_occurred  ON an_events (org_id, occurred_at);

ALTER TABLE an_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE an_events FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON an_events FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());

-- Bootstrap partitions (previous month, current, next two) and a catch-all so a gap in partition maintenance degrades into rows landing in
-- _default instead of failed writes. PartitionMaintenanceService finds this table by itself and keeps three months ahead.
DO $$
DECLARE
  m date;
BEGIN
  FOR m IN
    SELECT generate_series(date_trunc('month', now() - interval '1 month'),
      date_trunc('month', now() + interval '2 months'), interval '1 month')::date
  LOOP
    PERFORM ensure_monthly_partition('an_events', m);
  END LOOP;
END $$;
CREATE TABLE an_events_default PARTITION OF an_events DEFAULT;
SELECT inherit_partition_rls('an_events_default');

-- Rollups. d1..d3 hold the metric's dimensions (0 when unused); a histogram metric uses d3 as the bucket index. org_id = 0 holds
-- platform-wide rows, visible only to a privileged transaction because current_org_id() is never 0. No FK to organizations: 0 is not one.
CREATE TABLE an_rollup_hour (
  org_id bigint      NOT NULL,
  metric smallint    NOT NULL,
  bucket timestamptz NOT NULL,
  d1     bigint      NOT NULL DEFAULT 0,
  d2     bigint      NOT NULL DEFAULT 0,
  d3     bigint      NOT NULL DEFAULT 0,
  n      bigint      NOT NULL DEFAULT 0,
  s1     bigint      NOT NULL DEFAULT 0,
  s2     bigint      NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, metric, bucket, d1, d2, d3)
);

CREATE TABLE an_rollup_day (
  org_id bigint   NOT NULL,
  metric smallint NOT NULL,
  bucket date     NOT NULL,
  d1     bigint   NOT NULL DEFAULT 0,
  d2     bigint   NOT NULL DEFAULT 0,
  d3     bigint   NOT NULL DEFAULT 0,
  n      bigint   NOT NULL DEFAULT 0,
  s1     bigint   NOT NULL DEFAULT 0,
  s2     bigint   NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, metric, bucket, d1, d2, d3)
);

ALTER TABLE an_rollup_hour ENABLE ROW LEVEL SECURITY;
ALTER TABLE an_rollup_hour FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON an_rollup_hour FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());

ALTER TABLE an_rollup_day ENABLE ROW LEVEL SECURITY;
ALTER TABLE an_rollup_day FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON an_rollup_day FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());

-- The watermark: every event with recorded_at below it is already in the rollups. Every tenant reads it (the live tail starts there); only
-- the worker writes it.
CREATE TABLE an_rollup_state (
  name            text        PRIMARY KEY,
  recorded_before timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE an_rollup_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE an_rollup_state FORCE  ROW LEVEL SECURITY;
CREATE POLICY read_all ON an_rollup_state FOR SELECT USING (true);
CREATE POLICY operator_write ON an_rollup_state FOR ALL
  USING (app_is_privileged()) WITH CHECK (app_is_privileged());

-- Seeded privileged, like every other write to this table, so a non-superuser migration role is not blocked by the policy above.
SELECT set_config('app.privileged', 'on', true);
INSERT INTO an_rollup_state (name, recorded_before) VALUES ('main', now());
SELECT set_config('app.privileged', 'off', true);
