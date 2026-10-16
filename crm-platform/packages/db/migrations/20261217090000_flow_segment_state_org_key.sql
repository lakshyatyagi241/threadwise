-- flow_segment_state is keyed by (org_id, flow_id, contact_id): every tenant table leads with org_id. The composite foreign keys
-- already keep each row inside one workspace; the key now says so too. Additive to 20261123090000_flr_segment_leave.sql (that
-- migration is applied and is not edited).

ALTER TABLE flow_segment_state DROP CONSTRAINT flow_segment_state_pkey;
ALTER TABLE flow_segment_state ADD CONSTRAINT flow_segment_state_pkey PRIMARY KEY (org_id, flow_id, contact_id);
