-- 0006_outbox_audit
-- The transactional outbox and the audit log.
--
-- Both are RANGE-partitioned monthly from day one. Not because the volume
-- demands it today, but because converting a large unpartitioned table later
-- means a rewrite under lock — the cheapest time to partition is before there
-- is any data.
--
-- Note the shape difference from every other table here: the PK is
-- (id, created_at), not (org_id, id). Postgres requires the partition key in
-- the PK, and these are append-only streams read by time, not by tenant.

-- Explicit sequences: a partitioned parent cannot own an identity sequence.
CREATE SEQUENCE event_outbox_id_seq;
CREATE SEQUENCE audit_log_id_seq;

CREATE TABLE event_outbox (
  id               bigint NOT NULL DEFAULT nextval('event_outbox_id_seq'),
  org_id           bigint NOT NULL,
  -- Polymorphic: the changed record can live in any physical table or in the
  -- generic records store. No FK is possible, and that is intentional.
  aggregate_module text NOT NULL,
  aggregate_id     bigint NOT NULL,
  event_type       text NOT NULL,     -- contact.created, campaign.completed, ...
  payload          jsonb NOT NULL,
  status           text NOT NULL DEFAULT 'pending',  -- pending|processing|done|dead
  attempts         integer NOT NULL DEFAULT 0,
  last_error       text,
  available_at     timestamptz NOT NULL DEFAULT now(),  -- retry backoff
  processed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- The drain query. Partial index so it only covers rows still owed work —
-- processed rows drop out of the index instead of bloating it.
CREATE INDEX idx_outbox_pending ON event_outbox (available_at, id)
  WHERE status = 'pending';
CREATE INDEX idx_outbox_org_created ON event_outbox (org_id, created_at DESC);

CREATE TABLE audit_log (
  id         bigint NOT NULL DEFAULT nextval('audit_log_id_seq'),
  org_id     bigint NOT NULL,
  actor_id   bigint,
  actor_type text NOT NULL DEFAULT 'user',  -- user|partner_agent|candidate|bot|system|api_key
  module     text NOT NULL,
  record_id  bigint NOT NULL,               -- polymorphic
  action     text NOT NULL,                 -- insert|update|delete|merge|login
  -- Field-level {old,new}. Append-only history; this is NOT event sourcing —
  -- the tables remain the source of truth, this is the paper trail.
  delta      jsonb,
  request_id text,
  ip         inet,
  at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, at)
) PARTITION BY RANGE (at);

CREATE INDEX idx_audit_record ON audit_log (org_id, module, record_id, at DESC);
CREATE INDEX idx_audit_actor  ON audit_log (org_id, actor_id, at DESC);

-- Bootstrap partitions: previous, current, and the next two months. The
-- partition-maintenance job keeps running ahead of this; an insert that finds
-- no partition is an outage, so always stay several months in front.
DO $$
DECLARE
  m date;
BEGIN
  FOR m IN
    SELECT generate_series(
      date_trunc('month', now() - interval '1 month'),
      date_trunc('month', now() + interval '2 months'),
      interval '1 month'
    )::date
  LOOP
    PERFORM ensure_monthly_partition('event_outbox', m);
    PERFORM ensure_monthly_partition('audit_log', m);
  END LOOP;
END $$;

-- Catch-all so a gap in partition maintenance degrades into "rows land in the
-- wrong place" instead of "writes start failing". Monitor it: a non-empty
-- default partition means the maintenance job is behind.
CREATE TABLE event_outbox_default PARTITION OF event_outbox DEFAULT;
CREATE TABLE audit_log_default    PARTITION OF audit_log    DEFAULT;
