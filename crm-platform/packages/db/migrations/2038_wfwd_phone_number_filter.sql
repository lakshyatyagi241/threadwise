-- wfwd: let a forwarding target take the events of only some phone numbers.
-- Why this migration exists: every target received every Meta event of the app, so a product that serves a few numbers still got all
-- the traffic of the others. A target can now list the Meta phone number ids it wants; NULL keeps the old behaviour (every number).
-- A webhook body that names several numbers is forwarded whole when at least one of them is listed, because the body is sent byte for
-- byte (the signature covers all of it).

ALTER TABLE webhook_forward_targets
  ADD COLUMN phone_number_id_filter text[];
